// DETETIVE 2 do VR — as 4 respostas que faltam para eu escrever a sincronização
// dos pedidos de compra.
//
// O primeiro detetive já achou o principal: public.pedido (21.733 linhas),
// public.pedidoitem (299.446) e a coluna quantidadeatendida, que é o saldo.
// Falta saber: qual situação quer dizer "em aberto", como o fornecedor do VR
// se liga ao CNPJ, e qual id_loja é a Santa Rita.
//
// COMO RODAR, dentro da loja:   node scripts/vr-descobrir-pedidos2.cjs
// SÓ LÊ. Copie tudo e mande de volta.
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

function curto(x) {
  const o = {};
  for (const k of Object.keys(x)) {
    const v = x[k];
    o[k] = (typeof v === "string" && v.length > 60) ? v.slice(0, 60) + "…" : v;
  }
  return o;
}

(async () => {
  const c = new Client({
    host: g("PG_HOST"), port: +g("PG_PORT"), database: g("PG_DATABASE"),
    user: g("PG_USER"), password: g("PG_PASSWORD"), connectionTimeoutMillis: 20000,
  });
  try { await c.connect(); }
  catch (e) {
    console.log("NAO CONSEGUI CONECTAR: " + e.message);
    console.log("Rode na mesma maquina onde o robo do painel roda.");
    process.exit(1);
  }
  console.log("Conectado.\n");

  async function bloco(titulo, sql, params) {
    console.log("\n=================================================================");
    console.log(titulo);
    console.log("=================================================================");
    try {
      const r = (await c.query(sql, params || [])).rows;
      if (!r.length) return console.log("  (nada)");
      r.forEach((x) => console.log("  " + JSON.stringify(curto(x))));
    } catch (e) { console.log("  ERRO: " + e.message); }
  }

  // 1) qual situacao quer dizer "em aberto"
  await bloco("1) AS SITUACOES DE PEDIDO", "select * from public.situacaopedido order by id");
  await bloco("1b) QUANTOS PEDIDOS EM CADA SITUACAO (e de qual loja)",
    `select p.id_situacaopedido, s.descricao, p.id_loja, count(*)::bigint pedidos,
            max(p.dataentrega) as entrega_mais_recente
       from public.pedido p
       left join public.situacaopedido s on s.id = p.id_situacaopedido
      group by 1,2,3 order by 3,1`);

  // 2) quem e o fornecedor: preciso do CNPJ para casar com o nosso cadastro
  await bloco("2) COLUNAS DA TABELA fornecedor",
    `select column_name, data_type from information_schema.columns
      where table_schema='public' and table_name='fornecedor' order by ordinal_position`);
  await bloco("2b) UM FORNECEDOR DE EXEMPLO (com pedido recente)",
    `select f.* from public.fornecedor f
      where f.id in (select id_fornecedor from public.pedido order by dataentrega desc limit 3)
      limit 3`);

  // 3) qual loja e a Santa Rita
  await bloco("3) AS LOJAS", `select * from public.loja order by id`);

  // 4) COMO FICA UM PEDIDO EM ABERTO DE VERDADE
  //    (é esta consulta que vai virar a sincronização)
  await bloco("4) PEDIDOS COM SALDO A ENTREGAR — os 5 mais recentes",
    `select p.id, p.id_loja, p.dataentrega, p.valortotal,
            s.descricao as situacao,
            f.razaosocial as fornecedor_nome,
            count(i.id)::int  as itens,
            count(*) filter (where i.quantidade > coalesce(i.quantidadeatendida,0))::int as itens_com_saldo,
            sum(i.quantidade - coalesce(i.quantidadeatendida,0)) as qtd_a_entregar
       from public.pedido p
       join public.pedidoitem i on i.id_pedido = p.id
       left join public.situacaopedido s on s.id = p.id_situacaopedido
       left join public.fornecedor f on f.id = p.id_fornecedor
      group by p.id, p.id_loja, p.dataentrega, p.valortotal, s.descricao, f.razaosocial
     having count(*) filter (where i.quantidade > coalesce(i.quantidadeatendida,0)) > 0
      order by p.dataentrega desc
      limit 5`);

  // 5) o produto, para mostrar o nome na tela do fornecedor
  await bloco("5) COLUNAS DA TABELA produto (so as que interessam)",
    `select column_name, data_type from information_schema.columns
      where table_schema='public' and table_name='produto'
        and (column_name ilike '%descricao%' or column_name ilike '%codigo%'
             or column_name ilike '%ean%' or column_name ilike '%barra%'
             or column_name = 'id' or column_name ilike '%unidade%')
      order by ordinal_position`);

  await c.end();
  console.log("\n\nPRONTO. Copie TUDO e mande de volta.");
})().catch((e) => { console.log("ERRO: " + e.message); process.exit(1); });
