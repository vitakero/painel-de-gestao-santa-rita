// Testes do IMPRIMIR VÁRIAS PLACAS DE UMA VEZ.
//
// Pedido de 02/09/2026: quem repõe as placas da loja imprimia UMA de cada vez (abrir a
// placa, confirmar, imprimir, fechar, repetir). Agora marca várias e manda tudo junto.
//
// O que estes testes protegem, em ordem de estrago:
//   1) CADA PLACA DO LOTE SAI COM A VALIDADE DELA. Antes, a validade vinha da tela — uma
//      só pra todas. Se isso quebrar, sai uma tanda inteira de placas com a data errada
//      colada na gôndola, e ninguém percebe olhando a tela.
//   2) Papéis diferentes não se misturam na mesma impressão (sairia cartaz cortado).
//   3) A conta de folhas que ela vê antes de mandar imprimir.
//   node scripts/testes/cartaz-lote.test.cjs
const fs = require("fs");
const path = require("path");

const HTML = fs.readFileSync(path.join(__dirname, "..", "..", "output", "index.html"), "utf8");
const ini = HTML.indexOf("==CZHIST-INICIO==");
const fim = HTML.indexOf("==CZHIST-FIM==");
if (ini < 0 || fim < 0) { console.log("ERRO: não achei o módulo CZHIST (rode o build antes)."); process.exit(1); }
const codigo = HTML.slice(HTML.indexOf("*/", ini) + 2, HTML.lastIndexOf("/*", fim));
const M = new Function(codigo +
  "\nreturn {czLoteFolhaDe,czLoteTandas,czLoteFolhas,czLoteNome,czLoteItens,czLoteSemArte,czHistParaItem,czHistRotulo};")();

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + obtido +
              (bate ? "" : "   (esperado: " + esperado + ")"));
  bate ? ok++ : falhou++;
}

const A4 = (extra) => Object.assign({ modelo:"padrao", tamanho:"A4", impressao:"multi",
  nome:"ARROZ", marca:"CAMIL", tipo:"", gramatura:"5KG", preco:"29,99", preco_de:"",
  validade_ini:"2026-09-01", validade_fim:"2026-09-08", limite_cliente:0, tema_nome:null }, extra||{});

console.log("\n-- 1) CADA PLACA LEVA O RETRATO DELA (a que mais dói se quebrar) --");
{
  /* Três placas impressas em dias diferentes, com limites e cabeçalhos diferentes. No lote
     elas saem na MESMA impressão — e cada uma tem que carregar a validade, o limite e a
     arte dela, senão as três saem com os dados da primeira. */
  const regs = [
    A4({ id:"a", nome:"ARROZ",   validade_ini:"2026-09-01", validade_fim:"2026-09-08", limite_cliente:2, tema_nome:"38 ANOS" }),
    A4({ id:"b", nome:"FEIJÃO",  validade_ini:"2026-08-31", validade_fim:"2026-09-06", limite_cliente:0, tema_nome:null }),
    A4({ id:"c", nome:"ÓLEO",    validade_ini:"2026-09-01", validade_fim:"2026-09-18", limite_cliente:5, tema_nome:"SUMIU" }),
  ];
  const temas = { "38 ANOS": { n:"38 ANOS", d:"data:img-38" } };
  const acha = (r) => (r.tema_nome ? (temas[r.tema_nome] || null) : null);
  const itens = M.czLoteItens(regs, acha);

  eq("são 3 itens", itens.length, 3);
  eq("1ª leva a validade DELA",       itens[0]._ft.val,    "2026-09-08");
  eq("2ª leva a validade DELA",       itens[1]._ft.val,    "2026-09-06");
  eq("3ª leva a validade DELA",       itens[2]._ft.val,    "2026-09-18");
  eq("1ª leva o início DELA",         itens[0]._ft.valIni, "2026-09-01");
  eq("2ª leva o início DELA",         itens[1]._ft.valIni, "2026-08-31");
  eq("1ª leva o limite DELA",         itens[0]._ft.limite, "2");
  eq("2ª sem limite vira '0'",        itens[1]._ft.limite, "0");
  eq("3ª leva o limite DELA",         itens[2]._ft.limite, "5");
  eq("1ª leva a arte DELA",           itens[0]._tema.d,    "data:img-38");
  eq("2ª é texto OFERTA (sem arte)",  itens[2 - 1]._tema,  null);
  eq("3ª perdeu a arte -> sem arte",  itens[2]._tema,      null);
  eq("qtd é sempre 1 (repõe uma)",    itens[0].qtd,        1);

  /* A ordem é a da lista na tela, que é a ordem em que as folhas saem da impressora. */
  eq("ordem preservada", itens.map(i => i.nome).join(","), "ARROZ,FEIJÃO,ÓLEO");
}

console.log("\n-- 2) SEM RETRATO, QUEM MANDA CONTINUA SENDO A TELA --");
{
  /* Quem monta cartaz pela tela não passa _ft nem _tema. O rodapé desses itens tem que
     continuar lendo as variáveis da tela — senão eu quebraria o gerador inteiro pra
     resolver o histórico. */
  const item = M.czHistParaItem(A4({}));
  eq("item do 'Ver a placa' não traz _ft",   item._ft,   "undefined");
  eq("item do 'Ver a placa' não traz _tema", item._tema, "undefined");
}

