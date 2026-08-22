// PESCADOR DE DADOS: baixa o index.html PUBLICADO (que o robô gerou com dados frescos
// da loja) e extrai os dados de vendas embutidos, reconstruindo output/vr-data.json.
// Pra que serve: publicar mudanças de CÓDIGO do Mac na hora (FORCAR=1 publicar.cjs)
// SEM mandar dados velhos junto — os dados ficam iguais aos da última publicação do robô.
// Uso: node scripts/puxar-dados.cjs  (depois: npx tsx scripts/demoDashboard.ts && FORCAR=1 node scripts/publicar.cjs)
const fs = require("fs");
const path = require("path");

const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim() : ""; };
const TOKEN = get("GITHUB_TOKEN");

// extrai um array JSON a partir de "const NOME = [" respeitando strings/aspas
function extrairArray(html, nome) {
  const marca = "const " + nome + " = ";
  const i = html.indexOf(marca);
  if (i < 0) throw new Error("nao achei 'const " + nome + "' no HTML publicado");
  let p = i + marca.length;
  if (html[p] !== "[") throw new Error(nome + " nao comeca com [");
  let depth = 0, emStr = false, esc = false;
  for (let j = p; j < html.length; j++) {
    const c = html[j];
    if (esc) { esc = false; continue; }
    if (emStr) { if (c === "\\") esc = true; else if (c === '"') emStr = false; continue; }
    if (c === '"') { emStr = true; continue; }
    if (c === "[") depth++;
    else if (c === "]") { depth--; if (depth === 0) return JSON.parse(html.slice(p, j + 1)); }
  }
  throw new Error(nome + ": array nao fechou");
}

(async () => {
  if (!TOKEN) { console.log("ERRO: GITHUB_TOKEN nao encontrado no .env"); process.exit(1); }
  console.log("Baixando o painel publicado (6+ MB)...");
  const r = await fetch("https://api.github.com/repos/vitakero/painel-de-gestao-santa-rita/contents/index.html", {
    headers: { Authorization: "Bearer " + TOKEN, Accept: "application/vnd.github.raw", "User-Agent": "puxar-dados", "X-GitHub-Api-Version": "2022-11-28" },
  });
  if (!r.ok) { console.log("ERRO ao baixar: HTTP " + r.status); process.exit(1); }
  const html = await r.text();

  // data/hora de geração (formato "gerado em 09/07/2026, 00:17:05", fuso da loja = -03:00)
  let gerado = new Date().toISOString();
  const g = html.match(/gerados? em (\d{2})\/(\d{2})\/(\d{4}),?\s*(\d{2}:\d{2}:\d{2})/);
  if (g) gerado = g[3] + "-" + g[2] + "-" + g[1] + "T" + g[4] + "-03:00";

  const DIA = extrairArray(html, "DIA");
  const HORA = extrairArray(html, "HORA");
  const OP = extrairArray(html, "OPER");
  const PAG = extrairArray(html, "PAGS");
  const SETOR = extrairArray(html, "SETORES");
  const MESPROD = extrairArray(html, "MESPROD");

  const data = { gerado, DIA, HORA, OP, PAG, SETOR, MESPROD };
  const outDir = path.join(__dirname, "..", "output");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
  fs.writeFileSync(path.join(outDir, "vr-data.json"), JSON.stringify(data));
  console.log("OK -> output/vr-data.json reconstruido com os dados FRESCOS do painel publicado.");
  console.log("Linhas: DIA=" + DIA.length + " HORA=" + HORA.length + " OP=" + OP.length + " PAG=" + PAG.length + " SETOR=" + SETOR.length + " MESPROD=" + MESPROD.length);
  console.log("Dados de: " + gerado);
})().catch((e) => { console.log("ERRO:", e.message); process.exit(1); });
