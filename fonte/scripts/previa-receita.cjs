// PREVIA da ficha de Receita, sem login. Serve para eu clicar nos botoes e ver o que
// acontece de verdade — ler o codigo nao mostra clique que nao chega.
//   node scripts/previa-receita.cjs
// Isto NUNCA vai pro ar.
const fs=require("fs"), path=require("path");
const RAIZ=path.join(process.env.HOME,"vr-looker-integration");
const SAIDA=path.join(RAIZ,".previa","previa-receita.html");
let h=fs.readFileSync(path.join(RAIZ,"output","index.html"),"utf8");

const STUB=`<script>
(function(){
  window.__PERFIL={ id:"11111111-1111-1111-1111-111111111111", nome:"Victor Vinicius",
                    is_master:true, paginas:["receitas"] };
  window.__EMAIL="teste@santarita";
  function resp(dados){
    var p=Promise.resolve({data:dados,error:null}); var api={};
    ["order","eq","limit","select","in","gte","lte","gt","lt","is","or","delete","upsert","insert","update"]
      .forEach(function(m){ api[m]=function(){ return api; }; });
    api.then=function(a,b){ return p.then(a,b); }; api.catch=function(f){ return p.catch(f); };
    return api;
  }
  window.__SB={ from:function(){ return { select:function(){ return resp([]); },
      insert:function(){ return resp([]); }, upsert:function(){ return resp([]); },
      update:function(){ return resp([]); }, delete:function(){ return resp([]); } }; },
    rpc:function(){ return resp(null); },
    channel:function(){ return { on:function(){ return this; }, subscribe:function(){ return this; } }; },
    removeChannel:function(){} };

  var t=0;
  function entrar(){
    t++;
    var b=document.querySelector('[data-page="receitas"]');
    if(!b){ if(t<80) setTimeout(entrar,150); return; }
    try{ var ov=document.getElementById("authOv"); if(ov&&ov.parentNode) ov.parentNode.removeChild(ov); }catch(e){}
    try{ document.body.style.overflow=""; }catch(e){}
    try{ if(window.__navmocss&&window.__navmocss.parentNode) window.__navmocss.parentNode.removeChild(window.__navmocss); }catch(e){}
    document.querySelectorAll(".nav-item").forEach(function(x){ x.style.display="flex"; x.classList.remove("nav-locked"); });
    b.click();
    // abre a ficha nova
    setTimeout(function(){
      try{ var add=document.getElementById("recAdd"); if(add) add.click(); }catch(e){ console.log("previa:",e.message); }
    }, 600);
  }
  setTimeout(entrar,300);
})();
</script>`;

var _fim=h.lastIndexOf("</body>");
h=h.slice(0,_fim)+STUB+h.slice(_fim);
h=h.replace("<title>","<title>PRÉVIA · ");
fs.mkdirSync(path.dirname(SAIDA),{recursive:true});
fs.writeFileSync(SAIDA,h);
console.log("PRÉVIA -> "+SAIDA);
