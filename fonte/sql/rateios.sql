-- ============================================================
-- RATEIO DE CUSTOS — despesas reais do setor viram custo por unidade produzida.
-- O resultado vai para o Cadastro de Custos Operacionais (nunca direto na receita).
-- Guarda o histórico completo (nenhum rateio é apagado quando outro é criado).
-- Rode este SQL UMA vez no Supabase (SQL Editor).
-- ============================================================
create table if not exists public.rateios (
  id            text primary key,
  dados         jsonb not null,
  ordem         int,
  atualizado_em timestamptz default now()
);
alter table public.rateios enable row level security;

drop policy if exists rateios_all on public.rateios;
create policy rateios_all on public.rateios
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

do $$ begin
  alter publication supabase_realtime add table public.rateios;
exception when duplicate_object then null; end $$;
