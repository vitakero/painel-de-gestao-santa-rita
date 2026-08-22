-- ============================================================
-- SENHA DO MASTER (só a senha, sem e-mail)
-- Confere se a senha digitada bate com a senha de ALGUM login master.
-- Devolve só true/false — não expõe e-mail, nem o hash, nem derruba o login de ninguém.
-- Usada pela trava "Ação protegida" do painel: rpc('senha_master_ok', {senha}).
-- COMO USAR: colar TUDO no Supabase (SQL Editor) e clicar RUN.
-- ============================================================

-- garante o pgcrypto (função crypt) — normalmente já vem instalado no Supabase
create extension if not exists pgcrypto with schema extensions;

create or replace function public.senha_master_ok(senha text)
returns boolean
language sql
stable
security definer
set search_path = public, extensions, auth
as $$
  select exists (
    select 1
    from public.perfis p
    join auth.users u on u.id = p.id
    where coalesce(p.is_master, false)
      and u.encrypted_password = crypt(senha, u.encrypted_password)
  );
$$;

-- só quem está logado pode chamar (funcionário logado); anônimo não
revoke all on function public.senha_master_ok(text) from public;
grant execute on function public.senha_master_ok(text) to authenticated;
