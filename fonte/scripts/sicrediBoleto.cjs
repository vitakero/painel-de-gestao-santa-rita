// Cria um BOLETO HÍBRIDO (com Pix / QR Code) na API de Cobrança do Sicredi.
// Por padrão roda no SANDBOX (ambiente de teste, não mexe em dinheiro de verdade).
// Uso:  node scripts/sicrediBoleto.cjs           -> sandbox (teste)
//       node scripts/sicrediBoleto.cjs prod      -> PRODUÇÃO (cobrança real!)
//
// O que ele faz: 1) faz login (pega access_token) 2) cria o boleto híbrido
//                3) mostra o txid, o QR Code (copia-e-cola do Pix), a linha digitável e o código de barras.
// Conta (loja|pf) e ambiente (sandbox|prod) vêm dos argumentos — ver scripts/sicrediConta.cjs.
const { montarCfg } = require("./sicrediConta.cjs");
const cfg = montarCfg(process.argv.slice(2));
const PROD = cfg.prod;
const boletoUrl = cfg.url("/cobranca/boleto/v1/boletos");

// data de vencimento = hoje + 3 dias (YYYY-MM-DD)
function venc(dias) {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

async function autenticar() {
  console.log("\n[1/2] Fazendo login (" + (PROD ? "PRODUÇÃO" : "SANDBOX") + ")...");
  const r = await fetch(cfg.authUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "context": "COBRANCA", "x-api-key": cfg.apiKey },
    body: cfg.authBody,
  });
  const txt = await r.text();
  if (!r.ok) { console.log("  ERRO no login: HTTP " + r.status + "\n  " + txt.slice(0, 400)); process.exit(1); }
  const tok = JSON.parse(txt).access_token;
  console.log("  Login OK. Token pego (" + tok.slice(0, 12) + "...).");
  return tok;
}

async function criarBoleto(token) {
  console.log("[2/2] Criando boleto HÍBRIDO (com Pix)...");
  const body = {
    tipoCobranca: "HIBRIDO",
    codigoBeneficiario: cfg.codigoBeneficiario,
    pagador: {
      tipoPessoa: "PESSOA_FISICA",
      documento: "12345678909",   // CPF de teste (válido nos dígitos verificadores)
      nome: "Cliente Teste Santa Rita",
      endereco: "Rua Teste, 100",
      cidade: "Caico",
      uf: "RN",
      cep: "59300000",
    },
    especieDocumento: "OUTROS",
    seuNumero: "P" + Date.now().toString().slice(-9),  // controle interno (até 10 chars)
    dataVencimento: venc(3),
    valor: 1.99,
    validadeAposVencimento: 30,   // dias que o QR Code segue válido após o vencimento (boleto híbrido)
  };

  const r = await fetch(boletoUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": cfg.apiKey,
      "Authorization": "Bearer " + token,
      "cooperativa": cfg.cooperativa,
      "posto": cfg.posto,
    },
    body: JSON.stringify(body),
  });
  const txt = await r.text();
  console.log("  HTTP " + r.status);
  if (!r.ok) { console.log("  ERRO ao criar:\n  " + txt.slice(0, 800)); process.exit(1); }

  const j = JSON.parse(txt);
  console.log("\n========== BOLETO HÍBRIDO CRIADO! ==========");
  console.log("txid (id da transação Pix): " + (j.txid || "(sem txid)"));
  console.log("Nosso Número:               " + (j.nossoNumero || ""));
  console.log("Cooperativa/Posto:          " + (j.cooperativa || "") + " / " + (j.posto || ""));
  console.log("Linha Digitável:            " + (j.linhaDigitavel || ""));
  console.log("Código de Barras:           " + (j.codigoBarras || ""));
  console.log("\n--- QR CODE PIX (copia-e-cola) ---");
  console.log(j.qrCode || "(sem qrCode - beneficiário pode não ter Pix/Híbrido contratado)");
  console.log("==========================================\n");
}

(async () => {
  console.log("CONTA: " + cfg.rotulo + " | " + (PROD ? "PRODUÇÃO (cobrança real!)" : "SANDBOX (teste)"));
  if (!cfg.apiKey) { console.log("FALTA a x-api-key no .env pra a conta " + cfg.rotulo + " (" + (cfg.conta === "pf" ? (PROD ? "SICREDI_PF_API_KEY_PROD" : "SICREDI_PF_API_KEY") : (PROD ? "SICREDI_API_KEY_PROD" : "SICREDI_API_KEY")) + ")"); return; }
  if (PROD && !cfg.posto) { console.log("FALTA o posto/agência no .env (" + (cfg.conta === "pf" ? "SICREDI_PF_POSTO" : "SICREDI_POSTO") + ", 2 dígitos) pra rodar em produção."); return; }
  const token = await autenticar();
  await criarBoleto(token);
})();
