-- =====================================================================
-- Etapa 4c: conciliar saída do extrato direto com a nota fiscal
--   Boleto/PIX pago que casa com uma parcela (duplicata) ou com o total de uma nota:
--   cria a conta a pagar da nota já paga (data/valor do banco) e liga ao extrato.
--   Plano de contas: padrão do fornecedor → último usado com o fornecedor → 2.1.01 Compra produtos.
-- =====================================================================
alter table public.fornecedores
  add column plano_conta_padrao_id uuid references public.plano_contas(id),
  add column centro_custo_padrao_id uuid references public.centros_custo(id);

create or replace function public.conciliar_com_nota(
  p_lancamento uuid, p_nota uuid, p_vencimento date default null, p_parcela text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare l record; n record; v_loja uuid; v_plano uuid; v_centro uuid; v_conta uuid;
begin
  if not public.pode_lancar() then raise exception 'Você não tem permissão para conciliar'; end if;
  select * into l from public.extrato_lancamentos where id = p_lancamento for update;
  if not found then raise exception 'Linha do extrato não encontrada'; end if;
  if l.conciliado then raise exception 'Esta linha do extrato já está conciliada'; end if;
  if l.valor >= 0 then raise exception 'Só saídas do extrato pagam notas'; end if;
  select * into n from public.notas_fiscais where id = p_nota;
  if not found then raise exception 'Nota fiscal não encontrada'; end if;
  select loja_id into v_loja from public.contas_bancarias where id = l.conta_bancaria_id;
  if n.loja_id is distinct from v_loja then raise exception 'A nota é de outra empresa'; end if;
  if n.situacao_sefaz <> 'autorizada' then raise exception 'Nota % na SEFAZ não pode ser paga', n.situacao_sefaz; end if;

  select f.plano_conta_padrao_id, f.centro_custo_padrao_id into v_plano, v_centro from public.fornecedores f where f.id = n.fornecedor_id;
  if v_plano is null and n.fornecedor_id is not null then
    select c.plano_conta_id, coalesce(v_centro, c.centro_custo_id) into v_plano, v_centro from public.contas_pagar c
      where c.fornecedor_id = n.fornecedor_id and c.status <> 'cancelada' order by c.criado_em desc limit 1;
  end if;
  if v_plano is null then select id into v_plano from public.plano_contas where codigo = '2.1.01'; end if;
  if v_plano is null then raise exception 'Defina o plano de contas padrão do fornecedor'; end if;

  insert into public.contas_pagar (
    loja_id, fornecedor_id, nota_id, descricao, documento, parcela, plano_conta_id, centro_custo_id,
    competencia, vencimento, valor, status, aprovada_por, aprovada_em,
    pago_em, valor_pago, conta_bancaria_id, pago_por, baixa_em, criado_por, origem_extrato, observacao)
  values (
    v_loja, n.fornecedor_id, n.id, trim('NF-e ' || coalesce(n.numero, '') || ' · ' || coalesce(n.emitente_nome, '')), n.numero,
    nullif(trim(p_parcela), ''), v_plano, v_centro,
    coalesce((n.data_emissao at time zone 'America/Recife')::date, l.data), coalesce(p_vencimento, l.data), -l.valor,
    'paga', auth.uid(), now(), l.data, -l.valor, l.conta_bancaria_id, auth.uid(), now(), auth.uid(), true,
    'Conciliada com o extrato: ' || coalesce(l.descricao, ''))
  returning id into v_conta;
  update public.extrato_lancamentos set conciliado = true, tipo_conciliacao = 'conta_pagar', conta_pagar_id = v_conta,
    conciliado_por = auth.uid(), conciliado_em = now()
  where id = l.id;
  return v_conta;
end $$;

revoke execute on function public.conciliar_com_nota(uuid, uuid, date, text) from public, anon;
grant execute on function public.conciliar_com_nota(uuid, uuid, date, text) to authenticated;
