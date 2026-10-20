// Fotografa as duas versões do ensaio das PROMOÇÕES e monta uma página de comparação.
//
// Pedido do dono (19/10/2026): "cria um HTML por fora com todas as imagens, para eu analisar".
// Em vez de eu mandar foto por foto, ele abre uma página e compara A e B lado a lado.
//
// Cada foto vem de uma CENA roteirizada (?cena=N), para as duas versões aparecerem no mesmo
// estado — fotografar cada uma num momento diferente seria comparar coisas diferentes.
//
//   node scripts/previa-promocoes-fotos.cjs
// Isto NUNCA vai pro ar.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const RAIZ = path.join(process.env.HOME, "vr-looker-integration");
const BASE = path.join(RAIZ, ".previa", "cartaz-promocoes");
const FOTOS = path.join(BASE, "fotos");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

if (!fs.existsSync(CHROME)) { console.log("ERRO: preciso do Google Chrome."); process.exit(1); }
fs.mkdirSync(FOTOS, { recursive: true });

const CENAS = [
  { v: "a", cena: 1, alt: 1500, nome: "Passo 1 — como já é hoje",
    txt: "Os cartões de modelo e a galeria de cabeçalhos continuam exatamente como estão no painel. Nada muda aqui." },
  { v: "a", cena: 2, alt: 980, nome: "A · Uma caixa por promoção",
    txt: "Cada promoção é um bloco: cabeçalho, datas, limite e a lista dela. Você preenche a validade UMA vez por promoção." },
  { v: "a", cena: 3, alt: 1100, nome: "A · A folha que sai",
    txt: "As duas promoções na mesma folha, cada placa com o cabeçalho e a data dela. A folha continua enchendo em vez de começar outra." },
  { v: "b", cena: 2, alt: 980, nome: "B · Uma lista só, com coluna",
    txt: "A lista vem colada de uma vez, como hoje, e cada linha diz de qual promoção é. A cor de fundo separa à vista." },
  { v: "b", cena: 3, alt: 1100, nome: "B · A folha que sai",
    txt: "A folha é idêntica à da versão A — o que muda é só o caminho até ela, não o resultado." },
];

function foto(c) {
  const saida = path.join(FOTOS, c.v + "-" + c.cena + ".png");
  try { if (fs.existsSync(saida)) fs.unlinkSync(saida); } catch (e) {}
  try { execFileSync(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--use-mock-keychain",
    "--virtual-time-budget=30000", "--hide-scrollbars",
    "--window-size=1280," + c.alt, "--screenshot=" + saida,
    "file://" + path.join(BASE, c.v + ".html") + "?cena=" + c.cena],
    /* LIMITE DE RELÓGIO: na primeira rodada uma cena travou e o script ficou parado sem fim —
       a impressão disparava de verdade e o Chrome sem tela esperava um diálogo. Consertei a
       causa, mas um travamento nunca mais segura a fila: 90s e ele desiste daquela foto. */
    { stdio: "ignore", timeout: 90000 }); } catch (e) { console.log("  (" + c.v + " cena " + c.cena + " passou do tempo)"); }
  const tam = fs.existsSync(saida) ? fs.statSync(saida).size : 0;
  console.log("  " + c.v + " cena " + c.cena + " -> " + Math.round(tam / 1024) + " KB");
  return saida;
}

console.log("\nFotografando as cenas...");
CENAS.forEach(function (c) { c.arquivo = foto(c); });

/* A página embute as imagens (base64): assim ele pode mandar o arquivo pra quem quiser —
   inclusive pra funcionária das placas — sem levar uma pasta de fotos junto. */
function b64(f) {
  if (!fs.existsSync(f)) return "data:image/svg+xml;utf8," + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="120"><rect width="100%" height="100%" fill="#fdecea"/>' +
    '<text x="20" y="66" font-family="Arial" font-size="18" fill="#c0392b">Esta foto não foi tirada — rodar de novo.</text></svg>');
  return "data:image/png;base64," + fs.readFileSync(f).toString("base64");
}

