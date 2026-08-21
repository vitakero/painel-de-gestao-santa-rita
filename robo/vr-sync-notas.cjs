// ============================================================================
// AS NOTAS DA RECEITA, DO VR PARA A NUVEM
//
// Por que existe: a loja aceita agendamento com a CHAVE de 44 numeros, sem o arquivo.
// A chave nao carrega os produtos, entao quem manda so a chave passava sem conferencia
// e a loja so descobria o que vinha quando o caminhao encostava.
//
// O VR ja resolve isso e ninguem tinha percebido: ele baixa da Receita, com o
// certificado da loja, o XML de TODAS as notas de entrada. Medido em 20/08/2026:
// 35.889 notas desde marco/2023, 100% com o XML inteiro e com os produtos dentro,
// chegando de 1 a 5 minutos depois de o fornecedor emitir.
//
// Este script le a notaentradanfe, abre o XML ali dentro e manda para a nuvem so o
// que interessa: cabecalho e lista de produtos. O XML inteiro NAO vai — sao ~20 KB
// por nota, 35 mil notas, 700 MB que ninguem leria.
//
// SO LE o banco do VR. Nunca escreve la.
//
// Licoes das rodadas anteriores, aplicadas aqui:
//   * c.query(texto, [valores]) — com ARRAY. Passar solto derruba de dentro do driver.
//   * nota que nao der para ler nao pode derrubar as outras: cada uma tem rede propria.
//   * morte silenciosa deixa a janela fechar sem rastro: o fim vira evento na nuvem.
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

// ---------------------------------------------------------------- ler o XML da NFe
// Sem biblioteca de XML de proposito: o robo da loja nao tem npm install, e a NFe e
// previsivel o bastante. O que NAO e previsivel eu trato: campo faltando vira nulo,
// nota ilegivel e pulada com o motivo anotado.
/* ==NFELER-INICIO== — o leitor de XML, testavel sozinho (scripts/testes/nfe-leitura.test.cjs) */
function bloco(xml, nome) {
  const i = xml.indexOf("<" + nome + ">");
  if (i < 0) return "";
  const f = xml.indexOf("</" + nome + ">", i);
  return f < 0 ? "" : xml.slice(i + nome.length + 2, f);
}
function campo(xml, nome) {
  const i = xml.indexOf("<" + nome + ">");
  if (i < 0) return null;
  const f = xml.indexOf("</" + nome + ">", i);
  if (f < 0) return null;
  const v = xml.slice(i + nome.length + 2, f).trim();
  return v === "" ? null : v;
}
const numero = (v) => { const n = parseFloat(String(v == null ? "" : v).replace(",", ".")); return isNaN(n) ? null : n; };
const so9 = (v) => String(v == null ? "" : v).replace(/[^0-9]/g, "") || null;

function lerNfe(xml) {
  // o infNFeSupl (o QR code) tambem casa com "<infNFe"; pego o primeiro bloco de verdade
  const inf = bloco(xml, "infNFe") || xml;
  const ide = bloco(inf, "ide");
  const emit = bloco(inf, "emit");
  const dest = bloco(inf, "dest");
  const icmsTot = bloco(bloco(inf, "total"), "ICMSTot");

  const itens = [];
  const re = /<det\b[^>]*>([\s\S]*?)<\/det>/g;
  let m, seq = 0;
  while ((m = re.exec(inf))) {
    seq++;
    const prod = bloco(m[1], "prod");
    if (!prod) continue;
    const ean = campo(prod, "cEAN");
    itens.push({
      seq: seq,
      codigo: campo(prod, "cProd"),
      // "SEM GTIN" e o que a norma manda escrever quando o produto nao tem codigo de
      // barras. Guardar esse texto como se fosse um EAN faria a conferencia casar
      // produtos diferentes que so tem em comum o fato de nao terem codigo.
      ean: (ean && ean.toUpperCase().indexOf("SEM GTIN") < 0) ? so9(ean) : null,
      descricao: campo(prod, "xProd"),
      ncm: campo(prod, "NCM"),
      cfop: campo(prod, "CFOP"),
      unidade: campo(prod, "uCom"),
      qtd: numero(campo(prod, "qCom")),
      valor_unit: numero(campo(prod, "vUnCom")),
      valor_total: numero(campo(prod, "vProd")),
      pedido: campo(prod, "xPed"),
      item_pedido: campo(prod, "nItemPed"),
    });
  }

  return {
    numero: campo(ide, "nNF"),
    serie: campo(ide, "serie"),
    emissao: campo(ide, "dhEmi") || campo(ide, "dEmi"),
    emitente_cnpj: so9(campo(emit, "CNPJ")),
    emitente_nome: campo(emit, "xNome"),
    destin_cnpj: so9(campo(dest, "CNPJ")),
    valor_total: numero(campo(icmsTot, "vNF")),
    itens: itens,
  };
}

/* ==NFELER-FIM== */

// ---------------------------------------------------------------------------- roda
const LOTE = 200;                 // quantas notas por ida ao VR
const PRIMEIRA_JANELA_DIAS = 120; // na primeira vez, so os ultimos 4 meses
// Quantas idas ao VR por rodada. A carga inicial sao ~3.500 notas: a 200 por ida,
// seriam 18 rodadas na mao. Com 30 idas ela cabe numa so, e as rodadas seguintes
// terminam na primeira ida porque nao ha nada novo.
// O teto existe para o robo nunca ficar preso aqui: o que sobrar vai na proxima.
const MAX_IDAS = 30;

const morte = [];
process.on("uncaughtException", (e) => { morte.push("uncaught: " + e.message); });
process.on("unhandledRejection", (e) => { morte.push("rejeicao: " + ((e && e.message) || e)); });

