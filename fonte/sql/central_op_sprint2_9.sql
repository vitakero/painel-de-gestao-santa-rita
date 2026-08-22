-- ============================================================
-- CENTRAL OPERACIONAL — SPRINT 2.9 (MEU DIA / CAIXA DE ENTRADA OPERACIONAL)
--
-- VISÃO PESSOAL agregada sobre domínios que JÁ EXISTEM. Responde "o que precisa de mim agora?":
--   menções pendentes + tarefas minhas ativas + minhas atrasadas + rotinas pendentes do meu setor hoje.
--
-- NÃO é um novo domínio de notificações. ZERO tabela nova (reusa mensagem_mencoes/mensagens/leituras/
-- topico/work_items/rotinas/rotinas_execucoes/perfis/eventos). ZERO escrita nova (abrir menção reusa
-- marcar_lido; iniciar/concluir rotina reusa registrar_execucao; abrir tarefa reusa work_item_detalhe;
-- reatribuir reusa atualizar_work_item). 2 RPCs de LEITURA NOVAS INVOKER (sob RLS):
--   meu_dia_resumo() + meu_dia_itens(p_tipo, p_limit, p_offset).
--
-- REGRAS CANÔNICAS (idênticas ao resto do sistema — nada reinventado):
--   * MENÇÃO PENDENTE = menção a mim (mensagem_mencoes.mencionado_id = auth.uid()) numa mensagem
--     AINDA NÃO LIDA pelo cursor de leituras (MESMA semântica de nao_lidas 1.10: keyset (created_at,id)
--     vs a última lida; sem inventar coluna "lido"). Abrir a conversa (marcar_lido) já tira da lista.
--   * ATRASO = prazo_em is not null AND status not in ('concluido','cancelado') AND prazo_em < now()
--     (prazo_em é timestamptz => compara com now(), igual a Lista/Painel/Por funcionário/Kanban).
--   * TAREFA MINHA ATIVA = responsavel_id = auth.uid() AND status in ('aberto','em_andamento','bloqueado').
--   * "HOJE" das rotinas = dia local America/Fortaleza por LIMITES EXPLÍCITOS de timestamptz (v_ini/v_fim
--     em created_at — igual à 2.7, index-friendly); prioridade de estado concluido>em_andamento>pendente.
--     ROTINA PENDENTE = ativa, do MEU setor, com estado de hoje em ('pendente','em_andamento').
--   * MEU SETOR = perfis.setor do auth.uid(); comparado com o setor da rotina de forma NORMALIZADA
--     (btrim+lower) porque são DUAS fontes de texto livre (perfil x rotina) — mais tolerante de propósito
--     que o match exato usado dentro da própria área Rotinas. Setor vazio/null => 0 rotinas (estado "sem setor").
--
-- BADGE SEM DUPLA CONTAGEM (decisão de produto do spec): "Atrasadas" é SUBCONJUNTO de "Tarefas minhas
--   ativas" => o total global NÃO soma atrasadas de novo:
--     total_pendencias = total_mencoes + total_work_items_ativos + total_rotinas_pendentes
--   (total_atrasados é devolvido só para o card de destaque, nunca somado ao badge).
--
-- SEGURANÇA: as 2 funções são SECURITY INVOKER => rodam sob a RLS do usuário. Confirmado no schema:
--   mensagens_sel/mencoes_sel/leituras_sel/workitems_sel/rotinas_sel/rexec_sel já filtram por
--   pode_ver_topico / responsavel_id=auth.uid() / usuario. Guard de página em cada função por garantia.
--   No SQL Editor (auth.uid() NULL) as funções dão 42501 'sem acesso' — é o guard funcionando.
--
-- ADITIVO E IDEMPOTENTE. Uma transação. Nenhuma palavra-chave é schema-qualificada. Flag default OFF.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1) flag meu_dia_enabled (off). Independente de todas as outras flags.
-- ------------------------------------------------------------
insert into public.feature_flags(tenant_id, chave, habilitado)
values (public.current_tenant(), 'meu_dia_enabled', false)
on conflict (tenant_id, chave) do nothing;

-- ------------------------------------------------------------
-- 2) meu_dia_resumo — os 4 contadores + total (sem dupla contagem) + meu_setor. UMA chamada, sem N+1.
-- ------------------------------------------------------------
create or replace function public.meu_dia_resumo()
returns table (
  total_mencoes bigint, total_work_items_ativos bigint, total_atrasados bigint,
  total_rotinas_pendentes bigint, total_pendencias bigint, meu_setor text)
language plpgsql stable security invoker set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_tenant uuid := public.current_tenant();
  v_hoje   date := (now() at time zone 'America/Fortaleza')::date;
  v_ini    timestamptz := (v_hoje)::timestamp at time zone 'America/Fortaleza';       -- meia-noite local de hoje
  v_fim    timestamptz := (v_hoje + 1)::timestamp at time zone 'America/Fortaleza';   -- meia-noite local de amanhã
  v_setor  text;
  v_menc bigint; v_ativos bigint; v_atras bigint; v_rot bigint;
