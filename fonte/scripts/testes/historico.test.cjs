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
const M = new Function(codigo + "\nreturn {hsJanelas,hsCompleto,hsUltimoDia,hsSoma,hsPorAno,hsPorMes,hsCompara,hsDiasPorMes,hsMesCompleto,hsPctMes,hsCasoVazio,hsPctMesEmCurso,hsProjecaoMes};")();

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

// ===========================================================================
// O MES PELA METADE. Marco de 2023 so tem do dia 17: meio mes. Comparado com o
// marco inteiro de 2024 dava +147,2% — a loja nao cresceu nada disso.
// ===========================================================================
{
  const L = [];
  const dias = (ano, mes, de, ate) => { for (let d = de; d <= ate; d++) L.push(D(ano + "-" + mes + "-" + String(d).padStart(2, "0"), 100)); };
  dias("2023", "03", 17, 31);            // meio marco: 15 dias
  dias("2024", "03", 1, 31);             // marco inteiro: 31 dias
  const dpm = M.hsDiasPorMes(L), pm = M.hsPorMes(L, "fat");
  eq("marco de 2023 nao esta inteiro", M.hsMesCompleto(dpm, "2023", "03"), false);
  eq("marco de 2024 esta", M.hsMesCompleto(dpm, "2024", "03"), true);
  eq("entao nao ha comparacao", M.hsPctMes(pm, dpm, "2024", "03"), null);
  eq("e a tela sabe dizer por que", M.hsCasoVazio(pm, dpm, "2024", "03", "2026-09"), "base_parcial");
}

// ===========================================================================
// A LOJA FECHA NO 1o DE JANEIRO. A primeira regua exigia o mes inteiro dentro da
// janela do ano e NENHUM janeiro passava: sumiram todas as comparacoes de janeiro
// junto com a do marco. Contando dias, feriado passa.
// ===========================================================================
{
  const L = [];
  const dias = (ano, mes, de, ate) => { for (let d = de; d <= ate; d++) L.push(D(ano + "-" + mes + "-" + String(d).padStart(2, "0"), 100)); };
  dias("2024", "01", 2, 31);             // 30 de 31: fechou dia 1o
  dias("2025", "01", 2, 31);
  const dpm = M.hsDiasPorMes(L), pm = M.hsPorMes(L, "fat");
  eq("janeiro com 30 de 31 dias vale", M.hsMesCompleto(dpm, "2025", "01"), true);
  eq("e a comparacao de janeiro aparece", d2(M.hsPctMes(pm, dpm, "2025", "01")), "0.00");
  eq("nao sobra caso vazio", M.hsCasoVazio(pm, dpm, "2025", "01", "2026-09"), null);
}

// ===========================================================================
// A FOLGA TEM LIMITE: 3 dias passam, 4 nao. Senao a regua deixaria entrar mes
// capenga de verdade.
// ===========================================================================
{
  const L = [];
  for (let d = 4; d <= 31; d++) L.push(D("2025-01-" + String(d).padStart(2, "0"), 100));   // 28 de 31: faltam 3
  for (let d = 5; d <= 31; d++) L.push(D("2024-01-" + String(d).padStart(2, "0"), 100));   // 27 de 31: faltam 4
  const dpm = M.hsDiasPorMes(L);
  eq("faltando 3 dias ainda vale", M.hsMesCompleto(dpm, "2025", "01"), true);
  eq("faltando 4 nao vale", M.hsMesCompleto(dpm, "2024", "01"), false);
}

