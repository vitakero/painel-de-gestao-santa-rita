// DETETIVE do VR — descobre a coluna do codigo de barras e onde fica o estoque.
// Roda DENTRO da rede da loja (onde o robo roda): node scripts/vr-descobrir.cjs
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
  console.log("Conectado no VR. Investigando...\n");

  console.log("========== COLUNAS DA TABELA public.produto ==========");
  const cols = (await c.query(
    "select column_name, data_type from information_schema.columns where table_schema='public' and table_name='produto' order by ordinal_position"
  )).rows;
  cols.forEach(r => console.log("  - " + r.column_name + "  (" + r.data_type + ")"));

  console.log("\n========== 2 PRODUTOS DE EXEMPLO (todas as colunas) ==========");
  const amostra = (await c.query("select * from public.produto limit 2")).rows;
  console.log(JSON.stringify(amostra, null, 1));

  console.log("\n========== TABELAS QUE PARECEM SER DE ESTOQUE/SALDO ==========");
  const tabs = (await c.query(
    "select table_schema, table_name from information_schema.tables where table_name ilike '%estoque%' or table_name ilike '%saldo%' or table_name ilike '%deposito%' order by 1,2"
  )).rows;
  if (!tabs.length) console.log("  (nenhuma encontrada com esses nomes)");
  tabs.forEach(r => console.log("  - " + r.table_schema + "." + r.table_name));

  await c.end();
  console.log("\n>>> PRONTO! Copie TUDO acima e mande de volta pro Claude.");
})().catch(e => console.error("ERRO:", e.message));
