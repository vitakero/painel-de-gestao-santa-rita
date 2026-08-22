// Testes do DOCUMENTO de remuneração variável (relatório do fechamento).
// A reforma foi VISUAL: estes testes existem pra provar que nenhum número mudou e que
// o documento aguenta os casos difíceis (1 pessoa, muitas pessoas, nome enorme, R$ 0,
// milhares, centavos). Extrai os módulos ==ENTFIN-*== e ==ENTDOC-*== do painel CONSTRUÍDO.
//   node scripts/testes/entregas-relatorio.test.cjs
const fs = require("fs");
const path = require("path");

const HTML = fs.readFileSync(path.join(__dirname, "..", "..", "output", "index.html"), "utf8");
function bloco(marca) {
  const i = HTML.indexOf("==" + marca + "-INICIO==");
  const f = HTML.indexOf("==" + marca + "-FIM==");
  if (i < 0 || f < 0) { console.log("ERRO: não achei o módulo " + marca + " (rode o build antes)."); process.exit(1); }
  return HTML.slice(HTML.indexOf("*/", i) + 2, HTML.lastIndexOf("/*", f));
}

// O documento usa alguns utilitários da tela; aqui eles entram como dublês fiéis.
const APOIO = `
  var MESES=["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
  function num(n){ return (+n||0).toLocaleString("pt-BR"); }
  function entEsc(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"); }
  function pxDocBarraHtml(o){ return {css:"/*barra*/", html:"<div class='docbar'>"+(o.titulo||"")+"</div>"}; }
`;
const M = new Function(APOIO + bloco("ENTFIN") + bloco("ENTDOC") +
  "\nreturn {entfFaixa,entfTotalEquipe,entfMoeda,entfNum2,entRelDocHtml,entRelFaixaCurta};")();

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + obtido + (bate ? "" : "   (esperado: " + esperado + ")"));
  bate ? ok++ : falhou++;
}
// entfMoeda usa espaço fino (NBSP) entre "R$" e o número — normaliza dos dois lados
// pra o teste não falhar por causa de um caractere invisível.
const nb = (x) => String(x).replace(/\u00a0/g, " ");
function tem(nome, html, trecho) { eq(nome, nb(html).indexOf(nb(trecho)) >= 0, "true"); }
function naoTem(nome, html, trecho) { eq(nome, nb(html).indexOf(nb(trecho)) >= 0, "false"); }

const EMPRESA = { razao: "G JOAO DOS SANTOS INDÚSTRIA E COMÉRCIO LTDA", fantasia: "Supermercado Santa Rita",
                  cnpj: "12.988.127/0001-40", cidade: "Caicó/RN", endereco: "Rua André Sales, 531 - Caicó/RN" };

function montar(cfg, nomesEQtds, extra) {
  const linhas = nomesEQtds.map(([nome, q]) => ({ nome, total: q, fin: M.entfFaixa(q, cfg) }))
                           .sort((a, b) => b.total - a.total);
  const tot = M.entfTotalEquipe(linhas.map((l) => l.total), cfg);
  const d = Object.assign({
    ano: 2026, mes: 6, cfg, linhas, tot, diverg: "",
    emitidoData: "07/08/2026", emitidoHora: "18:35",
    fechadoEm: "31/07/2026 às 22:10", fechadoPor: "diretoria@santarita.com · Diretoria",
    empresa: EMPRESA, logo: "",
  }, extra || {});
  return { d, html: M.entRelDocHtml(d), linhas, tot };
}

// ============================================================
// 1) O CENÁRIO REAL DO DONO — os números NÃO podem mudar
// ============================================================
console.log("\n=== Cenário de validação do dono (julho/2026) ===\n");

const CFG = { base: 600, desafio: 850, vbase: 100, vdes: 150 };   // R$ 1,00 e R$ 1,50
const REAL = montar(CFG, [["Anderson", 851], ["Joseildo", 754], ["Lucas", 748],
                          ["Francisco", 627], ["Josinaldo", 110]]);

