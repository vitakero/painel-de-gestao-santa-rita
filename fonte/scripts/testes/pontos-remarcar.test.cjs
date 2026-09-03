// REMARCAR O VENCIMENTO DE UMA PARCELA — Pontos extras.
//
// Pedido dele em 03/09/2026, com o ponto 6 (Riograndense / vendedor Rubinha) aberto na tela:
// o vendedor acertou outras datas de pagamento — a de agosto pra 15/09, as de setembro e
// outubro pra 30/09. O calendário do painel não guarda três datas, guarda uma REGRA
// ("abriu dia 1º, cobra todo dia 1º"), e a data da parcela é o NOME dela.
//
// O QUE ESTE TESTE SEGURA: que a data original continue sendo o nome da parcela. Se um dia
// alguém "simplificar" trocando a chave pela data nova, comprovante, boleto e pagamento
// deste ponto se despregam em silêncio — e o painel já avisa disso em pxEdicaoDesalinha.
//
//   node scripts/testes/pontos-remarcar.test.cjs
const fs = require("fs");
const path = require("path");
const HTML = fs.readFileSync(path.join(__dirname, "..", "..", "output", "index.html"), "utf8");

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

// as contas de data, extraídas do painel gerado (não uma imitação delas)
const CODIGO =
  "var HOJE=arguments[0], pxQuitado=arguments[1], pxManBonif=function(){return false;};\n" +
  pega(/function pxParseData\(s\)\{[\s\S]*?\n\}/, "pxParseData") +
  pega(/function pxDateKey\(d\)\{[^\n]*\}/, "pxDateKey") +
  pega(/function pxAgenda\(p\)\{[\s\S]*?\n\}/, "pxAgenda") +
  pega(/function pxRemarc\(p,key\)\{[^\n]*\}/, "pxRemarc") +
  pega(/function pxRemarcVale\(p,key\)\{[^\n]*\}/, "pxRemarcVale") +
  pega(/function pxRemarcPend\(p,key\)\{[^\n]*\}/, "pxRemarcPend") +
  pega(/function pxVenc\(p,key\)\{[^\n]*\}/, "pxVenc") +
  pega(/function pxVencD\(p,key\)\{[^\n]*\}/, "pxVencD") +
  pega(/function pxAtrasado\(p\)\{[\s\S]*?\n\}/, "pxAtrasado") +
  pega(/function pxInadimplencia\(p\)\{[\s\S]*?\n\}/, "pxInadimplencia") +
  pega(/function pxAnoMesAtual\(\)\{[^\n]*\}/, "pxAnoMesAtual") +
  pega(/function pxPagoMes\(p\)\{[\s\S]*?\n\}/, "pxPagoMes") +
  pega(/function pxRemarcGravar\(p,key,nd,mot,quem,quando,autPor,agora\)\{[\s\S]*?\n\}/, "pxRemarcGravar") +
  pega(/function pxCobViva\(c\)\{[^\n]*\}/, "pxCobViva") +
  "return {pxAgenda,pxDateKey,pxParseData,pxRemarc,pxRemarcVale,pxRemarcPend,pxVenc,pxVencD,pxAtrasado,pxInadimplencia,pxPagoMes,pxRemarcGravar,pxCobViva};";

const HOJE = new Date(2026, 8, 3); // 03/09/2026, o dia em que ele pediu
// como o pxQuitado de verdade: comprovante anexado quita (fora manual/bonif pendentes — o teste de pagamento manual cobre isso)
const QUIT = function (p, k) { return !!(p.pagas || {})[k] || !!(p.comprovantes || {})[k]; };
const M = new Function(CODIGO)(HOJE, QUIT);
const em = (d) => new Function(CODIGO)(d, QUIT); // as mesmas contas, num outro "hoje"

// o ponto 6 da tela dele: R$ 400/mês, de 01/08/2026 a 31/10/2026 = 3 parcelas, todo dia 1º
function ponto6() {
  return { id: "p6", numero: 6, abertura: "2026-08-01", vencimento: "2026-10-31", valor: 400,
           pagamento: "Boleto", fornecedor: "Riograndense", vendedor: "Rubinha" };
}
const K = ["2026-08-01", "2026-09-01", "2026-10-01"];

