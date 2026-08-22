-- ============================================================
-- ENTREGAS v3 · ARQUIVO 3 de 3 — ESPELHO, FECHAR E REABRIR
--
-- Rode DEPOIS dos arquivos 1 e 2. Aditivo e idempotente.
--
-- DESFAZER:
--   drop function if exists public.entregas_reabrir_mes(uuid,int,int,text);
--   drop function if exists public.entregas_fechar_mes(uuid,int,int);
--   drop function if exists public.entregas_pendencias_mes(int,int);
--   drop function if exists public.entregas_espelho_mes(int,int);
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1) ESPELHO DO MÊS — a tabela por entregador com faixa e valor.
--    Quem NÃO é master recebe as colunas de dinheiro NULAS. O servidor esconde.
--    Mês fechado devolve o que foi CONGELADO, nunca recalcula com a config de hoje.
-- ------------------------------------------------------------
create or replace function public.entregas_espelho_mes(p_ano integer, p_mes integer)
returns table (entregador_id uuid, nome text, ativo boolean, entregas integer,
               dias_com_lancamento integer, faixa text,
               valor_unitario numeric, valor_total numeric,
               meta_base_qtd integer, meta_desafio_qtd integer,
               fechado boolean, sou_master boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_m boolean; v_t uuid; v_comp date; v_fech boolean;
        v_b int; v_d int; v_vb numeric; v_vd numeric;
begin
  if auth.uid() is null then raise exception 'Entre no painel.' using errcode='28000'; end if;
  if not public.pode_pagina('entregas') then
    raise exception 'Seu acesso não inclui a página de Entregas.' using errcode='42501';
  end if;
  v_m := public.entregas_sou_master();
  v_t := public.current_tenant();
  v_comp := make_date(p_ano, p_mes, 1);
  v_fech := public.entregas_mes_fechado(p_ano, p_mes);

  if v_fech then
    -- mês fechado: vale o que foi congelado
    select c.meta_base_qtd, c.meta_desafio_qtd, c.valor_base, c.valor_desafio
      into v_b, v_d, v_vb, v_vd
      from public.entregas_competencia c
     where c.tenant_id = v_t and c.competencia = v_comp;
  else
    select cf.meta_base_qtd, cf.meta_desafio_qtd, cf.valor_base, cf.valor_desafio
      into v_b, v_d, v_vb, v_vd
      from public.entregas_config cf
     where cf.tenant_id = v_t and cf.competencia <= v_comp
     order by cf.competencia desc limit 1;
  end if;

  return query
  with tot as (
    select l.entregador_id,
           max(coalesce(e.nome, l.nome_snapshot)) as nome,
           bool_or(coalesce(e.ativo,false))       as ativo,
           sum(l.quantidade)::int                 as entregas,
           count(*)::int                          as dias
      from public.entregas_lancamentos l
      left join public.entregas_equipe e on e.id = l.entregador_id
     where l.tenant_id = v_t and l.ano = p_ano and l.mes = p_mes
     group by l.entregador_id
  )
  select t.entregador_id, t.nome, t.ativo, t.entregas, t.dias,
         f.faixa,
         case when v_m then f.valor_unitario else null::numeric end,
         case when v_m then f.valor_total    else null::numeric end,
         v_b, v_d, v_fech, v_m
    from tot t
    cross join lateral public.entregas_calc_faixa(t.entregas, v_b, v_d, v_vb, v_vd) f
   order by t.entregas desc, t.nome;
end $$;

-- ------------------------------------------------------------
-- 2) O QUE IMPEDE O FECHAMENTO. Devolve a lista de pendências; vazia = pode fechar.
--    Dias sem lançamento e lançamento em domingo/feriado são conferidos aqui, no
--    servidor. Feriado o banco não conhece: o cliente manda os dias fechados extras.
-- ------------------------------------------------------------
create or replace function public.entregas_pendencias_mes(p_ano integer, p_mes integer, p_dias_fechados integer[] default '{}')
returns table (tipo text, detalhe text)
language plpgsql stable security definer set search_path = public as $$
declare v_t uuid; v_comp date; v_ult date; v_d date; v_hoje date;
begin
  if auth.uid() is null then raise exception 'Entre no painel.' using errcode='28000'; end if;
  if not public.pode_pagina('entregas') then
    raise exception 'Seu acesso não inclui a página de Entregas.' using errcode='42501';
  end if;
  v_t := public.current_tenant();
  v_comp := make_date(p_ano, p_mes, 1);
  v_ult := (v_comp + interval '1 month - 1 day')::date;
  v_hoje := (now() at time zone 'America/Recife')::date;

  -- configuração
  if not exists (select 1 from public.entregas_config c
                  where c.tenant_id = v_t and c.competencia <= v_comp) then
    return query select 'config'::text, 'Nenhuma configuração de metas e valores foi definida.'::text;
  end if;

  -- dias úteis passados sem lançamento nenhum
  for v_d in select d::date from generate_series(v_comp, least(v_ult, v_hoje - 1), interval '1 day') d loop
    if extract(dow from v_d) <> 0
       and not (extract(day from v_d)::int = any(coalesce(p_dias_fechados,'{}')))
       and not exists (select 1 from public.entregas_lancamentos l
                        where l.tenant_id = v_t and l.ano = p_ano and l.mes = p_mes
                          and l.dia = extract(day from v_d)::int) then
      return query select 'dia_sem_lancamento'::text,
                          ('Dia ' || lpad(extract(day from v_d)::text,2,'0') || ' sem lançamento.')::text;
    end if;
  end loop;

  -- lançamento em domingo ou em dia marcado como fechado
  return query
  select 'dia_fechado'::text,
         ('Há lançamento no dia ' || lpad(l.dia::text,2,'0') || ', que é dia fechado.')::text
    from (select distinct l.dia from public.entregas_lancamentos l
           where l.tenant_id = v_t and l.ano = p_ano and l.mes = p_mes and l.quantidade > 0) l
   where extract(dow from make_date(p_ano, p_mes, l.dia)) = 0
      or l.dia = any(coalesce(p_dias_fechados,'{}'));

  -- entregador órfão (lançamento sem cadastro)
  return query
  select 'orfao'::text, 'Existe lançamento sem entregador cadastrado.'::text
   where exists (select 1 from public.entregas_lancamentos l
                  where l.tenant_id = v_t and l.ano = p_ano and l.mes = p_mes
                    and not exists (select 1 from public.entregas_equipe e where e.id = l.entregador_id));
