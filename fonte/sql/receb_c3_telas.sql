-- ============================================================================
-- CHECKPOINT 3 — o que as telas novas precisam ler
--
-- SÓ ADIÇÃO. Nenhuma tabela é criada, alterada ou apagada aqui. Nenhuma função
-- existente perde a assinatura — as que já existiam são reescritas devolvendo
-- MAIS campos, e as novas nascem com nome próprio.
--
-- Por que era preciso:
--   · a listagem precisa de DATA SOLICITADA e DATA CONFIRMADA separadas
--     (hoje só existia "quando", que era uma ou outra)
--   · o calendário precisa das agendas de um PERÍODO, em qualquer situação
--   · o detalhe precisa de solicitante e anexos
--   · o Início precisa das PRÓXIMAS agendas, não só da primeira
--
-- Inclui também o forn_cancelar_agenda, que ficou faltando do arquivo anterior.
--
-- Rodar depois de receb_c2_portal.sql. Pode rodar de novo sem estragar nada.
-- ============================================================================


-- ============================================================
-- 1) CANCELAR PELA AGENDA NOVA (era o receb_c2b)
--
-- A tela lista pelo identificador da estrutura NOVA, mas quem manda em gravação
-- ainda é a tabela antiga. Esta função faz a ponte: acha a linha antiga e
-- cancela LÁ — o espelho traz a mudança de volta sozinho.
-- ============================================================
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


-- ============================================================
-- 2) O DESENHO DE UMA LINHA DA TABELA
--
-- Uma função só monta a linha, e as três telas usam. Assim a listagem, o
-- calendário e o Início nunca mostram a mesma agenda de jeitos diferentes.
-- ============================================================
create or replace function public.receb_linha_agenda(a public.receb_agendas)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id',        a.id,
    'ticket',    a.ticket,
    'tipo',      a.tipo,
    'situacao',  a.situacao,
    'sit_doc',   a.sit_doc,
    'motivo',    a.motivo,
    -- o que ele pediu
    'solicitada',      to_char(a.inicio_solicitado at time zone 'America/Fortaleza', 'YYYY-MM-DD"T"HH24:MI'),
    'solicitada_ate',  to_char((a.inicio_solicitado + make_interval(mins => coalesce(a.minutos_estimados, 60)))
                                 at time zone 'America/Fortaleza', 'HH24:MI'),
    -- o que a loja confirmou
    'confirmada',      to_char(lower(a.janela) at time zone 'America/Fortaleza', 'YYYY-MM-DD"T"HH24:MI'),
    'confirmada_ate',  to_char(upper(a.janela) at time zone 'America/Fortaleza', 'HH24:MI'),
    -- o que vale pra ordenar e pintar no calendário
    'quando',    to_char(coalesce(lower(a.janela), a.inicio_solicitado) at time zone 'America/Fortaleza', 'YYYY-MM-DD"T"HH24:MI'),
    'ate',       to_char(coalesce(upper(a.janela), a.inicio_solicitado + make_interval(mins => coalesce(a.minutos_estimados, 60)))
                           at time zone 'America/Fortaleza', 'YYYY-MM-DD"T"HH24:MI'),
    'remetente', (select f.razao_social from public.receb_fornecedores f where f.id = a.fornecedor_id),
    'destinatario', (select l.nome from public.receb_locais l where l.id = a.local_id),
    'doca',      (select d.nome from public.receb_docas d where d.id = a.doca_id),
    'pedidos',   coalesce((select string_agg(p.numero, ', ' order by p.criado_em)
                             from public.receb_agenda_pedidos p where p.agenda_id = a.id), ''),
    'notas',     (select count(*) from public.receb_agenda_notas n where n.agenda_id = a.id)
  );
$$;


