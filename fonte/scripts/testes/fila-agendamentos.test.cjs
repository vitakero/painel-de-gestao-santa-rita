// A FILA DE PEDIDOS DE FORNECEDOR NÃO PODE VIRAR UMA PAREDE.
//
// O dono estranhou em 22/08/2026, olhando a Central com UM pedido e imaginando a tela
// com muitos: "se tiver muitos agendamentos a tela vai ficar muito grande".
//
// Ele tem razão e não é hipótese: a liberação vai ser de 5 fornecedores por vez, e cada
// um pode ter vários pedidos aguardando. Cada pedido é um cartão alto; com quinze, o
// bloco empurra a Visão de hoje, os atrasados e os horários livres para fora da tela —
// justo o que a página existe para mostrar de relance.
//
// POR QUE A FILA FICOU NA CENTRAL, E NÃO NUM MENU SÓ DELA
//
// Pedido que ninguém responde EXPIRA SOZINHO (ent_expirar_pendentes mata pendente cujo
// horário passou). Não depende de ninguém clicar: o horário passa, o pedido morre, e o
// fornecedor fica sem entrega marcada. Esquecer de responder tem consequência automática,
// e ela cai em cima de quem está do outro lado.
//
// Menu separado organiza e faz esquecer. Por isso a fila ficou onde a pessoa já entra
// todo dia, com teto, E o número foi para o menu lateral — visível de qualquer página.
//
//   node scripts/testes/fila-agendamentos.test.cjs
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..", "..");
const H = fs.readFileSync(path.join(RAIZ, "output", "index.html"), "utf8");

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + obtido + (bate ? "" : "   (esperado: " + esperado + ")"));
  bate ? ok++ : falhou++;
}

console.log("\n=== A fila de pedidos de fornecedor ===\n");

// ------------------------------------------------------------ a fila tem teto
{
  eq("1) a fila para de crescer", /\.cl-ped-lista\{[^}]*max-height:404px/.test(H), "true");
  eq("2) e rola por dentro", /\.cl-ped-lista\{[^}]*overflow-y:auto/.test(H), "true");
  // sem aviso visual ninguém sabe que tem mais embaixo — foi assim no portal
  eq("3) com barra sempre visível", /\.cl-ped-lista::-webkit-scrollbar\{width:9px;\}/.test(H), "true");
  eq("4) e sombra na borda quando há mais", /\.cl-ped-lista\{[^}]*radial-gradient/.test(H), "true");
}

// ------------------------------------------------------------ o urgente vem primeiro
{
  // com a fila rolando, o que fica embaixo é o que ninguém vê
  eq("5) quem passou da data vem primeiro",
     /var va=\(a\.data<hoje\)\?0:1, vb=\(b\.data<hoje\)\?0:1;/.test(H), "true");
  eq("6) e o resto em ordem de data e hora",
     /return String\(a\.data\+a\.hora\)\.localeCompare\(String\(b\.data\+b\.hora\)\);/.test(H), "true");
  // ordenar não pode mexer na lista original
  eq("7) ordena numa cópia, não na lista de verdade", /pend\.slice\(\)\.sort\(/.test(H), "true");
}

// ------------------------------------------------------------ o número no menu
{
  eq("8) o menu tem o contador", H.indexOf('id="clNavBadge"') >= 0, "true");
  eq("9) que conta só o que está pendente",
     /return p\.status==="pendente"; \}\)\.length;/.test(H), "true");
  eq("10) some quando não há nada esperando", /\{ b\.style\.display="none"; \}/.test(H), "true");
  eq("11) e se atualiza quando a lista chega", /clPedidos=\(r&&r\.data\)\|\|\[\];\s*\n\s*clAtualizaBadge\(\);/.test(H), "true");
}

// ------------------------------------------------------------ a fila saiu de cima
{
  // com teto ela ainda ocupava ~460px na frente da Visão de hoje, dos atrasados e dos
  // horários livres. O dono viu isso com UM pedido na tela e disse: "vai empurrar a
  // página para baixo". Foi para uma aba própria.
  eq("14) existe a aba A responder", /data-clview="responder">A responder/.test(H), "true");
  eq("15) a fila mora dentro dela", /<div id="clResponder" style="display:none;"><div id="clPedidos"><\/div><\/div>/.test(H), "true");
  eq("16) e não sobrou fila em cima", /<div id="clIntegBanner"><\/div>\s*<div id="clPedidos">/.test(H), "false");
  eq("17) o número aparece também na aba", H.indexOf('id="clTabQt"') >= 0, "true");
  // tirar da vista sem lembrete seria trocar estorvo por esquecimento
  eq("18) e continua no menu, porque pedido esquecido expira sozinho",
     H.indexOf('id="clNavBadge"') >= 0, "true");
}

// ------------------------------------------------------------ o que NÃO foi junto
{
  // marcar conferido é trabalho do dia; o lugar dele é a Visão de hoje
  eq("19) as entregas confirmadas ficaram na visão do dia",
     /<div id="clHoje">\s*<div id="clConfirmadas"><\/div>/.test(H), "true");
  eq("20) e são desenhadas na caixa delas", /if\(boxC\) boxC\.innerHTML=hC;/.test(H), "true");
}

// ------------------------------------------------------------ a aba não abre muda
{
  eq("21) sem nada esperando, a aba explica em vez de ficar vazia",
     H.indexOf("Nenhum pedido esperando resposta") >= 0, "true");
}

// ------------------------------------------------------------ aparece sem visitar a Central
{
  // se só carregasse ao abrir a Central, o número não serviria para lembrar de nada
  eq("12) carrega a contagem ao entrar no painel",
     /if\(typeof clPedidosLoad==="function"\) clPedidosLoad\(\);/.test(H), "true");
  eq("13) sem derrubar o login se falhar", /try\{ if\(typeof clPedidosLoad==="function"\)/.test(H), "true");
}

console.log("\n" + (falhou ? "FALHOU: " + falhou + " de " + (ok + falhou) : "TUDO OK: " + ok + " testes") + "\n");
process.exit(falhou ? 1 : 0);
