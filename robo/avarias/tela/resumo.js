/* ==AV-RESUMO== AVARIAS · Resumo: quatro cartões, a forma declarada das saídas, "O que tratar agora", três gráficos
   (cada um responde uma pergunta) e duas caixas fora do total. Nada é somado entre coisas de natureza diferente:
   custo da entrada, valor do título e valor da nota ficam sempre em linhas separadas, cada uma com a sua base. */
(function () {
  "use strict";
  var AV = window.AV;
  var LEITURAS = ["entradas", "livro", "saidas", "assumido", "parado", "tempo", "perda", "venda", "filaA", "filaB", "filaC", "acertos", "vinculos", "negativo", "naoIdent"];
  var FILA_C_DESDE = "2026-05-08";

  AV.areas.resumo = function (el) {
    AV.carregando(el);
    AV.lerVarias(LEITURAS).then(function (d) { AV.dadosResumo = d; desenhar(el, d); }, function (e) { AV.falhou(el, e); });
  };

  // ---------- pequenas peças do Resumo ----------
  // número + palavra no singular ou no plural ("1 caso", "2 casos")
  function pl(n, s, p) { return AV.int(n) + " " + (Math.abs(AV.n(n)) === 1 ? s : (p || s + "s")); }
  function vt(r) { return AV.n(r.valor_data) + AV.n(r.valor_estimado); }
  function setorDe(id) { return (AV.produtos && AV.produtos[id] || {}).setor_id; }
  var FORMAS = [["bonificacao", "Bonificação"], ["desconto_boleto", "Desconto no boleto"], ["troca_mercadoria", "Troca por mercadoria"],
    ["pix_deposito", "Pix ou depósito"], ["dinheiro", "Dinheiro"], ["verba", "Verba"], ["outro", "Outra forma"], ["devolucao", "Devolução pela própria nota"]];
  function nomeForma(f) { for (var i = 0; i < FORMAS.length; i++) if (FORMAS[i][0] === f) return FORMAS[i][1]; return f ? String(f).replace(/_/g, " ") : "Não informada"; }
  // a saída de "destino não identificado" cuja nota o Painel registrou como "loja assume" conta no grupo Assumido
  function assumidaNoPainel(r) { return r.grupo === "nao_identificado" && r.nivel === "assumido"; }
  function grupoDe(r) { return assumidaNoPainel(r) ? "assumido" : r.grupo; }
  // valor e selo do custo estimado juntos, num pedaço só (não se separam no celular)
  function valorEst(v, est) { return '<span class="av-resumo-vv">' + AV.rs(v) + AV.marcaEst(est) + "</span>"; }
  // escala dos gráficos em números redondos, com R$ (ex.: "R$ 20 mil")
  function tetoRedondo(v) {
    if (v <= 0) return 1;
    var p = Math.pow(10, Math.floor(Math.log10(v))), M = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
    for (var i = 0; i < M.length; i++) if (M[i] * p >= v - 1e-9) return M[i] * p;
    return 10 * p;
  }
  function rsEixo(v) {
    if (Math.abs(v) < 0.5) return "R$ 0";
    if (Math.abs(v) >= 1000) return (v < 0 ? "−" : "") + "R$ " + (Math.abs(v) / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " mil";
    return AV.rs0(v);
  }
  // quadradinho (ou linha) da legenda: um SVG pequeno com a MESMA classe da barra, para o modo noturno converter igual
  function marca(cls, linha) {
    return '<svg class="av-graf av-resumo-li" viewBox="0 0 14 10" aria-hidden="true">' +
      (linha ? '<line class="' + cls + '" x1="0" x2="14" y1="5" y2="5"/>' : '<rect class="' + cls + '" x="1" y="0.5" width="12" height="9" rx="2"/>') + "</svg>";
  }

  // entradas de avaria de um conjunto de meses (setor e motivo do filtro); "md" = só os mesmos dias do mês de hoje
  function entrouAvaria(d, meses, md) {
    var o = { data: 0, est: 0, sem: 0, oc: 0 };
    d.entradas.forEach(function (r) {
      if (r.classe !== "avaria" || meses.indexOf(r.mes) < 0 || !AV.noSetor(r.setor_id) || !AV.noMotivo(r.motivo)) return;
      o.data += AV.n(md ? r.valor_data_mesmos_dias : r.valor_data); o.est += AV.n(md ? r.valor_estimado_mesmos_dias : r.valor_estimado);
      o.sem += AV.n(md ? r.sem_custo_mesmos_dias : r.sem_custo); o.oc += AV.n(md ? r.ocorrencias_mesmos_dias : r.ocorrencias);
    });
    o.total = o.data + o.est; return o;
  }
  AV.entrouAvaria = entrouAvaria;

  // avaria ÷ venda a custo: conta só o mês que TEM venda na base e já está fechado (sem o dia corrente), dos dois lados
  function vendaFechada(d, meses) {
    var V = d.venda.filter(function (v) { return AV.noSetor(v.setor_id); }), ok = [], corrente = [], semVenda = [];
    meses.forEach(function (m) {
      var L = V.filter(function (v) { return v.mes === m; });
      if (!L.length) semVenda.push(m); else if (L.some(function (v) { return v.inclui_dia_corrente; })) corrente.push(m); else ok.push(m);
    });
    var U = V.filter(function (v) { return ok.indexOf(v.mes) >= 0; });
    return { meses: ok, corrente: corrente, semVenda: semVenda, custo: AV.soma(U, function (v) { return v.venda_custo; }),
      valor: AV.soma(U, function (v) { return v.venda_valor; }), semCusto: AV.soma(U, function (v) { return v.preco_sem_custo; }) };
  }
  function listaMeses(L) {
    var seguidos = L.every(function (m, i) { return !i || AV.mesSomar(L[i - 1], 1) === m; });
    return L.length > 3 && seguidos ? AV.mesCurto(L[0]) + " a " + AV.mesCurto(L[L.length - 1]) : L.map(AV.mesCurto).join(", ");
  }

  function cartaoEntrou(d, p) {
    var e = entrouAvaria(d, p.meses), vf = AV.valorFonte(e.data, e.est, e.sem);
    var h = '<div class="av-k" data-av-cartao="entrou"><span class="av-k-q">Entrou em avaria</span>' + vf.html + vf.comp +
      '<span class="av-k-s">' + pl(e.oc, "ocorrência") + " · só os motivos de avaria, pelo custo da data da entrada</span>";
    var vx = vendaFechada(d, p.meses), fora = [];
    if (vx.corrente.length) fora.push("a venda do mês corrente não entra: o dia de hoje ainda não tem custo fechado");
    if (vx.semVenda.length) fora.push("sem venda na base para " + listaMeses(vx.semVenda));
    if (vx.meses.length && vx.custo > 0) {
      var ef = entrouAvaria(d, vx.meses);
      h += '<div class="av-k-ctx" data-av-venda="' + vx.meses.join(",") + '"><b>' + AV.pct(100 * ef.total / vx.custo) + "</b> da venda a custo" +
        (vx.meses.length < p.meses.length ? " (só " + (vx.meses.length === 1 ? "o mês " : "os meses ") + listaMeses(vx.meses) + ", dos dois lados da conta)" : "") +
        '<br><span class="av-quem">venda sem custo na base: ' + AV.pct(vx.valor ? 100 * vx.semCusto / vx.valor : 0) + " do valor vendido" + (fora.length ? " · " + fora.join(" · ") : "") + "</span></div>";
    } else {
      h += '<div class="av-k-ctx" data-av-venda="">% da venda: <b>—</b><br><span class="av-quem">' + (fora.join(" · ") || "sem venda a custo na base para o período") + "</span></div>";
    }
    // contra o histórico (só mês a mês, a partir de 11/2024): o mês ao lado da faixa dos 12 meses anteriores
    if (p.meses.length === 1 && p.meses[0] >= "2024-11") {
      var m = p.meses[0], md = !!p.parcial && m === AV.hoje().slice(0, 7), ant = [];
      for (var k = 1; k <= 12; k++) ant.push(entrouAvaria(d, [AV.mesSomar(m, -k)], md).total);
      var mn = Math.min.apply(null, ant), mx = Math.max.apply(null, ant), v = md ? entrouAvaria(d, [m], true).total : e.total;
      var pos = v > mx + 0.004 ? "acima do maior" : v < mn - 0.004 ? "abaixo do menor" : "dentro da faixa";
      h += '<div class="av-k-nota">Contra os 12 meses anteriores' + (md ? ", pelos mesmos dias (1 a " + AV.hoje().slice(8, 10) + ")" : "") + ": " + AV.rs0(mn) + " a " + AV.rs0(mx) + " · <b>" + pos + "</b>. É contexto, não alerta.</div>";
    } else if (p.meses.length === 1) {
      h += '<div class="av-k-nota">A comparação com o histórico começa em novembro/2024 (antes disso não há 12 meses anteriores no livro).</div>';
    }
    return h + "</div>";
  }

  function saidasDoPeriodo(d) { return d.saidas.filter(function (r) { return AV.noPeriodo(r.mes) && AV.noSetor(r.setor_id); }); }
  var ORDEM_NIVEL = ["comprovado", "comprovado_parcial", "declarado", "declarado_parcial", "em_aberto_vr", "assumido", "assumido_parcial", "nao_identificado", "sem_acerto_a_fazer"];

  function cartaoSaiu(d, p) {
    var L = saidasDoPeriodo(d);
    var vd = AV.soma(L, function (r) { return r.valor_data; }), ve = AV.soma(L, function (r) { return r.valor_estimado; });
    var semc = AV.soma(L, function (r) { return r.com_parte_sem_custo; }), vf = AV.valorFonte(vd, ve, semc, { unidade: semc === 1 ? "saída com parte" : "saídas com parte" });
    var h = '<div class="av-k" data-av-cartao="saiu"><span class="av-k-q">Saiu da troca</span>' + vf.html + vf.comp +
      '<span class="av-k-s">' + pl(AV.soma(L, function (r) { return r.saidas; }), "saída") + " da troca no período, pelo custo da entrada · o motivo não se aplica</span><ul class=\"av-k-l\">";
    // o custo estimado de cada grupo fica escrito numa linha só, abaixo da lista (no cartão estreito, um selo por linha embaralha)
    var sub = function (rot, G, attr) { return '<li class="av-sub-n"' + (attr || "") + "><span>" + rot + "</span><b>" + AV.rs(AV.soma(G, vt)) + "</b></li>"; }, estG = [];
    AV.GRUPOS.forEach(function (g) {
      var G = L.filter(function (r) { return grupoDe(r) === g.id; }), eg = AV.soma(G, function (r) { return r.valor_estimado; });
      if (eg > 0.004) estG.push(g.nome.toLowerCase() + " " + AV.rs(eg));
      h += '<li data-av-grupo="' + g.id + '"><span>' + g.nome + "</span><b>" + AV.rs(AV.soma(G, vt)) + "</b></li>";
      if (g.id === "acerto_fornecedor") {           // o plano divide por nível SÓ o acerto com fornecedor
        // decisão do dono (3,5): o nível aqui é medido pelo CUSTO DA MERCADORIA que saiu; em Fornecedores, pelo valor nos documentos.
        // O rótulo diz a base, para nunca haver dois "Comprovado" iguais com bases diferentes.
        var nv = ORDEM_NIVEL.slice(); G.forEach(function (r) { if (nv.indexOf(r.nivel) < 0) nv.push(r.nivel); });
        nv.forEach(function (n) { var N = G.filter(function (r) { return r.nivel === n; }); if (N.length) h += sub(AV.nivel(n) + ' <span class="av-resumo-base">pelo custo da mercadoria</span>', N, ' data-av-nivel="' + AV.esc(n) + '"'); });
      }
      if (g.id === "assumido") {                    // sempre com a origem
        h += sub("identificado no VR", G.filter(function (r) { return r.grupo === "assumido"; }), ' data-av-origem="vr"');
        var PN = G.filter(assumidaNoPainel); if (PN.length) h += sub("registrado no Painel", PN, ' data-av-origem="painel"');
      }
      if (g.id === "nao_identificado") {            // o VR comprova por documento a nota de parte destas saídas
        var C = G.filter(function (r) { return r.nivel === "comprovado"; }), CP = G.filter(function (r) { return r.nivel === "comprovado_parcial"; });
        if (C.length || CP.length) h += '<li class="av-sub-n av-resumo-exp" data-av-ni-comp="' + (AV.soma(C, vt) + AV.soma(CP, vt)).toFixed(2) + '"><span>destas, ' +
          (C.length ? AV.rs(AV.soma(C, vt)) + " são de notas que o VR comprova por documento" : "") + (C.length && CP.length ? " e " : "") +
          (CP.length ? AV.rs(AV.soma(CP, vt)) + " de notas que ele comprova em parte" : "") + ' <button type="button" class="av-lk av-resumo-lk" data-av="ni-comp">(ver na nota)</button></span></li>';
      }
    });
    var conf = AV.soma(L, function (r) { return r.em_conferencia; });
    h += "</ul>" + (estG.length ? '<div class="av-k-nota"><span class="av-est">Custo estimado dentro dos grupos: ' + estG.join(" · ") + ".</span></div>" : "") + (conf ? '<div class="av-k-nota">' + pl(conf, "saída") + " de notas com conflito entre fontes, em conferência.</div>" : "") +
      (L.some(assumidaNoPainel) ? '<div class="av-k-nota">Saída sem destino no VR cuja nota o Painel registrou como “loja assume” conta em “Assumido pela loja”, com a origem “registrado no Painel”. O VR continua igual.</div>' : "") +
      '<div class="av-k-nota">Comprovado = há documento no VR que sustenta o acerto, segundo as regras do Painel. Não é extrato do banco nem dinheiro recebido. ' +
      'Aqui o valor é o <b>custo da mercadoria</b> que saiu; em Fornecedores, “Comprovado nos documentos” é o <b>valor da nota</b>. São grandezas diferentes e não precisam bater.</div>';
    return h + "</div>";
  }
  AV.cartaoSaiu = cartaoSaiu;

  // "Como foi informado o acerto?" — forma escrita no VR para as saídas que pedem acerto, pelo custo da entrada.
  // É declaração, não prova. Soma exatamente o "Acerto com fornecedor" e o "Destino não identificado" do cartão Saiu.
  function formasDeclaradas(d) {
    var L = saidasDoPeriodo(d).filter(function (r) { return (r.grupo === "acerto_fornecedor" || r.grupo === "nao_identificado") && !assumidaNoPainel(r); });
    var por = {}, ordem = FORMAS.map(function (f) { return f[0]; }).concat(["painel", ""]);
    L.forEach(function (r) {
      var k = r.forma ? r.forma : /declarado/.test(r.nivel || "") ? "painel" : "";
      if (ordem.indexOf(k) < 0) ordem.splice(ordem.length - 2, 0, k);
      var o = por[k] || (por[k] = { v: 0, est: 0, n: 0, semNota: 0 });
      o.v += vt(r); o.est += AV.n(r.valor_estimado); o.n += AV.n(r.saidas); if (r.sem_nota) o.semNota += AV.n(r.saidas);
    });
    var itens = ordem.filter(function (k) { return por[k]; });
    var h = '<div class="av-card av-resumo-formas" data-av-bloco="formas"><h3>Como foi informado o acerto das saídas?</h3>' +
      '<p class="av-sub">Forma escrita no VR (motivo da exportação ou texto da nota) para as saídas de “Acerto com fornecedor” e de “Destino não identificado” do cartão Saiu da troca: mesmo período, mesmo setor, pelo custo da entrada. <b>É declaração, não prova</b>: o nível de cada uma está no cartão e nas Pendências.</p>';
    if (!itens.length) return h + '<p class="avr-vazio">Nenhuma saída de acerto com fornecedor ou de destino não identificado no período.</p></div>';
    h += '<ul class="av-resumo-fl">';
    itens.forEach(function (k) {
      var o = por[k], nome = k === "painel" ? "Informada no Painel (acerto ligado)" : k ? nomeForma(k) : "Não informada";
      h += '<li data-av-forma="' + AV.esc(k || "nao_informada") + '"' + (k ? "" : ' class="av-resumo-fl-ni"') + "><span>" + AV.esc(nome) + "</span><b>" + AV.rs(o.v) + "</b><i>" + pl(o.n, "saída") +
        (o.semNota ? (o.semNota === o.n ? ", sem nota" : ", " + AV.int(o.semNota) + " sem nota") : "") + (o.est > 0.004 ? ' · <span class="av-est">inclui ' + AV.rs(o.est) + " custo estimado</span>" : "") + "</i></li>";
    });
    return h + "</ul></div>";
  }

  function assumidoDoPeriodo(d, p) {
    var S = saidasDoPeriodo(d);
    var vr = S.filter(function (r) { return r.grupo === "assumido"; }), pn = S.filter(assumidaNoPainel);
    var casos = d.assumido.filter(function (a) { return p.meses.indexOf(a.mes) >= 0; });
    var soPainel = casos.filter(function (a) { return a.origem_painel && !a.origem_vr; });
    var o = { vrData: AV.soma(vr, function (r) { return r.valor_data; }), vrEst: AV.soma(vr, function (r) { return r.valor_estimado; }),
      duas: casos.filter(function (a) { return a.origem_painel && a.origem_vr; }).length };
    if (AV.estado.setor) {
      // o registro do Painel é por nota: com o filtro de setor, conta só as saídas DESTE setor nas notas registradas
      o.painel = AV.soma(pn, vt); o.painelEst = AV.soma(pn, function (r) { return r.valor_estimado; }); o.painelNota = 0;
      var ni = {}; d.naoIdent.forEach(function (x) { if (x.tipo === "destino_nao_identificado" && x.nota_id) (ni[x.nota_id] = ni[x.nota_id] || {})[x.setor_id] = 1; });
      o.casos = casos.filter(function (a) {
        if (AV.n(a.setores) <= 1) return AV.noSetor(a.setor_id);
        if (a.nota_id && ni[a.nota_id]) return !!ni[a.nota_id][AV.estado.setor];
        return true;                                // não dá para saber pelo que foi lido: entra, marcado
      });
    } else {
      o.painel = AV.soma(soPainel, function (a) { return a.valor_custo_entrada; }); o.painelEst = 0;
      o.painelNota = AV.soma(soPainel, function (a) { return a.valor_so_o_que_falta; }); o.casos = casos;
    }
    return o;
  }
  function cartaoAssumido(d, p) {
    var a = assumidoDoPeriodo(d, p), est = a.vrEst + a.painelEst;
    var tot = a.vrData + a.vrEst + a.painel;
    var h = '<div class="av-k" data-av-cartao="assumido"><span class="av-k-q">Assumido pela loja</span><span class="av-v">' + AV.rs(tot) + "</span>" +
      (est > 0.004 ? '<span class="av-comp">inclui <span class="av-est">' + AV.rs(est) + " custo estimado</span></span>" : "") +
      '<span class="av-k-s">o que já saiu do VR e ficou como perda da loja, pela data da saída, pelo custo da entrada</span><ul class="av-k-l">' +
      '<li data-av-origem="vr"><span>identificado no VR</span><b>' + AV.rs(a.vrData + a.vrEst) + "</b></li>" +
      '<li data-av-origem="painel"><span>registrado no Painel</span><b>' + AV.rs(a.painel) + "</b></li>" +
      (a.painelNota > 0.004 ? '<li class="av-sub-n"><span>e, no valor da nota (outra base, não somada), só o que faltava comprovar</span><b>' + AV.rs(a.painelNota) + "</b></li>" : "") + "</ul>";
    if (AV.estado.setor) h += '<div class="av-k-nota">O registro do Painel é por nota: com o filtro de setor, conta só as saídas deste setor nas notas registradas.</div>';
    if (a.duas) h += '<div class="av-k-nota">' + pl(a.duas, "caso achado", "casos achados") + " pelas duas origens: conta" + (a.duas === 1 ? "" : "m") + " uma vez, no VR.</div>";
    h += (a.casos.length ? '<button type="button" class="av-lk" data-av="assumidos">' + (a.casos.length === 1 ? "Ver o caso" : "Ver os " + AV.int(a.casos.length) + " casos") + "</button>" : "") +
      '<div class="av-k-nota">Fica abaixo do real de propósito: só conta o que está escrito (VR) ou registrado com motivo (Painel).</div>';
    return h + "</div>";
  }

  function cartaoParado(d) {
    var L = d.parado.filter(function (r) { return AV.noSetor(r.setor_id); });
    var vd = AV.soma(L, function (r) { return r.valor_data; }), ve = AV.soma(L, function (r) { return r.valor_estimado; });
    var prod = {}, semc = {}; L.forEach(function (r) { prod[r.id_produto] = 1; if (AV.n(r.qtd_sem_custo) > 0) semc[r.id_produto] = 1; });
    // produtos diferentes (quilo e unidade) nunca somam quantidade: conta-se o PRODUTO com parte sem custo
    var ns = Object.keys(semc).length, vf = AV.valorFonte(vd, ve, ns, { unidade: ns === 1 ? "produto com parte" : "produtos com parte" });
    var h = '<div class="av-k" data-av-cartao="parado"><span class="av-k-q">Parado na troca agora</span>' + vf.html + vf.comp +
      '<span class="av-k-s">' + pl(Object.keys(prod).length, "produto") + ", pelo custo da entrada · o período e o motivo não se aplicam</span>" + '<div class="av-fx">';
    var mx = 0, pf = AV.faixas.map(function (f) { var v = AV.soma(L.filter(function (r) { return r.faixa === f; }), vt); if (v > mx) mx = v; return v; });
    AV.faixas.forEach(function (f, i) { h += "<span>" + AV.nomeFaixa(f) + '</span><i style="width:' + (mx ? Math.max(1, 100 * pf[i] / mx) : 0).toFixed(1) + '%"></i><b>' + AV.rs0(pf[i]) + "</b>"; });
    var fe = AV.faixas.filter(function (f) { return AV.soma(L.filter(function (r) { return r.faixa === f; }), function (r) { return r.valor_estimado; }) > 0.004; });
    return h + '</div><div class="av-k-nota">Idade de cada parte, pela data em que entrou.' + (ve > 0.004 ? ' <span class="av-est">' + (fe.length === AV.faixas.length ? "Todas as faixas incluem" : "As faixas " + fe.map(AV.nomeFaixa).join(", ") + " incluem") + " parte dos " + AV.rs(ve) + " de custo estimado.</span>" : "") +
      " O saldo negativo fica fora (caixa própria em Pendências).</div></div>";
  }

  // "O que tratar agora": situações objetivas de HOJE, sem pontuação e sem prioridade inventada. Cada linha leva à fila certa
  // e diz a sua base; bases diferentes (custo da entrada, valor do título, valor da nota) nunca se somam.
  function tratar(d) {
    var itens = [], st = AV.estado.setor, loja = st ? ' <span class="av-chip av-resumo-loja" title="Títulos e notas não têm setor único">toda a loja: o setor não se aplica</span>' : "";
    var A = d.filaA.filter(function (r) { return AV.noSetor(r.setor_id); });
    var nA = A.filter(function (r) { return AV.n(r.qtd_sem_custo) > 0; }).length;
    var vfA = AV.valorFonte(AV.soma(A, function (r) { return r.valor_data; }), AV.soma(A, function (r) { return r.valor_estimado; }), nA, { unidade: nA === 1 ? "produto com parte" : "produtos com parte" });
    itens.push({ o: "Mercadoria parada na troca", n: pl(A.length, "produto") + " · " + AV.rs(vfA.total), b: "pelo custo da entrada", comp: vfA.comp,
      d: "pela parte mais antiga: " + (AV.faixas.map(function (f) { var k = A.filter(function (r) { return r.faixa_mais_antiga === f; }).length; return k ? AV.nomeFaixa(f) + ": " + pl(k, "produto") : ""; }).filter(Boolean).join(" · ") || "nenhum"), ir: ["pendencias", "A"], chave: "A" });
    var B = d.filaB, venc = B.filter(function (r) { return AV.n(r.dias_vencido) > 0; }), avis = B.filter(function (r) { return r.outra_evidencia; });   // regra da fila B: título aberto + outra evidência (títulos únicos)
    itens.push({ o: "Títulos de devolução em aberto no VR" + loja, n: pl(B.length, "título") + " · " + AV.rs(AV.soma(B, function (r) { return r.valor; })), b: "pelo valor do título", chave: "B",
      d: pl(venc.length, "vencido") + " pelo vencimento (" + AV.rs(AV.soma(venc, function (r) { return r.valor; })) + ")" + (avis.length ? " · " + pl(avis.length, "título") + " com outra evidência indicando acerto, que requer conferência" : ""), ir: ["pendencias", "B"] });
    // fila C: as contagens usam os MESMOS nomes e números das etiquetas da fila C (pelo nível de cada nota)
    var C = d.filaC, porN = {}; C.forEach(function (r) { (porN[r.nivel] = porN[r.nivel] || []).push(r); });
    var NOMES_C = { comprovado: ["comprovada", "comprovadas"], declarado: ["declarada", "declaradas"], declarado_parcial: ["declarada em parte", "declaradas em parte"], comprovado_parcial: ["comprovada em parte", "comprovadas em parte"],
      nao_identificado: ["não identificada", "não identificadas"], assumido_parcial: ["assumida em parte", "assumidas em parte"], em_aberto_vr: ["em aberto no VR", "em aberto no VR"] };
    var partesC = ORDEM_NIVEL.concat(Object.keys(porN).filter(function (n) { return ORDEM_NIVEL.indexOf(n) < 0; })).filter(function (n) { return porN[n]; }).map(function (n) {
      var L = porN[n], nm = NOMES_C[n] || [AV.nomeNivel(n).toLowerCase(), AV.nomeNivel(n).toLowerCase()], t = pl(L.length, nm[0], nm[1]);
      var sf = L.filter(function (r) { return !r.forma_texto; }).length, cf = L.filter(function (r) { return r.provas === "conferencia"; }).length;
      if (n === "nao_identificado") t += sf === L.length ? ", sem forma informada" : " (" + AV.int(sf) + " sem forma informada)";
      if (cf) t += " (" + AV.int(cf) + " com documento do VR em conferência)";
      return t;
    });
    // conflito entre fontes que NÃO é o documento em conferência (esse já foi dito acima, nível a nível)
    var conf = C.filter(function (r) { return r.em_conferencia && r.provas !== "conferencia"; });
    itens.push({ o: "Saídas aguardando comprovação (desde 08/05/2026)" + loja, n: pl(C.length, "nota") + " · " + AV.rs(AV.soma(C, function (r) { return r.valor; })), b: "pelo valor da nota", chave: "C",
      d: partesC.join(" · ") + (conf.length ? " · " + pl(conf.length, "nota") + " com conflito entre fontes, em conferência" : ""), ir: ["pendencias", "C"] });
    // acertos do Painel (etapa 4): vínculo pendente fica na fila A (ciclo aberto); acerto aguardando vínculo, na fila C
    var acertos = d.acertos.filter(function (a) { return AV.noSetor(setorDe(a.id_produto)); }), est = {}; acertos.forEach(function (a) { est[a.acerto_id] = a; });
    var pend = {}; d.vinculos.forEach(function (v) { var a = est[v.acerto_id]; if (a && a.estado === "aberto" && ((v.condicoes_que_falham || []).length || v.saidas_aptas_do_acerto !== 1)) pend[v.acerto_id] = 1; });
    var agu = acertos.filter(function (a) { return a.estado === "aguardando_vinculo"; }), nenhum = !d.acertos.length;
    itens.push({ o: "Vínculos de acerto pendentes de conferência", n: pl(Object.keys(pend).length, "acerto"), b: "quantidade por produto, sem valor", chave: "vinculo",
      d: nenhum ? "nenhum acerto registrado no Painel ainda: o registro só começa na etapa 4" : "acerto do ciclo aberto com mais de uma saída possível, ou alguma das 8 condições falhando: o sistema só liga sozinho quando o vínculo é inequívoco", ir: ["pendencias", "A"] });
    itens.push({ o: "Acertos aguardando vínculo", n: pl(agu.length, "acerto"), b: "quantidade por produto, sem valor", chave: "aguardando",
      d: nenhum ? "nenhum acerto registrado no Painel ainda" : "o ciclo do produto já fechou e o acerto informado ainda não foi ligado a uma saída", ir: ["pendencias", "C"] });
    return itens;
  }

  // as quatro listas de informação ausente de HOJE (desde 08/05 para saídas e notas), com o filtro de setor onde há setor.
  // A saída cuja nota o Painel registrou como "loja assume" sai daqui: ela já tem destino (Assumido pela loja).
  function naoIdentHoje(d) {
    var ni = d.naoIdent, desde = function (t) { return ni.filter(function (x) { return x.tipo === t && (!x.data || x.data >= FILA_C_DESDE); }); };
    var mais = function (a, b) { return a.data < b.data ? 1 : a.data > b.data ? -1 : 0; };
    return {
      dn: desde("destino_nao_identificado").filter(function (x) { return AV.noSetor(x.setor_id) && x.nivel !== "assumido"; }).sort(mais),
      st: desde("nota_sem_texto").sort(mais),
      sc: ni.filter(function (x) { return x.tipo === "entrada_sem_custo" && AV.noSetor(x.setor_id); }).sort(mais),
      aa: ni.filter(function (x) { return x.tipo === "setor_a_acertar" && AV.noSetor(x.setor_id); }).sort(function (a, b) { return vt2(b) - vt2(a); })
    };
  }
  function vt2(x) { return AV.n(x.valor); }
  var comprova = function (x) { return x.nivel === "comprovado" || x.nivel === "comprovado_parcial"; };

  function blocoTratar(d) {
    var itens = tratar(d), ni = naoIdentHoje(d), st = AV.estado.setor;
    var dnC = ni.dn.filter(comprova).length, stC = ni.st.filter(comprova).length, stF = ni.st.filter(function (x) { return x.em_conferencia && !comprova(x); }).length;
    itens.push({ o: "Informação ausente ou não identificada", n: "", b: "4 listas de naturezas diferentes, nunca somadas", lista: true, chave: "naoident",
      d: [pl(ni.dn.length, "saída") + " com destino não identificado desde 08/05" + (dnC ? " (" + AV.int(dnC) + " de notas que o VR comprova por documento)" : ""),
        pl(ni.st.length, "nota") + " sem título e sem texto desde 08/05" + (stC || stF ? " (" + [stC ? pl(stC, "comprovada", "comprovadas") + " por outro documento do VR" : "", stF ? AV.int(stF) + " com documento em conferência" : ""].filter(Boolean).join(", ") + ")" : "") + (st ? ", da loja inteira" : ""),
        pl(ni.sc.length, "entrada") + " sem custo nem histórico", pl(ni.aa.length, "produto parado", "produtos parados") + " no setor “A acertar”"].join(" · "), ir: ["pendencias", "C"] });
    var N = d.negativo.filter(function (r) { return AV.noSetor(r.setor_id); });
    itens.push({ o: "Problema de lançamento: saldo negativo no estoque de troca", n: pl(N.length, "produto"), b: "fica fora de todo total", chave: "negativo",
      d: "o acerto é feito no VR; aparece no pé das Pendências · variação desde ontem: indisponível nesta prévia", ir: ["pendencias", "negativo"] });
    var h = '<div class="av-card" data-av-bloco="tratar"><h3>O que tratar agora</h3><p class="av-sub">Fatos objetivos da situação de hoje, na ordem das filas. Não é pontuação nem ordem de prioridade. ' +
      "Cada linha diz a sua base (custo da entrada, valor do título, valor da nota): <b>estes valores não se somam</b>. O período e o motivo não se aplicam." +
      (st ? " O setor filtra mercadoria, saídas, entradas, produtos e acertos; títulos e notas não têm setor único e ficam com a loja inteira (marcados)." : "") + '</p><ul class="av-tratar">';
    itens.forEach(function (x) {
      var bt = x.lista ? '<button type="button" class="av-lk" data-av="naoident">Ver as listas →</button>'
        : '<button type="button" class="av-lk" data-av-ir="' + x.ir.join("|") + '">' + (x.ir[1] === "negativo" ? "Ver a caixa" : "Abrir a fila " + x.ir[1]) + " →</button>";
      h += '<li data-av-tratar="' + x.chave + '"><span class="av-t-o">' + x.o + '<span class="av-t-d">' + x.d + "</span>" + (x.comp || "") + '</span><span class="av-t-n">' + x.n +
        (x.b ? '<span class="av-t-b">' + x.b + "</span>" : "") + "</span>" + bt + "</li>";
    });
    return h + "</ul></div>";
  }

  // ---------- caixas fora do total ----------
  function caixasFora(d) {
    var P = d.perda.filter(function (r) { return r.marca !== "negada" && AV.noPeriodo(r.mes) && AV.noSetor(r.setor_id); });
    var neg = d.perda.filter(function (r) { return r.marca === "negada" && AV.noPeriodo(r.mes) && AV.noSetor(r.setor_id); });
    var porSetor = {}; P.forEach(function (r) { porSetor[r.setor_id] = (porSetor[r.setor_id] || 0) + AV.n(r.valor); });
    var top = Object.keys(porSetor).sort(function (a, b) { return porSetor[b] - porSetor[a]; });
    var resto = top.slice(3).reduce(function (s, k) { return s + porSetor[k]; }, 0);
    var decl = P.filter(function (r) { return r.marca === "declarada"; }), semc = AV.soma(P, function (r) { return r.sem_custo; });
    var oc = AV.soma(P, function (r) { return r.ocorrencias; }), nNeg = AV.soma(neg, function (r) { return r.ocorrencias; });
    var h = '<div class="av-fora-g"><div class="av-fora" data-av-bloco="perda"><span class="av-rot">fora da troca · não somada</span><h3>Avaria lançada direto na perda</h3>' +
      '<span class="av-v">' + AV.rs(AV.soma(P, function (r) { return r.valor; })) + "</span>" + (semc ? '<span class="av-comp"><span class="av-semc">+ ' + pl(semc, "ocorrência") + " sem custo conhecido</span></span>" : "") +
      '<span class="av-k-s">' + pl(oc, "ocorrência") + (top.length ? " · " + top.slice(0, 3).map(function (k) { return AV.esc(AV.nomeSetor(k).toLowerCase()) + " " + AV.rs0(porSetor[k]); }).join(" · ") + (resto > 0.5 ? " · demais " + AV.rs0(resto) : "") : "") + "</span>" +
      (decl.length ? '<div class="av-k-nota">' + (function (n) { return n === 1 ? "1 delas diz" : AV.int(n) + " delas dizem"; })(AV.soma(decl, function (r) { return r.ocorrencias; })) + " “para bonificar” (declarada, " + AV.rs(AV.soma(decl, function (r) { return r.valor; })) + "). Aqui, “assumida” vale só dentro desta caixa.</div>" : "") +
      (nNeg ? '<div class="av-k-nota">' + pl(nNeg, "linha nega", "linhas negam") + " a avaria no texto: fica" + (nNeg === 1 ? "" : "m") + " fora do total, à parte na lista.</div>" : "") +
      '<div class="av-k-nota">Pelo custo gravado na linha da perda. Não entra no cartão “Assumido pela loja”.</div>' +
      (oc || nNeg ? '<button type="button" class="av-lk" data-av="perdas">Ver as linhas →</button>' : "") + "</div>";
    var E = d.entradas.filter(function (r) { return (r.classe === "erro" || r.classe === "outros") && AV.noPeriodo(r.mes) && AV.noSetor(r.setor_id); });
    var er = E.filter(function (r) { return r.classe === "erro"; }), ou = E.filter(function (r) { return r.classe === "outros"; });
    var val = function (L) { return AV.soma(L, vt); };
    var vf = AV.valorFonte(AV.soma(E, function (r) { return r.valor_data; }), AV.soma(E, function (r) { return r.valor_estimado; }), AV.soma(E, function (r) { return r.sem_custo; }));
    h += '<div class="av-fora" data-av-bloco="erro"><span class="av-rot">fora do total</span><h3>Erro operacional e outros processos</h3>' + vf.html + vf.comp +
      '<span class="av-k-s">erro ao coletar e de balanço ' + AV.rs(val(er)) + " · ação, degustação, recolhimento e nota especificada " + AV.rs(val(ou)) + "</span>" +
      '<div class="av-k-nota">Entram na troca, mas não são avaria. O filtro de motivo não se aplica aqui.</div></div></div>';
    return h;
  }

  // ---------- gráfico 1: a troca está acumulando? (entrou × saiu, todas as classes, com o ajuste fora do livro) ----------
  AV.serieLivro = function (d) {
    var pm = {};
    d.livro.forEach(function (r) {
      if (!AV.noSetor(r.setor_id)) return;
      var m = pm[r.mes] || (pm[r.mes] = { mes: r.mes, e: 0, eEst: 0, eSem: 0, s: 0, sEst: 0, sSem: 0, c: [0, 0, 0, 0], cEst: [0, 0, 0, 0], casos: [0, 0, 0, 0] });
      m.e += AV.n(r.entrou_data) + AV.n(r.entrou_estimado); m.eEst += AV.n(r.entrou_estimado); m.eSem += AV.n(r.entrou_sem_custo);
      m.s += AV.n(r.saiu_data) + AV.n(r.saiu_estimado); m.sEst += AV.n(r.saiu_estimado); m.sSem += AV.n(r.saiu_sem_custo);
      for (var k = 0; k < 4; k++) { m.c[k] += AV.n(r["c" + (k + 1)]); m.cEst[k] += AV.n(r["c" + (k + 1) + "_estimado"]); m.casos[k] += AV.n(r["c" + (k + 1) + "_casos"]); }
    });
    var meses = Object.keys(pm).sort(), acc = 0;
    return meses.map(function (k) { var m = pm[k]; m.aj = m.c[0] + m.c[1] - m.c[2] + m.c[3]; acc += m.e - m.s + m.aj; m.parado = acc; return m; });
  };
  function eixoY(h, W, esq, dir, y, mx) {
    [0, 0.5, 1].forEach(function (f) { var v = mx * f, yy = y(v); h.push('<line class="av-g-eixo" x1="' + esq + '" x2="' + (W - dir) + '" y1="' + yy + '" y2="' + yy + '"/><text x="' + (esq - 5) + '" y="' + (yy + 3) + '" text-anchor="end">' + rsEixo(v) + "</text>"); });
  }
  function graficoLivro(d, p, largura) {
    var S = AV.serieLivro(d), fim = p.meses[p.meses.length - 1], atual = AV.hoje().slice(0, 7);
    var janela = []; for (var i = 12; i >= 0; i--) janela.push(AV.mesSomar(fim, -i));
    var por = {}; S.forEach(function (m) { por[m.mes] = m; });
    var V = janela.map(function (m) { return por[m] || { mes: m, e: 0, eEst: 0, eSem: 0, s: 0, sEst: 0, sSem: 0, aj: 0, parado: null, vazio: true }; });
    V.forEach(function (m) { if (m.vazio) { var ant = null; S.forEach(function (x) { if (x.mes <= m.mes) ant = x; }); m.parado = ant ? ant.parado : 0; } });
    var W = Math.max(320, Math.min(760, largura)), H = W < 480 ? 230 : 250, esq = W < 480 ? 50 : 60, dir = 8, top = 12, base = H - 34;
    var mx = 1, mn = 0; V.forEach(function (m) { mx = Math.max(mx, m.e, m.s, m.parado || 0, m.aj); mn = Math.min(mn, m.aj); });
    mx = tetoRedondo(mx);
    var y = function (v) { return top + (base - top) * (mx - v) / (mx - mn); }, g = (W - esq - dir) / V.length, bw = Math.max(3, g * 0.26);
    var h = ['<svg class="av-graf" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Entrou e saiu da troca, mês a mês, 13 meses, com a linha do que ficou parado no fim de cada mês">'];
    eixoY(h, W, esq, dir, y, mx);
    var pts = [], alvos = [];
    V.forEach(function (m, i) {
      var x0 = esq + g * i + g * 0.1, parc = m.mes === atual ? " av-g-parcial" : "";
      h.push('<rect class="av-g-ent' + parc + '" x="' + x0 + '" y="' + y(m.e) + '" width="' + bw + '" height="' + Math.max(0, y(0) - y(m.e)) + '"><title>' + AV.mesNome(m.mes) + " · entrou " + AV.rs(m.e) +
        (m.eEst > 0.004 ? " (inclui " + AV.rs(m.eEst) + " custo estimado)" : "") + (m.eSem ? " + " + pl(m.eSem, "entrada") + " sem custo conhecido" : "") + (parc ? " · mês parcial" : "") + "</title></rect>");
      h.push('<rect class="av-g-sai' + parc + '" x="' + (x0 + bw + 1) + '" y="' + y(m.s) + '" width="' + bw + '" height="' + Math.max(0, y(0) - y(m.s)) + '"><title>' + AV.mesNome(m.mes) + " · saiu " + AV.rs(m.s) +
        (m.sEst > 0.004 ? " (inclui " + AV.rs(m.sEst) + " custo estimado)" : "") + (m.sSem ? " + " + pl(m.sSem, "saída") + " com parte sem custo" : "") + (parc ? " · mês parcial" : "") + "</title></rect>");
      if (Math.abs(m.aj) > 0.004) {
        var ya = m.aj >= 0 ? y(m.aj) : y(0), ha = Math.max(2, Math.abs(y(m.aj) - y(0))), xa = x0 + 2 * bw + 2;
        h.push('<rect class="av-g-aj" x="' + xa + '" y="' + ya + '" width="' + Math.max(3, bw * 0.7) + '" height="' + ha + '"/>');
        // área de toque: a coluna inteira do mês em volta da barra do ajuste (pelo menos 32 de altura); invisível
        var ay = Math.max(top, Math.min(ya, y(0) - 16)), ah = Math.max(32, ha + 16);
        alvos.push('<rect class="av-resumo-alvo" data-av-aj="' + m.mes + '" x="' + (esq + g * i) + '" y="' + ay + '" width="' + g + '" height="' + Math.min(ah, H - ay) + '"><title>' + AV.mesNome(m.mes) + " · ajuste fora do livro " + AV.rs(m.aj) + " (toque para ver as quatro partes)</title></rect>");
      }
      pts.push((x0 + bw) + "," + y(m.parado || 0));
      if (g >= 40 || i % (g >= 24 ? 2 : 3) === 0 || i === V.length - 1) h.push('<text x="' + (x0 + bw) + '" y="' + (base + 14) + '" text-anchor="middle">' + AV.mesCurto(m.mes) + "</text>");
    });
    h.push('<polyline class="av-g-lin" points="' + pts.join(" ") + '"/>');
    var lp = pts[pts.length - 1].split(",");
    h.push('<circle class="av-g-pt" cx="' + lp[0] + '" cy="' + lp[1] + '" r="3.5"/>' + alvos.join("") + "</svg>");
    return { svg: h.join(""), V: V, S: S };
  }
  function cartaoLivro(d, p, largura) {
    var G = graficoLivro(d, p, largura), V = G.V, S = G.S, atual = AV.hoje().slice(0, 7);
    var eEst = AV.soma(V, function (m) { return m.eEst; }), sEst = AV.soma(V, function (m) { return m.sEst; });
    var eSem = AV.soma(V, function (m) { return m.eSem; }), sSem = AV.soma(V, function (m) { return m.sSem; });
    var custo = [];
    if (eEst > 0.004 || sEst > 0.004) custo.push('<span class="av-est">custo estimado dentro das barras: ' + AV.rs(eEst) + " no que entrou e " + AV.rs(sEst) + " no que saiu</span>");
    if (eSem || sSem) custo.push('<span class="av-semc">fora das barras, sem custo conhecido: ' + [eSem ? pl(eSem, "entrada") : "", sSem ? pl(sSem, "saída") + " com parte sem custo" : ""].filter(Boolean).join(" e ") + "</span>");
    // a conta fecha? parado de hoje (fila) × acumulado do livro
    var hoje = AV.soma(d.parado.filter(function (r) { return AV.noSetor(r.setor_id); }), vt);
    var dif = (S.length ? S[S.length - 1].parado : 0) - hoje;
    var aj = V.filter(function (m) { return Math.abs(m.aj) > 0.004; });
    var h = '<div class="av-card" data-av-bloco="grafico-livro"><h3>A troca está acumulando?</h3><p class="av-sub">Entrou na troca (todas as classes) e saiu dela, mês a mês, pelo custo da data, com o custo estimado dito abaixo; a linha é o que ficou parado no fim de cada mês. O filtro de motivo não se aplica a este gráfico.</p>' +
      '<div class="av-leg"><span>' + marca("av-g-ent") + "Entrou na troca (todas as classes)</span><span>" + marca("av-g-sai") + "Saiu da troca</span><span>" + marca("av-g-aj") + "Ajuste fora do livro</span><span>" +
      marca("av-g-lin", true) + "Parado no fim do mês</span></div>" + G.svg +
      (custo.length ? '<p class="av-resumo-custo">Nos 13 meses: ' + custo.join(" · ") + ".</p>" : '<p class="av-resumo-custo">Nos 13 meses, tudo pelo custo da data.</p>');
    if (aj.length) h += '<div class="av-resumo-ajl" data-av-bloco="ajustes"><span class="av-resumo-ajl-t">Ajuste fora do livro, mês a mês (toque para ver as quatro partes):</span>' +
      aj.map(function (m) { return '<button type="button" class="av-bt av-resumo-ajbt" data-av-aj="' + m.mes + '">' + AV.mesCurto(m.mes) + " <b>" + (m.aj > 0 ? "+ " : "− ") + AV.rs(Math.abs(m.aj)) + "</b></button>"; }).join("") + "</div>";
    return h + '<div class="av-id">A conta fecha: parado de hoje ' + AV.rs(hoje) + " · diferença não explicada " +
      (Math.abs(dif) < 0.01 ? '<span class="av-id-ok" data-av-dif="0">' + AV.rs(0) + "</span>" : '<span class="av-id-mal" data-av-dif="' + dif.toFixed(2) + '">' + AV.rs(dif) + "</span>") +
      (V.some(function (m) { return m.mes === atual; }) ? '<span class="av-quem">· barra tracejada = mês parcial</span>' : "") + "</div></div>";
  }

  // ---------- gráfico 2: por que entra avaria, e está mudando? (motivo, mês a mês, com a faixa dos 12 meses anteriores) ----------
  function graficoMotivo(d, p, largura) {
    var fim = p.meses[p.meses.length - 1], janela = [], atual = AV.hoje().slice(0, 7);
    for (var i = 12; i >= 0; i--) janela.push(AV.mesSomar(fim, -i));
    var mot = AV.estado.motivo ? [+AV.estado.motivo] : AV.MOTIVOS_AVARIA;
    var linhas = function (m, mo) { return d.entradas.filter(function (r) { return r.classe === "avaria" && r.mes === m && +r.motivo === mo && AV.noSetor(r.setor_id); }); };
    var val = function (m, mo, md) { return AV.soma(linhas(m, mo), function (r) { return md ? AV.n(r.valor_data_mesmos_dias) + AV.n(r.valor_estimado_mesmos_dias) : vt(r); }); };
    var M = janela.map(function (m) {
      var o = { mes: m, p: {}, e: {}, t: 0, est: 0, sem: 0 };
      mot.forEach(function (mo) { var L = linhas(m, mo); o.p[mo] = AV.soma(L, vt); o.e[mo] = AV.soma(L, function (r) { return r.valor_estimado; }); o.t += o.p[mo]; o.est += o.e[mo]; o.sem += AV.soma(L, function (r) { return r.sem_custo; }); });
      return o;
    });
    // faixa dos 12 meses anteriores ao último mês (pelos mesmos dias, se ele é o mês parcial); vale a partir de 11/2024
    var faixa = null, md = fim === atual;
    if (fim >= "2024-11") {
      var ant = []; for (var k = 1; k <= 12; k++) { var mm = AV.mesSomar(fim, -k); ant.push(mot.reduce(function (s, mo) { return s + val(mm, mo, md); }, 0)); }
      faixa = [Math.min.apply(null, ant), Math.max.apply(null, ant)];
    }
    var W = Math.max(320, Math.min(760, largura)), H = W < 480 ? 220 : 240, esq = W < 480 ? 50 : 60, dir = 8, top = 12, base = H - 34;
    var mx = 1; M.forEach(function (o) { mx = Math.max(mx, o.t); }); if (faixa) mx = Math.max(mx, faixa[1]);
    mx = tetoRedondo(mx);
    var y = function (v) { return top + (base - top) * (mx - v) / mx; }, g = (W - esq - dir) / M.length, bw = Math.max(4, g * 0.6);
    var h = ['<svg class="av-graf" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Entrou em avaria por motivo, mês a mês, 13 meses">'];
    eixoY(h, W, esq, dir, y, mx);
    if (faixa) h.push('<rect class="av-g-faixa" x="' + (esq + g * 12) + '" y="' + y(faixa[1]) + '" width="' + g + '" height="' + Math.max(2, y(faixa[0]) - y(faixa[1])) + '"><title>Faixa dos 12 meses anteriores' + (md ? " (mesmos dias)" : "") + ": " + AV.rs0(faixa[0]) + " a " + AV.rs0(faixa[1]) + "</title></rect>");
    M.forEach(function (o, i) {
      var x0 = esq + g * i + (g - bw) / 2, acc = 0;
      mot.forEach(function (mo) { var v = o.p[mo]; if (v <= 0) return;
        h.push('<rect class="av-g-m' + mo + (o.mes === atual ? " av-g-parcial" : "") + '" x="' + x0 + '" y="' + y(acc + v) + '" width="' + bw + '" height="' + Math.max(0.5, y(acc) - y(acc + v)) + '"><title>' + AV.mesNome(o.mes) + " · " + AV.esc(AV.nomeMotivo(mo)) + " " + AV.rs(v) +
          (o.e[mo] > 0.004 ? " (inclui " + AV.rs(o.e[mo]) + " custo estimado)" : "") + "</title></rect>"); acc += v; });
      if (g >= 40 || i % (g >= 24 ? 2 : 3) === 0 || i === M.length - 1) h.push('<text x="' + (x0 + bw / 2) + '" y="' + (base + 14) + '" text-anchor="middle">' + AV.mesCurto(o.mes) + "</text>");
    });
    h.push("</svg>");
    return { svg: h.join(""), M: M, faixa: faixa, md: md, fim: fim, mot: mot };
  }
  function cartaoMotivo(d, p, largura) {
    var G = graficoMotivo(d, p, largura), M = G.M, faixa = G.faixa, md = G.md, fim = G.fim;
    var ult = M[M.length - 1].t;
    var txt = faixa ? "Último mês (" + AV.mesCurto(fim) + (md ? ", parcial" : "") + "): " + AV.rs0(ult) + " · faixa dos 12 meses anteriores" + (md ? " pelos mesmos dias" : "") + ": " + AV.rs0(faixa[0]) + " a " + AV.rs0(faixa[1]) +
      " · " + (ult > faixa[1] + 0.004 ? "acima do maior" : ult < faixa[0] - 0.004 ? "abaixo do menor" : "dentro da faixa") : "Antes de 11/2024 não há 12 meses anteriores para comparar.";
    // o custo estimado fica à vista, mês a mês (no celular não há dica ao passar o dedo)
    var comEst = M.filter(function (o) { return o.est > 0.004; }), est = AV.soma(M, function (o) { return o.est; }), sem = AV.soma(M, function (o) { return o.sem; });
    var custo = [];
    if (comEst.length) custo.push('<span class="av-est">' + AV.rs(est) + " de custo estimado dentro das barras" + (comEst.length <= 4 ? " (" + comEst.map(function (o) { return AV.mesCurto(o.mes) + " " + AV.rs(o.est); }).join(" · ") + ")" : ", em " + comEst.length + " dos 13 meses") + "</span>");
    if (sem) custo.push('<span class="av-semc">' + pl(sem, "ocorrência") + " sem custo conhecido, fora das barras</span>");
    return '<div class="av-card" data-av-bloco="grafico-motivo"><h3>Por que entra avaria, e está mudando?</h3><p class="av-sub">Entrou em avaria por motivo, mês a mês, pelo custo da data, com o custo estimado dito abaixo. A faixa cinza é a menor e a maior dos 12 meses anteriores: é contexto, não alerta.</p><div class="av-leg">' +
      G.mot.map(function (mo) { return "<span>" + marca("av-g-m" + mo) + AV.esc(AV.nomeMotivo(mo)) + "</span>"; }).join("") + (faixa ? "<span>" + marca("av-g-faixa") + "Faixa dos 12 meses anteriores</span>" : "") + "</div>" + G.svg +
      '<p class="av-resumo-custo">' + (custo.length ? "Nos 13 meses: " + custo.join(" · ") + "." : "Nos 13 meses, tudo pelo custo da data.") + "</p>" +
      '<div class="av-id"><span class="av-quem">' + txt + "</span></div></div>";
  }

  // ---------- gráfico 3: quanto tempo a mercadoria fica na troca? (mediana e faixas; entradas por avaria) ----------
  // (também usado por Produtos e Fornecedores: "valor_estimado" e "partes_sem_custo" são opcionais)
  AV.tempoAteSair = function (L) {
    var tot = AV.soma(L, function (r) { return r.partes; }), ord = L.slice().sort(function (a, b) { return a.dias - b.dias; }), acc = 0, med = null;
    for (var i = 0; i < ord.length; i++) { acc += AV.n(ord[i].partes); if (acc >= tot / 2) { med = ord[i].dias; break; } }
    var fx = {}; AV.faixas.forEach(function (f) { fx[f] = { partes: 0, valor: 0, est: 0, sem: 0 }; });
    L.forEach(function (r) { var f = AV.faixas[r.dias <= 30 ? 0 : r.dias <= 60 ? 1 : r.dias <= 90 ? 2 : r.dias <= 180 ? 3 : r.dias <= 365 ? 4 : 5];
      fx[f].partes += AV.n(r.partes); fx[f].valor += AV.n(r.valor); fx[f].est += AV.n(r.valor_estimado); fx[f].sem += AV.n(r.partes_sem_custo); });
    return { mediana: med, partes: tot, faixas: fx };
  };
  function graficoTempo(d) {
    var L = d.tempo.filter(function (r) { return AV.noPeriodo(r.mes) && AV.noSetor(r.setor_id); }), t = AV.tempoAteSair(L);
    var h = '<div class="av-card" data-av-bloco="grafico-tempo"><h3>Quanto tempo a mercadoria fica na troca?</h3><p class="av-sub">Dias entre a entrada por avaria e a saída da troca, para cada parte que saiu no período, pelo custo da entrada. ' +
      "Só as partes que entraram por motivo de avaria: por isso o valor não bate com o cartão Saiu da troca, que tem todas as classes. O filtro de motivo não se aplica.</p>";
    if (!t.partes) return h + '<p class="avr-vazio">Nenhuma saída de mercadoria de avaria no período.</p></div>';
    var val = AV.soma(L, function (r) { return r.valor; }), est = AV.soma(L, function (r) { return r.valor_estimado; }), sem = AV.soma(L, function (r) { return r.partes_sem_custo; });
    var vf = AV.valorFonte(val - est, est, sem, { unidade: sem === 1 ? "parte" : "partes" });
    h += '<p class="av-resumo-med"><span class="av-v" data-av-mediana="' + t.mediana + '">' + pl(t.mediana, "dia") + '</span> <span class="av-quem">mediana: ' +
      (t.partes === 1 ? "a única parte saiu em " + pl(t.mediana, "dia") : "metade das " + AV.int(t.partes) + " partes saiu em até " + pl(t.mediana, "dia")) + "</span></p>" +
      '<p class="av-resumo-tot">' + AV.rs(vf.total) + " no total das faixas" + (vf.comp ? " · " + vf.comp.replace(/^<span class="av-comp">|<\/span>$/g, "") : ", todo pelo custo da data") + '</p><div class="av-fx av-resumo-fx">';
    var mx = 0; AV.faixas.forEach(function (f) { mx = Math.max(mx, t.faixas[f].partes); });
    AV.faixas.forEach(function (f) {
      var x = t.faixas[f];
      h += "<span>" + AV.nomeFaixa(f) + '</span><i style="width:' + (mx ? Math.max(1, 100 * x.partes / mx) : 0).toFixed(1) + '%"></i><b>' + AV.pct(100 * x.partes / t.partes) + " das partes · " +
        AV.rs0(x.valor) + AV.marcaEst(x.est) + (x.sem ? ' <span class="av-semc">+ ' + AV.int(x.sem) + " sem custo</span>" : "") + "</b>";
    });
    return h + '</div><div class="av-k-nota">Estimativa pelo método da fila (a mais antiga sai primeiro): o VR não rastreia cada unidade.</div></div>';
  }

  // ---------- montagem ----------
  function desenhar(el, d) {
    var p = AV.periodo(AV.estado.periodo), larg = Math.max(320, el.clientWidth || 900);
    var lg = larg < 900 ? larg - 36 : Math.floor((larg - 12) * 0.574) - 36, lm = larg < 900 ? larg - 36 : Math.floor((larg - 12) * 0.426) - 36;
    var h = '<div class="av-resumo"><p class="av-nsoma">Mostrando: <b>' + AV.esc(AV.textoFiltro(["periodo", "setor", "motivo"])) + "</b>" + (p.parcial ? " · período com mês parcial" : "") + "</p>";
    h += '<div class="av-kpis">' + cartaoEntrou(d, p) + cartaoSaiu(d, p) + cartaoAssumido(d, p) + cartaoParado(d) + "</div>";
    h += formasDeclaradas(d) + blocoTratar(d);
    h += '<div class="av-graf-g">' + cartaoLivro(d, p, lg) + cartaoMotivo(d, p, lm) + "</div>";
    h += graficoTempo(d) + caixasFora(d) + "</div>";
    el.innerHTML = h;
    el.querySelectorAll("[data-av-ir]").forEach(function (b) { b.addEventListener("click", function () { var x = b.getAttribute("data-av-ir").split("|"); AV.irPara(x[0], { fila: x[1] }); }); });
    var liga = function (sel, fn) { var b = el.querySelector(sel); if (b) b.addEventListener("click", fn); };
    liga("[data-av=assumidos]", function () { listaAssumidos(d, p); });
    liga("[data-av=naoident]", function () { listaNaoIdent(d); });
    liga("[data-av=ni-comp]", function () { listaComprovadas(d, p); });
    liga("[data-av=perdas]", function () { listaPerdas(p); });
    el.querySelectorAll("[data-av-aj]").forEach(function (r) { r.addEventListener("click", function () { composicaoAjuste(d, r.getAttribute("data-av-aj")); }); });
  }

  // uma lista longa mostra um lote por vez, com "Mostrar mais" (como as filas das Pendências)
  function listaEmLotes(caixa, cols, L, opc) {
    var LOTE = window.innerWidth && window.innerWidth <= 760 ? 10 : 25, n = Math.min(L.length, LOTE);
    function mostra() {
      caixa.innerHTML = AV.tabela(cols, L.slice(0, n), opc) + (n < L.length ? '<div class="av-mais"><button type="button" class="av-bt av-resumo-mais">Mostrar mais ' +
        Math.min(LOTE, L.length - n) + " (faltam " + AV.int(L.length - n) + ")</button></div>" : "");
      caixa.querySelectorAll("[data-av-nota]").forEach(function (b) { b.addEventListener("click", function () { if (AV.abrirNota) AV.abrirNota(+b.getAttribute("data-av-nota"), { origem: "pendencias" }); }); });
      var bm = caixa.querySelector(".av-resumo-mais");
      if (bm) bm.addEventListener("click", function () { var antes = n; n = Math.min(L.length, n + LOTE); mostra(); var t = caixa.querySelectorAll("tbody tr")[antes]; if (t) { t.tabIndex = -1; t.focus(); } });
    }
    mostra();
  }
  function prodCel(id, extra) { var p = AV.produtos[id] || {}; return '<span class="av-nome">' + AV.esc(p.nome || "produto " + id) + '</span><span class="av-nome-s">' + AV.esc(AV.nomeSetor(p.setor_id)) + " · código " + AV.esc(id) + (extra || "") + "</span>"; }
  function notaBt(x) { return x.nota_id ? '<button type="button" class="av-lk av-resumo-nf" data-av-nota="' + AV.esc(x.nota_id) + '">NF ' + AV.esc(x.nota_numero || "sem número") + "</button>" : '<span class="av-quem">sem nota</span>'; }
  function nivelCel(x) {
    if (!x.nivel) return "—";
    return '<span class="av-resumo-niv">' + AV.nivel(x.nivel) + (x.em_conferencia ? " " + AV.chip("documento em conferência", "av-chip-conf", "Há documento do VR citando esta nota, ainda em conferência") : "") +
      (comprova(x) ? '<span class="av-nome-s">o VR comprova por outro documento</span>' : "") + "</span>";
  }

  function listaAssumidos(d, p) {
    var a = assumidoDoPeriodo(d, p), L = a.casos.slice().sort(function (x, y) { return x.data_saida < y.data_saida ? 1 : -1; });
    var corpo = AV.gaveta("Assumido pela loja · " + AV.esc(AV.textoFiltro(["periodo", "setor"])), pl(L.length, "caso") + ", pela data da saída. A origem aparece em cada um." +
      (AV.estado.setor ? " Com o filtro de setor, o valor de cada caso é o da nota inteira." : ""), "");
    var cx = corpo.appendChild(document.createElement("div")); cx.className = "av-card";
    listaEmLotes(cx, [
      { t: "Origem", cls: "l", cel: "principal", v: function (x) { return '<span class="av-pill av-n-assum">' + AV.esc(x.selo) + "</span>" + (x.origem_painel ? '<span class="av-nome-s">registrado por ' + AV.esc(x.quem || "—") + " em " + AV.dataHora(x.registrado_em) + " · motivo: " + AV.esc(x.motivos || "—") + "</span>" : "") +
        (AV.n(x.setores) > 1 ? '<span class="av-nome-s">nota com produtos de ' + AV.int(x.setores) + " setores</span>" : ""); } },
      { t: "Saída", cls: "l", v: function (x) { return AV.dataCurta(x.data_saida) + " · " + (x.nota_id ? notaBt(x) : "sem nota"); } },
      { t: "Valor", v: function (x) { return x.valor_custo_entrada !== null ? '<span class="av-num">' + AV.rs(x.valor_custo_entrada) + "</span>" + '<span class="av-nome-s">custo da entrada</span>' : '<span class="av-num">' + AV.rs(x.valor_so_o_que_falta) + "</span>" + '<span class="av-nome-s">no valor da nota, só o que faltava</span>'; } },
      { t: "Texto do VR", cls: "l", v: function (x) { return x.nota_texto ? '<span class="av-quem">' + AV.esc(String(x.nota_texto).slice(0, 140)) + "</span>" : '<span class="av-quem">—</span>'; } }
    ], L, { vazio: "Nenhum caso no período." });
  }

  // as quatro listas de informação ausente ou não identificada, cada uma com a sua contagem (nunca somadas); índice no alto
  function listaNaoIdent(d) {
    var ni = naoIdentHoje(d), st = AV.estado.setor;
    var G = [
      { id: "saidas", t: "Saídas com destino não identificado (desde 08/05/2026)", curto: "saídas", L: ni.dn,
        sub: "O texto do VR não diz para onde a mercadoria foi. O nível ao lado é o da nota: quando o VR comprova a nota por outro documento, aparece aqui.", cols: [
        { t: "Produto", cls: "l", cel: "principal", v: function (x) { return prodCel(x.id_produto); } }, { t: "Saída", v: function (x) { return AV.dataCurta(x.data); } },
        { t: "Nota", v: notaBt }, { t: "Nível da nota", cls: "l", v: nivelCel },
        { t: "Valor", rot: "Valor (custo da entrada)", v: function (x) { return valorEst(x.valor, x.valor_estimado); } }] },
      { id: "notas", t: "Notas sem título e sem texto (desde 08/05/2026)", curto: "notas", L: ni.st,
        sub: "A nota não tem texto nem título no VR. O nível diz se outro documento ou boleto do VR a comprova." + (st ? " Notas não têm setor único: esta lista é da loja inteira." : ""), cols: [
        { t: "Nota", cls: "l", cel: "principal", v: function (x) { return notaBt(x) + (x.detalhe ? '<span class="av-nome-s">tipo no VR: ' + AV.esc(x.detalhe) + "</span>" : ""); } },
        { t: "Data", v: function (x) { return AV.dataCurta(x.data); } }, { t: "Nível", cls: "l", v: nivelCel },
        { t: "Valor da nota", v: function (x) { return '<span class="av-num">' + AV.rs(x.valor) + "</span>"; } }] },
      { id: "entradas", t: "Entradas sem custo nem histórico (desde 2023)", curto: "entradas", L: ni.sc,
        sub: "O VR não tem custo para a data nem custo de hoje: ficam sem valor, nunca como zero.", cols: [
        { t: "Produto", cls: "l", cel: "principal", v: function (x) { return prodCel(x.id_produto, " · linha " + AV.esc(x.chave) + " do VR"); } }, { t: "Entrada", v: function (x) { return AV.dataCurta(x.data); } },
        { t: "Observação do VR", cls: "l", v: function (x) { return x.detalhe ? '<span class="av-quem">' + AV.esc(x.detalhe) + "</span>" : '<span class="av-quem">—</span>'; } }] },
      { id: "setor", t: "Produtos parados no setor “A acertar”", curto: "produtos", L: ni.aa,
        sub: "O cadastro do VR não diz o setor.", cols: [
        { t: "Produto", cls: "l", cel: "principal", v: function (x) { return prodCel(x.id_produto); } }, { t: "Na troca desde", v: function (x) { return AV.dataCurta(x.data); } },
        { t: "Valor parado", rot: "Valor parado (custo da entrada)", v: function (x) { return valorEst(x.valor, x.valor_estimado); } }] }
    ];
    var corpo = AV.gaveta("Informação ausente ou não identificada", "Quatro listas de naturezas diferentes; cada uma com a sua contagem, nunca somadas." + (st ? " Setor: " + AV.esc(AV.nomeSetor(st)) + "." : ""), "");
    corpo.innerHTML = '<nav class="av-resumo-ind" aria-label="As quatro listas">' + G.map(function (g) {
      return '<button type="button" class="av-bt" data-av-ir-lista="' + g.id + '">' + AV.esc(g.t.replace(/ \(.*\)$/, "")) + " <b>" + AV.int(g.L.length) + "</b></button>"; }).join("") + "</nav>" +
      G.map(function (g) { return '<div class="av-card" id="avNi-' + g.id + '"><h3>' + g.t + " · " + AV.int(g.L.length) + '</h3><p class="av-sub">' + g.sub + '</p><div data-av-lista="' + g.id + '"></div></div>'; }).join("");
    G.forEach(function (g) { listaEmLotes(corpo.querySelector('[data-av-lista="' + g.id + '"]'), g.cols, g.L, { vazio: "Nenhum." }); });
    corpo.querySelectorAll("[data-av-ir-lista]").forEach(function (b) { b.addEventListener("click", function () {
      var alvo = document.getElementById("avNi-" + b.getAttribute("data-av-ir-lista")); if (alvo) { alvo.scrollIntoView({ block: "start" }); var h3 = alvo.querySelector("h3"); if (h3) { h3.tabIndex = -1; h3.focus({ preventScroll: true }); } } }); });
  }

  // saídas do período sem destino escrito no VR, mas de nota que o VR comprova por documento ou boleto (o grupo não muda)
  function listaComprovadas(d, p) {
    var S = d.naoIdent.filter(function (x) { return x.tipo === "destino_nao_identificado" && x.data && p.meses.indexOf(String(x.data).slice(0, 7)) >= 0 && AV.noSetor(x.setor_id) && comprova(x); });
    var por = {}; S.forEach(function (x) { var o = por[x.nota_id] || (por[x.nota_id] = { nota_id: x.nota_id, nota_numero: x.nota_numero, data: x.data, nivel: x.nivel, em_conferencia: x.em_conferencia, n: 0, valor: 0, est: 0 });
      o.n += 1; o.valor += AV.n(x.valor); o.est += AV.n(x.valor_estimado); if (x.data > o.data) o.data = x.data; });
    var L = Object.keys(por).map(function (k) { return por[k]; }).sort(function (a, b) { return a.data < b.data ? 1 : -1; });
    var corpo = AV.gaveta("Destino não identificado, com prova no VR · " + AV.esc(AV.textoFiltro(["periodo", "setor"])),
      pl(L.length, "nota") + " · " + pl(S.length, "saída") + " · " + AV.rs(AV.soma(S, function (x) { return x.valor; })) + " pelo custo da entrada. O texto do VR não diz o destino, mas outro documento ou boleto do VR comprova a nota. O grupo de destino continua o mesmo; abra a nota para ver a prova.", "");
    var cx = corpo.appendChild(document.createElement("div")); cx.className = "av-card";
    listaEmLotes(cx, [
      { t: "Nota", cls: "l", cel: "principal", v: notaBt }, { t: "Última saída", v: function (x) { return AV.dataCurta(x.data); } },
      { t: "Nível da nota", cls: "l", v: nivelCel }, { t: "Saídas", v: function (x) { return AV.int(x.n); } },
      { t: "Valor", rot: "Valor (custo da entrada)", v: function (x) { return valorEst(x.valor, x.est); } }
    ], L, { vazio: "Nenhuma no período." });
  }

  // linhas da avaria lançada direto na perda, no período e setor do filtro. As que negam a avaria ficam à parte, fora do total.
  function listaPerdas(p) {
    var corpo = AV.gaveta("Avaria lançada direto na perda · " + AV.esc(AV.textoFiltro(["periodo", "setor"])), "Fora da troca e nunca somada a ela. Pelo custo gravado na linha da perda.", '<div class="av-card"><p class="avr-vazio">Carregando as linhas…</p></div>');
    AV.ler("perdas").then(function (T) {
      var L = T.filter(function (x) { return x.data && p.meses.indexOf(String(x.data).slice(0, 7)) >= 0 && AV.noSetor(setorDe(x.id_produto)); })
        .sort(function (a, b) { return a.data < b.data ? 1 : a.data > b.data ? -1 : b.perda_id - a.perda_id; });
      var conta = L.filter(function (x) { return x.marca !== "negada"; }), neg = L.filter(function (x) { return x.marca === "negada"; });
      var comCusto = function (x) { return AV.n(x.custo) > 0; }, valor = function (x) { return AV.n(x.qtd) * AV.n(x.custo); };
      var semc = conta.filter(function (x) { return !comCusto(x); }).length, decl = conta.filter(function (x) { return x.marca === "declarada"; });
      var MARCA = { avaria: ["avaria", ""], declarada: ["declarada: “para bonificar”", "av-resumo-decl"], negada: ["nega a avaria", "av-chip-conf"] };
      var cols = [
        { t: "Produto", cls: "l", cel: "principal", v: function (x) { return prodCel(x.id_produto, " · quantidade " + AV.qtd(x.qtd)); } },
        { t: "Data", v: function (x) { return AV.dataCurta(x.data); } },
        { t: "Observação do VR", cls: "l", v: function (x) { return x.obs ? '<span class="av-quem">' + AV.esc(String(x.obs).slice(0, 160)) + "</span>" : '<span class="av-quem">—</span>'; } },
        { t: "Valor", v: function (x) { return comCusto(x) ? '<span class="av-num">' + AV.rs(valor(x)) + "</span>" : '<span class="av-semc">sem custo conhecido</span>'; } },
        { t: "Marca", cls: "l", v: function (x) { var m = MARCA[x.marca] || [x.marca || "—", ""]; return AV.chip(AV.esc(m[0]), m[1]); } }
      ];
      corpo.innerHTML = '<div class="av-card"><h3>Contam no total · ' + pl(conta.length, "linha") + '</h3><p class="av-sub"><b>' + AV.rs(AV.soma(conta.filter(comCusto), valor)) + "</b>" +
        (semc ? ' <span class="av-semc">+ ' + pl(semc, "linha") + " sem custo conhecido</span>" : "") +
        (decl.length ? " · " + pl(decl.length, "linha diz", "linhas dizem") + " “para bonificar” (declarada, " + AV.rs(AV.soma(decl.filter(comCusto), valor)) + "): é declaração, não prova" : "") + '.</p><div data-av-lista="conta"></div></div>' +
        '<div class="av-card av-resumo-neg"><h3>Negam a avaria no texto · ' + pl(neg.length, "linha") + '</h3><p class="av-sub">O texto da linha diz que não é avaria: fica' + (neg.length === 1 ? "" : "m") + ' fora do total e da caixa.</p><div data-av-lista="neg"></div></div>';
      listaEmLotes(corpo.querySelector('[data-av-lista="conta"]'), cols, conta, { vazio: "Nenhuma linha no período." });
      listaEmLotes(corpo.querySelector('[data-av-lista="neg"]'), cols, neg, { vazio: "Nenhuma no período." });
    }, function () { corpo.innerHTML = '<div class="av-card"><p class="avr-vazio">Não deu para carregar as linhas agora.</p></div>'; });
  }

  // ---------- ajuste fora do livro: as quatro partes do mês, cada uma explicada, e os itens com o número da linha do VR ----------
  var PARTES = ["Saldo que já existia quando o livro começou", "Saída sem saldo no livro", "Entrada que só cobriu saldo negativo", "Mudança de saldo sem movimento"];
  var PARTES_CURTO = ["saldo de antes do livro", "saída sem saldo", "entrada que cobriu saldo negativo", "mudança sem movimento"];
  var POR = ["o livro do VR só registra desde 19/10/2023", "saiu mais do que o livro mostra que entrou", "não vira mercadoria parada", "o VR alterou o saldo por outro caminho"];
  function composicaoAjuste(d, mes) {
    var m = null; AV.serieLivro(d).forEach(function (x) { if (x.mes === mes) m = x; });
    if (!m) return;
    var corpo = AV.gaveta("Ajuste fora do livro · " + AV.mesNome(mes) + (AV.estado.setor ? " · " + AV.esc(AV.nomeSetor(AV.estado.setor)) : ""), "O que o livro da troca não explica, em quatro partes. Nunca é um valor genérico.", '<div class="av-card"><p class="avr-vazio">Carregando os itens…</p></div>');
    AV.ler("ajustes").then(function (T) {
      var I = T.filter(function (x) { return String(x.data).slice(0, 7) === mes && AV.noSetor(setorDe(x.id_produto)); });
      var semValor = function (x) { return x.negativo && Math.abs(AV.n(x.valor)) < 0.005; };
      var h = '<div class="av-card"><dl class="av-dl">';
      for (var k = 0; k < 4; k++) {
        var P = I.filter(function (x) { return +x.componente === k + 1; }), sv = P.filter(semValor).length;
        h += "<dt>" + (k + 1) + ". " + PARTES[k] + '<span class="av-nome-s">' + POR[k] + "</span></dt><dd>" + (k === 2 ? "− " : "+ ") + AV.rs(m.c[k]) + " · " +
          (sv ? pl(P.length - sv, "caso") + " com valor · " + pl(sv, "caso") + " com saldo negativo, sem valor" : pl(m.casos[k], "caso")) +
          (m.cEst[k] > 0.004 ? '<span class="av-nome-s"><span class="av-est">' + AV.rs(m.cEst[k]) + " pelo custo estimado</span></span>" : "") + "</dd>";
      }
      h += "<dt><b>Ajuste do mês</b></dt><dd><b>" + AV.rs(m.aj) + "</b></dd></dl>" +
        '<p class="av-k-nota">Conta: parado no fim = parado no início + entrou − saiu + (1 + 2 − 3 + 4). Qualquer sobra apareceria em vermelho como “diferença não explicada”.</p>' +
        (I.some(semValor) ? '<p class="av-k-nota">Saldo negativo quando o livro começou fica sem valor: é problema de lançamento, coberto depois pela parte 3.</p>' : "") + "</div>";
      h += '<div class="av-card"><h3>' + (I.length === 1 ? "O único item do mês" : "Os " + AV.int(I.length) + " itens do mês") + '</h3><p class="av-sub">Cada item leva o número da linha do VR.</p><div data-av-lista="aj"></div></div>';
      corpo.innerHTML = h;
      listaEmLotes(corpo.querySelector('[data-av-lista="aj"]'), [
        { t: "Produto", cls: "l", cel: "principal", v: function (x) { var p = AV.produtos[x.id_produto] || {}; return '<span class="av-nome">' + AV.esc(p.nome || "produto " + x.id_produto) + '</span><span class="av-nome-s">linha ' + AV.esc(x.linha_id) + " do VR · " + AV.dataCurta(x.data) + "</span>"; } },
        { t: "Parte", cls: "l", v: function (x) { return AV.esc(x.componente + ". " + PARTES_CURTO[x.componente - 1]); } },
        { t: "Quantidade", v: function (x) { return AV.qtd(x.qtd); } },
        { t: "Valor", v: function (x) { return semValor(x) ? '<span class="av-quem">sem valor (saldo negativo)</span>'
          : '<span class="av-resumo-vv">' + AV.rs(x.valor) + (x.fonte_custo === "hoje_estimado" ? ' <span class="av-chip av-chip-est">estimado</span>' : "") + "</span>"; } }
      ], I, { vazio: "Nenhum item neste mês." });
    }, function () { corpo.innerHTML = '<div class="av-card"><p class="avr-vazio">Não deu para carregar os itens.</p></div>'; });
  }
})();