// ===========================================================================
// CADA TRACO TEM O MOTIVO DELE. Quatro buracos diferentes que a tela precisa
// saber separar — antes todos eram o mesmo "—" mudo.
// ===========================================================================
{
  const L = [];
  const dias = (ano, mes, de, ate) => { for (let d = de; d <= ate; d++) L.push(D(ano + "-" + mes + "-" + String(d).padStart(2, "0"), 100)); };
  dias("2025", "01", 1, 31); dias("2026", "01", 1, 31);
  dias("2025", "09", 1, 30); dias("2026", "09", 1, 18);   // setembro de 2026 correndo
  dias("2025", "10", 1, 31);                              // outubro de 2026 nem chegou
  const dpm = M.hsDiasPorMes(L), pm = M.hsPorMes(L, "fat"), hoje = "2026-09";
  eq("mes que ainda corre", M.hsCasoVazio(pm, dpm, "2026", "09", hoje), "mes_aberto");
  eq("mes que nem chegou", M.hsCasoVazio(pm, dpm, "2026", "10", hoje), "nao_chegou");
  eq("ano anterior nao existe", M.hsCasoVazio(pm, dpm, "2025", "01", hoje), "sem_ano_anterior");
  eq("mes inteiro dos dois lados: sem buraco", M.hsCasoVazio(pm, dpm, "2026", "01", hoje), null);
  eq("e o mes aberto nao gera porcentagem", M.hsPctMes(pm, dpm, "2026", "09"), null);
}

// ===========================================================================
// COM OS DIAS DE VERDADE DA LOJA.
// ===========================================================================
{
  const vr = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "output", "vr-data.json"), "utf8"));
  const dpm = M.hsDiasPorMes(vr.DIA), pm = M.hsPorMes(vr.DIA, "fat");
  const hoje = M.hsUltimoDia(vr.DIA).slice(0, 7);
  eq("marco de 2024 contra meio marco de 2023: sem numero", M.hsPctMes(pm, dpm, "2024", "03"), null);
  eq("e o motivo e a base pela metade", M.hsCasoVazio(pm, dpm, "2024", "03", hoje), "base_parcial");
  eq("janeiro de 2026 TEM comparacao", M.hsPctMes(pm, dpm, "2026", "01") !== null, true);
  eq("abril de 2026 tambem", M.hsPctMes(pm, dpm, "2026", "04") !== null, true);
  eq("o mes que corre nao tem", M.hsPctMes(pm, dpm, "2026", hoje.slice(5, 7)), null);
  // QUAIS meses ficam sem comparacao na base real, e por que cada um.
  // Sao quatro, nao dois: jan e fev de 2024 nao tem com o que comparar porque a base
  // comeca em 17/03/2023 — o ano de 2023 nao tem janeiro nem fevereiro.
  const vazios = [];
  ["2024", "2025", "2026"].forEach(function (a) {
    for (let m = 1; m <= 12; m++) {
      const mm = String(m).padStart(2, "0");
      if (pm[a + "-" + mm] !== undefined && M.hsPctMes(pm, dpm, a, mm) === null) {
        vazios.push(a + "-" + mm + ":" + M.hsCasoVazio(pm, dpm, a, mm, hoje));
      }
    }
  });
  eq("sao exatamente estes quatro, com estes motivos",
     vazios.join(" "),
     "2024-01:sem_ano_anterior 2024-02:sem_ano_anterior 2024-03:base_parcial 2026-09:mes_aberto");
}

// ===========================================================================
// O MES QUE ESTA CORRENDO. Mostrar o numero exige comparar com o MESMO pedaco do
// ano passado: contra o mes inteiro daria uma queda que nao existe.
// ===========================================================================
{
  const L = [];
  const dias = (ano, mes, de, ate, v) => { for (let d = de; d <= ate; d++) L.push(D(ano + "-" + mes + "-" + String(d).padStart(2, "0"), v)); };
  dias("2025", "09", 1, 30, 100);        // setembro inteiro do ano passado: 3000
  dias("2026", "09", 1, 18, 110);        // ate o dia 18 deste ano: 1980
  const c = M.hsPctMesEmCurso(L, "fat", "2026", "09", "2026-09-18");
  eq("compara 1 a 18 nos dois anos", d2(c.pct), "10.00");
  eq("e diz ate que dia foi", c.dias, 18);
  // a conta errada, de proposito, pra deixar o perigo escrito:
  const cru = (M.hsPorMes(L, "fat")["2026-09"] / M.hsPorMes(L, "fat")["2025-09"] - 1) * 100;
  eq("contra o mes inteiro daria uma queda falsa", d2(cru), "-34.00");
}

