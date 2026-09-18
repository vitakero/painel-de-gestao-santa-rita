// Testes do Histórico (ano a ano / mês a mês).
// Extrai o módulo do painel gerado, entre ==HISTCALC-INICIO== e ==HISTCALC-FIM==.
//   node scripts/testes/historico.test.cjs
const fs = require("fs");
const path = require("path");

const HTML = fs.readFileSync(path.join(__dirname, "..", "..", "output", "index.html"), "utf8");
const ini = HTML.indexOf("==HISTCALC-INICIO==");
const fim = HTML.indexOf("==HISTCALC-FIM==");
if (ini < 0 || fim < 0) { console.log("ERRO: não achei o módulo no output/index.html (rode o build antes)."); process.exit(1); }
const codigo = HTML.slice(HTML.indexOf("*/", ini) + 2, HTML.lastIndexOf("/*", fim));
const M = new Function(codigo + "\nreturn {hsJanelas,hsCompleto,hsUltimoDia,hsSoma,hsPorAno,hsPorMes,hsCompara};")();

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + obtido + (bate ? "" : "   (esperado: " + esperado + ")"));
  bate ? ok++ : falhou++;
}
const D = (d, fat, marg, cup, qtd) => ({ d, fat, marg: marg === undefined ? 0 : marg, cup: cup === undefined ? 0 : cup, qtd: qtd === undefined ? 0 : qtd });
const d2 = (v) => v === null ? "null" : (Math.round(v * 100) / 100).toFixed(2);

// ===========================================================================
// O ANO PELA METADE. Este é o motivo de o módulo existir: 2026 tem 8 meses e
// 2025 tem 12. Comparar os totais crus diz "caiu 26%" quando a loja SUBIU.
// ===========================================================================
{
  const L = [];
  for (let m = 1; m <= 12; m++) L.push(D("2025-" + String(m).padStart(2, "0") + "-15", 100));
  for (let m = 1; m <= 8; m++)  L.push(D("2026-" + String(m).padStart(2, "0") + "-15", 110));
  const anos = M.hsPorAno(L, "fat");
  eq("total cru de 2025", anos["2025"], 1200);
  eq("total cru de 2026", anos["2026"], 880);
  const c = M.hsCompara(L, "fat", "2026");
  eq("mas no mesmo pedaço é subida", d2(c.pct), "10.00");
  eq("e a tela diz qual pedaço (início)", c.ini, "01-15");
  eq("e qual pedaço (fim)", c.fim, "08-15");
  eq("não é ano inteiro", c.anoInteiro, false);
}

// ===========================================================================
// A LOJA FECHA NO DIA 1º DE JANEIRO. "02/01 até 31/12" É ano inteiro — se a
// régua fosse 01-01 na unha, 2024 e 2025 apareceriam etiquetados como pedaço
// e o dono leria "comparando só 02/01 a 31/12" num ano completo.
// ===========================================================================
{
  eq("02/01 a 31/12 é ano inteiro", M.hsCompleto({ ini: "01-02", fim: "12-31" }), true);
  eq("05/01 a 27/12 ainda é",       M.hsCompleto({ ini: "01-05", fim: "12-27" }), true);
  eq("06/01 não é",                 M.hsCompleto({ ini: "01-06", fim: "12-31" }), false);
  eq("até 26/12 não é",             M.hsCompleto({ ini: "01-01", fim: "12-26" }), false);
  eq("até 17/09 não é",             M.hsCompleto({ ini: "01-02", fim: "09-17" }), false);
  const L = [D("2024-01-02", 100), D("2024-12-31", 100), D("2025-01-02", 120), D("2025-12-31", 120)];
  eq("dois anos inteiros -> a tela diz 'ano inteiro'", M.hsCompara(L, "fat", "2025").anoInteiro, true);
}

