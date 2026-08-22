// Testes do HOTFIX de sincronização das Entregas (07/08/2026).
// O bug: bastava UMA linha na nuvem para o painel trocar entDados inteiro pelo conteúdo
// da nuvem e regravar o localStorage por cima — apagando lançamentos que só existiam
// no navegador. Estes testes garantem que a nuvem só é adotada quando não tira nada.
// NÃO duplica a lógica: extrai o módulo ==ENTSYNC-*== do painel já construído.
//   node scripts/testes/entregas-sync.test.cjs
const fs = require("fs");
const path = require("path");

const HTML = fs.readFileSync(path.join(__dirname, "..", "..", "output", "index.html"), "utf8");
const ini = HTML.indexOf("==ENTSYNC-INICIO==");
const fim = HTML.indexOf("==ENTSYNC-FIM==");
if (ini < 0 || fim < 0) { console.log("ERRO: não achei o módulo de sincronização no output/index.html (rode o build antes)."); process.exit(1); }
const codigo = HTML.slice(HTML.indexOf("*/", ini) + 2, HTML.lastIndexOf("/*", fim));

// localStorage de mentira: as chaves de dado ficam enumeráveis, os métodos não —
// assim Object.keys(localStorage) devolve só as chaves, igual no navegador.
function novoLS(inicial) {
  const ls = Object.assign({}, inicial || {});
  const def = (n, f) => Object.defineProperty(ls, n, { value: f, enumerable: false });
  def("getItem", (k) => (Object.prototype.hasOwnProperty.call(ls, k) ? String(ls[k]) : null));
  def("setItem", (k, v) => { ls[k] = String(v); });
  def("removeItem", (k) => { delete ls[k]; });
  return ls;
}
function carregar(ls) {
  return new Function("localStorage", "window",
    codigo + "\nreturn {entDiagRetrato,entDiagDivergentes,entBackupLocal,entDiagLocal,entExportarLocal};")(ls, {});
}

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + obtido + (bate ? "" : "   (esperado: " + esperado + ")"));
  bate ? ok++ : falhou++;
}

const M = carregar(novoLS());

// Cenário real de 07/08/2026: o navegador tem meses de lançamento, a nuvem tem 1 linha.
const LOCAL = {
  "2026-6": { "Anderson": { 1: 30, 2: 28, 3: 31 }, "Lucas": { 1: 25, 2: 27 } },
  "2026-7": { "Anderson": { 1: 34, 3: 29 }, "Lucas": { 1: 22 } },
};
const NUVEM_1_LINHA = { "2026-7": { "Anderson": { 1: 1 } } };

console.log("\n=== Retrato do que está guardado ===\n");

const R = M.entDiagRetrato(LOCAL);
eq("1) conta as competências", R.competencias, 2);
eq("2) conta as células", R.celulas, 8);
eq("3) soma as entregas", R.soma, 226);
eq("4) lista os entregadores", R.entregadores.join(","), "Anderson,Lucas");
eq("5) acha o último mês com dado", R.ultimoMes, "2026-08");
eq("6) objeto vazio não quebra", M.entDiagRetrato({}).celulas, 0);
eq("7) null não quebra", M.entDiagRetrato(null).competencias, 0);
eq("8) soma de objeto vazio é zero, não NaN", M.entDiagRetrato({}).soma, 0);

console.log("\n=== A CONTA QUE DECIDE: adotar a nuvem apagaria algo? ===\n");

eq("9) O BUG REAL: 1 linha na nuvem x meses no navegador -> divergência",
   M.entDiagDivergentes(LOCAL, NUVEM_1_LINHA).length, 8);
eq("10) navegador vazio + nuvem cheia -> pode adotar, não perde nada",
   M.entDiagDivergentes({}, LOCAL).length, 0);
eq("11) navegador e nuvem iguais -> nada a fazer",
   M.entDiagDivergentes(LOCAL, LOCAL).length, 0);
eq("12) nuvem tem célula A MAIS -> não é perda, pode adotar",
   M.entDiagDivergentes({ "2026-7": { "Ana": { 1: 10 } } },
                        { "2026-7": { "Ana": { 1: 10, 2: 5 } } }).length, 0);
eq("13) mesma célula com valor DIFERENTE -> é divergência",
   M.entDiagDivergentes({ "2026-7": { "Ana": { 1: 10 } } },
                        { "2026-7": { "Ana": { 1: 7 } } }).length, 1);
eq("14) célula que a nuvem não tem -> é divergência",
   M.entDiagDivergentes({ "2026-7": { "Ana": { 5: 12 } } },
                        { "2026-7": { "Ana": { 1: 7 } } }).length, 1);
eq("15) entregador inteiro que a nuvem não tem -> divergência",
   M.entDiagDivergentes({ "2026-7": { "Ana": { 1: 3 }, "Beto": { 1: 4 } } },
                        { "2026-7": { "Ana": { 1: 3 } } }).length, 1);
