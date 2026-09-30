/* ==AV-PRODUTOS== AVARIAS · Produtos e setores (ANÁLISE) e a ficha do produto. SOMENTE LEITURA.
   Não existe corte de alerta, nem lista de funcionário, nem coluna de fornecedor, nem usuário do coletor na tabela.
   O usuário do coletor só aparece na ficha, em cada movimento, com o aviso "registrou o fato; não indica quem causou".
   O fornecedor relacionado (última compra) só é lido quando a ficha NÃO foi aberta a partir das Pendências. */
(function () {
  "use strict";
  var AV = window.AV;
  // "entradas" só para a evolução dos setores pelos mesmos dias quando o período tem o mês atual (parcial)
  var LEITURAS = ["produtosMes", "venda", "parado", "filaA", "entradas"];
  // o que a pessoa escolheu nesta área (ordem, busca, quantas linhas); vale enquanto a página está aberta
  var tab = { ord: "valor", desc: true, busca: "", n: 50 };

  AV.areas.produtos = function (el) {
    AV.carregando(el);
    AV.lerVarias(LEITURAS).then(function (d) { desenhar(el, d); }, function (e) { AV.falhou(el, e); });
  };

  // célula com mais de uma parte: um bloco só (no celular a célula vira "rótulo ... conteúdo")
  var cx = function (h) { return '<span class="av-produtos-cx">' + h + "</span>"; };

  // ---------- contas ----------
  var mesAtual = function () { return AV.hoje().slice(0, 7); };
  // plural certo: "1 ocorrência", "2 ocorrências" (só a palavra)
  var pl = function (n, um, varios) { return AV.n(n) === 1 ? um : varios; };
  // meses do período para o % da venda. Só conta o mês que TEM venda na base e não traz o dia de hoje — no numerador
  // (avaria) E no denominador (venda). Fora: o mês corrente (a venda do dia ainda não tem custo fechado) e o mês sem venda
  // na base (a venda por setor só existe a partir de um certo mês; mês sem linha nenhuma NÃO é mês fechado).
  function mesesVenda(d, meses) {
    var o = { ok: [], corrente: [], semVenda: [] };
    meses.forEach(function (m) {
      var V = d.venda.filter(function (v) { return v.mes === m; });
      if (m >= mesAtual() || V.some(function (v) { return v.inclui_dia_corrente; })) o.corrente.push(m);
      else if (!V.length) o.semVenda.push(m);
      else o.ok.push(m);
    });
    return o;
  }
  // os meses que valem para UM setor: os fechados em que o setor tem linha de venda
  function mesesDoSetor(d, ok, setor) {
    return ok.filter(function (m) { return d.venda.some(function (v) { return v.mes === m && String(v.setor_id) === String(setor); }); });
  }
  // texto dos meses que ficam fora do % da venda, cada um com o seu motivo
  function textoFora(mv) {
    var t = [];
    if (mv.corrente.length) t.push("fica fora o mês corrente (" + textoMeses(mv.corrente) + "): a venda do dia de hoje ainda não tem custo fechado");
    if (mv.semVenda.length) t.push("fica fora " + textoMeses(mv.semVenda) + ": sem venda na base para " + (mv.semVenda.length === 1 ? "esse mês" : "esses meses") +
      " (a avaria " + (mv.semVenda.length === 1 ? "dele" : "deles") + " também fica fora da conta)");
    return t.join("; ");
  }
  // período anterior de mesmo tamanho; nulo quando ele cai antes do começo do livro (19/10/2023)
  function anterior(p) {
    var a = AV.periodoAnterior(p);
    return a[0] < AV.PRIMEIRO_MES ? null : a;
  }
  // linhas de produto × mês × motivo que valem nos filtros (setor opcional)
  function linhas(d, meses, comSetor) {
    return d.produtosMes.filter(function (r) {
      return meses.indexOf(r.mes) >= 0 && AV.noMotivo(r.motivo) && (!comSetor || AV.noSetor(r.setor_id));
    });
  }
  var valorDe = function (r) { return AV.n(r.valor_data) + AV.n(r.valor_estimado); };
  function somar(L) {
    return { data: AV.soma(L, function (r) { return r.valor_data; }), est: AV.soma(L, function (r) { return r.valor_estimado; }),
      sem: AV.soma(L, function (r) { return r.sem_custo; }), oc: AV.soma(L, function (r) { return r.ocorrencias; }), total: AV.soma(L, valorDe) };
  }
  // motivo principal = o de maior valor (empate: o de mais ocorrências; depois o nome, nunca o código)
  function motivoPrincipal(L) {
    var pm = {};
    L.forEach(function (r) { var o = pm[r.motivo] || (pm[r.motivo] = { m: r.motivo, v: 0, oc: 0 }); o.v += valorDe(r); o.oc += AV.n(r.ocorrencias); });
    var M = Object.keys(pm).map(function (k) { return pm[k]; }).sort(function (a, b) {
      return b.v - a.v || b.oc - a.oc || AV.nomeMotivo(+a.m).localeCompare(AV.nomeMotivo(+b.m), "pt-BR"); });
    return M[0] || null;
  }
  // variação entre dois valores, em texto (o anterior zero não tem porcentagem)
  function variacao(atual, ant) {
    if (ant === null) return { txt: "—", cls: "", dif: null };
    var dif = atual - ant;
    if (Math.abs(ant) < 0.005) return { txt: atual > 0.004 ? "antes sem entrada" : "sem entrada nos dois", cls: "av-produtos-novo", dif: dif };
    var pc = 100 * dif / ant;
    // acima de 10 vezes a porcentagem vira ruído: diz quantas vezes
    var txt = pc >= 900 ? AV.int(Math.floor(atual / ant)) + " vezes o anterior" : (pc > 0.05 ? "+" : pc < -0.05 ? "−" : "") + AV.pct(Math.abs(pc));
    return { txt: txt, cls: pc > 0.05 ? "av-produtos-sobe" : pc < -0.05 ? "av-produtos-desce" : "", dif: dif };
  }

  function textoMeses(M) { return M.length > 3 ? AV.mesCurto(M[0]) + " a " + AV.mesCurto(M[M.length - 1]) : M.map(AV.mesCurto).join(", "); }

  // ---------- 1. qualidade da base (curta, no topo) ----------
  function qualidade(d, p) {
    var L = linhas(d, p.meses, true), s = somar(L);
    var pData = s.total > 0.004 ? 100 * s.data / s.total : null, pEst = s.total > 0.004 ? 100 * s.est / s.total : null;
    var idAcertar = Object.keys(AV.setores).filter(function (k) { return AV.setores[k] === "A acertar"; });
    var LA = L.filter(function (r) { return idAcertar.indexOf(String(r.setor_id)) >= 0; }), prodA = {};
    LA.forEach(function (r) { prodA[r.id_produto] = 1; });
    var mv = mesesVenda(d, p.meses), fech = mv.ok, fora = textoFora(mv);
    var V = d.venda.filter(function (v) { return fech.indexOf(v.mes) >= 0 && AV.noSetor(v.setor_id); });
    var vv = AV.soma(V, function (v) { return v.venda_valor; }), vs = AV.soma(V, function (v) { return v.preco_sem_custo; });
    var nA = Object.keys(prodA).length;
    var itens = [
      ["Pelo custo da data", pData === null ? "—" : AV.pct(pData) + " do valor"],
      ["Pelo custo estimado", pEst === null ? "—" : '<span class="av-est">' + AV.rs(s.est) + "</span> · " + AV.pct(pEst)],
      ["Sem custo conhecido", '<span class="' + (s.sem ? "av-semc" : "") + '">' + AV.int(s.sem) + " " + pl(s.sem, "ocorrência", "ocorrências") + "</span>"],
      ["Setor “A acertar”", AV.int(nA) + " " + pl(nA, "produto", "produtos") + " · " + AV.rs(AV.soma(LA, valorDe))],
      ["Venda sem custo na base", fech.length && vv > 0 ? AV.pct(100 * vs / vv) + " do valor vendido" : "—"]
    ];
    var h = '<div class="av-card av-produtos-qual" data-av-bloco="qualidade"><h3>Qualidade da base</h3><dl class="av-produtos-qual-l">';
    itens.forEach(function (x) { h += "<div><dt>" + x[0] + "</dt><dd>" + x[1] + "</dd></div>"; });
    h += '</dl><p class="av-k-nota">Entradas por motivo de avaria no período e nos filtros. Custo estimado = custo de hoje, usado só onde o VR não tem custo para a data. ' +
      "A venda sem custo é do VR (itens vendidos sem custo cadastrado) e vale só para os meses fechados com venda na base" +
      (fech.length ? " (" + textoMeses(fech) + ")" : ": nenhum no período") + (fora ? "; " + fora : "") + ".</p></div>";
    return h;
  }

  // ---------- 2. setores ----------
  // o anterior do setor: quando o período tem o mês atual (parcial), o mês que corresponde a ele no anterior
  // entra só pelos mesmos dias (1 até o dia de hoje), para comparar o comparável
  function anteriorSetores(d, p) {
    var ant = anterior(p); if (!ant) return null;
    var i = p.meses.indexOf(mesAtual()), mdMes = i >= 0 ? ant[i] : null, o = {};
    d.entradas.forEach(function (r) {
      if (r.classe !== "avaria" || ant.indexOf(r.mes) < 0 || !AV.noMotivo(r.motivo)) return;
      var md = r.mes === mdMes;
      o[r.setor_id] = (o[r.setor_id] || 0) + (md ? AV.n(r.valor_data_mesmos_dias) + AV.n(r.valor_estimado_mesmos_dias) : AV.n(r.valor_data) + AV.n(r.valor_estimado));
    });
    return o;
  }
  // série pequena de 6 meses (fim = último mês do período); cores só por classe
  function serie(d, setor, fim) {
    var M = []; for (var k = 5; k >= 0; k--) M.push(AV.mesSomar(fim, -k));
    var v = M.map(function (m) { return AV.soma(d.produtosMes.filter(function (r) { return r.mes === m && String(r.setor_id) === String(setor) && AV.noMotivo(r.motivo); }), valorDe); });
    var mx = Math.max.apply(null, v.concat([0.01])), W = 78, H = 24, g = W / 6, bw = g - 3;
    var h = '<svg class="av-produtos-sp" viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="Entrou em avaria nos últimos 6 meses">';
    M.forEach(function (m, i) {
      var a = Math.max(1, (H - 2) * v[i] / mx), cl = v[i] < 0.005 ? "av-produtos-sp-b av-produtos-sp-zero" : m === mesAtual() ? "av-produtos-sp-b av-produtos-sp-parcial" : "av-produtos-sp-b";
      h += '<rect class="' + cl + '" x="' + (i * g + 1).toFixed(1) + '" y="' + (H - a).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + a.toFixed(1) + '"><title>' +
        AV.mesNome(m) + ": " + AV.rs(v[i]) + (m === mesAtual() ? " (mês parcial)" : "") + "</title></rect>";
    });
    return h + "</svg>";
  }
  function setores(d, p) {
    var L = linhas(d, p.meses, true), ps = {};
    L.forEach(function (r) { (ps[r.setor_id] = ps[r.setor_id] || []).push(r); });
    var mv = mesesVenda(d, p.meses), fech = mv.ok, fora = textoFora(mv), ant = anteriorSetores(d, p), fim = p.meses[p.meses.length - 1];
    var S = Object.keys(ps).map(function (k) {
      // numerador e denominador com os MESMOS meses: os fechados em que este setor tem venda na base
      var ms = mesesDoSetor(d, fech, k), s = somar(ps[k]), V = d.venda.filter(function (v) { return ms.indexOf(v.mes) >= 0 && String(v.setor_id) === k; });
      var vc = AV.soma(V, function (v) { return v.venda_custo; }), ef = AV.soma(ps[k].filter(function (r) { return ms.indexOf(r.mes) >= 0; }), valorDe);
      var falta = fech.filter(function (m) { return ms.indexOf(m) < 0; });
      return { id: k, s: s, pv: ms.length && vc > 0 ? 100 * ef / vc : null, falta: falta, mp: motivoPrincipal(ps[k]), ant: ant ? AV.n(ant[k]) : null };
    }).sort(function (a, b) { return b.s.total - a.s.total; });
    var parcial = p.meses.indexOf(mesAtual()) >= 0;
    var h = '<div class="av-card" data-av-bloco="setores"><h3>Setores</h3><p class="av-sub">Entrou em avaria por setor, pelo custo da data. Clique num setor para ver só os produtos dele. ' +
      "O grupo do mercadológico (nível 2) não foi trazido do VR: o setor abre direto os produtos.</p>";
    if (AV.estado.setor) h += '<p class="av-produtos-filtro">Mostrando só <b>' + AV.esc(AV.nomeSetor(AV.estado.setor)) + '</b> <button type="button" class="av-lk" data-av-prod="todos-setores">Ver todos os setores</button></p>';
    h += AV.tabela([
      { t: "Setor", cls: "l", cel: "principal", v: function (x) { return '<span class="av-nome">' + AV.esc(AV.nomeSetor(x.id)) + "</span>"; } },
      { t: "Valor", v: function (x) { return cx(AV.rs(x.s.total) + AV.marcaEst(x.s.est) + (x.s.sem ? '<span class="av-nome-s av-semc">+ ' + AV.int(x.s.sem) + " sem custo</span>" : "")); } },
      { t: "Ocorrências", v: function (x) { return AV.int(x.s.oc); } },
      { t: "% da venda a custo", dica: "Entrou em avaria ÷ venda a custo do setor, os dois só nos meses fechados do período que têm venda na base", v: function (x) {
        return cx(AV.pct(x.pv) + (x.falta.length ? '<span class="av-nome-s">sem venda do setor na base em ' + textoMeses(x.falta) + " (" + (x.falta.length === 1 ? "fica" : "ficam") + " fora)</span>" : "")); } },
      { t: "Motivo principal", cls: "l", v: function (x) { return x.mp ? AV.esc(AV.nomeMotivo(+x.mp.m)) : "—"; } },
      { t: "Evolução", cls: "l", rot: "Evolução", dica: "Período escolhido × período anterior do mesmo tamanho" + (parcial ? " (o mês atual, parcial, contra os mesmos dias)" : ""), v: function (x) {
        var e = variacao(x.s.total, x.ant);
        return '<span class="av-produtos-ev"><span class="av-produtos-ev-t"><b class="' + e.cls + '">' + e.txt + '</b><span class="av-nome-s">antes ' + (x.ant === null ? "—" : AV.rs0(x.ant)) + "</span></span>" + serie(d, x.id, fim) + "</span>"; } }
    ], S, { vazio: "Nenhuma entrada por motivo de avaria no período e nos filtros.", linha: function (x) { return 'data-av-abre="setor" data-av-setor="' + x.id + '" tabindex="0"'; } });
    h += '<p class="av-k-nota">% da venda: ' + (fech.length ? "só os meses fechados com venda na base (" + textoMeses(fech) + "), na avaria e na venda" : "nenhum mês fechado com venda na base no período") +
      (fora ? "; " + fora : "") + ". Evolução: " + (anterior(p) ? "contra " + textoMeses(anterior(p)) + (parcial ? ", o mês atual pelos mesmos dias (1 a " + AV.hoje().slice(8, 10) + ")" : "") : "sem comparação (o período anterior cai antes do começo do livro, 19/10/2023)") +
      "; a barrinha mostra os 6 meses até " + AV.mesCurto(fim) + ". É contexto, não alerta.</p>";
    return h + "</div>";
  }

  // ---------- 3. produtos ----------
  // dias com entrada: com "todos os motivos", dias_mes UMA vez por produto × mês; com um motivo, dias_motivo
  function agregarProdutos(d, p) {
    var L = linhas(d, p.meses, true), ant = anterior(p), pp = {};
    L.forEach(function (r) {
      var o = pp[r.id_produto] || (pp[r.id_produto] = { id: r.id_produto, setor: r.setor_id, rows: [], mesDias: {}, porMotivo: {}, ant: ant ? 0 : null });
      o.rows.push(r);
      if (AV.estado.motivo) o.mesDias[r.mes + "|" + r.motivo] = AV.n(r.dias_motivo); else o.mesDias[r.mes] = AV.n(r.dias_mes);
      var pm = o.porMotivo[r.motivo] || (o.porMotivo[r.motivo] = { n: 0, v: 0 });
      pm.n += AV.n(r.ocorrencias); pm.v += valorDe(r);
    });
    // o mês do anterior que corresponde ao mês atual (parcial) entra só pelos mesmos dias (1 até hoje), como nos setores
    var iAt = ant ? p.meses.indexOf(mesAtual()) : -1, mdMes = iAt >= 0 ? ant[iAt] : null;
    if (ant) d.produtosMes.forEach(function (r) { var o = pp[r.id_produto]; if (o && ant.indexOf(r.mes) >= 0 && AV.noMotivo(r.motivo))
      o.ant += r.mes === mdMes ? AV.n(r.valor_data_mesmos_dias) + AV.n(r.valor_estimado_mesmos_dias) : valorDe(r); });
    return Object.keys(pp).map(function (k) {
      var o = pp[k], s = somar(o.rows), mp = motivoPrincipal(o.rows), re = null, prod = AV.produtos[o.id] || {};
      // reincidência: o maior número de entradas pelo MESMO motivo; empate entre motivos → o de maior valor (nunca o código).
      // Uma entrada só por motivo não é repetição: fica "—".
      Object.keys(o.porMotivo).forEach(function (m) { var x = o.porMotivo[m]; if (!re || x.n > re.n || (x.n === re.n && x.v > re.v)) re = { m: +m, n: x.n, v: x.v }; });
      if (re && re.n < 2) re = null;
      var e = variacao(s.total, o.ant);
      return { id: o.id, nome: prod.nome || "produto " + o.id, setor: o.setor, s: s, valor: s.total, oc: s.oc,
        dias: Object.keys(o.mesDias).reduce(function (t, k2) { return t + o.mesDias[k2]; }, 0),
        mp: mp ? +mp.m : null, re: re, ant: o.ant, ev: e };
    });
  }
  var ORDENS = {
    nome: function (x) { return x.nome.toLowerCase(); }, valor: function (x) { return x.valor; }, oc: function (x) { return x.oc; },
    dias: function (x) { return x.dias; }, motivo: function (x) { return x.mp === null ? "" : AV.nomeMotivo(x.mp); },
    re: function (x) { return x.re ? x.re.n : 0; }, ev: function (x) { return x.ev.dif === null ? -Infinity : x.ev.dif; }
  };
  function semAcento(s) { return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); }
  function ordenar(P) {
    var f = ORDENS[tab.ord] || ORDENS.valor, sinal = tab.desc ? -1 : 1;
    return P.slice().sort(function (a, b) {
      var x = f(a), y = f(b);
      if (x < y) return -sinal; if (x > y) return sinal;
      return b.valor - a.valor || a.id - b.id;
    });
  }
  function cab(chave, titulo) {
    var on = tab.ord === chave;
    return '<button type="button" class="av-produtos-cab" data-av-ord="' + chave + '" aria-label="Ordenar por ' + titulo.toLowerCase() + '">' + titulo +
      (on ? '<span class="av-produtos-seta" aria-hidden="true">' + (tab.desc ? "▼" : "▲") + "</span>" : "") + "</button>";
  }
  function listaProdutos(P) {
    var b = semAcento(tab.busca).trim(), F = b ? P.filter(function (x) { return semAcento(x.nome).indexOf(b) >= 0 || String(x.id) === b; }) : P;
    var O = ordenar(F), V = O.slice(0, tab.n);
    var col = function (k, t, cls, v, extra) { var c = { t: cab(k, t), rot: t, cls: (cls || "") + " av-ord" + (tab.ord === k ? " av-ord-on" : ""), v: v }; for (var z in extra) c[z] = extra[z]; return c; };
    var h = AV.tabela([
      col("nome", "Produto", "l", function (x) { return '<span class="av-nome">' + AV.esc(x.nome) + '</span><span class="av-nome-s">' + AV.esc(AV.nomeSetor(x.setor)) + " · código " + x.id + "</span>"; }, { cel: "principal" }),
      col("valor", "Valor", "", function (x) { return cx(AV.rs(x.valor) + AV.marcaEst(x.s.est) + (x.s.sem ? '<span class="av-nome-s av-semc">+ ' + AV.int(x.s.sem) + " sem custo</span>" : "")); }),
      col("oc", "Ocorrências", "", function (x) { return AV.int(x.oc); }),
      col("dias", "Dias com entrada", "", function (x) { return AV.int(x.dias); }),
      col("motivo", "Motivo principal", "l", function (x) { return x.mp === null ? "—" : AV.esc(AV.nomeMotivo(x.mp)); }),
      col("re", "Reincidência", "l", function (x) { return x.re ? AV.int(x.re.n) + " × " + AV.esc(AV.nomeMotivo(x.re.m).toLowerCase()) : "—"; }, { dica: "O maior número de entradas do produto pelo mesmo motivo, no período; “—” quando nenhum motivo se repetiu" }),
      col("ev", "Evolução", "l", function (x) { return cx('<b class="' + x.ev.cls + '">' + x.ev.txt + '</b><span class="av-nome-s">antes ' + (x.ant === null ? "—" : AV.rs0(x.ant)) + "</span>"); }, { dica: "Período escolhido × período anterior do mesmo tamanho" })
    ], V, { vazio: b ? "Nenhum produto com esse nome no período e nos filtros." : "Nenhuma entrada por motivo de avaria no período e nos filtros.",
      linha: function (x) { return 'data-av-abre="produto" data-av-id="' + x.id + '" tabindex="0"'; } });
    h += '<div class="av-produtos-pe"><span class="av-quem">' + AV.int(V.length) + " de " + AV.int(O.length) + " produto" + (O.length === 1 ? "" : "s") + (b ? " com “" + AV.esc(tab.busca) + "”" : "") + "</span>" +
      (O.length > V.length ? '<button type="button" class="av-bt" data-av-prod="mais">Mostrar mais ' + Math.min(50, O.length - V.length) + "</button>" : "") + "</div>";
    return h;
  }
  // no celular os títulos das colunas somem (a tabela vira cartões): a ordem é escolhida numa lista
  var NOMES_ORDEM = [["valor", "Valor"], ["oc", "Ocorrências"], ["dias", "Dias com entrada"], ["re", "Reincidência"], ["ev", "Evolução"], ["motivo", "Motivo principal"], ["nome", "Produto"]];
  function ordemCelular() {
    return '<label class="av-produtos-ordem">Ordenar por <select data-av-prod="ordem">' + NOMES_ORDEM.map(function (o) {
      return '<option value="' + o[0] + '"' + (tab.ord === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select></label>";
  }
  function produtos(d, p) {
    var parcial = p.meses.indexOf(mesAtual()) >= 0, ant = anterior(p);
    var h = '<div class="av-card" data-av-bloco="produtos"><h3>Produtos</h3><p class="av-sub">Entradas por motivo de avaria no período e nos filtros. Clique num produto para abrir a ficha. ' +
      "Clique no título de uma coluna para ordenar por ela (no celular, use “Ordenar por”). Sem corte de alerta: é análise.</p>" +
      '<div class="av-linha-f"><label class="av-produtos-busca-l"><span class="av-produtos-oculto">Buscar produto pelo nome</span><input type="search" class="av-busca" data-av-prod="busca" placeholder="Buscar produto pelo nome ou código" value="' + AV.esc(tab.busca) + '" autocomplete="off"></label>' + ordemCelular() + "</div>" +
      '<div data-av-prod="lista"></div>';
    h += '<p class="av-k-nota">Reincidência: o maior número de entradas do mesmo produto pelo mesmo motivo, no período; “—” quando nenhum motivo se repetiu ' +
      "(se dois motivos empatam, vale o de maior valor). Dias com entrada: dias diferentes em que o produto entrou" +
      (AV.estado.motivo ? " por este motivo" : " por qualquer motivo de avaria (o mesmo dia conta uma vez)") + ". Evolução: " +
      (ant ? "contra " + textoMeses(ant) + (parcial ? ", o mês atual (parcial) contra os mesmos dias (1 a " + AV.hoje().slice(8, 10) + ")" : "") : "sem comparação (o período anterior cai antes do começo do livro)") + ".</p>";
    return h + "</div>";
  }

  // ---------- montagem da área ----------
  function desenhar(el, d) {
    var p = AV.periodo(AV.estado.periodo), P = agregarProdutos(d, p);
    var h = '<p class="av-nsoma">Mostrando: <b>' + AV.esc(AV.textoFiltro(["periodo", "setor", "motivo"])) + "</b>" + (p.parcial ? " · período com mês parcial" : "") + "</p>";
    h += qualidade(d, p) + setores(d, p) + produtos(d, p);
    el.innerHTML = h;
    var caixa = el.querySelector("[data-av-prod=lista]");
    var pintar = function () { caixa.innerHTML = listaProdutos(P); };
    pintar();
    // setor: clicar põe o filtro comum de setor
    el.querySelectorAll("tr[data-av-setor]").forEach(function (tr) {
      var ir = function () { AV.estado.setor = tr.getAttribute("data-av-setor"); tab.n = 50; AV.redesenhar(); };
      tr.addEventListener("click", ir);
      tr.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ir(); } });
    });
    var todos = el.querySelector("[data-av-prod=todos-setores]");
    if (todos) todos.addEventListener("click", function (e) { e.stopPropagation(); AV.estado.setor = ""; tab.n = 50; AV.redesenhar(); });
    // produtos: ordem, mais linhas, abrir ficha (um ouvinte só na caixa, que é redesenhada)
    caixa.addEventListener("click", function (e) {
      var o = e.target.closest("[data-av-ord]");
      if (o) { var k = o.getAttribute("data-av-ord"); if (tab.ord === k) tab.desc = !tab.desc; else { tab.ord = k; tab.desc = k !== "nome" && k !== "motivo"; } sel.value = k; pintar(); var f = caixa.querySelector('[data-av-ord="' + k + '"]'); if (f) f.focus(); return; }
      if (e.target.closest("[data-av-prod=mais]")) { tab.n += 50; pintar(); return; }
      var tr = e.target.closest("tr[data-av-id]"); if (tr) AV.abrirProduto(+tr.getAttribute("data-av-id"), { origem: "produtos" });
    });
    caixa.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      var tr = e.target.closest && e.target.closest("tr[data-av-id]");
      if (tr && e.target === tr) { e.preventDefault(); AV.abrirProduto(+tr.getAttribute("data-av-id"), { origem: "produtos" }); }
    });
    var sel = el.querySelector("[data-av-prod=ordem]");
    sel.addEventListener("change", function () { tab.ord = sel.value; tab.desc = tab.ord !== "nome" && tab.ord !== "motivo"; pintar(); });
    var busca = el.querySelector("[data-av-prod=busca]");
    busca.addEventListener("input", function () { tab.busca = busca.value; tab.n = 50; pintar(); });
  }

  // =====================================================================================================
  // ---------- 4. FICHA DO PRODUTO (aberta por Produtos, Pendências e Fornecedores) ----------
  // opc.origem = "pendencias" | "produtos" | "fornecedores". Vinda das Pendências, a ficha NÃO lê o fornecedor relacionado.
  AV.abrirProduto = function (id, opc) {
    opc = opc || {}; id = +id;
    var analise = opc.origem !== "pendencias", prod = AV.produtos[id] || {};
    var corpo = AV.gaveta(AV.esc(prod.nome || "Produto " + id), "Código " + id + " · " + AV.esc(AV.nomeSetor(prod.setor_id)) +
      " · todo o histórico do produto no livro da troca (desde 19/10/2023); os filtros da tela não se aplicam aqui", "");
    corpo.innerHTML = '<div data-av-ficha="base"><div class="av-card av-carr"><p>Carregando a ficha…</p></div></div><div data-av-ficha="acertos"></div>' +
      (analise ? '<div data-av-ficha="analise"></div>' : AV.aviso("cz", "Aberta a partir das Pendências: o fornecedor relacionado fica só na análise.")) + '<div data-av-ficha="mov"></div>';
    var vivo = function () { return corpo.isConnected; };
    Promise.all([AV.ler("movimentos", { id_produto: id }), AV.ler("partes", { id_produto: id }), AV.ler("filaA"), AV.ler("parado"), AV.ler("acertos"), AV.ler("negativo")]).then(function (r) {
      if (!vivo()) return;
      var mov = r[0], fa = null, neg = null; r[2].forEach(function (x) { if (+x.id_produto === id) fa = x; });
      r[5].forEach(function (x) { if (+x.id_produto === id) neg = x; });
      var ac = r[4].filter(function (a) { return +a.id_produto === id && a.fila === "A"; });
      corpo.querySelector("[data-av-ficha=base]").innerHTML = situacao(fa, r[3].filter(function (x) { return +x.id_produto === id; }), neg, ac) + tempoProduto(mov, r[1]);
      acertosDoProduto(corpo.querySelector("[data-av-ficha=acertos]"), ac, fa, mov, analise);
      movimentos(corpo.querySelector("[data-av-ficha=mov]"), mov, opc);
    }, function (e) { if (vivo()) AV.falhou(corpo.querySelector("[data-av-ficha=base]"), e); });
    if (!analise) return;                               // Pendências: nada de relacionado, compras recentes nem nomes
    var caixa = corpo.querySelector("[data-av-ficha=analise]");
    caixa.innerHTML = '<div class="av-analise"><p class="av-quem">Carregando a análise…</p></div>';
    Promise.all([AV.ler("relacionado"), AV.ler("comprasRecentes", { id_produto: id }), AV.ler("nomesForn"), AV.ler("fornecedores")]).then(function (r) {
      if (vivo()) relacionado(caixa, id, r[0], r[1], r[2], r[3]);
    }, function () { if (vivo()) caixa.innerHTML = '<div class="av-analise"><p class="avr-vazio">Não deu para carregar a análise do fornecedor relacionado agora.</p></div>'; });
  };

  // (a) situação na troca agora
  function situacao(fa, par, neg, acertos) {
    var h = '<div class="av-card" data-av-bloco="situacao"><h3>Situação na troca agora</h3>';
    // saldo negativo no VR: problema de lançamento, fora de todo total (o acerto é feito no VR, não no Painel)
    if (neg) return h + '<dl class="av-dl av-produtos-dl"><dt>Saldo do VR</dt><dd><b class="av-produtos-neg">' + AV.qtd(neg.saldo) + "</b>" +
      '<span class="av-nome-s">problema de lançamento: fica fora de todo total; o acerto é feito no VR</span></dd>' +
      "<dt>Último movimento</dt><dd>" + AV.data(neg.ultimo_movimento) + "</dd></dl>" +
      AV.aviso("am", "Saldo de troca abaixo de zero no VR: saiu mais do que entrou. Não entra no parado nem em nenhum total da tela; aparece só na caixa " +
        "“Problema de lançamento” das Pendências, até ser acertado no VR.") +
      (acertos.length ? '<p class="av-k-nota">Os acertos informados no Painel para este produto estão logo abaixo.</p>' : "") + "</div>";
    if (!fa) return h + '<p class="avr-vazio">Sem mercadoria na troca agora: o saldo de troca deste produto no VR está zerado.</p>' +
      (acertos.length ? '<p class="av-k-nota">Os acertos informados no Painel para este produto estão logo abaixo.</p>' : "") + "</div>";
    var vf = AV.valorFonte(fa.valor_data, fa.valor_estimado, 0, { sempre: true }), ac = AV.n(fa.acertos_no_ciclo);
    h += '<dl class="av-dl av-produtos-dl">' +
      "<dt>Saldo do VR</dt><dd><b>" + AV.qtd(fa.saldo) + '</b> <span class="av-quem">é o saldo físico</span></dd>' +
      "<dt>Valor parado</dt><dd>" + vf.html.replace("av-v", "av-v av-produtos-v") + vf.comp + (AV.n(fa.qtd_sem_custo) > 0 ? '<span class="av-semc">+ quantidade ' + AV.qtd(fa.qtd_sem_custo) + " sem custo conhecido</span>" : "") + "</dd>" +
      "<dt>Ciclo atual</dt><dd>" + (fa.ciclo_desde ? "desde " + AV.data(fa.ciclo_desde) + (fa.ciclo_n ? " (ciclo nº " + AV.int(fa.ciclo_n) + " do produto)" : "") : "—") +
      '<span class="av-nome-s">o ciclo começa quando o saldo passa de zero e termina quando volta a zero</span></dd>' +
      "<dt>Acertos do ciclo</dt><dd>" + (ac ? AV.int(ac) + " · combinado " + AV.qtd(fa.combinado) + " · ligado a saídas " + AV.qtd(fa.vinculado) +
        '<span class="av-nome-s">quem registrou, quando, forma e conferência: na lista “Acertos informados no Painel”, logo abaixo</span>'
        : "nenhum" + '<span class="av-nome-s">o registro de acertos no Painel só começa na etapa 4</span>') + "</dd>" +
      "<dt>Quantidade ainda sem acerto informado</dt><dd><b>" + AV.qtd(fa.quantidade_sem_acerto_informado) + '</b><span class="av-nome-s">saldo do VR agora − acertos ainda sem vínculo; nunca é o saldo físico, que é sempre o do VR</span></dd>' +
      "<dt>Parte mais antiga</dt><dd>" + AV.data(fa.entrada_mais_antiga) + " · " + AV.nomeFaixa(fa.faixa_mais_antiga) + "</dd></dl>";
    h += '<h4 class="av-produtos-h4">Partes paradas por faixa de idade</h4><div class="av-fx">';
    var mx = 0, F = AV.faixas.map(function (f) {
      var L = par.filter(function (x) { return x.faixa === f; }), o = { f: f, q: AV.soma(L, function (x) { return x.qtd; }), v: AV.soma(L, function (x) { return AV.n(x.valor_data) + AV.n(x.valor_estimado); }), e: AV.soma(L, function (x) { return x.valor_estimado; }) };
      if (o.v > mx) mx = o.v; return o;
    });
    F.forEach(function (o) {
      h += "<span>" + AV.nomeFaixa(o.f) + '</span><i style="width:' + (mx && o.v ? Math.max(2, 100 * o.v / mx) : 0).toFixed(1) + '%"></i><b>' + (o.q ? "qtd. " + AV.qtd(o.q) + " · " + AV.rs(o.v) + (o.e > 0.004 ? " *" : "") : "—") + "</b>";
    });
    h += "</div>" + (F.some(function (o) { return o.e > 0.004; }) ? '<p class="av-k-nota">* inclui <span class="av-est">custo estimado</span> (custo de hoje, onde o VR não tem custo para a data).</p>' : "") +
      '<p class="av-k-nota">Idade de cada parte pela data em que entrou; a mais antiga sai primeiro (o VR não rastreia cada unidade).</p>';
    return h + "</div>";
  }

  // (b) tempo até sair deste produto: cada parte que saiu (partes da saída) e a data da saída (no movimento da saída);
  // só as partes cuja ENTRADA é de avaria (a classe da linha de entrada nos movimentos)
  function tempoProduto(mov, partes) {
    var por = {}; mov.forEach(function (m) { por[m.linha_id] = m; });
    var fora = 0, T = [];
    partes.forEach(function (pa) {
      var s = por[pa.linha_saida], e = pa.linha_entrada === null ? null : por[pa.linha_entrada];
      if (!s || s.saida_linha === null) return;                     // saída que não existe mais no VR
      if (!e || e.classe !== "avaria") { fora++; return; }
      var semc = pa.custo === null || pa.fonte_custo === "sem_custo";
      var v = semc ? 0 : AV.n(pa.qtd) * AV.n(pa.custo);
      T.push({ dias: AV.dias(pa.data_entrada, s.data), partes: 1, valor: v, est: pa.fonte_custo === "hoje_estimado" ? v : 0, sem: semc ? 1 : 0 });
    });
    var semF = {}, estF = {}; AV.faixas.forEach(function (f) { semF[f] = 0; estF[f] = 0; });
    T.forEach(function (x) { var f = AV.faixas[x.dias <= 30 ? 0 : x.dias <= 60 ? 1 : x.dias <= 90 ? 2 : x.dias <= 180 ? 3 : x.dias <= 365 ? 4 : 5]; if (x.sem) semF[f] += 1; estF[f] += x.est; });
    var h = '<div class="av-card" data-av-bloco="tempo-produto"><h3>Tempo até sair deste produto</h3><p class="av-sub">Dias entre a entrada por avaria e a saída da troca, para cada parte que já saiu.</p>';
    if (!T.length) return h + '<p class="avr-vazio">Nenhuma parte de entrada por avaria saiu da troca ainda.</p>' + (fora ? '<p class="av-k-nota">' + notaFora(fora) + "</p>" : "") + "</div>";
    var t = AV.tempoAteSair(T), mx = 0;
    AV.faixas.forEach(function (f) { mx = Math.max(mx, t.faixas[f].partes); });
    h += '<p class="av-produtos-med"><span class="av-v av-produtos-v" data-av-mediana="' + t.mediana + '">' + AV.int(t.mediana) + " " + pl(t.mediana, "dia", "dias") + '</span> <span class="av-quem">' +
      (t.partes === 1 ? "a única parte saiu em " + AV.int(t.mediana) + " " + pl(t.mediana, "dia", "dias")
        : "mediana: metade das " + AV.int(t.partes) + " partes saiu em até " + AV.int(t.mediana) + " " + pl(t.mediana, "dia", "dias")) + "</span></p><div class=\"av-fx\">";
    AV.faixas.forEach(function (f) { var x = t.faixas[f]; h += "<span>" + AV.nomeFaixa(f) + '</span><i style="width:' + (mx && x.partes ? Math.max(2, 100 * x.partes / mx) : 0).toFixed(1) + '%"></i><b>' + (x.partes ? AV.int(x.partes) + (x.partes === 1 ? " parte" : " partes") + " · " + (x.partes > semF[f] ? AV.rs(x.valor) + (estF[f] > 0.004 ? " *" : "") : "") +
      (semF[f] ? '<span class="av-semc">' + (x.partes > semF[f] ? " + " : "") + AV.int(semF[f]) + " sem custo</span>" : "") : "—") + "</b>"; });
    var est = AV.soma(T, function (x) { return x.est; });
    return h + "</div>" + (est > 0.004 ? '<p class="av-k-nota">* inclui <span class="av-est">' + AV.rs(est) + " pelo custo estimado</span> (custo de hoje, onde o VR não tem custo para a data).</p>" : "") +
      '<p class="av-k-nota">Estimativa pelo método da fila (a mais antiga sai primeiro): o VR não rastreia cada unidade.' + (fora ? " " + notaFora(fora) : "") + "</p></div>";
  }
  function notaFora(n) {
    return n === 1 ? "1 parte de entrada que não é avaria (erro, outros processos, balanço) ou sem saldo no livro fica fora da conta."
      : AV.int(n) + " partes de entradas que não são avaria (erro, outros processos, balanço) ou sem saldo no livro ficam fora da conta.";
  }

  // (b2) acertos informados no Painel para este produto (fila A): os do ciclo atual, os que aguardam vínculo e os de ciclos
  // anteriores — quem registrou, quando, forma, fornecedor informado, quantidade, quanto está ligado a saídas, a conferência
  // e as correções. Declarado: é o que foi informado, não prova; nunca muda o saldo do VR.
  var FORMAS = { bonificacao: "bonificação", desconto_boleto: "desconto no boleto", pix_deposito: "Pix ou depósito",
    troca_mercadoria: "troca por mercadoria", dinheiro: "dinheiro", verba: "verba", outro: "outro" };
  function nomeForma(f) {
    if (typeof AV.nomeForma === "function") return AV.nomeForma(f);
    return f ? FORMAS[f] || String(f).replace(/_/g, " ") : "não informada";
  }
  function conferencia(a) {
    if (a.conferido) return AV.chip("conferido", "av-produtos-chip-ok") + '<span class="av-nome-s">em ' + AV.dataHora(a.conferido_em) + "</span>";
    if (a.conferido_em) return AV.chip("aguardando nova conferência", "av-chip-conf") + '<span class="av-nome-s">corrigido depois da conferência de ' +
      AV.dataHora(a.conferido_em) + " (a conferência anterior fica no histórico)</span>";
    return AV.chip("aguardando conferência", "av-chip-conf");
  }
  function situacaoAcerto(a) {
    var s = { aberto: "ciclo atual · falta ligar " + AV.qtd(a.sem_vinculo) + " a saídas", vinculado: "ligado a saídas por inteiro",
      aguardando_vinculo: "aguardando vínculo: o ciclo em que foi registrado já fechou", encerrado_sem_vinculo: "encerrado sem vínculo",
      anulado: "anulado: o registro original continua visível, riscado" }[a.estado] || String(a.estado || "—").replace(/_/g, " ");
    return s + (a.ciclo_desfeito ? '<span class="av-nome-s">o ciclo foi desfeito por uma nota refeita no VR</span>' : "");
  }
  function acertosDoProduto(caixa, ac, fa, mov, analise) {
    if (!ac.length) { caixa.innerHTML = ""; return; }
    var pinta = function (vinc, nomes) {
      var ml = {}; mov.forEach(function (m) { ml[m.linha_id] = m; });
      var nomeF = function (a) {
        var f = a.fornecedor;
        if (f === null || f === undefined) return '<span class="av-quem">não informado</span>';
        return AV.esc(a.fornecedor_nome || (nomes && nomes[f]) || "fornecedor código " + f);
      };
      var ligado = function (a) {
        var V = vinc.filter(function (v) { return +v.acerto_id === +a.acerto_id && !v.desfeito; });
        return '<span class="av-nome-s">ligado a saídas: ' + AV.qtd(a.vinculado) + "</span>" + V.map(function (v) {
          var m = ml[v.saida_linha];
          return '<span class="av-nome-s">' + AV.qtd(v.quantidade) + " na saída de " + (m ? AV.dataCurta(m.data) + (m.nota_numero ? " · NF " + AV.esc(m.nota_numero) : "") : "linha " + v.saida_linha) +
            (v.automatico ? " · vínculo automático" : v.autor_nome ? " · por " + AV.esc(v.autor_nome) : "") + (v.a_reconferir ? " · a reconferir" : "") + "</span>";
        }).join("");
      };
      var cols = [
        { t: "Registrado", cls: "l", cel: "principal", v: function (a) { return '<span class="av-nome">' + AV.dataHora(a.criado_em) + '</span><span class="av-nome-s">por ' + AV.esc(a.autor_nome || "—") + "</span>"; } },
        { t: "Forma e fornecedor", cls: "l", v: function (a) { return cx(AV.esc(nomeForma(a.forma)) + '<span class="av-nome-s">fornecedor informado: ' + nomeF(a) + "</span>"); } },
        { t: "Quantidade", cls: "l av-produtos-ac-q", v: function (a) {
          return cx((a.anulado ? '<s class="av-quem">anulada</s>' : '<span class="av-num">informado ' + AV.qtd(a.quantidade) + "</span>") + ligado(a)); } },
        { t: "Situação e conferência", cls: "l", v: function (a) {
          return cx(situacaoAcerto(a) + '<span class="av-produtos-ac-conf">' + conferencia(a) + "</span>" + '<span class="av-nome-s">' +
            (AV.n(a.n_correcoes) ? "corrigido " + AV.int(a.n_correcoes) + " " + pl(a.n_correcoes, "vez", "vezes") + "; vale o registro mais recente" : "sem correção") + "</span>"); } }
      ];
      var G = [
        ["Do ciclo atual", ac.filter(function (a) { return fa && +a.ciclo_vigente === +fa.ciclo && a.estado !== "aguardando_vinculo"; })],
        ["Aguardando vínculo (o ciclo em que foram registrados já fechou)", ac.filter(function (a) { return a.estado === "aguardando_vinculo"; })]
      ];
      var usados = G[0][1].concat(G[1][1]);
      G.push(["De ciclos anteriores", ac.filter(function (a) { return usados.indexOf(a) < 0; })]);
      var h = '<div class="av-card" data-av-bloco="acertos"><h3>Acertos informados no Painel</h3><p class="av-sub">' + AV.int(ac.length) + " " + pl(ac.length, "acerto", "acertos") +
        " deste produto. Declarado: é o que a pessoa informou, não prova; não muda o saldo do VR. Cada correção é um registro novo; vale o mais recente.</p>";
      G.forEach(function (g) {
        if (!g[1].length) return;
        h += '<h4 class="av-produtos-h4">' + g[0] + " · " + AV.int(g[1].length) + "</h4>" +
          AV.tabela(cols, g[1].slice().sort(function (a, b) { return a.criado_em < b.criado_em ? 1 : -1; }), { classe: "av-produtos-ac", linha: function (a) { return a.anulado ? 'class="av-produtos-anulado"' : ""; } });
      });
      caixa.innerHTML = h + "</div>";
    };
    caixa.innerHTML = '<div class="av-card av-carr"><p>Carregando os acertos…</p></div>';
    var pedidos = [AV.ler("vinculosFeitos")];
    // o nome do fornecedor informado: só na análise (aberta das Pendências, a ficha não lê a lista de fornecedores)
    var comForn = ac.some(function (a) { return a.fornecedor !== null && a.fornecedor !== undefined && !a.fornecedor_nome; });
    if (analise && comForn) pedidos.push(AV.ler("nomesForn"));
    Promise.all(pedidos).then(function (r) {
      if (!caixa.isConnected) return;
      var nomes = null; if (r[1]) { nomes = {}; r[1].forEach(function (f) { nomes[f.fornecedor] = f.nome; }); }
      pinta(r[0], nomes);
    }, function (e) { if (caixa.isConnected) AV.falhou(caixa, e); });
  }

  // (c) movimentos da troca com destino (mais recentes primeiro; 100 e "mostrar todos")
  function descricao(m) {
    if (m.papel === "vai_e_volta") return '<span class="av-chip av-produtos-vv">volta de nota corrigida no VR</span><span class="av-nome-s">não conta: vale o líquido da nota (saiu − voltou)</span>';
    if (+m.tipo === 0) {
      if (m.classe === "avaria") return AV.esc(AV.nomeMotivo(m.motivo));
      if (m.classe === "erro" || m.classe === "outros") return AV.esc(AV.nomeMotivo(m.motivo)) + '<span class="av-nome-s">' + AV.nomeClasse(m.classe) + " · fora do total de avaria</span>";
      return AV.esc(AV.nomeClasse(m.classe, m.motivo));
    }
    if (m.saida_linha === null) return '<span class="av-quem">saída sem destino calculado</span>';
    var liq = AV.n(m.qtd_liquida) !== AV.n(m.qtd) ? '<span class="av-nome-s">líquido ' + AV.qtd(m.qtd_liquida) + ": a nota foi corrigida no VR e parte voltou</span>" : "";
    var pilula = m.nivel ? AV.nivel(m.nivel) : '<span class="av-pill ' + (m.grupo === "assumido" ? "av-n-assum" : "av-n-sem") + '">' + AV.esc(AV.nomeGrupo(m.grupo)) + "</span>";
    // conflito entre fontes na nota desta saída: sempre à vista (nenhuma fonte vence a outra antes da conferência)
    var conf = listaConf(m.conflitos), marca = m.em_conferencia || conf.length ? " " + AV.chip("em conferência", "av-chip-conf", "Há conflito entre fontes na nota desta saída; nenhuma fonte vence a outra até a conferência") +
      conf.map(function (c) { return '<span class="av-nome-s av-produtos-conf">conflito · ' + AV.esc(c) + "</span>"; }).join("") : "";
    return AV.esc(AV.nomeDestino(m.destino)) + " " + pilula + marca + (m.grupo === "assumido" ? '<span class="av-nome-s">identificado no VR</span>' : "") + liq;
  }
  // listas do banco (conflitos): vêm como vetor; nulo vira vazio
  function listaConf(v) { return Array.isArray(v) ? v.filter(function (x) { return x; }) : v ? [String(v)] : []; }
  function valorMov(m) {
    if (m.papel === "vai_e_volta") return '<span class="av-quem">não conta</span>';
    if (+m.tipo === 0) {
      if (m.custo_data === null || m.fonte_custo === "sem_custo") return AV.chip("sem custo", "av-chip-conf", "Nem o VR nem o histórico têm custo para esta entrada: não vira zero");
      return '<span class="av-num">' + AV.rs(AV.n(m.qtd) * AV.n(m.custo_data)) + "</span>" + (m.fonte_custo === "hoje_estimado" ? " " + AV.chip("estimado", "av-chip-est", "Custo de hoje, usado só onde o VR não tem custo para a data") : "");
    }
    if (m.saida_linha === null) return "—";
    var est = AV.n(m.saida_valor_estimado), tot = AV.n(m.saida_valor_data) + est, sq = AV.n(m.saida_qtd_sem_custo);
    if (tot < 0.005 && sq > 0) return AV.chip("sem custo", "av-chip-conf", "As partes que saíram não têm custo conhecido: não vira zero") + '<span class="av-nome-s">quantidade ' + AV.qtd(sq) + "</span>";
    return '<span class="av-num">' + AV.rs(tot) + "</span>" + (est > 0.004 ? " " + AV.chip("estimado", "av-chip-est", "Inclui " + AV.rs(est) + " pelo custo estimado") : "") +
      (sq > 0 ? '<span class="av-nome-s av-semc">+ quantidade ' + AV.qtd(sq) + " sem custo</span>" : "");
  }
  function movimentos(caixa, mov, opc) {
    var abreNota = typeof AV.abrirNota === "function";
    var O = mov.slice().sort(function (a, b) { return a.datahora < b.datahora ? 1 : a.datahora > b.datahora ? -1 : b.linha_id - a.linha_id; });
    // o ciclo fecha na última linha dele (sem contar o vai-e-volta) quando o saldo volta a zero
    var ultimo = {}; O.forEach(function (m) { if (m.ciclo !== null && m.papel !== "vai_e_volta" && !ultimo[m.ciclo]) ultimo[m.ciclo] = m.linha_id; });
    var todos = false;
    var cols = [
      { t: "Data", cls: "l av-produtos-data", cel: "principal", v: function (m) { return '<span class="av-nome">' + AV.dataHora(m.datahora) + '</span><span class="av-nome-s">linha ' + m.linha_id + "</span>"; } },
      { t: "Movimento", cls: "l", v: function (m) {
        return cx('<span class="av-num">' + (+m.tipo === 0 ? "Entrada +" : "Saída −") + AV.qtd(m.qtd) + '</span><span class="av-nome-s">saldo ' + AV.qtd(m.saldo_antes) + " → " + AV.qtd(m.saldo_depois) +
          (m.ciclo !== null && +m.ciclo === +m.linha_id ? " · abre ciclo" : "") + (m.ciclo !== null && ultimo[m.ciclo] === m.linha_id && AV.n(m.saldo_depois) <= 0 ? " · fecha ciclo" : "") + (m.papel === "retorno" ? " · retorno" : "") + "</span>"); } },
      { t: "Motivo ou destino", cls: "l", v: function (m) { return cx(descricao(m)); } },
      { t: "NF", v: function (m) {
        if (!m.nota_numero) return "—";
        return m.nota_id && abreNota ? '<button type="button" class="av-lk av-produtos-nf" data-av-nota="' + m.nota_id + '" title="Abrir o detalhe da nota">' + AV.esc(m.nota_numero) + "</button>" : AV.esc(m.nota_numero); } },
      { t: "Valor", v: function (m) { return cx(valorMov(m)); } },
      { t: "Registrou no coletor", cls: "l av-produtos-quem", dica: "Registrou o fato; não indica quem causou", v: function (m) { return m.usuario_login ? AV.esc(m.usuario_login) : "—"; } }
    ];
    var pintar = function () {
      var V = todos ? O : O.slice(0, 100);
      caixa.innerHTML = '<div class="av-card" data-av-bloco="movimentos"><h3>Movimentos da troca com destino</h3><p class="av-sub">' + (O.length === 1 ? "A única linha do VR. " : AV.int(O.length) + " linhas do VR, as mais recentes primeiro. ") +
        "O valor da entrada é pelo custo da data; o da saída, pelo custo da entrada das partes que saíram.</p>" +
        AV.aviso("fixo", "Registrou no coletor: o usuário que registrou o fato; não indica quem causou.") +
        AV.tabela(cols, V, { vazio: "Nenhum movimento deste produto no livro da troca.", classe: "av-produtos-mov", linha: function (m) { return m.papel === "vai_e_volta" ? 'class="av-produtos-vv-lin"' : ""; } }) +
        (O.length > V.length ? '<div class="av-mais"><button type="button" class="av-bt" data-av-prod="todos-mov">Mostrar todos (' + AV.int(O.length) + ")</button></div>" : "") + "</div>";
      var b = caixa.querySelector("[data-av-prod=todos-mov]"); if (b) b.addEventListener("click", function () { todos = true; pintar(); });
    };
    pintar();
    // a NF da saída abre o detalhe da nota (um ouvinte só na caixa, que é redesenhada)
    if (abreNota) caixa.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("[data-av-nota]");
      if (b) AV.abrirNota(+b.getAttribute("data-av-nota"), { origem: opc && opc.origem });
    });
  }

  // (d) SÓ análise: fornecedor relacionado (última compra). Nunca "responsável", "da avaria" ou "devedor".
  function relacionado(caixa, id, rel, compras, nomes, forn) {
    var nome = {}, ult = {}; nomes.forEach(function (f) { nome[f.fornecedor] = f.nome; ult[f.fornecedor] = f.ultima_compra; });
    var nomeF = function (f) { return AV.esc(nome[f] || "fornecedor " + f); };
    var limite = AV.iso(new Date(new Date(AV.hoje() + "T12:00:00").getTime() - 180 * 864e5));
    var contexto = function (f) {
      var c = [];
      if (ult[f] && ult[f] < limite) c.push("sem nota há mais de 6 meses");
      if (!forn.some(function (x) { return x.medida === "devolvido" && +x.fornecedor === +f; })) c.push("nunca recebeu devolução de troca desta loja");
      return c;
    };
    var R = rel.filter(function (r) { return +r.id_produto === id; }).sort(function (a, b) { var x = String(a.data_compra || ""), y = String(b.data_compra || ""); return x < y ? 1 : x > y ? -1 : 0; });
    var h = '<div class="av-analise" data-av-bloco="relacionado"><span class="av-rot">só para análise</span><h3>Fornecedor relacionado (última compra)</h3>' +
      AV.aviso("fixo", "Inferência; não indica responsável nem devedor.");
    if (!R.length) {
      caixa.innerHTML = h + '<p class="av-produtos-rel">Sem mercadoria parada na troca agora: o fornecedor relacionado só é calculado para as partes paradas.</p></div>';
      return;
    }
    var P = R[0], linha = function (r) {
      if (r.fornecedor === null) return "<b>Fornecedor relacionado (última compra):</b> sem compra registrada no VR";
      var c = contexto(r.fornecedor);
      return "<b>Fornecedor relacionado (última compra):</b> " + nomeF(r.fornecedor) + " · compra em " + AV.dataCurta(r.data_compra) +
        (c.length ? '<span class="av-nome-s">contexto: ' + c.join(" · ") + "</span>" : "");
    };
    h += '<p class="av-produtos-rel">' + linha(P) + "</p>";
    if (R.length > 1) {
      h += '<p class="av-quem">As partes paradas deste produto têm mais de uma última compra antes de entrar na troca:</p><ul class="av-produtos-rel-l">';
      R.forEach(function (r) { h += "<li>" + (r.fornecedor === null ? "sem compra registrada no VR" : nomeF(r.fornecedor) + " · compra em " + AV.dataCurta(r.data_compra)) + " — " + AV.int(r.partes) + " parte" + (+r.partes === 1 ? "" : "s") + ", qtd. " + AV.qtd(r.qtd) + ", " + AV.rs(AV.n(r.valor_data) + AV.n(r.valor_estimado)) + AV.marcaEst(r.valor_estimado) +
        (AV.n(r.qtd_sem_custo) > 0 ? ' <span class="av-semc">+ quantidade ' + AV.qtd(r.qtd_sem_custo) + " sem custo conhecido</span>" : "") + "</li>"; });
      h += "</ul>";
    }
    if (R.some(function (r) { return r.varios_fornecedores; })) {
      h += '<p class="av-produtos-rel"><b>Produto teve compras recentes de outros fornecedores</b> <button type="button" class="av-lk" data-av-prod="ver-compras" aria-expanded="false">ver detalhe</button></p>' +
        '<div data-av-prod="compras" hidden>' + listaCompras(compras, P.fornecedor, nomeF, contexto) + "</div>";
    }
    h += '<p class="av-k-nota">Regra: a última nota de entrada do produto antes de ele entrar na troca, sem transferências da própria empresa. Serve para análise; nunca aparece nas Pendências.</p>';
    caixa.innerHTML = h + "</div>";
    var bt = caixa.querySelector("[data-av-prod=ver-compras]");
    if (bt) bt.addEventListener("click", function () {
      var d = caixa.querySelector("[data-av-prod=compras]"), abrir = d.hidden; d.hidden = !abrir;
      bt.setAttribute("aria-expanded", String(abrir)); bt.textContent = abrir ? "esconder detalhe" : "ver detalhe";
    });
  }
  // compras do produto no ano antes da entrada mais recente que está parada; destaca o fornecedor anterior
  function listaCompras(C, atual, nomeF, contexto) {
    var L = C.slice().sort(function (a, b) { return a.ultima_compra < b.ultima_compra ? 1 : a.ultima_compra > b.ultima_compra ? -1 : 0; });
    var ant = null; L.forEach(function (c) { if (ant === null && +c.fornecedor !== +atual) ant = c.fornecedor; });
    return '<p class="av-quem">Compras do produto no ano antes da entrada mais recente que está parada, da mais recente para a mais antiga.</p>' + AV.tabela([
      { t: "Fornecedor", cls: "l", cel: "principal", v: function (c) {
        var ctx = contexto(c.fornecedor);
        return '<span class="av-nome">' + nomeF(c.fornecedor) + "</span>" + (+c.fornecedor === +atual ? " " + AV.chip("relacionado", "av-produtos-chip-rel") : "") +
          (c.fornecedor === ant ? " " + AV.chip("fornecedor anterior", "av-produtos-chip-ant") : "") + (ctx.length ? '<span class="av-nome-s">' + ctx.join(" · ") + "</span>" : ""); } },
      { t: "Primeira compra", v: function (c) { return AV.dataCurta(c.primeira_compra); } },
      { t: "Última compra", v: function (c) { return AV.dataCurta(c.ultima_compra); } },
      { t: "Notas", v: function (c) { return AV.int(c.notas); } }
    ], L, { vazio: "Nenhuma compra registrada no ano antes da entrada.", classe: "av-produtos-compras", linha: function (c) { return c.fornecedor === ant ? 'class="av-produtos-anterior"' : ""; } });
  }
})();