console.log("1) o calendário do ponto 6 é o mesmo que ele viu na tela");
const p = ponto6();
eq("   3 parcelas", M.pxAgenda(p).length, 3);
eq("   e as datas são as de sempre", M.pxAgenda(p).map(M.pxDateKey).join(" "), K.join(" "));
eq("   sem remarcação, a data que vale é a própria", M.pxVenc(p, K[0]), K[0]);
eq("   está ATRASADO hoje (01/08 e 01/09 já passaram)", M.pxAtrasado(p), true);
eq("   2 parcelas vencidas", M.pxInadimplencia(p).n, 2);
eq("   R$ 800 devidos", M.pxInadimplencia(p).valor, 800);

console.log("\n2) o pedido AGUARDANDO não move nada (é o master que move)");
const pd = ponto6();
pd.remarcacoes = { "2026-08-01": { pend: { data: "2026-09-15", motivo: "acerto com o vendedor", quem: "Financeiro" } } };
eq("   a data que vale continua a antiga", M.pxVenc(pd, K[0]), "2026-08-01");
eq("   o pedido fica guardado e visível", M.pxRemarcPend(pd, K[0]).data, "2026-09-15");
eq("   nada valendo ainda", M.pxRemarcVale(pd, K[0]), "null");
eq("   e o ATRASADO não sai de graça", M.pxAtrasado(pd), true);

console.log("\n3) autorizado: as datas que o vendedor pediu");
// agosto -> 15/09, setembro -> 30/09, outubro -> 30/09 (escolha dele em 03/09/2026)
const aut = (d) => ({ data: d, st: "autorizado", motivo: "acerto com o vendedor Rubinha", quem: "Victor", autorizado_por: "Victor" });
const pa = ponto6();
pa.remarcacoes = { "2026-08-01": aut("2026-09-15"), "2026-09-01": aut("2026-09-30"), "2026-10-01": aut("2026-09-30") };
eq("   agosto vence 15/09", M.pxVenc(pa, K[0]), "2026-09-15");
eq("   setembro vence 30/09", M.pxVenc(pa, K[1]), "2026-09-30");
eq("   outubro vence 30/09", M.pxVenc(pa, K[2]), "2026-09-30");
eq("   o ATRASADO CAI (as três venceriam no futuro)", M.pxAtrasado(pa), false);
eq("   e não sobra ninguém inadimplente", M.pxInadimplencia(pa), "null");

console.log("\n4) a data original continua sendo o NOME da parcela");
// esta é a trava do arquivo: o calendário não pode passar a se chamar pela data nova
eq("   as chaves não mudaram", M.pxAgenda(pa).map(M.pxDateKey).join(" "), K.join(" "));
const pago = ponto6();
pago.pagas = { "2026-08-01": true };                 // comprovante/boleto pendurado na data ORIGINAL
pago.remarcacoes = { "2026-08-01": aut("2026-09-15") };
eq("   parcela paga continua paga depois de remarcar", M.pxAtrasado(pago), true); // sobra só a de setembro
eq("   e o que sobrou devendo é 1 parcela", M.pxInadimplencia(pago).n, 1);
eq("   de R$ 400", M.pxInadimplencia(pago).valor, 400);

console.log("\n5) data impossível não passa (foi daqui que a conversa começou)");
eq("   31/09 não existe", M.pxParseData("2026-09-31"), "null");
eq("   30/09 existe", M.pxParseData("2026-09-30") ? "sim" : "não", "sim");
eq("   31/10 existe", M.pxParseData("2026-10-31") ? "sim" : "não", "sim");
eq("   a janela recusa data impossível com nome", /Essa data não existe\. Confira o dia do mês/.test(HTML), true);

