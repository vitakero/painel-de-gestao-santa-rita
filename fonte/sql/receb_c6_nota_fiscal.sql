-- ============================================================================
-- CHECKPOINT 6 — a nota fiscal entra no agendamento
--
-- O QUE ENTRA AQUI:
--   · o arquivo XML passa a ser guardado junto com a agenda
--   · o BANCO confere a nota, não só a tela — a tela é conveniência, quem
--     decide é o servidor. Qualquer um pode mandar dado direto para a API.
--   · o que a loja ainda não decidiu vira CHAVE de configuração, não regra
--     cravada: nota repetida e emitente diferente do fornecedor.
--
-- O QUE O BANCO CONFERE, DE VERDADE:
--   1. a chave tem 44 números e o dígito verificador fecha
--   2. a chave que o fornecedor declarou aparece DENTRO do arquivo enviado
--      (impede mandar os campos de uma nota e o arquivo de outra)
--   3. o arquivo é mesmo de NF-e (tem a marca infNFe)
--   4. se o CNPJ da loja estiver cadastrado, ele precisa aparecer no arquivo
--   5. nota repetida, conforme a chave de configuração
--
-- O QUE ELE NÃO FAZ, DE PROPÓSITO:
--   · não decide se a NOTA passa a ser obrigatória
--   · não muda a duração da descarga por causa do tamanho da nota
--   · não confere item por item contra pedido de compra
--   Tudo isso depende de regra que a loja ainda não definiu.
--
-- Rodar depois de receb_c5_transportadora.sql. Pode rodar de novo sem estragar.
-- ============================================================================


-- ============================================================
-- 1) ONDE A NOTA MORA E O QUE A LOJA CONFIGURA
-- ============================================================

-- O arquivo fica no banco, junto do dado, e não num cofre à parte: uma NF-e
-- tem uns 20 KB, a proteção de quem-vê-o-quê já existe aqui, e assim arquivo e
-- dado nunca se desgarram. Cofre separado é para arquivo pesado (foto, PDF).
alter table public.receb_agenda_notas
  add column if not exists xml text;

comment on column public.receb_agenda_notas.xml is
  'O arquivo original da NF-e, como texto. Guardado aqui de propósito: é pequeno e a RLS já protege.';

alter table public.receb_locais
  add column if not exists cnpj text,
  add column if not exists nf_bloqueia_repetida boolean not null default true,
  add column if not exists nf_exige_emitente_fornecedor boolean not null default false;

comment on column public.receb_locais.cnpj is
  'CNPJ que aparece como DESTINATÁRIO nas notas. Enquanto estiver vazio, a conferência do destinatário é pulada — e o aviso disso aparece na tela.';
comment on column public.receb_locais.nf_bloqueia_repetida is
  'true = a mesma nota não entra em dois agendamentos. A loja ainda não decidiu; nasce fechado por ser o lado seguro.';
comment on column public.receb_locais.nf_exige_emitente_fornecedor is
  'true = só aceita nota emitida pelo próprio fornecedor logado. Nasce false porque transportadora traz nota de terceiro — decisão pendente.';

create index if not exists ix_receb_nota_chave_viva
  on public.receb_agenda_notas (tenant_id, chave);


-- ============================================================
-- 2) O DÍGITO DA CHAVE, CONFERIDO NO SERVIDOR
--    A mesma conta que a tela faz. Aqui é a que vale.
-- ============================================================
create or replace function public.receb_nfe_digito(p_base43 text)
returns int language plpgsql immutable as $$
declare v_peso int := 2; v_soma int := 0; i int; v_r int;
begin
  if p_base43 is null or length(p_base43) <> 43 or p_base43 !~ '^[0-9]+$' then
    return -1;
  end if;
  for i in reverse 43..1 loop
    v_soma := v_soma + (substr(p_base43, i, 1))::int * v_peso;
    v_peso := v_peso + 1;
    if v_peso > 9 then v_peso := 2; end if;
  end loop;
  v_r := v_soma % 11;
  return case when v_r in (0,1) then 0 else 11 - v_r end;
end;
$$;

create or replace function public.receb_nfe_chave_ok(p_chave text)
returns boolean language sql immutable as $$
  select p_chave is not null
     and p_chave ~ '^[0-9]{44}$'
     and public.receb_nfe_digito(substr(p_chave,1,43)) = substr(p_chave,44,1)::int;
$$;


