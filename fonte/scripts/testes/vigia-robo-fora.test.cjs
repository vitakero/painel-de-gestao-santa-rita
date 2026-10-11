// ============================================================
// BANCADA DO VIGIA DE FORA — as duas réguas do horário da loja têm que ser UMA.
//
// O horário da loja agora existe em dois lugares, e é de propósito: no painel (RV_LOJA), para
// a faixa de aviso na tela, e na função vigia-robo (LOJA), que roda na nuvem e manda o e-mail
// mesmo com a loja às escuras. Um não pode consultar o outro — um é navegador, o outro é Deno.
//
// O PERIGO: mudar o horário num lugar só. Aí o painel cala e o e-mail toca (ou o contrário), e
// ninguém entende mais qual dos dois está certo — que é como se perde a confiança no alarme.
// Esta bancada não compara os números de olho: ela RODA as duas contas lado a lado, numa semana
// inteira minuto a minuto, e exige o mesmo resultado.
//
//   node scripts/testes/vigia-robo-fora.test.cjs
// ============================================================
const fs = require("fs");
const path = require("path");
const RAIZ = path.join(__dirname, "..", "..");
const HTML = fs.readFileSync(path.join(RAIZ, "output", "index.html"), "utf8");
const TS = fs.readFileSync(path.join(RAIZ, "supabase", "functions", "vigia-robo", "index.ts"), "utf8");

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + obtido + (bate ? "" : "   (esperado: " + esperado + ")"));
  bate ? ok++ : falhou++;
}
function pega(txt, re, nome) {
  const m = txt.match(re);
  if (!m) { console.log("  FALHA | não achei " + nome); falhou++; return ""; }
  return m[0] + "\n";
}

// ---- a conta DO PAINEL, extraída do painel gerado ----
const PAINEL = new Function(
  pega(HTML, /var RV_LOJA=\[[\s\S]*?\];/, "RV_LOJA (painel)") +
  pega(HTML, /var RV_FUSO="[^"]+";/, "RV_FUSO (painel)") +
  "var rvFmtLoja=null;\n" +
  pega(HTML, /function rvHoraLoja\(ms\)\{[\s\S]*?\n\}/, "rvHoraLoja") +
  pega(HTML, /function rvAberto\(ms\)\{[\s\S]*?\n\}/, "rvAberto") +
  pega(HTML, /function rvMinAbertos\(deMs, ateMs\)\{[\s\S]*?\n\}/, "rvMinAbertos") +
  pega(HTML, /var RV_SEM_BATIMENTO=\d+;/, "RV_SEM_BATIMENTO") +
  "return {aberto:rvAberto, minAbertos:rvMinAbertos, LOJA:RV_LOJA, FUSO:RV_FUSO, LIMITE:RV_SEM_BATIMENTO};"
)();

// ---- a conta DA FUNÇÃO, extraída do arquivo .ts (sem as anotações de tipo) ----
// Tirar o tipo e rodar é o que torna esta prova real: comparar o TEXTO dos dois arquivos
// acusaria diferença em cada vírgula e passaria batido numa conta errada.
const semTipo = (s) => s
  .replace(/:\s*Record<[^>]*>/g, "")
  .replace(/:\s*number\b/g, "")
  .replace(/:\s*string\b/g, "")
  .replace(/\bas number\b/g, "")
  .replace(/\bexport\s+/g, "");
const FUNCAO = new Function(
  semTipo(
    pega(TS, /const LOJA = \[[\s\S]*?\];/, "LOJA (função)") +
    pega(TS, /const FUSO = "[^"]+";/, "FUSO (função)") +
    pega(TS, /const SEM_BATIMENTO = \d+;/, "SEM_BATIMENTO (função)") +
    pega(TS, /function horaLoja\(ms[^)]*\) \{[\s\S]*?\n\}/, "horaLoja") +
    pega(TS, /function aberto\(ms[^)]*\) \{[\s\S]*?\n\}/, "aberto") +
    pega(TS, /function minAbertos\(deMs[^)]*\) \{[\s\S]*?\n\}/, "minAbertos")
  ) + "return {aberto, minAbertos, LOJA, FUSO, LIMITE:SEM_BATIMENTO};"
)();

