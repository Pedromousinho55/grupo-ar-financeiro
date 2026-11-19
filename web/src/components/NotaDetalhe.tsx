// Janela com tudo sobre uma nota: dados, itens, duplicatas, eventos, arquivos e status de recebimento.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth'
import { CLASSE_STATUS_CONTA, NOME_STATUS_CONTA, type StatusConta } from '../lib/contas'
import { formatarDocumento } from '../lib/documentos'
import { caminhoDanfe, type Duplicata, type Item } from '../lib/nfe'
import {
  CLASSE_STATUS,
  EXPLICA_STATUS,
  FORMA_PAGAMENTO,
  NOME_SITUACAO,
  NOME_STATUS,
  STATUS_ESCOLHA,
  dataBr,
  dinheiro,
  type SituacaoSefaz,
  type StatusNota,
} from '../lib/notas'
import { mensagemErro, supabase } from '../supabase'
import LancarNota, { type NotaParaLancar } from './LancarNota'

interface NotaCompleta {
  id: string
  loja_id: string | null
  fornecedor_id: string | null
  chave: string
  emitente_cnpj: string
  emitente_nome: string | null
  emitente_ie: string | null
  numero: string | null
  serie: string | null
  data_emissao: string | null
  valor_total: number | null
  tipo_documento: 'resumo' | 'completa'
  situacao_sefaz: SituacaoSefaz
  status: StatusNota
  duplicatas: Duplicata[]
  dados: {
    natureza_operacao?: string | null
    protocolo?: string | null
    info_complementar?: string | null
    forma_pagamento?: (string | null)[]
    itens?: Item[]
    sem_protocolo?: boolean
  }
  xml_arquivo: string | null
  pdf_arquivo: string | null
  origem: string
  observacao: string | null
  recebida_em: string | null
  loja: { apelido: string; cnpj: string } | null
  fornecedor: { razao_social: string; nome_fantasia: string | null } | null
  recebedor: { nome: string } | null
}

interface ContaDaNota {
  id: string
  parcela: string | null
  vencimento: string
  valor: number
  status: StatusConta
}

interface Evento {
  id: string
  tipo_evento: string
  descricao: string | null
  data_evento: string | null
  dados: { justificativa?: string | null; correcao?: string | null }
}

const NOME_ORIGEM: Record<string, string> = {
  sefaz: 'SEFAZ (coletor)',
  pasta: 'Importado do Klaus',
  upload: 'Enviado pelo site',
  danfe: 'DANFE',
}

