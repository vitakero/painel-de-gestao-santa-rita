require("dotenv").config({ path: require("path").join(process.env.HOME, "vr-looker-integration", ".env") });
const U = process.env.SUPABASE_URL, K = process.env.SUPABASE_SERVICE_KEY;
async function ler(t, q) {
  const r = await fetch(U + "/rest/v1/" + t + "?" + q, { headers: { apikey: K, Authorization: "Bearer " + K, Prefer: "count=exact" } });
  if (!r.ok) return { erro: r.status + " " + (await r.text()).slice(0, 200) };
  return { linhas: await r.json(), n: (r.headers.get("content-range")||"").split("/")[1] };
}
(async () => {
  console.log("pedidos no total.............: " + (await ler("receb_pedidos","select=id&limit=1")).n);
  console.log("pedidos COM dono.............: " + (await ler("receb_pedidos","select=id&fornecedor_id=not.is.null&limit=1")).n);
  console.log("pedidos SEM dono.............: " + (await ler("receb_pedidos","select=id&fornecedor_id=is.null&limit=1")).n);
  console.log("itens de pedido..............: " + (await ler("receb_pedido_itens","select=id&limit=1")).n);
  console.log("notas da Receita.............: " + (await ler("receb_notas_vr","select=id&limit=1")).n);
  console.log("dicionario de codigos........: " + (await ler("receb_codigos_fornecedor","select=id&limit=1")).n);
  console.log("fornecedores do VR...........: " + (await ler("receb_fornecedores_vr","select=*&limit=1")).n);
  const f = await ler("receb_fornecedores","select=*&cnpj=eq.20947638000141");
  console.log("\nficha do fornecedor de teste:"); console.log(JSON.stringify(f.linhas||f,null,1));
  const p = await ler("receb_pedidos","select=numero,previsao,situacao,fornecedor_vr,saldo_valor&order=previsao.desc&limit=5");
  console.log("\nultimos pedidos na nuvem:"); console.log(JSON.stringify(p.linhas||p,null,1));
})();
