-- ============================================================================
-- CHECKPOINT 9 — a entrega passa a ter DURAÇÃO, e a carga ganha os dados
--
-- A MUDANÇA MAIS SÉRIA ATÉ AQUI. Leia antes de rodar.
--
-- COMO ERA: cada agendamento ocupava exatamente 1 hora. A tabela antiga tem
-- uma linha por (data, hora), com índice único — o horário ou está livre ou
-- não está, e a conta é uma igualdade simples.
--
-- COMO FICA: o fornecedor diz quanto tempo leva a descarga (30 min a 4 horas).
-- Uma carreta de 3 horas passa a ocupar as 3 horas. A conta de "está livre?"
-- deixa de ser igualdade e vira SOBREPOSIÇÃO — dois períodos brigam se um
-- começa antes do outro terminar.
--
-- POR QUE NÃO CRIEI VÁRIAS LINHAS: seria o caminho fácil, mas o painel da loja
-- passaria a mostrar o mesmo caminhão três vezes, e cancelar um pedaço deixaria
-- o resto órfão. Uma entrega é uma linha. O que muda é ela ter tamanho.
--
-- O QUE PROTEGE DE ERRO:
--   · o índice único de (data, hora) continua: ninguém começa no mesmo minuto
--   · a trava de sobreposição da estrutura nova (receb_agenda_sem_conflito)
--     passa a valer de verdade, porque agora as janelas têm tamanhos diferentes
--   · a função recusa entrega que termina depois de a loja fechar
--
-- COMPATIBILIDADE: quem já está agendado fica com 60 minutos, que é o que
-- valia. Nada muda para os 6 agendamentos que existem.
--
-- Rodar depois de receb_c8_local.sql. Pode rodar de novo sem estragar nada.
-- ============================================================================


-- ============================================================
-- 1) A ENTREGA GANHA TAMANHO
-- ============================================================
alter table public.entregas_agendamento
  add column if not exists minutos int not null default 60;

comment on column public.entregas_agendamento.minutos is
  'Quanto tempo a descarga ocupa a doca. 60 era o valor fixo antigo — quem já estava agendado continua com ele.';

-- e os dados de quem chega e do que vem
alter table public.entregas_agendamento
  add column if not exists tipo_carga     text,
  add column if not exists tipo_volume    text,
  add column if not exists qtd_volumes    int,
  add column if not exists tipo_veiculo   text,
  add column if not exists placa          text,
  add column if not exists motorista      text,
  add column if not exists motorista_fone text;


