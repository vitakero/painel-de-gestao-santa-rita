-- ============================================================
-- CENTRAL OPERACIONAL — SPRINT 1.14 (HARDENING de banco)
-- SEM feature nova, SEM mudança de MODELO (nenhum create/alter table, nenhuma coluna).
-- Só: (A) índices que faltavam (as consultas mais quentes faziam SEQ SCAN — os índices
-- existentes têm tenant_id na frente e as subconsultas/keyset NÃO filtram tenant); (B)
-- endurecimento de 3 RPCs de leitura por array (teto de 100 ids); (C) marcar_lido
-- monotônico (não regride o cursor); (D) nao_lidas com teto de contagem (não varre o
-- histórico inteiro de tópico nunca lido); (E) nome_de com guard de página (fecha bypass
-- da RLS de perfis). Comportamento visível idêntico, com UMA exceção deliberada: o badge
-- de não-lidas de um tópico passa a ser capado em 100 (item D) — some o "137", vira "99+".
-- Assinaturas/retornos INALTERADOS.
--
-- ADITIVO E IDEMPOTENTE. Depende de sprint0..1_13. COMO USAR: rodar no Supabase.
-- ============================================================

-- ------------------------------------------------------------
-- (A) ÍNDICES — a parte crítica. CREATE INDEX é online-ish e idempotente.
-- ------------------------------------------------------------
-- 1) [CRÍTICO] mensagens por tópico + keyset. Serve mensagens_pagina (where topico_id=? order
--    by created_at desc,id desc) E o join de nao_lidas. Parcial casa o 'removido_em is null'
--    que os dois consumidores já filtram. SEM tenant_id na frente (as queries não filtram tenant).
create index if not exists ix_mensagens_topico_keyset
  on public.mensagens (topico_id, created_at desc, id desc)
  where removido_em is null;

-- 2) [ALTO] anexos por mensagem — a subconsulta de anexos rodava 1 seq scan POR MENSAGEM (30/página).
create index if not exists ix_anexo_mensagem_id
  on public.anexo (mensagem_id);

-- 3) [ALTO] reações por mensagem — reacoes_json roda 1x POR MENSAGEM (30/página) e toggle_reacao
--    a cada clique. Prefixo (mensagem_id) serve as leituras; a chave cheia serve o toggle exato.
create index if not exists ix_reacoes_mensagem_id
  on public.mensagem_reacoes (mensagem_id, usuario_id, emoji);

-- 4) [ALTO] anexo por storage_path — a policy central_op_select do Storage buscava o anexo por
--    storage_path SEM índice => seq scan a cada URL assinada gerada (abrir conversa com fotos).
create index if not exists ix_anexo_storage_path
  on public.anexo (storage_path);

-- 5) [MÉDIO] fila de transcrição — índice PARCIAL minúsculo p/ o worker não fazer full scan a
--    cada poll. Os 2 ramos do status implicam o predicado; poll de fila vazia vira probe.
create index if not exists ix_mensagens_fila_transcricao
  on public.mensagens (tenant_id, created_at)
  where tipo_conteudo = 'audio' and removido_em is null
        and transcricao_status in ('pendente','processando');

