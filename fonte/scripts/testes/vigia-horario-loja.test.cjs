// ============================================================
// BANCADA DO VIGIA — o silêncio só conta com a LOJA ABERTA.
//
// Pedido dele em 11/10/2026, domingo: a faixa vermelha "o robô parou de dar sinal" acendeu
// porque o robô parou às 13h23 — um minuto depois de a loja fechar (domingo é até 13h). O
// computador foi desligado no fim do expediente, como todo dia. O aviso estava contando
// minutos de relógio, então acenderia todo domingo à tarde e toda noite.
//
// O QUE ESTE TESTE SEGURA: que o vigia continue calando quando o silêncio é só loja fechada,
// e continue acendendo quando o silêncio comeu expediente. Se um dia alguém "simplificar"
// voltando a contar relógio, o alarme vira ruído e o dia de verdade passa batido.
//
//   node scripts/testes/vigia-horario-loja.test.cjs
// ============================================================
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

// as contas DE VERDADE, extraídas do painel gerado
const CODIGO =
  pega(/var RV_LOJA=\[[\s\S]*?\];/, "RV_LOJA") +
  pega(/var RV_FUSO="[^"]+";/, "RV_FUSO") +
  "var rvFmtLoja=null;\n" +
  pega(/function rvHoraLoja\(ms\)\{[\s\S]*?\n\}/, "rvHoraLoja") +
  pega(/function rvAberto\(ms\)\{[\s\S]*?\n\}/, "rvAberto") +
  pega(/function rvMinAbertos\(deMs, ateMs\)\{[\s\S]*?\n\}/, "rvMinAbertos") +
  pega(/function rvIdadeAberta\(agoraMs, quandoISO\)\{[\s\S]*?\n\}/, "rvIdadeAberta") +
  pega(/var RV_SEM_BATIMENTO=\d+;/, "RV_SEM_BATIMENTO") +
  "return {rvHoraLoja,rvAberto,rvMinAbertos,rvIdadeAberta,RV_SEM_BATIMENTO,RV_LOJA};";
const M = new Function(CODIGO)();

// hora de Caicó -> instante. O fuso é -03:00 o ano inteiro (não há horário de verão).
const h = (txt) => new Date(txt + "-03:00").getTime();
const acende = (carimbo, agora) => M.rvIdadeAberta(h(agora), new Date(h(carimbo)).toISOString()) >= M.RV_SEM_BATIMENTO;

console.log("1) a loja abre e fecha nas horas certas");
eq("   domingo 10h: aberta", M.rvAberto(h("2026-10-11T10:00")), true);
eq("   domingo 14h: fechada", M.rvAberto(h("2026-10-11T14:00")), false);
eq("   domingo 6h59: ainda fechada", M.rvAberto(h("2026-10-11T06:59")), false);
eq("   segunda 6h29: ainda fechada", M.rvAberto(h("2026-10-12T06:29")), false);
eq("   segunda 6h30: abriu", M.rvAberto(h("2026-10-12T06:30")), true);
eq("   sábado 20h59: aberta", M.rvAberto(h("2026-10-10T20:59")), true);
eq("   sábado 21h: fechou", M.rvAberto(h("2026-10-10T21:00")), false);
eq("   madrugada de quarta: fechada", M.rvAberto(h("2026-10-14T03:00")), false);

console.log("\n2) O CASO DELE: domingo 11/10, robô parou 13h23 (a loja fechou 13h)");
eq("   às 14h52 o silêncio de loja aberta é zero", M.rvIdadeAberta(h("2026-10-11T14:52"), new Date(h("2026-10-11T13:23")).toISOString()), 0);
eq("   logo o aviso NÃO acende", acende("2026-10-11T13:23", "2026-10-11T14:52"), false);
eq("   e às 23h também não", acende("2026-10-11T13:23", "2026-10-11T23:00"), false);
eq("   na segunda 6h30, na hora de abrir, ainda não", acende("2026-10-11T13:23", "2026-10-12T06:30"), false);
eq("   na segunda 7h10 ACENDE (40 min de expediente perdidos)", acende("2026-10-11T13:23", "2026-10-12T07:10"), true);

