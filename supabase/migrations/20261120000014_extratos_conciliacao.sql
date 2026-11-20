-- =====================================================================
-- Etapa 4: extratos bancários (OFX) e conciliação
--   Cada linha do extrato fica "pendente" até ser conciliada como:
--     conta_pagar   → saída ligada a uma conta a pagar (existente, ou criada já paga a partir da linha)
--     receita       → entrada classificada no plano de contas
--     transferencia → movimento entre contas do próprio grupo (não é receita nem despesa)
--   Master e lançador importam e conciliam; só o master desfaz uma conciliação.
-- =====================================================================
create type public.tipo_conciliacao as enum ('conta_pagar', 'receita', 'transferencia');

create table public.extrato_importacoes (
  id uuid primary key default gen_random_uuid(),
  conta_bancaria_id uuid not null references public.contas_bancarias(id),
  arquivo_nome text,
  periodo_inicio date,
  periodo_fim date,
  saldo_final numeric(14,2),              -- saldo informado pelo banco no arquivo (LEDGERBAL)
  saldo_data date,
  linhas_novas int not null default 0,
  linhas_repetidas int not null default 0,
  importado_por uuid references public.perfis(id) default auth.uid(),
  importado_em timestamptz not null default now()
);
create index on public.extrato_importacoes (conta_bancaria_id, saldo_data desc);

create table public.extrato_lancamentos (
  id uuid primary key default gen_random_uuid(),
  conta_bancaria_id uuid not null references public.contas_bancarias(id),
  importacao_id uuid references public.extrato_importacoes(id),
  fitid text not null,                    -- identificador da transação no banco (evita duplicar)
  data date not null,
  valor numeric(14,2) not null check (valor <> 0),   -- negativo = saída, positivo = entrada
  descricao text,                         -- histórico do banco (MEMO)
  documento text,
  tipo_ofx text,
  conciliado boolean not null default false,
  tipo_conciliacao public.tipo_conciliacao,
  conta_pagar_id uuid references public.contas_pagar(id),
  plano_conta_id uuid references public.plano_contas(id),
  centro_custo_id uuid references public.centros_custo(id),
  conta_destino_id uuid references public.contas_bancarias(id),   -- transferência: a outra conta do grupo
  observacao text,
  conciliado_por uuid references public.perfis(id),
  conciliado_em timestamptz,
  criado_em timestamptz not null default now(),
  unique (conta_bancaria_id, fitid),
  constraint extrato_conciliacao_coerente check (
    (not conciliado and tipo_conciliacao is null and conta_pagar_id is null)
    or (conciliado and tipo_conciliacao = 'conta_pagar' and conta_pagar_id is not null and valor < 0)
    or (conciliado and tipo_conciliacao = 'receita' and plano_conta_id is not null and conta_pagar_id is null)
    or (conciliado and tipo_conciliacao = 'transferencia' and conta_pagar_id is null)
  )
);
create index on public.extrato_lancamentos (conta_bancaria_id, data);
create index on public.extrato_lancamentos (conciliado, data);
-- uma conta a pagar só é ligada a uma linha do extrato
create unique index extrato_conta_pagar_unica on public.extrato_lancamentos (conta_pagar_id) where conta_pagar_id is not null;

-- conta a pagar criada a partir do extrato (para saber o que desfazer)
alter table public.contas_pagar add column origem_extrato boolean not null default false;

