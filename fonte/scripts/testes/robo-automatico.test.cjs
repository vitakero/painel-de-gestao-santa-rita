// ============================================================
// BANCADA DO "ROBO LIGANDO SOZINHO" — o que não dá para testar, se confere.
//
// Estes dois arquivos rodam no WINDOWS da loja, numa máquina que eu não alcanço. Não há como
// executá-los daqui: a única prova possível antes de instalar é conferir o texto deles contra
// os defeitos que a revisão de 11/10/2026 encontrou. Cada prova abaixo é um defeito que já
// existiu e foi consertado — se alguém reintroduzir, esta bancada acusa.
//
//   node scripts/testes/robo-automatico.test.cjs
// ============================================================
const fs = require("fs");
const path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", "..", f), "utf8");
const B = (f) => fs.readFileSync(path.join(__dirname, "..", "..", f));

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + obtido + (bate ? "" : "   (esperado: " + esperado + ")"));
  bate ? ok++ : falhou++;
}

const BAT = R("robo-loja/instalar-robo-automatico.bat");
// SÓ OS COMANDOS. As provas de "não usa X" têm que olhar o que o cmd EXECUTA, não os
// comentários que explicam por que X foi abandonado nem o texto que aparece na tela — senão
// a própria explicação do conserto derruba a prova do conserto.
const CMD = BAT.split(/\r?\n/)
  .filter(l => !/^\s*(REM|::)/i.test(l) && !/^\s*echo\b/i.test(l))
  .join("\n");
const VBS = R("robo-loja/robo-rodada.vbs");
const ENVIA = R("scripts/deploy-code.cjs");
const BAIXA = R("scripts/puxar-codigo.cjs");

