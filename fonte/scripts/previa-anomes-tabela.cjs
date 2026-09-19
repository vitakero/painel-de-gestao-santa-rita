// RASCUNHO: três jeitos de mostrar a variação ano a ano na tabela do Histórico.
//
// Pega o painel de verdade (output/index.html), entra no lugar da pessoa, abre o Histórico
// e REDESENHA só a tabela "Os números" no formato pedido. Números são os do próprio painel.
// Esconde o que está acima da tabela pra foto sair limpa.
//
//   VARIANTE=a node scripts/previa-anomes-tabela.cjs    (a | b | c)
//   MEDIDA=marg VARIANTE=a node scripts/previa-anomes-tabela.cjs
// Isto NUNCA vai pro ar.
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(process.env.HOME, "vr-looker-integration");
const V = (process.env.VARIANTE || "a").toLowerCase().replace(/[^abcd]/g, "") || "a";
const MEDIDA = (process.env.MEDIDA || "fat").replace(/[^a-z]/g, "");
const SAIDA = path.join(RAIZ, ".previa", "previa-tabela-" + V + ".html");
let h = fs.readFileSync(path.join(RAIZ, "output", "index.html"), "utf8");

const STUB = `<script>
(function(){
  var V = ${JSON.stringify(V)}, MED = ${JSON.stringify(MEDIDA)};
  var MESES = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
  var TIPOS = { fat:"brl", marg:"brl", cup:"num", qtd:"num" };
  var CAMPOS = { fat:"fat", marg:"marg", cup:"cup", qtd:"qtd" };

  function brl(v){ return "R$ "+v.toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2}); }
  function nnum(v){ return Math.round(v).toLocaleString("pt-BR"); }
  function val(t,v){ return t==="brl"?brl(v):nnum(v); }
  function pctTxt(p){ return (p>=0?"&#9650; ":"&#9660; ")+Math.abs(p).toLocaleString("pt-BR",{minimumFractionDigits:1,maximumFractionDigits:1})+"%"; }
  function cls(p){ return p>=0?"hs-pos":"hs-neg"; }

  function redesenhar(){
    var campo = CAMPOS[MED], tipo = TIPOS[MED];
    var porMes = hsPorMes(DIA, campo), porAno = hsPorAno(DIA, campo);
    var anos = Object.keys(porAno).sort();
    var mesCorrente = hsUltimoDia(DIA).slice(0,7);

    // MES PELA METADE NAO SERVE DE BASE. Marco de 2023 so tem do dia 17 em diante: meio mes
    // (R$ 1,6 mi) contra o marco inteiro de 2024 (R$ 4,1 mi) dava +147,2% na tela — a loja
    // nao cresceu nada disso. Mesma doenca do ano pela metade, so que no mes.
    //
    // A REGUA E CONTAR OS DIAS, nao olhar a borda do ano. A primeira versao exigia que o ano
    // comecasse em 01/01, e como a loja fecha no dia 1o de janeiro NENHUM janeiro passava:
    // sumiram todas as comparacoes de janeiro junto com o marco. Contando dias, feriado
    // fechado (1 dia) passa e comeco de base (16 dias) nao.
    var DIAS_NO_MES = {};
    DIA.forEach(function(r){ var m=r.d.slice(0,7); DIAS_NO_MES[m]=(DIAS_NO_MES[m]||0)+1; });
    var FOLGA = 3;   // feriado em que a loja fecha; na base inteira nenhum mes perde mais que 1
    function mesCompleto(a, mm){
      var tem = DIAS_NO_MES[a+"-"+mm];
      if(!tem) return false;
      var doMes = new Date(Number(a), Number(mm), 0).getDate();
      return tem >= doMes - FOLGA;
    }
    // variação do mês contra o MESMO mês do ano anterior. Os DOIS têm que estar inteiros.
    function pctMes(a, mm){
      var ant = String(Number(a)-1);
      var vA = porMes[a+"-"+mm], vB = porMes[ant+"-"+mm];
      if(vA===undefined || vB===undefined || !vB) return null;
      if(!mesCompleto(a,mm) || !mesCompleto(ant,mm)) return null;
      return (vA/vB-1)*100;
    }
    // POR QUE ESTE TRACO ESTA AQUI. Hoje o mesmo "—" aparece por tres motivos diferentes:
    // base pela metade, mes que ainda corre, e mes que nem chegou. Parecem iguais e nao sao.
    var MESES_INT = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
    function motivo(a, mm){
      var ant = String(Number(a)-1), nome = MESES_INT[Number(mm)-1];
      var vA = porMes[a+"-"+mm], vB = porMes[ant+"-"+mm];
      if(vA===undefined && vB===undefined) return null;
      if(vA===undefined) return (a+"-"+mm) > mesCorrente
        ? "Ainda não chegou " + nome + " de " + a + ". A comparação aparece quando o mês acontecer."
        : "Não há " + nome + " de " + a + " na base.";
      if(vB===undefined) return "A base começa em 17/03/2023, então não existe " + nome + " de " + ant + " para comparar.";
      if(!mesCompleto(a,mm)) return nome.charAt(0).toUpperCase()+nome.slice(1) + " de " + a + " ainda não fechou. Comparar um mês pela metade com um mês inteiro mostraria uma queda que não existe.";
      if(!mesCompleto(ant,mm)) return nome.charAt(0).toUpperCase()+nome.slice(1) + " de " + ant + " só tem do dia 17 em diante — a base começa aí. Meio mês contra um mês inteiro daria +147,2%, que não é crescimento de verdade.";
      return null;
    }
    function tdPct(p, a, mm){
      if(p!==null) return "<td class='"+cls(p)+"' style='font-weight:700'>"+pctTxt(p)+"</td>";
      if(V!=="d" || a===undefined) return "<td class='hs-vaz'>—</td>";
      var tip = motivo(a, mm);
      if(!tip) return "<td class='hs-vaz'>—</td>";
      return "<td class='hs-vaz'><span class='hs-tip' data-tip=\\""+tip.replace(/"/g,"&quot;")+"\\">—</span></td>";
    }

    var thead="", corpo="", rod="";

    if(V==="a" || V==="d"){
      // ---- A: uma coluna de % logo depois de cada ano ----
      thead = "<tr><th>Mês</th>" + anos.map(function(a,i){
        return "<th>"+a+"</th>" + (i>0 ? "<th>vs "+anos[i-1]+"</th>" : "");
      }).join("") + "</tr>";
      for(var m=1;m<=12;m++){
        var mm=("0"+m).slice(-2), tds="";
        anos.forEach(function(a,i){
          var v=porMes[a+"-"+mm], corr=((a+"-"+mm)===mesCorrente);
          tds += (v===undefined) ? "<td class='hs-vaz'>—</td>"
                                 : "<td>"+val(tipo,v)+(corr?" *":"")+"</td>";
          if(i>0) tds += tdPct(pctMes(a,mm), a, mm);
        });
        corpo += "<tr><td class='mes'>"+MESES[m-1]+"</td>"+tds+"</tr>";
      }
      rod = "<tr><td class='mes'>Ano</td>" + anos.map(function(a,i){
        var c = i>0 ? hsCompara(DIA,campo,a) : null;
        return "<td>"+val(tipo,porAno[a])+"</td>" + (i>0 ? (c?tdPct(c.pct):"<td class='hs-vaz'>—</td>") : "");
      }).join("") + "</tr>";

    } else if(V==="b"){
      // ---- B: % miúda embaixo do valor, mesma coluna ----
      thead = "<tr><th>Mês</th>"+anos.map(function(a){ return "<th>"+a+"</th>"; }).join("")+"</tr>";
      for(var m2=1;m2<=12;m2++){
        var mm2=("0"+m2).slice(-2), tds2="";
        anos.forEach(function(a,i){
          var v=porMes[a+"-"+mm2];
          if(v===undefined){ tds2+="<td class='hs-vaz'>—</td>"; return; }
          var corr=((a+"-"+mm2)===mesCorrente), p=(i>0?pctMes(a,mm2):null);
          tds2 += "<td><div>"+val(tipo,v)+(corr?" *":"")+"</div>"
                + (p!==null ? "<div class='hs-sub "+cls(p)+"'>"+pctTxt(p)+"</div>"
                            : "<div class='hs-sub hs-vaz'>&nbsp;</div>") + "</td>";
        });
        corpo += "<tr><td class='mes'>"+MESES[m2-1]+"</td>"+tds2+"</tr>";
      }
      rod = "<tr><td class='mes'>Ano</td>"+anos.map(function(a,i){
        var c = i>0 ? hsCompara(DIA,campo,a) : null;
        return "<td><div>"+val(tipo,porAno[a])+"</div>"
             + (c ? "<div class='hs-sub "+cls(c.pct)+"'>"+pctTxt(c.pct)+"</div>" : "<div class='hs-sub hs-vaz'>&nbsp;</div>")+"</td>";
      }).join("")+"</tr>";

    } else {
      // ---- C: os anos primeiro, as variações em bloco no fim ----
      thead = "<tr><th>Mês</th>"+anos.map(function(a){ return "<th>"+a+"</th>"; }).join("")
            + anos.slice(1).map(function(a,i){ return "<th>"+a.slice(2)+" vs "+anos[i].slice(2)+"</th>"; }).join("")+"</tr>";
      for(var m3=1;m3<=12;m3++){
        var mm3=("0"+m3).slice(-2);
        var tds3 = anos.map(function(a){
          var v=porMes[a+"-"+mm3];
          if(v===undefined) return "<td class='hs-vaz'>—</td>";
          return "<td>"+val(tipo,v)+(((a+"-"+mm3)===mesCorrente)?" *":"")+"</td>";
        }).join("");
        var pcs = anos.slice(1).map(function(a){ return tdPct(pctMes(a,mm3)); }).join("");
        corpo += "<tr><td class='mes'>"+MESES[m3-1]+"</td>"+tds3+pcs+"</tr>";
      }
      rod = "<tr><td class='mes'>Ano</td>"+anos.map(function(a){ return "<td>"+val(tipo,porAno[a])+"</td>"; }).join("")
          + anos.slice(1).map(function(a){ var c=hsCompara(DIA,campo,a); return c?tdPct(c.pct):"<td class='hs-vaz'>—</td>"; }).join("")+"</tr>";
    }

    document.getElementById("hsTbl").innerHTML =
      "<thead>"+thead+"</thead><tbody>"+corpo+"</tbody><tfoot>"+rod+"</tfoot>";

    var st=document.createElement("style");
    st.textContent = "#page-historico .hs-sub{font-size:11.5px;font-weight:700;margin-top:2px;}"
      + "#page-historico .hs-tip{cursor:help;border-bottom:1px dotted #b7c0cb;padding-bottom:1px;}"
      + "#page-historico .hs-tip:hover,#page-historico .hs-tip.mostrar{color:#157a35;}"
      + "#page-historico .hs-balao{position:absolute;display:none;width:250px;background:#1f2d3d;color:#fff;font-size:11.5px;font-weight:500;line-height:1.45;padding:9px 11px;border-radius:8px;text-align:left;z-index:60;box-shadow:0 4px 14px rgba(0,0,0,.18);pointer-events:none;}"
      + "#page-historico .hs-balao.ver{display:block;}"
      + "#page-historico .hs-tbl td{white-space:nowrap;}"
      + "#page-historico .hs-tbl{min-width:0;}";
    document.head.appendChild(st);

    // O BALAO MORA FORA DA CAIXA DE ROLAGEM. A tabela rola de lado (overflow-x), e isso
    // corta tambem em cima e embaixo: o balao desenhado dentro dela aparecia pela metade.
    // Entao existe UM balao so, filho do cartao, colocado na mao sobre a celula.
    var cartao = document.querySelectorAll("#page-historico .card")[1];
    cartao.style.position = "relative";
    var balao = document.createElement("div");
    balao.className = "hs-balao";
    cartao.appendChild(balao);
    function abrir(el){
      balao.textContent = el.getAttribute("data-tip") || "";
      balao.classList.add("ver");
      var c = cartao.getBoundingClientRect(), r = el.getBoundingClientRect();
      var esq = r.left - c.left + r.width/2 - 125;
      esq = Math.max(8, Math.min(esq, c.width - 258));
      balao.style.left = esq + "px";
      var acima = r.top - c.top - balao.offsetHeight - 9;
      balao.style.top = (acima > 4 ? acima : (r.bottom - c.top + 9)) + "px";
    }
    function fechar(){ balao.classList.remove("ver"); }
    document.querySelectorAll("#page-historico .hs-tip").forEach(function(el){
      el.addEventListener("mouseenter", function(){ abrir(el); });
      el.addEventListener("mouseleave", fechar);
      el.addEventListener("focus", function(){ abrir(el); });
      el.addEventListener("blur", fechar);
      el.setAttribute("tabindex","0");
    });

    // pra FOTO: abre o balao do MARCO (na tela de verdade so abre no mouse)
    if(V==="d"){
      var alvos=document.querySelectorAll("#page-historico .hs-tip");
      for(var q=0;q<alvos.length;q++){
        if((alvos[q].getAttribute("data-tip")||"").indexOf("do dia 17 em diante")>=0){
          alvos[q].classList.add("mostrar"); abrir(alvos[q]); break;
        }
      }
    }
    // foto limpa: só a tabela
    var sec=document.getElementById("page-historico");
    sec.querySelector(".hs-top").style.display="none";
    sec.querySelector(".hs-anos").style.display="none";
    sec.querySelectorAll(".card")[0].style.display="none";
    sec.querySelectorAll(".card")[1].style.marginTop="0";
  }

  var t=0;
  function entrar(){
    t++;
    var b=document.querySelector('[data-page="historico"]');
    if(!b || typeof DIA==="undefined" || typeof hsPorMes!=="function"){ if(t<60) setTimeout(entrar,150); return; }
    window.__PERFIL={ id:"11111111-1111-1111-1111-111111111111", is_master:true, paginas:["historico"] };
    window.__EMAIL="previa@santarita";
    try{ var ov=document.getElementById("authOv"); if(ov&&ov.parentNode) ov.parentNode.removeChild(ov); }catch(e){}
    try{ document.body.style.overflow=""; }catch(e){}
    try{ if(window.__navmocss&&window.__navmocss.parentNode) window.__navmocss.parentNode.removeChild(window.__navmocss); }catch(e){}
    try{ if(window.__pgcss&&window.__pgcss.parentNode) window.__pgcss.parentNode.removeChild(window.__pgcss); }catch(e){}
    document.querySelectorAll(".nav-item").forEach(function(x){ x.style.display="flex"; x.classList.remove("nav-locked"); });
    b.click();
    setTimeout(function(){
      try{ redesenhar(); }catch(e){ document.body.innerHTML="<pre>"+e.message+"\\n"+e.stack+"</pre>"; }
    },100);
  }
  entrar();
})();
</script>`;

const _fim = h.lastIndexOf("</body>");
h = h.slice(0, _fim) + STUB + h.slice(_fim);
h = h.replace("<title>", "<title>RASCUNHO " + V.toUpperCase() + " · ");
h = h.replace("</head>", "<style>*,*::before,*::after{animation:none!important;transition:none!important}</style></head>");
fs.mkdirSync(path.dirname(SAIDA), { recursive: true });
fs.writeFileSync(SAIDA, h);
console.log("OK -> " + SAIDA);
