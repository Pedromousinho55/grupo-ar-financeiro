import { useState, type FormEvent } from 'react'
import { AMBIENTE } from '../config'
import { mensagemErro, supabase } from '../supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function entrar(e: FormEvent) {
    e.preventDefault()
    setErro('')
    setEnviando(true)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: senha })
    setEnviando(false)
    if (error) setErro(mensagemErro(error))
  }

  async function esqueci() {
    setErro('')
    if (!email.trim()) return setErro('Digite seu e-mail primeiro.')
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin })
    if (error) setErro(mensagemErro(error))
    else setAviso('Se o e-mail estiver cadastrado, chegará um link para criar nova senha.')
  }

  return (
    <div className="tela-login">
      <form onSubmit={entrar} className="cartao-login">
        <h1>Grupo AR</h1>
        <p className="sub">Sistema Financeiro {AMBIENTE === 'TESTE' && <b className="selo-teste">TESTE</b>}</p>
        <label>
          <span>E-mail</span>
          <input type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required />
        </label>
        <label>
          <span>Senha</span>
          <input type="password" autoComplete="current-password" value={senha} onChange={e => setSenha(e.target.value)} required />
        </label>
        {erro && <p className="erro">{erro}</p>}
        {aviso && <p className="ok">{aviso}</p>}
        <button className="primario" disabled={enviando}>
          {enviando ? 'Entrando…' : 'Entrar'}
        </button>
        <button type="button" className="link" onClick={esqueci}>
          Esqueci minha senha
        </button>
      </form>
    </div>
  )
}
