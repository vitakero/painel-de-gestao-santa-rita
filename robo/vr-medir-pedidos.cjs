// MEDIDOR: quantos pedidos de compra ainda têm saldo, por idade.
//
// Serve para escolher, olhando a realidade da Santa Rita, quanto tempo um
// pedido continua valendo para o fornecedor ver no portal. Sem isso a escolha
// seria palpite meu.
//
// Só olha a LOJA 01 e só pedidos FINALIZADO — DIGITANDO e DIGITADO são
// rascunhos do comprador e não podem sair do prédio.
//
// COMO RODAR, dentro da loja:  node scripts/vr-medir-pedidos.cjs
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

// O pedido "tem saldo" quando algum item ainda não foi entregue por inteiro.
const COM_SALDO = `
  exists (select 1 from public.pedidoitem i
           where i.id_pedido = p.id
             and i.quantidade > coalesce(i.quantidadeatendida, 0))`;

(async () => {
  const c = new Client({
    host: g("PG_HOST"), port: +g("PG_PORT"), database: g("PG_DATABASE"),
    user: g("PG_USER"), password: g("PG_PASSWORD"), connectionTimeoutMillis: 20000,
  });
  try { await c.connect(); }
  catch (e) { console.log("NAO CONSEGUI CONECTAR: " + e.message); process.exit(1); }
  console.log("Conectado. Hoje e " + new Date().toISOString().slice(0, 10) + "\n");

  async function bloco(t, sql) {
    console.log("\n=================================================================");
    console.log(t);
    console.log("=================================================================");
    try {
      const r = (await c.query(sql)).rows;
      if (!r.length) return console.log("  (nada)");
      r.forEach((x) => console.log("  " + JSON.stringify(x)));
    } catch (e) { console.log("  ERRO: " + e.message); }
  }

  await bloco("1) PEDIDOS COM SALDO, POR IDADE DA COMPRA  <<< A RESPOSTA ESTA AQUI",
   `select case
             when p.datacompra >= current_date -  30 then 'a) ate 30 dias'
             when p.datacompra >= current_date -  60 then 'b) 31 a 60'
             when p.datacompra >= current_date -  90 then 'c) 61 a 90'
             when p.datacompra >= current_date - 120 then 'd) 91 a 120'
             when p.datacompra >= current_date - 180 then 'e) 121 a 180'
             when p.datacompra >= current_date - 365 then 'f) 181 a 365'
             else                                        'g) mais de um ano'
           end as idade_da_compra,
           count(*)::int as pedidos,
           count(distinct p.id_fornecedor)::int as fornecedores,
           round(sum(p.valortotal))::bigint as valor_total
      from public.pedido p
     where p.id_loja = 1 and p.id_situacaopedido = 2 and ${COM_SALDO}
     group by 1 order by 1`);

  await bloco("2) O MESMO, MAS SO O QUE FALTA ENTREGAR (nao o pedido inteiro)",
   `select case
             when p.datacompra >= current_date -  30 then 'a) ate 30 dias'
             when p.datacompra >= current_date -  60 then 'b) 31 a 60'
             when p.datacompra >= current_date -  90 then 'c) 61 a 90'
             when p.datacompra >= current_date - 120 then 'd) 91 a 120'
             when p.datacompra >= current_date - 180 then 'e) 121 a 180'
             when p.datacompra >= current_date - 365 then 'f) 181 a 365'
             else                                        'g) mais de um ano'
           end as idade_da_compra,
           count(distinct p.id)::int as pedidos,
           sum(i.quantidade - coalesce(i.quantidadeatendida,0))::numeric(14,0) as qtd_falta,
           round(sum((i.quantidade - coalesce(i.quantidadeatendida,0)) * i.custocompra))::bigint as valor_falta
      from public.pedido p
      join public.pedidoitem i on i.id_pedido = p.id
                              and i.quantidade > coalesce(i.quantidadeatendida,0)
     where p.id_loja = 1 and p.id_situacaopedido = 2
     group by 1 order by 1`);

  // Um pedido pode estar quase inteiro entregue e sobrar uma caixa. Isso não é
  // "pedido em aberto" — é resto. Saber quanto disso existe muda a conta.
  await bloco("3) DOS RECENTES (ate 120 dias): SOBRA POUCA OU FALTA MUITA?",
   `select case
             when x.pct_falta >= 90 then 'a) quase nada entregue (90-100% falta)'
             when x.pct_falta >= 50 then 'b) metade (50-89%)'
             when x.pct_falta >= 10 then 'c) parcial (10-49%)'
             else                        'd) so um resto (menos de 10%)'
           end as quanto_falta, count(*)::int as pedidos
      from (
        select p.id,
               100.0 * sum(i.quantidade - coalesce(i.quantidadeatendida,0)) / nullif(sum(i.quantidade),0) as pct_falta
          from public.pedido p
          join public.pedidoitem i on i.id_pedido = p.id
         where p.id_loja = 1 and p.id_situacaopedido = 2
           and p.datacompra >= current_date - 120 and ${COM_SALDO}
         group by p.id
      ) x
     group by 1 order by 1`);

  await bloco("4) QUANTOS FORNECEDORES TERIAM PEDIDO PARA VER, POR JANELA",
   `select '30 dias'  as janela, count(distinct p.id_fornecedor)::int as fornecedores, count(*)::int as pedidos
      from public.pedido p where p.id_loja=1 and p.id_situacaopedido=2
       and p.datacompra >= current_date-30  and ${COM_SALDO}
    union all
    select '60 dias',  count(distinct p.id_fornecedor)::int, count(*)::int
      from public.pedido p where p.id_loja=1 and p.id_situacaopedido=2
       and p.datacompra >= current_date-60  and ${COM_SALDO}
    union all
    select '90 dias',  count(distinct p.id_fornecedor)::int, count(*)::int
      from public.pedido p where p.id_loja=1 and p.id_situacaopedido=2
       and p.datacompra >= current_date-90  and ${COM_SALDO}
    union all
    select '120 dias', count(distinct p.id_fornecedor)::int, count(*)::int
      from public.pedido p where p.id_loja=1 and p.id_situacaopedido=2
       and p.datacompra >= current_date-120 and ${COM_SALDO}
    union all
    select '180 dias', count(distinct p.id_fornecedor)::int, count(*)::int
      from public.pedido p where p.id_loja=1 and p.id_situacaopedido=2
       and p.datacompra >= current_date-180 and ${COM_SALDO}`);

  // Se a data de entrega bate com a da compra, dá pra confiar nela também.
  await bloco("5) A DATA DE ENTREGA E CONFIAVEL? (dias entre comprar e receber)",
   `select case
             when p.dataentrega < p.datacompra          then 'a) ANTES da compra (erro)'
             when p.dataentrega <= p.datacompra +  30   then 'b) ate 30 dias depois'
             when p.dataentrega <= p.datacompra +  90   then 'c) 31 a 90 depois'
             when p.dataentrega <= p.datacompra + 365   then 'd) ate um ano depois'
             else                                            'e) mais de um ano depois (suspeito)'
           end as prazo, count(*)::int as pedidos
      from public.pedido p
     where p.id_loja = 1 and p.id_situacaopedido = 2 and ${COM_SALDO}
     group by 1 order by 1`);

  await c.end();
  console.log("\n\nPRONTO. Copie TUDO e mande de volta.");
})().catch((e) => { console.log("ERRO: " + e.message); process.exit(1); });
