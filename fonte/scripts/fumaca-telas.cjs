// TESTE DE FUMAÇA DAS TELAS ENXUGADAS.
//
// Enxugar uma consulta é seguro no papel e traiçoeiro na prática: se uma coluna que a tela
// desenha deixar de ser pedida, nada estoura — o campo vira undefined e a tela mostra
// "undefined", "NaN" ou um buraco. Build e teste de código NÃO pegam isso.
//
// Este script abre o painel de verdade no Chrome, com o Supabase trocado por um dublê que
// devolve as linhas com EXATAMENTE as colunas que cada consulta pede (nem uma a mais),
// visita cada tela afetada e relata: erro de javascript, "undefined"/"NaN" na tela, e
// quanto cada leitura pesou.
//
//   node scripts/fumaca-telas.cjs
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const RAIZ = path.join(process.env.HOME, "vr-looker-integration");
const HTMLF = path.join(RAIZ, "output", "index.html");
const SAIDA = path.join(RAIZ, ".previa", "fumaca.html");
let h = fs.readFileSync(HTMLF, "utf8");

// Tira do painel gerado, para cada tabela, a lista de colunas que ele REALMENTE pede.
// Assim o dublê nunca devolve coluna que a consulta não pediu — é essa a graça do teste.
function selectDe(tabela) {
  const re = new RegExp('from\\("' + tabela + '"\\)\\.select\\(("([^"]*)"(\\s*\\+\\s*"[^"]*")*|[A-Z_]+)\\)');
  const m = h.match(re);
  if (!m) return null;
  let alvo = m[1];
  if (/^[A-Z_]+$/.test(alvo)) {                      // é uma constante, ex: CL_CONF_COLS
    const c = h.match(new RegExp("var\\s+" + alvo + "\\s*=\\s*((?:\"[^\"]*\"\\s*\\+?\\s*)+);"));
    alvo = c ? c[1] : '"*"';
  }
  return alvo.replace(/"|\s|\+/g, "");
}

const TABELAS = ["central_conferencias", "central_agendamentos", "vendasetor_mes", "vendasetor_apelido",
  "vendasetor_dia", "entregas_competencia", "entregas_lancamentos", "entregas_dias_confirmados",
  "flv_equipe", "flv_config", "flv_fechamentos", "flv_fechamento_equipe", "despesas_teto", "despesas_resumo",
  "agenda_eventos", "banco_horas", "cartaz_historico", "recibos_autorizacoes", "galpoes", "perfis",
  "feature_flags", "pontos_extras", "pix_cobrancas", "manutencao_registros", "manutencao_equipamentos", "lixeira"];

const puxa = (q) => { try {
  return JSON.parse(execSync("node -e '" + [
    'const fs=require("fs");const env=fs.readFileSync("' + RAIZ + '/.env","utf8");',
    'const g=k=>{const m=env.match(new RegExp("^"+k+"=(.*)$","m"));return m?m[1].trim().replace(/[^\\x21-\\x7e]/g,""):""};',
    'const B=g("SUPABASE_URL").replace(/\\/+$/,""),K=g("SUPABASE_SERVICE_KEY");',
    '(async()=>{const r=await fetch(B+"/rest/v1/' + q + '",{headers:{apikey:K,Authorization:"Bearer "+K}});',
    'if(!r.ok){console.log("[]");return;}const t=await r.text();console.log(t.charAt(0)==="["?t:"[]");})();'
  ].join("") + "'", { maxBuffer: 64 * 1024 * 1024 }).toString());
} catch (e) { return []; } };

const DADOS = {}, PESO = {};
TABELAS.forEach(t => {
  const sel = selectDe(t);
  if (!sel) { DADOS[t] = []; return; }
  // 200 linhas bastam pra tela renderizar; o que interessa é o FORMATO das colunas
  const linhas = puxa(t + "?select=" + encodeURIComponent(sel) + "&limit=200");
  DADOS[t] = linhas;
  PESO[t] = { cols: sel, n: linhas.length, kb: JSON.stringify(linhas).length / 1024 };
});

const PAGINAS = ["central", "vendasetor", "entregas", "flv", "despesas", "agenda", "jornada", "cartaz", "recibos", "galpoes"];

const stub = `
<script>
(function(){
  var DADOS = ` + JSON.stringify(DADOS) + `;
  window.__ERR=[]; window.addEventListener("error",function(e){ window.__ERR.push(e.message+" @"+e.lineno); });
  function resp(d){
    var p={data:d,error:null};
    p.then=function(ok){ setTimeout(function(){ ok({data:d,error:null}); },0); return p; };
    ["order","limit","range","or","gte","lte","lt","gt","in","not","eq","neq","is","select","filter","ilike","like"]
      .forEach(function(m){ p[m]=function(){ return p; }; });
    p.maybeSingle=function(){ return resp(d&&d.length?d[0]:null); };
    p.single=function(){ return resp(d&&d.length?d[0]:null); };
    return p;
  }
  var FAKE={
    from:function(t){ return {
      select:function(){ return resp(DADOS[t]||[]); },
      insert:function(){ return resp([]); }, upsert:function(){ return resp([]); },
      update:function(){ return resp([]); }, delete:function(){ return resp([]); }
    }; },
    rpc:function(){ return resp([]); },
    channel:function(){ var c={on:function(){return c;},subscribe:function(){return c;}}; return c; },
    removeChannel:function(){}
  };
  var t=0;
  function entrar(){
    t++;
    var b=document.querySelector('[data-page="central"]');
    if(!b){ if(t<60) setTimeout(entrar,150); return; }
    window.__SB=FAKE;
    window.__PERFIL={id:"11111111-1111-1111-1111-111111111111", is_master:true, paginas:[]};
    window.__EMAIL="fumaca@santarita";
    try{ var ov=document.getElementById("authOv"); if(ov&&ov.parentNode) ov.parentNode.removeChild(ov); }catch(e){}
    try{ document.body.style.overflow=""; }catch(e){}
    try{ if(window.__navmocss&&window.__navmocss.parentNode) window.__navmocss.parentNode.removeChild(window.__navmocss); }catch(e){}
    document.querySelectorAll(".nav-item").forEach(function(x){ x.style.display="flex"; x.classList.remove("nav-locked"); });
    var paginas=` + JSON.stringify(PAGINAS) + `;
    window.__RES=[];
    var i=0;
    function proxima(){
      if(i>=paginas.length){ window.__PRONTO=true; return; }
      var nome=paginas[i++];
      var antes=window.__ERR.length;
      var bt=document.querySelector('[data-page="'+nome+'"]');
      if(!bt){ window.__RES.push({pg:nome, erro:"nao achei o botao no menu"}); return proxima(); }
      bt.click();
      // a Central tem abas: abre a da conferencia tambem
      if(nome==="central") setTimeout(function(){ var v=document.querySelector('[data-clview="conf"]'); if(v) v.click(); },250);
      setTimeout(function(){
        var pg=document.getElementById("page-"+nome);
        var txt=pg?(pg.innerText||""):"";
        window.__RES.push({
          pg:nome,
          abriu: !!(pg && pg.className.indexOf("ativo")>=0),
          erros: window.__ERR.slice(antes),
          undef: (txt.match(/undefined/g)||[]).length,
          nan:   (txt.match(/\\bNaN\\b/g)||[]).length,
          vazio: txt.replace(/\\s/g,"").length < 40,
          tam: txt.length
        });
        proxima();
      }, 900);
    }
    setTimeout(proxima, 400);
  }
  entrar();
})();
</script>`;

const i = h.lastIndexOf("</body>");
h = h.slice(0, i) + stub + h.slice(i);
fs.mkdirSync(path.dirname(SAIDA), { recursive: true });
fs.writeFileSync(SAIDA, h);

console.log("O QUE CADA CONSULTA PEDE HOJE, e quanto pesa:");
Object.keys(PESO).sort().forEach(t => {
  const p = PESO[t];
  console.log("   " + t.padEnd(26) + String(p.n).padStart(4) + " linhas  " + p.kb.toFixed(1).padStart(7) + " KB   " + p.cols.slice(0, 78));
});
console.log("\nOK -> " + SAIDA + "   (agora rode o Chrome em cima dele)");
