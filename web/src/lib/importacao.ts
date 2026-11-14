// Leitura de planilhas (Excel/CSV) e conferência linha a linha antes de gravar.
import { documentoValido, soDigitos } from './documentos'

export type Linha = Record<string, string>

export type TipoImportacao = 'fornecedores' | 'plano_contas'

export interface CampoDestino {
  chave: string
  rotulo: string
  obrigatorio?: boolean
  /** palavras que, no cabeçalho da planilha, indicam esta coluna */
  pistas: string[]
}

export const CAMPOS: Record<TipoImportacao, CampoDestino[]> = {
  fornecedores: [
    { chave: 'documento', rotulo: 'CNPJ/CPF', obrigatorio: true, pistas: ['cnpj', 'cpf', 'documento', 'cnpj/cpf', 'cpf/cnpj'] },
    { chave: 'razao_social', rotulo: 'Razão social', obrigatorio: true, pistas: ['razao social', 'razão social', 'razao', 'nome', 'fornecedor'] },
    { chave: 'nome_fantasia', rotulo: 'Nome fantasia', pistas: ['fantasia', 'nome fantasia', 'apelido'] },
    { chave: 'banco_codigo', rotulo: 'Banco', pistas: ['banco', 'cod banco', 'código banco'] },
    { chave: 'agencia', rotulo: 'Agência', pistas: ['agencia', 'agência'] },
    { chave: 'conta', rotulo: 'Conta', pistas: ['conta', 'conta corrente', 'c/c'] },
    { chave: 'pix_chave', rotulo: 'Chave PIX', pistas: ['pix', 'chave pix'] },
    { chave: 'email', rotulo: 'E-mail', pistas: ['email', 'e-mail'] },
    { chave: 'telefone', rotulo: 'Telefone', pistas: ['telefone', 'fone', 'celular', 'whatsapp'] },
  ],
  plano_contas: [
    { chave: 'codigo', rotulo: 'Código', pistas: ['codigo', 'código', 'cod', 'classificacao', 'classificação'] },
    { chave: 'nome', rotulo: 'Nome da conta', obrigatorio: true, pistas: ['nome', 'descricao', 'descrição', 'plano de contas', 'conta'] },
    { chave: 'grupo', rotulo: 'Grupo (DRE)', pistas: ['grupo', 'grupo dre', 'categoria', 'tipo'] },
  ],
}

const normalizar = (t: string) =>
  t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()

/** Sugere qual coluna da planilha corresponde a cada campo (o usuário pode corrigir). */
export function sugerirMapeamento(cabecalhos: string[], tipo: TipoImportacao): Record<string, string> {
  const mapa: Record<string, string> = {}
  const usados = new Set<string>()
  for (const campo of CAMPOS[tipo]) {
    // 1º: cabeçalho idêntico a uma pista; 2º: cabeçalho que contém a pista
    const exato = cabecalhos.find(c => !usados.has(c) && campo.pistas.some(p => normalizar(c) === normalizar(p)))
    const parcial = exato ?? cabecalhos.find(c => !usados.has(c) && campo.pistas.some(p => normalizar(c).includes(normalizar(p))))
    if (parcial) {
      mapa[campo.chave] = parcial
      usados.add(parcial)
    }
  }
  return mapa
}

export type Situacao = 'novo' | 'atualizar' | 'erro'

export interface LinhaConferida {
  numero: number // linha na planilha (1 = cabeçalho)
  dados: Record<string, string>
  situacao: Situacao
  problemas: string[]
  avisos: string[]
}

export interface Contexto {
  /** documentos (fornecedores) ou nomes normalizados (plano de contas) que já existem no sistema */
  existentes: Set<string>
  /** grupos da DRE cadastrados (nomes) */
  gruposDre?: string[]
}

export function chaveIdentificacao(tipo: TipoImportacao, dados: Record<string, string>): string {
  return tipo === 'fornecedores' ? soDigitos(dados.documento) : normalizar(dados.nome ?? '')
}

