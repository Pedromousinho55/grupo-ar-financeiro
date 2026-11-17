"""Coletor de NF-e do Grupo AR.

Comandos (rodar na pasta do coletor):
  python -m grupoar_coletor configurar     pede o caminho e a SENHA de cada certificado (vai para o cofre do Windows)
  python -m grupoar_coletor certificados   confere os certificados e envia titular/validade ao sistema
  python -m grupoar_coletor coletar        consulta a SEFAZ para todas as lojas (respeita o bloqueio de 1 hora)
  python -m grupoar_coletor coletar --loja Terra
  python -m grupoar_coletor agendar        cria as tarefas automáticas no Windows (08:10 e 14:10)
"""
from __future__ import annotations

import argparse
import getpass
import json
import logging
import subprocess
import sys
import tempfile
from datetime import date
from pathlib import Path
from xml.sax.saxutils import escape

from . import certificado, cofre
from .banco import Banco
from .coleta import coletar_loja

PASTA = Path(__file__).resolve().parent.parent
CONFIG = PASTA / "config.json"
PADRAO = {
    "supabase_url": "https://ijcglclttkhzygpecour.supabase.co",
    "supabase_chave_publica": "",
    "coletor_email": "",
    "ambiente_sefaz": "producao",
    "pasta_xml": str(PASTA.parent / "xml"),
    "cadeia_icp": str(PASTA / "cadeia_icp.pem"),
    "certificados": {},  # cnpj -> caminho do .pfx
}


def carregar_config() -> dict:
    if CONFIG.exists():
        return {**PADRAO, **json.loads(CONFIG.read_text(encoding="utf-8"))}
    return dict(PADRAO)


