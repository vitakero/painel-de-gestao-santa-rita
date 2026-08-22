// Teste de autenticação na API de Cobrança do Sicredi (só faz "login", não cria boleto).
// Uso:
//   node scripts/sicrediTest.cjs           -> LOJA (PJ)  — sandbox + produção
//   node scripts/sicrediTest.cjs pf         -> GALPÕES (PF, Gilson) — sandbox + produção
// (o "prod" é testado sempre; o sandbox também. O rótulo mostra qual conta está sendo usada.)
const { montarCfg, credenciais, contaDosArgs, ehProd, BASE, lerEnv } = require("./sicrediConta.cjs");

const argv = process.argv.slice(2);
const conta = contaDosArgs(argv);
const get = lerEnv();
const c = credenciais(conta, get);

// header comum
const H = (apiKey) => ({ "Content-Type": "application/x-www-form-urlencoded", "context": "COBRANCA", "x-api-key": apiKey });
function body(user, pass) { return "grant_type=password&username=" + encodeURIComponent(user) + "&password=" + encodeURIComponent(pass) + "&scope=cobranca"; }

const sb = montarCfg(argv.concat([]));                 // sandbox (sem "prod")
const pd = montarCfg(argv.concat(["prod"]));           // produção
const benef = c.beneficiario || "", coop = c.cooperativa || "";

const TENTATIVAS = [
  { nome: "SANDBOX (teste fixo 123456789/teste123 + context COBRANCA)", url: sb.authUrl, headers: H(sb.apiKey), body: sb.authBody },
  { nome: "PRODUÇÃO user=benef+coop (" + benef + "+" + coop + ")", url: pd.authUrl, headers: H(pd.apiKey), body: body(benef + coop, c.codigoAcesso) },
  { nome: "PRODUÇÃO user=coop+benef (" + coop + "+" + benef + ")", url: pd.authUrl, headers: H(pd.apiKey), body: body(coop + benef, c.codigoAcesso) },
];

async function tentar(t) {
  console.log("\n=== " + t.nome + " ===");
  console.log("POST " + t.url);
  if (!t.headers["x-api-key"]) { console.log("  (pulado: x-api-key ausente no .env pra esta conta)"); return; }
  try {
    const r = await fetch(t.url, { method: "POST", headers: t.headers, body: t.body });
    const txt = await r.text();
    console.log("HTTP " + r.status);
    console.log(txt.slice(0, 600));
    if (r.ok) console.log(">>> FUNCIONOU! <<<");
  } catch (e) {
    console.log("ERRO de conexão: " + e.message);
  }
}

(async () => {
  console.log("CONTA: " + c.rotulo);
  console.log("Beneficiário:", benef || "(vazio)", "| Cooperativa:", coop || "(vazio)", "| Posto:", c.posto || "(vazio)");
  console.log("x-api-key sandbox:", sb.apiKey ? "(preenchida)" : "(VAZIA)", "| x-api-key prod:", pd.apiKey ? "(preenchida)" : "(VAZIA)", "| Código de Acesso:", c.codigoAcesso ? "(preenchido)" : "(VAZIO)");
  for (const t of TENTATIVAS) await tentar(t);
  console.log("\n--- fim dos testes ---");
})();
