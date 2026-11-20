-- Testes da Etapa 4 (extratos e conciliação). Roda depois de 03_testes_contas.sql.
-- Pedro = master (…01), Marcio = lançador (…02), Eduardo = consulta (…04).
\set ON_ERROR_STOP on
set client_min_messages = warning;

create or replace function pg_temp.entrar(uid text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', uid, false); end $$;
create or replace function pg_temp.erro_de(cmd text) returns text language plpgsql as $$
begin execute cmd; return null; exception when others then return sqlerrm; end $$;

create temp table ids2 (nome text primary key, id uuid);
grant all on ids2 to authenticated;
insert into ids2 values
  ('terra', (select id from public.lojas where apelido = 'Terra')),
  ('banco', (select id from public.contas_bancarias where descricao = 'Santander Terra')),
  ('plano', (select id from public.plano_contas order by ordem_codigo nulls last limit 1));
update public.contas_bancarias set saldo_inicial = 1000, data_saldo_inicial = '2026-10-31' where id = (select id from ids2 where nome = 'banco');

-- contas a pagar de apoio (lançadas como sistema)
insert into public.contas_pagar (loja_id, descricao, plano_conta_id, competencia, vencimento, valor, status)
select (select id from ids2 where nome = 'terra'), d, (select id from ids2 where nome = 'plano'), '2026-11-01', v::date, val, s::public.status_conta
from (values ('Boleto Hortifruti', '2026-11-10', 339.00, 'aprovada'),
             ('Energia', '2026-11-12', 500.00, 'a_aprovar')) as t(d, v, val, s);
insert into ids2 values
  ('conta_horti', (select id from public.contas_pagar where descricao = 'Boleto Hortifruti')),
  ('conta_energia', (select id from public.contas_pagar where descricao = 'Energia'));

-- 1) Lançador importa um extrato; a mesma transação (FITID) não entra duas vezes
select pg_temp.entrar('00000000-0000-0000-0000-000000000002');
set role authenticated;
insert into public.extrato_importacoes (conta_bancaria_id, arquivo_nome, periodo_inicio, periodo_fim, saldo_final, saldo_data, linhas_novas)
values ((select id from ids2 where nome = 'banco'), 'extrato.ofx', '2026-11-01', '2026-11-15', 2161.00, '2026-11-15', 4);
insert into public.extrato_lancamentos (conta_bancaria_id, fitid, data, valor, descricao)
select (select id from ids2 where nome = 'banco'), f, d::date, v, m
from (values ('F1', '2026-11-10', -339.00, 'PAGAMENTO DE BOLETO HORTI'),
             ('F2', '2026-11-12', -500.00, 'DEBITO AUT ENERGIA'),
             ('F3', '2026-11-13', -12.50, 'TARIFA PACOTE'),
             ('F4', '2026-11-14', 2012.50, 'PIX RECEBIDO EVENTO')) as t(f, d, v, m);
do $$ begin
  assert pg_temp.erro_de(format($f$insert into public.extrato_lancamentos (conta_bancaria_id, fitid, data, valor) values (%L, 'F1', '2026-11-10', -339)$f$,
    (select id from ids2 where nome = 'banco'))) is not null, 'FITID repetido deveria ser recusado';
  assert pg_temp.erro_de(format($f$insert into public.extrato_lancamentos (conta_bancaria_id, fitid, data, valor, conciliado, tipo_conciliacao, plano_conta_id)
    values (%L, 'F9', '2026-11-10', 5, true, 'receita', %L)$f$, (select id from ids2 where nome = 'banco'), (select id from ids2 where nome = 'plano'))) is not null,
    'linha não pode nascer conciliada';
end $$;
reset role;
\echo 'OK E1 - extrato importado; a mesma transação do banco não entra duas vezes'