eq("1) Anderson 851 → Meta 2",              REAL.linhas[0].fin.faixa, "desafio");
eq("2) Anderson 851 × R$ 1,50 = R$ 1.276,50", M.entfMoeda(REAL.linhas[0].fin.total).replace(/ /g, " "), "R$ 1.276,50");
eq("3) Joseildo 754 × R$ 1,00 = R$ 754,00",   M.entfMoeda(REAL.linhas[1].fin.total).replace(/ /g, " "), "R$ 754,00");
eq("4) Lucas 748 × R$ 1,00 = R$ 748,00",      M.entfMoeda(REAL.linhas[2].fin.total).replace(/ /g, " "), "R$ 748,00");
eq("5) Francisco 627 × R$ 1,00 = R$ 627,00",  M.entfMoeda(REAL.linhas[3].fin.total).replace(/ /g, " "), "R$ 627,00");
eq("6) Josinaldo 110 → R$ 0,00",              M.entfMoeda(REAL.linhas[4].fin.total).replace(/ /g, " "), "R$ 0,00");
eq("7) total de entregas = 3.090",            REAL.tot.entregas, 3090);
eq("8) TOTAL PARA FOLHA = R$ 3.405,50",       M.entfMoeda(REAL.tot.total).replace(/ /g, " "), "R$ 3.405,50");
eq("9) a soma linha a linha bate com o total",
   REAL.linhas.reduce((a, l) => a + l.fin.total, 0), REAL.tot.total);

console.log("\n=== E esses mesmos números aparecem no documento ===\n");
const H = REAL.html;
tem("10) o total para folha está escrito na página", H, "3.405,50");
tem("11) Anderson com o valor dele",                 H, "1.276,50");
tem("12) Joseildo com o valor dele",                 H, "754,00");
tem("13) Francisco com o valor dele",                H, "627,00");
tem("14) quem não bateu meta aparece com 0,00",      H, "0,00");
eq("15) o total para folha aparece 2x (resumo e fechamento)",
   (H.match(/3\.405,50/g) || []).length, 2);
eq("16) o total de entregas aparece 2x",  (H.match(/>3\.090</g) || []).length, 2);

// ============================================================
// 2) ESTRUTURA DO DOCUMENTO
// ============================================================
console.log("\n=== Estrutura do documento ===\n");
tem("17) cabeçalho institucional",       H, "Relatório de Remuneração Variável");
tem("18) competência por extenso",       H, "JULHO / 2026");
tem("19) selo de situação",              H, "FECHADO");
tem("20) razão social real",             H, "G JOAO DOS SANTOS");
tem("21) CNPJ real",                     H, "12.988.127/0001-40");
tem("22) quando foi fechado",            H, "31/07/2026 às 22:10");
tem("23) quem fechou",                   H, "diretoria@santarita.com");
tem("24) quando foi emitido",            H, "07/08/2026");
tem("25) seção de resumo",               H, "Resumo da competência");
tem("26) seção de critério",             H, "Critério de remuneração");
tem("27) seção de detalhamento",         H, "Detalhamento por entregador");
tem("28) fechamento financeiro",         H, "Valor calculado para a folha");
naoTem("29) sem a área de conferência (o dono pediu pra tirar)", H, "Conferência");
naoTem("30) e sem os campos de assinatura manual", H, "class=\"ln\"");
tem("31) observação legal",              H, "não contempla");
tem("32) rodapé institucional",          H, "gerado automaticamente pelo Painel Santa Rita");
tem("33) rodapé que repete na impressão", H, "rodape-print");
tem("34) barra de documento reaproveitada", H, "docbar");

console.log("\n=== O critério sai da configuração congelada, nunca fixo no código ===\n");
tem("35) faixa 1 termina em 599",  H, "até 599 entregas");
tem("36) faixa 2 vai de 600 a 849", H, "de 600 a 849 entregas");
tem("37) faixa 3 a partir de 850",  H, "850 entregas ou mais");
const OUTRA = montar({ base: 400, desafio: 900, vbase: 25, vdes: 75 }, [["Ana", 500]]);
tem("38) outra config muda o critério: até 399",  OUTRA.html, "até 399 entregas");
tem("39) outra config: de 400 a 899",             OUTRA.html, "de 400 a 899 entregas");
tem("40) outra config: 900 ou mais",              OUTRA.html, "900 entregas ou mais");
tem("41) e o valor por entrega vem junto",        OUTRA.html, "0,25");
naoTem("42) nada de 600 fixo quando a meta é 400", OUTRA.html, "de 600 a 849");

// ============================================================
// 3) CASOS DIFÍCEIS
// ============================================================
console.log("\n=== Casos difíceis ===\n");

const UM = montar(CFG, [["Ana", 900]]);
eq("43) 1 entregador: documento sai",            UM.html.length > 3000, "true");
tem("44) 1 entregador: total certo",             UM.html, "1.350,00");
tem("45) 1 entregador: contagem no resumo",      UM.html, "1 entregador(es)");

