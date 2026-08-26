// Testes do dia a dia -> mês (Venda por setor ao vivo).
// Extrai o módulo do painel gerado, entre ==VSDIACALC-INICIO== e ==VSDIACALC-FIM==.
//   node scripts/testes/vendasetor-dia.test.cjs
const fs = require("fs");
const path = require("path");

const HTML = fs.readFileSync(path.join(__dirname, "..", "..", "output", "index.html"), "utf8");
const ini = HTML.indexOf("==VSDIACALC-INICIO==");
const fim = HTML.indexOf("==VSDIACALC-FIM==");
if (ini < 0 || fim < 0) { console.log("ERRO: não achei o módulo no output/index.html (rode o build antes)."); process.exit(1); }
const codigo = HTML.slice(HTML.indexOf("*/", ini) + 2, HTML.lastIndexOf("/*", fim));
const M = new Function(codigo + "\nreturn {vsdParaMeses,vsdUltimoDia,vsdParcial,vsdMesCorrente};")();

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + obtido + (bate ? "" : "   (esperado: " + esperado + ")"));
  bate ? ok++ : falhou++;
}
const d2 = (v) => v === null ? "null" : (Math.round(v * 100) / 100).toFixed(2);
const D = (data, setor, quantidade) => ({ data, setor, quantidade });

// ===========================================================================
// O MÊS CORRENTE NASCE INCOMPLETO. Sem essa marca, agosto entra pela metade
// contra o agosto inteiro do ano passado e TODO setor aparece despencando —
// foi exatamente o que o relatório de 25/08/2026 mostrou.
// ===========================================================================
{
  const L = [D("2026-07-31", "Bebidas", 100), D("2026-08-01", "Bebidas", 10), D("2026-08-02", "Bebidas", 10)];
  const m = M.vsdParaMeses(L, "2026-08-26");
  const jul = m.find((x) => x.mes === 7), ago = m.find((x) => x.mes === 8);
  eq("julho fechou", jul.completo, true);
  eq("agosto não", ago.completo, false);
  eq("julho somou", jul.quantidade, 100);
  eq("agosto somou o que já tem", ago.quantidade, 20);
}

// ===========================================================================
// "ATÉ QUE DIA" SAI DO ÚLTIMO DIA COM VENDA, NÃO DA DATA DE HOJE.
// Se o robô parar de rodar numa sexta, no domingo a tela ainda compara até
// sexta nos dois anos — em vez de contar dois dias vazios como queda.
// ===========================================================================
{
  const L = [D("2026-08-01", "Bebidas", 10), D("2026-08-02", "Bebidas", 10), D("2026-08-03", "Bebidas", 10)];
  eq("último dia com venda", M.vsdUltimoDia(L, 2026, 8), 3);
  eq("mês sem venda nenhuma", M.vsdUltimoDia(L, 2026, 9), null);
}

// ===========================================================================
// A COMPARAÇÃO JUSTA: mesmo pedaço nos dois anos
// ===========================================================================
{
  const L = [];
  // 2025: dez dias, 10 por dia = 100 no mês
  for (let d = 1; d <= 10; d++) L.push(D("2025-08-" + String(d).padStart(2, "0"), "Bebidas", 10));
  // 2026: três dias, 12 por dia = 36 até agora
  for (let d = 1; d <= 3; d++) L.push(D("2026-08-" + String(d).padStart(2, "0"), "Bebidas", 12));
  const c = M.vsdMesCorrente(L, 2026, 8, "Bebidas");
  eq("compara até o dia 3", c.ateDia, 3);
  eq("2026 até agora", c.para, 36);
  eq("2025 no MESMO pedaço (1 a 3)", c.de, 30);
  eq("variação justa: +20%", d2(c.variacao), "20.00");

  // a prova do contrário: contra o mês INTEIRO de 2025 daria -64%, uma mentira
  eq("(mês inteiro de 2025 seria)", M.vsdParcial(L, 2025, 8, 31, "Bebidas"), 100);
  eq("(e daria esta falsa queda)", d2((36 / 100 - 1) * 100), "-64.00");
}

