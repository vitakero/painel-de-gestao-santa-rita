// Testes do RECIBO DE DOMINGO — o comprovante do pagamento em dinheiro pelo trabalho no
// domingo. É um documento que sai da loja assinado; valor errado ou data errada aqui vira
// problema com gente de verdade.
//   node scripts/testes/recibo-domingo.test.cjs
const fs = require("fs");
const path = require("path");

const HTML = fs.readFileSync(path.join(__dirname, "..", "..", "output", "index.html"), "utf8");
function bloco(marca) {
  const i = HTML.indexOf("==" + marca + "-INICIO==");
  const f = HTML.indexOf("==" + marca + "-FIM==");
  if (i < 0 || f < 0) { console.log("ERRO: não achei o módulo " + marca + " (rode o build antes)."); process.exit(1); }
  return HTML.slice(HTML.indexOf("*/", i) + 2, HTML.lastIndexOf("/*", f));
}
// pxNumExtenso vive fora dos marcadores; puxa o original do painel construído em vez de
// escrever uma cópia que pode divergir com o tempo.
function funcao(nome) {
  const i = HTML.indexOf("function " + nome + "(");
  if (i < 0) { console.log("ERRO: não achei " + nome); process.exit(1); }
  let d = 0, viu = false;
  for (let k = i; k < HTML.length; k++) {
    if (HTML[k] === "{") { d++; viu = true; }
    else if (HTML[k] === "}") { d--; if (viu && d === 0) return HTML.slice(i, k + 1); }
  }
  process.exit(1);
}

const APOIO = funcao("pxNumExtenso") + "\n" + funcao("pxEsc") + `
  var PX_LOCADOR={ razao:"G JOAO DOS SANTOS INDÚSTRIA E COMÉRCIO LTDA",
    fantasia:"Supermercado Santa Rita", cnpj:"12.988.127/0001-40", cidade:"Caicó/RN",
    endereco:"Rua André Sales, 531 - Paulo VI, Caicó/RN - CEP 59300-000",
    diretor:"Gilson João dos Santos" };
`;
const M = new Function(APOIO + bloco("RCB") +
  "\nreturn {rcbData,rcbDataExtenso,rcbEhDomingo,rcbMoeda,rcbExtenso,rcbNumero," +
  "rcbValidar,rcbTotal,rcbQuantos,rcbGrupos,rcbNormalizaTipos,rcbUmHtml,rcbFolhaHtml," +
  "rcbPgMotivo,rcbPgValidar,rcbPgUm,rcbPgFolhaHtml,rcbPgTotal};")();

// Um lote: data + grupos {nome, valor, quantidade}.
function lote(data, grupos){ return { data:data, grupos:grupos }; }
const G = (n, v, q) => ({ nome:n, valor:v, quantidade:q });

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + obtido +
              (bate ? "" : "   (esperado: " + esperado + ")"));
  bate ? ok++ : falhou++;
}
const nb = (x) => String(x).replace(/ /g, " ");
function tem(nome, html, trecho) { eq(nome, nb(html).indexOf(nb(trecho)) >= 0, "true"); }
function naoTem(nome, html, trecho) { eq(nome, nb(html).indexOf(nb(trecho)) >= 0, "false"); }

console.log("\n-- a data --");
eq("domingo escrito por extenso", M.rcbDataExtenso("2026-08-09"), "domingo, 09 de agosto de 2026");
eq("dia com um algarismo ganha zero", M.rcbDataExtenso("2026-03-01"), "domingo, 01 de março de 2026");
eq("reconhece domingo", M.rcbEhDomingo("2026-08-09"), "true");
eq("segunda não é domingo", M.rcbEhDomingo("2026-08-10"), "false");
eq("data que não existe é recusada", M.rcbData("2026-02-31"), "null");
eq("texto solto é recusado", M.rcbData("ontem"), "null");
eq("vazio é recusado", M.rcbData(""), "null");
eq("data inválida não vira texto", M.rcbDataExtenso("2026-02-31"), "");

console.log("\n-- o valor por extenso (é o que protege o recibo de canetada) --");
eq("oitenta", M.rcbExtenso(80), "oitenta reais");
eq("um real no singular", M.rcbExtenso(1), "um real");
eq("com centavos", M.rcbExtenso(80.5), "oitenta reais e cinquenta centavos");
eq("um centavo no singular", M.rcbExtenso(1.01), "um real e um centavo");
eq("cento e vinte", M.rcbExtenso(120), "cento e vinte reais");
eq("mil e quinhentos", M.rcbExtenso(1500), "mil e quinhentos reais");
eq("arredonda a terceira casa", M.rcbExtenso(80.567), "oitenta reais e cinquenta e sete centavos");
eq("moeda formatada", M.rcbMoeda(1234.5), "R$ 1.234,50");

