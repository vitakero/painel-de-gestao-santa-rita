// AVARIAS · PILOTO (etapa 3,6, 29/09/2026) — a tela DENTRO do Painel, compactada e aberta só ao abrir a aba.
//
// O que este teste prova, no output/index.html gerado pelo build (sem dado real, sem a nuvem):
//   1. o build tem o pacote (#avPacote, um só, no fim da página, depois do tema escuro) e o carregador (window.avAbrir);
//   2. o pacote abre (base64 -> gzip -> JSON), o código compila e monta window.AV.abrir; entraram TODOS os arquivos da tela;
//   3. o CSS escuro existe e sai do MESMO gerador do Painel; o CSS do módulo não está solto no Painel;
//   4. SOMENTE LEITURA: nenhum caminho de gravação (rpc/insert/update/upsert/delete, nem outro canal) no código do módulo;
//   5. o menu Avarias só aparece para o master (o mesmo nav-mo de Despesas/FLV), sem mudar nenhuma outra permissão;
//   6. a página Avarias não abre nada sem master (o carregador RODA aqui, com um navegador de mentira);
//   7. o index.html não passou do limite do aviso da montagem (12 MB contados em letras);
//   8. a tela não usa classe nem id que o Painel já usa em outro lugar (senão um pisa no outro).
// Rodar depois do build:   npx tsx scripts/demoDashboard.ts && node scripts/testes/avarias-pacote.test.cjs
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm"), zlib = require("zlib");

const RAIZ = path.join(__dirname, "..", "..");
const TELA = path.join(RAIZ, "scripts", "avarias", "tela");
const HTML = fs.readFileSync(path.join(RAIZ, "output", "index.html"), "utf8");
const TS = fs.readFileSync(path.join(RAIZ, "scripts", "demoDashboard.ts"), "utf8");

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const a = typeof obtido === "object" ? JSON.stringify(obtido) : String(obtido);
  const b = typeof esperado === "object" ? JSON.stringify(esperado) : String(esperado);
  const bate = a === b;
  console.log((bate ? "OK    " : "FALHA ") + nome + (bate ? "" : "  -> obtido " + a.slice(0, 300) + " · esperado " + b.slice(0, 300)));
  bate ? ok++ : falhou++;
}
const vale = (nome, cond, det) => {
  console.log((cond ? "OK    " : "FALHA ") + nome + (cond || det === undefined ? "" : "  -> " + String(typeof det === "object" ? JSON.stringify(det) : det).slice(0, 400)));
  cond ? ok++ : falhou++;
};
function esbuild() { try { return require("esbuild"); } catch (e) { return null; } }
// um trecho de TypeScript do build, de "ini" até "fim" (exclusive), já em JavaScript
function trechoDoBuild(ini, fim) {
  const i = TS.indexOf(ini), f = TS.indexOf(fim, i + 1);
  if (i < 0 || f < 0) throw new Error("não achei no demoDashboard.ts: " + ini);
  const eb = esbuild();
  if (!eb) return null;
  return eb.transformSync(TS.slice(i, f), { loader: "ts" }).code;
}
// o corpo de uma função (do "function nome(" até a chave que fecha), contando chaves
function funcao(txt, cabeca) {
  const i = txt.indexOf(cabeca); if (i < 0) return "";
  let j = txt.indexOf("{", i), prof = 0;
  for (; j < txt.length; j++) { if (txt[j] === "{") prof++; else if (txt[j] === "}") { prof--; if (!prof) return txt.slice(i, j + 1); } }
  return "";
}

