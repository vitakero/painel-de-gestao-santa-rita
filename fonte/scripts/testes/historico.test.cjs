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
const M = new Function(codigo + "\nreturn {hsJanelas,hsCompleto,hsUltimoDia,hsSoma,hsPorAno,hsPorMes,hsCompara,hsDiasPorMes,hsMesCompleto,hsPctMes,hsCasoVazio,hsPctMesEmCurso,hsProjecaoMes,hsFaltaPraAlcancar,hsProjecaoAno,hsDiaDoAno,hsEscala,hsMesKpis,hsPorQue,hsAnoDaSetinha,hsMargemConfiavel};")();

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

// ===========================================================================
// QUANTO FALTA PRA ALCANCAR O MESMO MES DO ANO PASSADO. A pergunta que o dono
// estava fazendo quando olhou "2,99 milhoes" ao lado de "4,62 milhoes".
// ===========================================================================
{
  const L = [];
  for (let d = 1; d <= 30; d++) L.push(D("2025-09-" + String(d).padStart(2, "0"), 100));   // 3000
  for (let d = 1; d <= 18; d++) L.push(D("2026-09-" + String(d).padStart(2, "0"), 110));   // 1980
  const f = M.hsFaltaPraAlcancar(L, "fat", "2026-09-18");
  eq("falta 3000 - 1980", d2(f.falta), "1020.00");
  eq("o alvo e o mes inteiro do ano passado", d2(f.alvo), "3000.00");
  eq("e sobram 12 dias pra isso", f.diasQueFaltam, 12);
  eq("o buraco em porcentagem do mes do ano passado", d2(f.pctDoAlvo), "34.00");
}

// ===========================================================================
// Quando o mes JA passou do ano passado, nao falta nada (o numero fica negativo
// e a tela nao mostra a linha).
// ===========================================================================
{
  const L = [];
  for (let d = 1; d <= 30; d++) L.push(D("2025-09-" + String(d).padStart(2, "0"), 100));   // 3000
  for (let d = 1; d <= 28; d++) L.push(D("2026-09-" + String(d).padStart(2, "0"), 200));   // 5600
  const f = M.hsFaltaPraAlcancar(L, "fat", "2026-09-28");
  eq("ja passou: falta vira negativo", f.falta < 0, true);
}

// ===========================================================================
// Com os dias de verdade: os tres numeros da linha de setembro, e a relacao
// entre eles. O "agora" sobe, mas ainda falta dinheiro pra igualar o ano passado —
// as duas coisas sao verdade ao mesmo tempo, e e por isso que a tela mostra as duas.
// ===========================================================================
{
  const vr = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "output", "vr-data.json"), "utf8"));
  const ult = M.hsUltimoDia(vr.DIA);
  const agora = M.hsPctMesEmCurso(vr.DIA, "fat", ult.slice(0, 4), ult.slice(5, 7), ult);
  const falta = M.hsFaltaPraAlcancar(vr.DIA, "fat", ult);
  eq("nos mesmos dias, subiu", agora.pct > 0, true);
  eq("e mesmo assim ainda falta pra igualar o mes inteiro", falta.falta > 0, true);
  eq("o que falta e menor que o mes inteiro do ano passado", falta.falta < falta.alvo, true);
}

// ===========================================================================
// A LINHA "ANO" TEM A MESMA DOENCA DA LINHA DO MES EM CURSO.
// 41,9 milhoes ao lado de 56,2 milhoes com um "+4,4%" verde parece mentira —
// o +4,4% esta certo, mas encostado no numero errado.
// ===========================================================================
{
  const L = [];
  const dia = (iso, v) => L.push(D(iso, v));
  // 2025 inteiro: 365 dias x 100 = 36500
  for (let d = 1; d <= 365; d++) {
    const dt = new Date(Date.UTC(2025, 0, d));
    dia(dt.toISOString().slice(0, 10), 100);
  }
  // 2026 ate o dia 100 do ano, a 110 por dia = 11000
  for (let d = 1; d <= 100; d++) {
    const dt = new Date(Date.UTC(2026, 0, d));
    dia(dt.toISOString().slice(0, 10), 110);
  }
  const ult = M.hsUltimoDia(L);
  eq("o dia do ano foi contado certo", M.hsDiaDoAno(ult), 100);
  const pa = M.hsProjecaoAno(L, "fat", ult);
  eq("ja faturou 11000", d2(pa.ateAgora), "11000.00");
  eq("o ano passado inteiro foi 36500", d2(pa.totalAnt), "36500.00");
  eq("HOJE esta 69,9% abaixo do ano inteiro", d2(pa.pctHoje), "-69.86");
  eq("11000 / 100 x 365 = 40150", d2(pa.valor), "40150.00");
  eq("a PROJECAO fecha 10% acima", d2(pa.pct), "10.00");
  eq("faltam 265 dias", pa.diasQueFaltam, 265);
  eq("e faltam 25500 para igualar", d2(pa.falta), "25500.00");
}

