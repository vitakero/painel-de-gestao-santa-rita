// Testes do CONTROLE DE DESPERDÍCIO E PREMIAÇÃO — FLV.
// Aqui mora dinheiro que vai pra mão de gente: prêmio calculado errado é salário errado.
// E mora a regra que a planilha antiga errava: mês sem fechamento NÃO é zero.
//   node scripts/testes/flv.test.cjs
const fs = require("fs");
const path = require("path");

const HTML = fs.readFileSync(path.join(__dirname, "..", "..", "output", "index.html"), "utf8");
function bloco(marca) {
  const i = HTML.indexOf("==" + marca + "-INICIO==");
  const f = HTML.indexOf("==" + marca + "-FIM==");
  if (i < 0 || f < 0) { console.log("ERRO: não achei o módulo " + marca + " (rode o build antes)."); process.exit(1); }
  return HTML.slice(HTML.indexOf("*/", i) + 2, HTML.lastIndexOf("/*", f));
}

const M = new Function(bloco("FLVCALC") +
  "\nreturn {flvComp,flvCompPartes,flvCompLabel,flvCompCurta,flvCent,flvNum," +
  "flvPctValor,flvPctQtd,flvSituacao,flvDistancia,flvPremio,flvPrevia,flvValidar," +
  "flvVariacao,flvAcumulado,flvSerieAno,flvVizinhos,flvTem,flvPremioPerdido};")();

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + obtido +
              (bate ? "" : "   (esperado: " + esperado + ")"));
  bate ? ok++ : falhou++;
}

console.log("\n-- OS CENÁRIOS QUE O VICTOR PEDIU --");
{
  const cen = (fat, desp, n) => M.flvPrevia({ faturamento:fat, desperdicio_valor:desp,
                                              meta:5, fator:0.0012, participantes:n });
  // A: 600.000 com 24.000 de desperdício = 4,00% -> prêmio 720, sendo 180 por cabeça
  const a = cen(600000, 24000, 4);
  eq("A · percentual",           a.pct_valor, "4");
  eq("A · situação",             a.situacao, "atingida");
  eq("A · prêmio total",         a.premio_total, "720");
  eq("A · prêmio por pessoa",    a.premio_individual, "180");
  eq("A · margem até o limite",  a.distancia.texto, "1,00 p.p. abaixo do limite");

  // B: exatamente 5,00% ainda ganha — a meta é "menor ou igual"
  const b = cen(600000, 30000, 4);
  eq("B · percentual",           b.pct_valor, "5");
  eq("B · situação (limite exato conta como atingida)", b.situacao, "atingida");
  eq("B · prêmio total",         b.premio_total, "720");

  // C: 5,01% já perde tudo
  const c = cen(600000, 30060, 4);
  eq("C · percentual",           c.pct_valor, "5.01");
  eq("C · situação",             c.situacao, "nao_atingida");
  eq("C · prêmio total",         c.premio_total, "0");
  eq("C · prêmio por pessoa",    c.premio_individual, "0");
  eq("C · distância",            c.distancia.texto, "0,01 p.p. acima do limite");

  // D: mês sem fechamento não é zero, é ausência
  eq("D · sem faturamento não vira 0%", M.flvPctValor(1000, 0), "null");
  eq("D · sem faturamento não vira Infinity", String(M.flvPctValor(1000, 0)), "null");
  eq("D · série marca o mês vazio como null",
     M.flvSerieAno([], 2026).filter(function(x){ return x.pct===null; }).length, "12");
}

console.log("\n-- O QUE A PLANILHA ERRAVA --");
{
  eq("nunca #DIV/0!",     M.flvPctValor(500, 0), "null");
  eq("nunca NaN",         M.flvPctValor("abc", 100), "null");
  eq("nunca negativo",    M.flvPctValor(-10, 100), "null");
  eq("sem base não compara", M.flvVariacao(100, 0), "null");
  eq("mês futuro não é -100%", M.flvVariacao(null, 500), "null");
  eq("mês sem anterior não compara", M.flvVariacao(500, null), "null");
  eq("comparação real",   M.flvVariacao(570132.36, 624393.80), "-8.69");
}

