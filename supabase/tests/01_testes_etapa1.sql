-- Testes da Etapa 1. Cada "assert" que falhar interrompe o teste com a mensagem.
\set ON_ERROR_STOP on
set client_min_messages = warning;

-- 1) Validações de documentos ------------------------------------------
do $$ begin
  assert public.cnpj_valido('60.543.245/0001-97'), 'CNPJ Terra deveria ser válido';
  assert not public.cnpj_valido('60.543.245/0001-98'), 'CNPJ com DV errado deveria ser inválido';
  assert not public.cnpj_valido('11111111111111'), 'CNPJ repetido deveria ser inválido';
  assert public.cpf_valido('529.982.247-25'), 'CPF de exemplo deveria ser válido';
  assert not public.cpf_valido('529.982.247-24'), 'CPF com DV errado deveria ser inválido';
  assert public.chave_nfe_valida('2611 1160 5432 4500 0197 5500 1000 2954 7010 0000 0014'), 'chave NF-e deveria ser válida';
  assert not public.chave_nfe_valida('26111160543245000197550010002954701000000015'), 'chave com DV errado deveria ser inválida';
  assert not public.chave_nfe_valida('123'), 'chave curta deveria ser inválida';
  raise notice 'OK 1 - validações de CNPJ, CPF e chave NF-e';
end $$;

-- 2) Dados iniciais -----------------------------------------------------
do $$ begin
  assert (select count(*) from public.lojas) = 5, 'deveria haver 5 lojas';
  assert (select count(*) from public.centros_custo) = 4, 'deveria haver 4 centros de custo';
  raise notice 'OK 2 - 5 lojas, centros de custo e formas de pagamento cadastrados';
end $$;

-- 3) Usuários de teste ---------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000001', 'pedro@teste',   '{"nome":"Pedro Mousinho"}'),
  ('00000000-0000-0000-0000-000000000002', 'marcio@teste',  '{"nome":"Marcio Victor"}'),
  ('00000000-0000-0000-0000-000000000003', 'assist@teste',  '{"nome":"Assistente 1"}'),
  ('00000000-0000-0000-0000-000000000004', 'eduardo@teste', '{"nome":"Eduardo Freyre"}');
update public.perfis set papel = 'master'   where email = 'pedro@teste';
update public.perfis set papel = 'lancador' where email in ('marcio@teste','assist@teste');
do $$ begin
  assert (select papel from public.perfis where email='eduardo@teste') = 'consulta', 'novo usuário deve nascer como consulta';
  raise notice 'OK 3 - perfil criado automaticamente, novo usuário nasce só com consulta';
end $$;

-- helper para "entrar" como um usuário
create or replace function pg_temp.entrar(uid text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', uid, false); end $$;

-- 4) Lançador (Marcio) pode cadastrar fornecedor; histórico registra quem fez
select pg_temp.entrar('00000000-0000-0000-0000-000000000002');
set role authenticated;
insert into public.fornecedores (documento, razao_social, pix_tipo, pix_chave, prazo_padrao_dias)
  values ('34539795000122', 'FORNECEDOR TESTE LTDA', 'cnpj', '34539795000122', 28);
reset role;
do $$ begin
  assert exists (select 1 from public.historico where tabela='fornecedores' and acao='INSERT' and usuario_nome='Marcio Victor'),
    'histórico deveria registrar Marcio Victor como autor';
  raise notice 'OK 4 - lançador cadastra fornecedor e o histórico registra quem fez';
end $$;

-- 5) Lançador NÃO pode apagar fornecedor (o banco simplesmente não apaga)
select pg_temp.entrar('00000000-0000-0000-0000-000000000002');
set role authenticated;
delete from public.fornecedores where documento = '34539795000122';
reset role;
do $$ begin
  assert exists (select 1 from public.fornecedores where documento='34539795000122'), 'lançador não deveria conseguir apagar';
  raise notice 'OK 5 - lançador não consegue apagar cadastro';
end $$;

-- 6) Consulta (Eduardo) lê, mas não grava
select pg_temp.entrar('00000000-0000-0000-0000-000000000004');
set role authenticated;
do $$ declare n int; begin
  select count(*) into n from public.lojas;
  assert n = 5, 'consulta deveria ver as 5 lojas';
  begin
    insert into public.fornecedores (documento, razao_social) values ('60543245000197', 'NAO DEVERIA');
    assert false, 'consulta não deveria conseguir incluir fornecedor';
  exception when insufficient_privilege then null;
  end;
  raise notice 'OK 6 - usuário de consulta vê, mas não grava';
end $$;
reset role;

