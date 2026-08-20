@echo off
REM NOTAS-BAT - pergunta ao VR se ele ja guarda o XML das notas de entrada.
REM Feito para ser CLICADO DUAS VEZES. A janela NAO fecha sozinha: termina em pause.
REM Tudo o que aparecer aqui tambem fica gravado em C:\vr-robo\notas-log.txt
setlocal
cd /d "%~dp0"
set LOG=%~dp0notas-log.txt
echo ================================================== > "%LOG%"
echo  PROCURANDO O XML DAS NOTAS NO VR >> "%LOG%"
echo  %DATE% %TIME% >> "%LOG%"
echo ================================================== >> "%LOG%"
echo.
echo [1 de 2] Atualizando o codigo do robo...
echo --- puxar-codigo --- >> "%LOG%"
node scripts\puxar-codigo.cjs >> "%LOG%" 2>&1
echo    (codigo atualizado)
echo.
echo [2 de 2] Perguntando ao VR... isso pode levar 1 ou 2 minutos.
echo --- vr-descobrir-notas --- >> "%LOG%"
node scripts\vr-descobrir-notas.cjs >> "%LOG%" 2>&1
echo --- fim --- >> "%LOG%"
echo.
echo Mandando o resultado para a nuvem...
node scripts\mandar-log.cjs "%LOG%" notas
echo.
echo ==================================================
echo  TERMINOU. O que saiu esta logo abaixo e tambem
echo  gravado no arquivo notas-log.txt
echo ==================================================
echo.
type "%LOG%"
echo.
echo ==================================================
echo  Pode fechar a janela. Aperte qualquer tecla.
echo ==================================================
pause
