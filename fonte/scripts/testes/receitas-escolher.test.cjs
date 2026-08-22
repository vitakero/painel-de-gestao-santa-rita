// Testes da JANELA DE ESCOLHER DO CATÁLOGO (Receitas → ingredientes e embalagens).
//
// Pedido do dono em 12/08/2026: "quando apertar adicionar, não quero a linha em branco —
// quero escolher qual insumo, marcar vários de uma vez, e depois só ajustar a quantidade".
//
// O que a lista mostra decide o que entra na ficha. Se ela deixar aparecer marcável algo que
// já está na receita, vira linha duplicada e o custo da receita conta duas vezes.
//   node scripts/testes/receitas-escolher.test.cjs
const fs = require("fs");
const path = require("path");

const HTML = fs.readFileSync(path.join(__dirname, "..", "..", "output", "index.html"), "utf8");
const ini = HTML.indexOf("==RECPICK-INICIO==");
const fim = HTML.indexOf("==RECPICK-FIM==");
if (ini < 0 || fim < 0) { console.log("ERRO: não achei o módulo RECPICK (rode o build antes)."); process.exit(1); }
const codigo = HTML.slice(HTML.indexOf("*/", ini) + 2, HTML.lastIndexOf("/*", fim));
const M = new Function(codigo + "\nreturn {recPickLista, recPickAgrupar, recPickResumo, recPickSemAcento, recOrdenaLinhas};")();

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + obtido + (bate ? "" : "   (esperado: " + esperado + ")"));
  bate ? ok++ : falhou++;
}

const CAT = [
  { id: "i1", nome: "Farinha de trigo", detalhe: "R$ 4,50 / kg", grupo: "Secos" },
  { id: "i2", nome: "Açúcar refinado", detalhe: "R$ 3,20 / kg", grupo: "Secos" },
  { id: "i3", nome: "Ovos", detalhe: "R$ 0,85 / un", grupo: "Frescos" },
  { id: "i4", nome: "Bandeja isopor", detalhe: "R$ 0,40 cada" },
];
const nomes = (r) => r.map((x) => x.nome).join(" | ");

console.log("\n=== Receitas — janela de escolher do catálogo ===\n");

// Sem busca e sem nada na receita: tudo aparece, em ordem alfabética de gente (Açúcar antes).
{
  const r = M.recPickLista(CAT, [], "");
  eq("1) mostra tudo", r.length, "4");
  eq("2) em ordem alfabética de verdade (acento conta)", nomes(r),
     "Açúcar refinado | Bandeja isopor | Farinha de trigo | Ovos");
  eq("3) nada marcado como já usado", r.filter((x) => x.ja).length, "0");
}

// O que JÁ está na receita continua aparecendo (pra ele ver que está lá), mas MARCADO e no fim.
{
  const r = M.recPickLista(CAT, ["i1"], "");
  eq("4) o que já está na receita é sinalizado", r.filter((x) => x.ja).map((x) => x.nome).join(","), "Farinha de trigo");
  eq("5) e vai para o FIM da lista", r[r.length - 1].nome, "Farinha de trigo");
  eq("6) os que faltam vêm primeiro", nomes(r.slice(0, 3)), "Açúcar refinado | Bandeja isopor | Ovos");
}

// Busca
{
  eq("7) busca pelo nome", nomes(M.recPickLista(CAT, [], "ovo")), "Ovos");
  eq("8) busca não liga pra maiúscula", nomes(M.recPickLista(CAT, [], "FARINHA")), "Farinha de trigo");
  eq("9) busca no meio da palavra", nomes(M.recPickLista(CAT, [], "trigo")), "Farinha de trigo");
  eq("10) busca também pega o detalhe (preço/unidade)", M.recPickLista(CAT, [], "0,85").length, "1");
  eq("11) busca sem resultado devolve vazio", M.recPickLista(CAT, [], "picanha").length, "0");
  eq("12) espaço em volta da busca não atrapalha", nomes(M.recPickLista(CAT, [], "  ovos  ")), "Ovos");

  // ACENTO — este pegou um defeito de verdade em 12/08/2026: buscar "açu" não achava
  // "Açúcar", porque o cadastro tem "açú" e a busca tinha "açu". Ninguém digita acento
  // certo na correria, e a cozinha é cheia deles (açúcar, açaí, pão, pó).
  eq("12a) digitar SEM acento acha o acentuado", nomes(M.recPickLista(CAT, [], "acucar")), "Açúcar refinado");
  eq("12b) meia palavra sem acento também", nomes(M.recPickLista(CAT, [], "acu")), "Açúcar refinado");
  eq("12c) digitar COM acento continua achando", nomes(M.recPickLista(CAT, [], "açúcar")), "Açúcar refinado");
  eq("12d) acento no lugar errado não atrapalha", nomes(M.recPickLista(CAT, [], "açucar")), "Açúcar refinado");
  eq("12e) cedilha sozinha", M.recPickLista([{ id: "x", nome: "Maçã" }], [], "maca").length, "1");
  eq("12f) til", M.recPickLista([{ id: "x", nome: "Pão francês" }], [], "pao").length, "1");
}

