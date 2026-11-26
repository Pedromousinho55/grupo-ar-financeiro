// Conciliação: cada linha do extrato é ligada a uma conta a pagar, classificada como receita ou marcada como transferência.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth'
import ConciliarLinha, { type CandidataConta, type LinhaExtrato } from '../components/ConciliarLinha'
import { casamentoUnico, casarComNotas, chaveParcela, type CasamentoNota, type NotaParaCasar } from '../lib/casarNotas'
import { sugerir, sugestaoUnica } from '../lib/conciliacao'
import { NOME_ACAO, regraDaLinha, type Regra } from '../lib/regras'
import { somaDias } from '../lib/contas'
import { dataBr, dinheiro, mesDe } from '../lib/notas'
import { mensagemErro, supabase } from '../supabase'

interface ContaBanco {
  id: string
  descricao: string
  loja_id: string
}

const NOME_TIPO: Record<string, string> = { conta_pagar: 'Conta a pagar', receita: 'Receita', transferencia: 'Transferência' }

export default function Conciliacao() {
  const { podeLancar } = useAuth()
  const [params, setParams] = useSearchParams()
  const [contas, setContas] = useState<ContaBanco[]>([])
  const [contaId, setContaId] = useState(params.get('conta') ?? '')
  const [periodo, setPeriodo] = useState(mesDe())
  const [soPendentes, setSoPendentes] = useState(true)
  const [linhas, setLinhas] = useState<LinhaExtrato[]>([])
  const [candidatas, setCandidatas] = useState<CandidataConta[]>([])
  const [ligadas, setLigadas] = useState<Set<string>>(new Set())
  const [aberta, setAberta] = useState<LinhaExtrato | null>(null)
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [carregando, setCarregando] = useState(true)
  const [regras, setRegras] = useState<Regra[]>([])
  const [notas, setNotas] = useState<NotaParaCasar[]>([])
  const [parcelasUsadas, setParcelasUsadas] = useState<Set<string>>(new Set())

  useEffect(() => {
    supabase
      .from('contas_bancarias')
      .select('id, descricao, loja_id')
      .eq('ativo', true)
      .order('descricao')
      .then(({ data }) => {
        const cs = (data ?? []) as ContaBanco[]
        setContas(cs)
        setContaId(atual => atual || cs[0]?.id || '')
      })
  }, [])

  const conta = contas.find(c => c.id === contaId)

  const carregar = useCallback(async () => {
    if (!conta) return
    setErro('')
    setCarregando(true)
    supabase
      .from('regras_conciliacao')
      .select('*')
      .eq('ativo', true)
      .then(({ data }) => setRegras((data ?? []) as Regra[]))
    let q = supabase
      .from('extrato_lancamentos')
      .select('*, conta_pagar:contas_pagar(descricao, parcela), plano:plano_contas(codigo, nome), destino:contas_bancarias!extrato_lancamentos_conta_destino_id_fkey(descricao)')
      .eq('conta_bancaria_id', conta.id)
      .order('data')
      .order('valor')
      .limit(2000)
    if (periodo.de) q = q.gte('data', periodo.de)
    if (periodo.ate) q = q.lte('data', periodo.ate)
    if (soPendentes) q = q.eq('conciliado', false)
    const { data, error } = await q
    if (error) {
      setCarregando(false)
      return setErro(mensagemErro(error))
    }
    setLinhas((data ?? []) as unknown as LinhaExtrato[])
    // contas a pagar da mesma empresa com vencimento/pagamento perto do período
    const de = somaDias(periodo.de || '2000-01-01', -15)
    const ate = somaDias(periodo.ate || '2100-01-01', 15)
    const c = await supabase
      .from('contas_pagar')
      .select('id, descricao, parcela, valor, vencimento, status, pago_em, valor_pago, fornecedor:fornecedores(razao_social, nome_fantasia)')
      .eq('loja_id', conta.loja_id)
      .neq('status', 'cancelada')
      .or(`and(vencimento.gte.${de},vencimento.lte.${ate}),and(pago_em.gte.${de},pago_em.lte.${ate})`)
      .limit(5000)
    const cand = (c.data ?? []) as unknown as CandidataConta[]
    setCandidatas(cand)
    const ids = cand.map(x => x.id)
    const lig = new Set<string>()
    for (let i = 0; i < ids.length; i += 200) {
      const r = await supabase.from('extrato_lancamentos').select('conta_pagar_id').in('conta_pagar_id', ids.slice(i, i + 200))
      for (const x of r.data ?? []) lig.add(x.conta_pagar_id as string)
    }
    setLigadas(lig)
    // notas fiscais da empresa emitidas até ~4 meses antes do período (para casar boletos com parcelas)
    const desde = somaDias(periodo.de || '2000-01-01', -120)
    const notasLidas: NotaParaCasar[] = []
    for (let i = 0; ; i += 1000) {
      const { data: nd } = await supabase
        .from('notas_fiscais')
        .select('id, numero, emitente_nome, fornecedor_id, valor_total, data_emissao, duplicatas')
        .eq('loja_id', conta.loja_id)
        .eq('situacao_sefaz', 'autorizada')
        .gte('data_emissao', desde + 'T00:00:00-03:00')
        .range(i, i + 999)
      notasLidas.push(...((nd ?? []) as NotaParaCasar[]))
      if (!nd || nd.length < 1000) break
    }
    setNotas(notasLidas)
    const usadas = new Set<string>()
    const idsNotas = notasLidas.map(n => n.id)
    for (let i = 0; i < idsNotas.length; i += 200) {
      const { data: cp } = await supabase.from('contas_pagar').select('nota_id, parcela').in('nota_id', idsNotas.slice(i, i + 200)).neq('status', 'cancelada')
      for (const x of cp ?? []) usadas.add(chaveParcela(x.nota_id as string, (x.parcela as string | null) ?? null))
    }
    setParcelasUsadas(usadas)
    setCarregando(false)
  }, [conta, periodo, soPendentes])

  useEffect(() => {
    carregar()
  }, [carregar])

  const sugestoes = useMemo(() => {
    const m = new Map<string, ReturnType<typeof sugerir<CandidataConta>>>()
    for (const l of linhas) if (!l.conciliado && l.valor < 0) m.set(l.id, sugerir(l, candidatas, ligadas))
    return m
  }, [linhas, candidatas, ligadas])

  // regra que decide cada linha pendente (as automáticas já teriam sido aplicadas; aqui sobram as que só sugerem)
  const regraPorLinha = useMemo(() => {
    const m = new Map<string, Regra>()
    for (const l of linhas) {
      if (l.conciliado) continue
      const r = regraDaLinha(regras, l)
      if (r) m.set(l.id, r)
    }
    return m
  }, [linhas, regras])

  // confirmação em lote: uma única conta possível, sem a mesma conta sugerida para duas linhas
  const lote = useMemo(() => {
    const pares = linhas.flatMap(l => {
      const c = sugestaoUnica(sugestoes.get(l.id) ?? [])
      return c ? [{ linha: l, conta: c }] : []
    })
    const usos = new Map<string, number>()
    for (const p of pares) usos.set(p.conta.id, (usos.get(p.conta.id) ?? 0) + 1)
    return pares.filter(p => usos.get(p.conta.id) === 1)
  }, [linhas, sugestoes])
  // saídas sem conta a pagar sugerida: casar com parcela/total de nota fiscal
  const casamentos = useMemo(() => {
    const m = new Map<string, CasamentoNota[]>()
    for (const l of linhas)
      if (!l.conciliado && l.valor < 0 && (sugestoes.get(l.id) ?? []).length === 0) {
        const c = casarComNotas(l, notas, parcelasUsadas)
        if (c.length) m.set(l.id, c)
      }
    return m
  }, [linhas, notas, parcelasUsadas, sugestoes])
  // lote de notas: casamento único, e a mesma parcela não pode servir a duas linhas
  const loteNotas = useMemo(() => {
    const pares = linhas.flatMap(l => {
      const c = casamentoUnico(casamentos.get(l.id) ?? [])
      return c ? [{ linha: l, casamento: c }] : []
    })
    const usos = new Map<string, number>()
    for (const p of pares) {
      const k = chaveParcela(p.casamento.nota.id, p.casamento.parcela)
      usos.set(k, (usos.get(k) ?? 0) + 1)
    }
    return pares.filter(p => usos.get(chaveParcela(p.casamento.nota.id, p.casamento.parcela)) === 1)
  }, [linhas, casamentos])

  // linhas com regra e sem conta a pagar sugerida: confirmar a regra
  const loteRegras = useMemo(
    () => linhas.filter(l => !l.conciliado && regraPorLinha.has(l.id) && (sugestoes.get(l.id) ?? []).length === 0 && !casamentos.has(l.id)),
    [linhas, regraPorLinha, sugestoes, casamentos],
  )

  // pagamentos (conta/nota) e sugestões de regra são confirmados separadamente: regras "só sugere" pedem olhar caso a caso
  async function confirmarLote(tipo: 'pagamentos' | 'regras') {
    setOcupado(true)
    setErro('')
    let ok = 0
    const falhas: string[] = []
    for (const p of tipo === 'pagamentos' ? lote : []) {
      const { error } = await supabase.rpc('conciliar_com_conta', { p_lancamento: p.linha.id, p_conta: p.conta.id })
      if (error) falhas.push(`${dataBr(p.linha.data)} ${dinheiro(p.linha.valor)}: ${mensagemErro(error)}`)
      else ok++
    }
    for (const p of tipo === 'pagamentos' ? loteNotas : []) {
      const { error } = await supabase.rpc('conciliar_com_nota', {
        p_lancamento: p.linha.id,
        p_nota: p.casamento.nota.id,
        p_vencimento: p.casamento.vencimento,
        p_parcela: p.casamento.parcela,
      })
      if (error) falhas.push(`${dataBr(p.linha.data)} ${dinheiro(p.linha.valor)}: ${mensagemErro(error)}`)
      else ok++
    }
    for (const l of tipo === 'regras' ? loteRegras : []) {
      const { error } = await supabase.rpc('aplicar_regra', { p_lancamento: l.id, p_regra: regraPorLinha.get(l.id)!.id })
      if (error) falhas.push(`${dataBr(l.data)} ${dinheiro(l.valor)}: ${mensagemErro(error)}`)
      else ok++
    }
    setOcupado(false)
    setAviso(`${ok} linha(s) conciliada(s).${falhas.length ? '\n' + falhas.join('\n') : ''}`)
    carregar()
  }

  const totais = useMemo(() => {
    const ent = linhas.filter(l => l.valor > 0).reduce((s, l) => s + Number(l.valor), 0)
    const sai = linhas.filter(l => l.valor < 0).reduce((s, l) => s + Number(l.valor), 0)
    return { ent, sai, pend: linhas.filter(l => !l.conciliado).length }
  }, [linhas])

  const nomeFornecedor = (c: CandidataConta) => c.fornecedor?.nome_fantasia || c.fornecedor?.razao_social || c.descricao

  return (
    <section>
      <header className="titulo-pagina">
        <h1>Conciliação</h1>
      </header>
      <p className="explicacao">
        Cada linha do extrato precisa ser explicada: saída ligada a uma conta a pagar (ou criada na hora, já paga), entrada classificada como receita,
        ou transferência entre contas do grupo. Valor igual e data próxima aparecem como sugestão.
      </p>

      <div className="barra-filtros">
        <select
          value={contaId}
          onChange={e => {
            setContaId(e.target.value)
            setParams({ conta: e.target.value }, { replace: true })
          }}
          aria-label="Conta bancária"
        >
          {contas.map(c => (
            <option key={c.id} value={c.id}>
              {c.descricao}
            </option>
          ))}
        </select>
        <label className="periodo">
          <span>De</span>
          <input type="date" value={periodo.de} onChange={e => setPeriodo(p => ({ ...p, de: e.target.value }))} />
          <span>até</span>
          <input type="date" value={periodo.ate} onChange={e => setPeriodo(p => ({ ...p, ate: e.target.value }))} />
        </label>
        <label className="check">
          <input type="checkbox" checked={soPendentes} onChange={e => setSoPendentes(e.target.checked)} />
          Só pendentes
        </label>
      </div>

      <div className="totais-notas">
        <span>
          <b>{linhas.length}</b> linha(s)
        </span>
        <span>
          Entradas <b>{dinheiro(totais.ent)}</b>
        </span>
        <span>
          Saídas <b>{dinheiro(totais.sai)}</b>
        </span>
        {totais.pend > 0 && <span className="aviso-txt">{totais.pend} a conciliar</span>}
        {carregando && <span className="contagem">atualizando…</span>}
      </div>
      {erro && <p className="erro">{erro}</p>}
      {aviso && <p className="ok pre">{aviso}</p>}

      {podeLancar && lote.length + loteNotas.length + loteRegras.length > 0 && (
        <div className="barra-lote">
          <span>
            {lote.length > 0 && (
              <>
                <b>{lote.length}</b> saída(s) com uma única conta a pagar correspondente.{' '}
              </>
            )}
            {loteNotas.length > 0 && (
              <>
                <b>{loteNotas.length}</b> pagamento(s) que casam com uma única nota fiscal.{' '}
              </>
            )}
            {loteRegras.length > 0 && (
              <>
                <b>{loteRegras.length}</b> linha(s) com regra a confirmar.
              </>
            )}
          </span>
          <span className="botoes-lote">
            {lote.length + loteNotas.length > 0 && (
              <button className="primario" onClick={() => confirmarLote('pagamentos')} disabled={ocupado}>
                {ocupado ? 'Conciliando…' : `Confirmar ${lote.length + loteNotas.length} pagamento(s)`}
              </button>
            )}{' '}
            {loteRegras.length > 0 && (
              <button onClick={() => confirmarLote('regras')} disabled={ocupado}>
                {`Confirmar ${loteRegras.length} sugestão(ões) de regra`}
              </button>
            )}
          </span>
        </div>
      )}

      <div className="tabela-rolagem">
        <table>
          <thead>
            <tr>
              <th>Data</th>
              <th>Histórico do banco</th>
              <th className="num">Valor</th>
              <th>Conciliação</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map(l => {
              const sug = sugestoes.get(l.id) ?? []
              return (
                <tr key={l.id} className="clicavel" onClick={() => setAberta(l)}>
                  <td className="nowrap">{dataBr(l.data)}</td>
                  <td>
                    {l.descricao ?? '—'}
                    {l.documento && <div className="mudanca">doc. {l.documento}</div>}
                  </td>
                  <td className={`num nowrap ${l.valor < 0 ? 'saida' : 'entrada'}`}>{dinheiro(l.valor)}</td>
                  <td>
                    {l.conciliado ? (
                      <>
                        <span className="selo ok">{NOME_TIPO[l.tipo_conciliacao ?? ''] ?? 'Conciliada'}</span>
                        <div className="mudanca">
                          {l.tipo_conciliacao === 'conta_pagar' && `${l.conta_pagar?.descricao ?? ''}${l.conta_pagar?.parcela ? ` (${l.conta_pagar.parcela})` : ''}`}
                          {l.tipo_conciliacao === 'receita' && (l.plano ? `${l.plano.codigo ?? ''} ${l.plano.nome}` : '')}
                          {l.tipo_conciliacao === 'transferencia' && (l.destino ? `com ${l.destino.descricao}` : 'entre contas do grupo')}
                        </div>
                      </>
                    ) : sug.length === 0 && casamentos.has(l.id) ? (
                      <>
                        <span className="selo aviso">nota fiscal</span>
                        <div className="mudanca">
                          NF-e {casamentos.get(l.id)![0].nota.numero} · {casamentos.get(l.id)![0].nota.emitente_nome}
                          {casamentos.get(l.id)![0].parcela ? ` (${casamentos.get(l.id)![0].parcela})` : ''}
                          {casamentos.get(l.id)!.length > 1 && ` (+${casamentos.get(l.id)!.length - 1})`}
                        </div>
                      </>
                    ) : regraPorLinha.has(l.id) && sug.length === 0 ? (
                      <>
                        <span className="selo aviso">regra</span>
                        <div className="mudanca">
                          {regraPorLinha.get(l.id)!.nome} → {NOME_ACAO[regraPorLinha.get(l.id)!.acao]}
                        </div>
                      </>
                    ) : sug.length > 0 ? (
                      <>
                        <span className="selo aviso">sugestão</span>
                        <div className="mudanca">
                          {nomeFornecedor(sug[0].conta)} · venc. {dataBr(sug[0].conta.vencimento)}
                          {sug.length > 1 && ` (+${sug.length - 1})`}
                        </div>
                      </>
                    ) : (
                      <span className="selo neutro">pendente</span>
                    )}
                  </td>
                </tr>
              )
            })}
            {linhas.length === 0 && (
              <tr>
                <td colSpan={4} className="vazio">
                  {carregando ? 'Carregando…' : soPendentes ? 'Nada a conciliar neste período. 🎉' : 'Nenhum lançamento neste período. Importe o extrato em Bancos.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {aberta && conta && (
        <ConciliarLinha
          linha={aberta}
          lojaId={conta.loja_id}
          sugestoes={(sugestoes.get(aberta.id) ?? []).map(s => s.conta)}
          regra={regraPorLinha.get(aberta.id) ?? null}
          casamentos={casamentos.get(aberta.id) ?? []}
          aoFechar={alterou => {
            setAberta(null)
            if (alterou) carregar()
          }}
        />
      )}
    </section>
  )
}
