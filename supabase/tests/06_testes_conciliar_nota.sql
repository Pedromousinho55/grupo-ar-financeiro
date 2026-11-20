-- Testes de conciliar saída do extrato direto com nota fiscal. Roda depois de 05_testes_regras.sql.
\set ON_ERROR_STOP on
set client_min_messages = warning;

create or replace function pg_temp.entrar(uid text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', uid, false); end $$;
create or replace function pg_temp.erro_de(cmd text) returns text language plpgsql as $$
begin execute cmd; return null; exception when others then return sqlerrm; end $$;

-- nota de outro fornecedor (sem histórico) com 2 duplicatas, contra a Terra
insert into public.fornecedores (documento, razao_social) values ('11222333000181', 'HORTIFRUTI TESTE LTDA');
insert into public.notas_fiscais (chave, destinatario_cnpj, emitente_cnpj, emitente_nome, numero, valor_total, tipo_documento, data_emissao, duplicatas)
values ('26261111222333000181550010004000011000000016', '60543245000197', '11222333000181', 'HORTIFRUTI TESTE', '400001', 200.00, 'completa',
        '2026-11-01T10:00:00-03:00', '[{"numero":"001","vencimento":"2026-11-15","valor":"100.00"},{"numero":"002","vencimento":"2026-11-30","valor":"100.00"}]');
insert into public.extrato_lancamentos (conta_bancaria_id, fitid, data, valor, descricao)
select c.id, f, d::date, v, 'PAGAMENTO DE BOLETO OUTROS BANCOS · BANCO X'
from public.contas_bancarias c, (values ('N1', '2026-11-15', -100.00), ('N2', '2026-11-30', -100.00), ('N3', '2026-11-30', -100.00)) as t(f, d, v)
where c.descricao = 'Santander Terra';

-- 1) Sem padrão do fornecedor: vai para 2.1.1 Insumos cozinha; conta paga ligada à nota, nota "lançada"
select pg_temp.entrar('00000000-0000-0000-0000-000000000002');
set role authenticated;
select public.conciliar_com_nota((select id from public.extrato_lancamentos where fitid = 'N1'),
  (select id from public.notas_fiscais where numero = '400001'), '2026-11-15', '1/2');
reset role;
do $$ begin
  assert (select p.codigo from public.contas_pagar c join public.plano_contas p on p.id = c.plano_conta_id where c.nota_id = (select id from public.notas_fiscais where numero = '400001') and c.parcela = '1/2') = '2.1.1', 'sem padrão vai para 2.1.1 Insumos cozinha';
  assert (select status from public.contas_pagar where parcela = '1/2' and nota_id = (select id from public.notas_fiscais where numero = '400001')) = 'paga', 'conta paga';
  assert (select status from public.notas_fiscais where numero = '400001') = 'lancada', 'nota lançada';
  assert (select conciliado from public.extrato_lancamentos where fitid = 'N1'), 'linha conciliada';
end $$;
\echo 'OK NF1 - saída casada com parcela da nota: conta paga, nota lançada, plano 2.1.1 por falta de padrão'

-- 2) Com padrão do fornecedor; a mesma parcela não é paga duas vezes
update public.fornecedores set plano_conta_padrao_id = (select id from public.plano_contas where codigo = '2.1.2') where documento = '11222333000181';
select pg_temp.entrar('00000000-0000-0000-0000-000000000002');
set role authenticated;
select public.conciliar_com_nota((select id from public.extrato_lancamentos where fitid = 'N2'),
  (select id from public.notas_fiscais where numero = '400001'), '2026-11-30', '2/2');
do $$ begin
  assert pg_temp.erro_de(format($f$select public.conciliar_com_nota(%L, %L, '2026-11-30', '2/2')$f$,
    (select id from public.extrato_lancamentos where fitid = 'N3'), (select id from public.notas_fiscais where numero = '400001'))) is not null,
    'mesma parcela não é paga duas vezes';
