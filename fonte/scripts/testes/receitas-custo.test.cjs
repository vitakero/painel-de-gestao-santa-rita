// Testes do cálculo de custo da Ficha Técnica de Receitas.
// NÃO duplica a lógica: extrai o módulo de cálculo do painel já gerado (output/index.html),
// entre os marcadores ==RECCALC-INICIO== e ==RECCALC-FIM==, e roda os casos contra ele.
//   node scripts/testes/receitas-custo.test.cjs
const fs = require("fs");
const path = require("path");

const HTML = fs.readFileSync(path.join(__dirname, "..", "..", "output", "index.html"), "utf8");
const ini = HTML.indexOf("==RECCALC-INICIO==");
const fim = HTML.indexOf("==RECCALC-FIM==");
if (ini < 0 || fim < 0) { console.log("ERRO: não achei o módulo de cálculo no output/index.html (rode o build antes)."); process.exit(1); }
// pega só o código: do fim do comentário de abertura até o início do comentário de fechamento
const codigo = HTML.slice(HTML.indexOf("*/", ini) + 2, HTML.lastIndexOf("/*", fim));

// brl() é do painel; aqui basta uma equivalente pro módulo funcionar isolado.
const brl = (x) => (x || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
// recSing vive fora do módulo (rótulo do rendimento); stub simples pros testes financeiros.
const recSing = (u) => ({ fatias: "fatia", unidades: "unidade", porções: "porção", potes: "pote", bandejas: "bandeja", formas: "forma", pizzas: "pizza", copos: "copo" }[String(u || "").toLowerCase()] || u || "unidade");
const M = new Function("brl", "recSing", codigo + "\nreturn {recUnValida,recUnTipo,recUnRef,recUnCompat,recQtdNaRef,recCustoLinha,recTotalIngr,recFmtRef,recFinCalc,recMoeda,recPct,recPrecosSugeridos,recSaude,recHistVar,recCopLinha,recTotalCop,recEmbLinha,recTotalEmb,REC_UN,COP_UNS,COP_CATS,recProdAnalise,recProdMedia,recTempoMin,recTempoFmt,recPesoKg,recNumBR,recDesvNivel,ratValorSetor,ratCompat,ratCustoLinha,ratCalcular,ratSimular,RAT_SETORES,RAT_CATS,RAT_CRITS,RAT_PROD,REC_UNS,REC_UN,REC_REND_UNS,REC_REGRAS};")(brl, recSing);

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + obtido + (bate ? "" : "   (esperado: " + esperado + ")"));
  bate ? ok++ : falhou++;
}
const cent = (v) => (Math.round(v * 100) / 100).toFixed(2);   // valor como aparece na tela

const R = (q, u, n, p) => ({ q: q, u: u, n: n, p: p, pu: M.recUnRef(u) });
const RECEITA = [
  R(1, "kg", "Mistura para bolo", 9.73),
  R(800, "ml", "Leite", 4.45),
  R(150, "g", "Margarina", 9.46),
  R(30, "g", "Queijo ralado", 55.14),
];

console.log("\n=== Ficha Técnica — cálculo de custo ===\n");

eq("1) 1 kg x R$ 9,73/kg", cent(M.recCustoLinha(RECEITA[0]).custo), "9.73");
eq("2) 800 ml x R$ 4,45/L", cent(M.recCustoLinha(RECEITA[1]).custo), "3.56");
eq("3) 150 g x R$ 9,46/kg (exibição)", cent(M.recCustoLinha(RECEITA[2]).custo), "1.42");
eq("4) 30 g x R$ 55,14/kg (exibição)", cent(M.recCustoLinha(RECEITA[3]).custo), "1.65");
eq("5) 7 un x R$ 0,85/un", cent(M.recCustoLinha(R(7, "un", "Ovos", 0.85)).custo), "5.95");
eq("6) total da receita do exemplo", M.recTotalIngr(RECEITA).toFixed(2), "16.36");

// 7) alterar a quantidade recalcula
const alt = Object.assign({}, RECEITA[1], { q: 400 });
eq("7) mudar 800 ml -> 400 ml", cent(M.recCustoLinha(alt).custo), "1.78");

// 8) alterar a unidade recalcula (150 g -> 150 kg mantendo o preço/kg)
const altU = Object.assign({}, RECEITA[2], { u: "kg", pu: M.recUnRef("kg") });
eq("8) mudar 150 g -> 150 kg", cent(M.recCustoLinha(altU).custo), "1419.00");

// 9) remover ingrediente muda o total
eq("9) total sem o queijo", M.recTotalIngr(RECEITA.slice(0, 3)).toFixed(2), "14.71");

// 10) conversão incompatível é rejeitada
eq("10a) kg com preço por L", M.recCustoLinha({ q: 1, u: "kg", p: 10, pu: "L" }).ok, "false");
eq("10b) un com preço por kg", M.recCustoLinha({ q: 1, u: "un", p: 10, pu: "kg" }).ok, "false");
eq("10c) g com preço por ml", M.recCustoLinha({ q: 1, u: "g", p: 10, pu: "ml" }).ok, "false");
eq("10d) incompatível não entra no total", M.recTotalIngr([RECEITA[0], { q: 1, u: "kg", p: 99, pu: "L" }]).toFixed(2), "9.73");

