-- ============================================================
-- CENTRAL OPERACIONAL — SPRINT 2.6 (ROTINAS OPERACIONAIS)
--
-- Atividades PROATIVAS/recorrentes da operação (abrir/fechar loja, limpeza, conferências,
-- checklists) — o complemento das atividades reativas (ocorrências/work items).
--
-- Modelo mínimo (a spec pede simplicidade): 2 tabelas novas — o CATÁLOGO (rotinas) e as
-- EXECUÇÕES (rotinas_execucoes). SEM recorrência/horário/calendário/notificação/IA (fora de escopo).
--
-- PADRÕES REUSADOS: RLS por tenant + pode_pagina('operacional')/sou_master; escrita só por RPC
-- SECURITY DEFINER idempotente; leitura por RPC SECURITY INVOKER sob RLS; idempotência por
-- p_request_id (unique parcial); evento no Feed via insert em public.eventos (o trigger
-- trg_eventos_broadcast já existente transmite por BROADCAST — nada de postgres_changes).
--
-- "hoje" = dia local America/Fortaleza (igual ao Painel 2.2). Sem recorrência de verdade: um
-- item é "pendente hoje" se está ativo e ainda não foi concluído hoje — é o checklist do dia.
--
-- DECISÃO (documentada): DEFINIR o catálogo (criar/editar/ativar/desativar) = só MASTER;
-- EXECUTAR uma rotina (iniciar/concluir) e LER = qualquer um com a página 'operacional' (ou master).
-- Modelo natural: o dono define o checklist, a equipe cumpre.
--
-- ZERO tabela do ERP tocada, ZERO postgres_changes, ADITIVO E IDEMPOTENTE. Uma transação.
-- Todas as funções são NOVAS (sem 42P13). Nenhuma palavra-chave é schema-qualificada.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1) flag rotinas_enabled (off)
-- ------------------------------------------------------------
insert into public.feature_flags(tenant_id, chave, habilitado)
values (public.current_tenant(), 'rotinas_enabled', false)
on conflict (tenant_id, chave) do nothing;

-- ------------------------------------------------------------
-- 2) CATÁLOGO: rotinas
-- ------------------------------------------------------------
create table if not exists public.rotinas (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null default public.current_tenant(),
  titulo      text not null,
  descricao   text,
  setor       text,
  ordem       int not null default 0,
  ativo       boolean not null default true,
  criado_por  uuid,
  request_id  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint rotinas_titulo_len check (char_length(titulo) between 1 and 160),
  constraint rotinas_setor_len  check (setor is null or char_length(setor) <= 80),
  constraint rotinas_desc_len   check (descricao is null or char_length(descricao) <= 4000)
);
create unique index if not exists ux_rotinas_request on public.rotinas(tenant_id, request_id) where request_id is not null;
create index if not exists ix_rotinas_lista on public.rotinas(tenant_id, ativo, ordem, titulo);
create index if not exists ix_rotinas_setor on public.rotinas(tenant_id, setor);

-- ------------------------------------------------------------
-- 3) EXECUÇÕES: rotinas_execucoes
-- ------------------------------------------------------------
create table if not exists public.rotinas_execucoes (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null default public.current_tenant(),
  rotina_id    uuid not null references public.rotinas(id),
  usuario_id   uuid,
  status       text not null default 'em_andamento'
               check (status in ('pendente','em_andamento','concluido','cancelado')),
  observacao   text,
  executado_em timestamptz,
  request_id   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint rexec_obs_len check (observacao is null or char_length(observacao) <= 2000)
);
create unique index if not exists ux_rexec_request on public.rotinas_execucoes(tenant_id, request_id) where request_id is not null;
create index if not exists ix_rexec_rotina on public.rotinas_execucoes(tenant_id, rotina_id, created_at desc);
create index if not exists ix_rexec_status on public.rotinas_execucoes(tenant_id, status, executado_em desc);
create index if not exists ix_rexec_usuario_aberta on public.rotinas_execucoes(tenant_id, usuario_id, rotina_id)
  where status = 'em_andamento';

-- ------------------------------------------------------------
-- 4) RLS — leitura direta só do próprio tenant e com a página; escrita só por RPC (DEFINER)
-- ------------------------------------------------------------
alter table public.rotinas            enable row level security;
alter table public.rotinas_execucoes  enable row level security;

drop policy if exists rotinas_sel on public.rotinas;
create policy rotinas_sel on public.rotinas for select to authenticated
  using (tenant_id = public.current_tenant() and (public.pode_pagina('operacional') or public.sou_master()));

