-- ============================================================
-- CENTRAL OPERACIONAL — SPRINT 2.8 (TAREFAS POR FUNCIONÁRIO)
--
-- NOVA VISÃO sobre os Work Items (NÃO um segundo sistema de tarefas): agrupa por RESPONSÁVEL
-- ("o que cada funcionário tem para fazer agora?"). SÓ LEITURA nova.
--
-- ZERO tabela nova (reusa work_items / perfis / eventos / feature_flags). ZERO escrita nova
-- (reatribuição reusa atualizar_work_item da 2.0 — DEFINER, idempotente por p_request_id,
-- valida responsável em perfis, emite work_item.atualizado => Broadcast). 2 RPCs de LEITURA
-- NOVAS INVOKER (sob RLS): work_items_resumo_por_responsavel + work_items_por_responsavel_pagina.
-- Roster de perfis: reusa participantes() (1.13). NÃO altera work_items_pagina/detalhe/atualizar.
--
-- REGRA DE ATRASO CANÔNICA (idêntica a work_items_pagina/detalhe/Painel):
--   prazo_em is not null AND status not in ('concluido','cancelado') AND prazo_em < now()
--   (prazo_em é timestamptz => comparação com now(), sem timezone/at time zone).
-- STATUS ATIVO = status not in ('concluido','cancelado').
-- perfis NÃO tem coluna 'ativo' → responsavel_ativo = (o perfil existe); responsável cujo perfil
--   foi apagado mas ainda tem item ativo aparece (nome null => o cliente mostra "Usuário indisponível").
-- "Sem responsável" = responsavel_id NULL (nunca um uuid falso).
--
-- ADITIVO E IDEMPOTENTE. Uma transação. Nenhuma palavra-chave é schema-qualificada.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1) flag work_items_por_responsavel_enabled (off). Independente das flags de Work Items.
-- ------------------------------------------------------------
insert into public.feature_flags(tenant_id, chave, habilitado)
values (public.current_tenant(), 'work_items_por_responsavel_enabled', false)
on conflict (tenant_id, chave) do nothing;

-- ------------------------------------------------------------
-- 2) work_items_resumo_por_responsavel — carga de trabalho por responsável, UMA passada (sem N+1).
-- ------------------------------------------------------------
create or replace function public.work_items_resumo_por_responsavel(
  p_busca text default null, p_incluir_sem_responsavel boolean default true,
  p_concluidos_desde timestamptz default null)
returns table (
  responsavel_id uuid, responsavel_nome text, responsavel_ativo boolean, responsavel_setor text,
  total_ativos bigint, total_abertos bigint, total_em_andamento bigint, total_bloqueados bigint,
  total_atrasados bigint, total_urgentes bigint, total_concluidos_periodo bigint, proximo_prazo timestamptz)
language plpgsql stable security invoker set search_path = public, extensions as $$
declare
  v_desde timestamptz := coalesce(p_concluidos_desde, now() - interval '30 days');
  v_q text := nullif(btrim(coalesce(p_busca, '')), '');
begin
  if not (public.pode_pagina('operacional') or public.sou_master()) then
    raise exception 'sem acesso' using errcode = '42501'; end if;
  return query
  with base as (
    select w.responsavel_id as rid, pf.nome as rnome, pf.setor as rsetor,
           w.status, w.prioridade,
           (w.prazo_em is not null and w.status not in ('concluido','cancelado') and w.prazo_em < now()) as atrasado,
           (w.status not in ('concluido','cancelado')) as ativo,
           (w.status = 'concluido' and w.resolvido_em is not null and w.resolvido_em >= v_desde) as conc_periodo,
           (case when w.status not in ('concluido','cancelado') then w.prazo_em else null end) as prazo_ativo
      from public.work_items w
      left join public.perfis pf on pf.id = w.responsavel_id
     where w.tenant_id = public.current_tenant()
  )
  select b.rid,
         (case when b.rid is null then null else max(b.rnome) end) as responsavel_nome,
         (case when b.rid is null then true else (max(b.rnome) is not null) end) as responsavel_ativo,
         (case when b.rid is null then null else max(b.rsetor) end) as responsavel_setor,
         count(*) filter (where b.ativo)                              as total_ativos,
         count(*) filter (where b.status = 'aberto')                  as total_abertos,
         count(*) filter (where b.status = 'em_andamento')            as total_em_andamento,
         count(*) filter (where b.status = 'bloqueado')               as total_bloqueados,
         count(*) filter (where b.atrasado)                           as total_atrasados,
         count(*) filter (where b.ativo and b.prioridade = 'urgente') as total_urgentes,
         count(*) filter (where b.conc_periodo)                       as total_concluidos_periodo,
         min(b.prazo_ativo)                                           as proximo_prazo
    from base b
   where (b.rid is not null or p_incluir_sem_responsavel)
     and (v_q is null or (b.rid is not null and unaccent(coalesce(b.rnome, '')) ilike unaccent('%' || v_q || '%')))
   group by b.rid
  having count(*) filter (where b.ativo) > 0 or count(*) filter (where b.conc_periodo) > 0
   order by count(*) filter (where b.atrasado) desc,
            count(*) filter (where b.ativo and b.prioridade = 'urgente') desc,
            count(*) filter (where b.ativo) desc,
            max(b.rnome) asc nulls last, b.rid asc;
