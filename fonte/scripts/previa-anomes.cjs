// Gera uma PRÉVIA da tela "Histórico" (ano a ano / mês a mês) pra conferir o desenho
// sem precisar de login.
//
// Pega o painel de verdade (output/index.html) e só entra no lugar da pessoa. Os números
// são os do próprio painel — o DIA[] que o robô traz do VR. Nada é inventado aqui.
//
//   node scripts/previa-anomes.cjs
//   MEDIDA=marg node scripts/previa-anomes.cjs     (fat | marg | cup | qtd)
// Isto NUNCA vai pro ar.
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(process.env.HOME, "vr-looker-integration");
const SAIDA = path.join(RAIZ, ".previa", "previa-anomes.html");
const FONTE = process.env.PAINEL || path.join(RAIZ, "output", "index.html");
const MEDIDA = (process.env.MEDIDA || "fat").replace(/[^a-z]/g, "");
let h = fs.readFileSync(FONTE, "utf8");

const STUB = `<script>
(function(){
  var tentativas = 0;
  function entrar(){
    tentativas++;
    var b = document.querySelector('[data-page="historico"]');
    if(!b || typeof DIA === "undefined"){ if(tentativas < 60) setTimeout(entrar, 150); return; }
    window.__PERFIL = { id:"11111111-1111-1111-1111-111111111111", is_master:true, paginas:["historico"] };
    window.__EMAIL = "previa@santarita";
    try{ var ov=document.getElementById("authOv"); if(ov && ov.parentNode) ov.parentNode.removeChild(ov); }catch(e){}
    try{ document.body.style.overflow=""; }catch(e){}
    try{ if(window.__navmocss && window.__navmocss.parentNode){ window.__navmocss.parentNode.removeChild(window.__navmocss); } }catch(e){}
    try{ if(window.__pgcss && window.__pgcss.parentNode){ window.__pgcss.parentNode.removeChild(window.__pgcss); } }catch(e){}
    document.querySelectorAll(".nav-item").forEach(function(x){ x.style.display="flex"; x.classList.remove("nav-locked"); });
    b.click();
    setTimeout(function(){
      try{
        var s=document.getElementById("hsMedida");
        if(s && ${JSON.stringify(MEDIDA)}!=="fat"){ s.value=${JSON.stringify(MEDIDA)}; hsMontar(); }
      }catch(e){ document.body.innerHTML = "<pre>"+e.message+"\\n"+e.stack+"</pre>"; }
    }, 80);
  }
  entrar();
})();
</script>`;

// PEGADINHA: o painel tem vários "</body>" (templates de impressão dentro de strings).
// O primeiro NÃO é o fim da página — emendar nele deixa o stub num lugar que nunca roda.
const _fim = h.lastIndexOf("</body>");
h = h.slice(0, _fim) + STUB + h.slice(_fim);
h = h.replace("<title>", "<title>PRÉVIA · ");
h = h.replace("</head>", "<style>*,*::before,*::after{animation:none!important;transition:none!important}</style></head>");
fs.mkdirSync(path.dirname(SAIDA), { recursive: true });
fs.writeFileSync(SAIDA, h);
console.log("OK -> " + SAIDA + "   (medida: " + MEDIDA + ")");
