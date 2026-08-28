// PAGAMENTO MARCADO NA MÃO — o mês que foi pago FORA do banco.
//
// Pedido dele em 28/08/2026: cadastrou um ponto extra novo e o calendário nasceu em julho,
// mês que já tinha sido pago. Não havia como registrar isso: o botão "Marcar pago" tinha
// sido tirado quando o Sicredi entrou, com a regra "quem confirma o pagamento é o banco".
// A regra continua certa para o que PASSA pelo banco. Isto é para o que não passou.
//
//   node scripts/testes/pagamento-manual.test.cjs
const fs = require("fs");
const path = require("path");
const HTML = fs.readFileSync(path.join(__dirname, "..", "..", "output", "index.html"), "utf8");

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + obtido + (bate ? "" : "   (esperado: " + esperado + ")"));
  bate ? ok++ : falhou++;
}

// os leitores de estado, extraídos do painel gerado
const M = new Function(
  (HTML.match(/function pxManSt\(man\)\{[\s\S]*?\n\}/) || [""])[0] + "\n" +
  (HTML.match(/function pxManBonif\(man\)\{[^\n]*\}/) || [""])[0] + "\n" +
  (HTML.match(/function pxManManual\(man\)\{[^\n]*\}/) || [""])[0] + "\n" +
  (HTML.match(/function pxManMotivo\(man\)\{[\s\S]*?\n\}/) || [""])[0] + "\n" +
  "return {pxManSt,pxManBonif,pxManManual,pxManMotivo};")();

const MANUAL = { t:"manual", st:"autorizado", motivo:"", quem:"Victor", quando:"2026-08-28T12:00:00.000Z" };
const BONIF  = { t:"bonif",  st:"pendente", tot:0 };

console.log("1) o formato novo não atrapalha os antigos");
eq("   texto 'autorizado' continua lido", M.pxManSt("autorizado"), "autorizado");
eq("   texto 'pendente' continua lido", M.pxManSt("pendente"), "pendente");
eq("   manual devolve o estado dele", M.pxManSt(MANUAL), "autorizado");
eq("   bonificação devolve o estado dela", M.pxManSt(BONIF), "pendente");
eq("   manual NÃO é confundido com bonificação", M.pxManBonif(MANUAL), false);
eq("   bonificação continua sendo bonificação", M.pxManBonif(BONIF), true);
eq("   texto puro não é bonificação", M.pxManBonif("autorizado"), false);
eq("   texto puro não é manual", M.pxManManual("autorizado"), false);
eq("   bonificação não é manual", M.pxManManual(BONIF), false);
eq("   nulo não quebra nada", M.pxManBonif(null) || M.pxManManual(null) || M.pxManSt(null), "");

console.log("\n2) quem marcou e quando ficam gravados sozinhos");
// Ele pediu em 28/08 que NÃO precisasse digitar motivo: como só o master vê o botão, o clique
// dele já é a autorização. Mas quem e quando continuam sendo gravados sem custo nenhum pra ele.
eq("   diz quem marcou", /Victor/.test(M.pxManMotivo(MANUAL)), true);
eq("   e a data", /28\/08\/2026/.test(M.pxManMotivo(MANUAL)), true);
eq("   sem motivo digitado não fica frase solta", /^Victor em /.test(M.pxManMotivo(MANUAL)), true);
eq("   se um dia vier motivo, ele aparece na frente",
   /^pago em dinheiro — Victor/.test(M.pxManMotivo({ ...MANUAL, motivo:"pago em dinheiro" })), true);
eq("   bonificação não tem motivo manual", M.pxManMotivo(BONIF), "");
eq("   escapa caractere perigoso", /[<>"]/.test(M.pxManMotivo({ t:"manual", motivo:'<script>"x"', quem:'<b>' })), false);

console.log("\n3) as travas no painel");
eq("   o botão Marcar pago é DESENHADO", /data-marcarpago="'\+ref\+'"/.test(HTML), true);
// A TRAVA QUE ELE PEDIU: só o master vê. Dizer que entrou dinheiro sem o banco ter confirmado
// não pode ficar ao alcance de quem só cuida dos pontos.
eq("   SÓ o master vê o botão",
   /const btMarcar = \(window\.__PERFIL && window\.__PERFIL\.is_master\)/.test(HTML), true);
eq("   e some para quem não é master", /\n\s*: '';/.test(HTML), true);
eq("   um clique só, sem digitar motivo", /Marcar esta parcela como paga\?/.test(HTML), true);
eq("   e já nasce autorizado", /st:"autorizado", motivo:"",/.test(HTML), true);
eq("   não pede mais para digitar", /Por que está marcando como paga\?/.test(HTML), false);
eq("   avisa quando o boleto continua vivo no banco", /O boleto continua aberto no banco/.test(HTML), true);
eq("   e só considera vivo o que está de pé",
   /cobV\.status==="gerado"\|\|cobV\.status==="pedido"\|\|cobV\.status==="gerando"/.test(HTML), true);
// ESTA É A TRAVA QUE IMPORTA: autorizar não pode apagar o motivo trocando o objeto por texto.
eq("   autorizar PRESERVA o motivo", /pxManManual\(mAnt\)\s*\?\s*Object\.assign\(\{\}, mAnt, \{st:"autorizado"/.test(HTML), true);
eq("   quem marcou fica registrado", /quem:\(window\.__PERFIL&&window\.__PERFIL\.nome\)\|\|window\.__EMAIL\|\|"",/.test(HTML), true);
eq("   e a data também", /quando:new Date\(\)\.toISOString\(\)/.test(HTML), true);
eq("   o caminho da bonificação continua exigindo a senha master",
   /pxExigeMaster\("Digite a senha master para AUTORIZAR este pagamento\."\)/.test(HTML), true);
eq("   manuais vai pra nuvem (o motivo vai de carona)", /manuais:p\.manuais\|\|null/.test(HTML), true);

console.log("\n" + ok + " ok, " + falhou + " falha(s).");
process.exit(falhou ? 1 : 0);
