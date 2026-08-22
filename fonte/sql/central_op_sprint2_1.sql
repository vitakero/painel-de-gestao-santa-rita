-- ============================================================
-- CENTRAL OPERACIONAL — SPRINT 2.1 (KANBAN OPERACIONAL)
--
-- SEM modelo novo: o Kanban é só uma VISUALIZAÇÃO dos mesmos work_items da 2.0.
-- Nenhuma tabela criada, nenhuma tabela do ERP tocada, nenhuma RPC de escrita nova
-- (mover card = transicionar_work_item; assumir = atualizar_work_item, ambas da 2.0).
--
-- POR QUE kanban_coluna EXISTE (a spec só autoriza criar se work_items_pagina não servir):
--   work_items_pagina ordena por (updated_at desc, id desc) e o cursor dela é esse par.
--   O Kanban exige ordem por prioridade -> prazo -> recência, e um cursor de outra ordem
--   PULA E REPETE itens. Além disso ela não tem filtro de prazo nem "sem responsável"
--   (lá, null = "sem filtro"). São incompatibilidades de contrato, não preguiça.
--
-- DECISÃO DE ORDENAÇÃO (importante): "atrasados primeiro, menor prazo primeiro, sem prazo
--   depois" é exatamente coalesce(prazo_em,'infinity') ASC. Fazer assim mantém o "atrasado"
--   FORA da chave de paginação — ele deriva de now(), é MUTÁVEL, e um item que vence no meio
--   da rolagem quebraria o keyset (item repetido ou pulado).
--
-- ATENÇÃO PERMANENTE: wi_pri_rank entra num ÍNDICE DE EXPRESSÃO. Trocar o corpo dela NÃO
--   reconstrói o índice — o planner passaria a confiar num valor que não é mais o gravado, e o
--   resultado ficaria ERRADO (não só lento). Se um dia mudar a ordem de prioridade, é obrigatório
--   drop + create do índice na MESMA transação.
--
-- ADITIVO E IDEMPOTENTE. Uma transação. COMO USAR: rodar uma vez no Supabase.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1) Ordem canônica de prioridade, como função IMMUTABLE — precisa ser immutable para
--    poder entrar no índice de expressão do passo 3.
-- ------------------------------------------------------------
create or replace function public.wi_pri_rank(p text)
returns int language sql immutable set search_path = public as $$
  select case p when 'urgente' then 1 when 'alta' then 2 when 'normal' then 3 else 4 end;
$$;

-- ------------------------------------------------------------
-- 2) kanban_coluna — uma página de UMA coluna. INVOKER: a RLS de work_items (2.0) é quem
--    decide o que aparece, então card e contador enxergam exatamente o mesmo conjunto.
--
--    p_prazo: null|'todos' | 'atrasados' | 'hoje' | '7dias' | 'sem'
--    p_sem_responsavel: true = SOMENTE itens sem responsável (null em p_responsavel_id
--    significa "sem filtro", por isso o parâmetro separado).
--
--    Duas ordenações, conforme a spec:
--      concluido -> resolvido_em desc, id desc
--      demais    -> pri_rank asc, prazo asc, updated_at desc, id desc
-- ------------------------------------------------------------
drop function if exists public.kanban_coluna(text, uuid, boolean, text, text, text, int, timestamptz, timestamptz, uuid, int);
create function public.kanban_coluna(
  p_status text,
  p_responsavel_id uuid default null,
  p_sem_responsavel boolean default false,
  p_prioridade text default null,
  p_tipo text default null,
  p_prazo text default null,
  p_cursor_pri int default null,
  p_cursor_prazo timestamptz default null,
  p_cursor_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limite int default 20)
returns table (id uuid, tipo text, titulo text, status text, prioridade text,
               responsavel_id uuid, responsavel_nome text, prazo_em timestamptz,
               criado_em timestamptz, atualizado_em timestamptz, concluido_em timestamptz,
               topico_id uuid, contexto int, atrasado boolean, tem_conversa boolean,
               pri_rank int, prazo_ord timestamptz)
