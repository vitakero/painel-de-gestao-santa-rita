// DETETIVE do VR — RODADA 2. Já achamos a tabela certa (public.agendamentorecebimento).
// Agora só falta saber onde ficam o NOME do fornecedor e o NOME da loja, pra
// trocar os códigos (27, 1...) pelos nomes (STER BOM IND. E COM. LTDA, LOJA 01...).
// Roda DENTRO da rede da loja: node scripts/vr-descobrir-agendamento2.cjs
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
  console.log("Conectado no VR. Investigando fornecedor/loja...\n");

  for (const t of ["fornecedor", "loja"]) {
    console.log("========== COLUNAS DE public." + t + " ==========");
    try {
      const cols = (await c.query(
        `select column_name, data_type from information_schema.columns
         where table_schema='public' and table_name=$1 order by ordinal_position`, [t]
      )).rows;
      cols.forEach(r => console.log("  - " + r.column_name + "  (" + r.data_type + ")"));
    } catch (e) { console.log("  (erro: " + e.message + ")"); }

    console.log("\n---------- 3 LINHAS DE public." + t + " (pra achar o nome/código) ----------");
    try {
      const amostra = (await c.query(`select * from public.${t} limit 3`)).rows;
      console.log(JSON.stringify(amostra, null, 1));
    } catch (e) { console.log("  (erro: " + e.message + ")"); }
    console.log("");
  }

  // Confere o fornecedor exato que o Victor agendou (id 27), pra bater com "STER BOM IND. E COM. LTDA"
  console.log("========== FORNECEDOR id=27 (o que o Victor agendou na tela) ==========");
  try {
    const f = (await c.query("select * from public.fornecedor where id=27")).rows;
    console.log(JSON.stringify(f, null, 1));
  } catch (e) { console.log("  (erro: " + e.message + ")"); }

  // Mais linhas de agendamentorecebimento, pra ver se tem algum agendamento CANCELADO/CONCLUIDO
  // (a tabela não tinha coluna de status — quero confirmar se o "status" é sempre fixo ou se
  // vem de outro lugar quando o agendamento é cancelado/atendido)
  console.log("\n========== TODAS AS LINHAS DE public.agendamentorecebimento (confirmar se tem status) ==========");
  try {
    const ag = (await c.query("select * from public.agendamentorecebimento order by id desc limit 20")).rows;
    console.log(JSON.stringify(ag, null, 1));
  } catch (e) { console.log("  (erro: " + e.message + ")"); }

  await c.end();
  console.log("\n>>> PRONTO! Copie TUDO acima e mande de volta pro Claude.");
})().catch(e => console.error("ERRO:", e.message));
