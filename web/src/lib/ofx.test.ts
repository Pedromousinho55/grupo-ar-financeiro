import { describe, expect, it } from 'vitest'
import { sugerir, sugestaoUnica, type ContaCandidata } from './conciliacao'
import { acharConta, dataOfx, decodificarOfx, lerOfx, valorOfx } from './ofx'

// Formato típico do Santander: OFX 1.x em SGML, sem tags de fechamento nos campos, CHARSET 1252
const OFX_SGML = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS><DTSERVER>20261120120000[-3:BRT]<LANGUAGE>POR</SONRS></SIGNONMSGSRSV1>
<BANKMSGSRSV1><STMTTRNRS><TRNUID>1<STATUS><CODE>0<SEVERITY>INFO</STATUS>
<STMTRS><CURDEF>BRL
<BANKACCTFROM><BANKID>033<BRANCHID>4661<ACCTID>130072785<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST><DTSTART>20261101000000[-3:BRT]<DTEND>20261119000000[-3:BRT]
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261110000000[-3:BRT]<TRNAMT>-339.00<FITID>20261110001<CHECKNUM>001234<MEMO>PAGAMENTO DE BOLETO</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261113000000[-3:BRT]<TRNAMT>-12,50<FITID>20261113001<MEMO>TARIFA MENSALIDADE PACOTE SERVIÇOS</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261114000000[-3:BRT]<TRNAMT>2012.50<FITID>20261114001<MEMO>PIX RECEBIDO</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261114000000[-3:BRT]<TRNAMT>-10.00<MEMO>TARIFA PIX</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261114000000[-3:BRT]<TRNAMT>-10.00<MEMO>TARIFA PIX</STMTTRN>
</BANKTRANLIST><LEDGERBAL><BALAMT>1641.00<DTASOF>20261119000000[-3:BRT]</LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`

// OFX 2.x em XML
const OFX_XML = `<?xml version="1.0" encoding="UTF-8"?><?OFX OFXHEADER="200" VERSION="211"?>
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKACCTFROM><BANKID>033</BANKID><BRANCHID>4661</BRANCHID><ACCTID>13006866-5</ACCTID></BANKACCTFROM>
<BANKTRANLIST><DTSTART>20261101</DTSTART><DTEND>20261119</DTEND>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20261105</DTPOSTED><TRNAMT>-1285.49</TRNAMT><FITID>A1</FITID><MEMO>PIX ENVIADO RATIONAL</MEMO></STMTTRN>
</BANKTRANLIST><LEDGERBAL><BALAMT>-50.00</BALAMT><DTASOF>20261119</DTASOF></LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`

describe('leitura do OFX', () => {
  it('lê o formato SGML do Santander', () => {
    const e = lerOfx(OFX_SGML)
    expect(e).toMatchObject({ banco: '033', agencia: '4661', conta: '130072785', inicio: '2026-11-01', fim: '2026-11-19', saldoFinal: 1641, saldoData: '2026-11-19' })
    expect(e.transacoes).toHaveLength(5)
    expect(e.transacoes[0]).toEqual({ fitid: '20261110001', data: '2026-11-10', valor: -339, descricao: 'PAGAMENTO DE BOLETO', documento: '001234', tipo: 'DEBIT' })
    expect(e.transacoes[1].valor).toBe(-12.5)
    expect(e.transacoes[2].valor).toBe(2012.5)
  })
  it('sem FITID: cria um identificador estável e diferencia repetições', () => {
    const t = lerOfx(OFX_SGML).transacoes
    expect(t[3].fitid).toBe('2026-11-14|-10.00||TARIFA PIX')
    expect(t[4].fitid).toBe('2026-11-14|-10.00||TARIFA PIX#2')
    // ler de novo dá os mesmos identificadores (reimportar não duplica)
    expect(lerOfx(OFX_SGML).transacoes.map(x => x.fitid)).toEqual(t.map(x => x.fitid))
  })
  it('lê o formato XML', () => {
    const e = lerOfx(OFX_XML)
    expect(e.conta).toBe('13006866-5')
    expect(e.saldoFinal).toBe(-50)
    expect(e.transacoes).toEqual([{ fitid: 'A1', data: '2026-11-05', valor: -1285.49, descricao: 'PIX ENVIADO RATIONAL', documento: null, tipo: 'DEBIT' }])
  })
  it('recusa arquivo que não é OFX', () => {
    expect(() => lerOfx('data;valor\n1;2')).toThrow(/OFX/)
  })
  it('respeita CHARSET 1252', () => {
    const bytes = new Uint8Array([...new TextEncoder().encode('CHARSET:1252\n<OFX><MEMO>SERVI'), 0xc7, 0x4f])
    expect(decodificarOfx(bytes.buffer)).toContain('SERVIÇO')
  })
  it('datas e valores', () => {
    expect(dataOfx('20261110120000[-3:BRT]')).toBe('2026-11-10')
    expect(valorOfx('-1.234,56')).toBe(-1234.56)
    expect(valorOfx('1,234.56')).toBe(1234.56)
    expect(valorOfx('abc')).toBeNull()
  })
  it('acha a conta cadastrada pelo número', () => {
    const contas = [
      { id: 'terra', agencia: '4661', conta: '13.007278-5' },
      { id: 'voar', agencia: '4661', conta: '13.006866-5' },
    ]
    expect(acharConta(lerOfx(OFX_SGML), contas)?.id).toBe('terra')
    expect(acharConta(lerOfx(OFX_XML), contas)?.id).toBe('voar')
    expect(acharConta({ ...lerOfx(OFX_XML), conta: '999' }, contas)).toBeNull()
  })
})

describe('sugestões de conciliação', () => {
  const conta = (id: string, valor: number, vencimento: string, status: ContaCandidata['status'] = 'aprovada', pago_em: string | null = null): ContaCandidata => ({
    id,
    valor,
    vencimento,
    status,
    pago_em,
    valor_pago: pago_em ? valor : null,
  })
  it('mesmo valor e data próxima, da mais provável para a menos', () => {
    const contas = [conta('longe', 339, '2026-11-19'), conta('perto', 339, '2026-11-10'), conta('outro valor', 340, '2026-11-10'), conta('fora', 339, '2026-12-30')]
    const s = sugerir({ data: '2026-11-10', valor: -339 }, contas, new Set())
    expect(s.map(x => x.conta.id)).toEqual(['perto', 'longe'])
    expect(sugestaoUnica(s)).toBeNull()
  })
  it('ignora contas já ligadas, canceladas e entradas', () => {
    const contas = [conta('ligada', 50, '2026-11-10'), conta('cancelada', 50, '2026-11-10', 'cancelada'), conta('ok', 50, '2026-11-11')]
    const s = sugerir({ data: '2026-11-10', valor: -50 }, contas, new Set(['ligada']))
    expect(s.map(x => x.conta.id)).toEqual(['ok'])
    expect(sugestaoUnica(s)?.id).toBe('ok')
    expect(sugerir({ data: '2026-11-10', valor: 50 }, contas, new Set())).toEqual([])
  })
  it('conta já paga à mão casa pela data do pagamento; "a aprovar" não entra no lote', () => {
    const paga = conta('paga', 80, '2026-11-01', 'paga', '2026-11-09')
    expect(sugestaoUnica(sugerir({ data: '2026-11-10', valor: -80 }, [paga], new Set()))?.id).toBe('paga')
    const aAprovar = sugerir({ data: '2026-11-10', valor: -90 }, [conta('aa', 90, '2026-11-10', 'a_aprovar')], new Set())
    expect(aAprovar).toHaveLength(1)
    expect(sugestaoUnica(aAprovar)).toBeNull()
  })
})
