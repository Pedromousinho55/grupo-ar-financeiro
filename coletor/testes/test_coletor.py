"""Testes do coletor com documentos montados no layout oficial (sem rede, sem certificado real).
Rodar: cd coletor && python -m pytest -q
"""
import base64
import gzip
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import BestAvailableEncryption, pkcs12
from cryptography.x509.oid import NameOID

from grupoar_coletor import certificado, coleta, nfe_xml, sefaz

TERRA = {"id": "loja-terra", "apelido": "Terra", "cnpj": "60543245000197"}
CHAVE = "26261141244765000154550010002954701123456783"
CHAVE2 = "26261141244765000154550010002954711123456780"
NS = 'xmlns="http://www.portalfiscal.inf.br/nfe"'

RESUMO = f"""<resNFe {NS} versao="1.01"><chNFe>{CHAVE}</chNFe><CNPJ>41244765000154</CNPJ>
<xNome>A &amp; A COMERCIAL LTDA</xNome><IE>123456789</IE><dhEmi>2026-11-10T09:30:00-03:00</dhEmi>
<tpNF>1</tpNF><vNF>1234.56</vNF><digVal>abc=</digVal><dhRecbto>2026-11-10T09:31:00-03:00</dhRecbto>
<nProt>126260000000001</nProt><cSitNFe>1</cSitNFe></resNFe>"""

COMPLETA = f"""<nfeProc {NS} versao="4.00"><NFe><infNFe Id="NFe{CHAVE}" versao="4.00">
<ide><natOp>VENDA</natOp><serie>1</serie><nNF>295470</nNF><dhEmi>2026-11-10T09:30:00-03:00</dhEmi><tpNF>1</tpNF></ide>
<emit><CNPJ>41244765000154</CNPJ><xNome>A &amp; A COMERCIAL LTDA</xNome><xFant>GRAND MARCA</xFant><IE>123456789</IE></emit>
<dest><CNPJ>60543245000197</CNPJ><xNome>TERRA GASTRONOMIA LTDA</xNome></dest>
<det nItem="1"><prod><cProd>001</cProd><xProd>FARINHA DE TRIGO 25KG</xProd><NCM>11010010</NCM><CFOP>5102</CFOP>
<uCom>SC</uCom><qCom>10.0000</qCom><vProd>1234.56</vProd></prod></det>
<total><ICMSTot><vNF>1234.56</vNF></ICMSTot></total>
<cobr><dup><nDup>001</nDup><dVenc>2026-12-10</dVenc><vDup>617.28</vDup></dup>
<dup><nDup>002</nDup><dVenc>2027-01-09</dVenc><vDup>617.28</vDup></dup></cobr>
<pag><detPag><tPag>15</tPag><vPag>1234.56</vPag></detPag></pag>
<infAdic><infCpl>Pedido 123</infCpl></infAdic></infNFe></NFe>
<protNFe versao="4.00"><infProt><chNFe>{CHAVE}</chNFe><nProt>126260000000001</nProt><cStat>100</cStat></infProt></protNFe></nfeProc>"""

CANCELAMENTO = f"""<resEvento {NS} versao="1.01"><cOrgao>26</cOrgao><CNPJ>41244765000154</CNPJ><chNFe>{CHAVE2}</chNFe>
<dhEvento>2026-11-11T10:00:00-03:00</dhEvento><tpEvento>110111</tpEvento><nSeqEvento>1</nSeqEvento>
<xEvento>Cancelamento</xEvento><dhRecbto>2026-11-11T10:00:01-03:00</dhRecbto><nProt>126260000000099</nProt></resEvento>"""


def zipar(xml: str) -> str:
    return base64.b64encode(gzip.compress(xml.encode())).decode()


def resposta_soap(cstat, motivo, ult, maxi, docs=()):
    lote = "".join(f'<docZip NSU="{n:015d}" schema="{s}">{zipar(x)}</docZip>' for n, s, x in docs)
    lote = f"<loteDistDFeInt>{lote}</loteDistDFeInt>" if docs else ""
    return f"""<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">
<soap:Body><nfeDistDFeInteresseResponse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe">
<nfeDistDFeInteresseResult><retDistDFeInt {NS} versao="1.01"><tpAmb>1</tpAmb><verAplic>1.0</verAplic>
<cStat>{cstat}</cStat><xMotivo>{motivo}</xMotivo><dhResp>2026-11-17T10:00:00-03:00</dhResp>
<ultNSU>{ult:015d}</ultNSU><maxNSU>{maxi:015d}</maxNSU>{lote}</retDistDFeInt></nfeDistDFeInteresseResult>
</nfeDistDFeInteresseResponse></soap:Body></soap:Envelope>""".encode()


