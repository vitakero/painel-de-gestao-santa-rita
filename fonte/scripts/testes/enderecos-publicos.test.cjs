// Testes dos ENDEREÇOS QUE SAEM DA LOJA.
//
// Dois links do painel vão parar na mão de gente de fora:
//   · o do Portal do Fornecedor, que a loja copia e manda pro fornecedor;
//   · o da conferência pública da assinatura, que vai impresso no recibo.
//
// Até 21/08/2026 os dois apontavam para "painel-de-gestao-santa-rita.vercel.app" — o
// endereço cru da hospedagem. Quem recebe isso num WhatsApp não reconhece a loja, e
// link que ninguém reconhece parece golpe. O fornecedor simplesmente não clica.
//
// O domínio próprio já existia e servia o mesmo arquivo; ninguém tinha trocado.
//
//   node scripts/testes/enderecos-publicos.test.cjs
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..", "..");
const TS = fs.readFileSync(path.join(RAIZ, "scripts", "demoDashboard.ts"), "utf8");
const HTML = fs.readFileSync(path.join(RAIZ, "output", "index.html"), "utf8");

let ok = 0, falhou = 0;
function t(nome, cond, extra) {
  if (cond) { ok++; return; }
  falhou++; console.log("  FALHOU: " + nome + (extra ? " -> " + extra : ""));
}

// Nenhum endereço cru de hospedagem no que o painel mostra. Vale para o arquivo
// gerado, não só para a fonte: é o gerado que chega no navegador.
["vercel.app", "github.io", "netlify.app", "localhost"].forEach(function (cru) {
  const n = HTML.split(cru).length - 1;
  t("nenhum endereço '" + cru + "' no painel publicado", n === 0, "apareceu " + n + "x");
});

// E os dois links apontam para o domínio do supermercado.
t("o link do fornecedor usa o domínio próprio",
  TS.indexOf('var CL_AGENDAR_URL="https://portaldofornecedor.supermercadosantarita.com.br/"') > 0);
t("a conferência da assinatura usa o domínio próprio",
  TS.indexOf('var PX_CONFERIR_URL="https://painel.supermercadosantarita.com.br/conferir.html"') > 0);

// Todo endereço público tem que ser do supermercado — se aparecer um domínio novo,
// este teste obriga a olhar.
const fora = (HTML.match(/https:\/\/[a-z0-9.-]+/gi) || [])
  .map(function (u) { return u.replace("https://", "").toLowerCase(); })
  .filter(function (h) {
    return h.indexOf("supermercadosantarita.com.br") < 0
        && h.indexOf("supabase") < 0            // o banco
        && h.indexOf("googleapis") < 0          // fontes
        && h.indexOf("gstatic") < 0
        && h.indexOf("jsdelivr") < 0            // bibliotecas
        && h.indexOf("unpkg") < 0
        && h.indexOf("maps.google") < 0         // o mapa da loja
        && h.indexOf("w3.org") < 0              // namespace de SVG, não é link
        && h.indexOf("openstreetmap") < 0
        && h.indexOf("tile.") < 0
        && h.indexOf("wa.me") < 0               // WhatsApp
        // integrações de verdade, cada uma com um porquê:
        && h.indexOf("api.bcb.gov.br") < 0      // Banco Central: consulta de Pix/banco
        && h.indexOf("brasilapi.com.br") < 0    // consulta de CNPJ
        && h.indexOf("publica.cnpj.ws") < 0     // consulta de CNPJ (o outro caminho)
        && h.indexOf("cdnjs.cloudflare.com") < 0 // biblioteca
        && h.indexOf("api.anthropic.com") < 0   // transcrição de voz
        && h.indexOf("api.openai.com") < 0;     // transcrição de voz (o outro caminho)
  });
const unicos = Object.keys(fora.reduce(function (a, h) { a[h] = 1; return a; }, {}));
t("nenhum endereço de fora inesperado", unicos.length === 0, unicos.join(", "));

// O texto da janela diz para que serve o link. "Copiei o link!" sozinho não conta a
// quem mandar nem o que a pessoa vai encontrar do outro lado.
t("a janela explica para que serve", HTML.indexOf("é por aqui que ele se cadastra") > 0);

console.log(falhou ? ("FALHOU: " + falhou + " de " + (ok + falhou)) : ("TUDO OK: " + ok + " testes"));
process.exit(falhou ? 1 : 0);
