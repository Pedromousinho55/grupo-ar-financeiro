#!/usr/bin/env bash
# Cria um banco de teste do zero, aplica as migrações e roda os testes.
set -euo pipefail
cd "$(dirname "$0")/.."
DB=financeiro_teste
sudo -u postgres dropdb --if-exists $DB
sudo -u postgres createdb $DB
run(){ sudo -u postgres psql -q -v ON_ERROR_STOP=1 -d $DB -f "$1"; }
run tests/00_simula_supabase.sql
sudo -u postgres psql -q -d $DB -c "create table if not exists public._migracoes (arquivo text primary key);"
for f in migrations/*.sql; do echo "Aplicando $f"; run "$f"; done
run tests/01_testes_etapa1.sql
run tests/02_testes_notas.sql
run tests/03_testes_contas.sql
run tests/04_testes_extratos.sql
run tests/05_testes_regras.sql
run tests/06_testes_conciliar_nota.sql
