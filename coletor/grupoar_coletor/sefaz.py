"""Comunicação com o serviço NFeDistribuicaoDFe (Ambiente Nacional da SEFAZ).

- Consulta por NSU (distNSU/ultNSU): até 50 documentos por chamada.
- cStat 137: nenhum documento novo -> esperar 1 hora para consultar de novo esse CNPJ.
- cStat 138: documentos encontrados.
- cStat 656: consumo indevido -> bloqueado por 1 hora.
Não exige assinatura do XML; exige o certificado A1 do CNPJ consultado (TLS mútuo).
"""
from __future__ import annotations

import http.client
import ssl
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from urllib.parse import urlparse

URLS = {
    "producao": "https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx",
    "homologacao": "https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx",
}
TP_AMB = {"producao": "1", "homologacao": "2"}
UF_PE = "26"
NS_NFE = "http://www.portalfiscal.inf.br/nfe"
NS_WSDL = "http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe"
ACAO = f'{NS_WSDL}/nfeDistDFeInteresse'


@dataclass
class DocZip:
    nsu: int
    schema: str
    conteudo_base64: str


@dataclass
class Resposta:
    cstat: str
    motivo: str
    ultimo_nsu: int
    maximo_nsu: int
    data_resposta: str | None
    documentos: list[DocZip] = field(default_factory=list)

    @property
    def sem_documentos(self) -> bool:
        return self.cstat == "137"

    @property
    def consumo_indevido(self) -> bool:
        return self.cstat == "656"

    @property
    def acabou(self) -> bool:
        """Não há mais nada a buscar agora: esperar 1 hora antes de consultar de novo."""
        return self.cstat in ("137", "656") or (self.cstat == "138" and self.ultimo_nsu >= self.maximo_nsu)


def montar_pedido(cnpj: str, ultimo_nsu: int = 0, ambiente: str = "producao", chave: str | None = None) -> str:
    if chave:
        consulta = f"<consChNFe><chNFe>{chave}</chNFe></consChNFe>"
    else:
        consulta = f"<distNSU><ultNSU>{ultimo_nsu:015d}</ultNSU></distNSU>"
    dist = (
        f'<distDFeInt xmlns="{NS_NFE}" versao="1.01">'
        f"<tpAmb>{TP_AMB[ambiente]}</tpAmb><cUFAutor>{UF_PE}</cUFAutor><CNPJ>{cnpj}</CNPJ>{consulta}</distDFeInt>"
    )
    return (
        '<?xml version="1.0" encoding="utf-8"?>'
        '<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
        'xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">'
        f'<soap12:Body><nfeDistDFeInteresse xmlns="{NS_WSDL}"><nfeDadosMsg>{dist}</nfeDadosMsg>'
        "</nfeDistDFeInteresse></soap12:Body></soap12:Envelope>"
    )


def ler_resposta(xml: bytes) -> Resposta:
    raiz = ET.fromstring(xml)
    ret = raiz.find(f".//{{{NS_NFE}}}retDistDFeInt")
    if ret is None:
        falha = raiz.find(".//{http://www.w3.org/2003/05/soap-envelope}Text")
        raise RuntimeError(f"Resposta inesperada da SEFAZ: {falha.text if falha is not None else xml[:300]!r}")
    t = lambda nome: (ret.findtext(f"{{{NS_NFE}}}{nome}") or "").strip()  # noqa: E731
    docs = [
        DocZip(nsu=int(d.get("NSU")), schema=d.get("schema", ""), conteudo_base64=(d.text or "").strip())
        for d in ret.findall(f"{{{NS_NFE}}}loteDistDFeInt/{{{NS_NFE}}}docZip")
    ]
    return Resposta(
        cstat=t("cStat"),
        motivo=t("xMotivo"),
        ultimo_nsu=int(t("ultNSU") or 0),
        maximo_nsu=int(t("maxNSU") or 0),
        data_resposta=t("dhResp") or None,
        documentos=docs,
    )


def consultar(contexto_tls: ssl.SSLContext, pedido: str, ambiente: str = "producao", tempo_limite: int = 60) -> Resposta:
    url = urlparse(URLS[ambiente])
    conexao = http.client.HTTPSConnection(url.hostname, 443, context=contexto_tls, timeout=tempo_limite)
    try:
        conexao.request(
            "POST",
            url.path,
            body=pedido.encode("utf-8"),
            headers={"Content-Type": f'application/soap+xml; charset=utf-8; action="{ACAO}"'},
        )
        r = conexao.getresponse()
        corpo = r.read()
        if r.status >= 500 and b"retDistDFeInt" not in corpo:
            raise RuntimeError(f"SEFAZ respondeu HTTP {r.status}: {corpo[:300]!r}")
        return ler_resposta(corpo)
    finally:
        conexao.close()
