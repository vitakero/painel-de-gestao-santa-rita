-- ============================================================
-- CENTRAL OPERACIONAL — SPRINT 2.4 (ASSISTENTE OPERACIONAL / IA)
--
-- IMPORTANTE: a IA NÃO decide nem escreve nada. Estas RPCs SÓ MONTAM TEXTO de contexto
-- (não chamam IA, não gravam). A chamada à IA acontece 100% no CLIENTE (spec).
--
-- PRIVACIDADE (a espinha desta sprint): estas RPCs devolvem APENAS texto legível —
-- SEM ids técnicos, SEM tenant_id, SEM timestamps crus, SEM payloads internos. É esse
-- texto (e só ele) que o cliente manda ao provedor de IA. Assim o "nunca vaze id/tenant"
-- é garantido AQUI, não confiado ao cliente.
--
-- SEGURANÇA: SECURITY INVOKER → cada leitura passa pela RLS (mensagens/topico/work_items/
-- vinculo). Guard de página no topo. Nome de pessoa via nome_de (DEFINER guardado). Nome de
-- produto/equipamento/recebimento só aparece com a página respectiva (estld/manutencoes/
-- central), como na busca (2.3) — senão some, não vaza.
--
-- ZERO tabela nova, ZERO tabela do ERP tocada, ZERO RPC de escrita, sem postgres_changes.
-- ADITIVO E IDEMPOTENTE. Uma transação.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1) flag central_ia (off). A IA respeita a flag E a chave (no cliente): sem os dois,
--    nenhum botão aparece e nenhum erro é gerado.
-- ------------------------------------------------------------
insert into public.feature_flags(tenant_id, chave, habilitado)
values (public.current_tenant(), 'central_ia', false)
on conflict (tenant_id, chave) do nothing;

-- ------------------------------------------------------------
-- 2) contexto_ia_conversa — transcrição limpa das últimas N mensagens de uma conversa.
-- ------------------------------------------------------------
create or replace function public.contexto_ia_conversa(p_topico_id uuid, p_limite int default 40)
returns table (contexto text)
language plpgsql stable security invoker set search_path = public, extensions as $$
declare v_tit text; v_setor text; v_msgs text; v_lim int := greatest(1, least(coalesce(p_limite, 40), 80));
begin
  if not (public.pode_pagina('operacional') or public.sou_master()) then
    raise exception 'sem acesso' using errcode = '42501'; end if;
  if not public.pode_ver_topico(p_topico_id) then
    raise exception 'sem acesso a este topico' using errcode = '42501'; end if;

  select t.titulo, t.setor into v_tit, v_setor
    from public.topico t where t.id = p_topico_id and t.tenant_id = public.current_tenant();

  -- últimas N (desc + limit) reordenadas em ordem cronológica p/ a leitura fazer sentido
  select string_agg(linha, E'\n' order by ord) into v_msgs from (
    select m.created_at as ord,
           coalesce(public.nome_de(m.autor_id), 'Alguém') || ': ' ||
           case when m.tipo_conteudo = 'foto'  then '[foto]'
                when m.tipo_conteudo = 'audio' then coalesce(nullif(btrim(m.transcricao), ''), '[áudio]')
                else coalesce(m.corpo, '') end as linha
      from public.mensagens m
     where m.topico_id = p_topico_id and m.removido_em is null
       and m.tipo_conteudo <> 'sistema'
     order by m.created_at desc, m.id desc
     limit v_lim
  ) s;

  return query select
    'Conversa: ' || coalesce(v_tit, '(sem título)')
    || coalesce(E'\nSetor: ' || v_setor, '')
    || E'\n\nMensagens (mais recentes por último):\n' || coalesce(v_msgs, '(sem mensagens)');
end $$;

-- ------------------------------------------------------------
-- 3) contexto_ia_work_item — item + descrição + vínculos + conversa ligada, tudo em texto.
-- ------------------------------------------------------------
create or replace function public.contexto_ia_work_item(p_work_item_id uuid, p_limite int default 25)
returns table (contexto text)
language plpgsql stable security invoker set search_path = public, extensions as $$
declare
  w record; v_vinc text; v_msgs text; v_ctx text;
  v_lim int := greatest(1, least(coalesce(p_limite, 25), 60));
