import { describe, expect, it } from 'vitest'
import { casamentoUnico, casarComNotas, chaveParcela, type NotaParaCasar } from './casarNotas'

const nota = (id: string, valor: number, emissao: string, dups: [string, number][] = []): NotaParaCasar => ({
  id,
  numero: id,
  emitente_nome: 'F',
  fornecedor_id: null,
  valor_total: valor,
  data_emissao: emissao + 'T10:00:00-03:00',
  duplicatas: dups.map(([vencimento, v], i) => ({ numero: String(i + 1), vencimento, valor: v.toFixed(2) })),
})

describe('casar saída com nota fiscal', () => {
  const notas = [
    nota('A', 300, '2026-10-20', [
      ['2026-11-10', 150],
      ['2026-12-10', 150],
    ]),
    nota('B', 339, '2026-11-01'),
    nota('C', 339, '2026-08-01'), // emitida há muito tempo: fora do prazo
    nota('D', 90, '2026-11-05', [['2026-11-20', 90]]),
  ]
  it('parcela de mesmo valor com vencimento próximo', () => {
    const c = casarComNotas({ data: '2026-11-12', valor: -150 }, notas, new Set())
    expect(c.map(x => [x.nota.id, x.parcela])).toEqual([['A', '1/2']])
    expect(casamentoUnico(c)?.vencimento).toBe('2026-11-10')
  })
  it('nota sem duplicata pelo valor total, até 45 dias após a emissão', () => {
    const c = casarComNotas({ data: '2026-11-10', valor: -339 }, notas, new Set())
    expect(c.map(x => x.nota.id)).toEqual(['B'])
    expect(c[0].parcela).toBeNull()
  })
  it('duplicata única não ganha número de parcela; parcela já usada não volta', () => {
    expect(casarComNotas({ data: '2026-11-20', valor: -90 }, notas, new Set())[0].parcela).toBeNull()
    expect(casarComNotas({ data: '2026-11-12', valor: -150 }, notas, new Set([chaveParcela('A', '1/2')]))).toEqual([])
  })
  it('entrada, valor diferente ou data longe não casam', () => {
    expect(casarComNotas({ data: '2026-11-12', valor: 150 }, notas, new Set())).toEqual([])
    expect(casarComNotas({ data: '2026-11-12', valor: -151 }, notas, new Set())).toEqual([])
    expect(casarComNotas({ data: '2026-11-30', valor: -150 }, notas, new Set())).toEqual([])
  })
  it('duas notas possíveis: não entra no lote', () => {
    const c = casarComNotas({ data: '2026-11-10', valor: -339 }, [...notas, nota('E', 339, '2026-11-03')], new Set())
    expect(c).toHaveLength(2)
    expect(casamentoUnico(c)).toBeNull()
  })
})
