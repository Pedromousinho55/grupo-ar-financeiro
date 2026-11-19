// Lançar conta à mão (aluguel, folha, impostos…) ou editar uma conta em aberto.
import { useEffect, useState } from 'react'
import { useAuth } from '../auth'
import { dividirValor, hojeRecife, lerValor, somaMeses, type StatusConta } from '../lib/contas'
import { dinheiro } from '../lib/notas'
import { mensagemErro, supabase } from '../supabase'
import { ultimaClassificacao, useCadastrosConta } from './cadastrosConta'

export interface ContaEditavel {
  id: string
  status: StatusConta
  loja_id: string
  fornecedor_id: string | null
  nota_id: string | null
  descricao: string
  documento: string | null
  parcela: string | null
  plano_conta_id: string
  centro_custo_id: string | null
  forma_pagamento_id: string | null
  competencia: string
  vencimento: string
  valor: number
  codigo_barras: string | null
  observacao: string | null
}

interface Campos {
  loja_id: string
  fornecedor_id: string
  descricao: string
  documento: string
  parcela: string
  plano_conta_id: string
  centro_custo_id: string
  forma_pagamento_id: string
  competencia: string
  vencimento: string
  valor: string
  codigo_barras: string
  observacao: string
  repetir: string // nº de meses (só ao lançar)
  modo_repeticao: 'igual' | 'dividir'
}

