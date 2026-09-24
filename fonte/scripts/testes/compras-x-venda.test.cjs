// Testes do COMPRA × VENDA — o cálculo que diz quanto cada setor ainda pode comprar.
// Roda a função DE VERDADE (scripts/compras-x-venda/calculo.cjs), com semanas montadas
// à mão onde a resposta certa é conhecida, e depois confere o arquivo real extraído do VR
// contra os números medidos à parte em 23/09/2026.
//   node scripts/testes/compras-x-venda.test.cjs
const fs = require("fs"), path = require("path");
const C = require(path.join(__dirname, "..", "compras-x-venda", "calculo.cjs"));

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + obtido + (bate ? "" : "   (esperado: " + esperado + ")"));
  bate ? ok++ : falhou++;
}
const V = (o) => Object.assign({ venda: 0, cmv_sem: 0, cmv_com: 0, sem_custo: 0, venda_sem_custo: 0, recebido: 0, nao_fin: 0, bonif: 0, devol: 0, recl_ent: 0, recl_sai: 0 }, o);
// Semana-base 07–13/09, semana medida 14–20/09 (fechada), semana atual 21–27/09 (hoje quarta, 23/09).
function dados(extra) {
  return Object.assign({
    hoje: "2026-09-23", semanaAtual: "2026-09-21", toleranciaDias: 14,
    setores: { 1: "NOVO - MERCEARIA", 2: "NOVO ACOUGUE", 3: "NOVO PADARIA", 9: "NOVO DESPESA" },
    ritmo: [0.2, 0.4, 0.6, 0.8, 0.95, 1, 1],
    mapa: [], pendenciasSetor: {}, naoFinalizadas: [], pedidos: [],
    semanas: [
      { ini: "2026-09-07", setores: { 1: V({ venda: 100000, cmv_sem: 70000, cmv_com: 70000 }), 2: V({ venda: 50000, cmv_sem: 37500, cmv_com: 40000 }) } },
      { ini: "2026-09-14", setores: { 1: V({ venda: 90000, cmv_sem: 63000, cmv_com: 63000, recebido: 60000, devol: 1000, bonif: 800 }), 2: V({ recebido: 30000 }) } },
      { ini: "2026-09-21", setores: { 1: V({ recebido: 20000 }) } }
    ]
  }, extra || {});
}
const conf = { 1: { margemObjetivo: 30, permiteEstoque: true }, 2: { margemObjetivo: 25, permiteEstoque: false } };
const linha = (R, s) => R.linhas.find((L) => L.setor === String(s));
const semFator = Object.assign({}, C.CXV_CFG, { fatorImposto: false });

console.log("\n-- A REGRA DO DONO: vendeu 100 mil com margem 30% → pode comprar 70 mil --");
{
  const R = C.calcularSemana(dados(), conf, "2026-09-14", semFator);
  const m = linha(R, 1);
  eq("orçamento Mercearia", m.orcamento, 70000);
  eq("DEVOLUÇÃO abate: 60.000 − 1.000", m.recebido, 59000);
  eq("BONIFICAÇÃO não é compra (fica à parte)", m.bonificacao, 800);
  eq("disponível = 70.000 − 59.000", m.disponivel, 11000);
  eq("% utilizado", m.pctUtilizado, 84.29);
  eq("semana fechada não tem comprometido (não existe foto do passado)", m.comprometido, null);
  eq("status", m.status.cod, "ok");
}

console.log("\n-- MARGEM AUSENTE NÃO É ZERO --");
{
  const R = C.calcularSemana(dados(), { 1: { margemObjetivo: null } }, "2026-09-14", semFator);
  const m = linha(R, 1);
  eq("sem margem objetivo → orçamento null (0% liberaria tudo)", m.orcamento, null);
  eq("disponível também null", m.disponivel, null);
  eq("status diz o motivo", m.status.txt, "Margem objetivo não definida");
  const R2 = C.calcularSemana(dados(), { 1: { margemObjetivo: "" } }, "2026-09-14", semFator);
  eq("campo em branco ('') também é 'não definida'", linha(R2, 1).orcamento, null);
  const R3 = C.calcularSemana(dados(), { 1: { margemObjetivo: 0 } }, "2026-09-14", semFator);
  eq("zero digitado vale zero (é escolha, não ausência)", linha(R3, 1).orcamento, 100000);
  eq("total da loja avisa que está incompleto", R.total.completo, false);
  eq("setor sem orçamento não entra no orçamento da loja", R.total.orcamento, 0);
}

