/* ==ENC-PAINEL== PLANEJAMENTO DE ENCARTES — a ligação da tela com a nuvem.
   Mesmo molde do Compra × Venda (==CXV-PAINEL==):
     - carrega QUANDO A PÁGINA ABRE (nunca no login nem no menu) e guarda por 2 min;
       nenhuma pergunta repetida ao banco sozinha (nada de relógio lendo a nuvem);
     - pede SÓ as colunas que a tela desenha, sempre com teto (.limit) e, quando a lista
       pode passar de mil linhas (o teto do Supabase), em páginas com ordem fixa;
     - a ficha do VR (~47 mil produtos) NUNCA vem inteira: busca por encarte_buscar_produtos
       e detalhe por código (no máximo 50 de uma vez);
     - toda escrita é por função do banco (encarte_*): elas conferem o papel de novo,
       carimbam quem fez e aplicam as regras (versão, reabrir vaga, crítica no ar).
   Quem pode ler: página "encartes" (ou "encartes_comprador"). Comprador: "encartes_comprador"
   ou master. Aprovação, modelos, ação temática, coincidência e "anterior ao processo": master.
   Funções que o resto do painel chama (contrato):
     window.encAbrir()                       — abre/recarrega a tela (respeita a guarda de 2 min)
     window.encAbrirEdicao(edicaoId)         — abre direto uma edição (etiqueta do Calendário)
     window.encResumoCalendario(de, ate)     — Promise<[{edicao_id, campanha_id, titulo, inicio, fim,
                                               prazos, contagem, situacao, grupos:[{nome,inicio,fim,prazos}]}]>
                                               (sem login ou sem tabela: []) */
