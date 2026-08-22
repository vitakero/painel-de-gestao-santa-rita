// Publica uma pagina publica avulsa de output/ na RAIZ do repositorio
// (ao lado do index.html), para ficar acessivel em .../<arquivo> no mesmo dominio.
//
// Usado pelas paginas que NAO fazem parte do painel e nao exigem login:
//   conferir.html  -> conferencia publica da assinatura do contrato
//   agendar.html   -> agendamento de entrega pelo proprio fornecedor
//
// O publicar.cjs cuida so do index.html; este cuida das avulsas.
//
// Uso: node scripts/publicar-pagina.cjs conferir.html [outra.html ...]
const fs = require("fs");
const path = require("path");

const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim() : ""; };
const TOKEN = get("GITHUB_TOKEN");
const OWNER = "vitakero";
const REPO = "painel-de-gestao-santa-rita";

const headers = {
  Authorization: "Bearer " + TOKEN,
  Accept: "application/vnd.github+json",
  "User-Agent": "robo-painel",
  "X-GitHub-Api-Version": "2022-11-28",
};

(async () => {
  if (!TOKEN) { console.log("ERRO: GITHUB_TOKEN nao encontrado no .env"); process.exit(1); }

  const alvos = process.argv.slice(2);
  if (!alvos.length) { console.log("Uso: node scripts/publicar-pagina.cjs conferir.html [outra.html ...]"); process.exit(1); }

  for (const nome of alvos) {
    // so o nome do arquivo: nada de caminho, para nao publicar fora da raiz por engano
    const base = path.basename(nome);
    const local = path.join(__dirname, "..", "output", base);
    if (!fs.existsSync(local)) { console.log("PULEI: output/" + base + " nao existe"); continue; }

    const b64 = fs.readFileSync(local).toString("base64");
    const api = "https://api.github.com/repos/" + OWNER + "/" + REPO + "/contents/" + base;

    let sha;
    const r1 = await fetch(api, { headers });
    if (r1.status === 200) { sha = (await r1.json()).sha; }

    const r2 = await fetch(api, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "publica " + base + " (" + new Date().toISOString().slice(0, 16).replace("T", " ") + ")",
        content: b64,
        ...(sha ? { sha } : {}),
      }),
    });

    if (r2.status === 200 || r2.status === 201) {
      console.log(">>> " + base + " publicada. Fica em https://painel-de-gestao-santa-rita.vercel.app/" + base);
    } else {
      console.log("ERRO ao publicar " + base + ": " + r2.status + " " + (await r2.text()).slice(0, 200));
      process.exitCode = 1;
    }
  }
})();
