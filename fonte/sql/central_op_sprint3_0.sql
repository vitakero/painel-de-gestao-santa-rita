-- ============================================================
-- CENTRAL OPERACIONAL — SPRINT 3.0 (SOLICITAÇÕES & APROVAÇÕES) — ÚLTIMA SPRINT DA V1
--
-- Fluxo PEDIDO→DECISÃO (NÃO é work item / NÃO é tarefa→execução): um funcionário abre uma
-- solicitação (folga/compra/adiantamento/manutenção/reposição/outro), acompanha o status; um
-- APROVADOR decide (aprova / nega com motivo). Autor pode cancelar enquanto pendente.
--
-- APROVADOR: o schema real NÃO tem conceito de gerente — o único papel elevado é perfis.is_master.
--   => nesta sprint SÓ sou_master() aprova/nega (pode_pagina('operacional') NÃO vira poder de aprovar).
-- AUTOAPROVAÇÃO: proibida (autor_id <> decidida_por), no CHECK da tabela E em cada RPC.
-- CONCORRÊNCIA: aprovar/negar/cancelar travam a linha (SELECT ... FOR UPDATE) e validam o status
--   SOB O LOCK => só UMA decisão vence; o 2º recebe erro de domínio amigável.
-- PRIVACIDADE: os eventos NÃO carregam descrição/valor/comentário (só ids/enum); o Broadcast já só
--   manda {id,topico,tipo,ent,autor}; solicitações NÃO aparecem no Feed global (feed_pagina exclui
--   solicitacao.*). Conteúdo é relido por RPC sob RLS.
-- IDEMPOTÊNCIA: criar por índice único parcial (tenant, request_id); decidir/cancelar por status
--   sob lock (retry do MESMO ator no MESMO estado terminal devolve idempotente).
-- MEU DIA: ganha "Solicitações para aprovar" (só para aprovador, só com a flag on) — derivado direto
--   das pendentes, sem tabela de notificação. meu_dia_resumo muda de RETURNS TABLE => DROP+recreate (42P13).
-- ESCRITA só por RPC SECURITY DEFINER idempotente; LEITURA por RPC SECURITY INVOKER sob RLS.
-- NÃO cria Work Item ao aprovar (integração futura, fora da 3.0). ADITIVO, idempotente, uma transação.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1) flag solicitacoes_enabled (off).
-- ------------------------------------------------------------
insert into public.feature_flags(tenant_id, chave, habilitado)
values (public.current_tenant(), 'solicitacoes_enabled', false)
on conflict (tenant_id, chave) do nothing;

-- ------------------------------------------------------------
-- 2) TABELA solicitacoes (domínio próprio — pedido com decisão). numeric(14,2) = padrão do projeto.
-- ------------------------------------------------------------
create table if not exists public.solicitacoes (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null default public.current_tenant(),
  autor_id           uuid not null,
  tipo               text not null check (tipo in ('folga','compra_insumo','adiantamento','manutencao','reposicao_urgente','outro')),
  titulo             text not null,
  descricao          text,
  valor              numeric(14,2) check (valor is null or valor >= 0),
  status             text not null default 'pendente' check (status in ('pendente','aprovada','negada','cancelada')),
  decidida_por       uuid,
  decidida_em        timestamptz,
  decisao_comentario text,
  cancelada_em       timestamptz,
  request_id         uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint solic_sem_autoaprovacao check (decidida_por is null or decidida_por <> autor_id)
);

create unique index if not exists ux_solic_request  on public.solicitacoes(tenant_id, request_id) where request_id is not null;
create index        if not exists ix_solic_autor    on public.solicitacoes(tenant_id, autor_id, created_at desc);
create index        if not exists ix_solic_pendente on public.solicitacoes(tenant_id, created_at)  where status = 'pendente';

alter table public.solicitacoes enable row level security;
-- autor vê as próprias; master (= aprovador) vê todas (precisa pra fila). Sem policy de escrita => só RPC DEFINER.
drop policy if exists solic_sel on public.solicitacoes;
create policy solic_sel on public.solicitacoes for select to authenticated
  using (tenant_id = public.current_tenant() and (autor_id = auth.uid() or public.sou_master()));

