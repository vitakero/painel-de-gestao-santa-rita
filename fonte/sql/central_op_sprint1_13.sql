-- ============================================================
-- CENTRAL OPERACIONAL — SPRINT 1.13 (presença + "digitando…")
-- Presença e digitação são 100% EFÊMEROS (Realtime Presence + Broadcast) — NADA é gravado no
-- banco, não há histórico, não há trigger, não há evento em 'eventos'. Por isso o SQL desta
-- sprint é MÍNIMO: só uma RPC de LEITURA do roster (p/ o cliente listar quem está
-- Online/Ausente/Offline — o "offline" precisa do nome de quem NÃO está na presença).
--
-- ADITIVO. Depende de sprint0..1_12. NÃO cria tabela, trigger, nem RPC de escrita.
-- COMO USAR: rodar no Supabase (STAGING).
-- ============================================================

-- ------------------------------------------------------------
-- participantes(): lista os usuários da Central (id/nome/setor) p/ a lista de presença.
--   Igual à mencionaveis (1.11), mas SEM busca e com teto maior (roster completo). SECURITY
--   DEFINER + guard de página; expõe só nome/setor (que já aparecem no painel — sem PII nova).
-- ------------------------------------------------------------
create or replace function public.participantes()
returns table (id uuid, nome text, setor text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.pode_pagina('operacional') and not public.sou_master() then
    raise exception 'sem acesso a Central Operacional' using errcode = '42501';
  end if;
  return query
    select p.id, p.nome, p.setor
    from public.perfis p
    where p.nome is not null and btrim(p.nome) <> ''
    order by p.nome asc
    limit 200;
end $$;
revoke all on function public.participantes() from public;
grant execute on function public.participantes() to authenticated;

-- ============================================================
-- ROLLBACK (desfazer só a Sprint 1.13) — descomentar se precisar:
-- drop function if exists public.participantes();
-- ============================================================
