// Testes da FRENTE DE CAIXA: cancelamentos e descontos manuais da tela "Análise".
//
// POR QUE ESTE TESTE EXISTE (21/09/2026). Ao medir o banco do VR da loja de 01 a 20/09/2026
// apareceram três enganos que custam dinheiro de verdade:
//   1) O VR chama de "cancelamento" cinco coisas diferentes: o erro de quem registrou, o
//      cliente que desistiu, o cartão que o banco recusou, o teste de equipamento e a
//      duplicidade do leitor. Somadas dão R$ 30.974,04 (0,93% da venda) e, nessa soma, some
//      a única parte que a loja consegue reduzir com treino — o erro de operação, que
//      sozinho é R$ 16.769,40 de 3.076 ocorrências.
//   2) Quando o CUPOM é cancelado, os itens dele recebem o valor cancelado mas NÃO recebem
//      a marca de cancelado, e o motivo do item vem nulo — o motivo verdadeiro está no cupom.
//      Lendo o motivo no item nos dois casos, 53.051 ocorrências e R$ 418.313,93 do histórico
//      caem em "sem motivo".
//   3) 36 dos 99 cupons cancelados de setembro vêm com subtotal da impressora = 0 (são os
//      cancelados durante a venda). Usar o subtotal subestima o cancelamento em 21%.
//
// O QUE ELE CONGELA:
//   - total do card = soma dos grupos = soma das ocorrências, provando os DOIS lados
//     (fecha quando o dado está bom, NÃO fecha quando falta uma ocorrência);
//   - motivo do VR que ninguém classificou cai em "Não classificado" e NUNCA é somado
//     calado dentro de outro grupo — categoria nova entrando muda é número que mente;
//   - desconto que passa do limite E está sem motivo é UMA ocorrência com DOIS motivos
//     de alerta, nunca duas ocorrências (foi a cobrança principal do dono);
//   - período sem movimento devolve null e a tela escreve "sem dados"; dia com venda e sem
//     cancelamento devolve 0, que é uma verdade diferente;
//   - venda 0 não vira divisão por zero, NaN nem Infinity;
//   - e os números reais da conferência de 01 a 20/09/2026, linha a linha.
//
//   node scripts/testes/frente-caixa.test.cjs
const fs = require("fs");
const path = require("path");

const HTML = fs.readFileSync(path.join(__dirname, "..", "..", "output", "index.html"), "utf8");
function bloco(marca) {
  const i = HTML.indexOf("==" + marca + "-INICIO==");
  const f = HTML.indexOf("==" + marca + "-FIM==");
  if (i < 0 || f < 0) { console.log("ERRO: não achei o módulo " + marca + " (rode o build antes)."); process.exit(1); }
  return HTML.slice(HTML.indexOf("*/", i) + 2, HTML.lastIndexOf("/*", f));
}
const M = new Function(bloco("FCXCALC") +
  "\nreturn {FCX_CFG,FCX_GRUPOS,FCX_ORDEM,FCX_NOME,fcxGrupo,fcxSomaDias,fcxCent," +
  "fcxCancelamento,fcxFatia,fcxDesconto,fcxAlertasDoDesconto,fcxStatus,fcxConciliar};")();

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + obtido + (bate ? "" : "   (esperado: " + esperado + ")"));
  bate ? ok++ : falhou++;
}
const d2 = (v) => v === null || v === undefined ? String(v) : (Math.round(v * 100) / 100).toFixed(2);

// Uma linha do FCX_DIA[], do jeito que o robô entrega ao painel. Tudo que não for informado
// é zero: dia com venda e sem cancelamento é zero de verdade, não é falta de dado.
//   ce/cev  erro de operação (ocorrências / R$)      cc/ccv  cliente desistiu
//   cp/cpv  pagamento falhou                         cq/cqv  equipamento
//   cn/cnv  não classificado
//   dn  ocorrências de desconto manual   dv  R$ do desconto manual
//   da  quantas passaram do limite do item           ds  quantas estão sem motivo
//   dal quantas ocorrências precisam de revisão (a MESMA linha, contada uma vez só)
function dia(o) {
  return Object.assign({ d: "2026-09-01", ce: 0, cev: 0, cc: 0, ccv: 0, cp: 0, cpv: 0,
                         cq: 0, cqv: 0, cn: 0, cnv: 0,
                         dn: 0, dv: 0, da: 0, ds: 0, dal: 0 }, o);
}