console.log("\n-- 3) PAPÉIS DIFERENTES NÃO SE MISTURAM --");
{
  eq("A4 é A4",                 M.czLoteFolhaDe(A4({})),                        "A4");
  eq("A6 é A6",                 M.czLoteFolhaDe(A4({tamanho:"A6"})),            "A6");
  eq("minúsculo vira maiúsculo",M.czLoteFolhaDe(A4({tamanho:"a5"})),            "A5");
  eq("sem tamanho cai em A4",   M.czLoteFolhaDe(A4({tamanho:null})),            "A4");
  eq("deitado é a folha dele",  M.czLoteFolhaDe(A4({modelo:"deitado"})),        "deitado");
  /* Pôster: emendar folhas A4 e folha única grande são páginas diferentes. */
  eq("A3 emendado",             M.czLoteFolhaDe(A4({tamanho:"A3"})),            "A3|multi");
  eq("A3 folha única",          M.czLoteFolhaDe(A4({tamanho:"A3",impressao:"unica"})), "A3|unica");

  /* PADRÃO E DE/POR SAEM JUNTOS. As duas dividem a mesma folha; quem muda é só o miolo do
     cartaz (o "DE:" riscado). Separá-las faria a funcionária imprimir duas vezes à toa. */
  eq("De/Por divide folha com o padrão",
     M.czLoteFolhaDe(A4({modelo:"depor"})), M.czLoteFolhaDe(A4({modelo:"padrao"})));

  const t = M.czLoteTandas([
    A4({id:"1"}), A4({id:"2",tamanho:"A5"}), A4({id:"3",modelo:"depor"}), A4({id:"4",tamanho:"A5"}),
  ]);
  eq("viraram 2 tandas", t.length, 2);
  eq("a 1ª é a do A4 (a primeira marcada)", t[0].folha, "A4");
  eq("com as 2 placas de A4", t[0].regs.map(r=>r.id).join(","), "1,3");
  eq("a 2ª é a do A5",        t[1].folha, "A5");
  eq("com as 2 placas de A5", t[1].regs.map(r=>r.id).join(","), "2,4");
  eq("lista vazia não quebra", M.czLoteTandas([]).length, 0);
  eq("nulo não quebra",        M.czLoteTandas(null).length, 0);
}

console.log("\n-- 4) A CONTA DE FOLHAS QUE ELA VÊ ANTES DE IMPRIMIR --");
{
  eq("8 placas A4 = 8 folhas",   M.czLoteFolhas("A4", 8), 8);
  eq("2 placas A5 = 1 folha",    M.czLoteFolhas("A5", 2), 1);
  /* 3 em A5 ainda gasta 2 folhas: a segunda sai pela metade, mas gasta papel inteiro. */
  eq("3 placas A5 = 2 folhas",   M.czLoteFolhas("A5", 3), 2);
  eq("4 placas A6 = 1 folha",    M.czLoteFolhas("A6", 4), 1);
  eq("5 placas A6 = 2 folhas",   M.czLoteFolhas("A6", 5), 2);
  eq("8 placas A7 = 1 folha",    M.czLoteFolhas("A7", 8), 1);
  eq("3 deitados = 2 folhas",    M.czLoteFolhas("deitado", 3), 2);
  /* O número que ninguém deve descobrir com a impressora rodando. */
  eq("2 pôsteres A1 emendados = 16 folhas", M.czLoteFolhas("A1|multi", 2), 16);
  eq("2 pôsteres A3 emendados = 4 folhas",  M.czLoteFolhas("A3|multi", 2), 4);
  eq("2 pôsteres A2 folha única = 2",       M.czLoteFolhas("A2|unica", 2), 2);
  eq("nenhuma marcada = 0 folhas",          M.czLoteFolhas("A4", 0), 0);
  eq("lixo não vira folha negativa",        M.czLoteFolhas("A4", -3), 0);
}

console.log("\n-- 5) O AVISO DE ARTE QUE SUMIU --");
{
  const temas = { "38 ANOS": { n:"38 ANOS", d:"x" } };
  const acha = (r) => (r.tema_nome ? (temas[r.tema_nome] || null) : null);
  const falta = M.czLoteSemArte([
    A4({ nome:"ARROZ", tema_nome:"38 ANOS" }),   // tem a arte: não avisa
    A4({ nome:"FEIJÃO", tema_nome:null }),       // texto OFERTA: nunca teve arte, não avisa
    A4({ nome:"ÓLEO", marca:"SINHÁ", gramatura:"900ML", tema_nome:"CAMPANHA VELHA" }),
  ], acha);
  eq("só a que perdeu a arte é avisada", falta.length, 1);
  eq("e é avisada pelo nome que ela lê", falta[0], "ÓLEO SINHÁ 900ML");
  eq("nenhuma perdida = nenhum aviso",
     M.czLoteSemArte([A4({tema_nome:"38 ANOS"})], acha).length, 0);
}

console.log("\n-- 6) O NOME DA TANDA NO AVISO --");
{
  eq("A4",              M.czLoteNome("A4"),        "A4");
  eq("deitado",         M.czLoteNome("deitado"),   "Deitado (2 por folha)");
  eq("pôster emendado", M.czLoteNome("A1|multi"),  "A1 (emendando folhas A4)");
  eq("pôster inteiro",  M.czLoteNome("A2|unica"),  "A2 (folha unica)");
}

console.log("\n" + (falhou ? ("FALHARAM " + falhou + " de " + (ok + falhou)) : ("TUDO OK: " + ok + " testes")));
process.exit(falhou ? 1 : 0);
