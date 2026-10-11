@echo off
REM ============================================================================
REM INSTALAR-ROBO-AUTOMATICO - faz o robo da loja ligar sozinho e nunca ficar parado.
REM
REM A palavra INSTALAR-ROBO-AUTOMATICO na linha acima e a senha de conferencia do download:
REM sem ela o puxar-codigo recusa o arquivo e a loja fica com a versao velha.
REM
REM O QUE ESTE ARQUIVO FAZ, EM UMA FRASE: ensina o Windows a cuidar do robo.
REM
REM Ate hoje quem mandava o robo trabalhar era um laco (robo-loop.vbs) que alguem tinha que
REM abrir a mao. Se ele morresse - janela fechada sem querer, Windows reiniciando de
REM madrugada, falta de luz - ninguem o religava, e o robo ficava parado ate alguem perceber.
REM Ele pediu em 11/10/2026: "quando o computador ligar, ele liga novamente, automatico, sem
REM ninguem mexer".
REM
REM Agora quem repete e o AGENDADOR DE TAREFAS do Windows, que foi feito para isso:
REM   - QUANDO O COMPUTADOR LIGA, ele chama o robo (mesmo antes de alguem fazer login);
REM   - e de 5 em 5 minutos, para sempre, ele chama de novo;
REM   - se a rodada anterior ainda estiver correndo, ele NAO abre outra por cima;
REM   - se uma rodada travar, ele a encerra em 40 minutos e a proxima entra no lugar;
REM   - se o computador estava desligado na hora marcada, ele roda assim que ligar.
REM
REM A ORDEM DOS PASSOS AQUI E DE PROPOSITO, e foi corrigida em 11/10/2026 depois da revisao:
REM a tarefa nova e criada e PROVADA ANTES de o laco antigo ser desligado. Na primeira versao
REM era o contrario, e qualquer falha no meio deixaria a loja com ZERO robo - trocando um
REM problema de "as vezes para" por um de "parou de vez".
REM
REM COMO USAR: clique com o BOTAO DIREITO neste arquivo e escolha
REM            "Executar como administrador". Uma vez so.
REM ============================================================================
setlocal EnableExtensions
title Instalar o robo automatico - Santa Rita

echo ================================================================
echo   ROBO DA LOJA - INSTALAR O "LIGAR SOZINHO"
echo ================================================================
echo.

REM ---------------------------------------------------------------------------
REM 1) PRECISA SER ADMINISTRADOR.
REM    A prova e ler uma chave do registro que so administrador alcanca. O teste anterior era
REM    "net session", que diz "nao e administrador" quando o servico Servidor esta desligado -
REM    e ai o instalador recusaria quem tinha todo o direito, sem explicacao.
REM ---------------------------------------------------------------------------
reg query "HKU\S-1-5-19" >nul 2>&1
if errorlevel 1 (
  echo   NAO DEU: este arquivo precisa ser aberto como ADMINISTRADOR.
  echo.
  echo   Feche esta janela, clique com o BOTAO DIREITO em
  echo   instalar-robo-automatico.bat e escolha "Executar como administrador".
  echo.
  pause
  exit /b 1
)

set "PASTA=C:\vr-robo"
set "TAREFA=ROBO SANTA RITA"

REM ---------------------------------------------------------------------------
REM 2) AS PECAS PRECISAM ESTAR NO LUGAR.
REM ---------------------------------------------------------------------------
if not exist "%PASTA%\robo.bat" (
  echo   NAO DEU: nao achei %PASTA%\robo.bat
  echo   O robo precisa estar instalado em %PASTA% antes deste passo.
  echo.
  pause
  exit /b 1
)
if not exist "%PASTA%\robo-rodada.vbs" (
  echo   NAO DEU: nao achei %PASTA%\robo-rodada.vbs
  echo   Esse arquivo vem junto com o robo: deixe o robo rodar uma vez que ele se baixa
  echo   sozinho, e depois abra este instalador de novo.
  echo.
  pause
  exit /b 1
)

