// Testes da base de cálculo do módulo Venda por Setor.
// NÃO duplica a lógica: extrai o módulo do painel já gerado (output/index.html), entre
// os marcadores ==VSCALC-INICIO== e ==VSCALC-FIM==, e roda os casos contra ele.
//   node scripts/testes/vendasetor.test.cjs
const fs = require("fs");
const path = require("path");

const HTML = fs.readFileSync(path.join(__dirname, "..", "..", "output", "index.html"), "utf8");
const ini = HTML.indexOf("==VSCALC-INICIO==");
const fim = HTML.indexOf("==VSCALC-FIM==");
if (ini < 0 || fim < 0) { console.log("ERRO: não achei o módulo de cálculo no output/index.html (rode o build antes)."); process.exit(1); }
const codigo = HTML.slice(HTML.indexOf("*/", ini) + 2, HTML.lastIndexOf("/*", fim));

const M = new Function(codigo + "\nreturn {VS_LIMIAR,vscMesesBons,vscMesesComparaveis,vscSoma,vscVariacao,vscClassifica,vscSetores,vscAnos,vscRanking,vscPorMes,vscLoja,vscCaiDoisAnos,vscMesesIgnorados};")();

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + obtido + (bate ? "" : "   (esperado: " + esperado + ")"));
  bate ? ok++ : falhou++;
}
const d2 = (v) => v === null ? "null" : (Math.round(v * 100) / 100).toFixed(2);
const lin = (ano, mes, setor, quantidade, completo) => ({ ano, mes, setor, quantidade, completo: completo !== false });

// ===========================================================================
// REGRA 1 — mês pela metade não entra
// O caso real: relatório tirado em 25/08/2026. Agosto do ano novo veio com meio
// mês. Se entrasse, o setor apareceria despencando sem ter caído.
// ===========================================================================
{
  const L = [];
  for (let m = 1; m <= 8; m++) L.push(lin(2025, m, "Bebidas", 100));
  for (let m = 1; m <= 7; m++) L.push(lin(2026, m, "Bebidas", 100));
  L.push(lin(2026, 8, "Bebidas", 38, false));           // agosto pela metade

  eq("meses bons de 2026 ignoram agosto", M.vscMesesBons(L, 2026).join(","), "1,2,3,4,5,6,7");
  eq("comparáveis param em julho", M.vscMesesComparaveis(L, 2025, 2026).join(","), "1,2,3,4,5,6,7");
  eq("empate, não queda", d2(M.vscRanking(L, 2025, 2026)[0].variacao), "0.00");
  eq("agosto aparece como ignorado", M.vscMesesIgnorados(L, 2026).join(","), "8");

  // a prova do contrário: se agosto entrasse, daria -8,25% do nada
  const comAgosto = M.vscSoma(L, 2026, "Bebidas", [1,2,3,4,5,6,7,8]) / M.vscSoma(L, 2025, "Bebidas", [1,2,3,4,5,6,7,8]);
  // 2025: 8 meses x 100 = 800. 2026: 7 x 100 + os 38 do meio mês = 738. 738/800 = -7,75%.
  eq("(se agosto entrasse, mentiria)", d2((comAgosto - 1) * 100), "-7.75");
}

// ===========================================================================
// REGRA 2 — só compara mês que existe dos dois lados
// ===========================================================================
{
  const L = [];
  for (let m = 1; m <= 12; m++) L.push(lin(2025, m, "Padaria", 50));
  for (let m = 1; m <= 4; m++) L.push(lin(2026, m, "Padaria", 50));
  eq("ano velho entra só até onde o novo vai", M.vscMesesComparaveis(L, 2025, 2026).join(","), "1,2,3,4");
  eq("4 contra 4 dá empate", d2(M.vscRanking(L, 2025, 2026)[0].variacao), "0.00");
  eq("a tela sabe quantos meses usou", M.vscRanking(L, 2025, 2026)[0].meses, 4);
}

// ===========================================================================
// REGRA 3 — menos de meio por cento é empate
// Frios variou -0,01% (26 unidades em 245 mil). Não é setor em queda.
// ===========================================================================
{
  eq("limiar é meio por cento", M.VS_LIMIAR, 0.5);
  eq("-0,01% é empate", M.vscClassifica(-0.01054), "empate");
  eq("-0,35% é empate", M.vscClassifica(-0.35), "empate");
  eq("-0,50% ainda é empate (borda)", M.vscClassifica(-0.5), "empate");
  eq("-0,74% já é queda", M.vscClassifica(-0.74), "queda");
  eq("+0,50% ainda é empate (borda)", M.vscClassifica(0.5), "empate");
  eq("+1,33% é alta", M.vscClassifica(1.33), "alta");
}

