// Testes da base de cálculo do módulo Entregas.
// NÃO duplica a lógica: extrai o módulo do painel já gerado (output/index.html), entre
// os marcadores ==ENTCALC-INICIO== e ==ENTCALC-FIM==, e roda os casos contra ele.
//   node scripts/testes/entregas.test.cjs
const fs = require("fs");
const path = require("path");

const HTML = fs.readFileSync(path.join(__dirname, "..", "..", "output", "index.html"), "utf8");
const ini = HTML.indexOf("==ENTCALC-INICIO==");
const fim = HTML.indexOf("==ENTCALC-FIM==");
if (ini < 0 || fim < 0) { console.log("ERRO: não achei o módulo de cálculo no output/index.html (rode o build antes)."); process.exit(1); }
const codigo = HTML.slice(HTML.indexOf("*/", ini) + 2, HTML.lastIndexOf("/*", fim));

const M = new Function(codigo + "\nreturn {entcDiasMes,entcJaPassou,entcDiasOperacionais,entcDiasLancados,entcDiasOperRestantes,entcDiasSemLancamento,entcMediaOperacional,entcPctAtingido,entcFaltam,entcExcedente,entcProjecao,entcRitmoEsperado,entcSituacao,entcStatus,entcValidaLancamento,entcMediana,entcAnormal,entcLider,entcAcumulado,ENT_FAIXAS,ENT_MIN_DIAS_PROJECAO,ENT_ANORMAL_FATOR,ENT_ANORMAL_MIN,ENT_ANORMAL_HIST};")();

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + obtido + (bate ? "" : "   (esperado: " + esperado + ")"));
  bate ? ok++ : falhou++;
}
const d2 = (v) => (Math.round(v * 100) / 100).toFixed(2);

// ---------------------------------------------------------------------------
// Cenário base: AGOSTO/2026 (mês de 31 dias, 5 domingos: 2, 9, 16, 23 e 30).
// Sem feriado cadastrado em agosto -> 31 - 5 = 26 dias operacionais.
// ---------------------------------------------------------------------------
const A = 2026, MES = 7;                       // mês 7 = agosto (0-based)
const soDomingo = (a, m, d) => new Date(a, m, d).getDay() === 0;
// dias 1..20 lançados, menos os domingos; 21 em diante em branco
const lanc1a20 = (d) => d <= 20 && !soDomingo(A, MES, d);
const nunca = () => false;
const sempre = (a, m, d) => false;             // ehFechado que nunca fecha (mês corrido)

console.log("\n=== Entregas — dias do mês, domingos e feriados ===\n");

eq("1) agosto/2026 tem 31 dias", M.entcDiasMes(2026, 7), 31);
eq("2) fevereiro/2026 tem 28 dias", M.entcDiasMes(2026, 1), 28);
eq("3) fevereiro/2024 (bissexto) tem 29", M.entcDiasMes(2024, 1), 29);
eq("4) abril/2026 tem 30 dias", M.entcDiasMes(2026, 3), 30);
eq("5) agosto/2026: 26 dias operacionais (5 domingos fora)", M.entcDiasOperacionais(A, MES, soDomingo), 26);
eq("6) mês sem nenhum dia fechado = todos operacionais", M.entcDiasOperacionais(A, MES, sempre), 31);
// feriado: 7 de setembro/2026 cai numa segunda -> tira 1 dia útil
const setFeriado = (a, m, d) => soDomingo(a, m, d) || (m === 8 && d === 7);
eq("7) setembro/2026 sem feriado: 26 operacionais", M.entcDiasOperacionais(2026, 8, soDomingo), 26);
eq("8) setembro/2026 com 7/9: 25 operacionais", M.entcDiasOperacionais(2026, 8, setFeriado), 25);

console.log("\n=== Dias lançados x dias em branco x dias futuros ===\n");

