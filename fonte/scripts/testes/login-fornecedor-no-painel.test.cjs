// Teste do LOGIN DE FORNECEDOR QUE CAI NO PAINEL.
//
// O login do Portal do Fornecedor e o do painel moram no mesmo lugar, então o
// fornecedor consegue digitar o email dele na tela do painel. Até 21/08/2026 ele caía
// em "Conta confirmada! Falta o administrador liberar o seu acesso" — e ficava
// esperando uma liberação que nunca viria, porque ele não é funcionário da loja. Ia
// cobrar do dono uma liberação que não existe, e o dono procuraria o nome dele na aba
// Acessos sem achar: fornecedor não tem perfil no painel.
//
// A primeira correção mostrava uma tela explicando "este login é do Portal do
// Fornecedor". O dono recusou, e com razão: aquela tela CONFIRMA, para quem estiver
// tentando email por email, que aquele endereço tem conta em algum lugar da loja.
// O painel não tem por que entregar isso.
//
// Agora o fornecedor é recusado exatamente como qualquer login errado — mesma frase,
// mesma tela. Quem responde "isto é um fornecedor?" é o BANCO, pela eh_fornecedor();
// a tela não adivinha pelo formato do email.
//
//   node scripts/testes/login-fornecedor-no-painel.test.cjs
const fs = require("fs");
const path = require("path");

const HTML = fs.readFileSync(path.join(__dirname, "..", "..", "output", "index.html"), "utf8");

let ok = 0, falhou = 0;
function t(nome, cond, extra) {
  if (cond) { ok++; return; }
  falhou++; console.log("  FALHOU: " + nome + (extra ? " -> " + extra : ""));
}

// Quem decide é o banco.
t("pergunta ao banco se é fornecedor", HTML.indexOf('SB.rpc("eh_fornecedor")') > 0);
t("só recusa quando a resposta é sim, mesmo", HTML.indexOf("rf.data === true") > 0);
// Se a pergunta falhar, cai na tela de espera — o comportamento de antes.
// Melhor a tela errada do que tela nenhuma.
t("falha na pergunta não deixa a tela vazia",
  HTML.indexOf("}, function(){ mostrarEspera(uid); });") > 0);
t("exceção também não deixa a tela vazia",
  HTML.indexOf("catch(e){ mostrarEspera(uid); }") > 0);

// A RECUSA É IGUAL À DE QUALQUER LOGIN ERRADO.
t("existe a recusa silenciosa", HTML.indexOf("function recusarComoErro()") > 0);
t("a recusa é chamada", HTML.indexOf("if(rf && rf.data === true) recusarComoErro();") > 0);
const fn = HTML.slice(HTML.indexOf("function recusarComoErro()"),
                      HTML.indexOf("function mostrarEspera("));
t("usa a MESMA frase de senha errada", fn.indexOf('setMsg("Email ou senha errados."') > 0);
// a mesma frase que traduzErro dá para credencial inválida — se uma mudar sem a
// outra, o fornecedor vira distinguível de novo
t("e essa frase é a mesma que o painel usa para credencial inválida",
  HTML.indexOf('return "Email ou senha errados.";') > 0);
t("derruba a sessão antes de mostrar", fn.indexOf("SB.auth.signOut()") > 0);
t("mostra a tela mesmo se derrubar falhar", fn.indexOf(".then(mostrar, mostrar)") > 0);
t("volta para a tela de entrar", fn.indexOf('document.getElementById("authLoginBox")') > 0);
t("limpa o campo da senha", fn.indexOf('se.value=""') > 0);
// fornecedor nunca é master: não pode sobrar lembrança de acesso liberado
t("limpa a lembrança de acesso liberado",
  fn.indexOf('localStorage.removeItem("sr_lib")') > 0 &&
  fn.indexOf('localStorage.removeItem("sr_master")') > 0);

// NADA no painel pode contar que o Portal do Fornecedor existe para quem não entrou.
t("a tela do caminhão não existe mais", HTML.indexOf('id="authForn"') < 0);
t("nenhuma menção ao portal na tela de login",
  HTML.slice(HTML.indexOf('id="authOv"'), HTML.indexOf('id="authOv"') + 9000)
      .indexOf("Portal do Fornecedor") < 0,
  "a tela de entrada não pode revelar que aquele email existe em outro sistema");

console.log(falhou ? ("FALHOU: " + falhou + " de " + (ok + falhou)) : ("TUDO OK: " + ok + " testes"));
process.exit(falhou ? 1 : 0);
