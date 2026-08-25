// PREVIA VIVA DA CENTRAL DE APROVACAO.
//
// Nao e um desenho: monta uma pagina com o CSS INTEIRO do painel, as funcoes REAIS
// (clApLinha, clApFiltra, clApDesenhaLinhas, clApDetalhe...) e um clPedidos de mentira,
// para que busca, filtro, ordenacao e gaveta funcionem de verdade no navegador.
// Assim da para clicar e medir, em vez de olhar e achar.
//
//   QTD=30 node scripts/previa-aprovacao.cjs     -> .previa/previa-aprovacao.html
const fs = require("fs");
const path = require("path");
const RAIZ = path.join(__dirname, "..");
const H = fs.readFileSync(path.join(RAIZ, "output", "index.html"), "utf8");

const semScript = H.replace(/<script[\s\S]*?<\/script>/gi, "");
const ESTILOS = (semScript.match(/<style[^>]*>[\s\S]*?<\/style>/g) || []).join("\n");
const globalFonte = /(^|[};>])\s*(\*|body)\s*\{[^{}]*font-family\s*:\s*(?!\s*(system-ui|inherit))/i;
if (!ESTILOS || globalFonte.test(ESTILOS.replace(/\/\*[\s\S]*?\*\//g, ""))) {
  console.log("ERRO: estilo da previa nao confere"); process.exit(1);
}

function pegaFn(nome) {
  const i = H.indexOf("function " + nome + "(");
  if (i < 0) { console.log("ERRO: nao achei " + nome); process.exit(1); }
  let n = 0;
  for (let k = H.indexOf("{", i); k < H.length; k++) {
    if (H[k] === "{") n++; else if (H[k] === "}") { n--; if (!n) return H.slice(i, k + 1); }
  }
}
const FUNCOES = ["clApIco","clApCascoHtml","clApCabecalho","clApFaixa","clApFiltra",
  "clApDesenhaLinhas","clApQuando","clApLinha","clApLinhaDet","clApDetalhe","clApFecharDet",
  "clApRedesenha","clApSincronizaBusca","clCnpjFmt","clFoneFmt","clPlacaFmt","clDataISO",
  "clHoraCurta","clDataLonga","clTranspSelo","clNum","pxEsc","frnCnpjFmt","clPodeDecidir",
  "clPad","frnCnpjLimpo"]
  .map(pegaFn).join("\n");

// As tabelas de mes e dia da semana sao "var", nao funcao — pegaFn nao as enxerga.
// Sem elas a linha nao desenha, e o erro so aparece no console: por isso a previa
// PARA aqui em vez de gerar uma pagina que abre pela metade.
const CONSTS = ["CL_AP_MES", "CL_AP_DOW"].map((n) => {
  const m = H.match(new RegExp("var " + n + "=\\[[^\\]]*\\];"));
  if (!m) { console.log("ERRO: nao achei a tabela " + n); process.exit(1); }
  return m[0];
}).join("\n");

const QTD = +(process.env.QTD || 30);
const NOMES = ["G J dos Santos e Filhos Ltda","Distribuidora Nordeste Alimentos Ltda",
  "Atacado Seridó Distribuição S/A","Comercial Caicó Bebidas Eireli",
  "Laticínios Serra Verde Ltda","Frigorífico Potiguar S/A","Panificadora Trigo de Ouro Ltda",
  "Higiene & Limpeza do Vale Ltda","Hortifruti Boa Safra Eireli","Massas Rio Grande Ltda"];
const VEIC = ["Van / Furgão","Truck","Carreta","Utilitário","Bitrem"];
const CARGA = ["Seca","Refrigerada","Congelada"];
const VOLT = ["Paletizada","Batida"];

// datas espalhadas de propósito: atrasados, hoje, amanhã e depois — para os quatro
// filtros terem sobre o que operar sem inventar campo nenhum
function iso(d){ const x=new Date(Date.now()+d*86400000);
  return x.getFullYear()+"-"+String(x.getMonth()+1).padStart(2,"0")+"-"+String(x.getDate()).padStart(2,"0"); }

const PED = [], DET = {}, NTS = {};
for (let i = 0; i < QTD; i++) {
  const id = "p" + i, ag = "a" + i;
  const desloc = [-3,-1,0,0,0,1,1,2,3,4][i % 10];
  PED.push({ id, status:"pendente", fornecedor: NOMES[i % NOMES.length],
    documento: String(20947638000141 + i * 7), contato: "849912774" + String(10 + i % 90),
    data: iso(desloc), hora: String(7 + (i % 11)).padStart(2,"0") + ":" + (i % 2 ? "30" : "00"),
    pedido: String(23100 + i), transportadora_cnpj: i % 5 === 0 ? "11444777000161" : null,
    descricao: i % 7 === 0 ? "Entregar pela lateral, portão do depósito" : null });
  DET[id] = { id: ag, origem_id: id, ticket: "AG-2608-" + String(1000 + i).slice(1),
    tipo_carga: CARGA[i % 3], tipo_volume: VOLT[i % 2], qtd_volumes: 6 + i * 13,
    peso_kg: 88.4 + i * 61.3, tipo_veiculo: VEIC[i % 5],
    placa: i % 6 === 0 ? "FDSDFGHJ" : (i % 2 ? "ABC" + (1000 + i) : "RTA2C1" + (i % 10)),
    motorista: ["victor","José Ferreira","Marcos Lima","Ana Paula","Cícero Neto"][i % 5],
    motorista_fone: "8499400" + String(1000 + i).slice(1),
    minutos_estimados: [60,90,30,120][i % 4], descricao: null,
    cobranca_total: i % 9 === 0 ? 23 : 0 };
  NTS[ag] = [{ agenda_id: ag, numero: String(9000 + i), serie: "1",
    valor_total: 1200 + i * 340, volumes: 6 + i * 13, especie: "CX",
    peso_bruto: 88.4 + i * 61.3, emitente_nome: NOMES[i % NOMES.length],
    itens: Array.from({ length: 3 + (i % 14) }, (_, k) => ({
      descricao: "Produto exemplo " + (k + 1), codigo: "COD" + k, qtd: k + 1,
      unidade: "UN", valor: 10 + k })) }];
}

const saida = path.join(RAIZ, ".previa", "previa-aprovacao.html");
fs.mkdirSync(path.dirname(saida), { recursive: true });
fs.writeFileSync(saida, `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Prévia — central de aprovação</title>${ESTILOS}</head>
<body style="margin:0;background:#f4f7f6;padding:18px">
<div id="page-central"><div id="clPedidos"></div></div>
<div class="cl-pd-bg" id="clPdBg"><aside class="cl-pd" id="clPd" role="dialog" aria-modal="true">
  <div class="cl-pd-top"><div><h3 id="clPdTit">Detalhes</h3><p class="sub" id="clPdSub"></p></div>
  <button type="button" class="cl-pd-x" id="clPdX" aria-label="Fechar">&times;</button></div>
  <div class="cl-pd-corpo" id="clPdCorpo"></div><div class="cl-pd-pe" id="clPdPe"></div>
</aside></div>
<script>
var clPedidos=${JSON.stringify(PED)}, clDetalhe=${JSON.stringify(DET)}, clNotas=${JSON.stringify(NTS)};
var clApBusca="", clApFiltro="todos";
function podePagina(){ return true; }
window.__PERFIL={is_master:true};
${CONSTS}
${FUNCOES}
function clVerNotas(id){ window.__ultimaNota=id; alert("modal de notas: "+id); }
function clDecidir(id,st){ window.__ultimaDecisao=id+":"+st; alert("decidir "+id+" -> "+st); }
var box=document.getElementById("clPedidos");
box.innerHTML=clApCascoHtml();
clApRedesenha();
box.addEventListener("click",function(e){
  var s=e.target.closest("[data-psim]"); if(s){ clDecidir(s.getAttribute("data-psim"),"aprovado"); return; }
  var n=e.target.closest("[data-pnao]"); if(n){ clDecidir(n.getAttribute("data-pnao"),"recusado"); return; }
  var nf=e.target.closest("[data-clnf]"); if(nf){ clVerNotas(nf.getAttribute("data-clnf")); return; }
  var fb=e.target.closest("[data-apfil]"); if(fb){ clApFiltro=fb.getAttribute("data-apfil"); clApRedesenha(); return; }
  var zr=e.target.closest("#clApZerar"); if(zr){ clApFiltro="todos"; clApBusca=""; clApSincronizaBusca(); clApRedesenha(); return; }
  var lp=e.target.closest("#clApLimpa"); if(lp){ clApBusca=""; clApSincronizaBusca(); clApRedesenha(); return; }
  var dt=e.target.closest("[data-apdet]"); if(dt){ clApDetalhe(dt.getAttribute("data-apdet")); return; }
});
box.addEventListener("input",function(e){
  var i=e.target.closest("#clApBusca"); if(!i) return;
  clApBusca=i.value||"";
  var lp=document.getElementById("clApLimpa"); if(lp) lp.style.display=clApBusca?"":"none";
  clApRedesenha();
});
var pdbg=document.getElementById("clPdBg");
pdbg.addEventListener("click",function(e){
  if(e.target===pdbg||e.target.closest("#clPdX")){ clApFecharDet(); return; }
  var nf=e.target.closest("[data-clnf]"); if(nf){ clVerNotas(nf.getAttribute("data-clnf")); return; }
  var s=e.target.closest("[data-psim]"); if(s){ var i1=s.getAttribute("data-psim"); clApFecharDet(); clDecidir(i1,"aprovado"); return; }
  var n=e.target.closest("[data-pnao]"); if(n){ var i2=n.getAttribute("data-pnao"); clApFecharDet(); clDecidir(i2,"recusado"); return; }
});
/* BANCADA DE MEDIDA. A pagina se mede sozinha e escreve o resultado no DOM, para o
   Chrome headless poder ler com --dump-dom. Medir pelo console de uma aba de fundo
   devolveu innerWidth 0 e numeros sem sentido — medida que nao se sustenta nao vale
   como prova. */
(function(){
  var l=document.getElementById("clApLista");
  var hs=[].map.call(l.children,function(c){ return Math.round(c.getBoundingClientRect().height); });
  var ord=hs.slice().sort(function(a,b){ return a-b; });
  var doc=document.documentElement;
  var m={
    largura:window.innerWidth, linhas:hs.length,
    min:ord[0]||0, mediana:ord[Math.floor(ord.length/2)]||0, max:ord[ord.length-1]||0,
    acima140:ord.filter(function(h){return h>140;}).length,
    abaixo90:ord.filter(function(h){return h<90;}).length,
    listaRolaDentro:l.scrollHeight>l.clientHeight,
    paginaRolaLado:doc.scrollWidth>doc.clientWidth+1,
    colunas:getComputedStyle(l.children[0]).gridTemplateColumns,
    transpEstica:(function(){ var t=l.querySelector(".cl-ap-c > .cl-transp");
      if(!t) return "n/a";
      var c=t.parentElement.getBoundingClientRect(), r=t.getBoundingClientRect();
      return Math.round(r.width)+"/"+Math.round(c.width); })()
  };
  var pre=document.createElement("pre"); pre.id="medida"; pre.style.display="none";
  pre.textContent="MEDIDA="+JSON.stringify(m);
  document.body.appendChild(pre);
})();

/* PROVA DE COMPORTAMENTO. Clica de verdade: filtro, busca, gaveta e os dois botoes.
   Olhar a tela nao prova que o clique chama o handler certo — e o handler certo e a
   unica coisa que esta refatoracao NAO pode ter quebrado. */
(function(){
  var r={}, lista=document.getElementById("clApLista");
  function conta(){ return lista.querySelectorAll(".cl-ap-lin").length; }
  function clica(sel){ var e=document.querySelector(sel); if(e) e.click(); }

  r.todos=conta();
  clica('[data-apfil="atrasados"]');  r.filtroAtrasados=conta();
  r.soAtrasadas=[].every.call(lista.querySelectorAll(".cl-ap-lin"),
                              function(l){ return l.classList.contains("atrasado"); });
  r.botaoMarcado=!!document.querySelector('[data-apfil="atrasados"].on');
  r.atrasadoSemAprovar=!lista.querySelector(".cl-ap-lin.atrasado [data-psim]");
  clica('[data-apfil="hoje"]');       r.filtroHoje=conta();
  clica('[data-apfil="todos"]');      r.voltouTodos=conta();

  var inp=document.getElementById("clApBusca");
  inp.value="23104"; inp.dispatchEvent(new Event("input",{bubbles:true}));
  r.buscaPedido=conta();
  inp.value="seridó"; inp.dispatchEvent(new Event("input",{bubbles:true}));
  r.buscaNomeAcento=conta();
  inp.value="20.947.638"; inp.dispatchEvent(new Event("input",{bubbles:true}));
  r.buscaCnpjPontuado=conta();
  inp.value="zzzz"; inp.dispatchEvent(new Event("input",{bubbles:true}));
  r.buscaSemResultado=conta();
  r.explicaVazio=/Nenhum agendamento nesse recorte/.test(lista.textContent);
  clica("#clApZerar");                r.zerouEVoltou=conta();
  r.campoLimpou=(document.getElementById("clApBusca").value==="");

  // foco preservado: o casco nao pode ser refeito no meio da digitacao
  var i2=document.getElementById("clApBusca"); i2.focus();
  i2.value="dis"; i2.dispatchEvent(new Event("input",{bubbles:true}));
  r.focoFicou=(document.activeElement===document.getElementById("clApBusca"));
  r.cascoEhOmesmo=(i2===document.getElementById("clApBusca"));
  clica("#clApZerar");

  // gaveta
  clica("[data-apdet]");
  var bg=document.getElementById("clPdBg");
  r.gavetaAbriu=bg.classList.contains("show");
  var corpo=document.getElementById("clPdCorpo").textContent;
  r.gavetaTemCnpj=/CNPJ/.test(corpo);
  r.gavetaTemMotorista=/Motorista/.test(corpo);
  r.gavetaTemTelMotorista=/Telefone do motorista/.test(corpo);
  r.gavetaTemPeso=/Peso/.test(corpo);
  r.gavetaTemNota=/Nota /.test(corpo);
  r.gavetaTemPe=!!document.querySelector("#clPdPe [data-pnao]");
  document.getElementById("clPdX").click();
  r.gavetaFechou=!bg.classList.contains("show");

  // os handlers de verdade
  window.__ultimaDecisao=""; window.__ultimaNota="";
  var old=window.alert; window.alert=function(){};
  var sim=lista.querySelector("[data-psim]"); if(sim) sim.click();
  r.aprovarChamou=/:aprovado$/.test(window.__ultimaDecisao||"");
  var nao=lista.querySelector("[data-pnao]"); if(nao) nao.click();
  r.recusarChamou=/:recusado$/.test(window.__ultimaDecisao||"");
  var nf=lista.querySelector("[data-clnf]"); if(nf) nf.click();
  r.notasChamou=!!window.__ultimaNota;
  window.alert=old;

  /* A prova deixa a tela como achou: sem isto a foto sai com o filtro da ultima
     assercao ligado, e eu acabaria mostrando um estado de teste como se fosse o normal. */
  clApFiltro="todos"; clApBusca="";
  var iz=document.getElementById("clApBusca"); if(iz) iz.value="";
  var lz=document.getElementById("clApLimpa"); if(lz) lz.style.display="none";
  clApRedesenha();
  r.terminouLimpo=(conta()===r.todos && document.getElementById("clApBusca").value==="");

  var pre2=document.createElement("pre"); pre2.id="prova"; pre2.style.display="none";
  pre2.textContent="PROVA="+JSON.stringify(r);
  document.body.appendChild(pre2);
})();
${process.env.FILTRO ? 'clApFiltro=' + JSON.stringify(process.env.FILTRO) + '; clApRedesenha();' : ''}
${process.env.ABRIR ? 'setTimeout(function(){ clApDetalhe(clPedidos[0].id); },10);' : ''}
<\/script></body></html>`);
console.log("OK -> " + path.relative(RAIZ, saida) + "  (" + QTD + " solicitações, funções reais do painel)");