-- ============================================================
-- 2) O ESPELHO LEVA A DURAÇÃO E A CARGA
-- ============================================================
create or replace function public.receb_espelhar_antiga()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_local uuid; v_doca uuid; v_ini timestamptz; v_sit text; v_id uuid;
  v_ped text; v_tcnpj text; v_min int;
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
  v_min   := greatest(coalesce(new.minutos, 60), 15);
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
        transportadora_cnpj, tipo_carga, tipo_volume, qtd_volumes,
        tipo_veiculo, placa, motorista, motorista_fone,
        solicitada_em, inicio_solicitado, minutos_estimados,
        confirmada_em, confirmada_por, janela, criado_em, origem, origem_id
      ) values (
        public.receb_novo_ticket(), 'entrega', v_local, v_doca, new.fornecedor_id,
        v_sit, 'sem_nota', nullif(trim(coalesce(new.descricao, '')), ''),
        v_tcnpj, new.tipo_carga, new.tipo_volume, new.qtd_volumes,
        new.tipo_veiculo, new.placa, new.motorista, new.motorista_fone,
        new.criado_em, v_ini, v_min,
        case when new.status in ('aprovado','conferido') then new.atualizado_em end,
        new.aprovado_por,
        case when new.status in ('pendente','aprovado','conferido')
             then tstzrange(v_ini, v_ini + make_interval(mins => v_min), '[)') end,
        new.criado_em, 'entregas_agendamento', new.id
      ) returning id into v_id;
    else
      update public.receb_agendas set
        situacao          = v_sit,
        fornecedor_id     = coalesce(new.fornecedor_id, fornecedor_id),
        descricao         = coalesce(nullif(trim(coalesce(new.descricao, '')), ''), descricao),
        transportadora_cnpj = coalesce(v_tcnpj, transportadora_cnpj),
        tipo_carga        = coalesce(new.tipo_carga, tipo_carga),
        tipo_volume       = coalesce(new.tipo_volume, tipo_volume),
        qtd_volumes       = coalesce(new.qtd_volumes, qtd_volumes),
        tipo_veiculo      = coalesce(new.tipo_veiculo, tipo_veiculo),
        placa             = coalesce(new.placa, placa),
        motorista         = coalesce(new.motorista, motorista),
        motorista_fone    = coalesce(new.motorista_fone, motorista_fone),
        inicio_solicitado = v_ini,
        minutos_estimados = v_min,
        confirmada_em     = coalesce(confirmada_em,
                              case when new.status in ('aprovado','conferido')
                                   then new.atualizado_em end),
        confirmada_por    = coalesce(new.aprovado_por, confirmada_por),
        janela            = case when new.status in ('pendente','aprovado','conferido')
                                 then tstzrange(v_ini, v_ini + make_interval(mins => v_min), '[)') end
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
-- 3) "ESTÁ LIVRE?" DEIXA DE SER IGUALDADE E VIRA SOBREPOSIÇÃO
--
-- Dois períodos brigam quando um começa antes de o outro terminar.
-- Esta função é a única fonte dessa conta — quem precisar, chama.
-- ============================================================
create or replace function public.receb_choca(
  p_data date, p_ini_min int, p_minutos int, p_ignorar uuid default null
) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.entregas_agendamento e
     where e.tenant_id = public.current_tenant()
       and e.data = p_data
       and e.status in ('pendente', 'aprovado', 'conferido')
       and (p_ignorar is null or e.id <> p_ignorar)
       -- começa antes do outro terminar E o outro começa antes deste terminar
       and (extract(hour from e.hora)*60 + extract(minute from e.hora))
             < (p_ini_min + p_minutos)
       and p_ini_min
             < (extract(hour from e.hora)*60 + extract(minute from e.hora)
                + coalesce(e.minutos, 60))
  );
$$;


-- ============================================================
-- 4) OS HORÁRIOS LIVRES, AGORA CONSIDERANDO A DURAÇÃO
--
-- Uma descarga de 3 horas às 15h terminaria às 18h, depois de a loja fechar.
-- Antes isso passava, porque ninguém perguntava quanto tempo levava.
-- ============================================================
drop function if exists public.forn_horarios_livres(date);

create or replace function public.forn_horarios_livres(p_data date, p_minutos int default 60)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  l record; v_min int; v_abre int; v_fecha int; v_agora int; v_hoje date;
begin
  if public.forn_meu_id() is null then return '[]'::jsonb; end if;

  v_hoje := public.receb_hoje();
  if p_data is null or p_data < v_hoje or p_data > v_hoje + 60 then return '[]'::jsonb; end if;

  select abre, fecha, dias_semana into l from public.receb_locais order by criado_em limit 1;
  if not (extract(isodow from p_data)::int = any(coalesce(l.dias_semana, '{1,2,3,4,5}'))) then
    return '[]'::jsonb;
  end if;

  v_min   := least(greatest(coalesce(p_minutos, 60), 15), 480);
  v_abre  := extract(hour from l.abre)::int * 60 + extract(minute from l.abre)::int;
  v_fecha := extract(hour from l.fecha)::int * 60 + extract(minute from l.fecha)::int;
  v_agora := case when p_data > v_hoje then -1
                  else extract(hour from (now() at time zone 'America/Fortaleza'))::int * 60
                     + extract(minute from (now() at time zone 'America/Fortaleza'))::int end;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'h',    (m / 60),
             'hora', lpad((m / 60)::text, 2, '0') || ':' || lpad((m % 60)::text, 2, '0'),
             'ate',  lpad(((m + v_min) / 60)::text, 2, '0') || ':' || lpad(((m + v_min) % 60)::text, 2, '0'),
             -- cabe no expediente, ainda não passou, e não briga com ninguém
             'livre', (m + v_min) <= v_fecha
                  and m > v_agora
                  and not public.receb_choca(p_data, m, v_min)
           ) order by m)
      from generate_series(v_abre, greatest(v_abre, v_fecha - 60), 60) as m
  ), '[]'::jsonb);
