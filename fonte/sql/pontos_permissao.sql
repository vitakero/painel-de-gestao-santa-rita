-- ============================================================
-- LIBERAR "PONTOS EXTRAS" PRA FUNCIONÁRIO (por permissão de página)
-- Antes: só o MASTER via/mexia nos pontos e nos boletos.
-- Agora: MASTER **ou** quem tiver a página "Pontos extras" liberada nos Acessos.
-- (A liberação da página em si é feita no painel: Acessos -> abrir o funcionário
--  -> marcar "Pontos extras" -> Salvar. Este SQL faz o BANCO respeitar isso.)
-- COMO USAR: colar TUDO no Supabase (SQL Editor) e clicar RUN.
-- ============================================================

-- 1) A regra central (usada pelos pontos E pelos boletos pix_cobrancas).
--    "tem a página pontos?" -> funciona tanto se paginas for text[] quanto jsonb:
--    normaliza pra ",pontos,galpoes," e procura ",pontos,".
create or replace function public.pode_ver_pontos()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.perfis p
    where p.id = auth.uid()
      and (
        coalesce(p.is_master, false)
        or (
          ',' || regexp_replace(coalesce(p.paginas::text, ''), '[][{}" ]', '', 'g') || ','
          like '%,pontos,%'
        )
      )
  );
$$;

-- 2) Tabela dos pontos: reaplica as regras usando pode_ver_pontos().
--    (apaga as regras antigas dessa tabela e recria certinho — o master continua
--     com acesso total porque é_master satisfaz pode_ver_pontos; o robô usa a
--     service key e passa por cima do RLS de qualquer jeito.)
alter table public.pontos_extras enable row level security;

do $$
declare pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'pontos_extras'
  loop
    execute format('drop policy if exists %I on public.pontos_extras', pol.policyname);
  end loop;
end $$;

create policy "pontos_select" on public.pontos_extras
  for select to authenticated using (public.pode_ver_pontos());
create policy "pontos_insert" on public.pontos_extras
  for insert to authenticated with check (public.pode_ver_pontos());
create policy "pontos_update" on public.pontos_extras
  for update to authenticated using (public.pode_ver_pontos()) with check (public.pode_ver_pontos());
create policy "pontos_delete" on public.pontos_extras
  for delete to authenticated using (public.pode_ver_pontos());

-- 3) Os boletos (pix_cobrancas) já usam pode_ver_pontos() nas policies — como a
--    função acima mudou, eles passam a valer pro funcionário também. Nada a fazer aqui.
