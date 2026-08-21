@echo off
REM ROBO-BAT - a rotina completa do robo da loja.
REM
REM A palavra ROBO-BAT na linha acima e a senha de conferencia do download: sem ela
REM o puxar-codigo recusa o arquivo e a loja fica com a versao velha para sempre,
REM dizendo so "invalido - mantendo o atual" no meio de vinte linhas. Foi o que
REM aconteceu ate 21/08/2026: este arquivo nunca chegou na loja.
REM
REM SEM CARACTERE DE DESVIO DE SAIDA NOS COMENTARIOS: o cmd interpreta esses
REM simbolos ate dentro de linha REM.
title Robo do Painel Santa Rita
cd /d %~dp0
REM Avisa o puxar-codigo para nao reescrever ESTE arquivo agora: o Windows le o .bat
REM linha por linha enquanto ele roda, e trocar o conteudo no meio embaralha o resto.
REM Ele se atualiza na proxima vez, ou quando alguem roda o puxar-codigo sozinho.
set RODANDO_BAT=robo.bat
echo ================================================
echo [%date% %time%] ROBO INICIADO
echo ================================================
echo.
echo [0/4] Baixando codigo mais recente do GitHub (via API)...
node scripts\puxar-codigo.cjs
echo.
echo [1/4] Lendo as vendas do VR (Postgres)...
node scripts\buildVrData.cjs
if errorlevel 1 goto erro
echo.
echo [1.5/4] Sincronizando agendamentos de recebimento (Central Logistica)...
node scripts\vr-sync-agendamento.cjs
echo.
echo [1.6/4] Sincronizando conferencia dos carros (bipagem e divergencias)...
node scripts\vr-sync-conferencia.cjs
echo.
echo [1.7/4] Sincronizando pedidos de compra (Portal do Fornecedor)...
node scripts\vr-sync-pedidos.cjs
echo.
echo [1.8/4] Sincronizando notas da Receita Federal (conferencia automatica)...
node scripts\vr-sync-notas.cjs
echo.
echo [2/4] Gerando o painel (index.html)...
node node_modules\tsx\dist\cli.mjs scripts\demoDashboard.ts
if errorlevel 1 goto erro
echo.
echo [3/4] Publicando no GitHub...
node scripts\publicar.cjs
if errorlevel 1 goto erro
echo.
echo [%date% %time%] ROBO CONCLUIDO COM SUCESSO.
exit /b 0

:erro
echo.
echo [%date% %time%] ERRO durante a execucao do robo.
exit /b 1