// 11) quantidade zero = custo zero
eq("11) 0 kg x R$ 9,73/kg", cent(M.recCustoLinha(R(0, "kg", "X", 9.73)).custo), "0.00");

// 12) valores negativos rejeitados
eq("12a) quantidade negativa", M.recCustoLinha(R(-1, "kg", "X", 9.73)).ok, "false");
eq("12b) preço negativo", M.recCustoLinha(R(1, "kg", "X", -9.73)).ok, "false");

// extras: precisão e unidades
eq("13) unidade fora das 5 é rejeitada", M.recCustoLinha({ q: 1, u: "dz", p: 10, pu: "dz" }).ok, "false");
eq("14) as unidades do seletor", M.REC_UNS.join(","), "kg,g,L,ml,un,m,cm");

// CENTÍMETRO (13/08/2026): ninguém diz "0,3 metros de filme", diz "30 centímetros".
eq("14k) 30 cm com preço por metro", cent(M.recCustoLinha({ q: 30, u: "cm", p: 0.11, pu: "m" }).custo), "0.03");
eq("14l) 100 cm = 1 metro", cent(M.recCustoLinha({ q: 100, u: "cm", p: 0.11, pu: "m" }).custo), "0.11");
eq("14m) 250 cm = 2,5 m", cent(M.recCustoLinha({ q: 250, u: "cm", p: 2, pu: "m" }).custo), "5.00");
eq("14n) cm é comprimento, igual ao metro", M.recUnCompat("cm", "m"), "true");
eq("14o) cm NÃO se mistura com peso", M.recUnCompat("cm", "kg"), "false");
eq("14p) 1 cm em metros", M.recQtdNaRef(1, "cm"), "0.01");

// ---------------------------------------------------------------------------------
// EMBALAGEM AGORA CONVERTE, igual ao ingrediente (pedido do dono, 13/08/2026). Antes era
// só quantidade × preço, e por isso a unidade ficava travada na tela: preço por metro com
// quantidade em cm daria um número 100 vezes errado, sem avisar ninguém.
console.log("\n--- embalagem: conversão e base ---\n");
const EMB = (r, rend) => M.recEmbLinha(r, { rend: rend });
eq("14q) 1 bandeja por receita", cent(EMB({ q: 1, u: "un", pu: "un", p: 0.1, base: "Por receita" }).custo), "0.10");
eq("14r) 1 bandeja por unidade produzida (8)", cent(EMB({ q: 1, u: "un", pu: "un", p: 0.1, base: "Por unidade produzida" }, 8).custo), "0.80");
eq("14s) 50 cm de filme por unidade (8), preço por metro",
   cent(EMB({ q: 50, u: "cm", pu: "m", p: 0.11, base: "Por unidade produzida" }, 8).custo), "0.44");
eq("14t) meio metro dá o mesmo que 50 cm",
   cent(EMB({ q: 0.5, u: "m", pu: "m", p: 0.11, base: "Por unidade produzida" }, 8).custo), "0.44");
eq("14u) unidade incompatível é RECUSADA, não calculada errado",
   EMB({ q: 1, u: "kg", pu: "m", p: 0.11, base: "Por receita" }).ok, "false");
eq("14v) e diz o porquê",
   /converter/.test(EMB({ q: 1, u: "kg", pu: "m", p: 0.11, base: "Por receita" }).erro), "true");
eq("14w) por unidade produzida sem rendimento não inventa",
   EMB({ q: 1, u: "un", pu: "un", p: 0.1, base: "Por unidade produzida" }, 0).ok, "false");
eq("14x) sem unidade na linha, usa a do preço",
   cent(EMB({ q: 2, pu: "m", p: 0.11, base: "Por receita" }).custo), "0.22");
eq("14y) total soma as linhas convertidas",
   M.recTotalEmb([{ q: 50, u: "cm", pu: "m", p: 0.11, base: "Por unidade produzida" },
                  { q: 1, u: "un", pu: "un", p: 0.1, base: "Por unidade produzida" }], { rend: 8 }).toFixed(2), "1.24");

// ---------------------------------------------------------------------------------
// METRO (12/08/2026) — filme, papel manteiga, barbante: compra em rolo, preço por metro.
// O risco de uma unidade nova é ela virar "compatível" com outra e deixar somar coisa que
// não se soma. Por isso metro tem TIPO PRÓPRIO.
eq("14a) 3 m x R$ 2,50/m", cent(M.recCustoLinha({ q: 3, u: "m", p: 2.5, pu: "m" }).custo), "7.50");
eq("14b) meio metro", cent(M.recCustoLinha({ q: 0.5, u: "m", p: 2.5, pu: "m" }).custo), "1.25");
eq("14c) o preço de referência do metro é por metro", M.recUnRef("m"), "m");
eq("14d) metro NÃO se mistura com peso", M.recUnCompat("m", "kg"), "false");
eq("14e) metro NÃO se mistura com volume", M.recUnCompat("m", "L"), "false");
eq("14f) metro NÃO se mistura com unidade", M.recUnCompat("m", "un"), "false");
eq("14g) metro com metro, sim", M.recUnCompat("m", "m"), "true");
eq("14h) m com preço por kg é recusado", M.recCustoLinha({ q: 1, u: "m", p: 10, pu: "kg" }).ok, "false");
eq("14i) kg com preço por m é recusado", M.recCustoLinha({ q: 1, u: "kg", p: 10, pu: "m" }).ok, "false");
eq("14j) 1 m é 1 m (não converte pra nada)", M.recQtdNaRef(1, "m"), "1");
eq("15) soma sem erro de ponto flutuante", M.recTotalIngr([R(100, "g", "a", 0.1), R(100, "g", "b", 0.2)]).toFixed(2), "0.03");
eq("16) nunca soma preço de referência", (M.recTotalIngr(RECEITA) !== 78.78).toString(), "true");

