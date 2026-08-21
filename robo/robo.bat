@echo off
title Robo do Painel Santa Rita
cd /d %~dp0
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
