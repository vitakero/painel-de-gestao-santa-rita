// PRÉVIA da página Fornecedores, sem login. Serve para ver a linha da exceção
// "agendar sem nota fiscal" — criada em 29/08/2026 — nos dois estados: quem exige
// nota (cinza) e quem foi liberado (âmbar), com o botão do master.
//   node scripts/previa-fornecedores.cjs
// Isto NUNCA vai pro ar.
const fs = require("fs"), path = require("path");
const RAIZ = path.join(process.env.HOME, "vr-looker-integration");
const SAIDA = path.join(RAIZ, ".previa", "previa-fornecedores.html");
let h = fs.readFileSync(path.join(RAIZ, "output", "index.html"), "utf8");

// MASTER=0 para ver a tela de quem NÃO é master (a linha aparece, o botão não).
const MASTER = process.env.MASTER !== "0";

const STUB = `<script>
(function(){
  window.__PERFIL = { id:"11111111-1111-1111-1111-111111111111", nome:"Victor Vinicius",
                      is_master:${MASTER}, paginas:["fornecedores","central"] };
  window.__EMAIL = "diretoria@santarita";

  function iso(d){ var x=new Date(); x.setDate(x.getDate()+d); return x.toISOString(); }

  // Três fornecedores, de propósito: um esperando (a linha NÃO aparece nele),
  // um liberado exigindo nota (o normal) e um liberado como exceção (o âmbar).
  var FORN = [
    { id:"f1", cnpj:"20947638000141", razao_social:"GJ DOS SANTOS E FILHOS LTDA",
      nome_curto:null, email:"atendimento@vitakero.com.br", telefone:"84996339100",
      responsavel:"Pedro Marcos", situacao:"liberado", motivo:null,
      criado_em:iso(-14), liberado_em:iso(-14), pode_sem_nota:false },
    { id:"f2", cnpj:"11222333000144", razao_social:"Panificadora Caico ME",
      nome_curto:null, email:"contato@panificadoracaico.com.br", telefone:"84977772222",
      responsavel:"Dona Lúcia", situacao:"liberado", motivo:null,
      criado_em:iso(-40), liberado_em:iso(-39), pode_sem_nota:true },
    { id:"f3", cnpj:"98765432000110", razao_social:"Laticinios Serido S/A",
      nome_curto:null, email:"fiscal@laticiniosserido.com.br", telefone:"84988881111",
      responsavel:"Marcos Andrade", situacao:"aguardando", motivo:null,
      criado_em:iso(-1), liberado_em:null, pode_sem_nota:false }
  ];

  function resp(dados){
    var p = Promise.resolve({ data:dados, error:null }); var api = {};
    ["order","eq","limit","select","in","gte","lte","gt","lt","is","or","delete","upsert","insert","update"]
      .forEach(function(m){ api[m] = function(){ return api; }; });
    api.then=function(a,b){ return p.then(a,b); }; api.catch=function(f){ return p.catch(f); };
    return api;
  }
  window.__SB = {
    from: function(t){
      var dados = (t==="receb_fornecedores") ? FORN : [];
      return { select:function(){ return resp(dados); },
               insert:function(){ return resp([]); }, upsert:function(){ return resp([]); },
               update:function(){ return resp([]); }, delete:function(){ return resp([]); } };
    },
    rpc: function(){ return resp({ ok:true }); },
    functions: { invoke: function(){ return Promise.resolve({ data:{ok:true}, error:null }); } },
    channel: function(){ return { on:function(){ return this; }, subscribe:function(){ return this; } }; },
    removeChannel: function(){}
  };

  var t=0;
  function entrar(){
    t++;
    var b = document.querySelector('[data-page="fornecedores"]');
    if(!b){ if(t<80) setTimeout(entrar,150); return; }
    try{ var ov=document.getElementById("authOv"); if(ov&&ov.parentNode) ov.parentNode.removeChild(ov); }catch(e){}
    try{ document.body.style.overflow=""; }catch(e){}
    try{ if(window.__navmocss&&window.__navmocss.parentNode){ window.__navmocss.parentNode.removeChild(window.__navmocss); } }catch(e){}
    document.querySelectorAll(".nav-item").forEach(function(x){ x.style.display="flex"; x.classList.remove("nav-locked"); });
    b.click();
    setTimeout(function(){
      try{ frnLista=FORN; frnContas=[]; frnCarregando=false; frnErro=""; renderFornecedores(); }
      catch(e){ console.log("previa:",e.message); }
    }, 600);
  }
  setTimeout(entrar,300);
})();
</script>`;

var _fim = h.lastIndexOf("</body>");
h = h.slice(0,_fim) + STUB + h.slice(_fim);
h = h.replace("<title>", "<title>PRÉVIA · ");
h = h.replace("</head>", "<style>*,*::before,*::after{animation:none!important;transition:none!important}</style></head>");
fs.mkdirSync(path.dirname(SAIDA), { recursive:true });
fs.writeFileSync(SAIDA, h);
console.log("PRÉVIA -> " + SAIDA + (MASTER ? "  (como MASTER)" : "  (como NÃO-master)"));
