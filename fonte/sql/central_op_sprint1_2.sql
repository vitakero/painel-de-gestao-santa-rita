-- ============================================================
-- CENTRAL OPERACIONAL — SPRINT 1.2 (Navegação por canais, SÓ LEITURA)
-- Cria os canais padrão (Geral + um por setor) e as RPCs de LEITURA para
-- listar canais e abrir/ver as mensagens de um canal. ADITIVO e IDEMPOTENTE.
-- Depende de: central_op_sprint0.sql + central_op_sprint1_1.sql já executados.
--
-- NÃO cria envio de mensagem, compositor, anexos, busca, menções, reações,
-- work_items, recebimentos, notificações — nada de sprints futuras.
-- Permissão do módulo: pode_pagina('operacional').
-- COMO USAR: rodar no Supabase (STAGING primeiro). ROLLBACK comentado no fim.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Helper: nome de um perfil por id (SECURITY DEFINER — nome NÃO é sensível,
--    é exibido em todo o painel). Usado por mensagens_pagina para mostrar o autor
--    sem depender da RLS de 'perfis' (que pode não deixar ler o perfil de outro).
-- ------------------------------------------------------------
create or replace function public.nome_de(p_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select p.nome from public.perfis p where p.id = p_id;
$$;

-- ------------------------------------------------------------
-- 2) listar_topicos — lista os CANAIS (Geral + canais por setor) que o usuário
--    pode ver. SECURITY INVOKER => a RLS de 'topico' (pode_ver_topico) filtra por
--    linha (funcionário vê Geral + o canal do SEU setor; master vê todos).
--    Guard pode_pagina('operacional') p/ erro claro a quem não tem acesso.
--    (Só tipos 'geral'/'canal'; conversas-de-contexto entram em sprints futuras.)
-- ------------------------------------------------------------
create or replace function public.listar_topicos()
returns table (id uuid, tipo text, titulo text, setor text, updated_at timestamptz)
language plpgsql stable security invoker set search_path = public as $$
begin
  if not public.pode_pagina('operacional') then
    raise exception 'sem acesso a Central Operacional' using errcode = '42501';
  end if;
  return query
    select t.id, t.tipo, t.titulo, t.setor, t.updated_at
    from public.topico t
    where t.tenant_id = public.current_tenant()
      and t.tipo in ('geral', 'canal')
      and t.status = 'aberto'
    order by (t.tipo = 'geral') desc, lower(t.titulo) asc;  -- Geral primeiro, depois A-Z
end $$;

-- ------------------------------------------------------------
-- 3) mensagens_pagina — mensagens de UM canal, paginação KEYSET por (created_at, id)
--    desc. SECURITY INVOKER => a RLS de 'mensagens' (pode_ver_topico) filtra por linha.
--    Guard explícito de acesso ao tópico. Traz o nome do autor via nome_de (definer).
--    Esconde soft-deletadas. (No MVP ainda não há como CRIAR mensagem — este é o
--    caminho de LEITURA; o canal aparece vazio até existir compositor, em sprint futura.)
-- ------------------------------------------------------------
create or replace function public.mensagens_pagina(
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
  created_at    timestamptz)
language plpgsql stable security invoker set search_path = public as $$
begin
  if not public.pode_ver_topico(p_topico_id) then
    raise exception 'sem acesso a este topico' using errcode = '42501';
  end if;
  return query
    select m.id, m.autor_id, public.nome_de(m.autor_id) as autor_nome,
           m.corpo, m.tipo_conteudo, m.reply_para, m.created_at
    from public.mensagens m
    where m.topico_id = p_topico_id
      and m.removido_em is null
      and (p_antes_ts is null or (m.created_at, m.id) < (p_antes_ts, p_antes_id))  -- keyset
    order by m.created_at desc, m.id desc
    limit greatest(1, least(coalesce(p_limite, 30), 100));
end $$;

-- ------------------------------------------------------------
-- 4) Grants (execute a authenticated; revoke public) — padrão do projeto.
-- ------------------------------------------------------------
revoke all on function public.nome_de(uuid)                                          from public;
revoke all on function public.listar_topicos()                                       from public;
revoke all on function public.mensagens_pagina(uuid, timestamptz, uuid, int)         from public;
grant execute on function public.nome_de(uuid)                                        to authenticated;
grant execute on function public.listar_topicos()                                     to authenticated;
grant execute on function public.mensagens_pagina(uuid, timestamptz, uuid, int)       to authenticated;

-- ------------------------------------------------------------
-- 5) SEED dos canais padrão (idempotente): 1 canal 'geral' + 1 'canal' por setor
--    distinto encontrado em 'perfis'. Cada INSERT dispara o outbox -> aparece um
--    evento 'topico.criado' no Feed (comportamento desejado). Re-rodar não duplica.
-- ------------------------------------------------------------
insert into public.topico (id, tenant_id, tipo, titulo)
select gen_random_uuid(), public.current_tenant(), 'geral', 'Geral'
where not exists (
  select 1 from public.topico
  where tenant_id = public.current_tenant() and tipo = 'geral'
);

insert into public.topico (id, tenant_id, tipo, titulo, setor)
select gen_random_uuid(), public.current_tenant(), 'canal', s.setor, s.setor
from (
  select distinct nullif(btrim(setor), '') as setor
  from public.perfis
  where setor is not null and btrim(setor) <> ''
) s
where not exists (
  select 1 from public.topico t
  where t.tenant_id = public.current_tenant() and t.tipo = 'canal' and t.setor = s.setor
);

-- ============================================================
-- ROLLBACK (desfazer só a Sprint 1.2) — descomentar se precisar:
--   (Obs.: apagar os canais também apaga os eventos 'topico.criado' deles se houver
--    FK; como eventos.topico_id é FK sem cascade, remova eventos antes se necessário.)
-- delete from public.eventos where tipo = 'topico.criado'
--   and topico_id in (select id from public.topico where tipo in ('geral','canal'));
-- delete from public.topico where tenant_id = public.current_tenant() and tipo in ('geral','canal');
-- drop function if exists public.mensagens_pagina(uuid, timestamptz, uuid, int);
-- drop function if exists public.listar_topicos();
-- drop function if exists public.nome_de(uuid);
-- ============================================================
