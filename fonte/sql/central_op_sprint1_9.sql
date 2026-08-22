-- ============================================================
-- CENTRAL OPERACIONAL — SPRINT 1.9 (mensagens em tempo real na conversa)
-- Novas mensagens (texto/foto/áudio) aparecem sozinhas na conversa aberta, SEM refresh,
-- usando o Broadcast já existente (Sprint 1.1). PROIBIDO postgres_changes.
--
-- Duas mudanças mínimas e aditivas:
--   1) o broadcast passa a carregar ROTEAMENTO (topico/tipo/entidade) além do id — tudo
--      UUID opaco + tipo genérico (SEM setor). O evento é só um AVISO; o conteúdo real
--      continua vindo por RPC sob RLS. Isso evita um fetch por evento em todos os clientes.
--   2) RPC mensagens_por_ids p/ o cliente buscar SÓ a(s) mensagem(ns) nova(s), no MESMO
--      formato de mensagens_pagina (com anexos + transcrição), sob RLS/pode_ver_topico.
--
-- ADITIVO. Depende de sprint0..1_8. NÃO cria segunda assinatura Realtime. COMO USAR:
-- rodar no Supabase (STAGING). ROLLBACK no fim.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Broadcast com roteamento. Recria tg_eventos_broadcast (1.1) adicionando topico/tipo/ent.
--    'ent' = entity_id (p/ 'mensagem.criada' e 'audio.transcrito' é o id da mensagem).
--    Continua no canal público 'tenant:{id}:feed', best-effort (EXCEPTION), NUNCA aborta o insert.
--    Não vaza CONTEÚDO nem setor; só ids opacos + tipo. Acesso ao conteúdo = RLS na leitura.
-- ------------------------------------------------------------
create or replace function public.tg_eventos_broadcast()
returns trigger language plpgsql set search_path = public, realtime, extensions as $$
begin
  begin
    perform realtime.send(
      jsonb_build_object('id', new.id, 'topico', new.topico_id, 'tipo', new.tipo, 'ent', new.entity_id),
      'novo',
      'tenant:' || new.tenant_id::text || ':feed',
      false   -- canal público; o CONTEÚDO real vem por RPC (RLS). Broadcast = só aviso/roteamento.
    );
  exception when others then
    null;
  end;
  return new;
end $$;

drop trigger if exists trg_eventos_broadcast on public.eventos;
create trigger trg_eventos_broadcast
  after insert on public.eventos
  for each row execute function public.tg_eventos_broadcast();

-- ------------------------------------------------------------
-- 2) mensagens_por_ids — busca pontual das mensagens novas, MESMO formato de mensagens_pagina
--    (anexos jsonb + transcricao + transcricao_status). SECURITY INVOKER => a RLS de mensagens
--    (pode_ver_topico) filtra por linha: id de mensagem em tópico não autorizado NÃO retorna.
--    Não coloca Signed URL (o cliente gera na hora, com validade curta).
-- ------------------------------------------------------------
create or replace function public.mensagens_por_ids(p_ids uuid[])
returns table (
  id uuid, autor_id uuid, autor_nome text, corpo text, tipo_conteudo text,
  reply_para uuid, created_at timestamptz, anexos jsonb,
  transcricao text, transcricao_status text)
language plpgsql stable security invoker set search_path = public as $$
begin
  return query
    select m.id, m.autor_id, public.nome_de(m.autor_id) as autor_nome,
           m.corpo, m.tipo_conteudo, m.reply_para, m.created_at,
           coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', x.id, 'tipo', x.tipo, 'storage_path', x.storage_path,
                      'mime', x.mime, 'bytes', x.bytes, 'largura', x.largura,
                      'altura', x.altura, 'duracao_ms', x.duracao_ms
                    ) order by x.created_at)
             from public.anexo x where x.mensagem_id = m.id
           ), '[]'::jsonb) as anexos,
           m.transcricao, m.transcricao_status
    from public.mensagens m
    where m.id = any (coalesce(p_ids, '{}'::uuid[]))
      and m.removido_em is null
    order by m.created_at asc, m.id asc;   -- ordem canônica (o cliente posiciona por (created_at,id))
end $$;

revoke all on function public.mensagens_por_ids(uuid[]) from public;
grant execute on function public.mensagens_por_ids(uuid[]) to authenticated;

-- ============================================================
-- ROLLBACK (desfazer só a Sprint 1.9) — descomentar se precisar:
-- drop function if exists public.mensagens_por_ids(uuid[]);
-- -- restaurar tg_eventos_broadcast da Sprint 1.1 (payload só {id}):
-- --   create or replace function public.tg_eventos_broadcast() ... jsonb_build_object('id', new.id) ...
-- ============================================================
