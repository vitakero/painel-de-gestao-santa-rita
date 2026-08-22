-- ============================================================================
-- O DICIONARIO DO CODIGO DO FORNECEDOR
--
-- Medido em 3.480 notas reais (27.584 itens), em 21/08/2026:
--     6.408 itens (23,2%) nao tinham NENHUM jeito de casar com o pedido — a nota nao
--     traz codigo de barras nem a linha do pedido. Sao produtores locais: laticinio,
--     frango, laranja, bolo de padaria. Quem fabrica em pequena escala nao registra
--     codigo de barras GS1, que e pago e anual. Nao adianta cobrar deles.
--
-- A saida estava dentro do proprio VR, ha anos: a tabela produtofornecedor guarda
--     produto da loja  x  fornecedor  x  codigo que AQUELE fornecedor usa
-- Sao 27.741 equivalencias, mais 2.104 codigos alternativos. Toda vez que alguem
-- lancou uma nota daquele fornecedor, essa equivalencia foi ensinada ao sistema.
--
-- Com o dicionario, o ponto cego cai de 23,2% para 1,4%: medido, 94% dos itens cegos
-- usam um codigo que ja apareceu em outra nota. O que sobra e produto genuinamente
-- novo — e esse tem que ir para a conferencia na chegada mesmo.
--
-- ORDEM DE CASAMENTO, do mais firme para o mais frouxo:
--     1. a linha do pedido escrita dentro da nota (nItemPed)
--     2. o codigo de barras
--     3. o dicionario (fornecedor + codigo dele)
--
-- E a diferenca que importa continua valendo: se NENHUM dos tres serve, o item fica
-- 'indefinido' — duvida, nao acusacao. Nao barra ninguem.
--
-- Rodar no SQL Editor do Supabase. Pode rodar mais de uma vez sem estragar nada.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) O DICIONARIO
--
-- Guardo o CNPJ do fornecedor, e nao o codigo interno do VR: o portal conhece quem
-- fez login pelo CNPJ, e assim a nuvem nao precisa saber a numeracao interna do VR.
-- O robo ja faz essa juncao antes de mandar.
--
-- O codigo vem sempre em MAIUSCULA, normalizado pelo robo. Sem isso, "ab12" e "AB12"
-- viram duas linhas e a nota casa com uma ou com nenhuma, dependendo de como o
-- fornecedor digitou naquele dia.
-- ----------------------------------------------------------------------------
create table if not exists public.receb_codigos_fornecedor (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null default public.current_tenant(),
  fornecedor_cnpj   text not null,
  fornecedor_nome   text,
  codigo_fornecedor text not null,          -- em MAIUSCULA
  produto_vr        text not null,          -- o id_produto do VR: casa com receb_pedido_itens.produto_vr
  qtd_embalagem     numeric,                -- nota em CAIXA x pedido em UNIDADE
  fator_embalagem   numeric,
  sincronizado_em   timestamptz not null default now()
);

create unique index if not exists ux_receb_cod_forn
  on public.receb_codigos_fornecedor (tenant_id, fornecedor_cnpj, codigo_fornecedor);
create index if not exists ix_receb_cod_produto
  on public.receb_codigos_fornecedor (tenant_id, produto_vr);

comment on table public.receb_codigos_fornecedor is
  'De-para: o codigo que cada fornecedor usa x o produto do cadastro da loja. Vem da '
  'produtofornecedor do VR. E o que permite conferir item de nota sem codigo de barras.';

-- ----------------------------------------------------------------------------
-- 2) QUEM PODE VER
--
-- A loja le. O FORNECEDOR NAO: esta tabela tem o codigo interno de TODOS os
-- fornecedores, e cruzar isso com preco entrega a lista de quem fornece o que.
-- A conferencia usa a tabela por dentro, com poder proprio — o fornecedor recebe so
-- o resultado da conferencia DELE.
-- Sem policy de escrita: quem grava e o robo, com a chave de servico.
-- ----------------------------------------------------------------------------
alter table public.receb_codigos_fornecedor enable row level security;

drop policy if exists rcf_sel on public.receb_codigos_fornecedor;
create policy rcf_sel on public.receb_codigos_fornecedor
  for select to authenticated
  using (tenant_id = public.current_tenant()
         and (public.sou_master() or public.pode_pagina('central')));

