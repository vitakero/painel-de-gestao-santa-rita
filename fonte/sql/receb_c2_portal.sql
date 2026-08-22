-- ============================================================================
-- CHECKPOINT 2 — o portal passa a enxergar a estrutura nova
--
-- O que este arquivo faz:
--   · ESPELHA entregas_agendamento → receb_agendas, o tempo todo e sozinho
--   · cria o aviso automático (o sino) quando a situação da agenda muda
--   · cria as funções de LEITURA que as quatro áreas do portal vão usar
--
-- A ideia do espelho: hoje quem manda é a tabela antiga — é ela que o painel
-- lê e é contra ela que o forn_agendar confere horário. Mudar isso de uma vez
-- seria trocar o motor com o carro andando. Então a tabela antiga continua
-- mandando, e cada gravação nela aparece na estrutura nova automaticamente.
-- Quando o formulário novo ficar pronto, a direção se inverte de uma vez só.
--
-- O espelho NUNCA derruba uma gravação. Se ele falhar por qualquer motivo, o
-- agendamento entra do mesmo jeito e a falha fica registrada no livro de
-- eventos pra eu achar depois. Produção não para por causa de espelho.
--
-- Escrita continua toda pelas funções. Nenhuma tabela nova aceita INSERT direto.
--
-- Rodar depois de receb_c1_base.sql. Pode rodar de novo sem estragar nada.
-- ============================================================================


-- ============================================================
-- 1) TRANSIÇÕES QUE O MUNDO REAL USA
--    O jeito antigo pula o "em recebimento": a loja confere e marca pronto.
-- ============================================================
insert into public.receb_transicoes (eixo, de, para) values
  ('agenda','confirmada','concluida'),
  ('agenda','solicitada','nao_compareceu'),
  ('agenda','concluida','em_recebimento')       -- desfazer conferência errada
on conflict do nothing;


-- ============================================================
-- 2) O ESPELHO
-- ============================================================
create or replace function public.receb_espelhar_antiga()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_local uuid; v_doca uuid; v_ini timestamptz; v_sit text; v_id uuid;
begin
  v_sit := case new.status
    when 'pendente'  then 'solicitada'
    when 'aprovado'  then 'confirmada'
    when 'recusado'  then 'recusada'
    when 'conferido' then 'concluida'
    when 'cancelado' then 'cancelada'
    else 'solicitada' end;

  v_ini := (new.data + new.hora) at time zone 'America/Fortaleza';

  begin
    select id into v_local from public.receb_locais limit 1;
    select id into v_doca  from public.receb_docas  where local_id = v_local limit 1;

    select id into v_id from public.receb_agendas
     where origem = 'entregas_agendamento' and origem_id = new.id;

    if v_id is null then
      insert into public.receb_agendas (
        ticket, tipo, local_id, doca_id, fornecedor_id, situacao, sit_doc,
        solicitada_em, inicio_solicitado, minutos_estimados,
        confirmada_em, confirmada_por, janela, criado_em, origem, origem_id
      ) values (
        public.receb_novo_ticket(), 'entrega', v_local, v_doca, new.fornecedor_id,
        v_sit, 'sem_nota',
        new.criado_em, v_ini, 60,
        case when new.status in ('aprovado','conferido') then new.atualizado_em end,
        new.aprovado_por,
        case when new.status in ('pendente','aprovado','conferido')
             then tstzrange(v_ini, v_ini + interval '60 minutes', '[)') end,
        new.criado_em, 'entregas_agendamento', new.id
      );
    else
      update public.receb_agendas set
        situacao          = v_sit,
        fornecedor_id     = coalesce(new.fornecedor_id, fornecedor_id),
        inicio_solicitado = v_ini,
        confirmada_em     = case when new.status in ('aprovado','conferido')
                                 then coalesce(confirmada_em, new.atualizado_em) end,
        confirmada_por    = coalesce(new.aprovado_por, confirmada_por),
        janela            = case when new.status in ('pendente','aprovado','conferido')
                                 then tstzrange(v_ini, v_ini + interval '60 minutes', '[)') end
      where id = v_id;
    end if;

  exception when others then
    -- O espelho falhou. O agendamento continua valendo — anoto e sigo.
    begin
      insert into public.receb_eventos (entidade, entidade_id, acao, para, motivo, detalhe)
      values ('agenda', new.id, 'espelho_falhou', v_sit, sqlerrm,
              jsonb_build_object('data', new.data, 'hora', new.hora, 'status', new.status));
    exception when others then null;
    end;
  end;

  return new;
end;
$$;

drop trigger if exists tg_receb_espelhar on public.entregas_agendamento;
create trigger tg_receb_espelhar
  after insert or update on public.entregas_agendamento
  for each row execute function public.receb_espelhar_antiga();


