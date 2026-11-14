"""Aplica no Supabase as migrações de supabase/migrations/ que ainda não foram aplicadas.

Uso:  python3 supabase/aplicar_migracoes.py teste|producao

Usa a API de gerenciamento do Supabase. O token de acesso NÃO fica neste código:
na sessão de desenvolvimento ele é injetado pela rede segura; em outro computador,
defina a variável SUPABASE_ACCESS_TOKEN.
"""
import json
import os
import pathlib
import sys
import urllib.request

PROJETOS = {"teste": "ijcglclttkhzygpecour", "producao": "jxbpwkbxpascynflmtxi"}
PASTA = pathlib.Path(__file__).parent / "migrations"


def sql(ref: str, query: str):
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{ref}/database/query",
        data=json.dumps({"query": query}).encode(),
        headers={"Content-Type": "application/json",
                 "Authorization": "Bearer " + os.environ.get("SUPABASE_ACCESS_TOKEN", "proxy-injected")},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read() or "[]")
    except urllib.error.HTTPError as e:
        raise SystemExit(f"ERRO do Supabase ({e.code}): {e.read().decode()}")


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in PROJETOS:
        raise SystemExit(__doc__)
    ref = PROJETOS[sys.argv[1]]
    sql(ref, "create table if not exists public._migracoes (arquivo text primary key, aplicado_em timestamptz default now());"
             "alter table public._migracoes enable row level security;")
    feitas = {r["arquivo"] for r in sql(ref, "select arquivo from public._migracoes")}
    for f in sorted(PASTA.glob("*.sql")):
        if f.name in feitas:
            print(f"já aplicada: {f.name}")
            continue
        corpo = f.read_text(encoding="utf-8")
        nome = f.name.replace("'", "''")
        # tudo numa transação: ou aplica a migração inteira, ou nada
        sql(ref, f"begin;\n{corpo}\ninsert into public._migracoes (arquivo) values ('{nome}');\ncommit;")
        print(f"APLICADA: {f.name}")


if __name__ == "__main__":
    main()
