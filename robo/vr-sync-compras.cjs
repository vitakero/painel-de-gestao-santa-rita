// SYNC: COMPRA × VENDA — tira o retrato semanal do VR e grava em compras_retrato.
// Roda DENTRO da rede da loja (passo 1.95 do robo.bat): node scripts/vr-sync-compras.cjs
// Só LÊ o VR; ESCREVE só na nuvem, com a chave de serviço.
//
// EM TODA RODADA DO ROBÔ (5–13 min): o dono pediu o número o mais perto possível do
// "agora" (24/09/2026). A consulta de venda leva ≈7 s no VR. A trava de 4 min só existe
// para robô duplicado não tirar dois retratos seguidos. CXV_FORCAR=1 ignora a trava.
//
// CXV_ARQUIVO=<json> manda um retrato já extraído (usado do Mac, fora da rede da loja).
//
// NUNCA DERRUBA A RODADA: qualquer falha (VR fora, tabela ainda não criada, nuvem fora)
// é avisada e o script sai com 0 — o painel continua sendo gerado e publicado.
const fs = require("fs"), path = require("path"), https = require("https");
const RAIZ = path.join(__dirname, "..");
const INTERVALO_MIN = 4;
const MARCA = path.join(RAIZ, "output", "last-compras-run.txt");
function env() { try { return fs.readFileSync(path.join(RAIZ, ".env"), "utf8"); } catch (e) { return ""; } }
const E = env(), g = (k) => { const m = E.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim() : ""; };
const SB_HOST = "uabhsmculsfwzcrhyhch.supabase.co", SB_KEY = g("SUPABASE_SERVICE_KEY");

function gravar(linha) {
  const corpo = JSON.stringify([linha]);
  return new Promise((resolve) => {
    const req = https.request({ host: SB_HOST, path: "/rest/v1/compras_retrato?on_conflict=chave", method: "POST", timeout: 30000,
      headers: { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY, "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal", "Content-Length": Buffer.byteLength(corpo) } }, (res) => {
      let t = ""; res.on("data", (d) => (t += d)); res.on("end", () => resolve({ status: res.statusCode, corpo: t }));
    });
    req.on("timeout", () => req.destroy(new Error("a nuvem não respondeu em 30 s")));
    req.on("error", (e) => resolve({ status: 0, corpo: e.message }));
    req.end(corpo);
  });
}

(async () => {
  if (!SB_KEY) { console.log("Compra × Venda: sem SUPABASE_SERVICE_KEY no .env — pulando."); return; }
  if (!process.env.CXV_ARQUIVO) try {
    const ult = +fs.readFileSync(MARCA, "utf8");
    if (!process.env.CXV_FORCAR && Date.now() - ult < INTERVALO_MIN * 60e3) {
      console.log(`Compra × Venda: último retrato há ${Math.round((Date.now() - ult) / 60e3)} min (tira a cada ${INTERVALO_MIN}) — pulando.`); return;
    }
  } catch (e) { /* primeira vez */ }
  let dados;
  if (process.env.CXV_ARQUIVO) {
    // Do Mac, fora da loja: manda um retrato já extraído (ex.: .previa/cxv-dados.json).
    dados = JSON.parse(fs.readFileSync(path.resolve(process.env.CXV_ARQUIVO), "utf8"));
    dados.pedidos = dados.pedidos.filter((p) => p.classe === "comprometido" || p.classe === "futuro");
    console.log(`Compra × Venda: usando o arquivo ${process.env.CXV_ARQUIVO} (tirado em ${dados.gerado}).`);
  } else {
    const { extrair } = require(path.join(__dirname, "compras-x-venda", "extrair-vr.cjs"));
    dados = await extrair();
  }
  const r = await gravar({ chave: "atual", dados, gerado_em: dados.gerado });
  if (r.status >= 200 && r.status < 300) {
    if (!process.env.CXV_ARQUIVO) { fs.mkdirSync(path.dirname(MARCA), { recursive: true }); fs.writeFileSync(MARCA, String(Date.now())); }
    console.log(`Compra × Venda: retrato gravado na nuvem (${(JSON.stringify(dados).length / 1024).toFixed(0)} KB).`);
  } else if (/compras_retrato|PGRST205|42P01/.test(r.corpo)) {
    console.log("Compra × Venda: a tabela compras_retrato ainda não existe — falta rodar sql/compras_x_venda.sql no Supabase.");
  } else {
    console.log(`Compra × Venda: a nuvem recusou (${r.status}): ${r.corpo.slice(0, 300)}`);
  }
})().catch((e) => console.log("Compra × Venda: falhou, painel segue normal —", e.message));
