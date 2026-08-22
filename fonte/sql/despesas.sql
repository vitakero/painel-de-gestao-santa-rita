-- ============================================================
-- Módulo DESPESAS (por tipo de gasto).
-- O painel só LÊ o resumo (o robô da loja calcula do VR e grava aqui).
-- O teto (limite mensal) por categoria o dono define no painel.
-- Dado financeiro sensível: só o MASTER vê/edita (RLS), igual aos galpões.
-- Rode este SQL UMA vez no Supabase (SQL Editor).
-- ============================================================

-- Resumo mensal (1 linha por competência/mês). O robô grava; o painel lê.
create table if not exists public.despesas_resumo (
  competencia   date primary key,                    -- 1º dia do mês (ex.: 2026-06-01)
  total         numeric     not null default 0,       -- total gasto no mês
  qtd           integer     not null default 0,       -- nº de lançamentos
  categorias    jsonb       not null default '[]'::jsonb, -- [{cat, soma, qtd}]
  maiores       jsonb       not null default '[]'::jsonb, -- [{data, descricao, fornecedor, categoria, valor}]
  atualizado_em timestamptz not null default now()
);

-- Teto (limite mensal) por categoria — o dono define no painel.
create table if not exists public.despesas_teto (
  categoria      text primary key,
  valor          numeric     not null default 0,
  atualizado_em  timestamptz not null default now(),
  atualizado_por text
);

alter table public.despesas_resumo enable row level security;
alter table public.despesas_teto   enable row level security;

-- Só o master enxerga e mexe (mesma regra dos galpões / dados financeiros sensíveis).
-- OBS: o robô grava usando a SERVICE KEY, que ignora RLS — por isso não precisa de política pra ele.
drop policy if exists despesas_resumo_master on public.despesas_resumo;
create policy despesas_resumo_master on public.despesas_resumo
  for all
  using      (exists (select 1 from public.perfis p where p.id = auth.uid() and p.is_master = true))
  with check (exists (select 1 from public.perfis p where p.id = auth.uid() and p.is_master = true));

drop policy if exists despesas_teto_master on public.despesas_teto;
create policy despesas_teto_master on public.despesas_teto
  for all
  using      (exists (select 1 from public.perfis p where p.id = auth.uid() and p.is_master = true))
  with check (exists (select 1 from public.perfis p where p.id = auth.uid() and p.is_master = true));

-- Tempo real no teto (pra sincronizar os limites entre aparelhos). Não dá erro se já estiver ligado.
do $$ begin
  alter publication supabase_realtime add table public.despesas_teto;
exception when duplicate_object then null; end $$;
