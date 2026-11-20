import { useState } from 'react'
import { BrowserRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, NOME_PAPEL, useAuth } from './auth'
import Cadastro from './components/Cadastro'
import ContasPagar from './pages/ContasPagar'
import Bancos from './pages/Bancos'
import Conciliacao from './pages/Conciliacao'
import Regras from './pages/Regras'
import { AMBIENTE } from './config'
import * as C from './pages/cadastros'
import DefinirSenha from './pages/DefinirSenha'
import EnviarXml from './pages/EnviarXml'
import Historico from './pages/Historico'
import Importar from './pages/Importar'
import Inicio from './pages/Inicio'
import Login from './pages/Login'
import Notas from './pages/Notas'
import Usuarios from './pages/Usuarios'
import { CHEGOU_PARA_DEFINIR_SENHA } from './supabase'

const MENU: [string, string][] = [
  ['/', 'Início'],
  ['/notas', 'Notas fiscais'],
  ['/contas', 'Contas a pagar'],
  ['/bancos', 'Bancos'],
  ['/conciliacao', 'Conciliação'],
  ['/regras', 'Regras de conciliação'],
  ['/fornecedores', 'Fornecedores'],
  ['/plano-contas', 'Plano de contas'],
  ['/grupos-dre', 'Grupos do plano'],
  ['/centros-custo', 'Centros de custo'],
  ['/contas-bancarias', 'Contas bancárias'],
  ['/formas-pagamento', 'Formas de pagamento'],
  ['/lojas', 'Lojas'],
  ['/importar', 'Importar planilha'],
  ['/historico', 'Histórico'],
  ['/usuarios', 'Usuários'],
]

function Conteudo() {
  const { carregando, sessao, perfil, sair } = useAuth()
  const [definirSenha, setDefinirSenha] = useState(CHEGOU_PARA_DEFINIR_SENHA)
  const [menuAberto, setMenuAberto] = useState(false)

  if (carregando) return <p className="carregando">Carregando…</p>
  if (!sessao) return <Login />
  if (definirSenha) return <DefinirSenha aoConcluir={() => setDefinirSenha(false)} />
  if (!perfil || !perfil.ativo)
    return (
      <div className="tela-login">
        <div className="cartao-login">
          <p>Seu usuário ainda não foi liberado. Fale com o Pedro.</p>
          <button onClick={sair}>Sair</button>
        </div>
      </div>
    )

  return (
    <div className="app">
      {AMBIENTE === 'TESTE' && <div className="faixa-teste">AMBIENTE DE TESTE — dados de teste, pode mexer à vontade</div>}
      <aside className={menuAberto ? 'aberto' : ''}>
        <div className="marca">
          Grupo AR<small>Financeiro</small>
        </div>
        <nav onClick={() => setMenuAberto(false)}>
          {MENU.map(([rota, nome]) => (
            <NavLink key={rota} to={rota} end={rota === '/'}>
              {nome}
            </NavLink>
          ))}
        </nav>
        <div className="usuario">
          <b>{perfil.nome}</b>
          <small>{NOME_PAPEL[perfil.papel]}</small>
          <button className="link" onClick={sair}>
            Sair
          </button>
        </div>
      </aside>
      <button className="botao-menu" onClick={() => setMenuAberto(m => !m)} aria-label="Menu">
        ☰
      </button>
      <main>
        <Routes>
          <Route path="/" element={<Inicio />} />
          <Route path="/notas" element={<Notas />} />
          <Route path="/notas/enviar" element={<EnviarXml />} />
          <Route path="/contas" element={<ContasPagar />} />
          <Route path="/bancos" element={<Bancos />} />
          <Route path="/conciliacao" element={<Conciliacao />} />
          <Route path="/regras" element={<Regras />} />
          <Route path="/fornecedores" element={<Cadastro key="f" config={C.FORNECEDORES} />} />
          <Route path="/plano-contas" element={<Cadastro key="p" config={C.PLANO_CONTAS} />} />
          <Route path="/grupos-dre" element={<Cadastro key="g" config={C.GRUPOS_DRE} />} />
          <Route path="/centros-custo" element={<Cadastro key="c" config={C.CENTROS_CUSTO} />} />
          <Route path="/contas-bancarias" element={<Cadastro key="b" config={C.CONTAS_BANCARIAS} />} />
          <Route path="/formas-pagamento" element={<Cadastro key="fp" config={C.FORMAS_PAGAMENTO} />} />
          <Route path="/lojas" element={<Cadastro key="l" config={C.LOJAS} />} />
          <Route path="/importar" element={<Importar />} />
          <Route path="/historico" element={<Historico />} />
          <Route path="/usuarios" element={<Usuarios />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Conteudo />
      </BrowserRouter>
    </AuthProvider>
  )
}
