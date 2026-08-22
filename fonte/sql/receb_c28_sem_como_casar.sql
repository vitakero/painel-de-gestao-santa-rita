-- ============================================================================
-- "NÃO ESTÁ NO PEDIDO" x "NÃO DÁ PARA CONFERIR" — são coisas diferentes
--
-- O defeito, medido em 20/08/2026 nas 200 primeiras notas reais que o VR trouxe:
--
--     370 de 1.490 itens (24,8%) não têm NENHUM jeito de casar com o pedido:
--     nem código de barras, nem a linha do pedido dentro da nota.
--     81 das 200 notas (40%) têm pelo menos um item assim.
--
-- A conferência casa o item da nota com o item do pedido de dois jeitos: pela linha
-- do pedido (nItemPed, que vem dentro da nota) ou pelo código de barras. Quando o
-- item não traz nenhum dos dois, ela não acha — e dizia "Este item não está no
-- pedido". Que é uma ACUSAÇÃO, e falsa: o produto pode muito bem estar no pedido,
-- só não há por onde saber.
--
-- Pior: como a trava nf_bloqueia_item_fora barra o agendamento, 40% das notas
-- seriam RECUSADAS por isso. O fornecedor lê "você trouxe produto que não pedi",
-- confere o pedido dele, vê que está certo, e liga para a loja achando que o
-- sistema quebrou. E ele estaria certo.
--
-- O conserto: separar as duas situações.
--     'fora'       — o item TINHA como ser casado (tem código de barras, ou declara
--                    a linha do pedido) e mesmo assim não está lá. Isso é problema
--                    de verdade, e continua barrando.
--     'indefinido' — o item não trouxe nem código de barras nem linha do pedido.
--                    Não dá para afirmar nada. Aparece para a loja conferir na
--                    chegada, e NÃO barra ninguém.
--
-- Nada mais muda: quantidade acima, preço acima e item que falta continuam iguais.
--
-- Por que não casar pelo código do produto: o pedido guarda o código INTERNO DO VR
-- (id_produto) e a nota traz o código DO FORNECEDOR (cProd). São numerações
-- diferentes — casar por ali daria par errado, que é pior do que não casar.
--
-- Rodar no SQL Editor do Supabase. Pode rodar mais de uma vez sem estragar nada.
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
  v_indef int := 0;
  v_usados uuid[] := '{}';
  v_falta int := 0;
  v_ped_ids uuid[];
  v_gasto jsonb := '{}'::jsonb;      -- item_id -> quanto desta remessa já foi contra ele
  v_saldo numeric;                    -- saldo do item JÁ descontado do que foi gasto
  v_tinha_como boolean;               -- este item tinha ALGUM jeito de ser casado?
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

    -- ESTE ITEM TINHA COMO SER CASADO? É a pergunta que separa acusação de dúvida.
    v_tinha_como := (v_seq is not null) or (v_ean is not null);

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
      -- AQUI mora o conserto anterior: o saldo que vale é o que sobrou depois das
      -- linhas anteriores desta mesma remessa.
      v_saldo := coalesce(v_lin.saldo, 0) - coalesce((v_gasto->>(v_lin.id::text))::numeric, 0);
      if v_saldo < 0 then v_saldo := 0; end if;
    end if;

    if not v_achou and not v_tinha_como then
      -- NÃO É ACUSAÇÃO, É DÚVIDA. A nota não trouxe código de barras nem a linha do
      -- pedido: não há por onde afirmar que este produto está ou não no pedido.
      -- Não entra em 'fora', então não barra ninguém — quem confere é a doca.
      v_sit := 'indefinido';
      v_motivo := 'Sem código de barras e sem a linha do pedido na nota: confira na chegada.';
      v_indef := v_indef + 1;
    elsif not v_achou then
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
      -- 'indefinido' fica FORA de 'problemas' de propósito: não é falha do
      -- fornecedor, é falta de informação na nota.
      'indefinido', v_indef,
      'problemas', v_acima + v_fora + v_preco),
    'linhas', v_linhas);
end;
$$;

revoke all on function public.forn_conferir_nota(text[], jsonb) from public, anon;
grant execute on function public.forn_conferir_nota(text[], jsonb) to authenticated;

-- ============================================================================
-- CONFERÊNCIA
-- ============================================================================
select 'a conferencia separa duvida de acusacao' as o_que,
       (select case when prosrc like '%indefinido%' then 'sim' else 'NAO - me avise' end
          from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' and p.proname='forn_conferir_nota') as resultado
union all
select 'item sem como casar NAO entra em problemas',
       (select case when prosrc like '%v_acima + v_fora + v_preco%' then 'certo' else 'ME AVISE' end
          from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' and p.proname='forn_conferir_nota')
union all
select 'itens sem como casar nas notas ja na nuvem',
       (select count(*)::text from public.receb_notas_vr v,
               lateral jsonb_array_elements(coalesce(v.itens,'[]'::jsonb)) x
         where nullif(x->>'ean','') is null and nullif(x->>'item_pedido','') is null)
union all
select 'de um total de',
       (select count(*)::text from public.receb_notas_vr v,
               lateral jsonb_array_elements(coalesce(v.itens,'[]'::jsonb)) x);