// ===========================================================================
// Base zero não vira "queda de 100%"
// ===========================================================================
{
  eq("dividir por zero devolve null", M.vscVariacao(0, 500), "null");
  eq("null é classificado como sem base", M.vscClassifica(null), "sem");
  const L = [lin(2025, 1, "Novo", 0), lin(2026, 1, "Novo", 500),
             lin(2025, 1, "Velho", 100), lin(2026, 1, "Velho", 90)];
  const r = M.vscRanking(L, 2025, 2026);
  eq("setor sem base vai pro fim da lista", r[r.length - 1].setor, "Novo");
  eq("o que dá pra calcular vem antes", r[0].setor, "Velho");
}

// ===========================================================================
// Os doze meses sempre voltam — mês sem comparação volta vazio, não some
// ===========================================================================
{
  const L = [];
  for (let m = 1; m <= 12; m++) L.push(lin(2025, m, "Bazar", 10));
  for (let m = 1; m <= 3; m++) L.push(lin(2026, m, "Bazar", 12));
  const mm = M.vscPorMes(L, 2025, 2026, "Bazar");
  eq("sempre doze posições", mm.length, 12);
  eq("janeiro tem número", d2(mm[0].variacao), "20.00");
  eq("abril volta vazio (não some)", mm[3].variacao, null);
  eq("dezembro volta vazio", mm[11].variacao, null);
}

// ===========================================================================
// Cai há dois anos = tendência. Cair num e subir no outro = oscilação.
// ===========================================================================
{
  const L = [];
  const serie = (ano, setor, q) => { for (let m = 1; m <= 12; m++) L.push(lin(ano, m, setor, q)); };
  serie(2024, "Bebidas", 100); serie(2025, "Bebidas", 90); serie(2026, "Bebidas", 80);   // cai, cai
  serie(2024, "Bazar", 100);   serie(2025, "Bazar", 90);   serie(2026, "Bazar", 110);    // cai, sobe
  serie(2024, "Padaria", 100); serie(2025, "Padaria", 110); serie(2026, "Padaria", 100); // sobe, cai
  eq("só quem cai nos dois entra", M.vscCaiDoisAnos(L, 2024, 2025, 2026).join(","), "Bebidas");
}

// ===========================================================================
// Números REAIS — os mesmos que o Victor conferiu no relatório do VR de 25/08/2026.
// Se algum dia estes quatro mudarem sem o dado mudar, a conta quebrou.
// ===========================================================================
{
  const bebidas25 = [44992, 80376, 72168, 44726, 50812, 47428, 64129];
  const bebidas26 = [51681, 77537, 46443, 45814, 46465, 49031, 55842];
  const L = [];
  bebidas25.forEach((q, i) => L.push(lin(2025, i + 1, "Bebidas", q)));
  bebidas26.forEach((q, i) => L.push(lin(2026, i + 1, "Bebidas", q)));
  L.push(lin(2025, 8, "Bebidas", 55230));
  L.push(lin(2026, 8, "Bebidas", 38587, false));          // agosto pela metade, de novo

  const r = M.vscRanking(L, 2025, 2026)[0];
  eq("Bebidas jan-jul 2025", r.de, 404631);
  eq("Bebidas jan-jul 2026", r.para, 372813);
  eq("Bebidas variação", d2(r.variacao), "-7.86");
  eq("Bebidas é queda", r.classe, "queda");

  // março: o mês do carnaval que mudou de data — o pior da tabela
  eq("março de Bebidas", d2(M.vscPorMes(L, 2025, 2026, "Bebidas")[2].variacao), "-35.65");
}

// ===========================================================================
// A loja inteira = soma dos setores, nos mesmos meses
// ===========================================================================
{
  const L = [];
  for (let m = 1; m <= 7; m++) { L.push(lin(2025, m, "A", 100)); L.push(lin(2025, m, "B", 200)); }
  for (let m = 1; m <= 7; m++) { L.push(lin(2026, m, "A", 110)); L.push(lin(2026, m, "B", 190)); }
  L.push(lin(2026, 8, "A", 50, false));                   // não pode entrar
  const lj = M.vscLoja(L, 2025, 2026);
  eq("loja: base", lj.de, 2100);
  eq("loja: agora", lj.para, 2100);
  eq("loja: empatou", d2(lj.variacao), "0.00");
  eq("loja: usou 7 meses", lj.meses, 7);
}

console.log("\n" + ok + " ok, " + falhou + " falha(s).");
process.exit(falhou ? 1 : 0);
