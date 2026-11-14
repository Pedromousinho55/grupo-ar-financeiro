// "Motor" de cadastro: lista, busca, inclui, edita e (master) apaga registros de uma tabela,
// a partir de uma configuração de campos. Usado por todos os cadastros da Etapa 1.
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useAuth } from '../auth'
import { consultarCnpj } from '../lib/consultaCnpj'
import { cnpjValido, documentoValido, formatarDocumento, soDigitos } from '../lib/documentos'
import { mensagemErro, supabase } from '../supabase'

type Valor = string | number | boolean | null
export type Registro = Record<string, Valor> & { id: string }

export interface Opcao {
  valor: string
  rotulo: string
}

export interface Campo {
  chave: string
  rotulo: string
  tipo?: 'texto' | 'numero' | 'dinheiro' | 'data' | 'documento' | 'selecao' | 'sim_nao' | 'texto_longo'
  obrigatorio?: boolean
  /** opções fixas, ou buscadas de outra tabela */
  opcoes?: Opcao[]
  opcoesDe?: { tabela: string; rotulo: string; filtroAtivo?: boolean }
  naLista?: boolean
  dica?: string
  somenteLeitura?: boolean
}

export interface ConfigCadastro {
  tabela: string
  titulo: string
  singular: string
  campos: Campo[]
  ordem: string
  /** quem pode incluir/editar: 'lancador' (master+lançador) ou 'master' */
  editaQuem?: 'lancador' | 'master'
  podeIncluir?: boolean
  explicacao?: string
  /** permite preencher os dados pelo CNPJ (consulta pública da Receita) */
  consultaCnpj?: boolean
}

const vazioPara = (c: Campo): Valor => (c.tipo === 'sim_nao' ? true : '')

