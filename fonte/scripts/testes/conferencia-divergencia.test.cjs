// Testes da LEITURA da divergência da Central Logística (bloco que o dono usa pra decidir
// se cobra ou não cobra o fornecedor).
//
// Cada teste aqui nasceu de um defeito CONFIRMADO numa revisão adversarial de 09/08/2026,
// com caso real do VR. Não é teste de enfeite: se um destes cair, alguém vai cobrar errado.
//   node scripts/testes/conferencia-divergencia.test.cjs
const fs = require("fs");
const path = require("path");

const HTML = fs.readFileSync(path.join(__dirname, "..", "..", "output", "index.html"), "utf8");
function bloco(marca) {
  const i = HTML.indexOf("==" + marca + "-INICIO==");
  const f = HTML.indexOf("==" + marca + "-FIM==");
  if (i < 0 || f < 0) { console.log("ERRO: não achei o módulo " + marca + " (rode o build antes)."); process.exit(1); }
  return HTML.slice(HTML.indexOf("*/", i) + 2, HTML.lastIndexOf("/*", f));
}

// Utilitários da tela que o módulo usa. Dublês fiéis ao original.
const APOIO = `
  function pxEsc(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"); }
  function clNum(v){ v=+v||0; return v.toLocaleString("pt-BR",{maximumFractionDigits:3}); }
  function clDinheiro(v){ v=+v||0; return v?("R$ "+v.toLocaleString("pt-BR",
    {minimumFractionDigits:2,maximumFractionDigits:2})):"—"; }
  var CL_DV_BLOCOS=[
    { chave:"pedido", tipos:["QUANTIDADE","QUANTIDADE/CUSTO","NAO ENTREGUE","SEM PEDIDO"],
      titulo:"O que foi pedido × o que a nota trouxe", ajuda:"ajuda pedido",
      cols:["Pedido","Na nota","Diferença"] },
    { chave:"doca", tipos:["COLETOR"], titulo:"Erro de contagem que ficou sem correção",
      ajuda:"ajuda doca", cols:["Contado","Na nota","Diferença"] },
    { chave:"preco", tipos:["CUSTO","CUSTO ANTERIOR"], titulo:"Só mudança de preço",
      ajuda:"ajuda preco", cols:[] }
  ];
`;
const M = new Function(APOIO + bloco("CONFDV") +
  "\nreturn {clDvLinha,clDvBlocosHtml,clDvPreco,clDvPeso,clDvFantasma,clDvUnidadeSuspeita," +
  "clDvTotais,clDvTotalHtml,clDvRodapeHtml,CL_DV_BLOCOS};")();

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + obtido +
              (bate ? "" : "   (esperado: " + esperado + ")"));
  bate ? ok++ : falhou++;
}
const nb = (x) => String(x).replace(/ /g, " ");
function tem(nome, html, trecho) { eq(nome, nb(html).indexOf(nb(trecho)) >= 0, "true"); }
function naoTem(nome, html, trecho) { eq(nome, nb(html).indexOf(nb(trecho)) >= 0, "false"); }

const DOCA = M.CL_DV_BLOCOS[1], PEDIDO = M.CL_DV_BLOCOS[0], PRECO = M.CL_DV_BLOCOS[2];
function item(o) {
  return Object.assign({ tipo: "COLETOR", produto: "PRODUTO X", pedido: 0, veio: 0,
                         custo_pedido: 0, custo_nota: 0, preco: 0, emb: 1, nunca: false }, o);
}

console.log("\n-- falta comprovada: contou e faltou (caso GUARAVES, file de peito) --");
{
  const h = M.clDvLinha(DOCA, item({ produto: "FILE PEITO", pedido: 118, veio: 120, preco: 17.91 }));
  tem("mostra o contado", h, ">118<");
  tem("mostra o da nota", h, ">120<");
  tem("diferença +2", h, "+2");
  tem("valor 2 x 17,91", h, "R$ 35,82");
  tem("marcada como ruim", h, 'class="n ruim"');
}

console.log("\n-- não foi contado: TERCEIRO estado, não 'contou zero' (caso GUARAVES, mortadela) --");
{
  const h = M.clDvLinha(DOCA, item({ produto: "MORT", pedido: 0, veio: 50, preco: 9.15, nunca: true }));
  tem("escreve não foi contado", h, "não foi contado");
  tem("mostra o que a nota cobra", h, ">50<");
  tem("valor em jogo aparece", h, "R$ 457,50");
  // O defeito era este: a linha dizia "ninguém contou" e ao mesmo tempo "+50 de falta".
  naoTem("NÃO inventa diferença", h, "+50");
  naoTem("NÃO pinta de falta comprovada", h, 'class="n ruim"');
  naoTem("NÃO deixa a linha em vermelho", h, '<tr class="g">');
  tem("diferença fica vazia", h, 'class="n vz">—<');
  tem("valor em âmbar, não em vermelho", h, 'class="n nb"');
}

