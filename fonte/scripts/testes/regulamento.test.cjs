// REGULAMENTO INTERNO — a bancada da aba de consulta.
//
// O QUE ESTA BANCADA GUARDA
//   1. FIDELIDADE. O regulamento é documento com peso jurídico: uma palavra trocada na
//      transcrição vira uma regra que a empresa não escreveu. Cada trecho do json é
//      procurado, letra por letra, dentro do texto extraído do PDF oficial
//      (scripts/testes/apoio/regulamento-pdf.txt). Uma divergência = teste vermelho.
//   2. A BUSCA. Procurar "ferias" tem que achar "férias" — e o destaque amarelo não pode
//      cortar o texto no lugar errado nem furar o escape de HTML.
//   3. O PAPEL. O que se imprime é o documento INTEIRO, nunca o pedaço filtrado da tela.
//   4. A PORTA ABERTA. O regulamento é a única aba que todo funcionário vê, mesmo sem
//      nenhuma página liberada. Se alguém fechar isso sem querer, aqui fica vermelho.
//
// Não duplica lógica: extrai o módulo do painel já gerado (output/index.html).
//   node scripts/testes/regulamento.test.cjs
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..", "..");
const HTML = fs.readFileSync(path.join(RAIZ, "output", "index.html"), "utf8");
const PDF  = fs.readFileSync(path.join(__dirname, "apoio", "regulamento-pdf.txt"), "utf8");

const ini = HTML.indexOf("==REG-INICIO==");
const fim = HTML.indexOf("==REG-FIM==");
if (ini < 0 || fim < 0) { console.log("ERRO: não achei o módulo do regulamento no output/index.html (rode o build antes)."); process.exit(1); }
const codigo = HTML.slice(HTML.indexOf("*/", ini) + 2, HTML.lastIndexOf("/*", fim));
// a barra de documento vive noutro módulo; aqui só interessa o miolo do regulamento
const STUB = 'var pxDocBarraHtml=function(){return {css:"",html:"<!--barra-->"};};\n';
const M = new Function(STUB + codigo +
  "\nreturn {REG_DOC,regEsc,regDobra,regMarca,regBate,regTextos,regItemHtml,regTotalArtigos,regDocHtml,"
  + "setTermo:function(t){ regTermo=t; }};")();

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  [" + obtido + "]" + (bate ? "" : "   (esperado: [" + esperado + "])"));
  bate ? ok++ : falhou++;
}
function certo(nome, cond) { eq(nome, cond ? "sim" : "não", "sim"); }

// ---------------------------------------------------------------------------
// 1) FIDELIDADE AO PDF OFICIAL
// O cabeçalho/rodapé se repete em toda página do PDF e parte frases no meio
// (Art. 11 cai bem na virada). Tirar essa linha é o que deixa o texto contínuo.
// ---------------------------------------------------------------------------
const RODAPE = /G JOÃO DOS SANTOS INDÚSTRIA E COMERCIO LTDA 12\.988\.127\/0001-40\s*R\. ANDRE SALES 531, PAULO XI – CAICÓ\/RN, TEL: \(84\) 3417-1677/g;
const NOPDF = PDF.replace(RODAPE, " ").replace(/\s+/g, " ").trim();
const norm = (s) => String(s).replace(/\s+/g, " ").trim();

console.log("\n== 1. Fidelidade: cada trecho existe, igualzinho, no PDF oficial ==");
const D = M.REG_DOC;
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
// O cabeçalho/rodapé foi retirado do texto acima de propósito, então ele se confere
// contra o PDF cru — é lá que a linha da empresa aparece inteira, em toda página.
const CRU = PDF.replace(/\s+/g, " ").trim();
["empresa", "cnpj", "endereco", "telefone"].forEach((k) =>
  certo("o " + k + " da tela é o do PDF", CRU.indexOf(norm(D[k])) >= 0));