console.log("\n-- O ACUMULADO DO ANO --");
{
  // Dois meses de tamanhos MUITO diferentes: a média dos percentuais mentiria.
  const l = [
    { competencia:"2026-01-01", faturamento:100000, desperdicio_valor:10000, situacao:"nao_atingida", premio_total:0 },
    { competencia:"2026-02-01", faturamento:900000, desperdicio_valor:18000, situacao:"atingida", premio_total:1080 },
  ];
  const ac = M.flvAcumulado(l);
  // soma 28.000 sobre soma 1.000.000 = 2,80%
  eq("acumulado é soma/soma",      ac.pct_valor, "2.8");
  // a média dos percentuais daria (10 + 2)/2 = 6,00% — mais que o DOBRO. Por isso não se usa.
  eq("a média mensal é outra coisa", ac.media_pct, "6");
  eq("faturamento somado",         ac.faturamento, "1000000");
  eq("prêmio somado",              ac.premio_total, "1080");
  eq("meses dentro da meta",       ac.meses_dentro, "1");
  eq("meses fora",                 ac.meses_fora, "1");
  eq("taxa de cumprimento",        ac.taxa_meta, "50");
  eq("ano sem fechamento nenhum",  M.flvAcumulado([]), "null");
}

console.log("\n-- DINHEIRO --");
{
  eq("centavo do 1,005",        M.flvCent(1.005), "1.01");
  eq("0,1+0,2 fecha em 0,30",   M.flvCent(0.1+0.2), "0.3");
  // 570.132,36 × 0,0012 = 684,158832 -> 684,16
  eq("prêmio do exemplo real",  M.flvPremio(570132.36, 0.0012, "atingida", 4).total, "684.16");
  eq("dividido por 4",          M.flvPremio(570132.36, 0.0012, "atingida", 4).individual, "171.04");
  eq("sem colaborador não divide", M.flvPremio(600000, 0.0012, "atingida", 0).individual, "0");
  eq("meta não atingida zera",  M.flvPremio(600000, 0.0012, "nao_atingida", 4).total, "0");
}

console.log("\n-- NÚMERO DIGITADO --");
{
  eq("brasileiro com milhar",   M.flvNum("1.240,50"), "1240.5");
  eq("com R$ na frente",        M.flvNum("R$ 600.000,00"), "600000");
  eq("ponto decimal",           M.flvNum("1240.50"), "1240.5");
  eq("só milhar",               M.flvNum("600.000"), "600000");
  eq("inteiro",                 M.flvNum("450"), "450");
  eq("vazio é null",            M.flvNum(""), "null");
  eq("texto é null",            M.flvNum("abc"), "null");
  eq("número já numérico",      M.flvNum(12.5), "12.5");
}

console.log("\n-- O QUE BARRA UM FECHAMENTO TORTO --");
{
  const base = { ano:2026, mes:7, faturamento:600000, desperdicio_valor:24000, participantes:4 };
  const v = (o) => M.flvValidar(Object.assign({}, base, o));
  eq("completo passa",              v({}).length, "0");
  eq("sem competência barra",       v({mes:0}).length > 0, "true");
  eq("faturamento zero barra",      v({faturamento:0}).length > 0, "true");
  eq("faturamento negativo barra",  v({faturamento:-1}).length > 0, "true");
  eq("desperdício negativo barra",  v({desperdicio_valor:-1}).length > 0, "true");
  eq("desperdício maior que o faturamento barra", v({desperdicio_valor:700000}).length > 0, "true");
  eq("sem colaborador barra",       v({participantes:0}).length > 0, "true");
  eq("competência repetida barra",  v({jaExiste:true}).length > 0, "true");
  eq("quantidade desperdiçada > vendida barra",
     v({qtd_vendida:100, qtd_desperdicada:200}).length > 0, "true");
}

console.log("\n-- COMPETÊNCIA --");
{
  eq("monta o dia 1",        M.flvComp(2026, 7), "2026-07-01");
  eq("mês 13 é recusado",    M.flvComp(2026, 13), "null");
  eq("mês 0 é recusado",     M.flvComp(2026, 0), "null");
  eq("rótulo por extenso",   M.flvCompLabel("2026-07-01"), "Julho / 2026");
  eq("rótulo curto",         M.flvCompCurta("2026-07-01"), "jul/26");
  eq("março com cedilha",    M.flvCompLabel("2026-03-01"), "Março / 2026");
}

console.log("\n-- VIZINHOS PARA COMPARAR --");
{
  const l = [
    { competencia:"2025-07-01", faturamento:500000 },
    { competencia:"2026-06-01", faturamento:624393.80 },
    { competencia:"2026-07-01", faturamento:570132.36 },
  ];
  const v = M.flvVizinhos(l, "2026-07-01");
  eq("acha o mês anterior",        v.anterior.competencia, "2026-06-01");
  eq("acha o mesmo mês do ano passado", v.anoAnterior.competencia, "2025-07-01");
  const j = M.flvVizinhos(l, "2026-01-01");
  eq("janeiro procura dezembro do ano anterior", j.anterior, "null");
}