-- ============================================================
-- 3) AGENDAR COM NOTA FISCAL
--
-- p_notas é uma lista assim:
--   [{"chave":"...44 números...", "xml":"<?xml ...", "numero":"128944",
--     "serie":"1", "emissao":"2026-08-10", "valor":"18420.90",
--     "emitente_cnpj":"...", "emitente_nome":"...", "destino_cnpj":"..."}]
--
-- A tela manda o que leu; o banco NÃO confia e confere de novo contra o arquivo.
-- ============================================================
drop function if exists public.forn_agendar(date, int, text, text, text);

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

  -- ---------- conferência das notas, ANTES de reservar o horário ----------
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
        -- a chave declarada tem que estar DENTRO do arquivo: senão dá para
        -- mandar os campos de uma nota com o arquivo de outra
        if position(v_chave in regexp_replace(v_xml, '[^0-9]', '', 'g')) = 0 then
          return jsonb_build_object('ok', false, 'erro',
            'A chave informada não aparece dentro do arquivo enviado.');
        end if;
        -- destinatário: só confere se a loja tiver cadastrado o próprio CNPJ
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

  -- o espelho já criou a agenda nova dentro desta mesma transação
  select id into v_ag from public.receb_agendas
   where origem = 'entregas_agendamento' and origem_id = v_id;

  if v_ag is not null and p_notas is not null and jsonb_typeof(p_notas) = 'array' then
    for n in select * from jsonb_array_elements(p_notas) loop
      insert into public.receb_agenda_notas
        (agenda_id, chave, numero, serie, emitente_cnpj, emitente_nome, destin_cnpj,
         emissao, valor_total, xml, situacao)
      values (v_ag,
        regexp_replace(coalesce(n->>'chave',''), '[^0-9]', '', 'g'),
        nullif(n->>'numero',''), nullif(n->>'serie',''),
        nullif(regexp_replace(coalesce(n->>'emitente_cnpj',''),'[^0-9]','','g'),''),
        nullif(n->>'emitente_nome',''),
        nullif(regexp_replace(coalesce(n->>'destino_cnpj',''),'[^0-9]','','g'),''),
        nullif(n->>'emissao','')::date,
        nullif(regexp_replace(coalesce(n->>'valor',''),'[^0-9.]','','g'),'')::numeric,
        nullif(n->>'xml',''),
        case when nullif(n->>'xml','') is null then 'registrada' else 'lida' end);
    end loop;
  end if;

  insert into public.receb_eventos (entidade, entidade_id, acao, para, detalhe)
  values ('entrega', v_forn, 'agendou', 'pendente',
          jsonb_build_object('data', p_data, 'hora', p_hora, 'pedido', p_pedido,
                             'transportadora', v_tcnpj,
                             'notas', case when p_notas is null then 0
                                           else jsonb_array_length(p_notas) end));

  return jsonb_build_object('ok', true, 'id', v_id, 'data', p_data,
                            'hora', to_char(make_time(p_hora,0,0), 'HH24:MI'));
end;
$$;

revoke all on function public.forn_agendar(date,int,text,text,text,jsonb) from public, anon;
revoke all on function public.receb_nfe_digito(text)   from public, anon;
revoke all on function public.receb_nfe_chave_ok(text) from public, anon;
grant execute on function public.forn_agendar(date,int,text,text,text,jsonb) to authenticated;
grant execute on function public.receb_nfe_digito(text)   to authenticated;
grant execute on function public.receb_nfe_chave_ok(text) to authenticated;


