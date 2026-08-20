@echo off
REM NOTAS-BAT - o "passo da vez" da investigacao das notas no VR.
REM Feito para ser CLICADO DUAS VEZES. A janela NAO fecha sozinha: termina em pause.
REM
REM ESTE ARQUIVO NAO MUDA MAIS. Ele chama sempre scripts\notas-passo.cjs; quando a
REM investigacao avanca, quem muda e o notas-passo.cjs. Motivo: o Windows le o .bat
REM linha por linha ENQUANTO ele roda, e o passo [1 de 2] atualiza o codigo - se o
REM proprio .bat fosse reescrito no meio, o resto da execucao embaralharia.
REM RODANDO_BAT avisa o puxar-codigo para nao encostar neste arquivo agora.
REM
REM SEM NENHUM DESVIO DE SAIDA AQUI, DE PROPOSITO. A versao anterior mandava tudo
REM para um arquivo de log e morria com "A sintaxe do comando esta incorreta" na
REM maquina da loja. O log era so reserva: o notas-passo.cjs ja manda o relatorio
REM para a nuvem por conta propria. Menos peca, menos coisa para quebrar.
setlocal
cd /d "%~dp0"
set RODANDO_BAT=notas.bat
echo.
echo [1 de 2] Atualizando o codigo do robo...
call node scripts\puxar-codigo.cjs
echo.
echo [2 de 2] Perguntando ao VR... isso pode levar 1 ou 2 minutos.
call node scripts\notas-passo.cjs
echo.
echo ==================================================
echo  TERMINOU. O resultado ja foi para a nuvem sozinho.
echo  Pode fechar a janela. Aperte qualquer tecla.
echo ==================================================
pause