REM ---------------------------------------------------------------------------
REM 3) O NODE PRECISA EXISTIR PARA A CONTA SYSTEM.
REM    A tarefa roda como SYSTEM, que e a primeira vez que o robo sai do usuario conectado.
REM    Se o node tiver sido instalado so para o usuario da loja, o PATH do SYSTEM nao o ve, e
REM    toda rodada morreria na primeira linha - em silencio, com o Agendador dizendo que
REM    chamou direitinho. Entao a gente PERGUNTA ao proprio SYSTEM onde esta o node, antes de
REM    prometer qualquer coisa.
REM ---------------------------------------------------------------------------
echo   [1/6] Perguntando ao Windows se o robo enxerga o Node...
del /q "%PASTA%\output\onde-node.txt" >nul 2>&1
if not exist "%PASTA%\output" mkdir "%PASTA%\output" >nul 2>&1
schtasks /create /tn "ROBO SANTA RITA - TESTE" /sc once /st 23:59 /ru SYSTEM /rl HIGHEST /f /tr "cmd /c where node > \"%PASTA%\output\onde-node.txt\" 2>&1" >nul 2>&1
schtasks /run /tn "ROBO SANTA RITA - TESTE" >nul 2>&1
REM espera ate 10 segundos pelo resultado (ping no proprio micro = pausa sem depender de nada)
for /l %%s in (1,1,10) do (
  if not exist "%PASTA%\output\onde-node.txt" ping -n 2 127.0.0.1 >nul
)
schtasks /delete /tn "ROBO SANTA RITA - TESTE" /f >nul 2>&1
find /i "node.exe" "%PASTA%\output\onde-node.txt" >nul 2>&1
if errorlevel 1 (
  echo.
  echo   PAREI AQUI, DE PROPOSITO: a conta do sistema nao acha o Node.
  echo.
  echo   Isso quer dizer que o Node foi instalado so para o usuario que esta logado.
  echo   Se eu continuasse, a tarefa seria criada e TODA rodada falharia em silencio.
  echo.
  echo   O conserto: reinstalar o Node marcando "para todos os usuarios"
  echo   ^(ou mandar esta tela para o Victor^).
  echo   O laco antigo do robo NAO foi tocado: a loja continua como estava.
  echo.
  pause
  exit /b 1
)
echo         ok, o Node esta visivel para o sistema.

