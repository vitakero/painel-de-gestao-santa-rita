-- ============================================================
--  ASSINATURA ELETRÔNICA DO CONTRATO — Painel Santa Rita
--  Rodar UMA vez no SQL Editor do Supabase.
--
--  Guarda APENAS o registro do ato de assinar (quem, quando, código
--  de conferência e a impressão digital do contrato naquele momento).
--  NÃO guarda imagem de assinatura nenhuma — não existe o que copiar.
--
--  Se o contrato mudar depois (valor, prazo, fornecedor), a impressão
--  digital deixa de bater e o painel derruba a assinatura sozinho.
-- ============================================================

alter table if exists public.pontos_extras
  add column if not exists assinatura jsonb;

comment on column public.pontos_extras.assinatura is
  'Ato de assinatura eletrônica: {nome, em, impressao, porLogin, codigo}. Sem imagem.';

-- ---------- conferência ----------
select
  'pontos_extras.assinatura' as objeto,
  case when exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='pontos_extras' and column_name='assinatura'
  ) then '✅ OK — pode assinar contrato no painel'
    else '❌ FALTOU — rode o comando acima de novo' end as situacao;
