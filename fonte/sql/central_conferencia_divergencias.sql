-- ============================================================
-- CENTRAL LOGÍSTICA — DETALHE DA DIVERGÊNCIA
--
-- Rode DEPOIS de sql/central_conferencia.sql. Aditivo e idempotente.
--
-- POR QUÊ
--   A tela mostrava só o NÚMERO: "8 com divergência". Só que 8 divergências podem ser
--   8 produtos que não vieram — ou 8 arredondamentos de um décimo de milésimo de centavo.
--   São coisas opostas somadas na mesma conta.
--
--   Levantamento de 30 dias na loja: 3.714 "custo anterior" (ruído de arredondamento),
--   2.520 "NÃO ENTREGUE" (mercadoria comprada que não chegou), 823 "custo", 374 "coletor",
--   304 "quantidade", 231 "sem pedido". Metade do número é ruído; a outra metade é dinheiro.
--
-- O QUE ISTO GUARDA
--   Por conferência: a contagem POR TIPO e a lista dos itens que divergiram — produto,
--   quanto foi pedido, quanto veio, o custo do pedido e o da nota.
--
--   Fica em jsonb na própria linha da conferência: é sempre lido junto com ela, nunca
--   sozinho, e uma tabela nova só para isso traria RLS, índice e sincronização a mais
--   sem nenhum ganho.
--
-- IMPORTANTE — o que este dado NÃO diz
--   O VR **não registra** se a divergência foi resolvida. A tabela de divergência guarda
--   só o que divergiu; o módulo de workflow que teria "liberado/rejeitado/visto" existe
--   e está VAZIO (zero linhas — a loja não usa). Então nota finalizada com divergência
--   significa "a entrada foi concluída assim", e não "foi corrigido".
--   Não inventar rótulo de resolvido na tela.
--
-- DESFAZER:
--   alter table public.central_conferencias drop column if exists divergencia_detalhe;
-- ============================================================

begin;

alter table public.central_conferencias
  add column if not exists divergencia_detalhe jsonb;

comment on column public.central_conferencias.divergencia_detalhe is
  'Divergências daquele carro: {tipos:[{tipo,qtd}], itens:[{tipo,produto,pedido,veio,custo_pedido,custo_nota}]}. '
  'Só o que divergiu — o VR não guarda se foi tratado.';

commit;

select 'coluna de detalhe' as o_que,
       case when exists (select 1 from information_schema.columns
                          where table_schema='public' and table_name='central_conferencias'
                            and column_name='divergencia_detalhe')
            then 'criada' else 'FALTOU' end as valor;
