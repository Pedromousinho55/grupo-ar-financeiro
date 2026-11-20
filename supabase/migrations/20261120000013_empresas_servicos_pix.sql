-- Empresas de serviços do grupo (cartões CNPJ emitidos em 13/11/2026) e chave PIX das contas bancárias.
-- MDF presta serviços de mão de obra e eventos ao Voar; SFC, ao Arvo. Não compram de fornecedores:
-- têm folha, impostos, rescisões e recebimentos de eventos.

-- chave PIX da própria conta (para receber e para conferir na conciliação)
alter table public.contas_bancarias
  add column pix_tipo public.tipo_pix,
  add column pix_chave text;

insert into public.lojas (apelido, razao_social, cnpj, endereco, bairro, cidade, uf, cep, cnae_principal, data_abertura, situacao_cadastral, observacao) values
  ('MDF Serviços', 'MDF SERVICOS E BUFE LTDA', '19330768000151', 'R BALTAZAR PEREIRA, 130', 'BOA VIAGEM', 'RECIFE', 'PE', '51011550',
   '82.11-3-00 Serviços combinados de escritório e apoio administrativo', '2013-11-28', 'ATIVA',
   'Empresa de serviços (mão de obra e eventos) que atende o Voar. Porte ME.'),
  ('SFC Serviços', 'SFC SERVICOS E BUFE LTDA', '40508530000160', 'R DJALMA FARIAS, 170, 1 ANDAR', 'TORREAO', 'RECIFE', 'PE', '52030195',
   '82.11-3-00 Serviços combinados de escritório e apoio administrativo', '2021-01-21', 'ATIVA',
   'Empresa de serviços (mão de obra e eventos) que atende o Arvo. Porte EPP.')
on conflict (cnpj) do nothing;

insert into public.contas_bancarias (loja_id, descricao, banco_codigo, agencia, conta, pix_tipo, pix_chave)
select l.id, d.descricao, '033', '4661', d.conta, d.pix_tipo::public.tipo_pix, d.pix_chave
from (values
  ('19330768000151', 'Santander MDF Serviços', '13.006350-5', 'email', 'pixvoaratelie@gmail.com'),
  ('40508530000160', 'Santander SFC Serviços', '13.005733-5', 'cnpj',  '40508530000160')
) as d(cnpj, descricao, conta, pix_tipo, pix_chave)
join public.lojas l on l.cnpj = d.cnpj
on conflict (banco_codigo, agencia, conta) do nothing;

-- chave PIX das contas das lojas (informadas pelo Pedro em 20/11/2026)
update public.contas_bancarias c set pix_tipo = d.pix_tipo::public.tipo_pix, pix_chave = d.pix_chave
from (values
  ('34539795000122', 'cnpj',  '34539795000122'),
  ('29226702000170', 'cnpj',  '29226702000170'),
  ('63932077000110', 'cnpj',  '63932077000110'),
  ('68829152000135', 'cnpj',  '68829152000135'),
  ('60543245000197', 'email', 'terra.gastronomia2019@gmail.com')
) as d(cnpj, pix_tipo, pix_chave), public.lojas l
where l.cnpj = d.cnpj and c.loja_id = l.id and c.banco_codigo = '033' and c.pix_chave is null;
