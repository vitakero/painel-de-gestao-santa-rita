// O painel avisa quando o robô para de gravar.
//
// 27/08/2026: o robô ficou 2 horas mudo e o painel continuou mostrando os números das 09h
// com cara de atuais. Ninguém soube — foi achado por acaso. Número velho SEM ETIQUETA é
// pior que número faltando: a pessoa decide em cima dele achando que é de agora.
//
//   node scripts/testes/robo-vigia.test.cjs
const fs = require("fs");
const path = require("path");
const HTML = fs.readFileSync(path.join(__dirname, "..", "..", "output", "index.html"), "utf8");
const ini = HTML.indexOf("==ROBOVIGIA-INICIO=="), fim = HTML.indexOf("==ROBOVIGIA-FIM==");
if (ini < 0 || fim < 0) { console.log("ERRO: não achei o módulo no painel (rode o build antes)."); process.exit(1); }
const M = new Function(HTML.slice(HTML.indexOf("*/", ini) + 2, HTML.lastIndexOf("/*", fim))
  + "\nreturn {rvIdadeMin,rvNivel,rvQuanto,rvTexto,RV_ATRASO,RV_PARADO};")();

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + obtido + (bate ? "" : "   (esperado: " + esperado + ")"));
  bate ? ok++ : falhou++;
}
const AGORA = new Date("2026-08-27T14:00:00-03:00").getTime();
const atras = (min) => new Date(AGORA - min * 60000).toISOString();

// ---------------------------------------------------------------- a idade
eq("acabou de gravar", M.rvIdadeMin(AGORA, atras(0)), 0);
eq("gravou há 20 min (ciclo normal)", M.rvIdadeMin(AGORA, atras(20)), 20);
eq("gravou há 2 horas", M.rvIdadeMin(AGORA, atras(120)), 120);
eq("sem carimbo nenhum", M.rvIdadeMin(AGORA, null), null);
eq("carimbo estragado não vira número", M.rvIdadeMin(AGORA, "banana"), null);
eq("carimbo vazio", M.rvIdadeMin(AGORA, ""), null);
// relógio do computador atrasado não pode virar idade negativa
eq("carimbo do FUTURO vira zero, não negativo", M.rvIdadeMin(AGORA, new Date(AGORA + 600000).toISOString()), 0);

// ---------------------------------------------------------------- o nível
eq("0 min = tudo bem", M.rvNivel(0), "ok");
eq("20 min (uma rodada) = tudo bem", M.rvNivel(20), "ok");
eq("89 min = ainda tudo bem", M.rvNivel(89), "ok");
eq("90 min = atraso", M.rvNivel(90), "atraso");
eq("2 horas = atraso", M.rvNivel(120), "atraso");
eq("5h59 = ainda atraso", M.rvNivel(359), "atraso");
eq("6 horas = parado", M.rvNivel(360), "parado");
eq("um dia = parado", M.rvNivel(1440), "parado");
eq("sem carimbo não vira alarme", M.rvNivel(null), "sem");

// O CASO REAL de 27/08: o robô ficou 1h39 sem gravar e ninguém soube.
// Com este vigia, teria aparecido aviso na tela — o corte é 90 minutos.
eq("o caso real de hoje (1h39) TERIA alarmado", M.rvNivel(99), "atraso");
eq("uma rodada perdida (25 min) NÃO alarma", M.rvNivel(25), "ok");
eq("três rodadas perdidas (65 min) ainda não alarmam", M.rvNivel(65), "ok");

// ---------------------------------------------------------------- o texto
eq("minutos no singular", M.rvQuanto(1), "há 1 minuto");
eq("minutos no plural", M.rvQuanto(45), "há 45 minutos");
eq("vira hora depois de 60", M.rvQuanto(90), "há 1 hora");
eq("horas no plural", M.rvQuanto(120), "há 2 horas");
eq("vira dias depois de 48h", M.rvQuanto(4320), "há 3 dias");

eq("tudo bem = nenhum aviso na tela", M.rvTexto(20), null);
eq("sem carimbo = nenhum aviso", M.rvTexto(null), null);
const a = M.rvTexto(120), p = M.rvTexto(500);
eq("atraso tem nível certo", a && a.nivel, "atraso");
eq("atraso diz há quanto tempo", /há 2 horas/.test(a.corpo), true);
eq("atraso explica o que é o normal", /20 minutos/.test(a.corpo), true);
eq("parado tem nível certo", p && p.nivel, "parado");
eq("parado manda olhar o computador", /computador do robô/.test(p.corpo), true);
eq("parado avisa que o número NÃO é de agora", /não de agora/.test(p.corpo), true);

// ---------------------------------------------------------------- a ligação
eq("o aviso tem lugar no topo de todas as páginas", /id="rvAviso"/.test(HTML), true);
eq("lê só uma linha, e só o carimbo", /select\("atualizado_em"\)\.order\("atualizado_em"/.test(HTML), true);
eq("pede só 1 linha", /select\("atualizado_em"\)[\s\S]{0,90}\.limit\(1\)/.test(HTML), true);
eq("confere no login", /rvConferir\(\); setInterval\(rvConferir/.test(HTML), true);
eq("e a cada 10 minutos", /setInterval\(rvConferir, 10\*60\*1000\)/.test(HTML), true);
eq("sem acesso à tabela NÃO inventa alarme", /if\(!r\|\|r\.error\|\|!r\.data\|\|!r\.data\.length\) return;/.test(HTML), true);
eq("tem estilo pro atraso", /\.rv-atraso \{/.test(HTML), true);
eq("tem estilo pro parado", /\.rv-parado \{/.test(HTML), true);

// ---------------------------------------------------------------- só o master
// Pedido do dono: quem não mexe no robô não tem o que fazer com esse aviso.
eq("existe a checagem de master", /function rvEhMaster\(\)/.test(HTML), true);
eq("nem consulta a nuvem se não for master", /function rvConferir\(\)\{\s*if\(!rvEhMaster\(\)\) return;/.test(HTML), true);
eq("e limpa o aviso se não for master", /if\(!rvEhMaster\(\)\)\{ el\.innerHTML=""; return; \}/.test(HTML), true);
// monta a função de verdade, injetando um "window" de mentira em cada caso
const corpo = HTML.slice(HTML.indexOf("function rvEhMaster()"),
  HTML.indexOf("function rvEhMaster()") + 200).split("\n")[0];
const fabrica = new Function("window", corpo + "\nreturn rvEhMaster;");
const ehMaster = (w) => fabrica(w)();
eq("master vê", ehMaster({ __PERFIL: { is_master: true } }), true);
eq("funcionário comum não vê", ehMaster({ __PERFIL: { is_master: false } }), false);
eq("perfil ainda não carregou: não vê", ehMaster({ __PERFIL: null }), false);
eq("sem perfil nenhum: não vê", ehMaster({}), false);

console.log("\n" + ok + " ok, " + falhou + " falha(s).");
process.exit(falhou ? 1 : 0);
