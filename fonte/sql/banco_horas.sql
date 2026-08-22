-- Banco de Horas (Centro de Inteligência da Jornada) — espelho do Extrato por Período do Control iD/RHiD.
-- Rode isto UMA vez no Supabase (SQL Editor) quando quiser sincronizar entre aparelhos.
-- Enquanto não rodar, o módulo funciona local no navegador (a importação já vale na máquina).

create table if not exists public.banco_horas (
  pis            text primary key,
  nome           text not null default '',
  cargo          text default '',
  setor          text default '',
  saldo_min      integer default 0,   -- Saldo Banco (acumulado), em minutos com sinal
  pos_min        integer default 0,   -- Banco Positivo, em minutos
  neg_min        integer default 0,   -- Banco Negativo, em minutos (negativo)
  dia_min        integer default 0,   -- Saldo do Dia, em minutos
  ref            text default '',      -- data da última importação (dd/mm/aaaa)
  atualizado_em  timestamptz default now()
);

-- Dado sensível de RH: só o master enxerga/edita (mesma política dos pontos extras).
alter table public.banco_horas enable row level security;

drop policy if exists "banco_horas master" on public.banco_horas;
create policy "banco_horas master" on public.banco_horas
  for all
  using (
    exists (select 1 from public.perfis p where p.id = auth.uid() and p.is_master = true)
  )
  with check (
    exists (select 1 from public.perfis p where p.id = auth.uid() and p.is_master = true)
  );

-- Realtime (pra atualizar sozinho quando o DP importa em outro aparelho)
alter publication supabase_realtime add table public.banco_horas;
