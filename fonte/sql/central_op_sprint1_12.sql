-- ============================================================
-- CENTRAL OPERACIONAL — SPRINT 1.12 (reações às mensagens)
-- Reusa mensagem_reacoes (Sprint 0) + toggle_reacao (Sprint 0) — assinaturas INALTERADAS.
-- Só adiciona:
--   1) trigger de OUTBOX em mensagem_reacoes -> evento 'reacao.alterada' -> Broadcast (1.1/1.10);
--   2) helper reacoes_json(mid) e RPC de LEITURA reacoes_de(ids) p/ atualizar SÓ a mensagem;
--   3) mensagens_pagina e mensagens_por_ids passam a devolver 'reacoes' (contagem + se EU reagi);
--   4) feed_pagina passa a excluir 'reacao.alterada' (evento de bastidor, não polui o Feed).
--
-- ADITIVO. Depende de sprint0..1_11. NÃO cria tabela nova, NÃO cria RPC de ESCRITA nova
-- (escrita continua sendo toggle_reacao). Broadcast segue sendo SÓ aviso; conteúdo re-buscado
-- sob RLS. COMO USAR: rodar no Supabase (STAGING).
-- ============================================================

-- ------------------------------------------------------------
-- 0) toggle_reacao ENDURECIDA (assinatura INALTERADA — recriada da Sprint 0): só aceita os
--    emojis da paleta oficial. Sem isso, um insider gravaria "reação" com texto arbitrário/
--    gigante que apareceria como chip p/ todos (spam/spoof). Validação no SERVIDOR. Ampliar a
--    paleta no futuro = editar UMA lista aqui (e o array EMOJIS no cliente).
-- ------------------------------------------------------------
create or replace function public.toggle_reacao(p_mensagem_id uuid, p_emoji text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_topico uuid; v_tem boolean;
begin
  if p_emoji is null or p_emoji not in ('👍','❤️','😂','😮','👀','✅') then
    raise exception 'emoji de reacao invalido' using errcode = '22023';
  end if;
  select topico_id into v_topico from public.mensagens where id = p_mensagem_id;
  if v_topico is null or not public.pode_ver_topico(v_topico) then raise exception 'sem acesso' using errcode = '42501'; end if;
  select true into v_tem from public.mensagem_reacoes
    where mensagem_id = p_mensagem_id and usuario_id = auth.uid() and emoji = p_emoji;
  if v_tem then
    delete from public.mensagem_reacoes where mensagem_id = p_mensagem_id and usuario_id = auth.uid() and emoji = p_emoji;
    return false;
  else
    insert into public.mensagem_reacoes(tenant_id, mensagem_id, usuario_id, emoji)
    values (public.current_tenant(), p_mensagem_id, auth.uid(), p_emoji)
    on conflict do nothing;
    return true;
  end if;
end $$;

-- ------------------------------------------------------------
-- 1) OUTBOX das reações: toda inserção/remoção em mensagem_reacoes emite 'reacao.alterada'.
--    event_uuid ALEATÓRIO de propósito: cada toggle (add OU remove) é um aviso distinto, então
--    NÃO deve deduplicar (broadcast é só notificação; o cliente re-busca o estado autoritativo).
--    Roda no contexto do toggle_reacao (SECURITY DEFINER) => insere em eventos como owner.
-- ------------------------------------------------------------
create or replace function public.tg_reacoes_outbox()
returns trigger language plpgsql set search_path = public as $$
declare
  v_row    public.mensagem_reacoes := case when tg_op = 'DELETE' then old else new end;
  v_topico uuid;
begin
  select topico_id into v_topico from public.mensagens where id = v_row.mensagem_id;
  if v_topico is null then return v_row; end if;
  insert into public.eventos(event_uuid, tenant_id, tipo, topico_id, entity_type, entity_id, autor_id, payload)
  values (gen_random_uuid(), v_row.tenant_id, 'reacao.alterada', v_topico, 'mensagens', v_row.mensagem_id::text, v_row.usuario_id,
          jsonb_build_object('emoji', v_row.emoji, 'acao', case when tg_op = 'DELETE' then 'removeu' else 'adicionou' end))
  on conflict (tenant_id, event_uuid) do nothing;
  return v_row;
