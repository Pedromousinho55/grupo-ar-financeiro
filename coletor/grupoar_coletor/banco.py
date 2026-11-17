"""Gravação no Supabase com o usuário próprio do coletor (papel 'coletor').

O coletor entra com e-mail e senha (senha no cofre do Windows) e só tem permissão
para gravar notas, eventos, controle da SEFAZ e dados dos certificados.
"""
from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request


class ErroBanco(RuntimeError):
    pass


class Banco:
    def __init__(self, url: str, chave_publica: str):
        self.url = url.rstrip("/")
        self.chave = chave_publica
        self.token: str | None = None

    def _pedir(self, metodo: str, caminho: str, corpo=None, cabecalhos: dict | None = None, bruto: bytes | None = None):
        h = {"apikey": self.chave}
        if self.token:
            h["Authorization"] = f"Bearer {self.token}"
        if corpo is not None:
            h["Content-Type"] = "application/json"
        h.update(cabecalhos or {})
        dados = bruto if bruto is not None else (json.dumps(corpo, default=str).encode() if corpo is not None else None)
        req = urllib.request.Request(self.url + caminho, data=dados, headers=h, method=metodo)
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                texto = r.read()
                return json.loads(texto) if texto else None
        except urllib.error.HTTPError as e:
            raise ErroBanco(f"{metodo} {caminho}: HTTP {e.code} {e.read()[:400]!r}") from e

    def entrar(self, email: str, senha: str) -> None:
        r = self._pedir("POST", "/auth/v1/token?grant_type=password", {"email": email, "password": senha})
        self.token = r["access_token"]

    # ---------- leitura ----------
    def lojas(self) -> list[dict]:
        return self._pedir("GET", "/rest/v1/lojas?select=id,apelido,cnpj&ativo=eq.true&order=apelido")

    def controle(self, loja_id: str) -> dict | None:
        r = self._pedir("GET", f"/rest/v1/sefaz_controle?loja_id=eq.{loja_id}")
        return r[0] if r else None

    def notas_existentes(self, chaves: list[str]) -> dict[str, dict]:
        if not chaves:
            return {}
        lista = ",".join(chaves)
        r = self._pedir("GET", f"/rest/v1/notas_fiscais?select=chave,tipo_documento,xml_arquivo&chave=in.({lista})")
        return {n["chave"]: n for n in r}

    # ---------- escrita ----------
    def salvar_controle(self, dados: dict) -> None:
        self._pedir("POST", "/rest/v1/sefaz_controle?on_conflict=loja_id", dados,
                    {"Prefer": "resolution=merge-duplicates,return=minimal"})

    def incluir_nota(self, dados: dict) -> None:
        self._pedir("POST", "/rest/v1/notas_fiscais", dados, {"Prefer": "return=minimal"})

    def atualizar_nota(self, chave: str, dados: dict) -> None:
        self._pedir("PATCH", f"/rest/v1/notas_fiscais?chave=eq.{chave}", dados, {"Prefer": "return=minimal"})

    def incluir_evento(self, dados: dict) -> bool:
        try:
            self._pedir("POST", "/rest/v1/eventos_nfe?on_conflict=chave,tipo_evento,sequencia", dados,
                        {"Prefer": "resolution=ignore-duplicates,return=minimal"})
            return True
        except ErroBanco as e:
            if "409" in str(e):
                return False
            raise

    def salvar_certificado(self, dados: dict) -> None:
        self._pedir("POST", "/rest/v1/certificados?on_conflict=loja_id", dados,
                    {"Prefer": "resolution=merge-duplicates,return=minimal"})

    def iniciar_execucao(self, dados: dict) -> int:
        r = self._pedir("POST", "/rest/v1/coletor_execucoes", dados, {"Prefer": "return=representation"})
        return r[0]["id"]

    def terminar_execucao(self, id_execucao: int, dados: dict) -> None:
        self._pedir("PATCH", f"/rest/v1/coletor_execucoes?id=eq.{id_execucao}", dados, {"Prefer": "return=minimal"})

    def enviar_arquivo(self, caminho: str, conteudo: bytes, tipo: str = "application/xml") -> bool:
        """Envia ao bucket privado. Se o arquivo já existir, mantém o que está lá (guarda legal)."""
        try:
            self._pedir("POST", f"/storage/v1/object/notas-xml/{urllib.parse.quote(caminho)}", bruto=conteudo,
                        cabecalhos={"Content-Type": tipo, "x-upsert": "false"})
            return True
        except ErroBanco as e:
            if "409" in str(e) or "Duplicate" in str(e) or "already exists" in str(e):
                return False
            raise