language plpgsql stable security invoker
set search_path = public set plan_cache_mode = 'force_custom_plan' as $$
declare v_lim int := greatest(1, least(coalesce(p_limite, 20), 50));
begin
  -- 'cancelado' NÃO é coluna do quadro (fica só no contador). Aceitá-lo aqui daria uma
  -- consulta sem índice (o parcial cobre só os 3 ativos) por um caminho que a UI não usa.
  if p_status not in ('aberto','em_andamento','bloqueado','concluido') then
    raise exception 'status invalido para o quadro' using errcode = '22023';
  end if;
  if p_prazo is not null and p_prazo not in ('todos','atrasados','hoje','7dias','sem') then
    raise exception 'filtro de prazo invalido' using errcode = '22023';
  end if;

  -- DOIS RAMOS de propósito. Um ORDER BY com CASE dentro (para servir as duas ordens numa
  -- consulta só) é opaco para o planner: ele NÃO casa com índice nenhum e vira Sort completo,
  -- justamente o que os índices do passo 3 existem para evitar. Cada ramo abaixo tem um
  -- ORDER BY literal que casa 1:1 com o seu índice parcial.
  if p_status = 'concluido' then
    return query
      select w.id, w.tipo, w.titulo, w.status, w.prioridade, w.responsavel_id,
             (select pf.nome from public.perfis pf where pf.id = w.responsavel_id),
             w.prazo_em, w.created_at, w.updated_at, w.resolvido_em, w.topico_id,
             (select count(*)::int from public.vinculo v where v.work_item_id = w.id),
             false,                                   -- concluído nunca conta como atrasado
             (w.topico_id is not null),
             public.wi_pri_rank(w.prioridade),
             coalesce(w.prazo_em, 'infinity'::timestamptz)
        from public.work_items w
       where w.status = 'concluido'
         and (p_responsavel_id is null or w.responsavel_id = p_responsavel_id)
         and (not coalesce(p_sem_responsavel, false) or w.responsavel_id is null)
         and (p_prioridade is null or w.prioridade = p_prioridade)
         and (p_tipo is null or w.tipo = p_tipo)
         -- 'atrasados' NÃO é pass-through aqui: concluído nunca é atrasado (o card diria
         --  uma coisa e o contador outra). Sem ramo verdadeiro, a coluna vem vazia = contador 0.
         and ( p_prazo is null or p_prazo = 'todos'
            or (p_prazo = 'hoje'  and w.prazo_em >= date_trunc('day', now() at time zone 'America/Fortaleza') at time zone 'America/Fortaleza'
                and w.prazo_em <  date_trunc('day', now() at time zone 'America/Fortaleza') at time zone 'America/Fortaleza' + interval '1 day')
            or (p_prazo = '7dias' and w.prazo_em >= now() and w.prazo_em < now() + interval '7 days')
            or (p_prazo = 'sem'   and w.prazo_em is null) )
         and (p_cursor_at is null or (w.resolvido_em, w.id) < (p_cursor_at, p_cursor_id))
       order by w.resolvido_em desc, w.id desc
       limit v_lim;
    return;
  end if;

  return query
    select w.id, w.tipo, w.titulo, w.status, w.prioridade, w.responsavel_id,
           (select pf.nome from public.perfis pf where pf.id = w.responsavel_id),
           w.prazo_em, w.created_at, w.updated_at, w.resolvido_em, w.topico_id,
           (select count(*)::int from public.vinculo v where v.work_item_id = w.id),
           (w.prazo_em is not null and w.status not in ('concluido','cancelado') and w.prazo_em < now()),
           (w.topico_id is not null),
           public.wi_pri_rank(w.prioridade),
           coalesce(w.prazo_em, 'infinity'::timestamptz)
      from public.work_items w
     where w.status = p_status
       and (p_responsavel_id is null or w.responsavel_id = p_responsavel_id)
       and (not coalesce(p_sem_responsavel, false) or w.responsavel_id is null)
       and (p_prioridade is null or w.prioridade = p_prioridade)
       and (p_tipo is null or w.tipo = p_tipo)
       and ( p_prazo is null or p_prazo = 'todos'
          or (p_prazo = 'atrasados' and w.prazo_em is not null and w.prazo_em < now()
              and w.status not in ('concluido','cancelado'))
          or (p_prazo = 'hoje'   and w.prazo_em >= date_trunc('day', now() at time zone 'America/Fortaleza') at time zone 'America/Fortaleza'
              and w.prazo_em <  date_trunc('day', now() at time zone 'America/Fortaleza') at time zone 'America/Fortaleza' + interval '1 day')
          or (p_prazo = '7dias'  and w.prazo_em >= now() and w.prazo_em < now() + interval '7 days')
          or (p_prazo = 'sem'    and w.prazo_em is null) )
       -- keyset da ordem (pri asc, prazo asc, updated desc, id desc), expandido em degraus
       and ( p_cursor_pri is null
          or public.wi_pri_rank(w.prioridade) > p_cursor_pri
          or (public.wi_pri_rank(w.prioridade) = p_cursor_pri
              and coalesce(w.prazo_em,'infinity'::timestamptz) > p_cursor_prazo)
          or (public.wi_pri_rank(w.prioridade) = p_cursor_pri
              and coalesce(w.prazo_em,'infinity'::timestamptz) = p_cursor_prazo
              and (w.updated_at, w.id) < (p_cursor_at, p_cursor_id)) )
     order by public.wi_pri_rank(w.prioridade) asc,
              coalesce(w.prazo_em,'infinity'::timestamptz) asc,
              w.updated_at desc, w.id desc
     limit v_lim;
end $$;