// ===========================================================================
// NÃO EXISTE NÃO É ZERO. Somar um ano que não tem nenhum dia no pedaço tem que
// devolver null — tratar ausência como zero vira "-100%" na cara do dono.
// ===========================================================================
{
  const L = [D("2023-03-17", 50), D("2024-03-17", 60)];
  eq("pedaço vazio devolve null", M.hsSoma(L, "fat", "2023", "01-01", "02-28"), null);
  eq("pedaço com dia devolve a soma", M.hsSoma(L, "fat", "2023", "03-01", "03-31"), 50);
  eq("ano que não existe devolve null", M.hsSoma(L, "fat", "2022", null, null), null);
  eq("sem ano anterior não compara", M.hsCompara(L, "fat", "2023"), null);
}

// ===========================================================================
// O PRIMEIRO ANO DA BASE COMEÇA EM MARÇO. 2024 contra 2023 só pode olhar de
// 17/03 pra frente, nos DOIS anos — senão 2024 ganha janeiro e fevereiro de
// graça e a subida aparece inflada.
// ===========================================================================
{
  const L = [
    D("2023-03-17", 100), D("2023-06-01", 100), D("2023-12-31", 100),
    D("2024-01-10", 999), D("2024-02-10", 999),
    D("2024-03-17", 110), D("2024-06-01", 110), D("2024-12-31", 110)
  ];
  const c = M.hsCompara(L, "fat", "2024");
  eq("janela recortada nos dois (início)", c.ini, "03-17");
  eq("janela recortada nos dois (fim)", c.fim, "12-31");
  eq("jan e fev de 2024 ficam de fora", d2(c.pct), "10.00");
  eq("mas o total do ano continua inteiro", M.hsPorAno(L, "fat")["2024"], 2328);
}

// ===========================================================================
// Contas básicas: por mês, janelas e último dia.
// ===========================================================================
{
  const L = [D("2026-09-01", 10, 4, 2, 7), D("2026-09-02", 20, 6, 3, 9), D("2026-08-31", 5, 1, 1, 1)];
  eq("soma do mês", M.hsPorMes(L, "fat")["2026-09"], 30);
  eq("outra medida usa o mesmo caminho", M.hsPorMes(L, "marg")["2026-09"], 10);
  eq("cupons também", M.hsPorMes(L, "cup")["2026-09"], 5);
  eq("itens também", M.hsPorMes(L, "qtd")["2026-09"], 16);
  eq("último dia da base", M.hsUltimoDia(L), "2026-09-02");
  const j = M.hsJanelas(L)["2026"];
  eq("janela do ano (início)", j.ini, "08-31");
  eq("janela do ano (fim)", j.fim, "09-02");
}

// ===========================================================================
// Campo em branco não derruba a soma (o painel já teve dia sem margem).
// ===========================================================================
{
  const L = [{ d: "2026-01-01", fat: 10 }, { d: "2026-01-02", fat: 20, marg: null }];
  eq("dia sem margem não quebra", M.hsPorAno(L, "marg")["2026"], 0);
  eq("e o faturamento segue certo", M.hsPorAno(L, "fat")["2026"], 30);
}

// ===========================================================================
// AGORA COM OS DIAS DE VERDADE DA LOJA: o número que vai aparecer na tela.
// ===========================================================================
{
  const vr = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "output", "vr-data.json"), "utf8"));
  const anos = M.hsPorAno(vr.DIA, "fat");
  eq("2025 fechou acima de 56 milhões", anos["2025"] > 56e6 && anos["2025"] < 57e6, true);
  const c = M.hsCompara(vr.DIA, "fat", "2026");
  eq("2026 está subindo, não caindo", c.pct > 0, true);
  eq("e a comparação NÃO é de ano inteiro", c.anoInteiro, false);
  eq("o pedaço comparado termina no último dia da base", c.fim, M.hsUltimoDia(vr.DIA).slice(5, 10));
}

console.log("\n" + ok + " OK, " + falhou + " falha(s)");
process.exit(falhou ? 1 : 0);
