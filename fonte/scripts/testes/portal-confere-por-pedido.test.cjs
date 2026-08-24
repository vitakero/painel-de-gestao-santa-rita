// CADA NOTA CONFERE CONTRA O PEDIDO DELA — não contra a soma dos marcados.
//
// Defeito que o dono achou testando em 22/08/2026, e o teste dele foi melhor que o meu:
// vinculou a nota ao pedido ERRADO (23209) e marcou também o certo (23102). A tela disse
//
//     "Tudo bate com o pedido · 16 itens na nota · 16 conferem"
//
// em verde. E o Continuar barrou:
//
//     "A nota 118244 traz 8 produto(s) que não estão no pedido 23209"
//
// As duas telas estavam fazendo contas diferentes. A conferência comparava os itens da
// nota contra a UNIÃO de todos os pedidos marcados — e como os 16 itens existiam no
// outro pedido, tudo "batia". O servidor compara cada nota com O PEDIDO QUE ELA APONTA,
// que é a regra da loja: é o vínculo que diz o que esperar daquele caminhão.
//
// Tela que promete o que o servidor vai negar é pior que tela sem informação nenhuma.
//
//   node scripts/testes/portal-confere-por-pedido.test.cjs
const fs = require("fs");
const path = require("path");

const HTML = fs.readFileSync(path.join(__dirname, "..", "..", "output", "agendar.html"), "utf8");

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + obtido + (bate ? "" : "   (esperado: " + esperado + ")"));
  bate ? ok++ : falhou++;
}

console.log("\n=== Portal — cada nota contra o pedido dela ===\n");

// ------------------------------------------------------------ agrupa por vínculo
{
  eq("1) existe o agrupamento por pedido", /function gruposParaConferir\(\)\{/.test(HTML), "true");
  eq("2) o grupo sai do VÍNCULO da nota, não dos marcados",
     /var n=wz\.chaves\[i\], vs=vincLista\(n\), its=n\.itens\|\|\[\];/.test(HTML), "true");
  eq("3) nota sem vínculo ou sem itens não entra", /if\(!vs\.length \|\| !its\.length\) continue;/.test(HTML), "true");
  // duas notas do mesmo pedido vão juntas, senão "não vieram nesta nota" conta duas vezes
  // agora a chave é o CONJUNTO de pedidos da nota, não um pedido só
  eq("4) notas com o MESMO conjunto de pedidos conferem juntas",
     /if\(!mapa\[v\]\)\{ mapa\[v\]=\{pedidos:vs, itens:\[\]\}; ordem\.push\(v\); \}/.test(HTML), "true");
}

// ------------------------------------------------------------ um pedido por chamada
{
  eq("5) confere um grupo por vez, com os pedidos daquela nota",
     /SB\.rpc\("forn_conferir_nota",\{p_pedidos:g\.pedidos, p_itens:g\.itens\}\)/.test(HTML), "true");
  eq("6) e nunca mais manda a lista inteira de marcados",
     /forn_conferir_nota",\{p_pedidos:peds/.test(HTML), "false");
  eq("7) juntando as respostas num resultado só", /function juntarConferencias\(vs\)\{/.test(HTML), "true");
  eq("8) somando os contadores", /\["itens","ok","acima","fora","preco","faltando","indefinido","pelo_dicionario","problemas"\]/.test(HTML), "true");
}

// ------------------------------------------------------------ a decisão de pular usa a MESMA conta
{
  // se usassem contas diferentes, voltaria o mesmo defeito por outra porta
  eq("9) o decisor do pulo usa o mesmo agrupamento",
     /if\(!gruposParaConferir\(\)\.length\) return cb\("pedidos"\);/.test(HTML), "true");
  eq("10) e a mesma conferência", /conferirGrupos\(\)\.then\(function\(v\)\{\s*\n\s*if\(!v \|\| v\.erro\) return cb\("pedidos"\);/.test(HTML), "true");
  eq("11) a tela também", /conferirGrupos\(\)\.then\(function\(v\)\{\s*\n\s*wz\.conf = v;/.test(HTML), "true");
}

// ------------------------------------------------------------ erro não vira "tudo certo"
{
  eq("12) erro de qualquer pedido vira erro do conjunto",
     /if\(r\.error\) return \{erro:\(r\.error\.message\|\|"Não consegui conferir\."\)\};/.test(HTML), "true");
  eq("13) e resposta não-ok também", /if\(!v\.ok\)   return \{erro:\(v\.erro\|\|"Não consegui conferir\."\)\};/.test(HTML), "true");
}

console.log("\n" + (falhou ? "FALHOU: " + falhou + " de " + (ok + falhou) : "TUDO OK: " + ok + " testes") + "\n");
process.exit(falhou ? 1 : 0);
