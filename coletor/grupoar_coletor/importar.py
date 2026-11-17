"""Importação de XMLs baixados de outro sistema (ex.: Klaus, da contabilidade).

Aceita um arquivo .xml, um .zip (inclusive com .zip dentro) ou uma pasta com esses arquivos.
- Notas completas (nfeProc ou NFe) só entram se o destinatário for uma das nossas lojas;
  as demais (ex.: notas emitidas pela própria loja) são contadas como "de outras empresas".
  Resumos (resNFe) são ignorados: não trazem o destinatário.
- Eventos (procEventoNFe/resEvento, ex.: cancelamento) entram todos: o banco aplica o cancelamento.
- Reimportar o mesmo arquivo não duplica nada (mesma regra da coleta da SEFAZ).
Não fala com a SEFAZ e não faz manifestação.
"""
from __future__ import annotations

import io
import logging
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterator

from . import nfe_xml
from .banco import Banco
from .coleta import gravar_documentos

log = logging.getLogger("coletor")
LOTE = 50  # notas por consulta ao banco


@dataclass
class Resumo:
    arquivos: int = 0
    notas_novas: int = 0
    eventos_novos: int = 0
    ja_existiam: int = 0
    de_outras_empresas: int = 0
    ignorados: int = 0
    erros: list[str] = field(default_factory=list)
    por_loja: dict[str, int] = field(default_factory=dict)


def _do_zip(nome: str, conteudo: bytes, profundidade: int = 0) -> Iterator[tuple[str, bytes]]:
    with zipfile.ZipFile(io.BytesIO(conteudo)) as z:
        for info in z.infolist():
            if info.is_dir():
                continue
            interno = f"{nome}/{info.filename}"
            dados = z.read(info)
            if info.filename.lower().endswith(".xml"):
                yield interno, dados
            elif info.filename.lower().endswith(".zip") and profundidade < 2:
                yield from _do_zip(interno, dados, profundidade + 1)


def ler_arquivos(caminho: Path) -> Iterator[tuple[str, bytes]]:
    """Devolve (nome, conteúdo) de cada XML encontrado."""
    caminho = Path(caminho)
    if caminho.is_dir():
        for arq in sorted(caminho.rglob("*")):
            if arq.is_file() and arq.suffix.lower() in (".xml", ".zip"):
                yield from ler_arquivos(arq)
    elif caminho.suffix.lower() == ".zip":
        yield from _do_zip(caminho.name, caminho.read_bytes())
    elif caminho.suffix.lower() == ".xml":
        yield caminho.name, caminho.read_bytes()


def importar(banco: Banco, caminho: Path, pasta_local: Path) -> Resumo:
    lojas = {loja["cnpj"]: loja for loja in banco.lojas()}
    r = Resumo()
    lidos = []
    for nome, xml in ler_arquivos(caminho):
        r.arquivos += 1
        try:
            doc = nfe_xml.ler_documento("", xml)
        except Exception as e:  # arquivo que não é XML de NF-e válido
            r.erros.append(f"{nome}: {e}")
            continue
        if doc is None:
            r.ignorados += 1  # ex.: CT-e, NFS-e
            continue
        if isinstance(doc, nfe_xml.Nota):
            if doc.tipo_documento == "resumo":
                r.ignorados += 1  # resumo não traz o destinatário; a nota completa é que vale
                continue
            if doc.destinatario_cnpj not in lojas:
                r.de_outras_empresas += 1
                continue
        lidos.append((None, xml, doc))

    for i in range(0, len(lidos), LOTE):
        parte = lidos[i:i + LOTE]
        notas, eventos = gravar_documentos(banco, lambda n: lojas[n.destinatario_cnpj], parte, pasta_local,
                                           origem="pasta")
        r.notas_novas += notas
        r.eventos_novos += eventos
    for _, _, doc in lidos:
        if isinstance(doc, nfe_xml.Nota) and doc.destinatario_cnpj in lojas:
            apelido = lojas[doc.destinatario_cnpj]["apelido"]
            r.por_loja[apelido] = r.por_loja.get(apelido, 0) + 1
    notas_validas = sum(r.por_loja.values())
    r.ja_existiam = max(notas_validas - r.notas_novas, 0)
    return r
