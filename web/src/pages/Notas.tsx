// Cofre de notas: lista das NF-e recebidas pelas lojas, com filtros e totais.
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth'
import NotaDetalhe from '../components/NotaDetalhe'
import { formatarDocumento, soDigitos } from '../lib/documentos'
import {
  CLASSE_STATUS,
  NOME_SITUACAO,
  NOME_STATUS,
  dataBr,
  dinheiro,
  intervaloEmissao,
  limparBusca,
  mesDe,
  type SituacaoSefaz,
  type StatusNota,
} from '../lib/notas'
import { mensagemErro, supabase } from '../supabase'

export interface NotaLinha {
  id: string
  chave: string
  loja_id: string | null
  emitente_cnpj: string
  emitente_nome: string | null
  fornecedor_id: string | null
  numero: string | null
  serie: string | null
  data_emissao: string | null
  valor_total: number | null
  tipo_documento: 'resumo' | 'completa'
  situacao_sefaz: SituacaoSefaz
  status: StatusNota
  pdf_arquivo: string | null
  loja: { apelido: string } | null
  fornecedor: { razao_social: string; nome_fantasia: string | null } | null
}

interface Filtravel {
  eq(coluna: string, valor: string): Filtravel
  gte(coluna: string, valor: string): Filtravel
  lt(coluna: string, valor: string): Filtravel
  or(filtro: string): Filtravel
}

const POR_PAGINA = 100
const COLUNAS =
  'id, chave, loja_id, emitente_cnpj, emitente_nome, fornecedor_id, numero, serie, data_emissao, valor_total, tipo_documento, situacao_sefaz, status, pdf_arquivo, loja:lojas(apelido), fornecedor:fornecedores(razao_social, nome_fantasia)'

interface Filtros {
  loja: string
  de: string
  ate: string
  status: string
  situacao: string
  tipo: string
  busca: string
}

