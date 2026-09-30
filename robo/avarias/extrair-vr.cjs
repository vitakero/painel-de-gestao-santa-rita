// ==AVR-EXTRAIR== AVARIAS · a extração do VR para o robô do piloto (etapa 3,6). SÓ LEITURA.
//
//   const { extrair } = require("./extrair-vr.cjs");
//   await extrair(pasta, { agoraMs, vendaCache, log })  -> { manifesto, R, vendaCache, tempos }
//
// UMA passada só leitura (vr.cjs: BEGIN READ ONLY ... ROLLBACK, recusa tudo que não é SELECT/WITH) que escreve numa pasta
// os MESMOS arquivos que a extração aprovada de 28/09/2026 (.previa/avarias/dados/2026-09-28) tem, com os mesmos nomes e o
// mesmo formato, porque é isso que o cálculo aprovado lê (montar-copias, etapa1, documentos, apoio-copias):
//
//   <pasta>/troca.json ... usuarios.json   as 13 FONTES de .previa/avarias/codigo/extrair.cjs (consultas copiadas sem mudar)
//   <pasta>/manifesto.json                 contagens + a hora do corte (hora de Caicó calculada AQUI, não no VR)
//   <pasta>/documentos_meta.json           de .previa/avarias/codigo/extrair-documentos.cjs (consultas copiadas)
//   <pasta>/documentos_parcelas.json       parcelas a pagar das notas de entrada citadas. Não havia código: foi feito à mão
//                                          numa sessão. A consulta daqui foi REESCRITA a partir do conteúdo e reproduz as
//                                          104 linhas de 28/09 sem nenhuma diferença (medido em 29/09).
//   <pasta>/conferencia.json               saída do etapa1.rodar sobre a própria pasta (documentos.cjs lê a lista de corrigidas)
//   <pasta>/descobertas/doc_saida.json     a leitura dos textos (regra de doc_regra.cjs = ler-documento.cjs, a aprovada)
//   <pasta>/descobertas/boleto_leitura_desde2023.json   a consulta boleto_leitura_desde2023.sql (copiada sem mudar)
//   <pasta>/descobertas/venda_custo_setor_mes.json      venda a preço e a custo por mês × setor (reescrita, reproduz 508 de 508
//   <pasta>/descobertas/venda_sem_custo.json            linhas dos meses fechados) e a parte vendida sem custo (208 de 208)
//
// A VENDA NUNCA TRAZ O DIA CORRENTE: só dias FECHADOS (data < hoje de Caicó). O servidor do VR está em GMT: nenhuma
// consulta daqui usa current_date nem now(); "hoje" é calculado no JS (UTC−3, sem horário de verão desde 2019) e vai
// como parâmetro. O mês em curso continua marcado (inclui_dia_corrente, em apoio-copias) e fica fora da conta
// "avaria ÷ venda", como a regra aprovada manda.
//
// A VENDA É A ÚNICA CONSULTA PESADA (~30 a 50 s para os 35 meses, medido em 29/09). Por isso ela é guardada num cache
// local por dia (output/avarias-venda.json): a 1ª rodada do dia refaz só o mês passado e o mês em curso (os dias que
// fecharam); as outras rodadas do dia reaproveitam. A cada 7 dias (ou sem cache) a venda inteira é refeita, para pegar
// alguma correção antiga do VR. O cache só é aceito se cobrir exatamente o que foi pedido.
"use strict";
const fs = require("fs");
const path = require("path");
const { comVR } = require("./vr.cjs");
const { leTexto, normaliza } = require("./ler-documento.cjs");

// ---------------------------------------------------------------- as 13 fontes (cópia EXATA de .previa/avarias/codigo/extrair.cjs)
const PRODUTOS_TROCA = "(SELECT DISTINCT id_produto FROM logtroca WHERE id_loja = 1)";
const NOTAS_TROCA = "(SELECT id FROM notasaida WHERE id_loja = 1 AND tipolocalbaixa = 1)";

