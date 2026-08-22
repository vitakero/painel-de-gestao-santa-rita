-- ============================================================
-- ENTREGAS v3 · ARQUIVO 7 — CONFIRMAR O DIA (trava diária)
--
-- Rode DEPOIS dos arquivos 1 a 6. Aditivo e idempotente (pode rodar 2x).
--
-- O QUE FAZ
--   Depois de lançar o dia, a pessoa CONFIRMA. Dali em diante aquele dia está
--   travado: ela não altera mais. Não é preciso esperar o fim do mês para congelar
--   o que já passou.
--
--   O ADMINISTRADOR ainda consegue corrigir um dia confirmado — erro acontece e
--   alguém tem que poder consertar. Toda correção que MUDA um número fica registrada
--   em public.eventos com o valor anterior e o novo.
--
--   Só dá pra confirmar um dia COMPLETO: todo entregador ATIVO que trabalhou no mês
--   precisa ter valor naquele dia. Zero conta; branco não.
--
-- DUAS COISAS QUE ESTE ARQUIVO CONSERTA NO FECHAMENTO DO MÊS
--   (1) DIA CONFIRMADO É DIA APURADO. O fechamento parou de cobrar célula em dia já
--       confirmado. Sem isso o painel travava de vez: entregador contratado no dia 10
--       passava a "dever" zero nos dias 1 a 9; se esses dias já estivessem confirmados,
--       ninguém conseguia digitar esse zero e o mês NUNCA fechava.
--   (2) QUEM ESTÁ INATIVO NÃO É MAIS COBRADO. entregas_salvar_dia recusa lançamento
--       novo para entregador inativo — então exigir dele uma célula em branco era pedir
--       o impossível. Quem saiu no meio do mês travava o fechamento do mesmo jeito.
--
-- DESFAZER:
--   drop trigger if exists trg_entregas_lanc_dia on public.entregas_lancamentos;
--   drop function if exists public.tg_entregas_lanc_dia();
--   drop function if exists public.entregas_reabrir_dia(uuid,int,int,int,text);
--   drop function if exists public.entregas_confirmar_dia(uuid,int,int,int);
--   drop function if exists public.entregas_dia_confirmado(int,int,int);
--   drop table if exists public.entregas_dias_confirmados;
--   -- e rode de novo o arquivo 6 para voltar a versão anterior de entregas_pendencias_mes
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1) A TABELA. Uma linha por dia travado.
-- ------------------------------------------------------------
create table if not exists public.entregas_dias_confirmados (
  tenant_id      uuid not null default public.current_tenant(),
  ano            integer not null,
  mes            integer not null,
  dia            integer not null,
  confirmado_por uuid,
  confirmado_em  timestamptz not null default now(),
  primary key (tenant_id, ano, mes, dia),
  constraint entregas_dc_mes_ck check (mes between 1 and 12),
  constraint entregas_dc_dia_ck check (dia between 1 and 31)
);

alter table public.entregas_dias_confirmados enable row level security;
revoke all on table public.entregas_dias_confirmados from anon, authenticated;
grant select on table public.entregas_dias_confirmados to authenticated;

drop policy if exists entregas_dc_sel on public.entregas_dias_confirmados;
create policy entregas_dc_sel on public.entregas_dias_confirmados for select to authenticated
  using (tenant_id = public.current_tenant() and public.entregas_pode_lancar());

-- Uso INTERNO (gatilho e funções). Não é concedida a ninguém de fora: a tela lê a
-- tabela direto, sob RLS. Função definer solta por aí é porta que não precisa existir.
create or replace function public.entregas_dia_confirmado(p_ano integer, p_mes integer, p_dia integer)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.entregas_dias_confirmados c
                  where c.tenant_id = public.current_tenant()
                    and c.ano = p_ano and c.mes = p_mes and c.dia = p_dia);
$$;

