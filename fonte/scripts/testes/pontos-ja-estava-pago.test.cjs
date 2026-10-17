// ============================================================
// BANCADA DO "JÁ ESTAVA PAGO" — a limpeza do passado dos Pontos Extras.
//
// Pedido dele em 17/10/2026: a maioria dos pontos foi cadastrada no painel depois de já estar
// rodando, com a abertura lá atrás. O calendário nasce cheio de parcela vencida que na vida
// real já foi paga, e o painel grita ATRASADO em quase todo mundo — vermelho que mente é
// vermelho que ninguém olha no dia em que for verdade.
//
// O QUE ESTE TESTE SEGURA: as travas. O botão é liberado para quem tem a página (sem senha do
// master, sem comprovante), e é justamente por isso que ele não pode encostar no que não é
// passado: parcela futura, parcela já paga, boleto de pé no banco, bonificação, galpão.
// E segura o INTERRUPTOR: quando a regularização terminar, PX_REGULARIZAR=false tem que
// apagar o botão de todas as telas de uma vez.
//
//   node scripts/testes/pontos-ja-estava-pago.test.cjs
// ============================================================
const fs = require("fs");
const path = require("path");
const HTML = fs.readFileSync(path.join(__dirname, "..", "..", "output", "index.html"), "utf8");
const SQL = fs.readFileSync(path.join(__dirname, "..", "..", "sql", "pontos_ja_estava_pago.sql"), "utf8");

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + obtido + (bate ? "" : "   (esperado: " + esperado + ")"));
  bate ? ok++ : falhou++;
}
function pega(re, nome) {
  const m = HTML.match(re);
  if (!m) { console.log("  FALHA | não achei " + nome + " no painel"); falhou++; return ""; }
  return m[0] + "\n";
}

// AS FUNÇÕES DE VERDADE, extraídas do painel gerado. Procurar a linha no arquivo não prova a
// conta — é a lição de 06/09/2026, quando um comando com caractere invisível passou por todas
// as provas de texto.
const CODIGO =
  "var HOJE=new Date(2026,9,17);\n" +                      // 17/10/2026
  "var PX_REGULARIZAR=arguments[0];\n" +
  "var pixCobDe=function(p,k){ return (p.cobs&&p.cobs[k])||null; };\n" +
  "var pixCobPaga=function(){ return false; };\n" +
  pega(/function pxParseData\(s\)\{[\s\S]*?\n\}/, "pxParseData") +
  pega(/function pxDateKey\(d\)\{[^\n]*\}/, "pxDateKey") +
  pega(/function pxAgenda\(p\)\{[\s\S]*?\n\}/, "pxAgenda") +
  pega(/function pxRemarc\(p,key\)\{[^\n]*\}/, "pxRemarc") +
  pega(/function pxRemarcVale\(p,key\)\{[^\n]*\}/, "pxRemarcVale") +
  pega(/function pxVenc\(p,key\)\{[^\n]*\}/, "pxVenc") +
  pega(/function pxVencD\(p,key\)\{[^\n]*\}/, "pxVencD") +
  pega(/function pxManSt\(man\)\{[^\n]*\}/, "pxManSt") +
  pega(/function pxManBonif\(man\)\{[^\n]*\}/, "pxManBonif") +
  pega(/function pxManManual\(man\)\{[^\n]*\}/, "pxManManual") +
  pega(/function pxManRetro\(man\)\{[^\n]*\}/, "pxManRetro") +
  pega(/function pxQuitado\(p,key\)\{[\s\S]*?\n\}/, "pxQuitado") +
  pega(/function pxPodeRetro\(p,key\)\{[\s\S]*?\n\}/, "pxPodeRetro") +
  pega(/function pxRetroPendentes\(p\)\{[\s\S]*?\n\}/, "pxRetroPendentes") +
  pega(/function pxAtrasado\(p\)\{[\s\S]*?\n\}/, "pxAtrasado") +
  "return {pxPodeRetro,pxRetroPendentes,pxQuitado,pxAtrasado,pxAgenda,pxDateKey,pxManRetro};";
const M = new Function(CODIGO)(true);      // interruptor LIGADO
const DESLIGADO = new Function(CODIGO)(false);