const FONTES = {
  troca: `SELECT id, id_produto, quantidade::text AS qtd, datahora::text AS datahora, datamovimento::text AS data,
            id_tipoentradasaida AS tipo, id_motivotroca AS motivo, coalesce(observacaotroca,'') AS obs,
            custocomimposto::text AS custo, estoqueanterior::text AS antes, estoqueatual::text AS depois, id_usuario AS usuario
          FROM logtroca WHERE id_loja = 1 ORDER BY id_produto, datahora, id`,
  saldo: `SELECT id_produto, troca::text AS saldo, custocomimposto::text AS custo_hoje
          FROM produtocomplemento WHERE id_loja = 1 AND id_produto IN ${PRODUTOS_TROCA}`,
  produtos: `SELECT p.id, p.descricaocompleta AS nome, p.mercadologico1 AS setor_id, p.mercadologico2 AS grupo_id,
               coalesce(m.descricao,'?') AS setor
             FROM produto p LEFT JOIN mercadologico m ON m.nivel = 1 AND m.mercadologico1 = p.mercadologico1
             WHERE p.id IN ${PRODUTOS_TROCA}
                OR p.id IN (SELECT id_produto FROM perda WHERE id_loja = 1 AND upper(observacao) LIKE '%AVARIA%')`,
  custos: `SELECT id, id_produto, datahora::text AS datahora, datamovimento::text AS data,
             custocomimposto::text AS custo, custocomimpostoanterior::text AS anterior
           FROM logcusto WHERE id_loja = 1 AND id_produto IN ${PRODUTOS_TROCA} ORDER BY id_produto, datahora, id`,
  notas: `SELECT n.id, n.numeronota AS numero, n.serie, n.datasaida::text AS data, n.id_tiposaida AS tipo_id,
            ts.descricao AS tipo, n.id_situacaonfe AS nfe, n.id_fornecedordestinatario AS fornecedor,
            n.valortotal::text AS valor, coalesce(n.informacaocomplementar,'') AS texto
          FROM notasaida n JOIN tiposaida ts ON ts.id = n.id_tiposaida
          WHERE n.id_loja = 1 AND n.tipolocalbaixa = 1`,
  itens: `SELECT i.id, i.id_notasaida AS nota_id, i.id_produto, i.quantidade::text AS qtd, i.qtdembalagem::text AS embalagem,
            i.valor::text AS valor, i.valortotal::text AS valor_total
          FROM notasaidaitem i WHERE i.id_notasaida IN ${NOTAS_TROCA}`,
  titulos: `SELECT r.id, r.id_notasaida AS nota_id, r.id_fornecedor AS fornecedor, r.numeronota AS numero,
              r.dataemissao::text AS emissao, r.datavencimento::text AS vencimento, r.valor::text AS valor,
              coalesce(r.valorabatimento,0)::text AS abatimento, r.id_situacaoreceberdevolucao AS situacao,
              r.id_tipodevolucao AS tipo_devolucao, r.id_boleto AS boleto, coalesce(r.observacao,'') AS obs
            FROM receberdevolucao r WHERE r.id_notasaida IN ${NOTAS_TROCA}`,
  perdas: `SELECT id, id_produto, data::text AS data, quantidade::text AS qtd, custocomimposto::text AS custo,
             id_tipomotivoperda AS motivo, coalesce(observacao,'') AS obs, id_notasaida AS nota_id
           FROM perda WHERE id_loja = 1 AND (upper(observacao) LIKE '%AVARIA%' OR upper(observacao) LIKE 'EXPORTACAO TROCA%')`,
  motivos_troca: `SELECT id, descricao, id_situacaocadastro AS situacao FROM tipomotivotroca`,
  motivos_perda: `SELECT id, descricao, id_situacaocadastro AS situacao FROM tipomotivoperda`,
  compras: `SELECT nei.id_produto, ne.id AS nota_id, ne.dataentrada::text AS data, ne.id_fornecedor AS fornecedor,
              ne.id_tipoentrada AS tipo_entrada
            FROM notaentradaitem nei JOIN notaentrada ne ON ne.id = nei.id_notaentrada
            WHERE ne.id_loja = 1 AND ne.id_situacaonotaentrada = 1 AND nei.id_produto IN ${PRODUTOS_TROCA}`,
  fornecedores: `SELECT id, razaosocial AS nome, cnpj::text AS cnpj FROM fornecedor`,
  usuarios: `SELECT id, login FROM usuario`,
};