// Lixo no catálogo não pode virar linha na receita.
{
  const sujo = [
    { id: "i1", nome: "Farinha de trigo", detalhe: "" },
    { id: "", nome: "Sem id", detalhe: "" },
    { id: "i9", nome: "   ", detalhe: "" },
    { nome: "Sem id nenhum" },
    null,
  ];
  const r = M.recPickLista(sujo, [], "");
  eq("13) item sem id é descartado", r.filter((x) => x.nome === "Sem id").length, "0");
  eq("14) item sem nome é descartado", r.filter((x) => !String(x.nome).trim()).length, "0");
  eq("15) item nulo não quebra", r.length, "1");
}

// Bordas
{
  eq("16) catálogo vazio", M.recPickLista([], [], "").length, "0");
  eq("17) catálogo ausente não quebra", M.recPickLista(null, null, null).length, "0");
  eq("18) id numérico casa com id de texto",
     M.recPickLista([{ id: 7, nome: "Sal" }], [7], "").filter((x) => x.ja).length, "1");
  eq("19) todos já na receita: todos sinalizados",
     M.recPickLista(CAT, ["i1", "i2", "i3", "i4"], "").filter((x) => x.ja).length, "4");
}

// Ordem estável: dois itens com o mesmo nome não podem sumir um do outro.
{
  const dup = [{ id: "a", nome: "Sal" }, { id: "b", nome: "Sal" }];
  eq("20) nomes iguais, ids diferentes: os dois aparecem", M.recPickLista(dup, [], "").length, "2");
  eq("21) e só o que está na receita é marcado",
     M.recPickLista(dup, ["b"], "").filter((x) => x.ja).map((x) => x.id).join(","), "b");
}

// ---------------------------------------------------------------------------------
// "SÓ OS QUE FALTAM" — com o catálogo grande, ver o que já está lá só atrapalha.
console.log("\n--- só os que faltam ---\n");
eq("22) esconde o que já está na receita", nomes(M.recPickLista(CAT, ["i1", "i3"], "", true)),
   "Açúcar refinado | Bandeja isopor");
eq("23) sem nada na receita, não muda nada", M.recPickLista(CAT, [], "", true).length, "4");
eq("24) tudo na receita -> lista vazia", M.recPickLista(CAT, ["i1", "i2", "i3", "i4"], "", true).length, "0");
eq("25) filtro combina com a busca", nomes(M.recPickLista(CAT, ["i1"], "a", true)), "Açúcar refinado | Bandeja isopor");

// ---------------------------------------------------------------------------------
// GRUPOS — catálogo grande sem divisão vira rolagem cega.
console.log("\n--- agrupar por categoria ---\n");
{
  const g = M.recPickAgrupar(M.recPickLista(CAT, [], ""));
  eq("26) agrupa por categoria", g.map((x) => x.grupo).join(" | "), "Frescos | Secos | Sem categoria");
  eq("27) 'Sem categoria' vai por último", g[g.length - 1].grupo, "Sem categoria");
  eq("28) ninguém se perde no agrupamento", g.reduce((n, x) => n + x.itens.length, 0), "4");
  eq("29) itens ficam no grupo certo", g.find((x) => x.grupo === "Frescos").itens.map((i) => i.nome).join(","), "Ovos");
  eq("30) lista vazia não quebra", M.recPickAgrupar([]).length, "0");
  eq("31) lista ausente não quebra", M.recPickAgrupar(null).length, "0");
}

