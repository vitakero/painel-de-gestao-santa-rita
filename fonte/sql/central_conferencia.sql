-- ============================================================
-- CENTRAL LOGÍSTICA — CONFERÊNCIA DOS CARROS
--
-- Espelho de leitura do que a equipe JÁ FAZ no VR: o conferente abre a
-- senha da nota, bipa a mercadoria e transmite; a entrada de nota confronta
-- e finaliza. Nada muda na rotina de ninguém.
--
-- Uma linha = uma CONFERÊNCIA (uma senha de coletor), não uma nota.
-- Um mesmo caminhão costuma gerar várias notas; aqui ele aparece uma vez.
--
-- O painel SÓ LÊ esta tabela. Quem preenche é o robô da loja
-- (scripts/vr-sync-conferencia.cjs), que lê o VR somente-leitura.
-- NADA aqui volta para o VR.
--
-- Rode este SQL uma vez no Supabase (SQL Editor).
-- ============================================================

create table if not exists public.central_conferencias (
  id             text primary key,  -- senha|loja|data — estável entre as sincronizações
  senha          text,              -- a senha da nota que o conferente abre no coletor
  loja           text,
  data           text,              -- data local da conferência (YYYY-MM-DD)
  fornecedor     text,
  inicio         text,              -- HH:MM da primeira bipagem (= quando abriu a senha)
  fim            text,              -- HH:MM da última bipagem
  minutos        int,               -- NULL quando o coletor transmitiu tudo de uma vez
                                    -- (aí não dá para saber a duração — a tela mostra "—")
  bipagens       int,
  itens          numeric,
  notas          int,               -- quantas notas essa conferência gerou
  notas_finalizadas int,            -- quantas já foram fechadas pela entrada de nota
  divergencias   int,               -- só a CONTAGEM; a lista de produtos fica no VR
  situacao       text,              -- conferindo | aguardando | finalizado
  atualizado_em  timestamptz default now()
);

-- Garante as colunas caso a tabela já exista:
alter table public.central_conferencias add column if not exists senha text;
alter table public.central_conferencias add column if not exists loja text;
alter table public.central_conferencias add column if not exists data text;
alter table public.central_conferencias add column if not exists fornecedor text;
alter table public.central_conferencias add column if not exists inicio text;
alter table public.central_conferencias add column if not exists fim text;
alter table public.central_conferencias add column if not exists minutos int;
alter table public.central_conferencias add column if not exists bipagens int;
alter table public.central_conferencias add column if not exists itens numeric;
alter table public.central_conferencias add column if not exists notas int;
alter table public.central_conferencias add column if not exists notas_finalizadas int;
alter table public.central_conferencias add column if not exists divergencias int;
alter table public.central_conferencias add column if not exists situacao text;

create index if not exists idx_cconf_data on public.central_conferencias (data desc);

alter table public.central_conferencias enable row level security;

-- Quem está logado no painel pode LER. A ESCRITA é só do robô (service role).
drop policy if exists cconf_read on public.central_conferencias;
create policy cconf_read on public.central_conferencias
  for select
  using (auth.role() = 'authenticated');

-- Sincronização em tempo real entre os aparelhos.
do $$ begin
  alter publication supabase_realtime add table public.central_conferencias;
exception when duplicate_object then null;
end $$;

-- ------------------------------------------------------------
-- CONFERÊNCIA
-- ------------------------------------------------------------
select
  case when exists (select 1 from information_schema.tables
                     where table_schema='public' and table_name='central_conferencias')
       then '✅' else '❌' end || ' tabela central_conferencias criada'      as item_1,
  case when exists (select 1 from pg_policies
                     where tablename='central_conferencias' and policyname='cconf_read')
       then '✅' else '❌' end || ' quem está logado consegue ler'           as item_2,
  (select count(*)::text from public.central_conferencias)
       || ' conferência(s) na tabela (0 até o robô rodar)'                   as item_3;
