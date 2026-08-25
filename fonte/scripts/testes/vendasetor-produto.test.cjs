// Testes de "quem caiu / quem cresceu" por setor (Venda por setor).
// Extrai o módulo do painel gerado, entre ==VSPCALC-INICIO== e ==VSPCALC-FIM==.
//   node scripts/testes/vendasetor-produto.test.cjs
const fs = require("fs");
const path = require("path");

const HTML = fs.readFileSync(path.join(__dirname, "..", "..", "output", "index.html"), "utf8");
const ini = HTML.indexOf("==VSPCALC-INICIO==");
const fim = HTML.indexOf("==VSPCALC-FIM==");
if (ini < 0 || fim < 0) { console.log("ERRO: não achei o módulo no output/index.html (rode o build antes)."); process.exit(1); }
const codigo = HTML.slice(HTML.indexOf("*/", ini) + 2, HTML.lastIndexOf("/*", fim));
const M = new Function(codigo + "\nreturn {vspLista,vspSetores,vspResumo};")();

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + obtido + (bate ? "" : "   (esperado: " + esperado + ")"));
  bate ? ok++ : falhou++;
}
const d2 = (v) => v === null ? "null" : (Math.round(v * 100) / 100).toFixed(2);
// uma linha como o robô manda
const L = (s, de, para, nome, qd, qp, m = 7) => ({ s, de, para, id: nome, nome, qd, qp, m });

// ===========================================================================
// A ORDEM É PELO TAMANHO DA DIFERENÇA, NÃO PELA PORCENTAGEM.
// Um produto que vendia 5 e caiu pra 1 é -80%, mas são 4 unidades: não muda nada.
// Um que vendia 30.000 e caiu pra 26.400 é -12%, mas são 3.600 unidades.
// Ordenar por % põe o irrelevante no topo e esconde o que importa.
// ===========================================================================
{
  const D = [L("NOVO BEBIDAS", 2025, 2026, "MIUDO", 5, 1),
             L("NOVO BEBIDAS", 2025, 2026, "GRANDE", 30000, 26400)];
  const r = M.vspLista(D, "NOVO BEBIDAS", 2025, 2026);
  eq("o de maior volume vem primeiro", r[0].nome, "GRANDE");
  eq("mesmo tendo caído menos em %", d2(r[0].variacao), "-12.00");
  eq("o miúdo cai -80% e fica embaixo", d2(r[1].variacao), "-80.00");
}

// ===========================================================================
// Parou de vender: é a maior queda possível e NÃO pode sumir da lista
// ===========================================================================
{
  const D = [L("NOVO BEBIDAS", 2025, 2026, "SUMIU", 8000, 0),
             L("NOVO BEBIDAS", 2025, 2026, "CAIU", 8000, 7000)];
  const r = M.vspLista(D, "NOVO BEBIDAS", 2025, 2026);
  eq("quem parou de vender lidera", r[0].nome, "SUMIU");
  eq("marcado como sumiu", r[0].sumiu, true);
  eq("e a variação é -100%", d2(r[0].variacao), "-100.00");
  eq("quem só caiu não é marcado", r[1].sumiu, false);
}

// ===========================================================================
// Produto novo: não inventa porcentagem (dividir por zero)
// ===========================================================================
{
  const D = [L("NOVO BEBIDAS", 2025, 2026, "NOVO", 0, 5000)];
  const r = M.vspLista(D, "NOVO BEBIDAS", 2025, 2026)[0];
  eq("variação de produto novo é null", r.variacao, null);
  eq("marcado como novo", r.novo, true);
  eq("mas a diferença existe", r.dif, 5000);
}

// ===========================================================================
// Filtra por setor E por par de anos
// ===========================================================================
{
  const D = [L("NOVO BEBIDAS", 2025, 2026, "CERVEJA", 100, 50),
             L("NOVO - MERCEARIA", 2025, 2026, "ARROZ", 100, 50),
             L("NOVO BEBIDAS", 2024, 2025, "CERVEJA", 200, 100)];
  eq("só o setor pedido", M.vspLista(D, "NOVO BEBIDAS", 2025, 2026).length, 1);
  eq("e só o par de anos pedido", M.vspLista(D, "NOVO BEBIDAS", 2025, 2026)[0].de, 100);
  eq("o outro par existe separado", M.vspLista(D, "NOVO BEBIDAS", 2024, 2025)[0].de, 200);
  eq("setores disponíveis", M.vspSetores(D).join(" | "), "NOVO - MERCEARIA | NOVO BEBIDAS");
}

// ===========================================================================
// Resumo: quanto caiu, quanto subiu, e o líquido
// ===========================================================================
{
  const D = [L("S", 2025, 2026, "A", 100, 40),    // -60
             L("S", 2025, 2026, "B", 100, 130),   // +30
             L("S", 2025, 2026, "C", 50, 50),     //   0 (não conta pra lado nenhum)
             L("S", 2025, 2026, "D", 200, 190)];  // -10
  const r = M.vspResumo(M.vspLista(D, "S", 2025, 2026));
  eq("quantos caíram", r.nCaiu, 2);
  eq("quanto caiu", r.caiu, 70);
  eq("quantos subiram", r.nSubiu, 1);
  eq("quanto subiu", r.subiu, 30);
  eq("líquido", r.liquido, -40);
  eq("o empatado não entra em nenhum lado", r.nCaiu + r.nSubiu, 3);
}

// ===========================================================================
// Números REAIS: as cervejas que o Victor viu em 25/08/2026
// ===========================================================================
{
  const D = [L("NOVO BEBIDAS", 2025, 2026, "CERV BUDWEISER 350ML LATA SLEEK", 32489, 15125),
             L("NOVO BEBIDAS", 2025, 2026, "CERV DEVASSA 350ML LT", 33416, 19847),
             L("NOVO BEBIDAS", 2025, 2026, "CERV ITAIPAVA 350ML PILSEN LATA", 11761, 16652)];
  const r = M.vspLista(D, "NOVO BEBIDAS", 2025, 2026);
  eq("Budweiser é a maior queda em unidades", r[0].nome.indexOf("BUDWEISER") >= 0, true);
  eq("Budweiser em %", d2(r[0].variacao), "-53.45");
  eq("Devassa em %", d2(r[1].variacao), "-40.61");
  eq("Itaipava subiu e vai pro fim", r[2].nome.indexOf("ITAIPAVA") >= 0, true);
  eq("Itaipava em %", d2(r[2].variacao), "41.59");
}

console.log("\n" + ok + " ok, " + falhou + " falha(s).");
process.exit(falhou ? 1 : 0);
