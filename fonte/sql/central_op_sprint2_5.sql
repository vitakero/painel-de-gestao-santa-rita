-- ============================================================
-- CENTRAL OPERACIONAL — SPRINT 2.5 (PWA / INSTALAÇÃO MOBILE)
--
-- Esta sprint é quase toda no CLIENTE + 1 arquivo estático (sw.js). No banco só
-- existe UMA coisa: a feature flag pwa_enabled (off). Sem tabela nova, sem coluna
-- nova, sem RPC, sem trigger, ZERO tabela do ERP tocada, ZERO escrita nova.
--
-- Enquanto a flag estiver OFF: nada muda (nenhum service worker é registrado,
-- nenhum manifest é injetado, nenhum botão aparece). Ligar/desligar a flag é o
-- interruptor da feature inteira (o cliente tem kill-switch: flag off desregistra
-- o SW e limpa o cache do PWA).
--
-- ADITIVO E IDEMPOTENTE.
-- ============================================================

insert into public.feature_flags(tenant_id, chave, habilitado)
values (public.current_tenant(), 'pwa_enabled', false)
on conflict (tenant_id, chave) do nothing;

-- ============================================================
-- CONFERÊNCIA:
--   select chave, habilitado from public.feature_flags where chave = 'pwa_enabled';
--
-- LIGAR (depois de publicado o sw.js):
--   update public.feature_flags set habilitado = true
--    where tenant_id = public.current_tenant() and chave = 'pwa_enabled';
--
-- DESLIGAR (kill-switch — o cliente desregistra o SW e limpa o cache):
--   update public.feature_flags set habilitado = false
--    where tenant_id = public.current_tenant() and chave = 'pwa_enabled';
-- ============================================================
