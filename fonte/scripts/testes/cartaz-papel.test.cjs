// Teste do cartaz NO PAPEL — imprime de verdade e confere o PDF.
//
// Por que este teste existe: em 22/08/2026 o dono avisou que imprimindo dois cartazes por folha
// "sempre a segunda sai quebrada". Eu medi a tela e estava tudo certo — as cinco placas do mesmo
// tamanho, no mesmo lugar, sem sobra. O defeito só existia no PAPEL: quando o Chrome pagina a
// folha, ele erra a posição de um cartaz com position:absolute dentro da célula. O de baixo saía
// 90,3pt para a direita e 230,8pt para baixo, passava da borda e ficava cortado.
//
// Nenhum teste de tela pegaria isso. Este aqui manda o Chrome imprimir num PDF e mede o PDF.
//
// Precisa do Google Chrome e do pdftotext (poppler). Se faltar algum, ele AVISA e passa — não
// trava o resto da bateria.
//   node scripts/testes/cartaz-papel.test.cjs
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync, execSync } = require("child_process");

const RAIZ = path.join(__dirname, "..", "..");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "cartaz-papel-"));

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + obtido + (bate ? "" : "   (esperado: " + esperado + ")"));
  bate ? ok++ : falhou++;
}

console.log("\n=== Cartaz — no papel (imprime de verdade) ===\n");

function temPdftotext() { try { execSync("command -v pdftotext", { stdio: "ignore" }); return true; } catch (e) { return false; } }
if (!fs.existsSync(CHROME) || !temPdftotext() || !fs.existsSync(path.join(RAIZ, "output", "index.html"))) {
  console.log("  PULADO — precisa do Google Chrome, do pdftotext e do painel já construído.\n");
  process.exit(0);
}