// ---------------------------------------------------------------- leitura dos textos (a parte de execução de doc_regra.cjs)
// As 4 consultas de .previa/avarias/dados/2026-09-28/descobertas/doc_regra.cjs, com UMA diferença: ORDER BY nas notas e nas
// parcelas (lá não havia: a ordem da resposta do banco não é garantida; o número da nota é único na loja 1, medido).
const DESDE_DOC = "2023-01-01";
const SQL_DOC = {
  notas: `SELECT id, numeronota, id_tiposaida, tipolocalbaixa AS tlb, datasaida::text AS data,
        valortotal::float8 AS valor, id_fornecedordestinatario AS forn, id_situacaonfe AS nfe
      FROM notasaida WHERE id_loja=1 ORDER BY id`,
  ne: `SELECT id, numeronota, id_fornecedor AS forn, id_tipoentrada AS te, dataentrada::text AS data,
        valortotal::float8 AS valor, coalesce(observacao,'') AS obs, coalesce(informacaocomplementar,'') AS info
      FROM notaentrada WHERE id_loja=1 AND dataentrada >= $1::date
        AND (coalesce(observacao,'') ~ '[0-9]{5}' OR coalesce(informacaocomplementar,'') ~ '[0-9]{5}')
      ORDER BY id`,
  vb: `SELECT id, id_tipoverba AS tipo, id_fornecedor AS forn, dataemissao::text AS data, valor::float8 AS valor,
        coalesce(observacao,'') AS obs
      FROM verba WHERE id_loja=1 AND dataemissao >= $1::date ORDER BY id`,
  pp: `SELECT pp.id, pf.id_fornecedor AS forn, pf.dataentrada::text AS data, pp.valor::float8 AS valor,
        pf.id_notaentrada AS ne_id, coalesce(pp.observacao,'') AS obs, coalesce(ne.observacao,'') AS ne_obs
      FROM pagarfornecedorparcela pp JOIN pagarfornecedor pf ON pf.id=pp.id_pagarfornecedor
      LEFT JOIN notaentrada ne ON ne.id=pf.id_notaentrada
      WHERE pf.id_loja=1 AND pf.dataentrada >= $1::date AND coalesce(pp.observacao,'') ~ '[0-9]{5}'
      ORDER BY pp.id`,
};

// ---------------------------------------------------------------- metadados dos documentos (cópia de extrair-documentos.cjs)
const SQL_META = {
  tipoentrada: "SELECT id, descricao FROM tipoentrada ORDER BY id",
  situacaonotaentrada: "SELECT id, descricao FROM situacaonotaentrada ORDER BY id",
  tipoverba: "SELECT id, descricao FROM tipoverba ORDER BY id",
  situacaoverba: "SELECT id, descricao FROM situacaoverba ORDER BY id",
  notaentrada: `SELECT ne.id, ne.numeronota, ne.serie, ne.id_fornecedor, ne.id_tipoentrada, ne.id_situacaonotaentrada,
      ne.dataentrada::text AS dataentrada, ne.valortotal, ne.valormercadoria, ne.valordescontoboleto, ne.id_notasaida,
      (SELECT count(*) FROM notaentrada o WHERE o.id_loja = ne.id_loja AND o.id_fornecedor = ne.id_fornecedor AND o.numeronota = ne.numeronota AND o.id <> ne.id) AS outras_mesmo_numero
    FROM notaentrada ne WHERE ne.id = ANY($1::int[]) ORDER BY ne.id`,
  verba: `SELECT v.id, v.id_fornecedor, v.id_tipoverba, v.id_situacaoverba, v.id_situacaocadastro, v.valor, v.dataemissao::text AS dataemissao, v.id_notaentrada, v.id_tiporecebimento
    FROM verba v WHERE v.id = ANY($1::int[]) ORDER BY v.id`,
  notasaida_sit: `SELECT ns.id, ns.numeronota, ns.id_situacaonotasaida, ns.id_situacaonfe, ns.id_fornecedordestinatario FROM notasaida ns
    WHERE ns.id_loja = 1 AND ns.tipolocalbaixa = 1 ORDER BY ns.id`,
  situacaonotasaida: "SELECT id, descricao FROM situacaonotasaida ORDER BY id",
  situacaonfe: "SELECT id, descricao FROM situacaonfe ORDER BY id",
};

