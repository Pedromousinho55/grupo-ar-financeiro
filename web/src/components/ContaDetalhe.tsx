// Janela de uma conta a pagar: dados, quem lançou/aprovou/pagou e as ações permitidas para cada situação.
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../auth'
import { formatarDocumento } from '../lib/documentos'
import { CLASSE_STATUS_CONTA, NOME_STATUS_CONTA, caminhoComprovante, hojeRecife, lerValor, prazoDe } from '../lib/contas'
import { dataBr, dinheiro } from '../lib/notas'
import { mensagemErro, supabase } from '../supabase'
import ContaForm, { type ContaEditavel } from './ContaForm'
import NotaDetalhe from './NotaDetalhe'

interface ContaCompleta extends ContaEditavel {
  aprovada_em: string | null
  pago_em: string | null
  valor_pago: number | null
  conta_bancaria_id: string | null
  baixa_em: string | null
  comprovante_arquivo: string | null
  motivo_cancelamento: string | null
  criado_em: string
  loja: { apelido: string; cnpj: string } | null
  fornecedor: { razao_social: string; nome_fantasia: string | null; documento: string; banco_codigo: string | null; agencia: string | null; conta: string | null; pix_tipo: string | null; pix_chave: string | null } | null
  plano: { codigo: string | null; nome: string } | null
  centro: { nome: string } | null
  forma: { nome: string } | null
  banco: { descricao: string } | null
  criador: { nome: string } | null
  aprovador: { nome: string } | null
  pagador: { nome: string } | null
}

const SELECAO = `*, loja:lojas(apelido, cnpj),
  fornecedor:fornecedores(razao_social, nome_fantasia, documento, banco_codigo, agencia, conta, pix_tipo, pix_chave),
  plano:plano_contas(codigo, nome), centro:centros_custo(nome), forma:formas_pagamento(nome), banco:contas_bancarias(descricao),
  criador:perfis!contas_pagar_criado_por_fkey(nome), aprovador:perfis!contas_pagar_aprovada_por_fkey(nome), pagador:perfis!contas_pagar_pago_por_fkey(nome)`

const quando = (v: string | null) => (v ? new Date(v).toLocaleString('pt-BR', { timeZone: 'America/Recife', dateStyle: 'short', timeStyle: 'short' }) : '—')
const valorTexto = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

type Painel = '' | 'pagar' | 'cancelar' | 'editar' | 'nota'

