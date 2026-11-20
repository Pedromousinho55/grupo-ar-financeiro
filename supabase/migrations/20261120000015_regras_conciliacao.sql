-- =====================================================================
-- Etapa 4b: regras de conciliação
--   "Histórico do banco começa com/contém TEXTO (saída/entrada, conta, faixa de valor)" →
--     transferência | receita (plano) | conta a pagar já paga (plano, fornecedor…)
--   Cada regra é automática (concilia sozinha) ou só sugere (alguém confirma).
--   Só o master cria/altera regras; master e lançador aplicam.
-- =====================================================================
create table public.regras_conciliacao (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(trim(nome)) > 0),
  ativo boolean not null default true,
  prioridade int not null default 100,          -- menor = testada primeiro
  conta_bancaria_id uuid references public.contas_bancarias(id),   -- null = todas as contas
  sentido text not null default 'ambos' check (sentido in ('saida', 'entrada', 'ambos')),
  texto text not null check (length(trim(texto)) > 0),
  modo_texto text not null default 'comeca' check (modo_texto in ('comeca', 'contem')),
  valor_min numeric(14,2) check (valor_min >= 0),
  valor_max numeric(14,2) check (valor_max >= 0),
  acao public.tipo_conciliacao not null,
  plano_conta_id uuid references public.plano_contas(id),
  centro_custo_id uuid references public.centros_custo(id),
  fornecedor_id uuid references public.fornecedores(id),
  forma_pagamento_id uuid references public.formas_pagamento(id),
  descricao_conta text,                          -- descrição da conta criada (vazio = histórico do banco)
  automatica boolean not null default false,
  criado_por uuid references public.perfis(id) default auth.uid(),
  criado_em timestamptz not null default now(),
  constraint regra_coerente check (
    (acao = 'transferencia')
    or (acao = 'receita' and plano_conta_id is not null and sentido = 'entrada')
    or (acao = 'conta_pagar' and plano_conta_id is not null and sentido = 'saida')
  ),
  constraint regra_faixa check (valor_min is null or valor_max is null or valor_min <= valor_max)
);

alter table public.extrato_lancamentos add column regra_id uuid references public.regras_conciliacao(id) on delete set null;

-- A linha bate com a regra? (mesma lógica do site: src/lib/regras.ts)
create or replace function public.regra_bate(r public.regras_conciliacao, l public.extrato_lancamentos) returns boolean
language sql immutable set search_path = public as $$
  select r.ativo
    and (r.conta_bancaria_id is null or r.conta_bancaria_id = l.conta_bancaria_id)
    and (r.sentido = 'ambos' or (r.sentido = 'saida' and l.valor < 0) or (r.sentido = 'entrada' and l.valor > 0))
    and (r.valor_min is null or abs(l.valor) >= r.valor_min)
    and (r.valor_max is null or abs(l.valor) <= r.valor_max)
    and case r.modo_texto
          when 'comeca' then strpos(upper(coalesce(l.descricao, '')), upper(trim(r.texto))) = 1
          else strpos(upper(coalesce(l.descricao, '')), upper(trim(r.texto))) > 0
        end
$$;

