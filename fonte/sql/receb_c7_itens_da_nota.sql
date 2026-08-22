-- ============================================================================
-- CHECKPOINT 7 — o que vem dentro da nota
--
-- Até aqui o portal lia só o cabeçalho do XML: chave, emitente, valor total.
-- Os produtos estavam no arquivo e ninguém aproveitava.
--
-- Agora, quando o fornecedor manda o XML, o sistema guarda:
--   · a lista de produtos (código, código de barras, descrição, quantidade,
--     unidade, valor unitário e total)
--   · quantos volumes, de que espécie, e o peso
--   · a transportadora que a própria nota declara
--
-- E o TAMANHO DA CARGA passa a ser preenchido sozinho na agenda, somando as
-- notas. O recebimento deixa de perguntar "quanto vem?" — a nota já disse.
--
-- Isso não cria regra de negócio nenhuma: é transcrever o que o documento diz.
-- Comparar com pedido de compra, tolerância, divergência — nada disso entra
-- aqui, porque a loja ainda não definiu.
--
-- Rodar depois de receb_c6_nota_fiscal.sql. Pode rodar de novo sem estragar.
-- ============================================================================


-- ============================================================
-- 1) COLUNAS NOVAS NA NOTA (só adição)
-- ============================================================
alter table public.receb_agenda_notas
  add column if not exists volumes      numeric(12,3),
  add column if not exists especie      text,
  add column if not exists peso_bruto   numeric(12,3),
  add column if not exists peso_liquido numeric(12,3),
  add column if not exists transportadora_nome text,
  add column if not exists transportadora_cnpj text;

comment on column public.receb_agenda_notas.especie is
  'Como a carga está acondicionada, do jeito que a nota declara: PALLET, CAIXA, FARDO...';

-- a coluna itens já existia desde o checkpoint 1, esperando por isto
comment on column public.receb_agenda_notas.itens is
  'Os produtos da nota, como o XML declara. Guardado como veio: comparar com pedido de compra é regra que a loja ainda não definiu.';


-- ============================================================
-- 2) forn_agendar PASSA A GUARDAR OS PRODUTOS
--
-- Mesma assinatura de antes: nada muda para quem já chama a função.
-- ============================================================
create or replace function public.forn_agendar(
  p_data      date,
  p_hora      int,
  p_pedido    text default null,
  p_descricao text default null,
  p_transportadora_cnpj text default null,
  p_notas     jsonb default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_forn uuid; v_id uuid; v_ag uuid; v_tcnpj text; v_chave text;
  f record; l record; n jsonb; v_xml text;
  v_vol numeric := 0; v_peso numeric := 0; v_esp text;
begin
  v_forn := public.forn_meu_id();
  if v_forn is null then
    return jsonb_build_object('ok', false, 'erro', 'Seu cadastro ainda não foi liberado pela loja.');
  end if;

  select razao_social, cnpj, telefone, email into f
    from public.receb_fornecedores where id = v_forn;

  select id, cnpj, nf_bloqueia_repetida, nf_exige_emitente_fornecedor into l
    from public.receb_locais order by criado_em limit 1;

  if p_data is null or p_data < public.receb_hoje() or p_data > public.receb_hoje() + 60 then
    return jsonb_build_object('ok', false, 'erro', 'Escolha uma data entre hoje e os próximos 60 dias.');
  end if;
  if extract(isodow from p_data) > 5 then
    return jsonb_build_object('ok', false, 'erro', 'A loja recebe de segunda a sexta.');
  end if;
  if p_hora is null or p_hora < 7 or p_hora > 16 then
    return jsonb_build_object('ok', false, 'erro', 'Escolha um horário entre 7h e 16h.');
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

      -- soma o tamanho da carga que as notas declaram
      v_vol  := v_vol  + coalesce((n->>'volumes')::numeric, 0);
      v_peso := v_peso + coalesce((n->>'peso_bruto')::numeric, 0);
      if v_esp is null then v_esp := nullif(n->>'especie',''); end if;
    end loop;
  end if;

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

    -- o tamanho da carga vem da nota, não de pergunta na tela
    if v_vol > 0 or v_peso > 0 then
      update public.receb_agendas
         set qtd_volumes = case when v_vol  > 0 then round(v_vol)::int else qtd_volumes end,
             peso_kg     = case when v_peso > 0 then v_peso            else peso_kg     end,
             tipo_volume = coalesce(tipo_volume, v_esp)
       where id = v_ag;
    end if;
  end if;

  insert into public.receb_eventos (entidade, entidade_id, acao, para, detalhe)
  values ('entrega', v_forn, 'agendou', 'pendente',
          jsonb_build_object('data', p_data, 'hora', p_hora, 'pedido', p_pedido,
                             'transportadora', v_tcnpj,
                             'notas', case when p_notas is null then 0
                                           else jsonb_array_length(p_notas) end,
                             'volumes', v_vol, 'peso', v_peso));

  return jsonb_build_object('ok', true, 'id', v_id, 'data', p_data,
                            'hora', to_char(make_time(p_hora,0,0), 'HH24:MI'));
end;
$$;

revoke all on function public.forn_agendar(date,int,text,text,text,jsonb) from public, anon;
grant execute on function public.forn_agendar(date,int,text,text,text,jsonb) to authenticated;


-- ============================================================
-- 3) O DETALHE DEVOLVE OS PRODUTOS
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
                        'volumes', n.volumes, 'especie', n.especie,
                        'peso_bruto', n.peso_bruto, 'peso_liquido', n.peso_liquido,
                        'transportadora', n.transportadora_nome,
                        'itens', coalesce(n.itens, '[]'::jsonb),
                        'tem_arquivo', (n.xml is not null),
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
-- 4) CONFERÊNCIA
-- ============================================================
select 'colunas novas na nota (tem que ser 6)' as conferir,
       (select count(*)::text from information_schema.columns
         where table_name='receb_agenda_notas'
           and column_name in ('volumes','especie','peso_bruto','peso_liquido',
                               'transportadora_nome','transportadora_cnpj')) as resultado
union all
select 'forn_agendar guarda os produtos',
       case when exists (select 1 from pg_proc where proname='forn_agendar'
                          and prosrc like '%n->''itens''%') then 'SIM' else 'NAO' end
union all
select 'o detalhe devolve os produtos',
       case when exists (select 1 from pg_proc where proname='forn_agenda'
                          and prosrc like '%coalesce(n.itens%') then 'SIM' else 'NAO' end
union all
select 'forn_agendar continua sendo 1 funcao so',
       (select count(*)::text from pg_proc
         where proname='forn_agendar' and pronamespace='public'::regnamespace)
union all
select 'agendamentos intactos',
       (select count(*)::text from public.entregas_agendamento) || ' antigos, ' ||
       (select count(*)::text from public.receb_agendas) || ' novos';
