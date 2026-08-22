// SÓ LEITURA — o que o fornecedor de teste tem pra usar no portal.
require("dotenv").config({ path: require("path").join(process.env.HOME, "vr-looker-integration", ".env") });
const U = process.env.SUPABASE_URL, K = process.env.SUPABASE_SERVICE_KEY;
const CNPJ = process.env.CNPJ || "20947638000141";
async function ler(t, q) {
  const r = await fetch(U + "/rest/v1/" + t + "?" + q, { headers: { apikey: K, Authorization: "Bearer " + K, Prefer: "count=exact" } });
  if (!r.ok) return { erro: r.status + " " + (await r.text()).slice(0, 200) };
  return { linhas: await r.json(), faixa: r.headers.get("content-range") };
}
(async () => {
  console.log("CNPJ do teste: " + CNPJ + "\n");
  const f = await ler("receb_fornecedores", "select=id,razao_social,fornecedor_vr&cnpj=eq." + CNPJ);
  const FID = (f.linhas && f.linhas[0]) ? f.linhas[0].id : "00000000-0000-0000-0000-000000000000";
  console.log("-- FICHA: " + JSON.stringify(f.linhas));
  const p = await ler("receb_pedidos", "select=numero,emissao,previsao,situacao,valor_total,saldo_valor,fornecedor_id&fornecedor_id=eq." + FID + "&order=previsao.desc&limit=10");
  console.log("-- PEDIDOS desse fornecedor (" + (p.faixa || "?") + ")");
  console.log(JSON.stringify(p.linhas || p, null, 1).slice(0, 1500));
  const tot = await ler("receb_pedidos", "select=cnpj&limit=1");
  console.log("\n-- total de pedidos na nuvem: " + (tot.faixa || "?"));
  const n = await ler("receb_notas_vr", "select=chave,numero,emissao,emitente_nome,valor_total&emitente_cnpj=eq." + CNPJ + "&order=emissao.desc&limit=5");
  console.log("\n-- NOTAS da Receita desse fornecedor");
  console.log(JSON.stringify(n.linhas || n, null, 1).slice(0, 900));
  const nt = await ler("receb_notas_vr", "select=chave&limit=1");
  console.log("\n-- total de notas na nuvem: " + (nt.faixa || "?"));
})();
