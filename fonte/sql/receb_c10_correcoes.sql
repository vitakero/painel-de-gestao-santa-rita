-- ============================================================================
-- CHECKPOINT 10 — correções da revisão adversarial de 15/08/2026 (noite)
--
-- Uma revisão em quatro frentes levantou 47 suspeitas; 39 sobreviveram a dois
-- céticos cada. Este arquivo conserta as CRÍTICAS e as ALTAS que dependem do
-- banco. As de tela foram no montar-portal.cjs.
--
-- O QUE ESTAVA ERRADO, em ordem de estrago:
--
--  1. LIBERAR PESSOA NOVA NUNCA FUNCIONOU. forn_decidir_conta procura uma
--     coluna "id" que não existe: a chave de receb_fornecedor_contas é
--     user_id. Como plpgsql só confere o corpo ao rodar, o CREATE passou
--     limpo. Pior: o checkpoint 6 tirou a liberação em bloco e deixou esta
--     função como única saída — que estava quebrada. Beco sem saída.
--
--  2. NOTA REPETIDA NÃO ERA BLOQUEADA DE VERDADE. A função lia e depois
--     gravava; entre uma coisa e outra cabe outro agendamento. E a mesma
--     chave repetida DENTRO do mesmo envio passava direto, dobrando volume
--     e peso. Leitura não é trava — índice é.
--
--  3. QUANDO O ESPELHO FALHAVA, AS NOTAS SUMIAM E O PORTAL DIZIA "OK".
--     Se a agenda nova não fosse criada, o laço das notas simplesmente não
--     rodava. O fornecedor via sucesso e a nota não existia em lugar nenhum.
--
--  4. AGENDA COM NOTA CONTINUAVA MARCADA COMO "SEM NOTA" no eixo do documento.
--
-- Rodar depois de receb_c9_duracao_e_carga.sql. Pode rodar de novo.
-- ============================================================================


-- ============================================================
-- 1) LIBERAR PESSOA: a coluna certa é user_id
--
-- E aproveitando: faltava o filtro de tenant, que todas as outras têm.
-- ============================================================
create or replace function public.forn_decidir_conta(
  p_conta_id uuid,
  p_situacao text,
  p_motivo   text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_antes text; v_forn uuid;
begin
  if not (public.sou_master() or public.pode_pagina('fornecedores')) then
    return jsonb_build_object('ok', false, 'erro', 'Sem permissão.');
  end if;
  if p_situacao not in ('liberada', 'recusada', 'aguardando') then
    return jsonb_build_object('ok', false, 'erro', 'Situação inválida.');
  end if;

  select c.situacao, c.fornecedor_id into v_antes, v_forn
    from public.receb_fornecedor_contas c
   where c.user_id = p_conta_id
     and c.tenant_id = public.current_tenant();

  if v_antes is null then
    return jsonb_build_object('ok', false, 'erro', 'Conta não encontrada.');
  end if;

  update public.receb_fornecedor_contas c
     set situacao = p_situacao,
         liberado_por = auth.uid(),
         liberado_em = case when p_situacao = 'liberada' then now() else c.liberado_em end
   where c.user_id = p_conta_id
     and c.tenant_id = public.current_tenant();

  insert into public.receb_eventos (entidade, entidade_id, acao, de, para, motivo, quem)
  values ('fornecedor_conta', p_conta_id,
          case p_situacao when 'liberada' then 'liberou' when 'recusada' then 'recusou'
                          else 'reabriu' end,
          v_antes, p_situacao, nullif(trim(coalesce(p_motivo, '')), ''), auth.uid());

  return jsonb_build_object('ok', true);
end;
$$;


-- ============================================================
-- 2) NOTA REPETIDA VIRA TRAVA DE VERDADE
--
-- Antes: a função LIA se já existia e depois gravava. Entre a leitura e a
-- gravação cabe outro agendamento — dois pedidos no mesmo segundo passavam
-- os dois. Agora o banco recusa, e não tem corrida que vença índice.
--
-- Só vale para agenda viva: nota de agendamento cancelado ou recusado pode
-- ser usada de novo, que é o certo.
-- ============================================================
create unique index if not exists ux_receb_nota_chave_viva
  on public.receb_agenda_notas (tenant_id, chave)
  where chave is not null;


-- ============================================================
-- 3) AGENDAR: repetida no mesmo envio, espelho que falha, e a nota
--    passando a marcar o eixo do documento
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
       left(nullif(p_carga->>'tipo_carga',''), 40), left(nullif(p_carga->>'tipo_volume',''), 40),
       nullif(regexp_replace(coalesce(p_carga->>'qtd_volumes',''),'[^0-9]','','g'),'')::int,
       left(nullif(p_carga->>'tipo_veiculo',''), 40), left(upper(nullif(p_carga->>'placa','')), 10),
       left(nullif(p_carga->>'motorista',''), 80), left(nullif(p_carga->>'motorista_fone',''), 30))
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
           peso_kg     = coalesce(peso_kg, case when v_peso > 0 then v_peso end),
           tipo_volume = coalesce(tipo_volume, left(v_esp, 40))
     where id = v_ag;
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
grant execute on function public.forn_agendar(date,int,text,text,text,jsonb,int,jsonb) to authenticated;


-- ============================================================
-- 4) CONFERÊNCIA
-- ============================================================
select 'liberar pessoa usa a coluna certa' as conferir,
       case when exists (select 1 from pg_proc where proname='forn_decidir_conta'
                          and prosrc like '%c.user_id = p_conta_id%'
                          and prosrc not like '%where id = p_conta_id%')
            then 'SIM' else 'NAO' end as resultado
union all
select 'nota repetida virou trava de banco',
       case when exists (select 1 from pg_indexes where indexname='ux_receb_nota_chave_viva')
            then 'SIM' else 'NAO' end
union all
select 'espelho que falha nao passa como ok',
       case when exists (select 1 from pg_proc where proname='forn_agendar'
                          and prosrc like '%não teriam onde ficar%') then 'SIM' else 'NAO' end
union all
select 'chave repetida no mesmo envio e recusada',
       case when exists (select 1 from pg_proc where proname='forn_agendar'
                          and prosrc like '%aparece duas vezes%') then 'SIM' else 'NAO' end
union all
select 'agendamentos intactos',
       (select count(*)::text from public.entregas_agendamento) || ' antigos, ' ||
       (select count(*)::text from public.receb_agendas) || ' novos, ' ||
       (select count(*)::text from public.receb_agenda_notas) || ' notas';
