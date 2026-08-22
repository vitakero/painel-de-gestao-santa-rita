// Gera a FOLHA DE IMPRESSÃO do cartaz como um arquivo, para poder olhar o que a impressora vê.
//
// A prévia normal mostra a TELA. Só que o cartaz quebrou no PAPEL, e papel é outra coisa:
// o Chrome pagina, corta e escolhe a caixa da página. Sem gerar o papel de verdade eu fico
// adivinhando — foi o que aconteceu na primeira tentativa de consertar.
//
// Pega o painel de verdade (output/index.html), manda ele montar a folha exatamente como
// monta quando alguém aperta Imprimir, e troca a página inteira por essa folha. Aí o Chrome
// sem tela imprime isso num PDF, e o PDF é a prova.
//
//   node scripts/previa-impressao.cjs                     -> A5, 5 cartazes
//   TAMANHO=A6 QTD=8 node scripts/previa-impressao.cjs
// Isto NUNCA vai pro ar.
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(process.env.HOME, "vr-looker-integration");
const SAIDA = path.join(RAIZ, ".previa", "impressao.html");

const TAMANHO = (process.env.TAMANHO || "A5").replace(/[^A-Za-z0-9]/g, "");
const QTD = Math.max(1, +(process.env.QTD || 5) || 5);
const MODELO = (process.env.MODELO || "padrao").replace(/[^a-z]/g, "");
const SEMARTE = process.env.SEMARTE === "1";
// SEMFIT=1 tira a trava anti-estouro (o fit() que escreve style.zoom), para saber se é ela.
const SEMFIT = process.env.SEMFIT === "1";
// PATCH="<css>" gruda um CSS no fim do <head> da folha, para testar conserto sem mexer no painel.
const PATCH = process.env.PATCH || "";
const NOME = process.env.NOME || "ARROZ";
const MARCA = process.env.MARCA === undefined ? "CAMIL" : process.env.MARCA;

let h = fs.readFileSync(path.join(RAIZ, "output", "index.html"), "utf8");

const arte = SEMARTE ? "" :
  "data:image/jpeg;base64," + fs.readFileSync(path.join(RAIZ, "assets", "cartaz-final-de-semana.jpg")).toString("base64");

const STUB = `<script>
(function(){
  window.__PERFIL = { id:"11111111-1111-1111-1111-111111111111", is_master:true, paginas:["cartaz"] };
  window.__EMAIL  = "previa@santarita";
  var ARTE = ${JSON.stringify(arte)};
  var pronto = false, tentativas = 0;
  function vai(){
    tentativas++;
    if(typeof window.czImprimir !== "function"){
      if(tentativas < 200) return setTimeout(vai, 50);
      document.title = "ERRO: czImprimir nao apareceu";
      return;
    }
    if(pronto) return; pronto = true;
    var pego = null;
    var abrir = window.open;
    window.open = function(){
      return { document:{ write:function(x){ pego = String(x); }, close:function(){}, title:"" },
               focus:function(){}, print:function(){}, close:function(){} };
    };
    try{
      window.czTema = ARTE ? { n:"oficial", d:ARTE } : null;
      window.czTamanho = ${JSON.stringify(TAMANHO)};
      window.czModelo = ${JSON.stringify(MODELO)};
      window.czImpressao = "multi";
      window.czProdutos = [];
      for(var i=0;i<${QTD};i++){
        window.czProdutos.push({ oferta:"OFERTA", nome:${JSON.stringify(NOME)}, marca:${JSON.stringify(MARCA)}, tipo:"TIPO 1",
          gram:"5KG", preco:"29,99", preco_de:"", qtd:1, limite:0,
          vIni:"2026-08-22", vFim:"2026-08-22" });
      }
      window.czImprimir();
    }catch(e){ document.title = "ERRO: " + e.message; window.open = abrir; return; }
    window.open = abrir;
    if(!pego){ document.title = "ERRO: nao capturei a folha"; return; }
    // tiro o window.print() para o Chrome sem tela nao travar num dialogo
    pego = pego.replace(/window\\.print\\(\\);/g, "window.__jaImprimiria=1;");
    if(${SEMFIT ? "true" : "false"}) pego = pego.replace(/try\\{fit\\(\\);\\}catch\\(e\\)\\{\\}/g, "");
    var PATCH = ${JSON.stringify(PATCH)};
    if(PATCH) pego = pego.replace("</head>", "<style>" + PATCH + "</style></head>");
    document.open(); document.write(pego); document.close();
  }
  if(document.readyState === "complete") vai(); else window.addEventListener("load", vai);
})();
</script>`;

const marca = "</body>";
const corte = h.lastIndexOf(marca);
if (corte < 0) { console.log("ERRO: nao achei </body> no painel"); process.exit(1); }
h = h.slice(0, corte) + STUB + h.slice(corte);

fs.mkdirSync(path.dirname(SAIDA), { recursive: true });
fs.writeFileSync(SAIDA, h);
console.log((SEMFIT ? "[SEM FIT] " : "") + "FOLHA -> " + SAIDA + "  (" + Math.round(h.length / 1024) + " KB)  tamanho=" + TAMANHO + " qtd=" + QTD + (SEMARTE ? " SEM ARTE" : " com a arte oficial"));
