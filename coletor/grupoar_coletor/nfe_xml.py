"""Leitura dos documentos que a SEFAZ devolve no NFeDistribuicaoDFe.

Tipos (atributo "schema" de cada docZip):
- resNFe_v1.01.xsd       -> resumo da NF-e (antes da Ciência da Operação)
- procNFe_v4.00.xsd      -> NF-e completa (XML autorizado)
- resEvento_v1.01.xsd    -> resumo de evento (ex.: cancelamento)
- procEventoNFe_v1.00.xsd-> evento completo
Funções puras, sem rede: testáveis sem certificado.
"""
from __future__ import annotations

import base64
import gzip
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from decimal import Decimal

NS = {"n": "http://www.portalfiscal.inf.br/nfe"}
SITUACAO_RESUMO = {"1": "autorizada", "2": "denegada", "3": "cancelada"}
EVENTOS = {
    "110110": "Carta de correção",
    "110111": "Cancelamento",
    "110112": "Cancelamento por substituição",
    "210200": "Confirmação da operação",
    "210210": "Ciência da operação",
    "210220": "Desconhecimento da operação",
    "210240": "Operação não realizada",
}


@dataclass
class Nota:
    chave: str
    tipo_documento: str  # resumo | completa
    emitente_cnpj: str
    emitente_nome: str | None = None
    emitente_ie: str | None = None
    destinatario_cnpj: str | None = None
    numero: str | None = None
    serie: str | None = None
    data_emissao: str | None = None
    valor_total: str | None = None
    situacao_sefaz: str = "autorizada"
    duplicatas: list[dict] = field(default_factory=list)
    dados: dict = field(default_factory=dict)


@dataclass
class Evento:
    chave: str
    tipo_evento: str
    descricao: str | None
    sequencia: int
    data_evento: str | None
    protocolo: str | None
    dados: dict = field(default_factory=dict)


def descompactar(doc_zip_base64: str) -> bytes:
    return gzip.decompress(base64.b64decode(doc_zip_base64))


def _t(el, caminho: str) -> str | None:
    if el is None:
        return None
    achado = el.find(caminho, NS)
    if achado is None or achado.text is None:
        return None
    return achado.text.strip()


def _dados_da_chave(chave: str) -> dict:
    """A própria chave carrega série e número: usados quando o resumo não traz."""
    return {"serie": str(int(chave[22:25])), "numero": str(int(chave[25:34]))}


def ler_documento(schema: str, xml: bytes) -> Nota | Evento | None:
    raiz = ET.fromstring(xml)
    nome = raiz.tag.split("}")[-1]
    if nome == "resNFe":
        return _resumo(raiz)
    if nome == "nfeProc":
        return _completa(raiz)
    if nome == "NFe":  # XML da nota sem o protocolo (algumas exportações de sistemas trazem assim)
        envelope = ET.Element(f"{{{NS['n']}}}nfeProc")
        envelope.append(raiz)
        return _completa(envelope)
    if nome == "resEvento":
        return _resumo_evento(raiz)
    if nome == "procEventoNFe":
        return _evento_completo(raiz)
    return None  # outros tipos (ex.: CT-e) são ignorados


def _resumo(r) -> Nota:
    chave = _t(r, "n:chNFe")
    doc = _dados_da_chave(chave)
    return Nota(
        chave=chave,
        tipo_documento="resumo",
        emitente_cnpj=_t(r, "n:CNPJ") or _t(r, "n:CPF"),
        emitente_nome=_t(r, "n:xNome"),
        emitente_ie=_t(r, "n:IE"),
        numero=doc["numero"],
        serie=doc["serie"],
        data_emissao=_t(r, "n:dhEmi"),
        valor_total=_t(r, "n:vNF"),
        situacao_sefaz=SITUACAO_RESUMO.get(_t(r, "n:cSitNFe") or "1", "autorizada"),
        dados={"tpNF": _t(r, "n:tpNF"), "protocolo": _t(r, "n:nProt"), "recebimento_sefaz": _t(r, "n:dhRecbto")},
    )


