-- Ajustes pedidos pelo Pedro em 20/11/2026:
--   TAXA DE ANTECIPAÇÃO sai do grupo 2.1 (COMPRAS) e vai para 2.5 DESPESAS FINANCEIRAS como 2.5.5.
--   Adega do Tito: plano padrão 3.1.5 Móveis e utensílios (compra taças).
select set_config('app.autor', 'Ajuste do plano de contas (Pedro Mousinho, 20/11/2026)', true);

update public.plano_contas
  set codigo = '2.5.5', grupo_dre_id = (select id from public.grupos_dre where codigo = '2.5')
  where nome = 'TAXA DE ANTECIPAÇÃO';

update public.fornecedores
  set plano_conta_padrao_id = (select id from public.plano_contas where codigo = '3.1.5')
  where documento in (select documento from public.fornecedores where razao_social ilike 'ADEGA DO TITO%');
