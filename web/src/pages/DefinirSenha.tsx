import { useState, type FormEvent } from 'react'
import { mensagemErro, supabase } from '../supabase'

export default function DefinirSenha({ aoConcluir }: { aoConcluir: () => void }) {
  const [senha, setSenha] = useState('')
  const [repetir, setRepetir] = useState('')
  const [erro, setErro] = useState('')

  async function salvar(e: FormEvent) {
    e.preventDefault()
    if (senha.length < 10) return setErro('Use pelo menos 10 caracteres.')
    if (senha !== repetir) return setErro('As duas senhas não são iguais.')
    const { error } = await supabase.auth.updateUser({ password: senha })
    if (error) return setErro(mensagemErro(error))
    aoConcluir()
  }

  return (
    <div className="tela-login">
      <form onSubmit={salvar} className="cartao-login">
        <h1>Criar sua senha</h1>
        <p className="sub">Mínimo de 10 caracteres. Dica: uma frase curta é fácil de lembrar e difícil de adivinhar.</p>
        <label>
          <span>Nova senha</span>
          <input type="password" autoComplete="new-password" value={senha} onChange={e => setSenha(e.target.value)} required />
        </label>
        <label>
          <span>Repita a senha</span>
          <input type="password" autoComplete="new-password" value={repetir} onChange={e => setRepetir(e.target.value)} required />
        </label>
        {erro && <p className="erro">{erro}</p>}
        <button className="primario">Salvar senha</button>
      </form>
    </div>
  )
}
