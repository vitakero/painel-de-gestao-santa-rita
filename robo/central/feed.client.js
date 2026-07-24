/* ============================================================
   CENTRAL OPERACIONAL — Módulo do cliente (1.1 Feed + 1.2 Canais + 1.3 Recebimentos + 1.4 Texto)
   Layout de dois painéis: esquerda = navegação (Feed + Canais + Recebimentos);
   direita = conteúdo (o Feed OU a conversa de um canal/recebimento).
   - Autocontido: o gerador injeta este arquivo como <script> (arquivo único).
   - LEITURA via feed_pagina / listar_topicos / listar_recebimentos / mensagens_pagina + subscribe.
   - ESCRITA: TEXTO (1.4) e UMA FOTO por mensagem (1.5), exclusivamente via a RPC
     postar_mensagem (ids = UUIDv7 do cliente = idempotência). Nunca grava em tabela direto.
     Foto: upload direto ao Storage (bucket privado central-op, upsert:false) na sessão do
     usuário; exibição por URL assinada de curta duração (nunca gravada no banco).
   - Só aparece se a flag 'central_feed' estiver ON e o usuário tiver a página
     'operacional' (master já tem). Fora disso, fica 100% invisível.
   - Nunca quebra o Painel (tudo em try/catch).
   - Sprint 1.6: "Transformar em ocorrência" — botão no cabeçalho da conversa que chama a
     RPC virar_ocorrencia (idempotente por tópico); vira indicador "Ocorrência criada".
   - Sprint 1.7: UMA mensagem de ÁUDIO (gravar/enviar/armazenar/reproduzir) via MediaRecorder;
     mesmo fluxo/infra da foto (bucket privado, upload upsert:false, RPC postar_mensagem,
     URL assinada); player nativo <audio>.
   - Sprint 1.8: TRANSCRIÇÃO assíncrona do áudio. O envio NÃO espera a IA. Um worker
     server-side (à parte, com a chave de IA) transcreve e grava; a conclusão vira evento
     'audio.transcrito' -> Broadcast -> o cliente atualiza SÓ aquela mensagem (Transcrevendo… /
     Falha ao transcrever / texto). Gated pela flag central_transcricao. SEM IA no navegador.
   - Sprint 1.9: mensagens em TEMPO REAL na conversa (texto/foto/áudio). O Broadcast (1.1)
     passa a carregar roteamento (topico/tipo/ent); o cliente busca SÓ a msg nova por RPC
     (mensagens_por_ids, sob RLS) e insere na posição canônica (created_at,id), dedup por
     mensagem.id (reconcilia o otimista). Reconexão => recupera a última página (bounded).
     Sem postgres_changes; conteúdo sempre autorizado pelo banco.
   - Sprint 1.10: NÃO-LIDAS por usuário. Badge por canal/recebimento; msg de OUTRO em tópico
     fechado incrementa (via Broadcast + autor; dedup por id; nunca as próprias); abrir o
     tópico zera + marca lido (marcar_lido); msg no tópico aberto marca lida automática.
     Contagem AUTORITATIVA por nao_lidas() ao abrir a Central/reconectar => nunca dobra. Sem polling.
   - Sprint 1.11: MENÇÕES (@usuário). Autocomplete ao digitar "@" (busca só usuários visíveis via
     RPC mencionaveis; ↑↓ navega, Enter/Tab escolhe, ESC fecha, Backspace normal). O cliente deriva
     a lista de mencionados do PRÓPRIO texto final (mencoesDoCorpo) e a envia em p_mencoes; o
     SERVIDOR valida (existe/mesmo tenant/dedup, ids inválidos são ignorados). Render destaca
     "@Nome" e marca "mencionou você" quando eu estou em m.mencoes (via Broadcast/RLS — SEM
     notificação de navegador/push/email; sem canal novo).
   - Sprint 1.12: REAÇÕES (emoji) às mensagens. Escrita SÓ por toggle_reacao (Sprint 0, idempotente,
     validado no servidor). Seletor de emojis no hover (desktop) / toque longo (mobile); clique
     adiciona/remove (mesmo emoji 2x = remove); chips "emoji N" abaixo da msg com a minha reação
     destacada. Tempo real por Broadcast: trigger em mensagem_reacoes emite 'reacao.alterada' →
     o cliente atualiza SÓ aquela mensagem (RPC de leitura reacoes_de), sem recarregar a conversa.
   - Sprint 1.13: PRESENÇA (Online/Ausente/Offline) + "digitando…". 100% EFÊMERO — Realtime
     Presence (track/sync) + Broadcast, no MESMO canal; NADA gravado no banco, sem postgres_changes,
     sem polling. Lista "Pessoas" na lateral (roster via RPC participantes + status ao vivo); "ausente"
     após 2min de inatividade. "Fulano está digitando…" só p/ OUTROS na conversa aberta, com throttle
     no envio e sumiço automático (timeout) / imediato ao enviar a mensagem. Reconexão re-publica a
     presença e limpa indicadores de digitação velhos.
   NÃO inclui: transcrição/IA/resumo/waveform, vídeo/documentos, múltiplos anexos, edição/recorte,
   fila offline/IndexedDB, busca, notificações push/browser, editar/apagar,
   manutenção, responsáveis/prioridade/SLA/workflow de ocorrência, limpeza de órfãos.
   ============================================================ */