-- ============================================================
-- 3) A LISTAGEM COM FILTROS
--
-- Entra um jsonb com o que a tela escolheu; sai {total, itens}. Um caminho só,
-- em vez de uma função por combinação de filtro.
-- ============================================================
create or replace function public.forn_agenda_lista(p_filtros jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_forn uuid;
  v_sit  text[];
  v_tipo text;
  v_de   date;
  v_ate  date;
  v_busca text;
  v_lim  int;
  v_pula int;
  v_total int;
  v_itens jsonb;
begin
  v_forn := public.forn_meu_id();
  if v_forn is null then
    return jsonb_build_object('ok', false, 'total', 0, 'itens', '[]'::jsonb);
  end if;

  v_sit  := case when p_filtros ? 'situacoes' and jsonb_array_length(p_filtros->'situacoes') > 0
                 then array(select jsonb_array_elements_text(p_filtros->'situacoes')) end;
  v_tipo  := nullif(p_filtros->>'tipo', '');
  v_de    := nullif(p_filtros->>'de', '')::date;
  v_ate   := nullif(p_filtros->>'ate', '')::date;
  v_busca := nullif(trim(coalesce(p_filtros->>'busca', '')), '');
  v_lim   := least(greatest(coalesce((p_filtros->>'limite')::int, 25), 1), 200);
  v_pula  := greatest(coalesce((p_filtros->>'pula')::int, 0), 0);

  with base as (
    select a.*, coalesce(lower(a.janela), a.inicio_solicitado) as ord
      from public.receb_agendas a
     where a.tenant_id = public.current_tenant()
       and a.fornecedor_id = v_forn
       and (v_sit  is null or a.situacao = any(v_sit))
       and (v_tipo is null or a.tipo = v_tipo)
       and (v_de   is null or (coalesce(lower(a.janela), a.inicio_solicitado)
                                 at time zone 'America/Fortaleza')::date >= v_de)
       and (v_ate  is null or (coalesce(lower(a.janela), a.inicio_solicitado)
                                 at time zone 'America/Fortaleza')::date <= v_ate)
       and (v_busca is null
            or a.ticket ilike '%' || v_busca || '%'
            or exists (select 1 from public.receb_agenda_pedidos p
                        where p.agenda_id = a.id and p.numero ilike '%' || v_busca || '%'))
  )
  select count(*)::int,
         coalesce((select jsonb_agg(public.receb_linha_agenda(b.*::public.receb_agendas) order by b.ord desc)
                     from (select * from base order by ord desc limit v_lim offset v_pula) b), '[]'::jsonb)
    into v_total, v_itens
    from base;

  return jsonb_build_object('ok', true, 'total', coalesce(v_total, 0), 'itens', v_itens);
end;
$$;


-- ============================================================
-- 4) AS AGENDAS DE UM PERÍODO — para o calendário
-- ============================================================
create or replace function public.forn_agenda_periodo(p_de date, p_ate date)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.forn_meu_id() is null then '[]'::jsonb else coalesce((
    select jsonb_agg(public.receb_linha_agenda(a.*) order by coalesce(lower(a.janela), a.inicio_solicitado))
      from public.receb_agendas a
     where a.tenant_id = public.current_tenant()
       and a.fornecedor_id = public.forn_meu_id()
       and a.situacao <> 'rascunho'
       and (coalesce(lower(a.janela), a.inicio_solicitado) at time zone 'America/Fortaleza')::date
             between greatest(p_de, current_date - 400) and least(p_ate, current_date + 400)
  ), '[]'::jsonb) end;
$$;


-- ============================================================
-- 5) O INÍCIO — agora com as PRÓXIMAS, não só a primeira
-- ============================================================
create or replace function public.forn_inicio()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_forn uuid; v_prox jsonb; v_cont jsonb; v_novos int;
begin
  v_forn := public.forn_meu_id();
  if v_forn is null then return jsonb_build_object('ok', false); end if;

  select coalesce(jsonb_agg(public.receb_linha_agenda(x.*)
                            order by coalesce(lower(x.janela), x.inicio_solicitado)), '[]'::jsonb)
    into v_prox
    from (select a.* from public.receb_agendas a
           where a.fornecedor_id = v_forn
             and a.situacao in ('solicitada','confirmada','em_recebimento')
             and coalesce(lower(a.janela), a.inicio_solicitado) >= now() - interval '4 hours'
           order by coalesce(lower(a.janela), a.inicio_solicitado)
           limit 6) x;

  select jsonb_build_object(
           'aguardando',  count(*) filter (where situacao = 'solicitada'),
           'confirmadas', count(*) filter (where situacao = 'confirmada'),
           'recebidas',   count(*) filter (where situacao = 'concluida'),
           'canceladas',  count(*) filter (where situacao in ('cancelada','recusada','nao_compareceu')))
    into v_cont
    from public.receb_agendas where fornecedor_id = v_forn;

  select count(*) into v_novos from public.receb_notificacoes
   where fornecedor_id = v_forn and lida_em is null;

  return jsonb_build_object('ok', true, 'proximas', v_prox,
                            'contagem', v_cont, 'avisos_novos', coalesce(v_novos, 0));
end;
$$;


