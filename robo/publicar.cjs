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

  // ECONOMIA DE PUBLICACOES (limite do Vercel: 100 deploys/dia):
  // 1) se o conteudo nao mudou (ignorando o carimbo "gerado em HH:MM"), nao publica;
  // 2) mudou? o ritmo depende da HORA — rapido quando a loja vende, devagar quando nao.
  //    (FORCAR=1 ignora tudo isso: publicacao manual passa por cima.)
  //
  // O RITMO SAI DO MOVIMENTO REAL DA LOJA, nao de chute. Medido em 27/08/2026 sobre a
  // media dos ultimos 90 dias de faturamento por hora, que o proprio robo coleta:
  //   segunda a sabado (06:30 as 21h): DOIS picos — manha 08-10h e tarde 16-19h — com
  //     vale no almoco. As 18h sozinha vale 11,3% do dia; as 06h vale 1,2%.
  //   domingo (07 as 13h): seis horas concentradas, 09h e 10h valendo 20% cada.
  //
  // AS HORAS DE FECHAMENTO SAO RAPIDAS MESMO VENDENDO POUCO. As 20h e 21h de segunda a
  // sabado (e 13h/14h no domingo) tem pouco volume, mas e quando o numero do DIA fecha —
  // e e a hora em que o dono olha o faturamento. Esperar uma hora ali seria o pior
  // momento possivel pra ser lento. Foi pedido dele, em 27/08/2026.
  //
  // Escolha do dono (opcao "2" de cinco calculadas): pico 10 min, meio 30, fraco 60.
  // Da 67 publicacoes no pior dia (sabado) e 48 no domingo, contra 89 da regra antiga.
  // Sobram ~33 para as publicacoes manuais, que furam a fila.
  //
  // ISTO E TETO, NAO OBRIGACAO: a regra 1 manda mais que esta. Numa hora sem venda
  // nenhuma ele nao publica nem uma vez, por mais rapido que esteja o ritmo.
  const RITMO_SEM = [60,60,60,60,60,60,60,30,10,10,10,30,30,30,30,30,10,10,10,10,10,10,60,60];
  const RITMO_DOM = [60,60,60,60,60,60,60,10,10,10,10,10,10,10,10,60,60,60,60,60,60,60,60,60];
  // trava dura: mesmo que tudo o mais falhe, o dia para aqui. 15 de folga ate o limite.
  const TETO_DIA = 85;
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
    if (pubsHoje >= TETO_DIA) {
      console.log(">>> Teto do dia atingido (" + pubsHoje + " de " + TETO_DIA + "). Nao publico mais hoje.");
      process.exit(0);
    }
    const agora = new Date();
    const minEspera = (agora.getDay() === 0 ? RITMO_DOM : RITMO_SEM)[agora.getHours()];
    if (st && st.ts && (Date.now() - st.ts) < minEspera * 60 * 1000) {
      const falta = Math.ceil((minEspera * 60 * 1000 - (Date.now() - st.ts)) / 60000);
      console.log(">>> Ritmo das " + agora.getHours() + "h: " + minEspera + " min entre publicacoes."
        + " Proxima em ~" + falta + " min. (" + pubsHoje + " publicacoes hoje)");
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