(function () {
  "use strict";
  try {
    var TENANT = "11111111-1111-1111-1111-111111111111"; // = current_tenant() no SQL
    var FLAG = "central_feed";
    var PAGINA = "operacional";
    var CANAL_RT = "tenant:" + TENANT + ":feed";
    var TAM = 30;
    // Sprint 1.5 (foto)
    var BUCKET = "central-op";
    var MAX_BYTES = 5 * 1024 * 1024;   // 5 MB (igual ao file_size_limit do bucket)
    var MIMES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
    var URL_TTL = 900;                 // 15 min para a URL assinada de exibição
    // áudio (Sprint 1.7)
    var MAX_AUDIO = 10 * 1024 * 1024;  // 10 MB (igual ao teto do bucket)
    var AUDIO_EXT = { "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/mpeg": "mp3", "audio/aac": "aac" };

    var montado = false, checagemFeita = false, viewAtual = "feed";
    // feed
    var feedCarregou = false, feedCarregando = false, feedCursor = null, feedTemMais = true, novos = 0;
    // canais / mensagens
    var canaisCarregou = false, recebCarregou = false, canalAtual = null, msgCarregando = false, msgTs = null, msgId = null, msgTemMais = true;
    var msgIds = {}, msgFetching = {}, rtSubOk = false;   // dedup por mensagem.id + buscas "em voo" + reconexão (Sprint 1.9)
    var msgEls = {};                     // (1.14) mapa mensagem.id -> nó .co-msg — barraDe/atualização O(1) (era O(n) por chamada)
    var urlsOtimistas = [];              // (1.14) blob: URLs das bolhas otimistas (foto/áudio) p/ revogar no reset (evita vazar RAM)
    var recTimer = null, nlGen = 0, recReacTs = 0;   // (1.14) debounce de reconexão + token do nao_lidas + coalesce da reconciliação de reações
    // (2.0) Trabalho — work items. wiMapa é a fonte da verdade da lista: dedup por id,
    // porque updated_at é chave MUTÁVEL (um item editado durante a paginação reapareceria).
    var wiMapa = {}, wiOrdem = [], wiCarregando = false, wiTemMais = true;
    var wiCursorAt = null, wiCursorId = null, wiGen = 0;
    var wiAba = "meus", wiFStatus = "", wiFPrio = "", wiFTipo = "";
    var itemAtual = null, itemGen = 0;   // detalhe aberto (guard contra resposta atrasada ao trocar de item)
    var wiFormAberto = false;            // formulário de "Novo" na tela: nenhum render pode apagá-lo
    var ENT_ROTULO = { estoque_produtos: "Produto", central_agendamentos: "Recebimento",
                       manutencao_equipamentos: "Equipamento", topico: "Conversa",
                       work_items: "Item", mensagens: "Mensagem" };
    var WI_STATUS_LBL = { aberto: "Aberto", em_andamento: "Em andamento", bloqueado: "Bloqueado",
                          concluido: "Concluído", cancelado: "Cancelado" };
    var WI_TRANSICOES = { aberto: ["em_andamento", "cancelado"],
                          em_andamento: ["bloqueado", "concluido", "cancelado"],
                          bloqueado: ["em_andamento", "cancelado"],
                          concluido: ["em_andamento"], cancelado: ["aberto"] };
    var naoLidas = {}, contadas = {};   // não-lidas por tópico (autoritativo via nao_lidas) + dedup do incremento otimista (Sprint 1.10)
    // observabilidade (1.14) — contadores internos; NUNCA sai do navegador. window.__CO_DEBUG=true liga os logs.
    var coStats = { reconexoes: 0, rpcOk: 0, rpcFalhas: 0, rpcMsTotal: 0, uploadOk: 0, uploadFalhas: 0, uploadMsTotal: 0, bcFalhas: 0,
      rpcMedioMs: function () { return this.rpcOk ? Math.round(this.rpcMsTotal / this.rpcOk) : 0; },
      uploadMedioMs: function () { return this.uploadOk ? Math.round(this.uploadMsTotal / this.uploadOk) : 0; } };
    try { window.__CO_STATS = coStats; } catch (e) { }
    function coLog() { if (window.__CO_DEBUG) { try { console.log.apply(console, ["[central]"].concat([].slice.call(arguments))); } catch (e) { } } }
    // (nowMs() já existe — definido na Sprint 1.13)
    // Mede uma RPC (tempo médio + falhas) sem mudar o comportamento — só observa e repassa.
    function medirRpc(nome, p) {
      var t0 = nowMs();
      return p.then(function (r) {
        if (r && r.error) { coStats.rpcFalhas++; coLog("rpc erro", nome, r.error && r.error.message); }
        else { coStats.rpcOk++; coStats.rpcMsTotal += nowMs() - t0; }
        return r;
      }, function (e) { coStats.rpcFalhas++; coLog("rpc rejeitou", nome, e && e.message); throw e; });
    }
    // Rejeita a promessa se passar de ms (evita compositor preso em "enviando…" em rede ruim).
    function comTimeout(p, ms) {
      return new Promise(function (res, rej) {
        var t = setTimeout(function () { rej(new Error("timeout")); }, ms);
        p.then(function (v) { clearTimeout(t); res(v); }, function (e) { clearTimeout(t); rej(e); });
      });
    }
    // elementos
    var elPage, elNav, feedView, canalView, feedLista, feedStatus, feedMais, feedPill,
        canaisLista, recebLista, feedBtn, canalTitulo, msgLista, msgStatus, msgMais, coInp, coEnviar, rtCanal;
    // foto (Sprint 1.5)
    var coFotoBtn, coFotoInput, coPreview, coPreImg, coPreNome, coErro, coPend = null; // coPend = foto validada aguardando envio
    // ocorrência (Sprint 1.6)
    var coOc, canalTitTxt = "";   // coOc = slot do controle "Transformar em ocorrência"
    // áudio (Sprint 1.7)
    var coAudioBtn, coAudioArea, coRec = null, coRecStream = null, coRecChunks = [], coRecStart = 0, coRecTimer = null, coAudioPend = null;
    var coRecBusy = false, coRecGen = 0;   // guard SÍNCRONO + token p/ cancelar getUserMedia pendente (evita mic vazado)
    // transcrição (Sprint 1.8)
    var transcrOn = false, transcrPend = {};   // flag central_transcricao + mapa mensagem_id -> elemento da linha de transcrição pendente
    // menções (Sprint 1.11)
    var mencoesSel = {}, mencMenu = null, mencItens = [], mencIdx = 0, mencStart = 0;   // draft handle->id + estado do autocomplete
    var mencTimer = null, mencReqGen = 0;   // debounce da busca + geração p/ descartar resposta atrasada
    // reações (Sprint 1.12)
    var EMOJIS = ["👍", "❤️", "😂", "😮", "👀", "✅"];   // paleta do seletor (exemplos do spec)
    var reacFetching = {}, reacDirty = {}, reacLpTimer = null, reacIgnoraClique = false;   // buscas em voo + "sujo" p/ re-buscar + timer/guarda do toque-longo
    // presença + "digitando…" (Sprint 1.13) — EFÊMERO (Realtime Presence + Broadcast; nada no banco)
    var presRoster = [], presOnline = {}, presLista = null, presCarregou = false;   // roster (participantes) + status ao vivo + nó da UI
    var digitBy = {}, digitEl = null;                       // quem digita na conversa aberta: autorId -> {nome, timer}
    var meuStatus = "online", idleTimer = null, ultTyping = 0, meuStopTimer = null, presWired = false, ultAtiv = 0;   // idle + throttle do "digitando"/atividade
    function IDLE_MS() { return window.__CO_IDLE_MS || 120000; }   // 2min p/ virar "ausente" (test-override)
    function TYP_TTL() { return window.__CO_TYP_TTL || 5000; }     // some após ~5s sem novo "digitando" (test-override)
    function TYP_THR() { return window.__CO_TYP_THR != null ? window.__CO_TYP_THR : 2500; }   // throttle do envio
    function ACT_MS() { return window.__CO_ACT_MS != null ? window.__CO_ACT_MS : 1500; }       // coalesce da atividade (evita churn no mousemove)

    function SB() { return window.__SB || null; }
    function perfil() { return window.__PERFIL || null; }
    function podeVer() { var p = perfil(); return !!(p && (p.is_master || (p.paginas || []).indexOf(PAGINA) >= 0)); }
    function esc(s) {
      return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
      });
    }
    function tempoRel(iso) {
      try {
        var d = new Date(iso), s = Math.floor((Date.now() - d.getTime()) / 1000);
        if (s < 60) return "agora";
        if (s < 3600) return "há " + Math.floor(s / 60) + " min";
        if (s < 86400) return "há " + Math.floor(s / 3600) + " h";
        var dd = ("0" + d.getDate()).slice(-2), mm = ("0" + (d.getMonth() + 1)).slice(-2);
        return dd + "/" + mm + " " + ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
      } catch (e) { return ""; }
    }
    function icone(tipo) {
      var t = String(tipo || "");
      var svg =
        t.indexOf("mensagem") === 0 ? '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>' :
        // (2.0) work_item.* é a família NOVA; o ramo 'ocorrencia' fica para os eventos
        // históricos já gravados (o Feed lê linhas antigas e elas não são reescritas).
        t.indexOf("work_item") === 0 ? '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>' :
        t.indexOf("ocorrencia") === 0 ? '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>' :
        t.indexOf("recebimento") === 0 ? '<rect x="1" y="3" width="15" height="13" rx="1"/><path d="M16 8h4l3 3v5h-7z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>' :
        t.indexOf("manutencao") === 0 ? '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.8-2.8z"/>' :
        t.indexOf("topico") === 0 ? '<line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/>' :
        '<circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>';
      return '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + svg + "</svg>";
    }
    function iniciais(nome) { var n = String(nome || "").trim().split(/\s+/); return ((n[0] || "?").charAt(0) + (n.length > 1 ? n[n.length - 1].charAt(0) : "")).toUpperCase() || "?"; }

    function injetarCss() {
      if (document.getElementById("copf-css")) return;
      var st = document.createElement("style");
      st.id = "copf-css";
      st.textContent = [
        // shell (dois painéis)
        ".co-shell{display:flex;gap:0;min-height:520px;}",
        ".co-side{width:236px;flex:none;border-right:1px solid #eef2f4;padding-right:14px;}",
        ".co-main{flex:1;min-width:0;padding-left:20px;}",
        "@media(max-width:760px){.co-shell{flex-direction:column;}.co-side{width:auto;border-right:0;border-bottom:1px solid #eef2f4;padding-right:0;padding-bottom:12px;margin-bottom:12px;}.co-main{padding-left:0;}}",
        ".co-nav-item{display:flex;align-items:center;gap:9px;width:100%;text-align:left;border:0;background:none;color:#374049;border-radius:9px;padding:9px 11px;font-size:14px;font-weight:600;cursor:pointer;}",
        ".co-nav-item:hover{background:#f2f6f4;}",
        ".co-nav-item.on{background:#eaf5ee;color:#0c5a26;}",
        ".co-nav-item span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;}",
        ".co-nav-item .co-badge{flex:none;overflow:visible;min-width:18px;height:18px;border-radius:9px;background:#157a35;color:#fff;font-size:11px;font-weight:700;line-height:18px;text-align:center;padding:0 5px;margin-left:auto;}",
        // menções (Sprint 1.11)
        ".co-mencao{color:#0c5a26;background:#eaf5ee;border-radius:5px;padding:0 3px;font-weight:600;cursor:pointer;}",
        ".co-msg.mencionado{background:#fbf7e8;border-left:3px solid #e0b400;border-radius:0 8px 8px 0;padding-left:8px;}",
        ".co-menc-voce{color:#a07b1e;font-weight:700;}",
        ".co-menc-menu{position:absolute;left:44px;bottom:100%;margin-bottom:6px;z-index:30;background:#fff;border:1px solid #d9e2dc;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.12);padding:4px;min-width:180px;max-width:280px;max-height:220px;overflow:auto;}",
        ".co-menc-item{display:flex;align-items:center;gap:8px;padding:7px 9px;border-radius:7px;cursor:pointer;font-size:13.5px;}",
        ".co-menc-item .co-av{width:24px;height:24px;font-size:10px;}",
        ".co-menc-item .co-menc-setor{color:#9aa6ae;font-size:12px;margin-left:auto;}",
        ".co-menc-item.on,.co-menc-item:hover{background:#eaf5ee;}",
        ".co-side-lbl{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#9aa6ae;margin:16px 8px 6px;}",
        ".co-pessoas{max-height:200px;overflow:auto;}",
        ".co-pessoa{display:flex;align-items:center;gap:7px;padding:3px 8px;font-size:13px;color:#37424b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
        ".co-pessoa.off{color:#9aa6ae;}",
        ".co-dot{width:8px;height:8px;border-radius:50%;flex:none;background:#c9d1d7;}",
        ".co-dot.online{background:#2ecc71;}",
        ".co-dot.idle{background:#f1c40f;}",
        ".co-typing{min-height:16px;font-size:12.5px;color:#6b7a86;font-style:italic;padding:1px 6px 3px;}",
        ".co-canais{display:flex;flex-direction:column;gap:2px;}",
        ".co-side-vazio{color:#9aa6ae;font-size:13px;padding:8px 11px;}",
        /* ---- (2.0) Trabalho: lista de work items + detalhe ---- */
        ".wi-abas{display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap;}",
        ".wi-aba{border:1px solid #e3eae6;background:#fff;color:#4a5560;border-radius:999px;padding:6px 13px;font-size:13px;font-weight:600;cursor:pointer;}",
        ".wi-aba.on{background:#eaf5ee;border-color:#bfe0cb;color:#0c5a26;}",
        ".wi-filtros{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;}",
        ".wi-filtros select{border:1px solid #e3eae6;border-radius:8px;padding:5px 8px;font-size:13px;color:#4a5560;background:#fff;}",
        ".wi-lista{display:flex;flex-direction:column;gap:8px;}",
        ".wi-card{border:1px solid #eef2f4;border-radius:12px;padding:11px 13px;cursor:pointer;background:#fff;}",
        ".wi-card:hover{border-color:#cfe3d6;background:#fbfdfc;}",
        ".wi-card.atrasado{border-left:3px solid #e07b39;}",
        ".wi-top{display:flex;align-items:center;gap:7px;flex-wrap:wrap;}",
        ".wi-tit{font-weight:650;color:#26313a;font-size:14.5px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
        ".wi-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:5px;font-size:12.5px;color:#7b8792;}",
        ".wi-chip{border-radius:999px;padding:2px 9px;font-size:11.5px;font-weight:700;letter-spacing:.02em;}",
        ".wi-st-aberto{background:#eef3f7;color:#4a5a68;}",
        ".wi-st-em_andamento{background:#e7f1fd;color:#1f5fa8;}",
        ".wi-st-bloqueado{background:#fdeeea;color:#b5502a;}",
        ".wi-st-concluido{background:#e9f6ed;color:#1c7a3c;}",
        ".wi-st-cancelado{background:#f2f3f4;color:#8b949c;}",
        ".wi-pr-baixa{background:#f2f4f5;color:#7b8792;}",
        ".wi-pr-normal{background:#f2f4f5;color:#5b6670;}",
        ".wi-pr-alta{background:#fdf1e6;color:#a8631f;}",
        ".wi-pr-urgente{background:#fdeaea;color:#b3261e;}",
        ".wi-tipo{font-size:11.5px;color:#8b949c;text-transform:uppercase;letter-spacing:.06em;font-weight:700;}",
        ".wi-atraso{color:#c0562a;font-weight:650;}",
        ".wi-novo{border:0;background:#157a35;color:#fff;border-radius:9px;padding:8px 15px;font-size:13.5px;font-weight:650;cursor:pointer;}",
        ".wi-det-sec{margin-top:16px;}",
        ".wi-det-lbl{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#9aa6ae;margin-bottom:6px;}",
        ".wi-acoes{display:flex;gap:7px;flex-wrap:wrap;}",
        ".wi-btn{border:1px solid #d9e2dc;background:#fff;color:#31506d;border-radius:9px;padding:7px 13px;font-size:13px;font-weight:600;cursor:pointer;}",
        ".wi-btn:hover{background:#f4f8f5;}",
        ".wi-btn.pri{background:#157a35;border-color:#157a35;color:#fff;}",
        ".wi-ctx{display:flex;flex-direction:column;gap:5px;}",
        ".wi-ctx-it{display:flex;align-items:center;gap:8px;font-size:13.5px;color:#41505c;background:#f7faf8;border-radius:8px;padding:6px 10px;}",
        ".wi-ctx-x{margin-left:auto;border:0;background:none;color:#9aa6ae;cursor:pointer;font-size:15px;line-height:1;}",
        ".wi-form{display:flex;flex-direction:column;gap:9px;max-width:560px;}",
        ".wi-form input,.wi-form textarea,.wi-form select{border:1px solid #e3eae6;border-radius:9px;padding:9px 11px;font:inherit;font-size:14px;color:#2c3740;width:100%;box-sizing:border-box;}",
        ".wi-form textarea{min-height:76px;resize:vertical;}",
        ".wi-form label{font-size:12.5px;font-weight:650;color:#6b7a86;}",
        ".wi-row{display:flex;gap:9px;flex-wrap:wrap;}",
        ".wi-row>div{flex:1;min-width:150px;}",
        ".wi-erro{color:#b3261e;font-size:13px;}",
        /* ---- (2.1) Kanban ---- */
        ".kb-vista{display:flex;gap:4px;background:#f2f5f3;border-radius:9px;padding:3px;}",
        ".kb-vista button{border:0;background:none;color:#5b6670;border-radius:7px;padding:5px 13px;font-size:13px;font-weight:650;cursor:pointer;}",
        ".kb-vista button.on{background:#fff;color:#0c5a26;box-shadow:0 1px 2px rgba(0,0,0,.06);}",
        ".kb-quadro{display:flex;gap:12px;align-items:flex-start;overflow-x:auto;padding-bottom:6px;}",
        ".kb-col{flex:1 1 0;min-width:212px;background:#f8faf9;border-radius:12px;padding:9px;display:flex;flex-direction:column;}",
        ".kb-col-h{display:flex;align-items:center;gap:7px;margin-bottom:8px;padding:0 3px;position:sticky;top:0;background:#f8faf9;z-index:1;}",
        ".kb-col-t{font-size:12.5px;font-weight:700;color:#4a5560;letter-spacing:.02em;}",
        ".kb-cnt{margin-left:auto;background:#e6ebe8;color:#5b6670;border-radius:999px;font-size:11.5px;font-weight:700;padding:1px 8px;}",
        ".kb-itens{display:flex;flex-direction:column;gap:7px;max-height:62vh;overflow-y:auto;}",
        ".kb-card{background:#fff;border:1px solid #eaeeec;border-radius:10px;padding:9px 10px;cursor:pointer;position:relative;}",
        ".kb-card:hover{border-color:#cfe3d6;}",
        ".kb-card:focus-visible{outline:2px solid #157a35;outline-offset:1px;}",
        ".kb-card.atrasado{border-left:3px solid #e07b39;}",
        ".kb-card.meu{box-shadow:inset 3px 0 0 #157a35;}",
        ".kb-card.movendo{opacity:.5;pointer-events:none;}",
        ".kb-c-tit{font-size:13.5px;font-weight:640;color:#26313a;line-height:1.3;}",
        ".kb-c-meta{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:6px;font-size:11.5px;color:#7b8792;}",
        ".kb-c-menu{position:absolute;top:6px;right:6px;border:0;background:none;color:#a8b2ba;cursor:pointer;font-size:15px;line-height:1;padding:2px 5px;border-radius:6px;}",
        ".kb-c-menu:hover{background:#f2f5f3;color:#5b6670;}",
        ".kb-pop{position:absolute;top:26px;right:6px;background:#fff;border:1px solid #e3eae6;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.12);z-index:5;min-width:174px;padding:5px;}",
        ".kb-pop button{display:block;width:100%;text-align:left;border:0;background:none;padding:7px 10px;font-size:13px;color:#3c4750;border-radius:7px;cursor:pointer;}",
        ".kb-pop button:hover,.kb-pop button:focus-visible{background:#eef4f0;outline:none;}",
        ".kb-abas{display:none;gap:5px;margin-bottom:10px;overflow-x:auto;}",
        ".kb-aba{flex:none;border:1px solid #e3eae6;background:#fff;color:#4a5560;border-radius:999px;padding:6px 12px;font-size:12.5px;font-weight:650;cursor:pointer;white-space:nowrap;}",
        ".kb-aba.on{background:#eaf5ee;border-color:#bfe0cb;color:#0c5a26;}",
        ".kb-mais{width:100%;border:1px dashed #d5ded8;background:none;color:#6b7a86;border-radius:8px;padding:6px;font-size:12.5px;cursor:pointer;margin-top:6px;}",
        ".kb-vazio{color:#a8b2ba;font-size:12.5px;padding:10px 4px;text-align:center;}",
        "@media(max-width:760px){.kb-abas{display:flex;}.kb-quadro{display:block;}.kb-col{min-width:0;}.kb-col.off{display:none;}.kb-itens{max-height:none;}}",
        /* ---- (2.2) Dashboard ---- */
        ".db-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:11px;}",
        ".db-card{border:1px solid #eef2f4;border-radius:12px;padding:13px 14px;background:#fff;text-align:left;cursor:default;}",
        ".db-card.clic{cursor:pointer;}",
        ".db-card.clic:hover{border-color:#cfe3d6;background:#fbfdfc;}",
        ".db-num{font-size:26px;font-weight:700;color:#1d2a33;line-height:1.1;}",
        ".db-lbl{font-size:12.5px;color:#6b7a86;margin-top:3px;}",
        ".db-card.alerta .db-num{color:#c0562a;}",
        ".db-card.urg .db-num{color:#b3261e;}",
        ".db-sec{margin-top:20px;}",
        ".db-sec-h{display:flex;align-items:center;gap:8px;margin-bottom:9px;}",
        ".db-sec-h .db-lbl{margin:0;font-weight:700;text-transform:uppercase;letter-spacing:.06em;font-size:11px;color:#9aa6ae;}",
        ".db-dims{display:flex;gap:5px;}",
        ".db-dim{border:1px solid #e3eae6;background:#fff;color:#5b6670;border-radius:999px;padding:4px 11px;font-size:12px;font-weight:600;cursor:pointer;}",
        ".db-dim.on{background:#eaf5ee;border-color:#bfe0cb;color:#0c5a26;}",
        ".db-bars{display:flex;flex-direction:column;gap:6px;}",
        ".db-bar{display:flex;align-items:center;gap:9px;font-size:13px;}",
        ".db-bar-nome{width:120px;flex:none;color:#41505c;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
        ".db-bar-track{flex:1;height:16px;background:#f1f4f2;border-radius:6px;overflow:hidden;}",
        ".db-bar-fill{height:100%;background:#8fc7a3;border-radius:6px;}",
        ".db-bar-q{width:34px;flex:none;text-align:right;color:#5b6670;font-weight:650;}",
        ".db-tempo{border:1px solid #eef2f4;border-radius:12px;padding:13px 14px;background:#f8faf9;font-size:13px;color:#4a5560;}",
        ".db-tempo b{color:#1d2a33;font-size:16px;}",
        ".co-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:6px;}",
        ".co-sub{font-size:13px;color:#7b8792;margin-top:2px;}",
        ".copf-refresh{border:1px solid #d9e2dc;background:#fff;color:#157a35;border-radius:8px;width:34px;height:34px;font-size:16px;cursor:pointer;flex:none;}",
        ".copf-refresh:hover{background:#eaf5ee;}",
        ".copf-pill{display:inline-flex;align-items:center;gap:7px;margin:6px 0 4px;padding:7px 14px;background:#157a35;color:#fff;border-radius:20px;font-size:13px;font-weight:600;cursor:pointer;border:0;}",
        // feed / listas
        ".copf-lista{display:flex;flex-direction:column;gap:2px;margin-top:8px;}",
        ".copf-item{display:grid;grid-template-columns:auto 1fr;gap:12px;padding:12px 6px;border-bottom:1px solid #eef2f4;align-items:start;}",
        ".copf-item:last-child{border-bottom:0;}",
        ".copf-ic{width:34px;height:34px;border-radius:9px;background:#eaf5ee;color:#157a35;display:flex;align-items:center;justify-content:center;flex:none;}",
        ".copf-resumo{color:#1b2830;line-height:1.45;}",
        ".copf-meta{font-size:12px;color:#8a97a2;margin-top:3px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;}",
        ".copf-setor{background:#f0f4f2;color:#4a5b52;border:1px solid #e2e9e5;border-radius:20px;padding:1px 9px;font-weight:600;}",
        ".copf-status{padding:26px 8px;text-align:center;color:#8a97a2;line-height:1.6;}",
        ".copf-status b{color:#5b6a62;}",
        ".copf-erro-btn{margin-top:8px;border:1px solid #d9e2dc;background:#fff;color:#157a35;border-radius:8px;padding:7px 16px;font-weight:600;cursor:pointer;}",
        ".copf-mais{margin:12px auto 2px;display:block;border:1px solid #d9e2dc;background:#fff;color:#157a35;border-radius:9px;padding:9px 20px;font-weight:600;cursor:pointer;}",
        ".copf-mais:hover{background:#eaf5ee;}",
        ".copf-skel{height:58px;border-radius:9px;background:linear-gradient(90deg,#f2f5f7,#e9eef1,#f2f5f7);background-size:200% 100%;animation:copfsk 1.2s infinite;margin-bottom:6px;}",
        "@keyframes copfsk{0%{background-position:200% 0}100%{background-position:-200% 0}}",
        // mensagens de canal
        ".co-msg{position:relative;display:grid;grid-template-columns:auto 1fr;gap:10px;padding:9px 4px;align-items:start;}",
        ".co-reacoes{display:flex;flex-wrap:wrap;gap:5px;margin-top:5px;}",
        ".co-reacoes:empty{display:none;margin:0;}",
        ".co-reacao{display:inline-flex;align-items:center;gap:4px;border:1px solid #e0e6ea;background:#f5f7f8;border-radius:12px;padding:1px 8px;font-size:13px;line-height:1.7;cursor:pointer;color:#37424b;}",
        ".co-reacao:hover{background:#eef1f3;}",
        ".co-reacao.eu{border-color:#1a7a3a;background:#eaf5ee;color:#0c5a26;font-weight:600;}",
        ".co-reacao-n{font-size:12px;}",
        ".co-react-btn{position:absolute;top:6px;right:4px;width:26px;height:26px;padding:0;display:flex;align-items:center;justify-content:center;border:1px solid #e0e6ea;background:#fff;color:#8a97a2;border-radius:50%;cursor:pointer;opacity:0;transition:opacity .12s;}",
        ".co-msg:hover .co-react-btn{opacity:1;}",
        ".co-react-btn:hover{color:#157a35;border-color:#bcd8c6;}",
        "@media (hover:none){.co-react-btn{opacity:.55;}}",
        ".co-react-pick{position:absolute;top:-6px;right:4px;z-index:20;display:flex;gap:2px;background:#fff;border:1px solid #d9e2dc;border-radius:22px;box-shadow:0 6px 20px rgba(0,0,0,.14);padding:4px 6px;}",
        ".co-react-emoji{border:0;background:transparent;font-size:20px;line-height:1;padding:3px 4px;border-radius:8px;cursor:pointer;}",
        ".co-react-emoji:hover{background:#eaf5ee;transform:scale(1.15);}",
        ".co-av{width:32px;height:32px;border-radius:50%;background:#157a35;color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex:none;}",
        ".co-msg-top{font-size:12.5px;color:#8a97a2;}",
        ".co-msg-top b{color:#37424b;font-weight:700;}",
        ".co-msg-corpo{color:#1b2830;line-height:1.45;white-space:pre-wrap;}",
        ".co-compositor{position:relative;display:flex;gap:8px;align-items:flex-end;margin:2px 0 12px;}",
        ".co-inp{flex:1;min-width:0;resize:none;border:1px solid #d9e2dc;border-radius:10px;padding:10px 12px;font-size:14.5px;font-family:inherit;line-height:1.4;max-height:140px;color:#1b2830;background:#fff;}",
        ".co-inp:focus{outline:none;border-color:#157a35;box-shadow:0 0 0 3px rgba(21,122,53,.13);}",
        ".co-enviar{flex:none;border:0;background:#157a35;color:#fff;border-radius:10px;padding:0 18px;height:41px;font-size:14px;font-weight:600;cursor:pointer;}",
        ".co-enviar:hover{background:#0c5a26;}",
        ".co-enviar:disabled{opacity:.55;cursor:default;}",
        ".co-est.enviando{color:#a07b1e;}",
        ".co-est.erro{color:#c0392b;}",
        ".co-est.perm{color:#c0392b;}",
        ".co-reenviar{border:0;background:none;color:#157a35;font-weight:700;cursor:pointer;text-decoration:underline;padding:0 2px;font-size:inherit;}",
        // foto (Sprint 1.5)
        ".co-foto-btn{flex:none;border:1px solid #d9e2dc;background:#fff;border-radius:10px;width:41px;height:41px;font-size:18px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#157a35;}",
        ".co-foto-btn:hover{background:#eaf5ee;}",
        ".co-foto-btn:disabled{opacity:.5;cursor:default;}",
        ".co-preview{display:flex;align-items:center;gap:10px;background:#f6f8f7;border:1px solid #e2e9e5;border-radius:10px;padding:8px;margin:0 0 8px;}",
        ".co-preview img{width:56px;height:56px;object-fit:cover;border-radius:8px;flex:none;background:#e9eef1;}",
        ".co-preview .co-foto-nome{font-size:12.5px;color:#5b6a62;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1;}",
        ".co-foto-x{flex:none;border:0;background:#e6ebe8;color:#4a5b52;border-radius:50%;width:26px;height:26px;font-size:16px;line-height:1;cursor:pointer;}",
        ".co-foto-x:hover{background:#d7dedb;}",
        ".co-comp-erro{color:#c0392b;font-size:12.5px;margin:0 0 8px;}",
        ".co-msg-foto{margin-top:6px;max-width:260px;}",
        ".co-msg-foto img{max-width:100%;max-height:280px;border-radius:10px;display:block;background:#eef2f4;cursor:pointer;}",
        ".co-foto-skel{width:180px;height:130px;border-radius:10px;background:linear-gradient(90deg,#f2f5f7,#e9eef1,#f2f5f7);background-size:200% 100%;animation:copfsk 1.2s infinite;}",
        ".co-foto-erro{width:180px;padding:14px;border-radius:10px;background:#f6f8f7;border:1px dashed #dbe4de;color:#9aa6ae;font-size:12.5px;text-align:center;}",
        ".co-foto-erro button{display:block;margin:6px auto 0;border:0;background:none;color:#157a35;font-weight:700;text-decoration:underline;cursor:pointer;font-size:12.5px;}",
        // ocorrência (Sprint 1.6)
        ".co-ocorrencia{flex:none;display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end;}",
        ".co-oc-btn{border:1px solid #e0b400;background:#fff8e1;color:#8a6d00;border-radius:9px;padding:8px 13px;font-size:13px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:6px;}",
        ".co-oc-btn:hover{background:#fdefc0;}",
        ".co-oc-q{font-size:13px;color:#5b6a62;}",
        ".co-oc-sim{border:0;background:#c98a00;color:#fff;border-radius:8px;padding:7px 13px;font-size:13px;font-weight:700;cursor:pointer;}",
        ".co-oc-nao{border:1px solid #d9e2dc;background:#fff;color:#5b6a62;border-radius:8px;padding:7px 12px;font-size:13px;cursor:pointer;}",
        ".co-oc-ind{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:700;color:#8a6d00;background:#fff8e1;border:1px solid #f0dca0;border-radius:9px;padding:7px 12px;}",
        ".co-oc-ind.cri{color:#a07b1e;background:#fff;border-color:#eee;}",
        ".co-oc-erro{font-size:13px;color:#c0392b;}",
        ".co-oc-erro button{border:0;background:none;color:#157a35;font-weight:700;text-decoration:underline;cursor:pointer;font-size:13px;padding:0 2px;}",
        // áudio (Sprint 1.7)
        ".co-audio-btn{flex:none;border:1px solid #d9e2dc;background:#fff;border-radius:10px;width:41px;height:41px;font-size:17px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#157a35;}",
        ".co-audio-btn:hover{background:#eaf5ee;}",
        ".co-audio-btn.rec{background:#fdecea;border-color:#e6b0aa;color:#c0392b;}",
        ".co-audio-btn:disabled{opacity:.5;cursor:default;}",
        ".co-audio-area{display:flex;align-items:center;gap:10px;background:#f6f8f7;border:1px solid #e2e9e5;border-radius:10px;padding:8px 10px;margin:0 0 8px;flex-wrap:wrap;}",
        ".co-rec-dot{width:11px;height:11px;border-radius:50%;background:#c0392b;flex:none;animation:copfblink 1s infinite;}",
        "@keyframes copfblink{0%,100%{opacity:1}50%{opacity:.25}}",
        ".co-rec-t{font-size:13px;font-weight:700;color:#5b6a62;font-variant-numeric:tabular-nums;}",
        ".co-rec-stop{border:0;background:#c0392b;color:#fff;border-radius:8px;padding:7px 13px;font-size:13px;font-weight:700;cursor:pointer;}",
        ".co-audio-area audio{height:38px;max-width:220px;}",
        ".co-audio-x{flex:none;border:0;background:#e6ebe8;color:#4a5b52;border-radius:50%;width:26px;height:26px;font-size:16px;line-height:1;cursor:pointer;}",
        ".co-msg-audio{margin-top:6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;}",
        ".co-msg-audio audio{height:40px;max-width:240px;}",
        ".co-msg-audio .co-audio-dur{font-size:12px;color:#8a97a2;font-variant-numeric:tabular-nums;}",
        // transcrição (Sprint 1.8)
        ".co-transcr{margin-top:5px;font-size:13px;line-height:1.4;max-width:280px;}",
        ".co-transcr.ok{color:#37424b;background:#f6f8f7;border-left:3px solid #157a35;border-radius:0 8px 8px 0;padding:6px 10px;white-space:pre-wrap;}",
        ".co-transcr.proc{color:#8a97a2;font-style:italic;display:flex;align-items:center;gap:6px;}",
        ".co-transcr.erro{color:#c0392b;}",
        ".co-transcr-dot{width:8px;height:8px;border-radius:50%;background:#c9b458;flex:none;animation:copfblink 1.1s infinite;}",
        // reconexão (Sprint 1.9)
        ".co-reconn{position:sticky;bottom:8px;align-self:center;margin:8px auto 0;width:max-content;background:#37424b;color:#fff;font-size:12px;padding:5px 12px;border-radius:16px;opacity:.9;}"
      ].join("");
      document.head.appendChild(st);
    }

    /* ---------- FEED (Sprint 1.1) ---------- */
    function feedLinha(ev) {
      var div = document.createElement("div");
      div.className = "copf-item";
      var setor = ev.setor ? '<span class="copf-setor">' + esc(ev.setor) + "</span>" : "";
      // (2.0) evento de work item SEM conversa vem com resumo genérico de propósito (o
      // título vazaria: eventos_sel libera evento sem tópico p/ qualquer um com a página).
      // Marco a linha para hidratar o título em lote, sob RLS, via work_items_por_ids.
      if (ev.entity_type === "work_items" && ev.entity_id && !ev.topico_id) div.setAttribute("data-wient", ev.entity_id);
      div.innerHTML =
        '<div class="copf-ic">' + icone(ev.tipo) + "</div>" +
        '<div class="copf-body"><div class="copf-resumo">' + esc(ev.resumo || ev.tipo || "Evento") + "</div>" +
        '<div class="copf-meta">' + setor + "<span>" + tempoRel(ev.created_at) + "</span></div></div>";
      return div;
    }
    function feedSetStatus(estado) {
      if (!feedStatus) return;
      if (estado === "carregando") feedStatus.innerHTML = '<div class="copf-skel"></div><div class="copf-skel"></div><div class="copf-skel"></div>';
      else if (estado === "vazio") feedStatus.innerHTML = "<b>Nenhum evento ainda.</b><br>Assim que algo acontecer na operação, aparece aqui automaticamente.";
      else if (estado === "erro") {
        feedStatus.innerHTML = '<b>Não consegui carregar o Feed.</b><br><button class="copf-erro-btn" type="button">Tentar de novo</button>';
        var b = feedStatus.querySelector(".copf-erro-btn"); if (b) b.addEventListener("click", function () { carregarFeed(true); });
      } else feedStatus.innerHTML = "";
    }
    function renderNovos() {
      if (!feedPill) return;
      if (novos > 0) { feedPill.textContent = "● " + novos + (novos === 1 ? " novo evento" : " novos eventos") + " — toque para ver"; feedPill.style.display = "inline-flex"; }
      else feedPill.style.display = "none";
    }
    function carregarFeed(reset) {
      if (feedCarregando) return;
      var sb = SB(); if (!sb) { feedSetStatus("erro"); return; }
      feedCarregando = true; feedCarregou = true;
      if (reset) feedCursor = null;
      if (reset && feedLista.children.length === 0) feedSetStatus("carregando");
      if (!reset && feedMais) feedMais.textContent = "Carregando…";
      sb.rpc("feed_pagina", { p_cursor: reset ? null : feedCursor, p_limite: TAM }).then(function (r) {
        feedCarregando = false;
        if (r && r.error) { feedSetStatus("erro"); if (feedMais) feedMais.textContent = "Carregar mais"; return; }
        var linhas = (r && r.data) || [];
        if (reset) { feedLista.innerHTML = ""; novos = 0; renderNovos(); }
        for (var i = 0; i < linhas.length; i++) feedLista.appendChild(feedLinha(linhas[i]));
        wiHidratarFeed();   // (2.0) resolve os títulos dos work items desta página, em lote
        if (linhas.length) feedCursor = linhas[linhas.length - 1].id;
        feedTemMais = linhas.length >= TAM;
        if (feedMais) { feedMais.style.display = feedTemMais ? "" : "none"; feedMais.textContent = "Carregar mais"; }
        feedSetStatus(feedLista.children.length === 0 ? "vazio" : "");
      }, function () { feedCarregando = false; feedSetStatus("erro"); if (feedMais) feedMais.textContent = "Carregar mais"; });
    }

    /* ---------- CANAIS (Sprint 1.2) ---------- */
    function carregarCanais() {
      var sb = SB(); if (!sb || !canaisLista) return;
      canaisCarregou = true;   // evita recarga concorrente; volta a false no erro p/ permitir retry
      canaisLista.innerHTML = '<div class="co-side-vazio">Carregando…</div>';
      sb.rpc("listar_topicos", {}).then(function (r) {
        if (r && r.error) { canaisCarregou = false; canaisLista.innerHTML = '<div class="co-side-vazio">Erro ao carregar canais. Reabra a Central para tentar.</div>'; return; }
        var ts = (r && r.data) || [];
        if (!ts.length) { canaisLista.innerHTML = '<div class="co-side-vazio">Nenhum canal ainda.</div>'; return; }
        canaisLista.innerHTML = "";
        for (var i = 0; i < ts.length; i++) {
          (function (t) {
            var b = document.createElement("button");
            b.type = "button"; b.className = "co-nav-item"; b.setAttribute("data-topico", t.id);
            var ic = t.tipo === "geral"
              ? '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></svg>'
              : '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>';
            b.innerHTML = ic + "<span>" + esc(t.titulo) + '</span><span class="co-badge" style="display:none;"></span>';
            b.addEventListener("click", function () { abrirCanal(t); });
            canaisLista.appendChild(b);
          })(ts[i]);
        }
        renderNaoLidas();   // pinta badges nos itens recém-criados
      }, function () { canaisCarregou = false; canaisLista.innerHTML = '<div class="co-side-vazio">Erro ao carregar canais. Reabra a Central para tentar.</div>'; });
    }
    function carregarRecebimentos() {
      var sb = SB(); if (!sb || !recebLista) return;
      recebCarregou = true;   // evita recarga concorrente; volta a false no erro p/ retry
      recebLista.innerHTML = '<div class="co-side-vazio">Carregando…</div>';
      sb.rpc("listar_recebimentos", {}).then(function (r) {
        if (r && r.error) { recebCarregou = false; recebLista.innerHTML = '<div class="co-side-vazio">Erro ao carregar. Reabra a Central.</div>'; return; }
        var ts = (r && r.data) || [];
        if (!ts.length) { recebLista.innerHTML = '<div class="co-side-vazio">Nenhum recebimento ainda.</div>'; return; }
        recebLista.innerHTML = "";
        for (var i = 0; i < ts.length; i++) {
          (function (t) {
            var b = document.createElement("button");
            b.type = "button"; b.className = "co-nav-item"; b.setAttribute("data-topico", t.id);
            b.innerHTML =
              '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="3" width="15" height="13" rx="1"/><path d="M16 8h4l3 3v5h-7z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>' +
              "<span>" + esc(t.titulo || "Recebimento") + '</span><span class="co-badge" style="display:none;"></span>';
            b.addEventListener("click", function () { abrirCanal({ id: t.id, tipo: "recebimento", titulo: t.titulo }); });
            recebLista.appendChild(b);
          })(ts[i]);
        }
        renderNaoLidas();   // pinta badges nos itens recém-criados
      }, function () { recebCarregou = false; recebLista.innerHTML = '<div class="co-side-vazio">Erro ao carregar. Reabra a Central.</div>'; });
    }
    function marcarAtivo(topicoId) {
      if (feedBtn) feedBtn.classList.toggle("on", !topicoId);
      var itens = elPage ? elPage.querySelectorAll(".co-side [data-topico]") : [];
      for (var i = 0; i < itens.length; i++) itens[i].classList.toggle("on", itens[i].getAttribute("data-topico") === topicoId);
    }
    function mostrarFeed() {
      pararDigitar();        // saindo da conversa pelo Feed: avisa "parei de digitar" (antes de zerar canalAtual)
      limparTodosDigit();    // e limpa o indicador de "digitando" que estava na tela
      viewAtual = "feed"; canalAtual = null; itemAtual = null;
      if (canalView) canalView.style.display = "none";
      if (trabView) trabView.style.display = "none";                 // (2.0)
      if (wiNavBtn) wiNavBtn.classList.remove("on");                 // (2.0)
      if (feedView) feedView.style.display = "";
      marcarAtivo(null);
      renderNaoLidas();   // sem tópico aberto: o badge do que estava aberto volta a aparecer se tiver não-lidas
      if (!feedCarregou) carregarFeed(true);
    }
    function abrirCanal(t) {
      pararDigitar();        // avisa que parei de digitar no tópico ANTERIOR (antes de trocar canalAtual)
      limparTodosDigit();    // limpa o indicador de "digitando" da conversa que estou saindo
      viewAtual = "canal"; canalAtual = t.id; itemAtual = null;
      if (feedView) feedView.style.display = "none";
      if (trabView) trabView.style.display = "none";                 // (2.0)
      if (wiNavBtn) wiNavBtn.classList.remove("on");                 // (2.0)
      if (canalView) canalView.style.display = "";
      canalTitTxt = t.titulo || "Conversa";
      if (canalTitulo) canalTitulo.textContent = (t.tipo === "canal" ? "# " : "") + canalTitTxt;
      if (coInp) { coInp.value = ""; coInp.style.height = ""; }   // não vaza rascunho de uma conversa p/ outra
      limparMenc();                                                // nem rascunho de @menções
      fecharReacPick();                                            // nem seletor de reação aberto
      limparFoto();                                                // nem foto pendente
      limparAudio();                                               // nem áudio pendente/gravando (descarta)
      carregarOcorrencia(t.id);                                    // estado do "Transformar em ocorrência"
      naoLidas[t.id] = 0; renderNaoLidas();                         // some o badge do tópico aberto na hora
      marcarAtivo(t.id);
      carregarMsgs(true);
      if (coInp) setTimeout(function () { coInp.focus(); }, 30);
    }
    // Escapa o corpo e destaca as @menções (cosmético; XSS-safe: escapa ANTES do regex).
    function corpoHtml(corpo) {
      return esc(corpo || "").replace(/@([A-Za-zÀ-ÿ0-9_]+)/g, '<span class="co-mencao">@$1</span>');
    }
    // Fui eu que fui mencionado nesta mensagem? (m.mencoes = uuid[] dos mencionados)
    function mencionadoMe(m) {
      var eu = (perfil() || {}).id, mc = m && m.mencoes;
      if (typeof mc === "string") { try { mc = JSON.parse(mc); } catch (e) { mc = []; } }
      return !!(eu && mc && mc.indexOf && mc.indexOf(eu) >= 0);
    }
    // ---- Autocomplete de @menções (Sprint 1.11) --------------------------------------------
    // O "handle" é a 1ª palavra do nome, restrita AO MESMO charset do realce/extração
    // (/@([A-Za-zÀ-ÿ0-9_]+)/). Assim "Maria-José" vira "@Maria" e a menção NÃO se perde:
    // o que é inserido é exatamente o que corpoHtml destaca e mencoesDoCorpo reconhece.
    function tokenDeNome(nome) {
      var primeiro = String(nome || "").trim().split(/\s+/)[0] || "";
      var m = primeiro.match(/^[A-Za-zÀ-ÿ0-9_]+/);
      return m ? m[0] : "";
    }
    // Handle ÚNICO no rascunho atual: começa no 1º nome; se JÁ está tomado por OUTRA pessoa
    // (homônimos: dois "João"), estende com as iniciais do sobrenome (@João -> @JoãoP) até
    // ficar único, pra o 2º homônimo não sobrescrever o 1º no mapa handle->id.
    function handleUnico(u) {
      var base = tokenDeNome(u.nome); if (!base) return "";
      function livre(h) { var k = h.toLowerCase(); return !mencoesSel[k] || mencoesSel[k] === u.id; }
      if (livre(base)) return base;
      var resto = String(u.nome || "").trim().split(/\s+/).slice(1), suf = base, i, ini;
      for (i = 0; i < resto.length; i++) {
        ini = (resto[i].match(/^[A-Za-zÀ-ÿ0-9_]/) || [""])[0];
        if (!ini) continue;
        suf = suf + ini;
        if (livre(suf)) return suf;
      }
      var n = 2, cand = suf + n;                         // homônimos completos: sufixo numérico
      while (!livre(cand)) { n++; cand = suf + n; }
      return cand;
    }
    // Ids mencionados que AINDA estão escritos como "@handle" no corpo (deduplicado).
    // Se o usuário apagou o "@João", a menção some — a fonte da verdade é o texto final.
    function mencoesDoCorpo(corpo) {
      var out = [], seen = {}, re = /@([A-Za-zÀ-ÿ0-9_]+)/g, mm;
      while ((mm = re.exec(corpo || ""))) {
        var id = mencoesSel[mm[1].toLowerCase()];
        if (id && !seen[id]) { seen[id] = 1; out.push(id); }
      }
      return out;
    }
    function mencAberto() { return !!(mencMenu && mencMenu.style.display !== "none" && mencItens.length); }
    function fecharMenc() {
      mencReqGen++;   // invalida qualquer busca em voo
      if (mencTimer) { clearTimeout(mencTimer); mencTimer = null; }
      if (mencMenu) mencMenu.style.display = "none";
      mencItens = []; mencIdx = 0;
    }
    function limparMenc() { mencoesSel = {}; fecharMenc(); }   // fim do envio / troca de canal
    // Acha o "@token" sob o cursor: um '@' no início ou após espaço, sem espaço até o cursor.
    function mencTokenAtual() {
      if (!coInp) return null;
      var pos = coInp.selectionStart, val = coInp.value || "", i = pos - 1;
      while (i >= 0) {
        var ch = val.charAt(i);
        if (ch === "@") {
          var before = i === 0 ? " " : val.charAt(i - 1);
          if (i !== 0 && !/\s/.test(before)) return null;   // "email@x" não é menção
          var q = val.slice(i + 1, pos);
          if (q && !/^[A-Za-zÀ-ÿ0-9_]+$/.test(q)) return null;   // caractere inválido encerrou o token
          return { start: i, query: q };
        }
        if (/\s/.test(ch)) return null;   // espaço quebra o token
        i--;
      }
      return null;
    }
    function avaliarMenc() {
      var t = mencTokenAtual();
      if (!t) { fecharMenc(); return; }
      mencStart = t.start;
      if (mencTimer) clearTimeout(mencTimer);
      var q = t.query;
      mencTimer = setTimeout(function () { buscarMencionaveis(q); }, 120);
    }
    function buscarMencionaveis(q) {
      var sb = SB(); if (!sb) return;
      var gen = ++mencReqGen, p;
      try { p = sb.rpc("mencionaveis", { p_busca: q || null }); }
      catch (e) { return; }
      p.then(function (r) {
        if (gen !== mencReqGen) return;                 // resposta atrasada de um token já trocado
        var tk = mencTokenAtual();
        if (!tk) { fecharMenc(); return; }               // usuário saiu do "@..." nesse meio-tempo
        if (tk.query !== q) return;                      // o texto já mudou desde ESTA busca; a busca nova é quem renderiza (sem flicker)
        if (r && r.error) { fecharMenc(); return; }
        renderMencMenu((r && r.data) || []);
      }, function () { if (gen === mencReqGen) fecharMenc(); });
    }
    function renderMencMenu(itens) {
      if (!coInp) return;
      // filtra a mim mesmo (não faz sentido se auto-mencionar) e limita
      var eu = (perfil() || {}).id;
      mencItens = (itens || []).filter(function (u) { return u && u.id !== eu; }).slice(0, 8);
      if (!mencItens.length) { fecharMenc(); return; }
      mencIdx = 0;
      if (!mencMenu) {
        mencMenu = document.createElement("div");
        mencMenu.className = "co-menc-menu";
        var comp = coInp.parentNode;   // .co-comp (posição relativa)
        if (comp) comp.appendChild(mencMenu); else document.body.appendChild(mencMenu);
      }
      var html = "";
      for (var i = 0; i < mencItens.length; i++) {
        var u = mencItens[i];
        html += '<div class="co-menc-item' + (i === mencIdx ? " on" : "") + '" data-i="' + i + '">' +
                '<span class="co-menc-nome">' + esc(u.nome || "") + "</span>" +
                (u.setor ? '<span class="co-menc-setor">' + esc(u.setor) + "</span>" : "") + "</div>";
      }
      mencMenu.innerHTML = html;
      mencMenu.style.display = "block";
      // clique escolhe (mousedown p/ disparar antes do blur do textarea)
      var its = mencMenu.querySelectorAll(".co-menc-item");
      for (var j = 0; j < its.length; j++) {
        its[j].addEventListener("mousedown", function (e) {
          e.preventDefault(); selecionarMenc(parseInt(this.getAttribute("data-i"), 10));
        });
      }
    }
    function moverMenc(d) {
      if (!mencItens.length) return;
      mencIdx = (mencIdx + d + mencItens.length) % mencItens.length;
      var its = mencMenu ? mencMenu.querySelectorAll(".co-menc-item") : [];
      for (var i = 0; i < its.length; i++) its[i].classList.toggle("on", i === mencIdx);
    }
    function selecionarMenc(idx) {
      var u = mencItens[idx]; if (!u || !coInp) { fecharMenc(); return; }
      var handle = handleUnico(u);
      if (!handle) { fecharMenc(); coInp.focus(); return; }   // nome sem char válido no início: não insere "@ " quebrado
      var val = coInp.value || "";
      var pos = coInp.selectionStart;
      var antes = val.slice(0, mencStart), depois = val.slice(pos);
      var inserido = "@" + handle + " ";
      coInp.value = antes + inserido + depois;
      var caret = (antes + inserido).length;
      try { coInp.setSelectionRange(caret, caret); } catch (e) {}
      mencoesSel[handle.toLowerCase()] = u.id;   // registra o vínculo handle->id p/ o mencoesDoCorpo
      fecharMenc();
      coInp.focus();
    }
    // Clique numa @menção já renderizada: semeia o compositor com "@handle" e abre o autocomplete
    // (a pessoa confirma no Enter, virando menção de verdade). Cumpre "clicável" sem página de perfil.
    function aoClicarMencao(alvo) {
      if (!coInp || !canalAtual) return;
      var handle = String(alvo.textContent || "").replace(/^@/, "");
      if (!handle) return;
      var v = coInp.value || "";
      if (v && !/\s$/.test(v)) v += " ";
      coInp.value = v + "@" + handle;
      var caret = coInp.value.length;
      coInp.focus();
      try { coInp.setSelectionRange(caret, caret); } catch (e) {}
      avaliarMenc();   // reaproveita a busca; o menu abre com o nome pré-filtrado
    }
    // ---- Reações (Sprint 1.12) --------------------------------------------------------------
    function normReacoes(reacoes) {
      var arr = reacoes;
      if (typeof arr === "string") { try { arr = JSON.parse(arr); } catch (e) { arr = []; } }
      return (arr && arr.length) ? arr : [];
    }
    // Barra de chips "emoji N" abaixo da mensagem; a(s) minha(s) reação(ões) ganham a classe "eu".
    function reacoesHtml(reacoes) {
      var arr = normReacoes(reacoes), h = "";
      for (var i = 0; i < arr.length; i++) {
        var r = arr[i]; if (!r || !r.emoji || !(r.qtd > 0)) continue;
        h += '<button type="button" class="co-reacao' + (r.eu ? " eu" : "") + '" data-emoji="' + esc(r.emoji) + '">' +
             esc(r.emoji) + ' <span class="co-reacao-n">' + (r.qtd | 0) + "</span></button>";
      }
      return h;
    }
    function acharChip(bar, emoji) {
      if (!bar) return null;
      var cs = bar.querySelectorAll(".co-reacao");
      for (var i = 0; i < cs.length; i++) if (cs[i].getAttribute("data-emoji") === emoji) return cs[i];
      return null;
    }
    function barraDe(mid) {
      // (1.14) O(1) via mapa id->nó (era O(n) querySelectorAll por chamada => O(n²) na reconciliação).
      var el = mid && msgEls[mid];
      return (el && el.isConnected) ? el.querySelector(".co-reacoes") : null;
    }
    // Pintura otimista no clique (o servidor é a verdade; atualizarReacoes reconcilia logo depois).
    function reacaoOtimista(mid, emoji) {
      var bar = barraDe(mid); if (!bar) return;
      var chip = acharChip(bar, emoji);
      if (chip) {
        var eu = chip.classList.contains("eu");
        var span = chip.querySelector(".co-reacao-n");
        var n = (span && parseInt(span.textContent, 10)) || 0;
        n = eu ? n - 1 : n + 1;
        if (eu) chip.classList.remove("eu"); else chip.classList.add("eu");
        if (n <= 0) { if (chip.parentNode) chip.parentNode.removeChild(chip); }
        else if (span) span.textContent = n;
      } else {
        var b = document.createElement("button");
        b.type = "button"; b.className = "co-reacao eu"; b.setAttribute("data-emoji", emoji);
        b.innerHTML = esc(emoji) + ' <span class="co-reacao-n">1</span>';
        bar.appendChild(b);
      }
    }
    // Escrita: SÓ via toggle_reacao (idempotente/validado no servidor). Otimista + reconcilia.
    function toggleReacao(mid, emoji) {
      var sb = SB(); if (!sb || !mid || !emoji) return;
      reacaoOtimista(mid, emoji);
      var p;
      try { p = medirRpc("toggle_reacao", sb.rpc("toggle_reacao", { p_mensagem_id: mid, p_emoji: emoji })); }
      catch (e) { atualizarReacoes([mid]); return; }
      p.then(function () { atualizarReacoes([mid]); }, function () { atualizarReacoes([mid]); });   // verdade do servidor (sucesso OU erro)
    }
    // Leitura autoritativa das reações de mensagens específicas (tempo real + reconciliação).
    // Coalesce por reacFetching (não duplica busca da mesma msg em voo), MAS se a msg mudou
    // durante o voo (reacDirty), re-busca ao terminar => nunca "gruda" num snapshot velho.
    function atualizarReacoes(ids) {
      var sb = SB(); if (!sb || !ids || !ids.length) return;
      var alvos = [], i, id;
      for (i = 0; i < ids.length; i++) {
        id = ids[i]; if (!id) continue;
        if (reacFetching[id]) { reacDirty[id] = true; continue; }   // já em voo => marca p/ re-buscar
        reacFetching[id] = true; alvos.push(id);
      }
      if (!alvos.length) return;
      function terminar(data) {
        if (data) for (var j = 0; j < data.length; j++) { var bar = barraDe(data[j].mensagem_id); if (bar) bar.innerHTML = reacoesHtml(data[j].reacoes); }
        var redo = [];
        for (var k = 0; k < alvos.length; k++) { delete reacFetching[alvos[k]]; if (reacDirty[alvos[k]]) { delete reacDirty[alvos[k]]; redo.push(alvos[k]); } }
        if (redo.length) atualizarReacoes(redo);   // houve toggle/broadcast durante a busca => reconcilia de novo
      }
      var p;
      try { p = medirRpc("reacoes_de", sb.rpc("reacoes_de", { p_ids: alvos })); }
      catch (e) { terminar(null); return; }
      p.then(function (r) { terminar(r && !r.error && r.data ? r.data : null); }, function () { terminar(null); });
    }
    // Monta a barra de chips + o botão "reagir" numa bolha (usado por msgLinha E msgOtimista,
    // pra a MINHA mensagem também ter reações desde o envio otimista — não só ao reabrir o canal).
    function adicionarReacoesUI(div, body, reacoes) {
      var barra = document.createElement("div");
      barra.className = "co-reacoes";
      barra.innerHTML = reacoesHtml(reacoes);
      body.appendChild(barra);
      var rbtn = document.createElement("button");
      rbtn.type = "button"; rbtn.className = "co-react-btn"; rbtn.title = "Reagir"; rbtn.setAttribute("aria-label", "Reagir");
      rbtn.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>';
      div.appendChild(rbtn);
    }
    // Reconcilia as reações de TODAS as mensagens visíveis (reconexão / aba volta a focar):
    // recuperarMsgs (1.9) dedup por id e NÃO reinsere quem já está na tela, então a barra de
    // reações de mensagens existentes não se atualiza sozinha — aqui eu forço a releitura.
    function reconciliarReacoesVisiveis() {
      if (!msgLista) return;
      if (nowMs() - recReacTs < 2000) return;   // (1.14) coalesce: reconexão-flap + visibilitychange não disparam em rajada
      recReacTs = nowMs();
      var ms = msgLista.querySelectorAll(".co-msg"), ids = [], i;
      for (i = 0; i < ms.length && ids.length < 100; i++) { var id = ms[i].getAttribute("data-mid"); if (id) ids.push(id); }   // teto 100 (as mais novas)
      if (ids.length) atualizarReacoes(ids);
    }
    // Seletor de emojis: abre DENTRO da mensagem (posicionado por CSS relativo), um por vez.
    function fecharReacPick() {
      if (!msgLista) return;
      var ps = msgLista.querySelectorAll(".co-react-pick");
      for (var i = 0; i < ps.length; i++) if (ps[i].parentNode) ps[i].parentNode.removeChild(ps[i]);
    }
    function abrirReacPick(msgEl) {
      if (!msgEl) return;
      var jaAberto = msgEl.querySelector(".co-react-pick");
      fecharReacPick();
      if (jaAberto) return;   // 2º clique no mesmo botão = fecha (toggle)
      var pick = document.createElement("div");
      pick.className = "co-react-pick";
      var h = "";
      for (var i = 0; i < EMOJIS.length; i++) h += '<button type="button" class="co-react-emoji" data-emoji="' + esc(EMOJIS[i]) + '">' + esc(EMOJIS[i]) + "</button>";
      pick.innerHTML = h;
      msgEl.appendChild(pick);
    }
    function msgLinha(m) {
      var div = document.createElement("div");
      div.className = "co-msg";
      div.setAttribute("data-mid", m.id); div.setAttribute("data-ts", m.created_at || "");
      var corpo = m.corpo || "", eume = mencionadoMe(m);
      if (eume) div.classList.add("mencionado");
      var inner =
        '<div class="co-av">' + esc(iniciais(m.autor_nome)) + "</div>" +
        '<div class="co-msg-body"><div class="co-msg-top"><b>' + esc(m.autor_nome || "Alguém") + "</b> · " + tempoRel(m.created_at) +
        (eume ? ' · <span class="co-menc-voce">mencionou você</span>' : "") + "</div>";
      if (corpo) inner += '<div class="co-msg-corpo">' + corpoHtml(corpo) + "</div>";
      inner += "</div>";
      div.innerHTML = inner;
      var body = div.querySelector(".co-msg-body");
      // anexos de foto/áudio (1.5/1.7) — via URL assinada de curta duração
      var anexos = m.anexos;
      if (typeof anexos === "string") { try { anexos = JSON.parse(anexos); } catch (e) { anexos = []; } }
      if (anexos && anexos.length) {
        for (var i = 0; i < anexos.length; i++) {
          var ax = anexos[i];
          if (!ax || !ax.storage_path) continue;
          if (ax.tipo === "foto") body.appendChild(fotoEl(ax.storage_path));
          else if (ax.tipo === "audio") body.appendChild(audioEl(ax.storage_path, ax.duracao_ms));
        }
      }
      // transcrição do áudio (Sprint 1.8) — só quando a flag está ligada
      if (transcrOn && m.tipo_conteudo === "audio") {
        delete transcrPend[m.id];                                   // evita elemento órfão de render anterior
        body.appendChild(transcrLinha(m.id, m.transcricao_status, m.transcricao));
      }
      // reações (Sprint 1.12): barra de chips + botão "reagir" (hover no desktop / toque longo no mobile)
      adicionarReacoesUI(div, body, m.reacoes);
      msgEls[m.id] = div;   // (1.14) mapa id->nó p/ barraDe O(1)
      return div;
    }
    function msgSetStatus(estado) {
      if (!msgStatus) return;
      if (estado === "carregando") msgStatus.innerHTML = '<div class="copf-skel"></div><div class="copf-skel"></div>';
      else if (estado === "vazio") msgStatus.innerHTML = "<b>Nenhuma mensagem ainda.</b><br>Escreva a primeira no campo acima.";
      else if (estado === "erro") {
        msgStatus.innerHTML = '<b>Não consegui carregar as mensagens.</b><br><button class="copf-erro-btn" type="button">Tentar de novo</button>';
        var b = msgStatus.querySelector(".copf-erro-btn"); if (b) b.addEventListener("click", function () { carregarMsgs(true); });
      } else msgStatus.innerHTML = "";
    }
    function carregarMsgs(reset) {
      if (!canalAtual) return;
      if (!reset && msgCarregando) return; // reset (trocar de canal) sempre passa; o guard 'alvo' desambigua respostas concorrentes
      var sb = SB(); if (!sb) { msgSetStatus("erro"); return; }
      var alvo = canalAtual;
      msgCarregando = true;
      if (reset) {
        msgTs = null; msgId = null;
        // (1.14) LIMPA ANTES do rpc: pausa áudios tocando, revoga os blob: das bolhas otimistas
        // (senão vaza RAM), zera lista/dedup/mapa. Antes isso só rodava no SUCESSO => se o rpc
        // falhava/demorava, as mensagens do canal ANTERIOR ficavam misturadas no novo.
        try { var aus = msgLista.querySelectorAll("audio"); for (var qa = 0; qa < aus.length; qa++) { try { aus[qa].pause(); } catch (e2) { } } } catch (e1) { }
        for (var uu = 0; uu < urlsOtimistas.length; uu++) { try { URL.revokeObjectURL(urlsOtimistas[uu]); } catch (e3) { } }
        urlsOtimistas = [];
        msgLista.innerHTML = ""; transcrPend = {}; msgIds = {}; msgFetching = {}; msgEls = {};
      }
      if (reset && msgLista.children.length === 0) msgSetStatus("carregando");
      if (!reset && msgMais) msgMais.textContent = "Carregando…";
      medirRpc("mensagens_pagina", sb.rpc("mensagens_pagina", { p_topico_id: alvo, p_antes_ts: reset ? null : msgTs, p_antes_id: reset ? null : msgId, p_limite: TAM })).then(function (r) {
        msgCarregando = false;
        if (alvo !== canalAtual) return; // trocou de canal no meio do caminho
        if (r && r.error) { msgSetStatus("erro"); if (msgMais) msgMais.textContent = "Carregar mais"; return; }
        var linhas = (r && r.data) || [];
        for (var i = 0; i < linhas.length; i++) { if (!msgIds[linhas[i].id]) { msgLista.appendChild(msgLinha(linhas[i])); msgIds[linhas[i].id] = true; } }
        if (reset && linhas.length) marcarLidoAte(alvo, linhas[0].id);   // abriu => marca lido até a mais nova
        if (linhas.length) { msgTs = linhas[linhas.length - 1].created_at; msgId = linhas[linhas.length - 1].id; }
        msgTemMais = linhas.length >= TAM;
        if (msgMais) { msgMais.style.display = msgTemMais ? "" : "none"; msgMais.textContent = "Carregar mais"; }
        msgSetStatus(msgLista.children.length === 0 ? "vazio" : "");
      }, function () { msgCarregando = false; if (alvo === canalAtual) { msgSetStatus("erro"); if (msgMais) msgMais.textContent = "Carregar mais"; } });
    }

    /* ---------- TEMPO REAL DA CONVERSA (Sprint 1.9) ---------- */
    // Insere na POSIÇÃO canônica por (created_at, id) desc — não assume ordem de chegada.
    // Compara por EPOCH (Date.parse) p/ ser robusto ao formato do timestamp (UTC 'Z' do
    // otimista vs offset do servidor); empate por id (igual ao keyset do banco).
    function inserirMsgOrdenada(el, ts, id) {
      var tn = Date.parse(ts) || 0;
      var kids = msgLista.children;
      for (var i = 0; i < kids.length; i++) {
        var c = kids[i], cts = c.getAttribute("data-ts"), cid = c.getAttribute("data-mid");
        if (cts == null) continue;
        var ctn = Date.parse(cts) || 0;
        if (ctn < tn || (ctn === tn && String(cid) < String(id))) { msgLista.insertBefore(el, c); return; }
      }
      msgLista.appendChild(el);   // é a mais antiga da lista atual
    }
    // Busca SÓ a mensagem nova (id) e insere, se for da conversa aberta e ainda não estiver na tela.
    function buscarMsgNova(id, topico) {
      if (!id || topico !== canalAtual || msgIds[id] || msgFetching[id]) return;   // outro tópico / já presente / já buscando
      var sb = SB(); if (!sb) return;
      msgFetching[id] = true;
      var p;
      try { p = medirRpc("mensagens_por_ids", sb.rpc("mensagens_por_ids", { p_ids: [id] })); }
      catch (e) { delete msgFetching[id]; return; }   // (1.14) exceção síncrona não deixa o id travado
      p.then(function (r) {
        delete msgFetching[id];
        if (!r || r.error || topico !== canalAtual) return;     // trocou de conversa durante o fetch => não renderiza
        var rows = (r.data) || [];
        if (!rows.length) return;                               // sem acesso (RLS) ou removida => nada
        var m = rows[0];
        if (msgIds[m.id]) return;                               // chegou 2x / reconciliada nesse meio-tempo
        msgIds[m.id] = true;
        inserirMsgOrdenada(msgLinha(m), m.created_at, m.id);
        msgSetStatus("");                                       // some o "vazio" se estava
        marcarLidoAte(topico, m.id);                            // tópico aberto => marca lido automaticamente (não gera badge)
      }, function () { delete msgFetching[id]; });
    }
    // Reconexão: recuperação SIMPLES e limitada — recarrega a última página e insere só o que
    // falta (dedup por mensagem.id). Bounded (TAM); não recarrega todo o histórico.
    function recuperarMsgs() {
      if (!canalAtual || viewAtual !== "canal") return;
      var sb = SB(); if (!sb) return;
      var alvo = canalAtual;
      medirRpc("mensagens_pagina", sb.rpc("mensagens_pagina", { p_topico_id: alvo, p_antes_ts: null, p_antes_id: null, p_limite: TAM })).then(function (r) {
        if (!r || r.error || alvo !== canalAtual) return;
        var linhas = (r.data) || [];
        // (1.14) offline longo: se a última página inteira é NOVA e cheia, provavelmente há um BURACO
        // (>TAM msgs perdidas) — recarrega do zero (reset bounded) em vez de deixar lacuna invisível.
        var conhecidas = 0;
        for (var k = 0; k < linhas.length; k++) if (msgIds[linhas[k].id]) conhecidas++;
        if (linhas.length >= TAM && conhecidas === 0 && msgLista.children.length) { carregarMsgs(true); return; }
        for (var i = 0; i < linhas.length; i++) {
          var m = linhas[i];
          if (msgIds[m.id]) continue;                           // dedup
          msgIds[m.id] = true;
          inserirMsgOrdenada(msgLinha(m), m.created_at, m.id);
        }
        if (linhas.length) marcarLidoAte(alvo, linhas[0].id);   // (1.14) marca lido até a mais nova => sem badge fantasma
        if (msgLista.children.length) msgSetStatus("");
      }, function () { });
    }
    // Indicador discreto de reconexão (só um aviso; não bloqueia nada).
    function conexao(ok) {
      if (!elPage) return;
      var b = elPage.querySelector(".co-reconn");
      if (ok) { if (b) b.style.display = "none"; return; }
      if (!b) { b = document.createElement("div"); b.className = "co-reconn"; b.textContent = "Reconectando…"; elPage.appendChild(b); }
      b.style.display = "";
    }

    /* ---------- NÃO-LIDAS (Sprint 1.10) ---------- */
    // Pinta os badges a partir de naoLidas (o tópico aberto nunca mostra badge).
    function renderNaoLidas() {
      if (!elPage) return;
      var itens = elPage.querySelectorAll(".co-side [data-topico]");
      for (var i = 0; i < itens.length; i++) {
        var tid = itens[i].getAttribute("data-topico"), n = naoLidas[tid] || 0;
        var badge = itens[i].querySelector(".co-badge"); if (!badge) continue;
        if (n > 0 && tid !== canalAtual) { badge.textContent = n > 99 ? "99+" : String(n); badge.style.display = ""; }
        else badge.style.display = "none";
      }
    }
    // Reconciliação AUTORITATIVA: pega a contagem real do servidor (exclui as próprias, sob RLS).
    // Chamada ao montar/abrir a Central/reconectar => reconexão nunca dobra.
    function carregarNaoLidas() {
      var sb = SB(); if (!sb) return;
      var g = ++nlGen;   // (1.14) token: resposta atrasada de uma chamada antiga não sobrescreve o estado novo
      medirRpc("nao_lidas", sb.rpc("nao_lidas")).then(function (r) {
        if (g !== nlGen) return;
        if (!r || r.error) return;
        var novo = {}, rows = (r.data) || [];
        for (var i = 0; i < rows.length; i++) novo[rows[i].topico_id] = rows[i].qtd;
        naoLidas = novo; contadas = {}; renderNaoLidas();   // reconciliou => zera o dedup otimista (não cresce sem limite)
      }, function () { });
    }
    // Incremento OTIMISTA do contador de um tópico FECHADO, a partir do Broadcast.
    // Dedup por mensagem.id (não dobra em evento repetido/reconexão); nunca conta as próprias.
    function incrementarNaoLida(topico, ent, autor) {
      if (!topico || !ent || contadas[ent]) return;
      var eu = (perfil() || {}).id;
      if (eu && autor === eu) return;                 // mensagem própria (outro dispositivo) => não conta
      contadas[ent] = true;
      naoLidas[topico] = (naoLidas[topico] || 0) + 1;
      renderNaoLidas();
    }
    // Marca lido até a mensagem X (reusa a RPC marcar_lido da Sprint 0) e zera o badge do tópico.
    function marcarLidoAte(topico, msgId) {
      if (!topico || !msgId) return;
      if (document.visibilityState && document.visibilityState !== "visible") return;   // (1.14) não marca lido com a aba oculta
      naoLidas[topico] = 0; renderNaoLidas();
      var sb = SB(); if (!sb) return;
      try { medirRpc("marcar_lido", sb.rpc("marcar_lido", { p_topico_id: topico, p_ate_mensagem_id: msgId })).then(function () { }, function () { }); } catch (e) { }
    }

    /* ---------- COMPOSITOR DE TEXTO (Sprint 1.4) ---------- */
    // UUIDv7 gerado no cliente = id da mensagem = chave de idempotência de postar_mensagem.
    // Reutilizado no "reenviar" (mesmo id => o ON CONFLICT (id) DO NOTHING do servidor não duplica).
    function uuidv7() {
      var ts = Date.now(), b = new Uint8Array(16), i, k;
      b[0] = Math.floor(ts / 1099511627776) & 0xff; // 2^40
      b[1] = Math.floor(ts / 4294967296) & 0xff;     // 2^32
      b[2] = Math.floor(ts / 16777216) & 0xff;       // 2^24
      b[3] = Math.floor(ts / 65536) & 0xff;          // 2^16
      b[4] = Math.floor(ts / 256) & 0xff;            // 2^8
      b[5] = ts & 0xff;
      var r = new Uint8Array(10);
      if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(r);
      else for (k = 0; k < 10; k++) r[k] = Math.floor(Math.random() * 256);
      for (i = 0; i < 10; i++) b[6 + i] = r[i];
      b[6] = (b[6] & 0x0f) | 0x70; // versão 7
      b[8] = (b[8] & 0x3f) | 0x80; // variante RFC 4122
      function h(x) { return (x + 0x100).toString(16).slice(1); }
      return h(b[0]) + h(b[1]) + h(b[2]) + h(b[3]) + "-" + h(b[4]) + h(b[5]) + "-" +
             h(b[6]) + h(b[7]) + "-" + h(b[8]) + h(b[9]) + "-" +
             h(b[10]) + h(b[11]) + h(b[12]) + h(b[13]) + h(b[14]) + h(b[15]);
    }
    // Atualiza o rótulo de estado da bolha otimista (enviando / ok / erro-com-reenviar).
    function estadoMsg(el, estado, id, topico, corpo, mencoes) {
      var top = el && el.querySelector(".co-est"); if (!top) return;
      if (estado === "enviando") { top.className = "co-est enviando"; top.textContent = "enviando…"; }
      else if (estado === "ok") { top.className = "co-est"; top.textContent = tempoRel(new Date().toISOString()); }
      else {
        top.className = "co-est erro"; top.textContent = "falhou · ";
        var rb = document.createElement("button");
        rb.type = "button"; rb.className = "co-reenviar"; rb.textContent = "reenviar";
        rb.addEventListener("click", function () { enviarRPC(id, topico, corpo, el, mencoes); }); // MESMO id+menções => idempotente
        top.appendChild(rb);
      }
    }
    // Bolha otimista no topo (posição da mais nova). Some o estado "vazio" se houver.
    // fotoUrl/audioUrl (opcionais) = URL local (objectURL) do anexo pra mostrar/tocar na hora.
    function msgOtimista(id, corpo, fotoUrl, audioUrl) {
      var me = perfil() || {};
      var div = document.createElement("div");
      div.className = "co-msg"; div.setAttribute("data-mid", id); div.setAttribute("data-ts", new Date().toISOString());
      msgIds[id] = true; msgEls[id] = div;   // dedup + mapa id->nó (1.14)
      if (fotoUrl || audioUrl) urlsOtimistas.push(fotoUrl || audioUrl);   // (1.14) rastreia o blob: p/ revogar no reset
      var inner =
        '<div class="co-av">' + esc(iniciais(me.nome)) + "</div>" +
        '<div class="co-msg-body"><div class="co-msg-top"><b>' + esc(me.nome || "Você") + '</b> · <span class="co-est enviando">enviando…</span></div>';
      if (corpo) inner += '<div class="co-msg-corpo">' + corpoHtml(corpo) + "</div>";
      inner += "</div>";
      div.innerHTML = inner;
      var body = div.querySelector(".co-msg-body");
      if (fotoUrl) {
        var wrap = document.createElement("div"); wrap.className = "co-msg-foto";
        var img = document.createElement("img"); img.src = fotoUrl; img.alt = "foto";
        wrap.appendChild(img); body.appendChild(wrap);
      }
      if (audioUrl) {
        var aw = document.createElement("div"); aw.className = "co-msg-audio";
        var au = document.createElement("audio"); au.controls = true; au.preload = "metadata"; au.src = audioUrl;
        aw.appendChild(au); body.appendChild(aw);
        if (transcrOn) body.appendChild(transcrLinha(id, "pendente", null));   // áudio recém-enviado entra como pendente
      }
      adicionarReacoesUI(div, body, []);   // a MINHA mensagem também recebe barra+botão de reação já no otimista
      if (msgStatus) msgStatus.innerHTML = "";
      if (msgLista.firstChild) msgLista.insertBefore(div, msgLista.firstChild);
      else msgLista.appendChild(div);
      return div;
    }
    // Envia (ou reenvia) via a RPC postar_mensagem. Só texto. Desabilita o botão durante o envio.
    function enviarRPC(id, topico, corpo, el, mencoes) {
      var sb = SB();
      function reabilita() { if (coEnviar) coEnviar.disabled = false; }
      function falhou() {
        reabilita();
        // Se a bolha saiu da tela (o usuário trocou de conversa no meio do envio), não dá p/
        // mostrar o "reenviar" nela. Devolve o texto ao campo SÓ se ainda for a MESMA conversa
        // (senão eu reenviaria pro tópico errado). É o único caminho que perderia o texto.
        if (el && el.isConnected === false) {
          if (canalAtual === topico && coInp && !coInp.value) { coInp.value = corpo; coInp.focus(); }
          return;
        }
        estadoMsg(el, "erro", id, topico, corpo, mencoes);
      }
      if (!sb) { falhou(); return; }
      estadoMsg(el, "enviando", id, topico, corpo, mencoes);
      if (coEnviar) coEnviar.disabled = true;
      var p;
      try { p = comTimeout(medirRpc("postar_mensagem", sb.rpc("postar_mensagem", { p_mensagem_id: id, p_topico_id: topico, p_corpo: corpo, p_tipo: "texto", p_mencoes: mencoes || [] })), 30000); }   // (1.14) 30s de teto
      catch (e) { falhou(); return; }   // rpc lançou síncrono => nunca deixa o botão travado
      p.then(function (r) {
        reabilita();
        if (r && r.error) { falhou(); return; }
        estadoMsg(el, "ok", id, topico, corpo, mencoes);   // reconcilia: id == o do servidor; o trigger emite o evento p/ o Feed
      }, function () { falhou(); });
    }
    // Handler do compositor: valida, gera o id, mostra otimista, limpa o campo e envia.
    function enviarTexto() {
      if (!coInp || !canalAtual) return;
      var corpo = (coInp.value || "").trim();
      if (!corpo) return;
      var id = uuidv7(), topico = canalAtual, mencoes = mencoesDoCorpo(corpo);
      coInp.value = ""; coInp.style.height = "";        // limpa já; 2º clique/Enter não reenvia o mesmo texto
      limparMenc();                                     // fecha autocomplete + zera o draft de menções
      var el = msgOtimista(id, corpo);
      enviarRPC(id, topico, corpo, el, mencoes);
      coInp.focus();
    }

    /* ---------- COMPOSITOR DE FOTO (Sprint 1.5) ---------- */
    // Dispatcher: áudio > foto > texto (só um anexo por mensagem; texto opcional junto).
    function enviar() { pararDigitar(); if (coAudioPend) enviarAudio(); else if (coPend) enviarFoto(); else enviarTexto(); }

    function compErro(msg) {
      if (!coErro) return;
      if (msg) { coErro.textContent = msg; coErro.style.display = ""; }
      else { coErro.textContent = ""; coErro.style.display = "none"; }
    }
    // Assinatura REAL dos bytes (não confia na extensão): JPEG/PNG/WEBP.
    function sniff(u) {
      if (u.length >= 3 && u[0] === 0xFF && u[1] === 0xD8 && u[2] === 0xFF) return "image/jpeg";
      if (u.length >= 8 && u[0] === 0x89 && u[1] === 0x50 && u[2] === 0x4E && u[3] === 0x47 &&
          u[4] === 0x0D && u[5] === 0x0A && u[6] === 0x1A && u[7] === 0x0A) return "image/png";
      if (u.length >= 12 && u[0] === 0x52 && u[1] === 0x49 && u[2] === 0x46 && u[3] === 0x46 &&
          u[8] === 0x57 && u[9] === 0x45 && u[10] === 0x42 && u[11] === 0x50) return "image/webp";
      return null;
    }
    // Valida tamanho + assinatura real + dimensões. cb(meta, erro).
    function validarFoto(file, cb) {
      if (!file) return cb(null, "nenhum arquivo");
      var bytes = file.size;
      if (!bytes || bytes <= 0) return cb(null, "arquivo vazio");
      if (bytes > MAX_BYTES) return cb(null, "foto acima de 5 MB");
      var fr = new FileReader();
      fr.onload = function () {
        var mime; try { mime = sniff(new Uint8Array(fr.result)); } catch (e) { mime = null; }
        if (!mime) return cb(null, "só aceito foto JPG, PNG ou WEBP");
        var url = URL.createObjectURL(file);
        var im = new Image();
        im.onload = function () { cb({ file: file, mime: mime, ext: MIMES[mime], bytes: bytes, largura: im.naturalWidth || 0, altura: im.naturalHeight || 0, url: url }, null); };
        im.onerror = function () { try { URL.revokeObjectURL(url); } catch (e) {} cb(null, "imagem inválida"); };
        im.src = url;
      };
      fr.onerror = function () { cb(null, "não consegui ler o arquivo"); };
      try { fr.readAsArrayBuffer(file.slice(0, 16)); } catch (e) { cb(null, "não consegui ler o arquivo"); }
    }
    function limparFoto() {
      if (coPend && coPend.url) { try { URL.revokeObjectURL(coPend.url); } catch (e) {} }
      coPend = null;
      if (coPreview) coPreview.style.display = "none";
      if (coPreImg) coPreImg.removeAttribute("src");
      compErro("");
    }
    function escolherFoto(file) {
      compErro(""); limparAudio();   // só um anexo por mensagem
      validarFoto(file, function (meta, erro) {
        if (erro) { limparFoto(); compErro(erro); return; }
        if (coPend && coPend.url) { try { URL.revokeObjectURL(coPend.url); } catch (e) {} }  // troca a foto anterior
        coPend = meta;
        if (coPreImg) coPreImg.src = meta.url;
        if (coPreNome) coPreNome.textContent = meta.ext.toUpperCase() + " · " + Math.round(meta.bytes / 1024) + " KB · " + meta.largura + "×" + meta.altura;
        if (coPreview) coPreview.style.display = "";
      });
    }
    // Estado da bolha otimista de anexo — foto OU áudio (preparando/enviando/ok/erro/perm).
    // Retry reusa o MESMO pl (ids/caminho/arquivo) => idempotente.
    function estadoAnexo(el, estado, pl) {
      var top = el && el.querySelector(".co-est"); if (!top) return;
      // áudio que falhou no envio: não existe no servidor => remove a linha de transcrição presa
      if ((estado === "erro" || estado === "perm") && pl && pl.kind === "audio" && el) {
        var tr = el.querySelector(".co-transcr"); if (tr && tr.parentNode) tr.parentNode.removeChild(tr);
        if (transcrPend[pl.mensagem_id]) delete transcrPend[pl.mensagem_id];
      }
      if (estado === "preparando") { top.className = "co-est enviando"; top.textContent = "preparando…"; }
      else if (estado === "enviando") { top.className = "co-est enviando"; top.textContent = "enviando…"; }
      else if (estado === "ok") { top.className = "co-est"; top.textContent = tempoRel(new Date().toISOString()); }
      else if (estado === "perm") { top.className = "co-est perm"; top.textContent = "conflito — não reenviar"; }
      else {
        top.className = "co-est erro"; top.textContent = "falhou · ";
        var rb = document.createElement("button");
        rb.type = "button"; rb.className = "co-reenviar"; rb.textContent = "reenviar";
        rb.addEventListener("click", function () { enviarAnexoRPC(pl, el); });
        top.appendChild(rb);
      }
    }
    // Handler: captura tópico, gera ids, monta payload imutável, mostra otimista e envia.
    function enviarFoto() {
      if (!canalAtual || !coPend) return;
      var pend = coPend, topico = canalAtual;
      var mid = uuidv7(), aid = uuidv7();
      var pl = {
        kind: "foto", mensagem_id: mid, anexo_id: aid, topico: topico,
        path: TENANT + "/" + topico + "/" + aid + "." + pend.ext,
        file: pend.file, mime: pend.mime, bytes: pend.bytes, largura: pend.largura, altura: pend.altura,
        corpo: (coInp && coInp.value ? coInp.value.trim() : "") || null, url: pend.url
      };
      pl.mencoes = mencoesDoCorpo(pl.corpo || "");
      // limpa o compositor JÁ (2º clique/Enter não reenvia). NÃO revoga a url: a bolha usa.
      coPend = null;
      if (coPreview) coPreview.style.display = "none";
      if (coPreImg) coPreImg.removeAttribute("src");
      if (coInp) { coInp.value = ""; coInp.style.height = ""; }
      limparMenc(); compErro("");
      var el = msgOtimista(mid, pl.corpo || "", pl.url, null);
      enviarAnexoRPC(pl, el);
    }
    function jaExiste(err) {
      var s = String((err && (err.statusCode || err.status)) || "");
      var m = String((err && err.message) || "").toLowerCase();
      return s === "409" || m.indexOf("exists") >= 0 || m.indexOf("duplicate") >= 0;
    }
    // ORDEM (foto E áudio): (ids já gerados) -> upload upsert:false -> postar_mensagem -> reconcilia.
    function enviarAnexoRPC(pl, el) {
      var sb = SB();
      function reabilita() { if (coEnviar) coEnviar.disabled = false; if (coFotoBtn) coFotoBtn.disabled = false; if (coAudioBtn) coAudioBtn.disabled = false; }
      function falhou(permanente) {
        reabilita();
        // (1.14) bolha detached (troquei de conversa e o anexo falhou depois): NÃO some em silêncio.
        // Se voltei pra MESMA conversa e a msg não está lá, recria a bolha em erro (retry idempotente
        // pelo mesmo mensagem_id); senão, avisa no compositor. Antes: 'return' = perda silenciosa + órfão.
        if (el && el.isConnected === false) {
          if (canalAtual === pl.topico && !msgIds[pl.mensagem_id]) {
            // (1.14) pl.url pode ter sido revogado pelo reset (troquei de conversa e voltei) => miniatura quebrada.
            // Regenera um objectURL vivo a partir de pl.file (que segue válido; é o mesmo usado no upload/retry);
            // msgOtimista re-registra o novo url em urlsOtimistas, então continua sendo revogado no próximo reset.
            var reUrl = pl.file ? URL.createObjectURL(pl.file) : null;
            var novo = msgOtimista(pl.mensagem_id, pl.corpo || "", pl.kind === "foto" ? reUrl : null, pl.kind === "audio" ? reUrl : null);
            estadoAnexo(novo, permanente ? "perm" : "erro", pl);
          } else { try { compErro("o envio do anexo falhou — tente de novo."); } catch (e) { } }
          return;
        }
        estadoAnexo(el, permanente ? "perm" : "erro", pl);
      }
      if (!sb || !sb.storage) { falhou(false); return; }
      estadoAnexo(el, "preparando", pl);
      if (coEnviar) coEnviar.disabled = true;
      if (coFotoBtn) coFotoBtn.disabled = true;
      if (coAudioBtn) coAudioBtn.disabled = true;
      estadoAnexo(el, "enviando", pl);
      var up, t0 = nowMs();
      try { up = comTimeout(sb.storage.from(BUCKET).upload(pl.path, pl.file, { upsert: false, contentType: pl.mime }), 120000); }  // (1.14) 2min de teto
      catch (e) { coStats.uploadFalhas++; falhou(false); return; }
      up.then(function (r) {
        if (r && r.error) {
          if (jaExiste(r.error)) { chamarRpcAnexo(pl, el, reabilita, falhou); return; } // já existe no MESMO caminho => possível replay => segue p/ RPC
          coStats.uploadFalhas++; coLog("upload erro", pl.kind); falhou(false); return;  // outro erro de upload => NÃO chama a RPC
        }
        coStats.uploadOk++; coStats.uploadMsTotal += nowMs() - t0;
        chamarRpcAnexo(pl, el, reabilita, falhou);
      }, function () { coStats.uploadFalhas++; coLog("upload timeout/erro", pl.kind); falhou(false); });
    }
    function chamarRpcAnexo(pl, el, reabilita, falhou) {
      var sb = SB(); if (!sb) { falhou(false); return; }
      var anexo = pl.kind === "audio"
        ? { id: pl.anexo_id, tipo: "audio", storage_path: pl.path, mime: pl.mime, bytes: pl.bytes, duracao_ms: pl.duracao_ms }
        : { id: pl.anexo_id, tipo: "foto",  storage_path: pl.path, mime: pl.mime, bytes: pl.bytes, largura: pl.largura, altura: pl.altura };
      var p;
      try { p = comTimeout(medirRpc("postar_mensagem(anexo)", sb.rpc("postar_mensagem", { p_mensagem_id: pl.mensagem_id, p_topico_id: pl.topico, p_corpo: pl.corpo, p_tipo: pl.kind, p_anexos: [anexo], p_mencoes: pl.mencoes || [] })), 30000); }  // (1.14) 30s de teto
      catch (e) { falhou(false); return; }
      p.then(function (r) {
        reabilita();
        if (r && r.error) { falhou(r.error && String(r.error.code) === "23505"); return; }  // 23505 = payload diferente = permanente
        if (el && el.isConnected !== false) estadoAnexo(el, "ok", pl);                        // reconcilia por id (o anexo local já está na bolha)
      }, function () { falhou(false); });
    }
    // Exibição de foto do servidor: URL assinada de curta duração (não gravada no banco).
    function fotoEl(path) {
      var wrap = document.createElement("div");
      wrap.className = "co-msg-foto";
      wrap.innerHTML = '<div class="co-foto-skel"></div>';
      carregarSignedUrl(path, wrap);
      return wrap;
    }
    function carregarSignedUrl(path, wrap) {
      var sb = SB();
      function fallback() {
        wrap.innerHTML = '<div class="co-foto-erro">Não consegui carregar a foto.<button type="button">tentar de novo</button></div>';
        var b = wrap.querySelector("button");
        if (b) b.addEventListener("click", function () { wrap.innerHTML = '<div class="co-foto-skel"></div>'; carregarSignedUrl(path, wrap); });
      }
      if (!sb || !sb.storage) { fallback(); return; }
      sb.storage.from(BUCKET).createSignedUrl(path, URL_TTL).then(function (r) {
        if (!r || r.error || !r.data || !r.data.signedUrl) { fallback(); return; }
        var cur = r.data.signedUrl, renovou = false;
        var img = document.createElement("img"); img.alt = "foto"; img.loading = "lazy";   // (1.14) fotos fora da tela não baixam/decodificam eager
        img.onerror = function () {
          if (renovou) { fallback(); return; }               // expirou/renovou e ainda falhou
          renovou = true;
          sb.storage.from(BUCKET).createSignedUrl(path, URL_TTL).then(function (r2) {
            if (r2 && r2.data && r2.data.signedUrl) { cur = r2.data.signedUrl; img.src = cur; } else fallback();
          }, function () { fallback(); });
        };
        // (1.14) clique gera URL FRESCA (a 'cur' pode ter vencido depois de 15min); abre a janela já
        // (preserva o gesto, sem bloqueio de popup) e aponta pra url nova.
        img.addEventListener("click", function () {
          var w; try { w = window.open("", "_blank"); } catch (e) { }
          sb.storage.from(BUCKET).createSignedUrl(path, URL_TTL).then(function (r3) {
            var u = r3 && r3.data && r3.data.signedUrl;
            if (w && u) { try { w.location = u; } catch (e) { } } else if (w) { try { w.close(); } catch (e) { } }
          }, function () { if (w) { try { w.close(); } catch (e) { } } });
        });
        img.src = cur;
        wrap.innerHTML = ""; wrap.appendChild(img);
      }, function () { fallback(); });
    }

    /* ---------- ÁUDIO (Sprint 1.7) ---------- */
    function fmtDur(ms) {
      var s = Math.max(0, Math.round((ms || 0) / 1000));
      return Math.floor(s / 60) + ":" + ("0" + (s % 60)).slice(-2);
    }
    // Exibição de áudio do servidor: player nativo com URL assinada de curta duração.
    function audioEl(path, dur) {
      var wrap = document.createElement("div");
      wrap.className = "co-msg-audio";
      wrap.innerHTML = '<div class="co-foto-skel" style="width:220px;height:40px"></div>';
      carregarSignedUrlAudio(path, wrap, dur);
      return wrap;
    }
    function carregarSignedUrlAudio(path, wrap, dur) {
      var sb = SB();
      function fallback() {
        wrap.innerHTML = '<div class="co-foto-erro">Não consegui carregar o áudio.<button type="button">tentar de novo</button></div>';
        var b = wrap.querySelector("button");
        if (b) b.addEventListener("click", function () { wrap.innerHTML = '<div class="co-foto-skel" style="width:220px;height:40px"></div>'; carregarSignedUrlAudio(path, wrap, dur); });
      }
      if (!sb || !sb.storage) { fallback(); return; }
      sb.storage.from(BUCKET).createSignedUrl(path, URL_TTL).then(function (r) {
        if (!r || r.error || !r.data || !r.data.signedUrl) { fallback(); return; }
        var cur = r.data.signedUrl, renovou = false;
        var au = document.createElement("audio"); au.controls = true; au.preload = "metadata";
        au.onerror = function () {
          if (renovou) { fallback(); return; }               // expirou/renovou e ainda falhou
          renovou = true;
          sb.storage.from(BUCKET).createSignedUrl(path, URL_TTL).then(function (r2) {
            if (r2 && r2.data && r2.data.signedUrl) { cur = r2.data.signedUrl; au.src = cur; } else fallback();
          }, function () { fallback(); });
        };
        au.src = cur;
        wrap.innerHTML = ""; wrap.appendChild(au);
        if (dur) { var d = document.createElement("span"); d.className = "co-audio-dur"; d.textContent = fmtDur(dur); wrap.appendChild(d); }
      }, function () { fallback(); });
    }
    // Escolhe um mimeType de gravação suportado pelo navegador.
    function escolherMimeAudio() {
      var cands = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4", "audio/aac", "audio/mpeg"];
      if (window.MediaRecorder && MediaRecorder.isTypeSupported) {
        for (var i = 0; i < cands.length; i++) { try { if (MediaRecorder.isTypeSupported(cands[i])) return cands[i]; } catch (e) {} }
      }
      return "";   // deixa o navegador escolher o padrão
    }
    function pararStream() {
      try { if (coRecStream) { var t = coRecStream.getTracks(); for (var i = 0; i < t.length; i++) t[i].stop(); } } catch (e) {}
      coRecStream = null;
    }
    function limparAudio() {
      coRecGen++;               // invalida qualquer getUserMedia pendente (o callback vai parar a stream e sair)
      coRecBusy = false;
      if (coRecTimer) { clearInterval(coRecTimer); coRecTimer = null; }
      if (coRec && coRec.state && coRec.state !== "inactive") { try { coRec.onstop = null; coRec.stop(); } catch (e) {} }
      coRec = null; coRecChunks = []; pararStream();
      if (coAudioPend && coAudioPend.url) { try { URL.revokeObjectURL(coAudioPend.url); } catch (e) {} }
      coAudioPend = null;
      if (coAudioArea) { coAudioArea.style.display = "none"; coAudioArea.innerHTML = ""; }
      if (coAudioBtn) { coAudioBtn.classList.remove("rec"); coAudioBtn.disabled = false; }
    }
    // Alterna gravar/parar.
    function toggleGravar() {
      if (coRec && coRec.state === "recording") { pararGravacao(); return; }
      if (coRec || coRecBusy) return;             // já gravando OU aguardando o microfone (guard SÍNCRONO)
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
        compErro("gravação de áudio não é suportada neste navegador"); return;
      }
      limparFoto(); limparAudio(); compErro("");
      coRecBusy = true;                           // trava reentrância ANTES do await do microfone
      var gen = ++coRecGen, topico = canalAtual;  // token: se mudar até resolver, descarto a stream
      if (coAudioBtn) coAudioBtn.disabled = true;
      function pararUsada(stream) { try { var t = stream.getTracks(); for (var i = 0; i < t.length; i++) t[i].stop(); } catch (e) {} }
      navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
        coRecBusy = false; if (coAudioBtn) coAudioBtn.disabled = false;
        if (gen !== coRecGen || topico !== canalAtual) { pararUsada(stream); return; } // cancelado no meio => NÃO deixa o mic ligado
        coRecStream = stream;
        var mime = escolherMimeAudio();
        try { coRec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream); }
        catch (e) { pararStream(); compErro("não consegui iniciar a gravação"); return; }
        coRecChunks = [];
        coRec.ondataavailable = function (e) { if (e.data && e.data.size) coRecChunks.push(e.data); };
        coRec.onstop = function () { finalizarGravacao(); };
        coRecStart = Date.now();
        try { coRec.start(); } catch (e) { pararStream(); coRec = null; compErro("não consegui iniciar a gravação"); return; }
        if (coAudioBtn) coAudioBtn.classList.add("rec");
        renderGravando();
      }, function () {
        coRecBusy = false; if (coAudioBtn) coAudioBtn.disabled = false;
        if (gen !== coRecGen || topico !== canalAtual) return;
        compErro("não consegui acessar o microfone (permissão negada?)");
      });
    }
    function pararGravacao() { if (coRec && coRec.state === "recording") { try { coRec.stop(); } catch (e) {} } }
    function renderGravando() {
      if (!coAudioArea) return;
      coAudioArea.style.display = "";
      coAudioArea.innerHTML = '<span class="co-rec-dot"></span><span>gravando… </span><span class="co-rec-t">0:00</span><button class="co-rec-stop" type="button">Parar</button>';
      coAudioArea.querySelector(".co-rec-stop").addEventListener("click", function () { pararGravacao(); });
      var tEl = coAudioArea.querySelector(".co-rec-t");
      if (coRecTimer) clearInterval(coRecTimer);
      coRecTimer = setInterval(function () {
        // (1.14) saiu da Central pra outra página no meio da gravação => desliga o microfone e o interval.
        if (elPage && !elPage.classList.contains("ativo")) { limparAudio(); return; }
        if (tEl) tEl.textContent = fmtDur(Date.now() - coRecStart);
      }, 250);
    }
    function finalizarGravacao() {
      if (coRecTimer) { clearInterval(coRecTimer); coRecTimer = null; }
      if (coAudioBtn) coAudioBtn.classList.remove("rec");
      var dur = Date.now() - coRecStart;
      var mime = String((coRec && coRec.mimeType) || (coRecChunks[0] && coRecChunks[0].type) || "audio/webm").split(";")[0].trim();
      var chunks = coRecChunks;
      coRec = null; coRecChunks = []; pararStream();
      var blob;
      try { blob = new Blob(chunks, { type: mime }); } catch (e) { blob = null; }
      // validação no cliente
      if (!blob || !AUDIO_EXT[mime]) { limparAudio(); compErro("formato de áudio não suportado neste navegador"); return; }
      if (blob.size <= 0) { limparAudio(); compErro("gravação vazia"); return; }
      if (blob.size > MAX_AUDIO) { limparAudio(); compErro("áudio acima de 10 MB — grave um trecho menor"); return; }
      if (!dur || dur < 300) { limparAudio(); compErro("gravação muito curta"); return; }
      var url = URL.createObjectURL(blob);
      coAudioPend = { blob: blob, mime: mime, ext: AUDIO_EXT[mime], bytes: blob.size, duracao_ms: dur, url: url };
      renderAudioPreview();
    }
    function renderAudioPreview() {
      if (!coAudioArea || !coAudioPend) return;
      coAudioArea.style.display = "";
      coAudioArea.innerHTML = "";
      var au = document.createElement("audio"); au.controls = true; au.preload = "metadata"; au.src = coAudioPend.url;
      var d = document.createElement("span"); d.className = "co-audio-dur"; d.textContent = fmtDur(coAudioPend.duracao_ms) + " · " + Math.round(coAudioPend.bytes / 1024) + " KB";
      var x = document.createElement("button"); x.type = "button"; x.className = "co-audio-x"; x.title = "Descartar"; x.innerHTML = "&times;";
      x.addEventListener("click", function () { limparAudio(); });
      coAudioArea.appendChild(au); coAudioArea.appendChild(d); coAudioArea.appendChild(x);
    }
    // Handler: captura tópico, gera ids, monta payload imutável, mostra otimista e envia.
    function enviarAudio() {
      if (!canalAtual || !coAudioPend) return;
      var pend = coAudioPend, topico = canalAtual;
      var mid = uuidv7(), aid = uuidv7();
      var pl = {
        kind: "audio", mensagem_id: mid, anexo_id: aid, topico: topico,
        path: TENANT + "/" + topico + "/" + aid + "." + pend.ext,
        file: pend.blob, mime: pend.mime, bytes: pend.bytes, duracao_ms: pend.duracao_ms,
        corpo: (coInp && coInp.value ? coInp.value.trim() : "") || null, url: pend.url
      };
      pl.mencoes = mencoesDoCorpo(pl.corpo || "");
      // limpa o compositor JÁ (2º clique/Enter não reenvia). NÃO revoga a url: a bolha usa.
      coAudioPend = null;
      if (coAudioArea) { coAudioArea.style.display = "none"; coAudioArea.innerHTML = ""; }
      if (coInp) { coInp.value = ""; coInp.style.height = ""; }
      limparMenc(); compErro("");
      var el = msgOtimista(mid, pl.corpo || "", null, pl.url);
      enviarAnexoRPC(pl, el);
    }

    /* ---------- TRANSCRIÇÃO DO ÁUDIO (Sprint 1.8) ---------- */
    // Pinta a linha de transcrição conforme o estado. Nunca deixa indefinido.
    function transcrConteudo(el, status, texto) {
      el.className = "co-transcr";
      if (status === "concluido") { el.classList.add("ok"); el.textContent = texto || ""; }
      else if (status === "erro") { el.classList.add("erro"); el.textContent = "Falha ao transcrever"; }
      else { el.classList.add("proc"); el.innerHTML = '<span class="co-transcr-dot"></span> Transcrevendo…'; } // pendente/processando/null
    }
    // Cria a linha de transcrição de uma mensagem de áudio e, se ainda pendente, a registra
    // pra ser atualizada quando chegar o Broadcast (sem recarregar a conversa).
    function transcrLinha(mid, status, texto) {
      var el = document.createElement("div");
      transcrConteudo(el, status, texto);
      if (status !== "concluido" && status !== "erro") transcrPend[mid] = el;   // acompanhar
      return el;
    }
    // Ao receber o Broadcast: re-checa SÓ as mensagens pendentes na tela e atualiza cada uma.
    function verificarTranscricoes() {
      if (!transcrOn) return;
      var ids = []; for (var k in transcrPend) { if (transcrPend.hasOwnProperty(k)) ids.push(k); }
      if (!ids.length) return;
      var sb = SB(); if (!sb) return;
      sb.rpc("transcricoes", { p_ids: ids }).then(function (r) {
        if (!r || r.error) return;
        var rows = (r.data) || [];
        for (var i = 0; i < rows.length; i++) {
          var row = rows[i], el = transcrPend[row.id];
          if (!el) continue;
          transcrConteudo(el, row.transcricao_status, row.transcricao);
          if (row.transcricao_status === "concluido" || row.transcricao_status === "erro") delete transcrPend[row.id]; // terminou
        }
      }, function () { });
    }

    /* ---------- TRANSFORMAR CONVERSA EM OCORRÊNCIA (Sprint 1.6) ---------- */
    // Pinta o controle no cabeçalho conforme o estado. topico = tópico dono do estado
    // (guarda contra troca de conversa no meio de uma chamada async).
    function renderOcorrencia(estado, topico) {
      if (!coOc || topico !== canalAtual) return;   // só pinta se ainda for a conversa atual
      coOc.innerHTML = "";
      if (estado === "carregando") return;          // silencioso enquanto carrega
      if (estado === "criada") {
        var ind = document.createElement("span"); ind.className = "co-oc-ind";
        ind.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg> Ocorrência criada';
        coOc.appendChild(ind); return;
      }
      if (estado === "criando") {
        var c = document.createElement("span"); c.className = "co-oc-ind cri"; c.textContent = "criando…";
        coOc.appendChild(c); return;
      }
      if (estado === "confirmar") {
        var q = document.createElement("span"); q.className = "co-oc-q"; q.textContent = "Transformar em ocorrência?";
        var sim = document.createElement("button"); sim.type = "button"; sim.className = "co-oc-sim"; sim.textContent = "Confirmar";
        var nao = document.createElement("button"); nao.type = "button"; nao.className = "co-oc-nao"; nao.textContent = "Cancelar";
        sim.addEventListener("click", function () { criarOcorrencia(topico); });
        nao.addEventListener("click", function () { renderOcorrencia("nenhuma", topico); });
        coOc.appendChild(q); coOc.appendChild(sim); coOc.appendChild(nao); return;
      }
      if (estado === "erro") {
        var e = document.createElement("span"); e.className = "co-oc-erro"; e.textContent = "não deu · ";
        var rb = document.createElement("button"); rb.type = "button"; rb.textContent = "tentar de novo";
        rb.addEventListener("click", function () { criarOcorrencia(topico); });
        e.appendChild(rb); coOc.appendChild(e); return;
      }
      // "nenhuma": botão de transformar
      var btn = document.createElement("button"); btn.type = "button"; btn.className = "co-oc-btn";
      btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Transformar em ocorrência';
      btn.addEventListener("click", function () { renderOcorrencia("confirmar", topico); });
      coOc.appendChild(btn);
    }
    // Ao abrir a conversa: descobre se já existe ocorrência (trava o botão) ou não.
    function carregarOcorrencia(topico) {
      renderOcorrencia("carregando", topico);
      var sb = SB(); if (!sb) { renderOcorrencia("nenhuma", topico); return; }
      sb.rpc("ocorrencia_do_topico", { p_topico_id: topico }).then(function (r) {
        if (topico !== canalAtual) return;                 // trocou de conversa
        if (r && r.error) { renderOcorrencia("nenhuma", topico); return; }  // sem permissão/erro: não trava, mas a RPC de criar barra
        renderOcorrencia(r && r.data ? "criada" : "nenhuma", topico);
      }, function () { renderOcorrencia("nenhuma", topico); });
    }
    // Cria (ou reusa, idempotente) a ocorrência da conversa. tópico capturado.
    function criarOcorrencia(topico) {
      var sb = SB(); if (!sb) { renderOcorrencia("erro", topico); return; }
      renderOcorrencia("criando", topico);
      var p;
      try {
        p = sb.rpc("virar_ocorrencia", { p_id: uuidv7(), p_topico_id: topico, p_mensagem_id: null, p_titulo: canalTitTxt || "Ocorrência" });
      } catch (e) { renderOcorrencia("erro", topico); return; }
      p.then(function (r) {
        if (r && r.error) { renderOcorrencia("erro", topico); return; }
        renderOcorrencia("criada", topico);   // servidor devolve a existente se já havia (idempotente)
      }, function () { renderOcorrencia("erro", topico); });
    }

    // ---- PRESENÇA (Sprint 1.13): roster + status ao vivo via Realtime Presence (efêmero) ------
    function carregarParticipantes() {
      var sb = SB(); if (!sb || presCarregou) return;
      presCarregou = true;
      var p;
      try { p = sb.rpc("participantes"); }
      catch (e) { presCarregou = false; return; }
      p.then(function (r) {
        if (r && !r.error && r.data) { presRoster = r.data; renderPresenca(); }
        else presCarregou = false;   // deixa tentar de novo depois
      }, function () { presCarregou = false; });
    }
    // status do usuário: eu = meu status local; os outros = o que a Presença reportou (senão offline)
    function statusDe(id) {
      if (id === (perfil() || {}).id) return meuStatus;
      return (presOnline[id] && presOnline[id].status) || "offline";
    }
    function onPresencaSync() {
      if (!rtCanal || !rtCanal.presenceState) return;
      var st = {}, estado;
      try { estado = rtCanal.presenceState() || {}; } catch (e) { estado = {}; }
      Object.keys(estado).forEach(function (key) {
        var metas = estado[key] || [], status = "idle", nome = null;
        for (var i = 0; i < metas.length; i++) { if (!nome && metas[i].nome) nome = metas[i].nome; if ((metas[i].status || "online") === "online") status = "online"; }
        // a chave da presença é o user_id; se vier no meta, prioriza. Guarda o nome p/ fallback.
        var uid = (metas[0] && metas[0].user_id) || key;
        st[uid] = { status: status, nome: nome };
      });
      presOnline = st;
      renderPresenca();
    }
    function renderPresenca() {
      if (!presLista) return;
      var eu = perfil() || {}, ord = { online: 0, idle: 1, offline: 2 };
      // base = roster (participantes); + qualquer presente que não esteja no roster (fallback se a RPC falhou)
      var lista = presRoster.slice(), vistos = {};
      for (var r = 0; r < lista.length; r++) vistos[lista[r].id] = true;
      Object.keys(presOnline).forEach(function (uid) {
        if (!vistos[uid]) { lista.push({ id: uid, nome: (presOnline[uid] && presOnline[uid].nome) || "Alguém", setor: null }); vistos[uid] = true; }
      });
      lista.sort(function (a, b) {
        var da = ord[statusDe(a.id)], db = ord[statusDe(b.id)];
        if (da !== db) return da - db;
        return String(a.nome || "").localeCompare(String(b.nome || ""));
      });
      var h = "";
      for (var i = 0; i < lista.length; i++) {
        var u = lista[i], s = statusDe(u.id);
        var rot = s === "online" ? "Online" : (s === "idle" ? "Ausente" : "Offline");
        h += '<div class="co-pessoa' + (s === "offline" ? " off" : "") + '" title="' + esc(rot) + '">' +
             '<span class="co-dot ' + (s === "offline" ? "" : s) + '"></span>' +
             esc(u.nome || "—") + (u.id === eu.id ? " (você)" : "") + "</div>";
      }
      presLista.innerHTML = h;
    }
    function rastrear() {   // publica minha presença (idempotente; re-chamável na reconexão)
      if (!rtCanal || !rtCanal.track) return;
      var me = perfil() || {};
      try { rtCanal.track({ user_id: me.id, nome: me.nome, status: meuStatus }); } catch (e) { }
    }
    // atividade do usuário: volta a "online" e reprograma o timer de "ausente".
    // Coalesce: se já estou online e houve atividade há <ACT_MS, não re-armo o timer (evita
    // clearTimeout/setTimeout a cada mousemove). Voltar de "ausente" sempre processa na hora.
    function marcarAtividade() {
      var agora = nowMs();
      if (meuStatus === "online" && (agora - ultAtiv) < ACT_MS()) return;
      ultAtiv = agora;
      if (meuStatus !== "online") { meuStatus = "online"; rastrear(); renderPresenca(); }
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(function () { meuStatus = "idle"; rastrear(); renderPresenca(); }, IDLE_MS());
    }

    // ---- "DIGITANDO…" (Sprint 1.13): Broadcast efêmero no MESMO canal --------------------------
    function enviarDigit(ativo) {   // avisa os outros (nunca grava nada)
      if (!rtCanal || !rtCanal.send || !canalAtual) return;
      var me = perfil() || {};
      try { rtCanal.send({ type: "broadcast", event: "digitando", payload: { topico: canalAtual, autor: me.id, nome: me.nome, ativo: !!ativo } }); } catch (e) { }
    }
    function sinalizarDigitando() {   // chamado no input; throttle + agenda o "parou"
      if (!canalAtual) return;
      if (meuStopTimer) clearTimeout(meuStopTimer);
      meuStopTimer = setTimeout(function () { enviarDigit(false); ultTyping = 0; }, TYP_TTL());
      var agora = nowMs();
      if (agora - ultTyping < TYP_THR()) return;   // no máximo 1 aviso a cada TYP_THR ms
      ultTyping = agora;
      enviarDigit(true);
    }
    function pararDigitar() {   // no envio / troca de conversa: some IMEDIATO nos outros
      if (meuStopTimer) { clearTimeout(meuStopTimer); meuStopTimer = null; }
      ultTyping = 0;
      enviarDigit(false);
    }
    function nowMs() { return (window.Date && Date.now) ? Date.now() : +new Date(); }
    function onDigitando(msg) {
      var p = (msg && msg.payload) || {}, eu = (perfil() || {}).id;
      if (!p.autor || p.autor === eu) return;        // NUNCA para o próprio usuário
      if (p.topico !== canalAtual) return;           // só a conversa aberta
      if (p.ativo === false) { limparDigit(p.autor); return; }
      if (digitBy[p.autor] && digitBy[p.autor].timer) clearTimeout(digitBy[p.autor].timer);
      digitBy[p.autor] = { nome: p.nome || "Alguém", timer: setTimeout(function () { limparDigit(p.autor); }, TYP_TTL()) };
      renderTyping();
    }
    function limparDigit(autor) {
      if (!digitBy[autor]) return;
      if (digitBy[autor].timer) clearTimeout(digitBy[autor].timer);
      delete digitBy[autor];
      renderTyping();
    }
    function limparTodosDigit() {
      var ks = Object.keys(digitBy);
      for (var i = 0; i < ks.length; i++) if (digitBy[ks[i]].timer) clearTimeout(digitBy[ks[i]].timer);
      digitBy = {};
      renderTyping();
    }
    function renderTyping() {
      if (!digitEl) return;
      var nomes = Object.keys(digitBy).map(function (a) { return digitBy[a].nome; });
      var txt = "";
      if (nomes.length === 1) txt = esc(nomes[0]) + " está digitando…";
      else if (nomes.length === 2) txt = esc(nomes[0]) + " e " + esc(nomes[1]) + " estão digitando…";
      else if (nomes.length > 2) txt = "Várias pessoas estão digitando…";
      digitEl.innerHTML = txt;
    }

    /* ============================================================
       (2.0) TRABALHO — Work Items. O item é o centro; a conversa vira contexto dele.
       A tela é montada sob demanda (ao lado do feedView) para não reescrever o montarUI.
       ============================================================ */
    var trabView = null, wiListaEl = null, wiStatusEl = null, wiMaisBtn = null, wiNavBtn = null;

    function wiReqId() { try { return uuidv7(); } catch (e) { return null; } }

    function wiGarantirView() {
      if (trabView || !feedView || !feedView.parentNode) return trabView;
      trabView = document.createElement("div");
      trabView.className = "co-trab";
      trabView.style.display = "none";
      trabView.innerHTML =
        '<div class="co-head"><div><b style="font-size:16px;">Trabalho</b>' +
        '<div class="co-sub">Ocorrências e tarefas da operação.</div></div>' +
        '<div style="display:flex;gap:8px;align-items:center;">' +
        '<div class="kb-vista" role="tablist" aria-label="Visualização">' +
        '<button type="button" data-kbvista="lista" class="on">Lista</button>' +
        '<button type="button" data-kbvista="kanban">Kanban</button>' +
        '<button type="button" data-kbvista="dashboard">Painel</button></div>' +
        '<button type="button" class="wi-novo" data-winovo>Novo</button></div></div>' +
        '<div class="wi-abas">' +
        '<button type="button" class="wi-aba on" data-wiaba="meus">Meus</button>' +
        '<button type="button" class="wi-aba" data-wiaba="abertos">Abertos</button>' +
        '<button type="button" class="wi-aba" data-wiaba="todos">Todos</button></div>' +
        '<div class="wi-filtros" data-wifiltros>' +
        '<select data-wif="status"><option value="">Status: todos</option>' +
        '<option value="aberto">Aberto</option><option value="em_andamento">Em andamento</option>' +
        '<option value="bloqueado">Bloqueado</option><option value="concluido">Concluído</option>' +
        '<option value="cancelado">Cancelado</option></select>' +
        '<select data-wif="prioridade"><option value="">Prioridade: todas</option>' +
        '<option value="urgente">Urgente</option><option value="alta">Alta</option>' +
        '<option value="normal">Normal</option><option value="baixa">Baixa</option></select>' +
        '<select data-wif="tipo"><option value="">Tipo: todos</option>' +
        '<option value="ocorrencia">Ocorrência</option><option value="tarefa">Tarefa</option></select>' +
        "</div>" +
        '<div class="wi-lista" data-wilista></div>' +
        '<div class="copf-status" data-wistatus></div>' +
        '<div style="text-align:center;margin-top:12px;"><button type="button" class="copf-mais" data-wimais style="display:none;">Carregar mais</button></div>';
      feedView.parentNode.insertBefore(trabView, feedView.nextSibling);
      wiListaEl = trabView.querySelector("[data-wilista]");
      wiStatusEl = trabView.querySelector("[data-wistatus]");
      wiMaisBtn = trabView.querySelector("[data-wimais]");

      trabView.addEventListener("click", function (e) {
        var t = e.target;
        var aba = t.closest ? t.closest("[data-wiaba]") : null;
        if (aba) {
          var ab = aba.getAttribute("data-wiaba");
          if (ab === wiAba) return;
          wiAba = ab;
          var bs = trabView.querySelectorAll("[data-wiaba]");
          for (var i = 0; i < bs.length; i++) bs[i].classList.toggle("on", bs[i] === aba);
          carregarWi(true); return;
        }
        var vb = t.closest ? t.closest("[data-kbvista]") : null;
        if (vb) { kbSoAtivos = false; kbMostrar(vb.getAttribute("data-kbvista")); return; }   // Kanban aberto pelo alternador = todas as colunas
        if (t.closest && t.closest("[data-winovo]")) { wiAbrirForm(); return; }
        if (t.closest && t.closest("[data-wimais]")) { carregarWi(false); return; }
        var card = t.closest ? t.closest("[data-wiid]") : null;
        if (card) { abrirItem(card.getAttribute("data-wiid")); return; }
      });
      trabView.addEventListener("change", function (e) {
        var s = e.target && e.target.getAttribute && e.target.getAttribute("data-wif");
        if (!s) return;
        if (s === "status") wiFStatus = e.target.value;
        else if (s === "prioridade") wiFPrio = e.target.value;
        else if (s === "tipo") wiFTipo = e.target.value;
        carregarWi(true);
      });
      return trabView;
    }

    function wiSetStatus(txt) { if (wiStatusEl) wiStatusEl.innerHTML = txt || ""; }

    function mostrarTrabalho() {
      pararDigitar(); limparTodosDigit();
      viewAtual = "trabalho"; canalAtual = null; itemAtual = null;
      wiFormAberto = false; ++wiGen; ++itemGen;   // invalida página/detalhe em voo
      wiGarantirView();
      if (feedView) feedView.style.display = "none";
      if (canalView) canalView.style.display = "none";
      if (trabView) trabView.style.display = "";
      marcarAtivo(null);
      if (wiNavBtn) wiNavBtn.classList.add("on");
      renderNaoLidas();
      try { kbVista = localStorage.getItem("co_trab_vista") || "lista"; } catch (e) { kbVista = "lista"; }
      kbMostrar(kbVista);        // (2.1) Lista continua sendo o padrão; Kanban é opcional
    }

    // Filtros -> argumentos da RPC. "Meus" e "Abertos" são atalhos de filtro, não modos.
    function wiArgs() {
      var me = (perfil() || {}).id || null;
      return {
        p_status: wiFStatus || null,
        // "Abertos" filtra NO SERVIDOR. Filtrar no cliente descartava a página inteira
        // (concluir bumpa o updated_at, então os concluídos ficam no topo) e a tela dizia
        // "Nada por aqui" sem botão de continuar — trabalho pendente sumia da vista.
        p_status_in: (wiAba === "abertos" && !wiFStatus) ? ["aberto", "em_andamento", "bloqueado"] : null,
        p_responsavel_id: wiAba === "meus" ? me : null,
        p_prioridade: wiFPrio || null,
        p_tipo: wiFTipo || null,
        p_cursor_at: null, p_cursor_id: null, p_limite: 30
      };
    }

    function carregarWi(reset) {
      var sb = SB(); if (!sb || !wiListaEl) return;
      if (!reset && wiCarregando) return;
      wiCarregando = true;
      var g = ++wiGen;
      if (reset) {
        wiMapa = {}; wiOrdem = []; wiCursorAt = null; wiCursorId = null; wiTemMais = true;
        wiListaEl.innerHTML = ""; wiSetStatus('<div class="copf-skel"></div><div class="copf-skel"></div>');
      }
      var a = wiArgs();
      a.p_cursor_at = reset ? null : wiCursorAt;
      a.p_cursor_id = reset ? null : wiCursorId;
      medirRpc("work_items_pagina", sb.rpc("work_items_pagina", a)).then(function (r) {
        wiCarregando = false;
        if (g !== wiGen) return;                       // troquei de aba/filtro no meio: descarto
        if (!r || r.error) { wiSetStatus('<b>Não consegui carregar.</b><br><button class="copf-erro-btn" type="button" onclick="void 0">Tente reabrir a Central.</button>'); return; }
        var linhas = (r.data) || [];   // (o agrupamento de "Abertos" agora vem filtrado do servidor)
        for (var i = 0; i < linhas.length; i++) {
          var w = linhas[i];
          if (!wiMapa[w.id]) wiOrdem.push(w.id);       // dedup por id (updated_at é mutável)
          wiMapa[w.id] = w;
        }
        var brutas = (r.data) || [];
        if (brutas.length) {
          var ult = brutas[brutas.length - 1];
          wiCursorAt = ult.atualizado_em; wiCursorId = ult.id;
        }
        wiTemMais = brutas.length >= 30;
        renderWiLista();
      }, function () {
        wiCarregando = false;
        if (g === wiGen) wiSetStatus("<b>Não consegui carregar.</b>");
      });
    }

    function wiChip(cls, txt) { return '<span class="wi-chip ' + cls + '">' + esc(txt) + "</span>"; }

    function wiCard(w) {
      var d = document.createElement("div");
      d.className = "wi-card" + (w.atrasado ? " atrasado" : "");
      d.setAttribute("data-wiid", w.id);
      var prazo = w.prazo_em ? (w.atrasado ? '<span class="wi-atraso">Atrasado · ' + esc(tempoRel(w.prazo_em)) + "</span>"
                                           : "Prazo " + esc(tempoRel(w.prazo_em))) : "";
      d.innerHTML =
        '<div class="wi-top"><span class="wi-tipo">' + (w.tipo === "tarefa" ? "Tarefa" : "Ocorrência") + "</span>" +
        '<span class="wi-tit">' + esc(w.titulo || "(sem título)") + "</span>" +
        wiChip("wi-st-" + w.status, WI_STATUS_LBL[w.status] || w.status) + "</div>" +
        '<div class="wi-meta">' +
        wiChip("wi-pr-" + w.prioridade, w.prioridade) +
        (w.responsavel_nome ? "<span>" + esc(w.responsavel_nome) + "</span>" : '<span style="color:#b3bcc4;">sem responsável</span>') +
        (prazo ? "<span>" + prazo + "</span>" : "") +
        (w.topico_id ? '<span title="tem conversa ligada">💬</span>' : "") +
        (w.vinculos ? "<span>" + w.vinculos + " contexto(s)</span>" : "") +
        "</div>";
      return d;
    }

    function renderWiLista() {
      if (!wiListaEl) return;
      if (wiFormAberto || itemAtual) return;   // formulário/detalhe na tela: não repinta a lista
      wiListaEl.innerHTML = "";
      for (var i = 0; i < wiOrdem.length; i++) {
        var w = wiMapa[wiOrdem[i]];
        if (w) wiListaEl.appendChild(wiCard(w));
      }
      wiSetStatus(wiOrdem.length ? "" : "<b>Nada por aqui.</b><br>Use o botão <b>Novo</b> para criar a primeira ocorrência ou tarefa.");
      if (wiMaisBtn) wiMaisBtn.style.display = wiTemMais && wiOrdem.length ? "" : "none";
    }

    /* ---------- DETALHE ---------- */
    function abrirItem(id) {
      var sb = SB(); if (!sb || !id) return;
      itemAtual = id;
      wiFormAberto = false;
      // (2.1) detalhe/formulário vivem dentro de wiListaEl. No Kanban ele está display:none,
      // então sem isto o clique no card não mostrava NADA (nem botão de voltar).
      if (kbEl) kbEl.style.display = "none";
      if (dbEl) dbEl.style.display = "none";
      kbFecharPop();
      if (wiListaEl) wiListaEl.style.display = "";
      if (wiMaisBtn && wiMaisBtn.parentNode) wiMaisBtn.parentNode.style.display = "none";
      ++wiGen;                       // uma página da lista em voo não pode repintar por cima
      var g = ++itemGen;
      wiGarantirView();
      if (trabView) trabView.style.display = "";
      if (feedView) feedView.style.display = "none";
      if (canalView) canalView.style.display = "none";
      viewAtual = "item";
      if (wiListaEl) wiListaEl.innerHTML = "";
      wiSetStatus('<div class="copf-skel"></div><div class="copf-skel"></div>');
      if (wiMaisBtn) wiMaisBtn.style.display = "none";
      medirRpc("work_item_detalhe", sb.rpc("work_item_detalhe", { p_work_item_id: id })).then(function (r) {
        if (g !== itemGen) return;                     // abri outro item no meio do caminho
        var d = (r && r.data && r.data[0]) || null;
        if (!d) { wiSetStatus("<b>Item não encontrado</b> (ou você não tem acesso a ele)."); return; }
        renderItem(d);
      }, function () { if (g === itemGen) wiSetStatus("<b>Não consegui abrir o item.</b>"); });
    }

    function renderItem(d) {
      if (!wiListaEl) return;
      wiSetStatus("");
      var me = (perfil() || {}).id;
      var trans = WI_TRANSICOES[d.status] || [];
      var box = document.createElement("div");
      var ctx = [];
      try { ctx = typeof d.vinculos === "string" ? JSON.parse(d.vinculos) : (d.vinculos || []); } catch (e) { ctx = []; }

      var acoes = '<button type="button" class="wi-btn" data-wivoltar>← Trabalho</button>';
      if (d.responsavel_id !== me) acoes += '<button type="button" class="wi-btn" data-wiassumir>Assumir para mim</button>';
      for (var i = 0; i < trans.length; i++) {
        var s = trans[i];
        acoes += '<button type="button" class="wi-btn' + (s === "em_andamento" || s === "concluido" ? " pri" : "") +
                 '" data-witrans="' + s + '">' +
                 (s === "em_andamento" ? "Iniciar" : s === "concluido" ? "Concluir" : s === "bloqueado" ? "Bloquear" :
                  s === "cancelado" ? "Cancelar" : s === "aberto" ? "Reabrir" : s) + "</button>";
      }

      var ctxHtml = "";
      for (var k = 0; k < ctx.length; k++) {
        var c = ctx[k];
        ctxHtml += '<div class="wi-ctx-it"><b>' + esc(ENT_ROTULO[c.tipo] || c.tipo) + "</b><span>" + esc(c.id) + "</span>" +
                   (c.papel === "derivado_de" ? '<span style="color:#9aa6ae;font-size:12px;margin-left:6px;">origem</span>'
                     : '<button type="button" class="wi-ctx-x" data-widesv="' + esc(c.tipo) + "|" + esc(c.id) + "|" + esc(c.papel) + '" title="remover">✕</button>') +
                   "</div>";
      }
      if (!ctxHtml) ctxHtml = '<div style="color:#9aa6ae;font-size:13px;">Nenhum contexto ligado ainda.</div>';

      box.innerHTML =
        '<div class="co-head"><div>' +
        '<span class="wi-tipo">' + (d.tipo === "tarefa" ? "Tarefa" : "Ocorrência") + "</span>" +
        '<div style="font-size:17px;font-weight:650;color:#26313a;margin-top:3px;">' + esc(d.titulo || "") + "</div>" +
        '<div class="wi-meta" style="margin-top:7px;">' +
        wiChip("wi-st-" + d.status, WI_STATUS_LBL[d.status] || d.status) +
        wiChip("wi-pr-" + d.prioridade, d.prioridade) +
        (d.responsavel_nome ? "<span>" + esc(d.responsavel_nome) + "</span>" : '<span style="color:#b3bcc4;">sem responsável</span>') +
        (d.prazo_em ? (d.atrasado ? '<span class="wi-atraso">Atrasado · ' + esc(tempoRel(d.prazo_em)) + "</span>" : "<span>Prazo " + esc(tempoRel(d.prazo_em)) + "</span>") : "") +
        "</div></div></div>" +
        '<div class="wi-det-sec"><div class="wi-acoes">' + acoes + "</div></div>" +
        (d.descricao ? '<div class="wi-det-sec"><div class="wi-det-lbl">Descrição</div><div style="white-space:pre-wrap;color:#3c4750;font-size:14px;">' + esc(d.descricao) + "</div></div>" : "") +
        '<div class="wi-det-sec"><div class="wi-det-lbl">Contexto</div><div class="wi-ctx">' + ctxHtml + "</div>" +
        '<div style="margin-top:8px;"><button type="button" class="wi-btn" data-wiaddctx>+ Adicionar contexto</button></div></div>' +
        '<div class="wi-det-sec"><div class="wi-det-lbl">Conversa</div>' +
        (d.topico_id ? '<button type="button" class="wi-btn" data-wiconversa="' + esc(d.topico_id) + '">Abrir a conversa ligada</button>'
                     : '<div style="color:#9aa6ae;font-size:13px;">Este item não tem conversa ligada.</div>') + "</div>" +
        '<div data-wictxform style="margin-top:10px;"></div>';
      wiListaEl.appendChild(box);
      wiLigarDetalhe(box, d);
    }

    function wiLigarDetalhe(box, d) {
      box.addEventListener("click", function (e) {
        var t = e.target;
        if (t.closest && t.closest("[data-wivoltar]")) { mostrarTrabalho(); return; }
        if (t.closest && t.closest("[data-wiassumir]")) { wiEscrever("atualizar_work_item", { p_work_item_id: d.id, p_responsavel_id: (perfil() || {}).id }, d.id); return; }
        var tr = t.closest ? t.closest("[data-witrans]") : null;
        if (tr) {
          var novo = tr.getAttribute("data-witrans");
          if (novo === "cancelado" || novo === "concluido") {
            if (!window.confirm(novo === "concluido" ? "Concluir este item?" : "Cancelar este item?")) return;
          }
          wiEscrever("transicionar_work_item", { p_work_item_id: d.id, p_novo_status: novo }, d.id); return;
        }
        var dv = t.closest ? t.closest("[data-widesv]") : null;
        if (dv) {
          var p = String(dv.getAttribute("data-widesv")).split("|");
          wiEscrever("desvincular_work_item", { p_work_item_id: d.id, p_entidade_tipo: p[0], p_entidade_id: p[1], p_relacao: p[2] }, d.id); return;
        }
        var cv = t.closest ? t.closest("[data-wiconversa]") : null;
        if (cv) { wiIrConversa(cv.getAttribute("data-wiconversa")); return; }
        if (t.closest && t.closest("[data-wiaddctx]")) { wiFormContexto(box, d.id); return; }
      });
    }

    // Abre a conversa ligada reusando 100% o motor de mensagens que já existe (1.2→1.14).
    function wiIrConversa(topicoId) {
      var sb = SB(); if (!sb || !topicoId) return;
      medirRpc("listar_topicos", sb.rpc("listar_topicos")).then(function (r) {
        var ts = (r && r.data) || [], alvo = null;
        for (var i = 0; i < ts.length; i++) if (ts[i].id === topicoId) alvo = ts[i];
        abrirCanal(alvo || { id: topicoId, titulo: "Conversa", tipo: "canal" });
      }, function () { abrirCanal({ id: topicoId, titulo: "Conversa", tipo: "canal" }); });
    }

    // Escrita genérica. O request_id é cunhado UMA vez por INTENÇÃO e reusado enquanto ela
    // não der certo — senão a idempotência do servidor era inerte: cada tentativa levava um
    // id novo e o retry criava uma segunda tarefa/transição. A chave inclui a operação e os
    // argumentos, então o mesmo id nunca é reaproveitado para uma operação diferente
    // (o servidor devolveria "sucesso" de outra coisa).
    var wiReqCache = {};
    function wiEscrever(rpc, args, id) {
      var sb = SB(); if (!sb) return;
      var chave;
      try { chave = rpc + "|" + id + "|" + JSON.stringify(args); } catch (e) { chave = rpc + "|" + id; }
      var req = wiReqCache[chave] || wiReqId(); if (!req) return;
      wiReqCache[chave] = req;
      args.p_request_id = req;
      comTimeout(medirRpc(rpc, sb.rpc(rpc, args)), 30000).then(function (r) {
        if (r && r.error) { wiAvisar(r.error.message || "Não deu pra salvar."); return; }   // mantém o id p/ o retry
        delete wiReqCache[chave];                                                            // deu certo: intenção encerrada
        if (itemAtual === id) abrirItem(id); else wiAtualizarUm(id);
      }, function () { wiAvisar("Não deu pra salvar. Tente de novo."); });
    }

    function wiAvisar(msg) {
      if (!wiStatusEl) return;
      wiStatusEl.innerHTML = '<div class="wi-erro">' + esc(msg) + "</div>";
      setTimeout(function () { if (wiStatusEl && wiStatusEl.querySelector(".wi-erro")) wiStatusEl.innerHTML = ""; }, 4000);
    }

    // Atualiza SOMENTE o card afetado (tempo real e pós-escrita) — nunca recarrega a lista.
    function wiAtualizarUm(id) {
      var sb = SB(); if (!sb || !id) return;
      medirRpc("work_items_por_ids", sb.rpc("work_items_por_ids", { p_ids: [id] })).then(function (r) {
        var w = (r && r.data && r.data[0]) || null;
        if (!w) {                                   // sumiu do meu alcance: tira da lista
          if (wiMapa[id]) { delete wiMapa[id]; wiOrdem = wiOrdem.filter(function (x) { return x !== id; }); if (viewAtual === "trabalho" && !wiFormAberto && !itemAtual) renderWiLista(); }
          return;
        }
        var jaTinha = !!wiMapa[id];
        wiMapa[id] = w;
        if (!jaTinha) { wiOrdem.unshift(id); }       // entrou no filtro atual
        if (viewAtual === "trabalho" && !wiFormAberto && !itemAtual) renderWiLista();
      }, function () { });
    }

    /* ---------- CRIAR ---------- */
    function wiAbrirForm() {
      wiGarantirView();
      viewAtual = "trabalho"; itemAtual = null;
      if (kbEl) kbEl.style.display = "none";          // (2.1) idem para o formulário "Novo"
      if (dbEl) dbEl.style.display = "none";
      kbFecharPop();
      if (wiListaEl) wiListaEl.style.display = "";
      wiFormAberto = true; ++wiGen; ++itemGen;   // nada em voo pode apagar o formulário
      if (!wiListaEl) return;
      wiSetStatus(""); if (wiMaisBtn) wiMaisBtn.style.display = "none";
      wiListaEl.innerHTML = "";
      var f = document.createElement("div");
      f.className = "wi-form";
      f.innerHTML =
        '<div class="wi-row"><div><label>Tipo</label><select data-wnew="tipo">' +
        '<option value="tarefa">Tarefa</option><option value="ocorrencia">Ocorrência</option></select></div>' +
        '<div><label>Prioridade</label><select data-wnew="prioridade">' +
        '<option value="normal">Normal</option><option value="baixa">Baixa</option>' +
        '<option value="alta">Alta</option><option value="urgente">Urgente</option></select></div></div>' +
        '<div><label>Título</label><input data-wnew="titulo" maxlength="180" placeholder="O que precisa ser feito?"></div>' +
        '<div><label>Descrição (opcional)</label><textarea data-wnew="descricao" maxlength="2000"></textarea></div>' +
        '<div class="wi-row"><div><label>Responsável (opcional)</label><select data-wnew="responsavel"><option value="">— ninguém —</option></select></div>' +
        '<div><label>Prazo (opcional)</label><input type="date" data-wnew="prazo"></div></div>' +
        '<div class="wi-acoes" style="margin-top:4px;">' +
        '<button type="button" class="wi-btn pri" data-wsalvar>Criar</button>' +
        '<button type="button" class="wi-btn" data-wcancelar>Cancelar</button></div>' +
        '<div data-wnewerro></div>';
      wiListaEl.appendChild(f);
      // popula responsáveis com o roster que a 1.13 já expõe
      var sb = SB();
      if (sb) medirRpc("participantes", sb.rpc("participantes")).then(function (r) {
        var ps = (r && r.data) || [], sel = f.querySelector('[data-wnew="responsavel"]');
        if (!sel) return;
        for (var i = 0; i < ps.length; i++) {
          var o = document.createElement("option"); o.value = ps[i].id; o.textContent = ps[i].nome || "?";
          sel.appendChild(o);
        }
      }, function () { });
      f.addEventListener("click", function (e) {
        if (e.target.closest && e.target.closest("[data-wcancelar]")) { mostrarTrabalho(); return; }
        if (e.target.closest && e.target.closest("[data-wsalvar]")) wiSalvarNovo(f);
      });
    }

    function wiSalvarNovo(f) {
      var sb = SB(); if (!sb) return;
      function v(n) { var el = f.querySelector('[data-wnew="' + n + '"]'); return el ? String(el.value || "").trim() : ""; }
      var erroEl = f.querySelector("[data-wnewerro]");
      var tit = v("titulo");
      if (!tit) { if (erroEl) erroEl.innerHTML = '<div class="wi-erro">Escreva um título.</div>'; return; }
      // request_id preso ao FORMULÁRIO: se o envio falhar e a pessoa clicar de novo, é a
      // MESMA intenção — o servidor devolve o mesmo item em vez de criar um segundo.
      var req = f._wiReq || wiReqId(); if (!req) return;
      f._wiReq = req;
      var btn = f.querySelector("[data-wsalvar]"); if (btn) btn.disabled = true;
      var prazo = v("prazo");
      var args = {
        p_request_id: req, p_tipo: v("tipo") || "tarefa", p_titulo: tit,
        p_descricao: v("descricao") || null, p_prioridade: v("prioridade") || "normal",
        p_responsavel_id: v("responsavel") || null,
        p_prazo_em: prazo ? new Date(prazo + "T12:00:00").toISOString() : null,
        p_topico_id: null, p_setor: null
      };
      comTimeout(medirRpc("criar_work_item", sb.rpc("criar_work_item", args)), 30000).then(function (r) {
        if (btn) btn.disabled = false;
        if (!r || r.error) { if (erroEl) erroEl.innerHTML = '<div class="wi-erro">' + esc((r && r.error && r.error.message) || "Não deu pra criar.") + "</div>"; return; }
        var novoId = r.data;
        f._wiReq = null;                     // intenção concluída
        wiFormAberto = false;
        mostrarTrabalho();
        if (novoId) abrirItem(novoId);       // 2 toques: criar -> já cai no item
      }, function () {
        if (btn) btn.disabled = false;
        if (erroEl) erroEl.innerHTML = '<div class="wi-erro">Não deu pra criar. Tente de novo.</div>';
      });
    }

    /* ---------- ADICIONAR CONTEXTO (2 toques: escolher tipo -> escolher item) ---------- */
    function wiFormContexto(box, id) {
      var alvo = box.querySelector("[data-wictxform]"); if (!alvo) return;
      if (alvo.innerHTML) { alvo.innerHTML = ""; return; }     // toggle
      alvo.innerHTML =
        '<div class="wi-form" style="max-width:420px;">' +
        '<div class="wi-row"><div><label>Tipo</label><select data-wctipo>' +
        '<option value="estoque_produtos">Produto</option>' +
        '<option value="central_agendamentos">Recebimento</option>' +
        '<option value="manutencao_equipamentos">Equipamento</option></select></div>' +
        '<div><label>Buscar</label><input data-wcbusca placeholder="digite para buscar…"></div></div>' +
        '<div data-wcres class="wi-ctx"></div></div>';
      var sel = alvo.querySelector("[data-wctipo]"), inp = alvo.querySelector("[data-wcbusca]"), res = alvo.querySelector("[data-wcres]");
      var tmr = null;
      function buscar() {
        var sb = SB(); if (!sb) return;
        var q = String(inp.value || "").trim();
        if (q.length < 2) { res.innerHTML = '<div style="color:#9aa6ae;font-size:13px;">Digite ao menos 2 letras.</div>'; return; }
        medirRpc("entidades_vinculaveis", sb.rpc("entidades_vinculaveis", { p_tipo: sel.value, p_busca: q })).then(function (r) {
          var ls = (r && r.data) || [];
          if (!ls.length) { res.innerHTML = '<div style="color:#9aa6ae;font-size:13px;">Nada encontrado.</div>'; return; }
          var h = "";
          for (var i = 0; i < ls.length; i++) {
            h += '<div class="wi-ctx-it" style="cursor:pointer;" data-wcpick="' + esc(ls[i].id) + '"><b>' + esc(ls[i].titulo || "?") +
                 '</b><span style="color:#9aa6ae;">' + esc(ls[i].subtitulo || "") + "</span></div>";
          }
          res.innerHTML = h;
        }, function () { res.innerHTML = '<div class="wi-erro">Erro na busca.</div>'; });
      }
      inp.addEventListener("input", function () { if (tmr) clearTimeout(tmr); tmr = setTimeout(buscar, 250); });
      sel.addEventListener("change", buscar);
      res.addEventListener("click", function (e) {
        var p = e.target.closest ? e.target.closest("[data-wcpick]") : null;
        if (!p) return;
        wiEscrever("vincular_work_item", { p_work_item_id: id, p_entidade_tipo: sel.value,
                                           p_entidade_id: p.getAttribute("data-wcpick"), p_relacao: "relacionado_a" }, id);
      });
    }

    /* ============================================================
       (2.1) KANBAN — visualização por status dos MESMOS work_items da 2.0.
       Sem modelo novo, sem RPC de escrita nova: mover card = transicionar_work_item.
       Cada coluna tem cursor/estado PRÓPRIOS (uma coluna pode ter 3 itens e outra milhares).
       ============================================================ */
    var KB_COLS = ["aberto", "em_andamento", "bloqueado", "concluido"];
    var kbVista = "lista";                 // lista | kanban
    var kbMobCol = "aberto";               // no celular, uma coluna por vez
    var kbEstado = {};                     // status -> {itens,ordem,cur,temMais,carregando,gen,scroll}
    var kbFiltro = { resp: "todos", prio: "", tipo: "", prazo: "" };
    var kbCont = {};                       // contadores autoritativos do servidor
    var kbEmVoo = {};                      // work_item_id -> true (trava clique repetido)
    var kbEl = null, kbPop = null;

    function kbZerar(st) {
      kbEstado[st] = { itens: {}, ordem: [], cur: null, temMais: true, carregando: false, gen: 0, scroll: 0 };
    }
    KB_COLS.forEach(kbZerar);

    function kbArgs() {
      var me = (perfil() || {}).id || null;
      return {
        p_responsavel_id: kbFiltro.resp === "meus" ? me : (kbFiltro.resp !== "todos" && kbFiltro.resp !== "sem" ? kbFiltro.resp : null),
        p_sem_responsavel: kbFiltro.resp === "sem",
        p_prioridade: kbFiltro.prio || null,
        p_tipo: kbFiltro.tipo || null,
        p_prazo: kbFiltro.prazo || null
      };
    }

    function kbCarregarCol(st, reset) {
      var sb = SB(); if (!sb || !kbEstado[st]) return;
      var e = kbEstado[st];
      if (!reset && (e.carregando || !e.temMais)) return;
      e.carregando = true;
      var g = ++e.gen;                      // resposta velha de filtro antigo não entra
      if (reset) { e.itens = {}; e.ordem = []; e.cur = null; e.temMais = true; }
      var a = kbArgs();
      a.p_status = st; a.p_limite = 20;
      a.p_cursor_pri = e.cur ? e.cur.pri : null;
      a.p_cursor_prazo = e.cur ? e.cur.prazo : null;
      a.p_cursor_at = e.cur ? e.cur.at : null;
      a.p_cursor_id = e.cur ? e.cur.id : null;
      medirRpc("kanban_coluna", sb.rpc("kanban_coluna", a)).then(function (r) {
        if (g !== e.gen) return;            // filtro mudou no meio do caminho
        e.carregando = false;
        if (!r || r.error) { e.temMais = false; kbRenderCol(st); return; }
        var ls = (r.data) || [], i;
        for (i = 0; i < ls.length; i++) {
          if (!e.itens[ls[i].id]) e.ordem.push(ls[i].id);   // dedup por id
          e.itens[ls[i].id] = ls[i];
        }
        if (ls.length) {
          var u = ls[ls.length - 1];
          e.cur = { pri: u.pri_rank, prazo: u.prazo_ord, at: (st === "concluido" ? u.concluido_em : u.atualizado_em), id: u.id };
        }
        e.temMais = ls.length >= 20;
        kbRenderCol(st);
      }, function () { if (g === e.gen) { e.carregando = false; e.temMais = false; kbRenderCol(st); } });
    }

    var kbCntGen = 0;
    function kbContadores() {
      var sb = SB(); if (!sb) return;
      var g = ++kbCntGen;
      medirRpc("kanban_contadores", sb.rpc("kanban_contadores", kbArgs())).then(function (r) {
        if (g !== kbCntGen) return;              // resposta do filtro ANTERIOR: descarta
        if (!r || r.error || !r.data) return;    // erro: número velho é melhor que branco
        var ls = r.data;
        kbCont = {};
        for (var i = 0; i < (ls.length || 0); i++) kbCont[ls[i].status] = ls[i].quantidade;
        kbPintarContadores();
      }, function () { });
    }

    function kbPintarContadores() {
      if (!kbEl) return;
      KB_COLS.concat(["cancelado"]).forEach(function (st) {
        var n = kbCont[st], txt = (n == null) ? "" : (n >= 100 ? "99+" : String(n));
        var alvos = kbEl.querySelectorAll('[data-kbcnt="' + st + '"]');
        for (var i = 0; i < alvos.length; i++) alvos[i].textContent = txt;
      });
    }

    var KB_LBL = { aberto: "Aberto", em_andamento: "Em andamento", bloqueado: "Bloqueado", concluido: "Concluído" };
    var KB_ACAO_LBL = { em_andamento: "Iniciar", bloqueado: "Bloquear", concluido: "Concluir", cancelado: "Cancelar", aberto: "Reabrir" };

    function kbCard(w) {
      var me = (perfil() || {}).id;
      var d = document.createElement("div");
      d.className = "kb-card" + (w.atrasado ? " atrasado" : "") + (w.responsavel_id && w.responsavel_id === me ? " meu" : "");
      d.setAttribute("data-kbid", w.id);
      d.setAttribute("tabindex", "0");
      d.setAttribute("role", "button");
      d.setAttribute("aria-label", (w.tipo === "tarefa" ? "Tarefa" : "Ocorrência") + ": " + (w.titulo || "") +
        ", prioridade " + w.prioridade + ", " + (KB_LBL[w.status] || w.status) + (w.atrasado ? ", atrasado" : ""));
      var prazo = w.prazo_em ? (w.atrasado ? '<span class="wi-atraso">Atrasado</span>' : "Prazo " + esc(tempoRel(w.prazo_em))) : "";
      d.innerHTML =
        '<button type="button" class="kb-c-menu" data-kbmenu aria-label="Ações do item">⋯</button>' +
        '<div class="kb-c-tit">' + esc(w.titulo || "(sem título)") + "</div>" +
        '<div class="kb-c-meta">' +
        '<span class="wi-tipo">' + (w.tipo === "tarefa" ? "Tarefa" : "Ocorr.") + "</span>" +
        '<span class="wi-chip wi-pr-' + w.prioridade + '">' + esc(w.prioridade) + "</span>" +
        (w.responsavel_nome ? "<span>" + esc(w.responsavel_nome) + "</span>" : '<span style="color:#c2cad0;">sem resp.</span>') +
        (prazo ? "<span>" + prazo + "</span>" : "") +
        (w.tem_conversa ? '<span title="tem conversa">💬</span>' : "") +
        (w.contexto ? "<span>" + w.contexto + " ctx</span>" : "") +
        "</div>";
      return d;
    }

    function kbRenderCol(st) {
      if (!kbEl) return;
      var wrap = kbEl.querySelector('[data-kbitens="' + st + '"]'); if (!wrap) return;
      var e = kbEstado[st], top = wrap.scrollTop;
      wrap.innerHTML = "";
      for (var i = 0; i < e.ordem.length; i++) {
        var w = e.itens[e.ordem[i]];
        if (w) wrap.appendChild(kbCard(w));
      }
      if (!e.ordem.length) {
        var v = document.createElement("div"); v.className = "kb-vazio";
        v.textContent = e.carregando ? "Carregando…" : "Nada aqui.";
        wrap.appendChild(v);
      }
      if (e.temMais && e.ordem.length) {
        var b = document.createElement("button");
        b.type = "button"; b.className = "kb-mais"; b.setAttribute("data-kbmais", st);
        b.textContent = "Carregar mais";
        wrap.appendChild(b);
      }
      wrap.scrollTop = top;                 // preserva a posição de rolagem da coluna
    }

    // MOVER: otimista + rollback. O request_id fica preso à INTENÇÃO (retry não duplica).
    var kbReqMov = {};
    function kbMover(id, novo) {
      var sb = SB(); if (!sb || kbEmVoo[id]) return;
      var de = null, w = null, k;
      for (k = 0; k < KB_COLS.length; k++) if (kbEstado[KB_COLS[k]].itens[id]) { de = KB_COLS[k]; w = kbEstado[KB_COLS[k]].itens[id]; }
      if (!de || !w) return;
      if ((WI_TRANSICOES[de] || []).indexOf(novo) < 0) return;      // a UI nunca oferece inválido
      kbEmVoo[id] = true;
      var chave = id + "|" + novo;
      var req = kbReqMov[chave] || wiReqId(); if (!req) { delete kbEmVoo[id]; return; }
      kbReqMov[chave] = req;
      var snapshot = { de: de, w: w, pos: kbEstado[de].ordem.indexOf(id), gen: kbEstado[de].gen };
      kbTirar(id, de);
      if (novo !== "cancelado") { var w2 = JSON.parse(JSON.stringify(w)); w2.status = novo; kbPor(w2, novo); }
      kbRenderCol(de); if (novo !== "cancelado") kbRenderCol(novo);
      comTimeout(medirRpc("transicionar_work_item", sb.rpc("transicionar_work_item",
        { p_request_id: req, p_work_item_id: id, p_novo_status: novo })), 30000).then(function (r) {
          delete kbEmVoo[id];
          if (r && r.error) {
            // 40001 = "o item mudou de estado" (a 2.0 usa UPDATE condicional). É JUSTAMENTE o caso
            // em que o meu snapshot está comprovadamente velho — então reconcilio em vez de crer nele.
            delete kbReqMov[chave];                 // intenção morta: nunca replayar este id
            kbRollback(snapshot, novo);
            kbReconciliar(id); kbContadores();
            wiAvisar(r.error.code === "40001"
              ? "Esse item mudou enquanto você olhava — atualizei o card."
              : (r.error.message || "Não deu pra mover."));
            return;
          }
          delete kbReqMov[chave];
          kbReconciliar(id); kbContadores();
        }, function () {
          delete kbEmVoo[id];
          kbRollback(snapshot, novo);
          kbReconciliar(id); kbContadores();        // pode ter COMMITADO e só o retorno ter falhado
          wiAvisar("Não deu pra mover. Tente de novo.");
        });
    }

    function kbTirar(id, st) {
      var e = kbEstado[st]; if (!e) return;
      delete e.itens[id]; e.ordem = e.ordem.filter(function (x) { return x !== id; });
    }
    // Insere respeitando a ORDEM CANÔNICA da coluna (a mesma do servidor). Empurrar sempre
    // para o topo faria o quadro mentir: um item de prioridade baixa apareceria acima de um
    // urgente só porque chegou por Broadcast.
    function kbOrdemChave(w, st) {
      if (st === "concluido") return [0, 0, -Date.parse(w.concluido_em || 0) || 0];
      var pr = w.pri_rank || ({ urgente: 1, alta: 2, normal: 3 })[w.prioridade] || 4;
      var pz = w.prazo_em ? Date.parse(w.prazo_em) : Infinity;
      return [pr, pz, -(Date.parse(w.atualizado_em || 0) || 0)];
    }
    function kbPor(w, st) {
      var e = kbEstado[st]; if (!e) return;
      if (e.itens[w.id]) { e.itens[w.id] = w; return; }      // só atualizou conteúdo: mantém a posição
      e.itens[w.id] = w;
      var ck = kbOrdemChave(w, st), i, pos = e.ordem.length;
      for (i = 0; i < e.ordem.length; i++) {
        var o = e.itens[e.ordem[i]]; if (!o) continue;
        var ok = kbOrdemChave(o, st);
        if (ck[0] < ok[0] || (ck[0] === ok[0] && (ck[1] < ok[1] ||
            (ck[1] === ok[1] && ck[2] < ok[2])))) { pos = i; break; }
      }
      // se cairia DEPOIS do último carregado e ainda há mais páginas, não insere: ele
      // aparecerá no "Carregar mais", no lugar certo (senão fura a paginação).
      if (pos >= e.ordem.length && e.temMais && e.ordem.length) { delete e.itens[w.id]; return; }
      e.ordem.splice(pos, 0, w.id);
    }
    function kbRollback(s, novo) {
      if (novo !== "cancelado") kbTirar(s.w.id, novo);
      var e = kbEstado[s.de];
      // não ressuscita item numa coluna que já foi recarregada (filtro novo) nem fora do filtro
      if (e && e.gen === s.gen && !e.itens[s.w.id] && kbPassaFiltro(s.w)) {
        e.itens[s.w.id] = s.w; e.ordem.splice(Math.max(0, s.pos), 0, s.w.id);
      }
      kbRenderCol(s.de); if (novo !== "cancelado") kbRenderCol(novo);
    }

    // Reconcilia UM item com o servidor (pós-escrita e pós-Broadcast).
    function kbReconciliar(id) {
      var sb = SB(); if (!sb || !id) return;
      medirRpc("work_items_por_ids", sb.rpc("work_items_por_ids", { p_ids: [id] })).then(function (r) {
        var w = (r && r.data && r.data[0]) || null, k;
        var atual = null;
        for (k = 0; k < KB_COLS.length; k++) if (kbEstado[KB_COLS[k]].itens[id]) atual = KB_COLS[k];
        if (!w) { if (atual) { kbTirar(id, atual); kbRenderCol(atual); } return; }   // sumiu por RLS/filtro
        var destino = (KB_COLS.indexOf(w.status) >= 0) ? w.status : null;
        if (atual && atual !== destino) { kbTirar(id, atual); kbRenderCol(atual); }
        if (destino) {
          // o card só entra se ainda satisfizer o filtro atual (senão o quadro mentiria)
          if (kbPassaFiltro(w)) { kbPor(kbNorm(w), destino); kbRenderCol(destino); }
          else { kbTirar(id, destino); kbRenderCol(destino); }
        }
      }, function () { });
    }

    // work_items_por_ids devolve o formato da LISTA; o card do Kanban usa alguns nomes próprios.
    function kbNorm(w) {
      return {
        id: w.id, tipo: w.tipo, titulo: w.titulo, status: w.status, prioridade: w.prioridade,
        responsavel_id: w.responsavel_id, responsavel_nome: w.responsavel_nome,
        prazo_em: w.prazo_em, criado_em: w.criado_em, atualizado_em: w.atualizado_em,
        concluido_em: w.concluido_em, topico_id: w.topico_id, contexto: w.vinculos || 0,
        atrasado: !!w.atrasado, tem_conversa: !!w.topico_id,
        pri_rank: ({ urgente: 1, alta: 2, normal: 3 })[w.prioridade] || 4,
        prazo_ord: w.prazo_em || "infinity"
      };
    }

    function kbPassaFiltro(w) {
      var me = (perfil() || {}).id;
      if (kbFiltro.resp === "meus" && w.responsavel_id !== me) return false;
      if (kbFiltro.resp === "sem" && w.responsavel_id) return false;
      if (kbFiltro.resp !== "todos" && kbFiltro.resp !== "meus" && kbFiltro.resp !== "sem"
          && w.responsavel_id !== kbFiltro.resp) return false;
      if (kbFiltro.prio && w.prioridade !== kbFiltro.prio) return false;
      if (kbFiltro.tipo && w.tipo !== kbFiltro.tipo) return false;
      // espelha o SQL nos CINCO valores. Faltando 'hoje'/'7dias' aqui, kbPassaFiltro virava
      // porteiro aberto e o Broadcast metia card fora do filtro (tela e contador divergiam).
      var pz = kbFiltro.prazo;
      if (pz && pz !== "todos") {
        if (pz === "sem") return !w.prazo_em;
        if (!w.prazo_em) return false;
        var t = Date.parse(w.prazo_em); if (isNaN(t)) return false;
        if (pz === "atrasados") return !!w.atrasado;
        var ini = new Date(); ini.setHours(0, 0, 0, 0);
        if (pz === "hoje") return t >= ini.getTime() && t < ini.getTime() + 864e5;
        if (pz === "7dias") { var ag = nowMs(); return t >= ag && t < ag + 7 * 864e5; }
      }
      return true;
    }

    function kbFecharPop() { if (kbPop && kbPop.parentNode) kbPop.parentNode.removeChild(kbPop); kbPop = null; }

    function kbAbrirMenu(card) {
      kbFecharPop();
      var id = card.getAttribute("data-kbid"), w = null, k;
      for (k = 0; k < KB_COLS.length; k++) if (kbEstado[KB_COLS[k]].itens[id]) w = kbEstado[KB_COLS[k]].itens[id];
      if (!w) return;
      var me = (perfil() || {}).id;
      var h = "";
      if (w.responsavel_id !== me) h += '<button type="button" data-kbact="assumir">Assumir para mim</button>';
      var tr = WI_TRANSICOES[w.status] || [];
      for (k = 0; k < tr.length; k++) h += '<button type="button" data-kbact="st:' + tr[k] + '">' + KB_ACAO_LBL[tr[k]] + "</button>";
      if (w.tem_conversa) h += '<button type="button" data-kbact="conversa">Abrir conversa</button>';
      h += '<button type="button" data-kbact="detalhe">Abrir detalhe</button>';
      kbPop = document.createElement("div");
      kbPop.className = "kb-pop"; kbPop.setAttribute("role", "menu"); kbPop.innerHTML = h;
      kbPop.setAttribute("data-kbfor", id);
      card.appendChild(kbPop);
      var b1 = kbPop.querySelector("button"); if (b1) b1.focus();
    }

    function kbAcao(id, act) {
      var w = null, k;
      for (k = 0; k < KB_COLS.length; k++) if (kbEstado[KB_COLS[k]].itens[id]) w = kbEstado[KB_COLS[k]].itens[id];
      kbFecharPop();
      if (!w) return;
      if (act === "detalhe") { abrirItem(id); return; }
      if (act === "conversa") { if (w.topico_id) wiIrConversa(w.topico_id); return; }
      if (act === "assumir") {
        // reusa atualizar_work_item da 2.0 (nenhuma RPC de escrita nova nesta sprint)
        wiEscrever("atualizar_work_item", { p_work_item_id: id, p_responsavel_id: (perfil() || {}).id }, id);
        setTimeout(function () { kbReconciliar(id); kbContadores(); }, 400);
        return;
      }
      if (act.indexOf("st:") === 0) {
        var novo = act.slice(3);
        if (novo === "concluido" || novo === "cancelado") {
          if (!window.confirm(novo === "concluido" ? "Concluir este item?" : "Cancelar este item?")) return;
        }
        kbMover(id, novo);
      }
    }

    function kbGarantirView() {
      if (kbEl || !wiListaEl) return kbEl;
      kbEl = document.createElement("div");
      kbEl.className = "kb-quadro-wrap";
      kbEl.style.display = "none";
      var abas = "", cols = "";
      KB_COLS.forEach(function (st, i) {
        abas += '<button type="button" class="kb-aba' + (i === 0 ? " on" : "") + '" data-kbaba="' + st + '">' +
                KB_LBL[st] + ' <span data-kbcnt="' + st + '"></span></button>';
        cols += '<section class="kb-col' + (i === 0 ? "" : " off") + '" data-kbcol="' + st + '" aria-label="Coluna ' + KB_LBL[st] + '">' +
                '<header class="kb-col-h"><span class="kb-col-t">' + KB_LBL[st] + '</span>' +
                '<span class="kb-cnt" data-kbcnt="' + st + '"></span></header>' +
                '<div class="kb-itens" data-kbitens="' + st + '"></div></section>';
      });
      kbEl.innerHTML =
        '<div class="wi-filtros" style="margin-bottom:10px;">' +
        '<select data-kbf="resp" aria-label="Filtrar por responsável"><option value="todos">Responsável: todos</option>' +
        '<option value="meus">Meus</option><option value="sem">Sem responsável</option></select>' +
        '<select data-kbf="prio" aria-label="Filtrar por prioridade"><option value="">Prioridade: todas</option>' +
        '<option value="urgente">Urgente</option><option value="alta">Alta</option>' +
        '<option value="normal">Normal</option><option value="baixa">Baixa</option></select>' +
        '<select data-kbf="tipo" aria-label="Filtrar por tipo"><option value="">Tipo: todos</option>' +
        '<option value="ocorrencia">Ocorrência</option><option value="tarefa">Tarefa</option></select>' +
        '<select data-kbf="prazo" aria-label="Filtrar por prazo"><option value="">Prazo: todos</option>' +
        '<option value="atrasados">Atrasados</option><option value="hoje">Vence hoje</option>' +
        '<option value="7dias">Próximos 7 dias</option><option value="sem">Sem prazo</option></select>' +
        '<span style="margin-left:auto;font-size:12.5px;color:#9aa6ae;">Cancelados: <b data-kbcnt="cancelado">0</b></span>' +
        "</div>" +
        '<div class="kb-abas" role="tablist">' + abas + "</div>" +
        '<div class="kb-quadro">' + cols + "</div>";
      wiListaEl.parentNode.insertBefore(kbEl, wiListaEl.nextSibling);

      kbEl.addEventListener("change", function (e) {
        var f = e.target.getAttribute && e.target.getAttribute("data-kbf"); if (!f) return;
        kbFiltro[f] = e.target.value;
        kbFecharPop();
        KB_COLS.forEach(function (st) { kbCarregarCol(st, true); });   // cancela o antigo via gen
        kbContadores();
      });
      kbEl.addEventListener("click", function (e) {
        var t = e.target;
        var aba = t.closest ? t.closest("[data-kbaba]") : null;
        if (aba) { kbSelColuna(aba.getAttribute("data-kbaba")); return; }
        var mais = t.closest ? t.closest("[data-kbmais]") : null;
        if (mais) { kbCarregarCol(mais.getAttribute("data-kbmais"), false); return; }
        var act = t.closest ? t.closest("[data-kbact]") : null;
        if (act) {
          var pop = act.closest(".kb-pop");
          kbAcao(pop ? pop.getAttribute("data-kbfor") : null, act.getAttribute("data-kbact"));
          return;
        }
        var mbtn = t.closest ? t.closest("[data-kbmenu]") : null;
        if (mbtn) { e.stopPropagation(); kbAbrirMenu(mbtn.closest(".kb-card")); return; }
        var card = t.closest ? t.closest("[data-kbid]") : null;
        if (card) { kbFecharPop(); abrirItem(card.getAttribute("data-kbid")); }
      });
      // teclado: Enter/Espaço abre o card, ESC fecha o menu
      kbEl.addEventListener("keydown", function (e) {
        if (e.key === "Escape") { kbFecharPop(); return; }
        var card = e.target && e.target.classList && e.target.classList.contains("kb-card") ? e.target : null;
        if (card && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); abrirItem(card.getAttribute("data-kbid")); }
      });
      return kbEl;
    }

    // (2.2) seleciona a coluna visível no mobile (reaplica o toggle das abas/colunas).
    function kbSelColuna(col) {
      kbMobCol = col;
      if (!kbEl) return;
      var as = kbEl.querySelectorAll("[data-kbaba]"), cs = kbEl.querySelectorAll("[data-kbcol]"), i;
      for (i = 0; i < as.length; i++) as[i].classList.toggle("on", as[i].getAttribute("data-kbaba") === col);
      for (i = 0; i < cs.length; i++) cs[i].classList.toggle("off", cs[i].getAttribute("data-kbcol") !== col);
    }

    function kbMostrar(qual) {
      // (2.1) sair de detalhe/formulário ANTES de trocar de vista: senão renderWiLista
      // aborta no guard (itemAtual/wiFormAberto) e a Lista fica em skeleton para sempre.
      itemAtual = null; wiFormAberto = false; ++wiGen; ++itemGen;
      if (viewAtual === "item") viewAtual = "trabalho";
      kbVista = qual;
      try { localStorage.setItem("co_trab_vista", qual); } catch (e) { }
      kbGarantirView();
      dbGarantirView();
      var bs = trabView ? trabView.querySelectorAll("[data-kbvista]") : [];
      for (var i = 0; i < bs.length; i++) bs[i].classList.toggle("on", bs[i].getAttribute("data-kbvista") === qual);
      // elementos que pertencem SÓ à Lista (aparecem apenas na vista lista)
      var listaAbas = trabView ? trabView.querySelector(".wi-abas") : null;
      var listaFiltros = trabView ? trabView.querySelector("[data-wifiltros]") : null;
      var mostraLista = (qual === "lista");
      if (wiListaEl) wiListaEl.style.display = mostraLista ? "" : "none";
      if (wiMaisBtn) wiMaisBtn.parentNode.style.display = mostraLista ? "" : "none";
      if (listaAbas) listaAbas.style.display = mostraLista ? "" : "none";
      if (listaFiltros) listaFiltros.style.display = mostraLista ? "" : "none";
      if (wiStatusEl) wiStatusEl.style.display = mostraLista ? "" : "none";   // (2.2) não deixa "Nada por aqui" da Lista embaixo do Painel/Kanban
      if (kbEl) kbEl.style.display = (qual === "kanban") ? "" : "none";
      if (dbEl) dbEl.style.display = (qual === "dashboard") ? "" : "none";
      if (qual !== "kanban") kbFecharPop();

      if (qual === "kanban") {
        // (2.2) drill-down de fila ativa esconde a coluna Concluído (o card não a conta)
        var colConc = kbEl ? kbEl.querySelector('[data-kbcol="concluido"]') : null;
        var abaConc = kbEl ? kbEl.querySelector('[data-kbaba="concluido"]') : null;
        if (colConc) colConc.style.display = kbSoAtivos ? "none" : "";
        if (abaConc) abaConc.style.display = kbSoAtivos ? "none" : "";
        if (kbSoAtivos && kbMobCol === "concluido") kbSelColuna("aberto");
        KB_COLS.forEach(function (st) {
          if (kbSoAtivos && st === "concluido") { kbZerar(st); kbRenderCol(st); return; }  // não carrega
          kbCarregarCol(st, true);
        });
        kbContadores();
      } else if (qual === "dashboard") {
        dbCarregar();
      } else {
        carregarWi(true);
      }
    }

    /* ============================================================
       (2.2) DASHBOARD ("Painel") — só leitura, só agregação dos work_items existentes.
       Um card por indicador; clicar num card abre o Kanban já filtrado. Tempo real =
       re-agregação AUTORITATIVA de UMA RPC barata (debounced) + patch dos números no
       lugar — nunca soma incremental (a lição de drift da 1.10/1.14) e nunca reconstrói o DOM.
       ============================================================ */
    var dbEl = null, dbDados = null, dbDim = "prioridade", dbGen = 0, dbTimer = null;
    var kbSoAtivos = false;   // (2.2) drill-down de card de fila ativa: Kanban esconde "Concluído"
    // cada card: [chave, rótulo, classe extra, filtro do Kanban p/ drill-down (ou null)]
    // soAtivos: o indicador conta só fila ativa (exclui concluído/cancelado) — o drill-down
    // esconde a coluna Concluído no Kanban, senão o card "3 urgentes" abriria mostrando 7.
    var DB_CARDS = [
      ["abertos", "Abertos", "", { status: "aberto" }],
      ["em_andamento", "Em andamento", "", { status: "em_andamento" }],
      ["bloqueados", "Bloqueados", "", { status: "bloqueado" }],
      ["atrasados", "Atrasados", "alerta", { prazo: "atrasados" }],
      ["urgente", "Urgentes", "urg", { prio: "urgente", soAtivos: true }],
      ["alta", "Alta prioridade", "", { prio: "alta", soAtivos: true }],
      ["meus", "Meus itens", "", { resp: "meus", soAtivos: true }],
      ["sem_responsavel", "Sem responsável", "", { resp: "sem", soAtivos: true }],
      ["concluidos_hoje", "Concluídos hoje", "", null],
      ["cancelados", "Cancelados", "", null]
    ];

    function dbGarantirView() {
      if (dbEl || !wiListaEl) return dbEl;
      dbEl = document.createElement("div");
      dbEl.className = "co-dash";
      dbEl.style.display = "none";
      dbEl.innerHTML =
        '<div class="db-grid" data-dbgrid></div>' +
        '<div class="db-sec"><div class="db-tempo" data-dbtempo></div></div>' +
        '<div class="db-sec"><div class="db-sec-h"><span class="db-lbl">Distribuição do trabalho ativo</span>' +
        '<div class="db-dims">' +
        '<button type="button" class="db-dim on" data-dbdim="prioridade">Prioridade</button>' +
        '<button type="button" class="db-dim" data-dbdim="responsavel">Responsável</button>' +
        '<button type="button" class="db-dim" data-dbdim="tipo">Tipo</button>' +
        '<button type="button" class="db-dim" data-dbdim="status">Status</button></div></div>' +
        '<div class="db-bars" data-dbbars></div></div>';
      wiListaEl.parentNode.insertBefore(dbEl, wiListaEl.nextSibling);
      dbEl.addEventListener("click", function (e) {
        var dim = e.target.closest ? e.target.closest("[data-dbdim]") : null;
        if (dim) {
          dbDim = dim.getAttribute("data-dbdim");
          var ds = dbEl.querySelectorAll("[data-dbdim]");
          for (var i = 0; i < ds.length; i++) ds[i].classList.toggle("on", ds[i] === dim);
          dbCarregarGrupo(); return;
        }
        var card = e.target.closest ? e.target.closest("[data-dbfiltro]") : null;
        if (card) dbAbrirFiltro(card.getAttribute("data-dbfiltro"));
      });
      dbEl.addEventListener("keydown", function (e) {
        var card = e.target && e.target.getAttribute && e.target.getAttribute("data-dbfiltro");
        if (card && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); dbAbrirFiltro(card); }
      });
      return dbEl;
    }

    // Debounce: uma rajada de eventos (mudança em lote) vira UMA re-agregação, não N.
    function dbAgendarRefresh() {
      if (!dbEl || dbEl.style.display === "none") return;
      if (dbTimer) clearTimeout(dbTimer);
      dbTimer = setTimeout(function () { dbTimer = null; dbCarregar(); }, (window.__CO_DB_MS != null ? window.__CO_DB_MS : 800));
    }

    function dbCarregar() {
      var sb = SB(); if (!sb || !dbEl) return;
      var g = ++dbGen;
      medirRpc("dashboard_operacional", sb.rpc("dashboard_operacional")).then(function (r) {
        if (g !== dbGen) return;                       // re-agregação mais nova já veio
        if (!r || r.error) return;                     // erro: mantém os números que já estavam
        dbDados = (r.data && r.data[0]) || null;
        dbPintar();
      }, function () { });
      dbCarregarGrupo();
    }

    function dbPintar() {
      if (!dbEl || !dbDados) return;
      var grid = dbEl.querySelector("[data-dbgrid]");
      // Reaproveita os nós se já existem (patch no lugar) — não reconstrói o DOM a cada evento.
      if (!grid.children.length) {
        var h = "";
        for (var i = 0; i < DB_CARDS.length; i++) {
          var c = DB_CARDS[i], clic = c[3] ? " clic" : "";
          h += '<div class="db-card' + clic + (c[2] ? " " + c[2] : "") + '"' +
               (c[3] ? ' data-dbfiltro="' + c[0] + '" role="button" tabindex="0"' : "") +
               ' aria-label="' + esc(c[1]) + '"><div class="db-num" data-dbnum="' + c[0] + '">–</div>' +
               '<div class="db-lbl">' + esc(c[1]) + "</div></div>";
        }
        grid.innerHTML = h;
      }
      for (var k = 0; k < DB_CARDS.length; k++) {
        var el = grid.querySelector('[data-dbnum="' + DB_CARDS[k][0] + '"]');
        if (el) el.textContent = String(dbDados[DB_CARDS[k][0]] != null ? dbDados[DB_CARDS[k][0]] : 0);
      }
      var tempo = dbEl.querySelector("[data-dbtempo]");
      if (tempo) {
        var amostra = dbDados.resolucao_amostra || 0;
        tempo.innerHTML = amostra > 0
          ? "Tempo médio de resolução: <b>" + dbDurar(dbDados.resolucao_media_seg) + "</b> " +
            '<span style="color:#9aa6ae;">(' + amostra + " concluído" + (amostra > 1 ? "s" : "") + ")</span>"
          : '<span style="color:#9aa6ae;">Ainda não há itens concluídos para calcular o tempo médio.</span>';
      }
    }

    function dbDurar(seg) {
      seg = Number(seg) || 0;
      if (seg < 3600) return Math.max(1, Math.round(seg / 60)) + " min";
      if (seg < 86400) return (seg / 3600).toFixed(1).replace(".0", "") + " h";
      return (seg / 86400).toFixed(1).replace(".0", "") + " dia" + (seg >= 2 * 86400 ? "s" : "");
    }

    function dbCarregarGrupo() {
      var sb = SB(); if (!sb || !dbEl) return;
      var g = dbGen, dim = dbDim;
      medirRpc("dashboard_agrupado", sb.rpc("dashboard_agrupado", { p_dim: dim })).then(function (r) {
        if (g !== dbGen || dim !== dbDim) return;      // resposta de uma agregação/dimensão anterior: descarta
        var bars = dbEl.querySelector("[data-dbbars]"); if (!bars) return;
        var ls = (r && r.data) || [];
        if (!ls.length) { bars.innerHTML = '<div class="kb-vazio">Sem trabalho ativo.</div>'; return; }
        var max = 0, i;
        for (i = 0; i < ls.length; i++) max = Math.max(max, ls[i].quantidade || 0);
        var PR = { urgente: "Urgente", alta: "Alta", normal: "Normal", baixa: "Baixa",
                   aberto: "Aberto", em_andamento: "Em andamento", bloqueado: "Bloqueado",
                   concluido: "Concluído", cancelado: "Cancelado", ocorrencia: "Ocorrência", tarefa: "Tarefa" };
        var h = "";
        for (i = 0; i < ls.length; i++) {
          var nome = PR[ls[i].rotulo] || ls[i].rotulo || "?";
          var pct = max ? Math.round((ls[i].quantidade / max) * 100) : 0;
          h += '<div class="db-bar"><span class="db-bar-nome" title="' + esc(nome) + '">' + esc(nome) + "</span>" +
               '<span class="db-bar-track"><span class="db-bar-fill" style="width:' + pct + '%"></span></span>' +
               '<span class="db-bar-q">' + (ls[i].quantidade || 0) + "</span></div>";
        }
        bars.innerHTML = h;
      }, function () { });
    }

    // Drill-down: card -> abre o Kanban já filtrado (Kanban tem todos os filtros, incl. prazo).
    function dbAbrirFiltro(chave) {
      var c = null;
      for (var i = 0; i < DB_CARDS.length; i++) if (DB_CARDS[i][0] === chave) c = DB_CARDS[i];
      if (!c || !c[3]) return;
      var f = c[3];
      kbFiltro = { resp: f.resp || "todos", prio: f.prio || "", tipo: "", prazo: f.prazo || "" };
      kbSoAtivos = !!f.soAtivos;                 // card de fila ativa => Kanban sem a coluna Concluído
      kbMostrar("kanban");
      // reflete o filtro nos selects do quadro
      if (kbEl) {
        var setSel = function (name, val) { var s = kbEl.querySelector('[data-kbf="' + name + '"]'); if (s) s.value = val; };
        setSel("resp", kbFiltro.resp); setSel("prio", kbFiltro.prio); setSel("tipo", ""); setSel("prazo", kbFiltro.prazo);
      }
      // no mobile, abre já na coluna certa (reaplica o toggle) — status card vai pra sua coluna;
      // os demais caem em 'aberto' (nunca deixa a coluna anterior, que pode vir vazia pelo filtro).
      kbSelColuna(f.status && KB_COLS.indexOf(f.status) >= 0 ? f.status : "aberto");
    }

    // (2.0) Hidrata os títulos dos work items do Feed em UMA chamada em lote (teto 100 casa
    // com a página de 30). Sem isso o Feed mostraria uma fileira de "Nova tarefa" sem nome.
    function wiHidratarFeed() {
      var sb = SB(); if (!sb || !feedLista) return;
      var els = feedLista.querySelectorAll("[data-wient]:not([data-wiok])");
      if (!els.length) return;
      var ids = [], vistos = {}, i;
      for (i = 0; i < els.length && ids.length < 100; i++) {
        var id = els[i].getAttribute("data-wient");
        if (id && !vistos[id]) { vistos[id] = true; ids.push(id); }
      }
      if (!ids.length) return;
      medirRpc("work_items_por_ids", sb.rpc("work_items_por_ids", { p_ids: ids })).then(function (r) {
        // Falha de rede/permissão NÃO marca como resolvido — senão a linha genérica
        // congelaria para sempre. E só marco os ids que entraram NESTE lote (o excedente
        // acima de 100 fica para a próxima passada).
        if (!r || r.error) return;
        var linhas = (r && r.data) || [], mapa = {}, k;
        for (k = 0; k < linhas.length; k++) mapa[linhas[k].id] = linhas[k];
        for (k = 0; k < els.length; k++) {
          var e2 = els[k], eid = e2.getAttribute("data-wient");
          if (!vistos[eid]) continue;                       // não entrou no lote: tenta depois
          var w = mapa[eid];
          e2.setAttribute("data-wiok", "1");                // resolvido (ou invisível por RLS)
          if (!w) continue;
          var alvo = e2.querySelector(".copf-resumo");
          if (alvo) alvo.textContent = (w.tipo === "tarefa" ? "Tarefa: " : "Ocorrência: ") + (w.titulo || "");
          e2.style.cursor = "pointer";
          e2.setAttribute("data-wiabrir", w.id);             // clicar no Feed abre o item
        }
      }, function () { });
    }

    function assinarRealtime() {
      var sb = SB(); if (!sb || rtCanal) return;
      try {
        rtCanal = sb.channel(CANAL_RT, { config: { presence: { key: (perfil() || {}).id || "anon" } } });
        rtCanal.on("broadcast", { event: "novo" }, function (msg) {
          var p = (msg && msg.payload) || {};
          var tipo = p.tipo, bastidor = (tipo === "audio.transcrito" || tipo === "mencao.criada" || tipo === "reacao.alterada"
            // (2.0) vínculo é só roteamento — o servidor já o exclui do Feed; aqui evita inflar o "novos"
            || tipo === "work_item.vinculo_adicionado" || tipo === "work_item.vinculo_removido");
          // Feed: conta "novos" só p/ eventos que aparecem no Feed (não os de bastidor)
          if (viewAtual === "feed" && !bastidor) { novos++; renderNovos(); }
          // conversa aberta: busca só a msg e insere; tópico fechado: incrementa não-lidas
          if (tipo === "mensagem.criada") {
            if (p.topico === canalAtual) { limparDigit(p.autor); buscarMsgNova(p.ent, canalAtual); }   // msg dele chegou => some o "digitando" na hora
            else incrementarNaoLida(p.topico, p.ent, p.autor);
          }
          else if (tipo === "reacao.alterada") {
            // reação de OUTRO na conversa aberta: atualiza SÓ aquela mensagem (a minha já reconciliei no toggle)
            if (p.topico === canalAtual && p.autor !== (perfil() || {}).id) atualizarReacoes([p.ent]);
          }
          // (2.0) work item mudou em outro aparelho: atualiza SÓ o afetado, nunca a lista toda.
          else if (tipo && tipo.indexOf("work_item.") === 0) {
            if (p.ent && (viewAtual === "trabalho" || viewAtual === "item")) {
              if (itemAtual && p.ent === itemAtual) abrirItem(itemAtual);   // detalhe aberto: recarrega o detalhe
              else if (kbVista === "kanban") kbReconciliar(p.ent);           // (2.1) move/atualiza SÓ aquele card
              else if (kbVista === "dashboard") dbAgendarRefresh();          // (2.2) re-agrega (debounced), patch no lugar
              else wiAtualizarUm(p.ent);                                    // lista: só aquele card
            }
          }
          else if (tipo === "audio.transcrito" || !tipo) verificarTranscricoes();   // (1.14) só transcrição/fallback — não dispara RPC p/ todo evento de bastidor
        });
        rtCanal.on("broadcast", { event: "digitando" }, onDigitando);
        rtCanal.on("presence", { event: "sync" }, onPresencaSync);
        rtCanal.subscribe(function (status) {
          if (status === "SUBSCRIBED") {
            rastrear();          // publica minha presença (1ª vez E em cada reconexão)
            marcarAtividade();   // (re)inicia o timer de "ausente"
            if (rtSubOk) {
              // (1.14) reconexão com DEBOUNCE 1.5s: no flap de wifi (rejoin 5-10x/min) as cargas
              // pesadas (recuperarMsgs/reações/não-lidas/feed) rodam UMA vez, não em avalanche.
              coStats.reconexoes++; coLog("reconectou", "#" + coStats.reconexoes);
              conexao(true); limparTodosDigit(); onPresencaSync();   // imediatos (leves)
              if (recTimer) clearTimeout(recTimer);
              recTimer = setTimeout(function () {
                recTimer = null;
                recuperarMsgs(); reconciliarReacoesVisiveis(); carregarNaoLidas(); verificarTranscricoes();
                if (viewAtual === "feed" && elPage && elPage.classList.contains("ativo")) carregarFeed(true);
                // (2.1) quadro aberto: recarrega a 1ª página autoritativa de cada coluna + contadores
                if (kbVista === "kanban" && kbEl && kbEl.style.display !== "none") {
                  KB_COLS.forEach(function (st) { kbCarregarCol(st, true); });
                  kbContadores();
                }
                // (2.2) painel aberto: re-agrega autoritativamente (nunca soma incremental)
                if (kbVista === "dashboard" && dbEl && dbEl.style.display !== "none") dbCarregar();
              }, (window.__CO_REC_MS != null ? window.__CO_REC_MS : 1500));   // (1.14) debounce test-override
            }
            rtSubOk = true;
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            coStats.bcFalhas++; coLog("canal", status);   // (1.14) contador de falha de Broadcast
            conexao(false);      // indicador discreto de reconexão
            limparTodosDigit();  // conexão caiu => tira indicadores de digitação presos
          }
        });
      } catch (e) { }
      document.addEventListener("click", function (e) {
        if (kbPop && e.target && (!e.target.closest || !e.target.closest(".kb-pop")) &&
            (!e.target.closest || !e.target.closest("[data-kbmenu]"))) kbFecharPop();   // (2.1)
      });
      document.addEventListener("visibilitychange", function () {
        if (document.visibilityState !== "visible" || !elPage || !elPage.classList.contains("ativo")) return;
        marcarAtividade();   // voltei pra aba => estou ativo
        if (viewAtual === "feed") carregarFeed(true);
        else {
          verificarTranscricoes(); reconciliarReacoesVisiveis();   // reconcilia reações que mudaram com a aba oculta
          // (1.14) msgs que chegaram no canal ABERTO com a aba oculta foram renderizadas, mas marcarLidoAte
          // no-opava (guard de visibilidade) => o cursor de leitura não avançou. Ao voltar à aba, re-marca pela
          // mensagem mais nova na tela (msgLista é desc, .co-msg do topo) e evita badge fantasma de msg já vista.
          if (kbVista === "kanban" && kbEl && kbEl.style.display !== "none") kbContadores();   // (2.1)
          if (kbVista === "dashboard" && dbEl && dbEl.style.display !== "none") dbCarregar();  // (2.2) reconcilia no foco
          var topoMsg = canalAtual && msgLista && msgLista.querySelector(".co-msg");
          if (topoMsg) marcarLidoAte(canalAtual, topoMsg.getAttribute("data-mid"));
        }
      });
    }

    function montarUI() {
      var nav = document.querySelector("nav.sidebar");
      var main = document.querySelector("main");
      if (!nav || !main || document.getElementById("page-operacional")) return;
      injetarCss();

      // item de menu (dinâmico; só existe quando liberado)
      elNav = document.createElement("button");
      elNav.className = "nav-item";
      elNav.setAttribute("data-page", "operacional");
      elNav.innerHTML =
        '<span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/></svg></span> Central Operacional';
      nav.appendChild(elNav);

      // página (dois painéis)
      elPage = document.createElement("section");
      elPage.id = "page-operacional";
      elPage.className = "page";
      elPage.innerHTML =
        '<div class="card"><div class="co-shell">' +
          '<div class="co-side">' +
            '<button class="co-nav-item on co-feed-btn" type="button"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/></svg><span>Feed</span></button>' +
            '<div class="co-side-lbl">Canais</div>' +
            '<div class="co-canais"></div>' +
            '<div class="co-side-lbl">Recebimentos</div>' +
            '<div class="co-recebimentos"></div>' +
            '<div class="co-side-lbl">Pessoas</div>' +
            '<div class="co-pessoas"></div>' +
          '</div>' +
          '<div class="co-main">' +
            // VIEW: FEED
            '<div class="co-view-feed">' +
              '<div class="co-head"><div><h2 style="margin:0;">Central Operacional</h2>' +
              '<div class="co-sub">Feed do que está acontecendo na operação — só leitura</div></div>' +
              '<button class="copf-refresh" type="button" title="Atualizar">&#8635;</button></div>' +
              '<button class="copf-pill" type="button" style="display:none;"></button>' +
              '<div class="copf-lista"></div><div class="copf-status"></div>' +
              '<button class="copf-mais" type="button" style="display:none;">Carregar mais</button>' +
            '</div>' +
            // VIEW: CANAL
            '<div class="co-view-canal" style="display:none;">' +
              '<div class="co-head"><div><h2 class="co-canal-titulo" style="margin:0;">Conversa</h2>' +
              '<div class="co-sub">Converse aqui — texto e foto</div></div>' +
              '<div class="co-ocorrencia"></div></div>' +
              '<div class="co-preview" style="display:none;"><img alt="pré-visualização"><span class="co-foto-nome"></span><button class="co-foto-x" type="button" title="Remover foto">&times;</button></div>' +
              '<div class="co-audio-area" style="display:none;"></div>' +
              '<div class="co-comp-erro" style="display:none;"></div>' +
              '<div class="co-compositor">' +
                '<button class="co-foto-btn" type="button" title="Enviar foto" aria-label="Enviar foto"><svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></button>' +
                '<input type="file" class="co-foto-input" accept="image/jpeg,image/png,image/webp" capture="environment" style="display:none;">' +
                '<button class="co-audio-btn" type="button" title="Gravar áudio" aria-label="Gravar áudio"><svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v1a7 7 0 0 0 14 0v-1"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="8" y1="22" x2="16" y2="22"/></svg></button>' +
                '<textarea class="co-inp" rows="1" placeholder="Escreva uma mensagem…" maxlength="4000"></textarea>' +
                '<button class="co-enviar" type="button">Enviar</button>' +
              '</div>' +
              '<div class="co-typing" aria-live="polite"></div>' +
              '<div class="co-msgs"></div><div class="co-msg-status"></div>' +
              '<button class="copf-mais co-msg-mais" type="button" style="display:none;">Carregar mais</button>' +
            '</div>' +
          '</div>' +
        '</div></div>';
      main.appendChild(elPage);

      feedView = elPage.querySelector(".co-view-feed");
      canalView = elPage.querySelector(".co-view-canal");
      feedLista = elPage.querySelector(".copf-lista");
      feedStatus = elPage.querySelector(".copf-status");
      feedMais = elPage.querySelector(".copf-mais");
      feedPill = elPage.querySelector(".copf-pill");
      canaisLista = elPage.querySelector(".co-canais");
      recebLista = elPage.querySelector(".co-recebimentos");
      presLista = elPage.querySelector(".co-pessoas");
      digitEl = elPage.querySelector(".co-typing");
      feedBtn = elPage.querySelector(".co-feed-btn");
      canalTitulo = elPage.querySelector(".co-canal-titulo");
      msgLista = elPage.querySelector(".co-msgs");
      msgStatus = elPage.querySelector(".co-msg-status");
      msgMais = elPage.querySelector(".co-msg-mais");
      coInp = elPage.querySelector(".co-inp");
      coEnviar = elPage.querySelector(".co-enviar");
      coFotoBtn = elPage.querySelector(".co-foto-btn");
      coFotoInput = elPage.querySelector(".co-foto-input");
      coPreview = elPage.querySelector(".co-preview");
      coPreImg = coPreview.querySelector("img");
      coPreNome = coPreview.querySelector(".co-foto-nome");
      coErro = elPage.querySelector(".co-comp-erro");
      coOc = elPage.querySelector(".co-ocorrencia");
      coAudioBtn = elPage.querySelector(".co-audio-btn");
      coAudioArea = elPage.querySelector(".co-audio-area");

      // interações
      elNav.addEventListener("click", function () {
        var i, ns = document.querySelectorAll(".nav-item"), ps = document.querySelectorAll(".page");
        for (i = 0; i < ns.length; i++) ns[i].classList.remove("ativo");
        for (i = 0; i < ps.length; i++) ps[i].classList.remove("ativo");
        elNav.classList.add("ativo"); elPage.classList.add("ativo"); window.scrollTo(0, 0);
        if (!canaisCarregou) carregarCanais();
        if (!recebCarregou) carregarRecebimentos();
        if (!feedCarregou) carregarFeed(true);
        carregarNaoLidas();       // contagem autoritativa dos badges
        carregarParticipantes();  // roster p/ a lista de presença
      });
      feedBtn.addEventListener("click", function () { mostrarFeed(); });
      // (2.0) item "Trabalho" na navegação, inserido logo abaixo do Feed (sem reescrever o
      // template do montarUI — só um irmão no DOM).
      try {
        wiNavBtn = document.createElement("button");
        wiNavBtn.type = "button";
        wiNavBtn.className = "co-nav-item";
        wiNavBtn.innerHTML =
          '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg><span>Trabalho</span>';
        wiNavBtn.addEventListener("click", function () { mostrarTrabalho(); });
        if (feedBtn.parentNode) feedBtn.parentNode.insertBefore(wiNavBtn, feedBtn.nextSibling);
      } catch (e) { }
      elPage.querySelector(".copf-refresh").addEventListener("click", function () { carregarFeed(true); });
      feedMais.addEventListener("click", function () { carregarFeed(false); });
      // (2.0) clicar numa linha de work item no Feed abre o item
      feedLista.addEventListener("click", function (e) {
        var l = e.target && e.target.closest ? e.target.closest("[data-wiabrir]") : null;
        if (l) abrirItem(l.getAttribute("data-wiabrir"));
      });
      feedPill.addEventListener("click", function () { novos = 0; renderNovos(); carregarFeed(true); });
      msgMais.addEventListener("click", function () { carregarMsgs(false); });
      // delegação nas mensagens (menção + reações). Pega msgs atuais e futuras.
      msgLista.addEventListener("click", function (e) {
        var a = e.target;
        if (a && a.classList && a.classList.contains("co-mencao")) { e.preventDefault(); aoClicarMencao(a); return; }
        var emo = a.closest ? a.closest(".co-react-emoji") : null;   // escolheu emoji no seletor
        if (emo) { var me = emo.closest(".co-msg"); if (me) toggleReacao(me.getAttribute("data-mid"), emo.getAttribute("data-emoji")); fecharReacPick(); return; }
        var chip = a.closest ? a.closest(".co-reacao") : null;       // clique num chip existente = toggle
        if (chip) { var mc = chip.closest(".co-msg"); if (mc) toggleReacao(mc.getAttribute("data-mid"), chip.getAttribute("data-emoji")); return; }
        var btn = a.closest ? a.closest(".co-react-btn") : null;     // botão "reagir" abre o seletor
        if (btn) { var mb = btn.closest(".co-msg"); if (mb) abrirReacPick(mb); return; }
        if (reacIgnoraClique) { reacIgnoraClique = false; return; }  // ignora o click sintético logo após um toque-longo
        fecharReacPick();                                            // clique em qualquer outro lugar fecha o seletor
      });
      // toque longo (mobile) abre o seletor de emojis
      msgLista.addEventListener("touchstart", function (e) {
        var mm = e.target.closest ? e.target.closest(".co-msg") : null; if (!mm) return;
        if (reacLpTimer) clearTimeout(reacLpTimer);
        reacLpTimer = setTimeout(function () {
          reacLpTimer = null; reacIgnoraClique = true;              // não deixa o click sintético do long-press fechar na hora
          abrirReacPick(mm);
          setTimeout(function () { reacIgnoraClique = false; }, 450);
        }, 500);
      }, { passive: true });
      function cancelarLp() { if (reacLpTimer) { clearTimeout(reacLpTimer); reacLpTimer = null; } }
      msgLista.addEventListener("touchend", cancelarLp, { passive: true });
      msgLista.addEventListener("touchmove", cancelarLp, { passive: true });
      msgLista.addEventListener("touchcancel", cancelarLp, { passive: true });
      // clique FORA da lista de mensagens (compositor, canais, feed) também fecha o seletor de emojis
      document.addEventListener("click", function (e) {
        if (!msgLista) return;
        var t = e.target;
        if (t.closest && (t.closest(".co-react-pick") || t.closest(".co-react-btn") || t.closest(".co-msgs"))) return;
        fecharReacPick();
      });

      // compositor (Sprint 1.4 texto + Sprint 1.5 foto)
      coEnviar.addEventListener("click", function () { enviar(); });
      coInp.addEventListener("keydown", function (e) {
        // Enquanto o autocomplete de @menção está aberto, as teclas navegam/selecionam nele.
        if (mencAberto()) {
          if (e.key === "ArrowDown" || e.keyCode === 40) { e.preventDefault(); moverMenc(1); return; }
          if (e.key === "ArrowUp" || e.keyCode === 38) { e.preventDefault(); moverMenc(-1); return; }
          if (e.key === "Enter" || e.keyCode === 13 || e.key === "Tab" || e.keyCode === 9) { e.preventDefault(); selecionarMenc(mencIdx); return; }
          if (e.key === "Escape" || e.keyCode === 27) { e.preventDefault(); fecharMenc(); return; }
          // Backspace/Setas laterais/edição normal caem no fluxo padrão (o input handler reavalia o token).
        }
        if ((e.key === "Enter" || e.keyCode === 13) && !e.shiftKey) { e.preventDefault(); enviar(); }
      });
      coInp.addEventListener("input", function () {
        coInp.style.height = "auto"; coInp.style.height = Math.min(coInp.scrollHeight, 140) + "px";
        avaliarMenc();   // detecta "@token" sob o cursor e abre/fecha/atualiza o autocomplete
        if ((coInp.value || "").length) sinalizarDigitando();   // avisa os outros que estou digitando (throttle)
        else pararDigitar();                                     // esvaziou o campo => "parei de digitar" na hora
      });
      coInp.addEventListener("blur", function () { setTimeout(fecharMenc, 150); });   // clicar num item ainda dispara antes
      // foto
      coFotoBtn.addEventListener("click", function () { if (coFotoInput) coFotoInput.click(); });
      coFotoInput.addEventListener("change", function () {
        var f = coFotoInput.files && coFotoInput.files[0];
        coFotoInput.value = "";              // permite reescolher o mesmo arquivo depois
        if (f) escolherFoto(f);
      });
      coPreview.querySelector(".co-foto-x").addEventListener("click", function () { limparFoto(); });
      // áudio
      coAudioBtn.addEventListener("click", function () { toggleGravar(); });

      // presença: qualquer atividade me mantém "online" e reprograma o timer de "ausente" (Sprint 1.13)
      if (!presWired) {
        presWired = true;
        var reAtiv = function () { marcarAtividade(); };
        ["mousemove", "keydown", "touchstart", "click"].forEach(function (ev) { document.addEventListener(ev, reAtiv, { passive: true }); });
      }

      assinarRealtime();
    }

    function pronto() { return document.querySelector("nav.sidebar") && document.querySelector("main") && SB() && perfil(); }
    function tentarIniciar() {
      if (montado || checagemFeita) return;
      if (!pronto()) return;
      checagemFeita = true;
      SB().from("feature_flags").select("habilitado").eq("chave", FLAG).maybeSingle().then(function (r) {
        var on = !!(r && r.data && r.data.habilitado);
        if (on && podeVer()) { try { montarUI(); montado = true; carregarFlagTranscricao(); } catch (e) { } }
      }, function () { });
    }
    // Flag da transcrição (Sprint 1.8): só mostra o estado de transcrição quando ligada
    // (ligar só depois do worker de IA estar no ar). Off => áudios tocam sem "Transcrevendo…".
    function carregarFlagTranscricao() {
      var sb = SB(); if (!sb) return;
      try {
        sb.from("feature_flags").select("habilitado").eq("chave", "central_transcricao").maybeSingle().then(function (r) {
          transcrOn = !!(r && r.data && r.data.habilitado);
          if (transcrOn && canalAtual) carregarMsgs(true);   // re-renderiza pra já mostrar os estados
        }, function () { });
      } catch (e) { }
    }
    var bootTent = 0;
    var iv = setInterval(function () { if (montado || checagemFeita || ++bootTent > 900) { clearInterval(iv); return; } tentarIniciar(); }, 700);   // (1.14) teto: não roda pra sempre se pronto() nunca ficar true
    if (document.readyState !== "loading") tentarIniciar();
  } catch (e) { /* módulo opcional: qualquer erro aqui não afeta o Painel */ }
})();