end;
$$;


-- ============================================================
-- 5) AGENDAR COM DURAÇÃO, VEÍCULO E CARGA
--
-- p_carga é assim:
--   {"tipo_carga":"Seca","tipo_volume":"Paletizada","qtd_volumes":8,
--    "tipo_veiculo":"Truck","placa":"QGX1D23","motorista":"Jose",
--    "motorista_fone":"84999999999"}
-- ============================================================
drop function if exists public.forn_agendar(date, int, text, text, text, jsonb);

create or replace function public.forn_agendar(
  p_data      date,
  p_hora      int,
  p_pedido    text default null,
  p_descricao text default null,
  p_transportadora_cnpj text default null,
  p_notas     jsonb default null,
  p_minutos   int   default 60,
  p_carga     jsonb default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_forn uuid; v_id uuid; v_ag uuid; v_tcnpj text; v_chave text;
  f record; l record; n jsonb; v_xml text;
  v_vol numeric := 0; v_peso numeric := 0; v_esp text;
  v_min int; v_ini int; v_fecha int;
begin
  v_forn := public.forn_meu_id();
  if v_forn is null then
    return jsonb_build_object('ok', false, 'erro', 'Seu cadastro ainda não foi liberado pela loja.');
  end if;

  select razao_social, cnpj, telefone, email into f
    from public.receb_fornecedores where id = v_forn;

  select id, cnpj, nf_bloqueia_repetida, nf_exige_emitente_fornecedor, abre, fecha, dias_semana
    into l from public.receb_locais order by criado_em limit 1;

  if p_data is null or p_data < public.receb_hoje() or p_data > public.receb_hoje() + 60 then
    return jsonb_build_object('ok', false, 'erro', 'Escolha uma data entre hoje e os próximos 60 dias.');
  end if;
  if not (extract(isodow from p_data)::int = any(coalesce(l.dias_semana, '{1,2,3,4,5}'))) then
    return jsonb_build_object('ok', false, 'erro', 'A loja não recebe nesse dia da semana.');
  end if;

  v_min   := least(greatest(coalesce(p_minutos, 60), 15), 480);
  v_ini   := coalesce(p_hora, -1) * 60;
  v_fecha := extract(hour from l.fecha)::int * 60 + extract(minute from l.fecha)::int;

  if p_hora is null
     or v_ini < extract(hour from l.abre)::int * 60 + extract(minute from l.abre)::int then
    return jsonb_build_object('ok', false, 'erro', 'Esse horário está fora do expediente da loja.');
  end if;
  if v_ini + v_min > v_fecha then
    return jsonb_build_object('ok', false, 'erro',
      'Uma descarga de ' || v_min || ' minutos começando nesse horário terminaria depois de a loja fechar.');
  end if;

  v_tcnpj := nullif(regexp_replace(coalesce(p_transportadora_cnpj, ''), '[^0-9]', '', 'g'), '');
  if v_tcnpj is not null and length(v_tcnpj) <> 14 then
    return jsonb_build_object('ok', false, 'erro', 'O CNPJ da transportadora não está completo.');
  end if;

  if p_notas is not null and jsonb_typeof(p_notas) = 'array' then
    if jsonb_array_length(p_notas) > 30 then
      return jsonb_build_object('ok', false, 'erro', 'São muitas notas para um agendamento só.');
    end if;

    for n in select * from jsonb_array_elements(p_notas) loop
      v_chave := regexp_replace(coalesce(n->>'chave',''), '[^0-9]', '', 'g');
      v_xml   := coalesce(n->>'xml','');

      if not public.receb_nfe_chave_ok(v_chave) then
        return jsonb_build_object('ok', false, 'erro',
          'A chave ' || coalesce(nullif(left(v_chave,10),''),'(vazia)') || '… não confere.');
      end if;

      if length(v_xml) > 0 then
        if length(v_xml) > 3000000 then
          return jsonb_build_object('ok', false, 'erro', 'Um dos arquivos é grande demais para ser uma nota fiscal.');
        end if;
        if position('infNFe' in v_xml) = 0 then
          return jsonb_build_object('ok', false, 'erro', 'Um dos arquivos não é XML de nota fiscal eletrônica.');
        end if;
        if position(v_chave in regexp_replace(v_xml, '[^0-9]', '', 'g')) = 0 then
          return jsonb_build_object('ok', false, 'erro',
            'A chave informada não aparece dentro do arquivo enviado.');
        end if;
        if l.cnpj is not null and length(regexp_replace(l.cnpj,'[^0-9]','','g')) = 14
           and position(regexp_replace(l.cnpj,'[^0-9]','','g')
                        in regexp_replace(v_xml, '[^0-9]', '', 'g')) = 0 then
          return jsonb_build_object('ok', false, 'erro',
            'Essa nota não foi emitida para o Supermercado Santa Rita.');
        end if;
      end if;

      if coalesce(l.nf_exige_emitente_fornecedor, false)
         and nullif(regexp_replace(coalesce(n->>'emitente_cnpj',''),'[^0-9]','','g'),'') is distinct from
             nullif(regexp_replace(coalesce(f.cnpj,''),'[^0-9]','','g'),'') then
        return jsonb_build_object('ok', false, 'erro',
          'Esta nota foi emitida por outro CNPJ. A loja só aceita nota do próprio fornecedor.');
      end if;

      if coalesce(l.nf_bloqueia_repetida, true) and exists (
        select 1 from public.receb_agenda_notas nn
          join public.receb_agendas aa on aa.id = nn.agenda_id
         where nn.tenant_id = public.current_tenant()
           and nn.chave = v_chave
           and aa.situacao not in ('cancelada','recusada')
      ) then
        return jsonb_build_object('ok', false, 'erro',
          'A nota ' || coalesce(n->>'numero','') || ' já está em outro agendamento.');
      end if;

      v_vol  := v_vol  + coalesce((n->>'volumes')::numeric, 0);
      v_peso := v_peso + coalesce((n->>'peso_bruto')::numeric, 0);
      if v_esp is null then v_esp := nullif(n->>'especie',''); end if;
    end loop;
  end if;

  -- a conta que mudou: sobreposição, não igualdade
  if public.receb_choca(p_data, v_ini, v_min) then
    return jsonb_build_object('ok', false, 'erro',
      'Esse período já está ocupado por outra entrega. Escolha outro horário.');
  end if;

  begin
    insert into public.entregas_agendamento
      (fornecedor, documento, contato, email, data, hora, pedido, descricao,
       status, origem, fornecedor_id, transportadora_cnpj, minutos,
       tipo_carga, tipo_volume, qtd_volumes, tipo_veiculo, placa, motorista, motorista_fone)
    values
      (left(f.razao_social, 120), left(coalesce(f.cnpj, ''), 30), left(coalesce(f.telefone, ''), 40),
       lower(left(coalesce(f.email, ''), 160)), p_data, make_time(p_hora, 0, 0),
       left(trim(coalesce(p_pedido, '')), 40), left(trim(coalesce(p_descricao, '')), 300),
       'pendente', 'portal', v_forn, v_tcnpj, v_min,
       nullif(p_carga->>'tipo_carga',''), nullif(p_carga->>'tipo_volume',''),
       nullif(p_carga->>'qtd_volumes','')::int,
       nullif(p_carga->>'tipo_veiculo',''), upper(nullif(p_carga->>'placa','')),
       nullif(p_carga->>'motorista',''), nullif(p_carga->>'motorista_fone',''))
    returning id into v_id;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'erro', 'Esse horário acabou de ser reservado. Escolha outro.');
  end;

  select id into v_ag from public.receb_agendas
   where origem = 'entregas_agendamento' and origem_id = v_id;

  if v_ag is not null and p_notas is not null and jsonb_typeof(p_notas) = 'array' then
    for n in select * from jsonb_array_elements(p_notas) loop
      insert into public.receb_agenda_notas
        (agenda_id, chave, numero, serie, emitente_cnpj, emitente_nome, destin_cnpj,
         emissao, valor_total, xml, itens, volumes, especie, peso_bruto, peso_liquido,
         transportadora_nome, transportadora_cnpj, situacao)
      values (v_ag,
        regexp_replace(coalesce(n->>'chave',''), '[^0-9]', '', 'g'),
        nullif(n->>'numero',''), nullif(n->>'serie',''),
        nullif(regexp_replace(coalesce(n->>'emitente_cnpj',''),'[^0-9]','','g'),''),
        nullif(n->>'emitente_nome',''),
        nullif(regexp_replace(coalesce(n->>'destino_cnpj',''),'[^0-9]','','g'),''),
        nullif(n->>'emissao','')::date,
        nullif(regexp_replace(coalesce(n->>'valor',''),'[^0-9.]','','g'),'')::numeric,
        nullif(n->>'xml',''),
        case when jsonb_typeof(n->'itens') = 'array' then n->'itens' end,
        nullif(n->>'volumes','')::numeric,
        nullif(n->>'especie',''),
        nullif(n->>'peso_bruto','')::numeric,
        nullif(n->>'peso_liquido','')::numeric,
        nullif(n->>'transportadora_nome',''),
        nullif(regexp_replace(coalesce(n->>'transportadora_cnpj',''),'[^0-9]','','g'),''),
        case when nullif(n->>'xml','') is null then 'registrada' else 'lida' end);
    end loop;

    -- a nota só preenche o que o fornecedor não informou
    if v_vol > 0 or v_peso > 0 then
      update public.receb_agendas
         set qtd_volumes = coalesce(qtd_volumes, case when v_vol > 0 then round(v_vol)::int end),
             peso_kg     = coalesce(peso_kg, case when v_peso > 0 then v_peso end),
             tipo_volume = coalesce(tipo_volume, v_esp)
       where id = v_ag;
    end if;
  end if;

  insert into public.receb_eventos (entidade, entidade_id, acao, para, detalhe)
  values ('entrega', v_forn, 'agendou', 'pendente',
          jsonb_build_object('data', p_data, 'hora', p_hora, 'minutos', v_min,
                             'pedido', p_pedido, 'transportadora', v_tcnpj,
                             'notas', case when p_notas is null then 0
                                           else jsonb_array_length(p_notas) end));

  return jsonb_build_object('ok', true, 'id', v_id, 'data', p_data, 'minutos', v_min,
                            'hora', to_char(make_time(p_hora,0,0), 'HH24:MI'));