(async () => {
  const conta = { lidas: 0, gravadas: 0, puladas: 0, erros: [] };
  let c = null;
  try {
    if (!SB_KEY) throw new Error("Falta SUPABASE_SERVICE_KEY no .env");
    if (!g("PG_HOST")) throw new Error("Falta o .env do VR (rode na pasta do robo)");

    // De onde continuar: a mais nova que ja esta na nuvem. Assim a primeira rodada
    // pega a janela inicial e as seguintes pegam so o que chegou depois — reler 35 mil
    // notas a cada 10 minutos seria trabalho a toa e peso no VR.
    let desde = null;
    try {
      const ult = await req("GET", "/rest/v1/receb_notas_vr?select=recebido_em&order=recebido_em.desc&limit=1");
      if (ult && ult.length && ult[0].recebido_em) desde = ult[0].recebido_em;
    } catch (e) { conta.erros.push("nao li o marcador: " + e.message); }

    c = new Client({ host: g("PG_HOST"), port: +g("PG_PORT"), database: g("PG_DATABASE"),
      user: g("PG_USER"), password: g("PG_PASSWORD"), ssl: false, connectionTimeoutMillis: 20000 });
    c.on("error", (e) => conta.erros.push("conexao: " + e.message));
    await c.connect();
    try { await c.query("set statement_timeout = 240000"); } catch (e) {}

    // A CARGA INICIAL CABE NUMA RODADA SO.
    // Cada ida traz LOTE notas e empurra o marcador para a frente; o laco repete ate
    // o VR nao ter mais nada ou ate o teto de idas. Na primeira vez isso e a carga
    // inteira; depois disso, a primeira ida ja volta vazia e ele para.
    let idas = 0;
    while (idas < MAX_IDAS) {
      idas++;
      const sql =
        "select chavenfe::text chave, xml, datahorarecebimento, id_loja " +
        "  from public.notaentradanfe " +
        " where id_loja = 1 and xml is not null and length(xml) > 500 " +
        (desde ? "   and datahorarecebimento > $1 "
               : "   and datahorarecebimento >= (now() - interval '" + PRIMEIRA_JANELA_DIAS + " days') ") +
        " order by datahorarecebimento asc limit " + LOTE;

      const rows = (await c.query(sql, desde ? [desde] : [])).rows;
      if (!rows.length) {
        if (idas === 1) console.log("Nada novo no VR.");
        break;
      }
      conta.lidas += rows.length;

      const linhas = [];
      for (const r of rows) {
        try {
          const ch = so9(r.chave);
          if (!ch || ch.length !== 44) { conta.puladas++; continue; }
          const n = lerNfe(String(r.xml));
          if (!n.itens.length) { conta.puladas++; continue; }
          linhas.push({
            chave: ch, numero: n.numero, serie: n.serie,
            emitente_cnpj: n.emitente_cnpj, emitente_nome: n.emitente_nome,
            destin_cnpj: n.destin_cnpj,
            emissao: n.emissao, recebido_em: r.datahorarecebimento,
            valor_total: n.valor_total, id_loja: r.id_loja,
            itens: n.itens, sincronizado_em: new Date().toISOString(),
          });
        } catch (e) {
          // uma nota ilegivel nao pode levar as outras junto
          conta.puladas++;
          if (conta.erros.length < 5) conta.erros.push("nota " + r.chave + ": " + e.message);
        }
      }

      // grava em pedacos: um POST gigante estoura o limite do PostgREST
      for (let i = 0; i < linhas.length; i += 50) {
        const pedaco = linhas.slice(i, i + 50);
        await req("POST", "/rest/v1/receb_notas_vr?on_conflict=tenant_id,chave", pedaco,
          "resolution=merge-duplicates,return=minimal");
        conta.gravadas += pedaco.length;
      }

      // O MARCADOR ANDA MESMO QUE A NOTA TENHA SIDO PULADA.
      // Se eu andasse so pelas gravadas, uma nota ilegivel no comeco do lote faria o
      // laco reler o mesmo pedaco para sempre. Ando pela ultima nota LIDA.
      desde = rows[rows.length - 1].datahorarecebimento;

      console.log("  ida " + idas + ": " + rows.length + " lidas, " +
                  conta.gravadas + " gravadas no total");
      if (rows.length < LOTE) break;   // o VR entregou menos que o lote: acabou
    }

    console.log("Notas: " + conta.lidas + " lidas, " + conta.gravadas + " gravadas, " +
                conta.puladas + " puladas, em " + idas + " ida(s) ao VR.");
    if (idas >= MAX_IDAS) {
      console.log("Parei no teto de " + MAX_IDAS + " idas. A proxima rodada continua de onde parou.");
    }
  } catch (e) {
    conta.erros.push(e.message);
    console.log("ERRO: " + e.message);
  }
  try { if (c) await c.end(); } catch (e) {}

  // o fim vira evento na nuvem: janela que fecha sozinha nao pode levar o motivo junto
  try {
    const loc = await req("GET", "/rest/v1/receb_locais?select=id&order=criado_em&limit=1");
    await req("POST", "/rest/v1/receb_eventos", [{
      entidade: "vr_notas_sync",
      entidade_id: (loc && loc[0] && loc[0].id) || "00000000-0000-0000-0000-000000000000",
      acao: conta.erros.length ? "com_erro" : "ok",
      motivo: conta.lidas + " lidas, " + conta.gravadas + " gravadas, " + conta.puladas + " puladas",
      detalhe: Object.assign({}, conta, { mortes: morte }),
    }], "return=minimal");
  } catch (e) { console.log("(nao consegui avisar a nuvem: " + e.message + ")"); }
})();