console.log("1) os arquivos CHEGAM na loja (as duas listas, e a senha de conferência)");
// O par do Pix mostra o buraco: é enviado e nunca baixado — está na loja desde que foi
// instalado à mão, sem nunca se atualizar. Estes dois não podem nascer com o mesmo defeito.
eq("   o deploy envia o .vbs", ENVIA.indexOf("robo-loja/robo-rodada.vbs") >= 0, true);
eq("   o deploy envia o instalador", ENVIA.indexOf("robo-loja/instalar-robo-automatico.bat") >= 0, true);
eq("   a loja baixa o .vbs", BAIXA.indexOf('"robo/robo-rodada.vbs"') >= 0, true);
eq("   a loja baixa o instalador", BAIXA.indexOf('"robo/instalar-robo-automatico.bat"') >= 0, true);
eq("   e os dois vão para a RAIZ, como o robo.bat", /\["robo\/robo-rodada\.vbs", "\.\.\/robo-rodada\.vbs"/.test(BAIXA), true);
// a senha: o puxar-codigo só aceita o arquivo se encontrar esta palavra DENTRO dele
eq("   a senha do .vbs existe nos dois lados",
   VBS.indexOf("ROBO-RODADA-VBS") >= 0 && BAIXA.indexOf('"ROBO-RODADA-VBS"') >= 0, true);
eq("   a senha do instalador existe nos dois lados",
   BAT.indexOf("INSTALAR-ROBO-AUTOMATICO") >= 0 && BAIXA.indexOf('"INSTALAR-ROBO-AUTOMATICO"') >= 0, true);

console.log("\n2) o Windows consegue LER os arquivos");
eq("   instalador em CRLF (LF quebra bloco if de várias linhas)", /\r\n/.test(BAT) && !/[^\r]\n/.test(BAT), true);
eq("   .vbs em CRLF", /\r\n/.test(VBS) && !/[^\r]\n/.test(VBS), true);
// acento vira lixo no codepage do cmd — e pior, pode quebrar a linha inteira
eq("   instalador sem byte fora do ASCII", B("robo-loja/instalar-robo-automatico.bat").every(b => b < 128), true);
eq("   .vbs sem byte fora do ASCII", B("robo-loja/robo-rodada.vbs").every(b => b < 128), true);

console.log("\n3) a rodada CONTA o que aconteceu (defeito achado em 11/10/2026)");
// Antes: o .vbs chamava o robo.bat e ia embora. O Agendador via 0x0 para sempre, o
// RestartOnFailure era letra morta, e o texto do robô sumia com a janela invisível.
eq("   guarda a saída do robô em arquivo", /robo-ultimo\.txt/.test(VBS), true);
eq("   captura o código de saída", /codigo = sh\.Run\(/.test(VBS), true);
eq("   espera a rodada terminar (sem isso não há código)", /, 0, True\)/.test(VBS), true);
eq("   e devolve o código ao Agendador", /WScript\.Quit codigo/.test(VBS), true);
// Antes o carimbo era escrito ANTES de rodar: uma rodada que falhava a cada 5 minutos
// mantinha a hora fresca e todo mundo concluía que estava tudo bem.
const posChamada = VBS.indexOf("codigo = sh.Run");
const posTerminou = VBS.indexOf("terminou:");
eq("   o carimbo de término vem DEPOIS da rodada", posTerminou > posChamada && posChamada > 0, true);
eq("   e diz como lê-lo", /resultado 0 e hora de agora ha pouco/.test(VBS), true);

console.log("\n4) o instalador não deixa a loja SEM robô (ordem dos passos)");
// A primeira versão matava o laço antigo logo no começo: qualquer falha depois disso deixaria
// a loja com zero robô — trocar "às vezes para" por "parou de vez".
const posCria = BAT.indexOf("/create /tn \"%TAREFA%\" /xml");
const posMata = BAT.indexOf("Stop-Process");
eq("   cria a tarefa ANTES de matar o laço antigo", posCria > 0 && posMata > posCria, true);
eq("   confere que a tarefa existe mesmo", /schtasks \/query \/tn "%TAREFA%"/.test(BAT), true);
eq("   se falhar, avisa que não tocou no laço antigo", /NAO foi tocado/.test(BAT), true);

console.log("\n5) a morte do laço antigo funciona em Windows atual");
// wmic foi descontinuado e não vem mais no Windows 11 recente: a linha falharia calada, o
// laço antigo continuaria vivo e a loja ficaria com DOIS mandantes.
eq("   não usa wmic", /wmic/i.test(CMD), false);
eq("   usa PowerShell", /powershell -NoProfile/.test(BAT), true);
eq("   e CONFERE se morreu mesmo", /Conferindo se o laco antigo morreu/.test(BAT), true);
eq("   avisa quando não morreu", /AINDA ESTA RODANDO/.test(BAT), true);
// o mini-robô do Pix não pode ser morto junto
eq("   o filtro pega só 'robo-loop'", (BAT.match(/robo-loop\*'/g) || []).length >= 2, true);
eq("   e não encosta no pix-loop", /pix-loop/.test(CMD), false);

console.log("\n5b) duas rodadas nunca se sobrepõem, mesmo se o Agendador falhar");
// Quando o limite de 40 min estoura, o Agendador mata o wscript — mas o cmd e o node que
// estavam embaixo podem sobreviver. A tarefa fica livre, a próxima entra, e duas rodadas
// passam a mexer nos mesmos arquivos. Esta trava não depende do Agendador.
eq("   existe trava de rodada em disco", /robo-rodando\.txt/.test(VBS), true);
eq("   rodada nova sai se a anterior for recente", /DateDiff\("n", quando, Now\) < 40/.test(VBS), true);
eq("   e a trava vence sozinha (não trava o robô para sempre)", /vence sozinha/.test(VBS), true);
eq("   a trava é liberada no fim", /fso\.DeleteFile trava, True/.test(VBS), true);

console.log("\n5c) o laço antigo não volta pela porta dos fundos");
eq("   limpa a inicialização de TODOS os perfis", /for \/d %%u in \("%SystemDrive%\\Users\\\*"\)/.test(CMD), true);
eq("   não confia em %APPDATA% (é de quem elevou)", /%APPDATA%/.test(CMD), false);

console.log("\n6) a tarefa tem as quatro travas que a fazem valer");
eq("   não abre rodada por cima de rodada", /IgnoreNew/.test(BAT), true);
eq("   rodada travada morre em 40 min (padrão seria 72 HORAS)", /ExecutionTimeLimit.>PT40M/.test(BAT), true);
eq("   computador desligado na hora: roda ao ligar", /StartWhenAvailable.>true/.test(BAT), true);
eq("   tenta de novo se falhar", /RestartOnFailure/.test(BAT), true);
eq("   liga junto com o computador", /BootTrigger/.test(BAT), true);
eq("   e repete de 5 em 5 minutos", /Interval.>PT5M/.test(BAT), true);
eq("   roda como SYSTEM (não precisa de login)", /S-1-5-18/.test(BAT), true);
// declarar UTF-16 num arquivo que o echo escreve em ANSI faz o Agendador recusar a receita
eq("   o XML não mente a codificação", /encoding="UTF-16"/.test(BAT), false);

console.log("\n7) não promete o que não provou");
eq("   prova que o SYSTEM enxerga o Node antes de instalar", /where node/.test(BAT), true);
eq("   e para se não enxergar", /PAREI AQUI, DE PROPOSITO/.test(BAT), true);
eq("   teste de administrador não depende do serviço Servidor", /net session/.test(CMD), false);
eq("   e usa a leitura de registro no lugar", CMD.indexOf('reg query "HKU\\S-1-5-19"') >= 0, true);
eq("   diz que o mini-robô do Pix continua como era", /mini-robo do PIX.*continua/s.test(BAT), true);

console.log("\n" + ok + " OK, " + falhou + " falha(s).");
process.exitCode = falhou ? 1 : 0;
