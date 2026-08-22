-- ============================================================
-- CENTRAL OPERACIONAL — SPRINT 1.11 (menções @usuário)
-- Reusa mensagem_mencoes (Sprint 0) + p_mencoes (já na assinatura de postar_mensagem).
-- Só: (1) ENDURECE o bloco de menções da postar_mensagem (valida no SERVIDOR: existe/tenant,
-- dedup, nunca grava inválida); (2) RPC mencionaveis() p/ o autocomplete; (3) mensagens_pagina
-- e mensagens_por_ids passam a devolver 'mencoes' (p/ destacar quem foi mencionado).
--
-- ADITIVO. Depende de sprint0..1_10. NÃO cria tabela nova, NÃO cria RPC de escrita nova,
-- NÃO muda a assinatura de postar_mensagem. COMO USAR: rodar no Supabase (STAGING).
-- ============================================================

-- ------------------------------------------------------------
-- 1) postar_mensagem — assinatura INALTERADA. Recriada a partir da 1.7, mudando SOMENTE o
--    bloco de menções: só grava mencionado_id que EXISTE em perfis (single-tenant => existir
--    já é o tenant); DISTINCT + PK deduplicam; inválidas são ignoradas (nunca gravadas).
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
    else
      if v_amime not in ('audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/aac') then raise exception 'mime de audio nao permitido' using errcode = '22023'; end if;
      if v_abytes > 10485760 then raise exception 'audio acima de 10MB' using errcode = '22023'; end if;
      if v_adur is null or v_adur <= 0 then raise exception 'duracao invalida' using errcode = '22023'; end if;
      v_ext := case v_amime when 'audio/webm' then 'webm' when 'audio/ogg' then 'ogg'
                            when 'audio/mp4'  then 'm4a'  when 'audio/mpeg' then 'mp3'
                            when 'audio/aac'  then 'aac' end;
    end if;

    v_exp_path := v_tenant::text || '/' || p_topico_id::text || '/' || v_aid::text || '.' || v_ext;
    if v_apath is distinct from v_exp_path then
      raise exception 'storage_path invalido (esperado tenant/topico/anexo.ext compativel)' using errcode = '22023';
    end if;
  else
    if p_tipo in ('foto','audio') then raise exception 'mensagem % exige exatamente um anexo', p_tipo using errcode = '22023'; end if;
  end if;

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

  -- ---- MENÇÕES (Sprint 1.11): SÓ ids que existem em perfis; DISTINCT + PK deduplicam;
  --      inválidas/duplicadas simplesmente não entram (nunca grava inválida). ----
  if array_length(p_mencoes, 1) is not null then
    insert into public.mensagem_mencoes(tenant_id, mensagem_id, mencionado_id)
    select distinct v_tenant, p_mensagem_id, u
    from unnest(p_mencoes) as u
    where exists (select 1 from public.perfis p where p.id = u)
    on conflict do nothing;
  end if;

  return p_mensagem_id;
end $$;

-- ------------------------------------------------------------
-- 2) mencionaveis() — autocomplete do @. Devolve usuários (id/nome/setor) filtrados pelo texto.
--    SECURITY DEFINER (nome não é sensível, aparece em todo o painel) + guard de página.
-- ------------------------------------------------------------
create or replace function public.mencionaveis(p_busca text default null)
returns table (id uuid, nome text, setor text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.pode_pagina('operacional') and not public.sou_master() then
    raise exception 'sem acesso a Central Operacional' using errcode = '42501';
  end if;
  return query
    select p.id, p.nome, p.setor
    from public.perfis p
    where p.nome is not null and btrim(p.nome) <> ''
      and (p_busca is null or btrim(p_busca) = '' or p.nome ilike '%' || btrim(p_busca) || '%')
    order by p.nome asc
    limit 8;
end $$;
revoke all on function public.mencionaveis(text) from public;
grant execute on function public.mencionaveis(text) to authenticated;

-- ------------------------------------------------------------
-- 3) mensagens_pagina — recriada trazendo também 'mencoes' (uuid[] dos mencionados).
--    (versão da 1.8 + a coluna mencoes). SECURITY INVOKER/RLS/keyset preservados.
-- ------------------------------------------------------------
drop function if exists public.mensagens_pagina(uuid, timestamptz, uuid, int);
create function public.mensagens_pagina(
  p_topico_id uuid, p_antes_ts timestamptz default null, p_antes_id uuid default null, p_limite int default 30)
returns table (
  id uuid, autor_id uuid, autor_nome text, corpo text, tipo_conteudo text,
  reply_para uuid, created_at timestamptz, anexos jsonb,
  transcricao text, transcricao_status text, mencoes uuid[])
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
           coalesce((select array_agg(mm.mencionado_id) from public.mensagem_mencoes mm where mm.mensagem_id = m.id), '{}'::uuid[]) as mencoes
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
-- 4) mensagens_por_ids — recriada trazendo também 'mencoes' (versão da 1.9 + a coluna).
--    DROP obrigatório: adicionar coluna ao RETURNS TABLE muda o tipo de retorno e o
--    "create or replace" sozinho falharia (42P13 "cannot change return type").
-- ------------------------------------------------------------
drop function if exists public.mensagens_por_ids(uuid[]);
create function public.mensagens_por_ids(p_ids uuid[])
returns table (
  id uuid, autor_id uuid, autor_nome text, corpo text, tipo_conteudo text,
  reply_para uuid, created_at timestamptz, anexos jsonb,
  transcricao text, transcricao_status text, mencoes uuid[])
language plpgsql stable security invoker set search_path = public as $$
begin
  return query
    select m.id, m.autor_id, public.nome_de(m.autor_id) as autor_nome,
           m.corpo, m.tipo_conteudo, m.reply_para, m.created_at,
           coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'tipo',x.tipo,'storage_path',x.storage_path,
                       'mime',x.mime,'bytes',x.bytes,'largura',x.largura,'altura',x.altura,'duracao_ms',x.duracao_ms)
                     order by x.created_at) from public.anexo x where x.mensagem_id = m.id), '[]'::jsonb) as anexos,
           m.transcricao, m.transcricao_status,
           coalesce((select array_agg(mm.mencionado_id) from public.mensagem_mencoes mm where mm.mensagem_id = m.id), '{}'::uuid[]) as mencoes
    from public.mensagens m
    where m.id = any (coalesce(p_ids, '{}'::uuid[]))
      and m.removido_em is null
    order by m.created_at asc, m.id asc;
end $$;
revoke all on function public.mensagens_por_ids(uuid[]) from public;
grant execute on function public.mensagens_por_ids(uuid[]) to authenticated;

-- ============================================================
-- ROLLBACK (desfazer só a Sprint 1.11) — descomentar se precisar:
-- drop function if exists public.mencionaveis(text);
-- -- restaurar postar_mensagem (bloco de menções sem validação) e mensagens_pagina/_por_ids
-- -- sem a coluna 'mencoes' (versões 1.7/1.8/1.9) se necessário.
-- ============================================================
