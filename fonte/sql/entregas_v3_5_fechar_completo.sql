-- ============================================================
-- ENTREGAS v3 · ARQUIVO 5 — SÓ FECHA COM O MÊS INTEIRO PREENCHIDO
--
-- Rode DEPOIS dos arquivos 1 a 4. Aditivo e idempotente.
--
-- O QUE MUDA
--   Antes: só cobrava os dias que JÁ TINHAM PASSADO. Dava pra fechar agosto no dia 6.
--   Agora: cobra TODOS os dias úteis do mês, e cobra de CADA ENTREGADOR que trabalhou
--   naquele mês. Dia em que a pessoa não fez entrega tem que estar com ZERO digitado —
--   célula em branco não é zero, é "ainda não apurado".
--
--   Na prática, só dá pra fechar depois que o mês acabou e a grade está completa.
--
-- DESFAZER: rode de novo o arquivo 3 (ele recria esta função na versão anterior).
-- ============================================================

begin;

create or replace function public.entregas_pendencias_mes(p_ano integer, p_mes integer, p_dias_fechados integer[] default '{}')
returns table (tipo text, detalhe text)
language plpgsql stable security definer set search_path = public as $$
declare v_t uuid; v_comp date; v_ult date; v_d date; v_uteis int;
begin
  if auth.uid() is null then raise exception 'Entre no painel.' using errcode='28000'; end if;
  if not public.pode_pagina('entregas') then
    raise exception 'Seu acesso não inclui a página de Entregas.' using errcode='42501';
  end if;
  v_t := public.current_tenant();
  v_comp := make_date(p_ano, p_mes, 1);
  v_ult := (v_comp + interval '1 month - 1 day')::date;

  -- 1) configuração de metas e valores
  if not exists (select 1 from public.entregas_config c
                  where c.tenant_id = v_t and c.competencia <= v_comp) then
    return query select 'config'::text, 'Nenhuma configuração de metas e valores foi definida.'::text;
  end if;

  -- 2) TODOS os dias úteis do mês precisam ter lançamento — inclusive os que ainda
  --    não chegaram. É isso que impede fechar um mês pela metade.
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

  -- quantos dias úteis o mês tem
  select count(*) into v_uteis
    from generate_series(v_comp, v_ult, interval '1 day') d
   where extract(dow from d) <> 0
     and not (extract(day from d)::int = any(coalesce(p_dias_fechados,'{}')));

  -- 3) cada entregador QUE TRABALHOU no mês precisa ter todos os dias úteis
  --    preenchidos. Quem não fez entrega no dia tem que estar com ZERO digitado.
  --    Quem não trabalhou no mês nenhum dia não entra na cobrança.
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

  -- 4) lançamento em domingo ou dia marcado como fechado
  return query
  select 'dia_fechado'::text,
         ('Há lançamento no dia ' || lpad(l.dia::text,2,'0') || ', que é dia fechado.')::text
    from (select distinct l.dia from public.entregas_lancamentos l
           where l.tenant_id = v_t and l.ano = p_ano and l.mes = p_mes and l.quantidade > 0) l
   where extract(dow from make_date(p_ano, p_mes, l.dia)) = 0
      or l.dia = any(coalesce(p_dias_fechados,'{}'));

  -- 5) lançamento sem entregador cadastrado
  return query
  select 'orfao'::text, 'Existe lançamento sem entregador cadastrado.'::text
   where exists (select 1 from public.entregas_lancamentos l
                  where l.tenant_id = v_t and l.ano = p_ano and l.mes = p_mes
                    and not exists (select 1 from public.entregas_equipe e where e.id = l.entregador_id));
end $$;

revoke all on function public.entregas_pendencias_mes(int,int,integer[]) from public, anon;
grant execute on function public.entregas_pendencias_mes(int,int,integer[]) to authenticated;

commit;

select 'regra de fechamento completo' as o_que,
       case when exists (select 1 from information_schema.routines
                          where routine_schema='public' and routine_name='entregas_pendencias_mes')
            then 'OK' else 'FALTOU' end as valor;
