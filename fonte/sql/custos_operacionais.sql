-- ============================================================
-- Catálogo de CUSTOS OPERACIONAIS (mão de obra, energia, gás, limpeza…)
-- Cadastra-se uma vez e reaproveita em qualquer receita (ficha técnica).
-- Mesmo padrão das outras tabelas do painel: 1 linha por item, dados em jsonb.
-- Rode este SQL UMA vez no Supabase (SQL Editor).
-- ============================================================
create table if not exists public.custos_operacionais (
  id            text primary key,
  dados         jsonb not null,
  ordem         int,
  atualizado_em timestamptz default now()
);
alter table public.custos_operacionais enable row level security;

-- Quem entrou no painel pode ler/gravar (mesma regra do Material de uso e das Receitas).
drop policy if exists custos_operacionais_all on public.custos_operacionais;
create policy custos_operacionais_all on public.custos_operacionais
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

do $$ begin
  alter publication supabase_realtime add table public.custos_operacionais;
exception when duplicate_object then null; end $$;
