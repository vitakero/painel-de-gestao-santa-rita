// Testes do ROBÔ DOS ENCARTES (scripts/vr-sync-encartes.cjs) — a ficha dos produtos ativos do VR
// que vai para encarte_produtos_vr. Roda as funções DE VERDADE, com dados de mentira onde a
// resposta certa é conhecida, e a rodada inteira com imitações do VR e da nuvem.
//
//   node scripts/testes/encartes-sync.test.cjs
//   ENC_TESTE_VR=1 node scripts/testes/encartes-sync.test.cjs
//        -> também roda o robô DE VERDADE contra o VR em modo --seco (só leitura; não toca na nuvem)
//           e confere o arquivo que ele escreveu. Saída em ENC_TESTE_SAIDA (padrão: pasta temporária).
//   ENC_TESTE_NUVEM=1 node scripts/testes/encartes-sync.test.cjs
//        -> depois do sql/encartes_v1.sql rodado: lê (só lê) o esquema da nuvem e confere que as
//           colunas que o robô manda existem lá. Coluna que falta derruba o lote inteiro.
//
// O QUE ESTE TESTE GUARDA, e por quê:
// · nulo nunca vira zero (custo zero faria a margem da proposta dar 100%);
// · a impressão é estável (senão toda rodada regrava as 21 mil fichas);
// · a leitura da nuvem é paginada COM ORDEM e confere o total (sem ordem, páginas pulam linhas);
// · falha nunca apaga nem zera: o status da falha só leva tentativa + erro;
// · venda de 30 dias vazia numa rodada completa é erro (nada gravado, cache não nasce vazio);
// · fornecedor repetido no empate de data: decide a linha mais nova do VR, nunca a ordem do banco;
// · a janela 06h–21h e a trava de 55 min;
// · as colunas do robô são as da tabela (tabela e robô escritos em paralelo já recusaram upsert calados).
"use strict";
const fs = require("fs"), path = require("path"), os = require("os");
const RAIZ = path.join(__dirname, "..", "..");
const ARQ = path.join(RAIZ, "scripts", "vr-sync-encartes.cjs");
const E = require(ARQ);
const FONTE = fs.readFileSync(ARQ, "utf8");

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const a = typeof obtido === "object" ? JSON.stringify(obtido) : String(obtido);
  const b = typeof esperado === "object" ? JSON.stringify(esperado) : String(esperado);
  const bate = a === b;
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + a + (bate ? "" : "   (esperado: " + b + ")"));
  bate ? ok++ : falhou++;
}
const silencio = () => {};
// 26/09/2026 às 10:00 em Caicó = 13:00 UTC.
const T = (hhmm, dia) => Date.parse((dia || "2026-09-26") + "T" + hhmm + ":00-03:00");

