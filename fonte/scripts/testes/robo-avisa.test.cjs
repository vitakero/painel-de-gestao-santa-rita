// O ROBÔ CONTA POR QUE PAROU — e o aviso diz o que fazer.
//
// 03/09/2026: o robô ficou 34 horas parado. A trava dele funcionou, o painel avisou, e o dono
// VIU o aviso e não mexeu. Ele estava certo: "alguém precisa olhar o computador do robô" não é
// uma instrução, é um problema transferido. Estas provas cobram que o aviso passe a dizer o
// motivo e o conserto, e que o e-mail saia.
//
//   node scripts/testes/robo-avisa.test.cjs
const fs = require("fs");
const path = require("path");
const raiz = path.join(__dirname, "..", "..");
const HTML  = fs.readFileSync(path.join(raiz, "output", "index.html"), "utf8");
const PECAS = fs.readFileSync(path.join(raiz, "scripts", "conferir-pecas.cjs"), "utf8");
const FUNC  = fs.readFileSync(path.join(raiz, "supabase", "functions", "aviso-robo", "index.ts"), "utf8");
const SQL   = fs.readFileSync(path.join(raiz, "sql", "robo_saude.sql"), "utf8");

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + obtido + (bate ? "" : "   (esperado: " + esperado + ")"));
  bate ? ok++ : falhou++;
}

// o miolo do vigia, extraído do painel gerado
const ini = HTML.indexOf("==ROBOVIGIA-INICIO=="), fim = HTML.indexOf("==ROBOVIGIA-FIM==");
if (ini < 0 || fim < 0) { console.log("ERRO: não achei o vigia no painel (rode o build antes)."); process.exit(1); }
const M = new Function(HTML.slice(HTML.indexOf("*/", ini) + 2, HTML.lastIndexOf("/*", fim))
  + "\nreturn {rvNivel,rvQuanto,rvTexto};")();

console.log("1) o vigia continua medindo certo");
eq("   90 min ainda é 'ok'", M.rvNivel(89), "ok");
eq("   90 min vira atraso", M.rvNivel(90), "atraso");
eq("   6 horas vira parado", M.rvNivel(360), "parado");
eq("   sem leitura não inventa alarme", M.rvNivel(null), "sem");
eq("   fala em horas, não em minutos", M.rvQuanto(120), "há 2 horas");
eq("   e em dias quando passa de 2", M.rvQuanto(60 * 60), "há 2 dias");

