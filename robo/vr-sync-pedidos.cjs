// SYNC: lê os PEDIDOS DE COMPRA do VR e joga em receb_pedidos / receb_pedido_itens.
// Precisa de SUPABASE_SERVICE_KEY no .env. Só LÊ o VR; ESCREVE só na nuvem.
// Roda DENTRO da rede da loja: node scripts/vr-sync-pedidos.cjs
//
// Para que serve: encher a etapa "Pedidos" do Portal do Fornecedor. Hoje ela
// existe na trilha e fica vazia porque nunca teve dado.
//
// AS ESCOLHAS, todas medidas nos dados de 16/08/2026 e não chutadas:
//
// · SÓ LOJA 01. A LOJA 02 existe no cadastro mas não é usada (decisão do dono).
//
// · SÓ id_situacaopedido = 2 (FINALIZADO). As outras duas — DIGITANDO e
//   DIGITADO — são rascunho do comprador, ainda sendo montado. Rascunho de
//   compra não pode sair do prédio: o fornecedor veria quanto a loja pensa em
//   pedir antes de a loja decidir.
//
// · JANELA POR dataentrega, de 30 dias atrás a 60 à frente. Medimos: 10.600
//   pedidos entregam em até 30 dias da compra e só 5 passam de um ano. A data
//   de entrega é confiável, então é ela que manda.
//
// · POR QUE UMA JANELA, E NÃO "tudo que tem saldo": existem 7.726 pedidos com
//   mais de UM ANO ainda com saldo, somando R$ 13,7 milhões. Quase certamente
//   foram entregues e nunca baixados no VR. Sem a janela, o fornecedor abriria
//   o portal e veria anos de pedido morto como se fosse para entregar amanhã.
//
// · NÃO filtra por "quanto falta". Tem pedido com 5% faltando, e esses 5% podem
//   ser uma caixa de verdade. Em vez de esconder, mostra "17 itens no pedido,
//   3 para entrega" e o fornecedor decide.
const fs = require("fs"), path = require("path"), https = require("https"), { Client } = require("pg");
function env() {
  for (const p of [path.join(__dirname, "..", ".env"), ".env", "../.env"]) {
    try { return fs.readFileSync(p, "utf8"); } catch (e) {}
  }
  return "";
}
const E = env(), g = (k) => { const m = E.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim() : ""; };
const SB_HOST = "uabhsmculsfwzcrhyhch.supabase.co", SB_KEY = g("SUPABASE_SERVICE_KEY");

const DIAS_ATRAS = 30, DIAS_FRENTE = 60, LOJA = 1, FINALIZADO = 2;

function req(method, pathq, body, prefer) {
  return new Promise((res, rej) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY, "Content-Type": "application/json" };
    if (prefer) headers.Prefer = prefer;
    if (data) headers["Content-Length"] = Buffer.byteLength(data);
    const r = https.request({ host: SB_HOST, path: pathq, method, headers }, (resp) => {
      let d = ""; resp.on("data", (c) => d += c);
      resp.on("end", () => resp.statusCode < 300
        ? res(d ? JSON.parse(d) : null)
        : rej(new Error("HTTP " + resp.statusCode + " " + d.slice(0, 300))));
    });
    r.on("error", rej); if (data) r.write(data); r.end();
  });
}

// O CNPJ no VR é NUMERIC: quem começa com zero perde o zero e chega com 13
// dígitos. Comparar assim com o nosso cadastro nunca casa, e o fornecedor
// simplesmente não veria pedido nenhum — sem erro, sem aviso. Já nos pegou
// antes no código de barras do estoque.
function cnpj14(v) {
  const s = String(v == null ? "" : v).replace(/[^0-9]/g, "");
  return s ? s.padStart(14, "0") : "";
}
function num(v) { const x = parseFloat(v); return isNaN(x) ? 0 : x; }
function emLotes(l, n) { const s = []; for (let i = 0; i < l.length; i += n) s.push(l.slice(i, i + n)); return s; }

const Q_PEDIDOS = `
  select p.id, p.datacompra, p.dataentrega, p.valortotal, p.observacao,
         f.id as forn_vr, f.razaosocial, f.nomefantasia, f.cnpj,
         count(i.id)::int as itens,
         count(*) filter (where i.quantidade > coalesce(i.quantidadeatendida,0))::int as itens_saldo,
         sum((i.quantidade - coalesce(i.quantidadeatendida,0)) * coalesce(i.custocompra,0))
           filter (where i.quantidade > coalesce(i.quantidadeatendida,0)) as saldo_valor
    from public.pedido p
    join public.pedidoitem i on i.id_pedido = p.id
    left join public.fornecedor f on f.id = p.id_fornecedor
   where p.id_loja = $1
     and p.id_situacaopedido = $2
     and p.dataentrega between current_date - $3::int and current_date + $4::int
   group by p.id, p.datacompra, p.dataentrega, p.valortotal, p.observacao,
            f.id, f.razaosocial, f.nomefantasia, f.cnpj
  having count(*) filter (where i.quantidade > coalesce(i.quantidadeatendida,0)) > 0
   order by p.dataentrega`;

