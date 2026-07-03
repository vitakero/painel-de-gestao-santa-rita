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
  // BOTAO DE PAUSA REMOTO: se existir o arquivo robo/PAUSADO no repo, o robo NAO publica.
  // (Publicacao manual do Mac ignora a pausa usando: FORCAR=1 node scripts/publicar.cjs)
  if (process.env.FORCAR !== "1") {
    const rp = await fetch("https://api.github.com/repos/" + OWNER + "/" + REPO + "/contents/robo/PAUSADO", { headers });
    if (rp.status === 200) { console.log(">>> Robo PAUSADO (existe robo/PAUSADO no repo). Nao vou publicar. Para reativar, apague esse arquivo."); process.exit(0); }
  }

  const buf = fs.readFileSync(path.join(__dirname, "..", "output", "index.html"));
  const b64 = buf.toString("base64");

  // ECONOMIA DE PUBLICACOES (limite do Vercel: ~100 deploys/dia):
  // 1) se o conteudo nao mudou (ignorando o carimbo "gerado em HH:MM"), nao publica;
  // 2) o robo espera no minimo 15 min entre publicacoes (FORCAR=1 ignora tudo isso).
  const statePath = path.join(__dirname, "..", "output", ".pub-state.json");
  const normalizado = buf.toString("utf8").replace(/gerados? em [0-9\/:,\s]+/g, "gerado em X");
  const hash = require("crypto").createHash("sha256").update(normalizado).digest("hex");
  if (process.env.FORCAR !== "1") {
    let st = null;
    try { st = JSON.parse(fs.readFileSync(statePath, "utf8")); } catch (e) {}
    if (st && st.hash === hash) { console.log(">>> Nada mudou desde a ultima publicacao. Nao vou publicar (economia de deploys)."); process.exit(0); }
    if (st && st.ts && (Date.now() - st.ts) < 15 * 60 * 1000) {
      const falta = Math.ceil((15 * 60 * 1000 - (Date.now() - st.ts)) / 60000);
      console.log(">>> Publicei ha menos de 15 min (faltam ~" + falta + " min). Nao vou publicar agora (economia de deploys).");
      process.exit(0);
    }
  }

  // pega o SHA atual do arquivo (necessario para atualizar)
  let sha;
  const r1 = await fetch(api, { headers });
  if (r1.status === 200) { sha = (await r1.json()).sha; }
  else if (r1.status !== 404) { console.log("Erro ao ler arquivo atual:", r1.status, await r1.text()); process.exit(1); }

  const body = { message: "Atualizacao automatica do painel", content: b64 };
  if (sha) body.sha = sha;

  const r2 = await fetch(api, { method: "PUT", headers, body: JSON.stringify(body) });
  if (r2.status === 200 || r2.status === 201) {
    try { fs.writeFileSync(statePath, JSON.stringify({ hash: hash, ts: Date.now() })); } catch (e) {}
    console.log(">>> PUBLICADO no GitHub! O painel online atualiza em ~1 min.");
    console.log("    https://vitakero.github.io/painel-de-gestao-santa-rita/");
  } else {
    console.log("FALHOU ao publicar:", r2.status);
    console.log(await r2.text());
    process.exit(1);
  }
})().catch((e) => { console.log("ERRO:", e.message); process.exit(1); });
