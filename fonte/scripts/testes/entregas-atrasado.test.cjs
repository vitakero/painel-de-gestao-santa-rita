// Entregas — DIA ATRASADO.
// O dia útil que já passou e ninguém lançou tinha a mesma cara de uma coluna qualquer
// ainda por preencher. Estes testes cobram a regra que separa os dois: o "dia da vez"
// (serviço de hoje, verde) e o dia que ficou para trás (amarelo).
// NÃO duplica a lógica: extrai o módulo do painel já gerado (output/index.html).
//   node scripts/testes/entregas-atrasado.test.cjs
const fs = require("fs");
const path = require("path");

const HTML = fs.readFileSync(path.join(__dirname, "..", "..", "output", "index.html"), "utf8");
const ini = HTML.indexOf("==ENTCALC-INICIO==");
const fim = HTML.indexOf("==ENTCALC-FIM==");
if (ini < 0 || fim < 0) { console.log("ERRO: não achei o módulo de cálculo no output/index.html (rode o build antes)."); process.exit(1); }
const codigo = HTML.slice(HTML.indexOf("*/", ini) + 2, HTML.lastIndexOf("/*", fim));
const M = new Function(codigo + "\nreturn {entcDiaDaVez,entcDiasAtrasados};")();

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  [" + obtido + "]" + (bate ? "" : "   (esperado: [" + esperado + "])"));
  bate ? ok++ : falhou++;
}

// ---------------------------------------------------------------------------
// SETEMBRO/2026 — o mês da queixa. Dia 1 = terça, 2 = quarta, 3 = quinta (hoje).
// Domingos: 6, 13, 20, 27. Sem feriado.
// ---------------------------------------------------------------------------
const A = 2026, SET = 8;
const soDomingo = (a, m, d) => new Date(a, m, d).getDay() === 0;
const HOJE3 = new Date(2026, 8, 3);            // quinta-feira, dia 3
const nada = () => false;                       // nada apurado
const tudo = () => true;                        // tudo apurado

console.log("\n== O dia da vez ==");
eq("quinta dia 3: o dia da vez é o 2", M.entcDiaDaVez(A, SET, soDomingo, HOJE3), 2);
eq("segunda dia 7: pula o domingo 6 e cai no sábado 5",
   M.entcDiaDaVez(A, SET, soDomingo, new Date(2026, 8, 7)), 5);
eq("dia 1 do mês: não existe dia da vez", M.entcDiaDaVez(A, SET, soDomingo, new Date(2026, 8, 1)), 0);
eq("outro mês não tem dia da vez", M.entcDiaDaVez(A, 7, soDomingo, HOJE3), 0);

console.log("\n== A QUEIXA: dias 1 e 2 em branco, hoje é quinta ==");
eq("o 1 está atrasado; o 2 é o serviço de hoje e fica de fora",
   M.entcDiasAtrasados(A, SET, soDomingo, nada, HOJE3), "1");

console.log("\n== O que NÃO pode virar atraso ==");
eq("dia de hoje nunca é atraso (ele ainda está acontecendo)",
   M.entcDiasAtrasados(A, SET, soDomingo, (d) => d < 3, HOJE3).indexOf(3), -1);
eq("dia futuro nunca é atraso",
   M.entcDiasAtrasados(A, SET, soDomingo, nada, HOJE3).filter((d) => d > 3).length, 0);
eq("domingo nunca é atraso",
   M.entcDiasAtrasados(A, SET, soDomingo, nada, new Date(2026, 8, 10)).indexOf(6), -1);
eq("mês todo apurado: nenhum atraso",
   M.entcDiasAtrasados(A, SET, soDomingo, tudo, new Date(2026, 8, 30)).length, 0);

console.log("\n== Vários dias para trás ==");
// Dia 10 (quinta). Dia da vez = 9. Apurados: 1, 2, 3. Faltam 4, 5, 7, 8 (6 é domingo).
eq("lista todos os dias úteis esquecidos, sem o dia da vez",
   M.entcDiasAtrasados(A, SET, soDomingo, (d) => d <= 3, new Date(2026, 8, 10)), "4,5,7,8");
eq("o dia da vez (9) fica fora mesmo em branco",
   M.entcDiasAtrasados(A, SET, soDomingo, (d) => d <= 3, new Date(2026, 8, 10)).indexOf(9), -1);

console.log("\n== O atraso some quando o dia é preenchido ==");
eq("preencheu o 1: não sobra atraso nenhum",
   M.entcDiasAtrasados(A, SET, soDomingo, (d) => d === 1, HOJE3).length, 0);

console.log("\n== Feriado no meio ==");
// 7 de setembro é feriado. Fechado = domingo OU dia 7.
const comFeriado = (a, m, d) => soDomingo(a, m, d) || d === 7;
eq("feriado não vira atraso e o dia da vez pula ele",
   M.entcDiaDaVez(A, SET, comFeriado, new Date(2026, 8, 8)), 5);
// Dia 9 (quarta): o dia da vez é o 8. Sobram 1..5 — o 6 é domingo e o 7 é feriado.
eq("feriado fora da lista de atrasados",
   M.entcDiasAtrasados(A, SET, comFeriado, nada, new Date(2026, 8, 9)), "1,2,3,4,5");

console.log("\n" + (falhou ? "FALHOU: " + falhou + " de " + (ok + falhou) : "TUDO OK: " + ok + " testes"));
process.exit(falhou ? 1 : 0);