const valorTexto = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function ContaForm({ conta, aoFechar }: { conta?: ContaEditavel; aoFechar: (gravou: boolean) => void }) {
  const { eMaster } = useAuth()
  const cad = useCadastrosConta()
  const hoje = hojeRecife()
  const [c, setC] = useState<Campos>(() => ({
    loja_id: conta?.loja_id ?? '',
    fornecedor_id: conta?.fornecedor_id ?? '',
    descricao: conta?.descricao ?? '',
    documento: conta?.documento ?? '',
    parcela: conta?.parcela ?? '',
    plano_conta_id: conta?.plano_conta_id ?? '',
    centro_custo_id: conta?.centro_custo_id ?? '',
    forma_pagamento_id: conta?.forma_pagamento_id ?? '',
    competencia: conta?.competencia ?? hoje,
    vencimento: conta?.vencimento ?? '',
    valor: conta ? valorTexto(Number(conta.valor)) : '',
    codigo_barras: conta?.codigo_barras ?? '',
    observacao: conta?.observacao ?? '',
    repetir: '1',
    modo_repeticao: 'igual',
  }))
  const [erro, setErro] = useState('')
  const [gravando, setGravando] = useState(false)
  const da_nota = !!conta?.nota_id

  const [competenciaTocada, setCompetenciaTocada] = useState(!!conta)
  const mudar = (campo: keyof Campos, valor: string) =>
    setC(x => ({
      ...x,
      [campo]: valor,
      // lançamento novo: a competência acompanha o vencimento até alguém mudá-la à mão
      ...(campo === 'vencimento' && !competenciaTocada && valor ? { competencia: valor } : {}),
    }))

  // fornecedor escolhido num lançamento novo: sugere a última classificação usada para ele
  useEffect(() => {
    if (conta || !c.fornecedor_id) return
    ultimaClassificacao(c.fornecedor_id).then(u => {
      if (!u) return
      setC(x => ({
        ...x,
        plano_conta_id: x.plano_conta_id || u.plano_conta_id || '',
        centro_custo_id: x.centro_custo_id || u.centro_custo_id || '',
        forma_pagamento_id: x.forma_pagamento_id || u.forma_pagamento_id || '',
      }))
    })
  }, [c.fornecedor_id, conta])

  const valor = lerValor(c.valor)
  const meses = conta ? 1 : Math.max(1, Math.min(60, parseInt(c.repetir, 10) || 1))
  const valores = meses > 1 && c.modo_repeticao === 'dividir' && valor ? dividirValor(valor, meses) : Array(meses).fill(valor ?? 0)

  async function gravar() {
    setErro('')
    if (!c.loja_id) return setErro('Escolha a loja.')
    if (!c.descricao.trim()) return setErro('Escreva uma descrição (ex.: "Aluguel dezembro").')
    if (!c.plano_conta_id) return setErro('Escolha a conta do plano de contas.')
    if (!c.vencimento) return setErro('Informe o vencimento.')
    if (!valor || valor <= 0) return setErro('Informe um valor maior que zero.')
    const base = {
      loja_id: c.loja_id,
      fornecedor_id: c.fornecedor_id || null,
      descricao: c.descricao.trim(),
      documento: c.documento.trim() || null,
      plano_conta_id: c.plano_conta_id,
      centro_custo_id: c.centro_custo_id || null,
      forma_pagamento_id: c.forma_pagamento_id || null,
      competencia: c.competencia || c.vencimento,
      codigo_barras: c.codigo_barras.trim() || null,
      observacao: c.observacao.trim() || null,
    }
    setGravando(true)
    const { error } = conta
      ? await supabase
          .from('contas_pagar')
          .update({ ...base, parcela: c.parcela.trim() || null, vencimento: c.vencimento, valor })
          .eq('id', conta.id)
      : await supabase.from('contas_pagar').insert(
          valores.map((v, i) => ({
            ...base,
            parcela: meses > 1 ? `${i + 1}/${meses}` : c.parcela.trim() || null,
            vencimento: somaMeses(c.vencimento, i),
            competencia: meses > 1 ? somaMeses(base.competencia, i) : base.competencia,
            valor: v,
          })),
        )
    setGravando(false)
    if (error) return setErro(mensagemErro(error))
    aoFechar(true)
  }

  const aviso_reaprovacao = conta?.status === 'aprovada' && !eMaster

  return (
    <div className="fundo-modal" onClick={() => aoFechar(false)}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>{conta ? 'Editar conta' : 'Nova conta a pagar'}</h2>
        {!cad.pronto ? (
          <p>Carregando cadastros…</p>
        ) : (
          <fieldset disabled={gravando}>
            <div className="grade-campos">
              <label>
                <span>Loja *</span>
                <select value={c.loja_id} onChange={e => mudar('loja_id', e.target.value)} disabled={da_nota}>
                  <option value="">Escolha…</option>
                  {cad.lojas.map(l => (
                    <option key={l.id} value={l.id}>
                      {l.nome}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Fornecedor</span>
                <select value={c.fornecedor_id} onChange={e => mudar('fornecedor_id', e.target.value)}>
                  <option value="">(sem fornecedor cadastrado)</option>
                  {cad.fornecedores.map(f => (
                    <option key={f.id} value={f.id}>
                      {f.nome}
                    </option>
                  ))}
                </select>
              </label>
              <label className="largo">
                <span>Descrição *</span>
                <input value={c.descricao} onChange={e => mudar('descricao', e.target.value)} placeholder="Ex.: Aluguel dezembro, Energia Neoenergia…" />
              </label>
              <label>
                <span>Plano de contas *</span>
                <select value={c.plano_conta_id} onChange={e => mudar('plano_conta_id', e.target.value)}>
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
                <select value={c.centro_custo_id} onChange={e => mudar('centro_custo_id', e.target.value)}>
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
                <select value={c.forma_pagamento_id} onChange={e => mudar('forma_pagamento_id', e.target.value)}>
                  <option value="">—</option>
                  {cad.formas.map(x => (
                    <option key={x.id} value={x.id}>
                      {x.nome}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Documento</span>
                <input value={c.documento} onChange={e => mudar('documento', e.target.value)} placeholder="Nº do boleto, nota, contrato…" />
              </label>
              <label>
                <span>{conta ? 'Vencimento *' : 'Vencimento (1ª) *'}</span>
                <input type="date" value={c.vencimento} onChange={e => mudar('vencimento', e.target.value)} />
              </label>
              <label>
                <span>Valor (R$) *</span>
                <input inputMode="decimal" value={c.valor} onChange={e => mudar('valor', e.target.value)} placeholder="0,00" />
              </label>
              <label>
                <span>Competência (DRE)</span>
                <input
                  type="date"
                  value={c.competencia}
                  onChange={e => {
                    setCompetenciaTocada(true)
                    mudar('competencia', e.target.value)
                  }}
                />
                <small>Mês em que a despesa entra na DRE.</small>
              </label>
              {conta ? (
                <label>
                  <span>Parcela</span>
                  <input value={c.parcela} onChange={e => mudar('parcela', e.target.value)} placeholder="Ex.: 1/3" />
                </label>
              ) : (
                <label>
                  <span>Repetir por quantos meses</span>
                  <input type="number" min={1} max={60} value={c.repetir} onChange={e => mudar('repetir', e.target.value)} />
                  {meses > 1 && (
                    <select value={c.modo_repeticao} onChange={e => mudar('modo_repeticao', e.target.value)}>
                      <option value="igual">mesmo valor todo mês (ex.: aluguel)</option>
                      <option value="dividir">dividir o valor em {meses} parcelas</option>
                    </select>
                  )}
                </label>
              )}
              <label className="largo">
                <span>Código de barras / PIX copia e cola</span>
                <input value={c.codigo_barras} onChange={e => mudar('codigo_barras', e.target.value)} />
              </label>
              <label className="largo">
                <span>Observação</span>
                <textarea rows={2} value={c.observacao} onChange={e => mudar('observacao', e.target.value)} />
              </label>
            </div>
          </fieldset>
        )}
        {meses > 1 && valor ? (
          <p className="info">
            Serão lançadas {meses} contas, de {new Date(c.vencimento + 'T12:00:00').toLocaleDateString('pt-BR')} em diante, uma por mês, de{' '}
            {dinheiro(valores[0])}
            {c.modo_repeticao === 'dividir' ? ` (total ${dinheiro(valor)})` : ` cada (total ${dinheiro(valor * meses)})`}.
          </p>
        ) : null}
        {aviso_reaprovacao && <p className="aviso">Esta conta já foi aprovada. Se mudar valor, vencimento ou classificação, ela volta para a aprovação do Pedro.</p>}
        {!conta && !eMaster && <p className="contagem">A conta entra como "A aprovar" e só pode ser paga depois da aprovação do Pedro.</p>}
        {erro && <p className="erro">{erro}</p>}
        <div className="acoes">
          <span className="espaco" />
          <button onClick={() => aoFechar(false)} disabled={gravando}>
            Cancelar
          </button>
          <button className="primario" onClick={gravar} disabled={gravando || !cad.pronto}>
            {gravando ? 'Gravando…' : conta ? 'Salvar' : meses > 1 ? `Lançar ${meses} contas` : 'Lançar conta'}
          </button>
        </div>
      </div>
    </div>
  )
}