// ===========================================================================
// O MOTIVO DO VR VIRA GRUPO GERENCIAL — e o que ninguém classificou aparece
// ===========================================================================
console.log("\n-- em que grupo cai cada motivo do VR --");
{
  eq("erro de registro é erro de operação", M.fcxGrupo(2), "erro");
  eq("preço errado é erro de operação", M.fcxGrupo(4), "erro");
  eq("duplicidade do leitor é erro de operação", M.fcxGrupo(10), "erro");
  eq("devolução do cliente é o cliente desistindo", M.fcxGrupo(1), "cliente");
  eq("dinheiro insuficiente é o cliente desistindo", M.fcxGrupo(3), "cliente");
  eq("cheque recusado é pagamento que falhou", M.fcxGrupo(6), "pagto");
  eq("cartão recusado é pagamento que falhou", M.fcxGrupo(7), "pagto");
  eq("teste de equipamento é equipamento", M.fcxGrupo(5), "equip");
  eq("problema no equipamento é equipamento", M.fcxGrupo(8), "equip");
}

console.log("\n-- motivo que o painel não conhece NÃO entra escondido em grupo nenhum --");
{
  // Este é o pedido explícito do dono: se o VR começar a mandar um motivo novo, ele TEM que
  // aparecer na tela como "Não classificado", não somar calado dentro de "erro de operação".
  eq("motivo 99, que ninguém cadastrou, fica de fora dos grupos", M.fcxGrupo(99), "naoclass");
  eq("o motivo 9 (denegado, nunca usado) também", M.fcxGrupo(9), "naoclass");
  eq("o motivo 11 (cancelamento de cupom, inativo) também", M.fcxGrupo(11), "naoclass");
  eq("cancelamento sem motivo nenhum fica de fora", M.fcxGrupo(null), "naoclass");
  eq("motivo que veio vazio fica de fora", M.fcxGrupo(undefined), "naoclass");
  eq("texto vazio fica de fora", M.fcxGrupo(""), "naoclass");
  eq("motivo que não é número fica de fora", M.fcxGrupo("cancelou"), "naoclass");
  eq("mas motivo que chega como texto de número continua valendo", M.fcxGrupo("4"), "erro");
}

console.log("\n-- e na conta do card o não classificado aparece separado, sem inchar o erro --");
{
  // 10 cancelamentos de erro (R$ 100,00) e 3 com motivo que o painel não conhece (R$ 47,00).
  const s = M.fcxSomaDias([dia({ ce: 10, cev: 100, cn: 3, cnv: 47 })], "2026-09-01", "2026-09-01");
  const c = M.fcxCancelamento(s, 10000);
  eq("erro de operação continua com os 10 dele", c.grupos.erro.n, 10);
  eq("erro de operação continua com os R$ 100,00 dele", d2(c.grupos.erro.v), "100.00");
  eq("os 3 sem classificação aparecem à parte", c.grupos.naoclass.n, 3);
  eq("com os R$ 47,00 deles à parte", d2(c.grupos.naoclass.v), "47.00");
  eq("a tela é avisada de que existe não classificado", c.temNaoClassificado, true);
  eq("e o total do card soma os dois", d2(c.total), "147.00");
  eq("com as 13 ocorrências", c.ocorrencias, 13);
  // Sem nenhum não classificado o aviso some da tela.
  const limpo = M.fcxCancelamento(M.fcxSomaDias([dia({ ce: 10, cev: 100 })], "2026-09-01", "2026-09-01"), 10000);
  eq("sem motivo estranho, a tela não avisa nada", limpo.temNaoClassificado, false);
}

