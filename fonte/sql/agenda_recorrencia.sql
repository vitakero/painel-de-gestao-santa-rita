-- ============================================================
-- AGENDA — RECORRÊNCIA + endurecimento de segurança (Painel Santa Rita)
--
-- Rode DEPOIS do sql/agenda.sql. Adiciona compromissos que se repetem
-- (toda semana, todo mês, dias úteis, etc.) e fecha uma brecha residual
-- de RLS apontada na auditoria. ADITIVO e IDEMPOTENTE. Uma transação.
-- ============================================================

begin;

-- 1) Recorrência: colunas novas (o app preenche; ficam nulas p/ "não repete").
alter table public.agenda_eventos add column if not exists repete     text;   -- null/'nao'=uma vez; 'dia','uteis','semana','quinzena','mes'
alter table public.agenda_eventos add column if not exists repete_ate date;   -- opcional: repete até essa data (null = sem fim)

-- integridade: só aceita os valores que o app usa
do $$ begin
  if not exists (select 1 from pg_constraint where conname='agenda_repete_chk') then
    alter table public.agenda_eventos
      add constraint agenda_repete_chk
      check (repete is null or repete in ('nao','dia','uteis','semana','quinzena','mes'));
  end if;
end $$;

-- 2) Endurecimento RLS (auditoria): o vínculo por "criado_por" deixava um EX-master
--    continuar lendo/excluindo compromissos que ele havia posto na agenda de terceiros.
--    Trocamos por "para_id OR master". Para o uso pessoal (Parte 1) NADA muda: para_id = você.
drop policy if exists agenda_sel on public.agenda_eventos;
create policy agenda_sel on public.agenda_eventos for select to authenticated
  using ( tenant_id = public.current_tenant() and ( para_id = auth.uid() or public.sou_master() ) );

drop policy if exists agenda_del on public.agenda_eventos;
create policy agenda_del on public.agenda_eventos for delete to authenticated
  using ( tenant_id = public.current_tenant() and ( para_id = auth.uid() or public.sou_master() ) );

commit;

-- ============================================================
-- CONFERÊNCIA:
--   select column_name from information_schema.columns
--    where table_name='agenda_eventos' and column_name in ('repete','repete_ate');  -- deve listar as 2
--
-- ROLLBACK (desfazer só a recorrência):
--   alter table public.agenda_eventos drop column if exists repete;
--   alter table public.agenda_eventos drop column if exists repete_ate;
-- ============================================================
