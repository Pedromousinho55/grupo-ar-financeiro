import { createClient } from '@supabase/supabase-js'
import { SUPABASE_KEY, SUPABASE_URL } from './config'

// Antes de o cliente ler (e limpar) o endereço, guardamos se o usuário chegou por
// um link de convite ou de "esqueci minha senha", para mandá-lo definir a senha.
const hash = window.location.hash
export const CHEGOU_PARA_DEFINIR_SENHA = /type=(invite|recovery)/.test(hash)

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
})

/** Traduz erros do banco para mensagens que fazem sentido para quem usa. */
export function mensagemErro(e: { code?: string; message?: string } | null | undefined): string {
  if (!e) return ''
  switch (e.code) {
    case '42501':
      return 'Você não tem permissão para esta ação.'
    case '23505':
      return 'Já existe um cadastro com esse dado (CNPJ, código ou nome repetido).'
    case '23514':
      return 'Dado inválido: confira CNPJ/CPF e os campos preenchidos.'
    case '23503':
      return 'Este registro está em uso por outro cadastro e não pode ser apagado.'
    case 'PGRST116':
      return 'Registro não encontrado ou sem permissão para alterar.'
  }
  if (e.message?.includes('Invalid login credentials')) return 'E-mail ou senha incorretos.'
  return e.message ?? 'Erro desconhecido'
}
