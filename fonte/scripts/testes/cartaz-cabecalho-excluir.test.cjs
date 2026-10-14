// Testes do ✕ QUE APAGA UM CABEÇALHO do cartaz.
//
// Pedido do dono em 14/10/2026: "quando apertar o X nas fotos ele não exclua de vez, porque
// posso apertar sem querer". Antes o ✕ apagava no mesmo clique.
//
// POR QUE ISSO É SÉRIO: a arte enviada mora SÓ no navegador daquele computador (localStorage).
// Apagada, não tem de onde voltar — é reenviar o arquivo. E os ✕ ficam colados num canto da
// miniatura, numa fileira de cartões pequenos.
//
// O QUE ESTES TESTES PROTEGEM:
//   1) o ✕ pergunta antes de gravar a lista sem a arte;
//   2) apaga PELA IMAGEM, não pela posição — a armadilha velha desta tela, onde a posição já
//      apagou o vizinho errado uma vez (os cabeçalhos de fábrica vêm antes na lista desenhada);
//   3) o cabeçalho de fábrica continua sem ✕.
//   node scripts/testes/cartaz-cabecalho-excluir.test.cjs
const fs = require("fs");
const path = require("path");

const HTML = fs.readFileSync(path.join(__dirname, "..", "..", "output", "index.html"), "utf8");

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + obtido +
              (bate ? "" : "   (esperado: " + esperado + ")"));
  bate ? ok++ : falhou++;
}

console.log("\n=== O ✕ do cabeçalho do cartaz ===\n");

/* O trecho que trata o clique no ✕ — do começo do if até o return dele. */
const i = HTML.indexOf("data-cztemadel]')){");
const trecho = i < 0 ? "" : HTML.slice(i, HTML.indexOf("\n  }", i) + 4);
eq("1) achei o tratador do ✕", trecho.length > 200, true);

console.log("\n-- NÃO APAGA NO PRIMEIRO CLIQUE --");
{
  eq("2) ele pergunta antes", /uiConfirm\(/.test(trecho), true);
  eq("3) com botão de cancelar de verdade", /cancel:\s*'Cancelar'/.test(trecho), true);

  /* A PROVA QUE IMPORTA: gravar a lista sem a arte só pode acontecer DEPOIS da resposta.
     Se o czTemasSave aparecer antes do .then, o ✕ voltou a apagar no clique. */
  const posSave = trecho.indexOf("czTemasSave");
  const posThen = trecho.indexOf(".then(");
  eq("4) a lista só é gravada depois da resposta", posSave > posThen && posThen > 0, true);
  /* e a saída tem que ser silenciosa quando ele diz não */
  eq("5) responder 'não' não mexe em nada", /if\(!sim\)\s*return/.test(trecho), true);
}

console.log("\n-- APAGA A CERTA, NÃO A VIZINHA --");
{
  /* A armadilha desta tela: a lista DESENHADA tem os de fábrica na frente, a lista SALVA não.
     Guardar a posição e apagar por ela já errou o vizinho uma vez. Agora casa pela imagem. */
  eq("6) procura pela imagem na hora de apagar", /\[i\]\.d\s*===\s*alvo\.d/.test(trecho), true);
  eq("7) e não apaga por posição crua", /splice\(di\s*,\s*1\)/.test(trecho), false);
  eq("8) se não achar a imagem, não apaga nada", /if\(!fora\)\s*return/.test(trecho), true);
  /* quem estava escolhido e foi apagado não pode continuar escolhido */
  eq("9) solta o cabeçalho escolhido se foi ele que saiu",
     /czTema\s*&&\s*czTema\.d\s*===\s*fora\.d/.test(trecho), true);
}

console.log("\n-- A JANELA MOSTRA QUAL É --");
{
  /* Ele aperta sem querer num cartão pequeno: a janela tem que mostrar a arte, senão
     confirmar vira um "sim" automático. */
  eq("10) mostra a miniatura da arte", /<img src="'\+alvo\.d\+'"/.test(trecho), true);
  eq("11) e o nome dela, escapado", /czEsc\(alvo\.n/.test(trecho), true);
  eq("12) avisa que vai precisar reenviar", /enviar a imagem outra vez/.test(trecho), true);
}

console.log("\n-- O DE FÁBRICA NÃO TEM ✕ --");
{
  const linha = HTML.slice(HTML.indexOf("cz-temaDel"), HTML.indexOf("cz-temaDel") + 200);
  eq("13) o ✕ só é desenhado pra quem não é fixo", /_tm\.fixo\?''/.test(HTML), true);
}

console.log("\n" + (falhou ? ("FALHARAM " + falhou + " de " + (ok + falhou)) : ("TUDO OK: " + ok + " testes")));
process.exit(falhou ? 1 : 0);
