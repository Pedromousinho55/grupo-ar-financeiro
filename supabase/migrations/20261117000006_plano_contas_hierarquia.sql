-- Plano de contas no modelo do Grupo AR: grupos (com código e grupo pai) e subgrupos (contas),
-- com natureza, tipo de despesa (fixa/variável) e se é operacional.
create or replace function public.ordem_do_codigo(codigo text) returns int[]
language sql immutable set search_path = public as $$
  select case when codigo ~ '^\d+(\.\d+)*$' then string_to_array(codigo, '.')::int[] end
$$;

alter table public.grupos_dre
  add column codigo text unique,
  add column grupo_pai_id uuid references public.grupos_dre(id),
  add column tipo_despesa text check (tipo_despesa in ('fixa', 'variavel')),
  add column operacional boolean not null default true,
  add column ordem_codigo int[] generated always as (public.ordem_do_codigo(codigo)) stored;

alter table public.plano_contas
  add column natureza public.natureza_conta,
  add column tipo_despesa text check (tipo_despesa in ('fixa', 'variavel')),
  add column operacional boolean not null default true,
  add column ordem_codigo int[] generated always as (public.ordem_do_codigo(codigo)) stored;
