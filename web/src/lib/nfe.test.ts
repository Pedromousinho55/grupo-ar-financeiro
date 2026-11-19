// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { caminhoDanfe, caminhoXml, conferirArquivos, lerNfe } from './nfe'

const CHAVE = '26111160543245000197550010002954701000000014'
const TERRA = '60543245000197'

const infNFe = (dest = TERRA, chave = CHAVE, mod = '55') => `
  <infNFe Id="NFe${chave}" versao="4.00">
    <ide><mod>${mod}</mod><serie>1</serie><nNF>295470</nNF><natOp>VENDA</natOp><tpNF>1</tpNF><dhEmi>2026-11-17T10:30:00-03:00</dhEmi></ide>
    <emit><CNPJ>34539795000122</CNPJ><xNome>FORNECEDOR TESTE LTDA</xNome><xFant>FORN</xFant><IE>123</IE></emit>
    <dest><CNPJ>${dest}</CNPJ><xNome>TERRA</xNome></dest>
    <det nItem="1"><prod><cProd>A1</cProd><xProd>QUEIJO</xProd><NCM>04069090</NCM><CFOP>5102</CFOP><uCom>KG</uCom><qCom>2.0000</qCom><vProd>100.00</vProd></prod></det>
    <det nItem="2"><prod><cProd>B2</cProd><xProd>PRESUNTO</xProd><NCM>16024900</NCM><CFOP>5102</CFOP><uCom>KG</uCom><qCom>1.0000</qCom><vProd>50.50</vProd></prod></det>
    <total><ICMSTot><vNF>150.50</vNF></ICMSTot></total>
    <cobr><dup><nDup>001</nDup><dVenc>2026-12-17</dVenc><vDup>75.25</vDup></dup><dup><nDup>002</nDup><dVenc>2027-01-17</dVenc><vDup>75.25</vDup></dup></cobr>
    <pag><detPag><tPag>15</tPag><vPag>150.50</vPag></detPag></pag>
    <infAdic><infCpl>Pedido 123</infCpl></infAdic>
  </infNFe>`

const nfeProc = (dest?: string, cStat = '100') => `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
  <NFe xmlns="http://www.portalfiscal.inf.br/nfe">${infNFe(dest)}</NFe>
  <protNFe versao="4.00"><infProt><chNFe>${CHAVE}</chNFe><cStat>${cStat}</cStat><nProt>126260000000001</nProt></infProt></protNFe>
</nfeProc>`

describe('lerNfe', () => {
  it('lê a nota completa com itens, duplicatas e protocolo', () => {
    const n = lerNfe(nfeProc())
    expect(n.chave).toBe(CHAVE)
    expect(n.emitente_cnpj).toBe('34539795000122')
    expect(n.emitente_nome).toBe('FORNECEDOR TESTE LTDA')
    expect(n.destinatario_cnpj).toBe(TERRA)
    expect(n.numero).toBe('295470')
    expect(n.serie).toBe('1')
    expect(n.data_emissao).toBe('2026-11-17T10:30:00-03:00')
    expect(n.valor_total).toBe('150.50')
    expect(n.situacao_sefaz).toBe('autorizada')
    expect(n.duplicatas).toEqual([
      { numero: '001', vencimento: '2026-12-17', valor: '75.25' },
      { numero: '002', vencimento: '2027-01-17', valor: '75.25' },
    ])
    expect(n.dados.itens).toHaveLength(2)
    expect(n.dados.itens[1].descricao).toBe('PRESUNTO')
    expect(n.dados.protocolo).toBe('126260000000001')
    expect(n.dados.forma_pagamento).toEqual(['15'])
    expect(n.dados.info_complementar).toBe('Pedido 123')
    expect(n.dados.sem_protocolo).toBeUndefined()
  })

  it('aceita XML sem protocolo (só <NFe>) e marca isso', () => {
    const n = lerNfe(`<NFe xmlns="http://www.portalfiscal.inf.br/nfe">${infNFe()}</NFe>`)
    expect(n.chave).toBe(CHAVE)
    expect(n.dados.sem_protocolo).toBe(true)
  })

  it('ignora a marca BOM no início do arquivo', () => {
    expect(lerNfe(String.fromCharCode(0xfeff) + nfeProc()).chave).toBe(CHAVE)
  })

  it('marca denegada pelo cStat do protocolo', () => {
    expect(lerNfe(nfeProc(TERRA, '302')).situacao_sefaz).toBe('denegada')
  })

  it('recusa com mensagem clara o que não é NF-e', () => {
    expect(() => lerNfe('isto não é xml')).toThrow('não é um XML válido')
    expect(() => lerNfe('<resNFe xmlns="http://www.portalfiscal.inf.br/nfe"/>')).toThrow('resumo')
    expect(() => lerNfe('<procEventoNFe xmlns="http://www.portalfiscal.inf.br/nfe"/>')).toThrow('evento')
    expect(() => lerNfe('<CTe/>')).toThrow('Não é um XML de NF-e')
    expect(() => lerNfe(`<NFe xmlns="http://www.portalfiscal.inf.br/nfe">${infNFe(TERRA, CHAVE, '65')}</NFe>`)).toThrow('NFC-e')
    expect(() => lerNfe(`<NFe xmlns="http://www.portalfiscal.inf.br/nfe">${infNFe(TERRA, CHAVE.slice(0, 43) + '5')}</NFe>`)).toThrow('Chave')
  })
})

describe('conferirArquivos', () => {
  const lojas = new Set([TERRA])

  it('classifica nova, completar resumo, já existe, outra empresa, repetida e erro', () => {
    const r = conferirArquivos(
      [
        { nome: 'a.xml', conteudo: nfeProc() },
        { nome: 'b.xml', conteudo: nfeProc() },
        { nome: 'c.xml', conteudo: 'lixo' },
      ],
      lojas,
      new Map(),
    )
    expect(r.map(x => x.situacao)).toEqual(['nova', 'repetida', 'erro'])
    expect(r[0].lojaCnpj).toBe(TERRA)

    expect(conferirArquivos([{ nome: 'a.xml', conteudo: nfeProc() }], lojas, new Map([[CHAVE, 'resumo']]))[0].situacao).toBe('completar')
    expect(conferirArquivos([{ nome: 'a.xml', conteudo: nfeProc() }], lojas, new Map([[CHAVE, 'completa']]))[0].situacao).toBe('ja_existe')
    expect(conferirArquivos([{ nome: 'a.xml', conteudo: nfeProc('11222333000181') }], lojas, new Map())[0].situacao).toBe('outra_empresa')
  })
})

describe('caminhos no Storage', () => {
  it('XML segue o padrão do coletor', () => {
    expect(caminhoXml(TERRA, '2026-11-17T10:30:00-03:00', CHAVE)).toBe(`${TERRA}/2026/11/${CHAVE}.xml`)
    expect(caminhoXml(TERRA, null, CHAVE)).toBe(`${TERRA}/sem-data/${CHAVE}.xml`)
  })
  it('DANFE ganha nome único (nunca substitui arquivo)', () => {
    const quando = new Date('2026-11-19T15:04:05Z')
    expect(caminhoDanfe(TERRA, CHAVE, 'Foto Nota.JPG', quando)).toBe(`${TERRA}/danfe/${CHAVE}-20261119T150405.jpg`)
  })
})