end $$;

drop trigger if exists trg_reacoes_outbox on public.mensagem_reacoes;
create trigger trg_reacoes_outbox
  after insert or delete on public.mensagem_reacoes
  for each row execute function public.tg_reacoes_outbox();

-- ------------------------------------------------------------
-- 2) helper reacoes_json(mid): agrega as reações de UMA mensagem como
--    [{emoji, qtd, eu}] (eu = se o usuário atual reagiu com aquele emoji), ordem = 1ª reação.
--    SECURITY INVOKER => RLS de mensagem_reacoes (reacoes_sel) + auth.uid() valem por chamador.
-- ------------------------------------------------------------
create or replace function public.reacoes_json(p_mid uuid)
returns jsonb language sql stable security invoker set search_path = public as $$
  select coalesce(
    jsonb_agg(jsonb_build_object('emoji', g.emoji, 'qtd', g.qtd, 'eu', g.eu) order by g.ordem, g.emoji),
    '[]'::jsonb)
  from (
    select r.emoji,
           count(*)::int as qtd,
           bool_or(r.usuario_id = auth.uid()) as eu,
           min(r.created_at) as ordem
    from public.mensagem_reacoes r
    where r.mensagem_id = p_mid
    group by r.emoji
  ) g;
$$;
revoke all on function public.reacoes_json(uuid) from public;
grant execute on function public.reacoes_json(uuid) to authenticated;

-- ------------------------------------------------------------
-- 3) reacoes_de(ids): leitura pontual das reações de N mensagens (p/ o tempo real atualizar
--    SÓ a(s) mensagem(ns) afetada(s), sem recarregar a conversa). SECURITY INVOKER + RLS.
-- ------------------------------------------------------------
create or replace function public.reacoes_de(p_ids uuid[])
returns table (mensagem_id uuid, reacoes jsonb)
language sql stable security invoker set search_path = public as $$
  select m.id as mensagem_id, public.reacoes_json(m.id) as reacoes
  from public.mensagens m
  where m.id = any (coalesce(p_ids, '{}'::uuid[]))
    and m.removido_em is null;
$$;
revoke all on function public.reacoes_de(uuid[]) from public;
grant execute on function public.reacoes_de(uuid[]) to authenticated;

-- ------------------------------------------------------------
-- 4) mensagens_pagina — recriada trazendo também 'reacoes' (versão da 1.11 + a coluna).
--    DROP obrigatório: adicionar coluna ao RETURNS TABLE muda o tipo de retorno (42P13).
-- ------------------------------------------------------------
drop function if exists public.mensagens_pagina(uuid, timestamptz, uuid, int);
create function public.mensagens_pagina(
  p_topico_id uuid, p_antes_ts timestamptz default null, p_antes_id uuid default null, p_limite int default 30)
returns table (
  id uuid, autor_id uuid, autor_nome text, corpo text, tipo_conteudo text,
  reply_para uuid, created_at timestamptz, anexos jsonb,
  transcricao text, transcricao_status text, mencoes uuid[], reacoes jsonb)
language plpgsql stable security invoker set search_path = public as $$
begin
  if not public.pode_ver_topico(p_topico_id) then
    raise exception 'sem acesso a este topico' using errcode = '42501';
  end if;
  return query
    select m.id, m.autor_id, public.nome_de(m.autor_id) as autor_nome,
           m.corpo, m.tipo_conteudo, m.reply_para, m.created_at,
           coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'tipo',x.tipo,'storage_path',x.storage_path,
                       'mime',x.mime,'bytes',x.bytes,'largura',x.largura,'altura',x.altura,'duracao_ms',x.duracao_ms)
                     order by x.created_at) from public.anexo x where x.mensagem_id = m.id), '[]'::jsonb) as anexos,
           m.transcricao, m.transcricao_status,
           coalesce((select array_agg(mm.mencionado_id) from public.mensagem_mencoes mm where mm.mensagem_id = m.id), '{}'::uuid[]) as mencoes,
           public.reacoes_json(m.id) as reacoes
    from public.mensagens m
    where m.topico_id = p_topico_id
      and m.removido_em is null
      and (p_antes_ts is null or (m.created_at, m.id) < (p_antes_ts, p_antes_id))
    order by m.created_at desc, m.id desc
    limit greatest(1, least(coalesce(p_limite, 30), 100));
