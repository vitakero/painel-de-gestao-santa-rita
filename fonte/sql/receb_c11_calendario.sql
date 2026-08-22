-- ============================================================
-- C11 — O CALENDÁRIO DE ESCOLHA DO PORTAL DO FORNECEDOR
--
-- Antes o fornecedor digitava a data e só ENTÃO descobria se ainda cabia
-- alguém naquele dia. Quando não cabia, voltava e tentava outro. Este arquivo
-- dá ao portal a resposta antes do clique: para cada dia do mês, quantos
-- horários ainda comportam a descarga dele.
--
-- Duas coisas:
--   1) forn_dias_livres    — NOVA. As vagas de cada dia de um período.
--   2) forn_horarios_livres — a mesma de antes, agora dizendo POR QUE um
--      horário não serve (ocupado / já passou / a loja fecha antes).
--
-- Segurança: as duas continuam exigindo forn_meu_id() e contando pelo
-- receb_choca(), que já filtra por tenant. O fornecedor recebe CONTAGEM de
-- vagas — nunca de quem é a agenda que ocupa o horário.
--
-- Pode rodar mais de uma vez sem estragar nada.
-- ============================================================


-- ============================================================
-- 1) QUANTOS HORÁRIOS CADA DIA AINDA COMPORTA
--
-- É esta função que acende a bolinha verde ou vermelha no calendário.
-- A conta de choque é a MESMA do resto do sistema (receb_choca) de
-- propósito: duas contas de "está livre?" acabam discordando uma hora,
-- e aí a tela promete um horário que o banco recusa no clique seguinte.
-- ============================================================
create or replace function public.forn_dias_livres(
  p_de date, p_ate date, p_minutos int default 60
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  l record; v_min int; v_abre int; v_fecha int; v_agora int; v_hoje date;
  v_de date; v_ate date;
begin
  if public.forn_meu_id() is null then return '[]'::jsonb; end if;

  v_hoje := public.receb_hoje();
  -- A janela é a mesma que forn_horarios_livres aceita: de hoje até 60 dias.
  -- Pedir fora disso não é erro, só não devolve nada além do permitido.
  v_de  := greatest(coalesce(p_de,  v_hoje), v_hoje);
  v_ate := least(coalesce(p_ate, v_hoje + 60), v_hoje + 60);
  if v_ate < v_de then return '[]'::jsonb; end if;

  select abre, fecha, dias_semana into l
    from public.receb_locais order by criado_em limit 1;

  v_min   := least(greatest(coalesce(p_minutos, 60), 15), 480);
  v_abre  := extract(hour from l.abre)::int  * 60 + extract(minute from l.abre)::int;
  v_fecha := extract(hour from l.fecha)::int * 60 + extract(minute from l.fecha)::int;
  v_agora := extract(hour   from (now() at time zone 'America/Fortaleza'))::int * 60
           + extract(minute from (now() at time zone 'America/Fortaleza'))::int;

  return coalesce((
    select jsonb_agg(jsonb_build_object('dia', to_char(x.dia, 'YYYY-MM-DD'),
                                        'livres', x.livres) order by x.dia)
      from (
        select g.dia::date as dia,
               count(*) filter (
                 where (m.ini + v_min) <= v_fecha              -- cabe antes de fechar
                   and (g.dia::date > v_hoje or m.ini > v_agora) -- hoje, só o que ainda vem
                   and not public.receb_choca(g.dia::date, m.ini, v_min)
               )::int as livres
          from generate_series(v_de::timestamp, v_ate::timestamp, interval '1 day') as g(dia)
          cross join generate_series(v_abre, greatest(v_abre, v_fecha - 60), 60) as m(ini)
         -- dia em que a loja não recebe simplesmente não aparece na resposta:
         -- o portal trata "não veio" como "não recebe", e a bolinha nem nasce
         where extract(isodow from g.dia)::int
                 = any(coalesce(l.dias_semana, '{1,2,3,4,5}'))
         group by g.dia
      ) x
  ), '[]'::jsonb);
end;
$$;


-- ============================================================
-- 2) OS HORÁRIOS DO DIA, AGORA COM O MOTIVO
--
-- "Ocupado" e "a loja fecha antes" são coisas diferentes, e o fornecedor
-- resolve cada uma de um jeito: uma pede outro dia, a outra pede começar
-- mais cedo. Mostrar as duas como um risco em cima do horário fazia
-- parecer que a agenda estava sempre lotada.
--
-- O campo 'livre' continua exatamente como era — quem já lê essa função
-- não quebra.
-- ============================================================
create or replace function public.forn_horarios_livres(p_data date, p_minutos int default 60)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  l record; v_min int; v_abre int; v_fecha int; v_agora int; v_hoje date;
begin
  if public.forn_meu_id() is null then return '[]'::jsonb; end if;

  v_hoje := public.receb_hoje();
  if p_data is null or p_data < v_hoje or p_data > v_hoje + 60 then return '[]'::jsonb; end if;

  select abre, fecha, dias_semana into l from public.receb_locais order by criado_em limit 1;
  if not (extract(isodow from p_data)::int = any(coalesce(l.dias_semana, '{1,2,3,4,5}'))) then
    return '[]'::jsonb;
  end if;

  v_min   := least(greatest(coalesce(p_minutos, 60), 15), 480);
  v_abre  := extract(hour from l.abre)::int * 60 + extract(minute from l.abre)::int;
  v_fecha := extract(hour from l.fecha)::int * 60 + extract(minute from l.fecha)::int;
  v_agora := case when p_data > v_hoje then -1
                  else extract(hour from (now() at time zone 'America/Fortaleza'))::int * 60
                     + extract(minute from (now() at time zone 'America/Fortaleza'))::int end;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'h',    (m / 60),
             'hora', lpad((m / 60)::text, 2, '0') || ':' || lpad((m % 60)::text, 2, '0'),
             'ate',  lpad(((m + v_min) / 60)::text, 2, '0') || ':' || lpad(((m + v_min) % 60)::text, 2, '0'),
             -- cabe no expediente, ainda não passou, e não briga com ninguém
             'livre', (m + v_min) <= v_fecha
                  and m > v_agora
                  and not public.receb_choca(p_data, m, v_min),
             'motivo', case
                         when (m + v_min) > v_fecha then 'fecha'
                         when m <= v_agora          then 'passou'
                         when public.receb_choca(p_data, m, v_min) then 'ocupado'
                         else 'livre'
                       end
           ) order by m)
      from generate_series(v_abre, greatest(v_abre, v_fecha - 60), 60) as m
  ), '[]'::jsonb);
end;
$$;


-- ============================================================
-- 3) QUEM PODE CHAMAR
--
-- Anônimo não vê a agenda da loja nem de longe: sem login, forn_meu_id()
-- é nulo e a função devolve vazio — mas a porta fica fechada mesmo assim.
-- ============================================================
revoke all on function public.forn_dias_livres(date,date,int) from public, anon;
grant execute on function public.forn_dias_livres(date,date,int) to authenticated;

revoke all on function public.forn_horarios_livres(date,int) from public, anon;
grant execute on function public.forn_horarios_livres(date,int) to authenticated;


-- ============================================================
-- 4) CONFERÊNCIA
-- ============================================================
select 'as duas funcoes existem' as conferir,
       count(*) filter (where p.proname = 'forn_dias_livres')     as dias_livres,
       count(*) filter (where p.proname = 'forn_horarios_livres') as horarios_livres
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('forn_dias_livres', 'forn_horarios_livres');

select 'anonimo NAO pode chamar' as conferir,
       has_function_privilege('anon', 'public.forn_dias_livres(date,date,int)', 'execute') as anon_dias,
       has_function_privilege('anon', 'public.forn_horarios_livres(date,int)',  'execute') as anon_horarios;
