-- ============================================================
-- ENTREGAS v3 · ARQUIVO 1 de 3 — CONFIGURAÇÃO DE METAS E REMUNERAÇÃO
--
-- Rode no SQL Editor do Supabase, na ordem: 1, depois 2, depois 3.
-- Aditivo e idempotente: pode rodar de novo sem estragar nada.
--
-- O QUE ESTE ARQUIVO FAZ
--   Tira as metas 600/850 do código e coloca no banco, COM VIGÊNCIA MENSAL.
--   Janeiro pode ter meta 600 a R$ 0,50; fevereiro pode ter 650 a R$ 0,60 — e
--   janeiro continua sendo calculado com os valores de janeiro, para sempre.
--
-- DESFAZER:
--   drop function if exists public.entregas_config_do_mes(int,int);
--   drop function if exists public.entregas_salvar_config(uuid,int,int,int,int,numeric,numeric);
--   drop function if exists public.entregas_calc_faixa(int,int,int,numeric,numeric);
--   drop function if exists public.entregas_sou_master();
--   drop table if exists public.entregas_config;
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1) Quem é master. O projeto checava isso inline em cada policy; aqui vira função,
--    porque agora é o que decide quem enxerga DINHEIRO.
-- ------------------------------------------------------------
create or replace function public.entregas_sou_master()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perfis p where p.id = auth.uid() and coalesce(p.is_master,false));
$$;

-- ------------------------------------------------------------
-- 2) A configuração, uma por mês.
--    competencia = 1º dia do mês, mesma convenção de despesas_resumo.
-- ------------------------------------------------------------
create table if not exists public.entregas_config (
  tenant_id         uuid not null default public.current_tenant(),
  competencia       date not null,
  meta_base_qtd     integer       not null,
  meta_desafio_qtd  integer       not null,
  valor_base        numeric(14,2) not null default 0,
  valor_desafio     numeric(14,2) not null default 0,
  request_id        uuid,
  criado_em         timestamptz not null default now(),
  criado_por        uuid,
  atualizado_em     timestamptz not null default now(),
  atualizado_por    uuid,
  primary key (tenant_id, competencia),
  constraint entregas_config_base_ck    check (meta_base_qtd > 0),
  constraint entregas_config_desafio_ck check (meta_desafio_qtd > meta_base_qtd),
  constraint entregas_config_vbase_ck   check (valor_base >= 0),
  constraint entregas_config_vdes_ck    check (valor_desafio >= 0)
);
create unique index if not exists ux_entregas_config_request
  on public.entregas_config (request_id) where request_id is not null;

alter table public.entregas_config enable row level security;
revoke all on table public.entregas_config from anon, authenticated;
-- Ninguém lê a tabela direto: as QUANTIDADES todo mundo pode ver, os VALORES não.
-- Quem separa isso é a função de leitura mais abaixo.

-- ------------------------------------------------------------
-- 3) A REGRA FINANCEIRA — faixa final retroativa.
--    Bateu a meta desafio, TODAS as entregas do mês valem o valor do desafio.
--    O salto ao cruzar a meta é intencional: é a regra do dono.
--    immutable de propósito: mesma entrada, mesma saída, sempre.
-- ------------------------------------------------------------
create or replace function public.entregas_calc_faixa(
  p_qtd integer, p_base integer, p_desafio integer,
  p_valor_base numeric, p_valor_desafio numeric)
returns table (faixa text, valor_unitario numeric, valor_total numeric)
language sql immutable as $$
  with r as (
    select case when p_qtd >= p_desafio then 'desafio'
                when p_qtd >= p_base    then 'base'
                else 'sem' end as f,
           case when p_qtd >= p_desafio then coalesce(p_valor_desafio,0)
                when p_qtd >= p_base    then coalesce(p_valor_base,0)
                else 0 end as vu
  )
  select r.f, round(r.vu,2), round(coalesce(p_qtd,0) * r.vu, 2) from r;
$$;

-- ------------------------------------------------------------
-- 4) Salvar a configuração de uma competência. Só master.
--    Recusa mês fechado (a checagem entra no arquivo 2; aqui fica a chamada, que
--    é tolerante enquanto o arquivo 2 não tiver rodado).
-- ------------------------------------------------------------
create or replace function public.entregas_salvar_config(
  p_request_id uuid, p_ano integer, p_mes integer,
  p_meta_base integer, p_meta_desafio integer,
  p_valor_base numeric, p_valor_desafio numeric)