// ---------------------------------------------------------------- parcelas das notas de entrada citadas (REESCRITA, provada)
// Uma linha por parcela a pagar da nota de entrada: abatimento = soma dos abatimentos DIFERENTES DE ZERO (o VR grava uma
// linha de 0,00 para cada tipo), tipos = "tipo:valor" desses abatimentos, via_titulo = o que foi abatido por título de
// devolução. Reproduz as 104 linhas de 28/09 (valores, tipos, ordem). Nenhuma parcela tinha 2 abatimentos: o separador
// "," e a ordem por tipo são escolha daqui (documentos.cjs usa só "abatimento").
const SQL_PARCELAS = `SELECT pf.id_notaentrada AS ne_id, p.id AS id_parcela, p.valor, p.id_situacaopagarfornecedorparcela AS situacao,
     coalesce((SELECT sum(a.valor) FROM pagarfornecedorparcelaabatimento a WHERE a.id_pagarfornecedorparcela = p.id AND a.valor <> 0), 0) AS abatimento,
     coalesce((SELECT string_agg(a.id_tipoabatimento || ':' || a.valor, ',' ORDER BY a.id_tipoabatimento, a.id)
                 FROM pagarfornecedorparcelaabatimento a WHERE a.id_pagarfornecedorparcela = p.id AND a.valor <> 0), '') AS tipos,
     coalesce((SELECT sum(d.valor) FROM pagarfornecedorparceladevolucao d WHERE d.id_pagarfornecedorparcela = p.id), 0) AS via_titulo
   FROM pagarfornecedor pf JOIN pagarfornecedorparcela p ON p.id_pagarfornecedor = pf.id
   WHERE pf.id_notaentrada = ANY($1::int[]) ORDER BY pf.id_notaentrada, p.id`;

