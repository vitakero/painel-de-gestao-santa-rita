// Testes da RECUSA NA DOCA e do PENDENTE QUE VENCE.
//
// Dois buracos que a auditoria do portal deixou abertos:
//
// (A) Quando o caminhão encostava errado, o único botão era "✓ Conferido". Quem recebe
//     ficava com duas saídas ruins: marcar como conferido (mentira que entra na história
//     e no faturamento) ou deixar a linha pendurada para sempre.
//
// (B) Um pedido pendente segurava o horário para SEMPRE. Um "pendente" da semana passada
//     continuava bloqueando aquela hora — ninguém mais agendava ali, e ninguém percebia,
//     porque o horário some da lista sem explicação.
//
// O que estes testes vigiam, e por quê:
//   · o motivo da recusa é exigido no SERVIDOR, não só na tela (tela se burla);
//   · o texto do email vem do BANCO, nunca do navegador (senão vira megafone da loja);
//   · as TRÊS portas que olham horário varrem os vencidos (uma delas é a que ninguém
//     lembra: existem duas ent_solicitar, e o portal usa a de 8 argumentos);
//   · o espelho não devolve uma agenda desconhecida para "solicitada" — isso faria ela
//     voltar a ocupar a doca sozinha;
//   · nenhum prazo inventado: o número de horas nasce NULO até o Victor dizer.
//
//   node scripts/testes/doca-recusa.test.cjs
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..", "..");
const HTML = fs.readFileSync(path.join(RAIZ, "output", "index.html"), "utf8");
const SQL  = fs.readFileSync(path.join(RAIZ, "sql", "receb_c24_doca_e_pendente.sql"), "utf8") +
             fs.readFileSync(path.join(RAIZ, "sql", "receb_c30_recusa_de_quem.sql"), "utf8");
const MAIL = fs.readFileSync(path.join(RAIZ, "supabase", "functions", "aviso-agendamento", "index.ts"), "utf8");

let ok = 0, falhou = 0;
function t(nome, cond, extra) {
  if (cond) { ok++; return; }
  falhou++; console.log("  FALHOU: " + nome + (extra ? " -> " + extra : ""));
}
const conta = (txt, agulha) => txt.split(agulha).length - 1;

// ===================================================== (A) A DOCA PODE RECUSAR
t("existe o botão de recusar a entrega", HTML.indexOf('data-precd="') > 0);
t("o clique chama a recusa de doca",
  HTML.indexOf('clDecidir(rd.getAttribute("data-precd"),"recusado_na_doca")') > 0);

// O botão nasce no MESMO lugar do "Conferido": só quando o dia chegou e só para quem
// pode decidir. Fora disso, marcar o que aconteceu com um caminhão que não veio.
const bloco = HTML.slice(HTML.indexOf("Entregas confirmadas"),
                         HTML.indexOf("Entregas confirmadas") + 1400);
t("só aparece quando o caminhão já era esperado", bloco.indexOf("chegou && clPodeDecidir()") > 0);
t("nasce junto do Conferido", bloco.indexOf("data-precd") > 0 && bloco.indexOf("data-pconf") > 0);

// UMA JANELA SÓ, com a pergunta e o motivo juntos. Dois botões vermelhos na tela,
// com o caminhão na doca e o motorista esperando, viram um clique no mais próximo.
const dec = HTML.slice(HTML.indexOf("function clRecusarEntrega"), HTML.indexOf("function clAvisarFornecedor"));
t("a janela pergunta de quem foi", dec.indexOf('name="clRecTipo"') > 0);
t("as duas escolhas existem",
  dec.indexOf('value="carga"') > 0 && dec.indexOf('value="loja"') > 0);
t("a tela pede o motivo", dec.indexOf("clRecMotivo") > 0);
t("desistir da janela não grava nada", dec.indexOf("if(!sim) return;") > 0);
t("sem escolher de quem foi, não passa", dec.indexOf("Falta dizer o que houve") > 0);
t("motivo em branco não passa na tela", dec.indexOf("Falta dizer o motivo") > 0);
// Voltar e reabrir a janela é melhor que perder o que a pessoa já escolheu.
t("recusa incompleta reabre a janela", dec.split("clRecusarEntrega(id, quem, quando)").length - 1 >= 2);
// Enter dentro do campo de texto é quebra de linha, não "confirmar": a recusa é
// definitiva, e mandar pela metade não tem volta.
t("Enter não confirma a recusa", dec.indexOf("semEnter:true") > 0);
t("o botão é vermelho", dec.indexOf("perigo:true") > 0);

// UMA gravação só. Duas cópias divergiriam — e uma esqueceria de destravar o botão
// ou de avisar o fornecedor.
t("existe uma gravação única", HTML.indexOf("function clEnviarStatus") > 0);
// aprovar / recusar horário / conferido continuam pelo mesmo lugar — a busca é no
// HTML inteiro porque esse trecho mora no clDecidir, e não na janela da recusa.
t("o caminho normal usa a gravação única", HTML.indexOf("clEnviarStatus(id, status, null, quem)") > 0);
t("a recusa usa a mesma gravação",
  dec.indexOf('clEnviarStatus(id, esc.value==="loja" ? "recusado_loja" : "recusado_carga", texto, quem)') > 0);
t("ninguém chama a RPC por fora", conta(HTML, 'sb.rpc("ent_definir_status"') === 1,
  "apareceu " + conta(HTML, 'sb.rpc("ent_definir_status"') + "x");
t("a gravação manda o motivo", HTML.indexOf("p_id:id,p_status:status,p_motivo:motivo||null") > 0);
t("o botão novo também trava enquanto grava", HTML.indexOf("[data-precd=\"'+id+'\"]") > 0);
t("o fornecedor é avisado dos dois tipos de recusa",
  HTML.indexOf('["aprovado","recusado","conferido","recusado_carga","recusado_loja"]') > 0);