// ---------- painel financeiro ----------
console.log("\n--- painel financeiro ---");
const F = (extra) => M.recFinCalc(Object.assign({ ingr: RECEITA, rendQtd: 16, rendUn: "fatias", modo: "preco" }, extra || {}));

eq("17) custo ingredientes (fonte única)", F().ing.toFixed(2), "16.36");
eq("18) custo total = ingr + emb + outros", F({ custoEmb: 2.5, outros: 1.2 }).total.toFixed(2), "20.06");
eq("19) custo por fatia (16,36 / 16)", cent(F().custoUn), "1.02");
eq("20) rendimento zero -> sem custo unitário", String(F({ rendQtd: 0 }).custoUn), "null");

// Modo 2: markup informado -> preço, lucro, margem
const mk = F({ modo: "markup", markup: 60 });
eq("21) markup 60% -> preço de venda", cent(mk.preco), "26.18");
eq("22) markup 60% -> lucro total", cent(mk.lucro), "9.82");
eq("23) markup 60% -> margem sobre venda", M.recPct(mk.margVenda), "37,5%");
eq("24) markup 60% -> venda por fatia", cent(mk.vendaUn), "1.64");
eq("25) markup 60% -> lucro por fatia", cent(mk.lucroUn), "0.61");

// Modo 1: preço informado -> markup, lucro, margem
const pv = F({ preco: 26.18 });
eq("26) preço 26,18 -> markup", M.recPct(pv.markup), "60,0%");
eq("27) preço 26,18 -> lucro", cent(pv.lucro), "9.82");
eq("28) preço 26,18 -> margem sobre venda", M.recPct(pv.margVenda), "37,5%");

eq("29) sem preço -> indicadores vazios", [pv.preco && 0, String(F().lucro), String(F().margVenda)].join("|"), "0|null|null");
eq("30) prejuízo (preço abaixo do custo)", cent(F({ preco: 10 }).lucro), "-6.36");
eq("31) receita antiga sem preços mantém o custo salvo", M.recFinCalc({ ingr: [], custoIngLegado: 45 }).total.toFixed(2), "45.00");

// 12/08/2026 — O CONTRÁRIO TAMBÉM PRECISA VALER. A trava do custo antigo virou armadilha:
// quem apagava todos os ingredientes, salvava e reabria, via o custo velho de volta, para
// sempre, sem jeito de zerar. A ficha passou a mandar custoIngLegado VAZIO assim que o dono
// mexe nas linhas — e aí zero tem que ser zero mesmo.
eq("31a) sem legado, ficha vazia custa zero", M.recFinCalc({ ingr: [], custoIngLegado: "" }).total.toFixed(2), "0.00");
eq("31b) legado nulo idem", M.recFinCalc({ ingr: [], custoIngLegado: null }).total.toFixed(2), "0.00");
eq("31c) legado zero idem", M.recFinCalc({ ingr: [], custoIngLegado: 0 }).total.toFixed(2), "0.00");
eq("31d) e o legado nunca ganha das linhas de verdade",
   M.recFinCalc({ ingr: RECEITA, custoIngLegado: 999 }).ing.toFixed(2), "16.36");
eq("32) ingredientes com preço vencem o custo legado", M.recFinCalc({ ingr: RECEITA, custoIngLegado: 45 }).ing.toFixed(2), "16.36");
eq("33) outros custos negativos viram zero", M.recFinCalc({ ingr: RECEITA, outros: -5 }).total.toFixed(2), "16.36");
eq("34) unidades de rendimento", M.REC_REND_UNS.join(","), "fatias,unidades,porções,kg,bandejas,formas,pizzas,copos,potes");
eq("35) rótulo no singular", F().un, "fatia");

// ---------- indicadores gerenciais ----------
console.log("\n--- indicadores gerenciais ---");
eq("36) custo por kg (peso final 2,35)", cent(F({ pesoFinal: 2.35 }).custoKg), "6.96");
eq("37) sem peso final -> sem custo por kg", String(F().custoKg), "null");
eq("38) peso negativo é ignorado", String(F({ pesoFinal: -3 }).custoKg), "null");

// ---------- preço por quilo (11/08/2026) ----------
// A loja vende rotisseria e açougue NA BALANÇA. Saber o preço do quilo é o que ele digita
// na etiqueta; ter só o "por unidade" obrigava a fazer a conta de cabeça.
const KG = F({ pesoFinal: 2.35, preco: 26.18 });
eq("38a) venda por kg (26,18 / 2,35)", cent(KG.vendaKg), "11.14");
eq("38b) sem preço não inventa venda por kg", String(F({ pesoFinal: 2.35 }).vendaKg), "null");
eq("38c) sem peso não inventa venda por kg", String(F({ preco: 26.18 }).vendaKg), "null");
eq("38d) peso negativo não vira venda por kg", String(F({ pesoFinal: -3, preco: 26.18 }).vendaKg), "null");

