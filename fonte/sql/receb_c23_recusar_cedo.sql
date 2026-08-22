-- ============================================================================
-- PORTAL DO FORNECEDOR — RECUSAR CEDO
--
-- O problema: todas as travas da loja (tem que ter pedido, não pode item fora do
-- pedido, não pode acima do pedido, agendar sem nota é permissão) só eram
-- conferidas no ÚLTIMO clique, dentro da forn_agendar_portal. O fornecedor
-- digitava a nota, vinculava o pedido, anexava documento, escolhia horário,
-- preenchia placa e motorista — e só então levava "não consegui agendar".
-- Ele refaz tudo e liga para o recebimento. É o caminho mais curto para o
-- fornecedor desistir do portal e voltar a ligar para a loja.
--
-- A solução NÃO é copiar as travas para dentro da tela. Tela é fácil de burlar, e
-- duas cópias da mesma regra sempre divergem com o tempo. Aqui as travas saem de
-- dentro da função que GRAVA e viram uma função que só OLHA:
--
--        forn_checar_agendamento()  ← uma regra, um lugar
--            ↑                ↑
--     a tela pergunta    o gravar confere antes de gravar
--
-- A tela só PERGUNTA e mostra a resposta. Quem burlar a tela continua barrado no
-- gravar, porque o gravar chama a mesma função.
--
-- O QUE NÃO MUDA: nenhuma trava afrouxa, nenhuma mensagem muda de texto, e a
-- forn_agendar_portal continua com a mesma assinatura e o mesmo retorno.
--
-- Rodar no SQL Editor do Supabase. Pode rodar mais de uma vez sem estragar nada.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) A REGRA, UM LUGAR SÓ
--
-- Devolve { ok, erro, onde }. O "onde" diz em qual passo do portal o problema
-- mora, para a tela levar o fornecedor direto ao lugar de corrigir:
--     'nf'      → os dados da nota / a liberação para agendar sem nota
--     'pedidos' → o vínculo com o pedido de compra e o que a nota traz dentro
--
-- Só lê. Não grava nada. Roda com poder próprio porque precisa ler receb_locais
-- e receb_fornecedores, mas só enxerga o fornecedor que está logado
-- (forn_meu_id) — um fornecedor nunca vê nada do outro por aqui.
-- ----------------------------------------------------------------------------
create or replace function public.forn_checar_agendamento(
  p_pedido text default null,
  p_notas  jsonb default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_forn uuid; l record; f record;
  n jsonb; v_peds text[]; v_conf jsonb;
  v_tem_nota boolean; v_ped_nota text;
  v_fora int; v_acima int; v_qual text;
begin
  v_forn := public.forn_meu_id();
  if v_forn is null then
    return jsonb_build_object('ok', false, 'onde', 'nf', 'erro', 'Faça login novamente.');
  end if;

  select * into f from public.receb_fornecedores where id = v_forn;
  select * into l from public.receb_locais
   where tenant_id = public.current_tenant() order by criado_em limit 1;

  v_tem_nota := coalesce(jsonb_array_length(coalesce(p_notas, '[]'::jsonb)), 0) > 0;

  -- ------------------------------------------------------------------
  -- R2 — agendar SEM nota é permissão, não é o padrão
  -- ------------------------------------------------------------------
  if not v_tem_nota and not coalesce(f.pode_sem_nota, false) then
    return jsonb_build_object('ok', false, 'onde', 'nf', 'erro',
      'Para agendar sem a nota fiscal é preciso liberação da loja. '
      'Envie o XML da nota, ou fale com o recebimento para pedir essa liberação.');
  end if;

  -- ------------------------------------------------------------------
  -- R1 — o pedido de compra é obrigatório
  -- ------------------------------------------------------------------
  if coalesce(l.nf_exige_pedido, true) then
    if v_tem_nota then
      for n in select * from jsonb_array_elements(p_notas) loop
        if nullif(trim(coalesce(n->>'pedido','')), '') is null then
          return jsonb_build_object('ok', false, 'onde', 'pedidos', 'erro',
            'A nota ' || coalesce(nullif(n->>'numero',''), 'enviada') ||
            ' precisa estar vinculada a um pedido de compra da loja.');
        end if;
      end loop;
    elsif nullif(trim(coalesce(p_pedido,'')), '') is null then
      return jsonb_build_object('ok', false, 'onde', 'pedidos', 'erro',
        'Informe o número do pedido de compra da loja para agendar.');
    end if;
  end if;

  -- ------------------------------------------------------------------
  -- R3c e R5 — item fora do pedido e quantidade acima BARRAM
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
          return jsonb_build_object('ok', false, 'onde', 'pedidos', 'erro',
            'A nota ' || coalesce(nullif(n->>'numero',''),'') || ' traz ' || v_fora ||
            ' produto(s) que não estão no pedido ' || v_ped_nota || ': ' ||
            left(coalesce(v_qual,''), 180) ||
            '. Confira se o pedido escolhido é o certo, ou fale com o comprador da loja.');
        end if;

        if coalesce(l.nf_bloqueia_acima_pedido, true) and v_acima > 0 then
          select string_agg(x->>'descricao', ', ') into v_qual
            from jsonb_array_elements(v_conf->'linhas') x
           where x->>'situacao' = 'acima';
          return jsonb_build_object('ok', false, 'onde', 'pedidos', 'erro',
            'A nota ' || coalesce(nullif(n->>'numero',''),'') || ' traz mais do que o pedido ' ||
            v_ped_nota || ' ainda espera, em ' || v_acima || ' produto(s): ' ||
            left(coalesce(v_qual,''), 180) ||
            '. Fale com o comprador da loja antes de agendar.');
        end if;
      end if;
    end loop;
  end if;

  return jsonb_build_object('ok', true);
end $$;

comment on function public.forn_checar_agendamento(text, jsonb) is
  'Confere as travas do agendamento SEM gravar. Chamada pela tela (para avisar cedo) '
  'e pela forn_agendar_portal (antes de gravar). Uma regra, um lugar.';

revoke all on function public.forn_checar_agendamento(text, jsonb) from public, anon;
grant execute on function public.forn_checar_agendamento(text, jsonb) to authenticated;


-- ----------------------------------------------------------------------------
-- 2) O GRAVAR PASSA A USAR A MESMA REGRA
--
-- Mesma assinatura, mesmo retorno, mesmas mensagens. A única diferença é que o
-- bloco de travas que morava aqui dentro agora é uma chamada.
-- ----------------------------------------------------------------------------
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
  n jsonb; v_res jsonb; v_chk jsonb;
  v_tem_nota boolean; v_id uuid; v_ped_nota text;
