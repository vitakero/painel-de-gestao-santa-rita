/* CENTRAL PWA SW — Service Worker do Painel Santa Rita (Sprint 2.5).
   Mínimo e SEGURO por decisão de arquitetura:
   - NÃO cacheia o shell (index.html tem dados assados no publish + a chave anônima) →
     online SEMPRE busca fresco, nunca serve dado velho da Central.
   - NÃO intercepta NADA do Supabase (RPC/Broadcast/Storage) nem cross-origin → passam
     direto, nunca são cacheados (nada da operação/JWT/RPC fica guardado).
   - Só existe para (1) tornar o painel INSTALÁVEL no celular e (2) preparar o Push (Sprint 2.6).
   - Offline = tela simples "Sem conexão" (não tenta operar offline).
   - Atualização CONTROLADA: só troca quando o usuário clica "Atualizar".
   Trocar o conteúdo deste arquivo dispara a detecção de nova versão no navegador. */
var VERSAO = "sr-pwa-v1";
var OFFLINE_KEY = "offline-sr";   // chave interna no Cache Storage (não é arquivo real)

var OFFLINE_HTML =
  '<!doctype html><html lang="pt-br"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width, initial-scale=1">' +
  '<title>Sem conexão — Painel Santa Rita</title>' +
  "<style>html,body{height:100%;margin:0}body{display:flex;align-items:center;justify-content:center;" +
  "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0f1a12;color:#e8f0ea;" +
  "text-align:center;padding:24px;box-sizing:border-box}.c{max-width:320px}h1{font-size:20px;margin:0 0 8px}" +
  "p{color:#a9b7ad;font-size:14px;line-height:1.5;margin:0}.b{margin-top:18px;background:#28a745;color:#fff;" +
  "border:0;border-radius:10px;padding:11px 20px;font-size:15px;font-weight:600;cursor:pointer}</style></head>" +
  '<body><div class="c"><h1>Sem conexão</h1><p>O Painel Santa Rita precisa de internet para funcionar. ' +
  "Verifique sua conexão e tente de novo.</p>" +
  '<button class="b" onclick="location.reload()">Tentar de novo</button></div></body></html>';

function respostaOffline() {
  return new Response(OFFLINE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

self.addEventListener("install", function (e) {
  // guarda a página de offline; NÃO chama skipWaiting (a troca espera o usuário)
  e.waitUntil(caches.open(VERSAO).then(function (c) { return c.put(OFFLINE_KEY, respostaOffline()); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (ks) {
      return Promise.all(ks.map(function (k) { if (k !== VERSAO && k.indexOf("sr-pwa") === 0) return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  // Só tratamos NAVEGAÇÕES (abrir/recarregar a página). Todo o resto — inclusive TODAS as
  // chamadas ao Supabase (RPC/Broadcast/Storage) e qualquer cross-origin — passa direto,
  // sem interceptar e sem cachear. É o que garante "não guardar dados da operação".
  if (req.method !== "GET" || req.mode !== "navigate") return;
  e.respondWith(
    fetch(req).catch(function () {
      return caches.open(VERSAO).then(function (c) { return c.match(OFFLINE_KEY); })
        .then(function (r) { return r || respostaOffline(); });
    })
  );
});

// Atualização controlada: o cliente manda "skipWaiting" quando o usuário clica "Atualizar".
self.addEventListener("message", function (e) {
  if (e.data === "skipWaiting") self.skipWaiting();
});