// ===========================================================================
// DESCONTO MANUAL: quais regras cada operação aciona
// ===========================================================================
console.log("\n-- desconto manual: quando o painel chama pra conferir --");
{
  // (a) O caso normal: R$ 4,00 de desconto num item de R$ 20,00 (20%), com motivo informado.
  eq("desconto de 20% do item, com motivo, não gera alerta nenhum",
     M.fcxAlertasDoDesconto(20, 4, 1).length, 0);

  // (b) Exatamente na metade do item. O limite é "metade OU MAIS", então este JÁ é alerta.
  const meio = M.fcxAlertasDoDesconto(20, 10, 1);
  eq("desconto de exatamente metade do item já é alerta", meio.length, 1);
  eq("e o painel diz por quê", meio[0], "desconto acima de 50% do item");

  // (c) Acima da metade.
  const muito = M.fcxAlertasDoDesconto(20, 15, 1);
  eq("desconto de 75% do item é alerta", muito.length, 1);
  eq("e o painel diz por quê (75%)", muito[0], "desconto acima de 50% do item");

  // (d) Sem motivo, mesmo sendo um desconto pequeno.
  const semMotivo = M.fcxAlertasDoDesconto(20, 1, null);
  eq("desconto de 5% mas sem motivo é alerta", semMotivo.length, 1);
  eq("e o painel diz que faltou o motivo", semMotivo[0], "motivo não informado");
}

console.log("\n-- o caso que o dono mais cobrou: UMA operação com DOIS problemas --");
{
  // (e) Passou do limite E está sem motivo. São DOIS motivos de alerta na MESMA operação —
  // contar como duas ocorrências dobraria o número na tela sem ter acontecido nada a mais.
  const dois = M.fcxAlertasDoDesconto(20, 18, null);
  eq("uma operação pode acionar duas regras de uma vez", dois.length, 2);
  eq("a primeira regra é o limite do item", dois[0], "desconto acima de 50% do item");
  eq("a segunda regra é o motivo que faltou", dois[1], "motivo não informado");

  // E no total do dia isso continua sendo UMA ocorrência.
  const s = M.fcxSomaDias([dia({ dn: 1, dv: 18, da: 1, ds: 1, dal: 1 })], "2026-09-01", "2026-09-01");
  const dsc = M.fcxDesconto(s, 10000);
  eq("no total do dia continua sendo UMA ocorrência", dsc.ocorrencias, 1);
  eq("UMA operação pra revisar", dsc.ocorrenciasParaRevisar, 1);
  eq("mas DOIS motivos de alerta", dsc.motivosDeAlerta, 2);
  eq("um por passar do limite", dsc.acimaDoLimite, 1);
  eq("e um por estar sem motivo", dsc.semMotivo, 1);
  eq("e o valor do dia é o valor do desconto", d2(dsc.valor), "18.00");
}

console.log("\n-- motivo nulo e motivo em branco são a mesma coisa: faltou o motivo --");
{
  // (j) O robô pode mandar nulo (coluna vazia no VR) ou não mandar o campo. Os dois contam.
  eq("motivo nulo conta como sem motivo", M.fcxAlertasDoDesconto(20, 2, null)[0], "motivo não informado");
  eq("motivo não enviado conta como sem motivo", M.fcxAlertasDoDesconto(20, 2, undefined)[0], "motivo não informado");
  eq("texto vazio conta como sem motivo", M.fcxAlertasDoDesconto(20, 2, "")[0], "motivo não informado");
  // No VR a coluna é número inteiro: não existe 0, não existe negativo. Se um dia existir,
  // é motivo informado — e é o cadastro do VR que tem que explicar qual é.
  eq("motivo 1 (preço errado) é motivo informado", M.fcxAlertasDoDesconto(20, 2, 1).length, 0);
  eq("motivo 2 (venda atacado) é motivo informado", M.fcxAlertasDoDesconto(20, 2, 2).length, 0);
  eq("motivo 3 (falta produto oferta) é motivo informado", M.fcxAlertasDoDesconto(20, 2, 3).length, 0);
}

console.log("\n-- promoção automática não é desconto manual e não pode entrar na conta --");
{
  // (f) Item em oferta com 60% de abatimento: o VR grava isso em outra coluna e o desconto
  // manual dele é 0. No histórico inteiro, nenhum dos 2.924 itens com desconto manual estava
  // em oferta — quem baixa o preço na promoção é a loja, não o operador do caixa.
  eq("oferta de 60% não aciona o limite do item", M.fcxAlertasDoDesconto(20, 0, 3).length, 0);
  eq("oferta de 90% também não", M.fcxAlertasDoDesconto(100, 0, 3).length, 0);
  // E no dia: a venda existe, a promoção existe, mas o desconto manual é zero.
  const s = M.fcxSomaDias([dia({ dn: 0, dv: 0 })], "2026-09-01", "2026-09-01");
  const dsc = M.fcxDesconto(s, 10000);
  eq("o dia da promoção fica com zero desconto manual", dsc.ocorrencias, 0);
  eq("e zero reais de desconto manual", d2(dsc.valor), "0.00");
}

