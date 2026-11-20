import type { ConfigCadastro } from '../components/Cadastro'

export const LOJAS: ConfigCadastro = {
  tabela: 'lojas',
  titulo: 'Lojas',
  singular: 'Loja',
  ordem: 'apelido',
  editaQuem: 'master',
  explicacao: 'Dados oficiais conforme os cartões CNPJ (Receita Federal, 13/11/2026). Só o master altera.',
  campos: [
    { chave: 'apelido', rotulo: 'Apelido', obrigatorio: true, naLista: true },
    { chave: 'razao_social', rotulo: 'Razão social', obrigatorio: true, naLista: true },
    { chave: 'cnpj', rotulo: 'CNPJ', tipo: 'documento', obrigatorio: true, naLista: true },
    { chave: 'nome_fantasia', rotulo: 'Nome fantasia' },
    { chave: 'endereco', rotulo: 'Endereço' },
    { chave: 'bairro', rotulo: 'Bairro', naLista: true },
    { chave: 'cidade', rotulo: 'Cidade' },
    { chave: 'uf', rotulo: 'UF' },
    { chave: 'cep', rotulo: 'CEP' },
    { chave: 'cnae_principal', rotulo: 'Atividade principal (CNAE)' },
    { chave: 'data_abertura', rotulo: 'Abertura', tipo: 'data' },
    { chave: 'situacao_cadastral', rotulo: 'Situação na Receita', naLista: true },
    { chave: 'observacao', rotulo: 'Observação', tipo: 'texto_longo' },
    { chave: 'ativo', rotulo: 'Ativa', tipo: 'sim_nao' },
  ],
}

export const FORNECEDORES: ConfigCadastro = {
  tabela: 'fornecedores',
  titulo: 'Fornecedores',
  singular: 'Fornecedor',
  ordem: 'razao_social',
  explicacao:
    'Digite o CNPJ e os dados cadastrais são buscados na Receita Federal (só o número do CNPJ é enviado). CPF não tem consulta pública: preencha à mão. O prazo padrão é usado quando a nota não traz duplicatas.',
  consultaCnpj: true,
  campos: [
    { chave: 'documento', rotulo: 'CNPJ/CPF', tipo: 'documento', obrigatorio: true, naLista: true },
    { chave: 'razao_social', rotulo: 'Razão social', obrigatorio: true, naLista: true },
    { chave: 'nome_fantasia', rotulo: 'Nome fantasia', naLista: true },
    { chave: 'situacao_cadastral', rotulo: 'Situação na Receita', naLista: true },
    { chave: 'endereco', rotulo: 'Endereço' },
    { chave: 'bairro', rotulo: 'Bairro' },
    { chave: 'cidade', rotulo: 'Cidade', naLista: true },
    { chave: 'uf', rotulo: 'UF' },
    { chave: 'cep', rotulo: 'CEP' },
    { chave: 'cnae_principal', rotulo: 'Atividade principal (CNAE)' },
    { chave: 'banco_codigo', rotulo: 'Banco (código)', dica: 'Ex.: 033 Santander, 341 Itaú, 001 BB, 237 Bradesco, 104 Caixa' },
    { chave: 'agencia', rotulo: 'Agência' },
    { chave: 'conta', rotulo: 'Conta' },
    {
      chave: 'pix_tipo',
      rotulo: 'Tipo da chave PIX',
      tipo: 'selecao',
      opcoes: [
        { valor: 'cnpj', rotulo: 'CNPJ' },
        { valor: 'cpf', rotulo: 'CPF' },
        { valor: 'email', rotulo: 'E-mail' },
        { valor: 'telefone', rotulo: 'Telefone' },
        { valor: 'aleatoria', rotulo: 'Aleatória' },
      ],
    },
    { chave: 'pix_chave', rotulo: 'Chave PIX' },
    { chave: 'prazo_padrao_dias', rotulo: 'Prazo padrão (dias)', tipo: 'numero', naLista: true },
    { chave: 'email', rotulo: 'E-mail' },
    { chave: 'telefone', rotulo: 'Telefone' },
    { chave: 'observacao', rotulo: 'Observação', tipo: 'texto_longo' },
    { chave: 'ativo', rotulo: 'Ativo', tipo: 'sim_nao' },
  ],
}

const NATUREZAS = [
  { valor: 'receita', rotulo: 'Receita' },
  { valor: 'deducao', rotulo: 'Dedução' },
  { valor: 'custo', rotulo: 'Custo' },
  { valor: 'despesa', rotulo: 'Despesa' },
  { valor: 'financeiro', rotulo: 'Financeiro' },
  { valor: 'investimento', rotulo: 'Investimento' },
  { valor: 'outros', rotulo: 'Outros' },
]
const TIPOS_DESPESA = [
  { valor: 'fixa', rotulo: 'Despesa fixa' },
  { valor: 'variavel', rotulo: 'Despesa variável' },
]

