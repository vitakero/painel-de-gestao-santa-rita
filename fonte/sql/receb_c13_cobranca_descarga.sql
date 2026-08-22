-- ============================================================
-- C13 — COBRANÇA DE DESCARGA (etapa 5 do Portal do Fornecedor)
--
-- A loja pode cobrar do fornecedor para descarregar o caminhão. A etapa 5
-- mostra a PREVISÃO desse valor antes de o agendamento ser enviado, e o
-- fornecedor precisa marcar que está ciente.
--
-- NASCE DESLIGADO. Enquanto cobranca_ativa for false — que é o padrão — nada
-- muda: a etapa 5 continua pulada e nenhum agendamento ganha valor nenhum.
-- Ligar é trocar UMA célula no Table Editor do Supabase.
--
-- COMO O PREÇO É MEXIDO, DEPOIS: as três células ficam na MESMA linha de
-- public.receb_locais onde já moram o horário de abrir e de fechar. Trocar
-- R$ 3,00 por R$ 3,50 é abrir a tabela, clicar na célula e digitar. Sem SQL,
-- sem publicar página, sem depender de mim. Foi por isso que este desenho
-- ganhou dos outros dois.
--
-- A CONTA, DE PROPÓSITO NUM LUGAR SÓ (public.receb_cobranca_calcular): a
-- mesma função responde à tela e à gravação. Este projeto já aprendeu isso
-- duas vezes — receb_choca virou fonte única de "está livre?", e o c12
-- precisou criar receb_primeira_hora porque a grade do calendário e a do
-- agendamento tinham divergido. Duas contas de dinheiro discordando é pior.
--
-- O QUE FICA GUARDADO: além do total, um retrato congelado (coluna cobranca,
-- jsonb) com as linhas exatamente como apareceram na tela, os preços que
-- valiam NAQUELE dia, o aviso que estava escrito, de onde veio o peso, e
-- quem marcou "estou ciente" e quando. Subir o preço em outubro não pode
-- reescrever o que o fornecedor aceitou em agosto.
--
-- DECISÕES DO DONO (16/08/2026), que estão implementadas aqui:
--   · entrega cancelada ou recusada NÃO conta para nenhuma soma
--   · só o master pode perdoar a cobrança de uma entrega
--   · o valor previsto entra no e-mail que o fornecedor recebe
--   · peso: vale o declarado, salvo quando estiver mais de 20% ABAIXO do
--     peso bruto das notas — aí vale o das notas. ESTE NÚMERO É PROVISÓRIO:
--     ele vai conferir como outros supermercados fazem antes de cravar.
--     Trocar é mudar o 0.8 num lugar só (dentro do forn_agendar).
--
-- Pode rodar mais de uma vez sem estragar nada.
-- ============================================================


-- ============================================================
-- 1) AS COLUNAS
-- ============================================================
alter table public.receb_locais
  add column if not exists cobranca_ativa          boolean not null default false,
  add column if not exists cobranca_valor_agenda   numeric(12,4) not null default 0,
  add column if not exists cobranca_valor_tonelada numeric(12,4) not null default 0,
  add column if not exists cobranca_aviso          text;

comment on column public.receb_locais.cobranca_ativa is
  'Liga a etapa 5 do portal. Desligado = fornecedor não vê cobrança nenhuma.';
comment on column public.receb_locais.cobranca_valor_agenda is
  'Valor fixo por agendamento. 4 casas: hoje R$5,00; um dia pode ser fração.';
comment on column public.receb_locais.cobranca_valor_tonelada is
  'Valor por TONELADA de carga. 84.387 kg = 84,387 t.';

update public.receb_locais
   set cobranca_aviso = 'Este é apenas um informativo. No momento da entrega o valor acima previsto poderá ser cobrado.'
 where cobranca_aviso is null;

-- onde a escrita de verdade acontece
alter table public.entregas_agendamento
  add column if not exists peso_kg        numeric(12,3),
  add column if not exists cobranca_total numeric(12,2),
  add column if not exists cobranca       jsonb;

