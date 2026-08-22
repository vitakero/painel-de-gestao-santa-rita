-- ============================================================
-- ACESSOS — "visto por último" (última vez que a pessoa esteve online).
--
-- Adiciona o campo visto_em na tabela de logins (perfis) e uma função que
-- cada pessoa chama pra carimbar "estou aqui" (o painel chama sozinho no
-- login e a cada ~1 min enquanto a tela fica aberta). Quando a pessoa sai,
-- o visto_em congela na última vez — e o Acessos mostra "visto há X min".
--
-- ADITIVO e IDEMPOTENTE. Rode uma vez no Supabase (SQL Editor).
-- ============================================================

begin;

alter table public.perfis add column if not exists visto_em timestamptz;

-- Cada pessoa só carimba a PRÓPRIA presença (auth.uid()). Nada de mexer nos outros.
create or replace function public.tocar_visto()
returns void language sql security definer set search_path = public as $$
  update public.perfis set visto_em = now() where id = auth.uid();
$$;

grant execute on function public.tocar_visto() to authenticated;

commit;

-- CONFERÊNCIA:  select nome, visto_em from public.perfis order by visto_em desc nulls last;
-- ROLLBACK:     alter table public.perfis drop column if exists visto_em;
--               drop function if exists public.tocar_visto();
