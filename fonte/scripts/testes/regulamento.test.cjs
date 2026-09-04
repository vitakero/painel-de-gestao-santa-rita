// REGULAMENTO INTERNO — a bancada da aba de consulta.
//
// A PROVA CENTRAL: o painel carrega DENTRO dele o PDF oficial (o arquivo que o escritório fez e
// que o Victor mandou). Então o teste não precisa de cópia de apoio nenhuma: ele TIRA o PDF do
// painel construído, lê o texto dele e cobra que cada linha da tela exista lá, igualzinha.
// É isso que impede a tela e o papel de se desencontrarem — se alguém editar o
// assets/regulamento-interno.json e não trocar o PDF (ou o contrário), aqui fica vermelho.
//
// Guarda também:
//   - a estrutura (13 capítulos, Art. 1º ao 38, sem buraco);
//   - a busca (achar "férias" digitando "ferias", sem furar o escape de HTML);
//   - o botão Imprimir abrindo o PDF ORIGINAL, sem tela minha no meio;
//   - a porta aberta: todo funcionário vê a aba, mesmo sem nenhuma página liberada.
//
//   node scripts/testes/regulamento.test.cjs
const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");
const crypto = require("crypto");

const RAIZ = path.join(__dirname, "..", "..");
const HTML = fs.readFileSync(path.join(RAIZ, "output", "index.html"), "utf8");

const ini = HTML.indexOf("==REG-INICIO==");
const fim = HTML.indexOf("==REG-FIM==");
if (ini < 0 || fim < 0) { console.log("ERRO: não achei o módulo do regulamento no output/index.html (rode o build antes)."); process.exit(1); }
const codigo = HTML.slice(HTML.indexOf("*/", ini) + 2, HTML.lastIndexOf("/*", fim));
const M = new Function(codigo +
  "\nreturn {REG_DOC,REG_PDF_B64,regEsc,regDobra,regMarca,regBate,regTextos,regItemHtml,regTotalArtigos,"
  + "setTermo:function(t){ regTermo=t; }};")();

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  [" + obtido + "]" + (bate ? "" : "   (esperado: [" + esperado + "])"));
  bate ? ok++ : falhou++;
}
function certo(nome, cond) { eq(nome, cond ? "sim" : "não", "sim"); }

// ---------------------------------------------------------------------------
// 0) O PDF OFICIAL SAI INTEIRO DE DENTRO DO PAINEL
// ---------------------------------------------------------------------------
console.log("\n== 0. O PDF oficial viaja dentro do painel ==");
const b64Asset = fs.readFileSync(path.join(RAIZ, "assets", "regulamento-interno.pdf.b64"), "utf8")
  .split("-----BASE64-----")[1].replace(/\s+/g, "");
certo("o painel leva o PDF embutido", !!M.REG_PDF_B64 && M.REG_PDF_B64.length > 100000);
eq("é exatamente o arquivo de assets/ (nada se perdeu no build)",
   crypto.createHash("sha256").update(Buffer.from(M.REG_PDF_B64, "base64")).digest("hex"),
   crypto.createHash("sha256").update(Buffer.from(b64Asset, "base64")).digest("hex"));
const pdfTmp = path.join(os.tmpdir(), "reg-teste-" + process.pid + ".pdf");
fs.writeFileSync(pdfTmp, Buffer.from(M.REG_PDF_B64, "base64"));
certo("abre como PDF de verdade", fs.readFileSync(pdfTmp).slice(0, 5).toString() === "%PDF-");
const paginas = cp.execFileSync("pdftotext", ["-layout", pdfTmp, "-"], { encoding: "utf8", maxBuffer: 1 << 26 });
eq("páginas do documento", paginas.split("\f").filter((p) => p.trim()).length, 17);
certo("traz a folha de assinatura (as 120 linhas do papel)", /120\.\s*_/.test(paginas.replace(/\s+/g, " ")));

