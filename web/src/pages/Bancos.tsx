// Bancos: saldo de cada conta (calculado x banco) e importação de extratos OFX.
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth'
import { dataBr, dinheiro } from '../lib/notas'
import { hojeRecife } from '../lib/contas'
import { contaPeloNome, lerExtratoPlanilha } from '../lib/extratoPlanilha'
import { acharConta, decodificarOfx, lerOfx, type ExtratoOfx } from '../lib/ofx'
import { lerXlsx } from '../lib/planilhaSimples'
import { mensagemErro, supabase } from '../supabase'

interface Saldo {
  conta_bancaria_id: string
  descricao: string
  saldo_inicial: number
  data_saldo_inicial: string | null
  saldo_calculado: number
  ultimo_movimento: string | null
  saldo_banco: number | null
  saldo_banco_data: string | null
  pendentes: number
}

interface ContaBanco {
  id: string
  descricao: string
  agencia: string | null
  conta: string | null
}

interface Arquivo {
  nome: string
  extrato: (ExtratoOfx & { futuras?: number }) | null
  erro: string | null
  contaId: string
  repetidas: number | null
}

export default function Bancos() {
  const { podeLancar } = useAuth()
  const [saldos, setSaldos] = useState<Saldo[]>([])
  const [contas, setContas] = useState<ContaBanco[]>([])
  const [arquivos, setArquivos] = useState<Arquivo[]>([])
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')

  const carregar = useCallback(async () => {
    const [s, c] = await Promise.all([
      supabase.from('saldos_contas').select('*').order('descricao'),
      supabase.from('contas_bancarias').select('id, descricao, agencia, conta').eq('ativo', true).order('descricao'),
    ])
    if (s.error) setErro(mensagemErro(s.error))
    setSaldos((s.data ?? []) as Saldo[])
    setContas((c.data ?? []) as ContaBanco[])
  }, [])

  useEffect(() => {
    carregar()
  }, [carregar])

  // quantas transações do arquivo já estão no sistema (reimportar não duplica)
  async function contarRepetidas(a: Arquivo): Promise<number | null> {
    if (!a.extrato || !a.contaId) return null
    const fitids = a.extrato.transacoes.map(t => t.fitid)
    let n = 0
    for (let i = 0; i < fitids.length; i += 200) {
      const { count } = await supabase
        .from('extrato_lancamentos')
        .select('id', { count: 'exact', head: true })
        .eq('conta_bancaria_id', a.contaId)
        .in('fitid', fitids.slice(i, i + 200))
      n += count ?? 0
    }
    return n
  }

  async function escolher(lista: FileList | null) {
    if (!lista?.length) return
    setErro('')
    setAviso('')
    setOcupado(true)
    const lidos: Arquivo[] = []
    for (const f of Array.from(lista)) {
      try {
        const bytes = await f.arrayBuffer()
        // planilha do Santander (.xlsx): a conta vem do nome do arquivo; OFX: do número da conta
        const planilha = /\.xlsx$/i.test(f.name)
        const extrato = planilha ? lerExtratoPlanilha(await lerXlsx(bytes), hojeRecife()) : lerOfx(decodificarOfx(bytes))
        const conta = planilha ? contaPeloNome(f.name, contas) : acharConta(extrato, contas)
        const a: Arquivo = { nome: f.name, extrato, erro: null, contaId: conta?.id ?? '', repetidas: null }
        a.repetidas = await contarRepetidas(a)
        lidos.push(a)
      } catch (e) {
        lidos.push({ nome: f.name, extrato: null, erro: (e as Error).message, contaId: '', repetidas: null })
      }
    }
    setArquivos(lidos)
    setOcupado(false)
  }

  async function mudarConta(i: number, contaId: string) {
    const a = { ...arquivos[i], contaId }
    a.repetidas = await contarRepetidas(a)
    setArquivos(arqs => arqs.map((x, j) => (j === i ? a : x)))
  }

  const prontos = arquivos.filter(a => a.extrato && a.contaId)

  async function importar() {
    setOcupado(true)
    setErro('')
    const mensagens: string[] = []
    for (const a of prontos) {
      const e = a.extrato!
      const { data: imp, error } = await supabase
        .from('extrato_importacoes')
        .insert({
          conta_bancaria_id: a.contaId,
          arquivo_nome: a.nome,
          periodo_inicio: e.inicio,
          periodo_fim: e.fim,
          saldo_final: e.saldoFinal,
          saldo_data: e.saldoData ?? e.fim,
        })
        .select('id')
        .single()
      if (error || !imp) {
        mensagens.push(`${a.nome}: ${mensagemErro(error)}`)
        continue
      }
      let novas = 0
      for (let i = 0; i < e.transacoes.length; i += 200) {
        const { data, error: e2 } = await supabase
          .from('extrato_lancamentos')
          .upsert(
            e.transacoes.slice(i, i + 200).map(t => ({
              conta_bancaria_id: a.contaId,
              importacao_id: imp.id,
              fitid: t.fitid,
              data: t.data,
              valor: t.valor,
              descricao: t.descricao,
              documento: t.documento,
              tipo_ofx: t.tipo,
            })),
            { onConflict: 'conta_bancaria_id,fitid', ignoreDuplicates: true },
          )
          .select('id')
        if (e2) {
          mensagens.push(`${a.nome}: ${mensagemErro(e2)}`)
          break
        }
        novas += data?.length ?? 0
      }
      await supabase
        .from('extrato_importacoes')
        .update({ linhas_novas: novas, linhas_repetidas: e.transacoes.length - novas })
        .eq('id', imp.id)
      mensagens.push(`${a.nome}: ${novas} lançamento(s) novo(s), ${e.transacoes.length - novas} já existiam.`)
    }
    // regras automáticas (Contamax, tarifas…) conciliam sozinhas o que é repetitivo
    const { data: auto, error: eRegras } = await supabase.rpc('aplicar_regras_automaticas', { p_conta: null })
    if (eRegras) mensagens.push(`Regras automáticas: ${mensagemErro(eRegras)}`)
    else if (auto) mensagens.push(`${auto} lançamento(s) conciliado(s) automaticamente pelas regras.`)
    setOcupado(false)
    setArquivos([])
    setAviso(mensagens.join('\n'))
    carregar()
  }

  const nomeConta = (id: string) => contas.find(c => c.id === id)?.descricao ?? '—'

  return (
    <section>
      <header className="titulo-pagina">
        <h1>Bancos</h1>
        <Link to="/conciliacao" className="botao primario">
          Conciliar extrato →
        </Link>
      </header>
      <p className="explicacao">
        Saldo de cada conta calculado pelo sistema (saldo inicial + extratos importados) comparado com o saldo informado pelo banco no último
        arquivo. Diferença diferente de zero indica extrato faltando. O saldo inicial é definido em Contas bancárias.
      </p>

      <div className="tabela-rolagem">
        <table>
          <thead>
            <tr>
              <th>Conta</th>
              <th className="num">Saldo inicial</th>
              <th className="num">Saldo calculado</th>
              <th className="num">Saldo no banco</th>
              <th className="num">Diferença</th>
              <th>Último movimento</th>
              <th className="num">A conciliar</th>
            </tr>
          </thead>
          <tbody>
            {saldos.map(s => {
              const dif = s.saldo_banco === null ? null : Math.round((Number(s.saldo_calculado) - Number(s.saldo_banco)) * 100) / 100
              return (
                <tr key={s.conta_bancaria_id}>
                  <td>{s.descricao}</td>
                  <td className="num nowrap">
                    {dinheiro(s.saldo_inicial)}
                    <div className="mudanca">{s.data_saldo_inicial ? `em ${dataBr(s.data_saldo_inicial)}` : 'sem data'}</div>
                  </td>
                  <td className="num nowrap">{dinheiro(s.saldo_calculado)}</td>
                  <td className="num nowrap">
                    {s.saldo_banco === null ? '—' : dinheiro(s.saldo_banco)}
                    {s.saldo_banco_data && <div className="mudanca">em {dataBr(s.saldo_banco_data)}</div>}
                  </td>
                  <td className="num nowrap">
                    {dif === null ? '—' : dif === 0 ? <span className="selo ok">confere</span> : <span className="selo erro">{dinheiro(dif)}</span>}
                  </td>
                  <td>{dataBr(s.ultimo_movimento)}</td>
                  <td className="num">
                    {s.pendentes > 0 ? (
                      <Link to={`/conciliacao?conta=${s.conta_bancaria_id}`}>{s.pendentes}</Link>
                    ) : (
                      <span className="contagem">0</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {saldos.some(s => !s.data_saldo_inicial) && (
        <p className="aviso">Há contas sem data de saldo inicial: informe o saldo de 31/10/2026 em Contas bancárias para o saldo calculado fazer sentido.</p>
      )}

      {podeLancar && (
        <>
          <h2>Importar extrato</h2>
          <p className="explicacao">
            No internet banking do Santander, exporte o extrato do período em planilha (.xlsx) ou OFX. Na planilha, a conta é reconhecida pelo
            nome do arquivo (ex.: "Extrato_Voar.xlsx"). Pode escolher vários arquivos de uma vez. Lançamentos já importados são ignorados, então pode
            reimportar um período sem medo; lançamentos agendados para depois de hoje ficam para o próximo extrato.
          </p>
          <label className={`botao primario seletor-arquivo${ocupado ? ' desabilitado' : ''}`}>
            {ocupado ? 'Lendo…' : 'Escolher extratos (planilha ou OFX)'}
            <input
              type="file"
              accept=".xlsx,.ofx,.OFX,application/x-ofx"
              multiple
              hidden
              onChange={e => {
                escolher(e.target.files)
                e.target.value = ''
              }}
            />
          </label>
        </>
      )}
      {erro && <p className="erro">{erro}</p>}
      {aviso && <p className="ok pre">{aviso}</p>}

      {arquivos.length > 0 && (
        <>
          <div className="tabela-rolagem">
            <table>
              <thead>
                <tr>
                  <th>Arquivo</th>
                  <th>Conta</th>
                  <th>Período</th>
                  <th className="num">Transações</th>
                  <th className="num">Saldo no banco</th>
                </tr>
              </thead>
              <tbody>
                {arquivos.map((a, i) => (
                  <tr key={i} className={a.erro || !a.contaId ? 'sit-erro' : ''}>
                    <td className="arquivo">{a.nome}</td>
                    <td>
                      {a.erro ? (
                        <span className="erro-txt">{a.erro}</span>
                      ) : (
                        <>
                          <select value={a.contaId} onChange={e => mudarConta(i, e.target.value)} aria-label="Conta do extrato">
                            <option value="">Escolha a conta…</option>
                            {contas.map(c => (
                              <option key={c.id} value={c.id}>
                                {c.descricao}
                              </option>
                            ))}
                          </select>
                          <div className="mudanca">
                            {a.extrato?.conta ? `No arquivo: ag. ${a.extrato.agencia ?? '—'} · conta ${a.extrato.conta}` : 'Reconhecida pelo nome do arquivo'}
                            {!a.contaId && ' — não reconhecida, escolha acima'}
                          </div>
                        </>
                      )}
                    </td>
                    <td className="nowrap">{a.extrato ? `${dataBr(a.extrato.inicio)} a ${dataBr(a.extrato.fim)}` : '—'}</td>
                    <td className="num">
                      {a.extrato?.transacoes.length ?? '—'}
                      {a.repetidas !== null && a.repetidas > 0 && <div className="mudanca">{a.repetidas} já importada(s)</div>}
                      {!!a.extrato?.futuras && <div className="mudanca">{a.extrato.futuras} agendada(s) para depois de hoje: ficam de fora</div>}
                    </td>
                    <td className="num nowrap">
                      {a.extrato?.saldoFinal === null || !a.extrato ? '—' : dinheiro(a.extrato.saldoFinal)}
                      {a.extrato?.saldoData && <div className="mudanca">em {dataBr(a.extrato.saldoData)}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="rodape-importacao">
            <span>
              {prontos.length} arquivo(s) pronto(s): {prontos.map(a => nomeConta(a.contaId)).join(', ') || '—'}
            </span>
            <span>
              <button onClick={() => setArquivos([])} disabled={ocupado}>
                Cancelar
              </button>{' '}
              <button className="primario" onClick={importar} disabled={ocupado || prontos.length === 0}>
                {ocupado ? 'Importando…' : 'Importar'}
              </button>
            </span>
          </div>
        </>
      )}
    </section>
  )
}