// ---------- ==AVARIAS-CHAVE== desligada: o Painel sai EXATAMENTE como antes da etapa 3,6 ----------
// A chave mora no demoDashboard.ts (AV_PILOTO_NO_AR). Desligada, o build não lê a tela, não põe pacote nem carregador,
// e a aba é o "em construção" de sempre, com o botão pela permissão de sempre. Para testar o piloto com a chave
// desligada: AV_PILOTO_TESTE=1 npx tsx scripts/demoDashboard.ts && node scripts/testes/avarias-pacote.test.cjs
const CHAVE_LIGADA = /const AV_PILOTO_NO_AR: boolean = true\b/.test(TS);
const MONTADO_COM_PILOTO = HTML.indexOf("==AVARIAS-CARREGADOR==") >= 0;
vale("a chave ==AVARIAS-CHAVE== existe no build", /const AV_PILOTO_NO_AR: boolean = (true|false)\b/.test(TS));
vale("nenhum pedaço de código do build vazou como texto no Painel (AV_PILOTO_NO_AR)", HTML.indexOf("AV_PILOTO_NO_AR") < 0);
if (CHAVE_LIGADA && !MONTADO_COM_PILOTO) { vale("chave LIGADA, mas o index.html não tem o carregador (montagem velha?)", false); fim(); }
if (!MONTADO_COM_PILOTO) {
  console.log("\n== Avarias ADORMECIDA (chave desligada): igual ao que estava no ar antes da etapa 3,6 ==");
  vale("sem pacote #avPacote", HTML.indexOf('id="avPacote"') < 0);
  vale("sem carregador (window.avAbrir)", HTML.indexOf("window.avAbrir = function") < 0);
  vale("nada do código da tela no Painel (marcas ==AV-…== ausentes)", !/==AV-[A-Z]/.test(HTML));
  const sec = (HTML.match(/<section id="page-avarias" class="page">([\s\S]*?)<\/section>/) || [, ""])[1];
  vale("a página Avarias é o \"Esta tela está em construção.\" de sempre", /<h2[^>]*>Avarias<\/h2><p[^>]*>Esta tela está em construção\.<\/p>/.test(sec) && sec.indexOf("avRaiz") < 0);
  const bot = HTML.match(/<button class="([^"]*)" data-page="avarias"([^>]*)>/g) || [];
  eq("o botão do menu é o de sempre (class=\"nav-item\", sem nav-mo, sem display:none)", bot, ['<button class="nav-item" data-page="avarias">']);
  fim();
}
// ---------- as peças, tiradas do Painel gerado ----------
const TAG_PACOTE = /<script type="application\/octet-stream" id="avPacote">([^<]*)<\/script>/g;
const pacotes = [...HTML.matchAll(TAG_PACOTE)];
const scripts = [...HTML.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].map((m) => ({ attrs: m[1], corpo: m[2], em: m.index }));
const carregadores = scripts.filter((s) => s.corpo.indexOf("==AVARIAS-CARREGADOR==") >= 0 && s.corpo.indexOf("window.avAbrir = function") >= 0);
const CARREGADOR = carregadores.length ? carregadores[0].corpo : "";
let PAC = null, erroPacote = "";
try { PAC = pacotes.length ? JSON.parse(zlib.gunzipSync(Buffer.from(pacotes[0][1], "base64")).toString("utf8")) : null; } catch (e) { erroPacote = e.message; }
const ARQS_JS = (TS.match(/const AV_ARQS_JS = \[([^\]]*)\]/) || [, ""])[1].match(/"([^"]+)"/g).map((s) => s.slice(1, -1) + ".js");
const ARQS_CSS = (TS.match(/const AV_ARQS_CSS = \[([^\]]*)\]/) || [, ""])[1].match(/"([^"]+)"/g).map((s) => s.slice(1, -1) + ".css");
const FONTE_JS = ARQS_JS.map((f) => fs.readFileSync(path.join(TELA, f), "utf8")).join("\n;\n");
const FONTE_CSS = ARQS_CSS.map((f) => fs.readFileSync(path.join(TELA, f), "utf8")).join("\n");

console.log("\n== 1. O build tem o pacote e o carregador ==");
eq("um pacote #avPacote, e um só", pacotes.length, 1);
// SEM hora da montagem no pacote: o robô só publica quando o Painel MUDA; uma hora aqui faria toda montagem parecer nova.
eq("o pacote não carrega hora da montagem (senão o robô publicaria o Painel a cada rodada)", PAC ? Object.keys(PAC).sort() : null, ["css", "cssEscuro", "js", "minificado"]);
{
  const iPac = pacotes.length ? pacotes[0].index : -1, iFim = HTML.lastIndexOf("</body>"), iTema = HTML.indexOf('<style id="temaEscuroCss">');
  vale("o pacote fica antes do ÚLTIMO </body> (o fim de verdade da página)", iPac > 0 && iPac < iFim && /^\s*$/.test(HTML.slice(iPac + pacotes[0][0].length, iFim)));
  vale("o pacote entrou DEPOIS do tema escuro (o gerador do noturno não passou por ele)", iTema > 0 && iPac > iTema);
  vale("o pacote não é código que o navegador rode (type=application/octet-stream)", pacotes.length === 1 && /type="application\/octet-stream"/.test(pacotes[0][0]));
}
eq("um carregador (window.avAbrir), e um só", carregadores.length, 1);
vale("o carregador compila", (() => { try { new Function(CARREGADOR); return true; } catch (e) { return false; } })());
vale("o carregador é pequeno (menos de 8 mil letras: é a única parte que todo mundo baixa aberta)", CARREGADOR.length > 0 && CARREGADOR.length < 8000, CARREGADOR.length);
vale("abrir a aba Avarias chama o carregador (no mesmo lugar do Compra × Venda)",
  /btn\.dataset\.page==="projecao" && window\.cxvAbrir\) window\.cxvAbrir\(\);[^\n]*\n\s*if\(btn\.dataset\.page==="avarias" && window\.avAbrir\) window\.avAbrir\(\);/.test(HTML));
