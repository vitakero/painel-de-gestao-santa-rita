// RASCUNHO: a gaveta de KPIs do mês no Histórico, em duas versões, pra escolher.
//
// Pega o painel de verdade, abre o Histórico e enfia a gaveta aberta embaixo de um mês.
// Os números são calculados do DIA[] do próprio painel — nada inventado.
//
//   VERSAO=a MES=2026-01 node scripts/previa-gaveta.cjs
//   VERSAO=b MES=2026-08 node scripts/previa-gaveta.cjs
// Isto NUNCA vai pro ar.
const fs = require("fs");
const path = require("path");
const RAIZ = path.join(process.env.HOME, "vr-looker-integration");
const V = (process.env.VERSAO || "a").toLowerCase() === "b" ? "b" : "a";
const MES = (process.env.MES || "2026-01");
const SAIDA = path.join(RAIZ, ".previa", "previa-gaveta-" + V + ".html");
let h = fs.readFileSync(path.join(RAIZ, "output", "index.html"), "utf8");

const STUB = `<script>
(function(){
  var V = ${JSON.stringify(V)}, MES = ${JSON.stringify(MES)};
  var SEM = ["domingo","segunda","terça","quarta","quinta","sexta","sábado"];
  var SEMC = ["dom","seg","ter","qua","qui","sex","sáb"];

  function kpis(mes){
    var dias = DIA.filter(function(r){ return r.d.slice(0,7)===mes; });
    if(!dias.length) return null;
    var S=function(f){ return dias.reduce(function(a,r){ return a+(r[f]||0); },0); };
    var fat=S("fat"), marg=S("marg"), cup=S("cup"), qtd=S("qtd");
    var ord = dias.slice().sort(function(a,b){ return b.fat-a.fat; });
    var sab=0, porSem=[0,0,0,0,0,0,0], nSem=[0,0,0,0,0,0,0];
    dias.forEach(function(r){
      var w = new Date(r.d+"T12:00:00Z").getUTCDay();
      porSem[w]+=r.fat; nSem[w]++; if(w===6) sab++;
    });
    return { mes:mes, dias:dias.length, fat:fat, marg:marg, cup:cup, qtd:qtd,
             tk: cup?fat/cup:0, ipc: cup?qtd/cup:0, md: fat/dias.length,
             sab:sab, melhor:ord[0], pior:ord[ord.length-1],
             porSem:porSem, nSem:nSem };
  }
  function pct(a,b){ return (b&&b!==0) ? (a/b-1)*100 : null; }
  function sinal(p){ return (p>=0?"+":"\\u2212")+Math.abs(p).toLocaleString("pt-BR",{minimumFractionDigits:1,maximumFractionDigits:1})+"%"; }
  function cls(p){ return p>=0?"hs-pos":"hs-neg"; }
  function seta(p){ return "<span class='hs-seta'>"+(p>=0?"&#9650;":"&#9660;")+"</span>"; }
  function dm(iso){ return iso.slice(8,10)+"/"+iso.slice(5,7); }
  function diaSem(iso){ return SEM[new Date(iso+"T12:00:00Z").getUTCDay()]; }

  function item(rotulo, valor, comp){
    return "<div class='px-det-item'>"
         + "<div style='font-size:11px;color:#6b7787;text-transform:uppercase;letter-spacing:.4px;font-weight:600;'>"+rotulo+"</div>"
         + "<div style='font-size:19px;font-weight:700;color:#1f2b3a;margin-top:3px;font-variant-numeric:tabular-nums;'>"+valor+"</div>"
         + (comp ? "<div style='font-size:12px;margin-top:2px;font-variant-numeric:tabular-nums;'>"+comp+"</div>" : "")
         + "</div>";
  }
  function comp(p, sufixo){
    if(p===null) return "<span style='color:#b7c0cb'>—</span>";
    return "<b class='"+cls(p)+"'>"+seta(p)+" "+sinal(p)+"</b> <span style='color:#8a97a8'>"+sufixo+"</span>";
  }

  function montar(){
    var k = kpis(MES); if(!k) return;
    var ano = MES.slice(0,4), mm = MES.slice(5,7);
    var ant = kpis((Number(ano)-1)+"-"+mm);
    var nomeMes = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"][Number(mm)-1];
    var vsAno = (Number(ano)-1);
    var diasNoMes = new Date(Number(ano), Number(mm), 0).getDate();

    var chips = ["2023","2024","2025","2026"].map(function(a){
      var tem = !!kpis(a+"-"+mm);
      var ativo = (a===ano);
      return "<span style=\\"display:inline-block;padding:3px 11px;border-radius:20px;font-size:12px;font-weight:700;margin-right:6px;"
           + (ativo ? "background:#157a35;color:#fff;" : (tem ? "background:#e8eef4;color:#46546a;cursor:pointer;" : "background:#f3f6fa;color:#c3ccd7;"))
           + "\\">"+a+"</span>";
    }).join("");

    var cab = "<div style='display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:14px;'>"
            + "<b style='font-size:16px;color:#1f2b3a;'>"+nomeMes.charAt(0).toUpperCase()+nomeMes.slice(1)+" de "+ano+"</b>"
            + "<span style='font-size:12.5px;color:#6b7787;'>mês fechado &middot; "+k.dias+" dias abertos de "+diasNoMes+"</span>"
            + "<span style='margin-left:auto;'>"+chips+"</span></div>";

    var corpo = "";
    if(V==="a"){
      corpo = "<div class='px-det-box'>"
        + item("Faturamento", hsBrl(k.fat), comp(ant?pct(k.fat,ant.fat):null, "vs "+vsAno))
        + item("Vendas (cupons)", hsNum(k.cup), comp(ant?pct(k.cup,ant.cup):null, "vs "+vsAno))
        + item("Ticket médio", hsBrl(k.tk), comp(ant?pct(k.tk,ant.tk):null, "vs "+vsAno))
        + item("Margem", (k.marg/k.fat*100).toLocaleString("pt-BR",{minimumFractionDigits:1,maximumFractionDigits:1})+"%",
               ant ? "<b class='"+cls((k.marg/k.fat-ant.marg/ant.fat))+"'>"+((k.marg/k.fat-ant.marg/ant.fat)>=0?"+":"\\u2212")
                   + Math.abs((k.marg/k.fat-ant.marg/ant.fat)*100).toLocaleString("pt-BR",{minimumFractionDigits:1,maximumFractionDigits:1})
                   + " ponto</b> <span style='color:#8a97a8'>vs "+vsAno+"</span>" : null)
        + item("Itens vendidos", hsNum(k.qtd), comp(ant?pct(k.qtd,ant.qtd):null, "vs "+vsAno))
        + item("Média por dia aberto", hsBrl(k.md), comp(ant?pct(k.md,ant.md):null, "vs "+vsAno))
        + "</div>";
    } else {
      var pc = ant?pct(k.cup,ant.cup):null, pt = ant?pct(k.tk,ant.tk):null, pq = ant?pct(k.qtd,ant.qtd):null;
      var veredito = "";
      if(pc!==null && pt!==null){
        veredito = (pc>=Math.abs(pt)) ? "veio de <b>mais gente na loja</b>"
                 : (pq!==null && pq<0 && pt>0) ? "veio de <b>preço</b>, não de volume"
                 : "veio de <b>ticket maior</b>";
      }
      var maxSem = Math.max.apply(null, k.porSem.map(function(v,i){ return k.nSem[i]?v/k.nSem[i]:0; }));
      var barrasSem = k.porSem.map(function(v,i){
        var med = k.nSem[i]?v/k.nSem[i]:0, alt = maxSem?Math.round(med/maxSem*100):0;
        return "<div style='flex:1;text-align:center;'>"
             + "<div style='height:54px;display:flex;align-items:flex-end;justify-content:center;'>"
             + "<div style='width:60%;height:"+alt+"%;background:#4a9468;border-radius:3px 3px 0 0;' title='"+SEM[i]+": "+hsBrl(med)+"/dia'></div></div>"
             + "<div style='font-size:10.5px;color:#8b96a5;margin-top:4px;'>"+SEMC[i]+"</div></div>";
      }).join("");

      corpo = "<div class='px-det-box'>"
        + item("Faturamento", hsBrl(k.fat), comp(ant?pct(k.fat,ant.fat):null, "vs "+vsAno))
        + item("Média por dia aberto", hsBrl(k.md), comp(ant?pct(k.md,ant.md):null, "vs "+vsAno))
        + item("Subiu por quê?", (veredito||"—"),
               ant ? "<span style='color:#8a97a8'>cupons "+sinal(pc)+" &middot; ticket "+sinal(pt)+"</span>" : null)
        + item("Melhor dia", hsBrl(k.melhor.fat), "<span style='color:#8a97a8'>"+dm(k.melhor.d)+", "+diaSem(k.melhor.d)+"</span>")
        + item("Pior dia", hsBrl(k.pior.fat), "<span style='color:#8a97a8'>"+dm(k.pior.d)+", "+diaSem(k.pior.d)+"</span>")
        + item("Sábados no mês", k.sab + (ant ? " (contra "+ant.sab+")" : ""),
               (ant && k.sab!==ant.sab) ? "<span style='color:#8a97a8'>calendário ajudou</span>" : "<span style='color:#8a97a8'>mesmo calendário</span>")
        + "</div>"
        + "<div style='padding:0 20px 16px;'>"
        + "<div style='font-size:11px;color:#6b7787;text-transform:uppercase;letter-spacing:.4px;font-weight:600;margin-bottom:6px;'>Média por dia da semana</div>"
        + "<div style='display:flex;gap:6px;max-width:460px;'>"+barrasSem+"</div></div>";
    }

    // acha a linha do mes na tabela e enfia a gaveta embaixo
    var alvo=null;
    document.querySelectorAll("#hsTbl tbody tr").forEach(function(tr){
      if(tr.cells[0].innerText.trim()===["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"][Number(mm)-1]) alvo=tr;
    });
    if(!alvo) return;
    var nCols = alvo.cells.length;
    // a setinha na coluna do mes
    alvo.cells[0].innerHTML = "<button class='px-exp aberto' style='vertical-align:middle;margin-right:4px;'>"
      + "<svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'><polyline points='9 18 15 12 9 6'/></svg>"
      + "</button>" + alvo.cells[0].innerHTML;
    var tr = document.createElement("tr");
    tr.className = "px-det";
    tr.innerHTML = "<td colspan='"+nCols+"'><div class='px-det-wrap'>"
                 + "<div style='padding:16px 20px 0;'>"+cab+"</div>" + corpo + "</div></td>";
    alvo.parentNode.insertBefore(tr, alvo.nextSibling);
  }

  var t=0;
  function entrar(){
    t++;
    var b=document.querySelector('[data-page="historico"]');
    if(!b || typeof DIA==="undefined"){ if(t<60) return setTimeout(entrar,150); return; }
    window.__PERFIL={ id:"11111111-1111-1111-1111-111111111111", is_master:true, paginas:["historico"] };
    window.__EMAIL="previa@santarita";
    try{ var ov=document.getElementById("authOv"); if(ov&&ov.parentNode) ov.parentNode.removeChild(ov); }catch(e){}
    try{ document.body.style.overflow=""; }catch(e){}
    try{ if(window.__navmocss&&window.__navmocss.parentNode) window.__navmocss.parentNode.removeChild(window.__navmocss); }catch(e){}
    try{ if(window.__pgcss&&window.__pgcss.parentNode) window.__pgcss.parentNode.removeChild(window.__pgcss); }catch(e){}
    document.querySelectorAll(".nav-item").forEach(function(x){ x.style.display="flex"; x.classList.remove("nav-locked"); });
    b.click();
    setTimeout(function(){ try{ montar(); }catch(e){ document.body.innerHTML="<pre>"+e.message+"\\n"+e.stack+"</pre>"; } }, 120);
  }
  entrar();
})();
</script>`;

const _fim = h.lastIndexOf("</body>");
h = h.slice(0, _fim) + STUB + h.slice(_fim);
h = h.replace("<title>", "<title>RASCUNHO GAVETA " + V.toUpperCase() + " · ");
h = h.replace("</head>", "<style>*,*::before,*::after{animation:none!important;transition:none!important}</style></head>");
fs.mkdirSync(path.dirname(SAIDA), { recursive: true });
fs.writeFileSync(SAIDA, h);
console.log("OK -> " + SAIDA + "  (mes " + MES + ")");