// rendimento JÁ em kg: o próprio rendimento é o peso (não obrigar a digitar duas vezes)
const RKG = F({ rendUn: "kg", rendQtd: 2, preco: 26.18 });
eq("38e) rendimento em kg vira o peso (custo)", cent(RKG.custoKg), "8.18");
eq("38f) rendimento em kg vira o peso (venda)", cent(RKG.vendaKg), "13.09");
eq("38g) a tela sabe que o rendimento já é kg", String(RKG.emKg), "true");
eq("38h) rendimento em fatias não é kg", String(F().emKg), "false");
eq("38i) 'quilos' também conta como kg", String(F({ rendUn: "quilos", rendQtd: 2 }).emKg), "true");

// peso final digitado MANDA mais que o rendimento (o cozido perde água: rende 2 kg de carne
// crua e sai 1,6 kg pronto -> quem vale é o que foi pra balança)
const PW = F({ rendUn: "kg", rendQtd: 2, pesoFinal: 1.6, preco: 26.18 });
eq("38j) peso final vence o rendimento", cent(PW.vendaKg), "16.36");
eq("38k) rendimento kg zerado não divide", String(F({ rendUn: "kg", rendQtd: 0, preco: 26.18 }).vendaKg), "null");

const comp = F({ custoEmb: 2.5, outros: 1.2 }).comp;   // 16,36 + 2,50 + 1,20 = 20,06
eq("39) composição: ingredientes", M.recPct(comp.ing), "81,6%");
eq("40) composição: embalagem", M.recPct(comp.emb), "12,5%");
eq("41) composição: outros", M.recPct(comp.outros), "6,0%");
eq("42) composição soma 100%", (Math.round((comp.ing + comp.emb + comp.outros) * 10) / 10).toFixed(1), "100.0");

const P = M.recPrecosSugeridos(16.36);
eq("43) preço mínimo (markup 30%)", cent(P.minimo), "21.27");
eq("44) preço ideal (markup 60%)", cent(P.ideal), "26.18");
eq("45) preço premium (markup 100%)", cent(P.premium), "32.72");
eq("46) sem custo -> sem sugestão", String(M.recPrecosSugeridos(0).ideal), "null");

eq("47) saúde: margem 37,5% = excelente", M.recSaude(37.5).nivel, "bom");
eq("48) saúde: margem 20% = atenção", M.recSaude(20).nivel, "atencao");
eq("49) saúde: margem 5% = revisar", M.recSaude(5).nivel, "ruim");
eq("50) saúde: prejuízo = revisar", M.recSaude(-12).nivel, "ruim");
eq("51) saúde: sem preço", M.recSaude(null).nivel, "vazio");
eq("52) saúde do exemplo (markup 60%)", F({ modo: "markup", markup: 60 }).saude.titulo, "Excelente");

const h = M.recHistVar([{ d: "2026-08-15", c: 15.8 }], 16.36);
eq("53) histórico: custo anterior", h.anterior.toFixed(2), "15.80");
eq("54) histórico: variação %", M.recPct(h.variacao), "3,5%");
eq("55) sem histórico", String(M.recHistVar([], 16.36)), "null");
eq("56) regras de markup configuráveis", [M.REC_REGRAS.mkMinimo, M.REC_REGRAS.mkIdeal, M.REC_REGRAS.mkPremium].join("/"), "30/60/100");

// ---------- custos operacionais ----------
console.log("\n--- custos operacionais ---");
const C = (q, u, n, p) => ({ q: q, u: u, n: n, p: p });
const OPS = [C(1, "Por receita", "Mão de obra", 3.5), C(1, "Por receita", "Energia", 0.8), C(1, "Por receita", "Gás", 1.2)];

eq("57) linha por receita (1 x 3,50)", cent(M.recCopLinha(OPS[0], {}).custo), "3.50");
eq("58) total operacional do exemplo", M.recTotalCop(OPS, {}).toFixed(2), "5.50");
eq("59) por hora: 0,5 h x R$ 18,00", cent(M.recCopLinha(C(0.5, "Por hora", "Padeiro", 18), {}).custo), "9.00");
eq("60) por minuto: 20 min x R$ 0,30", cent(M.recCopLinha(C(20, "Por minuto", "Forno", 0.3), {}).custo), "6.00");
eq("61) por kg produzido: 2,35 kg x R$ 1,10", cent(M.recCopLinha(C(2.35, "Por kg produzido", "Energia", 1.1), {}).custo), "2.59");
eq("62) por unidade: 16 x R$ 0,05", cent(M.recCopLinha(C(16, "Por unidade produzida", "Etiqueta", 0.05), {}).custo), "0.80");
eq("63) percentual: 10% sobre 16,86 (ingr+emb)", cent(M.recCopLinha(C(1, "Percentual", "Rateio", 10), { direto: 16.86 }).custo), "1.69");
eq("64) unidade de cálculo inválida", M.recCopLinha(C(1, "Por sei la", "X", 5), {}).ok, "false");
eq("65) valor negativo rejeitado", M.recCopLinha(C(1, "Por receita", "X", -5), {}).ok, "false");
eq("66) 8 unidades de cálculo", M.COP_UNS.length, "8");
// "Por dia" entrou em 21/08/2026 a pedido do dono. A conta é a mesma das outras
// (quantidade × valor) — nenhuma conversão escondida entre dia, hora e minuto.
eq("66a) por dia existe", M.COP_UNS.indexOf("Por dia") >= 0, "true");
eq("66b) por dia: 0,5 dia x R$ 200,00", cent(M.recCopLinha(C(0.5, "Por dia", "Diária", 200), {}).custo), "100.00");
eq("66c) por dia: 2 dias x R$ 200,00", cent(M.recCopLinha(C(2, "Por dia", "Diária", 200), {}).custo), "400.00");
// as duas telas têm que oferecer a mesma unidade: divergir aqui é o usuário cadastrar
// um custo que o rateio não sabe aplicar
eq("66d) o rateio também conhece por dia", M.RAT_CRITS.indexOf("Por dia") >= 0, "true");
eq("66e) e sabe de onde tirar a quantidade", !!M.RAT_PROD["Dias de produção"], "true");
eq("66f) dias de produção usa o critério por dia", M.RAT_PROD["Dias de produção"].crit, "Por dia");