console.log("\n6) o caminho: financeiro remarca, master autoriza");
eq("   o lápis é desenhado na coluna da data", /data-remarcar="'\+ref\+'"/.test(HTML), true);
eq("   a janela pede a data nova", /Nova data de vencimento/.test(HTML), true);
eq("   e o motivo", /Por que a data mudou\?/.test(HTML), true);
eq("   sem motivo não sai", /Escreva por que a data mudou/.test(HTML), true);
eq("   funcionário: nasce AGUARDANDO, guardado à parte", /r\.pend=\{ data:nd, motivo:mot\.slice\(0,140\)/.test(HTML), true);
eq("   master: vale na hora", /pxRemarcGravar\(pA,kk,nd,mot,quem,agora,quem,agora\); \/\/ o próprio master: vale na hora/.test(HTML), true);
// A SENHA É A DO MASTER DE VERDADE (autorizarMaster confere no banco). O pxExigeMaster era uma
// senha por navegador que qualquer um criava na 1ª vez — revisão de 03/09/2026.
eq("   autorizar pede a senha REAL do master", /autorizarMaster\("Autorizar a data nova desta parcela é ato do master/.test(HTML), true);
eq("   e mostra o motivo ANTES de autorizar", /Autorizar a data nova\?/.test(HTML), true);
eq("   recusar também é ato de master", /autorizarMaster\("Recusar a data nova desta parcela é ato do master/.test(HTML), true);
eq("   nenhum caminho dos pontos usa mais a senha de navegador",
   (HTML.match(/pxExigeMaster\("Digite a senha master para (AUTORIZAR|RECUSAR|DESFAZER)/g) || []).length, 0);

console.log("\n7) as travas que evitam duas datas pro mesmo acerto");
eq("   o boleto vai pro banco com a data QUE VALE", /const vk=pxVenc\(p,key\);/.test(HTML), true);
eq("   e não com a chave", /const venc=\(vk<hj\)\?hj:vk;/.test(HTML), true);
eq("   boleto de pé no banco barra a remarcação", /Cancele o boleto antes/.test(HTML), true);
eq("   parcela já paga não se remarca", /Esta parcela já está quitada\. Remarcar a data dela/.test(HTML), true);
eq("   vencimento no passado não passa", /O banco não aceita boleto com vencimento no passado/.test(HTML), true);
eq("   avisa quando duas parcelas caem no mesmo dia", /vão sair "\+\(junto\.length\+1\)\+" boletos/.test(HTML), true);
eq("   editar o ponto não pode orfanar a remarcação",
   /return !!pxRemarcVale\(pAntigo,k\) \|\| !!pxRemarcPend\(pAntigo,k\);/.test(HTML), true);
eq("   recusar não apaga o que já valia",
   /if\(rA\.st==="autorizado"&&rA\.data\)\{ pA\.remarcacoes\[kk\]=Object\.assign\(\{\},rA,\{pend:null\}\); \}/.test(HTML), true);

console.log("\n8) a tela conta a verdade");
eq("   'todo dia 1' deixa de ser a história inteira", /titRem=nRem\?\(' · '\+nRem\+\(nRem===1\?' remarcada':' remarcadas'\)\)/.test(HTML), true);
eq("   a etiqueta diz qual era a data", /remarcada — era '\+pxFmtData\(key\)/.test(HTML), true);
eq("   o pedido aguardando aparece escrito (e escapado)", /pedido: '\+pxEsc\(pxFmtData\(pend\.data\)\)\+' · aguardando/.test(HTML), true);
eq("   a coluna nova viaja pra nuvem", /remarcacoes:p\.remarcacoes\|\|null/.test(HTML), true);
eq("   e volta dela", /if\(r\.remarcacoes\)p\.remarcacoes=r\.remarcacoes;/.test(HTML), true);
eq("   nuvem sem a coluna não derruba o resto", /"assinatura","remarcacoes"\]/.test(HTML), true);

console.log("\n9) o mês só está PAGO quando TODAS as parcelas dele estão (revisão de 03/09/2026)");
// caso real: setembro e outubro caem as duas em 30/09. Pagar uma não pode pintar setembro de PAGO.
const pm = ponto6();
pm.remarcacoes = { "2026-08-01": aut("2026-09-15"), "2026-09-01": aut("2026-09-30"), "2026-10-01": aut("2026-09-30") };
pm.pagas = { "2026-09-01": true };
eq("   20/09: uma paga, duas em aberto no mesmo mês -> NÃO está pago", em(new Date(2026, 8, 20)).pxPagoMes(pm), false);
pm.pagas = { "2026-08-01": true, "2026-09-01": true, "2026-10-01": true };
eq("   20/09: as três pagas -> PAGO", em(new Date(2026, 8, 20)).pxPagoMes(pm), true);
eq("   05/10: a mensalidade de OUTUBRO (paga em 30/09) conta em outubro", em(new Date(2026, 9, 5)).pxPagoMes(pm), true);
const pc = ponto6();
pc.remarcacoes = { "2026-08-01": aut("2026-09-15") };
pc.pagas = { "2026-08-01": true };
eq("   01/09: agosto (remarcada pra 15/09) paga, setembro em aberto -> NÃO está pago", em(new Date(2026, 8, 1)).pxPagoMes(pc), false);
const ps = ponto6(); ps.pagas = { "2026-09-01": true };
eq("   sem remarcação, a conta de sempre: setembro paga -> PAGO", M.pxPagoMes(ps), true);
const pcp = ponto6(); pcp.comprovantes = { "2026-09-01": "data:..." };
eq("   comprovante anexado continua contando como antes", M.pxPagoMes(pcp), true);

console.log("\n10) voltar pra data original DESFAZ a remarcação (não vira 'remarcada — era 01/10')");
const g = ponto6();
g.remarcacoes = { "2026-10-01": aut("2026-09-30") };
M.pxRemarcGravar(g, "2026-10-01", "2026-10-01", "o vendedor voltou atrás", "Victor", "t1", "Victor", "t2");
eq("   nada mais vale", M.pxRemarcVale(g, "2026-10-01"), "null");
eq("   a data que vale é a original", M.pxVenc(g, "2026-10-01"), "2026-10-01");
eq("   mas o rastro fica", g.remarcacoes["2026-10-01"].hist.length, 1);
eq("   com a data que valia antes", g.remarcacoes["2026-10-01"].hist[0].data, "2026-09-30");
const h = ponto6();
M.pxRemarcGravar(h, "2026-08-01", "2026-09-20", "acerto", "Financeiro", "t1", "Victor", "t2");
eq("   autorizar o pedido grava a data nova", M.pxVenc(h, "2026-08-01"), "2026-09-20");
eq("   quem pediu", h.remarcacoes["2026-08-01"].quem, "Financeiro");
eq("   quem autorizou", h.remarcacoes["2026-08-01"].autorizado_por, "Victor");
M.pxRemarcGravar(h, "2026-08-01", "2026-09-25", "de novo", "Victor", "t3", "Victor", "t3");
eq("   remarcar de novo empurra a anterior pro histórico", h.remarcacoes["2026-08-01"].hist.map(x => x.data).join(","), "2026-09-20");
const i = ponto6();
M.pxRemarcGravar(i, "2026-08-01", "2026-08-01", "x", "Victor", "t1", "Victor", "t1");
eq("   'remarcar' pra própria data sem histórico não deixa nada", i.remarcacoes["2026-08-01"] === undefined, true);
const j = ponto6();
j.remarcacoes = { "2026-08-01": { st: "autorizado", data: "2026-08-01" } };
eq("   registro velho com data igual à chave não conta como remarcada", M.pxRemarcVale(j, "2026-08-01"), "null");

console.log("\n11) o que vem torto da nuvem não vira HTML nem boleto (revisão de 03/09/2026)");
const x = ponto6();
x.remarcacoes = { "2026-08-01": { pend: { data: "<img src=x onerror=alert(1)>", motivo: "x", quem: "y" } } };
eq("   pedido com 'data' que não é data não existe", M.pxRemarcPend(x, "2026-08-01"), "null");
x.remarcacoes = { "2026-08-01": { st: "autorizado", data: "2026-09-31" } };
eq("   data impossível autorizada na nuvem não vale", M.pxRemarcVale(x, "2026-08-01"), "null");
eq("   e a data que vale volta a ser a original", M.pxVenc(x, "2026-08-01"), "2026-08-01");

console.log("\n12) as travas da autorização e do boleto (a trava só existia no lápis)");
eq("   autorizar com boleto vivo no banco é barrado", /Cancele o boleto antes de autorizar/.test(HTML), true);
eq("   autorizar parcela paga depois do pedido é barrado", /Esta parcela foi quitada depois do pedido/.test(HTML), true);
eq("   gerar boleto com pedido aguardando é barrado", /Há um pedido de remarcação aguardando/.test(HTML), true);
eq("   'cancelar' (cancelamento em curso) também é boleto vivo", M.pxCobViva({ status: "cancelar" }), true);
eq("   'erro' não é", M.pxCobViva({ status: "erro" }), false);
eq("   sem cobrança não é", M.pxCobViva(null), false);
eq("   'Tentar de novo' manda a data que VALE, não a velha", /campos\.vencimento=\(vk<hj\)\?hj:vk;/.test(HTML), true);
eq("   a janela do boleto mostra a data que VAI pro banco", /const dt=venc\.split\("-"\);/.test(HTML), true);
eq("   o aviso de boletos na mesma data ignora parcela paga", /k2!==kk && !pxQuitado\(p,k2\) && pxVenc\(p,k2\)===nd/.test(HTML), true);
eq("   pedido aguardando aparece no aviso do menu", /if\(pxRemarcPend\(p,k\)\) pend\+\+;/.test(HTML), true);

console.log("\n13) as travas valem na hora de GRAVAR, não só no clique (verificação de 03/09/2026)");
eq("   remarcar e autorizar reconferem parcela paga/boleto vivo antes de gravar", (HTML.match(/titulo:"A parcela mudou"/g) || []).length, 2);
eq("   'Tentar de novo' também barra pedido aguardando", (HTML.match(/Há um pedido de remarcação aguardando/g) || []).length >= 2, true);
eq("   pedido cuja data já passou não se autoriza", /A data pedida já passou/.test(HTML), true);
eq("   quem diz se a parcela está paga é pxQuitado, e só ele", /function pagaK\(k\)\{ return pxQuitado\(p,k\); \}/.test(HTML), true);
eq("   recusar preserva o rastro de remarcação já desfeita", /if\(hR\.length\) pA\.remarcacoes\[kk\]=\{hist:hR\};/.test(HTML), true);
eq("   desfazer pode voltar pra data original mesmo no passado", /if\(nd<hj && nd!==kk\)/.test(HTML), true);
const pmp = ponto6(); pmp.comprovantes = { "2026-09-01": "data:..." };
eq("   comprovante em parcela comum continua quitando o mês", M.pxPagoMes(pmp), true);

console.log("\n14) sem a coluna na nuvem, o painel AVISA em vez de dizer 'registrado' (03/09/2026, no ar)");
// ele pediu a remarcação, viu "Enviado para autorização", a etiqueta amarela sumiu na recarga
// seguinte e no master não havia nada: o pedido nunca chegou à nuvem (coluna remarcacoes não existia).
eq("   o painel pergunta à nuvem se a coluna existe", /function pxCheсarRemarc\(sb\)\{/.test(HTML), true);
eq("   e pergunta ao carregar os pontos", /pxCheсarRemarc\(sb\); \/\/ uma vez por sessão/.test(HTML), true);
eq("   o fallback do upsert levanta a bandeira", /if\(pxErroColuna\(r,"remarcacoes"\)\) pxSemRemarc=true;/.test(HTML), true);
eq("   a janela nem abre sem lugar pra guardar", /if\(pxSemRemarc===true\)\{ uiConfirm\(\{titulo:"Falta um passo no banco"/.test(HTML), true);
eq("   e se descobrir na hora de gravar, não diz que registrou", /titulo:"Não consegui guardar"/.test(HTML), true);
eq("   a mensagem diz o que fazer", /rodar o arquivo sql\/pontos_remarcacao\.sql no Supabase/.test(HTML), true);

console.log("\n" + ok + " OK, " + falhou + " falha(s).");
process.exitCode = falhou ? 1 : 0;
