-- ============================================================================
-- AS REGRAS DO TEMPO CERTO, APLICADAS NO NOSSO PORTAL
--
-- Origem: em 20/08/2026 o Victor pediu a uma indústria que agenda no Nordestão
-- (que usa o Tempo Certo, a plataforma em que a gente se espelhou) para escrever
-- como cada situação funciona lá. O documento respondeu 8 perguntas. Este arquivo
-- traz para o servidor as regras que dependem do banco.
--
-- O QUE MUDA, e por quê cada uma:
--   R1  o pedido de compra vira OBRIGATÓRIO     ("não conseguimos agendar se não houver o pedido")
--   R2  agendar SEM nota passa a ser permissão  ("somente empresas que forem liberadas")
--   R3a nota tem que ser do próprio fornecedor  (bloqueado lá)
--   R3c item que não está no pedido BARRA       (bloqueado lá; aqui só avisava)
--   R5  quantidade acima do pedido BARRA        ("não deixa agendar, temos que falar com o comprador")
--
-- POR QUE NO SERVIDOR: até aqui todas essas conferências viviam no navegador do
-- fornecedor, e a forn_agendar gravava sem consultar nenhuma delas. Trava que mora
-- só na tela é enfeite — basta a tela não rodar para o caminhão entrar na agenda.
--
-- CADA BLOQUEIO É UMA CHAVE. Se algum ficar rígido demais na vida real (fornecedor
-- travado na véspera da entrega), a loja desliga sem mexer em código.
-- ============================================================================

-- ------------------------------------------------------------
-- 1) As chaves novas, no cadastro do LOCAL DE ENTREGA
-- ------------------------------------------------------------
alter table public.receb_locais
  add column if not exists nf_exige_pedido           boolean not null default true,
  add column if not exists nf_bloqueia_item_fora     boolean not null default true,
  add column if not exists nf_bloqueia_acima_pedido  boolean not null default true;

comment on column public.receb_locais.nf_exige_pedido is
  'true = não agenda sem vincular a um pedido de compra da loja (regra 1 do Tempo Certo).';
comment on column public.receb_locais.nf_bloqueia_item_fora is
  'true = recusa a nota que traz produto que não está no pedido (regra 3c).';
comment on column public.receb_locais.nf_bloqueia_acima_pedido is
  'true = recusa a nota que traz mais do que o pedido ainda espera (regra 5).';

-- ------------------------------------------------------------
-- 2) "Agendar sem nota fiscal" vira permissão POR FORNECEDOR
--
-- Existia uma coluna aceita_sem_nota em receb_locais, criada e nunca lida por
-- ninguém — e no lugar errado: ela era por LOCAL, e a regra é por EMPRESA. No
-- Tempo Certo é um favor que a loja concede a quem merece; aqui era o caminho
-- padrão de qualquer um.
-- ------------------------------------------------------------
alter table public.receb_fornecedores
  add column if not exists pode_sem_nota boolean not null default false;

comment on column public.receb_fornecedores.pode_sem_nota is
  'true = esta empresa pode agendar antes de emitir a nota, informando só o pedido. '
  'Nasce false: é liberação que a loja concede, uma a uma.';

-- ------------------------------------------------------------
-- 3) Qual nota é de qual pedido — gravado de verdade
--
-- O fornecedor vincula nota por nota na tela, e isso se perdia: o envio mandava
-- um texto colado com vírgula que o banco cortava em 40 letras. Com três pedidos,
-- a doca recebia "45231, 45390, 453…", que não serve para conferir nada.
-- ------------------------------------------------------------
alter table public.receb_agenda_notas
  add column if not exists pedido_numero text;

comment on column public.receb_agenda_notas.pedido_numero is
  'O pedido de compra a que ESTA nota se refere. Um por nota — não a tira de texto '
  'de todos os pedidos juntos.';

create index if not exists ix_receb_nota_pedido
  on public.receb_agenda_notas (tenant_id, pedido_numero);

-- ------------------------------------------------------------
-- 4) O CNPJ da loja
--
-- Estava vazio, e é só isso que mantinha desligada a conferência de "esta nota foi
-- emitida para o Santa Rita?". O próprio comentário do c6 admitia: "enquanto
-- estiver vazio, a conferência do destinatário é pulada".
-- ------------------------------------------------------------
update public.receb_locais
   set cnpj = '12988127000140'
 where tenant_id = public.current_tenant()
   and coalesce(nullif(regexp_replace(coalesce(cnpj,''),'[^0-9]','','g'),''), '') = '';

