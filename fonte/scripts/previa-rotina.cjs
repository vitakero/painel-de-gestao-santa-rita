// PRÉVIA da Rotina do Açougue, do jeito que ela aparece no CELULAR — e vira imagem.
//
// Existe porque mudança de aparência se mostra antes de publicar, e descrição por escrito não
// é aprovação. Os 8 itens vêm do Supabase de verdade (leitura pura); só o login é dispensado.
//
//   node scripts/previa-rotina.cjs            -> a lista como ela abre de manhã
//   FEITOS=2 node scripts/previa-rotina.cjs   -> com os 2 primeiros já marcados
//
// Isto NUNCA vai pro ar.
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const RAIZ = path.join(process.env.HOME, "vr-looker-integration");
const FEITOS = parseInt(process.env.FEITOS || "0", 10);
const SAIDA_HTML = path.join(RAIZ, ".previa", "previa-rotina" + (FEITOS ? "-feitos" : "") + ".html");
const SAIDA_PNG  = path.join(RAIZ, ".previa", "rotina-celular" + (FEITOS ? "-feitos" : "") + ".png");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const env = Object.fromEntries(fs.readFileSync(path.join(RAIZ, ".env"), "utf8")
  .split("\n").filter(l => /^[A-Z_0-9]+=/.test(l))
  .map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));

(async () => {
  // ---- os 8 itens REAIS, lidos do banco (nunca inventados: prévia com item de mentira
  //      aprova uma tela que não existe) ----
  const r = await fetch(env.SUPABASE_URL + "/rest/v1/rotinas?setor=eq." + encodeURIComponent("Açougue")
    + "&ativo=eq.true&select=id,titulo,descricao,setor,ordem,ativo&order=ordem.asc",
    { headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_KEY } });
  const itens = await r.json();
  if (!Array.isArray(itens) || !itens.length) { console.error("não achei os itens do Açougue no banco"); process.exit(1); }

  const agora = new Date();
  const hhmm = h => new Date(agora.getTime() - h * 3600000).toISOString();
  const lista = itens.map((it, i) => Object.assign({}, it, {
    estado_hoje: i < FEITOS ? "concluido" : "pendente",
    ultima_status: i < FEITOS ? "concluido" : null,
    ultima_em: i < FEITOS ? hhmm(i === 0 ? 3 : 2) : null,
    ultima_usuario: i < FEITOS ? "Zé do Açougue" : null,
    exec_aberta_id: null }));

  let h = fs.readFileSync(path.join(RAIZ, "output", "index.html"), "utf8");
  const STUB = `<script>
(function(){
  window.__PERFIL = { id:"22222222-2222-2222-2222-222222222222", nome:"Zé do Açougue",
                      setor:"Açougue", is_master:false, paginas:["operacional"] };
  window.__EMAIL = "previa@santarita";
  var LISTA = __LISTA__;
  function resp(d){ var p=Promise.resolve({data:d||[],error:null}), api={};
    ["order","eq","limit","select","in","gte","lte","gt","lt","is","delete","upsert","insert","update"]
      .forEach(function(m){ api[m]=function(){ return api; }; });
    api.then=function(a,b){ return p.then(a,b); }; api.catch=function(f){ return p.catch(f); };
    api.maybeSingle=function(){ return Promise.resolve({data:null,error:null}); };
    return api; }
  window.__SB = { from:function(){ return resp([]); },
    rpc:function(nome){ return resp(nome==="listar_rotinas" ? LISTA : []); },
    channel:function(){ return { on:function(){ return this; }, subscribe:function(){ return this; } }; },
    auth:{ getSession:function(){ return Promise.resolve({data:{session:null}}); } } };
  var pronto=false, t=0;
  function vai(){
    t++;
    if(typeof rotCarregar!=="function"){ if(t<200) return setTimeout(vai,50);
      document.title="ERRO: rotCarregar nao apareceu"; return; }
    if(pronto) return; pronto=true;
    try{ var ov=document.getElementById("authOv"); if(ov&&ov.parentNode) ov.parentNode.removeChild(ov); }catch(e){}
    try{ document.body.style.overflow=""; }catch(e){}
    /* NAO remover __navmocss/__pgcss aqui. Outras previas removem para forcar todas as abas a
       aparecer; nesta, remover arrebenta o layout de celular — o cartao fica mais largo que a
       tela e o texto sai pela direita. Provado: com a remocao, a 390px o conteudo vazava. */
    var bt=document.querySelector('.nav-item[data-page="operacional"]');
    if(bt) bt.click();
  }
  if(document.readyState==="complete") vai(); else window.addEventListener("load",vai);
  setTimeout(vai,300);
})();
</script>`.replace("__LISTA__", JSON.stringify(lista));

  const fim = h.lastIndexOf("</body>");
  h = h.slice(0, fim) + STUB + h.slice(fim);
  h = h.replace("<title>", "<title>PRÉVIA · ");
  h = h.replace("</head>", "<style>*,*::before,*::after{animation:none!important;transition:none!important}</style></head>");
  fs.mkdirSync(path.dirname(SAIDA_HTML), { recursive: true });
  fs.writeFileSync(SAIDA_HTML, h);

  /* ---- vira imagem, no tamanho de um iPhone ----
     O CHROME SEM TELA NÃO ENCOLHE ABAIXO DE ~500px. Pedir --window-size=390 dá uma FOTO de 390
     de largura sobre uma página desenhada em ~500: o cartão fica maior que o retrato e o texto
     sai cortado pela direita. Foi o que aconteceu na primeira tentativa, e por um minuto parecu
     defeito do painel — não era. Medido no navegador de verdade, a 390px a página fecha certinho
     (documento com 390 de largura, nenhum elemento passando da borda).
     Solução: a página vai dentro de uma moldura de 390px, e a janela do Chrome fica larga. Aí a
     largura de celular é a do QUADRO, não a da janela. */
  const alto = 260 + lista.reduce((s, it) => s + (it.estado_hoje === "concluido" ? 96 : (it.descricao ? 168 : 120)), 0);
  const MOLDURA = path.join(RAIZ, ".previa", "moldura-" + path.basename(SAIDA_HTML));
  fs.writeFileSync(MOLDURA, '<!doctype html><meta charset="utf-8"><title>Rotina no celular</title>'
    + '<style>html,body{margin:0;background:#fff}iframe{width:390px;height:' + alto + 'px;border:0;display:block}</style>'
    + '<iframe src="' + path.basename(SAIDA_HTML) + '"></iframe>');
  execFileSync(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars",
    "--force-device-scale-factor=2", "--window-size=390," + alto,
    "--virtual-time-budget=8000", "--screenshot=" + SAIDA_PNG, "file://" + MOLDURA],
    { stdio: "pipe" });
  const kb = Math.round(fs.statSync(SAIDA_PNG).size / 1024);
  console.log("itens lidos do banco: " + lista.length + (FEITOS ? ("  (" + FEITOS + " marcados)") : ""));
  console.log("imagem -> " + SAIDA_PNG + "   (" + kb + " KB, 390x" + alto + ")");
})();
