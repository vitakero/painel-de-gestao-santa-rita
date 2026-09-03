// PRÉVIA — remarcar o vencimento de uma parcela (Pontos extras).
// Roda as funções DE VERDADE do painel (pxAgendaHtml, pxRemarcHtml, pxDataChip) com o CSS
// de verdade. Não é uma imitação do desenho: é o desenho.
//   node scripts/previa-remarcar.cjs
// Isto NUNCA vai pro ar.
const fs = require("fs"), path = require("path");
const RAIZ = path.join(process.env.HOME, "vr-looker-integration");
const H = fs.readFileSync(path.join(RAIZ, "output", "index.html"), "utf8");

// pega uma função do painel pelo nome, contando as chaves (serve pra uma linha e pra 50)
function fn(nome) {
  const re = new RegExp("\\nfunction " + nome + "\\s*\\(");
  const m = H.match(re);
  if (!m) throw new Error("não achei function " + nome);
  let i = H.indexOf("{", m.index + m[0].length - 1), p = 0, j = i;
  for (; j < H.length; j++) {
    const c = H[j];
    if (c === "{") p++;
    else if (c === "}") { p--; if (!p) break; }
  }
  return H.slice(m.index + 1, j + 1) + "\n";
}
const est = (H.match(/<style>[\s\S]*?<\/style>/) || [""])[0];
// o tema escuro é gerado no build, num <style> próprio — sem ele a prévia noturna é chute
const estEscuro = (H.match(/<style id="temaEscuroCss">[\s\S]*?<\/style>/) || [""])[0];

// o que o painel tem em volta e a prévia não precisa de verdade
const STUBS = `
  var HOJE=new Date(2026,8,3);
  var pontosG=[];
  window.__PERFIL={ nome:"Victor", is_master:true, paginas:["pontos"] };
  window.__EMAIL="diretoria@";
  function pxPodeVer(){ return true; }
  function pixCobDe(){ return null; }      // nenhum boleto de pé no banco (é o estado dele hoje)
  function pixCobPaga(){ return false; }
  function pxManSt(m){ return (typeof m==="string")?m:((m&&m.st)||""); }
  function pxManBonif(m){ return !!(m&&typeof m==="object"&&m.t==="bonif"); }
  function pxManManual(m){ return !!(m&&typeof m==="object"&&m.t==="manual"); }
  function brl(v){ return "R$ "+(+v||0).toFixed(2).replace(".",","); }
`;
const REAIS = ["pxEsc","pxFmtData","pxParseData","pxDateKey","pxAgenda","pxDataChip",
               "pxRemarc","pxRemarcVale","pxRemarcPend","pxVenc","pxVencD",
               "pxQuitado","pxDataCelHtml","pxAgendaHtml"].map(fn).join("");

// o ponto 6 da tela dele: R$ 400/mês, 01/08/2026 a 31/10/2026, boleto
const P6 = { id:"p6", numero:6, abertura:"2026-08-01", vencimento:"2026-10-31", valor:400,
             pagamento:"Boleto", fornecedor:"RIOGRANDENSE DISTRIBUIDORA LTDA", vendedor:"Rubinha" };
const AUT = d => ({ data:d, st:"autorizado", motivo:"acerto com o vendedor Rubinha",
                    quem:"Victor", autorizado_por:"Victor", autorizado_em:"2026-09-03T10:00:00.000Z" });

const CENAS = [
  ["1. Como está hoje — nada remarcado",
   "Três parcelas todo dia 1º. As de agosto e setembro já venceram: é isto que deixa o ponto em ATRASADO.",
   Object.assign({}, P6)],
  ["2. O financeiro pediu, o master ainda não autorizou",
   "A data que VALE continua 01/08. O pedido fica escrito do lado, com o motivo à vista, e os botões de autorizar/recusar.",
   Object.assign({}, P6, { remarcacoes:{ "2026-08-01":{ pend:{ data:"2026-09-15", motivo:"acerto com o vendedor Rubinha", quem:"Financeiro", quando:"2026-09-03T10:00:00.000Z" } } } })],
  ["3. Autorizado — as datas que o vendedor pediu",
   "Agosto 15/09, setembro 30/09, outubro 30/09. A data antiga fica na etiqueta, o boleto sai com a nova, e o ATRASADO cai.",
   Object.assign({}, P6, { remarcacoes:{ "2026-08-01":AUT("2026-09-15"), "2026-09-01":AUT("2026-09-30"), "2026-10-01":AUT("2026-09-30") } })],
];

