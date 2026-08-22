// Testes da camada de dados v2 das Entregas (07/08/2026):
// identidade por código fixo, homônimos, nome da época e fila de gravação.
// NÃO duplica a lógica: extrai o módulo ==ENTV2-*== do painel já construído.
//   node scripts/testes/entregas-identidade.test.cjs
const fs = require("fs");
const path = require("path");

const HTML = fs.readFileSync(path.join(__dirname, "..", "..", "output", "index.html"), "utf8");
const ini = HTML.indexOf("==ENTV2-INICIO==");
const fim = HTML.indexOf("==ENTV2-FIM==");
if (ini < 0 || fim < 0) { console.log("ERRO: não achei o módulo v2 no output/index.html (rode o build antes)."); process.exit(1); }
const codigo = HTML.slice(HTML.indexOf("*/", ini) + 2, HTML.lastIndexOf("/*", fim));

function novoLS() {
  const ls = {};
  const def = (n, f) => Object.defineProperty(ls, n, { value: f, enumerable: false });
  def("getItem", (k) => (Object.prototype.hasOwnProperty.call(ls, k) ? String(ls[k]) : null));
  def("setItem", (k, v) => { ls[k] = String(v); });
  def("removeItem", (k) => { delete ls[k]; });
  return ls;
}
// O módulo mexe na tela e na nuvem; aqui os dois são de mentira.
function carregar() {
  const ls = novoLS();
  const doc = { getElementById: () => null };
  const win = { addEventListener: () => {}, crypto: null };
  const entSB = () => null;               // sem nuvem: a fila só acumula
  const M = new Function("localStorage", "document", "window", "entSB", "setInterval", "navigator",
    codigo + "\nreturn {entEquipe,entDados,entNomes,entFila,entMesKey,entUuid,entPessoa,entNomeDe," +
             "entAtivos,entIdsDoMes,entGet,entGetRaw,entSet,entFilaAdd,entFilaPendentes," +
             "entGravarCelula,entGravado,entRasGet,entTemRascunho,entRasResumo,entRasTotal,entRasApaga," +
             "entAddEntregador,entRenameEntregador,entInativar,entReativar,entCacheSalvar," +
             "entTemHistorico,entExcluirPessoa," +
             "estado:function(){return{equipe:entEquipe,dados:entDados,nomes:entNomes,fila:entFila};}};"
  )(ls, doc, win, entSB, () => 0, { onLine: true });
  M.ls = ls;
  return M;
}

// DIGITAR não grava mais nada: entSet só mexe no rascunho local. Quem grava é o botão
// Salvar, que chama entGravarCelula. Este atalho faz as duas coisas, como um Salvar.
function lancar(M, a, m, id, d, v) {
  M.entGravarCelula(a, m, id, d, v);
  M.entSet(a, m, id, d, v);      // digita o mesmo valor: o rascunho se apaga sozinho
}

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + obtido + (bate ? "" : "   (esperado: " + esperado + ")"));
  bate ? ok++ : falhou++;
}

console.log("\n=== Identidade: o nome deixou de ser a chave ===\n");
{
  const M = carregar();
  M.entAddEntregador("Anderson");
  M.entAddEntregador("Anderson");          // homônimo: o banco agora permite
  M.entAddEntregador("Lucas");
  const eq_ = M.estado().equipe;
  eq("1) os três entraram na equipe", eq_.length, 3);
  eq("2) dois com o MESMO nome", eq_[0].nome + "/" + eq_[1].nome, "Anderson/Anderson");
  eq("3) mas com códigos DIFERENTES", eq_[0].id !== eq_[1].id, "true");
  eq("4) o código parece um uuid", /^[0-9a-f-]{36}$/i.test(eq_[0].id), "true");
  eq("5) nascem ativos", eq_[0].ativo, "true");
  eq("6) entPessoa acha pelo código", M.entPessoa(eq_[2].id).nome, "Lucas");
  eq("7) código que não existe devolve nulo", M.entPessoa("nao-existe"), null);
  eq("8) nome vazio não cadastra", M.entAddEntregador("   "), "false");
  eq("9) e a equipe continua com 3", M.estado().equipe.length, 3);
}

