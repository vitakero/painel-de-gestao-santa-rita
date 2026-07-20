// DETETIVE do VR — descobre a tabela do "Consulta de Agendamento Recebimento" (menu Logística).
// Roda DENTRO da rede da loja (onde o robo roda): node scripts/vr-descobrir-agendamento.cjs
// So LE o banco, nao muda nada. Copie tudo que aparecer e mande de volta.
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

function readEnv() {
  for (const p of [path.join(__dirname, "..", ".env"), path.join(__dirname, ".env"), ".env", "../.env"]) {
    try { return fs.readFileSync(p, "utf8"); } catch (e) {}
  }
  return "";
}
const env = readEnv();
const g = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim() : ""; };

(async () => {
  if (!g("PG_HOST")) { console.log("Nao achei o .env com os dados do banco. Rode este script na pasta do robo."); return; }
  const c = new Client({ host: g("PG_HOST"), port: +g("PG_PORT"), database: g("PG_DATABASE"), user: g("PG_USER"), password: g("PG_PASSWORD"), connectionTimeoutMillis: 20000 });
  await c.connect();
  console.log("Conectado no VR. Investigando agendamento de recebimento...\n");

  // 1) Tabelas com nome parecido com agendamento/recebimento (a tela chama "Consulta de Agendamento Recebimento")
  console.log("========== TABELAS QUE PARECEM SER DE AGENDAMENTO/RECEBIMENTO ==========");
  const tabs = (await c.query(
    `select table_schema, table_name from information_schema.tables
     where table_name ilike '%agend%' or table_name ilike '%recebimento%' or table_name ilike '%receb%'
     order by 1,2`
  )).rows;
  if (!tabs.length) console.log("  (nenhuma encontrada com esses nomes)");
  tabs.forEach(r => console.log("  - " + r.table_schema + "." + r.table_name));

  // 2) Para cada uma, lista as colunas (pra achar a que tem fornecedor/horario/status)
  for (const t of tabs) {
    console.log("\n---------- COLUNAS DE " + t.table_schema + "." + t.table_name + " ----------");
    try {
      const cols = (await c.query(
        `select column_name, data_type from information_schema.columns
         where table_schema=$1 and table_name=$2 order by ordinal_position`,
        [t.table_schema, t.table_name]
      )).rows;
      cols.forEach(r => console.log("  - " + r.column_name + "  (" + r.data_type + ")"));
    } catch (e) { console.log("  (erro ao ler colunas: " + e.message + ")"); }
  }

  // 3) Amostra de dados da(s) tabela(s) mais provável(is), com o filtro que a tela usa: 25/07/2026, LOJA 01
  for (const t of tabs) {
    console.log("\n---------- AMOSTRA (5 linhas) DE " + t.table_schema + "." + t.table_name + " ----------");
    try {
      const amostra = (await c.query(`select * from ${t.table_schema}.${t.table_name} limit 5`)).rows;
      console.log(JSON.stringify(amostra, null, 1));
    } catch (e) { console.log("  (erro ao ler amostra: " + e.message + ")"); }
  }

  // 4) Tabelas de fornecedor e loja (pra cruzar codigo -> nome, como aparece na tela: 000027 = STER BOM IND. E COM. LTDA)
  console.log("\n========== TABELAS DE FORNECEDOR/LOJA (para conferência) ==========");
  const tabs2 = (await c.query(
    `select table_schema, table_name from information_schema.tables
     where table_name ilike '%fornecedor%' or table_name ilike '%loja%'
     order by 1,2`
  )).rows;
  tabs2.forEach(r => console.log("  - " + r.table_schema + "." + r.table_name));

  await c.end();
  console.log("\n>>> PRONTO! Copie TUDO acima (da tela inteira, sem cortar) e mande de volta pro Claude.");
})().catch(e => console.error("ERRO:", e.message));
