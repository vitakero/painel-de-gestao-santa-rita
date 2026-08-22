-- ============================================================================
-- TRANCAR AS TABELAS SOLTAS — roda ANTES do portal do fornecedor
--
-- Por que agora: o portal vai criar contas de FORNECEDOR neste mesmo banco.
-- No instante em que a primeira existir, ela vira "alguém logado" — e toda
-- tabela cuja regra é só "estar logado" se abre pra ela.
--
-- Conferido no banco de verdade em 14/08/2026 (não nos arquivos): são estas 5,
-- e em 3 delas o acesso solto inclui ESCREVER.
--
--   insumos              lê e escreve   -> preço de custo de todos os insumos
--   custos_operacionais  lê e escreve   -> estrutura de custo da produção
--   rateios              lê e escreve   -> rateio de despesa por receita
--   central_conferencias lê             -> conferências e divergências com valores
--   entregas_agendamento lê             -> nome, documento, contato e email dos fornecedores
--   feature_flags        lê             -> chaves de recurso (baixo risco, vai junto)
--
-- Isto NÃO é só preparação pro portal: hoje, neste momento, qualquer
-- funcionário logado — do açougue, da padaria, de qualquer setor — consegue
-- alterar o preço dos seus insumos. A tranca conserta isso também.
--
-- ============================================================================
-- ATENÇÃO, LEIA ANTES DE RODAR
--
-- Depois desta tranca, para mexer em Insumos / Custos operacionais / Rateios
-- a pessoa precisa ter a página "Receitas" (ou "Material de uso") marcada nos
-- Acessos. Para ver a Conferência e os agendamentos, precisa da "Central".
--
-- Se hoje alguém usa essas telas SEM a página marcada, vai parar de conseguir.
-- Confira em Configurações > Acessos depois de rodar. O master passa sempre.
-- ============================================================================


-- ============================================================
-- 1) INSUMOS, CUSTOS OPERACIONAIS E RATEIOS
--    São as três abas de dentro de Receitas. Aceito as duas páginas
--    (receitas OU material) pra não trancar do lado de fora quem já usa.
-- ============================================================
do $$
declare
  alvo text;
  pol  record;
begin
  foreach alvo in array array['insumos', 'custos_operacionais', 'rateios'] loop
    if to_regclass('public.' || alvo) is null then
      raise notice 'pulei %: não existe', alvo;
      continue;
    end if;

    execute format('alter table public.%I enable row level security', alvo);

    -- apaga as regras antigas (é o que o permissoes_padrao.sql já faz)
    for pol in
      select policyname from pg_policies where schemaname = 'public' and tablename = alvo
    loop
      execute format('drop policy if exists %I on public.%I', pol.policyname, alvo);
    end loop;

    execute format($f$
      create policy "rec_sel" on public.%I for select to authenticated
        using (public.pode_pagina('receitas') or public.pode_pagina('material'))
    $f$, alvo);

    execute format($f$
      create policy "rec_ins" on public.%I for insert to authenticated
        with check (public.pode_pagina('receitas') or public.pode_pagina('material'))
    $f$, alvo);

    execute format($f$
      create policy "rec_upd" on public.%I for update to authenticated
        using (public.pode_pagina('receitas') or public.pode_pagina('material'))
        with check (public.pode_pagina('receitas') or public.pode_pagina('material'))
    $f$, alvo);

    execute format($f$
      create policy "rec_del" on public.%I for delete to authenticated
        using (public.pode_pagina('receitas') or public.pode_pagina('material'))
    $f$, alvo);

    raise notice 'trancada: %', alvo;
  end loop;
end $$;


-- ============================================================
-- 2) CONFERÊNCIA DOS CARROS
--    Só leitura. Quem escreve é o robô da loja, que usa a chave de serviço
--    e passa por cima do RLS — então tirar a escrita daqui não quebra nada.
-- ============================================================
do $$
declare pol record;
begin
  if to_regclass('public.central_conferencias') is null then
    raise notice 'pulei central_conferencias: não existe';
    return;
  end if;

  alter table public.central_conferencias enable row level security;

  for pol in
    select policyname from pg_policies
     where schemaname = 'public' and tablename = 'central_conferencias'
  loop
    execute format('drop policy if exists %I on public.central_conferencias', pol.policyname);
  end loop;

  create policy "conf_sel" on public.central_conferencias
    for select to authenticated using (public.pode_pagina('central'));

  raise notice 'trancada: central_conferencias';
end $$;


-- ============================================================
-- 3) AGENDAMENTOS DO FORNECEDOR
--
--    Este é o que mais me incomodou: hoje qualquer pessoa logada lê nome,
--    documento, contato e EMAIL de todos os fornecedores que já agendaram.
--    Passa a ser só de quem tem a Central.
--
--    A escrita continua fechada: a única porta é a função ent_solicitar,
--    que é quem o site do fornecedor chama.
-- ============================================================
do $$
declare pol record;
begin
  if to_regclass('public.entregas_agendamento') is null then
    raise notice 'pulei entregas_agendamento: não existe';
    return;
  end if;

  alter table public.entregas_agendamento enable row level security;

  for pol in
    select policyname from pg_policies
     where schemaname = 'public' and tablename = 'entregas_agendamento'
  loop
    execute format('drop policy if exists %I on public.entregas_agendamento', pol.policyname);
  end loop;

  create policy "ent_sel" on public.entregas_agendamento
    for select to authenticated
    using (tenant_id = public.current_tenant() and public.pode_pagina('central'));

  raise notice 'trancada: entregas_agendamento';
end $$;


-- ============================================================
-- 4) CHAVES DE RECURSO
--    Baixo risco, mas é configuração — não tem por que qualquer um ler.
-- ============================================================
do $$
declare pol record;
begin
  if to_regclass('public.feature_flags') is null then
    raise notice 'pulei feature_flags: não existe';
    return;
  end if;

  alter table public.feature_flags enable row level security;

  for pol in
    select policyname from pg_policies
     where schemaname = 'public' and tablename = 'feature_flags'
  loop
    execute format('drop policy if exists %I on public.feature_flags', pol.policyname);
  end loop;

  create policy "ff_sel" on public.feature_flags
    for select to authenticated
    using (tenant_id = public.current_tenant() and public.sou_master());

  create policy "ff_all" on public.feature_flags
    for all to authenticated
    using (tenant_id = public.current_tenant() and public.sou_master())
    with check (tenant_id = public.current_tenant() and public.sou_master());

  raise notice 'trancada: feature_flags';
end $$;


-- ============================================================
-- 5) CONFERÊNCIA — rode isto depois e confira o resultado
--
-- A lista abaixo deve voltar VAZIA. Se voltar alguma linha, é tabela que
-- continua aberta pra qualquer logado.
-- ============================================================
select
  c.relname as ainda_solta,
  string_agg(distinct pg_get_expr(p.polqual, p.polrelid), ' | ') as regra
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policy p on p.polrelid = c.oid
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relrowsecurity
  and c.relname in ('insumos','custos_operacionais','rateios',
                    'central_conferencias','entregas_agendamento','feature_flags')
group by c.relname
having coalesce(string_agg(distinct pg_get_expr(p.polqual, p.polrelid), ' '), '')
       !~ 'pode_pagina|sou_master';