begin
  if not (public.pode_pagina('operacional') or public.sou_master()) then
    raise exception 'sem acesso' using errcode = '42501'; end if;

  select nullif(btrim(coalesce(pf.setor, '')), '') into v_setor from public.perfis pf where pf.id = v_uid;

  -- MENÇÕES pendentes (menção a mim numa mensagem não-lida; mesma semântica de nao_lidas)
  select count(*) into v_menc
    from public.mensagem_mencoes mm
    join public.mensagens m       on m.id = mm.mensagem_id
    left join public.leituras l   on l.topico_id = m.topico_id and l.usuario_id = v_uid
    left join public.mensagens lm on lm.id = l.ultima_lida_id
   where mm.tenant_id = v_tenant
     and mm.mencionado_id = v_uid
     and m.removido_em is null
     and m.tipo_conteudo <> 'sistema'
     and m.autor_id is distinct from v_uid
     and ( l.ultima_lida_id is null or (m.created_at, m.id) > (lm.created_at, lm.id) );

  -- TAREFAS MINHAS ATIVAS
  select count(*) into v_ativos
    from public.work_items w
   where w.tenant_id = v_tenant and w.responsavel_id = v_uid
     and w.status in ('aberto','em_andamento','bloqueado');

  -- ATRASADAS (subconjunto das minhas; regra canônica)
  select count(*) into v_atras
    from public.work_items w
   where w.tenant_id = v_tenant and w.responsavel_id = v_uid
     and w.prazo_em is not null and w.status not in ('concluido','cancelado') and w.prazo_em < now();

  -- ROTINAS PENDENTES do MEU SETOR hoje
  if v_setor is null then
    v_rot := 0;
  else
    select count(*) into v_rot from (
      select coalesce(ex.st, 'pendente') as st
        from public.rotinas r
        left join lateral (
            select e.status as st
              from public.rotinas_execucoes e
             where e.rotina_id = r.id and e.tenant_id = v_tenant
               and e.created_at >= v_ini and e.created_at < v_fim
             order by case e.status when 'concluido' then 0 when 'em_andamento' then 1 when 'cancelado' then 3 else 2 end asc,
                      e.created_at desc limit 1
        ) ex on true
       where r.tenant_id = v_tenant and r.ativo
         and btrim(lower(coalesce(r.setor, ''))) = btrim(lower(v_setor))
    ) s where s.st in ('pendente','em_andamento');
  end if;

  return query select v_menc, v_ativos, v_atras, v_rot,
                      (v_menc + v_ativos + v_rot),   -- badge SEM dupla contagem (atrasadas ⊆ ativas)
                      v_setor;
end $$;

-- ------------------------------------------------------------
-- 3) meu_dia_itens — a lista de UMA seção por vez (p_tipo). Formato unificado + total_count.
--    p_tipo: 'mencao' | 'work_item' | 'atrasado' | 'rotina'. Cada ramo retorna e sai (sem cair no raise).
-- ------------------------------------------------------------
create or replace function public.meu_dia_itens(
  p_tipo text default null, p_limit int default 50, p_offset int default 0)
returns table (
  item_tipo text, item_id uuid, titulo text, subtitulo text, status text, prioridade text,
  prazo_em timestamptz, occurred_at timestamptz, atrasado boolean,
  target_type text, target_id uuid, contexto_titulo text, contexto_tipo text,
  exec_aberta_id uuid, total_count bigint)
language plpgsql stable security invoker set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_tenant uuid := public.current_tenant();
  v_hoje   date := (now() at time zone 'America/Fortaleza')::date;
  v_ini    timestamptz := (v_hoje)::timestamp at time zone 'America/Fortaleza';
  v_fim    timestamptz := (v_hoje + 1)::timestamp at time zone 'America/Fortaleza';
  v_setor  text;
  v_lim int := greatest(1, least(coalesce(p_limit, 50), 100));
  v_off int := greatest(0, coalesce(p_offset, 0));
