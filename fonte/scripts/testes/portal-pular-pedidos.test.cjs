// A ETAPA "PEDIDOS" SÓ APARECE QUANDO HÁ O QUE DECIDIR.
//
// Pedido do dono em 22/08/2026, testando o portal:
//
//   "quando eu vincular na primeira tela e der arquivo vinculado, e eu apertar continuar,
//    eu não cair nessa tela de pedidos, já que está vinculado eu não tenho que ajustar.
//    Só cair nessa tela se acontecer de dar divergência."
//
// Ele tem razão: com a nota já apontando o pedido e a conferência sem nenhum problema,
// aquela tela não pede decisão nenhuma — vira burocracia entre ele e o agendamento.
//
// Mas ela precisa aparecer sempre que houver algo para resolver OU saber. Este teste
// guarda cada uma dessas portas, porque pular uma delas seria esconder informação:
// pior do que uma tela a mais.
//
//   node scripts/testes/portal-pular-pedidos.test.cjs
const fs = require("fs");
const path = require("path");

const HTML = fs.readFileSync(path.join(__dirname, "..", "..", "output", "agendar.html"), "utf8");

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + obtido + (bate ? "" : "   (esperado: " + esperado + ")"));
  bate ? ok++ : falhou++;
}

console.log("\n=== Portal — a etapa Pedidos só quando há o que decidir ===\n");

// ------------------------------------------------------------ existe e é quem decide
{
  eq("1) existe a função que decide o destino", /function paraOndeDepoisDaNota\(cb\)\{/.test(HTML), "true");
  eq("2) e o Continuar da etapa 1 passa por ela",
     /paraOndeDepoisDaNota\(function\(destino\)\{\s*\n\s*checarCedo\(el\("wzAvanca"\), destino\);/.test(HTML), "true");
  eq("3) as travas da loja continuam sendo conferidas antes de avançar",
     HTML.indexOf('checarCedo(el("wzAvanca"), destino)') >= 0, "true");
}

// ------------------------------------------------------------ as portas que OBRIGAM a parar
{
  eq("4) sem nota fiscal, para (é ali que ele escolhe o pedido)",
     /if\(!wz\.comNota\) return cb\("pedidos"\);/.test(HTML), "true");
  eq("5) nota sem vínculo, para (só ele sabe a que pedido se refere)",
     /for\(var i=0;i<wz\.chaves\.length;i\+\+\)\{ if\(!wz\.chaves\[i\]\.vinc\) return cb\("pedidos"\); \}/.test(HTML), "true");
  eq("6) nota apontando outro pedido, para (o aviso mora naquela tela)",
     /if\(avisosDoPedido\(\)\) return cb\("pedidos"\);/.test(HTML), "true");
  eq("7) sem o que conferir, para", /if\(!its\.length \|\| !peds\.length\) return cb\("pedidos"\);/.test(HTML), "true");
  eq("8) a conferência achou problema, para", /if\(\(rs\.problemas\|\|0\) > 0\) return cb\("pedidos"\);/.test(HTML), "true");
}

// ------------------------------------------------------------ na dúvida, mostra
{
  // pular por causa de um erro de rede seria esconder divergência real
  eq("9) erro ao conferir leva pra tela, não pula",
     /if\(r\.error \|\| !v\.ok \|\| !v\.conferido\) return cb\("pedidos"\);/.test(HTML), "true");
  eq("10) e falha de rede também", /\}, function\(\)\{ cb\("pedidos"\); \}\);/.test(HTML), "true");
}

// ------------------------------------------------------------ quando pula, avisa
{
  // sumir em silêncio faria parecer que a etapa não existe, e no dia em que ela
  // aparecesse ele estranharia
  eq("11) ao pular, conta o que foi conferido", /uiToast\("Nota confere"\+qs\+" · "/.test(HTML), "true");
  eq("12) dizendo com qual pedido", HTML.indexOf('" com o pedido "+wz.chaves[0].vinc') >= 0, "true");
  eq("13) e guarda a conferência, caso ele volte", /wz\.conf=v;\s*\/\/ aproveito, se ele voltar/.test(HTML), "true");
}

// ------------------------------------------------------------ a etapa continua alcançável
{
  // pular não pode virar esconder: o Voltar da etapa Documentos leva de volta a ela
  eq("14) o Voltar dos Documentos ainda leva à etapa Pedidos",
     /wz\.etapa = \(wz\.pedidosLista && wz\.pedidosLista\.length\) \? "pedidos" : "nf";/.test(HTML), "true");
  eq("15) e quem não tem pedido nenhum continua indo direto pros documentos",
     /if\(!wz\.pedidosLista \|\| !wz\.pedidosLista\.length\) return cb\("docs"\);/.test(HTML), "true");
}

console.log("\n" + (falhou ? "FALHOU: " + falhou + " de " + (ok + falhou) : "TUDO OK: " + ok + " testes") + "\n");
process.exit(falhou ? 1 : 0);
