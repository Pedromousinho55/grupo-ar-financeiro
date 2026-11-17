"""Rotina de coleta: para cada loja, busca na SEFAZ os documentos novos e grava no banco.

Regras:
- começa do último NSU salvo para o CNPJ;
- busca em sequência (até 50 por chamada) enquanto houver documentos;
- quando a SEFAZ diz que não há mais nada (137, ou NSU atual = máximo) ou bloqueia (656),
  grava "próxima consulta permitida" = agora + 1h05 e não consulta esse CNPJ antes disso;
- NUNCA faz manifestação (Ciência etc.) nesta versão: só leitura.
"""
from __future__ import annotations

import logging
import socket
from datetime import datetime, timedelta, timezone
from pathlib import Path

from . import nfe_xml, sefaz
from .banco import Banco

log = logging.getLogger("coletor")
ESPERA_APOS_ACABAR = timedelta(hours=1, minutes=5)
MAX_CHAMADAS_POR_LOJA = 40  # 40 x 50 = até 2.000 documentos por execução


def agora() -> datetime:
    return datetime.now(timezone.utc)


def caminho_arquivo(cnpj_loja: str, data_emissao: str | None, chave: str, resumo: bool) -> str:
    ano_mes = (data_emissao or "")[:7].replace("-", "/") or "sem-data"
    return f"{cnpj_loja}/{ano_mes}/{chave}{'-resumo' if resumo else ''}.xml"


def registro_da_nota(n: nfe_xml.Nota, cnpj_loja: str, nsu: int, arquivo: str) -> dict:
    return {
        "chave": n.chave,
        "destinatario_cnpj": n.destinatario_cnpj or cnpj_loja,
        "emitente_cnpj": n.emitente_cnpj,
        "emitente_nome": n.emitente_nome,
        "emitente_ie": n.emitente_ie,
        "numero": n.numero,
        "serie": n.serie,
        "data_emissao": n.data_emissao,
        "valor_total": n.valor_total,
        "tipo_documento": n.tipo_documento,
        "situacao_sefaz": n.situacao_sefaz,
        "duplicatas": n.duplicatas,
        "dados": n.dados,
        "xml_arquivo": arquivo,
        "origem": "sefaz",
        "nsu": nsu,
    }


def processar_lote(banco: Banco, loja: dict, resposta: sefaz.Resposta, pasta_local: Path) -> tuple[int, int]:
    """Grava os documentos de uma resposta. Devolve (notas novas/atualizadas, eventos novos)."""
    lidos = []
    for d in resposta.documentos:
        xml = nfe_xml.descompactar(d.conteudo_base64)
        try:
            doc = nfe_xml.ler_documento(d.schema, xml)
        except Exception as e:  # documento malformado: registra e segue (não perde os demais)
            log.warning("NSU %s (%s) não pôde ser lido: %s", d.nsu, d.schema, e)
            doc = None
        lidos.append((d, xml, doc))

    existentes = banco.notas_existentes([doc.chave for _, _, doc in lidos if isinstance(doc, nfe_xml.Nota)])
    notas = eventos = 0
    for d, xml, doc in lidos:
        if doc is None:
            continue
        if isinstance(doc, nfe_xml.Nota):
            arquivo = caminho_arquivo(loja["cnpj"], doc.data_emissao, doc.chave, doc.tipo_documento == "resumo")
            local = pasta_local / arquivo
            local.parent.mkdir(parents=True, exist_ok=True)
            if not local.exists():
                local.write_bytes(xml)  # cópia local (backup)
            banco.enviar_arquivo(arquivo, xml)
            atual = existentes.get(doc.chave)
            dados = registro_da_nota(doc, loja["cnpj"], d.nsu, arquivo)
            if atual is None:
                banco.incluir_nota(dados)
                notas += 1
            elif atual["tipo_documento"] == "resumo" and doc.tipo_documento == "completa":
                dados.pop("chave")
                banco.atualizar_nota(doc.chave, dados)  # resumo vira nota completa
                notas += 1
            else:
                continue
            # a mesma chave pode vir de novo no mesmo lote (ex.: resumo e depois a nota completa)
            existentes[doc.chave] = {"chave": doc.chave, "tipo_documento": doc.tipo_documento, "xml_arquivo": arquivo}
        elif isinstance(doc, nfe_xml.Evento):
            if banco.incluir_evento({
                "chave": doc.chave, "tipo_evento": doc.tipo_evento, "descricao": doc.descricao,
                "sequencia": doc.sequencia, "data_evento": doc.data_evento, "protocolo": doc.protocolo,
                "nsu": d.nsu, "dados": doc.dados,
            }):
                eventos += 1
    return notas, eventos


def coletar_loja(banco: Banco, loja: dict, ctx_tls, pasta_local: Path, ambiente: str = "producao",
                 consultar=sefaz.consultar) -> dict:
    controle = banco.controle(loja["id"]) or {}
    permitida = controle.get("proxima_consulta_permitida")
    if permitida and datetime.fromisoformat(permitida) > agora():
        log.info("%s: aguardando o bloqueio de 1 hora da SEFAZ (até %s)", loja["apelido"], permitida)
        return {"loja": loja["apelido"], "pulada": True, "ate": permitida}

    exec_id = banco.iniciar_execucao({"loja_id": loja["id"], "maquina": socket.gethostname()})
    nsu = int(controle.get("ultimo_nsu") or 0)
    total_docs = total_notas = total_eventos = 0
    resposta = None
    erro = None
    try:
        for _ in range(MAX_CHAMADAS_POR_LOJA):
            resposta = consultar(ctx_tls, sefaz.montar_pedido(loja["cnpj"], nsu, ambiente), ambiente)
            log.info("%s: NSU %s -> cStat %s %s (%d docs, máx %s)", loja["apelido"], nsu, resposta.cstat,
                     resposta.motivo, len(resposta.documentos), resposta.maximo_nsu)
            if resposta.cstat == "138":
                n, e = processar_lote(banco, loja, resposta, pasta_local)
                total_docs += len(resposta.documentos)
                total_notas += n
                total_eventos += e
            if resposta.cstat in ("137", "138"):
                nsu = resposta.ultimo_nsu  # só avança depois de gravar o lote
            banco.salvar_controle({
                "loja_id": loja["id"], "ultimo_nsu": nsu, "maximo_nsu": resposta.maximo_nsu or None,
                "ultima_consulta": agora().isoformat(), "ultimo_cstat": resposta.cstat, "ultimo_motivo": resposta.motivo,
                "proxima_consulta_permitida": (agora() + ESPERA_APOS_ACABAR).isoformat() if resposta.acabou else None,
                "atualizado_em": agora().isoformat(),
            })
            if resposta.acabou or resposta.cstat not in ("137", "138"):
                break
    except Exception as e:
        erro = str(e)
        log.exception("%s: erro na coleta", loja["apelido"])
    finally:
        banco.terminar_execucao(exec_id, {
            "fim": agora().isoformat(), "cstat": resposta.cstat if resposta else None,
            "motivo": resposta.motivo if resposta else None, "documentos": total_docs,
            "notas_novas": total_notas, "eventos_novos": total_eventos, "erro": erro,
        })
    return {"loja": loja["apelido"], "documentos": total_docs, "notas": total_notas, "eventos": total_eventos,
            "cstat": resposta.cstat if resposta else None, "erro": erro}
