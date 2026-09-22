// CABEÇALHO: cabe na tela? — trava de largura, no Chrome sem tela, com o painel construído.
//
// POR QUE ESTE TESTE EXISTE. Em 22/09/2026 entrou o botão do olho (modo apresentação) como
// quarto botão do cabeçalho. Em celular de 360 px isso passava 6 px da largura da tela — e,
// como o cabeçalho é o MESMO em todas as páginas, o painel inteiro passava a rolar de lado.
// Nada quebrava, nada dava erro: só ficava torto no celular de quem usa. Quem achou foi um
// teste de outro módulo (a Manutenção), por acidente. Este aqui cobra de propósito.
//
// COMO MEDE. Prende o cabeçalho na largura exata do celular e pergunta se o conteúdo dele
// coube (scrollWidth <= clientWidth) e se sobrou algum pedaço passando da borda. Mede só o
// cabeçalho de propósito: o miolo de cada página tem rolagem própria e é outro assunto.
// Mede o caso PIOR — com o sino e o chip da pessoa à mostra, que só aparecem para quem entrou.
//
//   npx tsx scripts/demoDashboard.ts && node scripts/testes/cabecalho-largura.test.cjs
const fs = require("fs"), os = require("os"), path = require("path"), { spawn } = require("child_process");
const RAIZ = path.join(__dirname, "..", "..");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PAINEL = path.join(RAIZ, "output", "index.html");
if (!fs.existsSync(CHROME) || !fs.existsSync(PAINEL)) { console.log("PULADO — precisa do Google Chrome e do painel construído."); process.exit(0); }

// As larguras que existem de verdade na mão de quem usa o painel.
const TELAS = [
  [320, "celular bem antigo (iPhone SE 1)"],
  [360, "celular Android comum"],
  [375, "iPhone SE / 8"],
  [390, "iPhone 13/14/15"],
  [412, "Android grande"],
  [768, "tablet em pé"],
  [1024, "tablet deitado"],
];

const esp = ms => new Promise(r => setTimeout(r, ms));
let ok = 0, falhou = 0;
function vale(nome, cond, det) {
  console.log((cond ? "  OK   " : "  FALHA") + " | " + nome + (det !== undefined ? "  ->  " + (typeof det === "string" ? det : JSON.stringify(det)) : ""));
  cond ? ok++ : falhou++;
}

(async () => {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "cab-larg-"));
  const porta = 9600 + Math.floor(Math.random() * 300);
  const ch = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--remote-debugging-port=" + porta,
    "--user-data-dir=" + path.join(TMP, "perfil"), "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
    "--allow-file-access-from-files", "about:blank"], { stdio: "ignore" });
  let alvo = null;
  for (let i = 0; i < 80 && !alvo; i++) { await esp(250); try { alvo = (await (await fetch("http://127.0.0.1:" + porta + "/json")).json()).find(t => t.type === "page"); } catch (e) {} }
  if (!alvo) { ch.kill(); console.log("FALHA | Chrome não respondeu"); process.exit(1); }
  const ws = new WebSocket(alvo.webSocketDebuggerUrl); let id = 0; const pend = {};
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend[m.id]) pend[m.id](m); };
  await new Promise(r => ws.onopen = r);
  const cmd = (method, params) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  await cmd("Page.enable"); await cmd("Runtime.enable");
  const ev = async exp => { const r = await cmd("Runtime.evaluate", { expression: exp, returnByValue: true, awaitPromise: true }); return r.result && r.result.result && r.result.result.value; };

  // O painel abre com a tela de login por cima; o cabeçalho existe atrás dela do mesmo jeito.
  // Para medir o caso PIOR, mostramos também o sino e o chip da pessoa, que só aparecem logado.
  const MOSTRAR_TUDO = `(function(){
    var s=document.getElementById('__medida'); if(!s){ s=document.createElement('style'); s.id='__medida'; document.head.appendChild(s); }
    s.textContent='#authOv{display:none!important}#hSino{display:inline-flex!important}#hUser{display:flex!important}';
    var u=document.getElementById('hUser');
    if(u && !u.querySelector('.hu-av')) u.innerHTML='<span class="hu-av">VV</span><span class="hu-tx"><b>Victor Vinicius</b><i>Diretoria</i></span><span class="hu-ch">&rsaquo;</span>';
    var n=document.getElementById('hSinoN'); if(n) n.textContent='22';
    return 1;
  })()`;
  const MEDIR = `(function(larg){
    var cab=document.querySelector('header'), env=document.querySelector('header .hwrap');
    cab.style.width=larg+'px'; cab.style.maxWidth=larg+'px'; cab.style.boxSizing='border-box';
    void cab.offsetWidth;
    var borda=cab.getBoundingClientRect().right, fora=[];
    cab.querySelectorAll('*').forEach(function(e){
      var r=e.getBoundingClientRect();
      if(r.width>0 && r.right>borda+0.5) fora.push((e.id||e.className||e.tagName)+' até '+Math.round(r.right));
    });
    var res={ coube: env.scrollWidth<=env.clientWidth+0.5, sobra: Math.round(env.clientWidth-env.scrollWidth),
      fora:fora.slice(0,5),
      botoes:['hTema','hOlho','hSino'].map(function(i){ var e=document.getElementById(i); if(!e) return i+':SUMIU';
        var r=e.getBoundingClientRect(); return i+':'+Math.round(r.width)+'x'+Math.round(r.height); }) };
    cab.style.width=''; cab.style.maxWidth=''; cab.style.boxSizing='';
    return JSON.stringify(res);
  })`;

  for (const [larg, quem] of TELAS) {
    await cmd("Emulation.setDeviceMetricsOverride", { width: larg, height: 844, deviceScaleFactor: 1, mobile: larg < 700 });
    await cmd("Page.navigate", { url: "file://" + PAINEL });
    for (let i = 0; i < 80; i++) { await esp(200); if (await ev("document.readyState==='complete'")) break; }
    await ev(MOSTRAR_TUDO); await esp(250);
    const m = JSON.parse(await ev(MEDIR + "(" + larg + ")"));
    vale(larg + " px (" + quem + "): o cabeçalho cabe sem rolar de lado", m.coube, "sobra " + m.sobra + " px");
    vale(larg + " px: nenhum pedaço do cabeçalho passa da borda", !m.fora.length, m.fora.join(", ") || "nenhum");
    vale(larg + " px: os três botões continuam lá, inteiros (32x32)", m.botoes.every(b => /:32x32$/.test(b)), m.botoes.join(" "));
  }

  ch.kill();
  console.log("\n" + ok + " OK, " + falhou + " falha(s)");
  process.exit(falhou ? 1 : 0);
})();
