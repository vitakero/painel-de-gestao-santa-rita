// CALENDÁRIO: o Final de semana de ofertas virou PROMOÇÃO PRÓPRIA (==CALFDS==).
//
// POR QUE ESTE TESTE EXISTE. Em 10/10/2026 o dono decidiu: o "Final de semana de ofertas" deixa de
// ser o grupo "fim-de-semana" do modelo da Promoção Semanal (PS) e vira promoção própria, com encarte
// próprio (regra "final-de-semana" em calendario_regras + modelo próprio em encarte_modelos). No
// Calendário o visual tem de ficar IGUAL ao de antes — nome, cor, a etiqueta logo depois da PS, o Ano
// pintando sexta, sábado e domingo abaixo das outras campanhas e acima da PS, a legenda logo depois da
// PS — nos dois estados da nuvem (antes e depois do SQL) e na TRANSIÇÃO (cópia guardada no navegador
// sem a linha nova + modelos já sem o grupo). A ÚNICA diferença permitida no Mês: a etiqueta da
// campanha própria mostra a contagem "x/6" e abre a edição dela.
//
// O projeto não tem git: o "antes" é um RETRATO tirado do código de 10/10/2026, ANTES da mudança, com
// os dados REAIS da nuvem (apoio/calendario-fds-nuvem-antes.json, lido só para leitura). A Sexta da
// Carne está ATIVA nesse retrato — é ela que faz a ordem da sexta importar: com as regras padrão do
// código (onde ela está pausada), tirar o encaixe do FDS logo depois da PS passaria verde.
//
// As funções do Calendário são RECORTADAS do demoDashboard.ts por MARCAS de texto (nunca por número de
// linha: com qualquer edição as linhas andam) e RODADAS com o motor de verdade (scripts/encartes/
// calculo.cjs). Grep não é executar.
//
//   node scripts/testes/calendario-fds.test.cjs
//   CAL_PAINEL=/caminho/de/uma/copia.ts node scripts/testes/calendario-fds.test.cjs   (prova com cópia estragada)
//   CAL_SQL=/caminho/de/um/rascunho.sql node scripts/testes/calendario-fds.test.cjs   (confere o id com outro SQL)
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const RAIZ = path.join(__dirname, "..", "..");
const ARQ_PAINEL = process.env.CAL_PAINEL || path.join(RAIZ, "scripts", "demoDashboard.ts");
const ARQ_MOTOR = path.join(RAIZ, "scripts", "encartes", "calculo.cjs");
const ARQ_NUVEM = path.join(__dirname, "apoio", "calendario-fds-nuvem-antes.json");
const ARQ_RETRATO = path.join(__dirname, "apoio", "calendario-fds-antes.json");
const ARQ_SQL = process.env.CAL_SQL || path.join(RAIZ, "sql", "encartes_final_de_semana.sql");
const ANOS = [2026, 2027, 2028];
const NOME_FDS = "Final de semana de ofertas";

