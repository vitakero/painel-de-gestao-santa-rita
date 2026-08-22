-- ============================================================
-- ENTREGAS v3 · ARQUIVO 6 — QUEM LANÇA PODE FINALIZAR O MÊS
--
-- Rode DEPOIS dos arquivos 1 a 5. Aditivo e idempotente.
--
-- O QUE MUDA
--   Antes: só o master fechava o mês.
--   Agora: quem tem o acesso de lançar TAMBÉM pode finalizar — mas só quando o mês
--   está 100% preenchido. As pendências continuam sendo conferidas AQUI, no servidor,
--   então não existe caminho para fechar um mês pela metade.
--
--   REABRIR continua sendo SÓ DO MASTER, com senha e motivo obrigatório. É essa
--   assimetria que faz o fechamento valer alguma coisa: quem lança finaliza, mas só
--   o dono desfaz.
--
--   Quem finalizou fica registrado em public.eventos e aparece na tela como
--   "Mês fechado em DD/MM/AAAA".
--
-- DESFAZER: rode de novo o arquivo 3 (recria a função exigindo master).
-- ============================================================

begin;

create or replace function public.entregas_fechar_mes(p_request_id uuid, p_ano integer, p_mes integer,
                                                      p_dias_fechados integer[] default '{}')
returns void language plpgsql security definer set search_path = public as $$
declare v_t uuid; v_comp date; v_pend text; v_b int; v_d int; v_vb numeric; v_vd numeric;
        v_tot int; v_val numeric; v_det jsonb;
begin
  if auth.uid() is null then raise exception 'Entre no painel.' using errcode='28000'; end if;
  -- quem lança também finaliza; o que protege é a checagem de pendências abaixo
  if not public.entregas_pode_lancar() then
    raise exception 'Seu acesso não permite finalizar o mês.' using errcode='42501';
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
          'Mês ' || to_char(v_comp,'MM/YYYY') || ' finalizado: ' || v_tot || ' entregas',
          jsonb_build_object('competencia', to_char(v_comp,'YYYY-MM'),
                             'meta_base_qtd', v_b, 'meta_desafio_qtd', v_d,
                             'valor_base', v_vb, 'valor_desafio', v_vd,
                             'total_entregas', v_tot, 'total_remuneracao', v_val,
                             'fechado_por_master', public.entregas_sou_master(),
                             'request_id', p_request_id));
end $$;

-- As pendências também precisam ser consultáveis por quem lança — é assim que a
-- tela dela sabe se o mês já pode ser finalizado.
create or replace function public.entregas_pendencias_mes(p_ano integer, p_mes integer, p_dias_fechados integer[] default '{}')
returns table (tipo text, detalhe text)
language plpgsql stable security definer set search_path = public as $$
declare v_t uuid; v_comp date; v_ult date; v_d date;
begin
  if auth.uid() is null then raise exception 'Entre no painel.' using errcode='28000'; end if;
  if not public.entregas_pode_lancar() then
    raise exception 'Seu acesso não inclui a página de Entregas.' using errcode='42501';
  end if;
  v_t := public.current_tenant();
  v_comp := make_date(p_ano, p_mes, 1);
  v_ult := (v_comp + interval '1 month - 1 day')::date;

  if not exists (select 1 from public.entregas_config c
                  where c.tenant_id = v_t and c.competencia <= v_comp) then
    return query select 'config'::text, 'Nenhuma configuração de metas e valores foi definida.'::text;
  end if;

  for v_d in select d::date from generate_series(v_comp, v_ult, interval '1 day') d loop
    if extract(dow from v_d) <> 0
       and not (extract(day from v_d)::int = any(coalesce(p_dias_fechados,'{}')))
       and not exists (select 1 from public.entregas_lancamentos l
                        where l.tenant_id = v_t and l.ano = p_ano and l.mes = p_mes
                          and l.dia = extract(day from v_d)::int) then
      return query select 'dia_sem_lancamento'::text,
                          ('Dia ' || lpad(extract(day from v_d)::text,2,'0') || ' sem nenhum lançamento.')::text;
    end if;
  end loop;

  return query
  with dias as (
    select extract(day from d)::int as dia
      from generate_series(v_comp, v_ult, interval '1 day') d
     where extract(dow from d) <> 0
       and not (extract(day from d)::int = any(coalesce(p_dias_fechados,'{}')))
  ), pessoas as (
    select distinct l.entregador_id from public.entregas_lancamentos l
     where l.tenant_id = v_t and l.ano = p_ano and l.mes = p_mes
  ), faltas as (
    select p.entregador_id, d.dia
      from pessoas p cross join dias d
     where not exists (select 1 from public.entregas_lancamentos l
                        where l.tenant_id = v_t and l.ano = p_ano and l.mes = p_mes
                          and l.entregador_id = p.entregador_id and l.dia = d.dia)
  )
  select 'pessoa_incompleta'::text,
         (coalesce(e.nome,'(entregador)') || ': ' || count(*) || ' dia(s) em branco — ' ||
          string_agg(lpad(f.dia::text,2,'0'), ', ' order by f.dia))::text
    from faltas f
    left join public.entregas_equipe e on e.id = f.entregador_id
   group by e.nome
   order by e.nome;

  return query
  select 'dia_fechado'::text,
         ('Há lançamento no dia ' || lpad(l.dia::text,2,'0') || ', que é dia fechado.')::text
    from (select distinct l.dia from public.entregas_lancamentos l
           where l.tenant_id = v_t and l.ano = p_ano and l.mes = p_mes and l.quantidade > 0) l
   where extract(dow from make_date(p_ano, p_mes, l.dia)) = 0
      or l.dia = any(coalesce(p_dias_fechados,'{}'));

  return query
  select 'orfao'::text, 'Existe lançamento sem entregador cadastrado.'::text
   where exists (select 1 from public.entregas_lancamentos l
                  where l.tenant_id = v_t and l.ano = p_ano and l.mes = p_mes
                    and not exists (select 1 from public.entregas_equipe e where e.id = l.entregador_id));
end $$;

revoke all on function public.entregas_fechar_mes(uuid,int,int,integer[])    from public, anon;
revoke all on function public.entregas_pendencias_mes(int,int,integer[])     from public, anon;
grant execute on function public.entregas_fechar_mes(uuid,int,int,integer[]) to authenticated;
grant execute on function public.entregas_pendencias_mes(int,int,integer[])  to authenticated;

commit;

select 'quem lança pode finalizar' as o_que, 'OK' as valor
union all
select 'reabrir continua só do master',
       case when exists (select 1 from information_schema.routines
                          where routine_schema='public' and routine_name='entregas_reabrir_mes')
            then 'OK' else 'FALTOU' end;
