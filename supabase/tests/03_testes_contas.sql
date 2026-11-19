-- Testes da Etapa 3 (contas a pagar). Roda depois de 02_testes_notas.sql (usa usuários e notas de lá).
-- Pedro = master (…01), Marcio = lançador (…02), Eduardo = consulta (…04).
\set ON_ERROR_STOP on
set client_min_messages = warning;

create or replace function pg_temp.entrar(uid text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', uid, false); end $$;
-- executa um comando e devolve a mensagem de erro (ou null se deu certo)
create or replace function pg_temp.erro_de(cmd text) returns text language plpgsql as $$
begin execute cmd; return null; exception when others then return sqlerrm; end $$;

-- nota própria destes testes (as do arquivo 02 terminam canceladas)
insert into public.notas_fiscais (chave, destinatario_cnpj, emitente_cnpj, emitente_nome, numero, valor_total, tipo_documento)
values ('26261141244765000154550010003000011000000011', '60543245000197', '41244765000154', 'A & A COMERCIAL', '300001', 1234.56, 'completa');
insert into public.contas_bancarias (loja_id, descricao, agencia, conta)
  select id, 'Santander Terra', '1234', '13000001' from public.lojas where apelido = 'Terra';
create temp table ids (nome text primary key, id uuid);
grant all on ids to authenticated;
insert into ids values
  ('terra', (select id from public.lojas where apelido = 'Terra')),
  ('plano', (select id from public.plano_contas order by ordem_codigo nulls last limit 1)),
  ('banco', (select id from public.contas_bancarias where descricao = 'Santander Terra')),
  ('nota',  (select id from public.notas_fiscais where numero = '300001'));

-- 1) Lançador lança 2 parcelas de uma nota: nascem "a aprovar", herdam loja/fornecedor, nota vira "lançada"
select pg_temp.entrar('00000000-0000-0000-0000-000000000002');
set role authenticated;
insert into public.contas_pagar (nota_id, descricao, documento, parcela, plano_conta_id, competencia, vencimento, valor, status)
select (select id from ids where nome = 'nota'), 'NF-e 300001 · A & A', '300001', p, (select id from ids where nome = 'plano'),
       '2026-11-10', v::date, 617.28, 'paga'   -- tenta já nascer paga: o banco ignora
from (values ('1/2', '2026-12-10'), ('2/2', '2027-01-10')) as t(p, v);
reset role;
do $$ begin
  assert (select count(*) from public.contas_pagar where status = 'a_aprovar') = 2, 'lançamento do lançador nasce a aprovar';
  assert (select count(*) from public.contas_pagar where loja_id is not null and fornecedor_id is not null) = 2, 'herda loja e fornecedor da nota';
  assert (select criado_por from public.contas_pagar limit 1) = '00000000-0000-0000-0000-000000000002', 'registra quem lançou';
  assert (select status from public.notas_fiscais where numero = '300001') = 'lancada', 'nota deve ficar lançada';
end $$;
\echo 'OK C1 - lançador lança parcelas da nota: a aprovar, ligadas à loja/fornecedor, nota fica "Lançada"'

-- 2) A mesma parcela da mesma nota não entra duas vezes
select pg_temp.entrar('00000000-0000-0000-0000-000000000002');
set role authenticated;
do $$ begin
  assert pg_temp.erro_de(format($f$insert into public.contas_pagar (nota_id, descricao, parcela, plano_conta_id, competencia, vencimento, valor)
    values (%L, 'repetida', '1/2', %L, '2026-11-10', '2026-12-10', 1)$f$,
    (select id from ids where nome = 'nota'), (select id from ids where nome = 'plano'))) is not null, 'parcela repetida deveria ser recusada';
end $$;
reset role;
\echo 'OK C2 - a mesma parcela da mesma nota não é lançada duas vezes'

-- 3) Lançador não aprova nem paga conta não aprovada
select pg_temp.entrar('00000000-0000-0000-0000-000000000002');
set role authenticated;
do $$ begin
  assert pg_temp.erro_de($f$update public.contas_pagar set status = 'aprovada' where parcela = '1/2'$f$) like '%master aprova%', 'lançador não aprova';
  assert pg_temp.erro_de(format($f$update public.contas_pagar set status = 'paga', pago_em = '2026-12-10', valor_pago = 617.28, conta_bancaria_id = %L where parcela = '1/2'$f$,
    (select id from ids where nome = 'banco'))) like '%aprovadas podem ser pagas%', 'não paga sem aprovação';