console.log("\n-- MARGEM REAL É SÓ COMPARAÇÃO --");
{
  const R = C.calcularSemana(dados(), conf, "2026-09-14", semFator);
  eq("margem real Açougue (1 − 37.500/50.000)", linha(R, 2).margemReal, 25);
  const R2 = C.calcularSemana(dados(), { 2: { margemObjetivo: 35 } }, "2026-09-14", semFator);
  eq("orçamento usa a OBJETIVO (35%), não a real (25%)", linha(R2, 2).orcamento, 32500);
  eq("diferença > 5 p.p. vira aviso", linha(R2, 2).alertas.some((a) => a.tipo === "margem"), true);
}

console.log("\n-- FATOR DE IMPOSTO: orçamento na mesma base da nota --");
{
  const R = C.calcularSemana(dados(), conf, "2026-09-14");
  eq("Açougue: 50.000 × 0,75 × (40.000/37.500)", linha(R, 2).orcamento, 40000);
  eq("Mercearia sem diferença de imposto: fator 1", linha(R, 1).orcamento, 70000);
}

console.log("\n-- ESTOURO: com estoque = Estocando; sem estoque = investigar --");
{
  const d = dados(); d.semanas[1].setores[2].recebido = 45000;
  const R = C.calcularSemana(d, conf, "2026-09-14", semFator);
  eq("Açougue 45.000 sobre 37.500 (não permite estoque)", linha(R, 2).status.cod, "divergencia");
  d.semanas[1].setores[1].recebido = 90000;
  eq("Mercearia estourada (permite estoque)", C.calcularSemana(d, conf, "2026-09-14", semFator).linhas.find((L) => L.setor === "1").status.cod, "estocando");
  eq("sem saber se permite estoque: 'acima', sem adivinhar", C.calcularSemana(d, { 1: { margemObjetivo: 30 } }, "2026-09-14", semFator).linhas.find((L) => L.setor === "1").status.cod, "acima");
}

console.log("\n-- SEMANA FECHADA ABAIXO DE 60%: alerta, não diagnóstico --");
{
  const R = C.calcularSemana(dados(), conf, "2026-09-14", semFator);
  eq("Açougue comprou 30.000 de 37.500 = 80%", linha(R, 2).pctUtilizado, 80);
  const d = dados(); d.semanas[1].setores[2].recebido = 15000;
  eq("15.000 de 37.500 = 40% → conferir estoque", C.calcularSemana(d, conf, "2026-09-14", semFator).linhas.find((L) => L.setor === "2").status.cod, "baixo");
}

console.log("\n-- NOTA NÃO FINALIZADA fica FORA do recebido --");
{
  const d = dados({ naoFinalizadas: [{ id: 7, numero: 123, forn: "X", entrada: "2026-09-22", valor: 5000, setores: { 1: 5000 } },
                                     { id: 8, numero: 124, forn: "Y", entrada: "2026-09-10", valor: 700, setores: { 1: 700 } }] });
  d.semanas[2].setores[1].nao_fin = 5000; // a extração também traz o não finalizado por semana
  const R = C.calcularSemana(d, conf, "2026-09-21", semFator);
  const m = linha(R, 1);
  eq("recebido continua só o finalizado", m.recebido, 20000);
  eq("não finalizado da semana + a parada de antes", m.naoFinalizado, 5700);
  eq("vira aviso no setor", m.alertas.some((a) => a.tipo === "naofin"), true);
  const Rf = C.calcularSemana(d, conf, "2026-09-07", semFator);
  eq("semana passada vê só a nota dela", (Rf.linhas.find((L) => L.setor === "1") || {}).naoFinalizado, 700);
}

console.log("\n-- NOTA COM VÁRIOS SETORES: cada pedaço vai para o seu --");
{
  const d = dados({ naoFinalizadas: [{ id: 9, entrada: "2026-09-23", valor: 3000, setores: { 1: 1000, 2: 2000 } }] });
  const R = C.calcularSemana(d, conf, "2026-09-21", semFator);
  eq("Mercearia leva 1.000", linha(R, 1).naoFinalizado, 1000);
  eq("Açougue leva 2.000", linha(R, 2).naoFinalizado, 2000);
}

