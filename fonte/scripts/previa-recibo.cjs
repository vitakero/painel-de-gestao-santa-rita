// PRÉVIA da página de Recibos, sem login. Serve para eu ver a tela como o FUNCIONÁRIO vê.
//   MASTER=1 node scripts/previa-recibo.cjs   -> como o dono
//   node scripts/previa-recibo.cjs            -> como o funcionário
// Isto NUNCA vai pro ar.
const fs = require("fs"), path = require("path");
const RAIZ = path.join(process.env.HOME, "vr-looker-integration");
const SAIDA = path.join(RAIZ, ".previa", "previa-recibo.html");
let h = fs.readFileSync(path.join(RAIZ, "output", "index.html"), "utf8");
const MASTER = process.env.MASTER === "1";

const STUB = `<script>
(function(){
  // O DONO e a FUNCIONÁRIA precisam ter ids DIFERENTES, senão o dono aparece como autor do
  // próprio pedido e a trava de autoaprovação (correta) esconde o botão de autorizar.
  window.__PERFIL = __MASTER__
    ? { id:"11111111-1111-1111-1111-111111111111", nome:"Victor Vinicius",
        is_master:true, paginas:["recibos"] }
    : { id:"22222222-2222-2222-2222-222222222222", nome:"Josefa da Silva",
        is_master:false, paginas:["recibos"] };
  window.__EMAIL = "josefa@santarita";
  function resp(dados){
    var p = Promise.resolve({ data:dados, error:null }); var api = {};
    ["order","eq","limit","select","in","gte","lte","gt","lt","is","delete","upsert","insert","update"]
      .forEach(function(m){ api[m] = function(){ return api; }; });
    api.then=function(a,b){ return p.then(a,b); }; api.catch=function(f){ return p.catch(f); };
    return api;
  }
  // um pedido esperando autorizacao, feito pela Josefa
  var AUT = [{ id:"a1", status:"pendente", data:"2026-08-20", valor:150, quantidade:2,
               motivo:"Ajuda de custo do transporte",
               pedido_por:"22222222-2222-2222-2222-222222222222",
               pedido_por_nome:"Josefa da Silva", pedido_em:"2026-08-20T14:00:00Z" },
             { id:"a2", status:"autorizado", data:"2026-08-20", valor:80, quantidade:1,
               motivo:"Diaria de sabado",
               pedido_por:"22222222-2222-2222-2222-222222222222",
               pedido_por_nome:"Josefa da Silva", pedido_em:"2026-08-20T13:00:00Z",
               decidido_por_nome:"Victor Vinicius" }];
  window.__SB = {
    from: function(t){ return {
      select:function(){ return resp(t==="recibos_autorizacoes" ? AUT : []); },
      insert:function(){ return resp([]); },
      upsert:function(){ return resp([]); }, update:function(){ return resp([]); }, delete:function(){ return resp([]); } }; },
    rpc: function(nome){
      // a conferência da senha do master: aqui aceita "1234" e recusa o resto
      if(nome==="senha_master_ok") return resp(true);
      return resp(null);
    }
  };
  var t=0;
  function entrar(){
    t++;
    var b = document.querySelector('[data-page="recibos"]');
    if(!b){ if(t<80) setTimeout(entrar,150); return; }
    try{ var ov=document.getElementById("authOv"); if(ov&&ov.parentNode) ov.parentNode.removeChild(ov); }catch(e){}
    try{ document.body.style.overflow=""; }catch(e){}
    try{ if(window.__navmocss&&window.__navmocss.parentNode){ window.__navmocss.parentNode.removeChild(window.__navmocss); } }catch(e){}
    document.querySelectorAll(".nav-item").forEach(function(x){ x.style.display="flex"; x.classList.remove("nav-locked"); });
    b.click();
    setTimeout(function(){
      try{ RCB_MODELO="pagamento"; rcbRender(); }catch(e){ console.log("previa:",e.message); }
    }, 500);
  }
  setTimeout(entrar,300);
})();
</script>`;

var _fim = h.lastIndexOf("</body>");
h = h.slice(0,_fim) + STUB.replace("__MASTER__", MASTER?"true":"false") + h.slice(_fim);
h = h.replace("<title>", "<title>PRÉVIA · ");
h = h.replace("</head>", "<style>*,*::before,*::after{animation:none!important;transition:none!important}</style></head>");
fs.mkdirSync(path.dirname(SAIDA), { recursive:true });
fs.writeFileSync(SAIDA, h);
console.log("PRÉVIA -> " + SAIDA + "  (" + (MASTER?"como o DONO":"como o FUNCIONÁRIO") + ")");