const JANELA =
  '<div class="modal-cx" style="max-width:400px;margin:0;">' +
  '<div class="modal-top"><div class="modal-ic" style="background:#e3f0e8;color:#157a35;">📅</div><div class="modal-tit">Remarcar a cobrança</div></div>' +
  '<div class="pix-body"><div class="pix-sub">Parcela nº 1 — R$ 400,00, hoje marcada pra 01/08/2026. A data nova passa a valer na hora.</div>' +
  '<div class="pix-cc-lbl">Nova data de vencimento</div>' +
  '<input type="date" value="2026-09-15" style="width:100%;box-sizing:border-box;border:1px solid #cdd6e0;border-radius:8px;padding:9px 10px;font-size:14px;color:#2a3340;">' +
  '<div class="pix-cc-lbl">Por que a data mudou?</div>' +
  '<input type="text" value="acerto com o vendedor Rubinha" style="width:100%;box-sizing:border-box;border:1px solid #cdd6e0;border-radius:8px;padding:9px 10px;font-size:14px;color:#2a3340;">' +
  '<div style="margin-top:6px;font-size:12px;color:#c0392b;"></div></div>' +
  '<div class="modal-acts"><button type="button" class="btn-p" style="background:#157a35;color:#fff;border:0;">Remarcar</button><button type="button" class="btn-s">Cancelar</button></div>' +
  '</div>';

const monta = (escuro) => '<!doctype html><html lang="pt-BR"'+(escuro?' class="tema-escuro"':'')+'><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1"><title>Prévia — remarcar a cobrança</title>' + est + (escuro?estEscuro:"") +
  '<style>body{margin:0;background:'+(escuro?'#0f1115':'#f4f6f9')+';font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;}' +
  '.cena{background:'+(escuro?'#1c212a':'#fff')+';border:1px solid '+(escuro?'#2d3643':'#e3e8ee')+';border-radius:14px;margin:22px;padding:18px 4px 6px;}' +
  '.cena h3{margin:0 20px 4px;font-size:15px;color:'+(escuro?'#f3f4f6':'#1a2233')+';}' +
  '.cena p{margin:0 20px 6px;font-size:13px;color:#6b7787;line-height:1.5;max-width:760px;}' +
  '.jan{margin:22px;display:flex;gap:22px;align-items:flex-start;}</style>' +
  '</head><body><div id="alvo"></div>' +
  '<script>' + STUBS + REAIS +
  'var CENAS=' + JSON.stringify(CENAS) + ';' +
  'document.getElementById("alvo").innerHTML=CENAS.map(function(c){' +
  '  return \'<div class="cena"><h3>\'+c[0]+\'</h3><p>\'+c[1]+\'</p>\'+pxAgendaHtml(c[2])+\'</div>\';' +
  '}).join("")+\'<div class="cena"><h3>4. A janelinha de remarcar</h3><p>Data nova e motivo. Se quem clica não é o master, o botão diz “Enviar para autorização”.</p><div class="jan">' + JANELA.replace(/'/g, "\\'") + '</div></div>\';' +
  '<\/script></body></html>';

const dir = path.join(RAIZ, ".previa");
if (!fs.existsSync(dir)) fs.mkdirSync(dir);
[["previa-remarcar.html", false], ["previa-remarcar-escuro.html", true]].forEach(([nome, escuro]) => {
  const pag = monta(escuro);
  fs.writeFileSync(path.join(dir, nome), pag);
  console.log("PRÉVIA -> " + path.join(dir, nome) + "  (" + Math.round(pag.length / 1024) + " KB)");
});
