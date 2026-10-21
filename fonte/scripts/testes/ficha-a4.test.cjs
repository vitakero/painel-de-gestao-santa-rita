// FICHA DO BOLETO / PIX: FOLHA A4 COM A FICHA NO MEIO (==FICHAA4==, 20/10/2026).
// Cinco queixas dele na impressão ("corta embaixo", "está mais para a esquerda", "fora do padrão embaixo").
// A causa de fundo era o papel CARTA na impressão dele; com A4, a ficha tem que estar numa folha A4 exata,
// no meio: mesma margem dos dois lados e mesma em cima e embaixo, e todas acima da faixa que a
// impressora não imprime. Esta prova RODA a pixCanvasToPdfBlob do painel montado (output/index.html)
// com fichas de vários tamanhos e cobra isso tudo, sem deformar a imagem.
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
const A4 = [595.28, 841.89], MM = 2.8346;
for (const [nome, w, h] of [["boleto de hoje (760 x 1090)", 1520, 2180], ["boleto da versão anterior (760 x 1048)", 1520, 2096], ["boleto da 1ª versão (760 x 1199)", 1520, 2398], ["boleto antigo, alto (760 x 1527)", 1520, 3054], ["só Pix (760 x 896)", 1520, 1792], ["ficha baixinha (760 x 500)", 1520, 1000], ["ficha altíssima (760 x 3000)", 1520, 6000]]) {
  pixCanvasToPdfBlob(canvas(w, h));
  const t = ultimo.toString("latin1");
  const mb = (t.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/) || []).slice(1).map(Number);
  const paginas = (t.match(/\/Type \/Page\b/g) || []).length;
  const cm = (t.match(/q\n([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm/) || []).slice(1).map(Number);
  const [dw, dh, dx, dy] = cm;
  const esq = dx, dir = A4[0] - dx - dw, base = dy, topo = A4[1] - dy - dh;   // no PDF o y conta de baixo pra cima
  vale(nome + ": folha A4 exata, uma página só", mb[0] === A4[0] && mb[1] === A4[1] && paginas === 1, "página " + mb.join(" x ") + " · " + paginas + " pág.");
  vale(nome + ": no meio (mesma margem dos lados e mesma em cima e embaixo)", cm.length === 4 && Math.abs(esq - dir) < 0.05 && Math.abs(topo - base) < 0.05,
    cm.length === 4 ? ("lados " + (esq / MM).toFixed(1) + " / " + (dir / MM).toFixed(1) + " mm · cima/baixo " + (topo / MM).toFixed(1) + " / " + (base / MM).toFixed(1) + " mm") : "sem matriz");
  vale(nome + ": com margem (≥ 7 mm dos lados, ≥ 9,5 mm em cima e embaixo)", cm.length === 4 && esq >= 7 * MM && topo >= 9.5 * MM && base >= 9.5 * MM, "ok");
  // a ficha de verdade de hoje tem que OCUPAR a folha: com 14 mm em cima e embaixo ele achou "branco demais"
  if (/hoje/.test(nome)) vale(nome + ": ocupa a folha (no máximo 12 mm em cima e embaixo)", cm.length === 4 && topo <= 12 * MM && base <= 12 * MM, (topo / MM).toFixed(1) + " mm");
  vale(nome + ": sem deformar", cm.length === 4 && Math.abs(dw / dh - w / h) < 0.005, cm.length === 4 ? ("ocupa " + (dw / MM).toFixed(0) + " x " + (dh / MM).toFixed(0) + " mm") : "sem matriz");
}
console.log("\n  " + ok + " ok, " + falhou + " falha(s).\n");
process.exit(falhou ? 1 : 0);
