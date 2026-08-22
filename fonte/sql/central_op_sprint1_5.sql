-- ============================================================
-- CENTRAL OPERACIONAL — SPRINT 1.5 (envio de UMA foto por mensagem)
-- Canais + recebimentos. Mensagem pode ter foto + texto opcional.
-- ADITIVO. Depende de sprint0(atualizado)+1_1+1_2+1_3 já executados.
--
-- NÃO altera central_agendamentos. NÃO reescreve tabelas de forma destrutiva.
-- Só cria: bucket privado, schema privado 'central' + helper de path, 2 policies de
-- Storage, endurece a postar_mensagem p/ foto, estende mensagens_pagina (anexos jsonb),
-- e um helper central_tenant() p/ o cliente montar o caminho.
-- Escrita de metadados: SÓ pela RPC. Leitura de foto: URL assinada de curta duração.
-- COMO USAR: rodar no Supabase (STAGING). ROLLBACK comentado no fim.
-- ============================================================

-- ------------------------------------------------------------
-- 1) BUCKET privado 'central-op' — limite de tamanho e MIME travados NO BUCKET
--    (defesa server-side, além da validação do cliente). Idempotente.
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('central-op', 'central-op', false, 5242880,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public            = excluded.public,
      file_size_limit   = excluded.file_size_limit,
      allowed_mime_types= excluded.allowed_mime_types;

-- ------------------------------------------------------------
-- 2) Schema PRIVADO 'central' (NÃO exposto pela API) + helper SEGURO de parsing do
--    caminho do objeto. Recebe storage.objects.name e devolve tenant/topico/anexo/ext
--    ou NULLs — NUNCA lança erro para caminho malformado (regex estrita de UUID =>
--    o cast nunca falha). Pura (sem acesso a tabela), immutable, search_path = ''.
-- ------------------------------------------------------------
create schema if not exists central;

create or replace function central.parse_object_path(p_name text)
returns table (tenant_id uuid, topico_id uuid, anexo_id uuid, ext text)
language sql immutable
set search_path = ''
as $$
  select (m[1])::uuid, (m[2])::uuid, (m[3])::uuid, m[4]
  from (
    -- COALESCE é palavra-chave (não função) => NÃO pode ser qualificada com schema; é imune a
    -- hijack de search_path por si só. Só regexp_match é função real de pg_catalog.
    -- Regex em minúsculo (0-9a-f) p/ bater 1:1 com o caminho canônico que a RPC monta.
    select pg_catalog.regexp_match(
      coalesce(p_name, ''),
      '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/' ||
       '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/' ||
       '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})' ||
       '\.(jpg|png|webp)$'
    ) as m
  ) s;
$$;

-- schema privado + execução só para authenticated (a policy roda como o usuário)
revoke all on schema central from public;
grant usage on schema central to authenticated;
revoke all on function central.parse_object_path(text) from public, anon;
grant execute on function central.parse_object_path(text) to authenticated;

-- ------------------------------------------------------------
-- 3) POLICIES de Storage no bucket 'central-op'. Só INSERT e SELECT p/ authenticated.
--    (Sem UPDATE, sem DELETE, sem anon. Bucket privado.)
-- ------------------------------------------------------------

-- 3.1 INSERT (upload): caminho válido, tenant do caminho = current_tenant(), tópico é
--     UUID válido e o usuário PODE ver o tópico (pode_ver_topico embute pode_pagina
--     'operacional', master isento). O nome do arquivo já é o anexo_id (parser).
drop policy if exists central_op_insert on storage.objects;
create policy central_op_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'central-op'
    and exists (
      select 1
      from central.parse_object_path(storage.objects.name) p
      where p.tenant_id = public.current_tenant()
        and p.topico_id is not null
        and p.anexo_id  is not null
        and public.pode_ver_topico(p.topico_id)
    )
  );

-- 3.2 SELECT (leitura / createSignedUrl): NÃO confia só no caminho. Exige que o objeto
--     já esteja CONFIRMADO no banco: precisa existir public.anexo com storage_path = name,
--     ligado a uma mensagem, no tenant certo e com pode_ver_topico do tópico da mensagem.
--     => objeto enviado mas não confirmado, ou órfão, NÃO pode ser lido.
drop policy if exists central_op_select on storage.objects;
create policy central_op_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'central-op'
    and exists (
      select 1
      from public.anexo a
      join public.mensagens m on m.id = a.mensagem_id
      where a.storage_path = storage.objects.name
        and a.tenant_id    = public.current_tenant()
        and m.removido_em is null                       -- foto de mensagem apagada (futuro) deixa de ser legível
        and public.pode_ver_topico(m.topico_id)
    )
  );

