// Testes da LEITURA DA LISTA do cartaz (o texto colado vira as colunas da tabela).
//
// 14/08/2026 o dono reclamou: "aqui onde coloca as placas não está preenchendo o TIPO" — e
// pediu o campo no formato, depois da marca. Antes, tipo nascia SEMPRE vazio (tinha que digitar
// um por um) e tudo depois da primeira palavra virava MARCA.
//
// Formato: PRODUTO MARCA TIPO GRAMATURA PREÇO
//   node scripts/testes/cartaz-lista.test.cjs
const fs = require("fs");
const path = require("path");

const HTML = fs.readFileSync(path.join(__dirname, "..", "..", "output", "index.html"), "utf8");
const ini = HTML.indexOf("==CZPARSE-INICIO==");
const fim = HTML.indexOf("==CZPARSE-FIM==");
if (ini < 0 || fim < 0) { console.log("ERRO: não achei o módulo CZPARSE (rode o build antes)."); process.exit(1); }
const codigo = HTML.slice(HTML.indexOf("*/", ini) + 2, HTML.lastIndexOf("/*", fim));
const M = new Function(codigo + "\nreturn {czParseLinha,czEhGram,czEhPreco};")();

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + JSON.stringify(obtido) + (bate ? "" : "   (esperado: " + esperado + ")"));
  bate ? ok++ : falhou++;
}
const P = (s) => M.czParseLinha(s) || {};
// resume a linha lida no formato produto|marca|tipo|gramatura|preço
const R = (s) => { const p = P(s); return [p.nome, p.marca, p.tipo, p.gram, p.preco].join("|"); };

console.log("\n=== Cartaz — leitura da lista ===\n");

// ---------------------------------------------------------------- o pedido dele
{
  eq("1) o tipo é preenchido", R("Arroz Camil Tipo 1 5KG 29,90"), "Arroz|Camil|Tipo 1|5KG|29,90");
  eq("2) tipo de uma palavra", R("Detergente Ypê Neutro 500ML 2,49"), "Detergente|Ypê|Neutro|500ML|2,49");
  eq("3) tipo de várias palavras", R("Papel Neve Folha Dupla 30M 12,90"), "Papel|Neve|Folha Dupla|30M|12,90");
  eq("4) o tipo não some mais (era sempre vazio)", P("Arroz Camil Tipo 1 5KG 29,90").tipo !== "", "true");
}

// ---------------------------------------------------------------- o formato antigo continua valendo
{
  eq("5) sem tipo, como ele sempre usou", R("Arroz Camil 5KG 29,99"), "Arroz|Camil||5KG|29,99");
  eq("6) só produto e preço", R("Banana 4,99"), "Banana|||‌|4,99".replace("‌", ""));
  eq("7) só produto", R("Banana"), "Banana||||");
  eq("8) produto e marca, sem gramatura nem preço", R("Arroz Camil"), "Arroz|Camil|||");
}

// ---------------------------------------------------------------- preço e gramatura saem primeiro
{
  eq("9) preço com vírgula é reconhecido", P("Arroz Camil 5KG 29,90").preco, "29,90");
  eq("10) preço com ponto também", P("Arroz Camil 5KG 29.90").preco, "29.90");
  eq("11) gramatura em KG", P("Arroz Camil 5KG 29,90").gram, "5KG");
  eq("12) gramatura em ML", P("Suco Del Valle 1L 8,99").gram, "1L");
  eq("13) sem preço, a gramatura ainda é lida", P("Arroz Camil 5KG").gram, "5KG");
  eq("14) número solto NÃO vira gramatura", P("Arroz 5 Camil").gram, "");
  eq("15) e não vira preço também", P("Arroz 5 Camil").preco, "");
  // metro entrou em 14/08: "30M" ia parar no meio do TIPO
  eq("15a) metro é gramatura", P("Papel Neve 30M 12,90").gram, "30M");
  eq("15b) centímetro também", P("Fita Adere 50CM 4,00").gram, "50CM");
  eq("15c) e ML continua sendo ML, não M", P("Detergente Ypê 500ML 2,49").gram, "500ML");
  eq("15d) MG continua sendo MG", P("Remedio Marca 500MG 9,90").gram, "500MG");
  eq("15e) palavra terminada em M sem número não vira unidade", M.czEhGram("COM"), "false");
}

// ---------------------------------------------------------------- a oferta entre parênteses
{
  eq("16) oferta personalizada", P("(LEVE 2) Arroz Camil 5KG 29,90").oferta, "LEVE 2");
  eq("17) e o resto continua sendo lido", R("(LEVE 2) Arroz Camil Tipo 1 5KG 29,90"), "Arroz|Camil|Tipo 1|5KG|29,90");
  eq("18) sem parênteses, a oferta é a padrão", P("Arroz Camil 5KG 29,90").oferta, "OFERTA");
  eq("19) parêntese vazio não quebra", P("() Arroz 5,00").oferta, "OFERTA");
}

// ---------------------------------------------------------------- linhas quebradas
{
  eq("20) linha vazia é ignorada", M.czParseLinha(""), "null".replace("null", String(null)));
  eq("21) só espaços é ignorado", M.czParseLinha("     "), String(null));
  eq("22) nulo é ignorado", M.czParseLinha(null), String(null));
  eq("23) espaços a mais no meio não atrapalham", R("Arroz   Camil    Tipo 1   5KG   29,90"), "Arroz|Camil|Tipo 1|5KG|29,90");
  eq("24) espaço no começo e no fim", R("  Arroz Camil 5KG 29,90  "), "Arroz|Camil||5KG|29,90");
}

// ---------------------------------------------------------------- ida e volta (passo 3 -> passo 2)
// A tela remonta a linha como nome+marca+tipo+gram+preco. Ler de novo tem que dar o mesmo.
{
  const remonta = (p) => [p.nome, p.marca, p.tipo, p.gram, p.preco].filter(Boolean).join(" ");
  const casos = ["Arroz Camil Tipo 1 5KG 29,90", "Detergente Ypê Neutro 500ML 2,49", "Banana 4,99", "Arroz Camil 5KG 29,99"];
  casos.forEach((c, i) => {
    const ida = P(c);
    const volta = P(remonta(ida));
    eq("2" + (5 + i) + ") ida e volta não perde nada: " + c,
      [volta.nome, volta.marca, volta.tipo, volta.gram, volta.preco].join("|"),
      [ida.nome, ida.marca, ida.tipo, ida.gram, ida.preco].join("|"));
  });
}

// ---------------------------------------------------------------- a quantidade
{
  eq("29) toda linha nasce com 1 cartaz", P("Arroz Camil 5KG 29,90").qtd, 1);
  eq("30) e o 'de/por' nasce vazio", P("Arroz Camil 5KG 29,90").precoDe, "");
}

console.log("");
console.log(falhou ? ("FALHOU: " + falhou + " de " + (ok + falhou)) : ("TUDO OK: " + ok + " testes"));
process.exit(falhou ? 1 : 0);