def _completa(r) -> Nota:
    inf = r.find("n:NFe/n:infNFe", NS)
    chave = (inf.get("Id") or "").removeprefix("NFe")
    ide, emit, dest = inf.find("n:ide", NS), inf.find("n:emit", NS), inf.find("n:dest", NS)
    duplicatas = [
        {"numero": _t(d, "n:nDup"), "vencimento": _t(d, "n:dVenc"), "valor": _t(d, "n:vDup")}
        for d in inf.findall("n:cobr/n:dup", NS)
    ]
    c_stat = _t(r, "n:protNFe/n:infProt/n:cStat")
    situacao = "denegada" if c_stat in ("110", "301", "302", "303") else "autorizada"
    itens = [
        {
            "codigo": _t(d, "n:prod/n:cProd"),
            "descricao": _t(d, "n:prod/n:xProd"),
            "ncm": _t(d, "n:prod/n:NCM"),
            "cfop": _t(d, "n:prod/n:CFOP"),
            "unidade": _t(d, "n:prod/n:uCom"),
            "quantidade": _t(d, "n:prod/n:qCom"),
            "valor": _t(d, "n:prod/n:vProd"),
        }
        for d in inf.findall("n:det", NS)
    ]
    return Nota(
        chave=chave,
        tipo_documento="completa",
        emitente_cnpj=_t(emit, "n:CNPJ") or _t(emit, "n:CPF"),
        emitente_nome=_t(emit, "n:xNome"),
        emitente_ie=_t(emit, "n:IE"),
        destinatario_cnpj=_t(dest, "n:CNPJ") or _t(dest, "n:CPF"),
        numero=_t(ide, "n:nNF"),
        serie=_t(ide, "n:serie"),
        data_emissao=_t(ide, "n:dhEmi") or _t(ide, "n:dEmi"),
        valor_total=_t(inf, "n:total/n:ICMSTot/n:vNF"),
        situacao_sefaz=situacao,
        duplicatas=duplicatas,
        dados={
            "fantasia_emitente": _t(emit, "n:xFant"),
            "natureza_operacao": _t(ide, "n:natOp"),
            "tpNF": _t(ide, "n:tpNF"),
            "protocolo": _t(r, "n:protNFe/n:infProt/n:nProt"),
            "info_complementar": _t(inf, "n:infAdic/n:infCpl"),
            "forma_pagamento": [_t(p, "n:tPag") for p in inf.findall("n:pag/n:detPag", NS)],
            "itens": itens,
        },
    )


def _resumo_evento(r) -> Evento:
    tipo = _t(r, "n:tpEvento")
    return Evento(
        chave=_t(r, "n:chNFe"),
        tipo_evento=tipo,
        descricao=_t(r, "n:xEvento") or EVENTOS.get(tipo),
        sequencia=int(_t(r, "n:nSeqEvento") or 1),
        data_evento=_t(r, "n:dhEvento"),
        protocolo=_t(r, "n:nProt"),
    )


def _evento_completo(r) -> Evento:
    inf = r.find("n:evento/n:infEvento", NS)
    tipo = _t(inf, "n:tpEvento")
    return Evento(
        chave=_t(inf, "n:chNFe"),
        tipo_evento=tipo,
        descricao=_t(inf, "n:detEvento/n:descEvento") or EVENTOS.get(tipo),
        sequencia=int(_t(inf, "n:nSeqEvento") or 1),
        data_evento=_t(inf, "n:dhEvento"),
        protocolo=_t(r, "n:retEvento/n:infEvento/n:nProt"),
        dados={"justificativa": _t(inf, "n:detEvento/n:xJust"), "correcao": _t(inf, "n:detEvento/n:xCorrecao")},
    )


def valor(v: str | None) -> Decimal | None:
    return Decimal(v) if v else None
