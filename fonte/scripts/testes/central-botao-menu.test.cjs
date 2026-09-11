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
function carregar(doc, win) {
  return new Function("document", "window", codigo +
    "\nreturn {coOndeEntra:coOndeEntra, coCriarBotaoMenu:coCriarBotaoMenu, coAvisarTrancada:coAvisarTrancada, montarBotaoTrancado:montarBotaoTrancado};")(doc, win);
}
const coOndeEntra = carregar({}, {}).coOndeEntra;

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

/* ---- um document e um window de mentira, para o botao trancado ---- */
function bancada(opc) {
  opc = opc || {};
  const lista = { nome: "lista", classe: "nav-scroll", filhos: [], querySelector: () => null,
                  appendChild(x) { this.filhos.push(x); } };
  const barra = { nome: "barra", classe: "sidebar",
                  querySelector: sel => (sel === ".nav-scroll" ? lista : null) };
  const doc = {
    createElement: () => ({ tipo: "", className: "", innerHTML: "", atributos: {}, cliques: [],
      setAttribute(k, v) { this.atributos[k] = v; },
      set type(v) { this.tipo = v; }, get type() { return this.tipo; },
      addEventListener(_, f) { this.cliques.push(f); } }),
    querySelector: sel => {
      if (sel === "nav.sidebar") return opc.semBarra ? null : barra;
      if (sel.indexOf("operacional") >= 0) return opc.jaTemBotao ? { nome: "botao que ja estava la" } : null;
      return null;
    },
  };
  const avisos = [];
  const win = {};
  if (opc.uiConfirm !== false) win.uiConfirm = o => { if (opc.uiConfirmQuebra) throw new Error("quebrou"); avisos.push(o); };
  win.alert = t => avisos.push({ alerta: t });
  return { doc, win, lista, avisos, M: carregar(doc, win) };
}

console.log("\n== Sem a permissão, o botão NÃO some: fica cinza com o cadeado ==");
let b = bancada();
eq("o botão foi criado", b.M.montarBotaoTrancado(), true);
eq("  entrou na lista que rola", b.lista.filhos.length, 1);
const trancado = b.lista.filhos[0];
eq("  nasce com o cadeado", /\bnav-locked\b/.test(trancado.className), true);
eq("  continua sendo um item de menu", /\bnav-item\b/.test(trancado.className), true);
eq("  aponta para a página certa", trancado.atributos["data-page"], "operacional");
eq("  e escreve o nome", /Central Operacional/.test(trancado.innerHTML), true);

console.log("\n== Com a permissão, o mesmo botão nasce SEM cadeado ==");
b = bancada();
eq("sem nav-locked", /nav-locked/.test(b.M.coCriarBotaoMenu(false).className), false);
eq("  e com nav-item", /\bnav-item\b/.test(b.M.coCriarBotaoMenu(false).className), true);

console.log("\n== Nunca dois botões ==");
b = bancada({ jaTemBotao: true });
eq("já existe um: não cria outro", b.M.montarBotaoTrancado(), false);
eq("  e a lista continua vazia", b.lista.filhos.length, 0);

console.log("\n== Sem a barra de menu, não estoura ==");
b = bancada({ semBarra: true });
eq("desiste em silêncio", b.M.montarBotaoTrancado(), false);

console.log("\n== Clicar no cadeado dá o MESMO aviso das outras abas ==");
b = bancada();
b.M.montarBotaoTrancado();
b.lista.filhos[0].cliques[0]();
eq("apareceu um aviso", b.avisos.length, 1);
eq("  com o título do Painel, acentuado igual ao dele", b.avisos[0].titulo, "Página bloqueada");
eq("  falando em pedir ao administrador", /administrador/.test(b.avisos[0].msg || ""), true);
eq("  sem botão de cancelar", b.avisos[0].cancel, "");

console.log("\n== O clique nunca pode virar um nada ==");
b = bancada({ uiConfirm: false });
b.M.montarBotaoTrancado();
b.lista.filhos[0].cliques[0]();
eq("sem uiConfirm, cai no alerta do navegador", /administrador/.test((b.avisos[0] || {}).alerta || ""), true);
b = bancada({ uiConfirmQuebra: true });
b.M.montarBotaoTrancado();
b.lista.filhos[0].cliques[0]();
eq("se uiConfirm estourar, também cai no alerta", /administrador/.test((b.avisos[0] || {}).alerta || ""), true);

console.log("\n" + ok + " provas passaram, " + falhou + " falharam.");
process.exit(falhou ? 1 : 0);