grant select on public.solicitacoes to authenticated;

-- ------------------------------------------------------------
-- 3) helper: a feature está ligada? (DEFINER — lê a flag; usado pelos RPCs de escrita e pelo Meu Dia)
-- ------------------------------------------------------------
create or replace function public.solicitacoes_ligada()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select f.habilitado from public.feature_flags f
                   where f.tenant_id = public.current_tenant() and f.chave = 'solicitacoes_enabled'), false);
$$;
revoke all on function public.solicitacoes_ligada() from public;
grant execute on function public.solicitacoes_ligada() to authenticated;

-- ------------------------------------------------------------
-- 4) RPC ESCRITA — criar_solicitacao (operacional OU master; idempotente por request_id).
-- ------------------------------------------------------------
create or replace function public.criar_solicitacao(
  p_request_id uuid, p_tipo text, p_titulo text,
  p_descricao text default null, p_valor numeric default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant();
  v_uid uuid := auth.uid();
  v_id uuid; v_tit text := btrim(coalesce(p_titulo, ''));
begin
  if not (public.pode_pagina('operacional') or public.sou_master()) then
    raise exception 'sem acesso' using errcode = '42501'; end if;
  if not public.solicitacoes_ligada() then raise exception 'solicitacoes desabilitado' using errcode = '42501'; end if;
  if p_request_id is null then raise exception 'request_id obrigatorio' using errcode = '22023'; end if;
  if p_tipo not in ('folga','compra_insumo','adiantamento','manutencao','reposicao_urgente','outro') then
    raise exception 'tipo invalido' using errcode = '22023'; end if;
  if v_tit = '' then raise exception 'titulo obrigatorio' using errcode = '22023'; end if;
  if length(v_tit) > 200 then raise exception 'titulo muito longo' using errcode = '22023'; end if;
  if p_descricao is not null and length(p_descricao) > 2000 then raise exception 'descricao muito longa' using errcode = '22023'; end if;
  if p_valor is not null and p_valor < 0 then raise exception 'valor invalido' using errcode = '22023'; end if;

  insert into public.solicitacoes(tenant_id, autor_id, tipo, titulo, descricao, valor, status, request_id)
  values (v_tenant, v_uid, p_tipo, v_tit, nullif(btrim(coalesce(p_descricao, '')), ''), p_valor, 'pendente', p_request_id)
  on conflict (tenant_id, request_id) where request_id is not null do nothing   -- índice PARCIAL exige o predicado
  returning id into v_id;

  if v_id is null then   -- retry idempotente: devolve a existente, sem re-emitir evento
    select id into v_id from public.solicitacoes where tenant_id = v_tenant and request_id = p_request_id;
    return v_id;
  end if;

  -- evento (o trigger existente faz o Broadcast). SEM conteúdo sensível (só ids/enum).
  insert into public.eventos(event_uuid, tenant_id, tipo, entity_type, entity_id, autor_id, payload)
  values (md5(v_tenant::text || '|solicitacao.criada|' || v_id::text)::uuid,
          v_tenant, 'solicitacao.criada', 'solicitacoes', v_id::text, v_uid,
          jsonb_build_object('solicitacao_id', v_id, 'tipo', p_tipo, 'autor_id', v_uid, 'status', 'pendente', 'actor_id', v_uid))
  on conflict (tenant_id, event_uuid) do nothing;

  return v_id;
end $$;

-- ------------------------------------------------------------
-- 5) RPC ESCRITA — cancelar_solicitacao (SÓ o autor, SÓ pendente). Idempotente.
-- ------------------------------------------------------------
create or replace function public.cancelar_solicitacao(p_request_id uuid, p_solicitacao_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant();
  v_uid uuid := auth.uid();
  v_row public.solicitacoes;
begin
  if not (public.pode_pagina('operacional') or public.sou_master()) then
    raise exception 'sem acesso' using errcode = '42501'; end if;
  if not public.solicitacoes_ligada() then raise exception 'solicitacoes desabilitado' using errcode = '42501'; end if;
  select * into v_row from public.solicitacoes where id = p_solicitacao_id and tenant_id = v_tenant for update;
  -- (3.0-review) colapsa "inexistente" e "de outro autor" no MESMO erro => não vira oráculo de existência p/ não-autor
  if not found or v_row.autor_id <> v_uid then raise exception 'solicitacao nao encontrada' using errcode = 'P0002'; end if;
  if v_row.status = 'cancelada' then return v_row.id; end if;   -- idempotente
  if v_row.status <> 'pendente' then raise exception 'Esta solicitacao ja foi decidida por outra pessoa.' using errcode = 'P0001'; end if;
  update public.solicitacoes set status = 'cancelada', cancelada_em = now(), updated_at = now()
   where id = p_solicitacao_id and tenant_id = v_tenant;
  insert into public.eventos(event_uuid, tenant_id, tipo, entity_type, entity_id, autor_id, payload)
  values (md5(v_tenant::text || '|solicitacao.cancelada|' || v_row.id::text)::uuid,
          v_tenant, 'solicitacao.cancelada', 'solicitacoes', v_row.id::text, v_uid,
          jsonb_build_object('solicitacao_id', v_row.id, 'tipo', v_row.tipo, 'autor_id', v_row.autor_id, 'status', 'cancelada', 'actor_id', v_uid))
  on conflict (tenant_id, event_uuid) do nothing;
  return v_row.id;
end $$;

-- ------------------------------------------------------------
-- 6) RPC ESCRITA — aprovar_solicitacao (SÓ master, NÃO o autor, SÓ pendente, sob lock).
-- ------------------------------------------------------------
create or replace function public.aprovar_solicitacao(
  p_request_id uuid, p_solicitacao_id uuid, p_comentario text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant();
  v_uid uuid := auth.uid();
  v_row public.solicitacoes;
begin
  if not public.sou_master() then raise exception 'sem acesso' using errcode = '42501'; end if;
  if not public.solicitacoes_ligada() then raise exception 'solicitacoes desabilitado' using errcode = '42501'; end if;
  select * into v_row from public.solicitacoes where id = p_solicitacao_id and tenant_id = v_tenant for update;
  if not found then raise exception 'solicitacao nao encontrada' using errcode = 'P0002'; end if;
  if v_row.autor_id = v_uid then raise exception 'nao pode decidir a propria solicitacao' using errcode = '42501'; end if;
  if v_row.status = 'aprovada' and v_row.decidida_por = v_uid then return v_row.id; end if;   -- retry idempotente do MESMO ator
  if v_row.status <> 'pendente' then raise exception 'Esta solicitacao ja foi decidida por outra pessoa.' using errcode = 'P0001'; end if;
  update public.solicitacoes
     set status = 'aprovada', decidida_por = v_uid, decidida_em = now(),
         decisao_comentario = nullif(btrim(coalesce(p_comentario, '')), ''), updated_at = now()
   where id = p_solicitacao_id and tenant_id = v_tenant;
  insert into public.eventos(event_uuid, tenant_id, tipo, entity_type, entity_id, autor_id, payload)
  values (md5(v_tenant::text || '|solicitacao.aprovada|' || v_row.id::text)::uuid,
          v_tenant, 'solicitacao.aprovada', 'solicitacoes', v_row.id::text, v_uid,
          jsonb_build_object('solicitacao_id', v_row.id, 'tipo', v_row.tipo, 'autor_id', v_row.autor_id, 'status', 'aprovada', 'actor_id', v_uid))
  on conflict (tenant_id, event_uuid) do nothing;
  return v_row.id;
end $$;

-- ------------------------------------------------------------
-- 7) RPC ESCRITA — negar_solicitacao (igual aprovar, MOTIVO obrigatório).
-- ------------------------------------------------------------
create or replace function public.negar_solicitacao(
  p_request_id uuid, p_solicitacao_id uuid, p_comentario text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant();
  v_uid uuid := auth.uid();
  v_row public.solicitacoes;
  v_mot text := nullif(btrim(coalesce(p_comentario, '')), '');
begin
  if not public.sou_master() then raise exception 'sem acesso' using errcode = '42501'; end if;
  if not public.solicitacoes_ligada() then raise exception 'solicitacoes desabilitado' using errcode = '42501'; end if;
  if v_mot is null then raise exception 'motivo obrigatorio' using errcode = '22023'; end if;
  select * into v_row from public.solicitacoes where id = p_solicitacao_id and tenant_id = v_tenant for update;
  if not found then raise exception 'solicitacao nao encontrada' using errcode = 'P0002'; end if;
  if v_row.autor_id = v_uid then raise exception 'nao pode decidir a propria solicitacao' using errcode = '42501'; end if;
  if v_row.status = 'negada' and v_row.decidida_por = v_uid then return v_row.id; end if;   -- retry idempotente do MESMO ator
  if v_row.status <> 'pendente' then raise exception 'Esta solicitacao ja foi decidida por outra pessoa.' using errcode = 'P0001'; end if;
  update public.solicitacoes
     set status = 'negada', decidida_por = v_uid, decidida_em = now(),
         decisao_comentario = v_mot, updated_at = now()
   where id = p_solicitacao_id and tenant_id = v_tenant;
  insert into public.eventos(event_uuid, tenant_id, tipo, entity_type, entity_id, autor_id, payload)
  values (md5(v_tenant::text || '|solicitacao.negada|' || v_row.id::text)::uuid,
          v_tenant, 'solicitacao.negada', 'solicitacoes', v_row.id::text, v_uid,
          jsonb_build_object('solicitacao_id', v_row.id, 'tipo', v_row.tipo, 'autor_id', v_row.autor_id, 'status', 'negada', 'actor_id', v_uid))
  on conflict (tenant_id, event_uuid) do nothing;
  return v_row.id;
end $$;

-- ------------------------------------------------------------
-- 8) RPC LEITURA — solicitacoes_minhas (INVOKER, sob RLS: só as do usuário).
-- ------------------------------------------------------------
create or replace function public.solicitacoes_minhas(
  p_status text default null, p_tipo text default null, p_limit int default 50, p_offset int default 0)