console.log("\n=== Homônimos não se misturam ===\n");
{
  const M = carregar();
  M.entAddEntregador("Anderson"); M.entAddEntregador("Anderson");
  const [a1, a2] = M.estado().equipe;
  lancar(M, 2026, 7, a1.id, 3, 40);
  lancar(M, 2026, 7, a2.id, 3, 25);
  eq("10) o primeiro tem 40",  M.entGet(2026, 7, a1.id, 3), 40);
  eq("11) o segundo tem 25",   M.entGet(2026, 7, a2.id, 3), 25);
  eq("12) um não enxerga o do outro", M.entGet(2026, 7, a1.id, 3) !== M.entGet(2026, 7, a2.id, 3), "true");
  eq("13) os dois aparecem no mês",   M.entIdsDoMes(2026, 7).length, 2);
}

console.log("\n=== Renomear não mexe em lançamento nenhum ===\n");
{
  const M = carregar();
  M.entAddEntregador("Anderson"); M.entAddEntregador("Lucas");
  const [and, luc] = M.estado().equipe;
  lancar(M, 2026, 6, and.id, 5, 30);
  lancar(M, 2026, 7, and.id, 3, 40);
  lancar(M, 2026, 7, luc.id, 3, 10);
  const antes = M.entGet(2026, 6, and.id, 5) + M.entGet(2026, 7, and.id, 3);
  M.entRenameEntregador(and.id, "Anderson Silva");
  eq("14) o cadastro mostra o nome novo", M.entPessoa(and.id).nome, "Anderson Silva");
  eq("15) julho continua com 30",  M.entGet(2026, 6, and.id, 5), 30);
  eq("16) agosto continua com 40", M.entGet(2026, 7, and.id, 3), 40);
  eq("17) o total dele não mudou", M.entGet(2026, 6, and.id, 5) + M.entGet(2026, 7, and.id, 3), antes);
  eq("18) o MÊS ANTIGO mostra o nome DA ÉPOCA", M.entNomeDe(and.id, "2026-6"), "Anderson");
  eq("19) e agosto também",                     M.entNomeDe(and.id, "2026-7"), "Anderson");
  eq("20) um mês SEM lançamento usa o nome atual", M.entNomeDe(and.id, "2026-9"), "Anderson Silva");
  eq("21) renomear para o mesmo nome não faz nada", M.entRenameEntregador(and.id, "Anderson Silva"), "false");
  eq("22) renomear para vazio é recusado",          M.entRenameEntregador(and.id, "  "), "false");
  eq("23) código inexistente é recusado",           M.entRenameEntregador("xxx", "Zé"), "false");
}

console.log("\n=== Inativar preserva o passado ===\n");
{
  const M = carregar();
  M.entAddEntregador("Anderson"); M.entAddEntregador("Lucas");
  const [and, luc] = M.estado().equipe;
  lancar(M, 2026, 7, and.id, 3, 40);
  lancar(M, 2026, 7, luc.id, 3, 10);
  const idsAntes = M.entIdsDoMes(2026, 7).length;
  M.entInativar(luc.id);
  eq("24) ele fica inativo no cadastro", M.entPessoa(luc.id).ativo, "false");
  eq("25) os lançamentos dele continuam lá", M.entGet(2026, 7, luc.id, 3), 10);
  eq("26) ele CONTINUA aparecendo no mês em que trabalhou", M.entIdsDoMes(2026, 7).indexOf(luc.id) >= 0, "true");
  eq("27) o mês não perdeu ninguém", M.entIdsDoMes(2026, 7).length, idsAntes);
  eq("28) mas sai da lista de ativos", M.entAtivos().length, 1);
  eq("29) e NÃO aparece num mês onde nunca lançou", M.entIdsDoMes(2026, 9).indexOf(luc.id), -1);
  eq("30) inativar duas vezes não quebra", M.entInativar(luc.id), "false");
  M.entReativar(luc.id);
  eq("31) reativar usa o MESMO código", M.entPessoa(luc.id).id, luc.id);
  eq("32) e o histórico volta inteiro", M.entGet(2026, 7, luc.id, 3), 10);
  eq("33) reativar duas vezes não quebra", M.entReativar(luc.id), "false");
}

console.log("\n=== Funcionário novo com nome de ex NÃO herda nada ===\n");
{
  const M = carregar();
  M.entAddEntregador("Lucas");
  const velho = M.estado().equipe[0];
  lancar(M, 2026, 6, velho.id, 5, 500);
  M.entInativar(velho.id);
  M.entAddEntregador("Lucas");                       // outra pessoa, mesmo nome
  const novo = M.estado().equipe.filter((p) => p.id !== velho.id)[0];
  eq("34) são cadastros diferentes", novo.id !== velho.id, "true");
  eq("35) o novo começa zerado",     M.entGet(2026, 6, novo.id, 5), 0);
  eq("36) o histórico do antigo continua com ele", M.entGet(2026, 6, velho.id, 5), 500);
  eq("37) o novo não aparece no mês antigo", M.entIdsDoMes(2026, 6).indexOf(novo.id) >= 0, "true");
}

