/* ==AV-FORNECEDORES== AVARIAS · Fornecedores. SOMENTE LEITURA: nada aqui grava.
   Colunas separadas, cada uma com a sua base de VALOR (nota, título ou verba) e de DATA; NUNCA somadas entre si (não existe
   total "do fornecedor"). Ordem alfabética, sem classificação e sem pontuação. Filtro: só o período (setor e motivo não se aplicam).
   Fora das colunas, numa caixa própria: o declarado nas saídas SEM nota (exportação). Ele não tem fornecedor e é medido pelo
   CUSTO DA ENTRADA — natureza diferente do valor de nota —, então nunca entra em coluna nem em total de coluna.
   Acertos informados no Painel e ainda sem nota: no fornecedor INFORMADO, em número de acertos e de produtos; a quantidade
   é sempre de um produto só (quantidades de produtos diferentes nunca se somam).
   "Parte" aqui é só o lote de entrada na troca (a mais antiga sai primeiro); coluna é "coluna".
   O fornecedor relacionado (última compra) fica separado, no fim, com fundo diferente: é inferência para análise e
   nunca vira fornecedor de acerto, prova nem escolha pronta. Nada da análise aparece na tabela de cima. */
(function () {
  "use strict";
  var AV = window.AV;
  var LEITURAS = ["fornecedores", "nomesForn", "verbas", "tempo", "relacionado", "filaB", "saidas", "acertos", "documentos"];
  var SEM = "sem";                                   // a linha do fornecedor nulo (acerto de nota de baixa por perda)
  var CORTE_REL = 40;                                // a análise mostra 40 linhas e um botão para ver todas
  var busca = "", buscaRel = "", relTodos = false;   // ficam enquanto a pessoa troca o período
  // as colunas da tabela principal: uma medida da visão cada, com a sua base de valor e de data. Nenhuma se soma com outra.
  var COLS = [
    { m: "devolvido", t: "Devolvido por nota", valor: "pelo valor da nota", data: "pela data da nota", un: ["nota", "notas"],
      dica: "Valor das notas de devolução ao fornecedor emitidas no período." },
    { m: "titulo_baixado", t: "Títulos baixados no VR", valor: "pelo valor do título", data: "pela emissão do título", un: ["título", "títulos"],
      dica: "Títulos de devolução que o VR mostra baixados, emitidos no período." },
    { m: "titulo_aberto", t: "Títulos em aberto no VR", valor: "pelo valor do título", data: "todos os abertos hoje · o período não se aplica", curta: "todos os de hoje",
      un: ["título", "títulos"],
      dica: "Todos os títulos de devolução que o VR mostra em aberto hoje, de qualquer data. Aberto no VR não prova dívida. Quando outra fonte indica acerto, a tela avisa: o título continua em aberto no VR e requer conferência." },
    { m: "declarado", t: "Declarado nas notas", valor: "pelo valor da nota", data: "pela data da nota", un: ["nota", "notas"],
      dica: "Só notas: valor das notas com a forma de acerto informada (no texto da nota ou no Painel) e ainda sem documento no VR que comprove. O declarado nas saídas sem nota (exportação) não tem fornecedor e é medido pelo custo da entrada: fica fora das colunas, numa caixa separada abaixo da tabela." },
    { m: "comprovado", t: "Comprovado nos documentos", valor: "pelo valor da nota", data: "pela data da nota", un: ["nota", "notas"],
      dica: "Valor das notas (não o custo da mercadoria) que têm documento no VR sustentando o acerto, pelas regras do Painel. No Resumo, o comprovado é pelo custo da mercadoria: são grandezas diferentes. Inclui nota de baixa por perda quando um documento deste fornecedor a comprova; por isso pode passar do devolvido. Não é extrato do banco nem dinheiro recebido." },
    { m: "verba", t: "Verbas de avaria", valor: "pelo valor da verba", data: "pela data da verba", un: ["verba", "verbas"],
      dica: "Verbas de avaria lançadas no VR para o fornecedor. Não se ligam a uma avaria específica." }
  ];
  // formas de acerto: o nome aprovado vem de AV.nomeForma; aqui só os nomes que a visão escreve por extenso
  var FORMAS_EXTRA = { troca: "troca por mercadoria", boleto: "desconto no boleto", pix: "Pix ou depósito", deposito: "Pix ou depósito",
    "informado no Painel": "informada no Painel", "não informada": "forma não informada" };
  var nomeForma = function (f) { return FORMAS_EXTRA[f] || AV.nomeForma(f); };
  var FRASE_COMP = "Comprovado = há documento no VR que sustenta o acerto, segundo as regras do Painel. Não é extrato do banco nem dinheiro recebido.";
  var FRASE_BASE = "Aqui cada coluna usa o valor do próprio documento (nota, título ou verba). O Resumo mede Comprovado e Declarado pelo custo da entrada " +
    "da mercadoria que saiu da troca; por isso os números desta tela não batem com os do Resumo.";
  var FRASE_PARTE = "Parte = cada entrada de mercadoria na troca. Quando a mercadoria sai, a parte mais antiga sai primeiro, porque o VR não rastreia cada unidade.";
  var TXT_AVISO = "Existe outra evidência indicando acerto — requer conferência";
  // a origem da outra evidência (a mesma regra da fila B)
  var ORIGENS_EVID = { bonificacao: "nota de bonificação", outras_entradas: "nota de outras entradas", verba: "verba",
    compra_texto: "nota de compra com o desconto", boleto: "boleto (desconto na parcela)", texto_da_nota: "texto da nota" };
  function origensEvid(b) { var o = (b.origens_evidencia || []).map(function (k) { return ORIGENS_EVID[k] || String(k).replace(/_/g, " "); }); return o.length ? o.join(" · ") : "outra fonte do VR"; }

  AV.areas.fornecedores = function (el) {
    AV.carregando(el);
    AV.lerVarias(LEITURAS).then(function (d) { desenhar(el, d); }, function (e) { AV.falhou(el, e); });
  };

  // ---------- pequenas peças ----------
  var chave = function (f) { return f === null || f === undefined ? SEM : String(f); };
  var plural = function (q, un) { return AV.plural(q, un[0], un[1]); };
  var dias = function (q) { return plural(q, ["dia", "dias"]); };
  var un = function (q) { return AV.qtd(q) + " un."; };
  var maiuscula1 = function (s) { s = String(s || "").trim(); return s.charAt(0).toUpperCase() + s.slice(1); };
  var doVR = function (s) { return maiuscula1(String(s || "").toLowerCase()); };          // texto do VR, que vem todo em maiúsculas
  var normal = function (s) { return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); };
  var nomeP = function (id) { return (AV.produtos[id] || {}).nome || "produto " + id; };
  var porNome = function (a, b) { return String(a).localeCompare(String(b), "pt-BR", { sensitivity: "base" }); };
  var nada = '<span class="av-fornecedores-nada" title="Nada nesta coluna">—</span>';
  var bloco = function (h) { return '<span class="av-fornecedores-cel">' + h + "</span>"; };   // valor e detalhe juntos (no celular, um só campo)
  var baseTh = function (a, b) { return '<span class="av-fornecedores-base">' + a + "</span>" + (b ? '<span class="av-fornecedores-base">' + b + "</span>" : ""); };

  function nomes(d) {
    if (d._nomes) return d._nomes;
    var o = {}; d.nomesForn.forEach(function (r) { o[r.fornecedor] = r; });
    return (d._nomes = o);
  }
  function nomeDe(d, f) {
    if (f === null || f === undefined) return "Sem fornecedor comprovado";
    var x = nomes(d)[f]; return x && x.nome ? String(x.nome).trim() : "Fornecedor " + f;
  }

  // ---------- documentos do VR pelo nome de gente (nunca o código interno da cópia) ----------
  function docs(d) {
    if (d._docs) return d._docs;
    var o = {}; (d.documentos || []).forEach(function (x) { o[x.ref] = x; });
    return (d._docs = o);
  }
  // o aviso aprovado da fila B vem com o código do documento; aqui vira texto de gente (o código nunca vai para a tela)
  function textoAviso(d, s) {
    s = String(s || "");
    var m = s.match(/(?:NE|PP|VB)#\d+/), doc = m ? docs(d)[m[0]] : null;
    if (m) return "Um documento do VR indica acerto: " + (doc ? AV.nomeDocumento(doc) : "documento do VR") + ".";
    if (/boleto/i.test(s)) return "Um desconto no boleto do fornecedor cita esta nota.";
    return "Outra fonte do VR indica acerto.";
  }
  // uma prova da nota (lida no clique): o documento, o valor que ele cita desta nota e o total do documento
  // (no boleto, a cópia não guarda um valor citado: diz-se só se o desconto cita a nota ou se está em conferência, e por quê)
  var MOTIVO_BOLETO = { "mesma nota citada em mais de uma parcela": "a mesma nota paga em mais de uma parcela", "só texto, sem valor estruturado": "só texto, sem desconto registrado em número",
    "valor diferente": "desconto diferente do valor da nota", "nota sem valor ao lado": "várias notas, sem o valor de cada uma",
    "valor ao lado diferente do valor da nota": "várias notas, valor escrito diferente do da nota", "título de outra nota": "título ligado a outra nota" };
  function textoProva(d, p) {
    var doc = docs(d)[p.ref];
    var nome = doc ? AV.nomeDocumento(doc) : (p.fonte === "boleto" ? "parcela do boleto" : "documento do VR") + (p.data ? " de " + AV.dataCurta(p.data) : "");
    var cita = p.fonte === "boleto" ? (p.caso_boleto === "ambiguo" ? "desconto em conferência" + (MOTIVO_BOLETO[p.motivo] ? ": " + MOTIVO_BOLETO[p.motivo] : "") : "o desconto cita esta nota")
      : AV.tem(p.valor_citado) ? "cita " + AV.rs(p.valor_citado) + " desta nota" : "cita esta nota sem um valor só dela";
    var tot = doc && AV.tem(doc.valor_total) ? " · total do documento " + AV.rs(doc.valor_total) : "";
    return maiuscula1(nome) + " · " + cita + tot;
  }

  // mediana e faixas do tempo até sair (a mesma conta do Resumo; aqui só se ela não carregou)
  function tempoDe(L) {
    if (AV.tempoAteSair) return AV.tempoAteSair(L);
    var tot = AV.soma(L, function (r) { return r.partes; }), ord = L.slice().sort(function (a, b) { return a.dias - b.dias; }), acc = 0, med = null;
    for (var i = 0; i < ord.length; i++) { acc += AV.n(ord[i].partes); if (acc >= tot / 2) { med = ord[i].dias; break; } }
    var fx = {}; AV.faixas.forEach(function (f) { fx[f] = { partes: 0, valor: 0 }; });
    L.forEach(function (r) { var f = AV.faixas[r.dias <= 30 ? 0 : r.dias <= 60 ? 1 : r.dias <= 90 ? 2 : r.dias <= 180 ? 3 : r.dias <= 365 ? 4 : 5]; fx[f].partes += AV.n(r.partes); fx[f].valor += AV.n(r.valor); });
    return { mediana: med, partes: tot, faixas: fx };
  }

  // acertos informados no Painel e AINDA SEM NOTA (situação de hoje): acerto da mercadoria na troca, não anulado,
  // com o ciclo aberto ou aguardando ligação a uma saída, e com quantidade ainda sem saída ligada.
  // (Ligado a uma saída, ele já está na nota; acerto registrado na própria nota já entra em "Declarado nas notas".)
  function acertosSemNota(d) {
    return (d.acertos || []).filter(function (a) {
      return a.fila === "A" && !a.anulado && (a.estado === "aberto" || a.estado === "aguardando_vinculo") && AV.n(a.sem_vinculo) > 0;
    });
  }
  // "N acertos · N produtos: A, B e mais N" (conta acertos e produtos; nunca soma quantidade de produtos diferentes)
  function resumoAcertos(AC, curto) {
    var ids = {}; AC.forEach(function (a) { ids[a.id_produto] = 1; });
    var ns = Object.keys(ids).map(nomeP).sort(porNome), mostra = curto ? ns.slice(0, 2) : ns;
    return { acertos: plural(AC.length, ["acerto", "acertos"]), produtos: plural(ns.length, ["produto", "produtos"]),
      nomes: mostra.join(", ") + (ns.length > mostra.length ? " e mais " + plural(ns.length - mostra.length, ["produto", "produtos"]) : "") };
  }

  // uma linha por fornecedor com o que ele tem no período (títulos em aberto e acertos sem nota: a situação de hoje)
  function montar(d) {
    var P = {};
    function linha(f) {
      var k = chave(f);
      return P[k] || (P[k] = { k: k, id: k === SEM ? null : +f, nome: nomeDe(d, k === SEM ? null : f), m: {}, formas: {}, tipos: {}, tempo: null, ac: [], avisos: 0 });
    }
    d.fornecedores.forEach(function (r) {
      if (r.medida === "declarado_sem_nota") return;                 // fora das colunas: a caixa própria
      if (r.medida !== "titulo_aberto" && !AV.noPeriodo(r.mes)) return;
      var L = linha(r.fornecedor), x = L.m[r.medida] || (L.m[r.medida] = { v: 0, q: 0 });
      x.v += AV.n(r.valor); x.q += AV.n(r.quantidade);
      var det = r.medida === "declarado" ? L.formas : r.medida === "verba" ? L.tipos : null;
      if (det) { var nm = r.detalhe || "não informada", y = det[nm] || (det[nm] = { v: 0, q: 0 }); y.v += AV.n(r.valor); y.q += AV.n(r.quantidade); }
    });
    // títulos em aberto com outra evidência indicando acerto (a regra conceitual da fila B), contados por título no fornecedor
    d.filaB.forEach(function (b) { if (b.outra_evidencia && b.fornecedor !== null && b.fornecedor !== undefined) linha(b.fornecedor).avisos++; });
    // tempo até sair: partes que saíram por nota de devolução para esse fornecedor, no período
    var T = {};
    d.tempo.forEach(function (r) { if (r.fornecedor_comprovado === null || r.fornecedor_comprovado === undefined || !AV.noPeriodo(r.mes)) return; (T[r.fornecedor_comprovado] = T[r.fornecedor_comprovado] || []).push(r); });
    Object.keys(T).forEach(function (f) { linha(+f).tempo = tempoDe(T[f]); });
    // acertos informados no Painel, ainda sem nota: no fornecedor informado por quem registrou; sem fornecedor, numa nota abaixo
    var AC = acertosSemNota(d), semForn = [];
    AC.forEach(function (a) { if (a.fornecedor === null || a.fornecedor === undefined) semForn.push(a); else linha(a.fornecedor).ac.push(a); });
    var todos = Object.keys(P).map(function (k) { return P[k]; });
    var com = todos.filter(function (L) { return L.k !== SEM; }).sort(function (a, b) { return porNome(a.nome, b.nome) || a.id - b.id; });
    var tempoTodos = [];
    Object.keys(T).forEach(function (f) { tempoTodos = tempoTodos.concat(T[f]); });
    var sem = P[SEM] && Object.keys(P[SEM].m).length ? P[SEM] : null;
    return { lista: com, sem: sem, tempoTodos: tempoTodos.length ? tempoDe(tempoTodos) : null, semForn: semForn, temAc: AC.length > semForn.length };
  }

  // ---------- a tabela principal ----------
  var avisoCel = function (n) { return n ? '<span class="av-fornecedores-aviso">' + plural(n, ["com outra evidência indicando acerto", "com outra evidência indicando acerto"]) + "</span>" : ""; };
  function celula(L, c) {
    var x = L.m[c.m];
    if (!x || (Math.abs(x.v) < 0.005 && !x.q)) return nada;
    var h = '<span class="av-num">' + AV.rs(x.v) + '</span><span class="av-nome-s">' + plural(x.q, c.un) + "</span>";
    var det = c.m === "declarado" ? Object.keys(L.formas).map(nomeForma) : c.m === "verba" ? Object.keys(L.tipos).map(function (t) { return String(t).toLowerCase(); }) : null;
    if (det) h += '<span class="av-nome-s av-fornecedores-formas">' + AV.esc(maiuscula1(det.sort().join(", "))) + "</span>";
    if (c.m === "titulo_aberto") h += avisoCel(L.avisos);
    return bloco(h);
  }
  function celulaTempo(t) {
    if (!t || !t.partes) return nada;
    return bloco('<span class="av-num">' + dias(t.mediana) + '</span><span class="av-nome-s">mediana de ' + plural(t.partes, ["parte", "partes"]) + "</span>");
  }
  function celulaAc(AC) {
    if (!AC.length) return nada;
    var r = resumoAcertos(AC, true);
    return bloco('<span class="av-num">' + r.acertos + '</span><span class="av-nome-s">' + r.produtos + '</span><span class="av-nome-s av-fornecedores-formas">' + AV.esc(r.nomes) + "</span>");
  }
  function colunas(M) {
    var cs = [{ t: "Fornecedor", rot: "Fornecedor", cls: "l av-fornecedores-col-nome", cel: "principal", v: function (L) {
      if (L.k === SEM) return '<button type="button" class="av-lk av-fornecedores-abre">Sem fornecedor comprovado</button><span class="av-nome-s">acerto de nota de baixa por perda: ela não é devolução ao fornecedor, então o VR não diz com quem foi o acerto</span>';
      return '<button type="button" class="av-lk av-fornecedores-abre" data-av-forn="' + L.k + '">' + AV.esc(L.nome) + '</button><span class="av-nome-s">código ' + L.id + " no VR</span>";
    } }];
    COLS.forEach(function (c) {
      cs.push({ t: c.t + baseTh(c.valor, c.data), rot: c.t + " (" + c.valor + ", " + (c.curta || c.data) + ")", dica: c.dica + " Base: " + c.valor + ", " + c.data + ".",
        cls: "av-fornecedores-col", v: function (L) { return celula(L, c); } });
    });
    cs.push({ t: "Tempo até sair" + baseTh("mediana, em dias", "no período"), rot: "Tempo até sair (mediana, no período)", cls: "av-fornecedores-col",
      dica: "Dias entre a entrada da mercadoria na troca e a saída dela por nota de devolução a este fornecedor, no período. Metade das partes saiu em até esse número de dias. " + FRASE_PARTE,
      v: function (L) { return celulaTempo(L.tempo); } });
    if (M.temAc) cs.push({ t: "Acertos informados no Painel, ainda sem nota" + baseTh("em acertos e produtos", "situação de hoje · o período não se aplica"),
      rot: "Acertos informados no Painel, ainda sem nota (hoje)", cls: "av-fornecedores-col av-fornecedores-col-ac",
      dica: "Acertos registrados no Painel para a mercadoria na troca, com este fornecedor informado, que ainda não estão ligados a uma saída com nota. Conta acertos e produtos: a quantidade é de cada produto e não se soma entre produtos diferentes.",
      v: function (L) { return celulaAc(L.ac); } });
    return cs;
  }

  // rodapé: o total de CADA coluna, sozinho; nunca uma soma entre colunas
  function rodape(linhas, M, filtrado) {
    var h = '<tr><td class="l av-cel-principal" data-rot=""><span class="av-nome">Total de cada coluna — as colunas não se somam entre si</span>' +
      (filtrado ? '<span class="av-nome-s">só os fornecedores da busca</span>' : "") + "</td>";
    COLS.forEach(function (c) {
      var v = 0, q = 0, av = 0; linhas.forEach(function (L) { var x = L.m[c.m]; if (x) { v += x.v; q += x.q; } av += L.avisos || 0; });
      h += '<td class="av-fornecedores-col" data-rot="' + AV.esc(c.t + " (" + c.valor + ")") + '">' + (q ? bloco('<span class="av-num">' + AV.rs(v) + '</span><span class="av-nome-s">' + plural(q, c.un) + "</span>" +
        (c.m === "titulo_aberto" ? avisoCel(av) : "")) : nada) + "</td>";
    });
    var t = filtrado ? null : M.tempoTodos;
    h += '<td class="av-fornecedores-col" data-rot="Tempo até sair">' + (t && t.partes ? bloco('<span class="av-num">' + dias(t.mediana) + '</span><span class="av-nome-s">' +
      (t.partes === 1 ? "mediana de 1 parte" : "mediana de todas as " + AV.int(t.partes) + " partes") + "</span>") : nada) + "</td>";
    if (M.temAc) {
      var AC = []; linhas.forEach(function (L) { AC = AC.concat(L.ac); });
      var r = AC.length ? resumoAcertos(AC, true) : null;
      h += '<td class="av-fornecedores-col" data-rot="Acertos informados no Painel, ainda sem nota">' + (r ? bloco('<span class="av-num">' + r.acertos + '</span><span class="av-nome-s">' + r.produtos + "</span>") : nada) + "</td>";
    }
    return h + "</tr>";
  }

  function tabelaPrincipal(d, M) {
    var q = normal(busca).trim(), filtrado = !!q;
    var linhas = M.lista.filter(function (L) { return !q || normal(L.nome).indexOf(q) >= 0 || String(L.id) === q; });
    if (M.sem && (!q || normal("sem fornecedor comprovado nota de baixa").indexOf(q) >= 0)) linhas = linhas.concat([M.sem]);
    var un2 = ["fornecedor com algum valor nas colunas", "fornecedores com algum valor nas colunas"];
    var cont = '<p class="av-fornecedores-conta">' + (filtrado ? AV.int(linhas.length - (linhas.indexOf(M.sem) >= 0 ? 1 : 0)) + " de " : "") + plural(M.lista.length, un2) +
      (M.sem && linhas.indexOf(M.sem) >= 0 ? " · e a linha “Sem fornecedor comprovado”, no fim" : "") + "</p>";
    return cont + AV.tabela(colunas(M), linhas, {
      classe: "av-fornecedores-t av-fornecedores-tab", vazio: "Nenhum fornecedor com esse nome.",
      linha: function (L) { return 'data-av-abre="' + L.k + '"' + (L.k === SEM ? ' class="av-fornecedores-sem"' : ""); },
      rodape: linhas.length ? rodape(linhas, M, filtrado) : ""
    });
  }
  function ligarTabela(box, d, M) {
    box.querySelectorAll("tr[data-av-abre]").forEach(function (tr) {
      tr.addEventListener("click", function () { var k = tr.getAttribute("data-av-abre"); abrirFornecedor(d, M, k); });
    });
  }

  // ---------- fora das colunas: o declarado nas saídas SEM nota (exportação). Sem fornecedor; pelo custo da entrada. ----------
  // O valor e as formas vêm da medida "declarado_sem_nota"; a divisão custo da data × custo estimado vem das mesmas saídas
  // (declaradas, sem nota) e só aparece se o total delas conferir com a medida.
  function caixaSemNota(d) {
    var v = 0, q = 0, fx = {};
    d.fornecedores.forEach(function (r) {
      if (r.medida !== "declarado_sem_nota" || !AV.noPeriodo(r.mes)) return;
      v += AV.n(r.valor); q += AV.n(r.quantidade);
      var nm = nomeForma(r.detalhe); fx[nm] = (fx[nm] || 0) + AV.n(r.quantidade);
    });
    var est = 0, tot = 0, semc = 0;
    d.saidas.forEach(function (s) {
      if (s.nivel !== "declarado" || !s.sem_nota || !AV.noPeriodo(s.mes)) return;
      est += AV.n(s.valor_estimado); tot += AV.n(s.valor_data) + AV.n(s.valor_estimado); semc += AV.n(s.com_parte_sem_custo);
    });
    var confere = Math.abs(tot - v) < 0.01;
    var h = '<div class="av-fora av-fornecedores-fora" data-av-bloco="declarado-sem-nota"><span class="av-rot">fora das colunas · não se soma com elas</span>' +
      "<h3>Declarado nas saídas sem nota (exportação), sem fornecedor</h3>";
    if (!q) return h + '<p class="av-sub">Nenhuma saída sem nota com forma de acerto declarada no período.</p></div>';
    var vf = AV.valorFonte(confere ? v - est : v, confere ? est : 0, confere ? semc : 0, { unidade: semc === 1 ? "saída com parte" : "saídas com parte", sempre: true });
    var formas = Object.keys(fx).sort(porNome).map(function (f) { return maiuscula1(f) + ": " + plural(fx[f], ["saída", "saídas"]); });
    h += '<p class="av-fornecedores-fora-v">' + vf.html + '<span class="av-fornecedores-fora-b">pelo custo da entrada · ' + plural(q, ["saída", "saídas"]) +
      " da troca no período, pela data da saída</span></p>" + vf.comp +
      '<p class="av-fornecedores-fora-f">Forma escrita no VR para a saída: ' + AV.esc(formas.join(" · ")) + ".</p>" +
      '<p class="av-k-nota">Sem nota, o VR não diz o fornecedor. E o valor é o custo da entrada da mercadoria que saiu, não o valor de uma nota: ' +
      "por isso fica fora das colunas e do total delas.</p>" +
      (confere ? "" : '<p class="av-k-nota">A divisão entre custo da data e custo estimado não conferiu com as saídas; o total acima é o da medida, sem a divisão.</p>') + "</div>";
    return h;
  }

  // acertos informados no Painel ainda sem nota: a linha dos que não têm fornecedor informado, ou "nenhum"
  function notaAcertos(M) {
    if (!M.temAc && !M.semForn.length) return '<p class="av-k-nota">Acertos informados no Painel e ainda sem nota: nenhum hoje.</p>';
    if (!M.semForn.length) return "";
    var r = resumoAcertos(M.semForn, false);
    return '<p class="av-k-nota av-fornecedores-acnota"><b>Acertos informados no Painel sem fornecedor informado, ainda sem nota:</b> ' + r.acertos + " · " + r.produtos + ": " +
      AV.esc(M.semForn.map(function (a) { return nomeP(a.id_produto) + " (" + un(a.sem_vinculo) + " ainda sem nota)"; }).join("; ")) +
      ". Situação de hoje: o período não se aplica. Sem fornecedor informado, não entram em nenhuma linha da tabela.</p>";
  }

  // ---------- o detalhe de um fornecedor (gaveta): cada coluna separada; o relacionado NUNCA entra aqui ----------
  function abrirFornecedor(d, M, k) {
    var L = k === SEM ? M.sem : M.lista.filter(function (x) { return x.k === k; })[0];
    if (!L) return;
    var sem = k === SEM, id = L.id, per = AV.esc(AV.textoFiltro(["periodo"]));
    var corpo = AV.gaveta(AV.esc(L.nome), sem ? "Acertos de nota de baixa por perda. Ela não é devolução ao fornecedor, então o VR não diz com quem foi o acerto."
      : "Código " + id + " no VR · cada coluna separada, nunca somada com as outras.", "");
    // 1. mês a mês: todo o histórico, os meses do período marcados; só as colunas que têm algo (o declarado sem nota fica fora)
    var R = d.fornecedores.filter(function (r) { return chave(r.fornecedor) === k && r.medida !== "titulo_aberto" && r.medida !== "declarado_sem_nota"; });
    var meses = {};
    R.forEach(function (r) { var m = meses[r.mes] || (meses[r.mes] = { mes: r.mes, m: {} }), x = m.m[r.medida] || (m.m[r.medida] = { v: 0, q: 0 }); x.v += AV.n(r.valor); x.q += AV.n(r.quantidade); });
    var ML = Object.keys(meses).sort().reverse().map(function (m) { return meses[m]; });
    var CM = COLS.filter(function (c) { return c.m !== "titulo_aberto" && R.some(function (r) { return r.medida === c.m; }); });
    var celM = function (x, c) { return x ? bloco(AV.rs(x.v) + '<span class="av-nome-s">' + plural(x.q, c.un) + "</span>") : nada; };
    var totM = '<tr><td class="l av-cel-principal" data-rot=""><span class="av-nome">Total de cada coluna — não se somam entre si</span><span class="av-nome-s">todo o histórico</span></td>' +
      CM.map(function (c) { var t = { v: 0, q: 0 }; ML.forEach(function (m) { var x = m.m[c.m]; if (x) { t.v += x.v; t.q += x.q; } }); return '<td data-rot="' + AV.esc(c.t) + '">' + celM(t, c) + "</td>"; }).join("") + "</tr>";
    var h = '<div class="av-card"><h3>Mês a mês</h3><p class="av-sub">Todo o histórico ' + (sem ? "desta linha" : "deste fornecedor") + ", cada coluna pela sua própria data e com a sua base de valor. Os meses do período escolhido estão marcados: " + per + ".</p>" +
      AV.tabela([{ t: "Mês", rot: "Mês", cls: "l", cel: "principal", v: function (m) { return AV.esc(maiuscula1(AV.mesNome(m.mes))) + (AV.noPeriodo(m.mes) ? " " + AV.chip("no período", "av-fornecedores-chip-per") : ""); } }]
        .concat(CM.map(function (c) { return { t: c.t + baseTh(c.valor), rot: c.t + " (" + c.valor + ")", v: function (m) { return celM(m.m[c.m], c); } }; })),
        ML, { classe: "av-fornecedores-t av-fornecedores-meses", vazio: "Nada no histórico.", rodape: ML.length > 1 ? totM : "", linha: function (m) { return AV.noPeriodo(m.mes) ? 'class="av-fornecedores-noper"' : ""; } }) + "</div>";
    // 2. títulos em aberto no VR, hoje (da fila B), com o aviso aprovado quando outra fonte indica acerto
    if (!sem) h += cartaoTitulos(d, id);
    // 3. acertos no período: declarados por forma (com o nível) e, separado, o comprovado. Não se somam.
    var FL = Object.keys(L.formas).map(function (f) { return { f: f, v: L.formas[f].v, q: L.formas[f].q }; })
      .sort(function (a, b) { return porNome(nomeForma(a.f), nomeForma(b.f)); });
    var comp = L.m.comprovado;
    h += '<div class="av-card"><h3>Declarado nas notas e comprovado nos documentos, no período</h3><p class="av-sub">Pelo valor da nota e pela data da nota, no período escolhido: ' + per + ". Declarado e comprovado são colunas separadas e não se somam.</p>" +
      AV.tabela([
        { t: "Forma informada", rot: "Forma", cls: "l", cel: "principal", v: function (x) { return '<span class="av-nome">' + AV.esc(maiuscula1(nomeForma(x.f))) + "</span>"; } },
        { t: "Nível", cls: "l", v: function () { return AV.nivel("declarado"); } },
        { t: "Notas", v: function (x) { return AV.int(x.q); } },
        { t: "Valor declarado", rot: "Valor declarado (pelo valor da nota)", v: function (x) { return AV.rs(x.v); } }
      ], FL, { classe: "av-fornecedores-t", vazio: "Nenhum acerto declarado no período." }) +
      '<div class="av-fornecedores-comp">' + AV.nivel("comprovado") + ' <span class="av-nome-s" style="display:inline">nos documentos, pelo valor da nota</span> ' + (comp && comp.q ? "<b>" + AV.rs(comp.v) + "</b> em " + plural(comp.q, ["nota", "notas"]) + ", pelo valor e pela data da nota" : "nenhum valor comprovado no período") + "</div>" +
      '<p class="av-k-nota">' + FRASE_COMP + "</p></div>";
    // 4. acertos informados no Painel, ainda sem nota, com este fornecedor informado (situação de hoje)
    if (!sem && L.ac.length) h += cartaoAcertos(L.ac);
    // 5. verbas de avaria deste fornecedor (todas as desta prévia; as do período marcadas)
    if (!sem) {
      var V = d.verbas.filter(function (v) { return v.fornecedor === id && (+v.tipo_id === 8 || +v.tipo_id === 11); }).sort(function (a, b) { return String(b.data).localeCompare(String(a.data)); });
      h += '<div class="av-card"><h3>Verbas de avaria</h3>' + AV.aviso("fixo", "As verbas não se ligam a uma avaria específica.") +
        AV.tabela([
          { t: "Data", rot: "Data", cls: "l", cel: "principal", v: function (v) { return AV.data(v.data) + (AV.noPeriodo(String(v.data).slice(0, 7)) ? " " + AV.chip("no período", "av-fornecedores-chip-per") : ""); } },
          { t: "Tipo", cls: "l", v: function (v) { return AV.esc(doVR(v.tipo)); } },
          { t: "Situação no VR", cls: "l", v: function (v) { return AV.esc(doVR(v.situacao || "—")); } },
          { t: "Valor", rot: "Valor da verba", v: function (v) { return AV.rs(v.valor); } }
        ], V, { classe: "av-fornecedores-t", vazio: "Nenhuma verba de avaria deste fornecedor nesta prévia." }) +
        '<p class="av-k-nota">Na prévia só existem as verbas de avaria que citam uma nota nossa; a lista completa entra quando o robô copiar todas.</p></div>';
    }
    corpo.innerHTML = h;
    corpo.querySelectorAll("[data-av-nota]").forEach(function (b) {
      b.addEventListener("click", function () { if (typeof AV.abrirNota === "function") AV.abrirNota(+b.getAttribute("data-av-nota"), { origem: "fornecedores" }); });
    });
    corpo.querySelectorAll("[data-av-prod]").forEach(function (b) {
      b.addEventListener("click", function () { if (typeof AV.abrirProduto === "function") AV.abrirProduto(+b.getAttribute("data-av-prod"), { origem: "fornecedores" }); });
    });
    preencherProvas(d, corpo);
  }

  // títulos em aberto no VR de um fornecedor. O aviso aprovado ("outra evidência") e o documento em conferência ficam
  // à vista na própria linha; o título continua "Em aberto no VR" — nada aqui o transforma em resolvido.
  function cartaoTitulos(d, id) {
    var B = d.filaB.filter(function (b) { return b.fornecedor === id; })
      .sort(function (a, b) { return String(a.vencimento || "9999").localeCompare(String(b.vencimento || "9999")) || a.titulo_id - b.titulo_id; });
    var abreNota = typeof AV.abrirNota === "function", nAv = B.filter(function (b) { return b.outra_evidencia; }).length;
    return '<div class="av-card"><h3>Títulos em aberto no VR, hoje</h3><p class="av-sub">' + (B.length ? plural(B.length, ["título", "títulos"]) + " · <b>" + AV.rs(AV.soma(B, function (b) { return b.valor; })) + "</b> pelo valor do título. " : "") +
      "Todos os abertos hoje, de qualquer data: o período não se aplica. Aberto no VR não prova dívida." + (B.length && abreNota ? " Clique na nota para ver o detalhe dela." : "") + "</p>" +
      (nAv ? AV.aviso("am", plural(nAv, ["título continua", "títulos continuam"]) + " em aberto no VR, mas outra fonte do VR indica acerto: requer conferência. O título não muda por isso.") : "") +
      AV.tabela([
        { t: "Nota", rot: "Nota", cls: "l", cel: "principal", v: function (b) {
          var n = "NF " + AV.esc(b.nota);
          var h = abreNota ? '<button type="button" class="av-lk" data-av-nota="' + b.nota_id + '">' + n + "</button>" : '<span class="av-nome">' + n + "</span>";
          if (b.outra_evidencia) h += '<span class="av-fornecedores-evid">' + AV.nivel("em_aberto_vr") + " <b>" + TXT_AVISO + "</b>" +
            '<span class="av-nome-s" data-av-prova="' + b.nota_id + '">origem: ' + AV.esc(origensEvid(b)) + (b.aviso_outra_fonte ? " · " + AV.esc(textoAviso(d, b.aviso_outra_fonte)) : "") + "</span></span>";
          return h;
        } },
        { t: "Emissão", v: function (b) { return AV.dataCurta(b.emissao); } },
        { t: "Vencimento", v: function (b) { return b.vencimento ? AV.dataCurta(b.vencimento) : "sem vencimento"; } },
        { t: "Dias vencido", v: function (b) { return AV.n(b.dias_vencido) > 0 ? bloco(dias(b.dias_vencido) + '<span class="av-nome-s">faixa ' + AV.esc(AV.nomeFaixa(b.faixa_vencimento)) + "</span>") : b.vencimento ? "a vencer" : "—"; } },
        { t: "Valor", rot: "Valor do título", v: function (b) { return AV.rs(b.valor); } }
      ], B, { classe: "av-fornecedores-t av-fornecedores-tit", vazio: "Nenhum título em aberto no VR para este fornecedor.",
        linha: function (b) { return b.outra_evidencia ? 'class="av-aviso-lin"' : ""; } }) + "</div>";
  }
  // os documentos que citam a nota (lidos só no clique, pela nota): nome de gente, valor citado × total do documento
  function preencherProvas(d, corpo) {
    corpo.querySelectorAll("[data-av-prova]").forEach(function (el) {
      AV.ler("provas", { nota_id: +el.getAttribute("data-av-prova") }).then(function (P) {
        var L = P.filter(function (p) { return !p.nao_serve; });
        if (L.length) el.innerHTML = L.map(function (p) { return '<span class="av-fornecedores-doc">' + AV.esc(textoProva(d, p)) + "</span>"; }).join("");
      }, function () { el.insertAdjacentHTML("beforeend", '<span class="av-fornecedores-doc">Não deu para ler os documentos desta nota agora.</span>'); });
    });
  }
  // acertos informados no Painel, ainda sem nota, de um fornecedor: um por linha, cada um com o seu produto e a sua quantidade
  function cartaoAcertos(AC) {
    var abreProd = typeof AV.abrirProduto === "function";
    var S = { aberto: "mercadoria ainda na troca", aguardando_vinculo: "o saldo zerou; aguardando ligação a uma saída" };
    var L = AC.slice().sort(function (a, b) { return String(b.criado_em).localeCompare(String(a.criado_em)); });
    return '<div class="av-card"><h3>Acertos informados no Painel, ainda sem nota</h3><p class="av-sub">Situação de hoje: o período não se aplica. ' +
      "O fornecedor é o informado por quem registrou; não é prova. Cada acerto é de um produto, na quantidade dele: quantidades de produtos diferentes não se somam." +
      (abreProd ? " Clique no produto para abrir a ficha." : "") + "</p>" +
      AV.tabela([
        { t: "Produto", cls: "l", cel: "principal", v: function (a) {
          var n = AV.esc(nomeP(a.id_produto));
          return (abreProd ? '<button type="button" class="av-lk" data-av-prod="' + a.id_produto + '">' + n + "</button>" : '<span class="av-nome">' + n + "</span>") +
            '<span class="av-nome-s">' + AV.esc(maiuscula1(S[a.estado] || "")) + (a.ciclo_desfeito ? " · o VR refez as notas e o ciclo do acerto mudou" : "") + "</span>";
        } },
        { t: "Quantidade", rot: "Quantidade do produto", v: function (a) {
          return bloco(un(a.sem_vinculo) + ' ainda sem nota<span class="av-nome-s">informado ' + un(a.quantidade) + (AV.n(a.vinculado) > 0 ? " · ligado a saída " + un(a.vinculado) : "") + "</span>");
        } },
        { t: "Forma", cls: "l", v: function (a) { return AV.esc(maiuscula1(nomeForma(a.forma))); } },
        { t: "Registrado", cls: "l", v: function (a) {
          return bloco(AV.dataHora(a.criado_em) + '<span class="av-nome-s">por ' + AV.esc(a.autor_nome || "—") + " · " +
            (AV.n(a.n_correcoes) ? "corrigido " + plural(a.n_correcoes, ["vez", "vezes"]) + "; vale o registro mais recente" : "sem correção") + " · " +
            (a.conferido ? "conferido" + (a.conferido_em ? " em " + AV.dataHora(a.conferido_em) : "") : "ainda não conferido") + "</span>");
        } }
      ], L, { classe: "av-fornecedores-t av-fornecedores-ac" }) + "</div>";
  }

  // ---------- verbas de avaria (bloco próprio; não se ligam a avaria nenhuma) ----------
  function cartaoVerbas(d) {
    var V = d.verbas.filter(function (v) { return +v.tipo_id === 8 || +v.tipo_id === 11; });
    var P = V.filter(function (v) { return AV.noPeriodo(String(v.data).slice(0, 7)); })
      .sort(function (a, b) { return porNome(nomeDe(d, a.fornecedor), nomeDe(d, b.fornecedor)) || String(a.data).localeCompare(String(b.data)); });
    var ds = V.map(function (v) { return String(v.data); }).sort();
    var h = '<div class="av-card" data-av-bloco="verbas"><h3>Verbas de avaria</h3><p class="av-sub">Verbas de “pagamento de avaria” e de “avaria” lançadas no VR no período, pelo valor e pela data da verba.</p>' +
      AV.aviso("fixo", "As verbas não se ligam a uma avaria específica.");
    h += P.length ? AV.tabela([
      { t: "Fornecedor", cls: "l", cel: "principal", v: function (v) { return '<span class="av-nome">' + AV.esc(nomeDe(d, v.fornecedor)) + "</span>"; } },
      { t: "Tipo", cls: "l", v: function (v) { return AV.esc(doVR(v.tipo)); } },
      { t: "Data", v: function (v) { return AV.dataCurta(v.data); } },
      { t: "Situação no VR", cls: "l", v: function (v) { return AV.esc(doVR(v.situacao || "—")); } },
      { t: "Valor", rot: "Valor da verba", v: function (v) { return AV.rs(v.valor); } }
    ], P, { classe: "av-fornecedores-t av-fornecedores-verbas", rodape: P.length > 1 ? '<tr><td class="l av-cel-principal" data-rot="" colspan="4"><span class="av-nome">Total das verbas do período</span></td><td data-rot="Valor">' + AV.rs(AV.soma(P, function (v) { return v.valor; })) + "</td></tr>" : "" })
      : '<p class="avr-vazio">Nenhuma verba de avaria no período.' + (V.length ? " Nesta prévia há " + plural(V.length, ["verba", "verbas"]) + " no histórico, de " + AV.dataCurta(ds[0]) + " a " + AV.dataCurta(ds[ds.length - 1]) + ": escolha um período maior para vê-las." : "") + "</p>";
    return h + AV.aviso("cz", "<b>Limitação desta prévia:</b> só existem aqui as verbas de avaria que citam uma nota nossa. A lista completa entra quando o robô copiar todas as verbas do VR.") + "</div>";
  }

  // ---------- tempo até sair da troca, por fornecedor comprovado (aqui "parte" é definida, uma vez) ----------
  function cartaoTempo(d, M) {
    var L = M.lista.filter(function (x) { return x.tempo && x.tempo.partes; });
    var h = '<div class="av-card" data-av-bloco="tempo"><h3>Tempo até sair da troca, por fornecedor comprovado</h3><p class="av-sub">Dias entre a entrada por avaria e a saída da troca por nota de devolução a esse fornecedor, para cada parte que saiu no período.</p>' +
      '<p class="av-fornecedores-parte"><b>Parte</b> = cada entrada de mercadoria na troca. Quando a mercadoria sai, a parte mais antiga sai primeiro, porque o VR não rastreia cada unidade: por isso o tempo é uma conta aproximada.</p>';
    h += AV.tabela([
      { t: "Fornecedor", cls: "l", cel: "principal", v: function (x) { return '<span class="av-nome">' + AV.esc(x.nome) + '</span><span class="av-nome-s">código ' + x.id + " no VR</span>"; } },
      { t: "Mediana", v: function (x) { return dias(x.tempo.mediana); } },
      { t: "Partes", v: function (x) { return plural(x.tempo.partes, ["parte", "partes"]); } },
      { t: "Partes por faixa de dias", rot: "Por faixa", cls: "l", v: function (x) {
        return '<span class="av-fornecedores-fx">' + AV.faixas.filter(function (f) { return x.tempo.faixas[f].partes; }).map(function (f) { return "<span>" + AV.nomeFaixa(f) + ": " + AV.int(x.tempo.faixas[f].partes) + "</span>"; }).join(" ") + "</span>";
      } }
    ], L, { classe: "av-fornecedores-t av-fornecedores-tempo", vazio: "Nenhuma parte saiu por nota de devolução no período.",
      rodape: L.length > 1 && M.tempoTodos ? '<tr><td class="l av-cel-principal" data-rot=""><span class="av-nome">Todos os fornecedores comprovados</span></td><td data-rot="Mediana">' + dias(M.tempoTodos.mediana) +
        '</td><td data-rot="Partes">' + plural(M.tempoTodos.partes, ["parte", "partes"]) + '</td><td class="l" data-rot=""></td></tr>' : "" });
    return h + AV.aviso("cz", "O tempo até a baixa do título não aparece: os dados do VR trazidos para esta prévia não têm a data em que cada título foi baixado.") + "</div>";
  }

  // ---------- SEPARADO: fornecedor relacionado (última compra), só para análise ----------
  // Sobre o que está parado na troca AGORA; o período não se aplica. Nunca é fornecedor de acerto, prova nem escolha pronta.
  var AVISO_REL = "Inferência; não indica responsável nem devedor.";
  function agruparRel(d) {
    var G = {};
    d.relacionado.forEach(function (r) {
      var k = chave(r.fornecedor);
      var g = G[k] || (G[k] = { k: k, id: k === SEM ? null : r.fornecedor, nome: k === SEM ? "Sem compra registrada no VR" : nomeDe(d, r.fornecedor),
        vd: 0, ve: 0, prod: {}, semc: {}, varios: {}, partes: 0, ultima: null, linhas: [] });
      g.vd += AV.n(r.valor_data); g.ve += AV.n(r.valor_estimado); g.partes += AV.n(r.partes); g.prod[r.id_produto] = 1;
      if (AV.n(r.qtd_sem_custo) > 0) g.semc[r.id_produto] = 1;
      if (r.varios_fornecedores) g.varios[r.id_produto] = 1;
      if (r.data_compra && (!g.ultima || r.data_compra > g.ultima)) g.ultima = r.data_compra;
      g.linhas.push(r);
    });
    var todos = Object.keys(G).map(function (k) { return G[k]; });
    var total = AV.soma(todos, function (g) { return g.vd + g.ve; });
    var lista = todos.filter(function (g) { return g.k !== SEM; }).sort(function (a, b) { return porNome(a.nome, b.nome) || a.id - b.id; });
    return { lista: lista, sem: G[SEM] || null, total: total, todos: todos };
  }
  function valorParado(g) {
    var vf = AV.valorFonte(g.vd, g.ve, 0, { classe: "av-fornecedores-v" }), n = Object.keys(g.semc).length;
    return bloco(vf.html + vf.comp + (n ? '<span class="av-comp"><span class="av-semc">+ ' + plural(n, ["produto", "produtos"]) + " com parte sem custo conhecido</span></span>" : ""));
  }
  function tabelaRel(d, A) {
    var q = normal(buscaRel).trim();
    var L = A.lista.filter(function (g) { return !q || normal(g.nome).indexOf(q) >= 0 || String(g.id) === q; });
    var cortado = !q && !relTodos && L.length > CORTE_REL, mostrar = cortado ? L.slice(0, CORTE_REL) : L;
    if (A.sem && (!q || normal(A.sem.nome).indexOf(q) >= 0)) mostrar = mostrar.concat([A.sem]);
    var h = AV.tabela([
      { t: "Fornecedor relacionado", rot: "Fornecedor relacionado", cls: "l", cel: "principal", v: function (g) {
        return '<button type="button" class="av-lk av-fornecedores-abre">' + AV.esc(g.nome) + "</button>" +
          (g.k === SEM ? '<span class="av-nome-s">' + AV.pct(A.total ? 100 * (g.vd + g.ve) / A.total : 0) + " do valor parado hoje · nenhuma nota de compra do produto antes da entrada na troca</span>" : '<span class="av-nome-s">código ' + g.id + " no VR</span>");
      } },
      { t: "Valor parado hoje", rot: "Valor parado hoje", v: valorParado },
      { t: "Produtos", v: function (g) { return AV.int(Object.keys(g.prod).length); } },
      { t: "Partes", rot: "Partes (entradas na troca)", dica: FRASE_PARTE, v: function (g) { return AV.int(g.partes); } },
      { t: "Com compras recentes de outros fornecedores", rot: "Com compras de outros fornecedores", v: function (g) { var n = Object.keys(g.varios).length; return n ? plural(n, ["produto", "produtos"]) : nada; } },
      { t: "Última compra", v: function (g) { return g.ultima ? AV.dataCurta(g.ultima) : nada; } }
    ], mostrar, { classe: "av-fornecedores-t av-fornecedores-rel", vazio: "Nenhum fornecedor relacionado com esse nome.",
      linha: function (g) { return 'data-av-rel="' + g.k + '"' + (g.k === SEM ? ' class="av-fornecedores-sem"' : ""); },
      rodape: q ? "" : '<tr><td class="l av-cel-principal" data-rot=""><span class="av-nome">Parado na troca agora, todas as linhas</span><span class="av-nome-s">o mesmo valor, visto pela última compra</span></td><td data-rot="Valor parado hoje">' +
        valorParado({ vd: AV.soma(A.todos, function (g) { return g.vd; }), ve: AV.soma(A.todos, function (g) { return g.ve; }), semc: A.todos.reduce(function (o, g) { Object.keys(g.semc).forEach(function (p) { o[p] = 1; }); return o; }, {}) }) +
        '</td><td data-rot="Produtos">' + AV.int(Object.keys(A.todos.reduce(function (o, g) { Object.keys(g.prod).forEach(function (p) { o[p] = 1; }); return o; }, {})).length) +
        '</td><td data-rot="Partes">' + AV.int(AV.soma(A.todos, function (g) { return g.partes; })) + '</td><td data-rot=""></td><td data-rot=""></td></tr>' });
    if (cortado) h = '<p class="av-fornecedores-conta">Mostrando os ' + CORTE_REL + " primeiros em ordem alfabética, de " + AV.int(L.length) + ". A linha “Sem compra registrada no VR” e o total ficam no fim.</p>" + h +
      '<div class="av-mais"><button type="button" class="av-bt" data-av-rel-todos>Mostrar todos os ' + AV.int(L.length) + " fornecedores relacionados</button></div>";
    return h;
  }
  function abrirRelacionado(d, A, k) {
    var g = k === SEM ? A.sem : A.lista.filter(function (x) { return x.k === k; })[0];
    if (!g) return;
    var abreProd = typeof AV.abrirProduto === "function";
    var P = {};                                          // um produto pode ter partes de mais de uma linha
    g.linhas.forEach(function (r) {
      var p = P[r.id_produto] || (P[r.id_produto] = { id: r.id_produto, setor_id: r.setor_id, vd: 0, ve: 0, qtd: 0, partes: 0, semc: 0, ini: null, fim: null, compra: null, varios: false });
      p.vd += AV.n(r.valor_data); p.ve += AV.n(r.valor_estimado); p.qtd += AV.n(r.qtd); p.partes += AV.n(r.partes); p.semc += AV.n(r.qtd_sem_custo);
      if (!p.ini || r.primeira_entrada < p.ini) p.ini = r.primeira_entrada; if (!p.fim || r.ultima_entrada > p.fim) p.fim = r.ultima_entrada;
      if (r.data_compra && (!p.compra || r.data_compra > p.compra)) p.compra = r.data_compra; if (r.varios_fornecedores) p.varios = true;
    });
    var L = Object.keys(P).map(function (id) { return P[id]; }).sort(function (a, b) { return porNome(nomeP(a.id), nomeP(b.id)); });
    var corpo = AV.gaveta(AV.esc(g.nome), (k === SEM ? "Sem compra registrada no VR" : "Fornecedor relacionado (última compra)") + " · só para análise · o que está parado na troca agora", "");
    var h = '<div class="av-card av-fornecedores-rel-gav">' + AV.aviso("fixo", AVISO_REL) + "<h3>" + plural(L.length, ["produto parado", "produtos parados"]) + " na troca agora</h3><p class=\"av-sub\">" +
      (k === SEM ? "Produtos cujas partes paradas não têm nota de compra antes da entrada na troca." : "Produtos cuja última compra antes da entrada na troca foi deste fornecedor. É uma inferência para análise, não um acerto.") +
      (abreProd ? " Clique no produto para abrir a ficha." : "") + "</p>" +
      AV.tabela([
        { t: "Produto", cls: "l", cel: "principal", v: function (p) {
          var n = AV.esc(nomeP(p.id));
          return (abreProd ? '<button type="button" class="av-lk" data-av-prod="' + p.id + '">' + n + "</button>" : '<span class="av-nome">' + n + "</span>") +
            '<span class="av-nome-s">' + AV.esc(AV.nomeSetor(p.setor_id)) + (p.varios ? " · produto teve compras recentes de outros fornecedores" : "") + "</span>";
        } },
        { t: "Valor parado", v: function (p) { var vf = AV.valorFonte(p.vd, p.ve, 0, { classe: "av-fornecedores-v" }); return bloco(vf.html + vf.comp + (p.semc > 0 ? '<span class="av-comp"><span class="av-semc">+ ' + AV.qtd(p.semc) + " sem custo conhecido</span></span>" : "")); } },
        { t: "Quantidade", v: function (p) { return bloco(AV.qtd(p.qtd) + '<span class="av-nome-s">' + plural(p.partes, ["parte", "partes"]) + "</span>"); } },
        { t: "Entrou na troca", v: function (p) { return p.ini === p.fim ? AV.dataCurta(p.ini) : AV.dataCurta(p.ini) + " a " + AV.dataCurta(p.fim); } },
        { t: "Última compra", v: function (p) { return p.compra ? AV.dataCurta(p.compra) : nada; } }
      ], L, { classe: "av-fornecedores-t", vazio: "Nenhum produto." }) + "</div>";
    corpo.innerHTML = h;
    corpo.querySelectorAll("[data-av-prod]").forEach(function (b) {
      b.addEventListener("click", function () { if (typeof AV.abrirProduto === "function") AV.abrirProduto(+b.getAttribute("data-av-prod"), { origem: "fornecedores" }); });
    });
  }

  function analise(d, A) {
    return '<section class="av-analise av-fornecedores-analise" data-av-bloco="relacionado"><span class="av-rot">só para análise · separado das colunas acima</span><h3>Fornecedor relacionado (última compra): só para análise</h3>' +
      '<p class="av-sub">Para cada parte parada na troca agora, a última compra do produto antes de ele entrar na troca (regra: a última nota de compra antes da entrada). É sobre o que está parado hoje: <b>o período não se aplica a este bloco</b>. ' +
      "Não aparece nas Pendências, não é prova e nunca vira fornecedor de acerto. Valor pelo custo da entrada.</p>" + AV.aviso("fixo", AVISO_REL) +
      '<div class="av-linha-f"><input type="search" class="av-busca av-fornecedores-busca" data-av-busca-rel placeholder="Buscar fornecedor relacionado" aria-label="Buscar fornecedor relacionado pelo nome ou código" value="' + AV.esc(buscaRel) + '"></div>' +
      '<div data-av-rel-tabela>' + tabelaRel(d, A) + "</div></section>";
  }
  function comoLer(M) {
    var h = '<details class="av-fornecedores-ler"><summary>Como ler cada coluna</summary><p class="av-fornecedores-ler-p">' + FRASE_BASE + '</p><dl class="av-dl">';
    COLS.forEach(function (c) { h += "<dt>" + c.t + "</dt><dd>" + c.dica + ' <span class="av-quem">(' + c.valor + " · " + c.data + ")</span></dd>"; });
    h += "<dt>Tempo até sair</dt><dd>Dias entre a entrada por avaria na troca e a saída por nota de devolução a este fornecedor, no período (mediana: metade das partes saiu em até esse número de dias). " + FRASE_PARTE + "</dd>";
    if (M.temAc) h += "<dt>Acertos informados no Painel, ainda sem nota</dt><dd>Acertos registrados no Painel para a mercadoria na troca, com o fornecedor informado por quem registrou, ainda não ligados a uma saída com nota. Conta acertos e produtos; a quantidade de cada produto fica no detalhe. <span class=\"av-quem\">(situação de hoje · o período não se aplica)</span></dd>";
    return h + "<dt>Sem fornecedor comprovado</dt><dd>Acerto declarado ou comprovado de nota de baixa por perda. Ela não é devolução ao fornecedor, então o VR não diz com quem foi o acerto. <span class=\"av-quem\">(pelo valor da nota · pela data da nota)</span></dd>" +
      "<dt>Declarado nas saídas sem nota</dt><dd>Saída da troca por exportação, sem nota, com a forma de acerto escrita no VR. Não tem fornecedor e é medida pelo custo da entrada: fica fora das colunas e do total delas. <span class=\"av-quem\">(pelo custo da entrada · pela data da saída)</span></dd></dl></details>";
  }

  // documentos de antes do primeiro mês dos filtros (o livro da troca começa em 19/10/2023): nenhum período os alcança
  function antesDoLivro(d) {
    var o = {};
    if (AV.periodo(AV.estado.periodo).meses.some(function (m) { return m < AV.PRIMEIRO_MES; })) return "";   // o filtro já alcança
    d.fornecedores.forEach(function (r) { if (r.medida === "titulo_aberto" || r.medida === "declarado_sem_nota" || r.mes >= AV.PRIMEIRO_MES) return; var x = o[r.medida] || (o[r.medida] = { v: 0, q: 0 }); x.v += AV.n(r.valor); x.q += AV.n(r.quantidade); });
    var partes = COLS.filter(function (c) { return o[c.m]; }).map(function (c) { return c.t.charAt(0).toLowerCase() + c.t.slice(1) + " " + AV.rs(o[c.m].v) + " (" + plural(o[c.m].q, c.un) + ")"; });
    return partes.length ? '<p class="av-k-nota">Antes de outubro/2023 (quando o livro da troca começa) há documentos: ' + partes.join(" · ") +
      ". Só o filtro “2023” os alcança; eles aparecem também no mês a mês de cada fornecedor.</p>" : "";
  }

  // ---------- montagem da área ----------
  function desenhar(el, d) {
    var p = AV.periodo(AV.estado.periodo), M = montar(d), A = agruparRel(d);
    var h = '<p class="av-nsoma">Mostrando: <b>' + AV.esc(AV.textoFiltro(["periodo"])) + "</b>" + (p.parcial ? " · período com mês parcial" : "") +
      " · os títulos em aberto, os acertos informados no Painel e o fornecedor relacionado mostram a situação de hoje</p>";
    h += '<div class="av-card" data-av-bloco="fornecedores"><h3>Notas, títulos, acertos e verbas por fornecedor</h3>' +
      '<p class="av-sub">Cada coluna mede uma coisa, com a sua base de valor e de data escritas no cabeçalho, e as colunas nunca se somam entre si. A ordem é alfabética: não há classificação nem pontuação. ' +
      "Clique num fornecedor para ver o mês a mês, os títulos em aberto, as formas de acerto e as verbas dele.</p>" + AV.aviso("fixo", FRASE_COMP) +
      '<p class="av-fornecedores-basefrase">' + FRASE_BASE + "</p>" +
      '<div class="av-linha-f"><input type="search" class="av-busca av-fornecedores-busca" data-av-busca placeholder="Buscar fornecedor pelo nome ou código" aria-label="Buscar fornecedor pelo nome ou código" value="' + AV.esc(busca) + '"></div>' +
      '<div data-av-forn-tabela>' + tabelaPrincipal(d, M) + "</div>" + notaAcertos(M) + caixaSemNota(d) + antesDoLivro(d) + comoLer(M) + "</div>";
    h += '<div class="av-fornecedores-g2">' + cartaoVerbas(d) + cartaoTempo(d, M) + "</div>";
    h += analise(d, A);
    el.innerHTML = h;
    var boxF = el.querySelector("[data-av-forn-tabela]"), boxR = el.querySelector("[data-av-rel-tabela]");
    ligarTabela(boxF, d, M);
    el.querySelector("[data-av-busca]").addEventListener("input", function (e) { busca = e.target.value; boxF.innerHTML = tabelaPrincipal(d, M); ligarTabela(boxF, d, M); });
    var ligarRel = function () {
      boxR.querySelectorAll("tr[data-av-rel]").forEach(function (tr) { tr.addEventListener("click", function () { abrirRelacionado(d, A, tr.getAttribute("data-av-rel")); }); });
      var bt = boxR.querySelector("[data-av-rel-todos]");
      if (bt) bt.addEventListener("click", function () { relTodos = true; boxR.innerHTML = tabelaRel(d, A); ligarRel(); });
    };
    ligarRel();
    el.querySelector("[data-av-busca-rel]").addEventListener("input", function (e) { buscaRel = e.target.value; boxR.innerHTML = tabelaRel(d, A); ligarRel(); });
  }
  // para as fotos e os testes da prévia: abrir o detalhe sem clicar (só leitura)
  AV.fornecedoresAbrir = function (id, relacionado) {
    return AV.lerVarias(LEITURAS).then(function (d) { if (relacionado) abrirRelacionado(d, agruparRel(d), chave(id)); else abrirFornecedor(d, montar(d), chave(id)); });
  };
})();