-- ============================================================================
-- 5) A CONFERÊNCIA, COM O ERRO DE CONTA CORRIGIDO
--
-- O defeito: cada linha da nota era comparada contra o saldo INTEIRO do item, sem
-- descontar o que outra linha do mesmo produto já tinha usado. Pedido de 50, duas
-- linhas de 40 na mesma nota — passavam as duas, e 80 unidades entravam como se
-- coubessem. Agora a função guarda o que já foi gasto por item e desconta.
--
-- Continua sendo a ÚNICA conta de conferência do sistema: a tela do fornecedor
-- chama esta função, e a partir de agora a gravação do agendamento também. Duas
-- contas separadas para a mesma coisa divergem sempre — e aqui divergir significa
-- a tela dizer "pode agendar" e o servidor recusar, ou pior, o contrário.
-- ============================================================================
create or replace function public.forn_conferir_nota(p_pedidos text[], p_itens jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_forn uuid;
  v_linhas jsonb := '[]'::jsonb;
  v_it jsonb;
  v_ean text; v_qtd numeric; v_vun numeric; v_seq int; v_num text;
  v_lin record; v_achou boolean;
  v_sit text; v_motivo text;
  v_ok int := 0; v_acima int := 0; v_fora int := 0; v_preco int := 0;
  v_usados uuid[] := '{}';
  v_falta int := 0;
  v_ped_ids uuid[];
  v_gasto jsonb := '{}'::jsonb;      -- item_id -> quanto desta remessa já foi contra ele
  v_saldo numeric;                    -- saldo do item JÁ descontado do que foi gasto
begin
  v_forn := public.forn_meu_id();
  if v_forn is null then
    return jsonb_build_object('ok', false, 'erro', 'Faça login novamente.');
  end if;

  if p_pedidos is null or array_length(p_pedidos, 1) is null then
    return jsonb_build_object('ok', true, 'conferido', false, 'motivo', 'sem_pedido');
  end if;

  select array_agg(p.id) into v_ped_ids
    from public.receb_pedidos p
   where p.fornecedor_id = v_forn
     and p.numero = any(p_pedidos);

  if v_ped_ids is null then
    return jsonb_build_object('ok', true, 'conferido', false, 'motivo', 'pedido_nao_e_seu');
  end if;

  for v_it in select * from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) loop
    v_ean := public.receb_ean(v_it->>'ean');
    v_qtd := coalesce((v_it->>'qtd')::numeric, 0);
    v_vun := coalesce((v_it->>'valor_unit')::numeric, 0);
    v_seq := nullif(regexp_replace(coalesce(v_it->>'item_pedido', ''), '[^0-9]', '', 'g'), '')::int;
    v_num := nullif(trim(coalesce(v_it->>'pedido', '')), '');
    v_achou := false;

    if v_seq is not null then
      select i.*, p.numero as ped_numero into v_lin
        from public.receb_pedido_itens i
        join public.receb_pedidos p on p.id = i.pedido_id
       where i.pedido_id = any(v_ped_ids)
         and i.seq = v_seq
         and (v_num is null or p.numero = v_num)
       limit 1;
      v_achou := found;
    end if;

    -- QUALQUER um dos códigos do produto serve: nota em caixa tem que casar com
    -- pedido em unidade. Entre linhas iguais, prefiro a que ainda tem saldo de pé.
    if not v_achou and v_ean is not null then
      select i.*, p.numero as ped_numero into v_lin
        from public.receb_pedido_itens i
        join public.receb_pedidos p on p.id = i.pedido_id
       where i.pedido_id = any(v_ped_ids)
         and (v_ean = any(coalesce(i.eans, array[]::text[]))
              or public.receb_ean(i.ean) = v_ean)
       order by (coalesce(i.saldo,0) - coalesce((v_gasto->>(i.id::text))::numeric, 0)) desc
       limit 1;
      v_achou := found;
    end if;

    if v_achou then
      -- AQUI mora o conserto: o saldo que vale é o que sobrou depois das linhas
      -- anteriores desta mesma remessa.
      v_saldo := coalesce(v_lin.saldo, 0) - coalesce((v_gasto->>(v_lin.id::text))::numeric, 0);
      if v_saldo < 0 then v_saldo := 0; end if;
    end if;

    if not v_achou then
      v_sit := 'fora';
      v_motivo := 'Este item não está no pedido.';
      v_fora := v_fora + 1;
    elsif v_qtd > v_saldo then
      v_sit := 'acima';
      v_motivo := 'A nota traz mais do que o pedido ainda espera.';
      v_acima := v_acima + 1;
      v_usados := v_usados || v_lin.id;
      v_gasto := v_gasto || jsonb_build_object(v_lin.id::text,
                   coalesce((v_gasto->>(v_lin.id::text))::numeric, 0) + v_qtd);
    elsif v_vun > coalesce(v_lin.valor_unit, 0) + 0.005 and coalesce(v_lin.valor_unit,0) > 0 then
      v_sit := 'preco';
      v_motivo := 'O preço da nota está acima do preço do pedido.';
      v_preco := v_preco + 1;
      v_usados := v_usados || v_lin.id;
      v_gasto := v_gasto || jsonb_build_object(v_lin.id::text,
                   coalesce((v_gasto->>(v_lin.id::text))::numeric, 0) + v_qtd);
    else
      v_sit := 'ok';
      v_motivo := null;
      v_ok := v_ok + 1;
      v_usados := v_usados || v_lin.id;
      v_gasto := v_gasto || jsonb_build_object(v_lin.id::text,
                   coalesce((v_gasto->>(v_lin.id::text))::numeric, 0) + v_qtd);
    end if;

    if v_achou then
      v_linhas := v_linhas || jsonb_build_object(
        'descricao',    coalesce(nullif(trim(v_it->>'descricao'), ''), v_lin.descricao, 'Item sem descrição'),
        'ean',          v_ean, 'unidade', nullif(trim(coalesce(v_it->>'unidade','')), ''),
        'qtd_nota',     v_qtd, 'saldo', v_saldo,
        'valor_nota',   v_vun, 'valor_pedido', v_lin.valor_unit,
        'pedido',       v_lin.ped_numero, 'situacao', v_sit, 'motivo', v_motivo);
    else
      v_linhas := v_linhas || jsonb_build_object(
        'descricao',    coalesce(nullif(trim(v_it->>'descricao'), ''), 'Item sem descrição'),
        'ean',          v_ean, 'unidade', nullif(trim(coalesce(v_it->>'unidade','')), ''),
        'qtd_nota',     v_qtd, 'saldo', null,
        'valor_nota',   v_vun, 'valor_pedido', null,
        'pedido',       null, 'situacao', v_sit, 'motivo', v_motivo);
    end if;
  end loop;

  select count(*) into v_falta
    from public.receb_pedido_itens i
   where i.pedido_id = any(v_ped_ids)
     and coalesce(i.saldo, 0) > 0
     and not (i.id = any(v_usados));

  return jsonb_build_object(
    'ok', true, 'conferido', true,
    'resumo', jsonb_build_object(
      'itens', jsonb_array_length(coalesce(p_itens,'[]'::jsonb)), 'ok', v_ok, 'acima', v_acima,
      'fora', v_fora, 'preco', v_preco, 'faltando', v_falta,
      'problemas', v_acima + v_fora + v_preco),
    'linhas', v_linhas);
