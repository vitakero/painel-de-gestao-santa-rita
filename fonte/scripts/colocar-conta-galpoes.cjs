// Coloca a conta PESSOA FÍSICA do Gilson (galpões) no robô da loja — 20/10/2026.
//
// COMO USAR (no computador da loja, pela tela preta, dentro da pasta C:\vr-robo):
//     node colocar-conta-galpoes.cjs
// O programa:
//   1. guarda uma cópia do .env de agora (.env.antes-galpoes);
//   2. pede o CÓDIGO DE ACESSO do Gilson (o que o Sicredi mandou, 64 letras e números);
//      e a CHAVE DA APLICAÇÃO "Cobranca Galpoes Producao", só se ela ainda não estiver no .env;
//   3. troca as linhas SICREDI_PF_ do .env pelas novas (não mexe em nenhuma outra linha);
//   4. testa na hora o login no Sicredi com a conta do Gilson e diz se ENTROU.
// Este arquivo não tem nenhuma senha dentro: elas são digitadas (coladas) na hora.
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const ENV = path.join(process.cwd(), ".env");
if (!fs.existsSync(ENV)) { console.log("\nNão achei o arquivo .env nesta pasta (" + process.cwd() + ").\nAbra a tela preta DENTRO da pasta C:\\vr-robo e rode de novo.\n"); process.exit(1); }
const antes = fs.readFileSync(ENV, "utf8");
const pega = k => { const m = antes.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim() : ""; };

// cada linha digitada (ou colada) entra numa fila; cada pergunta espera a próxima linha da fila
const rl = readline.createInterface({ input: process.stdin });
const fila = [], esperando = [];
rl.on("line", l => { const w = esperando.shift(); if (w) w(l); else fila.push(l); });
rl.on("close", () => { while (esperando.length) esperando.shift()(""); });
const pergunta = t => { process.stdout.write(t); return new Promise(r => { if (fila.length) r(String(fila.shift()).trim()); else esperando.push(l => r(String(l || "").trim())); }); };

(async () => {
  console.log("\n=== Conta do Gilson (galpões) no robô da loja ===\n");
  let codigo = "";
  for (;;) {
    codigo = (await pergunta("Cole o CÓDIGO DE ACESSO do Gilson e aperte Enter:\n> ")).replace(/^chaveMaster>/i, "").replace(/\s+/g, "");
    if (/^[0-9A-Fa-f]{64}$/.test(codigo)) break;
    if (!codigo && rl.closed) { console.log("\nNada foi colado. Nada mudou no .env."); process.exit(1); }
    console.log("  Esse código não parece certo (" + codigo.length + " caracteres; o certo tem 64, só letras A-F e números). Tente de novo.\n");
  }
  let chave = pega("SICREDI_PF_API_KEY_PROD");
  if (chave) console.log("\nA chave da aplicação dos galpões já está no .env (" + chave.length + " caracteres): vou manter.");
  else {
    for (;;) {
      chave = (await pergunta("\nCole a CHAVE DA APLICAÇÃO \"Cobranca Galpoes Producao\" (Portal do Desenvolvedor > Minhas Apps > token) e aperte Enter:\n> ")).replace(/\s+/g, "");
      if (chave.length >= 20) break;
      console.log("  Essa chave parece curta demais. Tente de novo.");
    }
  }
  rl.close();

  // 1) cópia de segurança
  const copia = path.join(process.cwd(), ".env.antes-galpoes");
  fs.writeFileSync(copia, antes);
  // 2) troca SÓ as linhas SICREDI_PF_
  const resto = antes.split(/\r?\n/).filter(l => !/^SICREDI_PF_[A-Z_]*=/.test(l));
  while (resto.length && resto[resto.length - 1].trim() === "") resto.pop();
  const bloco = [
    "SICREDI_PF_API_KEY_PROD=" + chave,
    "SICREDI_PF_COOPERATIVA=2207",
    "SICREDI_PF_POSTO=04",
    "SICREDI_PF_BENEFICIARIO=29377",
    "SICREDI_PF_COD_BENEFICIARIO=29377",
    "SICREDI_PF_API_PASSWORD=" + codigo,
  ];
  fs.writeFileSync(ENV, resto.concat([""], bloco).join("\r\n") + "\r\n");
  console.log("\n.env atualizado (cópia do antigo em .env.antes-galpoes). Linhas novas: " + bloco.map(l => l.split("=")[0]).join(", ") + ".");

  // 3) testa o login da conta do Gilson
  console.log("\nTestando o login no Sicredi com a conta do Gilson...");
  try {
    const corpo = "grant_type=password&username=" + encodeURIComponent("29377" + "2207") + "&password=" + encodeURIComponent(codigo) + "&scope=cobranca";
    const r = await fetch("https://api-parceiro.sicredi.com.br/auth/openapi/token", { method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "context": "COBRANCA", "x-api-key": chave }, body: corpo });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.access_token) console.log("\n>>> ENTROU. A conta do Gilson está pronta no robô da loja. <<<\n");
    else console.log("\n>>> NÃO ENTROU (HTTP " + r.status + ": " + (j.error_description || j.error || j.message || "sem detalhe") + ").\n    Confira o código e a chave e rode de novo. O .env antigo está em .env.antes-galpoes.\n");
  } catch (e) { console.log("\n>>> Não consegui falar com o Sicredi (" + e.message + "). Confira a internet e rode de novo.\n"); }
})();
