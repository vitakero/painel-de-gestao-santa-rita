// Testes da CLASSIFICAÇÃO do que está digitado e não salvo nas Entregas.
//
// Nasceu de um caso real (12/08/2026): o dono apagou os números de um dia JÁ ENCERRADO
// e não existia botão nenhum pra mandar a correção. Ela ficava presa no navegador dele
// enquanto o funcionário continuava vendo o número velho no servidor — e o funcionário
// não podia consertar, porque quem não é master é barrado em dia encerrado.
//
// A regra separa três situações, e cada uma tem um botão diferente. Se um dia caísse na
// gaveta errada, o botão mandaria o dia errado pro servidor.
//   node scripts/testes/entregas-correcao.test.cjs
const fs = require("fs");
const path = require("path");

const HTML = fs.readFileSync(path.join(__dirname, "..", "..", "output", "index.html"), "utf8");
const ini = HTML.indexOf("==ENTRAS-INICIO==");
const fim = HTML.indexOf("==ENTRAS-FIM==");
if (ini < 0 || fim < 0) { console.log("ERRO: não achei o módulo ENTRAS (rode o build antes)."); process.exit(1); }
const codigo = HTML.slice(HTML.indexOf("*/", ini) + 2, HTML.lastIndexOf("/*", fim));

// O módulo mexe em localStorage na carga; dublê mínimo para ele rodar isolado.
const APOIO = `
  var loja={};
  var localStorage={ getItem:function(k){ return (k in loja)?loja[k]:null; },
                     setItem:function(k,v){ loja[k]=String(v); },
                     removeItem:function(k){ delete loja[k]; } };
  var window={ localStorage:localStorage };
  function entMesKey(a,m){ return a+"-"+(m+1); }
`;
const M = new Function(APOIO + codigo + "\nreturn {entRasClassifica:entRasClassifica, entRasDiaVazio:entRasDiaVazio};")();

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + obtido + (bate ? "" : "   (esperado: " + esperado + ")"));
  bate ? ok++ : falhou++;
}
const conf = (...dias) => (d) => dias.indexOf(d) >= 0;
const C = (rascunho, confirmados, prontos) => M.entRasClassifica(rascunho, conf(...confirmados), prontos);

console.log("\n=== Entregas — para onde vai cada dia digitado ===\n");

// O caso que originou tudo: dia 11 encerrado, o master apagou os números.
{
  const r = C([11], [11], []);
  eq("1) dia encerrado com alteração -> CORREÇÃO", r.correcao.join(","), "11");
  eq("2) e não vai pra fila de lançamento", r.parcial.length + "|" + r.pronto.length, "0|0");
}

// Dia aberto e completo: é o Salvar de sempre, que grava E encerra.
{
  const r = C([10], [], [10]);
  eq("3) dia aberto e completo -> PRONTO", r.pronto.join(","), "10");
  eq("4) não vira correção nem parcial", r.correcao.length + "|" + r.parcial.length, "0|0");
}

// Dia aberto e incompleto: dá pra guardar sem encerrar.
{
  const r = C([12], [], []);
  eq("5) dia aberto e incompleto -> PARCIAL", r.parcial.join(","), "12");
  eq("6) não vira pronto", r.pronto.length, "0");
}

// Os três ao mesmo tempo, que é como a vida real acontece.
{
  const r = C([8, 10, 11, 12], [8, 11], [10]);
  eq("7) três situações juntas: correção", r.correcao.join(","), "8,11");
  eq("8) três situações juntas: pronto", r.pronto.join(","), "10");
  eq("9) três situações juntas: parcial", r.parcial.join(","), "12");
  eq("10) nenhum dia se perde no caminho",
     r.correcao.length + r.pronto.length + r.parcial.length, "4");
  eq("11) nenhum dia entra em duas gavetas",
     new Set([...r.correcao, ...r.pronto, ...r.parcial]).size, "4");
}

// ENCERRADO GANHA DE COMPLETO. Um dia encerrado que também está "pronto" não pode voltar
// pra fila de encerrar: encerrar de novo é operação diferente de corrigir.
{
  const r = C([11], [11], [11]);
  eq("12) encerrado vence completo -> correção", r.correcao.join(","), "11");
  eq("13) e nunca 'pronto' (não se encerra duas vezes)", r.pronto.length, "0");
}

// Bordas: nada digitado, e listas ausentes.
{
  eq("14) nada digitado -> tudo vazio",
     [C([], [1], [2]).correcao.length, C([], [1], [2]).parcial.length, C([], [1], [2]).pronto.length].join("|"), "0|0|0");
  const r = M.entRasClassifica(null, conf(), null);
  eq("15) lista ausente não quebra", r.correcao.length + "|" + r.parcial.length + "|" + r.pronto.length, "0|0|0");
  const r2 = M.entRasClassifica([5], conf(), null);
  eq("16) sem lista de prontos, dia aberto é parcial", r2.parcial.join(","), "5");
}

// A ordem dos dias digitados não muda a classificação.
{
  const a = C([12, 8, 10, 11], [8, 11], [10]);
  eq("17) ordem invertida: correção igual", a.correcao.sort((x, y) => x - y).join(","), "8,11");
  eq("18) ordem invertida: parcial igual", a.parcial.join(","), "12");
}

// ---------------------------------------------------------------------------------
// "O DIA FICOU VAZIO?" — apagar TUDO de um dia encerrado não é corrigir, é desfazer o
// lançamento. Aí o dia tem que ser reaberto, senão o funcionário vê a coluna em branco
// e o campo continua trancado (dia encerrado só o administrador digita). Errar isso
// devolve o dia ao funcionário quando não devia, ou deixa ele travado quando devia abrir.
console.log("\n--- o dia ficou vazio? ---\n");
const V = (valores) => M.entRasDiaVazio(Object.keys(valores), (id) => valores[id]);

eq("19) todo mundo em branco -> vazio", V({ a: "", b: "", c: "" }), "true");
eq("20) um número sobrando -> NÃO está vazio", V({ a: "", b: 10, c: "" }), "false");
eq("21) ZERO é número, não é vazio", V({ a: 0, b: 0 }), "false");
eq("22) zero em texto também conta", V({ a: "0", b: "" }), "false");
eq("23) todos com número -> não vazio", V({ a: 10, b: 10 }), "false");
eq("24) sem ninguém cobrado -> não decide nada", V({}), "false");
eq("25) lista ausente não quebra", M.entRasDiaVazio(null, () => ""), "false");
eq("26) um só, em branco -> vazio", V({ a: "" }), "true");
eq("27) um só, com número -> não vazio", V({ a: 1 }), "false");

console.log("");
console.log(falhou ? ("FALHOU: " + falhou + " de " + (ok + falhou)) : ("TUDO OK: " + ok + " testes"));
process.exit(falhou ? 1 : 0);
