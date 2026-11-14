-- Ajustes apontados pelo verificador de segurança do Supabase
-- 1) "Rota fixa" (search_path) nas funções, para não poderem ser enganadas por objetos com o mesmo nome
alter function public.so_digitos(text)        set search_path = public;
alter function public.cnpj_valido(text)       set search_path = public;
alter function public.cpf_valido(text)        set search_path = public;
alter function public.chave_nfe_valida(text)  set search_path = public;
alter function public.pode_ler()              set search_path = public;
alter function public.pode_lancar()           set search_path = public;
alter function public.pode_aprovar()          set search_path = public;
alter function public.e_master()              set search_path = public;
alter function public.proteger_papel()        set search_path = public;

-- 2) Funções de gatilho não podem ser chamadas diretamente pelo site (só pelo próprio banco)
revoke execute on function public.criar_perfil_novo_usuario() from public, anon, authenticated;
revoke execute on function public.registrar_historico()       from public, anon, authenticated;
revoke execute on function public.proteger_papel()            from public, anon, authenticated;

-- 3) Visitante sem login não consulta papel de ninguém
revoke execute on function public.meu_papel() from public, anon;
grant  execute on function public.meu_papel() to authenticated;

-- 4) Tabela interna de controle de versões do banco: sem acesso pelo site (intencional)
comment on table public._migracoes is 'Controle interno de migrações. Sem acesso pelo site (intencional).';
