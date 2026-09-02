// Gera a FOLHA DE IMPRESSÃO DO LOTE do histórico — várias placas marcadas de uma vez.
//
// Por que não dá pra reaproveitar a previa-impressao.cjs: aquela monta a lista na mão e
// chama o czImprimir direto. O lote passa por um caminho diferente e mais perigoso — o
// czHistImprimirLote, que separa em tandas, e o czLoteItens, que prende em CADA placa a
// validade, o limite e a arte DELA. É justamente esse pedaço que precisa de prova no papel:
// se ele falhar, sai uma tanda inteira de placas com a data errada colada na gôndola, e
// olhando a tela ninguém percebe.
//
// Aqui as três placas são de PROPÓSITO diferentes umas das outras (datas, limites e
// cabeçalho), pra dar pra ver no PDF que cada uma manteve o que era dela.
//
//   node scripts/previa-lote.cjs                  -> 3 placas A4
//   TAMANHO=A5 node scripts/previa-lote.cjs
// Isto NUNCA vai pro ar.
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(process.env.HOME, "vr-looker-integration");
const SAIDA = path.join(RAIZ, ".previa", "lote.html");
const TAMANHO = (process.env.TAMANHO || "A4").replace(/[^A-Za-z0-9]/g, "");

let h = fs.readFileSync(path.join(RAIZ, "output", "index.html"), "utf8");

const STUB = `<script>
(function(){
  window.__PERFIL = { id:"11111111-1111-1111-1111-111111111111", is_master:true, paginas:["cartaz"] };
  window.__EMAIL  = "previa@santarita";
  var TAM = ${JSON.stringify(TAMANHO)};
  var pronto = false, tentativas = 0;
  function vai(){
    tentativas++;
    if(typeof window.czHistImprimirLote !== "function"){
      if(tentativas < 200) return setTimeout(vai, 50);
      document.title = "ERRO: czHistImprimirLote nao apareceu";
      return;
    }
    if(pronto) return; pronto = true;

    function reg(id, nome, ini, fim, limite, tema){
      return { id:id, modelo:"padrao", tamanho:TAM, impressao:"multi", oferta:"OFERTA",
               nome:nome, marca:"CAMIL", tipo:"", gramatura:"5KG", preco:"29,99", preco_de:"",
               validade_ini:ini, validade_fim:fim, limite_cliente:limite, tema_nome:tema };
    }
    // TRES PLACAS DIFERENTES entre si em tudo que o lote precisa preservar.
    window.czHist = [
      reg("a", "ARROZ",  "2026-09-01", "2026-09-08", 2, "Final de semana de ofertas"),
      reg("b", "FEIJAO", "2026-08-31", "2026-09-06", 0, null),
      reg("c", "OLEO",   "2026-09-02", "2026-09-18", 5, "Final de semana de ofertas"),
    ];
    window.czHistSel = { a:true, b:true, c:true };

    // As tres perguntas (papel diferente / arte sumida / confirmar) respondem SIM sozinhas.
    window.uiConfirm = function(){ return Promise.resolve(true); };

    var pego = null;
    var abrir = window.open;
    window.open = function(){
      return { document:{ write:function(x){ pego = String(x); }, close:function(){}, title:"" },
               focus:function(){}, print:function(){}, close:function(){} };
    };
    try{ window.czHistImprimirLote(); }
    catch(e){ document.title = "ERRO: " + e.message; window.open = abrir; return; }

    var esperas = 0;
    (function espera(){
      if(!pego){
        if(++esperas > 200){ window.open = abrir; document.title = "ERRO: nao capturei a folha"; return; }
        return setTimeout(espera, 25);
      }
      window.open = abrir;
      // tiro o window.print() para o Chrome sem tela nao travar num dialogo
      pego = pego.replace(/window\\.print\\(\\);/g, "window.__jaImprimiria=1;");
      document.open(); document.write(pego); document.close();
    })();
  }
  if(document.readyState === "complete") vai(); else window.addEventListener("load", vai);
})();
</script>`;

const corte = h.lastIndexOf("</body>");
if (corte < 0) { console.log("ERRO: nao achei </body> no painel"); process.exit(1); }
h = h.slice(0, corte) + STUB + h.slice(corte);

fs.mkdirSync(path.dirname(SAIDA), { recursive: true });
fs.writeFileSync(SAIDA, h);
console.log("FOLHA DO LOTE -> " + SAIDA + "  (" + Math.round(h.length / 1024) + " KB)  tamanho=" + TAMANHO + ", 3 placas");