drop policy if exists rexec_sel on public.rotinas_execucoes;
create policy rexec_sel on public.rotinas_execucoes for select to authenticated
  using (tenant_id = public.current_tenant() and (public.pode_pagina('operacional') or public.sou_master()));

-- sem policy de insert/update/delete => escrita direta do navegador é bloqueada (só via RPC DEFINER)
grant select on public.rotinas           to authenticated;
grant select on public.rotinas_execucoes to authenticated;

-- ------------------------------------------------------------
-- 5) RPCs DE ESCRITA — catálogo (SECURITY DEFINER, só MASTER)
-- ------------------------------------------------------------
create or replace function public.criar_rotina(
  p_request_id uuid, p_titulo text, p_descricao text default null,
  p_setor text default null, p_ordem int default 0)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_tenant uuid := public.current_tenant(); v_id uuid; v_tit text := btrim(coalesce(p_titulo, ''));
begin
  if not public.sou_master() then raise exception 'so o master define rotinas' using errcode = '42501'; end if;
  if p_request_id is null then raise exception 'request_id obrigatorio' using errcode = '22023'; end if;
  if v_tit = '' then raise exception 'titulo obrigatorio' using errcode = '22023'; end if;

  insert into public.rotinas(tenant_id, titulo, descricao, setor, ordem, criado_por, request_id)
  values (v_tenant, left(v_tit, 160), nullif(btrim(coalesce(p_descricao, '')), ''),
          nullif(btrim(coalesce(p_setor, '')), ''), coalesce(p_ordem, 0), auth.uid(), p_request_id)
  on conflict (tenant_id, request_id) where request_id is not null do nothing   -- (review) predicado do índice PARCIAL
  returning id into v_id;

  if v_id is null then   -- retry da mesma intenção: devolve a que já existe
    select id into v_id from public.rotinas where tenant_id = v_tenant and request_id = p_request_id;
  end if;
  return v_id;
end $$;

create or replace function public.editar_rotina(
  p_id uuid, p_titulo text, p_descricao text default null,
  p_setor text default null, p_ordem int default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_tenant uuid := public.current_tenant(); v_tit text := btrim(coalesce(p_titulo, ''));
begin
  if not public.sou_master() then raise exception 'so o master edita rotinas' using errcode = '42501'; end if;
  if v_tit = '' then raise exception 'titulo obrigatorio' using errcode = '22023'; end if;
  update public.rotinas
     set titulo = left(v_tit, 160),
         descricao = nullif(btrim(coalesce(p_descricao, '')), ''),
         setor = nullif(btrim(coalesce(p_setor, '')), ''),
         ordem = coalesce(p_ordem, ordem),
         updated_at = now()
   where id = p_id and tenant_id = v_tenant;
  if not found then raise exception 'rotina nao encontrada' using errcode = 'P0002'; end if;
  return p_id;
end $$;

create or replace function public.ativar_rotina(p_id uuid, p_ativo boolean default true)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_tenant uuid := public.current_tenant();
begin
  if not public.sou_master() then raise exception 'so o master ativa/desativa rotinas' using errcode = '42501'; end if;
  update public.rotinas set ativo = coalesce(p_ativo, true), updated_at = now()
   where id = p_id and tenant_id = v_tenant;
  if not found then raise exception 'rotina nao encontrada' using errcode = 'P0002'; end if;
  return p_id;
end $$;
-- desativar = ativar_rotina(id, false); mantenho um alias explícito por clareza da spec
create or replace function public.desativar_rotina(p_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
begin
  return public.ativar_rotina(p_id, false);
end $$;

-- ------------------------------------------------------------
-- 6) RPC DE ESCRITA — executar (iniciar/concluir/cancelar). operacional OU master.
--    p_execucao_id NULL => Iniciar (cria em_andamento). Não-nulo => atualiza a execução.
--    Concluir grava executado_em + emite evento 'rotina.concluida' no Feed (=> Broadcast).
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
    -- INICIAR: UMA execução aberta por rotina por DIA (compartilhada). Se já há uma aberta HOJE,
    -- devolve ela (não cria paralela — review). Sem evento no iniciar.
    select id into v_id from public.rotinas_execucoes
      where tenant_id = v_tenant and rotina_id = p_rotina_id and status = 'em_andamento'
        and (created_at at time zone 'America/Fortaleza')::date = (now() at time zone 'America/Fortaleza')::date
      order by created_at desc limit 1;
    if v_id is not null then return v_id; end if;
    insert into public.rotinas_execucoes(tenant_id, rotina_id, usuario_id, status, observacao, request_id)
    values (v_tenant, p_rotina_id, v_uid, 'em_andamento',
            nullif(btrim(coalesce(p_observacao, '')), ''), p_request_id)
    on conflict (tenant_id, request_id) where request_id is not null do nothing   -- (review) predicado do índice PARCIAL
    returning id into v_id;
    if v_id is null then
      select id into v_id from public.rotinas_execucoes where tenant_id = v_tenant and request_id = p_request_id;
    end if;
    return v_id;   -- iniciar nunca emite evento
  end if;

  -- ATUALIZAR (concluir/cancelar): rotina é COMPARTILHADA => qualquer operacional conclui a execução
  -- aberta (não exige ser o dono — review). Só no mesmo tenant. Idempotente.
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
  -- só emite o evento na TRANSIÇÃO para concluído (retry/re-conclusão não re-emite)
  if not (p_status = 'concluido' and v_status_antigo is distinct from 'concluido') then
    return v_id;
  end if;

  -- EVENTO no Feed (dispara Broadcast pelo trigger existente). Dedup por execução.
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
-- 7) RPCs DE LEITURA (SECURITY INVOKER, sob RLS + guard)
-- ------------------------------------------------------------
-- estado_hoje: concluido (se concluída hoje) > em_andamento (execução aberta) > pendente.
create or replace function public.listar_rotinas(p_setor text default null, p_incluir_inativas boolean default false)
returns table (
  id uuid, titulo text, descricao text, setor text, ordem int, ativo boolean,
  estado_hoje text, ultima_status text, ultima_em timestamptz, ultima_usuario text, exec_aberta_id uuid)