// ---------------------------------------------------------------- avaria no boleto (cópia EXATA de descobertas/boleto_leitura_desde2023.sql)
// O teste compara este texto com o arquivo de 28/09. Sem barra invertida (standard_conforming_strings = off no VR).
const SQL_BOLETO = `-- AVARIA NO BOLETO: parcelas a pagar ao fornecedor que citam nota de saída nossa (somente leitura)
-- ATENÇÃO: o VR roda com standard_conforming_strings = off; por isso as expressões não usam barra invertida.
WITH parc AS (
  SELECT p.id AS id_parcela, pf.id AS id_pagarfornecedor, pf.id_fornecedor, pf.numerodocumento, pf.id_notaentrada,
         p.numeroparcela, p.datavencimento, p.datapagamento, p.id_situacaopagarfornecedorparcela AS situacao,
         p.valor AS valor_parcela, p.valoracrescimo, p.observacao,
         upper(regexp_replace(coalesce(p.observacao,''), '[[:space:]]+', ' ', 'g')) AS obs
  FROM pagarfornecedorparcela p
  JOIN pagarfornecedor pf ON pf.id = p.id_pagarfornecedor
  WHERE p.datavencimento >= '2023-01-01' AND pf.id_loja = 1
    AND coalesce(trim(p.observacao),'') <> ''
),
limpo AS (   -- tira valores em dinheiro e códigos de produto antes de procurar números de nota
  SELECT parc.*,
    regexp_replace(
      regexp_replace(obs, '[0-9]{1,3}([.][0-9]{3})+,[0-9]{1,2}|[0-9]+,[0-9]{1,2}', ' ', 'g'),
      '(PROD|PRODUTO|PRODUTOS|ITEM|ITENS)[[:space:]]*[-=:;.,]?[[:space:]]*[0-9]+([[:space:]]*/[[:space:]]*[0-9]+)*', ' ', 'g') AS obs_sem_valor
  FROM parc
),
citada AS (
  SELECT DISTINCT l.id_parcela, (m)[1]::int AS numero_citado
  FROM limpo l, regexp_matches(l.obs_sem_valor, '[[:<:]]([0-9]{5})[[:>:]]', 'g') AS m
),
nota AS (
  SELECT c.id_parcela, ns.id AS id_notasaida, ns.numeronota, ns.id_tiposaida, ns.tipolocalbaixa,
         ns.id_fornecedordestinatario, ns.datasaida, ns.valortotal
  FROM citada c
  JOIN parc ON parc.id_parcela = c.id_parcela
  JOIN notasaida ns ON ns.id_loja = 1 AND ns.numeronota = c.numero_citado
  LEFT JOIN fornecedor fb ON fb.id = parc.id_fornecedor
  LEFT JOIN fornecedor fn ON fn.id = ns.id_fornecedordestinatario
  WHERE ns.id_fornecedordestinatario = parc.id_fornecedor                      -- devolução ao mesmo fornecedor
     OR (ns.id_fornecedordestinatario <> 1                                    -- ou mesmo grupo (mesma raiz de CNPJ, ex.: Três Corações 66 x 67)
         AND left(lpad(fb.cnpj::text,14,'0'),8) = left(lpad(fn.cnpj::text,14,'0'),8))
     OR (ns.id_fornecedordestinatario = 1 AND ns.id_tiposaida IN (29,31)     -- baixa por perda (destino = a própria empresa)
         AND parc.obs ~ '(AVARI|PERCA|PERDA|[[:<:]]AV[[:>:]])')
),
abat AS (
  SELECT a.id_pagarfornecedorparcela AS id_parcela,
         sum(a.valor) AS abatimento_total,
         sum(a.valor) FILTER (WHERE a.id_tipoabatimento = 5) AS abat_devolucao,
         sum(a.valor) FILTER (WHERE a.id_tipoabatimento = 2) AS abat_financeiro,
         sum(a.valor) FILTER (WHERE a.id_tipoabatimento NOT IN (2,5)) AS abat_outros
  FROM pagarfornecedorparcelaabatimento a WHERE a.valor <> 0 GROUP BY 1
),
titulo AS (
  SELECT d.id_pagarfornecedorparcela AS id_parcela, sum(d.valor) AS abat_titulo_devolucao,
         string_agg(DISTINCT rd.id_notasaida::text, ',') AS notas_do_titulo
  FROM pagarfornecedorparceladevolucao d JOIN receberdevolucao rd ON rd.id = d.id_receberdevolucao GROUP BY 1
),
pago AS (
  SELECT t.id_pagarfornecedorparcela AS id_parcela, sum(t.valor) AS valor_pago
  FROM tipoentradavalorpagarfornecedorparcela t GROUP BY 1
),
soma AS (
  SELECT id_parcela, sum(valortotal) AS soma_notas_citadas, count(*) AS qtd_notas_citadas,
         bool_or(tipolocalbaixa = 1 OR id_tiposaida IN (29,31)) AS tem_nota_de_troca_ou_perda
  FROM nota GROUP BY 1
)
SELECT p.id_parcela, p.id_fornecedor, f.razaosocial AS fornecedor, p.numerodocumento, p.numeroparcela,
       p.datavencimento::text AS vencimento, p.datapagamento::text AS pagamento, p.situacao,
       p.valor_parcela, a.abatimento_total, a.abat_devolucao, a.abat_financeiro, a.abat_outros,
       t.abat_titulo_devolucao, pg.valor_pago,
       n.numeronota AS nossa_nota, n.id_notasaida, n.id_tiposaida, n.tipolocalbaixa, n.datasaida::text AS data_nota,
       n.valortotal AS valor_nossa_nota, s.qtd_notas_citadas, s.soma_notas_citadas,
       (p.obs ~ '(AVARI|PERCA|PERDA|[[:<:]]AV[[:>:]])') AS texto_fala_avaria,
       CASE
         WHEN ','||t.notas_do_titulo||',' LIKE '%,'||n.id_notasaida||',%' THEN 'SEGURO_TITULO'
         WHEN t.id_parcela IS NOT NULL THEN 'REVISAR_TITULO_DE_OUTRA_NOTA'
         WHEN a.abatimento_total = s.soma_notas_citadas AND s.qtd_notas_citadas = 1 THEN 'SEGURO_1_NOTA'
         WHEN a.abatimento_total = s.soma_notas_citadas THEN 'SEGURO_VARIAS_NOTAS'
         WHEN a.abatimento_total IS NOT NULL THEN 'REVISAR_VALOR_DIFERENTE'
         ELSE 'REVISAR_SO_TEXTO'
       END AS confianca,
       p.observacao
FROM nota n
JOIN parc p ON p.id_parcela = n.id_parcela
JOIN soma s ON s.id_parcela = n.id_parcela
LEFT JOIN abat a ON a.id_parcela = n.id_parcela
LEFT JOIN titulo t ON t.id_parcela = n.id_parcela
LEFT JOIN pago pg ON pg.id_parcela = n.id_parcela
LEFT JOIN fornecedor f ON f.id = p.id_fornecedor
WHERE s.tem_nota_de_troca_ou_perda OR p.obs ~ '(AVARI|PERCA|PERDA|[[:<:]]AV[[:>:]])'
ORDER BY p.datavencimento, p.id_parcela, n.numeronota
`;