/* O TEMPO DA FICHA ALIMENTA O CUSTO — 21/08/2026.
   Antes o mesmo tempo era digitado duas vezes: "1h20" no campo Tempo de preparo e
   "1,33" na linha de custo. Dois lugares com o mesmo número sempre divergem: daqui a
   três meses alguém corrige um e esquece o outro, e o custo passa a mentir calado.
   Agora quantidade em branco + unidade de tempo = usa o tempo de preparo. */
eq("66g) em branco + por hora usa o tempo (1h20 = 80min)",
   cent(M.recCopLinha(C("", "Por hora", "Padeira", 30), {min:80}).custo), "40.00");
eq("66h) e diz que veio do tempo",
   M.recCopLinha(C("", "Por hora", "Padeira", 30), {min:80}).doTempo, "true");
eq("66i) em branco + por minuto usa os minutos",
   cent(M.recCopLinha(C("", "Por minuto", "Padeira", 0.5), {min:80}).custo), "40.00");
// O QUE FOI DIGITADO MANDA: o campo continua valendo mais que a ficha.
eq("66j) quantidade digitada ganha do tempo da ficha",
   cent(M.recCopLinha(C(2, "Por hora", "Padeira", 30), {min:80}).custo), "60.00");
eq("66k) e não diz que veio do tempo",
   M.recCopLinha(C(2, "Por hora", "Padeira", 30), {min:80}).doTempo, "false");
// ZERO DIGITADO É UMA ESCOLHA, não é "em branco". Confundir os dois faria um custo
// que a pessoa zerou de propósito voltar sozinho.
eq("66l) zero digitado continua zero",
   cent(M.recCopLinha(C(0, "Por hora", "Padeira", 30), {min:80}).custo), "0.00");
// Sem tempo na ficha, em branco é zero — não inventa número.
eq("66m) sem tempo na ficha não inventa",
   cent(M.recCopLinha(C("", "Por hora", "Padeira", 30), {}).custo), "0.00");
// "Por dia" NÃO converte: minuto para dia exigiria saber quantas horas tem o dia de
// produção, e isso é decisão do dono.
eq("66n) por dia não puxa o tempo sozinho",
   M.recCopLinha(C("", "Por dia", "Diária", 200), {min:80}).doTempo, "false");
// unidades que não são de tempo também não puxam
eq("66o) por kg não puxa o tempo",
   cent(M.recCopLinha(C("", "Por kg produzido", "x", 10), {min:80}).custo), "0.00");

/* O TEMPO TEM QUE CHEGAR NO TOTAL, e não só na linha.
   Defeito real pego na tela em 21/08/2026: a LINHA mostrava R$ 40 (ela lê o campo de
   tempo ao vivo) e o TOTAL mostrava R$ 0 (a receita era montada sem o campo tempo).
   Dois lugares calculando o mesmo custo com entradas diferentes. */
eq("66p) o total enxerga o tempo da ficha",
   cent(M.recFinCalc({ ingr:[], custosOp:[C("", "Por hora", "Padeira", 30)],
                       tempo:"1h20", rendQtd:8 }).outros), "40.00");
eq("66q) e entra no custo total",
   cent(M.recFinCalc({ ingr:[], custosOp:[C("", "Por hora", "Padeira", 30)],
                       tempo:"1h20", rendQtd:8 }).total), "40.00");
eq("66r) mudar o tempo muda o total",
   cent(M.recFinCalc({ ingr:[], custosOp:[C("", "Por hora", "Padeira", 30)],
                       tempo:"2h", rendQtd:8 }).outros), "60.00");
// sem tempo na ficha, o total não inventa
eq("66s) sem tempo o total fica zero",
   cent(M.recFinCalc({ ingr:[], custosOp:[C("", "Por hora", "Padeira", 30)],
                       rendQtd:8 }).outros), "0.00");
// E O QUE MAIS IMPORTA PARA O DONO: o mesmo tempo, rendendo mais, derruba o custo
// por unidade. É onde está o ganho — não no preço.
eq("66t) 8 bolos na fornada de 1h20",
   cent(M.recFinCalc({ ingr:[], custosOp:[C("", "Por hora", "Padeira", 30)],
                       tempo:"1h20", rendQtd:8 }).custoUn), "5.00");
