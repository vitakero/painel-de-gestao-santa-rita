// ==AVR-ROBO== ROBÔ DE AVARIAS (piloto, etapa 3,6) — VR SÓ LEITURA -> cálculo aprovado -> nuvem -> retrato do Painel.
//
//   node scripts/vr-sync-avarias.cjs                 -> rodada normal (chamada pelo buildVrData, bloco ==AVR==)
//   AVR_FORCAR=1 node scripts/vr-sync-avarias.cjs    -> carga do Mac: ignora janela, trava e vigia (a 1ª carga é grande)
//   node scripts/vr-sync-avarias.cjs --seco [--saida=resumo.json] [--pasta=dir]
//                                                    -> lê o VR, monta tudo, NÃO toca na nuvem, escreve um resumo
//
// O QUE FAZ (scripts/avarias/sincronizar.cjs): extrai do VR numa transação SÓ LEITURA (avarias/extrair-vr.cjs, que recusa
// tudo que não é SELECT/WITH), roda o cálculo APROVADO nas etapas 1 e 2 (avarias/montar-copias.cjs, etapa1.cjs — nenhuma
// segunda interpretação), monta as cópias de apoio da tela, grava na nuvem SÓ o que mudou (avarias/enviar-nuvem.cjs) e
// refaz o RETRATO que o Painel lê (avaria_retrato_iniciar -> _montar por consulta -> _publicar). Se qualquer passo falhar,
// o retrato não é publicado: o Painel continua com o anterior e mostra a hora dele (e o aviso de desatualizado).
// Antes de ler o VR, confere que a lista de consultas da nuvem (avaria_retrato_consultas) é a de tela/consultas.js
// (decisão D4: diferente = "o SQL do piloto na nuvem está desatualizado", nada gravado).
// Em avaria_sync: a hora boa de cada parte; a linha "avaria_rodada" com o erro de TODA falha que conseguir anotar (a tela
// mostra "a última tentativa falhou" na hora; decisão D1) e sem erro quando a rodada publica; e a linha "conferencia_js"
// com o resumo da conferência do cálculo (coluna detalhe; decisão D2).
//
// ESCREVE só: na nuvem (chave de serviço; só tabelas avaria_* e as 3 funções do retrato) e em output/:
//   output/last-avarias-sync.txt       a trava (instante da última TENTATIVA; gravada quando a tentativa começa)
//   output/avarias-enviado.json        o que a nuvem confirmou (impressão por linha) — some = o robô relê da nuvem
//   output/avarias-venda.json          a venda por mês × setor do dia (a consulta pesada; refeita 1 vez por dia)
//   output/avarias-conferencia.json    o resumo da conferência do próprio cálculo (o mesmo que sobe em conferencia_js)
//   output/avarias/extracao/           a extração da rodada (sobrescrita a cada rodada)
//
// JANELA E TRAVA: só das 06h às 21h de Caicó e no máximo 1 vez a cada 20 min (a frequência do projeto). O servidor do VR
// está em GMT: "hoje" é calculado aqui. NUNCA DERRUBA A RODADA DO ROBÔ: toda falha vai para o log e para
// avaria_sync (linha "avaria_rodada", ultimo_erro), e o processo sai com 0 (só o modo --seco, que é teste, sai com 1 quando falha). Um vigia interno
// encerra aos 200 s (o buildVrData mata aos 240 s e morrer pela mão dele não deixaria registro); depois de 170 s nenhum
// lote novo começa (o resto vai na próxima rodada, e o retrato só é publicado quando tudo coube).
"use strict";
const fs = require("fs"), path = require("path"), os = require("os");

