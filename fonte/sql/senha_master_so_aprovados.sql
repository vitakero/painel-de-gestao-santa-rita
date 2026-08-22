-- ============================================================
--  SENHA DO MASTER — só contas APROVADAS podem tentar
--  Rodar UMA vez no SQL Editor do Supabase: cole tudo e clique RUN.
--
--  POR QUE:
--  O cadastro do painel é aberto de propósito — o funcionário clica em
--  "Criar conta", confirma o e-mail e espera você liberar nos Acessos.
--  Isso é bom para o dia a dia, mas abria uma brecha: a trava contra chute
--  de senha conta 10 erros POR CONTA. Um estranho criaria 50 contas e
--  ganharia 500 tentativas.
--
--  O QUE MUDA:
--  Quem ainda não foi aprovado por você nem chega a testar a senha.
--  Nada muda para os seus funcionários já liberados, e o "Criar conta"
--  continua funcionando igual.
-- ============================================================

create or replace function public.senha_master_ok(senha text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  uid   uuid := auth.uid();
  ok_conta boolean;
  erros int;
  bate  boolean;
begin
  -- 1) tem que estar logado (fecha o oráculo anônimo)
  if uid is null then
    raise exception 'precisa_estar_logado';
  end if;

  -- 2) NOVO: a conta precisa ter sido aprovada pelo master (ou ser o próprio master).
  --    Conta recém-criada por um estranho fica com aprovado=false e para aqui.
  select coalesce(p.aprovado, false) or coalesce(p.is_master, false)
    into ok_conta
    from public.perfis p
   where p.id = uid;

  if not coalesce(ok_conta, false) then
    raise exception 'conta_nao_aprovada';
  end if;

  -- 3) 10 erros em 15 minutos = descansa 15 minutos
  select count(*) into erros
    from public.senha_master_tentativas
   where quem = uid and not acertou and em > now() - interval '15 minutes';
  if erros >= 10 then
    raise exception 'muitas_tentativas';
  end if;

  select exists (
    select 1
      from public.perfis p
      join auth.users u on u.id = p.id
     where coalesce(p.is_master, false)
       and u.encrypted_password = extensions.crypt(senha, u.encrypted_password)
  ) into bate;

  insert into public.senha_master_tentativas (quem, acertou) values (uid, bate);
  return bate;
end;
$$;

revoke all on function public.senha_master_ok(text) from public, anon;
grant execute on function public.senha_master_ok(text) to authenticated;

-- ------------------------------------------------------------
-- CONFERÊNCIA
-- ------------------------------------------------------------
select
  case when has_function_privilege('anon','public.senha_master_ok(text)','execute')
       then '❌ AINDA ABERTA' else '✅' end || ' fechada para anônimo'                as item_1,
  case when exists (
         select 1 from pg_proc
          where proname = 'senha_master_ok'
            and pronamespace = 'public'::regnamespace
            and prosrc like '%conta_nao_aprovada%')
       then '✅' else '❌' end || ' exige conta aprovada'                             as item_2,
  case when exists (select 1 from public.perfis where is_master)
       then '✅' else '❌' end || ' existe pelo menos um master (você não se tranca)' as item_3,
  (select count(*)::text from public.perfis where coalesce(aprovado,false) or coalesce(is_master,false))
       || ' conta(s) aprovada(s) continuam funcionando'                               as item_4;
