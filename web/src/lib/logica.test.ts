import { describe, expect, it } from 'vitest'
import { chaveNfeValida, cnpjValido, cpfValido, formatarDocumento } from './documentos'
import { conferir, matrizParaLinhas, sugerirMapeamento } from './importacao'

describe('documentos', () => {
  it('valida os CNPJs das 5 lojas', () => {
    for (const c of ['60.543.245/0001-97', '34.539.795/0001-22', '63.932.077/0001-10', '29.226.702/0001-70', '68.829.152/0001-35'])
      expect(cnpjValido(c)).toBe(true)
  })
  it('recusa CNPJ com dígito errado ou repetido', () => {
    expect(cnpjValido('60.543.245/0001-98')).toBe(false)
    expect(cnpjValido('11.111.111/1111-11')).toBe(false)
  })
  it('valida CPF', () => {
    expect(cpfValido('529.982.247-25')).toBe(true)
    expect(cpfValido('529.982.247-24')).toBe(false)
  })
  it('valida chave NF-e (mesma do teste do banco)', () => {
    expect(chaveNfeValida('26111160543245000197550010002954701000000014')).toBe(true)
    expect(chaveNfeValida('26111160543245000197550010002954701000000015')).toBe(false)
  })
  it('formata documento', () => {
    expect(formatarDocumento('60543245000197')).toBe('60.543.245/0001-97')
  })
})

describe('importação', () => {
  const matriz = [
    ['Relatório de Fornecedores - GRFood'],
    [],
    ['Razão Social', 'Nome Fantasia', 'CNPJ/CPF', 'Telefone'],
    ['FORNECEDOR A LTDA', 'A', '60.543.245/0001-97', '81 9999-0000'],
    ['FORNECEDOR B', '', '6.054.324.500.019', ''], // Excel comeu o zero? (13 dígitos inválido de propósito)
    ['FORNECEDOR C', '', '34539795000122', ''],
    ['FORNECEDOR A REPETIDO', '', '60543245000197', ''],
    ['', '', '', ''],
  ]

  it('acha o cabeçalho mesmo com título antes e ignora linhas vazias', () => {
    const { cabecalhos, linhas } = matrizParaLinhas(matriz)
    expect(cabecalhos).toEqual(['Razão Social', 'Nome Fantasia', 'CNPJ/CPF', 'Telefone'])
    expect(linhas).toHaveLength(4)
  })

  it('sugere as colunas certas', () => {
    const { cabecalhos } = matrizParaLinhas(matriz)
    const mapa = sugerirMapeamento(cabecalhos, 'fornecedores')
    expect(mapa.documento).toBe('CNPJ/CPF')
    expect(mapa.razao_social).toBe('Razão Social')
    expect(mapa.nome_fantasia).toBe('Nome Fantasia')
    expect(mapa.telefone).toBe('Telefone')
  })

  it('classifica cada linha: novo, atualizar, erro e repetido', () => {
    const { cabecalhos, linhas } = matrizParaLinhas(matriz)
    const r = conferir(linhas, sugerirMapeamento(cabecalhos, 'fornecedores'), 'fornecedores', {
      existentes: new Set(['34539795000122']),
    })
    expect(r[0].situacao).toBe('novo')
    expect(r[1].situacao).toBe('erro')
    expect(r[2].situacao).toBe('atualizar')
    expect(r[3].situacao).toBe('erro')
    expect(r[3].problemas[0]).toContain('Repetido')
  })

  it('recoloca zero à esquerda que o Excel apagou', () => {
    const r = conferir([{ doc: '7526557000100', nome: 'X' }], { documento: 'doc', razao_social: 'nome' }, 'fornecedores', {
      existentes: new Set(),
    })
    expect(r[0].dados.documento).toBe('07526557000100')
  })

  it('plano de contas: grupo desconhecido vira aviso, não erro', () => {
    const r = conferir(
      [{ Nome: 'Hortifruti', Grupo: 'cmv - custo da mercadoria' }, { Nome: 'Brinde', Grupo: 'Inexistente' }],
      { nome: 'Nome', grupo: 'Grupo' },
      'plano_contas',
      { existentes: new Set(), gruposDre: ['CMV - Custo da mercadoria'] },
    )
    expect(r[0].dados.grupo).toBe('CMV - Custo da mercadoria')
    expect(r[0].avisos).toHaveLength(0)
    expect(r[1].situacao).toBe('novo')
    expect(r[1].avisos[0]).toContain('não existe na DRE')
  })
})