eq("9) 1..20 lançados sem domingo = 17 dias", M.entcDiasLancados(A, MES, soDomingo, lanc1a20), 17);
eq("10) nada lançado = 0 dias", M.entcDiasLancados(A, MES, soDomingo, nunca), 0);
eq("11) domingo lançado não vira dia lançado", M.entcDiasLancados(A, MES, soDomingo, (d) => d === 2), 0);
// "hoje" = 21/08/2026
const HOJE = new Date(2026, 7, 21);
// 1..20 lançados e hoje é 21 -> nada em atraso: o dia de hoje ainda pode ser lançado
eq("12) sem buraco no meio, nenhum dia em atraso", M.entcDiasSemLancamento(A, MES, soDomingo, lanc1a20, HOJE).length, 0);
eq("13) hoje NÃO entra na lista de dias em atraso", M.entcDiasSemLancamento(A, MES, soDomingo, lanc1a20, HOJE).indexOf(21), -1);
// agora com buracos reais: 12, 13 e 18 nunca foram preenchidos
const comBuraco = (d) => lanc1a20(d) && d !== 12 && d !== 13 && d !== 18;
eq("13b) buracos no meio do mês aparecem em ordem", M.entcDiasSemLancamento(A, MES, soDomingo, comBuraco, HOJE).join(","), "12,13,18");
eq("13c) buraco não conta como dia lançado", M.entcDiasLancados(A, MES, soDomingo, comBuraco), 14);
eq("14) dias operacionais restantes (hoje 21, 1..20 lançados)", M.entcDiasOperRestantes(A, MES, soDomingo, lanc1a20, HOJE), 9);
eq("15) mês passado inteiro lançado: 0 restantes", M.entcDiasOperRestantes(A, MES, soDomingo, (d) => !soDomingo(A, MES, d), new Date(2026, 8, 5)), 0);
eq("16) mês futuro: todos os dias úteis restantes", M.entcDiasOperRestantes(2026, 11, (a, m, d) => new Date(a, m, d).getDay() === 0, nunca, HOJE), M.entcDiasOperacionais(2026, 11, (a, m, d) => new Date(a, m, d).getDay() === 0));
// hoje 25/08: os dias úteis 21, 22 e 24 passaram em branco e não voltam;
// restam 25 (hoje), 26, 27, 28, 29 e 31.
eq("17) dia útil que passou em branco não volta pros restantes", M.entcDiasOperRestantes(A, MES, soDomingo, lanc1a20, new Date(2026, 7, 25)), 6);
eq("18) entcJaPassou: hoje ainda não passou", M.entcJaPassou(2026, 7, 21, HOJE), "false");
eq("19) entcJaPassou: ontem passou", M.entcJaPassou(2026, 7, 20, HOJE), "true");
eq("20) entcJaPassou: amanhã não passou", M.entcJaPassou(2026, 7, 22, HOJE), "false");

console.log("\n=== Média por dia operacional lançado ===\n");

eq("21) 2.721 em 17 dias lançados", d2(M.entcMediaOperacional(2721, 17)), "160.06");
eq("22) ZERO dia lançado não divide por zero", M.entcMediaOperacional(2721, 0), 0);
eq("23) média com 1 dia = o próprio total", M.entcMediaOperacional(160, 1), 160);
eq("24) média não é NaN com total zero", M.entcMediaOperacional(0, 17), 0);

console.log("\n=== Percentual ATINGIDO (o erro que a sprint corrige) ===\n");