returns table (
  id uuid, tipo text, titulo text, descricao text, valor numeric, status text,
  created_at timestamptz, updated_at timestamptz, decidida_em timestamptz,
  decidida_por_nome text, decisao_comentario text, cancelada_em timestamptz, total_count bigint)
language plpgsql stable security invoker set search_path = public as $$
declare
  v_lim int := greatest(1, least(coalesce(p_limit, 50), 100));
  v_off int := greatest(0, coalesce(p_offset, 0));
begin
  if not (public.pode_pagina('operacional') or public.sou_master()) then
    raise exception 'sem acesso' using errcode = '42501'; end if;
  return query
    select s.id, s.tipo, s.titulo, s.descricao, s.valor, s.status,
           s.created_at, s.updated_at, s.decidida_em,
           public.nome_de(s.decidida_por), s.decisao_comentario, s.cancelada_em,
           count(*) over () as total_count
      from public.solicitacoes s
     where s.tenant_id = public.current_tenant()
       and s.autor_id = auth.uid()
       and (p_status is null or s.status = p_status)
       and (p_tipo is null or s.tipo = p_tipo)
     order by s.created_at desc, s.id desc
     limit v_lim offset v_off;
end $$;

-- ------------------------------------------------------------
-- 9) RPC LEITURA — solicitacoes_pendentes_aprovacao (SÓ aprovador=master; fila FIFO; exclui as próprias).
-- ------------------------------------------------------------
create or replace function public.solicitacoes_pendentes_aprovacao(
  p_tipo text default null, p_busca text default null, p_limit int default 50, p_offset int default 0)
