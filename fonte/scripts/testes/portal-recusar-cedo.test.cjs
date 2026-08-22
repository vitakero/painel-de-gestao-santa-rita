// Testes do RECUSAR CEDO do Portal do Fornecedor.
//
// O defeito que isto conserta: as travas da loja (tem pedido? item fora do pedido?
// acima do pedido? pode agendar sem nota?) só eram conferidas no ÚLTIMO clique. O
// fornecedor digitava a nota, vinculava o pedido, anexava documento, escolhia horário,
// preenchia placa e motorista — e só então levava "não consegui agendar". Refazia tudo
// e ligava para o recebimento, que é justamente o que o portal existe para evitar.
//
// A parte perigosa da correção é a tentação de copiar as travas para dentro da tela.
// Tela é fácil de burlar, e duas cópias da mesma regra divergem com o tempo. Por isso
// estes testes vigiam TRÊS coisas, e as três são de segurança:
//
//   1. a tela PERGUNTA ao servidor — não decide nada sozinha;
//   2. quem grava confere a MESMA função, então burlar a tela não agenda;
//   3. a pergunta e o envio final mandam o MESMO pacote — senão um diz "pode" e o
//      outro diz "não pode" sobre a mesma entrega.
//
//   node scripts/testes/portal-recusar-cedo.test.cjs
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..", "..");
const HTML = fs.readFileSync(path.join(RAIZ, "output", "agendar.html"), "utf8");
const SQL  = fs.readFileSync(path.join(RAIZ, "sql", "receb_c23_recusar_cedo.sql"), "utf8");

let ok = 0, falhou = 0;
function t(nome, cond, extra) {
  if (cond) { ok++; return; }
  falhou++; console.log("  FALHOU: " + nome + (extra ? " -> " + extra : ""));
}
const conta = (txt, agulha) => txt.split(agulha).length - 1;

// ------------------------------------------------- 0) o login morre ao fechar o navegador
// Sem isto o portal guardava o login para sempre. Num computador de expedição ou de
// portaria, que é compartilhado, a próxima pessoa entrava como o fornecedor anterior e
// enxergava os pedidos e as notas dele. O painel já fazia certo; o portal ficou de fora.
t("o login não sobrevive ao fechar o navegador",
  HTML.indexOf("storage: window.sessionStorage") > 0,
  "sem isso, em computador compartilhado o próximo entra como o fornecedor anterior");
// E os dois lados guardam do mesmo jeito: divergir aqui é ter duas regras de segurança.
const PAINEL = fs.readFileSync(path.join(RAIZ, "output", "index.html"), "utf8");
t("portal e painel guardam o login do mesmo jeito",
  (HTML.indexOf("window.sessionStorage") > 0) === (PAINEL.indexOf("window.sessionStorage") > 0));
// O Sair também limpa o campo da senha, pelo mesmo motivo do computador compartilhado.
t("sair limpa o campo da senha", HTML.indexOf("computador de portaria") > 0);

// ------------------------------------------------------------------ 1) a tela pergunta
t("a tela pergunta ao servidor", HTML.indexOf("forn_checar_agendamento") > 0);
t("existe a função que pergunta", HTML.indexOf("function checarCedo") > 0);

// Sair da etapa da nota e sair da etapa dos pedidos passam pela pergunta. São os dois
// únicos momentos em que o fornecedor deixa para trás o que as travas olham.
t("sair da nota passa pela pergunta", HTML.indexOf('checarCedo(el("wzAvanca"),') > 0);
t("sair dos pedidos passa pela pergunta", HTML.indexOf('checarCedo(el("wzAvanca"), "docs")') > 0);

// ------------------------------------------------- 2) a tela NÃO tem cópia das regras
// Se um destes aparecer aqui, alguém trouxe a decisão para o navegador — onde qualquer
// um edita. As chaves da loja só podem ser lidas dentro do banco.
["nf_exige_pedido", "nf_bloqueia_item_fora", "nf_bloqueia_acima_pedido", "pode_sem_nota"]
  .forEach(function (regra) {
    t("a tela não carrega a regra " + regra, HTML.indexOf(regra) < 0,
      "a decisão vazou para o navegador");
  });

// A pergunta é só pergunta: nada de gravar por este caminho.
const trecho = HTML.slice(HTML.indexOf("function checarCedo"),
                          HTML.indexOf("function enviarAgendamento"));
t("a pergunta não grava nada", trecho.indexOf("forn_agendar") < 0);
t("a pergunta não sobe documento", trecho.indexOf("storage") < 0);

// ------------------------------------------------------- 3) um pacote só, duas portas
t("existe uma montagem única do pacote", HTML.indexOf("function notasParaServidor") > 0);
t("a pergunta usa a montagem única", trecho.indexOf("notasParaServidor()") > 0);
t("o envio final usa a montagem única", HTML.indexOf("p_notas: notasParaServidor()") > 0);
// exatamente uma montagem: definição + uso na pergunta + uso no envio = 3 aparições.
// Mais que isso quer dizer que alguém montou o pacote de novo em outro lugar.
t("ninguém remonta o pacote por fora", conta(HTML, "notasParaServidor") === 3,
  "apareceu " + conta(HTML, "notasParaServidor") + "x (esperado 3)");

// ----------------------------------------- 4) falha de rede não pode prender ninguém
// A conferência antecipada é um favor. Se o servidor não responder, o fornecedor segue —
// quem barra de verdade continua sendo o gravar, no fim.
t("erro na pergunta deixa seguir", trecho.indexOf("if(r && r.error) return segue();") > 0);
t("promessa recusada também deixa seguir", trecho.indexOf("}, function(){ segue(); });") > 0);
t("exceção também deixa seguir", trecho.indexOf("catch(e){ segue(); }") > 0);

// ------------------------------------------------------------------ 5) o lado do banco
t("o SQL cria a função que decide", SQL.indexOf("create or replace function public.forn_checar_agendamento") > 0);
t("quem grava confere a mesma função",
  SQL.indexOf("v_chk := public.forn_checar_agendamento(p_pedido, p_notas);") > 0);
t("gravar recusa quando a conferência recusa",
  SQL.indexOf("if not coalesce((v_chk->>'ok')::boolean, false) then") > 0);

// As quatro travas continuam existindo, e continuam dentro do banco.
["nf_exige_pedido", "nf_bloqueia_item_fora", "nf_bloqueia_acima_pedido", "pode_sem_nota"]
  .forEach(function (regra) {
    t("a trava " + regra + " continua no banco", SQL.indexOf(regra) > 0);
  });

// Fornecedor A não pode perguntar por fornecedor B: a função só enxerga quem está logado.
t("a pergunta só enxerga quem está logado", SQL.indexOf("public.forn_meu_id()") > 0);
t("roda com poder próprio", SQL.indexOf("security definer set search_path = public") > 0);
t("visitante anônimo não pode perguntar",
  SQL.indexOf("revoke all on function public.forn_checar_agendamento(text, jsonb) from public, anon;") > 0);
t("fornecedor logado pode perguntar",
  SQL.indexOf("grant execute on function public.forn_checar_agendamento(text, jsonb) to authenticated;") > 0);

// A porta velha continua fechada — este arquivo não pode ter reaberto sem querer.
t("forn_agendar continua fora do alcance do portal",
  SQL.indexOf("grant execute on function public.forn_agendar(") < 0);

console.log(falhou ? ("FALHOU: " + falhou + " de " + (ok + falhou)) : ("TUDO OK: " + ok + " testes"));
process.exit(falhou ? 1 : 0);