console.log("\n-- a numeração --");
eq("número traz a data", M.rcbNumero("2026-08-09", 0), "20260809-001");
eq("sequência com três casas", M.rcbNumero("2026-08-09", 11), "20260809-012");
eq("dois recibos do mesmo dia não colidem",
   M.rcbNumero("2026-08-09", 0) === M.rcbNumero("2026-08-09", 1), "false");

console.log("\n-- o que o painel recusa imprimir --");
eq("sem data", M.rcbValidar(lote(null,[G("Funcionário",100,5)])).length > 0, "true");
eq("dia que não é domingo avisa", M.rcbValidar(lote("2026-08-10",[G("Funcionário",100,5)]))[0],
   "A data escolhida não é um domingo — confira antes de imprimir.");
eq("nenhum recibo pedido", M.rcbValidar(lote("2026-08-09",[G("Funcionário",100,0)])).length > 0, "true");
eq("tipo sem valor definido", M.rcbValidar(lote("2026-08-09",[G("Fiscal de loja",0,3)]))[0],
   "O valor de Fiscal de loja ainda não foi definido.");
eq("mais de 60 no total dos dois tipos",
   M.rcbValidar(lote("2026-08-09",[G("Funcionário",100,40),G("Fiscal de loja",150,25)])).length > 0, "true");
eq("60 no total ainda passa",
   M.rcbValidar(lote("2026-08-09",[G("Funcionário",100,40),G("Fiscal de loja",150,20)])).length, "0");
eq("tudo certo não reclama", M.rcbValidar(lote("2026-08-09",[G("Funcionário",100,10)])).length, "0");
eq("tipo zerado mas sem quantidade não atrapalha",
   M.rcbValidar(lote("2026-08-09",[G("Funcionário",100,5),G("Fiscal de loja",0,0)])).length, "0");

console.log("\n-- a conta dos dois tipos (100 o funcionário, 150 o fiscal) --");
{
  const l = lote("2026-08-09",[G("Funcionário",100,10),G("Fiscal de loja",150,3)]);
  eq("quantos recibos no total", M.rcbQuantos(l), "13");
  eq("total do domingo", M.rcbTotal(l), "1450");
  eq("grupo sem quantidade sai da conta",
     M.rcbTotal(lote("2026-08-09",[G("Funcionário",100,10),G("Fiscal de loja",150,0)])), "1000");
  eq("quantidade quebrada é truncada",
     M.rcbQuantos(lote("2026-08-09",[G("Funcionário",100,2.7)])), "2");
  eq("lote vazio dá zero", M.rcbTotal(lote("2026-08-09",[])), "0");
}

console.log("\n-- os tipos guardados (os dois existem sempre) --");
{
  // Os dois tipos têm que existir SEMPRE, senão o dono fica sem onde digitar o segundo valor.
  const t = M.rcbNormalizaTipos({ tipos:[{nome:"Fiscal de loja",valor:150}] });
  eq("os dois aparecem", t.length, "2");
  eq("o salvo mantém o valor", t[1].nome + "/" + t[1].valor, "Fiscal de loja/150");
  eq("o outro vem zerado", t[0].nome + "/" + t[0].valor, "Funcionário padrão/0");

  // O formato antigo tinha um valor só, com o nome "Funcionário". Não pode perder o valor.
  const v = M.rcbNormalizaTipos({ valor:80 });
  eq("valor antigo cai no funcionário padrão", v[0].nome + "/" + v[0].valor, "Funcionário padrão/80");
  eq("e o fiscal nasce zerado", v[1].valor, "0");
  const a = M.rcbNormalizaTipos({ tipos:[{nome:"Funcionário",valor:100}] });
  eq("nome antigo é reconhecido pelo apelido", a[0].valor + "/" + a.length, "100/2");

  const z = M.rcbNormalizaTipos({});
  eq("sem nada, os dois zerados", z.length + "/" + z[0].valor + "/" + z[1].valor, "2/0/0");
  eq("tipo extra criado à mão sobrevive",
     M.rcbNormalizaTipos({ tipos:[{nome:"Encarregado",valor:200}] }).length, "3");
  eq("nome em branco não vira tipo", M.rcbNormalizaTipos({ tipos:[{nome:"   ",valor:10}] }).length, "2");
}

