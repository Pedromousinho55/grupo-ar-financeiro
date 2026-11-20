// Leitura de extratos OFX (formato "Money"/OFX 1.x em SGML, como o do Santander, e OFX 2.x em XML).

export interface TransacaoOfx {
  fitid: string
  data: string // AAAA-MM-DD
  valor: number // negativo = saída
  descricao: string | null
  documento: string | null
  tipo: string | null
}

export interface ExtratoOfx {
  banco: string | null
  agencia: string | null
  conta: string | null
  inicio: string | null
  fim: string | null
  saldoFinal: number | null
  saldoData: string | null
  transacoes: TransacaoOfx[]
}

/** Decodifica o arquivo respeitando o CHARSET do cabeçalho (o Santander costuma mandar 1252). */
export function decodificarOfx(bytes: ArrayBuffer): string {
  const inicio = new TextDecoder('latin1').decode(bytes.slice(0, 600))
  const charset = /CHARSET:\s*(\S+)/i.exec(inicio)?.[1] ?? /encoding="([^"]+)"/i.exec(inicio)?.[1] ?? ''
  if (/utf-?8/i.test(charset)) return new TextDecoder('utf-8').decode(bytes)
  if (/1252|8859|latin/i.test(charset) || charset === 'NONE') return new TextDecoder('windows-1252').decode(bytes)
  // sem cabeçalho: tenta UTF-8 e cai para 1252 se houver caracteres inválidos
  const utf = new TextDecoder('utf-8').decode(bytes)
  return utf.includes('�') ? new TextDecoder('windows-1252').decode(bytes) : utf
}

/** Valor de uma tag (funciona com e sem a tag de fechamento, como no SGML). */
function tag(bloco: string, nome: string): string | null {
  const m = new RegExp(`<${nome}>([^<\\r\\n]*)`, 'i').exec(bloco)
  const v = m?.[1]?.trim()
  return v ? v : null
}

function blocos(texto: string, nome: string): string[] {
  const res: string[] = []
  const re = new RegExp(`<${nome}>([\\s\\S]*?)(?=</${nome}>|<${nome}>|</BANKTRANLIST>)`, 'gi')
  let m: RegExpExecArray | null
  while ((m = re.exec(texto))) res.push(m[1])
  return res
}

/** "20261110120000[-3:BRT]" → "2026-11-10" */
export function dataOfx(v: string | null): string | null {
  const m = v ? /^(\d{4})(\d{2})(\d{2})/.exec(v) : null
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

/** "-1.234,56", "-1234.56" ou "1234,5" → número */
export function valorOfx(v: string | null): number | null {
  if (!v) return null
  let t = v.trim().replace(/\s/g, '')
  if (t.includes(',') && t.includes('.')) t = t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '')
  else if (t.includes(',')) t = t.replace(',', '.')
  const n = Number(t)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null
}

export function lerOfx(texto: string): ExtratoOfx {
  if (!/<OFX>/i.test(texto)) throw new Error('Arquivo não parece um extrato OFX.')
  const transacoes: TransacaoOfx[] = []
  const vistos = new Map<string, number>()
  for (const b of blocos(texto, 'STMTTRN')) {
    const data = dataOfx(tag(b, 'DTPOSTED'))
    const valor = valorOfx(tag(b, 'TRNAMT'))
    if (!data || valor === null || valor === 0) continue
    const memo = tag(b, 'MEMO') ?? tag(b, 'NAME')
    const documento = tag(b, 'CHECKNUM') ?? tag(b, 'REFNUM')
    // sem FITID (ou FITID repetido no mesmo arquivo): monta um a partir dos dados, numerando repetições
    const base = tag(b, 'FITID') ?? `${data}|${valor.toFixed(2)}|${documento ?? ''}|${memo ?? ''}`
    const n = (vistos.get(base) ?? 0) + 1
    vistos.set(base, n)
    transacoes.push({
      fitid: n === 1 ? base : `${base}#${n}`,
      data,
      valor,
      descricao: memo,
      documento,
      tipo: tag(b, 'TRNTYPE'),
    })
  }
  const saldo = blocos(texto, 'LEDGERBAL')[0] ?? ''
  return {
    banco: tag(texto, 'BANKID'),
    agencia: tag(texto, 'BRANCHID'),
    conta: tag(texto, 'ACCTID'),
    inicio: dataOfx(tag(texto, 'DTSTART')),
    fim: dataOfx(tag(texto, 'DTEND')),
    saldoFinal: valorOfx(tag(saldo, 'BALAMT')),
    saldoData: dataOfx(tag(saldo, 'DTASOF')),
    transacoes,
  }
}

const digitos = (t: string | null | undefined) => (t ?? '').replace(/\D/g, '')

/** Acha a conta cadastrada do extrato pelo número da conta (com ou sem agência/dígito, zeros à esquerda). */
export function acharConta<T extends { conta: string | null; agencia: string | null }>(extrato: ExtratoOfx, contas: T[]): T | null {
  const doArquivo = digitos(extrato.conta).replace(/^0+/, '')
  if (!doArquivo) return null
  const achadas = contas.filter(c => {
    const cad = digitos(c.conta).replace(/^0+/, '')
    if (!cad) return false
    const semDv = cad.slice(0, -1)
    return doArquivo === cad || doArquivo.endsWith(cad) || doArquivo === semDv || doArquivo.endsWith(semDv) || cad.endsWith(doArquivo)
  })
  return achadas.length === 1 ? achadas[0] : null
}
