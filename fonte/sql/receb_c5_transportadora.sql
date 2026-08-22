-- ============================================================================
-- CHECKPOINT 5 — o CNPJ da transportadora para de se perder
--
-- O QUE ESTAVA ERRADO:
--   O portal pergunta se quem manda a carga é o próprio fornecedor ou uma
--   transportadora. Se for transportadora, pede o CNPJ, confere o dígito
--   verificador e mostra no resumo. Aí o fornecedor envia — e o CNPJ some.
--   A função forn_agendar só recebia data, hora, pedido e descrição.
--
--   Na prática: o recebimento espera o caminhão do fornecedor e aparece outro,
--   de outra empresa. Confusão na portaria, sem ninguém saber por quê.
--
-- O QUE ESTE ARQUIVO FAZ:
--   · adiciona uma coluna na tabela antiga (só adição, com valor nulo)
--   · troca forn_agendar para aceitar o CNPJ — mantendo o parâmetro OPCIONAL,
--     para que o portal que está no ar hoje, que chama com 4 argumentos,
--     continue funcionando sem mudar nada
--   · faz o espelho levar o CNPJ para a estrutura nova
--
-- ATENÇÃO ao "drop function": trocar a assinatura de uma função exige derrubar
-- e recriar — o "create or replace" com lista de argumentos diferente criaria
-- uma SEGUNDA função com o mesmo nome, e o PostgREST não saberia qual chamar.
-- As duas linhas rodam em sequência; a janela entre elas é de milissegundos.
--
-- Rodar depois de receb_c4_correcoes.sql.
--
-- CUIDADO: SE VOCE JA RODOU O c6 (nota fiscal), NAO rode este de novo.
-- O c6 reescreveu o forn_agendar para tambem receber as notas fiscais.
-- Rodar este arquivo depois traria de volta a versao sem notas — o portal
-- continuaria funcionando, mas as notas seriam descartadas em silencio.
-- ============================================================================


-- ============================================================
-- 1) A COLUNA NOVA NA TABELA QUE AINDA MANDA
-- ============================================================
alter table public.entregas_agendamento
  add column if not exists transportadora_cnpj text;

comment on column public.entregas_agendamento.transportadora_cnpj is
  'Só quando a carga vem por transportadora contratada. Nulo = o próprio fornecedor traz.';


-- ============================================================
-- 2) forn_agendar PASSA A GUARDAR QUEM TRAZ
-- ============================================================
drop function if exists public.forn_agendar(date, int, text, text);