begin
  if not public.pode_ver_work_item(p_work_item_id) then
    raise exception 'sem acesso a este item' using errcode = '42501'; end if;

  select wi.tipo, wi.titulo, wi.descricao, wi.status, wi.prioridade, wi.responsavel_id, wi.prazo_em, wi.topico_id,
         (wi.prazo_em is not null and wi.status not in ('concluido','cancelado') and wi.prazo_em < now()) as atrasado
    into w
    from public.work_items wi
   where wi.id = p_work_item_id and wi.tenant_id = public.current_tenant();
  if not found then return; end if;

  -- vínculos: nome só se o usuário tem a página da entidade (senão genérico) — igual à busca
  select string_agg(desc_v, E'\n') into v_vinc from (
    select case v.entity_type
      when 'estoque_produtos' then 'Produto: ' || coalesce(
            (select p.nome from public.estoque_produtos p
              where p.cod = v.entity_id::numeric and (public.sou_master() or public.pode_pagina('estld'))),
            'produto vinculado')
      when 'manutencao_equipamentos' then 'Equipamento: ' || coalesce(
            (select e.nome from public.manutencao_equipamentos e
              where e.id::text = v.entity_id and (public.sou_master() or public.pode_pagina('manutencoes'))),
            'equipamento vinculado')
      when 'central_agendamentos' then 'Recebimento: ' || coalesce(
            (select a.fornecedor from public.central_agendamentos a
              where a.id = v.entity_id and (public.sou_master() or public.pode_pagina('central'))),
            'recebimento vinculado')
      when 'topico' then 'Conversa de origem'
      when 'mensagens' then 'Mensagem de origem'
      when 'work_items' then 'Item relacionado'
      else 'Vínculo' end as desc_v   -- nunca expõe o nome técnico da tabela no texto da IA
      from public.vinculo v where v.work_item_id = p_work_item_id
  ) sv;

  if w.topico_id is not null then
    select string_agg(linha, E'\n' order by ord) into v_msgs from (
      select m.created_at as ord,
             coalesce(public.nome_de(m.autor_id), 'Alguém') || ': ' ||
             case when m.tipo_conteudo = 'foto'  then '[foto]'
                  when m.tipo_conteudo = 'audio' then coalesce(nullif(btrim(m.transcricao), ''), '[áudio]')
                  else coalesce(m.corpo, '') end as linha
        from public.mensagens m
       where m.topico_id = w.topico_id and m.removido_em is null and m.tipo_conteudo <> 'sistema'
       order by m.created_at desc, m.id desc
       limit v_lim
    ) s;
  end if;

  v_ctx :=
    'Item: ' || coalesce(w.titulo, '(sem título)') || E'\n'
    || 'Tipo: ' || (case when w.tipo = 'tarefa' then 'Tarefa' else 'Ocorrência' end)
    || ' | Status: ' || w.status || ' | Prioridade: ' || w.prioridade
    || (case when w.atrasado then ' | ATRASADO' else '' end) || E'\n'
    || 'Responsável: ' || coalesce(public.nome_de(w.responsavel_id), 'sem responsável')
    || (case when w.prazo_em is not null
             then ' | Prazo: ' || to_char(w.prazo_em at time zone 'America/Fortaleza', 'DD/MM/YYYY') else '' end) || E'\n'
    || coalesce('Descrição: ' || nullif(btrim(w.descricao), ''), 'Sem descrição')
    || coalesce(E'\n\nContexto vinculado:\n' || v_vinc, '')
    || coalesce(E'\n\nConversa relacionada:\n' || v_msgs, '');
  return query select v_ctx;
end $$;

-- ------------------------------------------------------------
-- 4) GRANTS
-- ------------------------------------------------------------
revoke all on function public.contexto_ia_conversa(uuid, int) from public;
revoke all on function public.contexto_ia_work_item(uuid, int) from public;
grant execute on function public.contexto_ia_conversa(uuid, int) to authenticated;
grant execute on function public.contexto_ia_work_item(uuid, int) to authenticated;

commit;

-- ============================================================
-- CONFERÊNCIA (fora da transação; dá 42501 no SQL Editor = guard funcionando):
--   select * from public.contexto_ia_work_item('<uuid>');
--   select chave, habilitado from public.feature_flags where chave = 'central_ia';
--
-- ROLLBACK (desfazer só a 2.4):
-- drop function if exists public.contexto_ia_conversa(uuid, int);
-- drop function if exists public.contexto_ia_work_item(uuid, int);
-- delete from public.feature_flags where chave = 'central_ia';
-- ============================================================