// ===========================================================================
// Cada setor por si; e o ano anterior sem venda não vira queda de 100%
// ===========================================================================
{
  // tres dias: menos que isso a regra nova segura a variacao de proposito
  const L = [];
  for (let d = 1; d <= 3; d++) {
    L.push(D("2026-08-0" + d, "Bebidas", 10), D("2026-08-0" + d, "Padaria", 50));
    L.push(D("2025-08-0" + d, "Bebidas", 8),  D("2025-08-0" + d, "Padaria", 40));
  }
  eq("Bebidas", d2(M.vsdMesCorrente(L, 2026, 8, "Bebidas").variacao), "25.00");
  eq("Padaria", d2(M.vsdMesCorrente(L, 2026, 8, "Padaria").variacao), "25.00");
  eq("sem setor: soma a loja", M.vsdParcial(L, 2026, 8, 31, null), 180);
  const N = [D("2026-08-01", "Novo", 10), D("2026-08-02", "Novo", 10), D("2026-08-03", "Novo", 10)];
  eq("produto novo: sem base, variação null", M.vsdMesCorrente(N, 2026, 8, "Novo").variacao, null);
  eq("mês sem dado nenhum devolve null", M.vsdMesCorrente(N, 2026, 9, "Novo"), null);
}

// ===========================================================================
// O DIA DE HOJE NAO CONTA. O robo regrava a linha de hoje a cada 20 minutos com a
// venda ate aquele minuto. Em 26/08/2026, as 15h34, o dia 26 tinha 39% de um dia
// inteiro — e comparado com o dia 26 CHEIO de 2025 ele sozinho empurrava agosto de
// -4,42% pra -6,66%. Dois pontos e um quarto de queda que nao existiam.
// ===========================================================================
{
  const L = [];
  for (let d = 1; d <= 5; d++) L.push(D("2025-08-0" + d, "Bebidas", 100));
  for (let d = 1; d <= 4; d++) L.push(D("2026-08-0" + d, "Bebidas", 100));
  L.push(D("2026-08-05", "Bebidas", 39));           // hoje, so 39% do dia

  eq("sem saber que dia e hoje, para no ultimo com venda", M.vsdUltimoDia(L, 2026, 8), 5);
  eq("sabendo que hoje e dia 5, para no dia 4", M.vsdUltimoDia(L, 2026, 8, "2026-08-05"), 4);

  const errado = M.vsdMesCorrente(L, 2026, 8, "Bebidas");
  const certo  = M.vsdMesCorrente(L, 2026, 8, "Bebidas", "2026-08-05");
  eq("com o meio dia dentro: falsa queda", d2(errado.variacao), "-12.20");
  eq("sem o meio dia: empate, que e a verdade", d2(certo.variacao), "0.00");
  eq("e para no dia 4", certo.ateDia, 4);

  // o robo parou de rodar: o corte pelo ultimo dia com venda continua valendo
  const parado = [];
  for (let d = 1; d <= 5; d++) parado.push(D("2025-08-0" + d, "Bebidas", 100));
  for (let d = 1; d <= 3; d++) parado.push(D("2026-08-0" + d, "Bebidas", 100));
  eq("robo parado no dia 3, hoje e dia 9: para no 3", M.vsdUltimoDia(parado, 2026, 8, "2026-08-09"), 3);
  eq("e nao conta os dias vazios como queda", d2(M.vsdMesCorrente(parado, 2026, 8, "Bebidas", "2026-08-09").variacao), "0.00");
}

// ===========================================================================
// MENOS DE TRES DIAS FECHADOS NAO VIRA PORCENTAGEM. No dia 2 o mes tem UM dia; se
// esse dia cai num sabado de um lado e numa terca do outro, a "variacao" passa de
// 80% sem nada ter acontecido na loja.
// ===========================================================================
{
  const L = [D("2025-08-01", "Bebidas", 100), D("2025-08-02", "Bebidas", 100), D("2025-08-03", "Bebidas", 100),
             D("2026-08-01", "Bebidas", 180), D("2026-08-02", "Bebidas", 100), D("2026-08-03", "Bebidas", 100)];

  const dia2 = M.vsdMesCorrente(L, 2026, 8, "Bebidas", "2026-08-02");   // 1 dia fechado
  eq("dia 2: um dia fechado so", dia2.ateDia, 1);
  eq("dia 2: marca poucos dias", dia2.poucos, true);
  eq("dia 2: NAO inventa porcentagem", dia2.variacao, null);
  eq("dia 2: mas os numeros continuam la", dia2.para + "/" + dia2.de, "180/100");

  const dia4 = M.vsdMesCorrente(L, 2026, 8, "Bebidas", "2026-08-04");   // 3 dias fechados
  eq("dia 4: tres dias fechados", dia4.ateDia, 3);
  eq("dia 4: ja pode comparar", dia4.poucos, false);
  eq("dia 4: +26,67%", d2(dia4.variacao), "26.67");

  const dia1 = M.vsdMesCorrente(L, 2026, 8, "Bebidas", "2026-08-01");   // nenhum dia fechado
  eq("dia 1o do mes: nada fechado ainda", dia1, null);
}

console.log("\n" + ok + " ok, " + falhou + " falha(s).");
process.exit(falhou ? 1 : 0);
