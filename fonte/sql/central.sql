-- ============================================================
-- CENTRAL LOGÍSTICA — espelho de leitura dos agendamentos do VR.
-- O painel SÓ LÊ esta tabela. Quem PREENCHE é o robô da loja, que lê
-- o VR (PostgreSQL, somente leitura) e faz upsert aqui pela chave vr_id.
-- Nada aqui grava de volta no VR. Fase 1 = só leitura/visualização.
-- Rode este SQL uma vez no Supabase (SQL Editor).
-- ============================================================

create table if not exists public.central_agendamentos (
  id            text primary key,   -- mesmo valor do vr_id (chave do agendamento no VR)
  vr_id         text,               -- identificador oficial do agendamento no VR
  loja          text,
  data          text,               -- data do recebimento (YYYY-MM-DD)
  hi            text,               -- hora inicial (HH:MM)
  hf            text,               -- hora final (HH:MM)
  fornecedor    text,
  situacao      text,               -- situação oficial do VR (programado/concluido/cancelado...) — pode vir vazio
  pedido        text,               -- pedido/referência, se houver
  atualizado_em timestamptz default now()
);

-- Garante as colunas caso a tabela já exista:
alter table public.central_agendamentos add column if not exists vr_id text;
alter table public.central_agendamentos add column if not exists loja text;
alter table public.central_agendamentos add column if not exists data text;
alter table public.central_agendamentos add column if not exists hi text;
alter table public.central_agendamentos add column if not exists hf text;
alter table public.central_agendamentos add column if not exists fornecedor text;
alter table public.central_agendamentos add column if not exists situacao text;
alter table public.central_agendamentos add column if not exists pedido text;

alter table public.central_agendamentos enable row level security;

-- Qualquer usuário logado no painel pode LER (não é dado financeiro sensível).
-- A ESCRITA fica só com o robô (service role, que ignora o RLS).
drop policy if exists central_read on public.central_agendamentos;
create policy central_read on public.central_agendamentos
  for select
  using (auth.role() = 'authenticated');

-- Sincronização em tempo real entre os aparelhos (não dá erro se já estiver ligada).
do $$ begin
  alter publication supabase_realtime add table public.central_agendamentos;
exception when duplicate_object then null;
end $$;