REM ---------------------------------------------------------------------------
REM 4) ESCREVER A RECEITA DA TAREFA, EM XML.
REM    Vai por XML, e nao pela linha de comando do schtasks, por causa de quatro ajustes que
REM    so existem aqui e que sao o coracao do "nunca mais parar":
REM      ExecutionTimeLimit PT40M  - rodada travada e encerrada em 40 min (pela linha de
REM                                  comando o padrao sao 72 HORAS: o robo ficaria tres dias
REM                                  parado achando que estava trabalhando);
REM      IgnoreNew                 - nao abre uma rodada por cima da outra;
REM      StartWhenAvailable        - computador desligado na hora marcada? roda assim que ligar;
REM      RestartOnFailure          - rodada que falha e tentada de novo em 1 min, 3 vezes.
REM    O arquivo sai em ANSI (e o que o "echo" do cmd escreve) e por isso NAO se declara
REM    UTF-16 no cabecalho: declarar uma codificacao que o arquivo nao tem faz o Agendador
REM    recusar a receita inteira.
REM ---------------------------------------------------------------------------
echo   [2/6] Escrevendo a receita da tarefa...
set "XML=%TEMP%\robo-santa-rita.xml"
>  "%XML%" echo ^<?xml version="1.0"?^>
>> "%XML%" echo ^<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task"^>
>> "%XML%" echo   ^<RegistrationInfo^>
>> "%XML%" echo     ^<Description^>Mantem o robo do Painel Santa Rita sempre rodando: liga junto com o computador e repete de 5 em 5 minutos. Instalado por instalar-robo-automatico.bat.^</Description^>
>> "%XML%" echo   ^</RegistrationInfo^>
>> "%XML%" echo   ^<Triggers^>
>> "%XML%" echo     ^<BootTrigger^>
>> "%XML%" echo       ^<Enabled^>true^</Enabled^>
>> "%XML%" echo       ^<Delay^>PT2M^</Delay^>
>> "%XML%" echo     ^</BootTrigger^>
>> "%XML%" echo     ^<TimeTrigger^>
>> "%XML%" echo       ^<Repetition^>
>> "%XML%" echo         ^<Interval^>PT5M^</Interval^>
>> "%XML%" echo         ^<StopAtDurationEnd^>false^</StopAtDurationEnd^>
>> "%XML%" echo       ^</Repetition^>
>> "%XML%" echo       ^<StartBoundary^>2026-01-01T00:00:00^</StartBoundary^>
>> "%XML%" echo       ^<Enabled^>true^</Enabled^>
>> "%XML%" echo     ^</TimeTrigger^>
>> "%XML%" echo   ^</Triggers^>
>> "%XML%" echo   ^<Principals^>
>> "%XML%" echo     ^<Principal id="Author"^>
>> "%XML%" echo       ^<UserId^>S-1-5-18^</UserId^>
>> "%XML%" echo       ^<RunLevel^>HighestAvailable^</RunLevel^>
>> "%XML%" echo     ^</Principal^>
>> "%XML%" echo   ^</Principals^>
>> "%XML%" echo   ^<Settings^>
>> "%XML%" echo     ^<MultipleInstancesPolicy^>IgnoreNew^</MultipleInstancesPolicy^>
>> "%XML%" echo     ^<DisallowStartIfOnBatteries^>false^</DisallowStartIfOnBatteries^>
>> "%XML%" echo     ^<StopIfGoingOnBatteries^>false^</StopIfGoingOnBatteries^>
>> "%XML%" echo     ^<AllowHardTerminate^>true^</AllowHardTerminate^>
>> "%XML%" echo     ^<StartWhenAvailable^>true^</StartWhenAvailable^>
>> "%XML%" echo     ^<RunOnlyIfNetworkAvailable^>false^</RunOnlyIfNetworkAvailable^>
>> "%XML%" echo     ^<AllowStartOnDemand^>true^</AllowStartOnDemand^>
>> "%XML%" echo     ^<Enabled^>true^</Enabled^>
>> "%XML%" echo     ^<Hidden^>false^</Hidden^>
>> "%XML%" echo     ^<RunOnlyIfIdle^>false^</RunOnlyIfIdle^>
>> "%XML%" echo     ^<WakeToRun^>false^</WakeToRun^>
>> "%XML%" echo     ^<ExecutionTimeLimit^>PT40M^</ExecutionTimeLimit^>
>> "%XML%" echo     ^<Priority^>7^</Priority^>
>> "%XML%" echo     ^<RestartOnFailure^>
>> "%XML%" echo       ^<Interval^>PT1M^</Interval^>
>> "%XML%" echo       ^<Count^>3^</Count^>
>> "%XML%" echo     ^</RestartOnFailure^>
>> "%XML%" echo   ^</Settings^>
>> "%XML%" echo   ^<Actions Context="Author"^>
>> "%XML%" echo     ^<Exec^>
>> "%XML%" echo       ^<Command^>wscript.exe^</Command^>
>> "%XML%" echo       ^<Arguments^>"%PASTA%\robo-rodada.vbs"^</Arguments^>
>> "%XML%" echo       ^<WorkingDirectory^>%PASTA%^</WorkingDirectory^>
>> "%XML%" echo     ^</Exec^>
>> "%XML%" echo   ^</Actions^>
>> "%XML%" echo ^</Task^>

REM ---------------------------------------------------------------------------
REM 5) CRIAR A TAREFA - e so seguir se o Windows aceitou de verdade.
REM ---------------------------------------------------------------------------
echo   [3/6] Entregando a receita ao Agendador de Tarefas...
schtasks /delete /tn "%TAREFA%" /f >nul 2>&1
schtasks /create /tn "%TAREFA%" /xml "%XML%" /f >nul
if errorlevel 1 goto falhou_criar
schtasks /query /tn "%TAREFA%" >nul 2>&1
if errorlevel 1 goto falhou_criar
del /q "%XML%" >nul 2>&1
echo         ok, a tarefa "%TAREFA%" existe.

