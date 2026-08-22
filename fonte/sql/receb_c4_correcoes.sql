-- ============================================================================
-- CHECKPOINT 4 — correções achadas na revisão adversarial de 15/08/2026
--
-- Uma revisão em quatro frentes (segurança, banco, tela, regressão) levantou 40
-- suspeitas; 29 sobreviveram a dois céticos cada. Este arquivo conserta as que
-- são do módulo novo. Nenhuma tabela é apagada; as mudanças de tabela são só
-- COLUNA NOVA, com valor padrão.
--
-- O QUE ESTAVA ERRADO, em ordem de estrago:
--
--  1. forn_agenda lia ev.criado_em, mas receb_eventos guarda a data em "quando".
--     Como plpgsql só confere o corpo na hora de rodar, o CREATE passou limpo.
--     Resultado: abrir QUALQUER agenda no portal novo daria erro. 100% das vezes.
--
--  2. O espelho engolia até a excecão da máquina de estados. Se o painel fizesse
--     uma transição que a máquina não conhece, a tabela antiga mudava e a nova
--     ficava para trás — calada, para sempre. Duas verdades diferentes sobre o
--     mesmo caminhão.
--
--  3. Cancelar gravava "reagendou" no histórico que o fornecedor lê, porque a
--     janela ia para nulo e isso conta como mudança de janela.
--
--  4. Apagar linha antiga deixava a agenda nova viva, ocupando a doca.
--
--  5. O número do pedido que o fornecedor digita não aparecia em lugar nenhum.
--
--  6. receb_novo_ticket era chamável por visitante anônimo (permissão herdada
--     de PUBLIC — o mesmo caminho que já nos pegou em julho).
--
--  7. Anexo da loja seria visível para o fornecedor: não havia como marcar interno.
--
--  8. current_date roda em UTC. Depois das 21h em Caicó, "hoje" já era amanhã.
--
-- Rodar depois de receb_c3_telas.sql. Pode rodar de novo sem estragar nada.
-- ============================================================================


-- ============================================================
-- 1) COLUNAS NOVAS (só adição, com padrão)
-- ============================================================

-- o que o fornecedor escreve sobre a carga, que antes se perdia
alter table public.receb_agendas
  add column if not exists descricao text;

-- anexo nasce FECHADO. Quem for construir o envio pelo fornecedor grava false
-- de propósito. Padrão aberto seria vazamento esperando acontecer.
alter table public.receb_anexos
  add column if not exists interna boolean not null default true;

comment on column public.receb_anexos.interna is
  'true = só a loja vê. Nasce true de propósito: anexo novo é fechado até alguém dizer que pode abrir.';


-- ============================================================
-- 2) O ESPELHO PARA DE ENGOLIR A MÁQUINA DE ESTADOS
--
-- Quem manda em gravação é a tabela antiga. Quando é o espelho copiando,
-- a máquina de estados não tem o que julgar — a decisão já foi tomada lá.
-- A trava continua valendo para quem escrever direto na tabela nova.
-- ============================================================
create or replace function public.receb_agenda_antes()
returns trigger language plpgsql set search_path = public as $$
declare v_reserva boolean; v_espelho boolean;
begin
  v_espelho := coalesce(current_setting('receb.espelho', true), '') = '1';

  if tg_op = 'INSERT' then
    if new.ticket is null or new.ticket = '' then
      new.ticket := public.receb_novo_ticket();
    end if;
  else
    -- transição inválida não passa — a não ser que seja o espelho copiando
    -- uma decisão que a tabela antiga já tomou.
    if not v_espelho then
      if new.situacao <> old.situacao and not public.receb_pode_ir('agenda', old.situacao, new.situacao) then
        raise exception 'Não dá para ir de % para % nesta agenda.', old.situacao, new.situacao
          using errcode = 'check_violation';
      end if;
      if new.sit_doc <> old.sit_doc and not public.receb_pode_ir('documento', old.sit_doc, new.sit_doc) then
        raise exception 'Não dá para ir de % para % na situação do documento.', old.sit_doc, new.sit_doc
          using errcode = 'check_violation';
      end if;
    end if;
    new.atualizado_em := now();
  end if;

  select coalesce(reserva_na_solicitacao, true) into v_reserva
    from public.receb_locais where id = new.local_id;

  -- 'concluida' continua segurando a doca enquanto a tabela antiga segurar o
  -- horário no 'conferido' — senão as duas contas de ocupação divergem.
  new.ocupa_doca := new.situacao in ('confirmada','em_recebimento','concluida')
                 or (coalesce(v_reserva, true) and new.situacao = 'solicitada');

  return new;
end;
$$;


