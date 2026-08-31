// O NOSSO PREÇO DE VENDA, para a tela de comparação com os concorrentes.
//
// Traz do VR o último preço que saiu no CAIXA de cada produto que a loja está acompanhando —
// não o preço de etiqueta. É de propósito: o app Menor Preço Brasil, de onde vêm os preços
// dos concorrentes, também mostra o que saiu no caixa deles. Preço de venda contra preço de
// venda; comparar etiqueta com caixa daria diferença falsa toda vez que houvesse promoção.
//
// SÓ OS PRODUTOS ACOMPANHADOS. A loja tem 47 mil produtos e a lista de acompanhamento tem
// algumas dezenas — ler os 47 mil aqui seria carregar o banco todo dia para usar 0,1% dele.
// Se a lista estiver vazia, este script não pergunta nada ao VR e vai embora.
//
//   node scripts/vr-sync-conc-precos.cjs
const { Client } = require("pg");
const https = require("https");
const fs = require("fs");
const path = require("path");

const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8");
const g = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim().replace(/[^\x21-\x7e]/g, "") : ""; };
const SB_URL = g("SUPABASE_URL").replace(/\/+$/, "");
const SB_KEY = g("SUPABASE_SERVICE_KEY");
const SB_HOST = SB_URL.replace(/^https?:\/\//, "");
// quantos dias para trás procurar a última venda. 60 dias cobre até produto de giro lento;
// o que não vendeu em 60 dias fica sem preço, e a tela diz isso em vez de inventar.
const DIAS = +(process.env.DIAS || 60);

function sb(metodo, caminho, corpo) {
  return new Promise((res, rej) => {
    const body = corpo ? JSON.stringify(corpo) : null;
    const req = https.request({
      host: SB_HOST, path: caminho, method: metodo,
      headers: Object.assign({ apikey: SB_KEY, Authorization: "Bearer " + SB_KEY },
        body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body),
                 Prefer: "resolution=merge-duplicates,return=minimal" } : {})
    }, r => { let d = ""; r.on("data", c => d += c); r.on("end", () => r.statusCode < 300 ? res(d) : rej(new Error("HTTP " + r.statusCode + " " + d))); });
    req.on("error", rej); if (body) req.write(body); req.end();
  });
}

(async () => {
  if (!SB_KEY) { console.log("!! Falta SUPABASE_SERVICE_KEY no .env"); process.exit(1); }

  // 1) quais produtos a loja está acompanhando
  const lista = JSON.parse(await sb("GET", "/rest/v1/conc_produtos?select=codigobarras&ativo=eq.true"));
  const codigos = lista.map(x => String(x.codigobarras || "").replace(/[^0-9]/g, "")).filter(Boolean);
  if (!codigos.length) { console.log("Nenhum produto acompanhado — nada a fazer."); return; }
  console.log("Produtos acompanhados: " + codigos.length);

  // 2) o último preço de venda de cada um, no VR
  const c = new Client({ host: g("PG_HOST"), port: +g("PG_PORT"), database: g("PG_DATABASE"),
                         user: g("PG_USER"), password: g("PG_PASSWORD"), ssl: false, statement_timeout: 120000 });
  await c.connect();

  // CUPOM CANCELADO NÃO CONTA — e o cancelamento mora em DOIS lugares: no item e no cupom.
  // Filtrar só o item deixa passar o cupom inteiro cancelado, e foi assim que a venda por
  // setor ficou 0,8% acima do relatório do VR até 26/08/2026.
  const SQL = `
    SELECT DISTINCT ON (pa.codigobarras::text)
           pa.codigobarras::text cod,
           p.descricaocompleta   nome,
           v.precovenda          preco,
           v.data                data
      FROM pdv.vendaitem v
      JOIN pdv.venda cp        ON cp.id = v.id_venda
      JOIN produto p           ON p.id::text = v.id_produto::text
      JOIN produtoautomacao pa ON pa.id_produto::text = p.id::text
     WHERE v.cancelado = false AND cp.cancelado = false
       AND v.precovenda > 0
       AND v.data >= current_date - $1::int
       AND pa.codigobarras::text = ANY($2::text[])
     ORDER BY pa.codigobarras::text, v.data DESC, v.id DESC`;
  const r = await c.query(SQL, [DIAS, codigos]);
  await c.end();

  if (!r.rows.length) { console.log("Nenhuma venda encontrada nos últimos " + DIAS + " dias."); return; }

  const agora = new Date().toISOString();
  const linhas = r.rows.map(x => ({
    codigobarras: String(x.cod),
    nome: x.nome || "",
    meu_preco: Math.round(Number(x.preco || 0) * 100) / 100,
    meu_preco_em: new Date(x.data).toISOString().slice(0, 10),
    meu_preco_visto: agora
  }));

  // NÃO MEXO NO 'ativo' NEM NO 'criado_em': quem manda nesses é a tela, não o robô.
  await sb("POST", "/rest/v1/conc_produtos?on_conflict=codigobarras", linhas);

  const semPreco = codigos.length - linhas.length;
  console.log("Preço atualizado em " + linhas.length + " produto(s).");
  if (semPreco > 0) console.log("  " + semPreco + " sem venda nos últimos " + DIAS + " dias — ficam sem preço na tela (e ela avisa).");
})().catch(e => { console.log("ERRO: " + e.message); process.exit(1); });
