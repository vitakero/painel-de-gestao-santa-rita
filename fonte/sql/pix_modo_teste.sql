-- MODO TESTE do Pix (só master): permite "Simular pago" e "Desfazer teste" no painel,
-- sem tocar no banco. As cobranças de teste ficam marcadas com tipo_liquidacao = 'TESTE'
-- (aparecem como "Pago (teste)"), então NUNCA se confundem com pagamento real do banco.
-- COMO USAR: colar no Supabase (SQL Editor) e clicar RUN.

-- Master pode marcar uma cobrança gerada como paga, DESDE QUE marque como TESTE.
-- (não dá pra forjar um "Pago (Pix banco)" real — só o robô/service key faz isso)
drop policy if exists "pix_cobrancas_teste_pagar" on public.pix_cobrancas;
create policy "pix_cobrancas_teste_pagar" on public.pix_cobrancas
  for update to authenticated
  using (public.pode_ver_pontos() and status = 'gerado')
  with check (public.pode_ver_pontos() and status = 'pago' and tipo_liquidacao = 'TESTE');

-- Master pode desfazer uma simulação de teste (volta pra 'gerado' pra testar de novo).
drop policy if exists "pix_cobrancas_teste_desfazer" on public.pix_cobrancas;
create policy "pix_cobrancas_teste_desfazer" on public.pix_cobrancas
  for update to authenticated
  using (public.pode_ver_pontos() and status = 'pago' and tipo_liquidacao = 'TESTE')
  with check (public.pode_ver_pontos() and status = 'gerado');
