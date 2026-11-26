"""Cliente da API do Klaus, com respostas simuladas (nenhuma chamada de verdade)."""
import io
import urllib.error
import zipfile
from datetime import date

import pytest

from grupoar_coletor import klaus


def _zip(n=1):
    b = io.BytesIO()
    with zipfile.ZipFile(b, "w") as z:
        for i in range(n):
            z.writestr(f"nota{i}.xml", "<x/>")
    return b.getvalue()


class Resposta:
    def __init__(self, status=200, headers=None, corpo=b""):
        self.status, self.headers, self._corpo = status, headers or {}, corpo

    def read(self):
        return self._corpo

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def erro(codigo, headers=None):
    return urllib.error.HTTPError("u", codigo, "x", headers or {}, None)


class FalsoKlaus:
    """Simula a API: devolve respostas em sequência e guarda os pedidos feitos."""

    def __init__(self, respostas):
        self.respostas = list(respostas)
        self.pedidos = []

    def __call__(self, req, timeout=None):
        self.pedidos.append((req.get_method(), req.full_url, req.headers.get("Authorization")))
        r = self.respostas.pop(0)
        if isinstance(r, Exception):
            raise r
        return r


def cliente(respostas):
    falso = FalsoKlaus(respostas)
    return klaus.ClienteKlaus("t" * 40, abrir=falso, dormir=lambda s: None, pausa=0), falso


INI, FIM = date(2026, 11, 18), date(2026, 11, 25)


def test_conta_paginas_e_monta_endereco_com_token():
    c, f = cliente([Resposta(200, {"X-REPO-INTERVALO-TOTAL": "250", "X-REPO-INTERVALO-NSU-ULTIMO": "3"})])
    assert c.paginas("29226702000170", INI, FIM) == 3
    metodo, url, auth = f.pedidos[0]
    assert metodo == "HEAD"
    assert "/29226702000170/DESTINATARIO?" in url
    assert "dataInicio=2026-11-18T00%3A00%3A00-03%3A00" in url and "dataFim=2026-11-25T23%3A59%3A59-03%3A00" in url
    assert auth == "Bearer " + "t" * 40


def test_404_e_nenhuma_nota():
    c, _ = cliente([erro(404), erro(404)])
    assert c.paginas("1", INI, FIM) == 0
    assert c.baixar("1", INI, FIM, 1) == b""


def test_espera_quando_a_api_pede_429():
    esperas = []
    falso = FalsoKlaus([erro(429, {"Retry-After": "7"}), Resposta(200, {}, _zip(2))])
    c = klaus.ClienteKlaus("t" * 40, abrir=falso, dormir=esperas.append, pausa=1)
    assert c.baixar("1", INI, FIM, 1)[:2] == b"PK"
    assert 7 in esperas  # respeitou o Retry-After


def test_token_recusado_e_resposta_que_nao_e_zip():
    c, _ = cliente([erro(401)])
    with pytest.raises(klaus.ErroKlaus, match="token"):
        c.paginas("1", INI, FIM)
    c, _ = cliente([Resposta(200, {}, b"<html>erro</html>")])
    with pytest.raises(klaus.ErroKlaus, match="zip"):
        c.baixar("1", INI, FIM, 1)


def test_eventos_usam_o_endereco_de_eventos():
    c, f = cliente([Resposta(200, {"X-REPO-INTERVALO-NSU-ULTIMO": "4"}, _zip()), Resposta(200, {}, _zip())])
    assert c.paginas("1", INI, FIM, eventos=True) == 4
    assert c.baixar("1", INI, FIM, 2, eventos=True)[:2] == b"PK"
    assert "/DESTINATARIO/eventos/XML?" in f.pedidos[0][1] and "nsu=2" in f.pedidos[1][1]


def test_so_usa_leitura():
    # a importação automática nunca usa os POST (envio) da API
    fonte = open(klaus.__file__, encoding="utf-8").read()
    assert '"POST"' not in fonte and "'POST'" not in fonte


def test_importar_klaus_baixa_paginas_e_importa(tmp_path, monkeypatch):
    importados = []

    class R:
        por_loja = {"Voar": 2}
        notas_novas, eventos_novos, erros = 2, 0, []

    monkeypatch.setattr(klaus, "importar", lambda banco, arq, pasta: importados.append(arq.name) or R())

    class Banco:
        execs = []

        def lojas(self):
            return [{"id": "v", "apelido": "Voar", "cnpj": "29226702000170"}, {"id": "t", "apelido": "Terra", "cnpj": "60543245000197"}]

        def iniciar_execucao(self, d):
            self.execs.append(d)
            return len(self.execs)

        def terminar_execucao(self, i, d):
            self.execs.append(d)

    c, _ = cliente([
        Resposta(200, {"X-REPO-INTERVALO-NSU-ULTIMO": "2"}),          # Voar: 2 páginas de notas
        Resposta(200, {}, _zip()), Resposta(200, {}, _zip()),
        erro(404),                                                    # Voar: sem eventos
        erro(404), erro(404),                                         # Terra: nada
    ])
    resumos = klaus.importar_klaus(Banco(), tmp_path, dias=7, cliente=c, hoje=FIM)
    assert [r.loja for r in resumos] == ["Voar", "Terra"]
    assert resumos[0].paginas == 2 and resumos[0].notas_novas == 4
    assert resumos[1].paginas == 0
    assert len(importados) == 2 and all("notas-20261118-20261125" in n for n in importados)
    assert (tmp_path / "klaus" / "29226702000170").is_dir()
