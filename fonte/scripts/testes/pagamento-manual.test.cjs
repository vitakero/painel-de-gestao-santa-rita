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

const MANUAL = { t:"manual", st:"autorizado", motivo:"pago em dinheiro", quem:"Victor", quando:"2026-08-28T12:00:00.000Z" };
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
eq("   guarda o motivo", /pago em dinheiro/.test(M.pxManMotivo(MANUAL)), true);
eq("   diz quem marcou", /Victor/.test(M.pxManMotivo(MANUAL)), true);
eq("   e a data", /28\/08\/2026/.test(M.pxManMotivo(MANUAL)), true);
eq("   sem motivo digitado não fica frase solta", /^Victor em /.test(M.pxManMotivo({ ...MANUAL, motivo:"" })), true);
eq("   se um dia vier motivo, ele aparece na frente",
   /^pago em dinheiro — Victor/.test(M.pxManMotivo({ ...MANUAL, motivo:"pago em dinheiro" })), true);
eq("   bonificação não tem motivo manual", M.pxManMotivo(BONIF), "");
eq("   escapa caractere perigoso", /[<>"]/.test(M.pxManMotivo({ t:"manual", motivo:'<script>"x"', quem:'<b>' })), false);

console.log("\n3) o caminho: financeiro marca, master autoriza");
eq("   o botão Marcar pago é DESENHADO", /data-marcarpago="'\+ref\+'"/.test(HTML), true);
eq("   NÃO é mais só do master (o financeiro marca)",
   /const btMarcar = \(window\.__PERFIL && window\.__PERFIL\.is_master\)/.test(HTML), false);
eq("   abre a janela do marcar pago", /mpgAbrir\(p, kk\)/.test(HTML), true);
eq("   a janela pede o motivo", /Por que está sendo dada como paga\?/.test(HTML), true);
eq("   e pede o comprovante", /Comprovante do pagamento \(PDF ou foto\)/.test(HTML), true);
eq("   sem comprovante não envia", /Anexe o comprovante do pagamento\./.test(HTML), true);
eq("   nasce AGUARDANDO, não pago", /t:"manual", st:"pendente", motivo:mot\.slice\(0,140\)/.test(HTML), true);
eq("   guarda o comprovante junto", /p\.comprovantes\[kk\]=\{ arquivo:mpgArquivo\.arquivo/.test(HTML), true);

console.log("\n4) as travas que seguram o dinheiro");
// A MAIS IMPORTANTE: anexar comprovante NÃO pode quitar sozinho, senão o financeiro anexa e a
// parcela já vira paga — pulando a autorização, que é o ponto inteiro do desenho.
eq("   anexo NÃO quita sozinho (pula a autorização)",
   /if\(pxManManual\(man\) && man\.st!=="autorizado"\) return pixCobPaga\(p,key\);/.test(HTML), true);
eq("   autorizar exige a senha master",
   /autorizarMaster\("Autorizar este pagamento \(feito por fora do banco\) é ato do master/.test(HTML), true); // a senha REAL do master, conferida no banco (revisão de 03/09/2026)
eq("   e exige o comprovante anexado", /Para autorizar, o comprovante do pagamento precisa estar anexado/.test(HTML), true);
eq("   só autoriza o que está pendente", /if\(!pxManManual\(mA\) \|\| mA\.st!=="pendente"\)/.test(HTML), true);
eq("   guarda QUEM autorizou", /autorizado_por:\(window\.__PERFIL&&window\.__PERFIL\.nome\)/.test(HTML), true);
eq("   a prova de pagamento autorizado não se apaga", /Não dá para remover/.test(HTML), true);

console.log("\n5) o motivo é VISÍVEL — não escondido no passar-o-mouse");
// Ele reclamou disso em 28/08 com a linha na tela: "só consigo ver o comprovante e autorizar,
// mas não vejo o motivo de ter pago dessa forma". E como ele é master, o pxExigeMaster passa
// direto: sem a confirmação abaixo, o clique autorizava na hora, sem ele ler nada.
eq("   o motivo é escrito na linha que aguarda", /<span class="px-motivo" title=/.test(HTML), true);
eq("   e continua escrito depois de pago", (HTML.match(/<span class="px-motivo" title=/g) || []).length >= 2, true);
eq("   tem estilo próprio (não some no meio)", /\.px-motivo \{/.test(HTML), true);
// O DEFEITO QUE ELE VIU: o motivo entrou entre o selo e o ✕, e o ✕ caiu para a linha de baixo.
// O balão é inline-flex e vem DEPOIS dos botões — as duas coisas juntas seguram a linha.
eq("   o balão é inline (não empurra o ✕ pra baixo)", /\.px-motivo \{ display:inline-flex;/.test(HTML), true);
eq("   e vem DEPOIS do botão de desfazer",
   HTML.indexOf('data-desfazerpago="') < HTML.lastIndexOf('class="px-motivo"'), true);
eq("   o texto completo fica no title (quando o balão corta)", /title="'\+pxEsc\(man\.motivo\|\|""\)\+' — marcado por /.test(HTML), true);
eq("   e mostra o motivo ANTES de autorizar", /Autorizar este pagamento\?/.test(HTML), true);
eq("   com o motivo dentro da pergunta", /Motivo: "\+String\(manA\.motivo/.test(HTML), true);
eq("   avisando que o comprovante não poderá ser apagado",
   /depois ele não pode mais ser apagado/.test(HTML), true);
eq("   avisa quando o boleto continua vivo no banco", /O boleto continua aberto no banco/.test(HTML), true);
eq("   arquivo grande é recusado", /Arquivo muito grande \(máx 3 MB\)/.test(HTML), true);
eq("   manuais e comprovantes vão pra nuvem",
   /manuais:p\.manuais\|\|null,comprovantes:p\.comprovantes\|\|null/.test(HTML), true);

console.log("\n" + ok + " ok, " + falhou + " falha(s).");
process.exit(falhou ? 1 : 0);