comment on column public.entregas_agendamento.cobranca is
  'Retrato congelado do que apareceu na tela: linhas, preços usados, aviso, peso e ciência.';

-- e o espelho, para as telas lerem de lá
alter table public.receb_agendas
  add column if not exists cobranca_total numeric(12,2),
  add column if not exists cobranca       jsonb;


-- ============================================================
-- 2) A CONTA — UM LUGAR SÓ
--
-- Arredonda POR LINHA e só então soma. Não é capricho: 84,387 t x R$3,00 dá
-- R$253,161; arredondando a linha vira R$253,16 e o total R$258,16.
-- Arredondando só no fim, dá R$258,17 em outros casos. Mudar isso depois é
-- mexer num número que alguém já aceitou — então fica cravado agora.
-- ============================================================
create or replace function public.receb_cobranca_calcular(
  p_local_id uuid, p_peso_kg numeric
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  l record; v_itens jsonb := '[]'::jsonb; v_total numeric := 0;
  v_ton numeric; v_lin numeric;
begin
  select cobranca_ativa, cobranca_valor_agenda, cobranca_valor_tonelada, cobranca_aviso
    into l from public.receb_locais where id = p_local_id;

  if not found or not coalesce(l.cobranca_ativa, false) then
    return jsonb_build_object('ok', true, 'ativa', false, 'total', 0, 'itens', '[]'::jsonb);
  end if;

  if coalesce(l.cobranca_valor_agenda, 0) > 0 then
    v_lin   := round(l.cobranca_valor_agenda, 2);
    v_total := v_total + v_lin;
    v_itens := v_itens || jsonb_build_object(
                 'chave','agenda', 'descricao','Agenda', 'unidade','',
                 'valor_unitario', round(l.cobranca_valor_agenda, 2),
                 'quantidade', 1, 'valor', v_lin);
  end if;

  v_ton := round(coalesce(p_peso_kg, 0) / 1000.0, 3);
  if coalesce(l.cobranca_valor_tonelada, 0) > 0 and v_ton > 0 then
    v_lin   := round(v_ton * l.cobranca_valor_tonelada, 2);
    v_total := v_total + v_lin;
    v_itens := v_itens || jsonb_build_object(
                 'chave','peso', 'descricao','Peso', 'unidade','t',
                 'valor_unitario', round(l.cobranca_valor_tonelada, 2),
                 'quantidade', v_ton, 'valor', v_lin);
  end if;

  return jsonb_build_object('ok', true, 'ativa', true,
                            'total', round(v_total, 2), 'itens', v_itens,
                            'aviso', l.cobranca_aviso);
end;
$$;


-- ============================================================
-- 3) A PORTA DO PORTAL
--
-- A tela NÃO multiplica nada: pede o número pronto e imprime. Assim tela e
-- gravação não têm como discordar em um centavo — que é exatamente a
-- diferença que transforma conversa em discussão.
-- ============================================================
create or replace function public.forn_cobranca_previa(p_peso_kg numeric default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_local uuid;
begin
  if public.forn_meu_id() is null then
    return jsonb_build_object('ok', false, 'ativa', false);
  end if;
  select id into v_local from public.receb_locais order by criado_em limit 1;
  return public.receb_cobranca_calcular(v_local, p_peso_kg);
end;
$$;


-- ============================================================
-- 4) O AGENDAMENTO
-- (a mesma função de hoje; só ganhou o pedaço da cobrança por dentro,
--  e a ASSINATURA continua igual — nada de drop, que deixaria o portal
--  cego entre um comando e outro)
-- ============================================================
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
  v_chaves text[] := '{}';
  -- cobrança de descarga
  v_peso_declarado numeric; v_peso_notas numeric; v_peso_vale numeric;
  v_peso_origem text; v_cob jsonb; v_total numeric := 0; v_ciente boolean;
