// TRAVA: a lista da Central nao pode voltar a pedir tudo.
//
// Ate 26/08/2026 ela fazia select("*") em central_conferencias e trazia as 600
// conferencias INTEIRAS a cada abertura: 3,3 MB, dos quais 94% era um campo que a lista
// nem desenha (divergencia_detalhe, o item-a-item do que divergiu). Com 5 GB de franquia
// no mes, isso dava ~1.500 aberturas. Pedindo so o que a tela usa: 0,22 MB e o detalhe
// vindo no clique por 1,6 KB — os tres numeros medidos no dia.
//
//   node scripts/testes/central-pedir-pouco.test.cjs
const fs = require("fs");
const path = require("path");
const HTML = fs.readFileSync(path.join(__dirname, "..", "..", "output", "index.html"), "utf8");

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + obtido + (bate ? "" : "   (esperado: " + esperado + ")"));
  bate ? ok++ : falhou++;
}

// ---------------------------------------------------------------------------
// 1) a lista
// ---------------------------------------------------------------------------
eq("a lista NAO pede mais tudo", /from\("central_conferencias"\)\.select\("\*"\)/.test(HTML), false);
eq("existe a lista de colunas CL_CONF_COLS", /var\s+CL_CONF_COLS\s*=/.test(HTML), true);
eq("a lista usa CL_CONF_COLS", /from\("central_conferencias"\)\.select\(CL_CONF_COLS\)/.test(HTML), true);

const cols = (HTML.match(/var\s+CL_CONF_COLS\s*=\s*((?:"[^"]*"\s*\+?\s*)+);/) || [])[1] || "";
const lista = cols.replace(/"|\s|\+/g, "");
eq("pede o resumo por tipo, so o pedaco", lista.indexOf("divergencia_detalhe->tipos") >= 0, true);
eq("NAO pede o campo pesado inteiro", /divergencia_detalhe(?!->)/.test(lista), false);

// toda coluna que a tela desenha tem que estar na lista
["id","senha","data","fornecedor","bipagens","notas","notas_finalizadas","divergencias","situacao","minutos"]
  .forEach(c => eq("a lista pede " + c, lista.split(",").indexOf(c) >= 0, true));

// e as que a tela NAO desenha nao podem voltar. "loja" e sempre "1", "itens" e a contagem
// de itens da nota (que a tela nao escreve) e "atualizado_em" e carimbo de robo: 77 bytes
// por linha x 600 linhas = ~45 KB por abertura, jogados fora.
["loja","itens","atualizado_em"]
  .forEach(c => eq("a lista NAO pede " + c, lista.split(",").indexOf(c) >= 0, false));

// ---------------------------------------------------------------------------
// 2) o clique busca o detalhe, e avisa quando nao consegue
// ---------------------------------------------------------------------------
eq("o clique busca o detalhe daquela uma", /select\("divergencia_detalhe"\)\.eq\("id"/.test(HTML), true);
eq("guarda o que buscou (nao pede duas vezes)", /if\(c\.divergencia_detalhe\)\{\s*clDvPinta\(c\);\s*return;\s*\}/.test(HTML), true);
eq("erro NAO fica mudo", /clDvAviso\(c,"Não consegui buscar o detalhe/.test(HTML), true);
eq("sem conexao tambem avisa", /clDvAviso\(c,"Sem conexão com a nuvem/.test(HTML), true);
eq("tem estilo pro aviso", /\.cl-dv-aviso\{/.test(HTML), true);

// ---------------------------------------------------------------------------
// 3) o resumo por tipo — roda a funcao de verdade, nos tres formatos possiveis
// ---------------------------------------------------------------------------
const i = HTML.indexOf("function clConfTipos(");
let n = 0, fim = -1;
for (let k = HTML.indexOf("{", i); k < HTML.length; k++) {
  if (HTML[k] === "{") n++; else if (HTML[k] === "}") { n--; if (!n) { fim = k + 1; break; } }
}
eq("achei clConfTipos no painel", i >= 0 && fim > 0, true);
const clConfTipos = new Function(HTML.slice(i, fim) + "\nreturn clConfTipos;")();
const T = [{ tipo: "CUSTO", qtd: 4 }];
eq("lista nova: tipos soltos", JSON.stringify(clConfTipos({ tipos: T })), JSON.stringify(T));
eq("depois do clique: tipos dentro do campo", JSON.stringify(clConfTipos({ divergencia_detalhe: { tipos: T } })), JSON.stringify(T));
eq("dados de exemplo continuam valendo", JSON.stringify(clConfTipos({ divergencia_detalhe: { tipos: T, itens: [1] } })), JSON.stringify(T));
eq("sem divergencia: lista vazia", JSON.stringify(clConfTipos({ divergencias: 0 })), "[]");
eq("registro nulo nao quebra", JSON.stringify(clConfTipos(null)), "[]");
eq("tipos vazio cai pro campo inteiro", JSON.stringify(clConfTipos({ tipos: [], divergencia_detalhe: { tipos: T } })), JSON.stringify(T));

// O RESUMO POR TIPO NAO PODE SAIR DA LISTA DE ITENS. Ela tem teto de 60 e sai em ordem
// alfabetica de tipo; os tipos de CONTAGEM vem todos depois de CUSTO ANTERIOR, entao o corte
// comia justamente eles. Em 28/08/2026 isso fez a marcacao automatica ver "zero de contagem"
// num carro com 15 produtos NAO ENTREGUE (FAMA, 105 diferencas, painel via 60).
// Ate essa data ESTE TESTE COBRAVA O DEFEITO — exigia que o robo contasse a lista cortada.
// Agora cobra o contrario: os tipos vem do banco, contados sobre tudo.
const ROBO = fs.readFileSync(path.join(__dirname, "..", "vr-sync-conferencia.cjs"), "utf8");
eq("o robo NAO conta os tipos pela lista cortada", /for \(const i of itens\) conta\[i\.tipo\]/.test(ROBO), false);
eq("os tipos vem do banco, agrupados sem teto", /group by d\.tipo/.test(ROBO), true);
eq("e o teto de 60 continua so na lista de itens", (ROBO.match(/limit 60/g) || []).length, 1);
eq("montaDetalhe recebe os tipos prontos", /function montaDetalhe\(lista, tiposCompletos\)/.test(ROBO), true);
// E A ORDEM DA LISTA DE ITENS: o que FALTOU tem que vir antes do preco, senao o teto de 60
// come justamente os produtos que a loja quer ver. Na FAMA de 28/08 a lista guardada tinha
// 29 CUSTO + 31 CUSTO ANTERIOR e ZERO das 15 faltas — o dono clicava e nao achava nenhuma.
eq("a lista poe FALTA antes de preco", /order by case when d\.tipo in \('COLETOR','NAO ENTREGUE','QUANTIDADE',/.test(ROBO), true);
eq("e os 5 tipos de falta estao todos na frente",
   ["COLETOR","NAO ENTREGUE","QUANTIDADE","QUANTIDADE/CUSTO","SEM PEDIDO"]
     .every(t => new RegExp("'" + t.replace("/","\\/") + "'").test((ROBO.match(/order by case when[\s\S]{0,220}/)||[""])[0])), true);
eq("e e chamada com eles", /montaDetalhe\(x\.detalhe, x\.tipos\)/.test(ROBO), true);
eq("e devolve os dois juntos", /return \{ tipos, itens:/.test(ROBO), true);

console.log("\n" + ok + " ok, " + falhou + " falha(s).");
process.exit(falhou ? 1 : 0);
