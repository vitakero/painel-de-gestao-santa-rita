-- ============================================================================
-- FECHAR A PORTA ANÔNIMA DE NOVO — conserto de um erro meu, 20/08/2026
--
-- O QUE EU FIZ DE ERRADO:
-- O arquivo receb_c24 refez a ent_solicitar de 8 argumentos para ela varrer os
-- pendentes vencidos antes de responder. Ao refazê-la, copiei a linha de permissão
-- do arquivo ORIGINAL (agendamento_email.sql), que dizia "to anon, authenticated".
-- Só que em 14/08/2026 essa porta tinha sido FECHADA de propósito, no
-- agendamento_fechar_porta_anonima.sql: qualquer pessoa na internet conseguia pedir
-- horário sem se identificar e, como o pedido nasce 'pendente' e o índice único já
-- reserva a janela nesse estado, dava para ocupar 60 dias de agenda em minutos.
--
-- Copiar a permissão junto com a função desfez a decisão de seis dias antes.
--
-- A LIÇÃO, que virou teste (scripts/testes/porta-anonima.test.cjs): refazer uma
-- função é fácil; refazer a permissão dela junto é o acidente. O "create or replace"
-- PRESERVA as permissões sozinho — a linha de grant não precisava estar lá.
--
-- Rodar no SQL Editor do Supabase. Pode rodar mais de uma vez sem estragar nada.
-- ============================================================================

-- Tirar do PUBLIC, não só do anon: no Postgres o PUBLIC é "todo mundo" e ganha
-- EXECUTE automaticamente quando a função é criada. Foi por isso que a primeira
-- tentativa de fechar, em 14/08, não pegou.
revoke execute on function public.ent_solicitar(text,text,text,date,int,text,text)      from public, anon;
revoke execute on function public.ent_solicitar(text,text,text,date,int,text,text,text) from public, anon;
revoke execute on function public.ent_horarios_livres(date)                             from public, anon;

grant execute on function public.ent_solicitar(text,text,text,date,int,text,text)      to authenticated;
grant execute on function public.ent_solicitar(text,text,text,date,int,text,text,text) to authenticated;
grant execute on function public.ent_horarios_livres(date)                             to authenticated;

-- ============================================================================
-- CONFERÊNCIA — as três têm que dizer "fechada", e o resto do c24 continua certo
-- ============================================================================
select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as funcao,
       case when has_function_privilege('anon', p.oid, 'execute')
            then 'AINDA ABERTA PRA ANONIMO' else 'fechada' end as pra_anonimo,
       case when has_function_privilege('authenticated', p.oid, 'execute')
            then 'ok' else 'FECHOU DEMAIS - me avise' end as pra_quem_tem_login
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('ent_solicitar','ent_horarios_livres',
                     'ent_definir_status','ent_expirar_pendentes','forn_checar_agendamento')
 order by 1;
