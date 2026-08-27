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

function main() {
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
  return 0;
}

process.exit(main());
