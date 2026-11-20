import { describe, expect, it } from 'vitest'
import { contaPeloNome, dataPlanilha, lerExtratoPlanilha } from './extratoPlanilha'

// Mesmo layout das planilhas exportadas pelo Santander em 20/11/2026
const LINHAS = [
  ['Data', 'Hist�rico', 'Documento', 'Valor', 'Saldo'],
  ['03/11/2026', 'PIX RECEBIDO                       34539795000122', '262968', '3.625,57', ''],
  ['03/11/2026', 'PAGAMENTO DE BOLETO OUTROS BANCOS  ITAU UNIBANCO HOLDING S.A', '000000', '-9.285,57', ''],
  ['03/11/2026', 'PIX ENVIADO                        CEF MATRIZ', '000000', '-18,79', ''],
  ['03/11/2026', 'PIX ENVIADO                        CEF MATRIZ', '000000', '-18,79', '0,00'],
  ['10/11/2026', 'TARIFA MENSALIDADE PACOTE SERVICOS  OUTUBRO / 2026', '000000', '-237,00', '1.250,30'],
  ['23/11/2026', 'PIX ENVIADO                        VITOR HUGO', '000000', '-421,00', '-818,42'],
]

describe('extrato do Santander em planilha', () => {
  const e = lerExtratoPlanilha(LINHAS, '2026-11-20')
  it('lê os lançamentos e ignora os agendados (data futura)', () => {
    expect(e.transacoes).toHaveLength(5)
    expect(e.futuras).toBe(1)
    expect(e).toMatchObject({ inicio: '2026-11-03', fim: '2026-11-10', saldoFinal: 1250.3, saldoData: '2026-11-10' })
  })
  it('limpa o histórico e o documento zerado', () => {
    expect(e.transacoes[0]).toMatchObject({ valor: 3625.57, documento: '262968', descricao: 'PIX RECEBIDO · 34539795000122' })
    expect(e.transacoes[1]).toMatchObject({ valor: -9285.57, documento: null, descricao: 'PAGAMENTO DE BOLETO OUTROS BANCOS · ITAU UNIBANCO HOLDING S.A' })
  })
  it('dois lançamentos idênticos no mesmo dia viram identificadores diferentes e estáveis', () => {
    expect(e.transacoes[2].fitid).not.toBe(e.transacoes[3].fitid)
    expect(lerExtratoPlanilha(LINHAS, '2026-11-20').transacoes.map(t => t.fitid)).toEqual(e.transacoes.map(t => t.fitid))
  })
  it('recusa planilha que não é extrato', () => {
    expect(() => lerExtratoPlanilha([['Nome', 'CNPJ']], '2026-11-20')).toThrow(/extrato/)
  })
  it('datas em texto ou número do Excel', () => {
    expect(dataPlanilha('19/11/2026')).toBe('2026-11-19')
    expect(dataPlanilha('46345')).toBe('2026-11-19')
    expect(dataPlanilha('abc')).toBeNull()
  })
  it('reconhece a conta pelo nome do arquivo', () => {
    const contas = ['Santander Arvo', 'Santander Lara Jaqueira', 'Santander Lara Pina', 'Santander MDF Serviços', 'Santander SFC Serviços', 'Santander Terra', 'Santander Voar'].map(
      descricao => ({ descricao }),
    )
    const achar = (arq: string) => contaPeloNome(arq, contas)?.descricao
    expect(achar('Extrato_arvo.xlsx')).toBe('Santander Arvo')
    expect(achar('Extrato_Lara Pina.xlsx')).toBe('Santander Lara Pina')
    expect(achar('Extrato_Lara Jaqueira.xlsx')).toBe('Santander Lara Jaqueira')
    expect(achar('Extrato_MDF.xlsx')).toBe('Santander MDF Serviços')
    expect(achar('Extrato_voar.xlsx')).toBe('Santander Voar')
    expect(achar('Extrato_Lara.xlsx')).toBeUndefined()
  })
})
