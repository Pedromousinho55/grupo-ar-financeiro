// Extrato do Santander exportado em planilha (colunas Data, Histórico, Documento, Valor, Saldo).
import { valorOfx, type ExtratoOfx, type TransacaoOfx } from './ofx'

const sem = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ�]/g, '')
    .toLowerCase()

/** "19/11/2026" ou número de série do Excel → "2026-11-19" */
export function dataPlanilha(v: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v.trim())
  if (m) return `${m[3]}-${m[2]}-${m[1]}`
  const n = Number(v)
  if (Number.isFinite(n) && n > 30000 && n < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000).toISOString().slice(0, 10)
  return null
}

export interface ExtratoPlanilha extends ExtratoOfx {
  futuras: number // lançamentos com data depois de hoje (agendados): ficam de fora
}

/**
 * Lê as linhas da planilha. Lançamentos com data futura (agendamentos) são ignorados.
 * O saldo final é o último saldo de fim de dia até hoje.
 */
export function lerExtratoPlanilha(linhas: string[][], hoje: string): ExtratoPlanilha {
  const iCab = linhas.findIndex(l => l.some(c => sem(c) === 'data') && l.some(c => sem(c) === 'valor'))
  if (iCab < 0) throw new Error('Planilha sem as colunas "Data" e "Valor": não parece um extrato do Santander.')
  const cab = linhas[iCab].map(sem)
  const col = (...nomes: string[]) => cab.findIndex(c => nomes.some(n => c.startsWith(n)))
  const cData = col('data')
  const cHist = col('hist', 'descricao', 'lancamento') // 'hist' cobre "Histórico" mesmo com acento estragado
  const cDoc = col('documento', 'doc')
  const cValor = col('valor')
  const cSaldo = col('saldo')

  const transacoes: TransacaoOfx[] = []
  const vistos = new Map<string, number>()
  let futuras = 0
  let saldoFinal: number | null = null
  let saldoData: string | null = null
  for (const l of linhas.slice(iCab + 1)) {
    const data = dataPlanilha(l[cData] ?? '')
    const valor = valorOfx(l[cValor] ?? '')
    if (!data || valor === null || valor === 0) continue
    if (data > hoje) {
      futuras++
      continue
    }
    const descricao = (l[cHist] ?? '').replace(/\s{2,}/g, ' · ').trim() || null
    const documentoBruto = cDoc >= 0 ? (l[cDoc] ?? '').trim() : ''
    const documento = documentoBruto && !/^0+$/.test(documentoBruto) ? documentoBruto : null
    const base = `${data}|${valor.toFixed(2)}|${documento ?? ''}|${descricao ?? ''}`
    const n = (vistos.get(base) ?? 0) + 1
    vistos.set(base, n)
    transacoes.push({ fitid: n === 1 ? base : `${base}#${n}`, data, valor, descricao, documento, tipo: valor < 0 ? 'DEBIT' : 'CREDIT' })
    const saldo = cSaldo >= 0 ? valorOfx(l[cSaldo] ?? '') : null
    if (saldo !== null && (l[cSaldo] ?? '').trim() !== '') {
      saldoFinal = saldo
      saldoData = data
    }
  }
  const datas = transacoes.map(t => t.data).sort()
  return {
    banco: '033',
    agencia: null,
    conta: null,
    inicio: datas[0] ?? null,
    fim: datas[datas.length - 1] ?? null,
    saldoFinal,
    saldoData,
    transacoes,
    futuras,
  }
}

/** A planilha não traz o número da conta: reconhece pelo nome do arquivo (ex.: "Extrato_Lara Pina.xlsx" → "Santander Lara Pina"). */
export function contaPeloNome<T extends { descricao: string }>(arquivo: string, contas: T[]): T | null {
  const nome = sem(arquivo.replace(/\.[^.]+$/, '')).replace(/[^a-z0-9]+/g, ' ')
  const achadas = contas.filter(c => {
    const chave = sem(c.descricao)
      .replace(/santander|c\/c|conta corrente|servicos/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
    return chave && ` ${nome} `.includes(` ${chave} `)
  })
  return achadas.length === 1 ? achadas[0] : null
}
