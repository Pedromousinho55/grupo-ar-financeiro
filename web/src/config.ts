// Endereço e chave PÚBLICA do Supabase. A chave pública pode ficar no código:
// quem protege os dados são as regras de segurança por linha (RLS) do banco.
// Para apontar para produção, defina VITE_SUPABASE_URL e VITE_SUPABASE_KEY no Vercel.
export const SUPABASE_URL: string =
  import.meta.env.VITE_SUPABASE_URL ?? 'https://ijcglclttkhzygpecour.supabase.co'
export const SUPABASE_KEY: string =
  import.meta.env.VITE_SUPABASE_KEY ?? 'sb_publishable_rQjhRwlP-JDslj8UsZFtdg_BcYYCQgr'
export const AMBIENTE: string = SUPABASE_URL.includes('ijcglclttkhzygpecour') ? 'TESTE' : 'PRODUÇÃO'