language plpgsql stable security invoker set search_path = public as $$
begin
  if not (public.pode_pagina('operacional') or public.sou_master()) then
    raise exception 'sem acesso' using errcode = '42501'; end if;
  return query
  select r.id, r.titulo, r.descricao, r.setor, r.ordem, r.ativo,
    (case
       when exists (select 1 from public.rotinas_execucoes e
                     where e.rotina_id = r.id and e.status = 'concluido'
                       and (e.executado_em at time zone 'America/Fortaleza')::date
                           = (now() at time zone 'America/Fortaleza')::date) then 'concluido'
       when exists (select 1 from public.rotinas_execucoes e
                     where e.rotina_id = r.id and e.status = 'em_andamento'
                       and (e.created_at at time zone 'America/Fortaleza')::date
                           = (now() at time zone 'America/Fortaleza')::date) then 'em_andamento'
       else 'pendente' end) as estado_hoje,
    ult.status, ult.executado_em, public.nome_de(ult.usuario_id),
    (select e.id from public.rotinas_execucoes e   -- a execução aberta HOJE (compartilhada, qualquer usuário)
      where e.rotina_id = r.id and e.status = 'em_andamento'
        and (e.created_at at time zone 'America/Fortaleza')::date = (now() at time zone 'America/Fortaleza')::date
      order by e.created_at desc limit 1) as exec_aberta_id
  from public.rotinas r
  left join lateral (
      select e.status, e.executado_em, e.usuario_id   -- "Última" = última execução CONCLUÍDA (não uma aberta)
        from public.rotinas_execucoes e
       where e.rotina_id = r.id and e.status = 'concluido'
       order by e.executado_em desc limit 1
  ) ult on true
  where r.tenant_id = public.current_tenant()
    and (p_incluir_inativas or r.ativo)
    and (p_setor is null or r.setor = p_setor)
  order by r.ordem asc, r.titulo asc;
end $$;

create or replace function public.listar_rotinas_por_setor(p_setor text)
returns table (
  id uuid, titulo text, descricao text, setor text, ordem int, ativo boolean,
  estado_hoje text, ultima_status text, ultima_em timestamptz, ultima_usuario text, exec_aberta_id uuid)
language plpgsql stable security invoker set search_path = public as $$
begin
  return query select * from public.listar_rotinas(p_setor, false);
end $$;

create or replace function public.detalhe_rotina(p_id uuid)
returns table (
  id uuid, titulo text, descricao text, setor text, ordem int, ativo boolean,
  exec_id uuid, exec_status text, exec_usuario text, exec_observacao text,
  exec_executado_em timestamptz, exec_created_at timestamptz)