console.log("\n=== Zero confirmado x célula apagada ===\n");
{
  const M = carregar();
  M.entAddEntregador("Ana");
  const ana = M.estado().equipe[0].id;
  lancar(M, 2026, 7, ana, 3, 0);
  eq("38) zero é guardado como zero", M.entGetRaw(2026, 7, ana, 3), 0);
  eq("39) e não é vazio", M.entGetRaw(2026, 7, ana, 3) === "" ? "vazio" : "tem valor", "tem valor");
  lancar(M, 2026, 7, ana, 3, "");
  eq("40) apagada devolve vazio", M.entGetRaw(2026, 7, ana, 3), "");
  eq("41) e entGet devolve 0 pra conta", M.entGet(2026, 7, ana, 3), 0);
  eq("42) apagar virou intenção de REMOVER, não de salvar zero",
     M.estado().fila.filter((f) => f.tipo === "remover_dia").length, 1);
}

console.log("\n=== Digitar NÃO grava: o rascunho ===\n");
{
  const M = carregar();
  M.entAddEntregador("Ana");
  const ana = M.estado().equipe[0].id;

  M.entSet(2026, 7, ana, 3, 42);                       // só digitou
  eq("R1) o que foi digitado aparece na tela",   M.entGetRaw(2026, 7, ana, 3), 42);
  eq("R2) mas NADA foi gravado",                 M.entGravado(2026, 7, ana, 3), "");
  eq("R3) e NADA foi para a fila",               M.estado().fila.filter((f) => f.tipo === "salvar_dia").length, 0);
  eq("R4) a célula está marcada como não salva", M.entTemRascunho(2026, 7, ana, 3), "true");
  eq("R5) o painel sabe quantas faltam salvar",  M.entRasTotal(), 1);
  eq("R6) e em que dia",                         M.entRasResumo(2026, 7).dias.join(","), "3");

  M.entSet(2026, 7, ana, 3, 43);                       // corrigiu antes de salvar
  eq("R7) corrigir antes de salvar não vira duas coisas", M.entRasTotal(), 1);
  eq("R8) vale o último valor digitado",         M.entGetRaw(2026, 7, ana, 3), 43);

  M.entGravarCelula(2026, 7, ana, 3, 43);              // apertou Salvar
  M.entRasApaga(2026, 7, ana, 3);
  eq("R9) depois de salvar, está gravado",       M.entGravado(2026, 7, ana, 3), 43);
  eq("R10) e virou intenção pro servidor",       M.estado().fila.filter((f) => f.tipo === "salvar_dia").length, 1);
  eq("R11) não sobrou rascunho",                 M.entRasTotal(), 0);
  eq("R12) a célula não está mais marcada",      M.entTemRascunho(2026, 7, ana, 3), "false");

  // digitar de volta o valor que já estava gravado não é alteração nenhuma
  M.entSet(2026, 7, ana, 3, 99);
  eq("R13) mudou: virou rascunho de novo",       M.entRasTotal(), 1);
  M.entSet(2026, 7, ana, 3, 43);
  eq("R14) voltou ao valor gravado: rascunho some", M.entRasTotal(), 0);

  // apagar a célula também é rascunho
  M.entSet(2026, 7, ana, 3, "");
  eq("R15) apagar também fica em rascunho",      M.entRasTotal(), 1);
  eq("R16) na tela some",                        M.entGetRaw(2026, 7, ana, 3) === "" ? "vazio" : "tem valor", "vazio");
  eq("R17) mas no servidor continua lá",         M.entGravado(2026, 7, ana, 3), 43);
}

