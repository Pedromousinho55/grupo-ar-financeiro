-- =====================================================================
-- Grupo AR – Sistema Financeiro
-- Etapa 1: base, usuários, permissões, cadastros e histórico (auditoria)
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Funções de validação de documentos (CNPJ / CPF / chave NF-e)
-- ---------------------------------------------------------------------
create or replace function public.so_digitos(t text) returns text
language sql immutable as $$ select regexp_replace(coalesce(t,''), '\D', '', 'g') $$;

create or replace function public.cnpj_valido(doc text) returns boolean
language plpgsql immutable as $$
declare d text := public.so_digitos(doc); s int; r int; i int;
  p1 int[] := array[5,4,3,2,9,8,7,6,5,4,3,2];
  p2 int[] := array[6,5,4,3,2,9,8,7,6,5,4,3,2];
begin
  if length(d) <> 14 or d ~ '^(\d)\1{13}$' then return false; end if;
  s := 0; for i in 1..12 loop s := s + substr(d,i,1)::int * p1[i]; end loop;
  r := s % 11; if (case when r < 2 then 0 else 11 - r end) <> substr(d,13,1)::int then return false; end if;
  s := 0; for i in 1..13 loop s := s + substr(d,i,1)::int * p2[i]; end loop;
  r := s % 11; return (case when r < 2 then 0 else 11 - r end) = substr(d,14,1)::int;
end $$;

create or replace function public.cpf_valido(doc text) returns boolean
language plpgsql immutable as $$
declare d text := public.so_digitos(doc); s int; r int; i int;
begin
  if length(d) <> 11 or d ~ '^(\d)\1{10}$' then return false; end if;
  s := 0; for i in 1..9 loop s := s + substr(d,i,1)::int * (11 - i); end loop;
  r := (s * 10) % 11; if r = 10 then r := 0; end if;
  if r <> substr(d,10,1)::int then return false; end if;
  s := 0; for i in 1..10 loop s := s + substr(d,i,1)::int * (12 - i); end loop;
  r := (s * 10) % 11; if r = 10 then r := 0; end if;
  return r = substr(d,11,1)::int;
end $$;

-- Chave de acesso NF-e: 44 dígitos, último = DV módulo 11 (pesos 2..9 da direita p/ esquerda)
create or replace function public.chave_nfe_valida(chave text) returns boolean
language plpgsql immutable as $$
declare d text := public.so_digitos(chave); s int := 0; peso int := 2; i int; dv int;
begin
  if length(d) <> 44 then return false; end if;
  for i in reverse 43..1 loop
    s := s + substr(d,i,1)::int * peso;
    peso := case when peso = 9 then 2 else peso + 1 end;
  end loop;
  dv := 11 - (s % 11); if dv >= 10 then dv := 0; end if;
  return dv = substr(d,44,1)::int;
end $$;

-- ---------------------------------------------------------------------
-- Usuários e permissões
--   master   = lança, aprova, consulta e administra usuários/cadastros
--   lancador = lança e consulta (não aprova)
--   consulta = só consulta
-- ---------------------------------------------------------------------
create type public.papel_usuario as enum ('master', 'lancador', 'consulta');

create table public.perfis (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null,
  email text,
  papel public.papel_usuario not null default 'consulta',
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

-- Ao criar um login no Supabase, cria o perfil automaticamente como "consulta".
create or replace function public.criar_perfil_novo_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfis (id, nome, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'nome', new.email), new.email)
  on conflict (id) do nothing;
  return new;
end $$;
create trigger trg_auth_novo_usuario after insert on auth.users
  for each row execute function public.criar_perfil_novo_usuario();

create or replace function public.meu_papel() returns public.papel_usuario
language sql stable security definer set search_path = public as $$
  select papel from public.perfis where id = auth.uid() and ativo
$$;
create or replace function public.pode_ler() returns boolean
language sql stable as $$ select public.meu_papel() is not null $$;
create or replace function public.pode_lancar() returns boolean
language sql stable as $$ select public.meu_papel() in ('master','lancador') $$;
create or replace function public.pode_aprovar() returns boolean
language sql stable as $$ select public.meu_papel() = 'master' $$;
create or replace function public.e_master() returns boolean
language sql stable as $$ select public.meu_papel() = 'master' $$;

