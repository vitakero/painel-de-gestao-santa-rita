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
  // 2) mudou? publica ja (ciclo de 5 min normal). So comeca a ESPACAR se o dia
  //    estiver chegando perto do limite: 60+ publicacoes -> minimo 15 min;
  //    80+ -> minimo 30 min. (FORCAR=1 ignora tudo isso.)
  const statePath = path.join(__dirname, "..", "output", ".pub-state.json");
  // NORMALIZAR O RELOGIO ANTES DE COMPARAR.
  //   O painel carimba "Atualizado 10/08 as 20:03". Esse texto muda em TODA construcao, entao
  //   sem apagar ele daqui o arquivo parece sempre diferente e a economia de deploy nunca vale.
  //   Foi o que aconteceu: 59 publicacoes numa noite de loja fechada, sem nada ter mudado.
  //   Conferido comparando duas construcoes seguidas: o relogio era a UNICA diferenca.
  //   O "gerado em" e de uma versao antiga do carimbo; fica pra nao quebrar arquivo velho.
  const normalizado = buf.toString("utf8")
    .replace(/ger[ao]d[ao]s? em [0-9\/:,\s]+/g, "gerado em X")
    .replace(/Atualizado \d{2}\/\d{2}[^<"]{0,10}\d{2}:\d{2}/g, "Atualizado X");
  const hash = require("crypto").createHash("sha256").update(normalizado).digest("hex");
  const hoje = new Date().toISOString().slice(0, 10);
  let st = null;
  try { st = JSON.parse(fs.readFileSync(statePath, "utf8")); } catch (e) {}
  const pubsHoje = (st && st.dia === hoje) ? (st.pubs || 0) : 0;
  if (process.env.FORCAR !== "1") {
    if (st && st.hash === hash) { console.log(">>> Nada mudou desde a ultima publicacao. Nao vou publicar (economia de deploys)."); process.exit(0); }
    const minEspera = (pubsHoje >= 80) ? 30 : (pubsHoje >= 60) ? 15 : 0;
    if (minEspera && st && st.ts && (Date.now() - st.ts) < minEspera * 60 * 1000) {
      const falta = Math.ceil((minEspera * 60 * 1000 - (Date.now() - st.ts)) / 60000);
      console.log(">>> Dia com muitas publicacoes (" + pubsHoje + "). Espacando: proxima em ~" + falta + " min.");
      process.exit(0);
    }
  }

  // pega o SHA atual do arquivo (necessario para atualizar)
  let sha;
  const r1 = await fetch(api, { headers });
  if (r1.status === 200) { sha = (await r1.json()).sha; }
  else if (r1.status !== 404) { console.log("Erro ao ler arquivo atual:", r1.status, await r1.text()); process.exit(1); }

  // MARCA [publicar] -> o Vercel publica (regra em vercel.json, na raiz do repo).
  // Sem a marca, o commit vai pro GitHub do mesmo jeito (e o endereco de teste do
  // github.io atualiza), mas o dominio de producao fica na versao anterior.
  //   robo da loja (sem FORCAR) -> SEMPRE marca: producao precisa do dado fresco
  //   Mac (FORCAR=1)            -> so marca com SUBIR=1
  const vaiPraProducao = (process.env.FORCAR !== "1") || (process.env.SUBIR === "1");
  const msg = "Atualizacao automatica do painel" + (vaiPraProducao ? " [publicar]" : "");
  const body = { message: msg, content: b64 };
  if (sha) body.sha = sha;

  const r2 = await fetch(api, { method: "PUT", headers, body: JSON.stringify(body) });
  if (r2.status === 200 || r2.status === 201) {
    try { fs.writeFileSync(statePath, JSON.stringify({ hash: hash, ts: Date.now(), dia: hoje, pubs: pubsHoje + 1 })); } catch (e) {}
    console.log(vaiPraProducao
    ? ">>> PUBLICADO. Vai para o dominio de producao em ~1 min."
    : ">>> Publicado so para TESTE (github.io). O dominio de producao NAO mudou.\n    Para subir para producao: SUBIR=1 FORCAR=1 node scripts/publicar.cjs");
    console.log("    https://vitakero.github.io/painel-de-gestao-santa-rita/");
  } else {
    console.log("FALHOU ao publicar:", r2.status);
    console.log(await r2.text());
    process.exit(1);
  }
})().catch((e) => { console.log("ERRO:", e.message); process.exit(1); });
