// Gera a TELA do histórico de cartazes com uma lista de exemplo, pra olhar o desenho.
//
// O painel de verdade só mostra o histórico depois de entrar e de ter cartaz impresso na
// nuvem. Aqui eu entro no lugar da pessoa, ponho uma lista parecida com a da loja e paro
// a página em cima do bloco — é o que vira a foto que eu mando pro dono antes de publicar.
//
//   node scripts/previa-historico.cjs            -> nada marcado
//   MARCADAS=2,3,5 node scripts/previa-historico.cjs
// Isto NUNCA vai pro ar.
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(process.env.HOME, "vr-looker-integration");
const SAIDA = path.join(RAIZ, ".previa", "historico.html");
const MARCADAS = (process.env.MARCADAS || "").split(",").map(s => s.trim()).filter(Boolean);

let h = fs.readFileSync(path.join(RAIZ, "output", "index.html"), "utf8");

const STUB = `<script>
(function(){
  window.__PERFIL = { id:"11111111-1111-1111-1111-111111111111", is_master:true, paginas:["cartaz"] };
  window.__EMAIL  = "previa@santarita";
  var MARC = ${JSON.stringify(MARCADAS)};
  var tentativas = 0;
  function vai(){
    if(typeof window.renderCartaz !== "function" || !document.querySelector('.nav-item[data-page="cartaz"]')){
      if(++tentativas < 200) return setTimeout(vai, 50);
      document.title = "ERRO: a pagina do cartaz nao apareceu"; return;
    }
    var ov = document.getElementById("authOv"); if(ov) ov.style.display = "none";
    document.querySelector('.nav-item[data-page="cartaz"]').click();

    function r(id,nome,marca,tipo,gram,preco,de,ini,fim){
      return { id:id, modelo:de?"depor":"padrao", tamanho:"A4", impressao:"multi", oferta:"OFERTA",
               nome:nome, marca:marca||"", tipo:tipo||"", gramatura:gram||"", preco:preco, preco_de:de||"",
               validade_ini:ini, validade_fim:fim, limite_cliente:0,
               tema_nome:"Final de semana de ofertas" };
    }
    window.czHist = [
      r("1","SANDÁLIA","HAVAIANA","BRASIL","tamanhos","41,99","52,99","2026-08-31","2026-09-06"),
      r("2","REQUEIJÃO","NESTLÉ","CREMOSO LIGHT","200G","8,99","","2026-09-01","2026-09-08"),
      r("3","IOGURTE","NINHO","polpa","90G","0,99","","2026-09-01","2026-09-08"),
      r("4","BATATA PALHA","REI OURO","TRADICIONAL","80g","3,89","","2026-09-01","2026-09-18"),
      r("5","ÓLEO","SINHÁ","CANOLA","900ML","16,59","","2026-09-01","2026-09-18"),
      r("6","LASANHA","AURORA","PRESUNTO QUEIJO","600G","12,99","","2026-08-31","2026-09-06"),
      r("7","REFRIGERANTE","FANTA","LARANJA LT","220ml","0,99","","2026-08-31","2026-09-06")
    ];
    /* O painel tenta carregar o historico da nuvem sozinho e, sem nuvem, zera a lista —
       ele venceria a minha injecao. Por isso eu reponho a lista algumas vezes, ate o
       painel parar de mexer. */
    var LISTA = window.czHist, voltas = 0;
    (function repoe(){
      window.czHist = LISTA;
      window.czHistSel = {};
      for(var i=0;i<MARC.length;i++) window.czHistSel[MARC[i]] = true;
      window.renderCartaz();
      if(++voltas < 14) return setTimeout(repoe, 200);
      document.title = "historico pronto";
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
console.log("TELA DO HISTORICO -> " + SAIDA + "  marcadas: " + (MARCADAS.join(",") || "nenhuma"));