def salvar_config(cfg: dict) -> None:
    CONFIG.write_text(json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8")


def conectar(cfg: dict) -> Banco:
    senha = cofre.senha_coletor()
    if not (cfg["coletor_email"] and senha and cfg["supabase_chave_publica"]):
        sys.exit("Coletor não configurado. Rode: python -m grupoar_coletor configurar")
    banco = Banco(cfg["supabase_url"], cfg["supabase_chave_publica"])
    banco.entrar(cfg["coletor_email"], senha)
    return banco


def cmd_configurar(cfg: dict) -> None:
    print("== Configuração do coletor Grupo AR ==\n(As senhas vão para o Cofre de Credenciais do Windows, nunca para arquivo.)\n")
    cfg["supabase_url"] = input(f"Endereço do Supabase [{cfg['supabase_url']}]: ").strip() or cfg["supabase_url"]
    cfg["supabase_chave_publica"] = input("Chave pública do Supabase [manter]: ").strip() or cfg["supabase_chave_publica"]
    cfg["coletor_email"] = input(f"E-mail do usuário coletor [{cfg['coletor_email']}]: ").strip() or cfg["coletor_email"]
    if input("Definir/alterar a senha do usuário coletor? (s/N): ").strip().lower() == "s":
        cofre.guardar_senha_coletor(getpass.getpass("Senha do usuário coletor (não aparece ao digitar): "))
    salvar_config(cfg)
    banco = conectar(cfg)
    print("✓ Conectado ao sistema.\n")
    for loja in banco.lojas():
        atual = cfg["certificados"].get(loja["cnpj"], "")
        # os .pfx ficam em C:\GrupoAR\certificados (ao lado da pasta do projeto, fora do repositório)
        sugestao = atual or str(PASTA.parent.parent / "certificados" / f"{loja['apelido'].replace(' ', '')}.pfx")
        caminho = input(f"[{loja['apelido']}] arquivo .pfx [{sugestao}] (ou '-' para pular): ").strip() or sugestao
        if caminho == "-":
            continue
        if not Path(caminho).exists():
            print(f"  ✗ arquivo não encontrado: {caminho}")
            continue
        for tentativa in range(3):
            senha = getpass.getpass(f"  Senha do certificado da {loja['apelido']} (não aparece ao digitar): ")
            try:
                info = certificado.ler_info(Path(caminho), senha)
            except ValueError as e:
                print(f"  ✗ {e}")
                continue
            if info.cnpj and info.cnpj != loja["cnpj"]:
                print(f"  ✗ Este certificado é do CNPJ {info.cnpj}, não da {loja['apelido']} ({loja['cnpj']}). Não foi salvo.")
                break
            cofre.guardar_senha_certificado(loja["cnpj"], senha)
            cfg["certificados"][loja["cnpj"]] = caminho
            salvar_config(cfg)
            print(f"  ✓ {info.titular} — válido até {info.valido_ate:%d/%m/%Y}. Senha guardada no cofre do Windows.")
            break
    print("\nConfiguração concluída. Próximo passo: python -m grupoar_coletor certificados")


def _certificados(cfg: dict, banco: Banco):
    for loja in banco.lojas():
        caminho = cfg["certificados"].get(loja["cnpj"])
        senha = cofre.senha_certificado(loja["cnpj"])
        if not caminho or not senha:
            yield loja, None, None, "sem certificado configurado"
            continue
        try:
            yield loja, Path(caminho), senha, None
        except Exception as e:  # pragma: no cover
            yield loja, None, None, str(e)


def cmd_certificados(cfg: dict) -> None:
    banco = conectar(cfg)
    for loja, caminho, senha, problema in _certificados(cfg, banco):
        if problema:
            print(f"- {loja['apelido']}: {problema}")
            continue
        info = certificado.ler_info(caminho, senha)
        banco.salvar_certificado({
            "loja_id": loja["id"], "titular": info.titular, "cnpj_certificado": info.cnpj,
            "valido_de": info.valido_de.isoformat(), "valido_ate": info.valido_ate.isoformat(),
        })
        print(f"✓ {loja['apelido']}: {info.titular} — válido até {info.valido_ate:%d/%m/%Y} (emissor {info.emissor})")


def cmd_coletar(cfg: dict, so_loja: str | None, ambiente: str) -> None:
    banco = conectar(cfg)
    pasta_local = Path(cfg["pasta_xml"])
    for loja, caminho, senha, problema in _certificados(cfg, banco):
        if so_loja and loja["apelido"].lower() != so_loja.lower():
            continue
        if problema:
            logging.warning("%s: %s", loja["apelido"], problema)
            continue
        ctx = certificado.contexto_tls(caminho, senha, Path(cfg["cadeia_icp"]))
        r = coletar_loja(banco, loja, ctx, pasta_local, ambiente)
        logging.info("Resultado: %s", r)


TAREFAS = (("GrupoAR-Coletor-manha", "08:10"), ("GrupoAR-Coletor-tarde", "14:10"))


def xml_tarefa(hora: str, python: Path, pasta: Path) -> str:
    """Definição da tarefa do Agendador do Windows. Além do horário diário:
    - StartWhenAvailable: se o PC estava desligado/dormindo no horário, roda assim que ligar;
    - roda também na bateria (notebook) e não é interrompida ao tirar da tomada;
    - não abre duas coletas ao mesmo tempo e encerra se passar de 1 hora."""
    inicio = f"{date.today().isoformat()}T{hora}:00"
    return f"""<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>Coletor de NF-e do Grupo AR (somente leitura na SEFAZ)</Description></RegistrationInfo>
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>{inicio}</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay>
    </CalendarTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author"><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <ExecutionTimeLimit>PT1H</ExecutionTimeLimit>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>{escape(str(python))}</Command>
      <Arguments>-m grupoar_coletor coletar</Arguments>
      <WorkingDirectory>{escape(str(pasta))}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"""


def cmd_agendar() -> None:
    python = Path(sys.executable).with_name("pythonw.exe")
    if not python.exists():
        python = Path(sys.executable)
    with tempfile.TemporaryDirectory() as tmp:
        for nome, hora in TAREFAS:
            arq = Path(tmp) / f"{nome}.xml"
            arq.write_text(xml_tarefa(hora, python, PASTA), encoding="utf-16")
            subprocess.run(["schtasks", "/Create", "/F", "/TN", nome, "/XML", str(arq)], check=True)
            print(f"✓ Tarefa {nome} agendada para {hora} todos os dias (se o PC estiver desligado, roda ao ligar)")


def main() -> None:
    p = argparse.ArgumentParser(prog="grupoar_coletor", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="comando", required=True)
    sub.add_parser("configurar")
    sub.add_parser("certificados")
    c = sub.add_parser("coletar")
    c.add_argument("--loja")
    c.add_argument("--homologacao", action="store_true", help="usa o ambiente de testes da SEFAZ")
    sub.add_parser("agendar")
    a = p.parse_args()

    (PASTA / "logs").mkdir(exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=[logging.FileHandler(PASTA / "logs" / "coletor.log", encoding="utf-8"), logging.StreamHandler()],
    )
    cfg = carregar_config()
    if a.comando == "configurar":
        cmd_configurar(cfg)
    elif a.comando == "certificados":
        cmd_certificados(cfg)
    elif a.comando == "coletar":
        cmd_coletar(cfg, a.loja, "homologacao" if a.homologacao else cfg["ambiente_sefaz"])
    elif a.comando == "agendar":
        cmd_agendar()


if __name__ == "__main__":
    main()
