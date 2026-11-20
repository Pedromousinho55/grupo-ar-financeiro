// Sugestões de conciliação: qual conta a pagar provavelmente corresponde a uma saída do extrato.

export interface ContaCandidata {
  id: string
  valor: number
  vencimento: string
  status: 'a_aprovar' | 'aprovada' | 'paga' | 'cancelada'
  pago_em: string | null
  valor_pago: number | null
}

export interface Sugestao<T extends ContaCandidata> {
  conta: T
  dias: number // distância em dias entre o banco e o vencimento/pagamento
}

/** Folga de datas: pagamento pode sair alguns dias antes ou depois do vencimento. */
export const FOLGA_DIAS = 10

const dias = (a: string, b: string) => Math.round((Date.parse(a + 'T12:00:00Z') - Date.parse(b + 'T12:00:00Z')) / 86400000)
const centavos = (v: number) => Math.round(Math.abs(v) * 100)

/**
 * Contas com o mesmo valor da saída e data próxima, da mais provável para a menos.
 * Conta já paga (baixa manual sem extrato) entra se o pagamento registrado tiver o mesmo valor e data próxima.
 */
export function sugerir<T extends ContaCandidata>(saida: { data: string; valor: number }, contas: T[], jaLigadas: Set<string>): Sugestao<T>[] {
  if (saida.valor >= 0) return []
  const alvo = centavos(saida.valor)
  return contas
    .filter(c => !jaLigadas.has(c.id) && c.status !== 'cancelada')
    .flatMap(c => {
      if (c.status === 'paga') {
        if (!c.pago_em || c.valor_pago === null || centavos(c.valor_pago) !== alvo) return []
        const d = Math.abs(dias(saida.data, c.pago_em))
        return d <= 3 ? [{ conta: c, dias: d }] : []
      }
      if (centavos(c.valor) !== alvo) return []
      const d = Math.abs(dias(saida.data, c.vencimento))
      return d <= FOLGA_DIAS ? [{ conta: c, dias: d }] : []
    })
    .sort((a, b) => a.dias - b.dias || (a.conta.status === 'aprovada' ? -1 : 1))
}

/** Sugestões que dá para confirmar em lote: exatamente uma conta possível e aprovada (ou já paga). */
export function sugestaoUnica<T extends ContaCandidata>(sugestoes: Sugestao<T>[]): T | null {
  if (sugestoes.length !== 1) return null
  const c = sugestoes[0].conta
  return c.status === 'aprovada' || c.status === 'paga' ? c : null
}
