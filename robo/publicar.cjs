// Publica o painel (output/index.html) no GitHub usando a chave (token).
// Funciona no Windows e no Mac. Uso: node scripts/publicar.cjs
const fs = require("fs");
const path = require("path");

const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim() : ""; };

const TOKEN = get("GITHUB_TOKEN");
const OWNER = "vitakero";
const REPO = "painel-de-gestao-santa-rita";
const FILE = "index.html";

if (!TOKEN) { console.log("ERRO: GITHUB_TOKEN nao encontrado no .env"); process.exit(1); }

const api = "https://api.github.com/repos/" + OWNER + "/" + REPO + "/contents/" + FILE;
const headers = {
  Authorization: "Bearer " + TOKEN,
  Accept: "application/vnd.github+json",
  "User-Agent": "robo-painel",
  "X-GitHub-Api-Version": "2022-11-28",
};

(async () => {
  const buf = fs.readFileSync(path.join(__dirname, "..", "output", "index.html"));
  const b64 = buf.toString("base64");

  // pega o SHA atual do arquivo (necessario para atualizar)
  let sha;
  const r1 = await fetch(api, { headers });
  if (r1.status === 200) { sha = (await r1.json()).sha; }
  else if (r1.status !== 404) { console.log("Erro ao ler arquivo atual:", r1.status, await r1.text()); process.exit(1); }

  const body = { message: "Atualizacao automatica do painel", content: b64 };
  if (sha) body.sha = sha;

  const r2 = await fetch(api, { method: "PUT", headers, body: JSON.stringify(body) });
  if (r2.status === 200 || r2.status === 201) {
    console.log(">>> PUBLICADO no GitHub! O painel online atualiza em ~1 min.");
    console.log("    https://vitakero.github.io/painel-de-gestao-santa-rita/");
  } else {
    console.log("FALHOU ao publicar:", r2.status);
    console.log(await r2.text());
    process.exit(1);
  }
})().catch((e) => { console.log("ERRO:", e.message); process.exit(1); });
