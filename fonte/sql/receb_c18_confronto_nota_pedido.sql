-- ============================================================
-- C18 — CONFRONTAR A NOTA FISCAL COM O PEDIDO DE COMPRA
--
-- Até hoje o portal LIGAVA a nota ao pedido (pelo número que o fornecedor
-- escreve na NF-e) mas não CONFERIA nada. Nota com 200 caixas para um pedido
-- que espera 60 passava calada. Produto que nem está no pedido, idem. Preço
-- acima do combinado, idem. Tudo isso só aparecia na doca, com o caminhão
-- parado e o motorista esperando.
--
-- Esta função faz a mesma conferência que o recebimento faz na descarga —
-- só que dias antes, enquanto o caminhão ainda está no pátio do fornecedor.
--
-- A PONTE É O CÓDIGO DE BARRAS. Na nota vem o código DO FORNECEDOR; no pedido,
-- o código DA LOJA. Os dois nunca batem. O EAN é o mesmo dos dois lados — por
-- isso o robô passou a trazer `codigobarras` junto com cada item do pedido.
--
-- O QUE NÃO FAZ, DE PROPÓSITO:
--   · não converte unidade. Se a nota está em caixa e o pedido em unidade, ela
--     DIZ que as unidades diferem em vez de multiplicar por um número chutado.
--     Multiplicar errado é pior que não multiplicar.
--   · não reclama de quantidade MENOR que o saldo: entrega parcial é normal.
--   · não reclama de preço MENOR: fornecedor cobrando menos não é problema da loja.
--
-- Pode rodar mais de uma vez sem estragar nada.
-- ============================================================


-- ============================================================
-- 1) O CÓDIGO DE BARRAS, SEMPRE DO MESMO JEITO
--
-- Mesma peneira dos dois lados. No VR ele é NUMERIC e chega sem os zeros da
-- frente; na nota vem texto e às vezes com zeros. Sem passar os dois pela
-- mesma régua, "07891..." e "7891..." seriam produtos diferentes.
--
-- NÃO completo com zeros até 13: EAN-8 existe e é legítimo (produto pequeno).
-- Completar quebraria justamente esses.
-- ============================================================
create or replace function public.receb_ean(p_v text)
returns text language sql immutable as $$
  select nullif(regexp_replace(regexp_replace(coalesce(p_v, ''), '[^0-9]', '', 'g'), '^0+', ''), '');
$$;