begin
  v_forn := public.forn_meu_id();
  if v_forn is null then
    return jsonb_build_object('ok', false, 'erro', 'Seu cadastro ainda não foi liberado pela loja.');
  end if;

  select razao_social, cnpj, telefone, email into f
    from public.receb_fornecedores where id = v_forn;

  select id, cnpj, nf_bloqueia_repetida, nf_exige_emitente_fornecedor, abre, fecha, dias_semana,
         cobranca_ativa, cobranca_valor_agenda, cobranca_valor_tonelada, cobranca_aviso
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

      -- a MESMA chave duas vezes no mesmo envio dobrava volume e peso
      if v_chave = any(v_chaves) then
        return jsonb_build_object('ok', false, 'erro',
          'A nota ' || coalesce(n->>'numero','') || ' aparece duas vezes neste agendamento.');
      end if;
      v_chaves := v_chaves || v_chave;

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

      -- número que vem como texto derrubava a chamada com erro cru do Postgres
      v_vol  := v_vol  + coalesce(nullif(regexp_replace(coalesce(n->>'volumes',''),'[^0-9.]','','g'),'')::numeric, 0);
      v_peso := v_peso + coalesce(nullif(regexp_replace(coalesce(n->>'peso_bruto',''),'[^0-9.]','','g'),'')::numeric, 0);
      if v_esp is null then v_esp := nullif(n->>'especie',''); end if;
    end loop;
  end if;

  -- ============================================================
  -- COBRANÇA DE DESCARGA
  --
  -- Qual peso vale: o declarado manda, MENOS quando ele está muito abaixo
  -- do que as próprias notas do fornecedor dizem. Sem essa regra, quem
  -- manda XML paga certo e quem só digita a chave paga o que quiser — e em
  -- uma semana todo fornecedor aprende o caminho. O declarado continua
  -- guardado do mesmo jeito: nada é sobrescrito, só não é o que cobra.
  -- ============================================================
  v_peso_declarado := nullif(regexp_replace(coalesce(p_carga->>'peso_kg',''),'[^0-9.]','','g'),'')::numeric;
  v_peso_notas     := nullif(v_peso, 0);

  if v_peso_declarado is null then
    v_peso_vale := v_peso_notas; v_peso_origem := case when v_peso_notas is null then 'sem_peso' else 'nota' end;
  elsif v_peso_notas is not null and v_peso_declarado < v_peso_notas * 0.8 then
    -- mais de 20% abaixo do que as notas declaram
    v_peso_vale := v_peso_notas; v_peso_origem := 'nota_corrigiu';
  else
    v_peso_vale := v_peso_declarado; v_peso_origem := 'digitado';
  end if;

  v_cob   := public.receb_cobranca_calcular(l.id, v_peso_vale);
  v_total := coalesce((v_cob->>'total')::numeric, 0);
  v_ciente := coalesce((p_carga->>'cobranca_ciente')::boolean, false);

  -- A ciência é conferida NO SERVIDOR. Caixinha marcada no navegador é
  -- cortesia; quem não pode passar sem ela é esta linha.
  if coalesce((v_cob->>'ativa')::boolean, false) and v_total > 0 and not v_ciente then
    return jsonb_build_object('ok', false, 'erro',
      'Marque que você está ciente da cobrança de descarga para continuar.');
  end if;

  v_cob := v_cob || jsonb_build_object(
             'peso_kg', v_peso_vale, 'peso_declarado', v_peso_declarado,
             'peso_notas', v_peso_notas, 'peso_origem', v_peso_origem,
             'ciente', v_ciente, 'ciente_em', case when v_ciente then now() end,
             'ciente_por', case when v_ciente then auth.uid() end);

  if public.receb_choca(p_data, v_ini, v_min) then
    return jsonb_build_object('ok', false, 'erro',
      'Esse período já está ocupado por outra entrega. Escolha outro horário.');
  end if;

  begin
    insert into public.entregas_agendamento
      (fornecedor, documento, contato, email, data, hora, pedido, descricao,
       status, origem, fornecedor_id, transportadora_cnpj, minutos,
       tipo_carga, tipo_volume, qtd_volumes, tipo_veiculo, placa, motorista, motorista_fone,
       peso_kg, cobranca_total, cobranca)
    values
      (left(f.razao_social, 120), left(coalesce(f.cnpj, ''), 30), left(coalesce(f.telefone, ''), 40),
       lower(left(coalesce(f.email, ''), 160)), p_data, make_time(p_hora, 0, 0),
       left(trim(coalesce(p_pedido, '')), 40), left(trim(coalesce(p_descricao, '')), 300),
       'pendente', 'portal', v_forn, v_tcnpj, v_min,
       left(nullif(p_carga->>'tipo_carga',''), 40), left(nullif(p_carga->>'tipo_volume',''), 40),
       nullif(regexp_replace(coalesce(p_carga->>'qtd_volumes',''),'[^0-9]','','g'),'')::int,
       left(nullif(p_carga->>'tipo_veiculo',''), 40), left(upper(nullif(p_carga->>'placa','')), 10),
       left(nullif(p_carga->>'motorista',''), 80), left(nullif(p_carga->>'motorista_fone',''), 30),
       v_peso_vale,
       case when coalesce((v_cob->>'ativa')::boolean, false) then v_total end,
       case when coalesce((v_cob->>'ativa')::boolean, false) then v_cob end)
    returning id into v_id;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'erro', 'Esse horário acabou de ser reservado. Escolha outro.');
  end;

  select id into v_ag from public.receb_agendas
   where origem = 'entregas_agendamento' and origem_id = v_id;

  -- Se o espelho falhou, a nota não teria onde morar e o portal responderia
  -- "ok" com a nota jogada fora. Melhor não agendar do que agendar mentindo.
  if v_ag is null and p_notas is not null and jsonb_array_length(p_notas) > 0 then
    raise exception 'A agenda não foi criada na estrutura nova; as notas fiscais não teriam onde ficar.'
      using errcode = 'internal_error';
  end if;

  if v_ag is not null and p_notas is not null and jsonb_typeof(p_notas) = 'array' then
    for n in select * from jsonb_array_elements(p_notas) loop
      insert into public.receb_agenda_notas
        (agenda_id, chave, numero, serie, emitente_cnpj, emitente_nome, destin_cnpj,
         emissao, valor_total, xml, itens, volumes, especie, peso_bruto, peso_liquido,
         transportadora_nome, transportadora_cnpj, situacao)
      values (v_ag,
        regexp_replace(coalesce(n->>'chave',''), '[^0-9]', '', 'g'),
        left(nullif(n->>'numero',''), 20), left(nullif(n->>'serie',''), 10),
        -- quando a nota vem só pela chave, o CNPJ de quem emitiu está DENTRO
        -- dela (posições 7 a 20). Antes isso ia nulo e a trava de emitente
        -- ficava impossível de ligar.
        coalesce(nullif(regexp_replace(coalesce(n->>'emitente_cnpj',''),'[^0-9]','','g'),''),
                 substr(regexp_replace(coalesce(n->>'chave',''), '[^0-9]', '', 'g'), 7, 14)),
        left(nullif(n->>'emitente_nome',''), 140),
        nullif(regexp_replace(coalesce(n->>'destino_cnpj',''),'[^0-9]','','g'),''),
        nullif(n->>'emissao','')::date,
        nullif(regexp_replace(coalesce(n->>'valor',''),'[^0-9.]','','g'),'')::numeric,
        nullif(n->>'xml',''),
        case when jsonb_typeof(n->'itens') = 'array' then n->'itens' end,
        nullif(regexp_replace(coalesce(n->>'volumes',''),'[^0-9.]','','g'),'')::numeric,
        left(nullif(n->>'especie',''), 40),
        nullif(regexp_replace(coalesce(n->>'peso_bruto',''),'[^0-9.]','','g'),'')::numeric,
        nullif(regexp_replace(coalesce(n->>'peso_liquido',''),'[^0-9.]','','g'),'')::numeric,
        left(nullif(n->>'transportadora_nome',''), 140),
        nullif(regexp_replace(coalesce(n->>'transportadora_cnpj',''),'[^0-9]','','g'),''),
        case when nullif(n->>'xml','') is null then 'registrada' else 'lida' end);
    end loop;

    -- a agenda deixa de dizer "sem nota" quando tem nota
    update public.receb_agendas
       set sit_doc = case when exists (select 1 from public.receb_agenda_notas nn
                                        where nn.agenda_id = v_ag and nn.xml is not null)
                          then 'validado' else 'lendo' end,
           qtd_volumes = coalesce(qtd_volumes, case when v_vol > 0 then round(v_vol)::int end),
           -- o peso que vale já foi decidido antes do insert (regra dos 20%);
           -- aqui só preenche se ninguém tiver decidido nada
           peso_kg     = coalesce(peso_kg, v_peso_vale, case when v_peso > 0 then v_peso end),
           tipo_volume = coalesce(tipo_volume, left(v_esp, 40))
     where id = v_ag;
  end if;

  insert into public.receb_eventos (entidade, entidade_id, acao, para, detalhe)
  values ('entrega', v_forn, 'agendou', 'pendente',
          jsonb_build_object('data', p_data, 'hora', p_hora, 'minutos', v_min,
                             'pedido', p_pedido, 'transportadora', v_tcnpj,
                             'notas', case when p_notas is null then 0
                                           else jsonb_array_length(p_notas) end,
                             'cobranca', case when coalesce((v_cob->>'ativa')::boolean,false)
                                              then v_total end));

  return jsonb_build_object('ok', true, 'id', v_id, 'data', p_data, 'minutos', v_min,
                            'hora', to_char(make_time(p_hora,0,0), 'HH24:MI'),
                            'cobranca', case when coalesce((v_cob->>'ativa')::boolean,false)
                                             then v_cob end);
