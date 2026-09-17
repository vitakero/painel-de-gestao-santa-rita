// Testes do 1 E DO 7 DO CARTAZ (a fonte de dois desenhos).
//
// Pedido do dono em 17/09/2026, com foto de uma placa: na Bangers o "1" e o "7" são quase o
// mesmo traço inclinado, e a 3 metros "17,99" vira "11,99". Ele pediu pra trocar a letra SÓ
// desses dois. Ver ==CZNUM== no demoDashboard.ts.
//
// O QUE ESTES TESTES PROTEGEM — e por que não é firula:
//   A troca FALHA EM SILÊNCIO. Se a @font-face não chegar junto com a família, o navegador
//   não reclama: ele cai calado pra Bangers e o cartaz sai com o 1 e o 7 iguais de novo.
//   Foi exatamente o que aconteceu no primeiro build desta mudança — a folha A4 monta o CSS
//   dela do zero e ficou sem a declaração. Só apareceu porque eu medi o PDF; na tela e no
//   código estava tudo "certo".
//   node scripts/testes/cartaz-numeros.test.cjs
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

console.log("\n=== O 1 e o 7 do cartaz ===\n");

console.log("-- A FONTE ESTÁ EMBUTIDA --");
{
  /* Embutida, não baixada: a placa tem que sair certa com a internet da loja fora. E colada
     no código, não lida de assets/ — a arte do cabeçalho é lida de lá com catch silencioso e
     por isso sumiu do ar quando o robô reconstruiu sem a pasta. */
  const faces = HTML.match(/@font-face\{font-family:'CzNum';src:url\(data:font\/woff;base64,([A-Za-z0-9+/=]+)\) format\('woff'\);unicode-range:([^;}]+);/g) || [];
  eq("1) a @font-face aparece nas duas frentes (tela e impressão)", faces.length, 2);

  const b64 = (HTML.match(/font-family:'CzNum';src:url\(data:font\/woff;base64,([A-Za-z0-9+/=]+)\)/) || [])[1] || "";
  eq("2) traz uma fonte de verdade junto (e não um endereço vazio)", b64.length > 1000, true);
  /* Duas letras só. Se alguém trocar pela fonte inteira sem perceber, isto acusa: a família
     completa passa de 20 KB. */
  eq("3) e é pequena — só dois desenhos", b64.length < 20000, true);
  eq("4) não sobrou nenhum link de fonte externa pro CzNum",
     /CzNum[^}]*fonts\.(googleapis|gstatic)/.test(HTML), false);
}

console.log("\n-- SÓ O 1 E O 7, MAIS NADA --");
{
  /* O dono foi explícito: a letra fica como está. Se o unicode-range escapar, a fonte passa
     a valer para outros caracteres e a placa inteira muda sem ninguém pedir. */
  const faixas = [...HTML.matchAll(/font-family:'CzNum';[^}]*unicode-range:([^;}]+)/g)].map(m => m[1].trim());
  eq("5) todas as declarações usam a mesma faixa", new Set(faixas).size, 1);
  eq("6) e a faixa é exatamente o 1 e o 7", faixas[0], "U+0031,U+0037");
}