-- ============================================================
-- 3) O SINO — aviso automático quando a situação muda
-- ============================================================
create or replace function public.receb_avisar_fornecedor()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_tit text; v_txt text; v_quando text;
begin
  if new.fornecedor_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.situacao is not distinct from old.situacao then return new; end if;
  if tg_op = 'INSERT' and new.situacao <> 'solicitada' then return new; end if;

  v_quando := to_char(coalesce(lower(new.janela), new.inicio_solicitado)
                        at time zone 'America/Fortaleza', 'DD/MM às HH24:MI');

  select tit, txt into v_tit, v_txt from (values
    ('solicitada',     'Pedido de horário enviado', 'Seu pedido para ' || v_quando || ' foi enviado. A loja vai conferir.'),
    ('confirmada',     'Entrega confirmada',        'A loja confirmou sua entrega de ' || v_quando || '.'),
    ('recusada',       'Horário não liberado',      'A loja não liberou o horário de ' || v_quando || '.' || coalesce(' Motivo: ' || new.motivo, '')),
    ('cancelada',      'Entrega cancelada',         'A entrega de ' || v_quando || ' foi cancelada.' || coalesce(' Motivo: ' || new.motivo, '')),
    ('em_recebimento', 'Descarga iniciada',         'Sua entrega de ' || v_quando || ' começou a ser recebida.'),
    ('concluida',      'Entrega recebida',          'Sua entrega de ' || v_quando || ' foi recebida.'),
    ('nao_compareceu', 'Entrega não compareceu',    'O caminhão não chegou no horário de ' || v_quando || '.')
  ) as t(sit, tit, txt) where t.sit = new.situacao;

  if v_tit is null then return new; end if;

  insert into public.receb_notificacoes (fornecedor_id, agenda_id, tipo, titulo, texto)
  values (new.fornecedor_id, new.id, new.situacao, v_tit, v_txt);

  return new;
end;
$$;

drop trigger if exists tg_receb_avisar on public.receb_agendas;
create trigger tg_receb_avisar
  after insert or update on public.receb_agendas
  for each row execute function public.receb_avisar_fornecedor();


-- ============================================================
-- 4) INÍCIO — o resumo da primeira tela
-- ============================================================
create or replace function public.forn_inicio()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_forn uuid; v_prox jsonb; v_cont jsonb; v_novos int;
begin
  v_forn := public.forn_meu_id();
  if v_forn is null then return jsonb_build_object('ok', false); end if;

  select jsonb_build_object(
           'id', a.id, 'ticket', a.ticket, 'situacao', a.situacao,
           'quando', to_char(coalesce(lower(a.janela), a.inicio_solicitado)
                               at time zone 'America/Fortaleza', 'YYYY-MM-DD"T"HH24:MI'),
           'doca', d.nome)
    into v_prox
    from public.receb_agendas a
    left join public.receb_docas d on d.id = a.doca_id
   where a.fornecedor_id = v_forn
     and a.situacao in ('solicitada','confirmada','em_recebimento')
     and coalesce(lower(a.janela), a.inicio_solicitado) >= now() - interval '3 hours'
   order by coalesce(lower(a.janela), a.inicio_solicitado)
   limit 1;

  select jsonb_build_object(
           'aguardando',  count(*) filter (where situacao = 'solicitada'),
           'confirmadas', count(*) filter (where situacao = 'confirmada'),
           'recebidas',   count(*) filter (where situacao = 'concluida'))
    into v_cont
    from public.receb_agendas where fornecedor_id = v_forn;

  select count(*) into v_novos from public.receb_notificacoes
   where fornecedor_id = v_forn and lida_em is null;

  return jsonb_build_object('ok', true, 'proxima', v_prox,
                            'contagem', v_cont, 'avisos_novos', coalesce(v_novos, 0));
end;
$$;


-- ============================================================
-- 5) MINHAS AGENDAS — a lista
-- ============================================================
create or replace function public.forn_agendas(p_filtro text default 'proximas')
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_agg(x order by x->>'quando' desc)
      from (
        select jsonb_build_object(
                 'id', a.id, 'ticket', a.ticket, 'tipo', a.tipo, 'situacao', a.situacao,
                 'sit_doc', a.sit_doc, 'motivo', a.motivo,
                 'quando', to_char(coalesce(lower(a.janela), a.inicio_solicitado)
                                     at time zone 'America/Fortaleza', 'YYYY-MM-DD"T"HH24:MI'),
                 'ate', to_char(upper(a.janela) at time zone 'America/Fortaleza', 'HH24:MI'),
                 'doca', d.nome,
                 'notas', (select count(*) from public.receb_agenda_notas n where n.agenda_id = a.id),
                 'pedidos', (select count(*) from public.receb_agenda_pedidos p where p.agenda_id = a.id)
               ) as x,
               coalesce(lower(a.janela), a.inicio_solicitado) as ord
          from public.receb_agendas a
          left join public.receb_docas d on d.id = a.doca_id
         where a.fornecedor_id = public.forn_meu_id()
           and public.forn_meu_id() is not null
           and case coalesce(p_filtro, 'proximas')
                 when 'proximas'  then a.situacao in ('solicitada','confirmada','em_recebimento')
                 when 'passadas'  then a.situacao in ('concluida','recusada','cancelada','nao_compareceu')
                 else true end
         order by ord desc
         limit 120
      ) t),
    '[]'::jsonb);
