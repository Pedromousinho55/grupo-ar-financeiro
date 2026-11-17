-- O coletor grava os metadados do certificado com upsert (INSERT ... ON CONFLICT DO UPDATE).
-- No Postgres, esse comando também exige uma política de SELECT na tabela; sem ela dá
-- "new row violates row-level security policy for table certificados".
-- O coletor passa a ler apenas os metadados (titular, CNPJ, validade) — arquivo e senha nunca vêm para cá.
create policy certificados_coletor_ler on public.certificados
  for select to authenticated using (public.e_coletor());
