// RASCUNHO: os dois KPIs de Frente de Caixa (Cancelamentos e Descontos manuais)
// dentro da tela Análise DE VERDADE, com dados reais lidos do VR.
//
//   node scripts/previa-frentecaixa.cjs
//
// Pega o output/index.html real, entra na Análise e injeta a faixa CONTROLE OPERACIONAL
// depois dos indicadores que já existem. O clique no card abre o detalhamento.
// Isto NUNCA vai pro ar — é só pro dono ver antes de eu implementar de verdade.
const fs = require("fs");
const path = require("path");
const RAIZ = path.join(process.env.HOME, "vr-looker-integration");
const SAIDA = path.join(RAIZ, ".previa", "previa-frentecaixa.html");
const DADOS = JSON.parse(fs.readFileSync(path.join(RAIZ, ".previa", "fcx-dados.json"), "utf8"));
let h = fs.readFileSync(path.join(RAIZ, "output", "index.html"), "utf8");

const STUB = `<script>
(function(){
var FCX = ${JSON.stringify(DADOS)};

/* ==FCX-CFG== Parâmetros do módulo. Um lugar só — nada espalhado pelo código. */
var CFG = {
  refCancelamento: 0.50,   // % sobre a venda, régua MENSAL
  refDesconto:     0.30,   // % sobre a venda
  limiteItem:      0.50,   // desconto que tira >= metade do preço do item vira alerta
  exigirMotivo:    true    // desconto sem motivo informado vira alerta
};
/* ==FCX-GRUPOS== nome de cada grupo. Motivo fora da classificação cai em naoclass. */
var GRUPO = { erro:"Erro de operação", cliente:"Cliente desistiu", pagto:"Pagamento falhou",
              equip:"Equipamento", naoclass:"Não classificado" };
var COR   = { erro:"#BA7517", cliente:"#1b9e4b", pagto:"#1565c0", equip:"#8a97a8", naoclass:"#c0392b" };
var ORDEM = ["erro","pagto","cliente","equip","naoclass"];

function brl(v){ return "R$ "+Number(v||0).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2}); }
function n0(v){ return Math.round(v).toLocaleString("pt-BR"); }
function pc(v,c){ return Number(v).toFixed(c===undefined?2:c).replace(".",",")+"%"; }
function dm(s){ var p=s.split("-"); return p[2]+"/"+p[1]; }

function periodo(){
  var de=document.getElementById("anDe").value||"2026-01-01";
  var ate=document.getElementById("anAte").value||"2026-12-31";
  if(de>ate){ var t=de; de=ate; ate=t; }
  return [de,ate];
}
/* base de vendas = o MESMO faturamento que os outros KPIs da tela usam (DIA[]) */
function baseVendas(de,ate){
  return DIA.filter(function(x){ return x.d>=de&&x.d<=ate; })
            .reduce(function(s,x){ return s+(x.fat||0); },0);
}
function somaDias(de,ate){
  var z={ce:0,cev:0,cc:0,ccv:0,cp:0,cpv:0,cq:0,cqv:0,cn:0,cnv:0,dn:0,dv:0,da:0,ds:0,dal:0,dias:0};
  FCX.FCX_DIA.forEach(function(r){
    if(r.d<de||r.d>ate) return; z.dias++;
    for(var k in z) if(k!=="dias") z[k]+=(r[k]||0);
  });
  return z;
}
function statusCanc(p){ return p<=CFG.refCancelamento ? ["EM DIA","ok"] : ["ACIMA DA REFERÊNCIA","bad"]; }

function montar(){
  var pr=periodo(), de=pr[0], ate=pr[1];
  var s=somaDias(de,ate), base=baseVendas(de,ate);
  var cancV=s.cev+s.ccv+s.cpv+s.cqv+s.cnv, cancN=s.ce+s.cc+s.cp+s.cq+s.cn;

  /* o MÊS é a régua: pega o mês da data final */
  var mes=ate.slice(0,7);
  var sm=somaDias(mes+"-01",mes+"-31"), bm=baseVendas(mes+"-01",mes+"-31");
  var cancMesV=sm.cev+sm.ccv+sm.cpv+sm.cqv+sm.cnv;
  var pctMes = bm? cancMesV/bm*100 : null;
  var pctPer = base? cancV/base*100 : null;
  var st = pctMes===null ? ["SEM DADOS","est"] : statusCanc(pctMes);
  var mesmoMes = (de.slice(0,7)===mes && de.slice(8)==="01");

  var temDado = s.dias>0;
  var cardC =
    '<div class="kpi fcx-card" data-fcx="canc">'+
      '<div class="l">Cancelamentos</div>'+
      (temDado
        ? '<div class="v '+(st[1]==="bad"?"ind-bad":"ind-ok")+'">'+pc(pctPer)+'</div>'+
          '<div class="fcx-sub">'+brl(cancV)+' · '+n0(cancN)+' ocorrências</div>'+
          (mesmoMes?'':'<div class="fcx-sub">no mês: '+pc(pctMes)+'</div>')+
          '<div class="fcx-rod">Referência ≤ '+pc(CFG.refCancelamento)+' ao mês</div>'+
          '<span class="fcx-selo fcx-'+st[1]+'">'+st[0]+'</span>'
        : '<div class="v ind-est">SEM DADOS</div><div class="fcx-sub">período sem movimento</div>')+
      '<div class="fcx-clique">clique para ver a composição</div>'+
    '</div>';

  var pctD = base? s.dv/base*100 : null;
  var motivosAlerta = s.da+s.ds;
  var cardD =
    '<div class="kpi fcx-card" data-fcx="desc">'+
      '<div class="l">Descontos manuais</div>'+
      (temDado
        ? '<div class="v '+(pctD<=CFG.refDesconto?"ind-ok":"ind-bad")+'">'+pc(pctD)+'</div>'+
          '<div class="fcx-sub">'+brl(s.dv)+' · '+n0(s.dn)+' desconto'+(s.dn===1?"":"s")+'</div>'+
          '<div class="fcx-rod">Referência ≤ '+pc(CFG.refDesconto)+'</div>'+
          '<span class="fcx-selo fcx-'+(pctD<=CFG.refDesconto?"ok":"bad")+'">'+(pctD<=CFG.refDesconto?"DENTRO DA REFERÊNCIA":"ACIMA DA REFERÊNCIA")+'</span>'+
          (s.dal>0 ? '<div class="fcx-alerta">&#9888; '+n0(s.dal)+' alerta'+(s.dal===1?"":"s")+' para revisar</div>' : '')
        : '<div class="v ind-est">SEM DADOS</div><div class="fcx-sub">período sem movimento</div>')+
      '<div class="fcx-clique">clique para ver as ocorrências</div>'+
    '</div>';

  var el=document.getElementById("fcxBloco");
  el.innerHTML='<div class="fcx-titulo">Controle operacional</div>'+
    '<div class="kpis" style="grid-template-columns:repeat(auto-fit,minmax(250px,1fr));">'+cardC+cardD+'</div>'+
    '<div id="fcxDet"></div>';
  el.querySelectorAll(".fcx-card").forEach(function(c){
    c.addEventListener("click",function(){ abrir(c.getAttribute("data-fcx")); });
  });
}

function abrir(qual){
  var d=document.getElementById("fcxDet");
  if(d.getAttribute("data-aberto")===qual){ d.innerHTML=""; d.removeAttribute("data-aberto"); return; }
  d.setAttribute("data-aberto",qual);
  d.innerHTML = qual==="canc" ? detCanc() : detDesc();
}

function detCanc(){
  var pr=periodo(), de=pr[0], ate=pr[1];
  var s=somaDias(de,ate);
  var tot={erro:[s.ce,s.cev],pagto:[s.cp,s.cpv],cliente:[s.cc,s.ccv],equip:[s.cq,s.cqv],naoclass:[s.cn,s.cnv]};
  var somaV=0,somaN=0; ORDEM.forEach(function(g){ somaN+=tot[g][0]; somaV+=tot[g][1]; });
  var base=baseVendas(de,ate);

  var barra='<div class="fcx-barra">';
  ORDEM.forEach(function(g){ if(somaV>0&&tot[g][1]>0) barra+='<i style="width:'+(tot[g][1]/somaV*100)+'%;background:'+COR[g]+'"></i>'; });
  barra+='</div>';

  var linhas="";
  ORDEM.forEach(function(g){
    var n=tot[g][0], v=tot[g][1], zero=(n===0);
    linhas+='<tr class="fcx-lin'+(zero?" fcx-zero":"")+'" data-g="'+g+'">'+
      '<td><i class="fcx-bolinha" style="background:'+COR[g]+'"></i>'+GRUPO[g]+'</td>'+
      '<td class="r">'+n0(n)+'</td><td class="r">'+brl(v)+'</td>'+
      '<td class="r">'+(somaV?pc(v/somaV*100,1):"—")+'</td>'+
      '<td class="r">'+(base?pc(v/base*100):"—")+'</td></tr>';
  });

  /* ocorrências do período (o drill-down) */
  var oco=FCX.FCX_OCO.filter(function(x){ return x.d>=de&&x.d<=ate; });
  var fecha=Math.abs(somaV-oco.reduce(function(a,b){return a+b.v;},0))<0.005;

  return '<div class="fcx-painel">'+
    '<div class="fcx-ph">Cancelamentos · composição<span>'+dm(de)+' a '+dm(ate)+' · '+n0(somaN)+' ocorrências · '+brl(somaV)+'</span></div>'+
    barra+
    '<table class="fcx-tab"><thead><tr><th>Grupo</th><th class="r">Ocorr.</th><th class="r">Valor</th><th class="r">% do total</th><th class="r">% da venda</th></tr></thead><tbody>'+linhas+'</tbody></table>'+
    '<div class="fcx-concilia">'+(fecha?'&#10003; soma dos grupos fecha com o total':'&#9888; DIVERGÊNCIA — conferir')+'</div>'+
    '<div class="fcx-ph2">Clique num grupo para ver as ocorrências</div>'+
    '<div id="fcxOco"></div></div>';
}

function listaOco(g){
  var pr=periodo(), de=pr[0], ate=pr[1];
  var l=FCX.FCX_OCO.filter(function(x){ return x.d>=de&&x.d<=ate&&x.g===g; })
                   .sort(function(a,b){ return b.v-a.v; });
  if(!l.length) return '<div class="fcx-vazio">Nenhuma ocorrência neste grupo no período.</div>';
  var top=l.slice(0,40);
  var html='<div class="fcx-ph2">'+GRUPO[g]+' · '+n0(l.length)+' ocorrências · maiores primeiro</div>';
  top.forEach(function(x){
    html+='<div class="fcx-oc">'+
      '<div class="fcx-oc1"><span>'+(x.pr||"—")+'</span><b>'+brl(x.v)+'</b></div>'+
      '<div class="fcx-oc2">'+dm(x.d)+' '+(x.h||"")+' · PDV '+x.pdv+' · '+(x.op||"—")+' · '+
        (x.ci?'cupom cancelado inteiro':'item cancelado')+' · '+Number(x.q).toLocaleString("pt-BR")+' un · cupom '+x.nc+'</div>'+
      '<div class="fcx-oc2">motivo: '+(x.mo||"<i>sem motivo informado</i>")+(x.fi?' · autorizou: '+x.fi:'')+'</div>'+
    '</div>';
  });
  if(l.length>top.length) html+='<div class="fcx-vazio">mostrando as 40 maiores de '+n0(l.length)+'.</div>';
  return html;
}

function detDesc(){
  var pr=periodo(), de=pr[0], ate=pr[1];
  var s=somaDias(de,ate), base=baseVendas(de,ate);
  var l=FCX.FCX_DSC.filter(function(x){ return x.d>=de&&x.d<=ate; });
  var comAlerta=l.filter(function(x){
    return (x.br>0 && x.dv/x.br>=CFG.limiteItem) || (CFG.exigirMotivo && !x.mo);
  }).sort(function(a,b){ return (b.dv/b.br)-(a.dv/a.br); });
  var motivos=0; comAlerta.forEach(function(x){
    if(x.br>0&&x.dv/x.br>=CFG.limiteItem) motivos++;
    if(CFG.exigirMotivo&&!x.mo) motivos++;
  });
  var somaDet=l.reduce(function(a,b){return a+b.dv;},0);
  var fecha=Math.abs(somaDet-s.dv)<0.005;

  var html='<div class="fcx-painel">'+
    '<div class="fcx-ph">Descontos manuais<span>'+dm(de)+' a '+dm(ate)+'</span></div>'+
    '<table class="fcx-tab"><tbody>'+
    '<tr><td>Percentual sobre a venda</td><td class="r">'+(base?pc(s.dv/base*100):"—")+'</td></tr>'+
    '<tr><td>Valor total</td><td class="r">'+brl(s.dv)+'</td></tr>'+
    '<tr><td>Ocorrências</td><td class="r">'+n0(s.dn)+'</td></tr>'+
    '<tr><td>Acima de '+pc(CFG.limiteItem*100,0)+' do item</td><td class="r">'+n0(s.da)+'</td></tr>'+
    '<tr><td>Sem motivo informado</td><td class="r">'+n0(s.ds)+'</td></tr>'+
    '<tr class="fcx-forte"><td>Ocorrências para revisar</td><td class="r">'+n0(comAlerta.length)+'</td></tr>'+
    '<tr class="fcx-forte"><td>Motivos de alerta</td><td class="r">'+n0(motivos)+'</td></tr>'+
    '</tbody></table>'+
    '<div class="fcx-concilia">'+(fecha?'&#10003; detalhamento fecha com o card':'&#9888; DIVERGÊNCIA — conferir')+'</div>';

  if(comAlerta.length){
    html+='<div class="fcx-ph2">Alertas para revisar</div>';
    comAlerta.slice(0,25).forEach(function(x){
      var p=x.br>0?x.dv/x.br*100:0, av=[];
      if(x.br>0&&x.dv/x.br>=CFG.limiteItem) av.push("desconto acima de "+pc(CFG.limiteItem*100,0)+" do item");
      if(CFG.exigirMotivo&&!x.mo) av.push("motivo não informado");
      html+='<div class="fcx-al">'+
        '<div class="fcx-al1">'+(x.pr||"—")+(x.cod?' <span>'+x.cod+'</span>':'')+'</div>'+
        '<div class="fcx-al2">Valor original: '+brl(x.br)+' &nbsp;·&nbsp; Valor final: '+brl(x.br-x.dv)+' &nbsp;·&nbsp; Desconto: '+brl(x.dv)+' &nbsp;·&nbsp; <b>'+pc(p,0)+'</b></div>'+
        '<div class="fcx-al2">'+dm(x.d)+' '+(x.h||"")+' · PDV '+x.pdv+' · '+(x.op||"—")+' · cupom '+x.nc+' · motivo: '+(x.mo||"não informado")+'</div>'+
        '<div class="fcx-al3">ALERTAS: '+av.map(function(a){return "&bull; "+a;}).join(" &nbsp; ")+'</div>'+
      '</div>';
    });
  } else {
    html+='<div class="fcx-vazio">Nenhum alerta no período.</div>';
  }

  html+='<div class="fcx-ph2">Todos os descontos do período · '+n0(l.length)+'</div>';
  l.slice().sort(function(a,b){ return b.dv-a.dv; }).slice(0,20).forEach(function(x){
    html+='<div class="fcx-oc"><div class="fcx-oc1"><span>'+(x.pr||"—")+'</span><b>'+brl(x.dv)+'</b></div>'+
      '<div class="fcx-oc2">'+dm(x.d)+' '+(x.h||"")+' · PDV '+x.pdv+' · '+(x.op||"—")+' · de '+brl(x.br)+' por '+brl(x.br-x.dv)+' ('+pc(x.br>0?x.dv/x.br*100:0,0)+') · motivo: '+(x.mo||"não informado")+'</div></div>';
  });
  return html+'</div>';
}

var CSS='<style>'+
/* ==FCX-CSS== So cores que ja existem na paleta do painel: assim o gerador de tema
   escuro do build (injetarTemaEscuro) reconhece cada hex e o modo noturno sai de graca. */
'#fcxBloco{margin-top:22px;}'+
'.fcx-titulo{font-size:12px;color:#6b7787;text-transform:uppercase;letter-spacing:.6px;margin-bottom:8px;font-weight:700;}'+
'.fcx-card{cursor:pointer;}'+
'.fcx-card .l{margin-top:0;margin-bottom:7px;}'+
'.fcx-sub{font-size:12.5px;color:#6b7787;margin-top:4px;}'+
'.fcx-rod{font-size:11.5px;color:#8a97a8;margin-top:10px;}'+
'.fcx-selo{display:inline-block;font-size:11px;font-weight:700;padding:3px 9px;border-radius:6px;margin-top:6px;}'+
'.fcx-ok{background:#eaf5ee;color:#157a35;}'+
'.fcx-bad{background:#fdecec;color:#c0392b;}'+
'.fcx-est{background:#eef2f7;color:#6b7787;}'+
'.fcx-alerta{margin-top:9px;font-size:12.5px;color:#9a6a00;font-weight:700;}'+
'.fcx-clique{font-size:11px;color:#a9b4c0;margin-top:10px;}'+
'.fcx-painel{background:#ffffff;border-radius:12px;padding:16px 18px;box-shadow:0 1px 4px rgba(0,0,0,.07);margin-top:10px;}'+
'.fcx-ph{font-size:13.5px;font-weight:700;color:#1d2733;margin-bottom:12px;}'+
'.fcx-ph span{display:block;font-size:11.5px;font-weight:500;color:#8a97a8;margin-top:2px;}'+
'.fcx-ph2{font-size:12px;font-weight:700;color:#6b7787;margin:16px 0 8px;text-transform:uppercase;letter-spacing:.4px;}'+
'.fcx-barra{display:flex;height:8px;border-radius:4px;overflow:hidden;margin-bottom:12px;}'+
'.fcx-barra i{display:block;}'+
'.fcx-tab{width:100%;border-collapse:collapse;font-size:13px;}'+
'.fcx-tab th{text-align:left;font-size:11px;color:#8a97a8;text-transform:uppercase;letter-spacing:.4px;padding:0 0 6px;font-weight:700;}'+
'.fcx-tab th.r,.fcx-tab td.r{text-align:right;}'+
'.fcx-tab td.r{white-space:nowrap;}'+
'.fcx-tab td{padding:8px 0;border-top:1px solid #eef1f5;color:#1d2733;}'+
'.fcx-lin{cursor:pointer;}'+
'.fcx-lin:hover td{background:#f7f9fb;}'+
'.fcx-zero td{color:#a9b4c0;}'+
'.fcx-forte td{font-weight:700;}'+
'.fcx-bolinha{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:8px;}'+
'.fcx-concilia{font-size:12px;color:#157a35;margin-top:10px;padding-top:9px;border-top:1px solid #e3e8ee;}'+
'.fcx-oc{padding:9px 0;border-top:1px solid #eef1f5;}'+
'.fcx-oc1{display:flex;justify-content:space-between;gap:10px;font-size:13px;color:#1d2733;}'+
'.fcx-oc1 b{white-space:nowrap;}'+
'.fcx-oc2{font-size:11.5px;color:#8a97a8;margin-top:3px;}'+
'.fcx-al{border-left:3px solid #9a6a00;background:#fdf3d9;padding:10px 12px;margin-bottom:8px;}'+
'.fcx-al1{font-size:13px;font-weight:700;color:#9a6a00;}'+
'.fcx-al1 span{font-weight:500;}'+
'.fcx-al2{font-size:12px;color:#9a6a00;margin-top:4px;}'+
'.fcx-al3{font-size:11.5px;color:#9a6a00;margin-top:5px;font-weight:700;}'+
'.fcx-vazio{font-size:12.5px;color:#8a97a8;padding:10px 0;font-style:italic;}'+
'@media(max-width:760px){.fcx-oc1{flex-direction:column;gap:2px;}.fcx-tab{font-size:12px;}.fcx-tab th{font-size:10px;}.fcx-tab td,.fcx-tab th{padding-left:4px;}}'+
/* SO NA PREVIA: o build gera isto sozinho varrendo o <style>. Aqui o CSS entra em tempo
   de execucao, entao escrevo as gemeas na mao, com os MESMOS destinos da paleta do build. */
'html.tema-escuro .fcx-titulo{color:#aab2bf;}'+
'html.tema-escuro .fcx-sub{color:#aab2bf;}'+
'html.tema-escuro .fcx-rod{color:#8f98a5;}'+
'html.tema-escuro .fcx-ok{background:#16281c;color:#3fbd6c;}'+
'html.tema-escuro .fcx-bad{background:#2b1d1e;color:#e0776b;}'+
'html.tema-escuro .fcx-est{background:#0f1115;color:#aab2bf;}'+
'html.tema-escuro .fcx-alerta{color:#d9ae56;}'+
'html.tema-escuro .fcx-clique{color:#7b8492;}'+
'html.tema-escuro .fcx-painel{background:#1c212a;}'+
'html.tema-escuro .fcx-ph{color:#f3f4f6;}'+
'html.tema-escuro .fcx-ph span{color:#8f98a5;}'+
'html.tema-escuro .fcx-ph2{color:#aab2bf;}'+
'html.tema-escuro .fcx-tab th{color:#8f98a5;}'+
'html.tema-escuro .fcx-tab td{border-top-color:#2d3643;color:#f3f4f6;}'+
'html.tema-escuro .fcx-lin:hover td{background:#161a21;}'+
'html.tema-escuro .fcx-zero td{color:#7b8492;}'+
'html.tema-escuro .fcx-concilia{color:#3fbd6c;border-top-color:#2d3643;}'+
'html.tema-escuro .fcx-oc{border-top-color:#2d3643;}'+
'html.tema-escuro .fcx-oc1{color:#f3f4f6;}'+
'html.tema-escuro .fcx-oc2{color:#8f98a5;}'+
'html.tema-escuro .fcx-al{background:#2a2418;border-left-color:#d9ae56;}'+
'html.tema-escuro .fcx-al1,html.tema-escuro .fcx-al2,html.tema-escuro .fcx-al3{color:#d9ae56;}'+
'html.tema-escuro .fcx-vazio{color:#8f98a5;}'+
'</style>';

var _t=0;
function entrar(){
  _t++;
  var b=document.querySelector('[data-page="analise"]');
  if(!b || typeof DIA==="undefined"){ if(_t<60) return setTimeout(entrar,150); return; }
  window.__PERFIL={ id:"11111111-1111-1111-1111-111111111111", is_master:true, paginas:["analise"] };
  window.__EMAIL="previa@santarita";
  try{ var ov=document.getElementById("authOv"); if(ov&&ov.parentNode) ov.parentNode.removeChild(ov); }catch(e){}
  try{ document.body.style.overflow=""; }catch(e){}
  try{ if(window.__navmocss&&window.__navmocss.parentNode) window.__navmocss.parentNode.removeChild(window.__navmocss); }catch(e){}
  try{ if(window.__pgcss&&window.__pgcss.parentNode) window.__pgcss.parentNode.removeChild(window.__pgcss); }catch(e){}
  document.querySelectorAll(".nav-item").forEach(function(x){ x.style.display="flex"; x.classList.remove("nav-locked"); });
  b.click();
  setTimeout(function(){
    try{
      document.head.insertAdjacentHTML("beforeend",CSS);
      var ind=document.getElementById("anIndicadores");
      ind.insertAdjacentHTML("afterend",'<div id="fcxBloco"></div>');
      document.getElementById("anDe").value="2026-09-01";
      document.getElementById("anAte").value="2026-09-20";
      if(typeof renderAnalise==="function") renderAnalise();
      montar();
      document.addEventListener("click",function(e){
        var lin=e.target.closest? e.target.closest(".fcx-lin") : null;
        if(lin){ document.getElementById("fcxOco").innerHTML=listaOco(lin.getAttribute("data-g")); }
      });
      var ap=document.getElementById("anAplicar");
      if(ap) ap.addEventListener("click",function(){ setTimeout(montar,60); });
      var lp=document.getElementById("anLimpar");
      if(lp) lp.addEventListener("click",function(){ setTimeout(montar,60); });
    }catch(e){ document.body.insertAdjacentHTML("afterbegin","<pre style='padding:20px;color:#c00'>"+e.message+"\\n"+e.stack+"</pre>"); }
  },200);
}
entrar();
})();
</script>`;

const fim = h.lastIndexOf("</body>");
h = h.slice(0, fim) + STUB + h.slice(fim);
h = h.replace("<title>", "<title>RASCUNHO FRENTE DE CAIXA · ");
h = h.replace("</head>", "<style>*,*::before,*::after{animation:none!important;transition:none!important}</style></head>");
fs.mkdirSync(path.dirname(SAIDA), { recursive: true });
fs.writeFileSync(SAIDA, h);
console.log("OK -> " + SAIDA);
console.log("   dias: " + DADOS.FCX_DIA.length + " | cancelamentos: " + DADOS.FCX_OCO.length + " | descontos: " + DADOS.FCX_DSC.length);
