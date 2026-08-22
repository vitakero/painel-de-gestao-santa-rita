-- ============================================================
-- CENTRAL OPERACIONAL — SPRINT 2.7 (ROTINAS POR SETOR)
--
-- EVOLUI o módulo de Rotinas (2.6): visão diária agrupada por SETOR ("o que cada setor
-- ainda precisa fazer hoje?"). SÓ LEITURA nova — a escrita reusa registrar_execucao (2.6).
--
-- ZERO tabela nova (reusa rotinas / rotinas_execucoes / eventos / feature_flags / perfis).
-- 2 RPCs de leitura NOVAS (INVOKER, sob RLS): rotinas_por_setor + rotinas_setores_resumo.
-- NÃO altera listar_rotinas / rotinas_resumo / detalhe_rotina / registrar_execucao da 2.6
-- (função nova evita 42P13 e não quebra a tela antiga).
--
-- "HOJE" = dia local America/Fortaleza por LIMITES EXPLÍCITOS de timestamptz (início inclusivo,
-- fim exclusivo) — comparação de RANGE em created_at (index-friendly). NÃO usa índice funcional
-- com timezone (at time zone não é IMMUTABLE) nem current_date sem timezone.
--
-- Estado do dia (rótulo de interface): sem execução hoje => 'pendente'; com execução => o status
-- real (em_andamento/concluido/cancelado). "pendente" é o mesmo rótulo que a 2.6 já usa (estado_hoje).
--
-- ADITIVO E IDEMPOTENTE. Uma transação. Nenhuma palavra-chave é schema-qualificada.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1) flag rotinas_setor_enabled (off). Independente de rotinas_enabled.
--    A visão "Por setor" só aparece com rotinas_enabled ON + rotinas_setor_enabled ON.
-- ------------------------------------------------------------
insert into public.feature_flags(tenant_id, chave, habilitado)
values (public.current_tenant(), 'rotinas_setor_enabled', false)
on conflict (tenant_id, chave) do nothing;

-- ------------------------------------------------------------
-- 2) rotinas_por_setor — lista diária, filtrável/paginada no servidor.
--    Estado do dia = status da execução de HOJE (compartilhada por rotina/dia) ou 'pendente'.
-- ------------------------------------------------------------
create or replace function public.rotinas_por_setor(
  p_setor text default null, p_status text default null, p_busca text default null,
  p_limit int default 50, p_offset int default 0)
returns table (
  rotina_id uuid, titulo text, descricao text, setor text, ordem int, ativo boolean,
  execucao_id uuid, status text, usuario_id uuid, usuario_nome text, observacao text,
  iniciado_em timestamptz, executado_em timestamptz, updated_at timestamptz, total_count bigint)
language plpgsql stable security invoker set search_path = public, extensions as $$
declare
  v_hoje date := (now() at time zone 'America/Fortaleza')::date;
  v_ini timestamptz := (v_hoje)::timestamp at time zone 'America/Fortaleza';       -- meia-noite local de hoje
  v_fim timestamptz := (v_hoje + 1)::timestamp at time zone 'America/Fortaleza';   -- meia-noite local de amanhã
  v_lim int := greatest(1, least(coalesce(p_limit, 50), 200));
  v_off int := greatest(0, coalesce(p_offset, 0));
  v_q text := nullif(btrim(coalesce(p_busca, '')), '');
begin
  if not (public.pode_pagina('operacional') or public.sou_master()) then
    raise exception 'sem acesso' using errcode = '42501'; end if;
  return query
  select r.id, r.titulo, r.descricao, coalesce(r.setor, '(sem setor)'), r.ordem, r.ativo,
         ex.id, coalesce(ex.status, 'pendente'), ex.usuario_id, public.nome_de(ex.usuario_id),
         ex.observacao, ex.iniciado_em, ex.executado_em, ex.updated_at,
         count(*) over () as total_count
    from public.rotinas r
    left join lateral (
        select e.id, e.status, e.usuario_id, e.observacao,
               e.created_at as iniciado_em, e.executado_em, e.updated_at
          from public.rotinas_execucoes e
         where e.rotina_id = r.id and e.tenant_id = public.current_tenant()
           and e.created_at >= v_ini and e.created_at < v_fim   -- só execução do DIA LOCAL de hoje
         order by case e.status when 'concluido' then 0 when 'em_andamento' then 1 when 'cancelado' then 3 else 2 end asc,
                  e.created_at desc limit 1   -- (2.7-review) prioridade concluido>em_andamento>pendente = igual à 2.6
    ) ex on true
   where r.tenant_id = public.current_tenant()
     and r.ativo
     and (p_setor is null or coalesce(r.setor, '(sem setor)') = p_setor)
     and (p_status is null or coalesce(ex.status, 'pendente') = p_status)
     and (v_q is null or unaccent(r.titulo) ilike unaccent('%' || v_q || '%')
                      or unaccent(coalesce(r.descricao, '')) ilike unaccent('%' || v_q || '%'))
   order by coalesce(r.setor, '(sem setor)') asc, r.ordem asc, r.titulo asc, r.id asc
   limit v_lim offset v_off;
