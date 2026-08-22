// Testes da REMUNERAÇÃO VARIÁVEL POR ENTREGAS (Sprint 3).
// Regra: faixa final retroativa. Bateu a meta desafio, TODAS as entregas do mês
// valem o valor do desafio. O salto ao cruzar a meta é intencional.
// NÃO duplica a lógica: extrai o módulo ==ENTFIN-*== do painel já construído.
//   node scripts/testes/entregas-financeiro.test.cjs
const fs = require("fs");
const path = require("path");

const HTML = fs.readFileSync(path.join(__dirname, "..", "..", "output", "index.html"), "utf8");
const ini = HTML.indexOf("==ENTFIN-INICIO==");
const fim = HTML.indexOf("==ENTFIN-FIM==");
if (ini < 0 || fim < 0) { console.log("ERRO: não achei o módulo financeiro no output/index.html (rode o build antes)."); process.exit(1); }
const codigo = HTML.slice(HTML.indexOf("*/", ini) + 2, HTML.lastIndexOf("/*", fim));
const M = new Function(codigo + "\nreturn {entfCent,entfMoeda,entfNum2,entfFaixa,entfRotulo,entfTotalEquipe,entfConfigOk};")();

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + obtido + (bate ? "" : "   (esperado: " + esperado + ")"));
  bate ? ok++ : falhou++;
}

// A configuração do exemplo do dono: 600 a R$ 0,50 e 850 a R$ 0,80
const CFG = { base: 600, desafio: 850, vbase: 50, vdes: 80 };
const reais = (c) => (c / 100).toFixed(2);

console.log("\n=== A REGRA, nos números exatos que o dono definiu ===\n");

eq("1) 599 entregas: não recebe nada",        reais(M.entfFaixa(599, CFG).total), "0.00");
eq("2) 599: faixa 'sem'",                     M.entfFaixa(599, CFG).faixa, "sem");
eq("3) 600 entregas: R$ 300,00",              reais(M.entfFaixa(600, CFG).total), "300.00");
eq("4) 600: entrou na base",                  M.entfFaixa(600, CFG).faixa, "base");
eq("5) 601 entregas: R$ 300,50",              reais(M.entfFaixa(601, CFG).total), "300.50");
eq("6) 849 entregas: R$ 424,50",              reais(M.entfFaixa(849, CFG).total), "424.50");
eq("7) 849: ainda na base",                   M.entfFaixa(849, CFG).faixa, "base");
eq("8) 850 entregas: R$ 680,00",              reais(M.entfFaixa(850, CFG).total), "680.00");
eq("9) 850: virou desafio",                   M.entfFaixa(850, CFG).faixa, "desafio");
eq("10) 851 entregas: R$ 680,80",             reais(M.entfFaixa(851, CFG).total), "680.80");
eq("11) 900 entregas: R$ 720,00",             reais(M.entfFaixa(900, CFG).total), "720.00");
eq("12) O SALTO de 849 para 850 é de R$ 255,50",
   reais(M.entfFaixa(850, CFG).total - M.entfFaixa(849, CFG).total), "255.50");
eq("13) e é retroativo: TODAS as 850 a R$ 0,80", M.entfFaixa(850, CFG).unitario, 80);
eq("14) 0 entregas: nada",                    reais(M.entfFaixa(0, CFG).total), "0.00");
eq("15) 928 entregas (exemplo do dono): R$ 742,40", reais(M.entfFaixa(928, CFG).total), "742.40");
eq("16) 775 entregas: R$ 387,50",             reais(M.entfFaixa(775, CFG).total), "387.50");
eq("17) 591 entregas: R$ 0,00",               reais(M.entfFaixa(591, CFG).total), "0.00");

console.log("\n=== Quanto falta para a próxima faixa ===\n");

eq("18) 599 -> faltam 1 para a base",  M.entfFaixa(599, CFG).faltam, 1);
eq("19) 599 -> a próxima é a base",    M.entfFaixa(599, CFG).proxima, "base");
eq("20) 600 -> faltam 250 para o desafio", M.entfFaixa(600, CFG).faltam, 250);
eq("21) 600 -> a próxima é o desafio", M.entfFaixa(600, CFG).proxima, "desafio");
eq("22) 850 -> não falta mais nada",   M.entfFaixa(850, CFG).faltam, 0);
eq("23) 850 -> não há próxima faixa",  M.entfFaixa(850, CFG).proxima, null);
eq("24) 0 -> faltam 600",              M.entfFaixa(0, CFG).faltam, 600);

console.log("\n=== Centavos: o dinheiro nunca vira float ===\n");

eq("25) '0,50' vira 50 centavos",       M.entfCent("0,50"), 50);
eq("26) '0.50' também",                 M.entfCent("0.50"), 50);
eq("27) 'R$ 0,80' também",              M.entfCent("R$ 0,80"), 80);
eq("28) '1.234,56' vira 123456",        M.entfCent("1.234,56"), 123456);
eq("29) número 0.5 vira 50",            M.entfCent(0.5), 50);
eq("30) '0,05' vira 5",                 M.entfCent("0,05"), 5);
eq("31) '0' vira 0",                    M.entfCent("0"), 0);
eq("32) vazio devolve nulo",            M.entfCent(""), null);
eq("33) texto devolve nulo",            M.entfCent("abc"), null);
eq("34) negativo devolve nulo",         M.entfCent("-1"), null);
eq("35) 0,1 + 0,2 em centavos dá exatamente 0,30",
   reais(M.entfCent("0,10") + M.entfCent("0,20")), "0.30");
