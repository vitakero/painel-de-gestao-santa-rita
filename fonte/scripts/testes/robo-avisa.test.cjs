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
const PUB   = fs.readFileSync(path.join(raiz, "scripts", "publicar.cjs"), "utf8");
const FONTE = fs.readFileSync(path.join(raiz, "scripts", "demoDashboard.ts"), "utf8");
const BAT   = fs.readFileSync(path.join(raiz, "robo.bat"), "utf8");

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
  + "\nreturn {rvNivel,rvQuanto,rvTexto,rvIdadeBatimento,rvComRelato,RV_SEM_BATIMENTO};")();

// atalho: uma data ISO de N minutos atrás, para RODAR a regra em vez de só ler o código dela
const atras = (min) => new Date(Date.now() - min * 60000).toISOString();

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
eq("   e NÃO carimba mais 'estou vivo' na chegada", /await avisar\(true, "conferir-pecas"/.test(PECAS), false);
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
// A BARRA VEM EM DOBRO NO ARQUIVO, de proposito. Ver a secao 11: escrita simples, ela virava
// caractere invisivel na tela. Esta prova olha o arquivo; quem olha o RESULTADO e a secao 11.
eq("   e diz o comando pra descobrir o motivo", /cd C:\\\\vr-robo  e depois  robo\.bat/.test(HTML), true);

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

console.log("\n10) o vigia assina no FIM da ronda, nunca na chegada");
// 05/09/2026, o dono: um vigia que assina a folha quando CHEGA não prova ronda nenhuma.
// Até aqui quem carimbava "estou vivo" era a PRIMEIRA etapa (conferir-pecas). Um robô que
// quebrasse na quinta tarefa ficava com carimbo novo — e o painel, que só sabe olhar a idade
// do carimbo, não tinha como desconfiar. Agora quem assina é a ÚLTIMA etapa.
eq("   quem assina é o publicar (última etapa do robô)", /==RONDAFIM-INICIO==/.test(PUB), true);
eq("   e assina dizendo que TERMINOU", /etapa: "rodada-completa"/.test(PUB), true);
eq("   grava na mesma linha que o painel lê", /robo_saude\?on_conflict=id/.test(PUB), true);
eq("   sem a chave, desiste calado (não derruba a publicação)", /if \(!url \|\| !key\) return resolve\(false\)/.test(PUB), true);
eq("   e nunca trava esperando a nuvem", /req\.setTimeout\(8000/.test(PUB), true);

// A ASSINATURA VEM ANTES DE TODAS AS SAÍDAS DE SUCESSO. Pausado, "nada mudou", teto do dia e
// ritmo são todos "a ronda terminou, só não precisou publicar". Se a assinatura ficasse depois
// de qualquer uma delas, uma rodada boa que não publicou apagaria o carimbo e o painel acusaria
// robô morto em 40 minutos — alarme falso, que é o jeito mais rápido de ensinar a ignorar.
const iAssina = PUB.indexOf("await assinarRonda()");
eq("   assina antes de checar a pausa", iAssina >= 0 && iAssina < PUB.indexOf("contents/robo/PAUSADO"), true);
eq("   antes de 'nada mudou'", iAssina < PUB.indexOf("Nada mudou desde a ultima"), true);
eq("   antes do teto do dia", iAssina < PUB.indexOf("Teto do dia"), true);

// PUBLICAÇÃO MANUAL DO MAC NÃO ASSINA: quem precisa estar vivo é o computador da LOJA. Eu
// publicando daqui com FORCAR=1 não prova nada sobre ele — assinaria por ele e esconderia
// exatamente a parada que este aviso existe para mostrar.
eq("   publicação manual do Mac não assina pelo robô", /if \(process\.env\.FORCAR !== "1"\) \{ await assinarRonda\(\); \}/.test(PUB), true);

// E a ronda só CHEGA no publicar se as etapas que travam deram certo — o .bat aborta antes.
eq("   o .bat para se faltar peça", /conferir-pecas\.cjs\r?\nif errorlevel 1 goto pecas/.test(BAT), true);
eq("   para se o VR não for lido", /buildVrData\.cjs\r?\nif errorlevel 1 goto erro/.test(BAT), true);
eq("   para se o painel não for montado", /demoDashboard\.ts\r?\nif errorlevel 1 goto erro/.test(BAT), true);
eq("   e o publicar é mesmo a última etapa", BAT.lastIndexOf("node scripts") === BAT.indexOf("node scripts\\publicar.cjs"), true);

console.log("\n11) A REGRA DOS 40 MINUTOS, RODADA DE VERDADE");
// Até aqui esta regra só era conferida por TEXTO — eu procurava "RV_SEM_BATIMENTO=40" dentro do
// painel e dava por certo. Procurar a linha não é executá-la: o número podia estar lá e a conta
// em volta estar errada, e nenhuma prova quebraria. Aqui a função é chamada com horários de
// verdade, do jeito que o painel chama. O "dado fresco" é de propósito — é o caso que enganava
// o vigia antigo: dado novo na tela e robô morto por trás.
const FRESCO = M.rvTexto(2);   // 2 minutos de dado: sozinho, não gera aviso nenhum
eq("   dado fresco sozinho não acusa nada", FRESCO, null);

eq("   39 minutos ainda é silêncio", M.rvComRelato(FRESCO, { ok: true, quando: atras(39) }), null);
const q40 = M.rvComRelato(FRESCO, { ok: true, quando: atras(41) });
eq("   40 minutos acende", q40 && q40.nivel, "parado");
eq("   e diz que ele parou de DAR SINAL", q40 && q40.titulo, "O robô da loja parou de dar sinal.");
eq("   com o comando pronto pra colar", /cd C:\\vr-robo/.test(q40 && q40.comando), true);
// ISTO FOI UM DEFEITO DE VERDADE, achado em 05/09/2026 por esta prova. A barra de "C:\vr-robo"
// mora dentro do texto gigante que gera o painel, e ali "\v" nao e barra+v: e o codigo invisivel
// de tabulacao vertical. O painel mandava colar "cd C:" + um caractere que ninguem ve + "r-robo"
// — um comando que NAO funciona, no unico aviso cujo trabalho e dar um comando que funcione.
// Todas as provas por texto passavam, porque no ARQUIVO a barra esta la; so quebra quando o
// navegador LE a linha. E por isso que esta secao roda a funcao em vez de procurar a linha.
eq("   e sem nenhum caractere invisivel dentro", /[\x00-\x1f]/.test(q40 && q40.comando), false);
eq("   e a fonte escapa a barra em dobro", /cd C:\\\\\\\\vr-robo/.test(FONTE), true);
eq("   e conta há quanto tempo", /há 41 minutos/.test(q40 && q40.corpo), true);

// SEM CARIMBO NÃO É ALARME. Painel que inventa alarme por falta de dado é painel que ensina
// a ignorar alarme.
eq("   carimbo vazio não inventa alarme", M.rvComRelato(FRESCO, { ok: true, quando: null }), null);
eq("   sem relato nenhum, devolve o que veio", M.rvComRelato(FRESCO, null), FRESCO);

// O OUTRO CAMINHO: o robô CONSEGUIU contar que quebrou. Aí o aviso mostra o motivo dele,
// na hora, sem esperar os 40 minutos — mesmo com o dado da tela novinho.
const contou = M.rvComRelato(FRESCO, { ok: false, quando: atras(1),
  motivo: "Falta configuração no computador da loja.", detalhe: "sumiu SUPABASE_URL",
  comando: "abra o .env" });
eq("   falha contada acende na hora, com dado novo", contou && contou.nivel, "parado");
eq("   e o título vira o motivo real", contou && contou.titulo, "Falta configuração no computador da loja.");

// O CASO DE 03/09 INTEIRO: robô 34 horas parado, dado velho junto.
const velho = M.rvComRelato(M.rvTexto(34 * 60), { ok: true, quando: atras(34 * 60) });
eq("   34 horas paradas continuam acendendo", velho && velho.nivel, "parado");
eq("   e falam em horas, não em 2040 minutos", /há 34 horas/.test(velho && velho.corpo), true);

console.log("\n" + ok + " ok, " + falhou + " falha(s).");
process.exit(falhou ? 1 : 0);