end $$;

-- ------------------------------------------------------------
-- 3) work_items_por_responsavel_pagina — lista filtrável/paginada. MESMO formato de item da
--    Lista (work_items_pagina) + total_count. work_items_pagina não filtra sem-responsável/
--    atrasados/busca, por isso a função nova. SECURITY INVOKER (RLS = mostra só o que o usuário vê).
-- ------------------------------------------------------------
create or replace function public.work_items_por_responsavel_pagina(
  p_responsavel_id uuid default null, p_sem_responsavel boolean default false,
  p_status text default null, p_prioridade text default null, p_tipo text default null,
  p_somente_atrasados boolean default false, p_busca text default null,
  p_limit int default 50, p_offset int default 0)
returns table (
  id uuid, tipo text, titulo text, resumo text, status text, prioridade text,
  responsavel_id uuid, responsavel_nome text, prazo_em timestamptz,
  criado_em timestamptz, atualizado_em timestamptz, concluido_em timestamptz,
  topico_id uuid, vinculos int, atrasado boolean, total_count bigint)
language plpgsql stable security invoker
set search_path = public, extensions set plan_cache_mode = 'force_custom_plan' as $$   -- (2.8-review) filtros opcionais só viram index cond no plano CUSTOM (igual work_items_pagina)
declare
  v_lim int := greatest(1, least(coalesce(p_limit, 50), 100));
  v_off int := greatest(0, coalesce(p_offset, 0));
  v_q text := nullif(btrim(coalesce(p_busca, '')), '');
begin
  if not (public.pode_pagina('operacional') or public.sou_master()) then
    raise exception 'sem acesso' using errcode = '42501'; end if;
  return query
    select w.id, w.tipo, w.titulo, left(coalesce(w.descricao, ''), 140) as resumo,
           w.status, w.prioridade, w.responsavel_id,
           (select pf.nome from public.perfis pf where pf.id = w.responsavel_id) as responsavel_nome,
           w.prazo_em, w.created_at, w.updated_at, w.resolvido_em, w.topico_id,
           (select count(*)::int from public.vinculo v where v.work_item_id = w.id) as vinculos,
           (w.prazo_em is not null and w.status not in ('concluido','cancelado') and w.prazo_em < now()) as atrasado,
           count(*) over () as total_count
      from public.work_items w
     where w.tenant_id = public.current_tenant()
       and (case when p_sem_responsavel then w.responsavel_id is null
                 when p_responsavel_id is not null then w.responsavel_id = p_responsavel_id
                 else true end)
       and (p_status is null or w.status = p_status)
       and (p_prioridade is null or w.prioridade = p_prioridade)
       and (p_tipo is null or w.tipo = p_tipo)
       and (not p_somente_atrasados
            or (w.prazo_em is not null and w.status not in ('concluido','cancelado') and w.prazo_em < now()))
       and (v_q is null or unaccent(w.titulo) ilike unaccent('%' || v_q || '%')
                        or unaccent(coalesce(w.descricao, '')) ilike unaccent('%' || v_q || '%'))
     order by w.updated_at desc, w.id desc
     limit v_lim offset v_off;
end $$;

-- ------------------------------------------------------------
-- 4) GRANTS
-- ------------------------------------------------------------
revoke all on function public.work_items_resumo_por_responsavel(text, boolean, timestamptz) from public;
revoke all on function public.work_items_por_responsavel_pagina(uuid, boolean, text, text, text, boolean, text, int, int) from public;
grant execute on function public.work_items_resumo_por_responsavel(text, boolean, timestamptz) to authenticated;
grant execute on function public.work_items_por_responsavel_pagina(uuid, boolean, text, text, text, boolean, text, int, int) to authenticated;

commit;

-- ============================================================
-- CONFERÊNCIA (no SQL Editor dá 42501 pois auth.uid() é NULL — guard funcionando):
--   select * from public.work_items_resumo_por_responsavel();
--   select * from public.work_items_por_responsavel_pagina();
--   select chave, habilitado from public.feature_flags where chave = 'work_items_por_responsavel_enabled';
--
-- ROLLBACK (desfazer só a 2.8):
-- drop function if exists public.work_items_por_responsavel_pagina(uuid, boolean, text, text, text, boolean, text, int, int);
-- drop function if exists public.work_items_resumo_por_responsavel(text, boolean, timestamptz);
-- delete from public.feature_flags where chave = 'work_items_por_responsavel_enabled';
-- ============================================================
