-- =====================================================================
-- Etapa 2: cofre de notas fiscais (NF-e recebidas) e controle da SEFAZ
-- =====================================================================
create or replace function public.e_coletor() returns boolean
language sql stable set search_path = public as $$ select public.meu_papel() = 'coletor' $$;

-- usuários comuns: o coletor não conta como "pode ler/lançar" nas telas
create or replace function public.pode_ler() returns boolean
language sql stable set search_path = public as $$ select public.meu_papel() in ('master','lancador','consulta') $$;

create type public.status_nota as enum ('na_sefaz', 'recebida', 'lancada', 'problema', 'nao_reconhecida');
create type public.situacao_sefaz as enum ('autorizada', 'cancelada', 'denegada');
create type public.manifestacao_nota as enum ('nenhuma', 'ciencia', 'confirmada', 'desconhecida', 'nao_realizada');

create table public.notas_fiscais (
  id uuid primary key default gen_random_uuid(),
  chave text not null unique check (chave = public.so_digitos(chave) and public.chave_nfe_valida(chave)),
  loja_id uuid references public.lojas(id),             -- loja destinatária (null = CNPJ que não é nosso)
  destinatario_cnpj text,
  emitente_cnpj text not null,
  emitente_nome text,
  emitente_ie text,
  fornecedor_id uuid references public.fornecedores(id),
  numero text,
  serie text,
  data_emissao timestamptz,
  valor_total numeric(14,2),
  tipo_documento text not null check (tipo_documento in ('resumo', 'completa')),
  situacao_sefaz public.situacao_sefaz not null default 'autorizada',
  status public.status_nota not null default 'na_sefaz',
  manifestacao public.manifestacao_nota not null default 'nenhuma',
  duplicatas jsonb not null default '[]'::jsonb,           -- [{numero, vencimento, valor}]
  dados jsonb not null default '{}'::jsonb,                -- informações extras lidas do XML
  xml_arquivo text,                                        -- caminho no Storage (bucket notas-xml)
  pdf_arquivo text,
  origem text not null default 'sefaz' check (origem in ('sefaz', 'upload', 'pasta', 'danfe')),
  nsu bigint,
  observacao text,
  recebida_por uuid references public.perfis(id),
  recebida_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index on public.notas_fiscais (loja_id, status);
create index on public.notas_fiscais (emitente_cnpj);
create index on public.notas_fiscais (data_emissao desc);

create table public.eventos_nfe (
  id uuid primary key default gen_random_uuid(),
  chave text not null,
  tipo_evento text not null,          -- ex.: 110111 cancelamento, 210210 ciência
  descricao text,
  sequencia int not null default 1,
  data_evento timestamptz,
  protocolo text,
  nsu bigint,
  dados jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now(),
  unique (chave, tipo_evento, sequencia)
);
create index on public.eventos_nfe (chave);

-- Cancelamento recebido da SEFAZ marca a nota como cancelada (mesmo que o evento chegue antes da nota).
create or replace function public.aplicar_evento_nfe() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.tipo_evento = '110111' then
    update public.notas_fiscais set situacao_sefaz = 'cancelada', atualizado_em = now() where chave = new.chave;
  end if;
  return new;
end $$;
create trigger trg_aplicar_evento after insert on public.eventos_nfe
  for each row execute function public.aplicar_evento_nfe();

create or replace function public.nota_ao_inserir() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- cancelamento que chegou antes da própria nota
  if exists (select 1 from public.eventos_nfe e where e.chave = new.chave and e.tipo_evento = '110111') then
    new.situacao_sefaz := 'cancelada';
  end if;
  -- liga ao fornecedor cadastrado e à loja destinatária
  if new.fornecedor_id is null then
    select id into new.fornecedor_id from public.fornecedores where documento = new.emitente_cnpj;
  end if;
  if new.loja_id is null and new.destinatario_cnpj is not null then
    select id into new.loja_id from public.lojas where cnpj = new.destinatario_cnpj;
  end if;
  return new;
end $$;
create trigger trg_nota_ao_inserir before insert on public.notas_fiscais
  for each row execute function public.nota_ao_inserir();

-- Controle da consulta à SEFAZ por loja (último NSU e bloqueio de 1 hora)
create table public.sefaz_controle (
  loja_id uuid primary key references public.lojas(id),
  ultimo_nsu bigint not null default 0,
  maximo_nsu bigint,
  ultima_consulta timestamptz,
  proxima_consulta_permitida timestamptz,
  ultimo_cstat text,
  ultimo_motivo text,
  atualizado_em timestamptz not null default now()
);

-- Registro de cada execução do coletor
create table public.coletor_execucoes (
  id bigint generated always as identity primary key,
  loja_id uuid references public.lojas(id),
  inicio timestamptz not null default now(),
  fim timestamptz,
  cstat text,
  motivo text,
  documentos int not null default 0,
  notas_novas int not null default 0,
  eventos_novos int not null default 0,
  erro text,
  maquina text
);
create index on public.coletor_execucoes (inicio desc);

-- histórico (auditoria) nas tabelas novas
create trigger trg_hist_notas_fiscais after insert or update or delete on public.notas_fiscais
  for each row execute function public.registrar_historico();
create trigger trg_hist_eventos_nfe after insert or update or delete on public.eventos_nfe
  for each row execute function public.registrar_historico();

-- ---------------- segurança ----------------
alter table public.notas_fiscais enable row level security;
alter table public.eventos_nfe enable row level security;
alter table public.sefaz_controle enable row level security;
alter table public.coletor_execucoes enable row level security;

-- leitura: todos os usuários do sistema; o coletor lê o que precisa para trabalhar
create policy notas_ler on public.notas_fiscais for select to authenticated using (public.pode_ler() or public.e_coletor());
create policy eventos_ler on public.eventos_nfe for select to authenticated using (public.pode_ler() or public.e_coletor());
create policy controle_ler on public.sefaz_controle for select to authenticated using (public.pode_ler() or public.e_coletor());
create policy execucoes_ler on public.coletor_execucoes for select to authenticated using (public.pode_ler() or public.e_coletor());

-- escrita do coletor
create policy notas_coletor_incluir on public.notas_fiscais for insert to authenticated with check (public.e_coletor() or public.pode_lancar());
create policy notas_alterar on public.notas_fiscais for update to authenticated using (public.e_coletor() or public.pode_lancar()) with check (public.e_coletor() or public.pode_lancar());
create policy eventos_coletor on public.eventos_nfe for insert to authenticated with check (public.e_coletor());
create policy controle_coletor_incluir on public.sefaz_controle for insert to authenticated with check (public.e_coletor());
create policy controle_coletor_alterar on public.sefaz_controle for update to authenticated using (public.e_coletor()) with check (public.e_coletor());
create policy execucoes_coletor_incluir on public.coletor_execucoes for insert to authenticated with check (public.e_coletor());
create policy execucoes_coletor_alterar on public.coletor_execucoes for update to authenticated using (public.e_coletor()) with check (public.e_coletor());
-- certificados: o coletor informa titular e validade (o arquivo e a senha nunca saem do PC)
create policy certificados_coletor_incluir on public.certificados for insert to authenticated with check (public.e_coletor());
create policy certificados_coletor_alterar on public.certificados for update to authenticated using (public.e_coletor()) with check (public.e_coletor());
-- o coletor precisa ler lojas e fornecedores
create policy lojas_coletor_ler on public.lojas for select to authenticated using (public.e_coletor());
create policy fornecedores_coletor_ler on public.fornecedores for select to authenticated using (public.e_coletor());

-- Coletor não pode mudar o que o usuário decidiu (status/recebimento/manifestação manual).
create or replace function public.proteger_nota() returns trigger
language plpgsql set search_path = public as $$
begin
  if public.e_coletor() then
    if new.status <> old.status or new.recebida_por is distinct from old.recebida_por
       or new.manifestacao not in ('nenhuma','ciencia') and new.manifestacao <> old.manifestacao then
      raise exception 'O coletor não pode alterar o status nem a manifestação manual da nota';
    end if;
  end if;
  new.atualizado_em := now();
  return new;
end $$;
create trigger trg_proteger_nota before update on public.notas_fiscais
  for each row execute function public.proteger_nota();

grant select, insert, update on public.notas_fiscais, public.sefaz_controle, public.coletor_execucoes to authenticated;
grant select, insert on public.eventos_nfe to authenticated;
revoke execute on function public.aplicar_evento_nfe() from public, anon, authenticated;
revoke execute on function public.nota_ao_inserir() from public, anon, authenticated;
revoke execute on function public.proteger_nota() from public, anon, authenticated;

-- ---------------- arquivos (XML/PDF) ----------------
-- Bucket privado. Caminho: <cnpj da loja>/<ano>/<mes>/<chave>.xml
insert into storage.buckets (id, name, public) values ('notas-xml', 'notas-xml', false)
  on conflict (id) do nothing;
create policy "notas-xml ler" on storage.objects for select to authenticated
  using (bucket_id = 'notas-xml' and (public.pode_ler() or public.e_coletor()));
create policy "notas-xml incluir" on storage.objects for insert to authenticated
  with check (bucket_id = 'notas-xml' and (public.e_coletor() or public.pode_lancar()));
-- sem update/delete: guarda legal de 5 anos, arquivo gravado não é substituído nem apagado pelo sistema