eq("36) 1.000 entregas a R$ 0,07 = R$ 70,00 exatos",
   reais(M.entfFaixa(1000, { base: 1, desafio: 999999, vbase: 7, vdes: 0 }).total), "70.00");
eq("37) 333 entregas a R$ 0,33 = R$ 109,89",
   reais(M.entfFaixa(333, { base: 1, desafio: 999999, vbase: 33, vdes: 0 }).total), "109.89");
eq("38) formata como moeda", M.entfMoeda(74240).replace(/ /g, " "), "R$ 742,40");
eq("39) formata sem o R$",   M.entfNum2(74240), "742,40");
eq("40) zero formatado",     M.entfNum2(0), "0,00");

console.log("\n=== Configuração diferente muda tudo (vigência) ===\n");

const CFG2 = { base: 650, desafio: 900, vbase: 60, vdes: 100 };
eq("41) 700 entregas na config de janeiro (600/0,50)", reais(M.entfFaixa(700, CFG).total), "350.00");
eq("42) as MESMAS 700 na config de fevereiro (650/0,60)", reais(M.entfFaixa(700, CFG2).total), "420.00");
eq("43) 649 na config nova: abaixo da base", M.entfFaixa(649, CFG2).faixa, "sem");
eq("44) 900 na config nova: desafio a R$ 1,00", reais(M.entfFaixa(900, CFG2).total), "900.00");

console.log("\n=== Valores zerados e configuração incompleta ===\n");

const CFG0 = { base: 600, desafio: 850, vbase: 0, vdes: 0 };
eq("45) meta batida com valor zero: R$ 0,00", reais(M.entfFaixa(900, CFG0).total), "0.00");
eq("46) mas a FAIXA continua sendo reconhecida", M.entfFaixa(900, CFG0).faixa, "desafio");
eq("47) config sem base é inválida",     M.entfConfigOk({ desafio: 850, vbase: 50 }), "false");
eq("48) desafio menor que base é inválido", M.entfConfigOk({ base: 800, desafio: 600, vbase: 50 }), "false");
eq("49) sem valor (não master) é inválida", M.entfConfigOk({ base: 600, desafio: 850, vbase: null }), "false");
eq("50) config completa é válida",       M.entfConfigOk(CFG), "true");
eq("51) sem config, a conta não quebra", reais(M.entfFaixa(900, {}).total), "0.00");
eq("52) sem config, faixa 'sem'",        M.entfFaixa(900, {}).faixa, "sem");
eq("53) sem argumento nenhum",           M.entfFaixa().quantidade, 0);
eq("54) quantidade negativa vira zero",  M.entfFaixa(-5, CFG).quantidade, 0);
eq("55) quantidade decimal é truncada",  M.entfFaixa(600.9, CFG).quantidade, 600);

console.log("\n=== Total da equipe ===\n");

const EQUIPE = [928, 837, 775, 698, 652, 591];
const T = M.entfTotalEquipe(EQUIPE, CFG);
eq("56) soma das entregas",       T.entregas, 4481);
eq("57) quantos na faixa desafio", T.desafio, 1);
eq("58) quantos na faixa base",    T.base, 4);
eq("59) quantos sem remuneração",  T.sem, 1);
eq("60) o total a pagar", reais(T.total),
   ((928 * 80 + 837 * 50 + 775 * 50 + 698 * 50 + 652 * 50) / 100).toFixed(2));
eq("61) equipe vazia não quebra", M.entfTotalEquipe([], CFG).total, 0);
eq("62) equipe vazia: nenhum em faixa", M.entfTotalEquipe([], CFG).desafio, 0);
eq("63) lista nula não quebra",   M.entfTotalEquipe(null, CFG).total, 0);
eq("64) todos abaixo da meta: nada a pagar", M.entfTotalEquipe([100, 200, 300], CFG).total, 0);
eq("65) todos no desafio", M.entfTotalEquipe([850, 900], CFG).desafio, 2);

console.log("\n=== Realizado x projetado cruzando a faixa ===\n");
// O caso que mais engana: hoje ele não recebe nada, mas a projeção diz que vai receber.
const REAL = M.entfFaixa(580, CFG), PROJ = M.entfFaixa(720, CFG);
eq("66) realizado 580: R$ 0,00 até agora", reais(REAL.total), "0.00");
eq("67) projeção 720: R$ 360,00",          reais(PROJ.total), "360.00");
eq("68) são coisas diferentes",            REAL.faixa !== PROJ.faixa, "true");
const R2 = M.entfFaixa(840, CFG), P2 = M.entfFaixa(870, CFG);
eq("69) realizado 840 na base: R$ 420,00", reais(R2.total), "420.00");
eq("70) projeção 870 no desafio: R$ 696,00", reais(P2.total), "696.00");
eq("71) rótulo da faixa sem remuneração", M.entfRotulo("sem"), "Abaixo da meta 1");
eq("72) rótulo da meta 2",                M.entfRotulo("desafio"), "Meta 2 atingida");
eq("73) rótulo desconhecido não quebra",  M.entfRotulo("xyz"), "Abaixo da meta 1");

console.log("\n" + (falhou ? "FALHOU: " + falhou + " de " + (ok + falhou) : "TUDO OK: " + ok + " testes") + "\n");
process.exit(falhou ? 1 : 0);