export const PLANO_CONTAS: ConfigCadastro = {
  tabela: 'plano_contas',
  titulo: 'Plano de contas',
  singular: 'Subgrupo',
  ordem: 'ordem_codigo',
  explicacao:
    'Subgrupos do plano de contas, cada um dentro de um grupo (ex.: 2.6.2 Energia elétrica → 2.6 Despesas administrativas). É isso que monta a DRE gerencial por loja.',
  campos: [
    { chave: 'codigo', rotulo: 'Código', obrigatorio: true, naLista: true, dica: 'Ex.: 2.6.15' },
    { chave: 'nome', rotulo: 'Descrição', obrigatorio: true, naLista: true },
    { chave: 'grupo_dre_id', rotulo: 'Grupo', tipo: 'selecao', obrigatorio: true, opcoesDe: { tabela: 'grupos_dre', rotulo: 'nome' }, naLista: true },
    { chave: 'natureza', rotulo: 'Natureza', tipo: 'selecao', naLista: true, opcoes: NATUREZAS },
    { chave: 'tipo_despesa', rotulo: 'Tipo de despesa', tipo: 'selecao', naLista: true, opcoes: TIPOS_DESPESA },
    { chave: 'operacional', rotulo: 'Operacional', tipo: 'sim_nao', naLista: true },
    { chave: 'ativo', rotulo: 'Ativa', tipo: 'sim_nao' },
  ],
}

export const GRUPOS_DRE: ConfigCadastro = {
  tabela: 'grupos_dre',
  titulo: 'Grupos do plano de contas',
  singular: 'Grupo',
  ordem: 'ordem_codigo',
  editaQuem: 'master',
  explicacao: 'Grupos do plano de contas (linhas da DRE gerencial), na ordem do código. Só o master altera.',
  campos: [
    { chave: 'codigo', rotulo: 'Código', obrigatorio: true, naLista: true, dica: 'Ex.: 2.6' },
    { chave: 'nome', rotulo: 'Descrição', obrigatorio: true, naLista: true },
    { chave: 'grupo_pai_id', rotulo: 'Dentro do grupo', tipo: 'selecao', opcoesDe: { tabela: 'grupos_dre', rotulo: 'nome' }, naLista: true },
    { chave: 'natureza', rotulo: 'Natureza', tipo: 'selecao', obrigatorio: true, naLista: true, opcoes: NATUREZAS },
    { chave: 'tipo_despesa', rotulo: 'Tipo de despesa', tipo: 'selecao', naLista: true, opcoes: TIPOS_DESPESA },
    { chave: 'operacional', rotulo: 'Operacional', tipo: 'sim_nao', naLista: true },
    { chave: 'ordem', rotulo: 'Ordem na DRE', tipo: 'numero', obrigatorio: true },
  ],
}

export const CENTROS_CUSTO: ConfigCadastro = {
  tabela: 'centros_custo',
  titulo: 'Centros de custo',
  singular: 'Centro de custo',
  ordem: 'nome',
  campos: [
    { chave: 'nome', rotulo: 'Nome', obrigatorio: true, naLista: true },
    { chave: 'ativo', rotulo: 'Ativo', tipo: 'sim_nao', naLista: true },
  ],
}

export const CONTAS_BANCARIAS: ConfigCadastro = {
  tabela: 'contas_bancarias',
  titulo: 'Contas bancárias',
  singular: 'Conta bancária',
  ordem: 'descricao',
  editaQuem: 'master',
  explicacao: 'Uma conta corrente por empresa (Santander), com a chave PIX. O saldo inicial é o ponto de partida da conciliação.',
  campos: [
    { chave: 'loja_id', rotulo: 'Loja', tipo: 'selecao', obrigatorio: true, opcoesDe: { tabela: 'lojas', rotulo: 'apelido' }, naLista: true },
    { chave: 'descricao', rotulo: 'Descrição', obrigatorio: true, naLista: true, dica: 'Ex.: Santander Terra C/C' },
    { chave: 'banco_codigo', rotulo: 'Banco (código)', obrigatorio: true, naLista: true, dica: '033 = Santander' },
    { chave: 'agencia', rotulo: 'Agência', naLista: true },
    { chave: 'conta', rotulo: 'Conta', naLista: true },
    {
      chave: 'pix_tipo',
      rotulo: 'Tipo da chave PIX',
      tipo: 'selecao',
      opcoes: [
        { valor: 'cnpj', rotulo: 'CNPJ' },
        { valor: 'cpf', rotulo: 'CPF' },
        { valor: 'email', rotulo: 'E-mail' },
        { valor: 'telefone', rotulo: 'Telefone' },
        { valor: 'aleatoria', rotulo: 'Aleatória' },
      ],
    },
    { chave: 'pix_chave', rotulo: 'Chave PIX', naLista: true },
    { chave: 'saldo_inicial', rotulo: 'Saldo inicial', tipo: 'dinheiro', naLista: true },
    { chave: 'data_saldo_inicial', rotulo: 'Data do saldo inicial', tipo: 'data' },
    { chave: 'ativo', rotulo: 'Ativa', tipo: 'sim_nao' },
  ],
}

export const FORMAS_PAGAMENTO: ConfigCadastro = {
  tabela: 'formas_pagamento',
  titulo: 'Formas de pagamento',
  singular: 'Forma de pagamento',
  ordem: 'nome',
  campos: [
    { chave: 'nome', rotulo: 'Nome', obrigatorio: true, naLista: true },
    { chave: 'ativo', rotulo: 'Ativa', tipo: 'sim_nao', naLista: true },
  ],
}