-- ============================================================
-- 3) O "REAGENDOU" FANTASMA
--
-- Cancelar zera a janela. Zerar é mudar, e mudança de janela virava
-- "remarcado de 18/08 10:00 para —" no histórico que o fornecedor lê.
-- Reagendamento é mudar de horário, não perder o horário.
-- ============================================================
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
              when 'nao_compareceu' then 'faltou' else 'mudou' end,
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


-- ============================================================
-- 4) O ESPELHO, REFEITO
--
-- Muda o quê:
--   · liga a bandeira que desarma a máquina de estados (item 2)
--   · copia o NÚMERO DO PEDIDO e a DESCRIÇÃO, que se perdiam
--   · não apaga mais a data de confirmação quando a entrega é cancelada
--   · trata exclusão: linha antiga apagada não deixa agenda viva ocupando doca
--   · escolhe a doca por ORDEM, não por sorte
-- ============================================================
create or replace function public.receb_espelhar_antiga()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_local uuid; v_doca uuid; v_ini timestamptz; v_sit text; v_id uuid; v_ped text;
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
    when 'pendente'  then 'solicitada'
    when 'aprovado'  then 'confirmada'
    when 'recusado'  then 'recusada'
    when 'conferido' then 'concluida'
    when 'cancelado' then 'cancelada'
    else 'solicitada' end;

  v_ini := (new.data + new.hora) at time zone 'America/Fortaleza';
  v_ped := nullif(trim(coalesce(new.pedido, '')), '');

  begin
    perform set_config('receb.espelho', '1', true);

    select id into v_local from public.receb_locais order by criado_em limit 1;
    select id into v_doca  from public.receb_docas
      where local_id = v_local and ativa order by ordem, criado_em limit 1;

    select id into v_id from public.receb_agendas
     where origem = 'entregas_agendamento' and origem_id = new.id;

    if v_id is null then
      insert into public.receb_agendas (
        ticket, tipo, local_id, doca_id, fornecedor_id, situacao, sit_doc, descricao,
        solicitada_em, inicio_solicitado, minutos_estimados,
        confirmada_em, confirmada_por, janela, criado_em, origem, origem_id
      ) values (
        public.receb_novo_ticket(), 'entrega', v_local, v_doca, new.fornecedor_id,
        v_sit, 'sem_nota', nullif(trim(coalesce(new.descricao, '')), ''),
        new.criado_em, v_ini, 60,
        case when new.status in ('aprovado','conferido') then new.atualizado_em end,
        new.aprovado_por,
        case when new.status in ('pendente','aprovado','conferido')
             then tstzrange(v_ini, v_ini + interval '60 minutes', '[)') end,
        new.criado_em, 'entregas_agendamento', new.id
      ) returning id into v_id;
    else
      update public.receb_agendas set
        situacao          = v_sit,
        fornecedor_id     = coalesce(new.fornecedor_id, fornecedor_id),
        descricao         = coalesce(nullif(trim(coalesce(new.descricao, '')), ''), descricao),
        inicio_solicitado = v_ini,
        -- a data em que a loja confirmou é história: cancelar depois não apaga
        confirmada_em     = coalesce(confirmada_em,
                              case when new.status in ('aprovado','conferido')
                                   then new.atualizado_em end),
        confirmada_por    = coalesce(new.aprovado_por, confirmada_por),
        janela            = case when new.status in ('pendente','aprovado','conferido')
                                 then tstzrange(v_ini, v_ini + interval '60 minutes', '[)') end
      where id = v_id;
    end if;

    -- o número do pedido que o fornecedor digitou tem que reaparecer para ele
    if v_ped is not null and v_id is not null then
      insert into public.receb_agenda_pedidos (agenda_id, numero)
      select v_id, v_ped
       where not exists (select 1 from public.receb_agenda_pedidos p
                          where p.agenda_id = v_id and p.numero = v_ped);
    end if;

    perform set_config('receb.espelho', '', true);

  exception when others then
    -- O espelho falhou. O agendamento continua valendo — anoto e sigo.
    -- Produção não para por causa de espelho.
    begin
      perform set_config('receb.espelho', '', true);
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
  after insert or update or delete on public.entregas_agendamento
  for each row execute function public.receb_espelhar_antiga();


-- ============================================================
-- 5) SEM BECO SEM SAÍDA NA MÁQUINA DE ESTADOS
--    O painel pode reabrir o que foi cancelado, recusado ou concluído por engano.
-- ============================================================
insert into public.receb_transicoes (eixo, de, para) values
  ('agenda','cancelada','solicitada'),
  ('agenda','cancelada','confirmada'),
  ('agenda','recusada','confirmada'),
  ('agenda','concluida','confirmada'),
  ('agenda','concluida','cancelada'),
  ('agenda','nao_compareceu','confirmada'),
  ('agenda','nao_compareceu','cancelada'),
  ('agenda','confirmada','recusada'),
  ('agenda','confirmada','solicitada'),
  ('agenda','em_recebimento','confirmada'),
  ('agenda','em_recebimento','cancelada')
