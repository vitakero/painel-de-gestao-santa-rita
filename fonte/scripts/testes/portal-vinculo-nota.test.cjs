// MARCAR E DESMARCAR O PEDIDO TEM QUE SER SIMÉTRICO.
//
// Defeito que o dono pegou testando em 22/08/2026: na etapa "Pedidos de compra" a
// caixinha do pedido 23102 estava marcada, a conferência dizia "Tudo bate com o pedido
// · 16 itens na nota · 16 conferem", e mesmo assim o Continuar batia numa parede:
// "Ainda não dá para agendar — A nota 118244 precisa estar vinculada a um pedido".
//
// Duas telas discordando, e ele sem saber onde clicar.
//
// A causa era uma assimetria minha: DESMARCAR o pedido solta o vínculo da nota (isso
// está certo — senão a tela diria uma coisa e o vínculo outra), mas MARCAR de novo só
// remarcava a caixinha e NÃO devolvia o vínculo. A nota ficava órfã com a caixinha
// verde. E o servidor, que confere o vínculo de CADA NOTA, recusava.
//
// Dois consertos, e este teste guarda os dois:
//   1. marcar desfaz o soltar — mas só da nota que foi solta POR AQUELE pedido
//   2. a etapa 2 avisa da nota solta ALI, com botão, em vez de deixar bater na parede
//
//   node scripts/testes/portal-vinculo-nota.test.cjs
const fs = require("fs");
const path = require("path");

const HTML = fs.readFileSync(path.join(__dirname, "..", "..", "output", "agendar.html"), "utf8");

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + obtido + (bate ? "" : "   (esperado: " + esperado + ")"));
  bate ? ok++ : falhou++;
}

console.log("\n=== Portal — vínculo da nota com o pedido ===\n");

// ------------------------------------------------------------ desmarcar guarda o que soltou
{
  eq("1) desmarcar guarda qual pedido soltou o vínculo",
     /wz\.chaves\[q\]\.vincSolto=n;/.test(HTML), "true");
  eq("2) e guarda se o vínculo era automático",
     /wz\.chaves\[q\]\.vincSoltoAuto=!!wz\.chaves\[q\]\.vincAuto;/.test(HTML), "true");
}

// ------------------------------------------------------------ marcar devolve
{
  eq("3) marcar devolve o vínculo que aquele pedido soltou",
     /if\(!wz\.chaves\[q\]\.vinc && String\(wz\.chaves\[q\]\.vincSolto\|\|""\)===n\)\{/.test(HTML), "true");
  // as duas condições importam: nota que ele vinculou a OUTRO pedido não pode ser
  // sequestrada, e nota que nunca teve vínculo não pode ganhar um por adivinhação
  eq("4) só se a nota está sem vínculo agora", HTML.indexOf("if(!wz.chaves[q].vinc &&") >= 0, "true");
  eq("5) e só se foi ESTE pedido que soltou", HTML.indexOf('.vincSolto||"")===n') >= 0, "true");
  eq("6) devolvendo também a marca de automático",
     /wz\.chaves\[q\]\.vincAuto=!!wz\.chaves\[q\]\.vincSoltoAuto;/.test(HTML), "true");
  eq("7) e limpando o guardado, pra não devolver duas vezes",
     /wz\.chaves\[q\]\.vincSolto="";/.test(HTML), "true");
}

// ------------------------------------------------------------ a etapa 2 avisa ali mesmo
{
  eq("8) existe o aviso de nota solta na etapa dos pedidos",
     /function avisoNotaSolta\(\)\{/.test(HTML), "true");
  eq("9) e ele é desenhado junto com a conferência",
     HTML.indexOf("avisoNotaSolta() + avisosDoPedido() + blocoConfronto()") >= 0, "true");
  eq("10) dizendo que marcar o pedido NÃO é vincular a nota",
     HTML.indexOf("Marcar o pedido acima não faz isso") >= 0, "true");
  eq("11) com botão pra resolver ali", HTML.indexOf('data-vinc2="') >= 0, "true");
  eq("12) que abre a mesma janela da etapa 1",
     /b\.onclick=function\(ev\)\{ ev\.preventDefault\(\); abrirEscolhaPedido\(\+b\.getAttribute\("data-vinc2"\)\); \};/.test(HTML), "true");
}

// ------------------------------------------------------------ resolveu, o aviso some
{
  // sem isto o aviso ficava na tela depois de resolvido e a conferência olhava o alvo velho
  eq("13) vincular repinta a conferência da etapa 2",
     /listarNotas\(\);\s*\n\s*pintarResumoLado\(\);[\s\S]{0,400}?conferirNota\(\);\s*\n\s*uiToast\("Nota "/.test(HTML), "true");
}

// ------------------------------------------------------------ nada disso some se não há como vincular
{
  // fornecedor sem pedido em aberto não pode ser preso por uma exigência impossível
  eq("14) sem lista de pedidos, não cobra vínculo",
     /if\(!wz\.pedidosLista \|\| !wz\.pedidosLista\.length\) return "";/.test(HTML), "true");
  eq("15) e sem nota também não", /if\(!wz \|\| !wz\.comNota\) return "";/.test(HTML), "true");
}

console.log("\n" + (falhou ? "FALHOU: " + falhou + " de " + (ok + falhou) : "TUDO OK: " + ok + " testes") + "\n");
process.exit(falhou ? 1 : 0);