console.log("\n-- desconto de R$ 0,50 e desconto de R$ 3.000,00 --");
{
  // (g) O valor não muda a regra: o que manda é a fatia do item e o motivo.
  eq("R$ 0,50 tirados de um item de R$ 1,00 é metade: alerta",
     M.fcxAlertasDoDesconto(1, 0.5, 1).length, 1);
  eq("R$ 0,50 tirados de um item de R$ 40,00 não é alerta",
     M.fcxAlertasDoDesconto(40, 0.5, 1).length, 0);
  eq("R$ 3.000,00 tirados de um item de R$ 12.000,00 não é alerta",
     M.fcxAlertasDoDesconto(12000, 3000, 1).length, 0);
  eq("R$ 3.000,00 tirados de um item de R$ 4.000,00 é alerta",
     M.fcxAlertasDoDesconto(4000, 3000, 1).length, 1);
  // O maior desconto do histórico foi 96,32% de um item — nunca passa de 100%.
  eq("o recorde do histórico, 96,32% do item, é alerta",
     M.fcxAlertasDoDesconto(100, 96.32, 1).length, 1);
  // Item com valor zero não existe na base (valortotal = quantidade x preço em 2.924 de 2.924),
  // mas se aparecer não pode virar divisão por zero nem alerta inventado.
  eq("item de valor zero não inventa alerta de limite", M.fcxAlertasDoDesconto(0, 5, 1).length, 0);
}

// ===========================================================================
// ZERO NÃO É SEM DADO — a diferença que muda a decisão do dono
// ===========================================================================
console.log("\n-- dia com venda e nenhum desconto: a resposta é ZERO --");
{
  // (h) Vendeu R$ 50.000,00 e ninguém deu desconto manual. Isso é uma informação boa.
  const s = M.fcxSomaDias([dia({ d: "2026-09-10" })], "2026-09-10", "2026-09-10");
  eq("o dia foi encontrado", s.dias, 1);
  const dsc = M.fcxDesconto(s, 50000);
  eq("zero ocorrências de desconto", dsc.ocorrencias, 0);
  eq("zero reais de desconto", d2(dsc.valor), "0.00");
  eq("zero por cento da venda", d2(dsc.pct), "0.00");
  eq("e a resposta NÃO é vazia: existe conta pra mostrar", dsc === null, false);
  eq("o cancelamento do mesmo dia também é zero por cento",
     d2(M.fcxCancelamento(s, 50000).pct), "0.00");
  eq("e o status desse dia é EM DIA", M.fcxStatus(M.fcxCancelamento(s, 50000).pct, M.FCX_CFG.refCancelamento).txt, "EM DIA");
}

console.log("\n-- período sem nenhum dia de movimento: a resposta é SEM DADOS, não zero --");
{
  // (i) O dono filtrou uma semana em que a loja não abriu. Escrever "0,00%" ali seria mentira:
  // pareceria uma semana perfeita quando na verdade não houve venda nenhuma.
  const vazio = M.fcxSomaDias([dia({ d: "2026-09-10", ce: 5, cev: 80 })], "2026-10-01", "2026-10-07");
  eq("nenhum dia caiu na janela, então não tem soma", vazio, null);
  eq("e não existe cancelamento pra mostrar", M.fcxCancelamento(vazio, 100000), null);
  eq("nem desconto pra mostrar", M.fcxDesconto(vazio, 100000), null);
  eq("a tela escreve SEM DADOS", M.fcxStatus(null, M.FCX_CFG.refCancelamento).txt, "SEM DADOS");
  eq("e não escreve EM DIA", M.fcxStatus(null, M.FCX_CFG.refCancelamento).txt === "EM DIA", false);
  eq("a lista de dias vazia também dá sem dados", M.fcxSomaDias([], "2026-09-01", "2026-09-30"), null);
}