on conflict do nothing;


-- ============================================================
-- 6) forn_agenda — o erro que quebrava tudo
--    ev.criado_em não existe. A coluna chama "quando".
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
    'descricao',    a.descricao,
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
    -- anexo interno da loja NÃO sai daqui. SECURITY DEFINER desliga a RLS lá
    -- dentro, então é este filtro que segura — não a política da tabela.
    'anexos', coalesce((select jsonb_agg(jsonb_build_object(
                        'id', x.id, 'nome', x.nome, 'tipo', x.tipo, 'tamanho', x.tamanho,
                        'em', to_char(x.criado_em at time zone 'America/Fortaleza', 'DD/MM/YYYY HH24:MI'))
                        order by x.criado_em)
                       from public.receb_anexos x
                      where x.agenda_id = a.id and x.interna = false), '[]'::jsonb),
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
-- 7) CANCELAR COM GUARDA DOS DOIS LADOS
--    Antes: conferia a situação na tabela NOVA e escrevia na ANTIGA sem olhar.
--    Se as duas divergissem, cancelava o que não podia.
-- ============================================================
create or replace function public.forn_cancelar_agenda(p_id uuid, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_forn uuid; a record; v_ant text; v_linhas int;
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
    -- confere a situação REAL na tabela que manda, não a cópia
    select status into v_ant from public.entregas_agendamento
     where id = a.origem_id and fornecedor_id = v_forn;

    if v_ant is null then
      return jsonb_build_object('ok', false, 'erro', 'Agendamento não encontrado.');
    end if;
    if v_ant not in ('pendente', 'aprovado') then
      return jsonb_build_object('ok', false, 'erro',
        'A loja já mexeu neste agendamento. Atualize a tela e confira antes de cancelar.');
    end if;

    update public.entregas_agendamento
       set status = 'cancelado', atualizado_em = now()
     where id = a.origem_id and fornecedor_id = v_forn
       and status in ('pendente', 'aprovado');
    get diagnostics v_linhas = row_count;

    if v_linhas = 0 then
      return jsonb_build_object('ok', false, 'erro',
        'A loja mexeu neste agendamento agora mesmo. Atualize a tela.');
    end if;
  else
    update public.receb_agendas
       set situacao = 'cancelada', motivo = nullif(trim(coalesce(p_motivo, '')), '')
     where id = a.id and situacao in ('solicitada', 'confirmada');
    get diagnostics v_linhas = row_count;
    if v_linhas = 0 then
      return jsonb_build_object('ok', false, 'erro', 'Esse agendamento não pode mais ser cancelado.');
    end if;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;


-- ============================================================
-- 8) O DIA DE CAICÓ, NÃO O DIA DE GREENWICH
--
-- current_date roda em UTC. Das 21h às 24h em Caicó, o banco já achava que
-- era amanhã: sumia o dia de hoje da lista e deixava marcar hora que já passou.
-- ============================================================
create or replace function public.receb_hoje()
returns date language sql stable set search_path = public as $$
  select (now() at time zone 'America/Fortaleza')::date;
$$;

create or replace function public.forn_horarios_livres(p_data date)
returns jsonb
language sql stable security definer set search_path = public as $$
  select case
    when public.forn_meu_id() is null then '[]'::jsonb
    when p_data is null or p_data < public.receb_hoje() or p_data > public.receb_hoje() + 60 then '[]'::jsonb
    when extract(isodow from p_data) > 5 then '[]'::jsonb
    else coalesce((
      select jsonb_agg(jsonb_build_object(
               'h', h,
               'hora', lpad(h::text, 2, '0') || ':00',
               -- hora que já passou hoje não é hora livre
               'livre', (p_data > public.receb_hoje()
                         or h > extract(hour from (now() at time zone 'America/Fortaleza'))::int)
                 and not exists (
                   select 1 from public.entregas_agendamento e
                    where e.tenant_id = public.current_tenant()
                      and e.data = p_data
                      and e.hora = make_time(h, 0, 0)
                      and e.status in ('pendente', 'aprovado', 'conferido')
                 )
             ) order by h)
        from generate_series(7, 16) as h
    ), '[]'::jsonb)
  end;
$$;