const html = `<!doctype html><html lang="pt-br"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cartaz · promoções juntas — A ou B</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Inter,system-ui,sans-serif;background:#eef1f6;color:#1a2233;padding:26px 18px 60px;line-height:1.55}
.w{max-width:1120px;margin:0 auto}
h1{font-size:24px;color:#0c5a26;margin-bottom:6px}
.lead{font-size:14.5px;color:#4a5costa;color:#48566a;margin-bottom:18px}
.box{background:#fff;border-radius:12px;padding:18px 20px;box-shadow:0 1px 4px rgba(0,0,0,.07);margin-bottom:16px}
.box h2{font-size:16px;color:#1d2733;margin-bottom:4px}
.box p{font-size:13.5px;color:#56606d;margin-bottom:12px}
.box img{width:100%;border:1px solid #e4e9f0;border-radius:9px;display:block}
.tag{display:inline-block;font-size:11px;font-weight:800;letter-spacing:.4px;text-transform:uppercase;
  padding:3px 9px;border-radius:999px;margin-bottom:8px}
.tA{background:#eaf6ee;color:#0c5a26}.tB{background:#eef2fb;color:#1d4ed8}.tN{background:#f3f4f6;color:#56606d}
.comp{display:grid;grid-template-columns:1fr 1fr;gap:14px}
@media(max-width:820px){.comp{grid-template-columns:1fr}}
table{width:100%;border-collapse:collapse;font-size:13.5px;margin-top:6px}
th,td{text-align:left;padding:9px 10px;border-bottom:1px solid #eef2f6;vertical-align:top}
th{font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:#8a97a8}
td b{color:#1d2733}
.ok{color:#157a35;font-weight:700}.nao{color:#c0392b;font-weight:700}
.nota{background:#fffaf1;border:1px solid #f0d6ae;border-radius:9px;padding:11px 13px;font-size:13px;color:#8a5a00;margin-top:14px}
.fim{background:#fff;border-radius:12px;padding:18px 20px;box-shadow:0 1px 4px rgba(0,0,0,.07);font-size:14px}
.fim b{color:#0c5a26}
</style></head><body><div class="w">
<h1>Imprimir várias promoções de uma vez</h1>
<p class="lead">Dois caminhos para a mesma ideia: cada placa leva <b>o cabeçalho e a validade da promoção dela</b>,
e tudo sai numa impressão só. As telas abaixo são do painel de verdade rodando — não são desenhos.</p>

<div class="box"><span class="tag tN">Não muda</span>
  <h2>${CENAS[0].nome}</h2><p>${CENAS[0].txt}</p><img src="${b64(CENAS[0].arquivo)}" alt=""></div>

<div class="comp">
  <div class="box"><span class="tag tA">Caminho A</span>
    <h2>${CENAS[1].nome}</h2><p>${CENAS[1].txt}</p><img src="${b64(CENAS[1].arquivo)}" alt=""></div>
  <div class="box"><span class="tag tB">Caminho B</span>
    <h2>${CENAS[3].nome}</h2><p>${CENAS[3].txt}</p><img src="${b64(CENAS[3].arquivo)}" alt=""></div>
</div>

<div class="box"><span class="tag tN">Igual nos dois</span>
  <h2>A folha que sai da impressora</h2>
  <p>Repare: três placas da Hora da Economia e uma do Sábado Bombástico na <b>mesma folha</b>, cada uma com a data dela.
     O resultado é idêntico nos dois caminhos — o que você está escolhendo é o jeito de montar, não o cartaz.</p>
  <img src="${b64(CENAS[2].arquivo)}" alt=""></div>

<div class="box">
  <h2>Comparando os dois</h2>
  <table>
    <tr><th>&nbsp;</th><th>Caminho A — caixas</th><th>Caminho B — coluna</th></tr>
    <tr><td><b>Como digita</b></td><td>Uma lista por promoção</td><td>Uma lista só, depois marca cada linha</td></tr>
    <tr><td><b>A validade</b></td><td>Preenche <span class="ok">uma vez por promoção</span></td><td>Preenche uma vez por promoção</td></tr>
    <tr><td><b>Lista de 30 produtos</b></td><td>Cola em 2 ou 3 caixas</td><td><span class="nao">30 marcações</span> na coluna</td></tr>
    <tr><td><b>Conferir antes de imprimir</b></td><td>Olha caixa por caixa</td><td><span class="ok">Vê tudo numa tabela só</span></td></tr>
    <tr><td><b>Corrigir preço de um item</b></td><td>Acha no meio do texto colado</td><td><span class="ok">Campo próprio na tabela</span></td></tr>
    <tr><td><b>Quanto muda a tela de hoje</b></td><td>Troca o passo 2 inteiro</td><td><span class="ok">Parecido com o passo 3 atual</span></td></tr>
  </table>
  <div class="nota"><b>O que vale para os dois:</b> o modelo (Oferta padrão / De&nbsp;por) e o tamanho do papel continuam
  valendo para todas as placas — eles definem o desenho da folha e a impressora só aceita um por vez.
  Já <b>Oferta padrão e De/Por podem se misturar</b> na mesma impressão, o que hoje também obriga duas rodadas.</div>
</div>

<div class="fim">Para mexer de verdade: <b>versão A</b> em <code>localhost:4610/a.html</code> ·
<b>versão B</b> em <code>localhost:4610/b.html</code>. Pode digitar, trocar cabeçalho, mudar data e imprimir —
nada ali toca o painel da loja.</div>
</div></body></html>`;

const saida = path.join(BASE, "comparar.html");
fs.writeFileSync(saida, html);
console.log("\nCOMPARATIVO -> " + saida + "  (" + Math.round(fs.statSync(saida).size / 1024) + " KB)");