export function conferir(
  linhas: Linha[],
  mapa: Record<string, string>,
  tipo: TipoImportacao,
  ctx: Contexto,
): LinhaConferida[] {
  const vistos = new Map<string, number>()
  return linhas.map((linha, i) => {
    const dados: Record<string, string> = {}
    for (const campo of CAMPOS[tipo]) {
      const col = mapa[campo.chave]
      dados[campo.chave] = col ? String(linha[col] ?? '').trim() : ''
    }
    const problemas: string[] = []
    const avisos: string[] = []
    for (const campo of CAMPOS[tipo]) {
      if (campo.obrigatorio && !dados[campo.chave]) problemas.push(`${campo.rotulo} vazio`)
    }
    if (tipo === 'fornecedores') {
      dados.documento = soDigitos(dados.documento)
      // Excel costuma "comer" zeros à esquerda de CNPJ/CPF
      if (dados.documento.length === 13) dados.documento = '0' + dados.documento
      if (dados.documento.length === 10) dados.documento = '0' + dados.documento
      if (dados.documento && !documentoValido(dados.documento)) problemas.push('CNPJ/CPF inválido (dígito verificador não confere)')
    }
    if (tipo === 'plano_contas' && dados.grupo && ctx.gruposDre) {
      const g = ctx.gruposDre.find(n => normalizar(n) === normalizar(dados.grupo))
      if (g) dados.grupo = g
      else avisos.push(`Grupo "${dados.grupo}" não existe na DRE: a conta entra sem grupo e você escolhe depois`)
    }
    const id = chaveIdentificacao(tipo, dados)
    if (id && vistos.has(id)) problemas.push(`Repetido na planilha (igual à linha ${vistos.get(id)})`)
    else if (id) vistos.set(id, i + 2)
    const situacao: Situacao = problemas.length ? 'erro' : ctx.existentes.has(id) ? 'atualizar' : 'novo'
    return { numero: i + 2, dados, situacao, problemas, avisos }
  })
}

// ---------------- leitura de arquivos ----------------

/** Transforma uma matriz (1ª linha = cabeçalho) em lista de objetos. Pula linhas vazias. */
export function matrizParaLinhas(matriz: unknown[][]): { cabecalhos: string[]; linhas: Linha[] } {
  // GRFood e outros sistemas às vezes têm título antes do cabeçalho: usa a 1ª linha com 2+ células preenchidas
  const inicio = matriz.findIndex(l => l.filter(c => String(c ?? '').trim() !== '').length >= 2)
  if (inicio < 0) return { cabecalhos: [], linhas: [] }
  const cabecalhos = matriz[inicio].map((c, i) => String(c ?? '').trim() || `Coluna ${i + 1}`)
  const linhas = matriz
    .slice(inicio + 1)
    .filter(l => l.some(c => String(c ?? '').trim() !== ''))
    .map(l => Object.fromEntries(cabecalhos.map((h, i) => [h, celulaParaTexto(l[i])])))
  return { cabecalhos, linhas }
}

function celulaParaTexto(c: unknown): string {
  if (c === null || c === undefined) return ''
  if (c instanceof Date) return c.toISOString().slice(0, 10)
  if (typeof c === 'number') return Number.isInteger(c) ? String(c) : String(c)
  return String(c).trim()
}

export async function lerArquivo(arquivo: File): Promise<{ cabecalhos: string[]; linhas: Linha[] }> {
  const nome = arquivo.name.toLowerCase()
  if (nome.endsWith('.xlsx')) {
    const { readSheet } = await import('read-excel-file/browser')
    const matriz = await readSheet(arquivo) // 1ª aba da planilha
    return matrizParaLinhas(matriz as unknown[][])
  }
  if (nome.endsWith('.csv') || nome.endsWith('.txt')) {
    const Papa = (await import('papaparse')).default
    const texto = await lerTextoComAcentos(arquivo)
    const r = Papa.parse<string[]>(texto, { skipEmptyLines: true, delimiter: '' })
    return matrizParaLinhas(r.data)
  }
  if (nome.endsWith('.xls')) {
    throw new Error('Arquivo .xls (Excel antigo): abra no Excel e use "Salvar como" → "Pasta de Trabalho do Excel (.xlsx)" ou CSV.')
  }
  throw new Error('Formato não reconhecido. Use .xlsx ou .csv')
}

/** CSV exportado no Windows costuma vir em Latin-1; se UTF-8 der caracteres estranhos, relê em Latin-1. */
async function lerTextoComAcentos(arquivo: File): Promise<string> {
  const buf = await arquivo.arrayBuffer()
  const utf8 = new TextDecoder('utf-8').decode(buf)
  return utf8.includes('�') ? new TextDecoder('windows-1252').decode(buf) : utf8
}