// ---------------------------------------------------------------- venda a preço e a custo por mês × setor (REESCRITA, provada)
// Uma consulta dá os DOIS arquivos. venda_custo_setor_mes: custo = soma de quantidade × custo com imposto de TODOS os itens
// (é assim que o arquivo de 28/09 foi feito: 2025-07 no setor 35 dá "0.00", não nulo). venda_sem_custo: só mês × setor com
// item sem custo, e ali o custo soma só os itens COM custo (> 0). Os dois conferidos linha a linha com 28/09 (meses fechados).
// Sempre filtrando vi.data (é o índice), com os dois filtros de cancelado (item e cupom) e a loja do cupom.
// $2 é o "hoje" de Caicó e fica DE FORA (data < hoje): só dias fechados.
const DESDE_VENDA = "2023-11-01";
const SQL_VENDA = `SELECT to_char(vi.data,'YYYY-MM') AS mes, pr.mercadologico1 AS setor_vr, m.descricao AS setor_nome,
  round(sum(vi.quantidade*vi.custocomimposto),2) AS venda_custo,
  round(sum(vi.valortotal),2) AS venda_valor,
  sum(vi.quantidade) AS quantidade,
  count(*) FILTER (WHERE coalesce(vi.custocomimposto,0) <= 0) AS itens_sem_custo,
  round(sum(vi.valortotal) FILTER (WHERE coalesce(vi.custocomimposto,0) <= 0),2) AS preco_sem_custo,
  round(sum(vi.quantidade*vi.custocomimposto) FILTER (WHERE vi.custocomimposto > 0),2) AS venda_custo_com_custo
FROM pdv.vendaitem vi JOIN pdv.venda v ON v.id = vi.id_venda JOIN produto pr ON pr.id = vi.id_produto
LEFT JOIN mercadologico m ON m.nivel = 1 AND m.mercadologico1 = pr.mercadologico1
WHERE v.id_loja = 1 AND vi.cancelado = false AND v.cancelado = false AND vi.data >= $1::date AND vi.data < $2::date
GROUP BY 1,2,3 ORDER BY 1,2`;
const VENDA_COMPLETA_DIAS = 7;

// ============================================================================ funções puras (o teste chama estas)
// Hora de Caicó a partir do relógio absoluto (UTC−3; não depende do fuso da máquina nem do VR, que está em GMT).
function brasilia(ms) {
  const d = new Date(ms - 3 * 3600e3);
  return { data: d.toISOString().slice(0, 10), hora: d.getUTCHours(), minuto: d.getUTCMinutes(), texto: d.toISOString().replace("T", " ").slice(0, 23) };
}
function addDias(iso, n) { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function primeiroDoMesAnterior(iso) { const d = new Date(iso.slice(0, 7) + "-01T12:00:00Z"); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 10); }
function diasEntre(a, b) { return Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 864e5); }

// O que fazer com a venda nesta rodada:
//   reaproveitar  -> o cache é de hoje (cobre até ontem) e completo desde 2023-11: nenhuma consulta
//   parcial       -> refaz do 1º dia do mês anterior ao de ontem até ontem; os meses mais velhos vêm do cache
//   completa      -> sem cache, cache de outro começo, cache que não cobre o mês anterior, ou completa há 7+ dias
function planoVenda(cache, hoje) {
  const ok = cache && cache.desde === DESDE_VENDA && typeof cache.ate === "string" && Array.isArray(cache.linhas) && typeof cache.completa_em === "string";
  if (ok && cache.ate === hoje) return { modo: "reaproveitar", de: null, ate: hoje };
  const inicio = primeiroDoMesAnterior(addDias(hoje, -1));
  if (ok && cache.ate >= inicio && cache.ate <= hoje && diasEntre(cache.completa_em, hoje) < VENDA_COMPLETA_DIAS)
    return { modo: "parcial", de: inicio, ate: hoje };
  return { modo: "completa", de: DESDE_VENDA, ate: hoje };
}
// Junta a leitura nova com o cache: meses anteriores ao início da leitura vêm do cache; do início em diante, da leitura.
function juntarVenda(cache, plano, linhasNovas) {
  if (plano.modo === "reaproveitar") return cache;
  const mesIni = plano.de.slice(0, 7);
  const velhas = plano.modo === "parcial" ? cache.linhas.filter((r) => r.mes < mesIni) : [];
  const linhas = velhas.concat(linhasNovas).sort((a, b) => (a.mes < b.mes ? -1 : a.mes > b.mes ? 1 : Number(a.setor_vr) - Number(b.setor_vr)));
  return { desde: DESDE_VENDA, ate: plano.ate, completa_em: plano.modo === "completa" ? plano.ate : cache.completa_em, linhas };
}
// Os dois arquivos, no formato de 28/09 (os números vêm como o VR devolveu: texto).
function arquivosDaVenda(linhas) {
  const vm = linhas.map((r) => ({ mes: r.mes, setor_vr: r.setor_vr, setor_nome: r.setor_nome, venda_custo: r.venda_custo,
    venda_valor: r.venda_valor, quantidade: r.quantidade, itens_sem_custo: r.itens_sem_custo }));
  const vs = linhas.filter((r) => Number(r.itens_sem_custo) > 0).map((r) => ({ mes: r.mes, setor: r.setor_vr, venda_preco: r.venda_valor,
    preco_sem_custo: r.preco_sem_custo, itens_sem_custo: r.itens_sem_custo, venda_custo: r.venda_custo_com_custo }))
    .sort((a, b) => Number(a.setor) - Number(b.setor) || (a.mes < b.mes ? -1 : a.mes > b.mes ? 1 : 0));
  return { vm, vs };
}