-- ------------------------------------------------------------
-- 2) A TRAVA. Fica no banco, igual à do mês: quem não é master não altera dia
--    confirmado nem chamando a API por fora do painel.
-- ------------------------------------------------------------
create or replace function public.tg_entregas_lanc_dia()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record; v_lib text; v_ant integer; v_novo integer;
begin
  r := coalesce(new, old);
  begin v_lib := current_setting('app.entregas_abrindo', true); exception when others then v_lib := null; end;
  if coalesce(v_lib,'') = '1' then return coalesce(new, old); end if;

  if not public.entregas_dia_confirmado(r.ano, r.mes, r.dia) then
    return coalesce(new, old);
  end if;

  if not public.entregas_sou_master() then
    raise exception 'O dia %/% já foi confirmado e não pode mais ser alterado. Fale com o administrador.', r.dia, r.mes
      using errcode = '23514';
  end if;

  -- Daqui pra baixo é o master corrigindo. Vale, mas fica registrado.
  -- Valor velho e novo em VARIÁVEIS, nunca com new./old. dentro de um CASE: num DELETE
  -- o NEW não existe e o plpgsql reclama só de ver a referência.
  if tg_op = 'INSERT' then      v_ant := null;           v_novo := new.quantidade;
  elsif tg_op = 'UPDATE' then   v_ant := old.quantidade; v_novo := new.quantidade;
  else                          v_ant := old.quantidade; v_novo := null;
  end if;

  -- Salvar o mesmo número de novo não é correção. Se registrasse, o livro de correções
  -- encheria de linha falsa e deixaria de servir como prova.
  if tg_op = 'UPDATE' and v_ant is not distinct from v_novo then
    return new;
  end if;

  insert into public.eventos (event_uuid, tenant_id, tipo, entity_type, entity_id,
                              autor_id, setor, resumo, payload)
  values (gen_random_uuid(), r.tenant_id, 'entrega.corrigida_apos_confirmar',
          'entregas_lancamentos', r.id::text, auth.uid(), 'Entregas',
          'Correção em dia já confirmado: ' || r.nome_snapshot || ' — dia ' ||
          r.dia || '/' || r.mes || '/' || r.ano,
          jsonb_build_object('entregador_id', r.entregador_id, 'dia', r.dia,
                             'competencia', r.ano || '-' || lpad(r.mes::text,2,'0'),
                             'valor_anterior', v_ant, 'valor_novo', v_novo));
  return coalesce(new, old);
end $$;

drop trigger if exists trg_entregas_lanc_dia on public.entregas_lancamentos;
create trigger trg_entregas_lanc_dia
  before insert or update or delete on public.entregas_lancamentos
  for each row execute function public.tg_entregas_lanc_dia();