end;
$$;


-- ============================================================
-- 5) O ESPELHO copia o que é novo
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
        peso_kg, cobranca_total, cobranca,
        solicitada_em, inicio_solicitado, minutos_estimados,
        confirmada_em, confirmada_por, janela, criado_em, origem, origem_id
      ) values (
        public.receb_novo_ticket(), 'entrega', v_local, v_doca, new.fornecedor_id,
        v_sit, 'sem_nota', nullif(trim(coalesce(new.descricao, '')), ''),
        v_tcnpj, new.tipo_carga, new.tipo_volume, new.qtd_volumes,
        new.tipo_veiculo, new.placa, new.motorista, new.motorista_fone,
        new.peso_kg, new.cobranca_total, new.cobranca,
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
        -- coalesce e não atribuição direta: o peso que a regra dos 20% decidiu
        -- no forn_agendar seria apagado no próximo toque da tabela antiga
        peso_kg           = coalesce(new.peso_kg, peso_kg),
        cobranca_total    = coalesce(new.cobranca_total, cobranca_total),
        cobranca          = coalesce(new.cobranca, cobranca),
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
-- 6) AS TELAS PASSAM A ENXERGAR O VALOR
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
    -- o valor previsto viaja junto: uma linha aqui e ele aparece de uma vez
    -- no detalhe, na listagem e no comprovante impresso
    'cobranca_total', a.cobranca_total,
    'cobranca',       a.cobranca,
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

