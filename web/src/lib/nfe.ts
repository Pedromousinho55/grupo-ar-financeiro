// Leitura do XML de NF-e no navegador (envio manual de XML recebido por e-mail etc.).
// Espelha coletor/grupoar_coletor/nfe_xml.py: os campos gravados são os mesmos do coletor.
import { chaveNfeValida } from './documentos'

const NS = 'http://www.portalfiscal.inf.br/nfe'

export interface Duplicata {
  numero: string | null
  vencimento: string | null
  valor: string | null
}

export interface Item {
  codigo: string | null
  descricao: string | null
  ncm: string | null
  cfop: string | null
  unidade: string | null
  quantidade: string | null
  valor: string | null
}

export interface NotaLida {
  chave: string
  tipo_documento: 'completa'
  emitente_cnpj: string
  emitente_nome: string | null
  emitente_ie: string | null
  destinatario_cnpj: string | null
  numero: string | null
  serie: string | null
  data_emissao: string | null
  valor_total: string | null
  situacao_sefaz: 'autorizada' | 'denegada'
  duplicatas: Duplicata[]
  dados: {
    fantasia_emitente: string | null
    natureza_operacao: string | null
    tpNF: string | null
    protocolo: string | null
    info_complementar: string | null
    forma_pagamento: (string | null)[]
    itens: Item[]
    /** true quando o XML veio sem o protocolo de autorização da SEFAZ */
    sem_protocolo?: boolean
  }
}

/** Primeiro descendente com esse nome (no namespace da NF-e), seguindo o caminho "a/b/c". */
function achar(el: Element | null | undefined, caminho: string): Element | null {
  let atual: Element | null = el ?? null
  for (const nome of caminho.split('/')) {
    if (!atual) return null
    atual = Array.from(atual.children).find(f => f.localName === nome && (f.namespaceURI === NS || !f.namespaceURI)) ?? null
  }
  return atual
}

function todos(el: Element | null, nome: string): Element[] {
  if (!el) return []
  return Array.from(el.children).filter(f => f.localName === nome)
}

function txt(el: Element | null | undefined, caminho: string): string | null {
  const t = achar(el, caminho)?.textContent?.trim()
  return t ? t : null
}

/**
 * Lê o XML de uma NF-e (nfeProc com protocolo, ou NFe sem protocolo).
 * Lança Error com mensagem em português quando o arquivo não é uma NF-e válida.
 */