# ---------------- leitura de documentos ----------------
def test_le_resumo():
    n = nfe_xml.ler_documento("resNFe_v1.01.xsd", RESUMO.encode())
    assert n.tipo_documento == "resumo" and n.chave == CHAVE
    assert n.emitente_cnpj == "41244765000154" and n.emitente_nome == "A & A COMERCIAL LTDA"
    assert n.numero == "295470" and n.serie == "1"  # vêm da própria chave
    assert n.valor_total == "1234.56" and n.situacao_sefaz == "autorizada"


def test_le_nota_completa_com_duplicatas():
    n = nfe_xml.ler_documento("procNFe_v4.00.xsd", COMPLETA.encode())
    assert n.tipo_documento == "completa" and n.destinatario_cnpj == "60543245000197"
    assert n.duplicatas == [
        {"numero": "001", "vencimento": "2026-12-10", "valor": "617.28"},
        {"numero": "002", "vencimento": "2027-01-09", "valor": "617.28"},
    ]
    assert n.dados["fantasia_emitente"] == "GRAND MARCA"
    assert n.dados["itens"][0]["descricao"] == "FARINHA DE TRIGO 25KG"


def test_le_cancelamento():
    e = nfe_xml.ler_documento("resEvento_v1.01.xsd", CANCELAMENTO.encode())
    assert e.tipo_evento == "110111" and e.chave == CHAVE2 and e.descricao == "Cancelamento"


def test_resumo_cancelado():
    n = nfe_xml.ler_documento("resNFe_v1.01.xsd", RESUMO.replace("<cSitNFe>1", "<cSitNFe>3").encode())
    assert n.situacao_sefaz == "cancelada"


# ---------------- pedido e resposta SEFAZ ----------------
def test_pedido_por_nsu():
    p = sefaz.montar_pedido("60543245000197", 1234)
    assert "<ultNSU>000000000001234</ultNSU>" in p and "<cUFAutor>26</cUFAutor>" in p and "<tpAmb>1</tpAmb>" in p
    assert 'versao="1.01"' in p


def test_pedido_por_chave():
    assert f"<consChNFe><chNFe>{CHAVE}</chNFe></consChNFe>" in sefaz.montar_pedido("60543245000197", chave=CHAVE)


def test_le_resposta_com_documentos():
    r = sefaz.ler_resposta(resposta_soap("138", "Documento(s) localizado(s)", 2, 5, [(1, "resNFe_v1.01.xsd", RESUMO)]))
    assert r.cstat == "138" and r.ultimo_nsu == 2 and r.maximo_nsu == 5 and not r.acabou
    assert nfe_xml.descompactar(r.documentos[0].conteudo_base64).decode() == RESUMO


def test_regras_de_parada():
    assert sefaz.ler_resposta(resposta_soap("137", "Nenhum documento", 5, 5)).acabou
    assert sefaz.ler_resposta(resposta_soap("656", "Consumo Indevido", 5, 5)).acabou
    assert sefaz.ler_resposta(resposta_soap("138", "ok", 5, 5)).acabou


# ---------------- certificado ----------------
@pytest.fixture
def pfx(tmp_path):
    chave = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    nome = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "TERRA GASTRONOMIA LTDA:60543245000197")])
    outro = x509.OtherName(x509.ObjectIdentifier("2.16.76.1.3.3"), b"\x13\x0e60543245000197")
    agora = datetime.now(timezone.utc)
    cert = (x509.CertificateBuilder().subject_name(nome).issuer_name(nome).public_key(chave.public_key())
            .serial_number(1).not_valid_before(agora).not_valid_after(agora + timedelta(days=200))
            .add_extension(x509.SubjectAlternativeName([outro]), critical=False).sign(chave, hashes.SHA256()))
    arq = tmp_path / "Terra.pfx"
    arq.write_bytes(pkcs12.serialize_key_and_certificates(b"t", chave, cert, None, BestAvailableEncryption(b"senha-teste")))
    return arq


def test_le_certificado(pfx):
    info = certificado.ler_info(pfx, "senha-teste")
    assert info.cnpj == "60543245000197" and "TERRA" in info.titular
    assert (info.valido_ate - info.valido_de).days >= 199


def test_senha_errada(pfx):
    with pytest.raises(ValueError, match="senha incorreta"):
        certificado.ler_info(pfx, "errada")


def test_contexto_tls_nao_deixa_chave_em_disco(pfx, tmp_path, monkeypatch):
    monkeypatch.setattr("tempfile.tempdir", str(tmp_path))
    certificado.contexto_tls(pfx, "senha-teste")
    assert not list(tmp_path.glob("*.pem")), "arquivo temporário com a chave deveria ter sido apagado"


