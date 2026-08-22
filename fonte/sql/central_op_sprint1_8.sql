-- ============================================================
-- CENTRAL OPERACIONAL — SPRINT 1.8 (transcrição ASSÍNCRONA do áudio)
-- O áudio já aparece na hora (postar_mensagem, 1.7). A transcrição acontece DEPOIS,
-- num worker server-side (com a chave de IA), que:
--   1) reivindica um áudio pendente  -> proxima_transcricao()   [service_role]
--   2) baixa o objeto, chama a IA
--   3) grava o resultado             -> marcar_transcricao()     [service_role]
-- A conclusão dispara evento 'audio.transcrito' (outbox) -> Broadcast Realtime (já existe)
-- -> o cliente atualiza SÓ aquela mensagem (sem recarregar a conversa).
--
-- ADITIVO. Depende de sprint0..1_7 já executados. NÃO altera a assinatura de postar_mensagem.
-- NÃO implementa a IA aqui (worker é à parte). COMO USAR: rodar no Supabase (STAGING). ROLLBACK no fim.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Colunas/estados. transcricao (texto do resultado, separado do corpo do usuário) +
--    estados pendente/processando/concluido/erro (substitui o check antigo ok/falha).
-- ------------------------------------------------------------
alter table public.mensagens add column if not exists transcricao text;
alter table public.mensagens add column if not exists transcricao_em timestamptz;  -- quando entrou em 'processando' (watchdog)

-- normaliza QUALQUER valor legado ('ok'/'falha') ANTES de trocar o check, senão o ADD
-- CONSTRAINT validaria os dados e abortaria a migração. (Idempotente; nada grava esses hoje.)
update public.mensagens
   set transcricao_status = case transcricao_status when 'ok' then 'concluido' when 'falha' then 'erro' else transcricao_status end
 where transcricao_status in ('ok','falha');

alter table public.mensagens drop constraint if exists mensagens_transcricao_status_check;
alter table public.mensagens add  constraint mensagens_transcricao_status_check
  check (transcricao_status is null or transcricao_status in ('pendente','processando','concluido','erro'));

-- ------------------------------------------------------------
-- 2) Ao inserir uma mensagem de áudio, entra como 'pendente' (sem tocar em postar_mensagem).
--    BEFORE INSERT: se for áudio e vier sem status, marca pendente.
-- ------------------------------------------------------------
create or replace function public.tg_mensagens_transcricao_init()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.tipo_conteudo = 'audio' and new.transcricao_status is null then
    new.transcricao_status := 'pendente';
  end if;
  return new;
end $$;
drop trigger if exists trg_mensagens_transcricao_init on public.mensagens;
create trigger trg_mensagens_transcricao_init
  before insert on public.mensagens
  for each row execute function public.tg_mensagens_transcricao_init();

-- ------------------------------------------------------------
-- 3) Outbox: quando o status vira CONCLUÍDO ou ERRO, emite 'audio.transcrito' (só na conclusão).
--    O trg_eventos_broadcast (Sprint 1.1) faz o Broadcast do id. event_uuid determinístico =>
--    uma conclusão por mensagem (idempotente; re-chamada não duplica evento).
-- ------------------------------------------------------------
create or replace function public.tg_mensagens_transcricao_outbox()
returns trigger language plpgsql set search_path = public as $$
declare v_setor text;
begin
  if new.transcricao_status in ('concluido','erro') then
    select setor into v_setor from public.topico where id = new.topico_id;
    insert into public.eventos(event_uuid, tenant_id, tipo, topico_id, entity_type, entity_id, autor_id, setor, resumo, payload)
    values (md5(new.tenant_id::text || '|audio.transcrito|' || new.transcricao_status || '|' || new.id::text)::uuid, new.tenant_id, 'audio.transcrito',
            new.topico_id, 'mensagens', new.id::text, new.autor_id, v_setor,
            case when new.transcricao_status = 'erro' then '[transcrição falhou]' else left(coalesce(new.transcricao,''),140) end,
            jsonb_build_object('transcricao_status', new.transcricao_status))
    on conflict (tenant_id, event_uuid) do nothing;
  end if;
  return new;
end $$;
drop trigger if exists trg_mensagens_transcricao_outbox on public.mensagens;
create trigger trg_mensagens_transcricao_outbox
  after update of transcricao_status on public.mensagens
  for each row when (old.transcricao_status is distinct from new.transcricao_status)
  execute function public.tg_mensagens_transcricao_outbox();

-- ------------------------------------------------------------
-- 4) RPCs do WORKER (server-side; só service_role — o navegador NUNCA chama).
-- 4.1 proxima_transcricao: reivindica UM áudio pendente (for update skip locked), marca
--     'processando' e devolve o caminho do objeto p/ o worker baixar. NÃO emite evento
--     (processando não gera evento; só a conclusão gera).
-- ------------------------------------------------------------
create or replace function public.proxima_transcricao()
returns table (mensagem_id uuid, storage_path text, mime text)
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_path text; v_mime text;
begin
  select m.id into v_id
    from public.mensagens m
   where m.tenant_id = public.current_tenant()
     and m.tipo_conteudo = 'audio'
     and m.removido_em is null
     and ( m.transcricao_status = 'pendente'
           -- watchdog: 'processando' preso (worker caiu) volta a ser reivindicável após 5 min
           or (m.transcricao_status = 'processando'
               and (m.transcricao_em is null or m.transcricao_em < now() - interval '5 minutes')) )
   order by m.created_at asc
   for update skip locked
   limit 1;
  if v_id is null then return; end if;

  update public.mensagens set transcricao_status = 'processando', transcricao_em = now() where id = v_id;

  select a.storage_path, a.mime into v_path, v_mime
    from public.anexo a where a.mensagem_id = v_id and a.tipo = 'audio' limit 1;

  mensagem_id := v_id; storage_path := v_path; mime := v_mime; return next;