console.log("1) os números batem entre o painel e a função da nuvem");
eq("   o fuso é o mesmo", FUNCAO.FUSO, PAINEL.FUSO);
eq("   o limite de silêncio é o mesmo", FUNCAO.LIMITE, PAINEL.LIMITE);
eq("   e é 40 minutos", PAINEL.LIMITE, 40);
eq("   sete dias de horário nos dois", PAINEL.LOJA.length + "/" + FUNCAO.LOJA.length, "7/7");
const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
for (let d = 0; d < 7; d++) {
  eq("   " + DIAS[d] + " abre e fecha igual",
     FUNCAO.LOJA[d].ini + "-" + FUNCAO.LOJA[d].fim, PAINEL.LOJA[d].ini + "-" + PAINEL.LOJA[d].fim);
}

console.log("\n2) e as CONTAS batem, rodadas lado a lado");
// uma semana inteira, de 13 em 13 minutos (número quebrado de propósito: pega as bordas)
const INICIO = new Date("2026-10-11T00:00:00-03:00").getTime();
let difAberto = 0, difMin = 0, casos = 0, exemplo = null;
for (let t = INICIO; t < INICIO + 7 * 86400000; t += 13 * 60000) {
  casos++;
  if (PAINEL.aberto(t) !== FUNCAO.aberto(t)) { difAberto++; if (!exemplo) exemplo = new Date(t).toISOString(); }
  const a = PAINEL.minAbertos(t, t + 3 * 3600000);
  const b = FUNCAO.minAbertos(t, t + 3 * 3600000);
  if (a !== b) { difMin++; if (!exemplo) exemplo = new Date(t).toISOString() + " (" + a + " x " + b + ")"; }
}
eq("   " + casos + " instantes conferidos: 'está aberta?' nunca divergiu", difAberto, 0);
eq("   e a conta de minutos abertos nunca divergiu", difMin, 0);
if (exemplo) console.log("         primeiro caso divergente: " + exemplo);

console.log("\n3) o silêncio de domingo (o caso dele, 11/10/2026)");
const h = (txt) => new Date(txt + "-03:00").getTime();
eq("   painel: 13h23 -> 14h52 dá zero", PAINEL.minAbertos(h("2026-10-11T13:23"), h("2026-10-11T14:52")), 0);
eq("   função: idem", FUNCAO.minAbertos(h("2026-10-11T13:23"), h("2026-10-11T14:52")), 0);
eq("   painel: 13h23 -> segunda 7h10 dá 40", PAINEL.minAbertos(h("2026-10-11T13:23"), h("2026-10-12T07:10")), 40);
eq("   função: idem", FUNCAO.minAbertos(h("2026-10-11T13:23"), h("2026-10-12T07:10")), 40);

console.log("\n4) o vigia da nuvem tem as travas que o impedem de virar barulho");
eq("   não inventa alarme sem carimbo", /sem carimbo para comparar/.test(TS), true);
eq("   espera a folga antes de falar", /if \(idadeAberta < SEM_BATIMENTO\)/.test(TS), true);
eq("   não repete o mesmo aviso em menos de 2 horas", /ESPERA_REPETIR_MIN = 120/.test(TS), true);
eq("   mas um silêncio NOVO fura a carência", /mesmoSilencio/.test(TS), true);
eq("   tem ensaio que não manda e-mail", /const seco = b\.seco === true/.test(TS), true);
eq("   e só anota depois de mandar de verdade", /if \(!seco\) \{\s*await sb\("robo_vigia/.test(TS), true);
eq("   o e-mail diz que boleto não sai (é o prejuízo dele)", /NENHUM boleto novo é gerado/.test(TS), true);

console.log("\n" + ok + " OK, " + falhou + " falha(s).");
process.exitCode = falhou ? 1 : 0;