-- ============================================================
-- 2) A CONFERÊNCIA
--
-- p_pedidos : os NÚMEROS dos pedidos que o fornecedor marcou
-- p_itens   : os itens da nota, como o portal leu do XML —
--             [{ean, codigo, descricao, qtd, valor_unit, unidade, item_pedido}]
--
-- Casa cada item da nota com uma linha do pedido, nesta ordem:
--   1. pelo nItemPed da nota (o fornecedor apontou a linha exata) — quando vem
--   2. pelo código de barras
--   3. não achou → o item não está no pedido
-- ============================================================
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
begin
  v_forn := public.forn_meu_id();
  if v_forn is null then
    return jsonb_build_object('ok', false, 'erro', 'Faça login novamente.');
  end if;

  -- sem pedido marcado ou sem nota lida, não há o que conferir. Não é erro.
  if p_pedidos is null or array_length(p_pedidos, 1) is null
     or p_itens is null or jsonb_array_length(p_itens) = 0 then
    return jsonb_build_object('ok', true, 'conferido', false, 'motivo', 'sem_dados');
  end if;

  -- SÓ os pedidos DELE. Sem esta linha, mandar o número de um pedido alheio
  -- devolveria o que a loja comprou de outro fornecedor e por quanto.
  select array_agg(p.id) into v_ped_ids
    from public.receb_pedidos p
   where p.fornecedor_id = v_forn
     and p.numero = any(p_pedidos);

  if v_ped_ids is null then
    return jsonb_build_object('ok', true, 'conferido', false, 'motivo', 'pedido_nao_e_seu');
  end if;

  for v_it in select * from jsonb_array_elements(p_itens) loop
    v_ean := public.receb_ean(v_it->>'ean');
    v_qtd := coalesce((v_it->>'qtd')::numeric, 0);
    v_vun := coalesce((v_it->>'valor_unit')::numeric, 0);
    v_seq := nullif(regexp_replace(coalesce(v_it->>'item_pedido', ''), '[^0-9]', '', 'g'), '')::int;
    v_num := nullif(trim(coalesce(v_it->>'pedido', '')), '');
    v_achou := false;

    -- 1) o fornecedor apontou a linha do pedido dentro da própria nota.
    -- O número do pedido entra na conta: sem ele, "item 3" de um pedido
    -- casaria com o "item 3" de outro, e a conferência mentiria com cara de
    -- certeza — pior que não conferir.
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

    -- 2) pelo código de barras
    if not v_achou and v_ean is not null then
      select i.*, p.numero as ped_numero into v_lin
        from public.receb_pedido_itens i
        join public.receb_pedidos p on p.id = i.pedido_id
       where i.pedido_id = any(v_ped_ids)
         and public.receb_ean(i.ean) = v_ean
       limit 1;
      v_achou := found;
    end if;

    if not v_achou then
      v_sit := 'fora';
      v_motivo := 'Este item não está no pedido.';
      v_fora := v_fora + 1;
    elsif v_qtd > coalesce(v_lin.saldo, 0) then
      v_sit := 'acima';
      v_motivo := 'A nota traz mais do que o pedido ainda espera.';
      v_acima := v_acima + 1;
      v_usados := v_usados || v_lin.id;
    -- meio centavo de folga: preço do VR e da nota se arredondam diferente,
    -- e acusar divergência de arredondamento faria ninguém mais ler os avisos
    elsif v_vun > coalesce(v_lin.valor_unit, 0) + 0.005 and coalesce(v_lin.valor_unit,0) > 0 then
      v_sit := 'preco';
      v_motivo := 'O preço da nota está acima do preço do pedido.';
      v_preco := v_preco + 1;
      v_usados := v_usados || v_lin.id;
    else
      v_sit := 'ok';
      v_motivo := null;
      v_ok := v_ok + 1;
      v_usados := v_usados || v_lin.id;
    end if;

    -- O v_lin NÃO é limpo entre uma volta e outra: em plpgsql, record guarda o
    -- que sobrou da linha anterior. Se eu lesse v_lin.saldo num item que não
    -- está no pedido, a tela mostraria o saldo de OUTRO produto — e ninguém
    -- desconfiaria, porque o número pareceria legítimo. (No primeiro item da
    -- nota seria pior ainda: erro seco, o record nunca foi preenchido.)
    -- Por isso o achado e o não-achado montam a linha por caminhos separados.
    if v_achou then
      v_linhas := v_linhas || jsonb_build_object(
        'descricao',    coalesce(nullif(trim(v_it->>'descricao'), ''), v_lin.descricao, 'Item sem descrição'),
        'ean',          v_ean,
        'unidade',      nullif(trim(coalesce(v_it->>'unidade','')), ''),
        'qtd_nota',     v_qtd,
        'saldo',        v_lin.saldo,
        'valor_nota',   v_vun,
        'valor_pedido', v_lin.valor_unit,
        'pedido',       v_lin.ped_numero,
        'situacao',     v_sit,
        'motivo',       v_motivo);
    else
      v_linhas := v_linhas || jsonb_build_object(
        'descricao',    coalesce(nullif(trim(v_it->>'descricao'), ''), 'Item sem descrição'),
        'ean',          v_ean,
        'unidade',      nullif(trim(coalesce(v_it->>'unidade','')), ''),
        'qtd_nota',     v_qtd,
        'saldo',        null,
        'valor_nota',   v_vun,
        'valor_pedido', null,
        'pedido',       null,
        'situacao',     v_sit,
        'motivo',       v_motivo);
    end if;
  end loop;

  -- itens do pedido que a nota NÃO cobre. Não é erro — entrega parcial é o
  -- normal. Serve só para o fornecedor conferir se não esqueceu nada.
  select count(*) into v_falta
    from public.receb_pedido_itens i
   where i.pedido_id = any(v_ped_ids)
     and coalesce(i.saldo, 0) > 0
     and not (i.id = any(v_usados));

  return jsonb_build_object(
    'ok', true,
    'conferido', true,
    'resumo', jsonb_build_object(
      'itens',    jsonb_array_length(p_itens),
      'ok',       v_ok,
      'acima',    v_acima,
      'fora',     v_fora,
      'preco',    v_preco,
      'faltando', v_falta,
      -- quantos merecem olho. Zero = pode mandar o caminhão.
      'problemas', v_acima + v_fora + v_preco),
    'linhas', v_linhas);
end;
$$;


-- ============================================================
-- 3) QUEM PODE CHAMAR
-- ============================================================
revoke all on function public.receb_ean(text)                     from public, anon;
revoke all on function public.forn_conferir_nota(text[], jsonb)   from public, anon;
grant execute on function public.receb_ean(text)                   to authenticated;
grant execute on function public.forn_conferir_nota(text[], jsonb) to authenticated;


-- ============================================================
-- 4) CONFERÊNCIA
-- ============================================================
select 'o EAN se reconhece escrito de jeitos diferentes' as conferir,
       public.receb_ean('07896063281967') as com_zero,
       public.receb_ean('7896063281967')  as sem_zero,
       public.receb_ean('7896063281967') = public.receb_ean('07896063281967') as sao_o_mesmo,
       public.receb_ean('SEM GTIN')       as sem_gtin;

select 'as duas funcoes existem' as conferir, count(*) as quantas
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('receb_ean', 'forn_conferir_nota');

select 'anonimo NAO pode chamar' as conferir,
       has_function_privilege('anon', 'public.forn_conferir_nota(text[],jsonb)', 'execute') as anon_conferir;

select 'quantos itens de pedido ja tem codigo de barras' as conferir,
       count(*) as total,
       count(*) filter (where ean is not null) as com_ean
  from public.receb_pedido_itens;