end $$;
reset role;
\echo 'OK C3 - lançador não aprova e não paga conta sem aprovação'

-- 4) Master aprova; lançador dá baixa (sem conta bancária é recusado)
select pg_temp.entrar('00000000-0000-0000-0000-000000000001');
set role authenticated;
update public.contas_pagar set status = 'aprovada' where nota_id is not null;
reset role;
select pg_temp.entrar('00000000-0000-0000-0000-000000000002');
set role authenticated;
do $$ begin
  assert pg_temp.erro_de($f$update public.contas_pagar set status = 'paga', pago_em = '2026-12-10', valor_pago = 617.28 where parcela = '1/2'$f$) is not null,
    'baixa sem conta bancária deveria ser recusada';
end $$;
update public.contas_pagar set status = 'paga', pago_em = '2026-12-10', valor_pago = 620.00, conta_bancaria_id = (select id from ids where nome = 'banco')
  where parcela = '1/2';
reset role;
do $$ begin
  assert (select aprovada_por from public.contas_pagar where parcela = '1/2') = '00000000-0000-0000-0000-000000000001', 'registra quem aprovou';
  assert (select pago_por from public.contas_pagar where parcela = '1/2') = '00000000-0000-0000-0000-000000000002', 'registra quem deu baixa';
  assert (select status from public.contas_pagar where parcela = '1/2') = 'paga', 'conta paga';
end $$;
\echo 'OK C4 - master aprova; lançador dá baixa com data, valor e conta bancária'

-- 5) Conta paga: lançador anexa comprovante, mas não muda valor nem baixa, nem cancela
select pg_temp.entrar('00000000-0000-0000-0000-000000000002');
set role authenticated;
update public.contas_pagar set comprovante_arquivo = 'x/2026/12/c.pdf' where parcela = '1/2';
do $$ begin
  assert pg_temp.erro_de($f$update public.contas_pagar set valor = 1 where parcela = '1/2'$f$) like '%paga não pode%', 'valor de conta paga não muda';
  assert pg_temp.erro_de($f$update public.contas_pagar set valor_pago = 1 where parcela = '1/2'$f$) like '%master pode corrigir%', 'lançador não corrige baixa';
  assert pg_temp.erro_de($f$update public.contas_pagar set status = 'cancelada', motivo_cancelamento = 'x' where parcela = '1/2'$f$) like '%estorne%', 'paga não cancela';
  assert pg_temp.erro_de($f$update public.contas_pagar set status = 'aprovada' where parcela = '1/2'$f$) like '%master pode estornar%', 'lançador não estorna';
end $$;
reset role;
do $$ begin
  assert (select comprovante_arquivo from public.contas_pagar where parcela = '1/2') = 'x/2026/12/c.pdf', 'comprovante anexado';
end $$;
\echo 'OK C5 - conta paga fica travada; lançador só anexa comprovante'

-- 6) Lançador altera valor de conta aprovada: volta para "a aprovar"
select pg_temp.entrar('00000000-0000-0000-0000-000000000002');
set role authenticated;
update public.contas_pagar set valor = 700 where parcela = '2/2';
reset role;
do $$ begin
  assert (select status from public.contas_pagar where parcela = '2/2') = 'a_aprovar', 'alteração do lançador exige nova aprovação';
  assert (select aprovada_por from public.contas_pagar where parcela = '2/2') is null, 'aprovação anterior é desfeita';
end $$;
\echo 'OK C6 - conta aprovada alterada pelo lançador volta para a aprovação do master'

-- 7) Cancelamento: exige motivo; lançador cancela a dele "a aprovar"; master estorna e reabre
select pg_temp.entrar('00000000-0000-0000-0000-000000000002');
set role authenticated;
do $$ begin
  assert pg_temp.erro_de($f$update public.contas_pagar set status = 'cancelada' where parcela = '2/2'$f$) is not null, 'cancelar sem motivo é recusado';