end $$;
revoke all on function public.mensagens_pagina(uuid, timestamptz, uuid, int) from public;
grant execute on function public.mensagens_pagina(uuid, timestamptz, uuid, int) to authenticated;

-- ------------------------------------------------------------
-- 5) mensagens_por_ids — recriada trazendo também 'reacoes' (versão da 1.11 + a coluna).
-- ------------------------------------------------------------
drop function if exists public.mensagens_por_ids(uuid[]);
create function public.mensagens_por_ids(p_ids uuid[])
returns table (
  id uuid, autor_id uuid, autor_nome text, corpo text, tipo_conteudo text,
  reply_para uuid, created_at timestamptz, anexos jsonb,
  transcricao text, transcricao_status text, mencoes uuid[], reacoes jsonb)
language plpgsql stable security invoker set search_path = public as $$
begin
  return query
    select m.id, m.autor_id, public.nome_de(m.autor_id) as autor_nome,
           m.corpo, m.tipo_conteudo, m.reply_para, m.created_at,
           coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'tipo',x.tipo,'storage_path',x.storage_path,
                       'mime',x.mime,'bytes',x.bytes,'largura',x.largura,'altura',x.altura,'duracao_ms',x.duracao_ms)
                     order by x.created_at) from public.anexo x where x.mensagem_id = m.id), '[]'::jsonb) as anexos,
           m.transcricao, m.transcricao_status,
           coalesce((select array_agg(mm.mencionado_id) from public.mensagem_mencoes mm where mm.mensagem_id = m.id), '{}'::uuid[]) as mencoes,
           public.reacoes_json(m.id) as reacoes
    from public.mensagens m
    where m.id = any (coalesce(p_ids, '{}'::uuid[]))
      and m.removido_em is null
    order by m.created_at asc, m.id asc;
end $$;
revoke all on function public.mensagens_por_ids(uuid[]) from public;
grant execute on function public.mensagens_por_ids(uuid[]) to authenticated;

-- ------------------------------------------------------------
-- 6) feed_pagina — recriada (mesmo tipo de retorno => sem DROP) EXCLUINDO 'reacao.alterada'
--    do Feed (evento de bastidor, só broadcast — igual audio.transcrito/mencao.criada).
-- ------------------------------------------------------------
create or replace function public.feed_pagina(p_cursor bigint default null, p_limite int default 30)
returns table (
  id bigint, event_uuid uuid, tipo text, topico_id uuid, entity_type text, entity_id text,
  autor_id uuid, setor text, resumo text, payload jsonb, created_at timestamptz)
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
      and e.tipo not in ('audio.transcrito','mencao.criada','reacao.alterada')   -- eventos "de bastidor" (só broadcast)
      and (p_cursor is null or e.id < p_cursor)
    order by e.id desc
    limit greatest(1, least(coalesce(p_limite, 30), 100));
end $$;
revoke all on function public.feed_pagina(bigint, int) from public;
grant execute on function public.feed_pagina(bigint, int) to authenticated;

-- Índice PARCIAL que casa o filtro do feed_pagina: mantém a paginação do Feed rápida mesmo com
-- MUITO evento de bastidor (reação/transcrição/menção) em 'eventos' — o Feed indexa só o que ELE
-- mostra, então nunca vira "scan-and-discard". Predicado idêntico ao NOT IN da RPC.
create index if not exists ix_eventos_feed_visivel on public.eventos(tenant_id, id desc)
  where tipo not in ('audio.transcrito','mencao.criada','reacao.alterada');

-- ============================================================
-- ROLLBACK (desfazer só a Sprint 1.12) — descomentar se precisar:
-- drop trigger if exists trg_reacoes_outbox on public.mensagem_reacoes;
-- drop function if exists public.tg_reacoes_outbox();
-- drop function if exists public.reacoes_de(uuid[]);
-- drop function if exists public.reacoes_json(uuid);
-- -- restaurar mensagens_pagina/_por_ids (1.11, sem 'reacoes') e feed_pagina (1.8, sem excluir 'reacao.alterada').
-- ============================================================
