-- ============================================================
-- CENTRAL OPERACIONAL — SPRINT 1.7 (mensagem de ÁUDIO — gravar/enviar/armazenar/reproduzir)
-- REUTILIZA toda a infra da foto (1.5): mesmo bucket privado central-op, mesmo path
-- {tenant}/{topico}/{anexo}.{ext}, mesma RPC postar_mensagem (assinatura inalterada),
-- mesmas policies de Storage, mesma exibição por URL assinada. Só adiciona o tipo 'audio'.
-- ADITIVO. Depende de sprint0(atualizado)+1_1+1_2+1_3+1_5(+1_6) já executados.
--
-- NÃO cria segunda arquitetura de anexos. NÃO implementa transcrição/IA/waveform/etc.
-- COMO USAR: rodar no Supabase (STAGING). ROLLBACK comentado no fim.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Bucket central-op: aceita também MIMEs de áudio e sobe o limite p/ 10 MB.
--    (A foto continua limitada a 5 MB pela própria RPC; o bucket é o teto externo comum.)
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('central-op', 'central-op', false, 10485760,
        array['image/jpeg','image/png','image/webp',
              'audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/aac'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ------------------------------------------------------------
-- 2) parse_object_path: aceita as extensões de áudio além das de foto.
--    (Mesma função/segurança da 1.5; só amplia o conjunto de extensões do regex.)
-- ------------------------------------------------------------
create or replace function central.parse_object_path(p_name text)
returns table (tenant_id uuid, topico_id uuid, anexo_id uuid, ext text)
language sql immutable
set search_path = ''
as $$
  select (m[1])::uuid, (m[2])::uuid, (m[3])::uuid, m[4]
  from (
    select pg_catalog.regexp_match(
      coalesce(p_name, ''),
      '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/' ||
       '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/' ||
       '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})' ||
       '\.(jpg|png|webp|webm|ogg|m4a|mp3|aac)$'
    ) as m
  ) s;
$$;
revoke all on function central.parse_object_path(text) from public, anon;
grant execute on function central.parse_object_path(text) to authenticated;

-- ------------------------------------------------------------
-- 3) postar_mensagem — assinatura INALTERADA. Generaliza a validação server-side do
--    anexo para foto OU áudio, preservando TODAS as garantias da 1.5 (idempotência da
--    mensagem e do anexo, 23505 em divergência, atomicidade). Os guards de replay já
--    comparam bytes/largura/altura/duracao_ms (is not distinct from), então servem aos dois.
--    transcricao_status = null (esta sprint NÃO transcreve).
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

    if v_aid is null                       then raise exception 'anexo sem id' using errcode = '22023'; end if;
    if v_atipo not in ('foto','audio')     then raise exception 'anexo.tipo invalido' using errcode = '22023'; end if;
    if p_tipo <> v_atipo                   then raise exception 'tipo da mensagem deve casar com o anexo' using errcode = '22023'; end if;
    if v_abytes is null or v_abytes <= 0   then raise exception 'bytes invalido' using errcode = '22023'; end if;

    if v_atipo = 'foto' then
      if v_amime not in ('image/jpeg','image/png','image/webp') then raise exception 'mime de foto nao permitido' using errcode = '22023'; end if;
      if v_abytes > 5242880 then raise exception 'foto acima de 5MB' using errcode = '22023'; end if;
      v_ext := case v_amime when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' end;
    else  -- audio
      if v_amime not in ('audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/aac') then raise exception 'mime de audio nao permitido' using errcode = '22023'; end if;
      if v_abytes > 10485760 then raise exception 'audio acima de 10MB' using errcode = '22023'; end if;
      if v_adur is null or v_adur <= 0 then raise exception 'duracao invalida' using errcode = '22023'; end if;
      v_ext := case v_amime when 'audio/webm' then 'webm' when 'audio/ogg' then 'ogg'
                            when 'audio/mp4'  then 'm4a'  when 'audio/mpeg' then 'mp3'
                            when 'audio/aac'  then 'aac' end;
    end if;

    -- caminho DEVE ser exatamente {tenant}/{topico}/{anexo}.{ext} (prefixo + filename==anexo_id + ext do mime)
    v_exp_path := v_tenant::text || '/' || p_topico_id::text || '/' || v_aid::text || '.' || v_ext;
    if v_apath is distinct from v_exp_path then
      raise exception 'storage_path invalido (esperado tenant/topico/anexo.ext compativel)' using errcode = '22023';
    end if;
  else
    if p_tipo in ('foto','audio') then raise exception 'mensagem % exige exatamente um anexo', p_tipo using errcode = '22023'; end if;
  end if;

  -- ---- insere a mensagem (idempotente pelo id) ----
  insert into public.mensagens(id, tenant_id, topico_id, autor_id, corpo, tipo_conteudo, reply_para, transcricao_status)
  values (p_mensagem_id, v_tenant, p_topico_id, auth.uid(), p_corpo, p_tipo, p_reply, null)
  on conflict (id) do nothing;

  if not found then
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
    return p_mensagem_id;
  end if;

  -- ---- MENSAGEM nova: grava o anexo (se houver) com guard de idempotência ----
  if v_n = 1 then
    insert into public.anexo(id, tenant_id, mensagem_id, tipo, storage_path, mime, bytes, largura, altura, duracao_ms)
    values (v_aid, v_tenant, p_mensagem_id, v_atipo, v_apath, v_amime, v_abytes, v_alarg, v_aalt, v_adur)
    on conflict (id) do nothing;
    if not found then
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

  if array_length(p_mencoes, 1) is not null then
    insert into public.mensagem_mencoes(tenant_id, mensagem_id, mencionado_id)
    select v_tenant, p_mensagem_id, unnest(p_mencoes)
    on conflict do nothing;
  end if;

  return p_mensagem_id;
end $$;

-- ============================================================
-- ROLLBACK (desfazer só a Sprint 1.7) — descomentar se precisar:
-- update storage.buckets set file_size_limit = 5242880,
--   allowed_mime_types = array['image/jpeg','image/png','image/webp'] where id = 'central-op';
-- -- restaurar parse_object_path e postar_mensagem para a versão da Sprint 1.5.
-- -- áudios já enviados permanecem no bucket (limpeza = estratégia de órfãos).
-- ============================================================