-- Aplica uma regra a uma linha pendente (uso interno das funções abaixo).
create or replace function public.executar_regra(p_lancamento uuid, p_regra uuid) returns void
language plpgsql security definer set search_path = public as $$
declare l public.extrato_lancamentos; r public.regras_conciliacao; v_loja uuid; v_conta uuid;
begin
  select * into l from public.extrato_lancamentos where id = p_lancamento for update;
  select * into r from public.regras_conciliacao where id = p_regra;
  if l.id is null or r.id is null then raise exception 'Linha ou regra não encontrada'; end if;
  if l.conciliado then return; end if;
  if not public.regra_bate(r, l) then raise exception 'A regra "%" não vale para esta linha', r.nome; end if;
  if r.acao = 'conta_pagar' then
    select loja_id into v_loja from public.contas_bancarias where id = l.conta_bancaria_id;
    insert into public.contas_pagar (
      loja_id, fornecedor_id, descricao, documento, plano_conta_id, centro_custo_id, forma_pagamento_id,
      competencia, vencimento, valor, status, aprovada_por, aprovada_em,
      pago_em, valor_pago, conta_bancaria_id, pago_por, baixa_em, criado_por, origem_extrato, observacao)
    values (
      v_loja, r.fornecedor_id, coalesce(nullif(trim(r.descricao_conta), ''), l.descricao, r.nome), l.documento, r.plano_conta_id,
      r.centro_custo_id, r.forma_pagamento_id, l.data, l.data, -l.valor, 'paga', auth.uid(), now(),
      l.data, -l.valor, l.conta_bancaria_id, auth.uid(), now(), auth.uid(), true,
      'Lançada pela regra de conciliação "' || r.nome || '": ' || coalesce(l.descricao, ''))
    returning id into v_conta;
    update public.extrato_lancamentos set conciliado = true, tipo_conciliacao = 'conta_pagar', conta_pagar_id = v_conta,
      regra_id = r.id, conciliado_por = auth.uid(), conciliado_em = now()
    where id = l.id;
  else
    update public.extrato_lancamentos set conciliado = true, tipo_conciliacao = r.acao,
      plano_conta_id = case when r.acao = 'receita' then r.plano_conta_id end,
      centro_custo_id = case when r.acao = 'receita' then r.centro_custo_id end,
      regra_id = r.id, observacao = coalesce(observacao, 'Regra: ' || r.nome),
      conciliado_por = auth.uid(), conciliado_em = now()
    where id = l.id;
  end if;
end $$;

-- Confirmar uma sugestão de regra (lançador ou master).
create or replace function public.aplicar_regra(p_lancamento uuid, p_regra uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.pode_lancar() then raise exception 'Você não tem permissão para conciliar'; end if;
  perform public.executar_regra(p_lancamento, p_regra);
end $$;

-- Roda as regras automáticas nas linhas pendentes (de uma conta, ou de todas). Devolve quantas conciliou.
create or replace function public.aplicar_regras_automaticas(p_conta uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare l public.extrato_lancamentos; v_regra uuid; n int := 0;
begin
  if not public.pode_lancar() then raise exception 'Você não tem permissão para conciliar'; end if;
  for l in select * from public.extrato_lancamentos
           where not conciliado and (p_conta is null or conta_bancaria_id = p_conta) order by data, id loop
    -- a primeira regra que bate decide; se ela só sugere, a linha fica para alguém confirmar
    select r.id into v_regra from public.regras_conciliacao r
      where public.regra_bate(r, l) order by r.prioridade, r.criado_em limit 1;
    if v_regra is not null and (select automatica from public.regras_conciliacao where id = v_regra) then
      perform public.executar_regra(l.id, v_regra);
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- desfazer conciliação também limpa a regra
create or replace function public.limpar_regra_ao_desfazer() returns trigger
language plpgsql set search_path = public as $$
begin
  if not new.conciliado then new.regra_id := null; end if;
  return new;
end $$;
create trigger trg_limpar_regra before update on public.extrato_lancamentos
  for each row execute function public.limpar_regra_ao_desfazer();

-- ---------------- histórico e segurança ----------------
create trigger trg_hist_regras_conciliacao after insert or update or delete on public.regras_conciliacao
  for each row execute function public.registrar_historico();

alter table public.regras_conciliacao enable row level security;
create policy regras_ler on public.regras_conciliacao for select to authenticated using (public.pode_ler());
create policy regras_incluir on public.regras_conciliacao for insert to authenticated with check (public.e_master());
create policy regras_alterar on public.regras_conciliacao for update to authenticated using (public.e_master()) with check (public.e_master());
create policy regras_apagar on public.regras_conciliacao for delete to authenticated using (public.e_master());
grant select, insert, update, delete on public.regras_conciliacao to authenticated;

revoke execute on function public.executar_regra(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.limpar_regra_ao_desfazer() from public, anon, authenticated;
revoke execute on function public.aplicar_regra(uuid, uuid) from public, anon;
revoke execute on function public.aplicar_regras_automaticas(uuid) from public, anon;
grant execute on function public.aplicar_regra(uuid, uuid) to authenticated;
grant execute on function public.aplicar_regras_automaticas(uuid) to authenticated;
