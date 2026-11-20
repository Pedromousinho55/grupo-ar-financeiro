// Janela para conciliar uma linha do extrato.
import { useEffect, useState } from 'react'
import { useAuth } from '../auth'
import type { ContaCandidata } from '../lib/conciliacao'
import { NOME_STATUS_CONTA } from '../lib/contas'
import { dataBr, dinheiro } from '../lib/notas'
import { mensagemErro, supabase } from '../supabase'
import { useCadastrosConta } from './cadastrosConta'

export interface LinhaExtrato {
  id: string
  conta_bancaria_id: string
  data: string
  valor: number
  descricao: string | null
  documento: string | null
  conciliado: boolean
  tipo_conciliacao: 'conta_pagar' | 'receita' | 'transferencia' | null
  conta_pagar_id: string | null
  plano_conta_id: string | null
  observacao: string | null
  conta_pagar: { descricao: string; parcela: string | null } | null
  plano: { codigo: string | null; nome: string } | null
  destino: { descricao: string } | null
}

export interface CandidataConta extends ContaCandidata {
  descricao: string
  parcela: string | null
  fornecedor: { razao_social: string; nome_fantasia: string | null } | null
}

type Modo = 'sugestao' | 'buscar' | 'criar' | 'receita' | 'transferencia'

export default function ConciliarLinha({
  linha,
  lojaId,
  sugestoes,
  aoFechar,
}: {
  linha: LinhaExtrato
  lojaId: string
  sugestoes: CandidataConta[]
  aoFechar: (alterou: boolean) => void
}) {
  const { podeLancar, eMaster } = useAuth()
  const cad = useCadastrosConta()
  const saida = linha.valor < 0
  const [modo, setModo] = useState<Modo>(saida ? (sugestoes.length ? 'sugestao' : 'criar') : 'receita')
  const [escolhida, setEscolhida] = useState(sugestoes[0]?.id ?? '')
  const [busca, setBusca] = useState('')
  const [achadas, setAchadas] = useState<CandidataConta[]>([])
  const [plano, setPlano] = useState('')
  const [centro, setCentro] = useState('')
  const [forma, setForma] = useState('')
  const [fornecedor, setFornecedor] = useState('')
  const [descricao, setDescricao] = useState(linha.descricao ?? '')
  const [destino, setDestino] = useState('')
  const [observacao, setObservacao] = useState(linha.observacao ?? '')
  const [erro, setErro] = useState('')
  const [ocupado, setOcupado] = useState(false)

  // busca manual de contas em aberto da empresa (valor diferente, data longe…)
  useEffect(() => {
    if (modo !== 'buscar') return
    const t = setTimeout(async () => {
      let q = supabase
        .from('contas_pagar')
        .select('id, descricao, parcela, valor, vencimento, status, pago_em, valor_pago, fornecedor:fornecedores(razao_social, nome_fantasia)')
        .eq('loja_id', lojaId)
        .in('status', ['a_aprovar', 'aprovada', 'paga'])
        .order('vencimento')
        .limit(50)
      const termo = busca.replace(/[,()*%\\"]/g, ' ').trim()
      if (termo) q = q.ilike('descricao', `%${termo}%`)
      else q = q.gte('vencimento', new Date(Date.parse(linha.data) - 45 * 86400000).toISOString().slice(0, 10))
      const { data } = await q
      const lista = (data ?? []) as unknown as CandidataConta[]
      // contas pagas que já têm extrato ligado não aparecem
      const pagas = lista.filter(c => c.status === 'paga').map(c => c.id)
      const lig = pagas.length ? await supabase.from('extrato_lancamentos').select('conta_pagar_id').in('conta_pagar_id', pagas) : { data: [] }
      const ocupadas = new Set((lig.data ?? []).map(x => x.conta_pagar_id as string))
      setAchadas(lista.filter(c => !ocupadas.has(c.id)))
    }, 300)
    return () => clearTimeout(t)
  }, [modo, busca, lojaId, linha.data])

  const planosReceita = cad.planos // todos; receitas no topo pelo código 1.1
  const nomeConta = (c: CandidataConta) =>
    `${c.fornecedor?.nome_fantasia || c.fornecedor?.razao_social || c.descricao}${c.parcela ? ` (${c.parcela})` : ''} · ${dinheiro(c.valor)} · venc. ${dataBr(c.vencimento)} · ${NOME_STATUS_CONTA[c.status]}`

  async function executar(acao: () => PromiseLike<{ error: { code?: string; message?: string } | null }>) {
    setOcupado(true)
    setErro('')
    const { error } = await acao()
    setOcupado(false)
    if (error) return setErro(mensagemErro(error))
    aoFechar(true)
  }

  function confirmar() {
    if (modo === 'sugestao' || modo === 'buscar') {
      if (!escolhida) return setErro('Escolha a conta a pagar.')
      return executar(() => supabase.rpc('conciliar_com_conta', { p_lancamento: linha.id, p_conta: escolhida }))
    }
    if (modo === 'criar') {
      if (!plano) return setErro('Escolha a conta do plano de contas.')
      if (!descricao.trim()) return setErro('Escreva uma descrição.')
      return executar(() =>
        supabase.rpc('conciliar_criando_conta', {
          p_lancamento: linha.id,
          p_plano: plano,
          p_descricao: descricao.trim(),
          p_fornecedor: fornecedor || null,
          p_centro: centro || null,
          p_forma: forma || null,
        }),
      )
    }
    if (modo === 'receita') {
      if (!plano) return setErro('Escolha a conta do plano de contas (ex.: 1.1.03 Venda serviço).')
      return executar(() =>
        supabase
          .from('extrato_lancamentos')
          .update({ conciliado: true, tipo_conciliacao: 'receita', plano_conta_id: plano, centro_custo_id: centro || null, observacao: observacao.trim() || null })
          .eq('id', linha.id),
      )
    }
    if (modo === 'transferencia') {
      return executar(() =>
        supabase
          .from('extrato_lancamentos')
          .update({ conciliado: true, tipo_conciliacao: 'transferencia', conta_destino_id: destino || null, observacao: observacao.trim() || null })
          .eq('id', linha.id),
      )
    }
  }

  function desfazer() {
    if (!window.confirm('Desfazer esta conciliação? Conta criada pela conciliação é cancelada; conta paga pela conciliação volta para "Aprovada".')) return
    if (linha.tipo_conciliacao === 'conta_pagar') return executar(() => supabase.rpc('desfazer_conciliacao', { p_lancamento: linha.id }))
    return executar(() => supabase.from('extrato_lancamentos').update({ conciliado: false }).eq('id', linha.id))
  }

  const opcoes: [Modo, string][] = saida
    ? [
        ...(sugestoes.length ? ([['sugestao', `Sugestões (${sugestoes.length})`]] as [Modo, string][]) : []),
        ['buscar', 'Procurar conta a pagar'],
        ['criar', 'Lançar conta (já paga)'],
        ['transferencia', 'Transferência entre contas do grupo'],
      ]
    : [
        ['receita', 'Receita'],
        ['transferencia', 'Transferência entre contas do grupo'],
      ]

  return (
    <div className="fundo-modal" onClick={() => aoFechar(false)}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>{saida ? 'Saída' : 'Entrada'} de {dinheiro(Math.abs(linha.valor))}</h2>
        <p className="explicacao">
          {dataBr(linha.data)} · {linha.descricao ?? 'sem histórico'}
          {linha.documento ? ` · doc. ${linha.documento}` : ''}
        </p>

        {linha.conciliado ? (
          <>
            <p className="ok">
              Conciliada:{' '}
              {linha.tipo_conciliacao === 'conta_pagar'
                ? `conta a pagar "${linha.conta_pagar?.descricao ?? ''}"`
                : linha.tipo_conciliacao === 'receita'
                  ? `receita em ${linha.plano?.codigo ?? ''} ${linha.plano?.nome ?? ''}`
                  : `transferência${linha.destino ? ` com ${linha.destino.descricao}` : ''}`}
            </p>
            {linha.observacao && <p className="contagem">Observação: {linha.observacao}</p>}
            {!eMaster && <p className="contagem">Só o Pedro (master) desfaz uma conciliação.</p>}
          </>
        ) : !podeLancar ? (
          <p className="contagem">Seu usuário só pode consultar.</p>
        ) : !cad.pronto ? (
          <p>Carregando…</p>
        ) : (
          <fieldset disabled={ocupado}>
            <div className="atalhos">
              {opcoes.map(([m, nome]) => (
                <button key={m} className={modo === m ? 'ativo' : ''} onClick={() => setModo(m)}>
                  {nome}
                </button>
              ))}
            </div>

            {(modo === 'sugestao' || modo === 'buscar') && (
              <>
                {modo === 'buscar' && (
                  <input placeholder="Descrição da conta (vazio = vencendo perto da data)" value={busca} onChange={e => setBusca(e.target.value)} />
                )}
                <div className="opcoes-status lista">
                  {(modo === 'sugestao' ? sugestoes : achadas).map(c => (
                    <label key={c.id} className={`opcao${escolhida === c.id ? ' marcada' : ''}`}>
                      <input type="radio" name="conta" checked={escolhida === c.id} onChange={() => setEscolhida(c.id)} />
                      <span>
                        <b>{nomeConta(c)}</b>
                        {Math.abs(Number(c.valor)) !== Math.abs(linha.valor) && c.status !== 'paga' && (
                          <small className="aviso-txt">
                            Valor diferente: a conta fica paga com {dinheiro(Math.abs(linha.valor))} (juros/desconto).
                          </small>
                        )}
                        {c.status === 'a_aprovar' && (
                          <small className="aviso-txt">{eMaster ? 'Ainda não aprovada: conciliar vale como sua aprovação.' : 'Ainda não aprovada: só o Pedro pode conciliar.'}</small>
                        )}
                        {c.status === 'paga' && <small>Pagamento já registrado à mão: só será ligado ao extrato.</small>}
                      </span>
                    </label>
                  ))}
                  {modo === 'buscar' && achadas.length === 0 && <p className="contagem">Nenhuma conta encontrada.</p>}
                </div>
              </>
            )}

            {modo === 'criar' && (
              <div className="grade-campos">
                <label className="largo">
                  <span>Descrição *</span>
                  <input value={descricao} onChange={e => setDescricao(e.target.value)} />
                </label>
                <label>
                  <span>Plano de contas *</span>
                  <select value={plano} onChange={e => setPlano(e.target.value)}>
                    <option value="">Escolha…</option>
                    {cad.planos.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.nome}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Fornecedor</span>
                  <select value={fornecedor} onChange={e => setFornecedor(e.target.value)}>
                    <option value="">—</option>
                    {cad.fornecedores.map(f => (
                      <option key={f.id} value={f.id}>
                        {f.nome}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Centro de custo</span>
                  <select value={centro} onChange={e => setCentro(e.target.value)}>
                    <option value="">—</option>
                    {cad.centros.map(x => (
                      <option key={x.id} value={x.id}>
                        {x.nome}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Forma de pagamento</span>
                  <select value={forma} onChange={e => setForma(e.target.value)}>
                    <option value="">—</option>
                    {cad.formas.map(x => (
                      <option key={x.id} value={x.id}>
                        {x.nome}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="contagem largo">
                  Vira uma conta a pagar já paga em {dataBr(linha.data)}, sem passar pela aprovação (o dinheiro já saiu). Fica no Histórico.
                </p>
              </div>
            )}

            {modo === 'receita' && (
              <div className="grade-campos">
                <label>
                  <span>Plano de contas *</span>
                  <select value={plano} onChange={e => setPlano(e.target.value)}>
                    <option value="">Escolha…</option>
                    {planosReceita.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.nome}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Centro de custo</span>
                  <select value={centro} onChange={e => setCentro(e.target.value)}>
                    <option value="">—</option>
                    {cad.centros.map(x => (
                      <option key={x.id} value={x.id}>
                        {x.nome}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}

            {modo === 'transferencia' && (
              <label>
                <span className="contagem">{saida ? 'Conta de destino' : 'Conta de origem'} (do grupo)</span>
                <select value={destino} onChange={e => setDestino(e.target.value)}>
                  <option value="">(não sei / outra)</option>
                  {cad.bancos
                    .filter(b => b.id !== linha.conta_bancaria_id)
                    .map(b => (
                      <option key={b.id} value={b.id}>
                        {b.nome}
                      </option>
                    ))}
                </select>
              </label>
            )}

            {(modo === 'receita' || modo === 'transferencia') && (
              <label>
                <span className="contagem">Observação</span>
                <input value={observacao} onChange={e => setObservacao(e.target.value)} placeholder="Ex.: evento casamento 15/11; repasse Voar → MDF…" />
              </label>
            )}
          </fieldset>
        )}

        {erro && <p className="erro">{erro}</p>}
        <div className="acoes">
          {linha.conciliado && eMaster && (
            <button className="perigo" onClick={desfazer} disabled={ocupado}>
              Desfazer conciliação
            </button>
          )}
          <span className="espaco" />
          <button onClick={() => aoFechar(false)} disabled={ocupado}>
            Fechar
          </button>
          {!linha.conciliado && podeLancar && cad.pronto && (
            <button className="primario" onClick={confirmar} disabled={ocupado}>
              {ocupado ? 'Gravando…' : 'Conciliar'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