$$;


-- ============================================================
-- 6) UMA AGENDA POR DENTRO
--
-- Observação interna NÃO entra aqui. A regra de leitura já corta a linha, e
-- esta função ainda filtra de novo. Duas travas, de propósito.
-- ============================================================
create or replace function public.forn_agenda(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_forn uuid; v jsonb;
begin
  v_forn := public.forn_meu_id();
  if v_forn is null then return jsonb_build_object('ok', false, 'erro', 'Cadastro não liberado.'); end if;

  select jsonb_build_object(
    'ok', true,
    'id', a.id, 'ticket', a.ticket, 'tipo', a.tipo, 'situacao', a.situacao,
    'sit_doc', a.sit_doc, 'motivo', a.motivo,
    'quando', to_char(coalesce(lower(a.janela), a.inicio_solicitado)
                        at time zone 'America/Fortaleza', 'YYYY-MM-DD"T"HH24:MI'),
    'ate', to_char(upper(a.janela) at time zone 'America/Fortaleza', 'HH24:MI'),
    'doca', d.nome, 'local', l.nome, 'endereco', l.endereco,
    'tipo_carga', a.tipo_carga, 'tipo_volume', a.tipo_volume,
    'qtd_volumes', a.qtd_volumes, 'peso_kg', a.peso_kg,
    'tipo_veiculo', a.tipo_veiculo, 'placa', a.placa,
    'motorista', a.motorista, 'motorista_fone', a.motorista_fone,
    'transportadora', a.transportadora_nome,
    'chegada_real', to_char(a.chegada_real at time zone 'America/Fortaleza', 'DD/MM HH24:MI'),
    'minutos_reais', a.minutos_reais,
    'notas', coalesce((select jsonb_agg(jsonb_build_object(
                        'id', n.id, 'numero', n.numero, 'serie', n.serie,
                        'chave', n.chave, 'valor', n.valor_total,
                        'situacao', n.situacao, 'erro', n.erro)
                        order by n.criado_em)
                       from public.receb_agenda_notas n where n.agenda_id = a.id), '[]'::jsonb),
    'pedidos', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'numero', p.numero)
                          order by p.criado_em)
                         from public.receb_agenda_pedidos p where p.agenda_id = a.id), '[]'::jsonb),
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
  left join public.receb_docas  d on d.id = a.doca_id
  left join public.receb_locais l on l.id = a.local_id
  where a.id = p_id and a.fornecedor_id = v_forn;

  return coalesce(v, jsonb_build_object('ok', false, 'erro', 'Agenda não encontrada.'));
end;
$$;


-- ============================================================
-- 7) OS AVISOS
-- ============================================================
create or replace function public.forn_avisos()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', n.id, 'agenda_id', n.agenda_id, 'tipo', n.tipo,
             'titulo', n.titulo, 'texto', n.texto, 'nova', (n.lida_em is null),
             'em', to_char(n.criado_em at time zone 'America/Fortaleza', 'DD/MM HH24:MI'))
             order by n.criado_em desc)
      from (select * from public.receb_notificacoes
             where fornecedor_id = public.forn_meu_id()
               and public.forn_meu_id() is not null
             order by criado_em desc limit 40) n),
    '[]'::jsonb);
$$;

create or replace function public.forn_avisos_lidos()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_forn uuid;
begin
  v_forn := public.forn_meu_id();
  if v_forn is null then return jsonb_build_object('ok', false); end if;
  update public.receb_notificacoes set lida_em = now()
   where fornecedor_id = v_forn and lida_em is null;
  return jsonb_build_object('ok', true);
end;
$$;


