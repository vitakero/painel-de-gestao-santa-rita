-- ============================================================================
-- FECHAR A PORTA ANÔNIMA DO AGENDAMENTO  (versão 2 — a 1 não pegou)
--
-- Contexto: o agendamento anônimo (agendar.html) permitia a QUALQUER pessoa na
-- internet pedir um horário sem se identificar. E, como o pedido nasce com
-- status 'pendente' e o índice único já reserva a janela nesse status, dava
-- para ocupar as janelas de 60 dias inteiras em minutos.
--
-- O dono confirmou em 14/08/2026 que aquele link NUNCA foi distribuído a
-- fornecedor nenhum. Sem ninguém usando, o Portal do Fornecedor (com cadastro,
-- senha e liberação pela loja) passa a ser a única porta.
--
-- POR QUE A VERSÃO 1 FALHOU:
--   Ela fez "revoke ... from anon". Mas a permissão do anônimo não vinha de um
--   grant pro papel anon — vinha do PUBLIC, que no Postgres é "todo mundo" e
--   ganha EXECUTE automaticamente quando uma função é criada. Tirar do anon com
--   o PUBLIC aberto é tirar o nome da lista de convidados com a porta destrancada.
--
--   Daí a conferência continuar dizendo "AINDA ABERTA PRA ANONIMO": o
--   has_function_privilege enxerga o caminho pelo PUBLIC, e estava certo.
--
-- Esta versão tira do PUBLIC e do anon, e devolve explicitamente pro
-- authenticated — que é quem ainda pode precisar (nada no painel chama essas
-- duas hoje, mas não custa manter quem está logado).
-- ============================================================================

-- 1) fecha pra todo mundo
revoke execute on function public.ent_solicitar(text,text,text,date,int,text,text)      from public, anon;
revoke execute on function public.ent_solicitar(text,text,text,date,int,text,text,text) from public, anon;
revoke execute on function public.ent_horarios_livres(date)                             from public, anon;

-- 2) devolve só pra quem fez login
grant execute on function public.ent_solicitar(text,text,text,date,int,text,text)      to authenticated;
grant execute on function public.ent_solicitar(text,text,text,date,int,text,text,text) to authenticated;
grant execute on function public.ent_horarios_livres(date)                             to authenticated;


-- ============================================================
-- CONFERÊNCIA — agora as três têm que dizer "fechada"
-- ============================================================
select p.proname as funcao,
       case when has_function_privilege('anon', p.oid, 'execute')
            then 'AINDA ABERTA PRA ANONIMO' else 'fechada' end as pra_anonimo,
       case when has_function_privilege('authenticated', p.oid, 'execute')
            then 'ok' else 'FECHOU DEMAIS - me avise' end as pra_quem_tem_login
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('ent_solicitar', 'ent_horarios_livres')
 order by 1;