end $$;

-- ------------------------------------------------------------
-- 3) FECHAR. Congela metas, valores, totais e o espelho por entregador.
-- ------------------------------------------------------------
create or replace function public.entregas_fechar_mes(p_request_id uuid, p_ano integer, p_mes integer,
                                                      p_dias_fechados integer[] default '{}')
returns void language plpgsql security definer set search_path = public as $$
declare v_t uuid; v_comp date; v_pend text; v_b int; v_d int; v_vb numeric; v_vd numeric;
        v_tot int; v_val numeric; v_det jsonb;
begin
  if auth.uid() is null then raise exception 'Entre no painel.' using errcode='28000'; end if;
  if not public.entregas_sou_master() then
    raise exception 'Só o administrador fecha o mês.' using errcode='42501';
  end if;
  v_t := public.current_tenant(); v_comp := make_date(p_ano, p_mes, 1);

  if public.entregas_mes_fechado(p_ano, p_mes) then return; end if;   -- fechar 2x não dá erro

  select string_agg(detalhe, ' | ') into v_pend
    from public.entregas_pendencias_mes(p_ano, p_mes, p_dias_fechados);
  if v_pend is not null then
    raise exception 'Não foi possível fechar %/%: %', p_mes, p_ano, v_pend using errcode='23514';
  end if;

  if not public.entregas_marcar_intencao(p_request_id, 'fechar_mes') then return; end if;

  select cf.meta_base_qtd, cf.meta_desafio_qtd, cf.valor_base, cf.valor_desafio
    into v_b, v_d, v_vb, v_vd
    from public.entregas_config cf
   where cf.tenant_id = v_t and cf.competencia <= v_comp
   order by cf.competencia desc limit 1;

  with tot as (
    select l.entregador_id,
           max(coalesce(e.nome, l.nome_snapshot)) as nome,
           sum(l.quantidade)::int as entregas,
           count(*)::int as dias
      from public.entregas_lancamentos l
      left join public.entregas_equipe e on e.id = l.entregador_id
     where l.tenant_id = v_t and l.ano = p_ano and l.mes = p_mes
     group by l.entregador_id
  ), calc as (
    select t.*, f.faixa, f.valor_unitario, f.valor_total
      from tot t cross join lateral public.entregas_calc_faixa(t.entregas, v_b, v_d, v_vb, v_vd) f
  )
  select coalesce(sum(entregas),0), coalesce(sum(valor_total),0),
         coalesce(jsonb_agg(jsonb_build_object(
           'entregador_id', entregador_id, 'nome', nome, 'entregas', entregas,
           'dias_com_lancamento', dias, 'faixa', faixa,
           'valor_unitario', valor_unitario, 'valor_total', valor_total)), '[]'::jsonb)
    into v_tot, v_val, v_det
    from calc;

  insert into public.entregas_competencia as c
    (tenant_id, competencia, status, fechado_por, fechado_em,
     meta_base_qtd, meta_desafio_qtd, valor_base, valor_desafio,
     total_entregas, total_remuneracao, detalhe)
  values (v_t, v_comp, 'fechado', auth.uid(), now(), v_b, v_d, v_vb, v_vd, v_tot, v_val, v_det)
  on conflict (tenant_id, competencia) do update
    set status='fechado', fechado_por=auth.uid(), fechado_em=now(),
        meta_base_qtd=excluded.meta_base_qtd, meta_desafio_qtd=excluded.meta_desafio_qtd,
        valor_base=excluded.valor_base, valor_desafio=excluded.valor_desafio,
        total_entregas=excluded.total_entregas, total_remuneracao=excluded.total_remuneracao,
        detalhe=excluded.detalhe, atualizado_em=now();

  insert into public.eventos (event_uuid, tenant_id, tipo, entity_type, entity_id,
                              autor_id, setor, resumo, payload)
  values (gen_random_uuid(), v_t, 'entregas.mes_fechado', 'entregas_competencia',
          to_char(v_comp,'YYYY-MM'), auth.uid(), 'Entregas',
          'Mês ' || to_char(v_comp,'MM/YYYY') || ' fechado: ' || v_tot || ' entregas',
          jsonb_build_object('competencia', to_char(v_comp,'YYYY-MM'),
                             'meta_base_qtd', v_b, 'meta_desafio_qtd', v_d,
                             'valor_base', v_vb, 'valor_desafio', v_vd,
                             'total_entregas', v_tot, 'total_remuneracao', v_val,
                             'request_id', p_request_id));
