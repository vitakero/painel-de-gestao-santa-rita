// CONFERE AS PECAS ANTES DA RODADA — e conserta o que der.
//
// Por que existe (27/08/2026): alguem reextraiu um vr-robo2.zip VELHO por cima da pasta do
// robo na loja. Isso fez duas coisas ao mesmo tempo:
//   1. levou junto o node_modules (sao milhares de arquivos, nao vao dentro do zip), e o
//      robo passou a morrer na primeira linha com "Cannot find module 'pg'";
//   2. trocou o .env por uma versao de antes da nuvem existir, sem SUPABASE_SERVICE_KEY.
// O segundo e pior que o primeiro: sem a chave o robo RODA, le o VR inteiro, gera o
// painel — e joga tudo fora, sem erro nenhum. O painel congela e ninguem percebe.
// Ficou 2 horas assim e so foi descoberto por acaso.
//
// Este script roda como primeira coisa da rodada:
//   - peca de programa faltando  -> ele REINSTALA sozinho (npm install) e segue;
//   - configuracao faltando      -> ele PARA e diz o que falta, porque isso ninguem
//                                   conserta sozinho: a chave nao esta em lugar nenhum
//                                   do repositorio, de proposito.
//
// Sai com 0 quando esta tudo bem (a rodada segue) e 1 quando nao da pra seguir.
//
//   node scripts/conferir-pecas.cjs
//   node scripts/conferir-pecas.cjs --so-conferir     (nao instala nada, so relata)
const fs = require("fs");
const https = require("https");
const path = require("path");

// A raiz e a pasta acima desta. PECAS_RAIZ existe para o teste apontar pra outro lugar.
const RAIZ = process.env.PECAS_RAIZ || path.join(__dirname, "..");
const SO_CONFERIR = process.argv.indexOf("--so-conferir") >= 0;

// O que o robo precisa pra funcionar. Se faltar QUALQUER uma, ele para.
// (VR_* ficam de fora: nascem vazias e a API do VR nunca foi ligada.)
const CONFIG_OBRIGATORIA = [
  ["PG_HOST",              "endereco do banco do VR — sem isso nao le venda nenhuma"],
  ["PG_PORT",              "porta do banco do VR"],
  ["PG_DATABASE",          "nome do banco do VR"],
  ["PG_USER",              "usuario do banco do VR"],
  ["PG_PASSWORD",          "senha do banco do VR"],
  ["SUPABASE_URL",         "endereco da nuvem — sem isso o painel nao recebe nada"],
  ["SUPABASE_SERVICE_KEY", "chave da nuvem — sem isso o robo le o VR e JOGA FORA, sem erro"],
  ["GITHUB_TOKEN",         "sem isso o robo nao publica o painel"],
];

// Pacotes que o robo usa de verdade. Nao e a lista inteira do package.json: e o que,
// faltando, quebra a rodada.
const PACOTES = ["pg", "tsx"];

const linhas = [];
const diz = (t) => { console.log(t); linhas.push(t); };

function lerEnv() {
  try { return fs.readFileSync(path.join(RAIZ, ".env"), "utf8"); }
  catch (e) { return null; }
}

function valorDe(env, chave) {
  const m = env.match(new RegExp("^" + chave + "=(.*)$", "m"));
  return m ? m[1].trim() : null;
}

function instalar() {
  diz("    reinstalando as pecas (npm install)...");
  try {
    require("child_process").execSync("npm install", { cwd: RAIZ, stdio: "inherit" });
    return true;
  } catch (e) { diz("    npm install FALHOU: " + String(e.message).slice(0, 120)); return false; }
}


