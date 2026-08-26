// TRAVA: a janela do mes em andamento tem que terminar no ULTIMO DIA DE VERDADE.
//
// O erro que este teste existe pra impedir (achado em 26/08/2026, cinco dias antes de
// setembro): vsFimMes grudava "-31" em qualquer mes. Em fevereiro, abril, junho, setembro
// e novembro isso monta uma data que nao existe ("2026-09-31"), o Postgres recusa a
// consulta INTEIRA com HTTP 400, e o codigo trocava o erro por lista vazia em silencio.
// Resultado: em cinco dos doze meses a parte AO VIVO sumia da tela e ninguem sabia por que.
// Provado contra o Supabase de verdade: agosto HTTP 200 com 741 linhas, setembro e
// fevereiro HTTP 400 "date/time field value out of range".
//
//   node scripts/testes/vendasetor-fim-do-mes.test.cjs
const fs = require("fs");
const path = require("path");
const HTML = fs.readFileSync(path.join(__dirname, "..", "..", "output", "index.html"), "utf8");

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + obtido + (bate ? "" : "   (esperado: " + esperado + ")"));
  bate ? ok++ : falhou++;
}

// nunca mais o literal "-31" grudado no fim do mes
eq("nao existe mais o -31 grudado", /vsHojeISO\.slice\(5,7\)\+"-31"/.test(HTML), false);

// pega as duas funcoes do painel gerado e roda de verdade
const pega = (nome) => {
  const i = HTML.indexOf("function " + nome + "(");
  if (i < 0) return null;
  let n = 0, fim = -1;
  for (let k = HTML.indexOf("{", i); k < HTML.length; k++) {
    if (HTML[k] === "{") n++;
    else if (HTML[k] === "}") { n--; if (!n) { fim = k + 1; break; } }
  }
  return fim < 0 ? null : HTML.slice(i, fim);
};
const fIni = pega("vsIniMes"), fFim = pega("vsFimMes");
eq("achei vsIniMes no painel", !!fIni, true);
eq("achei vsFimMes no painel", !!fFim, true);

const monta = (hoje) => new Function("hojeISO",
  "var vsHojeISO=hojeISO;" + fIni + fFim + "return {ini:vsIniMes, fim:vsFimMes};")(hoje);

const DIAS = { 1:31, 2:28, 3:31, 4:30, 5:31, 6:30, 7:31, 8:31, 9:30, 10:31, 11:30, 12:31 };
for (let m = 1; m <= 12; m++) {
  const mm = String(m).padStart(2, "0");
  const M = monta("2026-" + mm + "-10");
  eq("2026-" + mm + " termina no dia certo", M.fim(0), "2026-" + mm + "-" + DIAS[m]);
  eq("2026-" + mm + " comeca no dia 1",      M.ini(0), "2026-" + mm + "-01");
}

// ano bissexto: 2024 tem 29 de fevereiro, 2025 nao
eq("fevereiro/2024 (bissexto) vai ate 29", monta("2024-02-10").fim(0), "2024-02-29");
eq("fevereiro/2025 vai ate 28",            monta("2025-02-10").fim(0), "2025-02-28");
// o recuo de 1 ano tem que respeitar o ano DE TRAS
eq("de 2025-02 pro ano anterior: 2024 tem 29", monta("2025-02-10").fim(1), "2024-02-29");
eq("de 2026-02 pro ano anterior: 2025 tem 28", monta("2026-02-10").fim(1), "2025-02-28");
// dia com dois digitos, sem quebrar o formato
eq("mes de 1 digito sai com zero na frente", monta("2026-09-10").fim(0), "2026-09-30");

// e o erro nao pode mais ser engolido
eq("a tela guarda o erro do dia a dia", /vsErroDia\s*=/.test(HTML), true);
eq("e nao esconde mais num ?: mudo", /vsDias=\(d&&!d\.error&&d\.data\)\?d\.data:\[\]/.test(HTML), false);

console.log("\n" + ok + " ok, " + falhou + " falha(s).");
process.exit(falhou ? 1 : 0);
