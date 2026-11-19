// Envio manual de XML de NF-e (ex.: recebido por e-mail do fornecedor).
// Mesmo fluxo da importação de planilha: escolhe arquivos → confere → grava.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth'
import { caminhoXml, conferirArquivos, type ArquivoConferido, type SituacaoEnvio } from '../lib/nfe'
import { dataBr, dinheiro } from '../lib/notas'
import { mensagemErro, supabase } from '../supabase'

const NOME_SITUACAO: Record<SituacaoEnvio, [string, string]> = {
  nova: ['Nova', 'ok'],
  completar: ['Completar resumo', 'ok'],
  ja_existe: ['Já existe', 'neutro'],
  outra_empresa: ['Outra empresa', 'erro'],
  repetida: ['Repetida', 'neutro'],
  erro: ['Erro', 'erro'],
}

export default function EnviarXml() {
  const { podeLancar } = useAuth()
  const [lojas, setLojas] = useState<Map<string, string>>(new Map()) // cnpj -> apelido
  const [conferidos, setConferidos] = useState<ArquivoConferido[]>([])
  const [lendo, setLendo] = useState(false)
  const [gravando, setGravando] = useState(false)
  const [resultado, setResultado] = useState<{ ok: number; falhas: string[] } | null>(null)
  const [erro, setErro] = useState('')

  useEffect(() => {
    supabase
      .from('lojas')
      .select('cnpj, apelido')
      .then(({ data }) => setLojas(new Map((data ?? []).map(l => [l.cnpj as string, l.apelido as string]))))
  }, [])

  async function escolher(lista: FileList | null) {
    if (!lista?.length) return
    setErro('')
    setResultado(null)
    setLendo(true)
    const arquivos = await Promise.all(
      Array.from(lista)
        .filter(f => f.name.toLowerCase().endsWith('.xml'))
        .map(async f => ({ nome: f.name, conteudo: await f.text() })),
    )
    if (arquivos.length === 0) {
      setLendo(false)
      return setErro('Nenhum arquivo .xml na seleção. (Arquivos .zip: extraia antes, ou peça a importação pelo coletor.)')
    }
    // descobre quais chaves já estão no banco (em blocos, para não estourar o endereço)
    const previa = conferirArquivos(arquivos, new Set(lojas.keys()), new Map())
    const chaves = [...new Set(previa.flatMap(p => (p.nota ? [p.nota.chave] : [])))]
    const existentes = new Map<string, string>()
    for (let i = 0; i < chaves.length; i += 100) {
      const { data, error } = await supabase.from('notas_fiscais').select('chave, tipo_documento').in('chave', chaves.slice(i, i + 100))
      if (error) {
        setLendo(false)
        return setErro(mensagemErro(error))
      }
      for (const r of data ?? []) existentes.set(r.chave as string, r.tipo_documento as string)
    }
    setConferidos(conferirArquivos(arquivos, new Set(lojas.keys()), existentes))
    setLendo(false)
  }

  const aGravar = conferidos.filter(c => c.situacao === 'nova' || c.situacao === 'completar')

  async function gravar() {
    setGravando(true)
    setErro('')
    let ok = 0
    const falhas: string[] = []
    for (const c of aGravar) {
      const n = c.nota!
      const caminho = caminhoXml(c.lojaCnpj!, n.data_emissao, n.chave)
      const up = await supabase.storage
        .from('notas-xml')
        .upload(caminho, new Blob([c.conteudo!], { type: 'application/xml' }), { contentType: 'application/xml', upsert: false })
      // o arquivo pode já estar lá (o coletor guardou antes): segue, não é erro
      if (up.error && !/exist|duplicate/i.test(up.error.message)) {
        falhas.push(`${c.nome}: falha ao guardar o arquivo (${up.error.message})`)
        continue
      }
      const registro = {
        destinatario_cnpj: n.destinatario_cnpj,
        emitente_cnpj: n.emitente_cnpj,
        emitente_nome: n.emitente_nome,
        emitente_ie: n.emitente_ie,
        numero: n.numero,
        serie: n.serie,
        data_emissao: n.data_emissao,
        valor_total: n.valor_total,
        tipo_documento: n.tipo_documento,
        situacao_sefaz: n.situacao_sefaz,
        duplicatas: n.duplicatas,
        dados: n.dados,
        xml_arquivo: caminho,
        origem: 'upload',
      }
      const { error } =
        c.situacao === 'nova'
          ? await supabase.from('notas_fiscais').insert({ chave: n.chave, ...registro })
          : // resumo vira nota completa; status e conferência já feitos não mudam
            await supabase.from('notas_fiscais').update(registro).eq('chave', n.chave)
      if (error) falhas.push(`${c.nome}: ${mensagemErro(error)}`)
      else ok++
    }
    setGravando(false)
    setResultado({ ok, falhas })
    setConferidos([])
  }

  if (!podeLancar)
    return (
      <section>
        <h1>Enviar XML</h1>
        <p className="erro">Seu usuário só pode consultar. Peça ao Pedro para enviar o XML.</p>
      </section>
    )

  return (
    <section>
      <header className="titulo-pagina">
        <h1>Enviar XML de nota fiscal</h1>
        <Link to="/notas">← Voltar às notas</Link>
      </header>
      <p className="explicacao">
        Para notas que chegaram por e-mail ou que ainda estão só como "resumo". Pode escolher vários arquivos .xml de uma vez. Nada é gravado
        antes da conferência. Notas de outras empresas e repetidas são ignoradas.
      </p>

      <label className="botao primario seletor-arquivo">
        {lendo ? 'Lendo arquivos…' : 'Escolher arquivos XML'}
        <input
          type="file"
          accept=".xml,text/xml,application/xml"
          multiple
          hidden
          disabled={lendo || gravando}
          onChange={e => {
            escolher(e.target.files)
            e.target.value = ''
          }}
        />
      </label>

      {erro && <p className="erro">{erro}</p>}
      {resultado && (
        <p className={resultado.falhas.length ? 'aviso' : 'ok'}>
          {resultado.ok} nota(s) gravada(s) no cofre.
          {resultado.falhas.map(f => (
            <span key={f}>
              <br />✗ {f}
            </span>
          ))}
          {resultado.ok > 0 && (
            <>
              {' '}
              <Link to="/notas">Ver notas</Link>
            </>
          )}
        </p>
      )}

      {conferidos.length > 0 && (
        <>
          <h2>Conferência</h2>
          <div className="tabela-rolagem alta">
            <table>
              <thead>
                <tr>
                  <th>Arquivo</th>
                  <th>Situação</th>
                  <th>Loja</th>
                  <th>Fornecedor</th>
                  <th>Nº</th>
                  <th>Emissão</th>
                  <th className="num">Valor</th>
                </tr>
              </thead>
              <tbody>
                {conferidos.map((c, i) => (
                  <tr key={i} className={c.situacao === 'erro' || c.situacao === 'outra_empresa' ? 'sit-erro' : ''}>
                    <td className="arquivo">{c.nome}</td>
                    <td>
                      <span className={`selo ${NOME_SITUACAO[c.situacao][1]}`}>{NOME_SITUACAO[c.situacao][0]}</span>
                      <div className="mudanca">{c.mensagem}</div>
                    </td>
                    <td>{c.nota?.destinatario_cnpj ? (lojas.get(c.nota.destinatario_cnpj) ?? '—') : '—'}</td>
                    <td>{c.nota?.emitente_nome ?? '—'}</td>
                    <td>{c.nota?.numero ?? '—'}</td>
                    <td className="nowrap">{dataBr(c.nota?.data_emissao)}</td>
                    <td className="num nowrap">{dinheiro(c.nota?.valor_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="rodape-importacao">
            <span>
              <b>{aGravar.length}</b> de {conferidos.length} arquivo(s) serão gravados.
            </span>
            <span>
              <button onClick={() => setConferidos([])} disabled={gravando}>
                Cancelar
              </button>{' '}
              <button className="primario" disabled={gravando || aGravar.length === 0} onClick={gravar}>
                {gravando ? 'Gravando…' : `Gravar ${aGravar.length} nota(s)`}
              </button>
            </span>
          </div>
        </>
      )}
    </section>
  )
}