// o ponto 1 da tela dele: cadastrado agora, calendário de 02/02/2026 a 20/01/2027
function ponto1() {
  return { id: "p1", numero: 1, abertura: "2026-02-02", vencimento: "2027-01-20", valor: 400,
           pagamento: "Boleto", fornecedor: "RIOGRANDENSE DISTRIBUIDORA LTDA" };
}
const JAPAGO = { t: "retro", st: "autorizado", quem: "Victor", quando: "2026-10-17T10:00:00.000Z" };

console.log("1) o calendário do ponto 1, visto em 17/10/2026");
const p = ponto1();
eq("   12 parcelas", M.pxAgenda(p).length, 12);
eq("   9 vencidas esperando regularização", M.pxRetroPendentes(p).length, 9);
eq("   a primeira é a de fevereiro", M.pxRetroPendentes(p)[0], "2026-02-02");
eq("   a última é a de outubro", M.pxRetroPendentes(p)[8], "2026-10-02");
eq("   e o ponto está ATRASADO", M.pxAtrasado(p), true);

console.log("\n2) o passado é o único assunto");
eq("   parcela vencida: pode", M.pxPodeRetro(p, "2026-09-02"), true);
eq("   parcela de hoje: NÃO (ainda não venceu)", M.pxPodeRetro(ponto1Hoje(), "2026-10-17"), false);
eq("   parcela futura: NÃO", M.pxPodeRetro(p, "2026-11-02"), false);
eq("   dezembro: NÃO", M.pxPodeRetro(p, "2026-12-02"), false);
function ponto1Hoje() {
  return { id: "ph", numero: 2, abertura: "2026-10-17", vencimento: "2027-10-17", valor: 400, pagamento: "Boleto" };
}

console.log("\n3) as travas que seguram o botão solto");
const pago = ponto1(); pago.comprovantes = { "2026-03-02": "data:..." };
eq("   parcela já paga: NÃO", M.pxPodeRetro(pago, "2026-03-02"), false);
const comBoleto = ponto1(); comBoleto.cobs = { "2026-09-02": { status: "gerado" } };
eq("   boleto gerado no banco: NÃO", M.pxPodeRetro(comBoleto, "2026-09-02"), false);
comBoleto.cobs = { "2026-09-02": { status: "pedido" } };
eq("   boleto pedido: NÃO", M.pxPodeRetro(comBoleto, "2026-09-02"), false);
comBoleto.cobs = { "2026-09-02": { status: "gerando" } };
eq("   boleto gerando: NÃO", M.pxPodeRetro(comBoleto, "2026-09-02"), false);
comBoleto.cobs = { "2026-09-02": { status: "erro" } };
eq("   mas boleto com ERRO não barra (não há o que pagar)", M.pxPodeRetro(comBoleto, "2026-09-02"), true);
const pend = ponto1(); pend.manuais = { "2026-09-02": { t: "manual", st: "pendente", motivo: "pix" } };
eq("   'marcar pago' esperando o master: NÃO", M.pxPodeRetro(pend, "2026-09-02"), false);
const bonif = ponto1(); bonif.pagamento = "Bonificação";
eq("   bonificação (tem fluxo próprio): NÃO", M.pxPodeRetro(bonif, "2026-09-02"), false);
const galpao = ponto1(); galpao.diaPag = 5;
eq("   galpão (exige comprovante, regra de 30/09): NÃO", M.pxPodeRetro(galpao, "2026-09-02"), false);