end $$;

-- 4.2 marcar_transcricao: grava o resultado. Idempotente (o trigger só emite na mudança real).
create or replace function public.marcar_transcricao(p_mensagem_id uuid, p_status text, p_texto text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('processando','concluido','erro') then
    raise exception 'status de transcricao invalido: %', p_status using errcode = '22023';
  end if;
  update public.mensagens
     set transcricao_status = p_status,
         transcricao = case when p_status = 'concluido' then p_texto else transcricao end,
         transcricao_em = now()
   where id = p_mensagem_id and tenant_id = public.current_tenant() and tipo_conteudo = 'audio';
end $$;

revoke all on function public.proxima_transcricao()                         from public, anon, authenticated;
revoke all on function public.marcar_transcricao(uuid, text, text)          from public, anon, authenticated;
grant  execute on function public.proxima_transcricao()                     to service_role;
grant  execute on function public.marcar_transcricao(uuid, text, text)      to service_role;

-- ------------------------------------------------------------
-- 5) LEITURA p/ o cliente:
-- 5.1 mensagens_pagina — agora traz transcricao + transcricao_status (recriada; SECURITY
--     INVOKER, paginação/ordem/anexos preservados; compatível com texto/foto/áudio).
-- ------------------------------------------------------------
drop function if exists public.mensagens_pagina(uuid, timestamptz, uuid, int);
create function public.mensagens_pagina(
  p_topico_id  uuid,
  p_antes_ts   timestamptz default null,
  p_antes_id   uuid        default null,
  p_limite     int         default 30)
returns table (
  id uuid, autor_id uuid, autor_nome text, corpo text, tipo_conteudo text,
  reply_para uuid, created_at timestamptz, anexos jsonb,
  transcricao text, transcricao_status text)
language plpgsql stable security invoker set search_path = public as $$
begin
  if not public.pode_ver_topico(p_topico_id) then
    raise exception 'sem acesso a este topico' using errcode = '42501';
  end if;
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
    where m.topico_id = p_topico_id
      and m.removido_em is null
      and (p_antes_ts is null or (m.created_at, m.id) < (p_antes_ts, p_antes_id))
    order by m.created_at desc, m.id desc
    limit greatest(1, least(coalesce(p_limite, 30), 100));
end $$;
revoke all on function public.mensagens_pagina(uuid, timestamptz, uuid, int) from public;
grant execute on function public.mensagens_pagina(uuid, timestamptz, uuid, int) to authenticated;

-- 5.2 transcricoes: estado atual da transcrição de mensagens específicas (as pendentes na
--     tela). SECURITY INVOKER => a RLS de mensagens (pode_ver_topico) filtra por linha.
--     O cliente chama isto ao receber o Broadcast, atualizando SÓ as mensagens alteradas.
create or replace function public.transcricoes(p_ids uuid[])
returns table (id uuid, transcricao_status text, transcricao text)
language sql stable security invoker set search_path = public as $$
  select m.id, m.transcricao_status, m.transcricao
  from public.mensagens m
  where m.id = any(coalesce(p_ids, '{}'::uuid[]))
    and m.tipo_conteudo = 'audio'
    and m.removido_em is null;
$$;
revoke all on function public.transcricoes(uuid[]) from public;
grant execute on function public.transcricoes(uuid[]) to authenticated;

-- 5.3 feed_pagina — recriada EXCLUINDO os eventos que existem só p/ acionar o Broadcast e
--     NÃO devem aparecer no Feed ('audio.transcrito', 'mencao.criada'). Sem isso, cada
--     transcrição vira um item avulso no Feed. Mesma assinatura/keyset/segurança da 1.1.
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
      and e.tipo not in ('audio.transcrito','mencao.criada')   -- eventos "de bastidor" (só broadcast)
      and (p_cursor is null or e.id < p_cursor)
    order by e.id desc
    limit greatest(1, least(coalesce(p_limite, 30), 100));
end $$;
revoke all on function public.feed_pagina(bigint, int) from public;
grant execute on function public.feed_pagina(bigint, int) to authenticated;

-- ------------------------------------------------------------
-- 6) Feature flag do módulo de transcrição (OFF no seed). O cliente só mostra o estado de
--    transcrição quando ligada (ligar só depois de o worker estar no ar).
-- ------------------------------------------------------------
insert into public.feature_flags(tenant_id, chave, habilitado)
values (public.current_tenant(), 'central_transcricao', false)
on conflict (tenant_id, chave) do nothing;

-- ============================================================
-- ROLLBACK (desfazer só a Sprint 1.8) — descomentar se precisar:
-- drop trigger if exists trg_mensagens_transcricao_outbox on public.mensagens;
-- drop trigger if exists trg_mensagens_transcricao_init on public.mensagens;
-- drop function if exists public.tg_mensagens_transcricao_outbox();
-- drop function if exists public.tg_mensagens_transcricao_init();
-- drop function if exists public.proxima_transcricao();
-- drop function if exists public.marcar_transcricao(uuid, text, text);
-- drop function if exists public.transcricoes(uuid[]);
-- delete from public.feature_flags where chave = 'central_transcricao';
-- -- restaurar mensagens_pagina da 1.5 (sem transcricao/transcricao_status) se necessário.
-- -- (a coluna transcricao e o check estendido podem ficar; são aditivos e inofensivos.)
-- ============================================================
