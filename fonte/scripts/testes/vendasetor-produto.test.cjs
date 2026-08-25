// Testes do detalhe por produto (Venda por setor).
// Extrai o módulo do painel gerado, entre ==VSPCALC-INICIO== e ==VSPCALC-FIM==.
//   node scripts/testes/vendasetor-produto.test.cjs
const fs = require("fs");
const path = require("path");

const HTML = fs.readFileSync(path.join(__dirname, "..", "..", "output", "index.html"), "utf8");
const ini = HTML.indexOf("==VSPCALC-INICIO==");
const fim = HTML.indexOf("==VSPCALC-FIM==");
if (ini < 0 || fim < 0) { console.log("ERRO: não achei o módulo no output/index.html (rode o build antes)."); process.exit(1); }
const codigo = HTML.slice(HTML.indexOf("*/", ini) + 2, HTML.lastIndexOf("/*", fim));
const M = new Function(codigo + "\nreturn {vspMes,vspAno,vspDoSetor,vspComparar,vspCobertura};")();

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + obtido + (bate ? "" : "   (esperado: " + esperado + ")"));
  bate ? ok++ : falhou++;
}
const d2 = (v) => v === null ? "null" : (Math.round(v * 100) / 100).toFixed(2);
const P = (m, id, nome, s, qtd) => ({ m, id, nome, s, qtd, fat: qtd * 10 });
const JAN_JUL = [1, 2, 3, 4, 5, 6, 7];

// ===========================================================================
// A ARMADILHA PRINCIPAL: o produto entra e sai do top-300.
// Se ele aparece em 7 meses de 2025 e só em 3 de 2026, somar tudo compara
// 7 meses contra 3 e inventa uma queda de 57% que não existe.
// ===========================================================================
{
  const L = [];
  for (let m = 1; m <= 7; m++) L.push(P("2025-0" + m, "1", "COCA 2L", "NOVO BEBIDAS", 100));
  for (const m of [1, 2, 3]) L.push(P("2026-0" + m, "1", "COCA 2L", "NOVO BEBIDAS", 100));
  const r = M.vspComparar(L, "NOVO BEBIDAS", 2025, 2026, JAN_JUL)[0];
  eq("compara só os meses dos dois lados", r.meses, 3);
  eq("2025 usa só esses 3 meses", r.de, 300);
  eq("2026 idem", r.para, 300);
  eq("resultado: empate, não -57%", d2(r.variacao), "0.00");
}

// ===========================================================================
// Produto que aparece só num dos anos: entra marcado, sem % inventada
// ===========================================================================
{
  const L = [P("2025-01", "9", "SUMIU", "NOVO BEBIDAS", 50),
             P("2026-01", "8", "CHEGOU", "NOVO BEBIDAS", 70),
             P("2025-01", "1", "NORMAL", "NOVO BEBIDAS", 100),
             P("2026-01", "1", "NORMAL", "NOVO BEBIDAS", 80)];
  const r = M.vspComparar(L, "NOVO BEBIDAS", 2025, 2026, JAN_JUL);
  const sumiu = r.find((x) => x.nome === "SUMIU");
  const chegou = r.find((x) => x.nome === "CHEGOU");
  eq("quem sumiu: sem variação", sumiu.variacao, null);
  eq("quem sumiu: marcado no ano certo", sumiu.soEm, 2025);
  eq("quem chegou: marcado no ano certo", chegou.soEm, 2026);
  eq("quem dá pra medir vem primeiro", r[0].nome, "NORMAL");
  eq("e os sem medida vão pro fim", r[r.length - 1].variacao, null);
}

// ===========================================================================
// Só o setor pedido entra; e só os meses que a página do setor permite
// ===========================================================================
{
  const L = [P("2025-01", "1", "CERVEJA", "NOVO BEBIDAS", 100), P("2026-01", "1", "CERVEJA", "NOVO BEBIDAS", 90),
             P("2025-01", "2", "ARROZ", "NOVO - MERCEARIA", 100), P("2026-01", "2", "ARROZ", "NOVO - MERCEARIA", 50),
             P("2025-08", "1", "CERVEJA", "NOVO BEBIDAS", 999), P("2026-08", "1", "CERVEJA", "NOVO BEBIDAS", 1)];
  const r = M.vspComparar(L, "NOVO BEBIDAS", 2025, 2026, JAN_JUL);
  eq("só produtos do setor pedido", r.length, 1);
  eq("é a cerveja", r[0].nome, "CERVEJA");
  eq("agosto fora: não entra na conta", r[0].de, 100);
  eq("variação sem agosto", d2(r[0].variacao), "-10.00");
}

// ===========================================================================
// Ordem: do que mais caiu ao que mais cresceu
// ===========================================================================
{
  const L = [];
  const par = (id, nome, a, b) => { L.push(P("2025-01", id, nome, "NOVO BEBIDAS", a)); L.push(P("2026-01", id, nome, "NOVO BEBIDAS", b)); };
  par("1", "SOBE", 100, 130);
  par("2", "DESPENCA", 100, 40);
  par("3", "CAI POUCO", 100, 95);
  const r = M.vspComparar(L, "NOVO BEBIDAS", 2025, 2026, JAN_JUL);
  eq("ordem dos nomes", r.map((x) => x.nome).join(" > "), "DESPENCA > CAI POUCO > SOBE");
}

// ===========================================================================
// Cobertura: a tela não pode fingir que os 300 são o setor inteiro
// ===========================================================================
{
  const L = [P("2025-01", "1", "A", "NOVO BEBIDAS", 100), P("2026-01", "1", "A", "NOVO BEBIDAS", 80),
             P("2025-01", "2", "B", "NOVO BEBIDAS", 50), P("2026-01", "2", "B", "NOVO BEBIDAS", 60),
             P("2025-01", "3", "SO2025", "NOVO BEBIDAS", 999)];
  const c = M.vspCobertura(M.vspComparar(L, "NOVO BEBIDAS", 2025, 2026, JAN_JUL));
  eq("soma só o que dá pra medir (2025)", c.de, 150);
  eq("soma só o que dá pra medir (2026)", c.para, 140);
  eq("quantos medidos", c.medidos, 2);
  eq("quantos sem medida", c.semMedida, 1);
}

// ===========================================================================
// Base zero não vira queda de 100%
// ===========================================================================
{
  const L = [P("2025-01", "1", "X", "NOVO BEBIDAS", 0), P("2026-01", "1", "X", "NOVO BEBIDAS", 90)];
  eq("dividir por zero devolve null", M.vspComparar(L, "NOVO BEBIDAS", 2025, 2026, JAN_JUL)[0].variacao, null);
}

console.log("\n" + ok + " ok, " + falhou + " falha(s).");
process.exit(falhou ? 1 : 0);