-- ---------------- regras de alteração direta das linhas ----------------
-- Pela tela só se classifica receita/transferência e se escreve observação.
-- Ligar a uma conta a pagar e desfazer conciliação passam pelas funções abaixo.
create or replace function public.proteger_extrato() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  -- dados vindos do banco não mudam
  if (new.conta_bancaria_id, new.fitid, new.data, new.valor, new.descricao, new.documento, new.tipo_ofx, new.importacao_id)
     is distinct from (old.conta_bancaria_id, old.fitid, old.data, old.valor, old.descricao, old.documento, old.tipo_ofx, old.importacao_id) then
    raise exception 'Dados do extrato não podem ser alterados';
  end if;
  if new.conta_pagar_id is distinct from old.conta_pagar_id or new.tipo_conciliacao = 'conta_pagar' or old.tipo_conciliacao = 'conta_pagar' then
    if (new.conciliado, new.tipo_conciliacao, new.conta_pagar_id) is distinct from (old.conciliado, old.tipo_conciliacao, old.conta_pagar_id) then
      raise exception 'Use "Conciliar com conta a pagar" para ligar o extrato a uma conta';
    end if;
  end if;
  if old.conciliado and not new.conciliado and not coalesce(public.e_master(), false) then
    raise exception 'Só o master desfaz uma conciliação';
  end if;
  if old.conciliado and new.conciliado
     and (new.tipo_conciliacao, new.plano_conta_id, new.centro_custo_id, new.conta_destino_id)
         is distinct from (old.tipo_conciliacao, old.plano_conta_id, old.centro_custo_id, old.conta_destino_id)
     and not coalesce(public.e_master(), false) then
    raise exception 'Só o master altera uma conciliação já feita';
  end if;
  if new.conciliado and not old.conciliado then
    new.conciliado_por := auth.uid(); new.conciliado_em := now();
  elsif not new.conciliado then
    new.conciliado_por := null; new.conciliado_em := null; new.tipo_conciliacao := null;
    new.plano_conta_id := null; new.centro_custo_id := null; new.conta_destino_id := null;
  else
    new.conciliado_por := old.conciliado_por; new.conciliado_em := old.conciliado_em;
  end if;
  return new;
end $$;
create trigger trg_proteger_extrato before update on public.extrato_lancamentos
  for each row execute function public.proteger_extrato();

-- ---------------- conciliar saída com conta a pagar ----------------
-- Conta aprovada vira "Paga" com a data e o valor do banco; conta já paga (baixa manual) só é ligada.
-- Conta "a aprovar": só o master concilia (vale como aprovação).
create or replace function public.conciliar_com_conta(p_lancamento uuid, p_conta uuid) returns void
language plpgsql security definer set search_path = public as $$
declare l record; c record; v_master boolean := coalesce(public.e_master(), false);
begin
  if not public.pode_lancar() then raise exception 'Você não tem permissão para conciliar'; end if;
  select * into l from public.extrato_lancamentos where id = p_lancamento for update;
  if not found then raise exception 'Linha do extrato não encontrada'; end if;
  if l.conciliado then raise exception 'Esta linha do extrato já está conciliada'; end if;
  if l.valor >= 0 then raise exception 'Só saídas do extrato são ligadas a contas a pagar'; end if;
  select * into c from public.contas_pagar where id = p_conta for update;
  if not found then raise exception 'Conta a pagar não encontrada'; end if;
  if exists (select 1 from public.extrato_lancamentos where conta_pagar_id = p_conta) then
    raise exception 'Esta conta a pagar já está ligada a outra linha do extrato';
  end if;
  if c.loja_id <> (select loja_id from public.contas_bancarias where id = l.conta_bancaria_id) then
    raise exception 'A conta a pagar é de outra empresa';
  end if;
  if c.status = 'cancelada' then raise exception 'Conta cancelada não pode ser conciliada'; end if;
  if c.status = 'a_aprovar' and not v_master then
    raise exception 'Conta ainda não aprovada: peça ao Pedro para aprovar (ou conciliar) antes';
  end if;
  if c.status in ('a_aprovar', 'aprovada') then
    update public.contas_pagar set
      status = 'paga',
      aprovada_por = coalesce(aprovada_por, auth.uid()), aprovada_em = coalesce(aprovada_em, now()),
      pago_em = l.data, valor_pago = -l.valor, conta_bancaria_id = l.conta_bancaria_id,
      pago_por = auth.uid(), baixa_em = now(), atualizado_em = now()
    where id = p_conta;
  end if;
  update public.extrato_lancamentos set
    conciliado = true, tipo_conciliacao = 'conta_pagar', conta_pagar_id = p_conta,
    conciliado_por = auth.uid(), conciliado_em = now()
  where id = p_lancamento;
