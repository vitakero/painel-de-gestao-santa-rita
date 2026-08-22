-- ============================================================
-- AGENDA (compromissos por dia) — Painel Santa Rita
--
-- Parte 1: agenda PESSOAL (cada um vê/gerencia a sua). A estrutura já nasce pronta
-- pra Parte 2 (equipe): o campo para_id diz "de quem é o compromisso" — hoje sempre
-- o próprio; depois o master poderá marcar para um funcionário.
--
-- Segue o padrão de nuvem do Painel (tabela direta + RLS, como galpoes/pontos), não os
-- RPCs da Central. tenant_id/criado_por/para_id são preenchidos por DEFAULT no servidor
-- (o navegador não os envia), então não dá pra forjar. current_tenant()/sou_master() já existem.
--
-- ADITIVO e IDEMPOTENTE. Uma transação. Rollback comentado no fim.
-- ============================================================

begin;

create table if not exists public.agenda_eventos (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null default public.current_tenant(),
  criado_por  uuid not null default auth.uid(),
  para_id     uuid not null default auth.uid(),   -- de quem é o compromisso (Parte 1 = o próprio)
  data        date not null,
  hora        time,                                 -- opcional (sem hora = "o dia todo")
  titulo      text not null,
  descricao   text,
  cor         text,                                 -- opcional (etiqueta colorida, uso futuro)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists ix_agenda_para_data on public.agenda_eventos(tenant_id, para_id, data);
create index if not exists ix_agenda_criador    on public.agenda_eventos(tenant_id, criado_por, data);

alter table public.agenda_eventos enable row level security;

-- LER: vejo os compromissos que são MEUS (para_id=eu), os que EU criei, e (master) todos.
drop policy if exists agenda_sel on public.agenda_eventos;
create policy agenda_sel on public.agenda_eventos for select to authenticated
  using ( tenant_id = public.current_tenant()
          and ( para_id = auth.uid() or criado_por = auth.uid() or public.sou_master() ) );

-- CRIAR: só como eu mesmo (criado_por=eu); para mim, ou para qualquer um se eu for master.
drop policy if exists agenda_ins on public.agenda_eventos;
create policy agenda_ins on public.agenda_eventos for insert to authenticated
  with check ( tenant_id = public.current_tenant()
               and criado_por = auth.uid()
               and ( para_id = auth.uid() or public.sou_master() ) );

-- EDITAR: o que eu criei, ou (master) qualquer um.
drop policy if exists agenda_upd on public.agenda_eventos;
create policy agenda_upd on public.agenda_eventos for update to authenticated
  using ( tenant_id = public.current_tenant() and ( criado_por = auth.uid() or public.sou_master() ) )
  -- resultado: só master pode deixar o compromisso "para" outra pessoa; funcionário comum só para si.
  with check ( tenant_id = public.current_tenant() and ( para_id = auth.uid() or public.sou_master() ) );

-- EXCLUIR: o que eu criei, ou (master) qualquer um.
drop policy if exists agenda_del on public.agenda_eventos;
create policy agenda_del on public.agenda_eventos for delete to authenticated
  using ( tenant_id = public.current_tenant() and ( criado_por = auth.uid() or public.sou_master() ) );

grant select, insert, update, delete on public.agenda_eventos to authenticated;

-- touch em updated_at
create or replace function public.agenda_touch() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
drop trigger if exists trg_agenda_touch on public.agenda_eventos;
create trigger trg_agenda_touch before update on public.agenda_eventos
  for each row execute function public.agenda_touch();

commit;

-- ============================================================
-- CONFERÊNCIA:
--   select * from public.agenda_eventos;   -- (vazio no começo; RLS mostra só os seus)
--
-- ROLLBACK (desfazer):
-- drop table if exists public.agenda_eventos;
-- drop function if exists public.agenda_touch();
-- ============================================================
