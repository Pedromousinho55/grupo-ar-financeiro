-- Testes da Etapa 2 (cofre de notas). Roda depois de 01_testes_etapa1.sql (usa os usuários de lá).
\set ON_ERROR_STOP on
set client_min_messages = warning;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c0', 'coletor@teste', '{"nome":"Coletor SEFAZ"}');
update public.perfis set papel = 'coletor' where email = 'coletor@teste';
insert into public.fornecedores (documento, razao_social) values ('41244765000154', 'A & A COMERCIAL LTDA');

create or replace function pg_temp.entrar(uid text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', uid, false); end $$;

-- 1) Coletor grava nota (resumo) contra a Terra; liga sozinho à loja e ao fornecedor
select pg_temp.entrar('00000000-0000-0000-0000-0000000000c0');
set role authenticated;
insert into public.notas_fiscais (chave, destinatario_cnpj, emitente_cnpj, emitente_nome, numero, valor_total, tipo_documento, nsu)
values ('26261141244765000154550010002954701123456783', '60543245000197', '41244765000154', 'A & A COMERCIAL', '295470', 1234.56, 'resumo', 101);
reset role;
do $$ begin
  assert (select l.apelido from public.notas_fiscais n join public.lojas l on l.id = n.loja_id where n.numero = '295470') = 'Terra', 'nota deve ligar à Terra';
  assert (select fornecedor_id is not null from public.notas_fiscais where numero = '295470'), 'nota deve ligar ao fornecedor';
  assert (select usuario_nome from public.historico where tabela = 'notas_fiscais' order by id desc limit 1) = 'Coletor SEFAZ', 'histórico com autor coletor';
  raise notice 'OK N1';
end $$;
\echo 'OK N1 - coletor grava nota e ela é ligada à loja e ao fornecedor'

-- 2) A mesma chave não entra duas vezes
do $$ begin
  begin
    insert into public.notas_fiscais (chave, emitente_cnpj, tipo_documento) values ('26261141244765000154550010002954701123456783', '41244765000154', 'resumo');
    assert false, 'chave duplicada deveria ser recusada';
  exception when unique_violation then null;
  end;
end $$;
\echo 'OK N2 - a mesma chave nunca entra duas vezes'

-- 3) Chave com dígito verificador errado é recusada
do $$ begin
  begin
    insert into public.notas_fiscais (chave, emitente_cnpj, tipo_documento) values ('26261141244765000154550010002954701123456784', '41244765000154', 'resumo');
    assert false, 'chave inválida deveria ser recusada';
  exception when check_violation then null;
  end;
end $$;
\echo 'OK N3 - chave com dígito verificador errado é recusada'

-- 4) Nota contra CNPJ que não é nosso fica sem loja (vai virar alerta na tela)
insert into public.notas_fiscais (chave, destinatario_cnpj, emitente_cnpj, tipo_documento)
values ('26261153209289000110550010000010011123456786', '11222333000181', '53209289000110', 'resumo');
do $$ begin
  assert (select loja_id is null from public.notas_fiscais where numero is null and emitente_cnpj = '53209289000110'), 'nota de outro CNPJ fica sem loja';
end $$;
\echo 'OK N4 - nota contra CNPJ que não é nosso fica sem loja (alerta)'

-- 5) Evento de cancelamento marca a nota como cancelada (inclusive se chegar antes da nota)
select pg_temp.entrar('00000000-0000-0000-0000-0000000000c0');
set role authenticated;
insert into public.eventos_nfe (chave, tipo_evento, descricao) values ('26261141244765000154550010002954701123456783', '110111', 'Cancelamento');
insert into public.eventos_nfe (chave, tipo_evento, descricao) values ('26261141244765000154550010002954711123456780', '110111', 'Cancelamento');
insert into public.notas_fiscais (chave, destinatario_cnpj, emitente_cnpj, numero, tipo_documento)
values ('26261141244765000154550010002954711123456780', '60543245000197', '41244765000154', '295471', 'resumo');
reset role;
do $$ begin
  assert (select situacao_sefaz from public.notas_fiscais where numero = '295470') = 'cancelada', 'nota 295470 deveria estar cancelada';
  assert (select situacao_sefaz from public.notas_fiscais where numero = '295471') = 'cancelada', 'nota 295471 (evento antes) deveria estar cancelada';
end $$;
\echo 'OK N5 - cancelamento marca a nota como cancelada, mesmo se chegar antes'

-- 6) Coletor NÃO pode mudar status (ex.: marcar como recebida) nem fazer manifestação manual
select pg_temp.entrar('00000000-0000-0000-0000-0000000000c0');
set role authenticated;
do $$ begin
  begin
    update public.notas_fiscais set status = 'recebida' where numero = '295470';
    assert false, 'coletor não deveria mudar status';
  exception when raise_exception then null;
  end;
  begin
    update public.notas_fiscais set manifestacao = 'confirmada' where numero = '295470';
    assert false, 'coletor não deveria confirmar operação';
  exception when raise_exception then null;
  end;
  update public.notas_fiscais set manifestacao = 'ciencia' where numero = '295470'; -- ciência é permitida
end $$;
reset role;
\echo 'OK N6 - coletor só pode registrar Ciência; status e confirmação são do usuário'

-- 7) Coletor não mexe em fornecedores nem vê usuários
select pg_temp.entrar('00000000-0000-0000-0000-0000000000c0');
set role authenticated;
do $$ begin
  begin
    insert into public.fornecedores (documento, razao_social) values ('60543245000197', 'X');
    assert false, 'coletor não deveria cadastrar fornecedor';
  exception when insufficient_privilege then null;
  end;
  assert (select count(*) from public.perfis) <= 1, 'coletor não deveria ver os outros usuários';
end $$;
reset role;
\echo 'OK N7 - coletor não cadastra fornecedor nem vê usuários'

-- 8) Usuário de consulta vê notas, mas não altera
select pg_temp.entrar('00000000-0000-0000-0000-000000000004');
set role authenticated;
do $$ declare n int; begin
  select count(*) into n from public.notas_fiscais;
  assert n = 3, 'consulta deveria ver as 3 notas';
  update public.notas_fiscais set observacao = 'x';
  get diagnostics n = row_count;
  assert n = 0, 'consulta não deveria alterar nota';
end $$;
reset role;
\echo 'OK N8 - usuário de consulta vê notas mas não altera'

-- 9) Lançador marca nota como recebida
select pg_temp.entrar('00000000-0000-0000-0000-000000000002');
set role authenticated;
update public.notas_fiscais set status = 'recebida', recebida_em = now() where numero = '295470';
reset role;
do $$ begin
  assert (select status from public.notas_fiscais where numero = '295470') = 'recebida', 'lançador deveria marcar recebida';
end $$;
\echo 'OK N9 - lançador marca a nota como recebida'

\echo '>>> TODOS OS TESTES DO COFRE DE NOTAS PASSARAM'