create or replace function public.forn_calendario(p_de date, p_ate date)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.forn_meu_id() is null then '[]'::jsonb else coalesce((
    select jsonb_agg(jsonb_build_object(
             'dia',   to_char(d.dia, 'YYYY-MM-DD'),
             'util',  extract(isodow from d.dia) <= 5,
             'passou', d.dia < public.receb_hoje(),
             'livres', case when extract(isodow from d.dia) > 5 or d.dia < public.receb_hoje() then 0 else (
                         select count(*) from generate_series(7,16) h
                          where (d.dia > public.receb_hoje()
                                 or h > extract(hour from (now() at time zone 'America/Fortaleza'))::int)
                            and not exists (
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
             greatest(p_de,  public.receb_hoje() - 180),
             least(p_ate, public.receb_hoje() + 180), interval '1 day') as d(dia)
  ), '[]'::jsonb) end;
$$;


-- ============================================================
-- 9) FECHAR AS PORTAS QUE FICARAM ENCOSTADAS
--
-- receb_novo_ticket é SECURITY DEFINER e ficou com EXECUTE herdado de PUBLIC:
-- visitante anônimo podia chamar em laço e queimar a numeração de tickets.
-- É o mesmo caminho que já nos pegou em julho — revoke de anon não basta,
-- a permissão vem por PUBLIC.
-- ============================================================
revoke all on function public.receb_novo_ticket()          from public, anon;
revoke all on function public.receb_pode_ir(text,text,text) from public, anon;
revoke all on function public.receb_hoje()                  from public, anon;
grant execute on function public.receb_novo_ticket()        to authenticated;
grant execute on function public.receb_pode_ir(text,text,text) to authenticated;
grant execute on function public.receb_hoje()               to authenticated;

-- local e doca são a agenda da loja, não são segredo — mas só quem tem
-- alguma relação com recebimento precisa ler.
drop policy if exists rl_sel on public.receb_locais;
create policy rl_sel on public.receb_locais for select to authenticated
  using (tenant_id = public.current_tenant()
     and (public.pode_pagina('central') or public.pode_pagina('fornecedores')
          or public.forn_meu_id() is not null));
drop policy if exists rd_sel on public.receb_docas;
create policy rd_sel on public.receb_docas for select to authenticated
  using (tenant_id = public.current_tenant()
     and (public.pode_pagina('central') or public.pode_pagina('fornecedores')
          or public.forn_meu_id() is not null));

-- anexo interno não sai para o fornecedor nem pela leitura direta
drop policy if exists rx_sel on public.receb_anexos;
create policy rx_sel on public.receb_anexos for select to authenticated
  using (
    exists (select 1 from public.receb_agendas a where a.id = agenda_id)
    and (not interna or public.pode_pagina('central') or public.pode_pagina('fornecedores'))
  );


-- ============================================================
-- 10) O PEDIDO QUE JÁ FOI DIGITADO E SE PERDEU
--     Recupera o número de pedido das entregas antigas para a estrutura nova.
-- ============================================================
insert into public.receb_agenda_pedidos (agenda_id, numero)
select a.id, trim(e.pedido)
  from public.receb_agendas a
  join public.entregas_agendamento e on e.id = a.origem_id
 where a.origem = 'entregas_agendamento'
   and nullif(trim(coalesce(e.pedido, '')), '') is not null
   and not exists (select 1 from public.receb_agenda_pedidos p
                    where p.agenda_id = a.id and p.numero = trim(e.pedido));

update public.receb_agendas a
   set descricao = nullif(trim(e.descricao), '')
  from public.entregas_agendamento e
 where e.id = a.origem_id
   and a.origem = 'entregas_agendamento'
   and a.descricao is null
   and nullif(trim(coalesce(e.descricao, '')), '') is not null;


-- ============================================================
-- 11) CONFERÊNCIA
-- ============================================================
select 'forn_agenda usa a coluna certa' as conferir,
       case when exists (
         select 1 from pg_proc where proname='forn_agenda'
          and pronamespace='public'::regnamespace
          and prosrc like '%ev.quando%' and prosrc not like '%ev.criado_em%')
       then 'SIM' else 'NAO' end as resultado
union all
select 'espelho trata exclusao',
       case when exists (select 1 from pg_trigger
                          where tgname='tg_receb_espelhar' and (tgtype & 8) > 0)
            then 'SIM' else 'NAO' end
union all
select 'transicoes carregadas (era 19)',
       (select count(*)::text from public.receb_transicoes)
union all
select 'pedidos recuperados das entregas antigas',
       (select count(*)::text from public.receb_agenda_pedidos)
union all
select 'anexos nascem fechados',
       case when exists (select 1 from information_schema.columns
                          where table_name='receb_anexos' and column_name='interna')
            then 'SIM' else 'NAO' end
union all
select 'ticket fora do alcance do anonimo',
       case when has_function_privilege('anon','public.receb_novo_ticket()','execute')
            then 'AINDA ABERTO' else 'FECHADO' end
union all
select 'falhas do espelho (tem que ser 0)',
       (select count(*)::text from public.receb_eventos where acao='espelho_falhou')
union all
select 'hoje em Caico',
       public.receb_hoje()::text;
