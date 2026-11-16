-- Histórico: quando a alteração não vem de um usuário logado (rotinas, importações feitas pelo
-- assistente, coletor), registra o autor informado em app.autor em vez de "postgres".
create or replace function public.registrar_historico() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_id text; v_nome text; v_reg jsonb;
begin
  select nome into v_nome from public.perfis where id = auth.uid();
  v_reg := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_id := coalesce(v_reg->>'id', v_reg->>'loja_id');
  insert into public.historico (usuario_id, usuario_nome, tabela, registro_id, acao, antes, depois)
  values (auth.uid(),
          coalesce(v_nome, nullif(current_setting('app.autor', true), ''), current_user),
          tg_table_name, v_id, tg_op,
          case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end);
  return coalesce(new, old);
end $$;
revoke execute on function public.registrar_historico() from public, anon, authenticated;
-- a exclusão do plano de contas de 16/11 foi feita a pedido do Pedro, antes deste ajuste
update public.historico set usuario_nome = 'Claude (a pedido de Pedro Mousinho)'
  where tabela = 'plano_contas' and acao = 'DELETE' and usuario_nome = 'postgres';
