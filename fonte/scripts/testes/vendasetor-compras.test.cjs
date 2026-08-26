// Testes do card de compras (Venda por setor -> clicar no produto).
// Extrai o módulo do painel gerado, entre ==VSCOMPCALC-INICIO== e ==VSCOMPCALC-FIM==.
//   node scripts/testes/vendasetor-compras.test.cjs
const fs = require("fs");
const path = require("path");

const HTML = fs.readFileSync(path.join(__dirname, "..", "..", "output", "index.html"), "utf8");
const ini = HTML.indexOf("==VSCOMPCALC-INICIO==");
const fim = HTML.indexOf("==VSCOMPCALC-FIM==");
if (ini < 0 || fim < 0) { console.log("ERRO: não achei o módulo no output/index.html (rode o build antes)."); process.exit(1); }
const codigo = HTML.slice(HTML.indexOf("*/", ini) + 2, HTML.lastIndexOf("/*", fim));
const M = new Function(codigo + "\nreturn {vscpDoAno,vscpResumo,vscpMaiorIntervalo,vscpFornecedores};")();

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + obtido + (bate ? "" : "   (esperado: " + esperado + ")"));
  bate ? ok++ : falhou++;
}
const E = (data, unidades, custo, fornecedor) => ({ data, unidades, custo, fornecedor, nota: "1" });

// ===========================================================================
// Números REAIS do açúcar (ACUCAR ECOCUCAR 1KG), medidos no VR em 26/08/2026.
// A nota diz 480, mas são 480 FARDOS de 30 = 14.400 unidades. O robô já manda
// convertido; se um dia alguém "simplificar" isso, este teste quebra.
// ===========================================================================
const ACUCAR = [
  E("2025-01-10", 15000, 3.40, "VALE VERDE - BAIA FORMOSA"),
  E("2025-03-04", 15000, 3.20, "VALE VERDE - BAIA FORMOSA"),
  E("2025-04-04", 15000, 3.3334, "VALE VERDE - BAIA FORMOSA"),
  E("2025-05-06", 15000, 3.40, "VALE VERDE - BAIA FORMOSA"),
  E("2025-05-21", 14400, 3.4334, "VALE VERDE - BAIA FORMOSA"),
  E("2025-07-15", 14400, 3.3666, "VALE VERDE - BAIA FORMOSA"),
  E("2025-10-29", 14400, 3.0666, "VALE VERDE - BAIA FORMOSA"),
  E("2026-01-09", 14400, 2.70, "VALE VERDE - BAIA FORMOSA"),
  E("2026-02-25", 14400, 2.6666, "VALE VERDE - BAIA FORMOSA"),
  E("2026-03-13", 14400, 2.6666, "VALE VERDE - BAIA FORMOSA"),
  E("2026-06-05", 14400, 2.53, "ANICUNS S/A"),
  E("2026-07-08", 14400, 2.6666, "VALE VERDE - BAIA FORMOSA")
];
{
  const a = M.vscpResumo(ACUCAR, 2025), b = M.vscpResumo(ACUCAR, 2026);
  eq("entradas em 2025", a.entradas, 7);
  eq("unidades em 2025", a.unidades, 103200);
  eq("entradas em 2026", b.entradas, 5);
  eq("unidades em 2026", b.unidades, 72000);
  eq("custo médio caiu", a.custoMedio > b.custoMedio, true);
  eq("primeira de 2026", b.primeira, "2026-01-09");
  eq("última de 2026", b.ultima, "2026-07-08");
}

// ===========================================================================
// O BURACO ENTRE COMPRAS. É a conta que ninguém pede e explica queda de venda:
// se não chegou, não teve o que vender. No açúcar foram 84 dias em 2026.
// ===========================================================================
{
  const g = M.vscpMaiorIntervalo(ACUCAR, 2026);
  eq("maior intervalo em 2026 (dias)", g.dias, 84);
  eq("começou em", g.de, "2026-03-13");
  eq("terminou em", g.ate, "2026-06-05");
  // 2025 teve um buraco AINDA MAIOR: 15/07 a 29/10, 106 dias. Isso importa pra leitura —
  // 84 dias sem entrar não é anormal para este produto, é o padrão dele. O alerta na tela
  // é CONTEXTO, não prova de que faltou.
  const g25 = M.vscpMaiorIntervalo(ACUCAR, 2025);
  eq("maior intervalo em 2025 (dias)", g25.dias, 106);
  eq("e foi jul->out", g25.de + " a " + g25.ate, "2025-07-15 a 2025-10-29");
  eq("uma entrada só não tem intervalo", M.vscpMaiorIntervalo([E("2026-01-01", 10, 1, "X")], 2026), null);
  eq("nenhuma entrada também não", M.vscpMaiorIntervalo([], 2026), null);
}

// ===========================================================================
// Fornecedores: quantos e quem foi o último (o último importa — é com quem se fala)
// ===========================================================================
{
  const f = M.vscpFornecedores(ACUCAR);
  eq("quantos fornecedores", f.quantos, 2);
  eq("o último é o mais recente por DATA", f.ultimo, "VALE VERDE - BAIA FORMOSA");
  const f2 = M.vscpFornecedores([E("2026-01-01", 1, 1, "A"), E("2026-06-01", 1, 1, "B")]);
  eq("com dois, pega o de junho", f2.ultimo, "B");
  eq("fornecedor em branco não conta", M.vscpFornecedores([E("2026-01-01", 1, 1, "")]).quantos, 0);
}

// ===========================================================================
// Bordas
// ===========================================================================
{
  eq("ano sem entrada: zero", M.vscpResumo(ACUCAR, 2024).unidades, 0);
  eq("ano sem entrada: custo médio null", M.vscpResumo(ACUCAR, 2024).custoMedio, null);
  eq("custo ausente não vira zero", M.vscpResumo([E("2026-01-01", 100, null, "X")], 2026).custoMedio, null);
  eq("mas as unidades contam", M.vscpResumo([E("2026-01-01", 100, null, "X")], 2026).unidades, 100);
  eq("do ano certo, em ordem", M.vscpDoAno(ACUCAR, 2026).map(x => x.data).join(" "),
     "2026-01-09 2026-02-25 2026-03-13 2026-06-05 2026-07-08");
}

console.log("\n" + ok + " ok, " + falhou + " falha(s).");
process.exit(falhou ? 1 : 0);
