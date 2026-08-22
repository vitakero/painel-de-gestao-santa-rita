-- ============================================================
-- C14 — OS PEDIDOS DE COMPRA CHEGAM AO FORNECEDOR
--
-- Em 16/08/2026 os pedidos do VR passaram a ser sincronizados para
-- receb_pedidos / receb_pedido_itens (319 pedidos, 6.044 itens). Este arquivo
-- é o que faz o fornecedor enxergar os DELE.
--
-- O que muda:
--   1) forn_pedidos passa a devolver ITENS PARA ENTREGA (o saldo), que é a
--      coluna que importa: "17 itens no pedido, 3 para entrega".
--   2) nasce forn_pedido_itens, para abrir um pedido e ver o que falta.
--   3) forn_pedidos passa a dizer POR QUE a lista está vazia. Antes só existia
--      "ligado sim/não", e a tela usava isso para escrever "estamos trabalhando
--      para trazer os pedidos" — frase que virou mentira no dia em que os
--      pedidos chegaram. Sem saber a diferença entre "não trouxemos ainda" e
--      "não há pedido SEU em aberto", a tela mente para quem não tem pedido.
--
-- Segurança: as duas funções começam em forn_meu_id() e filtram por
-- fornecedor_id. Um fornecedor não alcança pedido de outro nem sabendo o id —
-- forn_pedido_itens confere o dono antes de devolver qualquer linha.
--
-- Pode rodar mais de uma vez sem estragar nada.
-- ============================================================


-- ============================================================
-- 1) A LISTA DE PEDIDOS DO FORNECEDOR
-- ============================================================
create or replace function public.forn_pedidos()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_forn uuid; v_itens jsonb; v_tem boolean; v_meus int;
begin
  v_forn := public.forn_meu_id();
  if v_forn is null then return jsonb_build_object('ok', false); end if;

  -- "ligado" = a loja já traz pedidos para cá (existe pedido de QUALQUER um).
  -- É diferente de "este fornecedor tem pedido".
  select exists (select 1 from public.receb_pedidos limit 1) into v_tem;

  select coalesce(jsonb_agg(x order by x->>'previsao'), '[]'::jsonb), count(*)
    into v_itens, v_meus
    from (
      select jsonb_build_object(
               'id', p.id, 'numero', p.numero, 'situacao', p.situacao,
               'emissao',  to_char(p.emissao,  'DD/MM/YYYY'),
               'previsao', to_char(p.previsao, 'DD/MM/YYYY'),
               'previsao_iso', p.previsao,
               'valor', p.valor_total, 'saldo', p.saldo_valor,
               'itens', (select count(*) from public.receb_pedido_itens i
                          where i.pedido_id = p.id),
               -- É esta que o fornecedor lê: quantos itens ainda faltam.
               -- Um pedido de 51 itens com 3 pendentes não é uma entrega de 51.
               'itens_saldo', (select count(*) from public.receb_pedido_itens i
                                where i.pedido_id = p.id and coalesce(i.saldo,0) > 0)
             ) as x
        from public.receb_pedidos p
       where p.fornecedor_id = v_forn
         and exists (select 1 from public.receb_pedido_itens i
                      where i.pedido_id = p.id and coalesce(i.saldo,0) > 0)
    ) s;

  return jsonb_build_object(
    'ok', true,
    'ligado', coalesce(v_tem, false),
    'meus',   coalesce(v_meus, 0),
    -- por que a lista está vazia, para a tela não inventar explicação
    'motivo', case when not coalesce(v_tem,false) then 'sem_integracao'
                   when coalesce(v_meus,0) = 0    then 'sem_pedido_meu'
                   else 'ok' end,
    'pedidos', v_itens);
end;
$$;


-- ============================================================
-- 2) O QUE FALTA DENTRO DE UM PEDIDO
--
-- Confere o dono ANTES de devolver linha. Sem isso bastaria ter o id de um
-- pedido para ler a compra de outro fornecedor — quanto a loja comprou, de
-- quem e por quanto.
-- ============================================================
create or replace function public.forn_pedido_itens(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_forn uuid; v_dono uuid; v_itens jsonb;
begin
  v_forn := public.forn_meu_id();
  if v_forn is null then return jsonb_build_object('ok', false); end if;

  select fornecedor_id into v_dono from public.receb_pedidos where id = p_id;
  if v_dono is null or v_dono <> v_forn then
    return jsonb_build_object('ok', false, 'erro', 'Pedido não encontrado.');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'seq', i.seq, 'codigo', i.codigo, 'descricao', i.descricao,
           'unidade', i.unidade,
           'qtd_pedida', i.qtd_pedida, 'qtd_entregue', i.qtd_entregue,
           'saldo', i.saldo, 'valor_unit', i.valor_unit
         ) order by (coalesce(i.saldo,0) > 0) desc, i.seq), '[]'::jsonb)
    into v_itens
    from public.receb_pedido_itens i
   where i.pedido_id = p_id;

  return jsonb_build_object('ok', true, 'itens', v_itens);
end;
$$;


-- ============================================================
-- 3) QUEM PODE CHAMAR
-- ============================================================
revoke all on function public.forn_pedidos()          from public, anon;
revoke all on function public.forn_pedido_itens(uuid) from public, anon;
grant execute on function public.forn_pedidos()          to authenticated;
grant execute on function public.forn_pedido_itens(uuid) to authenticated;


-- ============================================================
-- 4) CONFERÊNCIA
-- ============================================================
select 'o que chegou do VR' as conferir,
       (select count(*) from public.receb_pedidos)            as pedidos,
       (select count(*) from public.receb_pedido_itens)       as itens,
       (select count(*) from public.receb_pedido_itens
         where coalesce(saldo,0) > 0)                         as itens_com_saldo,
       (select count(*) from public.receb_pedidos
         where fornecedor_id is not null)                     as ja_tem_dono;

-- Agrupa pela EXPRESSÃO, não por "1": a coluna 1 é o texto fixo do rótulo,
-- e agrupar por ela deixa o nome do fornecedor fora do group by.
select 'pedidos por fornecedor do portal' as conferir,
       coalesce(f.razao_social, '(sem cadastro no portal)') as fornecedor,
       count(*) as pedidos
  from public.receb_pedidos p
  left join public.receb_fornecedores f on f.id = p.fornecedor_id
 group by coalesce(f.razao_social, '(sem cadastro no portal)')
 order by 3 desc limit 5;

select 'anonimo NAO pode chamar' as conferir,
       has_function_privilege('anon', 'public.forn_pedidos()', 'execute')          as anon_lista,
       has_function_privilege('anon', 'public.forn_pedido_itens(uuid)', 'execute') as anon_itens;
