import { useEffect, useState } from 'react'
import { supabase } from '../supabase'

interface Evento {
  id: number
  quando: string
  usuario_nome: string | null
  tabela: string
  registro_id: string | null
  acao: 'INSERT' | 'UPDATE' | 'DELETE'
  antes: Record<string, unknown> | null
  depois: Record<string, unknown> | null
}

const NOME_TABELA: Record<string, string> = {
  lojas: 'Loja',
  fornecedores: 'Fornecedor',
  plano_contas: 'Plano de contas',
  grupos_dre: 'Grupo do plano',
  centros_custo: 'Centro de custo',
  contas_bancarias: 'Conta bancária',
  formas_pagamento: 'Forma de pagamento',
  certificados: 'Certificado',
  perfis: 'Usuário',
}
const NOME_ACAO = { INSERT: 'incluiu', UPDATE: 'alterou', DELETE: 'apagou' }
const IGNORAR = new Set(['id', 'criado_em', 'atualizado_em'])

function resumo(e: Evento): string {
  const r = e.depois ?? e.antes ?? {}
  return String(r.razao_social ?? r.nome ?? r.apelido ?? r.descricao ?? r.titular ?? '')
}

function mudancas(e: Evento): string[] {
  if (e.acao !== 'UPDATE' || !e.antes || !e.depois) return []
  return Object.keys(e.depois)
    .filter(k => !IGNORAR.has(k) && JSON.stringify(e.antes![k]) !== JSON.stringify(e.depois![k]))
    .map(k => `${k}: ${fmt(e.antes![k])} → ${fmt(e.depois![k])}`)
}
const fmt = (v: unknown) => (v === null || v === undefined || v === '' ? '(vazio)' : String(v))

export default function Historico() {
  const [eventos, setEventos] = useState<Evento[]>([])
  const [tabela, setTabela] = useState('')
  const [limite, setLimite] = useState(100)

  useEffect(() => {
    let q = supabase.from('historico').select('*').order('id', { ascending: false }).limit(limite)
    if (tabela) q = q.eq('tabela', tabela)
    q.then(({ data }) => setEventos((data ?? []) as Evento[]))
  }, [tabela, limite])

  return (
    <section>
      <header className="titulo-pagina">
        <h1>Histórico</h1>
      </header>
      <p className="explicacao">Tudo o que foi incluído, alterado ou apagado, com quem fez e quando. Ninguém consegue apagar este histórico.</p>
      <div className="barra-filtros">
        <select value={tabela} onChange={e => setTabela(e.target.value)} aria-label="Filtrar por cadastro">
          <option value="">Todos os cadastros</option>
          {Object.entries(NOME_TABELA).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <div className="tabela-rolagem">
        <table>
          <thead>
            <tr>
              <th>Quando</th>
              <th>Quem</th>
              <th>O quê</th>
              <th>Detalhe</th>
            </tr>
          </thead>
          <tbody>
            {eventos.map(e => (
              <tr key={e.id}>
                <td className="nowrap">{new Date(e.quando).toLocaleString('pt-BR')}</td>
                <td>{e.usuario_nome ?? 'sistema'}</td>
                <td>
                  {NOME_ACAO[e.acao]} {NOME_TABELA[e.tabela] ?? e.tabela}
                </td>
                <td>
                  <b>{resumo(e)}</b>
                  {mudancas(e).map(m => (
                    <div key={m} className="mudanca">
                      {m}
                    </div>
                  ))}
                </td>
              </tr>
            ))}
            {eventos.length === 0 && (
              <tr>
                <td colSpan={4} className="vazio">
                  Nada registrado ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {eventos.length === limite && (
        <button onClick={() => setLimite(l => l + 100)} className="mais">
          Carregar mais
        </button>
      )}
    </section>
  )
}