const META6 = 600 * 6;                          // 3.600
eq("25) 2.721 de 3.600 = 75,6% ATINGIDO", d2(M.entcPctAtingido(2721, META6)), "75.58");
eq("26) faltam 879", M.entcFaltam(2721, META6), 879);
eq("27) meta zerada não divide por zero", M.entcPctAtingido(2721, 0), 0);
eq("28) exatamente 100%", d2(M.entcPctAtingido(3600, META6)), "100.00");
eq("29) acima de 100% mostra o valor real", d2(M.entcPctAtingido(3902, META6)), "108.39");
eq("30) faltam nunca é negativo", M.entcFaltam(3902, META6), 0);
eq("31) excedente de 302", M.entcExcedente(3902, META6), 302);
eq("32) excedente nunca é negativo", M.entcExcedente(2721, META6), 0);
eq("33) 99,9% não arredonda pra 100", d2(M.entcPctAtingido(3596, META6)), "99.89");

console.log("\n=== Projeção linear ===\n");

eq("34) 2.721 em 17 de 26 dias -> 4.162", Math.round(M.entcProjecao(2721, 17, 26)), 4162);
eq("35) com 2 dias lançados: dados insuficientes", M.entcProjecao(300, 2, 26), null);
eq("36) com 3 dias lançados já projeta", Math.round(M.entcProjecao(480, 3, 26)), 4160);
eq("37) mês todo lançado: projeção = realizado", M.entcProjecao(3900, 26, 26), 3900);
eq("38) mais dias lançados que operacionais: ainda = realizado", M.entcProjecao(3900, 27, 26), 3900);
eq("39) zero dia operacional não gera Infinity", M.entcProjecao(100, 5, 0), null);
eq("40) projeção nunca é NaN", isFinite(M.entcProjecao(2721, 17, 26)), "true");
eq("41) mínimo de dias está centralizado", M.ENT_MIN_DIAS_PROJECAO, 3);

console.log("\n=== Ritmo esperado e semáforo ===\n");

eq("42) 17 de 26 dias = 65,4% do mês", d2(M.entcRitmoEsperado(17, 26)), "65.38");
eq("43) ritmo trava em 100%", M.entcRitmoEsperado(30, 26), 100);
eq("44) sem dia operacional = 0", M.entcRitmoEsperado(5, 0), 0);
eq("45) +6 pontos = acima do ritmo", M.entcSituacao(6), "acima");
eq("46) +5 pontos (limite) = acima", M.entcSituacao(5), "acima");
eq("47) +2 pontos = no ritmo", M.entcSituacao(2), "no-ritmo");
eq("48) -5 pontos (limite) = no ritmo", M.entcSituacao(-5), "no-ritmo");
eq("49) -8 pontos = atenção", M.entcSituacao(-8), "atencao");
eq("50) -15 pontos (limite) = atenção", M.entcSituacao(-15), "atencao");
eq("51) -20 pontos = meta em risco", M.entcSituacao(-20), "risco");
eq("52) faixas estão centralizadas", M.ENT_FAIXAS.acima + "/" + M.ENT_FAIXAS.atencao + "/" + M.ENT_FAIXAS.risco, "5/-5/-15");

console.log("\n=== entcStatus (o retrato do mês) ===\n");

const ST = M.entcStatus({ total: 2721, meta: META6, diasLancados: 17, diasOperacionais: 26 });
eq("53) status: % atingido", d2(ST.pct), "75.58");
eq("54) status: % esperado", d2(ST.esperado), "65.38");
eq("55) status: diferença em pontos", d2(ST.dif), "10.20");
eq("56) status: acima do ritmo", ST.situacao, "acima");
eq("57) status: faltam", ST.faltam, 879);
eq("58) status: média por dia lançado", d2(ST.media), "160.06");
eq("59) status: projeção", Math.round(ST.projecao), 4162);

const VAZIO = M.entcStatus({ total: 0, meta: META6, diasLancados: 0, diasOperacionais: 26 });
eq("60) mês sem lançamento = sem-dados", VAZIO.situacao, "sem-dados");
eq("61) mês sem lançamento: média 0, não NaN", VAZIO.media, 0);
eq("62) mês sem lançamento: sem projeção", VAZIO.projecao, null);
eq("63) mês sem lançamento: 0% atingido", VAZIO.pct, 0);