console.log("\n-- dia registrado mas sem faturamento: o percentual não pode virar conta quebrada --");
{
  // (n) Já aconteceu de o robô gravar o dia antes de a venda fechar. base = 0.
  const s = M.fcxSomaDias([dia({ ce: 4, cev: 60 })], "2026-09-01", "2026-09-01");
  const c = M.fcxCancelamento(s, 0);
  eq("o valor cancelado continua aparecendo", d2(c.total), "60.00");
  eq("e as ocorrências também", c.ocorrencias, 4);
  eq("mas o percentual fica sem resposta", c.pct, null);
  eq("não vira conta impossível", Number.isNaN(c.pct), false);
  eq("não vira infinito", c.pct === Infinity, false);
  eq("e o status vira SEM DADOS", M.fcxStatus(c.pct, M.FCX_CFG.refCancelamento).txt, "SEM DADOS");
  eq("o desconto do mesmo dia também fica sem percentual", M.fcxDesconto(s, 0).pct, null);
  eq("venda negativa (devolução maior que a venda) também não dá percentual",
     M.fcxCancelamento(s, -100).pct, null);
}

console.log("\n-- a fatia de cada grupo dentro do total --");
{
  // (o) Card em zero: a fatia de cada grupo é "sem resposta", não "0%".
  eq("metade do total é 50%", d2(M.fcxFatia(50, 100)), "50.00");
  eq("um quarto do total é 25%", d2(M.fcxFatia(25, 100)), "25.00");
  eq("com total zerado não existe fatia", M.fcxFatia(0, 0), null);
  eq("nem com valor em cima de total zerado", M.fcxFatia(10, 0), null);
  eq("e a fatia dos R$ 16.769,40 de erro nos R$ 30.974,04 é 54,14%",
     d2(M.fcxFatia(16769.40, 30974.04)), "54.14");
}

// ===========================================================================
// O FILTRO DE PERÍODO DA TELA
// ===========================================================================
console.log("\n-- o filtro de datas pega o que é do período e só o que é do período --");
{
  // (k) Cinco dias na base, cada um com 1 cancelamento de erro e valor diferente.
  const L = [
    dia({ d: "2026-08-31", ce: 1, cev: 1000 }),
    dia({ d: "2026-09-01", ce: 1, cev: 10 }),
    dia({ d: "2026-09-02", ce: 1, cev: 20 }),
    dia({ d: "2026-09-03", ce: 1, cev: 30 }),
    dia({ d: "2026-10-01", ce: 1, cev: 2000 })
  ];
  const umDia = M.fcxSomaDias(L, "2026-09-02", "2026-09-02");
  eq("um dia só traz um dia só", umDia.dias, 1);
  eq("e traz o valor daquele dia", d2(M.fcxCancelamento(umDia, 1000).total), "20.00");

  const tres = M.fcxSomaDias(L, "2026-09-01", "2026-09-03");
  eq("três dias trazem três dias", tres.dias, 3);
  eq("e somam os três valores", d2(M.fcxCancelamento(tres, 1000).total), "60.00");
  eq("com as três ocorrências", M.fcxCancelamento(tres, 1000).ocorrencias, 3);

  // O que está fora da janela não pode entrar de jeito nenhum: os R$ 1.000,00 do dia 31/08
  // e os R$ 2.000,00 de outubro somariam mais que o período inteiro.
  eq("o dia anterior à janela não entra", d2(M.fcxCancelamento(tres, 1000).total) === "1060.00", false);
  eq("o dia posterior à janela não entra", d2(M.fcxCancelamento(tres, 1000).total) === "2060.00", false);
  eq("a primeira data da janela entra (limite fechado)",
     M.fcxSomaDias(L, "2026-09-01", "2026-09-01").dias, 1);
  eq("a última data da janela entra (limite fechado)",
     M.fcxSomaDias(L, "2026-09-03", "2026-09-03").dias, 1);
  eq("o mês inteiro pega os três dias de setembro",
     M.fcxSomaDias(L, "2026-09-01", "2026-09-30").dias, 3);
}