// Imprime <qtd> cartazes no tamanho <tam> e devolve as páginas com as palavras e a caixa de cada uma.
function imprimir(tam, qtd, extra) {
  execFileSync("node", [path.join(RAIZ, "scripts", "previa-impressao.cjs")],
    { cwd: RAIZ, env: Object.assign({}, process.env, { TAMANHO: tam, QTD: String(qtd), PATCH: "", NOME: "ARROZ" }, extra || {}), stdio: "ignore" });
  const pdf = path.join(TMP, tam + "-" + Object.keys(extra || {}).join("") + ".pdf");
  execFileSync(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--virtual-time-budget=25000",
    "--print-to-pdf-no-header", "--print-to-pdf=" + pdf,
    "file://" + path.join(RAIZ, ".previa", "impressao.html")], { stdio: "ignore" });
  const xml = execFileSync("pdftotext", ["-bbox", pdf, "-"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const pgs = [];
  const rePg = /<page width="([\d.]+)" height="([\d.]+)">([\s\S]*?)<\/page>/g;
  let m;
  while ((m = rePg.exec(xml))) {
    const palavras = [];
    const reW = /<word xMin="([\d.-]+)" yMin="([\d.-]+)" xMax="([\d.-]+)" yMax="([\d.-]+)">([\s\S]*?)<\/word>/g;
    let n;
    while ((n = reW.exec(m[3]))) palavras.push({ x1:+n[1], y1:+n[2], x2:+n[3], y2:+n[4], t:n[5] });
    pgs.push({ L:+m[1], A:+m[2], palavras: palavras });
  }
  return pgs;
}

// ---------------------------------------------------------- A5: dois por folha, o caso do bug
{
  const pgs = imprimir("A5", 5);
  eq("1) 5 cartazes A5 dão 3 folhas", pgs.length, 3);

  // NADA pode passar da borda. Era exatamente assim que a segunda placa saía cortada.
  let fora = 0, exemplo = "";
  pgs.forEach(function (p, i) {
    p.palavras.forEach(function (w) {
      if (w.x1 < -0.5 || w.x2 > p.L + 0.5 || w.y1 < -0.5 || w.y2 > p.A + 0.5) {
        fora++; if (!exemplo) exemplo = '"' + w.t + '" na folha ' + (i + 1);
      }
    });
  });
  eq("2) nenhuma palavra passa da borda da folha" + (exemplo ? " (" + exemplo + ")" : ""), fora, 0);

  // As duas placas da folha têm que estar na MESMA coluna, uma embaixo da outra.
  const p1 = pgs[0].palavras.filter(function (w) { return w.t === "CAMIL"; });
  eq("3) as duas placas da folha 1 aparecem inteiras", p1.length, 2);
  if (p1.length === 2) {
    const dx = Math.abs(p1[0].x1 - p1[1].x1);
    eq("4) as duas na mesma coluna (diferença em X < 1pt)", dx < 1, "true");
    const dy = Math.abs((p1[1].y1 - p1[0].y1));
    // uma linha de distância: metade útil da folha (265mm/2 = 132,5mm = 375,6pt), com folga
    eq("5) a de baixo está uma linha abaixo (350..400pt)", dy > 350 && dy < 400, "true");
    const t0 = (p1[0].x2 - p1[0].x1).toFixed(1), t1 = (p1[1].x2 - p1[1].x1).toFixed(1);
    eq("6) as duas do mesmo tamanho", t0, t1);
  }

  // Todas as folhas iguais: a folha 2 repete a folha 1.
  const p2 = pgs[1].palavras.filter(function (w) { return w.t === "CAMIL"; });
  eq("7) a folha 2 sai igual à folha 1", p2.length === 2 && p1.length === 2 &&
    Math.abs(p2[0].x1 - p1[0].x1) < 1 && Math.abs(p2[1].y1 - p1[1].y1) < 1, "true");
}

// ---------------------------------------------------------- os outros tamanhos não podem quebrar junto
// A7 são 8 por folha: 9 cartazes = 2 folhas. Antes do conserto da folha saíam 4 — duas delas
// EM BRANCO, porque cada folha estourava a página e derramava uma sobra vazia na seguinte.
[["A6", 5, 2], ["A7", 9, 2], ["A4", 2, 2]].forEach(function (c, k) {
  const pgs = imprimir(c[0], c[1]);
  eq((8 + k) + ") " + c[0] + ": " + c[1] + " cartazes dão " + c[2] + " folhas", pgs.length, c[2]);
  let fora = 0;
  pgs.forEach(function (p) {
    p.palavras.forEach(function (w) {
      if (w.x1 < -0.5 || w.x2 > p.L + 0.5 || w.y1 < -0.5 || w.y2 > p.A + 0.5) fora++;
    });
  });
  eq((11 + k) + ") " + c[0] + ": nada passa da borda", fora, 0);
  // nenhuma folha pode sair em branco — era assim que o A7 gastava o dobro de papel
  const vazias = pgs.filter(function (p) { return p.palavras.length < 5; }).length;
  eq((25 + k) + ") " + c[0] + ": nenhuma folha sai em branco", vazias, 0);
});

// ---------------------------------------------------------- a folha nunca pode passar da página
{
  // A folha valia 100% da largura e ganhava a FORMA do A4. Só que a altura saía dessa forma,
  // e sobrava 1px de folga contra a página (medido: folha 1122px, página 1123px). Numa caixa de
  // página mais achatada — papel Carta — a folha passava e o Chrome fatiava a metade de baixo
  // pra outra folha: dava 6 folhas em vez de 3, todas com o cartaz de baixo cortado. Mesmo
  // estrago que o dono relatou, causa diferente. Agora a largura também é limitada pela altura
  // da página (100vh), então a folha encolhe inteira em vez de estourar.
  const casos = [
    ["A4 sem margem",        { PATCH: "@page{size:A4;margin:0}" },            3],
    ["A4 com margem 10mm",   { PATCH: "@page{size:A4;margin:10mm}" },         3],
    ["papel CARTA sem margem",  { PATCH: "@page{size:Letter;margin:0}" },     3],
    ["papel CARTA com margem",  { PATCH: "@page{size:Letter;margin:10mm}" },  3],
  ];
  casos.forEach(function (c, k) {
    const pgs = imprimir("A5", 5, c[1]);
    eq((14 + k * 2) + ") " + c[0] + ": 5 cartazes cabem em " + c[2] + " folhas", pgs.length, c[2]);
    let fora = 0;
    pgs.forEach(function (p) {
      p.palavras.forEach(function (w) {
        if (w.x1 < -0.5 || w.x2 > p.L + 0.5 || w.y1 < -0.5 || w.y2 > p.A + 0.5) fora++;
      });
    });
    eq((15 + k * 2) + ") " + c[0] + ": nada passa da borda", fora, 0);
  });
}

// ---------------------------------------------------------- nome comprido não sai cortado
{
  // O tamanho da letra era calculado CONTANDO caracteres, não medindo a largura de verdade.
  // Um nome de letras largas cabia na conta e não cabia na placa: medi 13% do nome sendo
  // picotado em silêncio pelo overflow:hidden. Agora a janela mede e encolhe só o que passa.
  const pgs = imprimir("A4", 1, { NOME: "MMMMMMMMMMMMMMMMMMMM", MARCA: "" });
  const nome = pgs[0].palavras.filter(function (w) { return w.t.indexOf("MMM") === 0; });
  eq("22) o nome de letras largas sai inteiro (1 pedaço, não picotado)", nome.length, 1);
  eq("23) e cabe dentro da folha", nome.length === 1 && nome[0].x1 > -0.5 && nome[0].x2 < pgs[0].L + 0.5, "true");

  // E o que já cabia não pode ter encolhido: mesmo nome comprido de sempre, mesma posição.
  const antes = imprimir("A4", 1, { NOME: "MACARRAO ESPAGUETE INTEGRAL PREMIUM", MARCA: "RENATA" });
  const mac = antes[0].palavras.filter(function (w) { return w.t === "MACARRAO"; })[0];
  eq("24) nome comprido normal continua no mesmo lugar (x≈97,4)", mac && Math.abs(mac.x1 - 97.43) < 0.5, "true");
}

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
console.log("\n" + (falhou ? "FALHOU: " + falhou + " de " + (ok + falhou) : "TUDO OK: " + ok + " testes") + "\n");
process.exit(falhou ? 1 : 0);
