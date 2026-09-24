/* ==CXV-CALC== COMPRA × VENDA — o cálculo, num lugar só.
   Roda igual no navegador (tela) e no Node (testes). Nada aqui lê banco nem desenha.

   AS CONTAS (decididas pelo dono em 23/09/2026):
     ORÇAMENTO    = venda da semana anterior × (1 − margem OBJETIVO) × fator de imposto
     RECEBIDO     = notas de compra FINALIZADAS − devolução ± reclassificação entre setores
     COMPROMETIDO = saldo realmente pendente de pedidos válidos (só na semana atual)
     DISPONÍVEL   = orçamento − recebido − comprometido
     % UTILIZADO  = (recebido + comprometido) ÷ orçamento
   Nota NÃO finalizada fica FORA do recebido, mostrada ao lado. Bonificação fica fora
   da compra, guardada para o estoque.

   O FATOR DE IMPOSTO (medido em 23/09): a margem que o Painel mostra é sobre o custo
   SEM imposto; a nota de entrada vem COM imposto. Semana 07–13/09: custo do vendido
   R$ 739 mil sem imposto, R$ 838 mil com. Sem o fator, o orçamento sai ~13% menor que
   o bolso de onde a nota é paga e todo setor parece estourado. Fator = custo com
   imposto ÷ custo sem imposto do que o setor vendeu na semana-base. Desligável
   (CXV_CFG.fatorImposto=false).

   MARGEM AUSENTE NÃO É ZERO: sem margem objetivo, o orçamento é null e a tela diz
   "MARGEM OBJETIVO NÃO DEFINIDA". Nunca 0% (0% liberaria comprar tudo que vendeu). */
