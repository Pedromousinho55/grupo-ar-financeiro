// Lança uma nota fiscal no contas a pagar: uma conta por duplicata (ou uma só, sem duplicatas).
import { useEffect, useState } from 'react'
import { useAuth } from '../auth'
import { type Duplicata } from '../lib/nfe'
import { FORMA_DO_XML, hojeRecife, lerValor, parcelasDaNota } from '../lib/contas'
import { dinheiro } from '../lib/notas'
import { mensagemErro, supabase } from '../supabase'
import { ultimaClassificacao, useCadastrosConta } from './cadastrosConta'

export interface NotaParaLancar {
  id: string
  numero: string | null
  emitente_nome: string | null
  data_emissao: string | null
  valor_total: number | null
  duplicatas: Duplicata[]
  fornecedor_id: string | null
  loja_id: string | null
  forma_pagamento?: (string | null)[]
}

interface Linha {
  parcela: string | null
  vencimento: string
  valor: string
}

const valorTexto = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function LancarNota({ nota, aoFechar }: { nota: NotaParaLancar; aoFechar: (gravou: boolean) => void }) {
  const { eMaster } = useAuth()
  const cad = useCadastrosConta()
  const fornecedor = cad.fornecedores.find(f => f.id === nota.fornecedor_id) ?? null
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [plano, setPlano] = useState('')
  const [centro, setCentro] = useState('')
  const [forma, setForma] = useState('')
  const [competencia, setCompetencia] = useState(nota.data_emissao ? hojeRecife(new Date(nota.data_emissao)) : hojeRecife())
  const [descricao, setDescricao] = useState(`NF-e ${nota.numero ?? ''} · ${nota.emitente_nome ?? ''}`.trim())
  const [erro, setErro] = useState('')
  const [gravando, setGravando] = useState(false)
  const [sugestao, setSugestao] = useState(false)

  // parcelas: duplicatas do XML; sem elas, prazo padrão do fornecedor
  useEffect(() => {
    if (!cad.pronto) return
    setLinhas(parcelasDaNota(nota, fornecedor?.prazo_padrao_dias ?? null).map(p => ({ ...p, valor: valorTexto(p.valor) })))
  }, [cad.pronto, nota, fornecedor?.prazo_padrao_dias])

  // classificação: a última usada para o fornecedor; forma de pagamento: a do XML
  useEffect(() => {
    if (!cad.pronto) return
    ultimaClassificacao(nota.fornecedor_id).then(u => {
      if (u) {
        setPlano(u.plano_conta_id ?? '')
        setCentro(u.centro_custo_id ?? '')
        setForma(u.forma_pagamento_id ?? '')
        setSugestao(true)
      } else {
        const nomeForma = (nota.forma_pagamento ?? []).map(f => FORMA_DO_XML[f ?? '']).find(Boolean)
        const achada = cad.formas.find(f => f.nome === nomeForma)
        if (achada) setForma(achada.id)
      }
    })
  }, [cad.pronto, cad.formas, nota.fornecedor_id, nota.forma_pagamento])

  const valores = linhas.map(l => lerValor(l.valor))
  const soma = valores.reduce<number>((s, v) => s + (v ?? 0), 0)
  const diferenca = Math.round((soma - Number(nota.valor_total ?? 0)) * 100) / 100

  const mudarLinha = (i: number, campo: keyof Linha, v: string) => setLinhas(ls => ls.map((l, j) => (j === i ? { ...l, [campo]: v } : l)))

  async function gravar() {
    setErro('')
    if (!nota.loja_id) return setErro('Esta nota não está ligada a uma loja do grupo.')
    if (!plano) return setErro('Escolha a conta do plano de contas.')
    if (!descricao.trim()) return setErro('Escreva uma descrição.')
    if (linhas.length === 0) return setErro('Inclua ao menos uma parcela.')
    if (linhas.some((l, i) => !l.vencimento || !valores[i] || valores[i]! <= 0)) return setErro('Toda parcela precisa de vencimento e valor maior que zero.')
    setGravando(true)
    const { error } = await supabase.from('contas_pagar').insert(
      linhas.map((l, i) => ({
        nota_id: nota.id,
        loja_id: nota.loja_id,
        fornecedor_id: nota.fornecedor_id,
        descricao: descricao.trim(),
        documento: nota.numero,
        parcela: linhas.length > 1 ? `${i + 1}/${linhas.length}` : l.parcela,
        plano_conta_id: plano,
        centro_custo_id: centro || null,
        forma_pagamento_id: forma || null,
        competencia,
        vencimento: l.vencimento,
        valor: valores[i],
      })),
    )
    setGravando(false)
    if (error) return setErro(error.code === '23505' ? 'Esta nota (ou uma parcela dela) já foi lançada.' : mensagemErro(error))
    aoFechar(true)
  }

  return (
    <div className="fundo-modal" onClick={() => aoFechar(false)}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>Lançar no contas a pagar</h2>
        <p className="explicacao">
          NF-e {nota.numero} · {nota.emitente_nome} · <b>{dinheiro(nota.valor_total)}</b>
        </p>
        {!cad.pronto ? (
          <p>Carregando cadastros…</p>
        ) : (
          <fieldset disabled={gravando}>
            {!nota.fornecedor_id && (
              <p className="aviso">Fornecedor sem cadastro: dá para lançar, mas cadastre-o depois (dados bancários/PIX) em Fornecedores.</p>
            )}
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
                {sugestao && <small>Sugerido pelo último lançamento deste fornecedor.</small>}
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
              <label>
                <span>Competência (DRE)</span>
                <input type="date" value={competencia} onChange={e => setCompetencia(e.target.value)} />
              </label>
            </div>

            <h3>Parcelas</h3>
            <table className="compacta">
              <thead>
                <tr>
                  <th>Parcela</th>
                  <th>Vencimento</th>
                  <th className="num">Valor (R$)</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {linhas.map((l, i) => (
                  <tr key={i}>
                    <td>{linhas.length > 1 ? `${i + 1}/${linhas.length}` : 'única'}</td>
                    <td>
                      <input type="date" value={l.vencimento} onChange={e => mudarLinha(i, 'vencimento', e.target.value)} aria-label={`Vencimento da parcela ${i + 1}`} />
                    </td>
                    <td>
                      <input inputMode="decimal" className="num" value={l.valor} onChange={e => mudarLinha(i, 'valor', e.target.value)} aria-label={`Valor da parcela ${i + 1}`} />
                    </td>
                    <td>
                      {linhas.length > 1 && (
                        <button className="link" onClick={() => setLinhas(ls => ls.filter((_, j) => j !== i))}>
                          remover
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button
              className="link"
              onClick={() =>
                setLinhas(ls => [...ls, { parcela: null, vencimento: ls[ls.length - 1]?.vencimento ?? hojeRecife(), valor: '' }])
              }
            >
              + incluir parcela
            </button>
            <p className={diferenca === 0 ? 'contagem' : 'aviso'}>
              Soma das parcelas: <b>{dinheiro(soma)}</b>
              {diferenca !== 0 &&
                ` — ${diferenca > 0 ? 'maior' : 'menor'} que a nota em ${dinheiro(Math.abs(diferenca))}. Confira (desconto, frete, devolução…) antes de lançar.`}
            </p>
          </fieldset>
        )}
        {!eMaster && <p className="contagem">As contas entram como "A aprovar" e só podem ser pagas depois da aprovação do Pedro.</p>}
        {erro && <p className="erro">{erro}</p>}
        <div className="acoes">
          <span className="espaco" />
          <button onClick={() => aoFechar(false)} disabled={gravando}>
            Cancelar
          </button>
          <button className="primario" onClick={gravar} disabled={gravando || !cad.pronto}>
            {gravando ? 'Lançando…' : `Lançar ${linhas.length} conta(s)`}
          </button>
        </div>
      </div>
    </div>
  )
}
