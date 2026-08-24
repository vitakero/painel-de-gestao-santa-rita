// "MEUS AGENDAMENTOS" NUNCA ABRIU — nem com a agenda vazia.
//
// O dono bateu nisto duas vezes em 22/08/2026. Na primeira, a tela só dizia "Verifique
// sua internet" — e ele estranhou, com razão: a internet estava boa. Procurei no escuro
// e não achei. Troquei a mensagem para assumir a culpa e mostrar o código do erro; na
// segunda vez ela entregou o culpado:
//
//     42846 · cannot cast type record to receb_agendas
//
// forn_agenda_lista monta um "base" com a linha da agenda MAIS uma coluna "ord" para
// ordenar, e depois faz "b.*::public.receb_agendas". O registro tem uma coluna a mais
// que a tabela, e não cabe no tipo.
//
// E quebra SEMPRE, mesmo com zero agendamentos: o Postgres resolve o tipo ao montar o
// plano, não ao percorrer as linhas.
//
// A ARMADILHA QUE ME DESPISTOU, e que este teste também guarda: eu chamei a função com a
// chave de serviço, ela devolveu ok, e conclui que estava boa. Não estava — com a chave
// de serviço o forn_meu_id() é nulo e a função volta na PRIMEIRA linha, sem nunca
// alcançar a consulta quebrada. Conferência que não exercita o caminho não prova nada.
//
//   node scripts/testes/lista-agendamentos.test.cjs
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..", "..");
const ARQ = fs.readFileSync(path.join(RAIZ, "sql", "receb_c34_lista_agendamentos.sql"), "utf8");
// Só o CÓDIGO da função — sem a conferência do fim e sem os comentários. Os dois citam
// o texto quebrado de propósito: a conferência para cobrar que ele sumiu, o comentário
// para explicar o defeito. Sem esta limpeza o teste se pega sozinho, e eu ia acabar
// apagando a explicação para o teste passar — que é o pior desfecho possível.
const SQL = ARQ.slice(0, ARQ.indexOf("-- CONFERÊNCIA"))
  .split("\n").filter(function (l) { return l.trim().indexOf("--") !== 0; }).join("\n");

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + obtido + (bate ? "" : "   (esperado: " + esperado + ")"));
  bate ? ok++ : falhou++;
}

console.log("\n=== Meus agendamentos — a lista ===\n");

// ------------------------------------------------------------ o cast quebrado morreu
{
  eq("1) sumiu o cast do registro com coluna a mais",
     /b\.\*::public\.receb_agendas/.test(SQL), "false");
  eq("2) e a linha vem da tabela, pelo id",
     /join public\.receb_agendas a2 on a2\.id = b\.id/.test(SQL), "true");
  eq("3) passando a linha de verdade pro montador",
     /public\.receb_linha_agenda\(a2\.\*\)/.test(SQL), "true");
}

// ------------------------------------------------------------ a ordenação continua
{
  // o "ord" ainda serve pra ordenar; só não entra mais no que é convertido
  eq("4) continua ordenando pelo mais recente", /order by b\.ord desc/.test(SQL), "true");
  eq("5) e o base continua calculando o ord",
     /coalesce\(lower\(a\.janela\), a\.inicio_solicitado\) as ord/.test(SQL), "true");
  eq("6) a paginação não se perdeu", /limit v_lim offset v_pula/.test(SQL), "true");
}

// ------------------------------------------------------------ a conferência não mente
{
  // conferência que passa sem exercitar o caminho é pior que nenhuma — foi assim que eu
  // me enganei da primeira vez
  eq("7) o arquivo NÃO finge testar chamando a função",
     /jsonb_typeof\(public\.forn_agenda_lista/.test(ARQ), "false");
  eq("8) e explica por que não dá pra testar dali",
     ARQ.indexOf("forn_meu_id() e nulo e a funcao volta na primeira linha") >= 0, "true");
  eq("9) dizendo qual é a prova de verdade",
     ARQ.indexOf('abrir "Meus agendamentos" no') >= 0, "true");
}

// ------------------------------------------------------------ os cadeados
{
  eq("10) continua fechada pra anônimo",
     /revoke all on function public\.forn_agenda_lista\(jsonb\) from public, anon;/.test(ARQ), "true");
  eq("11) e aberta pra quem está logado",
     /grant\s+execute on function public\.forn_agenda_lista\(jsonb\) to authenticated;/.test(ARQ), "true");
}

console.log("\n" + (falhou ? "FALHOU: " + falhou + " de " + (ok + falhou) : "TUDO OK: " + ok + " testes") + "\n");
process.exit(falhou ? 1 : 0);