-- ------------------------------------------------------------
-- 4) RPC postar_mensagem — ENDURECIDA para foto (assinatura INALTERADA).
--    Regras:
--    - validação server-side do anexo de foto (não confia no navegador);
--    - 0 ou 1 anexo (uma foto por mensagem nesta sprint);
--    - idempotência da MENSAGEM: mesmo id + payload idêntico (incl. anexo) = replay;
--      qualquer diferença = 23505;
--    - idempotência do ANEXO: mesmo anexo_id + mesmos metadados permanentes = replay;
--      qualquer diferença = 23505 (fim do "on conflict do nothing" silencioso).
--    A gravação segue ATÔMICA (mensagem + anexo na mesma transação; sem exception
--    handler => tudo ou nada).
-- ------------------------------------------------------------
create or replace function public.postar_mensagem(
  p_mensagem_id uuid, p_topico_id uuid, p_corpo text,
  p_tipo text default 'texto', p_anexos jsonb default '[]'::jsonb,
  p_mencoes uuid[] default '{}', p_reply uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant();
  v_arr    jsonb := case when jsonb_typeof(p_anexos) = 'array' then p_anexos else '[]'::jsonb end;
  v_n      int   := jsonb_array_length(v_arr);
  a        jsonb;
  v_aid    uuid; v_atipo text; v_apath text; v_amime text; v_abytes bigint;
  v_alarg  int;  v_aalt  int;  v_adur  int;
  v_ext    text; v_exp_path text;
begin
  if not public.pode_ver_topico(p_topico_id) then
    raise exception 'sem acesso a este topico' using errcode = '42501';
  end if;

  -- ---- validação de anexos: 0 ou 1 ----
  if v_n > 1 then raise exception 'no maximo um anexo por mensagem' using errcode = '22023'; end if;

  if v_n = 1 then
    a       := v_arr -> 0;
    v_aid   := nullif(a->>'id','')::uuid;
    v_atipo := a->>'tipo';
    v_apath := a->>'storage_path';
    v_amime := a->>'mime';
    v_abytes:= nullif(a->>'bytes','')::bigint;
    v_alarg := nullif(a->>'largura','')::int;
    v_aalt  := nullif(a->>'altura','')::int;
    v_adur  := nullif(a->>'duracao_ms','')::int;

    -- validação server-side (não confia no JSON do navegador)
    if v_aid is null                               then raise exception 'anexo sem id' using errcode = '22023'; end if;
    if v_atipo is distinct from 'foto'             then raise exception 'anexo.tipo deve ser foto' using errcode = '22023'; end if;
    if p_tipo <> 'foto'                            then raise exception 'mensagem com foto deve ter tipo foto' using errcode = '22023'; end if;
    if v_amime not in ('image/jpeg','image/png','image/webp') then raise exception 'mime nao permitido' using errcode = '22023'; end if;
    if v_abytes is null or v_abytes <= 0           then raise exception 'bytes invalido' using errcode = '22023'; end if;
    if v_abytes > 5242880                          then raise exception 'foto acima de 5MB' using errcode = '22023'; end if;

    -- extensão canônica esperada a partir do MIME
    v_ext := case v_amime when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' end;
    -- caminho DEVE ser exatamente {tenant}/{topico}/{anexo}.{ext} => valida prefixo,
    -- filename == anexo_id e extensão compatível com o MIME numa comparação exata.
    v_exp_path := v_tenant::text || '/' || p_topico_id::text || '/' || v_aid::text || '.' || v_ext;
    if v_apath is distinct from v_exp_path then
      raise exception 'storage_path invalido (esperado tenant/topico/anexo.ext compativel)' using errcode = '22023';
    end if;
  else
    -- sem anexo: tipo não pode ser 'foto'
    if p_tipo = 'foto' then raise exception 'mensagem foto exige exatamente um anexo' using errcode = '22023'; end if;
  end if;

  -- ---- insere a mensagem (idempotente pelo id) ----
  insert into public.mensagens(id, tenant_id, topico_id, autor_id, corpo, tipo_conteudo, reply_para, transcricao_status)
  values (p_mensagem_id, v_tenant, p_topico_id, auth.uid(), p_corpo, p_tipo, p_reply,
          case when p_tipo = 'audio' then 'pendente' else null end)
  on conflict (id) do nothing;

  if not found then
    -- MENSAGEM já existia: replay só se for idêntica (corpo/tipo/topico/autor/reply)
    if not exists (
      select 1 from public.mensagens m
      where m.id = p_mensagem_id and m.tenant_id = v_tenant and m.topico_id = p_topico_id
        and m.autor_id      is not distinct from auth.uid()
        and m.corpo         is not distinct from p_corpo
        and m.tipo_conteudo = p_tipo
        and m.reply_para    is not distinct from p_reply
    ) then
      raise exception 'id de mensagem % reutilizado com conteudo diferente', p_mensagem_id using errcode = '23505';
    end if;
    -- e o ANEXO também precisa bater (mesmo id + metadados) OU ausência coerente
    if v_n = 1 then
      if not exists (
        select 1 from public.anexo x
        where x.id = v_aid and x.tenant_id = v_tenant and x.mensagem_id = p_mensagem_id
          and x.tipo = v_atipo and x.storage_path = v_apath
          and x.mime       is not distinct from v_amime
          and x.bytes      is not distinct from v_abytes
          and x.largura    is not distinct from v_alarg
          and x.altura     is not distinct from v_aalt
          and x.duracao_ms is not distinct from v_adur
      ) then
        raise exception 'anexo divergente para a mensagem % em replay', p_mensagem_id using errcode = '23505';
      end if;
    else
      if exists (select 1 from public.anexo x where x.mensagem_id = p_mensagem_id) then
        raise exception 'replay sem anexo, mas a mensagem % possui anexo', p_mensagem_id using errcode = '23505';
      end if;
    end if;
    return p_mensagem_id;   -- replay válido
  end if;

  -- ---- MENSAGEM nova: grava o anexo (se houver) com guard de idempotência ----
  if v_n = 1 then
    insert into public.anexo(id, tenant_id, mensagem_id, tipo, storage_path, mime, bytes, largura, altura, duracao_ms)
    values (v_aid, v_tenant, p_mensagem_id, v_atipo, v_apath, v_amime, v_abytes, v_alarg, v_aalt, v_adur)
    on conflict (id) do nothing;
    if not found then
      -- anexo_id já existia: só ok se for IDÊNTICO (mesmos metadados permanentes); senão erro
      if not exists (
        select 1 from public.anexo x
        where x.id = v_aid and x.tenant_id = v_tenant and x.mensagem_id = p_mensagem_id
          and x.tipo = v_atipo and x.storage_path = v_apath
          and x.mime       is not distinct from v_amime
          and x.bytes      is not distinct from v_abytes
          and x.largura    is not distinct from v_alarg
          and x.altura     is not distinct from v_aalt
          and x.duracao_ms is not distinct from v_adur
      ) then
        raise exception 'anexo % reutilizado com metadados diferentes', v_aid using errcode = '23505';
      end if;
    end if;
  end if;

  -- menções (mantido da Sprint 0; não usado no fluxo de foto)
  if array_length(p_mencoes, 1) is not null then
    insert into public.mensagem_mencoes(tenant_id, mensagem_id, mencionado_id)
    select v_tenant, p_mensagem_id, unnest(p_mencoes)
    on conflict do nothing;
  end if;

  return p_mensagem_id;
end $$;

-- ------------------------------------------------------------
-- 5) mensagens_pagina — agora devolve os anexos como ARRAY JSONB (não colunas soltas).
--    SECURITY INVOKER preservado (RLS de anexo/mensagens aplica). Paginação/ordem
--    inalteradas. Mensagens de texto => anexos = [] (compatível com a 1.4).
--    Return type mudou => precisa DROP + CREATE.
-- ------------------------------------------------------------
drop function if exists public.mensagens_pagina(uuid, timestamptz, uuid, int);
create function public.mensagens_pagina(
  p_topico_id  uuid,
  p_antes_ts   timestamptz default null,
  p_antes_id   uuid        default null,
  p_limite     int         default 30)
