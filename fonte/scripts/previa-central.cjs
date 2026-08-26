// Previa da CENTRAL (aba Conferência dos carros), com dados reais da nuvem.
// Pega o painel gerado (output/index.html) e troca so a conexao com o Supabase por um
// dublê que devolve exatamente o que a consulta NOVA devolve: a lista leve, e o detalhe
// so quando o clique pedir. Serve pra provar, no olho, que enxugar a consulta nao mudou
// nada na tela — e que o clique continua abrindo o detalhe.
//
//   node scripts/previa-central.cjs
//   (PAINEL=/caminho/outro.html pra comparar com o que esta no ar)
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const RAIZ = path.join(process.env.HOME, "vr-looker-integration");
const SAIDA = path.join(RAIZ, ".previa", "previa-central.html");
const FONTE = process.env.PAINEL || path.join(RAIZ, "output", "index.html");
let h = fs.readFileSync(FONTE, "utf8");

// as MESMAS colunas que o painel pede — se elas mudarem no painel, a previa acompanha
const COLS = (h.match(/var\s+CL_CONF_COLS\s*=\s*((?:"[^"]*"\s*\+?\s*)+);/) || [])[1];
if (!COLS) { console.log("ERRO: nao achei CL_CONF_COLS no painel. Rode o build antes."); process.exit(1); }
const SELECT = COLS.replace(/"|\s|\+/g, "");

const puxa = (q) => JSON.parse(execSync(
  "node -e '" + [
    'const fs=require("fs");const env=fs.readFileSync("' + RAIZ + '/.env","utf8");',
    'const g=k=>{const m=env.match(new RegExp("^"+k+"=(.*)$","m"));return m?m[1].trim().replace(/[^\\x21-\\x7e]/g,""):""};',
    'const B=g("SUPABASE_URL").replace(/\\/+$/,""),K=g("SUPABASE_SERVICE_KEY");',
    '(async()=>{const r=await fetch(B+"/rest/v1/' + q + '",{headers:{apikey:K,Authorization:"Bearer "+K}});',
    'if(!r.ok){console.log("[]");return;}console.log(await r.text());})();'
  ].join("") + "'", { maxBuffer: 64 * 1024 * 1024 }).toString());

const LISTA = puxa("central_conferencias?select=" + encodeURIComponent(SELECT) + "&order=data.desc&limit=600");
// o detalhe das que tem divergencia, pra o clique achar (na vida real vem uma por vez)
const comDv = LISTA.filter(x => +x.divergencias > 0).slice(0, 40).map(x => x.id);
const DET = comDv.length
  ? puxa("central_conferencias?select=id,divergencia_detalhe&id=in.(" + comDv.map(encodeURIComponent).join(",") + ")")
  : [];

const stub = `
<script>
(function(){
  var LISTA = ` + JSON.stringify(LISTA) + `;
  var DET = ` + JSON.stringify(DET) + `;
  function resp(dados){
    var p={data:dados,error:null};
    p.then=function(ok){ setTimeout(function(){ ok({data:dados,error:null}); },0); return p; };
    p.order=function(){return p;}; p.limit=function(){return p;}; p.range=function(){return p;};
    p.or=function(){return p;}; p.gte=function(){return p;}; p.lte=function(){return p;};
    p.in=function(){return p;}; p.maybeSingle=function(){return p;}; p.single=function(){return p;};
    p.eq=function(col,val){
      // e o clique: o painel pede o detalhe de UMA conferencia
      var f=dados.filter(function(x){ return String(x[col])===String(val); });
      return resp(f.map(function(x){ return {divergencia_detalhe:x.divergencia_detalhe}; }));
    };
    p.select=function(){return p;};
    return p;
  }
  var FAKE={ from:function(t){ return {
    select:function(cols){
      if(t!=="central_conferencias") return resp([]);
      // o painel pede o detalhe por id -> devolve a tabela com o detalhe
      if(String(cols).indexOf("divergencia_detalhe")===0) return resp(DET);
      return resp(LISTA);
    },
    insert:function(){return resp([]);}, upsert:function(){return resp([]);},
    update:function(){return resp([]);}, delete:function(){return resp([]);}
  }; } };
  window.__PASSO=[];
  var t=0;
  function entrar(){
    t++;
    window.__PASSO.push("tentativa "+t);
    var b=document.querySelector('[data-page="central"]');
    if(!b){ if(t<60) setTimeout(entrar,150); return; }
    window.__SB=FAKE;
    window.__PERFIL={id:"11111111-1111-1111-1111-111111111111", is_master:true, paginas:[]};
    window.__EMAIL="previa@santarita";
    try{ var ov=document.getElementById("authOv"); if(ov&&ov.parentNode) ov.parentNode.removeChild(ov); }catch(e){}
    try{ document.body.style.overflow=""; }catch(e){}
    try{ if(window.__navmocss&&window.__navmocss.parentNode) window.__navmocss.parentNode.removeChild(window.__navmocss); }catch(e){}
    document.querySelectorAll(".nav-item").forEach(function(x){ x.style.display="flex"; x.classList.remove("nav-locked"); });
    window.__PASSO.push("achei o menu, cliquei");
    b.click();
    // o menu leva pra Central; a aba "Conferencia dos carros" e um segundo clique
    setTimeout(function(){
      try{
        var pg=document.getElementById("page-central");
        if(pg && pg.className.indexOf("ativo")<0){
          document.querySelectorAll(".page").forEach(function(x){ x.classList.remove("ativo"); });
          pg.classList.add("ativo");
        }
        window.__PASSO.push("page-central classes="+(pg?pg.className:"nao existe"));
        var vb=document.querySelector('[data-clview="conf"]');
        window.__PASSO.push("botao da aba conf: "+(vb?"achei":"NAO achei"));
        if(vb) vb.click();
        setTimeout(function(){
          window.__PASSO.push("clView agora = "+(typeof clView!=="undefined"?clView:"?"));
          try{ if(typeof clConfLoad==="function") clConfLoad(); window.__PASSO.push("chamei clConfLoad"); }catch(e){ window.__PASSO.push("clConfLoad ERRO "+e.message); }
          setTimeout(function(){ try{ if(typeof renderClConf==="function") renderClConf(); }catch(e){} },300);
        },200);
      }catch(e){ document.body.innerHTML="<pre>"+e.message+"</pre>"; }
    },300);
  }
  entrar();
})();
</script>`;

const i = h.lastIndexOf("</body>");
h = h.slice(0, i) + stub + h.slice(i);
fs.mkdirSync(path.dirname(SAIDA), { recursive: true });
fs.writeFileSync(SAIDA, h);
console.log("OK -> " + SAIDA);
console.log("   " + LISTA.length + " conferencias na lista (" + (JSON.stringify(LISTA).length / 1024).toFixed(0) + " KB) e "
  + DET.length + " detalhes guardados pro clique");
