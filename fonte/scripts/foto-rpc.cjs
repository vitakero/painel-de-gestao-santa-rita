// Chama uma função do banco e mostra a resposta CRUA — inclusive o erro.
require("dotenv").config({ path: require("path").join(process.env.HOME, "vr-looker-integration", ".env") });
const U = process.env.SUPABASE_URL, K = process.env.SUPABASE_SERVICE_KEY;
const nome = process.argv[2], args = process.argv[3] ? JSON.parse(process.argv[3]) : {};
(async () => {
  const r = await fetch(U + "/rest/v1/rpc/" + nome, {
    method: "POST",
    headers: { apikey: K, Authorization: "Bearer " + K, "Content-Type": "application/json" },
    body: JSON.stringify(args) });
  const t = await r.text();
  console.log("HTTP " + r.status);
  console.log(t.slice(0, 900));
})();