const RAIZ = path.join(__dirname, "..");
const SAIDA = path.join(RAIZ, "output");
const ARQ_TRAVA = path.join(SAIDA, "last-avarias-sync.txt");
const ARQ_ESTADO = path.join(SAIDA, "avarias-enviado.json");
const ARQ_VENDA = path.join(SAIDA, "avarias-venda.json");
const ARQ_CONFERENCIA = path.join(SAIDA, "avarias-conferencia.json");
const PASTA_EXTRACAO = path.join(SAIDA, "avarias", "extracao");
const PRAZO_TOTAL_MS = 200000;           // vigia: o buildVrData mata aos 240 s
const PRAZO_LOTES_MS = 170000;           // depois disso nada novo começa
const SB_URL_PADRAO = "https://uabhsmculsfwzcrhyhch.supabase.co";   // o mesmo dos outros robôs, se o .env não tiver SUPABASE_URL

function lerEnv() { try { return fs.readFileSync(path.join(RAIZ, ".env"), "utf8"); } catch (e) { return ""; } }
function config() {
  const E = lerEnv(), g = (k) => { const m = E.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim() : (process.env[k] || ""); };
  let url = SB_URL_PADRAO;
  try { if (g("SUPABASE_URL")) url = new URL(g("SUPABASE_URL")).origin; } catch (e) { /* fica o padrão */ }
  return { sbUrl: url, sbChave: g("SUPABASE_SERVICE_KEY") };
}
const lerArq = (f) => { try { return fs.readFileSync(f, "utf8"); } catch (e) { return null; } };
const lerJsonArq = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return null; } };
const gravarArq = (f, txt) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, txt); };

// Para o TESTE (nunca usado pelo robô): AVR_SAIDA troca a pasta output/ por outra; AVR_NUVEM_URL aponta para um servidor
// de mentira LOCAL e exige AVR_NUVEM_CHAVE — a chave de serviço do .env nunca vai para um endereço que não é o Supabase;
// AVR_PRAZO_TOTAL_MS / AVR_PRAZO_LOTES_MS só podem ENCURTAR o vigia.
function caminhos() {
  const base = process.env.AVR_SAIDA ? path.resolve(process.env.AVR_SAIDA) : SAIDA;
  const em = (f) => path.join(base, path.relative(SAIDA, f));
  return { trava: em(ARQ_TRAVA), estado: em(ARQ_ESTADO), venda: em(ARQ_VENDA), conferencia: em(ARQ_CONFERENCIA), extracao: em(PASTA_EXTRACAO), base };
}
function destinoNuvem(cfg) {
  if (!process.env.AVR_NUVEM_URL) return { url: cfg.sbUrl, chave: cfg.sbChave };
  const u = new URL(process.env.AVR_NUVEM_URL);
  if (!/^(127\.0\.0\.1|localhost|\[::1\])$/.test(u.hostname)) throw new Error("AVR_NUVEM_URL só aceita servidor local de teste");
  if (!process.env.AVR_NUVEM_CHAVE) throw new Error("AVR_NUVEM_URL exige AVR_NUVEM_CHAVE (a chave do .env não vai para servidor de teste)");
  return { url: u.origin, chave: process.env.AVR_NUVEM_CHAVE };
}
function prazoCurto(nome, padrao) { const v = parseInt(process.env[nome] || "", 10); return Number.isFinite(v) && v > 0 && v < padrao ? v : padrao; }