// ============================================================================
// CONTAR PARA A NUVEM O QUE DEU ERRADO
//
// 03/09/2026: o robo ficou 34 horas parado e a mensagem certa ficou na tela de um computador
// que ninguem olha. O painel avisava "o robo parou; alguem precisa olhar o computador do robo"
// — verdade, mas nao e instrucao, e o dono deixou pra depois. Agora o motivo e o conserto sobem
// junto, e o painel mostra os dois.
//
// A ARMADILHA QUE ISTO PRECISA SOBREVIVER: a falha mais comum e justamente FALTAR o
// SUPABASE_URL. Se eu so lesse o endereco do .env, o robo ficaria sem saber para onde mandar o
// aviso do proprio problema. Por isso o endereco tem copia aqui dentro — ele NAO e segredo (ja
// aparece dentro do painel publicado). A chave de servico, essa sim e segredo e nao tem copia:
// se ela sumir, nao da para avisar por aqui, e quem pega o caso e a vigia do painel, que olha a
// idade do dado em vez de esperar recado.
const SB_URL_RESERVA = "https://uabhsmculsfwzcrhyhch.supabase.co";

function contarNuvem(estado) {
  return new Promise((resolve) => {
    let env = "";
    try { env = fs.readFileSync(path.join(RAIZ, ".env"), "utf8"); } catch (e) { return resolve(false); }
    const pega = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim() : ""; };
    const url = (pega("SUPABASE_URL") || SB_URL_RESERVA).replace(/\/+$/, "");
    const key = pega("SUPABASE_SERVICE_KEY");
    if (!key) return resolve(false);   // sem a chave nao ha como falar com a nuvem

    const body = JSON.stringify([Object.assign({ id: "robo", quando: new Date().toISOString() }, estado)]);
    const req = https.request({
      host: url.replace(/^https?:\/\//, ""), path: "/rest/v1/robo_saude?on_conflict=id", method: "POST",
      headers: { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json",
                 "Content-Length": Buffer.byteLength(body),
                 Prefer: "resolution=merge-duplicates,return=minimal" }
    }, (r) => { r.on("data", () => {}); r.on("end", () => resolve(r.statusCode < 300)); });
    req.on("error", () => resolve(false));
    req.setTimeout(8000, () => { try { req.destroy(); } catch (e) {} resolve(false); });
    req.write(body); req.end();
  });
}

// Le o estado guardado, para nao mandar 288 e-mails por dia dizendo a mesma coisa.
function lerEstado() {
  return new Promise((resolve) => {
    let env = "";
    try { env = fs.readFileSync(path.join(RAIZ, ".env"), "utf8"); } catch (e) { return resolve(null); }
    const pega = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim() : ""; };
    const url = (pega("SUPABASE_URL") || SB_URL_RESERVA).replace(/\/+$/, "");
    const key = pega("SUPABASE_SERVICE_KEY");
    if (!key) return resolve(null);
    https.get({ host: url.replace(/^https?:\/\//, ""), path: "/rest/v1/robo_saude?id=eq.robo&select=*",
      headers: { apikey: key, Authorization: "Bearer " + key } }, (r) => {
      let d = ""; r.on("data", (c) => d += c);
      r.on("end", () => { try { const j = JSON.parse(d); resolve(j && j[0] ? j[0] : null); } catch (e) { resolve(null); } });
    }).on("error", () => resolve(null));
  });
}

// E-MAIL SO QUANDO VALE A PENA: primeira falha, ou motivo diferente, ou passou meio dia.
// A funcao do Supabase e que manda; a chave do Resend nao desce para o computador da loja.
const AVISO_ESPERA_MS = 12 * 60 * 60 * 1000;
function precisaAvisar(antes, motivo) {
  if (!antes) return true;
  if (antes.avisado_motivo !== motivo) return true;
  if (!antes.avisado_em) return true;
  return (Date.now() - new Date(antes.avisado_em).getTime()) > AVISO_ESPERA_MS;
}
function mandarEmail(estado) {
  return new Promise((resolve) => {
    let env = "";
    try { env = fs.readFileSync(path.join(RAIZ, ".env"), "utf8"); } catch (e) { return resolve(false); }
    const pega = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim() : ""; };
    const url = (pega("SUPABASE_URL") || SB_URL_RESERVA).replace(/\/+$/, "");
    const key = pega("SUPABASE_SERVICE_KEY");
    if (!key) return resolve(false);
    const body = JSON.stringify(estado);
    const req = https.request({
      host: url.replace(/^https?:\/\//, ""), path: "/functions/v1/aviso-robo", method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json",
                 "Content-Length": Buffer.byteLength(body) }
    }, (r) => { r.on("data", () => {}); r.on("end", () => resolve(r.statusCode < 300)); });
    req.on("error", () => resolve(false));
    req.setTimeout(10000, () => { try { req.destroy(); } catch (e) {} resolve(false); });
    req.write(body); req.end();
  });
}

