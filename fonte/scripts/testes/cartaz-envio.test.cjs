// Testes da TRAVA DO CABEÇALHO do cartaz.
//
// Pedido do dono em 14/08/2026: "temos que colocar uma trava que só aceita imagens com essas
// características; quando alguém subir outra imagem não aceita e aparece um aviso falando qual
// é o jeito certo da imagem".
//
// A faixa do cartaz é 198 x 69,3 mm = 20:7 (2,857 por 1). Arte fora disso ou é aparada (some
// pedaço da arte) ou traz de volta a faixa branca dos lados.
//
// Se um destes cair, ou passa imagem torta, ou a trava barra a arte oficial dele.
//   node scripts/testes/cartaz-envio.test.cjs
const fs = require("fs");
const path = require("path");

const HTML = fs.readFileSync(path.join(__dirname, "..", "..", "output", "index.html"), "utf8");
const ini = HTML.indexOf("==CZUP-INICIO==");
const fim = HTML.indexOf("==CZUP-FIM==");
if (ini < 0 || fim < 0) { console.log("ERRO: não achei o módulo CZUP (rode o build antes)."); process.exit(1); }
const codigo = HTML.slice(HTML.indexOf("*/", ini) + 2, HTML.lastIndexOf("/*", fim));
const M = new Function(codigo + "\nreturn {czUpCheca,czFmtProp,CZ_PROP,CZ_PROP_FOLGA,CZ_LARG_MIN,czDatasOk};")();

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + obtido + (bate ? "" : "   (esperado: " + esperado + ")"));
  bate ? ok++ : falhou++;
}
const passa = (w, h) => M.czUpCheca(w, h).ok;
const msg = (w, h) => M.czUpCheca(w, h).msg || "";

console.log("\n=== Cartaz — trava do cabeçalho ===\n");

// ---------------------------------------------------------------- o que TEM que passar
{
  eq("1) a arte oficial dele (2100x735)", passa(2100, 735), "true");
  eq("2) o export cru do Canva (2117x743)", passa(2117, 743), "true");
  eq("3) o dobro do tamanho, mesma proporção (4200x1470)", passa(4200, 1470), "true");
  eq("4) o mínimo aceitável (1200x420)", passa(1200, 420), "true");
  eq("5) 2000x700 (o número que eu passei pra ele)", passa(2000, 700), "true");
  eq("6) 2340x819 (300 dpi)", passa(2340, 819), "true");
}

// ---------------------------------------------------------------- o que TEM que barrar
{
  eq("7) quadrada (1500x1500)", passa(1500, 1500), "false");
  eq("8) em pé (1080x1350)", passa(1080, 1350), "false");
  eq("9) a arte ANTIGA dele, 2,08:1 (1414x680)", passa(1414, 680), "false");
  eq("10) larga demais (4000x700, 5,7:1)", passa(4000, 700), "false");
  eq("11) print de celular (1170x2532)", passa(1170, 2532), "false");
  eq("12) 16:9 comum (1920x1080)", passa(1920, 1080), "false");
}

// ---------------------------------------------------------------- pequena demais
{
  eq("13) proporção certa mas pequena (700x245)", passa(700, 245), "false");
  eq("14) e o aviso fala de tamanho, não de proporção", /pequena demais/.test(M.czUpCheca(700, 245).titulo), "true");
  eq("15) 1199 de largura ainda barra", passa(1199, 419.65), "false");
  eq("16) 1200 passa (é o limite exato)", passa(1200, 420), "true");
}

// ---------------------------------------------------------------- a tolerância
{
  const P = M.CZ_PROP;
  eq("17) 2% mais alta ainda passa", passa(Math.round(2000 * (1 - 0.019)), 700), "true");
  eq("18) 2% mais comprida ainda passa", passa(Math.round(2000 * (1 + 0.019)), 700), "true");
  eq("19) 5% mais alta já barra", passa(Math.round(2000 * 0.95), 700), "false");
  eq("20) 5% mais comprida já barra", passa(Math.round(2000 * 1.05), 700), "false");
  eq("21) a folga é de 2%", M.CZ_PROP_FOLGA, "0.02");
  eq("22) a proporção é 20/7", Math.round(P * 10000) / 10000, "2.8571");
}

