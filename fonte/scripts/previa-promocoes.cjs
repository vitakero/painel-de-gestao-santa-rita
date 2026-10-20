// Monta o ENSAIO das "promoções no mesmo lote" em cima do painel de verdade.
//
// POR QUE EXISTE (19/10/2026): a funcionária das placas pediu para imprimir várias
// promoções de uma vez — cada uma com o cabeçalho e a validade dela — em vez de uma rodada
// por promoção, que desperdiça o resto da folha. O dono quer EXPERIMENTAR antes de decidir.
//
// Pega output/index.html, tira o login e a nuvem, e injeta o código do ensaio. O desenho e a
// IMPRESSÃO são os do painel publicado — é isso que faz a prova valer: o que sair na
// impressora aqui é o que sairia na loja.
//
// O código do ensaio mora em .previa/cartaz-promocoes/codigo/ e NÃO vai pro GitHub público
// enquanto não for aprovado.
//
//   node scripts/previa-promocoes.cjs          -> versão A (blocos de promoção)
//   VERSAO=b node scripts/previa-promocoes.cjs -> versão B (coluna na tabela)
// Isto NUNCA vai pro ar.
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(process.env.HOME, "vr-looker-integration");
const BASE = path.join(RAIZ, ".previa", "cartaz-promocoes");
/* VERSAO=painel: o painel DE VERDADE (output/index.html) só com o dublê de login — sem injetar
   ensaio nenhum. É como os testes rodam DEPOIS que a versão A entrou no código: o que eles provam
   tem que ser o que vai pro ar, não a prévia. */
const VERSAO = ((process.env.VERSAO || "a").toLowerCase().match(/^(a|b|painel)$/) || ["a"])[0];
const SAIDA = path.join(BASE, VERSAO + ".html");

const PAINEL = (VERSAO === "painel");
const jsPath = path.join(BASE, "codigo", "promocoes-" + VERSAO + ".js");
if (!PAINEL && !fs.existsSync(jsPath)) { console.log("ERRO: não achei " + jsPath); process.exit(1); }
const CODIGO = PAINEL ? "" : fs.readFileSync(jsPath, "utf8");
const ESTILO = PAINEL ? "" : fs.readFileSync(path.join(BASE, "codigo", "estilo.css"), "utf8");

let h = fs.readFileSync(path.join(RAIZ, "output", "index.html"), "utf8");

/* Dois cabeçalhos de mentira, desenhados na hora, para ele ter o que escolher sem depender
   do que está guardado no navegador dele. Proporção 20:7, a mesma que a trava do envio exige. */
const ARTES = `
  function arteFalsa(nome, c1, c2){
    var c = document.createElement("canvas"); c.width = 2100; c.height = 735;
    var x = c.getContext("2d");
    var g = x.createLinearGradient(0, 0, 2100, 735);
    g.addColorStop(0, c1); g.addColorStop(1, c2);
    x.fillStyle = g; x.fillRect(0, 0, 2100, 735);
    x.fillStyle = "#fff"; x.textAlign = "center"; x.textBaseline = "middle";
    /* o nome encolhe até caber: com tamanho fixo, "SÁBADO BOMBÁSTICO" saía cortado nas pontas
       e a arte de TESTE parecia defeito do ensaio */
    var tam = 200; x.font = "bold " + tam + "px Arial";
    while (x.measureText(nome).width > 1900 && tam > 60){ tam -= 8; x.font = "bold " + tam + "px Arial"; }
    x.fillText(nome, 1050, 390);
    x.font = "bold 70px Arial"; x.fillText("SUPERMERCADO SANTA RITA", 1050, 560);
    return { n: nome, d: c.toDataURL("image/jpeg", 0.8) };
  }
  /* VERSÃO DAS ARTES DE TESTE: se a prévia já foi aberta neste navegador, as artes antigas
     ficaram guardadas e um conserto nelas nunca apareceria. Trocar o número força a troca.
     Isto só alcança a prévia: ela roda em localhost, outro endereço que o do painel, e o
     navegador não deixa um enxergar o que o outro guardou. */
  try{
    if(localStorage.getItem("cz_ensaio_arte") !== "2"){ localStorage.removeItem("cz_temas"); localStorage.setItem("cz_ensaio_arte", "2"); }
    if(!localStorage.getItem("cz_temas")){
      localStorage.setItem("cz_temas", JSON.stringify([
        arteFalsa("HORA DA ECONOMIA", "#0f7a33", "#1aa04a"),
        arteFalsa("SÁBADO BOMBÁSTICO", "#b3261e", "#e04b3a"),
        arteFalsa("TERÇOU DE FRUTAS", "#1b6b2f", "#5bb04a")
      ]));
    }
  }catch(e){}
`;