returns table (
  id uuid, tipo text, titulo text, descricao text, valor numeric,
  autor_id uuid, autor_nome text, created_at timestamptz, total_count bigint)
language plpgsql stable security invoker set search_path = public, extensions as $$
declare
  v_lim int := greatest(1, least(coalesce(p_limit, 50), 100));
  v_off int := greatest(0, coalesce(p_offset, 0));
  v_q text := nullif(btrim(coalesce(p_busca, '')), '');
begin
  if not public.sou_master() then raise exception 'sem acesso' using errcode = '42501'; end if;
  return query
    select s.id, s.tipo, s.titulo, s.descricao, s.valor,
           s.autor_id, public.nome_de(s.autor_id), s.created_at,
           count(*) over () as total_count
      from public.solicitacoes s
     where s.tenant_id = public.current_tenant()
       and s.status = 'pendente'
       and s.autor_id <> auth.uid()                 -- não decide a própria
       and (p_tipo is null or s.tipo = p_tipo)
       and (v_q is null or unaccent(s.titulo) ilike unaccent('%' || v_q || '%')
                        or unaccent(coalesce(s.descricao, '')) ilike unaccent('%' || v_q || '%'))
     order by s.created_at asc, s.id asc            -- quem espera há mais tempo primeiro
     limit v_lim offset v_off;