-- Ninguém (exceto master) pode mudar o próprio papel.
create or replace function public.proteger_papel() returns trigger
language plpgsql as $$
begin
  if (new.papel <> old.papel or new.ativo <> old.ativo) and not coalesce(public.e_master(), false)
     and current_user in ('authenticated','anon') then
    raise exception 'Somente o usuário master pode alterar papéis ou desativar usuários';
  end if;
  return new;
end $$;
create trigger trg_proteger_papel before update on public.perfis
  for each row execute function public.proteger_papel();

-- ---------------------------------------------------------------------
-- Cadastros
-- ---------------------------------------------------------------------
create table public.lojas (
  id uuid primary key default gen_random_uuid(),
  apelido text not null unique,
  razao_social text,
  cnpj text not null unique check (public.cnpj_valido(cnpj) and cnpj = public.so_digitos(cnpj)),
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

-- Metadados do certificado A1 (o ARQUIVO e a SENHA nunca vêm para cá; ficam no PC do coletor).
create table public.certificados (
  loja_id uuid primary key references public.lojas(id),
  titular text,
  cnpj_certificado text,
  valido_de date,
  valido_ate date not null,
  atualizado_em timestamptz not null default now()
);
create view public.alertas_certificados with (security_invoker = true) as
  select l.apelido, c.titular, c.valido_ate,
         (c.valido_ate - current_date) as dias_restantes,
         case when c.valido_ate < current_date then 'VENCIDO'
              when c.valido_ate - current_date <= 30 then 'RENOVAR'
              else 'OK' end as situacao
  from public.lojas l left join public.certificados c on c.loja_id = l.id
  where l.ativo;

-- Grupos da DRE (estrutura do relatório) e plano de contas
create type public.natureza_conta as enum ('receita', 'deducao', 'custo', 'despesa', 'financeiro', 'investimento', 'outros');

create table public.grupos_dre (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  natureza public.natureza_conta not null,
  ordem int not null default 0
);

create table public.plano_contas (
  id uuid primary key default gen_random_uuid(),
  codigo text unique,
  nome text not null,
  grupo_dre_id uuid references public.grupos_dre(id),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  unique (nome)
);

create table public.centros_custo (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  ativo boolean not null default true
);

create type public.tipo_pix as enum ('cnpj', 'cpf', 'email', 'telefone', 'aleatoria');

create table public.fornecedores (
  id uuid primary key default gen_random_uuid(),
  documento text not null unique
    check (documento = public.so_digitos(documento)
           and (public.cnpj_valido(documento) or public.cpf_valido(documento))),
  razao_social text not null,
  nome_fantasia text,
  -- dados bancários
  banco_codigo text,
  agencia text,
  conta text,
  pix_tipo public.tipo_pix,
  pix_chave text,
  -- padrão para contas sem duplicata no XML
  prazo_padrao_dias int check (prazo_padrao_dias between 0 and 365),
  email text,
  telefone text,
  observacao text,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

create table public.contas_bancarias (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid not null references public.lojas(id),
  descricao text not null,
  banco_codigo text not null default '033',   -- 033 = Santander
  agencia text,
  conta text,
  saldo_inicial numeric(14,2) not null default 0,
  data_saldo_inicial date,
  ativo boolean not null default true,
  unique (banco_codigo, agencia, conta)
);

create table public.formas_pagamento (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  ativo boolean not null default true
);

-- ---------------------------------------------------------------------
-- Histórico (auditoria): quem, o quê, quando. Não pode ser alterado nem apagado.
-- ---------------------------------------------------------------------
create table public.historico (
  id bigint generated always as identity primary key,
  quando timestamptz not null default now(),
  usuario_id uuid,
  usuario_nome text,
  tabela text not null,
  registro_id text,
  acao text not null,          -- INSERT / UPDATE / DELETE
  antes jsonb,
  depois jsonb
);
create index on public.historico (tabela, registro_id);
create index on public.historico (quando desc);

create or replace function public.registrar_historico() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_id text; v_nome text;
begin
  select nome into v_nome from public.perfis where id = auth.uid();
  v_id := coalesce((case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end)->>'id',
                   (case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end)->>'loja_id');
  insert into public.historico (usuario_id, usuario_nome, tabela, registro_id, acao, antes, depois)
  values (auth.uid(), coalesce(v_nome, current_user), tg_table_name, v_id, tg_op,
          case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

do $$ declare t text; begin
  foreach t in array array['perfis','lojas','certificados','grupos_dre','plano_contas','centros_custo',
                           'fornecedores','contas_bancarias','formas_pagamento'] loop
    execute format('create trigger trg_hist_%1$s after insert or update or delete on public.%1$I
                    for each row execute function public.registrar_historico()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Segurança por linha (RLS): o banco é quem garante as permissões,
-- não só a tela. Mesmo alguém "esperto" no navegador não consegue burlar.
-- ---------------------------------------------------------------------
alter table public.perfis enable row level security;
create policy perfis_ler on public.perfis for select to authenticated using (public.pode_ler() or id = auth.uid());
create policy perfis_master on public.perfis for update to authenticated using (public.e_master()) with check (public.e_master());

do $$ declare t text; begin
  -- cadastros: todos logados leem; master e lançador cadastram/editam; só master apaga
  foreach t in array array['lojas','grupos_dre','plano_contas','centros_custo','fornecedores',
                           'contas_bancarias','formas_pagamento','certificados'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %1$s_ler on public.%1$I for select to authenticated using (public.pode_ler())', t);
    execute format('create policy %1$s_incluir on public.%1$I for insert to authenticated with check (public.pode_lancar())', t);
    execute format('create policy %1$s_alterar on public.%1$I for update to authenticated using (public.pode_lancar()) with check (public.pode_lancar())', t);
    execute format('create policy %1$s_apagar on public.%1$I for delete to authenticated using (public.e_master())', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
-- lojas e contas bancárias: só master inclui/altera
drop policy lojas_incluir on public.lojas;   create policy lojas_incluir on public.lojas for insert to authenticated with check (public.e_master());
drop policy lojas_alterar on public.lojas;   create policy lojas_alterar on public.lojas for update to authenticated using (public.e_master()) with check (public.e_master());
drop policy contas_bancarias_incluir on public.contas_bancarias; create policy contas_bancarias_incluir on public.contas_bancarias for insert to authenticated with check (public.e_master());
drop policy contas_bancarias_alterar on public.contas_bancarias; create policy contas_bancarias_alterar on public.contas_bancarias for update to authenticated using (public.e_master()) with check (public.e_master());

alter table public.historico enable row level security;
create policy historico_ler on public.historico for select to authenticated using (public.pode_ler());
grant select on public.historico to authenticated;
grant select, update on public.perfis to authenticated;
grant select on public.alertas_certificados to authenticated;
-- nenhuma permissão de insert/update/delete no histórico: só os gatilhos escrevem nele.

-- ---------------------------------------------------------------------
-- Dados iniciais
-- ---------------------------------------------------------------------
insert into public.lojas (apelido, razao_social, cnpj) values
  ('Terra',         'Terra Gastronomia Ltda',   '60543245000197'),
  ('Arvo',          'Arvo Restaurante Eireli',  '34539795000122'),
  ('Lara Pina',     'Lara Gastronomia Ltda',    '63932077000110'),
  ('Voar',          null,                       '29226702000170'),  -- confirmar na 1ª consulta SEFAZ
  ('Lara Jaqueira', null,                       '68829152000135');  -- confirmar na 1ª consulta SEFAZ

insert into public.centros_custo (nome) values ('Salão'), ('Cozinha'), ('Ateliê/cursos'), ('Administrativo');

insert into public.formas_pagamento (nome) values
  ('Boleto'), ('PIX'), ('TED/Transferência'), ('Débito automático'), ('Cartão de crédito'), ('Dinheiro');

-- Estrutura inicial da DRE (pode ser ajustada; o plano de contas virá do GRFood)
insert into public.grupos_dre (nome, natureza, ordem) values
  ('Receita bruta',                    'receita',      10),
  ('Deduções e impostos sobre vendas', 'deducao',      20),
  ('CMV - Custo da mercadoria',        'custo',        30),
  ('Despesas com pessoal',             'despesa',      40),
  ('Despesas de ocupação',             'despesa',      50),
  ('Despesas administrativas',         'despesa',      60),
  ('Despesas comerciais e marketing',  'despesa',      70),
  ('Despesas e receitas financeiras',  'financeiro',   80),
  ('Investimentos (Capex)',            'investimento', 90),
  ('Outros / não operacional',         'outros',      100);