export default function NotaDetalhe({ id, aoFechar }: { id: string; aoFechar: (alterou: boolean) => void }) {
  const { podeLancar, perfil } = useAuth()
  const [nota, setNota] = useState<NotaCompleta | null>(null)
  const [eventos, setEventos] = useState<Evento[]>([])
  const [status, setStatus] = useState<StatusNota>('na_sefaz')
  const [observacao, setObservacao] = useState('')
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')
  const [ocupado, setOcupado] = useState('')
  const [alterou, setAlterou] = useState(false)
  const [contas, setContas] = useState<ContaDaNota[]>([])
  const [lancando, setLancando] = useState(false)

  const carregar = useCallback(async () => {
    const { data, error } = await supabase
      .from('notas_fiscais')
      .select('*, loja:lojas(apelido, cnpj), fornecedor:fornecedores(razao_social, nome_fantasia), recebedor:perfis(nome)')
      .eq('id', id)
      .single()
    if (error) return setErro(mensagemErro(error))
    const n = data as unknown as NotaCompleta
    setNota(n)
    setStatus(n.status)
    setObservacao(n.observacao ?? '')
    const ev = await supabase.from('eventos_nfe').select('id, tipo_evento, descricao, data_evento, dados').eq('chave', n.chave).order('data_evento')
    setEventos((ev.data ?? []) as Evento[])
    const ct = await supabase.from('contas_pagar').select('id, parcela, vencimento, valor, status').eq('nota_id', n.id).order('vencimento')
    setContas((ct.data ?? []) as ContaDaNota[])
  }, [id])

  useEffect(() => {
    carregar()
  }, [carregar])

  const fechar = () => aoFechar(alterou)

  const paraLancar = useMemo<NotaParaLancar | null>(
    () =>
      nota && {
        id: nota.id,
        numero: nota.numero,
        emitente_nome: nota.fornecedor?.razao_social ?? nota.emitente_nome,
        data_emissao: nota.data_emissao,
        valor_total: nota.valor_total,
        duplicatas: nota.duplicatas,
        fornecedor_id: nota.fornecedor_id,
        loja_id: nota.loja_id,
        forma_pagamento: nota.dados.forma_pagamento,
      },
    [nota],
  )

  async function abrirArquivo(caminho: string, baixarComo?: string) {
    setErro('')
    const { data, error } = await supabase.storage.from('notas-xml').createSignedUrl(caminho, 300, baixarComo ? { download: baixarComo } : undefined)
    if (error || !data) return setErro('Não foi possível abrir o arquivo: ' + (error?.message ?? 'sem endereço'))
    window.open(data.signedUrl, '_blank', 'noopener')
  }

  async function salvarStatus() {
    if (!nota) return
    if ((status === 'problema' || status === 'nao_reconhecida') && !observacao.trim())
      return setErro('Explique na observação o que aconteceu com esta nota.')
    setOcupado('status')
    setErro('')
    const recebeu = status === 'recebida' || status === 'problema'
    const mudouRecebimento = recebeu && nota.status !== status
    const { error } = await supabase
      .from('notas_fiscais')
      .update({
        status,
        observacao: observacao.trim() || null,
        ...(mudouRecebimento ? { recebida_por: perfil?.id, recebida_em: new Date().toISOString() } : {}),
        ...(!recebeu ? { recebida_por: null, recebida_em: null } : {}),
      })
      .eq('id', nota.id)
    setOcupado('')
    if (error) return setErro(mensagemErro(error))
    setAviso('Status salvo.')
    setAlterou(true)
    carregar()
  }

  async function anexarDanfe(arquivo: File | undefined) {
    if (!nota || !arquivo) return
    if (!nota.loja) return setErro('Nota sem loja: não dá para anexar.')
    if (!/^(application\/pdf|image\/)/.test(arquivo.type)) return setErro('Envie um PDF ou uma foto (JPG/PNG).')
    if (arquivo.size > 20 * 1024 * 1024) return setErro('Arquivo maior que 20 MB. Tire uma foto com menos resolução ou comprima o PDF.')
    setOcupado('danfe')
    setErro('')
    const caminho = caminhoDanfe(nota.loja.cnpj, nota.chave, arquivo.name)
    const up = await supabase.storage.from('notas-xml').upload(caminho, arquivo, { contentType: arquivo.type, upsert: false })
    if (up.error) {
      setOcupado('')
      return setErro('Falha ao enviar o arquivo: ' + up.error.message)
    }
    const { error } = await supabase.from('notas_fiscais').update({ pdf_arquivo: caminho }).eq('id', nota.id)
    setOcupado('')
    if (error) return setErro(mensagemErro(error))
    setAviso('DANFE anexado.')
    setAlterou(true)
    carregar()
  }

  if (!nota)
    return (
      <div className="fundo-modal" onClick={fechar}>
        <div className="modal" onClick={e => e.stopPropagation()}>
          {erro ? <p className="erro">{erro}</p> : <p>Carregando…</p>}
        </div>
      </div>
    )

  const itens = nota.dados.itens ?? []
  const formas = (nota.dados.forma_pagamento ?? []).filter(Boolean).map(f => FORMA_PAGAMENTO[f!] ?? f)

  return (
    <div className="fundo-modal" onClick={fechar}>
      <div className="modal largo" onClick={e => e.stopPropagation()}>
        <div className="titulo-pagina">
          <h2>
            NF-e {nota.numero ?? '—'}
            {nota.serie ? ` / série ${nota.serie}` : ''}
          </h2>
          <span className={`selo ${CLASSE_STATUS[nota.status]}`}>{NOME_STATUS[nota.status]}</span>
        </div>

        {nota.situacao_sefaz !== 'autorizada' && (
          <p className="erro">Nota {NOME_SITUACAO[nota.situacao_sefaz].toLowerCase()} na SEFAZ. Não deve ser paga nem lançada.</p>
        )}
        {nota.tipo_documento === 'resumo' && (
          <p className="aviso">
            Só temos o <b>resumo</b> desta nota (sem itens e sem duplicatas). O XML completo chega pelo Klaus quando estiver disponível, ou
            pode ser enviado em "Enviar XML".
          </p>
        )}
        {nota.dados.sem_protocolo && <p className="aviso">O XML enviado não tinha o protocolo de autorização da SEFAZ. Confira a chave no portal da SEFAZ.</p>}

        <dl className="ficha">
          <dt>Fornecedor</dt>
          <dd>
            {nota.fornecedor?.razao_social ?? nota.emitente_nome ?? '—'}
            <small>
              {formatarDocumento(nota.emitente_cnpj)}
              {nota.emitente_ie ? ` · IE ${nota.emitente_ie}` : ''}
            </small>
            {!nota.fornecedor && <span className="selo aviso">sem cadastro de fornecedor</span>}
          </dd>
          <dt>Loja</dt>
          <dd>{nota.loja?.apelido ?? '—'}</dd>
          <dt>Emissão</dt>
          <dd>{nota.data_emissao ? new Date(nota.data_emissao).toLocaleString('pt-BR', { timeZone: 'America/Recife' }) : '—'}</dd>
          <dt>Valor total</dt>
          <dd>
            <b>{dinheiro(nota.valor_total)}</b>
            {formas.length > 0 && <small>Pagamento: {formas.join(', ')}</small>}
          </dd>
          {nota.dados.natureza_operacao && (
            <>
              <dt>Natureza</dt>
              <dd>{nota.dados.natureza_operacao}</dd>
            </>
          )}
          <dt>Chave de acesso</dt>
          <dd className="chave">
            {nota.chave.replace(/(\d{4})(?=\d)/g, '$1 ')}
            <button className="link" onClick={() => navigator.clipboard?.writeText(nota.chave).then(() => setAviso('Chave copiada.'))}>
              copiar
            </button>
          </dd>
          <dt>Origem</dt>
          <dd>{NOME_ORIGEM[nota.origem] ?? nota.origem}</dd>
          {nota.recebida_em && (
            <>
              <dt>Recebimento</dt>
              <dd>
                {nota.recebedor?.nome ?? '—'} em {new Date(nota.recebida_em).toLocaleString('pt-BR', { timeZone: 'America/Recife' })}
              </dd>
            </>
          )}
          {nota.dados.info_complementar && (
            <>
              <dt>Informações</dt>
              <dd className="info-compl">{nota.dados.info_complementar}</dd>
            </>
          )}
        </dl>

        <h3>Arquivos</h3>
        <div className="acoes-arquivos">
          {nota.xml_arquivo && (
            <button onClick={() => abrirArquivo(nota.xml_arquivo!, `${nota.chave}.xml`)}>⬇ Baixar XML{nota.tipo_documento === 'resumo' ? ' (resumo)' : ''}</button>
          )}
          {nota.pdf_arquivo ? <button onClick={() => abrirArquivo(nota.pdf_arquivo!)}>📎 Ver DANFE anexado</button> : <span className="contagem">Nenhum DANFE anexado.</span>}
          {podeLancar && (
            <label className={`botao${ocupado === 'danfe' ? ' desabilitado' : ''}`}>
              {ocupado === 'danfe' ? 'Enviando…' : nota.pdf_arquivo ? 'Anexar outro DANFE' : '+ Anexar DANFE (foto ou PDF)'}
              <input
                type="file"
                accept="application/pdf,image/*"
                hidden
                disabled={!!ocupado}
                onChange={e => {
                  anexarDanfe(e.target.files?.[0])
                  e.target.value = ''
                }}
              />
            </label>
          )}
        </div>

        {nota.duplicatas.length > 0 && (
          <>
            <h3>Duplicatas (vencimentos)</h3>
            <table className="compacta">
              <thead>
                <tr>
                  <th>Parcela</th>
                  <th>Vencimento</th>
                  <th className="num">Valor</th>
                </tr>
              </thead>
              <tbody>
                {nota.duplicatas.map((d, i) => (
                  <tr key={i}>
                    <td>{d.numero ?? i + 1}</td>
                    <td>{dataBr(d.vencimento)}</td>
                    <td className="num">{dinheiro(d.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <h3>Contas a pagar</h3>
        {contas.length > 0 ? (
          <table className="compacta">
            <thead>
              <tr>
                <th>Parcela</th>
                <th>Vencimento</th>
                <th className="num">Valor</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {contas.map(c => (
                <tr key={c.id} className={c.status === 'cancelada' ? 'inativo' : ''}>
                  <td>{c.parcela ?? 'única'}</td>
                  <td>{dataBr(c.vencimento)}</td>
                  <td className="num">{dinheiro(c.valor)}</td>
                  <td>
                    <span className={`selo ${CLASSE_STATUS_CONTA[c.status]}`}>{NOME_STATUS_CONTA[c.status]}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="contagem">Ainda não lançada no contas a pagar.</p>
        )}
        {podeLancar && nota.situacao_sefaz === 'autorizada' && nota.loja_id && !contas.some(c => c.status !== 'cancelada') && (
          <button className="primario" onClick={() => setLancando(true)}>
            Lançar no contas a pagar
          </button>
        )}

        {itens.length > 0 && (
          <>
            <h3>Itens ({itens.length})</h3>
            <div className="tabela-rolagem alta">
              <table className="compacta">
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th className="num">Qtd.</th>
                    <th>Un.</th>
                    <th className="num">Valor</th>
                    <th>CFOP</th>
                  </tr>
                </thead>
                <tbody>
                  {itens.map((it, i) => (
                    <tr key={i}>
                      <td>
                        {it.descricao}
                        {it.codigo && <small className="contagem"> · cód. {it.codigo}</small>}
                      </td>
                      <td className="num">{it.quantidade ? Number(it.quantidade).toLocaleString('pt-BR', { maximumFractionDigits: 4 }) : '—'}</td>
                      <td>{it.unidade}</td>
                      <td className="num">{dinheiro(it.valor)}</td>
                      <td>{it.cfop}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {eventos.length > 0 && (
          <>
            <h3>Eventos na SEFAZ</h3>
            <ul className="eventos">
              {eventos.map(ev => (
                <li key={ev.id}>
                  <b>{ev.descricao ?? ev.tipo_evento}</b> · {ev.data_evento ? new Date(ev.data_evento).toLocaleString('pt-BR', { timeZone: 'America/Recife' }) : '—'}
                  {ev.dados?.justificativa && <div className="contagem">Motivo: {ev.dados.justificativa}</div>}
                  {ev.dados?.correcao && <div className="contagem">Correção: {ev.dados.correcao}</div>}
                </li>
              ))}
            </ul>
          </>
        )}

        <h3>Conferência</h3>
        {podeLancar && nota.status !== 'lancada' ? (
          <div className="conferencia">
            <div className="opcoes-status">
              {STATUS_ESCOLHA.map(s => (
                <label key={s} className={`opcao${status === s ? ' marcada' : ''}`}>
                  <input type="radio" name="status" checked={status === s} onChange={() => setStatus(s)} />
                  <span>
                    <b>{NOME_STATUS[s]}</b>
                    <small>{EXPLICA_STATUS[s]}</small>
                  </span>
                </label>
              ))}
            </div>
            <label>
              <span className="contagem">Observação</span>
              <textarea rows={2} value={observacao} onChange={e => setObservacao(e.target.value)} placeholder="Ex.: faltaram 2 caixas; preço diferente do pedido…" />
            </label>
          </div>
        ) : (
          <p>
            <span className={`selo ${CLASSE_STATUS[nota.status]}`}>{NOME_STATUS[nota.status]}</span> {nota.observacao && <span>— {nota.observacao}</span>}
          </p>
        )}

        {aviso && <p className="ok">{aviso}</p>}
        {erro && <p className="erro">{erro}</p>}
        <div className="acoes">
          <span className="espaco" />
          <button onClick={fechar}>Fechar</button>
          {podeLancar && nota.status !== 'lancada' && (
            <button
              className="primario"
              disabled={!!ocupado || (status === nota.status && (observacao.trim() || null) === (nota.observacao ?? null))}
              onClick={salvarStatus}
            >
              {ocupado === 'status' ? 'Salvando…' : 'Salvar conferência'}
            </button>
          )}
        </div>
      </div>
      {lancando && paraLancar && (
        <div onClick={e => e.stopPropagation()}>
          <LancarNota
            nota={paraLancar}
            aoFechar={gravou => {
              setLancando(false)
              if (gravou) {
                setAviso('Nota lançada no contas a pagar.')
                setAlterou(true)
                carregar()
              }
            }}
          />
        </div>
      )}
    </div>
  )
}
