import { useEffect, useState } from 'react'
import { NOME_PAPEL, useAuth, type Papel, type Perfil } from '../auth'
import { mensagemErro, supabase } from '../supabase'

export default function Usuarios() {
  const { eMaster, perfil: eu } = useAuth()
  const [perfis, setPerfis] = useState<Perfil[]>([])
  const [erro, setErro] = useState('')

  const carregar = () =>
    supabase
      .from('perfis')
      .select('*')
      .order('nome')
      .then(({ data }) => setPerfis((data ?? []) as Perfil[]))
  useEffect(() => {
    carregar()
  }, [])

  async function alterar(p: Perfil, mudanca: Partial<Perfil>) {
    setErro('')
    const { error } = await supabase.from('perfis').update(mudanca).eq('id', p.id)
    if (error) setErro(mensagemErro(error))
    carregar()
  }

  return (
    <section>
      <header className="titulo-pagina">
        <h1>Usuários</h1>
      </header>
      <p className="explicacao">
        Novos usuários são convidados por e-mail e entram como "Só consulta". Só o master muda permissões. (Convites pelo próprio sistema
        virão quando formos cadastrar a equipe.)
      </p>
      {erro && <p className="erro">{erro}</p>}
      <table>
        <thead>
          <tr>
            <th>Nome</th>
            <th>E-mail</th>
            <th>Permissão</th>
            <th>Ativo</th>
          </tr>
        </thead>
        <tbody>
          {perfis.map(p => (
            <tr key={p.id}>
              <td>{p.nome}</td>
              <td>{p.email}</td>
              <td>
                {eMaster && p.id !== eu?.id ? (
                  <select value={p.papel} onChange={e => alterar(p, { papel: e.target.value as Papel })}>
                    {Object.entries(NOME_PAPEL).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                ) : (
                  NOME_PAPEL[p.papel]
                )}
              </td>
              <td>
                {eMaster && p.id !== eu?.id ? (
                  <input type="checkbox" checked={p.ativo} onChange={e => alterar(p, { ativo: e.target.checked })} aria-label="Ativo" />
                ) : p.ativo ? (
                  'Sim'
                ) : (
                  'Não'
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