end $$;

-- ------------------------------------------------------------
-- 10) RPC LEITURA — solicitacao_detalhe (INVOKER, sob RLS).
-- ------------------------------------------------------------
create or replace function public.solicitacao_detalhe(p_solicitacao_id uuid)
returns table (
  id uuid, tipo text, titulo text, descricao text, valor numeric, status text,
  autor_id uuid, autor_nome text, created_at timestamptz, updated_at timestamptz,
  decidida_por uuid, decidida_por_nome text, decidida_em timestamptz,
  decisao_comentario text, cancelada_em timestamptz)
language plpgsql stable security invoker set search_path = public as $$
begin
  if not (public.pode_pagina('operacional') or public.sou_master()) then
    raise exception 'sem acesso' using errcode = '42501'; end if;
  return query
    select s.id, s.tipo, s.titulo, s.descricao, s.valor, s.status,
           s.autor_id, public.nome_de(s.autor_id), s.created_at, s.updated_at,
           s.decidida_por, public.nome_de(s.decidida_por), s.decidida_em,
           s.decisao_comentario, s.cancelada_em
      from public.solicitacoes s
     where s.id = p_solicitacao_id and s.tenant_id = public.current_tenant();
end $$;

-- ------------------------------------------------------------
-- 11) FEED: excluir solicitacao.* do Feed global (privacidade). Índice parcial v3 + feed_pagina.
--     (create index if not exists com MESMO nome e predicado novo é no-op silencioso => índice v3.)
-- ------------------------------------------------------------
create index if not exists ix_eventos_feed_visivel_v3
  on public.eventos(tenant_id, id desc)
  where tipo not in ('audio.transcrito','mencao.criada','reacao.alterada',
                     'work_item.vinculo_adicionado','work_item.vinculo_removido',
                     'solicitacao.criada','solicitacao.aprovada','solicitacao.negada','solicitacao.cancelada');

create or replace function public.feed_pagina(p_cursor bigint default null, p_limite int default 30)
returns table (id bigint, event_uuid uuid, tipo text, topico_id uuid, entity_type text, entity_id text,
               autor_id uuid, setor text, resumo text, payload jsonb, created_at timestamptz)
language plpgsql stable security invoker set search_path = public as $$
begin
  if not (public.pode_pagina('operacional') or public.sou_master()) then
    raise exception 'sem acesso' using errcode = '42501';
  end if;
  return query
    select e.id, e.event_uuid, e.tipo, e.topico_id, e.entity_type, e.entity_id, e.autor_id, e.setor,
           e.resumo, e.payload, e.created_at
      from public.eventos e
     where e.tenant_id = public.current_tenant()
       -- TEXTUALMENTE idêntico ao predicado do índice v3 (senão o parcial não casa)
       and e.tipo not in ('audio.transcrito','mencao.criada','reacao.alterada',
                          'work_item.vinculo_adicionado','work_item.vinculo_removido',
                          'solicitacao.criada','solicitacao.aprovada','solicitacao.negada','solicitacao.cancelada')
       and (p_cursor is null or e.id < p_cursor)
     order by e.id desc
     limit greatest(1, least(coalesce(p_limite, 30), 100));
