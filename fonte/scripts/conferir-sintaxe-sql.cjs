// Confere a sintaxe SQL de um arquivo, sem precisar de banco nenhum.
//
// Usa o mesmo analisador do PostgreSQL (libpg_query). Ele valida o SQL de FORA:
// se as instruções fecham, se o $$ ... $$ está casado, se a consulta final é válida.
// NÃO valida o miolo em plpgsql (o corpo entre $$ ... $$) — para isso é preciso um
// Postgres de verdade, com check_function_bodies ligado.
//
//   node scripts/conferir-sintaxe-sql.cjs sql/receb_c31_embalagem.sql
const fs = require("fs");
(async () => {
  const arq = process.argv[2];
  if (!arq) { console.log("uso: node scripts/conferir-sintaxe-sql.cjs <arquivo.sql>"); process.exit(1); }
  const sql = fs.readFileSync(arq, "utf8");
  let pg; try { pg = require("libpg-query"); }
  catch (e) { console.log("falta o analisador: npm install --no-save libpg-query"); process.exit(1); }
  try {
    const r = await pg.parse(sql);
    const n = (r && r.stmts ? r.stmts.length : 0);
    console.log("SINTAXE SQL OK — " + n + " instrução(ões) reconhecida(s).");
    const tipos = {};
    (r.stmts || []).forEach(s => { const k = Object.keys(s.stmt || {})[0] || "?"; tipos[k] = (tipos[k] || 0) + 1; });
    Object.entries(tipos).forEach(([k, v]) => console.log("   " + k + ": " + v));
    console.log("\n(o miolo em plpgsql, entre $$ ... $$, só um Postgres de verdade compila)");
  } catch (e) {
    console.log("ERRO DE SINTAXE:");
    console.log("  " + e.message);
    if (e.cursorPosition) {
      const p = e.cursorPosition, ini = Math.max(0, p - 120);
      console.log("  perto de: ..." + sql.slice(ini, p + 60).replace(/\n/g, " ") + "...");
    }
    process.exit(1);
  }
})();
