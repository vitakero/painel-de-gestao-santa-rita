-- ============================================================
-- CENTRAL OPERACIONAL — SPRINT 2.3 (BUSCA GLOBAL CONTEXTUAL)
--
-- Uma RPC de LEITURA que cruza 6 fontes num resultado só, sob RLS. Zero entidade nova,
-- zero tabela do ERP tocada, ZERO RPC de escrita, sem postgres_changes.
--
-- ARQUITETURA (decidida pela inspeção do schema real):
--   - MENSAGENS: Full Text Search — a coluna mensagens.busca (tsvector 'portuguese' +
--     unaccent) e o índice GIN já existem (Sprint 0). Uso o índice pra CASAR (rápido) e
--     monto o trecho por janela de substring (previsível, sem depender de config).
--   - WORK ITEMS e CONVERSAS (topico): ILIKE com unaccent — conjunto pequeno por tenant,
--     tudo sob a RLS da 2.0.
--   - PRODUTOS/EQUIPAMENTOS/RECEBIMENTOS: entram pelo VÍNCULO (a spec diz "vinculados").
--     Isso mantém tudo sob RLS (a vinculo_sel só devolve link de work item/tópico visível)
--     e é LIMITADO — nunca varre os 47 mil produtos.
--   - POR NOME (ex.: "João"): perfis têm RLS que bloqueia ler outros perfis; então uso um
--     helper DEFINER com guard (mesmo padrão de nome_de/mencionaveis) só p/ resolver ids.
--
-- BUSCA CONGELADA: não escuta Broadcast (a spec pede). O cliente re-executa p/ atualizar.
--
-- PERF: FTS indexado nas mensagens; ILIKE só em conjuntos pequenos (work_items/topico do
--   tenant; e produtos/equipamentos LIMITADOS aos vinculados, não o catálogo inteiro).
--   Não crio índice novo (não posso tocar tabela do ERP; o resto é pequeno).
--
-- ADITIVO E IDEMPOTENTE. Uma transação. COMO USAR: rodar uma vez no Supabase.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1) Helper DEFINER: ids de perfis cujo NOME casa a busca (para achar work items por
--    responsável). DEFINER + guard porque perfis têm RLS que esconde outros usuários.
-- ------------------------------------------------------------
create or replace function public.ids_perfis_busca(p_q text)
returns uuid[] language plpgsql stable security definer set search_path = public, extensions as $$
declare v uuid[]; v_q text := btrim(unaccent(lower(coalesce(p_q, ''))));
begin
  if not (public.pode_pagina('operacional') or public.sou_master()) then
    raise exception 'sem acesso' using errcode = '42501';
  end if;
  if length(v_q) < 2 then return '{}'::uuid[]; end if;
  select array_agg(pf.id) into v
    from public.perfis pf
   where pf.tenant_id = public.current_tenant()
     and unaccent(lower(coalesce(pf.nome, ''))) like '%' || v_q || '%';
  return coalesce(v, '{}'::uuid[]);
end $$;

-- ------------------------------------------------------------
-- 2) buscar_contexto — a busca global. SECURITY INVOKER: cada fonte é filtrada pela sua
--    própria RLS (work_items/topico/mensagens/vinculo), então "nunca retornar item
--    invisível" sai de graça. Guard de página no topo.
-- ------------------------------------------------------------
create or replace function public.buscar_contexto(p_texto text, p_limite int default 50)
returns table (
  tipo text, id text, titulo text, subtitulo text, trecho text,
  prioridade text, status text, responsavel text,
  topico_id uuid, work_item_id uuid, entity_type text, entity_id text,
  updated_at timestamptz, score real)
language plpgsql stable security invoker set search_path = public, extensions
set plan_cache_mode = 'force_custom_plan' as $$
declare
  v_q    text := btrim(unaccent(lower(coalesce(p_texto, ''))));
  v_like text;
  v_pre  text;
  v_lim  int := greatest(1, least(coalesce(p_limite, 50), 100));
  v_tsq  tsquery;
  v_perf uuid[];