(function (raiz) {
  var CXV_CFG = {
    fatorImposto: true,        // traz o orçamento para a base da nota (com imposto)
    folgaRitmo: 15,            // pontos percentuais acima do ritmo esperado antes de avisar
    limiteAtencao: 85,         // % utilizado a partir do qual fica amarelo
    limiteBaixoFechada: 60,    // semana fechada abaixo disto: "compra abaixo do esperado"
    difMargemAviso: 5,         // margem real × objetivo: diferença em p.p. que vira aviso
    semCustoAviso: 1,          // % da venda sem custo no VR que vira aviso
    sobraRecenteCompromete: false // sobra de entrega parcial recente NÃO compromete (81% nunca chega)
  };

  function tem(v) { return v !== null && v !== undefined && v !== "" && isFinite(+v); }
  function r2(v) { return Math.round(v * 100) / 100; }
  function addDias(s, n) { var d = new Date(s + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function diaSemana(s) { var d = new Date(s + "T12:00:00Z"); return ((d.getUTCDay() + 6) % 7) + 1; } // 1=seg … 7=dom

  var NOMES = { "ACOUGUE": "Açougue", "HORTFRUTI": "Hortifrúti", "HORTIFRUTI": "Hortifrúti", "MERCEARIA": "Mercearia",
    "MERCEARIA SECA": "Mercearia Seca", "FRIOS": "Frios", "PERFUMARIA": "Perfumaria", "PADARIA": "Padaria",
    "CONGELADO": "Congelado", "LIMPEZA": "Limpeza", "BEBIDAS": "Bebidas", "BAZAR": "Bazar", "PET SHOP": "Pet Shop",
    "SAUDABILIDADE": "Saudabilidade", "DESPESA": "Despesa", "A ACERTAR": "A acertar" };
  function nomeSetor(vr) {
    var k = String(vr || "").toUpperCase().replace(/^NOVO\s*-?\s*/, "").trim();
    return NOMES[k] || (k.charAt(0) + k.slice(1).toLowerCase());
  }

  /* Uma semana, todos os setores.
     dados   = o JSON da extração (semanas, pedidos, naoFinalizadas, pendenciasSetor, ritmo, mapa)
     conf    = { [setor]: { margemObjetivo: número|null, permiteEstoque: true|false|null } }
     semIni  = segunda-feira da semana a mostrar
     cfg     = CXV_CFG (opcional, para testar variações) */
  function calcularSemana(dados, conf, semIni, cfg) {
    cfg = cfg || CXV_CFG; conf = conf || {};
    var sem = achar(dados.semanas, semIni), ant = achar(dados.semanas, addDias(semIni, -7));
    var atual = semIni === dados.semanaAtual;
    var fim = addDias(semIni, 6);
    var fechada = fim < dados.hoje;
    var esperado = atual ? (dados.ritmo[diaSemana(dados.hoje) - 1] || 0) * 100 : 100;

    var comp = {}, futuro = {};
    if (atual) (dados.pedidos || []).forEach(function (p) {
      var alvo = p.classe === "comprometido" ? comp : p.classe === "futuro" ? futuro : null;
      if (p.classe === "sobra_parcial" && cfg.sobraRecenteCompromete && p.ultNota && p.ultNota >= addDias(dados.hoje, -dados.toleranciaDias)) alvo = comp;
      if (!alvo) return;
      for (var g in p.setores) alvo[g] = r2((alvo[g] || 0) + p.setores[g]);
    });
    var naoFin = {};
    (dados.naoFinalizadas || []).forEach(function (n) {
      if (!(n.entrada >= semIni && n.entrada <= fim) && !(atual && n.entrada < semIni)) return; // semana atual: parada de antes também pesa
      for (var g in n.setores) naoFin[g] = r2((naoFin[g] || 0) + n.setores[g]);
    });

    var chaves = {};
    [sem && sem.setores, ant && ant.setores, comp, naoFin].forEach(function (o) { if (o) for (var k in o) chaves[k] = 1; });
    var linhas = Object.keys(chaves).map(function (m) {
      var a = (ant && ant.setores[m]) || {}, s = (sem && sem.setores[m]) || {};
      var c = conf[m] || {};
      var mObj = tem(c.margemObjetivo) ? +c.margemObjetivo : null;
      var venda = a.venda || 0;
      var mReal = venda > 0 && a.cmv_sem ? r2((1 - a.cmv_sem / venda) * 100) : null;
      var fator = cfg.fatorImposto && a.cmv_sem > 0 && a.cmv_com > 0 ? a.cmv_com / a.cmv_sem : 1;
      var orc = mObj === null || venda <= 0 ? null : r2(venda * (1 - mObj / 100) * fator);
      var recebido = r2((s.recebido || 0) - (s.devol || 0) + (s.recl_ent || 0) - (s.recl_sai || 0));
      var comprometido = atual ? (comp[m] || 0) : null;
      var usado = recebido + (comprometido || 0);
      var disp = orc === null ? null : r2(orc - usado);
      var pct = orc ? r2((usado / orc) * 100) : null;
      var pctRec = orc ? r2((recebido / orc) * 100) : null;
      var L = { setor: m, nome: nomeSetor(dados.setores[m]), nomeVR: dados.setores[m], venda: r2(venda), margemObjetivo: mObj,
        margemReal: mReal, fator: r2(fator * 1000) / 1000, orcamento: orc, recebido: recebido, recebidoBruto: r2(s.recebido || 0),
        devolucao: r2(s.devol || 0), reclassEntra: r2(s.recl_ent || 0), reclassSai: r2(s.recl_sai || 0), bonificacao: r2(s.bonif || 0),
        comprometido: comprometido, futuro: atual ? (futuro[m] || 0) : null, naoFinalizado: naoFin[m] || 0,
        disponivel: disp, pctUtilizado: pct, pctRecebido: pctRec, permiteEstoque: tem(c.permiteEstoque) || c.permiteEstoque === true || c.permiteEstoque === false ? c.permiteEstoque : null };
      L.status = status(L, { atual: atual, fechada: fechada, esperado: esperado }, cfg);
      L.alertas = alertas(L, a, dados, cfg);
      return L;
    }).filter(function (L) { return L.venda > 0 || L.recebido !== 0 || L.comprometido || L.naoFinalizado; })
      .sort(function (x, y) { return y.venda - x.venda; });

    /* TOTAL DA LOJA. Recebido/comprometido somam TODOS os setores (é o que a loja gastou).
       Orçamento, disponível e % só somam setores QUE TÊM orçamento — senão a compra de um
       setor sem margem definida abateria o orçamento dos outros. A tela avisa quando o
       total está incompleto (semOrcamento > 0). */
    var tot = { venda: 0, orcamento: 0, recebido: 0, comprometido: 0, futuro: 0, naoFinalizado: 0, bonificacao: 0, devolucao: 0,
      semOrcamento: 0, usadoComOrcamento: 0, usadoSemOrcamento: 0 };
    linhas.forEach(function (L) {
      var usado = L.recebido + (L.comprometido || 0);
      tot.venda += L.venda; tot.recebido += L.recebido; tot.comprometido += L.comprometido || 0; tot.futuro += L.futuro || 0;
      tot.naoFinalizado += L.naoFinalizado; tot.bonificacao += L.bonificacao; tot.devolucao += L.devolucao;
      if (L.orcamento === null) { if (L.venda > 0) tot.semOrcamento++; tot.usadoSemOrcamento += usado; }
      else { tot.orcamento += L.orcamento; tot.usadoComOrcamento += usado; }
    });
    for (var k in tot) tot[k] = r2(tot[k]);
    tot.completo = tot.semOrcamento === 0;
    tot.disponivel = tot.orcamento > 0 ? r2(tot.orcamento - tot.usadoComOrcamento) : null;
    tot.pctUtilizado = tot.orcamento > 0 ? r2((tot.usadoComOrcamento / tot.orcamento) * 100) : null;
    return { ini: semIni, fim: fim, atual: atual, fechada: fechada, esperado: r2(esperado), linhas: linhas, total: tot,
      temBase: !!ant, hoje: dados.hoje };
  }

  function status(L, ctx, cfg) {
    if (L.venda <= 0) return { cod: "semvenda", txt: "Sem venda na semana anterior" };
    if (L.orcamento === null) return { cod: "semdef", txt: "Margem objetivo não definida" };
    var p = L.pctUtilizado;
    if (p > 100) {
      if (L.permiteEstoque === true) return { cod: "estocando", txt: "Estocando" };
      if (L.permiteEstoque === false) return { cod: "divergencia", txt: "Acima do orçamento — investigar" };
      return { cod: "acima", txt: "Acima do orçamento" };
    }
    if (ctx.atual) {
      if (L.pctRecebido > ctx.esperado + cfg.folgaRitmo) return { cod: "adiantado", txt: "Comprando acima do ritmo" };
      if (p >= cfg.limiteAtencao) return { cod: "atencao", txt: "Perto do limite" };
      if (ctx.esperado >= 50 && p < ctx.esperado - 2 * cfg.folgaRitmo) return { cod: "lento", txt: "Abaixo do ritmo — conferir estoque" };
      return { cod: "ok", txt: "No ritmo" };
    }
    if (p >= cfg.limiteAtencao) return { cod: "atencao", txt: "Perto do limite" };
    if (ctx.fechada && p < cfg.limiteBaixoFechada) return { cod: "baixo", txt: "Compra abaixo do esperado — conferir estoque" };
    return { cod: "ok", txt: "Dentro do orçamento" };
  }

  function alertas(L, base, dados, cfg) {
    var A = [];
    if (L.naoFinalizado > 0) A.push({ tipo: "naofin", txt: "notas não finalizadas", valor: L.naoFinalizado });
    if (L.margemObjetivo !== null && L.margemReal !== null && Math.abs(L.margemReal - L.margemObjetivo) > cfg.difMargemAviso)
      A.push({ tipo: "margem", txt: "margem real " + fmtPct(L.margemReal) + " × objetivo " + fmtPct(L.margemObjetivo) });
    if (base.venda > 0 && base.venda_sem_custo / base.venda * 100 > cfg.semCustoAviso)
      A.push({ tipo: "semcusto", txt: fmtPct(base.venda_sem_custo / base.venda * 100) + " da venda sem custo no VR" });
    var ps = (dados.pendenciasSetor || {})[L.setor];
    if (ps && ps.antigo_sem_nota > 0) A.push({ tipo: "antigo", txt: "pedidos antigos sem nota", valor: ps.antigo_sem_nota, n: ps.n_antigo });
    if (ps && ps.sobra_recente > 0) A.push({ tipo: "sobra", txt: "sobra recente de entrega parcial (pode chegar)", valor: ps.sobra_recente });
    var trazidos = (dados.mapa || []).filter(function (x) { return x.ger === L.setor && x.vr !== L.setor; }).length;
    if (trazidos) A.push({ tipo: "mapa", txt: trazidos + " produto" + (trazidos > 1 ? "s" : "") + " trazido" + (trazidos > 1 ? "s" : "") + " de outro setor" });
    var recl = r2(L.reclassEntra - L.reclassSai);
    if (Math.abs(recl) >= 1) A.push({ tipo: "recl", txt: (recl > 0 ? "recebeu " : "passou ") + "por reclassificação", valor: Math.abs(recl) });
    if (L.bonificacao > 0) A.push({ tipo: "bonif", txt: "em bonificação (fora da compra)", valor: L.bonificacao });
    return A;
  }
  function fmtPct(v) { return (Math.round(v * 10) / 10).toString().replace(".", ",") + "%"; }
  function achar(arr, ini) { for (var i = 0; i < (arr || []).length; i++) if (arr[i].ini === ini) return arr[i]; return null; }

  var API = { CXV_CFG: CXV_CFG, calcularSemana: calcularSemana, nomeSetor: nomeSetor, diaSemana: diaSemana, addDias: addDias, tem: tem };
  if (typeof module !== "undefined" && module.exports) module.exports = API; else raiz.CXV = API;
})(this);