console.log("\n-- o papel --");
{
  const h = M.rcbUmHtml({ data:"2026-08-09", valor:100 }, 0);
  tem("valor em número", h, "R$ 100,00");
  tem("valor por extenso", h, "cem reais");
  tem("valor por extenso DENTRO da frase", h, "a quantia de <b>R$ 100,00 (cem reais)</b>");
  naoTem("acabou o 'quantia acima'", h, "quantia acima");
  tem("a data do trabalho", h, "domingo, 09 de agosto de 2026");
  tem("o CNPJ da empresa", h, "12.988.127/0001-40");
  tem("a palavra quitação", h, "plena quitação");
  tem("linha do nome em branco", h, "Nome completo");
  tem("linha do CPF", h, "CPF");
  tem("linha da assinatura", h, "Assinatura");
  tem("a cidade", h, "Caicó/RN");
  tem("o número do recibo", h, "20260809-001");
  naoTem("não imprime nome nenhum", h, "value=");
}

console.log("\n-- a folha: três por página, numeração corrida entre os tipos --");
{
  const conta = (grupos) => (M.rcbFolhaHtml(lote("2026-08-09",grupos)).match(/class="rcb-folha"/g)||[]).length;
  eq("1 recibo, 1 folha", conta([G("Funcionário",100,1)]), "1");
  eq("3 recibos, 1 folha", conta([G("Funcionário",100,3)]), "1");
  eq("4 recibos, 2 folhas", conta([G("Funcionário",100,4)]), "2");
  eq("2 + 2 de tipos diferentes, 2 folhas", conta([G("Funcionário",100,2),G("Fiscal de loja",150,2)]), "2");
  eq("nada pedido, nenhuma folha", conta([G("Funcionário",100,0)]), "0");

  const h = M.rcbFolhaHtml(lote("2026-08-09",[G("Funcionário",100,2),G("Fiscal de loja",150,2)]));
  eq("saem os 4 recibos", (h.match(/class="rcb"/g)||[]).length, "4");
  eq("dois a R$ 100,00", (h.match(/R\$ 100,00/g)||[]).length >= 2, "true");
  eq("dois a R$ 150,00", (h.match(/R\$ 150,00/g)||[]).length >= 2, "true");
  // A numeração é do LOTE, não de cada tipo: dois recibos com o mesmo número seria o pior defeito.
  const nums = (h.match(/20260809-\d{3}/g)||[]);
  eq("quatro números", nums.length, "4");
  eq("todos diferentes", new Set(nums).size, "4");
  eq("começa no 001 e termina no 004", nums[0] + "|" + nums[3], "20260809-001|20260809-004");
}

console.log("\n-- casos que não podem quebrar --");
{
  const h = M.rcbUmHtml({ data:"2026-08-09", valor:0.01 }, 0);
  tem("um centavo ainda escreve certo", h, "R$ 0,01");
  const g = M.rcbUmHtml({ data:"2026-08-09", valor:999999.99 }, 0);
  tem("valor grande formata", g, "R$ 999.999,99");
  eq("folha sem data não inventa dia",
     M.rcbFolhaHtml(lote("",[G("Funcionário",100,1)])).indexOf("undefined") >= 0, "false");
  eq("lote no limite não trava",
     typeof M.rcbFolhaHtml(lote("2026-08-09",[G("Funcionário",1,60)])), "string");
  eq("grupos nulos não quebram", M.rcbTotal({ data:"2026-08-09" }), "0");
  eq("grupo torto é ignorado", M.rcbQuantos(lote("2026-08-09",[{},{nome:"X"}])), "0");
}

/* ---- RECIBO DE PAGAMENTO COMUM ----
   O irmão do de domingo: mesma folha, motivo escrito por quem imprime, data em qualquer dia.
   O que não pode acontecer aqui é recibo sair sem dizer a que se refere — vira comprovante
   de que alguém recebeu dinheiro sem dizer por quê. */
