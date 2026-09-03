// PRÉVIA — a etiqueta "remarcada" AO LADO da data (pedido dele em 03/09/2026).
// Roda as funções DE VERDADE do painel com o CSS de verdade, na largura de uma tela normal.
//   node scripts/previa-remarcar-lado.cjs      (isto NUNCA vai pro ar)
const fs = require("fs"), path = require("path");
const RAIZ = path.join(process.env.HOME, "vr-looker-integration");
const H = fs.readFileSync(path.join(RAIZ, "output", "index.html"), "utf8");

function fn(nome) {
  const re = new RegExp("\\nfunction " + nome + "\\s*\\(");
  const m = H.match(re);
  if (!m) throw new Error("não achei function " + nome);
  let i = H.indexOf("{", m.index + m[0].length - 1), p = 0, j = i;
  for (; j < H.length; j++) { const c = H[j]; if (c === "{") p++; else if (c === "}") { p--; if (!p) break; } }
  return H.slice(m.index + 1, j + 1) + "\n";
}
const est = (H.match(/<style>[\s\S]*?<\/style>/) || [""])[0];

const STUBS = `
  var HOJE=new Date(2026,8,3);
  var pontosG=[];
  window.__PERFIL={ nome:"Victor", is_master:true, paginas:["pontos"] };
  window.__EMAIL="diretoria@";
  function pxPodeVer(){ return true; }
  function pixCobDe(){ return null; }
  function pixCobPaga(){ return false; }
  function pxManSt(m){ return (typeof m==="string")?m:((m&&m.st)||""); }
  function pxManBonif(m){ return !!(m&&typeof m==="object"&&m.t==="bonif"); }
  function pxManManual(m){ return !!(m&&typeof m==="object"&&m.t==="manual"); }
  function brl(v){ return "R$ "+(+v||0).toFixed(2).replace(".",","); }
`;
const REAIS = ["pxEsc","pxFmtData","pxParseData","pxDateKey","pxAgenda","pxDataChip",
               "pxRemarc","pxRemarcVale","pxRemarcPend","pxVenc","pxVencD",
               "pxQuitado","pxDataCelHtml","pxAgendaHtml"].map(fn).join("");

// o ponto 6, com as três remarcadas — exatamente o que ele tem na tela
const P6 = { id:"p6", numero:6, abertura:"2026-09-01", vencimento:"2026-12-01", valor:400,
             pagamento:"Boleto", fornecedor:"RIOGRANDENSE DISTRIBUIDORA LTDA", vendedor:"Rubinha" };
const AUT = d => ({ data:d, st:"autorizado", motivo:"acerto com o vendedor Rubinha",
                    quem:"Victor", autorizado_por:"Victor", autorizado_em:"2026-09-03T10:00:00.000Z" });
const TRES = Object.assign({}, P6, { remarcacoes:{
  "2026-09-01":AUT("2026-09-30"), "2026-10-01":AUT("2026-10-30"), "2026-11-01":AUT("2026-11-30") } });
// uma remarcada + um pedido novo aguardando (pra ver os dois juntos na mesma coluna)
const MISTO = Object.assign({}, P6, { remarcacoes:{
  "2026-09-01":AUT("2026-09-30"),
  "2026-10-01":{ pend:{ data:"2026-10-20", motivo:"o vendedor pediu depois do dia 15", quem:"Financeiro", quando:"2026-09-03T10:00:00.000Z" } } } });

const monta = () => '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1"><title>Prévia — etiqueta ao lado da data</title>' + est +
  '<style>body{margin:0;background:#f4f6f9;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;}' +
  '.cena{background:#fff;border:1px solid #e3e8ee;border-radius:14px;margin:20px;padding:16px 4px 6px;}' +
  '.cena h3{margin:0 20px 4px;font-size:15px;color:#1a2233;}' +
  '.cena p{margin:0 20px 8px;font-size:13px;color:#6b7787;line-height:1.5;max-width:820px;}' +
  '.antes .px-data-cel{align-items:flex-start;}.antes .px-data-top{justify-content:flex-start;}' + // como estava: encostado à esquerda
  '</style></head><body><div id="alvo"></div>' +
  '<script>' + STUBS + REAIS +
  'var TRES=' + JSON.stringify(TRES) + ', MISTO=' + JSON.stringify(MISTO) + ';' +
  'document.getElementById("alvo").innerHTML=' +
  '  \'<div class="cena antes"><h3>1. Como está no ar agora — puxada pro lado</h3><p>O cabeçalho “Data da cobrança” é centralizado, mas o conteúdo fica encostado à esquerda.</p>\'+pxAgendaHtml(TRES)+\'</div>\'+' +
  '  \'<div class="cena"><h3>2. Centralizada — como as outras colunas</h3><p>Data, etiqueta e lápis no meio da coluna, alinhados com o cabeçalho.</p>\'+pxAgendaHtml(TRES)+\'</div>\'+' +
  '  \'<div class="cena"><h3>3. Centralizada, com um pedido aguardando (parcela 2)</h3><p>A linha do pedido — botões e motivo — também vem centralizada.</p>\'+pxAgendaHtml(MISTO)+\'</div>\';' +
  '<\/script></body></html>';

const dir = path.join(RAIZ, ".previa");
if (!fs.existsSync(dir)) fs.mkdirSync(dir);
const pag = monta();
fs.writeFileSync(path.join(dir, "previa-remarcar-lado.html"), pag);
console.log("PRÉVIA -> .previa/previa-remarcar-lado.html  (" + Math.round(pag.length / 1024) + " KB)");
