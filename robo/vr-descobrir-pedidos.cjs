// DETETIVE do VR — descobre onde moram os PEDIDOS DE COMPRA.
//
// Para que serve: o Portal do Fornecedor tem uma etapa "Pedidos" que hoje fica
// vazia. Para enchê-la a gente precisa saber qual tabela do VR guarda os
// pedidos de compra (o que a loja encomendou do fornecedor) e os itens de cada
// um — produto, quantidade pedida, quantidade já entregue.
//
// COMO RODAR: num computador DENTRO da rede da loja (o mesmo onde o robô roda):
//
//     node scripts/vr-descobrir-pedidos.cjs
//
// SÓ LÊ. Não cria, não altera e não apaga nada no VR. Pode rodar à vontade.
// No fim ele imprime um relatório — copie tudo e mande de volta.
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

function readEnv() {
  for (const p of [path.join(__dirname, "..", ".env"), path.join(__dirname, ".env"), ".env", "../.env"]) {
    try { return fs.readFileSync(p, "utf8"); } catch (e) {}
  }
  return "";
}
const env = readEnv();
const g = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim() : ""; };

// As palavras que um pedido de compra costuma ter no nome da tabela.
// "pedido" sozinho pega pedido de VENDA também — por isso a segunda lista,
// que separa compra de venda depois de olhar as colunas.
const NOMES = ["pedido", "compra", "ordemcompra", "ordem_compra", "oc"];
const CHEIRO_COMPRA = ["fornecedor", "forn", "cnpjforn", "codforn", "entrega", "previsao"];
const CHEIRO_ITEM = ["produto", "qtd", "quantidade", "unitario", "item", "saldo", "entregue"];

function pontos(colunas, lista) {
  var n = 0;
  for (const c of colunas) for (const p of lista) if (c.toLowerCase().indexOf(p) >= 0) { n++; break; }
  return n;
}

(async () => {
  const c = new Client({
    host: g("PG_HOST"), port: +g("PG_PORT"), database: g("PG_DATABASE"),
    user: g("PG_USER"), password: g("PG_PASSWORD"), connectionTimeoutMillis: 20000,
  });

  console.log("Conectando em " + g("PG_HOST") + ":" + g("PG_PORT") + "/" + g("PG_DATABASE") + " ...");
  try {
    await c.connect();
  } catch (e) {
    console.log("\nNAO CONSEGUI CONECTAR: " + e.message);
    console.log("\nIsso quase sempre quer dizer que este computador nao esta na rede da loja.");
    console.log("Rode na mesma maquina onde o robo do painel roda.");
    process.exit(1);
  }
  console.log("Conectado.\n");

  // ------------------------------------------------------------------
  // 1) TODAS as tabelas que cheiram a pedido
  // ------------------------------------------------------------------
  const like = NOMES.map((n) => "lower(table_name) like '%" + n + "%'").join(" or ");
  const tabs = (await c.query(
    `select table_schema, table_name
       from information_schema.tables
      where table_schema not in ('pg_catalog','information_schema')
        and (${like})
      order by table_schema, table_name`
  )).rows;

  console.log("=================================================================");
  console.log("1) TABELAS COM CARA DE PEDIDO  (" + tabs.length + " encontradas)");
  console.log("=================================================================");
  if (!tabs.length) console.log("  nenhuma. Veja a lista completa no item 4 abaixo.");

  const achados = [];
  for (const t of tabs) {
    const nome = t.table_schema + "." + t.table_name;
    let cols = [];
    try {
      cols = (await c.query(
        `select column_name, data_type from information_schema.columns
          where table_schema=$1 and table_name=$2 order by ordinal_position`,
        [t.table_schema, t.table_name]
      )).rows;
    } catch (e) { continue; }

    const nomes = cols.map((x) => x.column_name);
    let linhas = null;
    try { linhas = (await c.query(`select count(*)::bigint n from ${nome}`)).rows[0].n; } catch (e) {}

    const pCompra = pontos(nomes, CHEIRO_COMPRA);
    const pItem = pontos(nomes, CHEIRO_ITEM);

    achados.push({ nome, linhas, cols: nomes, pCompra, pItem });

    console.log("\n--- " + nome + "  (" + (linhas === null ? "?" : linhas) + " linhas)");
    console.log("    cara de CABECALHO de compra: " + pCompra + " | cara de ITEM: " + pItem);
    console.log("    colunas: " + nomes.join(", "));
  }

  // ------------------------------------------------------------------
  // 2) as mais promissoras, com amostra de verdade
  // ------------------------------------------------------------------
  const melhores = achados
    .filter((a) => a.linhas === null || Number(a.linhas) > 0)
    .sort((a, b) => (b.pCompra + b.pItem) - (a.pCompra + a.pItem))
    .slice(0, 6);

  console.log("\n\n=================================================================");
  console.log("2) AS MAIS PROMISSORAS — 3 linhas de cada, para eu ver o formato");
  console.log("=================================================================");
  for (const a of melhores) {
    console.log("\n--- " + a.nome);
    try {
      const r = (await c.query(`select * from ${a.nome} limit 3`)).rows;
      r.forEach((x, i) => {
        // corta texto gigante: XML inteiro dentro de uma coluna atrapalha a leitura
        const enxuto = {};
        for (const k of Object.keys(x)) {
          const v = x[k];
          enxuto[k] = (typeof v === "string" && v.length > 90) ? v.slice(0, 90) + "…" : v;
        }
        console.log("  [" + (i + 1) + "] " + JSON.stringify(enxuto));
      });
      if (!r.length) console.log("  (vazia)");
    } catch (e) { console.log("  nao consegui ler: " + e.message); }
  }

  // ------------------------------------------------------------------
  // 3) o pedido aparece na nota de entrada? (o elo com o xPed)
  // ------------------------------------------------------------------
  console.log("\n\n=================================================================");
  console.log("3) ONDE O NUMERO DO PEDIDO APARECE EM OUTRAS TABELAS");
  console.log("=================================================================");
  try {
    const r = (await c.query(
      `select table_schema, table_name, column_name
         from information_schema.columns
        where table_schema not in ('pg_catalog','information_schema')
          and (lower(column_name) like '%pedido%' or lower(column_name) like '%numped%'
               or lower(column_name) like '%nrped%' or lower(column_name) like '%xped%')
        order by table_schema, table_name, column_name`
    )).rows;
    console.log("  " + r.length + " coluna(s):");
    r.forEach((x) => console.log("    " + x.table_schema + "." + x.table_name + "." + x.column_name));
  } catch (e) { console.log("  " + e.message); }

  // ------------------------------------------------------------------
  // 4) plano B: a lista inteira, se nada acima servir
  // ------------------------------------------------------------------
  console.log("\n\n=================================================================");
  console.log("4) TODAS AS TABELAS DO BANCO (plano B, caso nada acima sirva)");
  console.log("=================================================================");
  try {
    const r = (await c.query(
      `select table_schema, table_name from information_schema.tables
        where table_schema not in ('pg_catalog','information_schema')
        order by table_schema, table_name`
    )).rows;
    console.log("  " + r.length + " tabelas:");
    console.log("  " + r.map((x) => x.table_schema + "." + x.table_name).join("\n  "));
  } catch (e) { console.log("  " + e.message); }

  await c.end();
  console.log("\n\nPRONTO. Copie TUDO que apareceu acima e mande de volta.");
})().catch((e) => { console.log("ERRO: " + e.message); process.exit(1); });
