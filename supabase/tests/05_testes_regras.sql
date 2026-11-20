-- Testes das regras de conciliação. Roda depois de 04_testes_extratos.sql.
-- Pedro = master (…01), Marcio = lançador (…02).
\set ON_ERROR_STOP on
set client_min_messages = warning;

create or replace function pg_temp.entrar(uid text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', uid, false); end $$;
create or replace function pg_temp.erro_de(cmd text) returns text language plpgsql as $$
begin execute cmd; return null; exception when others then return sqlerrm; end $$;

create temp table ids3 (nome text primary key, id uuid);
grant all on ids3 to authenticated;
insert into ids3 values
  ('banco', (select id from public.contas_bancarias where descricao = 'Santander Terra')),
  ('plano', (select id from public.plano_contas order by ordem_codigo nulls last limit 1));
insert into public.extrato_lancamentos (conta_bancaria_id, fitid, data, valor, descricao)
select (select id from ids3 where nome = 'banco'), f, '2026-11-16', v, m
from (values ('R1', -1000.00, 'APLICACAO CONTAMAX'),
             ('R2',   -7.90, 'TARIFA AVULSA ENVIO PIX'),
             ('R3',   -8.10, 'TARIFA PIX RECEBIDO QR CHECKOUT'),
             ('R4',  350.00, 'PAGAMENTO CARTAO DE DEBITO · GETNET'),
             ('R5', -250.00, 'PIX ENVIADO · FORNECEDOR QUALQUER')) as t(f, v, m);

-- 1) Só o master cria regras
select pg_temp.entrar('00000000-0000-0000-0000-000000000002');
set role authenticated;
do $$ begin
  assert pg_temp.erro_de($f$insert into public.regras_conciliacao (nome, texto, acao) values ('x', 'APLICACAO', 'transferencia')$f$) is not null, 'lançador não cria regra';
end $$;
reset role;
select pg_temp.entrar('00000000-0000-0000-0000-000000000001');
set role authenticated;
insert into public.regras_conciliacao (nome, texto, acao, automatica) values ('Contamax', 'APLICACAO CONTAMAX', 'transferencia', true);
insert into public.regras_conciliacao (nome, texto, modo_texto, sentido, acao, plano_conta_id, automatica)
  values ('Tarifas', 'TARIFA', 'comeca', 'saida', 'conta_pagar', (select id from ids3 where nome = 'plano'), true);
insert into public.regras_conciliacao (nome, texto, modo_texto, sentido, acao, plano_conta_id, automatica)
  values ('Cartão débito', 'CARTAO DE DEBITO', 'contem', 'entrada', 'receita', (select id from ids3 where nome = 'plano'), false);
do $$ begin
  assert pg_temp.erro_de(format($f$insert into public.regras_conciliacao (nome, texto, sentido, acao, plano_conta_id) values ('x', 'y', 'entrada', 'conta_pagar', %L)$f$,
    (select id from ids3 where nome = 'plano'))) is not null, 'conta a pagar só para saída';
end $$;
reset role;
\echo 'OK R1 - só o master cria regras; regra incoerente é recusada'

-- 2) Lançador roda as automáticas: Contamax e as duas tarifas; a de cartão só sugere; o PIX fica
select pg_temp.entrar('00000000-0000-0000-0000-000000000002');
set role authenticated;
do $$ declare n int; begin
  n := public.aplicar_regras_automaticas((select id from ids3 where nome = 'banco'));
  -- 4 = Contamax + 2 tarifas daqui + a "TARIFA PACOTE" que ficou pendente no teste 04
  assert n = 4, format('4 linhas automáticas, veio %s', n);
end $$;
reset role;
do $$ begin
  assert (select tipo_conciliacao from public.extrato_lancamentos where fitid = 'R1') = 'transferencia', 'Contamax = transferência';
  assert (select count(*) from public.contas_pagar c join public.extrato_lancamentos e on e.conta_pagar_id = c.id
          where e.fitid in ('R2', 'R3') and c.status = 'paga' and c.origem_extrato) = 2, 'tarifas viram contas pagas';
  assert (select not conciliado from public.extrato_lancamentos where fitid = 'R4'), 'regra que só sugere não concilia';
  assert (select not conciliado from public.extrato_lancamentos where fitid = 'R5'), 'linha sem regra fica pendente';
  assert (select regra_id is not null from public.extrato_lancamentos where fitid = 'R1'), 'guarda a regra usada';
end $$;
\echo 'OK R2 - regras automáticas conciliam sozinhas; as de sugestão esperam confirmação'

-- 3) Confirmar sugestão; regra que não vale para a linha é recusada
select pg_temp.entrar('00000000-0000-0000-0000-000000000002');
set role authenticated;
select public.aplicar_regra((select id from public.extrato_lancamentos where fitid = 'R4'), (select id from public.regras_conciliacao where nome = 'Cartão débito'));
do $$ begin
  assert pg_temp.erro_de(format($f$select public.aplicar_regra(%L, %L)$f$,
    (select id from public.extrato_lancamentos where fitid = 'R5'), (select id from public.regras_conciliacao where nome = 'Contamax'))) like '%não vale%',
    'regra errada para a linha';
end $$;
reset role;
do $$ begin
  assert (select tipo_conciliacao from public.extrato_lancamentos where fitid = 'R4') = 'receita', 'sugestão confirmada vira receita';
end $$;
\echo 'OK R3 - sugestão de regra confirmada; regra que não bate é recusada'

-- 4) Prioridade, faixa de valor e conta específica
select pg_temp.entrar('00000000-0000-0000-0000-000000000001');
set role authenticated;
insert into public.regras_conciliacao (nome, texto, modo_texto, sentido, valor_max, acao, automatica, prioridade, conta_bancaria_id)
  values ('PIX pequeno Terra', 'PIX ENVIADO', 'comeca', 'saida', 100, 'transferencia', true, 10, (select id from ids3 where nome = 'banco'));
reset role;
do $$ declare r public.regras_conciliacao; l public.extrato_lancamentos; begin
  select * into r from public.regras_conciliacao where nome = 'PIX pequeno Terra';
  select * into l from public.extrato_lancamentos where fitid = 'R5';
  assert not public.regra_bate(r, l), 'R$ 250 passa do limite de R$ 100';
end $$;
\echo 'OK R4 - faixa de valor e conta da regra são respeitadas'

-- 5) Desfazer limpa a regra; apagar regra não apaga a conciliação feita
select pg_temp.entrar('00000000-0000-0000-0000-000000000001');
set role authenticated;
update public.extrato_lancamentos set conciliado = false where fitid = 'R4';
delete from public.regras_conciliacao where nome = 'Contamax';
reset role;
do $$ begin
  assert (select regra_id is null and not conciliado from public.extrato_lancamentos where fitid = 'R4'), 'desfazer limpa a regra';
  assert (select conciliado and regra_id is null from public.extrato_lancamentos where fitid = 'R1'), 'conciliação continua sem a regra';
end $$;
\echo 'OK R5 - desfazer limpa a regra; apagar a regra mantém a conciliação'

\echo '>>> TODOS OS TESTES DE REGRAS PASSARAM'
