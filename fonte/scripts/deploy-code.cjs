// Empurra os arquivos de codigo do robo para o GitHub (pasta robo/ do repo).
// O servidor baixa esses arquivos sozinho antes de cada rodada.
// Uso: node scripts/deploy-code.cjs
const fs = require("fs");
const path = require("path");

const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim() : ""; };
const TOKEN = get("GITHUB_TOKEN");
const OWNER = "vitakero";
const REPO = "painel-de-gestao-santa-rita";

// arquivos que o servidor vai buscar (os que mudam com frequencia)
const FILES = [
  ["vercel.json", "vercel.json"],           // regra que decide quando o Vercel publica
  ["vercel.README.md", "vercel.README.md"], // a explicacao mora FORA do JSON: campo desconhecido no vercel.json derruba o deploy
  ["scripts/demoDashboard.ts", "robo/demoDashboard.ts"],
  ["scripts/central/feed.client.js", "robo/central/feed.client.js"],   // tela da Central Operacional (arquivo isolado)
  ["scripts/central/sw.js", "robo/central/sw.js"],   // (2.5) service worker do PWA (backup de fonte)
  ["scripts/buildVrData.cjs", "robo/buildVrData.cjs"],
  ["scripts/publicar.cjs", "robo/publicar.cjs"],
  ["scripts/pixWorker.cjs", "robo/pixWorker.cjs"],
  ["scripts/puxar-codigo.cjs", "robo/puxar-codigo.cjs"],
  ["scripts/vr-descobrir-agendamento.cjs", "robo/vr-descobrir-agendamento.cjs"],
  ["scripts/vr-descobrir-agendamento2.cjs", "robo/vr-descobrir-agendamento2.cjs"],
  ["scripts/vr-sync-agendamento.cjs", "robo/vr-sync-agendamento.cjs"],
  ["scripts/vr-sync-conferencia.cjs", "robo/vr-sync-conferencia.cjs"],
  ["scripts/vr-sync-despesas.cjs", "robo/vr-sync-despesas.cjs"],
  ["scripts/vr-descobrir-pedidos.cjs", "robo/vr-descobrir-pedidos.cjs"],
  ["scripts/vr-descobrir-pedidos2.cjs", "robo/vr-descobrir-pedidos2.cjs"],
  ["scripts/vr-medir-pedidos.cjs", "robo/vr-medir-pedidos.cjs"],
  ["scripts/vr-sync-pedidos.cjs", "robo/vr-sync-pedidos.cjs"],
  ["scripts/vr-descobrir-perdas.cjs", "robo/vr-descobrir-perdas.cjs"],
  ["scripts/vr-descobrir-notas.cjs", "robo/vr-descobrir-notas.cjs"],
  ["scripts/mandar-log.cjs", "robo/mandar-log.cjs"],
  ["scripts/notas-passo.cjs", "robo/notas-passo.cjs"],
  ["scripts/vr-sync-notas.cjs", "robo/vr-sync-notas.cjs"],
  ["scripts/vr-sync-codigos.cjs", "robo/vr-sync-codigos.cjs"],
  ["scripts/notas.bat", "robo/notas.bat"],
  ["robo-loja/pix.bat", "robo/pix.bat"],
  ["robo-loja/pix-loop.vbs", "robo/pix-loop.vbs"],
  ["robo.bat", "robo/robo.bat"],
];

// ============================================================
// BACKUP DA FONTE — o que NÃO roda na loja, mas não pode se perder
//
// A lista de cima é operacional: são os arquivos que a máquina da loja BAIXA
// (o puxar-codigo.cjs procura por nome, dentro de robo/). Só que ela deixava de
// fora quase tudo o que o sistema é. Medido em 22/08/2026: 105 arquivos de SQL —
// o banco inteiro, cada tabela, cada regra de acesso — com ZERO cópia; o
// montar-portal.cjs, que gera o Portal do Fornecedor inteirinho; os 33 testes; e
// os modelos de e-mail. Tudo isso só existia no Mac dele.
//
// Vão para fonte/ e não para robo/ de propósito: a máquina da loja procura por
// nome dentro de robo/, e SQL no meio do robô só serviria pra confundir.
//
// Não dispara publicação no site: o vercel.json só constrói quando a mensagem do
// commit tem "[publicar]", e a daqui é "deploy: ...".
const PASTAS = [
  ["sql", ".sql"],                 // o banco: tabelas, funções, quem pode o quê
  ["scripts", ".cjs"],             // os que sobraram (montar-portal, publicar-*, previa-*, sicredi*)
  ["scripts", ".ts"],
  ["scripts/testes", ".cjs"],      // as travas que provam que nada quebrou
  ["email-templates", ""],         // o que o fornecedor e o funcionário recebem
];

