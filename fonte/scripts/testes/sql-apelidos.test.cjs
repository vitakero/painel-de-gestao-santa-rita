// APELIDO DE TABELA QUE NÃO EXISTE — o defeito que chegou em produção em 31/08/2026.
//
// A Agenda foi ao ar e o dono levou "Não deu pra carregar a agenda agora." na cara.
// Dentro da função agenda_mes estava escrito:
//
//     e.para_id in (select a.id from alvos)          <-- cadê o apelido "a"?
//
// O Postgres só reclama disso na HORA DE RODAR ("missing FROM-clause entry for
// table a"), não na hora de criar a função: o corpo em plpgsql é planejado
// preguiçosamente, na primeira execução de cada trecho. Como eu tinha conferido a
// função com a chave de serviço — e nela o auth.uid() é nulo, então a função saía
// na primeira linha — aquele trecho NUNCA rodou até o dono clicar.
//
// Este teste lê o SQL e cobra o básico: todo "apelido." usado tem que ter sido
// declarado em algum FROM/JOIN/WITH do mesmo corpo.
//
//   node scripts/testes/sql-apelidos.test.cjs
const fs = require("fs");
const path = require("path");
const RAIZ = path.join(__dirname, "..", "..");

// Arquivos vigiados. Legado não entra de uma vez: entra quando alguém mexer nele.
const VIGIADOS = ["sql/agenda_convites.sql", "sql/agenda_conserto_mes.sql", "sql/agenda.sql", "sql/agenda_recorrencia.sql"];

// prefixos que nunca são apelido de tabela
const LIVRES = new Set(["public","auth","extensions","pg_catalog","information_schema","storage","new","old","excluded","jsonb","json"]);

// Fora comentário E texto entre aspas simples: dentro de uma string, "receb.espelho"
// ou "app.abrindo" não são apelido de tabela — são só letras.
function semComentario(t){
  return t.replace(/--[^\n]*/g, " ").replace(/'(?:[^']|'')*'/g, "''");
}

function apelidosDeclarados(corpo){
  const nomes = new Set();
  // listas do WITH:  with X as (   ,  , Y as (
  for (const m of corpo.matchAll(/\b(?:with|,)\s+([a-z_][\w$]*)\s+as\s*\(/gi)) nomes.add(m[1].toLowerCase());
  // FROM / JOIN / UPDATE / INTO  ->  tabela [as] apelido
  const RE = /\b(?:from|join|update|into)\s+((?:[a-z_][\w$]*\.)?[a-z_][\w$]*)\s*(?:(?:\bas\b\s+)?([a-z_][\w$]*))?/gi;
  const PALAVRAS = new Set(["as","on","where","select","set","values","group","order","having","limit","offset","union",
                            "left","right","inner","outer","full","cross","join","and","or","using","returning","for",
                            "with","when","then","else","end","loop","if","not","exists","into","from","distinct","only"]);
  for (const m of corpo.matchAll(RE)){
    const rel = m[1].toLowerCase(), ape = (m[2]||"").toLowerCase();
    nomes.add(rel.split(".").pop());               // sem apelido, o próprio nome serve de prefixo
    if (ape && !PALAVRAS.has(ape)) nomes.add(ape);
  }
  // "from (select ...) b" — o apelido vem DEPOIS do parêntese que fecha
  for (const m of corpo.matchAll(/\)\s*(?:\bas\b\s+)?([a-z_][\w$]*)/gi)) nomes.add(m[1].toLowerCase());
  // "for x in select ..." — o x é uma linha inteira, e x.coluna é legítimo
  for (const m of corpo.matchAll(/\bfor\s+([a-z_][\w$]*)\s+in\b/gi)) nomes.add(m[1].toLowerCase());
  // "... as x(dia, livres)" — apelido com as colunas listadas junto
  for (const m of corpo.matchAll(/\bas\s+([a-z_][\w$]*)\s*\(/gi)) nomes.add(m[1].toLowerCase());
  // "declare x record;" / "x cursor" — mesma ideia
  for (const m of corpo.matchAll(/\b([a-z_][\w$]*)\s+(?:record|cursor)\b/gi)) nomes.add(m[1].toLowerCase());
  return nomes;
}

function variaveis(cabeca){
  const nomes = new Set();
  for (const m of cabeca.matchAll(/\b([a-z_][\w$]*)\s+(?:uuid|text|date|time|boolean|integer|int|numeric|jsonb|json|timestamptz|record)\b/gi))
    nomes.add(m[1].toLowerCase());
  return nomes;
}

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado){
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + obtido + (bate ? "" : "   (esperado: " + esperado + ")"));
  bate ? ok++ : falhou++;
}

// Devolve a lista de prefixos órfãos de um arquivo SQL.
function orfaos(sql){
  const t = semComentario(sql);
  const achados = [];
  // cada corpo de função vive entre $$ ... $$
  const partes = t.split(/\$\$/);
  for (let i = 1; i < partes.length; i += 2){
    const corpo = partes[i];
    const cabeca = partes[i-1].slice(-600) + corpo.slice(0, corpo.indexOf("begin") + 1 || 400);
    const conhecidos = apelidosDeclarados(corpo);
    const vars = variaveis(cabeca);
    const nome = (partes[i-1].match(/function\s+(?:public\.)?([a-z_][\w$]*)/i) || [,"(anônima)"])[1];
    for (const m of corpo.matchAll(/\b([a-z_][\w$]*)\.[a-z_][\w$]*/gi)){
      const pref = m[1].toLowerCase();
      if (LIVRES.has(pref) || conhecidos.has(pref) || vars.has(pref)) continue;
      if (/^(v_|p_|tg_)/.test(pref)) continue;
      achados.push(nome + ": " + m[0]);
    }
  }
  return [...new Set(achados)];
}

console.log("\n=== Apelido de tabela usado sem existir ===\n");
for (const rel of VIGIADOS){
  const arq = path.join(RAIZ, rel);
  if (!fs.existsSync(arq)) { eq(rel + " existe", false, true); continue; }
  const maus = orfaos(fs.readFileSync(arq, "utf8"));
  eq(rel, maus.length ? maus.join("; ") : "nenhum", "nenhum");
}

// E o teste se testa: com o defeito de volta, ele TEM que reclamar.
{
  const original = fs.readFileSync(path.join(RAIZ, "sql/agenda_convites.sql"), "utf8");
  const estragado = original.replace(/from alvos a\)/g, "from alvos)");
  eq("o defeito de 31/08 volta a ser pego", orfaos(estragado).some(x => /agenda_mes: a\.id/.test(x)), true);
}

console.log("\n" + (falhou ? "FALHOU: " + falhou + " de " + (ok + falhou) : "TUDO OK: " + ok + " testes") + "\n");
process.exit(falhou ? 1 : 0);
