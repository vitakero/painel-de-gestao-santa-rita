// Teste da PORTA ANÔNIMA do agendamento.
//
// Nasceu de um erro meu, em 20/08/2026, quatro horas depois de eu mesmo escrever que
// "não afrouxa nada":
//
//   Em 14/08 o dono mandou FECHAR o agendamento anônimo. Qualquer pessoa na internet
//   pedia horário sem se identificar e, como o pedido nasce 'pendente' e o índice único
//   já reserva a janela nesse estado, dava para ocupar 60 dias de agenda em minutos.
//
//   Em 20/08 eu precisei REFAZER a ent_solicitar (para ela varrer os pendentes vencidos
//   antes de responder). Copiei a função do arquivo original — e junto veio a linha
//   "grant execute ... to anon, authenticated". A porta reabriu. O SQL rodou sem erro,
//   a conferência do meu próprio arquivo deu tudo certo, e ninguém teria percebido.
//
// A armadilha é essa: o "create or replace" PRESERVA as permissões sozinho. A linha de
// grant não precisava estar lá — e é justamente ela que desfaz, calada, uma decisão
// tomada em outro arquivo, em outro dia.
//
// Este teste lê quem foi fechado e não deixa NENHUM arquivo de SQL reabrir.
//   node scripts/testes/porta-anonima.test.cjs
const fs = require("fs");
const path = require("path");

const SQLDIR = path.join(__dirname, "..", "..", "sql");
const FECHOU = "agendamento_fechar_porta_anonima.sql";

let ok = 0, falhou = 0;
function t(nome, cond, extra) {
  if (cond) { ok++; return; }
  falhou++; console.log("  FALHOU: " + nome + (extra ? " -> " + extra : ""));
}

// ------------------------------------------------ quem foi fechado, lido do próprio arquivo
const fechar = fs.readFileSync(path.join(SQLDIR, FECHOU), "utf8");
const FECHADAS = [];
fechar.split("\n").forEach(function (l) {
  const m = l.match(/^\s*revoke\s+execute\s+on\s+function\s+public\.([a-z_0-9]+)\s*\(([^)]*)\)\s*from\s+([^;]+);/i);
  if (m && /\banon\b/i.test(m[3])) {
    FECHADAS.push({ nome: m[1], args: m[2].replace(/\s+/g, "") });
  }
});

console.log("portas fechadas em " + FECHOU + ": " + FECHADAS.length);
t("achei as portas fechadas", FECHADAS.length >= 3, "achei " + FECHADAS.length);

// Tirar do anon sem tirar do PUBLIC não fecha nada: no Postgres o PUBLIC é "todo mundo"
// e ganha EXECUTE automaticamente. Foi assim que a primeira tentativa, em 14/08, falhou.
FECHADAS.forEach(function (f) {
  const linha = fechar.split("\n").filter(function (l) {
    return l.indexOf("revoke") >= 0 && l.indexOf(f.nome) >= 0;
  })[0] || "";
  t("[" + f.nome + "] o revoke tira do PUBLIC, não só do anon", /\bpublic\b/i.test(linha),
    "tirar do anon com o PUBLIC aberto não fecha nada");
});

// --------------------------------------- NENHUM arquivo pode devolver essas ao anônimo
const arquivos = fs.readdirSync(SQLDIR).filter(function (f) { return f.endsWith(".sql"); });
console.log("arquivos de SQL conferidos: " + arquivos.length);

arquivos.forEach(function (arq) {
  const txt = fs.readFileSync(path.join(SQLDIR, arq), "utf8");
  txt.split("\n").forEach(function (l, i) {
    // só a linha de comando; comentário (-- ) fala sobre o assunto e não faz nada
    if (/^\s*--/.test(l)) return;
    const m = l.match(/^\s*grant\s+execute\s+on\s+function\s+public\.([a-z_0-9]+)\s*\(([^)]*)\)\s*to\s+([^;]+);/i);
    if (!m) return;
    if (!/\b(anon|public)\b/i.test(m[3])) return;
    const nome = m[1], args = m[2].replace(/\s+/g, "");
    const bateu = FECHADAS.filter(function (f) { return f.nome === nome && f.args === args; })[0];
    t("[" + arq + ":" + (i + 1) + "] não reabre " + nome, !bateu,
      "esta linha devolve ao anônimo uma porta fechada de propósito: " + l.trim());
  });
});

// ------------------------------------------------------- e o conserto tem que existir
const consertoArq = path.join(SQLDIR, "receb_c25_fechar_porta_de_novo.sql");
t("o conserto de 20/08 existe", fs.existsSync(consertoArq));
if (fs.existsSync(consertoArq)) {
  const c = fs.readFileSync(consertoArq, "utf8");
  FECHADAS.forEach(function (f) {
    t("o conserto fecha " + f.nome + "(" + f.args + ")",
      c.indexOf("revoke execute on function public." + f.nome) >= 0);
  });
  t("o conserto devolve a quem tem login", c.indexOf("to authenticated;") > 0);
}

// ------------------------------------------- e o arquivo que causou não pode ter o grant
const c24 = fs.readFileSync(path.join(SQLDIR, "receb_c24_doca_e_pendente.sql"), "utf8");
const linhasGrant = c24.split("\n").filter(function (l) {
  return !/^\s*--/.test(l) && /grant\s+execute/i.test(l) && /\banon\b/i.test(l);
});
t("o c24 não dá nada para anônimo", linhasGrant.length === 0, linhasGrant.join(" | "));

console.log(falhou ? ("FALHOU: " + falhou + " de " + (ok + falhou)) : ("TUDO OK: " + ok + " testes"));
process.exit(falhou ? 1 : 0);
