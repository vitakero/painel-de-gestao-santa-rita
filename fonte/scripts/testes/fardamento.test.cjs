// ============================================================
// BANCADA DO MÓDULO FARDAMENTO — o miolo de cálculo.
//
// NÃO duplica a lógica: extrai o bloco ==FARDCALC-INICIO== / ==FARDCALC-FIM==
// do painel já gerado (output/index.html) e roda os casos contra ele. Se o
// painel mudar a conta, é aqui que aparece.
//
//   node scripts/testes/fardamento.test.cjs
// ============================================================
const fs = require("fs");
const path = require("path");

const HTML = fs.readFileSync(path.join(__dirname, "..", "..", "output", "index.html"), "utf8");
const ini = HTML.indexOf("==FARDCALC-INICIO==");
const fim = HTML.indexOf("==FARDCALC-FIM==");
if (ini < 0 || fim < 0) {
  console.log("ERRO: não achei o miolo de cálculo do fardamento no output/index.html.");
  process.exit(1);
}
const codigo = HTML.slice(HTML.indexOf("*/", ini) + 2, HTML.lastIndexOf("/*", fim));
const M = new Function(codigo + "\nreturn {fardTem,fardNum,fardDias,fardMesesDe,fardPrevisto,fardConsumo," +
  "fardIndice,fardSituacao,fardExplicar,fardTrocaAtrasada,fardConsumoMensal,fardCobertura," +
  "fardSituacaoEstoque,fardSugestao,fardCusto,FARD_DIAS_MES};")();

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + obtido + (bate ? "" : "   (esperado: " + esperado + ")"));
  bate ? ok++ : falhou++;
}
function contem(nome, lista, pedaco) {
  const bate = (lista || []).some(t => String(t).toLowerCase().includes(String(pedaco).toLowerCase()));
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + (bate ? "" : "   -> " + JSON.stringify(lista)));
  bate ? ok++ : falhou++;
}
const r2 = (v) => v === null ? "null" : (Math.round(v * 100) / 100);

console.log("\n=== 1. Vazio não é zero ===\n");
eq("1) zero é um valor informado",            M.fardTem(0), true);
eq("2) null é ausência",                      M.fardTem(null), false);
eq("3) string vazia é ausência",              M.fardTem(""), false);
eq("4) undefined é ausência",                 M.fardTem(undefined), false);
eq("5) NaN é ausência",                       M.fardTem(NaN), false);
eq("6) fardNum('') não vira 0",               M.fardNum(""), null);
eq("7) fardNum('0') vira 0",                  M.fardNum("0"), 0);

console.log("\n=== 2. Previsto pela política ===\n");
eq("8) sem política: não dá pra prever",      M.fardPrevisto({}, 365, 365).motivo, "sem_politica");
eq("9) troca a cada 6 meses, ano inteiro = 2", r2(M.fardPrevisto({troca_meses:6, proporcional_ativo:false}, 365, 365).valor), 2);
eq("10) troca a cada 12 meses, ano inteiro = 1", r2(M.fardPrevisto({troca_meses:12, proporcional_ativo:false}, 365, 365).valor), 1);
// proporcional configurado E com dado: rateia
eq("11) proporcional com meio ano ativo = metade", r2(M.fardPrevisto({troca_meses:6, proporcional_ativo:true}, 365, 182).valor), 1);
eq("12) e marca que ajustou",                 M.fardPrevisto({troca_meses:6, proporcional_ativo:true}, 365, 182).ajustado, true);
// proporcional configurado mas SEM dado: não inventa
const semDado = M.fardPrevisto({troca_meses:6, proporcional_ativo:true}, 365, null);
eq("13) proporcional sem período ativo avisa", semDado.aviso, "sem_periodo_ativo");
eq("14) e NÃO rateia por conta própria",      r2(semDado.valor), 2);
eq("15) e não diz que ajustou",               semDado.ajustado, false);
// proporcionalidade não configurada: nada de 50% automático
const naoConf = M.fardPrevisto({troca_meses:6, proporcional_ativo:null}, 365, 182);
eq("16) proporcionalidade não configurada avisa", naoConf.aviso, "proporcionalidade_nao_configurada");
eq("17) meio período NÃO vira metade sozinho", r2(naoConf.valor), 2);