-- ------------------------------------------------------------
-- 3) ÍNDICES — só os dois que casam EXATAMENTE com as duas ordenações acima.
--    Parciais de propósito: o quadro ativo é pequeno e permanente; os concluídos crescem
--    para sempre e não podem pesar na consulta de trabalho ativo.
--    (Não duplicam nada da 1.14/2.0: aqueles ordenam por updated_at, estes por prioridade+prazo.)
-- ------------------------------------------------------------
create index if not exists ix_workitems_kanban_ativo
  on public.work_items (tenant_id, status, public.wi_pri_rank(prioridade),
                        (coalesce(prazo_em, 'infinity'::timestamptz)), updated_at desc, id desc)
  where status in ('aberto','em_andamento','bloqueado');

create index if not exists ix_workitems_kanban_concluido
  on public.work_items (tenant_id, resolvido_em desc, id desc)
  where status = 'concluido';

-- ------------------------------------------------------------
-- 4) kanban_contadores — contagem AUTORITATIVA por status, com EXATAMENTE os mesmos
--    filtros e a MESMA visibilidade (INVOKER + RLS) dos cards. Se card e contador
--    divergissem, o quadro mentiria.
--    Teto de 100 por status: o cliente mostra "99+" (a coluna de concluídos cresce sem fim
--    e ninguém precisa do número exato).
-- ------------------------------------------------------------
drop function if exists public.kanban_contadores(uuid, boolean, text, text, text);
create function public.kanban_contadores(
  p_responsavel_id uuid default null, p_sem_responsavel boolean default false,
  p_prioridade text default null, p_tipo text default null, p_prazo text default null)
returns table (status text, quantidade int)
language plpgsql stable security invoker
set search_path = public set plan_cache_mode = 'force_custom_plan' as $$
begin
  if p_prazo is not null and p_prazo not in ('todos','atrasados','hoje','7dias','sem') then
    raise exception 'filtro de prazo invalido' using errcode = '22023';
  end if;
  return query
    select s.st, c.qtd
      from (values ('aberto'),('em_andamento'),('bloqueado'),('concluido'),('cancelado')) as s(st)
      cross join lateral (
        select count(*)::int as qtd from (
          select 1 from public.work_items w
           where w.status = s.st
             and (p_responsavel_id is null or w.responsavel_id = p_responsavel_id)
             and (not coalesce(p_sem_responsavel, false) or w.responsavel_id is null)
             and (p_prioridade is null or w.prioridade = p_prioridade)
             and (p_tipo is null or w.tipo = p_tipo)
             and ( p_prazo is null or p_prazo = 'todos'
                or (p_prazo = 'atrasados' and w.prazo_em is not null and w.prazo_em < now()
                    and w.status not in ('concluido','cancelado'))
                or (p_prazo = 'hoje'   and w.prazo_em >= date_trunc('day', now() at time zone 'America/Fortaleza') at time zone 'America/Fortaleza'
                    and w.prazo_em <  date_trunc('day', now() at time zone 'America/Fortaleza') at time zone 'America/Fortaleza' + interval '1 day')
                or (p_prazo = '7dias'  and w.prazo_em >= now() and w.prazo_em < now() + interval '7 days')
                or (p_prazo = 'sem'    and w.prazo_em is null) )
           limit 100                                  -- teto: o cliente exibe "99+"
        ) x
      ) c;
end $$;

-- ------------------------------------------------------------
-- 5) GRANTS
-- ------------------------------------------------------------
revoke all on function public.wi_pri_rank(text) from public;
revoke all on function public.kanban_coluna(text, uuid, boolean, text, text, text, int, timestamptz, timestamptz, uuid, int) from public;
revoke all on function public.kanban_contadores(uuid, boolean, text, text, text) from public;
grant execute on function public.wi_pri_rank(text) to authenticated;
grant execute on function public.kanban_coluna(text, uuid, boolean, text, text, text, int, timestamptz, timestamptz, uuid, int) to authenticated;
grant execute on function public.kanban_contadores(uuid, boolean, text, text, text) to authenticated;

commit;

-- ============================================================
-- CONFERÊNCIA (fora da transação):
--   select * from public.kanban_contadores();            -- 5 linhas (dá 42501 no SQL Editor: é o guard da RLS/página funcionando)
--   select indexdef from pg_indexes where indexname like 'ix_workitems_kanban%';
--
-- ROLLBACK (desfazer só a 2.1):
-- drop function if exists public.kanban_coluna(text, uuid, boolean, text, text, text, int, timestamptz, timestamptz, uuid, int);
-- drop function if exists public.kanban_contadores(uuid, boolean, text, text, text);
-- drop index if exists public.ix_workitems_kanban_ativo;
-- drop index if exists public.ix_workitems_kanban_concluido;
-- drop function if exists public.wi_pri_rank(text);
-- ============================================================
