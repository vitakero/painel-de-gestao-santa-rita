// FICHA DO BOLETO / PIX CABE NUMA FOLHA A4, CENTRALIZADA (==FICHAA4==, 20/10/2026).
// Queixa dele: "quando boto imprimir não cabe em uma folha, corta". O PDF saía com a altura da
// ficha (595 x 1196 pt no modo boleto) e a impressora cortava. Esta prova RODA a pixCanvasToPdfBlob
// do painel montado (output/index.html) com fichas de vários tamanhos e cobra: a folha tem a largura
// da A4 e é mais BAIXA que a área que a impressora alcança (assim o Chrome, que encolhe e encosta à
// esquerda, preenche de lado a lado e fica centralizada — 5ª queixa dele), 1 página só, a imagem
// inteira dentro da folha com margem, sem deformar, e em tamanho real sobra folga embaixo da A4.
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
// área que uma impressora comum alcança na A4 (≈ 4 mm em volta e 12,7 mm embaixo): altura/largura ≈ 1,38
const PROPORCAO_IMPRIMIVEL = (297 - 4 - 12.7) / (210 - 8);
for (const [nome, w, h] of [["boleto de hoje (760 x 1048)", 1520, 2096], ["boleto da 1ª versão (760 x 1199)", 1520, 2398], ["boleto antigo, alto (760 x 1527)", 1520, 3054], ["só Pix (760 x 896)", 1520, 1792], ["ficha baixinha (760 x 500)", 1520, 1000], ["ficha altíssima (760 x 3000)", 1520, 6000]]) {
  pixCanvasToPdfBlob(canvas(w, h));
  const t = ultimo.toString("latin1");
  const mb = (t.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/) || []).slice(1).map(Number);
  const paginas = (t.match(/\/Type \/Page\b/g) || []).length;
  const cm = (t.match(/q\n([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm/) || []).slice(1).map(Number);
  const [dw, dh, dx, dy] = cm;
  // margens dentro da folha: 5 mm em cima, 7 mm nos lados, ~6 mm embaixo (a folga grande embaixo vem
  // de a folha ser mais baixa que a A4). No PDF o y conta de baixo pra cima: dy é a folga de baixo.
  const TOPO = 14, BASE = 16, LADO = 20;
  const dentro = cm.length === 4 && dx >= LADO - 0.01 && dy >= BASE - 0.01 && dx + dw <= mb[0] - LADO + 0.01 && dy + dh <= mb[1] - TOPO + 0.01;
  const centralizada = cm.length === 4 && Math.abs(dx - (mb[0] - dx - dw)) < 0.05;
  const folgaA4 = A4[1] - mb[1] + dy;   // em tamanho real, com a folha no alto da A4: quanto sobra embaixo
  const semDeformar = cm.length === 4 && Math.abs(dw / dh - w / h) < 0.005;
  vale(nome + ": largura da A4, cabe na A4, uma página só", mb[0] === A4[0] && mb[1] <= A4[1] && paginas === 1, "página " + mb.join(" x ") + " · " + paginas + " pág.");
  vale(nome + ": folha mais baixa que a área da impressora (o Chrome preenche de lado a lado)", mb[1] / mb[0] < PROPORCAO_IMPRIMIVEL - 0.02, "proporção " + (mb[1] / mb[0]).toFixed(3) + " < " + PROPORCAO_IMPRIMIVEL.toFixed(3));
  vale(nome + ": centralizada (mesma margem dos dois lados)", centralizada, cm.length === 4 ? ("esquerda " + dx.toFixed(1) + " · direita " + (mb[0] - dx - dw).toFixed(1)) : "sem matriz");
  vale(nome + ": em tamanho real sobram 18 mm ou mais embaixo da A4", folgaA4 >= 51, (folgaA4 / 2.835).toFixed(1) + " mm");
  vale(nome + ": a ficha inteira dentro da folha (com margem), sem deformar", dentro && semDeformar, cm.length === 4 ? ("ocupa " + dw.toFixed(0) + " x " + dh.toFixed(0) + " em (" + dx.toFixed(0) + ", " + dy.toFixed(0) + ")") : "sem matriz");
}
console.log("\n  " + ok + " ok, " + falhou + " falha(s).\n");
process.exit(falhou ? 1 : 0);
