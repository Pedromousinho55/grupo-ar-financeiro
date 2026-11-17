-- Ajustes no plano de contas aprovados pelo Pedro em 17/11/2026
select set_config('app.autor', 'Claude (ajustes do plano aprovados por Pedro Mousinho)', true);

-- 1) Não operacional: saídas não operacionais (3.3) e investimentos em bens materiais (3.1, capex)
update public.grupos_dre set operacional = false where codigo in ('3.1', '3.3');
update public.plano_contas p set operacional = false
  from public.grupos_dre g where g.id = p.grupo_dre_id and g.codigo in ('3.1', '3.3');

-- 2) Despesas que variam com as vendas: compras (2.1), fornecedores cozinha/bar (2.2),
--    gás/gelo/embalagem (2.3) e custo com vendas (2.4); taxa das operadoras de cartão (2.5.2).
update public.grupos_dre set tipo_despesa = 'variavel' where codigo in ('2.1', '2.2', '2.3', '2.4');
update public.grupos_dre set tipo_despesa = 'fixa' where natureza = 'despesa' and tipo_despesa is null;
--    os subgrupos seguem o tipo do grupo
update public.plano_contas p set tipo_despesa = g.tipo_despesa
  from public.grupos_dre g where g.id = p.grupo_dre_id and p.natureza = 'despesa';
update public.plano_contas set tipo_despesa = 'variavel' where codigo = '2.5.2';

-- 3) Descontos concedidos reduzem a receita
update public.plano_contas set natureza = 'deducao', tipo_despesa = null where codigo = '1.1.05';

-- 4) Impostos sobre vendas (1.0 / 1.0.0) são deduções da receita bruta na DRE
update public.grupos_dre set natureza = 'deducao', tipo_despesa = null where codigo in ('1.0', '1.0.0');
update public.plano_contas p set natureza = 'deducao', tipo_despesa = null
  from public.grupos_dre g where g.id = p.grupo_dre_id and g.codigo = '1.0.0';