/* ======================= O CALENDÁRIO RECORTADO ======================= */
function trecho(src, ini, fim) {
  const a = src.indexOf(ini);
  if (a < 0) throw new Error("marca não achada no painel: " + JSON.stringify(ini));
  const b = src.indexOf(fim, a + ini.length);
  if (b < 0) throw new Error("marca do fim não achada no painel: " + JSON.stringify(fim));
  return src.slice(a, b);
}
// Cada trecho vai de uma marca até a seguinte. Quem mexer no Calendário mantém estas marcas.
const MARCAS = [
  // listas, cópia guardada (==CALCACHE==), ocorrências, Final de semana, campanhasDoDia, itensDoDia, feriados, células
  ["var CAL_REGRAS = (window.ENC", "// Operação: as ETAPAS reais"],
  // avisos de coincidência, cor de cada campanha (corCampanha) e cor da letra (calTextoCor)
  ["function calCoincidenciasAno(ano){", "const corSetor="],
  // destaque da legenda + montarLegendas (sem a chamada solta que vem logo depois)
  ["let destaque=null;", "\nmontarLegendas();"],
  ["function renderMes(){", "function renderAno(){"],
  ["function calPintaDoDia(camps){", "function calImpressaoHtml(){"],
  // leitura da nuvem (guarda o par regras + modelos no navegador)
  ["var _calNuvemTent = 0;", "// ---- Campanhas e datas"],
];
const AJUDANTES = `
;this.__estado=function(regras,modelos,edicoes){ if(regras) CAL_REGRAS=regras; if(modelos) CAL_MODELOS=modelos; CAL_EDICOES=edicoes||[]; calInvalidar(); };
this.__listas=function(){ return {regras:CAL_REGRAS, modelos:CAL_MODELOS}; };
this.__itens=function(a,m,d){ return itensDoDia(a,m,d,new Date(a,m,d).getDay()); };
this.__pinta=function(a,m,d){ var p=calPintaDoDia(itensDoDia(a,m,d,new Date(a,m,d).getDay())); return p?[p.nome,corCampanha(p.nome)]:null; };
this.__mesHtml=function(a,m){ calAno=a; calMes=m; renderMes(); return document.getElementById("calDias").innerHTML; };
this.__legenda=function(){ montarLegendas(); var r={}; ["calLegSetores","calLegDatas","calLegUser"].forEach(function(id){ var e=document.getElementById(id); r[id]={display:e.style.display, html:e.innerHTML}; }); return r; };
this.__tipo=function(n){ try{ return typeof eval(n); }catch(e){ return "inexistente"; } };
`;
function montar(src, ENC, op) {
  op = op || {};
  const guardado = Object.assign({}, op.guardado || {});
  const els = {};
  function el(id) {
    return els[id] || (els[id] = { id, style: {}, innerHTML: "", textContent: "", addEventListener() {}, querySelectorAll() { return []; },
      classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } } });
  }
  const janela = { ENC };
  const ctx = {
    window: janela,
    localStorage: {
      getItem(k) { if (op.armazemQuebrado) throw new Error("armazém bloqueado"); return Object.prototype.hasOwnProperty.call(guardado, k) ? guardado[k] : null; },
      setItem(k, v) { if (op.armazemQuebrado) throw new Error("armazém bloqueado"); guardado[k] = String(v); },
      removeItem(k) { delete guardado[k]; },
    },
    document: { getElementById: el, querySelector() { return null; }, querySelectorAll() { return []; }, addEventListener() {} },
    setTimeout() { return 0; },
    console,
  };
  const preludio = [
    trecho(src, "const MESES=[", "\n"),
    trecho(src, "function pxEsc(s){", "\n"),
    "var HOJE=new Date(2026,9,10), calAno=2026, calMes=0, calView='mes', calModo='campanhas';",
    "var OP_STEPS=['Começar','Definir','Aprovar','No ar'], OP_STEP_COR={'Começar':'#1c7ed6','Definir':'#e8a800','Aprovar':'#2f9e44','No ar':'#c2255c'};",
    "function calOperacaoMapa(){ return {}; } function renderCal(){} function ccRenderLista(){}",
  ].join("\n");
  vm.createContext(ctx);
  vm.runInContext(preludio + "\n" + MARCAS.map(([a, b]) => trecho(src, a, b)).join("\n;\n") + AJUDANTES, ctx, { filename: "calendario-recortado.js" });
  ctx.__guardado = guardado;
  return ctx;
}

/* ======================= O RETRATO (o que a tela mostra) ======================= */
function desEsc(s) { return String(s).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"); }
const p2 = (n) => String(n).padStart(2, "0");
// Mês: lê as etiquetas que o renderMes de verdade desenhou (texto, fundo, letra, dica e se abre edição)
function lerMes(html, ano, mes) {
  const dias = {};
  const reCel = /<div class="cal-cell([^"]*)"><span class="dia">(\d+)<\/span>([\s\S]*?)<\/div>/g;
  let c;
  while ((c = reCel.exec(html))) {
    if (/\bfora\b/.test(c[1])) continue;
    const iso = ano + "-" + p2(mes + 1) + "-" + p2(+c[2]);
    const chips = [];
    const reChip = /<span class="camp( camp-ed)?"(?: data-ed="([^"]*)")? style="background:([^;"]*);color:([^;"]*)(;cursor:pointer)?" title="([^"]*)">([^<]*)<\/span>/g;
    let k;
    while ((k = reChip.exec(c[3]))) chips.push({ texto: desEsc(k[7]), fundo: k[3], letra: k[4], dica: desEsc(k[6]), ed: k[2] || null });
    dias[iso] = chips;
  }
  return dias;
}
function lerLegenda(L) {
  const r = {};
  [["campanhas", "calLegSetores"], ["datas", "calLegDatas"], ["minhas", "calLegUser"]].forEach(([nome, id]) => {
    const x = L[id], itens = [];
    if (x && x.display !== "none") {
      const re = /<span class="leg-item" data-camp="([^"]*)"><span class="qd" style="background:([^"]*)"><\/span> ([^<]*)<\/span>/g;
      let k; while ((k = re.exec(x.html))) itens.push([desEsc(k[1]), k[2]]);
    }
    r[nome] = itens;
  });
  return r;
}
function retratar(cal) {
  const r = { mes: {}, ano: {}, legenda: null, erros: [] };
  ANOS.forEach((a) => {
    for (let m = 0; m < 12; m++) {
      const dias = lerMes(cal.__mesHtml(a, m), a, m);
      const ult = new Date(a, m + 1, 0).getDate();
      for (let d = 1; d <= ult; d++) {
        const iso = a + "-" + p2(m + 1) + "-" + p2(d), chips = dias[iso] || [];
        // trava do próprio teste: o leitor do HTML tem de ver TODAS as etiquetas que o Calendário montou
        if (chips.length !== cal.__itens(a, m, d).length) r.erros.push(iso + ": li " + chips.length + " etiquetas, o Calendário montou " + cal.__itens(a, m, d).length);
        r.mes[iso] = chips.map((x) => [x.texto, x.fundo, x.letra, x.dica]);
        r.ano[iso] = cal.__pinta(a, m, d);
      }
    }
  });
  r.legenda = lerLegenda(cal.__legenda());
  return r;
}
function diferencas(antes, agora) {
  const mes = [], ano = [];
  Object.keys(antes.mes).forEach((iso) => {
    if (JSON.stringify(antes.mes[iso]) !== JSON.stringify(agora.mes[iso])) mes.push(iso + " antes " + JSON.stringify((antes.mes[iso] || []).map((x) => x[0])) + " agora " + JSON.stringify((agora.mes[iso] || []).map((x) => x[0] + " " + x[1])));
    if (JSON.stringify(antes.ano[iso]) !== JSON.stringify(agora.ano[iso])) ano.push(iso + " antes " + JSON.stringify(antes.ano[iso]) + " agora " + JSON.stringify(agora.ano[iso]));
  });
  const leg = JSON.stringify(antes.legenda) === JSON.stringify(agora.legenda) ? "" : ("antes " + JSON.stringify(antes.legenda.campanhas.map((x) => x[0])) + " agora " + JSON.stringify(agora.legenda.campanhas.map((x) => x[0])));
  return { mes, ano, leg };
}

