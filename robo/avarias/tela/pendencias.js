/* ==AV-PENDENCIAS== AVARIAS · Pendências: três filas que NUNCA se somam (A mercadoria na troca, pelo custo da entrada;
   B títulos de devolução em aberto no VR, pelo valor do título; C saídas aguardando comprovação, pelo valor da nota),
   a caixa do saldo negativo (fora de todo total) e o DETALHE DA NOTA (AV.abrirNota, usado também em Fornecedores).
   SOMENTE LEITURA: aqui só se lê por AV.ler/AV.lerVarias. Não existe botão nem função de gravar.
   Em Pendências só aparece fornecedor COMPROVADO (decisão 7); o relacionado nunca é lido aqui. */
(function () {
  "use strict";
  var AV = window.AV;
  var LEITURAS = ["filaA", "filaB", "filaC", "acertos", "vinculos", "vinculosFeitos", "negativo", "documentos"];
  var PASSO = 50;
  // escolhas locais de cada fila (ficam enquanto a pessoa navega; o setor é o filtro comum)
  var loc = { A: { faixa: "", busca: "", ver: PASSO }, B: { evid: "", faixa: "", busca: "", ver: PASSO },
    C: { nivel: "", conf: false, ver: PASSO }, negAberto: false };

  // ---------- nomes curtos ----------
  var TIPO_CURTO = { 33: "devolução troca", 2: "devolução com financeiro", 41: "devolução sem financeiro", 29: "nota de baixa por perda",
    31: "baixa por perda ou quebra", 30: "outras saídas · troca", 32: "outras saídas", 36: "retorno de devolução" };
  function tipoCurto(id, tipo) { return TIPO_CURTO[id] || (tipo ? String(tipo).toLowerCase().replace(/\s*\(.*\)\s*$/, "") : "tipo " + id); }
  var FORMAS = { troca: "troca por mercadoria", troca_mercadoria: "troca por mercadoria", bonificacao: "bonificação", desconto_boleto: "desconto no boleto",
    boleto: "desconto no boleto", pix: "Pix ou depósito", pix_deposito: "Pix ou depósito", deposito: "Pix ou depósito", dinheiro: "dinheiro", verba: "verba", outro: "outro" };
  function nomeForma(f) { return f ? (FORMAS[f] || String(f).replace(/_/g, " ")) : "não informada"; }
  // destinatário: só o fornecedor COMPROVADO (destinatário da devolução, fora a própria empresa) tem nome de fornecedor.
  // Nota que NÃO é devolução emitida no VR para alguém de fora (destinatario_vr) nunca vale como fornecedor comprovado:
  // no detalhe o nome aparece com a ressalva; nas listas das Pendências, sem o nome. Sem essa informação (listas),
  // a nota de baixa diz só "sem fornecedor", porque pode ter sido emitida para outro destinatário.
  var LOJA = { 1: 1, 2: 1 }, DEVOLUCAO = { 33: 1, 2: 1, 41: 1 };
  function destinatarioTexto(n, opc) {
    opc = opc || {};
    if (n.fornecedor_comprovado) return n.fornecedor_nome || "fornecedor " + n.fornecedor_comprovado;
    var baixa = +n.tipo_id === 29 || +n.tipo_id === 31, sabe = n.destinatario_vr !== undefined;
    if (n.destinatario_vr !== null && n.destinatario_vr !== undefined)
      return opc.comNome ? "emitida no VR para " + (n.destinatario_vr_nome || "o código " + n.destinatario_vr) + " — não vale como fornecedor comprovado"
        : "sem fornecedor comprovado (emitida no VR para outro destinatário)";
    if (baixa) return sabe ? "a própria loja (nota de baixa)" : "sem fornecedor (nota de baixa)";
    if (+n.tipo_id === 30) return sabe ? "a própria loja (outras saídas)" : "sem fornecedor comprovado (outras saídas)";
    return "sem fornecedor comprovado";
  }
  function destinatario(n, opc) { return AV.esc(destinatarioTexto(n, opc)); }
  // a mesma regra para a saída de um par acerto × saída (lá vêm o tipo e o código do destinatário da nota)
  function destinatarioSaida(v, nomes) {
    if (!v.nota_id) return "sem nota";
    var f = v.fornecedor_nota, tem = f !== null && f !== undefined, fora = tem && !LOJA[f];
    return destinatarioTexto({ tipo_id: v.tipo_id, fornecedor_comprovado: DEVOLUCAO[v.tipo_id] && fora ? f : null,
      fornecedor_nome: (nomes || {})[f], destinatario_vr: !DEVOLUCAO[v.tipo_id] && fora ? f : null });
  }
  // listas do banco (conflitos, condições): vêm como vetor; nulo vira vazio
  function lista(v) { return Array.isArray(v) ? v.filter(function (x) { return x; }) : v ? [String(v)] : []; }
  function plural(n, um, varios) { return AV.int(n) + " " + (AV.n(n) === 1 ? um : varios); }
  function palavra(n, um, varios) { return AV.n(n) === 1 ? um : varios; }

  // ---------- nunca mostrar código interno da cópia: documento pelo nome de gente, sem letras de caso ----------
  var docsIdx = {};
  function guardarDocs(L) { (L || []).forEach(function (x) { docsIdx[x.ref] = x; }); }
  function nomeDoc(ref) {
    var x = docsIdx[ref]; if (x) return AV.nomeDocumento(x);
    return /^PP#/.test(ref) ? "parcela de boleto do VR" : /^VB#/.test(ref) ? "verba do VR" : "documento do VR";
  }
  // a nota só é "comprovada" com valor comprovado e sem conferência pendente (senão o texto do banco diria mais do que prova)
  function comprovada(n) { return !!n && AV.n(n.valor_comprovado) > 0.004 && !n.em_conferencia; }
  // texto puro → texto puro (escape ao usar). n = a nota (quando houver), para não chamar de comprovada o que não é.
  function semCodigo(t, n) {
    var s = String(t === null || t === undefined ? "" : t);
    s = s.replace(/\b(NE|PP|VB)#\d+/g, nomeDoc);
    s = s.replace(/só texto, sem valor estruturado/g, "o desconto aparece só no texto, sem valor lançado na parcela");
    s = s.replace(/\s*\(caso [ABC]\)/g, "").replace(/boleto [ABC] indica acerto/g, "um desconto no boleto indica acerto").replace(/\bcaso [ABC]:?\s*/g, "");
    if (n && !comprovada(n)) s = s.replace(/também comprovada no boleto/g, "o boleto também cita esta nota")
      .replace(/comprovada no boleto/g, "o boleto também cita esta nota" + (n.em_conferencia ? " (em conferência)" : ""));
    return s;
  }
  // situação de cada acerto: conferência (volta a "aguardando" quando é corrigido) e quantas correções teve
  function situacaoAcerto(a) {
    if (!a) return "";
    if (a.anulado) return '<span class="av-pend-sit">anulado</span>';
    var c = a.conferido ? "conferido em " + AV.dataHora(a.conferido_em) : '<b class="av-pend-aguarda">aguardando conferência</b>';
    return '<span class="av-pend-sit">' + c + (AV.n(a.n_correcoes) > 0 ? " · " + plural(a.n_correcoes, "correção", "correções") : " · sem correção") + "</span>";
  }
  function quemRegistrou(a) { return a && a.autor_nome ? "registrado por <b>" + AV.esc(a.autor_nome) + "</b>, em " + AV.dataHora(a.criado_em) : "registrado em " + AV.dataHora(a && a.criado_em); }
  function faixaIdx(f) { var i = AV.faixas.indexOf(f); return i < 0 ? -1 : i; }
  function nomeFaixaVenc(f) { return f === "sem vencimento" ? "sem vencimento" : AV.nomeFaixa(f); }
  function norm(s) { return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); }
  function linhaClicavel(chave, dica) { return 'data-av-abre="' + AV.esc(chave) + '" tabindex="0" title="' + AV.esc(dica) + '"'; }
  // clique e Enter/Espaço numa linha da tabela
  function ligarLinhas(el, fn) {
    el.querySelectorAll("tr[data-av-abre]").forEach(function (tr) {
      var abre = function () { fn(tr.getAttribute("data-av-abre")); };
      tr.addEventListener("click", function (e) { if (e.target.closest && e.target.closest("button,a,select,input")) return; abre(); });
      tr.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); abre(); } });
    });
  }
  // a tabela comum, com o conteúdo de cada célula num bloco só (no celular a célula vira "rótulo · conteúdo")
  function tabela(cols, linhas, opc) {
    return AV.tabela(cols.map(function (c) { var o = {}, k; for (k in c) o[k] = c[k]; o.v = function (l, i) { return '<span class="av-pend-c">' + c.v(l, i) + "</span>"; }; return o; }), linhas, opc);
  }
  function abrirProduto(id) { if (AV.abrirProduto) AV.abrirProduto(+id, { origem: "pendencias" }); }

  // ---------- entrada da área ----------
  AV.areas.pendencias = function (el) {
    AV.carregando(el);
    AV.lerVarias(LEITURAS).then(function (d) {
      guardarDocs(d.documentos);
      // nomes de fornecedor só quando há acerto ou vínculo para mostrar (nos dados reais, ainda não há nenhum)
      if (!d.acertos.length && !d.vinculos.length && !d.vinculosFeitos.length) return desenhar(el, d);
      return AV.ler("nomesForn").then(function (L) { d.nomes = {}; L.forEach(function (f) { d.nomes[f.fornecedor] = f.nome; }); desenhar(el, d); });
    }).catch(function (e) { AV.falhou(el, e); });
  };

  // pares acerto × saída ainda sem vínculo (as condições falham, ou o acerto tem mais de uma saída possível)
  function paresPendentes(d) { return d.vinculos.filter(function (v) { return lista(v.condicoes_que_falham).length || AV.n(v.saidas_aptas_do_acerto) !== 1; }); }
  // acerto de ciclo AINDA ABERTO (fila A) × de ciclo encerrado ou desfeito (vai para "Acertos aguardando vínculo", na fila C)
  function cicloAberto(d, acerto_id) { var a = null; d.acertos.forEach(function (x) { if (x.acerto_id === acerto_id) a = x; }); return !!(a && a.ciclo_aberto && a.estado !== "aguardando_vinculo"); }

  function desenhar(el, d) {
    // o Resumo pode pedir: A, B, C, "negativo" (caixa do saldo negativo), "vinculos" (topo da A), "aguardando" (seção da C)
    var pedida = AV.estado.fila, fila = pedida === "B" || pedida === "C" || pedida === "aguardando" ? (pedida === "B" ? "B" : "C") : "A";
    var rolar = pedida === "negativo" ? "#avPNeg" : pedida === "vinculos" ? "[data-av-bloco=vinculos]" : pedida === "aguardando" ? "[data-av-bloco=aguardando]" : "";
    if (pedida === "negativo") loc.negAberto = true;
    if (rolar) AV.estado.fila = fila;
    var A = d.filaA.filter(function (r) { return AV.noSetor(r.setor_id); });
    var vA = AV.soma(A, function (r) { return r.valor; }), vB = AV.soma(d.filaB, function (r) { return r.valor; }), vC = AV.soma(d.filaC, function (r) { return r.valor; });
    var bt = function (id, med, tit, num) {
      return '<button type="button" class="av-fila-bt' + (id === fila ? " av-on" : "") + '" data-av-fila="' + id + '" aria-pressed="' + (id === fila) + '">' +
        '<span class="av-fila-l">' + med + '</span><span class="av-fila-t">' + tit + '</span><span class="av-fila-n">' + num + "</span></button>";
    };
    var h = '<div class="av-filas" role="group" aria-label="Filas de pendências">' +
      bt("A", "mercadoria · custo da entrada", "A · Na troca", plural(A.length, "produto", "produtos") + " · " + AV.rs(vA) + (AV.estado.setor ? " · " + AV.esc(AV.nomeSetor(AV.estado.setor)) : "")) +
      bt("B", "título no VR · valor do título", "B · Títulos em aberto no VR", plural(d.filaB.length, "título", "títulos") + " · " + AV.rs(vB)) +
      bt("C", "acerto a comprovar · valor da nota", "C · Saídas aguardando comprovação", plural(d.filaC.length, "nota", "notas") + " · " + AV.rs(vC)) + "</div>";
    h += '<p class="av-nsoma av-pend-nsoma">As três filas medem coisas diferentes — mercadoria física pelo custo da entrada, título no VR pelo valor do título, acerto a comprovar pelo valor da nota — e <b>nunca se somam</b>.</p>';
    h += '<div id="avPFila" data-av-fila-aberta="' + fila + '"></div>' + caixaNegativo(d);
    el.innerHTML = h;
    el.querySelectorAll("[data-av-fila]").forEach(function (b) {
      b.addEventListener("click", function () { AV.estado.fila = b.getAttribute("data-av-fila"); desenhar(el, d); });
    });
    var box = el.querySelector("#avPFila");
    if (fila === "A") filaA(box, d, A); else if (fila === "B") filaB(box, d); else filaC(box, d);
    ligarNegativo(el, d);
    if (rolar) { var n = el.querySelector(rolar); if (n && n.scrollIntoView) setTimeout(function () { n.scrollIntoView({ block: "start" }); }, 30); }
  }

  // ---------- FILA A · mercadoria ainda na troca (custo da data da entrada; estimado e sem custo à vista) ----------
  function filaA(box, d, A) {
    var s = loc.A;
    var h = '<div class="av-card" data-av-bloco="fila-a"><h3>A · Mercadoria ainda na troca</h3>' +
      '<p class="av-sub">Produto com saldo positivo na troca do VR, pelo custo da data em que cada parte entrou (cada entrada na troca é uma parte; a mais antiga sai primeiro). ' +
      "A idade vai em faixas, pela parte mais antiga que ainda está lá. Sai desta fila só quando o saldo do VR cai: nada registrado no Painel tira mercadoria da troca.</p>";
    h += vinculosPendentes(d);
    h += '<div class="av-linha-f"><label>Parte mais antiga <select data-av-p="faixa"><option value="">Todas as faixas</option>' +
      AV.faixas.map(function (f) { return '<option value="' + f + '"' + (s.faixa === f ? " selected" : "") + ">" + AV.nomeFaixa(f) + "</option>"; }).join("") + "</select></label>" +
      '<input type="search" class="av-busca" data-av-p="busca" placeholder="Buscar produto pelo nome" aria-label="Buscar produto pelo nome" value="' + AV.esc(s.busca) + '"></div>' +
      '<div data-av-p="lista"></div></div>';
    box.innerHTML = h;
    var lst = box.querySelector("[data-av-p=lista]");
    var redesenha = function () { listaA(lst, A, d); };
    box.querySelector("[data-av-p=faixa]").addEventListener("change", function (e) { s.faixa = e.target.value; s.ver = PASSO; redesenha(); });
    box.querySelector("[data-av-p=busca]").addEventListener("input", function (e) { s.busca = e.target.value; s.ver = PASSO; redesenha(); });
    box.querySelectorAll("[data-av-nota]").forEach(function (b) { b.addEventListener("click", function () { AV.abrirNota(+b.getAttribute("data-av-nota"), { origem: "pendencias" }); }); });
    box.querySelectorAll("[data-av-prod]").forEach(function (b) { b.addEventListener("click", function () { abrirProduto(b.getAttribute("data-av-prod")); }); });
    redesenha();
  }

  function botaoMais(total, vistos) {
    var resto = total - vistos;
    return resto > 0 ? '<div class="av-mais"><button type="button" class="av-bt" data-av-p="mais">Mostrar mais ' + AV.int(Math.min(PASSO, resto)) +
      " (" + (resto === 1 ? "resta 1" : "restam " + AV.int(resto)) + ")</button></div>" : "";
  }
  function listaA(lst, A, d) {
    var s = loc.A, q = norm(s.busca).trim();
    // acertos do ciclo aberto de cada produto (quem registrou e a conferência de cada um)
    var acP = {}; d.acertos.forEach(function (a) { if (a.fila === "A" && a.ciclo_aberto && !a.anulado) (acP[a.id_produto] = acP[a.id_produto] || []).push(a); });
    var L = A.filter(function (r) { return (!s.faixa || r.faixa_mais_antiga === s.faixa) && (!q || norm(r.nome).indexOf(q) >= 0 || String(r.id_produto) === q); });
    L.sort(function (a, b) { return faixaIdx(b.faixa_mais_antiga) - faixaIdx(a.faixa_mais_antiga) || AV.n(b.valor) - AV.n(a.valor) || a.id_produto - b.id_produto; });
    var semc = L.filter(function (r) { return AV.n(r.qtd_sem_custo) > 0; }).length;
    var vf = AV.valorFonte(AV.soma(L, function (r) { return r.valor_data; }), AV.soma(L, function (r) { return r.valor_estimado; }), semc,
      { unidade: semc === 1 ? "produto com parte" : "produtos com parte", sempre: true });
    var h = '<div class="av-resumo-f" data-av-resumo="A"><span><b>' + plural(L.length, "produto", "produtos") + "</b></span><span><b>" + AV.rs(vf.total) + "</b> pelo custo da entrada</span>" +
      '<span class="av-pend-comp">' + vf.comp + "</span>" + (s.faixa || q ? '<span class="av-quem">com os filtros desta fila</span>' : "") + "</div>";
    var V = L.slice(0, s.ver);
    h += tabela([
      { t: "Produto", cls: "l", cel: "principal", v: function (r) { return '<span class="av-nome">' + AV.esc(r.nome || "produto " + r.id_produto) + '</span><span class="av-nome-s">' + AV.esc(AV.nomeSetor(r.setor_id)) + " · código " + r.id_produto + "</span>"; } },
      { t: "Quantidade parada", dica: "Saldo do VR na troca, na unidade do produto", v: function (r) { return '<span class="av-num">' + AV.qtd(r.saldo) + '</span><span class="av-nome-s">saldo do VR</span>'; } },
      { t: "Valor", dica: "Custo da data da entrada de cada parte", v: function (r) {
        return '<span class="av-num">' + AV.rs(r.valor) + "</span>" + AV.marcaEst(r.valor_estimado) +
          (AV.n(r.qtd_sem_custo) > 0 ? '<span class="av-nome-s av-semc">+ ' + AV.qtd(r.qtd_sem_custo) + " sem custo conhecido</span>" : ""); } },
      { t: "Parte mais antiga", cls: "l", dica: "Cada entrada na troca é uma parte; a mais antiga sai primeiro", v: function (r) { return AV.nomeFaixa(r.faixa_mais_antiga) + '<span class="av-nome-s">entrou em ' + AV.dataCurta(r.entrada_mais_antiga) + (AV.n(r.partes) > 1 ? " · " + AV.int(r.partes) + " partes na troca" : "") + "</span>"; } },
      { t: "Motivo", cls: "l", dica: "Motivo da parte mais antiga", v: function (r) { return AV.esc(AV.nomeClasse(r.classe_parte_mais_antiga, r.motivo_parte_mais_antiga)); } },
      { t: "Acertos neste ciclo", cls: "l", dica: "Ciclo: o período em que o saldo do produto na troca não voltou a zero", v: function (r) { return acertosDoCiclo(r, acP[r.id_produto] || []); } },
      { t: "Saldo sem zerar desde", cls: "l", dica: "Começo do ciclo: desde esta data o saldo do produto na troca não voltou a zero. A parte mais antiga pode ser mais recente, porque o que entrou antes já saiu.",
        v: function (r) { var c = r.ciclo_desde || r.entrada_mais_antiga;
          return AV.dataCurta(c) + (c && r.entrada_mais_antiga && c < r.entrada_mais_antiga ? '<span class="av-nome-s">o que entrou antes de ' + AV.dataCurta(r.entrada_mais_antiga) + " já saiu</span>" : ""); } }
    ], V, { classe: "av-pend-tab-a", vazio: q || s.faixa ? "Nenhum produto com estes filtros." : "Nenhum produto na troca.",
      linha: function (r) { return linhaClicavel(r.id_produto, "Abrir a ficha do produto"); } });
    h += botaoMais(L.length, V.length);
    lst.innerHTML = h;
    var m = lst.querySelector("[data-av-p=mais]"); if (m) m.addEventListener("click", function () { s.ver += PASSO; listaA(lst, A, d); });
    ligarLinhas(lst, abrirProduto);
  }

  // acerto informado × situação no VR: é situação, por faixa de idade; não é alerta. Cada acerto com quem registrou e a conferência.
  function acertosDoCiclo(r, AC) {
    if (!AV.n(r.acertos_no_ciclo)) return '<span class="av-quem">nenhum acerto informado</span>';
    return plural(r.acertos_no_ciclo, "acerto", "acertos") + '<span class="av-nome-s">informado ' + AV.qtd(r.combinado) + " · saiu " + AV.qtd(r.saiu_no_vr_desde_o_acerto) + " no VR desde o registro" +
      (r.faixa_desde_o_acerto ? " · registro há " + AV.nomeFaixa(r.faixa_desde_o_acerto) : "") + "</span>" +
      AC.map(function (a) { return '<span class="av-nome-s">' + AV.qtd(a.quantidade) + " · " + AV.esc(nomeForma(a.forma)) + " · " + quemRegistrou(a) + "</span>" + situacaoAcerto(a); }).join("") +
      '<span class="av-nome-s">Quantidade ainda sem acerto informado: <b>' + AV.qtd(r.quantidade_sem_acerto_informado) + "</b></span>";
  }

  // ---------- vínculos acerto × saída (topo da fila A). O sistema só liga sozinho quando as 8 condições valem. ----------
  function nomeProd(id) { var p = (AV.produtos || {})[id]; return p && p.nome ? p.nome : "produto " + id; }
  function nomeForn(d, f) { return f === null || f === undefined ? "não informado" : ((d.nomes || {})[f] || "fornecedor " + f); }
  function numeroNota(d, id) {
    var x = null;
    d.filaC.forEach(function (r) { if (r.nota_id === id) x = r.numero; });
    if (x === null) d.filaB.forEach(function (r) { if (r.nota_id === id) x = r.nota; });
    return x;
  }
  function botaoNota(d, id) {
    if (!id) return "sem nota";
    var num = numeroNota(d, id);
    return '<button type="button" class="av-lk" data-av-nota="' + id + '">' + (num ? "NF " + num : "ver a nota") + "</button>";
  }
  // dia do registro no fuso da loja (para comparar com o dia da saída)
  function diaLocal(ts) {
    if (!ts) return "";
    try { var p = {}; new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Fortaleza", year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(new Date(ts)).forEach(function (x) { p[x.type] = x.value; }); return p.year + "-" + p.month + "-" + p.day; }
    catch (e) { return AV.iso(new Date(ts)); }
  }
  var AVISO_D = "o sistema nunca liga sozinho; na etapa 4 o conferente poderá ligar à mão, vendo este aviso e escrevendo a justificativa";
  // a condição 2 do banco junta duas causas: as datas dizem qual é (o aviso da saída anterior só quando ela é anterior)
  function condicao(c, v, a) {
    var t = AV.esc(String(c).replace(/^\d+\s+/, ""));
    if (/^2\s/.test(String(c))) {
      var ds = String(v.data || "").slice(0, 10), da = diaLocal(a && a.criado_em);
      if (ds && da && ds < da) t = 'saída anterior ao acerto <span class="av-quem">(' + AVISO_D + ")</span>";
      else if (ds && da && ds > da) t = "saída em outro ciclo do produto, não no ciclo do acerto";
      else t = 'saída no mesmo dia do registro do acerto: anterior a ele ou em outro ciclo <span class="av-quem">(se for anterior, ' + AVISO_D + ")</span>";
    }
    return "<li>" + t + "</li>";
  }
  // a tabela dos pares (fila A, "Acertos aguardando vínculo" e detalhe da nota usam a mesma)
  function tabelaPares(P, d, opc) {
    opc = opc || {};
    var ac = {}; d.acertos.forEach(function (a) { ac[a.acerto_id] = a; });
    var prod = function (v) { return '<button type="button" class="av-lk" data-av-prod="' + v.id_produto + '">' + AV.esc(nomeProd(v.id_produto)) + "</button>"; };
    // no detalhe da nota (gaveta estreita) o produto vai dentro da coluna do acerto
    return tabela((opc.naNota ? [] : [{ t: "Produto", cls: "l", cel: "principal", v: prod }]).concat([
      { t: "O acerto", cls: "l", cel: opc.naNota ? "principal" : "", v: function (v) { var a = ac[v.acerto_id];
        return (opc.naNota ? prod(v) + '<span class="av-pend-acq">' : "") + AV.qtd(v.acerto_sem_vinculo) + " sem vínculo · " + AV.esc(nomeForma(a && a.forma)) + '<span class="av-nome-s">fornecedor informado no acerto: ' + AV.esc(nomeForn(d, v.fornecedor_acerto)) + "</span>" +
          '<span class="av-nome-s">' + quemRegistrou(a) + "</span>" + situacaoAcerto(a) + (opc.naNota ? "</span>" : ""); } },
      { t: opc.naNota ? "A saída desta nota" : "A saída possível", cls: "l", v: function (v) {
        return AV.dataCurta(v.data) + (opc.naNota ? "" : " · " + botaoNota(d, v.nota_id)) + '<span class="av-nome-s">' + AV.qtd(v.qtd_liquida) + " " + palavra(v.qtd_liquida, "saiu", "saíram") +
          " · " + AV.esc(v.tipo_id ? tipoCurto(v.tipo_id) : "sem nota") + " · destinatário: " + AV.esc(destinatarioSaida(v, d.nomes).replace(/ \((nota de baixa|outras saídas)\)$/, "")) + "</span>"; } },
      { t: "O que impede o vínculo automático", cls: "l", v: function (v) {
        var c = lista(v.condicoes_que_falham);
        return (c.length ? '<ul class="av-pend-cond">' + c.map(function (x) { return condicao(x, v, ac[v.acerto_id]); }).join("") + "</ul>"
          : '<span class="av-quem">as 8 condições valem, mas o acerto tem ' + plural(v.saidas_aptas_do_acerto, "saída possível", "saídas possíveis") + "</span>") +
          (v.pista_texto_cita_mesma_forma ? AV.chip("o texto da nota cita a mesma forma", "av-pend-pista") : ""); } }
    ]), P, { classe: "av-pend-tab-v" + (opc.naNota ? " av-pend-tab-vn" : "") });
  }
  function vinculosPendentes(d) {
    var todos = paresPendentes(d), P = todos.filter(function (v) { return cicloAberto(d, v.acerto_id); }), fora = todos.length - P.length;
    var F = d.vinculosFeitos;
    if (!d.acertos.length && !todos.length && !F.length)
      return '<p class="av-pend-nada" data-av-bloco="vinculos">Vínculos de acerto: nenhum acerto foi registrado no Painel ainda (o registro só começa na etapa 4), então não há vínculo pendente de conferência nem vínculo feito.</p>';
    var h = '<div class="av-pend-vinc" data-av-bloco="vinculos"><h4>Vínculos pendentes de conferência <span class="av-quem">' + plural(P.length, "par", "pares") + " acerto × saída, de acertos com o ciclo aberto</span></h4>";
    if (!P.length) h += '<p class="avr-vazio">Nenhum vínculo pendente de conferência de acerto com o ciclo aberto.</p>';
    else h += '<p class="av-sub">Existe acerto possivelmente relacionado a esta saída. O sistema só liga sozinho quando o vínculo é inequívoco (as 8 condições); na dúvida, fica aqui.</p>' + tabelaPares(P, d);
    if (fora) h += '<p class="av-k-nota">' + (fora === 1 ? "1 par é de acerto" : AV.int(fora) + " pares são de acertos") + " de ciclo já encerrado: " + (fora === 1 ? "está" : "estão") +
      ' na fila C, em “Acertos aguardando vínculo”.</p>';
    if (F.length) {
      var ac = {}; d.acertos.forEach(function (a) { ac[a.acerto_id] = a; });
      h += '<h4 class="av-pend-h4b">Vínculos já feitos <span class="av-quem">' + AV.int(F.length) + "</span></h4>" + tabela([
        { t: "Produto", cls: "l", cel: "principal", v: function (v) { return '<button type="button" class="av-lk" data-av-prod="' + v.id_produto + '">' + AV.esc(nomeProd(v.id_produto)) + "</button>"; } },
        { t: "Quantidade", v: function (v) { return AV.qtd(v.quantidade); } },
        { t: "Saída", cls: "l", v: function (v) { return botaoNota(d, v.nota_id); } },
        { t: "O acerto", cls: "l", v: function (v) { var a = ac[v.acerto_id]; return a ? '<span class="av-nome-s">' + quemRegistrou(a) + "</span>" + situacaoAcerto(a) : '<span class="av-quem">—</span>'; } },
        { t: "Quem ligou", cls: "l", v: function (v) { return (v.automatico ? "automático (as 8 condições valiam)" : "por " + AV.esc(v.autor_nome || "—")) + '<span class="av-nome-s">' + AV.dataHora(v.criado_em) + "</span>"; } },
        { t: "Situação", cls: "l", v: function (v) {
          var c = [];
          if (v.desfeito) c.push(AV.chip("desfeito", ""));
          if (v.a_reconferir) c.push(AV.chip("a reconferir", "av-chip-est", "A nota foi corrigida no VR depois do vínculo automático"));
          if (v.aviso_quantidade_mudou) c.push(AV.chip("a quantidade da saída mudou no VR", "av-chip-est"));
          if (v.conflito_texto_vr) c.push(AV.chip("conflito com o texto do VR", "av-chip-conf", "O VR diz que a loja assumiu, ou o texto traz outra forma de acerto"));
          return c.length ? c.join(" ") : '<span class="av-quem">sem aviso</span>'; } }
      ], F, { classe: "av-pend-tab-v" });
    }
    return h + "</div>";
  }

  // ---------- FILA B · títulos de devolução em aberto no VR (valor do título; o Painel nunca baixa título) ----------
  // regra CONCEITUAL (decisão do dono na 3,5): todo título ainda aberto no VR com outra evidência ou informação indicando possível
  // acerto (documento, boleto, nota de compra com o desconto, forma escrita no texto da nota) continua "Em aberto no VR" e recebe o
  // aviso "requer conferência", com a ORIGEM escrita. Uma linha por título. Não fecha o título nem comprova nada. O detalhe da nota
  // usa a MESMA regra (marcaTitulo), para a lista e o detalhe nunca dizerem coisas diferentes.
  var ORIGENS = { bonificacao: "nota de bonificação", outras_entradas: "nota de outras entradas", verba: "verba",
    compra_texto: "nota de compra com o desconto", boleto: "boleto (desconto na parcela)", texto_da_nota: "texto da nota" };
  function temAviso(r) { return !!r.outra_evidencia; }
  function origensDe(r) {
    var o = (r.origens_evidencia || []).map(function (k) { return k === "texto_da_nota" && r.forma_texto ? "texto da nota (" + nomeForma(r.forma_texto) + ")" : (ORIGENS[k] || String(k).replace(/_/g, " ")); });
    return o.length ? o : ["outra fonte do VR"];
  }
  function textoAviso(r) {
    var det = String(r.aviso_outra_fonte || "").split(" | ").filter(Boolean).map(function (x) { return AV.esc(semCodigo(x)); }).join(" · ");
    return "origem: " + AV.esc(origensDe(r).join(" · ")) + (det ? ' <span class="av-pend-avis-det">(' + det + ")</span>" : "");
  }
  function marcaTitulo(r, emLinha) {
    if (!temAviso(r)) return "";
    return '<span class="av-pend-avis">' + AV.nivel("em_aberto_vr") + " <b>Existe outra evidência indicando acerto — requer conferência</b>" +
      '<span class="av-nome-s">' + textoAviso(r) + (emLinha ? "" : ". Isso não fecha o título nem o torna comprovado. O Painel não baixa o título: só o VR.") + "</span></span>";
  }
  // produtos com acerto ligado a esta nota (nunca soma de quantidades: produtos diferentes têm unidades diferentes)
  function produtosLigados(d, nota_id) {
    var p = {}; d.vinculosFeitos.forEach(function (v) { if (+v.nota_id === +nota_id && !v.desfeito) p[v.id_produto] = 1; });
    return Object.keys(p).length;
  }
  var FAIXAS_VENC = ["a vencer"].concat(AV.faixas).concat(["sem vencimento"]);
  function filaB(box, d) {
    var s = loc.B, B = d.filaB;
    var venc = B.filter(function (r) { return AV.n(r.dias_vencido) > 0; }), avis = B.filter(temAviso);
    var titulosAvis = {}, notasAvis = {}; avis.forEach(function (r) { titulosAvis[r.titulo_id] = 1; notasAvis[r.nota_id] = 1; });   // contados por título ÚNICO
    var h = '<div class="av-card" data-av-bloco="fila-b"><h3>B · Títulos de devolução em aberto no VR</h3>' +
      '<p class="av-sub">Título aberto de nota de devolução que tirou mercadoria da troca, pelo valor do título. Sai desta fila quando o VR baixa o título (vira comprovado) ou o cancela.</p>' +
      AV.aviso("cz", "Título em aberto no VR não prova dívida nem garante pagamento. <b>O Painel nunca baixa título — só o VR.</b>");
    h += '<div class="av-resumo-f" data-av-resumo="B"><span><b>' + plural(B.length, "título", "títulos") + "</b> · <b>" + AV.rs(AV.soma(B, function (r) { return r.valor; })) + "</b> pelo valor do título</span>" +
      "<span>vencidos pelo vencimento: <b>" + AV.int(venc.length) + "</b> · <b>" + AV.rs(AV.soma(venc, function (r) { return r.valor; })) + "</b></span>" +
      "<span><b>" + plural(Object.keys(titulosAvis).length, "título", "títulos") + "</b> com outra evidência indicando acerto (" + plural(Object.keys(notasAvis).length, "nota", "notas") + "), que requer conferência</span></div>";
    h += '<div class="av-pend-fx" data-av-faixas="B">' + FAIXAS_VENC.map(function (f) {
      var L = B.filter(function (r) { return (r.faixa_vencimento || "sem vencimento") === f; });
      return L.length ? '<span><i>' + (f === "a vencer" || f === "sem vencimento" ? f : "vencido há " + AV.nomeFaixa(f)) + "</i> <b>" + AV.int(L.length) + "</b> · " + AV.rs(AV.soma(L, function (r) { return r.valor; })) + "</span>" : "";
    }).join("") + "</div>";
    h += '<div class="av-linha-f"><label>Evidência <select data-av-p="evid"><option value="">Todos os títulos</option>' +
      '<option value="aviso"' + (s.evid === "aviso" ? " selected" : "") + ">Com outra evidência indicando acerto</option></select></label>" +
      '<label>Faixa <select data-av-p="faixa"><option value="">Todas</option>' + FAIXAS_VENC.map(function (f) { return '<option value="' + f + '"' + (s.faixa === f ? " selected" : "") + ">" + nomeFaixaVenc(f) + "</option>"; }).join("") + "</select></label>" +
      '<input type="search" class="av-busca" data-av-p="busca" placeholder="Buscar fornecedor ou NF" aria-label="Buscar fornecedor ou número da nota" value="' + AV.esc(s.busca) + '"></div><div data-av-p="lista"></div></div>';
    box.innerHTML = h;
    var lst = box.querySelector("[data-av-p=lista]"), red = function () { s.ver = PASSO; listaB(lst, d); };
    box.querySelector("[data-av-p=evid]").addEventListener("change", function (e) { s.evid = e.target.value; red(); });
    box.querySelector("[data-av-p=faixa]").addEventListener("change", function (e) { s.faixa = e.target.value; red(); });
    box.querySelector("[data-av-p=busca]").addEventListener("input", function (e) { s.busca = e.target.value; red(); });
    listaB(lst, d);
  }

  function listaB(lst, d) {
    var s = loc.B, q = norm(s.busca).trim();
    var L = d.filaB.filter(function (r) {
      return (!s.evid || temAviso(r)) && (!s.faixa || (r.faixa_vencimento || "sem vencimento") === s.faixa) &&
        (!q || norm(r.fornecedor_nome).indexOf(q) >= 0 || String(r.nota).indexOf(q) >= 0);
    });
    L.sort(function (a, b) { var x = a.dias_vencido === null ? -1e9 : +a.dias_vencido, y = b.dias_vencido === null ? -1e9 : +b.dias_vencido; return y - x || a.titulo_id - b.titulo_id; });
    var V = L.slice(0, s.ver);
    var h = (s.evid || s.faixa || q ? '<p class="av-quem av-pend-filtrado">Com os filtros: ' + plural(L.length, "título", "títulos") + " · " + AV.rs(AV.soma(L, function (r) { return r.valor; })) + "</p>" : "") + tabela([
      { t: "Fornecedor", cls: "l", cel: "principal", dica: "Fornecedor comprovado: o destinatário da nota de devolução", v: function (r) {
        return '<span class="av-nome">' + AV.esc(r.fornecedor_nome || "fornecedor " + r.fornecedor) + "</span>" + marcaTitulo(r, true); } },
      { t: "Nota", cls: "l", v: function (r) { return "NF " + AV.esc(r.nota); } },
      { t: "Valor do título", v: function (r) { return '<span class="av-num">' + AV.rs(r.valor) + "</span>"; } },
      { t: "Emissão", v: function (r) { return AV.dataCurta(r.emissao); } },
      { t: "Vencimento", v: function (r) { return AV.dataCurta(r.vencimento); } },
      { t: "Dias vencido", v: function (r) { return r.dias_vencido === null ? "sem vencimento" : AV.n(r.dias_vencido) > 0 ? AV.int(r.dias_vencido) : "a vencer"; } },
      { t: "Faixa", cls: "l", v: function (r) { return nomeFaixaVenc(r.faixa_vencimento || "sem vencimento"); } },
      { t: "Situação no VR", cls: "l", v: function () { return AV.nivel("em_aberto_vr"); } },
      { t: "Acerto ligado", cls: "l", dica: "Produtos desta nota com acerto registrado no Painel e ligado à saída (não muda a situação do título)", v: function (r) {
        var np = produtosLigados(d, r.nota_id);
        return np ? plural(np, "produto com acerto ligado", "produtos com acerto ligado") : AV.n(r.quantidade_acerto_vinculado) > 0 ? "com acerto ligado" : "—"; } }
    ], V, { classe: "av-pend-tab-b", vazio: "Nenhum título com estes filtros.",
      linha: function (r) { return linhaClicavel(r.nota_id, "Abrir o detalhe da nota") + (temAviso(r) ? ' class="av-aviso-lin"' : ""); } });
    h += botaoMais(L.length, V.length);
    lst.innerHTML = h;
    var m = lst.querySelector("[data-av-p=mais]"); if (m) m.addEventListener("click", function () { s.ver += PASSO; listaB(lst, d); });
    ligarLinhas(lst, function (id) { AV.abrirNota(+id, { origem: "pendencias" }); });
  }

  // ---------- FILA C · saídas aguardando comprovação do acerto (a partir de 08/05/2026, pelo valor da nota) ----------
  var ORDEM_NIVEL = ["comprovado_parcial", "declarado", "declarado_parcial", "assumido_parcial", "nao_identificado"];
  // o que o Painel registrou nesta nota (acerto na nota ou acerto do produto ligado à saída), com quem registrou
  function registradoNaNota(d, r) {
    var h = "";
    d.acertos.forEach(function (a) { if (a.fila === "C" && +a.nota_id === +r.nota_id && !a.anulado)
      h += '<span class="av-nome-s">acerto informado' + (AV.tem(a.valor) ? " de " + AV.rs(a.valor) : "") + " · " + quemRegistrou(a) + "</span>" + situacaoAcerto(a); });
    var ac = {}; d.acertos.forEach(function (a) { ac[a.acerto_id] = a; });
    d.vinculosFeitos.forEach(function (v) { if (+v.nota_id === +r.nota_id && !v.desfeito)
      h += '<span class="av-nome-s">acerto do produto ' + AV.esc(nomeProd(v.id_produto)) + " ligado " + (v.automatico ? "automaticamente" : "por " + AV.esc(v.autor_nome || "—")) +
        (ac[v.acerto_id] ? " · acerto " + quemRegistrou(ac[v.acerto_id]) : "") + "</span>"; });
    paresPendentes(d).forEach(function (v) { if (+v.nota_id === +r.nota_id)
      h += '<span class="av-nome-s">acerto do produto ' + AV.esc(nomeProd(v.id_produto)) + " pode ser desta saída · acerto " + quemRegistrou(ac[v.acerto_id]) + " · vínculo pendente de conferência</span>"; });
    if (!h && (AV.n(r.valor_declarado_painel) > 0.004 || AV.n(r.valor_assumido_painel) > 0.004)) h = '<span class="av-nome-s">registrado no Painel: abra a nota para ver quem registrou</span>';
    return h;
  }
  function filaC(box, d) {
    var s = loc.C, C = d.filaC;
    var conf = C.filter(function (r) { return r.em_conferencia; });
    var h = '<div class="av-card" data-av-bloco="fila-c"><h3>C · Saídas aguardando comprovação do acerto</h3>' +
      AV.aviso("fixo", "O acompanhamento desta fila começa em 08/05/2026. O que saiu antes está na análise.") +
      '<p class="av-sub">A nota que tirou mercadoria da troca, pelo valor da nota, sem título aberto e ainda sem comprovação completa. Sai desta fila quando documentos do VR comprovarem o valor inteiro, ' +
      "ou, a partir da etapa 4, quando o conferente registrar que a loja assumiu ou encerrar sem comprovação, com motivo.</p>";
    var semc = AV.soma(C, function (r) { return r.valor_sem_comprovacao; });
    h += '<div class="av-resumo-f" data-av-resumo="C"><span><b>' + plural(C.length, "nota", "notas") + "</b> · <b>" + AV.rs(AV.soma(C, function (r) { return r.valor; })) + "</b> pelo valor das notas</span>" +
      "<span><b>" + AV.rs(semc) + "</b> sem comprovação</span><span><b>" + AV.int(conf.length) + "</b> em conferência (conflito entre fontes)</span></div>";
    h += '<div class="av-pend-fx" data-av-niveis="C">' + ORDEM_NIVEL.map(function (nv) {
      var L = C.filter(function (r) { return r.nivel === nv; });
      return L.length ? "<span>" + AV.nivel(nv) + " <b>" + AV.int(L.length) + "</b> · " + AV.rs(AV.soma(L, function (r) { return r.valor; })) + "</span>" : "";
    }).join("") + "</div>";
    // idade da saída, em faixas (situação, não alerta): quantas notas e quantas delas declaradas aguardando documento
    h += '<div class="av-pend-fx" data-av-faixas="C"><span class="av-pend-fx-t">Idade da saída</span>' + AV.faixas.map(function (f) {
      var L = C.filter(function (r) { return r.faixa === f; }), dc = L.filter(function (r) { return /declarado/.test(r.nivel); }).length;
      return L.length ? "<span><i>" + AV.nomeFaixa(f) + "</i> <b>" + AV.int(L.length) + "</b>" + (dc ? " · " + plural(dc, "declarada", "declaradas") : "") + "</span>" : "";
    }).join("") + "</div>";
    var niveis = ORDEM_NIVEL.filter(function (nv) { return C.some(function (r) { return r.nivel === nv; }); });
    h += '<div class="av-linha-f"><label>Nível <select data-av-p="nivel"><option value="">Todos</option>' + niveis.map(function (nv) { return '<option value="' + nv + '"' + (s.nivel === nv ? " selected" : "") + ">" + AV.nomeNivel(nv) + "</option>"; }).join("") + "</select></label>" +
      '<label><input type="checkbox" data-av-p="conf"' + (s.conf ? " checked" : "") + "> Só com conflito entre fontes</label></div>" +
      '<div data-av-p="lista"></div></div>' + aguardandoVinculo(d);
    box.innerHTML = h;
    var lst = box.querySelector("[data-av-p=lista]"), red = function () { s.ver = PASSO; listaC(lst, d); };
    box.querySelector("[data-av-p=nivel]").addEventListener("change", function (e) { s.nivel = e.target.value; red(); });
    box.querySelector("[data-av-p=conf]").addEventListener("change", function (e) { s.conf = e.target.checked; red(); });
    box.querySelectorAll("[data-av-bloco=aguardando] [data-av-prod]").forEach(function (b) { b.addEventListener("click", function () { abrirProduto(b.getAttribute("data-av-prod")); }); });
    box.querySelectorAll("[data-av-bloco=aguardando] [data-av-nota]").forEach(function (b) { b.addEventListener("click", function () { AV.abrirNota(+b.getAttribute("data-av-nota"), { origem: "pendencias" }); }); });
    listaC(lst, d);
  }

  // coluna Conflito: o texto do banco já diz "em conferência" quase sempre; o selo só entra quando ainda não diz
  function conflitoC(r) {
    var c = lista(r.conflitos).map(function (x) { return semCodigo(x, r); }), jaDiz = c.some(function (x) { return /conferência/.test(x); });
    if (!c.length && !r.em_conferencia) return "—";
    return c.map(function (x) { return AV.chip(AV.esc(x), "av-chip-conf av-pend-chipq"); }).join(" ") + (r.em_conferencia && !jaDiz ? ' <span class="av-pend-emconf">em conferência</span>' : "");
  }
  function listaC(lst, d) {
    var s = loc.C;
    var L = d.filaC.filter(function (r) { return (!s.nivel || r.nivel === s.nivel) && (!s.conf || r.em_conferencia || lista(r.conflitos).length); });
    L.sort(function (a, b) { return a.data < b.data ? -1 : a.data > b.data ? 1 : a.numero - b.numero; });
    var V = L.slice(0, s.ver);
    var h = (s.nivel || s.conf ? '<p class="av-quem av-pend-filtrado">Com os filtros: ' + plural(L.length, "nota", "notas") + " · " + AV.rs(AV.soma(L, function (r) { return r.valor; })) + "</p>" : "") + tabela([
      { t: "Nota", cls: "l", cel: "principal", v: function (r) { return '<span class="av-nome">NF ' + AV.esc(r.numero) + '</span><span class="av-nome-s">' + AV.dataCurta(r.data) + " · " + AV.esc(tipoCurto(r.tipo_id, r.tipo)) + " · " + plural(r.produtos, "produto", "produtos") + "</span>"; } },
      { t: "Destinatário", cls: "l", v: function (r) { return destinatario(r); } },
      { t: "Valor da nota", v: function (r) { return '<span class="av-num">' + AV.rs(r.valor) + "</span>"; } },
      { t: "Nível", cls: "l", v: function (r) { return AV.nivel(r.nivel) + registradoNaNota(d, r); } },
      { t: "Sem comprovação", v: function (r) { return '<span class="av-num">' + AV.rs(r.valor_sem_comprovacao) + "</span>"; } },
      { t: "Forma escrita no texto", cls: "l", v: function (r) { return r.forma_texto ? AV.esc(nomeForma(r.forma_texto)) : '<span class="av-quem">não informada</span>'; } },
      { t: "Conflito", cls: "l", v: conflitoC }
    ], V, { classe: "av-pend-tab-c", vazio: "Nenhuma nota com estes filtros.",
      linha: function (r) { return linhaClicavel(r.nota_id, "Abrir o detalhe da nota"); } });
    h += botaoMais(L.length, V.length);
    lst.innerHTML = h;
    var m = lst.querySelector("[data-av-p=mais]"); if (m) m.addEventListener("click", function () { s.ver += PASSO; listaC(lst, d); });
    ligarLinhas(lst, function (id) { AV.abrirNota(+id, { origem: "pendencias" }); });
  }

  // sub-lista em SEÇÃO PRÓPRIA, com o seu total, nunca somada às notas; os pares destes acertos (ciclo encerrado) ficam aqui
  function aguardandoVinculo(d) {
    var L = d.acertos.filter(function (a) { return a.estado === "aguardando_vinculo"; });
    var P = paresPendentes(d).filter(function (v) { return !cicloAberto(d, v.acerto_id); });
    var h = '<div class="av-card" data-av-bloco="aguardando"><h3>Acertos aguardando vínculo</h3>' +
      '<p class="av-sub">Acertos de ciclos já encerrados que não foram ligados a nenhuma saída. Total próprio: não se soma com as notas acima.</p>';
    if (!L.length && !P.length) return h + '<p class="avr-vazio">Nenhum acerto aguardando vínculo' + (d.acertos.length ? "." : " (nenhum acerto foi registrado no Painel ainda).") + "</p></div>";
    var comValor = L.filter(function (a) { return AV.tem(a.valor); });
    h += '<div class="av-resumo-f"><span><b>' + plural(L.length, "acerto", "acertos") + "</b></span>" + (comValor.length ? "<span><b>" + AV.rs(AV.soma(comValor, function (a) { return a.valor; })) + "</b> informados em " + plural(comValor.length, "acerto com valor", "acertos com valor") + "</span>" : "") + "</div>";
    h += tabela([
      { t: "Produto", cls: "l", cel: "principal", v: function (a) { return '<button type="button" class="av-lk" data-av-prod="' + a.id_produto + '">' + AV.esc(nomeProd(a.id_produto)) + "</button>" + (a.ciclo_desfeito ? '<span class="av-nome-s">o ciclo foi desfeito por nota refeita no VR</span>' : ""); } },
      { t: "Quantidade", v: function (a) { return AV.qtd(a.sem_vinculo) + (AV.n(a.sem_vinculo) !== AV.n(a.quantidade) ? '<span class="av-nome-s">de ' + AV.qtd(a.quantidade) + " " + palavra(a.quantidade, "informada", "informadas") + "</span>" : ""); } },
      { t: "Forma", cls: "l", v: function (a) { return AV.esc(nomeForma(a.forma)); } },
      { t: "Quem registrou", cls: "l", v: function (a) { return AV.esc(a.autor_nome || "—") + '<span class="av-nome-s">' + AV.dataHora(a.criado_em) + "</span>"; } },
      { t: "Conferência", cls: "l", v: function (a) { return situacaoAcerto(a); } }
    ], L, { classe: "av-pend-tab-v" });
    if (P.length) h += '<h4 class="av-pend-h4b">Saídas possíveis destes acertos <span class="av-quem">' + plural(P.length, "par", "pares") + " acerto × saída, pendentes de conferência</span></h4>" +
      '<p class="av-sub">O ciclo do acerto já se encerrou; a saída abaixo pode ser o acerto dele, mas o sistema não liga sozinho.</p>' + tabelaPares(P, d);
    return h + "</div>";
  }

  // ---------- rodapé: saldo negativo (problema de lançamento; fora de todo total; o acerto é no VR) ----------
  function caixaNegativo(d) {
    var N = d.negativo;
    var h = '<div class="av-pend-neg" id="avPNeg" data-av-bloco="negativo"><span class="av-rot">fora de todo total · não somado</span>' +
      "<h3>Problema de lançamento: saldo negativo no estoque de troca</h3>";
    if (!N.length) return h + '<p class="avr-vazio">Nenhum produto com saldo negativo na troca.</p></div>';
    h += '<p class="av-pend-neg-n"><b>' + plural(N.length, "produto", "produtos") + "</b> com saldo abaixo de zero na troca do VR</p>" +
      '<p class="av-pend-neg-v">Variação desde ontem: <b>indisponível nesta prévia</b> (a prévia tem uma cópia só do VR, sem a de ontem para comparar).</p>' +
      '<p class="av-k-nota">Fica fora de todo total. As quantidades não se somam (há produtos em quilo e em unidade). O Painel não corrige: o acerto é feito no VR.</p>' +
      '<button type="button" class="av-bt" data-av-p="neg" aria-expanded="' + loc.negAberto + '" aria-controls="avPNegLista">' + (loc.negAberto ? "Esconder a lista" : verNeg(N.length)) + "</button>" +
      '<div id="avPNegLista"' + (loc.negAberto ? "" : " hidden") + ">" + (loc.negAberto ? listaNegativo(N) : "") + "</div>";
    return h + "</div>";
  }
  function verNeg(n) { return n === 1 ? "Ver o produto" : "Ver os " + AV.int(n) + " produtos"; }
  function listaNegativo(N) {
    var L = N.slice().sort(function (a, b) { return String(a.nome || "").localeCompare(String(b.nome || ""), "pt-BR"); });
    return tabela([
      { t: "Produto", cls: "l", cel: "principal", v: function (r) { return '<span class="av-nome">' + AV.esc(r.nome || "produto " + r.id_produto) + '</span><span class="av-nome-s">código ' + r.id_produto + "</span>"; } },
      { t: "Setor", cls: "l", v: function (r) { return AV.esc(AV.nomeSetor(r.setor_id)); } },
      { t: "Saldo na troca", v: function (r) { return '<span class="av-num av-semc">' + AV.qtd(r.saldo) + "</span>"; } },
      { t: "Último movimento", v: function (r) { return AV.dataCurta(r.ultimo_movimento); } }
    ], L, { classe: "av-pend-tab-neg", linha: function (r) { return linhaClicavel(r.id_produto, "Abrir a ficha do produto"); } });
  }
  function ligarNegativo(el, d) {
    var b = el.querySelector("[data-av-p=neg]"); if (!b) return;
    var box = el.querySelector("#avPNegLista");
    b.addEventListener("click", function () {
      loc.negAberto = !loc.negAberto;
      b.setAttribute("aria-expanded", loc.negAberto);
      b.textContent = loc.negAberto ? "Esconder a lista" : verNeg(d.negativo.length);
      box.hidden = !loc.negAberto;
      if (loc.negAberto && !box.innerHTML) { box.innerHTML = listaNegativo(d.negativo); ligarLinhas(box, abrirProduto); }
    });
    if (loc.negAberto) ligarLinhas(box, abrirProduto);
  }

  // ---------- DETALHE DA NOTA (gaveta). Usado pelas Pendências e por Fornecedores: AV.abrirNota(nota_id, {origem}) ----------
  var FONTES = { boleto: "Desconto no boleto (parcela a pagar ao fornecedor)", bonificacao: "Nota de bonificação", outras_entradas: "Outra nota de entrada do fornecedor",
    verba: "Verba", compra_texto: "Texto de uma nota de compra" };
  var ORDEM_FONTES = ["boleto", "bonificacao", "outras_entradas", "verba", "compra_texto"];
  var CASO_BOLETO = { A: "a parcela com desconto cita só esta nota", B: "a parcela cita várias notas, cada uma com o seu valor, e a soma bate com o desconto",
    C: "o desconto está ligado ao título desta nota", ambiguo: "em conferência" };
  var RES_DOC = { comprovado: "comprovam pelo valor citado", conferencia: "em conferência", nao_serve: "não servem como prova",
    ja_no_boleto: "não somam com o boleto", ja_no_titulo: "não somam com o título baixado" };
  function situacaoTitulo(s) {
    return +s === 0 ? AV.nivel("em_aberto_vr") : +s === 1 ? '<span class="av-pill av-n-comp">baixado no VR</span>' : '<span class="av-pill av-n-sem">cancelado no VR</span>';
  }

  AV.abrirNota = function (nota_id, opc) {
    opc = opc || {};
    var id = +nota_id, corpo = AV.gaveta("Detalhe da nota", "Carregando…", '<div class="av-card av-carr"><p>Carregando a nota…</p></div>');
    var nomes = AV.ler("nomesForn").then(function (L) { var o = {}; L.forEach(function (f) { o[f.fornecedor] = f.nome; }); return o; }, function () { return {}; });
    Promise.all([AV.ler("notas", { nota_id: id }), AV.ler("notaItens", { nota_id: id }), AV.ler("provas", { nota_id: id }), AV.ler("titulos", { nota_id: id }), nomes,
                 AV.ler("eventosNota", { nota_id: id }), AV.ler("vinculosFeitos"), AV.ler("documentos"), AV.ler("filaB"), AV.ler("vinculos"), AV.ler("acertos")]).then(function (r) {
      if (!corpo.isConnected) return;                                   // a pessoa fechou ou abriu outra coisa
      guardarDocs(r[7]);
      var n = r[0][0], gav = corpo.parentNode;
      if (!n) { corpo.innerHTML = '<div class="av-card"><h3>Nota não encontrada</h3><p class="av-sub">Esta nota não está nas cópias do VR (pode ter sumido do VR depois da última cópia).</p></div>'; return; }
      var t = gav.querySelector("#avrGavT"), sub = gav.querySelector(".avr-gav-topo .av-sub");
      if (t) t.textContent = "NF " + n.numero + " · " + tipoCurto(n.tipo_id, n.tipo);
      if (sub) sub.textContent = AV.data(n.data) + " · " + AV.rs(n.valor) + " · destinatário: " + destinatarioTexto(n, { comNome: true });
      var ctx = { titulosB: r[8].filter(function (x) { return +x.nota_id === id; }), nomes: r[4], acertos: r[10],
        pares: r[9].filter(function (v) { return +v.nota_id === id && (lista(v.condicoes_que_falham).length || AV.n(v.saidas_aptas_do_acerto) !== 1); }) };
      corpo.innerHTML = detalheNota(n, r[1], r[2], r[3], r[4], opc, ctx) + blocoPainel(r[5], r[6].filter(function (v) { return +v.nota_id === id; }), ctx);
      var abreP = function (pid) { if (AV.abrirProduto) AV.abrirProduto(+pid, { origem: opc.origem || "pendencias" }); };
      ligarLinhas(corpo, abreP);
      corpo.querySelectorAll("[data-av-prod]").forEach(function (b) { b.addEventListener("click", function () { abreP(b.getAttribute("data-av-prod")); }); });
    }, function (e) { if (corpo.isConnected) AV.falhou(corpo, e); });
  };

  // a MESMA regra da fila B (título aberto no VR + outra evidência, com a origem), lida da linha do título na fila B
  function marcaDaNota(n, ctx) {
    if (n.titulo !== "aberto") return "";
    var com = ctx.titulosB.filter(temAviso)[0];
    return com ? AV.aviso("am", marcaTitulo(com, false)) : "";
  }

  function detalheNota(n, itens, provas, titulos, nomes, opc, ctx) {
    var h = "", autorizada = +n.nfe === 1, baixa = +n.tipo_id === 29 || +n.tipo_id === 31, temDest = n.destinatario_vr !== null && n.destinatario_vr !== undefined;
    h += '<div class="av-card" data-av-bloco="nota"><dl class="av-dl">' +
      "<dt>Nota</dt><dd>NF " + AV.esc(n.numero) + (n.serie ? " · série " + AV.esc(n.serie) : "") + "</dd>" +
      "<dt>Data</dt><dd>" + AV.data(n.data) + "</dd>" +
      "<dt>Tipo</dt><dd>" + AV.esc(tipoCurto(n.tipo_id, n.tipo)) + '<span class="av-nome-s">' + AV.esc(n.tipo || "") + "</span></dd>" +
      "<dt>Situação da NF-e</dt><dd>" + (autorizada ? "autorizada" : '<b class="av-semc">não autorizada no VR</b> (cancelada ou inutilizada)') + "</dd>" +
      "<dt>Destinatário</dt><dd>" + destinatario(n, { comNome: true }) + (n.fornecedor_comprovado ? '<span class="av-nome-s">fornecedor comprovado: o destinatário da nota de devolução</span>'
        : temDest ? '<span class="av-nome-s">só a nota de devolução mostra fornecedor comprovado; esta nota não é de devolução</span>' : "") + "</dd>" +
      '<dt>Valor da nota</dt><dd><b>' + AV.rs(n.valor) + "</b></dd>" +
      "<dt>Nível</dt><dd>" + (n.nivel ? AV.nivel(n.nivel) : '<span class="av-quem">sem nível (nota não autorizada)</span>') +
        (n.selo_assumido ? '<span class="av-nome-s">Assumido pela loja — ' + AV.esc(n.selo_assumido) + "</span>" : "") +
        (n.encerrada_sem_comprovacao ? " " + AV.chip("encerrada sem comprovação", "") : "") + "</dd></dl>";
    if (!autorizada) h += AV.aviso("am", "Esta nota não está autorizada no VR (foi cancelada ou inutilizada). Não entra em nenhuma fila e não tem nível. " +
      "Se ela tirou e devolveu a mercadoria (vai-e-volta), o líquido é zero e não conta como saída; o ciclo do produto não fecha nem reabre por ela.");
    else if (n.corrigida) h += AV.aviso("am", "<b>Nota corrigida no VR: vale o líquido (saiu − voltou).</b> Parte do que esta nota tirou da troca voltou para ela (vai-e-volta): " +
      "cada produto conta pelo que saiu menos o que voltou.");
    h += marcaDaNota(n, ctx) + "</div>";
    if (autorizada && n.nivel) h += divisaoNota(n, baixa, provas);
    h += '<div class="av-card" data-av-bloco="texto"><h3>Texto da nota no VR</h3>' +
      (n.texto && String(n.texto).trim() ? '<div class="av-texto-vr">' + AV.esc(n.texto) + "</div>" : '<p class="avr-vazio">A nota não tem texto no VR.</p>') +
      '<p class="av-pend-lido">Forma de acerto lida no texto: <b>' + AV.esc(nomeForma(n.forma_texto)) + "</b>" +
      (n.assumido_texto ? " · o texto diz que a loja assumiu (sem acerto com o fornecedor)" : "") + (n.duvida_texto ? " · o texto deixa dúvida sobre o acerto" : "") + "</p>" +
      '<p class="av-k-nota">O texto é uma declaração: sozinho, não comprova acerto.</p></div>';
    h += blocoTitulos(titulos) + blocoProvas(n, provas, nomes) + blocoItens(itens, opc);
    return h;
  }

  // "Não identificado" diz o que é verdade para esta nota: documento em conferência, documento que não comprova, ou nada no VR
  function legendaNid(n, P) {
    if (n.em_conferencia || n.provas === "conferencia") return "há documento ou boleto do VR citando esta nota, em conferência: enquanto não for conferido, este valor não conta como comprovado";
    var semForma = n.forma_texto ? "" : ", e o texto da nota não diz a forma de acerto";
    if (P.some(function (p) { return !p.nao_serve; })) return "há documento do VR citando esta nota, mas ele não comprova este valor (veja as provas abaixo)" + semForma;
    if (P.length) return "os documentos do VR que citam esta nota não servem como prova" + semForma;
    return "nenhum título ou documento do VR cita esta nota" + semForma;
  }
  // a divisão do valor da nota pelo que sustenta cada pedaço: soma o valor da nota (nunca por precedência escondida)
  function divisaoNota(n, baixa, P) {
    var div = [
      ["Comprovado", n.valor_comprovado, "há documento no VR que sustenta o acerto"],
      ["Em aberto no VR", n.valor_em_aberto_vr, "título ainda não baixado no VR"],
      ["Assumido pela loja", n.valor_assumido, n.selo_assumido ? AV.esc(n.selo_assumido) : "identificado no VR ou registrado no Painel"],
      ["Declarado", n.valor_declarado, "forma escrita na nota ou acerto informado, sem documento que prove"],
      ["Não identificado", n.valor_nao_identificado, AV.n(n.valor_nao_identificado) > 0.004 ? AV.esc(legendaNid(n, P)) : "nenhum valor desta nota ficou sem explicação"]
    ];
    var soma = AV.soma(div, function (p) { return p[1]; });
    var h = '<div class="av-card" data-av-bloco="divisao"><h3>Divisão do valor da nota</h3><p class="av-sub">O valor da nota dividido pelo que sustenta cada pedaço dele; a divisão soma o valor da nota.</p>' +
      '<ul class="av-pend-div">' + div.map(function (p) {
        return '<li class="' + (AV.n(p[1]) > 0.004 ? "" : "av-pend-zero") + '"><span>' + p[0] + '<span class="av-nome-s">' + p[2] + "</span></span><b>" + AV.rs(p[1]) + "</b></li>";
      }).join("") + '<li class="av-pend-tot"><span>Valor da nota</span><b>' + AV.rs(n.valor) + "</b></li></ul>";
    if (Math.abs(soma - AV.n(n.valor)) > 0.009) h += AV.aviso("vm", "A divisão soma " + AV.rs(soma) + " e a nota vale " + AV.rs(n.valor) + ": diferença de " + AV.rs(AV.n(n.valor) - soma) + ".");
    if (n.parcialmente_declarada) h += '<p class="av-k-nota">Parcialmente declarada: só o produto do acerto ligado está declarado; os demais produtos da nota não.</p>';
    var conf = lista(n.conflitos).map(function (c) { return semCodigo(c, n); }), jaDiz = conf.some(function (c) { return /conferência/.test(c); });
    if (conf.length || n.em_conferencia) h += AV.aviso("vm", "<b>Conflito entre fontes</b>" + (n.em_conferencia && !jaDiz ? ' · <span class="av-pend-emconf">em conferência</span>' : "") +
      (conf.length ? '<ul class="av-conf-l">' + conf.map(function (c) { return "<li>" + AV.esc(c) + "</li>"; }).join("") + "</ul>" : ""));
    var rot = semCodigo(n.rotulo, n);
    h += '<p class="av-pend-lido">' + (!n.rotulo ? "De onde vem a comprovação: <b>nenhuma fonte do VR comprova esta nota</b>"
      : AV.n(n.valor_comprovado) > 0.004 ? "De onde vem a comprovação: <b>" + AV.esc(rot) + "</b>"
      : "Fonte que indica acerto: <b>" + AV.esc(rot) + "</b> — não conta como comprovado" + (n.em_conferencia ? " enquanto o conflito não for conferido" : "")) + "</p>";
    var cp = semCodigo(n.conflito_provas, n);
    if (n.provas === "conferencia" && n.conflito_provas && conf.indexOf(cp) < 0) h += '<p class="av-k-nota">' + AV.esc(cp) + "</p>";
    if (n.aviso) h += AV.aviso("am", AV.esc(semCodigo(n.aviso, n)));
    if (baixa) h += '<p class="av-k-nota">Nota de baixa por perda: sozinha, nunca comprova acerto nem vale como fornecedor comprovado.</p>';
    return h + '<p class="av-k-nota">Comprovado = há documento no VR que sustenta o acerto, segundo as regras do Painel. Não é extrato do banco.</p></div>';
  }

  // o que o PAINEL registrou nesta nota: cada registro com quem, quando e o motivo; e os pares acerto × saída desta nota
  // ainda pendentes de conferência. Documento de fora do VR fica "Declarado — conferido por X" e nunca vira comprovado.
  function blocoPainel(E, V, ctx) {
    var nomes = ctx.nomes || {}, AC = ctx.acertos || [], P = ctx.pares || [];
    var h = '<div class="av-card" data-av-bloco="painel"><h3>Registrado no Painel nesta nota</h3>';
    if (!E.length && !V.length && !P.length)
      return h + '<p class="avr-vazio">Nada registrado no Painel nesta nota.' + (AC.length ? "" : " O registro de acertos só começa na etapa 4.") + "</p></div>";
    var quem = function (e) { return (e.automatico ? "automático (função do servidor)" : "por " + AV.esc(e.autor_nome || "—")) + " em " + AV.dataHora(e.criado_em); };
    var acertoDo = function (e) { var x = null; AC.forEach(function (a) { if (a.fila === "C" && +a.nota_id === +e.nota_id && a.criado_em === e.criado_em) x = a; }); return x; };
    var L = E.map(function (e) {
      if (e.tipo === "declarado_conferido") return "<li><b>Declarado — conferido por " + AV.esc(e.autor_nome || "—") + "</b> em " + AV.dataHora(e.criado_em) + " · " + AV.rs(e.valor) +
        (e.documento ? " · documento: " + AV.esc(e.documento) : "") + (e.motivo ? " · motivo: " + AV.esc(e.motivo) : "") +
        '<span class="av-nome-s">Documento de fora do VR: continua declarado, não vira comprovado' + ". Se o título estiver aberto, continua “Em aberto no VR”.</span></li>";
      if (e.tipo === "loja_assume") return "<li><b>Loja assume</b> " + quem(e) + " · " + (e.valor === null ? "a nota inteira" : AV.rs(e.valor) + " (só o que faltava comprovar)") + (e.motivo ? " · motivo: " + AV.esc(e.motivo) : "") + "</li>";
      if (e.tipo === "encerrado_sem_comprovacao") return "<li><b>Encerrada sem comprovação</b> " + quem(e) + (e.motivo ? " · motivo: " + AV.esc(e.motivo) : "") + '<span class="av-nome-s">mantém o nível que tinha</span></li>';
      return "<li><b>Acerto informado na nota</b> " + quem(e) + " · " + AV.rs(e.valor) + (e.forma ? " · " + AV.esc(nomeForma(e.forma)) : "") +
        (e.fornecedor ? " · fornecedor informado: " + AV.esc(nomes[e.fornecedor] || "código " + e.fornecedor) : "") + situacaoAcerto(acertoDo(e)) + '<span class="av-nome-s">Declarado: é o que foi informado, não prova.</span></li>';
    });
    var acId = {}; AC.forEach(function (a) { acId[a.acerto_id] = a; });
    V.forEach(function (v) {
      L.push("<li><b>Acerto do ciclo ligado a esta nota</b> " + (v.automatico ? "automático (vínculo inequívoco)" : "por " + AV.esc(v.autor_nome || "—")) + " em " + AV.dataHora(v.criado_em) +
        " · " + AV.esc((AV.produtos[v.id_produto] || {}).nome || "produto " + v.id_produto) + ", quantidade " + AV.qtd(v.quantidade) + (v.desfeito ? " · <b>desfeito</b>" : "") + (v.a_reconferir ? " · a reconferir" : "") +
        (v.aviso_quantidade_mudou ? " · a quantidade da nota mudou depois" : "") + (v.conflito_texto_vr ? ' · <span class="av-semc">o texto do VR contradiz o acerto</span>' : "") +
        (acId[v.acerto_id] ? '<span class="av-nome-s">acerto ' + quemRegistrou(acId[v.acerto_id]) + "</span>" + situacaoAcerto(acId[v.acerto_id]) : "") + "</li>");
    });
    h += L.length ? '<ul class="av-pend-painel">' + L.join("") + "</ul>" : '<p class="avr-vazio">Nenhum registro do Painel feito diretamente nesta nota.</p>';
    if (P.length) h += '<h4 class="av-pend-h4b">Acertos que podem ser desta saída <span class="av-quem">' + plural(P.length, "par pendente", "pares pendentes") + " de conferência</span></h4>" +
      '<p class="av-sub">Existe acerto registrado no Painel possivelmente relacionado a uma saída desta nota. O sistema não liga sozinho quando alguma condição falha.</p>' +
      tabelaPares(P, { acertos: AC, nomes: nomes, filaB: [], filaC: [] }, { naNota: true });
    return h + "</div>";
  }

  function blocoTitulos(T) {
    var h = '<div class="av-card" data-av-bloco="titulos"><h3>Títulos no VR</h3>';
    if (!T.length) return h + '<p class="avr-vazio">Esta nota não tem título no VR.</p></div>';
    return h + tabela([
      { t: "Título", cls: "l", cel: "principal", v: function (x) { return '<span class="av-nome">' + AV.esc(x.numero || x.titulo_id) + "</span>"; } },
      { t: "Emissão", v: function (x) { return AV.dataCurta(x.emissao); } },
      { t: "Vencimento", v: function (x) { return AV.dataCurta(x.vencimento); } },
      { t: "Valor", v: function (x) { return AV.rs(x.valor) + (AV.n(x.abatimento) > 0.004 ? '<span class="av-nome-s">abatimento ' + AV.rs(x.abatimento) + "</span>" : ""); } },
      { t: "Situação", cls: "l", v: function (x) { return situacaoTitulo(x.situacao); } }
    ], T) + '<p class="av-k-nota">Título em aberto no VR não prova dívida. Só o VR baixa título.</p></div>';
  }

  // provas por FONTE, separadas e nunca somadas; vários documentos para a mesma nota vão para conferência
  function blocoProvas(n, P, nomes) {
    var h = '<div class="av-card" data-av-bloco="provas"><h3>Provas no VR, por fonte</h3><p class="av-sub">Cada fonte aparece separada. Os valores de fontes diferentes nunca se somam. ' +
      "Quando um documento cita esta nota com um valor, vale o valor citado; o total do documento e a diferença aparecem só como informação.</p>";
    if (!P.length) return h + '<p class="avr-vazio">Nenhum documento do VR cita esta nota.</p></div>';
    if (n.documento) h += '<p class="av-pend-lido">Documentos (fora o boleto): <b>' + AV.esc(RES_DOC[n.documento] || "não somam") + "</b>" + (n.documento_motivo ? " — " + AV.esc(semCodigo(n.documento_motivo, n)) : "") + "</p>";
    if (n.boleto) h += '<p class="av-pend-lido">Boleto: <b>' + AV.esc(CASO_BOLETO[n.boleto] || semCodigo(n.boleto, n)) + "</b></p>";
    var docs = {}; P.forEach(function (p) { if (p.fonte !== "boleto" && !p.nao_serve) docs[p.ref] = 1; });
    var nd = Object.keys(docs).length;
    if (nd > 1) h += AV.aviso("am", AV.int(nd) + " documentos citam esta nota: vai para conferência e os valores não se somam.<span class=\"av-nome-s\">" +
      Object.keys(docs).map(function (r) { return AV.esc(nomeDoc(r)); }).join(" · ") + "</span>");
    ORDEM_FONTES.forEach(function (f) {
      var L = P.filter(function (p) { return p.fonte === f; }); if (!L.length) return;
      h += '<div class="av-pend-fonte" data-av-fonte="' + f + '"><h4>' + FONTES[f] + ' <span class="av-quem">' + plural(L.length, "registro", "registros") + "</span></h4>";
      L.forEach(function (p) { h += f === "boleto" ? provaBoleto(p) : provaDoc(p, nomes); });
      h += "</div>";
    });
    var outras = P.filter(function (p) { return ORDEM_FONTES.indexOf(p.fonte) < 0; });
    if (outras.length) h += '<div class="av-pend-fonte"><h4>Outras fontes</h4>' + outras.map(function (p) { return provaDoc(p, nomes); }).join("") + "</div>";
    return h + "</div>";
  }
  // o documento pelo nome de gente (tipo, número e data do VR), nunca pelo código interno da cópia
  function tituloProva(p) { var x = docsIdx[p.ref]; return "<b>" + AV.esc(nomeDoc(p.ref)) + "</b>" + (!x && p.data ? " · " + AV.dataCurta(p.data) : ""); }
  function provaBoleto(p) {
    var x = docsIdx[p.ref];
    return '<div class="av-pend-prova"><p>' + tituloProva(p) + " · " + AV.esc(CASO_BOLETO[p.caso_boleto] || semCodigo(p.caso_boleto) || "—") +
      (p.caso_boleto === "ambiguo" && p.motivo ? " (" + AV.esc(semCodigo(p.motivo)) + ")" : "") + "</p>" +
      '<p class="av-quem">' + (x && AV.tem(x.valor_total) ? "valor da parcela " + AV.rs(x.valor_total) + " · " : "") + (AV.n(p.abatimento) > 0.004 ? "desconto de " + AV.rs(p.abatimento) + " na parcela · " : "") +
      "valor da nota " + AV.rs(p.valor_nota) +
      (p.parcela_situacao === null || p.parcela_situacao === undefined ? "" : +p.parcela_situacao === 0 ? " · parcela ainda aberta no VR, vence em " + AV.dataCurta(p.parcela_vencimento) : " · parcela baixada no VR (vencimento " + AV.dataCurta(p.parcela_vencimento) + ")") + "</p>" +
      (p.texto ? '<div class="av-texto-vr">' + AV.esc(p.texto) + "</div>" : "") + "</div>";
  }
  // valor citado × total do documento e a diferença (opção A: vale o citado; a diferença fica à vista, como informação)
  function valoresDoc(p) {
    var x = docsIdx[p.ref], tot = x && AV.tem(x.valor_total) ? AV.n(x.valor_total) : null, compra = p.fonte === "compra_texto";
    if (!AV.tem(p.valor_citado)) return "cita a nota sem valor individual" + (tot !== null ? " · total do documento " + AV.rs(tot) : "");
    var h = "valor citado para esta nota: <b>" + AV.rs(p.valor_citado) + "</b>";
    if (tot === null) return h + " · total do documento não está nas cópias do VR";
    if (compra) return h + " · total da nota de compra " + AV.rs(tot) + " (é o valor da compra, não do acerto)";
    var dif = Math.round((tot - AV.n(p.valor_citado)) * 100) / 100;
    return h + " · total do documento " + AV.rs(tot) + (Math.abs(dif) < 0.005 ? " · sem diferença"
      : ' · <span class="av-pend-dif">diferença de ' + AV.rs(Math.abs(dif)) + " (o total do documento é " + (dif > 0 ? "maior" : "menor") + " que o valor citado)</span>");
  }
  function provaDoc(p, nomes) {
    return '<div class="av-pend-prova' + (p.nao_serve ? " av-pend-naoserve" : "") + '"><p>' + tituloProva(p) +
      (p.fornecedor !== null && p.fornecedor !== undefined ? " · " + AV.esc(nomes[p.fornecedor] || "fornecedor " + p.fornecedor) : "") +
      (p.nao_serve ? " " + AV.chip("não serve", "", p.nao_serve) : "") + "</p>" +
      '<p class="av-quem">' + valoresDoc(p) + " · valor da nota " + AV.rs(p.valor_nota) +
      (p.nao_serve ? " · não serve: " + AV.esc(p.nao_serve) : "") + (p.motivo ? " · " + AV.esc(semCodigo(p.motivo)) : "") + "</p>" +
      (p.texto ? '<div class="av-texto-vr">' + AV.esc(p.texto) + "</div>" : "") + "</div>";
  }

  function blocoItens(I, opc) {
    var h = '<div class="av-card" data-av-bloco="itens"><h3>Itens da nota</h3><p class="av-sub">' + plural(I.length, "produto", "produtos") + (AV.abrirProduto ? ". Toque num item para abrir a ficha do produto." : ".") + "</p>";
    if (!I.length) return h + '<p class="avr-vazio">A nota não tem itens nas cópias do VR.</p></div>';
    return h + tabela([
      { t: "Produto", cls: "l", cel: "principal", v: function (x) { return '<span class="av-nome">' + AV.esc(x.nome || "produto " + x.id_produto) + '</span><span class="av-nome-s">' + AV.esc(AV.nomeSetor(x.setor_id)) + " · código " + x.id_produto + "</span>"; } },
      { t: "Quantidade", v: function (x) { return AV.qtd(x.qtd); } },
      { t: "Valor", v: function (x) { return AV.rs(x.valor_total); } }
    ], I, { classe: "av-pend-tab-itens", linha: AV.abrirProduto ? function (x) { return linhaClicavel(x.id_produto, "Abrir a ficha do produto"); } : null }) + "</div>";
  }
})();