end;
$$;

-- ============================================================================
-- 6) A PORTA DE ENTRADA DO PORTAL
--
-- Confere as regras do Tempo Certo e só então chama a forn_agendar, que continua
-- fazendo o trabalho de sempre (horário, cobrança, notas, espelho na agenda).
--
-- Por que uma porta na frente e não reescrever a forn_agendar: ela tem quase 300
-- linhas de regra afinada em cinco versões — horário ocupado, cobrança de descarga,
-- peso, chave repetida, espelho. Reescrever para acrescentar quatro conferências é
-- pedir para perder um detalhe pelo caminho. Aqui as regras novas ficam à vista,
-- num arquivo só, e o que já funcionava continua intocado.
--
-- Para não sobrar porta dos fundos, a forn_agendar deixa de ser chamável pelo
-- portal (revoke no fim). Ela continua sendo chamada por AQUI, que roda com poder
-- próprio.
-- ============================================================================
create or replace function public.forn_agendar_portal(
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
  v_forn uuid; l record; f record;
  n jsonb; v_peds text[]; v_conf jsonb; v_res jsonb;
  v_tem_nota boolean; v_id uuid; v_ped_nota text;
  v_fora int; v_acima int; v_qual text;
begin
  v_forn := public.forn_meu_id();
  if v_forn is null then
    return jsonb_build_object('ok', false, 'erro', 'Faça login novamente.');
  end if;

  select * into f from public.receb_fornecedores where id = v_forn;
  select * into l from public.receb_locais
   where tenant_id = public.current_tenant() order by criado_em limit 1;

  v_tem_nota := coalesce(jsonb_array_length(coalesce(p_notas, '[]'::jsonb)), 0) > 0;

  -- ------------------------------------------------------------------
  -- R2 — agendar SEM nota é permissão, não é o padrão
  -- "Somente empresas que forem liberadas pelo local de entrega podem agendar sem XML."
  -- ------------------------------------------------------------------
  if not v_tem_nota and not coalesce(f.pode_sem_nota, false) then
    return jsonb_build_object('ok', false, 'erro',
      'Para agendar sem a nota fiscal é preciso liberação da loja. '
      'Envie o XML da nota, ou fale com o recebimento para pedir essa liberação.');
  end if;

  -- ------------------------------------------------------------------
  -- R1 — o pedido de compra é obrigatório
  -- "Não conseguimos agendar se não houver o pedido."
  -- Vale para os dois caminhos: com nota, cada nota precisa do seu pedido; sem
  -- nota, o número do pedido precisa vir preenchido.
  -- ------------------------------------------------------------------
  if coalesce(l.nf_exige_pedido, true) then
    if v_tem_nota then
      for n in select * from jsonb_array_elements(p_notas) loop
        if nullif(trim(coalesce(n->>'pedido','')), '') is null then
          return jsonb_build_object('ok', false, 'erro',
            'A nota ' || coalesce(nullif(n->>'numero',''), 'enviada') ||
            ' precisa estar vinculada a um pedido de compra da loja.');
        end if;
      end loop;
    elsif nullif(trim(coalesce(p_pedido,'')), '') is null then
      return jsonb_build_object('ok', false, 'erro',
        'Informe o número do pedido de compra da loja para agendar.');
    end if;
  end if;

  -- ------------------------------------------------------------------
  -- R3c e R5 — item fora do pedido e quantidade acima BARRAM
  -- No Tempo Certo essas duas situações são "notificadas e bloqueadas". Aqui a
  -- conferência já existia e só pintava de vermelho: a tela chegava a escrever
  -- "você pode agendar assim mesmo", e o servidor gravava sem olhar.
  -- Uso a MESMA forn_conferir_nota da tela — uma conta só.
  -- ------------------------------------------------------------------
  if v_tem_nota and (coalesce(l.nf_bloqueia_item_fora, true) or coalesce(l.nf_bloqueia_acima_pedido, true)) then
    for n in select * from jsonb_array_elements(p_notas) loop
      v_ped_nota := nullif(trim(coalesce(n->>'pedido','')), '');
      if v_ped_nota is null then continue; end if;
      if coalesce(jsonb_array_length(coalesce(n->'itens','[]'::jsonb)),0) = 0 then continue; end if;

      v_peds := array[v_ped_nota];
      v_conf := public.forn_conferir_nota(v_peds, n->'itens');

      if coalesce((v_conf->>'conferido')::boolean, false) then
        v_fora  := coalesce((v_conf->'resumo'->>'fora')::int, 0);
        v_acima := coalesce((v_conf->'resumo'->>'acima')::int, 0);

        if coalesce(l.nf_bloqueia_item_fora, true) and v_fora > 0 then
          select string_agg(x->>'descricao', ', ') into v_qual
            from jsonb_array_elements(v_conf->'linhas') x
           where x->>'situacao' = 'fora';
          return jsonb_build_object('ok', false, 'erro',
            'A nota ' || coalesce(nullif(n->>'numero',''),'') || ' traz ' || v_fora ||
            ' produto(s) que não estão no pedido ' || v_ped_nota || ': ' ||
            left(coalesce(v_qual,''), 180) ||
            '. Confira se o pedido escolhido é o certo, ou fale com o comprador da loja.');
        end if;

        if coalesce(l.nf_bloqueia_acima_pedido, true) and v_acima > 0 then
          select string_agg(x->>'descricao', ', ') into v_qual
            from jsonb_array_elements(v_conf->'linhas') x
           where x->>'situacao' = 'acima';
          return jsonb_build_object('ok', false, 'erro',
            'A nota ' || coalesce(nullif(n->>'numero',''),'') || ' traz mais do que o pedido ' ||
            v_ped_nota || ' ainda espera, em ' || v_acima || ' produto(s): ' ||
            left(coalesce(v_qual,''), 180) ||
            '. Fale com o comprador da loja antes de agendar.');
        end if;
      end if;
    end loop;
  end if;

  -- ------------------------------------------------------------------
  -- Passou por tudo: agenda de verdade.
  -- ------------------------------------------------------------------
  v_res := public.forn_agendar(p_data, p_hora, p_pedido, p_descricao,
                               p_transportadora_cnpj, p_notas, p_minutos, p_carga);

  -- ------------------------------------------------------------------
  -- Qual nota é de qual pedido — gravado agora, uma linha por nota.
  -- Antes isso se perdia: virava um texto colado com vírgula e cortado em 40
  -- letras, e a doca recebia "45231, 45390, 453…".
  -- ------------------------------------------------------------------
  if coalesce((v_res->>'ok')::boolean, false) and v_tem_nota then
    v_id := (v_res->>'id')::uuid;
    for n in select * from jsonb_array_elements(p_notas) loop
      v_ped_nota := nullif(trim(coalesce(n->>'pedido','')), '');
      if v_ped_nota is null then continue; end if;
      update public.receb_agenda_notas
         set pedido_numero = left(v_ped_nota, 40)
       where agenda_id = v_id
         and chave = nullif(regexp_replace(coalesce(n->>'chave',''),'[^0-9]','','g'),'');
      insert into public.receb_agenda_pedidos (agenda_id, numero)
      select v_id, left(v_ped_nota, 40)
       where not exists (select 1 from public.receb_agenda_pedidos p
                          where p.agenda_id = v_id and p.numero = left(v_ped_nota, 40));
    end loop;
  end if;

  return v_res;
end $$;

-- A porta velha deixa de ser chamável pelo portal: quem entra, entra pela nova.
-- (A forn_agendar continua funcionando — é chamada aqui de dentro, com poder próprio.)
revoke all on function public.forn_agendar(date,int,text,text,text,jsonb,int,jsonb) from public, anon, authenticated;
revoke all on function public.forn_agendar_portal(date,int,text,text,text,jsonb,int,jsonb) from public, anon;
grant execute on function public.forn_agendar_portal(date,int,text,text,text,jsonb,int,jsonb) to authenticated;

-- ============================================================================
-- 7) LIGAR A TRAVA DO EMITENTE
--
-- "XML da NF que não seja para o remetente correto (...) essas situações são
-- notificadas e bloqueadas." A trava já estava escrita no c6, mas nasceu desligada
-- com o comentário "transportadora traz nota de terceiro — decisão pendente".
--
-- Ligo agora porque o PDF resolveu a dúvida: lá é bloqueado. E porque o portal
-- passou a mandar o CNPJ do emitente também quando a nota é digitada só pela chave
-- (ele está dentro dos 44 dígitos) — sem esse conserto, ligar isto recusaria toda
-- nota sem arquivo.
--
-- Se aparecer distribuidor agendando nota de fabricante e isso for legítimo, a
-- loja desliga esta chave sozinha.
-- ============================================================================
update public.receb_locais
   set nf_exige_emitente_fornecedor = true
 where tenant_id = public.current_tenant();

-- ============================================================================
-- CONFERÊNCIA FINAL — o que ficou ligado
-- ============================================================================
do $$
declare r record;
begin
  select cnpj, nf_exige_pedido, nf_bloqueia_item_fora, nf_bloqueia_acima_pedido,
         nf_exige_emitente_fornecedor, nf_bloqueia_repetida
    into r
    from public.receb_locais where tenant_id = public.current_tenant()
   order by criado_em limit 1;

  raise notice 'CNPJ da loja............: %', coalesce(nullif(r.cnpj,''), '(VAZIO — confira!)');
  raise notice 'exige pedido............: %', r.nf_exige_pedido;
  raise notice 'barra item fora.........: %', r.nf_bloqueia_item_fora;
  raise notice 'barra acima do pedido...: %', r.nf_bloqueia_acima_pedido;
  raise notice 'exige emitente=fornec...: %', r.nf_exige_emitente_fornecedor;
  raise notice 'barra nota repetida.....: %', r.nf_bloqueia_repetida;
  raise notice 'fornecedores liberados a agendar sem nota: %',
    (select count(*) from public.receb_fornecedores where pode_sem_nota);
end $$;
