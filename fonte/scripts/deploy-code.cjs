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
  // O TEXTO do Regulamento Interno. O demoDashboard.ts LÊ este arquivo para construir a aba:
  // sem ele na loja, a reconstrução do painel quebra e o painel para de ser atualizado.
  // Por isso ele viaja com o código, e não como "asset" (a pasta assets/ não é enviada).
  ["assets/regulamento-interno.json", "robo/regulamento-interno.json"],
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
  ["scripts/vr-conferir-setor.cjs", "robo/vr-conferir-setor.cjs"],   // roda na loja, compara minha conta x relatorio do VR
  ["scripts/vr-descobrir-notas.cjs", "robo/vr-descobrir-notas.cjs"],
  ["scripts/mandar-log.cjs", "robo/mandar-log.cjs"],
  ["scripts/conferir-pecas.cjs", "robo/conferir-pecas.cjs"],   // 1a coisa que o robo.bat chama
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
// O repositório de cima é PÚBLICO — é de lá que o painel e o portal são servidos.
// Então aqui só entra o que já é público por natureza: o código que roda no navegador
// de quem abre o site, e que qualquer um leria de qualquer jeito abrindo a página.
const PASTAS = [
  ["scripts", ".cjs"],             // os que sobraram (montar-portal, publicar-*, previa-*, sicredi*)
  ["scripts", ".ts"],
  ["scripts/testes", ".cjs"],      // as travas que provam que nada quebrou
  ["email-templates", ""],         // o que o fornecedor e o funcionário recebem
  ["scripts/central", ""],         // a Central Operacional (tela isolada + tipos)
  ["src/config", ""],              // a configuração da loja
  [".", ".cjs"],                   // os vigias que moram na raiz
];

// O BANCO NÃO VAI PRO PÚBLICO.
//
// Em 22/08/2026 eu subi os 105 arquivos de SQL para o repositório público sem perguntar.
// Não vazou senha nenhuma (os valores moram no .env, que nunca sobe), mas ficou visível a
// planta do banco: cada tabela, cada função e — o que importa — cada regra de quem pode
// ler o quê. Com um portal abrindo para 132 fornecedores de fora, isso é entregar o mapa
// de onde procurar brecha. Tirei no mesmo dia.
//
// Para o SQL ter cópia, ele precisa de um repositório PRIVADO. Enquanto o Victor não
// criar, o programa AVISA em vez de fingir que está tudo salvo — backup que a pessoa
// pensa que tem e não tem é pior que não ter nenhum.
// Cada entrada diz DE onde ler e PARA onde vai no repositório privado. O "fundo"
// liga a varredura em subpastas — as Edge Functions moram em
// supabase/functions/<nome>/index.ts, um nível abaixo, e a varredura antiga só olhava
// o primeiro nível: elas simplesmente não eram vistas.
const PASTAS_PRIVADAS = [
  { de: "sql",                ext: ".sql", para: "sql" },
  { de: "supabase/functions", ext: "",     para: "supabase/functions", fundo: true },
  { de: "scripts",            ext: ".mjs", para: "bancadas", so: /^conferir-/ },
];

// ============================================================
// O QUE NUNCA SOBE — nem para o público, nem para o privado.
//
// Espelha o .gitignore endurecido em 01/09/2026. Está aqui DE NOVO de propósito: o
// deploy não usa git, usa a API do GitHub direto, então o .gitignore não o alcança.
// Quem confiasse só no .gitignore acharia que estava protegido e não estaria.
// ============================================================
const PROIBIDO = [
  /(^|\/)\.env($|\.)/i,          // .env e qualquer cópia dele (o .env.example não entra em pasta varrida)
  /\.bak($|-)/i, /\.old$/i, /\.orig$/i,
  /^backup\//i, /^backups\//i, /(^|\/)\.previa\//i,
  /\.(pem|key|p12|pfx|crt|cer|jks|keystore|ppk|htpasswd)$/i,
  /(^|\/)id_rsa/i, /service-account/i, /credential/i, /secret/i,
  /\.(dump|zip)$/i, /\.sql\.gz$/i, /\.tar\.gz$/i,
];
function proibido(rel) { return PROIBIDO.some((re) => re.test(rel)); }
const REPO_FONTE = get("GITHUB_REPO_FONTE") || "";