// A leitura dos textos: o mesmo laço de doc_regra.cjs, com a regra aprovada (ler-documento.cjs = doc_regra.cjs).
function lerDocumentos(notas, ne, vb, pp, geradoEm) {
  const nossas = new Map(notas.map((n) => [n.numeronota, n]));
  const docs = [];
  for (const d of ne) {
    for (const campo of ["obs", "info"]) {
      if (!d[campo]) continue;
      const r = leTexto(d[campo], nossas, d.data);
      if (r.citacoes.length || r.rejeitados.length) docs.push({ fonte: "notaentrada." + (campo === "obs" ? "observacao" : "informacaocomplementar"), doc: "NE#" + d.id, numdoc: d.numeronota, te: d.te, forn: d.forn, data: d.data, valorDoc: d.valor, texto: d[campo], ...r });
    }
  }
  for (const d of vb) {
    const r = leTexto(d.obs, nossas, d.data);
    if (r.citacoes.length || r.rejeitados.length) docs.push({ fonte: "verba.observacao", doc: "VB#" + d.id, tipo: d.tipo, forn: d.forn, data: d.data, valorDoc: d.valor, texto: d.obs, ...r });
  }
  for (const d of pp) {
    const r = leTexto(d.obs, nossas, d.data);
    const copia = normaliza(d.obs).replace(/\s+/g, " ").trim() === normaliza(d.ne_obs).replace(/\s+/g, " ").trim();
    if (r.citacoes.length || r.rejeitados.length) docs.push({ fonte: "pagarfornecedorparcela.observacao", doc: "PP#" + d.id, ne_id: d.ne_id, copiaDaNota: copia, forn: d.forn, data: d.data, valorDoc: d.valor, texto: d.obs, ...r });
  }
  return { geradoEm, desde: DESDE_DOC, totalNotasBaixa: notas.filter((n) => n.tlb === 1).length, docs };
}
// Notas de entrada e verbas citadas (a mesma seleção de extrair-documentos.cjs).
function documentosCitados(saida) {
  const neIds = new Set(), vbIds = new Set();
  for (const d of saida.docs) {
    if (!d.citacoes.some((c) => c.nota && c.nota.tlb === 1)) continue;
    const n = Number(d.doc.split("#")[1]);
    if (d.doc.startsWith("NE#")) neIds.add(n); else if (d.doc.startsWith("VB#")) vbIds.add(n);
    if (d.ne_id) neIds.add(Number(d.ne_id));
  }
  return { neIds: [...neIds], vbIds: [...vbIds] };
}

// ============================================================================ a extração
// Os únicos arquivos que esta extração escreve (e os únicos que ela apaga antes de começar, para nunca misturar rodadas).
const ARQ_RAIZ = Object.keys(FONTES).map((f) => f + ".json").concat(["manifesto.json", "documentos_meta.json", "documentos_parcelas.json", "conferencia.json"]);
const ARQ_DESC = ["doc_saida.json", "boleto_leitura_desde2023.json", "venda_custo_setor_mes.json", "venda_sem_custo.json"];

function prepararPasta(destino) {
  const abs = path.resolve(destino);
  // trava: nunca escrever por cima de uma extração guardada da prévia (a de 28/09 é a referência dos testes)
  if (abs.split(path.sep).join("/").indexOf("/.previa/avarias/dados") >= 0) throw new Error("recusado: a extração do robô não escreve em .previa/avarias/dados");
  fs.mkdirSync(path.join(abs, "descobertas"), { recursive: true });
  for (const f of ARQ_RAIZ) { try { fs.unlinkSync(path.join(abs, f)); } catch (e) { /* não existia */ } }
  for (const f of ARQ_DESC) { try { fs.unlinkSync(path.join(abs, "descobertas", f)); } catch (e) { /* idem */ } }
  return abs;
}

