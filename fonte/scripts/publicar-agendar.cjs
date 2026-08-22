// Publica uma PÁGINA PÚBLICA (fora do painel) na raiz do repositório.
//
// 14/08/2026: passou a aceitar QUAL página publicar. Nasceu só pro agendar.html, mas o Portal
// do Fornecedor (fornecedor.html) é outra página pública no mesmo domínio — e duplicar o script
// seria criar dois lugares pra manter a mesma coisa.
//
// POR QUE É UM SCRIPT SEPARADO
//   publicar.cjs só cuida do index.html (o painel). A página de agendamento é outro arquivo,
//   servido no mesmo domínio mas independente — o fornecedor abre sem login.
//   Antes isso era feito por um script solto no rascunho, que se perdeu junto com a sessão.
//   Agora mora no repositório: some do rascunho, não some do projeto.
//
//   node scripts/publicar-agendar.cjs fornecedor.html          -> só teste (GitHub Pages).
//   SUBIR=1 node scripts/publicar-agendar.cjs fornecedor.html  -> vai pro site oficial.
//   Sem o nome do arquivo, publica o agendar.html (como era antes).
const fs = require("fs");
const path = require("path");

const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim() : ""; };

const TOKEN = get("GITHUB_TOKEN");
const OWNER = "vitakero";
const REPO  = "painel-de-gestao-santa-rita";
// O nome vem da linha de comando; sem nada, mantém o comportamento antigo.
const FILE  = (process.argv[2] || "agendar.html").replace(/[^a-zA-Z0-9._-]/g, "");
const LOCAL = path.join(__dirname, "..", "output", FILE);

if (!TOKEN) { console.log("ERRO: GITHUB_TOKEN nao encontrado no .env"); process.exit(1); }
if (!fs.existsSync(LOCAL)) { console.log("ERRO: nao achei " + LOCAL); process.exit(1); }

const H = { Authorization: "token " + TOKEN, "User-Agent": "santa-rita",
            Accept: "application/vnd.github+json" };
const REPO_API = "https://api.github.com/repos/" + OWNER + "/" + REPO;

async function gh(caminho, opcoes) {
  const r = await fetch(REPO_API + caminho, Object.assign({ headers: H }, opcoes || {}));
  if (!r.ok) throw new Error(caminho + " -> " + r.status + " " + (await r.text()).slice(0, 200));
  return r.json();
}

// O ultimo commit deste arquivo ja mandou publicar?
async function ultimoCommitPublicou() {
  const l = await gh("/commits?path=" + encodeURIComponent(FILE) + "&per_page=1");
  return l.length > 0 && l[0].commit.message.indexOf("[publicar]") >= 0;
}

// Commit sem mudar arquivo nenhum: reaproveita a arvore do commit atual.
// Serve so pra carregar a mensagem com [publicar], que e o que o vercel.json
// olha pra decidir se reconstroi o site.
async function commitVazio(mensagem) {
  const repo = await gh("");
  const ramo = repo.default_branch;
  const ref = await gh("/git/ref/heads/" + ramo);
  const topo = await gh("/git/commits/" + ref.object.sha);
  const novo = await gh("/git/commits", {
    method: "POST",
    body: JSON.stringify({ message: mensagem, tree: topo.tree.sha, parents: [topo.sha] }),
  });
  await gh("/git/refs/heads/" + ramo, {
    method: "PATCH", body: JSON.stringify({ sha: novo.sha }),
  });
  return novo.sha;
}

(async () => {
  const conteudo = fs.readFileSync(LOCAL);
  const b64 = conteudo.toString("base64");
  const api = "https://api.github.com/repos/" + OWNER + "/" + REPO + "/contents/" + FILE;
  const headers = { Authorization: "token " + TOKEN, "User-Agent": "santa-rita",
                    Accept: "application/vnd.github+json" };

  const producao = process.env.SUBIR === "1";

  const atual = await fetch(api, { headers });
  let sha;
  if (atual.status === 200) {
    const j = await atual.json();
    sha = j.sha;
    // Nao reenvia arquivo identico: cada commit a toa e uma publicacao a toa no Vercel.
    if (Buffer.from(j.content.replace(/\n/g, ""), "base64").equals(conteudo)) {
      // MAS: o que faz o Vercel reconstruir nao e o conteudo, e o "[publicar]"
      // na mensagem do commit. Quem manda pro GitHub primeiro pra conferir e SO
      // DEPOIS publica caia numa armadilha: o arquivo ja estava igual, o envio
      // era pulado, o commit com [publicar] nunca nascia e producao ficava pra
      // tras sem avisar. Nesse caso o jeito certo e um commit vazio.
      if (!producao) { console.log(">>> " + FILE + " ja esta igual no GitHub. Nada a fazer."); return; }
      // FORCAR=1 publica mesmo com tudo igual. Serve para quando a mudanca NAO
      // esta na pagina e sim na configuracao (vercel.json): o arquivo continua
      // identico, mas o Vercel precisa reconstruir para a regra nova valer.
      const jaPublicado = process.env.FORCAR === "1" ? false : await ultimoCommitPublicou();
      if (jaPublicado) {
        console.log(">>> " + FILE + " ja esta igual no GitHub E ja foi publicado. Nada a fazer.");
        console.log("    (para reconstruir mesmo assim: FORCAR=1 SUBIR=1 node scripts/publicar-agendar.cjs " + FILE + ")");
        return;
      }
      console.log("(arquivo ja estava no GitHub; mandando so a ordem de publicar)");
      await commitVazio("Publicar " + FILE + " [publicar]");
      console.log(">>> PUBLICADO. Vai para o dominio de producao em ~1 min.\n"
                + "    https://painel.supermercadosantarita.com.br/agendar.html");
      return;
    }
  } else if (atual.status !== 404) {
    console.log("ERRO ao ler o arquivo atual: " + atual.status + " " + (await atual.text()).slice(0, 200));
    process.exit(1);
  }

  const body = { message: "Pagina publica: " + FILE + (producao ? " [publicar]" : ""),
                 content: b64 };
  if (sha) body.sha = sha;

  const r = await fetch(api, { method: "PUT", headers, body: JSON.stringify(body) });
  if (!r.ok) { console.log("ERRO ao publicar: " + r.status + " " + (await r.text()).slice(0, 300)); process.exit(1); }

  console.log(producao
    ? ">>> PUBLICADO. Vai para o dominio de producao em ~1 min.\n    https://painel.supermercadosantarita.com.br/agendar.html"
    : ">>> Publicado so para TESTE (github.io). O dominio de producao NAO mudou.\n"
      + "    https://vitakero.github.io/painel-de-gestao-santa-rita/" + FILE + "\n"
      + "    Para subir para producao: SUBIR=1 node scripts/publicar-agendar.cjs " + FILE);
})().catch((e) => { console.log("ERRO: " + e.message); process.exit(1); });