end;
$$;

revoke all on function public.forn_agendar(date,int,text,text,text,jsonb,int,jsonb) from public, anon;
revoke all on function public.forn_horarios_livres(date,int) from public, anon;
revoke all on function public.receb_choca(date,int,int,uuid)  from public, anon;
grant execute on function public.forn_agendar(date,int,text,text,text,jsonb,int,jsonb) to authenticated;
grant execute on function public.forn_horarios_livres(date,int) to authenticated;
grant execute on function public.receb_choca(date,int,int,uuid)  to authenticated;


-- ============================================================
-- 6) CONFERÊNCIA
-- ============================================================
select 'coluna de duracao' as conferir,
       case when exists (select 1 from information_schema.columns
                          where table_name='entregas_agendamento' and column_name='minutos')
            then 'SIM' else 'NAO' end as resultado
union all
select 'colunas de veiculo e carga (tem que ser 7)',
       (select count(*)::text from information_schema.columns
         where table_name='entregas_agendamento'
           and column_name in ('tipo_carga','tipo_volume','qtd_volumes',
                               'tipo_veiculo','placa','motorista','motorista_fone'))
union all
select 'quem ja estava agendado ficou com 60 min',
       case when exists (select 1 from public.entregas_agendamento where minutos <> 60)
            then 'ALGUEM MUDOU' else 'SIM, todos com 60' end
union all
select 'a conta de sobreposicao existe',
       case when exists (select 1 from pg_proc where proname='receb_choca') then 'SIM' else 'NAO' end
union all
select 'forn_agendar com 8 parametros (1 funcao so)',
       (select count(*)::text from pg_proc
         where proname='forn_agendar' and pronamespace='public'::regnamespace)
union all
select 'forn_horarios_livres com duracao',
       (select count(*)::text from pg_proc
         where proname='forn_horarios_livres' and pronamespace='public'::regnamespace)
union all
select 'agendamentos intactos',
       (select count(*)::text from public.entregas_agendamento) || ' antigos, ' ||
       (select count(*)::text from public.receb_agendas) || ' novos';
