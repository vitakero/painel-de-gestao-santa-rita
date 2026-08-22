// Tira uma pasta do repositório PÚBLICO. Só leitura + apagar; não mexe em nada local.
const path = require("path");
const env = require("fs").readFileSync(path.join(process.env.HOME, "vr-looker-integration", ".env"), "utf8");
const get = k => (env.match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1];
const T = get("GITHUB_TOKEN"), OWNER = "vitakero", REPO = "painel-de-gestao-santa-rita";
const PASTA = process.argv[2];
const h = { Authorization: "Bearer " + T, Accept: "application/vnd.github+json", "User-Agent": "santa-rita" };
(async () => {
  const r = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${PASTA}`, { headers: h });
  if (!r.ok) { console.log("nao achei " + PASTA + " (" + r.status + ")"); return; }
  const lista = await r.json();
  const arqs = lista.filter(x => x.type === "file");
  console.log("tirando " + arqs.length + " arquivo(s) de " + PASTA + "...");
  let n = 0;
  for (const a of arqs) {
    const d = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${a.path}`, {
      method: "DELETE", headers: h,
      body: JSON.stringify({ message: "tirar do publico: " + a.path, sha: a.sha }) });
    if (d.ok) n++; else console.log("  falhou: " + a.path + " (" + d.status + ")");
  }
  console.log("tirados: " + n + " de " + arqs.length);
})();
