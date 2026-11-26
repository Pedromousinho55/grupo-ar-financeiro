"""Importação automática das NF-e recebidas pela API do Klaus (sistema da contabilidade SATIERF).

SÓ LEITURA: usa apenas GET/HEAD da API (nunca os POST de envio) e não faz manifestação.
Token: Cofre do Windows ("GrupoAR-Coletor" / "klaus-token"), nunca em arquivo.

Para cada empresa e período:
  HEAD  /rest/v2/nfes/{cnpj}/DESTINATARIO?dataInicio&dataFim&nsu=1   → quantas notas/páginas (404 = nenhuma)
  GET   /rest/v2/nfes/{cnpj}/DESTINATARIO/XML?…&nsu=N                → zip com os XMLs da página N
  GET   /rest/v2/nfes/{cnpj}/DESTINATARIO/eventos/XML?…&nsu=N        → zip com os eventos (cancelamento etc.)
Os zips ficam na pasta local de XMLs (cópia) e passam pelo mesmo importador do "importar" (não duplica).
"""
from __future__ import annotations

import logging
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from pathlib import Path

import keyring

from .banco import Banco
from .importar import importar

log = logging.getLogger("coletor")
BASE = "https://fixws.klausfiscal.com.br/rest/v2/nfes"
COFRE = ("GrupoAR-Coletor", "klaus-token")
PAUSA = 4.0  # segundos entre chamadas (a API devolve 429 se chamar em sequência)
TENTATIVAS = 6


class ErroKlaus(RuntimeError):
    pass


def token() -> str:
    t = (keyring.get_password(*COFRE) or "").strip()
    if len(t) < 20:
        raise ErroKlaus("Token do Klaus não encontrado no Cofre do Windows (GrupoAR-Coletor / klaus-token)")
    return t


def _data(d: date, fim: bool) -> str:
    return f"{d.isoformat()}T{'23:59:59' if fim else '00:00:00'}-03:00"


class ClienteKlaus:
    def __init__(self, tok: str, abrir=urllib.request.urlopen, dormir=time.sleep, pausa: float = PAUSA):
        self._tok = tok
        self._abrir = abrir
        self._dormir = dormir
        self._pausa = pausa

    def _pedir(self, metodo: str, cnpj: str, sufixo: str, inicio: date, fim: date, nsu: int):
        q = urllib.parse.urlencode({"dataInicio": _data(inicio, False), "dataFim": _data(fim, True), "nsu": nsu})
        req = urllib.request.Request(f"{BASE}/{cnpj}/DESTINATARIO{sufixo}?{q}", method=metodo,
                                     headers={"Authorization": "Bearer " + self._tok, "Accept": "*/*"})
        espera = 10
        for _ in range(TENTATIVAS):
            self._dormir(self._pausa)
            try:
                with self._abrir(req, timeout=180) as r:
                    return r.status, dict(r.headers), r.read()
            except urllib.error.HTTPError as e:
                if e.code == 429:  # muitas chamadas: espera e tenta de novo
                    self._dormir(int(e.headers.get("Retry-After") or espera))
                    espera = min(espera * 2, 120)
                    continue
                if e.code == 404:  # nenhuma nota no período
                    return 404, dict(e.headers), b""
                if e.code in (401, 403):
                    raise ErroKlaus(f"Klaus recusou o token (HTTP {e.code}). Gere outro token no perfil master.") from e
                raise ErroKlaus(f"Klaus respondeu HTTP {e.code} em {sufixo or 'contagem'}") from e
        raise ErroKlaus("Klaus continua pedindo para esperar (HTTP 429)")

    def paginas(self, cnpj: str, inicio: date, fim: date, eventos: bool = False) -> int:
        """Quantas páginas há no período (0 = nenhum documento)."""
        if eventos:  # a contagem (HEAD) só existe para notas; para eventos, a 1ª página informa o total
            st, h, _ = self._pedir("GET", cnpj, "/eventos/XML", inicio, fim, 1)
        else:
            st, h, _ = self._pedir("HEAD", cnpj, "", inicio, fim, 1)
        if st == 404:
            return 0
        try:
            return max(int(h.get("X-REPO-INTERVALO-NSU-ULTIMO") or 1), 1)
        except ValueError:
            return 1

    def baixar(self, cnpj: str, inicio: date, fim: date, nsu: int, eventos: bool = False) -> bytes:
        st, _, corpo = self._pedir("GET", cnpj, "/eventos/XML" if eventos else "/XML", inicio, fim, nsu)
        if st == 404 or not corpo:
            return b""
        if corpo[:2] != b"PK":
            raise ErroKlaus("Klaus devolveu algo que não é um zip de XMLs")
        return corpo