// ===========================================================================
// ANO BISSEXTO: 2028 tem 366 dias. A conta nao pode fixar 365.
// ===========================================================================
{
  const L = [];
  for (let d = 1; d <= 366; d++) { const dt = new Date(Date.UTC(2027, 0, d)); L.push(D(dt.toISOString().slice(0, 10), 100)); }
  for (let d = 1; d <= 10; d++) { const dt = new Date(Date.UTC(2028, 0, d)); L.push(D(dt.toISOString().slice(0, 10), 100)); }
  const pa = M.hsProjecaoAno(L, "fat", "2028-01-10");
  eq("2028 tem 366 dias", pa.diasNoAno, 366);
  eq("31/12 e o dia 365 de 2027", M.hsDiaDoAno("2027-12-31"), 365);
}

// ===========================================================================
// Com os dias de verdade: o que a linha "Ano" mostra hoje.
// ===========================================================================
{
  const vr = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "output", "vr-data.json"), "utf8"));
  const ult = M.hsUltimoDia(vr.DIA);
  const pa = M.hsProjecaoAno(vr.DIA, "fat", ult);
  eq("hoje o ano esta ABAIXO do ano passado inteiro", pa.pctHoje < 0, true);
  eq("mas a projecao fecha ACIMA", pa.pct > 0, true);
  eq("e a projecao e maior que o ano passado inteiro", pa.valor > pa.totalAnt, true);
  // as duas coisas sao verdade ao mesmo tempo — e por isso a linha mostra as duas
  const c = M.hsCompara(vr.DIA, "fat", ult.slice(0, 4));
  eq("no mesmo pedaco do calendario, esta subindo", c.pct > 0, true);
}

// ===========================================================================
// A REGUA DO GRAFICO. Se o topo for o maior valor, a linha de cima cai em
// "R$ 5.031.329,74" e ninguem mede nada. E se o passo for grosso demais, todas
// as barras ficam espremidas entre duas linhas.
// ===========================================================================
{
  const e = M.hsEscala(5031329.74);
  eq("passo de 1 milhao", e.passo, 1000000);
  eq("topo redondo em 6 milhoes", e.topo, 6000000);
  eq("sete marcas: 0 a 6", e.linhas.length, 7);
  eq("comeca no zero", e.linhas[0], 0);
  eq("e a ultima marca e o topo", e.linhas[e.linhas.length - 1], e.topo);
  eq("o topo cobre o maior valor", e.topo >= 5031329.74, true);
}
{
  // ordens de grandeza diferentes continuam caindo em numero redondo
  const casos = [[95, 20], [4300, 1000], [47000, 10000], [860000, 200000], [12500000, 2500000]];
  casos.forEach(function (c) {
    const e = M.hsEscala(c[0]);
    eq("passo redondo para max " + c[0], e.passo, c[1]);
    eq("  e o topo cobre o maior valor", e.topo >= c[0], true);
  });
  eq("sem dados nao inventa escala", M.hsEscala(0).linhas.length, 0);
}

// ===========================================================================
// A GAVETA DO MES. Duas travas valem mais que todos os KPIs dela juntos.
// ===========================================================================