// ===========================================================================
// Sem o mesmo pedaco do ano anterior, nao ha numero.
// ===========================================================================
{
  const L = [];
  for (let d = 1; d <= 18; d++) L.push(D("2026-09-" + String(d).padStart(2, "0"), 100));
  eq("sem ano anterior devolve null", M.hsPctMesEmCurso(L, "fat", "2026", "09", "2026-09-18"), null);
}

// ===========================================================================
// Com os dias de verdade: o numero que a tela mostra hoje.
// ===========================================================================
{
  const vr = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "output", "vr-data.json"), "utf8"));
  const ult = M.hsUltimoDia(vr.DIA), mm = ult.slice(5, 7), ano = ult.slice(0, 4);
  const c = M.hsPctMesEmCurso(vr.DIA, "fat", ano, mm, ult);
  eq("o mes corrente TEM numero agora", c !== null, true);
  eq("e ele e uma subida", c.pct > 0, true);
  eq("comparou ate o ultimo dia da base", c.dias, Number(ult.slice(8, 10)));
  // o que a tela NAO pode mostrar:
  const pm = M.hsPorMes(vr.DIA, "fat");
  const falso = (pm[ano + "-" + mm] / pm[String(Number(ano) - 1) + "-" + mm] - 1) * 100;
  eq("a conta ingenua seria uma queda", falso < -20, true);
  eq("e a certa e uma subida", c.pct > 0, true);
}

// ===========================================================================
// A PROJECAO USA A MESMA CONTA DA ANALISE: ate agora / dias passados x dias do mes.
// Duas telas com projecoes diferentes pro mesmo mes e pior que nenhuma projecao.
// ===========================================================================
{
  const L = [];
  for (let d = 1; d <= 30; d++) L.push(D("2025-09-" + String(d).padStart(2, "0"), 100));   // set/2025 = 3000
  for (let d = 1; d <= 18; d++) L.push(D("2026-09-" + String(d).padStart(2, "0"), 110));   // 18 dias = 1980
  const pr = M.hsProjecaoMes(L, "fat", "2026-09-18");
  eq("1980 / 18 x 30", d2(pr.valor), "3300.00");
  eq("dias ja passados", pr.diaNum, 18);
  eq("dias do mes", pr.diasNoMes, 30);
  eq("contra o mes inteiro do ano passado", d2(pr.pct), "10.00");
}

// ===========================================================================
// Sem o mesmo mes no ano anterior, a projecao existe mas a porcentagem nao.
// ===========================================================================
{
  const L = [];
  for (let d = 1; d <= 10; d++) L.push(D("2026-09-" + String(d).padStart(2, "0"), 100));
  const pr = M.hsProjecaoMes(L, "fat", "2026-09-10");
  eq("o valor projetado sai", d2(pr.valor), "3000.00");
  eq("mas a comparacao nao", pr.pct, null);
}

// ===========================================================================
// Com os dias de verdade: os DOIS numeros da linha de setembro.
// O de cima e fato, o de baixo e chute — e eles nao podem ser o mesmo numero.
// ===========================================================================
{
  const vr = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "output", "vr-data.json"), "utf8"));
  const ult = M.hsUltimoDia(vr.DIA);
  const agora = M.hsPctMesEmCurso(vr.DIA, "fat", ult.slice(0, 4), ult.slice(5, 7), ult);
  const proj = M.hsProjecaoMes(vr.DIA, "fat", ult);
  eq("o 'agora' e uma subida", agora.pct > 0, true);
  eq("a projecao tambem", proj.pct > 0, true);
  eq("e a projecao e MAIOR que o mes ja fechado do ano passado", proj.valor > proj.baseAnt, true);
  eq("a projecao e maior que o que ja foi faturado", proj.valor > M.hsPorMes(vr.DIA, "fat")[ult.slice(0, 7)], true);
}

console.log("\n" + ok + " OK, " + falhou + " falha(s)");
process.exit(falhou ? 1 : 0);
