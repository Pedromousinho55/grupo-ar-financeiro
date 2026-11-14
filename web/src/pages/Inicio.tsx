import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth'
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
  const [alertas, setAlertas] = useState<Alerta[]>([])

  useEffect(() => {
    for (const [t] of TABELAS)
      supabase
        .from(t)
        .select('*', { count: 'exact', head: true })
        .then(({ count }) => setContagens(c => ({ ...c, [t]: count ?? 0 })))
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

      <div className="cartoes">
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
                  <span className="selo neutro">Aguardando o coletor (Etapa 2b)</span>
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
        Aqui vão aparecer: contas que vencem hoje/semana/mês, notas na SEFAZ sem lançamento e pendências de conferência.
      </p>
    </section>
  )
}