// --- TRAVA 1: a margem de 2023 e fantasia (custo nao preenchido no VR no comeco) ---
{
  eq("marco/2023 nao tem margem confiavel", M.hsMargemConfiavel("2023-03"), false);
  eq("setembro/2023 ainda nao", M.hsMargemConfiavel("2023-09"), false);
  eq("outubro/2023 ja tem", M.hsMargemConfiavel("2023-10"), true);
  eq("2026 tem", M.hsMargemConfiavel("2026-01"), true);
  // e o numero real que justifica a trava:
  const vr = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "output", "vr-data.json"), "utf8"));
  const ult = M.hsUltimoDia(vr.DIA);
  const mar23 = M.hsMesKpis(vr.DIA, "fat", "2023", "03", ult);
  const out23 = M.hsMesKpis(vr.DIA, "fat", "2023", "10", ult);
  eq("marco/2023 marcaria margem acima de 50%", mar23.margPct > 50, true);
  eq("outubro/2023 ja esta na casa dos 32%", Math.round(out23.margPct), 32);
  eq("e a gaveta de marco/2023 sabe que nao pode mostrar", mar23.margConfiavel, false);
}

// --- TRAVA 2: o dia em curso nao disputa melhor/pior dia ---
{
  const L = [];
  for (let d = 1; d <= 19; d++) L.push(D("2026-09-" + String(d).padStart(2, "0"), 160000));
  L.push(D("2026-09-20", 52695));   // o dia de hoje, pela metade
  const k = M.hsMesKpis(L, "fat", "2026", "09", "2026-09-20");
  eq("o mes esta em curso", k.emCurso, true);
  eq("hoje NAO e o pior dia", k.pior.d !== "2026-09-20", true);
  eq("o pior dia e um dia cheio", d2(k.pior.fat), "160000.00");
  // no mes fechado o ultimo dia disputa normalmente
  const F = [];
  for (let d = 1; d <= 30; d++) F.push(D("2026-04-" + String(d).padStart(2, "0"), d === 30 ? 10 : 100));
  const kf = M.hsMesKpis(F, "fat", "2026", "04", "2026-09-20");
  eq("mes fechado: o ultimo dia pode ser o pior", kf.pior.d, "2026-04-30");
}

// --- A setinha do nome do mes abre o mes FECHADO mais recente ---
{
  const vr = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "output", "vr-data.json"), "utf8"));
  const ult = M.hsUltimoDia(vr.DIA);
  eq("'jan' abre 2026", M.hsAnoDaSetinha(vr.DIA, "01", ult), "2026");
  eq("'set' abre 2025, nao o setembro que corre", M.hsAnoDaSetinha(vr.DIA, "09", ult), "2025");
  eq("'dez' abre 2025", M.hsAnoDaSetinha(vr.DIA, "12", ult), "2025");
  eq("'mar' NAO abre 2023 (meio mes)", M.hsAnoDaSetinha(vr.DIA, "03", ult) !== "2023", true);
}

// --- "subiu por que": separa a loja do preco ---
{
  eq("mais gente", M.hsPorQue(7.9, 2.0, 6.4), "gente");
  eq("preco: ticket sobe e mercadoria cai", M.hsPorQue(-2.0, 3.4, -4.6), "preco");
  eq("ticket puxando", M.hsPorQue(1.0, 8.0, 5.0), "ticket");
  eq("caiu tudo", M.hsPorQue(-3.0, -2.0, -5.0), "caiu_tudo");
  eq("sem base nao chuta", M.hsPorQue(null, 2.0, 1.0), null);
}

// --- Branco nao e zero: mes sem cupom nao vira divisao por zero ---
{
  const L = [{ d: "2026-05-01", fat: 1000 }, { d: "2026-05-02", fat: 2000 }];
  const k = M.hsMesKpis(L, "fat", "2026", "05", "2026-09-20");
  eq("sem cupom, ticket e null (nao Infinity)", k.tk, null);
  eq("sem cupom, itens por cupom e null", k.ipc, null);
  eq("mas o faturamento sai", d2(k.fat), "3000.00");
  eq("mes que nao existe devolve null", M.hsMesKpis(L, "fat", "2026", "07", "2026-09-20"), null);
}

