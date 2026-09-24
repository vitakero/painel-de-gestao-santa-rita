/* ==CXV-TELA== COMPRA × VENDA — a tela (dentro de "Projeção de compras").
   Desenha a partir do cálculo (==CXV-CALC==) e de uma fonte de dados:
     cxvMontar(raiz, fonte) — fonte = { dados, conf, salvarConf(conf), podeEditar }
   Na PRÉVIA a fonte é o arquivo extraído do VR; na versão final vem da nuvem.
   MODO SOMBRA: nada aqui bloqueia compra. Só mostra. */
(function () {
  var C = window.CXV;
  var F = null, R = null, semSel = null, abertos = {};

  function brl(v, cent) { if (v === null || v === undefined) return "—"; var n = cent ? 2 : 0;
    return (v < 0 ? "−" : "") + "R$ " + Math.abs(v).toLocaleString("pt-BR", { minimumFractionDigits: n, maximumFractionDigits: n }); }
  function pct(v, c) { if (v === null || v === undefined) return "—"; return (Math.round(v * (c ? 10 : 1)) / (c ? 10 : 1)).toLocaleString("pt-BR") + "%"; }
  function dm(s) { return s.slice(8, 10) + "/" + s.slice(5, 7); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  var DIAS = ["segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"];
  var COR = { ok: "ok", atencao: "am", adiantado: "am", lento: "am", baixo: "am", acima: "vm", divergencia: "vm", estocando: "az", semdef: "cz", semvenda: "cz" };

  function semanas() { // semanas que têm semana-base (a primeira do arquivo só serve de base)
    var s = F.dados.semanas.map(function (x) { return x.ini; }).sort();
    return s.slice(1);
  }

  function barra(L) {
    if (L.orcamento === null) return '<div class="cxv-bar cxv-bar-vazia"><span>sem orçamento</span></div>';
    var o = L.orcamento || 1, esc100 = Math.max(100, L.pctUtilizado || 0), k = 100 / esc100;
    var rec = Math.max(0, L.recebido) / o * 100 * k, com = (L.comprometido || 0) / o * 100 * k;
    var marca100 = 100 * k;
    var h = '<div class="cxv-bar" title="Recebido ' + pct(L.pctRecebido) + ' · com o comprometido ' + pct(L.pctUtilizado) + '">' +
      '<i class="cxv-b-rec" style="width:' + Math.min(rec, 100) + '%"></i>' +
      '<i class="cxv-b-com" style="left:' + Math.min(rec, 100) + '%;width:' + Math.max(0, Math.min(com, 100 - Math.min(rec, 100))) + '%"></i>';
    if (L.pctUtilizado > 100) h += '<i class="cxv-b-over" style="left:' + marca100 + '%;width:' + (100 - marca100) + '%"></i>';
    h += '<b class="cxv-b-100" style="left:' + marca100 + '%"></b>';
    if (R.atual) h += '<b class="cxv-b-rit" style="left:' + (R.esperado * k) + '%" title="esperado até hoje"></b>';
    return h + "</div>";
  }
  function pill(st) { return '<span class="cxv-pill cxv-' + COR[st.cod] + '">' + esc(st.txt) + "</span>"; }
  function avisos(L) {
    // Conta só o que é DESTE setor. Pedido fantasma existe em todos (é arrumação da loja
    // inteira, tem seção própria) — contado aqui, todo setor teria aviso e o aviso não diria nada.
    var n = L.alertas.filter(function (a) { return a.tipo === "naofin" || a.tipo === "margem" || a.tipo === "semcusto"; }).length;
    return n ? '<span class="cxv-avs" title="' + esc(L.alertas.map(function (a) { return a.txt; }).join(" · ")) + '">⚠ ' + n + "</span>" : "";
  }

  // Dado velho tem de SE MOSTRAR velho: o robô pode parar (loja sem rede, VR fora) e a tela
  // continuaria com cara de hoje. Passou de 3 h, a data fica vermelha e diz há quanto tempo.
  function dado() {
    var g = new Date(F.dados.gerado), h = (Date.now() - g.getTime()) / 36e5;
    var txt = "dados do VR de " + dm(F.dados.gerado.slice(0, 10)) + " às " + g.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    if (h < 3) return '<span class="cxv-dado">' + txt + "</span>";
    return '<span class="cxv-dado cxv-velho" title="O robô da loja atualiza sozinho quando está na rede da loja.">⚠ ' + txt + " — sem atualizar há " + (h < 48 ? Math.round(h) + " h" : Math.round(h / 24) + " dias") + "</span>";
  }
  function cabecalho() {
    var ss = semanas(), i = ss.indexOf(semSel), T = R.total;
    var ant = C.addDias(semSel, -7);
    var dia = C.diaSemana(F.dados.hoje);
    var h = '<div class="cxv-topo">' +
      '<div><h2>Compra × Venda</h2><p>Quanto cada setor pode comprar na semana, a partir do que vendeu na anterior.</p></div>' +
      '<span class="cxv-sombra" title="Nesta fase nada é bloqueado: a tela só observa.">MODO SOMBRA · nada é bloqueado</span></div>' +
      '<div class="cxv-nav">' +
      '<button class="cxv-sem-bt" data-sem="' + (ss[i - 1] || "") + '"' + (i > 0 ? "" : " disabled") + ' aria-label="Semana anterior">‹</button>' +
      '<div class="cxv-sem"><b>' + dm(R.ini) + " a " + dm(R.fim) + "</b>" +
      '<span>' + (R.atual ? "semana atual · hoje é " + DIAS[dia - 1] : R.fechada ? "semana fechada" : "semana") + "</span></div>" +
      '<button class="cxv-sem-bt" data-sem="' + (ss[i + 1] || "") + '"' + (i < ss.length - 1 ? "" : " disabled") + ' aria-label="Próxima semana">›</button>' +
      dado() + "</div>";

    if (F.simulado) h += '<div class="cxv-sim">SIMULAÇÃO DA PRÉVIA — a margem objetivo foi preenchida com a margem real da semana anterior só para mostrar a tela cheia. Você ainda não definiu nenhuma margem objetivo.</div>';
    var inc = T.semOrcamento ? '<div class="cxv-k-av">' + T.semOrcamento + " setor" + (T.semOrcamento > 1 ? "es" : "") + " sem margem objetivo — fora desta soma</div>" : "";
    h += '<div class="cxv-kpis">' +
      '<div class="cxv-k"><div class="cxv-k-q">Quanto eu podia comprar?</div><div class="cxv-k-v">' + (T.orcamento ? brl(T.orcamento) : "—") + "</div>" +
      '<div class="cxv-k-s">orçamento · venda de ' + dm(ant) + " a " + dm(C.addDias(ant, 6)) + ' <span class="cxv-sens">' + brl(T.venda) + "</span></div>" + inc + "</div>" +
      '<div class="cxv-k"><div class="cxv-k-q">Quanto já chegou?</div><div class="cxv-k-v">' + brl(T.recebido) + "</div>" +
      '<div class="cxv-k-s">notas finalizadas, já sem as devoluções</div>' +
      (T.naoFinalizado > 0 ? '<button class="cxv-nf" data-nf="">⚠ Não finalizado ' + brl(T.naoFinalizado) + " <u>ver notas</u></button>" : "") + "</div>" +
      '<div class="cxv-k"><div class="cxv-k-q">Quanto já pedi e ainda vai chegar?</div><div class="cxv-k-v">' + (R.atual ? brl(T.comprometido) : "—") + "</div>" +
      '<div class="cxv-k-s">' + (R.atual ? "pedidos válidos ainda sem nota" + (T.futuro ? " · mais " + brl(T.futuro) + " para as próximas semanas" : "") : "só existe para a semana atual") + "</div>" +
      (R.atual ? '<button class="cxv-lk" data-ped="">ver pedidos</button>' : "") + "</div>" +
      '<div class="cxv-k cxv-k-disp' + (T.disponivel !== null && T.disponivel < 0 ? " neg" : "") + '"><div class="cxv-k-q">Quanto ainda posso comprar?</div><div class="cxv-k-v">' + brl(T.disponivel) + "</div>" +
      '<div class="cxv-k-s">' + (T.pctUtilizado !== null ? pct(T.pctUtilizado) + " do orçamento usado" + (R.atual ? " · esperado até " + DIAS[dia - 1] + ": " + pct(R.esperado) : "") : "defina as margens objetivo para calcular") + "</div></div>" +
      "</div>";
    return h;
  }

  function tabela() {
    var h = '<div class="cxv-card"><div class="cxv-leg"><span><i class="cxv-b-rec"></i>recebido</span><span><i class="cxv-b-com"></i>comprometido</span>' +
      (R.atual ? '<span><b class="cxv-b-rit"></b>esperado até hoje</span>' : "") + "<span><b class=\"cxv-b-100\"></b>100% do orçamento</span></div>" +
      '<div class="cxv-tw"><table class="cxv-tab"><thead><tr>' +
      '<th class="l">Setor</th><th>Venda<br>sem. anterior</th><th>Margem objetivo<br><span class="cxv-th2">real anterior</span></th><th>Orçamento</th>' +
      "<th>Recebido</th><th>Compro-<br>metido</th><th>Disponível</th><th class=\"l cxv-th-bar\">% utilizado</th><th>Não<br>finalizado</th><th class=\"l\">Situação</th></tr></thead><tbody>";
    R.linhas.forEach(function (L) {
      var ab = abertos[L.setor];
      h += '<tr class="cxv-lin' + (ab ? " aberto" : "") + '" data-s="' + L.setor + '" tabindex="0">' +
        '<td class="l"><span class="cxv-seta">' + (ab ? "▾" : "▸") + "</span><b>" + esc(L.nome) + "</b></td>" +
        '<td class="cxv-sens">' + brl(L.venda) + "</td>" +
        "<td>" + (L.margemObjetivo === null ? '<span class="cxv-nd">NÃO DEFINIDA</span>' : "<b>" + pct(L.margemObjetivo, 1) + "</b>") +
        '<span class="cxv-mr cxv-sens">real ' + pct(L.margemReal, 1) + "</span></td>" +
        "<td><b>" + brl(L.orcamento) + "</b></td>" +
        "<td>" + brl(L.recebido) + "</td>" +
        "<td>" + (L.comprometido === null ? '<span class="cxv-cz">—</span>' : brl(L.comprometido)) + "</td>" +
        '<td class="' + (L.disponivel !== null && L.disponivel < 0 ? "cxv-neg" : "") + '"><b>' + brl(L.disponivel) + "</b></td>" +
        '<td class="l cxv-td-bar"><div class="cxv-bw">' + barra(L) + '<span class="cxv-pc">' + pct(L.pctUtilizado) + "</span></div></td>" +
        "<td>" + (L.naoFinalizado ? '<button class="cxv-nf cxv-nf-p" data-nf="' + L.setor + '">⚠ ' + brl(L.naoFinalizado) + "</button>" : '<span class="cxv-cz">—</span>') + "</td>" +
        '<td class="l"><div class="cxv-st">' + pill(L.status) + avisos(L) + "</div></td></tr>";
      if (ab) h += '<tr class="cxv-det-tr"><td colspan="10">' + detalhe(L) + "</td></tr>";
    });
    var T = R.total;
    h += '</tbody><tfoot><tr><td class="l"><b>Loja</b></td><td class="cxv-sens">' + brl(T.venda) + "</td><td></td><td><b>" + brl(T.orcamento || null) + "</b></td><td>" + brl(T.recebido) +
      "</td><td>" + (R.atual ? brl(T.comprometido) : "—") + '</td><td class="' + (T.disponivel < 0 ? "cxv-neg" : "") + '"><b>' + brl(T.disponivel) + '</b></td><td class="l cxv-td-bar"><div class="cxv-bw"><span class="cxv-pc">' + pct(T.pctUtilizado) +
      "</span></div></td><td>" + (T.naoFinalizado ? brl(T.naoFinalizado) : "—") + '</td><td class="l cxv-cz">' + (T.semOrcamento ? T.semOrcamento + " sem margem objetivo" : "") + "</td></tr></tfoot></table></div>";
    // CELULAR: um cartão por setor (a tabela de 11 colunas não cabe)
    h += '<div class="cxv-cards">';
    R.linhas.forEach(function (L) {
      var ab = abertos[L.setor];
      h += '<div class="cxv-sc' + (ab ? " aberto" : "") + '"><button class="cxv-sc-cab cxv-lin" data-s="' + L.setor + '"><b>' + esc(L.nome) + "</b>" + pill(L.status) + avisos(L) + '<span class="cxv-seta">' + (ab ? "▾" : "▸") + "</span></button>" +
        '<div class="cxv-sc-g"><div><span>Podia comprar</span><b>' + brl(L.orcamento) + "</b></div><div><span>Já chegou</span><b>" + brl(L.recebido) + "</b></div>" +
        "<div><span>Pedido a chegar</span><b>" + (L.comprometido === null ? "—" : brl(L.comprometido)) + '</b></div><div><span>Ainda pode</span><b class="' + (L.disponivel < 0 ? "cxv-neg" : "") + '">' + brl(L.disponivel) + "</b></div></div>" +
        '<div class="cxv-sc-bar">' + barra(L) + '<span class="cxv-pc">' + pct(L.pctUtilizado) + "</span></div>" +
        '<div class="cxv-sc-m">Margem objetivo <b>' + (L.margemObjetivo === null ? '<span class="cxv-nd">NÃO DEFINIDA</span>' : pct(L.margemObjetivo, 1)) + '</b> · real anterior <b class="cxv-sens">' + pct(L.margemReal, 1) + "</b>" +
        (L.naoFinalizado ? '<br><button class="cxv-nf cxv-nf-p" data-nf="' + L.setor + '">⚠ Não finalizado ' + brl(L.naoFinalizado) + "</button>" : "") + "</div>" +
        (ab ? '<div class="cxv-sc-det">' + detalhe(L) + "</div>" : "") + "</div>";
    });
    return h + "</div></div>";
  }

  function detalhe(L) {
    var ant = C.addDias(R.ini, -7);
    var conta = L.orcamento === null
      ? '<p class="cxv-dt-n">Sem orçamento: ' + (L.venda <= 0 ? "o setor não vendeu na semana anterior." : "falta a margem objetivo deste setor (Configuração, lá embaixo).") + "</p>"
      : '<p class="cxv-dt-n"><span class="cxv-sens">' + brl(L.venda, true) + "</span> vendidos de " + dm(ant) + " a " + dm(C.addDias(ant, 6)) + " × (1 − " + pct(L.margemObjetivo, 1) + ")" +
        (L.fator !== 1 ? " × " + String(L.fator).replace(".", ",") + ' <abbr title="A margem é sobre o custo SEM imposto; a nota vem COM imposto. O fator é o custo com imposto ÷ sem imposto do que este setor vendeu na semana-base.">fator de imposto</abbr>' : "") +
        " = <b>" + brl(L.orcamento, true) + "</b></p>";
    var rec = '<table class="cxv-mini"><tr><td>Notas de compra finalizadas</td><td>' + brl(L.recebidoBruto, true) + "</td></tr>" +
      (L.devolucao ? "<tr><td>− Devolução ao fornecedor</td><td>" + brl(-L.devolucao, true) + "</td></tr>" : "") +
      // Só o LÍQUIDO: reclassificação dentro do próprio setor (boi que vira corte) entra e sai igual.
      (Math.abs(L.reclassEntra - L.reclassSai) >= 0.01 ? "<tr><td>" + (L.reclassEntra > L.reclassSai ? "+ Veio de outro setor" : "− Foi para outro setor") +
        ' por reclassificação <span class="cxv-cz">(ex.: fruta que vira suco)</span></td><td>' + brl(L.reclassEntra - L.reclassSai, true) + "</td></tr>" : "") +
      '<tr class="t"><td>Recebido</td><td>' + brl(L.recebido, true) + "</td></tr>" +
      (L.bonificacao ? '<tr class="cz"><td>Bonificação (não é compra; guardada para o estoque)</td><td>' + brl(L.bonificacao, true) + "</td></tr>" : "") + "</table>";
    var al = L.alertas.length ? '<ul class="cxv-al">' + L.alertas.map(function (a) {
      return '<li class="cxv-al-' + a.tipo + '">' + (a.valor !== undefined ? "<b>" + brl(a.valor) + "</b> " : "") + esc(a.txt) + (a.n ? " (" + a.n + " pedidos)" : "") + "</li>"; }).join("") + "</ul>"
      : '<p class="cxv-dt-n">Nada fora do normal neste setor.</p>';
    var peds = R.atual ? F.dados.pedidos.filter(function (p) { return p.classe === "comprometido" && p.setores[L.setor]; }) : [];
    var ph = peds.length ? '<div class="cxv-tw"><table class="cxv-mini cxv-lista"><tr><th>Pedido</th><th>Fornecedor</th><th>Entrega</th><th>Deste setor</th></tr>' +
      peds.sort(function (a, b) { return b.setores[L.setor] - a.setores[L.setor]; }).map(function (p) {
        return "<tr><td>" + p.id + "</td><td>" + esc(p.forn) + "</td><td>" + dm(p.entrega) + (p.entrega < F.dados.hoje ? ' <span class="cxv-atr">atrasado</span>' : "") + "</td><td>" + brl(p.setores[L.setor], true) + "</td></tr>"; }).join("") + "</table></div>"
      : '<p class="cxv-dt-n">' + (R.atual ? "Nenhum pedido pendente para este setor." : "Semana fechada: o comprometido só existe na semana atual.") + "</p>";
    var trz = F.dados.mapa.filter(function (x) { return x.ger === L.setor || x.vr === L.setor; });
    var mh = trz.length ? '<p class="cxv-dt-n">' + trz.filter(function (x) { return x.ger === L.setor; }).length + " produto(s) contados aqui por decisão gerencial; " +
      trz.filter(function (x) { return x.vr === L.setor; }).length + " saíram daqui. Lista em “Setor do VR × setor gerencial”.</p>" : "";
    return '<div class="cxv-dt"><div><h4>De onde vem o orçamento</h4>' + conta + "<h4>O que conta como recebido</h4>" + rec + "</div>" +
      "<div><h4>Tem alguma coisa estranha?</h4>" + al + mh + "<h4>Pedidos que ainda vão chegar</h4>" + ph + "</div></div>";
  }

  function secoes() {
    var h = "";
    // ---- pendências de pedido ----
    var ps = F.dados.pendenciasSetor || {}, rp = F.dados.resumoPedidos || {};
    var linhasP = Object.keys(ps).map(function (m) { return { m: m, n: C.nomeSetor(F.dados.setores[m]), a: ps[m].antigo_sem_nota, s: ps[m].sobra_parcial, r: ps[m].sobra_recente, na: ps[m].n_antigo, ns: ps[m].n_sobra }; })
      .sort(function (x, y) { return (y.a + y.s) - (x.a + x.s); });
    h += sec("pend", "Pedidos em aberto que NÃO entram na conta", brl((rp.antigo_sem_nota || {}).saldo) + " + " + brl((rp.sobra_parcial || {}).saldo),
      '<p class="cxv-ex">O VR ainda mostra saldo nesses pedidos, mas as evidências dizem que ele não vai chegar. Eles ficam <b>fora</b> do comprometido e aparecem aqui para revisão, sem sumir:</p>' +
      '<ul class="cxv-ex"><li><b>Antigo sem nota</b>: pedido que nunca recebeu nota e está ' + F.dados.toleranciaDias + ' dias ou mais atrasado. Medido: 98,5% das primeiras notas chegam até ' + F.dados.toleranciaDias + ' dias depois da data de entrega.</li>' +
      '<li><b>Sobra de entrega parcial</b>: o pedido já recebeu nota, mas este item não veio (ou veio em parte). Medido: dos itens que não vêm na primeira nota, só 19% chegam depois; 81% nunca chegam. A coluna “recente” é a parte cuja última nota tem menos de ' + F.dados.toleranciaDias + ' dias, a única que ainda pode chegar.</li></ul>' +
      '<div class="cxv-tw"><table class="cxv-mini cxv-lista"><tr><th>Setor</th><th>Antigo sem nota</th><th>Sobra de entrega parcial</th><th>…dessa, recente</th></tr>' +
      linhasP.map(function (x) { return "<tr><td>" + esc(x.n) + "</td><td>" + brl(x.a) + ' <span class="cxv-cz">(' + x.na + ")</span></td><td>" + brl(x.s) + ' <span class="cxv-cz">(' + x.ns + ")</span></td><td>" + brl(x.r) + "</td></tr>"; }).join("") +
      "</table></div>");
    // ---- setor VR × gerencial ----
    h += sec("mapa", "Setor do VR × setor gerencial", F.dados.mapa.length + " produtos",
      '<p class="cxv-ex">Produtos que o Compra × Venda conta num setor diferente do cadastro do VR. Um a um, nunca o setor inteiro. <b>O cadastro do VR não é alterado.</b> Esta lista é também a lista de divergências, para decidir depois se vale corrigir direto no VR.</p>' +
      '<div class="cxv-tw"><table class="cxv-mini cxv-lista"><tr><th>Cód.</th><th>Produto</th><th>Setor no VR</th><th></th><th>Setor gerencial</th><th>Motivo</th><th>Situação</th></tr>' +
      F.dados.mapa.map(function (x) { return "<tr><td>" + x.id + "</td><td>" + esc(x.desc) + "</td><td>" + esc(C.nomeSetor(F.dados.setores[x.vr])) + '</td><td class="cxv-cz">→</td><td><b>' + esc(C.nomeSetor(F.dados.setores[x.ger])) + "</b></td><td>" + esc(x.motivo) + "</td><td>" +
        (x.confirmar ? '<span class="cxv-pill cxv-am">' + esc(x.confirmar) + "</span>" : '<span class="cxv-pill cxv-cz">proposta — confirmar</span>') + "</td></tr>"; }).join("") +
      "</table></div>" + '<p class="cxv-ex cxv-cz">' + (F.previa ? "Na versão final: incluir e desfazer por aqui (só master), cada mudança gravada com quem, quando e por quê." : "Por enquanto esta lista é mantida no sistema, com histórico de cada mudança. Para incluir ou tirar um produto, é só pedir.") + "</p>");
    // ---- configuração ----
    var todos = {}; F.dados.semanas.forEach(function (s) { for (var k in s.setores) if (s.setores[k].venda > 0) todos[k] = 1; });
    var sets = Object.keys(todos).sort(function (a, b) { return C.nomeSetor(F.dados.setores[a]).localeCompare(C.nomeSetor(F.dados.setores[b])); });
    var cf = '<p class="cxv-ex">A margem objetivo é a base oficial do orçamento. Em branco = <b>não definida</b> (o setor fica sem orçamento, nunca vira 0%). A margem real aparece só para comparar.</p>' +
      '<div class="cxv-tw"><table class="cxv-mini cxv-cfg"><tr><th>Setor</th><th>Margem objetivo</th><th>Real (sem. anterior)</th><th>Pode estocar?</th></tr>';
    sets.forEach(function (m) {
      var c = F.conf[m] || {}, L = R.linhas.filter(function (x) { return x.setor === m; })[0];
      cf += "<tr><td>" + esc(C.nomeSetor(F.dados.setores[m])) + '</td><td><input class="cxv-in" data-cf="m" data-s="' + m + '" inputmode="decimal" placeholder="não definida" value="' + (C.tem(c.margemObjetivo) ? String(c.margemObjetivo).replace(".", ",") : "") + '"' + (F.podeEditar ? "" : " disabled") + '> %</td>' +
        '<td class="cxv-sens cxv-cz">' + (L ? pct(L.margemReal, 1) : "—") + "</td>" +
        '<td><select class="cxv-in" data-cf="e" data-s="' + m + '"' + (F.podeEditar ? "" : " disabled") + ">" +
        '<option value=""' + (c.permiteEstoque == null ? " selected" : "") + ">não definido</option>" +
        '<option value="1"' + (c.permiteEstoque === true ? " selected" : "") + ">sim</option>" +
        '<option value="0"' + (c.permiteEstoque === false ? " selected" : "") + ">não</option></select></td></tr>";
    });
    cf += "</table></div>";
    if (!F.previa) cf += '<p class="cxv-ex cxv-cz">' + (F.podeEditar ? "Mudou, gravou: cada mudança fica registrada com o seu nome e a hora." : "Só o master altera a margem objetivo.") + "</p>";
    if (F.previa) cf += '<div class="cxv-prev"><b>Só nesta prévia:</b> <button class="cxv-bt2" data-sim="real">Preencher com a margem real (para ver a tela cheia)</button> <button class="cxv-bt2" data-sim="limpar">Limpar tudo</button>' +
      '<br><span class="cxv-cz">Nada aqui é gravado. Na versão final, só o master altera, e cada alteração fica registrada.</span></div>';
    h += sec("cfg", "Configuração dos setores", "margem objetivo e estoque", cf);
    // ---- como a conta é feita ----
    h += sec("como", "Como a conta é feita", "",
      '<ul class="cxv-ex"><li><b>Orçamento</b> = venda da semana anterior × (1 − margem objetivo) × fator de imposto. O fator existe porque a margem do Painel é sobre o custo sem imposto e a nota vem com imposto.</li>' +
      "<li><b>Recebido</b> = notas de compra (compra, produtor rural, compra para produção) já <b>finalizadas</b>, pela data de entrada, menos a devolução ao fornecedor. Reclassificação (fruta que vira suco, caixa que vira unidade) passa o valor de um setor para o outro.</li>" +
      "<li><b>Não finalizado</b> fica fora do recebido. Quando a nota é finalizada, passa sozinha para o recebido.</li>" +
      "<li><b>Comprometido</b> = o que falta chegar de pedido finalizado, de compra, sem nenhuma nota ligada e com entrega até " + F.dados.toleranciaDias + " dias atrás ou nesta semana. Pedido com entrega depois do domingo conta na semana dele.</li>" +
      "<li><b>Disponível</b> = orçamento − recebido − comprometido. <b>% utilizado</b> = (recebido + comprometido) ÷ orçamento.</li>" +
      "<li><b>Ritmo</b>: a loja recebe " + F.dados.ritmo.map(function (r, i) { return DIAS[i].slice(0, 3) + " " + pct(r * 100); }).slice(0, 6).join(" · ") + " (acumulado, média de 12 semanas). Na semana atual, a situação compara com esse ritmo, não com o percentual puro.</li>" +
      "<li>Bonificação não é compra, mas fica guardada: vai servir à leitura de estoque.</li></ul>");
    return h;
  }
  function sec(id, tit, resumo, corpo) {
    var ab = abertos["sec-" + id];
    return '<div class="cxv-card cxv-sec"><button class="cxv-sec-cab" data-sec="' + id + '"><span class="cxv-seta">' + (ab ? "▾" : "▸") + "</span><b>" + tit + '</b><span class="cxv-cz">' + resumo + "</span></button>" +
      (ab ? '<div class="cxv-sec-c">' + corpo + "</div>" : "") + "</div>";
  }

  function modalNotas(setor) {
    var lista = F.dados.naoFinalizadas.filter(function (n) {
      var naSemana = (n.entrada >= R.ini && n.entrada <= R.fim) || (R.atual && n.entrada < R.ini);
      return naSemana && (!setor || n.setores[setor]); });
    var tot = 0;
    var h = '<div class="cxv-mod-f" role="dialog" aria-modal="true"><div class="cxv-mod"><div class="cxv-mod-cab"><b>Notas não finalizadas' + (setor ? " · " + esc(C.nomeSetor(F.dados.setores[setor])) : "") + "</b>" +
      '<button class="cxv-x" aria-label="Fechar">×</button></div><p class="cxv-ex">Lançadas no VR e ainda não finalizadas: <b>não</b> entram no recebido. Quando forem finalizadas, entram sozinhas.' + (R.atual ? " Na semana atual aparecem também as paradas de semanas anteriores." : "") + "</p>" +
      '<div class="cxv-tw"><table class="cxv-mini cxv-lista"><tr><th>Nota</th><th>Fornecedor</th><th>Entrada</th><th>Parada há</th><th>' + (setor ? "Deste setor" : "Valor") + "</th><th>Setores</th></tr>";
    lista.sort(function (a, b) { return a.entrada < b.entrada ? -1 : 1; }).forEach(function (n) {
      var v = setor ? n.setores[setor] : n.valor; tot += v;
      var dias = Math.round((new Date(F.dados.hoje + "T12:00:00Z") - new Date(n.entrada + "T12:00:00Z")) / 864e5);
      h += "<tr><td>" + n.numero + "</td><td>" + esc(n.forn) + "</td><td>" + dm(n.entrada) + "</td><td" + (dias > 7 ? ' class="cxv-neg"' : "") + ">" + (dias <= 0 ? "hoje" : dias + " dia" + (dias > 1 ? "s" : "")) + "</td><td>" + brl(v, true) + '</td><td class="cxv-cz">' +
        Object.keys(n.setores).map(function (k) { return esc(C.nomeSetor(F.dados.setores[k])); }).join(", ") + "</td></tr>";
    });
    h += '<tr class="t"><td colspan="4">' + lista.length + " nota" + (lista.length === 1 ? "" : "s") + "</td><td>" + brl(tot, true) + "</td><td></td></tr></table></div></div></div>";
    return h;
  }
  function modalPedidos() {
    var lista = F.dados.pedidos.filter(function (p) { return p.classe === "comprometido" || p.classe === "futuro"; })
      .sort(function (a, b) { return a.entrega < b.entrega ? -1 : 1; });
    var h = '<div class="cxv-mod-f" role="dialog" aria-modal="true"><div class="cxv-mod"><div class="cxv-mod-cab"><b>Pedidos que ainda vão chegar</b><button class="cxv-x" aria-label="Fechar">×</button></div>' +
      '<p class="cxv-ex">Pedido finalizado no VR, de compra, sem nenhuma nota ligada. O valor é só o que falta chegar.</p><div class="cxv-tw"><table class="cxv-mini cxv-lista"><tr><th>Pedido</th><th>Fornecedor</th><th>Entrega</th><th>Conta em</th><th>Falta chegar</th><th>Setores</th></tr>';
    lista.forEach(function (p) {
      h += "<tr><td>" + p.id + "</td><td>" + esc(p.forn) + "</td><td>" + dm(p.entrega) + (p.entrega < F.dados.hoje ? ' <span class="cxv-atr">atrasado</span>' : "") + "</td><td>" + (p.classe === "futuro" ? "semana de " + dm(C.addDias(p.entrega, -(C.diaSemana(p.entrega) - 1))) : "esta semana") + "</td><td>" + brl(p.saldo, true) + '</td><td class="cxv-cz">' +
        Object.keys(p.setores).map(function (k) { return esc(C.nomeSetor(F.dados.setores[k])); }).join(", ") + "</td></tr>";
    });
    return h + "</table></div></div></div>";
  }

  function desenhar() {
    R = C.calcularSemana(F.dados, F.conf, semSel);
    F.raiz.innerHTML = '<div class="cxv">' + cabecalho() + tabela() + secoes() + "</div>";
  }
  function abrirModal(html) {
    var d = document.createElement("div"); d.innerHTML = html; var m = d.firstChild; document.body.appendChild(m);
    var fechar = function () { if (m.parentNode) m.parentNode.removeChild(m); document.removeEventListener("keydown", tecla); };
    var tecla = function (e) { if (e.key === "Escape") fechar(); };
    m.addEventListener("click", function (e) { if (e.target === m || e.target.closest(".cxv-x")) fechar(); });
    document.addEventListener("keydown", tecla);
    m.querySelector(".cxv-x").focus();
  }

  window.cxvMontar = function (raiz, fonte) {
    F = fonte; F.raiz = raiz; semSel = F.dados.semanaAtual;
    if (raiz.__cxvLigado) return desenhar(); // recarregou os dados: os cliques já estão ligados
    raiz.__cxvLigado = true;
    raiz.addEventListener("click", function (e) {
      var t = e.target.closest ? e.target : null; if (!t) return;
      var b;
      if ((b = t.closest(".cxv-nf"))) { e.stopPropagation(); return abrirModal(modalNotas(b.getAttribute("data-nf"))); }
      if ((b = t.closest("[data-ped]"))) return abrirModal(modalPedidos());
      if ((b = t.closest(".cxv-sem-bt"))) { if (b.getAttribute("data-sem")) { semSel = b.getAttribute("data-sem"); desenhar(); } return; }
      if ((b = t.closest("[data-sec]"))) { var k = "sec-" + b.getAttribute("data-sec"); abertos[k] = !abertos[k]; return desenhar(); }
      if ((b = t.closest("[data-sim]"))) {
        if (b.getAttribute("data-sim") === "limpar") { F.conf = {}; F.simulado = false; }
        else { F.simulado = true; var base = C.calcularSemana(F.dados, {}, semSel); base.linhas.forEach(function (L) { if (L.margemReal !== null) F.conf[L.setor] = Object.assign({}, F.conf[L.setor], { margemObjetivo: Math.round(L.margemReal * 10) / 10 }); }); }
        return desenhar();
      }
      if ((b = t.closest(".cxv-lin"))) { var s = b.getAttribute("data-s"); abertos[s] = !abertos[s]; return desenhar(); }
    });
    raiz.addEventListener("keydown", function (e) { if (e.key === "Enter" && e.target.classList && e.target.classList.contains("cxv-lin")) e.target.click(); });
    raiz.addEventListener("change", function (e) {
      var i = e.target; if (!i.getAttribute || !i.getAttribute("data-cf")) return;
      var s = i.getAttribute("data-s"), velho = F.conf[s] ? Object.assign({}, F.conf[s]) : null, c = F.conf[s] = Object.assign({}, F.conf[s]);
      if (i.getAttribute("data-cf") === "m") {
        var v = i.value.trim().replace(",", ".");
        if (v === "") c.margemObjetivo = null;
        else if (!isFinite(+v) || +v < 0 || +v >= 100) { i.classList.add("cxv-erro"); i.title = "Digite um número entre 0 e 99,9"; return; }
        else c.margemObjetivo = +v;
      } else c.permiteEstoque = i.value === "" ? null : i.value === "1";
      if (!F.salvarSetor) return desenhar(); // prévia: só na memória
      i.disabled = true;
      F.salvarSetor(s, c).then(function (erro) {
        if (erro) { // volta ao que estava e diz por quê — nunca fica mostrando o que não gravou
          if (velho) F.conf[s] = velho; else delete F.conf[s];
          if (window.uiConfirm) window.uiConfirm({ titulo: "Não gravou", msg: erro, ok: "OK", cancel: "" }); else alert("Não gravou: " + erro);
        }
        desenhar();
      });
    });
    desenhar();
  };
})();
