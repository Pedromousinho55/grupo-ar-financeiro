import { describe, expect, it } from 'vitest'
import { caminhoComprovante, dividirValor, hojeRecife, lerValor, parcelasDaNota, prazoDe, somaDias, somaMeses } from './contas'

describe('datas', () => {
  it('hoje no fuso de Recife', () => {
    // 02:00 UTC de 20/11 ainda é 19/11 em Recife (UTC-3)
    expect(hojeRecife(new Date('2026-11-20T02:00:00Z'))).toBe('2026-11-19')
  })
  it('soma dias e meses', () => {
    expect(somaDias('2026-12-30', 3)).toBe('2027-01-02')
    expect(somaMeses('2026-01-31', 1)).toBe('2026-02-28')
    expect(somaMeses('2026-11-05', 2)).toBe('2027-01-05')
  })
  it('prazo de vencimento', () => {
    const hoje = '2026-11-19'
    expect(prazoDe('2026-11-18', 'aprovada', hoje)).toBe('vencida')
    expect(prazoDe('2026-11-19', 'a_aprovar', hoje)).toBe('hoje')
    expect(prazoDe('2026-11-25', 'aprovada', hoje)).toBe('semana')
    expect(prazoDe('2026-11-26', 'aprovada', hoje)).toBeNull()
    expect(prazoDe('2026-11-01', 'paga', hoje)).toBeNull()
  })
})

describe('parcelas da nota', () => {
  it('usa as duplicatas do XML', () => {
    const p = parcelasDaNota({
      valor_total: 300,
      data_emissao: '2026-11-10T10:00:00-03:00',
      duplicatas: [
        { numero: '001', vencimento: '2026-12-10', valor: '150.00' },
        { numero: '002', vencimento: '2027-01-10', valor: '150.00' },
      ],
    })
    expect(p).toEqual([
      { parcela: '1/2', vencimento: '2026-12-10', valor: 150 },
      { parcela: '2/2', vencimento: '2027-01-10', valor: 150 },
    ])
  })
  it('sem duplicatas: valor total no prazo padrão do fornecedor', () => {
    expect(parcelasDaNota({ valor_total: '99.90', data_emissao: '2026-11-10T23:30:00-03:00', duplicatas: [] }, 28)).toEqual([
      { parcela: null, vencimento: '2026-12-08', valor: 99.9 },
    ])
  })
})

describe('valores', () => {
  it('divide sem perder centavos', () => {
    expect(dividirValor(100, 3)).toEqual([33.34, 33.33, 33.33])
    expect(dividirValor(100, 3).reduce((a, b) => a + b, 0)).toBeCloseTo(100, 2)
  })
  it('lê valor digitado', () => {
    expect(lerValor('1.234,56')).toBe(1234.56)
    expect(lerValor('R$ 99,9')).toBe(99.9)
    expect(lerValor('1234.5')).toBe(1234.5)
    expect(lerValor('abc')).toBeNull()
    expect(lerValor('')).toBeNull()
  })
  it('caminho do comprovante', () => {
    expect(caminhoComprovante('60543245000197', '2026-12-10', 'abc', 'Comprovante.PDF', new Date('2026-12-10T15:04:05Z'))).toBe(
      '60543245000197/2026/12/abc-20261210T150405.pdf',
    )
  })
})