-- ============================================================
-- 4) O FORNECEDOR PRECISA VER O XML QUE ELE MESMO MANDOU
--    (e só o dele — a função filtra por dono, como as outras)
-- ============================================================
create or replace function public.forn_nota_xml(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if public.forn_meu_id() is null then
    return jsonb_build_object('ok', false, 'erro', 'Cadastro não liberado.');
  end if;
  select jsonb_build_object('ok', true, 'chave', n.chave, 'numero', n.numero, 'xml', n.xml)
    into v
    from public.receb_agenda_notas n
    join public.receb_agendas a on a.id = n.agenda_id
   where n.id = p_id and a.fornecedor_id = public.forn_meu_id();
  return coalesce(v, jsonb_build_object('ok', false, 'erro', 'Nota não encontrada.'));
end;
$$;

revoke all on function public.forn_nota_xml(uuid) from public, anon;
grant execute on function public.forn_nota_xml(uuid) to authenticated;


-- ============================================================
-- 5) DEFEITO DA REVISÃO: liberar a empresa liberava TODO MUNDO
--
-- O arquivo original prometia, em comentário, que "cada pessoa nova também
-- passa pela aprovação — senão bastaria alguém saber o CNPJ de um fornecedor
-- já liberado para entrar junto". O código fazia o contrário: liberava em
-- bloco todas as contas em espera daquela empresa.
--
-- Agora: a liberação em bloco só acontece na PRIMEIRA vez, quando ninguém
-- daquela empresa entrou ainda — é o caso de quem abriu o cadastro. Depois
-- disso, cada pessoa nova é liberada uma a uma.
-- ============================================================
create or replace function public.forn_decidir(
  p_fornecedor_id uuid,
  p_situacao      text,
  p_motivo        text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_antes text; v_ja_tem boolean;
begin
  if not (public.sou_master() or public.pode_pagina('fornecedores')) then
    return jsonb_build_object('ok', false, 'erro', 'Sem permissão.');
  end if;
  if p_situacao not in ('liberado', 'recusado', 'bloqueado', 'aguardando') then
    return jsonb_build_object('ok', false, 'erro', 'Situação inválida.');
  end if;

  select situacao into v_antes
    from public.receb_fornecedores
   where id = p_fornecedor_id and tenant_id = public.current_tenant();

  if v_antes is null then
    return jsonb_build_object('ok', false, 'erro', 'Fornecedor não encontrado.');
  end if;

  select exists (select 1 from public.receb_fornecedor_contas
                  where fornecedor_id = p_fornecedor_id and situacao = 'liberada')
    into v_ja_tem;

  update public.receb_fornecedores
     set situacao      = p_situacao,
         motivo        = nullif(trim(coalesce(p_motivo, '')), ''),
         liberado_por  = auth.uid(),
         liberado_em   = case when p_situacao = 'liberado' then now() else liberado_em end,
         atualizado_em = now()
   where id = p_fornecedor_id and tenant_id = public.current_tenant();

  -- primeira liberação: quem abriu o cadastro entra junto.
  -- depois disso, pessoa nova precisa de liberação própria.
  if p_situacao = 'liberado' and not v_ja_tem then
    update public.receb_fornecedor_contas
       set situacao = 'liberada', liberado_por = auth.uid(), liberado_em = now()
     where fornecedor_id = p_fornecedor_id and situacao = 'aguardando';
  end if;

  insert into public.receb_eventos (entidade, entidade_id, acao, de, para, motivo, quem)
  values ('fornecedor', p_fornecedor_id,
          case p_situacao when 'liberado' then 'liberou'
                          when 'recusado' then 'recusou'
                          when 'bloqueado' then 'bloqueou'
                          else 'reabriu' end,
          v_antes, p_situacao, nullif(trim(coalesce(p_motivo, '')), ''), auth.uid());

  return jsonb_build_object('ok', true);
end;
$$;

-- Como agora nem toda conta entra junto, precisa existir jeito de liberar uma
-- pessoa sozinha. Sem isto, quem se cadastrasse depois ficaria preso.
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

  select situacao, fornecedor_id into v_antes, v_forn
    from public.receb_fornecedor_contas where id = p_conta_id;
  if v_antes is null then
    return jsonb_build_object('ok', false, 'erro', 'Conta não encontrada.');
  end if;

  update public.receb_fornecedor_contas
     set situacao = p_situacao,
         liberado_por = auth.uid(),
         liberado_em = case when p_situacao = 'liberada' then now() else liberado_em end
   where id = p_conta_id;

  insert into public.receb_eventos (entidade, entidade_id, acao, de, para, motivo, quem)
  values ('fornecedor_conta', p_conta_id,
          case p_situacao when 'liberada' then 'liberou' when 'recusada' then 'recusou'
                          else 'reabriu' end,
          v_antes, p_situacao, nullif(trim(coalesce(p_motivo, '')), ''), auth.uid());

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.forn_decidir_conta(uuid, text, text) from public, anon;
grant execute on function public.forn_decidir_conta(uuid, text, text) to authenticated;


-- ============================================================
-- 6) DEFEITO DA REVISÃO: o espelho podia duplicar
--    Sem chave única, dois espelhos concorrentes criariam duas agendas
--    para a mesma entrega antiga.
-- ============================================================
create unique index if not exists ux_receb_agenda_origem
  on public.receb_agendas (origem, origem_id)
  where origem_id is not null;


-- ============================================================
-- 7) CONFERÊNCIA
-- ============================================================
select 'coluna do XML' as conferir,
       case when exists (select 1 from information_schema.columns
                          where table_name='receb_agenda_notas' and column_name='xml')
            then 'SIM' else 'NAO' end as resultado
union all
select 'chaves de configuracao da nota',
       (select count(*)::text from information_schema.columns
         where table_name='receb_locais'
           and column_name in ('cnpj','nf_bloqueia_repetida','nf_exige_emitente_fornecedor')) || ' de 3'
union all
select 'CNPJ da loja cadastrado (precisa preencher)',
       coalesce((select nullif(cnpj,'') from public.receb_locais order by criado_em limit 1),
                'AINDA VAZIO — a conferencia do destinatario fica pulada')
union all
select 'digito da chave confere no banco',
       case when public.receb_nfe_chave_ok('24260811222333000181550010001289441000000016')
            then 'SIM' else 'NAO' end
union all
select 'chave errada e recusada',
       case when public.receb_nfe_chave_ok('24260811222333000181550010001289441000000017')
            then 'FALHOU' else 'SIM' end
union all
select 'forn_agendar com 6 parametros (1 funcao so)',
       (select count(*)::text from pg_proc
         where proname='forn_agendar' and pronamespace='public'::regnamespace)
union all
select 'liberacao em bloco corrigida',
       case when exists (select 1 from pg_proc where proname='forn_decidir' and prosrc like '%v_ja_tem%')
            then 'SIM' else 'NAO' end
union all
select 'chave unica do espelho',
       case when exists (select 1 from pg_indexes where indexname='ux_receb_agenda_origem')
            then 'SIM' else 'NAO' end
union all
select 'agendamentos intactos',
       (select count(*)::text from public.entregas_agendamento) || ' antigos, ' ||
       (select count(*)::text from public.receb_agendas) || ' novos';
