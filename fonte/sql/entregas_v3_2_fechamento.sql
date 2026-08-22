-- ============================================================
-- ENTREGAS v3 · ARQUIVO 2 de 3 — FECHAMENTO MENSAL E A TRAVA
--
-- Rode DEPOIS do arquivo 1. Aditivo e idempotente.
--
-- O QUE ESTE ARQUIVO FAZ
--   Mês fechado passa a ser ESTADO NO BANCO, não botão de tela. E a trava é um
--   gatilho: mesmo uma chamada direta à API, pelo console do navegador, é recusada.
--   Ao fechar, metas, valores e o espelho por entregador ficam CONGELADOS na linha
--   da competência — mudar a configuração depois não reescreve o que já foi pago.
--
-- DESFAZER:
--   drop trigger if exists trg_entregas_lanc_trava on public.entregas_lancamentos;
--   drop function if exists public.tg_entregas_lanc_trava();
--   drop function if exists public.entregas_mes_fechado(int,int);
--   drop table if exists public.entregas_competencia;
-- ============================================================

begin;

create table if not exists public.entregas_competencia (
  tenant_id          uuid not null default public.current_tenant(),
  competencia        date not null,
  status             text not null default 'aberto',
  fechado_por        uuid,
  fechado_em         timestamptz,
  reaberto_por       uuid,
  reaberto_em        timestamptz,
  motivo_reabertura  text,
  -- congelados no fechamento:
  meta_base_qtd      integer,
  meta_desafio_qtd   integer,
  valor_base         numeric(14,2),
  valor_desafio      numeric(14,2),
  total_entregas     integer,
  total_remuneracao  numeric(14,2),
  detalhe            jsonb,          -- espelho por entregador, como estava no fechamento
  atualizado_em      timestamptz not null default now(),
  primary key (tenant_id, competencia),
  constraint entregas_comp_status_ck check (status in ('aberto','fechado'))
);

alter table public.entregas_competencia enable row level security;
revoke all on table public.entregas_competencia from anon, authenticated;
grant select on table public.entregas_competencia to authenticated;

drop policy if exists entregas_comp_sel on public.entregas_competencia;
create policy entregas_comp_sel on public.entregas_competencia for select to authenticated
  using (tenant_id = public.current_tenant() and public.pode_pagina('entregas'));

-- ------------------------------------------------------------
-- Este mês está fechado?
-- ------------------------------------------------------------
create or replace function public.entregas_mes_fechado(p_ano integer, p_mes integer)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.entregas_competencia c
     where c.tenant_id = public.current_tenant()
       and c.competencia = make_date(p_ano, p_mes, 1)
       and c.status = 'fechado');
$$;

-- ------------------------------------------------------------
-- A TRAVA. Gatilho na tabela de lançamentos: recusa qualquer escrita em mês fechado.
-- Fica no BANCO, não na tela. Nem as próprias RPCs conseguem furar.
-- A liberação temporária é o mesmo desenho já usado em assinaturas_emitidas:
-- só quem declara app.entregas_abrindo='1' na própria transação passa — e isso só
-- acontece dentro da função de reabertura.
-- ------------------------------------------------------------
create or replace function public.tg_entregas_lanc_trava()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record; v_lib text;
begin
  r := coalesce(new, old);
  begin v_lib := current_setting('app.entregas_abrindo', true); exception when others then v_lib := null; end;
  if coalesce(v_lib,'') = '1' then return coalesce(new, old); end if;
  if public.entregas_mes_fechado(r.ano, r.mes) then
    raise exception 'O mês %/% está fechado. Reabra antes de alterar qualquer lançamento.', r.mes, r.ano
      using errcode = '23514';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_entregas_lanc_trava on public.entregas_lancamentos;
create trigger trg_entregas_lanc_trava
  before insert or update or delete on public.entregas_lancamentos
  for each row execute function public.tg_entregas_lanc_trava();

commit;

-- conferência
select 'tabela de competência' as o_que,
       case when to_regclass('public.entregas_competencia') is not null then 'criada' else 'FALTOU' end as valor
union all
select 'trava de mês fechado',
       case when exists (select 1 from information_schema.triggers
                          where trigger_schema='public' and trigger_name='trg_entregas_lanc_trava')
            then 'ativa' else 'FALTOU' end
union all
select 'função entregas_mes_fechado',
       case when exists (select 1 from information_schema.routines
                          where routine_schema='public' and routine_name='entregas_mes_fechado')
            then 'criada' else 'FALTOU' end;