-- 2) Dados do banco não mudam; ligar a conta só pela função
select pg_temp.entrar('00000000-0000-0000-0000-000000000002');
set role authenticated;
do $$ begin
  assert pg_temp.erro_de($f$update public.extrato_lancamentos set valor = -1 where fitid = 'F1'$f$) like '%não podem ser alterados%', 'valor do extrato é fixo';
  assert pg_temp.erro_de(format($f$update public.extrato_lancamentos set conciliado = true, tipo_conciliacao = 'conta_pagar', conta_pagar_id = %L where fitid = 'F1'$f$,
    (select id from ids2 where nome = 'conta_horti'))) like '%Conciliar com conta a pagar%', 'ligar conta só pela função';
end $$;
reset role;
\echo 'OK E2 - dados do banco são fixos; ligar a conta a pagar só pela conciliação'

-- 3) Lançador concilia saída com conta aprovada: a conta vira paga com data/valor do banco
select pg_temp.entrar('00000000-0000-0000-0000-000000000002');
set role authenticated;
select public.conciliar_com_conta((select id from public.extrato_lancamentos where fitid = 'F1'), (select id from ids2 where nome = 'conta_horti'));
do $$ begin
  assert pg_temp.erro_de(format($f$select public.conciliar_com_conta(%L, %L)$f$,
    (select id from public.extrato_lancamentos where fitid = 'F2'), (select id from ids2 where nome = 'conta_energia'))) like '%não aprovada%',
    'lançador não concilia conta a aprovar';
end $$;
reset role;
do $$ begin
  assert (select status from public.contas_pagar where descricao = 'Boleto Hortifruti') = 'paga', 'conta paga pela conciliação';
  assert (select pago_em from public.contas_pagar where descricao = 'Boleto Hortifruti') = '2026-11-10', 'data do banco';
  assert (select pago_por from public.contas_pagar where descricao = 'Boleto Hortifruti') = '00000000-0000-0000-0000-000000000002', 'quem conciliou';
  assert (select conciliado from public.extrato_lancamentos where fitid = 'F1'), 'linha conciliada';
end $$;
\echo 'OK E3 - saída conciliada com conta aprovada vira pagamento; conta "a aprovar" só o master'

-- 4) Master concilia conta "a aprovar" (vale como aprovação)
select pg_temp.entrar('00000000-0000-0000-0000-000000000001');
set role authenticated;
select public.conciliar_com_conta((select id from public.extrato_lancamentos where fitid = 'F2'), (select id from ids2 where nome = 'conta_energia'));
reset role;
do $$ begin
  assert (select status from public.contas_pagar where descricao = 'Energia') = 'paga', 'master concilia a aprovar';
  assert (select aprovada_por from public.contas_pagar where descricao = 'Energia') = '00000000-0000-0000-0000-000000000001', 'aprovação registrada';
end $$;
\echo 'OK E4 - master concilia conta ainda "a aprovar", valendo como aprovação'

-- 4b) Pagamento conciliado não é estornado pela tela da conta
select pg_temp.entrar('00000000-0000-0000-0000-000000000001');
set role authenticated;
do $$ begin
  assert pg_temp.erro_de($f$update public.contas_pagar set status = 'aprovada' where descricao = 'Energia'$f$) like '%desfaça a conciliação%', 'estorno bloqueado';
end $$;
reset role;
\echo 'OK E4b - pagamento conciliado só é desfeito pela conciliação'

-- 5) Saída sem conta (tarifa): cria conta a pagar já paga; entrada classificada como receita
select pg_temp.entrar('00000000-0000-0000-0000-000000000002');
set role authenticated;
select public.conciliar_criando_conta((select id from public.extrato_lancamentos where fitid = 'F3'), (select id from ids2 where nome = 'plano'), 'Tarifa bancária');
update public.extrato_lancamentos set conciliado = true, tipo_conciliacao = 'receita', plano_conta_id = (select id from ids2 where nome = 'plano')
  where fitid = 'F4';
do $$ begin
  assert pg_temp.erro_de(format($f$select public.conciliar_criando_conta(%L, %L, 'x')$f$,
    (select id from public.extrato_lancamentos where fitid = 'F4'), (select id from ids2 where nome = 'plano'))) is not null, 'entrada não vira conta a pagar';