// ---------------------------------------------------------------------------------------------
console.log("\n-- AS COLUNAS: o robô manda exatamente as colunas da tabela --");
{
  // A lista da especificação V1 (seção 7), copiada à mão de propósito: se alguém mudar a lista do
  // robô sem mudar a tabela, este teste reclama.
  const ESPEC = ["produto_id", "descricao", "eans", "m1", "m2", "m3", "setor", "grupo", "subgrupo", "preco_normal",
    "preco_atual", "em_oferta", "custo", "custo_confiavel", "estoque", "venda30_qtd", "venda30_valor", "ultima_compra",
    "ultima_compra_fornecedor", "ultima_oferta", "fornecedores", "impressao", "atualizado_em"];
  const ESPEC_ST = ["chave", "ultima_ok_em", "ultima_tentativa_em", "ultima_completa_em", "ultimo_erro", "linhas", "alteradas"];
  eq("1) COLUNAS do robô = lista da especificação", [...E.COLUNAS].sort(), [...ESPEC].sort());
  eq("2) COLUNAS_STATUS do robô = lista da especificação", [...E.COLUNAS_STATUS].sort(), [...ESPEC_ST].sort());
  const L = E.montarLinha({ id: 1, descricao: "X", m1: 1, m2: 1, m3: 1, precovenda: "1", custo: "1", estoque: "1" }, {}, "2026-09-26T13:00:00.000Z");
  eq("3) uma linha montada tem exatamente essas colunas (lote do PostgREST exige chaves iguais)", Object.keys(L).sort(), [...ESPEC].sort());

  // A própria especificação, se estiver no Mac (a .previa não vai para o robô).
  const espec = path.join(RAIZ, ".previa", "encartes", "espec-v1.md");
  if (fs.existsSync(espec)) {
    const t = fs.readFileSync(espec, "utf8");
    const bloco = (ini, fim) => { const a = t.indexOf(ini), b = t.indexOf(fim, a + 1); return a < 0 ? "" : t.slice(a + ini.length, b < 0 ? undefined : b); };
    const cols = (s) => (s.match(/([a-z_0-9]+) (?:int|text\[\]|text|numeric|boolean|date|jsonb|timestamptz)/g) || []).map((x) => x.split(" ")[0]);
    eq("4) bate com o texto da espec (encarte_produtos_vr)", cols(bloco("encarte_produtos_vr(", "encarte_sync(")).sort(), [...ESPEC].sort());
    eq("5) bate com o texto da espec (encarte_sync)", cols(bloco("encarte_sync(", "Índices")).sort(), [...ESPEC_ST].sort());
  } else console.log("  (pulado: .previa/encartes/espec-v1.md não está aqui)");

  // O SQL de verdade, quando existir: é contra ele que o upsert bate.
  const sqlArq = path.join(RAIZ, "sql", "encartes_v1.sql");
  if (fs.existsSync(sqlArq)) {
    const sql = fs.readFileSync(sqlArq, "utf8").replace(/--[^\n]*/g, "");
    const colsDaTabela = (nome) => {
      const m = new RegExp("create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?(?:public\\.)?" + nome + "\\s*\\(", "i").exec(sql);
      if (!m) return null;
      let i = m.index + m[0].length, prof = 1, ini = i;
      for (; i < sql.length && prof > 0; i++) { if (sql[i] === "(") prof++; else if (sql[i] === ")") prof--; }
      const corpo = sql.slice(ini, i - 1), partes = []; let p = 0, atual = "";
      for (const ch of corpo) { if (ch === "(") p++; if (ch === ")") p--; if (ch === "," && p === 0) { partes.push(atual); atual = ""; } else atual += ch; }
      partes.push(atual);
      const out = partes.map((x) => x.trim().split(/\s+/)[0].replace(/"/g, "").toLowerCase())
        .filter((x) => x && !/^(constraint|primary|unique|check|foreign|exclude)$/.test(x));
      const re = new RegExp("alter\\s+table\\s+(?:if\\s+exists\\s+)?(?:public\\.)?" + nome + "\\s+add\\s+column\\s+(?:if\\s+not\\s+exists\\s+)?([a-z_0-9]+)", "gi");
      let a; while ((a = re.exec(sql))) if (out.indexOf(a[1].toLowerCase()) < 0) out.push(a[1].toLowerCase());
      return out;
    };
    const cp = colsDaTabela("encarte_produtos_vr"), cs = colsDaTabela("encarte_sync");
    eq("6) sql/encartes_v1.sql cria encarte_produtos_vr", !!cp, true);
    if (cp) eq("7) toda coluna que o robô manda existe no SQL", E.COLUNAS.filter((c) => cp.indexOf(c) < 0), []);
    eq("8) sql/encartes_v1.sql cria encarte_sync", !!cs, true);
    if (cs) eq("9) toda coluna do status existe no SQL", E.COLUNAS_STATUS.filter((c) => cs.indexOf(c) < 0), []);
  } else console.log("  (pulado: sql/encartes_v1.sql ainda não existe — quando existir, este bloco confere as colunas)");
}

// ---------------------------------------------------------------------------------------------
console.log("\n-- CÓDIGO DE BARRAS: NUMERIC do VR vira texto de dígitos, sem perder nada --");
{
  eq("10) EAN-13 comum", E.normalizarEan("7891000100103"), "7891000100103");
  eq("11) o '.0' do NUMERIC sai", E.normalizarEan("7891000100103.0"), "7891000100103");
  eq("12) número grande não vira notação científica", E.normalizarEan(7891000100103), "7891000100103");
  eq("13) BigInt também", E.normalizarEan(BigInt("7891000100103")), "7891000100103");
  eq("14) zero à esquerda NÃO é perdido", E.normalizarEan("0789100010010"), "0789100010010");
  eq("15) EAN-8 não é completado até 13", E.normalizarEan("78912344"), "78912344");
  eq("16) código interno curto é mantido (o comprador digita)", E.normalizarEan("4536"), "4536");
  eq("17) espaço em volta sai", E.normalizarEan(" 7891000100103 "), "7891000100103");
  eq("18) nulo continua nulo", E.normalizarEan(null), null);
  eq("19) vazio vira nulo", E.normalizarEan(""), null);
  const L = E.montarLinha({ id: 5, m1: 1, m2: 1, m3: 1 }, { eans: ["7891000100103.0", "17891000100100", "7891000100103", null] });
  eq("20) na ficha: menor embalagem primeiro, sem repetido, sem nulo", L.eans, ["7891000100103", "17891000100100"]);
}

// ---------------------------------------------------------------------------------------------
console.log("\n-- CUSTO: nulo ou ≤ 0 vira NULO, nunca zero --");
{
  eq("21) custo nulo", E.positivoOuNulo(null), null);
  eq("22) custo '0.0000' (o VR guarda assim)", E.positivoOuNulo("0.0000"), null);
  eq("23) custo negativo", E.positivoOuNulo("-3.5"), null);
  eq("24) custo válido", E.positivoOuNulo("3.9010"), 3.901);
  eq("25) texto ilegível", E.positivoOuNulo("abc"), null);
  eq("26) estoque zero continua zero (é um fato)", E.numOuNulo("0.000"), 0);
  eq("27) estoque negativo continua negativo", E.numOuNulo("-135.000"), -135);
  eq("28) estoque ausente é nulo, não zero", E.numOuNulo(null), null);
  const L = E.montarLinha({ id: 9, descricao: "DECORA", m1: 50, m2: 9, m3: 3, precovenda: "1.49", custo: "0.0000", estoque: null }, { venda30Calculada: false });
  eq("29) ficha sem custo: custo null (e não 0)", L.custo, null);
  eq("30) ficha sem estoque: null", L.estoque, null);
  eq("31) venda não calculada: null ('não sei'), não zero", [L.venda30_qtd, L.venda30_valor], [null, null]);
  const L2 = E.montarLinha({ id: 9, m1: 50, m2: 9, m3: 3 }, { venda30Calculada: true, venda30: null });
  eq("32) venda calculada e produto ausente dela: vendeu zero (é medido)", [L2.venda30_qtd, L2.venda30_valor], [0, 0]);
  const L3 = E.montarLinha({ id: 9, m1: 50, m2: 9, m3: 3, precovenda: "0" }, {});
  eq("33) preço zero no VR: preco_atual e preco_normal nulos", [L3.preco_atual, L3.preco_normal], [null, null]);
  eq("34) custotabela 0 do fornecedor vira nulo", E.fornecedoresTop([{ id_fornecedor: 1, nome: "A", custotabela: "0.0000" }])[0].custotabela, null);
}

// ---------------------------------------------------------------------------------------------
console.log("\n-- CUSTO CONFIÁVEL: carne de desossa (setor 42, grupo 1) não é --");
{
  eq("35) 42/1 (CARNE BOVINA RN) não confiável", E.custoConfiavel(42, 1), false);
  eq("36) chega como texto também", E.custoConfiavel("42", "1"), false);
  eq("37) 42/3 (suína) é confiável", E.custoConfiavel(42, 3), true);
  eq("38) 1/1 é confiável", E.custoConfiavel(1, 1), true);
  eq("39) 39/42 (inverso) é confiável", E.custoConfiavel(39, 42), true);
  const L = E.montarLinha({ id: 4536, descricao: "MOCOTO BOV SERRADO UND", m1: 42, m2: 1, m3: 3, precovenda: "13", custo: "20", estoque: "-135" }, {});
  eq("40) mocotó: custo guardado, marcado não confiável", [L.custo, L.custo_confiavel], [20, false]);
}

// ---------------------------------------------------------------------------------------------
console.log("\n-- PREÇO NORMAL: com oferta ativa, o normal vem da oferta --");
{
  // Medido: durante a oferta o precovenda do VR JÁ É o preço de oferta.
  eq("41) com oferta ativa", E.precos("11.49", { preconormal: "12.59", precooferta: "11.49" }), { preco_normal: 12.59, preco_atual: 11.49, em_oferta: true });
  eq("42) sem oferta: normal = atual", E.precos("11.99", null), { preco_normal: 11.99, preco_atual: 11.99, em_oferta: false });
  eq("43) oferta sem preconormal válido: normal NULO (nunca o preço de oferta)", E.precos("2.99", { preconormal: "0", precooferta: "2.99" }).preco_normal, null);
  const L = E.montarLinhas({
    produtos: [{ id: 3629, descricao: "CAFE BANGU 250G ALMOFADA", m1: 39, m2: 7, m3: 2, precovenda: "11.4900", custo: "10.5", estoque: "9090" }],
    mercadologico: [{ nivel: 1, m1: 39, m2: 0, m3: 0, descricao: "NOVO - MERCEARIA" }, { nivel: 2, m1: 39, m2: 7, m3: 0, descricao: "CAFES" }, { nivel: 3, m1: 39, m2: 7, m3: 2, descricao: "ALMOFADA" }],
    ofertasAtivas: [{ id_produto: 3629, preconormal: "12.5900", precooferta: "11.49" }],
    ultimasOfertas: [{ id_produto: 3629, inicio: "2026-09-21", fim: "2026-09-28", preco: "11.49", tipo: "PROMOCAO SEMANAL" }],
  }, { produtos: {} }, "2026-09-26T13:00:00.000Z")[0];
  eq("44) ficha do café em oferta", [L.preco_normal, L.preco_atual, L.em_oferta], [12.59, 11.49, true]);
  eq("45) nomes do mercadológico nos três níveis", [L.setor, L.grupo, L.subgrupo], ["NOVO - MERCEARIA", "CAFES", "ALMOFADA"]);
  eq("46) última oferta com início, fim, preço e tipo", L.ultima_oferta, { inicio: "2026-09-21", fim: "2026-09-28", preco: 11.49, tipo: "PROMOCAO SEMANAL" });
  eq("47) sem oferta nenhuma: ultima_oferta nula", E.montarLinha({ id: 1, m1: 1, m2: 1, m3: 1 }, {}).ultima_oferta, null);
}

// ---------------------------------------------------------------------------------------------
console.log("\n-- FORNECEDORES: até 5, quem vendeu por último primeiro --");
{
  const F = E.fornecedoresTop([
    { id_fornecedor: 39, nome: " RIOGRANDENSE ", custotabela: "184", alterado: "2024-08-27", ultima: "2026-09-15" },
    { id_fornecedor: 243, nome: "MARATA", custotabela: "5.5", alterado: "2023-05-12", ultima: "2024-05-21" },
    { id_fornecedor: 67, nome: "TRES CORACOES MOSSORO", custotabela: "6.6", alterado: "2025-12-22", ultima: null },
    { id_fornecedor: 66, nome: "TRES CORACOES NATAL", custotabela: "6.6", alterado: "2023-03-27", ultima: "2026-09-03" },
    { id_fornecedor: 66, nome: "TRES CORACOES NATAL", custotabela: "7.1", alterado: "2025-01-01", ultima: "2026-09-03" },
    { id_fornecedor: 1, nome: "A", alterado: null, ultima: null },
    { id_fornecedor: 2, nome: "B", alterado: "2020-01-01", ultima: null },
  ]);
  eq("48) ordem: última compra, depois cadastro mais novo, depois código", F.map((f) => f.id), [39, 66, 243, 67, 2]);
  eq("49) no máximo 5", F.length, 5);
  eq("50) fornecedor repetido (um por estado) aparece uma vez, o de cadastro mais novo", F[1].custotabela, 7.1);
  eq("51) campos do item: id, nome, custotabela, ultima_compra", Object.keys(F[0]), ["id", "nome", "custotabela", "ultima_compra"]);
  eq("52) nome aparado", F[0].nome, "RIOGRANDENSE");
  eq("53) nenhum fornecedor: lista vazia (não nula)", E.montarLinha({ id: 1, m1: 1, m2: 1, m3: 1 }, {}).fornecedores, []);

  // EMPATE DE DATA: mesma dupla produto × fornecedor repetida (uma por estado), mesma última compra
  // e mesmo dia de alteração. Medido no VR: 172 pares assim, com custotabela diferente. Antes
  // decidia a ordem em que o banco devolvia (sem ORDER BY): o custotabela aparecia e sumia ao acaso.
  const dup = [
    { id_fornecedor: 66, id_linha: 900, nome: "TRES CORACOES NATAL", custotabela: "0.0000", alterado: "2025-01-01", ultima: "2026-09-03" },
    { id_fornecedor: 66, id_linha: 901, nome: "TRES CORACOES NATAL", custotabela: "7.1", alterado: "2025-01-01", ultima: "2026-09-03" },
    { id_fornecedor: 39, id_linha: 10, nome: "RIOGRANDENSE", custotabela: "184", alterado: "2024-08-27", ultima: "2026-09-15" },
  ];
  const ida = E.fornecedoresTop(dup), volta = E.fornecedoresTop(dup.slice().reverse());
  eq("53b) empate de data: fica a linha mais nova do VR (custotabela 7.1)", ida.find((f) => f.id === 66).custotabela, 7.1);
  eq("53c) o resultado não depende da ordem em que o banco devolveu", E.canonico(volta), E.canonico(ida));
  const brutoF = (l) => ({ produtos: [{ id: 3629, m1: 39, m2: 7, m3: 2, precovenda: "11.49", custo: "10", estoque: "1" }],
    fornecedores: l.map((f) => Object.assign({ id_produto: 3629 }, f)) });
  eq("53d) na ficha: a impressão não oscila com a ordem das linhas do VR",
    E.montarLinhas(brutoF(dup.slice().reverse()), null, "x")[0].impressao, E.montarLinhas(brutoF(dup), null, "x")[0].impressao);
  // Sem id_linha, decide a posição na lista (a 1ª da ordem do banco) — mesmo com um sort que não
  // guarda a ordem dos empates (a versão do Node da loja não é conhecida). Aqui o sort é trocado
  // por um que devolve os empates invertidos.
  const semLinha = [{ id_fornecedor: 5, nome: "X", custotabela: "1", alterado: "2025-01-01", ultima: null },
    { id_fornecedor: 5, nome: "X", custotabela: "2", alterado: "2025-01-01", ultima: null }];
  const sortOriginal = Array.prototype.sort;
  let rInstavel = null;
  try { Array.prototype.sort = function (cmp) { this.reverse(); return sortOriginal.call(this, cmp); }; rInstavel = E.fornecedoresTop(semLinha); }
  finally { Array.prototype.sort = sortOriginal; }
  eq("53e) sort que não guarda empate: ainda fica a 1ª da ordem do banco", rInstavel[0].custotabela, 1);
  eq("53f) consulta dos fornecedores com ORDEM total (produto, fornecedor, alteração mais nova, linha mais nova)",
    /ORDER BY pf\.id_produto, pf\.id_fornecedor, pf\.dataalteracao DESC NULLS LAST, pf\.id DESC\s*$/.test(E.SQL.fornecedores), true);
  eq("53g) e traz a chave da linha (id_linha) para o desempate", /pf\.id id_linha/.test(E.SQL.fornecedores), true);
}

// ---------------------------------------------------------------------------------------------
console.log("\n-- DATAS: nunca fatiar o objeto Date do driver --");
{
  eq("54) texto do ::text", E.dataISO("2026-09-15"), "2026-09-15");
  eq("55) Date à meia-noite local (como o driver entrega)", E.dataISO(new Date(2026, 6, 4)), "2026-07-04");
  eq("56) lixo vira nulo", E.dataISO("Sat Jul 04"), null);
  eq("57) Caicó às 22h ainda é o mesmo dia (o servidor do VR em GMT já virou)", E.brasilia(Date.parse("2026-09-27T01:00:00Z")).data, "2026-09-26");
}

// ---------------------------------------------------------------------------------------------
console.log("\n-- IMPRESSÃO: estável, e muda quando a ficha muda --");
{
  const p = { id: 8114, descricao: "CAFE PURO 250G ALMOFADA", m1: 39, m2: 7, m3: 2, precovenda: "11.9900", custo: "9.9900", estoque: "2797.000" };
  const x = { eans: ["7898286200374"], venda30Calculada: true, venda30: [3708, 42010.84],
    fornecedores: [{ id_fornecedor: 39, nome: "RIOGRANDENSE", custotabela: "184", ultima: "2026-09-15" }] };
  const a = E.montarLinha(p, x, "2026-09-26T09:00:00.000Z"), b = E.montarLinha(p, x, "2026-09-26T15:00:00.000Z");
  eq("58) mesma ficha em horas diferentes: mesma impressão (atualizado_em fica fora)", a.impressao === b.impressao, true);
  eq("59) impressão é um sha1 (40 hexadecimais)", /^[0-9a-f]{40}$/.test(a.impressao), true);
  const c = E.montarLinha(Object.assign({}, p, { precovenda: "11.99" }), x);
  eq("60) '11.9900' e '11.99' dão a mesma impressão (o número é o mesmo)", c.impressao, a.impressao);
  const d = E.montarLinha(Object.assign({}, p, { precovenda: "10.89" }), x);
  eq("61) preço mudou: impressão muda", d.impressao !== a.impressao, true);
  const e2 = E.montarLinha(p, Object.assign({}, x, { venda30: [3709, 42021.83] }));
  eq("62) venda mudou: impressão muda", e2.impressao !== a.impressao, true);
  const f = E.montarLinha(Object.assign({}, p, { custo: null }), x);
  eq("63) custo sumiu: impressão muda", f.impressao !== a.impressao, true);
  eq("64) ordem das chaves não importa", E.impressao({ a: 1, b: { c: 2, d: 3 } }) === E.impressao({ b: { d: 3, c: 2 }, a: 1 }), true);
  eq("65) a impressão ignora o campo impressao e o atualizado_em", E.impressao(Object.assign({}, a, { impressao: "x", atualizado_em: "y" })), a.impressao);
  const mapa = new Map([[8114, a.impressao]]);
  eq("66) incremental: igual na nuvem não regrava", E.alteradas([b], mapa).length, 0);
  eq("67) incremental: mudou, regrava", E.alteradas([d], mapa).length, 1);
  eq("68) incremental: produto novo (não está na nuvem), grava", E.alteradas([E.montarLinha(Object.assign({}, p, { id: 1 }), x)], mapa).length, 1);
  eq("69) lotes de 500: 1203 viram 500/500/203", E.emLotes(new Array(1203).fill(0), E.LOTE).map((l) => l.length), [500, 500, 203]);
}

// ---------------------------------------------------------------------------------------------
console.log("\n-- JANELA 06h–21h (Brasília) e TRAVA de 55 min --");
{
  eq("70) 05:59 fechada", E.janelaAberta(T("05:59")), false);
  eq("71) 06:00 aberta", E.janelaAberta(T("06:00")), true);
  eq("72) 20:59 aberta", E.janelaAberta(T("20:59")), true);
  eq("73) 21:00 fechada", E.janelaAberta(T("21:00")), false);
  eq("74) 03:00 fechada", E.janelaAberta(T("03:00")), false);
  const ag = T("10:00");
  eq("75) trava: 54 min atrás segura", E.travaLibera(String(ag - 54 * 60e3), ag), false);
  eq("76) trava: 55 min atrás libera", E.travaLibera(String(ag - 55 * 60e3), ag), true);
  eq("77) trava: arquivo ausente libera", E.travaLibera(null, ag), true);
  eq("78) trava: conteúdo ilegível libera", E.travaLibera("abc", ag), true);
  eq("79) trava: instante no futuro (relógio voltou) libera", E.travaLibera(String(ag + 3600e3), ag), true);
  eq("80) decidir: fora da janela não roda", E.decidirRodada({ agoraMs: T("22:00"), trava: null }).rodar, false);
  eq("81) decidir: ENC_FORCAR ignora janela e trava", E.decidirRodada({ agoraMs: T("22:00"), trava: String(T("21:59")), forcar: true }).rodar, true);
  eq("82) decidir: seco ignora janela e trava", E.decidirRodada({ agoraMs: T("04:00"), seco: true }).rodar, true);
  eq("83) decidir: trava recente não roda", E.decidirRodada({ agoraMs: ag, trava: String(ag - 10 * 60e3) }).rodar, false);
}

// ---------------------------------------------------------------------------------------------
// Imitações para a RODADA inteira.
function brutoFalso(n, mexer) {
  const produtos = [];
  for (let i = 1; i <= n; i++) produtos.push({ id: i, descricao: "PRODUTO " + i, m1: i % 50 === 0 ? 42 : 39, m2: 1, m3: 1,
    precovenda: (5 + (i % 7)).toFixed(4), custo: i % 100 === 0 ? null : (3 + (i % 5)).toFixed(4), estoque: String(i % 13) });
  if (mexer) mexer(produtos);
  return { produtos, mercadologico: [], eans: produtos.map((p) => ({ id_produto: p.id, cb: String(7890000000000 + p.id) })),
    ofertasAtivas: [], ultimasOfertas: [], ultimasCompras: [], fornecedores: [] };
}
function nuvemFalsa(o) {
  o = o || {};
  const reg = { lotes: [], status: [], chamadas: [] };
  const n = {
    reg,
    async lerImpressoes() { reg.chamadas.push("lerImpressoes"); if (o.falhaLer) throw new Error(o.falhaLer); return new Map(o.mapa || []); },
    async gravarLote(l) { reg.chamadas.push("gravarLote"); if (o.falhaLote && reg.lotes.length + 1 === o.falhaLote) throw new Error("gravar lote: a nuvem não respondeu"); reg.lotes.push(l); return l.length; },
    async gravarStatus(s) { reg.chamadas.push("gravarStatus"); reg.status.push(s); if (o.falhaStatus) throw new Error("status fora"); return true; },
  };
  return n;
}
// Venda de 30 dias de mentira, com cara de loja de verdade: o produto 1 vendeu 10, o 2 não vendeu,
// e 1 em cada 3 vendeu alguma coisa (com 1203 ativos, 401 com venda — acima do mínimo de 100).
function vendaFalsa(n) {
  const p = { 1: [10, 55.5] };
  for (let i = 3; i <= n; i += 3) p[i] = [(i % 7) + 1, ((i % 7) + 1) * 4.5];
  return p;
}
function ambiente(o) {
  const est = { trava: o.trava === undefined ? null : o.trava, cache: o.cache === undefined ? null : o.cache, lerVR: [], saida: null, travaGravada: null, cacheGravado: null };
  const nuvem = o.seco ? null : nuvemFalsa(o.nuvem);
  const opc = {
    agoraMs: o.agoraMs || T("10:00"), seco: !!o.seco, forcar: !!o.forcar, log: silencio, minimo: o.minimo === undefined ? 1 : o.minimo,
    nuvem,
    lerTrava: () => est.trava, gravarTrava: (ms) => { est.travaGravada = ms; },
    lerCache: () => est.cache, gravarCache: (v) => { est.cacheGravado = v; },
    lerVR: async (hoje, comVenda30) => {
      est.lerVR.push({ hoje, comVenda30 });
      if (o.falhaVR) throw new Error(o.falhaVR);
      const bruto = brutoFalso(o.n || 1203, o.mexer);
      const produtos = o.venda ? o.venda(o.n || 1203) : vendaFalsa(o.n || 1203);
      return { bruto, venda30: comVenda30 ? { data: hoje, de: E.addDias(hoje, -30), ate: E.addDias(hoje, -1), produtos } : null, tempos: {} };
    },
    escreverSaida: (obj) => { est.saida = obj; },
  };
  if (o.relogio) opc.relogio = o.relogio;
  if (o.prazoLotesMs !== undefined) opc.prazoLotesMs = o.prazoLotesMs;
  return { opc, est, nuvem };
}

(async () => {
  console.log("\n-- A RODADA: primeira carga (nuvem vazia, sem cache) --");
  let impressoesDaPrimeira;
  {
    const { opc, est, nuvem } = ambiente({});
    const r = await E.rodar(opc);
    eq("84) deu certo", r.ok, true);
    eq("85) leu a nuvem ANTES do VR (tabela ausente nem incomoda o VR)", nuvem.reg.chamadas[0], "lerImpressoes");
    eq("86) rodada completa: pediu a venda de 30 dias ao VR", est.lerVR[0].comVenda30, true);
    eq("87) 'hoje' em Brasília", est.lerVR[0].hoje, "2026-09-26");
    eq("88) gravou as 1203 em lotes de 500", nuvem.reg.lotes.map((l) => l.length), [500, 500, 203]);
    const st = nuvem.reg.status[0];
    eq("89) status: chave 'produtos'", st.chave, "produtos");
    eq("90) status: linhas e alteradas", [st.linhas, st.alteradas], [1203, 1203]);
    eq("91) status: ultima_ok_em, ultima_tentativa_em e ultima_completa_em preenchidos", [!!st.ultima_ok_em, !!st.ultima_tentativa_em, !!st.ultima_completa_em], [true, true, true]);
    eq("92) status: ultimo_erro limpo", st.ultimo_erro, null);
    eq("93) status só com colunas conhecidas", Object.keys(st).filter((k) => E.COLUNAS_STATUS.indexOf(k) < 0), []);
    eq("94) cache da venda gravado com a data de hoje", est.cacheGravado && est.cacheGravado.data, "2026-09-26");
    eq("95) trava gravada com o instante da tentativa", est.travaGravada, T("10:00"));
    const semCusto = nuvem.reg.lotes.flat().find((l) => l.produto_id === 100);
    eq("96) produto sem custo foi como null (não 0)", semCusto.custo, null);
    eq("97) produto do setor 42/1 foi como não confiável", semCusto.custo_confiavel, false);
    eq("98) produto que vendeu: venda do dia", nuvem.reg.lotes[0][0].venda30_qtd, 10);
    eq("99) produto que não vendeu: zero medido", nuvem.reg.lotes[0][1].venda30_qtd, 0);
    impressoesDaPrimeira = nuvem.reg.lotes.flat().map((l) => [l.produto_id, l.impressao]);
    var cacheDaPrimeira = est.cacheGravado;
  }

  console.log("\n-- A RODADA: 1 hora depois, nada mudou (cache do dia) --");
  {
    const { opc, est, nuvem } = ambiente({ agoraMs: T("11:00"), trava: String(T("10:00")), cache: JSON.stringify(cacheDaPrimeira), nuvem: { mapa: impressoesDaPrimeira } });
    const r = await E.rodar(opc);
    eq("100) deu certo", r.ok, true);
    eq("101) reaproveitou a venda do dia (não pediu ao VR)", est.lerVR[0].comVenda30, false);
    eq("102) nada mudou: nenhum lote", nuvem.reg.lotes.length, 0);
    const st = nuvem.reg.status[0];
    eq("103) status: alteradas 0, linhas 1203", [st.alteradas, st.linhas], [0, 1203]);
    eq("104) não é completa: ultima_completa_em não vai (a anterior fica)", "ultima_completa_em" in st, false);
    eq("105) cache não é regravado", est.cacheGravado, null);
  }

  console.log("\n-- A RODADA: um preço mudou --");
  {
    const { opc, nuvem } = ambiente({ agoraMs: T("12:00"), cache: JSON.stringify(cacheDaPrimeira), nuvem: { mapa: impressoesDaPrimeira },
      mexer: (ps) => { ps[6].precovenda = "99.9900"; } });
    await E.rodar(opc);
    eq("106) só a ficha que mudou foi gravada", nuvem.reg.lotes.flat().map((l) => [l.produto_id, l.preco_atual]), [[7, 99.99]]);
  }

  console.log("\n-- A RODADA: cache de ONTEM não vale --");
  {
    const ontem = Object.assign({}, cacheDaPrimeira, { data: "2026-09-25" });
    const { opc, est, nuvem } = ambiente({ agoraMs: T("06:05", "2026-09-26"), cache: JSON.stringify(ontem), nuvem: { mapa: impressoesDaPrimeira } });
    await E.rodar(opc);
    eq("107) 1ª rodada do dia: recalcula a venda", est.lerVR[0].comVenda30, true);
    eq("108) e marca completa", !!nuvem.reg.status[0].ultima_completa_em, true);
    eq("109) cache ilegível também não vale", E.venda30DoCache("{ quebrado", "2026-09-26"), null);
  }

  console.log("\n-- FALHA NUNCA ZERA NEM APAGA --");
  {
    const { opc, est, nuvem } = ambiente({ falhaVR: "NAO CONSEGUI CONECTAR NO VR" });
    const r = await E.rodar(opc);
    eq("110) VR fora: a rodada NÃO lança erro (o robô segue)", r.ok, false);
    eq("111) nenhum lote gravado", nuvem.reg.lotes.length, 0);
    eq("112) status da falha só tem chave, tentativa e erro (linhas/alteradas/ok anteriores ficam)", Object.keys(nuvem.reg.status[0]).sort(), ["chave", "ultima_tentativa_em", "ultimo_erro"]);
    eq("113) o erro vai para o status", /NAO CONSEGUI CONECTAR/.test(nuvem.reg.status[0].ultimo_erro), true);
    eq("114) cache não é gravado", est.cacheGravado, null);
    eq("115) a trava foi gravada (falha também espera 55 min)", est.travaGravada, T("10:00"));
  }
  {
    const { opc, est, nuvem } = ambiente({ nuvem: { falhaLote: 2 } });
    const r = await E.rodar(opc);
    eq("116) caiu no 2º lote: rodada falha sem lançar", r.ok, false);
    eq("117) o 1º lote ficou (nada é desfeito)", nuvem.reg.lotes.length, 1);
    eq("118) o erro conta o progresso", /gravou 500 de 1203/.test(nuvem.reg.status[0].ultimo_erro), true);
    eq("119) sem ultima_ok_em", "ultima_ok_em" in nuvem.reg.status[0], false);
    eq("120) rodada completa que falhou não grava o cache (a próxima volta a ser completa)", est.cacheGravado, null);
  }
  {
    const { opc, est, nuvem } = ambiente({ nuvem: { falhaLer: "ler impressões: a tabela encarte_produtos_vr ainda não existe no Supabase" } });
    const r = await E.rodar(opc);
    eq("121) tabela ausente: falha cedo", r.ok, false);
    eq("122) e nem chamou o VR, nem gravou lote", [est.lerVR.length, nuvem.reg.lotes.length], [0, 0]);
  }
  {
    const { opc, est, nuvem } = ambiente({ minimo: 1000, n: 12 });
    const r = await E.rodar(opc);
    eq("123) VR 'mudo' (12 produtos): nada gravado", [r.ok, nuvem.reg.lotes.length], [false, 0]);
    eq("124) e o motivo vai para o status", /só 12 produto/.test(nuvem.reg.status[0].ultimo_erro), true);
  }
  {
    // Venda de 30 dias VAZIA numa rodada completa (pdv fora do ar, tabela sendo refeita). Antes era
    // aceita como verdade: venda 0 (não medida) em TODAS as fichas e o cache {} segurava o dia.
    const { opc, est, nuvem } = ambiente({ venda: () => ({}) });
    const r = await E.rodar(opc);
    eq("124b) venda de 30 dias vazia na rodada completa: falha, nada gravado", [r.ok, nuvem.reg.lotes.length], [false, 0]);
    eq("124c) o cache NÃO é gravado (a próxima rodada volta a ser completa)", est.cacheGravado, null);
    eq("124d) ultimo_erro diz 'venda de 30 dias veio vazia'", /venda de 30 dias veio vazia/.test(nuvem.reg.status[0].ultimo_erro), true);
    eq("124e) status da falha só com chave, tentativa e erro", Object.keys(nuvem.reg.status[0]).sort(), ["chave", "ultima_tentativa_em", "ultimo_erro"]);
  }
  {
    const poucas = (k) => () => { const p = {}; for (let i = 1; i <= k; i++) p[i] = [1, 2]; return p; };
    const a = ambiente({ venda: poucas(E.MINIMO_COM_VENDA - 1) }), ra = await E.rodar(a.opc);
    eq("124f) 99 produtos com venda para 1203 ativos: falha, sem lote e sem cache", [ra.ok, a.nuvem.reg.lotes.length, a.est.cacheGravado], [false, 0, null]);
    const b = ambiente({ venda: poucas(E.MINIMO_COM_VENDA) }), rb = await E.rodar(b.opc);
    eq("124g) 100 produtos com venda: passa", [rb.ok, b.nuvem.reg.lotes.length, !!b.est.cacheGravado], [true, 3, true]);
    eq("124h) quantidade e valor zero não contam como venda", E.produtosComVenda({ produtos: { 1: [0, 0], 2: ["0.000", "0.00"], 3: [1, 0], 4: [0, 2.5] } }), 2);
    const c = ambiente({ n: 1000, venda: () => ({}) }), rc = await E.rodar(c.opc);
    eq("124i) com 1000 ativos ou menos a conferência não se aplica", [rc.ok, c.nuvem.reg.lotes.length], [true, 2]);
    const d = ambiente({ n: 1001, venda: () => ({}) }), rd = await E.rodar(d.opc);
    eq("124j) com 1001 ativos já se aplica", rd.ok, false);
    const s = ambiente({ seco: true, venda: () => ({}) }), rs = await E.rodar(s.opc);
    eq("124k) modo seco com venda vazia: falha e não escreve o resultado", [rs.ok, s.est.saida], [false, null]);
  }
  {
    let t = T("10:00");
    const { opc, nuvem } = ambiente({ relogio: () => (t += 60e3), prazoLotesMs: 170000 });
    const r = await E.rodar(opc);
    eq("125) passou do prazo entre lotes: para e registra", [r.ok, /tempo esgotado/.test(nuvem.reg.status[0].ultimo_erro)], [false, true]);
  }
  {
    const { opc, est } = ambiente({ nuvem: { falhaStatus: true } });
    let lancou = false, r = null;
    try { r = await E.rodar(opc); } catch (e) { lancou = true; }
    eq("126) nem o status fora do ar derruba a rodada", lancou, false);
    eq("126b) status recusado: a rodada conta como falha e o cache NÃO é gravado", [r && r.ok, est.cacheGravado], [false, null]);
  }
  {
    const { opc, est } = ambiente({});
    opc.gravarTrava = () => { throw new Error("EACCES"); };
    const r = await E.rodar(opc);
    eq("126c) trava que não grava não impede a sincronização", [r.ok, est.lerVR.length], [true, 1]);
  }

  console.log("\n-- JANELA e TRAVA na rodada --");
  {
    const { opc, est, nuvem } = ambiente({ agoraMs: T("05:30") });
    const r = await E.rodar(opc);
    eq("127) 05:30: pula sem tocar em nada", [r.pulou, est.lerVR.length, nuvem.reg.chamadas.length, est.travaGravada], [true, 0, 0, null]);
  }
  {
    const { opc, est } = ambiente({ agoraMs: T("21:10"), forcar: true });
    await E.rodar(opc);
    eq("128) 21:10 com ENC_FORCAR=1: roda", est.lerVR.length, 1);
  }
  {
    const { opc, est } = ambiente({ agoraMs: T("10:30"), trava: String(T("10:00")) });
    const r = await E.rodar(opc);
    eq("129) 30 min depois da última: pula", [r.pulou, est.lerVR.length], [true, 0]);
  }

  console.log("\n-- MODO SECO: não toca na nuvem --");
  {
    const { opc, est } = ambiente({ seco: true, agoraMs: T("23:00") });
    const r = await E.rodar(opc);
    eq("130) roda a qualquer hora", r.ok, true);
    eq("131) escreveu o resultado", !!(est.saida && est.saida.linhas.length === 1203), true);
    eq("132) não grava trava nem cache", [est.travaGravada, est.cacheGravado], [null, null]);
    eq("133) sempre completa (não lê cache)", est.lerVR[0].comVenda30, true);
    eq("134) traz o resumo", [est.saida.resumo.linhas, est.saida.resumo.sem_custo, est.saida.resumo.nao_confiaveis], [1203, 12, 24]);
  }

  // -------------------------------------------------------------------------------------------
  console.log("\n-- A NUVEM: paginação com ordem, total conferido, lote conferido --");
  function servidor(total, o) {
    o = o || {};
    const chamadas = [];
    const pedir = async (metodo, caminho, corpo, cab) => {
      chamadas.push({ metodo, caminho, corpo, cab });
      if (o.ausente) return { status: 404, cabecalhos: {}, corpo: '{"code":"PGRST205","message":"Could not find the table public.encarte_produtos_vr"}' };
      if (metodo === "GET") {
        const [a, b] = cab.Range.split("-").map(Number);
        const fim = Math.min(b, a + (o.maxLinhas || 1000) - 1, total - 1);
        const pag = []; for (let i = a; i <= fim; i++) pag.push({ produto_id: o.repetir ? 1 : i + 1, impressao: "h" + (i + 1) });
        const declarado = o.totalMente ? total + 1 : total;
        return { status: 206, cabecalhos: { "content-range": (pag.length ? a + "-" + fim : "*") + "/" + declarado }, corpo: JSON.stringify(pag) };
      }
      if (metodo === "POST" && caminho.indexOf("encarte_produtos_vr") >= 0) {
        if (o.colunaFalta) return { status: 400, cabecalhos: {}, corpo: '{"code":"PGRST204","message":"Could not find the \'custo\' column"}' };
        const volta = (o.engolir ? corpo.slice(1) : corpo).map((l) => ({ produto_id: l.produto_id }));
        return { status: 201, cabecalhos: {}, corpo: JSON.stringify(volta) };
      }
      return { status: 201, cabecalhos: {}, corpo: "" };
    };
    return { pedir, chamadas };
  }
  {
    const s = servidor(2500), N = E.criarNuvem(s.pedir);
    const m = await N.lerImpressoes();
    eq("135) leu as 2500 impressões", m.size, 2500);
    eq("136) toda página pede ORDEM por produto_id", s.chamadas.every((c) => /order=produto_id/.test(c.caminho)), true);
    eq("137) pede só produto_id e impressao", s.chamadas.every((c) => /select=produto_id,impressao/.test(c.caminho)), true);
    eq("138) páginas por Range", s.chamadas.map((c) => c.cab.Range), ["0-999", "1000-1999", "2000-2999"]);
    eq("139) pede o total exato", s.chamadas.every((c) => c.cab.Prefer === "count=exact"), true);
  }
  {
    const s = servidor(2500, { maxLinhas: 700 }), N = E.criarNuvem(s.pedir);
    eq("140) servidor que corta em 700: avança pelo que veio, lê tudo", (await N.lerImpressoes()).size, 2500);
  }
  {
    const s = servidor(0), N = E.criarNuvem(s.pedir);
    eq("141) tabela vazia (primeira carga): mapa vazio", (await N.lerImpressoes()).size, 0);
  }
  {
    let msg = ""; try { await E.criarNuvem(servidor(1500, { totalMente: true }).pedir).lerImpressoes(); } catch (e) { msg = e.message; }
    eq("142) total não bate: erro (nada será gravado)", msg !== "", true);
    msg = ""; try { await E.criarNuvem(servidor(1500, { repetir: true }).pedir).lerImpressoes(); } catch (e) { msg = e.message; }
    eq("143) páginas repetidas (paginação errada): erro", /distintos/.test(msg), true);
    msg = ""; try { await E.criarNuvem(servidor(10, { ausente: true }).pedir).lerImpressoes(); } catch (e) { msg = e.message; }
    eq("144) tabela ausente: mensagem diz o que fazer", /falta rodar sql\/encartes_v1\.sql/.test(msg), true);
  }
  {
    const linhas = [1, 2, 3].map((i) => E.montarLinha({ id: i, m1: 1, m2: 1, m3: 1 }, {}));
    const s = servidor(0), N = E.criarNuvem(s.pedir);
    eq("145) lote confirmado inteiro", await N.gravarLote(linhas), 3);
    const c = s.chamadas[0];
    eq("146) upsert por produto_id, devolvendo só os ids", /on_conflict=produto_id&select=produto_id/.test(c.caminho), true);
    eq("147) mescla (nunca troca a linha inteira por INSERT cego)", /resolution=merge-duplicates/.test(c.cab.Prefer), true);
    let msg = ""; try { await E.criarNuvem(servidor(0, { engolir: true }).pedir).gravarLote(linhas); } catch (e) { msg = e.message; }
    eq("148) nuvem confirmou menos do que foi: erro", /confirmou 2 de 3/.test(msg), true);
    msg = ""; try { await E.criarNuvem(servidor(0, { colunaFalta: true }).pedir).gravarLote(linhas); } catch (e) { msg = e.message; }
    eq("149) coluna que o banco não tem: erro que diz que SQL e robô divergiram", /divergiram/.test(msg), true);
    const s2 = servidor(0); await E.criarNuvem(s2.pedir).gravarStatus({ chave: "produtos" });
    eq("150) status por upsert na chave", /encarte_sync\?on_conflict=chave/.test(s2.chamadas[0].caminho), true);
  }

  // -------------------------------------------------------------------------------------------
  console.log("\n-- O CÓDIGO: só leitura no VR, nada apaga na nuvem, armadilhas do VR --");
  {
    const sqls = Object.keys(E.SQL).map((k) => E.SQL[k]).join("\n");
    eq("151) nenhuma barra invertida nas consultas (standard_conforming_strings=off no VR)", sqls.indexOf("\\") < 0, true);
    eq("152) nenhuma consulta usa current_date/now() (o servidor do VR está em GMT)", /current_date|now\(\)/i.test(sqls), false);
    eq("153) transação SÓ LEITURA", /BEGIN READ ONLY/.test(FONTE), true);
    eq("154) e desfeita no fim", /ROLLBACK/.test(FONTE), true);
    eq("155) venda: os DOIS filtros de cancelado", /v\.cancelado = false AND cp\.cancelado = false/.test(E.SQL.venda30), true);
    eq("156) venda: sempre filtrando v.data", /v\.data BETWEEN/.test(E.SQL.venda30), true);
    eq("157) venda: loja do CUPOM (pdv.venda)", /cp\.id_loja = \$3/.test(E.SQL.venda30), true);
    eq("158) ativos = id_situacaocadastro 1 na loja", /pc\.id_loja = \$1 AND pc\.id_situacaocadastro = 1/.test(E.SQL.produtos), true);
    eq("159) custo = custocomimposto", /custocomimposto/.test(E.SQL.produtos), true);
    eq("160) código de barras como texto", /codigobarras::text/.test(E.SQL.eans), true);
    eq("161) oferta ativa = situação 1 e hoje dentro do período", /id_situacaooferta = 1/.test(E.SQL.ofertasAtivas) && /datainicio <= \$2::date AND o\.datatermino >= \$2::date/.test(E.SQL.ofertasAtivas), true);
    eq("162) compra = nota finalizada, tipos 0/6/185", /id_situacaonotaentrada = 1/.test(E.SQL.ultimasCompras) && E.SQL.ultimasCompras.indexOf("ANY($2::int[])") > 0, true);
    eq("163) datas saem do VR como texto", /dataentrada::text/.test(E.SQL.ultimasCompras) && /datainicio::text/.test(E.SQL.ultimasOfertas), true);
    eq("164) nenhum DELETE/PATCH na nuvem (nunca apaga)", /["'](DELETE|PATCH)["']/.test(FONTE), false);
    eq("165) marcador ASCII para o puxar-codigo (nome da tabela)", FONTE.indexOf("encarte_produtos_vr") >= 0, true);
    eq("166) sem '??' nem '?.' (Node da loja desconhecido)", /\?\?|\?\.[a-zA-Z_(\[]/.test(FONTE.replace(/\/\/[^\n]*/g, "")), false);
    eq("167) o vigia sai antes dos 240 s do buildVrData", E.PRAZO_TOTAL_MS < 240000, true);
    eq("168) trava e cache em output/", [path.basename(E.ARQ_TRAVA), path.basename(E.ARQ_VENDA30)], ["last-encartes-sync.txt", "encartes-venda30.json"]);
  }

  // -------------------------------------------------------------------------------------------
  if (process.env.ENC_TESTE_VR === "1") {
    console.log("\n-- FUMAÇA CONTRA O VR REAL (modo --seco, só leitura) --");
    const saida = process.env.ENC_TESTE_SAIDA ? path.resolve(process.env.ENC_TESTE_SAIDA) : path.join(os.tmpdir(), "encartes-seco-teste.json");
    try { fs.unlinkSync(saida); } catch (e) { /* não existia */ }
    const antesTrava = fs.existsSync(E.ARQ_TRAVA) ? fs.statSync(E.ARQ_TRAVA).mtimeMs : null;
    const antesCache = fs.existsSync(E.ARQ_VENDA30) ? fs.statSync(E.ARQ_VENDA30).mtimeMs : null;
    const t0 = Date.now();
    const r = require("child_process").spawnSync(process.execPath, [ARQ, "--seco", "--saida=" + saida], { encoding: "utf8", timeout: 240000 });
    const seg = (Date.now() - t0) / 1000;
    process.stdout.write((r.stdout || "").split("\n").map((l) => "     " + l).join("\n") + "\n");
    eq("V1) saiu com código 0", r.status, 0);
    eq("V2) escreveu o arquivo", fs.existsSync(saida), true);
    eq("V3) não mexeu na trava nem no cache do robô", [fs.existsSync(E.ARQ_TRAVA) ? fs.statSync(E.ARQ_TRAVA).mtimeMs : null, fs.existsSync(E.ARQ_VENDA30) ? fs.statSync(E.ARQ_VENDA30).mtimeMs : null], [antesTrava, antesCache]);
    if (fs.existsSync(saida)) {
      const d = JSON.parse(fs.readFileSync(saida, "utf8")), L = d.linhas;
      eq("V4) mais de 10 mil produtos ativos", L.length > 10000, true);
      eq("V5) toda linha com exatamente as colunas da tabela", L.every((l) => Object.keys(l).length === E.COLUNAS.length && E.COLUNAS.every((c) => c in l)), true);
      eq("V6) nenhum custo zero ou negativo (nulo no lugar)", L.filter((l) => l.custo !== null && !(l.custo > 0)).length, 0);
      eq("V7) nenhum preço zero ou negativo", L.filter((l) => [l.preco_atual, l.preco_normal].some((v) => v !== null && !(v > 0))).length, 0);
      eq("V8) não confiável ⇔ setor 42 grupo 1", L.every((l) => l.custo_confiavel === !(l.m1 === 42 && l.m2 === 1)), true);
      eq("V9) em oferta: normal ≥ atual", L.filter((l) => l.em_oferta && l.preco_normal !== null && l.preco_atual !== null && l.preco_normal < l.preco_atual).length, 0);
      eq("V10) todo código de barras é texto de dígitos", L.every((l) => l.eans.every((e) => /^[0-9]+$/.test(e))), true);
      eq("V11) datas no formato AAAA-MM-DD", L.every((l) => l.ultima_compra === null || /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(l.ultima_compra)), true);
      eq("V12) números chegam como número ou nulo (nunca texto)", L.every((l) => ["preco_normal", "preco_atual", "custo", "estoque", "venda30_qtd", "venda30_valor"].every((k) => l[k] === null || typeof l[k] === "number")), true);
      eq("V13) impressão confere ao recalcular", L.slice(0, 500).every((l) => E.impressao(l) === l.impressao), true);
      eq("V14) no máximo 5 fornecedores por produto", L.every((l) => l.fornecedores.length <= 5), true);
      const R = d.resumo;
      eq("V16) a venda de 30 dias veio com produtos vendendo (não 'muda')", R.com_venda30 >= E.MINIMO_COM_VENDA, true);
      console.log("\n     RESUMO DO VR REAL (" + d.hoje + ", venda " + d.venda30.de + " a " + d.venda30.ate + "):");
      console.log("       produtos ativos ......... " + R.linhas);
      console.log("       sem custo no VR ......... " + R.sem_custo);
      console.log("       custo não confiável ..... " + R.nao_confiaveis + "  (setor 42, grupo 1)");
      console.log("       em oferta hoje .......... " + R.em_oferta);
      console.log("       sem preço ............... " + R.sem_preco);
      console.log("       venderam em 30 dias ..... " + R.com_venda30);
      console.log("       sem fornecedor na ficha . " + R.sem_fornecedor);
      console.log("       tempo total ............. " + seg.toFixed(1) + " s (leitura do VR: " + Object.keys(d.tempos).map((k) => k + " " + (d.tempos[k] / 1000).toFixed(1) + "s").join(", ") + ")");
      console.log("       arquivo ................. " + saida);
      const cafes = L.filter((l) => /^CAFE /.test(l.descricao || "") && l.venda30_valor > 0).sort((a, b) => b.venda30_valor - a.venda30_valor).slice(0, 3);
      console.log("\n     3 CAFÉS (os que mais venderam em 30 dias):");
      for (const c of cafes) console.log("       " + JSON.stringify({ id: c.produto_id, descricao: c.descricao, eans: c.eans, grupo: c.grupo,
        preco_normal: c.preco_normal, preco_atual: c.preco_atual, em_oferta: c.em_oferta, custo: c.custo, custo_confiavel: c.custo_confiavel,
        estoque: c.estoque, venda30_qtd: c.venda30_qtd, venda30_valor: c.venda30_valor, ultima_compra: c.ultima_compra,
        ultima_compra_fornecedor: c.ultima_compra_fornecedor, ultima_oferta: c.ultima_oferta, fornecedores: c.fornecedores.length }));
      eq("V15) achou 3 cafés com venda", cafes.length, 3);
    }
  } else console.log("\n  (fumaça contra o VR real pulada — rode com ENC_TESTE_VR=1)");

  // -------------------------------------------------------------------------------------------
  if (process.env.ENC_TESTE_NUVEM === "1") {
    console.log("\n-- ESQUEMA DA NUVEM (só leitura) --");
    const env = fs.readFileSync(path.join(RAIZ, ".env"), "utf8"), g = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim() : ""; };
    const host = new URL(g("SUPABASE_URL")).host, chave = g("SUPABASE_SERVICE_KEY");
    const api = await new Promise((res) => {
      require("https").get({ host, path: "/rest/v1/", headers: { apikey: chave, Authorization: "Bearer " + chave, Accept: "application/openapi+json" } }, (r) => {
        let t = ""; r.on("data", (d) => (t += d)); r.on("end", () => { try { res(JSON.parse(t)); } catch (e) { res(null); } });
      }).on("error", () => res(null));
    });
    const defs = (api && api.definitions) || {};
    const colsNuvem = (t) => (defs[t] ? Object.keys(defs[t].properties || {}) : null);
    const cp = colsNuvem("encarte_produtos_vr"), cs = colsNuvem("encarte_sync");
    eq("N1) encarte_produtos_vr existe na nuvem", !!cp, true);
    if (cp) eq("N2) toda coluna do robô existe na nuvem", E.COLUNAS.filter((c) => cp.indexOf(c) < 0), []);
    eq("N3) encarte_sync existe na nuvem", !!cs, true);
    if (cs) eq("N4) toda coluna do status existe na nuvem", E.COLUNAS_STATUS.filter((c) => cs.indexOf(c) < 0), []);
  }

  console.log("\n" + (falhou ? "FALHOU: " + falhou + " de " + (ok + falhou) : "TUDO OK: " + ok + " testes") + "\n");
  process.exit(falhou ? 1 : 0);
})().catch((e) => { console.log("  FALHA | o teste quebrou: " + (e && e.stack)); process.exit(1); });
