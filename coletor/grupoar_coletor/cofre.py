"""Senhas no Cofre de Credenciais do Windows (Gerenciador de Credenciais), via 'keyring'.

Nenhuma senha fica em arquivo ou no código. Para ver/apagar: Painel de Controle >
Gerenciador de Credenciais > Credenciais do Windows > "GrupoAR-Coletor".
"""
import keyring

SERVICO = "GrupoAR-Coletor"


def _nome_certificado(cnpj: str) -> str:
    return f"certificado-{cnpj}"


def guardar_senha_certificado(cnpj: str, senha: str) -> None:
    keyring.set_password(SERVICO, _nome_certificado(cnpj), senha)


def senha_certificado(cnpj: str) -> str | None:
    return keyring.get_password(SERVICO, _nome_certificado(cnpj))


def guardar_senha_coletor(senha: str) -> None:
    keyring.set_password(SERVICO, "supabase-coletor", senha)


def senha_coletor() -> str | None:
    return keyring.get_password(SERVICO, "supabase-coletor")