create or replace function public.forn_local()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.forn_meu_id() is null then jsonb_build_object('ok', false)
    else coalesce((
      select jsonb_build_object(
        'ok', true,
        'nome',     l.nome,
        'endereco', l.endereco,
        'cnpj',     nullif(regexp_replace(coalesce(l.cnpj,''), '[^0-9]', '', 'g'), ''),
        'abre',     to_char(l.abre,  'HH24:MI'),
        'fecha',    to_char(l.fecha, 'HH24:MI'),
        'dias',     l.dias_semana,
        -- preço não é segredo: é exatamente o que o fornecedor vai ver cobrado
        'cobranca', jsonb_build_object(
                      'ativa',          coalesce(l.cobranca_ativa, false),
                      'valor_agenda',   coalesce(l.cobranca_valor_agenda, 0),
                      'valor_tonelada', coalesce(l.cobranca_valor_tonelada, 0),
                      'aviso',          l.cobranca_aviso),
        'docas',    (select count(*) from public.receb_docas d
                      where d.local_id = l.id and d.ativa)
      )
      from public.receb_locais l
     where l.tenant_id = public.current_tenant()
     order by l.criado_em limit 1
    ), jsonb_build_object('ok', false)) end;
$$;


-- ============================================================
-- 7) RASTRO DE QUEM MUDOU O PREÇO
--
-- O preço é editado clicando na célula — o que é ótimo pra ele e péssimo
-- pra memória: célula editada não deixa registro de quem nem de quando.
-- "Quem trocou R$3,00 por R$3,50?" é a pergunta que aparece três meses
-- depois. Este gatilho responde.
-- ============================================================
create or replace function public.receb_cobranca_registrar_preco()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (old.cobranca_ativa,   old.cobranca_valor_agenda,
      old.cobranca_valor_tonelada, old.cobranca_aviso)
     is distinct from
     (new.cobranca_ativa,   new.cobranca_valor_agenda,
      new.cobranca_valor_tonelada, new.cobranca_aviso) then
    insert into public.receb_eventos (entidade, entidade_id, acao, detalhe)
    values ('local', new.id, 'cobranca_mudou',
            jsonb_build_object(
              'antes', jsonb_build_object('ativa', old.cobranca_ativa,
                         'agenda', old.cobranca_valor_agenda,
                         'tonelada', old.cobranca_valor_tonelada,
                         'aviso', old.cobranca_aviso),
              'depois', jsonb_build_object('ativa', new.cobranca_ativa,
                          'agenda', new.cobranca_valor_agenda,
                          'tonelada', new.cobranca_valor_tonelada,
                          'aviso', new.cobranca_aviso),
              'quem', auth.uid()));
  end if;
  return new;
