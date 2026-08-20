@echo off
REM NOTAS-BAT - o "passo da vez" da investigacao das notas no VR.
REM Feito para ser CLICADO DUAS VEZES. A janela NAO fecha sozinha: termina em pause.
REM
REM ESTE ARQUIVO NAO MUDA MAIS. Ele chama sempre scripts\notas-passo.cjs; quando a
REM investigacao avanca, quem muda e o notas-passo.cjs. Motivo: o Windows le o .bat
REM linha por linha ENQUANTO ele roda, e o passo [1 de 2] atualiza o codigo - se o
REM proprio .bat fosse reescrito no meio, o resto da execucao embaralharia.
REM RODANDO_BAT avisa o puxar-codigo para nao encostar neste arquivo agora.
setlocal
cd /d "%~dp0"
set RODANDO_BAT=notas.bat
set LOG=%~dp0notas-log.txt
echo ================================================== > "%LOG%"
echo  INVESTIGANDO O XML DAS NOTAS NO VR >> "%LOG%"
echo  %DATE% %TIME% >> "%LOG%"
echo ================================================== >> "%LOG%"
echo.
echo [1 de 2] Atualizando o codigo do robo...
echo --- puxar-codigo --- >> "%LOG%"
node scripts\puxar-codigo.cjs >> "%LOG%" 2>&1
echo    (codigo atualizado)
echo.
echo [2 de 2] Perguntando ao VR... isso pode levar 1 ou 2 minutos.
echo --- notas-passo --- >> "%LOG%"
node scripts\notas-passo.cjs >> "%LOG%" 2>&1
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