end $$;

-- ------------------------------------------------------------
-- 3) rotinas_setores_resumo — progresso do dia POR SETOR (mesma definição de dia/status da lista).
-- ------------------------------------------------------------
create or replace function public.rotinas_setores_resumo()
returns table (
  setor text, total bigint, abertas bigint, em_andamento bigint,
  concluidas bigint, canceladas bigint, percentual_concluido int)
language plpgsql stable security invoker set search_path = public as $$
declare
  v_hoje date := (now() at time zone 'America/Fortaleza')::date;
  v_ini timestamptz := (v_hoje)::timestamp at time zone 'America/Fortaleza';
  v_fim timestamptz := (v_hoje + 1)::timestamp at time zone 'America/Fortaleza';
begin
  if not (public.pode_pagina('operacional') or public.sou_master()) then
    raise exception 'sem acesso' using errcode = '42501'; end if;
  return query
  with base as (
    select coalesce(r.setor, '(sem setor)') as setor,
           coalesce(ex.status, 'pendente') as st
      from public.rotinas r
      left join lateral (
          select e.status
            from public.rotinas_execucoes e
           where e.rotina_id = r.id and e.tenant_id = public.current_tenant()
             and e.created_at >= v_ini and e.created_at < v_fim
           order by case e.status when 'concluido' then 0 when 'em_andamento' then 1 when 'cancelado' then 3 else 2 end asc,
                    e.created_at desc limit 1   -- (2.7-review) mesma prioridade da lista/2.6
      ) ex on true
     where r.tenant_id = public.current_tenant() and r.ativo
  )
  select b.setor,
         count(*) as total,
         count(*) filter (where b.st = 'pendente')     as abertas,
         count(*) filter (where b.st = 'em_andamento') as em_andamento,
         count(*) filter (where b.st = 'concluido')    as concluidas,
         count(*) filter (where b.st = 'cancelado')    as canceladas,
         (case when count(*) = 0 then 0
               else round(100.0 * count(*) filter (where b.st = 'concluido') / count(*))::int end) as percentual_concluido
    from base b
   group by b.setor
   order by b.setor asc;
end $$;