export default function Notas() {
  const { podeLancar } = useAuth()
  const [lojas, setLojas] = useState<{ id: string; apelido: string }[]>([])
  const [cadastrados, setCadastrados] = useState<Set<string>>(new Set())
  const [filtros, setFiltros] = useState<Filtros>({ loja: '', ...mesDe(), status: '', situacao: '', tipo: '', busca: '' })
  const [buscaDigitada, setBuscaDigitada] = useState('')
  const [notas, setNotas] = useState<NotaLinha[]>([])
  const [total, setTotal] = useState<{ qtd: number; valor: number; canceladas: number } | null>(null)
  const [pagina, setPagina] = useState(0)
  const [erro, setErro] = useState('')
  const [carregando, setCarregando] = useState(false)
  const [aberta, setAberta] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('lojas')
      .select('id, apelido')
      .order('apelido')
      .then(({ data }) => setLojas(data ?? []))
    supabase
      .from('fornecedores')
      .select('documento')
      .then(({ data }) => setCadastrados(new Set((data ?? []).map(f => f.documento as string))))
  }, [])

  // a busca só dispara depois que a pessoa para de digitar
  useEffect(() => {
    const t = setTimeout(() => setFiltros(f => (f.busca === buscaDigitada ? f : { ...f, busca: buscaDigitada })), 400)
    return () => clearTimeout(t)
  }, [buscaDigitada])

  const aplicarFiltros = useCallback(
    <T,>(consulta: T): T => {
      // visão simplificada do construtor de consultas (os tipos completos do supabase-js são pesados demais aqui)
      let q = consulta as unknown as Filtravel
      const { inicio, fimExclusivo } = intervaloEmissao(filtros.de, filtros.ate)
      if (filtros.loja) q = q.eq('loja_id', filtros.loja)
      if (filtros.status) q = q.eq('status', filtros.status)
      if (filtros.situacao) q = q.eq('situacao_sefaz', filtros.situacao)
      if (filtros.tipo) q = q.eq('tipo_documento', filtros.tipo)
      if (inicio) q = q.gte('data_emissao', inicio)
      if (fimExclusivo) q = q.lt('data_emissao', fimExclusivo)
      const termo = limparBusca(filtros.busca)
      if (termo) {
        const dig = soDigitos(termo)
        const partes = [`emitente_nome.ilike.*${termo}*`]
        if (dig) partes.push(`numero.eq.${dig.replace(/^0+/, '') || '0'}`, `emitente_cnpj.like.*${dig}*`)
        if (dig.length === 44) partes.push(`chave.eq.${dig}`)
        q = q.or(partes.join(','))
      }
      return q as unknown as T
    },
    [filtros],
  )

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro('')
    const lista = aplicarFiltros(supabase.from('notas_fiscais').select(COLUNAS))
      .order('data_emissao', { ascending: false })
      .range(pagina * POR_PAGINA, pagina * POR_PAGINA + POR_PAGINA - 1)
    // totais: só os valores do período filtrado (leve, sem itens)
    const valores = aplicarFiltros(supabase.from('notas_fiscais').select('valor_total, situacao_sefaz', { count: 'exact' })).limit(20000)
    const [r1, r2] = await Promise.all([lista, valores])
    setCarregando(false)
    if (r1.error || r2.error) return setErro(mensagemErro(r1.error ?? r2.error))
    setNotas((r1.data ?? []) as unknown as NotaLinha[])
    const linhas = (r2.data ?? []) as { valor_total: number | null; situacao_sefaz: string }[]
    setTotal({
      qtd: r2.count ?? linhas.length,
      valor: linhas.filter(l => l.situacao_sefaz !== 'cancelada').reduce((s, l) => s + Number(l.valor_total ?? 0), 0),
      canceladas: linhas.filter(l => l.situacao_sefaz === 'cancelada').length,
    })
  }, [aplicarFiltros, pagina])

  useEffect(() => {
    carregar()
  }, [carregar])

  const mudar = (campo: keyof Filtros, valor: string) => {
    setPagina(0)
    setFiltros(f => ({ ...f, [campo]: valor }))
  }

  const nomeFornecedor = (n: NotaLinha) => n.fornecedor?.nome_fantasia || n.fornecedor?.razao_social || n.emitente_nome || formatarDocumento(n.emitente_cnpj)
  const paginas = total ? Math.ceil(total.qtd / POR_PAGINA) : 0

  return (
    <section>
      <header className="titulo-pagina">
        <h1>Notas fiscais</h1>
        {podeLancar && (
          <Link to="/notas/enviar" className="botao primario">
            + Enviar XML
          </Link>
        )}
      </header>
      <p className="explicacao">
        Notas emitidas contra as lojas (vindas da SEFAZ/Klaus ou enviadas aqui). Clique numa nota para ver itens, duplicatas e arquivos
        {podeLancar ? ', marcar o recebimento e anexar o DANFE' : ''}.
      </p>

      <div className="barra-filtros">
        <select value={filtros.loja} onChange={e => mudar('loja', e.target.value)} aria-label="Loja">
          <option value="">Todas as lojas</option>
          {lojas.map(l => (
            <option key={l.id} value={l.id}>
              {l.apelido}
            </option>
          ))}
        </select>
        <label className="periodo">
          <span>Emissão de</span>
          <input type="date" value={filtros.de} onChange={e => mudar('de', e.target.value)} />
          <span>até</span>
          <input type="date" value={filtros.ate} onChange={e => mudar('ate', e.target.value)} />
        </label>
        <select value={filtros.status} onChange={e => mudar('status', e.target.value)} aria-label="Status">
          <option value="">Todos os status</option>
          {Object.entries(NOME_STATUS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select value={filtros.situacao} onChange={e => mudar('situacao', e.target.value)} aria-label="Situação na SEFAZ">
          <option value="">Situação na SEFAZ: todas</option>
          {Object.entries(NOME_SITUACAO).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select value={filtros.tipo} onChange={e => mudar('tipo', e.target.value)} aria-label="Tipo">
          <option value="">XML completo ou resumo</option>
          <option value="completa">Só XML completo</option>
          <option value="resumo">Só resumo</option>
        </select>
        <input
          placeholder="Fornecedor, nº da nota, CNPJ ou chave"
          value={buscaDigitada}
          onChange={e => {
            setPagina(0)
            setBuscaDigitada(e.target.value)
          }}
          aria-label="Buscar"
        />
      </div>

      {total && (
        <div className="totais-notas">
          <span>
            <b>{total.qtd.toLocaleString('pt-BR')}</b> nota(s)
          </span>
          <span>
            <b>{dinheiro(total.valor)}</b> em notas válidas
          </span>
          {total.canceladas > 0 && <span className="aviso-txt">{total.canceladas} cancelada(s) — fora do total</span>}
          {carregando && <span className="contagem">atualizando…</span>}
        </div>
      )}
      {erro && <p className="erro">{erro}</p>}

      <div className="tabela-rolagem">
        <table>
          <thead>
            <tr>
              <th>Emissão</th>
              <th>Loja</th>
              <th>Fornecedor</th>
              <th>Nº / série</th>
              <th className="num">Valor</th>
              <th>Status</th>
              <th>SEFAZ</th>
            </tr>
          </thead>
          <tbody>
            {notas.map(n => (
              <tr key={n.id} className={`clicavel${n.situacao_sefaz === 'cancelada' ? ' inativo' : ''}`} onClick={() => setAberta(n.id)}>
                <td className="nowrap">{dataBr(n.data_emissao)}</td>
                <td>{n.loja?.apelido ?? '—'}</td>
                <td>
                  {nomeFornecedor(n)}
                  {!n.fornecedor_id && !cadastrados.has(n.emitente_cnpj) && (
                    <div>
                      <span className="selo aviso">fornecedor sem cadastro</span>
                    </div>
                  )}
                </td>
                <td className="nowrap">
                  {n.numero ?? '—'}
                  {n.serie ? ` / ${n.serie}` : ''}
                </td>
                <td className="num nowrap">{dinheiro(n.valor_total)}</td>
                <td>
                  <span className={`selo ${CLASSE_STATUS[n.status]}`}>{NOME_STATUS[n.status]}</span>
                  {n.pdf_arquivo && <span title="DANFE anexado"> 📎</span>}
                </td>
                <td>
                  {n.situacao_sefaz !== 'autorizada' ? (
                    <span className="selo erro">{NOME_SITUACAO[n.situacao_sefaz]}</span>
                  ) : n.tipo_documento === 'resumo' ? (
                    <span className="selo neutro" title="Só o resumo: o XML completo (itens e duplicatas) ainda não chegou">
                      resumo
                    </span>
                  ) : (
                    <span className="selo ok">XML completo</span>
                  )}
                </td>
              </tr>
            ))}
            {notas.length === 0 && !carregando && (
              <tr>
                <td colSpan={7} className="vazio">
                  Nenhuma nota com esses filtros.
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
        <NotaDetalhe
          id={aberta}
          aoFechar={alterou => {
            setAberta(null)
            if (alterou) carregar()
          }}
        />
      )}
    </section>
  )
}