console.log("\n-- BRANCO NAO E ZERO --");
{
  /* O defeito que a prevía do botão do VR revelou: com o desperdício EM BRANCO a tela dizia
     "Meta atingida", calculava R$ 600,00 de prêmio e liberava o Confirmar. +null vale 0 em
     JavaScript e isFinite(0) é verdadeiro, então "não informado" virava "zero". */
  eq("desperdicio branco nao vira 0%",  M.flvPctValor(null, 500000), "null");
  eq("desperdicio vazio nao vira 0%",   M.flvPctValor("", 500000),   "null");
  eq("faturamento branco",              M.flvPctValor(1000, null),   "null");
  eq("qtd desperdicada branca",         M.flvPctQtd(null, 1000),     "null");
  eq("qtd vendida branca",              M.flvPctQtd(10, null),       "null");

  /* Zero continua sendo um valor de verdade: mês sem nenhuma perda é improvável no FLV,
     mas se acontecer tem que calcular 0% e meta atingida — não sumir da tela. */
  eq("zero de verdade calcula",         M.flvPctValor(0, 500000),    0);
  eq("zero de verdade em quantidade",   M.flvPctQtd(0, 1000),        0);

  const p = M.flvPrevia({ faturamento:500000, desperdicio_valor:null,
                          meta:5, fator:0.0012, participantes:4 });
  eq("sem desperdicio: sem situacao",   p.situacao,          "null");
  eq("sem desperdicio: sem premio",     p.premio_total,      0);
  eq("sem desperdicio: sem premio por cabeca", p.premio_individual, 0);

  const er = M.flvValidar({ ano:2026, mes:11, faturamento:500000,
                            desperdicio_valor:null, participantes:4 });
  eq("branco no desperdicio BARRA",     er.length > 0, true);
  const er2 = M.flvValidar({ ano:2026, mes:11, faturamento:null,
                             desperdicio_valor:1000, participantes:4 });
  eq("branco no faturamento BARRA",     er2.length > 0, true);
  const ok0 = M.flvValidar({ ano:2026, mes:11, faturamento:500000,
                             desperdicio_valor:0, participantes:4 });
  eq("zero de verdade PASSA",           ok0.length, 0);
}

console.log("\n-- QUANTO TERIAM GANHADO (meta nao atingida) --");
{
  const nao = { situacao:"nao_atingida", faturamento:602906.26, fator_aplicado:0.0012,
                participantes:4 };
  const p = M.flvPremioPerdido(nao);
  eq("total que teria sido",     p.total, 723.49);
  eq("por pessoa",               p.individual, 180.87);

  /* Mes ATINGIDO nao tem "teria sido" — ele ganhou de verdade. Se eu devolvesse o valor
     aqui, a tela mostraria a mesma quantia duas vezes, uma delas como se fosse perda. */
  eq("mes atingido nao tem 'teria sido'",
     M.flvPremioPerdido({ situacao:"atingida", faturamento:600000, fator_aplicado:0.0012, participantes:4 }),
     "null");

  /* Usa o fator DAQUELE mes, nao o de hoje: mudar a regra amanha nao reescreve o passado. */
  const antigo = M.flvPremioPerdido({ situacao:"nao_atingida", faturamento:600000,
                                      fator_aplicado:0.0009, participantes:3 });
  eq("fator do mes, nao o de hoje", antigo.total, 540);
  eq("dividido por 3",              antigo.individual, 180);

  /* Sem numero nao inventa zero — mesma regra do resto do modulo. */
  eq("sem faturamento",  M.flvPremioPerdido({ situacao:"nao_atingida", fator_aplicado:0.0012, participantes:4 }), "null");
  eq("sem fator",        M.flvPremioPerdido({ situacao:"nao_atingida", faturamento:600000, participantes:4 }), "null");
  eq("faturamento zero", M.flvPremioPerdido({ situacao:"nao_atingida", faturamento:0, fator_aplicado:0.0012, participantes:4 }), "null");
  eq("nada",             M.flvPremioPerdido(null), "null");

  /* Sem colaborador marcado, o total existe mas o "por pessoa" nao — dividir por zero
     daria Infinity na tela. */
  const semGente = M.flvPremioPerdido({ situacao:"nao_atingida", faturamento:600000,
                                        fator_aplicado:0.0012, participantes:0 });
  eq("total sem colaborador",     semGente.total, 720);
  eq("por pessoa fica nulo",      semGente.individual, "null");
}

console.log("\n" + (falhou ? "FALHOU: " + falhou + " de " + (ok + falhou) : "TUDO OK: " + ok + " testes"));
process.exit(falhou ? 1 : 0);
