-- =====================================================================
-- Etapa 3: contas a pagar
--   Fluxo: A aprovar → Aprovada (só o master) → Paga (master ou lançador, com data, valor e conta)
--   Cancelada exige motivo. Nada é apagado: tudo fica no Histórico.
--   Cada lançamento vai para UMA conta do plano (sem rateio, por enquanto).
-- =====================================================================
create type public.status_conta as enum ('a_aprovar', 'aprovada', 'paga', 'cancelada');

create table public.contas_pagar (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid not null references public.lojas(id),
  fornecedor_id uuid references public.fornecedores(id),
  nota_id uuid references public.notas_fiscais(id),
  descricao text not null check (length(trim(descricao)) > 0),
  documento text,                         -- nº da nota, do boleto, do contrato…
  parcela text,                           -- ex.: "1/3"
  plano_conta_id uuid not null references public.plano_contas(id),
  centro_custo_id uuid references public.centros_custo(id),
  forma_pagamento_id uuid references public.formas_pagamento(id),
  competencia date not null,              -- data de referência para a DRE (ex.: emissão da nota)
  vencimento date not null,
  valor numeric(14,2) not null check (valor > 0),
  codigo_barras text,                     -- linha digitável do boleto / PIX copia e cola
  status public.status_conta not null default 'a_aprovar',
  aprovada_por uuid references public.perfis(id),
  aprovada_em timestamptz,
  -- pagamento (baixa)
  pago_em date,
  valor_pago numeric(14,2) check (valor_pago >= 0),
  conta_bancaria_id uuid references public.contas_bancarias(id),
  pago_por uuid references public.perfis(id),
  baixa_em timestamptz,
  comprovante_arquivo text,               -- caminho no Storage (bucket comprovantes)
  motivo_cancelamento text,
  observacao text,
  criado_por uuid references public.perfis(id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint conta_paga_completa check (status <> 'paga' or (pago_em is not null and valor_pago is not null and conta_bancaria_id is not null)),
  constraint conta_cancelada_motivo check (status <> 'cancelada' or nullif(trim(motivo_cancelamento), '') is not null)
);
create index on public.contas_pagar (status, vencimento);
create index on public.contas_pagar (loja_id, vencimento);
create index on public.contas_pagar (nota_id);
create index on public.contas_pagar (fornecedor_id);
-- a mesma parcela da mesma nota não entra duas vezes (canceladas não contam)
create unique index contas_pagar_parcela_nota on public.contas_pagar (nota_id, coalesce(parcela, ''))
  where nota_id is not null and status <> 'cancelada';

-- ---------------- regras ao lançar ----------------
create or replace function public.conta_ao_inserir() returns trigger
language plpgsql set search_path = public as $$
declare v_nota record; v_usuario boolean := current_user in ('authenticated', 'anon');
begin
  if new.nota_id is not null then
    select loja_id, fornecedor_id, situacao_sefaz into v_nota from public.notas_fiscais where id = new.nota_id;
    if not found then raise exception 'Nota fiscal não encontrada'; end if;
    if v_nota.situacao_sefaz <> 'autorizada' then
      raise exception 'Nota % na SEFAZ não pode ser lançada no contas a pagar', v_nota.situacao_sefaz;
    end if;
    new.loja_id := coalesce(new.loja_id, v_nota.loja_id);
    new.fornecedor_id := coalesce(new.fornecedor_id, v_nota.fornecedor_id);
  end if;
  if v_usuario then
    new.criado_por := auth.uid();
    new.criado_em := now();
    -- conta lançada pelo master já nasce aprovada; a dos demais espera aprovação
    if coalesce(public.e_master(), false) then
      new.status := 'aprovada'; new.aprovada_por := auth.uid(); new.aprovada_em := now();
    else
      new.status := 'a_aprovar'; new.aprovada_por := null; new.aprovada_em := null;
    end if;
    -- pagamento só pela baixa, depois de aprovada
    new.pago_em := null; new.valor_pago := null; new.conta_bancaria_id := null;
    new.pago_por := null; new.baixa_em := null; new.motivo_cancelamento := null;
  end if;
  new.atualizado_em := now();
  return new;
end $$;
create trigger trg_conta_ao_inserir before insert on public.contas_pagar
  for each row execute function public.conta_ao_inserir();

-- ---------------- regras ao alterar ----------------
create or replace function public.proteger_conta() returns trigger
language plpgsql set search_path = public as $$
declare
  v_master boolean := coalesce(public.e_master(), false);
  v_mudou_valores boolean;
begin
  new.atualizado_em := now();
  -- rotinas internas (migração, importação feita pelo administrador) não passam pelas regras de tela
  if current_user not in ('authenticated', 'anon') then return new; end if;

  -- campos que só o próprio sistema preenche
  new.criado_por := old.criado_por; new.criado_em := old.criado_em; new.nota_id := old.nota_id;

  v_mudou_valores := (new.valor, new.vencimento, new.loja_id, new.fornecedor_id, new.plano_conta_id, new.centro_custo_id,
                      new.competencia, new.forma_pagamento_id, new.codigo_barras, new.descricao, new.documento, new.parcela)
                     is distinct from
                     (old.valor, old.vencimento, old.loja_id, old.fornecedor_id, old.plano_conta_id, old.centro_custo_id,
                      old.competencia, old.forma_pagamento_id, old.codigo_barras, old.descricao, old.documento, old.parcela);

  -- conta cancelada: só o master reabre (volta para "a aprovar")
  if old.status = 'cancelada' then
    if new.status = 'a_aprovar' and v_master then
      new.motivo_cancelamento := null; new.aprovada_por := null; new.aprovada_em := null;
      return new;
    end if;
    if new is distinct from old then
      new.atualizado_em := old.atualizado_em;
      if new is distinct from old then raise exception 'Conta cancelada não pode ser alterada'; end if;
    end if;
    return new;
  end if;

  -- conta paga
  if old.status = 'paga' then
    if new.status = 'aprovada' then                    -- estorno do pagamento
      if not v_master then raise exception 'Só o master pode estornar um pagamento'; end if;
      new.pago_em := null; new.valor_pago := null; new.conta_bancaria_id := null;
      new.pago_por := null; new.baixa_em := null;
      return new;
    end if;
    if new.status <> 'paga' then raise exception 'Para cancelar uma conta paga, estorne o pagamento antes'; end if;
    new.aprovada_por := old.aprovada_por; new.aprovada_em := old.aprovada_em;
    new.pago_por := old.pago_por; new.baixa_em := old.baixa_em;
    if v_mudou_valores then raise exception 'Conta paga não pode ter valor, vencimento ou classificação alterados'; end if;
    -- lançador só anexa comprovante e escreve observação; o master também corrige a baixa
    if not v_master and (new.pago_em, new.valor_pago, new.conta_bancaria_id) is distinct from (old.pago_em, old.valor_pago, old.conta_bancaria_id) then
      raise exception 'Só o master pode corrigir os dados de um pagamento';
    end if;
    return new;
  end if;

  -- daqui para baixo: a_aprovar ou aprovada
  if new.status = 'cancelada' then
    if not (v_master or (old.status = 'a_aprovar' and public.pode_lancar())) then
      raise exception 'Conta aprovada só pode ser cancelada pelo master';
    end if;
    return new;
  end if;

  if new.status = 'paga' then
    if old.status <> 'aprovada' then raise exception 'Só contas aprovadas podem ser pagas'; end if;
    if v_mudou_valores then raise exception 'Não altere a conta junto com o pagamento: salve a alteração antes'; end if;
    new.aprovada_por := old.aprovada_por; new.aprovada_em := old.aprovada_em;
    new.pago_por := auth.uid(); new.baixa_em := now();
    return new;
  end if;

  -- não é pagamento: campos da baixa não mudam
  new.pago_em := old.pago_em; new.valor_pago := old.valor_pago; new.conta_bancaria_id := old.conta_bancaria_id;
  new.pago_por := old.pago_por; new.baixa_em := old.baixa_em;

  if new.status = 'aprovada' and old.status = 'a_aprovar' then
    if not v_master then raise exception 'Só o master aprova contas'; end if;
    new.aprovada_por := auth.uid(); new.aprovada_em := now();
    return new;
  end if;

  if new.status = 'a_aprovar' and old.status = 'aprovada' then
    if not v_master then raise exception 'Só o master pode desfazer uma aprovação'; end if;
    new.aprovada_por := null; new.aprovada_em := null;
    return new;
  end if;

  -- mesma situação: edição dos dados
  new.aprovada_por := old.aprovada_por; new.aprovada_em := old.aprovada_em;
  if old.status = 'aprovada' and v_mudou_valores and not v_master then
    -- lançador mexeu numa conta aprovada: volta para a aprovação do master
    new.status := 'a_aprovar'; new.aprovada_por := null; new.aprovada_em := null;
  end if;
  return new;
end $$;
create trigger trg_proteger_conta before update on public.contas_pagar
  for each row execute function public.proteger_conta();

-- ---------------- nota "Lançada" ----------------
-- Nota com alguma conta ativa fica "Lançada"; se todas forem canceladas, volta para "Recebida".
create or replace function public.status_nota_pelas_contas() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_nota uuid;
begin
  foreach v_nota in array array[case when tg_op <> 'INSERT' then old.nota_id end, new.nota_id] loop
    continue when v_nota is null;
    if exists (select 1 from public.contas_pagar where nota_id = v_nota and status <> 'cancelada') then
      update public.notas_fiscais set status = 'lancada' where id = v_nota and status <> 'lancada';
    else
      update public.notas_fiscais set status = 'recebida' where id = v_nota and status = 'lancada';
    end if;
  end loop;
  return new;
end $$;
create trigger trg_status_nota_pelas_contas after insert or update of status on public.contas_pagar
  for each row execute function public.status_nota_pelas_contas();

create trigger trg_hist_contas_pagar after insert or update or delete on public.contas_pagar
  for each row execute function public.registrar_historico();

-- ---------------- segurança ----------------
alter table public.contas_pagar enable row level security;
create policy contas_pagar_ler on public.contas_pagar for select to authenticated using (public.pode_ler());
create policy contas_pagar_incluir on public.contas_pagar for insert to authenticated with check (public.pode_lancar());
create policy contas_pagar_alterar on public.contas_pagar for update to authenticated using (public.pode_lancar()) with check (public.pode_lancar());
-- sem delete: conta errada é cancelada (com motivo), nunca apagada
grant select, insert, update on public.contas_pagar to authenticated;
revoke execute on function public.conta_ao_inserir() from public, anon, authenticated;
revoke execute on function public.proteger_conta() from public, anon, authenticated;
revoke execute on function public.status_nota_pelas_contas() from public, anon, authenticated;

-- ---------------- comprovantes de pagamento ----------------
-- Bucket privado. Caminho: <cnpj da loja>/<ano>/<mes>/<id da conta>-<data e hora>.<ext>
insert into storage.buckets (id, name, public) values ('comprovantes', 'comprovantes', false)
  on conflict (id) do nothing;
create policy "comprovantes ler" on storage.objects for select to authenticated
  using (bucket_id = 'comprovantes' and public.pode_ler());
create policy "comprovantes incluir" on storage.objects for insert to authenticated
  with check (bucket_id = 'comprovantes' and public.pode_lancar());
-- sem update/delete: comprovante enviado não é substituído nem apagado
