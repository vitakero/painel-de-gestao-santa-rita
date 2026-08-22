-- ============================================================
-- C12 — A GRADE DE HORÁRIOS SEMPRE NA HORA CHEIA
--
-- O problema (achado por revisão adversarial em 16/08/2026, ainda ADORMECIDO
-- porque hoje receb_locais.abre = '07:00'):
--
-- O agendamento guarda a hora como NÚMERO INTEIRO de hora — forn_agendar
-- recebe p_hora int e grava make_time(p_hora, 0, 0). Não existe meia hora.
--
-- Mas a grade de horários partia do minuto exato da abertura da loja:
--   generate_series(v_abre, ..., 60)
--
-- Enquanto a loja abre 07:00 isso dá 420, 480, 540… — hora cheia, tudo bem.
-- No dia em que alguém mudar receb_locais.abre para '07:30' (o horário mora
-- no banco justamente pra poder mudar sem publicar página), a grade vira
-- 450, 510, 570… e acontece o seguinte:
--
--   1. forn_dias_livres conta 9 vagas -> o calendário do portal acende
--      bolinha VERDE em todos os dias;
--   2. forn_horarios_livres devolve 'hora' = "07:30" mas 'h' = 450/60 = 7,
--      porque a divisão inteira joga o :30 fora;
--   3. o portal manda p_hora = 7 de volta, forn_agendar calcula 7*60 = 420,
--      compara com a abertura (450) e recusa: "fora do expediente da loja".
--
-- Resultado: o mês inteiro verde, todo horário oferecido, e NENHUM
-- agendamento passando. O calendário mentiria por completo.
--
-- A correção: a grade começa na primeira HORA CHEIA a partir da abertura.
-- Com abre = '07:30', o primeiro horário oferecido passa a ser 08:00 —
-- a loja perde meia hora de agenda, mas nada é prometido em falso.
--
-- HOJE ESTE ARQUIVO NÃO MUDA NADA: com abre = '07:00' a conta devolve o
-- mesmo 420 de sempre. Ele existe para o dia em que o horário mudar.
--
-- Pode rodar mais de uma vez sem estragar nada.
-- ============================================================


-- ============================================================
-- 1) A CONTA, NUM LUGAR SÓ
--
-- Duas funções precisam da MESMA grade. Repetir a conta nas duas é como
-- elas começam a discordar — e discordância aqui é o calendário prometendo
-- horário que a lista recusa.
-- ============================================================
create or replace function public.receb_primeira_hora(p_abre_min int)
returns int
language sql immutable set search_path = public as $$
  -- arredonda para cima até a hora cheia: 420 -> 420, 450 -> 480
  select ((coalesce(p_abre_min, 0) + 59) / 60) * 60;
$$;


-- ============================================================
-- 2) AS VAGAS DE CADA DIA
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
  v_de  := greatest(coalesce(p_de,  v_hoje), v_hoje);
  v_ate := least(coalesce(p_ate, v_hoje + 60), v_hoje + 60);
  if v_ate < v_de then return '[]'::jsonb; end if;

  select abre, fecha, dias_semana into l
    from public.receb_locais order by criado_em limit 1;

  v_min   := least(greatest(coalesce(p_minutos, 60), 15), 480);
  -- a grade nasce na hora cheia: é assim que o agendamento sabe guardar
  v_abre  := public.receb_primeira_hora(
               extract(hour from l.abre)::int * 60 + extract(minute from l.abre)::int);
  v_fecha := extract(hour from l.fecha)::int * 60 + extract(minute from l.fecha)::int;
  v_agora := extract(hour   from (now() at time zone 'America/Fortaleza'))::int * 60
           + extract(minute from (now() at time zone 'America/Fortaleza'))::int;

  return coalesce((
    select jsonb_agg(jsonb_build_object('dia', to_char(x.dia, 'YYYY-MM-DD'),
                                        'livres', x.livres) order by x.dia)
      from (
        select g.dia::date as dia,
               count(*) filter (
                 where (m.ini + v_min) <= v_fecha                -- cabe antes de fechar
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
-- 3) OS HORÁRIOS DO DIA
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
  -- a MESMA grade do forn_dias_livres: as duas têm que enxergar igual
  v_abre  := public.receb_primeira_hora(
               extract(hour from l.abre)::int * 60 + extract(minute from l.abre)::int);
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
-- 4) QUEM PODE CHAMAR
-- ============================================================
revoke all on function public.receb_primeira_hora(int)             from public, anon;
revoke all on function public.forn_dias_livres(date,date,int)      from public, anon;
revoke all on function public.forn_horarios_livres(date,int)       from public, anon;
grant execute on function public.receb_primeira_hora(int)          to authenticated;
grant execute on function public.forn_dias_livres(date,date,int)   to authenticated;
grant execute on function public.forn_horarios_livres(date,int)    to authenticated;


-- ============================================================
-- 5) CONFERÊNCIA
-- ============================================================
select 'arredondamento pra hora cheia' as conferir,
       public.receb_primeira_hora(420) as abre_07h00_deve_dar_420,
       public.receb_primeira_hora(450) as abre_07h30_deve_dar_480,
       public.receb_primeira_hora(451) as abre_07h31_deve_dar_480,
       public.receb_primeira_hora(480) as abre_08h00_deve_dar_480;

select 'horario da loja hoje' as conferir, nome, abre, fecha,
       (extract(minute from abre)::int = 0) as abre_em_hora_cheia
  from public.receb_locais order by criado_em limit 1;

select 'anonimo NAO pode chamar' as conferir,
       has_function_privilege('anon', 'public.forn_dias_livres(date,date,int)', 'execute') as anon_dias,
       has_function_privilege('anon', 'public.forn_horarios_livres(date,int)',  'execute') as anon_horarios;