end $$;
reset role;
do $$ begin
  assert (select status from public.contas_pagar where descricao = 'Tarifa bancária') = 'paga', 'tarifa vira conta paga';
  assert (select origem_extrato and valor = 12.50 and pago_em = '2026-11-13' from public.contas_pagar where descricao = 'Tarifa bancária'), 'dados da linha';
  assert (select conciliado_por from public.extrato_lancamentos where fitid = 'F4') = '00000000-0000-0000-0000-000000000002', 'quem classificou a receita';
end $$;
\echo 'OK E5 - saída sem conta vira conta a pagar já paga; entrada classificada como receita'

-- 6) Lançador não desfaz; master desfaz: conta criada é cancelada, conta paga volta a aprovada
select pg_temp.entrar('00000000-0000-0000-0000-000000000002');
set role authenticated;
do $$ begin
  assert pg_temp.erro_de(format($f$select public.desfazer_conciliacao(%L)$f$, (select id from public.extrato_lancamentos where fitid = 'F1'))) like '%Só o master%', 'lançador não desfaz';
  assert pg_temp.erro_de($f$update public.extrato_lancamentos set conciliado = false where fitid = 'F4'$f$) like '%Só o master%', 'lançador não desfaz receita';
end $$;
reset role;
select pg_temp.entrar('00000000-0000-0000-0000-000000000001');
set role authenticated;
select public.desfazer_conciliacao((select id from public.extrato_lancamentos where fitid = 'F1'));
select public.desfazer_conciliacao((select id from public.extrato_lancamentos where fitid = 'F3'));
reset role;
do $$ begin
  assert (select status from public.contas_pagar where descricao = 'Boleto Hortifruti') = 'aprovada', 'conta volta a aprovada';
  assert (select pago_em is null from public.contas_pagar where descricao = 'Boleto Hortifruti'), 'baixa desfeita';
  assert (select status from public.contas_pagar where descricao = 'Tarifa bancária') = 'cancelada', 'conta criada pela conciliação é cancelada';
  assert (select not conciliado and conta_pagar_id is null from public.extrato_lancamentos where fitid = 'F1'), 'linha volta a pendente';
end $$;
\echo 'OK E6 - só o master desfaz; conta criada é cancelada e conta paga volta para "Aprovada"'

-- 7) Saldo calculado = saldo inicial + movimentos após a data do saldo; comparação com o banco
do $$ declare s record; begin
  select * into s from public.saldos_contas where descricao = 'Santander Terra';
  assert s.saldo_calculado = 1000 - 339 - 500 - 12.50 + 2012.50, 'saldo calculado';
  assert s.saldo_banco = 2161.00, 'saldo informado pelo banco';
  assert s.pendentes = 2, 'duas linhas pendentes (F1 e F3)';
end $$;
\echo 'OK E7 - saldo calculado confere com o saldo do banco; pendências contadas'

-- 8) Consulta só vê; ninguém apaga extrato
select pg_temp.entrar('00000000-0000-0000-0000-000000000004');
set role authenticated;
do $$ declare n int; begin
  select count(*) into n from public.extrato_lancamentos;
  assert n = 4, 'consulta vê o extrato';
  assert pg_temp.erro_de(format($f$select public.conciliar_criando_conta(%L, %L, 'x')$f$,
    (select id from public.extrato_lancamentos where fitid = 'F3'), (select id from ids2 where nome = 'plano'))) like '%permissão%', 'consulta não concilia';
end $$;
reset role;
select pg_temp.entrar('00000000-0000-0000-0000-000000000001');
set role authenticated;
do $$ begin
  assert pg_temp.erro_de($f$delete from public.extrato_lancamentos$f$) is not null, 'ninguém apaga extrato';
end $$;
reset role;
\echo 'OK E8 - consulta só vê; extrato não pode ser apagado'

\echo '>>> TODOS OS TESTES DE EXTRATOS E CONCILIAÇÃO PASSARAM'
