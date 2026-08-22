// Cancela (dá BAIXA em) um boleto na API de Cobrança do Sicredi e/ou consulta a situação.
// Uso:
//   node scripts/sicrediBaixa.cjs consultar 600000006        -> sandbox: só consulta a situação
//   node scripts/sicrediBaixa.cjs prod consultar 600000006   -> PRODUÇÃO: só consulta
//   node scripts/sicrediBaixa.cjs prod baixar 600000006      -> PRODUÇÃO: CANCELA o boleto (baixa)
// Baixa = manual seção 7.4 (PATCH .../boletos/{nossoNumero}/baixa, body vazio {}).
// Consulta = manual seção 7.18 (GET .../boletos?codigoBeneficiario=..&nossoNumero=..).
// Conta (loja|pf) + ambiente (sandbox|prod) vêm dos argumentos — ver scripts/sicrediConta.cjs.
const { montarCfg } = require("./sicrediConta.cjs");

const args = process.argv.slice(2).map((a) => a.trim());
const BAIXAR = args.some((a) => a.toLowerCase() === "baixar");
const NOSSO = args.find((a) => /^\d{9}$/.test(a));

const cfg = montarCfg(args);
const PROD = cfg.prod;
const boletosUrl = cfg.url("/cobranca/boleto/v1/boletos");

async function autenticar() {
  const r = await fetch(cfg.authUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "context": "COBRANCA", "x-api-key": cfg.apiKey },
    body: cfg.authBody,
  });
  const txt = await r.text();
  if (!r.ok) { console.log("ERRO no login: HTTP " + r.status + "\n" + txt.slice(0, 400)); process.exit(1); }
  return JSON.parse(txt).access_token;
}

async function consultar(token, nosso) {
  const url = boletosUrl + "?codigoBeneficiario=" + encodeURIComponent(cfg.codigoBeneficiario) + "&nossoNumero=" + encodeURIComponent(nosso);
  const r = await fetch(url, {
    method: "GET",
    headers: { "x-api-key": cfg.apiKey, "Authorization": "Bearer " + token, "cooperativa": cfg.cooperativa, "posto": cfg.posto },
  });
  const txt = await r.text();
  console.log("\n[consulta] HTTP " + r.status);
  if (!r.ok) { console.log(txt.slice(0, 500)); return null; }
  const j = JSON.parse(txt);
  console.log("  Situação:    " + (j.situacao || "?"));
  console.log("  Valor:       R$ " + Number(j.valorNominal || 0).toFixed(2));
  console.log("  Vencimento:  " + (j.dataVencimento || ""));
  console.log("  Pagador:     " + ((j.pagador && j.pagador.nome) || ""));
  if (j.dadosLiquidacao) console.log("  LIQUIDADO em " + j.dadosLiquidacao.data + " — R$ " + Number(j.dadosLiquidacao.valor || 0).toFixed(2));
  return j;
}

async function baixar(token, nosso) {
  const url = boletosUrl + "/" + encodeURIComponent(nosso) + "/baixa";
  const r = await fetch(url, {
    method: "PATCH",
    headers: {
      "x-api-key": cfg.apiKey,
      "Authorization": "Bearer " + token,
      "Content-Type": "application/json",
      "cooperativa": cfg.cooperativa,
      "posto": cfg.posto,
      "codigoBeneficiario": cfg.codigoBeneficiario,
    },
    body: JSON.stringify({}),
  });
  const txt = await r.text();
  console.log("\n[baixa] HTTP " + r.status);
  console.log(txt.slice(0, 500));
  if (r.status === 202) console.log(">>> BAIXA ENVIADA! O título será cancelado (statusComando MOVIMENTO_ENVIADO).");
}

(async () => {
  console.log("CONTA: " + cfg.rotulo + " | " + (PROD ? "PRODUÇÃO" : "SANDBOX"));
  if (!NOSSO) { console.log("Informe o nosso número (9 dígitos). Ex: node scripts/sicrediBaixa.cjs prod consultar 600000006"); return; }
  if (!cfg.apiKey) { console.log("FALTA a x-api-key no .env pra a conta " + cfg.rotulo + "."); return; }
  const token = await autenticar();
  await consultar(token, NOSSO);
  if (BAIXAR) {
    await baixar(token, NOSSO);
    await new Promise((r) => setTimeout(r, 3000));
    await consultar(token, NOSSO); // confere como ficou
  }
})();
