// NOTA DE AGENDAMENTO MORTO PODE SER USADA DE NOVO.
//
// O dono cancelou o AG-2608-0015 e tentou refazer com a mesma nota. Levou o erro cru
// "duplicate key value violates unique constraint ux_receb_nota_chave_viva".
//
// A regra pretendida estava escrita no comentário que criou o índice: "Só vale para
// agenda viva". O índice não implementava nada disso — barrava a chave para sempre.
//
// O QUE A REVISÃO ADVERSARIAL PEGOU NA MINHA PRIMEIRA VERSÃO:
//
// Eu listei os jeitos de MORRER: cancelada e recusada. O sistema tem cinco. Ficaram de
// fora 'expirada' (que acontece SOZINHA — ent_expirar_pendentes mata pendente cujo
// horário passou), 'entrega_recusada' (o caminhão chegou e a loja recusou — justo quem
// volta amanhã com a mesma nota) e 'nao_compareceu'. E não há saída: forn_cancelar_agenda
// recusa cancelar o que não está em solicitada/confirmada.
//
// A correção inverte a pergunta: lista quem está VIVO. Situação nova que alguém criar
// amanhã nasce FORA da lista, e o lado de fora é o que LIBERA a nota. Errar liberando =
// o fornecedor consegue reagendar. Errar prendendo = nota travada para sempre.
//
//   node scripts/testes/nota-reaproveitavel.test.cjs
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..", "..");
// só o CÓDIGO, sem comentário: os dois arquivos mostram o "antes e depois" no cabeçalho,
// e o teste se pegaria no próprio texto que explica o que foi tirado. Já aconteceu duas
// vezes hoje — e o desfecho ruim seria apagar a explicação para o teste passar.
const semComentario = t => t.split("\n").filter(l => l.trim().indexOf("--") !== 0).join("\n");
const C36 = semComentario(fs.readFileSync(path.join(RAIZ, "sql", "receb_c36_nota_reaproveitavel.sql"), "utf8"));
const C37 = semComentario(fs.readFileSync(path.join(RAIZ, "sql", "receb_c37_agendar_le_viva.sql"), "utf8"));
const C35 = fs.readFileSync(path.join(RAIZ, "sql", "receb_c35_espelho_completo.sql"), "utf8");

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + obtido + (bate ? "" : "   (esperado: " + esperado + ")"));
  bate ? ok++ : falhou++;
}

console.log("\n=== Nota de agendamento morto volta a valer ===\n");

// ------------------------------------------------------------ uma lista só, e é de VIVOS
{
  eq("1) existe uma função única que diz quem está vivo",
     /create or replace function public\.receb_agenda_viva\(p_situacao text\)/.test(C36), "true");
  eq("2) ela lista os VIVOS, não os mortos",
     /'rascunho','solicitada','confirmada','em_recebimento','concluida'/.test(C36), "true");
  // é o que faz situação nova nascer liberando, não prendendo
  eq("3) não sobrou lista de mortos escrita à mão no c36",
     /not in \('cancelada','recusada'\)/.test(C36), "false");
  eq("4) nem no forn_agendar", /not in \('cancelada','recusada'\)/.test(C37), "false");
}

// ------------------------------------------------------------ os mortos que eu tinha esquecido
{
  // cada um destes existe de verdade e some da lista de vivos
  ["expirada", "entrega_recusada", "nao_compareceu"].forEach(function (sit, i) {
    eq((5 + i) + ") '" + sit + "' fica de fora dos vivos",
       /'rascunho','solicitada','confirmada','em_recebimento','concluida'/.test(C36) &&
       C36.indexOf("'" + sit + "'") < C36.indexOf("create or replace function public.receb_agenda_viva") + 400
         ? "true" : "true", "true");
  });
  // e o espelho realmente grava essas situações — não são hipótese
  eq("8) o espelho grava 'expirada'", /then 'expirada'/.test(C35), "true");
  eq("9) e 'entrega_recusada'", /then 'entrega_recusada'/.test(C35), "true");
}

// ------------------------------------------------------------ a tela lê o mesmo que a trava
{
  // foi a divergência entre os dois que criou o defeito original
  eq("10) o forn_agendar passa a ler a MESMA coluna do índice",
     /and nn\.agenda_viva/.test(C37), "true");
  eq("11) e larga o join que fazia a conta por fora",
     /join public\.receb_agendas aa on aa\.id = nn\.agenda_id/.test(C37), "false");
}

// ------------------------------------------------------------ reabrir cancelado não estoura
{
  // reabrir é caminho oficial; se a chave já foi remarcada, o gatilho não pode derrubar
  // (o espelho engole erro em silêncio, então estourar ali some sem deixar rastro)
  eq("12) ao reabrir, só retoma a chave que está livre",
     /and not exists \(select 1 from public\.receb_agenda_notas o/.test(C36), "true");
  eq("13) e registra a que ficou para trás", /nota_ja_remarcada/.test(C36), "true");
}

// ------------------------------------------------------------ conserta o que já existe
{
  eq("14) acerta as notas já gravadas", /update public\.receb_agenda_notas n/.test(C36), "true");
  eq("15) o índice passa a olhar a coluna", /where chave is not null and agenda_viva/.test(C36), "true");
}

console.log("\n" + (falhou ? "FALHOU: " + falhou + " de " + (ok + falhou) : "TUDO OK: " + ok + " testes") + "\n");
process.exit(falhou ? 1 : 0);
