// FICHA DO BOLETO / PIX CABE NUMA FOLHA A4 (==FICHAA4==, 20/10/2026).
// Queixa dele: "quando boto imprimir não cabe em uma folha, corta". O PDF saía com a altura da
// ficha (595 x 1196 pt no modo boleto) e a impressora cortava. Esta prova RODA a pixCanvasToPdfBlob
// do painel montado (output/index.html) com fichas de vários tamanhos e cobra: página A4 exata,
// 1 página só, e a imagem inteira dentro da folha (com margem), sem deformar.
//   node scripts/testes/ficha-a4.test.cjs
const fs = require("fs"), path = require("path");
const html = fs.readFileSync(path.join(__dirname, "..", "..", "output", "index.html"), "utf8");
let ok = 0, falhou = 0;
const vale = (n, c, d) => { console.log((c ? "  OK   " : "  FALHA") + " | " + n + "  ->  " + d); c ? ok++ : falhou++; };
const i = html.indexOf("function pixCanvasToPdfBlob(");
const f = html.indexOf("\n}\n", i);
vale("a função do PDF existe no painel montado", i > 0 && f > i, i > 0 ? "achei" : "NÃO ACHEI");
const fonte = html.slice(i, f + 2);
let ultimo = null;
class BlobFalso { constructor(partes) { ultimo = Buffer.concat(partes.map(p => Buffer.from(p))); } }
const pixCanvasToPdfBlob = new Function("atob", "Blob", fonte + "\nreturn pixCanvasToPdfBlob;")(s => Buffer.from(s, "base64").toString("binary"), BlobFalso);
const canvas = (w, h) => ({ width: w, height: h, toDataURL: () => "data:image/jpeg;base64," + Buffer.from("JPEGFALSO").toString("base64") });
const A4 = [595.28, 841.89];
for (const [nome, w, h] of [["boleto de hoje (760 x 1199)", 1520, 2398], ["boleto antigo, alto (760 x 1527)", 1520, 3054], ["só Pix (760 x 1024)", 1520, 2048], ["ficha baixinha (760 x 500)", 1520, 1000], ["ficha altíssima (760 x 3000)", 1520, 6000]]) {
  pixCanvasToPdfBlob(canvas(w, h));
  const t = ultimo.toString("latin1");
  const mb = (t.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/) || []).slice(1).map(Number);
  const paginas = (t.match(/\/Type \/Page\b/g) || []).length;
  const cm = (t.match(/q\n([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm/) || []).slice(1).map(Number);
  const [dw, dh, dx, dy] = cm;
  const dentro = cm.length === 4 && dx >= 0 && dy >= 0 && dx + dw <= A4[0] + 0.01 && dy + dh <= A4[1] + 0.01;
  const semDeformar = cm.length === 4 && Math.abs(dw / dh - w / h) < 0.005;
  vale(nome + ": página A4 e uma só", mb[0] === A4[0] && mb[1] === A4[1] && paginas === 1, "página " + mb.join(" x ") + " · " + paginas + " pág.");
  vale(nome + ": a ficha inteira dentro da folha, sem deformar", dentro && semDeformar, cm.length === 4 ? ("ocupa " + dw.toFixed(0) + " x " + dh.toFixed(0) + " em (" + dx.toFixed(0) + ", " + dy.toFixed(0) + ")") : "sem matriz");
}
console.log("\n  " + ok + " ok, " + falhou + " falha(s).\n");
process.exit(falhou ? 1 : 0);
