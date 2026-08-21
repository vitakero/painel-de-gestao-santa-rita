// ============================================================================
// O DICIONARIO DO CODIGO DO FORNECEDOR, DO VR PARA A NUVEM
//
// O problema, medido em 3.480 notas reais (27.584 itens):
//   6.408 itens (23,2%) nao tem como casar com o pedido de compra — a nota nao traz
//   codigo de barras nem a linha do pedido. Hoje esses levam a acusacao falsa de
//   "nao esta no pedido", ou (depois do conserto) ficam sem conferencia nenhuma.
//
// A saida estava no proprio VR: a tabela produtofornecedor guarda, ha anos,
//   produto da loja  x  fornecedor  x  codigo que AQUELE fornecedor usa
// Sao 27.741 equivalencias ja cadastradas, mais 2.104 codigos alternativos.
//
// Com isso o ponto cego cai de 23,2% para 1,4% (medido: 94% dos itens cegos usam um
// codigo que ja apareceu em outra nota).
//
// De brinde vem qtdembalagem/fatorembalagem, que resolvem nota em CAIXA contra
// pedido em UNIDADE.
//
// A PONTE ATE O PORTAL: o portal conhece o fornecedor pelo CNPJ, e o VR pelo codigo
// interno. A tabela fornecedor do VR tem os dois, entao eu junto aqui e mando o CNPJ
// junto — assim a nuvem nao precisa saber a numeracao interna do VR.
//
// SO LE o banco do VR. Nao muda nada la.
// ============================================================================
const fs = require("fs"), path = require("path"), https = require("https");
const { Client } = require("pg");

function env() {
  for (const p of [path.join(__dirname, "..", ".env"), ".env", "../.env"]) {
    try { return fs.readFileSync(p, "utf8"); } catch (e) {}
  }
  return "";
}
const E = env(), g = (k) => { const m = E.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim() : ""; };
const SB_HOST = "uabhsmculsfwzcrhyhch.supabase.co", SB_KEY = g("SUPABASE_SERVICE_KEY");

function req(metodo, caminho, corpo, prefer) {
  return new Promise((res, rej) => {
    const d = corpo ? JSON.stringify(corpo) : null;
    const h = { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY, "Content-Type": "application/json" };
    if (prefer) h.Prefer = prefer;
    if (d) h["Content-Length"] = Buffer.byteLength(d);
    const r = https.request({ host: SB_HOST, path: caminho, method: metodo, headers: h }, (resp) => {
      let b = ""; resp.on("data", (c) => (b += c));
      resp.on("end", () => resp.statusCode < 300 ? res(b ? JSON.parse(b) : null)
        : rej(new Error("HTTP " + resp.statusCode + " " + b.slice(0, 200))));
    });
    r.on("error", rej); if (d) r.write(d); r.end();
  });
}

const so9 = (v) => String(v == null ? "" : v).replace(/[^0-9]/g, "") || null;
const num = (v) => { const n = parseFloat(String(v == null ? "" : v).replace(",", ".")); return isNaN(n) ? null : n; };

const morte = [];
process.on("uncaughtException", (e) => { morte.push("uncaught: " + e.message); });
process.on("unhandledRejection", (e) => { morte.push("rejeicao: " + ((e && e.message) || e)); });