/* ======================= OS ESTADOS DA NUVEM ======================= */
const clone = (x) => JSON.parse(JSON.stringify(x));
// A especificação fixa (10/10/2026): a mesma do SQL e do calculo.cjs
const REGRA_FDS = { id: "final-de-semana", nome: NOME_FDS, tipo: "campanha", categoria: null,
  regra: { tipo: "semanal", dia_semana: 5, duracao_dias: 3 }, setor: "Geral", cor: "#0088C2", situacao: "ativa", ordem: 7 };
const vagaFds = (chave, nome, oqm) => ({ chave, nome, o_que_muda: oqm, quantidade: 1, obrigatoria: true });
const MODELO_FDS = { id: "final-de-semana", campanha_id: "final-de-semana", tipo: "edicao", nome: NOME_FDS,
  prazos: { comecar: 28, definir: 17, aprovar: 14 }, versao: 1, ativo: true,
  estrutura: { grupos: [{ chave: "ofertas", nome: "Ofertas do fim de semana", identidade: NOME_FDS, ativo_padrao: true, vagas: [
    vagaFds("frango", "Frango", "corte"), vagaFds("linguica", "Linguiça", "marca"), vagaFds("carne-suina", "Carne suína", "corte"),
    vagaFds("bebida", "Bebida", "produto"), vagaFds("mercearia", "Mercearia", "produto"), vagaFds("conveniencia", "Conveniência", "produto")] }] } };
// a nuvem devolve as regras pela ordem (order("ordem")): a linha nova entra no lugar dela
function comRegra(regras, extra) {
  const l = clone(regras).filter((r) => r.id !== REGRA_FDS.id);
  l.push(Object.assign(clone(REGRA_FDS), extra || {}));
  return l.sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
}
function semGrupo(modelos) {
  return clone(modelos).map((m) => m.id !== "promocao-semanal" ? m :
    Object.assign(m, { versao: (m.versao || 1) + 1, estrutura: Object.assign({}, m.estrutura, { grupos: (m.estrutura.grupos || []).filter((g) => g.chave !== "fim-de-semana") }) }));
}
const comModeloFds = (modelos) => clone(modelos).filter((m) => m.id !== MODELO_FDS.id).concat([clone(MODELO_FDS)]);

