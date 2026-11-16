// Consulta pública de CNPJ (dados abertos da Receita Federal).
// Só o número do CNPJ é enviado. Fonte principal: BrasilAPI; reserva: CNPJá (consulta aberta).
import { cnpjValido, soDigitos } from './documentos'

export interface DadosReceita {
  razao_social: string
  nome_fantasia: string | null
  endereco: string | null
  bairro: string | null
  cidade: string | null
  uf: string | null
  cep: string | null
  telefone: string | null
  email: string | null
  cnae_principal: string | null
  situacao_cadastral: string | null
  fonte: 'BrasilAPI' | 'CNPJá'
}

const vazioParaNull = (v: unknown): string | null => {
  const t = String(v ?? '').trim()
  return t ? t : null
}

const juntar = (...partes: unknown[]) => vazioParaNull(partes.map(p => String(p ?? '').trim()).filter(Boolean).join(', '))

const telefone = (t: string | null) => {
  const d = soDigitos(t)
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  return vazioParaNull(t)
}

const cnae = (codigo: unknown, texto: unknown) => {
  const c = soDigitos(String(codigo ?? '')).padStart(7, '0')
  const fmt = c.length === 7 && c !== '0000000' ? `${c.slice(0, 2)}.${c.slice(2, 4)}-${c.slice(4, 5)}-${c.slice(5)} ` : ''
  return vazioParaNull(`${fmt}${texto ?? ''}`)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function deBrasilApi(d: any): DadosReceita {
  return {
    razao_social: String(d.razao_social ?? '').trim(),
    nome_fantasia: vazioParaNull(d.nome_fantasia),
    endereco: juntar(
      [d.descricao_tipo_de_logradouro, d.logradouro].filter(Boolean).join(' '),
      d.numero,
      d.complemento,
    ),
    bairro: vazioParaNull(d.bairro),
    cidade: vazioParaNull(d.municipio),
    uf: vazioParaNull(d.uf),
    cep: vazioParaNull(soDigitos(d.cep)),
    telefone: telefone(d.ddd_telefone_1),
    email: vazioParaNull(d.email)?.toLowerCase() ?? null,
    cnae_principal: cnae(d.cnae_fiscal, d.cnae_fiscal_descricao),
    situacao_cadastral: vazioParaNull(d.descricao_situacao_cadastral)?.toUpperCase() ?? null,
    fonte: 'BrasilAPI',
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function deCnpja(d: any): DadosReceita {
  const a = d.address ?? {}
  const f = d.phones?.[0]
  return {
    razao_social: String(d.company?.name ?? '').trim(),
    nome_fantasia: vazioParaNull(d.alias),
    endereco: juntar(a.street, a.number, a.details),
    bairro: vazioParaNull(a.district),
    cidade: vazioParaNull(a.city),
    uf: vazioParaNull(a.state),
    cep: vazioParaNull(soDigitos(a.zip)),
    telefone: f ? telefone(`${f.area}${f.number}`) : null,
    email: vazioParaNull(d.emails?.[0]?.address)?.toLowerCase() ?? null,
    cnae_principal: cnae(d.mainActivity?.id, d.mainActivity?.text),
    situacao_cadastral: vazioParaNull(d.status?.text)?.toUpperCase() ?? null,
    fonte: 'CNPJá',
  }
}

async function buscarJson(url: string, ms = 8000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    const r = await fetch(url, { signal: ctrl.signal })
    return { status: r.status, json: r.ok ? await r.json() : null }
  } finally {
    clearTimeout(t)
  }
}

export async function consultarCnpj(doc: string): Promise<DadosReceita> {
  const cnpj = soDigitos(doc)
  if (!cnpjValido(cnpj)) throw new Error('Digite um CNPJ válido para consultar. (CPF não tem consulta pública.)')
  // A BrasilAPI às vezes responde "não encontrado" para CNPJ que existe:
  // só concluímos "não encontrado" se a fonte reserva também disser isso.
  try {
    const r = await buscarJson(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`)
    if (r.json) return deBrasilApi(r.json)
  } catch {
    // fora do ar: segue para a reserva
  }
  let status = 0
  try {
    const r = await buscarJson(`https://open.cnpja.com/office/${cnpj}`)
    if (r.json) return deCnpja(r.json)
    status = r.status
  } catch {
    // fora do ar
  }
  if (status === 404) throw new Error('CNPJ não encontrado na Receita Federal.')
  if (status === 429) throw new Error('Muitas consultas seguidas. Aguarde um minuto e tente de novo.')
  throw new Error('Os serviços de consulta estão fora do ar agora. Preencha à mão ou tente mais tarde.')
}