// ---------------------------------------------------------------- entradas quebradas
{
  eq("23) largura zero não passa", passa(0, 700), "false");
  eq("24) altura zero não passa", passa(2000, 0), "false");
  eq("25) texto não passa", passa("abc", "def"), "false");
  eq("26) nulo não passa", passa(null, null), "false");
  eq("27) negativo não passa", passa(-2000, -700), "false");
  eq("28) e nenhum desses estoura o painel", (function(){ try{ M.czUpCheca(undefined, undefined); return true; }catch(e){ return false; } })(), "true");
}

// ---------------------------------------------------------------- o aviso ensina o caminho
{
  eq("29) o aviso diz o tamanho certo", /2100 x 735/.test(msg(1500, 1500)), "true");
  // Ele pediu em 14/08 pra NÃO citar programa de arte. O aviso ensina a medida, não a ferramenta.
  eq("30) o aviso ensina onde definir a medida", /tamanho personalizado/i.test(msg(1500, 1500)), "true");
  eq("30b) e NÃO cita programa nenhum", /canva|photoshop|illustrator|corel/i.test(msg(1500, 1500)), "false");
  eq("31) o aviso mostra o tamanho que a pessoa mandou", /1500 x 1500/.test(msg(1500, 1500)), "true");
  eq("32) e quanto seria aparado", /\d+%/.test(msg(1500, 1500)), "true");
  eq("33) imagem alta fala de cima e embaixo", /em cima e embaixo/.test(msg(1500, 1500)), "true");
  eq("34) imagem comprida fala das laterais", /laterais/.test(msg(4000, 700)), "true");
  eq("35) número com vírgula, não com ponto", M.czFmtProp(2.857), "2,86");
}

console.log("\n-- A DATA DE FIM NAO PODE SER ANTES DA DE INICIO --");
{
  /* Pedido do dono em 20/08/2026: ele conseguiu pôr início 21/08 e fim 20/08, e o cartaz
     saía com uma validade impossível impressa no rodapé. */
  eq("36) fim depois do inicio passa",  M.czDatasOk("2026-08-20","2026-08-21"), true);
  eq("37) mesmo dia passa",             M.czDatasOk("2026-08-20","2026-08-20"), true);
  eq("38) fim ANTES do inicio BARRA",   M.czDatasOk("2026-08-21","2026-08-20"), false);

  /* Vira o mês e vira o ano: comparo como TEXTO (AAAA-MM-DD), que ordena sozinho. Se eu
     montasse objeto de data entraria fuso horário na história — e é ali que este tipo de
     conta costuma errar por um dia. */
  eq("39) vira o mes",                  M.czDatasOk("2026-08-31","2026-09-01"), true);
  eq("40) vira o mes ao contrario",     M.czDatasOk("2026-09-01","2026-08-31"), false);
  eq("41) vira o ano",                  M.czDatasOk("2026-12-31","2027-01-01"), true);
  eq("42) vira o ano ao contrario",     M.czDatasOk("2027-01-01","2026-12-31"), false);

  /* Campo vazio não é erro aqui: quem cobra as duas datas é a trava do botão imprimir,
     que já existia. Se eu barrasse o vazio, a pessoa não conseguiria nem começar. */
  eq("43) inicio vazio nao barra",      M.czDatasOk("","2026-08-20"), true);
  eq("44) fim vazio nao barra",         M.czDatasOk("2026-08-20",""), true);
  eq("45) os dois vazios nao barra",    M.czDatasOk("",""), true);
  eq("46) nulo nao quebra",             M.czDatasOk(null,null), true);
}

console.log("");
console.log(falhou ? ("FALHOU: " + falhou + " de " + (ok + falhou)) : ("TUDO OK: " + ok + " testes"));
process.exit(falhou ? 1 : 0);