end;
$$;

drop trigger if exists receb_cobranca_preco_tg on public.receb_locais;
create trigger receb_cobranca_preco_tg
  after update on public.receb_locais
  for each row execute function public.receb_cobranca_registrar_preco();


-- ============================================================
-- 8) PERDOAR UMA ENTREGA (só o master)
--
-- Num supermercado que acabou de começar a cobrar, exceção acontece toda
-- semana: acordo comercial, carga que a própria loja pediu com urgência,
-- erro de peso. Sem este botão a saída seria mexer no banco na mão — o pior
-- desfecho possível, porque não deixa rastro e não tem volta.
--
-- O retrato do que foi mostrado ao fornecedor NÃO é apagado. Só o valor
-- deixa de valer, com motivo e autor registrados.
-- ============================================================
create or replace function public.receb_cobranca_perdoar(
  p_id uuid, p_motivo text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_ant numeric;
begin
  if not public.eh_master() then
    return jsonb_build_object('ok', false, 'erro', 'Só o master pode perdoar uma cobrança.');
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    return jsonb_build_object('ok', false, 'erro', 'Escreva o motivo do perdão.');
  end if;

  select cobranca_total into v_ant from public.entregas_agendamento where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'erro', 'Agendamento não encontrado.');
  end if;
  if coalesce(v_ant, 0) = 0 then
    return jsonb_build_object('ok', false, 'erro', 'Esse agendamento não tem cobrança para perdoar.');
  end if;

  update public.entregas_agendamento
     set cobranca_total = 0,
         cobranca = coalesce(cobranca, '{}'::jsonb) || jsonb_build_object(
                      'perdoada', true, 'perdoada_em', now(),
                      'perdoada_por', auth.uid(), 'perdoada_motivo', left(trim(p_motivo), 300),
                      'total_antes', v_ant)
   where id = p_id;

  insert into public.receb_eventos (entidade, entidade_id, acao, detalhe)
  values ('entrega', p_id, 'cobranca_perdoada',
          jsonb_build_object('valor', v_ant, 'motivo', left(trim(p_motivo), 300)));

  return jsonb_build_object('ok', true, 'valor_perdoado', v_ant);
end;
$$;