// ---------------------------------------------------------------------------
// 1) A TELA NÃO PODE DESENCONTRAR DO PDF
// O cabeçalho/rodapé se repete em toda página e parte frases na virada; tirar essa linha
// é o que deixa comparar o TEXTO, e não a paginação.
// ---------------------------------------------------------------------------
console.log("\n== 1. Cada linha da tela existe, igualzinha, no PDF oficial ==");
const D = M.REG_DOC;
// O rodapé NÃO pode ser montado com o endereço da tela: a tela já traz "Paulo VI" corrigido e o
// PDF ainda traz "Paulo XI", então o padrão não casaria e o rodapé ficaria no meio do texto —
// partindo o Art. 11, que cai bem na virada de página. Aqui vale do nome da empresa até o
// telefone, seja lá como o bairro esteja escrito.
const esc = (t) => String(t).replace(/[.*+?^${}()|[\]\\\/-]/g, "\\$&");
const RODAPE = new RegExp(esc(D.empresa) + "\\s+" + esc(D.cnpj) + "[\\s\\S]{0,90}?TEL: " + esc(D.telefone), "g");
const norm = (s) => String(s).replace(/\s+/g, " ").trim();
const NOPDF = norm(paginas).replace(RODAPE, " ").replace(/\s+/g, " ");
const CRU = norm(paginas);
let conferidos = 0; const fora = [];
function confere(rot, txt) { conferidos++; if (NOPDF.indexOf(norm(txt)) < 0) fora.push(rot + ": " + String(txt).slice(0, 70)); }
D.introducao.forEach((t, i) => confere("introdução " + (i + 1), t));
D.capitulos.forEach((c) => {
  confere("título do cap. " + c.n, c.titulo);
  c.itens.forEach((it) => {
    confere(it.rot, it.txt);
    (it.lista || []).forEach((l) => {
      confere(it.rot + " " + l.rot, l.txt);
      (l.sub  || []).forEach((s) => confere(it.rot + " " + l.rot + " " + s.rot, s.txt));
      (l.pars || []).forEach((s) => confere(it.rot + " " + l.rot + " " + s.rot, s.txt));
    });
  });
});
confere("frase de ciência", D.ciencia);
fora.forEach((f) => console.log("        divergente -> " + f));
eq("trechos divergentes do PDF", fora.length, 0);
eq("trechos conferidos (se cair, alguém apagou texto)", conferidos, 153);
["empresa", "cnpj", "telefone"].forEach((k) =>
  certo("o " + k + " da tela é o do PDF", CRU.indexOf(norm(D[k])) >= 0));
// O BAIRRO: o PDF oficial escreve "PAULO XI"; o bairro de Caicó é Paulo VI (do Papa Paulo VI).
// O Victor confirmou em 04/09/2026 que é erro de digitação do documento. Eu não altero documento
// jurídico: na TELA vale o certo, e o PDF só muda quando o escritório reemitir. Esta prova
// guarda os DOIS lados — pra ninguém "consertar" a tela de volta, nem esquecer que o papel
// ainda está errado. Quando o PDF novo chegar, a segunda linha aqui é que vai avisar.
certo("na tela o bairro sai certo (Paulo VI)", /PAULO VI\b/.test(D.endereco));
certo("o PDF oficial AINDA traz Paulo XI — falta o escritório reemitir", /PAULO XI\b/.test(CRU));
certo("a data do documento é a do PDF", CRU.indexOf(norm(D.localData)) >= 0);
try { fs.unlinkSync(pdfTmp); } catch (e) {}

console.log("\n== 1b. Estrutura: nada de capítulo ou artigo faltando ==");
eq("capítulos", D.capitulos.length, 13);
eq("artigos", M.regTotalArtigos(), 38);
const nums = [];
D.capitulos.forEach((c) => c.itens.forEach((it) => { if (it.tipo !== "par") nums.push(parseInt(String(it.rot).replace(/\D+/g, ""), 10)); }));
eq("numeração vai de 1 a 38, na ordem, sem buraco",
   nums.join(",") === Array.from({ length: 38 }, (_, i) => i + 1).join(",") ? "sim" : nums.join(","), "sim");
eq("capítulos em algarismo romano, na ordem", D.capitulos.map((c) => c.n).join(" "),
   "I II III IV V VI VII VIII IX X XI XII XIII");
certo("entra em vigor em 01/05/2026 (é o que o Art. 1º, § 2º diz)", D.vigencia === "01/05/2026");

// ---------------------------------------------------------------------------
// 2) A BUSCA
// ---------------------------------------------------------------------------
console.log("\n== 2. Procurar sem acento e sem maiúscula ==");
eq("'ferias' bate com 'férias'", M.regDobra("Férias").indexOf(M.regDobra("ferias")), 0);
eq("'CELULAR' bate com 'celular'", M.regDobra("Uso de CELULAR").indexOf(M.regDobra("celular")), 7);
M.setTermo("uniforme");
certo("Art. 5º entra na busca por 'uniforme' (está na alínea r)", M.regBate(M.regTextos(D.capitulos[2].itens[0])));
M.setTermo("pendrive");
certo("Art. 21 entra na busca por 'pendrive' (está na alínea p)", M.regBate(M.regTextos(D.capitulos[8].itens[0])));
M.setTermo("bicicleta");
certo("palavra que não existe no regulamento não traz o Art. 21", !M.regBate(M.regTextos(D.capitulos[8].itens[0])));

