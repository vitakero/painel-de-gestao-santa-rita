// Roda uma função do portal FINGINDO ser o fornecedor de teste — só leitura.
// Serve pra ver o erro EXATO que ele vê, sem precisar do login dele.
const fs = require("fs"), path = require("path"), { Client } = require("pg");
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8");
const get = k => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim() : ""; };
const EMAIL = process.env.EMAIL || "caroseu2018+fornecedor@gmail.com";
const SQL = process.argv[2] || "select public.forn_agenda_lista('{\"situacoes\":[],\"tipo\":\"\",\"de\":\"\",\"ate\":\"\",\"busca\":\"\",\"limite\":25,\"pula\":0}'::jsonb)";
(async () => {
  const c = new Client({ host: get("PG_HOST"), port: +get("PG_PORT"), database: get("PG_DATABASE"),
    user: get("PG_USER"), password: get("PG_PASSWORD"), ssl: false });
  await c.connect();
  const u = await c.query("select id from auth.users where email = $1", [EMAIL]);
  if (!u.rows.length) { console.log("nao achei o usuario " + EMAIL); await c.end(); return; }
  const uid = u.rows[0].id;
  console.log("fingindo ser: " + EMAIL + "  (" + uid + ")\n");
  await c.query("begin");
  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claims', $1, true)",
    [JSON.stringify({ sub: uid, role: "authenticated", email: EMAIL })]);
  try {
    const r = await c.query(SQL);
    console.log("DEU CERTO:");
    console.log(JSON.stringify(r.rows[0], null, 1).slice(0, 1200));
  } catch (e) {
    console.log("ERRO DO BANCO:");
    console.log("  código : " + e.code);
    console.log("  mensagem: " + e.message);
    if (e.detail) console.log("  detalhe : " + e.detail);
    if (e.hint) console.log("  dica    : " + e.hint);
    if (e.where) console.log("  onde    : " + String(e.where).split("\n")[0]);
  }
  await c.query("rollback"); await c.end();
})();