console.log("\n=== A fila de gravação ===\n");
{
  const M = carregar();
  M.entAddEntregador("Ana");
  const ana = M.estado().equipe[0].id;
  eq("43) cadastrar virou intenção", M.estado().fila.filter((f) => f.tipo === "criar_pessoa").length, 1);
  lancar(M, 2026, 7, ana, 3, 10);
  eq("44) lançar virou intenção",    M.estado().fila.filter((f) => f.tipo === "salvar_dia").length, 1);
  // salvar 4, 40, 400 na MESMA célula não pode virar 3 gravações
  lancar(M, 2026, 7, ana, 3, 40);
  lancar(M, 2026, 7, ana, 3, 400);
  eq("45) a mesma célula guarda só a ÚLTIMA intenção",
     M.estado().fila.filter((f) => f.tipo === "salvar_dia").length, 1);
  eq("46) e com o valor final", M.estado().fila.filter((f) => f.tipo === "salvar_dia")[0].quantidade, 400);
  lancar(M, 2026, 7, ana, 4, 7);
  eq("47) célula diferente é outra intenção",
     M.estado().fila.filter((f) => f.tipo === "salvar_dia").length, 2);
  const f = M.estado().fila[0];
  eq("48) toda intenção nasce pendente", f.status, "pendente");
  eq("49) com identificador próprio",    /^[0-9a-f-]{36}$/i.test(f.request_id), "true");
  eq("50) sem tentativa ainda",          f.tentativas, 0);
  eq("51) com hora de criação",          /^\d{4}-/.test(f.criado_em), "true");
  const ids = M.estado().fila.map((x) => x.request_id);
  eq("52) identificadores nunca se repetem", new Set(ids).size, ids.length);
  eq("53) todas contam como pendentes", M.entFilaPendentes().length, M.estado().fila.length);
}

console.log("\n=== O que fica guardado no navegador ===\n");
{
  const M = carregar();
  M.entAddEntregador("Ana");
  const ana = M.estado().equipe[0].id;
  lancar(M, 2026, 7, ana, 3, 10);
  eq("54) a fila é gravada", M.ls.getItem("entregas_v2_fila") !== null, "true");
  eq("55) o cache é gravado", M.ls.getItem("entregas_v2_cache") !== null, "true");
  const cache = JSON.parse(M.ls.getItem("entregas_v2_cache"));
  eq("56) o cache guarda a equipe", cache.equipe.length, 1);
  eq("57) o cache é indexado pelo CÓDIGO", Object.keys(cache.dados["2026-7"])[0], ana);
  eq("58) o cache guarda o nome da época", cache.nomes["2026-7"][ana], "Ana");
  eq("59) NÃO mexe na chave antiga entregas_dados", M.ls.getItem("entregas_dados"), null);
  eq("60) NÃO mexe na chave antiga entregas_entregadores", M.ls.getItem("entregas_entregadores"), null);
}

console.log("\n=== Excluir só quem NÃO tem lançamento ===\n");
{
  const M = carregar();
  M.entAddEntregador("Teste");           // cadastro de engano, sem nenhuma entrega
  M.entAddEntregador("Ana");
  const [teste, ana] = M.estado().equipe;
  lancar(M, 2026, 7, ana.id, 3, 10);
  eq("61) quem não lançou nada não tem histórico", M.entTemHistorico(teste.id), "false");
  eq("62) quem lançou tem",                        M.entTemHistorico(ana.id), "true");
  eq("63) excluir o de teste funciona",            M.entExcluirPessoa(teste.id), "true");
  eq("64) e ele sai da equipe",                    M.entPessoa(teste.id), null);
  eq("65) excluir quem TEM histórico é recusado",  M.entExcluirPessoa(ana.id), "false");
  eq("66) e ela continua na equipe",               M.entPessoa(ana.id).nome, "Ana");
  eq("67) o histórico dela fica intacto",          M.entGet(2026, 7, ana.id, 3), 10);
}
{
  // cadastro criado e apagado antes de subir: não adianta criar no servidor pra apagar
  const M = carregar();
  M.entAddEntregador("Engano");
  const id = M.estado().equipe[0].id;
  eq("68) a criação estava na fila", M.estado().fila.filter((f) => f.tipo === "criar_pessoa").length, 1);
  M.entExcluirPessoa(id);
  eq("69) excluir antes de subir CANCELA a criação",
     M.estado().fila.filter((f) => f.tipo === "criar_pessoa").length, 0);
  eq("70) e não manda exclusão pro servidor",
     M.estado().fila.filter((f) => f.tipo === "excluir_pessoa").length, 0);
  eq("71) a fila ficou vazia", M.estado().fila.length, 0);
}
{
  // agora com o cadastro já sincronizado (fila limpa na mão): manda a exclusão
  const M = carregar();
  M.entAddEntregador("Ex");
  const id = M.estado().equipe[0].id;
  M.estado().fila.length = 0;            // finge que já subiu
  M.entExcluirPessoa(id);
  eq("72) cadastro já sincronizado vira intenção de excluir",
     M.estado().fila.filter((f) => f.tipo === "excluir_pessoa").length, 1);
}

console.log("\n" + (falhou ? "FALHOU: " + falhou + " de " + (ok + falhou) : "TUDO OK: " + ok + " testes") + "\n");
process.exit(falhou ? 1 : 0);
