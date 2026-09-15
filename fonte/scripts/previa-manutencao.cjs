// PRÉVIA da Manutenção v2 com DADOS DE EXEMPLO — nunca vai para o ar.
//
// Pega o painel construído (output/index.html), troca o supabase-js da internet pelo servidor de
// mentira (scripts/testes/apoio/man2-sb-falso.js, que segue o contrato da especificação) e abre
// direto na Manutenção. Uma faixa amarela avisa "DADOS DE EXEMPLO" e troca o perfil.
//
//   node scripts/previa-manutencao.cjs              -> gera .previa/manutencao-v2.html
//   node scripts/previa-manutencao.cjs --conferir   -> gera e abre no Chrome sem tela (operacional e gestor)
//
// Abrir no navegador: .previa/manutencao-v2.html?papel=operacional  (ou gestor, master, gestor_so)
// Cobre: vencido, vence hoje, próximo, em dia, aguardando 1ª execução, periodicidade não configurada,
// sem programação, inativo (gestor > Mostrar inativos), pendência aberta, execução com problema,
// execução anulada e serviço de empresa externa com custo não informado (Camera Fria de Congelado > Histórico).
const fs = require("fs"), path = require("path"), { spawn } = require("child_process");
const RAIZ = path.join(__dirname, "..");
const SAIDA = path.join(RAIZ, ".previa", "manutencao-v2.html");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CDN = '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>';

function montarPagina(extraCabeca, extraCorpo) {
  let h = fs.readFileSync(path.join(RAIZ, "output", "index.html"), "utf8");
  if (h.indexOf(CDN) < 0) throw new Error("não achei o <script> do supabase-js no output/index.html");
  const falso = fs.readFileSync(path.join(__dirname, "testes", "apoio", "man2-sb-falso.js"), "utf8");
  h = h.replace(CDN, () => "<script>" + (extraCabeca || "") + "</script><script>" + falso + "</script>");
  h = h.replace(/<link href="https:\/\/fonts\.googleapis\.com[^>]*>/, "");
  h = h.replace("</head>", () => "<style>*,*::before,*::after{animation:none!important;transition:none!important}</style></head>");
  const fim = h.lastIndexOf("</body>");
  return h.slice(0, fim) + (extraCorpo || "") + h.slice(fim);
}
const FAIXA = `<div id="previaFaixa" style="position:fixed;left:0;right:0;bottom:0;z-index:9000;background:#fdf3d9;color:#5c4500;border-top:2px solid #e6c46a;font:700 14px Arial,sans-serif;padding:8px 16px;display:flex;gap:12px;flex-wrap:wrap;align-items:center;justify-content:center">
  <span>DADOS DE EXEMPLO — prévia, não é a loja</span>
  <span id="previaPerfil" style="font-weight:400"></span>
  <a href="?papel=operacional" style="color:#0c5a26">Ver como operacional</a>
  <a href="?papel=gestor" style="color:#0c5a26">Ver como gestor</a>
  <a href="?papel=master" style="color:#0c5a26">Ver como master</a>
</div>
<script>
(function(){
  try{ var q=new URLSearchParams(location.search); document.getElementById("previaPerfil").textContent="perfil: "+(q.get("papel")||"operacional"); }catch(e){}
  var n=0;
  (function abrir(){
    n++;
    var bt=document.querySelector('.nav-item[data-page="manutencoes"]');
    if(window.__PERFIL && bt && !bt.classList.contains("nav-locked")){ if(!bt.classList.contains("ativo")) bt.click(); window.__previaPronta=1; return; }
    if(n<200) setTimeout(abrir,100);
  })();
})();
</script>`;

if (require.main === module) {
  fs.mkdirSync(path.dirname(SAIDA), { recursive: true });
  fs.writeFileSync(SAIDA, montarPagina("window.__MAN2_CFG={};", FAIXA));
  console.log("prévia gerada:", SAIDA);
  console.log("  abra: file://" + SAIDA + "?papel=operacional   ·   ?papel=gestor");
  if (process.argv.indexOf("--conferir") >= 0) conferir().catch(e => { console.error(e); process.exit(1); });
}
module.exports = { montarPagina, CDN };

async function conferir() {
  if (!fs.existsSync(CHROME)) { console.log("sem Chrome: não conferi"); return; }
  const esp = ms => new Promise(r => setTimeout(r, ms));
  const tmp = fs.mkdtempSync(path.join(require("os").tmpdir(), "previa-man2-"));
  const porta = 9700 + Math.floor(Math.random() * 200);
  const ch = spawn(CHROME, ["--headless=new", "--disable-gpu", "--remote-debugging-port=" + porta, "--user-data-dir=" + tmp,
    "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1", "--allow-file-access-from-files", "about:blank"], { stdio: "ignore" });
  let alvo = null;
  for (let i = 0; i < 80 && !alvo; i++) { await esp(250); try { alvo = (await (await fetch("http://127.0.0.1:" + porta + "/json")).json()).find(t => t.type === "page"); } catch (e) {} }
  if (!alvo) { ch.kill(); throw new Error("Chrome não respondeu"); }
  const ws = new WebSocket(alvo.webSocketDebuggerUrl); let id = 0; const pend = {}; const erros = [];
  await new Promise(r => ws.onopen = r);
  ws.onmessage = m => { const o = JSON.parse(m.data); if (o.id && pend[o.id]) { pend[o.id](o); delete pend[o.id]; } else if (o.method === "Runtime.exceptionThrown") erros.push(JSON.stringify(o.params.exceptionDetails).slice(0, 300)); };
  const cmd = (method, params = {}) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async e => { const r = await cmd("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : null; };
  await cmd("Page.enable"); await cmd("Runtime.enable");
  for (const papel of ["operacional", "gestor"]) {
    await cmd("Page.navigate", { url: "file://" + SAIDA + "?papel=" + papel });
    for (let i = 0; i < 80; i++) { await esp(250); if (await ev("!!(window.__previaPronta && document.querySelector('#man2Lista .m2-tarefa'))")) break; }
    await esp(400);
    const r = await ev("JSON.stringify({tarefas:document.querySelectorAll('#man2Lista .m2-tarefa').length,abas:document.getElementById('man2Abas').innerText.replace(/\\n/g,' | '),faixa:(document.getElementById('previaFaixa')||{}).innerText||''})");
    console.log(papel + ":", r);
  }
  console.log("exceções:", erros.length ? erros.join("\n") : "nenhuma");
  ws.close(); ch.kill();
  await new Promise(r => { ch.once("exit", r); setTimeout(r, 3000); });   // o Chrome ainda escreve no perfil logo depois do kill
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
}