console.log("\n== 2b. O destaque amarelo (é ele que depende do tamanho não mudar) ==");
["Férias", "atenção", "ORGANIZAÇÃO", "não", "ç", "Introdução do regulamento"].forEach((t) =>
  eq("regDobra mantém o tamanho de \"" + t + "\"", M.regDobra(t).length, t.length));
M.setTermo("ferias");
eq("acha e destaca a palavra acentuada", M.regMarca("Das Férias e afins"), "Das <mark>Férias</mark> e afins");
M.setTermo("a");
eq("uma letra só NÃO filtra nem destaca (senão pinta o alfabeto todo)", M.regMarca("Casa"), "Casa");
M.setTermo("");
eq("sem busca, o texto sai limpo", M.regMarca("Casa & cia"), "Casa &amp; cia");
M.setTermo("cia");
eq("o destaque não fura o escape de HTML", M.regMarca("Casa & <cia>"), "Casa &amp; &lt;<mark>cia</mark>&gt;");
M.setTermo("<script>");
certo("termo com HTML dentro não vira tag na tela", M.regMarca("um <script> aqui").indexOf("<script>") < 0);
M.setTermo("");

// ---------------------------------------------------------------------------
// 3) O BOTÃO IMPRIMIR
// ---------------------------------------------------------------------------
console.log("\n== 3. O botão Imprimir abre o PDF oficial, sem tela minha no meio ==");
// É LINK, não botão com window.open: pop-up aberto por script é bloqueado em vários navegadores
// (no celular, quase sempre). Se alguém trocar de volta, aqui fica vermelho.
certo("o Imprimir é um link de verdade para o PDF",
      /<a class="reg-bt" id="regImprimirBt" target="_blank" rel="noopener" href="\'\+regPdfEndereco\(\)/.test(codigo));
// procura a CHAMADA (com parêntese) — o texto "window.open" ainda aparece no comentário que
// explica justamente por que não se usa isso aqui
certo("nada de abrir pop-up por script", !/window\.open\s*\(/.test(codigo));
certo("por Blob (o Chrome recusa abrir aba em endereço data:)", /createObjectURL\(new Blob\(/.test(codigo));
certo("tipo PDF", /type:"application\/pdf"/.test(codigo));
certo("não remonta mais o documento em HTML", codigo.indexOf("regDocHtml") < 0);
certo("não põe barra minha na frente do documento", codigo.indexOf("pxDocBarraHtml") < 0);

// ---------------------------------------------------------------------------
// 4) A PORTA ABERTA
// ---------------------------------------------------------------------------
console.log("\n== 4. Todo mundo vê o Regulamento ==");
function pegarFuncao(nome) {
  const i = HTML.indexOf("function " + nome + "(");
  if (i < 0) return null;
  let d = 0, k = HTML.indexOf("{", i);
  while (k < HTML.length) { if (HTML[k] === "{") d++; else if (HTML[k] === "}") { d--; if (!d) break; } k++; }
  return HTML.slice(i, k + 1);
}
const fonteAba = pegarFuncao("podeAba");
certo("achei a regra de quem vê cada aba (podeAba)", !!fonteAba);
const podeAba = new Function("ok", fonteAba + "\nreturn podeAba;")([]);
certo("funcionário sem nenhuma página liberada vê o Regulamento", podeAba("regulamento"));
certo("...e continua sem ver as outras (a exceção é só do regulamento)", !podeAba("despesas") && !podeAba("pontos"));
certo("quem só tem Escala também vê o Regulamento",
      new Function("ok", fonteAba + "\nreturn podeAba;")(["escala"])("regulamento"));
certo("o botão existe no menu", HTML.indexOf('data-page="regulamento"') >= 0);
certo("a página existe", HTML.indexOf('id="page-regulamento"') >= 0);
certo("abrir a aba desenha o regulamento", /dataset\.page==="regulamento"\)\s*regRender\(\)/.test(HTML));

console.log("\n== 4b. Consulta não gasta nuvem (esta aba não fala com o Supabase) ==");
certo("não usa __SB", codigo.indexOf("__SB") < 0);
certo("não chama rpc", codigo.indexOf(".rpc(") < 0);
certo("não faz select/insert", codigo.indexOf(".select(") < 0 && codigo.indexOf(".insert(") < 0);

console.log("\n" + (falhou ? "FALHOU: " + falhou + " de " + (ok + falhou) : "TUDO CERTO: " + ok + " provas"));
process.exit(falhou ? 1 : 0);
