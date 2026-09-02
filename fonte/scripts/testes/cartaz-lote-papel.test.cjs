// Teste do LOTE NO PAPEL — imprime várias placas de uma vez e confere o PDF.
//
// Por que este teste existe: reimprimir UMA placa era fácil — o cartaz emprestava a
// validade, o limite e o cabeçalho da TELA. Imprimindo VÁRIAS de uma vez isso vira uma
// armadilha: a tela só guarda um jogo desses dados, então a tanda inteira sairia com a
// validade da primeira placa. Colada na gôndola, com a data errada, e sem nada na tela
// denunciando.
//
// O conserto foi cada placa levar o retrato dela presa no item (czLoteItens). Nenhum teste
// de tela prova isso: quem desenha o rodapé é o CSS na hora de paginar. Aqui o Chrome
// imprime de verdade e eu leio o texto de cada folha do PDF.
//
// Precisa do Google Chrome e do pdftotext (poppler). Faltando algum, ele AVISA e passa.
//   node scripts/testes/cartaz-lote-papel.test.cjs
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync, execSync } = require("child_process");

const RAIZ = path.join(__dirname, "..", "..");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "cartaz-lote-"));

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + obtido + (bate ? "" : "   (esperado: " + esperado + ")"));
  bate ? ok++ : falhou++;
}

console.log("\n=== Lote do histórico — no papel (imprime de verdade) ===\n");

function temPdftotext() { try { execSync("command -v pdftotext", { stdio: "ignore" }); return true; } catch (e) { return false; } }
if (!fs.existsSync(CHROME) || !temPdftotext() || !fs.existsSync(path.join(RAIZ, "output", "index.html"))) {
  console.log("  PULADO — precisa do Google Chrome, do pdftotext e do painel já construído.\n");
  process.exit(0);
}

/* As três placas vêm da previa-lote.cjs e são diferentes de propósito:
     ARROZ  01/09 a 08/09, limite 2, com a arte oficial no topo
     FEIJAO 31/08 a 06/09, sem limite, com o selo OFERTA em texto
     OLEO   02/09 a 18/09, limite 5, com a arte oficial no topo */