console.log("\n-- unidade trocada: recusa a conta em vez de inventar prejuízo (caso SACO PP) --");
{
  const h = M.clDvLinha(DOCA, item({ produto: "SACO PP", pedido: 2000, veio: 12, preco: 39.93 }));
  tem("avisa a unidade", h, "unidades diferentes");
  naoTem("NÃO mostra os R$ 79 mil", h, "79.384");
  naoTem("NÃO pinta de verde", h, 'class="n bom"');
  tem("mantém os dois números crus", h, ">2.000<");
  eq("2000 contra 12 é suspeito", M.clDvUnidadeSuspeita(2000, 12), "true");
  eq("118 contra 120 não é", M.clDvUnidadeSuspeita(118, 120), "false");
  eq("19x ainda passa", M.clDvUnidadeSuspeita(19, 1), "false");
  eq("20x já barra", M.clDvUnidadeSuspeita(20, 1), "true");
  eq("zero de um lado não julga", M.clDvUnidadeSuspeita(0, 500), "false");
}

console.log("\n-- não entregue: o preço vem do PEDIDO quando o produto não está na nota --");
{
  const h = M.clDvLinha(PEDIDO, item({ tipo: "NAO ENTREGUE", produto: "BISC CLUB SOCIAL",
                                       pedido: 220, veio: 0, preco: 0, custo_pedido: 5.2 }));
  tem("preço do pedido aparece", h, "R$ 5,20");
  tem("valor 220 x 5,20", h, "R$ 1.144,00");
  naoTem("não sobra traço na coluna valor", h, 'class="n ruim">—<');
  eq("preço cai pro custo do pedido", M.clDvPreco({ preco: 0, custo_pedido: 5.2 }), "5.2");
  eq("preço da nota tem prioridade", M.clDvPreco({ preco: 3.1, custo_pedido: 5.2 }), "3.1");
  eq("sem nenhum dos dois dá zero", M.clDvPreco({}), "0");
}

console.log("\n-- cópia fantasma: a nota cobra 0, então não é erro de contagem --");
{
  eq("nota 0 com contagem é fantasma", M.clDvFantasma(item({ pedido: 116, veio: 0 })), "true");
  eq("nota 0 sem contagem não é", M.clDvFantasma(item({ pedido: 0, veio: 0 })), "false");
  eq("linha normal não é", M.clDvFantasma(item({ pedido: 118, veio: 120 })), "false");
  eq("só vale pro coletor", M.clDvFantasma(item({ tipo: "NAO ENTREGUE", pedido: 44, veio: 0 })), "false");

  const h = M.clDvBlocosHtml([item({ produto: "REFRIG CAJU", pedido: 30, veio: 0 })]);
  naoTem("some da tabela", h, "REFRIG CAJU");
  tem("mas avisa que escondeu", h, "1 linha escondida");
  tem("e explica o motivo", h, "cópia que o VR grava");
}

console.log("\n-- ordem: o dinheiro manda, não o alfabeto --");
{
  const h = M.clDvBlocosHtml([
    item({ produto: "AAA BARATO", pedido: 10, veio: 11, preco: 1 }),
    item({ produto: "ZZZ CARO", pedido: 100, veio: 150, preco: 20 })
  ]);
  eq("o caro vem primeiro", h.indexOf("ZZZ CARO") < h.indexOf("AAA BARATO"), "true");
  eq("peso = diferença x preço", M.clDvPeso(item({ pedido: 100, veio: 150, preco: 20 })), "1000");
  eq("peso do não contado é o valor em jogo", M.clDvPeso(item({ pedido: 0, veio: 50, preco: 9.15, nunca: true })), "457.5");
  eq("fantasma vai pro fim", M.clDvPeso(item({ pedido: 116, veio: 0 })), "-1");
}