eq("66u) os mesmos 1h20 rendendo 24",
   cent(M.recFinCalc({ ingr:[], custosOp:[C("", "Por hora", "Padeira", 30)],
                       tempo:"1h20", rendQtd:24 }).custoUn), "1.67");
eq("67) 10 categorias", M.COP_CATS.length, "10");

// integração com o custo total da receita
const FO = M.recFinCalc({ ingr: RECEITA, custoEmb: 0.5, custosOp: OPS, rendQtd: 16, rendUn: "fatias", modo: "preco" });
eq("68) custo total = 16,36 + 0,50 + 5,50", FO.total.toFixed(2), "22.36");
eq("69) linha operacional aparece no total", FO.outros.toFixed(2), "5.50");
eq("70) composição: operacionais", M.recPct(FO.comp.outros), "24,6%");
eq("71) percentual usa ingr+emb como base", M.recFinCalc({ ingr: RECEITA, custoEmb: 0.5, custosOp: [C(1, "Percentual", "Rateio", 10)] }).outros.toFixed(2), "1.69");
eq("72) receita antiga (campo outros) continua valendo", M.recFinCalc({ ingr: RECEITA, outros: 5.8 }).total.toFixed(2), "22.16");

// ---------- rateio de custos ----------
console.log("\n--- rateio de custos ---");
const PROD = { tipo: "Número de receitas", qtd: 4850 };
const D = (cat, desc, total, pct, crit) => ({ cat: cat, desc: desc, valorTotal: total, pctSetor: pct, criterio: crit || "Por receita" });
const RAT = { setor: "Padaria", mes: 8, ano: 2026, producao: PROD, despesas: [
  D("Mão de obra", "Folha Padaria", 40000, 70), D("Energia elétrica", "Energia Padaria", 18500, 40),
  D("Água", "Água Padaria", 3000, 30), D("Limpeza", "Limpeza Padaria", 2600, 25) ] };

eq("73) valor destinado ao setor (18.500 x 40%)", cent(M.ratValorSetor(18500, 40)), "7400.00");
eq("74) R$ 28.000 / 4.850 receitas", cent(M.ratCustoLinha(D("Mão de obra", "x", 40000, 70), PROD).custo), "5.77");
eq("75) R$ 7.400 / 4.850 receitas", cent(M.ratCustoLinha(D("Energia", "x", 18500, 40), PROD).custo), "1.53");
eq("76) R$ 900 / 4.850 receitas", cent(M.ratCustoLinha(D("Água", "x", 3000, 30), PROD).custo), "0.19");
eq("77) R$ 650 / 4.850 receitas", cent(M.ratCustoLinha(D("Limpeza", "x", 2600, 25), PROD).custo), "0.13");
eq("77b) soma das 4 linhas = total (5,77+1,53+0,19+0,13)", (5.77+1.53+0.19+0.13).toFixed(2), "7.62");

const RES = M.ratCalcular(RAT);
eq("78) total das despesas do setor (28.000+7.400+900+650)", RES.totalDespesas.toFixed(2), "36950.00");
eq("79) custo operacional total por receita (bate com o exemplo do Victor)", RES.custoUnitTotal.toFixed(2), "7.62");
eq("80) 4 linhas calculadas", RES.linhas.length, "4");
eq("81) rateio sem erros", RES.ok, "true");

// bloqueios
eq("82) produção zero é bloqueada", M.ratCustoLinha(D("x", "y", 1000, 100), { tipo: "Número de receitas", qtd: 0 }).ok, "false");
eq("83) valor negativo bloqueado", String(M.ratValorSetor(-100, 50)), "null");
eq("84) percentual acima de 100 bloqueado", String(M.ratValorSetor(100, 120)), "null");
eq("85) percentual negativo bloqueado", String(M.ratValorSetor(100, -5)), "null");
eq("86) critério por kg sem kg produzido", M.ratCustoLinha(D("x", "y", 1000, 100, "Por kg produzido"), PROD).ok, "false");
eq("87) critério por hora sem horas", M.ratCustoLinha(D("x", "y", 1000, 100, "Por hora"), PROD).ok, "false");
eq("88) critério compatível (kg com kg)", M.ratCustoLinha(D("x", "y", 1000, 100, "Por kg produzido"), { tipo: "Quilos produzidos", qtd: 500 }).ok, "true");
eq("89) valor fixo não divide pela produção", cent(M.ratCustoLinha(D("x", "y", 1000, 100, "Valor fixo"), PROD).custo), "1000.00");
eq("90) rateio com erro marca ok=false", M.ratCalcular({ producao: PROD, despesas: [D("x", "y", 100, 50, "Por hora")] }).ok, "false");

// simulação NÃO altera o oficial
const antesSim = JSON.stringify(RAT);
const sim = M.ratSimular(RAT, { producaoQtd: 5500 });
eq("91) simulação: produção maior baixa o custo", (sim.depois.custoUnitTotal < sim.antes.custoUnitTotal).toString(), "true");
eq("92) simulação: custo com 5.500 receitas", sim.depois.custoUnitTotal.toFixed(2), "6.72");
eq("93) simulação NÃO altera os dados oficiais", JSON.stringify(RAT) === antesSim ? "true" : "false", "true");
eq("94) simulação de folha maior (45.000)", M.ratSimular(RAT, { despesas: { 0: 45000 } }).depois.custoUnitTotal.toFixed(2), "8.34");
eq("95) 9 setores / 12 categorias", M.RAT_SETORES.length + "/" + M.RAT_CATS.length, "9/12");
eq("96) precisão monetária mantida", M.ratCalcular({ producao: { tipo: "Número de receitas", qtd: 3 }, despesas: [D("a", "a", 10, 100), D("b", "b", 10, 100)] }).custoUnitTotal.toFixed(2), "6.67");

