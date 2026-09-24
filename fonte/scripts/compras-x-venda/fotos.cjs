// FOTOS da prévia do Compra × Venda (dados reais do VR), computador (1440) e celular (390).
//   node scripts/previa-compras-x-venda.cjs && node scripts/compras-x-venda/fotos.cjs
// Saída: .previa/cxv-fotos/NN-nome.png. Também mede se a página rola de lado no celular.
const fs = require("fs"), path = require("path"), os = require("os");
const { spawn } = require("child_process");
const RAIZ = path.join(__dirname, "..", "..");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PAG = path.join(RAIZ, ".previa", "previa-compras-x-venda.html");
const SAIDA = path.join(RAIZ, ".previa", "cxv-fotos");
fs.mkdirSync(SAIDA, { recursive: true });
for (const f of fs.readdirSync(SAIDA)) if (f.endsWith(".png")) fs.unlinkSync(path.join(SAIDA, f));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "cxv-fotos-"));
const esp = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const porta = 9400 + Math.floor(Math.random() * 300);
  const ch = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--remote-debugging-port=" + porta,
    "--user-data-dir=" + path.join(TMP, "perfil"), "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
    "--allow-file-access-from-files", "about:blank"], { stdio: "ignore" });
  let alvo = null;
  for (let i = 0; i < 80 && !alvo; i++) { await esp(250); try { alvo = (await (await fetch("http://127.0.0.1:" + porta + "/json")).json()).find((t) => t.type === "page"); } catch (e) {} }
  if (!alvo) { ch.kill(); throw new Error("Chrome não respondeu"); }
  const ws = new WebSocket(alvo.webSocketDebuggerUrl); let id = 0; const pend = {}; const erros = [];
  await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (m) => { const o = JSON.parse(m.data);
    if (o.id && pend[o.id]) { pend[o.id](o); delete pend[o.id]; return; }
    if (o.method === "Runtime.exceptionThrown") erros.push(((o.params.exceptionDetails.exception || {}).description || o.params.exceptionDetails.text).slice(0, 200)); };
  const cmd = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => { const r = await cmd("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
  const esperar = async (expr, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if ((await ev("!!(" + expr + ")")) === true) return true; await esp(100); } return false; };
  const clicar = async (sel, txt) => { const r = await ev(`(function(){ var l=[].slice.call(document.querySelectorAll(${JSON.stringify(sel)})); var e=${txt ? `l.filter(function(x){return x.textContent.indexOf(${JSON.stringify(txt)})>=0;})[0]` : "l[0]"}; if(!e) return 'NAO ACHEI'; e.click(); return 'ok'; })()`); if (r !== "ok") console.log("  ! não achei", sel, txt || ""); await esp(200); };
  await cmd("Page.enable"); await cmd("Runtime.enable");
  let W = 1440;
  const fotos = [];
  async function abrir(largura, altura) {
    W = largura;
    await cmd("Emulation.setDeviceMetricsOverride", { width: largura, height: altura, deviceScaleFactor: largura < 700 ? 2 : 1, mobile: largura < 700 });
    await cmd("Page.navigate", { url: "file://" + PAG }); await esperar("document.readyState==='complete'");
    if (!(await esperar("document.querySelector('#cxvRaiz .cxv-kpis')"))) console.log("  ! a tela não montou");
    await esp(300);
  }
  async function foto(nome, desc, alturaMax) {
    await esp(300);
    const larg = await ev("document.documentElement.scrollWidth");
    if (larg > W) console.log(`  ! ${nome}: a página rola de lado (${larg}px numa tela de ${W})`);
    const h = await ev(`Math.min(document.documentElement.scrollHeight, ${alturaMax || 2400})`);
    const r = await cmd("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: W, height: h, scale: 1 } });
    const arq = String(fotos.length + 1).padStart(2, "0") + "-" + nome + ".png";
    fs.writeFileSync(path.join(SAIDA, arq), Buffer.from(r.result.data, "base64"));
    fotos.push(arq); console.log("  foto:", arq, "—", desc);
  }
  const simular = async () => { await ev("window.scrollTo(0,0)"); }; // margem objetivo agora é a aprovada (24/09)
  const alvoRolar = (sel) => ev(`(function(){ var e=document.querySelector(${JSON.stringify(sel)}); if(e) window.scrollTo(0, e.getBoundingClientRect().top + scrollY - 70); return 1; })()`);

  // ===== COMPUTADOR =====
  await abrir(1440, 900);
    await simular();
  await foto("semana-atual-simulada", "Semana atual com a margem real no lugar da objetivo (simulação)", 1300);
  await clicar("tr.cxv-lin", "Açougue"); await alvoRolar("tr.cxv-lin.aberto");
  await cmd("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const r1 = await cmd("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(SAIDA, "03-detalhe-acougue.png"), Buffer.from(r1.result.data, "base64")); fotos.push("03-detalhe-acougue.png"); console.log("  foto: 03-detalhe-acougue.png — detalhe do setor");
  await clicar("tr.cxv-lin.aberto"); await ev("window.scrollTo(0,0)");
  await clicar(".cxv-k .cxv-nf");
  const r2 = await cmd("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(SAIDA, "04-notas-nao-finalizadas.png"), Buffer.from(r2.result.data, "base64")); fotos.push("04"); console.log("  foto: 04-notas-nao-finalizadas.png");
  await clicar(".cxv-x"); await clicar("[data-ped]");
  const r3 = await cmd("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(SAIDA, "05-pedidos-a-chegar.png"), Buffer.from(r3.result.data, "base64")); fotos.push("05"); console.log("  foto: 05-pedidos-a-chegar.png");
  await clicar(".cxv-x"); await clicar(".cxv-sem-bt");
  fotos.length = 5; await foto("semana-fechada-14-a-20", "Semana fechada 14–20/09 (sem comprometido)", 1300);
  await clicar(".cxv-sem-bt:last-of-type"); // volta
  await ev("(function(){ var b=document.querySelectorAll('.cxv-sem-bt'); b[b.length-1].click(); return 1; })()"); await esp(200);
  for (const s of ["pend", "mapa", "cfg"]) await clicar(`[data-sec="${s}"]`);
  await alvoRolar(".cxv-sec");
  const h = await ev("document.documentElement.scrollHeight"); const y = await ev("scrollY");
  const r4 = await cmd("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y, width: 1440, height: Math.min(h - y, 2600), scale: 1 } });
  fs.writeFileSync(path.join(SAIDA, "07-pendencias-mapa-configuracao.png"), Buffer.from(r4.result.data, "base64")); console.log("  foto: 07-pendencias-mapa-configuracao.png");

  // ===== CELULAR =====
  await abrir(390, 844);
  await simular();
  fotos.length = 7; await foto("celular-topo", "Celular: as quatro perguntas + setores", 2400);
  await clicar("button.cxv-sc-cab", "Açougue"); await alvoRolar(".cxv-sc.aberto");
  const r5 = await cmd("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: await ev("scrollY"), width: 390, height: 1300, scale: 1 } });
  fs.writeFileSync(path.join(SAIDA, "09-celular-setor-aberto.png"), Buffer.from(r5.result.data, "base64")); console.log("  foto: 09-celular-setor-aberto.png");
  const larg = await ev("document.documentElement.scrollWidth"); console.log("  largura no celular com setor aberto:", larg, "(tela 390)");
  await ev("window.scrollTo(0,0)"); await clicar(".cxv-k .cxv-nf");
  const r6 = await cmd("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(SAIDA, "10-celular-notas.png"), Buffer.from(r6.result.data, "base64")); console.log("  foto: 10-celular-notas.png");

  if (erros.length) console.log("ERROS NO CONSOLE:", erros); else console.log("sem erro no console");
  ws.close(); ch.kill();
})().catch((e) => { console.error(e); process.exit(1); });
