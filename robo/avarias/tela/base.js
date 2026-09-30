/* ==AV-BASE== AVARIAS — peças comuns da tela (formatos, períodos, filtros, rótulos, tabela, gaveta).
   SOMENTE LEITURA: nada aqui grava. Tudo começa por "av" (a raiz tem a classe .av) para não mexer em outras telas.
   Textos em português, com os nomes aprovados: "custo da data", "custo estimado", "sem custo conhecido",
   "Em aberto no VR", "Quantidade ainda sem acerto informado". Comprovado NUNCA é "recuperado"; idade só em faixas. */
(function () {
  "use strict";
  var AV = window.AV = window.AV || {};

  // ---------- formatos ----------
  var f2 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var f0 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
  var f3 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });
  var f1 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  AV.n = function (v) { return v === null || v === undefined || v === "" ? 0 : +v; };
  AV.tem = function (v) { return v !== null && v !== undefined && v !== "" && isFinite(+v); };
  AV.rs = function (v) { var x = AV.n(v); return (x < -0.004 ? "−R$ " : "R$ ") + f2.format(Math.abs(x) < 0.005 ? 0 : Math.abs(x)); };
  AV.rs0 = function (v) { var x = AV.n(v); return (x < -0.5 ? "−R$ " : "R$ ") + f0.format(Math.abs(x)); };
  AV.int = function (v) { return f0.format(AV.n(v)); };
  AV.qtd = function (v) { var x = AV.n(v); return (x < 0 ? "−" : "") + f3.format(Math.abs(x)); };
  AV.pct = function (v) { return AV.tem(v) ? f1.format(+v) + "%" : "—"; };
  AV.esc = function (s) { return String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  AV.data = function (s) { if (!s) return "—"; s = String(s); return s.slice(8, 10) + "/" + s.slice(5, 7) + "/" + s.slice(0, 4); };
  AV.dataCurta = function (s) { if (!s) return "—"; s = String(s); return s.slice(8, 10) + "/" + s.slice(5, 7) + "/" + s.slice(2, 4); };
  AV.hora = function (s) { if (!s) return "—"; var d = new Date(s); return ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2); };
  AV.dataHora = function (s) { if (!s) return "—"; var d = new Date(s); return AV.dataCurta(AV.iso(d)) + " " + AV.hora(s); };
  AV.iso = function (d) { return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); };
  AV.hoje = function () { return AV.iso(new Date()); };            // dia de Caicó (a máquina da loja está no fuso da loja)
  AV.dias = function (a, b) { return Math.round((new Date(b + "T12:00:00") - new Date(a + "T12:00:00")) / 864e5); };
  var MES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  var MESC = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  AV.mesNome = function (m) { return MES[+m.slice(5, 7) - 1] + "/" + m.slice(0, 4); };
  AV.mesCurto = function (m) { return MESC[+m.slice(5, 7) - 1] + "/" + m.slice(2, 4); };
  AV.mesSomar = function (m, k) { var a = +m.slice(0, 4), b = +m.slice(5, 7) - 1 + k; a += Math.floor(b / 12); b = ((b % 12) + 12) % 12; return a + "-" + ("0" + (b + 1)).slice(-2); };
  AV.soma = function (L, f) { var s = 0; for (var i = 0; i < L.length; i++) s += AV.n(f(L[i])); return s; };

  // ---------- nomes ----------
  var SETORES = { "ACOUGUE": "Açougue", "HORTFRUTI": "Hortifrúti", "HORTIFRUTI": "Hortifrúti", "MERCEARIA": "Mercearia",
    "MERCEARIA SECA": "Mercearia seca", "FRIOS": "Frios", "PERFUMARIA": "Perfumaria", "PADARIA": "Padaria", "CONGELADO": "Congelado",
    "LIMPEZA": "Limpeza", "BEBIDAS": "Bebidas", "BAZAR": "Bazar", "PET SHOP": "Pet shop", "SAUDABILIDADE": "Saudabilidade",
    "DESPESA": "Despesa", "A ACERTAR": "A acertar" };
  AV.nomeSetorVR = function (vr) { var k = String(vr || "").toUpperCase().replace(/^NOVO\s*-?\s*/, "").trim(); return SETORES[k] || (k ? k.charAt(0) + k.slice(1).toLowerCase() : "Sem setor"); };
  AV.setores = {};                                                  // setor_id → nome (preenchido pela leitura de produtos)
  AV.nomeSetor = function (id) { return AV.setores[id] || (id ? "Setor " + id : "Sem setor"); };
  AV.motivos = {};
  var MOTIVO_CURTO = { 1: "Embalagem danificada", 2: "Vencido", 3: "Estragado", 8: "Impróprio para consumo", 12: "Avaria",
    4: "Erro ao coletar", 5: "Erro ao coletar", 6: "Erro de balanço", 7: "Nota especificada fornecedor", 9: "Direcionado para ação",
    10: "Degustação", 11: "Recolhimento de produto" };
  AV.nomeMotivo = function (m) { return MOTIVO_CURTO[m] || (AV.motivos[m] ? AV.motivos[m].charAt(0) + AV.motivos[m].slice(1).toLowerCase() : "Sem motivo"); };
  AV.MOTIVOS_AVARIA = [1, 2, 3, 8, 12];
  AV.nomeClasse = function (c, m) {
    return c === "avaria" ? AV.nomeMotivo(m) : c === "erro" ? "Erro operacional" : c === "outros" ? "Outros processos"
      : c === "balanco" ? "Balanço de 18/07/2024" : c === "retorno" ? "Retorno" : c === "sem_motivo" ? "Sem motivo" : "—";
  };
  AV.GRUPOS = [
    { id: "acerto_fornecedor", nome: "Acerto com fornecedor" },
    { id: "assumido", nome: "Assumido pela loja" },
    { id: "voltou_loja", nome: "Voltou para a loja" },
    { id: "balanco_erro", nome: "Balanço e erro" },
    { id: "nao_identificado", nome: "Destino não identificado" }
  ];
  AV.nomeGrupo = function (g) { for (var i = 0; i < AV.GRUPOS.length; i++) if (AV.GRUPOS[i].id === g) return AV.GRUPOS[i].nome; return g; };
  AV.nomeDestino = function (d) {
    return { exportada_perda: "exportada para perda", devolucao_troca: "devolução troca", devolucao_sem_financeiro: "devolução sem financeiro",
      devolucao_financeiro: "devolução com financeiro", voltou_loja: "voltou para a loja", baixa_perda: "nota de baixa por perda",
      balanco: "balanço", erro_ajuste: "erro de coleta devolvido à loja", nao_identificado: "destino não identificado",
      outra_nota: "outra nota" }[d] || (d ? String(d).replace(/_/g, " ") : "—");
  };
  // os níveis de evidência aprovados (calculados; nunca clicados). "em parte" = a nota tem partes com níveis diferentes.
  var NIVEIS = {
    comprovado: ["Comprovado", "av-n-comp"], comprovado_parcial: ["Comprovado em parte", "av-n-comp av-n-parte"],
    declarado: ["Declarado", "av-n-decl"], declarado_parcial: ["Declarado em parte", "av-n-decl av-n-parte"],
    em_aberto_vr: ["Em aberto no VR", "av-n-aberto"], nao_identificado: ["Não identificado", "av-n-nid"],
    assumido: ["Assumido pela loja", "av-n-assum"], assumido_parcial: ["Assumido em parte", "av-n-assum av-n-parte"],
    sem_acerto_a_fazer: ["Sem acerto a fazer", "av-n-sem"]
  };
  AV.nomeNivel = function (n) { return (NIVEIS[n] || [n || "—"])[0]; };
  AV.nivel = function (n) { var x = NIVEIS[n] || [n || "—", "av-n-nid"]; return '<span class="av-pill ' + x[1] + '">' + AV.esc(x[0]) + "</span>"; };
  AV.faixas = ["0-30", "31-60", "61-90", "91-180", "181-365", "365+"];
  AV.nomeFaixa = function (f) { return f === "365+" ? "mais de 365 dias" : f === "a vencer" ? "a vencer" : f ? f.replace("-", " a ") + " dias" : "—"; };

  // ---------- plural certo: "1 ocorrência", "3 ocorrências", "0 casos" ----------
  // AV.plural(n, "caso", "casos") → "3 casos" (com o número, no formato brasileiro).
  // Só a palavra, sem o número: AV.plural(n, "saiu", "saíram", { soPalavra: true }) → "saíram".
  AV.plural = function (n, singular, plural, opc) {
    var x = AV.n(n), palavra = Math.abs(x) === 1 ? singular : plural;
    if (opc && opc.soPalavra) return palavra;
    return (Math.round(x) === x ? AV.int(x) : AV.qtd(x)) + " " + palavra;
  };

  // ---------- forma do acerto (como o fornecedor acertou), em texto de gente. Devolve texto puro (escape ao usar). ----------
  var FORMAS = { bonificacao: "bonificação", desconto_boleto: "desconto no boleto", pix_deposito: "Pix ou depósito",
    troca_mercadoria: "troca por mercadoria", dinheiro: "dinheiro", verba: "verba", outro: "outro", devolucao: "devolução" };
  AV.nomeForma = function (f) {
    if (f === null || f === undefined || f === "") return "não informada";
    return FORMAS[f] || String(f).replace(/_/g, " ");
  };

  // ---------- documento do VR pelo nome de gente (nunca o código interno da cópia) ----------
  // doc = uma linha de "documentos" {ref, tipo, numero, data, fornecedor, valor_total}
  //   → "nota de bonificação nº 123456 de 01/01/26". Texto puro (escape ao usar).
  // o VR guarda alguns nomes sem acento ("verba de rebaixa de preco"): as palavras conhecidas voltam acentuadas
  var ACENTOS = { preco: "preço", precos: "preços", acao: "ação", promocao: "promoção", aniversario: "aniversário",
    inauguracao: "inauguração", bonificacao: "bonificação", devolucao: "devolução", negociacao: "negociação", reposicao: "reposição" };
  AV.nomeDocumento = function (doc) {
    if (!doc) return "documento do VR";
    var t = String(doc.tipo || "documento do VR").trim().replace(/[a-z]+/g, function (w) { return ACENTOS[w] || w; });
    if (doc.numero !== null && doc.numero !== undefined && doc.numero !== "") t += " nº " + String(doc.numero).trim();
    if (doc.data) t += " de " + AV.dataCurta(doc.data);
    return t;
  };
})();