returns table (
  id            uuid,
  autor_id      uuid,
  autor_nome    text,
  corpo         text,
  tipo_conteudo text,
  reply_para    uuid,
  created_at    timestamptz,
  anexos        jsonb)
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
             from public.anexo x
             where x.mensagem_id = m.id
           ), '[]'::jsonb) as anexos
    from public.mensagens m
    where m.topico_id = p_topico_id
      and m.removido_em is null
      and (p_antes_ts is null or (m.created_at, m.id) < (p_antes_ts, p_antes_id))
    order by m.created_at desc, m.id desc
    limit greatest(1, least(coalesce(p_limite, 30), 100));
end $$;

revoke all on function public.mensagens_pagina(uuid, timestamptz, uuid, int) from public;
grant execute on function public.mensagens_pagina(uuid, timestamptz, uuid, int) to authenticated;

-- (Sem central_tenant(): o cliente já conhece o tenant fixo, igual ao current_tenant().)

-- ============================================================
-- ROLLBACK (desfazer só a Sprint 1.5) — descomentar se precisar:
-- drop policy if exists central_op_insert on storage.objects;
-- drop policy if exists central_op_select on storage.objects;
-- drop function if exists central.parse_object_path(text);
-- drop schema if exists central;                       -- só se vazio
-- drop function if exists public.central_tenant();
-- -- restaurar mensagens_pagina SEM a coluna anexos (versão da Sprint 1.2):
-- --   drop function if exists public.mensagens_pagina(uuid, timestamptz, uuid, int);
-- --   [recriar a versão 1.2]
-- -- restaurar postar_mensagem para a versão da Sprint 1.4 (guard só de mensagem).
-- -- objetos já enviados no bucket central-op continuam lá (limpeza = estratégia de órfãos).
-- -- delete from storage.buckets where id = 'central-op';   -- só se quiser remover o bucket (precisa esvaziar antes)
-- ============================================================