async function principal(argv) {
  const S = require("./avarias/sincronizar.cjs");
  const E = require("./avarias/enviar-nuvem.cjs");
  const seco = argv.indexOf("--seco") >= 0, forcar = process.env.AVR_FORCAR === "1";
  const C = caminhos();
  const argSaida = argv.find((a) => a.indexOf("--saida=") === 0), argPasta = argv.find((a) => a.indexOf("--pasta=") === 0);
  const resumoArq = argSaida ? path.resolve(argSaida.slice(8)) : path.join(os.tmpdir(), "avarias-seco.json");
  const pasta = argPasta ? path.resolve(argPasta.slice(8)) : seco ? path.join(os.tmpdir(), "avarias-seco-extracao") : C.extracao;
  // o modo seco nem lê a chave da nuvem (não toca na nuvem)
  let destino = null;
  if (!seco) {
    try { destino = destinoNuvem(config()); } catch (e) { console.log("Avarias: " + e.message + " — pulando."); return 0; }
    if (!destino.chave) { console.log("Avarias: sem SUPABASE_SERVICE_KEY no .env — pulando."); return 0; }
  }

  const inicio = Date.now();
  const prazoTotal = prazoCurto("AVR_PRAZO_TOTAL_MS", PRAZO_TOTAL_MS), prazoLotes = prazoCurto("AVR_PRAZO_LOTES_MS", PRAZO_LOTES_MS);
  // o prazo "macio": depois dele nada novo começa (lote, página, consulta do retrato). Com AVR_FORCAR não há prazo.
  const prazo = (oque) => { if (!forcar && Date.now() - inicio > prazoLotes) throw new Error("tempo esgotado " + oque + "; o resto vai na próxima rodada"); };
  const estado = seco ? null : E.lerEstado(C.estado);
  const salvar = () => { if (estado) E.salvarEstado(C.estado, estado); };
  let envio = null;
  if (!seco) {
    const pedir = E.criarPedir(destino.url, destino.chave, 30000), pedirLongo = E.criarPedir(destino.url, destino.chave, 90000);
    envio = E.criarEnvio({ nuvem: E.criarNuvem(pedir, pedirLongo), estado, salvar, prazo, log: (s) => console.log(s) });
  }

  // O VIGIA: passou do prazo, registra e sai por conta própria antes de o buildVrData matar. Com AVR_FORCAR não há vigia.
  let vigia = null;
  if (!forcar) {
    vigia = setTimeout(async () => {
      const msg = "passou de " + Math.round(prazoTotal / 1000) + " s e foi encerrado pelo vigia; tenta na próxima rodada";
      console.log("Avarias: " + msg);
      if (envio) { try { await Promise.race([envio.registrarFalha(msg), new Promise((r) => setTimeout(r, 8000))]); } catch (e) { /* sai assim mesmo */ } }
      try { salvar(); } catch (e) { /* idem */ }
      process.exit(seco ? 1 : 0);
    }, prazoTotal);
    vigia.unref();
  }

  const r = await S.rodar({
    seco, forcar, envio, pasta, prazo,
    aceitarSumico: process.env.AVR_ACEITAR_SUMICO === "1",
    lerTrava: () => lerArq(C.trava),
    gravarTrava: (ms) => gravarArq(C.trava, String(ms)),
    lerVendaCache: () => lerJsonArq(seco && !process.env.AVR_VENDA_CACHE ? "" : process.env.AVR_VENDA_CACHE || C.venda),
    gravarVendaCache: (v) => gravarArq(C.venda, JSON.stringify(v)),
    gravarConferencia: (obj) => { if (!seco) gravarArq(C.conferencia, JSON.stringify(obj, null, 1)); },
    escreverResumo: (obj) => { gravarArq(resumoArq, JSON.stringify(obj, null, 1)); console.log("Avarias (seco): resumo em " + resumoArq); },
    log: (s) => console.log(s),
  });
  if (vigia) clearTimeout(vigia);
  return !r.ok && seco ? 1 : 0;
}

module.exports = { principal, caminhos, destinoNuvem, config, PRAZO_TOTAL_MS, PRAZO_LOTES_MS, ARQ_TRAVA, ARQ_ESTADO, ARQ_VENDA, ARQ_CONFERENCIA, PASTA_EXTRACAO };

if (require.main === module) {
  const seco = process.argv.indexOf("--seco") >= 0;
  principal(process.argv.slice(2))
    .then((cod) => process.exit(cod))
    .catch((e) => { console.log("Avarias: falhou, painel segue normal — " + (e && e.message)); process.exit(seco ? 1 : 0); });
}
