// PRÉVIA do Compra × Venda (tela "Projeção de compras") com dados REAIS do VR.
//
//   node scripts/compras-x-venda/extrair-vr.cjs   (na rede da loja: lê o VR, só leitura)
//   node scripts/previa-compras-x-venda.cjs        -> .previa/previa-compras-x-venda.html
//
// Pega o output/index.html real, entra em "Projeção de compras" e troca o "em construção"
// pela tela nova. NUNCA vai pro ar — é só pro dono ver antes de aprovar.
// Dado injetado em base64: nome de produto do VR tem caractere que quebra o script.
const fs = require("fs"), path = require("path");
const RAIZ = path.join(__dirname, "..");
const P = (f) => path.join(RAIZ, "scripts", "compras-x-venda", f);
const SAIDA = path.join(RAIZ, ".previa", "previa-compras-x-venda.html");
const DADOS = fs.readFileSync(path.join(RAIZ, ".previa", "cxv-dados.json"));
let h = fs.readFileSync(path.join(RAIZ, "output", "index.html"), "utf8");

// Configuração: a margem objetivo que o dono aprovou em 24/09 (margens-objetivo.json).
// Setor fora do arquivo fica "não definida" — sem orçamento, nunca 0%.
const d = JSON.parse(DADOS);
const MO = JSON.parse(fs.readFileSync(P("margens-objetivo.json"), "utf8")).setores;
const chave = (n) => n.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/^NOVO\s*-?\s*/, "").trim();
const conf = {};
for (const [m, nome] of Object.entries(d.setores)) {
  const c = MO[chave(nome)];
  if (c) conf[m] = { margemObjetivo: c.margem, permiteEstoque: c.estoque === undefined ? null : c.estoque };
}
const faltam = Object.keys(MO).filter((k) => !Object.values(d.setores).some((n) => chave(n) === k));
if (faltam.length) { console.error("Setor da margem objetivo não existe no VR:", faltam); process.exit(1); }

const b64 = (s) => Buffer.from(s).toString("base64");
const STUB = `<style>${fs.readFileSync(P("tela.css"), "utf8")}</style>
<script>${fs.readFileSync(P("calculo.cjs"), "utf8")}</script>
<script>${fs.readFileSync(P("tela.js"), "utf8")}</script>
<script>
(function(){
function de64(s){ return decodeURIComponent(escape(atob(s))); }
var DADOS = JSON.parse(de64("${b64(DADOS.toString("utf8"))}"));
var CONF = JSON.parse(de64("${b64(JSON.stringify(conf))}"));
var _t=0;
function entrar(){
  _t++;
  var b=document.querySelector('[data-page="projecao"]');
  if(!b){ if(_t<80) return setTimeout(entrar,150); return; }
  window.__PERFIL={ id:"11111111-1111-1111-1111-111111111111", is_master:true, paginas:["projecao"] };
  window.__EMAIL="previa@santarita";
  try{ var ov=document.getElementById("authOv"); if(ov&&ov.parentNode) ov.parentNode.removeChild(ov); }catch(e){}
  try{ document.body.style.overflow=""; }catch(e){}
  try{ if(window.__navmocss&&window.__navmocss.parentNode) window.__navmocss.parentNode.removeChild(window.__navmocss); }catch(e){}
  try{ if(window.__pgcss&&window.__pgcss.parentNode) window.__pgcss.parentNode.removeChild(window.__pgcss); }catch(e){}
  document.querySelectorAll(".nav-item").forEach(function(x){ x.style.display="flex"; x.classList.remove("nav-locked"); });
  b.click();
  setTimeout(function(){
    try{
      var sec=document.getElementById("page-projecao");
      sec.innerHTML='<div id="cxvRaiz"></div>';
      cxvMontar(document.getElementById("cxvRaiz"), { dados:DADOS, conf:CONF, podeEditar:true, previa:true });
    }catch(e){ document.body.insertAdjacentHTML("afterbegin","<pre style='padding:20px;color:#c00'>"+e.message+"\\n"+e.stack+"</pre>"); }
  },200);
}
entrar();
})();
</script>`;

const fim = h.lastIndexOf("</body>");
h = h.slice(0, fim) + STUB + h.slice(fim);
h = h.replace("<title>", "<title>PRÉVIA COMPRA × VENDA · ");
fs.mkdirSync(path.dirname(SAIDA), { recursive: true });
fs.writeFileSync(SAIDA, h);
console.log("OK -> " + SAIDA + "  (" + (fs.statSync(SAIDA).size / 1e6).toFixed(1) + " MB)");
