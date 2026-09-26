/* ==ENC-TELA== PLANEJAMENTO DE ENCARTES — a tela (menu "Encartes").
   Desenha a FILA (cartões por edição e por grupo com prazo próprio), a EDIÇÃO (grupos, vagas,
   histórico, aprovado × atual), a VAGA (propostas lado a lado) e os MODELOS. Não fala com o
   banco: recebe de ==ENC-PAINEL== um "api" com os dados e as ações (encTela.montar(raiz, api)).
   Toda conta de data, prazo, situação e margem vem do cálculo (window.ENC, ==ENC-CALC==):
   a tela não refaz conta nenhuma por conta própria, só mostra.
   Regras que valem em todo este arquivo:
     - a escolha da proposta é SEMPRE de uma pessoa, num botão; a tela não dá nota nem ordena
       "a melhor" (decisão D8): mostra lado a lado e faz só as contas;
     - custo de hoje (VR) e custo negociado nunca se substituem: os dois aparecem;
     - branco não é zero: campo vazio vai nulo, e custo ausente é "Sem custo no VR";
     - quem pode o quê é conferido de novo pelo banco (as funções recusam); aqui só se
       esconde o botão de quem não pode, para ninguém clicar à toa. */
(function () {
  var E = window.ENC;
  var A = null;            // o "api" que o painel.js entrega
  var RAIZ = null;         // #encRaiz
  var R = { tela: "fila" }; // rota atual: fila | edicao | vaga | modelos | modelo
  var PREF = { filtro: "todos", minhas: false };
  var FV = "todas";        // filtro das vagas dentro da edição
  var ABA = "vagas";       // aba da edição: vagas | historico | aprovado
  var JAN = null;          // janela (diálogo) aberta
  var AVISO = null;        // aviso que sobrevive a um redesenho: {tipo, txt, edicao?}
  var MOD = null;          // modelo em edição (cópia de trabalho)
  var ESCOLHENDO = false;  // uma escolha de proposta por vez

  // Preferência do filtro da fila (só preferência de tela; nunca dado de negócio).
  try { var _p = JSON.parse(localStorage.getItem("enc_pref_fila") || "null"); if (_p && typeof _p === "object") { PREF.filtro = _p.filtro || "todos"; PREF.minhas = !!_p.minhas; } } catch (e) {}
  function guardarPref() { try { localStorage.setItem("enc_pref_fila", JSON.stringify(PREF)); } catch (e) {} }

  /* ======================= FORMATOS ======================= */
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function tem(v) { return E.tem(v); }
  function n(v) { return tem(v) ? +v : null; }
  function brl(v, casas) {
    if (!tem(v)) return "—";
    var x = +v, c = casas || 2;
    var t = Math.abs(x).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: c });
    return (x < 0 ? "−" : "") + "R$ " + t;
  }
  function brlS(v) { if (!tem(v)) return "—"; return (+v > 0 ? "+" : +v < 0 ? "−" : "") + "R$ " + Math.abs(+v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function pct(v) { if (!tem(v)) return "—"; return (+v < 0 ? "−" : "") + Math.abs(+v).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%"; }
  function pctS(v) { if (!tem(v)) return "—"; return (+v > 0 ? "+" : +v < 0 ? "−" : "") + Math.abs(+v).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%"; }
  function milhar(v) { return tem(v) ? (+v).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) : "—"; }
  function dm(iso) { return E.fmtData(iso, { curta: true }); }
  function dsem(iso) { return E.fmtData(iso, { curta: true, semana: true }); }
  function dmy(iso) { return E.fmtData(iso); }
  function periodo(ini, fim) { if (!ini) return ""; return !fim || ini === fim ? dsem(ini) : dsem(ini) + " a " + dsem(fim); }
  function dias1(k) { return k + (k === 1 ? " dia" : " dias"); }
  function noAr(ini, fim, hoje) {
    var d = E.diasEntre(hoje, ini);
    if (d === null) return "";
    if (d > 0) return "no ar em " + dias1(d);
    if (d === 0) return "entra no ar hoje";
    return fim && fim < hoje ? "encerrada" : "no ar";
  }
  // timestamptz do banco ("2026-10-26 12:40:00.123456+00") → Date local.
  function instante(x) {
    if (!x) return null;
    var s = String(x).trim().replace(" ", "T").replace(/(\.\d{3})\d+/, "$1").replace(/([+-]\d\d)$/, "$1:00");
    var d = new Date(s); return isNaN(d.getTime()) ? null : d;
  }
  function quando(x) {
    var d = instante(x); if (!d) return "";
    function p(k) { return (k < 10 ? "0" : "") + k; }
    return p(d.getDate()) + "/" + p(d.getMonth() + 1) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }
  // Número digitado: "10,50" ou "10.50". Vazio = null (branco não é zero); lixo = NaN.
  // O ponto só é separador de milhar quando também há vírgula ("1.200,50"). Sem vírgula, o
  // ponto é a casa decimal: "9.999" é 9,999 e "10.199" é 10,199 (custo com 3 casas, como a
  // própria tela mostra) — antes viravam 9.999 e 10.199 reais, e o banco aceitava calado.
  function lerNum(t) {
    var s = String(t == null ? "" : t).trim().replace(/\s/g, "");
    if (s === "") return null;
    if (s.indexOf(",") >= 0) {
      if (s.indexOf(".") >= 0 && !/^-?\d{1,3}(\.\d{3})+,\d+$/.test(s)) return NaN; // ponto e vírgula só no formato "1.200,50"
      s = s.replace(/\./g, "").replace(",", ".");
    }
    return /^-?\d+(\.\d+)?$/.test(s) ? +s : NaN;
  }
  function numCampo(v) { return tem(v) ? String(+v).replace(".", ",") : ""; }
  function slug(t) {
    return String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "grupo";
  }
  function clonar(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
  function objeto(v) { if (v && typeof v === "object") return v; if (typeof v === "string" && v) { try { return JSON.parse(v); } catch (e) { return null; } } return null; }

  var CATEGORIAS_AJUSTE = [["preco", "Preço"], ["produto", "Produto"], ["margem_verba", "Margem/verba"], ["estoque", "Estoque"], ["fornecedor", "Fornecedor"], ["outro", "Outro"]];
  function nomeCategoria(k) { for (var i = 0; i < CATEGORIAS_AJUSTE.length; i++) if (CATEGORIAS_AJUSTE[i][0] === k) return CATEGORIAS_AJUSTE[i][1]; return k || ""; }
  var RAZOES = { produto_trocado: "produto trocado", preco_oferta_mudou: "preço de oferta mudou", custo_subiu: "custo negociado subiu",
    verba_reduziu: "verba ou bonificação diminuiu", proposta_descartada: "a proposta escolhida foi descartada",
    preco_subiu: "preço anunciado subiu", preco_apagado: "preço anunciado apagado", produto_retirado: "produto retirado", vaga_retirada: "vaga retirada" };
  function razoesTxt(t) { return String(t || "").split(/\s*,\s*/).filter(Boolean).map(function (k) { k = k.replace(/^vaga_retirada:\s*/, ""); return RAZOES[k] || k; }).join(", "); }

  /* ======================= DADOS AUXILIARES ======================= */
  function D() { return A.dados(); }
  function hoje() { return E.hojeISO(); }
  function regraDe(id) {
    var L = (D() && D().regras) || [];
    for (var i = 0; i < L.length; i++) if (L[i].id === id) return L[i];
    for (i = 0; i < E.REGRAS_PADRAO.length; i++) if (E.REGRAS_PADRAO[i].id === id) return E.REGRAS_PADRAO[i];
    return null;
  }
  function nomeCamp(id) { var r = regraDe(id); return r ? r.nome : id; }
  function corCamp(id) { var r = regraDe(id); return (r && /^#[0-9a-fA-F]{6}$/.test(r.cor || "")) ? r.cor : "#98a4b4"; }
  function modeloDe(id) { var L = (D() && D().modelos) || []; for (var i = 0; i < L.length; i++) if (L[i].id === id) return L[i]; return null; }
  function bolinha(cor, tam) { return '<span class="enc-bolinha" style="background:' + esc(cor) + (tam ? ";width:" + tam + "px;height:" + tam + "px" : "") + '"></span>'; }
  function temPrazoProprio(g) { var p = objeto(g && g.prazos); return !!(p && p.comecar); }
  function ativa(v) { return (v.situacao || "ativa") === "ativa"; }
  function inicioGrupo(g, ed) { return (g && g.inicio) || ed.inicio; }
  function fimGrupo(g, ed) { return (g && g.fim) || ed.fim; }
  /* Vaga devolvida ("Em ajuste") que o comprador ainda NÃO mexeu depois da devolução: o banco
     não a aprova junto com as outras (devolucao.mexida_em só existe depois que ele registra,
     edita ou escolhe proposta — inclusive escolher de novo a mesma; descartar NÃO conta). */
  function esperandoComprador(v) { return v.estado === "em_ajuste" && !(objeto(v.devolucao) || {}).mexida_em; }
  /* Vagas sem aprovação cujo GRUPO já entrou no ar (pelo período do grupo, igual ao banco):
     o Fim de semana só entra na sexta, e até lá a vaga dele está "antes do ar". É o número que
     vai para "Entrou no ar sem aprovação" (contagem.pendentesNoAr do cálculo). */
  function pendentesNoAr(vs, gPorId, ed, h) {
    return vs.filter(function (v) { return ativa(v) && (v.estado || "pendente") !== "aprovada" && h >= inicioGrupo(gPorId[v.grupo_id], ed); }).length;
  }
  function porId(L) { var o = {}; (L || []).forEach(function (x) { o[x.id] = x; }); return o; }
  // Edição juntada: para onde foi (excecao.juntada_em). A outra pode estar fora da fila: aí só o link.
  function juntadaEm(ed) {
    var x = objeto(ed && ed.excecao) || {}, id = x.juntada_em || (x.coincidencia && x.coincidencia.juntada_em);
    if (!id) return null;
    var L = (D() && D().edicoes) || [];
    for (var i = 0; i < L.length; i++) if (L[i].id === id) return { id: id, ed: L[i] };
    return { id: id, ed: null };
  }
  function nomeJuntada(j) { return j && j.ed ? nomeCamp(j.ed.campanha_id) + " · " + E.fmtPeriodo(j.ed.inicio, j.ed.fim, { curta: true }) : "outra edição"; }
  // Categoria do VR gravada na vaga ("20" ou "20.3") → filtro da busca de produto.
  function categoriaVr(v) {
    var m = /^\s*(\d{1,4})(?:\.(\d{1,4}))?/.exec(String((v && v.categoria_vr) || ""));
    return m ? { m1: +m[1], m2: m[2] ? +m[2] : null } : null;
  }

  /* Escopos de uma edição: a edição (vagas dos grupos SEM prazo próprio) e cada grupo COM
     prazo próprio (Terçou hortifrúti, uma ação temática com prazo) — cada um com a sua
     contagem e a sua situação (seção 3 da especificação). */
  function escoposDe(ed, grupos, vagas, props, h) {
    var gs = grupos.filter(function (g) { return g.edicao_id === ed.id && g.situacao !== "removido"; });
    var proprio = {}, lista = [], gPorId = porId(gs);
    gs.forEach(function (g) { if (temPrazoProprio(g)) proprio[g.id] = g; });
    var vEd = vagas.filter(function (v) { return v.edicao_id === ed.id && !proprio[v.grupo_id]; });
    function um(g, vs) {
      var pz = g ? objeto(g.prazos) : objeto(ed.prazos);
      var ini = g ? inicioGrupo(g, ed) : ed.inicio, fim = g ? fimGrupo(g, ed) : ed.fim;
      var c = E.contarVagas(vs, props);
      c.pendentesNoAr = pendentesNoAr(vs, gPorId, ed, h);
      var s = E.situacao({ prazos: pz, inicio: ini, fim: fim, sem_penalidade: ed.sem_penalidade === true }, c, h);
      return { chave: ed.id + (g ? "|" + g.id : ""), ed: ed, grupo: g, vagas: vs, prazos: pz || {}, inicio: ini, fim: fim, contagem: c, sit: s };
    }
    var algumProprio = Object.keys(proprio).length > 0;
    if (vEd.length || !algumProprio) lista.push(um(null, vEd));
    gs.forEach(function (g) { if (proprio[g.id]) lista.push(um(g, vagas.filter(function (v) { return v.grupo_id === g.id; }))); });
    return lista;
  }
  function anterior(s) { return s.semPenalidade && s.rotulo === "Anterior ao processo"; }
  function chipSit(s) {
    var k = anterior(s) ? "anterior" : s.k;
    var ico = { atrasado: "⛔", atencao: "⚠", no_prazo: "✓", futuro: "◷", aprovado: "✓", anterior: "◌" }[k] || "";
    return '<span class="enc-chip enc-st-' + k + '">' + ico + " " + esc(s.rotulo) + "</span>";
  }
  function barra(c) {
    var t = c.total || 0;
    if (!t) return '<div class="enc-barra" role="img" aria-label="sem vagas"></div>';
    function w(k) { return (k / t * 100).toFixed(2) + "%"; }
    return '<div class="enc-barra" role="img" aria-label="' + c.definidas + " definidas, " + c.negociando + " negociando, " + c.aNegociar + ' a negociar">' +
      (c.definidas ? '<i class="enc-d" style="width:' + w(c.definidas) + '"></i>' : "") + (c.negociando ? '<i class="enc-n" style="width:' + w(c.negociando) + '"></i>' : "") + "</div>";
  }
  function legenda(c) {
    return '<div class="enc-leg"><span><i class="enc-q enc-d"></i>' + (c ? c.definidas + " " : "") + "definidas</span><span><i class=\"enc-q enc-n\"></i>" +
      (c ? c.negociando + " " : "") + "negociando</span><span><i class=\"enc-q\"></i>" + (c ? c.aNegociar + " " : "") + "a negociar</span></div>";
  }
  function dadosVr() {
    var ok = D() && D().sync ? D().sync.ultima_ok_em : null;
    var s = E.statusDadosVr(ok);
    if (!s || !s.texto) return '<span class="enc-dadosvr">Dados do VR atualizados às —</span>';
    if (!ok) return '<span class="enc-dadosvr enc-velho">⚠ ' + esc(s.texto) + "</span>";
    return '<span class="enc-dadosvr' + (s.desatualizado ? " enc-velho" : "") + '" title="O robô da loja atualiza a ficha do VR de hora em hora, das 06h às 21h.">' +
      (s.desatualizado ? "⚠ " + esc(s.aviso) + " · " : "") + esc(s.texto) + "</span>";
  }
  function mapaCoincidencias(h) {
    var mapa = {};
    try {
      var oc = E.ocorrenciasCampanhas(D().regras, E.addDias(h, -14), E.addDias(h, 150));
      // Só campanha com modelo de edição ATIVO conta (seção 6: "com edição própria"): uma
      // campanha criada no Calendário sem modelo não tem edição do outro lado para decidir.
      var comEdicao = (D().modelos || []).filter(function (m) { return m.tipo === "edicao" && m.ativo !== false && m.campanha_id; })
        .map(function (m) { return m.campanha_id; });
      E.coincidencias(oc, { regras: D().regras, comEdicao: comEdicao }).forEach(function (c) {
        [c.a, c.b].forEach(function (x) { var k = x.id + "|" + x.inicio_regra; (mapa[k] = mapa[k] || []).push(c); });
      });
    } catch (e) {}
    return mapa;
  }
  function decisaoCoinc(ed) { var x = objeto(ed && ed.excecao); return x && x.coincidencia ? x.coincidencia : null; }
  /* Uma coincidência envolve DUAS ocorrências; a decisão do master fica gravada na edição em que
     ele decidiu. Vale como decidida se qualquer uma das duas edições já tem decisão. */
  function edicaoDaOcorrencia(x) {
    var L = (D() && D().edicoes) || [];
    for (var i = 0; i < L.length; i++) if (L[i].campanha_id === x.id && L[i].inicio_regra === x.inicio_regra) return L[i];
    return null;
  }
  function decisaoDe(c, edAtual) {
    var cand = [edAtual].concat([edicaoDaOcorrencia(c.a), edicaoDaOcorrencia(c.b)]);
    for (var i = 0; i < cand.length; i++) {
      var ed = cand[i]; if (!ed) continue;
      if (edAtual && ed.id !== edAtual.id && !((ed.campanha_id === c.a.id && ed.inicio_regra === c.a.inicio_regra) || (ed.campanha_id === c.b.id && ed.inicio_regra === c.b.inicio_regra))) continue;
      var d = decisaoCoinc(ed); if (d) return { dec: d, ed: ed };
    }
    return null;
  }
  var ACOES_COINC = { manter: "Manter as duas", mover: "Mover esta edição", juntar: "Juntar com outra edição" };

  /* ======================= ESTRUTURA E NAVEGAÇÃO ======================= */
  function estrutura() {
    if (!RAIZ) return null;
    RAIZ.classList.add("enc");
    var t = RAIZ.querySelector(":scope > .enc-tela");
    if (!t) {
      RAIZ.innerHTML = '<div class="enc-tela"></div><div class="enc-camada"></div>';
      t = RAIZ.querySelector(":scope > .enc-tela");
    }
    return t;
  }
  function pinta(html) { var t = estrutura(); if (t) t.innerHTML = html; }
  function subirAoTopo() {
    try { var y = RAIZ.getBoundingClientRect().top; if (y < 0) window.scrollTo(0, window.pageYOffset + y - 72); } catch (e) {}
  }
  function carregando(txt) { pinta('<div class="enc-cartao enc-carregando">' + esc(txt || "Carregando…") + "</div>"); }
  // Erro que vai para a tela: sempre em português (o painel.js traduz o que vem do supabase-js,
  // do PostgREST ou do navegador; o texto do nosso banco passa como veio).
  function erroTxt(e) { return A && A.erroTexto ? A.erroTexto(e) : "Não deu para completar agora. Tente de novo."; }
  function erroTela(txt) { pinta('<div class="enc-cartao"><h3>Planejamento de Encartes</h3><p class="enc-sub">' + esc(txt) + '</p><button class="enc-bt" data-ea="fila">‹ Voltar para a fila</button></div>'); }

  function ir(rota, semRolar) {
    fecharJanela();
    var mudouTela = !R || rota.tela !== R.tela || rota.id !== R.id || rota.vaga !== R.vaga;
    R = rota;
    if (rota.tela !== "edicao" && rota.tela !== "vaga") AVISO = AVISO && AVISO.tela === rota.tela ? AVISO : null;
    desenhar();
    if (mudouTela && !semRolar) subirAoTopo();
  }
  function desenhar() {
    if (!A || !D()) return;
    try {
      if (R.tela === "edicao" || R.tela === "vaga") return comDetalhe(R.id, false);
      if (R.tela === "modelos") return pinta(telaModelos());
      if (R.tela === "modelo") return pinta(telaModelo());
      pinta(telaFila());
    } catch (e) {
      // o texto do navegador ("Cannot read properties…") vai só para o console, nunca para a tela
      erroTela("A tela encontrou um problema ao desenhar. Recarregue a página.");
      if (window.console) console.error(e);
    }
  }
  // Edição e vaga precisam do detalhe (vagas completas, propostas, histórico). Lê se não tem.
  function comDetalhe(id, forcar) {
    var det = A.detalheGuardado(id);
    if (det && !forcar) return pintaDetalhe(det);
    if (!det) carregando("Abrindo a edição…");
    return A.detalhe(id, forcar).then(function (d) {
      if (!R || R.id !== id) return;
      if (!d) return erroTela("Não encontrei esta edição (ou você não tem acesso a ela).");
      pintaDetalhe(d);
    }, function (e) { if (R && R.id === id) erroTela("Não deu para abrir a edição agora. " + erroTxt(e)); });
  }
  function pintaDetalhe(det) {
    try {
      if (R.tela === "vaga") {
        var v = det.vagas.filter(function (x) { return x.id === R.vaga; })[0];
        if (!v) return erroTela("Esta vaga não existe mais nesta edição.");
        pinta(telaVaga(det, v));
        completarFicha(det, v);
      } else pinta(telaEdicao(det));
    } catch (e) {
      erroTela("A tela encontrou um problema ao desenhar. Recarregue a página.");
      if (window.console) console.error(e);
    }
  }
  function recarregarDetalhe(id, depois) {
    return A.detalhe(id, true).then(function (d) {
      if (R && R.id === id && (R.tela === "edicao" || R.tela === "vaga")) { if (d) pintaDetalhe(d); }
      if (depois) depois(d);
      return d;
    }, function () { if (depois) depois(null); });
  }

  /* ======================= FILA ======================= */
  function telaFila() {
    var dd = D(), h = hoje(), coinc = mapaCoincidencias(h);
    var cards = [], encerradas = [], juntadas = [];
    (dd.edicoes || []).forEach(function (ed) {
      if (ed.situacao === "cancelada") return;
      if (ed.situacao === "juntada") { juntadas.push(ed); return; }
      escoposDe(ed, dd.grupos, dd.vagas, dd.propLeves, h).forEach(function (sc) {
        sc.minha = sc.vagas.some(function (v) { return dd.minhas[v.id]; });
        sc.coinc = sc.grupo ? [] : (coinc[ed.campanha_id + "|" + ed.inicio_regra] || []);
        if (sc.fim < h) encerradas.push(sc); else cards.push(sc);
      });
    });
    var virtuais = (dd.futuras || []).map(function (e) {
      return { virtual: true, e: e, inicio: e.inicio, fim: e.fim, comecar: e.prazos.comecar, coinc: coinc[e.campanha_id + "|" + e.inicio_regra] || [] };
    });
    function secao(sc) {
      if (sc.virtual) return "futuro";
      if (anterior(sc.sit)) return "anterior";
      if (sc.sit.noArSemAprovacao || sc.sit.k === "atrasado" || sc.sit.k === "atencao") return "agora";
      return sc.sit.k; // no_prazo | futuro | aprovado
    }
    var todos = cards.concat(virtuais);
    var cont = { todos: 0, atrasado: 0, atencao: 0, no_prazo: 0, futuro: 0, aprovado: 0 };
    todos.forEach(function (sc) {
      if (PREF.minhas && (sc.virtual || !sc.minha)) return;
      cont.todos++;
      var k = sc.virtual ? "futuro" : anterior(sc.sit) ? null : sc.sit.k;
      if (k && cont[k] !== undefined) cont[k]++;
    });
    function passa(sc) {
      if (PREF.minhas && (sc.virtual || !sc.minha)) return false;
      var f = PREF.filtro;
      if (f === "todos") return true;
      if (sc.virtual) return f === "futuro";
      return !anterior(sc.sit) && sc.sit.k === f;
    }
    var grupos = { agora: [], no_prazo: [], futuro: [], aprovado: [], anterior: [] };
    todos.filter(passa).forEach(function (sc) { var s = secao(sc); (grupos[s] || grupos.no_prazo).push(sc); });
    grupos.futuro.sort(function (a, b) { var x = a.virtual ? a.comecar : a.prazos.comecar, y = b.virtual ? b.comecar : b.prazos.comecar; return x < y ? -1 : x > y ? 1 : 0; });
    ["agora", "no_prazo", "aprovado", "anterior"].forEach(function (k) { grupos[k].sort(function (a, b) { return a.inicio < b.inicio ? -1 : a.inicio > b.inicio ? 1 : 0; }); });

    var m = A.master();
    var h1 = '<div class="enc-topo"><div><h2>Planejamento de Encartes</h2><div class="enc-sub">Hoje, ' + esc(dsem(h)) +
      " · o que vai ao ar nas próximas semanas e as campanhas que já precisam começar</div>" + dadosVr() + "</div>" +
      '<div class="enc-acoes"><button class="enc-bt' + (PREF.minhas ? " enc-on" : "") + '" data-ea="minhas" aria-pressed="' + PREF.minhas + '">' + (PREF.minhas ? "✓ " : "") + "Só as minhas</button>" +
      '<button class="enc-bt" data-ea="modelos">Modelos</button>' +
      // Sem botão "Atualizar" (decisão 9): a tela lê a nuvem ao abrir, com guarda de 2 min.
      (m ? '<button class="enc-bt" data-ea="tema">+ Ação temática</button>' : "") + "</div></div>";
    if (AVISO && AVISO.tela === "fila") h1 += '<div class="enc-msg' + (AVISO.tipo ? " enc-" + AVISO.tipo : "") + '">' + esc(AVISO.txt) + "</div>";
    if (dd.avisoCriacao) h1 += '<div class="enc-aviso enc-vermelho"><span>⚠</span><div>' + esc(dd.avisoCriacao) + "</div></div>";
    // Coincidências ainda sem decisão (D7·7): o sistema avisa; quem decide é o master, na edição.
    var pend = [], visto = {};
    cards.concat(virtuais).forEach(function (sc) {
      (sc.coinc || []).forEach(function (c) {
        var edc = sc.virtual ? null : sc.ed;
        if (decisaoDe(c, edc)) return;
        var k = c.texto; if (visto[k]) return; visto[k] = 1;
        pend.push({ c: c, ed: edc, virtual: sc.virtual ? sc.e : null });
      });
    });
    // Só pede decisão do que já dá para decidir (a edição existe); as de mais adiante viram uma linha.
    var jaDa = pend.filter(function (p) { return p.ed; }), adiante = pend.filter(function (p) { return !p.ed; });
    if (jaDa.length || adiante.length) {
      adiante.sort(function (a, b) { return a.virtual.prazos.comecar < b.virtual.prazos.comecar ? -1 : 1; });
      h1 += '<div class="enc-aviso"><span>⚠</span><div>' + (jaDa.length ? "<b>Campanhas que coincidem — o master precisa decidir:</b>" +
        jaDa.map(function (p) { return '<div style="margin-top:4px">' + esc(p.c.texto) + '. <button class="enc-bt-l" data-ea="abrir-ed" data-id="' + esc(p.ed.id) + '">Abrir a edição e decidir</button></div>'; }).join("") : "") +
        (adiante.length ? '<div class="enc-apagado" style="margin-top:' + (jaDa.length ? 6 : 0) + 'px" title="' + esc(adiante.map(function (p) { return p.c.texto; }).join(" · ")) + '">' +
          (adiante.length === 1 ? "Mais 1 coincidência adiante" : "Mais " + adiante.length + " coincidências adiante") +
          ": a decisão fica para quando cada edição nascer (a primeira em " + esc(dm(adiante[0].virtual.prazos.comecar)) + ").</div>" : "") + "</div></div>";
    }
    h1 += '<div class="enc-resumo">' + [["todos", "Todos", ""], ["atrasado", "Atrasados", "atrasado"], ["atencao", "Atenção", "atencao"], ["no_prazo", "No prazo", "no_prazo"], ["futuro", "Começam em breve", "futuro"], ["aprovado", "Aprovados", "aprovado"]]
      .map(function (x) {
        return '<button class="' + (PREF.filtro === x[0] ? "enc-on" : "") + '" data-ea="filtro" data-v="' + x[0] + '">' +
          (x[2] ? '<span class="enc-chip enc-st-' + x[2] + '">' + cont[x[0]] + "</span>" : "<b>" + cont[x[0]] + "</b>") + esc(x[1]) + "</button>";
      }).join("") + "</div>" + legenda(null);

    function bloco(tit, lista, mostrar) {
      if (!lista.length) return "";
      var vis = mostrar ? lista.slice(0, mostrar) : lista, resto = mostrar ? lista.slice(mostrar) : [];
      return '<div class="enc-secao"><h3>' + esc(tit) + " (" + lista.length + ')</h3><div class="enc-grade">' + vis.map(cartao).join("") + "</div>" +
        (resto.length ? '<details class="enc-descartadas" style="margin-top:10px"><summary>Ver as outras ' + resto.length + " (até " + esc(dm(resto[resto.length - 1].virtual ? resto[resto.length - 1].comecar : resto[resto.length - 1].prazos.comecar)) + ")</summary>" +
          resto.map(function (sc) {
            var e = sc.virtual ? sc.e : sc.ed, cmc = sc.virtual ? sc.comecar : sc.prazos.comecar;
            return '<div class="enc-linha-fina" style="margin-top:6px">' + bolinha(corCamp(e.campanha_id)) + "<b>" + esc(nomeCamp(e.campanha_id)) + (sc.grupo ? " · " + esc(sc.grupo.nome) : "") +
              '</b><span class="enc-apagado">' + esc(periodo(sc.inicio, sc.fim)) + '</span><span class="enc-dir enc-chip enc-st-futuro">◷ começa ' + esc(dsem(cmc)) + "</span></div>";
          }).join("") + "</details>" : "") + "</div>";
    }
    // Começam em breve: as 6 mais próximas em cartão; o resto (até 70 dias) numa lista que abre.
    var corpo = bloco("Precisa de você agora", grupos.agora) + bloco("Em andamento, no prazo", grupos.no_prazo) +
      bloco("Começam em breve", grupos.futuro, PREF.filtro === "futuro" ? 0 : 6) + bloco("Aprovados", grupos.aprovado) + bloco("Anteriores ao processo (sem penalidade)", grupos.anterior);
    if (!corpo) corpo = '<div class="enc-cartao enc-carregando">' + (PREF.minhas ? "Você ainda não registrou proposta em nenhuma edição desta lista." : "Nada neste filtro.") + "</div>";
    h1 += corpo;
    // Juntada NÃO é encerrada (pode ser de data futura): seção própria, dizendo para onde foi.
    if (!PREF.minhas && PREF.filtro === "todos" && juntadas.length) {
      h1 += '<div class="enc-secao"><h3>Juntadas a outra edição (' + juntadas.length + ")</h3>" +
        juntadas.sort(function (a, b) { return a.inicio < b.inicio ? -1 : 1; }).map(function (ed) {
          return '<button class="enc-linha-fina" data-ea="abrir-ed" data-id="' + esc(ed.id) + '">' + bolinha(corCamp(ed.campanha_id)) + "<b>" + esc(nomeCamp(ed.campanha_id)) + '</b><span class="enc-apagado">' +
            esc(periodo(ed.inicio, ed.fim)) + '</span><span class="enc-dir enc-chip">Juntada à ' + esc(nomeJuntada(juntadaEm(ed))) + "</span></button>";
        }).join("") + "</div>";
    }
    if (!PREF.minhas && PREF.filtro === "todos" && encerradas.length) {
      h1 += '<div class="enc-secao"><h3>Encerradas nos últimos 14 dias (' + encerradas.length + ")</h3>" +
        encerradas.sort(function (a, b) { return a.inicio > b.inicio ? -1 : 1; }).map(function (sc) {
          return '<button class="enc-linha-fina" data-ea="abrir-ed" data-id="' + esc(sc.ed.id) + '">' + bolinha(corCamp(sc.ed.campanha_id)) + "<b>" + esc(nomeCamp(sc.ed.campanha_id)) +
            (sc.grupo ? " · " + esc(sc.grupo.nome) : "") + '</b><span class="enc-apagado">' + esc(periodo(sc.inicio, sc.fim)) + "</span>" +
            '<span class="enc-dir">' + (sc.sit.noArSemAprovacao ? '<span class="enc-marca enc-vermelho">Entrou no ar sem aprovação</span> ' : "") + chipSit(sc.sit) + "</span></button>";
        }).join("") + "</div>";
    }
    // Campanhas sem encarte: ativas sem modelo de edição, e as pausadas (não geram nada).
    var sem = (dd.regras || []).filter(function (r) { return (r.tipo || "campanha") === "campanha" && !(dd.modelos || []).some(function (mm) { return mm.tipo === "edicao" && mm.campanha_id === r.id && mm.ativo !== false; }); });
    var paus = (dd.regras || []).filter(function (r) { return (r.tipo || "campanha") === "campanha" && r.situacao === "pausada"; });
    if (!PREF.minhas && (sem.length || paus.length)) {
      h1 += '<div class="enc-secao"><h3>Campanhas sem encarte</h3>' + sem.concat(paus.filter(function (p) { return sem.indexOf(p) < 0; })).map(function (r) {
        return '<div class="enc-linha-fina">' + bolinha(corCamp(r.id)) + "<b>" + esc(r.nome) + '</b><span class="enc-apagado">' +
          (r.situacao === "pausada" ? "pausada no Calendário: não gera edição nem prazo" : "não tem modelo de encarte") + "</span></div>";
      }).join("") + "</div>";
    }
    return h1;
  }

  function cartao(sc) {
    var h = hoje();
    if (sc.virtual) {
      var e = sc.e, mdl = modeloDe(e.modelo_id), nv = contarVagasModelo(mdl);
      var d = E.diasEntre(h, e.prazos.comecar);
      return '<div class="enc-ed enc-virtual" style="border-left-color:' + esc(corCamp(e.campanha_id)) + '">' +
        '<div class="enc-l1"><span class="enc-nome">' + esc(e.nome) + '</span><span class="enc-chip enc-st-futuro">◷ Começa em ' + dias1(d) + "</span></div>" +
        '<div class="enc-datas">' + esc(periodo(e.inicio, e.fim)) + " · " + esc(noAr(e.inicio, e.fim, h)) + "</div>" +
        '<div class="enc-sub">' + nv + " vagas no modelo · planejamento começa em " + esc(dm(e.prazos.comecar)) + "</div>" +
        (sc.coinc.length ? '<div class="enc-marcas"><span class="enc-marca" title="' + esc(sc.coinc.map(function (c) { return c.texto; }).join(" · ")) + '">⚠ coincide com ' +
          esc(sc.coinc.map(function (c) { return (c.a.id === e.campanha_id ? c.b : c.a).nome; }).join(", ")) + "</span></div>" : "") + "</div>";
    }
    var ed = sc.ed, s = sc.sit, c = sc.contagem, cor = corCamp(ed.campanha_id);
    var nomeG = sc.grupo ? '<small>' + esc(sc.grupo.nome) + " · prazo próprio</small>" : "";
    var pendentes = sc.vagas.filter(function (v) { return ativa(v) && !v.proposta_escolhida; }).map(function (v) { return v.nome; });
    var marcas = "";
    if (s.noArSemAprovacao) marcas += '<span class="enc-marca enc-vermelho">⛔ Entrou no ar sem aprovação</span>';
    if (c.emAjuste) marcas += '<span class="enc-marca enc-vermelho" style="background:#fdecec;color:#b42318">' + c.emAjuste + " em ajuste</span>";
    if (c.aguardandoVisto) marcas += '<span class="enc-marca enc-azul">' + c.aguardandoVisto + " aguardando visto</span>";
    if (sc.coinc && sc.coinc.length) {
      var abertas = sc.coinc.filter(function (x) { return !decisaoDe(x, ed); });
      marcas += !abertas.length ? '<span class="enc-marca enc-roxo">coincidência decidida</span>'
        : '<span class="enc-marca" title="' + esc(abertas.map(function (x) { return x.texto; }).join(" · ")) + '">⚠ coincide com ' +
          esc(abertas.map(function (x) { return (x.a.id === ed.campanha_id && x.a.inicio_regra === ed.inicio_regra ? x.b : x.a).nome; }).join(", ")) + "</span>";
    }
    if (sc.minha) marcas += '<span class="enc-marca enc-azul">tem proposta sua</span>';
    var mot = s.k === "atrasado" ? "enc-atrasado" : s.k === "atencao" ? "enc-atencao" : "";
    return '<button class="enc-ed" style="border-left-color:' + esc(cor) + '" data-ea="abrir-ed" data-id="' + esc(ed.id) + '">' +
      '<div class="enc-l1"><span class="enc-nome">' + esc(nomeCamp(ed.campanha_id)) + nomeG + "</span>" + chipSit(s) + "</div>" +
      '<div class="enc-datas">' + esc(periodo(sc.inicio, sc.fim)) + " · " + esc(noAr(sc.inicio, sc.fim, h)) + "</div>" + barra(c) +
      '<div class="enc-nums enc-num"><span><b>' + c.definidas + "</b> de " + c.total + " definidas</span><span><b>" + c.negociando + "</b> negociando</span><span><b>" +
      c.aNegociar + "</b> a negociar</span>" + (c.aprovadas ? "<span><b>" + c.aprovadas + "</b> aprovadas</span>" : "") + "</div>" +
      (s.texto ? '<div class="enc-motivo ' + mot + '">' + esc(s.texto) + "</div>" : "") +
      ((s.k === "atrasado" || s.k === "atencao") && pendentes.length ? '<div class="enc-motivo">Pendentes: ' + esc(pendentes.slice(0, 6).join(", ") + (pendentes.length > 6 ? " e mais " + (pendentes.length - 6) : "")) + "</div>" : "") +
      (marcas ? '<div class="enc-marcas">' + marcas + "</div>" : "") + "</button>";
  }
  function contarVagasModelo(m) {
    var t = 0; if (!m) return 0;
    ((objeto(m.estrutura) || {}).grupos || []).forEach(function (g) {
      if (g.ativo_padrao === false) return;
      (g.vagas || []).forEach(function (v) { if (v.obrigatoria !== false) t += Math.max(1, +v.quantidade || 1); });
    });
    return t;
  }

  /* ======================= EDIÇÃO ======================= */
  function propostasDe(det, vagaId) { return det.propostas.filter(function (p) { return p.vaga_id === vagaId; }); }
  function escolhidaDe(det, v) { if (!v.proposta_escolhida) return null; for (var i = 0; i < det.propostas.length; i++) if (det.propostas[i].id === v.proposta_escolhida) return det.propostas[i]; return null; }
  function grupoDe(det, id) { for (var i = 0; i < det.grupos.length; i++) if (det.grupos[i].id === id) return det.grupos[i]; return null; }
  function analise(p, ini) { return E.analiseProposta(p, { inicio: ini }); }
  // Alerta que pesa no dinheiro: margem negativa (só sai com custo confiável) e verba maior que o custo.
  function alertaVermelho(al) { return al.tipo === "margem_negativa" || al.tipo === "verba_maior_que_custo"; }
  function descProd(p) {
    var L = objeto(p && p.produtos_info) || [];
    if (!L.length) return (p && p.produtos && p.produtos.length ? "Produto " + p.produtos.join(", ") : "Produto");
    return L[0].descricao + (L.length > 1 ? " · " + (L.length - 1) + (L.length === 2 ? " variação" : " variações") : "");
  }
  function estadoChip(v) {
    var e = v.estado || "pendente";
    if (e === "pendente") return "";
    var rot = { aprovada: "Aprovada", em_ajuste: "Em ajuste", aguardando_visto: "Aguardando visto" }[e] || e;
    return '<span class="enc-ea enc-' + e + '">' + rot + "</span>";
  }
  function svChip(v, det) {
    if (v.proposta_escolhida) return '<span class="enc-sv enc-def"><i class="enc-q"></i>Definida</span>';
    var tem1 = propostasDe(det, v.id).some(function (p) { return (p.situacao || "ativa") === "ativa"; });
    return tem1 ? '<span class="enc-sv enc-neg"><i class="enc-q"></i>Negociando</span>' : '<span class="enc-sv enc-an"><i class="enc-q"></i>A negociar</span>';
  }
  function classeVaga(v, det) {
    if (v.proposta_escolhida) return "def";
    return propostasDe(det, v.id).some(function (p) { return (p.situacao || "ativa") === "ativa"; }) ? "neg" : "an";
  }

  function telaEdicao(det) {
    var ed = det.edicao, h = hoje(), m = A.master(), comp = A.comprador();
    var gs = det.grupos.filter(function (g) { return g.situacao !== "removido"; }).sort(function (a, b) { return (a.ordem || 0) - (b.ordem || 0); });
    var escs = escoposDe(ed, gs, det.vagas, det.propostas, h);
    var cTot = E.contarVagas(det.vagas, det.propostas);
    cTot.pendentesNoAr = pendentesNoAr(det.vagas, porId(gs), ed, h);
    // A situação do cabeçalho é a da EDIÇÃO (os grupos com prazo próprio têm a deles, no grupo).
    var principal = escs.filter(function (s) { return !s.grupo; })[0] || { prazos: objeto(ed.prazos) || {},
      sit: E.situacao({ prazos: objeto(ed.prazos), inicio: ed.inicio, fim: ed.fim, sem_penalidade: ed.sem_penalidade === true }, cTot, h) };
    var mdl = modeloDe(ed.modelo_id);
    var coincs = (mapaCoincidencias(h)[ed.campanha_id + "|" + ed.inicio_regra] || []);
    var decs = coincs.map(function (c) { return decisaoDe(c, ed); });
    var pendentesC = coincs.filter(function (c, i) { return !decs[i]; });
    var ativaEd = (ed.situacao || "ativa") === "ativa";
    // Juntada (ou cancelada): a situação de prazo não vale mais; o cabeçalho diz para onde foi.
    var jt = ed.situacao === "juntada" ? juntadaEm(ed) : null;
    var chipEd = ed.situacao === "juntada"
      ? '<span class="enc-chip enc-juntada">Juntada à edição ' + (jt ? '<button class="enc-bt-l" data-ea="abrir-ed" data-id="' + esc(jt.id) + '">' + esc(nomeJuntada(jt)) + "</button>" : "(outra)") + "</span>"
      : ed.situacao === "cancelada" ? '<span class="enc-chip">Cancelada</span>' : chipSit(principal.sit);

    var x = '<div class="enc-volta"><button class="enc-bt-l" data-ea="fila">‹ Encartes</button></div>';
    if (AVISO && AVISO.edicao === ed.id) x += '<div class="enc-msg' + (AVISO.tipo ? " enc-" + AVISO.tipo : "") + '" role="status">' + esc(AVISO.txt) + "</div>";
    x += '<div class="enc-cartao" style="margin-top:10px"><div class="enc-cab"><div class="enc-tit"><div class="enc-linha-tit">' + bolinha(corCamp(ed.campanha_id), 12) +
      "<h2>" + esc(nomeCamp(ed.campanha_id)) + "</h2>" + chipEd +
      (ed.sem_penalidade && ativaEd && !anterior(principal.sit) ? '<span class="enc-chip enc-st-anterior">Anterior ao processo</span>' : "") + "</div>" +
      '<div class="enc-sub" style="font-size:14px">' + esc(periodo(ed.inicio, ed.fim)) + " · " + esc(noAr(ed.inicio, ed.fim, h)) + "</div>" +
      '<div class="enc-origem">Nasceu do modelo "' + esc(mdl ? mdl.nome : ed.modelo_id) + '" (versão ' + esc(ed.modelo_versao || 1) + ") em " + esc(dm(E.hojeISO(instante(ed.criado_em) || ed.criado_em))) +
      (ed.criado_por_nome ? " · aberta por " + esc(ed.criado_por_nome) : "") + " · versão do encarte " + esc(ed.versao) + "</div>" + dadosVr() + "</div>" +
      '<div class="enc-andamento"><div style="display:flex;align-items:baseline;gap:8px;margin-bottom:8px"><span class="enc-grande enc-num">' + cTot.definidas +
      '</span><span class="enc-apagado">de ' + cTot.total + " vagas definidas</span></div>" + barra(cTot) + legenda(cTot) +
      '<div class="enc-leg">' + (cTot.aprovadas ? '<span class="enc-ea enc-aprovada">' + cTot.aprovadas + " aprovadas</span>" : "") +
      (cTot.emAjuste ? '<span class="enc-ea enc-em_ajuste">' + cTot.emAjuste + " em ajuste</span>" : "") +
      (cTot.aguardandoVisto ? '<span class="enc-ea enc-aguardando_visto">' + cTot.aguardandoVisto + " aguardando visto</span>" : "") + "</div></div></div>" +
      linhaPrazos(principal.prazos, ed.inicio, h) + "</div>";

    // Avisos da edição (só da ativa: a juntada continua na outra edição)
    var semAprov = ativaEd ? escs.filter(function (s) { return s.sit.noArSemAprovacao; }) : [];
    if (semAprov.length) {
      // conta só as vagas cujo GRUPO já está no ar (o Fim de semana só entra na sexta)
      x += '<div class="enc-aviso enc-vermelho"><span>⛔</span><div><b>Entrou no ar sem aprovação.</b> ' + semAprov.map(function (s) {
        var k = s.contagem.pendentesNoAr;
        return (s.grupo ? esc(s.grupo.nome) + ": " : "") + k + (k === 1 ? " vaga já no ar sem aprovação" : " vagas já no ar sem aprovação");
      }).join(" · ") + ". Fica registrado; o que mudar agora vira crítica no histórico.</div></div>";
    }
    coincs.forEach(function (c, i) {
      var dd = decs[i];
      x += '<div class="enc-aviso' + (dd ? " enc-azul" : "") + '"><span>' + (dd ? "ℹ" : "⚠") + "</span><div>" + esc(c.texto) +
        (dd ? '<div style="margin-top:4px"><b>Decidido: ' + esc(ACOES_COINC[dd.dec.acao] || dd.dec.acao) + "</b>" + (dd.dec.motivo ? " — " + esc(dd.dec.motivo) : "") +
          (dd.ed.id !== ed.id ? " (decisão gravada em " + esc(nomeCamp(dd.ed.campanha_id)) + " · " + esc(E.fmtPeriodo(dd.ed.inicio, dd.ed.fim, { curta: true })) + ")" : "") +
          (dd.dec.por_nome ? ' <span class="enc-apagado">(' + esc(dd.dec.por_nome) + (dd.dec.em ? ", " + esc(quando(dd.dec.em)) : "") + ")</span>" : "") + "</div>"
          : '<div style="margin-top:4px">' + (m && ativaEd ? '<button class="enc-bt-l" data-ea="coinc">Decidir: manter, mover ou juntar</button>' : '<span class="enc-apagado">Quem decide é o master.</span>') + "</div>") +
        "</div></div>";
    });
    var repetidos = produtosRepetidos(det);
    if (repetidos.length) {
      x += '<div class="enc-aviso"><span>⚠</span><div><b>Mesmo produto com preço ou período diferente:</b>' + repetidos.map(function (r) {
        return '<div style="margin-top:3px">' + esc(r.descricao) + " — " + r.itens.map(function (i) { return esc(i.onde) + " (" + esc(brl(i.preco)) + ", " + esc(E.fmtPeriodo(i.inicio, i.fim, { curta: true })) + ")"; }).join(" × ") + "</div>";
      }).join("") + "</div></div>";
    }
    if (cTot.aguardandoVisto) x += '<div class="enc-aviso enc-azul"><span>ℹ</span><div>' + cTot.aguardandoVisto + (cTot.aguardandoVisto === 1 ? " vaga mudou" : " vagas mudaram") +
      " depois de aprovada" + (cTot.aguardandoVisto === 1 ? "" : "s") + " e " + (cTot.aguardandoVisto === 1 ? "aguarda" : "aguardam") + " o visto do master na próxima Aprovação do Encarte.</div></div>";

    var nAprov = det.vagas.filter(function (v) { return v.foto_aprovada; }).length;
    // O histórico vem em páginas de 300 (o livro só cresce): com página cheia, diz "últimos N".
    var nEv = det.eventos.length, maisEv = !!det.eventosTalvezMais;
    x += '<div class="enc-abas" role="tablist">' + [["vagas", "Vagas (" + cTot.total + ")"], ["historico", "Histórico (" + (maisEv ? "últimos " + nEv : nEv) + ")"], ["aprovado", "Aprovado × atual (" + nAprov + ")"]].map(function (a) {
      return '<button role="tab" aria-selected="' + (ABA === a[0]) + '" class="' + (ABA === a[0] ? "enc-on" : "") + '" data-ea="aba" data-v="' + a[0] + '">' + esc(a[1]) + "</button>";
    }).join("") + "</div>";
    if (ABA === "historico") x += '<div class="enc-cartao">' + listaEventos(det, det.eventos) +
      (maisEv ? '<div class="enc-mais"><span class="enc-apagado">Mostrando os últimos ' + nEv + " registros.</span> <button class=\"enc-bt\" data-ea=\"mais-hist\">Ver mais</button></div>" : "") + "</div>";
    else if (ABA === "aprovado") x += aprovadoAtual(det, null);
    else x += abaVagas(det, gs, escs);

    // Rodapé com as ações
    var faltamDef = cTot.total - cTot.definidas;
    // "para aprovar" não conta a devolvida que o comprador ainda não mexeu (o banco não a aprova)
    var aAprovar = det.vagas.filter(function (v) { return ativa(v) && v.proposta_escolhida && v.estado !== "aprovada" && !esperandoComprador(v); }).length;
    var esperam = det.vagas.filter(function (v) { return ativa(v) && esperandoComprador(v); }).length;
    x += '<div class="enc-rodape">';
    if (comp && ativaEd) x += '<button class="enc-bt" data-ea="nova-vaga">+ Vaga só nesta edição</button>';
    if (m && ativaEd) {
      x += '<button class="enc-bt" data-ea="tema" data-ed="' + esc(ed.id) + '">+ Ação temática</button>';
      if (pendentesC.length) x += '<button class="enc-bt" data-ea="coinc">Decidir coincidência</button>';
      if (!ed.sem_penalidade) x += '<button class="enc-bt" data-ea="sem-pen">Marcar anterior ao processo</button>';
    }
    // edição juntada ou cancelada: não há o que definir aqui (o trabalho está na outra edição)
    if (ativaEd) x += '<span class="enc-esp"></span><span class="enc-porque">' + (faltamDef > 0 ? "Faltam " + faltamDef + (faltamDef === 1 ? " vaga" : " vagas") + " para definir" : cTot.total ? "Todas as vagas estão definidas" : "") +
      (aAprovar ? " · " + aAprovar + " para aprovar" : "") + (esperam ? " · " + esperam + " em ajuste esperando o comprador" : "") + "</span>";
    if (m && ativaEd) x += '<button class="enc-bt-p" data-ea="aprovar"' + (aAprovar ? "" : " disabled title=\"Nenhuma vaga definida esperando aprovação\"") + ">Aprovar encarte</button>";
    else if (!m && ativaEd) x += '<span class="enc-porque">A Aprovação do Encarte é do master.</span>';
    x += "</div>";
    return x;
  }
  function linhaPrazos(pz, noArIso, h) {
    var L = [["Começar", pz.comecar], ["Definir vagas", pz.definir], ["Aprovar", pz.aprovar], ["No ar", noArIso]];
    return '<div class="enc-prazos">' + L.map(function (p) {
      if (!p[1]) return '<div class="enc-pz"><span class="enc-pt"></span><b>' + p[0] + "</b>—</div>";
      var cls = p[1] < h ? " enc-feito" : p[1] === h ? " enc-hoje" : "";
      return '<div class="enc-pz' + cls + '"><span class="enc-pt"></span><b>' + p[0] + (p[1] === h ? " · HOJE" : "") + "</b>" + esc(dsem(p[1])) + "</div>";
    }).join("") + "</div>";
  }
  /* Mesmo produto escolhido em grupos/edições com períodos que se cruzam e preço ou período
     diferente (D7·7): destaca, não bloqueia. Compara esta edição com ela mesma e com as outras
     edições já abertas nesta sessão (sem ler nada a mais da nuvem só para isso). */
  function produtosRepetidos(det) {
    var itens = [];
    function junta(d, daqui) {
      d.vagas.forEach(function (v) {
        if (!ativa(v)) return;
        var p = escolhidaDe(d, v); if (!p) return;
        var g = grupoDe(d, v.grupo_id) || {}, ini = inicioGrupo(g, d.edicao), fim = fimGrupo(g, d.edicao);
        (p.produtos || []).forEach(function (pid, i) {
          var info = (objeto(p.produtos_info) || [])[i] || {};
          // campanha_id: o cálculo não destaca o "dia de encosto" entre duas edições da MESMA campanha com o mesmo preço
          itens.push({ produto_id: pid, descricao: info.descricao || ("Produto " + pid), inicio: ini, fim: fim, preco: p.preco_oferta, daqui: daqui, campanha_id: d.edicao.campanha_id,
            onde: (daqui ? "" : nomeCamp(d.edicao.campanha_id) + " · ") + (g.nome || "") + " · " + v.nome });
        });
      });
    }
    junta(det, true);
    A.detalhesGuardados().forEach(function (d) { if (d !== det && (d.edicao.situacao || "ativa") === "ativa") junta(d, false); });
    try { return E.sobreposicaoProdutos(itens).filter(function (r) { return r.itens.some(function (i) { return i.daqui; }); }); }
    catch (e) { return []; }
  }

  function abaVagas(det, gs, escs) {
    var h = hoje(), m = A.master(), ativaEd = (det.edicao.situacao || "ativa") === "ativa";
    var ativas = det.vagas.filter(ativa);
    var cnt = { todas: ativas.length, pend: 0, neg: 0, an: 0, def: 0, em_ajuste: 0, aguardando_visto: 0 };
    ativas.forEach(function (v) { var k = classeVaga(v, det); cnt[k]++; if (k !== "def") cnt.pend++; if (v.estado === "em_ajuste") cnt.em_ajuste++; if (v.estado === "aguardando_visto") cnt.aguardando_visto++; });
    function passa(v) {
      if (FV === "todas") return true;
      if (FV === "pend") return !v.proposta_escolhida;
      if (FV === "em_ajuste" || FV === "aguardando_visto") return v.estado === FV;
      return classeVaga(v, det) === FV;
    }
    var x = '<div class="enc-filtros">' + [["todas", "Todas"], ["pend", "Pendentes"], ["neg", "Negociando"], ["an", "A negociar"], ["def", "Definidas"], ["em_ajuste", "Em ajuste"], ["aguardando_visto", "Aguardando visto"]]
      .filter(function (f) { return f[0] === "todas" || cnt[f[0]] || FV === f[0]; })
      .map(function (f) { return '<button class="' + (FV === f[0] ? "enc-on" : "") + '" data-ea="fvaga" data-v="' + f[0] + '">' + esc(f[1]) + " (" + cnt[f[0]] + ")</button>"; }).join("") + "</div>";
    var escPorGrupo = {}; escs.forEach(function (s) { if (s.grupo) escPorGrupo[s.grupo.id] = s; });
    var algum = false;
    gs.forEach(function (g) {
      var vs = det.vagas.filter(function (v) { return v.grupo_id === g.id; }).sort(function (a, b) { return (a.ordem || 0) - (b.ordem || 0); });
      var at = vs.filter(ativa), ret = vs.filter(function (v) { return !ativa(v); });
      var mostrar = at.filter(passa);
      if (!mostrar.length && FV !== "todas") return;
      algum = true;
      var sc = escPorGrupo[g.id], per = (g.inicio || g.fim) ? periodo(inicioGrupo(g, det.edicao), fimGrupo(g, det.edicao)) : "";
      var pz = objeto(g.prazos);
      var def = at.filter(function (v) { return v.proposta_escolhida; }).length;
      var aApr = at.filter(function (v) { return v.proposta_escolhida && v.estado !== "aprovada" && !esperandoComprador(v); }).length;
      x += '<div class="enc-cartao enc-grupo"><div class="enc-grupo-cab"><h4>' + esc(g.nome) + "</h4>" +
        (g.identidade ? '<span class="enc-gi">“' + esc(g.identidade) + "”</span>" : "") +
        (g.tipo === "tema" ? '<span class="enc-marca enc-roxo">ação temática</span>' : "") +
        (per ? '<span class="enc-gi">período próprio: ' + esc(per) + "</span>" : "") +
        (pz && pz.comecar ? '<span class="enc-gi">prazo próprio: definir até ' + esc(dm(pz.definir)) + " · aprovar até " + esc(dm(pz.aprovar)) + "</span>" : "") +
        // edição juntada/cancelada: o grupo não tem mais situação de prazo (o trabalho foi para a outra edição)
        (sc && ativaEd ? chipSit(sc.sit) : "") + (sc && ativaEd && sc.sit.noArSemAprovacao ? '<span class="enc-marca enc-vermelho">Entrou no ar sem aprovação</span>' : "") +
        '<span class="enc-gc">' + def + "/" + at.length + "</span>" +
        // aprovar por grupo vale para TODO grupo com vaga definida esperando (seções 1 e 7), com ou sem prazo próprio
        (m && aApr && (det.edicao.situacao || "ativa") === "ativa" ? '<button class="enc-bt" data-ea="aprovar" data-grupo="' + esc(g.id) + '">Aprovar grupo</button>' : "") + "</div>" +
        mostrar.map(function (v) { return linhaVaga(det, v, g, h); }).join("") +
        (!at.length ? '<div class="enc-retiradas">Nenhuma vaga ativa neste grupo.</div>' : "") +
        (ret.length && FV === "todas" ? '<div class="enc-retiradas">Retiradas: ' + ret.map(function (v) { return esc(v.nome) + (v.motivo_retirada ? " (" + esc(v.motivo_retirada) + ")" : ""); }).join(" · ") + "</div>" : "") +
        "</div>";
    });
    if (!algum) x += '<div class="enc-cartao enc-carregando">Nenhuma vaga neste filtro.</div>';
    return x;
  }
  function linhaVaga(det, v, g, h) {
    var p = escolhidaDe(det, v), ini = inicioGrupo(g, det.edicao), prod;
    if (p) {
      var a = analise(p, ini);
      prod = '<div class="enc-pd">' + esc(descProd(p)) + '</div><div class="enc-px enc-num">' + esc(brl(p.preco_oferta)) +
        ' <span class="enc-apagado">(normal ' + esc(brl(a.precoNormal)) + (tem(a.descontoCliente) && a.descontoCliente > 0 ? ", −" + esc(pct(a.descontoCliente)) : "") + ")</span> · margem " +
        esc(tem(a.margem) ? pct(a.margem) : "indisponível") + " · " + esc(p.fornecedor_nome || "") + "</div>" +
        a.alertas.slice(0, 2).map(function (al) { return '<div class="enc-al' + (alertaVermelho(al) ? " enc-vermelho" : "") + '">⚠ ' + esc(al.texto) + "</div>"; }).join("");
    } else {
      var np = propostasDe(det, v.id).filter(function (q) { return (q.situacao || "ativa") === "ativa"; }).length;
      var pz = objeto(g.prazos);
      prod = np ? '<div class="enc-pd" style="font-weight:500">' + np + (np === 1 ? " proposta em andamento" : " propostas em andamento") + "</div>"
        : '<div class="enc-pd enc-apagado" style="font-weight:500">' + (g.flv && pz && pz.definir ? "Define na semana · até " + esc(dm(pz.definir)) + " (preço de feira)" : "Nenhuma proposta ainda") + "</div>";
    }
    if (v.estado === "em_ajuste" && v.devolucao) {
      var dv = objeto(v.devolucao) || {};
      prod += '<div class="enc-al enc-vermelho">Em ajuste · ' + esc(nomeCategoria(dv.categoria)) + (dv.observacao ? ": " + esc(dv.observacao) : "") +
        (dv.mexida_em ? " · revisada, volta na próxima aprovação" : " · esperando o comprador") + "</div>";
    }
    return '<button class="enc-vaga" data-ea="abrir-vaga" data-id="' + esc(v.id) + '"><div class="enc-cat">' + esc(v.nome) +
      "<small>" + (v.o_que_muda ? "muda: " + esc(v.o_que_muda) : "&nbsp;") + (v.obrigatoria === false ? " · opcional" : "") + (v.origem === "edicao" ? " · só nesta edição" : "") + "</small></div>" +
      '<div class="enc-svc">' + svChip(v, det) + estadoChip(v) + '</div><div class="enc-prod">' + prod + '</div><div class="enc-ir" aria-hidden="true">›</div></button>';
  }

  /* ---------- histórico (o livro que só cresce) ---------- */
  function textoEvento(ev, det) {
    var d = objeto(ev.depois) || {}, a = objeto(ev.antes) || {};
    function prodResumo(x) { var L = objeto(x.produtos_info) || []; return L.length ? L[0].descricao : ""; }
    switch (ev.tipo) {
      case "edicao_criada": return "Edição aberta pelo modelo (versão " + esc(d.modelo_versao || 1) + "): " + esc(d.grupos || 0) + " grupos, " + esc(d.vagas || 0) + " vagas" + (d.sem_penalidade ? " · anterior ao processo" : "");
      case "vaga_adicionada": return "Vaga “" + esc(d.nome) + "” incluída só nesta edição" + (d.no_ar ? " (com o encarte no ar)" : "");
      case "vaga_retirada": return "Vaga “" + esc(a.nome || "") + "” retirada";
      case "critica_no_ar": return "<b>Crítico com o encarte no ar:</b> " + esc(razoesTxt(ev.motivo));
      case "proposta_registrada": return "Registrou proposta de " + esc(d.fornecedor_nome || "") + (prodResumo(d) ? " · " + esc(prodResumo(d)) : "") + (tem(d.custo_negociado) ? " · custo " + esc(brl(d.custo_negociado)) : "") + (tem(d.preco_oferta) ? " · oferta " + esc(brl(d.preco_oferta)) : "");
      case "proposta_editada": {
        // "produtos" e "produtos_info" (e os dois campos da bonificação) contam como uma mudança só
        var ks = []; Object.keys(d).forEach(function (k) { var r = ROTULO_CAMPO[k] || k; if (ks.indexOf(r) < 0) ks.push(r); });
        return "Editou a proposta: " + esc(ks.join(", "));
      }
      case "proposta_descartada": return "Descartou uma proposta" + (a.era_escolhida ? " (era a escolhida)" : "");
      case "proposta_escolhida": return "Escolheu a proposta de " + esc(d.fornecedor_nome || "") + (tem(d.preco_oferta) ? " · " + esc(brl(d.preco_oferta)) : "");
      case "vaga_reaberta": return "Vaga voltou para <b>Aguardando visto</b>: " + esc(razoesTxt(ev.motivo));
      case "vaga_devolvida": return "Devolvida na Aprovação do Encarte (<b>Em ajuste</b>) · " + esc(nomeCategoria(ev.categoria));
      case "aprovacao": return "<b>Aprovação do Encarte</b>" + (ev.grupo_id ? " do grupo " + esc((grupoDe(det, ev.grupo_id) || {}).nome || "") : "") + ": " + esc(d.aprovadas || 0) + " aprovadas, " + esc(d.devolvidas || 0) + " devolvidas";
      case "grupo_tematico_criado": return "Ação temática “" + esc(d.nome) + "” criada" + (d.inicio ? " (" + esc(E.fmtPeriodo(d.inicio, d.fim, { curta: true })) + ")" : "");
      case "coincidencia_decidida": return "Coincidência decidida: " + esc(ACOES_COINC[ev.categoria] || ev.categoria || "");
      case "sem_penalidade": return "Marcada como anterior ao processo (sem penalidade)";
      default: return esc(String(ev.tipo || "").replace(/_/g, " "));
    }
  }
  var ROTULO_CAMPO = { fornecedor_id: "fornecedor", fornecedor_nome: "fornecedor", produtos: "produtos", produtos_info: "produtos", custo_hoje: "custo do VR",
    custo_confiavel: "confiança do custo", preco_normal: "preço normal", dados_vr_em: "dados do VR", custo_negociado: "custo negociado", preco_oferta: "preço de oferta",
    verba_valor: "verba", verba_qtd_base: "base da verba", bonif_compra: "bonificação", bonif_ganha: "bonificação", bonificacao_texto: "bonificação (texto)",
    condicao_pagamento: "condição de pagamento", quantidade_minima: "quantidade mínima", validade: "validade", observacao: "observação" };
  function listaEventos(det, lista) {
    if (!lista.length) return '<p class="enc-sub">Nada registrado ainda.</p>';
    var nomes = {}; det.vagas.forEach(function (v) { nomes[v.id] = v.nome; });
    return '<ul class="enc-eventos">' + lista.map(function (ev) {
      return '<li class="' + (ev.destaque ? "enc-destaque" : "") + '"><span class="enc-h">' + esc(quando(ev.em)) + "</span><span>" +
        (ev.por_nome ? '<span class="enc-quem">' + esc(ev.por_nome) + "</span> · " : "") + (ev.vaga_id && nomes[ev.vaga_id] ? "<b>" + esc(nomes[ev.vaga_id]) + "</b> · " : "") +
        textoEvento(ev, det) + (ev.motivo && ev.tipo !== "critica_no_ar" && ev.tipo !== "vaga_reaberta" ? '<span class="enc-mot">Motivo: ' + esc(ev.motivo) + "</span>" : "") + "</span></li>";
    }).join("") + "</ul>";
  }

  /* ---------- APROVADO × ATUAL ---------- */
  function comparar(f, p) {
    var dif = [];
    if (!p) return ["sem proposta escolhida"];
    var pa = (f.produtos || []).slice().sort().join(","), pb = (p.produtos || []).slice().sort().join(",");
    if (pa !== pb) dif.push("produto");
    // SEM arredondar, igual ao banco (K4): 12,99 → 12,991 o banco reabre, então aqui também é diferente.
    function num2(v) { return tem(v) ? +v : null; }
    if (num2(f.preco_oferta) !== num2(p.preco_oferta)) dif.push("preço de oferta");
    if (num2(f.custo_negociado) !== num2(p.custo_negociado)) dif.push("custo negociado");
    if (num2(f.verba_valor) !== num2(p.verba_valor) || num2(f.verba_qtd_base) !== num2(p.verba_qtd_base) || num2(f.bonif_compra) !== num2(p.bonif_compra) || num2(f.bonif_ganha) !== num2(p.bonif_ganha)) dif.push("verba/bonificação");
    if (String(f.fornecedor_nome || "").toUpperCase() !== String(p.fornecedor_nome || "").toUpperCase()) dif.push("fornecedor");
    return dif;
  }
  function aprovadoAtual(det, soVaga) {
    var vs = det.vagas.filter(function (v) { return v.foto_aprovada && (!soVaga || v.id === soVaga); });
    var x = "";
    if (!soVaga) {
      x += '<div class="enc-cartao"><h3>Aprovações</h3>' + (det.aprovacoes.length ? '<ul class="enc-eventos">' + det.aprovacoes.map(function (ap) {
        var dv = objeto(ap.devolucoes) || [];
        return '<li><span class="enc-h">' + esc(quando(ap.aprovado_em)) + "</span><span><span class=\"enc-quem\">" + esc(ap.aprovado_por_nome || "") + "</span> · <b>Aprovação do Encarte</b>" +
          (ap.grupo_id ? " (grupo " + esc((grupoDe(det, ap.grupo_id) || {}).nome || "") + ")" : "") + ": " + (ap.vagas_aprovadas || []).length + " aprovadas, " + dv.length + " devolvidas · versão vista " + esc(ap.versao_vista) +
          (dv.length ? '<span class="enc-mot">' + dv.map(function (d) { return esc(d.vaga_nome || "") + ": " + esc(nomeCategoria(d.categoria)) + (d.observacao ? " — " + esc(d.observacao) : ""); }).join(" · ") + "</span>" : "") + "</span></li>";
      }).join("") + "</ul>" : '<p class="enc-sub">Esta edição ainda não teve Aprovação do Encarte.</p>') + "</div>";
    }
    if (!vs.length) return x + (soVaga ? "" : '<div class="enc-cartao enc-carregando">Nenhuma vaga aprovada ainda.</div>');
    var linhas = vs.map(function (v) {
      var f = objeto(v.foto_aprovada) || {}, p = escolhidaDe(det, v), g = grupoDe(det, v.grupo_id) || {};
      // Aprovada e depois RETIRADA: um item aprovado saiu do encarte — é o que o master mais precisa ver aqui.
      if (!ativa(v)) return { v: v, f: f, p: null, a: null, dif: [], retirada: true, critica: retiradaNoAr(det, v, inicioGrupo(g, det.edicao)) };
      var aAt = p ? analise(p, inicioGrupo(g, det.edicao)) : null;
      return { v: v, f: f, p: p, a: aAt, dif: comparar(f, p) };
    });
    function lado(desc, oferta, custo, margem, forn) {
      return "<b>" + esc(desc) + '</b><br><span class="enc-num">' + esc(brl(oferta)) + " · custo " + esc(brl(custo)) + " · margem " + esc(tem(margem) ? pct(margem) : "indisponível") + "</span><br>" + esc(forn || "");
    }
    function situ(l) {
      if (l.retirada) return '<span class="enc-ea enc-retirada">⛔ Retirada depois da aprovação' + (l.critica ? " · crítica (encarte no ar)" : "") + "</span>";
      return (l.dif.length ? '<span class="enc-ea enc-aguardando_visto">Mudou: ' + esc(l.dif.join(", ")) + "</span>" : '<span class="enc-ea enc-aprovada">Igual ao aprovado</span>') + " " + estadoChip(l.v);
    }
    function atual(l) {
      if (l.retirada) return '<b>Vaga retirada</b>' + (l.v.motivo_retirada ? '<br><span class="enc-apagado">' + esc(l.v.motivo_retirada) + "</span>" : "");
      return l.p ? lado(descProd(l.p), l.p.preco_oferta, l.a.custoConsiderado, l.a.margem, l.p.fornecedor_nome) : '<span class="enc-apagado">sem proposta escolhida</span>';
    }
    x += '<div class="enc-cartao"><h3>Aprovado × atual</h3><p class="enc-sub">O que o master aprovou (a foto do momento) ao lado do que está valendo agora.</p>' +
      '<div class="enc-tw"><table class="enc-tab enc-some-cel"><thead><tr><th>Vaga</th><th>Aprovado</th><th>Atual</th><th>Situação</th></tr></thead><tbody>' +
      linhas.map(function (l) {
        var mf = tem(l.f.margem) ? +l.f.margem * 100 : null;
        return '<tr class="' + (l.retirada ? "enc-retirada-l" : l.dif.length ? "enc-mudou" : "") + '"><td><b>' + esc(l.v.nome) + "</b><br><small class=\"enc-apagado\">" + esc(l.f.grupo_nome || "") + " · " + esc(quando(l.v.aprovada_em)) + "</small></td>" +
          "<td>" + lado(descProd(l.f), l.f.preco_oferta, l.f.custo_considerado, mf, l.f.fornecedor_nome) + "</td>" +
          "<td>" + atual(l) + "</td><td>" + situ(l) + "</td></tr>";
      }).join("") + "</tbody></table></div>" +
      '<div class="enc-cmp">' + linhas.map(function (l) {
        var mf = tem(l.f.margem) ? +l.f.margem * 100 : null;
        return '<div class="' + (l.retirada ? "enc-retirada-l" : "") + '" style="border-top:1px solid #eef1f4;padding:10px 0"><b>' + esc(l.v.nome) + "</b> " + situ(l) +
          '<div class="enc-sub"><b>Aprovado:</b> ' + lado(descProd(l.f), l.f.preco_oferta, l.f.custo_considerado, mf, l.f.fornecedor_nome) + "</div>" +
          '<div class="enc-sub"><b>Atual:</b> ' + atual(l) + "</div></div>";
      }).join("") + "</div></div>";
    return x;
  }
  /* A retirada virou crítica? O banco grava "critica_no_ar" quando a vaga sai com o grupo já no
     ar (na hora da retirada, não hoje). Sem o evento na lista carregada (histórico em páginas),
     vale a data do registro da retirada; sem nenhum dos dois, se o grupo já está no ar. */
  function retiradaNoAr(det, v, ini) {
    var ret = null;
    for (var i = 0; i < det.eventos.length; i++) {
      var ev = det.eventos[i]; if (ev.vaga_id !== v.id) continue;
      if (ev.tipo === "critica_no_ar" && /vaga_retirada/.test(String(ev.motivo || "") + " " + String((objeto(ev.depois) || {}).acao || ""))) return true;
      if (ev.tipo === "vaga_retirada" && !ret) ret = ev;
    }
    if (ret) { var d = instante(ret.em); return d ? E.hojeISO(d) >= ini : false; }
    return hoje() >= ini;
  }

  /* ======================= VAGA ======================= */
  function telaVaga(det, v) {
    var ed = det.edicao, g = grupoDe(det, v.grupo_id) || {}, h = hoje(), comp = A.comprador();
    var ini = inicioGrupo(g, ed), fim = fimGrupo(g, ed);
    var props = propostasDe(det, v.id), at = props.filter(function (p) { return (p.situacao || "ativa") === "ativa"; }), desc = props.filter(function (p) { return p.situacao === "descartada"; });
    var podeMexer = comp && ativa(v) && (ed.situacao || "ativa") === "ativa";
    var cv = categoriaVr(v);
    var x = '<div class="enc-volta"><button class="enc-bt-l" data-ea="abrir-ed" data-id="' + esc(ed.id) + '">‹ ' + esc(nomeCamp(ed.campanha_id)) + " · " + esc(E.fmtPeriodo(ed.inicio, ed.fim, { curta: true })) + "</button></div>";
    if (AVISO && AVISO.edicao === ed.id) x += '<div class="enc-msg' + (AVISO.tipo ? " enc-" + AVISO.tipo : "") + '" role="status">' + esc(AVISO.txt) + "</div>";
    x += '<div class="enc-cartao" style="margin-top:10px"><div class="enc-linha-tit"><h2 style="font-size:24px">' + esc(v.nome) + "</h2>" + svChip(v, det) + estadoChip(v) +
      (!ativa(v) ? '<span class="enc-chip">Retirada</span>' : "") + "</div>" +
      '<div class="enc-sub">' + esc(g.nome || "") + (v.o_que_muda ? " · o que muda: <b>" + esc(v.o_que_muda) + "</b>" : "") + (v.papel ? " · papel: " + esc(v.papel) : "") +
      (v.categoria_vr ? " · categoria do VR: <b>" + esc(v.categoria_vr) + "</b>" : "") + " · " + (v.obrigatoria === false ? "opcional" : "obrigatória") +
      (v.origem === "edicao" ? " · incluída só nesta edição" : "") + "</div>" +
      '<div class="enc-sub">No ar: ' + esc(periodo(ini, fim)) + " · " + esc(noAr(ini, fim, h)) + "</div>" + dadosVr() + "</div>";
    if (v.estado === "em_ajuste") {
      var dv = objeto(v.devolucao) || {};
      x += '<div class="enc-aviso enc-vermelho"><span>↩</span><div><b>Em ajuste</b> — devolvida na Aprovação do Encarte · ' + esc(nomeCategoria(dv.categoria)) + (dv.observacao ? ": " + esc(dv.observacao) : "") +
        (dv.por_nome ? ' <span class="enc-apagado">(' + esc(dv.por_nome) + (dv.em ? ", " + esc(quando(dv.em)) : "") + ")</span>" : "") +
        // o banco só volta a aprovar depois que o comprador mexe (registra, edita, descarta ou escolhe — inclusive a mesma)
        '<div style="margin-top:4px">' + (dv.mexida_em ? "Revisada" + (dv.mexida_por_nome ? " por " + esc(dv.mexida_por_nome) : "") + ": volta na próxima Aprovação do Encarte."
          : "Esperando o comprador: ela só volta para a Aprovação do Encarte depois que ele mexer na proposta (editar, registrar outra ou escolher de novo).") + "</div></div></div>";
    }
    if (v.estado === "aguardando_visto") x += '<div class="enc-aviso enc-azul"><span>ℹ</span><div><b>Aguardando visto</b> — mudou depois de aprovada. O master confere na próxima Aprovação do Encarte (veja “Aprovado × atual” abaixo).</div></div>';
    if (!ativa(v)) x += '<div class="enc-aviso"><span>ℹ</span><div>Vaga retirada' + (v.motivo_retirada ? ": " + esc(v.motivo_retirada) : "") + ".</div></div>";

    x += '<div class="enc-cartao"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><h3 style="font-size:15px">Propostas (' + at.length + ")</h3>" +
      (podeMexer ? '<button class="enc-bt-p" data-ea="nova-prop">+ Nova proposta</button>' : "") + "</div>" +
      (at.length ? '<div class="enc-props">' + at.map(function (p, i) { return cartaoProposta(det, v, p, i, ini, podeMexer); }).join("") + "</div>"
        : '<p class="enc-sub" style="margin-top:8px">Nenhuma proposta ainda.' + (podeMexer ? " Registre a primeira em “+ Nova proposta”." : "") + "</p>") +
      '<div class="enc-nota">A tela mostra as propostas lado a lado e faz só as contas: custo de hoje (VR) × custo negociado, margem sem verba e, quando os campos estão completos, com verba e bonificação. Não há nota automática; quem escolhe é uma pessoa, no botão.</div>' +
      (desc.length ? '<details class="enc-descartadas"><summary>Propostas descartadas (' + desc.length + ")</summary>" + desc.map(function (p) {
        return "<div style=\"padding:4px 0\">" + esc(descProd(p)) + " · " + esc(p.fornecedor_nome || "") + " · custo " + esc(brl(p.custo_negociado)) + " · oferta " + esc(brl(p.preco_oferta)) + ' <span class="enc-apagado">(' + esc(p.registrado_por_nome || "") + ")</span></div>";
      }).join("") + "</details>" : "") + "</div>";

    x += '<div class="enc-duas"><div class="enc-cartao"><h3>O que o VR sabe destes produtos</h3><div class="enc-sub">Ficha do VR' + (cv ? " · categoria " + esc(v.categoria_vr) : "") +
      ': custo, preço, estoque, venda e fornecedores. Lida por código, só dos produtos das propostas.</div><div data-enc-ficha="1"><div class="enc-carregando">Lendo a ficha…</div></div>' +
      '<div data-enc-grupo="1"></div></div>' +
      '<div class="enc-cartao"><h3>Histórico desta vaga</h3>' + listaEventos(det, det.eventos.filter(function (ev) { return ev.vaga_id === v.id; })) + "</div></div>";
    if (v.foto_aprovada) x += aprovadoAtual(det, v.id);
    if (podeMexer) x += '<div class="enc-rodape"><span class="enc-esp"></span><button class="enc-bt-perigo" data-ea="retirar-vaga">Retirar esta vaga</button></div>';
    return x;
  }
  function cartaoProposta(det, v, p, i, ini, podeMexer) {
    var a = analise(p, ini), esc1 = v.proposta_escolhida === p.id;
    var fic = A.fichaGuardada((p.produtos || [])[0]);
    var L = objeto(p.produtos_info) || [];
    var linha = function (rot, val, cls, sub) { return "<dt>" + rot + "</dt><dd" + (cls ? ' class="' + cls + '"' : "") + ">" + val + (sub ? "<small>" + sub + "</small>" : "") + "</dd>"; };
    var custoHoje = a.semCusto ? '<span class="enc-tag enc-vermelho">Sem custo no VR</span>' : esc(brl(a.custoHoje, 3)) + (a.custoConfiavel ? "" : '<span class="enc-tag">Custo não confiável</span>');
    var verbaTxt = tem(p.verba_valor) ? brl(p.verba_valor) + (tem(p.verba_qtd_base) ? " para " + milhar(p.verba_qtd_base) + " un" : "") : "—";
    var bonTxt = tem(p.bonif_compra) && tem(p.bonif_ganha) ? "a cada " + p.bonif_compra + " leva " + p.bonif_ganha : (p.bonificacao_texto || "—");
    // Margem com verba: vermelha se negativa (a mesma regra da margem sem verba); verba maior que o
    // custo deixa o custo efetivo ≤ 0 e a margem não existe (o cálculo manda o alerta).
    var mgv = "—", mgvCls = "";
    if (a.temVerba && !a.margemComVerbaCalculavel) mgv = '<span class="enc-apagado">não calculável</span>';
    else if (a.temVerba && !tem(a.margemComVerba)) { mgv = "verba maior que o custo"; mgvCls = "enc-ruim"; }
    else if (a.temVerba) { mgv = esc(pct(a.margemComVerba)); mgvCls = a.margemComVerba < 0 ? "enc-ruim" : "enc-bom"; }
    var mgvSub = a.temVerba && !a.margemComVerbaCalculavel ? "complete verba e quantidade, ou a bonificação “a cada N leva M”" : (a.margemComVerbaCalculavel ? "custo efetivo " + brl(a.custoComVerba, 3) : "");
    // Custo do VR não confiável: comparar com ele pareceria ganho ou perda — a variação fica sem cor.
    var varTxt = a.variacaoIndisponivel ? '<span class="enc-apagado">' + esc(a.variacaoIndisponivel) + "</span>"
      : tem(a.variacaoRS) ? esc(brlS(a.variacaoRS)) + " (" + esc(pctS(a.variacaoPct)) + ")" : "—";
    var varCls = !a.variacaoIndisponivel && tem(a.variacaoRS) ? (a.variacaoRS <= 0 ? "enc-bom" : "enc-ruim") : "";
    var varSub = a.variacaoIndisponivel || tem(a.variacaoRS) ? "" : "sem custo do VR para comparar";
    var revisar = podeMexer && esc1 && esperandoComprador(v);
    var x = '<div class="enc-prop' + (esc1 ? " enc-escolhida" : "") + '"><div class="enc-pn"><span>Proposta ' + (i + 1) + "</span>" + (esc1 ? '<span style="color:#1f8a4c">✓ Escolhida' + (v.escolhida_por_nome ? " por " + esc(v.escolhida_por_nome) : "") + "</span>" : "") + "</div>" +
      '<div class="enc-pdesc">' + esc(L.length ? L[0].descricao : descProd(p)) + "</div>" +
      (L.length > 1 ? '<div class="enc-pf">+ ' + esc(L.slice(1).map(function (q) { return q.descricao; }).join(", ")) + "</div>" : "") +
      '<div class="enc-pf">' + esc(p.fornecedor_nome || "") + " · registrada por " + esc(p.registrado_por_nome || "—") + " em " + esc(quando(p.registrado_em)) + "</div>" +
      '<dl class="enc-num">' +
      linha("Custo hoje (VR)", custoHoje, "", p.dados_vr_em ? "ficha de " + esc(quando(p.dados_vr_em)) : "") +
      linha("Custo negociado<small>por unidade de venda, com impostos</small>", esc(brl(a.custoNegociado, 3))) +
      linha("Variação na negociação", varTxt, varCls, varSub) +
      linha("Preço normal", esc(brl(a.precoNormal))) +
      linha("Preço no encarte", tem(a.precoOferta) ? esc(brl(a.precoOferta)) : '<span class="enc-apagado">não informado</span>') +
      linha("Desconto para o cliente", tem(a.descontoCliente) ? esc(pct(a.descontoCliente)) + " (" + esc(brl(a.descontoClienteRS)) + ")" : "—") +
      linha("Margem (sem verba)", tem(a.margem) ? esc(pct(a.margem)) : '<span class="enc-apagado">indisponível</span>', tem(a.margem) && a.margem < 0 ? "enc-ruim" : "",
        tem(a.margem) ? "sobre o custo " + (a.origemCusto === "negociado" ? "negociado" : "do VR") : (!tem(a.precoOferta) ? "falta o preço no encarte" : "falta o custo")) +
      linha("Verba", esc(verbaTxt), "", a.verbaPorUnidade ? brl(a.verbaPorUnidade, 3) + " por unidade" : "") +
      linha("Bonificação", esc(bonTxt)) +
      linha("Margem com verba", mgv, mgvCls, mgvSub) +
      linha("Estoque hoje (VR)", fic && tem(fic.estoque) ? esc(milhar(fic.estoque)) + " un" : "—") +
      linha("Venda 30 dias (VR)", fic && tem(fic.venda30_qtd) ? esc(milhar(fic.venda30_qtd)) + " un" : "—") +
      linha("Condição de pagamento", esc(p.condicao_pagamento || "—")) +
      linha("Quantidade mínima", esc(p.quantidade_minima || "—")) +
      linha("Proposta vale até", p.validade ? esc(dmy(p.validade)) : "—") + "</dl>";
    if (a.alertas.length) x += '<ul class="enc-alertas">' + a.alertas.map(function (al) { return '<li class="' + (alertaVermelho(al) ? "enc-vermelho" : "") + '">⚠ ' + esc(al.texto) + "</li>"; }).join("") + "</ul>";
    if (p.observacao) x += '<div class="enc-obs">' + esc(p.observacao) + "</div>";
    if (podeMexer) {
      // Vaga devolvida e a escolhida continua valendo: escolher DE NOVO é o comprador dizendo "revisei" (o banco aceita).
      x += '<div class="enc-pacoes">' + (esc1 ? (revisar ? '<button class="enc-bt-p" data-ea="escolher-prop" data-id="' + esc(p.id) + '">Escolher de novo (revisada)</button>' : "")
          : '<button class="enc-bt-p" data-ea="escolher-prop" data-id="' + esc(p.id) + '">Escolher esta</button>') +
        '<button class="enc-bt" data-ea="editar-prop" data-id="' + esc(p.id) + '">Editar</button><button class="enc-bt-perigo" data-ea="descartar-prop" data-id="' + esc(p.id) + '">Descartar</button></div>';
    }
    return x + "</div>";
  }
  // Ficha do VR dos produtos das propostas (lida por código, com teto). Preenche depois de desenhar.
  function completarFicha(det, v) {
    var ids = [];
    propostasDe(det, v.id).forEach(function (p) { (p.produtos || []).forEach(function (id) { if (ids.indexOf(id) < 0) ids.push(id); }); });
    var alvo = function () { var t = estrutura(); return t && t.querySelector("[data-enc-ficha]"); };
    if (!ids.length) { var el0 = alvo(); if (el0) el0.innerHTML = '<p class="enc-sub">Ainda sem produto: a ficha aparece quando houver proposta.</p>'; return; }
    var faltava = ids.some(function (id) { return !A.fichaGuardada(id); });
    A.fichas(ids.slice(0, 50)).then(function (mapa) {
      if (!R || R.tela !== "vaga" || R.vaga !== v.id) return;
      if (faltava && ids.some(function (id) { return mapa[id]; })) { var d = A.detalheGuardado(R.id); if (d) { pinta(telaVaga(d, v)); } }
      var el = alvo(); if (!el) return;
      var linhas = ids.map(function (id) { return mapa[id]; }).filter(Boolean);
      if (!linhas.length) { el.innerHTML = '<p class="enc-sub">A ficha destes produtos não está na nuvem.</p>'; return; }
      // No celular a tabela vira um cartão por produto (enc-cartoes-cel): cada célula leva o nome da coluna em data-rot.
      el.innerHTML = '<div class="enc-tw"><table class="enc-tab enc-num enc-cartoes-cel"><thead><tr><th>Produto</th><th class="enc-r">Venda 30d</th><th class="enc-r">Preço normal</th><th class="enc-r">Custo</th><th class="enc-r">Estoque</th><th>Última oferta</th></tr></thead><tbody>' +
        linhas.map(function (f) {
          var uo = objeto(f.ultima_oferta);
          return '<tr><td class="enc-tc-nome">' + esc(f.descricao) + (f.em_oferta ? ' <span class="enc-tag">em oferta agora</span>' : "") + '</td><td class="enc-r" data-rot="Venda 30d">' + esc(milhar(f.venda30_qtd)) + ' un</td><td class="enc-r" data-rot="Preço normal">' + esc(brl(f.preco_normal)) +
            '</td><td class="enc-r" data-rot="Custo">' + (tem(f.custo) && +f.custo > 0 ? esc(brl(f.custo, 3)) + (f.custo_confiavel === false ? '<span class="enc-tag">Custo não confiável</span>' : "") : '<span class="enc-tag enc-vermelho">Sem custo no VR</span>') +
            '</td><td class="enc-r" data-rot="Estoque">' + esc(milhar(f.estoque)) + '</td><td class="enc-nw" data-rot="Última oferta">' + (uo && uo.inicio ? esc(dm(uo.inicio)) + " · " + esc(brl(uo.preco)) : "—") + "</td></tr>";
        }).join("") + "</tbody></table></div>" +
        linhas.map(function (f) {
          var fs = objeto(f.fornecedores) || [];
          return fs.length ? '<div class="enc-sub" style="margin-top:8px"><b>' + esc(f.descricao) + '</b> — fornecedores da ficha:<div class="enc-fornecedores">' + fs.map(function (x) {
            return "<span>" + esc(x.nome) + (tem(x.custotabela) ? " · tabela " + esc(brl(x.custotabela, 3)) : "") + (x.ultima_compra ? " · comprou " + esc(dm(x.ultima_compra)) : "") + "</span>";
          }).join("") + "</div></div>" : "";
        }).join("");
      maisVendidos(v, linhas[0]);
    }, function () { var el = alvo(); if (el) el.innerHTML = '<p class="enc-sub">Não deu para ler a ficha agora.</p>'; });
  }
  /* Referência para negociar: os mais vendidos do MESMO grupo do VR (30 dias), pela mesma busca
     com teto — nunca a ficha inteira. O grupo vem da categoria da vaga ou do 1º produto proposto. */
  function maisVendidos(v, f) {
    var cv = categoriaVr(v) || (f && tem(f.m1) ? { m1: +f.m1, m2: tem(f.m2) ? +f.m2 : null } : null);
    if (!cv) return;
    A.buscar("", cv.m1, cv.m2).then(function (r) {
      if (!R || R.tela !== "vaga" || R.vaga !== v.id) return;
      var t = estrutura(), el = t && t.querySelector("[data-enc-grupo]"); if (!el) return;
      var L = (r.produtos || []).slice(0, 8);
      if (!L.length) { el.innerHTML = ""; return; }
      el.innerHTML = '<h3 style="font-size:14px;margin:14px 0 2px">Os mais vendidos do grupo ' + esc((f && f.grupo) || "") + " (30 dias)</h3>" +
        '<div class="enc-tw"><table class="enc-tab enc-num enc-cartoes-cel"><thead><tr><th>Produto</th><th class="enc-r">Venda 30d</th><th class="enc-r">Preço normal</th><th class="enc-r">Custo</th><th class="enc-r">Margem</th><th>Última oferta</th></tr></thead><tbody>' +
        L.map(function (g) {
          var uo = objeto(g.ultima_oferta), c = tem(g.custo) && +g.custo > 0 ? +g.custo : null;
          return '<tr><td class="enc-tc-nome">' + esc(g.descricao) + '</td><td class="enc-r" data-rot="Venda 30d">' + esc(milhar(g.venda30_qtd)) + ' un</td><td class="enc-r" data-rot="Preço normal">' + esc(brl(g.preco_normal)) + '</td><td class="enc-r" data-rot="Custo">' +
            (c === null ? '<span class="enc-tag enc-vermelho">Sem custo no VR</span>' : esc(brl(c, 3))) + '</td><td class="enc-r" data-rot="Margem">' +
            (c !== null && g.custo_confiavel === true ? esc(pct(E.margem(g.preco_normal, c))) : "—") + '</td><td class="enc-nw" data-rot="Última oferta">' + (uo && uo.inicio ? esc(dm(uo.inicio)) + " · " + esc(brl(uo.preco)) : "—") + "</td></tr>";
        }).join("") + "</tbody></table></div>";
    });
  }

  /* ======================= JANELAS ======================= */
  function camada() { estrutura(); return RAIZ.querySelector(":scope > .enc-camada"); }
  function janela(o) {
    fecharJanela();
    var c = camada(); if (!c) return null;
    var d = document.createElement("div");
    d.className = "enc-fundo";
    d.innerHTML = '<div class="enc-janela' + (o.larga ? " enc-larga" : "") + '" role="dialog" aria-modal="true" aria-label="' + esc(o.titulo) + '">' +
      '<div class="enc-jcab"><h3>' + esc(o.titulo) + '</h3><button class="enc-bt-l" data-ea="jan-fechar">Fechar</button></div>' +
      '<div class="enc-jcorpo">' + o.corpo + '</div><div class="enc-jpe"><div class="enc-jmsg" role="status"></div>' +
      '<button class="enc-bt" data-ea="jan-fechar">Cancelar</button>' + (o.ok ? '<button class="enc-bt-p" data-ea="jan-ok">' + esc(o.ok) + "</button>" : "") + "</div></div>";
    c.appendChild(d);
    JAN = { el: d, o: o, ocupado: false, estado: o.estado || {} };
    d.addEventListener("mousedown", function (e) { if (e.target === d) fecharJanela(); });
    if (o.aoMontar) o.aoMontar(d, JAN);
    var f = d.querySelector("input:not([type=checkbox]):not([type=radio]),select,textarea");
    if (f && !o.semFoco) try { f.focus(); } catch (e) {}
    return JAN;
  }
  function fecharJanela() { if (JAN && JAN.el && JAN.el.parentNode) JAN.el.parentNode.removeChild(JAN.el); JAN = null; }
  function jq(sel) { return JAN ? JAN.el.querySelector(sel) : null; }
  function jval(sel) { var e = jq(sel); return e ? e.value : ""; }
  function jmsg(txt, tipo) { var e = jq(".enc-jmsg"); if (e) { e.innerHTML = txt ? '<div class="enc-msg' + (tipo ? " enc-" + tipo : " enc-erro") + '" style="margin:0">' + esc(txt) + "</div>" : ""; } }
  function jocupado(b, rot) { if (!JAN) return; JAN.ocupado = b; var k = jq('[data-ea="jan-ok"]'); if (k) { k.disabled = b; if (rot) k.textContent = rot; } }
  function jok(rot) { var k = jq('[data-ea="jan-ok"]'); if (k) k.textContent = rot; }
  function mensagemErro(r) { return r && r.erro ? r.erro : "Não deu para gravar agora. Tente de novo."; }
  function depoisDeGravar(edId, txt, tipo) {
    AVISO = txt ? { edicao: edId, txt: txt, tipo: tipo || "" } : null;
    fecharJanela();
    return recarregarDetalhe(edId);
  }
  function detAtual() { return R && R.id ? A.detalheGuardado(R.id) : null; }

  /* ---------- + vaga só nesta edição ---------- */
  function janelaNovaVaga() {
    var det = detAtual(); if (!det) return;
    var gs = det.grupos.filter(function (g) { return g.situacao !== "removido"; }).sort(function (a, b) { return (a.ordem || 0) - (b.ordem || 0); });
    janela({ titulo: "+ Vaga só nesta edição", ok: "Incluir vaga",
      corpo: '<p class="enc-sub" style="margin-top:0">A vaga nasce pendente e entra na próxima Aprovação do Encarte. O modelo não muda.</p>' +
        '<div class="enc-grade-f"><label class="enc-campo enc-obrig"><span>Grupo</span><select data-f="grupo">' + gs.map(function (g) { return '<option value="' + esc(g.id) + '">' + esc(g.nome) + "</option>"; }).join("") + "</select></label>" +
        '<label class="enc-campo enc-obrig"><span>Nome da vaga</span><input data-f="nome" maxlength="60" placeholder="ex.: Azeite"></label>' +
        '<label class="enc-campo"><span>O que muda</span><input data-f="muda" maxlength="40" placeholder="marca, corte, tipo, produto"></label>' +
        '<label class="enc-check" style="align-self:end"><input type="checkbox" data-f="obrig" checked> Obrigatória</label></div>',
      aoOk: function () {
        var nome = jval('[data-f="nome"]').trim();
        if (!nome) return jmsg("Dê um nome à vaga.");
        jocupado(true);
        A.rpc("encarte_adicionar_vaga", { p_edicao: det.edicao.id, p_grupo: jval('[data-f="grupo"]'), p_nome: nome, p_o_que_muda: jval('[data-f="muda"]').trim() || null, p_obrigatoria: !!(jq('[data-f="obrig"]') || {}).checked })
          .then(function (r) { if (!r.ok) { jocupado(false); return jmsg(mensagemErro(r)); } depoisDeGravar(det.edicao.id, "Vaga “" + nome + "” incluída só nesta edição."); });
      } });
  }

  /* ---------- retirar vaga ---------- */
  function janelaRetirar() {
    var det = detAtual(); if (!det) return;
    var v = det.vagas.filter(function (x) { return x.id === R.vaga; })[0]; if (!v) return;
    var g = grupoDe(det, v.grupo_id) || {}, noArJa = hoje() >= inicioGrupo(g, det.edicao);
    janela({ titulo: "Retirar a vaga " + v.nome, ok: "Retirar vaga",
      corpo: (noArJa ? '<div class="enc-aviso enc-vermelho"><span>⛔</span><div>O encarte já está no ar: a retirada fica registrada como <b>crítica</b> no histórico.</div></div>' : "") +
        '<label class="enc-campo enc-obrig"><span>Motivo</span><textarea data-f="motivo" rows="3" maxlength="200" placeholder="ex.: fornecedor não confirmou o estoque"></textarea></label>',
      aoOk: function () {
        var mot = jval('[data-f="motivo"]').trim();
        if (!mot) return jmsg("Diga o motivo de retirar a vaga.");
        jocupado(true);
        A.rpc("encarte_retirar_vaga", { p_vaga: v.id, p_motivo: mot }).then(function (r) {
          if (!r.ok) { jocupado(false); return jmsg(mensagemErro(r)); }
          AVISO = { edicao: det.edicao.id, txt: "Vaga “" + v.nome + "” retirada." + (r.data && r.data.critica ? " Registrada como crítica (encarte no ar)." : ""), tipo: r.data && r.data.critica ? "alerta" : "" };
          fecharJanela(); R = { tela: "edicao", id: det.edicao.id }; recarregarDetalhe(det.edicao.id);
        });
      } });
  }

  /* ---------- nova proposta / editar proposta ---------- */
  var CAMPOS_P = ["custo_negociado", "preco_oferta", "verba_valor", "verba_qtd_base", "bonif_compra", "bonif_ganha", "bonificacao_texto", "condicao_pagamento", "quantidade_minima", "validade", "observacao"];
  function janelaProposta(propId) {
    var det = detAtual(); if (!det) return;
    var v = det.vagas.filter(function (x) { return x.id === R.vaga; })[0]; if (!v) return;
    var g = grupoDe(det, v.grupo_id) || {}, ini = inicioGrupo(g, det.edicao);
    var orig = propId ? det.propostas.filter(function (p) { return p.id === propId; })[0] : null;
    var cv = categoriaVr(v);
    var st = { produtos: [], forn: orig ? { id: orig.fornecedor_id, nome: orig.fornecedor_nome } : null, confirmado: false, busca: null, cat: !!cv };
    if (orig) (orig.produtos || []).forEach(function (id, i) { var info = (objeto(orig.produtos_info) || [])[i] || {}; st.produtos.push({ produto_id: id, descricao: info.descricao || ("Produto " + id) }); });
    function campo(k, rot, ph, extra) {
      var val = orig ? (k === "validade" ? (orig[k] || "") : ["custo_negociado", "preco_oferta", "verba_valor", "verba_qtd_base", "bonif_compra", "bonif_ganha"].indexOf(k) >= 0 ? numCampo(orig[k]) : (orig[k] || "")) : "";
      return '<label class="enc-campo' + (extra && extra.obrig ? " enc-obrig" : "") + '"><span>' + rot + "</span>" +
        (k === "observacao" ? '<textarea data-p="' + k + '" rows="2" maxlength="300">' + esc(val) + "</textarea>"
          : '<input data-p="' + k + '"' + (k === "validade" ? ' type="date"' : ' inputmode="' + (extra && extra.texto ? "text" : "decimal") + '"') + ' value="' + esc(val) + '" placeholder="' + esc(ph || "") + '"' + (extra && extra.max ? ' maxlength="' + extra.max + '"' : "") + ">") +
        (extra && extra.dica ? "<small>" + extra.dica + "</small>" : "") + "</label>";
    }
    var corpo = '<div class="enc-campo enc-obrig"><span>Produto do VR</span><input data-f="busca" autocomplete="off" placeholder="Digite parte do nome ou o código de barras">' +
      (cv ? '<label class="enc-check" style="margin-top:4px"><input type="checkbox" data-f="cat" checked> Só da categoria desta vaga (' + esc(v.categoria_vr) + ")</label>" : "") +
      '<small>A busca vai à ficha do VR na nuvem (no máximo 20 por vez). Dá para escolher mais de um produto (variações).</small></div>' +
      '<div class="enc-escolhidos" data-f="escolhidos"></div><div class="enc-busca-res" data-f="res" hidden></div>' +
      '<div class="enc-grade-f"><label class="enc-campo enc-obrig"><span>Fornecedor</span><select data-f="forn"></select></label>' +
      '<label class="enc-campo" data-f="forn-outro-box" hidden><span>Nome do fornecedor</span><input data-f="forn-outro" maxlength="80"></label>' +
      campo("custo_negociado", "Custo negociado (R$)", "ex.: 9,29", { obrig: 1, dica: "por unidade de venda, com impostos" }) +
      campo("preco_oferta", "Preço no encarte (R$)", "ex.: 10,89") +
      campo("verba_valor", "Verba (R$)", "ex.: 800,00", { dica: "valor total que o fornecedor paga" }) +
      campo("verba_qtd_base", "Verba vale para quantas unidades", "ex.: 960") +
      '<div class="enc-campo"><span>Bonificação</span><div class="enc-inline">a cada <input data-p="bonif_compra" inputmode="numeric" value="' + esc(orig ? numCampo(orig.bonif_compra) : "") + '"> leva <input data-p="bonif_ganha" inputmode="numeric" value="' + esc(orig ? numCampo(orig.bonif_ganha) : "") + '"></div><small>ex.: a cada 20 leva 1 (grátis)</small></div>' +
      campo("bonificacao_texto", "Bonificação (texto livre)", "ex.: 1 cx a cada 20 cx", { texto: 1, max: 120, dica: "só texto não entra na conta da margem" }) +
      campo("condicao_pagamento", "Condição de pagamento", "ex.: 28 dias", { texto: 1, max: 60 }) +
      campo("quantidade_minima", "Quantidade mínima", "ex.: 1.200 un", { texto: 1, max: 60 }) +
      campo("validade", "Proposta vale até") + "</div>" +
      '<div style="margin-top:10px">' + campo("observacao", "Observação", "") + "</div>" +
      (orig ? '<label class="enc-campo" style="margin-top:10px"><span>Motivo da mudança (fica no histórico)</span><input data-f="motivo" maxlength="200"></label>' : "") +
      '<div class="enc-conta" data-f="conta"></div><div class="enc-nota">Obrigatórios: produto, fornecedor e custo negociado. O resto pode ficar em branco (branco não vira zero).</div>';
    janela({ titulo: (orig ? "Editar proposta · " : "Nova proposta · ") + v.nome, ok: orig ? "Gravar mudança" : "Registrar proposta", larga: true, corpo: corpo, estado: st,
      aoMontar: function () {
        pintaEscolhidos(); pintaFornecedores(); conta();
        // editando: a lista de fornecedores e o custo de hoje vêm da ficha do produto (lida por código)
        if (st.produtos.length) A.fichas(st.produtos.map(function (p) { return p.produto_id; })).then(function () { if (JAN && JAN.estado === st) { pintaFornecedores(); conta(); } });
      },
      aoInput: function (el) {
        if (el.getAttribute("data-f") === "busca") { clearTimeout(st.t); st.t = setTimeout(buscarAgora, 350); return; }
        if (el.getAttribute("data-f") === "cat") { st.cat = el.checked; buscarAgora(); return; }
        if (el.getAttribute("data-f") === "forn") { var o = jq('[data-f="forn-outro-box"]'); if (o) o.hidden = el.value !== "outro"; }
        st.confirmado = false; jok(orig ? "Gravar mudança" : "Registrar proposta"); jmsg("");
        conta();
      },
      aoAcao: function (acao, alvo) {
        if (acao === "bp-add") {
          var id = +alvo.getAttribute("data-id");
          if (!st.produtos.some(function (p) { return p.produto_id === id; })) { var f = A.fichaGuardada(id) || {}; st.produtos.push({ produto_id: id, descricao: f.descricao || ("Produto " + id) }); }
          pintaEscolhidos(); pintaFornecedores(); conta(); return true;
        }
        if (acao === "bp-tirar") { var k = +alvo.getAttribute("data-id"); st.produtos = st.produtos.filter(function (p) { return p.produto_id !== k; }); pintaEscolhidos(); pintaFornecedores(); conta(); return true; }
        return false;
      },
      aoOk: gravar });
    function buscarAgora() {
      var t = jval('[data-f="busca"]').trim(), box = jq('[data-f="res"]');
      if (!box) return;
      if (t.length < 2) { box.hidden = true; box.innerHTML = ""; return; }
      box.hidden = false; box.innerHTML = '<div class="enc-carregando">Buscando…</div>';
      var seq = st.busca = (st.busca || 0) + 1;
      A.buscar(t, st.cat && cv ? cv.m1 : null, st.cat && cv ? cv.m2 : null).then(function (r) {
        if (!JAN || st.busca !== seq) return;
        var b = jq('[data-f="res"]'); if (!b) return;
        if (r.erro) { b.innerHTML = '<div class="enc-carregando">' + esc(r.erro) + "</div>"; return; }
        b.innerHTML = r.produtos.length ? r.produtos.map(function (f) {
          return '<button type="button" data-ea="bp-add" data-id="' + esc(f.produto_id) + '"><b>' + esc(f.descricao) + "</b><small>" +
            (tem(f.custo) && +f.custo > 0 ? "custo " + esc(brl(f.custo, 3)) + (f.custo_confiavel === false ? " (Custo não confiável)" : "") : "Sem custo no VR") +
            " · preço " + esc(brl(f.preco_normal)) + " · estoque " + esc(milhar(f.estoque)) + " · vende " + esc(milhar(f.venda30_qtd)) + "/mês" +
            (f.ultima_compra_fornecedor ? " · última compra: " + esc(f.ultima_compra_fornecedor) : "") + "</small></button>";
        }).join("") : '<div class="enc-carregando">Nada encontrado' + (st.cat && cv ? " nesta categoria (desmarque o filtro para buscar em tudo)" : "") + ".</div>";
      });
    }
    function pintaEscolhidos() {
      var b = jq('[data-f="escolhidos"]'); if (!b) return;
      b.innerHTML = st.produtos.map(function (p) { return "<span>" + esc(p.descricao) + ' <button type="button" data-ea="bp-tirar" data-id="' + esc(p.produto_id) + '" aria-label="Tirar">×</button></span>'; }).join("");
    }
    function pintaFornecedores() {
      var s = jq('[data-f="forn"]'); if (!s) return;
      var f = st.produtos.length ? A.fichaGuardada(st.produtos[0].produto_id) : null;
      var L = (f && objeto(f.fornecedores)) || [];
      var atual = s.value || (st.forn ? (tem(st.forn.id) ? String(st.forn.id) : "outro") : "");
      var ops = L.map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(x.nome) + (tem(x.custotabela) ? " · tabela " + esc(brl(x.custotabela, 3)) : "") + (x.ultima_compra ? " · comprou " + esc(dm(x.ultima_compra)) : "") + "</option>"; });
      if (st.forn && tem(st.forn.id) && !L.some(function (x) { return String(x.id) === String(st.forn.id); })) ops.unshift('<option value="' + esc(st.forn.id) + '">' + esc(st.forn.nome) + "</option>");
      s.innerHTML = (ops.length ? "" : '<option value="">' + (st.produtos.length ? "A ficha não tem fornecedor: use “Outro”" : "Escolha o produto primeiro") + "</option>") + ops.join("") + '<option value="outro">Outro fornecedor…</option>';
      if (atual && s.querySelector('option[value="' + atual + '"]')) s.value = atual;
      var o = jq('[data-f="forn-outro-box"]'); if (o) o.hidden = s.value !== "outro";
      if (s.value === "outro" && st.forn && !tem(st.forn.id)) { var i = jq('[data-f="forn-outro"]'); if (i && !i.value) i.value = st.forn.nome || ""; }
    }
    function lerForm() {
      var p = {}, erro = null;
      CAMPOS_P.forEach(function (k) {
        var el = jq('[data-p="' + k + '"]'); if (!el) return;
        var t = el.value;
        if (["custo_negociado", "preco_oferta", "verba_valor", "verba_qtd_base", "bonif_compra", "bonif_ganha"].indexOf(k) >= 0) {
          var x = lerNum(t);
          if (x !== null && isNaN(x)) erro = erro || "Número inválido em “" + (ROTULO_CAMPO[k] || k) + "”.";
          if ((k === "bonif_compra" || k === "bonif_ganha") && x !== null && !isNaN(x) && Math.floor(x) !== x) erro = erro || "A bonificação é em unidades inteiras.";
          p[k] = x === null || isNaN(x) ? null : x;
        } else p[k] = String(t || "").trim() || null;
      });
      var s = jq('[data-f="forn"]'), fv = s ? s.value : "";
      if (fv === "outro" || !fv) { p.fornecedor_id = null; p.fornecedor_nome = jval('[data-f="forn-outro"]').trim() || null; }
      else { var opt = s.options[s.selectedIndex]; p.fornecedor_id = +fv; p.fornecedor_nome = String(opt ? opt.textContent : "").split(" · ")[0].trim(); }
      p.produtos = st.produtos.map(function (x) { return x.produto_id; });
      return { p: p, erro: erro };
    }
    function conta() {
      var b = jq('[data-f="conta"]'); if (!b) return;
      var lf = lerForm().p;
      if (!st.produtos.length) { b.innerHTML = '<span class="enc-apagado">Escolha o produto para ver as contas (custo de hoje, variação e margem).</span>'; return; }
      // Editando SEM trocar produto: o banco guarda o RETRATO do dia do registro e só tira outro
      // quando os produtos mudam — as contas usam o mesmo retrato, senão a janela mostraria um
      // custo de hoje, uma variação e uma margem diferentes do que fica gravado.
      var mesmos = !!orig && (orig.produtos || []).join(",") === st.produtos.map(function (x) { return x.produto_id; }).join(",");
      var f = mesmos ? null : A.fichaGuardada(st.produtos[0].produto_id);
      var base = mesmos ? { custo_hoje: orig.custo_hoje, custo_confiavel: orig.custo_confiavel, preco_normal: orig.preco_normal } :
        { custo_hoje: f && +f.custo > 0 ? f.custo : null, custo_confiavel: f ? f.custo_confiavel : null, preco_normal: f ? f.preco_normal : null };
      var a = E.analiseProposta({ custo_hoje: base.custo_hoje, custo_confiavel: base.custo_confiavel, preco_normal: base.preco_normal, custo_negociado: lf.custo_negociado,
        preco_oferta: lf.preco_oferta, verba_valor: lf.verba_valor, verba_qtd_base: lf.verba_qtd_base, bonif_compra: lf.bonif_compra, bonif_ganha: lf.bonif_ganha,
        bonificacao_texto: lf.bonificacao_texto, validade: lf.validade }, { inicio: ini });
      // Número fora de escala (vírgula esquecida, zero a mais): avisa, não bloqueia.
      var cvr = tem(base.custo_hoje) && +base.custo_hoje > 0 ? +base.custo_hoje : null, longe = [];
      if (cvr !== null) [["custo_negociado", "custo negociado"], ["preco_oferta", "preço no encarte"]].forEach(function (k) {
        var y = lf[k[0]]; if (tem(y) && y > 0 && (y > cvr * 5 || y < cvr / 5)) longe.push(k[1]);
      });
      b.innerHTML = "<b>As contas</b> (nada é gravado ainda): custo hoje " + (a.semCusto ? "<b>Sem custo no VR</b>" : esc(brl(a.custoHoje, 3)) + (a.custoConfiavel ? "" : " (<b>Custo não confiável</b>)")) +
        " · negociado " + esc(brl(a.custoNegociado, 3)) + (a.variacaoIndisponivel ? " (variação " + esc(a.variacaoIndisponivel) + ")" : tem(a.variacaoRS) ? " (" + esc(brlS(a.variacaoRS)) + ", " + esc(pctS(a.variacaoPct)) + ")" : "") +
        " · margem " + (tem(a.margem) ? esc(pct(a.margem)) : "indisponível") +
        (a.temVerba ? " · com verba " + (!a.margemComVerbaCalculavel ? "não calculável" : tem(a.margemComVerba) ? esc(pct(a.margemComVerba)) : "indisponível (verba maior que o custo)") : "") +
        (a.alertas.length ? "<br>" + a.alertas.map(function (x) { return "⚠ " + esc(x.texto); }).join(" · ") : "") +
        (longe.length ? '<div class="enc-longe">⚠ Confira: valor muito diferente do custo do VR (' + esc(longe.join(" e ")) + " × custo do VR " + esc(brl(cvr, 3)) + ").</div>" : "");
    }
    function gravar() {
      var lf = lerForm(), p = lf.p;
      if (lf.erro) return jmsg(lf.erro);
      if (!p.produtos.length) return jmsg("Escolha ao menos um produto do VR.");
      if (!p.fornecedor_nome) return jmsg("Informe o fornecedor.");
      if (!tem(p.custo_negociado) || p.custo_negociado <= 0) return jmsg("Informe o custo negociado (por unidade de venda, com impostos).");
      if ((tem(p.bonif_compra) || tem(p.bonif_ganha)) && !(tem(p.bonif_compra) && tem(p.bonif_ganha))) return jmsg("Na bonificação, preencha os dois números (a cada N leva M) ou nenhum.");
      if (!orig) {
        var envio = {}; Object.keys(p).forEach(function (k) { if (p[k] !== null && p[k] !== undefined) envio[k] = p[k]; });
        jocupado(true);
        return A.rpc("encarte_registrar_proposta", { p_vaga: v.id, p: envio }).then(function (r) {
          if (!r.ok) { jocupado(false); return jmsg(mensagemErro(r)); }
          depoisDeGravar(det.edicao.id, "Proposta registrada." + (r.data && r.data.custo_hoje == null ? " Atenção: o VR não tem custo deste produto (Sem custo no VR)." : ""));
        });
      }
      // Editar: manda só o que mudou (null limpa o campo).
      var mud = {};
      function igual(a, b) { if (a === null || a === undefined || a === "") return b === null || b === undefined || b === ""; return String(a) === String(b); }
      CAMPOS_P.forEach(function (k) {
        var a = orig[k], b = p[k];
        if (["custo_negociado", "preco_oferta", "verba_valor", "verba_qtd_base", "bonif_compra", "bonif_ganha"].indexOf(k) >= 0) { if (!(tem(a) ? tem(b) && Math.abs(+a - +b) < 1e-9 : !tem(b))) mud[k] = b; }
        else if (!igual(a, b)) mud[k] = b;
      });
      if ((orig.produtos || []).join(",") !== p.produtos.join(",")) mud.produtos = p.produtos;
      if (String(orig.fornecedor_nome || "") !== String(p.fornecedor_nome || "")) mud.fornecedor_nome = p.fornecedor_nome;
      if (String(tem(orig.fornecedor_id) ? +orig.fornecedor_id : "") !== String(tem(p.fornecedor_id) ? p.fornecedor_id : "")) mud.fornecedor_id = p.fornecedor_id;
      if (!Object.keys(mud).length) return jmsg("Nada mudou.", "alerta");
      // Se é a escolhida, avisa ANTES o que a mudança provoca (quem decide é o banco). O cálculo
      // não sabe o estado da vaga: no ar (período do GRUPO) avisa a crítica; antes do ar, "volta
      // para Aguardando visto" só vale para vaga APROVADA — pendente, em ajuste ou já aguardando
      // visto não reabrem (o banco só reabre 'aprovada').
      if (v.proposta_escolhida === orig.id && !st.confirmado) {
        var depois = {}; Object.keys(orig).forEach(function (k) { depois[k] = orig[k]; }); Object.keys(mud).forEach(function (k) { depois[k] = mud[k]; });
        var mm = E.mudancaMaterial(orig, depois, { hoje: hoje(), inicio: ini });
        if (mm.critica || (mm.reabre && v.estado === "aprovada")) {
          st.confirmado = true; jok("Gravar mesmo assim");
          return jmsg(mm.critica ? "O encarte já está no ar: esta mudança fica registrada como CRÍTICA (" + mm.motivos.join(", ") + ")."
            : "Esta vaga já foi aprovada. Com esta mudança ela volta para Aguardando visto (" + mm.motivos.join(", ") + ").", "alerta");
        }
      }
      var mot = jval('[data-f="motivo"]').trim(); if (mot) mud.motivo = mot;
      jocupado(true);
      A.rpc("encarte_editar_proposta", { p_id: orig.id, p: mud }).then(function (r) {
        if (!r.ok) { jocupado(false); return jmsg(mensagemErro(r)); }
        var d = r.data || {};
        depoisDeGravar(det.edicao.id, d.mudou === false ? "Nada mudou." : "Proposta alterada." + (d.reabriu ? " A vaga voltou para Aguardando visto." : "") + (d.critica ? " Registrada como crítica (encarte no ar)." : ""), d.reabriu || d.critica ? "alerta" : "");
      });
    }
  }

  /* ---------- escolher / descartar ---------- */
  function escolher(propId) {
    var det = detAtual(); if (!det) return;
    var v = det.vagas.filter(function (x) { return x.id === R.vaga; })[0]; if (!v) return;
    var p = det.propostas.filter(function (x) { return x.id === propId; })[0]; if (!p) return;
    var g = grupoDe(det, v.grupo_id) || {}, ini = inicioGrupo(g, det.edicao);
    // A mesma de novo (vaga devolvida): não muda nada material, é só o "revisei" do comprador.
    var mesma = v.proposta_escolhida === p.id;
    var antes = mesma ? null : escolhidaDe(det, v) || (v.estado === "aprovada" ? objeto(v.foto_aprovada) : null);
    var mm = antes ? E.mudancaMaterial(antes, p, { hoje: hoje(), inicio: ini }) : null;
    // No ar: avisa a crítica (qualquer estado). Antes do ar: "volta para Aguardando visto" só se a vaga está APROVADA.
    var avisa = !!mm && (mm.critica || (mm.reabre && v.estado === "aprovada"));
    function vai() {
      if (ESCOLHENDO) return; ESCOLHENDO = true; // clique duplo não escolhe duas vezes
      return A.rpc("encarte_escolher_proposta", { p_vaga: v.id, p_proposta: p.id }).then(function (r) {
        ESCOLHENDO = false;
        if (!r.ok) { if (JAN) { jocupado(false); return jmsg(mensagemErro(r)); } AVISO = { edicao: det.edicao.id, txt: mensagemErro(r), tipo: "erro" }; return pintaDetalhe(det); }
        var d = r.data || {};
        if (d.reconfirmada) return depoisDeGravar(det.edicao.id, "Proposta confirmada de novo: a vaga volta para a próxima Aprovação do Encarte.");
        depoisDeGravar(det.edicao.id, "Proposta escolhida: " + descProd(p) + "." + (d.reabriu ? " A vaga voltou para Aguardando visto (" + razoesTxt((d.razoes || []).join(",")) + ")." : "") + (d.critica ? " Registrada como crítica (encarte no ar)." : ""), d.reabriu || d.critica ? "alerta" : "");
      });
    }
    if (avisa) {
      janela({ titulo: "Trocar a proposta escolhida", ok: "Escolher mesmo assim",
        corpo: '<div class="enc-aviso' + (mm.critica ? " enc-vermelho" : " enc-azul") + '"><span>' + (mm.critica ? "⛔" : "ℹ") + "</span><div>" +
          (mm.critica ? "O encarte já está no ar: a troca fica registrada como <b>crítica</b>: " : "Esta vaga já foi aprovada. Escolhendo esta proposta, ela volta para <b>Aguardando visto</b>: ") +
          esc(mm.motivos.join(", ")) + ".</div></div><p class=\"enc-sub\">Nova escolha: <b>" + esc(descProd(p)) + "</b> · " + esc(p.fornecedor_nome || "") + " · " + esc(brl(p.preco_oferta)) + "</p>",
        aoOk: function () { jocupado(true); vai(); } });
    } else vai();
  }
  function janelaDescartar(propId) {
    var det = detAtual(); if (!det) return;
    var v = det.vagas.filter(function (x) { return x.id === R.vaga; })[0];
    var p = det.propostas.filter(function (x) { return x.id === propId; })[0]; if (!v || !p) return;
    var g = grupoDe(det, v.grupo_id) || {}, ini = inicioGrupo(g, det.edicao), eraEsc = v.proposta_escolhida === p.id;
    var aviso = "";
    if (eraEsc) {
      var mm = E.mudancaMaterial(p, { situacao: "descartada" }, { hoje: hoje(), inicio: ini });
      aviso = '<div class="enc-aviso' + (mm.critica ? " enc-vermelho" : "") + '"><span>⚠</span><div>Esta é a proposta <b>escolhida</b>: a vaga fica sem escolha' +
        (mm.critica ? " e, com o encarte no ar, a mudança é registrada como <b>crítica</b>." : v.estado === "aprovada" ? " e volta para <b>Aguardando visto</b>." : ".") + "</div></div>";
    }
    janela({ titulo: "Descartar proposta", ok: "Descartar",
      corpo: aviso + '<p class="enc-sub" style="margin-top:0">' + esc(descProd(p)) + " · " + esc(p.fornecedor_nome || "") + ". A proposta não é apagada: fica em “Propostas descartadas” e no histórico.</p>" +
        '<label class="enc-campo"><span>Motivo (opcional)</span><input data-f="motivo" maxlength="200"></label>',
      aoOk: function () {
        jocupado(true);
        A.rpc("encarte_descartar_proposta", { p_id: p.id, p_motivo: jval('[data-f="motivo"]').trim() || null }).then(function (r) {
          if (!r.ok) { jocupado(false); return jmsg(mensagemErro(r)); }
          var d = r.data || {};
          depoisDeGravar(det.edicao.id, "Proposta descartada." + (d.reabriu ? " A vaga voltou para Aguardando visto." : "") + (d.critica ? " Registrada como crítica (encarte no ar)." : ""), d.reabriu || d.critica ? "alerta" : "");
        });
      } });
  }

  /* ---------- APROVAÇÃO DO ENCARTE (só master) ---------- */
  function janelaAprovar(grupoId) {
    var det = detAtual(); if (!det) return;
    var ed = det.edicao, versaoVista = ed.versao;
    var gs = {}; det.grupos.forEach(function (g) { gs[g.id] = g; });
    var escopo = det.vagas.filter(function (v) { return ativa(v) && (!grupoId || v.grupo_id === grupoId); });
    function ordem(a, b) { var ga = (gs[a.grupo_id] || {}).ordem || 0, gb = (gs[b.grupo_id] || {}).ordem || 0; return ga - gb || (a.ordem || 0) - (b.ordem || 0); }
    // Devolvida que o comprador ainda não mexeu: o banco não a aprova (nem a devolve de novo) —
    // aparece para o master saber que existe, sem caixa. Igual ao banco: toda "Em ajuste" que
    // não entra na aprovação (sem mexida, ou mexida mas sem proposta escolhida) espera o comprador.
    var espera = escopo.filter(function (v) { return v.estado === "em_ajuste" && (esperandoComprador(v) || !v.proposta_escolhida); }).sort(ordem);
    var lista = escopo.filter(function (v) { return v.proposta_escolhida && v.estado !== "aprovada" && !esperandoComprador(v); }).sort(ordem);
    var semDef = escopo.filter(function (v) { return !v.proposta_escolhida && v.estado !== "em_ajuste"; }).length, ja = escopo.filter(function (v) { return v.estado === "aprovada"; }).length;
    var g = grupoId ? gs[grupoId] : null;
    function margens(a) {
      return "margem " + esc(tem(a.margem) ? pct(a.margem) : "indisponível") +
        (a.margemComVerbaCalculavel ? " · com verba " + (tem(a.margemComVerba) ? esc(pct(a.margemComVerba)) : "indisponível (verba maior que o custo)") : "");
    }
    var corpo = '<p class="enc-sub" style="margin-top:0">' + esc(nomeCamp(ed.campanha_id)) + " · " + esc(E.fmtPeriodo(ed.inicio, ed.fim, { curta: true })) + (g ? " · grupo <b>" + esc(g.nome) + "</b>" : "") +
      ". Aprova as vagas definidas abaixo, menos as marcadas para devolver (essas vão para <b>Em ajuste</b>, com a categoria e uma observação curta). O que foi aprovado fica guardado como foto.</p>" +
      (semDef || ja || espera.length ? '<p class="enc-sub">' + (semDef ? semDef + (semDef === 1 ? " vaga ainda sem definição fica" : " vagas ainda sem definição ficam") + " de fora. " : "") + (ja ? ja + " já " + (ja === 1 ? "aprovada" : "aprovadas") + ". " : "") +
        (espera.length ? espera.length + (espera.length === 1 ? " em ajuste espera" : " em ajuste esperam") + " o comprador mexer e fica" + (espera.length === 1 ? "" : "m") + " para a próxima." : "") + "</p>" : "") +
      '<ul class="enc-aprov-lista">' + lista.map(function (v) {
        var p = escolhidaDe(det, v), gg = gs[v.grupo_id] || {}, a = analise(p, inicioGrupo(gg, ed));
        return '<li data-vaga="' + esc(v.id) + '"><div class="enc-aprov-l1"><div><b>' + esc(v.nome) + '</b> <span class="enc-apagado">· ' + esc(gg.nome || "") + "</span> " + estadoChip(v) +
          (v.estado === "em_ajuste" ? ' <span class="enc-apagado">(revisada pelo comprador)</span>' : "") +
          '<div class="enc-sub">' + esc(descProd(p)) + " · " + esc(p.fornecedor_nome || "") + '</div><div class="enc-sub enc-num">' + esc(brl(p.preco_oferta)) + " (normal " + esc(brl(a.precoNormal)) + ") · " +
          margens(a) + "</div>" +
          (a.alertas.length ? '<div class="enc-sub" style="color:#9a6b00">' + a.alertas.map(function (x) { return "⚠ " + esc(x.texto); }).join(" · ") + "</div>" : "") + "</div>" +
          '<label class="enc-check"><input type="checkbox" data-dev="' + esc(v.id) + '"> Devolver para ajuste</label></div>' +
          '<div class="enc-aprov-dev" data-devbox="' + esc(v.id) + '" hidden><label class="enc-campo enc-obrig"><span>Categoria</span><select data-cat="' + esc(v.id) + '"><option value="">Escolha…</option>' +
          CATEGORIAS_AJUSTE.map(function (c) { return '<option value="' + c[0] + '">' + c[1] + "</option>"; }).join("") + "</select></label>" +
          '<label class="enc-campo"><span>Observação curta</span><input data-obs="' + esc(v.id) + '" maxlength="140" placeholder="ex.: pedir R$ 0,20 a menos"></label></div></li>';
      }).join("") +
      espera.map(function (v) {
        var p = escolhidaDe(det, v), gg = gs[v.grupo_id] || {}, dv = objeto(v.devolucao) || {};
        return '<li class="enc-esperando" data-espera="' + esc(v.id) + '"><div><b>' + esc(v.nome) + '</b> <span class="enc-apagado">· ' + esc(gg.nome || "") + '</span> <span class="enc-ea enc-em_ajuste">Em ajuste — esperando o comprador</span>' +
          (p ? '<div class="enc-sub">' + esc(descProd(p)) + " · " + esc(p.fornecedor_nome || "") + "</div>" : "") +
          '<div class="enc-sub">Devolvida · ' + esc(nomeCategoria(dv.categoria)) + (dv.observacao ? ": " + esc(dv.observacao) : "") + "</div></div></li>";
      }).join("") + "</ul>" + (lista.length ? "" : '<p class="enc-sub">Nenhuma vaga definida esperando aprovação neste escopo.</p>');
    janela({ titulo: "Aprovação do Encarte" + (g ? " · " + g.nome : ""), ok: "Aprovar", larga: true, corpo: corpo, semFoco: true,
      aoMontar: function () { rotulo(); },
      aoInput: function (el) {
        var id = el.getAttribute("data-dev");
        if (id) { var box = jq('[data-devbox="' + id + '"]'); if (box) box.hidden = !el.checked; var li = jq('li[data-vaga="' + id + '"]'); if (li) li.classList.toggle("enc-devolver", el.checked); }
        jmsg(""); rotulo();
      },
      aoOk: function () {
        var devs = [], falta = null;
        lista.forEach(function (v) {
          var c = jq('[data-dev="' + v.id + '"]'); if (!c || !c.checked) return;
          var cat = jval('[data-cat="' + v.id + '"]');
          if (!cat) falta = falta || v.nome;
          devs.push({ vaga_id: v.id, categoria: cat, observacao: jval('[data-obs="' + v.id + '"]').trim() || null });
        });
        if (falta) return jmsg("Escolha a categoria do ajuste da vaga “" + falta + "”.");
        if (!lista.length) return jmsg("Nada para aprovar.");
        jocupado(true);
        A.rpc("encarte_aprovar", { p_edicao: ed.id, p_grupo: grupoId || null, p_versao_vista: versaoVista, p_devolucoes: devs }).then(function (r) {
          if (!r.ok) {
            if (/versao_mudou/.test(r.chave || "") || /versao_mudou/.test(r.erro || "")) {
              AVISO = { edicao: ed.id, txt: "O encarte mudou enquanto a tela estava aberta; confira a versão atual antes de aprovar.", tipo: "alerta" };
              fecharJanela(); return recarregarDetalhe(ed.id);
            }
            jocupado(false); return jmsg(mensagemErro(r));
          }
          var d = r.data || {}, ne = +d.em_ajuste_esperando || 0;
          depoisDeGravar(ed.id, "Aprovação do Encarte gravada: " + ((d.aprovadas || []).length) + " aprovadas, " + ((d.devolvidas || []).length) + " devolvidas para ajuste." +
            (ne ? " " + ne + (ne === 1 ? " em ajuste ficou" : " em ajuste ficaram") + " esperando o comprador." : ""));
        });
      } });
    function rotulo() {
      var nd = lista.filter(function (v) { var c = jq('[data-dev="' + v.id + '"]'); return c && c.checked; }).length, na = lista.length - nd;
      jok(na && nd ? "Aprovar " + na + " e devolver " + nd : nd ? "Devolver " + nd : "Aprovar " + na);
      var k = jq('[data-ea="jan-ok"]'); if (k) k.disabled = !lista.length;
    }
  }

  /* ---------- + AÇÃO TEMÁTICA (só master) ---------- */
  function janelaTema(edPreferida) {
    var dd = D(), h = hoje();
    var temas = (dd.modelos || []).filter(function (m) { return m.tipo === "tema" && m.ativo !== false; });
    var eds = (dd.edicoes || []).filter(function (e) { return (e.situacao || "ativa") === "ativa" && e.fim >= h; }).sort(function (a, b) { return a.inicio < b.inicio ? -1 : a.inicio > b.inicio ? 1 : 0; });
    function dataDoTema(m) {
      var r = regraDe(m.campanha_id); if (!r) return null;
      var o = E.ocorrencias(r, h, E.addDias(h, 400))[0]; if (!o) return null;
      return { data: E.inicioTema(m, o.inicio), fim: o.fim, nome: r.nome };
    }
    var comData = temas.map(function (m) { return { m: m, d: dataDoTema(m) }; }).sort(function (a, b) { var x = a.d ? a.d.data : "9", y = b.d ? b.d.data : "9"; return x < y ? -1 : x > y ? 1 : 0; });
    if (!comData.length) return janela({ titulo: "+ Ação temática", corpo: '<p class="enc-sub">Não há modelos de tema ativos. Crie em Modelos.</p>' });
    var corpo = '<label class="enc-campo enc-obrig"><span>Tema</span><select data-f="tema">' + comData.map(function (x) {
      return '<option value="' + esc(x.m.id) + '">' + esc(x.m.nome) + (x.d ? " · " + esc(dsem(x.d.data)) : " · sem data no Calendário") + "</option>";
    }).join("") + '</select></label><div class="enc-sub" data-f="dica" style="margin:6px 0"></div>' +
      '<label class="enc-campo enc-obrig"><span>Edição que recebe o grupo</span><select data-f="ed">' + eds.map(function (e) {
        return '<option value="' + esc(e.id) + '">' + esc(nomeCamp(e.campanha_id)) + " · " + esc(E.fmtPeriodo(e.inicio, e.fim, { curta: true })) + "</option>";
      }).join("") + '</select><small data-f="sug"></small></label>' +
      '<div class="enc-grade-f"><label class="enc-campo"><span>Nome do grupo</span><input data-f="nome" maxlength="60"></label><span></span>' +
      '<label class="enc-check" style="grid-column:1/-1"><input type="checkbox" data-f="temper"> Período próprio (diferente da edição)</label>' +
      '<label class="enc-campo" data-f="perbox" hidden><span>Início no ar</span><input type="date" data-f="ini"></label><label class="enc-campo" data-f="perbox2" hidden><span>Fim</span><input type="date" data-f="fim"></label>' +
      '<label class="enc-check" style="grid-column:1/-1"><input type="checkbox" data-f="tempz"> Prazo próprio (senão segue a edição)</label></div>' +
      '<div data-f="pzbox" hidden><div class="enc-grade-3" style="margin-top:8px"><label class="enc-campo"><span>Começar (dias antes)</span><input data-f="pc" inputmode="numeric" value="28"></label>' +
      '<label class="enc-campo"><span>Definir (dias antes)</span><input data-f="pd" inputmode="numeric" value="17"></label><label class="enc-campo"><span>Aprovar (dias antes)</span><input data-f="pa" inputmode="numeric" value="14"></label></div>' +
      '<div class="enc-sub" data-f="pzcalc"></div></div>';
    if (!eds.length) corpo = '<p class="enc-sub">Nenhuma edição aberta para receber o grupo. As edições nascem quando o prazo de começar chega.</p>';
    janela({ titulo: "+ Ação temática", ok: eds.length ? "Criar grupo temático" : null, corpo: corpo,
      aoMontar: function () { trocaTema(true); },
      aoInput: function (el) { var f = el.getAttribute("data-f"); if (f === "tema") trocaTema(true); else trocaTema(false); },
      aoOk: function () {
        var tema = jval('[data-f="tema"]'), edId = jval('[data-f="ed"]'), nome = jval('[data-f="nome"]').trim();
        var per = (jq('[data-f="temper"]') || {}).checked, pzOn = (jq('[data-f="tempz"]') || {}).checked;
        var ini = per ? jval('[data-f="ini"]') : null, fim = per ? jval('[data-f="fim"]') : null;
        if (per && (!ini || !fim || fim < ini)) return jmsg("O período próprio precisa de início e fim (início ≤ fim).");
        var pz = null;
        if (pzOn) { pz = prazosDoForm(); if (!pz) return jmsg("Prazo próprio: começar ≥ definir ≥ aprovar, em dias antes do ar."); }
        jocupado(true);
        A.rpc("encarte_criar_grupo_tematico", { p_edicao: edId, p_tema: tema, p_nome: nome || null, p_inicio: ini, p_fim: fim, p_prazos: pz }).then(function (r) {
          if (!r.ok) { jocupado(false); return jmsg(mensagemErro(r)); }
          ABA = "vagas"; FV = "todas";
          AVISO = { edicao: edId, txt: "Ação temática criada: grupo “" + (nome || jq('[data-f="tema"]').selectedOptions[0].textContent.split(" · ")[0]) + "”." + (r.data && r.data.vagas ? "" : " O modelo do tema não tem vagas: inclua com “+ Vaga só nesta edição”."), tipo: "" };
          fecharJanela(); R = { tela: "edicao", id: edId }; comDetalhe(edId, true);
        });
      } });
    function edSel() { var id = jval('[data-f="ed"]'); return eds.filter(function (e) { return e.id === id; })[0]; }
    function prazosDoForm() {
      var c = lerNum(jval('[data-f="pc"]')), d = lerNum(jval('[data-f="pd"]')), a = lerNum(jval('[data-f="pa"]'));
      if (![c, d, a].every(function (x) { return x !== null && !isNaN(x) && x >= 0 && Math.floor(x) === x; }) || !(c >= d && d >= a)) return null;
      var per = (jq('[data-f="temper"]') || {}).checked, e = edSel();
      var ini = per && jval('[data-f="ini"]') ? jval('[data-f="ini"]') : (e ? e.inicio : null);
      if (!ini) return null;
      var pz = E.calcularPrazos(ini, { comecar: c, definir: d, aprovar: a }, { flv: false });
      return pz.comecar && pz.definir && pz.aprovar ? pz : null;
    }
    function trocaTema(novoTema) {
      var id = jval('[data-f="tema"]'), x = comData.filter(function (y) { return y.m.id === id; })[0]; if (!x) return;
      var dica = jq('[data-f="dica"]');
      if (dica) dica.innerHTML = (x.d ? "Data de " + esc(x.d.nome) + ": <b>" + esc(dsem(x.d.data)) + "</b>. " : "Este tema não tem data no Calendário. ") + (x.m.dicas ? "Dicas: " + esc(x.m.dicas) : "");
      if (novoTema) {
        var nm = jq('[data-f="nome"]'); if (nm) nm.value = x.m.nome;
        var sug = x.d ? E.sugerirHospedeira(eds, x.d.data) : null;
        var s = jq('[data-f="ed"]'), msg = jq('[data-f="sug"]');
        if (s) s.value = sug ? sug.id : (edPreferida && eds.some(function (e) { return e.id === edPreferida; }) ? edPreferida : (eds[0] || {}).id || "");
        if (msg) {
          if (sug) msg.textContent = "Sugestão do sistema: a edição que cobre " + dsem(x.d.data) + ". Pode escolher outra.";
          else if (x.d) {
            var fut = (D().futuras || []).filter(function (e) { return e.inicio <= x.d.data && x.d.data <= e.fim; })[0];
            msg.textContent = "Nenhuma edição aberta cobre " + dsem(x.d.data) + (fut ? " ainda (" + fut.nome + " dessa semana começa a ser planejada em " + dm(fut.prazos.comecar) + ")" : "") + ". Escolha outra edição ou volte depois.";
          } else msg.textContent = "";
        }
        var i1 = jq('[data-f="ini"]'), i2 = jq('[data-f="fim"]');
        if (i1 && x.d) i1.value = x.d.data; if (i2 && x.d) i2.value = x.d.fim;
      }
      var per = (jq('[data-f="temper"]') || {}).checked, pzOn = (jq('[data-f="tempz"]') || {}).checked;
      ["perbox", "perbox2"].forEach(function (k) { var b = jq('[data-f="' + k + '"]'); if (b) b.hidden = !per; });
      var pb = jq('[data-f="pzbox"]'); if (pb) pb.hidden = !pzOn;
      var calc = jq('[data-f="pzcalc"]');
      if (calc && pzOn) { var pz = prazosDoForm(); calc.textContent = pz ? "Começar " + dsem(pz.comecar) + " · Definir " + dsem(pz.definir) + " · Aprovar " + dsem(pz.aprovar) + " (já antecipados de domingo e feriado)" : "Preencha começar ≥ definir ≥ aprovar."; }
    }
  }

  /* ---------- coincidência (só master) ---------- */
  function janelaCoinc() {
    var det = detAtual(); if (!det) return;
    var ed = det.edicao, h = hoje(), cs = (mapaCoincidencias(h)[ed.campanha_id + "|" + ed.inicio_regra] || []).filter(function (c) { return !decisaoDe(c, ed); });
    var outras = (D().edicoes || []).filter(function (e) { return e.id !== ed.id && (e.situacao || "ativa") === "ativa" && e.fim >= E.addDias(ed.inicio, -7) && e.inicio <= E.addDias(ed.fim, 7); })
      .sort(function (a, b) { return a.inicio < b.inicio ? -1 : 1; });
    janela({ titulo: "Decidir a coincidência", ok: "Gravar decisão",
      corpo: '<div class="enc-aviso"><span>⚠</span><div>' + cs.map(function (c) { return esc(c.texto); }).join("<br>") + "</div></div>" +
        '<p class="enc-sub">A decisão vale só para esta ocorrência de ' + esc(nomeCamp(ed.campanha_id)) + " (" + esc(E.fmtPeriodo(ed.inicio, ed.fim, { curta: true })) + "). O modelo e o Calendário não mudam.</p>" +
        '<div class="enc-opcoes"><label><input type="radio" name="enc-coinc" value="manter" checked><span><b>Manter</b> as duas como estão</span></label>' +
        '<label><input type="radio" name="enc-coinc" value="mover"><span><b>Mover</b> esta edição para outras datas</span></label>' +
        '<label><input type="radio" name="enc-coinc" value="juntar"' + (outras.length ? "" : " disabled") + "><span><b>Juntar</b> com outra edição (esta fica “juntada”)" + (outras.length ? "" : " — nenhuma edição aberta perto") + "</span></label></div>" +
        // Mover muda SÓ o início e o fim da edição (o banco não recalcula mais nada): quem move precisa saber.
        '<div data-f="moverbox" hidden><div class="enc-grade-f"><label class="enc-campo"><span>Novo início</span><input type="date" data-f="ini" value="' + esc(ed.inicio) + '"></label><label class="enc-campo"><span>Novo fim</span><input type="date" data-f="fim" value="' + esc(ed.fim) + '"></label></div>' +
        '<div class="enc-aviso enc-azul" style="margin:10px 0 0"><span>ℹ</span><div>Mover muda só o início e o fim desta edição. Os prazos (Começar, Definir e Aprovar) e os períodos próprios dos grupos (ex.: Fim de semana) continuam os mesmos.</div></div></div>' +
        '<label class="enc-campo" data-f="juntarbox" hidden><span>Juntar em</span><select data-f="alvo">' + outras.map(function (e) { return '<option value="' + esc(e.id) + '">' + esc(nomeCamp(e.campanha_id)) + " · " + esc(E.fmtPeriodo(e.inicio, e.fim, { curta: true })) + "</option>"; }).join("") + "</select></label>" +
        '<label class="enc-campo enc-obrig" style="margin-top:10px"><span>Motivo</span><input data-f="motivo" maxlength="200"></label>',
      aoInput: function () { var a = acao(); var mb = jq('[data-f="moverbox"]'), jb = jq('[data-f="juntarbox"]'); if (mb) mb.hidden = a !== "mover"; if (jb) jb.hidden = a !== "juntar"; },
      aoOk: function () {
        var a = acao(), mot = jval('[data-f="motivo"]').trim();
        if (!mot) return jmsg("Diga o motivo da decisão.");
        var ini = null, fim = null, junta = null;
        if (a === "mover") { ini = jval('[data-f="ini"]'); fim = jval('[data-f="fim"]'); if (!ini || !fim || fim < ini) return jmsg("Informe o novo início e fim (início ≤ fim)."); }
        if (a === "juntar") { junta = jval('[data-f="alvo"]'); if (!junta) return jmsg("Escolha a outra edição."); }
        jocupado(true);
        A.rpc("encarte_decidir_coincidencia", { p_edicao: ed.id, p_acao: a, p_inicio: ini, p_fim: fim, p_juntar_em: junta, p_motivo: mot }).then(function (r) {
          if (!r.ok) { jocupado(false); return jmsg(mensagemErro(r)); }
          depoisDeGravar(ed.id, "Coincidência decidida: " + (ACOES_COINC[a] || a) + ".");
        });
      } });
    function acao() { var r = jq('input[name="enc-coinc"]:checked'); return r ? r.value : "manter"; }
  }
  function janelaSemPenalidade() {
    var det = detAtual(); if (!det) return;
    janela({ titulo: "Marcar anterior ao processo", ok: "Marcar",
      corpo: '<p class="enc-sub" style="margin-top:0">Para edições que começaram antes do processo existir: os atrasos deixam de ficar vermelhos e “Entrou no ar sem aprovação” não acusa. Fica registrado quem marcou e o motivo.</p>' +
        '<label class="enc-campo enc-obrig"><span>Motivo</span><input data-f="motivo" maxlength="200" placeholder="ex.: planejada antes da implantação"></label>',
      aoOk: function () {
        var mot = jval('[data-f="motivo"]').trim(); if (!mot) return jmsg("Diga o motivo.");
        jocupado(true);
        A.rpc("encarte_marcar_sem_penalidade", { p_edicao: det.edicao.id, p_motivo: mot }).then(function (r) {
          if (!r.ok) { jocupado(false); return jmsg(mensagemErro(r)); }
          depoisDeGravar(det.edicao.id, "Edição marcada como anterior ao processo.");
        });
      } });
  }

  /* ======================= MODELOS ======================= */
  function prazosTxt(p) { p = objeto(p) || {}; return tem(p.comecar) ? p.comecar + " / " + p.definir + " / " + p.aprovar + " dias" : "segue a edição"; }
  function telaModelos() {
    var dd = D(), L = (dd.modelos || []).slice();
    var eds = L.filter(function (m) { return m.tipo === "edicao"; }), tms = L.filter(function (m) { return m.tipo === "tema"; });
    function linha(m) {
      return '<button class="enc-lm" data-ea="modelo" data-id="' + esc(m.id) + '">' + bolinha(corCamp(m.campanha_id)) + "<b>" + esc(m.nome) + '</b><span class="enc-apagado">versão ' + esc(m.versao || 1) + '</span><span class="enc-d">' +
        contarVagasModelo(m) + " vagas · " + ((objeto(m.estrutura) || {}).grupos || []).length + " grupos" + (m.tipo === "edicao" ? " · prazos " + esc(prazosTxt(m.prazos)) : "") + "</span></button>";
    }
    return '<div class="enc-volta"><button class="enc-bt-l" data-ea="fila">‹ Encartes</button></div>' +
      (AVISO && AVISO.tela === "modelos" ? '<div class="enc-msg' + (AVISO.tipo ? " enc-" + AVISO.tipo : "") + '">' + esc(AVISO.txt) + "</div>" : "") +
      '<div class="enc-topo"><div><h2>Modelos de encarte</h2><div class="enc-sub">Grupos, vagas e prazos de cada campanha. Mudar o modelo vale só para as edições que <b>ainda vão nascer</b>; as abertas ajustam-se uma a uma.' +
      (A.master() ? "" : " Só o master altera os modelos.") + "</div></div></div>" +
      '<div class="enc-cartao enc-mlista"><h3>Campanhas com edição</h3>' + (eds.map(linha).join("") || '<p class="enc-sub">Nenhum.</p>') + "</div>" +
      '<div class="enc-cartao enc-mlista"><h3>Temas (ações temáticas)</h3>' + (tms.map(linha).join("") || '<p class="enc-sub">Nenhum.</p>') + "</div>";
  }
  // Cópia de trabalho do modelo: nada vai ao banco até "Salvar nova versão".
  function prepararModelo(id) {
    var m = modeloDe(id); if (!m) { MOD = null; return false; }
    var est = clonar(objeto(m.estrutura) || { grupos: [] });
    MOD = { id: m.id, versao: m.versao || 1, tipo: m.tipo, nome: m.nome, prazos: clonar(objeto(m.prazos) || {}), grupos: est.grupos || [], sujo: false, msg: null };
    MOD.grupos.forEach(function (g) { g.vagas = g.vagas || []; });
    return true;
  }
  function abrirModelo(id) { if (!prepararModelo(id)) return ir({ tela: "modelos" }); ir({ tela: "modelo", id: id }); }
  function telaModelo() {
    if ((!MOD || MOD.id !== R.id) && !prepararModelo(R.id)) return telaModelos();
    var m = modeloDe(MOD.id) || {}, pode = A.master(), dis = pode ? "" : " disabled";
    var total = 0; MOD.grupos.forEach(function (g) { if (g.ativo_padrao === false) return; g.vagas.forEach(function (v) { if (v.obrigatoria !== false) total += Math.max(1, +v.quantidade || 1); }); });
    var x = '<div class="enc-volta"><button class="enc-bt-l" data-ea="modelos">‹ Modelos</button></div>' +
      (MOD.msg ? '<div class="enc-msg' + (MOD.msg.tipo ? " enc-" + MOD.msg.tipo : "") + '" role="status">' + esc(MOD.msg.txt) + "</div>" : "") +
      '<div class="enc-topo"><div><h2>Modelo · ' + esc(MOD.nome) + '</h2><div class="enc-sub">Versão ' + esc(MOD.versao) + (m.atualizado_por_nome ? " · última mudança por " + esc(m.atualizado_por_nome) + " em " + esc(quando(m.atualizado_em)) : "") +
      " · " + MOD.grupos.length + " grupos, " + total + " vagas por edição</div></div>" +
      (pode ? '<div class="enc-acoes"><button class="enc-bt" data-ea="m-desfazer"' + (MOD.sujo ? "" : " disabled") + '>Desfazer mudanças</button><button class="enc-bt-p" data-ea="m-salvar"' + (MOD.sujo ? "" : " disabled") + ">Salvar nova versão</button></div>" : "") + "</div>";
    if (m.dicas) x += '<div class="enc-aviso enc-azul"><span>ℹ</span><div>' + esc(m.dicas) + "</div></div>";
    x += '<div class="enc-cartao"><h3>Prazos (dias corridos antes de entrar no ar)</h3><div class="enc-grade-3" style="margin-top:10px">' +
      [["comecar", "Começar a negociar"], ["definir", "Vagas definidas até"], ["aprovar", "Encarte aprovado até"]].map(function (k) {
        return '<label class="enc-campo"><span>' + k[1] + '</span><input data-mp="' + k[0] + '" inputmode="numeric" value="' + esc(tem(MOD.prazos[k[0]]) ? MOD.prazos[k[0]] : "") + '"' + dis + "></label>";
      }).join("") + '</div><div class="enc-nota">Caiu em domingo, feriado ou 23/24/30/31 de dezembro? O prazo antecipa sozinho para o dia útil anterior. ' +
      (MOD.tipo === "tema" ? "Tema pode ficar em branco: segue a edição que recebe o grupo." : "") + "</div></div>";
    MOD.grupos.forEach(function (g, gi) {
      var per = g.periodo || {}, pz = g.prazos || {};
      x += '<div class="enc-cartao enc-mg" data-g="' + gi + '"><div class="enc-mg-cab"><input data-mg="nome" data-g="' + gi + '" value="' + esc(g.nome) + '" aria-label="Nome do grupo"' + dis + ">" +
        (pode ? '<button class="enc-bt" data-ea="mg-subir" data-g="' + gi + '"' + (gi ? "" : " disabled") + ' aria-label="Subir">↑</button><button class="enc-bt" data-ea="mg-descer" data-g="' + gi + '"' + (gi < MOD.grupos.length - 1 ? "" : " disabled") + ' aria-label="Descer">↓</button>' +
          '<button class="enc-bt-perigo" data-ea="mg-tirar" data-g="' + gi + '">Remover grupo</button>' : "") + "</div>" +
        '<div class="enc-mg-opc"><label class="enc-check"><input type="checkbox" data-mg="ativo_padrao" data-g="' + gi + '"' + (g.ativo_padrao === false ? "" : " checked") + dis + "> Entra em toda edição</label>" +
        '<label class="enc-check"><input type="checkbox" data-mg="flv" data-g="' + gi + '"' + (g.flv ? " checked" : "") + dis + "> Hortifrúti (prazo na manhã do feriado)</label></div>" +
        '<div class="enc-grade-f"><label class="enc-campo"><span>Identidade na arte (opcional)</span><input data-mg="identidade" data-g="' + gi + '" value="' + esc(g.identidade || "") + '" maxlength="60"' + dis + "></label>" +
        '<div class="enc-campo"><span>Período próprio (dias depois do início da edição)</span><div class="enc-inline">do dia <input data-mg="ini_offset" data-g="' + gi + '" inputmode="numeric" value="' + esc(tem(per.ini_offset) ? per.ini_offset : "") + '"' + dis + '> ao dia <input data-mg="fim_offset" data-g="' + gi + '" inputmode="numeric" value="' + esc(tem(per.fim_offset) ? per.fim_offset : "") + '"' + dis + "></div><small>em branco = o período da edição. Ex.: Fim de semana = 4 a 6 (sexta a domingo)</small></div>" +
        '<div class="enc-campo" style="grid-column:1/-1"><span>Prazo próprio (dias antes do grupo entrar no ar)</span><div class="enc-inline">começar <input data-mg="pz_comecar" data-g="' + gi + '" inputmode="numeric" value="' + esc(tem(pz.comecar) ? pz.comecar : "") + '"' + dis +
        '> definir <input data-mg="pz_definir" data-g="' + gi + '" inputmode="numeric" value="' + esc(tem(pz.definir) ? pz.definir : "") + '"' + dis + '> aprovar <input data-mg="pz_aprovar" data-g="' + gi + '" inputmode="numeric" value="' + esc(tem(pz.aprovar) ? pz.aprovar : "") + '"' + dis + "></div><small>em branco = segue a régua da edição</small></div></div>" +
        '<table class="enc-mvagas"><thead><tr><th>Vaga</th><th>O que muda</th><th>Quantidade</th><th>Obrigatória</th><th></th></tr></thead><tbody>' +
        g.vagas.map(function (v, vi) {
          return '<tr><td class="enc-mv-nome" data-rot="Vaga"><input type="text" data-mv="nome" data-g="' + gi + '" data-v="' + vi + '" value="' + esc(v.nome) + '" aria-label="Nome da vaga"' + dis + "></td>" +
            '<td class="enc-mv-muda" data-rot="O que muda"><input type="text" data-mv="o_que_muda" data-g="' + gi + '" data-v="' + vi + '" value="' + esc(v.o_que_muda || "") + '" aria-label="O que muda"' + dis + "></td>" +
            '<td data-rot="Quantidade"><span class="enc-qtd"><button data-ea="mv-menos" data-g="' + gi + '" data-v="' + vi + '" aria-label="Menos"' + dis + ">−</button><span>" + esc(Math.max(1, +v.quantidade || 1)) + '</span><button data-ea="mv-mais" data-g="' + gi + '" data-v="' + vi + '" aria-label="Mais"' + dis + ">+</button></span></td>" +
            '<td data-rot="Obrigatória"><label class="enc-check"><input type="checkbox" data-mv="obrigatoria" data-g="' + gi + '" data-v="' + vi + '"' + (v.obrigatoria === false ? "" : " checked") + dis + "> sim</label></td>" +
            "<td>" + (pode ? '<button class="enc-x" data-ea="mv-tirar" data-g="' + gi + '" data-v="' + vi + '" aria-label="Remover vaga">×</button>' : "") + "</td></tr>";
        }).join("") + "</tbody></table>" + (pode ? '<div style="margin-top:8px"><button class="enc-bt" data-ea="mv-add" data-g="' + gi + '">+ Vaga neste grupo</button></div>' : "") + "</div>";
    });
    if (pode) x += '<div class="enc-rodape"><button class="enc-bt" data-ea="mg-add">+ Grupo</button><span class="enc-esp"></span><button class="enc-bt-p" data-ea="m-salvar"' + (MOD.sujo ? "" : " disabled") + ">Salvar nova versão</button></div>";
    x += '<div class="enc-nota">Vaga opcional não nasce sozinha na edição (entra só se alguém incluir). Quantidade 3 = três vagas iguais (“Café”, “Café 2”, “Café 3”).</div>';
    return x;
  }
  function modInput(el) {
    if (!MOD || !A.master()) return;
    var k = el.getAttribute("data-mg"), kv = el.getAttribute("data-mv"), kp = el.getAttribute("data-mp");
    var gi = +el.getAttribute("data-g"), g = MOD.grupos[gi];
    if (!kp && !g) return;
    if (kp) { MOD.prazos[kp] = el.value.trim() === "" ? null : lerNum(el.value); }
    else if (k) {
      if (k === "ativo_padrao" || k === "flv") g[k] = !!el.checked;
      else if (k === "nome" || k === "identidade") g[k] = el.value;
      else if (k === "ini_offset" || k === "fim_offset") { g.periodo = g.periodo || {}; g.periodo[k] = el.value.trim() === "" ? null : lerNum(el.value); }
      else if (/^pz_/.test(k)) { g.prazos = g.prazos || {}; g.prazos[k.slice(3)] = el.value.trim() === "" ? null : lerNum(el.value); }
    } else if (kv) {
      var v = g.vagas[+el.getAttribute("data-v")]; if (!v) return;
      if (kv === "obrigatoria") v.obrigatoria = !!el.checked; else v[kv] = el.value;
    }
    if (!MOD.sujo) { MOD.sujo = true; MOD.msg = null; var bts = estrutura().querySelectorAll('[data-ea="m-salvar"],[data-ea="m-desfazer"]'); for (var i = 0; i < bts.length; i++) bts[i].disabled = false; }
  }
  function modAcao(acao, el) {
    if (!MOD || !A.master()) return;
    var gi = +el.getAttribute("data-g"), vi = +el.getAttribute("data-v"), G = MOD.grupos;
    if (acao === "mg-add") G.push({ chave: chaveNova("grupo"), nome: "Novo grupo", ativo_padrao: true, vagas: [] });
    else if (acao === "mg-tirar") { if (!confirm("Remover o grupo “" + (G[gi] || {}).nome + "” do modelo? As edições já abertas não mudam.")) return; G.splice(gi, 1); }
    else if (acao === "mg-subir" && gi > 0) G.splice(gi - 1, 0, G.splice(gi, 1)[0]);
    else if (acao === "mg-descer" && gi < G.length - 1) G.splice(gi + 1, 0, G.splice(gi, 1)[0]);
    else if (acao === "mv-add") G[gi].vagas.push({ chave: "", nome: "", o_que_muda: "marca", quantidade: 1, obrigatoria: true });
    else if (acao === "mv-tirar") G[gi].vagas.splice(vi, 1);
    else if (acao === "mv-mais") G[gi].vagas[vi].quantidade = Math.min(50, (+G[gi].vagas[vi].quantidade || 1) + 1);
    else if (acao === "mv-menos") G[gi].vagas[vi].quantidade = Math.max(1, (+G[gi].vagas[vi].quantidade || 1) - 1);
    else return;
    MOD.sujo = true; MOD.msg = null; pinta(telaModelo());
  }
  function chaveNova(base) {
    var b = slug(base), k = b, i = 2, usadas = {};
    MOD.grupos.forEach(function (g) { usadas[g.chave] = 1; });
    while (usadas[k]) k = b + "-" + (i++);
    return k;
  }
  // Monta a estrutura para o banco, conferindo o mesmo que ele confere (para errar aqui, com a mensagem certa).
  function estruturaParaSalvar() {
    var erro = null, usadas = {};
    function inteiro(x) { return x === null || x === undefined || x === "" ? null : (typeof x === "number" && !isNaN(x) && Math.floor(x) === x ? x : NaN); }
    var p = MOD.prazos || {}, pc = inteiro(p.comecar), pd = inteiro(p.definir), pa = inteiro(p.aprovar), prazos;
    var nenhum = pc === null && pd === null && pa === null;
    if (nenhum && MOD.tipo === "tema") prazos = {};
    else if ([pc, pd, pa].some(function (x) { return x === null || isNaN(x) || x < 0; }) || !(pc >= pd && pd >= pa)) erro = "Prazos do modelo: preencha começar ≥ definir ≥ aprovar (dias inteiros).";
    else prazos = { comecar: pc, definir: pd, aprovar: pa };
    var grupos = MOD.grupos.map(function (g) {
      var nome = String(g.nome || "").trim();
      if (!nome) erro = erro || "Todo grupo precisa de um nome.";
      var ch = g.chave && /^[a-z0-9][a-z0-9-]*$/.test(g.chave) ? g.chave : slug(nome);
      while (usadas[ch]) ch = ch + "-2";
      usadas[ch] = 1;
      var o = { chave: ch, nome: nome, ativo_padrao: g.ativo_padrao !== false };
      if (String(g.identidade || "").trim()) o.identidade = String(g.identidade).trim();
      if (g.flv) o.flv = true;
      var per = g.periodo || {}, io = inteiro(per.ini_offset), fo = inteiro(per.fim_offset);
      if (io !== null || fo !== null) {
        if (io === null || fo === null || isNaN(io) || isNaN(fo) || fo < io) erro = erro || "No grupo “" + nome + "”, o período próprio precisa dos dois números (início ≤ fim).";
        else o.periodo = { ini_offset: io, fim_offset: fo };
      }
      var gp = g.prazos || {}, c = inteiro(gp.comecar), d = inteiro(gp.definir), a = inteiro(gp.aprovar);
      if (c !== null || d !== null || a !== null) {
        if ([c, d, a].some(function (x) { return x === null || isNaN(x) || x < 0; }) || !(c >= d && d >= a)) erro = erro || "No grupo “" + nome + "”, o prazo próprio precisa de começar ≥ definir ≥ aprovar.";
        else o.prazos = { comecar: c, definir: d, aprovar: a };
      }
      var vch = {};
      o.vagas = g.vagas.map(function (v) {
        var vn = String(v.nome || "").trim();
        if (!vn) erro = erro || "Toda vaga do grupo “" + nome + "” precisa de um nome.";
        var k = v.chave || slug(vn); while (vch[k]) k = k + "-2"; vch[k] = 1;
        var q = Math.max(1, Math.min(50, +v.quantidade || 1));
        var ov = { chave: k, nome: vn, o_que_muda: String(v.o_que_muda || "").trim() || null, quantidade: q, obrigatoria: v.obrigatoria !== false };
        if (v.papel) ov.papel = v.papel;
        return ov;
      });
      return o;
    });
    return { erro: erro, estrutura: { grupos: grupos }, prazos: prazos };
  }
  function salvarModelo() {
    if (!MOD || !A.master()) return;
    var s = estruturaParaSalvar();
    if (s.erro) { MOD.msg = { txt: s.erro, tipo: "erro" }; return pinta(telaModelo()); }
    var bt = estrutura().querySelectorAll('[data-ea="m-salvar"]'); for (var i = 0; i < bt.length; i++) { bt[i].disabled = true; bt[i].textContent = "Salvando…"; }
    A.rpc("encarte_salvar_modelo", { p_id: MOD.id, p_estrutura: s.estrutura, p_prazos: s.prazos, p_versao_vista: MOD.versao }).then(function (r) {
      if (!r.ok) {
        if (/versao_mudou/.test((r.chave || "") + " " + (r.erro || ""))) {
          var id0 = MOD.id;
          return A.recarregarModelos().then(function () { prepararModelo(id0); if (MOD) MOD.msg = { txt: "O modelo mudou enquanto a tela estava aberta; confira a versão atual antes de salvar.", tipo: "alerta" }; pinta(telaModelo()); });
        }
        MOD.msg = { txt: mensagemErro(r), tipo: "erro" }; return pinta(telaModelo());
      }
      var id1 = MOD.id;
      A.recarregarModelos().then(function () {
        prepararModelo(id1);
        if (MOD) MOD.msg = { txt: "Modelo salvo: versão " + ((r.data && r.data.versao) || "") + ". Vale para as edições que ainda vão nascer.", tipo: "" };
        pinta(telaModelo());
      });
    });
  }

  /* ======================= EVENTOS (um ouvinte só, na raiz) ======================= */
  function ligar() {
    if (RAIZ.__encLigado) return;
    RAIZ.__encLigado = true;
    RAIZ.addEventListener("click", function (e) {
      var el = e.target.closest ? e.target.closest("[data-ea]") : null;
      if (!el || !RAIZ.contains(el) || el.disabled) return;
      var acao = el.getAttribute("data-ea"), id = el.getAttribute("data-id");
      if (JAN && JAN.el.contains(el)) {
        if (acao === "jan-fechar") return fecharJanela();
        if (acao === "jan-ok") { if (!JAN.ocupado && JAN.o.aoOk) JAN.o.aoOk(); return; }
        if (JAN.o.aoAcao && JAN.o.aoAcao(acao, el)) return;
        return;
      }
      switch (acao) {
        case "fila": AVISO = null; return ir({ tela: "fila" });
        case "filtro": PREF.filtro = el.getAttribute("data-v"); guardarPref(); return ir({ tela: "fila" }, true);
        case "minhas": PREF.minhas = !PREF.minhas; guardarPref(); return ir({ tela: "fila" }, true);
        case "recarregar": AVISO = null; carregando("Lendo de novo…"); return A.recarregar();
        case "modelos": AVISO = null; return ir({ tela: "modelos" });
        case "modelo": return abrirModelo(id);
        case "abrir-ed": if (!R || R.id !== id) { ABA = "vagas"; FV = "todas"; } if (AVISO && AVISO.edicao !== id) AVISO = null; return ir({ tela: "edicao", id: id });
        case "abrir-vaga": AVISO = null; return ir({ tela: "vaga", id: R.id, vaga: id });
        case "aba": ABA = el.getAttribute("data-v"); return ir(R, true);
        case "mais-hist": {
          // mais 300 do histórico, na mesma ordem (o livro só cresce; nada é lido sem teto)
          var edH = R.id; el.disabled = true; el.textContent = "Carregando…";
          return A.maisEventos(edH).then(function (r) {
            if (r && r.erro) AVISO = { edicao: edH, txt: r.erro, tipo: "erro" };
            var dH = A.detalheGuardado(edH); if (dH && R && R.id === edH && R.tela === "edicao") pintaDetalhe(dH);
          });
        }
        case "fvaga": FV = el.getAttribute("data-v"); return ir(R, true);
        case "nova-vaga": return janelaNovaVaga();
        case "retirar-vaga": return janelaRetirar();
        case "nova-prop": return janelaProposta(null);
        case "editar-prop": return janelaProposta(id);
        case "descartar-prop": return janelaDescartar(id);
        case "escolher-prop": return escolher(id);
        case "aprovar": return janelaAprovar(el.getAttribute("data-grupo") || null);
        case "tema": return janelaTema(el.getAttribute("data-ed") || (R && R.id) || null);
        case "coinc": return janelaCoinc();
        case "sem-pen": return janelaSemPenalidade();
        case "m-salvar": return salvarModelo();
        case "m-desfazer": { var mid = MOD && MOD.id; MOD = null; return abrirModelo(mid); }
        default: if (/^m[gv]-/.test(acao)) return modAcao(acao, el);
      }
    });
    // Caixa de marcar, opção e lista respondem no "change"; o resto no "input" (cada coisa uma vez só).
    function aoMudar(e) {
      var el = e.target, tp = String(el.type || "").toLowerCase();
      var deEscolha = tp === "checkbox" || tp === "radio" || el.tagName === "SELECT";
      if (deEscolha !== (e.type === "change")) return;
      if (JAN && JAN.el.contains(el)) { if (JAN.o.aoInput) JAN.o.aoInput(el); return; }
      if (R.tela === "modelo" && (el.hasAttribute("data-mg") || el.hasAttribute("data-mv") || el.hasAttribute("data-mp"))) modInput(el);
    }
    RAIZ.addEventListener("input", aoMudar);
    RAIZ.addEventListener("change", aoMudar);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && JAN) fecharJanela(); });
  }

  /* ======================= PORTA DE ENTRADA ======================= */
  window.encTela = {
    // Chamado pelo painel.js depois de ler a nuvem. api: ver ==ENC-PAINEL==.
    montar: function (raiz, api) { RAIZ = raiz; A = api; estrutura(); ligar(); desenhar(); },
    ir: function (rota) { if (rota && rota.tela === "edicao") { ABA = "vagas"; FV = "todas"; } ir(rota || { tela: "fila" }); },
    atualizar: function () { if (A) desenhar(); },
    rota: function () { return R; },
    aviso: function (txt, tipo) { AVISO = txt ? { tela: "fila", txt: txt, tipo: tipo || "" } : null; }
  };
})();