const UMDIA = M.entcStatus({ total: 160, meta: META6, diasLancados: 1, diasOperacionais: 26 });
eq("64) um dia só: sem projeção", UMDIA.projecao, null);
eq("65) um dia só: já tem situação", UMDIA.situacao !== "sem-dados", "true");

const FECHADO = M.entcStatus({ total: 3900, meta: META6, diasLancados: 26, diasOperacionais: 26 });
eq("66) todos os dias lançados = mês concluído", FECHADO.situacao, "concluido");
eq("67) mês concluído: projeção = realizado", FECHADO.projecao, 3900);
eq("68) mês concluído acima da meta: excedente", FECHADO.excedente, 300);

const RUIM = M.entcStatus({ total: 900, meta: META6, diasLancados: 17, diasOperacionais: 26 });
eq("69) muito abaixo = meta em risco", RUIM.situacao, "risco");
eq("70) status sem argumento não quebra", M.entcStatus().situacao, "sem-dados");
eq("71) status com texto no lugar de número não vira NaN", M.entcStatus({ total: "x", meta: "y", diasLancados: 0, diasOperacionais: 0 }).pct, 0);

console.log("\n=== Validação do que é digitado ===\n");

eq("72) vazio é válido (dia não apurado)", M.entcValidaLancamento("").vazio, "true");
eq("73) só espaços = vazio", M.entcValidaLancamento("   ").vazio, "true");
eq("74) 0 é válido (zero confirmado)", M.entcValidaLancamento("0").valor, 0);
eq("75) 0 NÃO é vazio", M.entcValidaLancamento("0").vazio, "undefined");
eq("76) 42 vale 42", M.entcValidaLancamento("42").valor, 42);
eq("77) negativo é recusado", M.entcValidaLancamento("-5").erro, "negativo");
eq("78) decimal com vírgula é recusado", M.entcValidaLancamento("4,5").erro, "decimal");
eq("79) decimal com ponto é recusado", M.entcValidaLancamento("4.5").erro, "decimal");
eq("80) letra é recusada", M.entcValidaLancamento("abc").erro, "invalido");
eq("81) número com letra é recusado", M.entcValidaLancamento("4a").erro, "invalido");
eq("82) null vira vazio, não quebra", M.entcValidaLancamento(null).vazio, "true");
eq("83) número (não texto) é aceito", M.entcValidaLancamento(7).valor, 7);
eq("84) zeros à esquerda viram número", M.entcValidaLancamento("007").valor, 7);

console.log("\n=== Valor fora do padrão ===\n");

const HIST = [40, 42, 38, 45, 41, 39, 44, 43, 40, 42];   // ordenado: 38..45, mediana 41,5
eq("85) mediana de 10 valores (par: média dos dois do meio)", M.entcMediana(HIST), 41.5);
eq("86) mediana de lista ímpar", M.entcMediana([1, 2, 3]), 2);
eq("87) mediana de lista vazia = 0", M.entcMediana([]), 0);
eq("88) mediana não altera o array original", (function () { const a = [3, 1, 2]; M.entcMediana(a); return a.join(","); })(), "3,1,2");
eq("89) 300 é alto demais", M.entcAnormal(300, HIST).tipo, "alto");
eq("90) 5 é baixo demais", M.entcAnormal(5, HIST).tipo, "baixo");
eq("91) 40 é normal", M.entcAnormal(40, HIST), null);
eq("92) ZERO nunca é 'baixo demais' (zero confirmado é legítimo)", M.entcAnormal(0, HIST), null);
eq("93) sem histórico suficiente, não opina", M.entcAnormal(300, [40, 42]), null);
eq("94) histórico só de zeros não opina", M.entcAnormal(300, [0, 0, 0, 0, 0, 0]), null);
eq("95) exatamente 3x ainda não é anormal", M.entcAnormal(123, HIST), null);
eq("96) mínimo de histórico centralizado", M.ENT_ANORMAL_MIN, 5);
eq("97) fator centralizado", M.ENT_ANORMAL_FATOR, 3);
// se olhasse os 20, a mediana seria ~50; olhando só os 10 últimos, é 100
eq("98) usa só os últimos 10 lançamentos", M.entcAnormal(500, [1,1,1,1,1,1,1,1,1,1,100,100,100,100,100,100,100,100,100,100]).base, 100);

