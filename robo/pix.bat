@echo off
rem Mini-robo do PIX (faixa expressa) - chamado pelo pix-loop.vbs a cada 1 min.
rem Guarda so o log da ULTIMA rodada (nao cresce sem parar).
cd /d C:\vr-robo
node scripts\pixWorker.cjs > output\pix-ultimo.txt 2>&1
