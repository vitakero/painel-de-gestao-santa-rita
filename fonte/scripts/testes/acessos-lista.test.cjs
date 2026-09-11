// ACESSOS — a lista de caixinhas de permissão.
//
// Duas queixas reais, ambas de 11/09/2026, ambas na MESMA linha do painel:
//   1. o dono não conseguia dar a Central Operacional a ninguém — a caixinha dela não existia
//      na tela, porque a Central monta o próprio botão de menu DEPOIS, e a lista é feita a
//      partir dos botões que estão no menu naquele instante;
//   2. três nomes saíam com o número do aviso colado: "Agenda0", "Pontos extras19",
//      "Manutenções2".
//
// Este teste NÃO procura texto no arquivo: ele EXTRAI o bloco do painel gerado e RODA, com um
// menu de mentira montado aqui. É a diferença entre "a linha está escrita" e "a linha funciona".
//   node scripts/testes/acessos-lista.test.cjs
const fs = require("fs");
const path = require("path");

const HTML = fs.readFileSync(path.join(__dirname, "..", "..", "output", "index.html"), "utf8");
const ini = HTML.indexOf("==ACSLISTA-INICIO==");
const fim = HTML.indexOf("==ACSLISTA-FIM==");
if (ini < 0 || fim < 0) { console.log("ERRO: não achei o bloco da lista no output/index.html (rode o build antes)."); process.exit(1); }
// o bloco é delimitado por duas linhas de comentário: pega da linha do INICIO até a do FIM.
const codigo = HTML.slice(HTML.lastIndexOf("\n", ini) + 1, HTML.indexOf("\n", fim) + 1);

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  [" + obtido + "]" + (bate ? "" : "\n         esperado: [" + esperado + "]"));
  bate ? ok++ : falhou++;
}

/* ---- UM MENU DE MENTIRA, com o pouco que o bloco encosta ---- */
function botao(chave, rotulo, bolinha) {
  const filhos = [];
  if (bolinha != null) filhos.push({ classe: "nav-badge", texto: String(bolinha) });
  const no = {
    dataset: { page: chave },
    _rotulo: rotulo, _filhos: filhos,
    get textContent() { return this._rotulo + this._filhos.map(f => f.texto).join(""); },
    cloneNode() {
      const c = botao(chave, rotulo);
      c._filhos = filhos.map(f => Object.assign({}, f));
      c._filhos.forEach(f => { f.parentNode = { removeChild: x => { c._filhos = c._filhos.filter(y => y !== x); } }; });
      return c;
    },
    querySelectorAll(sel) {
      const quer = sel.split(",").map(s => s.trim().replace(/^\./, ""));
      return this._filhos.filter(f => quer.indexOf(f.classe) >= 0);
    },
  };
  return no;
}
function rodar(botoes) {
  const doc = { querySelectorAll: () => botoes };
  return new Function("document", codigo + "\nreturn pages;")(doc);
}
const chaves = l => l.map(p => p.key).join(",");
const rotuloDe = (l, k) => { const p = l.find(x => x.key === k); return p ? p.label : "(não existe)"; };

console.log("\n== A QUEIXA 1: a Central Operacional ainda não montou o botão dela ==");
// é exatamente o menu que o dono tinha na tela: tem a Logística, NÃO tem a Operacional
let r = rodar([botao("vendas", "Vendas"), botao("central", "Central Logística", 0),
               botao("cartaz", "Cartaz de oferta"), botao("config", "Configurações"),
               botao("acessos", "Acessos")]);
eq("a caixinha da Central Operacional existe assim mesmo", r.some(p => p.key === "operacional"), true);
eq("  e vem com o nome certo", rotuloDe(r, "operacional"), "Central Operacional");
eq("  e fica logo depois da Central Logística", chaves(r), "vendas,central,operacional,cartaz,config");
eq("  a tela de Acessos nunca vira caixinha", r.some(p => p.key === "acessos"), false);

console.log("\n== E quando a Central JÁ montou: uma só, no mesmo lugar ==");
r = rodar([botao("vendas", "Vendas"), botao("central", "Central Logística"),
           botao("cartaz", "Cartaz de oferta"), botao("operacional", "Central Operacional"),
           botao("acessos", "Acessos")]);
eq("não aparece duas vezes", r.filter(p => p.key === "operacional").length, 1);
eq("  e vai para o lado da Logística, não para o fim", chaves(r), "vendas,central,operacional,cartaz");

console.log("\n== Sem Central Logística no menu, ela ainda assim entra ==");
r = rodar([botao("vendas", "Vendas"), botao("acessos", "Acessos")]);
eq("entra no fim", chaves(r), "vendas,operacional");

console.log("\n== A QUEIXA 2: o número do aviso colado no nome ==");
r = rodar([botao("agenda", "Agenda", 0), botao("pontos", "Pontos extras", 19),
           botao("manutencoes", "Manutenções", 2), botao("recibos", "Recibos"),
           botao("acessos", "Acessos")]);
eq("Agenda não vira Agenda0", rotuloDe(r, "agenda"), "Agenda");
eq("Pontos extras não vira Pontos extras19", rotuloDe(r, "pontos"), "Pontos extras");
eq("Manutenções não vira Manutenções2", rotuloDe(r, "manutencoes"), "Manutenções");
eq("quem não tem aviso continua igual", rotuloDe(r, "recibos"), "Recibos");
eq("nenhum nome termina em número", r.filter(p => /\d$/.test(p.label)).length, 0);

console.log("\n== O botão da Central traz a bolinha dela (co-badge) ==");
const co = botao("operacional", "Central Operacional");
co._filhos.push({ classe: "co-badge", texto: "8" });
r = rodar([co, botao("acessos", "Acessos")]);
eq("o 8 não gruda no nome", rotuloDe(r, "operacional"), "Central Operacional");

console.log("\n== A ARMADILHA DO ARQUIVO: a barra invertida some no caminho ==");
// demoDashboard.ts inteiro é UM texto só. Escrever /\\s+/ com uma barra só faz o painel
// gerado receber /s+/ — que apaga todo "s". Foi o que aconteceu na 1ª tentativa, em 11/09.
// Por isso a prova abaixo usa nomes cheios de "s": ela cai na hora se a barra sumir de novo.
r = rodar([botao("pontos", "Pontos extras sessenta"), botao("acessos", "Acessos")]);
eq("nome cheio de s chega inteiro", rotuloDe(r, "pontos"), "Pontos extras sessenta");

console.log("\n" + ok + " provas passaram, " + falhou + " falharam.");
process.exit(falhou ? 1 : 0);