(function () {
  "use strict";
  var AV = window.AV;

  // ---------- períodos (mês atual é parcial; 2023 começa em 19/10, quando o livro do VR começa) ----------
  AV.PRIMEIRO_MES = "2023-10";
  AV.periodos = function () {
    var hoje = AV.hoje(), atual = hoje.slice(0, 7), dia = hoje.slice(8, 10) + "/" + hoje.slice(5, 7), L = [];
    L.push({ id: "mes:" + atual, rotulo: "Mês atual · " + AV.mesNome(atual) + " (parcial até " + dia + ")", meses: [atual], parcial: true, grupo: "Mês" });
    for (var m = AV.mesSomar(atual, -1); m >= AV.PRIMEIRO_MES; m = AV.mesSomar(m, -1))
      L.push({ id: "mes:" + m, rotulo: AV.mesNome(m).charAt(0).toUpperCase() + AV.mesNome(m).slice(1) + (m === AV.PRIMEIRO_MES ? " (desde 19/10)" : ""), meses: [m], parcial: m === AV.PRIMEIRO_MES, grupo: "Mês" });
    var faixa = function (k) { var r = []; for (var i = k - 1; i >= 0; i--) r.push(AV.mesSomar(atual, -i)); return r; };
    L.push({ id: "ult3", rotulo: "Últimos 3 meses (" + AV.mesCurto(AV.mesSomar(atual, -2)) + " a " + AV.mesCurto(atual) + ", parcial até " + dia + ")", meses: faixa(3), parcial: true, grupo: "Vários meses" });
    L.push({ id: "ult12", rotulo: "Últimos 12 meses (" + AV.mesCurto(AV.mesSomar(atual, -11)) + " a " + AV.mesCurto(atual) + ", parcial até " + dia + ")", meses: faixa(12), parcial: true, grupo: "Vários meses" });
    for (var a = +atual.slice(0, 4); a >= +AV.PRIMEIRO_MES.slice(0, 4); a--) {
      // o ano inteiro: as notas e os títulos existem desde 04/2023; o livro da troca do VR só começa em 19/10/2023
      var ms = []; for (var k = 1; k <= 12; k++) { var mm = a + "-" + ("0" + k).slice(-2); if (mm <= atual) ms.push(mm); }
      L.push({ id: "ano:" + a, rotulo: a + (a === +atual.slice(0, 4) ? " (até " + dia + ")" : a === +AV.PRIMEIRO_MES.slice(0, 4) ? " (a troca só desde 19/10)" : ""), meses: ms, parcial: a === +atual.slice(0, 4) || a === +AV.PRIMEIRO_MES.slice(0, 4), grupo: "Ano" });
    }
    return L;
  };
  AV.periodo = function (id) { var L = AV.periodos(); for (var i = 0; i < L.length; i++) if (L[i].id === id) return L[i]; return L[0]; };
  // período anterior de mesmo tamanho (para "evolução")
  AV.periodoAnterior = function (p) { var k = p.meses.length; return p.meses.map(function (m) { return AV.mesSomar(m, -k); }); };

  // ---------- estado (o que a pessoa escolheu; vale para as quatro áreas) ----------
  AV.estado = { area: "resumo", periodo: null, setor: "", motivo: "", fila: "A" };

  // ---------- valor com a fonte do custo à vista (nenhum total esconde estimado; sem custo nunca vira zero) ----------
  // As partes mostradas somam EXATAMENTE o total mostrado: a conta é feita em centavos inteiros — o total e o estimado
  // são arredondados, e a parte pelo custo da data é a diferença dos dois (arredondando cada parte sozinha, o cartão
  // mostrava R$ 4.700,29 = R$ 4.696,73 + R$ 3,55, que dá 4.700,28).
  // Devolve também, já em reais arredondados: .mostrado (o total na tela), .data e .estimado (as partes na tela).
  AV.valorFonte = function (vData, vEst, semCusto, opc) {
    opc = opc || {};
    var t = AV.n(vData) + AV.n(vEst), partes = [];
    var tc = Math.round(t * 100), ec = Math.round(AV.n(vEst) * 100), dc = tc - ec;
    if (AV.n(vEst) > 0.004) partes.push(AV.rs(dc / 100) + " pelo custo da data", '<span class="av-est" title="Custo de hoje, usado só onde o VR não tem histórico de custo para a data">' + AV.rs(ec / 100) + " custo estimado</span>");
    if (AV.n(semCusto) > 0) partes.push('<span class="av-semc">+ ' + AV.int(semCusto) + " " + (opc.unidade || (AV.n(semCusto) === 1 ? "ocorrência" : "ocorrências")) + " sem custo conhecido</span>");
    return { total: t, mostrado: tc / 100, data: dc / 100, estimado: ec / 100,
      html: '<span class="av-v' + (opc.classe ? " " + opc.classe : "") + '">' + AV.rs(tc / 100) + "</span>",
      comp: partes.length ? '<span class="av-comp">' + partes.join(" · ") + "</span>" : (opc.sempre ? '<span class="av-comp">todo pelo custo da data</span>' : "") };
  };
  AV.marcaEst = function (vEst) { return AV.n(vEst) > 0.004 ? ' <span class="av-chip av-chip-est" title="Inclui ' + AV.esc(AV.rs(vEst)) + ' pelo custo estimado (custo de hoje)">inclui estimado</span>' : ""; };

  // ---------- tabela que vira cartões no celular (cada campo leva o seu rótulo) ----------
  // cols: [{t:"Título", cls:"l|n", v:function(linha){return html}, cel:"principal|oculta"}]
  AV.tabela = function (cols, linhas, opc) {
    opc = opc || {};
    if (!linhas.length) return '<p class="avr-vazio">' + (opc.vazio || "Nada aqui.") + "</p>";
    var h = '<div class="av-tw"><table class="av-tab' + (opc.classe ? " " + opc.classe : "") + '"><thead><tr>';
    cols.forEach(function (c) { h += '<th class="' + (c.cls || "") + '"' + (c.dica ? ' title="' + AV.esc(c.dica) + '"' : "") + ">" + c.t + "</th>"; });
    h += "</tr></thead><tbody>";
    linhas.forEach(function (l, i) {
      var at = opc.linha ? opc.linha(l, i) : "";
      h += "<tr" + (at ? " " + at : "") + ">";
      cols.forEach(function (c) { h += '<td class="' + (c.cls || "") + (c.cel ? " av-cel-" + c.cel : "") + '" data-rot="' + AV.esc(c.rot || c.t.replace(/<[^>]+>/g, "")) + '">' + c.v(l, i) + "</td>"; });
      h += "</tr>";
    });
    h += "</tbody>" + (opc.rodape ? "<tfoot>" + opc.rodape + "</tfoot>" : "") + "</table></div>";
    return h;
  };

  // ---------- gaveta (ficha do produto, detalhe da nota): painel lateral; no celular ocupa a tela ----------
  var ultimoFoco = null;
  AV.gaveta = function (titulo, sub, corpo) {
    AV.fecharGaveta(true);
    ultimoFoco = document.activeElement;
    var d = document.createElement("div");
    d.className = "av av-fundo"; d.id = "avrGaveta";
    d.innerHTML = '<div class="avr-gav" role="dialog" aria-modal="true" aria-labelledby="avrGavT"><div class="avr-gav-topo"><div><h3 id="avrGavT">' + titulo + "</h3>" +
      (sub ? '<p class="av-sub">' + sub + "</p>" : "") + '</div><button class="av-bt" data-av="fechar" type="button">Fechar</button></div><div class="avr-gav-corpo">' + corpo + "</div></div>";
    document.body.appendChild(d);
    document.documentElement.classList.add("av-com-gaveta");
    d.addEventListener("click", function (e) { if (e.target === d) AV.fecharGaveta(); });
    var bt = d.querySelector("[data-av=fechar]"); bt.addEventListener("click", function () { AV.fecharGaveta(); }); bt.focus();
    return d.querySelector(".avr-gav-corpo");
  };
  AV.fecharGaveta = function (semFoco) {
    var d = document.getElementById("avrGaveta"); if (!d) return;
    d.parentNode.removeChild(d); document.documentElement.classList.remove("av-com-gaveta");
    if (!semFoco && ultimoFoco && ultimoFoco.focus) try { ultimoFoco.focus(); } catch (e) {}
  };
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") AV.fecharGaveta(); });

  // ---------- pequenas peças ----------
  AV.aviso = function (tipo, html) { return '<div class="av-aviso av-aviso-' + tipo + '">' + html + "</div>"; };
  AV.chip = function (txt, cls, dica) { return '<span class="av-chip ' + (cls || "") + '"' + (dica ? ' title="' + AV.esc(dica) + '"' : "") + ">" + txt + "</span>"; };
  AV.carregando = function (el, txt) { el.innerHTML = '<div class="av-card av-carr"><p>' + (txt || "Carregando…") + "</p></div>"; };
  // O motivo da falha, sempre em português. Só a mensagem escrita pela própria tela (e.daTela, ou um texto) aparece como
  // veio; a da nuvem ou do navegador ("TypeError: Load failed", "permission denied…", "JWT expired") nunca vai para a tela:
  // vira uma frase para o dono, e o texto técnico fica só no console, para conferência.
  AV.motivoFalha = function (e) {
    if (typeof e === "string") return e;
    if (e && e.daTela) return String(e.message || "");
    var m = String((e && e.message) || e || ""), cod = String((e && (e.codigo || e.code)) || "");
    if (window.console) console.warn("Avarias: falha ao carregar:", e);
    if (/failed to fetch|load failed|networkerror|network request failed|fetch failed|timed? ?out|offline/i.test(m)) return "Sem conexão com a nuvem: confira a internet do aparelho.";
    if (cod === "42501" || cod === "PGRST301" || /permission denied|jwt expired|invalid jwt/i.test(m)) return "A sessão expirou ou o acesso mudou: saia e entre de novo no Painel.";
    return "Erro inesperado na tela (o detalhe ficou registrado para conferência).";
  };
  AV.falhou = function (el, e) {
    el.innerHTML = '<div class="av-card"><h3>Não deu para carregar agora</h3><p class="av-sub">Tente de novo em instantes.</p><p class="av-apagado">' + AV.esc(AV.motivoFalha(e).slice(0, 200)) + "</p></div>";
  };
})();
