// MEDE: uma nota fiscal costuma cobrir MAIS DE UM pedido de compra?
// Só leitura. Cruza item da nota -> dicionário (cnpj+código) -> produto_vr -> pedidos.
require("dotenv").config({ path: require("path").join(process.env.HOME, "vr-looker-integration", ".env") });
const U = process.env.SUPABASE_URL, K = process.env.SUPABASE_SERVICE_KEY;
const H = { apikey: K, Authorization: "Bearer " + K };
const pega = async (q) => { const r = await fetch(U + "/rest/v1/" + q, { headers: H }); return r.ok ? r.json() : []; };
const so = (s) => String(s == null ? "" : s).replace(/\D/g, "").replace(/^0+/, "");

(async () => {
  const dic = new Map();
  for (let p = 0; p < 80; p++) {
    const j = await pega("receb_codigos_fornecedor?select=fornecedor_cnpj,codigo_fornecedor,produto_vr&limit=1000&offset=" + p * 1000);
    if (!j.length) break;
    j.forEach(x => dic.set(so(x.fornecedor_cnpj) + "|" + so(x.codigo_fornecedor), String(x.produto_vr)));
  }
  // produto_vr -> conjunto de pedidos que o contêm
  const ondeEsta = new Map();
  for (let p = 0; p < 80; p++) {
    const j = await pega("receb_pedido_itens?select=produto_vr,pedido_id&limit=1000&offset=" + p * 1000);
    if (!j.length) break;
    j.forEach(x => { if (x.produto_vr == null) return;
      const k = String(x.produto_vr); if (!ondeEsta.has(k)) ondeEsta.set(k, new Set());
      ondeEsta.get(k).add(x.pedido_id); });
  }
  console.log("dicionario: " + dic.size + " codigos  |  produtos com pedido: " + ondeEsta.size + "\n");

  let notas = 0, comCasa = 0;
  const dist = {};
  for (let p = 0; p < 40; p++) {
    const j = await pega("receb_notas_vr?select=numero,emitente_cnpj,itens&limit=500&offset=" + p * 500);
    if (!j.length) break;
    for (const n of j) {
      notas++;
      // para CADA item, o conjunto de pedidos onde ele existe
      const conjuntos = [];
      for (const it of (n.itens || [])) {
        const pv = dic.get(so(n.emitente_cnpj) + "|" + so(it.codigo));
        if (!pv) continue;
        const s = ondeEsta.get(pv);
        if (s && s.size) conjuntos.push(s);
      }
      if (!conjuntos.length) continue;
      comCasa++;
      // menor numero de pedidos que cobre TODOS os itens que casaram (guloso)
      const restam = conjuntos.slice();
      const escolhidos = new Set();
      while (restam.length) {
        const cont = new Map();
        restam.forEach(s => s.forEach(pid => cont.set(pid, (cont.get(pid) || 0) + 1)));
        let melhor = null, q = -1;
        cont.forEach((v, k2) => { if (v > q) { q = v; melhor = k2; } });
        if (melhor == null) break;
        escolhidos.add(melhor);
        for (let i = restam.length - 1; i >= 0; i--) if (restam[i].has(melhor)) restam.splice(i, 1);
      }
      const k = Math.min(escolhidos.size, 5);
      dist[k] = (dist[k] || 0) + 1;
    }
  }
  console.log("notas lidas: " + notas + "  |  com item que casou com pedido: " + comCasa + "\n");
  console.log("  quantos PEDIDOS uma nota precisa para cobrir os itens dela:");
  Object.keys(dist).sort().forEach(k => {
    const v = dist[k];
    console.log("    " + (k === "5" ? "5 ou mais" : k + " pedido" + (k === "1" ? "" : "s")) +
      ": " + String(v).padStart(6) + "   " + (v / comCasa * 100).toFixed(1) + "%");
  });
})();
