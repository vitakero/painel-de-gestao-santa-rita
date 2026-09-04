// PRÉVIA da aba Regulamento, sem login — pra eu ver a tela como o FUNCIONÁRIO COMUM vê.
// O perfil de teste é o pior caso de propósito: NENHUMA página liberada. Se o Regulamento
// aparecer assim, aparece pra todo mundo.
//   node scripts/previa-regulamento.cjs            -> funcionário sem nenhuma página
//   MASTER=1 node scripts/previa-regulamento.cjs   -> como o dono
//   BUSCA=uniforme node scripts/previa-regulamento.cjs   -> já com a busca preenchida
// Isto NUNCA vai pro ar.
const fs = require("fs"), path = require("path");
const RAIZ = path.join(process.env.HOME, "vr-looker-integration");
const SAIDA = path.join(RAIZ, ".previa", "previa-regulamento.html");
let h = fs.readFileSync(path.join(RAIZ, "output", "index.html"), "utf8");
const MASTER = process.env.MASTER === "1";
const BUSCA = process.env.BUSCA || "";

const STUB = `<script>
(function(){
  window.__PERFIL = __MASTER__
    ? { id:"11111111-1111-1111-1111-111111111111", nome:"Victor Vinicius", setor:"Diretoria",
        is_master:true, paginas:[] }
    : { id:"22222222-2222-2222-2222-222222222222", nome:"Josefa da Silva", setor:"Frente de Loja",
        is_master:false, paginas:[] };
  window.__EMAIL = "previa@santarita";
  function resp(){ var p=Promise.resolve({data:[],error:null}), api={};
    ["order","eq","limit","select","in","gte","lte","gt","lt","is","delete","upsert","insert","update"]
      .forEach(function(m){ api[m]=function(){ return api; }; });
    api.then=function(a,b){ return p.then(a,b); }; api.catch=function(f){ return p.catch(f); };
    return api; }
  window.__SB = { from:function(){ return resp(); }, rpc:function(){ return resp(); },
                  channel:function(){ return { on:function(){ return this; }, subscribe:function(){ return this; } }; },
                  auth:{ getSession:function(){ return Promise.resolve({data:{session:null}}); } } };
  var pronto=false, tentativas=0;
  function vai(){
    tentativas++;
    if(typeof regRender!=="function"){ if(tentativas<200) return setTimeout(vai,50);
      document.title="ERRO: regRender nao apareceu"; return; }
    if(pronto) return; pronto=true;
    try{ var ov=document.getElementById("authOv"); if(ov&&ov.parentNode) ov.parentNode.removeChild(ov); }catch(e){}
    try{ document.body.style.overflow=""; }catch(e){}
    try{ if(window.__navmocss&&window.__navmocss.parentNode) window.__navmocss.parentNode.removeChild(window.__navmocss); }catch(e){}
    try{ if(window.__pgcss&&window.__pgcss.parentNode) window.__pgcss.parentNode.removeChild(window.__pgcss); }catch(e){}
    // as abas ficam como o perfil manda (é isso que estou querendo ver)
    var navs=document.querySelectorAll('.nav-item[data-page]');
    for(var i=0;i<navs.length;i++){
      var b=navs[i], pg=b.dataset.page;
      if(window.__PERFIL.is_master){ b.style.display=""; b.classList.remove("nav-locked"); continue; }
      if(b.classList.contains("nav-mo")){ b.style.display="none"; continue; }
      b.style.display=""; b.classList.toggle("nav-locked", pg!=="regulamento");
    }
    var bt=document.querySelector('.nav-item[data-page="regulamento"]');
    if(bt) bt.click();
    var termo=__BUSCA__;
    if(termo){ var cx=document.getElementById("regBusca");
      if(cx){ cx.value=termo; cx.dispatchEvent(new Event("input",{bubbles:true})); } }
  }
  if(document.readyState==="complete") vai(); else window.addEventListener("load",vai);
  setTimeout(vai,300);
})();
</script>`.replace("__MASTER__", MASTER ? "true" : "false")
           .replace("__BUSCA__", JSON.stringify(BUSCA));

// TEM que ser a ÚLTIMA </body>: a primeira mora dentro de uma string do próprio painel
// (a janela de impressão), e o stub entraria lá, sem nunca rodar.
const _fim = h.lastIndexOf("</body>");
h = h.slice(0, _fim) + STUB + h.slice(_fim);
h = h.replace("<title>", "<title>PRÉVIA · ");
h = h.replace("</head>", "<style>*,*::before,*::after{animation:none!important;transition:none!important}</style></head>");
fs.mkdirSync(path.dirname(SAIDA), { recursive: true });
fs.writeFileSync(SAIDA, h);
console.log("prévia -> " + SAIDA + (MASTER ? "   (como o dono)" : "   (funcionário SEM nenhuma página liberada)")
  + (BUSCA ? "   busca: " + BUSCA : ""));