-- ------------------------------------------------------------
-- 3.5) registrar_execucao — REDEFINIDA da 2.6 acrescentando SÓ um advisory lock por rotina no
--      INICIAR (serializa "Iniciar" simultâneo da MESMA rotina => nunca cria 2 execuções abertas
--      paralelas — spec 2.7). Assinatura/comportamento/idempotência/validações INALTERADOS;
--      create or replace PRESERVA os grants existentes (re-granted abaixo por segurança).
-- ------------------------------------------------------------
create or replace function public.registrar_execucao(
  p_request_id uuid, p_rotina_id uuid, p_status text,
  p_execucao_id uuid default null, p_observacao text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant();
  v_uid uuid := auth.uid();
  v_id uuid; v_rot public.rotinas; v_status_antigo text; v_nome text;
begin
  if not (public.pode_pagina('operacional') or public.sou_master()) then
    raise exception 'sem acesso' using errcode = '42501'; end if;
  if p_request_id is null then raise exception 'request_id obrigatorio' using errcode = '22023'; end if;
  if p_status not in ('em_andamento','concluido','cancelado','pendente') then
    raise exception 'status invalido' using errcode = '22023'; end if;

  select * into v_rot from public.rotinas where id = p_rotina_id and tenant_id = v_tenant;
  if not found then raise exception 'rotina nao encontrada' using errcode = 'P0002'; end if;

  if p_execucao_id is null then
    -- (2.7) serializa o INICIAR por rotina: dois cliques simultâneos não criam execuções paralelas.
    perform pg_advisory_xact_lock(hashtextextended(p_rotina_id::text, 0));
    -- INICIAR: UMA execução aberta por rotina por DIA (compartilhada). Se já há uma aberta HOJE,
    -- devolve ela (não cria paralela). Sem evento no iniciar.
    select id into v_id from public.rotinas_execucoes
      where tenant_id = v_tenant and rotina_id = p_rotina_id and status = 'em_andamento'
        and (created_at at time zone 'America/Fortaleza')::date = (now() at time zone 'America/Fortaleza')::date
      order by created_at desc limit 1;
    if v_id is not null then return v_id; end if;
    insert into public.rotinas_execucoes(tenant_id, rotina_id, usuario_id, status, observacao, request_id)
    values (v_tenant, p_rotina_id, v_uid, 'em_andamento',
            nullif(btrim(coalesce(p_observacao, '')), ''), p_request_id)
    on conflict (tenant_id, request_id) where request_id is not null do nothing
    returning id into v_id;
    if v_id is null then
      select id into v_id from public.rotinas_execucoes where tenant_id = v_tenant and request_id = p_request_id;
    end if;
    return v_id;
  end if;

  -- ATUALIZAR (concluir/cancelar): qualquer operacional conclui a execução aberta. Só mesmo tenant. Idempotente.
  select status into v_status_antigo from public.rotinas_execucoes
    where id = p_execucao_id and tenant_id = v_tenant;
  if not found then raise exception 'execucao nao encontrada' using errcode = 'P0002'; end if;
  update public.rotinas_execucoes
     set status = p_status,
         observacao = coalesce(nullif(btrim(coalesce(p_observacao, '')), ''), observacao),
         executado_em = case when p_status = 'concluido' then coalesce(executado_em, now()) else executado_em end,
         updated_at = now()
   where id = p_execucao_id and tenant_id = v_tenant;
  v_id := p_execucao_id;
  if not (p_status = 'concluido' and v_status_antigo is distinct from 'concluido') then
    return v_id;
  end if;

  v_nome := coalesce(public.nome_de(v_uid), 'Alguem');
  insert into public.eventos(event_uuid, tenant_id, tipo, topico_id, entity_type, entity_id,
                             autor_id, setor, resumo, payload)
  values (md5(v_tenant::text || '|rotina.concluida|' || v_id::text)::uuid,
          v_tenant, 'rotina.concluida', null, 'rotinas_execucoes', v_id::text,
          v_uid, v_rot.setor,
          v_nome || ' concluiu a rotina ' || coalesce(v_rot.titulo, ''),
          jsonb_build_object('rotina_id', v_rot.id, 'titulo', v_rot.titulo))
  on conflict (tenant_id, event_uuid) do nothing;

  return v_id;
end $$;

-- ------------------------------------------------------------
-- 4) GRANTS
-- ------------------------------------------------------------
revoke all on function public.rotinas_por_setor(text, text, text, int, int) from public;
revoke all on function public.rotinas_setores_resumo()                       from public;
grant execute on function public.rotinas_por_setor(text, text, text, int, int) to authenticated;
grant execute on function public.rotinas_setores_resumo()                       to authenticated;
grant execute on function public.registrar_execucao(uuid, uuid, text, uuid, text) to authenticated;   -- (2.7) preserva o grant da redefinição

commit;

-- ============================================================
-- CONFERÊNCIA (no SQL Editor dá 42501 pois auth.uid() é NULL — guard funcionando):
--   select * from public.rotinas_setores_resumo();
--   select * from public.rotinas_por_setor();
--   select chave, habilitado from public.feature_flags where chave = 'rotinas_setor_enabled';
--
-- ROLLBACK (desfazer só a 2.7):
-- drop function if exists public.rotinas_por_setor(text, text, text, int, int);
-- drop function if exists public.rotinas_setores_resumo();
-- delete from public.feature_flags where chave = 'rotinas_setor_enabled';
-- ============================================================
