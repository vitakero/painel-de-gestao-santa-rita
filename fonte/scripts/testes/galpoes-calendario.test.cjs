// GALPÕES — o calendário de cobranças vence no DIA DE PAGAMENTO (==GLDIA==), 30/09/2026.
//
// Pedido dele: "quero deixar todo dia 5 os pagamentos, mas o contrato pode ser o dia de
// abertura normalmente". Antes, a cobrança do galpão vencia no dia da ABERTURA (29), e o
// contrato dizia "até o dia 5" — os dois discordavam.
//
// Este teste NÃO procura texto: extrai pxAgenda do painel gerado e RODA, para galpão e para
// ponto extra. Cobra os dois lados: o galpão passou a vencer no dia 5, e o ponto extra
// continua exatamente como era (vence no dia da abertura).
//   node scripts/testes/galpoes-calendario.test.cjs
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
// HOJE é do painel (a data do dia); aqui a gente escolhe, pra simular o tempo passando
const monta = hoje => new Function("HOJE", pega("pxParseData") + "\n" + pega("pxDateKey") + "\n" + pega("pxAgenda") + "\n" + pega("pxFmtData") + "\n" +
  pega("glDiasSaida") + "\n" + pega("glSaiu") + "\n" + pega("glPrazoTxt") + "\nreturn { pxAgenda, pxDateKey, glSaiu, glPrazoTxt };")(hoje);
let f = monta(new Date(2026, 8, 30));
const datas = p => f.pxAgenda(p).map(d => f.pxDateKey(d));

let ok = 0, falhou = 0;
function vale(nome, cond, det) { console.log((cond ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + det); cond ? ok++ : falhou++; }

{ // os três galpões de hoje: abertura 29/09/2026, vencimento 29/09/2027, pagar até o dia 5
  const d = datas({ abertura: "2026-09-29", vencimento: "2027-09-29", diaPag: 5 });
  vale("galpão: 12 parcelas no ano de contrato", d.length === 12, d.length + " parcelas");
  vale("galpão: a 1ª vence no 1º dia 5 depois da abertura", d[0] === "2026-10-05", d[0]);
  vale("galpão: a última é 05/09/2027 (antes do fim do contrato)", d[d.length - 1] === "2027-09-05", d[d.length - 1]);
  vale("galpão: TODAS no dia 5", d.every(x => x.slice(8) === "05"), [...new Set(d.map(x => x.slice(8)))].join(","));
}
{
  const d = datas({ abertura: "2026-09-29", vencimento: "2027-09-29", diaPag: 0 });
  vale("galpão com o campo vazio: dia 5, igual ao contrato impresso", d[0] === "2026-10-05" && d.every(x => x.slice(8) === "05"), d[0]);
}
{
  const d = datas({ abertura: "2026-10-05", vencimento: "2027-10-05", diaPag: 5 });
  vale("galpão aberto NO dia 5: a 1ª parcela é o próprio dia", d[0] === "2026-10-05", d[0]);
  const e = datas({ abertura: "2026-10-06", vencimento: "2027-10-06", diaPag: 5 });
  vale("galpão aberto no dia 6: a 1ª parcela é o dia 5 do mês seguinte", e[0] === "2026-11-05", e[0]);
}
{
  const d = datas({ abertura: "2027-01-10", vencimento: "2027-06-10", diaPag: 31 });
  vale("dia 31 em mês curto: cai no último dia (fevereiro = 28)", d.includes("2027-02-28") && d.includes("2027-04-30"), d.join(" "));
}
{ // PONTO EXTRA: não tem diaPag -> continua vencendo no dia da abertura
  const d = datas({ abertura: "2026-09-29", vencimento: "2027-09-29" });
  vale("ponto extra NÃO muda: vence no dia da abertura (29)", d[0] === "2026-09-29" && d.every(x => x.slice(8) === "29" || x.slice(5) === "02-28"), d.slice(0, 3).join(" ") + " …");
  vale("ponto extra NÃO muda: mesmas 12 parcelas de antes", d.length === 12, d.length + " parcelas");
}

console.log("\n  ==== PRAZO INDETERMINADO (==GLSAIDA==): o galpão não tem data de fim ====");
{
  f = monta(new Date(2026, 8, 30));
  const d = datas({ abertura: "2026-09-29", diaPag: 5 });
  vale("sem saída, hoje 30/09/2026: mostra este mês e os próximos 12", d[0] === "2026-10-05" && d[d.length - 1] === "2027-09-05" && d.length === 12, d[0] + " … " + d[d.length - 1] + " (" + d.length + ")");
  const v = datas({ abertura: "2026-09-29", vencimento: "2027-09-29", diaPag: 5 });
  vale("o vencimento antigo do cadastro é IGNORADO no galpão", JSON.stringify(v) === JSON.stringify(d), v.length + " parcelas, iguais às sem vencimento");
  f = monta(new Date(2027, 2, 15));
  const e = datas({ abertura: "2026-09-29", diaPag: 5 });
  vale("o tempo passou (15/03/2027): a lista anda sozinha e guarda o que já venceu", e[0] === "2026-10-05" && e[e.length - 1] === "2028-03-05", e[0] + " … " + e[e.length - 1] + " (" + e.length + ")");
  const s = datas({ abertura: "2026-09-29", saida: "2027-03-20", diaPag: 5 });
  vale("inquilino saiu em 20/03/2027: cobranças param (a de 05/03 entra)", s[s.length - 1] === "2027-03-05" && s.length === 6, s[s.length - 1] + " (" + s.length + ")");
  const s2 = datas({ abertura: "2026-09-29", saida: "2027-03-05", diaPag: 5 });
  vale("saída NO dia do vencimento: essa parcela ainda entra", s2[s2.length - 1] === "2027-03-05", s2[s2.length - 1]);
  const s3 = datas({ abertura: "2026-09-29", saida: "2027-03-04", diaPag: 5 });
  vale("saída na véspera do vencimento: essa parcela não entra", s3[s3.length - 1] === "2027-02-05", s3[s3.length - 1]);
  vale("quem saiu antes de hoje conta como 'já saiu'", f.glSaiu({ saida: "2027-03-01" }) === true && f.glSaiu({ saida: "2027-04-01" }) === false && f.glSaiu({}) === false, "01/03 sim · 01/04 não · vazio não");
  vale("a tabela mostra 'Indeterminado' ou a saída", f.glPrazoTxt({}) === "Indeterminado" && f.glPrazoTxt({ saida: "2027-03-20" }) === "Saída 20/03/2027", f.glPrazoTxt({}) + " / " + f.glPrazoTxt({ saida: "2027-03-20" }));
  const pe = datas({ abertura: "2026-09-29", vencimento: "2027-09-29" });
  vale("ponto extra continua usando o vencimento dele (não é afetado)", pe.length === 12 && pe[0] === "2026-09-29", pe.length + " parcelas desde " + pe[0]);
}

console.log("\n  " + ok + " ok, " + falhou + " falha(s).\n");
process.exit(falhou ? 1 : 0);
