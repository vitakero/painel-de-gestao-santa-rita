-- ============================================================================
-- O GATILHO DE CONTA NOVA — deixar de criar ficha de funcionário pra fornecedor
--
-- Como está hoje: toda conta criada no Supabase vira uma ficha em public.perfis,
-- que é a fila de "aguardando aprovação" do painel. Isso está certo pro
-- funcionário — é assim que o Victor libera gente da loja.
--
-- O problema: o site do fornecedor cria conta no MESMO Supabase. Sem este
-- ajuste, cada fornecedor que se cadastrar aparece na lista de FUNCIONÁRIOS
-- esperando liberação, misturado com gente da loja. Na primeira semana a
-- Coca-Cola estaria pedindo pra ser funcionária do Santa Rita.
--
-- O ajuste: o site do fornecedor marca a conta com tipo = 'fornecedor' na hora
-- de criar. O gatilho olha essa marca e, se for fornecedor, não cria ficha.
--
-- POR QUE ISSO É SEGURO: a marca só serve pra NÃO criar a ficha. Alguém que
-- forjasse a marca ficaria com MENOS acesso, não com mais — sem ficha, não
-- passa em nenhuma tela do painel. O caminho contrário (virar funcionário)
-- continua exigindo a aprovação do master, como sempre.
--
-- O cadastro dos seus funcionários não muda em nada.
--
-- Rodar uma vez no SQL Editor do Supabase.
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
as $function$
begin
  -- Conta nascida no site do fornecedor: não é gente da loja, não entra na
  -- fila de aprovação de funcionário. Quem cuida dela é a tela Fornecedores.
  if coalesce(new.raw_user_meta_data->>'tipo', '') = 'fornecedor' then
    return new;
  end if;

  -- Daqui pra baixo é exatamente o que já existia.
  insert into public.perfis (id, email, nome, setor)
  values (new.id, new.email,
          new.raw_user_meta_data->>'nome',
          new.raw_user_meta_data->>'setor');
  return new;
end;
$function$;


-- ============================================================
-- CONFERÊNCIA — depois de rodar, esta linha tem que aparecer
-- ============================================================
select 'gatilho ajustado' as conferir,
       case when pg_get_functiondef(p.oid) like '%tipo%fornecedor%'
            then 'SIM — fornecedor nao vira mais ficha de funcionario'
            else 'NAO — algo deu errado, me avise' end as resultado
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'handle_new_user';