console.log("\n=== Líder do mês ===\n");

const TOT = [{ nome: "Anderson", total: 540 }, { nome: "Lucas", total: 480 }, { nome: "Nilton", total: 300 }];
eq("99) líder é o maior", M.entcLider(TOT).nomes.join(","), "Anderson");
eq("100) total do líder", M.entcLider(TOT).total, 540);
eq("101) EMPATE mostra os dois", M.entcLider([{ nome: "A", total: 500 }, { nome: "B", total: 500 }]).nomes.join(" e "), "A e B");
eq("102) ninguém lançou = sem líder", M.entcLider([{ nome: "A", total: 0 }, { nome: "B", total: 0 }]), null);
eq("103) lista vazia = sem líder", M.entcLider([]), null);
eq("104) sem argumento não quebra", M.entcLider(), null);
eq("105) entregador sem lançamento não vira líder", M.entcLider([{ nome: "A", total: 0 }, { nome: "B", total: 12 }]).nomes.join(","), "B");

console.log("\n=== Acumulado real x necessário ===\n");

const totalDia = (d) => (lanc1a20(d) ? 160 : 0);
const ACC = M.entcAcumulado(A, MES, soDomingo, totalDia, lanc1a20, META6);
eq("106) só dias operacionais entram", ACC.length, 26);
eq("107) primeiro ponto é o dia 1", ACC[0].dia, 1);
eq("108) domingo (dia 2) não aparece", ACC.map((p) => p.dia).indexOf(2), -1);
eq("109) esperado cresce em passo igual", d2(ACC[0].esperado), d2(META6 / 26));
eq("110) esperado termina exatamente na meta", d2(ACC[25].esperado), "3600.00");
eq("111) real acumula só em dia lançado", ACC[16].real, 17 * 160);
eq("112) real PARA de crescer em dia sem lançamento", ACC[25].real, ACC[16].real);
eq("113) marca quais dias foram lançados", ACC[0].lancado, "true");
eq("114) marca os não lançados", ACC[25].lancado, "false");
eq("115) mês sem nada lançado: real fica em 0", M.entcAcumulado(A, MES, soDomingo, () => 0, nunca, META6)[25].real, 0);
eq("116) meta zero não gera NaN no esperado", M.entcAcumulado(A, MES, soDomingo, totalDia, lanc1a20, 0)[10].esperado, 0);

console.log("\n=== Regressão: o mês de exemplo da auditoria ===\n");
// 6 entregadores, 17 dias lançados, 2.721 entregas — os números que a tela mostrava
// ERRADOS antes desta sprint, agora conferidos um a um.
const AUD = M.entcStatus({ total: 2721, meta: 600 * 6, diasLancados: 17, diasOperacionais: 26 });
eq("117) ANTES a tela dizia 24,42% — agora diz 75,58%", d2(AUD.pct), "75.58");
eq("118) ANTES a média era 87,77 (÷31) — agora 160,06", d2(AUD.media), "160.06");
eq("119) ANTES 'dias restantes' era 25 — agora 9 dias úteis", M.entcDiasOperRestantes(A, MES, soDomingo, lanc1a20, HOJE), 9);
eq("120) projeção do mês", Math.round(AUD.projecao), 4162);

console.log("\n" + (falhou ? "FALHOU: " + falhou + " de " + (ok + falhou) : "TUDO OK: " + ok + " testes") + "\n");
process.exit(falhou ? 1 : 0);
