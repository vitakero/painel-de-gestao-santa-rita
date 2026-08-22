// Gera uma PRÉVIA da página do Cartaz de Oferta, sem precisar de login.
//
// Pega o painel de verdade (output/index.html) e troca só a conexão com a nuvem por dados
// de exemplo. O desenho é o do painel publicado — não uma imitação que envelhece sozinha.
//
//   node scripts/previa-cartaz.cjs            -> passo 1 (escolha do modelo)
//   PASSO=3 node scripts/previa-cartaz.cjs    -> já com produtos, na tela de conferir
//   MODELO=deitado node scripts/previa-cartaz.cjs
// Isto NUNCA vai pro ar.
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(process.env.HOME, "vr-looker-integration");
const SAIDA = path.join(RAIZ, ".previa", "previa-cartaz.html");
let h = fs.readFileSync(path.join(RAIZ, "output", "index.html"), "utf8");

const PASSO  = String(+(process.env.PASSO || 1) || 1);
const MODELO = (process.env.MODELO || "padrao").replace(/[^a-z]/g, "");

const STUB = `<script>
(function(){
  // master, para enxergar também o modelo que está em ajuste
  window.__PERFIL = { id:"11111111-1111-1111-1111-111111111111", is_master:true, paginas:["cartaz"] };
  window.__EMAIL  = "previa@santarita";

  // O dublê tem que encadear como promessa DE VERDADE: o código do painel faz
  // .delete().lt(...).then(...).then(...) e a segunda etapa precisa receber o
  // resultado da PRIMEIRA função, não a resposta original. A versão ingênua
  // devolvia sempre a mesma resposta e o histórico chegava vazio.
  function resp(dados){
    var p = Promise.resolve({ data:dados, error:null });
    var api = {};
    ["order","eq","limit","select","in","gte","lte","gt","lt","is","delete","upsert","insert","update"]
      .forEach(function(m){ api[m] = function(){ return api; }; });
    api.then = function(a, b){ return p.then(a, b); };
    api.catch = function(f){ return p.catch(f); };
    return api;
  }
  // três cartazes de exemplo no histórico, para eu enxergar o bloco novo
  var HIST = [
    { id:"h1", modelo:"padrao", tamanho:"A4", impressao:"multi", oferta:"OFERTA",
      nome:"ARROZ CAMIL", marca:"CAMIL", tipo:"TIPO 1", gramatura:"5KG",
      preco:"29,99", preco_de:"", validade_ini:"2026-08-20", validade_fim:"2026-08-27",
      limite_cliente:2, tema_nome:"Final de semana de ofertas", criado_em:"2026-08-20T01:10:00Z" },
    { id:"h2", modelo:"depor", tamanho:"A5", impressao:"multi", oferta:"OFERTA",
      nome:"CAFE SANTA CLARA", marca:"SANTA CLARA", tipo:"", gramatura:"250G",
      preco:"12,90", preco_de:"15,90", validade_ini:"2026-08-20", validade_fim:"2026-08-24",
      limite_cliente:0, tema_nome:null, criado_em:"2026-08-20T00:40:00Z" },
    { id:"h3", modelo:"padrao", tamanho:"A6", impressao:"multi", oferta:"SUPER OFERTA",
      nome:"DETERGENTE YPE", marca:"YPE", tipo:"", gramatura:"500ML",
      preco:"2,49", preco_de:"", validade_ini:"2026-08-19", validade_fim:"2026-09-02",
      limite_cliente:6, tema_nome:null, criado_em:"2026-08-19T18:00:00Z" }
  ];
  window.__SB = {
    from: function(t){ return {
      select:function(){ return resp(t==="cartaz_historico" ? HIST : []); },
      insert:function(){ return resp([]); },
      upsert:function(){ return resp([{id:"novo"}]); }, update:function(){ return resp([]); },
      delete:function(){ return resp([]); } }; },
    storage: { from: function(){ return {
      list:function(){ return Promise.resolve({data:[], error:null}); },
      upload:function(){ return Promise.resolve({data:{path:"x"}, error:null}); },
      remove:function(){ return Promise.resolve({data:[], error:null}); },
      getPublicUrl:function(){ return { data:{ publicUrl:"" } }; } }; } }
  };

  var tentativas = 0;
  function entrar(){
    tentativas++;
    var b = document.querySelector('[data-page="cartaz"]');
    if(!b){ if(tentativas < 80) setTimeout(entrar, 150); return; }
    try{ var ov=document.getElementById("authOv"); if(ov && ov.parentNode) ov.parentNode.removeChild(ov); }catch(e){}
    try{ document.body.style.overflow=""; }catch(e){}
    try{ if(window.__navmocss && window.__navmocss.parentNode){ window.__navmocss.parentNode.removeChild(window.__navmocss); } }catch(e){}
    document.querySelectorAll(".nav-item").forEach(function(x){ x.style.display="flex"; x.classList.remove("nav-locked"); });
    b.click();
    setTimeout(function(){
      try{
        window.czModelo = "__MODELO__";
        if("__PASSO__" !== "1"){
          // três produtos de exemplo, para as telas 2 e 3 terem o que desenhar
          window.czProdutos = [
            { oferta:"OFERTA", nome:"BANANA PRATA", marca:"", gram:"KG", preco:"5,99", precoDe:"7,49" },
            { oferta:"OFERTA", nome:"CAFE SANTA CLARA", marca:"SANTA CLARA", gram:"250G", preco:"12,90", precoDe:"" },
            { oferta:"OFERTA", nome:"DETERGENTE YPE", marca:"YPE", gram:"500ML", preco:"2,49", precoDe:"3,19" }
          ];
          window.czStep = +"__PASSO__";
        }
        if(typeof renderCartaz === "function") renderCartaz();
      }catch(e){ console.log("previa:", e.message); }
    }, 500);
  }
  setTimeout(entrar, 300);
})();
</script>`;

// Entra antes do ÚLTIMO </body>: o painel gera outros documentos (recibo, cartaz) que têm
// "</body>" dentro de texto, e um replace comum acertava o primeiro deles.
var _fim = h.lastIndexOf("</body>");
h = h.slice(0, _fim) + STUB.replace("__MODELO__", MODELO).replace(/__PASSO__/g, PASSO) + h.slice(_fim);
h = h.replace("<title>", "<title>PRÉVIA · ");
h = h.replace("</head>", "<style>*,*::before,*::after{animation:none!important;transition:none!important}</style></head>");

fs.mkdirSync(path.dirname(SAIDA), { recursive: true });
fs.writeFileSync(SAIDA, h);
console.log("PRÉVIA -> " + SAIDA + "  (" + Math.round(fs.statSync(SAIDA).size/1024) + " KB)");
