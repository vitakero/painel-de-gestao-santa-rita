/* ==CXV-PAINEL== COMPRA × VENDA — a ligação da tela com a nuvem.
   Carrega QUANDO A PÁGINA ABRE (nunca no login nem no menu), guarda por 5 min, e pede
   só as colunas que a tela usa. Duas leituras: o retrato do robô (compras_retrato, ~55 KB)
   e as margens (compras_margem_setor, 16 linhas).
   Quem pode ler: quem tem a página "projecao". Quem muda margem: só o master — o banco
   confere de novo (RLS) e carimba quem mudou e quando (compras_margem_historico). */
(function () {
  var GUARDA_MS = 5 * 60e3;
  var lidoEm = 0, retrato = null, conf = null, carregando = false;

  function sb() { return window.__SB || null; }
  function master() { return !!(window.__PERFIL && window.__PERFIL.is_master); }
  function raiz() { return document.getElementById("cxvRaiz"); }
  function aviso(titulo, txt) {
    var r = raiz(); if (!r) return;
    r.innerHTML = '<div class="cxv"><div class="cxv-card" style="padding:18px 20px"><h2 style="margin:0 0 6px;font-size:20px;color:#0c5a26">' + titulo +
      '</h2><p style="margin:0;font-size:13.5px;color:#4a5568;line-height:1.6">' + txt + "</p></div></div>";
  }
  function faltaTabela(e) { return e && (/PGRST205|42P01|does not exist|schema cache/i.test((e.code || "") + " " + (e.message || ""))); }

  function montar() {
    var r = raiz(); if (!r || !retrato) return;
    if (!window.cxvMontar) return aviso("Compra × Venda", "A tela não carregou por completo. Recarregue a página.");
    window.cxvMontar(r, { dados: retrato.dados, conf: conf, podeEditar: master(), previa: false, geradoEm: retrato.gerado_em, salvarSetor: salvarSetor });
  }

  var tentativas = 0;
  function carregar() {
    var cli = sb();
    // Recarregar a página JÁ nesta aba abre a tela antes do login terminar (__SB/__PERFIL
    // ainda vazios). Espera o login em vez de desistir: até ~20 s, de 0,5 em 0,5 s.
    if (!cli || !window.__PERFIL) {
      if (tentativas++ < 40) { aviso("Compra × Venda", "Carregando…"); return setTimeout(carregar, 500); }
      return aviso("Compra × Venda", "Entre no painel para ver o Compra × Venda.");
    }
    tentativas = 0;
    if (carregando) return; carregando = true;
    if (!retrato) aviso("Compra × Venda", "Carregando…");
    Promise.all([
      cli.from("compras_retrato").select("dados,gerado_em").eq("chave", "atual").limit(1),
      cli.from("compras_margem_setor").select("setor_vr,margem_objetivo,permite_estoque").limit(200)
    ]).then(function (rs) {
      carregando = false;
      var e = rs[0].error || rs[1].error;
      if (e) {
        if (faltaTabela(e)) return aviso("Compra × Venda", "O banco ainda não está pronto: falta rodar o arquivo <b>compras_x_venda.sql</b> no Supabase.");
        return aviso("Compra × Venda", "Não deu para carregar agora. Tente de novo em instantes.<br><small style=\"color:#8a97a8\">" + String(e.message || e).slice(0, 160) + "</small>");
      }
      if (!rs[0].data || !rs[0].data.length) return aviso("Compra × Venda", "Você não tem acesso a esta tela, ou o robô da loja ainda não mandou o primeiro retrato do VR.");
      retrato = rs[0].data[0];
      conf = {};
      (rs[1].data || []).forEach(function (l) {
        conf[String(l.setor_vr)] = { margemObjetivo: l.margem_objetivo === null ? null : +l.margem_objetivo, permiteEstoque: l.permite_estoque };
      });
      lidoEm = Date.now();
      montar();
    }, function (e) { carregando = false; aviso("Compra × Venda", "Não deu para carregar agora. Tente de novo em instantes."); });
  }

  /* Grava UM setor. Devolve Promise<string|null>: null = gravou; texto = o motivo de não ter gravado.
     Confere a linha que VOLTOU do banco: se a tranca barrou, o update volta vazio sem erro. */
  function salvarSetor(setor, c) {
    var cli = sb(); if (!cli) return Promise.resolve("Entre no painel.");
    if (!master()) return Promise.resolve("Só o master muda a margem.");
    var nome = retrato && retrato.dados.setores[setor] ? window.CXV.nomeSetor(retrato.dados.setores[setor]) : "Setor " + setor;
    return cli.from("compras_margem_setor")
      .upsert({ setor_vr: +setor, setor_nome: nome, margem_objetivo: c.margemObjetivo, permite_estoque: c.permiteEstoque }, { onConflict: "setor_vr" })
      .select("setor_vr,margem_objetivo,permite_estoque")
      .then(function (r) {
        if (r.error) return "O banco recusou: " + r.error.message;
        if (!r.data || !r.data.length) return "O banco não gravou (sem permissão).";
        var l = r.data[0];
        conf[String(l.setor_vr)] = { margemObjetivo: l.margem_objetivo === null ? null : +l.margem_objetivo, permiteEstoque: l.permite_estoque };
        return null;
      }, function (e) { return "Sem conexão: " + (e && e.message || e); });
  }

  window.cxvAbrir = function () {
    if (retrato && Date.now() - lidoEm < GUARDA_MS) return; // já lido há pouco: a tela está montada
    carregar();
  };

  // CHEGUEI ATRASADO? O painel reabre na última página usada, e esse clique automático pode
  // acontecer ANTES deste arquivo carregar (ele vem no fim da página) — aí ninguém chamava
  // cxvAbrir e a tela ficava em "Carregando…" para sempre. Se a página já é a Projeção, abro.
  try {
    var pg = document.getElementById("page-projecao");
    if ((pg && pg.classList.contains("ativo")) || localStorage.getItem("ui_pagina_atual") === "projecao") window.cxvAbrir();
  } catch (e) {}
})();
