// PRÉVIA da Central Logística, sem login. Serve para eu ver a linha da entrega
// confirmada com os DOIS botões: "Recusar entrega" e "✓ Conferido".
//   node scripts/previa-doca.cjs
// Isto NUNCA vai pro ar.
const fs = require("fs"), path = require("path");
const RAIZ = path.join(process.env.HOME, "vr-looker-integration");
const SAIDA = path.join(RAIZ, ".previa", "previa-doca.html");
let h = fs.readFileSync(path.join(RAIZ, "output", "index.html"), "utf8");

const STUB = `<script>
(function(){
  window.__PERFIL = { id:"11111111-1111-1111-1111-111111111111", nome:"Victor Vinicius",
                      is_master:true, paginas:["central"] };
  window.__EMAIL = "diretoria@santarita";

  function hoje(d){ var x=new Date(); x.setDate(x.getDate()+(d||0));
    return x.getFullYear()+"-"+String(x.getMonth()+1).padStart(2,"0")+"-"+String(x.getDate()).padStart(2,"0"); }

  // Uma entrega JÁ APROVADA e cujo dia chegou — é exatamente o caso em que o caminhão
  // encosta na doca e alguém precisa decidir. E um pendente da semana passada, que é o
  // que hoje segura o horário para sempre.
  var LINHAS = [
    { id:"e1", fornecedor:"Distribuidora Nordeste Ltda", documento:"12345678000190",
      contato:"(84) 99999-0000", data:hoje(0), hora:"09:00:00", pedido:"45231",
      descricao:"Bebidas - 12 paletes", status:"aprovado", criado_em:hoje(-3) },
    { id:"e2", fornecedor:"Laticinios Serido S/A", documento:"98765432000110",
      contato:"(84) 98888-1111", data:hoje(0), hora:"11:00:00", pedido:"45390",
      descricao:"Refrigerados", status:"aprovado", criado_em:hoje(-2) },
    { id:"e3", fornecedor:"Panificadora Caico ME", documento:"11222333000144",
      contato:"(84) 97777-2222", data:hoje(-7), hora:"14:00:00", pedido:"45102",
      descricao:"Farinha", status:"pendente", criado_em:hoje(-9) }
  ];

  // dois fornecedores travados no portal - e a razao de existir a etapa 3
  var BARRADOS = [
    { id:1, fornecedor_nome:"Distribuidora Nordeste Ltda", onde:"pedidos", pedido:"45231", vezes:4,
      motivo:"A nota 128374 traz 2 produto(s) que nao estao no pedido 45231: REFRIGERANTE COLA 2L, AGUA MINERAL 500ML. Confira se o pedido escolhido e o certo, ou fale com o comprador da loja.",
      primeira_em:new Date(Date.now()-3*3600000).toISOString(), ultima_em:new Date(Date.now()-25*60000).toISOString() },
    { id:2, fornecedor_nome:"Panificadora Caico ME", onde:"nf", pedido:null, vezes:1,
      motivo:"Para agendar sem a nota fiscal e preciso liberacao da loja. Envie o XML da nota, ou fale com o recebimento para pedir essa liberacao.",
      primeira_em:new Date(Date.now()-26*3600000).toISOString(), ultima_em:new Date(Date.now()-26*3600000).toISOString() }
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
      var dados = (t==="entregas_agendamento") ? LINHAS
                : (t==="receb_barrados") ? BARRADOS : [];
      return { select:function(){ return resp(dados); },
               insert:function(){ return resp([]); }, upsert:function(){ return resp([]); },
               update:function(){ return resp([]); }, delete:function(){ return resp([]); } };
    },
    rpc: function(){ return resp({ ok:true }); },
    functions: { invoke: function(){ return Promise.resolve({ data:{ok:true,para:"fornecedor@exemplo"}, error:null }); } },
    channel: function(){ return { on:function(){ return this; }, subscribe:function(){ return this; } }; },
    removeChannel: function(){}
  };

  var t=0;
  function entrar(){
    t++;
    var b = document.querySelector('[data-page="central"]');
    if(!b){ if(t<80) setTimeout(entrar,150); return; }
    try{ var ov=document.getElementById("authOv"); if(ov&&ov.parentNode) ov.parentNode.removeChild(ov); }catch(e){}
    try{ document.body.style.overflow=""; }catch(e){}
    try{ if(window.__navmocss&&window.__navmocss.parentNode){ window.__navmocss.parentNode.removeChild(window.__navmocss); } }catch(e){}
    document.querySelectorAll(".nav-item").forEach(function(x){ x.style.display="flex"; x.classList.remove("nav-locked"); });
    b.click();
    setTimeout(function(){ try{ clPedidos=LINHAS; clBarrados=BARRADOS; renderCentral(true); }catch(e){ console.log("previa:",e.message); } }, 600);
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
console.log("PRÉVIA -> " + SAIDA);