-- ============================================================
-- 6) O DETALHE — agora com solicitante e anexos
--
-- Recado interno continua fora: a regra de leitura já corta a linha, e a
-- função filtra de novo. Duas travas, de propósito.
-- ============================================================
create or replace function public.forn_agenda(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_forn uuid; v jsonb;
begin
  v_forn := public.forn_meu_id();
  if v_forn is null then return jsonb_build_object('ok', false, 'erro', 'Cadastro não liberado.'); end if;

  select public.receb_linha_agenda(a.*) || jsonb_build_object(
    'ok', true,
    'local', l.nome, 'endereco', l.endereco,
    'solicitante',  coalesce(f.responsavel, f.razao_social),
    'fornecedor',   f.razao_social,
    'cnpj',         f.cnpj,
    'transportadora', a.transportadora_nome,
    'transportadora_cnpj', a.transportadora_cnpj,
    'tipo_carga', a.tipo_carga, 'tipo_volume', a.tipo_volume,
    'qtd_volumes', a.qtd_volumes, 'peso_kg', a.peso_kg,
    'tipo_veiculo', a.tipo_veiculo, 'placa', a.placa,
    'motorista', a.motorista, 'motorista_fone', a.motorista_fone,
    'minutos', coalesce(a.minutos_estimados, 60),
    'chegada_real', to_char(a.chegada_real at time zone 'America/Fortaleza', 'DD/MM/YYYY HH24:MI'),
    'minutos_reais', a.minutos_reais,
    'notas_fiscais', coalesce((select jsonb_agg(jsonb_build_object(
                        'id', n.id, 'numero', n.numero, 'serie', n.serie,
                        'chave', n.chave, 'valor', n.valor_total,
                        'emitente', n.emitente_nome,
                        'emissao', to_char(n.emissao, 'DD/MM/YYYY'),
                        'situacao', n.situacao, 'erro', n.erro)
                        order by n.criado_em)
                       from public.receb_agenda_notas n where n.agenda_id = a.id), '[]'::jsonb),
    'lista_pedidos', coalesce((select jsonb_agg(jsonb_build_object(
                        'id', p.id, 'numero', p.numero,
                        'fornecedor', f.razao_social,
                        'total', (select pd.valor_total from public.receb_pedidos pd
                                   where pd.id = p.pedido_id))
                        order by p.criado_em)
                       from public.receb_agenda_pedidos p where p.agenda_id = a.id), '[]'::jsonb),
    'anexos', coalesce((select jsonb_agg(jsonb_build_object(
                        'id', x.id, 'nome', x.nome, 'tipo', x.tipo, 'tamanho', x.tamanho,
                        'em', to_char(x.criado_em at time zone 'America/Fortaleza', 'DD/MM/YYYY HH24:MI'))
                        order by x.criado_em)
                       from public.receb_anexos x where x.agenda_id = a.id), '[]'::jsonb),
    'recados', coalesce((select jsonb_agg(jsonb_build_object(
                          'texto', o.texto, 'autor', o.autor_nome,
                          'em', to_char(o.criado_em at time zone 'America/Fortaleza', 'DD/MM/YYYY HH24:MI'))
                          order by o.criado_em)
                         from public.receb_observacoes o
                        where o.agenda_id = a.id and o.interna = false), '[]'::jsonb),
    'historico', coalesce((select jsonb_agg(jsonb_build_object(
                            'acao', ev.acao, 'de', ev.de, 'para', ev.para, 'motivo', ev.motivo,
                            'em', to_char(ev.quando at time zone 'America/Fortaleza', 'DD/MM/YYYY HH24:MI'))
                            order by ev.quando)
                           from public.receb_eventos ev
                          where ev.entidade = 'agenda' and ev.entidade_id = a.id
                            and ev.acao <> 'espelho_falhou'), '[]'::jsonb)
  ) into v
  from public.receb_agendas a
  left join public.receb_locais l on l.id = a.local_id
  left join public.receb_fornecedores f on f.id = a.fornecedor_id
  where a.id = p_id and a.fornecedor_id = v_forn;

  return coalesce(v, jsonb_build_object('ok', false, 'erro', 'Agenda não encontrada.'));
end;
$$;


-- ============================================================
-- 7) SÓ AS FUNÇÕES ABREM PORTA
-- ============================================================
revoke all on function public.forn_cancelar_agenda(uuid, text)    from public, anon;
revoke all on function public.forn_agenda_lista(jsonb)            from public, anon;
revoke all on function public.forn_agenda_periodo(date, date)     from public, anon;
revoke all on function public.receb_linha_agenda(public.receb_agendas) from public, anon;

grant execute on function public.forn_cancelar_agenda(uuid, text) to authenticated;
grant execute on function public.forn_agenda_lista(jsonb)         to authenticated;
grant execute on function public.forn_agenda_periodo(date, date)  to authenticated;
grant execute on function public.receb_linha_agenda(public.receb_agendas) to authenticated;


-- ============================================================
-- 8) CONFERÊNCIA
-- ============================================================
select 'funcoes das telas novas (tem que ser 4)' as conferir,
       (select count(distinct proname)::text from pg_proc
         where pronamespace = 'public'::regnamespace
           and proname in ('forn_cancelar_agenda','forn_agenda_lista',
                           'forn_agenda_periodo','receb_linha_agenda')) as resultado
union all
select 'forn_inicio agora devolve lista',
       case when (public.forn_inicio() ? 'proximas') then 'SIM' else 'NAO' end
union all
select 'nenhuma tabela foi alterada',
       (select count(*)::text from information_schema.tables
         where table_schema = 'public' and table_name like 'receb_%') || ' tabelas receb_ (era 11 + 2 antigas)';
