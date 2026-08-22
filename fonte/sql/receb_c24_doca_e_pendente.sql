-- ============================================================================
-- DOIS BURACOS DO RECEBIMENTO
--
-- (A) A DOCA NÃO TEM COMO RECUSAR UMA ENTREGA.
--     Quando o caminhão encosta, o único botão é "✓ Conferido". Os estados de hoje
--     são pendente / aprovado / recusado / conferido / cancelado — e "recusado"
--     quer dizer "a loja não aprovou o PEDIDO DE HORÁRIO", antes do caminhão sair.
--     Não existe nada para "o caminhão veio e eu recusei a carga". Quem recebe fica
--     com duas saídas ruins: marcar como conferido (mentira que entra na história e
--     no faturamento) ou deixar a linha pendurada para sempre.
--
-- (B) UM PEDIDO PENDENTE SEGURA O HORÁRIO PARA SEMPRE.
--     O índice ux_entrega_slot reserva a janela para os estados
--     pendente/aprovado/conferido. Um "pendente" da semana passada continua
--     bloqueando aquela hora, mesmo depois que o dia passou. Ninguém mais agenda
--     ali, e ninguém percebe porque o horário some da lista sem explicação.
--
-- O QUE NÃO MUDA: nenhum estado existente muda de significado, nenhuma linha é
-- apagada, e "recusado" continua sendo o que sempre foi.
--
-- Rodar no SQL Editor do Supabase. Pode rodar mais de uma vez sem estragar nada.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) CAMPOS NOVOS
--
-- motivo: recusar uma entrega sem dizer por quê não serve para a loja (não vira
-- histórico) nem para o fornecedor (não sabe o que corrigir). Por isso ele é
-- OBRIGATÓRIO na recusa de doca — ver a função lá embaixo.
-- ----------------------------------------------------------------------------
alter table public.entregas_agendamento
  add column if not exists motivo        text,
  add column if not exists recusado_em   timestamptz,
  add column if not exists recusado_por  uuid,
  add column if not exists expirado_em   timestamptz;

comment on column public.entregas_agendamento.motivo is
  'Por que a entrega foi recusada na doca, ou por que o pedido expirou.';

-- Quanto tempo um pedido pendente espera resposta antes de soltar o horário.
-- NULO de propósito: enquanto o Victor não disser o número, vale só a regra que é
-- aritmética e não decisão (o horário já passou). Não invento prazo.
alter table public.receb_locais
  add column if not exists pendente_vence_horas int;

comment on column public.receb_locais.pendente_vence_horas is
  'Horas que um pedido pendente espera resposta antes de soltar o horário. '
  'NULO = só solta quando o horário dele já passou.';

