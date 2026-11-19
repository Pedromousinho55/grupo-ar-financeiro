// Contas a pagar: lista com atalhos (vencidas, hoje, 7 dias, mês), filtros, totais e aprovação em lote.
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth'
import ContaDetalhe from '../components/ContaDetalhe'
import ContaForm from '../components/ContaForm'
import { CLASSE_STATUS_CONTA, NOME_STATUS_CONTA, hojeRecife, prazoDe, somaDias, type StatusConta } from '../lib/contas'
import { dataBr, dinheiro, limparBusca, mesDe } from '../lib/notas'
import { mensagemErro, supabase } from '../supabase'

export interface ContaLinha {
  id: string
  descricao: string
  documento: string | null
  parcela: string | null
  vencimento: string
  valor: number
  status: StatusConta
  nota_id: string | null
  comprovante_arquivo: string | null
  loja: { apelido: string } | null
  fornecedor: { razao_social: string; nome_fantasia: string | null } | null
  plano: { codigo: string | null; nome: string } | null
}

interface Filtravel {
  eq(coluna: string, valor: string): Filtravel
  in(coluna: string, valores: string[]): Filtravel
  gte(coluna: string, valor: string): Filtravel
  lte(coluna: string, valor: string): Filtravel
  or(filtro: string): Filtravel
}

const POR_PAGINA = 100
const COLUNAS =
  'id, descricao, documento, parcela, vencimento, valor, status, nota_id, comprovante_arquivo, loja:lojas(apelido), fornecedor:fornecedores(razao_social, nome_fantasia), plano:plano_contas(codigo, nome)'

type Atalho = 'abertas' | 'vencidas' | 'hoje' | 'semana' | 'mes' | 'a_aprovar' | 'pagas_mes'

interface Filtros {
  loja: string
  status: string // '' = todas; 'abertas' = a aprovar + aprovadas
  de: string
  ate: string
  busca: string
}

function filtrosDoAtalho(a: Atalho, loja = ''): Filtros {
  const hoje = hojeRecife()
  const mes = mesDe(new Date(hoje + 'T12:00:00'))
  const base = { loja, busca: '' }
  switch (a) {
    case 'vencidas':
      return { ...base, status: 'abertas', de: '', ate: somaDias(hoje, -1) }
    case 'hoje':
      return { ...base, status: 'abertas', de: hoje, ate: hoje }
    case 'semana':
      return { ...base, status: 'abertas', de: hoje, ate: somaDias(hoje, 6) }
    case 'mes':
      return { ...base, status: '', ...mes }
    case 'a_aprovar':
      return { ...base, status: 'a_aprovar', de: '', ate: '' }
    case 'pagas_mes':
      return { ...base, status: 'paga', ...mes }
    default:
      return { ...base, status: 'abertas', de: '', ate: mes.ate }
  }
}

const ATALHOS: [Atalho, string][] = [
  ['abertas', 'Em aberto até o fim do mês'],
  ['vencidas', 'Vencidas'],
  ['hoje', 'Vencem hoje'],
  ['semana', 'Próximos 7 dias'],
  ['mes', 'Todas do mês'],
  ['a_aprovar', 'A aprovar'],
]

