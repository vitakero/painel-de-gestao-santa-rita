-- ============================================================
-- C16 — ABRIR UM ANEXO JÁ ENVIADO
--
-- O detalhe do agendamento (forn_agenda) devolve id, nome, tipo, tamanho e
-- data de cada anexo — mas NÃO devolve o caminho do arquivo no cofre, de
-- propósito: seria entregar de uma vez o endereço de todos os arquivos só
-- para o caso de o fornecedor querer abrir um.
--
-- Esta função devolve o caminho de UM anexo por vez, conferindo o dono na
-- hora. Com o caminho, o portal pede ao cofre um link que expira em 60
-- segundos. Não existe endereço permanente em lugar nenhum.
--
-- interna = false na conferência: papel que a loja anexou para uso interno
-- não vira link para o fornecedor, mesmo que ele descubra o id.
--
-- Pode rodar mais de uma vez sem estragar nada.
-- ============================================================

create or replace function public.forn_anexo_ver(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_forn uuid; v_caminho text; v_nome text;
begin
  v_forn := public.forn_meu_id();
  if v_forn is null then
    return jsonb_build_object('ok', false, 'erro', 'Faça login novamente.');
  end if;

  select x.arquivo, x.nome into v_caminho, v_nome
    from public.receb_anexos x
    join public.receb_agendas a on a.id = x.agenda_id
   where x.id = p_id
     and a.fornecedor_id = v_forn
     and x.interna = false;

  if v_caminho is null then
    -- mesma resposta para "não existe" e "não é seu": quem tenta adivinhar id
    -- de anexo alheio não descobre se acertou o número
    return jsonb_build_object('ok', false, 'erro', 'Arquivo não encontrado.');
  end if;

  return jsonb_build_object('ok', true, 'caminho', v_caminho, 'nome', v_nome);
end;
$$;

revoke all on function public.forn_anexo_ver(uuid) from public, anon;
grant execute on function public.forn_anexo_ver(uuid) to authenticated;


-- ============================================================
-- CONFERÊNCIA
-- ============================================================
select 'a funcao existe' as conferir, count(*) as quantas
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'forn_anexo_ver';

select 'anonimo NAO pode chamar' as conferir,
       has_function_privilege('anon', 'public.forn_anexo_ver(uuid)', 'execute') as anon_ver;