function varrer() {
  const achados = [];
  const jaTem = new Set(FILES.map(([lp]) => lp));
  for (const [pasta, ext] of PASTAS) {
    const dir = path.join(__dirname, "..", pasta);
    if (!fs.existsSync(dir)) continue;
    for (const nome of fs.readdirSync(dir)) {
      const rel = pasta + "/" + nome;
      if (!fs.statSync(path.join(dir, nome)).isFile()) continue;
      if (ext && !nome.endsWith(ext)) continue;
      if (jaTem.has(rel)) continue;   // já sobe pro robô, não duplico
      achados.push([rel, "fonte/" + rel]);
    }
  }
  return achados;
}

const headers = {
  Authorization: "Bearer " + TOKEN,
  Accept: "application/vnd.github+json",
  "User-Agent": "robo-painel",
  "X-GitHub-Api-Version": "2022-11-28",
};

// SHA do git pro conteudo do arquivo. E o mesmo numero que a API do GitHub devolve,
// entao da pra saber se o arquivo LA e identico ao daqui sem precisar baixar nada.
function shaGit(buf) {
  const h = require("crypto").createHash("sha1");
  h.update("blob " + buf.length + "\0");
  h.update(buf);
  return h.digest("hex");
}

let pulados = 0;

async function push(localPath, repoPath) {
  const api = "https://api.github.com/repos/" + OWNER + "/" + REPO + "/contents/" + repoPath;
  const buf = fs.readFileSync(path.join(__dirname, "..", localPath));
  const b64 = buf.toString("base64");
  let sha;
  const r1 = await fetch(api, { headers });
  if (r1.status === 200) sha = (await r1.json()).sha;
  else if (r1.status !== 404) throw new Error(repoPath + " leitura " + r1.status + ": " + (await r1.text()));

  // NAO REESCREVER O QUE JA ESTA IGUAL.
  // Antes isso aqui empurrava os 14 arquivos toda vez, mudassem ou nao. Cada envio vira
  // um commit, e cada commit dispara uma publicacao no Vercel — que tem limite diario.
  // Num dia de muitos ajustes o limite estourava e o site parava de atualizar, parecendo
  // que o codigo nao tinha subido. Agora so sobe o que realmente mudou.
  if (sha && sha === shaGit(buf)) { pulados++; return; }

  const body = { message: "deploy: " + repoPath, content: b64 };
  if (sha) body.sha = sha;
  const r2 = await fetch(api, { method: "PUT", headers, body: JSON.stringify(body) });
  if (r2.status !== 200 && r2.status !== 201) throw new Error(repoPath + " envio " + r2.status + ": " + (await r2.text()));
  console.log("  enviado -> " + repoPath);
}

(async () => {
  if (!TOKEN) { console.log("ERRO: GITHUB_TOKEN nao encontrado no .env"); process.exit(1); }
  console.log("Empurrando codigo para o GitHub...");
  for (const [lp, rp] of FILES) await push(lp, rp);
  const extras = varrer();
  for (const [lp, rp] of extras) await push(lp, rp);
  if (pulados) console.log("  (" + pulados + " arquivo(s) ja estavam iguais — nao reenviei)");
  console.log("  backup da fonte: " + extras.length + " arquivo(s) acompanhados em fonte/");
  console.log(">>> Codigo no GitHub atualizado. O servidor vai pegar na proxima rodada (ate ~5 min).");
})().catch((e) => { console.log("ERRO:", e.message); process.exit(1); });
