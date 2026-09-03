// Gera uma PRÉVIA da página Entregas para conferência visual, sem precisar de login.
//
// Pega o painel de verdade (output/index.html) e troca só a conexão com a nuvem por dados
// de exemplo. O desenho é o do painel publicado — não uma imitação que envelhece sozinha.
//
//   node scripts/previa-entregas.cjs            -> o mês como está hoje (dia 1 atrasado)
//   CENA=so2   node scripts/previa-entregas.cjs -> dia 2 lançado, dia 1 ainda atrasado
//   CENA=emdia node scripts/previa-entregas.cjs -> nada atrasado (controle)
// Isto NUNCA vai pro ar.
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(process.env.HOME, "vr-looker-integration");
const CENA = (process.env.CENA || "hoje").replace(/[^a-z0-9]/g, "");
const SAIDA = path.join(RAIZ, ".previa", "previa-entregas-" + CENA + ".html");
let h = fs.readFileSync(path.join(RAIZ, "output", "index.html"), "utf8");

const STUB = `<script>
(function(){
  var CENA = "__CENA__";
  var EQ = [
    { id:"a0000000-0000-0000-0000-000000000001", nome:"Anderson",  ativo:true },
    { id:"a0000000-0000-0000-0000-000000000002", nome:"Francisco", ativo:true },
    { id:"a0000000-0000-0000-0000-000000000003", nome:"Joseildo",  ativo:true },
    { id:"a0000000-0000-0000-0000-000000000004", nome:"Josinaldo", ativo:true }
  ];

  // ---- um cliente de mentira, com a mesma cara do supabase-js ----
  function resp(dados){
    var p = { data:dados, error:null };
    p.then = function(ok){ setTimeout(function(){ ok({data:dados, error:null}); }, 0); return p; };
    p.order=function(){return p;}; p.eq=function(){return p;}; p.gte=function(){return p;};
    p.lte=function(){return p;}; p.in=function(){return p;}; p.limit=function(){return p;};
    p.select=function(){return p;}; p.single=function(){return p;}; p.maybeSingle=function(){return p;};
    return p;
  }
  var FAKE_SB = {
    from: function(t){
      return {
        select: function(){ return resp(t==="entregas_equipe" ? EQ : []); },
        insert:function(){return resp([]);}, upsert:function(){return resp([]);},
        update:function(){return resp([]);}, delete:function(){return resp([]);}
      };
    },
    rpc: function(nome){
      if(nome==="entregas_config_do_mes")
        return resp([{ meta_base:600, meta_desafio:850, valor_base:1, valor_desafio:1.8,
                       eh_master:true, existe:true }]);
      return resp([]);
    },
    channel: function(){ var c={ on:function(){return c;}, subscribe:function(){return c;} }; return c; },
    removeChannel: function(){}
  };

  var tentativas = 0;
  function entrar(){
    tentativas++;
    var b = document.querySelector('[data-page="entregas"]');
    if(!b){ if(tentativas < 60) setTimeout(entrar, 150); return; }
    window.__SB = FAKE_SB;
    window.__PERFIL = { id:"11111111-1111-1111-1111-111111111111", is_master:true, paginas:["entregas"] };
    window.__EMAIL = "previa@santarita";
    try{ var ov=document.getElementById("authOv"); if(ov && ov.parentNode) ov.parentNode.removeChild(ov); }catch(e){}
    try{ document.body.style.overflow=""; }catch(e){}
    try{ if(window.__navmocss && window.__navmocss.parentNode){ window.__navmocss.parentNode.removeChild(window.__navmocss); } }catch(e){}
    document.querySelectorAll(".nav-item").forEach(function(x){ x.style.display="flex"; x.classList.remove("nav-locked"); });
    b.click();

    // O painel carrega da nuvem depois de desenhar. Ponho o cenário POR CIMA e redesenho —
    // é a mesma ordem que acontece na loja.
    setTimeout(function(){
      try{
        // HOJE é let: não vive no window. Uso a data direta — é a mesma conta.
        var _h=new Date(), a=_h.getFullYear(), m=_h.getMonth();
        var mk=a+"-"+m, dados={};
        function poe(dia,qtd){ EQ.forEach(function(p,i){
          dados[p.id]=dados[p.id]||{}; dados[p.id][dia]=String(qtd+i*3); }); }
        // CENA "hoje": setembro em branco. O dia 1 (terça) passou e ninguém lançou; o
        // dia 2 (quarta) é o serviço de hoje. É exatamente a tela da queixa.
        // CENA "so2": ela lançou o dia 2 e o 1 continua para trás — é o teste de que o
        // atraso NÃO desaparece quando o dia da vez fica pronto.
        // CENA "emdia": os dois lançados, nada para trás (controle).
        if(CENA==="so2"){ poe(2,44); }
        if(CENA==="emdia"){ poe(1,40); poe(2,44); }
        window.entEquipe = EQ.slice();
        window.entDados  = {}; window.entDados[mk] = dados;
        window.entNomes  = {};
        window.entDiasConf = {};
        window.entCfg = { base:600, desafio:850, vbase:1, vdes:1.8,
                          master:true, existe:true, atualizado_em:null, carregado:true };
        window.entCfgMes = mk;
        window.entFech = null;
        renderEntregas();
        // entEdit é let (não vive no window): abro a grade pelo botão, como a pessoa faz.
        var bt=document.getElementById("entEditar");
        if(bt && document.getElementById("entGradeWrap").style.display==="none") bt.click();
      }catch(e){ console.log("PREVIA ERRO: "+e.message); }
    }, 900);
  }
  setTimeout(entrar, 300);
})();
</script>`;

var _fim = h.lastIndexOf("</body>");
h = h.slice(0, _fim) + STUB.replace("__CENA__", CENA) + h.slice(_fim);
h = h.replace("<title>", "<title>PRÉVIA · ");
h = h.replace("</head>", "<style>*,*::before,*::after{animation:none!important;transition:none!important}</style></head>");

fs.mkdirSync(path.dirname(SAIDA), { recursive: true });
fs.writeFileSync(SAIDA, h);
console.log("PRÉVIA -> " + SAIDA + "  (" + Math.round(fs.statSync(SAIDA).size / 1024) + " KB)");