(async () => {
  const conta = { lidos: 0, gravados: 0, sem_cnpj: 0, sem_codigo: 0, erros: [] };
  let c = null;
  try {
    if (!SB_KEY) throw new Error("Falta SUPABASE_SERVICE_KEY no .env");
    if (!g("PG_HOST")) throw new Error("Falta o .env do VR (rode na pasta do robo)");

    c = new Client({ host: g("PG_HOST"), port: +g("PG_PORT"), database: g("PG_DATABASE"),
      user: g("PG_USER"), password: g("PG_PASSWORD"), ssl: false, connectionTimeoutMillis: 20000 });
    c.on("error", (e) => conta.erros.push("conexao: " + e.message));
    await c.connect();
    try { await c.query("set statement_timeout = 240000"); } catch (e) {}

    // Os dois lugares onde o codigo do fornecedor mora, num resultado so.
    // O principal (produtofornecedor) e o de codigos alternativos: o mesmo produto do
    // mesmo fornecedor pode chegar com mais de um codigo, e ignorar os alternativos
    // deixaria uma parte da nota sem casar sem motivo nenhum.
    const sql = `
      select pf.id_produto, pf.codigoexterno, pf.qtdembalagem, pf.fatorembalagem,
             f.cnpj, f.razaosocial
        from public.produtofornecedor pf
        join public.fornecedor f on f.id = pf.id_fornecedor
       where nullif(trim(coalesce(pf.codigoexterno,'')),'') is not null

      union all

      select pf.id_produto, x.codigoexterno, x.qtdembalagem, x.fatorembalagem,
             f.cnpj, f.razaosocial
        from public.produtofornecedorcodigoexterno x
        join public.produtofornecedor pf on pf.id = x.id_produtofornecedor
        join public.fornecedor f on f.id = pf.id_fornecedor
       where nullif(trim(coalesce(x.codigoexterno,'')),'') is not null`;

    const rows = (await c.query(sql)).rows;
    conta.lidos = rows.length;
    console.log("Equivalencias no VR: " + rows.length);

    // O portal conhece o fornecedor pelo CNPJ. Sem CNPJ a linha nao serve para nada
    // aqui — nao ha como amarrar ao fornecedor que fez login no portal.
    const vistos = {};
    const linhas = [];
    for (const r of rows) {
      const cnpj = so9(r.cnpj);
      const cod = String(r.codigoexterno == null ? "" : r.codigoexterno).trim();
      if (!cnpj || cnpj.length !== 14) { conta.sem_cnpj++; continue; }
      if (!cod) { conta.sem_codigo++; continue; }
      // GRAVO EM MAIUSCULA, sempre.
      // A busca na hora da conferencia tem que ser exata para usar o indice; se eu
      // gravasse como veio, "ab12" e "AB12" virariam duas linhas e a nota casaria com
      // uma ou com nenhuma dependendo de como o fornecedor digitou naquele dia.
      const codU = cod.toUpperCase();
      // o mesmo par (fornecedor, codigo) pode aparecer nas duas tabelas
      const k = cnpj + "|" + codU;
      if (vistos[k]) continue;
      vistos[k] = 1;
      linhas.push({
        fornecedor_cnpj: cnpj,
        fornecedor_nome: r.razaosocial || null,
        codigo_fornecedor: codU,
        produto_vr: String(r.id_produto),
        qtd_embalagem: num(r.qtdembalagem),
        fator_embalagem: num(r.fatorembalagem),
        sincronizado_em: new Date().toISOString(),
      });
    }

    for (let i = 0; i < linhas.length; i += 500) {
      const pedaco = linhas.slice(i, i + 500);
      await req("POST", "/rest/v1/receb_codigos_fornecedor?on_conflict=tenant_id,fornecedor_cnpj,codigo_fornecedor",
        pedaco, "resolution=merge-duplicates,return=minimal");
      conta.gravados += pedaco.length;
    }
    console.log("Gravadas na nuvem: " + conta.gravados +
                " | sem CNPJ: " + conta.sem_cnpj + " | sem codigo: " + conta.sem_codigo);
  } catch (e) {
    conta.erros.push(e.message);
    console.log("ERRO: " + e.message);
  }
  try { if (c) await c.end(); } catch (e) {}

  try {
    const loc = await req("GET", "/rest/v1/receb_locais?select=id&order=criado_em&limit=1");
    await req("POST", "/rest/v1/receb_eventos", [{
      entidade: "vr_codigos_sync",
      entidade_id: (loc && loc[0] && loc[0].id) || "00000000-0000-0000-0000-000000000000",
      acao: conta.erros.length ? "com_erro" : "ok",
      motivo: conta.lidos + " lidas, " + conta.gravados + " gravadas",
      detalhe: Object.assign({}, conta, { mortes: morte }),
    }], "return=minimal");
  } catch (e) { console.log("(nao consegui avisar a nuvem: " + e.message + ")"); }
})();
