// CENTRAL OPERACIONAL — onde o botão dela entra no menu.
//
// Queixa do dono em 11/09/2026: o botão ficava preso no rodapé da barra, colado na borda
// esquerda e mais largo que os outros. Causa: os botões de verdade moram dentro de
// <div class="nav-scroll"> (é ele que tem a margem lateral e é ele que rola), e a Central
// fazia appendChild na <nav>, caindo FORA da lista.
//
// Extrai o bloco do painel GERADO e roda. Não procura texto no arquivo.
//   node scripts/testes/central-botao-menu.test.cjs
const fs = require("fs");
const path = require("path");

const HTML = fs.readFileSync(path.join(__dirname, "..", "..", "output", "index.html"), "utf8");
const ini = HTML.indexOf("==CONAV-INICIO==");
const fim = HTML.indexOf("==CONAV-FIM==");
if (ini < 0 || fim < 0) { console.log("ERRO: não achei o bloco ==CONAV-*== no output/index.html (rode o build antes)."); process.exit(1); }
const codigo = HTML.slice(HTML.indexOf("*/", ini) + 2, HTML.lastIndexOf("/*", fim));
const coOndeEntra = new Function(codigo + "\nreturn coOndeEntra;")();

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  [" + obtido + "]" + (bate ? "" : "   (esperado: [" + esperado + "])"));
  bate ? ok++ : falhou++;
}

/* ---- uma barra de menu de mentira ---- */
function no(nome, classe, filhos) {
  return {
    nome: nome, classe: classe || "", filhos: filhos || [],
    querySelector: function (sel) {
      const quer = sel.replace(/^\./, "");
      for (const f of this.filhos) { if (f.classe === quer) return f; }
      for (const f of this.filhos) { const d = f.querySelector ? f.querySelector(sel) : null; if (d) return d; }
      return null;
    },
  };
}

console.log("\n== A barra do Painel: a lista que rola existe ==");
const lista = no("lista", "nav-scroll", []);
const barra = no("barra", "sidebar", [no("titulo", "titulo", []), lista]);
eq("o botão entra DENTRO da lista", coOndeEntra(barra).nome, "lista");
eq("  ou seja: não vai para a barra", coOndeEntra(barra) === barra, false);

console.log("\n== Se um dia a lista sumir, o botão ainda aparece ==");
const semLista = no("barra", "sidebar", [no("titulo", "titulo", [])]);
eq("cai na própria barra, não em lugar nenhum", coOndeEntra(semLista).nome, "barra");

console.log("\n== Nada de quebrar quando a barra ainda não existe ==");
eq("sem barra, devolve nada e não estoura", coOndeEntra(null), null);

console.log("\n== Se a busca estourar, o botão não pode sumir ==");
const quebrada = { nome: "barra", querySelector: function () { throw new Error("busca quebrou"); } };
eq("cai na própria barra", coOndeEntra(quebrada).nome, "barra");

console.log("\n== A lista pode estar mais fundo na barra ==");
const fundo = no("barra", "sidebar", [no("caixa", "wrap", [no("lista", "nav-scroll", [])])]);
eq("acha a lista mesmo aninhada", coOndeEntra(fundo).nome, "lista");

console.log("\n" + ok + " provas passaram, " + falhou + " falharam.");
process.exit(falhou ? 1 : 0);