end $$;

-- ------------------------------------------------------------
-- 4) REABRIR. Só master, motivo obrigatório, e o fechamento anterior NÃO some da
--    auditoria — fica no livro de eventos.
-- ------------------------------------------------------------
create or replace function public.entregas_reabrir_mes(p_request_id uuid, p_ano integer, p_mes integer, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare v_t uuid; v_comp date; v_ant jsonb;
begin
  if auth.uid() is null then raise exception 'Entre no painel.' using errcode='28000'; end if;
  if not public.entregas_sou_master() then
    raise exception 'Só o administrador reabre um mês.' using errcode='42501';
  end if;
  if coalesce(btrim(p_motivo),'') = '' then
    raise exception 'Diga o motivo da reabertura.' using errcode='22004';
  end if;
  v_t := public.current_tenant(); v_comp := make_date(p_ano, p_mes, 1);

  if not public.entregas_mes_fechado(p_ano, p_mes) then return; end if;
  if not public.entregas_marcar_intencao(p_request_id, 'reabrir_mes') then return; end if;

  select jsonb_build_object('fechado_por', c.fechado_por, 'fechado_em', c.fechado_em,
                            'total_entregas', c.total_entregas, 'total_remuneracao', c.total_remuneracao,
                            'meta_base_qtd', c.meta_base_qtd, 'meta_desafio_qtd', c.meta_desafio_qtd,
                            'valor_base', c.valor_base, 'valor_desafio', c.valor_desafio)
    into v_ant
    from public.entregas_competencia c
   where c.tenant_id = v_t and c.competencia = v_comp;

  update public.entregas_competencia
     set status='aberto', reaberto_por=auth.uid(), reaberto_em=now(),
         motivo_reabertura=btrim(p_motivo), atualizado_em=now()
   where tenant_id = v_t and competencia = v_comp;

  insert into public.eventos (event_uuid, tenant_id, tipo, entity_type, entity_id,
                              autor_id, setor, resumo, payload)
  values (gen_random_uuid(), v_t, 'entregas.mes_reaberto', 'entregas_competencia',
          to_char(v_comp,'YYYY-MM'), auth.uid(), 'Entregas',
          'Mês ' || to_char(v_comp,'MM/YYYY') || ' reaberto: ' || btrim(p_motivo),
          jsonb_build_object('competencia', to_char(v_comp,'YYYY-MM'),
                             'motivo', btrim(p_motivo),
                             'fechamento_anterior', v_ant,
                             'request_id', p_request_id));
end $$;

revoke all on function public.entregas_espelho_mes(int,int)                     from public, anon;
revoke all on function public.entregas_pendencias_mes(int,int,integer[])        from public, anon;
revoke all on function public.entregas_fechar_mes(uuid,int,int,integer[])       from public, anon;
revoke all on function public.entregas_reabrir_mes(uuid,int,int,text)           from public, anon;
grant execute on function public.entregas_espelho_mes(int,int)                  to authenticated;
grant execute on function public.entregas_pendencias_mes(int,int,integer[])     to authenticated;
grant execute on function public.entregas_fechar_mes(uuid,int,int,integer[])    to authenticated;
grant execute on function public.entregas_reabrir_mes(uuid,int,int,text)        to authenticated;

commit;

select 'funções v3 criadas' as o_que,
       (select count(*)::text from information_schema.routines
         where routine_schema='public'
           and routine_name in ('entregas_sou_master','entregas_calc_faixa','entregas_salvar_config',
                                'entregas_config_do_mes','entregas_mes_fechado','entregas_espelho_mes',
                                'entregas_pendencias_mes','entregas_fechar_mes','entregas_reabrir_mes'))
       || ' de 9' as valor;
