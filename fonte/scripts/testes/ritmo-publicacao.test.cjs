// TRAVA: o ritmo de publicação segue o movimento da loja, e não estoura o Vercel.
//
// O Vercel tem limite de 100 publicações por dia. A regra antiga (publicar a cada rodada
// até 60, depois espaçar) chegava a 89 num sábado — e as publicações manuais furam a fila
// e somam por cima, então um dia de trabalho pesado estourava.
//
// A régua nova sai do faturamento por hora MEDIDO (média de 90 dias, 27/08/2026):
// segunda a sábado tem pico de manhã (08-10h) e de tarde (16-19h), com vale no almoço;
// domingo são 6 horas concentradas. As horas de FECHAMENTO (20h/21h; 13h/14h no domingo)
// são rápidas mesmo vendendo pouco: é quando o número do dia fecha e o dono olha.
//
//   node scripts/testes/ritmo-publicacao.test.cjs
const fs = require("fs");
const path = require("path");
const SRC = fs.readFileSync(path.join(__dirname, "..", "publicar.cjs"), "utf8");

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + obtido + (bate ? "" : "   (esperado: " + esperado + ")"));
  bate ? ok++ : falhou++;
}
function tabela(nome) {
  const m = SRC.match(new RegExp("const\\s+" + nome + "\\s*=\\s*\\[([^\\]]+)\\]"));
  return m ? m[1].split(",").map(x => +x.trim()) : null;
}
const SEM = tabela("RITMO_SEM"), DOM = tabela("RITMO_DOM");
const TETO = +((SRC.match(/const\s+TETO_DIA\s*=\s*(\d+)/) || [])[1]);

eq("existe a tabela de segunda a sábado", !!SEM, true);
eq("existe a tabela de domingo", !!DOM, true);
eq("segunda a sábado tem 24 horas", SEM && SEM.length, 24);
eq("domingo tem 24 horas", DOM && DOM.length, 24);
eq("a regra antiga (60/80) não existe mais", /pubsHoje >= 80\) \? 30/.test(SRC), false);
eq("o ritmo sai da HORA do relógio", /RITMO_DOM : RITMO_SEM\)\[agora\.getHours\(\)\]/.test(SRC), true);
eq("domingo usa a tabela de domingo", /getDay\(\) === 0 \? RITMO_DOM/.test(SRC), true);

// --- as horas de PICO, que foram medidas ---
[8, 9, 10, 16, 17, 18, 19].forEach(h => eq("seg-sáb " + h + "h é pico (10 min)", SEM[h], 10));
// --- FECHAMENTO: rápido apesar de vender pouco. É o pedido do dono. ---
[20, 21].forEach(h => eq("seg-sáb " + h + "h é fechamento (10 min)", SEM[h], 10));
[13, 14].forEach(h => eq("domingo " + h + "h é fechamento (10 min)", DOM[h], 10));
// --- o vale do almoço NÃO pode ser rápido: é onde a opção 2 economiza ---
[11, 12, 13, 14, 15].forEach(h => eq("seg-sáb " + h + "h é meio (30 min)", SEM[h], 30));
eq("seg-sáb 06h é fraco (60 min)", SEM[6], 60);
eq("seg-sáb 07h é meio (30 min)", SEM[7], 30);
// --- domingo: 07h às 12h é tudo pico ---
[7, 8, 9, 10, 11, 12].forEach(h => eq("domingo " + h + "h é pico (10 min)", DOM[h], 10));
eq("domingo à tarde é lento (loja fechada)", DOM[17], 60);

// --- e a conta: quantas publicações o dia inteiro permite ---
function porDia(t) { let n = 0; for (let h = 0; h < 24; h++) n += 60 / t[h]; return Math.round(n); }
const dSem = porDia(SEM), dDom = porDia(DOM);
console.log("\n  teto teórico por dia: seg-sáb " + dSem + ", domingo " + dDom + "  (limite do Vercel: 100)");
eq("seg-sábado cabe no limite com folga", dSem <= 85, true);
eq("domingo cabe no limite com folga", dDom <= 85, true);
eq("sobra pelo menos 15 para publicação manual", 100 - Math.max(dSem, dDom) >= 15, true);

// --- a trava dura ---
eq("existe trava dura de dia", TETO > 0, true);
eq("a trava dura fica abaixo de 100", TETO < 100, true);
eq("a trava dura é conferida antes do ritmo", SRC.indexOf("TETO_DIA)") < SRC.indexOf("RITMO_DOM : RITMO_SEM"), true);

// --- o que NÃO pode mudar: publicação manual passa por cima, e "nada mudou" manda mais ---
eq("FORCAR=1 continua furando a régua", /if \(process\.env\.FORCAR !== "1"\) \{/.test(SRC), true);
eq('"nada mudou" continua vindo antes do ritmo', SRC.indexOf("Nada mudou desde") < SRC.indexOf("Teto do dia"), true);

// --- dá pra saber QUEM publicou? sem isso não se audita o ritmo ---
eq("a mensagem diz de onde veio", /const deOnde = \(process\.env\.FORCAR === "1"\) \? "mac" : "loja"/.test(SRC), true);
eq("e entra na mensagem do commit", /"Painel \(" \+ deOnde \+ "\)"/.test(SRC), true);

console.log("\n" + ok + " ok, " + falhou + " falha(s).");
process.exit(falhou ? 1 : 0);
