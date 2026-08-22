// Testes do PEDIDO E AUTORIZAÇÃO do recibo de pagamento comum.
//
// Pedido do dono em 20/08/2026. A primeira tentativa foi pedir a senha do master na hora de
// imprimir; ele achou o furo na mesma hora: "ela tem que colocar a senha master, sendo que
// ela não tem a senha master". Agora ela PEDE e ele AUTORIZA do login dele.
//
// O que estes testes protegem: quem pode decidir, quem pode imprimir, e que a autorização
// vale para AQUELE recibo, UMA vez.
//   node scripts/testes/recibo-autorizacao.test.cjs
const fs = require("fs");
const path = require("path");

const HTML = fs.readFileSync(path.join(__dirname, "..", "..", "output", "index.html"), "utf8");
const ini = HTML.indexOf("==RCB-INICIO==");
const fim = HTML.indexOf("==RCB-FIM==");
if (ini < 0 || fim < 0) { console.log("ERRO: não achei o módulo RCB (rode o build antes)."); process.exit(1); }
const codigo = HTML.slice(HTML.indexOf("*/", ini) + 2, HTML.lastIndexOf("/*", fim));
const M = new Function(codigo +
  "\nreturn {rcbAutStatusTxt,rcbAutPodeImprimir,rcbAutPodeDecidir,rcbAutPodeCancelar," +
  "rcbAutResumo,rcbAutTotal};")();

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + obtido +
              (bate ? "" : "   (esperado: " + esperado + ")"));
  bate ? ok++ : falhou++;
}

const DONO = "dono-1", ELA = "josefa-1", OUTRA = "maria-2";
const ped = (extra) => Object.assign({ id:"r1", status:"pendente", data:"2026-08-20",
  valor:150, quantidade:2, motivo:"Ajuda de custo", pedido_por:ELA,
  pedido_por_nome:"Josefa da Silva" }, extra||{});

console.log("\n-- O QUE AINDA ESPERA DECISAO --");
{
  /* O botão de autorizar aparece na tela de QUEM PEDIU: o dono vai até lá e digita a
     senha. Quem prova que é ele não é o login, é a SENHA — conferida no banco pela
     rcb_autorizar, com trava de 10 erros em 15 minutos. Esta função aqui só diz se o
     pedido ainda está de pé. */
  eq("pendente ainda espera",   M.rcbAutPodeDecidir(ped()), true);
  /* Decisão acontece uma vez: o que já foi decidido não volta para a fila. */
  eq("autorizado nao volta",    M.rcbAutPodeDecidir(ped({status:"autorizado"})), false);
  eq("recusado nao volta",      M.rcbAutPodeDecidir(ped({status:"recusado"})), false);
  eq("impresso nao volta",      M.rcbAutPodeDecidir(ped({status:"impresso"})), false);
  eq("cancelado nao volta",     M.rcbAutPodeDecidir(ped({status:"cancelado"})), false);
  eq("nada nao quebra",         M.rcbAutPodeDecidir(null), false);
}

console.log("\n-- QUEM PODE IMPRIMIR, E QUANTAS VEZES --");
{
  const aut = ped({ status:"autorizado" });
  eq("ela imprime o que foi autorizado",   M.rcbAutPodeImprimir(aut, ELA), true);
  /* "Uma vez" foi decisão dele: cada papel que sai teve uma autorização. Depois de
     impresso o registro muda de estado e o botão some. */
  eq("depois de impresso nao imprime mais",M.rcbAutPodeImprimir(ped({status:"impresso"}), ELA), false);
  eq("pendente ainda nao imprime",         M.rcbAutPodeImprimir(ped(), ELA), false);
  eq("recusado nao imprime",               M.rcbAutPodeImprimir(ped({status:"recusado"}), ELA), false);
  /* O recibo é de quem pediu. Outra pessoa não leva o papel autorizado para ela. */
  eq("outra funcionaria nao imprime",      M.rcbAutPodeImprimir(aut, OUTRA), false);
  eq("sem login nao imprime",              M.rcbAutPodeImprimir(aut, ""), false);
}

console.log("\n-- DESISTIR DO PROPRIO PEDIDO --");
{
  eq("ela desiste enquanto esta esperando", M.rcbAutPodeCancelar(ped(), ELA), true);
  eq("outra nao desiste pelo dela",         M.rcbAutPodeCancelar(ped(), OUTRA), false);
  /* Depois de autorizado não dá para desistir: o dono já decidiu, e sumir com o registro
     apagaria o rastro da decisão dele. */
  eq("autorizado nao se desiste",           M.rcbAutPodeCancelar(ped({status:"autorizado"}), ELA), false);
}

console.log("\n-- O QUE O DONO LE ANTES DE LIBERAR --");
{
  /* É esta frase que ele lê antes de liberar dinheiro. Tem que dizer quanto, por quê. */
  eq("2 recibos com total", M.rcbAutResumo(ped()),
     "2 recibos de R$ 150,00 · total R$ 300,00 · Ajuda de custo");
  /* Um recibo só não mostra "total" repetido — seria a mesma quantia duas vezes. */
  eq("1 recibo nao repete o total", M.rcbAutResumo(ped({quantidade:1})),
     "1 recibo de R$ 150,00 · Ajuda de custo");
  eq("nada nao quebra", M.rcbAutResumo(null), "");
}

console.log("\n-- O TOTAL --");
{
  eq("2 x 150",            M.rcbAutTotal(ped()), 300);
  eq("1 x 150",            M.rcbAutTotal(ped({quantidade:1})), 150);
  /* Centavos não podem virar dízima: 3 × 33,33 é 99,99, não 99,99000000000001. */
  eq("centavos redondos",  M.rcbAutTotal(ped({valor:33.33, quantidade:3})), 99.99);
  eq("quantidade torta vira 1", M.rcbAutTotal(ped({quantidade:0})), 150);
  eq("nada nao quebra",    M.rcbAutTotal(null), 0);
}

console.log("\n-- COMO CADA SITUACAO APARECE ESCRITA --");
{
  eq("pendente",   M.rcbAutStatusTxt("pendente"),   "Esperando autorização");
  eq("autorizado", M.rcbAutStatusTxt("autorizado"), "Autorizado — pode imprimir");
  eq("recusado",   M.rcbAutStatusTxt("recusado"),   "Recusado");
  eq("impresso",   M.rcbAutStatusTxt("impresso"),   "Já impresso");
  eq("cancelado",  M.rcbAutStatusTxt("cancelado"),  "Cancelado");
}

console.log("");
console.log(falhou ? ("FALHOU: " + falhou + " de " + (ok + falhou)) : ("TUDO OK: " + ok + " testes"));
process.exit(falhou ? 1 : 0);