-- ------------------------------------------------------------
-- 3) CONFIRMAR O DIA. Só com o dia COMPLETO.
--
--    Quem é cobrado: entregador ATIVO que teve algum lançamento neste mês.
--    Inativo fica de fora porque entregas_salvar_dia recusa lançamento novo pra ele —
--    exigir uma célula que o banco não deixa criar travaria o mês para sempre.
-- ------------------------------------------------------------
create or replace function public.entregas_confirmar_dia(p_request_id uuid, p_ano integer, p_mes integer, p_dia integer)
returns void language plpgsql security definer set search_path = public as $$
declare v_t uuid; v_faltam int; v_qtd int;
begin
  v_t := public.entregas_guarda();
  if p_ano not between 2000 and 2200 or p_mes not between 1 and 12 or p_dia not between 1 and 31 then
    raise exception 'Data inválida.' using errcode='22007';
  end if;
  perform make_date(p_ano, p_mes, p_dia);

  if extract(dow from make_date(p_ano, p_mes, p_dia)) = 0 then
    raise exception 'Domingo não precisa de confirmação: a loja não abre.' using errcode='23514';
  end if;
  -- O dia de HOJE é aceito de propósito (dá pra fechar o dia à noite). O que não existe
  -- é confirmar entrega que ainda não aconteceu.
  if make_date(p_ano, p_mes, p_dia) > (now() at time zone 'America/Recife')::date then
    raise exception 'Este dia ainda não chegou.' using errcode='23514';
  end if;

  if public.entregas_dia_confirmado(p_ano, p_mes, p_dia) then return; end if;   -- já estava

  select count(*) into v_faltam
    from (select distinct l.entregador_id
            from public.entregas_lancamentos l
            join public.entregas_equipe e
              on e.id = l.entregador_id and e.tenant_id = v_t and e.ativo
           where l.tenant_id = v_t and l.ano = p_ano and l.mes = p_mes) p
   where not exists (select 1 from public.entregas_lancamentos l
                      where l.tenant_id = v_t and l.ano = p_ano and l.mes = p_mes
                        and l.dia = p_dia and l.entregador_id = p.entregador_id);

  select count(*) into v_qtd
    from public.entregas_lancamentos l
   where l.tenant_id = v_t and l.ano = p_ano and l.mes = p_mes and l.dia = p_dia;

  if v_qtd = 0 then
    raise exception 'Nenhum lançamento neste dia. Preencha antes de confirmar.' using errcode='23514';
  end if;
  if v_faltam > 0 then
    raise exception 'Faltam % entregador(es) sem valor neste dia. Quem não entregou precisa de ZERO.', v_faltam
      using errcode='23514';
  end if;

  if not public.entregas_marcar_intencao(p_request_id, 'confirmar_dia') then return; end if;

  insert into public.entregas_dias_confirmados (tenant_id, ano, mes, dia, confirmado_por)
  values (v_t, p_ano, p_mes, p_dia, auth.uid())
  on conflict (tenant_id, ano, mes, dia) do nothing;

  insert into public.eventos (event_uuid, tenant_id, tipo, entity_type, entity_id,
                              autor_id, setor, resumo, payload)
  values (gen_random_uuid(), v_t, 'entregas.dia_confirmado', 'entregas_lancamentos',
          p_ano || '-' || lpad(p_mes::text,2,'0') || '-' || lpad(p_dia::text,2,'0'),
          auth.uid(), 'Entregas',
          'Dia ' || lpad(p_dia::text,2,'0') || '/' || lpad(p_mes::text,2,'0') || ' confirmado',
          jsonb_build_object('ano',p_ano,'mes',p_mes,'dia',p_dia,'request_id',p_request_id));
end $$;

-- ------------------------------------------------------------
-- 4) REABRIR UM DIA: só o master, com motivo.
-- ------------------------------------------------------------
create or replace function public.entregas_reabrir_dia(p_request_id uuid, p_ano integer, p_mes integer,
                                                       p_dia integer, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare v_t uuid;
begin
  if auth.uid() is null then raise exception 'Entre no painel.' using errcode='28000'; end if;
  if not public.entregas_sou_master() then
    raise exception 'Só o administrador reabre um dia confirmado.' using errcode='42501';
  end if;
  if coalesce(btrim(p_motivo),'') = '' then
    raise exception 'Diga o motivo.' using errcode='22004';
  end if;
  v_t := public.current_tenant();
  if not public.entregas_dia_confirmado(p_ano, p_mes, p_dia) then return; end if;
  if not public.entregas_marcar_intencao(p_request_id, 'reabrir_dia') then return; end if;

  delete from public.entregas_dias_confirmados
   where tenant_id = v_t and ano = p_ano and mes = p_mes and dia = p_dia;

  insert into public.eventos (event_uuid, tenant_id, tipo, entity_type, entity_id,
                              autor_id, setor, resumo, payload)
  values (gen_random_uuid(), v_t, 'entregas.dia_reaberto', 'entregas_lancamentos',
          p_ano || '-' || lpad(p_mes::text,2,'0') || '-' || lpad(p_dia::text,2,'0'),
          auth.uid(), 'Entregas',
          'Dia ' || lpad(p_dia::text,2,'0') || '/' || lpad(p_mes::text,2,'0') || ' reaberto: ' || btrim(p_motivo),
          jsonb_build_object('ano',p_ano,'mes',p_mes,'dia',p_dia,'motivo',btrim(p_motivo),'request_id',p_request_id));
end $$;

-- ------------------------------------------------------------
-- 5) O FECHAMENTO DO MÊS, ajustado às duas regras novas.
--    Substitui a versão do arquivo 6. Continua exigindo o mês inteiro; o que muda é
--    PARAR DE COBRAR o impossível — célula de dia já confirmado e célula de gente
--    que está inativa.
-- ------------------------------------------------------------
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

  -- Todo dia útil precisa ter lançamento. Dia CONFIRMADO já foi conferido e travado:
  -- não se pergunta de novo.
  for v_d in select d::date from generate_series(v_comp, v_ult, interval '1 day') d loop
    if extract(dow from v_d) <> 0
       and not (extract(day from v_d)::int = any(coalesce(p_dias_fechados,'{}')))
       and not public.entregas_dia_confirmado(p_ano, p_mes, extract(day from v_d)::int)
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
       -- dia confirmado = dia apurado. Cobrar célula nele seria pedir uma escrita que o
       -- próprio banco recusa (trg_entregas_lanc_dia), e o mês nunca fecharia.
       and not exists (select 1 from public.entregas_dias_confirmados c
                        where c.tenant_id = v_t and c.ano = p_ano and c.mes = p_mes
                          and c.dia = extract(day from d)::int)
  ), pessoas as (
    -- só ATIVOS: entregas_salvar_dia recusa lançamento novo de quem está inativo
    select distinct l.entregador_id
      from public.entregas_lancamentos l
      join public.entregas_equipe e on e.id = l.entregador_id and e.tenant_id = v_t and e.ativo
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

-- ------------------------------------------------------------
-- 6) Permissões
-- ------------------------------------------------------------
revoke all on function public.entregas_dia_confirmado(int,int,int)          from public, anon, authenticated;
revoke all on function public.entregas_confirmar_dia(uuid,int,int,int)      from public, anon;
revoke all on function public.entregas_reabrir_dia(uuid,int,int,int,text)   from public, anon;
revoke all on function public.entregas_pendencias_mes(int,int,integer[])    from public, anon;
grant execute on function public.entregas_confirmar_dia(uuid,int,int,int)    to authenticated;
grant execute on function public.entregas_reabrir_dia(uuid,int,int,int,text) to authenticated;
grant execute on function public.entregas_pendencias_mes(int,int,integer[])  to authenticated;