console.log("\n-- COMPROMETIDO: só pedido válido e pendente, só na semana atual --");
{
  const d = dados({ pedidos: [
    { id: 1, classe: "comprometido", setores: { 1: 4000 } },
    { id: 2, classe: "futuro", setores: { 1: 9000 } },
    { id: 3, classe: "antigo_sem_nota", setores: { 1: 500000 } },
    { id: 4, classe: "sobra_parcial", ultNota: "2026-09-20", setores: { 1: 3000 } } ] });
  const R = C.calcularSemana(d, conf, "2026-09-21", semFator);
  const m = linha(R, 1);
  eq("comprometido = só o pedido pendente válido", m.comprometido, 4000);
  eq("pedido de semana que vem fica à parte", m.futuro, 9000);
  eq("os R$ 500 mil antigos NÃO contaminam", m.disponivel, 70000 * 90000 / 100000 - 20000 - 4000);
  const cfgSobra = Object.assign({}, semFator, { sobraRecenteCompromete: true });
  eq("se o dono decidir, sobra recente passa a comprometer", linha(C.calcularSemana(d, conf, "2026-09-21", cfgSobra), 1).comprometido, 7000);
  const d2 = JSON.parse(JSON.stringify(d)); d2.pedidos[3].ultNota = "2026-08-01";
  eq("…mas sobra velha nunca", linha(C.calcularSemana(d2, conf, "2026-09-21", cfgSobra), 1).comprometido, 4000);
}

console.log("\n-- RECLASSIFICAÇÃO muda o valor de setor; a loja não muda --");
{
  const d = dados(); d.semanas[1].setores[1].recl_sai = 2000; d.semanas[1].setores[2].recl_ent = 2000;
  const R = C.calcularSemana(d, conf, "2026-09-14", semFator);
  eq("Mercearia perde 2.000", linha(R, 1).recebido, 57000);
  eq("Açougue ganha 2.000", linha(R, 2).recebido, 32000);
  eq("total da loja igual", R.total.recebido, 89000);
}

console.log("\n-- RITMO DO DIA: quarta é 60% da semana, não 3/7 --");
{
  const d = dados(); d.semanas[2].setores[1].recebido = 55000; // 55.000 de 63.000 = 87% na quarta
  const R = C.calcularSemana(d, conf, "2026-09-21", semFator);
  eq("esperado até quarta", R.esperado, 60);
  eq("87% recebido na quarta, esperado 60% → acima do ritmo", linha(R, 1).status.cod, "adiantado");
  d.semanas[2].setores[1].recebido = 38000; // 60%
  eq("60% na quarta → no ritmo", linha(C.calcularSemana(d, conf, "2026-09-21", semFator), 1).status.cod, "ok");
}

console.log("\n-- ARQUIVO REAL DO VR bate com o medido à parte (23/09/2026) --");
{
  const arq = path.join(__dirname, "..", "..", ".previa", "cxv-dados.json");
  if (!fs.existsSync(arq)) console.log("  (pulado: rode scripts/compras-x-venda/extrair-vr.cjs na rede da loja)");
  else {
    const d = JSON.parse(fs.readFileSync(arq, "utf8"));
    const s = (ini, f) => Math.round(Object.values(d.semanas.find((x) => x.ini === ini).setores).reduce((a, x) => a + x[f], 0));
    eq("venda 07–13/09 = total medido item a item", s("2026-09-07", "venda"), 1087897);
    eq("custo sem imposto 07–13/09", s("2026-09-07", "cmv_sem"), 739422);
    eq("custo com imposto 07–13/09", s("2026-09-07", "cmv_com"), 837963);
    eq("compra finalizada 14–20/09 (tipos 0, 6, 185)", s("2026-09-14", "recebido"), 752753);
    eq("não finalizada 14–20/09", s("2026-09-14", "nao_fin"), 36098);
    eq("bonificação 14–20/09", s("2026-09-14", "bonif"), 1654);
    eq("devolução 14–20/09 (tipos 2 e 41)", s("2026-09-14", "devol"), 1943);
    eq("reclassificação: entra = sai", s("2026-09-14", "recl_ent"), s("2026-09-14", "recl_sai"));
    eq("BOI UND está no Açougue gerencial", d.setores[d.mapa.find((x) => x.id === 20779).ger], "NOVO ACOUGUE");
    eq("nenhum produto do mapa trocado para o mesmo setor", d.mapa.filter((x) => x.vr === x.ger).length, 0);
    const R14 = C.calcularSemana(d, {}, "2026-09-14");
    eq("recebido líquido da loja 14–20/09 pelo cálculo (752.752,86 − 1.943,43)", Math.round(R14.total.recebido), 750809);
    const R = C.calcularSemana(d, {}, "2026-09-21");
    eq("sem configuração nenhuma: nenhum orçamento inventado", R.linhas.filter((L) => L.orcamento !== null).length, 0);
  }
}

console.log("\n" + ok + " OK, " + falhou + " falha(s)");
process.exit(falhou ? 1 : 0);