vale("o restaurador da última aba reabre pelo MESMO clique (b.click) — e o carregador cobre quem chega atrasado",
  /const b=document\.querySelector\('\.nav-item\[data-page="'\+pg\+'"\]'\); if\(b\) b\.click\(\);/.test(HTML) && /localStorage\.getItem\("ui_pagina_atual"\) === "avarias"\) window\.avAbrir\(\)/.test(CARREGADOR));
{
  const sec = (HTML.match(/<section id="page-avarias" class="page">([\s\S]*?)<\/section>/) || [, ""])[1];
  vale("a página Avarias tem a raiz #avRaiz com \"Carregando…\"", /<div id="avRaiz">[\s\S]*Carregando…/.test(sec));
  vale("…identificada como piloto (\"Avarias · Piloto\")", sec.indexOf("Avarias · Piloto") >= 0);
  vale("…e nada da tela solto nela (nenhum <script>/<style> na seção)", !/<script|<style/.test(sec));
}

console.log("\n== 2. O pacote abre, o código compila e entraram todos os arquivos ==");
vale("o pacote decodifica (base64 -> gzip -> JSON)", !!PAC, erroPacote);
const P = PAC || { js: "", css: "", cssEscuro: "" };
vale("tem js, css e cssEscuro (textos, não vazios)", ["js", "css", "cssEscuro"].every((k) => typeof P[k] === "string" && P[k].length > 100));
vale("o JS do pacote compila", (() => { try { new vm.Script(P.js); return true; } catch (e) { console.log("      " + e.message); return false; } })());
{
  const naPasta = fs.readdirSync(TELA).filter((f) => /\.(js|css)$/.test(f)).sort();
  eq("TODO .js/.css da pasta da tela está na lista do build (nenhum esquecido, nenhum a mais)", naPasta, ARQS_JS.concat(ARQS_CSS).sort());
  eq("ordem do código: consultas e base antes das áreas", ARQS_JS.slice(0, 3).join(","), "consultas.js,base.js,painel.js");
}
eq("o CSS do pacote é o CSS da tela de agora (se falhar: rode o build de novo)", P.css === FONTE_CSS, true);
{
  const eb = esbuild();
  const esperado = P.minificado && eb ? eb.transformSync(FONTE_JS, { loader: "js", minify: true, legalComments: "none", charset: "utf8" }).code : FONTE_JS;
  eq("o JS do pacote é o código da tela de agora" + (P.minificado ? " (minificado pelo esbuild)" : " (sem minificar)"), P.js === esperado, true);
}
// executa o código do pacote num navegador de mentira mínimo: ele tem de montar window.AV.abrir e as quatro áreas
{
  const ctx = { console: { log() {}, error() {}, warn() {} }, setTimeout() { return 0; }, clearTimeout() {}, localStorage: { getItem: () => null, setItem() {} },
    document: { addEventListener() {}, getElementById: () => null, documentElement: { classList: { add() {}, remove() {} } }, querySelector: () => null, querySelectorAll: () => [] },
    navigator: { userAgent: "teste" }, location: { hash: "", search: "" }, matchMedia: () => ({ matches: false, addEventListener() {} }) };
  ctx.window = ctx; vm.createContext(ctx);
  let erro = "";
  try { vm.runInContext(P.js, ctx); } catch (e) { erro = e.message; }
  vale("o código do pacote roda e define window.AV.abrir", !erro && ctx.AV && typeof ctx.AV.abrir === "function", erro);
  vale("as consultas da tela vieram (window.AV_CONSULTAS)", !!ctx.AV_CONSULTAS && Object.keys(ctx.AV_CONSULTAS).length > 10);
  eq("as quatro áreas vieram", Object.keys((ctx.AV && ctx.AV.areas) || {}).sort(), ["fornecedores", "pendencias", "produtos", "resumo"]);
}

