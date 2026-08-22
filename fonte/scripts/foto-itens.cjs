require("dotenv").config({ path: require("path").join(process.env.HOME, "vr-looker-integration", ".env") });
const U = process.env.SUPABASE_URL, K = process.env.SUPABASE_SERVICE_KEY, fs = require("fs");
(async () => {
  const h = { apikey: K, Authorization: "Bearer " + K };
  const ped = await (await fetch(U + "/rest/v1/receb_pedidos?select=id,numero,situacao,emissao,previsao,valor_total,saldo_valor&numero=eq.23102", { headers: h })).json();
  const it = await (await fetch(U + "/rest/v1/receb_pedido_itens?select=seq,codigo,descricao,unidade,qtd_pedida,qtd_entregue,saldo,valor_unit&pedido_id=eq." + ped[0].id + "&order=seq", { headers: h })).json();
  const p = ped[0];
  const fmt = d => d ? d.split("-").reverse().join("/") : null;
  fs.writeFileSync(process.env.HOME + "/vr-looker-integration/.previa/pedido.json", JSON.stringify({
    pedido: { id: p.id, numero: p.numero, situacao: p.situacao, emissao: fmt(p.emissao), previsao: fmt(p.previsao) },
    itens: it }, null, 1));
  console.log("pedido " + p.numero + " · " + it.length + " itens salvos");
})();
