// O REGULAMENTO NO PAPEL — a bancada de impressão.
// A tela mente sobre o papel: quem pagina, corta e escolhe a caixa da folha é o Chrome.
// Aqui eu pego a MESMA folha que o botão "Imprimir" monta, mando o Chrome sem tela
// imprimir num PDF de verdade e conto o que caiu em cada página.
//   node scripts/previa-regulamento-papel.cjs
// Isto NUNCA vai pro ar.
const fs = require("fs"), path = require("path"), cp = require("child_process");
const RAIZ = path.join(process.env.HOME, "vr-looker-integration");
const DIR = path.join(RAIZ, ".previa");
const FOLHA = path.join(DIR, "regulamento-papel.html");
const PDF = path.join(DIR, "regulamento-papel.pdf");

const HTML = fs.readFileSync(path.join(RAIZ, "output", "index.html"), "utf8");
function pedaco(marcaIni, marcaFim) {
  const a = HTML.indexOf(marcaIni), b = HTML.indexOf(marcaFim);
  if (a < 0 || b < 0) throw new Error("não achei " + marcaIni);
  return HTML.slice(HTML.indexOf("*/", a) + 2, HTML.lastIndexOf("/*", b));
}
function funcao(nome) {
  const i = HTML.indexOf("function " + nome + "(");
  if (i < 0) throw new Error("não achei a função " + nome);
  let j = HTML.indexOf("{", i), d = 0, k = j;
  while (k < HTML.length) { if (HTML[k] === "{") d++; else if (HTML[k] === "}") { d--; if (!d) break; } k++; }
  return HTML.slice(i, k + 1);
}
// a folha sai do painel de verdade: mesmo texto, mesma barra, mesmo CSS
const gerar = new Function(funcao("pxDocBarraHtml") + "\n" + pedaco("==REG-INICIO==", "==REG-FIM==") + "\nreturn regDocHtml();");
fs.mkdirSync(DIR, { recursive: true });
fs.writeFileSync(FOLHA, gerar());
console.log("folha -> " + FOLHA);

const CHROME = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                "/Applications/Chromium.app/Contents/MacOS/Chromium"].find((p) => fs.existsSync(p));
if (!CHROME) { console.log("Chrome não encontrado — só gerei a folha."); process.exit(0); }
cp.execFileSync(CHROME, ["--headless", "--disable-gpu", "--no-pdf-header-footer",
  "--print-to-pdf=" + PDF, "file://" + FOLHA], { stdio: "ignore", timeout: 120000 });
console.log("pdf   -> " + PDF);

// pdftotext -bbox dá a POSIÇÃO de cada palavra: é assim que se sabe o que vazou da folha.
const txt = cp.execFileSync("pdftotext", ["-layout", PDF, "-"], { encoding: "utf8", maxBuffer: 1 << 26 });
const paginas = txt.split("\f").filter((p) => p.trim());
console.log("\npáginas: " + paginas.length);

const D = JSON.parse(fs.readFileSync(path.join(RAIZ, "assets", "regulamento-interno.json"), "utf8"));
const norm = (s) => String(s).replace(/\s+/g, " ").trim();
// o rodapé se repete em toda folha e parte frases no meio da virada de página —
// tirar ele é o que deixa medir o TEXTO, e não a paginação
const RODAPE = new RegExp(norm(D.empresa) + "\\s+" + D.cnpj.replace(/[.\/-]/g, "\\$&") + "\\s+" + norm(D.endereco).replace(/[.\/()-]/g, "\\$&") + ",? TEL: " + D.telefone.replace(/[()-]/g, "\\$&"), "g");
const NOPDF = norm(txt).replace(RODAPE, " ").replace(/\s+/g, " ");
let faltando = [];
D.capitulos.forEach((c) => c.itens.forEach((it) => {
  if (NOPDF.indexOf(norm(it.txt)) < 0) faltando.push(it.rot);
  (it.lista || []).forEach((l) => { if (NOPDF.indexOf(norm(l.txt)) < 0) faltando.push(it.rot + " " + l.rot); });
}));
console.log("trechos que NÃO saíram no papel: " + (faltando.length ? faltando.join(", ") : "nenhum"));
console.log("rodapé da empresa em " + (txt.match(/12\.988\.127\/0001-40/g) || []).length + " lugares (folhas: " + paginas.length + ")");
console.log("frase de ciência no papel: " + (NOPDF.indexOf(norm(D.ciencia)) >= 0 ? "sim" : "NÃO"));

// ---------------------------------------------------------------------------
// O TEXTO ENCOSTA NO RODAPÉ?
// Esta é a medida que pegou o defeito: com o rodapé em position:fixed o navegador
// REPETIA a linha, mas não descontava a altura dela, e o texto era impresso POR CIMA
// em 4 das 10 folhas. -bbox dá a posição de cada palavra; é assim que se prova.
// O rodapé é reconhecido pelas PALAVRAS dele, não pela altura — senão a segunda linha
// do próprio rodapé passaria por invasora.
// ---------------------------------------------------------------------------
const doRodape = {};
(D.empresa + " " + D.cnpj + " " + D.endereco + " TEL: " + D.telefone).split(/\s+/)
  .forEach((w) => { doRodape[w.replace(/,$/, "")] = true; });
const xml = cp.execFileSync("pdftotext", ["-bbox", PDF, "-"], { encoding: "utf8", maxBuffer: 1 << 26 });
let folhasRuins = 0, menorFolga = Infinity;
console.log("");
xml.split(/<page /).slice(1).forEach((pg, i) => {
  const ws = []; const re = /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([\s\S]*?)<\/word>/g; let w;
  while ((w = re.exec(pg))) ws.push({ y0: +w[2], y1: +w[4], t: w[5].replace(/&amp;/g, "&") });
  if (!ws.length) return;
  const marca = ws.filter((x) => x.t.indexOf("12.988.127") >= 0);
  if (!marca.length) { console.log("  folha " + (i + 1) + ": SEM RODAPÉ"); folhasRuins++; return; }
  const base = marca[marca.length - 1].y0;      // o de BAIXO: no alto da folha 1 tem o mesmo CNPJ
  const rod = ws.filter((x) => x.y0 >= base - 3 && doRodape[x.t.replace(/,$/, "")]);
  const topo = Math.min.apply(null, rod.map((x) => x.y0));
  const fundoRod = Math.max.apply(null, rod.map((x) => x.y1));
  const corpo = ws.filter((x) => rod.indexOf(x) < 0);
  const invade = corpo.filter((x) => x.y1 > topo - 0.5 && x.y0 < fundoRod + 0.5);
  const folga = (topo - Math.max.apply(null, corpo.filter((x) => x.y1 <= topo).map((x) => x.y1).concat([0]))) / 2.835;
  if (invade.length) folhasRuins++;
  if (folga < menorFolga) menorFolga = folga;
  console.log("  folha " + String(i + 1).padStart(2) + ": folga corpo→rodapé = " + folga.toFixed(1) + "mm"
    + (invade.length ? "   *** " + invade.length + " palavra(s) EM CIMA do rodapé: " + invade.slice(0, 6).map((x) => x.t).join(" ") : ""));
});
console.log("\nmenor folga: " + menorFolga.toFixed(1) + "mm");
console.log(folhasRuins ? ">>> RUIM: " + folhasRuins + " folha(s) com texto em cima do rodapé"
                        : ">>> nenhuma folha com texto em cima do rodapé");
process.exit(folhasRuins || faltando.length ? 1 : 0);