const STUB = `<script>
(function(){
  window.__PERFIL = { id:"11111111-1111-1111-1111-111111111111", is_master:true, paginas:["cartaz"] };
  window.__EMAIL  = "previa@santarita";
  ${ARTES}
  // dublê da nuvem: encadeia como promessa de verdade (o painel faz .delete().lt().then().then())
  function resp(dados){
    var p = Promise.resolve({ data:dados, error:null }), api = {};
    ["order","eq","limit","select","in","gte","lte","gt","lt","is","delete","upsert","insert","update"]
      .forEach(function(m){ api[m] = function(){ return api; }; });
    api.then = function(a,b){ return p.then(a,b); };
    api.catch = function(f){ return p.catch(f); };
    return api;
  }
  window.__SB = { from: function(){ return {
      select:function(){ return resp([]); }, insert:function(){ return resp([]); },
      upsert:function(){ return resp([]); }, update:function(){ return resp([]); },
      delete:function(){ return resp([]); } }; },
    storage: { from: function(){ return {
      list:function(){ return Promise.resolve({data:[],error:null}); },
      upload:function(){ return Promise.resolve({data:{path:"x"},error:null}); },
      remove:function(){ return Promise.resolve({data:[],error:null}); },
      getPublicUrl:function(){ return { data:{ publicUrl:"" } }; } }; } } };

  var tentativas = 0;
  (function entrar(){
    var b = document.querySelector('[data-page="cartaz"]');
    if(!b){ if(++tentativas < 80) setTimeout(entrar, 150); return; }
    try{ var ov=document.getElementById("authOv"); if(ov && ov.parentNode) ov.parentNode.removeChild(ov); }catch(e){}
    try{ document.body.style.overflow=""; }catch(e){}
    try{ if(window.__navmocss && window.__navmocss.parentNode){ window.__navmocss.parentNode.removeChild(window.__navmocss); } }catch(e){}
    document.querySelectorAll(".nav-item").forEach(function(x){ x.style.display="flex"; x.classList.remove("nav-locked"); });
    b.click();
  })();
})();
</script>
<style>${ESTILO}</style>
<script>${CODIGO}</script>
<script>
/* ROTEIRO DA FOTO (?cena=N). Serve para o comparativo A x B sair sempre na MESMA cena —
   fotografar cada versão num estado diferente seria comparar coisas diferentes.
     cena=1  passo 1, igual ao painel de hoje
     cena=2  a tela nova, com duas promoções já preenchidas
     cena=3  a folha de impressão que sai dessas duas promoções
   BARRA DUPLA nas expressões abaixo é OBRIGATÓRIA: este trecho mora dentro de um texto entre
   crases do Node, que come uma barra. Com barra simples, "\d" chegava como "d" (a cena nunca
   era lida) e "window\.print\(\)" deixava de casar — a impressão disparava de verdade e o
   Chrome sem tela travava esperando um diálogo que ninguém fecha. */
(function(){
  var cena = +((location.search.match(/[?&]cena=(\\d+)/) || [])[1] || 0);
  if(!cena) return;
  var tentativas = 0;
  (function vai(){
    /* MODO PAINEL: a versão A já mora no painel; espera ela se instalar e preenche pela alça */
    if(window.__czPromos){
      if(!window.__czPromos.pronto){ if(++tentativas < 300) return setTimeout(vai, 60); document.title = "ERRO: a peça do painel nao se instalou"; return; }
      if(cena === 1){ document.title = "pronto"; return; }
      if(!vai.__esperou){ vai.__esperou = true; return setTimeout(vai, 900); }
      try{
        var api = window.__czPromos, arte = czTemasTodos();
        var acha = function(n){ for(var i=0;i<arte.length;i++) if((arte[i].n||"").indexOf(n)>=0) return arte[i]; return null; };
        api.promos.length = 0;
        var pa = api.nova(acha("HORA DA ECONOMIA"), false); pa.ini = "2026-10-20"; pa.fim = "2026-10-26";
        pa.linhas = czParseTexto("Arroz Camil Tipo 1 5KG 24,90\\nFeijao Kicaldo 1KG 7,49\\nOleo Sinha Canola 900ML 16,59");
        var pb = api.nova(acha("BOMB"), false); pb.ini = "2026-10-24"; pb.fim = "2026-10-24"; pb.limite = "2";
        pb.linhas = czParseTexto("Picanha Friboi KG 59,90\\nRefrigerante Fanta Laranja 2L 7,99");
        api.promos.push(pa, pb);
        czStep = 2; renderCartaz();
      }catch(e){ document.title = "ERRO no preencher: " + e.message; return; }
      if(cena === 2){ setTimeout(function(){ document.title = "pronto"; }, 400); return; }
      window.__ensaio = { imprimir: function(){ var b = document.querySelector("[data-primprimir]"); if(b) b.click(); } };
    } else
    /* espera o ensaio ASSUMIR a tela (__ensaioPronto), não só carregar — ver o comentário lá */
    if(!window.__ensaio || !window.__ensaioPronto){
      if(++tentativas < 300) return setTimeout(vai, 60);
      document.title = "ERRO: o ensaio nao assumiu a tela"; return;
    }
    if(!window.__czPromos){
      if(cena === 1){ document.title = "pronto"; return; }
      /* um respiro pro clique do menu (que o dublê faz pra abrir a página) terminar de desenhar */
      if(!vai.__esperou){ vai.__esperou = true; return setTimeout(vai, 900); }
    }
    if(!window.__czPromos){
      try{ window.__ensaio.preencher(); }
      catch(e){ document.title = "ERRO no preencher: " + e.message; return; }
    }
    if(cena === 2){ setTimeout(function(){ document.title = "pronto"; }, 400); return; }
    if(cena === 3){
      setTimeout(function(){
        var pego = null, abrir = window.open;
        window.open = function(){ return { document:{ write:function(x){ pego = String(x); }, close:function(){}, title:"" },
                                            focus:function(){}, print:function(){}, close:function(){} }; };
        try{ window.__ensaio.imprimir(); }catch(e){ document.title = "ERRO: " + e.message; }
        window.open = abrir;
        var esperas = 0;
        (function espera(){
          if(!pego){ if(++esperas > 200){ document.title = "ERRO: nao capturei a folha"; return; } return setTimeout(espera, 25); }
          document.open(); document.write(pego.replace(/window\\.print\\(\\);/g, "window.__ok=1;")); document.close();
          setTimeout(function(){ document.title = "pronto"; }, 600);
        })();
      }, 500);
    }
  })();
})();
</script>`;

// Entra antes do ÚLTIMO </body>: o painel gera outros documentos (recibo, cartaz) que têm
// "</body>" dentro de texto, e um replace comum acertava o primeiro deles.
const fim = h.lastIndexOf("</body>");
h = h.slice(0, fim) + STUB + h.slice(fim);
h = h.replace("<title>", "<title>" + (PAINEL ? "PAINEL COM A A" : ("ENSAIO " + VERSAO.toUpperCase())) + " · ");

fs.mkdirSync(BASE, { recursive: true });
fs.writeFileSync(SAIDA, h);
console.log("ENSAIO " + VERSAO.toUpperCase() + " -> " + SAIDA +
            "  (" + Math.round(fs.statSync(SAIDA).size / 1024) + " KB)");