-- ------------------------------------------------------------
-- (C) marcar_lido MONOTÔNICO — só AVANÇA o cursor. Marcações fora de ordem (reconexão,
--     corrida de cliques) não regridem a leitura nem ressuscitam não-lidas. Assinatura igual.
-- ------------------------------------------------------------
create or replace function public.marcar_lido(p_topico_id uuid, p_ate_mensagem_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.pode_ver_topico(p_topico_id) then raise exception 'sem acesso a este topico' using errcode = '42501'; end if;
  insert into public.leituras(tenant_id, topico_id, usuario_id, ultima_lida_id, ultima_lida_em)
  values (public.current_tenant(), p_topico_id, auth.uid(), p_ate_mensagem_id, now())
  on conflict (tenant_id, topico_id, usuario_id)
  do update set ultima_lida_id = excluded.ultima_lida_id, ultima_lida_em = now()
  where leituras.ultima_lida_id is null                       -- nunca marcou: aceita
     or exists (                                              -- ou a nova é MAIS NOVA que o cursor atual (keyset)
       select 1 from public.mensagens m_new, public.mensagens m_old
       where m_new.id = excluded.ultima_lida_id
         and m_old.id = leituras.ultima_lida_id
         and (m_new.created_at, m_new.id) > (m_old.created_at, m_old.id)
     );
end $$;

-- ------------------------------------------------------------
-- (D) nao_lidas COM TETO — conta no máximo 100 por tópico (via LATERAL + limit). Um tópico
--     nunca lido com 50 mil mensagens parava de contar em 100 em vez de varrer tudo. O badge
--     de um canal com 100+ não-lidas mostra "100" (aceitável; ninguém deixa 100 sem ler num
--     chat operacional). Mesma assinatura/segurança (INVOKER + RLS).
-- ------------------------------------------------------------
create or replace function public.nao_lidas()
returns table (topico_id uuid, qtd int)
language sql stable security invoker set search_path = public as $$
  select t.id as topico_id, c.qtd
  from public.topico t
  cross join lateral (
    select count(*)::int as qtd
    from (
      select m.id
      from public.mensagens m
      left join public.leituras l  on l.topico_id = t.id and l.usuario_id = auth.uid()
      left join public.mensagens lm on lm.id = l.ultima_lida_id
      where m.topico_id = t.id
        and m.removido_em is null
        and m.tipo_conteudo <> 'sistema'
        and m.autor_id is distinct from auth.uid()
        and ( l.ultima_lida_id is null or (m.created_at, m.id) > (lm.created_at, lm.id) )
      limit 100
    ) s
  ) c
  where t.tenant_id = public.current_tenant()
    and c.qtd > 0;
$$;

-- ------------------------------------------------------------
-- (E) nome_de COM GUARD — era SECURITY DEFINER sem guard: qualquer authenticated podia ler o
--     nome de QUALQUER perfil (bypass da RLS de perfis). Agora exige a página 'operacional'
--     (ou master). Os chamadores legítimos (mensagens_pagina/_por_ids) já passam por
--     pode_ver_topico => não quebra nada. Retorno idêntico.
-- ------------------------------------------------------------
create or replace function public.nome_de(p_id uuid)
returns text language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.pode_pagina('operacional') or public.sou_master()) then
    raise exception 'sem acesso' using errcode = '42501';
  end if;
  return (select p.nome from public.perfis p where p.id = p_id);
end $$;

-- ------------------------------------------------------------
-- (B) TETO DE 100 ids nas RPCs de leitura por array (defesa contra chamada abusiva com
--     milhares de ids). O cliente nunca manda mais que ~30. Assinaturas/retornos inalterados.
-- ------------------------------------------------------------
-- transcricoes: slice p/ no máximo 100 ids.
create or replace function public.transcricoes(p_ids uuid[])
returns table (id uuid, transcricao_status text, transcricao text)
language sql stable security invoker set search_path = public as $$
  select m.id, m.transcricao_status, m.transcricao
  from public.mensagens m
  where m.id = any (coalesce(p_ids[1:100], '{}'::uuid[]))
    and m.tipo_conteudo = 'audio'
    and m.removido_em is null;
$$;

-- reacoes_de: slice p/ no máximo 100 ids.
create or replace function public.reacoes_de(p_ids uuid[])
returns table (mensagem_id uuid, reacoes jsonb)
language sql stable security invoker set search_path = public as $$
  select m.id as mensagem_id, public.reacoes_json(m.id) as reacoes
  from public.mensagens m
  where m.id = any (coalesce(p_ids[1:100], '{}'::uuid[]))
    and m.removido_em is null;
$$;

-- mensagens_por_ids: guard explícito (plpgsql). Mesmo corpo da 1.12 + só o teto no topo.
--    Retorno INALTERADO => create or replace (sem drop).
create or replace function public.mensagens_por_ids(p_ids uuid[])
returns table (
  id uuid, autor_id uuid, autor_nome text, corpo text, tipo_conteudo text,
  reply_para uuid, created_at timestamptz, anexos jsonb,
  transcricao text, transcricao_status text, mencoes uuid[], reacoes jsonb)
language plpgsql stable security invoker set search_path = public as $$
begin
  if array_length(p_ids, 1) > 100 then
    raise exception 'no maximo 100 ids por chamada' using errcode = '22023';
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
    where m.id = any (coalesce(p_ids, '{}'::uuid[]))
      and m.removido_em is null
    order by m.created_at asc, m.id asc;
end $$;

-- ============================================================
-- ROLLBACK (desfazer só a Sprint 1.14) — descomentar se precisar:
-- drop index if exists public.ix_mensagens_topico_keyset;
-- drop index if exists public.ix_anexo_mensagem_id;
-- drop index if exists public.ix_reacoes_mensagem_id;
-- drop index if exists public.ix_anexo_storage_path;
-- drop index if exists public.ix_mensagens_fila_transcricao;
-- -- e restaurar marcar_lido (sprint0), nao_lidas (1.10), nome_de (1.2),
-- -- transcricoes (1.8), reacoes_de/mensagens_por_ids (1.12) das versões anteriores.
-- ============================================================