const Q_ITENS = `
  select i.id_pedido, i.id, i.id_produto, i.quantidade, i.qtdembalagem,
         coalesce(i.quantidadeatendida,0) as atendida, i.custocompra, i.valortotal,
         pr.descricaocompleta, pr.descricaoreduzida
    from public.pedidoitem i
    left join public.produto pr on pr.id = i.id_produto
   where i.id_pedido = any($1::int[])
   order by i.id_pedido, i.id`;

(async () => {
  if (!SB_KEY) { console.log("!! Falta SUPABASE_SERVICE_KEY no .env"); return; }
  const c = new Client({
    host: g("PG_HOST"), port: +g("PG_PORT"), database: g("PG_DATABASE"),
    user: g("PG_USER"), password: g("PG_PASSWORD"), connectionTimeoutMillis: 20000,
  });
  try { await c.connect(); }
  catch (e) { console.log("NAO CONSEGUI CONECTAR NO VR: " + e.message); process.exit(1); }

  const peds = (await c.query(Q_PEDIDOS, [LOJA, FINALIZADO, DIAS_ATRAS, DIAS_FRENTE])).rows;
  console.log("VR: " + peds.length + " pedido(s) com saldo na janela de -" + DIAS_ATRAS + "/+" + DIAS_FRENTE + " dias.");
  if (!peds.length) { await c.end(); return; }

  // ---- de quem é cada pedido, no NOSSO cadastro ----
  // Sem esse casamento por CNPJ o pedido fica órfão: forn_pedidos filtra por
  // fornecedor_id, então pedido sem dono não aparece para ninguém.
  const nossos = await req("GET", "/rest/v1/receb_fornecedores?select=id,cnpj");
  const porCnpj = {};
  (nossos || []).forEach((f) => { const k = cnpj14(f.cnpj); if (k) porCnpj[k] = f.id; });
  const local = (await req("GET", "/rest/v1/receb_locais?select=id&order=criado_em&limit=1"))[0];

  let casados = 0, orfaos = 0;
  const linhas = peds.map((p) => {
    const dono = porCnpj[cnpj14(p.cnpj)] || null;
    if (dono) casados++; else orfaos++;
    return {
      numero: String(p.id),
      vr_id: String(p.id),
      fornecedor_id: dono,
      fornecedor_vr: p.forn_vr,
      local_id: local ? local.id : null,
      emissao: p.datacompra ? String(p.datacompra).slice(0, 10) : null,
      previsao: p.dataentrega ? String(p.dataentrega).slice(0, 10) : null,
      situacao: "aberto",
      valor_total: num(p.valortotal),
      saldo_valor: num(p.saldo_valor),
      sincronizado_em: new Date().toISOString(),
    };
  });

  for (const lote of emLotes(linhas, 200)) {
    await req("POST", "/rest/v1/receb_pedidos?on_conflict=tenant_id,numero", lote,
              "resolution=merge-duplicates,return=minimal");
  }
  console.log("Pedidos na nuvem: " + linhas.length +
              "  (com dono no portal: " + casados + " | sem cadastro ainda: " + orfaos + ")");

  // ---- os itens ----
  const mapa = {};
  const numeros = linhas.map((x) => x.numero);
  for (const lote of emLotes(numeros, 100)) {
    const r = await req("GET", "/rest/v1/receb_pedidos?select=id,numero&numero=in.(" +
                        lote.map(encodeURIComponent).join(",") + ")");
    (r || []).forEach((x) => { mapa[x.numero] = x.id; });
  }

  const itens = (await c.query(Q_ITENS, [peds.map((p) => p.id)])).rows;
  await c.end();

  // Apaga e regrava: quantidade atendida muda o tempo todo, e casar linha a
  // linha custaria mais do que reescrever.
  for (const lote of emLotes(Object.values(mapa), 60)) {
    await req("DELETE", "/rest/v1/receb_pedido_itens?pedido_id=in.(" +
              lote.map(encodeURIComponent).join(",") + ")");
  }

  let seq = {}, novos = [];
  for (const i of itens) {
    const pid = mapa[String(i.id_pedido)];
    if (!pid) continue;
    seq[pid] = (seq[pid] || 0) + 1;
    const qtd = num(i.quantidade), at = num(i.atendida);
    novos.push({
      pedido_id: pid,
      seq: seq[pid],
      produto_vr: String(i.id_produto),
      descricao: i.descricaocompleta || i.descricaoreduzida || null,
      codigo: String(i.id_produto),
      unidade: null,
      qtd_pedida: qtd,
      qtd_entregue: at,
      saldo: Math.max(0, qtd - at),
      valor_unit: num(i.custocompra),
      valor_total: num(i.valortotal),
    });
  }
  for (const lote of emLotes(novos, 400)) {
    await req("POST", "/rest/v1/receb_pedido_itens", lote, "return=minimal");
  }
  console.log("Itens na nuvem: " + novos.length +
              "  (com saldo: " + novos.filter((x) => x.saldo > 0).length + ")");

  if (orfaos) {
    console.log("\nAviso: " + orfaos + " pedido(s) sao de fornecedor que ainda nao tem");
    console.log("cadastro no portal. Ficam guardados e passam a aparecer sozinhos");
    console.log("quando o fornecedor se cadastrar com o mesmo CNPJ.");
  }
  console.log("\nPRONTO.");
})().catch((e) => { console.log("ERRO: " + e.message); process.exit(1); });