begin
  if not (public.pode_pagina('operacional') or public.sou_master()) then
    raise exception 'sem acesso' using errcode = '42501'; end if;

  if p_tipo = 'mencao' then
    return query
      select 'mencao'::text, m.id, coalesce(public.nome_de(m.autor_id), 'Alguém'),
             left(coalesce(m.corpo, ''), 140), null::text, null::text,
             null::timestamptz, m.created_at, null::boolean,
             'conversa'::text, t.id, t.titulo, t.tipo, null::uuid,
             count(*) over () as total_count
        from public.mensagem_mencoes mm
        join public.mensagens m       on m.id = mm.mensagem_id
        join public.topico t          on t.id = m.topico_id
        left join public.leituras l   on l.topico_id = m.topico_id and l.usuario_id = v_uid
        left join public.mensagens lm on lm.id = l.ultima_lida_id
       where mm.tenant_id = v_tenant
         and mm.mencionado_id = v_uid
         and m.removido_em is null
         and m.tipo_conteudo <> 'sistema'
         and m.autor_id is distinct from v_uid
         and ( l.ultima_lida_id is null or (m.created_at, m.id) > (lm.created_at, lm.id) )
       order by m.created_at desc, m.id desc
       limit v_lim offset v_off;
    return;
  end if;

  if p_tipo = 'work_item' then
    return query
      select 'work_item'::text, w.id, w.titulo, left(coalesce(w.descricao, ''), 140),
             w.status, w.prioridade, w.prazo_em, w.updated_at,
             (w.prazo_em is not null and w.status not in ('concluido','cancelado') and w.prazo_em < now()),
             'work_item'::text, w.id, null::text, w.tipo, null::uuid,
             count(*) over () as total_count
        from public.work_items w
       where w.tenant_id = v_tenant and w.responsavel_id = v_uid
         and w.status in ('aberto','em_andamento','bloqueado')
       order by (case w.prioridade when 'urgente' then 0 when 'alta' then 1 when 'normal' then 2 when 'baixa' then 3 else 4 end) asc,
                coalesce(w.prazo_em, 'infinity'::timestamptz) asc, w.updated_at desc, w.id desc
       limit v_lim offset v_off;
    return;
  end if;

  if p_tipo = 'atrasado' then
    return query
      select 'atrasado'::text, w.id, w.titulo, left(coalesce(w.descricao, ''), 140),
             w.status, w.prioridade, w.prazo_em, w.updated_at, true,
             'work_item'::text, w.id, null::text, w.tipo, null::uuid,
             count(*) over () as total_count
        from public.work_items w
       where w.tenant_id = v_tenant and w.responsavel_id = v_uid
         and w.prazo_em is not null and w.status not in ('concluido','cancelado') and w.prazo_em < now()
       order by w.prazo_em asc,
                (case w.prioridade when 'urgente' then 0 when 'alta' then 1 when 'normal' then 2 when 'baixa' then 3 else 4 end) asc,
                w.id desc
       limit v_lim offset v_off;
    return;
  end if;

  if p_tipo = 'rotina' then
    select nullif(btrim(coalesce(pf.setor, '')), '') into v_setor from public.perfis pf where pf.id = v_uid;
    if v_setor is null then return; end if;   -- sem setor => nenhuma rotina (o cliente mostra o estado "sem setor")
    return query
      with base as (
        select r.id, r.titulo, r.setor, r.ordem,
               ex.exec_id, coalesce(ex.st, 'pendente') as st
          from public.rotinas r
          left join lateral (
              select e.id as exec_id, e.status as st
                from public.rotinas_execucoes e
               where e.rotina_id = r.id and e.tenant_id = v_tenant
                 and e.created_at >= v_ini and e.created_at < v_fim
               order by case e.status when 'concluido' then 0 when 'em_andamento' then 1 when 'cancelado' then 3 else 2 end asc,
                        e.created_at desc limit 1
          ) ex on true
         where r.tenant_id = v_tenant and r.ativo
           and btrim(lower(coalesce(r.setor, ''))) = btrim(lower(v_setor))
      )
      select 'rotina'::text, b.id, b.titulo, coalesce(b.setor, '(sem setor)'),
             b.st, null::text, null::timestamptz, null::timestamptz, null::boolean,
             'rotina'::text, b.id, coalesce(b.setor, '(sem setor)'), null::text,
             (case when b.st = 'em_andamento' then b.exec_id else null end),
             count(*) over () as total_count
        from base b
       where b.st in ('pendente','em_andamento')
       order by b.ordem asc, b.titulo asc, b.id asc
       limit v_lim offset v_off;
    return;
  end if;

  raise exception 'tipo invalido' using errcode = '22023';
end $$;

-- ------------------------------------------------------------
-- 4) GRANTS
-- ------------------------------------------------------------
revoke all on function public.meu_dia_resumo() from public;
revoke all on function public.meu_dia_itens(text, int, int) from public;
grant execute on function public.meu_dia_resumo() to authenticated;
grant execute on function public.meu_dia_itens(text, int, int) to authenticated;

commit;

-- ============================================================
-- CONFERÊNCIA (no SQL Editor dá 42501 pois auth.uid() é NULL — guard funcionando):
--   select * from public.meu_dia_resumo();
--   select * from public.meu_dia_itens('work_item');
--   select chave, habilitado from public.feature_flags where chave = 'meu_dia_enabled';
--
-- ROLLBACK (desfazer só a 2.9):
-- drop function if exists public.meu_dia_itens(text, int, int);
-- drop function if exists public.meu_dia_resumo();
-- delete from public.feature_flags where chave = 'meu_dia_enabled';
-- ============================================================