begin
  if not (public.pode_pagina('operacional') or public.sou_master()) then
    raise exception 'sem acesso' using errcode = '42501';
  end if;
  if length(v_q) < 2 then return; end if;          -- 1 letra não busca (ruído/scan)
  v_like := '%' || v_q || '%';
  v_pre  := v_q || '%';
  v_perf := public.ids_perfis_busca(p_texto);       -- ids de perfis com nome casando
  begin v_tsq := websearch_to_tsquery('portuguese', v_q); exception when others then v_tsq := null; end;

  return query
  with achados as (
    -- 1) WORK ITEMS: título, descrição ou NOME do responsável
    select 1 as rank,
           (case when unaccent(lower(w.titulo)) like v_pre then 1.0
                 when unaccent(lower(w.titulo)) like v_like then 0.8 else 0.5 end)::real as sc,
           'work_item'::text as tipo, w.id::text as id, w.titulo as titulo,
           ((case when w.tipo = 'tarefa' then 'Tarefa' else 'Ocorrência' end) || ' · ' || w.status)::text as subtitulo,
           left(coalesce(w.descricao, ''), 140) as trecho,
           w.prioridade as prioridade, w.status as status, public.nome_de(w.responsavel_id) as responsavel,
           w.topico_id as topico_id, w.id as work_item_id, null::text as entity_type, null::text as entity_id,
           w.updated_at as updated_at
      from public.work_items w
     where unaccent(lower(w.titulo)) like v_like
        or unaccent(lower(coalesce(w.descricao, ''))) like v_like
        or (array_length(v_perf, 1) is not null and w.responsavel_id = any (v_perf))

    union all
    -- 2) CONVERSAS (tópicos): título
    select 2,
           (case when unaccent(lower(t.titulo)) like v_pre then 1.0 else 0.7 end)::real,
           'conversa', t.id::text, t.titulo,
           (case t.tipo when 'canal' then 'Canal' when 'geral' then 'Canal geral'
                        when 'recebimento' then 'Recebimento' when 'ocorrencia' then 'Ocorrência'
                        else t.tipo end)::text,
           null, null, null, null,
           t.id, null::uuid, null, null, t.updated_at
      from public.topico t
     where unaccent(lower(t.titulo)) like v_like

    union all
    -- 3) MENSAGENS: SÓ Full Text Search (índice GIN). O OR com ILIKE anulava o índice e
    --    fazia seq scan da tabela que mais cresce — removido. Trecho por janela de substring.
    select 3,
           (case when v_tsq is not null then ts_rank(m.busca, v_tsq) else 0.3 end)::real,
           'mensagem', m.id::text, null, null,   -- subtitulo null: o autor já vai em 'responsavel'
           (case when position(v_q in unaccent(lower(coalesce(m.corpo, '')))) > 0
                 then '…' || btrim(substring(m.corpo from greatest(1, position(v_q in unaccent(lower(m.corpo))) - 28) for 84)) || '…'
                 else left(coalesce(m.corpo, ''), 84) end),
           null, null, public.nome_de(m.autor_id),
           m.topico_id, null::uuid, null, null, m.created_at
      from public.mensagens m
     where m.removido_em is null and v_tsq is not null and m.busca @@ v_tsq

    union all
    -- 4) PRODUTOS vinculados. GATE por página 'estld' (a 2.0 fechou isso de propósito).
    --    Join SARGÁVEL: entity_id de estoque_produtos é numérico (garantido no write path),
    --    e o subquery filtra entity_type ANTES do cast (só numéricos chegam ao ::numeric).
    select 4, 0.75::real,
           'produto', p.cod::text, p.nome::text, ('Produto · vinculado')::text,
           left(coalesce(p.nome, ''), 100),
           null, null, null,
           v.topico_id, v.work_item_id, 'estoque_produtos', v.entity_id,
           coalesce(w.updated_at, v.created_at)
      from (select * from public.vinculo where entity_type = 'estoque_produtos') v
      join public.estoque_produtos p on p.cod = v.entity_id::numeric
      left join public.work_items w on w.id = v.work_item_id
     where (public.sou_master() or public.pode_pagina('estld'))
       and unaccent(lower(coalesce(p.nome, ''))) like v_like

    union all
    -- 5) EQUIPAMENTOS vinculados. GATE por página 'manutencoes'.
    select 5, 0.7::real,
           'equipamento', e.id::text, e.nome::text, ('Equipamento · vinculado')::text,
           left(coalesce(e.nome, ''), 100),
           null, null, null,
           v.topico_id, v.work_item_id, 'manutencao_equipamentos', v.entity_id,
           coalesce(w.updated_at, v.created_at)
      from (select * from public.vinculo where entity_type = 'manutencao_equipamentos') v
      join public.manutencao_equipamentos e on e.id::text = v.entity_id
      left join public.work_items w on w.id = v.work_item_id
     where (public.sou_master() or public.pode_pagina('manutencoes'))
       and unaccent(lower(coalesce(e.nome, ''))) like v_like

    union all
    -- 6) RECEBIMENTOS/AGENDAMENTOS vinculados. GATE por página 'central' (Central Logística).
    select 6, 0.65::real,
           'recebimento', a.id::text, coalesce(a.fornecedor, 'Recebimento')::text,
           ('Recebimento · ' || coalesce(a.data, ''))::text,
           left(coalesce(a.fornecedor, ''), 100),
           null, null, null,
           v.topico_id, v.work_item_id, 'central_agendamentos', v.entity_id,
           coalesce(w.updated_at, v.created_at)
      from (select * from public.vinculo where entity_type = 'central_agendamentos') v
      join public.central_agendamentos a on a.id = v.entity_id
      left join public.work_items w on w.id = v.work_item_id
     where (public.sou_master() or public.pode_pagina('central'))
       and ( unaccent(lower(coalesce(a.fornecedor, ''))) like v_like
             or unaccent(lower(coalesce(a.pedido, ''))) like v_like )
  ),
  -- COTA POR CATEGORIA: sem isso, uma categoria "faminta" (muitos work items casando)
  -- consumiria todas as 50 vagas e sumiria com mensagens/produtos. Teto de 15 por grupo.
  cotado as (
    select a.*, row_number() over (partition by a.rank
                                   order by a.sc desc, a.updated_at desc nulls last, a.id) as rn
      from achados a
  )
  select c.tipo, c.id, c.titulo, c.subtitulo, c.trecho, c.prioridade, c.status, c.responsavel,
         c.topico_id, c.work_item_id, c.entity_type, c.entity_id, c.updated_at, c.sc
    from cotado c
   where c.rn <= 15
   order by c.rank asc, c.sc desc, c.updated_at desc nulls last, c.id
   limit v_lim;
end $$;

-- ------------------------------------------------------------
-- 3) GRANTS
-- ------------------------------------------------------------
revoke all on function public.ids_perfis_busca(text) from public;
revoke all on function public.buscar_contexto(text, int) from public;
grant execute on function public.ids_perfis_busca(text) to authenticated;
grant execute on function public.buscar_contexto(text, int) to authenticated;

commit;

-- ============================================================
-- CONFERÊNCIA (fora da transação; dá 42501 no SQL Editor = guard funcionando):
--   select tipo, titulo, subtitulo, score from public.buscar_contexto('coca');
--
-- ROLLBACK (desfazer só a 2.3):
-- drop function if exists public.buscar_contexto(text, int);
-- drop function if exists public.ids_perfis_busca(text);
-- ============================================================
