// FOTOS ANOTADAS para o MANUAL do Compra × Venda (números em círculo sobre a tela real).
//   node scripts/compras-x-venda/fotos-manual.cjs   (precisa de .previa/painel-cxv-manual.html)
// Saída: .previa/cxv-manual/NN-nome.png
const fs = require("fs"), path = require("path"), os = require("os");
const { spawn } = require("child_process");
const RAIZ = path.join(__dirname, "..", "..");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PAG = path.join(RAIZ, ".previa", "painel-cxv-manual.html");
const SAIDA = path.join(RAIZ, ".previa", "cxv-manual");
fs.mkdirSync(SAIDA, { recursive: true });
for (const f of fs.readdirSync(SAIDA)) if (f.endsWith(".png") && f !== "03-barra.png") fs.unlinkSync(path.join(SAIDA, f));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "cxv-manual-"));
const esp = (ms) => new Promise((r) => setTimeout(r, ms));

// Desenha um círculo numerado + contorno sobre um elemento. Roda DENTRO da página.
const MARCA = `window.__marca=function(el,n,lado){ if(!el) return 'sem elemento '+n; var r=el.getBoundingClientRect();
  var c=document.createElement('div'); c.className='mk'; c.textContent=n;
  var x=lado==='dir'? r.right+scrollX-14 : r.left+scrollX-14, y=r.top+scrollY-14;
  c.style.cssText='position:absolute;z-index:99999;left:'+x+'px;top:'+y+'px;width:28px;height:28px;border-radius:50%;background:#e8590c;color:#fff;font:800 15px/28px Arial,sans-serif;text-align:center;box-shadow:0 0 0 3px #fff,0 2px 6px rgba(0,0,0,.35)';
  document.body.appendChild(c);
  var o=document.createElement('div'); o.className='mk';
  o.style.cssText='position:absolute;z-index:99998;pointer-events:none;left:'+(r.left+scrollX-3)+'px;top:'+(r.top+scrollY-3)+'px;width:'+(r.width+6)+'px;height:'+(r.height+6)+'px;border:2.5px solid #e8590c;border-radius:10px';
  document.body.appendChild(o); return 'ok'; };
  window.__limpa=function(){ document.querySelectorAll('.mk').forEach(function(x){x.remove();}); };`;