-- ----------------------------------------------------------------------------
-- 2) OS DOIS ESTADOS NOVOS DO LADO NOVO (receb_agendas)
--
-- O espelho desarma a máquina de estados, mas quem mexer direto na receb_agendas
-- passa por ela — então as transições precisam existir de verdade.
-- ----------------------------------------------------------------------------
insert into public.receb_transicoes (eixo, de, para) values
  ('agenda','confirmada','entrega_recusada'),      -- chegou e foi recusado antes de descarregar
  ('agenda','em_recebimento','entrega_recusada'),  -- recusado no meio da descarga
  ('agenda','solicitada','expirada')               -- ninguém respondeu e o horário passou
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- 3) A HISTÓRIA REGISTRA OS DOIS COM NOME PRÓPRIO
--
-- Sem isto os dois entrariam no livro como "mudou", que não conta nada. Vai para a
-- receb_eventos, que já é a auditoria de todo mundo — não crio livro paralelo.
-- ----------------------------------------------------------------------------
create or replace function public.receb_agenda_depois()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.receb_eventos (entidade, entidade_id, acao, para, quem, detalhe)
    values ('agenda', new.id, 'criou', new.situacao, auth.uid(),
            jsonb_build_object('ticket', new.ticket, 'fornecedor_id', new.fornecedor_id));
    return new;
  end if;

  if new.situacao is distinct from old.situacao then
    insert into public.receb_eventos (entidade, entidade_id, acao, de, para, motivo, quem, detalhe)
    values ('agenda', new.id,
            case new.situacao
              when 'solicitada' then 'solicitou' when 'confirmada' then 'confirmou'
              when 'recusada' then 'recusou'     when 'cancelada' then 'cancelou'
              when 'em_recebimento' then 'iniciou' when 'concluida' then 'concluiu'
              when 'nao_compareceu' then 'faltou'
              when 'entrega_recusada' then 'recusou_entrega'
              when 'expirada' then 'expirou'
              else 'mudou' end,
            old.situacao, new.situacao, new.motivo, auth.uid(),
            jsonb_build_object('ticket', new.ticket));
  end if;

  if new.sit_doc is distinct from old.sit_doc then
    insert into public.receb_eventos (entidade, entidade_id, acao, de, para, quem)
    values ('agenda', new.id, 'documento', old.sit_doc, new.sit_doc, auth.uid());
  end if;

  -- Só é remarcação quando havia horário ANTES e há horário DEPOIS, e eles são
  -- diferentes. Perder a janela (cancelamento) não é remarcação.
  if old.janela is not null and new.janela is not null
     and lower(new.janela) is distinct from lower(old.janela) then
    insert into public.receb_eventos (entidade, entidade_id, acao, de, para, motivo, quem, detalhe)
    values ('agenda', new.id, 'reagendou',
            to_char(lower(old.janela) at time zone 'America/Fortaleza', 'DD/MM/YYYY HH24:MI'),
            to_char(lower(new.janela) at time zone 'America/Fortaleza', 'DD/MM/YYYY HH24:MI'),
            new.motivo, auth.uid(),
            jsonb_build_object('janela_antes', old.janela::text, 'janela_depois', new.janela::text));
  end if;

  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4) O ESPELHO APRENDE OS DOIS ESTADOS
--
-- E ganha uma rede que faltava: até aqui, um status que o espelho não conhecesse
-- caía em "solicitada" pelo `else`. Isso é uma armadilha silenciosa — bastava
-- alguém criar um status novo e esquecer do mapa para a agenda VOLTAR a ocupar a
-- doca sozinha. Agora status desconhecido MANTÉM o que já estava.
-- ----------------------------------------------------------------------------
create or replace function public.receb_espelhar_antiga()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_local uuid; v_doca uuid; v_ini timestamptz; v_sit text; v_id uuid; v_ped text;
  v_sit_atual text; v_viva boolean;
begin
  if tg_op = 'DELETE' then
    -- some da nova junto: agenda órfã continuaria ocupando a doca para sempre
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
    when 'expirado'         then 'expirada'
    else null end;

  -- "viva" = ainda vai acontecer, então segura a janela. Uma lista só, usada nos
  -- dois lugares abaixo — antes ela aparecia escrita duas vezes.
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

    -- status que eu não conheço não pode reescrever a situação: mantenho o que há.
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
        -- o porquê da recusa tem que viajar junto: é ele que o gatilho da história grava
        motivo            = coalesce(nullif(trim(coalesce(new.motivo, '')), ''), motivo),
        inicio_solicitado = v_ini,
        -- a data em que a loja confirmou é história: cancelar depois não apaga
        confirmada_em     = coalesce(confirmada_em,
                              case when new.status in ('aprovado','conferido')
                                   then new.atualizado_em end),
        confirmada_por    = coalesce(new.aprovado_por, confirmada_por),
        janela            = case when v_viva
                                 then tstzrange(v_ini, v_ini + interval '60 minutes', '[)') end
      where id = v_id;
    end if;

    -- o número do pedido que o fornecedor digitou tem que reaparecer para ele
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
-- 5) (B) O PENDENTE VENCE
--
-- Duas regras, e elas são diferentes de propósito:
--
--   (a) ARITMÉTICA, não decisão: um pedido marcado para terça passada às 9h não
--       vai acontecer. Isso não é opinião de ninguém, é o calendário. Vale sempre.
--
--   (b) DECISÃO DA LOJA: "sem resposta em N horas, solta o horário". O N é do
--       Victor. Enquanto ele não disser, fica NULO e a regra simplesmente não roda.
--       Não invento prazo.
--
-- Roda sozinha, sem agendador: as duas portas por onde alguém olha ou pega horário
-- (ver horários livres / solicitar) chamam ela antes. Assim o horário se solta na
-- hora em que faz falta, que é quando alguém tenta usá-lo.
-- ----------------------------------------------------------------------------
create or replace function public.ent_expirar_pendentes()
returns int language plpgsql security definer set search_path = public, extensions as $$
declare v_horas int; v_n int;
begin
  select pendente_vence_horas into v_horas
    from public.receb_locais
   where tenant_id = public.current_tenant()
   order by criado_em limit 1;

  update public.entregas_agendamento
     set status       = 'expirado',
         expirado_em  = now(),
         atualizado_em = now(),
         motivo = coalesce(nullif(trim(coalesce(motivo,'')),''),
                           case when (data + hora) at time zone 'America/Fortaleza' < now()
                                then 'O horário pedido passou sem a loja responder.'
                                else 'A loja não respondeu dentro do prazo.' end)
   where tenant_id = public.current_tenant()
     and status = 'pendente'
     and (
           (data + hora) at time zone 'America/Fortaleza' < now()
           or (v_horas is not null and criado_em < now() - make_interval(hours => v_horas))
         );

  get diagnostics v_n = row_count;
  return v_n;
