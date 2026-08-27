// TRAVA: todo script que o robo.bat chama tem que CHEGAR na loja.
//
// 27/08/2026: eu acrescentei uma chamada nova no robo.bat (o conferidor de peças) e
// esqueci de pôr o arquivo nas duas listas — a que o meu deploy envia e a que a loja baixa.
// Se tivesse ido pro ar assim, o robô chamaria um arquivo inexistente, o .bat leria isso
// como falha e ELE SE RECUSARIA A RODAR. Um conserto teria virado uma parada total.
//
//   node scripts/testes/robo-bat-completo.test.cjs
const fs = require("fs");
const path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", "..", f), "utf8");

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + obtido + (bate ? "" : "   (esperado: " + esperado + ")"));
  bate ? ok++ : falhou++;
}

const BAT = R("robo.bat");
const BAIXA = R("scripts/puxar-codigo.cjs");
const ENVIA = R("scripts/deploy-code.cjs");

// tudo que o .bat manda o node rodar
const chamados = [...new Set([...BAT.matchAll(/node\s+scripts\\([a-zA-Z0-9_.-]+\.cjs)/g)].map(m => m[1]))];
eq("achei as chamadas no robo.bat", chamados.length > 0, true);
console.log("        o robo.bat chama: " + chamados.join(", "));

chamados.forEach(f => {
  eq("existe aqui: " + f, fs.existsSync(path.join(__dirname, "..", f)), true);
  eq("o deploy ENVIA: " + f, ENVIA.indexOf("scripts/" + f) >= 0, true);
  eq("a loja BAIXA: " + f, BAIXA.indexOf("robo/" + f) >= 0, true);
});

// o tsx tambem: o .bat chama ele por caminho de pasta, nao por scripts\
eq("o robo.bat usa o tsx de dentro do node_modules", /node node_modules\\tsx/.test(BAT), true);

// e o conferidor de pecas tem que ser a PRIMEIRA coisa depois de baixar o codigo:
// conferir depois de meia rodada nao serve de nada.
const posBaixa = BAT.indexOf("puxar-codigo.cjs");
const posConf = BAT.indexOf("conferir-pecas.cjs");
const posVendas = BAT.indexOf("buildVrData.cjs");
eq("o conferidor vem DEPOIS de baixar o codigo", posBaixa < posConf, true);
eq("e ANTES de ler o VR", posConf < posVendas, true);
eq("a falha do conferidor cancela a rodada", /conferir-pecas\.cjs\r?\nif errorlevel 1 goto pecas/.test(BAT), true);
eq("existe o desvio :pecas no fim", /^:pecas/m.test(BAT), true);

// quebra de linha do Windows: .bat com quebra de linha de Mac se comporta mal la
const cru = fs.readFileSync(path.join(__dirname, "..", "..", "robo.bat"));
const crlf = (cru.toString("binary").match(/\r\n/g) || []).length;
const lfSozinho = (cru.toString("binary").match(/\n/g) || []).length - crlf;
eq("o robo.bat esta com quebra de linha do Windows", lfSozinho, 0);
eq("e tem linhas mesmo", crlf > 20, true);

console.log("\n" + ok + " ok, " + falhou + " falha(s).");
process.exit(falhou ? 1 : 0);