end $$;

drop index if exists public.ix_eventos_feed_visivel_v2;   -- substituído pelo v3

-- (3.0-review, ALTO) FECHA o canal lateral: a policy eventos_sel liberava evento com topico_id NULL
-- p/ QUALQUER um com pode_pagina('operacional'); como os eventos de solicitação têm topico_id NULL e
-- payload {tipo,autor_id,...}, um colega NÃO-master leria "quem pediu o quê" direto na tabela eventos,
-- furando a RLS de solicitacoes. Recria a policy: eventos de 'solicitacoes' => SÓ master (alinhado com
-- solic_sel); TODOS os demais tipos seguem EXATAMENTE a regra anterior (sem regressão).
drop policy if exists eventos_sel on public.eventos;
create policy eventos_sel on public.eventos for select to authenticated
  using ( tenant_id = public.current_tenant()
          and case
                when entity_type = 'solicitacoes' then public.sou_master()
                else ( public.pode_ver_topico(topico_id)
                       or (topico_id is null and public.pode_pagina('operacional')) )
              end );

-- ------------------------------------------------------------
-- 12) MEU DIA: adiciona total_solicitacoes_aprovar. Mudar RETURNS TABLE exige DROP antes (42P13).
--     total_pendencias passa a somar as aprovações (só p/ aprovador; atrasadas seguem ⊆ ativas).
-- ------------------------------------------------------------
drop function if exists public.meu_dia_resumo();
create or replace function public.meu_dia_resumo()
returns table (
  total_mencoes bigint, total_work_items_ativos bigint, total_atrasados bigint,
  total_rotinas_pendentes bigint, total_solicitacoes_aprovar bigint,
  total_pendencias bigint, meu_setor text)
language plpgsql stable security invoker set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_tenant uuid := public.current_tenant();
  v_hoje   date := (now() at time zone 'America/Fortaleza')::date;
  v_ini    timestamptz := (v_hoje)::timestamp at time zone 'America/Fortaleza';
  v_fim    timestamptz := (v_hoje + 1)::timestamp at time zone 'America/Fortaleza';
  v_setor  text;
  v_menc bigint; v_ativos bigint; v_atras bigint; v_rot bigint; v_sol bigint := null;
begin
  if not (public.pode_pagina('operacional') or public.sou_master()) then
    raise exception 'sem acesso' using errcode = '42501'; end if;

  select nullif(btrim(coalesce(pf.setor, '')), '') into v_setor from public.perfis pf where pf.id = v_uid;

  select count(*) into v_menc
    from public.mensagem_mencoes mm
    join public.mensagens m       on m.id = mm.mensagem_id
    left join public.leituras l   on l.topico_id = m.topico_id and l.usuario_id = v_uid
    left join public.mensagens lm on lm.id = l.ultima_lida_id
   where mm.tenant_id = v_tenant and mm.mencionado_id = v_uid
     and m.removido_em is null and m.tipo_conteudo <> 'sistema' and m.autor_id is distinct from v_uid
     and ( l.ultima_lida_id is null or (m.created_at, m.id) > (lm.created_at, lm.id) );

  select count(*) into v_ativos
    from public.work_items w
   where w.tenant_id = v_tenant and w.responsavel_id = v_uid
     and w.status in ('aberto','em_andamento','bloqueado');

  select count(*) into v_atras
    from public.work_items w
   where w.tenant_id = v_tenant and w.responsavel_id = v_uid
     and w.prazo_em is not null and w.status not in ('concluido','cancelado') and w.prazo_em < now();

  if v_setor is null then
    v_rot := 0;
  else
    select count(*) into v_rot from (
      select coalesce(ex.st, 'pendente') as st
        from public.rotinas r
        left join lateral (
            select e.status as st from public.rotinas_execucoes e
             where e.rotina_id = r.id and e.tenant_id = v_tenant and e.created_at >= v_ini and e.created_at < v_fim
             order by case e.status when 'concluido' then 0 when 'em_andamento' then 1 when 'cancelado' then 3 else 2 end asc,
                      e.created_at desc limit 1
        ) ex on true
       where r.tenant_id = v_tenant and r.ativo and btrim(lower(coalesce(r.setor, ''))) = btrim(lower(v_setor))
    ) s where s.st in ('pendente','em_andamento');
  end if;

  -- só aprovador (master) e só com a feature ligada: contagem da fila (exclui as próprias)
  if public.sou_master() and public.solicitacoes_ligada() then
    select count(*) into v_sol from public.solicitacoes s
     where s.tenant_id = v_tenant and s.status = 'pendente' and s.autor_id <> v_uid;
  end if;

  return query select v_menc, v_ativos, v_atras, v_rot, v_sol,
                      (v_menc + v_ativos + v_rot + coalesce(v_sol, 0)),   -- badge (atrasadas ⊆ ativas)
                      v_setor;