create or replace function public.forn_agendar(
  p_data      date,
  p_hora      int,
  p_pedido    text default null,
  p_descricao text default null,
  p_transportadora_cnpj text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_forn uuid;
  v_id   uuid;
  v_tcnpj text;
  f      record;
begin
  v_forn := public.forn_meu_id();
  if v_forn is null then
    return jsonb_build_object('ok', false, 'erro', 'Seu cadastro ainda não foi liberado pela loja.');
  end if;

  select razao_social, cnpj, telefone, email into f
    from public.receb_fornecedores where id = v_forn;

  -- as mesmas regras de sempre: dia útil, dentro de 60 dias, 7h às 16h,
  -- e o dia contado no fuso de Caicó, não no de Greenwich
  if p_data is null or p_data < public.receb_hoje() or p_data > public.receb_hoje() + 60 then
    return jsonb_build_object('ok', false, 'erro', 'Escolha uma data entre hoje e os próximos 60 dias.');
  end if;
  if extract(isodow from p_data) > 5 then
    return jsonb_build_object('ok', false, 'erro', 'A loja recebe de segunda a sexta.');
  end if;
  if p_hora is null or p_hora < 7 or p_hora > 16 then
    return jsonb_build_object('ok', false, 'erro', 'Escolha um horário entre 7h e 16h.');
  end if;

  -- CNPJ de transportadora: ou vem certo, ou não vem. Guardar meio CNPJ é pior
  -- que não guardar nada — ninguém consegue conferir depois.
  v_tcnpj := nullif(regexp_replace(coalesce(p_transportadora_cnpj, ''), '[^0-9]', '', 'g'), '');
  if v_tcnpj is not null and length(v_tcnpj) <> 14 then
    return jsonb_build_object('ok', false, 'erro', 'O CNPJ da transportadora não está completo.');
  end if;

  -- alguém já pegou essa janela?
  if exists (
    select 1 from public.entregas_agendamento
     where tenant_id = public.current_tenant()
       and data = p_data and hora = make_time(p_hora, 0, 0)
       and status in ('pendente', 'aprovado', 'conferido')
  ) then
    return jsonb_build_object('ok', false, 'erro', 'Esse horário já está ocupado. Escolha outro.');
  end if;

  begin
    insert into public.entregas_agendamento
      (fornecedor, documento, contato, email, data, hora, pedido, descricao,
       status, origem, fornecedor_id, transportadora_cnpj)
    values
      (left(f.razao_social, 120), left(coalesce(f.cnpj, ''), 30), left(coalesce(f.telefone, ''), 40),
       lower(left(coalesce(f.email, ''), 160)), p_data, make_time(p_hora, 0, 0),
       left(trim(coalesce(p_pedido, '')), 40), left(trim(coalesce(p_descricao, '')), 300),
       'pendente', 'portal', v_forn, v_tcnpj)
    returning id into v_id;
  exception when unique_violation then
    -- duas pessoas pedindo a mesma janela no mesmo segundo
    return jsonb_build_object('ok', false, 'erro', 'Esse horário acabou de ser reservado. Escolha outro.');
  end;

  insert into public.receb_eventos (entidade, entidade_id, acao, para, detalhe)
  values ('entrega', v_forn, 'agendou', 'pendente',
          jsonb_build_object('data', p_data, 'hora', p_hora, 'pedido', p_pedido,
                             'transportadora', v_tcnpj));

  return jsonb_build_object('ok', true, 'id', v_id, 'data', p_data,
                            'hora', to_char(make_time(p_hora,0,0), 'HH24:MI'));
end;
$$;

revoke all on function public.forn_agendar(date,int,text,text,text) from public, anon;
grant execute on function public.forn_agendar(date,int,text,text,text) to authenticated;


-- ============================================================
-- 3) O ESPELHO LEVA O CNPJ PARA A ESTRUTURA NOVA
-- ============================================================
create or replace function public.receb_espelhar_antiga()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_local uuid; v_doca uuid; v_ini timestamptz; v_sit text; v_id uuid; v_ped text; v_tcnpj text;
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
    when 'pendente'  then 'solicitada'
    when 'aprovado'  then 'confirmada'
    when 'recusado'  then 'recusada'
    when 'conferido' then 'concluida'
    when 'cancelado' then 'cancelada'
    else 'solicitada' end;

  v_ini   := (new.data + new.hora) at time zone 'America/Fortaleza';
  v_ped   := nullif(trim(coalesce(new.pedido, '')), '');
  v_tcnpj := nullif(trim(coalesce(new.transportadora_cnpj, '')), '');

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
        transportadora_cnpj,
        solicitada_em, inicio_solicitado, minutos_estimados,
        confirmada_em, confirmada_por, janela, criado_em, origem, origem_id
      ) values (
        public.receb_novo_ticket(), 'entrega', v_local, v_doca, new.fornecedor_id,
        v_sit, 'sem_nota', nullif(trim(coalesce(new.descricao, '')), ''),
        v_tcnpj,
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
        transportadora_cnpj = coalesce(v_tcnpj, transportadora_cnpj),
        inicio_solicitado = v_ini,
        confirmada_em     = coalesce(confirmada_em,
                              case when new.status in ('aprovado','conferido')
                                   then new.atualizado_em end),
        confirmada_por    = coalesce(new.aprovado_por, confirmada_por),
        janela            = case when new.status in ('pendente','aprovado','conferido')
                                 then tstzrange(v_ini, v_ini + interval '60 minutes', '[)') end
      where id = v_id;
    end if;

    if v_ped is not null and v_id is not null then
      insert into public.receb_agenda_pedidos (agenda_id, numero)
      select v_id, v_ped
       where not exists (select 1 from public.receb_agenda_pedidos p
                          where p.agenda_id = v_id and p.numero = v_ped);
    end if;

    perform set_config('receb.espelho', '', true);

  exception when others then
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


-- ============================================================
-- 4) CONFERÊNCIA
-- ============================================================
select 'coluna na tabela antiga' as conferir,
       case when exists (select 1 from information_schema.columns
                          where table_name='entregas_agendamento'
                            and column_name='transportadora_cnpj')
            then 'SIM' else 'NAO' end as resultado
union all
select 'forn_agendar aceita o CNPJ (tem que ser 1 funcao so)',
       (select count(*)::text from pg_proc
         where proname='forn_agendar' and pronamespace='public'::regnamespace)
union all
select 'forn_agendar com 5 parametros',
       case when exists (select 1 from pg_proc
                          where proname='forn_agendar'
                            and pronamespace='public'::regnamespace
                            and pronargs=5)
            then 'SIM' else 'NAO' end
union all
select 'espelho leva o CNPJ',
       case when exists (select 1 from pg_proc
                          where proname='receb_espelhar_antiga'
                            and prosrc like '%transportadora_cnpj%')
            then 'SIM' else 'NAO' end
union all
select 'agendamentos continuam intactos',
       (select count(*)::text from public.entregas_agendamento) || ' antigos, ' ||
       (select count(*)::text from public.receb_agendas) || ' novos';
