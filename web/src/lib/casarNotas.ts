// Casar saída do extrato com nota fiscal: parcela (duplicata) de mesmo valor e vencimento próximo,
// ou nota sem duplicata com o mesmo valor total, emitida pouco antes do pagamento.
import type { Duplicata } from './nfe'

export interface NotaParaCasar {
  id: string
  numero: string | null
  emitente_nome: string | null
  fornecedor_id: string | null
  valor_total: number | null
  data_emissao: string | null
  duplicatas: Duplicata[]
}

export interface CasamentoNota {
  nota: NotaParaCasar
  parcela: string | null // "1/3"; null = nota inteira
  vencimento: string | null
  valor: number
  dias: number
}

export const FOLGA_PARCELA = 7 // dias entre o vencimento da duplicata e o pagamento
export const PRAZO_NOTA = 45 // nota sem duplicata: paga até 45 dias depois da emissão (ou 3 dias antes)

const dias = (a: string, b: string) => Math.round((Date.parse(a + 'T12:00:00Z') - Date.parse(b + 'T12:00:00Z')) / 86400000)
const centavos = (v: number | string | null) => Math.round(Math.abs(Number(v ?? 0)) * 100)
const dataRecife = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Recife' })

/** Chave de uma parcela já paga/lançada (para não casar duas vezes). */
export const chaveParcela = (notaId: string, parcela: string | null) => `${notaId}|${parcela ?? ''}`

export function casarComNotas(saida: { data: string; valor: number }, notas: NotaParaCasar[], usadas: Set<string>): CasamentoNota[] {
  if (saida.valor >= 0) return []
  const alvo = centavos(saida.valor)
  const res: CasamentoNota[] = []
  for (const n of notas) {
    const dups = (n.duplicatas ?? []).filter(d => d.vencimento && Number(d.valor) > 0)
    if (dups.length > 0) {
      dups.forEach((d, i) => {
        const parcela = dups.length > 1 ? `${i + 1}/${dups.length}` : null
        if (usadas.has(chaveParcela(n.id, parcela)) || centavos(d.valor) !== alvo) return
        const venc = String(d.vencimento).slice(0, 10)
        const dd = Math.abs(dias(saida.data, venc))
        if (dd <= FOLGA_PARCELA) res.push({ nota: n, parcela, vencimento: venc, valor: Number(d.valor), dias: dd })
      })
    } else if (n.data_emissao && centavos(n.valor_total) === alvo && !usadas.has(chaveParcela(n.id, null))) {
      const depois = dias(saida.data, dataRecife(n.data_emissao))
      if (depois >= -3 && depois <= PRAZO_NOTA) res.push({ nota: n, parcela: null, vencimento: null, valor: Number(n.valor_total), dias: Math.abs(depois) })
    }
  }
  // parcela com vencimento bate mais forte que nota inteira; depois, a mais próxima
  return res.sort((a, b) => Number(a.vencimento === null) - Number(b.vencimento === null) || a.dias - b.dias)
}

/** Para o lote: exatamente uma nota possível. */
export const casamentoUnico = (c: CasamentoNota[]): CasamentoNota | null => (c.length === 1 ? c[0] : null)
