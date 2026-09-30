// GALPÕES — mensalidade manual só fica PAGA com o COMPROVANTE (==GLCOMP==), 30/09/2026.
//
// Pedido dele: "marquei como pago sendo que eu não sei se foi pago mesmo... queria que fosse
// obrigatório, enquanto for manual, anexar o comprovante pra poder marcar como pago".
//
// Este teste extrai do painel gerado a regra de "paga" (pxQuitado) e o filtro do que vai pra
// nuvem (glCompsParaNuvem), e RODA. Cobra os dois lados: o galpão exige o comprovante, e o
// PONTO EXTRA continua exatamente como era.
//   node scripts/testes/galpoes-comprovante.test.cjs
const fs = require("fs");
const path = require("path");

const HTML = fs.readFileSync(path.join(__dirname, "..", "..", "output", "index.html"), "utf8");
function pega(nome) {
  const i = HTML.indexOf("function " + nome + "(");
  if (i < 0) throw new Error("não achei " + nome + " no output/index.html (rode o build antes)");
  let n = 0, j = HTML.indexOf("{", i);
  for (let k = j; k < HTML.length; k++) { if (HTML[k] === "{") n++; else if (HTML[k] === "}") { n--; if (!n) return HTML.slice(i, k + 1); } }
  throw new Error("função " + nome + " sem fim");
}
const f = new Function("var pixCobs={};\n" + ["pixCobKey", "pixCobDe", "pixCobPaga", "pxManBonif", "pxManManual", "pxManSt", "pxQuitado", "glCompsParaNuvem"].map(pega).join("\n") +
  "\nreturn { pxQuitado, glCompsParaNuvem };")();

let ok = 0, falhou = 0;
function vale(nome, cond, det) { console.log((cond ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + det); cond ? ok++ : falhou++; }
const K = "2026-10-05", arq = { arquivo: "https://x/galpao_gB_comp_2026-10-05.pdf", nome: "pix.pdf" };

console.log("\n  ==== GALPÃO (cobrança manual) ====");
vale("marcado como pago SEM comprovante: NÃO está pago", f.pxQuitado({ diaPag: 5, manuais: { [K]: "autorizado" } }, K) === false, "em aberto");
vale("marcado COM comprovante: está pago", f.pxQuitado({ diaPag: 5, manuais: { [K]: "autorizado" }, comprovantes: { [K]: arq } }, K) === true, "pago");
vale("comprovante sem a marcação: não está pago (o painel sempre grava os dois juntos)", f.pxQuitado({ diaPag: 5, comprovantes: { [K]: arq } }, K) === false, "em aberto");
vale("nada marcado: em aberto", f.pxQuitado({ diaPag: 5 }, K) === false, "em aberto");

console.log("\n  ==== PONTO EXTRA (não pode mudar) ====");
vale("ponto: 'Marcar pago' autorizado continua quitando", f.pxQuitado({ manuais: { [K]: "autorizado" } }, K) === true, "pago");
vale("ponto: comprovante sozinho continua quitando", f.pxQuitado({ comprovantes: { [K]: arq } }, K) === true, "pago");
vale("ponto: pagamento manual AGUARDANDO o master continua NÃO quitando", f.pxQuitado({ manuais: { [K]: { t: "manual", st: "pendente" } }, comprovantes: { [K]: arq } }, K) === false, "em aberto");

console.log("\n  ==== O QUE VAI PRA NUVEM ====");
const c = f.glCompsParaNuvem({ [K]: arq, "2026-11-05": { arquivo: "data:application/pdf;base64,AAAA", nome: "b.pdf" } });
vale("comprovante que já subiu vai pra nuvem", !!c[K], Object.keys(c).join(","));
vale("comprovante que ainda NÃO subiu (arquivo inteiro na memória) não vai", !c["2026-11-05"], "fica só neste computador até subir");
vale("sem comprovantes: vazio", f.glCompsParaNuvem(null) === null, "null");

console.log("\n  " + ok + " ok, " + falhou + " falha(s).\n");
process.exit(falhou ? 1 : 0);
