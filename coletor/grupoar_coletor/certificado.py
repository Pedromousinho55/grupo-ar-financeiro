"""Certificado digital A1 (.pfx): leitura dos dados e contexto TLS para falar com a SEFAZ.

A senha vem do Cofre de Credenciais do Windows (ver cofre.py), nunca de arquivo.
A chave privada só existe na memória: o arquivo PEM temporário exigido pelo Python
é criado com acesso restrito e apagado imediatamente após o carregamento.
"""
from __future__ import annotations

import os
import ssl
import tempfile
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives.serialization import Encoding, NoEncryption, PrivateFormat, pkcs12

# OID usado nos certificados ICP-Brasil e-CNPJ para guardar o CNPJ
OID_CNPJ_ICP = "2.16.76.1.3.3"


@dataclass
class InfoCertificado:
    titular: str
    cnpj: str | None
    valido_de: date
    valido_ate: date
    emissor: str


def _abrir(caminho: Path, senha: str):
    try:
        return pkcs12.load_key_and_certificates(Path(caminho).read_bytes(), senha.encode("utf-8"))
    except ValueError as e:
        raise ValueError(f"Não consegui abrir {Path(caminho).name}: senha incorreta ou arquivo danificado.") from e


def _cnpj_do_certificado(cert: x509.Certificate) -> str | None:
    try:
        san = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
        for nome in san.get_values_for_type(x509.OtherName):
            if nome.type_id.dotted_string == OID_CNPJ_ICP:
                bruto = nome.value
                digitos = "".join(ch for ch in bruto.decode("latin-1", "ignore") if ch.isdigit())
                if len(digitos) >= 14:
                    return digitos[-14:]
    except x509.ExtensionNotFound:
        pass
    # alternativa: "NOME DA EMPRESA:12345678000199" no CN
    cn = cert.subject.get_attributes_for_oid(x509.NameOID.COMMON_NAME)
    if cn and ":" in cn[0].value:
        d = "".join(ch for ch in cn[0].value.split(":")[-1] if ch.isdigit())
        if len(d) == 14:
            return d
    return None


def ler_info(caminho: Path, senha: str) -> InfoCertificado:
    _, cert, _ = _abrir(caminho, senha)
    cn = cert.subject.get_attributes_for_oid(x509.NameOID.COMMON_NAME)
    emissor = cert.issuer.get_attributes_for_oid(x509.NameOID.COMMON_NAME)
    return InfoCertificado(
        titular=cn[0].value if cn else cert.subject.rfc4514_string(),
        cnpj=_cnpj_do_certificado(cert),
        valido_de=cert.not_valid_before_utc.date(),
        valido_ate=cert.not_valid_after_utc.date(),
        emissor=emissor[0].value if emissor else "",
    )


def contexto_tls(caminho: Path, senha: str, cadeia_extra: Path | None = None) -> ssl.SSLContext:
    chave, cert, intermediarios = _abrir(caminho, senha)
    ctx = ssl.create_default_context()  # no Windows usa as autoridades confiáveis do sistema
    if cadeia_extra and Path(cadeia_extra).exists():
        ctx.load_verify_locations(cafile=str(cadeia_extra))  # cadeia ICP-Brasil, se o Windows não tiver
    pem = cert.public_bytes(Encoding.PEM) + b"".join(c.public_bytes(Encoding.PEM) for c in (intermediarios or []))
    pem += chave.private_bytes(Encoding.PEM, PrivateFormat.PKCS8, NoEncryption())
    fd, temporario = tempfile.mkstemp(suffix=".pem")
    try:
        os.chmod(temporario, 0o600)
        with os.fdopen(fd, "wb") as f:
            f.write(pem)
        ctx.load_cert_chain(temporario)
    finally:
        try:
            os.remove(temporario)
        except OSError:
            pass
    return ctx