console.log("\n-- casos difíceis que não podem derrubar a tela --");
{
  eq("lista vazia não quebra", M.clDvBlocosHtml([]), "");
  const h1 = M.clDvLinha(DOCA, item({ produto: 'ASPAS " E <TAG>', pedido: 1, veio: 2 }));
  tem("escapa aspas e tag", h1, "ASPAS &quot; E &lt;TAG&gt;");
  naoTem("não injeta tag crua", h1, "<TAG>");
  const h2 = M.clDvLinha(DOCA, item({ pedido: 1, veio: 2, preco: 0 }));
  tem("sem preço mostra traço", h2, "—");
  const h3 = M.clDvLinha(PRECO, item({ tipo: "CUSTO ANTERIOR", preco: 10.93 }));
  tem("bloco de preço mostra o custo", h3, "R$ 10,93");
  tem("bloco de preço mostra o motivo", h3, "custo anterior");
  const h4 = M.clDvLinha(DOCA, item({ pedido: 3.5, veio: 3.5, preco: 2, emb: 12 }));
  tem("embalagem aparece", h4, "caixa com 12");
  const h5 = M.clDvBlocosHtml([item({ tipo: "TIPO NOVO DO VR", pedido: 1, veio: 2 })]);
  eq("tipo desconhecido não aparece em bloco nenhum", h5, "");
}

console.log("\n-- o que NÃO pode mudar: falta comprovada continua valendo dinheiro --");
{
  const h = M.clDvBlocosHtml([
    item({ produto: "FILE PEITO", pedido: 118, veio: 120, preco: 17.91 }),
    item({ produto: "MORT", pedido: 0, veio: 50, preco: 9.15, nunca: true })
  ]);
  tem("as duas linhas ficam", h, "FILE PEITO");
  tem("as duas linhas ficam (2)", h, "MORT");
  tem("o valor da falta real continua", h, "R$ 35,82");
  eq("o não contado vem antes por valer mais", h.indexOf("MORT") < h.indexOf("FILE PEITO"), "true");
}

console.log("\n-- dinheiro em cada etapa: pediu X, veio Y, faltou Z (caso I M DOS SANTOS VALE) --");
{
  // Pedido 30 e nota 20 a R$ 4,00: R$ 120,00 pedido, R$ 80,00 na nota, R$ 40,00 de falta.
  const h = M.clDvLinha(PEDIDO, item({ tipo: "QUANTIDADE", produto: "SORDA PRETA",
                                       pedido: 30, veio: 20, preco: 4 }));
  tem("valor do que foi pedido", h, "R$ 120,00");
  tem("valor do que veio na nota", h, "R$ 80,00");
  tem("valor do que faltou", h, "R$ 40,00");
  tem("os três em linha de apoio", h, 'class="dv"');
  eq("três valores na mesma linha", (h.match(/class="dv"/g) || []).length, "3");
  naoTem("acabou a coluna Valor solta", h, "<th");
}

console.log("\n-- total de CADA coluna: comprei, ele faturou, a diferença --");
{
  const lista = [
    item({ tipo: "QUANTIDADE", produto: "A", pedido: 30, veio: 20, preco: 4 }),        // 120 / 80
    item({ tipo: "NAO ENTREGUE", produto: "B", pedido: 10, veio: 0, custo_pedido: 5 }) //  50 /  0
  ];
  const t = M.clDvTotais(PEDIDO, lista);
  eq("total do que foi pedido", t.pedido, "170");
  eq("total do que a nota trouxe", t.nota, "80");
  eq("diferença é nota menos pedido", t.dif, "-90");
  const h = M.clDvBlocosHtml(lista);
  tem("mostra os três totais (pedido)", h, "R$ 170,00");
  tem("mostra os três totais (nota)", h, "R$ 80,00");
  tem("mostra os três totais (diferença)", h, "R$ 90,00");
  tem("diz o que a diferença é", h, "faltou do pedido");
  tem("rótulo da linha de total", h, ">Total<");
}
{
  // Falta e sobra no mesmo bloco: o total tem que ser o LÍQUIDO, não a soma dos módulos.
  // Caso real MASSAS QUIXABA: somando módulo dava R$ 1.640,10; o buraco real é R$ 1.218,90.
  const lista = [
    item({ tipo: "QUANTIDADE", produto: "FALTOU", pedido: 260, veio: 17, preco: 4.5 }),
    item({ tipo: "QUANTIDADE", produto: "SOBROU", pedido: 30, veio: 60, preco: 4.5 })
  ];
  const t = M.clDvTotais(PEDIDO, lista);
  eq("líquido, não soma de módulos", t.dif.toFixed(2), "-958.50");
  const h = M.clDvBlocosHtml(lista);
  naoTem("NÃO mostra a soma dos módulos", h, "R$ 1.228,50");
}
{
  const lista = [
    item({ produto: "FILE", pedido: 118, veio: 120, preco: 17.91 }),
    item({ produto: "MORT", pedido: 0, veio: 50, preco: 9.15, nunca: true }),
    item({ produto: "SACO", pedido: 2000, veio: 12, preco: 39.93 })
  ];
  const t = M.clDvTotais(DOCA, lista);
  eq("só as comparáveis entram", t.linhas, "1");
  eq("total contado", t.pedido.toFixed(2), "2113.38");
  eq("total cobrado na nota", t.nota.toFixed(2), "2149.20");
  eq("diferença cobrada e não achada", t.dif.toFixed(2), "35.82");
  eq("o não contado fica de fora", t.aConferir.toFixed(2), "457.50");
  eq("a unidade trocada só é contada", t.semConta, "1");
  const h = M.clDvBlocosHtml(lista);
  tem("rótulo da doca", h, "cobrado e não achado");
  tem("o a conferir vem separado", h, "a conferir");
  tem("avisa a linha sem conta", h, "1 linha sem conta");
  // O erro que isto impede: somar R$ 35,82 + R$ 457,50 e mandar cobrar R$ 493,32.
  naoTem("NÃO junta prova com suspeita", h, "R$ 493,32");
}
{
  // Quando o caminhão vem certo, o total não pode gritar.
  const t = M.clDvTotais(PEDIDO, [item({ tipo: "CUSTO", pedido: 10, veio: 10, preco: 3 })]);
  eq("bateu dá zero", t.dif, "0");
  eq("bloco de preço não ganha total", M.clDvTotalHtml(PRECO, [item({ tipo: "CUSTO", preco: 9 })]), "");
  eq("lista vazia não gera total", M.clDvTotalHtml(DOCA, []), "");
  // Bloco só com linha não comparável: não pode inventar total nenhum.
  const so = M.clDvTotalHtml(DOCA, [item({ produto: "SACO", pedido: 2000, veio: 12, preco: 39.93 })]);
  tem("sem linha comparável mostra traço", so, ">—<");
  tem("mas avisa o motivo", so, "1 linha sem conta");
}