/* A BANCADA NAO PODE FALAR COM A NUVEM. Este script e rodado de verdade pelo teste, com
   PECAS_RAIZ apontando pra uma pasta de mentira e cenarios de falha de proposito. Na primeira
   versao deste bloco eu lia o .env pelo caminho fixo em vez de pela RAIZ: o teste rodou, meu
   codigo pegou a chave DE VERDADE e mandou DOIS e-mails de robo parado para o dono, sem a loja
   ter nada. Corrigir a raiz ja resolve; esta trava existe porque uma protecao so nunca basta
   quando o custo do erro e "avisar a pessoa por nada" — que e como se ensina alguem a ignorar
   aviso. */
function ehTeste() { return !!process.env.PECAS_RAIZ; }

async function avisar(ok, etapa, motivo, detalhe, comando) {
  if (ehTeste()) return;
  try {
    const antes = await lerEstado();
    const estado = { ok: ok, etapa: etapa, motivo: motivo, detalhe: detalhe, comando: comando };
    if (!ok && precisaAvisar(antes, motivo)) {
      const foi = await mandarEmail(estado);
      if (foi) { estado.avisado_em = new Date().toISOString(); estado.avisado_motivo = motivo; }
      else if (antes) { estado.avisado_em = antes.avisado_em; estado.avisado_motivo = antes.avisado_motivo; }
      if (foi) diz("[pecas] avisei por email.");
    } else if (antes) {
      estado.avisado_em = antes.avisado_em; estado.avisado_motivo = antes.avisado_motivo;
    }
    /* A MENSAGEM SO PODE PROMETER O QUE ACONTECEU.
       A primeira versao dizia "nao consegui mandar o email (fica so no painel)" — e quando o
       .env some INTEIRO o painel tambem nao recebe nada, porque escrever nele usa a mesma
       chave. Testado em 05/09/2026 renomeando o .env: a tela continuou dizendo "tudo certo"
       com o robo morto. Agora a frase depende do que deu certo de verdade. */
    const gravou = await contarNuvem(estado);
    if (!ok && !gravou) {
      diz("[pecas] NAO consegui avisar ninguem: sem o .env nao ha chave para falar com a nuvem.");
      diz("        O painel so vai desconfiar quando o dado envelhecer. Avise alguem na mao.");
    } else if (!ok) {
      diz("[pecas] contei o problema para o painel.");
    }
  } catch (e) { /* avisar nunca pode derrubar o robo */ }
}

