// GALPÕES — mudança local esperando envio não é atropelada pela nuvem (==GLFILA==), 30/09/2026.
//
// A queixa: "estou colocando pra remover o comprovante mas não está removendo". Na nuvem, o
// "pago" tinha sido desfeito e o comprovante continuava lá. Foi uma corrida: o desfazer salvou,
// a nuvem avisou a tela, e a RECARGA desse aviso chegou antes do envio da remoção do comprovante
// (que espera 700 ms). A cópia da nuvem, ainda com o comprovante, apagou a remoção.
//
// Este teste EXTRAI do painel gerado o salvar/enviar/recarregar dos galpões e RODA, com um relógio
// de mentira e uma nuvem de mentira que avisa a tela depois de cada gravação (como o aviso
// instantâneo de verdade). Refaz a sequência dele e cobra que a remoção chegue na nuvem.
//   node scripts/testes/galpoes-fila.test.cjs
const fs = require("fs");
const path = require("path");

const HTML = fs.readFileSync(path.join(__dirname, "..", "..", "output", "index.html"), "utf8");
function pega(nome) {
  const i = HTML.indexOf("function " + nome + "(");
  if (i < 0) throw new Error("não achei " + nome + " no output/index.html (rode o build antes)");
  let n = 0, j = HTML.indexOf("{", i);
  for (let k = j; k < HTML.length; k++) { if (HTML[k] === "{") n++; else if (HTML[k] === "}") { n--; if (!n) return HTML.slice(i, k + 1); } }
  throw new Error("função " + nome + " sem fim");
}
const linha = ini => { const i = HTML.indexOf(ini); if (i < 0) throw new Error("não achei: " + ini); return HTML.slice(i, HTML.indexOf("\n", i)); };

let ok = 0, falhou = 0;
function vale(nome, cond, det) { console.log((cond ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + det); cond ? ok++ : falhou++; }

async function cenario() {
  // relógio de mentira
  let agora = 0, fila = [], seq = 0;
  const setT = (fn, ms) => { const id = ++seq; fila.push({ id, quando: agora + ms, fn }); return id; };
  const clrT = id => { fila = fila.filter(t => t.id !== id); };
  const esvazia = () => new Promise(r => setImmediate(r));
  async function passar(ms) {
    const fim = agora + ms;
    for (;;) { await esvazia(); fila.sort((a, b) => a.quando - b.quando); const t = fila[0];
      if (!t || t.quando > fim) break; fila.shift(); agora = t.quando; t.fn(); await esvazia(); }
    agora = fim;
  }
  // nuvem de mentira: guarda as linhas; depois de cada gravação, avisa a tela (o aviso instantâneo)
  const nuvem = { linhas: [], aoMudar: null };
  const sb = { from() { return {
    upsert(rows) { return { then(ok) { setT(() => { nuvem.linhas = JSON.parse(JSON.stringify(rows)); ok({ error: null }); if (nuvem.aoMudar) nuvem.aoMudar(); }, 120); } }; },
    select() { const copia = JSON.parse(JSON.stringify(nuvem.linhas)); return { then(ok) { setT(() => ok({ data: copia, error: null }), 150); } }; },
  }; } };
  const f = new Function("setTimeout", "clearTimeout", "window", "localStorage", "sb", "Promise",
    linha("var glCloudOK=false") + "\n" + linha("var glPushando=false") + "\nvar galpoesG=[];\n" +
    ["glFimDoEnvio", "glSave", "glCloudPush", "glCloudLoad", "glRowFromG", "glGFromRow", "glCompsParaNuvem", "glSubirArquivos"].map(pega).join("\n") +
    "\nfunction glSB(){ return sb; } function glPodeVer(){ return true; } function renderGalpoes(){} function renderPlanta(){} function uiConfirm(){ return Promise.resolve(false); }" +
    "\nfunction pxUploadDataUrl(){ return Promise.resolve(''); }" +
    "\nreturn { glSave, glCloudLoad, get g(){ return galpoesG; }, set g(v){ galpoesG=v; }, pronto(){ glCloudOK=true; } };")(
    setT, clrT, { __PERFIL: { is_master: true } }, { setItem() {}, getItem() { return null; }, removeItem() {} }, sb, Promise);
  // o aviso instantâneo da tela: recarrega 700 ms depois de cada gravação (igual ao glRealtime)
  let deb = null; nuvem.aoMudar = () => { clrT(deb); deb = setT(() => f.glCloudLoad(), 700); };
  return { f, nuvem, passar };
}

(async () => {
  const { f, nuvem, passar } = await cenario();
  const K = "2026-10-05", comp = { arquivo: "https://x/galpao_g1_comp_2026-10-05.pdf", nome: "pix.pdf" };
  nuvem.linhas = [{ id: "g1", numero: "1470I", dia_pag: 5, abertura: "2026-09-29", manuais: { [K]: "autorizado" }, comprovantes: { [K]: comp } }];
  f.glCloudLoad(); await passar(500); f.pronto();
  vale("começa como ele estava: pago e com comprovante", !!f.g[0].comprovantes[K] && f.g[0].manuais[K] === "autorizado", "pago + comprovante");

  // 1) ele desfaz o "Pago"
  delete f.g[0].manuais[K]; f.glSave();
  await passar(1000);                      // o envio sai (700 ms) e grava; a nuvem avisa; a recarga fica marcada pra +700 ms
  // 2) logo em seguida, ele remove o comprovante — antes da recarga do aviso anterior
  delete f.g[0].comprovantes[K]; delete f.g[0].manuais[K]; f.glSave();
  await passar(5000);                      // tudo o que estava na fila acontece
  const naNuvem = nuvem.linhas[0].comprovantes || {};
  vale("a remoção do comprovante CHEGOU na nuvem", !naNuvem[K], naNuvem[K] ? "o comprovante VOLTOU (defeito)" : "removido");
  vale("e a tela também ficou sem ele", !(f.g[0].comprovantes || {})[K], (f.g[0].comprovantes || {})[K] ? "voltou na tela" : "sem comprovante");

  // 3) uma mudança feita por OUTRO computador continua chegando (a espera não trava a recarga pra sempre)
  nuvem.linhas[0].obs = "mudado em outro computador"; nuvem.aoMudar();
  await passar(3000);
  vale("mudança de outro computador continua aparecendo", f.g[0].obs === "mudado em outro computador", f.g[0].obs || "(não chegou)");

  console.log("\n  " + ok + " ok, " + falhou + " falha(s).\n");
  process.exit(falhou ? 1 : 0);
})();
