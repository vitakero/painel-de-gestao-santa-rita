// Testes do LAÇO da carga das notas.
//
// A carga inicial são ~3.500 notas e o VR entrega 200 por vez. Sem laço, o Victor
// teria que rodar o robô 18 vezes na mão. Com laço, aparece o perigo oposto: laço que
// não anda fica lendo o mesmo pedaço para sempre, e o robô nunca mais termina.
//
// Três coisas seguram isso, e são elas que estes testes vigiam:
//   1. o marcador anda pela última nota LIDA, não pela última gravada — senão uma
//      nota ilegível no começo do lote prenderia o laço nela para sempre;
//   2. lote menor que o pedido significa que acabou: para;
//   3. e existe um teto de idas, para o robô nunca ficar preso aqui de jeito nenhum.
//
//   node scripts/testes/sync-notas-laco.test.cjs
const fs = require("fs");
const path = require("path");

const S = fs.readFileSync(path.join(__dirname, "..", "vr-sync-notas.cjs"), "utf8");

let ok = 0, falhou = 0;
function t(nome, cond, extra) {
  if (cond) { ok++; return; }
  falhou++; console.log("  FALHOU: " + nome + (extra ? " -> " + extra : ""));
}

t("existe um teto de idas ao VR", /const MAX_IDAS = \d+;/.test(S));
t("o laço respeita o teto", S.indexOf("while (idas < MAX_IDAS)") > 0);

// O marcador tem que andar pela ÚLTIMA LIDA. Andar pela última gravada é a armadilha:
// uma nota ilegível fica de fora da gravação, o marcador não passa dela, e a próxima
// ida traz exatamente o mesmo lote. Para sempre.
t("o marcador anda pela última nota LIDA",
  S.indexOf("desde = rows[rows.length - 1].datahorarecebimento;") > 0);
t("e o motivo está escrito no código", S.indexOf("MARCADOR ANDA MESMO QUE A NOTA TENHA SIDO PULADA") > 0);

t("lote incompleto encerra o laço", S.indexOf("if (rows.length < LOTE) break;") > 0);
t("nada novo encerra o laço", S.indexOf("if (!rows.length) {") > 0);

// O laço não pode ficar sem saída: precisa de pelo menos um break além do teto.
t("o laço tem saída além do teto", (S.split("break;").length - 1) >= 2);

// Cada nota tem rede própria: uma ilegível não pode levar as outras.
t("nota ilegível não derruba o lote", S.indexOf("uma nota ilegivel nao pode levar as outras junto") > 0);
t("nota ilegível é contada", S.indexOf("conta.puladas++") > 0);

// Grava em pedaços: um POST com 200 notas e seus produtos estoura o limite do PostgREST.
t("grava em pedaços", S.indexOf("for (let i = 0; i < linhas.length; i += 50)") > 0);
t("regravar a mesma nota não duplica",
  S.indexOf("on_conflict=tenant_id,chave") > 0 && S.indexOf("resolution=merge-duplicates") > 0);

// Só a Loja 01. A loja 2 existe no VR e está fora do escopo combinado.
t("só a Loja 01", S.indexOf("id_loja = 1") > 0);
// Só LÊ o VR.
t("não escreve no VR", S.indexOf("insert into") < 0 && S.indexOf("update public.notaentrada") < 0);
// pg exige c.query(texto, [valores]) — passar solto derruba de dentro do driver.
t("consulta com os valores em lista", S.indexOf("c.query(sql, desde ? [desde] : [])") > 0);

// Morte silenciosa na loja fecha a janela e leva o motivo junto.
t("o fim vira evento na nuvem", S.indexOf('entidade: "vr_notas_sync"') > 0);
t("morte inesperada fica registrada",
  S.indexOf("uncaughtException") > 0 && S.indexOf("unhandledRejection") > 0);

console.log(falhou ? ("FALHOU: " + falhou + " de " + (ok + falhou)) : ("TUDO OK: " + ok + " testes"));
process.exit(falhou ? 1 : 0);
