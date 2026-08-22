-- ============================================================================
-- RECUSA NA DOCA: DE QUEM FOI?
--
-- O buraco: "recusar a entrega" juntava duas coisas muito diferentes.
--
--   Problema na carga  — produto trocado, avariado, validade curta. E do fornecedor,
--                        e ele precisa acertar a mercadoria antes de reenviar.
--   A loja nao pode receber — doca cheia, faltou gente, o carro anterior atrasou.
--                        Nao e culpa dele nenhuma: e so remarcar.
--
-- Mandar "sua entrega foi recusada" quando a doca e que estava cheia faz o fornecedor
-- conferir a carga dele, ver que estava certa, e concluir que a loja e bagunçada e
-- ainda joga a culpa nele. Estraga relacao em silencio, e a loja nunca fica sabendo.
--
-- UM BOTAO SO, DUAS ESCOLHAS. Dois botoes vermelhos parecidos, com o caminhao na
-- doca e o motorista esperando, viram um clique no mais proximo. A tela pergunta
-- "o que houve?" antes de pedir o motivo.
--
-- DE BRINDE: no fim do mes da para contar quantas recusas foram da loja. Se a doca
-- recusa 8 carros por mes por falta de vaga, isso vira numero — e e exatamente o
-- assunto da conversa sobre capacidade.
--
-- Rodar no SQL Editor do Supabase. Pode rodar mais de uma vez sem estragar nada.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) A FUNCAO PASSA A ACEITAR OS DOIS
--
-- 'recusado_na_doca' continua aceito e vale como 'recusado_carga': e o nome que o
-- painel publicado hoje manda, e nao quero um minuto de botao quebrado entre rodar
-- este SQL e publicar a tela nova. Nenhum agendamento usa esse estado ainda.
-- ----------------------------------------------------------------------------
create or replace function public.ent_definir_status(p_id uuid, p_status text, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_atual text; v_mot text; v_st text;
begin
  if not (public.sou_master() or public.pode_pagina('central')) then
    return jsonb_build_object('ok',false,'erro','Sem permissão.');
  end if;

  -- o nome antigo vira o novo aqui, num lugar so
  v_st := case when p_status = 'recusado_na_doca' then 'recusado_carga' else p_status end;

  if v_st not in ('aprovado','recusado','conferido','cancelado','pendente',
                  'recusado_carga','recusado_loja') then
    return jsonb_build_object('ok',false,'erro','Status inválido.');
  end if;

  select status into v_atual from public.entregas_agendamento
   where id = p_id and tenant_id = public.current_tenant();
  if v_atual is null then
    return jsonb_build_object('ok',false,'erro','Esse agendamento não existe mais.');
  end if;

  v_mot := nullif(trim(coalesce(p_motivo,'')),'');

  if v_st in ('recusado_carga','recusado_loja') then
    -- Recusar sem dizer por que nao serve para ninguem: a loja nao guarda historia e
    -- o fornecedor nao sabe o que corrigir. Vale para os dois casos — inclusive
    -- quando a culpa e da loja, porque "doca cheia" e "faltou conferente" pedem
    -- providencias diferentes.
    if v_mot is null then
      return jsonb_build_object('ok',false,'erro',
        'Escreva o motivo. É o que o fornecedor vai receber e o que fica na história da entrega.');
    end if;
    -- Recusa de doca e para caminhao que VEIO. Antes de aprovar nao existe caminhao:
    -- ali o certo e "recusado", que ja existe e quer dizer outra coisa.
    if v_atual <> 'aprovado' then
      return jsonb_build_object('ok',false,'erro',
        'Só dá para recusar a entrega de um agendamento aprovado. '
        'Se a loja ainda não aprovou o horário, use Recusar.');
    end if;
  end if;

  update public.entregas_agendamento
     set status = v_st,
         atualizado_em = now(),
         motivo       = coalesce(v_mot, motivo),
         aprovado_por = case when v_st='aprovado' then auth.uid() else aprovado_por end,
         conferido_em = case when v_st='conferido' then now() else conferido_em end,
         recusado_em  = case when v_st in ('recusado_carga','recusado_loja') then now() else recusado_em end,
         recusado_por = case when v_st in ('recusado_carga','recusado_loja') then auth.uid() else recusado_por end
   where id = p_id and tenant_id = public.current_tenant();

  return jsonb_build_object('ok', found);
end $$;

grant execute on function public.ent_definir_status(uuid,text,text) to authenticated;
revoke all on function public.ent_definir_status(uuid,text,text) from public, anon;

-- ----------------------------------------------------------------------------
-- 2) O ESPELHO CONHECE OS DOIS
--
-- Os dois viram 'entrega_recusada' no lado novo: para a agenda, o que importa e que
-- a entrega nao aconteceu. De quem foi a culpa fica no status antigo e no motivo.
-- ----------------------------------------------------------------------------
create or replace function public.receb_espelhar_antiga()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_local uuid; v_doca uuid; v_ini timestamptz; v_sit text; v_id uuid; v_ped text;
  v_sit_atual text; v_viva boolean;
