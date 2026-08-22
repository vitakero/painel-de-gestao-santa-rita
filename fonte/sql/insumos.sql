-- ============================================================
-- CADASTRO DE INSUMOS — fonte única dos produtos usados na produção.
-- As receitas guardam só a referência (insumoId) + quantidade; nome, preço e
-- unidade vêm daqui. Mudou o preço aqui, todas as receitas se atualizam.
-- Mesmo padrão das outras tabelas do painel (1 linha por item, dados em jsonb).
-- Rode este SQL UMA vez no Supabase (SQL Editor).
-- ============================================================
create table if not exists public.insumos (
  id            text primary key,
  dados         jsonb not null,
  ordem         int,
  atualizado_em timestamptz default now()
);
alter table public.insumos enable row level security;

-- Quem entrou no painel pode ler/gravar (mesma regra de Material de uso e Receitas).
drop policy if exists insumos_all on public.insumos;
create policy insumos_all on public.insumos
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

do $$ begin
  alter publication supabase_realtime add table public.insumos;
exception when duplicate_object then null; end $$;
