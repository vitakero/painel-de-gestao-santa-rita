// AS COLUNAS QUE O ROBO MANDA TEM QUE EXISTIR NA TABELA DA NUVEM.
//
// POR QUE ESTE TESTE EXISTE (22/09/2026)
//   O SQL da tabela e a consulta do robo foram escritos ao mesmo tempo, por pessoas
//   diferentes, e cada um batizou as mesmas colunas de um jeito: o robo mandava
//   id_venda, codigo, motivo, bruto, cupom_cancelado; a tabela tinha venda_id,
//   codigo_barras, motivo_vr, valor_bruto, cupom_inteiro. O PostgREST recusa o lote
//   inteiro quando UMA coluna nao existe — entao a tabela ficou VAZIA por quase uma hora,
//   com o painel no ar dizendo "o detalhamento ainda nao chegou", e ninguem viu erro.
//   Esse e o mesmo defeito que ja mordeu o Pontos Extras: coluna que falta e descartada
//   em silencio.
//
//   Este teste le as colunas DA NUVEM (nao do arquivo .sql, que pode estar diferente do
//   que de fato rodou) e cobra que toda coluna enviada pelo robo exista la.
//
//   Precisa das chaves do .env. Sem elas, PULA — nao derruba a bateria.
//
//   node scripts/testes/frentecaixa-colunas.test.cjs
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..", "..");
const env = (() => { try { return fs.readFileSync(path.join(RAIZ, ".env"), "utf8"); } catch (e) { return ""; } })();
const g = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim() : ""; };
const URL = g("SUPABASE_URL"), KEY = g("SUPABASE_SERVICE_KEY");

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + obtido + (bate ? "" : "   (esperado: " + esperado + ")"));
  bate ? ok++ : falhou++;
}

(async () => {
  if (!URL || !KEY) { console.log("PULADO — precisa de SUPABASE_URL e SUPABASE_SERVICE_KEY no .env."); process.exit(0); }

  // 1) as colunas que a nuvem REALMENTE tem
  let colunas = [];
  try {
    const r = await fetch(URL + "/rest/v1/", { headers: { apikey: KEY, Authorization: "Bearer " + KEY } });
    const j = await r.json();
    const d = j.definitions && j.definitions["frentecaixa_ocorrencias"];
    if (!d) { console.log("PULADO — a tabela frentecaixa_ocorrencias ainda nao existe na nuvem."); process.exit(0); }
    colunas = Object.keys(d.properties);
  } catch (e) { console.log("PULADO — nao consegui falar com a nuvem (" + e.message + ")."); process.exit(0); }

  console.log("\n-- as colunas que a tabela tem hoje, na nuvem --");
  console.log("  " + colunas.join(", "));

  // 2) as colunas que o robo manda: sai do proprio codigo, nao de uma lista escrita a mao
  const robo = fs.readFileSync(path.join(RAIZ, "scripts", "buildVrData.cjs"), "utf8");
  const pedaco = robo.slice(robo.indexOf("==FCXCOLS=="), robo.indexOf("sbUpsertFcx(linhas.slice"));
  if (!pedaco || pedaco.length < 100) {
    console.log("ERRO: nao achei o bloco que monta as linhas da frente de caixa no robo.");
    process.exit(1);
  }
  // tira os comentarios ANTES de procurar nome de coluna: comentario em portugues tem
  // "null:", "proposito:" e outras palavras seguidas de dois-pontos que virariam coluna falsa.
  const semComentario = pedaco.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  // so conta o que esta dentro de um linhas.push({ ... })
  const enviadas = new Set();
  for (const bloco of semComentario.matchAll(/linhas\.push\(\{([\s\S]*?)\}\);/g)) {
    for (const m of bloco[1].matchAll(/(?:^|[,{])\s*([a-z_][a-z0-9_]*)\s*:/g)) enviadas.add(m[1]);
  }

  console.log("\n-- toda coluna que o robo manda existe na tabela? --");
  const faltando = [];
  for (const c of [...enviadas].sort()) {
    if (!colunas.includes(c)) faltando.push(c);
  }
  eq("nenhuma coluna enviada pelo robo esta fora da tabela",
     faltando.length === 0 ? "nenhuma" : faltando.join(", "), "nenhuma");

  // 3) a chave do upsert tem que existir tambem, senao o PostgREST recusa tudo
  console.log("\n-- a chave do upsert (on_conflict) bate com a tabela? --");
  const mConf = robo.match(/frentecaixa_ocorrencias\?on_conflict=([a-z_,]+)/);
  const chave = mConf ? mConf[1].split(",") : [];
  eq("a chave do upsert foi encontrada no codigo", chave.length > 0, true);
  const chaveFora = chave.filter(c => !colunas.includes(c));
  eq("e toda coluna da chave existe na tabela",
     chaveFora.length === 0 ? "sim" : "FALTA: " + chaveFora.join(", "), "sim");
  eq("a chave e (tipo, venda_id, sequencia)", chave.join(","), "tipo,venda_id,sequencia");

  // 4) as colunas que a TELA le tambem tem que existir
  console.log("\n-- e as colunas que a tela do painel le? --");
  const tela = fs.readFileSync(path.join(RAIZ, "scripts", "demoDashboard.ts"), "utf8");
  // So as funcoes que percorrem as linhas VINDAS DA NUVEM. O resto do bloco tambem le
  // x.d e x.fat, mas esses sao do DIA[] que o painel ja carrega — nada a ver com a tabela.
  const corta = (nome) => {
    const i = tela.indexOf("function " + nome + "(");
    if (i < 0) return "";
    const j = tela.indexOf("\nfunction ", i + 10);
    return tela.slice(i, j < 0 ? i + 4000 : j);
  };
  const daNuvem = corta("fcxListaOcorrencias") + corta("fcxDetDesconto");
  const lidas = new Set();
  for (const m of daNuvem.matchAll(/\b[xy]\.([a-z_][a-z0-9_]*)/g)) lidas.add(m[1]);
  // mostra_nomes nao e coluna da tabela: e a resposta da funcao de leitura
  const telaFora = [...lidas].filter(c => !colunas.includes(c) && c !== "mostra_nomes");
  eq("nenhuma coluna lida pela tela esta fora da tabela",
     telaFora.length === 0 ? "nenhuma" : telaFora.join(", "), "nenhuma");

  console.log("\n" + ok + " OK, " + falhou + " falha(s)");
  process.exit(falhou ? 1 : 0);
})();
