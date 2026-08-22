-- ============================================================
-- ENTREGAS v3 · ARQUIVO 8 — QUEM LANÇA PASSA A VER O VALOR DAS METAS
--
-- Rode DEPOIS dos arquivos 1 a 7. Aditivo e idempotente.
--
-- O QUE MUDA
--   Até agora o servidor só mandava valor_base / valor_desafio para o MASTER. Quem
--   lançava via só as quantidades das metas (600 e 850) e nunca quanto cada entrega
--   vale. O dono pediu que a faixa de metas mostre também o valor, para a pessoa que
--   lança poder informar a equipe.
--
--   Passa a ver quem tem entregas_pode_lancar(). Continua sendo SÓ A TABELA DE PREÇOS —
--   "cada entrega vale R$ 0,50 a partir de 600". Não é o quanto cada entregador ganhou.
--
-- O QUE **NÃO** MUDA (de propósito)
--   entregas_espelho_mes continua devolvendo valor NULO para quem não é master: quanto
--   cada pessoa ganhou no mês, e o total a pagar, seguem sendo só do dono. Os cartões de
--   dinheiro, o ranking com valores e o relatório do RH continuam fechados.
--   entregas_salvar_config continua exigindo master: ver o valor não é poder mudá-lo.
--
--   ATENÇÃO, é uma decisão de negócio: sabendo o valor por entrega e vendo a grade,
--   dá para calcular no papel quanto cada entregador vai receber. Foi pedido assim.
--
-- DESFAZER: rode de novo o arquivo 1 (recria a função só-master).
-- ============================================================

begin;

create or replace function public.entregas_config_do_mes(p_ano integer, p_mes integer)
returns table (competencia date, meta_base_qtd integer, meta_desafio_qtd integer,
               valor_base numeric, valor_desafio numeric,
               sou_master boolean, existe boolean,
               atualizado_em timestamptz, atualizado_por uuid)
language plpgsql stable security definer set search_path = public as $$
declare v_m boolean; v_comp date;
begin
  if auth.uid() is null then
    raise exception 'Entre no painel.' using errcode = '28000';
  end if;
  -- os dois acessos entram: quem administra e quem só lança
  if not public.entregas_pode_lancar() then
    raise exception 'Seu acesso não inclui a página de Entregas.' using errcode = '42501';
  end if;
  v_m := public.entregas_sou_master();
  v_comp := make_date(p_ano, p_mes, 1);

  -- O valor por entrega deixou de ser mascarado. sou_master continua indo separado —
  -- é ele que a tela usa pra decidir o que é do dono (cartões, ranking, relatório).
  return query
  select c.competencia, c.meta_base_qtd, c.meta_desafio_qtd,
         c.valor_base, c.valor_desafio,
         v_m, true, c.atualizado_em, c.atualizado_por
    from public.entregas_config c
   where c.tenant_id = public.current_tenant() and c.competencia = v_comp;

  if not found then
    -- mês sem configuração própria: herda a última vigência ANTERIOR, se houver
    return query
    select v_comp, c.meta_base_qtd, c.meta_desafio_qtd,
           c.valor_base, c.valor_desafio,
           v_m, false, c.atualizado_em, c.atualizado_por
      from public.entregas_config c
     where c.tenant_id = public.current_tenant() and c.competencia < v_comp
     order by c.competencia desc limit 1;
  end if;

  if not found then
    -- nenhuma configuração ainda: uma linha só, pra tela saber quem está olhando
    return query select v_comp, null::integer, null::integer, null::numeric, null::numeric,
                        v_m, false, null::timestamptz, null::uuid;
  end if;
end $$;

revoke all  on function public.entregas_config_do_mes(int,int) from public, anon;
grant execute on function public.entregas_config_do_mes(int,int) to authenticated;

commit;

-- ============================================================
-- CONFERÊNCIA
-- ============================================================
select 'quem lança vê o valor das metas' as o_que,
       case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                          where n.nspname='public' and p.proname='entregas_config_do_mes'
                            and pg_get_functiondef(p.oid) like '%entregas_pode_lancar%')
            then 'SIM' else 'FALTOU' end as valor
union all
select 'ganho de cada entregador continua só do master',
       case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                          where n.nspname='public' and p.proname='entregas_espelho_mes'
                            and pg_get_functiondef(p.oid) like '%v_m%')
            then 'SIM' else 'confira' end
union all
select 'mudar metas e valores continua só do master',
       case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                          where n.nspname='public' and p.proname='entregas_salvar_config'
                            and pg_get_functiondef(p.oid) like '%entregas_sou_master%')
            then 'SIM' else 'confira' end
union all
select 'valores de hoje',
       coalesce((select 'meta ' || c.meta_base_qtd || ' = R$ ' || to_char(c.valor_base,'FM9990D00') ||
                        '  ·  meta ' || c.meta_desafio_qtd || ' = R$ ' || to_char(c.valor_desafio,'FM9990D00')
                   from public.entregas_config c
                  where c.tenant_id = public.current_tenant()
                  order by c.competencia desc limit 1), 'nenhuma configuração ainda');
