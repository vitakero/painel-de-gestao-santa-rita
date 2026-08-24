// A JANELA FICA PARADA E O CONTEÚDO ROLA POR DENTRO.
//
// O dono pediu isso em 22/08/2026, olhando os detalhes do agendamento: rolando a janela
// inteira, o ticket e a data — o que ele estava conferindo — saíam da tela.
//
// EU PUBLIQUEI UM CONSERTO QUE NÃO CONSERTAVA, DUAS VEZES.
//
// 1ª: escrevi o CSS com "filho direto" (.mcaixa.alto > .det-corpo). Só que o uiModal
//     monta .mcaixa > .mcab + <corpo>, e a janela de detalhes passa como corpo um
//     <div id="detCorpo">. O seletor não atravessa esse invólucro, então a altura nunca
//     chegava ao conteúdo: nada rolava e a caixa só cortava.
//
// 2ª: não vi o erro porque montei a prévia À MÃO, sem o invólucro. Rolava na prévia e
//     travava no portal. Prévia que não reproduz a estrutura de verdade não prova nada —
//     e eu ainda disse ao dono que "a rolagem já funcionava", com medida e tudo.
//
// Entre uma e outra ele testou e disse "ainda está parado, não consigo mexer". Foi ele
// que derrubou minha medição errada.
//
//   node scripts/testes/janela-rola-dentro.test.cjs
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..", "..");
const P = fs.readFileSync(path.join(RAIZ, "output", "agendar.html"), "utf8");
const PREV = fs.readFileSync(path.join(RAIZ, "scripts", "previa-detalhe.cjs"), "utf8");

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + obtido + (bate ? "" : "   (esperado: " + esperado + ")"));
  bate ? ok++ : falhou++;
}

console.log("\n=== A janela parada, o conteúdo rolando ===\n");

// ------------------------------------------------------------ a altura atravessa o invólucro
{
  eq("1) o invólucro do conteúdo tem nome próprio",
     P.indexOf('<div id="detCorpo" class="mrola">') >= 0, "true");
  eq("2) e é ele que estica dentro da janela",
     /\.mcaixa\.alto > \.mrola\{flex:1 1 auto;min-height:0;display:flex;flex-direction:column\}/.test(P), "true");
  eq("3) repassando a altura para o conteúdo",
     /\.mcaixa\.alto \.mrola > \.det-corpo\{flex:1 1 auto;min-height:0\}/.test(P), "true");
  // o seletor que pulava o invólucro não pode voltar
  eq("4) sumiu o seletor que não atravessava",
     /\.mcaixa\.alto > \.det-corpo\{/.test(P), "false");
}

// ------------------------------------------------------------ quem rola
{
  eq("5) o miolo rola", /\.mcaixa\.alto \.det-main\{overflow:auto;min-height:0\}/.test(P), "true");
  eq("6) e a coluna dos botões também", /\.mcaixa\.alto \.det-lado\{overflow:auto;min-height:0\}/.test(P), "true");
  // em tela estreita rola o miolo inteiro, sem depender de filho direto
  eq("7) em tela estreita o seletor também atravessa",
     /\.mcaixa\.alto \.det-corpo\{overflow:auto\}/.test(P), "true");
}

// ------------------------------------------------------------ dá pra PERCEBER que rola
{
  // no Mac a barra fica escondida: sem aviso, a pessoa acha que travou
  eq("8) a área que rola tem barra sempre visível", /\.rolavel::-webkit-scrollbar\{width:9px\}/.test(P), "true");
  eq("9) e sombra na borda quando há mais conteúdo", /\.rolavel\{[\s\S]{0,400}?radial-gradient/.test(P), "true");
  eq("10) a classe está aplicada nas duas áreas", P.indexOf('det-corpo rolavel') >= 0 && P.indexOf('det-main rolavel') >= 0, "true");
}

// ------------------------------------------------------------ a prévia reproduz a estrutura
{
  // é a trava que faltava: a prévia mentiu porque não tinha o invólucro
  eq("11) a prévia monta o invólucro de verdade",
     PREV.indexOf('\'<div id="detCorpo" class="mrola">\'') >= 0, "true");
  eq("12) e registra por que isso importa",
     PREV.indexOf("Previa que nao reproduz a estrutura") >= 0, "true");
  eq("13) usando conteúdo longo, que é onde o defeito aparece",
     /conteúdo LONGO de propósito/.test(PREV), "true");
}

console.log("\n" + (falhou ? "FALHOU: " + falhou + " de " + (ok + falhou) : "TUDO OK: " + ok + " testes") + "\n");
process.exit(falhou ? 1 : 0);