end $$;

comment on function public.ent_expirar_pendentes() is
  'Solta o horário de pedidos pendentes que já passaram (ou que estouraram o prazo '
  'da loja, se receb_locais.pendente_vence_horas estiver preenchido).';

-- Ninguém chama de fora: quem chama são as duas funções abaixo, que já rodam com
-- poder próprio. Deixar aberta seria dar a estranho um botão de escrever.
revoke all on function public.ent_expirar_pendentes() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 6) AS DUAS PORTAS PASSAM A VARRER ANTES DE RESPONDER
--    (idênticas às de hoje, só com a varrida na frente)
-- ----------------------------------------------------------------------------
create or replace function public.ent_horarios_livres(p_data date)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_out jsonb;
begin
  if p_data is null or p_data < current_date or p_data > current_date + 60 then return '[]'::jsonb; end if;
  if extract(isodow from p_data) > 5 then return '[]'::jsonb; end if;   -- só segunda a sexta

  perform public.ent_expirar_pendentes();   -- horário de pendente vencido volta a aparecer

  select jsonb_agg(jsonb_build_object(
           'h', h,
           'hora', lpad(h::text,2,'0') || ':00',
           'livre', not exists (
              select 1 from public.entregas_agendamento e
              where e.tenant_id = public.current_tenant()
                and e.data = p_data and e.hora = make_time(h,0,0)
                and e.status in ('pendente','aprovado','conferido'))
         ) order by h)
    into v_out
    from generate_series(7,16) h;
  return coalesce(v_out, '[]'::jsonb);
end $$;