console.log("\n4) depois de marcar, a parcela sai do atrasado");
const limpo = ponto1();
limpo.manuais = {};
M.pxRetroPendentes(limpo).forEach(k => { limpo.manuais[k] = JAPAGO; });
eq("   as 9 ficaram quitadas", M.pxAgenda(limpo).map(M.pxDateKey).filter(k => M.pxQuitado(limpo, k)).length, 9);
eq("   o ponto deixou de estar ATRASADO", M.pxAtrasado(limpo), false);
eq("   e não sobra nada para regularizar", M.pxRetroPendentes(limpo).length, 0);
eq("   o registro diz que foi o retroativo", M.pxManRetro(limpo.manuais["2026-02-02"]), true);
eq("   com o nome de quem marcou", limpo.manuais["2026-02-02"].quem, "Victor");
// não pode virar porta dos fundos do "marcar pago": aquele exige comprovante e senha
eq("   e NÃO se confunde com o pagamento manual", /function pxManManual\(man\)\{[^\n]*t==="manual"/.test(HTML), true);

console.log("\n5) O INTERRUPTOR — é isto que ele vai pedir para desligar");
eq("   com PX_REGULARIZAR=false, nada pode ser regularizado", DESLIGADO.pxPodeRetro(ponto1(), "2026-09-02"), false);
eq("   e a lista fica vazia", DESLIGADO.pxRetroPendentes(ponto1()).length, 0);
eq("   o interruptor está no painel, ligado", /var PX_REGULARIZAR = true;/.test(HTML), true);
eq("   e o bloco é marcado para achar e apagar", /==PXREGULARIZA-INICIO==/.test(HTML) && /==PXREGULARIZA-FIM==/.test(HTML), true);

console.log("\n6) a tela");
eq("   botão na linha vencida", /data-retro="'\+ref\+'"/.test(HTML), true);
eq("   botão de lote no cabeçalho", /data-retrolote="'\+p\.id\+'"/.test(HTML), true);
eq("   o de lote diz QUANTAS são", /Já estavam pagas \('\+retroN\+'\)/.test(HTML), true);
eq("   e o diálogo lista quais, com o total", /Somam "\+brl\(totL\)/.test(HTML), true);
eq("   depois de marcada, a linha diz 'Já estava pago'", /pxManRetro\(man\)\?"Já estava pago"/.test(HTML), true);
eq("   o ✕ desfaz sem pedir senha (é do mesmo tamanho do clique que criou)", /data-retroundo="'\+ref\+'"/.test(HTML), true);
// Estas duas garantias moraram na tela até 17/10/2026 e MUDARAM DE LUGAR: agora são do banco,
// onde ninguém alcança pelo console do navegador. É por isso que se procura no SQL, não no HTML.
eq("   o desfazer só mexe no que ESTE botão criou (regra no banco)", /'nao_foi_marcada_assim'/.test(SQL), true);
eq("   e cada parcela do lote é conferida uma a uma, no banco", /foreach k in array p_parcelas loop/.test(SQL), true);

console.log("\n7) QUEM GRAVA É O BANCO (o defeito de 17/10: a trava desfazia em silêncio)");
// Se um dia alguém "simplificar" isto de volta para gravar em pontosG e deixar o envio levar,
// o botão volta a mentir na tela: marca, parece pago, e some segundos depois.
eq("   a linha pede ao banco", /pxRetroPedir\(pr\[0\],\[kk\]\)/.test(HTML), true);
eq("   o lote também", /pxRetroPedir\(pid, pxRetroPendentes\(pA\)\)/.test(HTML), true);
eq("   o desfazer também", /pxRetroDesfazer\(pr\[0\],kk\)/.test(HTML), true);
eq("   chama a função certa", /rpc\("pontos_marcar_ja_pago"/.test(HTML), true);
eq("   e a de desfazer", /rpc\("pontos_desfazer_ja_pago"/.test(HTML), true);
eq("   desenha só o que o banco confirmou", /Object\.keys\(d\.manuais\|\|\{\}\)\.forEach/.test(HTML), true);
eq("   nenhum caminho grava manuais por fora", /pA\.manuais\[kk\]=\{ t:"retro"/.test(HTML), false);
eq("   se a função não existe no banco, DIZ qual arquivo rodar", /sql\/pontos_ja_estava_pago\.sql/.test(HTML), true);
eq("   e conta quais ficaram de fora, e por quê", /Ficaram de fora/.test(HTML), true);
// Pedido dele em 17/10/2026: deu certo não abre janela (são dezenas de cliques; um "Ok" a cada
// um ensina a pessoa a clicar sem ler). Só interrompe o que ele não veria sozinho.
eq("   quando dá tudo certo, não interrompe", /if\(!rec\.length && d\.n\) return;/.test(HTML), true);

console.log("\n" + ok + " OK, " + falhou + " falha(s).");
process.exitCode = falhou ? 1 : 0;
