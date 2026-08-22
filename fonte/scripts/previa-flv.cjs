// Gera uma PRÉVIA da página FLV para conferência visual, sem precisar de login.
//
// Pega o painel de verdade (output/index.html) e troca só a conexão com a nuvem por dados de
// exemplo. O desenho é o do painel publicado — não uma imitação que envelhece sozinha.
//
//   node scripts/previa-flv.cjs
// Isto NUNCA vai pro ar.
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(process.env.HOME, "vr-looker-integration");
const SAIDA = path.join(RAIZ, ".previa", "previa-flv.html");
let h = fs.readFileSync(path.join(RAIZ, "output", "index.html"), "utf8");

const TELA = (process.env.TELA || "").replace(/[^a-z]/g, "");
const STUB = `<script>
(function(){
  // ---- perfil: master, para ver Configurações também ----
  window.__PERFIL = { id:"11111111-1111-1111-1111-111111111111", is_master:true, paginas:["flv"] };
  window.__EMAIL = "previa@santarita";

  // ---- doze meses de exemplo, com buracos de propósito ----
  // ago e set NÃO existem: é o caso que a planilha antiga transformava em 0% e -100%.
  var F = [
    { comp:"2026-07-01", fat:570132.36, desp:23945.56, qv:41200, qd:1680, st:"fechado" },
    { comp:"2026-06-01", fat:624393.80, desp:22477.77, qv:44800, qd:1520, st:"fechado" },
    { comp:"2026-05-01", fat:598210.14, desp:34700.19, qv:43100, qd:2610, st:"fechado" },
    { comp:"2026-04-01", fat:611882.05, desp:33653.51, qv:44050, qd:2480, st:"fechado" },
    { comp:"2026-03-01", fat:580455.90, desp:20315.95, qv:41800, qd:1390, st:"fechado" },
    { comp:"2026-02-01", fat:533112.40, desp:18658.93, qv:38200, qd:1240, st:"fechado" },
    { comp:"2026-01-01", fat:600350.00, desp:21012.25, qv:43500, qd:1450, st:"fechado" },
    { comp:"2025-07-01", fat:512884.10, desp:24618.44, qv:37900, qd:1810, st:"fechado" },
    { comp:"2025-06-01", fat:498220.75, desp:19928.83, qv:36400, qd:1330, st:"fechado" }
  ];
  var EQ = ["Adriano","Cleber","Josefa","Marcos"];
  var META = 5, FATOR = 0.0012;

  function calc(x, i){
    var pct = Math.round((x.desp / x.fat) * 100 * 10000) / 10000;
    var sit = pct <= META ? "atingida" : "nao_atingida";
    var tot = sit === "atingida" ? Math.round(x.fat * FATOR * 100) / 100 : 0;
    return {
      id: "f" + i, competencia: x.comp, setor: "FLV",
      faturamento: x.fat, desperdicio_valor: x.desp,
      qtd_vendida: x.qv, qtd_desperdicada: x.qd,
      pct_valor: pct,
      pct_qtd: Math.round((x.qd / x.qv) * 100 * 10000) / 10000,
      meta_aplicada: META, fator_aplicado: FATOR,
      premio_total: tot, participantes: EQ.length,
      premio_individual: tot ? Math.round((tot / EQ.length) * 100) / 100 : 0,
      situacao: sit, status: x.st, observacoes: null
    };
  }
  var FECH = F.map(calc);
  var EQUIPE = EQ.map(function(n, i){ return { id:"e"+i, nome:n, ativo:true }; });

  // ---- um cliente de mentira, com a mesma cara do supabase-js ----
  function resp(dados){
    var p = { data:dados, error:null };
    p.then = function(ok){ setTimeout(function(){ ok({data:dados, error:null}); }, 0); return p; };
    p.order = function(){ return p; };
    p.eq = function(){ return p; };
    p.limit = function(){ return p; };
    p.select = function(){ return p; };
    return p;
  }
  var FAKE_SB = {
    from: function(t){
      return {
        select: function(){
          if(t === "flv_fechamentos") return resp(FECH);
          if(t === "flv_equipe") return resp(EQUIPE);
          if(t === "flv_config") return resp([{ meta_pct:META, fator_premio:FATOR }]);
          if(t === "flv_fechamento_equipe") return resp(EQ.map(function(n){ return {nome:n}; }));
          // Os números que o robô mede no VR. Jogo o mês de agosto/2026 (o próximo a fechar)
          // com faturamento e balanço, para o botão "Buscar do VR" ter o que trazer.
          if(t === "flv_vr_faturamento") return resp([
            { competencia:"2026-08-01", faturamento:602906.26, qtd_vendida:151234.5 }
          ]);
          if(t === "flv_vr_balancos") return resp([
            { balanco_data:"2026-09-07", competencia_sugerida:"2026-08-01",
              valor_diferenca:-31522.0906, qtd_diferenca:-7508.859 }
          ]);
          return resp([]);
        },
        insert: function(){ return resp([]); },
        upsert: function(){ return resp([{id:"novo"}]); },
        update: function(){ return resp([]); },
        delete: function(){ return resp([]); }
      };
    }
  };

  // ---- entra direto na página FLV ----
  // NÃO uso o evento "load": o painel busca o supabase-js num endereço externo, e sem
  // internet essa busca fica pendurada — o load nunca dispara e a prévia ficava eternamente
  // na tela de "Verificando acesso...". Um relógio próprio, que tenta até a página existir.
  var tentativas = 0;
  function entrar(){
    tentativas++;
    var b = document.querySelector('[data-page="flv"]');
    if(!b){ if(tentativas < 60) setTimeout(entrar, 150); return; }
    window.__SB = FAKE_SB;
    window.__PERFIL = { id:"11111111-1111-1111-1111-111111111111", is_master:true, paginas:["flv"] };
    try{ var ov=document.getElementById("authOv"); if(ov && ov.parentNode) ov.parentNode.removeChild(ov); }catch(e){}
    try{ document.body.style.overflow=""; }catch(e){}
    try{ if(window.__navmocss && window.__navmocss.parentNode){ window.__navmocss.parentNode.removeChild(window.__navmocss); } }catch(e){}
    document.querySelectorAll(".nav-item").forEach(function(x){ x.style.display="flex"; x.classList.remove("nav-locked"); });
    b.click();
    // o painel pode redesenhar depois; garanto que a página FLV fica na frente
    setTimeout(function(){
      try{ flvRender(); }catch(e){}
      var T = "__TELA__";
      setTimeout(function(){
        try{
          if(T==="novo"){ var n=document.getElementById("flvNovoBt"); if(n) n.click(); }
          if(T==="config"){ var c=document.getElementById("flvCfgBt"); if(c) c.click(); }
          if(T==="detalhe"){ var d=document.querySelector("[data-flvver]"); if(d) d.click(); }
          if(T==="cenario"){
            // CENÁRIO A do Victor: 600.000 de faturamento com 24.000 de desperdício.
            // Esperado na tela: 4,00%, meta atingida, R$ 720,00 no total e R$ 180,00 por cabeça.
            var n=document.getElementById("flvNovoBt"); if(n) n.click();
            setTimeout(function(){
              function poe(id,v){ var e=document.getElementById(id); if(!e) return;
                e.value=v; e.dispatchEvent(new Event("input")); e.dispatchEvent(new Event("change")); }
              poe("flvFat","600.000,00"); poe("flvDesp","24.000,00");
              poe("flvQv","43000"); poe("flvQd","1500");
            }, 320);
          }
        }catch(e){}
      }, 350);
    }, 400);
  }
  setTimeout(entrar, 300);
})();
</script>`;

// Entra antes do ÚLTIMO </body>. O painel gera outros documentos (recibo, cartaz) que têm
// "</body>" dentro de texto — um replace comum acertava o primeiro deles e o stub nunca
// rodava. A prévia ficava eternamente em "Verificando acesso..." sem dizer por quê.
var _fim = h.lastIndexOf("</body>");
h = h.slice(0, _fim) + STUB.replace("__TELA__", TELA) + h.slice(_fim);
h = h.replace("<title>", "<title>PRÉVIA · ");
// sem animação: o Chrome sem tela congela no primeiro quadro e a janela sai invisível
h = h.replace("</head>", "<style>*,*::before,*::after{animation:none!important;transition:none!important}</style></head>");

fs.mkdirSync(path.dirname(SAIDA), { recursive: true });
fs.writeFileSync(SAIDA, h);
console.log("PRÉVIA -> " + SAIDA + "  (" + Math.round(fs.statSync(SAIDA).size/1024) + " KB)");
