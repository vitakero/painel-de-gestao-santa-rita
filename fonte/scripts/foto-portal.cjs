// Foto do estado do Portal do Fornecedor — SÓ LEITURA.
require("dotenv").config({ path: require("path").join(process.env.HOME, "vr-looker-integration", ".env") });
const U = process.env.SUPABASE_URL, K = process.env.SUPABASE_SERVICE_KEY;

async function ler(tab, q) {
  const r = await fetch(U + "/rest/v1/" + tab + "?" + q, {
    headers: { apikey: K, Authorization: "Bearer " + K, Prefer: "count=exact" } });
  if (!r.ok) return { erro: r.status + " " + (await r.text()).slice(0, 120) };
  return { linhas: await r.json(), total: r.headers.get("content-range") };
}
(async () => {
  const hora = new Date().toLocaleString("pt-BR");
  console.log("=== FOTO DO PORTAL — " + hora + " ===\n");

  const loc = await ler("receb_locais", "select=nome,abre,fecha,dias_semana,ativo,folga_entre_entregas_min,aceita_sem_nota,reserva_na_solicitacao");
  console.log("-- CAPACIDADE (receb_locais)"); console.log(JSON.stringify(loc.linhas, null, 1));

  const doc = await ler("receb_docas", "select=*");
  console.log("\n-- DOCAS"); console.log(JSON.stringify(doc.linhas || doc, null, 1));

  const forn = await ler("receb_fornecedores", "select=id,cnpj,razao_social,situacao,pode_sem_nota,criado_em&order=criado_em.desc&limit=20");
  console.log("\n-- FORNECEDORES"); console.log(JSON.stringify(forn.linhas || forn, null, 1));

  const ctas = await ler("receb_fornecedor_contas", "select=email,situacao,criado_em&order=criado_em.desc&limit=20");
  console.log("\n-- CONTAS DE ACESSO"); console.log(JSON.stringify(ctas.linhas || ctas, null, 1));

  const ag = await ler("receb_agendas", "select=*&order=criado_em.desc&limit=20");
  console.log("\n-- AGENDAMENTOS (" + (ag.total || "?") + ")"); console.log(JSON.stringify(ag.linhas || ag, null, 1));

  const bar = await ler("receb_barrados", "select=fornecedor_nome,onde,motivo,vezes,ultima_em&order=ultima_em.desc&limit=10");
  console.log("\n-- TRAVADOS"); console.log(JSON.stringify(bar.linhas || bar, null, 1));

  const ev = await ler("receb_eventos", "select=entidade,acao,de,para,motivo,quando&order=quando.desc&limit=8");
  console.log("\n-- ULTIMOS EVENTOS"); console.log(JSON.stringify(ev.linhas || ev, null, 1));
})();
