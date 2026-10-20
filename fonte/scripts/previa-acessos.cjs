// PRÉVIA da tela de Acessos, sem login — pra ver as caixinhas de permissão como o MASTER vê.
// Usa gente de mentira; não toca em ninguém de verdade.
//   node scripts/previa-acessos.cjs
// Isto NUNCA vai pro ar.
const fs = require("fs"), path = require("path");
const RAIZ = path.join(process.env.HOME, "vr-looker-integration");
const SAIDA = path.join(RAIZ, ".previa", "previa-acessos.html");
let h = fs.readFileSync(path.join(RAIZ, "output", "index.html"), "utf8");

const STUB = `<script>
(function(){
  window.__PERFIL={ id:"11111111-1111-1111-1111-111111111111", nome:"Victor Vinicius",
                    setor:"Diretoria", is_master:true, paginas:[] };
  window.__EMAIL="previa@santarita";
  var PERFIS=[
    { id:"22222222-2222-2222-2222-222222222222", nome:"fghj", email:"funcionario@exemplo",
      setor:"Açougue", is_master:false, aprovado:true, criado_em:"2026-07-22T10:00:00Z",
      paginas:["pontos","mapa","recibos","entregas_lancar","vendasetor","agenda","escala",
               "galpoes","planta","rotina","central","cartaz"] }
  ];
  function resp(dados){ var p=Promise.resolve({data:dados,error:null}), api={};
    ["order","eq","limit","select","in","gte","lte","gt","lt","is","delete","upsert","insert","update"]
      .forEach(function(m){ api[m]=function(){ return api; }; });
    api.then=function(a,b){ return p.then(a,b); }; api.catch=function(f){ return p.catch(f); };
    api.maybeSingle=function(){ return resp(null); }; api.single=function(){ return resp(null); };
    return api; }
  window.__SB={ from:function(t){ return resp(t==="perfis"?PERFIS:[]); },
                rpc:function(){ return resp(null); },
                channel:function(){ return {on:function(){return this;},subscribe:function(){return this;},track:function(){}}; },
                auth:{ getSession:function(){ return Promise.resolve({data:{session:null}}); } } };
  var t=0;
  function entrar(){
    t++;
    var b=document.querySelector('[data-page="acessos"]');
    if(!b){ if(t<120) return setTimeout(entrar,120); return; }
    try{ var ov=document.getElementById("authOv"); if(ov&&ov.parentNode) ov.parentNode.removeChild(ov); }catch(e){}
    try{ document.body.style.overflow=""; }catch(e){}
    try{ if(window.__navmocss&&window.__navmocss.parentNode) window.__navmocss.parentNode.removeChild(window.__navmocss); }catch(e){}
    try{ if(window.__pgcss&&window.__pgcss.parentNode) window.__pgcss.parentNode.removeChild(window.__pgcss); }catch(e){}
    document.querySelectorAll(".nav-item").forEach(function(x){ x.style.display="flex"; x.classList.remove("nav-locked"); });
    b.click();
    setTimeout(function(){                      // abre o cartão da pessoa (vem fechado)
      var head=document.querySelector(".acs-card .acs-header");
      if(head) head.click();
      window.scrollTo(0,0);
    }, 700);
  }
  if(document.readyState==="complete") entrar(); else window.addEventListener("load",entrar);
  setTimeout(entrar,300);
})();
</script>`;
const _fim = h.lastIndexOf("</body>");   // a PRIMEIRA </body> mora dentro do código do painel
h = h.slice(0,_fim) + STUB + h.slice(_fim);
h = h.replace("<title>", "<title>PRÉVIA · ");
h = h.replace("</head>", "<style>*,*::before,*::after{animation:none!important;transition:none!important}</style></head>");
fs.mkdirSync(path.dirname(SAIDA), { recursive:true });
fs.writeFileSync(SAIDA, h);
console.log("prévia -> " + SAIDA);
