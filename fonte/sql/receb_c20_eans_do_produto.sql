-- ============================================================
-- C20 — UM PRODUTO TEM VÁRIOS CÓDIGOS DE BARRAS
--
-- O c18 e o c19 casam nota com pedido pelo EAN, e a coluna `ean` guardava UM
-- código por item. Só que no VR o código não fica no produto: fica em
-- `produtoautomacao`, e cada produto tem vários — o da unidade, o da caixa, o
-- do fardo.
--
-- Com um código só, a nota que declara o EAN da CAIXA não casaria com o pedido
-- que guardou o da UNIDADE. A comparação acharia zero produtos e a tela diria
-- "nenhum produto desta nota está neste pedido" — com cara de resposta, quando
-- na verdade era a pergunta errada. Pior que não comparar.
--
-- Agora o item guarda TODOS (`eans`) e a comparação casa com qualquer um deles.
-- A coluna `ean` continua existindo com o da menor embalagem, que é o que
-- aparece na tela quando precisa mostrar um.
--
-- Pode rodar mais de uma vez sem estragar nada.
-- ============================================================

alter table public.receb_pedido_itens
  add column if not exists eans text[];

comment on column public.receb_pedido_itens.eans is
  'Todos os códigos de barras do produto (unidade, caixa, fardo), vindos de produtoautomacao no VR. A comparação com a nota casa com qualquer um deles.';

create index if not exists ix_receb_pedido_itens_eans
  on public.receb_pedido_itens using gin (eans);


-- ============================================================
-- A CONFERÊNCIA (c18) PASSA A OLHAR TODOS OS CÓDIGOS
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

  if p_pedidos is null or array_length(p_pedidos, 1) is null
     or p_itens is null or jsonb_array_length(p_itens) = 0 then
    return jsonb_build_object('ok', true, 'conferido', false, 'motivo', 'sem_dados');
  end if;

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

    -- QUALQUER um dos códigos do produto serve. Antes era só i.ean, o da
    -- unidade: nota em caixa não casava com pedido em unidade.
    if not v_achou and v_ean is not null then
      select i.*, p.numero as ped_numero into v_lin
        from public.receb_pedido_itens i
        join public.receb_pedidos p on p.id = i.pedido_id
       where i.pedido_id = any(v_ped_ids)
         and (v_ean = any(coalesce(i.eans, array[]::text[]))
              or public.receb_ean(i.ean) = v_ean)
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

    if v_achou then
      v_linhas := v_linhas || jsonb_build_object(
        'descricao',    coalesce(nullif(trim(v_it->>'descricao'), ''), v_lin.descricao, 'Item sem descrição'),
        'ean',          v_ean, 'unidade', nullif(trim(coalesce(v_it->>'unidade','')), ''),
        'qtd_nota',     v_qtd, 'saldo', v_lin.saldo,
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
      'itens', jsonb_array_length(p_itens), 'ok', v_ok, 'acima', v_acima,
      'fora', v_fora, 'preco', v_preco, 'faltando', v_falta,
      'problemas', v_acima + v_fora + v_preco),
    'linhas', v_linhas);
end;
$$;


-- ============================================================
-- "QUAL PEDIDO É DESTA NOTA?" (c19) IDEM
-- ============================================================
create or replace function public.forn_casar_nota_pedidos(p_itens jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_forn uuid; v_eans text[]; v_total int; v_lista jsonb; v_comparavel boolean;
begin
  v_forn := public.forn_meu_id();
  if v_forn is null then
    return jsonb_build_object('ok', false, 'erro', 'Faça login novamente.');
  end if;

  select array_agg(distinct e), count(distinct e)
    into v_eans, v_total
    from (select public.receb_ean(x->>'ean') as e
            from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) x) s
   where e is not null;

  select exists (
    select 1 from public.receb_pedido_itens i
      join public.receb_pedidos p on p.id = i.pedido_id
     where p.fornecedor_id = v_forn
       and (i.eans is not null or i.ean is not null)
  ) into v_comparavel;

  select coalesce(jsonb_agg(x order by (x->>'casaram')::int desc, x->>'previsao'), '[]'::jsonb)
    into v_lista
    from (
      select jsonb_build_object(
               'numero', p.numero, 'previsao', p.previsao,
               'casaram', (select count(*) from public.receb_pedido_itens i
                            where i.pedido_id = p.id and v_eans is not null
                              and (i.eans && v_eans or public.receb_ean(i.ean) = any(v_eans))),
               'casaram_pendentes', (select count(*) from public.receb_pedido_itens i
                            where i.pedido_id = p.id and coalesce(i.saldo,0) > 0 and v_eans is not null
                              and (i.eans && v_eans or public.receb_ean(i.ean) = any(v_eans))),
               'tem_ean', exists (select 1 from public.receb_pedido_itens i
                                   where i.pedido_id = p.id and (i.eans is not null or i.ean is not null))
             ) as x
        from public.receb_pedidos p
       where p.fornecedor_id = v_forn
         and exists (select 1 from public.receb_pedido_itens i
                      where i.pedido_id = p.id and coalesce(i.saldo,0) > 0)
    ) s;

  return jsonb_build_object('ok', true, 'comparavel', coalesce(v_comparavel, false),
                            'itens_nota', coalesce(v_total, 0), 'pedidos', v_lista);
end;
$$;


-- ============================================================
-- CONFERÊNCIA
-- ============================================================
select 'a coluna eans existe' as conferir, count(*) as quantas
  from information_schema.columns
 where table_schema='public' and table_name='receb_pedido_itens' and column_name='eans';

select 'quantos itens ja tem codigo de barras' as conferir,
       count(*) as total,
       count(*) filter (where eans is not null) as com_eans
  from public.receb_pedido_itens;