-- ------------------------------------------------------------
-- 7) A confirmação precisa chegar aos outros aparelhos na hora. Sem isto, a aba aberta
--    no caixa continua mostrando o campo de um dia que o escritório acabou de travar.
-- ------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime'
                        and schemaname = 'public'
                        and tablename = 'entregas_dias_confirmados') then
    execute 'alter publication supabase_realtime add table public.entregas_dias_confirmados';
  end if;
exception when others then
  raise notice 'Não deu pra ligar o tempo real em entregas_dias_confirmados (%). O painel funciona igual, só atualiza ao recarregar.', sqlerrm;
end $$;

commit;

-- ============================================================
-- CONFERÊNCIA — deve aparecer tudo OK
-- ============================================================
select 'tabela de dias confirmados' as o_que,
       case when to_regclass('public.entregas_dias_confirmados') is not null then 'criada' else 'FALTOU' end as valor
union all
select 'trava do dia (gatilho)',
       case when exists (select 1 from information_schema.triggers
                          where trigger_schema='public' and trigger_name='trg_entregas_lanc_dia')
            then 'ativa' else 'FALTOU' end
union all
select 'funções confirmar/reabrir/conferir',
       (select count(*)::text from information_schema.routines
         where routine_schema='public'
           and routine_name in ('entregas_confirmar_dia','entregas_reabrir_dia','entregas_dia_confirmado')) || ' de 3'
union all
select 'fechamento do mês atualizado',
       case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                          where n.nspname='public' and p.proname='entregas_pendencias_mes'
                            and pg_get_functiondef(p.oid) like '%entregas_dias_confirmados%')
            then 'SIM' else 'NAO — confira' end
union all
select 'escrita direta na tabela nova bloqueada',
       case when (select count(*) from information_schema.role_table_grants
                   where table_schema='public' and table_name='entregas_dias_confirmados'
                     and grantee='authenticated'
                     and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')) = 0
            then 'SIM' else 'NAO — confira' end
union all
select 'tempo real ligado',
       case when exists (select 1 from pg_publication_tables
                          where pubname='supabase_realtime' and schemaname='public'
                            and tablename='entregas_dias_confirmados')
            then 'SIM' else 'nao (opcional)' end;