async function main() {
  let consertou = false;

  // ---------------------------------------------------------------- pecas
  const temPasta = fs.existsSync(path.join(RAIZ, "node_modules"));
  const faltando = PACOTES.filter(p => !fs.existsSync(path.join(RAIZ, "node_modules", p)));

  if (!temPasta || faltando.length) {
    diz("[pecas] " + (!temPasta ? "a pasta node_modules nao existe."
                                : "faltando: " + faltando.join(", ") + "."));
    // RELATAR O PROBLEMA E DIZER "OK" E O DEFEITO QUE ESTE SCRIPT EXISTE PRA MATAR.
    // Foi assim que o robo passou 2 horas quebrado em 27/08/2026: ele imprimia
    // "sem SUPABASE_SERVICE_KEY - pulando" e terminava com SUCESSO.
    if (SO_CONFERIR) { diz("        (--so-conferir: nao instalei nada)"); return 1; }
    if (instalar()) {
      const aindaFalta = PACOTES.filter(p => !fs.existsSync(path.join(RAIZ, "node_modules", p)));
      if (aindaFalta.length) {
        diz("[pecas] MESMO DEPOIS DE INSTALAR continua faltando: " + aindaFalta.join(", "));
        await avisar(false, "conferir-pecas",
          "Faltam peças no computador da loja: " + aindaFalta.join(", "),
          "O robô tentou instalar sozinho e não conseguiu. Costuma ser internet bloqueada "
            + "ou a pasta node_modules apagada.",
          "No computador da loja, no PowerShell:  cd C:\\vr-robo  e depois  npm install");
        return 1;
      }
      diz("[pecas] consertado.");
      consertou = true;
    } else return 1;
  }

  // ---------------------------------------------------------- configuracao
  const env = lerEnv();
  if (env === null) {
    diz("");
    diz("=================================================================");
    await avisar(false, "conferir-pecas",
      "O arquivo de configuração sumiu do computador da loja",
      "Não existe o arquivo .env em " + RAIZ + ". Sem ele o robô não sabe nem onde fica o banco "
        + "do VR. Ninguém consegue recriar sozinho: as chaves não ficam no repositório, de propósito.",
      "Fale com o Claude — ele tem as chaves e monta o arquivo com você em dois minutos.");
    diz(" PARE: nao achei o arquivo .env em " + RAIZ);
    diz(" Sem ele o robo nao sabe nem onde fica o banco do VR.");
    diz(" Provavelmente a pasta foi reextraida de um zip. Avise o Victor.");
    diz("=================================================================");
    return 1;
  }

  const semValor = CONFIG_OBRIGATORIA.filter(([k]) => {
    const v = valorDe(env, k);
    return v === null || v === "";
  });

  if (semValor.length) {
    const faltando = semValor.map(([k]) => k).join(", ");
    await avisar(false, "conferir-pecas",
      "Falta configuração no computador da loja: " + faltando,
      "O arquivo C:\\vr-robo\\.env está sem " + semValor.length + " configuração(ões): " + faltando
        + ". Sem isso o robô leria o VR e jogaria fora, então ele se recusa a rodar. "
        + "Costuma ser sinal de que alguém extraiu um arquivo antigo por cima da pasta.",
      "Peça ao Claude a linha certa e cole no PowerShell do computador da loja. "
        + "O robô volta sozinho na próxima rodada, em até 5 minutos.");
    diz("");
    diz("=================================================================");
    diz(" PARE: o .env esta incompleto. Faltam " + semValor.length + " configuracao(oes):");
    semValor.forEach(([k, porque]) => diz("   " + k + " — " + porque));
    diz("");
    diz(" Nao adianta rodar assim: o robo leria o VR e jogaria fora,");
    diz(" sem dar erro, e o painel congelaria sem ninguem perceber.");
    diz("");
    diz(" Isso costuma ser sinal de que alguem reextraiu um zip VELHO por");
    diz(" cima desta pasta. Avise o Victor — a chave nao esta no");
    diz(" repositorio de proposito, entao ninguem conserta sozinho.");
    diz("=================================================================");
    return 1;
  }

  diz("[pecas] tudo no lugar" + (consertou ? " (depois do conserto)" : "")
      + ": " + PACOTES.length + " pacotes, " + CONFIG_OBRIGATORIA.length + " configuracoes.");
  /* O SUCESSO TAMBEM E CONTADO: e o que apaga o aviso do painel sozinho quando o problema e
     resolvido. Sem isto, o aviso ficaria pendurado ate alguem limpar na mao. */
  await avisar(true, "conferir-pecas", null, null, null);
  return 0;
}

main().then(function(c){ process.exit(c); }, function(){ process.exit(1); });