-- ----------------------------------------------------------------------------
-- 3) A CONFERENCIA APRENDE O TERCEIRO JEITO DE CASAR
-- ----------------------------------------------------------------------------
create or replace function public.forn_conferir_nota(p_pedidos text[], p_itens jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_forn uuid; v_cnpj text;
  v_linhas jsonb := '[]'::jsonb;
  v_it jsonb;
  v_ean text; v_qtd numeric; v_vun numeric; v_seq int; v_num text;
  v_cod text; v_prod_vr text;
  v_lin record; v_achou boolean;
  v_sit text; v_motivo text;
  v_ok int := 0; v_acima int := 0; v_fora int := 0; v_preco int := 0;
  v_indef int := 0; v_pelo_dic int := 0;
  v_usados uuid[] := '{}';
  v_falta int := 0;
  v_ped_ids uuid[];
  v_gasto jsonb := '{}'::jsonb;
  v_saldo numeric;
  v_tinha_como boolean;
begin
  v_forn := public.forn_meu_id();
  if v_forn is null then
    return jsonb_build_object('ok', false, 'erro', 'Faça login novamente.');
  end if;

  select regexp_replace(coalesce(cnpj,''), '[^0-9]', '', 'g') into v_cnpj
    from public.receb_fornecedores where id = v_forn;

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
    v_cod := nullif(trim(coalesce(v_it->>'codigo', '')), '');
    v_achou := false;
    v_prod_vr := null;

    -- O DICIONARIO. Consulto ANTES de decidir se este item tinha como ser casado:
    -- se o dicionario conhece o codigo, eu sei qual produto e — e ai "nao esta no
    -- pedido" passa a ser uma afirmacao legitima. Se nao conhece, continua duvida.
    if v_cod is not null and v_cnpj is not null then
      select d.produto_vr into v_prod_vr
        from public.receb_codigos_fornecedor d
       where d.tenant_id = public.current_tenant()
         and d.fornecedor_cnpj = v_cnpj
         and d.codigo_fornecedor = upper(v_cod)
       limit 1;
    end if;

    v_tinha_como := (v_seq is not null) or (v_ean is not null) or (v_prod_vr is not null);

    -- 1) a linha do pedido escrita dentro da nota
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

    -- 2) o codigo de barras. Qualquer um dos codigos do produto serve: nota em caixa
    --    tem que casar com pedido em unidade. Entre linhas iguais, prefiro a que
    --    ainda tem saldo de pe.
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

    -- 3) o dicionario do VR
    if not v_achou and v_prod_vr is not null then
      select i.*, p.numero as ped_numero into v_lin
        from public.receb_pedido_itens i
        join public.receb_pedidos p on p.id = i.pedido_id
       where i.pedido_id = any(v_ped_ids)
         and i.produto_vr = v_prod_vr
       order by (coalesce(i.saldo,0) - coalesce((v_gasto->>(i.id::text))::numeric, 0)) desc
       limit 1;
      v_achou := found;
      if v_achou then v_pelo_dic := v_pelo_dic + 1; end if;
    end if;

    if v_achou then
      v_saldo := coalesce(v_lin.saldo, 0) - coalesce((v_gasto->>(v_lin.id::text))::numeric, 0);
      if v_saldo < 0 then v_saldo := 0; end if;
    end if;

    if not v_achou and not v_tinha_como then
      -- NAO E ACUSACAO, E DUVIDA. Nem codigo de barras, nem linha do pedido, nem o
      -- dicionario conhece o codigo. Nao ha por onde afirmar nada.
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
      -- 'indefinido' fica FORA de 'problemas': nao e falha do fornecedor, e falta de
      -- informacao na nota.
      'indefinido', v_indef,
      -- quantos so casaram por causa do dicionario. E a medida do ganho.
      'pelo_dicionario', v_pelo_dic,
      'problemas', v_acima + v_fora + v_preco),
    'linhas', v_linhas);
end;
$$;

revoke all on function public.forn_conferir_nota(text[], jsonb) from public, anon;
grant execute on function public.forn_conferir_nota(text[], jsonb) to authenticated;

commit;

-- ----------------------------------------------------------------------------
-- 4) CONFERENCIA
-- ----------------------------------------------------------------------------
select 'o dicionario existe' as o_que,
       (select count(*)::text from information_schema.tables
         where table_schema='public' and table_name='receb_codigos_fornecedor') as resultado
union all
select 'esta trancado (RLS ligada)',
       (select case when relrowsecurity then 'sim' else 'NAO - me avise' end
          from pg_class where oid='public.receb_codigos_fornecedor'::regclass)
union all
select 'so leitura, nenhuma policy de escrita',
       (select count(*)::text from pg_policies
         where schemaname='public' and tablename='receb_codigos_fornecedor')
union all
select 'a conferencia usa o dicionario',
       (select case when prosrc like '%receb_codigos_fornecedor%' then 'sim' else 'NAO - me avise' end
          from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' and p.proname='forn_conferir_nota')
union all
select 'duvida continua separada de acusacao',
       (select case when prosrc like '%indefinido%' then 'sim' else 'NAO - me avise' end
          from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' and p.proname='forn_conferir_nota')
union all
select 'equivalencias ja na nuvem',
       (select count(*)::text from public.receb_codigos_fornecedor);
