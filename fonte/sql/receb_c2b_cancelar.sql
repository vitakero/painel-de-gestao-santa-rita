-- ============================================================================
-- CHECKPOINT 2b — cancelar pela agenda nova
--
-- A tela nova lista pelo identificador da estrutura NOVA, mas quem manda em
-- gravação ainda é a tabela antiga. Esta função faz a ponte: recebe a agenda
-- nova, acha a linha antiga correspondente e cancela LÁ — o espelho traz a
-- mudança de volta sozinho.
--
-- Uma porta só de escrita. Quando a direção se inverter, muda aqui dentro e
-- a tela nem fica sabendo.
--
-- Rodar depois de receb_c2_portal.sql.
-- ============================================================================

create or replace function public.forn_cancelar_agenda(p_id uuid, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_forn uuid; a record;
begin
  v_forn := public.forn_meu_id();
  if v_forn is null then
    return jsonb_build_object('ok', false, 'erro', 'Seu cadastro ainda não foi liberado.');
  end if;

  select id, situacao, origem, origem_id into a
    from public.receb_agendas
   where id = p_id and fornecedor_id = v_forn and tenant_id = public.current_tenant();

  if a.id is null then
    return jsonb_build_object('ok', false, 'erro', 'Agendamento não encontrado.');
  end if;
  if a.situacao not in ('solicitada', 'confirmada') then
    return jsonb_build_object('ok', false, 'erro', 'Esse agendamento não pode mais ser cancelado. Fale com a loja.');
  end if;

  if a.origem = 'entregas_agendamento' and a.origem_id is not null then
    -- cancela na tabela que ainda manda; o espelho atualiza a agenda nova
    update public.entregas_agendamento
       set status = 'cancelado', atualizado_em = now()
     where id = a.origem_id and fornecedor_id = v_forn;
  else
    update public.receb_agendas
       set situacao = 'cancelada', motivo = nullif(trim(coalesce(p_motivo, '')), '')
     where id = a.id;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.forn_cancelar_agenda(uuid, text) from public, anon;
grant execute on function public.forn_cancelar_agenda(uuid, text) to authenticated;

select 'forn_cancelar_agenda criada' as conferir,
       case when exists (select 1 from pg_proc
                          where proname = 'forn_cancelar_agenda'
                            and pronamespace = 'public'::regnamespace)
            then 'SIM' else 'NAO' end as resultado;