// ===========================================================================
// A TRAVA: CARD = GRUPOS = OCORRÊNCIAS
// ===========================================================================
console.log("\n-- a conciliação fecha quando o dado está bom --");
{
  // (l, lado 1) Três cancelamentos: dois de erro (R$ 10,10 e R$ 20,20) e um de cliente (R$ 4,70).
  const s = M.fcxSomaDias([dia({ ce: 2, cev: 30.30, cc: 1, ccv: 4.70 })], "2026-09-01", "2026-09-01");
  const c = M.fcxCancelamento(s, 100000);
  const lista = [{ v: 10.10 }, { v: 20.20 }, { v: 4.70 }];
  const cc = M.fcxConciliar(c, lista);
  eq("o card mostra R$ 35,00", d2(cc.totalCard), "35.00");
  eq("a soma dos grupos dá R$ 35,00", d2(cc.somaGrupos), "35.00");
  eq("a soma das ocorrências dá R$ 35,00", d2(cc.somaOcorrencias), "35.00");
  eq("o card conta 3 ocorrências", cc.nCard, 3);
  eq("os grupos contam 3", cc.nGrupos, 3);
  eq("a lista tem 3", cc.nOcorrencias, 3);
  eq("FECHA", cc.fecha, true);
  // R$ 10,10 + R$ 20,20 dá 30,299999999999997 em ponto flutuante — o computador não guarda
  // centavo exato. O arredondamento existe pra a trava não acusar um buraco que não existe.
  eq("somar dinheiro em ponto flutuante deixa resto", (10.10 + 20.20) === 30.30, false);
  eq("mas o arredondamento pra centavo limpa o resto", d2(M.fcxCent(10.10 + 20.20)), "30.30");
  eq("e mesmo com o resto a trava fecha", cc.fecha, true);
}

console.log("\n-- e a conciliação NÃO fecha quando falta uma ocorrência --");
{
  // (l, lado 2) Prova do outro lado: se a trava sempre dissesse "fecha", ela não serviria
  // pra nada. Aqui a terceira ocorrência sumiu da lista.
  const s = M.fcxSomaDias([dia({ ce: 2, cev: 30.30, cc: 1, ccv: 4.70 })], "2026-09-01", "2026-09-01");
  const c = M.fcxCancelamento(s, 100000);
  const cc = M.fcxConciliar(c, [{ v: 10.10 }, { v: 20.20 }]);
  eq("NÃO FECHA", cc.fecha, false);
  eq("o card continua em R$ 35,00", d2(cc.totalCard), "35.00");
  eq("mas a lista só soma R$ 30,30", d2(cc.somaOcorrencias), "30.30");
  eq("o card conta 3 ocorrências", cc.nCard, 3);
  eq("e a lista só tem 2", cc.nOcorrencias, 2);

  // E também não fecha quando o valor está errado mas a quantidade está certa.
  const valorErrado = M.fcxConciliar(c, [{ v: 10.10 }, { v: 20.20 }, { v: 1.00 }]);
  eq("valor trocado numa das ocorrências também não fecha", valorErrado.fecha, false);
  eq("e a diferença fica visível na tela", d2(valorErrado.somaOcorrencias), "31.30");

  // E não fecha com a lista vazia.
  eq("lista de ocorrências vazia não fecha", M.fcxConciliar(c, []).fecha, false);
}

