// CONFERIR SETOR — descobre por que a minha conta da ~0,5% a mais que o relatorio do VR.
//
// RODA DENTRO DA LOJA (o Postgres do VR so responde na rede de la). Pelo AnyDesk:
//     cd  <pasta do robo>
//     node scripts\vr-conferir-setor.cjs
//
// SO LE o VR. A unica coisa que ele escreve e o RESULTADO, num arquivo do GitHub
// (diagnostico/vr-setor.json), pra eu ler daqui sem voce copiar nada.
//
// O que ele faz: calcula o MESMO numero de varias maneiras diferentes e mostra qual
// delas bate com o relatorio. O alvo esta em ALVOS abaixo — sao numeros que o Victor
// ja conferiu no relatorio "Estatisticas" do VR em 25/08/2026.
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
const https = require("https");

const root = path.join(__dirname, "..");
const env = fs.readFileSync(path.join(root, ".env"), "utf8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim() : ""; };

// Bebidas = mercadologico1 do setor "NOVO BEBIDAS". Descoberto em tempo de execucao.
const ALVOS = {
  "2026-07": 55842,      // julho/2026, Bebidas, do relatorio do VR
  "2026-01": 51681,
  "2025-07": 64129,
  "jan-jul 2026": 372813 // soma de janeiro a julho de 2026
};

const linhas = [];
const diz = (t) => { console.log(t); linhas.push(t); };

async function tenta(c, nome, sql) {
  try {
    const r = await c.query(sql);
    return { nome, ok: true, linhas: r.rows };
  } catch (e) {
    return { nome, ok: false, erro: e.message.slice(0, 200) };
  }
}

(async () => {
  const c = new Client({ host: get("PG_HOST"), port: +get("PG_PORT"), database: get("PG_DATABASE"),
    user: get("PG_USER"), password: get("PG_PASSWORD"), connectionTimeoutMillis: 30000, query_timeout: 600000 });
  await c.connect();
  diz("conectado no VR. investigando...\n");

  const saida = { quando: new Date().toISOString(), alvos: ALVOS, provas: [] };

  // 1) qual e o codigo do setor Bebidas
  const s = await tenta(c, "codigo do setor Bebidas",
    "SELECT mercadologico1 m1, descricao FROM public.mercadologico WHERE nivel=1 AND descricao ILIKE '%BEBIDA%'");
  saida.provas.push(s);
  if (!s.ok || !s.linhas.length) { diz("nao achei o setor Bebidas. parando."); await c.end(); return; }
  const M1 = s.linhas[0].m1;
  diz("setor Bebidas = mercadologico1 " + M1 + " (" + s.linhas[0].descricao + ")\n");

  // 2) que colunas existem — a resposta costuma estar aqui
  for (const [nome, tab] of [["colunas de pdv.vendaitem", "vendaitem"], ["colunas de pdv.venda", "venda"]]) {
    saida.provas.push(await tenta(c, nome,
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_schema='pdv' AND table_name='${tab}' ORDER BY ordinal_position`));
  }
  // 3) existe tabela de devolucao?
  saida.provas.push(await tenta(c, "tabelas com nome de devolucao/troca",
    `SELECT table_schema, table_name FROM information_schema.tables
     WHERE table_name ILIKE '%devol%' OR table_name ILIKE '%troca%' ORDER BY 1,2`));

  // 4) O MESMO NUMERO, DE VARIAS MANEIRAS
  const base = (extra, campo) => `
    SELECT to_char(date_trunc('month',v.data),'YYYY-MM') mes, SUM(${campo || "v.quantidade"}) q
    FROM pdv.vendaitem v
    JOIN public.produto p ON p.id = v.id_produto
    ${extra.join(" ")}
    WHERE p.mercadologico1 = ${M1}
      AND v.data >= '2025-01-01' AND v.data < '2026-08-01'
      ${extra.filtro || ""}
    GROUP BY 1 ORDER BY 1`;

  const jeitos = [
    ["A) como esta hoje (cancelado=false)", Object.assign([], { filtro: "AND v.cancelado = false" })],
    ["B) sem filtrar cancelado", Object.assign([], { filtro: "" })],
    ["C) so quantidade positiva", Object.assign([], { filtro: "AND v.cancelado = false AND v.quantidade > 0" })],
    ["D) cupom nao cancelado tambem (join em venda)",
      Object.assign(["JOIN pdv.venda c ON c.id = v.id_venda"], { filtro: "AND v.cancelado = false AND c.cancelado = false" })],
    ["E) so loja 1 (se a coluna existir)",
      Object.assign(["JOIN pdv.venda c ON c.id = v.id_venda"], { filtro: "AND v.cancelado = false AND c.id_loja = 1" })]
  ];
  for (const [nome, extra] of jeitos) saida.provas.push(await tenta(c, nome, base(extra)));

  await c.end();

  // 5) mostra na tela quem bate
  diz("BEBIDAS — cada jeito de contar, contra o relatorio do VR:\n");
  for (const p of saida.provas) {
    if (!p.nome.startsWith("A)") && !p.nome.startsWith("B)") && !p.nome.startsWith("C)")
      && !p.nome.startsWith("D)") && !p.nome.startsWith("E)")) continue;
    if (!p.ok) { diz("  " + p.nome + " -> ERRO: " + p.erro); continue; }
    const jul = p.linhas.find(x => x.mes === "2026-07");
    const jan = p.linhas.find(x => x.mes === "2026-01");
    const soma = p.linhas.filter(x => x.mes >= "2026-01" && x.mes <= "2026-07").reduce((a, x) => a + Number(x.q), 0);
    const d = (v, alvo) => v == null ? "  —  " : (((Number(v) / alvo - 1) * 100).toFixed(2) + "%");
    diz("  " + p.nome);
    diz("      jul/2026: " + (jul ? Math.round(jul.q) : "—") + "   (alvo 55.842, dif " + d(jul && jul.q, 55842) + ")");
    diz("      jan/2026: " + (jan ? Math.round(jan.q) : "—") + "   (alvo 51.681, dif " + d(jan && jan.q, 51681) + ")");
    diz("      jan-jul:  " + Math.round(soma) + "  (alvo 372.813, dif " + d(soma, 372813) + ")");
  }
  diz("\nO jeito com dif 0,00% nos tres e o que o relatorio do VR usa.");

  saida.resumo = linhas;

  // 6) manda o resultado pro GitHub, pra eu ler de fora da loja
  const TOKEN = get("GITHUB_TOKEN");
  if (!TOKEN) { diz("\n(sem GITHUB_TOKEN — o resultado ficou so aqui na tela)"); return; }
  const corpo = Buffer.from(JSON.stringify(saida, null, 1), "utf8").toString("base64");
  const url = "/repos/vitakero/painel-de-gestao-santa-rita/contents/diagnostico/vr-setor.json";
  const req = (metodo, dados) => new Promise((res) => {
    const b = dados ? JSON.stringify(dados) : null;
    const r = https.request({ host: "api.github.com", path: url, method: metodo,
      headers: { Authorization: "Bearer " + TOKEN, "User-Agent": "santa-rita", Accept: "application/vnd.github+json",
        ...(b ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(b) } : {}) } },
      (x) => { let d = ""; x.on("data", (k) => d += k); x.on("end", () => res({ status: x.statusCode, corpo: d })); });
    r.on("error", () => res({ status: 0, corpo: "" }));
    if (b) r.write(b); r.end();
  });
  const atual = await req("GET");
  let sha; try { sha = JSON.parse(atual.corpo).sha; } catch (e) {}
  const put = await req("PUT", { message: "diagnostico: conferir setor x relatorio do VR", content: corpo, ...(sha ? { sha } : {}) });
  diz(put.status < 300 ? "\n>>> RESULTADO ENVIADO. Pode avisar o Claude que ele le daqui." : "\n>>> nao consegui enviar (HTTP " + put.status + ") — copie a tela e mande pro Claude.");
})().catch((e) => { console.log("ERRO: " + e.message); });
