// Avarias · etapa 1 · roda o cálculo sobre a extração e confere tudo contra o próprio VR.
//   node etapa1.cjs [pasta-da-extracao]   -> conferencia.json na mesma pasta
"use strict";
const fs = require("fs");
const path = require("path");
const C = require("./calculo.cjs");
const { n, mes, dias, norm } = C;

function carregar(dir) {
  const D = {};
  for (const f of fs.readdirSync(dir)) if (f.endsWith(".json") && f !== "conferencia.json") D[f.replace(".json", "")] = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  // O VR devolve números grandes (bigint) como texto e os pequenos como número: igualar tudo em número.
  const CHAVES = ["id", "nota_id", "id_produto", "fornecedor", "tipo_id", "situacao", "nfe", "motivo", "tipo", "usuario", "boleto", "tipo_devolucao", "tipo_entrada", "numero", "setor_id", "grupo_id"];
  for (const [nome, lista] of Object.entries(D)) if (Array.isArray(lista)) for (const r of lista)
    for (const k of CHAVES) if (k in r && r[k] !== null && typeof r[k] === "string" && /^-?\d+$/.test(r[k])) r[k] = Number(r[k]);
  return D;
}

function rodar(dir, { ateLinha = null } = {}) {
  const D = carregar(dir);
  if (ateLinha) D.troca = D.troca.filter((l) => l.id <= ateLinha);
  const corte = D.manifesto.corte_vr.slice(0, 10);
  const custoDaData = C.montarCustos(D.custos, D.saldo);
  const notasPorNumero = new Map();
  for (const x of D.notas) { const k = x.numero; if (!notasPorNumero.has(k)) notasPorNumero.set(k, []); notasPorNumero.get(k).push(x); }
  const titulosPorNota = new Map();
  for (const t of D.titulos) { if (!titulosPorNota.has(t.nota_id)) titulosPorNota.set(t.nota_id, []); titulosPorNota.get(t.nota_id).push(t); }
  const motivoPerdaNome = new Map(D.motivos_perda.map((m) => [m.id, m.descricao]));
  const { mapa: exportacaoPorLinha, semPar } = C.ligarExportacoes(D.troca, D.perdas);
  const porProd = new Map();
  for (const l of D.troca) { if (!porProd.has(l.id_produto)) porProd.set(l.id_produto, []); porProd.get(l.id_produto).push(l); }
  const ctx = { custoDaData, notasPorNumero, exportacaoPorLinha, fimDeMes: mes(corte) };
  const sim = [...porProd].map(([p, ls]) => C.simularProduto(p, ls, ctx));
  const saldoVR = new Map(D.saldo.map((s) => [s.id_produto, n(s.saldo)]));
  if (ateLinha) { saldoVR.clear(); for (const s of sim) saldoVR.set(s.prod, s.saldoLivro); }
  const R = { corte: D.manifesto.corte_vr, extracao: D.manifesto.fontes, conf: {} };

  // 1. unidades por produto: fila × livro × saldo do VR
  const difUn = [];
  for (const s of sim) {
    const simulado = s.fila.reduce((a, p) => a + p.qtd, 0) - s.divida;
    const vr = saldoVR.get(s.prod) ?? 0;
    if (Math.abs(simulado - vr) > 1e-6 || Math.abs(s.saldoLivro - vr) > 1e-6) difUn.push({ prod: s.prod, simulado, livro: s.saldoLivro, vr });
  }
  R.conf.unidades = { produtos: sim.length, diferencas: difUn.length, exemplos: difUn.slice(0, 10) };

  // 2. fim de mês: fila × livro (só pode diferir quando uma nota corrigida atravessa a virada do mês)
  const difMes = [];
  for (const s of sim) for (const f of s.ev.fimMes) if (Math.abs(f.qtd - f.livro) > 1e-6) difMes.push({ prod: s.prod, mes: f.mes, fila: f.qtd, livro: f.livro });
  R.conf.fimDeMes = { diferencas: difMes.length, exemplos: difMes.slice(0, 20) };

  // 3. identidade mensal do valor: Δparado = entradas − saídas + C1 + C2 − C3 + C4
  const porMes = new Map();
  const g = (m) => { if (!porMes.has(m)) porMes.set(m, { E: 0, S: 0, C1: 0, C2: 0, C3: 0, C4: 0, parado: 0, dParado: 0, semCusto: 0 }); return porMes.get(m); };
  for (const s of sim) {
    for (const e of s.ev.entradas) { g(e.mes).E += e.qtd * (e.custo || 0); if (e.custo === null) g(e.mes).semCusto++; }
    for (const x of s.ev.saidas) g(x.mes).S += x.tomados.reduce((a, t) => a + t.qtd * (t.custo || 0), 0) + x.semSaldo * (x.custoSaida || 0);
    for (const c of s.ev.componentes) { const k = "C" + c.comp; g(c.mes)[k] += c.valor; if (c.semCusto) g(c.mes).semCusto++; }
    let ant = 0;
    for (const f of s.ev.fimMes) { g(f.mes).parado += f.valor; g(f.mes).dParado += f.valor - ant; ant = f.valor; }
  }
  const meses = [...porMes.keys()].sort();
  let maxResid = 0;
  const tabelaMes = meses.map((m) => {
    const x = porMes.get(m);
    const explicado = x.E - x.S + x.C1 + x.C2 - x.C3 + x.C4;
    const resid = x.dParado - explicado; maxResid = Math.max(maxResid, Math.abs(resid));
    return { mes: m, entradas: x.E, saidas: x.S, C1: x.C1, C2: x.C2, C3: x.C3, C4: x.C4, parado: x.parado, variacao: x.dParado, diferenca_nao_explicada: resid, sem_custo: x.semCusto };
  });
  R.conf.identidade = { maior_diferenca_nao_explicada: maxResid, meses: tabelaMes };
  const comp = { 1: { qtdPos: 0, qtdNeg: 0, casos: 0, produtos: new Set(), valor: 0 }, 2: { qtd: 0, casos: 0, valor: 0 }, 3: { qtd: 0, casos: 0, valor: 0 }, 4: { qtd: 0, casos: 0, valor: 0 } };
  for (const s of sim) for (const c of s.ev.componentes) {
    const k = comp[c.comp]; k.casos++; k.valor += c.valor;
    if (c.comp === 1) { k.produtos.add(c.prod); if (c.qtd > 0) k.qtdPos += c.qtd; else k.qtdNeg += c.qtd; } else k.qtd += c.qtd;
  }
  comp[1].produtos = comp[1].produtos.size;
  R.conf.componentes = comp;

  // 4. parado agora: fila × método independente (entradas mais recentes cobrindo o saldo do VR)
  const parado = { produtos: 0, unidades: 0, valor: 0, faixas: {} }; let valorIndep = 0; const difParado = [];
  const faixa = (d) => (d <= 30 ? "0-30" : d <= 60 ? "31-60" : d <= 90 ? "61-90" : d <= 180 ? "91-180" : d <= 365 ? "181-365" : "365+");
  for (const s of sim) {
    const vr = saldoVR.get(s.prod) ?? 0;
    if (vr <= 0) continue;
    const vFila = s.fila.reduce((a, p) => a + p.qtd * (p.custo || 0), 0);
    parado.produtos++; parado.unidades += vr; parado.valor += vFila;
    for (const p of s.fila) { const f = faixa(dias(p.data, corte)); parado.faixas[f] = (parado.faixas[f] || 0) + p.qtd * (p.custo || 0); }
    let resta = vr, v = 0;
    for (const e of s.ev.entradas.slice().sort((a, b) => b.linha - a.linha)) { if (resta <= 1e-9) break; const a = Math.min(e.qtd, resta); v += a * (e.custo || 0); resta -= a; }
    valorIndep += v;
    if (Math.abs(v - vFila) > 0.005 || resta > 1e-9) difParado.push({ prod: s.prod, fila: vFila, independente: v, semEntrada: resta });
  }
  R.conf.parado = { ...parado, valor_metodo_independente: valorIndep, diferencas: difParado.length, exemplos: difParado.slice(0, 10) };
  const negativos = D.saldo.filter((s) => n(s.saldo) < 0);
  R.conf.saldo_negativo = { produtos: negativos.length, unidades: negativos.reduce((a, s) => a + n(s.saldo), 0) };

  // 5. fila B: títulos abertos das devoluções da troca
  const notaPorId = new Map(D.notas.map((x) => [x.id, x]));
  const abertos = D.titulos.filter((t) => t.situacao === 0 && [2, 33].includes((notaPorId.get(t.nota_id) || {}).tipo_id));
  R.conf.filaB = {
    titulos: abertos.length, valor: abertos.reduce((a, t) => a + n(t.valor), 0), fornecedores: new Set(abertos.map((t) => t.fornecedor)).size,
    vencidos: abertos.filter((t) => t.vencimento < corte).length,
    vencido_90: abertos.filter((t) => dias(t.vencimento, corte) > 90).reduce((a, t) => a + n(t.valor), 0),
    mais_antigo: abertos.map((t) => t.emissao).sort()[0],
  };

  // 6. notas canceladas e corrigidas (vai-e-volta)
  const itensPor = new Map();
  for (const i of D.itens) { const k = i.nota_id + "|" + i.id_produto; itensPor.set(k, (itensPor.get(k) || 0) + n(i.qtd) * (n(i.embalagem) || 1)); }
  const itensSemEmb = new Map();
  for (const i of D.itens) { const k = i.nota_id + "|" + i.id_produto; itensSemEmb.set(k, (itensSemEmb.get(k) || 0) + n(i.qtd)); }
  const notasEstorno = new Map(), voltaMaior = [];
  for (const [p, ls] of porProd) for (const [num, gr] of C.agruparNotas(ls)) {
    if (gr.saidas > 0 && gr.entradas > gr.saidas + 1e-9) voltaMaior.push({ prod: p, nota: gr.numero });
    if (gr.entradas <= 0 || gr.saidas <= 0) continue;
    const nota = C.acharNota(notasPorNumero, gr.numero, (gr.primeira || {}).data || corte);
    const k = nota ? nota.id : "?" + num;
    if (!notasEstorno.has(k)) notasEstorno.set(k, { nota, pares: [] });
    notasEstorno.get(k).pares.push({ prod: p, liquido: gr.saidas - gr.entradas });
  }
  const canc = [], corr = [], outras = [];
  for (const [k, v] of notasEstorno) {
    const nfe = v.nota ? v.nota.nfe : null;
    if (nfe === 3 || nfe === 4) {
      const ok = v.pares.every((x) => Math.abs(x.liquido) < 1e-6);
      canc.push({ nota: v.nota.numero, nfe, pares: v.pares.length, zerou: ok });
    } else if (nfe === 1) {
      const ok = v.pares.every((x) => { const a = itensPor.get(v.nota.id + "|" + x.prod) || 0, b = itensSemEmb.get(v.nota.id + "|" + x.prod) || 0; return Math.abs(x.liquido - a) < 1e-6 || Math.abs(x.liquido - b) < 1e-6; });
      corr.push({ nota: v.nota.numero, pares: v.pares.length, bate_com_itens: ok, tipo: v.nota.tipo });
    } else outras.push({ nota: v.nota ? v.nota.numero : k, nfe });
  }
  R.conf.notas_estorno = {
    canceladas_ou_inutilizadas: canc.length, canceladas_zeradas: canc.filter((x) => x.zerou).length,
    corrigidas_autorizadas: corr.length, corrigidas_batem_com_itens: corr.filter((x) => x.bate_com_itens).length,
    corrigidas_que_nao_batem: corr.filter((x) => !x.bate_com_itens), outras,
    lista_corrigidas: corr.map((x) => x.nota), lista_canceladas: canc.map((x) => x.nota), volta_maior_que_saida: voltaMaior,
  };

  // 7. custo histórico: nas linhas que vieram com custo, o histórico repete o custo gravado?
  let comCusto = 0, igual = 0;
  for (const l of D.troca) { const c = n(l.custo); if (!(c > 0)) continue; comCusto++; const h = custoDaData(l.id_produto, l.datahora, null); if (h.custo !== null && Math.abs(h.custo - c) < 0.00005) igual++; }
  const fontes = {};
  for (const s of sim) for (const e of s.ev.entradas) fontes[e.fonte] = (fontes[e.fonte] || 0) + 1;
  R.conf.custo = { linhas_com_custo: comCusto, historico_igual: igual, pct: (100 * igual) / comCusto, fontes_das_entradas: fontes };

  // 7b. custo ESTIMADO (custo de hoje, sem histórico): quanto de cada total depende dele. Nunca fica calado dentro do "custo da data".
  const EST = "hoje_estimado", SEM = "sem_custo";
  const ents = sim.flatMap((s) => s.ev.entradas), est = ents.filter((e) => e.fonte === EST), sem = ents.filter((e) => e.fonte === SEM);
  const temHist = new Set(D.custos.map((c) => c.id_produto));
  const porMesEst = {}; for (const e of est) { porMesEst[e.mes] = porMesEst[e.mes] || { entradas: 0, valor: 0 }; porMesEst[e.mes].entradas++; porMesEst[e.mes].valor += e.qtd * e.custo; }
  const compsAll = sim.flatMap((s) => s.ev.componentes), compEst = {};
  for (const k of [1, 2, 3, 4]) { const cs = compsAll.filter((c) => c.comp === k && c.fonte === EST); compEst[k] = { casos: cs.length, valor: cs.reduce((a, c) => a + c.valor, 0), sem_custo: compsAll.filter((c) => c.comp === k && c.semCusto).length }; }
  const sai = sim.flatMap((s) => s.ev.saidas);
  const paradoEst = { valor: 0, unidades: 0, produtos: new Set(), sem_custo_unidades: 0 };
  for (const s of sim) { if ((saldoVR.get(s.prod) ?? 0) <= 0) continue; for (const p of s.fila) { if (p.fonte === EST) { paradoEst.valor += p.qtd * p.custo; paradoEst.unidades += p.qtd; paradoEst.produtos.add(s.prod); } if (p.custo === null) paradoEst.sem_custo_unidades += p.qtd; } }
  const semFonte = sim.reduce((a, s) => a + s.fila.filter((p) => !p.fonte).length, 0);
  R.conf.custo_estimado = {
    historico_comeca_em: D.custos.reduce((m, c) => (c.datahora < m ? c.datahora : m), "9999"),
    entradas: est.length, valor: est.reduce((a, e) => a + e.qtd * e.custo, 0), unidades: est.reduce((a, e) => a + e.qtd, 0), produtos: new Set(est.map((e) => e.prod)).size,
    com_custo_na_linha: est.filter((e) => n((D.troca.find((l) => l.id === e.linha) || {}).custo) > 0).length,
    custo_da_linha_nulo: est.filter((e) => (D.troca.find((l) => l.id === e.linha) || {}).custo == null).length,
    custo_da_linha_zero: est.filter((e) => { const c = (D.troca.find((l) => l.id === e.linha) || {}).custo; return c != null && n(c) === 0; }).map((e) => ({ linha: e.linha, prod: e.prod })),
    produtos_sem_nenhum_historico: est.filter((e) => !temHist.has(e.prod)).length,
    por_mes: porMesEst, componentes: compEst,
    saidas_de_partes_estimadas: sai.reduce((a, x) => a + x.tomados.filter((t) => t.fonte === EST).reduce((b, t) => b + t.qtd * t.custo, 0), 0),
    saidas_sem_saldo_estimadas: sai.filter((x) => x.fonteSaida === EST).reduce((a, x) => a + x.semSaldo * x.custoSaida, 0),
    parado: { valor: paradoEst.valor, unidades: paradoEst.unidades, produtos: paradoEst.produtos.size, sem_custo_unidades: paradoEst.sem_custo_unidades },
    avaria_2025: ents.filter((e) => e.classe === "avaria" && e.mes.startsWith("2025") && e.fonte === EST).reduce((a, e) => a + e.qtd * e.custo, 0),
    sem_custo: { entradas: sem.length, unidades: sem.reduce((a, e) => a + e.qtd, 0), produtos: [...new Set(sem.map((e) => e.prod))], meses: [...new Set(sem.map((e) => e.mes))].sort(),
      unidades_que_sairam_sem_valor: sai.reduce((a, x) => a + x.tomados.filter((t) => t.custo === null).reduce((b, t) => b + t.qtd, 0), 0) },
    partes_sem_fonte: semFonte,
  };

  // 8. números de referência dos passos anteriores
  const av2025 = sim.flatMap((s) => s.ev.entradas).filter((e) => e.classe === "avaria" && e.mes.startsWith("2025"));
  R.conf.referencias = { entrou_avaria_2025: av2025.reduce((a, e) => a + e.qtd * (e.custo || 0), 0), entradas_avaria_2025: av2025.length };
  const nega = /N(A|Ã)O (E|É|FAZ) AVARIA|MAIS NAO E AVARIA/;
  const direta = D.perdas.filter((p) => !norm(p.obs).startsWith("EXPORTACAO TROCA") && norm(p.obs).includes("AVARIA") && !nega.test(norm(p.obs)));
  R.conf.referencias.perda_direta_2025 = direta.filter((p) => p.data.startsWith("2025")).reduce((a, p) => a + n(p.qtd) * n(p.custo), 0);
  R.conf.referencias.perda_direta_linhas = direta.length;
  R.conf.exportacoes = { ligadas: exportacaoPorLinha.size, sem_par: semPar.length };

  // 9. saídas classificadas (grupo e nível), por ano
  const cls = { notasPorNumero, titulosPorNota, motivoPerdaNome };
  const saidas = [];
  for (const s of sim) for (const x of s.ev.saidas) {
    const c = C.classificarSaida(x, cls);
    saidas.push({ ...x, ...c, valor: x.tomados.reduce((a, t) => a + t.qtd * (t.custo || 0), 0) + x.semSaldo * (x.custoSaida || 0) });
  }
  const resumoSaidas = {};
  for (const x of saidas) { const a = x.mes.slice(0, 4); const k = `${a}|${x.grupo}|${x.nivel || "-"}`; resumoSaidas[k] = (resumoSaidas[k] || 0) + x.valor; }
  R.conf.saidas = resumoSaidas;

  // 10. fila C (a partir de 08/05/2026): notas sem título aberto, não assumidas, autorizadas
  const filaC = [];
  for (const nota of D.notas) {
    if (nota.data < C.INICIO_FILA_C || nota.nfe !== 1) continue;
    const tits = titulosPorNota.get(nota.id) || [];
    if (tits.some((t) => t.situacao === 0)) continue;
    if (tits.some((t) => t.situacao === 1)) continue;                      // baixado = comprovado
    const f = C.formaDoTexto(nota.texto);
    if (C.tipoDaNota(nota) === "baixa_perda" && f.assumido) continue;
    filaC.push({ nota: nota.numero, data: nota.data, tipo: nota.tipo_id, valor: n(nota.valor), forma: f.forma, duvida: f.duvida, cancelado: tits.some((t) => t.situacao === 2) });
  }
  const porTipo = {}; for (const x of filaC) porTipo[x.tipo] = (porTipo[x.tipo] || 0) + 1;
  R.conf.filaC = { notas: filaC.length, valor: filaC.reduce((a, x) => a + x.valor, 0), por_tipo: porTipo, declaradas: filaC.filter((x) => x.forma).length, nao_identificadas: filaC.filter((x) => !x.forma).length };

  // 11. mais de uma linha do mesmo produto na mesma nota
  const cont = new Map(); for (const i of D.itens) { const k = i.nota_id + "|" + i.id_produto; cont.set(k, (cont.get(k) || 0) + 1); }
  const rep = [...cont].filter(([, v]) => v > 1);
  R.conf.linhas_repetidas = { pares: rep.length, notas: new Set(rep.map(([k]) => k.split("|")[0])).size };

  return { R, sim, saidas, filaC, D };
}