// ---------------------------------------------------------------------------------
// A FRASE DE ESTADO — nasceu de um beco sem saída: com TUDO já na receita, a janela
// mostrava linhas apagadas e um botão morto, sem dizer por quê.
console.log("\n--- o que a janela diz ---\n");
eq("32) catálogo vazio", M.recPickResumo(0, 0, 0, false).tipo, "vazio");
eq("33) tudo já na receita é ESTADO próprio", M.recPickResumo(5, 5, 5, false).tipo, "tudoJa");
eq("34) e a frase diz o número", M.recPickResumo(5, 5, 5, false).txt, "Todos os 5 já estão nesta receita.");
eq("35) busca sem resultado", M.recPickResumo(5, 1, 0, true).tipo, "nada");
eq("36) busca sem resultado avisa que é a busca", M.recPickResumo(5, 1, 0, true).txt, "Nada encontrado com esse nome.");
eq("37) caso normal conta os dois", M.recPickResumo(12, 5, 7, false).txt, "12 cadastrados · 5 já nesta receita");
eq("38) nada na receita, frase curta", M.recPickResumo(12, 0, 12, false).txt, "12 cadastrados");
eq("39) um só, no singular", M.recPickResumo(1, 0, 1, false).txt, "1 cadastrado");
eq("40) mais já do que total não vira frase estranha", M.recPickResumo(3, 4, 0, false).tipo, "tudoJa");

// ---------------------------------------------------------------------------------
// ORDEM ALFABÉTICA na ficha (pedido do dono, 12/08/2026): marcou em qualquer ordem, a ficha
// organiza. O risco aqui é embaralhar linha que a pessoa está digitando, ou trocar de lugar
// duas linhas iguais a cada clique.
console.log("\n--- ordem alfabética das linhas ---\n");
const L = (arr) => M.recOrdenaLinhas(arr, (r) => r.n).map((r) => r.n || "(vazia)").join(" | ");

eq("41) ordena pelo nome", L([{ n: "Sal" }, { n: "Açucar" }, { n: "Leite" }]), "Açucar | Leite | Sal");
eq("42) acento não joga pro fim", L([{ n: "Sal" }, { n: "Açucar" }, { n: "Bacon" }]), "Açucar | Bacon | Sal");
eq("43) maiúscula não muda a ordem", L([{ n: "banana" }, { n: "Abacaxi" }, { n: "CAJU" }]), "Abacaxi | banana | CAJU");
eq("44) número dentro do nome conta como número", L([{ n: "Bandeja 10" }, { n: "Bandeja 2" }]), "Bandeja 2 | Bandeja 10");

// A linha em branco é trabalho em andamento: fica no fim e não pula de lugar.
eq("45) linha sem nome vai pro fim", L([{ n: "" }, { n: "Sal" }, { n: "Açucar" }]), "Açucar | Sal | (vazia)");
eq("46) várias em branco mantêm a ordem entre si",
   M.recOrdenaLinhas([{ n: "", q: "1" }, { n: "Sal" }, { n: "", q: "2" }], (r) => r.n).map((r) => r.n || r.q).join(","), "Sal,1,2");

// Estável: rodar de novo não pode mexer em nada.
{
  const base = [{ n: "Sal", q: "1" }, { n: "Sal", q: "2" }, { n: "Açucar" }];
  const uma = M.recOrdenaLinhas(base, (r) => r.n);
  const duas = M.recOrdenaLinhas(uma, (r) => r.n);
  eq("47) nomes iguais mantêm a ordem original", uma.map((r) => r.q || "-").join(","), "-,1,2");
  eq("48) ordenar duas vezes dá o mesmo", duas.map((r) => r.q || "-").join(","), "-,1,2");
}

// O nome que vale é o que APARECE (do cadastro), não o que estiver gravado na linha.
eq("49) usa o nome resolvido, não o da linha",
   M.recOrdenaLinhas([{ id: "a", n: "zzz" }, { id: "b", n: "aaa" }],
     (r) => (r.id === "a" ? "Abacate" : "Zimbro")).map((r) => r.id).join(","), "a,b");

eq("50) lista vazia não quebra", M.recOrdenaLinhas([], (r) => r.n).length, "0");
eq("51) lista ausente não quebra", M.recOrdenaLinhas(null, (r) => r.n).length, "0");
eq("52) sem função de nome, usa o da própria linha", L([{ n: "Sal" }, { n: "Ovo" }]), "Ovo | Sal");

console.log("");
console.log(falhou ? ("FALHOU: " + falhou + " de " + (ok + falhou)) : ("TUDO OK: " + ok + " testes"));
process.exit(falhou ? 1 : 0);
