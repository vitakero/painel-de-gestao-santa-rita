// O ESPELHO NÃO PODE PERDER COLUNA NO CAMINHO.
//
// O dono achou olhando o comprovante do primeiro agendamento de verdade, em 22/08/2026:
// metade dos campos dizia "não informado" — tipo de carga, tipo de volume, motorista,
// telefone, tipo de caminhão, placa — e a duração aparecia 60 quando ele pediu 30.
//
// Ele tinha preenchido tudo, e o dado chegou: na tabela de origem estava
// "Seca", "Paletizada", "Van / Furgão", placa, motorista, telefone, minutos 30.
//
// O agendamento nasce em entregas_agendamento e um gatilho copia para receb_agendas,
// que é de onde o comprovante lê. O gatilho copiava ONZE colunas a menos.
//
// A CULPA FOI MINHA, do dia anterior: ao escrever o receb_c30 eu reconstruí o espelho a
// partir de uma versão antiga em vez de continuar da que estava no ar. É o mesmo erro
// que a revisão adversarial pegou no receb_c31 — só que este já estava em produção.
//
// A pior das onze é transportadora_cnpj: ela JÁ tinha sido consertada uma vez, com o
// comentário "sem isto, a loja esperava o caminhão do fornecedor e chegava outro".
// Eu a apaguei de volta sem perceber.
//
//   node scripts/testes/espelho-completo.test.cjs
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..", "..");
const ARQ = fs.readFileSync(path.join(RAIZ, "sql", "receb_c35_espelho_completo.sql"), "utf8");
const SQL = ARQ.split("\n").filter(function (l) { return l.trim().indexOf("--") !== 0; }).join("\n");
const C13 = fs.readFileSync(path.join(RAIZ, "sql", "receb_c13_cobranca_descarga.sql"), "utf8");
const C30 = fs.readFileSync(path.join(RAIZ, "sql", "receb_c30_recusa_de_quem.sql"), "utf8");

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + obtido + (bate ? "" : "   (esperado: " + esperado + ")"));
  bate ? ok++ : falhou++;
}

console.log("\n=== O espelho entre as duas tabelas ===\n");

// ------------------------------------------------------------ as onze colunas voltaram
{
  const PERDIDAS = ["transportadora_cnpj", "tipo_carga", "tipo_volume", "qtd_volumes",
                    "tipo_veiculo", "placa", "motorista", "motorista_fone",
                    "peso_kg", "cobranca_total", "cobranca"];
  let faltam = PERDIDAS.filter(function (c) { return SQL.indexOf("new." + c) < 0; });
  eq("1) as 11 colunas perdidas voltaram" + (faltam.length ? " — falta " + faltam.join(", ") : ""),
     faltam.length, 0);
  // e no UPDATE também, senão um espelho posterior deixaria tudo nulo de novo
  let semUpd = PERDIDAS.filter(function (c) { return !new RegExp(c + "\\s*=\\s*coalesce\\(new\\." + c).test(SQL); });
  eq("2) e também no ramo de atualização" + (semUpd.length ? " — falta " + semUpd.join(", ") : ""),
     semUpd.length, 0);
}

// ------------------------------------------------------------ a duração deixou de ser cravada
{
  eq("3) sumiu o 60 minutos cravado", /interval '60 minutes'/.test(SQL), "false");
  eq("4) a duração vem do que o fornecedor pediu",
     /v_min := least\(greatest\(coalesce\(new\.minutos, 60\), 15\), 480\);/.test(SQL), "true");
  // a janela reserva a doca: com 60 fixo, tirava do ar meia hora livre de quem pediu 30
  eq("5) e a janela da doca usa essa duração",
     /make_interval\(mins => v_min\)/.test(SQL), "true");
}

// ------------------------------------------------------------ partiu do que está no ar
{
  eq("6) o corpo veio do c30, não de versão antiga", /new\.motivo/.test(SQL) && C30.indexOf("new.motivo") >= 0, "true");
  eq("7) e o c13 é quem tinha as colunas que voltaram", C13.indexOf("new.motorista_fone") >= 0, "true");
  eq("8) a recusa com culpa declarada continua inteira", /motivo\s*=\s*coalesce\(nullif\(trim\(coalesce\(new\.motivo/.test(SQL), "true");
}

// ------------------------------------------------------------ conserta o que já existe
{
  // o espelho só roda quando a linha muda; as que já existem não mudam sozinhas
  eq("9) conserta os agendamentos já gravados", /update public\.receb_agendas a set/.test(SQL), "true");
  eq("10) só preenche o que está vazio do lado novo",
     /tipo_carga\s*=\s*coalesce\(a\.tipo_carga,\s*e\.tipo_carga\)/.test(SQL), "true");
  eq("11) e refaz a janela com a duração certa",
     /lower\(a\.janela\) \+ make_interval\(mins => e\.minutos\)/.test(SQL), "true");
}

// ------------------------------------------------------------ o silêncio fica registrado
{
  // o espelho engole qualquer erro; é a razão de um defeito de um dia não fazer barulho
  eq("12) o arquivo registra que o espelho engole erro",
     ARQ.indexOf("exception when others then null") >= 0, "true");
  eq("13) e diz que isso é decisão à parte",
     ARQ.indexOf("mexer nisso é decisão à parte") >= 0, "true");
}

console.log("\n" + (falhou ? "FALHOU: " + falhou + " de " + (ok + falhou) : "TUDO OK: " + ok + " testes") + "\n");
process.exit(falhou ? 1 : 0);