const SEIS = montar(CFG, [["A", 900], ["B", 800], ["C", 700], ["D", 650], ["E", 610], ["F", 100]]);
eq("46) 6 entregadores: 6 linhas na tabela", (SEIS.html.match(/<td class="pos">/g) || []).length, 6);
eq("47) posições numeradas 01..06",  /<td class="pos">01<\/td>/.test(SEIS.html) && /<td class="pos">06<\/td>/.test(SEIS.html), true);

const MUITOS = montar(CFG, Array.from({ length: 47 }, (_, i) => ["Entregador " + (i + 1), 600 + i * 7]));
eq("48) 47 entregadores: 47 linhas", (MUITOS.html.match(/<td class="pos">/g) || []).length, 47);
eq("49) 47 entregadores: total confere com a soma",
   MUITOS.linhas.reduce((a, l) => a + l.fin.total, 0), MUITOS.tot.total);
tem("50) cabeçalho da tabela se repete nas páginas", MUITOS.html, "display:table-header-group");
tem("51) linha não parte no meio da página",         MUITOS.html, "break-inside:avoid");

const LONGO = montar(CFG, [["Maria das Graças Nascimento de Albuquerque Sobrinho Filha", 700]]);
tem("52) nome longo aparece inteiro", LONGO.html, "Albuquerque Sobrinho Filha");

const ZERO = montar(CFG, [["Ana", 10], ["Bia", 20]]);
tem("53) todo mundo sem meta: total R$ 0,00", ZERO.html, "R$ 0,00");
eq("54) e o resumo diz 2 sem remuneração",    ZERO.tot.sem, 2);

const CENTAVOS = montar({ base: 100, desafio: 99999, vbase: 33, vdes: 0 }, [["Ana", 333]]);
tem("55) centavos exatos: 333 × R$ 0,33 = R$ 109,89", CENTAVOS.html, "109,89");

const DEZENAS = montar({ base: 100, desafio: 200, vbase: 150, vdes: 300 },
  Array.from({ length: 12 }, (_, i) => ["E" + i, 900 + i]));
tem("56) dezenas de milhares saem formatadas", DEZENAS.html, "R$ 32.");
eq("57) e batem com a soma", DEZENAS.linhas.reduce((a, l) => a + l.fin.total, 0), DEZENAS.tot.total);

console.log("\n=== Segurança do documento ===\n");
const XSS = montar(CFG, [['<script>alert(1)</script>', 700]]);
naoTem("58) nome com HTML não vira código", XSS.html, "<script>alert(1)");
tem("59) sai escapado",                     XSS.html, "&lt;script&gt;");

const DIV = montar(CFG, [["Ana", 700]], { diverg: "Atenção: os totais não batem." });
tem("60) aviso de divergência aparece quando existe", DIV.html, "os totais não batem");
naoTem("61) e não aparece quando não existe",         REAL.html, "class=\"diverg\"");

console.log("\n=== Impressão ===\n");
tem("62) folha A4",                       H, "size:A4");
tem("63) a barra some na impressão",       H, ".docbar{display:none!important}");
tem("64) sem sombra no papel",            H, "box-shadow:none");
tem("65) zebra some na impressão",        H, "tbody tr:nth-child(even) td{background:transparent}");
tem("66) blocos pequenos não partem no meio", H, ".res,.fecha,.obs,.cab{break-inside:avoid");
naoTem("66b) mas a tabela grande PODE partir",  H, ".bloco,.res,.fecha");
tem("66c) e o documento se ajusta pra não deixar folha quase vazia", H, "body{zoom:");
tem("67) cor do total mantida no PDF",    H, "print-color-adjust:exact");
tem("68) faixa não depende só de cor",    H, "Sem remuneração");
tem("69) responsivo no celular",          H, "@media (max-width:700px)");
tem("70) números com tipografia tabular", H, "font-variant-numeric:tabular-nums");

console.log("\n=== Rótulos curtos das faixas ===\n");
eq("71) faixa desafio",   M.entRelFaixaCurta("desafio"), "Meta 2");
eq("72) faixa base",      M.entRelFaixaCurta("base"), "Meta 1");
eq("73) sem remuneração", M.entRelFaixaCurta("sem"), "Sem remuneração");

console.log("\n" + (falhou ? "FALHOU: " + falhou + " de " + (ok + falhou) : "TUDO OK: " + ok + " testes") + "\n");
process.exit(falhou ? 1 : 0);