end $$;

-- ---------------- saída sem conta: cria a conta já paga ----------------
create or replace function public.conciliar_criando_conta(
  p_lancamento uuid, p_plano uuid, p_descricao text,
  p_fornecedor uuid default null, p_centro uuid default null, p_forma uuid default null, p_competencia date default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare l record; v_loja uuid; v_conta uuid;
begin
  if not public.pode_lancar() then raise exception 'Você não tem permissão para conciliar'; end if;
  select * into l from public.extrato_lancamentos where id = p_lancamento for update;
  if not found then raise exception 'Linha do extrato não encontrada'; end if;
  if l.conciliado then raise exception 'Esta linha do extrato já está conciliada'; end if;
  if l.valor >= 0 then raise exception 'Só saídas do extrato viram conta a pagar'; end if;
  if p_plano is null then raise exception 'Escolha a conta do plano de contas'; end if;
  if nullif(trim(p_descricao), '') is null then raise exception 'Escreva uma descrição'; end if;
  select loja_id into v_loja from public.contas_bancarias where id = l.conta_bancaria_id;
  insert into public.contas_pagar (
    loja_id, fornecedor_id, descricao, documento, plano_conta_id, centro_custo_id, forma_pagamento_id,
    competencia, vencimento, valor, status, aprovada_por, aprovada_em,
    pago_em, valor_pago, conta_bancaria_id, pago_por, baixa_em, criado_por, origem_extrato, observacao)
  values (
    v_loja, p_fornecedor, trim(p_descricao), l.documento, p_plano, p_centro, p_forma,
    coalesce(p_competencia, l.data), l.data, -l.valor, 'paga', auth.uid(), now(),
    l.data, -l.valor, l.conta_bancaria_id, auth.uid(), now(), auth.uid(), true,
    'Lançada pela conciliação do extrato: ' || coalesce(l.descricao, ''))
  returning id into v_conta;
  update public.extrato_lancamentos set
    conciliado = true, tipo_conciliacao = 'conta_pagar', conta_pagar_id = v_conta,
    conciliado_por = auth.uid(), conciliado_em = now()
  where id = p_lancamento;
  return v_conta;
end $$;

-- ---------------- desfazer (só master) ----------------
-- Conta criada pela conciliação é cancelada; conta que foi paga pela conciliação volta para "Aprovada".
create or replace function public.desfazer_conciliacao(p_lancamento uuid) returns void
language plpgsql security definer set search_path = public as $$
declare l record; c record;
begin
  if not coalesce(public.e_master(), false) then raise exception 'Só o master desfaz uma conciliação'; end if;
  select * into l from public.extrato_lancamentos where id = p_lancamento for update;
  if not found or not l.conciliado then raise exception 'Linha não está conciliada'; end if;
  if l.conta_pagar_id is not null then
    select * into c from public.contas_pagar where id = l.conta_pagar_id;
    if c.origem_extrato then
      update public.contas_pagar set status = 'cancelada', motivo_cancelamento = 'Conciliação do extrato desfeita', atualizado_em = now()
        where id = c.id;
    elsif c.status = 'paga' and c.pago_em = l.data and c.conta_bancaria_id = l.conta_bancaria_id and c.valor_pago = -l.valor then
      update public.contas_pagar set status = 'aprovada', pago_em = null, valor_pago = null, conta_bancaria_id = null,
        pago_por = null, baixa_em = null, atualizado_em = now()
        where id = c.id;
    end if;
  end if;
  update public.extrato_lancamentos set
    conciliado = false, tipo_conciliacao = null, conta_pagar_id = null, plano_conta_id = null,
    centro_custo_id = null, conta_destino_id = null, conciliado_por = null, conciliado_em = null
  where id = p_lancamento;
end $$;

-- conta paga conciliada com o extrato não é estornada pela tela da conta (desfaz-se pela conciliação)
create or replace function public.travar_conta_conciliada() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') and old.status = 'paga'
     and (new.status <> 'paga' or (new.pago_em, new.valor_pago, new.conta_bancaria_id) is distinct from (old.pago_em, old.valor_pago, old.conta_bancaria_id))
     and exists (select 1 from public.extrato_lancamentos where conta_pagar_id = old.id) then
    raise exception 'Este pagamento foi conciliado com o extrato do banco: para estornar, desfaça a conciliação';
  end if;
  return new;
end $$;
create trigger trg_travar_conta_conciliada before update on public.contas_pagar
  for each row execute function public.travar_conta_conciliada();
revoke execute on function public.travar_conta_conciliada() from public, anon, authenticated;

-- ---------------- saldo por conta ----------------
create view public.saldos_contas with (security_invoker = true) as
  select c.id as conta_bancaria_id, c.loja_id, c.descricao, c.saldo_inicial, c.data_saldo_inicial,
         c.saldo_inicial + coalesce((select sum(e.valor) from public.extrato_lancamentos e
                                      where e.conta_bancaria_id = c.id
                                        and (c.data_saldo_inicial is null or e.data > c.data_saldo_inicial)), 0) as saldo_calculado,
         (select max(e.data) from public.extrato_lancamentos e where e.conta_bancaria_id = c.id) as ultimo_movimento,
         (select i.saldo_final from public.extrato_importacoes i where i.conta_bancaria_id = c.id and i.saldo_final is not null
            order by i.saldo_data desc nulls last, i.importado_em desc limit 1) as saldo_banco,
         (select i.saldo_data from public.extrato_importacoes i where i.conta_bancaria_id = c.id and i.saldo_final is not null
            order by i.saldo_data desc nulls last, i.importado_em desc limit 1) as saldo_banco_data,
         (select count(*) from public.extrato_lancamentos e where e.conta_bancaria_id = c.id and not e.conciliado) as pendentes
  from public.contas_bancarias c
  where c.ativo;

-- ---------------- histórico e segurança ----------------
create trigger trg_hist_extrato_lancamentos after insert or update or delete on public.extrato_lancamentos
  for each row execute function public.registrar_historico();
create trigger trg_hist_extrato_importacoes after insert or update or delete on public.extrato_importacoes
  for each row execute function public.registrar_historico();

alter table public.extrato_importacoes enable row level security;
alter table public.extrato_lancamentos enable row level security;
create policy extrato_importacoes_ler on public.extrato_importacoes for select to authenticated using (public.pode_ler());
create policy extrato_importacoes_incluir on public.extrato_importacoes for insert to authenticated with check (public.pode_lancar());
create policy extrato_importacoes_alterar on public.extrato_importacoes for update to authenticated using (public.pode_lancar()) with check (public.pode_lancar());
create policy extrato_lancamentos_ler on public.extrato_lancamentos for select to authenticated using (public.pode_ler());
create policy extrato_lancamentos_incluir on public.extrato_lancamentos for insert to authenticated
  with check (public.pode_lancar() and not conciliado);
create policy extrato_lancamentos_alterar on public.extrato_lancamentos for update to authenticated using (public.pode_lancar()) with check (public.pode_lancar());
-- sem delete: extrato importado é registro do banco
grant select, insert, update on public.extrato_importacoes, public.extrato_lancamentos to authenticated;
grant select on public.saldos_contas to authenticated;
revoke execute on function public.proteger_extrato() from public, anon, authenticated;
revoke execute on function public.conciliar_com_conta(uuid, uuid) from public, anon;
revoke execute on function public.conciliar_criando_conta(uuid, uuid, text, uuid, uuid, uuid, date) from public, anon;
revoke execute on function public.desfazer_conciliacao(uuid) from public, anon;
grant execute on function public.conciliar_com_conta(uuid, uuid) to authenticated;
grant execute on function public.conciliar_criando_conta(uuid, uuid, text, uuid, uuid, uuid, date) to authenticated;
grant execute on function public.desfazer_conciliacao(uuid) to authenticated;
