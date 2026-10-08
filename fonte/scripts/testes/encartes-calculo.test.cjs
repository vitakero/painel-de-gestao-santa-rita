// Testes do PLANEJAMENTO DE ENCARTES — o cálculo (scripts/encartes/calculo.cjs).
// Roda as funções DE VERDADE com datas de 2026 a 2030 cuja resposta foi conferida à parte
// (calendário do Python, em 26/09/2026): ocorrências das campanhas, Páscoa, antecipação de
// prazo, hortifrúti, virada de ano, situação da fila, margem, mudança depois de aprovado,
// coincidências, produto repetido e frescor dos dados do VR.
//   node scripts/testes/encartes-calculo.test.cjs
process.env.TZ = "America/Fortaleza"; // Caicó: UTC−3 o ano todo (a conta de "hoje" tem de ser LOCAL)
const fs = require("fs"), path = require("path"), vm = require("vm");
const ARQ = path.join(__dirname, "..", "encartes", "calculo.cjs");
const E = require(ARQ);

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const o = typeof obtido === "object" ? JSON.stringify(obtido) : String(obtido);
  const e = typeof esperado === "object" ? JSON.stringify(esperado) : String(esperado);
  const bate = o === e;
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + o + (bate ? "" : "   (esperado: " + e + ")"));
  bate ? ok++ : falhou++;
}
const regra = (id) => E.REGRAS_PADRAO.find((r) => r.id === id);
const modelo = (id) => E.MODELOS_PADRAO.find((m) => m.id === id);
const inicios = (L) => L.map((o) => o.inicio).join(",");

