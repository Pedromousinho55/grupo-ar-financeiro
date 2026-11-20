// Regras de conciliação: o que fazer com linhas do extrato que se repetem (Contamax, tarifas, cartões…).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth'
import { useCadastrosConta } from '../components/cadastrosConta'
import { lerValor } from '../lib/contas'
import { dinheiro } from '../lib/notas'
import { NOME_ACAO, NOME_SENTIDO, regraBate, regraDaLinha, type LinhaParaRegra, type Regra } from '../lib/regras'
import { mensagemErro, supabase } from '../supabase'

type Campos = Omit<Regra, 'id' | 'criado_em' | 'valor_min' | 'valor_max' | 'prioridade'> & { valor_min: string; valor_max: string; prioridade: string }

const VAZIA: Campos = {
  nome: '',
  ativo: true,
  prioridade: '100',
  conta_bancaria_id: null,
  sentido: 'saida',
  texto: '',
  modo_texto: 'comeca',
  valor_min: '',
  valor_max: '',
  acao: 'conta_pagar',
  plano_conta_id: null,
  centro_custo_id: null,
  fornecedor_id: null,
  forma_pagamento_id: null,
  descricao_conta: null,
  automatica: false,
}

export default function Regras() {
  const { eMaster, podeLancar } = useAuth()
  const cad = useCadastrosConta()
  const [regras, setRegras] = useState<Regra[]>([])
  const [pendentes, setPendentes] = useState<(LinhaParaRegra & { id: string })[]>([])
  const [editando, setEditando] = useState<{ id: string | null; c: Campos } | null>(null)
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')
  const [ocupado, setOcupado] = useState(false)

  const carregar = useCallback(async () => {
    const r = await supabase.from('regras_conciliacao').select('*').order('prioridade').order('criado_em')
    if (r.error) return setErro(mensagemErro(r.error))
    setRegras((r.data ?? []) as Regra[])
    const linhas: (LinhaParaRegra & { id: string })[] = []
    for (let i = 0; ; i += 1000) {
      const { data } = await supabase.from('extrato_lancamentos').select('id, conta_bancaria_id, valor, descricao').eq('conciliado', false).range(i, i + 999)
      linhas.push(...((data ?? []) as (LinhaParaRegra & { id: string })[]))
      if (!data || data.length < 1000) break
    }
    setPendentes(linhas)
  }, [])

  useEffect(() => {
    carregar()
  }, [carregar])

  // quantas linhas pendentes cada regra decide (a primeira que bate)
  const alcance = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of pendentes) {
      const r = regraDaLinha(regras, l)
      if (r) m.set(r.id, (m.get(r.id) ?? 0) + 1)
    }
    return m
  }, [regras, pendentes])
  const semRegra = pendentes.filter(l => !regraDaLinha(regras, l)).length

  const previa = useMemo(() => {
    if (!editando || !editando.c.texto.trim()) return null
    const r: Regra = {
      ...editando.c,
      id: 'previa',
      criado_em: '',
      prioridade: 0,
      ativo: true,
      valor_min: lerValor(editando.c.valor_min),
      valor_max: lerValor(editando.c.valor_max),
    }
    const batem = pendentes.filter(l => regraBate(r, l))
    return { n: batem.length, total: batem.reduce((s, l) => s + Number(l.valor), 0), exemplos: [...new Set(batem.map(l => l.descricao ?? ''))].slice(0, 5) }
  }, [editando, pendentes])

  function abrir(r?: Regra) {
    setErro('')
    setEditando(
      r
        ? { id: r.id, c: { ...r, valor_min: r.valor_min?.toString() ?? '', valor_max: r.valor_max?.toString() ?? '', prioridade: String(r.prioridade) } }
        : { id: null, c: { ...VAZIA } },
    )
  }

  const mudar = <K extends keyof Campos>(k: K, v: Campos[K]) =>
    setEditando(e => {
      if (!e) return e
      const c = { ...e.c, [k]: v }
      // ação define o sentido possível
      if (k === 'acao' && v === 'conta_pagar') c.sentido = 'saida'
      if (k === 'acao' && v === 'receita') c.sentido = 'entrada'
      return { ...e, c }
    })

  async function salvar() {
    if (!editando) return
    const c = editando.c
    if (!c.nome.trim()) return setErro('Dê um nome à regra.')
    if (!c.texto.trim()) return setErro('Informe o texto do histórico do banco.')
    if (c.acao !== 'transferencia' && !c.plano_conta_id) return setErro('Escolha a conta do plano de contas.')
    const dados = {
      nome: c.nome.trim(),
      ativo: c.ativo,
      prioridade: parseInt(c.prioridade, 10) || 100,
      conta_bancaria_id: c.conta_bancaria_id || null,
      sentido: c.sentido,
      texto: c.texto.trim(),
      modo_texto: c.modo_texto,
      valor_min: lerValor(c.valor_min),
      valor_max: lerValor(c.valor_max),
      acao: c.acao,
      plano_conta_id: c.acao === 'transferencia' ? null : c.plano_conta_id,
      centro_custo_id: c.acao === 'transferencia' ? null : c.centro_custo_id || null,
      fornecedor_id: c.acao === 'conta_pagar' ? c.fornecedor_id || null : null,
      forma_pagamento_id: c.acao === 'conta_pagar' ? c.forma_pagamento_id || null : null,
      descricao_conta: c.acao === 'conta_pagar' ? c.descricao_conta?.trim() || null : null,
      automatica: c.automatica,
    }
    setOcupado(true)
    const { error } = editando.id
      ? await supabase.from('regras_conciliacao').update(dados).eq('id', editando.id)
      : await supabase.from('regras_conciliacao').insert(dados)
    setOcupado(false)
    if (error) return setErro(mensagemErro(error))
    setEditando(null)
    setAviso('Regra salva.')
    carregar()
  }

  async function apagar() {
    if (!editando?.id || !window.confirm('Apagar esta regra? Linhas já conciliadas por ela continuam conciliadas.')) return
    setOcupado(true)
    const { error } = await supabase.from('regras_conciliacao').delete().eq('id', editando.id)
    setOcupado(false)
    if (error) return setErro(mensagemErro(error))
    setEditando(null)
    carregar()
  }

  async function aplicarAgora() {
    setOcupado(true)
    setErro('')
    const { data, error } = await supabase.rpc('aplicar_regras_automaticas', { p_conta: null })
    setOcupado(false)
    if (error) return setErro(mensagemErro(error))
    setAviso(`${data ?? 0} linha(s) conciliada(s) pelas regras automáticas.`)
    carregar()
  }

  const nomePlano = (id: string | null) => cad.planos.find(p => p.id === id)?.nome ?? ''
  const nomeBanco = (id: string | null) => (id ? (cad.bancos.find(b => b.id === id)?.nome ?? '?') : 'Todas as contas')

  return (
    <section>
      <header className="titulo-pagina">
        <h1>Regras de conciliação</h1>
        <span>
          {podeLancar && (
            <button onClick={aplicarAgora} disabled={ocupado}>
              Aplicar regras automáticas agora
            </button>
          )}{' '}
          {eMaster && (
            <button className="primario" onClick={() => abrir()}>
              + Nova regra
            </button>
          )}
        </span>
      </header>
      <p className="explicacao">
        Para linhas do extrato que se repetem. A primeira regra que bate (menor prioridade) decide. "Automática" concilia sozinha ao importar o
        extrato; "só sugere" deixa a linha marcada para alguém confirmar em lote na Conciliação. Só o Pedro (master) cria e altera regras.
      </p>
      <div className="totais-notas">
        <span>
          <b>{pendentes.length.toLocaleString('pt-BR')}</b> linha(s) a conciliar
        </span>
        <span>
          <b>{(pendentes.length - semRegra).toLocaleString('pt-BR')}</b> com regra
        </span>
        <span className="aviso-txt">{semRegra.toLocaleString('pt-BR')} sem regra</span>
      </div>
      {erro && !editando && <p className="erro">{erro}</p>}
      {aviso && <p className="ok">{aviso}</p>}

      <div className="tabela-rolagem">
        <table>
          <thead>
            <tr>
              <th className="num">Prior.</th>
              <th>Regra</th>
              <th>Quando o histórico…</th>
              <th>Faz</th>
              <th>Modo</th>
              <th className="num">Pendentes que pega</th>
            </tr>
          </thead>
          <tbody>
            {regras.map(r => (
              <tr key={r.id} className={`${eMaster ? 'clicavel' : ''}${r.ativo ? '' : ' inativo'}`} onClick={() => eMaster && abrir(r)}>
                <td className="num">{r.prioridade}</td>
                <td>
                  {r.nome}
                  <div className="mudanca">{nomeBanco(r.conta_bancaria_id)}</div>
                </td>
                <td>
                  {r.modo_texto === 'comeca' ? 'começa com' : 'contém'} <b>"{r.texto}"</b>
                  <div className="mudanca">
                    {NOME_SENTIDO[r.sentido]}
                    {r.valor_min !== null && ` · a partir de ${dinheiro(r.valor_min)}`}
                    {r.valor_max !== null && ` · até ${dinheiro(r.valor_max)}`}
                  </div>
                </td>
                <td>
                  {NOME_ACAO[r.acao]}
                  {r.plano_conta_id && <div className="mudanca">{nomePlano(r.plano_conta_id)}</div>}
                </td>
                <td>{r.automatica ? <span className="selo ok">automática</span> : <span className="selo aviso">só sugere</span>}</td>
                <td className="num">{alcance.get(r.id) ?? 0}</td>
              </tr>
            ))}
            {regras.length === 0 && (
              <tr>
                <td colSpan={6} className="vazio">
                  Nenhuma regra ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editando && (
        <div className="fundo-modal" onClick={() => setEditando(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>{editando.id ? 'Editar regra' : 'Nova regra'}</h2>
            <fieldset disabled={ocupado || !cad.pronto}>
              <div className="grade-campos">
                <label className="largo">
                  <span>Nome *</span>
                  <input value={editando.c.nome} onChange={e => mudar('nome', e.target.value)} placeholder="Ex.: Aplicação Contamax" />
                </label>
                <label>
                  <span>Histórico do banco</span>
                  <select value={editando.c.modo_texto} onChange={e => mudar('modo_texto', e.target.value as Campos['modo_texto'])}>
                    <option value="comeca">começa com</option>
                    <option value="contem">contém</option>
                  </select>
                </label>
                <label>
                  <span>Texto *</span>
                  <input value={editando.c.texto} onChange={e => mudar('texto', e.target.value)} placeholder="Ex.: APLICACAO CONTAMAX" />
                </label>
                <label>
                  <span>O que fazer *</span>
                  <select value={editando.c.acao} onChange={e => mudar('acao', e.target.value as Regra['acao'])}>
                    {Object.entries(NOME_ACAO).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Vale para</span>
                  <select
                    value={editando.c.sentido}
                    onChange={e => mudar('sentido', e.target.value as Regra['sentido'])}
                    disabled={editando.c.acao !== 'transferencia'}
                  >
                    {Object.entries(NOME_SENTIDO).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Conta bancária</span>
                  <select value={editando.c.conta_bancaria_id ?? ''} onChange={e => mudar('conta_bancaria_id', e.target.value || null)}>
                    <option value="">Todas as contas</option>
                    {cad.bancos.map(b => (
                      <option key={b.id} value={b.id}>
                        {b.nome}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Valor de / até (opcional)</span>
                  <span className="faixa">
                    <input inputMode="decimal" value={editando.c.valor_min} onChange={e => mudar('valor_min', e.target.value)} placeholder="mín." />
                    <input inputMode="decimal" value={editando.c.valor_max} onChange={e => mudar('valor_max', e.target.value)} placeholder="máx." />
                  </span>
                </label>
                {editando.c.acao !== 'transferencia' && (
                  <>
                    <label>
                      <span>Plano de contas *</span>
                      <select value={editando.c.plano_conta_id ?? ''} onChange={e => mudar('plano_conta_id', e.target.value || null)}>
                        <option value="">Escolha…</option>
                        {cad.planos.map(p => (
                          <option key={p.id} value={p.id}>
                            {p.nome}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Centro de custo</span>
                      <select value={editando.c.centro_custo_id ?? ''} onChange={e => mudar('centro_custo_id', e.target.value || null)}>
                        <option value="">—</option>
                        {cad.centros.map(x => (
                          <option key={x.id} value={x.id}>
                            {x.nome}
                          </option>
                        ))}
                      </select>
                    </label>
                  </>
                )}
                {editando.c.acao === 'conta_pagar' && (
                  <>
                    <label>
                      <span>Fornecedor</span>
                      <select value={editando.c.fornecedor_id ?? ''} onChange={e => mudar('fornecedor_id', e.target.value || null)}>
                        <option value="">—</option>
                        {cad.fornecedores.map(f => (
                          <option key={f.id} value={f.id}>
                            {f.nome}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Forma de pagamento</span>
                      <select value={editando.c.forma_pagamento_id ?? ''} onChange={e => mudar('forma_pagamento_id', e.target.value || null)}>
                        <option value="">—</option>
                        {cad.formas.map(x => (
                          <option key={x.id} value={x.id}>
                            {x.nome}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="largo">
                      <span>Descrição da conta criada</span>
                      <input
                        value={editando.c.descricao_conta ?? ''}
                        onChange={e => mudar('descricao_conta', e.target.value)}
                        placeholder="Vazio = histórico do banco"
                      />
                    </label>
                  </>
                )}
                <label>
                  <span>Prioridade</span>
                  <input type="number" value={editando.c.prioridade} onChange={e => mudar('prioridade', e.target.value)} />
                  <small>Menor = testada antes (use para exceções).</small>
                </label>
                <label className="check">
                  <input type="checkbox" checked={editando.c.automatica} onChange={e => mudar('automatica', e.target.checked)} />
                  Automática (concilia sozinha)
                </label>
                <label className="check">
                  <input type="checkbox" checked={editando.c.ativo} onChange={e => mudar('ativo', e.target.checked)} />
                  Ativa
                </label>
              </div>
            </fieldset>
            {previa && (
              <div className="info">
                Hoje esta regra pegaria <b>{previa.n}</b> linha(s) pendente(s), total {dinheiro(previa.total)}.
                {previa.exemplos.length > 0 && <div className="mudanca">Ex.: {previa.exemplos.join(' | ')}</div>}
              </div>
            )}
            {erro && <p className="erro">{erro}</p>}
            <div className="acoes">
              {editando.id && (
                <button className="perigo" onClick={apagar} disabled={ocupado}>
                  Apagar
                </button>
              )}
              <span className="espaco" />
              <button onClick={() => setEditando(null)} disabled={ocupado}>
                Cancelar
              </button>
              <button className="primario" onClick={salvar} disabled={ocupado}>
                {ocupado ? 'Salvando…' : 'Salvar regra'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