# ---------------- rotina de coleta ----------------
class BancoFalso:
    def __init__(self):
        self.notas, self.eventos, self.arquivos, self.execucoes = {}, [], {}, []
        self.ctrl = {}

    def controle(self, loja_id):
        return self.ctrl.get(loja_id)

    def salvar_controle(self, d):
        self.ctrl[d["loja_id"]] = d

    def notas_existentes(self, chaves):
        return {c: self.notas[c] for c in chaves if c in self.notas}

    def incluir_nota(self, d):
        assert d["chave"] not in self.notas
        self.notas[d["chave"]] = d

    def atualizar_nota(self, chave, d):
        self.notas[chave].update(d)

    def incluir_evento(self, d):
        self.eventos.append(d)
        return True

    def enviar_arquivo(self, caminho, conteudo, tipo="application/xml"):
        self.arquivos.setdefault(caminho, conteudo)
        return True

    def iniciar_execucao(self, d):
        self.execucoes.append(d)
        return len(self.execucoes)

    def terminar_execucao(self, i, d):
        self.execucoes[i - 1].update(d)


def sefaz_falsa(respostas):
    chamadas = []

    def consultar(ctx, pedido, ambiente):
        chamadas.append(pedido)
        return sefaz.ler_resposta(respostas.pop(0))
    return consultar, chamadas


def test_coleta_completa_e_bloqueio_de_1_hora(tmp_path):
    banco = BancoFalso()
    consultar, chamadas = sefaz_falsa([
        resposta_soap("138", "ok", 2, 3, [(1, "resNFe_v1.01.xsd", RESUMO), (2, "resEvento_v1.01.xsd", CANCELAMENTO)]),
        resposta_soap("138", "ok", 3, 3, [(3, "procNFe_v4.00.xsd", COMPLETA)]),
    ])
    r = coleta.coletar_loja(banco, TERRA, None, tmp_path, consultar=consultar)
    assert r["documentos"] == 3 and r["eventos"] == 1
    assert "<ultNSU>000000000000000</ultNSU>" in chamadas[0] and "<ultNSU>000000000000002</ultNSU>" in chamadas[1]
    nota = banco.notas[CHAVE]
    assert nota["tipo_documento"] == "completa" and len(nota["duplicatas"]) == 2  # resumo virou completa
    assert banco.ctrl["loja-terra"]["ultimo_nsu"] == 3
    assert banco.ctrl["loja-terra"]["proxima_consulta_permitida"] is not None  # acabou -> espera 1h
    assert (tmp_path / "60543245000197/2026/11" / f"{CHAVE}.xml").exists()  # cópia local
    assert f"60543245000197/2026/11/{CHAVE}-resumo.xml" in banco.arquivos  # resumo também guardado

    # segunda execução logo em seguida: não consulta (respeita o bloqueio)
    consultar2, chamadas2 = sefaz_falsa([])
    r2 = coleta.coletar_loja(banco, TERRA, None, tmp_path, consultar=consultar2)
    assert r2["pulada"] and chamadas2 == []


def test_mesma_nota_duas_vezes_no_mesmo_lote(tmp_path):
    banco = BancoFalso()
    banco.notas_existentes = lambda chaves: {}  # como o banco real: retrato tirado antes do lote
    consultar, _ = sefaz_falsa([
        resposta_soap("138", "ok", 3, 3, [(1, "resNFe_v1.01.xsd", RESUMO), (2, "procNFe_v4.00.xsd", COMPLETA),
                                          (3, "resNFe_v1.01.xsd", RESUMO)]),
    ])
    r = coleta.coletar_loja(banco, TERRA, None, tmp_path, consultar=consultar)
    assert r["erro"] is None and r["notas"] == 2  # incluiu o resumo e depois virou completa
    assert banco.notas[CHAVE]["tipo_documento"] == "completa"  # o resumo repetido não volta atrás
    assert banco.ctrl["loja-terra"]["ultimo_nsu"] == 3


def test_consumo_indevido_nao_avanca_nsu(tmp_path):
    banco = BancoFalso()
    banco.ctrl["loja-terra"] = {"ultimo_nsu": 10}
    consultar, _ = sefaz_falsa([resposta_soap("656", "Rejeicao: Consumo Indevido", 0, 0)])
    r = coleta.coletar_loja(banco, TERRA, None, tmp_path, consultar=consultar)
    assert r["cstat"] == "656"
    assert banco.ctrl["loja-terra"]["ultimo_nsu"] == 10
    assert banco.ctrl["loja-terra"]["proxima_consulta_permitida"] is not None


def test_erro_no_meio_nao_perde_nsu(tmp_path):
    banco = BancoFalso()
    respostas = [resposta_soap("138", "ok", 1, 5, [(1, "resNFe_v1.01.xsd", RESUMO)])]

    def consultar(ctx, pedido, ambiente):
        if respostas:
            return sefaz.ler_resposta(respostas.pop(0))
        raise TimeoutError("SEFAZ fora do ar")
    r = coleta.coletar_loja(banco, TERRA, None, tmp_path, consultar=consultar)
    assert "fora do ar" in r["erro"]
    assert banco.ctrl["loja-terra"]["ultimo_nsu"] == 1  # o que foi gravado fica; recomeça do 1
    assert banco.execucoes[0]["erro"]