end $$;
update public.contas_pagar set status = 'cancelada', motivo_cancelamento = 'lançada em dobro' where parcela = '2/2';
do $$ begin
  assert pg_temp.erro_de($f$update public.contas_pagar set valor = 1 where parcela = '2/2'$f$) like '%cancelada não pode%', 'cancelada é travada';
end $$;
reset role;
select pg_temp.entrar('00000000-0000-0000-0000-000000000001');
set role authenticated;
update public.contas_pagar set status = 'aprovada' where parcela = '1/2';            -- estorno
update public.contas_pagar set status = 'a_aprovar' where parcela = '2/2';           -- reabre
reset role;
do $$ begin
  assert (select pago_em is null and pago_por is null from public.contas_pagar where parcela = '1/2'), 'estorno limpa a baixa';
  assert (select status from public.contas_pagar where parcela = '2/2') = 'a_aprovar', 'master reabre cancelada';
end $$;
\echo 'OK C7 - cancelamento com motivo; master estorna pagamento e reabre conta cancelada'

-- 8) Todas as contas da nota canceladas: a nota volta para "recebida"
select pg_temp.entrar('00000000-0000-0000-0000-000000000001');
set role authenticated;
update public.contas_pagar set status = 'cancelada', motivo_cancelamento = 'teste' where nota_id is not null;
reset role;
do $$ begin
  assert (select status from public.notas_fiscais where numero = '300001') = 'recebida', 'nota sem contas ativas volta a recebida';
end $$;
\echo 'OK C8 - nota com todas as contas canceladas volta para "Recebida"'

-- 9) Master lança conta avulsa: já nasce aprovada
select pg_temp.entrar('00000000-0000-0000-0000-000000000001');
set role authenticated;
insert into public.contas_pagar (loja_id, descricao, plano_conta_id, competencia, vencimento, valor)
values ((select id from ids where nome = 'terra'), 'Aluguel dezembro', (select id from ids where nome = 'plano'), '2026-12-01', '2026-12-05', 15000);
reset role;
do $$ begin
  assert (select status from public.contas_pagar where descricao = 'Aluguel dezembro') = 'aprovada', 'conta do master nasce aprovada';
end $$;
\echo 'OK C9 - conta lançada pelo master já nasce aprovada'

-- 10) Consulta vê, mas não lança, não altera; ninguém apaga
select pg_temp.entrar('00000000-0000-0000-0000-000000000004');
set role authenticated;
do $$ declare n int; begin
  select count(*) into n from public.contas_pagar;
  assert n = 3, 'consulta vê as contas';
  assert pg_temp.erro_de(format($f$insert into public.contas_pagar (loja_id, descricao, plano_conta_id, competencia, vencimento, valor)
    values (%L, 'x', %L, '2026-12-01', '2026-12-05', 1)$f$, (select id from ids where nome = 'terra'), (select id from ids where nome = 'plano'))) is not null,
    'consulta não lança';
  update public.contas_pagar set observacao = 'x';
  get diagnostics n = row_count;
  assert n = 0, 'consulta não altera';
end $$;
reset role;
select pg_temp.entrar('00000000-0000-0000-0000-000000000001');
set role authenticated;
do $$ begin
  assert pg_temp.erro_de($f$delete from public.contas_pagar$f$) is not null, 'ninguém apaga conta';
end $$;
reset role;
\echo 'OK C10 - consulta só vê; nem o master apaga (cancela com motivo)'

-- 11) Nota cancelada na SEFAZ não pode ser lançada; tudo vai para o histórico
update public.notas_fiscais set situacao_sefaz = 'cancelada' where numero = '300001';
select pg_temp.entrar('00000000-0000-0000-0000-000000000001');
set role authenticated;
do $$ begin
  assert pg_temp.erro_de(format($f$insert into public.contas_pagar (nota_id, descricao, parcela, plano_conta_id, competencia, vencimento, valor)
    values (%L, 'x', '9', %L, '2026-11-10', '2026-12-10', 1)$f$, (select id from ids where nome = 'nota'), (select id from ids where nome = 'plano')))
    like '%cancelada%', 'nota cancelada não é lançada';
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.historico where tabela = 'contas_pagar') >= 10, 'alterações vão para o histórico';
end $$;
\echo 'OK C11 - nota cancelada na SEFAZ não é lançada; histórico registra tudo'

\echo '>>> TODOS OS TESTES DO CONTAS A PAGAR PASSARAM'