eq("16) mês inteiro que a nuvem não tem -> divergência",
   M.entDiagDivergentes({ "2026-5": { "Ana": { 1: 3 } }, "2026-7": { "Ana": { 1: 3 } } },
                        { "2026-7": { "Ana": { 1: 3 } } }).length, 1);
eq("17) ZERO confirmado no navegador e ausente na nuvem É divergência",
   M.entDiagDivergentes({ "2026-7": { "Ana": { 1: 0 } } }, {}).length, 1);
eq("18) zero no navegador e zero na nuvem: iguais",
   M.entDiagDivergentes({ "2026-7": { "Ana": { 1: 0 } } },
                        { "2026-7": { "Ana": { 1: 0 } } }).length, 0);
eq("19) os dois vazios",  M.entDiagDivergentes({}, {}).length, 0);
eq("20) nulos não quebram", M.entDiagDivergentes(null, null).length, 0);

const ex = M.entDiagDivergentes({ "2026-7": { "Ana": { 5: 12 } } }, { "2026-7": { "Ana": { 5: 7 } } })[0];
eq("21) o exemplo diz o mês",         ex.mes, "2026-7");
eq("22) o exemplo diz quem",          ex.nome, "Ana");
eq("23) o exemplo diz o dia",         ex.dia, 5);
eq("24) o exemplo diz o valor local", ex.local, 12);
eq("25) o exemplo diz o valor da nuvem", ex.nuvem, 7);
eq("26) célula ausente na nuvem aparece como nula",
   M.entDiagDivergentes({ "2026-7": { "Ana": { 5: 12 } } }, {})[0].nuvem, null);

console.log("\n=== Cópia de segurança ===\n");

{
  const ls = novoLS({ "entregas_dados": JSON.stringify(LOCAL), "entregas_entregadores": '["Anderson","Lucas"]' });
  const B = carregar(ls);
  const k1 = B.entBackupLocal();
  eq("27) cria backup com o nome combinado", /^entregas_dados_backup_/.test(k1), "true");
  eq("28) o backup guarda o conteúdo exato", ls.getItem(k1), JSON.stringify(LOCAL));
  eq("29) guarda também a lista de entregadores",
     Object.keys(ls).filter((k) => k.indexOf("entregas_entregadores_backup_") === 0).length, 1);
  const k2 = B.entBackupLocal();
  eq("30) chamar de novo com o MESMO conteúdo não cria backup duplicado", k2, k1);
  eq("31) continua existindo um backup só",
     Object.keys(ls).filter((k) => k.indexOf("entregas_dados_backup_") === 0).length, 1);
  eq("32) NÃO apagou a chave original", ls.getItem("entregas_dados"), JSON.stringify(LOCAL));
  eq("33) NÃO marcou ent_migrado", ls.getItem("ent_migrado"), null);
}

console.log("\n=== Diagnóstico do navegador (Fase 1) ===\n");

{
  const ls = novoLS({
    "entregas_dados": JSON.stringify(LOCAL),
    "entregas_entregadores": '["Anderson","Lucas"]',
    "ent_migrado": "1",
    "entregas_dados_backup_2026-08-07T00-00-00-000Z": "{}",
  });
  const D = carregar(ls).entDiagLocal();
  eq("34) acusa que existe dado guardado", D.existe_entregas_dados, "true");
  eq("35) competências", D.competencias, 2);
  eq("36) células",      D.celulas, 8);
  eq("37) total de entregas", D.total_entregas, 226);
  eq("38) entregadores encontrados", D.entregadores_encontrados.join(","), "Anderson,Lucas");
  eq("39) último mês com dado", D.ultimo_mes_com_dado, "2026-08");
  eq("40) lê a marca ent_migrado", D.ent_migrado, "1");
  eq("41) encontra os backups existentes", D.backups.length, 1);
  eq("42) resumo por competência tem os 2 meses", D.por_competencia.length, 2);
  eq("43) julho: 5 células",  D.por_competencia[0].celulas, 5);
  eq("44) julho: 141 entregas", D.por_competencia[0].entregas, 141);
  eq("45) rótulo da competência é legível", D.por_competencia[0].competencia, "2026-07");
  eq("46) agosto vem depois de julho", D.por_competencia[1].competencia, "2026-08");
}
{
  const D = carregar(novoLS()).entDiagLocal();
  eq("47) navegador limpo: não existe dado", D.existe_entregas_dados, "false");
  eq("48) navegador limpo: zero células",    D.celulas, 0);
  eq("49) navegador limpo: sem backups",     D.backups.length, 0);
  eq("50) navegador limpo: ent_migrado nulo", D.ent_migrado, null);
}
{
  const ls = novoLS({ "entregas_dados": "{ isso não é json" });
  const D = carregar(ls).entDiagLocal();
  eq("51) dado corrompido não derruba o diagnóstico", D.celulas, 0);
  eq("52) dado corrompido: segue respondendo", D.existe_entregas_dados, "false");
}

console.log("\n" + (falhou ? "FALHOU: " + falhou + " de " + (ok + falhou) : "TUDO OK: " + ok + " testes") + "\n");
process.exit(falhou ? 1 : 0);
