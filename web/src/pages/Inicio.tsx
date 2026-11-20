import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth'
import { hojeRecife, somaDias } from '../lib/contas'
import { dinheiro } from '../lib/notas'
import { supabase } from '../supabase'

interface Alerta {
  apelido: string
  valido_ate: string | null
  dias_restantes: number | null
  situacao: string
}

const TABELAS = [
  ['lojas', 'Lojas', '/lojas'],
  ['fornecedores', 'Fornecedores', '/fornecedores'],
  ['plano_contas', 'Contas no plano', '/plano-contas'],
  ['centros_custo', 'Centros de custo', '/centros-custo'],
  ['contas_bancarias', 'Contas bancárias', '/contas-bancarias'],
] as const

export default function Inicio() {
  const { perfil } = useAuth()
  const [contagens, setContagens] = useState<Record<string, number>>({})
  const [aConferir, setAConferir] = useState<number | null>(null)
  const [aConciliar, setAConciliar] = useState<number | null>(null)
  const [alertas, setAlertas] = useState<Alerta[]>([])
  const [contas, setContas] = useState<{ vencidas: number[]; hoje: number[]; semana: number[]; aAprovar: number[] } | null>(null)

  useEffect(() => {
    for (const [t] of TABELAS)
      supabase
        .from(t)
        .select('*', { count: 'exact', head: true })
        .then(({ count }) => setContagens(c => ({ ...c, [t]: count ?? 0 })))
    supabase
      .from('notas_fiscais')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'na_sefaz')
      .eq('situacao_sefaz', 'autorizada')
      .then(({ count }) => setAConferir(count ?? 0))
    supabase
      .from('extrato_lancamentos')
      .select('*', { count: 'exact', head: true })
      .eq('conciliado', false)
      .then(({ count }) => setAConciliar(count ?? 0))
    const hoje = hojeRecife()
    supabase
      .from('contas_pagar')
      .select('valor, vencimento, status')
      .in('status', ['a_aprovar', 'aprovada'])
      .lte('vencimento', somaDias(hoje, 6))
      .limit(20000)
      .then(({ data }) => {
        const l = (data ?? []) as { valor: number; vencimento: string; status: string }[]
        setContas(c => ({
          vencidas: l.filter(x => x.vencimento < hoje).map(x => Number(x.valor)),
          hoje: l.filter(x => x.vencimento === hoje).map(x => Number(x.valor)),
          semana: l.filter(x => x.vencimento >= hoje).map(x => Number(x.valor)),
          aAprovar: c?.aAprovar ?? [],
        }))
      })
    supabase
      .from('contas_pagar')
      .select('valor')
      .eq('status', 'a_aprovar')
      .limit(20000)
      .then(({ data }) => setContas(c => ({ vencidas: [], hoje: [], semana: [], ...c, aAprovar: (data ?? []).map(x => Number(x.valor)) })))
    supabase
      .from('alertas_certificados')
      .select('*')
      .order('apelido')
      .then(({ data }) => setAlertas((data ?? []) as Alerta[]))
  }, [])

  const certPendentes = alertas.filter(a => a.situacao !== 'OK')

  return (
    <section>
      <header className="titulo-pagina">
        <h1>Olá, {perfil?.nome?.split(' ')[0]}</h1>
      </header>

      <h2>Contas a pagar</h2>
      <div className="cartoes">
        {(
          [
            ['vencidas', 'Vencidas', 'vencidas'],
            ['hoje', 'Vencem hoje', 'hoje'],
            ['semana', 'Próximos 7 dias', 'semana'],
            ['aAprovar', 'A aprovar', 'a_aprovar'],
          ] as const
        ).map(([k, rotulo, atalho]) => {
          const v = contas?.[k] ?? []
          return (
            <Link key={k} to={`/contas?atalho=${atalho}`} className={`cartao-num${k === 'vencidas' && v.length > 0 ? ' alerta' : ''}`}>
              <b>{contas === null ? '…' : v.length}</b>
              <span>{rotulo}</span>
              {v.length > 0 && <small>{dinheiro(v.reduce((a, b) => a + b, 0))}</small>}
            </Link>
          )
        })}
      </div>

      <h2>Cadastros e notas</h2>
      <div className="cartoes">
        <Link to="/conciliacao" className="cartao-num">
          <b>{aConciliar === null ? '…' : aConciliar.toLocaleString('pt-BR')}</b>
          <span>Extrato a conciliar</span>
        </Link>
        <Link to="/notas" className="cartao-num">
          <b>{aConferir === null ? '…' : aConferir.toLocaleString('pt-BR')}</b>
          <span>Notas a conferir</span>
        </Link>
        {TABELAS.map(([t, rotulo, rota]) => (
          <Link key={t} to={rota} className="cartao-num">
            <b>{contagens[t] ?? '…'}</b>
            <span>{rotulo}</span>
          </Link>
        ))}
      </div>

      <h2>Certificados digitais A1</h2>
      {certPendentes.length === 0 && alertas.length > 0 && <p className="ok">Todos os certificados estão em dia.</p>}
      <table>
        <thead>
          <tr>
            <th>Loja</th>
            <th>Válido até</th>
            <th>Situação</th>
          </tr>
        </thead>
        <tbody>
          {alertas.map(a => (
            <tr key={a.apelido}>
              <td>{a.apelido}</td>
              <td>{a.valido_ate ? new Date(a.valido_ate + 'T12:00:00').toLocaleDateString('pt-BR') : '—'}</td>
              <td>
                {a.valido_ate === null ? (
                  <span className="selo neutro">Sem certificado no sistema</span>
                ) : a.situacao === 'OK' ? (
                  <span className="selo ok">OK · {a.dias_restantes} dias</span>
                ) : (
                  <span className="selo erro">
                    {a.situacao === 'VENCIDO' ? 'VENCIDO' : `Renovar · faltam ${a.dias_restantes} dias`}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Próximas etapas</h2>
      <p className="explicacao">
        Aqui vão aparecer: saldos bancários e conciliação (Etapa 4), fluxo de caixa e DRE (Etapa 5).
      </p>
    </section>
  )
}
