// Baixa o codigo mais recente do GitHub via API (api.github.com).
// Motivo: o raw.githubusercontent.com falha/cacheia na rede da loja, entao o robo
// ficava preso no codigo antigo. A api.github.com e o mesmo caminho que o publicar.cjs
// usa com sucesso, entao e confiavel aqui.
// Roda no inicio do robo.bat (antes de gerar o painel). Se algo falhar, mantem o
// codigo atual (nunca quebra a rodada).
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
let env = "";
try { env = fs.readFileSync(path.join(root, ".env"), "utf8"); } catch (e) {}
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim() : ""; };
const TOKEN = get("GITHUB_TOKEN");
const OWNER = "vitakero";
const REPO = "painel-de-gestao-santa-rita";

// [arquivo no GitHub (pasta robo/), destino local em scripts/, marcador de validade]
const FILES = [
  ["robo/demoDashboard.ts", "demoDashboard.ts", "vr-data.json"],
  ["robo/buildVrData.cjs", "buildVrData.cjs", "vr-data.json"],
  ["robo/publicar.cjs", "publicar.cjs", "PUBLICADO"],
  ["robo/pixWorker.cjs", "pixWorker.cjs", "pix_cobrancas"],
  ["robo/vr-descobrir-agendamento.cjs", "vr-descobrir-agendamento.cjs", "DETETIVE do VR"],
];

const headers = {
  Authorization: "Bearer " + TOKEN,
  Accept: "application/vnd.github.raw",
  "User-Agent": "robo-painel",
  "X-GitHub-Api-Version": "2022-11-28",
};

(async () => {
  if (!TOKEN) { console.log("  (sem GITHUB_TOKEN no .env - mantendo o codigo atual)"); return; }
  for (const [remote, local, marker] of FILES) {
    try {
      const r = await fetch("https://api.github.com/repos/" + OWNER + "/" + REPO + "/contents/" + remote, { headers });
      if (!r.ok) { console.log("  (sem atualizacao de " + local + " - HTTP " + r.status + ")"); continue; }
      const txt = await r.text();
      if (txt.indexOf(marker) === -1) { console.log("  (" + local + " invalido - mantendo o atual)"); continue; }
      fs.writeFileSync(path.join(__dirname, local), txt);
      console.log("  atualizado: " + local);
    } catch (e) {
      console.log("  (erro ao baixar " + local + ": " + e.message + " - mantendo o atual)");
    }
  }
})();