export function lerNfe(conteudo: string): NotaLida {
  const doc = new DOMParser().parseFromString(conteudo.trimStart(), 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Arquivo não é um XML válido.')
  const raiz = doc.documentElement
  let nfe: Element | null
  let prot: Element | null = null
  if (raiz.localName === 'nfeProc') {
    nfe = achar(raiz, 'NFe')
    prot = achar(raiz, 'protNFe/infProt')
  } else if (raiz.localName === 'NFe') {
    nfe = raiz
  } else if (raiz.localName === 'resNFe') {
    throw new Error('Este arquivo é só o resumo da nota (sem itens). Envie o XML completo.')
  } else if (/evento/i.test(raiz.localName)) {
    throw new Error('Este arquivo é um evento (ex.: cancelamento), não uma nota.')
  } else {
    throw new Error(`Não é um XML de NF-e (encontrado: ${raiz.localName}).`)
  }
  const inf = achar(nfe, 'infNFe')
  if (!inf) throw new Error('XML de NF-e sem o bloco infNFe.')
  if (txt(inf, 'ide/mod') && txt(inf, 'ide/mod') !== '55')
    throw new Error(`Modelo ${txt(inf, 'ide/mod')} não é NF-e (55). NFC-e e outros documentos não entram no cofre.`)

  const chave = (inf.getAttribute('Id') ?? '').replace(/^NFe/, '')
  if (!chaveNfeValida(chave)) throw new Error('Chave de acesso inválida no XML.')

  const ide = achar(inf, 'ide')
  const emit = achar(inf, 'emit')
  const dest = achar(inf, 'dest')
  const cStat = txt(prot, 'cStat')

  return {
    chave,
    tipo_documento: 'completa',
    emitente_cnpj: txt(emit, 'CNPJ') ?? txt(emit, 'CPF') ?? '',
    emitente_nome: txt(emit, 'xNome'),
    emitente_ie: txt(emit, 'IE'),
    destinatario_cnpj: txt(dest, 'CNPJ') ?? txt(dest, 'CPF'),
    numero: txt(ide, 'nNF'),
    serie: txt(ide, 'serie'),
    data_emissao: txt(ide, 'dhEmi') ?? txt(ide, 'dEmi'),
    valor_total: txt(inf, 'total/ICMSTot/vNF'),
    situacao_sefaz: cStat && ['110', '301', '302', '303'].includes(cStat) ? 'denegada' : 'autorizada',
    duplicatas: todos(achar(inf, 'cobr'), 'dup').map(d => ({
      numero: txt(d, 'nDup'),
      vencimento: txt(d, 'dVenc'),
      valor: txt(d, 'vDup'),
    })),
    dados: {
      fantasia_emitente: txt(emit, 'xFant'),
      natureza_operacao: txt(ide, 'natOp'),
      tpNF: txt(ide, 'tpNF'),
      protocolo: txt(prot, 'nProt'),
      info_complementar: txt(inf, 'infAdic/infCpl'),
      forma_pagamento: todos(achar(inf, 'pag'), 'detPag').map(p => txt(p, 'tPag')),
      itens: todos(inf, 'det').map(d => ({
        codigo: txt(d, 'prod/cProd'),
        descricao: txt(d, 'prod/xProd'),
        ncm: txt(d, 'prod/NCM'),
        cfop: txt(d, 'prod/CFOP'),
        unidade: txt(d, 'prod/uCom'),
        quantidade: txt(d, 'prod/qCom'),
        valor: txt(d, 'prod/vProd'),
      })),
      ...(prot ? {} : { sem_protocolo: true }),
    },
  }
}

/** Mesmo caminho que o coletor usa no Storage: <cnpj da loja>/<ano>/<mes>/<chave>.xml */
export function caminhoXml(cnpjLoja: string, dataEmissao: string | null, chave: string): string {
  const anoMes = (dataEmissao ?? '').slice(0, 7).replace('-', '/') || 'sem-data'
  return `${cnpjLoja}/${anoMes}/${chave}.xml`
}

/** DANFE (foto/PDF) fica ao lado: <cnpj>/danfe/<chave>-<momento>.<ext>. Arquivo nunca é substituído. */
export function caminhoDanfe(cnpjLoja: string, chave: string, nomeArquivo: string, agora = new Date()): string {
  const ext = (nomeArquivo.split('.').pop() ?? 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '') || 'pdf'
  const momento = agora.toISOString().replace(/[-:]/g, '').slice(0, 15)
  return `${cnpjLoja}/danfe/${chave}-${momento}.${ext}`
}

export type SituacaoEnvio = 'nova' | 'completar' | 'ja_existe' | 'outra_empresa' | 'repetida' | 'erro'

export interface ArquivoConferido {
  nome: string
  situacao: SituacaoEnvio
  mensagem: string
  nota?: NotaLida
  lojaCnpj?: string
  conteudo?: string
}

/**
 * Classifica os arquivos enviados antes de gravar.
 * lojas: CNPJs das nossas lojas; existentes: chave -> tipo_documento já no banco.
 */
export function conferirArquivos(
  arquivos: { nome: string; conteudo: string }[],
  lojas: Set<string>,
  existentes: Map<string, string>,
): ArquivoConferido[] {
  const vistas = new Set<string>()
  return arquivos.map(({ nome, conteudo }) => {
    let nota: NotaLida
    try {
      nota = lerNfe(conteudo)
    } catch (e) {
      return { nome, situacao: 'erro', mensagem: (e as Error).message }
    }
    const base = { nome, nota, conteudo }
    if (vistas.has(nota.chave)) return { ...base, situacao: 'repetida', mensagem: 'Mesma nota em outro arquivo desta seleção.' }
    vistas.add(nota.chave)
    if (!nota.destinatario_cnpj || !lojas.has(nota.destinatario_cnpj))
      return { ...base, situacao: 'outra_empresa', mensagem: 'O destinatário não é uma das nossas lojas.' }
    const atual = existentes.get(nota.chave)
    if (atual === 'resumo')
      return { ...base, lojaCnpj: nota.destinatario_cnpj, situacao: 'completar', mensagem: 'Já existia só o resumo: será completada com itens e duplicatas.' }
    if (atual) return { ...base, situacao: 'ja_existe', mensagem: 'Esta nota já está no cofre.' }
    return { ...base, lojaCnpj: nota.destinatario_cnpj, situacao: 'nova', mensagem: 'Nota nova.' }
  })
}