export default function ContaDetalhe({ id, aoFechar }: { id: string; aoFechar: (alterou: boolean) => void }) {
  const { podeLancar, eMaster } = useAuth()
  const [conta, setConta] = useState<ContaCompleta | null>(null)
  const [bancos, setBancos] = useState<{ id: string; descricao: string }[]>([])
  const [painel, setPainel] = useState<Painel>('')
  const [pagoEm, setPagoEm] = useState(hojeRecife())
  const [valorPago, setValorPago] = useState('')
  const [bancoId, setBancoId] = useState('')
  const [comprovante, setComprovante] = useState<File | null>(null)
  const [motivo, setMotivo] = useState('')
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [alterou, setAlterou] = useState(false)

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.from('contas_pagar').select(SELECAO).eq('id', id).single()
    if (error) return setErro(mensagemErro(error))
    const c = data as unknown as ContaCompleta
    setConta(c)
    setValorPago(valorTexto(Number(c.valor)))
    const b = await supabase.from('contas_bancarias').select('id, descricao').eq('loja_id', c.loja_id).eq('ativo', true).order('descricao')
    setBancos(b.data ?? [])
    if (b.data?.length === 1) setBancoId(b.data[0].id)
  }, [id])

  useEffect(() => {
    carregar()
  }, [carregar])

  const fechar = () => aoFechar(alterou)

  async function mudarStatus(dados: Record<string, unknown>, mensagem: string) {
    if (!conta) return
    setOcupado(true)
    setErro('')
    const { error } = await supabase.from('contas_pagar').update(dados).eq('id', conta.id)
    setOcupado(false)
    if (error) return setErro(mensagemErro(error))
    setAviso(mensagem)
    setPainel('')
    setAlterou(true)
    carregar()
  }

  async function enviarComprovante(arquivo: File, dataPagamento: string): Promise<string | null> {
    if (!conta?.loja) return null
    if (!/^(application\/pdf|image\/)/.test(arquivo.type)) {
      setErro('O comprovante deve ser PDF ou foto (JPG/PNG).')
      return null
    }
    if (arquivo.size > 20 * 1024 * 1024) {
      setErro('Arquivo maior que 20 MB.')
      return null
    }
    const caminho = caminhoComprovante(conta.loja.cnpj, dataPagamento, conta.id, arquivo.name)
    const up = await supabase.storage.from('comprovantes').upload(caminho, arquivo, { contentType: arquivo.type, upsert: false })
    if (up.error) {
      setErro('Falha ao enviar o comprovante: ' + up.error.message)
      return null
    }
    return caminho
  }

  async function pagar() {
    if (!conta) return
    const v = lerValor(valorPago)
    if (!pagoEm) return setErro('Informe a data do pagamento.')
    if (pagoEm > hojeRecife()) return setErro('A data do pagamento não pode ser no futuro.')
    if (v === null || v < 0) return setErro('Informe o valor pago.')
    if (!bancoId) return setErro('Escolha a conta bancária de onde saiu o pagamento.')
    setOcupado(true)
    setErro('')
    let caminho: string | null = null
    if (comprovante) {
      caminho = await enviarComprovante(comprovante, pagoEm)
      if (!caminho) return setOcupado(false)
    }
    await mudarStatus(
      { status: 'paga', pago_em: pagoEm, valor_pago: v, conta_bancaria_id: bancoId, ...(caminho ? { comprovante_arquivo: caminho } : {}) },
      'Pagamento registrado.',
    )
  }

  async function anexarComprovante(arquivo: File | undefined) {
    if (!conta || !arquivo) return
    setOcupado(true)
    setErro('')
    const caminho = await enviarComprovante(arquivo, conta.pago_em ?? hojeRecife())
    if (!caminho) return setOcupado(false)
    await mudarStatus({ comprovante_arquivo: caminho }, 'Comprovante anexado.')
  }

  async function verComprovante() {
    if (!conta?.comprovante_arquivo) return
    const { data, error } = await supabase.storage.from('comprovantes').createSignedUrl(conta.comprovante_arquivo, 300)
    if (error || !data) return setErro('Não foi possível abrir o comprovante: ' + (error?.message ?? ''))
    window.open(data.signedUrl, '_blank', 'noopener')
  }

  if (!conta)
    return (
      <div className="fundo-modal" onClick={fechar}>
        <div className="modal" onClick={e => e.stopPropagation()}>
          {erro ? <p className="erro">{erro}</p> : <p>Carregando…</p>}
        </div>
      </div>
    )

  if (painel === 'editar')
    return (
      <ContaForm
        conta={conta}
        aoFechar={gravou => {
          setPainel('')
          if (gravou) {
            setAviso('Alterações salvas.')
            setAlterou(true)
            carregar()
          }
        }}
      />
    )
  if (painel === 'nota' && conta.nota_id) return <NotaDetalhe id={conta.nota_id} aoFechar={() => setPainel('')} />

  const f = conta.fornecedor
  const prazo = prazoDe(conta.vencimento, conta.status)
  const aberta = conta.status === 'a_aprovar' || conta.status === 'aprovada'
  const podeCancelar = (conta.status === 'a_aprovar' && podeLancar) || (conta.status === 'aprovada' && eMaster)

  return (
    <div className="fundo-modal" onClick={fechar}>
      <div className="modal largo" onClick={e => e.stopPropagation()}>
        <div className="titulo-pagina">
          <h2>{conta.descricao}</h2>
          <span className={`selo ${CLASSE_STATUS_CONTA[conta.status]}`}>{NOME_STATUS_CONTA[conta.status]}</span>
        </div>
        {prazo === 'vencida' && <p className="erro">Conta vencida em {dataBr(conta.vencimento)}.</p>}
        {conta.status === 'a_aprovar' && !eMaster && <p className="aviso">Aguardando a aprovação do Pedro. Só depois disso o pagamento pode ser registrado.</p>}
        {conta.status === 'cancelada' && <p className="erro">Cancelada: {conta.motivo_cancelamento}</p>}

        <dl className="ficha">
          <dt>Valor</dt>
          <dd>
            <b>{dinheiro(conta.valor)}</b>
          </dd>
          <dt>Vencimento</dt>
          <dd>{dataBr(conta.vencimento)}</dd>
          <dt>Loja</dt>
          <dd>{conta.loja?.apelido ?? '—'}</dd>
          <dt>Fornecedor</dt>
          <dd>
            {f ? (
              <>
                {f.razao_social}
                <small>{formatarDocumento(f.documento)}</small>
                {(f.pix_chave || f.conta) && (
                  <small>
                    {f.pix_chave ? `PIX (${f.pix_tipo ?? 'chave'}): ${f.pix_chave}` : ''}
                    {f.pix_chave && f.conta ? ' · ' : ''}
                    {f.conta ? `Banco ${f.banco_codigo ?? '—'} · ag. ${f.agencia ?? '—'} · conta ${f.conta}` : ''}
                  </small>
                )}
              </>
            ) : (
              '—'
            )}
          </dd>
          <dt>Documento</dt>
          <dd>
            {conta.documento ?? '—'}
            {conta.parcela ? ` · parcela ${conta.parcela}` : ''}
            {conta.nota_id && (
              <button className="link" onClick={() => setPainel('nota')}>
                ver nota fiscal
              </button>
            )}
          </dd>
          <dt>Plano de contas</dt>
          <dd>{conta.plano ? `${conta.plano.codigo ? conta.plano.codigo + ' · ' : ''}${conta.plano.nome}` : '—'}</dd>
          <dt>Centro de custo</dt>
          <dd>{conta.centro?.nome ?? '—'}</dd>
          <dt>Forma de pagamento</dt>
          <dd>{conta.forma?.nome ?? '—'}</dd>
          <dt>Competência</dt>
          <dd>{dataBr(conta.competencia)}</dd>
          {conta.codigo_barras && (
            <>
              <dt>Código de barras</dt>
              <dd className="chave">
                {conta.codigo_barras}
                <button className="link" onClick={() => navigator.clipboard?.writeText(conta.codigo_barras!).then(() => setAviso('Código copiado.'))}>
                  copiar
                </button>
              </dd>
            </>
          )}
          {conta.observacao && (
            <>
              <dt>Observação</dt>
              <dd className="info-compl">{conta.observacao}</dd>
            </>
          )}
          <dt>Lançada</dt>
          <dd>
            {conta.criador?.nome ?? 'sistema'} em {quando(conta.criado_em)}
          </dd>
          {conta.aprovada_em && (
            <>
              <dt>Aprovada</dt>
              <dd>
                {conta.aprovador?.nome ?? '—'} em {quando(conta.aprovada_em)}
              </dd>
            </>
          )}
          {conta.status === 'paga' && (
            <>
              <dt>Pagamento</dt>
              <dd>
                <b>
                  {dinheiro(conta.valor_pago)} em {dataBr(conta.pago_em)}
                </b>
                <small>
                  {conta.banco?.descricao ?? '—'} · registrado por {conta.pagador?.nome ?? '—'} em {quando(conta.baixa_em)}
                </small>
                {Number(conta.valor_pago) !== Number(conta.valor) && (
                  <small className="aviso-txt">
                    Diferença de {dinheiro(Number(conta.valor_pago) - Number(conta.valor))} (juros/multa ou desconto)
                  </small>
                )}
              </dd>
            </>
          )}
        </dl>

        {conta.status === 'paga' && (
          <div className="acoes-arquivos">
            {conta.comprovante_arquivo ? <button onClick={verComprovante}>📎 Ver comprovante</button> : <span className="contagem">Sem comprovante anexado.</span>}
            {podeLancar && (
              <label className={`botao${ocupado ? ' desabilitado' : ''}`}>
                {conta.comprovante_arquivo ? 'Anexar outro comprovante' : '+ Anexar comprovante'}
                <input
                  type="file"
                  accept="application/pdf,image/*"
                  hidden
                  onChange={e => {
                    anexarComprovante(e.target.files?.[0])
                    e.target.value = ''
                  }}
                />
              </label>
            )}
          </div>
        )}

        {painel === 'pagar' && (
          <>
            <h3>Registrar pagamento</h3>
            <div className="grade-campos">
              <label>
                <span>Data do pagamento *</span>
                <input type="date" value={pagoEm} max={hojeRecife()} onChange={e => setPagoEm(e.target.value)} />
              </label>
              <label>
                <span>Valor pago (R$) *</span>
                <input inputMode="decimal" value={valorPago} onChange={e => setValorPago(e.target.value)} />
                <small>Com juros/multa ou desconto, informe o valor que saiu do banco.</small>
              </label>
              <label>
                <span>Conta bancária *</span>
                <select value={bancoId} onChange={e => setBancoId(e.target.value)}>
                  <option value="">Escolha…</option>
                  {bancos.map(b => (
                    <option key={b.id} value={b.id}>
                      {b.descricao}
                    </option>
                  ))}
                </select>
                {bancos.length === 0 && <small className="erro-txt">Nenhuma conta bancária desta loja cadastrada (Contas bancárias).</small>}
              </label>
              <label>
                <span>Comprovante (PDF ou foto)</span>
                <input type="file" accept="application/pdf,image/*" onChange={e => setComprovante(e.target.files?.[0] ?? null)} />
              </label>
            </div>
          </>
        )}

        {painel === 'cancelar' && (
          <>
            <h3>Cancelar conta</h3>
            <label>
              <span className="contagem">Motivo *</span>
              <textarea rows={2} value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Ex.: lançada em dobro; fornecedor deu desconto e emitiu outro boleto…" />
            </label>
          </>
        )}

        {aviso && <p className="ok">{aviso}</p>}
        {erro && <p className="erro">{erro}</p>}

        <div className="acoes acoes-conta">
          {painel === 'pagar' ? (
            <>
              <span className="espaco" />
              <button onClick={() => setPainel('')} disabled={ocupado}>
                Voltar
              </button>
              <button className="primario" onClick={pagar} disabled={ocupado}>
                {ocupado ? 'Gravando…' : 'Confirmar pagamento'}
              </button>
            </>
          ) : painel === 'cancelar' ? (
            <>
              <span className="espaco" />
              <button onClick={() => setPainel('')} disabled={ocupado}>
                Voltar
              </button>
              <button
                className="perigo"
                disabled={ocupado || !motivo.trim()}
                onClick={() => mudarStatus({ status: 'cancelada', motivo_cancelamento: motivo.trim() }, 'Conta cancelada.')}
              >
                {ocupado ? 'Gravando…' : 'Confirmar cancelamento'}
              </button>
            </>
          ) : (
            <>
              {podeCancelar && (
                <button className="perigo" onClick={() => setPainel('cancelar')} disabled={ocupado}>
                  Cancelar conta
                </button>
              )}
              {eMaster && conta.status === 'aprovada' && (
                <button onClick={() => mudarStatus({ status: 'a_aprovar' }, 'Aprovação desfeita.')} disabled={ocupado}>
                  Desfazer aprovação
                </button>
              )}
              {eMaster && conta.status === 'paga' && (
                <button
                  className="perigo"
                  disabled={ocupado}
                  onClick={() => {
                    if (window.confirm('Estornar o pagamento? A conta volta para "Aprovada" e os dados da baixa são apagados (fica tudo no Histórico).'))
                      mudarStatus({ status: 'aprovada' }, 'Pagamento estornado.')
                  }}
                >
                  Estornar pagamento
                </button>
              )}
              {eMaster && conta.status === 'cancelada' && (
                <button onClick={() => mudarStatus({ status: 'a_aprovar' }, 'Conta reaberta.')} disabled={ocupado}>
                  Reabrir conta
                </button>
              )}
              <span className="espaco" />
              <button onClick={fechar}>Fechar</button>
              {podeLancar && aberta && (
                <button onClick={() => setPainel('editar')} disabled={ocupado}>
                  Editar
                </button>
              )}
              {eMaster && conta.status === 'a_aprovar' && (
                <button className="primario" onClick={() => mudarStatus({ status: 'aprovada' }, 'Conta aprovada.')} disabled={ocupado}>
                  Aprovar
                </button>
              )}
              {podeLancar && conta.status === 'aprovada' && (
                <button className="primario" onClick={() => setPainel('pagar')} disabled={ocupado}>
                  Registrar pagamento
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
