// VOLTA a tabela vendasetor_mes para a base CONFERIDA (a dos PDFs do relatório do VR).
//
// PRA QUE SERVE
//   Quando o robô assume, ele grava por cima com origem='robo'. Se os números dele não
//   baterem com o relatório, isto desfaz: recoloca as 416 linhas conferidas, com
//   origem='pdf'. Leva segundos e não precisa do editor SQL.
//
//   node scripts/restaurar-vendasetor.cjs          (mostra o que faria, NÃO grava)
//   node scripts/restaurar-vendasetor.cjs --gravar (grava de verdade)
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..");
const env = fs.readFileSync(path.join(RAIZ, ".env"), "utf8");
const g = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim().replace(/[^\x21-\x7e]/g, "") : ""; };
const BASE = g("SUPABASE_URL").replace(/\/+$/, ""), KEY = g("SUPABASE_SERVICE_KEY");
const GRAVAR = process.argv.includes("--gravar");

const sql = fs.readFileSync(path.join(RAIZ, "sql", "vendasetor_carga.sql"), "utf8");
const linhas = [];
for (const m of sql.matchAll(/\((\d+),(\d+),'((?:[^']|'')*)',([\d.]+),(true|false),'(\w+)'\)/g)) {
  linhas.push({ ano: +m[1], mes: +m[2], setor: m[3].replace(/''/g, "'"),
                quantidade: Number(m[4]), completo: m[5] === "true", origem: m[6],
                atualizado_em: new Date().toISOString() });
}
if (linhas.length !== 416) { console.log("ERRO: esperava 416 linhas na carga, li " + linhas.length + ". Não vou gravar."); process.exit(1); }

(async () => {
  console.log("Base conferida: " + linhas.length + " linhas (13 setores, 2024/2025/2026).");
  if (!GRAVAR) {
    console.log("\nModo de conferência — NADA foi gravado.");
    console.log("Para restaurar de verdade:  node scripts/restaurar-vendasetor.cjs --gravar");
    return;
  }
  let ok = 0;
  for (let i = 0; i < linhas.length; i += 200) {
    const lote = linhas.slice(i, i + 200);
    const r = await fetch(BASE + "/rest/v1/vendasetor_mes?on_conflict=ano,mes,setor", {
      method: "POST",
      headers: { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json",
                 Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(lote) });
    if (!r.ok) { console.log("FALHOU no lote " + i + ": HTTP " + r.status + " " + (await r.text()).slice(0, 200)); process.exit(1); }
    ok += lote.length;
  }
  console.log("RESTAURADO: " + ok + " linhas voltaram para a base conferida (origem='pdf').");
})().catch((e) => { console.log("ERRO: " + e.message); process.exit(1); });