// ===========================================================================
// OS NÚMEROS REAIS — conferência de 01 a 20/09/2026 contra o banco do VR
// ===========================================================================
console.log("\n-- a conferência de 01 a 20/09/2026, medida no banco do VR --");
{
  // O robô ainda não grava FCX_DIA no output/vr-data.json. Até gravar, o período real fica
  // congelado aqui: os totais medidos no banco, espalhados pelos 20 dias em centavos, pra
  // provar que somar dia a dia devolve exatamente a conferência.
  const espalharValor = (total, n) => {
    const c = Math.round(total * 100), b = Math.floor(c / n), r = c - b * n, saida = [];
    for (let k = 0; k < n; k++) saida.push((b + (k < r ? 1 : 0)) / 100);
    return saida;
  };
  const espalharQtd = (total, n) => {
    const b = Math.floor(total / n), r = total - b * n, saida = [];
    for (let k = 0; k < n; k++) saida.push(b + (k < r ? 1 : 0));
    return saida;
  };
  const N = 20;
  const cev = espalharValor(16769.40, N), cpv = espalharValor(7663.48, N),
        ccv = espalharValor(6459.68, N), cqv = espalharValor(81.48, N),
        dv  = espalharValor(159.27, N);
  const ce = espalharQtd(1372, N), cp = espalharQtd(1072, N), cc = espalharQtd(622, N),
        cq = espalharQtd(10, N), dn = espalharQtd(37, N), da = espalharQtd(2, N);
  const FCX_DIA = [];
  for (let k = 0; k < N; k++) {
    FCX_DIA.push(dia({ d: "2026-09-" + String(k + 1).padStart(2, "0"),
      ce: ce[k], cev: cev[k], cp: cp[k], cpv: cpv[k], cc: cc[k], ccv: ccv[k],
      cq: cq[k], cqv: cqv[k], cn: 0, cnv: 0,
      dn: dn[k], dv: dv[k], da: da[k], ds: 0, dal: da[k] }));
  }
  const BASE = 3333041.42;   // faturamento do mesmo período, medido no VR
  const s = M.fcxSomaDias(FCX_DIA, "2026-09-01", "2026-09-20");
  eq("os 20 dias do período entraram", s.dias, 20);

  const c = M.fcxCancelamento(s, BASE);
  eq("o cancelamento do período é R$ 30.974,04", d2(c.total), "30974.04");
  eq("em 3.076 ocorrências", c.ocorrencias, 3076);
  eq("que é 0,93% da venda", d2(c.pct), "0.93");
  eq("erro de operação: 1.372 ocorrências", c.grupos.erro.n, 1372);
  eq("erro de operação: R$ 16.769,40", d2(c.grupos.erro.v), "16769.40");
  eq("pagamento falhou: 1.072 ocorrências", c.grupos.pagto.n, 1072);
  eq("pagamento falhou: R$ 7.663,48", d2(c.grupos.pagto.v), "7663.48");
  eq("cliente desistiu: 622 ocorrências", c.grupos.cliente.n, 622);
  eq("cliente desistiu: R$ 6.459,68", d2(c.grupos.cliente.v), "6459.68");
  eq("equipamento: 10 ocorrências", c.grupos.equip.n, 10);
  eq("equipamento: R$ 81,48", d2(c.grupos.equip.v), "81.48");
  eq("não classificado: nenhuma ocorrência", c.grupos.naoclass.n, 0);
  eq("não classificado: R$ 0,00", d2(c.grupos.naoclass.v), "0.00");
  eq("e a tela não precisa avisar de motivo estranho", c.temNaoClassificado, false);

  // A trava do dono aplicada ao período real: os cinco grupos somados voltam ao card.
  const grupos = M.FCX_ORDEM.map((k) => c.grupos[k]);
  eq("os cinco grupos somados dão o total do card",
     d2(grupos.reduce((a, g) => a + g.v, 0)), "30974.04");
  eq("e as ocorrências dos cinco grupos dão as do card",
     grupos.reduce((a, g) => a + g.n, 0), 3076);

  eq("0,93% está acima da referência de 0,50%",
     M.fcxStatus(c.pct, M.FCX_CFG.refCancelamento).txt, "ACIMA DA REFERÊNCIA");
  eq("e a tela pinta de vermelho", M.fcxStatus(c.pct, M.FCX_CFG.refCancelamento).cls, "bad");

  // O ponto do módulo: o erro de operação é a parte que treino resolve, e sozinho ele já é
  // mais da metade do dinheiro cancelado. Somado com o resto, isso sumia.
  eq("o erro de operação sozinho é 54,14% do cancelamento",
     d2(M.fcxFatia(c.grupos.erro.v, c.total)), "54.14");
  eq("o erro de operação sozinho é 0,50% da venda",
     d2(c.grupos.erro.v / BASE * 100), "0.50");

  const dsc = M.fcxDesconto(s, BASE);
  eq("desconto manual do período: R$ 159,27", d2(dsc.valor), "159.27");
  eq("em 37 ocorrências", dsc.ocorrencias, 37);
  eq("2 passaram da metade do item", dsc.acimaDoLimite, 2);
  eq("nenhuma ficou sem motivo", dsc.semMotivo, 0);
  eq("2 operações pra o dono revisar", dsc.ocorrenciasParaRevisar, 2);
  eq("com 2 motivos de alerta no total", dsc.motivosDeAlerta, 2);
  eq("o desconto manual é 0,0048% da venda", (dsc.pct * 100).toFixed(2), "0.48");
  eq("bem abaixo da referência de 0,30%: EM DIA",
     M.fcxStatus(dsc.pct, M.FCX_CFG.refDesconto).txt, "EM DIA");

  // Conciliação do período real: 3.076 ocorrências valendo R$ 30.974,04.
  const ocorrencias = [];
  const fatias = espalharValor(30974.04, 3076);
  for (let k = 0; k < 3076; k++) ocorrencias.push({ v: fatias[k] });
  const trava = M.fcxConciliar(c, ocorrencias);
  eq("as 3.076 ocorrências do período conciliam com o card", trava.fecha, true);
  eq("somando uma a uma dá R$ 30.974,04", d2(trava.somaOcorrencias), "30974.04");
  // E tirando uma única ocorrência de R$ 10,07 de 3.076, a trava acusa.
  eq("e se UMA das 3.076 sumir, a trava acusa",
     M.fcxConciliar(c, ocorrencias.slice(1)).fecha, false);
}