-- ============================================================
-- 9) QUANTO DEU NO MÊS
--
-- Cancelada e recusada NÃO entram — foi decisão dele. Sem esta função a
-- primeira pergunta depois de ligar a cobrança ("quanto foi este mês?")
-- só teria resposta escrevendo SQL na mão, que é o contrário do objetivo.
-- ============================================================
create or replace function public.receb_cobranca_resumo(
  p_de date default null, p_ate date default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_de date; v_ate date;
begin
  if not (public.eh_master() or public.pode_pagina('central')) then
    return jsonb_build_object('ok', false, 'erro', 'Sem permissão.');
  end if;
  v_de  := coalesce(p_de,  date_trunc('month', public.receb_hoje())::date);
  v_ate := coalesce(p_ate, (date_trunc('month', public.receb_hoje()) + interval '1 month - 1 day')::date);

  return jsonb_build_object('ok', true, 'de', v_de, 'ate', v_ate,
    'total', coalesce((select round(sum(cobranca_total), 2) from public.entregas_agendamento
                        where data between v_de and v_ate
                          and coalesce(cobranca_total, 0) > 0
                          and status not in ('cancelado','recusado')), 0),
    'entregas', coalesce((select count(*) from public.entregas_agendamento
                           where data between v_de and v_ate
                             and coalesce(cobranca_total, 0) > 0
                             and status not in ('cancelado','recusado')), 0),
    'por_fornecedor', coalesce((
      select jsonb_agg(x order by x->>'total' desc) from (
        select jsonb_build_object('fornecedor', fornecedor,
                 'entregas', count(*), 'total', round(sum(cobranca_total), 2)) as x
          from public.entregas_agendamento
         where data between v_de and v_ate
           and coalesce(cobranca_total, 0) > 0
           and status not in ('cancelado','recusado')
         group by fornecedor
      ) s), '[]'::jsonb));
end;
$$;


-- ============================================================
-- 10) QUEM PODE CHAMAR
-- ============================================================
revoke all on function public.receb_cobranca_calcular(uuid,numeric) from public, anon;
revoke all on function public.forn_cobranca_previa(numeric)        from public, anon;
revoke all on function public.receb_cobranca_perdoar(uuid,text)    from public, anon;
revoke all on function public.receb_cobranca_resumo(date,date)     from public, anon;

grant execute on function public.receb_cobranca_calcular(uuid,numeric) to authenticated;
grant execute on function public.forn_cobranca_previa(numeric)         to authenticated;
grant execute on function public.receb_cobranca_perdoar(uuid,text)     to authenticated;
grant execute on function public.receb_cobranca_resumo(date,date)      to authenticated;

revoke all on function public.forn_agendar(date,int,text,text,text,jsonb,int,jsonb) from public, anon;
grant execute on function public.forn_agendar(date,int,text,text,text,jsonb,int,jsonb) to authenticated;
revoke all on function public.forn_local() from public, anon;
grant execute on function public.forn_local() to authenticated;


-- ============================================================
-- 11) CONFERÊNCIA
-- ============================================================
select 'as colunas nasceram' as conferir,
       count(*) filter (where table_name='receb_locais')          as em_receb_locais,
       count(*) filter (where table_name='entregas_agendamento')  as em_entregas,
       count(*) filter (where table_name='receb_agendas')         as em_receb_agendas
  from information_schema.columns
 where table_schema='public' and column_name like 'cobranca%';

select 'a cobranca nasceu DESLIGADA' as conferir,
       nome, cobranca_ativa, cobranca_valor_agenda, cobranca_valor_tonelada
  from public.receb_locais order by criado_em limit 1;

select 'nenhum agendamento antigo ganhou valor' as conferir,
       count(*) as com_cobranca
  from public.entregas_agendamento where cobranca_total is not null;

select 'a conta bate com o modelo (84.387 kg x R$3,00 + R$5,00 = R$258,16)' as conferir,
       public.receb_cobranca_calcular(
         (select id from public.receb_locais order by criado_em limit 1), 84387) as resultado;

select 'anonimo NAO pode chamar' as conferir,
       has_function_privilege('anon','public.forn_cobranca_previa(numeric)','execute') as anon_previa,
       has_function_privilege('anon','public.receb_cobranca_perdoar(uuid,text)','execute') as anon_perdoar,
       has_function_privilege('anon','public.receb_cobranca_resumo(date,date)','execute') as anon_resumo;