/* ======================= O TESTE ======================= */
function principal() {
  let ok = 0, falhas = 0;
  function confere(nome, cond, detalhe) {
    if (cond) { ok++; } else { falhas++; console.log("FALHOU — " + nome + (detalhe ? " (" + detalhe + ")" : "")); }
  }
  function igualAoRetrato(nome, r, retrato) {
    const d = diferencas(retrato, r);
    confere(nome + ": o leitor viu todas as etiquetas", r.erros.length === 0, r.erros.slice(0, 2).join(" | "));
    confere(nome + ": Mês igual ao retrato (nomes, cores, ordem, dica) em 2026-2028", d.mes.length === 0, d.mes.length + " dia(s); ex.: " + d.mes.slice(0, 2).join(" | "));
    confere(nome + ": Ano igual ao retrato (quem pinta e a cor) em 2026-2028", d.ano.length === 0, d.ano.length + " dia(s); ex.: " + d.ano.slice(0, 2).join(" | "));
    confere(nome + ": legenda igual ao retrato", !d.leg, d.leg);
  }
  const fdsDoDia = (cal, a, m, d) => cal.__itens(a, m, d).filter((x) => x.nome === NOME_FDS);
  function cadaDia(fn) { ANOS.forEach((a) => { for (let m = 0; m < 12; m++) { const u = new Date(a, m + 1, 0).getDate(); for (let d = 1; d <= u; d++) fn(a, m, d); } }); }

  const src = fs.readFileSync(ARQ_PAINEL, "utf8");
  delete require.cache[require.resolve(ARQ_MOTOR)];
  const ENC = require(ARQ_MOTOR);
  const NUVEM = JSON.parse(fs.readFileSync(ARQ_NUVEM, "utf8"));
  let RETRATO = null;
  try { RETRATO = JSON.parse(fs.readFileSync(ARQ_RETRATO, "utf8")); } catch (e) { /* cobrado logo abaixo */ }
  confere("o retrato de antes existe (apoio/calendario-fds-antes.json)", !!RETRATO);
  if (!RETRATO) { console.log("\n" + ok + " ok, " + falhas + " falha(s)."); process.exit(1); }

  // 0) as peças existem e são funções (recorte pelas marcas pegou o trecho certo)
  const cal0 = montar(src, ENC);
  ["calFdsRegra", "calFds", "campanhasDoDia", "calPintaDoDia", "montarLegendas", "renderMes", "corCampanha", "calCarregarNuvem"].forEach((f) =>
    confere(f + " existe e é função", cal0.__tipo(f) === "function", cal0.__tipo(f)));
  confere("CAL_FDS_ID = \"final-de-semana\"", cal0.CAL_FDS_ID === "final-de-semana", cal0.CAL_FDS_ID);
  confere("CAL_FDS_NOME é o nome exato que a tela já mostrava", cal0.CAL_FDS_NOME === NOME_FDS, cal0.CAL_FDS_NOME);
  const res = cal0.CAL_FDS_RESERVA || {};
  confere("reserva fixa: sexta a domingo da semana da PS (4 a 6), com o mesmo nome", res.ini === 4 && res.fim === 6 && res.nome === NOME_FDS, JSON.stringify(res));
  confere("a reserva de cor continua ciano #0088C2", cal0.CAL_COR_FDS === "#0088C2", cal0.CAL_COR_FDS);

  // 0b) o retrato prova alguma coisa: tem o FDS, e a Sexta da Carne ativa na mesma sexta (ordem PS, FDS, SdC)
  const diasFds = Object.keys(RETRATO.mes).filter((iso) => RETRATO.mes[iso].some((x) => x[0] === NOME_FDS));
  const sextasComSdc = diasFds.filter((iso) => RETRATO.mes[iso].some((x) => x[0] === "Sexta da Carne"));
  confere("retrato: o FDS aparece de sexta a domingo (471 dias em 2026-2028)", diasFds.length === 471, diasFds.length);
  confere("retrato: a Sexta da Carne divide a sexta com o FDS (é o que faz a ordem importar)", sextasComSdc.length > 100, sextasComSdc.length);
  confere("retrato: na sexta a ordem é PS, FDS, Sexta da Carne", sextasComSdc.every((iso) => {
    const n = RETRATO.mes[iso].map((x) => x[0]); return n.indexOf("Promoção Semanal") + 1 === n.indexOf(NOME_FDS) && n.indexOf(NOME_FDS) < n.indexOf("Sexta da Carne"); }));
  confere("retrato: o Ano pinta o FDS (ciano) no sábado e no domingo", Object.keys(RETRATO.ano).filter((iso) => RETRATO.ano[iso] && RETRATO.ano[iso][0] === NOME_FDS && RETRATO.ano[iso][1] === "#0088C2").length > 200);
  const legR = RETRATO.legenda.campanhas.map((x) => x[0]);
  confere("retrato: na legenda o FDS vem logo depois da PS", legR.indexOf(NOME_FDS) === legR.indexOf("Promoção Semanal") + 1, JSON.stringify(legR));

  // estados
  const R_ANTES = NUVEM.regras, M_ANTES = NUVEM.modelos;
  const R_DEPOIS = comRegra(R_ANTES), M_DEPOIS = comModeloFds(semGrupo(M_ANTES));
  const ps = M_DEPOIS.filter((m) => m.id === "promocao-semanal")[0];
  const vagasPs = ps.estrutura.grupos.reduce((s, g) => s + g.vagas.length, 0);
  confere("estado depois: PS com 7 grupos e 37 vagas (36 obrigatórias)", ps.estrutura.grupos.length === 7 && vagasPs === 37 &&
    ps.estrutura.grupos.reduce((s, g) => s + g.vagas.filter((v) => v.obrigatoria !== false).length, 0) === 36, ps.estrutura.grupos.length + " grupos, " + vagasPs + " vagas");
  confere("estado depois: a regra nova entra depois da Quarta Saudável", R_DEPOIS.map((r) => r.id).indexOf("final-de-semana") === R_DEPOIS.map((r) => r.id).indexOf("quarta-saudavel") + 1);

  // (a) ANTES: a nuvem de hoje
  const calA = montar(src, ENC); calA.__estado(R_ANTES, M_ANTES);
  igualAoRetrato("(a) nuvem de hoje (grupo da PS)", retratar(calA), RETRATO);

  // (b) DEPOIS: regra própria + PS sem o grupo + modelo próprio
  const calB = montar(src, ENC); calB.__estado(R_DEPOIS, M_DEPOIS);
  igualAoRetrato("(b) depois do SQL (campanha própria)", retratar(calB), RETRATO);
  const sx = calB.__itens(2026, 9, 16), fdsB = sx.filter((x) => x.nome === NOME_FDS)[0] || {};
  confere("(b) a etiqueta do FDS é a campanha própria (id dela, marca fds, sem doGrupo)", fdsB.id === "final-de-semana" && fdsB.fds === true && !fdsB.doGrupo, JSON.stringify(fdsB));
  confere("(b) a etiqueta do FDS fica logo depois da PS, antes da Sexta da Carne", sx.map((x) => x.nome).join(" | ") === "Promoção Semanal | " + NOME_FDS + " | Sexta da Carne", sx.map((x) => x.nome).join(" | "));
  ["2026-10-17", "2026-10-18"].forEach((iso) => {
    const it = calB.__itens(2026, 9, +iso.slice(8)).filter((x) => x.nome === NOME_FDS)[0] || {};
    confere("(b) " + iso + ": o FDS leva a marca fds também fora da sexta (é o que pinta o Ano)", it.fds === true && it.semanal === true && it.primeiroDia === false, JSON.stringify(it));
  });

  // (c) TRANSIÇÃO: regras guardadas SEM a linha + modelos já SEM o grupo → vale a reserva fixa
  const calC = montar(src, ENC); calC.__estado(R_ANTES, comModeloFds(semGrupo(M_ANTES)));
  igualAoRetrato("(c) transição (regras sem a linha, modelos sem o grupo)", retratar(calC), RETRATO);
  // (c2) o mesmo pelo caminho real: só a cópia velha das regras no navegador + modelos padrão do código
  const calC2 = montar(src, ENC, { guardado: { cal_regras_nuvem: JSON.stringify(R_ANTES) } });
  confere("(c2) só a cópia velha guardada: regras vêm dela", calC2.__listas().regras.length === R_ANTES.length && !calC2.__listas().regras.some((r) => r.id === "final-de-semana"));
  igualAoRetrato("(c2) cópia velha das regras + modelos padrão do código", retratar(calC2), RETRATO);

  // (d) regra E grupo juntos (SQL pela metade, ou modelos velhos com regras novas): nunca duas etiquetas
  const calD = montar(src, ENC); calD.__estado(R_DEPOIS, M_ANTES);
  let dobro = [];
  cadaDia((a, m, d) => { if (fdsDoDia(calD, a, m, d).length > 1) dobro.push(a + "-" + p2(m + 1) + "-" + p2(d)); });
  confere("(d) regra + grupo: nunca duas etiquetas do FDS no mesmo dia", dobro.length === 0, dobro.length + " dia(s); ex.: " + dobro.slice(0, 3).join(", "));
  const rD = retratar(calD);
  igualAoRetrato("(d) regra + grupo", rD, RETRATO);
  confere("(d) regra + grupo: o FDS uma vez só na legenda", rD.legenda.campanhas.filter((x) => x[0] === NOME_FDS).length === 1);

  // (e) regra PAUSADA: o FDS some do Mês, do Ano e da legenda (com e sem o grupo ainda no modelo da PS)
  [["sem o grupo", comModeloFds(semGrupo(M_ANTES))], ["com o grupo ainda na PS", M_ANTES]].forEach(([qual, mods]) => {
    const calE = montar(src, ENC); calE.__estado(comRegra(R_ANTES, { situacao: "pausada" }), mods);
    const rE = retratar(calE);
    const noMes = Object.keys(rE.mes).filter((iso) => rE.mes[iso].some((x) => x[0] === NOME_FDS));
    const noAno = Object.keys(rE.ano).filter((iso) => rE.ano[iso] && rE.ano[iso][0] === NOME_FDS);
    confere("(e) pausado " + qual + ": some do Mês", noMes.length === 0, noMes.length + " dia(s)");
    confere("(e) pausado " + qual + ": some do Ano", noAno.length === 0, noAno.length + " dia(s)");
    confere("(e) pausado " + qual + ": some da legenda", !rE.legenda.campanhas.concat(rE.legenda.datas, rE.legenda.minhas).some((x) => x[0] === NOME_FDS));
    confere("(e) pausado " + qual + ": a PS continua igual", rE.legenda.campanhas[0] && rE.legenda.campanhas[0][0] === "Promoção Semanal");
  });

  // (e2) a PS PAUSADA e o FDS ativo: promoção própria continua sozinha (antes, como grupo, sumia junto com a PS)
  const calE2 = montar(src, ENC);
  calE2.__estado(comRegra(R_ANTES).map((r) => r.id === "promocao-semanal" ? Object.assign({}, r, { situacao: "pausada" }) : r), comModeloFds(semGrupo(M_ANTES)));
  const rE2 = retratar(calE2);
  const fdsE2 = Object.keys(rE2.mes).filter((iso) => rE2.mes[iso].some((x) => x[0] === NOME_FDS));
  confere("(e2) PS pausada: o FDS continua de sexta a domingo (471 dias)", fdsE2.length === 471, fdsE2.length);
  confere("(e2) PS pausada: nenhuma etiqueta da PS", !Object.keys(rE2.mes).some((iso) => rE2.mes[iso].some((x) => x[0] === "Promoção Semanal")));
  const legE2 = rE2.legenda.campanhas.map((x) => x[0]);
  confere("(e2) PS pausada: o FDS fica na legenda (uma vez, no lugar da ordem dele)", legE2.filter((n) => n === NOME_FDS).length === 1 && legE2.indexOf("Promoção Semanal") < 0, JSON.stringify(legE2));

  // (f) um grupo com período de OUTRA chave na PS não vira Final de semana
  const festival = clone(M_ANTES).map((m) => {
    if (m.id !== "promocao-semanal") return m;
    m.estrutura.grupos = m.estrutura.grupos.filter((g) => g.chave !== "fim-de-semana");
    m.estrutura.grupos.unshift({ chave: "festival-carnes", nome: "Festival de carnes", identidade: "Festival de carnes", ativo_padrao: true,
      periodo: { ini_offset: 0, fim_offset: 1 }, vagas: [vagaFds("picanha", "Picanha", "corte")] });
    return m;
  });
  [["sem a regra", R_ANTES], ["com a regra", R_DEPOIS]].forEach(([qual, regs]) => {
    const calF = montar(src, ENC); calF.__estado(regs, festival);
    let falso = [], segTer = [];
    cadaDia((a, m, d) => {
      const it = calF.__itens(a, m, d), dow = new Date(a, m, d).getDay();
      if (it.some((x) => /Festival/.test(x.nome))) falso.push(a + "-" + p2(m + 1) + "-" + p2(d));
      if ((dow === 1 || dow === 2) && it.some((x) => x.fds)) segTer.push(a + "-" + p2(m + 1) + "-" + p2(d));
    });
    confere("(f) " + qual + ": o \"Festival de carnes\" (período 0..1) nunca vira etiqueta", falso.length === 0, falso.length + " dia(s)");
    confere("(f) " + qual + ": segunda e terça nunca ganham marca de Final de semana", segTer.length === 0, segTer.length + " dia(s)");
    igualAoRetrato("(f) " + qual + " + grupo de outra chave", retratar(calF), RETRATO);
  });

  // (g) o id batizado em paralelo é o MESMO nas três peças
  if (fs.existsSync(ARQ_SQL)) {
    const sql = fs.readFileSync(ARQ_SQL, "utf8");
    // o insert da regra: "values ('id', 'nome', ..." ou "select 'id', 'nome', ..." (não pega calendario_regras_historico)
    const m1 = /insert\s+into\s+(?:public\.)?calendario_regras\b[^;]*?(?:values\s*\(|select\s+)\s*'([^']+)'\s*,\s*'([^']+)'/i.exec(sql);
    if (m1) {
      confere("(g) CAL_FDS_ID = id da regra no SQL", m1[1] === cal0.CAL_FDS_ID, "SQL " + m1[1] + " × painel " + cal0.CAL_FDS_ID);
      confere("(g) nome da regra no SQL = nome que a tela mostra", m1[2] === NOME_FDS, m1[2]);
    } else {
      // insert escrito de outro jeito (ex.: com variável): pelo menos o id do painel tem de estar lá, como texto
      confere("(g) o id do painel aparece no SQL ('" + cal0.CAL_FDS_ID + "')", sql.includes("'" + cal0.CAL_FDS_ID + "'"));
    }
    // a linha INTEIRA do insert (não só o id e o nome): tipo, categoria, regra, setor, cor, situação e ordem.
    // O Calendário casa pelo nome exato e mostra o setor na dica; procurar a cor no arquivo todo passava
    // mesmo com o insert errado (a cor também está nos comentários e na conferência).
    const m2 = /insert\s+into\s+(?:public\.)?calendario_regras\s*\([^)]*\)\s*values\s*\(\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*(null|'[^']*')\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*(\d+)/i.exec(sql);
    confere("(g) o insert da regra no SQL foi lido campo a campo", !!m2);
    if (m2) {
      let rgSql = null; try { rgSql = JSON.parse(m2[5]); } catch (e) {}
      confere("(g) SQL: tipo campanha, sem categoria", m2[3] === "campanha" && m2[4].toLowerCase() === "null", m2[3] + " / " + m2[4]);
      confere("(g) SQL: regra = toda sexta, 3 dias", rgSql && rgSql.tipo === "semanal" && +rgSql.dia_semana === 5 && +rgSql.duracao_dias === 3, m2[5]);
      confere("(g) SQL: setor Geral, cor #0088C2, ativa, ordem 7", m2[6] === "Geral" && m2[7].toUpperCase() === "#0088C2" && m2[8] === "ativa" && +m2[9] === 7,
        [m2[6], m2[7], m2[8], m2[9]].join(" / "));
    }
  } else {
    console.log("AVISO — sql/encartes_final_de_semana.sql ainda não existe: a conferência do id com o SQL fica para quando ele existir.");
  }
  const rp = (ENC.REGRAS_PADRAO || []).filter((r) => r.id === cal0.CAL_FDS_ID || r.nome === NOME_FDS)[0];
  if (rp) {
    confere("(g) CAL_FDS_ID = id em REGRAS_PADRAO (calculo.cjs)", rp.id === cal0.CAL_FDS_ID, "calculo " + rp.id + " × painel " + cal0.CAL_FDS_ID);
    const rg = typeof rp.regra === "string" ? JSON.parse(rp.regra) : rp.regra;
    confere("(g) REGRAS_PADRAO tem o nome, a cor, o setor, a ordem e a regra da especificação",
      rp.nome === NOME_FDS && String(rp.cor).toUpperCase() === "#0088C2" && rp.setor === "Geral" && +rp.ordem === 7 && rp.tipo === "campanha" &&
      rg && rg.tipo === "semanal" && +rg.dia_semana === 5 && +rg.duracao_dias === 3, JSON.stringify(rp));
    // o padrão do código (navegador sem cópia e sem nuvem) também mostra o FDS uma vez só, depois da PS
    const calP = montar(src, ENC);
    let semFds = [], dobroP = [], foraDeLugar = [];
    cadaDia((a, m, d) => {
      const it = calP.__itens(a, m, d), dow = new Date(a, m, d).getDay(), f = it.filter((x) => x.nome === NOME_FDS), iso = a + "-" + p2(m + 1) + "-" + p2(d);
      if ((dow === 5 || dow === 6 || dow === 0) && f.length === 0) semFds.push(iso);
      if (f.length > 1) dobroP.push(iso);
      const n = it.map((x) => x.nome);
      if (f.length && n.indexOf("Promoção Semanal") >= 0 && n.indexOf(NOME_FDS) !== n.indexOf("Promoção Semanal") + 1) foraDeLugar.push(iso);
    });
    confere("(g) padrão do código: toda sexta, sábado e domingo têm o FDS", semFds.length === 0, semFds.length + " dia(s); ex.: " + semFds.slice(0, 3).join(", "));
    confere("(g) padrão do código: nunca duas etiquetas do FDS", dobroP.length === 0, dobroP.length + " dia(s)");
    confere("(g) padrão do código: o FDS logo depois da PS", foraDeLugar.length === 0, foraDeLugar.slice(0, 3).join(", "));
    const legP = lerLegenda(calP.__legenda()).campanhas.map((x) => x[0]);
    confere("(g) padrão do código: legenda com o FDS logo depois da PS, uma vez", legP.indexOf(NOME_FDS) === legP.indexOf("Promoção Semanal") + 1 && legP.filter((n) => n === NOME_FDS).length === 1, JSON.stringify(legP));
  } else {
    console.log("AVISO — REGRAS_PADRAO (calculo.cjs) ainda não tem a regra do Final de semana: a conferência do id com ele fica para quando tiver.");
  }

  // (h) a contagem x/y e o clique: a campanha própria tem; a etiqueta derivada do grupo não (ela carrega o id da PS)
  const fonteMes = trecho(src, "function renderMes(){", "function renderAno(){");
  confere("(h) a condição da contagem usa doGrupo", /cp\.tipo==="campanha"\s*&&\s*!cp\.doGrupo/.test(fonteMes) && !/!cp\.fds\)/.test(fonteMes));
  const ED_PS = { edicao_id: "ed-ps-1210", campanha_id: "promocao-semanal", inicio: "2026-10-12", inicio_regra: "2026-10-12", contagem: { definidas: 3, total: 36 } };
  const ED_FDS = { edicao_id: "ed-fds-1610", campanha_id: "final-de-semana", inicio: "2026-10-16", inicio_regra: "2026-10-16", contagem: { definidas: 0, total: 6 } };
  const calH = montar(src, ENC); calH.__estado(R_DEPOIS, M_DEPOIS, [ED_PS, ED_FDS]);
  const mesH = lerMes(calH.__mesHtml(2026, 9), 2026, 9);
  ["2026-10-16", "2026-10-17", "2026-10-18"].forEach((iso) => {
    const c = mesH[iso].filter((x) => x.texto.indexOf(NOME_FDS) === 0)[0] || {};
    confere("(h) depois: " + iso + " mostra \"" + NOME_FDS + " · 0/6\" e abre a edição dele", c.texto === NOME_FDS + " · 0/6" && c.ed === "ed-fds-1610" && c.fundo === "#0088C2", JSON.stringify(c));
    const p = mesH[iso].filter((x) => x.texto.indexOf("Promoção Semanal") === 0)[0] || {};
    confere("(h) depois: " + iso + " a PS mostra 3/36 e abre a edição dela", p.texto === "Promoção Semanal · 3/36" && p.ed === "ed-ps-1210", JSON.stringify(p));
    confere("(h) depois: " + iso + " a ordem continua PS, FDS", mesH[iso].map((x) => x.texto.split(" · ")[0]).slice(0, 2).join("|") === "Promoção Semanal|" + NOME_FDS);
  });
  confere("(h) depois: o FDS de outra semana, sem edição, fica sem contagem e sem clique", (mesH["2026-10-23"].filter((x) => x.texto.indexOf(NOME_FDS) === 0)[0] || {}).ed === null);
  const calH2 = montar(src, ENC); calH2.__estado(R_ANTES, M_ANTES, [Object.assign({}, ED_PS, { contagem: { definidas: 3, total: 42 } })]);
  const mesH2 = lerMes(calH2.__mesHtml(2026, 9), 2026, 9);
  const g16 = mesH2["2026-10-16"].filter((x) => x.texto.indexOf(NOME_FDS) === 0)[0] || {};
  confere("(h) antes: a etiqueta derivada do grupo NÃO mostra a contagem da PS nem abre a edição dela", g16.texto === NOME_FDS && g16.ed === null, JSON.stringify(g16));
  confere("(h) antes: a PS mostra 3/42", (mesH2["2026-10-16"].filter((x) => x.texto.indexOf("Promoção Semanal") === 0)[0] || {}).texto === "Promoção Semanal · 3/42");

  // (i) ==CALCACHE== regras e modelos guardados JUNTOS, do mesmo momento
  // cada linha do par leva uma marca, para provar que veio DELE (e não do padrão do código, que pode ter o mesmo tamanho)
  const marcado = (l) => clone(l).map((x) => Object.assign(x, { _do_par: true }));
  const parDepois = JSON.stringify({ em: 1, regras: marcado(R_DEPOIS), modelos: marcado(M_DEPOIS) });
  const calI = montar(src, ENC, { guardado: { cal_nuvem_par: parDepois, cal_regras_nuvem: JSON.stringify(R_ANTES) } });
  const lI = calI.__listas();
  confere("(i) com o par guardado, as regras vêm dele (com a linha nova)", lI.regras.every((r) => r._do_par) && lI.regras.some((r) => r.id === "final-de-semana") && lI.regras.length === R_DEPOIS.length);
  confere("(i) com o par guardado, os modelos vêm dele (não do padrão do código)", lI.modelos.every((m) => m._do_par) && lI.modelos.length === M_DEPOIS.length);
  igualAoRetrato("(i) abrir com o par guardado (depois do SQL)", retratar(calI), RETRATO);
  const calI2 = montar(src, ENC, { guardado: { cal_nuvem_par: "{quebrado", cal_regras_nuvem: JSON.stringify(marcado(R_ANTES)) } });
  confere("(i) par guardado quebrado: volta para a cópia velha das regras, sem erro", calI2.__listas().regras.every((r) => r._do_par) && calI2.__listas().regras.length === R_ANTES.length);
  const calI3 = montar(src, ENC, { guardado: { cal_nuvem_par: JSON.stringify({ regras: marcado(R_DEPOIS), modelos: [] }) } });
  confere("(i) par sem modelos não vale (meio par): ficam as listas padrão", !calI3.__listas().regras.some((r) => r._do_par) &&
    calI3.__listas().regras.length === (ENC.REGRAS_PADRAO || []).length && calI3.__listas().modelos.length === (ENC.MODELOS_PADRAO || []).length);
  let quebrou = null;
  try { montar(src, ENC, { armazemQuebrado: true }); } catch (e) { quebrou = e; }
  confere("(i) navegador sem armazém (janela anônima, bloqueio): abre sem erro", !quebrou, quebrou && quebrou.message);

  return { ok: () => ok, falhas: () => falhas, assincrono: provarLeituraDaNuvem(src, ENC, R_DEPOIS, M_DEPOIS, confere) };
}