console.log("\n-- A FONTE CHEGA EM TODA FOLHA QUE IMPRIME --");
{
  /* AQUI MORA O BUG QUE ESCAPOU. Cada folha monta o CSS dela: o deitado pelo CZLCSS, o pôster
     e o A5/A6/A7 pelo CZPCSS, e o A4 do zero. Declarar a família sem a @font-face junto não dá
     erro nenhum — só volta pra Bangers caladinho, e a placa sai com o 1 e o 7 iguais.

     LIÇÃO DA PRIMEIRA VERSÃO DESTE TESTE: ela tinha um teto de 1200 caracteres na busca e não
     alcançava as duas folhas MAIORES — inclusive a A4, que era a quebrada. Passava com "0
     órfãos" sem ter olhado nada. Por isso agora o teste PRIMEIRO cobra que achou as quatro
     folhas; sem isso ele não tem o direito de dizer que está tudo bem. */
  const _ini = HTML.indexOf("function czImprimir()");
  /* o "==GAVETA==" tem que ser procurado A PARTIR daqui: o marcador também aparece lá no
     começo do arquivo, e buscar do zero devolvia uma fatia vazia — o teste passava sem ler
     uma linha sequer. */
  const corpo = HTML.slice(_ini, HTML.indexOf("==GAVETA==", _ini));
  eq("7) achei a função que imprime", corpo.length > 5000, true);

  const FOLHAS = { cssL: "deitado", pcss: "pôster A1/A2/A3", ccss: "A5/A6/A7", css: "A4" };
  const achadas = [], semFace = [];
  for (const nome of Object.keys(FOLHAS)) {
    const i = corpo.search(new RegExp("(^|[^A-Za-z_])var " + nome + "\\s*="));
    if (i < 0) continue;
    // o CSS daquela folha vai de onde ele começa até a hora de escrever o documento
    const w = corpo.indexOf("document.write", i);
    const trecho = corpo.slice(i, w > 0 ? w : i + 40000);
    if (!/CZ_FAM/.test(trecho)) continue;                  // essa folha não usa a família
    achadas.push(nome);
    if (!/CZ_NUM_FACE|CZLCSS|CZPCSS/.test(trecho)) semFace.push(nome + " (" + FOLHAS[nome] + ")");
  }
  /* A COBRANÇA DE COBERTURA: são quatro folhas e o teste tem que ter olhado as quatro. */
  eq("8) olhei as 4 folhas de impressão (" + achadas.join(", ") + ")", achadas.length, 4);
  eq("9) nenhuma folha pede a família sem trazer a fonte" +
     (semFace.length ? " — FALTA EM: " + semFace.join(", ") : ""), semFace.length, 0);
}

console.log("\n-- A LETRA CONTINUA A BANGERS --");
{
  /* "vamos deixar a da letra como está, só mudar a fonte do 1 e do 7" (17/09/2026).
     O CzNum entra ANTES da Bangers na fila; como ele só cobre dois códigos, todo o resto
     cai na Bangers. Se alguém inverter a ordem, a troca simplesmente não acontece. */
  /* As folhas de impressão montam a pilha em tempo de execução, pela CZ_FAM — então no HTML
     elas aparecem como concatenação, não como texto literal. São os dois lugares que checar. */
  eq("10) a CZ_FAM põe o CzNum na frente",
     /CZ_FAM\s*=\s*"'CzNum','Bangers',cursive"/.test(HTML), true);

  /* A VARREDURA QUE IMPORTA: nenhuma declaração de fonte pode citar a Bangers sem o CzNum na
     frente. Se sobrar uma, aquele pedaço do cartaz continua com o 1 e o 7 iguais — e, de novo,
     sem erro nenhum aparecendo. (O <link> do Google não é declaração de fonte, é download.) */
  const decls = [...HTML.matchAll(/font-family:\s*([^;}"'`]*['"]?Bangers['"]?[^;}]*)/g)].map(m => m[1]);
  const orfas = decls.filter(d => !/CzNum/.test(d));
  eq("11) nenhuma declaração pede Bangers sem o CzNum" +
     (orfas.length ? " (" + orfas.slice(0, 2).join(" | ") + ")" : ""), orfas.length, 0);
  /* o rodapé da validade é Arial e continua Arial — ele não tem nada a ver com esta mudança */
  eq("12) o rodapé da validade segue em Arial", /\.ft\{color:#444;font-family:Arial/.test(HTML), true);
}

console.log("\n" + (falhou ? ("FALHARAM " + falhou + " de " + (ok + falhou)) : ("TUDO OK: " + ok + " testes")));
process.exit(falhou ? 1 : 0);