(async () => {
  const porta = 9500 + Math.floor(Math.random() * 300);
  const ch = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--remote-debugging-port=" + porta,
    "--user-data-dir=" + path.join(TMP, "perfil"), "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
    "--allow-file-access-from-files", "about:blank"], { stdio: "ignore" });
  let alvo = null;
  for (let i = 0; i < 80 && !alvo; i++) { await esp(250); try { alvo = (await (await fetch("http://127.0.0.1:" + porta + "/json")).json()).find((t) => t.type === "page"); } catch (e) {} }
  const ws = new WebSocket(alvo.webSocketDebuggerUrl); let id = 0; const pend = {};
  await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (m) => { const o = JSON.parse(m.data); if (o.id && pend[o.id]) { pend[o.id](o); delete pend[o.id]; } };
  const cmd = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => { const r = await cmd("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
  const esperar = async (expr, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if ((await ev("!!(" + expr + ")")) === true) return true; await esp(100); } return false; };
  const W = 1440;
  await cmd("Page.enable"); await cmd("Runtime.enable");
  await cmd("Emulation.setDeviceMetricsOverride", { width: W, height: 1000, deviceScaleFactor: 2, mobile: false });
  await cmd("Page.navigate", { url: "file://" + PAG }); await esperar("document.readyState==='complete'");
  await esperar("document.querySelector('#cxvRaiz .cxv-kpis')"); await esp(500);
  await ev(MARCA + "1");
  // caixa = retângulo que envolve os seletores dados (coordenadas da página)
  const caixa = (sels, folga) => ev(`(function(){ var a=[${sels.map((s) => JSON.stringify(s)).join(",")}].map(function(s){return document.querySelector(s);}).filter(Boolean);
    var x1=1e9,y1=1e9,x2=0,y2=0; a.forEach(function(e){var r=e.getBoundingClientRect(); x1=Math.min(x1,r.left+scrollX); y1=Math.min(y1,r.top+scrollY); x2=Math.max(x2,r.right+scrollX); y2=Math.max(y2,r.bottom+scrollY);});
    var f=${folga || 24}; return {x:Math.max(0,x1-f), y:Math.max(0,y1-f), width:x2-x1+2*f, height:y2-y1+2*f}; })()`);
  async function foto(nome, clip) {
    await esp(250);
    const r = await cmd("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: Object.assign({ scale: 1 }, clip) });
    fs.writeFileSync(path.join(SAIDA, nome + ".png"), Buffer.from(r.result.data, "base64")); console.log("  foto:", nome);
  }
  const q = (s) => `document.querySelector(${JSON.stringify(s)})`;
  const qa = (s, i) => `document.querySelectorAll(${JSON.stringify(s)})[${i}]`;

  // 1) TOPO: as quatro perguntas + semana + data do dado
  await ev(`__limpa(); __marca(${qa(".cxv-k", 0)},1); __marca(${qa(".cxv-k", 1)},2); __marca(${qa(".cxv-k", 2)},3); __marca(${qa(".cxv-k", 3)},4);
    __marca(${q(".cxv-sem")},5); __marca(${q(".cxv-dado")},6,'dir'); __marca(${q(".cxv-k .cxv-nf")},7,'dir'); 1`);
  await foto("01-topo", await caixa([".cxv-topo", ".cxv-kpis"], 30));

  // 2) TABELA: cabeçalho com letras nas colunas + 3 linhas
  await ev(`__limpa(); var th=document.querySelectorAll('.cxv-tab thead th'); var L='ABCDEFGHIJ';
    for(var i=0;i<th.length;i++) __marca(th[i], L[i]); 1`);
  const c2 = await caixa([".cxv-tab thead", ".cxv-tab tbody tr:nth-child(3)"], 30);
  await foto("02-tabela", c2);

  // 3) A BARRINHA: virou desenho próprio (.previa/barra-manual.html) — a foto real é pequena demais para marcar.

  // 4) DETALHE do setor aberto (Açougue)
  await ev(`__limpa(); [].slice.call(document.querySelectorAll('tr.cxv-lin')).filter(function(t){return t.textContent.indexOf('Açougue')>=0;})[0].click(); 1`);
  await esp(300);
  await ev(MARCA + `var h=document.querySelectorAll('.cxv-det-tr .cxv-dt h4'); for(var i=0;i<h.length;i++) __marca(h[i], i+1); 1`);
  await foto("04-detalhe-setor", await caixa(["tr.cxv-lin.aberto", ".cxv-det-tr"], 24));
  await ev(`__limpa(); document.querySelector('tr.cxv-lin.aberto').click(); 1`);

  // 5) SITUAÇÃO: coluna com as etiquetas (tabela inteira, só as 3 últimas colunas)
  const c5 = await caixa([".cxv-tab thead th:nth-child(8)", ".cxv-tab tbody tr:last-child td:last-child"], 16);
  await foto("05-situacoes", c5);

  // 6) NOTAS NÃO FINALIZADAS (janela). A janela é FIXA na tela (não rola com a página): a foto
  // tem de ser da TELA, com altura para caber a janela inteira — clip em coordenada da página
  // saía em branco (24/09, o dono viu).
  await cmd("Emulation.setDeviceMetricsOverride", { width: W, height: 2400, deviceScaleFactor: 2, mobile: false });
  await ev("window.scrollTo(0,0); 1"); await esp(200);
  await ev(`__limpa(); document.querySelector('.cxv-k .cxv-nf').click(); 1`); await esp(400);
  // Para o manual: só as 8 primeiras notas + o total (a lista real tem dezenas e a foto virava um rolo).
  await ev(`(function(){ var tr=[].slice.call(document.querySelectorAll('.cxv-mod tr')).filter(function(t){return t.querySelector('td') && !t.classList.contains('t');});
    var esc=tr.slice(8); esc.forEach(function(t){t.style.display='none';});
    if(esc.length){ var n=document.createElement('tr'); n.innerHTML='<td colspan="6" style="text-align:center;color:#8a97a8;font-style:italic;padding:10px">… e mais '+esc.length+' notas na lista (role a janela para ver todas)</td>'; tr[7].after(n); }
    return 1; })()`);
  await ev(MARCA + `__marca(document.querySelectorAll('.cxv-mod th')[3],1,'dir'); __marca(document.querySelector('.cxv-mod tr.t'),2); 1`);
  { const r = await ev(`(function(){ var e=document.querySelector('.cxv-mod').getBoundingClientRect(); return {x:e.left-20,y:Math.max(0,e.top-20),width:e.width+40,height:e.height+40}; })()`);
    const f = await cmd("Page.captureScreenshot", { format: "png", clip: Object.assign({ scale: 1 }, r) });
    fs.writeFileSync(path.join(SAIDA, "06-notas.png"), Buffer.from(f.result.data, "base64")); console.log("  foto: 06-notas"); }
  await ev(`__limpa(); document.querySelector('.cxv-x').click(); 1`);
  await cmd("Emulation.setDeviceMetricsOverride", { width: W, height: 1000, deviceScaleFactor: 2, mobile: false });

  // 7) CONFIGURAÇÃO (margem objetivo)
  await ev(`document.querySelector('[data-sec="cfg"]').click(); 1`); await esp(300);
  await ev(MARCA + `__marca(document.querySelector('.cxv-cfg input'),1); __marca(document.querySelectorAll('.cxv-cfg td')[2],2); __marca(document.querySelector('.cxv-cfg select'),3,'dir'); 1`);
  await foto("07-configuracao", await caixa([".cxv-sec-cab[data-sec='cfg']", ".cxv-cfg tr:nth-child(6)"], 20));
  await ev(`__limpa(); document.querySelector('[data-sec="cfg"]').click(); 1`);

  // 8) PEDIDOS FORA DA CONTA
  await ev(`document.querySelector('[data-sec="pend"]').click(); 1`); await esp(300);
  await foto("08-pedidos-fora", await caixa([".cxv-sec-cab[data-sec='pend']", ".cxv-sec-c .cxv-tw tr:nth-child(6)"], 20));

  ws.close(); ch.kill();
})().catch((e) => { console.error(e); process.exit(1); });