end $$;

-- ------------------------------------------------------------
-- 13) GRANTS
-- ------------------------------------------------------------
revoke all on function public.criar_solicitacao(uuid, text, text, text, numeric)        from public;
revoke all on function public.cancelar_solicitacao(uuid, uuid)                           from public;
revoke all on function public.aprovar_solicitacao(uuid, uuid, text)                      from public;
revoke all on function public.negar_solicitacao(uuid, uuid, text)                        from public;
revoke all on function public.solicitacoes_minhas(text, text, int, int)                  from public;
revoke all on function public.solicitacoes_pendentes_aprovacao(text, text, int, int)     from public;
revoke all on function public.solicitacao_detalhe(uuid)                                  from public;
grant execute on function public.criar_solicitacao(uuid, text, text, text, numeric)      to authenticated;
grant execute on function public.cancelar_solicitacao(uuid, uuid)                        to authenticated;
grant execute on function public.aprovar_solicitacao(uuid, uuid, text)                   to authenticated;
grant execute on function public.negar_solicitacao(uuid, uuid, text)                     to authenticated;
grant execute on function public.solicitacoes_minhas(text, text, int, int)               to authenticated;
grant execute on function public.solicitacoes_pendentes_aprovacao(text, text, int, int)  to authenticated;
grant execute on function public.solicitacao_detalhe(uuid)                               to authenticated;
grant execute on function public.meu_dia_resumo()                                        to authenticated;

commit;

-- ============================================================
-- CONFERÊNCIA (no SQL Editor dá 42501 pois auth.uid() é NULL — guard funcionando):
--   select * from public.solicitacoes_minhas();
--   select * from public.solicitacoes_pendentes_aprovacao();
--   select chave, habilitado from public.feature_flags where chave = 'solicitacoes_enabled';
--   select * from public.meu_dia_resumo();   -- agora com total_solicitacoes_aprovar
--
-- ROLLBACK (desfazer só a 3.0) — descomentar:
-- drop function if exists public.criar_solicitacao(uuid, text, text, text, numeric);
-- drop function if exists public.cancelar_solicitacao(uuid, uuid);
-- drop function if exists public.aprovar_solicitacao(uuid, uuid, text);
-- drop function if exists public.negar_solicitacao(uuid, uuid, text);
-- drop function if exists public.solicitacoes_minhas(text, text, int, int);
-- drop function if exists public.solicitacoes_pendentes_aprovacao(text, text, int, int);
-- drop function if exists public.solicitacao_detalhe(uuid);
-- drop function if exists public.solicitacoes_ligada();
-- drop table if exists public.solicitacoes;
-- delete from public.feature_flags where chave = 'solicitacoes_enabled';
-- (meu_dia_resumo e feed_pagina voltariam à versão 2.9/2.0 — restaurar daqueles arquivos se precisar.)
-- ============================================================