// ---- o servidor não confia na tela
t("o servidor aceita o estado novo", SQL.indexOf("'recusado_na_doca'") > 0);
t("o servidor EXIGE o motivo", SQL.indexOf("Escreva o motivo da recusa.") > 0);
t("recusa de doca só depois de aprovado", SQL.indexOf("v_atual <> 'aprovado'") > 0);
t("guarda quem recusou e quando",
  SQL.indexOf("recusado_em") > 0 && SQL.indexOf("recusado_por") > 0);
// O atalho de 2 argumentos não pode ter regra própria: ele só repassa.
t("o atalho de 2 argumentos só repassa",
  SQL.indexOf("return public.ent_definir_status(p_id, p_status, null);") > 0);
t("a versão de 3 argumentos não é chamável por anônimo",
  SQL.indexOf("revoke all on function public.ent_definir_status(uuid,text,text) from public, anon;") > 0);

// ---- o email
t("o email conhece a recusa de doca", MAIL.indexOf('status === "recusado_na_doca"') > 0);
t("os dois tipos estão na lista de permitidos do email",
  MAIL.indexOf('"recusado_carga", "recusado_loja"') > 0);
// Culpa da LOJA não pode usar o texto de recusa: o fornecedor conferiria a carga
// dele, veria que estava certa, e concluiria que a loja joga a culpa nele.
t("o email da loja pede desculpa em vez de cobrar",
  MAIL.indexOf('status === "recusado_loja"') > 0 &&
  MAIL.indexOf("A falha foi nossa") > 0);
t("e não manda ele mexer na mercadoria",
  MAIL.indexOf("Não precisa mexer na mercadoria") > 0);
// e o outro continua cobrando, que é o certo quando a carga tinha problema
t("o email da carga manda acertar antes de reenviar",
  MAIL.indexOf("acertar antes de reenviar") > 0);
// O texto vem do banco (d.motivo, que sai do ent_para_aviso). Se viesse do corpo do
// pedido, qualquer pessoa logada mandaria qualquer coisa assinando como o supermercado.
t("o motivo do email vem do banco", MAIL.indexOf("d.motivo") > 0);
t("o banco devolve o motivo para o email", SQL.indexOf("'motivo',coalesce(r.motivo,'')") > 0);

// ===================================================== (B) O PENDENTE VENCE
t("existe a função que solta o horário", SQL.indexOf("function public.ent_expirar_pendentes()") > 0);
t("a regra da aritmética existe (o horário já passou)",
  SQL.indexOf("(data + hora) at time zone 'America/Fortaleza' < now()") > 0);
t("o prazo da loja é opcional", SQL.indexOf("v_horas is not null and criado_em <") > 0);
// NENHUM prazo inventado: a coluna nasce sem valor.
t("nenhum prazo inventado",
  SQL.indexOf("add column if not exists pendente_vence_horas int;") > 0 &&
  SQL.indexOf("pendente_vence_horas int not null") < 0);
t("ninguém de fora pode chamar a varrida",
  SQL.indexOf("revoke all on function public.ent_expirar_pendentes() from public, anon, authenticated;") > 0);
// TRÊS portas: ver horários livres, solicitar (7 args) e solicitar (8 args, a que o
// portal usa de verdade). Esquecer a de 8 seria consertar a porta que ninguém abre.
t("as três portas varrem antes de responder",
  conta(SQL, "perform public.ent_expirar_pendentes();") === 3,
  "encontrei " + conta(SQL, "perform public.ent_expirar_pendentes();"));
t("a porta de 8 argumentos foi refeita",
  SQL.indexOf("p_descricao text, p_email text)") > 0);

// ===================================================== o espelho e a história
t("o espelho conhece a recusa de doca", SQL.indexOf("when 'recusado_na_doca' then 'entrega_recusada'") > 0);
t("o espelho conhece o expirado", SQL.indexOf("when 'expirado'         then 'expirada'") > 0);
// A armadilha antiga: status desconhecido caía em 'solicitada' e a agenda voltava a
// ocupar a doca sozinha.
t("status desconhecido não vira 'solicitada'", SQL.indexOf("v_sit := coalesce(v_sit, v_sit_atual, 'solicitada');") > 0);
t("nenhum dos dois estados novos segura a janela",
  SQL.indexOf("v_viva := new.status in ('pendente','aprovado','conferido');") > 0);
t("o motivo viaja para o lado novo", SQL.indexOf("motivo            = coalesce(nullif(trim(coalesce(new.motivo, '')), ''), motivo)") > 0);

t("as transições novas existem", SQL.indexOf("('agenda','confirmada','entrega_recusada')") > 0 &&
                                 SQL.indexOf("('agenda','em_recebimento','entrega_recusada')") > 0 &&
                                 SQL.indexOf("('agenda','solicitada','expirada')") > 0);
// A auditoria é a que já existe. Livro paralelo era proibido.
t("a história vai para a receb_eventos", SQL.indexOf("insert into public.receb_eventos") > 0);
t("os dois têm nome próprio na história",
  SQL.indexOf("when 'entrega_recusada' then 'recusou_entrega'") > 0 &&
  SQL.indexOf("when 'expirada' then 'expirou'") > 0);
t("nenhuma tabela de auditoria nova", SQL.indexOf("create table public.receb_eventos") < 0);

// nada é apagado
t("nada é apagado", SQL.indexOf("drop table") < 0 && SQL.indexOf("delete from public.entregas_agendamento") < 0);

console.log(falhou ? ("FALHOU: " + falhou + " de " + (ok + falhou)) : ("TUDO OK: " + ok + " testes"));
process.exit(falhou ? 1 : 0);
