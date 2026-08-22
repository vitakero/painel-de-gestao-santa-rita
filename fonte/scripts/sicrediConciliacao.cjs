// Consulta os boletos/Pix LIQUIDADOS (PAGOS) num dia, na API de Cobrança do Sicredi.
// Serve pra "baixa automática": saber sozinho o que já foi pago.
// Por padrão roda no SANDBOX. Uso:
//   node scripts/sicrediConciliacao.cjs                 -> sandbox, dia de hoje
//   node scripts/sicrediConciliacao.cjs 15/07/2026      -> sandbox, dia informado
//   node scripts/sicrediConciliacao.cjs prod            -> PRODUÇÃO, dia de hoje
//   node scripts/sicrediConciliacao.cjs prod 15/07/2026 -> PRODUÇÃO, dia informado
// Conta (loja|pf) + ambiente (sandbox|prod) vêm dos argumentos — ver scripts/sicrediConta.cjs.
const { montarCfg } = require("./sicrediConta.cjs");

const args = process.argv.slice(2).map((a) => a.trim());
const diaArg = args.find((a) => /^\d{2}\/\d{2}\/\d{4}$/.test(a));

const cfg = montarCfg(args);
const PROD = cfg.prod;
const consultaUrl = cfg.url("/cobranca/boleto/v1/boletos/liquidados/dia");

function hojeDDMMYYYY() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return p(d.getDate()) + "/" + p(d.getMonth() + 1) + "/" + d.getFullYear();
}

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

// Consulta um dia (paginando até acabar). Retorna a lista de itens liquidados.
async function consultarDia(token, dia) {
  let pagina = 0, itens = [], hasNext = true;
  while (hasNext) {
    const url = consultaUrl + "?codigoBeneficiario=" + encodeURIComponent(cfg.codigoBeneficiario) +
      "&dia=" + encodeURIComponent(dia) + "&pagina=" + pagina;
    const r = await fetch(url, {
      method: "GET",
      headers: {
        "x-api-key": cfg.apiKey,
        "Authorization": "Bearer " + token,
        "cooperativa": cfg.cooperativa,
        "posto": cfg.posto,
      },
    });
    const txt = await r.text();
    if (r.status === 404) { hasNext = false; break; }          // nada pago nesse dia
    if (!r.ok) { console.log("ERRO na consulta (" + dia + "): HTTP " + r.status + "\n" + txt.slice(0, 400)); process.exit(1); }
    const j = JSON.parse(txt);
    (j.items || []).forEach((it) => itens.push(it));
    hasNext = String(j.hasNext) === "true";
    pagina++;
  }
  return itens;
}

(async () => {
  if (!cfg.apiKey) { console.log("FALTA a x-api-key no .env pra a conta " + cfg.rotulo + "."); return; }
  if (PROD && !cfg.posto) { console.log("FALTA o posto/agência no .env (" + (cfg.conta === "pf" ? "SICREDI_PF_POSTO" : "SICREDI_POSTO") + ")."); return; }
  const dia = diaArg || hojeDDMMYYYY();
  console.log("CONTA: " + cfg.rotulo + " | Consultando PAGOS em " + dia + " (" + (PROD ? "PRODUÇÃO" : "SANDBOX") + ")...");
  const token = await autenticar();
  const itens = await consultarDia(token, dia);

  if (!itens.length) { console.log("Nenhum boleto/Pix liquidado nesse dia."); return; }
  console.log("\n" + itens.length + " título(s) pago(s):\n");
  let total = 0;
  itens.forEach((it) => {
    total += Number(it.valorLiquidado || 0);
    console.log("• Nosso Nº " + (it.nossoNumero || "?") + " | seuNumero " + (it.seuNumero || "-") +
      " | R$ " + Number(it.valorLiquidado || 0).toFixed(2) +
      " | " + (it.dataPagamento || "") + " | via " + (it.tipoLiquidacao || "?"));
  });
  console.log("\nTOTAL liquidado no dia: R$ " + total.toFixed(2));
})();
