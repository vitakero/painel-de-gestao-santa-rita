// Publica um arquivo qualquer na RAIZ do repositório (imagens de email, páginas soltas...).
//
//   node scripts/publicar-arquivo.cjs assets/logo-email.png logo-email.png
//   SUBIR=1 node scripts/publicar-arquivo.cjs assets/logo-email.png logo-email.png
//
// Sem SUBIR=1 o commit não leva a marca [publicar] e o Vercel ignora — o arquivo fica só no
// GitHub Pages (teste). Existe porque publicar.cjs só sabe mandar o index.html, e imagem de
// email precisa de um endereço público fixo: cliente de email bloqueia imagem embutida.
const fs = require("fs");
const path = require("path");

const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim() : ""; };

const TOKEN = get("GITHUB_TOKEN");
const OWNER = "vitakero";
const REPO  = "painel-de-gestao-santa-rita";

const origem = process.argv[2];
const destino = process.argv[3] || (origem && path.basename(origem));
if (!TOKEN) { console.log("ERRO: GITHUB_TOKEN nao encontrado no .env"); process.exit(1); }
if (!origem || !destino) { console.log("uso: node scripts/publicar-arquivo.cjs <local> <destino-no-repo>"); process.exit(1); }

const LOCAL = path.isAbsolute(origem) ? origem : path.join(__dirname, "..", origem);
if (!fs.existsSync(LOCAL)) { console.log("ERRO: nao achei " + LOCAL); process.exit(1); }

(async () => {
  const conteudo = fs.readFileSync(LOCAL);
  const api = "https://api.github.com/repos/" + OWNER + "/" + REPO + "/contents/" + destino;
  const headers = { Authorization: "token " + TOKEN, "User-Agent": "santa-rita",
                    Accept: "application/vnd.github+json" };

  const atual = await fetch(api, { headers });
  let sha;
  if (atual.status === 200) {
    const j = await atual.json();
    sha = j.sha;
    if (Buffer.from(j.content.replace(/\n/g, ""), "base64").equals(conteudo)) {
      console.log(">>> " + destino + " ja esta igual no GitHub. Nada a fazer.");
      return;
    }
  } else if (atual.status !== 404) {
    console.log("ERRO ao ler: " + atual.status + " " + (await atual.text()).slice(0, 200));
    process.exit(1);
  }

  const producao = process.env.SUBIR === "1";
  const body = { message: "Publica " + destino + (producao ? " [publicar]" : ""),
                 content: conteudo.toString("base64") };
  if (sha) body.sha = sha;

  const r = await fetch(api, { method: "PUT", headers, body: JSON.stringify(body) });
  if (!r.ok) { console.log("ERRO ao publicar: " + r.status + " " + (await r.text()).slice(0, 300)); process.exit(1); }

  console.log(">>> publicado: " + destino);
  console.log("    teste:  https://vitakero.github.io/" + REPO + "/" + destino);
  if (producao) console.log("    oficial: https://painel.supermercadosantarita.com.br/" + destino);
})().catch((e) => { console.log("ERRO: " + e.message); process.exit(1); });