module.exports = { rodar, carregar };

if (require.main === module) {
  const base = (process.env.AVR_DADOS || path.join(__dirname, "..", "..", ".previa", "avarias", "dados"));
  const dir = process.argv[2] || path.join(base, fs.readdirSync(base).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().pop());
  const { R } = rodar(dir);
  fs.writeFileSync(path.join(dir, "conferencia.json"), JSON.stringify(R, null, 1));
  const f = (v) => (typeof v === "number" ? v.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : v);
  const c = R.conf;
  console.log("corte", R.corte);
  console.log("unidades: produtos", c.unidades.produtos, "diferenças", c.unidades.diferencas);
  console.log("fim de mês: diferenças", c.fimDeMes.diferencas);
  console.log("identidade: maior diferença não explicada R$", f(c.identidade.maior_diferenca_nao_explicada));
  console.log("componentes:", JSON.stringify(c.componentes));
  console.log("parado:", c.parado.produtos, "produtos,", f(c.parado.unidades), "un, R$", f(c.parado.valor), "| independente R$", f(c.parado.valor_metodo_independente), "| diferenças", c.parado.diferencas);
  console.log("saldo negativo:", JSON.stringify(c.saldo_negativo));
  console.log("fila B:", JSON.stringify(c.filaB));
  console.log("estornos:", JSON.stringify({ ...c.notas_estorno, corrigidas_que_nao_batem: c.notas_estorno.corrigidas_que_nao_batem.length }));
  console.log("custo:", JSON.stringify(c.custo));
  console.log("referências:", JSON.stringify(c.referencias), JSON.stringify(c.exportacoes));
  console.log("fila C:", JSON.stringify(c.filaC));
  console.log("linhas repetidas:", JSON.stringify(c.linhas_repetidas));
}