begin
  if tg_op = 'DELETE' then
    begin
      delete from public.receb_agendas
       where origem = 'entregas_agendamento' and origem_id = old.id;
    exception when others then null;
    end;
    return old;
  end if;

  v_sit := case new.status
    when 'pendente'         then 'solicitada'
    when 'aprovado'         then 'confirmada'
    when 'recusado'         then 'recusada'
    when 'conferido'        then 'concluida'
    when 'cancelado'        then 'cancelada'
    when 'recusado_na_doca' then 'entrega_recusada'
    when 'recusado_carga'   then 'entrega_recusada'
    when 'recusado_loja'    then 'entrega_recusada'
    when 'expirado'         then 'expirada'
    else null end;

  v_viva := new.status in ('pendente','aprovado','conferido');

  v_ini := (new.data + new.hora) at time zone 'America/Fortaleza';
  v_ped := nullif(trim(coalesce(new.pedido, '')), '');

  begin
    perform set_config('receb.espelho', '1', true);

    select id into v_local from public.receb_locais order by criado_em limit 1;
    select id into v_doca  from public.receb_docas
      where local_id = v_local and ativa order by ordem, criado_em limit 1;

    select id, situacao into v_id, v_sit_atual from public.receb_agendas
     where origem = 'entregas_agendamento' and origem_id = new.id;

    -- status que eu nao conheco nao pode reescrever a situacao: mantenho o que ha.
    v_sit := coalesce(v_sit, v_sit_atual, 'solicitada');

    if v_id is null then
      insert into public.receb_agendas (
        ticket, tipo, local_id, doca_id, fornecedor_id, situacao, sit_doc, descricao,
        motivo, solicitada_em, inicio_solicitado, minutos_estimados,
        confirmada_em, confirmada_por, janela, criado_em, origem, origem_id
      ) values (
        public.receb_novo_ticket(), 'entrega', v_local, v_doca, new.fornecedor_id,
        v_sit, 'sem_nota', nullif(trim(coalesce(new.descricao, '')), ''),
        nullif(trim(coalesce(new.motivo, '')), ''),
        new.criado_em, v_ini, 60,
        case when new.status in ('aprovado','conferido') then new.atualizado_em end,
        new.aprovado_por,
        case when v_viva then tstzrange(v_ini, v_ini + interval '60 minutes', '[)') end,
        new.criado_em, 'entregas_agendamento', new.id
      ) returning id into v_id;
    else
      update public.receb_agendas set
        situacao          = v_sit,
        fornecedor_id     = coalesce(new.fornecedor_id, fornecedor_id),
        descricao         = coalesce(nullif(trim(coalesce(new.descricao, '')), ''), descricao),
        motivo            = coalesce(nullif(trim(coalesce(new.motivo, '')), ''), motivo),
        inicio_solicitado = v_ini,
        confirmada_em     = coalesce(confirmada_em,
                              case when new.status in ('aprovado','conferido')
                                   then new.atualizado_em end),
        confirmada_por    = coalesce(new.aprovado_por, confirmada_por),
        janela            = case when v_viva
                                 then tstzrange(v_ini, v_ini + interval '60 minutes', '[)') end
      where id = v_id;
    end if;

    if v_ped is not null and v_id is not null then
      insert into public.receb_agenda_pedidos (agenda_id, numero)
      select v_id, left(v_ped, 40)
       where not exists (select 1 from public.receb_agenda_pedidos p
                          where p.agenda_id = v_id and p.numero = left(v_ped, 40));
    end if;

  exception when others then null;
  end;

  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3) O EMAIL PRECISA SABER DE QUEM FOI
--
-- O texto do email NUNCA vem do navegador — vem daqui, lido com o login de quem
-- clicou. Entao o tipo da recusa tem que sair daqui tambem.
-- ----------------------------------------------------------------------------
create or replace function public.ent_para_aviso(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare r record;
begin
  if not (public.sou_master() or public.pode_pagina('central')) then
    return jsonb_build_object('ok',false,'erro','Sem permissão.');
  end if;
  select fornecedor, email, data, hora, pedido, status, motivo
    into r
    from public.entregas_agendamento
   where id = p_id and tenant_id = public.current_tenant();
  if not found then return jsonb_build_object('ok',false,'erro','Agendamento não encontrado.'); end if;
  if coalesce(trim(r.email),'') = '' then
    return jsonb_build_object('ok',false,'erro','Este fornecedor não deixou email.');
  end if;
  return jsonb_build_object('ok',true,'fornecedor',r.fornecedor,'email',r.email,
                            'data',r.data,'hora',to_char(r.hora,'HH24:MI'),
                            'pedido',r.pedido,'status',r.status,
                            'motivo',coalesce(r.motivo,''));
end $$;

grant execute on function public.ent_para_aviso(uuid) to authenticated;

commit;

-- ----------------------------------------------------------------------------
-- 4) CONFERENCIA
-- ----------------------------------------------------------------------------
select 'aceita problema na carga' as o_que,
       (select case when prosrc like '%recusado_carga%' then 'sim' else 'NAO - me avise' end
          from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' and p.proname='ent_definir_status' and p.pronargs=3) as resultado
union all
select 'aceita "a loja nao pode receber"',
       (select case when prosrc like '%recusado_loja%' then 'sim' else 'NAO - me avise' end
          from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' and p.proname='ent_definir_status' and p.pronargs=3)
union all
select 'o nome antigo continua funcionando',
       (select case when prosrc like '%recusado_na_doca%' then 'sim' else 'NAO - me avise' end
          from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' and p.proname='ent_definir_status' and p.pronargs=3)
union all
select 'o espelho conhece os dois',
       (select case when prosrc like '%recusado_loja%' then 'sim' else 'NAO - me avise' end
          from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' and p.proname='receb_espelhar_antiga')
union all
select 'recusas ate agora (carga)',
       (select count(*)::text from public.entregas_agendamento
         where status in ('recusado_carga','recusado_na_doca'))
union all
select 'recusas ate agora (a loja nao pode)',
       (select count(*)::text from public.entregas_agendamento where status='recusado_loja');
