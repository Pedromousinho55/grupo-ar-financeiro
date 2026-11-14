import type { Session } from '@supabase/supabase-js'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from './supabase'

export type Papel = 'master' | 'lancador' | 'consulta'
export interface Perfil {
  id: string
  nome: string
  email: string | null
  papel: Papel
  ativo: boolean
}

interface Estado {
  carregando: boolean
  sessao: Session | null
  perfil: Perfil | null
  podeLancar: boolean
  eMaster: boolean
  sair: () => Promise<void>
}

const Ctx = createContext<Estado | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [sessao, setSessao] = useState<Session | null>(null)
  const [perfil, setPerfil] = useState<Perfil | null>(null)
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSessao(data.session)
      if (!data.session) setCarregando(false)
    })
    const { data } = supabase.auth.onAuthStateChange((_ev, s) => setSessao(s))
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!sessao) {
      setPerfil(null)
      return
    }
    setCarregando(true)
    supabase
      .from('perfis')
      .select('*')
      .eq('id', sessao.user.id)
      .maybeSingle()
      .then(({ data }) => {
        setPerfil((data as Perfil) ?? null)
        setCarregando(false)
      })
  }, [sessao])

  const ativo = perfil?.ativo ?? false
  const valor: Estado = {
    carregando,
    sessao,
    perfil,
    podeLancar: ativo && (perfil?.papel === 'master' || perfil?.papel === 'lancador'),
    eMaster: ativo && perfil?.papel === 'master',
    sair: async () => {
      await supabase.auth.signOut()
    },
  }
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>
}

export function useAuth() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useAuth fora do AuthProvider')
  return c
}

export const NOME_PAPEL: Record<Papel, string> = {
  master: 'Master (lança, aprova e administra)',
  lancador: 'Lançador (lança e consulta)',
  consulta: 'Só consulta',
}