console.log("\n-- pagamento comum: o motivo --");
{
  const pg = (o) => Object.assign({ data:"2026-08-18", valor:200, quantidade:1, motivo:"vale" }, o);
  eq("motivo vazio é recusado",       M.rcbPgValidar(pg({motivo:""})).length > 0, "true");
  eq("motivo de 2 letras é recusado", M.rcbPgValidar(pg({motivo:"va"})).length > 0, "true");
  eq("motivo de 3 letras passa",      M.rcbPgValidar(pg({motivo:"val"})).length, "0");
  eq("só espaços é recusado",         M.rcbPgValidar(pg({motivo:"   "})).length > 0, "true");
  eq("espaços em volta somem",        M.rcbPgMotivo("  vale  adiantamento  "), "vale adiantamento");
  eq("quebra de linha vira espaço",   M.rcbPgMotivo("vale\nadiantamento"), "vale adiantamento");
  eq("motivo longo é cortado",        M.rcbPgMotivo("x".repeat(200)).length, "90");
  eq("nulo não quebra",               M.rcbPgMotivo(null), "");
}

console.log("\n-- pagamento comum: data, valor e quantidade --");
{
  const pg = (o) => Object.assign({ data:"2026-08-18", valor:200, quantidade:1, motivo:"vale" }, o);
  // Aqui, ao contrário do domingo, QUALQUER dia serve — inclusive domingo.
  eq("terça serve",              M.rcbPgValidar(pg({data:"2026-08-18"})).length, "0");
  eq("domingo também serve",     M.rcbPgValidar(pg({data:"2026-08-16"})).length, "0");
  eq("data que não existe cai",  M.rcbPgValidar(pg({data:"2026-02-31"})).length > 0, "true");
  eq("valor zero é recusado",    M.rcbPgValidar(pg({valor:0})).length > 0, "true");
  eq("valor negativo é recusado",M.rcbPgValidar(pg({valor:-5})).length > 0, "true");
  eq("zero recibos é recusado",  M.rcbPgValidar(pg({quantidade:0})).length > 0, "true");
  eq("61 recibos é recusado",    M.rcbPgValidar(pg({quantidade:61})).length > 0, "true");
  eq("60 recibos passa",         M.rcbPgValidar(pg({quantidade:60})).length, "0");
  eq("total = valor x quantos",  M.rcbPgTotal({valor:150.5, quantidade:4}), "602");
  eq("quantidade quebrada arredonda pra baixo", M.rcbPgTotal({valor:100, quantidade:2.9}), "200");
}

console.log("\n-- pagamento comum: o papel --");
{
  const h = M.rcbPgUm({ data:"2026-08-18", valor:200, motivo:"vale adiantamento" }, 0);
  tem("título é o de pagamento",   h, "Recibo de pagamento");
  naoTem("não fala em domingo",    h, "trabalho do domingo");
  tem("o motivo sai no papel",     h, "referente a <b>vale adiantamento</b>");
  tem("valor por extenso na frase",h, "R$ 200,00 (duzentos reais)");
  tem("nome fica em branco",       h, "Nome completo");
  tem("assinatura fica em branco", h, "Assinatura");
  tem("CNPJ da loja no papel",     h, "12.988.127/0001-40");
  // Motivo vem do teclado: se passar HTML, tem que sair como texto, não como marcação.
  const x = M.rcbPgUm({ data:"2026-08-18", valor:10, motivo:"<b>golpe</b>" }, 0);
  naoTem("HTML no motivo não vira marcação", x, "referente a <b><b>golpe</b>");
  tem("HTML no motivo sai escapado", x, "&lt;b&gt;golpe&lt;/b&gt;");
  // Três por folha, igual ao de domingo.
  eq("7 recibos dão 3 folhas", (M.rcbPgFolhaHtml({data:"2026-08-18",valor:10,motivo:"vale",quantidade:7})
       .match(/rcb-folha/g)||[]).length, "3");
  eq("cada recibo tem seu número",
     (M.rcbPgFolhaHtml({data:"2026-08-18",valor:10,motivo:"vale",quantidade:3})
       .match(/20260818-00[123]/g)||[]).length, "3");
}

console.log("\n-- o de domingo continua igual --");
{
  const d = M.rcbUmHtml({ data:"2026-08-16", valor:100 }, 0);
  tem("título de domingo intacto", d, "Recibo de pagamento referente ao trabalho do domingo");
  tem("frase de domingo intacta",  d, "referente ao trabalho prestado no dia");
}

console.log("\n" + (falhou ? "FALHOU: " + falhou + " de " + (ok + falhou) : "TUDO OK: " + ok + " testes"));
process.exit(falhou ? 1 : 0);
