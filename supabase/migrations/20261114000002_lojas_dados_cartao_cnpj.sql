-- Dados oficiais das lojas conforme Cartões CNPJ emitidos em 13/11/2026 (Receita Federal)
alter table public.lojas
  add column nome_fantasia text,
  add column endereco text,
  add column bairro text,
  add column cidade text,
  add column uf char(2),
  add column cep text,
  add column cnae_principal text,
  add column data_abertura date,
  add column situacao_cadastral text,
  add column observacao text;

update public.lojas set razao_social='TERRA GASTRONOMIA LTDA.', nome_fantasia='TERRA SHOPPING RECIFE',
  endereco='R PADRE CARAPUCEIRO, 777, LOJA 06 SC PC PC 263 A 267', bairro='BOA VIAGEM', cidade='RECIFE', uf='PE',
  cep='51020280', cnae_principal='56.11-2-01 Restaurantes e similares', data_abertura='2025-04-25', situacao_cadastral='ATIVA'
  where cnpj='60543245000197';
update public.lojas set razao_social='ARVO RESTAURANTE LTDA', nome_fantasia=null,
  endereco='R DJALMA FARIAS, 170', bairro='TORREAO', cidade='RECIFE', uf='PE',
  cep='52030195', cnae_principal='56.11-2-01 Restaurantes e similares', data_abertura='2019-08-14', situacao_cadastral='ATIVA',
  observacao='Antiga "Arvo Restaurante Eireli"'
  where cnpj='34539795000122';
update public.lojas set razao_social='LARA GASTRONOMIA LTDA', nome_fantasia='LARA',
  endereco='AV BOA VIAGEM, 104, LOJA 01 EDF VIVANT RESIDENCE', bairro='PINA', cidade='RECIFE', uf='PE',
  cep='51011000', cnae_principal='56.11-2-01 Restaurantes e similares', data_abertura='2025-12-03', situacao_cadastral='ATIVA',
  observacao='No GRFood aparece como "Omar Gastronomia Ltda"'
  where cnpj='63932077000110';
update public.lojas set razao_social='VOAR RESTAURANTE LTDA', nome_fantasia='VOAR RESTAURANTE',
  endereco='R BALTAZAR PEREIRA, 130', bairro='BOA VIAGEM', cidade='RECIFE', uf='PE',
  cep='51011550', cnae_principal='56.11-2-01 Restaurantes e similares', data_abertura='2017-12-07', situacao_cadastral='ATIVA'
  where cnpj='29226702000170';
update public.lojas set razao_social='LARA JAQUEIRA LTDA.', nome_fantasia='LARA JAQUEIRA',
  endereco='R PROFESSOR ALOISIO PESSOA DE ARAUJO, 75, SALA 1406 EMP', bairro='BOA VIAGEM', cidade='RECIFE', uf='PE',
  cep='51021410', cnae_principal='56.11-2-01 Restaurantes e similares', data_abertura='2026-08-27', situacao_cadastral='ATIVA'
  where cnpj='68829152000135';
