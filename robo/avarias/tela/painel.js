/* ==AV-PAINEL== AVARIAS — a ligação da tela com a nuvem. SOMENTE LEITURA. PILOTO (etapa 3,6): a tela lê SÓ o RETRATO.
   O robô da loja monta, a cada rodada, uma cópia pronta de cada consulta da tela (public.avaria_retrato_v): a consulta
   pesada nunca roda na hora de abrir. Só existe um jeito de falar com o banco aqui: from("avaria_retrato_v").select(...),
   por consulta — inteira, em pedaços "p0000", "p0001"… (páginas com ordem fixa e o total conferido) — ou, sob demanda,
   pela chave. Não há gravação, nem chamada de função. Cada pedaço traz as linhas em listas na ordem de "colunas": aqui
   elas viram objetos e as áreas recebem o MESMO formato de antes. O que foi lido fica guardado por 5 minutos.
   Quem decide o acesso é o BANCO (recebe linhas quem tem ficha aprovada e a chave de Avarias que o master liberou em Acessos,
   e o master); a tela só escolhe a mensagem. */
(function () {
  "use strict";
  var AV = window.AV;
  var GUARDA_MS = 5 * 60e3, PAGINA = 20;           // 20 pedaços por página (cada pedaço tem até 2.000 linhas)
  var RETRATO = "avaria_retrato_v", COLS_RETRATO = "consulta,chave,colunas,linhas,gerado_em,versao";
  var cache = {}, raiz = null, sync = null, recarregado = null;
  AV.retrato = null;                                 // {versao, gerado_em} do retrato que a tela está mostrando

  function erroNuvem(r) { var e = new Error(r.error.message); e.codigo = r.error.code; return e; }
  // erro escrito pela PRÓPRIA tela (em português, pode aparecer para o dono). O da nuvem ou do navegador nunca aparece cru:
  // AV.falhou (base.js) troca por uma frase em português e manda o texto técnico só para o console.
  function erroTela(msg, mistura) { var e = new Error(msg); e.daTela = true; if (mistura) e.mistura = true; return e; }
  function lerPedacos(chave, valor) {
    var sb = window.__SB, todas = [];
    function pagina(i) {
      var x = sb.from(RETRATO).select(COLS_RETRATO, { count: "exact" }).eq("consulta", chave);
      if (valor !== undefined) x = x.eq("chave", String(valor));
      return x.order("chave", { ascending: true }).range(i, i + PAGINA - 1).then(function (r) {
        if (r.error) throw erroNuvem(r);
        todas = todas.concat(r.data || []);
        if (r.count !== null && todas.length < r.count && (r.data || []).length) return pagina(i + PAGINA);
        // total diferente = o robô publicou outro retrato entre as páginas: conta como mistura (lê de novo, no máximo 3 vezes)
        if (r.count !== null && todas.length !== r.count) throw erroTela("o total não conferiu no retrato de " + chave + ": " + todas.length + " de " + r.count, true);
        return todas;
      });
    }
    return pagina(0);
  }
  // pedaços → objetos com as colunas da consulta. Confere que é UM retrato só (a mesma versão em todos os pedaços) e,
  // na consulta inteira, que nenhum pedaço falta (p0000, p0001… em sequência): nunca junta dados de momentos diferentes.
  function decodificar(q, chave, pedacos) {
    var pedidas = q.colunas.split(","), out = [], rt = null;
    pedacos.forEach(function (p, i) {
      if (!rt) rt = { versao: p.versao, gerado_em: p.gerado_em };
      else if (String(p.versao) !== String(rt.versao)) throw erroTela("o retrato de " + chave + " mudou no meio da leitura", true);
      if (!q.sob_demanda && p.chave !== "p" + ("000" + i).slice(-4)) throw erroTela("faltou um pedaço do retrato de " + chave + " (" + p.chave + ")");
      var idx = {}; (p.colunas || []).forEach(function (c, k) { idx[c] = k; });
      pedidas.forEach(function (c) { if (!(c in idx)) throw erroTela("o retrato de " + chave + " não tem a coluna " + c + " (a nuvem está com outra versão da tela)"); });
      (p.linhas || []).forEach(function (l) { var o = {}; pedidas.forEach(function (c) { o[c] = l[idx[c]]; }); out.push(o); });
    });
    Object.defineProperty(out, "retrato", { value: rt });
    return out;
  }
  // o robô publicou um retrato novo enquanto a tela estava aberta: o que estava guardado é de outro momento. Descarta tudo e
  // redesenha a tela inteira com o novo, para os números e a "Última atualização" serem do mesmo retrato. Uma vez só por
  // versão nova (a guarda "recarregado" só volta atrás quando a releitura falha, e aí só na próxima volta do relógio): nunca
  // entra em laço. A consulta "sync" vem AO VIVO (decisão D1) e não é pedaço do retrato: ela nunca entra nesta conta, e a
  // versão e a hora da tela vêm sempre de uma consulta do retrato (AV.retrato = a de "produtos", lida ao abrir).
  function notarVersao(rt, opc) {
    if (!rt || rt.versao === null || rt.versao === undefined || !AV.retrato || String(rt.versao) === String(AV.retrato.versao) || recarregado === String(rt.versao)) return;
    recarregado = String(rt.versao); cache = {};
    setTimeout(function () { if (raiz && raiz.isConnected) AV.abrir(raiz, opc); }, 0);
  }

  AV.ler = function (chave, filtro) {
    var q = (window.AV_CONSULTAS || {})[chave];
    if (!q) return Promise.reject(erroTela("consulta desconhecida: " + chave));
    var valor = q.sob_demanda && filtro ? filtro[q.sob_demanda] : undefined;
    if (q.sob_demanda && (valor === undefined || valor === null)) return Promise.reject(erroTela("leitura sob demanda sem a chave: " + chave));
    var k = chave + "|" + JSON.stringify(filtro || {});
    var c = cache[k];
    if (c && Date.now() - c.em < GUARDA_MS) return c.p;
    if (!window.__SB) return Promise.reject(erroTela("sem conexão com a nuvem"));
    // filtro por outra coluna (nenhuma área usa hoje): aplicado nas linhas lidas, com a mesma regra do .eq de antes
    var outros = Object.keys(filtro || {}).filter(function (col) { return col !== q.sob_demanda; });
    var tentativas = 0;
    function uma() {
      var outra = function (e) { if (e && e.mistura && ++tentativas < 3) return uma(); throw e; };
      return lerPedacos(chave, valor).then(function (pedacos) {
        try { return decodificar(q, chave, pedacos); } catch (e) { return outra(e); }
      }, outra);
    }
    var p = uma().then(function (L) {
      if (outros.length) { var rt = L.retrato; L = L.filter(function (o) { return outros.every(function (col) { return String(o[col]) === String(filtro[col]); }); }); Object.defineProperty(L, "retrato", { value: rt }); }
      if (chave !== "sync") notarVersao(L.retrato);
      return L;
    });
    cache[k] = { em: Date.now(), p: p };
    p.catch(function () { delete cache[k]; });
    return p;
  };
  // várias consultas de uma vez. Se alguma veio de outro retrato (o robô publicou no meio), lê todas de novo; se ainda
  // assim vierem de momentos diferentes, avisa em vez de misturar. A "sync" (ao vivo, fora do retrato) não entra na conta.
  AV.lerVarias = function (chaves, repetiu) {
    return Promise.all(chaves.map(function (k) { return AV.ler(k); })).then(function (rs) {
      var vs = {}; rs.forEach(function (L, i) { if (L.retrato && chaves[i] !== "sync") vs[String(L.retrato.versao)] = 1; });
      if (Object.keys(vs).length > 1) {
        if (repetiu) throw erroTela("os dados do VR estão sendo atualizados agora; tente de novo em instantes");
        chaves.forEach(function (k) { delete cache[k + "|{}"]; });
        return AV.lerVarias(chaves, true);
      }
      var o = {}; chaves.forEach(function (k, i) { o[k] = rs[i]; }); return o;
    });
  };

  // ---------- a casca: título, hora dos dados, abas, filtros, busca por nota ----------
  var AREAS = [
    { id: "resumo", nome: "Resumo" }, { id: "pendencias", nome: "Pendências" },
    { id: "produtos", nome: "Produtos e setores" }, { id: "fornecedores", nome: "Fornecedores" }
  ];
  // o que cada filtro faz em cada área (a tela diz quando um filtro NÃO se aplica)
  var FILTROS = { resumo: ["periodo", "setor", "motivo"], pendencias: ["setor"], produtos: ["periodo", "setor", "motivo"], fornecedores: ["periodo"] };
  var SELO = '<span class="av-piloto" title="Piloto: somente leitura; os números estão em validação.">Piloto · em validação</span>';

  function mensagem(titulo, txt) {
    raiz.innerHTML = '<div class="av"><div class="av-card av-msg"><h2>' + titulo + " " + SELO + "</h2><p>" + txt + "</p></div></div>";
  }
  var SEM_DADOS = "O robô da loja ainda não mandou a primeira cópia do VR para Avarias. Assim que ele mandar, os números aparecem aqui.";
  // as MESMAS frases do carregador do Painel (==AVARIAS-CARREGADOR==), que barra antes quem não tem a chave
  var SEM_ACESSO = "Você não tem acesso às Avarias. Peça ao master para liberar na tela Acessos.";
  var FICHA_BLOQUEADA = "A sua ficha está bloqueada. Peça ao master para liberar na tela Acessos.";
  // Zero pedaços do retrato = o banco não deixou ler (recebe linhas quem tem ficha aprovada e a chave de Avarias, e o master
  // com ficha aprovada) ou o robô ainda não publicou o primeiro retrato. O perfil (window.__PERFIL) só escolhe a frase:
  // master aprovado = os dados ainda não chegaram; qualquer outro = sem acesso. Nenhum número aparece.
  function semAcesso() {
    var p = window.__PERFIL || null;
    // o banco exige ficha APROVADA até do master (aprovado em branco não vale): só então "os dados ainda não chegaram"
    if (p && p.is_master && p.aprovado === true) return mensagem("Os dados do VR ainda não chegaram", SEM_DADOS);
    if (p && p.is_master) return mensagem("Avarias", p.aprovado === false ? "A sua ficha de master está bloqueada: confira na tela Acessos."
      : "A sua ficha de master ainda não está aprovada: confira na tela Acessos.");
    mensagem("Avarias", p && p.aprovado === false ? FICHA_BLOQUEADA : SEM_ACESSO);
  }
  // opc.silencioso = retrato novo percebido com a tela aberta: não pisca "Carregando…" e, se a releitura falhar, a tela
  // fica como estava (a idade dos dados continua avisando) e a próxima volta do relógio tenta de novo.
  AV.abrir = function (el, opc) {
    var quieto = !!(opc && opc.silencioso) && !!(raiz && raiz.isConnected && raiz.querySelector(".av-topo"));
    raiz = el || document.getElementById("avRaiz");
    if (!AV.estado.periodo) AV.estado.periodo = AV.periodos()[0].id;
    if (!quieto) mensagem("Avarias", "Carregando…");
    delete cache["sync|{}"];                             // a sincronização é lida AO VIVO a cada abertura (decisão D1)
    var y = window.scrollY || 0;
    AV.lerVarias(["sync", "produtos", "motivos"]).then(function (d) {
      // a sincronização ao vivo só volta vazia para quem o banco não deixa ler (quem pode recebe sempre as fontes):
      // o acesso pode ter sido tirado com a tela aberta, então o que estava guardado não vale mais
      // (a ficha aberta fica fora de #avRaiz: fecha junto, e o que estava na memória é esquecido)
      if (!d.sync.length) { cache = {}; AV.fecharGaveta(true); AV.produtos = {}; AV.retrato = null; sync = null; return semAcesso(); }
      // a versão e a hora da tela vêm de uma consulta do RETRATO ("produtos", que sempre tem o pedaço p0000 num retrato
      // publicado), nunca da linha ao vivo da sincronização. Sem pedaço = o banco não deixou ler ou ainda não há retrato.
      if (!d.produtos.retrato) return semAcesso();
      // D1: toda fonte conta, menos a conferência do próprio robô (conferencia_js)
      var fontes = fontesDaSync(d.sync);
      if (!fontes.some(function (s) { return s.ultima_ok; })) return mensagem("Os dados do VR ainda não chegaram", SEM_DADOS);
      sync = fontes; syncLidoEm = Date.now(); AV.retrato = d.produtos.retrato;
      d.produtos.forEach(function (p) { if (p.setor_id !== null && !AV.setores[p.setor_id]) AV.setores[p.setor_id] = AV.nomeSetorVR(p.setor); });
      AV.produtos = {}; d.produtos.forEach(function (p) { AV.produtos[p.id_produto] = p; });
      d.motivos.forEach(function (m) { AV.motivos[m.motivo] = m.nome; });
      casca();
      if (quieto) window.scrollTo(0, y);
      ligarRelogio();
    }, function (e) {
      if (quieto) { recarregado = null; if (window.console) console.warn("Avarias: o retrato novo não carregou agora; a tela ficou como estava.", e); return; }
      if (e && e.codigo === "42501") return mensagem("Avarias", "Entre no Painel para ver Avarias.");
      mensagem("Avarias", "Não deu para carregar agora. Tente de novo em instantes.");
    });
  };

  // cada parte da cópia do VR pelo nome do negócio (a dica da hora nunca mostra nome de tabela)
  var FONTES = {
    avaria_trocas_vr: "movimentos da troca", avaria_saldo_vr: "saldo da troca", avaria_ciclos_vr: "ciclos da troca",
    avaria_parcelas_vr: "mercadoria parada na troca", avaria_saidas_vr: "saídas da troca", avaria_saidas_partes_vr: "custo das saídas",
    avaria_ajustes_vr: "ajustes fora do livro", avaria_notas_vr: "notas de saída", avaria_notas_itens_vr: "produtos das notas de saída",
    avaria_titulos_vr: "títulos de devolução", avaria_provas_vr: "documentos que citam as notas", avaria_documentos_vr: "notas de entrada, boletos e verbas",
    avaria_verbas_vr: "verbas", avaria_perdas_vr: "lançamentos de perda", avaria_produtos_vr: "cadastro de produtos",
    avaria_fornecedores_vr: "cadastro de fornecedores", avaria_fornecedor_relacionado_vr: "fornecedor da última compra",
    avaria_compras_recentes_vr: "compras recentes", avaria_motivos_vr: "motivos", avaria_usuarios_vr: "usuários do coletor",
    avaria_venda_setor_vr: "venda por setor", avaria_rodada: "rodada completa do robô (cópia do VR e retrato)"
  };
  function nomeFonte(f) { return FONTES[f] || "outros dados do VR"; }

  // ---------- "Última atualização" e o aviso de desatualizado (hora de Caicó, qualquer que seja o relógio do aparelho) ----------
  var FUSO_MS = 3 * 3600e3, JANELA = [6, 21], LIMITE_MIN = 60;   // Caicó: UTC−3 o ano inteiro; o robô roda das 06h às 21h
  function dois(n) { return ("0" + n).slice(-2); }
  AV.dataHoraCaico = function (s) {
    var t = s ? new Date(s).getTime() : NaN;
    if (!isFinite(t)) return "—";
    var d = new Date(t - FUSO_MS);
    return dois(d.getUTCDate()) + "/" + dois(d.getUTCMonth() + 1) + "/" + d.getUTCFullYear() + " " + dois(d.getUTCHours()) + ":" + dois(d.getUTCMinutes());
  };
  // minutos DENTRO da janela do robô entre a hora s e agora: de noite o robô não roda, e isso não é atraso
  AV.minutosNaJanela = function (s, agora) {
    var a = new Date(s).getTime() - FUSO_MS, b = (agora === undefined ? Date.now() : agora) - FUSO_MS, dia = 864e5, h = 3600e3, soma = 0;
    if (!isFinite(a)) return Infinity;
    if (!(a < b)) return 0;
    if (b - a > 40 * dia) return Infinity;
    for (var d = Math.floor(a / dia); d <= Math.floor(b / dia); d++)
      soma += Math.max(0, Math.min(b, d * dia + JANELA[1] * h) - Math.max(a, d * dia + JANELA[0] * h));
    return soma / 60e3;
  };
  // velho: o retrato ou alguma parte está sem atualizar há mais de 1 hora de janela; falha: a última tentativa anotou erro
  AV.situacaoDados = function (fontes, rt, agora) {
    agora = agora === undefined ? Date.now() : agora;
    var velhas = fontes.filter(function (s) { return !s.ultima_ok || AV.minutosNaJanela(s.ultima_ok, agora) > LIMITE_MIN; });
    var falhas = fontes.filter(function (s) { return s.ultimo_erro && s.ultima_tentativa && (!s.ultima_ok || new Date(s.ultima_tentativa) > new Date(s.ultima_ok)); });
    var retratoVelho = !rt || !rt.gerado_em || AV.minutosNaJanela(rt.gerado_em, agora) > LIMITE_MIN;
    var tFalha = falhas.map(function (s) { return s.ultima_tentativa; }).sort().pop() || null;
    return { velho: retratoVelho || velhas.length > 0, falha: falhas.length > 0, velhas: velhas, falhas: falhas, quandoFalhou: tFalha };
  };
  function horaDosDados() {
    var rt = AV.retrato, st = AV.situacaoDados(sync, rt);
    var linhas = sync.map(function (s) {
      var t = nomeFonte(s.fonte) + ": " + (s.ultima_ok ? AV.dataHoraCaico(s.ultima_ok) : "ainda não chegou");
      // tentativa mais nova que a última cópia boa COM erro anotado = falhou (a mesma regra do aviso de falha, D1). Tentativa
      // mais nova SEM erro não quer dizer nada: o robô anota a tentativa antes de copiar e ela pode ficar depois da hora boa.
      if (s.ultimo_erro && s.ultima_tentativa && (!s.ultima_ok || new Date(s.ultima_tentativa) > new Date(s.ultima_ok)))
        t += " (a tentativa de " + AV.dataHoraCaico(s.ultima_tentativa) + " falhou)";
      return t;
    }).sort(function (a, b) { return a.localeCompare(b, "pt-BR"); });
    var det = "Última atualização da nuvem (o retrato que a tela lê): " + AV.dataHoraCaico(rt && rt.gerado_em) +
      "\nQuando cada parte dos dados do VR chegou:\n" + linhas.join("\n");
    var ruim = st.velho || st.falha;
    return '<span class="av-dado' + (ruim ? " av-velho" : "") + '" data-av-atualizacao="' + (st.falha ? "falha" : st.velho ? "desatualizado" : "em-dia") + '" title="' + AV.esc(det) + '">' +
      (ruim ? "Dados desatualizados · " : "") + "Última atualização: " + AV.dataHoraCaico(rt && rt.gerado_em) + "</span>";
  }
  // o aviso grande, logo abaixo do título: dado velho nunca parece atual
  function avisoAtualizacao() {
    var rt = AV.retrato, st = AV.situacaoDados(sync, rt), h = "";
    if (st.falha) h += AV.aviso("vm", "<b>A última tentativa de atualizar os dados do VR falhou</b> (" + AV.dataHoraCaico(st.quandoFalhou) + "). " +
      "Os números abaixo são da última atualização que deu certo, de " + AV.dataHoraCaico(rt && rt.gerado_em) + ".");
    else if (st.velho) h += AV.aviso("vm", "<b>Dados desatualizados.</b> A última atualização foi em " + AV.dataHoraCaico(rt && rt.gerado_em) +
      " e passou mais de 1 hora sem atualizar dentro do horário do robô (06h às 21h). Os números abaixo são daquele momento, não de agora.");
    return h ? '<div data-av-aviso-dados="1">' + h + "</div>" : "";
  }

  // ---------- a tela aberta não fica velha calada (na loja o Painel fica aberto o dia inteiro) ----------
  // UM relógio só (abrir de novo não cria outro). A cada minuto refaz a conta da idade e troca SÓ a hora e o aviso: a área,
  // o número digitado na busca, a rolagem e a gaveta aberta ficam. A cada 5 min, e ao voltar para a aba do navegador, relê
  // a sincronização (uma consulta pequena, ao vivo): uma falha anotada aparece sem ninguém tocar, e um retrato novo refaz a
  // tela (uma vez por versão). Só trabalha com a tela à vista (aba visível e a página Avarias ativa); fora dela, nada é lido.
  // Se a releitura falhar (rede, sessão vencida), a tela fica e só a idade avisa — a limitação prevista na D1.
  var TIQUE_MS = 60e3, RELER_MS = 5 * 60e3, relogio = null, syncLidoEm = 0, lendoSync = false, ultimaHora = "", ultimoAviso = "";
  function fontesDaSync(L) { return (L || []).filter(function (s) { return String(s.fonte || "") !== "conferencia_js"; }); }
  function aVista() {
    if (document.visibilityState && document.visibilityState !== "visible") return false;
    var pg = raiz && raiz.closest ? raiz.closest(".page") : null;
    return !pg || pg.classList.contains("ativo");
  }
  function trocarHora() {
    var topo = raiz.querySelector(".av-topo"), dado = topo && topo.querySelector(".av-dado");
    if (!dado || !sync) return;
    var h = horaDosDados(), novo = avisoAtualizacao();
    if (h !== ultimaHora) { dado.insertAdjacentHTML("afterend", h); dado.parentNode.removeChild(dado); ultimaHora = h; }
    if (novo !== ultimoAviso) {
      var velho = raiz.querySelector("[data-av-aviso-dados]");
      if (velho) velho.parentNode.removeChild(velho);
      if (novo) topo.insertAdjacentHTML("afterend", novo);
      ultimoAviso = novo;
    }
  }
  function lerSyncDeNovo() {
    if (lendoSync || !window.__SB) return;
    lendoSync = true; syncLidoEm = Date.now(); delete cache["sync|{}"];
    AV.ler("sync").then(function (L) {
      lendoSync = false;
      if (!raiz || !raiz.isConnected || !raiz.querySelector(".av-topo")) return;
      // zero linhas: o banco parou de entregar (o master tirou a chave ou bloqueou a ficha) — a tela se refaz e mostra
      // a mensagem de quem não tem acesso, sem nenhum número
      if (!L.length) { recarregado = null; cache = {}; return AV.abrir(raiz, { silencioso: true }); }
      sync = fontesDaSync(L);
      if (aVista()) trocarHora();
      notarVersao(L.retrato, { silencioso: true });   // a linha ao vivo traz a versão PUBLICADA agora: outra = retrato novo
    }, function (e) {
      lendoSync = false;
      if (window.console) console.warn("Avarias: não deu para reler a sincronização agora (a idade dos dados continua avisando).", e);
    });
  }
  function tique(forcar) {
    if (!raiz || !raiz.isConnected || !raiz.querySelector(".av-topo")) { clearInterval(relogio); relogio = null; return; }
    if (!aVista()) return;
    trocarHora();
    if (forcar || Date.now() - syncLidoEm >= RELER_MS) lerSyncDeNovo();
  }
  function ligarRelogio() { if (!relogio) relogio = setInterval(function () { tique(false); }, TIQUE_MS); }
  // (fora do navegador, como no teste do robô que roda a regra do aviso, não há página: o relógio só existe no navegador)
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", function () { if (relogio && document.visibilityState === "visible") tique(true); });

  function casca() {
    var a = AV.estado.area;
    ultimaHora = horaDosDados(); ultimoAviso = avisoAtualizacao();
    var h = '<div class="av"><div class="av-topo"><div><h2>Avarias ' + SELO + "</h2><p>Mercadoria na troca, títulos de devolução e acertos com fornecedor</p></div>" + ultimaHora + "</div>" + ultimoAviso;
    h += '<nav class="av-abas" role="tablist" aria-label="Áreas de Avarias">';
    AREAS.forEach(function (x) { h += '<button type="button" role="tab" data-av-area="' + x.id + '" aria-selected="' + (x.id === a) + '" class="' + (x.id === a ? "av-on" : "") + '">' + x.nome + "</button>"; });
    h += "</nav>" + filtros(a) + '<div id="avArea" class="av-area"></div></div>';
    raiz.innerHTML = h;
    raiz.querySelectorAll("[data-av-area]").forEach(function (b) { b.addEventListener("click", function () { AV.irPara(b.getAttribute("data-av-area")); }); });
    raiz.querySelectorAll("[data-av-filtro]").forEach(function (s) { s.addEventListener("change", function () { AV.estado[s.getAttribute("data-av-filtro")] = s.value; casca(); }); });
    var campo = raiz.querySelector("#avBuscaNota"), ir = function () { AV.buscarNota(campo.value); };
    raiz.querySelector("[data-av-abrir-nota]").addEventListener("click", ir);
    campo.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); ir(); } });
    desenharArea();
  }
  AV.irPara = function (area, extra) {
    AV.estado.area = area; if (extra) for (var k in extra) AV.estado[k] = extra[k];
    AV.fecharGaveta(true); casca(); window.scrollTo(0, 0);
  };
  AV.redesenhar = function () { casca(); };

  function filtros(area) {
    var usa = FILTROS[area], h = '<div class="av-filtros">';
    if (usa.indexOf("periodo") >= 0) {
      var grupos = {}, ordem = [];
      AV.periodos().forEach(function (p) { if (!grupos[p.grupo]) { grupos[p.grupo] = []; ordem.push(p.grupo); } grupos[p.grupo].push(p); });
      h += '<label class="av-f"><span>Período</span><select data-av-filtro="periodo">';
      ordem.forEach(function (g) { h += '<optgroup label="' + g + '">'; grupos[g].forEach(function (p) { h += '<option value="' + p.id + '"' + (p.id === AV.estado.periodo ? " selected" : "") + ">" + AV.esc(p.rotulo) + "</option>"; }); h += "</optgroup>"; });
      h += "</select></label>";
    }
    if (usa.indexOf("setor") >= 0) {
      var ids = Object.keys(AV.setores).sort(function (x, y) { return AV.setores[x].localeCompare(AV.setores[y], "pt-BR"); });
      h += '<label class="av-f"><span>Setor</span><select data-av-filtro="setor"><option value="">Todos os setores</option>';
      ids.forEach(function (id) { h += '<option value="' + id + '"' + (String(AV.estado.setor) === id ? " selected" : "") + ">" + AV.esc(AV.setores[id]) + "</option>"; });
      h += "</select></label>";
    }
    if (usa.indexOf("motivo") >= 0) {
      h += '<label class="av-f"><span>Motivo</span><select data-av-filtro="motivo"><option value="">Todos os motivos de avaria</option>';
      AV.MOTIVOS_AVARIA.forEach(function (m) { h += '<option value="' + m + '"' + (String(AV.estado.motivo) === String(m) ? " selected" : "") + ">" + AV.esc(AV.nomeMotivo(m)) + "</option>"; });
      h += "</select></label>";
    }
    var nota = { pendencias: "As filas mostram a situação de agora: o período não se aplica. O setor filtra só a fila A (mercadoria); títulos e notas não têm setor único.",
      fornecedores: "Setor e motivo não se aplicam aqui: notas, títulos e verbas são por fornecedor." }[area];
    if (nota) h += '<p class="av-f-nota">' + nota + "</p>";
    // a busca por número de nota vale em qualquer área (só lê o índice das notas copiadas do VR e abre o detalhe)
    h += '<div class="av-f av-nbusca"><span id="avBuscaRot">Abrir nota nº</span><div class="av-nbusca-l">' +
      '<input id="avBuscaNota" class="av-nbusca-campo" type="text" inputmode="numeric" autocomplete="off" maxlength="40" aria-labelledby="avBuscaRot" placeholder="número da NF" value="' + AV.esc(AV.estado.buscaNota || "") + '">' +
      '<button type="button" class="av-bt" data-av-abrir-nota="1">Abrir</button></div></div><p id="avBuscaRes" class="av-nbusca-res" role="status"></p>';
    return h + "</div>";
  }

  function desenharArea() {
    var el = document.getElementById("avArea"), fn = (AV.areas || {})[AV.estado.area];
    if (!fn) return AV.falhou(el, "área não carregou");
    try { fn(el); } catch (e) { AV.falhou(el, e); if (window.console) console.error(e); }
  }
  AV.areas = AV.areas || {};

  // ---------- BUSCA POR NÚMERO DE NOTA (só leitura) ----------
  // Lê o índice das notas copiadas do VR (consulta notasIndice) e compara o número. Nenhuma nota: diz que não há. Uma: abre
  // o detalhe. Várias (séries ou tipos diferentes com o mesmo número): lista para a pessoa escolher — nunca escolhe sozinha.
  // O detalhe abre como nas Pendências (sem o fornecedor relacionado, que é só da análise).
  // O número é o PRIMEIRO grupo de dígitos do texto: "NF 000.012.345", "Nº 12.345" e " 12 345 " viram 12345 (ponto ou espaço
  // só contam como separador de milhar antes de exatamente 3 dígitos). Sobrou outro número depois ("12345/1", "12345 série 1")?
  // Não junta nem escolhe: pede só o número da nota.
  AV.numeroDaBusca = function (texto) {
    var t = String(texto || ""), m = /\d{1,3}(?:[.\s]\d{3})+(?!\d)|\d+/.exec(t);
    if (!m) return { num: "" };
    return { num: m[0].replace(/\D/g, "").replace(/^0+(?=\d)/, ""), sobrou: /\d/.test(t.slice(m.index + m[0].length)) };
  };
  AV.buscarNota = function (texto) {
    var lido = AV.numeroDaBusca(texto), num = lido.num;
    var diz = function (t) { var el = document.getElementById("avBuscaRes"); if (el) el.innerHTML = t; };
    AV.estado.buscaNota = lido.sobrou ? String(texto || "").trim().slice(0, 40) : num;
    if (!num) { diz("Digite o número da nota (só os números)."); return Promise.resolve([]); }
    if (lido.sobrou) { diz("Digite só o número da nota, sem a série nem outro número."); return Promise.resolve([]); }
    diz("Procurando a nota " + num + "…");
    return AV.ler("notasIndice").then(function (L) {
      var achou = L.filter(function (n) { return n.numero !== null && n.numero !== undefined && String(n.numero) === num; });
      if (!achou.length) diz("Nenhuma nota com o número " + num + " nas cópias do VR.");
      else if (achou.length === 1) { diz(""); AV.abrirNota(achou[0].nota_id, { origem: "pendencias" }); }
      else { diz(""); escolherNota(num, achou); }
      return achou;
    }, function () { diz("Não deu para procurar agora. Tente de novo em instantes."); return []; });
  };
  function escolherNota(num, L) {
    var corpo = AV.gaveta("Notas com o número " + num, "Há " + L.length + " notas com esse número nas cópias do VR (séries ou tipos diferentes). Escolha qual abrir.", "");
    corpo.innerHTML = AV.tabela([
      { t: "Nota", cel: "principal", v: function (n) { return '<button type="button" class="av-lk" data-av-nota="' + AV.esc(n.nota_id) + '">NF ' + AV.esc(n.numero) + "</button>"; } },
      { t: "Série", v: function (n) { return n.serie ? AV.esc(n.serie) : "—"; } },
      { t: "Data", v: function (n) { return AV.data(n.data); } },
      { t: "Tipo", v: function (n) { return AV.esc(n.tipo || "—") + (+n.nfe === 1 ? "" : ' <span class="av-chip">não autorizada no VR</span>'); } },
      { t: "Valor", cls: "n", v: function (n) { return AV.rs(n.valor); } }
    ], L.slice().sort(function (a, b) { return String(a.data).localeCompare(String(b.data)) || String(a.serie || "").localeCompare(String(b.serie || "")) || a.nota_id - b.nota_id; }));
    corpo.querySelectorAll("[data-av-nota]").forEach(function (b) { b.addEventListener("click", function () { AV.abrirNota(+b.getAttribute("data-av-nota"), { origem: "pendencias" }); }); });
  }

  // filtros aplicados a uma linha que tem mes/setor_id/motivo
  AV.noPeriodo = function (mes) { return AV.periodo(AV.estado.periodo).meses.indexOf(mes) >= 0; };
  AV.noSetor = function (setor) { return !AV.estado.setor || String(setor) === String(AV.estado.setor); };
  AV.noMotivo = function (m) { return !AV.estado.motivo ? AV.MOTIVOS_AVARIA.indexOf(+m) >= 0 : String(m) === String(AV.estado.motivo); };
  AV.textoFiltro = function (usa) {
    var p = AV.periodo(AV.estado.periodo), t = [];
    if (usa.indexOf("periodo") >= 0) t.push(p.rotulo.replace(/^Mês atual · /, ""));
    if (usa.indexOf("setor") >= 0 && AV.estado.setor) t.push(AV.nomeSetor(AV.estado.setor));
    if (usa.indexOf("motivo") >= 0 && AV.estado.motivo) t.push(AV.nomeMotivo(+AV.estado.motivo));
    return t.join(" · ");
  };
})();