export default function Cadastro({ config }: { config: ConfigCadastro }) {
  const { podeLancar, eMaster } = useAuth()
  const podeEditar = config.editaQuem === 'master' ? eMaster : podeLancar
  const podeIncluir = podeEditar && config.podeIncluir !== false

  const [registros, setRegistros] = useState<Registro[]>([])
  const [opcoes, setOpcoes] = useState<Record<string, Opcao[]>>({})
  const [busca, setBusca] = useState('')
  const [mostrarInativos, setMostrarInativos] = useState(false)
  const [editando, setEditando] = useState<Record<string, Valor> | null>(null)
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [receita, setReceita] = useState<{ tipo: 'ok' | 'aviso' | 'erro' | 'buscando'; texto: string } | null>(null)
  const temAtivo = config.campos.some(c => c.chave === 'ativo')

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.from(config.tabela).select('*').order(config.ordem)
    if (error) setErro(mensagemErro(error))
    else setRegistros((data ?? []) as Registro[])
  }, [config.tabela, config.ordem])

  useEffect(() => {
    carregar()
    // carrega as listas de opções que vêm de outras tabelas
    for (const c of config.campos) {
      if (!c.opcoesDe) continue
      const { tabela, rotulo } = c.opcoesDe
      supabase
        .from(tabela)
        .select(`id, ${rotulo}`)
        .order(rotulo)
        .then(({ data }) => {
          const lista = ((data ?? []) as unknown as Record<string, string>[]).map(r => ({ valor: r.id, rotulo: r[rotulo] }))
          setOpcoes(o => ({ ...o, [c.chave]: lista }))
        })
    }
  }, [carregar, config.campos])

  const opcoesDo = (c: Campo) => c.opcoes ?? opcoes[c.chave] ?? []
  const exibir = (c: Campo, v: Valor): string => {
    if (v === null || v === undefined || v === '') return '—'
    if (c.tipo === 'documento') return formatarDocumento(String(v))
    if (c.tipo === 'sim_nao') return v ? 'Sim' : 'Não'
    if (c.tipo === 'dinheiro') return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    if (c.tipo === 'data') return new Date(String(v) + 'T12:00:00').toLocaleDateString('pt-BR')
    if (c.tipo === 'selecao') return opcoesDo(c).find(o => o.valor === v)?.rotulo ?? String(v)
    return String(v)
  }

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    const termoDig = soDigitos(busca)
    return registros.filter(r => {
      if (temAtivo && !mostrarInativos && r.ativo === false) return false
      if (!termo) return true
      return config.campos.some(c => {
        const v = r[c.chave]
        if (v === null || v === undefined) return false
        if (c.tipo === 'documento' && termoDig) return String(v).includes(termoDig)
        return exibir(c, v).toLowerCase().includes(termo)
      })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registros, busca, mostrarInativos, opcoes])

  // Campos que vêm da Receita: sobrescrevem; telefone e e-mail só preenchem se estiverem vazios.
  const SOBRESCREVE = ['razao_social', 'nome_fantasia', 'endereco', 'bairro', 'cidade', 'uf', 'cep', 'cnae_principal', 'situacao_cadastral']
  async function buscarNaReceita(doc: string) {
    setReceita({ tipo: 'buscando', texto: 'Consultando a Receita Federal…' })
    try {
      const d = await consultarCnpj(doc)
      setEditando(ed => {
        if (!ed) return ed
        const novo: Record<string, Valor> = { ...ed, consultado_receita_em: new Date().toISOString() }
        for (const k of SOBRESCREVE) if (k in ed) novo[k] = d[k as keyof typeof d] ?? null
        if (!ed.telefone && d.telefone) novo.telefone = d.telefone
        if (!ed.email && d.email) novo.email = d.email
        return novo
      })
      const sit = d.situacao_cadastral ?? 'desconhecida'
      setReceita(
        sit === 'ATIVA'
          ? { tipo: 'ok', texto: `Dados preenchidos pela Receita (fonte: ${d.fonte}). Situação: ATIVA. Confira e clique em Salvar.` }
          : { tipo: 'aviso', texto: `Atenção: situação na Receita = ${sit}. Empresa nessa situação não deveria emitir nota. Confira antes de salvar.` },
      )
    } catch (e) {
      setReceita({ tipo: 'erro', texto: (e as Error).message })
    }
  }

  function abrirNovo() {
    setErro('')
    setAviso('')
    setReceita(null)
    setEditando(Object.fromEntries(config.campos.map(c => [c.chave, vazioPara(c)])))
  }

  async function salvar(e: FormEvent) {
    e.preventDefault()
    if (!editando) return
    setErro('')
    const dados: Record<string, Valor> = {}
    for (const c of config.campos) {
      if (c.somenteLeitura) continue
      let v = editando[c.chave]
      if (typeof v === 'string') v = v.trim()
      if (c.tipo === 'documento' && v) v = soDigitos(String(v))
      if ((c.tipo === 'numero' || c.tipo === 'dinheiro') && v !== '' && v !== null) v = Number(String(v).replace(',', '.'))
      if (v === '') v = null
      if (c.obrigatorio && (v === null || v === undefined)) return setErro(`Preencha: ${c.rotulo}`)
      if (c.tipo === 'documento' && v && !documentoValido(String(v)))
        return setErro(`${c.rotulo} inválido: o dígito verificador não confere. Confira o número.`)
      dados[c.chave] = v
    }
    if (config.consultaCnpj && editando.consultado_receita_em) dados.consultado_receita_em = editando.consultado_receita_em
    setSalvando(true)
    const q = editando.id
      ? supabase.from(config.tabela).update(dados).eq('id', String(editando.id)).select().single()
      : supabase.from(config.tabela).insert(dados).select().single()
    const { error } = await q
    setSalvando(false)
    if (error) return setErro(mensagemErro(error))
    setAviso(editando.id ? 'Alterações salvas.' : `${config.singular} incluído(a).`)
    setEditando(null)
    carregar()
  }

  async function apagar() {
    if (!editando?.id) return
    if (!confirm(`Apagar definitivamente este(a) ${config.singular.toLowerCase()}? Se ele(a) já foi usado(a), prefira marcar como inativo.`)) return
    const { error, count } = await supabase.from(config.tabela).delete({ count: 'exact' }).eq('id', String(editando.id))
    if (error) return setErro(mensagemErro(error))
    if (!count) return setErro('Não foi apagado (sem permissão).')
    setAviso('Apagado.')
    setEditando(null)
    carregar()
  }

  const colunas = config.campos.filter(c => c.naLista)

  return (
    <section>
      <header className="titulo-pagina">
        <h1>{config.titulo}</h1>
        {podeIncluir && (
          <button className="primario" onClick={abrirNovo}>
            + Incluir {config.singular.toLowerCase()}
          </button>
        )}
      </header>
      {config.explicacao && <p className="explicacao">{config.explicacao}</p>}
      {aviso && <p className="ok">{aviso}</p>}
      {erro && !editando && <p className="erro">{erro}</p>}

      <div className="barra-filtros">
        <input placeholder="Buscar…" value={busca} onChange={e => setBusca(e.target.value)} aria-label="Buscar" />
        {temAtivo && (
          <label className="check">
            <input type="checkbox" checked={mostrarInativos} onChange={e => setMostrarInativos(e.target.checked)} /> mostrar inativos
          </label>
        )}
        <span className="contagem">{filtrados.length} registro(s)</span>
      </div>

      <div className="tabela-rolagem">
        <table>
          <thead>
            <tr>
              {colunas.map(c => (
                <th key={c.chave}>{c.rotulo}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtrados.map(r => (
              <tr
                key={r.id}
                className={r.ativo === false ? 'inativo clicavel' : 'clicavel'}
                onClick={() => {
                  setErro('')
                  setAviso('')
                  setReceita(null)
                  setEditando({ ...r })
                }}
              >
                {colunas.map(c => (
                  <td key={c.chave} className={c.tipo === 'dinheiro' ? 'num' : ''}>
                    {exibir(c, r[c.chave])}
                  </td>
                ))}
              </tr>
            ))}
            {filtrados.length === 0 && (
              <tr>
                <td colSpan={colunas.length} className="vazio">
                  Nenhum registro.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editando && (
        <div className="fundo-modal" onClick={() => setEditando(null)}>
          <form className="modal" onClick={e => e.stopPropagation()} onSubmit={salvar}>
            <h2>
              {editando.id ? (podeEditar ? 'Editar' : 'Ver') : 'Incluir'} {config.singular.toLowerCase()}
            </h2>
            <fieldset disabled={!podeEditar}>
              <div className="grade-campos">
                {config.campos.map(c => (
                  <label key={c.chave} className={c.tipo === 'texto_longo' ? 'largo' : ''}>
                    <span>
                      {c.rotulo}
                      {c.obrigatorio && ' *'}
                    </span>
                    <Entrada
                      campo={c}
                      opcoes={opcoesDo(c)}
                      valor={editando[c.chave]}
                      onChange={v => {
                        setEditando(ed => ({ ...ed!, [c.chave]: v }))
                        // fornecedor novo: ao completar um CNPJ válido, busca sozinho
                        if (c.tipo === 'documento' && config.consultaCnpj && !editando.id && !editando.razao_social) {
                          const dig = soDigitos(String(v))
                          if (dig.length === 14 && cnpjValido(dig) && dig !== soDigitos(String(editando[c.chave] ?? ''))) buscarNaReceita(dig)
                        }
                      }}
                    />
                    {c.tipo === 'documento' && config.consultaCnpj && podeEditar && (
                      <button
                        type="button"
                        className="link"
                        disabled={receita?.tipo === 'buscando' || !cnpjValido(String(editando[c.chave] ?? ''))}
                        onClick={() => buscarNaReceita(String(editando[c.chave]))}
                      >
                        {receita?.tipo === 'buscando' ? 'Consultando…' : '↻ Buscar dados na Receita pelo CNPJ'}
                      </button>
                    )}
                    {c.dica && <small>{c.dica}</small>}
                  </label>
                ))}
              </div>
            </fieldset>
            {receita && <p className={receita.tipo === 'ok' ? 'ok' : receita.tipo === 'buscando' ? 'info' : receita.tipo === 'aviso' ? 'aviso' : 'erro'}>{receita.texto}</p>}
            {erro && <p className="erro">{erro}</p>}
            <div className="acoes">
              {editando.id && eMaster && (
                <button type="button" className="perigo" onClick={apagar}>
                  Apagar
                </button>
              )}
              <span className="espaco" />
              <button type="button" onClick={() => setEditando(null)}>
                {podeEditar ? 'Cancelar' : 'Fechar'}
              </button>
              {podeEditar && (
                <button className="primario" disabled={salvando}>
                  {salvando ? 'Salvando…' : 'Salvar'}
                </button>
              )}
            </div>
          </form>
        </div>
      )}
    </section>
  )
}

function Entrada({ campo: c, valor, opcoes, onChange }: { campo: Campo; valor: Valor; opcoes: Opcao[]; onChange: (v: Valor) => void }) {
  const v = valor ?? ''
  if (c.somenteLeitura) return <input value={String(v)} readOnly className="leitura" />
  switch (c.tipo) {
    case 'sim_nao':
      return (
        <select value={valor ? 'sim' : 'nao'} onChange={e => onChange(e.target.value === 'sim')}>
          <option value="sim">Sim</option>
          <option value="nao">Não</option>
        </select>
      )
    case 'selecao':
      return (
        <select value={String(v)} onChange={e => onChange(e.target.value)}>
          <option value="">— escolher —</option>
          {opcoes.map(o => (
            <option key={o.valor} value={o.valor}>
              {o.rotulo}
            </option>
          ))}
        </select>
      )
    case 'texto_longo':
      return <textarea rows={3} value={String(v)} onChange={e => onChange(e.target.value)} />
    case 'data':
      return <input type="date" value={String(v)} onChange={e => onChange(e.target.value)} />
    case 'numero':
    case 'dinheiro':
      return <input inputMode="decimal" value={String(v)} onChange={e => onChange(e.target.value)} />
    case 'documento': {
      const dig = soDigitos(String(v))
      const ok = dig.length >= 11 && documentoValido(dig)
      return (
        <div className="doc">
          <input value={String(v)} onChange={e => onChange(e.target.value)} placeholder="só números ou com pontuação" />
          {dig.length >= 11 && <span className={ok ? 'selo ok' : 'selo erro'}>{ok ? '✓ válido' : '✗ inválido'}</span>}
        </div>
      )
    }
    default:
      return <input value={String(v)} onChange={e => onChange(e.target.value)} />
  }
}
