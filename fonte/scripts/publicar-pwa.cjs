// (2.5) Publica o Service Worker do PWA (scripts/central/sw.js) na RAIZ do repositório
// que o GitHub Pages/Vercel serve — ou seja, ao lado do index.html, para ficar acessível
// em .../sw.js na MESMA origem do painel (requisito do Service Worker).
//
// Roda só quando o sw.js muda (é raro). NÃO faz parte do ciclo do robô — o index.html
// continua sendo publicado pelo publicar.cjs; este só cuida do sw.js.
//
// Uso: node scripts/publicar-pwa.cjs
const fs = require("fs");
const path = require("path");

const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim() : ""; };
const TOKEN = get("GITHUB_TOKEN");
const OWNER = "vitakero";
const REPO = "painel-de-gestao-santa-rita";
const REPO_PATH = "sw.js";                    // raiz do repo (ao lado do index.html)
const LOCAL = path.join(__dirname, "central", "sw.js");

const headers = {
  Authorization: "Bearer " + TOKEN,
  Accept: "application/vnd.github+json",
  "User-Agent": "robo-painel",
  "X-GitHub-Api-Version": "2022-11-28",
};

(async () => {
  if (!TOKEN) { console.log("ERRO: GITHUB_TOKEN nao encontrado no .env"); process.exit(1); }
  const b64 = fs.readFileSync(LOCAL).toString("base64");
  const api = "https://api.github.com/repos/" + OWNER + "/" + REPO + "/contents/" + REPO_PATH;

  let sha, atual;
  const r1 = await fetch(api, { headers });
  if (r1.status === 200) { const j = await r1.json(); sha = j.sha; atual = j.content ? j.content.replace(/\n/g, "") : ""; }
  else if (r1.status !== 404) { console.log("Erro ao ler sw.js atual:", r1.status, await r1.text()); process.exit(1); }

  if (atual && atual === b64.replace(/\n/g, "")) { console.log(">>> sw.js ja esta atualizado no GitHub. Nada a fazer."); process.exit(0); }

  const body = { message: "deploy PWA: sw.js", content: b64 };
  if (sha) body.sha = sha;
  const r2 = await fetch(api, { method: "PUT", headers, body: JSON.stringify(body) });
  if (r2.status === 200 || r2.status === 201) {
    console.log(">>> sw.js PUBLICADO na raiz! Acessivel em .../sw.js na origem do painel.");
    console.log("    https://vitakero.github.io/painel-de-gestao-santa-rita/sw.js");
  } else {
    console.log("FALHOU ao publicar sw.js:", r2.status);
    console.log(await r2.text());
    process.exit(1);
  }
})().catch((e) => { console.log("ERRO:", e.message); process.exit(1); });