// ---------- rendimento real x ficha ----------
console.log("\n--- produção: rendimento e perda ---");
const A = (boas, perdidas, esp, custo) => M.recProdAnalise({ quantidade: boas, perdidas: perdidas }, esp, custo);

eq("97) saiu tudo: 16 de 16", M.recPct(A(16, 0, 16, 16.36).rendPct), "100,0%");
eq("98) saiu 14 de 16", M.recPct(A(14, 0, 16, 16.36).rendPct), "87,5%");
eq("99) custo real com 14 boas", cent(A(14, 0, 16, 16.36).custoUnitReal), "1.17");
eq("100) custo da ficha (16)", cent(A(14, 0, 16, 16.36).custoUnitFicha), "1.02");
eq("101) diferença por unidade", cent(A(14, 0, 16, 16.36).custoUnitReal - A(14, 0, 16, 16.36).custoUnitFicha), "0.15");
eq("102) perda de produção: 1 de 15 feitas", M.recPct(A(14, 1, 16, 16.36).perdaPct), "6,7%");
eq("103) 10 bolos, 1 desandou -> custo dos 9", cent(A(9, 1, 10, 163.60).custoUnitReal), "18.18");
eq("104) zero boas não divide", String(A(0, 3, 16, 16.36).custoUnitReal), "null");
eq("105) valores negativos viram zero", A(-5, -2, 16, 16.36).boas + "/" + A(-5, -2, 16, 16.36).perdidas, "0/0");
eq("106) aceita vírgula (2,5 kg)", A("2,5", "0,5", 3, 30).boas, "2.5");
eq("107) sem rendimento na ficha", String(A(14, 0, 0, 16.36).rendPct), "null");

const HIST = [{ quantidade: 14 }, { quantidade: 15 }, { quantidade: 16 }, { quantidade: 13 }];
const MED = M.recProdMedia(HIST, 16, 10);
eq("108) média de 4 produções", MED.mediaBoas.toFixed(2), "14.50");
eq("109) rendimento médio vs ficha", M.recPct(MED.rendPct), "90,6%");
eq("110) sem histórico", String(M.recProdMedia([], 16, 10)), "null");
eq("111) ignora registro sem quantidade", M.recProdMedia([{ quantidade: 16 }, { quantidade: "" }], 16, 10).n, "1");

// ---------- tempo e peso: padrão da ficha x realidade ----------
console.log("\n--- produção: tempo e peso ---");
const T = M.recTempoMin;
eq("112) 1h20 -> minutos", String(T("1h20")), "80");
eq("113) 1:20 -> minutos", String(T("1:20")), "80");
eq("114) 80 (número solto) = minutos", String(T("80")), "80");
eq("115) 1h", String(T("1h")), "60");
eq("116) 1,5h", String(T("1,5h")), "90");
eq("117) 2 horas", String(T("2 horas")), "120");
eq("118) 45min", String(T("45 min")), "45");
eq("119) 1h20min", String(T("1h20min")), "80");
eq("120) vazio", String(T("")), "null");
eq("121) não entendeu, não inventa", String(T("depois do almoço")), "null");
eq("122) zero não conta", String(T("0")), "null");
eq('123) "1,20" é ambíguo -> não adivinha', String(T("1,20")), "null");
eq("124) minutos viram 1h05", M.recTempoFmt(65), "1h05");
eq("125) 45 minutos", M.recTempoFmt(45), "45min");
eq("126) 120 -> 2h", M.recTempoFmt(120), "2h");
eq("127) sem tempo", M.recTempoFmt(0), "\u2014");

const FICHA = { tempo: "1h20", pesoFinal: 2.35 };
const PA = (o) => M.recProdAnalise(o, 16, 16.36, FICHA);
eq("128) levou 1h50 contra 1h20", PA({ quantidade: 16, tempo: "1h50" }).tempoDif, "30");
eq("129) desvio do tempo em %", M.recPct(PA({ quantidade: 16, tempo: "1h50" }).tempoPct), "37,5%");
eq("130) levou menos que o previsto", M.recPct(PA({ quantidade: 16, tempo: "1h10" }).tempoPct), "-12,5%");
eq("131) tempo igual ao padrão", M.recPct(PA({ quantidade: 16, tempo: "1h20" }).tempoPct), "0,0%");
eq("132) sem tempo digitado", String(PA({ quantidade: 16 }).tempoPct), "null");
eq("133) ficha sem tempo não compara", String(M.recProdAnalise({ quantidade: 16, tempo: "1h50" }, 16, 16.36, { pesoFinal: 2.35 }).tempoPct), "null");