function imprimirLote(tam) {
  execFileSync("node", [path.join(RAIZ, "scripts", "previa-lote.cjs")],
    { cwd: RAIZ, env: Object.assign({}, process.env, { TAMANHO: tam }), stdio: "ignore" });
  const pdf = path.join(TMP, "lote-" + tam + ".pdf");
  execFileSync(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--virtual-time-budget=30000",
    "--print-to-pdf-no-header", "--print-to-pdf=" + pdf,
    "file://" + path.join(RAIZ, ".previa", "lote.html")], { stdio: "ignore" });
  const xml = execFileSync("pdftotext", ["-bbox", pdf, "-"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const pgs = [];
  const rePg = /<page width="([\d.]+)" height="([\d.]+)">([\s\S]*?)<\/page>/g;
  let m;
  while ((m = rePg.exec(xml))) {
    const palavras = [];
    const reW = /<word xMin="([\d.-]+)" yMin="([\d.-]+)" xMax="([\d.-]+)" yMax="([\d.-]+)">([\s\S]*?)<\/word>/g;
    let n;
    while ((n = reW.exec(m[3]))) palavras.push({ x1:+n[1], y1:+n[2], x2:+n[3], y2:+n[4], t:n[5] });
    pgs.push({ L:+m[1], A:+m[2], palavras: palavras, txt: palavras.map(w => w.t).join(" ") });
  }
  return pgs;
}

// ------------------------------------------------- A4: uma placa por folha
{
  const pgs = imprimirLote("A4");
  eq("1) as 3 marcadas viraram 3 folhas", pgs.length, 3);

  if (pgs.length === 3) {
    // A ORDEM é a da lista na tela, que é a ordem em que sai da impressora.
    eq("2) folha 1 é o ARROZ",  /ARROZ/.test(pgs[0].txt),  true);
    eq("3) folha 2 é o FEIJAO", /FEIJAO/.test(pgs[1].txt), true);
    eq("4) folha 3 é o OLEO",   /OLEO/.test(pgs[2].txt),   true);

    /* O CORAÇÃO DO TESTE. Cada folha com a validade DELA — não a da primeira. */
    eq("5) o ARROZ leva a validade dele",  /01\/09\/2026 ATÉ 08\/09\/2026/.test(pgs[0].txt), true);
    eq("6) o FEIJAO leva a validade dele", /31\/08\/2026 ATÉ 06\/09\/2026/.test(pgs[1].txt), true);
    eq("7) o OLEO leva a validade dele",   /02\/09\/2026 ATÉ 18\/09\/2026/.test(pgs[2].txt), true);

    // E nenhuma folha pode carregar a data da vizinha.
    eq("8) o FEIJAO não pegou a data do ARROZ", /08\/09\/2026/.test(pgs[1].txt), false);
    eq("9) o OLEO não pegou a data do ARROZ",   /08\/09\/2026/.test(pgs[2].txt), false);

    // O limite por cliente é do mesmo rodapé e some junto se a conta quebrar.
    eq("10) limite 2 no ARROZ",        /LIMITE 2 UNIDADES/.test(pgs[0].txt), true);
    eq("11) FEIJAO sem limite",        /LIMITE/.test(pgs[1].txt),            false);
    eq("12) limite 5 no OLEO",         /LIMITE 5 UNIDADES/.test(pgs[2].txt), true);

    /* O CABEÇALHO também é de cada placa. Quem tem arte no topo não escreve "OFERTA";
       quem não tem escreve, em letra grande. Se o cabeçalho vazasse de uma placa pra
       outra, este par inverteria.
       CONTO as ocorrências em vez de procurar a palavra: "OFERTA" também abre o rodapé
       ("OFERTA VÁLIDA DE...") e aparece em TODAS as folhas. Quem tem o selo em texto tem
       DUAS — o selo e o rodapé. Foi assim que este teste me pegou na primeira escrita. */
    const conta = (p) => p.palavras.filter(w => w.t === "OFERTA").length;
    eq("13) ARROZ tem arte no topo: só o OFERTA do rodapé",  conta(pgs[0]), 1);
    eq("14) FEIJAO sem arte: o selo OFERTA + o do rodapé",   conta(pgs[1]), 2);
    eq("15) OLEO tem arte no topo: só o do rodapé",          conta(pgs[2]), 1);

    // Nada pode passar da borda — é a mesma trava do cartaz-papel, agora no lote.
    let fora = 0, exemplo = "";
    pgs.forEach(function (p, i) {
      p.palavras.forEach(function (w) {
        if (w.x1 < -0.5 || w.x2 > p.L + 0.5 || w.y1 < -0.5 || w.y2 > p.A + 0.5) {
          fora++; if (!exemplo) exemplo = '"' + w.t + '" na folha ' + (i + 1);
        }
      });
    });
    eq("16) nenhuma palavra passa da borda" + (exemplo ? " (" + exemplo + ")" : ""), fora, 0);
  }
}

// ------------------------------------------------- A5: duas por folha, tudo junto
{
  /* O A5 divide a folha em duas. Aqui as duas metades têm validades diferentes na MESMA
     folha — é o caso mais apertado: se o rodapé viesse de uma variável só, as duas
     metades sairiam com a mesma data e ninguém veria diferença olhando de longe. */
  const pgs = imprimirLote("A5");
  eq("17) 3 placas A5 dão 2 folhas", pgs.length, 2);
  if (pgs.length >= 1) {
    eq("18) ARROZ e FEIJAO dividem a folha 1", /ARROZ/.test(pgs[0].txt) && /FEIJAO/.test(pgs[0].txt), true);
    eq("19) as duas validades saem na mesma folha",
       /01\/09\/2026 ATÉ 08\/09\/2026/.test(pgs[0].txt) && /31\/08\/2026 ATÉ 06\/09\/2026/.test(pgs[0].txt), true);
    let fora = 0;
    pgs.forEach(function (p) {
      p.palavras.forEach(function (w) {
        if (w.x1 < -0.5 || w.x2 > p.L + 0.5 || w.y1 < -0.5 || w.y2 > p.A + 0.5) fora++;
      });
    });
    eq("20) nada cortado nas folhas de A5", fora, 0);
  }
}

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
console.log("\n" + (falhou ? ("FALHARAM " + falhou + " de " + (ok + falhou)) : ("TUDO OK: " + ok + " testes")));
process.exit(falhou ? 1 : 0);
