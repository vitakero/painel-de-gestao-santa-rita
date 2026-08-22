// Seletor de CONTA Sicredi para as ferramentas de Cobrança.
//   "loja"  = conta PJ da loja (padrão — comportamento antigo, credenciais SICREDI_*)
//   "pf"    = conta PESSOA FÍSICA do dono (galpões — credenciais SICREDI_PF_*)
//
// NÃO faz chamada de rede e NÃO imprime segredo. Só resolve QUAL conjunto do .env usar
// e monta o cfg comum (auth + endpoints) que as ferramentas já esperavam.
//
// Detecção pelos argumentos (ordem livre, não colide com "prod"/nº do boleto):
//   node scripts/sicrediBoleto.cjs            -> loja, sandbox   (igual antes)
//   node scripts/sicrediBoleto.cjs prod       -> loja, produção  (igual antes)
//   node scripts/sicrediBoleto.cjs pf         -> galpões(PF), sandbox
//   node scripts/sicrediBoleto.cjs prod pf    -> galpões(PF), produção
const fs = require("fs");
const path = require("path");

const BASE = "https://api-parceiro.sicredi.com.br";

function lerEnv() {
  const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8");
  return (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim() : ""; };
}

// "pf" se algum argumento for pf/galpao/galpoes; senão "loja".
function contaDosArgs(argv) {
  const toks = (argv || []).map((s) => String(s).toLowerCase().trim());
  const pf = toks.some((t) => t === "pf" || t === "galpao" || t === "galpão" || t === "galpoes" || t === "galpões");
  return pf ? "pf" : "loja";
}
function ehProd(argv) {
  return (argv || []).map((s) => String(s).toLowerCase().trim()).includes("prod");
}

// Credenciais REAIS (produção) da conta escolhida. Sandbox usa valores fixos de teste (ver montarCfg).
function credenciais(conta, get) {
  get = get || lerEnv();
  if (conta === "pf") {
    return {
      rotulo: "GALPÕES (PF — Gilson)",
      // cooperativa da PF é a mesma 2207; deixo explícito e com fallback pra loja por segurança.
      cooperativa: get("SICREDI_PF_COOPERATIVA") || get("SICREDI_COOPERATIVA"),
      posto: get("SICREDI_PF_POSTO"),                                        // 04
      beneficiario: get("SICREDI_PF_BENEFICIARIO"),                          // 29377
      codBeneficiario: get("SICREDI_PF_COD_BENEFICIARIO") || get("SICREDI_PF_BENEFICIARIO"),
      apiKeySandbox: get("SICREDI_PF_API_KEY"),
      apiKeyProd: get("SICREDI_PF_API_KEY_PROD"),
      codigoAcesso: get("SICREDI_PF_API_PASSWORD"),                          // Código de Acesso do Internet Banking do Gilson
    };
  }
  return {
    rotulo: "LOJA (PJ)",
    cooperativa: get("SICREDI_COOPERATIVA"),
    posto: get("SICREDI_POSTO"),
    beneficiario: get("SICREDI_BENEFICIARIO"),
    codBeneficiario: get("SICREDI_COD_BENEFICIARIO") || get("SICREDI_BENEFICIARIO"),
    apiKeySandbox: get("SICREDI_API_KEY"),
    apiKeyProd: get("SICREDI_API_KEY_PROD"),
    codigoAcesso: get("SICREDI_API_PASSWORD"),
  };
}

// Monta o cfg comum a partir dos argumentos da linha de comando.
function montarCfg(argv) {
  const get = lerEnv();
  const prod = ehProd(argv);
  const conta = contaDosArgs(argv);
  const c = credenciais(conta, get);
  const pref = prod ? "" : "/sb";                 // sandbox mora sob /sb
  const cfg = {
    conta, rotulo: c.rotulo, prod,
    context: "COBRANCA",                          // header obrigatório (manual pág 13)
    authUrl: BASE + pref + "/auth/openapi/token",
    url: (suf) => BASE + pref + suf,              // ex.: cfg.url("/cobranca/boleto/v1/boletos")
  };
  if (prod) {
    cfg.apiKey = c.apiKeyProd;
    cfg.cooperativa = c.cooperativa;
    cfg.posto = c.posto;
    cfg.codigoBeneficiario = c.codBeneficiario;
    // produção: username = Beneficiário + Cooperativa ; password = Código de Acesso (Internet Banking)
    cfg.authBody = "grant_type=password&username=" + encodeURIComponent(c.beneficiario + c.cooperativa) +
                   "&password=" + encodeURIComponent(c.codigoAcesso) + "&scope=cobranca";
  } else {
    cfg.apiKey = c.apiKeySandbox;
    // sandbox: valores FIXOS do manual (não dependem da conta real)
    cfg.cooperativa = "6789";
    cfg.posto = "03";
    cfg.codigoBeneficiario = "12345";
    cfg.authBody = "grant_type=password&username=123456789&password=teste123&scope=cobranca";
  }
  return cfg;
}

module.exports = { BASE, lerEnv, contaDosArgs, ehProd, credenciais, montarCfg };
