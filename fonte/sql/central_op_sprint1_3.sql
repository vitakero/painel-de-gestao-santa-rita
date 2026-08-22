-- ============================================================
-- CENTRAL OPERACIONAL — SPRINT 1.3 (Conversa contextual do RECEBIMENTO, só leitura)
-- Cada recebimento (central_agendamentos) ganha automaticamente um 'topico' do tipo
-- 'recebimento', com vínculo, para se conversar NO contexto daquele recebimento.
-- ADITIVO e IDEMPOTENTE. Depende de sprint0 + 1.1 + 1.2 já executados.
--
-- PROTEÇÃO DO ERP (inegociável): a tabela central_agendamentos só GANHA uma coluna
-- (topico_id, nullable, SEM FK, SEM default => não reescreve a tabela) + um trigger
-- BEFORE cujo corpo é 100% envolto em EXCEPTION => NUNCA aborta o upsert do robô.
-- O robô NÃO é alterado (ele nem sabe da coluna; o merge do upsert preserva topico_id).
--
-- NÃO cria: foto/áudio/anexos/compositor/busca/menções/reações/work_items/etc.
-- Permissão do módulo: pode_pagina('operacional').
-- COMO USAR: rodar no Supabase (STAGING primeiro). ROLLBACK comentado no fim.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Coluna aditiva em central_agendamentos (nullable, sem FK, sem default)
-- ------------------------------------------------------------
alter table public.central_agendamentos add column if not exists topico_id uuid;

-- ------------------------------------------------------------
-- 2) Mecanismo automático e idempotente: cria o tópico do recebimento no BEFORE
--    INSERT/UPDATE. SECURITY DEFINER (para poder inserir em topico/vinculo). Todo o
--    corpo em BEGIN/EXCEPTION => se qualquer coisa falhar, NEW.topico_id fica null e
--    a escrita do recebimento SEGUE normalmente (ERP protegido). Idempotente pela
--    unique ux_topico_origem (via select-then-insert).
-- ------------------------------------------------------------
create or replace function public.fn_recebimento_topico()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_tenant uuid; v_topico uuid; v_titulo text;
begin
  if NEW.topico_id is not null then return NEW; end if;   -- já ligado: nada a fazer (custo ~0)
  begin
    v_tenant := public.current_tenant();   -- dentro do bloco protegido: NADA aqui pode abortar o upsert do robô
    v_titulo := 'Recebimento — ' || coalesce(nullif(btrim(NEW.fornecedor), ''), 'sem fornecedor')
                || case when coalesce(NEW.data, '') <> '' then ' (' || NEW.data || ')' else '' end;

    select id into v_topico
      from public.topico
      where tenant_id = v_tenant and origem_tipo = 'central_agendamentos' and origem_id = NEW.id
      limit 1;

    if v_topico is null then
      insert into public.topico (id, tenant_id, tipo, titulo, setor, origem_tipo, origem_id)
      values (gen_random_uuid(), v_tenant, 'recebimento', v_titulo, 'Recebimento', 'central_agendamentos', NEW.id)
      returning id into v_topico;

      insert into public.vinculo (tenant_id, topico_id, entity_type, entity_id, papel)
      values (v_tenant, v_topico, 'central_agendamentos', NEW.id, 'origem')
      on conflict do nothing;
    end if;

    NEW.topico_id := v_topico;
  exception when others then
    null;   -- NUNCA aborta o upsert do robô; o próximo sync tenta de novo
  end;
  return NEW;
end $$;

drop trigger if exists trg_recebimento_topico on public.central_agendamentos;
create trigger trg_recebimento_topico
  before insert or update on public.central_agendamentos
  for each row execute function public.fn_recebimento_topico();

-- ------------------------------------------------------------
-- 3) RPC de LEITURA: listar_recebimentos — lista os tópicos de recebimento que o
--    usuário pode ver (RLS de topico via pode_ver_topico) + guard pode_pagina.
--    Traz o título já denormalizado (fornecedor/data) — NÃO lê central_agendamentos,
--    então não depende da permissão da Central Logística ('central').
-- ------------------------------------------------------------
create or replace function public.listar_recebimentos(p_limite int default 50)
returns table (id uuid, titulo text, setor text, origem_id text, updated_at timestamptz)
language plpgsql stable security invoker set search_path = public as $$
begin
  if not public.pode_pagina('operacional') then
    raise exception 'sem acesso a Central Operacional' using errcode = '42501';
  end if;
  return query
    select t.id, t.titulo, t.setor, t.origem_id, t.updated_at
    from public.topico t
    where t.tenant_id = public.current_tenant()
      and t.tipo = 'recebimento'
      and t.status = 'aberto'
    order by t.updated_at desc
    limit greatest(1, least(coalesce(p_limite, 50), 200));
end $$;

revoke all on function public.listar_recebimentos(int) from public;
grant execute on function public.listar_recebimentos(int) to authenticated;

-- ------------------------------------------------------------
-- 4) BACKFILL (idempotente): cria os tópicos dos recebimentos que JÁ existem,
--    os vínculos, e liga a coluna topico_id de volta. Rodar depois dos itens acima.
--    OBS: cada tópico criado gera 1 evento 'topico.criado' no Feed (esperado; é um
--    evento por recebimento existente — ver "riscos" no relatório).
-- ------------------------------------------------------------
insert into public.topico (id, tenant_id, tipo, titulo, setor, origem_tipo, origem_id)
select gen_random_uuid(), public.current_tenant(), 'recebimento',
       'Recebimento — ' || coalesce(nullif(btrim(ca.fornecedor), ''), 'sem fornecedor')
         || case when coalesce(ca.data, '') <> '' then ' (' || ca.data || ')' else '' end,
       'Recebimento', 'central_agendamentos', ca.id
from public.central_agendamentos ca
where not exists (
  select 1 from public.topico t
  where t.tenant_id = public.current_tenant()
    and t.origem_tipo = 'central_agendamentos' and t.origem_id = ca.id
);

insert into public.vinculo (tenant_id, topico_id, entity_type, entity_id, papel)
select public.current_tenant(), t.id, 'central_agendamentos', t.origem_id, 'origem'
from public.topico t
where t.tenant_id = public.current_tenant() and t.origem_tipo = 'central_agendamentos'
on conflict do nothing;

update public.central_agendamentos ca
set topico_id = t.id
from public.topico t
where t.tenant_id = public.current_tenant()
  and t.origem_tipo = 'central_agendamentos' and t.origem_id = ca.id
  and ca.topico_id is distinct from t.id;

-- ============================================================
-- ROLLBACK (desfazer só a Sprint 1.3) — descomentar se precisar:
-- drop trigger if exists trg_recebimento_topico on public.central_agendamentos;
-- drop function if exists public.fn_recebimento_topico();
-- drop function if exists public.listar_recebimentos(int);
-- update public.central_agendamentos set topico_id = null;             -- solta a coluna
-- delete from public.vinculo where entity_type = 'central_agendamentos';
-- delete from public.eventos where tipo = 'topico.criado'
--   and topico_id in (select id from public.topico where tipo = 'recebimento');
-- delete from public.topico where tenant_id = public.current_tenant() and tipo = 'recebimento';
-- alter table public.central_agendamentos drop column if exists topico_id;   -- remove a coluna (aditiva)
-- ============================================================
