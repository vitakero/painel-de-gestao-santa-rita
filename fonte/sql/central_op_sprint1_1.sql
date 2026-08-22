-- ============================================================
-- CENTRAL OPERACIONAL — SPRINT 1.1 (Feed Operacional, SÓ LEITURA)
-- Infra de leitura do Feed + broadcast em tempo real. ADITIVO e IDEMPOTENTE.
-- Depende de: central_op_sprint0.sql já executado.
-- NÃO cria tela; NÃO permite escrita pela UI; NÃO toca em nada existente.
--
-- NOTA (correção da Sprint 0 aplicada): a permissão do módulo é
-- pode_pagina('operacional'), NÃO 'central' — porque 'central' já é a
-- página da Central LOGÍSTICA. São módulos diferentes, permissões diferentes.
-- COMO USAR: rodar no Supabase (STAGING primeiro). ROLLBACK comentado no fim.
-- ============================================================

-- ------------------------------------------------------------
-- 1) RPC feed_pagina — paginação KEYSET por eventos.id (desc).
--    security INVOKER => a RLS de 'eventos' (tenant_id + pode_ver_topico) é
--    aplicada por linha automaticamente. Guard explícito de pode_pagina('operacional')
--    para dar erro claro a quem não tem acesso (em vez de lista vazia silenciosa).
--    Retorna SOMENTE os campos denormalizados do evento (sem joins).
-- ------------------------------------------------------------
create or replace function public.feed_pagina(p_cursor bigint default null, p_limite int default 30)
returns table (
  id          bigint,
  event_uuid  uuid,
  tipo        text,
  topico_id   uuid,
  entity_type text,
  entity_id   text,
  autor_id    uuid,
  setor       text,
  resumo      text,
  payload     jsonb,
  created_at  timestamptz
)
language plpgsql stable security invoker set search_path = public as $$
begin
  if not public.pode_pagina('operacional') then
    raise exception 'sem acesso a Central Operacional' using errcode = '42501';
  end if;
  return query
    select e.id, e.event_uuid, e.tipo, e.topico_id, e.entity_type, e.entity_id,
           e.autor_id, e.setor, e.resumo, e.payload, e.created_at
    from public.eventos e
    where e.tenant_id = public.current_tenant()
      and (p_cursor is null or e.id < p_cursor)     -- keyset: página anterior ao cursor
    order by e.id desc
    limit greatest(1, least(coalesce(p_limite, 30), 100));
end $$;

revoke all on function public.feed_pagina(bigint, int) from public;
grant execute on function public.feed_pagina(bigint, int) to authenticated;

-- ------------------------------------------------------------
-- 2) Broadcast do Feed em tempo real (Realtime BROADCAST — NÃO postgres_changes).
--    Trigger AFTER INSERT em 'eventos' publica um SINAL puro (só o id do evento) no
--    canal 'tenant:{id}:feed' via realtime.send. O conteúdo real do Feed SEMPRE vem
--    pela RPC feed_pagina (protegida por RLS) — o broadcast NÃO carrega nenhum dado
--    (nem setor/tipo), pra não vazar metadado num canal público a quem se inscrever.
--    Best-effort: se realtime.send falhar/não existir na versão do projeto, o bloco
--    EXCEPTION garante que a escrita do evento NUNCA é abortada por causa do broadcast.
-- ------------------------------------------------------------
create or replace function public.tg_eventos_broadcast()
returns trigger language plpgsql set search_path = public, realtime, extensions as $$
begin
  begin
    perform realtime.send(
      jsonb_build_object('id', new.id),   -- SÓ o id: sinal puro, sem dado sensível
      'novo',
      'tenant:' || new.tenant_id::text || ':feed',
      false   -- canal público; o conteúdo real vem por feed_pagina (RLS)
    );
  exception when others then
    null;     -- broadcast é opcional; o evento nunca pode falhar por causa dele
  end;
  return new;
end $$;

drop trigger if exists trg_eventos_broadcast on public.eventos;
create trigger trg_eventos_broadcast
  after insert on public.eventos
  for each row execute function public.tg_eventos_broadcast();

-- ============================================================
-- ROLLBACK (desfazer só a Sprint 1.1) — descomentar se precisar:
-- drop trigger if exists trg_eventos_broadcast on public.eventos;
-- drop function if exists public.tg_eventos_broadcast();
-- drop function if exists public.feed_pagina(bigint, int);
-- ============================================================