-- ============================================================
-- 8) CALENDÁRIO
--
-- Conta ocupação pela tabela ANTIGA de propósito: é contra ela que o
-- forn_agendar confere. Enquanto for assim, o que ele vê livre é livre de
-- verdade. Quando o formulário novo entrar, os dois trocam juntos.
--
-- O fornecedor vê "ocupado", nunca DE QUEM. Só o que é dele aparece marcado.
-- ============================================================
create or replace function public.forn_calendario(p_de date, p_ate date)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.forn_meu_id() is null then '[]'::jsonb else coalesce((
    select jsonb_agg(jsonb_build_object(
             'dia',   to_char(d.dia, 'YYYY-MM-DD'),
             'util',  extract(isodow from d.dia) <= 5,
             'passou', d.dia < current_date,
             'livres', case when extract(isodow from d.dia) > 5 or d.dia < current_date then 0 else (
                         select count(*) from generate_series(7,16) h
                          where not exists (
                            select 1 from public.entregas_agendamento e
                             where e.tenant_id = public.current_tenant()
                               and e.data = d.dia and e.hora = make_time(h,0,0)
                               and e.status in ('pendente','aprovado','conferido')))
                       end,
             'meus',  (select count(*) from public.entregas_agendamento e
                        where e.tenant_id = public.current_tenant()
                          and e.data = d.dia
                          and e.fornecedor_id = public.forn_meu_id()
                          and e.status in ('pendente','aprovado','conferido')))
             order by d.dia)
      from generate_series(
             greatest(p_de,  current_date - 180),
             least(p_ate, current_date + 180), interval '1 day') as d(dia)
  ), '[]'::jsonb) end;
$$;


-- ============================================================
-- 9) PEDIDOS — nasce vazio e diz a verdade
--
-- O VR ainda não libera a leitura dos itens de pedido. Em vez de inventar
-- número, a função devolve 'ligado: false' e a tela explica isso pro
-- fornecedor. No dia em que o VR abrir, o robô enche receb_pedidos e a
-- mesma função passa a devolver dado real, sem mexer na tela.
-- ============================================================
create or replace function public.forn_pedidos()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_forn uuid; v_itens jsonb; v_tem boolean;
begin
  v_forn := public.forn_meu_id();
  if v_forn is null then return jsonb_build_object('ok', false); end if;

  select exists (select 1 from public.receb_pedidos limit 1) into v_tem;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'numero', p.numero, 'situacao', p.situacao,
           'emissao', to_char(p.emissao, 'DD/MM/YYYY'),
           'previsao', to_char(p.previsao, 'DD/MM/YYYY'),
           'valor', p.valor_total, 'saldo', p.saldo_valor,
           'itens', (select count(*) from public.receb_pedido_itens i where i.pedido_id = p.id))
           order by p.previsao desc nulls last), '[]'::jsonb)
    into v_itens
    from public.receb_pedidos p
   where p.fornecedor_id = v_forn;

  return jsonb_build_object('ok', true, 'ligado', coalesce(v_tem, false), 'pedidos', v_itens);
end;
$$;


-- ============================================================
-- 10) SÓ AS FUNÇÕES ABREM PORTA
-- ============================================================
revoke all on function public.forn_inicio()            from public, anon;
revoke all on function public.forn_agendas(text)       from public, anon;
revoke all on function public.forn_agenda(uuid)        from public, anon;
revoke all on function public.forn_avisos()            from public, anon;
revoke all on function public.forn_avisos_lidos()      from public, anon;
revoke all on function public.forn_calendario(date,date) from public, anon;
revoke all on function public.forn_pedidos()           from public, anon;

grant execute on function public.forn_inicio()            to authenticated;
grant execute on function public.forn_agendas(text)       to authenticated;
grant execute on function public.forn_agenda(uuid)        to authenticated;
grant execute on function public.forn_avisos()            to authenticated;
grant execute on function public.forn_avisos_lidos()      to authenticated;
grant execute on function public.forn_calendario(date,date) to authenticated;
grant execute on function public.forn_pedidos()           to authenticated;


-- ============================================================
-- 11) O ESPELHO PEGA O QUE JÁ EXISTE
--     (roda o gatilho sem mudar valor nenhum, só pra sincronizar)
-- ============================================================
update public.entregas_agendamento set atualizado_em = atualizado_em where true;


-- ============================================================
-- 12) CONFERÊNCIA
-- ============================================================
select 'espelho instalado' as conferir,
       case when exists (select 1 from pg_trigger where tgname='tg_receb_espelhar')
            then 'SIM' else 'NAO' end as resultado
union all
select 'sino instalado',
       case when exists (select 1 from pg_trigger where tgname='tg_receb_avisar')
            then 'SIM' else 'NAO' end
union all
select 'agendas espelhadas (tem que bater com a de baixo)',
       (select count(*)::text from public.receb_agendas where origem='entregas_agendamento')
union all
select 'agendamentos antigos',
       (select count(*)::text from public.entregas_agendamento)
union all
select 'falhas do espelho (tem que ser 0)',
       (select count(*)::text from public.receb_eventos where acao='espelho_falhou')
union all
select 'funcoes de leitura criadas (tem que ser 7)',
       (select count(distinct proname)::text from pg_proc
         where pronamespace='public'::regnamespace
           and proname in ('forn_inicio','forn_agendas','forn_agenda','forn_avisos',
                           'forn_avisos_lidos','forn_calendario','forn_pedidos'));