certo("a data do documento é a do PDF", CRU.indexOf(norm(D.localData)) >= 0);

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
certo("acha 'uniforme' no Art. 5º", M.regBate ? true : false);
M.setTermo("uniforme");
const art5 = D.capitulos[2].itens[0];
certo("Art. 5º entra na busca por 'uniforme' (está na alínea r)", M.regBate(M.regTextos(art5)));
M.setTermo("pendrive");
const art21 = D.capitulos[8].itens[0];
certo("Art. 21 entra na busca por 'pendrive' (está na alínea p)", M.regBate(M.regTextos(art21)));
M.setTermo("bicicleta");
certo("palavra que não existe no regulamento não traz o Art. 21", !M.regBate(M.regTextos(art21)));

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
// 3) O PAPEL — imprime o documento inteiro, com ou sem busca na tela
// ---------------------------------------------------------------------------
console.log("\n== 3. O que sai na impressora ==");
M.setTermo("uniforme");                       // busca ligada na tela
const papel = M.regDocHtml();
let faltando = 0;
D.capitulos.forEach((c) => c.itens.forEach((it) => { if (papel.indexOf(M.regEsc(it.txt)) < 0) faltando++; }));
eq("com a busca ligada, o papel ainda traz TODOS os artigos", faltando, 0);
certo("o papel não leva destaque amarelo", papel.indexOf("<mark>") < 0);
certo("traz a frase de ciência do documento", papel.indexOf(M.regEsc(D.ciencia)) >= 0);
certo("traz o local e a data do documento", papel.indexOf(M.regEsc(D.localData)) >= 0);
// O rodapé repetido é <tfoot>, NÃO position:fixed. O fixed repete mas não desconta a
// altura, e o texto saiu impresso POR CIMA dele em 4 das 10 folhas (medido em
// scripts/previa-regulamento-papel.cjs). Se alguém voltar pro fixed, aqui fica vermelho.
certo("o rodapé repetido é <tfoot> (reserva o espaço em toda folha)",
      /<tfoot><tr><td class="rod">/.test(papel) && /tfoot\{display:table-footer-group/.test(papel));
certo("nada de position:fixed no rodapé (já sobrepôs o texto)", !/\.rod\{position:fixed/.test(papel));
certo("o rodapé traz a empresa e o CNPJ", papel.indexOf(M.regEsc(D.empresa)) >= 0 && papel.indexOf(D.cnpj) >= 0);
certo("folha A4", papel.indexOf("@page{size:A4") >= 0);
M.setTermo("");

// ---------------------------------------------------------------------------
// 4) A PORTA ABERTA — todo funcionário enxerga a aba
// ---------------------------------------------------------------------------
console.log("\n== 4. Todo mundo vê o Regulamento ==");
function pegarFuncao(nome) {
  const i = HTML.indexOf("function " + nome + "(");
  if (i < 0) return null;
  let j = HTML.indexOf("{", i), d = 0, k = j;
  while (k < HTML.length) { if (HTML[k] === "{") d++; else if (HTML[k] === "}") { d--; if (!d) break; } k++; }
  return HTML.slice(i, k + 1);
}
const fonteAba = pegarFuncao("podeAba");
certo("achei a regra de quem vê cada aba (podeAba)", !!fonteAba);
const podeAba = new Function("ok", fonteAba + "\nreturn podeAba;")([]);   // alguém SEM nenhuma página liberada
certo("funcionário sem nenhuma página liberada vê o Regulamento", podeAba("regulamento"));
certo("...e continua sem ver as outras (a exceção é só do regulamento)", !podeAba("despesas") && !podeAba("pontos"));
const comUma = new Function("ok", fonteAba + "\nreturn podeAba;")(["escala"]);
certo("quem só tem Escala também vê o Regulamento", comUma("regulamento"));
certo("o botão existe no menu", HTML.indexOf('data-page="regulamento"') >= 0);
certo("a página existe", HTML.indexOf('id="page-regulamento"') >= 0);
certo("abrir a aba desenha o regulamento", /dataset\.page==="regulamento"\)\s*regRender\(\)/.test(HTML));

console.log("\n== 4b. Consulta não gasta nuvem (esta aba não fala com o Supabase) ==");
const miolo = codigo;
certo("não usa __SB", miolo.indexOf("__SB") < 0);
certo("não chama rpc", miolo.indexOf(".rpc(") < 0);
certo("não faz select/insert", miolo.indexOf(".select(") < 0 && miolo.indexOf(".insert(") < 0);

console.log("\n" + (falhou ? "FALHOU: " + falhou + " de " + (ok + falhou) : "TUDO CERTO: " + ok + " provas"));
process.exit(falhou ? 1 : 0);