console.log("\n== 3. O modo noturno do módulo sai do MESMO gerador do Painel ==");
vale("o CSS escuro vem embrulhado em @media screen (papel impresso nunca escurece, como no Painel)", /^@media screen\{[\s\S]*\}$/.test(P.cssEscuro));
{
  const regras = (P.cssEscuro.match(/html\.tema-escuro \.av/g) || []).length;
  vale("o CSS escuro pinta a tela (regras html.tema-escuro .av…)", regras > 50, regras);
  vale("…inclusive o cartão (.av-card ganha fundo escuro)", /html\.tema-escuro \.av-card\{background:#1c212a/.test(P.cssEscuro));
  const js = trechoDoBuild("const PAL_BG: Record<string,string>", "function injetarTemaEscuro(");
  if (!js) console.log("      (sem esbuild aqui: a comparação com o gerador ficou de fora)");
  else {
    const c = { globalThis: {} }; c.globalThis = c;
    vm.runInNewContext(js + "\n;globalThis.__p = temaProcessarCss; globalThis.__i = temaInlineDark;", c);
    eq("o CSS escuro é EXATAMENTE temaProcessarCss(css da tela) + temaInlineDark(código da tela)", P.cssEscuro, "@media screen{" + c.__p(FONTE_CSS) + c.__i(FONTE_JS) + "}");
  }
}
{
  // classes que só a tela tem: se aparecerem no index.html, o CSS do módulo estaria solto (e o noturno passaria 2 vezes)
  const soDaTela = [".av-topo", ".av-abas", ".av-card", ".av-filtros", ".av-dado"];
  eq("o CSS do módulo NÃO está solto no Painel", soDaTela.filter((c) => HTML.indexOf(c + "{") >= 0 || HTML.indexOf(c + " ") >= 0 || HTML.indexOf(c + ",") >= 0), []);
  const tema = (HTML.match(/<style id="temaEscuroCss">([\s\S]*?)<\/style>/) || [, ""])[1];
  eq("…e o tema escuro do Painel não tem regra da tela (não foi processado duas vezes)", soDaTela.filter((c) => tema.indexOf("html.tema-escuro " + c) >= 0), []);
}

console.log("\n== 4. SOMENTE LEITURA: nenhum caminho de gravação no código do módulo ==");
const GRAVAR = /\.\s*(rpc|insert|update|upsert|delete)\s*\(/g;
const OUTROS = /\bfunctions\s*\.\s*invoke\b|\.\s*storage\s*\.|\bfetch\s*\(|\bXMLHttpRequest\b|\bsendBeacon\b|\bcreateClient\b|\bWebSocket\b/g;
function fromSemSelect(js) {
  const r = [], re = /(\w*)\.\s*from\s*\(([^()]*)\)\s*(\.\s*\w+)?/g; let m;
  while ((m = re.exec(js))) { if (/Array$/.test(m[1])) continue; if (!m[3] || !/^\.\s*select$/.test(m[3])) r.push(m[0]); }
  return r;
}
eq("pacote: nenhum .rpc( .insert( .update( .upsert( .delete(", (P.js.match(GRAVAR) || []), []);
eq("pacote: nenhum outro canal (fetch, XMLHttpRequest, sendBeacon, storage, functions, createClient, WebSocket)", (P.js.match(OUTROS) || []), []);
eq("pacote: todo from(…) do cliente da nuvem é seguido de .select(", fromSemSelect(P.js), []);
vale("pacote: a leitura existe (from(…).select(…) aparece — o teste não está olhando o vazio)", /\.from\([^()]*\)\.select\(/.test(P.js));
for (const f of ARQS_JS) {
  const s = fs.readFileSync(path.join(TELA, f), "utf8");
  eq("fonte " + f + ": sem gravação e sem outro canal", (s.match(GRAVAR) || []).concat(s.match(OUTROS) || []).concat(fromSemSelect(s)), []);
}
eq("o carregador também não grava nem chama o banco", (CARREGADOR.match(GRAVAR) || []).concat(CARREGADOR.match(OUTROS) || []).concat(CARREGADOR.match(/__SB\s*\./g) || []), []);
{
  // a TRAVA do build (avCaminhoDeGravacao) RODA aqui: recusa o que grava, aceita o que só lê
  const src = funcao(TS, "function avCaminhoDeGravacao(").replace("(js: string): string", "(js)").replace("let m: RegExpExecArray | null;", "let m;");
  const trava = src ? new Function(src + "\nreturn avCaminhoDeGravacao;")() : null;
  vale("a trava do build existe", typeof trava === "function");
  if (trava) {
    const casos = { 'sb.from("avaria_eventos").insert({a:1})': true, 'sb.from("x").update({a:1}).eq("id",1)': true, 'sb.from("x").upsert({})': true,
      'sb.from("x").delete().eq("id",1)': true, 'sb.rpc("avaria_registrar_acerto",{})': true, 'window.__SB.storage.from("b").upload(f)': true,
      'fetch("https://x/rest/v1/avaria_eventos",{method:"POST"})': true, 'sb.from(t)': true, 'supabase.createClient(u,k)': true,
      'sb.from(q.visao).select(q.colunas,{count:"exact"}).eq("a",1).order("b").range(0,499)': false, 'Array.from(lista).map(f)': false,
      'Uint8Array.from(x)': false, 'delete cache[k]': false, 'el.insertAdjacentHTML("beforeend","x")': false };
    const errados = Object.entries(casos).filter(([js, grava]) => !!trava(js) !== grava).map(([js]) => js);
    eq("a trava do build recusa gravação e aceita leitura (" + Object.keys(casos).length + " casos)", errados, []);
    eq("a trava do build aceita a tela de agora", trava(FONTE_JS), "");
  }
}

console.log("\n== 5. Menu: o botão Avarias só aparece para o master (nav-mo), sem mexer nas outras permissões ==");
const BOTOES = [...HTML.matchAll(/<button class="(nav-item[^"]*)" data-page="([^"]+)"( style="([^"]*)")?/g)].map((m) => ({ pagina: m[2], classes: m[1].split(/\s+/), estilo: m[4] || "" }));
{
  const av = BOTOES.find((b) => b.pagina === "avarias");
  vale("o botão Avarias existe (a tela Acessos continua listando a chave \"avarias\")", !!av);
  vale("…com a classe nav-mo e escondido de saída (display:none), igual a Despesas e FLV", !!av && av.classes.indexOf("nav-mo") >= 0 && /display:\s*none/.test(av.estilo));
  eq("as abas só-master são exatamente Despesas, FLV e Avarias (nenhuma outra mudou)", BOTOES.filter((b) => b.classes.indexOf("nav-mo") >= 0).map((b) => b.pagina).sort(), ["avarias", "despesas", "flv"]);
  vale("o pré-carregamento do master mostra as abas só-master sem piscar (mecanismo de sempre)", HTML.indexOf('_nm.textContent=".nav-item.nav-mo{display:flex!important}"') >= 0);
}
// roda o applyPerms DE VERDADE (tirado do Painel gerado) com um menu de mentira igual ao real
function rodarPermissoes(perfil, paginaAtiva) {
  const src = funcao(HTML, "function applyPerms(perfil){");
  const cliques = [];
  const botoes = BOTOES.map((b) => {
    const cl = new Set(b.classes);
    return { dataset: { page: b.pagina }, style: { display: /display:\s*none/.test(b.estilo) ? "none" : "" },
      classList: { contains: (c) => cl.has(c), remove: (c) => cl.delete(c), add: (c) => cl.add(c), toggle: (c, v) => (v ? cl.add(c) : cl.delete(c)) },
      click() { cliques.push(b.pagina); }, get travado() { return cl.has("nav-locked"); } };
  });
  const doc = { querySelectorAll: () => botoes, querySelector: (s) => (s === ".page.ativo" ? { id: "page-" + paginaAtiva } : null) };
  new Function("document", "window", src + "\napplyPerms(" + JSON.stringify(perfil) + ");")(doc, {});
  const de = (p) => botoes.find((b) => b.dataset.page === p);
  return { de, botoes, cliques };
}
{
  const TODAS = BOTOES.map((b) => b.pagina);
  const m = rodarPermissoes({ is_master: true, paginas: [] }, "vendas");
  eq("master: o botão Avarias aparece", m.de("avarias").style.display, "");
  eq("master: nenhum botão travado ou escondido", m.botoes.filter((b) => b.style.display === "none" || b.travado).map((b) => b.dataset.page), []);
  const t = rodarPermissoes({ is_master: false, aprovado: true, paginas: TODAS }, "vendas");
  eq("funcionário com TODAS as chaves (até \"avarias\"): o botão Avarias fica escondido", t.de("avarias").style.display, "none");
  eq("…e todo o resto aparece destravado, como antes (só as 3 abas só-master somem)", t.botoes.filter((b) => b.style.display === "none" || b.travado).map((b) => b.dataset.page).sort(), ["avarias", "despesas", "flv"]);
  const v = rodarPermissoes({ is_master: false, aprovado: true, paginas: ["vendas", "avarias"] }, "avarias");
  eq("funcionário parado na aba Avarias com a chave: o botão continua escondido", v.de("avarias").style.display, "none");
  const e = rodarPermissoes({ is_master: false, aprovado: true, paginas: ["escala"] }, "avarias");
  eq("funcionário sem a chave que reabre na aba Avarias é levado para a primeira aba liberada", e.cliques, ["escala"]);
  eq("…e a regra das outras abas não mudou (Regulamento aberto a todos; Vendas travada sem a chave)", [e.de("regulamento").travado, e.de("vendas").travado, e.de("escala").travado], [false, true, false]);
}

console.log("\n== 6. A página Avarias não abre nada sem master (o carregador RODA num navegador de mentira) ==");
// navegador de mentira: só o que o carregador e a tela encostam; conta cada leitura do pacote e cada coisa criada
function navegador(opc) {
  const reg = { leuPacote: 0, criados: [], sb: [], timers: 0, abrir: [], erros: [] };
  const el = (tag, id) => ({ tagName: tag, id: id || "", innerHTML: "", text: "", textContent: "", filhos: [],
    classList: { _c: new Set(), contains(c) { return this._c.has(c); }, add(c) { this._c.add(c); }, remove(c) { this._c.delete(c); }, toggle() {} },
    appendChild(f) { this.filhos.push(f); if (f.tagName === "script") rodar(f.text); return f; }, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] });
  const raiz = el("div", "avRaiz"), pagina = el("section", "page-avarias");
  if (opc.ativa !== false) pagina.classList.add("ativo");
  const pacote = opc.pacote === null ? null : { id: "avPacote", get textContent() { reg.leuPacote++; return opc.pacote === undefined ? pacotes[0][1] : opc.pacote; } };
  const head = el("head"), body = el("body");
  const todos = () => head.filhos.concat(body.filhos);
  const document = { readyState: "complete", head, body, documentElement: el("html"),
    getElementById: (id) => (id === "avRaiz" ? raiz : id === "page-avarias" ? pagina : id === "avPacote" ? pacote : todos().find((x) => x.id === id) || null),
    createElement: (t) => { reg.criados.push(t); return el(t); }, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] };
  // cliente da nuvem de mentira: anota TODO acesso e devolve "zero linhas" para qualquer leitura
  const cadeia = new Proxy(function () {}, { get(t, k) {
    if (k === "then") return (a, b) => Promise.resolve({ data: [], count: 0, error: null }).then(a, b);
    reg.sb.push(String(k)); return () => cadeia; } });
  const sb = new Proxy({}, { get(t, k) { reg.sb.push(String(k)); return () => cadeia; } });
  const ctx = { document, console: { log() {}, warn() {}, error: (...a) => reg.erros.push(a.map(String).join(" ")) },
    localStorage: { getItem: (k) => (opc.ultimaAba && k === "ui_pagina_atual" ? opc.ultimaAba : null), setItem() {} },
    setTimeout: () => ++reg.timers, clearTimeout() {}, performance, atob, Blob, Response,
    DecompressionStream: opc.semDescompactar ? undefined : DecompressionStream,
    navigator: { userAgent: "teste" }, location: { hash: "", search: "" }, matchMedia: () => ({ matches: false, addEventListener() {} }) };
  if (opc.perfil !== undefined) { ctx.__PERFIL = opc.perfil; ctx.__SB = sb; }
  ctx.window = ctx; vm.createContext(ctx);
  function rodar(js) {   // o <script> que o carregador injeta roda no MESMO "navegador"; AV.abrir fica espionado
    vm.runInContext(js, ctx);
    if (ctx.AV && typeof ctx.AV.abrir === "function") { const orig = ctx.AV.abrir; ctx.AV.abrir = function (r) { reg.abrir.push(r); try { return orig.apply(this, arguments); } catch (e) { reg.erros.push(String(e)); } }; }
  }
  vm.runInContext(CARREGADOR, ctx);
  return { ctx, reg, raiz, head, abrir: () => ctx.avAbrir() };
}
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
async function ate(cond, ms = 5000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (cond()) return true; await espera(20); } return false; }
const MSG_PILOTO = "Avarias está em piloto: só o master acessa.";

(async () => {
  {
    const n = navegador({});   // ainda sem login (recarregou já nesta aba): espera o perfil, sem abrir nada
    vale("sem login ainda: mostra \"Carregando…\" e espera o perfil", n.raiz.innerHTML.indexOf("Carregando…") >= 0 && n.reg.timers === 1);
    eq("sem login ainda: o pacote não foi lido e nada foi criado", [n.reg.leuPacote, n.reg.criados.length, typeof n.ctx.AV], [0, 0, "undefined"]);
  }
  {
    const n = navegador({ perfil: { is_master: false, aprovado: true, paginas: ["avarias", "avarias_registrar", "avarias_conferir"] } });
    n.abrir(); await espera(60);
    vale("NÃO master (mesmo com as 3 chaves de Avarias): \"" + MSG_PILOTO + "\"", n.raiz.innerHTML.indexOf(MSG_PILOTO) >= 0, n.raiz.innerHTML);
    eq("NÃO master: o pacote nem foi lido", n.reg.leuPacote, 0);
    eq("NÃO master: nenhum <script>/<style> criado e window.AV não existe", [n.reg.criados.length, typeof n.ctx.AV], [0, "undefined"]);
    eq("NÃO master: nada foi pedido à nuvem", n.reg.sb, []);
  }
  {
    const n = navegador({ perfil: { is_master: true, aprovado: true, paginas: [] } });   // a aba já estava aberta: abre sozinho
    const abriu = await ate(() => n.reg.abrir.length > 0);
    vale("master: o pacote abre e a tela é chamada com a raiz (AV.abrir(#avRaiz))", abriu && n.reg.abrir[0] === n.raiz, n.reg.erros);
    eq("master: o pacote foi lido UMA vez", n.reg.leuPacote, 1);
    eq("master: injetou 2 <style> (claro e escuro) e 1 <script>", n.reg.criados.slice().sort(), ["script", "style", "style"]);
    const s1 = n.head.filhos.find((x) => x.id === "avCss"), s2 = n.head.filhos.find((x) => x.id === "avCssEscuro");
    eq("master: o <style> claro é o CSS do pacote, o escuro é o CSS escuro do pacote", [!!s1 && s1.textContent === P.css, !!s2 && s2.textContent === P.cssEscuro], [true, true]);
    vale("master: o tempo de abrir o pacote ficou medido (window.__avPacoteMs)", typeof n.ctx.__avPacoteMs === "number", n.ctx.__avPacoteMs);
    await espera(80);
    vale("master: a tela leu a nuvem (from/select…)", n.reg.sb.indexOf("from") >= 0 && n.reg.sb.indexOf("select") >= 0, n.reg.sb.slice(0, 12));
    eq("master: e NUNCA pediu gravação (rpc/insert/update/upsert/delete)", n.reg.sb.filter((k) => /^(rpc|insert|update|upsert|delete|storage|functions)$/.test(k)), []);
    n.abrir(); await ate(() => n.reg.abrir.length > 1);
    eq("master: abrir de novo não abre o pacote de novo (1 leitura), só chama a tela", [n.reg.leuPacote, n.reg.abrir.length, n.reg.criados.length], [1, 2, 3]);
  }
  {
    const n = navegador({ perfil: { is_master: true }, pacote: "isto-nao-e-um-pacote" });
    await ate(() => n.raiz.innerHTML.indexOf("Não deu para abrir Avarias") >= 0);
    vale("pacote estragado: mensagem clara, sem quebrar o Painel", n.raiz.innerHTML.indexOf("Não deu para abrir Avarias agora. O resto do Painel continua funcionando.") >= 0, n.raiz.innerHTML);
    eq("pacote estragado: nada foi injetado", n.reg.criados.length, 0);
  }
  {
    const n = navegador({ perfil: { is_master: true }, pacote: null });
    await ate(() => n.raiz.innerHTML.indexOf("não entrou") >= 0);
    vale("montagem sem o pacote: \"Avarias não entrou nesta atualização do Painel\"", n.raiz.innerHTML.indexOf("Avarias não entrou nesta atualização do Painel.") >= 0, n.raiz.innerHTML);
  }
  {
    const n = navegador({ perfil: { is_master: true }, semDescompactar: true });
    await ate(() => n.raiz.innerHTML.indexOf("antigo") >= 0);
    vale("navegador sem DecompressionStream: pede para atualizar o navegador", n.raiz.innerHTML.indexOf("antigo demais para abrir Avarias") >= 0, n.raiz.innerHTML);
    eq("…e não injetou nada", n.reg.criados.length, 0);
  }
  {
    const n = navegador({ perfil: { is_master: true }, ativa: false, ultimaAba: "avarias" });
    await espera(80);
    eq("fora da aba (cheguei atrasado, mas a aba ainda não abriu): lê o pacote e não monta a tela", n.reg.abrir.length, 0);
  }
  tamanhoEColisoes();
  fim();
})().catch((e) => { console.log("FALHA o teste quebrou: " + (e && e.stack || e)); falhou++; fim(); });

function tamanhoEColisoes() {
  console.log("\n== 7. Tamanho: o Painel não passou do limite do aviso da montagem ==");
  const LIMITE = 12 * 1048576;   // o vigia do build conta LETRAS (comPacote.length) e avisa a partir de 12 MB
  vale("index.html abaixo de 12 MB contados em letras (" + (HTML.length / 1048576).toFixed(3) + " MB; folga " + Math.round((LIMITE - HTML.length) / 1024) + " KB)", HTML.length < LIMITE);
  vale("o vigia do build mede o arquivo COM o pacote (é o que vai ao ar)", /const MB_PAINEL = comPacote\.length \/ 1048576;/.test(TS));
  const bruto = Buffer.byteLength(FONTE_JS) + Buffer.byteLength(FONTE_CSS) + Buffer.byteLength(P.cssEscuro);
  vale("o pacote (" + Math.round(pacotes[0][1].length / 1024) + " KB) é bem menor que a tela crua (" + Math.round(bruto / 1024) + " KB)", pacotes[0][1].length < bruto / 2);

  console.log("\n== 8. A tela não pisa no Painel (classe ou id que o Painel já usa em outro lugar) ==");
  // o Painel SEM a parte de Avarias (a seção, o carregador e o pacote são de Avarias)
  let resto = HTML.replace(/<section id="page-avarias" class="page">[\s\S]*?<\/section>/, "").replace(CARREGADOR, "").replace(TAG_PACOTE, "");
  const classesPainel = new Set([...resto.matchAll(/\.(av-[\w-]+)/g)].map((m) => m[1])
    .concat([...resto.matchAll(/class(?:Name)?\s*=\s*\\?["']([^"'\\]*)/g)].flatMap((m) => m[1].split(/\s+/)).filter((c) => /^av-/.test(c))));
  const idsPainel = new Set([...resto.matchAll(/\bid\s*=\s*\\?["'](av[\w-]*)/g)].map((m) => m[1]).concat([...resto.matchAll(/\.id\s*=\s*["'](av[\w-]*)/g)].map((m) => m[1])));
  const src = ARQS_JS.concat(ARQS_CSS).map((f) => fs.readFileSync(path.join(TELA, f), "utf8")).join("\n");
  const classesTela = new Set([...src.matchAll(/\.(av-[\w-]+)/g)].map((m) => m[1])
    .concat([...src.matchAll(/class(?:Name)?\s*=\s*\\?["']([^"'\\]*)/g)].flatMap((m) => m[1].split(/\s+/)).filter((c) => /^av-/.test(c))));
  const idsTela = new Set([...src.matchAll(/\bid\s*=\s*\\?["'](av[\w-]*)/g)].map((m) => m[1]).concat([...src.matchAll(/\.id\s*=\s*["'](av[\w-]*)/g)].map((m) => m[1]))
    .concat([...src.matchAll(/getElementById\(\s*["'](av[\w-]*)/g)].map((m) => m[1])));
  eq("nenhuma classe da tela já existe no Painel (ex.: a gaveta de Avisos do sino usa .av-gav e .av-vazio)", [...classesTela].filter((c) => classesPainel.has(c)).sort(), []);
  eq("nenhum id da tela já existe no Painel (ex.: a gaveta de Avisos do sino usa #avGaveta)", [...idsTela].filter((c) => c !== "avRaiz" && idsPainel.has(c)).sort(), []);
  eq("a tela não usa os ids do carregador (avPacote, avCss, avCssEscuro, avCodigo)", [...idsTela].filter((c) => ["avPacote", "avCss", "avCssEscuro", "avCodigo"].indexOf(c) >= 0), []);
}
function fim() {
  console.log("\navarias-pacote: " + ok + " passaram, " + falhou + " falharam");
  process.exit(falhou ? 1 : 0);
}