language plpgsql stable security invoker set search_path = public as $$
begin
  if not (public.pode_pagina('operacional') or public.sou_master()) then
    raise exception 'sem acesso' using errcode = '42501'; end if;
  return query
  select r.id, r.titulo, r.descricao, r.setor, r.ordem, r.ativo,
         e.id, e.status, public.nome_de(e.usuario_id), e.observacao, e.executado_em, e.created_at
    from public.rotinas r
    left join lateral (
       select e.id, e.status, e.usuario_id, e.observacao, e.executado_em, e.created_at
         from public.rotinas_execucoes e
        where e.rotina_id = r.id
        order by e.created_at desc limit 10
    ) e on true
   where r.id = p_id and r.tenant_id = public.current_tenant()
   order by e.created_at desc nulls last;
end $$;

-- indicadores simples do dia (America/Fortaleza)
create or replace function public.rotinas_resumo()
returns table (pendentes int, em_andamento int, concluidas int, total_ativas int)
language plpgsql stable security invoker set search_path = public as $$
begin
  if not (public.pode_pagina('operacional') or public.sou_master()) then
    raise exception 'sem acesso' using errcode = '42501'; end if;
  return query
  with ativas as (
    select r.id,
      (case
        when exists (select 1 from public.rotinas_execucoes e
                      where e.rotina_id = r.id and e.status = 'concluido'
                        and (e.executado_em at time zone 'America/Fortaleza')::date
                            = (now() at time zone 'America/Fortaleza')::date) then 'concluido'
        when exists (select 1 from public.rotinas_execucoes e
                      where e.rotina_id = r.id and e.status = 'em_andamento'
                        and (e.created_at at time zone 'America/Fortaleza')::date
                            = (now() at time zone 'America/Fortaleza')::date) then 'em_andamento'
        else 'pendente' end) as est
    from public.rotinas r
    where r.tenant_id = public.current_tenant() and r.ativo
  )
  select count(*) filter (where est = 'pendente')::int,
         count(*) filter (where est = 'em_andamento')::int,
         count(*) filter (where est = 'concluido')::int,
         count(*)::int
    from ativas;
end $$;

-- ------------------------------------------------------------
-- 8) GRANTS
-- ------------------------------------------------------------
revoke all on function public.criar_rotina(uuid, text, text, text, int)      from public;
revoke all on function public.editar_rotina(uuid, text, text, text, int)     from public;
revoke all on function public.ativar_rotina(uuid, boolean)                   from public;
revoke all on function public.desativar_rotina(uuid)                         from public;
revoke all on function public.registrar_execucao(uuid, uuid, text, uuid, text) from public;
revoke all on function public.listar_rotinas(text, boolean)                  from public;
revoke all on function public.listar_rotinas_por_setor(text)                 from public;
revoke all on function public.detalhe_rotina(uuid)                           from public;
revoke all on function public.rotinas_resumo()                               from public;

grant execute on function public.criar_rotina(uuid, text, text, text, int)      to authenticated;
grant execute on function public.editar_rotina(uuid, text, text, text, int)     to authenticated;
grant execute on function public.ativar_rotina(uuid, boolean)                   to authenticated;
grant execute on function public.desativar_rotina(uuid)                         to authenticated;
grant execute on function public.registrar_execucao(uuid, uuid, text, uuid, text) to authenticated;
grant execute on function public.listar_rotinas(text, boolean)                  to authenticated;
grant execute on function public.listar_rotinas_por_setor(text)                 to authenticated;
grant execute on function public.detalhe_rotina(uuid)                           to authenticated;
grant execute on function public.rotinas_resumo()                               to authenticated;

commit;

-- ============================================================
-- CONFERÊNCIA (no SQL Editor dá 42501 pois auth.uid() é NULL lá — guard funcionando):
--   select * from public.listar_rotinas();
--   select chave, habilitado from public.feature_flags where chave = 'rotinas_enabled';
--
-- ROLLBACK (desfazer só a 2.6):
-- drop function if exists public.rotinas_resumo();
-- drop function if exists public.detalhe_rotina(uuid);
-- drop function if exists public.listar_rotinas_por_setor(text);
-- drop function if exists public.listar_rotinas(text, boolean);
-- drop function if exists public.registrar_execucao(uuid, uuid, text, uuid, text);
-- drop function if exists public.desativar_rotina(uuid);
-- drop function if exists public.ativar_rotina(uuid, boolean);
-- drop function if exists public.editar_rotina(uuid, text, text, text, int);
-- drop function if exists public.criar_rotina(uuid, text, text, text, int);
-- drop table if exists public.rotinas_execucoes;
-- drop table if exists public.rotinas;
-- delete from public.feature_flags where chave = 'rotinas_enabled';
-- ============================================================
