-- ============================================================
-- C19 — "QUAL PEDIDO É DESTA NOTA?"
--
-- O fornecedor anexa a nota e o portal manda ele vincular a um pedido. Só que
-- a janela de escolha mostrava numero, data e valor — nada que ligasse aquela
-- nota a aquele pedido. A pergunta dele foi exatamente esta: "como e que eu vou
-- saber que essa nota aqui e desse pedido?"
--
-- Esta funcao responde comparando os PRODUTOS. Recebe os itens que o portal leu
-- do XML e devolve, para cada pedido em aberto dele, quantos daqueles produtos
-- estao naquele pedido. Com isso a janela pode dizer
-- "13 dos 16 produtos desta nota estao neste pedido" e ordenar do mais provavel
-- para o menos.
--
-- A PONTE E O CODIGO DE BARRAS, o mesmo do c18: na nota vem o codigo DO
-- FORNECEDOR, no pedido o codigo DA LOJA, e os dois nunca batem.
--
-- SE O PEDIDO AINDA NAO TEM EAN (o robo enche isso), devolve comparavel=false.
-- A tela precisa saber a diferenca entre "comparei e nao casou nada" e "nao
-- tive com o que comparar" — mostrar "0 de 16" nos dois casos seria mentir no
-- segundo, e o fornecedor descartaria o pedido certo.
--
-- Pode rodar mais de uma vez sem estragar nada.
-- ============================================================

create or replace function public.forn_casar_nota_pedidos(p_itens jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_forn uuid;
  v_eans text[];
  v_total int;
  v_lista jsonb;
  v_comparavel boolean;
begin
  v_forn := public.forn_meu_id();
  if v_forn is null then
    return jsonb_build_object('ok', false, 'erro', 'Faça login novamente.');
  end if;

  -- os codigos de barras da nota, peneirados e sem repetir
  select array_agg(distinct e), count(distinct e)
    into v_eans, v_total
    from (select public.receb_ean(x->>'ean') as e
            from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) x) s
   where e is not null;

  -- Da para comparar? Só se o pedido tiver EAN do lado dele também.
  select exists (
    select 1 from public.receb_pedido_itens i
      join public.receb_pedidos p on p.id = i.pedido_id
     where p.fornecedor_id = v_forn and i.ean is not null
  ) into v_comparavel;

  select coalesce(jsonb_agg(x order by (x->>'casaram')::int desc, x->>'previsao'), '[]'::jsonb)
    into v_lista
    from (
      select jsonb_build_object(
               'numero',    p.numero,
               'previsao',  p.previsao,
               -- quantos produtos DA NOTA estao neste pedido
               'casaram',   (select count(distinct public.receb_ean(i.ean))
                               from public.receb_pedido_itens i
                              where i.pedido_id = p.id
                                and i.ean is not null
                                and v_eans is not null
                                and public.receb_ean(i.ean) = any(v_eans)),
               -- e quantos daqueles ainda estao pendentes de entrega
               'casaram_pendentes', (select count(distinct public.receb_ean(i.ean))
                               from public.receb_pedido_itens i
                              where i.pedido_id = p.id
                                and i.ean is not null
                                and coalesce(i.saldo,0) > 0
                                and v_eans is not null
                                and public.receb_ean(i.ean) = any(v_eans)),
               'tem_ean',   exists (select 1 from public.receb_pedido_itens i
                                     where i.pedido_id = p.id and i.ean is not null)
             ) as x
        from public.receb_pedidos p
       where p.fornecedor_id = v_forn
         and exists (select 1 from public.receb_pedido_itens i
                      where i.pedido_id = p.id and coalesce(i.saldo,0) > 0)
    ) s;

  return jsonb_build_object(
    'ok', true,
    'comparavel', coalesce(v_comparavel, false),
    'itens_nota', coalesce(v_total, 0),
    'pedidos', v_lista);
end;
$$;

revoke all on function public.forn_casar_nota_pedidos(jsonb) from public, anon;
grant execute on function public.forn_casar_nota_pedidos(jsonb) to authenticated;


-- ============================================================
-- CONFERÊNCIA
-- ============================================================
select 'a funcao existe' as conferir, count(*) as quantas
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'forn_casar_nota_pedidos';

select 'anonimo NAO pode chamar' as conferir,
       has_function_privilege('anon','public.forn_casar_nota_pedidos(jsonb)','execute') as anon_casar;

select 'da para comparar hoje?' as conferir,
       count(*) as itens_de_pedido,
       count(*) filter (where ean is not null) as com_codigo_de_barras
  from public.receb_pedido_itens;