console.log("\n=== 3. O que conta e o que não conta ===\n");
const motivos = [
  {motivo:"Enxoval inicial",     classificacao:"normal",         entra_no_indice:false, quantidade:3},
  {motivo:"Troca prevista",      classificacao:"normal",         entra_no_indice:true,  quantidade:1},
  {motivo:"Alteração de tamanho",classificacao:"neutro",         entra_no_indice:false, quantidade:2},
  {motivo:"Rasgou",              classificacao:"extraordinario", entra_no_indice:true,  quantidade:2},
  {motivo:"Perdeu",              classificacao:"extraordinario", entra_no_indice:true,  quantidade:1}
];
const c = M.fardConsumo(motivos);
eq("18) total é tudo que saiu",               c.total, 9);
eq("19) mas o índice conta só 4",             c.indice, 4);
eq("20) enxoval inicial fica de fora",        c.total - c.indice >= 3, true);
eq("21) extraordinárias somam 3",             c.extraordinaria, 3);
eq("22) neutras somam 2",                     c.neutra, 2);

console.log("\n=== 4. Índice e situação (sem régua inventada) ===\n");
eq("23) índice sem previsto é nulo",          M.fardIndice(4, null), null);
eq("24) índice com previsto zero é nulo",     M.fardIndice(4, 0), null);
eq("25) 4 recebidas para 2 previstas = 2x",   M.fardIndice(4, 2), 2);
eq("26) sem padrão, a situação é sem_padrao", M.fardSituacao(null, 5, {}), "sem_padrao");
eq("27) sem régua: 1,0x é dentro",            M.fardSituacao(1.0, 0, {}), "dentro");
eq("28) sem régua: 2,0x é acima do previsto", M.fardSituacao(2.0, 3, {}), "acima");
eq("29) sem régua NÃO existe 'fora'",         M.fardSituacao(9.9, 9, {}), "acima");
eq("30) com régua de atenção em 1,5x",        M.fardSituacao(1.6, 0, {indice_atencao:1.5}), "atencao");
eq("31) com régua de fora em 2x",             M.fardSituacao(2.1, 0, {indice_atencao:1.5, indice_fora:2}), "fora");
eq("32) régua por nº de extraordinárias",     M.fardSituacao(1.0, 4, {extraordinarias_fora:3}), "fora");

console.log("\n=== 5. A explicação (o sistema aponta, não condena) ===\n");
const linha = { consumo:c, indice:2, previsto:M.fardPrevisto({troca_meses:6, proporcional_ativo:true}, 365, null) };
const exp = M.fardExplicar(linha);
contem("33) diz quanto recebeu x quanto era previsto", exp, "o previsto pela política era");
contem("34) lista as reposições fora do previsto", exp, "2 por rasgou");
contem("35) diz o que ficou FORA da conta", exp, "ficaram fora da conta");
contem("36) e avisa que não deu pra ajustar pelo período ativo", exp, "não foi possível ajustar");
const semPol = M.fardExplicar({ consumo:c, indice:null, previsto:M.fardPrevisto({}, 365, 365) });
contem("37) sem política, explica que não dá pra julgar", semPol, "não existe padrão cadastrado");

console.log("\n=== 6. Troca possivelmente atrasada ===\n");
eq("38) sem política não existe atraso",      M.fardTrocaAtrasada("2026-01-01", null, "2026-09-03", "ativo").motivo, "sem_politica");
eq("39) quem nunca recebeu é marcado à parte", M.fardTrocaAtrasada(null, 6, "2026-09-03", "ativo").nunca, true);
eq("40) 8 meses sem trocar, política de 6: atrasada", M.fardTrocaAtrasada("2026-01-01", 6, "2026-09-03", "ativo").atrasada, true);
eq("41) 2 meses sem trocar, política de 6: em dia", M.fardTrocaAtrasada("2026-07-01", 6, "2026-09-03", "ativo").atrasada, false);
eq("42) desligado não entra na conta de atraso", M.fardTrocaAtrasada("2020-01-01", 6, "2026-09-03", "desligado").atrasada, false);

