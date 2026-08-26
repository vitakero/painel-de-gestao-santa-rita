// TRAVA: mes pela metade NUNCA pode entrar como mes fechado.
//
// O erro que este teste existe pra impedir (26/08/2026): o robo pegava "os ultimos 3 anos"
// com uma janela ROLANTE (Date.now() - 3 anos). Como o VR guarda mais ou menos 3 anos, isso
// trouxe um agosto/2023 que comecava no dia 26 — 6 dias — e marcou esse mes como FECHADO.
// A tela entao comparou 6 dias de 2023 contra 31 dias de 2024 e mostrou um crescimento
// gigante que nao existe. Pior: a janela andava sozinha todo dia.
//
//   node scripts/testes/vendasetor-mes-inteiro.test.cjs
const fs = require("fs");
const path = require("path");

const ROBO = fs.readFileSync(path.join(__dirname, "..", "buildVrData.cjs"), "utf8");
let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + obtido + (bate ? "" : "   (esperado: " + esperado + ")"));
  bate ? ok++ : falhou++;
}

// ---------------------------------------------------------------------------
// 1) O piso tem que ser FIXO. Janela rolante volta a trazer mes pela metade.
// ---------------------------------------------------------------------------
const temRolante = /corte\s*=\s*new Date\(\s*Date\.now\(\)\s*-/.test(ROBO);
eq("nao usa janela rolante pro corte", temRolante, false);
eq("tem piso fixo ANO_PISO", /const\s+ANO_PISO\s*=\s*\d{4}/.test(ROBO), true);
const piso = (ROBO.match(/const\s+ANO_PISO\s*=\s*(\d{4})/) || [])[1];
eq("o piso vira uma data em 1o de janeiro", /PISO_DATA\s*=\s*ANO_PISO\s*\+\s*"-01-01"/.test(ROBO), true);
eq("o corte do dia a dia sai do piso", /const\s+corte\s*=\s*PISO_DATA\s*;/.test(ROBO), true);
// e nenhuma consulta pode ter sobrado com a janela rolante do jeito antigo
const rolantes = (ROBO.match(/CURRENT_DATE - INTERVAL '3 years'/g) || []).length;
eq("so a consulta de COMPRAS pode ter janela rolante (1)", rolantes, 1);
eq("o ranking por setor usa o piso", /mes >= '\$\{PISO_MES\}'/.test(ROBO), true);
eq("a venda por setor usa o piso", /v\.data >= '\$\{PISO_DATA\}'/.test(ROBO), true);
eq("piso e um ano plausivel", piso >= 2020 && piso <= 2030, true);

// ---------------------------------------------------------------------------
// 2) A marca "completo" tem que exigir que o mes caiba INTEIRO na janela.
//    Extraio a expressao do proprio codigo do robo e rodo casos contra ela.
// ---------------------------------------------------------------------------
const m = ROBO.match(/completo:\s*([^,]+),\s*origem:"robo"/);
eq("achei a regra do completo no robo", !!m, true);
const REGRA = m ? m[1].trim() : "false";
eq("a regra olha o inicio do mes contra o corte", /mesIni\s*>=\s*corte/.test(REGRA), true);

// roda a expressao de verdade, do jeito que ela esta escrita no robo
const decide = new Function("a", "m", "anoHj", "mesHj", "corte",
  'var mesIni=a+"-"+String(m).padStart(2,"0")+"-01"; return (' + REGRA + ");");

const CORTE = "2024-01-01", HOJE_A = 2026, HOJE_M = 8;
eq("janeiro/2024 (bate no piso) fecha", decide(2024, 1, HOJE_A, HOJE_M, CORTE), true);
eq("dezembro/2025 fecha", decide(2025, 12, HOJE_A, HOJE_M, CORTE), true);
eq("julho/2026 fecha", decide(2026, 7, HOJE_A, HOJE_M, CORTE), true);
eq("agosto/2026 (mes corrente) NAO fecha", decide(2026, 8, HOJE_A, HOJE_M, CORTE), false);
eq("dezembro/2023 (antes do piso) NAO fecha", decide(2023, 12, HOJE_A, HOJE_M, CORTE), false);
eq("agosto/2023 — o caso que quebrou — NAO fecha", decide(2023, 8, HOJE_A, HOJE_M, CORTE), false);

// e se um dia alguem puser um corte no MEIO do mes: esse mes nao pode fechar
const MEIO = "2024-03-15";
eq("corte no meio: marco/2024 NAO fecha", decide(2024, 3, HOJE_A, HOJE_M, MEIO), false);
eq("corte no meio: abril/2024 fecha", decide(2024, 4, HOJE_A, HOJE_M, MEIO), true);

// virada de ano: em janeiro, o mes corrente e janeiro e dezembro ja fechou
eq("em jan/2027, janeiro/2027 NAO fecha", decide(2027, 1, 2027, 1, CORTE), false);
eq("em jan/2027, dezembro/2026 fecha", decide(2026, 12, 2027, 1, CORTE), true);

console.log("\n" + ok + " ok, " + falhou + " falha(s).");
process.exit(falhou ? 1 : 0);
