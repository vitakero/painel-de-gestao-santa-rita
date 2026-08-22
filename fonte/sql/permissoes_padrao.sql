-- ============================================================
-- PERMISSÃO POR PÁGINA = PADRÃO  (rodar UMA vez)
-- Regra geral: pode ver/mexer numa página quem for MASTER ou tiver aquela página
-- liberada no login (aba Acessos). Vale pra TELA e pro BANCO.
-- Depois disso: liberou a página nos Acessos -> já funciona. Sem mais SQL por página.
--
-- CONTINUAM SÓ MASTER (não entram aqui de propósito): galpões e planta (patrimônio do
-- dono), configurações, acessos/perfis, lixeira e negociações. Boletos (pix_cobrancas)
-- mantêm as regras rígidas próprias (não viram "pago" na mão).
-- COMO USAR: colar TUDO no Supabase (SQL Editor) e clicar RUN.
-- (Substitui o antigo pontos_permissao.sql — não precisa rodar aquele separado.)
-- ============================================================

-- 1) Função geral: "esse login pode a página X?"
--    (o teste de "tem a página" funciona tanto se paginas for text[] quanto jsonb:
--     normaliza pra ",pontos,escala," e procura ",X,")
create or replace function public.pode_pagina(chave text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.perfis p
    where p.id = auth.uid()
      and (
        coalesce(p.is_master, false)
        or (
          ',' || regexp_replace(coalesce(p.paginas::text, ''), '[][{}" ]', '', 'g') || ','
          like '%,' || chave || ',%'
        )
      )
  );
$$;

-- 2) A função dos pontos passa a ser a geral (pontos + boletos usam ela)
create or replace function public.pode_ver_pontos()
returns boolean
language sql stable security definer set search_path = public as $$
  select public.pode_pagina('pontos');
$$;

-- 3) Aplica a regra "por página" em cada tabela operacional (pula a que não existir).
do $$
declare
  mapa jsonb := '[
    {"t":"pontos_extras","pg":"pontos"},
    {"t":"manutencoes","pg":"manutencoes"},
    {"t":"manutencao_registros","pg":"manutencoes"},
    {"t":"manutencao_equipamentos","pg":"manutencoes"},
    {"t":"entregas_registros","pg":"entregas"},
    {"t":"entregas_entregadores","pg":"entregas"},
    {"t":"receitas","pg":"receitas"},
    {"t":"material_uso","pg":"material"},
    {"t":"pedidos","pg":"pedidos"},
    {"t":"estoque_produtos","pg":"estld"},
    {"t":"banco_horas","pg":"jornada"},
    {"t":"cargos_salarios","pg":"cargos"},
    {"t":"ferias","pg":"ferias"},
    {"t":"perdas","pg":"perdas"},
    {"t":"perdas_acougue","pg":"acougue"},
    {"t":"epi_catalogo","pg":"epi"},
    {"t":"epi_entregas","pg":"epi"},
    {"t":"fardamento_catalogo","pg":"fardamento"},
    {"t":"fardamento_entregas","pg":"fardamento"},
    {"t":"calendario_campanhas","pg":"calendario"},
    {"t":"cartaz_temas","pg":"cartaz"},
    {"t":"escala","pg":"escala"},
    {"t":"organogramas","pg":"organograma"},
    {"t":"fluxograma","pg":"fluxograma"},
    {"t":"layout","pg":"layout"}
  ]'::jsonb;
  item jsonb; tbl text; pg text; pol record;
begin
  for item in select * from jsonb_array_elements(mapa) loop
    tbl := item->>'t'; pg := item->>'pg';
    if to_regclass('public.'||tbl) is null then continue; end if;      -- não existe? pula
    execute format('alter table public.%I enable row level security', tbl);
    for pol in select policyname from pg_policies where schemaname='public' and tablename=tbl loop
      execute format('drop policy if exists %I on public.%I', pol.policyname, tbl);
    end loop;
    execute format('create policy "pg_sel" on public.%I for select to authenticated using (public.pode_pagina(%L))', tbl, pg);
    execute format('create policy "pg_ins" on public.%I for insert to authenticated with check (public.pode_pagina(%L))', tbl, pg);
    execute format('create policy "pg_upd" on public.%I for update to authenticated using (public.pode_pagina(%L)) with check (public.pode_pagina(%L))', tbl, pg, pg);
    execute format('create policy "pg_del" on public.%I for delete to authenticated using (public.pode_pagina(%L))', tbl, pg);
  end loop;
end $$;

-- 4) Central Logística: quem tem a página "central" VÊ os agendamentos; escrever é só o
--    robô (service key). Então: só leitura, por página.
do $$
declare pol record;
begin
  if to_regclass('public.central_agendamentos') is not null then
    alter table public.central_agendamentos enable row level security;
    for pol in select policyname from pg_policies where schemaname='public' and tablename='central_agendamentos' loop
      execute format('drop policy if exists %I on public.central_agendamentos', pol.policyname);
    end loop;
    create policy "central_sel" on public.central_agendamentos
      for select to authenticated using (public.pode_pagina('central'));
  end if;
end $$;

-- 5) pix_cobrancas (boletos): regras próprias e mais rígidas já usam pode_ver_pontos(),
--    que agora é por página. Nada a mudar aqui.