end $$;
reset role;
do $$ begin
  assert (select p.codigo from public.contas_pagar c join public.plano_contas p on p.id = c.plano_conta_id where c.parcela = '2/2' and c.nota_id = (select id from public.notas_fiscais where numero = '400001')) = '2.1.2', 'usa o padrão do fornecedor';
  assert (select not conciliado from public.extrato_lancamentos where fitid = 'N3'), 'linha recusada continua pendente';
end $$;
\echo 'OK NF2 - plano padrão do fornecedor é usado; a mesma parcela não é paga duas vezes'

-- 3) Nota de outra empresa e consulta são recusados
select pg_temp.entrar('00000000-0000-0000-0000-000000000002');
set role authenticated;
do $$ begin
  assert pg_temp.erro_de(format($f$select public.conciliar_com_nota(%L, %L)$f$,
    (select id from public.extrato_lancamentos where fitid = 'N3'),
    (select id from public.notas_fiscais where numero = '295471'))) is not null, 'nota de outra empresa/cancelada recusada';
end $$;
reset role;
select pg_temp.entrar('00000000-0000-0000-0000-000000000004');
set role authenticated;
do $$ begin
  assert pg_temp.erro_de(format($f$select public.conciliar_com_nota(%L, %L)$f$,
    (select id from public.extrato_lancamentos where fitid = 'N3'),
    (select id from public.notas_fiscais where numero = '400001'))) like '%permissão%', 'consulta não concilia';
end $$;
reset role;
\echo 'OK NF3 - nota de outra empresa/cancelada e usuário de consulta são recusados'

-- 4) Desfazer: a conta criada é cancelada e a nota volta para "recebida"
select pg_temp.entrar('00000000-0000-0000-0000-000000000001');
set role authenticated;
select public.desfazer_conciliacao((select id from public.extrato_lancamentos where fitid = 'N1'));
select public.desfazer_conciliacao((select id from public.extrato_lancamentos where fitid = 'N2'));
reset role;
do $$ begin
  assert (select status from public.notas_fiscais where numero = '400001') = 'recebida', 'nota sem contas ativas volta a recebida';
end $$;
\echo 'OK NF4 - desfazer cancela a conta criada e devolve a nota'


-- 5) Plano de contas ajustado em 20/11: insumos de cozinha e bar; taxa de antecipação em despesas financeiras (2.4.5); grupo 2.1 (COMPRAS) apagado e grupos renumerados
do $$ begin
  assert (select nome from public.plano_contas where codigo = '2.1.1') = 'INSUMOS COZINHA', '2.1.1 Insumos cozinha';
  assert (select nome from public.plano_contas where codigo = '2.1.2') = 'INSUMOS BAR', '2.1.2 Insumos bar';
  assert (select g.codigo from public.plano_contas p join public.grupos_dre g on g.id = p.grupo_dre_id where p.codigo = '2.4.5' and p.nome = 'TAXA DE ANTECIPAÇÃO') = '2.4', 'taxa em despesas financeiras';
  assert not exists (select 1 from public.plano_contas where codigo in ('2.1.01', '2.1.02', '2.1.03')), 'contas antigas 2.1.0x abolidas';
  assert (select nome from public.grupos_dre where codigo = '2.1') = 'CUSTOS COM FORNECEDORES 1', 'grupos renumerados';
  assert (select nome from public.grupos_dre where codigo = '2.8') = 'DESPESAS COM MATERIAIS E EQUIPAMENTOS', '2.9 virou 2.8';
  assert not exists (select 1 from public.grupos_dre where codigo = '2.9'), 'não sobra 2.9';
end $$;
\echo 'OK NF5 - plano: 2.1.1 Insumos cozinha, 2.1.2 Insumos bar; 2.4.5 Taxa de antecipação'
\echo '>>> TODOS OS TESTES DE CONCILIAR COM NOTA PASSARAM'
