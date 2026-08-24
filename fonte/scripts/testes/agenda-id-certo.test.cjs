// O AGENDAMENTO PRECISA USAR O ID DA TABELA CERTA.
//
// O dono achou testando em 22/08/2026: preencheu o agendamento inteiro, apertou "Pedir
// este horário" e levou a mensagem crua do Postgres na cara:
//
//     insert or update on table "receb_agenda_pedidos" violates foreign key
//     constraint "receb_agenda_pedidos_agenda_id_fkey"
//
// forn_agendar grava em public.entregas_agendamento (a tabela antiga) e devolve o id
// DELA. O gatilho tg_receb_espelhar cria, na mesma transação, a agenda equivalente em
// public.receb_agendas — com OUTRO id, amarrada pelo origem_id. Duas linhas, duas
// tabelas, dois ids. A forn_agendar_portal usava um como se fosse o outro.
//
// Duas consequências, e a calada é pior que a barulhenta:
//   · o insert em receb_agenda_pedidos derrubava o agendamento inteiro;
//   · o update em receb_agenda_notas não achava linha, e o pedido vinculado à nota
//     NUNCA era gravado — a loja receberia o caminhão sem saber o que esperar.
//
// Não veio da mudança daquele dia: estava assim desde o receb_c27. Só não aparecia
// porque exige nota fiscal COM pedido vinculado, e os pedidos do VR só chegaram em 21/08.
//
//   node scripts/testes/agenda-id-certo.test.cjs
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..", "..");
const ARQ = fs.readFileSync(path.join(RAIZ, "sql", "receb_c33_agenda_id_certo.sql"), "utf8");
// o CORPO da função, sem a consulta de conferência do fim — senão o teste se pega:
// a própria conferência contém o texto "agenda_id = v_id" que ela procura.
const SQL = ARQ.slice(0, ARQ.indexOf("-- CONFERÊNCIA"));
const C32 = fs.readFileSync(path.join(RAIZ, "sql", "receb_c32_nota_varios_pedidos.sql"), "utf8");

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + obtido + (bate ? "" : "   (esperado: " + esperado + ")"));
  bate ? ok++ : falhou++;
}

console.log("\n=== O id da agenda ===\n");

// ------------------------------------------------------------ resolve antes de usar
{
  eq("1) procura a agenda pelo origem_id que o espelho grava",
     /where a\.origem = 'entregas_agendamento' and a\.origem_id = v_id;/.test(SQL), "true");
  eq("2) e guarda num nome diferente, pra não confundir os dois ids",
     /select a\.id into v_ag/.test(SQL), "true");
  // se um dia a agenda nascer direto em receb_agendas, o próprio id já serve
  eq("3) tem saída pro dia em que a tabela antiga sumir",
     /if v_ag is null then v_ag := v_id; end if;/.test(SQL), "true");
}

// ------------------------------------------------------------ nada mais usa o id errado
{
  eq("4) o insert do pedido usa o id certo", /select v_ag, left\(v_ped_nota, 40\)/.test(SQL), "true");
  eq("5) o update da nota também", /where agenda_id = v_ag/.test(SQL), "true");
  eq("6) e o completar-notas também", /receb_completar_notas\(v_ag\)/.test(SQL), "true");
  eq("7) não sobrou nenhum uso do id errado", /agenda_id = v_id\b/.test(SQL), "false");
  eq("8) nem no insert", /select v_id, left\(v_ped_nota/.test(SQL), "false");
}

// ------------------------------------------------------------ não desfez o de antes
{
  // este arquivo continua de onde o c32 parou — não pode apagar a nota com vários pedidos
  eq("9) a nota com vários pedidos continua inteira", /==VARIOS==/.test(SQL), "true");
  eq("10) lendo a lista pelo mesmo caminho", /public\.receb_pedidos_da_nota\(n\)/.test(SQL), "true");
  eq("11) e gravando a lista inteira", /pedidos_numeros = v_peds_nota/.test(SQL), "true");
  eq("12) o corpo veio do c32, não de versão antiga",
     C32.indexOf("==VARIOS== guardo TODOS os pedidos") >= 0 &&
     SQL.indexOf("==VARIOS== guardo TODOS os pedidos") >= 0, "true");
}

// ------------------------------------------------------------ o arquivo se confere
{
  eq("13) a consulta final cobra o id certo", ARQ.indexOf('as "resolve o id certo"') >= 0, "true");
  eq("14) e cobra que o id errado sumiu", ARQ.indexOf('as "nao sobrou id errado"') >= 0, "true");
  eq("15) diz que o defeito não veio da mudança do dia",
     ARQ.indexOf("NÃO VEIO DA MUDANÇA DE HOJE") >= 0, "true");
}

console.log("\n" + (falhou ? "FALHOU: " + falhou + " de " + (ok + falhou) : "TUDO OK: " + ok + " testes") + "\n");
process.exit(falhou ? 1 : 0);