console.log("\n=== 7. Consumo mensal e previsão ===\n");
const poucos = { "2026-07":3, "2026-08":4 };
eq("43) 2 meses fechados é histórico insuficiente", M.fardConsumoMensal(poucos, "2026-09-03").insuficiente, true);
eq("44) e a média sai NULA (não zero)",       M.fardConsumoMensal(poucos, "2026-09-03").media, null);
const bons = { "2026-05":2, "2026-06":4, "2026-07":3, "2026-08":3 };
eq("45) 4 meses fechados já dá média",        M.fardConsumoMensal(bons, "2026-09-03").insuficiente, false);
eq("46) média de 2,4,3,3 = 3",                r2(M.fardConsumoMensal(bons, "2026-09-03").media), 3);
eq("47) o mês corrente não entra na média",   M.fardConsumoMensal(Object.assign({"2026-09":99}, bons), "2026-09-03").meses, 4);
eq("48) cobertura de 9 peças gastando 3/mês ≈ 91 dias", M.fardCobertura(9, 3), 91);
eq("49) sem consumo não existe cobertura",    M.fardCobertura(9, null), null);
eq("50) consumo zero não vira divisão por zero", M.fardCobertura(9, 0), null);

console.log("\n=== 8. Situação do estoque ===\n");
eq("51) estoque zerado é ruptura",            M.fardSituacaoEstoque(0, 10, 2), "ruptura");
eq("52) sem mínimo cadastrado: não configurado", M.fardSituacaoEstoque(5, null, null), "sem_minimo");
eq("53) abaixo do mínimo",                    M.fardSituacaoEstoque(4, 10, null), "abaixo");
eq("54) dentro do mínimo mas na margem de segurança", M.fardSituacaoEstoque(11, 10, 5), "seguranca");
eq("55) folgado é ok",                        M.fardSituacaoEstoque(30, 10, 5), "ok");

console.log("\n=== 9. Sugestão de compra ===\n");
const semMin = M.fardSugestao({saldo:4, minimo:null, seguranca:null, cobertura_meses:null, consumo_mes:3, em_pedido:0});
eq("56) sem mínimo, não sugere quantidade",   semMin.qtd, null);
contem("57) e diz o que está faltando cadastrar", semMin.faltando, "estoque mínimo");
const s1 = M.fardSugestao({saldo:4, minimo:10, seguranca:null, cobertura_meses:null, consumo_mes:null, em_pedido:0});
eq("58) mínimo 10 com 4 em casa: pedir 6",    s1.qtd, 6);
const s2 = M.fardSugestao({saldo:4, minimo:10, seguranca:2, cobertura_meses:2, consumo_mes:3, em_pedido:0});
eq("59) com segurança e cobertura: 10+2+6-4 = 14", s2.qtd, 14);
const s3 = M.fardSugestao({saldo:4, minimo:10, seguranca:2, cobertura_meses:2, consumo_mes:3, em_pedido:12});
eq("60) o que já está a caminho abate a sugestão", s3.qtd, 2);
eq("61) e nunca sugere quantidade negativa",  M.fardSugestao({saldo:99, minimo:10, em_pedido:50}).qtd, 0);
contem("62) a conta é explicada passo a passo", s2.conta, "mínimo 10");
contem("63) inclusive o que já foi pedido",   s3.conta, "já pedido 12");

console.log("\n=== 10. Custo: falta de preço não vira R$ 0 ===\n");
const cu = M.fardCusto([{quantidade:2, custo_unit:74}, {quantidade:1, custo_unit:null}]);
eq("64) soma só o que tem preço",             cu.valor, 148);
eq("65) e marca o total como incompleto",     cu.incompleto, true);
eq("66) dizendo quantas peças estão sem preço", cu.pecas_sem_preco, 1);
const cuVazio = M.fardCusto([{quantidade:3, custo_unit:null}]);
eq("67) nenhum preço: o valor é NULO, não zero", cuVazio.valor, null);

console.log("\n============================================");
console.log("  " + ok + " OK, " + falhou + " FALHA(S)");
console.log("============================================\n");
process.exit(falhou ? 1 : 0);
