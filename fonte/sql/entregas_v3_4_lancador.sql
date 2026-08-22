-- ============================================================
-- ENTREGAS v3 · ARQUIVO 4 — ACESSO "SÓ LANÇAR"
--
-- Rode DEPOIS dos arquivos 1, 2 e 3. Aditivo e idempotente.
--
-- O QUE FAZ
--   Cria um acesso reduzido para a pessoa contratada só para lançar as entregas.
--   Ela consegue: ver a grade do mês, digitar as entregas, e cadastrar, renomear,
--   inativar ou reativar entregador.
--   Ela NÃO consegue: ver ritmo, projeção, ranking, gráficos, mapa de calor, nem
--   qualquer valor em dinheiro — e não fecha nem reabre mês.
--
--   Quem esconde é o SERVIDOR. As funções de gestão continuam exigindo o acesso
--   completo, então nem pelo console do navegador ela alcança esses números.
--
-- COMO LIBERAR PARA ELA
--   No Painel: Acessos -> marque "Entregas — só lançar" (e NÃO marque "Entregas").
--
-- DESFAZER: rode de novo o arquivo 1 e o 3 (eles recriam as funções na versão
--   que exige o acesso completo).
-- ============================================================

begin;

-- Pode LANÇAR: quem tem o acesso completo de Entregas ou o acesso reduzido.
create or replace function public.entregas_pode_lancar()
returns boolean language sql stable security definer set search_path = public as $$
  select public.pode_pagina('entregas') or public.pode_pagina('entregas_lancar');
$$;

-- Porteiro da escrita passa a aceitar os dois acessos.
create or replace function public.entregas_guarda()
returns uuid language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Entre no painel para lançar entregas.' using errcode = '28000';
  end if;
  if not public.entregas_pode_lancar() then
    raise exception 'Seu acesso não inclui o lançamento de Entregas.' using errcode = '42501';
  end if;
  return public.current_tenant();
end $$;

-- Leitura das tabelas: os dois acessos leem. O que separa um do outro é o que a
-- tela mostra e, principalmente, o que as funções de GESTÃO devolvem.
drop policy if exists entregas_equipe_sel on public.entregas_equipe;
create policy entregas_equipe_sel on public.entregas_equipe for select to authenticated
  using (tenant_id = public.current_tenant() and public.entregas_pode_lancar());

drop policy if exists entregas_lanc_sel on public.entregas_lancamentos;
create policy entregas_lanc_sel on public.entregas_lancamentos for select to authenticated
  using (tenant_id = public.current_tenant() and public.entregas_pode_lancar());

drop policy if exists entregas_comp_sel on public.entregas_competencia;
create policy entregas_comp_sel on public.entregas_competencia for select to authenticated
  using (tenant_id = public.current_tenant() and public.entregas_pode_lancar());

-- Ela precisa saber as METAS (ajuda a perceber erro de digitação), mas os VALORES
-- continuam saindo nulos: só o master recebe dinheiro.
create or replace function public.entregas_config_do_mes(p_ano integer, p_mes integer)
returns table (competencia date, meta_base_qtd integer, meta_desafio_qtd integer,
               valor_base numeric, valor_desafio numeric,
               sou_master boolean, existe boolean,
               atualizado_em timestamptz, atualizado_por uuid)
language plpgsql stable security definer set search_path = public as $$
declare v_m boolean; v_comp date; v_n integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Entre no painel.' using errcode = '28000';
  end if;
  if not public.entregas_pode_lancar() then
    raise exception 'Seu acesso não inclui a página de Entregas.' using errcode = '42501';
  end if;
  v_m := public.entregas_sou_master();
  v_comp := make_date(p_ano, p_mes, 1);

  return query
  select c.competencia, c.meta_base_qtd, c.meta_desafio_qtd,
         case when v_m then c.valor_base    else null::numeric end,
         case when v_m then c.valor_desafio else null::numeric end,
         v_m, true, c.atualizado_em, c.atualizado_por
    from public.entregas_config c
   where c.tenant_id = public.current_tenant() and c.competencia = v_comp;
  get diagnostics v_n = row_count;

  if v_n = 0 then
    return query
    select v_comp, c.meta_base_qtd, c.meta_desafio_qtd,
           case when v_m then c.valor_base    else null::numeric end,
           case when v_m then c.valor_desafio else null::numeric end,
           v_m, false, c.atualizado_em, c.atualizado_por
      from public.entregas_config c
     where c.tenant_id = public.current_tenant() and c.competencia < v_comp
     order by c.competencia desc limit 1;
    get diagnostics v_n = row_count;
  end if;

  if v_n = 0 then
    return query
    select v_comp, 600, 850, null::numeric, null::numeric,
           v_m, false, null::timestamptz, null::uuid;
  end if;
end $$;

-- A leitura da EQUIPE também vale para quem só lança (ela cadastra entregador).
create or replace function public.entregas_listar_equipe(p_incluir_inativos boolean default false)
returns table (id uuid, nome text, ativo boolean, criado_em timestamptz, inativado_em timestamptz)
language sql stable security invoker set search_path = public as $$
  select e.id, e.nome, e.ativo, e.criado_em, e.inativado_em
    from public.entregas_equipe e
   where e.tenant_id = public.current_tenant()
     and (p_incluir_inativos or e.ativo)
   order by e.ativo desc, e.nome;
$$;

grant execute on function public.entregas_pode_lancar() to authenticated;

commit;

-- As funções de GESTÃO continuam exigindo o acesso completo:
--   entregas_espelho_mes · entregas_pendencias_mes  -> pode_pagina('entregas')
--   entregas_fechar_mes · entregas_reabrir_mes · entregas_salvar_config -> só master
-- Nada a fazer aqui: elas já estão assim desde os arquivos 1 e 3.

select 'acesso "só lançar" criado' as o_que,
       case when exists (select 1 from information_schema.routines
                          where routine_schema='public' and routine_name='entregas_pode_lancar')
            then 'OK' else 'FALTOU' end as valor
union all
select 'políticas de leitura atualizadas',
       (select count(*)::text from pg_policies
         where schemaname='public'
           and policyname in ('entregas_equipe_sel','entregas_lanc_sel','entregas_comp_sel')) || ' de 3';