console.log("\n2) o robô CONTA o que houve, em todos os caminhos de falha");
eq("   avisa quando falta configuração", /Falta configuração no computador da loja/.test(PECAS), true);
eq("   avisa quando falta peça", /Faltam peças no computador da loja/.test(PECAS), true);
eq("   avisa quando o .env sumiu", /O arquivo de configuração sumiu do computador da loja/.test(PECAS), true);
eq("   e conta também quando dá certo (é o que apaga o aviso)", /await avisar\(true, "conferir-pecas"/.test(PECAS), true);
eq("   toda falha vem com um conserto escrito", (PECAS.match(/await avisar\(false/g) || []).length, 3);

console.log("\n3) a armadilha: avisar quando falta justo o endereço da nuvem");
// Este é o caso que ACONTECEU. Sem cópia do endereço aqui dentro, o robô não teria para onde
// mandar o aviso do próprio problema — ficaria mudo exatamente quando mais precisa falar.
eq("   tem endereço de reserva", /SB_URL_RESERVA = "https:\/\/[a-z0-9]+\.supabase\.co"/.test(PECAS), true);
eq("   e ele é usado quando o .env não tem", /pega\("SUPABASE_URL"\) \|\| SB_URL_RESERVA/.test(PECAS), true);
// A chave de serviço é segredo: não pode ter cópia no código, nem aqui.
eq("   a CHAVE não tem cópia no código", /SERVICE_KEY\s*=\s*"[A-Za-z0-9]/.test(PECAS), false);
eq("   sem a chave, ele desiste em silêncio (não trava o robô)", /if \(!key\) return resolve\(false\)/.test(PECAS), true);

console.log("\n4) A BANCADA NÃO PODE MANDAR E-MAIL DE VERDADE");
// Aconteceu em 05/09/2026: o teste roda o script com PECAS_RAIZ numa pasta de mentira, mas o
// código de aviso lia o .env pelo caminho fixo — pegou a chave real e mandou DOIS e-mails de
// "robô parado" para o dono, sem a loja ter nada. Duas travas, porque avisar por nada é o que
// ensina a pessoa a ignorar aviso de verdade.
eq("   lê o .env pela MESMA raiz do resto do script", /path\.join\(RAIZ, "\.env"\)/.test(PECAS), true);
eq("   e não pelo caminho fixo", /path\.join\(__dirname, "\.\.", "\.env"\)/.test(PECAS), false);
eq("   sabe quando está sob teste", /function ehTeste\(\)/.test(PECAS), true);
eq("   e desiste antes de qualquer chamada", /if \(ehTeste\(\)\) return;/.test(PECAS), true);

console.log("\n5) o PONTO CEGO: quando o robô não consegue nem avisar");
// Testado de verdade em 05/09/2026, renomeando o .env da loja: o robô morreu, não conseguiu
// mandar e-mail NEM gravar no painel (a chave mora no .env), e a tela continuou dizendo "tudo
// certo". O único sinal que sobra é o carimbo de vida do robô ficando velho.
eq("   a mensagem não promete painel quando não gravou", /NAO consegui avisar ninguem/.test(PECAS), true);
eq("   e só diz 'contei' quando contou mesmo", /const gravou = await contarNuvem\(estado\);/.test(PECAS), true);
eq("   o painel vigia o batimento do robô", /var RV_SEM_BATIMENTO=40;/.test(HTML), true);
eq("   sem batimento vira 'parado', mesmo com estado ok", /O robô da loja parou de dar sinal\./.test(HTML), true);
eq("   e diz o comando pra descobrir o motivo", /cd C:\\vr-robo  e depois  robo\.bat/.test(HTML), true);

console.log("\n6) o e-mail não vira barulho");
eq("   só manda em falha, nunca em sucesso", /sucesso não gera e-mail/.test(FUNC), true);
eq("   espera 12h antes de repetir o mesmo motivo", /AVISO_ESPERA_MS = 12 \* 60 \* 60 \* 1000/.test(PECAS), true);
eq("   mas manda na hora se o motivo MUDAR", /antes\.avisado_motivo !== motivo/.test(PECAS), true);
eq("   a chave do Resend fica no Supabase, não na loja", /Deno\.env\.get\("RESEND_API_KEY"\)/.test(FUNC), true);
eq("   e o robô chama a função, não o Resend", /functions\/v1\/aviso-robo/.test(PECAS), true);
eq("   o e-mail leva o conserto junto", /O que fazer:/.test(FUNC), true);

console.log("\n7) o aviso no painel diz o motivo E o conserto");
eq("   lê o relato do robô", /from\("robo_saude"\)/.test(HTML), true);
eq("   troca o título pelo motivo real", /novo\.titulo = String\(saude\.motivo\)/.test(HTML), true);
eq("   desenha o que fazer", /class="rv-fazer"/.test(HTML), true);
eq("   e escapa o texto (veio de fora do painel)", /pxEsc\(t\.comando\)/.test(HTML), true);
eq("   sucesso do robô não vira aviso", /if\(saude && saude\.ok\)\{/.test(HTML), true);
eq("   e com batimento novo o aviso não aparece", /if\(idade!==null && idade>=RV_SEM_BATIMENTO\)\{/.test(HTML), true);
// O TESTE DE 05/09 ACHOU ISTO: o vigia media só a IDADE do dado. Uma falha que começa agora
// deixa o dado fresco por mais 90 minutos — o robô se recusava a rodar e a tela dizia que estava
// tudo bem. Falha contada tem que valer na hora, seja qual for a idade do dado.
eq("   falha contada aparece mesmo com dado novo", /var base = t \|\| \{ nivel:"parado"/.test(HTML), true);
eq("   e sempre no nível mais grave", /var novo = \{ nivel:"parado", ico:"🛑"/.test(HTML), true);
eq("   sem relato, o aviso antigo continua saindo", /rvPintar\(min, null\)/.test(HTML), true);

console.log("\n8) parado deixou de parecer bilhete");
eq("   faixa vermelha cheia", /\.rv-parado \{ background:#8c2c22/.test(HTML), true);
eq("   com pulsação lenta na lateral", /animation:rvPulso/.test(HTML), true);
eq("   que respeita quem pediu menos movimento", /prefers-reduced-motion: reduce\)\{ \.rv-parado::before\{ animation:none/.test(HTML), true);
// Só as regras do aviso — o painel tem um "blink" da Central Operacional que não é nosso.
const CSS_RV = (HTML.match(/\.rv-[a-z:-]+[^{]*\{[^}]*\}/g) || []).join(" ");
eq("   e NÃO pisca (piscar treina a ignorar)", /blink/i.test(CSS_RV), false);
eq("   a pulsação é lenta (2,4s), não nervosa", /rvPulso 2\.4s/.test(CSS_RV), true);

console.log("\n9) quem vê");
eq("   o aviso continua sendo só do master", /if\(!rvEhMaster\(\)\)\{ el\.innerHTML=""; return; \}/.test(HTML), true);
eq("   e a tabela também", /public\.sou_master\(\)/.test(SQL), true);
eq("   uma linha só, não histórico", /check \(id = 'robo'\)/.test(SQL), true);
eq("   tem como desfazer escrito", /drop table if exists public\.robo_saude/.test(SQL), true);

console.log("\n" + ok + " ok, " + falhou + " falha(s).");
process.exit(falhou ? 1 : 0);