eq("134) pesou 2,10 contra 2,35", cent(PA({ quantidade: 16, peso: "2,10" }).pesoDif), "-0.25");
eq("135) desvio do peso em %", M.recPct(PA({ quantidade: 16, peso: "2,10" }).pesoPct), "-10,6%");
eq("136) custo real por kg (2,10)", cent(PA({ quantidade: 16, peso: "2,10" }).custoKgReal), "7.79");
eq("137) custo por kg da ficha (2,35)", cent(PA({ quantidade: 16, peso: "2,10" }).custoKgFicha), "6.96");
eq("138) peso zero não divide", String(PA({ quantidade: 16, peso: "0" }).custoKgReal), "null");
eq("139) peso negativo é ignorado", String(PA({ quantidade: 16, peso: "-3" }).pesoReal), "null");
eq("140) ficha sem peso não compara", String(M.recProdAnalise({ quantidade: 16, peso: "2,10" }, 16, 16.36, { tempo: "1h20" }).pesoPct), "null");
eq("141) sem ficha nenhuma (compatível com o de antes)", String(M.recProdAnalise({ quantidade: 14 }, 16, 16.36).tempoReal), "null");

const H2 = [{ quantidade: 16, tempo: "1h30", peso: "2,30" },
            { quantidade: 15, tempo: "1h50", peso: "2,20" },
            { quantidade: 16, tempo: "1h40" }];
const M2 = M.recProdMedia(H2, 16, 10, FICHA);
eq("142) média de tempo (90+110+100)/3", String(M2.mediaTempo), "100");
eq("143) quantos registraram tempo", String(M2.nTempo), "3");
eq("144) tempo médio vs padrão", M.recPct(M2.tempoPct), "25,0%");
eq("145) média de peso só de quem pesou", cent(M2.mediaPeso), "2.25");
eq("146) quantos pesaram", String(M2.nPeso), "2");
eq("147) peso médio vs padrão", M.recPct(M2.pesoPct), "-4,3%");
eq("148) rendimento médio continua certo", cent(M2.mediaBoas), "15.67");
eq("149) só tempo, sem quantidade, ainda vale", String(M.recProdMedia([{ tempo: "1h" }], 16, 10, FICHA).mediaTempo), "60");
eq("150) nada de nada", String(M.recProdMedia([{ obs: "x" }], 16, 10, FICHA)), "null");

// ---------- correções da revisão adversarial ----------
console.log("\n--- produção: travas contra número inventado ---");
const PK = M.recPesoKg;
eq("151) 2,35 -> kg", String(PK("2,35")), "2.35");
eq("152) 2,35 kg", String(PK("2,35 kg")), "2.35");
eq("153) 500 g viram 0,5 kg", String(PK("500 g")), "0.5");
eq("154) 1,5kg", String(PK("1,5kg")), "1.5");
eq('155) "2 kg 300" não vira 2.300 kg', String(PK("2 kg 300")), "null");
eq('156) "2kg300" também não', String(PK("2kg300")), "null");
eq("157) texto não vira número", String(PK("dois quilos e meio")), "null");
eq("158) negativo", String(PK("-3")), "null");
eq("159) zero", String(PK("0")), "null");
eq("160) ponto de milhar igual ao da ficha", String(PK("2.500")), "2500");
eq("161) 2.35 (ponto decimal)", String(PK("2.35")), "2.35");
eq("162) 2hs (abreviação usada na loja)", String(M.recTempoMin("2hs")), "120");
eq("163) 2hrs", String(M.recTempoMin("2 hrs")), "120");
eq("164) 1hr30", String(M.recTempoMin("1hr30")), "90");

console.log("\n--- desvio: o lado bom não é alarme ---");
eq("165) tempo 4% acima = ok", M.recDesvNivel(4, "maior"), "0");
eq("166) tempo 12% acima = atenção", M.recDesvNivel(12, "maior"), "1");
eq("167) tempo 37% acima = ruim", M.recDesvNivel(37.5, "maior"), "2");
eq("168) terminou 25% antes NÃO é alarme", M.recDesvNivel(-25, "maior"), "0");
eq("169) terminou 37% antes = só atenção", M.recDesvNivel(-37.5, "maior"), "1");
eq("170) terminou na metade do tempo = ruim (ficha errada?)", M.recDesvNivel(-60, "maior"), "2");
eq("171) peso 10% ABAIXO = atenção", M.recDesvNivel(-10, "menor"), "1");
eq("172) peso 20% ABAIXO = ruim", M.recDesvNivel(-20, "menor"), "2");
eq("173) peso 20% acima NÃO é alarme", M.recDesvNivel(20, "menor"), "0");
eq("174) sem desvio", M.recDesvNivel(0, "maior"), "0");
eq("175) null não pinta nada", M.recDesvNivel(null, "maior"), "0");

console.log("\n--- lote inteiro perdido não pode sumir da média ---");
const PERDEU_TUDO = [{ quantidade: "16", perdidas: "0" }, { quantidade: "0", perdidas: "16" }];
const MP = M.recProdMedia(PERDEU_TUDO, 16, 10, FICHA);
eq("176) os dois lotes contam", String(MP.n), "2");
eq("177) média cai pela metade", cent(MP.mediaBoas), "8.00");
eq("178) as 16 perdidas aparecem", String(MP.totalPerdidas), "16");
eq("179) rendimento médio real", M.recPct(MP.rendPct), "50,0%");
eq("180) registro em branco continua fora", String(M.recProdMedia([{ quantidade: "16" }, {}], 16, 10, FICHA).n), "1");

console.log("\n" + ok + " passaram, " + falhou + " falharam.\n");
process.exit(falhou ? 1 : 0);
