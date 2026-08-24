// O AVISO DE ERRO do portal não pode culpar a internet de quem tem internet.
//
// Defeito que o dono pegou em 22/08/2026: abriu "Meus agendamentos" e leu
// "Verifique sua internet e tente de novo" — com a internet funcionando. Ele estranhou:
// "acho que o aviso está errado, deveria ser outra mensagem, não?". Estava mesmo.
//
// Qualquer tropeço caía nessa frase: erro do banco, função faltando, permissão. A tela
// mandava a pessoa procurar defeito no lugar errado, e o defeito de verdade — que era
// nosso — ficava escondido. Com fornecedor de fora é pior: ele liga pra loja jurando que
// a internet dele está boa, e ninguém na loja sabe o que aconteceu.
//
// Agora são três respostas diferentes para três situações diferentes, e a do meio mostra
// o código do erro — é o que a pessoa repete pra gente pra descobrirmos o que houve.
//
//   node scripts/testes/portal-erro-honesto.test.cjs
const fs = require("fs");
const path = require("path");

const HTML = fs.readFileSync(path.join(__dirname, "..", "..", "output", "agendar.html"), "utf8");

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + obtido + (bate ? "" : "   (esperado: " + esperado + ")"));
  bate ? ok++ : falhou++;
}

console.log("\n=== Portal — o aviso de erro diz a verdade ===\n");

// ------------------------------------------------------------ a frase que enganava morreu
{
  eq("1) sumiu o 'verifique sua internet' genérico",
     HTML.indexOf("Verifique sua internet e tente de novo") >= 0, "false");
}

// ------------------------------------------------------------ só fala em internet quando é internet
{
  eq("2) pergunta ao navegador se ele está sem rede",
     HTML.indexOf("navigator.onLine === false") >= 0, "true");
  // "Failed to fetch" é o que o navegador diz quando o pedido nem saiu
  eq("3) e reconhece o pedido que nem chegou a sair",
     /failed to fetch\|networkerror\|load failed/i.test(HTML), "true");
  eq("4) aí sim fala de conexão",
     HTML.indexOf("Você está sem conexão. Quando a internet voltar") >= 0, "true");
}

// ------------------------------------------------------------ se o servidor respondeu, a culpa é nossa
{
  eq("5) assume a culpa em vez de empurrar pra internet da pessoa",
     HTML.indexOf("O problema foi aqui do nosso lado, não na sua internet") >= 0, "true");
  eq("6) e mostra o código do erro pra pessoa poder repetir pra gente",
     HTML.indexOf("Detalhe técnico: ") >= 0, "true");
  eq("7) o código vem do erro de verdade, não é texto fixo",
     /\[e\.code, recado\]\.filter/.test(HTML), "true");
  // detalhe técnico só quando NÃO é falta de rede — senão vira ruído
  eq("8) não mostra código quando é só falta de internet",
     /!semRede && tec \?/.test(HTML), "true");
}

// ------------------------------------------------------------ o botão de repetir continua
{
  eq("9) continua dando pra tentar de novo",
     HTML.indexOf('data-acao="recarregar">Tentar de novo') >= 0, "true");
  eq("10) o detalhe técnico tem estilo discreto próprio",
     HTML.indexOf(".erro-tec{font-size:11.5px") >= 0, "true");
}

console.log("\n" + (falhou ? "FALHOU: " + falhou + " de " + (ok + falhou) : "TUDO OK: " + ok + " testes") + "\n");
process.exit(falhou ? 1 : 0);
