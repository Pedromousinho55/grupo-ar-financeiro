-- Papel técnico do programa coletor (roda no PC do escritório, conversa com a SEFAZ).
-- Separado da migração seguinte porque um valor novo de enum só pode ser usado após o commit.
alter type public.papel_usuario add value if not exists 'coletor';