export default function ContasPagar() {
  const { podeLancar, eMaster } = useAuth()
  const [params, setParams] = useSearchParams()
  const atalhoInicial = (params.get('atalho') as Atalho) || 'abertas'
  const [atalho, setAtalho] = useState<Atalho | ''>(atalhoInicial)
  const [filtros, setFiltros] = useState<Filtros>(() => filtrosDoAtalho(atalhoInicial))
  const [buscaDigitada, setBuscaDigitada] = useState('')
  const [lojas, setLojas] = useState<{ id: string; apelido: string }[]>([])
  const [contas, setContas] = useState<ContaLinha[]>([])
  const [total, setTotal] = useState<{ qtd: number; valor: number; vencidas: number; valorVencidas: number } | null>(null)
  const [pagina, setPagina] = useState(0)
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')
  const [carregando, setCarregando] = useState(false)
  const [aberta, setAberta] = useState<string | null>(null)
  const [nova, setNova] = useState(false)
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set())
  const [aprovando, setAprovando] = useState(false)

  useEffect(() => {
    supabase
      .from('lojas')
      .select('id, apelido')
      .order('apelido')
      .then(({ data }) => setLojas(data ?? []))
  }, [])

  useEffect(() => {
    const t = setTimeout(() => setFiltros(f => (f.busca === buscaDigitada ? f : { ...f, busca: buscaDigitada })), 400)
    return () => clearTimeout(t)
  }, [buscaDigitada])

  const aplicarFiltros = useCallback(
    <T,>(consulta: T): T => {
      let q = consulta as unknown as Filtravel
      if (filtros.loja) q = q.eq('loja_id', filtros.loja)
      if (filtros.status === 'abertas') q = q.in('status', ['a_aprovar', 'aprovada'])
      else if (filtros.status) q = q.eq('status', filtros.status)
      // contas pagas são filtradas pela data do pagamento; as demais, pelo vencimento
      const campo = filtros.status === 'paga' ? 'pago_em' : 'vencimento'
      if (filtros.de) q = q.gte(campo, filtros.de)
      if (filtros.ate) q = q.lte(campo, filtros.ate)
      const termo = limparBusca(filtros.busca)
      if (termo) q = q.or(`descricao.ilike.*${termo}*,documento.ilike.*${termo}*`)
      return q as unknown as T
    },
    [filtros],
  )

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro('')
    const lista = aplicarFiltros(supabase.from('contas_pagar').select(COLUNAS))
      .order('vencimento', { ascending: true })
      .order('descricao')
      .range(pagina * POR_PAGINA, pagina * POR_PAGINA + POR_PAGINA - 1)
    const valores = aplicarFiltros(supabase.from('contas_pagar').select('valor, vencimento, status', { count: 'exact' })).limit(20000)
    const [r1, r2] = await Promise.all([lista, valores])
    setCarregando(false)
    if (r1.error || r2.error) return setErro(mensagemErro(r1.error ?? r2.error))
    setContas((r1.data ?? []) as unknown as ContaLinha[])
    const linhas = (r2.data ?? []) as { valor: number; vencimento: string; status: StatusConta }[]
    const ativas = linhas.filter(l => l.status !== 'cancelada')
    const vencidas = ativas.filter(l => prazoDe(l.vencimento, l.status) === 'vencida')
    setTotal({
      qtd: r2.count ?? linhas.length,
      valor: ativas.reduce((s, l) => s + Number(l.valor), 0),
      vencidas: vencidas.length,
      valorVencidas: vencidas.reduce((s, l) => s + Number(l.valor), 0),
    })
    setMarcadas(new Set())
  }, [aplicarFiltros, pagina])

  useEffect(() => {
    carregar()
  }, [carregar])

  const escolherAtalho = (a: Atalho) => {
    setAtalho(a)
    setPagina(0)
    setBuscaDigitada('')
    setFiltros(filtrosDoAtalho(a, filtros.loja))
    setParams(a === 'abertas' ? {} : { atalho: a }, { replace: true })
  }

  const mudar = (campo: keyof Filtros, valor: string) => {
    setPagina(0)
    if (campo !== 'loja') setAtalho('')
    setFiltros(f => ({ ...f, [campo]: valor }))
  }

  const aprovaveis = contas.filter(c => c.status === 'a_aprovar')
  async function aprovarMarcadas() {
    setAprovando(true)
    setErro('')
    const { error, data } = await supabase.from('contas_pagar').update({ status: 'aprovada' }).in('id', [...marcadas]).eq('status', 'a_aprovar').select('id')
    setAprovando(false)
    if (error) return setErro(mensagemErro(error))
    setAviso(`${data?.length ?? 0} conta(s) aprovada(s).`)
    carregar()
  }

  const nomeDe = (c: ContaLinha) => c.fornecedor?.nome_fantasia || c.fornecedor?.razao_social || null
  const paginas = total ? Math.ceil(total.qtd / POR_PAGINA) : 0
  const hoje = hojeRecife()

  return (
    <section>
      <header className="titulo-pagina">
        <h1>Contas a pagar</h1>
        {podeLancar && (
          <button className="primario" onClick={() => setNova(true)}>
            + Nova conta
          </button>
        )}
      </header>
      <p className="explicacao">
        Contas lançadas a partir das notas fiscais (botão "Lançar no contas a pagar" na nota) ou à mão (aluguel, folha, impostos…).
        {eMaster ? ' Contas lançadas pela equipe aguardam a sua aprovação antes do pagamento.' : ' Contas lançadas por você aguardam a aprovação do Pedro antes do pagamento.'}
      </p>

      <div className="atalhos">
        {ATALHOS.map(([a, nome]) => (
          <button key={a} className={atalho === a ? 'ativo' : ''} onClick={() => escolherAtalho(a)}>
            {nome}
          </button>
        ))}
      </div>

      <div className="barra-filtros">
        <select value={filtros.loja} onChange={e => mudar('loja', e.target.value)} aria-label="Loja">
          <option value="">Todas as lojas</option>
          {lojas.map(l => (
            <option key={l.id} value={l.id}>
              {l.apelido}
            </option>
          ))}
        </select>
        <select value={filtros.status} onChange={e => mudar('status', e.target.value)} aria-label="Status">
          <option value="abertas">Em aberto (a aprovar + aprovadas)</option>
          <option value="">Todos os status</option>
          {Object.entries(NOME_STATUS_CONTA).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <label className="periodo">
          <span>{filtros.status === 'paga' ? 'Pagas de' : 'Vencimento de'}</span>
          <input type="date" value={filtros.de} onChange={e => mudar('de', e.target.value)} />
          <span>até</span>
          <input type="date" value={filtros.ate} onChange={e => mudar('ate', e.target.value)} />
        </label>
        <input placeholder="Descrição ou nº do documento" value={buscaDigitada} onChange={e => setBuscaDigitada(e.target.value)} aria-label="Buscar" />
      </div>

      {total && (
        <div className="totais-notas">
          <span>
            <b>{total.qtd.toLocaleString('pt-BR')}</b> conta(s)
          </span>
          <span>
            <b>{dinheiro(total.valor)}</b> {filtros.status === 'paga' ? 'pagos' : 'no total'}
          </span>
          {total.vencidas > 0 && (
            <span className="erro-txt">
              {total.vencidas} vencida(s) · {dinheiro(total.valorVencidas)}
            </span>
          )}
          {carregando && <span className="contagem">atualizando…</span>}
        </div>
      )}
      {erro && <p className="erro">{erro}</p>}
      {aviso && <p className="ok">{aviso}</p>}

      {eMaster && aprovaveis.length > 0 && (
        <div className="barra-lote">
          <label className="check">
            <input
              type="checkbox"
              checked={aprovaveis.every(c => marcadas.has(c.id))}
              onChange={e => setMarcadas(e.target.checked ? new Set(aprovaveis.map(c => c.id)) : new Set())}
            />
            Marcar todas a aprovar desta página ({aprovaveis.length})
          </label>
          <button className="primario" disabled={marcadas.size === 0 || aprovando} onClick={aprovarMarcadas}>
            {aprovando ? 'Aprovando…' : `Aprovar marcadas (${marcadas.size})`}
          </button>
        </div>
      )}

      <div className="tabela-rolagem">
        <table>
          <thead>
            <tr>
              {eMaster && <th aria-label="Marcar" />}
              <th>Vencimento</th>
              <th>Loja</th>
              <th>Fornecedor / descrição</th>
              <th>Documento</th>
              <th>Plano de contas</th>
              <th className="num">Valor</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {contas.map(c => {
              const prazo = prazoDe(c.vencimento, c.status, hoje)
              return (
                <tr key={c.id} className={`clicavel${c.status === 'cancelada' ? ' inativo' : ''}${prazo === 'vencida' ? ' sit-erro' : ''}`} onClick={() => setAberta(c.id)}>
                  {eMaster && (
                    <td onClick={e => e.stopPropagation()}>
                      {c.status === 'a_aprovar' && (
                        <input
                          type="checkbox"
                          className="marcador"
                          aria-label="Marcar para aprovar"
                          checked={marcadas.has(c.id)}
                          onChange={e =>
                            setMarcadas(m => {
                              const n = new Set(m)
                              if (e.target.checked) n.add(c.id)
                              else n.delete(c.id)
                              return n
                            })
                          }
                        />
                      )}
                    </td>
                  )}
                  <td className="nowrap">
                    {dataBr(c.vencimento)}
                    {prazo === 'vencida' && <div className="erro-txt">vencida</div>}
                    {prazo === 'hoje' && <div className="aviso-txt">hoje</div>}
                  </td>
                  <td>{c.loja?.apelido ?? '—'}</td>
                  <td>
                    {nomeDe(c) ?? c.descricao}
                    {nomeDe(c) && <div className="mudanca">{c.descricao}</div>}
                  </td>
                  <td className="nowrap">
                    {c.documento ?? '—'}
                    {c.parcela && <span className="contagem"> · {c.parcela}</span>}
                  </td>
                  <td className="mudanca">{c.plano ? `${c.plano.codigo ? c.plano.codigo + ' ' : ''}${c.plano.nome}` : '—'}</td>
                  <td className="num nowrap">{dinheiro(c.valor)}</td>
                  <td>
                    <span className={`selo ${CLASSE_STATUS_CONTA[c.status]}`}>{NOME_STATUS_CONTA[c.status]}</span>
                    {c.comprovante_arquivo && <span title="Comprovante anexado"> 📎</span>}
                  </td>
                </tr>
              )
            })}
            {contas.length === 0 && !carregando && (
              <tr>
                <td colSpan={eMaster ? 8 : 7} className="vazio">
                  Nenhuma conta com esses filtros.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {paginas > 1 && (
        <div className="paginacao">
          <button disabled={pagina === 0} onClick={() => setPagina(p => p - 1)}>
            ‹ Anteriores
          </button>
          <span className="contagem">
            Página {pagina + 1} de {paginas}
          </span>
          <button disabled={pagina + 1 >= paginas} onClick={() => setPagina(p => p + 1)}>
            Próximas ›
          </button>
        </div>
      )}

      {aberta && (
        <ContaDetalhe
          id={aberta}
          aoFechar={alterou => {
            setAberta(null)
            if (alterou) carregar()
          }}
        />
      )}
      {nova && (
        <ContaForm
          aoFechar={gravou => {
            setNova(false)
            if (gravou) {
              setAviso('Conta lançada.')
              carregar()
            }
          }}
        />
      )}
    </section>
  )
}