console.log("\n-- falta e sobra no mesmo bloco: os dois lados aparecem (caso GRANJA CASCAVEL) --");
{
  // Faltou R$ 3.900 e veio a mais R$ 16.400. O líquido sozinho dizia só "R$ 12.500 a mais"
  // e a falta sumia da tela.
  const lista = [
    item({ tipo: "QUANTIDADE", produto: "FALTOU", pedido: 100, veio: 61, preco: 100 }),   // -3900
    item({ tipo: "SEM PEDIDO", produto: "SOBROU", pedido: 0, veio: 164, preco: 100 })     // +16400
  ];
  const t = M.clDvTotais(PEDIDO, lista);
  eq("guarda a falta separada", t.falta, "3900");
  eq("guarda a sobra separada", t.sobra, "16400");
  eq("e o líquido continua certo", t.dif, "12500");
  const h = M.clDvBlocosHtml(lista);
  tem("mostra o líquido", h, "R$ 12.500,00");
  tem("mas não esconde a falta", h, "faltou R$ 3.900,00");
  tem("nem a sobra", h, "veio a mais R$ 16.400,00");
}
{
  // Só falta: não precisa da linha de detalhe, seria ruído.
  const h = M.clDvBlocosHtml([item({ tipo: "QUANTIDADE", pedido: 30, veio: 20, preco: 4 })]);
  naoTem("sem os dois lados, não abre o detalhe", h, "veio a mais R$");
}

console.log("\n-- o rodapé fala do que está na tela --");
{
  const semDoca = M.clDvRodapeHtml([item({ tipo: "QUANTIDADE", pedido: 30, veio: 20, preco: 4 })]);
  naoTem("cartão sem contagem não fala de contagem", semDoca, "Erro de contagem que aparece aqui");
  tem("explica o que ELE tem", semDoca, "não teve erro de contagem");

  const comDoca = M.clDvRodapeHtml([item({ pedido: 118, veio: 120, preco: 17.91 })]);
  tem("cartão com contagem fala de contagem", comDoca, "Erro de contagem que aparece aqui");
  naoTem("mas não avisa do não contado se não tem", comDoca, "não foi contado");

  const comNunca = M.clDvRodapeHtml([item({ pedido: 0, veio: 50, preco: 9.15, nunca: true })]);
  tem("com não contado, avisa", comNunca, "Cuidado com");

  // Cópia fantasma some da tela: não pode fazer o rodapé achar que existe bloco de contagem.
  const soFantasma = M.clDvRodapeHtml([item({ pedido: 116, veio: 0 }),
                                       item({ tipo: "QUANTIDADE", pedido: 30, veio: 20, preco: 4 })]);
  tem("fantasma não conta como bloco de contagem", soFantasma, "não teve erro de contagem");
}

console.log("\n" + (falhou ? "FALHOU: " + falhou + " de " + (ok + falhou) : "TUDO OK: " + ok + " testes"));
process.exit(falhou ? 1 : 0);