console.log("\n3) o que não pode ser escondido: silêncio DENTRO do expediente");
eq("   sábado: parou 17h57, às 18h57 acende", acende("2026-10-10T17:57", "2026-10-10T18:57"), true);
eq("   quarta de manhã: 45 min de silêncio acende", acende("2026-10-14T08:00", "2026-10-14T08:45"), true);
eq("   mas 20 min não (rodada atrasada não é alarme)", acende("2026-10-14T08:00", "2026-10-14T08:20"), false);
eq("   parou sexta 20h50: no sábado 7h10 acende", acende("2026-10-09T20:50", "2026-10-10T07:10"), true);
eq("   robô morto há uma semana: acende sem dúvida", acende("2026-10-04T09:00", "2026-10-11T10:00"), true);

console.log("\n4) a conta de minutos abertos fecha com o relógio");
eq("   uma hora cheia de expediente = 60", M.rvMinAbertos(h("2026-10-14T09:00"), h("2026-10-14T10:00")), 60);
eq("   das 20h30 à meia-noite da sexta = 30", M.rvMinAbertos(h("2026-10-09T20:30"), h("2026-10-10T00:00")), 30);
eq("   domingo das 12h30 às 18h = 30", M.rvMinAbertos(h("2026-10-11T12:30"), h("2026-10-11T18:00")), 30);
eq("   uma noite inteira de terça pra quarta = 0", M.rvMinAbertos(h("2026-10-13T22:00"), h("2026-10-14T05:00")), 0);
eq("   um domingo inteiro = 360 (6 horas)", M.rvMinAbertos(h("2026-10-11T00:00"), h("2026-10-12T00:00")), 360);
eq("   um sábado inteiro = 870 (14h30)", M.rvMinAbertos(h("2026-10-10T00:00"), h("2026-10-11T00:00")), 870);
eq("   data futura não vira número negativo", M.rvMinAbertos(h("2026-10-14T10:00"), h("2026-10-14T09:00")), 0);

console.log("\n4b) a fronteira dos 40 minutos é exata (a 1ª versão arredondava 39 para 40)");
eq("   39 minutos de expediente são 39", M.rvMinAbertos(h("2026-10-14T09:21"), h("2026-10-14T10:00")), 39);
eq("   39 não acende", acende("2026-10-14T09:21", "2026-10-14T10:00"), false);
eq("   40 acende", acende("2026-10-14T09:20", "2026-10-14T10:00"), true);
eq("   1 minuto é 1, não 5", M.rvMinAbertos(h("2026-10-14T09:59"), h("2026-10-14T10:00")), 1);
eq("   2 min antes de fechar contam 2", M.rvMinAbertos(h("2026-10-14T20:58"), h("2026-10-14T21:30")), 2);
eq("   e 3 min depois de abrir contam 3", M.rvMinAbertos(h("2026-10-14T06:00"), h("2026-10-14T06:33")), 3);

console.log("\n5) o vigia usa a régua nova nos três avisos");
eq("   batimento do robô", /var idadeAb=rvIdadeAberta\(Date\.now\(\), saude\.quando\);/.test(HTML), true);
eq("   e decide por ela", /if\(idade!==null && idadeAb!==null && idadeAb>=RV_SEM_BATIMENTO\)/.test(HTML), true);
eq("   idade do dado do VR", /rvTexto\(min, rvIdadeAberta\(Date\.now\(\), rvDadoQuando\)\)/.test(HTML), true);
eq("   as cinco tarefas do robô", /var idadeAbS = rvIdadeAberta\(agoraMs, s\.quando\);/.test(HTML), true);
eq("   mas o texto continua contando o tempo de RELÓGIO", /rvQuanto\(idade\)/.test(HTML), true);

console.log("\n" + ok + " OK, " + falhou + " falha(s).");
process.exitCode = falhou ? 1 : 0;
