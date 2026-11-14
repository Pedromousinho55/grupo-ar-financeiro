-- Fornecedores: dados cadastrais preenchidos pela consulta pública de CNPJ (Receita Federal)
alter table public.fornecedores
  add column endereco text,
  add column bairro text,
  add column cidade text,
  add column uf char(2),
  add column cep text,
  add column cnae_principal text,
  add column situacao_cadastral text,
  add column consultado_receita_em timestamptz;
