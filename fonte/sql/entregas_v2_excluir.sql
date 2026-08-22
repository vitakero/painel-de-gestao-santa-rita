-- ============================================================
-- PAINEL SANTA RITA — ENTREGAS v2 · excluir entregador SEM histórico
--
-- Rode UMA vez no SQL Editor, depois do sql/entregas_v2.sql.
-- É seguro rodar de novo.
--
-- POR QUE ISSO EXISTE:
--   Quem já tem lançamento NUNCA pode ser excluído — apagar a pessoa faria os meses
--   antigos mudarem de total, que é justamente o defeito que a v2 veio consertar.
--   Mas cadastro de teste, criado por engano e sem nenhuma entrega, não tem passado
--   nenhum para proteger. Esse, sim, some de vez.
--   Quem decide não é a tela: é o servidor, contando os lançamentos.
--
-- DESFAZER:
--   drop function if exists public.entregas_excluir_pessoa(uuid,uuid);
-- ============================================================

create or replace function public.entregas_excluir_pessoa(p_request_id uuid, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_tenant uuid; v_nome text; v_n integer;
begin
  v_tenant := public.entregas_guarda();

  select nome into v_nome
    from public.entregas_equipe where id = p_id and tenant_id = v_tenant;
  if not found then return; end if;          -- já não existe: repetir não dá erro

  select count(*) into v_n
    from public.entregas_lancamentos
   where tenant_id = v_tenant and entregador_id = p_id;

  if v_n > 0 then
    raise exception
      'Este entregador tem % lançamento(s). Use Inativar — excluir apagaria o histórico.', v_n
      using errcode = '23503';
  end if;

  if not public.entregas_marcar_intencao(p_request_id, 'excluir_pessoa') then return; end if;

  -- O gatilho da equipe só pega INSERT e UPDATE. Como aqui a linha some, o evento é
  -- registrado à mão ANTES do delete — senão a exclusão seria a única coisa sem rastro.
  insert into public.eventos (event_uuid, tenant_id, tipo, entity_type, entity_id,
                              autor_id, setor, resumo, payload)
  values (gen_random_uuid(), v_tenant, 'entregador.excluido', 'entregas_equipe', p_id::text,
          auth.uid(), 'Entregas',
          'Entregador excluído (não tinha nenhum lançamento): ' || v_nome,
          jsonb_build_object('entregador_id', p_id, 'nome', v_nome, 'request_id', p_request_id));

  delete from public.entregas_equipe where id = p_id and tenant_id = v_tenant;
end $$;

revoke all  on function public.entregas_excluir_pessoa(uuid,uuid) from public, anon;
grant execute on function public.entregas_excluir_pessoa(uuid,uuid) to authenticated;

-- conferência
select case when exists (
         select 1 from information_schema.routines
          where routine_schema='public' and routine_name='entregas_excluir_pessoa')
       then 'função criada — OK' else 'NÃO criou, confira o erro acima' end as resultado;