console.log("\n-- O ARQUIVO: roda no navegador e no Node, embutível na página --");
{
  const src = fs.readFileSync(ARQ, "utf8");
  eq("marcador ==ENC-CALC== na primeira linha", src.split("\n")[0].includes("==ENC-CALC=="), true);
  eq("nada de '</' (fecharia o <script> da página ou roubaria o último </body>)", src.includes("</"), false);
  eq("nenhuma chamada a toISOString (vira o dia seguinte depois das 21h em Caicó)", /\.toISOString\(/.test(src), false);
  const janela = {};
  vm.runInNewContext(src, { window: janela });
  eq("no navegador vira window.ENC", typeof janela.ENC, "object");
  eq("e calcula igual lá dentro (Páscoa 2027)", janela.ENC.pascoa(2027), "2027-03-28");
  const nomes = ["REGRAS_PADRAO", "MODELOS_PADRAO", "hojeISO", "addDias", "diasEntre", "diaSemana", "fmtData", "pascoa", "lojaFechada",
    "ehFeriado", "diaUtilAnterior", "ocorrencias", "ocorrenciasCampanhas", "calcularPrazos", "periodoGrupo", "prazosEdicao",
    "edicoesParaCriar", "edicoesFuturas", "contarVagas", "situacao", "analiseProposta", "margem", "mudancaMaterial",
    "coincidencias", "sobreposicaoProdutos", "statusDadosVr"];
  eq("todos os nomes que a tela usa existem", nomes.filter((n) => E[n] === undefined).join(",") || "todos", "todos");
}

console.log("\n-- DATAS EM TEXTO, DIA LOCAL --");
{
  eq("23:30 em Caicó (02:30 UTC do dia seguinte) ainda é o dia 26", E.hojeISO(new Date("2026-09-27T02:30:00Z")), "2026-09-26");
  eq("00:30 local já é o dia 27", E.hojeISO(new Date("2026-09-27T03:30:00Z")), "2026-09-27");
  eq("data pura continua a mesma data (não volta um dia pelo UTC)", E.hojeISO("2026-09-26"), "2026-09-26");
  eq("addDias atravessa o ano", E.addDias("2026-12-28", 7), "2027-01-04");
  eq("addDias no bissexto", E.addDias("2028-02-28", 1), "2028-02-29");
  eq("diasEntre (b − a)", E.diasEntre("2026-10-26", "2026-11-23"), 28);
  eq("diasEntre negativo", E.diasEntre("2026-11-23", "2026-10-26"), -28);
  eq("diaSemana: 26/09/2026 é sábado (6)", E.diaSemana("2026-09-26"), 6);
  eq("diaSemana: 27/09/2026 é domingo (0)", E.diaSemana("2026-09-27"), 0);
  eq("diaSemana: 04/01/2027 é segunda (1)", E.diaSemana("2027-01-04"), 1);
  eq("fmtData completa", E.fmtData("2026-11-23"), "23/11/2026");
  eq("fmtData curta", E.fmtData("2026-11-23", { curta: true }), "23/11");
  eq("fmtData com dia da semana", E.fmtData("2026-11-23", { curta: true, semana: true }), "seg 23/11");
  eq("fmtData de vazio não inventa", E.fmtData(null), "");
}

console.log("\n-- PÁSCOA E FERIADOS 2026–2030 --");
{
  eq("Páscoa 2026", E.pascoa(2026), "2026-04-05");
  eq("Páscoa 2027", E.pascoa(2027), "2027-03-28");
  eq("Páscoa 2028", E.pascoa(2028), "2028-04-16");
  eq("Páscoa 2029", E.pascoa(2029), "2029-04-01");
  eq("Páscoa 2030", E.pascoa(2030), "2030-04-21");
  eq("loja fechada: 01/01", E.lojaFechada("2027-01-01"), true);
  eq("loja fechada: Sexta-feira Santa 2027 (26/03)", E.lojaFechada("2027-03-26"), true);
  eq("loja fechada: 01/05", E.lojaFechada("2027-05-01"), true);
  eq("loja fechada: 25/12", E.lojaFechada("2026-12-25"), true);
  eq("loja ABRE no feriado de 12/10", E.lojaFechada("2026-10-12"), false);
  eq("feriado: Carnaval segunda 2027 (08/02)", E.ehFeriado("2027-02-08"), true);
  eq("feriado: Carnaval terça 2027 (09/02)", E.ehFeriado("2027-02-09"), true);
  eq("Quarta de Cinzas não é feriado", E.ehFeriado("2027-02-10"), false);
  eq("feriado: Corpus Christi 2026 (04/06)", E.ehFeriado("2026-06-04"), true);
  eq("feriado: Corpus Christi 2027 (27/05)", E.ehFeriado("2027-05-27"), true);
  eq("feriado: Consciência Negra", E.ehFeriado("2026-11-20"), true);
  eq("feriado: Finados", E.ehFeriado("2026-11-02"), true);
  eq("dia comum não é feriado", E.ehFeriado("2026-11-03"), false);
}

console.log("\n-- OCORRÊNCIAS DAS CAMPANHAS --");
{
  const ps = E.ocorrencias(regra("promocao-semanal"), "2026-11-01", "2026-11-30");
  eq("PS: toda segunda (a de 26/10 ainda está no ar em 01–02/11)", inicios(ps), "2026-10-26,2026-11-02,2026-11-09,2026-11-16,2026-11-23,2026-11-30");
  eq("PS: segunda → domingo (7 dias; sai na segunda seguinte 00h)", ps.map((o) => o.fim).join(","), "2026-11-01,2026-11-08,2026-11-15,2026-11-22,2026-11-29,2026-12-06");
  eq("PS: duas semanas seguidas não se encostam (nenhum dia com duas PS)", ps.every((o, i) => i === 0 || ps[i - 1].fim < o.inicio), true);
  eq("PS: inicio_regra = início", ps.every((o) => o.inicio_regra === o.inicio), true);
  eq("PS: todas começam na segunda", ps.every((o) => E.diaSemana(o.inicio) === 1), true);
  const ps30 = E.ocorrencias(regra("promocao-semanal"), "2030-01-01", "2030-12-31");
  eq("PS 2030: 53 edições tocam o ano (a de 30/12/2029 entra em 01/01)", ps30.length, 53);
  const t = E.ocorrencias(regra("tercou"), "2026-10-01", "2026-10-31");
  eq("Terçou: toda terça de outubro/2026", inicios(t), "2026-10-06,2026-10-13,2026-10-20,2026-10-27");
  eq("Terçou: só a terça (entra terça 00h, sai quarta 00h)", t[1].fim, "2026-10-13");
  const sb = E.ocorrencias(regra("sabado-bombastico"), "2026-01-01", "2030-12-31");
  eq("SB: 60 edições em 5 anos", sb.length, 60);
  eq("SB 2026 (2º sábado)", inicios(sb.filter((o) => o.inicio < "2027")),
    "2026-01-10,2026-02-14,2026-03-14,2026-04-11,2026-05-09,2026-06-13,2026-07-11,2026-08-08,2026-09-12,2026-10-10,2026-11-14,2026-12-12");
  eq("SB 2029 (2º sábado)", inicios(sb.filter((o) => o.inicio.startsWith("2029"))),
    "2029-01-13,2029-02-10,2029-03-10,2029-04-14,2029-05-12,2029-06-09,2029-07-14,2029-08-11,2029-09-08,2029-10-13,2029-11-10,2029-12-08");
  eq("SB: sábado + domingo prorrogado", sb[9].fim, "2026-10-11");
  const he = E.ocorrencias(regra("hora-da-economia"), "2026-01-01", "2030-12-31");
  eq("HE 2026 (última quinta, dezembro = 31/12)", inicios(he.filter((o) => o.inicio < "2027")),
    "2026-01-29,2026-02-26,2026-03-26,2026-04-30,2026-05-28,2026-06-25,2026-07-30,2026-08-27,2026-09-24,2026-10-29,2026-11-26,2026-12-31");
  eq("HE 2028 (fevereiro bissexto: 24/02; novembro: 30/11)", inicios(he.filter((o) => o.inicio.startsWith("2028"))),
    "2028-01-27,2028-02-24,2028-03-30,2028-04-27,2028-05-25,2028-06-29,2028-07-27,2028-08-31,2028-09-28,2028-10-26,2028-11-30,2028-12-28");
  eq("HE 2030 (outubro = 31/10)", he.filter((o) => o.inicio.startsWith("2030-10"))[0].inicio, "2030-10-31");
  const bf = E.ocorrencias(regra("black-friday"), "2026-01-01", "2030-12-31");
  eq("Black Friday 2026–2030 (dia seguinte à 4ª quinta de novembro; 2029 = 23/11, não 30/11)", inicios(bf), "2026-11-27,2027-11-26,2028-11-24,2029-11-23,2030-11-29");
  eq("  a regra da Black Friday é a combinada (4ª quinta + 1 dia)", JSON.stringify(regra("black-friday").regra),
    JSON.stringify({ tipo: "anual_nth", mes: 11, n: 4, dia_semana: 4, deslocamento_dias: 1, duracao_dias: 1 }));
  eq("  toda Black Friday cai numa sexta", bf.every((o) => E.diaSemana(o.inicio) === 5), true);
  const car = E.ocorrencias(regra("carnaval"), "2027-01-01", "2027-12-31");
  eq("Carnaval 2027: segunda 08/02 a terça 09/02", JSON.stringify(car.map((o) => [o.inicio, o.fim])), JSON.stringify([["2027-02-08", "2027-02-09"]]));
  eq("Carnaval 2026: 16/02", E.ocorrencias(regra("carnaval"), "2026-01-01", "2026-12-31")[0].inicio, "2026-02-16");
  eq("Páscoa (regra) 2028", E.ocorrencias(regra("pascoa"), "2028-01-01", "2028-12-31")[0].inicio, "2028-04-16");
  const maes = E.ocorrencias(regra("dia-das-maes"), "2026-01-01", "2030-12-31");
  eq("Mães: 2º domingo de maio 2026–2030", inicios(maes), "2026-05-10,2027-05-09,2028-05-14,2029-05-13,2030-05-12");
  eq("Pais: 2º domingo de agosto 2027", E.ocorrencias(regra("dia-dos-pais"), "2027-01-01", "2027-12-31")[0].inicio, "2027-08-08");
  eq("data fixa: Aniversário 16/09 em 2029", E.ocorrencias(regra("aniversario-santa-rita"), "2029-01-01", "2029-12-31")[0].inicio, "2029-09-16");
  eq("Volta às Aulas: lista vazia = nenhuma ocorrência (nunca 15/01 fixo)", E.ocorrencias(regra("volta-as-aulas"), "2026-01-01", "2030-12-31").length, 0);
  const va = Object.assign({}, regra("volta-as-aulas"), { regra: { tipo: "datas", lista: [{ inicio: "2027-02-01", fim: "2027-02-20" }] } });
  eq("Volta às Aulas configurada pelo dono em 2027", JSON.stringify(E.ocorrencias(va, "2027-01-01", "2027-12-31").map((o) => [o.inicio, o.fim])), JSON.stringify([["2027-02-01", "2027-02-20"]]));
  eq("regra em texto JSON (jsonb vindo como string) também serve", E.ocorrencias({ regra: JSON.stringify(regra("tercou").regra) }, "2026-10-01", "2026-10-07").length, 1);
  eq("anual_fixa 29/02 só em ano bissexto", inicios(E.ocorrencias({ tipo: "anual_fixa", mes: 2, dia: 29 }, "2026-01-01", "2030-12-31")), "2028-02-29");
  eq("5º sábado que não existe não vira ocorrência", E.ocorrencias({ tipo: "mensal_nth", n: 5, dia_semana: 6 }, "2026-02-01", "2026-02-28").length, 0);
  eq("regra quebrada não derruba (lista vazia)", E.ocorrencias({ tipo: "semanal" }, "2026-01-01", "2026-12-31").length, 0);
  eq("intervalo invertido = vazio", E.ocorrencias(regra("tercou"), "2026-12-31", "2026-01-01").length, 0);

  const todas = E.ocorrenciasCampanhas(E.REGRAS_PADRAO, "2026-01-01", "2030-12-31");
  eq("pausada some: Sexta da Carne não aparece em 5 anos", todas.filter((o) => o.id === "sexta-da-carne").length, 0);
  const pausPS = E.REGRAS_PADRAO.map((r) => r.id === "promocao-semanal" ? Object.assign({}, r, { situacao: "pausada" }) : r);
  eq("pausar a PS tira a PS", E.ocorrenciasCampanhas(pausPS, "2026-11-01", "2026-11-30").filter((o) => o.id === "promocao-semanal").length, 0);
  const nov = E.ocorrenciasCampanhas(E.REGRAS_PADRAO, "2026-11-26", "2026-11-27");
  const hen = nov.find((o) => o.id === "hora-da-economia"), bfn = nov.find((o) => o.id === "black-friday");
  eq("ocorrência traz nome, tipo, categoria, cor e setor", [hen.nome, hen.tipo, hen.categoria, hen.cor, hen.setor].join("|"), "Hora da Economia|campanha||#0a6cff|Geral");
  eq("data grande marcada", [bfn.tipo, bfn.categoria].join("|"), "data|grande");
  eq("PS marcada como contínua (cobre o ano inteiro)", nov.find((o) => o.id === "promocao-semanal").continua, true);
  eq("lista em ordem de início", nov.every((o, i) => i === 0 || nov[i - 1].inicio <= o.inicio), true);
}

console.log("\n-- ANTECIPAÇÃO DO PRAZO --");
{
  eq("sábado é dia útil (fica)", E.diaUtilAnterior("2026-10-31"), "2026-10-31");
  eq("domingo → sábado", E.diaUtilAnterior("2026-09-27"), "2026-09-26");
  eq("feriado de segunda (12/10) → domingo → sábado 10/10", E.diaUtilAnterior("2026-10-12"), "2026-10-10");
  eq("Finados na segunda (02/11/2026) → sábado 31/10", E.diaUtilAnterior("2026-11-02"), "2026-10-31");
  eq("15/11/2026 é domingo → sábado 14/11", E.diaUtilAnterior("2026-11-15"), "2026-11-14");
  eq("Consciência Negra na sexta (20/11/2026) → quinta 19/11", E.diaUtilAnterior("2026-11-20"), "2026-11-19");
  eq("Tiradentes na quarta (21/04/2027) → terça 20/04", E.diaUtilAnterior("2027-04-21"), "2027-04-20");
  eq("loja fechada 01/05/2027 (sábado) → sexta 30/04", E.diaUtilAnterior("2027-05-01"), "2027-04-30");
  eq("Sexta-feira Santa 2027 → quinta 25/03", E.diaUtilAnterior("2027-03-26"), "2027-03-25");
  eq("Carnaval terça 09/02/2027 → segunda (Carnaval) → domingo → sábado 06/02", E.diaUtilAnterior("2027-02-09"), "2027-02-06");
  eq("Corpus Christi 27/05/2027 → quarta 26/05", E.diaUtilAnterior("2027-05-27"), "2027-05-26");
  eq("24/12 → 23/12 (loja cheia) → 22/12", E.diaUtilAnterior("2026-12-24"), "2026-12-22");
  eq("25/12 (fechada) → 24 → 23 → 22/12", E.diaUtilAnterior("2026-12-25"), "2026-12-22");
  eq("31/12 → 30/12 → 29/12", E.diaUtilAnterior("2026-12-31"), "2026-12-29");
  eq("01/01/2027 (fechada) → 31 → 30 → 29/12/2026", E.diaUtilAnterior("2027-01-01"), "2026-12-29");
  eq("dia útil comum não mexe", E.diaUtilAnterior("2026-11-06"), "2026-11-06");
  eq("FLV: fica na manhã do feriado (12/10)", E.diaUtilAnterior("2026-10-12", { flv: true }), "2026-10-12");
  eq("FLV: pode cair em 24/12", E.diaUtilAnterior("2026-12-24", { flv: true }), "2026-12-24");
  eq("FLV: pode cair em 31/12", E.diaUtilAnterior("2026-12-31", { flv: true }), "2026-12-31");
  eq("FLV: 01/01 (fechada) → 31/12", E.diaUtilAnterior("2027-01-01", { flv: true }), "2026-12-31");
  eq("FLV: 25/12 (fechada) → 24/12", E.diaUtilAnterior("2026-12-25", { flv: true }), "2026-12-24");
  eq("FLV: domingo → sábado", E.diaUtilAnterior("2026-09-27", { flv: true }), "2026-09-26");
  eq("FLV: Sexta-feira Santa (fechada) → quinta", E.diaUtilAnterior("2027-03-26", { flv: true }), "2027-03-25");
}

console.log("\n-- PRAZOS APROVADOS (D3) --");
{
  const PS = modelo("promocao-semanal").prazos;
  eq("PS 23/11/2026: começar 26/10, definir 06/11, aprovar 09/11", E.calcularPrazos("2026-11-23", PS),
    { comecar: "2026-10-26", definir: "2026-11-06", aprovar: "2026-11-09" });
  eq("PS 16/11/2026: aprovar cai em Finados e antecipa para sábado 31/10", E.calcularPrazos("2026-11-16", PS),
    { comecar: "2026-10-19", definir: "2026-10-30", aprovar: "2026-10-31" });
  eq("PS 22/02/2027: aprovar cai no Carnaval → sábado 06/02", E.calcularPrazos("2027-02-22", PS).aprovar, "2027-02-06");
  eq("SB 10/10/2026 (42/28/21)", E.calcularPrazos("2026-10-10", modelo("sabado-bombastico").prazos),
    { comecar: "2026-08-29", definir: "2026-09-12", aprovar: "2026-09-19" });
  eq("HE 29/10/2026 (35/21/14)", E.calcularPrazos("2026-10-29", modelo("hora-da-economia").prazos),
    { comecar: "2026-09-24", definir: "2026-10-08", aprovar: "2026-10-15" });
  eq("prazo em branco não vira 'zero dias antes'", E.calcularPrazos("2026-11-23", { comecar: 28, definir: "", aprovar: null }),
    { comecar: "2026-10-26", definir: null, aprovar: null });
  eq("sem início, sem prazo", E.calcularPrazos(null, PS), { comecar: null, definir: null, aprovar: null });

  const ter = E.prazosEdicao(modelo("tercou"), "2026-10-13", "2026-10-14");
  eq("Terçou 13/10/2026: hortifrúti 4/1/1 com FLV define na manhã do feriado (seg 12/10)", ter.grupos.hortifruti,
    { inicio: "2026-10-13", fim: "2026-10-14", comecar: "2026-10-09", definir: "2026-10-12", aprovar: "2026-10-12" });
  eq("  sem a exceção FLV o definir iria para sábado 10/10", E.calcularPrazos("2026-10-13", { comecar: 4, definir: 1, aprovar: 1 }).definir, "2026-10-10");
  eq("Terçou 13/10/2026: a edição (14/8/7)", [ter.comecar, ter.definir, ter.aprovar].join(","), "2026-09-29,2026-10-05,2026-10-06");
  eq("  só o hortifrúti tem prazo próprio", Object.keys(ter.grupos).join(","), "hortifruti");
  const terNat = E.prazosEdicao(modelo("tercou"), "2026-12-22", "2026-12-23");
  eq("Terçou 22/12: hortifrúti FLV aprova em 21/12; a edição define em 14/12", [terNat.grupos.hortifruti.aprovar, terNat.definir].join(","), "2026-12-21,2026-12-14");

  // Começar da edição = o MAIS CEDO entre a edição e os grupos com prazo próprio (ex.: Natal).
  const psNatal = JSON.parse(JSON.stringify(modelo("promocao-semanal")));
  psNatal.estrutura.grupos.push({ chave: "natal", nome: "Natal", ativo_padrao: true, periodo: { ini_offset: 0, fim_offset: 7 },
    prazos: { comecar: 60, definir: 30, aprovar: 21 }, vagas: [] });
  const pn = E.prazosEdicao(psNatal, "2026-12-14", "2026-12-21");
  eq("grupo Natal com prazo próprio 60 dias puxa o começar da edição", pn.comecar, pn.grupos.natal.comecar);
  eq("  e o começar do Natal é 15/10 (60 dias antes de 14/12)", pn.grupos.natal.comecar, "2026-10-15");
  eq("  definir/aprovar da edição continuam os dela", [pn.definir, pn.aprovar].join(","), "2026-11-27,2026-11-30");
  const inativo = JSON.parse(JSON.stringify(psNatal)); inativo.estrutura.grupos[8].ativo_padrao = false;
  eq("grupo que não nasce (ativo_padrao false) não mexe no começar", E.prazosEdicao(inativo, "2026-12-14", "2026-12-21").comecar, "2026-11-16");

  const fds = modelo("promocao-semanal").estrutura.grupos.find((g) => g.chave === "fim-de-semana");
  eq("Fim de semana: período próprio sexta → domingo", E.periodoGrupo(fds, "2026-11-23", "2026-11-30"), { inicio: "2026-11-27", fim: "2026-11-29" });
  eq("grupo sem período usa o da edição", E.periodoGrupo({ chave: "capa" }, "2026-11-23", "2026-11-30"), { inicio: "2026-11-23", fim: "2026-11-30" });
  eq("grupo gravado na edição (datas próprias) vale o gravado", E.periodoGrupo({ inicio: "2026-12-01", fim: "2026-12-24", periodo: { ini_offset: 4, fim_offset: 6 } }, "2026-11-23", "2026-11-30"),
    { inicio: "2026-12-01", fim: "2026-12-24" });
  eq("Fim de semana segue a régua da PS (sem prazo próprio)", Object.keys(E.prazosEdicao(modelo("promocao-semanal"), "2026-11-23", "2026-11-30").grupos).length, 0);
}

console.log("\n-- MUDANÇA DE ANO --");
{
  const PS = modelo("promocao-semanal");
  const jan = E.ocorrencias(regra("promocao-semanal"), "2027-01-01", "2027-01-03");
  eq("a PS de 28/12/2026 aparece quando se olha janeiro/2027", JSON.stringify(jan.map((o) => [o.inicio_regra, o.fim])), JSON.stringify([["2026-12-28", "2027-01-03"]]));
  eq("PS 28/12/2026 → 04/01/2027: prazos", E.prazosEdicao(PS, "2026-12-28", "2027-01-04"),
    { comecar: "2026-11-30", definir: "2026-12-11", aprovar: "2026-12-14", grupos: {} });
  eq("PS 11/01/2027: definir cai no Natal (fechada) → 24 → 23 → 22/12", E.calcularPrazos("2027-01-11", PS.prazos),
    { comecar: "2026-12-14", definir: "2026-12-22", aprovar: "2026-12-28" });
  eq("PS 18/01/2027: definir cai em 01/01 → 29/12/2026", E.calcularPrazos("2027-01-18", PS.prazos),
    { comecar: "2026-12-21", definir: "2026-12-29", aprovar: "2027-01-04" });
  const qq = { id: "teste", nome: "Quinta a quinta", tipo: "campanha", situacao: "ativa", regra: { tipo: "semanal", dia_semana: 4, duracao_dias: 8 } };
  const o26 = E.ocorrencias(qq, "2026-12-25", "2026-12-31"), o27 = E.ocorrencias(qq, "2027-01-05", "2027-01-06");
  eq("edição 31/12 → 07/01 aparece olhando dezembro", o26.map((o) => o.inicio + ">" + o.fim).join(","), "2026-12-24>2026-12-31,2026-12-31>2027-01-07");
  eq("…e olhando janeiro (a mesma, com o inicio_regra de 2026)", o27.map((o) => o.inicio_regra).join(","), "2026-12-31");
  const mq = { id: "teste", campanha_id: "teste", tipo: "edicao", ativo: true, versao: 1, prazos: { comecar: 28, definir: 17, aprovar: 14 }, estrutura: { grupos: [] } };
  const cria = E.edicoesParaCriar([qq], [mq], "2027-01-02", []);
  eq("em 02/01/2027 a edição 31/12 → 07/01 deve existir (e é a primeira; as de janeiro já começaram também)", cria.map((e) => e.inicio_regra).join(","),
    "2026-12-31,2027-01-07,2027-01-14,2027-01-21,2027-01-28");
  eq("  a de 24/12 → 31/12 já acabou e não é criada", cria.some((e) => e.inicio_regra === "2026-12-24"), false);
  eq("título no formato do banco ('<nome> · DD/MM/AAAA' do início)", cria[0].titulo, "Quinta a quinta · 31/12/2026");
  eq("prazos dela: aprovar 17/12, definir 14/12, começar 03/12", [cria[0].prazos.comecar, cria[0].prazos.definir, cria[0].prazos.aprovar].join(","), "2026-12-03,2026-12-14,2026-12-17");
  const c2 = E.edicoesParaCriar(E.REGRAS_PADRAO, E.MODELOS_PADRAO, "2027-01-02", []);
  eq("em 02/01/2027 a PS de 28/12/2026 ainda é criada (está no ar)", c2.some((e) => e.campanha_id === "promocao-semanal" && e.inicio_regra === "2026-12-28"), true);
  eq("título da PS 28/12 (igual ao que o banco grava)", c2.find((e) => e.inicio_regra === "2026-12-28").titulo, "Promoção Semanal · 28/12/2026");
  const todasProj = c2.concat(E.edicoesFuturas(E.REGRAS_PADRAO, E.MODELOS_PADRAO, "2027-01-02", 120));
  eq("  toda edição (a criar e virtual) tem o título do banco: nome · data do início", todasProj.length > 10 &&
    todasProj.every((e) => e.titulo === E.REGRAS_PADRAO.find((r) => r.id === e.campanha_id).nome + " · " + E.fmtData(e.inicio)), true);
}

console.log("\n-- EDIÇÕES A CRIAR E FUTURAS (hoje = 26/09/2026) --");
{
  const H = "2026-09-26";
  const cria = E.edicoesParaCriar(E.REGRAS_PADRAO, E.MODELOS_PADRAO, H, []);
  const chaves = cria.map((e) => e.campanha_id + "@" + e.inicio).sort().join(",");
  eq("12 edições já deviam existir (5 PS, 2 Terçou, 1 SB, 1 HE, 3 Quarta Saudável)", chaves,
    ["hora-da-economia@2026-10-29", "promocao-semanal@2026-09-21", "promocao-semanal@2026-09-28", "promocao-semanal@2026-10-05",
      "promocao-semanal@2026-10-12", "promocao-semanal@2026-10-19",
      "quarta-saudavel@2026-09-30", "quarta-saudavel@2026-10-07", "quarta-saudavel@2026-10-14", "sabado-bombastico@2026-10-10", "tercou@2026-09-29", "tercou@2026-10-06"].join(","));
  eq("toda edição a criar tem começar ≤ hoje e fim ≥ hoje", cria.every((e) => e.prazos.comecar <= H && e.fim >= H), true);
  const t29 = cria.find((e) => e.campanha_id === "tercou" && e.inicio === "2026-09-29");
  eq("o que vai para encarte_criar_edicao", Object.keys(t29).slice(0, 9).join(","), "campanha_id,modelo_id,modelo_versao,titulo,inicio_regra,inicio,fim,prazos,nome");
  eq("  prazos com os grupos de prazo próprio", Object.keys(t29.prazos.grupos).join(","), "hortifruti");
  eq("  título", t29.titulo, "Terçou das Frutas e Verduras · 29/09/2026");
  const existentes = cria.filter((e) => e.campanha_id === "promocao-semanal").map((e) => ({ campanha_id: e.campanha_id, inicio_regra: e.inicio_regra }));
  eq("as que já existem não voltam (idempotente)", E.edicoesParaCriar(E.REGRAS_PADRAO, E.MODELOS_PADRAO, H, existentes).length, 7);
  eq("com diasPassados 7 (seção 11) entram as que acabaram há até 7 dias", E.edicoesParaCriar(E.REGRAS_PADRAO, E.MODELOS_PADRAO, H, [], { diasPassados: 7 }).length, 16);
  const semModelo = E.MODELOS_PADRAO.map((m) => m.id === "sabado-bombastico" ? Object.assign({}, m, { ativo: false }) : m);
  eq("modelo inativo não cria edição", E.edicoesParaCriar(E.REGRAS_PADRAO, semModelo, H, []).some((e) => e.campanha_id === "sabado-bombastico"), false);
  const pausada = E.REGRAS_PADRAO.map((r) => r.id === "tercou" ? Object.assign({}, r, { situacao: "pausada" }) : r);
  eq("campanha pausada não cria edição", E.edicoesParaCriar(pausada, E.MODELOS_PADRAO, H, []).some((e) => e.campanha_id === "tercou"), false);
  eq("data (tipo 'data') nunca cria edição sozinha", E.edicoesParaCriar(E.REGRAS_PADRAO, E.MODELOS_PADRAO, "2026-11-20", []).some((e) => e.campanha_id === "black-friday"), false);
  const sc = E.REGRAS_PADRAO.map((r) => r.id === "sexta-da-carne" ? Object.assign({}, r, { situacao: "ativa" }) : r);
  eq("Sexta da Carne reativada (com modelo desde 08/10/2026) gera edição", E.edicoesParaCriar(sc, E.MODELOS_PADRAO, H, []).some((e) => e.campanha_id === "sexta-da-carne"), true);
  eq("... e pausada, mesmo com modelo, não gera", E.edicoesParaCriar(E.REGRAS_PADRAO, E.MODELOS_PADRAO, H, []).some((e) => e.campanha_id === "sexta-da-carne"), false);

  const fut = E.edicoesFuturas(E.REGRAS_PADRAO, E.MODELOS_PADRAO, H, 70);
  eq("futuras: todas com começar depois de hoje e até 70 dias", fut.every((e) => e.prazos.comecar > H && e.prazos.comecar <= "2026-12-05"), true);
  eq("futuras: marcadas como virtuais", fut.every((e) => e.virtual === true), true);
  eq("futuras: a próxima PS é a de 26/10 (começa 28/09)", fut.find((e) => e.campanha_id === "promocao-semanal").inicio, "2026-10-26");
  eq("futuras: a Black Friday não é edição", fut.some((e) => e.campanha_id === "black-friday"), false);
  eq("futuras e a criar não se repetem", fut.filter((f) => cria.some((c) => c.campanha_id === f.campanha_id && c.inicio_regra === f.inicio_regra)).length, 0);
  eq("futuras em ordem de começar", fut.every((e, i) => i === 0 || fut[i - 1].prazos.comecar <= e.prazos.comecar), true);
}

console.log("\n-- CONTAGEM DE VAGAS --");
{
  const vagas = [
    { id: "a", situacao: "ativa", estado: "aprovada", proposta_escolhida: "p1" },
    { id: "b", situacao: "ativa", estado: "pendente", proposta_escolhida: "p2" },
    { id: "c", situacao: "ativa", estado: "pendente", proposta_escolhida: null },
    { id: "d", estado: "pendente", proposta_escolhida: null },
    { id: "e", situacao: "ativa", estado: "em_ajuste", proposta_escolhida: "p5" },
    { id: "f", situacao: "ativa", estado: "aguardando_visto", proposta_escolhida: "p6" },
    { id: "g", situacao: "retirada", estado: "pendente", proposta_escolhida: null }
  ];
  const props = [{ vaga_id: "c", situacao: "ativa" }, { vaga_id: "d", situacao: "descartada" }, { vaga_id: "a", situacao: "ativa" }];
  eq("contagem (retirada fora; proposta descartada não conta)", E.contarVagas(vagas, props),
    { total: 6, definidas: 4, negociando: 1, aNegociar: 1, aprovadas: 1, emAjuste: 1, aguardandoVisto: 1, pendentes: 3 });
  eq("sem nada", E.contarVagas([], []).total, 0);
}

console.log("\n-- SITUAÇÃO DA FILA --");
{
  const ed = { prazos: { comecar: "2026-10-26", definir: "2026-11-06", aprovar: "2026-11-09" }, inicio: "2026-11-23", fim: "2026-11-30" };
  const cont = (def, neg, apr, total) => ({ total: total === undefined ? 10 : total, definidas: def, negociando: neg, aNegociar: (total === undefined ? 10 : total) - def - neg, aprovadas: apr, emAjuste: 0, aguardandoVisto: 0 });
  let s = E.situacao(ed, cont(0, 0, 0), "2026-10-20");
  eq("futuro: antes do começar", [s.k, s.rotulo, s.texto].join(" | "), "futuro | Começa em 6 dias | Planejamento começa em 26/10");
  eq("futuro: 1 dia no singular", E.situacao(ed, cont(0, 0, 0), "2026-10-25").rotulo, "Começa em 1 dia");
  s = E.situacao(ed, cont(1, 2, 0), "2026-10-28");
  eq("no prazo", [s.k, s.rotulo, s.texto].join(" | "), "no_prazo | No prazo | Definir as vagas até 06/11");
  s = E.situacao(ed, cont(5, 2, 0), "2026-11-03");
  eq("atenção: faltam 3 dias para definir", [s.k, s.texto].join(" | "), "atencao | Definir as vagas até 06/11 (3 dias) · faltam 5");
  s = E.situacao(ed, cont(5, 2, 0), "2026-11-06");
  eq("atenção: definir HOJE", s.texto, "Definir as vagas HOJE · faltam 5");
  s = E.situacao(ed, cont(0, 0, 0), "2026-11-02");
  eq("atenção: começou há 7 dias e ninguém negociou", [s.k, s.texto].join(" | "), "atencao | Ninguém começou a negociar ainda");
  eq("  com 6 dias ainda está no prazo", E.situacao(ed, cont(0, 0, 0), "2026-11-01").k, "no_prazo");
  s = E.situacao(ed, cont(8, 2, 0), "2026-11-07");
  eq("atrasado: passou o definir com vaga sem escolha", [s.k, s.rotulo, s.texto].join(" | "), "atrasado | Atrasado | Prazo para definir as vagas passou em 06/11 · faltam 2");
  s = E.situacao(ed, cont(10, 0, 0), "2026-11-10");
  eq("atrasado: passou o aprovar sem aprovação", [s.k, s.texto].join(" | "), "atrasado | Aprovação atrasada desde 09/11");
  s = E.situacao(ed, cont(10, 0, 7), "2026-11-10");
  eq("atrasado: aprovação parcial diz quantas faltam", s.texto, "Aprovação atrasada desde 09/11 · faltam 3 vagas");
  s = E.situacao(ed, cont(10, 0, 0), "2026-11-08");
  eq("tudo definido, antes do aprovar: no prazo", [s.k, s.texto].join(" | "), "no_prazo | Aprovar até 09/11");
  s = E.situacao(ed, cont(10, 0, 10), "2026-11-25");
  eq("aprovado (vence qualquer atraso)", [s.k, s.rotulo, s.noArSemAprovacao].join(" | "), "aprovado | Aprovado | false");
  s = E.situacao(ed, cont(10, 0, 8), "2026-11-23");
  eq("entrou no ar sem aprovação (hoje = início)", s.noArSemAprovacao, true);
  eq("  e 1 dia antes ainda não", E.situacao(ed, cont(10, 0, 8), "2026-11-22").noArSemAprovacao, false);
  eq("dias para o ar", E.situacao(ed, cont(1, 0, 0), "2026-11-20").diasParaOAr, 3);
  eq("dias para o ar negativo depois de entrar", E.situacao(ed, cont(1, 0, 0), "2026-11-25").diasParaOAr, -2);
  const sp = Object.assign({ sem_penalidade: true }, ed);
  s = E.situacao(sp, cont(8, 2, 0), "2026-11-23");
  eq("sem penalidade: o vermelho vira 'Anterior ao processo' (âmbar)", [s.k, s.rotulo].join(" | "), "atencao | Anterior ao processo");
  eq("sem penalidade: não acusa 'no ar sem aprovação'", s.noArSemAprovacao, false);
  eq("edição sem vagas não é 'aprovada' nem 'atrasada'", E.situacao(ed, cont(0, 0, 0, 0), "2026-11-10").k, "no_prazo");
  // PS 05/10/2026 na terça 06/10: 41 aprovadas e 1 pendente do Fim de semana (que só entra no ar na sexta 09/10)
  const ps05 = { prazos: { comecar: "2026-09-07", definir: "2026-09-18", aprovar: "2026-09-21" }, inicio: "2026-10-05", fim: "2026-10-12" };
  const c42 = { total: 42, definidas: 42, negociando: 0, aprovadas: 41 };
  eq("sem pendentesNoAr: continua usando o total de pendentes (compatível)", E.situacao(ps05, c42, "2026-10-06").noArSemAprovacao, true);
  eq("pendentesNoAr = 0 (a pendente é do Fim de semana, ainda antes do ar): NÃO acusa", E.situacao(ps05, Object.assign({ pendentesNoAr: 0 }, c42), "2026-10-06").noArSemAprovacao, false);
  eq("pendentesNoAr = 1 (na sexta, o Fim de semana entrou no ar): acusa", E.situacao(ps05, Object.assign({ pendentesNoAr: 1 }, c42), "2026-10-09").noArSemAprovacao, true);
  eq("pendentesNoAr com sem_penalidade: não acusa", E.situacao(Object.assign({ sem_penalidade: true }, ps05), Object.assign({ pendentesNoAr: 3 }, c42), "2026-10-09").noArSemAprovacao, false);
  eq("pendentesNoAr em branco não vira zero (usa o total)", E.situacao(ps05, Object.assign({ pendentesNoAr: "" }, c42), "2026-10-06").noArSemAprovacao, true);
}

console.log("\n-- MARGEM E CUSTO (D8) --");
{
  eq("margem 10 × 7,50 = 25%", E.margem(10, 7.5), 25);
  eq("margem sem preço = indisponível", E.margem(null, 7.5), null);
  eq("margem com preço em branco = indisponível", E.margem("", 7.5), null);
  eq("margem sem custo = indisponível (não é 100%)", E.margem(10, null), null);
  eq("margem com custo em branco = indisponível", E.margem(10, ""), null);
  eq("margem com custo ZERO = indisponível (não é 100%)", E.margem(10, 0), null);
  eq("margem com custo NEGATIVO = indisponível (não é 150%)", E.margem(10, -5), null);
  eq("margem com preço zero ou negativo = indisponível", [E.margem(0, 5), E.margem(-1, 5)].join("|"), "|");

  let a = E.analiseProposta({ custo_hoje: null, custo_confiavel: true, preco_oferta: 10 });
  eq("sem custo no VR e sem negociado: nada considerado, margem indisponível", [a.semCusto, a.custoConsiderado, a.margem].join("|"), "true||");
  eq("  alerta com o texto exato", a.alertas.map((x) => x.texto).join("|"), "Sem custo no VR");
  eq("custo 0 do VR também é 'sem custo' (nunca R$ 0,00)", E.analiseProposta({ custo_hoje: 0, preco_oferta: 10 }).semCusto, true);
  eq("custo '' do VR também é 'sem custo'", E.analiseProposta({ custo_hoje: "", preco_oferta: 10 }).semCusto, true);

  a = E.analiseProposta({ custo_hoje: 20, custo_confiavel: false, preco_oferta: 30 });
  eq("custo não confiável (desossa): não é usado em silêncio", [a.custoConfiavel, a.custoConsiderado, a.margem].join("|"), "false||");
  eq("  alerta com o texto exato", a.alertas.map((x) => x.texto).join("|"), "Custo não confiável");
  a = E.analiseProposta({ custo_hoje: 20, custo_confiavel: false, custo_negociado: 22, preco_oferta: 30 });
  eq("não confiável + negociado: usa o negociado, alerta continua", [a.custoConsiderado, a.origemCusto, a.margem, a.alertas.length].join("|"), "22|negociado|26.67|1");
  eq("  variação hoje × negociado INDISPONÍVEL (não vira ganho nem perda)", [a.variacaoRS, a.variacaoPct, a.variacaoIndisponivel].join("|"),
    "||indisponível — custo do VR não confiável");
  a = E.analiseProposta({ custo_hoje: 20, custo_confiavel: false, custo_negociado: 25, preco_oferta: 22.9 });
  eq("não confiável + margem negativa sobre o negociado: margem calculada, SEM o alerta 'Margem negativa'",
    [a.margem, a.alertas.map((x) => x.tipo).join(",")].join("|"), "-9.17|custo_nao_confiavel");
  const bisteca = E.analiseProposta({ custo_hoje: 20, custo_confiavel: false, custo_negociado: 12.5, preco_oferta: 22.9 });
  eq("  a Bisteca do pc-7 (VR 20 × negociado 12,50): nada de −R$ 7,50 como ganho", [bisteca.variacaoRS, bisteca.variacaoPct, !!bisteca.variacaoIndisponivel].join("|"), "||true");
  a = E.analiseProposta({ custo_hoje: 20, custo_confiavel: null, custo_negociado: 25, preco_oferta: 22.9 });
  eq("confiança NULA com negociado: variação normal e o alerta 'Margem negativa' continua", [a.variacaoRS, a.variacaoIndisponivel, a.alertas.map((x) => x.tipo).join(",")].join("|"),
    "5||margem_negativa");
  eq("confiável: variação normal, sem o texto de indisponível", E.analiseProposta({ custo_hoje: 20, custo_confiavel: true, custo_negociado: 18, preco_oferta: 25 }).variacaoIndisponivel, null);

  a = E.analiseProposta({ custo_hoje: 10.5, custo_confiavel: true, custo_negociado: 9.8, preco_normal: 15.49, preco_oferta: 12.99 });
  eq("negociado: 10,50 → 9,80 = −R$ 0,70 / −6,67%", [a.variacaoRS, a.variacaoPct].join("|"), "-0.7|-6.67");
  eq("  o custo do VR não é sobrescrito", [a.custoHoje, a.custoNegociado, a.custoConsiderado].join("|"), "10.5|9.8|9.8");
  eq("  margem = (12,99 − 9,80) ÷ 12,99", a.margem, 24.56);
  eq("  desconto para o cliente", [a.descontoCliente, a.descontoClienteRS].join("|"), "16.14|2.5");
  eq("  sem verba: margem com verba não se aplica", [a.temVerba, a.margemComVerbaCalculavel, a.margemComVerba].join("|"), "false|false|");
  eq("  nenhum alerta", a.alertas.length, 0);
  a = E.analiseProposta({ custo_hoje: 10.5, custo_confiavel: true, preco_oferta: 12.99 });
  eq("sem negociado: usa o do VR (confiável)", [a.custoConsiderado, a.origemCusto, a.variacaoRS].join("|"), "10.5|vr|");
  a = E.analiseProposta({ custo_hoje: 8, custo_confiavel: null, preco_oferta: 10 });
  eq("sem negociado e confiança DESCONHECIDA (nula): o do VR não é usado (igual ao banco)", [a.custoConsiderado, a.origemCusto, a.margem].join("|"), "||");
  eq("  mas não ganha o rótulo 'Custo não confiável' (só com false)", [a.custoConfiavel, a.alertas.map((x) => x.tipo).join(",")].join("|"), "true|");
  eq("  confiança ausente (campo faltando) também não é usada", E.analiseProposta({ custo_hoje: 8, preco_oferta: 10 }).custoConsiderado, null);

  a = E.analiseProposta({ custo_hoje: 10.5, custo_negociado: 9.8, preco_oferta: 12.99, verba_valor: 100, verba_qtd_base: 100 });
  eq("verba R$ 100 a cada 100 un = R$ 1,00/un", a.verbaPorUnidade, 1);
  eq("  margem com verba = (12,99 − 8,80) ÷ 12,99", [a.margemComVerbaCalculavel, a.custoComVerba, a.margemComVerba].join("|"), "true|8.8|32.26");
  a = E.analiseProposta({ custo_negociado: 9.8, preco_oferta: 12.99, verba_valor: 100 });
  eq("verba sem a quantidade-base: não calculável", [a.temVerba, a.margemComVerbaCalculavel, a.margemComVerba].join("|"), "true|false|");
  a = E.analiseProposta({ custo_negociado: 11, preco_oferta: 12, bonif_compra: 10, bonif_ganha: 1 });
  eq("bonificação 'a cada 10 leva 1': custo × 10/11 = 10,00", [a.custoComVerba, a.margemComVerba].join("|"), "10|16.67");
  a = E.analiseProposta({ custo_negociado: 11, preco_oferta: 12, bonif_compra: 10, bonif_ganha: 1, verba_valor: 50, verba_qtd_base: 100 });
  eq("bonificação + verba juntas: 10,00 − 0,50", [a.custoComVerba, a.margemComVerba].join("|"), "9.5|20.83");
  a = E.analiseProposta({ custo_negociado: 11, preco_oferta: 12, bonificacao_texto: "leva 1 a cada 10" });
  eq("bonificação só em texto: não calculável", [a.temVerba, a.margemComVerbaCalculavel].join("|"), "true|false");
  a = E.analiseProposta({ custo_negociado: 11, preco_oferta: 12, bonif_compra: 10 });
  eq("bonificação sem o 'leva M': não calculável", a.margemComVerbaCalculavel, false);
  a = E.analiseProposta({ custo_hoje: null, preco_oferta: 12, verba_valor: 100, verba_qtd_base: 100 });
  eq("verba sem custo nenhum: não calculável", a.margemComVerbaCalculavel, false);
  a = E.analiseProposta({ custo_negociado: 5, preco_oferta: 10, verba_valor: 800, verba_qtd_base: 100 });
  eq("verba MAIOR que o custo (5 − 8 = −3): margem com verba indisponível, não 130%", [a.custoComVerba, a.margemComVerba].join("|"), "-3|");
  eq("  com o alerta e o rótulo combinados", a.alertas.filter((x) => x.tipo === "verba_maior_que_custo").map((x) => x.texto).join("|"),
    "Verba maior que o custo — confira os números");
  a = E.analiseProposta({ custo_negociado: 5, preco_oferta: 10, verba_valor: 500, verba_qtd_base: 100 });
  eq("verba IGUAL ao custo (custo efetivo 0): também indisponível, com o alerta", [a.margemComVerba, a.alertas.some((x) => x.tipo === "verba_maior_que_custo")].join("|"), "|true");
  a = E.analiseProposta({ custo_negociado: 5, preco_oferta: 10, verba_valor: 100, verba_qtd_base: 100 });
  eq("verba menor que o custo: margem com verba normal, sem esse alerta", [a.margemComVerba, a.alertas.some((x) => x.tipo === "verba_maior_que_custo")].join("|"), "60|false");

  a = E.analiseProposta({ custo_hoje: 9, custo_negociado: 10, preco_oferta: 9, preco_normal: 9 }, { inicio: "2026-11-23" });
  eq("margem negativa + oferta ≥ preço normal", a.alertas.map((x) => x.tipo).join(","), "margem_negativa,oferta_acima_normal");
  a = E.analiseProposta({ custo_hoje: 9, custo_negociado: 8, preco_oferta: 10, validade: "2026-11-20" }, { inicio: "2026-11-23" });
  eq("proposta vence antes do início", a.alertas.map((x) => x.texto).join("|"), "Proposta vence antes do início (20/11/2026)");
  eq("  validade no próprio início não acusa", E.analiseProposta({ custo_hoje: 9, preco_oferta: 10, validade: "2026-11-23" }, { inicio: "2026-11-23" }).alertas.length, 0);
}

console.log("\n-- MUDANÇA DEPOIS DE APROVADO (D4) --");
{
  const base = { id: "p1", produtos: [101], fornecedor_id: 5, fornecedor_nome: "ACME", preco_oferta: 12.99, custo_negociado: 9.8,
    verba_valor: 100, verba_qtd_base: 100, validade: "2026-11-30", observacao: "", quantidade_minima: "10 cx", custo_hoje: 10.5, preco_normal: 15.49 };
  const mud = (d, o) => E.mudancaMaterial(base, Object.assign({}, base, d), o || { noAr: false });
  const r = (m) => [m.reabre, m.critica, m.soRegistra].join("|");
  eq("nada mudou: nada acontece", r(mud({})) + "|" + mud({}).campos.length, "false|false|false|0");
  eq("troca por proposta com OUTROS produtos: reabre", r(mud({ id: "p2", produtos: [202] })), "true|false|false");
  eq("troca de proposta, mesmos produtos+preço+condição, outro fornecedor: só registra", r(mud({ id: "p2", fornecedor_id: 9, fornecedor_nome: "OUTRO" })), "false|false|true");
  eq("  e registra o quê", mud({ id: "p2", fornecedor_id: 9 }).campos.join(","), "proposta,fornecedor");
  eq("muda produtos da escolhida: reabre", r(mud({ produtos: [101, 102] })), "true|false|false");
  eq("mesmos produtos em outra ordem não é mudança", mud({ produtos: [101] }).campos.length, 0);
  eq("muda preço de oferta (desceu): reabre antes do ar", r(mud({ preco_oferta: 11.99 })), "true|false|false");
  eq("custo negociado SOBE: reabre", r(mud({ custo_negociado: 10.2 })), "true|false|false");
  eq("custo negociado DESCE: só registra", r(mud({ custo_negociado: 9.5 })), "false|false|true");
  eq("verba REDUZ: reabre", r(mud({ verba_valor: 50 })), "true|false|false");
  eq("verba RETIRADA: reabre", r(mud({ verba_valor: null, verba_qtd_base: null })), "true|false|false");
  eq("verba AUMENTA: só registra", r(mud({ verba_valor: 150 })), "false|false|true");
  eq("bonificação reduz (10+2 → 10+1): reabre", E.mudancaMaterial(Object.assign({}, base, { bonif_compra: 10, bonif_ganha: 2 }),
    Object.assign({}, base, { bonif_compra: 10, bonif_ganha: 1 }), { noAr: false }).reabre, true);
  eq("quantidade mínima: só registra", r(mud({ quantidade_minima: "20 cx" })), "false|false|true");
  eq("validade: só registra", r(mud({ validade: "2026-12-15" })), "false|false|true");
  eq("observação: só registra", r(mud({ observacao: "entrega na quinta" })), "false|false|true");
  eq("atualização do robô (custo do VR): só registra", r(mud({ custo_hoje: 11.2 })) + "|" + mud({ custo_hoje: 11.2 }).campos.join(","), "false|false|true|dados_vr");
  eq("vaga nova: nasce pendente", [E.mudancaMaterial(null, { id: "p9" }).vagaNova, E.mudancaMaterial(null, { id: "p9" }).reabre].join("|"), "true|false");
  eq("vaga retirada antes do ar: só registra", r(E.mudancaMaterial(base, { situacao: "retirada" }, { noAr: false })), "false|false|true");
  eq("escolhida descartada antes do ar: reabre", r(mud({ situacao: "descartada" })), "true|false|false");
  const ar = { noAr: true };
  eq("NO AR: preço anunciado sobe = crítica, nunca reabre", r(mud({ preco_oferta: 13.49 }, ar)), "false|true|false");
  eq("NO AR: preço desce = só registra", r(mud({ preco_oferta: 11.99 }, ar)), "false|false|true");
  eq("NO AR: produto trocado = crítica", r(mud({ produtos: [303] }, ar)), "false|true|false");
  eq("NO AR: vaga retirada = crítica", r(E.mudancaMaterial(base, null, ar)), "false|true|false");
  eq("NO AR: custo sobe = só registra (nunca reabre no ar)", r(mud({ custo_negociado: 10.9 }, ar)), "false|false|true");
  eq("NO AR: verba reduz = só registra", r(mud({ verba_valor: 10 }, ar)), "false|false|true");
  eq("no ar calculado por hoje ≥ início", mud({ preco_oferta: 13.49 }, { hoje: "2026-11-23", inicio: "2026-11-23" }).critica, true);
  eq("véspera do início ainda é 'antes do ar'", mud({ preco_oferta: 13.49 }, { hoje: "2026-11-22", inicio: "2026-11-23" }).reabre, true);
  eq("motivo legível para a tela", mud({ custo_negociado: 10.2 }).motivos.join("|"), "Custo negociado subiu");
  // o banco compara SEM arredondar e produtos como CONJUNTO
  eq("preço 12,99 → 12,991 (3 casas): reabre, como no banco", r(mud({ preco_oferta: 12.991 })), "true|false|false");
  eq("custo 2,248 → 2,2489 (sobe menos de meio centavo): reabre, como no banco",
    r(E.mudancaMaterial(Object.assign({}, base, { custo_negociado: 2.248 }), Object.assign({}, base, { custo_negociado: 2.2489 }), { noAr: false })), "true|false|false");
  eq("produto repetido na lista ([101] → [101,101]) não é troca", mud({ produtos: [101, 101] }).campos.length, 0);
  eq("custo negociado APAGADO: só registra (o banco não compara com vazio)", r(mud({ custo_negociado: null })), "false|false|true");
  eq("verba 100/10 un → 80/4 un (total caiu, por unidade subiu): reabre (verba TOTAL)",
    r(E.mudancaMaterial(Object.assign({}, base, { verba_valor: 100, verba_qtd_base: 10 }), Object.assign({}, base, { verba_valor: 80, verba_qtd_base: 4 }), { noAr: false })), "true|false|false");
  eq("completar a quantidade-base da verba (100 → 100 a cada 100 un): só registra",
    r(E.mudancaMaterial(Object.assign({}, base, { verba_qtd_base: null }), base, { noAr: false })), "false|false|true");
  eq("verba 100/50 → 200/200 (total subiu): só registra", r(E.mudancaMaterial(Object.assign({}, base, { verba_qtd_base: 50 }),
    Object.assign({}, base, { verba_valor: 200, verba_qtd_base: 200 }), { noAr: false })), "false|false|true");
  eq("bonificação 10+1 → 12+1 (fração ganha menor): reabre", E.mudancaMaterial(Object.assign({}, base, { bonif_compra: 10, bonif_ganha: 1 }),
    Object.assign({}, base, { bonif_compra: 12, bonif_ganha: 1 }), { noAr: false }).reabre, true);
  eq("bonificação 10+1 → 20+2 (mesma fração): só registra", r(E.mudancaMaterial(Object.assign({}, base, { bonif_compra: 10, bonif_ganha: 1 }),
    Object.assign({}, base, { bonif_compra: 20, bonif_ganha: 2 }), { noAr: false })), "false|false|true");
  eq("NO AR: preço anunciado APAGADO = crítica (o banco também grava)", r(mud({ preco_oferta: null }, ar)) + "|" + mud({ preco_oferta: null }, ar).motivos.join(","),
    "false|true|false|Preço anunciado apagado com o encarte no ar");
  eq("NO AR: preço que não existia passa a existir = só registra", r(E.mudancaMaterial(Object.assign({}, base, { preco_oferta: null }), base, ar)), "false|false|true");
  eq("NO AR: escolhida descartada = crítica", r(mud({ situacao: "descartada" }, ar)), "false|true|false");
}

console.log("\n-- COINCIDÊNCIAS (D7·7) --");
{
  const nov = E.ocorrenciasCampanhas(E.REGRAS_PADRAO, "2026-11-01", "2026-11-30");
  const c = E.coincidencias(nov, { margemDias: 1 });
  const par = (x) => [x.a.id, x.b.id].sort().join("×");
  const hebf = c.find((x) => par(x) === "black-friday×hora-da-economia");
  eq("HE 26/11 × Black Friday 27/11 (a 1 dia)", hebf && [hebf.a.inicio, hebf.b.inicio, hebf.dias].join("|"), "2026-11-26|2026-11-27|1");
  eq("  texto do aviso", hebf && hebf.texto, "Hora da Economia (26/11) e Black Friday (27/11) ficam a 1 dia uma da outra");
  eq("a Promoção Semanal (contínua) nunca entra", c.some((x) => x.a.id === "promocao-semanal" || x.b.id === "promocao-semanal"), false);
  eq("Terçou (semanal) × HE (outra campanha): NÃO é coincidência (seria aviso todo mês)", c.some((x) => par(x) === "hora-da-economia×tercou"), false);
  eq("novembro/2026 tem exatamente 1 aviso (HE × Black Friday)", c.map(par).sort().join(","), "black-friday×hora-da-economia");
  const ano27 = E.coincidencias(E.ocorrenciasCampanhas(E.REGRAS_PADRAO, "2027-01-01", "2027-12-31"));
  eq("2027 inteiro: nenhum par Terçou × Hora da Economia", ano27.filter((x) => par(x) === "hora-da-economia×tercou").length, 0);
  eq("2029: HE 29/11 × Black Friday 23/11 não coincidem mais (a BF errada caía em 30/11)",
    E.coincidencias(E.ocorrenciasCampanhas(E.REGRAS_PADRAO, "2029-11-01", "2029-11-30")).some((x) => par(x) === "black-friday×hora-da-economia"), false);
  const natal26 = E.coincidencias(E.ocorrenciasCampanhas(E.REGRAS_PADRAO, "2026-12-20", "2026-12-24"));
  eq("Quarta Saudável 23/12 × Véspera de Natal 24/12 (data GRANDE): continua valendo", natal26.some((x) => par(x) === "natal×quarta-saudavel" && x.dias === 1), true);
  eq("Terçou 22/12 (só a terça) fica a 2 dias do Natal: não é coincidência", natal26.some((x) => par(x) === "natal×tercou"), false);
  // campanha criada no Calendário SEM modelo de edição (id 'usr-…')
  const feirao = { id: "usr-feirao", nome: "Feirão", tipo: "campanha", situacao: "ativa", regra: { tipo: "anual_fixa", mes: 11, dia: 27, duracao_dias: 1 } };
  const regrasF = E.REGRAS_PADRAO.concat([feirao]);
  const ocF = E.ocorrenciasCampanhas(regrasF, "2026-11-01", "2026-11-30");
  eq("campanha sem modelo, SEM a lista comEdicao: entra (quem chama não filtrou)", E.coincidencias(ocF, { regras: regrasF }).some((x) => x.a.id === "usr-feirao" || x.b.id === "usr-feirao"), true);
  const comEd = E.MODELOS_PADRAO.filter((m) => m.tipo === "edicao" && m.ativo !== false).map((m) => m.campanha_id);
  const cF = E.coincidencias(ocF, { regras: regrasF, comEdicao: comEd });
  eq("  com comEdicao: campanha sem modelo de edição não gera aviso", cF.some((x) => x.a.id === "usr-feirao" || x.b.id === "usr-feirao"), false);
  eq("  e a HE × Black Friday (data, fora da lista por ser data) continua", cF.map(par).join(","), "black-friday×hora-da-economia");
  const sexta = { id: "usr-sexta", nome: "Sexta do Frango", tipo: "campanha", situacao: "ativa", regra: { tipo: "semanal", dia_semana: 5, duracao_dias: 1 } };
  const regrasS = E.REGRAS_PADRAO.concat([sexta]);
  const cS = E.coincidencias(E.ocorrenciasCampanhas(regrasS, "2026-11-01", "2026-11-30"), { regras: regrasS });
  eq("campanha semanal nova (sexta) × HE (quinta): não é par; × Black Friday (data grande, mesma sexta): é",
    [cS.some((x) => par(x) === "hora-da-economia×usr-sexta"), cS.some((x) => par(x) === "black-friday×usr-sexta" && x.dias === 0)].join("|"), "false|true");
  eq("ocorrência de campanha semanal vem marcada (semanal: true)", ocF.find((o) => o.id === "tercou").semanal, true);
  const dez = E.coincidencias(E.ocorrenciasCampanhas(E.REGRAS_PADRAO, "2026-12-25", "2026-12-31"));
  const hr = dez.find((x) => [x.a.id, x.b.id].sort().join("×") === "hora-da-economia×reveillon");
  eq("HE 31/12/2026 × Réveillon 31/12 (mesmo dia)", hr && hr.dias, 0);
  eq("  texto", hr && hr.texto, "Hora da Economia (31/12) e Réveillon (31/12) caem no mesmo período");
  const out = E.coincidencias(E.ocorrenciasCampanhas(E.REGRAS_PADRAO, "2026-10-11", "2026-10-14"));
  eq("data MÉDIA não conta (Dia das Crianças 12/10 × Terçou 13/10)", out.some((x) => x.a.id === "dia-das-criancas" || x.b.id === "dia-das-criancas"), false);
  const car = E.coincidencias(E.ocorrenciasCampanhas(E.REGRAS_PADRAO, "2027-02-07", "2027-02-10"));
  eq("Carnaval 2027 (08–09/02) × Terçou 09/02 se sobrepõem", car.some((x) => [x.a.id, x.b.id].sort().join("×") === "carnaval×tercou" && x.dias === 0), true);
  const cru = E.coincidencias([{ id: "hora-da-economia", nome: "Hora da Economia", inicio: "2026-11-26", fim: "2026-11-26" },
    { id: "black-friday", nome: "Black Friday", inicio: "2026-11-27", fim: "2026-11-27" }]);
  eq("só {id,nome,inicio,fim}: tipo e categoria vêm das regras", cru.length, 1);
  eq("margem 0: só sobreposição conta", E.coincidencias(nov, { margemDias: 0 }).length, 0);
  eq("duas datas sem campanha não são coincidência", E.coincidencias([{ id: "natal", inicio: "2026-12-24", fim: "2026-12-24" },
    { id: "reveillon", inicio: "2026-12-25", fim: "2026-12-25" }]).length, 0);
  eq("a mesma campanha consigo mesma não conta", E.coincidencias([{ id: "tercou", inicio: "2026-11-24", fim: "2026-11-25" },
    { id: "tercou", inicio: "2026-11-25", fim: "2026-11-26" }]).length, 0);
}

console.log("\n-- MESMO PRODUTO EM PERÍODOS SOBREPOSTOS --");
{
  const itens = [
    { produto_id: 101, descricao: "ARROZ TIO JOAO 5KG", inicio: "2026-11-23", fim: "2026-11-30", preco: 21.9, onde: "PS 23/11 · Capa" },
    { produto_id: 101, descricao: "ARROZ TIO JOAO 5KG", inicio: "2026-11-27", fim: "2026-11-29", preco: 19.9, onde: "PS 23/11 · Fim de semana" },
    { produto_id: 202, descricao: "CAFE 250G", inicio: "2026-11-23", fim: "2026-11-30", preco: 9.99, onde: "PS 23/11" },
    { produto_id: 202, descricao: "CAFE 250G", inicio: "2026-12-07", fim: "2026-12-14", preco: 8.99, onde: "PS 07/12" },
    { produto_id: 303, descricao: "OLEO 900ML", inicio: "2026-11-23", fim: "2026-11-30", preco: 6.49, onde: "PS · Capa" },
    { produto_id: 303, descricao: "OLEO 900ML", inicio: "2026-11-23", fim: "2026-11-30", preco: 6.49, onde: "PS · Cesta básica" },
    { produto_id: 404, descricao: "DETERGENTE 500ML", inicio: "2026-11-26", fim: "2026-11-26", preco: 1.99, onde: "HE" },
    { produto_id: 404, descricao: "DETERGENTE 500ML", inicio: "2026-11-26", fim: "2026-11-26", preco: 2.19, onde: "HE (outra vaga)" },
    { produto_id: 505, descricao: "LEITE 1L", inicio: "2026-11-23", fim: "2026-11-30", preco: 4.99, onde: "PS 23/11" },
    { produto_id: 505, descricao: "LEITE 1L", inicio: "2026-11-30", fim: "2026-12-07", preco: 4.79, onde: "PS 30/11" }
  ];
  const s = E.sobreposicaoProdutos(itens);
  eq("destaca só quem tem período sobreposto E preço/período diferente", s.map((x) => x.produto_id).join(","), "101,404,505");
  eq("PS × Fim de semana: preço e período diferentes", s[0].diferencas.join(","), "preco,periodo");
  eq("  traz os dois lugares", s[0].itens.map((x) => x.onde).join(" / "), "PS 23/11 · Capa / PS 23/11 · Fim de semana");
  eq("mesmo período, preço diferente", s[1].diferencas.join(","), "preco");
  eq("PS × PS seguinte: a segunda-feira de encontro também conta", s[2].diferencas.join(","), "preco,periodo");
  eq("mesmo produto igual em tudo não é conflito (303 fora)", s.some((x) => x.produto_id === 303), false);
  eq("sem sobreposição não é conflito (202 fora)", s.some((x) => x.produto_id === 202), false);
  eq("preço não informado de um lado não acusa preço", E.sobreposicaoProdutos([{ produto_id: 1, inicio: "2026-11-23", fim: "2026-11-30", preco: null },
    { produto_id: 1, inicio: "2026-11-23", fim: "2026-11-30", preco: 5 }]).length, 0);
  const psA = { produto_id: 7, inicio: "2026-11-23", fim: "2026-11-30", preco: 21.9, campanha_id: "promocao-semanal" };
  const psB = { produto_id: 7, inicio: "2026-11-30", fim: "2026-12-07", preco: 21.9, campanha_id: "promocao-semanal" };
  eq("PS × PS seguinte, MESMO preço, só o dia de encosto: não destaca (o café de linha toda semana)", E.sobreposicaoProdutos([psA, psB]).length, 0);
  eq("  a ordem dos itens não muda nada", E.sobreposicaoProdutos([psB, psA]).length, 0);
  const semCamp = (x) => { const y = Object.assign({}, x); delete y.campanha_id; return y; };
  eq("  sem campanha_id nos itens, a mesma duração identifica as edições seguidas", E.sobreposicaoProdutos([semCamp(psA), semCamp(psB)]).length, 0);
  eq("  com preço diferente no encosto: destaca", E.sobreposicaoProdutos([psA, Object.assign({}, psB, { preco: 19.9 })]).map((x) => x.diferencas.join(",")).join("|"), "preco,periodo");
  eq("  campanhas DIFERENTES encostadas no mesmo dia, mesmo preço: destaca (período)",
    E.sobreposicaoProdutos([psA, Object.assign({}, psB, { campanha_id: "usr-outra" })]).map((x) => x.diferencas.join(",")).join("|"), "periodo");
  eq("  sobreposição de mais de 1 dia, mesmo preço e mesma campanha: destaca (período)",
    E.sobreposicaoProdutos([psA, Object.assign({}, psB, { inicio: "2026-11-29", fim: "2026-12-06" })]).map((x) => x.diferencas.join(",")).join("|"), "periodo");
  const fdsA = { produto_id: 7, inicio: "2026-11-27", fim: "2026-11-29", preco: 19.9, campanha_id: "promocao-semanal" };
  eq("  PS × Fim de semana (um contém o outro) com preço diferente: destaca", E.sobreposicaoProdutos([psA, fdsA]).map((x) => x.diferencas.join(",")).join("|"), "preco,periodo");
  eq("  1 dia dentro de outro período (não é encosto): destaca", E.sobreposicaoProdutos([psA, { produto_id: 7, inicio: "2026-11-30", fim: "2026-11-30", preco: 21.9, campanha_id: "promocao-semanal" }]).length, 1);
}

console.log("\n-- FRESCOR DOS DADOS DO VR (D9) --");
{
  const L = (a, m, d, h, mi) => new Date(a, m - 1, d, h, mi); // hora local de Caicó
  let s = E.statusDadosVr(L(2026, 9, 26, 9, 20).toJSON(), L(2026, 9, 26, 10, 0));
  eq("atualizado há 40 min", [s.texto, s.desatualizado].join(" | "), "Dados do VR atualizados às 09:20 | false");
  s = E.statusDadosVr("2026-09-26 12:20:00+00", L(2026, 9, 26, 10, 0));
  eq("formato do Postgres (12:20 UTC = 09:20 em Caicó)", s.texto, "Dados do VR atualizados às 09:20");
  eq("formato do Supabase com microssegundos", E.statusDadosVr("2026-09-26T12:20:00.123456+00:00", L(2026, 9, 26, 10, 0)).texto, "Dados do VR atualizados às 09:20");
  s = E.statusDadosVr(L(2026, 9, 26, 10, 0), L(2026, 9, 26, 12, 30));
  eq("mais de 2 h no horário do VR: desatualizado", [s.desatualizado, s.aviso].join(" | "), "true | Dados do VR desatualizados");
  eq("exatamente 2 h ainda não", E.statusDadosVr(L(2026, 9, 26, 10, 0), L(2026, 9, 26, 12, 0)).desatualizado, false);
  s = E.statusDadosVr(L(2026, 9, 25, 20, 50), L(2026, 9, 26, 6, 40));
  eq("06h40 com o dado das 20h50 de ontem: ainda não acusa (o robô nem pôde rodar)", [s.texto, s.desatualizado].join(" | "), "Dados do VR atualizados em 25/09 às 20:50 | false");
  eq("08h30 sem rodada hoje: desatualizado", E.statusDadosVr(L(2026, 9, 25, 20, 50), L(2026, 9, 26, 8, 30)).desatualizado, true);
  eq("23h com a última das 20h30: em dia", E.statusDadosVr(L(2026, 9, 26, 20, 30), L(2026, 9, 26, 23, 0)).desatualizado, false);
  eq("23h com a última das 18h: desatualizado (parou antes do fim do dia útil)", E.statusDadosVr(L(2026, 9, 26, 18, 0), L(2026, 9, 26, 23, 0)).desatualizado, true);
  eq("03h da madrugada com a última de 20h55 de ontem: em dia", E.statusDadosVr(L(2026, 9, 26, 20, 55), L(2026, 9, 27, 3, 0)).desatualizado, false);
  eq("03h com a última de anteontem: desatualizado", E.statusDadosVr(L(2026, 9, 25, 20, 55), L(2026, 9, 27, 3, 0)).desatualizado, true);
  s = E.statusDadosVr(null, L(2026, 9, 26, 10, 0));
  eq("nunca atualizou: avisa, não inventa hora", [s.texto, s.desatualizado].join(" | "), "Dados do VR ainda não atualizados | true");
  eq("ano diferente leva o ano na data", E.statusDadosVr(L(2026, 12, 31, 20, 0), L(2027, 1, 1, 9, 0)).texto, "Dados do VR atualizados em 31/12/2026 às 20:00");
}

console.log("\n-- SEEDS (seções 8 e 9) --");
{
  const R = E.REGRAS_PADRAO;
  eq("23 regras: 6 campanhas + 17 datas", [R.length, R.filter((r) => r.tipo === "campanha").length, R.filter((r) => r.tipo === "data").length].join("|"), "23|6|17");
  eq("ids únicos", new Set(R.map((r) => r.id)).size, R.length);
  eq("só a Sexta da Carne nasce pausada", R.filter((r) => r.situacao === "pausada").map((r) => r.id).join(","), "sexta-da-carne");
  eq("cores das campanhas", ["promocao-semanal", "tercou", "sabado-bombastico", "hora-da-economia", "sexta-da-carne"].map((i) => regra(i).cor).join(","),
    "#0c8599,#1b9e4b,#f1c40f,#0a6cff,#e60000");
  eq("datas grandes", R.filter((r) => r.categoria === "grande").map((r) => r.id).join(","), "carnaval,pascoa,aniversario-santa-rita,black-friday,natal,reveillon");
  eq("São João é data média", regra("sao-joao").categoria, "media");
  eq("toda data tem categoria; campanha não", R.every((r) => (r.tipo === "data") === (r.categoria === "media" || r.categoria === "grande")), true);
  const M = E.MODELOS_PADRAO;
  const ed = M.filter((m) => m.tipo === "edicao"), te = M.filter((m) => m.tipo === "tema");
  eq("6 modelos de edição + 15 temas", [ed.length, te.length].join("|"), "6|15");
  eq("prazos aprovados", ed.map((m) => m.id + ":" + [m.prazos.comecar, m.prazos.definir, m.prazos.aprovar].join("/")).join(" "),
    "promocao-semanal:28/17/14 tercou:14/8/7 sabado-bombastico:42/28/21 hora-da-economia:35/21/14 quarta-saudavel:21/10/7 sexta-da-carne:14/7/5");
  const nv = (m) => m.estrutura.grupos.map((g) => g.vagas.length).join(",");
  eq("SB: Capa 5, Mercearia 8, Limpeza 5, Perfumaria 8, Bebidas 4, Frios 4, Açougue 3", nv(modelo("sabado-bombastico")), "5,8,5,8,4,4,3");
  eq("HE: Capa 4, Mercearia 6, Limpeza 4, Higiene 4, Bebidas 3, Frios 3", nv(modelo("hora-da-economia")), "4,6,4,4,3,3");
  eq("SB sem nomes genéricos 'Mercearia 1..8'", modelo("sabado-bombastico").estrutura.grupos.every((g) => g.vagas.every((v) => !/\d$/.test(v.nome))), true);
  const capa = modelo("promocao-semanal").estrutura.grupos[0];
  eq("PS Capa: carne bovina é OPCIONAL", capa.vagas.filter((v) => !v.obrigatoria).map((v) => v.nome).join(","), "Carne bovina · definir na semana");
  eq("PS sem hortifrúti", modelo("promocao-semanal").estrutura.grupos.some((g) => /horti/i.test(g.nome)), false);
  const fds = modelo("promocao-semanal").estrutura.grupos.find((g) => g.chave === "fim-de-semana");
  eq("PS Fim de semana: identidade e período sex→dom", [fds.identidade, fds.periodo.ini_offset, fds.periodo.fim_offset].join("|"), "Final de semana de ofertas|4|6");
  const hort = modelo("tercou").estrutura.grupos[0];
  eq("Terçou Hortifrúti: flv, prazos 4/1/1, 7 vagas", [hort.flv, hort.prazos.comecar, hort.prazos.definir, hort.prazos.aprovar, hort.vagas.length].join("|"), "true|4|1|1|7");
  eq("chaves de grupo únicas por modelo e de vaga únicas por grupo", M.every((m) => {
    const gs = m.estrutura.grupos; if (new Set(gs.map((g) => g.chave)).size !== gs.length) return false;
    return gs.every((g) => new Set(g.vagas.map((v) => v.chave)).size === g.vagas.length);
  }), true);
  eq("todo tema aponta para uma DATA que existe", te.every((m) => regra(m.campanha_id) && regra(m.campanha_id).tipo === "data"), true);
  eq("tema sem vagas e sem prazo (segue a hospedeira)", te.every((m) => m.estrutura.grupos.length === 0 && Object.keys(m.prazos).length === 0), true);
  eq("modelo de edição aponta para a campanha de mesmo id", ed.every((m) => m.campanha_id === m.id && regra(m.id).tipo === "campanha"), true);
  eq("inicioTema: sem dias_antes_no_ar = a própria data", E.inicioTema(modelo("tema-natal"), "2026-12-24"), "2026-12-24");
  eq("inicioTema: 7 dias antes", E.inicioTema({ dias_antes_no_ar: 7 }, "2026-12-24"), "2026-12-17");
  const hosp = E.sugerirHospedeira([{ id: "ps1", campanha_id: "promocao-semanal", inicio: "2026-11-16", fim: "2026-11-23" },
    { id: "ps2", campanha_id: "promocao-semanal", inicio: "2026-11-23", fim: "2026-11-30" }, { id: "he", campanha_id: "hora-da-economia", inicio: "2026-11-26", fim: "2026-11-26" }], "2026-11-23");
  eq("hospedeira sugerida na segunda de encontro: a PS que começa nela", hosp.id, "ps2");
}

// ---------------------------------------------------------------------------------------
// As duas peças (este cálculo e o sql/encartes_v1.sql) partem do MESMO ponto e decidem igual.
// Estes blocos leem o SQL de verdade; sem o arquivo (ou sem Postgres local), ficam pulados.
const SQL_ARQ = path.join(__dirname, "..", "..", "sql", "encartes_v1.sql");
const SQL = fs.existsSync(SQL_ARQ) ? fs.readFileSync(SQL_ARQ, "utf8") : null;

// Lê as tuplas de um "insert ... values (...), (...) on conflict": textos '...' (com ''),
// blocos $j$...$j$, null e números inteiros.
function tuplasDoInsert(sql, cabecalho) {
  const i = sql.indexOf(cabecalho); if (i < 0) return null;
  const f = sql.indexOf("on conflict", i), t = sql.slice(i + cabecalho.length, f);
  const out = []; let k = 0, atual = null;
  while (k < t.length) {
    const c = t[k];
    if (c === "-" && t[k + 1] === "-") { k = t.indexOf("\n", k); if (k < 0) break; continue; }
    if (atual === null) { if (c === "(") atual = []; k++; continue; }
    if (c === ")") { out.push(atual); atual = null; k++; continue; }
    if (/[\s,]/.test(c)) { k++; continue; }
    if (c === "'") {
      let v = ""; k++;
      for (;;) { if (t[k] === "'" && t[k + 1] === "'") { v += "'"; k += 2; } else if (t[k] === "'") { k++; break; } else v += t[k++]; }
      atual.push(v); continue;
    }
    if (t.startsWith("$j$", k)) { const e = t.indexOf("$j$", k + 3); atual.push(t.slice(k + 3, e)); k = e + 3; continue; }
    if (t.startsWith("null", k)) { atual.push(null); k += 4; continue; }
    const m = /^-?\d+/.exec(t.slice(k, k + 20));
    if (m) { atual.push(+m[0]); k += m[0].length; continue; }
    throw new Error("trecho inesperado no SQL: " + t.slice(k, k + 40));
  }
  return out;
}
// JSON com as chaves em ordem (a ordem das chaves não importa; a das listas, sim).
function canon(x) {
  if (Array.isArray(x)) return "[" + x.map(canon).join(",") + "]";
  if (x && typeof x === "object") return "{" + Object.keys(x).sort().map((k) => JSON.stringify(k) + ":" + canon(x[k])).join(",") + "}";
  return JSON.stringify(x === undefined ? null : x);
}

console.log("\n-- PONTO DE PARTIDA = CÓPIA FIEL DO SQL (calendario_regras e encarte_modelos) --");
if (!SQL) console.log("  (pulado: sql/encartes_v1.sql não está nesta máquina)");
else {
  const tr = tuplasDoInsert(SQL, "insert into public.calendario_regras (id, nome, tipo, categoria, regra, setor, cor, situacao, ordem, observacao) values");
  const campos = ["id", "nome", "tipo", "categoria", "regra", "setor", "cor", "situacao", "ordem", "observacao"];
  const doSql = (tr || []).map((t) => { const o = {}; campos.forEach((c, i) => { o[c] = c === "regra" ? JSON.parse(t[i]) : t[i]; }); return o; });
  eq("o SQL tem as 23 regras (e o leitor achou todas)", doSql.length, 23);
  eq("mesmas regras, na mesma ordem", E.REGRAS_PADRAO.map((r) => r.id).join(","), doSql.map((r) => r.id).join(","));
  const difR = [];
  doSql.forEach((q) => {
    const c = E.REGRAS_PADRAO.find((r) => r.id === q.id) || {};
    campos.forEach((k) => { if (canon(c[k]) !== canon(q[k])) difR.push(q.id + "." + k + ": SQL=" + canon(q[k]) + " × cálculo=" + canon(c[k])); });
  });
  eq("regras: todo campo igual ao do SQL (nome, regra, setor, cor, situação, ordem, observação)", difR.join(" ; ") || "iguais", "iguais");
  eq("  o nome do id natal é 'Véspera de Natal'", regra("natal").nome, "Véspera de Natal");

  const tm = tuplasDoInsert(SQL, "insert into public.encarte_modelos (id, campanha_id, tipo, nome, prazos, estrutura, dicas) values");
  const cm = ["id", "campanha_id", "tipo", "nome", "prazos", "estrutura", "dicas"];
  const mSql = (tm || []).map((t) => { const o = {}; cm.forEach((c, i) => { o[c] = c === "prazos" || c === "estrutura" ? JSON.parse(t[i]) : t[i]; }); return o; });
  eq("o SQL tem os 21 modelos (e o leitor achou todos)", mSql.length, 21);
  eq("mesmos modelos, na mesma ordem", E.MODELOS_PADRAO.map((m) => m.id).join(","), mSql.map((m) => m.id).join(","));
  const difM = [];
  mSql.forEach((q) => {
    const c = E.MODELOS_PADRAO.find((m) => m.id === q.id) || {};
    cm.forEach((k) => {
      if (k !== "estrutura") { if (canon(c[k]) !== canon(q[k])) difM.push(q.id + "." + k + ": SQL=" + canon(q[k]) + " × cálculo=" + canon(c[k])); return; }
      const gq = q.estrutura.grupos || [], gc = ((c.estrutura || {}).grupos) || [];
      if (gq.map((g) => g.chave).join(",") !== gc.map((g) => g.chave).join(",")) { difM.push(q.id + ".grupos: SQL=" + gq.map((g) => g.chave) + " × cálculo=" + gc.map((g) => g.chave)); return; }
      gq.forEach((g, i) => { if (canon(g) !== canon(gc[i])) difM.push(q.id + "." + g.chave + ": vagas SQL=" + (g.vagas || []).map((v) => v.chave) + " × cálculo=" + (gc[i].vagas || []).map((v) => v.chave)); });
    });
  });
  eq("modelos: prazos, grupos, vagas (na ordem) e dicas iguais aos do SQL", difM.join(" ; ") || "iguais", "iguais");
  eq("  os campos que o SQL não manda saem com o padrão da tabela", E.MODELOS_PADRAO.every((m) => m.versao === 1 && m.ativo === true && m.dias_antes_no_ar === null), true);
}

console.log("\n-- MUDANÇA MATERIAL = ESPELHO DO BANCO (encarte__razoes_reabre / encarte__criticas) --");
{
  const base = { id: "p1", produtos: [101], fornecedor_nome: "ACME", preco_oferta: 12.99, custo_negociado: 9.8, verba_valor: 100, verba_qtd_base: 100 };
  const X = null; // campo apagado
  // [nome, mexe no ANTES, mexe no DEPOIS, reabre antes do ar?, crítica no ar?]
  const casos = [
    ["nada mudou", {}, {}, false, false],
    ["preço 12,99 → 12,991", {}, { preco_oferta: 12.991 }, true, true],
    ["preço desce", {}, { preco_oferta: 11.99 }, true, false],
    ["preço sobe", {}, { preco_oferta: 13.49 }, true, true],
    ["preço apagado", {}, { preco_oferta: X }, true, true],
    ["preço que não existia passa a existir", { preco_oferta: X }, { preco_oferta: 12.99 }, true, false],
    ["custo sobe", {}, { custo_negociado: 9.9 }, true, false],
    ["custo 2,248 → 2,2489", { custo_negociado: 2.248 }, { custo_negociado: 2.2489 }, true, false],
    ["custo desce", {}, { custo_negociado: 9.7 }, false, false],
    ["custo apagado", {}, { custo_negociado: X }, false, false],
    ["produto [101] → [101,101]", {}, { produtos: [101, 101] }, false, false],
    ["produto [101] → [102]", {}, { produtos: [102] }, true, true],
    ["produtos [101,102] → [102,101]", { produtos: [101, 102] }, { produtos: [102, 101] }, false, false],
    ["verba 100 → 50", {}, { verba_valor: 50 }, true, false],
    ["verba retirada", {}, { verba_valor: X, verba_qtd_base: X }, true, false],
    ["verba 100/10 → 80/4", { verba_qtd_base: 10 }, { verba_valor: 80, verba_qtd_base: 4 }, true, false],
    ["verba 100 sem base → 100/100", { verba_qtd_base: X }, { verba_qtd_base: 100 }, false, false],
    ["verba 100/50 → 100/100", { verba_qtd_base: 50 }, { verba_qtd_base: 100 }, false, false],
    ["verba 100/50 → 200/200", { verba_qtd_base: 50 }, { verba_valor: 200, verba_qtd_base: 200 }, false, false],
    ["verba nenhuma → 50/100", { verba_valor: X, verba_qtd_base: X }, { verba_valor: 50, verba_qtd_base: 100 }, false, false],
    ["bonificação 10+1 → 10+2", { bonif_compra: 10, bonif_ganha: 1 }, { bonif_ganha: 2 }, false, false],
    ["bonificação 10+1 → 12+1", { bonif_compra: 10, bonif_ganha: 1 }, { bonif_compra: 12 }, true, false],
    ["bonificação 10+1 → retirada", { bonif_compra: 10, bonif_ganha: 1 }, { bonif_compra: X, bonif_ganha: X }, true, false],
    ["bonificação 10+1 → 20+2", { bonif_compra: 10, bonif_ganha: 1 }, { bonif_compra: 20, bonif_ganha: 2 }, false, false],
    ["fornecedor trocado, mesmos produtos e preço", {}, { id: "p2", fornecedor_nome: "OUTRO" }, false, false]
  ].map(([nome, ma, md, reab, crit]) => {
    const a = Object.assign({}, base, ma), d = Object.assign({}, a, md);
    [a, d].forEach((o) => Object.keys(o).forEach((k) => { if (o[k] === null) delete o[k]; }));
    return { nome, a, d, reab, crit };
  });
  eq("todo caso (menos o primeiro) muda alguma coisa entre antes e depois", casos.slice(1).every((c) => JSON.stringify(c.a) !== JSON.stringify(c.d)), true);
  casos.forEach((c) => {
    eq("cálculo · " + c.nome + ": reabre antes do ar / crítica no ar",
      [E.mudancaMaterial(c.a, c.d, { noAr: false }).reabre, E.mudancaMaterial(c.a, c.d, { noAr: true }).critica].join("|"), [c.reab, c.crit].join("|"));
  });

  let B = null;
  try { B = require("./apoio/banco-de-teste.cjs"); } catch (e) { B = null; }
  if (!SQL || !B || !B.temPostgres()) console.log("  (pulado o lado do banco: falta o sql/encartes_v1.sql ou o Postgres local — brew install postgresql@16)");
  else {
    // As 4 funções da seção 5, recortadas do SQL como estão no arquivo.
    const fatia = (nome) => {
      const i = SQL.indexOf("create or replace function public." + nome + "(");
      if (i < 0) return null;
      const j = SQL.indexOf("$$", i), k = SQL.indexOf("$$;", j + 2);
      return SQL.slice(i, k + 3);
    };
    const pg = B.subir();
    try {
      const nomes = ["encarte__prod_conjunto", "encarte__verba_reduziu", "encarte__razoes_reabre", "encarte__criticas"];
      const erros = nomes.map((n) => { const f = fatia(n); if (!f) return n + ": não achei no SQL"; const r = B.rodar(pg, f); return r.ok ? null : n + ": " + r.erro; }).filter(Boolean);
      eq("banco · as 4 funções da seção 5 compilam num Postgres temporário", erros.join(" ; ") || "compilaram", "compilaram");
      const q = (x) => "'" + JSON.stringify(x).replace(/'/g, "''") + "'::jsonb";
      const valores = casos.map((c, i) => "(" + i + "," + q(c.a) + "," + q(c.d) + ")").join(",");
      const r = B.rodar(pg, "select n, array_to_string(public.encarte__razoes_reabre(a, d), ','), array_to_string(public.encarte__criticas(a, d), ',')" +
        " from (values " + valores + ") as t(n, a, d) order by n");
      const linhas = r.ok ? r.saida.split("\n").map((l) => l.split("|")) : [];
      eq("banco · respondeu todos os casos", linhas.length, casos.length);
      linhas.forEach(([n, reab, crit]) => {
        const c = casos[+n];
        eq("banco · " + c.nome + ": o banco decide o mesmo que o cálculo avisa", [reab !== "", crit !== ""].join("|"),
          [E.mudancaMaterial(c.a, c.d, { noAr: false }).reabre, E.mudancaMaterial(c.a, c.d, { noAr: true }).critica].join("|"));
      });
    } finally { B.derrubar(pg); }
  }
}

console.log("\n" + ok + " OK, " + falhou + " falha(s)");
process.exit(falhou ? 1 : 0);