@dataclass
class ResumoKlaus:
    loja: str
    notas: int = 0          # documentos baixados
    notas_novas: int = 0
    eventos_novos: int = 0
    paginas: int = 0
    erros: list[str] = field(default_factory=list)


def importar_loja(banco: Banco, cliente: ClienteKlaus, loja: dict, inicio: date, fim: date, pasta_local: Path) -> ResumoKlaus:
    r = ResumoKlaus(loja["apelido"])
    pasta = pasta_local / "klaus" / loja["cnpj"]
    pasta.mkdir(parents=True, exist_ok=True)
    carimbo = datetime.now().strftime("%Y%m%dT%H%M%S")
    for eventos in (False, True):
        tipo = "eventos" if eventos else "notas"
        n = cliente.paginas(loja["cnpj"], inicio, fim, eventos=eventos)
        for nsu in range(1, n + 1):
            corpo = cliente.baixar(loja["cnpj"], inicio, fim, nsu, eventos=eventos)
            if not corpo:
                continue
            r.paginas += 1
            arq = pasta / f"{carimbo}-{tipo}-{inicio:%Y%m%d}-{fim:%Y%m%d}-p{nsu}.zip"
            arq.write_bytes(corpo)
            res = importar(banco, arq, pasta_local)
            r.notas += sum(res.por_loja.values())
            r.notas_novas += res.notas_novas
            r.eventos_novos += res.eventos_novos
            r.erros += res.erros[:5]
    return r


def importar_klaus(banco: Banco, pasta_local: Path, dias: int = 7, so_loja: str | None = None,
                   cliente: ClienteKlaus | None = None, hoje: date | None = None) -> list[ResumoKlaus]:
    """Busca no Klaus as notas e eventos dos últimos `dias` dias de cada empresa e importa."""
    cliente = cliente or ClienteKlaus(token())
    hoje = hoje or date.today()
    inicio = hoje - timedelta(days=dias)
    resumos = []
    for loja in banco.lojas():
        if so_loja and loja["apelido"].lower() != so_loja.lower():
            continue
        exec_id = banco.iniciar_execucao({"loja_id": loja["id"], "maquina": socket.gethostname(), "cstat": "KLAUS"})
        try:
            r = importar_loja(banco, cliente, loja, inicio, hoje, pasta_local)
            banco.terminar_execucao(exec_id, {
                "fim": datetime.now().astimezone().isoformat(), "documentos": r.notas, "notas_novas": r.notas_novas,
                "eventos_novos": r.eventos_novos, "motivo": f"Klaus {inicio:%d/%m}–{hoje:%d/%m}: {r.paginas} página(s)",
                "erro": "; ".join(r.erros)[:500] or None})
            log.info("Klaus %s: %s notas (%s novas), %s eventos novos", loja["apelido"], r.notas, r.notas_novas, r.eventos_novos)
        except ErroKlaus as e:
            r = ResumoKlaus(loja["apelido"], erros=[str(e)])
            banco.terminar_execucao(exec_id, {"fim": datetime.now().astimezone().isoformat(), "erro": str(e)[:500]})
            log.error("Klaus %s: %s", loja["apelido"], e)
            if "token" in str(e).lower():
                resumos.append(r)
                break  # token inválido: não adianta tentar as outras
        resumos.append(r)
    return resumos
