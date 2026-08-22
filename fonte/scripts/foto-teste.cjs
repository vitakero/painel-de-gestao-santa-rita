require("dotenv").config({ path: require("path").join(process.env.HOME, "vr-looker-integration", ".env") });
const U = process.env.SUPABASE_URL, K = process.env.SUPABASE_SERVICE_KEY;
async function ler(t, q) {
  const r = await fetch(U + "/rest/v1/" + t + "?" + q, { headers: { apikey: K, Authorization: "Bearer " + K, Prefer: "count=exact" } });
  if (!r.ok) return { erro: r.status + " " + (await r.text()).slice(0, 200) };
  return { linhas: await r.json(), n: (r.headers.get("content-range")||"").split("/")[1] };
}
(async () => {
  const VR = 63; // vr_id do fornecedor de teste
  const p = await ler("receb_pedidos","select=numero,emissao,previsao,situacao,valor_total,saldo_valor&fornecedor_vr=eq."+VR+"&order=previsao.desc");
  console.log("PEDIDOS do fornecedor de teste (vr_id "+VR+"): " + (p.n||0));
  console.log(JSON.stringify(p.linhas||p,null,1).slice(0,1200));
  if (p.linhas && p.linhas.length) {
    const um = await ler("receb_pedidos","select=id,numero&fornecedor_vr=eq."+VR+"&limit=1");
    const it = await ler("receb_pedido_itens","select=*&pedido_id=eq."+um.linhas[0].id+"&limit=4");
    console.log("\nITENS do pedido "+um.linhas[0].numero+" ("+(it.n||0)+" itens):");
    console.log(JSON.stringify(it.linhas||it,null,1).slice(0,1200));
  }
  const q = await ler("receb_pedidos","select=numero,previsao,fornecedor_vr&situacao=eq.aberto&previsao=gte."+new Date().toISOString().slice(0,10)+"&order=previsao.asc&limit=8");
  console.log("\nPEDIDOS ABERTOS com entrega daqui pra frente: " + (q.n||0));
  console.log(JSON.stringify(q.linhas||q,null,1).slice(0,900));
})();