// Aceita as duas formas: ["pasta", ".ext"] (o jeito antigo, destino em fonte/) e
// { de, ext, para, fundo, so } (o jeito novo, com destino e subpastas).
function varrer(pastas) {
  const achados = [];
  const jaTem = new Set(FILES.map(([lp]) => lp));
  const bloqueados = [];

  for (const bruto of pastas) {
    const e = Array.isArray(bruto) ? { de: bruto[0], ext: bruto[1] } : bruto;
    const base = path.join(__dirname, "..", e.de);
    if (!fs.existsSync(base)) continue;

    (function anda(sub) {
      const dir = sub ? path.join(base, sub) : base;
      for (const nome of fs.readdirSync(dir)) {
        const dentro = sub ? sub + "/" + nome : nome;
        const cheio = path.join(dir, nome);
        const rel = (e.de === "." ? dentro : e.de + "/" + dentro);
        if (fs.statSync(cheio).isDirectory()) { if (e.fundo) anda(dentro); continue; }
        if (e.ext && !nome.endsWith(e.ext)) continue;
        if (e.so && !e.so.test(nome)) continue;
        // a tranca: um arquivo proibido nunca vira envio, venha de onde vier
        if (proibido(rel)) { bloqueados.push(rel); continue; }
        if (jaTem.has(rel)) continue;   // já sobe pro robô, não duplico
        achados.push([rel, e.para ? (e.para + "/" + dentro) : ("fonte/" + rel)]);
      }
    })("");
  }
  if (bloqueados.length) {
    console.log("  (" + bloqueados.length + " arquivo(s) BARRADOS por serem proibidos: " +
                bloqueados.slice(0, 3).join(", ") + (bloqueados.length > 3 ? ", ..." : "") + ")");
  }
  return achados;
}

const headers = {
  Authorization: "Bearer " + TOKEN,
  Accept: "application/vnd.github+json",
  "User-Agent": "robo-painel",
  "X-GitHub-Api-Version": "2022-11-28",
};

// ============================================================
// UM ENVIO SÓ, NÃO UM POR ARQUIVO
//
// A versão antiga escrevia arquivo por arquivo (PUT em /contents/...). Cada PUT vira um
// commit, e cada commit vira uma tentativa de publicação no Vercel — que tem limite
// diário. Em 22/08/2026 o backup da fonte mandou 183 arquivos de uma vez, virou 183
// commits, e o Vercel travou: "Deployment rate limited — retry in 24 hours". O site no ar
// continuou de pé, mas ficou 24h sem poder ser atualizado. O comentário do próprio código
// já avisava desse limite; eu achei que a regra do vercel.json protegia, e não protege —
// ela impede a CONSTRUÇÃO, não a tentativa, e é a tentativa que conta no limite.
//
// Agora vai tudo num commit só, pelo caminho de baixo do git:
//   1. lê a árvore inteira do repositório numa chamada (em vez de um GET por arquivo)
//   2. manda só o conteúdo do que mudou como "blob" — blob NÃO é commit, não conta nada
//   3. monta uma árvore nova em cima da atual
//   4. faz UM commit e move o galho pra ele
//
// 183 arquivos = 1 publicação, não 183.
// ============================================================
async function gh(caminho, opts) {
  const r = await fetch("https://api.github.com" + caminho, Object.assign({ headers }, opts || {}));
  if (!r.ok) throw new Error(caminho + " -> " + r.status + " " + (await r.text()).slice(0, 200));
  return r.json();
}

// SHA do git pro conteudo do arquivo. E o mesmo numero que a API do GitHub devolve,
// entao da pra saber se o arquivo LA e identico ao daqui sem precisar baixar nada.
function shaGit(buf) {
  const h = require("crypto").createHash("sha1");
  h.update("blob " + buf.length + "\0");
  h.update(buf);
  return h.digest("hex");
}

