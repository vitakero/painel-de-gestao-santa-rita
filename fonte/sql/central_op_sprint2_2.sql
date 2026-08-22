-- ============================================================
-- CENTRAL OPERACIONAL — SPRINT 2.2 (DASHBOARD OPERACIONAL)
--
-- Só LEITURA e só AGREGAÇÃO dos work_items que já existem. Zero entidade nova, zero
-- tabela do ERP tocada, ZERO RPC de escrita. Duas funções INVOKER (a RLS da 2.0 decide
-- o que o usuário conta — "nunca mostrar item invisível" sai de graça).
--
-- SOBRE OS TEMPOS (decisão honesta): "tempo médio de RESOLUÇÃO" dá pra medir
-- (resolvido_em - created_at). Já "tempo em andamento" e "tempo até 1ª atribuição" NÃO:
-- o work_items só guarda resolvido_em — não há carimbo de quando entrou em andamento nem
-- de quando foi atribuído. Medir isso exigiria minerar o histórico de eventos (contra o
-- "prefira agregação única") OU coluna nova + mudar a RPC de escrita (esta sprint é
-- read-only). Ficam como limitação; se o Victor quiser, uma sprint futura adiciona
-- em_andamento_em/atribuido_em no fluxo de escrita.
--
-- PERFORMANCE: 1 passada agregada bate N listas. Não crio índice novo — contar por status
-- toca todas as linhas visíveis do tenant de qualquer jeito (o conjunto de um tenant é
-- pequeno); os índices parciais da 2.1 já cobrem os recortes quentes.
--
-- ADITIVO E IDEMPOTENTE. Uma transação. COMO USAR: rodar uma vez no Supabase.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1) dashboard_operacional — TODOS os indicadores numa CONSULTA SÓ (count(*) filter).
--    INVOKER: conta apenas o que a RLS de work_items deixa o usuário ver.
--    "hoje" é o dia LOCAL (America/Fortaleza) — a lição de fuso da 2.1.
--    Contadores de trabalho (alta/urgente/meus/sem_resp) excluem concluído/cancelado:
--    "urgente" que já foi resolvido não é fila de trabalho.
-- ------------------------------------------------------------
create or replace function public.dashboard_operacional()
returns table (
  abertos int, em_andamento int, bloqueados int, concluidos_hoje int, cancelados int,
  atrasados int, alta int, urgente int, meus int, sem_responsavel int,
  ativos int, resolucao_media_seg bigint, resolucao_amostra int)
language plpgsql stable security invoker set search_path = public as $$
begin
  if not (public.pode_pagina('operacional') or public.sou_master()) then
    raise exception 'sem acesso' using errcode = '42501';
  end if;
  return query
    select
      count(*) filter (where w.status = 'aberto')::int,
      count(*) filter (where w.status = 'em_andamento')::int,
      count(*) filter (where w.status = 'bloqueado')::int,
      count(*) filter (where w.status = 'concluido' and w.resolvido_em >=
                       date_trunc('day', now() at time zone 'America/Fortaleza') at time zone 'America/Fortaleza')::int,
      count(*) filter (where w.status = 'cancelado')::int,
      count(*) filter (where w.prazo_em is not null and w.status not in ('concluido','cancelado')
                       and w.prazo_em < now())::int,
      count(*) filter (where w.prioridade = 'alta' and w.status not in ('concluido','cancelado'))::int,
      count(*) filter (where w.prioridade = 'urgente' and w.status not in ('concluido','cancelado'))::int,
      count(*) filter (where w.responsavel_id = auth.uid() and w.status not in ('concluido','cancelado'))::int,
      count(*) filter (where w.responsavel_id is null and w.status not in ('concluido','cancelado'))::int,
      count(*) filter (where w.status in ('aberto','em_andamento','bloqueado'))::int,
      -- média de resolução: só faz sentido sobre concluídos; devolvo também a amostra
      -- (quantos concluídos entraram na conta) p/ o cliente não exibir média de 3 itens como verdade.
      -- só entram na média os concluídos com resolvido_em >= created_at: um carimbo editado
      -- à mão ou relógio torto poderia gerar duração negativa e uma "média" enganosa.
      coalesce(avg(extract(epoch from (w.resolvido_em - w.created_at)))
               filter (where w.status = 'concluido' and w.resolvido_em is not null
                       and w.resolvido_em >= w.created_at), 0)::bigint,
      count(*) filter (where w.status = 'concluido' and w.resolvido_em is not null
                       and w.resolvido_em >= w.created_at)::int
    from public.work_items w;
end $$;

-- ------------------------------------------------------------
-- 2) dashboard_agrupado — distribuição do trabalho ATIVO por uma dimensão escolhida.
--    UMA RPC flexível em vez de quatro (o "prefira agregação única" da spec).
--    dimensões: 'status' | 'prioridade' | 'tipo' | 'responsavel'.
--    'contexto' fica FORA (dependeria das tabelas do ERP, que a spec proíbe agrupar aqui).
-- ------------------------------------------------------------
create or replace function public.dashboard_agrupado(p_dim text)
returns table (chave text, rotulo text, quantidade int)
language plpgsql stable security invoker set search_path = public as $$
begin
  if not (public.pode_pagina('operacional') or public.sou_master()) then
    raise exception 'sem acesso' using errcode = '42501';
  end if;
  if p_dim not in ('status','prioridade','tipo','responsavel') then
    raise exception 'dimensao invalida' using errcode = '22023';
  end if;

  if p_dim = 'status' then
    -- status inclui todos os estados (não só ativos): é o retrato completo.
    return query
      select w.status, w.status, count(*)::int
        from public.work_items w group by w.status order by count(*) desc;
  elsif p_dim = 'prioridade' then
    return query
      select w.prioridade, w.prioridade, count(*)::int
        from public.work_items w
       where w.status in ('aberto','em_andamento','bloqueado')
       group by w.prioridade order by public.wi_pri_rank(w.prioridade);
  elsif p_dim = 'tipo' then
    return query
      select w.tipo, w.tipo, count(*)::int
        from public.work_items w
       where w.status in ('aberto','em_andamento','bloqueado')
       group by w.tipo order by count(*) desc;
  else  -- responsavel: SEM limite (um supermercado tem poucas dezenas de pessoas; truncar
        -- em 12 escondia responsáveis em silêncio e as barras não somariam o total de ativos).
    return query
      select coalesce(w.responsavel_id::text, 'sem'),
             coalesce((select pf.nome from public.perfis pf where pf.id = w.responsavel_id), 'Sem responsável'),
             count(*)::int
        from public.work_items w
       where w.status in ('aberto','em_andamento','bloqueado')
       group by w.responsavel_id
       order by count(*) desc;
  end if;
end $$;

-- ------------------------------------------------------------
-- 3) GRANTS
-- ------------------------------------------------------------
revoke all on function public.dashboard_operacional() from public;
revoke all on function public.dashboard_agrupado(text) from public;
grant execute on function public.dashboard_operacional() to authenticated;
grant execute on function public.dashboard_agrupado(text) to authenticated;

commit;

-- ============================================================
-- CONFERÊNCIA (fora da transação; dá 42501 no SQL Editor = guard funcionando):
--   select * from public.dashboard_operacional();
--   select * from public.dashboard_agrupado('prioridade');
--
-- ROLLBACK (desfazer só a 2.2):
-- drop function if exists public.dashboard_operacional();
-- drop function if exists public.dashboard_agrupado(text);
-- ============================================================