begin
  -- AS TRAVAS. Mesmas de sempre, agora num lugar só — a tela pergunta as mesmas
  -- para avisar o fornecedor antes de ele preencher o resto.
  v_chk := public.forn_checar_agendamento(p_pedido, p_notas);
  if not coalesce((v_chk->>'ok')::boolean, false) then
    return jsonb_build_object('ok', false, 'erro', v_chk->>'erro');
  end if;

  v_tem_nota := coalesce(jsonb_array_length(coalesce(p_notas, '[]'::jsonb)), 0) > 0;

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

revoke all on function public.forn_agendar_portal(date,int,text,text,text,jsonb,int,jsonb) from public, anon;
grant execute on function public.forn_agendar_portal(date,int,text,text,text,jsonb,int,jsonb) to authenticated;


-- ----------------------------------------------------------------------------
-- 3) CONFERÊNCIA — o que este arquivo deixou de pé
-- ----------------------------------------------------------------------------
select 'forn_checar_agendamento existe' as o_que,
       (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' and p.proname='forn_checar_agendamento')::text as resultado
union all
select 'forn_agendar_portal continua existindo',
       (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' and p.proname='forn_agendar_portal')::text
union all
select 'a tela pode perguntar (authenticated)',
       (select count(*)::text from information_schema.routine_privileges
         where routine_schema='public' and routine_name='forn_checar_agendamento'
           and grantee='authenticated' and privilege_type='EXECUTE')
union all
select 'anon NAO pode perguntar (tem que ser 0)',
       (select count(*)::text from information_schema.routine_privileges
         where routine_schema='public' and routine_name='forn_checar_agendamento'
           and grantee in ('anon','PUBLIC') and privilege_type='EXECUTE');