// --- Os numeros de verdade de janeiro/2026, que e o que a gaveta mostra ---
{
  const vr = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "output", "vr-data.json"), "utf8"));
  const ult = M.hsUltimoDia(vr.DIA);
  const a = M.hsMesKpis(vr.DIA, "fat", "2026", "01", ult);
  const b = M.hsMesKpis(vr.DIA, "fat", "2025", "01", ult);
  eq("janeiro/2026 abriu 30 dias de 31", a.diasAbertos + " de " + a.diasNoMes, "30 de 31");
  eq("teve 5 sabados", a.sab, 5);
  eq("janeiro/2025 teve 4", b.sab, 4);
  eq("o melhor dia foi 31/01", a.melhor.d, "2026-01-31");
  eq("e o pior foi 04/01", a.pior.d, "2026-01-04");
  eq("sabado e o dia mais forte", a.mediaSem[6] > a.mediaSem[0], true);
  eq("e o mes cresceu por gente, nao por preco",
     M.hsPorQue((a.cup / b.cup - 1) * 100, (a.tk / b.tk - 1) * 100, (a.qtd / b.qtd - 1) * 100), "gente");
}

// ===========================================================================
// A GAVETA DO MES EM CURSO NAO PODE REPETIR A MENTIRA DA TABELA.
// Sem o corte, setembro/2026 (20 dias) contra setembro/2025 (30 dias) devolvia
// "cupons -35,7%" — a loja nao perdeu um terco dos clientes, faltam 10 dias.
// ===========================================================================
{
  const L = [];
  for (let d = 1; d <= 30; d++) L.push({ d: "2025-09-" + String(d).padStart(2, "0"), fat: 100, cup: 100, qtd: 10, marg: 33 });
  for (let d = 1; d <= 20; d++) L.push({ d: "2026-09-" + String(d).padStart(2, "0"), fat: 110, cup: 105, qtd: 10, marg: 36 });
  const ult = "2026-09-20";
  const atual = M.hsMesKpis(L, "fat", "2026", "09", ult);
  eq("o mes esta em curso", atual.emCurso, true);

  // SEM corte: o ano passado inteiro
  const cru = M.hsMesKpis(L, "fat", "2025", "09", ult);
  eq("sem corte, o ano passado tem 30 dias", cru.diasAbertos, 30);
  eq("e os cupons dariam uma queda falsa", ((atual.cup / cru.cup - 1) * 100) < -25, true);

  // COM corte no mesmo dia
  const justo = M.hsMesKpis(L, "fat", "2025", "09", ult, 20);
  eq("com corte, o ano passado tem 20 dias", justo.diasAbertos, 20);
  eq("e os cupons sobem 5%", d2((atual.cup / justo.cup - 1) * 100), "5.00");
  eq("o faturamento sobe 10%", d2((atual.fat / justo.fat - 1) * 100), "10.00");
  eq("e o veredito vira 'gente', nao 'preco'",
     M.hsPorQue((atual.cup / justo.cup - 1) * 100, (atual.tk / justo.tk - 1) * 100, (atual.qtd / justo.qtd - 1) * 100), "gente");
}

// --- Com os dias de verdade: o corte muda o sinal do veredito de setembro ---
{
  const vr = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "output", "vr-data.json"), "utf8"));
  const ult = M.hsUltimoDia(vr.DIA);
  const dia = Number(ult.slice(8, 10));
  const a = M.hsMesKpis(vr.DIA, "fat", ult.slice(0, 4), ult.slice(5, 7), ult);
  const cru = M.hsMesKpis(vr.DIA, "fat", String(Number(ult.slice(0, 4)) - 1), ult.slice(5, 7), ult);
  const justo = M.hsMesKpis(vr.DIA, "fat", String(Number(ult.slice(0, 4)) - 1), ult.slice(5, 7), ult, dia);
  // O corte nao "melhora" o numero: ele torna o numero VERDADEIRO. Aqui a queda de cupons
  // e real (menos gente na loja), mas o tamanho dela muda de uma ordem de grandeza:
  // -35,7% (ilusao de 20 dias contra 30) vira -5,1% (o que de fato aconteceu).
  const semCorte = (a.cup / cru.cup - 1) * 100;
  const comCorte = (a.cup / justo.cup - 1) * 100;
  eq("sem corte, a queda de cupons passa de 20%", semCorte < -20, true);
  eq("com corte, ela fica abaixo de 10%", Math.abs(comCorte) < 10, true);
  eq("o corte reduz a queda em mais de 5 vezes", Math.abs(semCorte) / Math.abs(comCorte) > 5, true);
  eq("e os dois meses ficam com o mesmo tamanho", a.diasAbertos, justo.diasAbertos);
}

console.log("\n" + ok + " OK, " + falhou + " falha(s)");
process.exit(falhou ? 1 : 0);
