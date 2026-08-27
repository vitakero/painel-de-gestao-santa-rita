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
echo [0.5/4] Conferindo se as pecas estao no lugar...
REM Em 27/08/2026 alguem reextraiu um vr-robo2.zip VELHO por cima desta pasta. Sumiu o
REM node_modules e o .env voltou pra uma versao sem a chave da nuvem. O robo rodava, lia o
REM VR inteiro e jogava fora sem dar erro; ficou 2 horas assim e so foi achado por acaso.
REM Agora ele reinstala peca faltando sozinho, e PARA quando falta configuracao (essa
REM ninguem conserta sozinho: a chave nao esta no repositorio, de proposito).
REM A conferencia mora num script node (scripts\conferir-pecas.cjs) e nao aqui dentro,
REM porque assim da pra testar cada jeito de dar errado antes de mandar pra loja.
node scripts\conferir-pecas.cjs
if errorlevel 1 goto pecas
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
echo [1.9/4] Sincronizando o dicionario de codigos dos fornecedores...
node scripts\vr-sync-codigos.cjs
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

:pecas
echo.
echo [%date% %time%] RODADA CANCELADA: falta peca ou configuracao (veja acima).
echo Rodar assim faria o robo ler o VR e jogar fora, congelando o painel em silencio.
exit /b 1