(function () {
  var E = window.ENC;
  var GUARDA_MS = 2 * 60e3;   // guarda 2 min; nada abaixo de 1 min (régua do consumo)
  var PAG = 1000;             // teto de linhas por pedido (o do Supabase); passou disso, pagina
  var LOTE_ED = 40;           // edições por pedido (endereço curto)
  var LOTE_VAGA = 100;        // vagas por pedido (100 códigos ≈ 3,7 KB no endereço)
  var D = null, lidoEm = 0, lendo = null, tentativas = 0, esperando = false, pendente = null;
  var DET = {}, LENDO_DET = {};  // detalhe de cada edição aberta (vagas completas, propostas, histórico)
  var FICHA = {};                // ficha do VR por produto: {em, f}
  var CAL = {};                  // resumo do Calendário por intervalo: {em, lista} ou {lendo}

  var COL_REGRAS = "id,nome,tipo,categoria,regra,setor,cor,situacao,ordem";
  var COL_MODELOS = "id,campanha_id,tipo,nome,prazos,dias_antes_no_ar,estrutura,dicas,versao,ativo,atualizado_por_nome,atualizado_em";
  var COL_EDICOES = "id,campanha_id,modelo_id,modelo_versao,titulo,inicio_regra,inicio,fim,prazos,situacao,excecao,sem_penalidade,versao,criado_por_nome,criado_em";
  var COL_GRUPOS = "id,edicao_id,chave,nome,identidade,tipo,tema_modelo_id,flv,inicio,fim,prazos,ordem,situacao";
  // A fila só conta e lista nomes: vaga "leve". O detalhe (foto aprovada, devolução) só ao abrir a edição.
  var COL_VAGAS_LEVE = "id,edicao_id,grupo_id,nome,situacao,estado,proposta_escolhida";
  var COL_VAGAS = "id,edicao_id,grupo_id,ordem,nome,o_que_muda,papel,obrigatoria,categoria_vr,origem,situacao,motivo_retirada,proposta_escolhida," +
    "escolhida_por_nome,escolhida_em,estado,foto_aprovada,aprovada_em,devolucao,versao,criado_por_nome,criado_em";
  var COL_PROP = "id,vaga_id,fornecedor_id,fornecedor_nome,produtos,produtos_info,custo_hoje,custo_confiavel,preco_normal,dados_vr_em,custo_negociado," +
    "preco_oferta,verba_valor,verba_qtd_base,bonif_compra,bonif_ganha,bonificacao_texto,condicao_pagamento,quantidade_minima,validade,observacao," +
    "situacao,registrado_por,registrado_por_nome,registrado_em,atualizado_por_nome,atualizado_em";
  var COL_EVENTOS = "id,grupo_id,vaga_id,proposta_id,tipo,antes,depois,motivo,categoria,destaque,por_nome,em";
  var COL_APROV = "id,grupo_id,aprovado_por_nome,aprovado_em,versao_vista,vagas_aprovadas,devolucoes";
  var COL_FICHA = "produto_id,descricao,eans,m1,m2,setor,grupo,subgrupo,preco_normal,preco_atual,em_oferta,custo,custo_confiavel,estoque,venda30_qtd," +
    "ultima_compra,ultima_compra_fornecedor,ultima_oferta,fornecedores,atualizado_em";
  var COL_SYNC = "chave,ultima_ok_em,ultima_tentativa_em,ultimo_erro";

  function sb() { return window.__SB || null; }
  function perfil() { return window.__PERFIL || null; }
  function master() { var p = perfil(); return !!(p && p.is_master); }
  function comprador() { var p = perfil(); return !!(p && (p.is_master || (p.paginas || []).indexOf("encartes_comprador") >= 0)); }
  function raiz() { return document.getElementById("encRaiz"); }
  function ativa(v) { return (v.situacao || "ativa") === "ativa"; }
  // Recado no lugar da tela (carregando, sem login, erro). Só texto nosso: o erro cru vai para o console.
  function aviso(txt) {
    var r = raiz(); if (!r) return;
    r.classList.add("enc");
    r.innerHTML = '<div class="enc-cartao"><h2 style="margin:0 0 6px;font-size:20px;color:#0c5a26">Planejamento de Encartes</h2><p style="margin:0;font-size:13.5px;color:#4a5568;line-height:1.6">' +
      String(txt).replace(/[<>&]/g, "") + "</p></div>";
  }
  // Tabela ou função que ainda não existe no banco: o arquivo encartes_v1.sql não foi rodado.
  function faltaTabela(e) { return !!e && /PGRST205|PGRST202|42P01|42883|does not exist|schema cache|Could not find the/i.test((e.code || "") + " " + (e.message || "")); }
  var FALTA_SQL = "O banco ainda não está pronto: falta rodar o arquivo encartes_v1.sql no Supabase.";
  /* ERRO NA TELA = SEMPRE EM PORTUGUÊS. O nosso banco (as funções encarte_*) recusa com texto
     em português e um DETAIL de uma palavra (versao_mudou, sem_permissao...): esse passa como
     veio. O resto chega em inglês — do supabase-js ("TypeError: Failed to fetch"), do PostgREST
     ("JWT expired", "permission denied for function…", 'invalid input syntax for type uuid')
     ou do navegador — e vira uma frase fixa. Nenhum texto desses chega cru à pessoa. */
  var ERRO_REDE = "Sem conexão com a nuvem agora. Tente de novo.";
  var ERRO_SESSAO = "Sua sessão expirou. Entre de novo no painel.";
  var ERRO_PERMISSAO = "Você não tem permissão para esta ação.";
  var ERRO_FORMATO = "Algum campo está com formato inválido.";
  var ERRO_OUTRO = "Não deu para completar agora. Tente de novo.";
  function erroParaPessoa(e) {
    if (!e) return ERRO_OUTRO;
    if (typeof e === "string") e = { message: e };
    var msg = String(e.message || ""), cod = String(e.code || ""), det = e.details == null ? "" : String(e.details), st = +e.status || 0;
    if (/^[a-z][a-z0-9_]*$/.test(det) && msg) return msg;             // o nosso banco: DETAIL estável + texto em português
    if (faltaTabela(e)) return FALTA_SQL;
    if (/failed to fetch|networkerror|network request failed|load failed|err_internet|err_network|timed? ?out|aborted|offline/i.test(msg)) return ERRO_REDE;
    if (/^PGRST30\d$/.test(cod) || st === 401 || /\bjwt\b|not authenticated|refresh token|session (expired|not found)/i.test(msg)) return ERRO_SESSAO;
    if (cod === "42501" || st === 403 || /permission denied|row-level security|insufficient.privilege/i.test(msg)) return ERRO_PERMISSAO;
    if (/^22|^23502$|^23514$|^PGRST1\d\d$/.test(cod) || /invalid input|malformed|out of range|violates (check|not-null)/i.test(msg)) return ERRO_FORMATO;
    return ERRO_OUTRO;
  }

  function lista(consulta) { return Promise.resolve(consulta).then(function (r) { if (r.error) throw r.error; return r.data || []; }); }
  function emLotes(ids, tam, fn) {
    var ps = [];
    for (var i = 0; i < ids.length; i += tam) ps.push(fn(ids.slice(i, i + tam)));
    return Promise.all(ps).then(function (rs) { return [].concat.apply([], rs); });
  }
  // Páginas de 1.000 com ordem fixa (sem ordem, as páginas duplicam ou pulam linhas).
  function paginado(montar, teto) {
    var out = [];
    function pg(ini) {
      return lista(montar(ini, ini + PAG - 1)).then(function (d) {
        out = out.concat(d);
        if (d.length === PAG && out.length < (teto || 20000)) return pg(ini + PAG);
        return out;
      });
    }
    return pg(0);
  }
  function idDe(x) { return x.id; }

  /* ======================= A FILA (ao abrir a página) ======================= */
  function lerEdicoes(cli, h) {
    return lista(cli.from("encarte_edicoes").select(COL_EDICOES).gte("fim", E.addDias(h, -14)).order("inicio", { ascending: true }).limit(400));
  }
  /* (2) Cria as edições que JÁ deviam existir (começar ≤ hoje e fim ≥ hoje − 7). A criação é
     idempotente no banco (unique campanha + início da regra): duas telas abrindo juntas não
     duplicam. Os prazos vão calculados daqui (calculo.cjs é a autoridade das datas). */
  function criarQueFaltam(cli, N, eds, h) {
    var faltam = [];
    try { faltam = E.edicoesParaCriar(N.regras, N.modelos, h, eds, { diasPassados: 7 }); } catch (e) { faltam = []; }
    if (!faltam.length) return Promise.resolve(eds);
    faltam = faltam.slice(0, 30);
    var erros = [], criou = 0;
    return faltam.reduce(function (p, e) {
      return p.then(function () {
        return Promise.resolve(cli.rpc("encarte_criar_edicao", { p_campanha: e.campanha_id, p_inicio_regra: e.inicio_regra, p_inicio: e.inicio, p_fim: e.fim, p_prazos: e.prazos }))
          .then(function (r) {
            if (r.error) { if (faltaTabela(r.error)) throw r.error; erros.push(e.nome + " de " + E.fmtData(e.inicio, { curta: true }) + ": " + erroParaPessoa(r.error)); }
            else criou++;
          });
      });
    }, Promise.resolve()).then(function () {
      if (erros.length) N.avisoCriacao = "Não consegui abrir " + erros.length + (erros.length === 1 ? " edição que já devia existir" : " edições que já deviam existir") + " — " + erros.slice(0, 3).join(" · ");
      return criou ? lerEdicoes(cli, h) : eds;
    });
  }
  function lerVagasDaFila(cli, N, eds) {
    var ids = eds.map(idDe), eu = perfil();
    N.grupos = []; N.vagas = []; N.propLeves = []; N.minhas = {};
    if (!ids.length) return Promise.resolve();
    return Promise.all([
      emLotes(ids, LOTE_ED, function (l) { return lista(cli.from("encarte_grupos").select(COL_GRUPOS).in("edicao_id", l).order("ordem", { ascending: true }).limit(PAG)); }),
      emLotes(ids, LOTE_ED, function (l) { return paginado(function (a, b) { return cli.from("encarte_vagas").select(COL_VAGAS_LEVE).in("edicao_id", l).order("id", { ascending: true }).limit(PAG).range(a, b); }); }),
      eu && eu.id ? lista(cli.from("encarte_propostas").select("vaga_id").eq("registrado_por", eu.id).order("registrado_em", { ascending: false }).limit(PAG)) : Promise.resolve([])
    ]).then(function (rs) {
      N.grupos = rs[0]; N.vagas = rs[1];
      rs[2].forEach(function (x) { N.minhas[x.vaga_id] = true; });
      // "Negociando" só importa para vaga ainda sem escolha: só essas precisam das propostas.
      var semEscolha = N.vagas.filter(function (v) { return ativa(v) && !v.proposta_escolhida; }).map(idDe);
      return emLotes(semEscolha, LOTE_VAGA, function (l) {
        return paginado(function (a, b) { return cli.from("encarte_propostas").select("vaga_id,situacao").in("vaga_id", l).eq("situacao", "ativa").order("id", { ascending: true }).limit(PAG).range(a, b); });
      });
    }).then(function (props) { N.propLeves = props; });
  }
  function carregar(forcar) {
    var cli = sb();
    // Recarregar a página já nesta aba abre a tela antes do login terminar (__SB/__PERFIL vazios).
    // Espera o login em vez de desistir: até ~20 s, de 0,5 em 0,5 s (um relógio só).
    if (!cli || !perfil()) {
      if (esperando) return Promise.resolve(null);
      if (tentativas++ < 40) { if (!D) aviso("Carregando…"); esperando = true; setTimeout(function () { esperando = false; carregar(forcar); }, 500); return Promise.resolve(null); }
      tentativas = 0; aviso("Entre no painel para ver o Planejamento de Encartes."); return Promise.resolve(null);
    }
    tentativas = 0;
    if (!forcar && D && Date.now() - lidoEm < GUARDA_MS) { mostrar(); return Promise.resolve(D); }
    if (lendo) return lendo;
    if (!D) aviso("Carregando…");
    var h = E.hojeISO(), N = { hoje: h, avisoCriacao: null };
    lendo = Promise.all([
      lista(cli.from("calendario_regras").select(COL_REGRAS).order("ordem", { ascending: true }).limit(300)),
      lista(cli.from("encarte_modelos").select(COL_MODELOS).eq("ativo", true).order("id", { ascending: true }).limit(200)),
      lerEdicoes(cli, h),
      lista(cli.from("encarte_sync").select(COL_SYNC).eq("chave", "produtos").limit(1))
    ]).then(function (rs) {
      N.regras = rs[0]; N.modelos = rs[1]; N.sync = rs[3][0] || null;
      if (!N.regras.length) { var e = new Error("sem acesso"); e.semAcesso = true; throw e; }
      return criarQueFaltam(cli, N, rs[2], h);
    }).then(function (eds) {
      N.edicoes = eds;
      return lerVagasDaFila(cli, N, eds);
    }).then(function () {
      N.futuras = E.edicoesFuturas(N.regras, N.modelos, h, 70, N.edicoes);
      D = N; lidoEm = Date.now(); lendo = null;
      mostrar();
      return D;
    }).catch(function (e) {
      lendo = null;
      // o texto cru (em inglês) fica só no console; na tela, a frase em português
      var t = e && e.semAcesso ? "" : erroParaPessoa(e);
      var txt = e && e.semAcesso ? "Você não tem acesso ao Planejamento de Encartes, ou as campanhas ainda não foram cadastradas no Calendário."
        : t === ERRO_OUTRO ? "Não deu para carregar agora. Tente de novo em instantes." : t;
      if (e && !e.semAcesso && window.console) console.error(e);
      if (D && window.encTela && raiz() && raiz().querySelector(".enc-tela")) { window.encTela.aviso(txt, "erro"); window.encTela.atualizar(); }
      else aviso(txt);
      return null;
    });
    return lendo;
  }
  function mostrar() {
    var r = raiz(); if (!r || !D) return;
    if (!window.encTela) return aviso("A tela não carregou por completo. Recarregue a página.");
    if (!r.querySelector(".enc-tela")) window.encTela.montar(r, API);
    else window.encTela.atualizar();
    if (pendente) { var p = pendente; pendente = null; window.encTela.ir(p); }
  }

  /* ======================= DETALHE DE UMA EDIÇÃO (ao abrir a edição) ======================= */
  function detalhe(id, forcar) {
    var cli = sb();
    if (!cli) return Promise.reject({ message: "Entre no painel para ver a edição.", details: "sem_login" });
    var d0 = DET[id];
    if (!forcar && d0 && Date.now() - d0.lidoEm < GUARDA_MS) return Promise.resolve(d0);
    if (LENDO_DET[id]) return LENDO_DET[id];
    var det = { lidoEm: 0 };
    var pr = Promise.all([
      lista(cli.from("encarte_edicoes").select(COL_EDICOES).eq("id", id).limit(1)),
      lista(cli.from("encarte_grupos").select(COL_GRUPOS).eq("edicao_id", id).order("ordem", { ascending: true }).limit(300)),
      paginado(function (a, b) { return cli.from("encarte_vagas").select(COL_VAGAS).eq("edicao_id", id).order("ordem", { ascending: true }).order("id", { ascending: true }).limit(PAG).range(a, b); }),
      lista(consultaEventos(cli, id, 0)),
      lista(cli.from("encarte_aprovacoes").select(COL_APROV).eq("edicao_id", id).order("aprovado_em", { ascending: false }).limit(50))
    ]).then(function (rs) {
      if (!rs[0].length) return null;
      det.edicao = rs[0][0]; det.grupos = rs[1]; det.vagas = rs[2]; det.eventos = rs[3]; det.aprovacoes = rs[4];
      det.eventosTalvezMais = rs[3].length === PAG_EV; // página cheia: pode haver mais (a tela diz "últimos N")
      return emLotes(det.vagas.map(idDe), LOTE_VAGA, function (l) {
        return paginado(function (a, b) { return cli.from("encarte_propostas").select(COL_PROP).in("vaga_id", l).order("registrado_em", { ascending: true }).order("id", { ascending: true }).limit(PAG).range(a, b); });
      }).then(function (props) {
        det.propostas = props; det.lidoEm = Date.now(); DET[id] = det;
        sincronizarFila(det);
        return det;
      });
    });
    LENDO_DET[id] = pr;
    pr.then(function () { delete LENDO_DET[id]; }, function () { delete LENDO_DET[id]; });
    return pr;
  }
  /* O histórico (o livro que só cresce) em páginas de 300, do mais novo para o mais velho, com
     ordem fixa (em, id) — sem ordem as páginas duplicam ou pulam. "Ver mais" pede a próxima
     página na MESMA ordem; o que entrou no meio tempo só empurra, e o repetido é descartado. */
  var PAG_EV = 300;
  function consultaEventos(cli, id, ini) {
    return cli.from("encarte_eventos").select(COL_EVENTOS).eq("edicao_id", id).order("em", { ascending: false }).order("id", { ascending: false })
      .limit(PAG_EV).range(ini, ini + PAG_EV - 1);
  }
  function maisEventos(id) {
    var cli = sb(), det = DET[id];
    if (!cli || !det) return Promise.resolve({ erro: "Abra a edição de novo para ver o histórico." });
    return lista(consultaEventos(cli, id, det.eventos.length)).then(function (L) {
      var visto = {}; det.eventos.forEach(function (ev) { visto[ev.id] = 1; });
      det.eventos = det.eventos.concat(L.filter(function (ev) { return !visto[ev.id]; }));
      det.eventosTalvezMais = L.length === PAG_EV;
      return { ok: true };
    }, function (e) { return { erro: erroParaPessoa(e) }; });
  }
  // Depois de ler (ou gravar) uma edição, a fila passa a contar com o que acabou de chegar,
  // sem reler a fila inteira.
  function sincronizarFila(det) {
    if (!D) return;
    var ed = det.edicao, achou = false;
    D.edicoes = D.edicoes.map(function (e) { if (e.id === ed.id) { achou = true; return ed; } return e; });
    if (!achou) return; // edição fora da janela da fila (ex.: aberta pelo Calendário)
    D.grupos = D.grupos.filter(function (g) { return g.edicao_id !== ed.id; }).concat(det.grupos);
    D.vagas = D.vagas.filter(function (v) { return v.edicao_id !== ed.id; }).concat(det.vagas.map(function (v) {
      return { id: v.id, edicao_id: v.edicao_id, grupo_id: v.grupo_id, nome: v.nome, situacao: v.situacao, estado: v.estado, proposta_escolhida: v.proposta_escolhida };
    }));
    var daqui = {}; det.vagas.forEach(function (v) { daqui[v.id] = 1; });
    D.propLeves = D.propLeves.filter(function (p) { return !daqui[p.vaga_id]; }).concat(det.propostas.filter(ativa).map(function (p) { return { vaga_id: p.vaga_id, situacao: "ativa" }; }));
    var eu = perfil();
    det.propostas.forEach(function (p) { if (eu && p.registrado_por === eu.id) D.minhas[p.vaga_id] = true; });
  }

  /* ======================= FICHA DO VR (nunca inteira) ======================= */
  function fichas(ids) {
    var cli = sb(), agora = Date.now(), mapa = {}, falta = [];
    (ids || []).forEach(function (id) { var c = FICHA[id]; if (c && agora - c.em < GUARDA_MS) mapa[id] = c.f; else if (falta.indexOf(+id) < 0) falta.push(+id); });
    if (!falta.length || !cli) return Promise.resolve(mapa);
    return lista(cli.from("encarte_produtos_vr").select(COL_FICHA).in("produto_id", falta.slice(0, 50)).limit(50)).then(function (L) {
      L.forEach(function (f) { FICHA[f.produto_id] = { em: Date.now(), f: f }; mapa[f.produto_id] = f; });
      return mapa;
    }, function () { return mapa; });
  }
  function fichaGuardada(id) { var c = FICHA[id]; return c ? c.f : null; }
  // Busca na ficha por texto/EAN (ou, com texto vazio e o grupo do VR, os mais vendidos do grupo).
  // Teto de 20 no pedido (o banco corta em 50). A mesma busca repetida em 2 min não volta ao banco.
  var BUSCA = {};
  function buscar(texto, m1, m2) {
    var cli = sb();
    if (!cli) return Promise.resolve({ produtos: [], erro: "Entre no painel." });
    var k = String(texto || "").trim().toUpperCase() + "|" + (m1 == null ? "" : m1) + "|" + (m2 == null ? "" : m2), c = BUSCA[k];
    if (c && Date.now() - c.em < GUARDA_MS) return Promise.resolve(c.r);
    return Promise.resolve(cli.rpc("encarte_buscar_produtos", { p_texto: texto, p_m1: m1 == null ? null : m1, p_m2: m2 == null ? null : m2, p_limite: 20 })).then(function (r) {
      if (r.error) return { produtos: [], erro: erroParaPessoa(r.error) };
      var L = (r.data && r.data.produtos) || [];
      L.forEach(function (f) { FICHA[f.produto_id] = { em: Date.now(), f: f }; });
      BUSCA[k] = { em: Date.now(), r: { produtos: L } };
      return { produtos: L };
    }, function (e) { return { produtos: [], erro: erroParaPessoa(e) }; });
  }

  /* ======================= ESCRITA (só por função do banco) ======================= */
  // Devolve sempre {ok, data} ou {ok:false, erro (SEMPRE em português: ver erroParaPessoa), chave (DETAIL estável: versao_mudou, sem_permissao...)}.
  function rpc(nome, p) {
    var cli = sb();
    if (!cli) return Promise.resolve({ ok: false, erro: "Entre no painel para gravar.", chave: "sem_login" });
    return Promise.resolve(cli.rpc(nome, p)).then(function (r) {
      if (r.error) return { ok: false, erro: erroParaPessoa(r.error), chave: String(r.error.details || r.error.code || "").slice(0, 60) };
      if (r.data && r.data.ok === false) return { ok: false, erro: r.data.mensagem || "O banco recusou a ação.", chave: String(r.data.erro || "") };
      CAL = {}; // o resumo do Calendário muda junto
      return { ok: true, data: r.data };
    }, function (e) { return { ok: false, erro: erroParaPessoa(e), chave: "rede" }; });
  }
  function recarregarModelos() {
    var cli = sb();
    if (!cli || !D) return Promise.resolve();
    return lista(cli.from("encarte_modelos").select(COL_MODELOS).eq("ativo", true).order("id", { ascending: true }).limit(200)).then(function (L) {
      D.modelos = L;
      try { D.futuras = E.edicoesFuturas(D.regras, L, E.hojeISO(), 70, D.edicoes); } catch (e) {}
    }, function () {});
  }

  var API = {
    dados: function () { return D; },
    recarregar: function () { DET = {}; return carregar(true); },
    detalhe: detalhe,
    detalheGuardado: function (id) { return DET[id] || null; },
    detalhesGuardados: function () { return Object.keys(DET).map(function (k) { return DET[k]; }); },
    fichas: fichas, fichaGuardada: fichaGuardada, buscar: buscar,
    rpc: rpc, recarregarModelos: recarregarModelos, maisEventos: maisEventos, erroTexto: erroParaPessoa,
    master: master, comprador: comprador
  };

  /* ======================= O QUE O RESTO DO PAINEL CHAMA ======================= */
  window.encAbrir = function () {
    if (D && Date.now() - lidoEm < GUARDA_MS) { mostrar(); return; } // lido há pouco: a tela está montada
    carregar(false);
  };
  window.encAbrirEdicao = function (edicaoId) {
    if (!edicaoId) return;
    pendente = { tela: "edicao", id: String(edicaoId) };
    if (D) { mostrar(); if (Date.now() - lidoEm >= GUARDA_MS) carregar(false); return; }
    carregar(false);
  };
  /* Resumo das edições REAIS para o Calendário (etiquetas "definidas/total" e a Operação).
     Colunas enxutas, teto, guarda de 2 min por intervalo. Sem login ou sem tabela: []. */
  window.encResumoCalendario = function (de, ate) {
    var cli = sb();
    if (!cli || !perfil() || !de || !ate) return Promise.resolve([]);
    var k = de + "|" + ate, c = CAL[k];
    if (c && c.lendo) return c.lendo;
    if (c && Date.now() - c.em < GUARDA_MS) return Promise.resolve(c.lista);
    var h = E.hojeISO();
    var pr = lista(cli.from("encarte_edicoes").select("id,campanha_id,titulo,inicio_regra,inicio,fim,prazos,situacao,sem_penalidade")
      .eq("situacao", "ativa").gte("fim", de).lte("inicio", ate).order("inicio", { ascending: true }).limit(400))
      .then(function (eds) {
        var ids = eds.map(idDe);
        if (!ids.length) return [];
        return Promise.all([
          emLotes(ids, LOTE_ED, function (l) { return lista(cli.from("encarte_grupos").select("id,edicao_id,nome,inicio,fim,prazos,situacao,ordem").in("edicao_id", l).limit(PAG)); }),
          emLotes(ids, LOTE_ED, function (l) { return paginado(function (a, b) { return cli.from("encarte_vagas").select("id,edicao_id,grupo_id,situacao,estado,proposta_escolhida").in("edicao_id", l).order("id", { ascending: true }).limit(PAG).range(a, b); }); })
        ]).then(function (rs) {
          var grupos = rs[0], vagas = rs[1], iniGrupo = {};
          grupos.forEach(function (g) { iniGrupo[g.id] = g.inicio; });
          var semEsc = vagas.filter(function (v) { return ativa(v) && !v.proposta_escolhida; }).map(idDe);
          return emLotes(semEsc, LOTE_VAGA, function (l) {
            return paginado(function (a, b) { return cli.from("encarte_propostas").select("vaga_id,situacao").in("vaga_id", l).eq("situacao", "ativa").order("id", { ascending: true }).limit(PAG).range(a, b); });
          }).then(function (props) {
            var porEd = {}; vagas.forEach(function (v) { (porEd[v.edicao_id] = porEd[v.edicao_id] || []).push(v); });
            return eds.map(function (e) {
              var cont = E.contarVagas(porEd[e.id] || [], props);
              // "Entrou no ar sem aprovação" conta só a vaga cujo GRUPO já está no ar (o Fim de semana só na sexta)
              cont.pendentesNoAr = (porEd[e.id] || []).filter(function (v) {
                return ativa(v) && (v.estado || "pendente") !== "aprovada" && h >= (iniGrupo[v.grupo_id] || e.inicio);
              }).length;
              return {
                edicao_id: e.id, campanha_id: e.campanha_id, titulo: e.titulo, inicio_regra: e.inicio_regra, inicio: e.inicio, fim: e.fim, prazos: e.prazos,
                contagem: cont,
                situacao: E.situacao({ prazos: e.prazos, inicio: e.inicio, fim: e.fim, sem_penalidade: e.sem_penalidade === true }, cont, h),
                grupos: grupos.filter(function (g) { return g.edicao_id === e.id && g.situacao !== "removido"; })
                  .sort(function (x, y) { return (x.ordem || 0) - (y.ordem || 0); })
                  .map(function (g) { return { nome: g.nome, inicio: g.inicio || e.inicio, fim: g.fim || e.fim, prazos: g.prazos || null }; })
              };
            });
          });
        });
      })
      .then(function (L) { CAL[k] = { em: Date.now(), lista: L }; return L; }, function () { delete CAL[k]; return []; });
    CAL[k] = { lendo: pr, em: 0 };
    return pr;
  };

  // CHEGUEI ATRASADO? O painel reabre na última página usada, e esse clique automático pode
  // acontecer ANTES deste arquivo carregar (ele vem no fim da página) — aí ninguém chamava
  // encAbrir e a tela ficava em "Carregando…" para sempre. Se a página já é a Encartes, abro.
  try {
    var pg = document.getElementById("page-encartes");
    if ((pg && pg.classList.contains("ativo")) || localStorage.getItem("ui_pagina_atual") === "encartes") window.encAbrir();
  } catch (e) {}
})();