REM ---------------------------------------------------------------------------
REM 6) SO AGORA DESLIGAR O LACO ANTIGO.
REM    Primeiro guarda uma copia dele: nunca existiu copia em lugar nenhum alem desta maquina.
REM    A morte vai por PowerShell, e nao por wmic: o wmic foi descontinuado e nao vem mais
REM    instalado no Windows 11 recente. Com wmic a linha falharia calada, o laco antigo
REM    continuaria vivo, e a loja ficaria com DOIS mandantes mexendo nos mesmos arquivos ao
REM    mesmo tempo - que e pior do que o problema que viemos consertar.
REM    O filtro procura "robo-loop" e nada mais: o mini-robo do PIX (pix-loop.vbs) nao pode
REM    ser tocado.
REM ---------------------------------------------------------------------------
echo   [4/6] Guardando copia e desligando o laco antigo...
if exist "%PASTA%\robo-loop.vbs" (
  if not exist "%PASTA%\robo-loop-antigo.vbs" copy /y "%PASTA%\robo-loop.vbs" "%PASTA%\robo-loop-antigo.vbs" >nul 2>&1
)
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process -Filter \"Name='wscript.exe'\" | Where-Object { $_.CommandLine -like '*robo-loop*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1

echo   [5/6] Conferindo se o laco antigo morreu mesmo...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$n = @(Get-CimInstance Win32_Process -Filter \"Name='wscript.exe'\" | Where-Object { $_.CommandLine -like '*robo-loop*' }).Count; exit $n" >nul 2>&1
if errorlevel 1 (
  echo.
  echo   ATENCAO: o laco antigo AINDA ESTA RODANDO nesta maquina.
  echo.
  echo   A tarefa nova ja esta criada e funcionando, mas com os dois ligados o robo seria
  echo   chamado em dobro. Faca assim: reinicie este computador. O laco antigo nao volta
  echo   ^(ele so subia quando alguem abria^), e a tarefa nova sobe sozinha.
  echo.
  echo   Se depois de reiniciar o robo-loop aparecer de novo, mande esta tela para o Victor.
  echo.
)
REM tira o laco antigo da inicializacao, nos dois lugares em que costumam por
reg delete "HKLM\Software\Microsoft\Windows\CurrentVersion\Run" /v "RoboSantaRita" /f >nul 2>&1
del /q "%ProgramData%\Microsoft\Windows\Start Menu\Programs\StartUp\robo-loop.vbs" >nul 2>&1
del /q "%ProgramData%\Microsoft\Windows\Start Menu\Programs\Inicializar\robo-loop.vbs" >nul 2>&1
REM A pasta Inicializar DE CADA USUARIO tambem conta. Nao da para usar %APPDATA%: quem clicou
REM "executar como administrador" pode ter elevado com OUTRA conta, e ai %APPDATA% aponta para
REM o perfil do administrador, nao para o da loja - o atalho sobreviveria e voltaria no proximo
REM login, trazendo o laco antigo de volta sem ninguem entender por que.
for /d %%u in ("%SystemDrive%\Users\*") do (
  del /q "%%~fu\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\robo-loop*" >nul 2>&1
  del /q "%%~fu\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Inicializar\robo-loop*" >nul 2>&1
)

REM ---------------------------------------------------------------------------
REM 7) COMECAR AGORA, sem esperar o proximo reinicio.
REM ---------------------------------------------------------------------------
echo   [6/6] Comecando a primeira rodada agora...
schtasks /run /tn "%TAREFA%" >nul 2>&1

echo.
echo ================================================================
echo   PRONTO. O robo agora cuida de si mesmo.
echo ================================================================
echo.
echo   - Quando este computador ligar, o robo comeca sozinho,
echo     mesmo que ninguem faca login.
echo   - De 5 em 5 minutos ele trabalha de novo, para sempre.
echo   - Se uma rodada travar, e encerrada em 40 min e a proxima entra.
echo   - Ninguem precisa abrir o robo, nunca mais.
echo.
echo   PARA CONFERIR, a qualquer momento, abra este arquivo:
echo      %PASTA%\output\robo-ultima-chamada.txt
echo   Ele diz a hora em que a rodada TERMINOU e o resultado dela.
echo   Resultado 0 e hora de agora ha pouco = esta tudo certo.
echo.
echo   OBSERVACAO: o mini-robo do PIX (pix-loop.vbs) continua como era,
echo   aberto a mao. Este instalador nao mexeu nele.
echo.
pause
exit /b 0

:falhou_criar
echo.
echo   NAO DEU para criar a tarefa no Agendador.
echo   O laco antigo NAO foi tocado: a loja continua funcionando como estava.
echo   Mande esta tela para o Victor. A receita ficou em: %XML%
echo.
pause
exit /b 1