async function enviarLote(arquivos, repo, mensagem) {
  const base = "/repos/" + OWNER + "/" + repo;
  const ref = await gh(base + "/git/ref/heads/main");
  const commitAtual = await gh(base + "/git/commits/" + ref.object.sha);
  const arvore = await gh(base + "/git/trees/" + commitAtual.tree.sha + "?recursive=1");
  const laDentro = new Map(arvore.tree.filter((t) => t.type === "blob").map((t) => [t.path, t.sha]));

  // NAO REESCREVER O QUE JA ESTA IGUAL — comparando pelo sha, sem baixar nada.
  const mudaram = [];
  for (const [lp, rp] of arquivos) {
    const buf = fs.readFileSync(path.join(__dirname, "..", lp));
    if (laDentro.get(rp) === shaGit(buf)) { pulados++; continue; }
    mudaram.push([rp, buf]);
  }
  if (!mudaram.length) return [];

  const itens = [];
  for (const [rp, buf] of mudaram) {
    const blob = await gh(base + "/git/blobs", {
      method: "POST",
      body: JSON.stringify({ content: buf.toString("base64"), encoding: "base64" }),
    });
    itens.push({ path: rp, mode: "100644", type: "blob", sha: blob.sha });
  }
  const nova = await gh(base + "/git/trees", {
    method: "POST",
    body: JSON.stringify({ base_tree: commitAtual.tree.sha, tree: itens }),
  });
  const novoCommit = await gh(base + "/git/commits", {
    method: "POST",
    body: JSON.stringify({ message: mensagem, tree: nova.sha, parents: [ref.object.sha] }),
  });
  await gh(base + "/git/refs/heads/main", {
    method: "PATCH",
    body: JSON.stringify({ sha: novoCommit.sha }),
  });
  return mudaram.map(([rp]) => rp);
}

let pulados = 0;

(async () => {
  if (!TOKEN) { console.log("ERRO: GITHUB_TOKEN nao encontrado no .env"); process.exit(1); }
  console.log("Empurrando codigo para o GitHub...");

  const extras = varrer(PASTAS);
  const publicos = FILES.concat(extras);
  const enviados = await enviarLote(publicos, REPO, "deploy: codigo e backup da fonte (" + publicos.length + " arquivos)");
  enviados.forEach((rp) => console.log("  enviado -> " + rp));
  if (!enviados.length) console.log("  (nada mudou desde o ultimo envio)");

  // o banco só tem cópia se existir lugar fechado pra ele
  const privados = varrer(PASTAS_PRIVADAS);
  if (REPO_FONTE) {
    // ==BACKUPDURO== Se o backup privado falhar, o programa PARA com erro. O dono pediu
    // assim, e a razão é boa: publicar sem backup, calado, é o pior dos dois mundos —
    // a versão sai no ar e ninguém fica sabendo que a cópia não existe.
    // Isto NÃO afeta a loja: o robô roda publicar.cjs, e nunca chama este arquivo.
    let n;
    try {
      n = await enviarLote(privados, REPO_FONTE, "backup do banco (" + privados.length + " arquivos)");
    } catch (e) {
      console.log("");
      console.log("  ================================================================");
      console.log("  ERRO NO BACKUP PRIVADO — NADA FOI PUBLICADO.");
      console.log("  " + e.message);
      console.log("");
      console.log("  O envio do painel NAO seguiu de proposito: publicar sem copia do");
      console.log("  banco, em silencio, e pior do que nao publicar.");
      console.log("  Confira se o token alcanca " + OWNER + "/" + REPO_FONTE + " e rode de novo.");
      console.log("  ================================================================");
      process.exit(1);
    }
    console.log("  banco: " + n.length + " arquivo(s) novos em " + OWNER + "/" + REPO_FONTE + " (privado)");
  } else {
    console.log("");
    console.log("  ATENCAO: os " + privados.length + " arquivos de SQL do banco NAO tem copia.");
    console.log("  Eles nao vao pro repositorio publico de proposito (expoem as regras de acesso).");
    console.log("  Crie um repositorio PRIVADO e ponha o nome dele no .env:  GITHUB_REPO_FONTE=nome-do-repo");
    console.log("");
  }

  if (pulados) console.log("  (" + pulados + " arquivo(s) ja estavam iguais — nao reenviei)");
  console.log("  backup da fonte: " + extras.length + " arquivo(s) em fonte/ (publico)");
  console.log(">>> Codigo no GitHub atualizado, em UM envio so. O servidor pega na proxima rodada (ate ~5 min).");
})().catch((e) => { console.log("ERRO:", e.message); process.exit(1); });
