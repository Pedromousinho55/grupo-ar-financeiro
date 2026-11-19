// Nomes e regras do contas a pagar usados pelas telas.
import type { Duplicata } from './nfe'

export type StatusConta = 'a_aprovar' | 'aprovada' | 'paga' | 'cancelada'

export const NOME_STATUS_CONTA: Record<StatusConta, string> = {
  a_aprovar: 'A aprovar',
  aprovada: 'Aprovada',
  paga: 'Paga',
  cancelada: 'Cancelada',
}

export const CLASSE_STATUS_CONTA: Record<StatusConta, string> = {
  a_aprovar: 'aviso',
  aprovada: 'neutro',
  paga: 'ok',
  cancelada: 'erro',
}

/** Data de hoje (AAAA-MM-DD) no fuso de Recife. */
export function hojeRecife(agora = new Date()): string {
  return agora.toLocaleDateString('en-CA', { timeZone: 'America/Recife' })
}

/** Soma dias a uma data AAAA-MM-DD. */
export function somaDias(data: string, dias: number): string {
  const d = new Date(data + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

/** Soma meses a uma data AAAA-MM-DD, sem pular mês (31/01 + 1 mês = 28 ou 29/02). */
export function somaMeses(data: string, meses: number): string {
  const [a, m, d] = data.split('-').map(Number)
  const alvo = new Date(Date.UTC(a, m - 1 + meses, 1, 12))
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0, 12)).getUTCDate()
  alvo.setUTCDate(Math.min(d, ultimo))
  return alvo.toISOString().slice(0, 10)
}

export type Prazo = 'vencida' | 'hoje' | 'semana' | null

/** Situação do vencimento de uma conta em aberto (paga/cancelada não vencem). */
export function prazoDe(vencimento: string, status: StatusConta, hoje = hojeRecife()): Prazo {
  if (status === 'paga' || status === 'cancelada') return null
  if (vencimento < hoje) return 'vencida'
  if (vencimento === hoje) return 'hoje'
  if (vencimento <= somaDias(hoje, 6)) return 'semana'
  return null
}

export interface ParcelaProposta {
  parcela: string | null
  vencimento: string
  valor: number
}

/**
 * Parcelas sugeridas ao lançar uma nota: as duplicatas do XML; sem duplicatas, uma parcela com o
 * valor total vencendo na emissão + prazo padrão do fornecedor (ou na própria emissão).
 */
export function parcelasDaNota(
  nota: { valor_total: number | string | null; data_emissao: string | null; duplicatas: Duplicata[] },
  prazoPadraoDias: number | null = null,
): ParcelaProposta[] {
  const dups = (nota.duplicatas ?? []).filter(d => d.vencimento && Number(d.valor) > 0)
  if (dups.length > 0)
    return dups.map((d, i) => ({
      parcela: `${i + 1}/${dups.length}`,
      vencimento: String(d.vencimento).slice(0, 10),
      valor: Number(d.valor),
    }))
  const emissao = nota.data_emissao ? hojeRecife(new Date(nota.data_emissao)) : hojeRecife()
  return [{ parcela: null, vencimento: somaDias(emissao, prazoPadraoDias ?? 0), valor: Number(nota.valor_total ?? 0) }]
}

/** Divide um valor em N parcelas iguais; centavos que sobram vão para a primeira. */
export function dividirValor(total: number, n: number): number[] {
  const centavos = Math.round(total * 100)
  const base = Math.floor(centavos / n)
  return Array.from({ length: n }, (_, i) => (base + (i === 0 ? centavos - base * n : 0)) / 100)
}

/** Forma de pagamento do XML (tPag) → nome do cadastro de formas de pagamento. */
export const FORMA_DO_XML: Record<string, string> = {
  '01': 'Dinheiro',
  '03': 'Cartão de crédito',
  '15': 'Boleto',
  '16': 'TED/Transferência',
  '17': 'PIX',
  '18': 'TED/Transferência',
}

/** Caminho do comprovante no Storage: <cnpj>/<ano>/<mes>/<id da conta>-<AAAAMMDDTHHMMSS>.<ext> */
export function caminhoComprovante(cnpjLoja: string, pagoEm: string, contaId: string, nomeArquivo: string, agora = new Date()): string {
  const ext = (nomeArquivo.split('.').pop() ?? 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '') || 'pdf'
  const carimbo = agora.toISOString().replace(/[-:]/g, '').slice(0, 15)
  return `${cnpjLoja}/${pagoEm.slice(0, 4)}/${pagoEm.slice(5, 7)}/${contaId}-${carimbo}.${ext}`
}

/** Converte "1.234,56" ou "1234.56" em número (null se inválido). */
export function lerValor(texto: string): number | null {
  const t = texto.trim().replace(/[R$\s]/g, '')
  if (!t) return null
  const normal = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t
  const n = Number(normal)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null
}
