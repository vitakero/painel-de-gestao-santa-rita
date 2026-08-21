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
// O codigo de barras vem NUMERIC do VR, entao chega sem os zeros da frente e
// as vezes como "7.89123e+12". Aqui vira texto de digitos, sem zero a esquerda.
// NAO completo com zeros ate 13: existe EAN-8 legitimo, e completar quebraria
// justamente os produtos pequenos. Quem compara os dois lados usa a mesma
// peneira, entao "07891" e "7891" se reconhecem.
function ean13(v) {
  if (v === null || v === undefined) return null;
  let s = typeof v === "number" ? v.toFixed(0) : String(v);
  s = s.replace(/[^0-9]/g, "").replace(/^0+/, "");
  return s.length >= 8 ? s : null;
}
function num(v) { const x = parseFloat(v); return isNaN(x) ? 0 : x; }

// O driver do Postgres devolve coluna "date" como OBJETO Date, não como texto.
// Fatiar os 10 primeiros caracteres dele produzia "Sat Jul 04" e o Supabase
// recusava a gravação inteira. Monta na mão pelos componentes locais: o driver
// entrega meia-noite local, então dia/mês/ano saem certos sem risco de o fuso
// empurrar a data um dia para trás.
function dataISO(v) {
  if (!v) return null;
  if (typeof v === "string") return v.slice(0, 10);
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  const z = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate());
}
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
      emissao: dataISO(p.datacompra),
      previsao: dataISO(p.dataentrega),
      situacao: "aberto",
      valor_total: num(p.valortotal),
      saldo_valor: num(p.saldo_valor),
      sincronizado_em: new Date().toISOString(),
    };
  });

  // ---- A PONTE: código do VR -> CNPJ ----
  // O pedido guarda o CÓDIGO do fornecedor no VR; o portal conhece a pessoa
  // pelo CNPJ. Sem guardar esta lista, fornecedor que se cadastra DEPOIS desta
  // carga fica sem os pedidos dele para sempre — não haveria como casar.
  const vistos = {};
  peds.forEach((p) => {
    if (p.forn_vr == null || vistos[p.forn_vr]) return;
    vistos[p.forn_vr] = {
      vr_id: p.forn_vr,
      cnpj: cnpj14(p.cnpj) || null,
      razao_social: p.razaosocial || null,
      nome_fantasia: p.nomefantasia || null,
      atualizado_em: new Date().toISOString(),
    };
  });
  const fornVr = Object.values(vistos);
  for (const lote of emLotes(fornVr, 200)) {
    await req("POST", "/rest/v1/receb_fornecedores_vr?on_conflict=tenant_id,vr_id", lote,
              "resolution=merge-duplicates,return=minimal");
  }
  console.log("Fornecedores do VR na nuvem: " + fornVr.length +
              "  (com CNPJ: " + fornVr.filter((x) => x.cnpj).length + ")");

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

  // ---- OS CODIGOS DE BARRAS ----
  // No VR o EAN NAO fica no produto: fica em produtoautomacao, e um produto tem
  // VARIOS — o da unidade, o da caixa, o do fardo. (Perdi tempo procurando uma
  // coluna "codigobarras" em produto; ela nao existe, sao 100 colunas e nenhuma
  // de EAN. Quem sabia disso era o vr-sync-estoque.cjs.)
  //
  // Guardo TODOS. Se eu guardasse so o da unidade, a nota que declara o EAN da
  // CAIXA nao casaria com o pedido — e a conferencia acharia zero produtos
  // parecendo que funcionou.
  const Q_EANS = `
    select pa.id_produto, pa.codigobarras::text as ean, pa.qtdembalagem
      from public.produtoautomacao pa
     where pa.id_produto = any($1::int[])
       and pa.codigobarras is not null
       and trim(pa.codigobarras::text) <> ''
     order by pa.id_produto, pa.qtdembalagem`;

  const itens = (await c.query(Q_ITENS, [peds.map((p) => p.id)])).rows;

  const eansPorProduto = {};
  try {
    const ids = [];
    itens.forEach((i) => { if (i.id_produto != null && ids.indexOf(i.id_produto) < 0) ids.push(i.id_produto); });
    if (ids.length) {
      const rows = (await c.query(Q_EANS, [ids])).rows;
      rows.forEach((r) => {
        const e = ean13(r.ean);
        if (!e) return;
        const k = String(r.id_produto);
        if (!eansPorProduto[k]) eansPorProduto[k] = [];
        if (eansPorProduto[k].indexOf(e) < 0) eansPorProduto[k].push(e);
      });
      const comEan = Object.keys(eansPorProduto).length;
      const total = Object.values(eansPorProduto).reduce((a, l) => a + l.length, 0);
      console.log("Codigos de barras: " + total + " de " + comEan + " produto(s), sobre " + ids.length + " produtos do lote.");
    }
  } catch (e) {
    console.log("!! nao consegui ler produtoautomacao: " + e.message + " — os itens vao sem EAN.");
  }

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
      // ean = o de menor embalagem (a unidade), que e o que a tela mostra;
      // eans = todos, que e com o que a comparacao casa
      ean: (eansPorProduto[String(i.id_produto)] || [])[0] || null,
      eans: eansPorProduto[String(i.id_produto)] || null,
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

  // ---- liga quem ficou solto ----
  // UMA regra decide de quem é o pedido, e ela mora no banco. Aqui eu só peço
  // para ela rodar. Se eu recalculasse por aqui, um dia as duas contas
  // discordariam e o fornecedor veria pedido de outro.
  const lig = await req("POST", "/rest/v1/rpc/receb_ligar_fornecedores", {});
  if (lig && lig.ok) {
    console.log("Ligacao: " + lig.cadastros_ligados + " cadastro(s) ganharam o codigo do VR, " +
                lig.pedidos_ligados + " pedido(s) acharam o dono.");
  }

  // ---- DETETIVE DAS PERDAS, uma vez só ----
  // O Victor quer que o painel leia a perda do FLV direto do VR em vez de alguém digitar.
  // Eu não sei o nome da tabela e não alcanço o VR daqui, então o robô pergunta e manda a
  // resposta pra nuvem. Pendurado aqui porque este script já roda de 10 em 10 minutos —
  // mexer no robo.bat exigiria o Victor na máquina da loja.
  try {
    const ja = await req("GET", "/rest/v1/receb_eventos?select=id&entidade=eq.vr_perdas&limit=1");
    if (!ja || !ja.length) {
      console.log("\nInvestigando onde o VR guarda as perdas (uma vez so)...");
      require("child_process").execFileSync(process.execPath,
        [path.join(__dirname, "vr-descobrir-perdas.cjs")], { stdio: "inherit" });
    }
  } catch (e) { console.log("(detetive das perdas nao rodou: " + e.message + ")"); }

  // ---- O VR JA GUARDA O XML DAS NOTAS DE ENTRADA? uma vez so ----
  // Se guardar, a conferencia de itens passa a valer sempre, com XML ou sem, e vinda da
  // Receita em vez do fornecedor. Pendurado aqui porque este script ja roda sozinho;
  // mexer no robo.bat exige o Victor na maquina da loja.
  try {
    const jaN = await req("GET", "/rest/v1/receb_eventos?select=id&entidade=eq.vr_notas&limit=1");
    if (!jaN || !jaN.length) {
      console.log("\nProcurando o XML das notas de entrada no VR (uma vez so)...");
      require("child_process").execFileSync(process.execPath,
        [path.join(__dirname, "vr-descobrir-notas.cjs")], { stdio: "inherit" });
    }
  } catch (e) { console.log("(busca das notas nao rodou: " + e.message + ")"); }

  /* O FLV NAO PASSA MAIS POR AQUI.
     Cheguei a montar o vr-sync-flv.cjs para puxar do VR o faturamento e o desperdicio do
     balanco. O faturamento fechou com a tela dele com R$ 100 de diferenca em R$ 600 mil,
     mas o desperdicio nunca fechou: a contagem do balanco esta em algum lugar do VR que
     eu nao achei (a balancoprelancamento, que seria a obvia, esta vazia). O Victor
     decidiu em 19/08/2026 continuar digitando os dois numeros na mao, entao tirei a
     chamada daqui. Os scripts continuam no repositorio, sem ninguem chamando. */

  // ---- AS NOTAS DA RECEITA ----
  // O VR baixa da Receita o XML de todas as notas de entrada. E dele que sai a
  // conferencia quando o fornecedor manda so a chave, sem o arquivo. Pendurado aqui
  // porque este script ja roda sozinho; mexer no robo.bat exige o Victor na loja.
  // Falhar aqui nao pode derrubar a rodada dos pedidos, que ja terminou.
  try {
    console.log("\nTrazendo as notas que o VR baixou da Receita...");
    require("child_process").execFileSync(process.execPath,
      [path.join(__dirname, "vr-sync-notas.cjs")], { stdio: "inherit" });
  } catch (e) { console.log("(sync das notas nao rodou: " + e.message + ")"); }

  if (orfaos) {
    console.log("\nAviso: " + orfaos + " pedido(s) sao de fornecedor que ainda nao tem");
    console.log("cadastro no portal. Ficam guardados e passam a aparecer sozinhos");
    console.log("quando o fornecedor se cadastrar com o mesmo CNPJ.");
  }
  console.log("\nPRONTO.");
})().catch((e) => { console.log("ERRO: " + e.message); process.exit(1); });