-- 7) Lançador não pode se promover a master
select pg_temp.entrar('00000000-0000-0000-0000-000000000003');
set role authenticated;
update public.perfis set papel = 'master' where id = '00000000-0000-0000-0000-000000000003';
reset role;
do $$ begin
  assert (select papel from public.perfis where email='assist@teste') = 'lancador', 'assistente não deveria virar master';
  raise notice 'OK 7 - ninguém além do master altera papéis';
end $$;

-- 8) Fornecedor com CNPJ inválido é recusado
do $$ begin
  begin
    insert into public.fornecedores (documento, razao_social) values ('12345678000100', 'CNPJ ERRADO');
    assert false, 'CNPJ inválido deveria ser recusado';
  exception when check_violation then null;
  end;
  raise notice 'OK 8 - fornecedor com CNPJ inválido é recusado';
end $$;

-- 9) Histórico não pode ser alterado nem apagado por usuários
select pg_temp.entrar('00000000-0000-0000-0000-000000000001');
set role authenticated;
do $$ begin
  begin
    delete from public.historico;
    assert false, 'histórico não deveria poder ser apagado';
  exception when insufficient_privilege then null;
  end;
  raise notice 'OK 9 - histórico não pode ser apagado nem pelo master';
end $$;
reset role;

-- 10) Alerta de certificado (30 dias antes)
insert into public.certificados (loja_id, titular, valido_ate)
  select id, razao_social, current_date + 20 from public.lojas where apelido = 'Terra';
insert into public.certificados (loja_id, titular, valido_ate)
  select id, razao_social, current_date + 200 from public.lojas where apelido = 'Arvo';
do $$ begin
  assert (select situacao from public.alertas_certificados where apelido='Terra') = 'RENOVAR', 'Terra deveria estar em RENOVAR';
  assert (select situacao from public.alertas_certificados where apelido='Arvo') = 'OK', 'Arvo deveria estar OK';
  raise notice 'OK 10 - alerta de renovação de certificado 30 dias antes';
end $$;

\echo '>>> TODOS OS TESTES DA ETAPA 1 PASSARAM'

do $$ begin
  assert (select count(*) from public.lojas where razao_social is null or data_abertura is null) = 0, 'todas as lojas devem ter razão social e data de abertura';
  assert (select razao_social from public.lojas where apelido='Arvo') = 'ARVO RESTAURANTE LTDA', 'Arvo deve estar como LTDA';
end $$;
\echo '>>> Dados dos cartões CNPJ conferidos'

do $$ begin
  assert (select count(*) from public.grupos_dre) = 16, 'devem existir 16 grupos';
  assert (select count(*) from public.plano_contas) = 82, 'devem existir 82 subgrupos';
  assert (select g.codigo from public.plano_contas p join public.grupos_dre g on g.id = p.grupo_dre_id where p.codigo = '2.6.2') = '2.6', 'Energia deve estar em 2.6';
  assert (select p.codigo from public.grupos_dre g join public.grupos_dre p on p.id = g.grupo_pai_id where g.codigo = '1.0.0') = '1.0', '1.0.0 deve estar dentro de 1.0';
  assert (select array_agg(codigo order by ordem_codigo) from public.plano_contas where codigo in ('2.6.2','2.6.10')) = array['2.6.2','2.6.10'], 'ordem numérica';
  assert (select tipo_despesa from public.plano_contas where codigo = '2.1.03') = 'variavel', 'taxa de antecipação variável';
end $$;
\echo '>>> Plano de contas do Grupo AR conferido (16 grupos, 82 subgrupos)'

do $$ begin
  assert (select bool_and(not p.operacional) from public.plano_contas p join public.grupos_dre g on g.id = p.grupo_dre_id where g.codigo in ('3.1','3.3')), '3.1 e 3.3 não operacionais';
  assert (select tipo_despesa from public.plano_contas where codigo = '2.3.2') = 'variavel', 'gelo variável';
  assert (select tipo_despesa from public.plano_contas where codigo = '2.6.2') = 'fixa', 'energia fixa';
  assert (select tipo_despesa from public.plano_contas where codigo = '2.5.2') = 'variavel', 'taxa cartão variável';
  assert (select natureza from public.plano_contas where codigo = '1.1.05') = 'deducao', 'descontos = dedução';
  assert (select count(*) from public.plano_contas p join public.grupos_dre g on g.id = p.grupo_dre_id where g.codigo = '1.0.0' and p.natureza <> 'deducao') = 0, 'impostos = dedução';
end $$;
\echo '>>> Ajustes do plano de contas conferidos'