// o.agoraMs (relógio, padrão Date.now), o.vendaCache (o do dia anterior ou nulo), o.log, o.comVR (o teste pode trocar)
async function extrair(destino, o = {}) {
  const log = o.log || (() => {});
  const agoraMs = o.agoraMs || Date.now();
  const b = brasilia(agoraMs), hoje = b.data;
  const dir = prepararPasta(destino);
  const escrever = (rel, obj, bonito) => fs.writeFileSync(path.join(dir, rel), bonito ? JSON.stringify(obj, null, 1) : JSON.stringify(obj));
  const manifesto = { inicio: new Date(agoraMs).toISOString(), fontes: {}, corte_vr: b.texto, hoje, extras: {} };
  const tempos = {};
  let venda = null, plano = null;
  const t0 = Date.now();
  await (o.comVR || comVR)(async (q) => {
    const med = async (nome, sql, par) => {
      const t = Date.now(); const rows = await q(sql, par); tempos[nome] = Date.now() - t;
      log("  " + nome + ": " + rows.length + " linhas, " + (tempos[nome] / 1000).toFixed(1) + " s");
      return rows;
    };
    for (const [nome, sql] of Object.entries(FONTES)) {
      const rows = await med(nome, sql);
      escrever(nome + ".json", rows);
      manifesto.fontes[nome] = { linhas: rows.length, ms: tempos[nome] };
    }
    // textos dos documentos
    const notas = await med("doc_notas", SQL_DOC.notas);
    const ne = await med("doc_notas_entrada", SQL_DOC.ne, [DESDE_DOC]);
    const vb = await med("doc_verbas", SQL_DOC.vb, [DESDE_DOC]);
    const pp = await med("doc_parcelas", SQL_DOC.pp, [DESDE_DOC]);
    const saida = lerDocumentos(notas, ne, vb, pp, new Date().toISOString());
    escrever("descobertas/doc_saida.json", saida, true);
    manifesto.extras.doc_saida = { documentos: saida.docs.length };
    // metadados dos documentos citados
    const { neIds, vbIds } = documentosCitados(saida);
    const meta = {};
    for (const [k, sql] of Object.entries(SQL_META)) meta[k] = await med("meta_" + k, sql, k === "notaentrada" ? [neIds] : k === "verba" ? [vbIds] : undefined);
    escrever("documentos_meta.json", meta);
    const parcelas = await med("documentos_parcelas", SQL_PARCELAS, [meta.notaentrada.map((x) => Number(x.id))]);
    escrever("documentos_parcelas.json", parcelas);
    // avaria no boleto
    const boleto = await med("boleto", SQL_BOLETO);
    escrever("descobertas/boleto_leitura_desde2023.json", boleto);
    // venda (só dias fechados)
    plano = planoVenda(o.vendaCache || null, hoje);
    const novas = plano.modo === "reaproveitar" ? [] : await med("venda_" + plano.modo + " (" + plano.de + " até antes de " + plano.ate + ")", SQL_VENDA, [plano.de, plano.ate]);
    venda = juntarVenda(o.vendaCache || null, plano, novas);
    const { vm, vs } = arquivosDaVenda(venda.linhas);
    escrever("descobertas/venda_custo_setor_mes.json", vm);
    escrever("descobertas/venda_sem_custo.json", vs);
    manifesto.extras.venda = { modo: plano.modo, de: plano.de, ate_exclusive: plano.ate, completa_em: venda.completa_em, linhas: vm.length };
  }, { tempoMs: 150000 });
  manifesto.fim = new Date().toISOString();
  manifesto.extras.ms_vr = Date.now() - t0;
  escrever("manifesto.json", manifesto, true);
  // a conferência do próprio cálculo aprovado (etapa1) sobre a pasta: documentos.cjs lê a lista de notas corrigidas dela
  const t1 = Date.now();
  const { rodar } = require("./etapa1.cjs");
  const R = rodar(dir).R;
  escrever("conferencia.json", R, true);
  tempos.conferencia_js = Date.now() - t1;
  return { dir, manifesto, R, vendaCache: venda, plano, tempos, hoje };
}

module.exports = {
  extrair, prepararPasta, brasilia, addDias, primeiroDoMesAnterior, diasEntre, planoVenda, juntarVenda, arquivosDaVenda,
  lerDocumentos, documentosCitados,
  FONTES, SQL_DOC, SQL_META, SQL_PARCELAS, SQL_BOLETO, SQL_VENDA, DESDE_DOC, DESDE_VENDA, VENDA_COMPLETA_DIAS, ARQ_RAIZ, ARQ_DESC,
};