console.log("\n-- os parâmetros de gestão vêm de um lugar só --");
{
  // Se alguém mudar uma referência, ela muda em tela, alerta e cor ao mesmo tempo. O teste
  // congela os valores que o dono definiu em 21/09/2026 pra a mudança ser sempre consciente.
  eq("referência do cancelamento: 0,50% da venda", d2(M.FCX_CFG.refCancelamento), "0.50");
  eq("referência do desconto manual: 0,30% da venda", d2(M.FCX_CFG.refDesconto), "0.30");
  eq("limite do item: metade do preço", d2(M.FCX_CFG.limiteItem), "0.50");
  eq("desconto sem motivo é cobrado", M.FCX_CFG.exigirMotivo, true);
  eq("a tela mostra cinco grupos", M.FCX_ORDEM.length, 5);
  eq("e o não classificado é sempre o último", M.FCX_ORDEM[4], "naoclass");
  eq("com nome que o dono entende", M.FCX_NOME.naoclass, "Não classificado");
  eq("erro de operação tem nome de gente", M.FCX_NOME.erro, "Erro de operação");
  eq("centavo é arredondado antes de comparar", d2(M.fcxCent(0.1 + 0.2)), "0.30");
  eq("e o arredondamento não muda o dinheiro", d2(M.fcxCent(16769.404)), "16769.40");
}


/* ==================================================================
   O MESMO NÚMERO EM DOIS LUGARES SEMPRE DIVERGE UM DIA.
   O limite de 50% do item existe duas vezes: no painel (FCX_CFG.limiteItem, que pinta o
   alerta na lista) e no robô (FCX_LIMITE_ITEM, que conta quantos alertas o card mostra).
   Se um mudar sem o outro, o card diz "3 alertas" e a lista mostra 5, sem erro nenhum
   aparecer. Este teste lê os dois arquivos e cobra que sejam iguais.
   ================================================================== */
console.log("\n-- o limite do painel e o do robô têm que ser o mesmo número --");
{
  const fsx = require("fs"), pathx = require("path");
  const raiz = pathx.join(__dirname, "..", "..");
  const fonte = fsx.readFileSync(pathx.join(raiz, "scripts", "demoDashboard.ts"), "utf8");
  const robo  = fsx.readFileSync(pathx.join(raiz, "scripts", "buildVrData.cjs"), "utf8");

  const mPainel = fonte.match(/limiteItem:\s*([0-9.]+)/);
  const mRobo   = robo.match(/FCX_LIMITE_ITEM\s*=\s*([0-9.]+)/);
  eq("o painel declara o limite do item", mPainel ? mPainel[1] : "NAO ACHEI", "0.50");
  eq("o robô declara o limite do item", mRobo ? mRobo[1] : "NAO ACHEI", "0.50");
  eq("e os dois são o MESMO número",
     (mPainel && mRobo) ? String(Number(mPainel[1]) === Number(mRobo[1])) : "false", "true");

  const mGrupoPainel = fonte.match(/erro:\s*\[([0-9,\s]+)\]/);
  const mGrupoRobo   = robo.match(/erro:\s*\[([0-9,\s]+)\]/);
  const limpa = (x) => x ? x[1].replace(/\s/g, "") : "NAO ACHEI";
  eq("a classificação de 'erro de operação' é a mesma nos dois",
     limpa(mGrupoPainel), limpa(mGrupoRobo));
}

console.log("\n" + ok + " OK, " + falhou + " falha(s)");
process.exit(falhou ? 1 : 0);