returns void language plpgsql security definer set search_path = public as $$
declare v_tenant uuid; v_comp date; v_fechado boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Entre no painel.' using errcode = '28000';
  end if;
  if not public.entregas_sou_master() then
    raise exception 'Só o administrador pode mexer em metas e valores.' using errcode = '42501';
  end if;
  v_tenant := public.current_tenant();

  if p_ano not between 2000 and 2200 or p_mes not between 1 and 12 then
    raise exception 'Competência inválida.' using errcode = '22007';
  end if;
  v_comp := make_date(p_ano, p_mes, 1);

  if p_meta_base is null or p_meta_base <= 0 then
    raise exception 'A meta base tem que ser maior que zero.' using errcode = '22003';
  end if;
  if p_meta_desafio is null or p_meta_desafio <= p_meta_base then
    raise exception 'A meta desafio tem que ser maior que a meta base.' using errcode = '22003';
  end if;
  if coalesce(p_valor_base,0) < 0 or coalesce(p_valor_desafio,0) < 0 then
    raise exception 'Valor por entrega não pode ser negativo.' using errcode = '22003';
  end if;

  -- mês fechado não muda de configuração
  begin
    select public.entregas_mes_fechado(p_ano, p_mes) into v_fechado;
  exception when undefined_function then v_fechado := false;
  end;
  if v_fechado then
    raise exception 'Este mês está fechado. Reabra antes de mudar metas ou valores.' using errcode = '23514';
  end if;

  if not public.entregas_marcar_intencao(p_request_id, 'salvar_config') then return; end if;

  insert into public.entregas_config as c
    (tenant_id, competencia, meta_base_qtd, meta_desafio_qtd, valor_base, valor_desafio,
     request_id, criado_por, atualizado_por)
  values (v_tenant, v_comp, p_meta_base, p_meta_desafio,
          round(coalesce(p_valor_base,0),2), round(coalesce(p_valor_desafio,0),2),
          p_request_id, auth.uid(), auth.uid())
  on conflict (tenant_id, competencia) do update
    set meta_base_qtd = excluded.meta_base_qtd,
        meta_desafio_qtd = excluded.meta_desafio_qtd,
        valor_base = excluded.valor_base,
        valor_desafio = excluded.valor_desafio,
        request_id = excluded.request_id,
        atualizado_em = now(),
        atualizado_por = auth.uid();
end $$;

-- ------------------------------------------------------------
-- 5) Ler a configuração de um mês.
--    QUANTIDADES: qualquer um que tenha a página vê (a meta não é segredo).
--    VALORES EM DINHEIRO: só o master. Para os outros voltam NULOS — o servidor
--    é que esconde, não o JavaScript.
-- ------------------------------------------------------------
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
  if not public.pode_pagina('entregas') then
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

  if not found then
    -- mês sem configuração própria: herda a última vigência ANTERIOR, se houver
    return query
    select v_comp, c.meta_base_qtd, c.meta_desafio_qtd,
           case when v_m then c.valor_base    else null::numeric end,
           case when v_m then c.valor_desafio else null::numeric end,
           v_m, false, c.atualizado_em, c.atualizado_por
      from public.entregas_config c
     where c.tenant_id = public.current_tenant() and c.competencia < v_comp
     order by c.competencia desc limit 1;
  end if;
end $$;

revoke all  on function public.entregas_sou_master()                                        from public, anon;
revoke all  on function public.entregas_salvar_config(uuid,int,int,int,int,numeric,numeric) from public, anon;
revoke all  on function public.entregas_config_do_mes(int,int)                              from public, anon;
grant execute on function public.entregas_salvar_config(uuid,int,int,int,int,numeric,numeric) to authenticated;
grant execute on function public.entregas_config_do_mes(int,int)                              to authenticated;
grant execute on function public.entregas_calc_faixa(int,int,int,numeric,numeric)             to authenticated;

commit;

-- conferência da regra financeira (não depende de dado nenhum)
select q as entregas, f.faixa, f.valor_unitario, f.valor_total
  from (values (599),(600),(849),(850),(900)) t(q),
       lateral public.entregas_calc_faixa(t.q, 600, 850, 0.50, 0.80) f;
