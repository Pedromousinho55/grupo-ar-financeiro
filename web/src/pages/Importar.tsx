import { useState } from 'react'
import { useAuth } from '../auth'
import { formatarDocumento } from '../lib/documentos'
import {
  CAMPOS,
  chaveIdentificacao,
  conferir,
  lerArquivo,
  sugerirMapeamento,
  type Linha,
  type LinhaConferida,
  type TipoImportacao,
} from '../lib/importacao'
import { mensagemErro, supabase } from '../supabase'

const NOME_TIPO: Record<TipoImportacao, string> = { fornecedores: 'Fornecedores', plano_contas: 'Plano de contas' }
const NOME_SITUACAO = { novo: 'Novo', atualizar: 'Já existe — atualizar', erro: 'Com problema' }

export default function Importar() {
  const { podeLancar } = useAuth()
  const [tipo, setTipo] = useState<TipoImportacao>('fornecedores')
  const [arquivo, setArquivo] = useState('')
  const [cabecalhos, setCabecalhos] = useState<string[]>([])
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [mapa, setMapa] = useState<Record<string, string>>({})
  const [conferidas, setConferidas] = useState<LinhaConferida[]>([])
  const [incluirAtualizacoes, setIncluirAtualizacoes] = useState(false)
  const [erro, setErro] = useState('')
  const [resultado, setResultado] = useState('')
  const [gravando, setGravando] = useState(false)
  const [filtro, setFiltro] = useState<'' | 'novo' | 'atualizar' | 'erro'>('')

  if (!podeLancar) return <p>Você tem acesso só de consulta.</p>

  async function aoEscolherArquivo(f: File | undefined) {
    setErro('')
    setResultado('')
    setConferidas([])
    if (!f) return
    try {
      const r = await lerArquivo(f)
      if (!r.linhas.length) throw new Error('Não encontrei linhas com dados nesse arquivo.')
      setArquivo(f.name)
      setCabecalhos(r.cabecalhos)
      setLinhas(r.linhas)
      const m = sugerirMapeamento(r.cabecalhos, tipo)
      setMapa(m)
      await reconferir(r.linhas, m, tipo)
    } catch (e) {
      setErro((e as Error).message)
    }
  }

  async function reconferir(ls = linhas, m = mapa, t = tipo) {
    let existentes = new Set<string>()
    let gruposDre: string[] | undefined
    if (t === 'fornecedores') {
      const { data } = await supabase.from('fornecedores').select('documento')
      existentes = new Set((data ?? []).map(r => r.documento as string))
    } else {
      const { data } = await supabase.from('plano_contas').select('nome')
      existentes = new Set((data ?? []).map(r => chaveIdentificacao('plano_contas', { nome: r.nome as string })))
      const g = await supabase.from('grupos_dre').select('nome')
      gruposDre = (g.data ?? []).map(r => r.nome as string)
    }
    setConferidas(conferir(ls, m, t, { existentes, gruposDre }))
  }

  const contagem = (s: string) => conferidas.filter(c => c.situacao === s).length
  const aGravar = conferidas.filter(c => c.situacao === 'novo' || (incluirAtualizacoes && c.situacao === 'atualizar'))

  async function gravar() {
    if (!aGravar.length) return
    if (!confirm(`Gravar ${aGravar.length} registro(s) de ${NOME_TIPO[tipo]}? As linhas com problema NÃO serão gravadas.`)) return
    setGravando(true)
    setErro('')
    let erroFinal = ''
    if (tipo === 'fornecedores') {
      const registros = aGravar.map(c => {
        const d = c.dados
        const r: Record<string, string | null> = { documento: d.documento, razao_social: d.razao_social }
        for (const k of ['nome_fantasia', 'banco_codigo', 'agencia', 'conta', 'pix_chave', 'email', 'telefone'])
          if (d[k]) r[k] = d[k] // só sobrescreve o que veio preenchido
        return r
      })
      const { error } = await supabase.from('fornecedores').upsert(registros, { onConflict: 'documento' })
      if (error) erroFinal = mensagemErro(error)
    } else {
      const { data: grupos } = await supabase.from('grupos_dre').select('id, nome')
      const idGrupo = new Map((grupos ?? []).map(g => [g.nome as string, g.id as string]))
      const registros = aGravar.map(c => {
        const r: Record<string, string | null> = { nome: c.dados.nome }
        if (c.dados.codigo) r.codigo = c.dados.codigo
        if (c.dados.grupo && idGrupo.has(c.dados.grupo)) r.grupo_dre_id = idGrupo.get(c.dados.grupo)!
        return r
      })
      const { error } = await supabase.from('plano_contas').upsert(registros, { onConflict: 'nome' })
      if (error) erroFinal = mensagemErro(error)
    }
    setGravando(false)
    if (erroFinal) return setErro(`Nada foi gravado: ${erroFinal}`)
    setResultado(`${aGravar.length} registro(s) gravado(s). Tudo ficou registrado no Histórico.`)
    reconferir()
  }

  const visiveis = filtro ? conferidas.filter(c => c.situacao === filtro) : conferidas
  const campos = CAMPOS[tipo]

  return (
    <section>
      <header className="titulo-pagina">
        <h1>Importar planilha</h1>
      </header>
      <p className="explicacao">
        Envie a planilha exportada do GRFood (ou qualquer Excel .xlsx / CSV). Nada é gravado antes de você conferir. Contas em aberto
        entram na Etapa 3 (contas a pagar).
      </p>

      <div className="passos">
        <label>
          <span>1. O que vai importar?</span>
          <select
            value={tipo}
            onChange={e => {
              const t = e.target.value as TipoImportacao
              setTipo(t)
              const m = sugerirMapeamento(cabecalhos, t)
              setMapa(m)
              if (linhas.length) reconferir(linhas, m, t)
            }}
          >
            <option value="fornecedores">Fornecedores</option>
            <option value="plano_contas">Plano de contas</option>
          </select>
        </label>
        <label>
          <span>2. Arquivo (.xlsx ou .csv)</span>
          <input type="file" accept=".xlsx,.csv,.txt,.xls" onChange={e => aoEscolherArquivo(e.target.files?.[0])} />
        </label>
      </div>
      {erro && <p className="erro">{erro}</p>}
      {resultado && <p className="ok">{resultado}</p>}

      {cabecalhos.length > 0 && (
        <>
          <h2>3. Confira as colunas — {arquivo}</h2>
          <p className="explicacao">Eu sugeri qual coluna da planilha é cada campo. Corrija se algo estiver errado.</p>
          <div className="grade-campos mapa">
            {campos.map(c => (
              <label key={c.chave}>
                <span>
                  {c.rotulo}
                  {c.obrigatorio && ' *'}
                </span>
                <select
                  value={mapa[c.chave] ?? ''}
                  onChange={e => {
                    const m = { ...mapa, [c.chave]: e.target.value }
                    if (!e.target.value) delete m[c.chave]
                    setMapa(m)
                    reconferir(linhas, m)
                  }}
                >
                  <option value="">— não importar —</option>
                  {cabecalhos.map(h => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          <h2>4. Confira as linhas</h2>
          <div className="barra-filtros">
            <button className={filtro === '' ? 'ativo' : ''} onClick={() => setFiltro('')}>
              Todas ({conferidas.length})
            </button>
            <button className={filtro === 'novo' ? 'ativo' : ''} onClick={() => setFiltro('novo')}>
              Novas ({contagem('novo')})
            </button>
            <button className={filtro === 'atualizar' ? 'ativo' : ''} onClick={() => setFiltro('atualizar')}>
              Já existem ({contagem('atualizar')})
            </button>
            <button className={filtro === 'erro' ? 'ativo' : ''} onClick={() => setFiltro('erro')}>
              Com problema ({contagem('erro')})
            </button>
          </div>
          <div className="tabela-rolagem alta">
            <table>
              <thead>
                <tr>
                  <th>Linha</th>
                  <th>Situação</th>
                  {campos
                    .filter(c => mapa[c.chave])
                    .map(c => (
                      <th key={c.chave}>{c.rotulo}</th>
                    ))}
                  <th>Observações</th>
                </tr>
              </thead>
              <tbody>
                {visiveis.map(c => (
                  <tr key={c.numero} className={`sit-${c.situacao}`}>
                    <td>{c.numero}</td>
                    <td className="nowrap">{NOME_SITUACAO[c.situacao]}</td>
                    {campos
                      .filter(f => mapa[f.chave])
                      .map(f => (
                        <td key={f.chave}>{f.chave === 'documento' ? formatarDocumento(c.dados[f.chave]) : c.dados[f.chave]}</td>
                      ))}
                    <td>
                      {c.problemas.map(p => (
                        <div key={p} className="erro-txt">
                          ✗ {p}
                        </div>
                      ))}
                      {c.avisos.map(p => (
                        <div key={p} className="aviso-txt">
                          ! {p}
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="rodape-importacao">
            <label className="check">
              <input type="checkbox" checked={incluirAtualizacoes} onChange={e => setIncluirAtualizacoes(e.target.checked)} />
              Atualizar também os {contagem('atualizar')} que já existem (só os campos preenchidos na planilha)
            </label>
            <button className="primario" disabled={!aGravar.length || gravando} onClick={gravar}>
              {gravando ? 'Gravando…' : `5. Gravar ${aGravar.length} registro(s)`}
            </button>
          </div>
        </>
      )}
    </section>
  )
}
