// Teste de QUEM NÃO É FORNECEDOR TENTANDO ENTRAR NO PORTAL.
//
// O login do painel e o do portal moram no mesmo lugar, então um e-mail de funcionário
// entra na tela do portal. Até 21/08/2026 ele via "Cadastro não encontrado. Fale com a
// loja." — duas coisas ruins de uma vez:
//
//   1. mandava ele cobrar da loja um cadastro que ele não deveria ter;
//   2. CONFIRMAVA, para quem estivesse tentando e-mail por e-mail, que aquele endereço
//      existe em algum sistema da loja.
//
// Agora ele é recusado como qualquer login errado, com a MESMA frase. É o espelho do
// que foi feito no painel no mesmo dia (login-fornecedor-no-painel.test.cjs).
//
// A distinção que não pode se perder: isto vale só para quem NÃO É fornecedor.
// Fornecedor de verdade esperando liberação continua vendo "Cadastro em análise" — esse
// precisa mesmo falar com a loja.
//
//   node scripts/testes/portal-quem-nao-e-fornecedor.test.cjs
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..", "..");
const HTML = fs.readFileSync(path.join(RAIZ, "output", "agendar.html"), "utf8");

let ok = 0, falhou = 0;
function t(nome, cond, extra) {
  if (cond) { ok++; return; }
  falhou++; console.log("  FALHOU: " + nome + (extra ? " -> " + extra : ""));
}

t("existe a recusa silenciosa", HTML.indexOf("function recusarComoErro()") > 0);
// A decisão é do BANCO (forn_minha_situacao), não da tela.
t("quem não é fornecedor cai na recusa",
  HTML.indexOf("if(!d||!d.ok){ recusarComoErro(); return; }") > 0);
t("a tela de 'não encontrado' não é mais montada",
  HTML.indexOf('el("esperaTit").textContent="Cadastro não encontrado"') < 0,
  "essa tela mandava cobrar da loja e confirmava que o e-mail existe");

const fn = HTML.slice(HTML.indexOf("function recusarComoErro()"),
                      HTML.indexOf("function decidirTela()"));
// A MESMA frase que o portal usa quando a senha está errada. Se uma mudar sem a outra,
// quem não é fornecedor volta a ser distinguível.
t("usa a frase de senha errada", fn.indexOf('"Email ou senha errados."') > 0);
t("e é a mesma frase do login", HTML.indexOf('aviso("msgAuth","Email ou senha errados.")') > 0);
// E é a MESMA frase do painel, palavra por palavra: quem erra o login nos dois sistemas
// recebe exatamente a mesma resposta.
const PAINEL = fs.readFileSync(path.join(RAIZ, "output", "index.html"), "utf8");
t("a frase é idêntica à do painel", PAINEL.indexOf('"Email ou senha errados."') > 0);
// Responder igual inclui PARECER igual: caixa colorida de um lado e texto solto do
// outro faz o fornecedor perceber que caiu num lugar diferente.
t("o aviso é texto centralizado, sem caixa", HTML.indexOf(".msg.err{color:var(--verm)}") > 0);
t("e não tem mais fundo nem borda", HTML.indexOf(".msg.err{background:var(--verm-bg)") < 0);

// E FICA NO MESMO LUGAR DO PAINEL: entre o botão Entrar e o "Esqueci minha senha".
// No fim da tela, como era antes, o recado ficava DEPOIS do link e passava despercebido.
const iBt = HTML.indexOf('id="btEntrar"');
const iMsg = HTML.indexOf('id="msgAuth"');
const iLink = HTML.indexOf('id="btIrSenha"');
t("o aviso vem depois do botão Entrar", iBt > 0 && iMsg > iBt);
t("e antes do 'Esqueci minha senha'", iLink > iMsg, "no fim da tela ele passa despercebido");

// A aba "Criar conta" tem a caixa dela, embaixo do próprio botão.
t("a aba de criar conta tem o aviso dela",
  (HTML.match(/class="msg msg-auth"/g) || []).length >= 1);
t("o aviso escreve nas duas caixas", HTML.indexOf('querySelectorAll(".msg-auth")') > 0);
// classList e não className: reescrever a classe inteira contaminava a caixa da tela
// de senha, e um aviso da tela de entrada passaria a escrever nela também.
t("não contamina a caixa da tela de senha", HTML.indexOf('m.classList.add("msg", tipo||"err")') > 0);
t("derruba a sessão", fn.indexOf("SB.auth.signOut()") > 0);
t("mostra a tela mesmo se derrubar falhar", fn.indexOf(".then(mostrarLogin, mostrarLogin)") > 0);
t("volta para a aba de entrar", fn.indexOf('aba("entrar")') > 0 && fn.indexOf('mostrar("telaAuth")') > 0);
t("limpa o campo da senha", fn.indexOf('el("eSenha").value=""') > 0);

// O QUE NÃO PODE SE PERDER: fornecedor de verdade esperando liberação.
t("fornecedor aguardando continua vendo 'Cadastro em análise'",
  HTML.indexOf('var tit="Cadastro em análise"') > 0);
t("fornecedor recusado continua sabendo o motivo",
  HTML.indexOf('tit="Acesso não liberado"') > 0);
t("fornecedor bloqueado continua sabendo o motivo",
  HTML.indexOf('tit="Acesso bloqueado"') > 0);

// O portal também não pode revelar cadastro na recuperação de senha — isso já existia
// e não pode se perder junto.
t("a recuperação de senha também não revela cadastro",
  HTML.indexOf("Se existir cadastro com esse e-mail") > 0);

console.log(falhou ? ("FALHOU: " + falhou + " de " + (ok + falhou)) : ("TUDO OK: " + ok + " testes"));
process.exit(falhou ? 1 : 0);
