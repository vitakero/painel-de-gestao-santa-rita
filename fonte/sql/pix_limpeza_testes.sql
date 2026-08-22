-- LIMPEZA DOS TESTES DO PIX
-- Apaga do painel as cobranças de teste (pagas, canceladas, com erro)
-- e manda o robô CANCELAR NO SICREDI as que ainda estão com QR Code ativo.
-- COMO USAR: colar no Supabase (SQL Editor), clicar RUN.
-- Depois de ~5 minutos, colar e rodar DE NOVO (aí apaga as que o robô acabou de cancelar).

-- 1) apaga as já encerradas (pagas de teste, canceladas, com erro ou pedido parado)
delete from public.pix_cobrancas where status in ('pago','cancelado','erro','pedido');

-- 2) as que ainda estão com QR ativo no Sicredi: marca pra o robô baixar no banco
update public.pix_cobrancas set status='cancelar' where status='gerado';