// (i) a leitura da nuvem grava o par só quando as DUAS leituras vieram
async function provarLeituraDaNuvem(src, ENC, regras, modelos, confere) {
  function consulta(resp) { const q = { select() { return q; }, order() { return q; }, limit() { return q; }, eq() { return q; }, then(ok, ko) { return Promise.resolve(resp).then(ok, ko); } }; return q; }
  async function rodar(respRegras, respModelos, guardado) {
    const cal = montar(src, ENC, { guardado });
    cal.window.__PERFIL = { is_master: false };
    cal.window.__SB = { from(t) { return consulta(t === "calendario_regras" ? respRegras : respModelos); } };
    cal.calCarregarNuvem(true);
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
    return cal;
  }
  const c1 = await rodar({ data: regras, error: null }, { data: modelos, error: null }, {});
  let par = null; try { par = JSON.parse(c1.__guardado.cal_nuvem_par || "null"); } catch (e) { par = null; }
  confere("(i) a leitura da nuvem guarda o par (regras + modelos)", !!(par && par.regras && par.regras.length === regras.length && par.modelos && par.modelos.length === modelos.length));
  confere("(i) a cópia velha das regras continua sendo gravada (código antigo que voltar ao ar ainda acha)", !!c1.__guardado.cal_regras_nuvem);
  const velho = JSON.stringify({ em: 1, regras: [{ id: "x" }], modelos: [{ id: "y" }] });
  const c2 = await rodar({ data: regras, error: null }, { data: null, error: { message: "falhou" } }, { cal_nuvem_par: velho });
  confere("(i) leitura dos modelos falhou: o par guardado NÃO é trocado (regras de um momento, modelos de outro)", c2.__guardado.cal_nuvem_par === velho);
}

if (require.main === module) {
  const r = principal();
  r.assincrono.then(() => {
    const ok = r.ok(), falhas = r.falhas();
    console.log(falhas ? ("\n" + ok + " ok, " + falhas + " falha(s).") : (ok + " ok, 0 falha(s)."));
    process.exit(falhas ? 1 : 0);
  }, (e) => { console.log("FALHOU — erro na prova da leitura da nuvem: " + (e && e.stack)); process.exit(1); });
}
module.exports = { montar, retratar, lerMes, lerLegenda, diferencas, ANOS };