create or replace function public.ent_solicitar(
  p_fornecedor text, p_documento text, p_contato text,
  p_data date, p_hora int, p_pedido text, p_descricao text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid;
begin
  if coalesce(trim(p_fornecedor),'') = '' then return jsonb_build_object('ok',false,'erro','Informe a empresa.'); end if;
  if p_data is null or p_data < current_date or p_data > current_date + 60 then return jsonb_build_object('ok',false,'erro','Escolha uma data válida.'); end if;
  if extract(isodow from p_data) > 5 then return jsonb_build_object('ok',false,'erro','Recebemos de segunda a sexta.'); end if;
  if p_hora is null or p_hora < 7 or p_hora > 16 then return jsonb_build_object('ok',false,'erro','Horário fora do funcionamento.'); end if;

  perform public.ent_expirar_pendentes();   -- não posso recusar por causa de um morto

  if exists (select 1 from public.entregas_agendamento e
             where e.tenant_id = public.current_tenant() and e.data = p_data
               and e.hora = make_time(p_hora,0,0) and e.status in ('pendente','aprovado','conferido')) then
    return jsonb_build_object('ok',false,'erro','Esse horário acabou de ser reservado. Escolha outro.');
  end if;
  insert into public.entregas_agendamento(fornecedor,documento,contato,data,hora,pedido,descricao,status,origem)
  values (left(trim(p_fornecedor),120),
          nullif(left(trim(coalesce(p_documento,'')),30),''),
          nullif(left(trim(coalesce(p_contato,'')),40),''),
          p_data, make_time(p_hora,0,0),
          nullif(left(trim(coalesce(p_pedido,'')),40),''),
          nullif(left(trim(coalesce(p_descricao,'')),300),''),
          'pendente','fornecedor')
  returning id into v_id;
  return jsonb_build_object('ok',true,'id',v_id);
exception when unique_violation then
  return jsonb_build_object('ok',false,'erro','Esse horário acabou de ser reservado. Escolha outro.');
end $$;

-- ----------------------------------------------------------------------------
-- 7) (A) A DOCA PASSA A PODER RECUSAR
--
-- A versão de 3 argumentos é a de verdade. A de 2 vira um atalho que chama ela —
-- assim a regra mora num lugar só e o painel publicado hoje continua funcionando
-- enquanto a tela nova não sobe.
-- ----------------------------------------------------------------------------
create or replace function public.ent_definir_status(p_id uuid, p_status text, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_atual text; v_mot text;
begin
  if not (public.sou_master() or public.pode_pagina('central')) then
    return jsonb_build_object('ok',false,'erro','Sem permissão.');
  end if;
  if p_status not in ('aprovado','recusado','conferido','cancelado','pendente','recusado_na_doca') then
    return jsonb_build_object('ok',false,'erro','Status inválido.');
  end if;

  select status into v_atual from public.entregas_agendamento
   where id = p_id and tenant_id = public.current_tenant();
  if v_atual is null then
    return jsonb_build_object('ok',false,'erro','Esse agendamento não existe mais.');
  end if;

  v_mot := nullif(trim(coalesce(p_motivo,'')),'');

  if p_status = 'recusado_na_doca' then
    -- Recusar sem dizer por quê não serve para ninguém: a loja não guarda história
    -- e o fornecedor não sabe o que corrigir.
    if v_mot is null then
      return jsonb_build_object('ok',false,'erro',
        'Escreva o motivo da recusa. É o que o fornecedor vai receber e o que fica na história da entrega.');
    end if;
    -- Recusa de doca é para caminhão que VEIO. Antes de aprovar não existe caminhão:
    -- ali o certo é "recusado", que já existe e quer dizer outra coisa.
    if v_atual <> 'aprovado' then
      return jsonb_build_object('ok',false,'erro',
        'Só dá para recusar a entrega de um agendamento aprovado. '
        'Se a loja ainda não aprovou o horário, use Recusar.');
    end if;
  end if;

  update public.entregas_agendamento
     set status = p_status,
         atualizado_em = now(),
         motivo       = coalesce(v_mot, motivo),
         aprovado_por = case when p_status='aprovado' then auth.uid() else aprovado_por end,
         conferido_em = case when p_status='conferido' then now() else conferido_em end,
         recusado_em  = case when p_status='recusado_na_doca' then now() else recusado_em end,
         recusado_por = case when p_status='recusado_na_doca' then auth.uid() else recusado_por end
   where id = p_id and tenant_id = public.current_tenant();

  return jsonb_build_object('ok', found);
end $$;

-- O atalho de 2 argumentos: só repassa. Sem default, para não ficar ambíguo com a
-- versão de 3 (chamada de 2 casaria com as duas e o banco recusaria as duas).
create or replace function public.ent_definir_status(p_id uuid, p_status text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
begin
  return public.ent_definir_status(p_id, p_status, null);
end $$;

grant execute on function public.ent_definir_status(uuid,text)      to authenticated;
grant execute on function public.ent_definir_status(uuid,text,text) to authenticated;
revoke all on function public.ent_definir_status(uuid,text,text) from public, anon;

-- ----------------------------------------------------------------------------
-- 6b) A PORTA QUE O PORTAL USA DE VERDADE
--
-- Existem DUAS ent_solicitar: a de 7 argumentos (antiga) e a de 8, que pede o email.
-- Quem o fornecedor usa hoje é a de 8. Varrer só a de 7 seria consertar a porta que
-- ninguém abre — o tipo de engano que passa despercebido porque "o SQL rodou".
-- ----------------------------------------------------------------------------
create or replace function public.ent_solicitar(
  p_fornecedor text, p_documento text, p_contato text,
  p_data date, p_hora int, p_pedido text, p_descricao text, p_email text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid; v_email text;
begin
  if coalesce(trim(p_fornecedor),'') = '' then return jsonb_build_object('ok',false,'erro','Informe a empresa.'); end if;
  if p_data is null or p_data < current_date or p_data > current_date + 60 then return jsonb_build_object('ok',false,'erro','Escolha uma data válida.'); end if;
  if extract(isodow from p_data) > 5 then return jsonb_build_object('ok',false,'erro','Recebemos de segunda a sexta.'); end if;
  if p_hora is null or p_hora < 7 or p_hora > 16 then return jsonb_build_object('ok',false,'erro','Horário fora do funcionamento.'); end if;

  -- O email é a única forma de responder a este fornecedor. Sem ele, o pedido nasce órfão.
  v_email := lower(nullif(trim(coalesce(p_email,'')),''));
  if v_email is null then
    return jsonb_build_object('ok',false,'erro','Informe um email — é por onde avisamos se foi aprovado.');
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' then
    return jsonb_build_object('ok',false,'erro','Esse email não parece válido. Confira.');
  end if;

  perform public.ent_expirar_pendentes();   -- não posso recusar por causa de um morto

  if exists (select 1 from public.entregas_agendamento e
             where e.tenant_id = public.current_tenant() and e.data = p_data
               and e.hora = make_time(p_hora,0,0) and e.status in ('pendente','aprovado','conferido')) then
    return jsonb_build_object('ok',false,'erro','Esse horário acabou de ser reservado. Escolha outro.');
  end if;

  insert into public.entregas_agendamento(fornecedor,documento,contato,email,data,hora,pedido,descricao,status,origem)
  values (left(trim(p_fornecedor),120),
          nullif(left(trim(coalesce(p_documento,'')),30),''),
          nullif(left(trim(coalesce(p_contato,'')),40),''),
          left(v_email,160),
          p_data, make_time(p_hora,0,0),
          nullif(left(trim(coalesce(p_pedido,'')),40),''),
          nullif(left(trim(coalesce(p_descricao,'')),300),''),
          'pendente','fornecedor')
  returning id into v_id;
  return jsonb_build_object('ok',true,'id',v_id);
exception when unique_violation then
  return jsonb_build_object('ok',false,'erro','Esse horário acabou de ser reservado. Escolha outro.');
end $$;

-- SEM linha de grant aqui, DE PROPÓSITO. O "create or replace" preserva as permissões
-- que a função já tinha, e essa porta foi FECHADA para anônimo em 14/08/2026
-- (agendamento_fechar_porta_anonima.sql). Eu cheguei a copiar o "to anon, authenticated"
-- do arquivo original e reabri a porta por algumas horas — o conserto está no
-- receb_c25_fechar_porta_de_novo.sql, e o teste porta-anonima.test.cjs impede a volta.

-- ----------------------------------------------------------------------------
-- 7b) O MOTIVO CHEGA NO EMAIL
--
-- O texto do email NUNCA vem do navegador — vem daqui, do banco, lido com o login de
-- quem clicou. Se viesse de fora, qualquer pessoa logada mandaria qualquer coisa para
-- qualquer endereço assinando como o supermercado. Por isso o motivo entra AQUI.
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
-- 8) CONFERÊNCIA
-- ----------------------------------------------------------------------------
select 'a doca pode recusar (funcao de 3 argumentos)' as o_que,
       (select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' and p.proname='ent_definir_status'
           and pg_get_function_identity_arguments(p.oid)='uuid, text, text') as resultado
union all
select 'o atalho de 2 argumentos continua de pe',
       (select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' and p.proname='ent_definir_status'
           and pg_get_function_identity_arguments(p.oid)='uuid, text')
union all
select 'o pendente sabe vencer',
       (select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' and p.proname='ent_expirar_pendentes')
union all
select 'transicoes novas (tem que ser 3)',
       (select count(*)::text from public.receb_transicoes
         where eixo='agenda' and para in ('entrega_recusada','expirada'))
union all
select 'prazo do pendente (NULO ate o Victor dizer)',
       coalesce((select pendente_vence_horas::text from public.receb_locais
                  order by criado_em limit 1), 'nulo - so vence quando o horario passa')
union all
select 'pendentes vencidos segurando horario AGORA',
       (select count(*)::text from public.entregas_agendamento
         where status='pendente'
           and (data + hora) at time zone 'America/Fortaleza' < now());
