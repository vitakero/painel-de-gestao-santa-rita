-- ============================================================
-- EMBALAGENS (tabela material_uso) — a que faltava na nuvem.
--
-- DESCOBERTO EM 13/08/2026: o painel sincroniza 21 tabelas, e esta era a ÚNICA que não
-- existia no Supabase. Resultado: o cadastro de Embalagens vive só no navegador de quem
-- cadastrou. Abrir o painel em outro computador, ou limpar o navegador, e as embalagens
-- somem — e as receitas ficam apontando para embalagem que não existe mais, perdendo o
-- custo de embalagem no cálculo.
--
-- O nome da tabela é `material_uso` porque a aba se chamava "Material de uso" antes de
-- virar "Embalagens". Renomear exigiria mexer no código junto — fica para o dia da
-- faxina de nomes.
--
-- Mesmo formato das outras (1 linha por item, dados em jsonb). Rode UMA vez no SQL Editor.
-- ============================================================
create table if not exists public.material_uso (
  id            text primary key,
  dados         jsonb not null,
  ordem         int,
  atualizado_em timestamptz default now()
);
alter table public.material_uso enable row level security;

-- Mesma regra de Insumos e Receitas: quem entrou no painel lê e grava.
drop policy if exists material_uso_all on public.material_uso;
create policy material_uso_all on public.material_uso
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

do $$ begin
  alter publication supabase_realtime add table public.material_uso;
exception when duplicate_object then null; end $$;

-- ============================================================
-- CONFERÊNCIA
-- ============================================================
select 'tabela criada'  as o_que,
       case when to_regclass('public.material_uso') is not null then 'sim' else 'FALTOU' end as valor
union all
select 'regra de acesso',
       case when exists (select 1 from pg_policies
                          where schemaname='public' and tablename='material_uso') then 'sim' else 'FALTOU' end
union all
select 'tempo real ligado',
       case when exists (select 1 from pg_publication_tables
                          where pubname='supabase_realtime' and tablename='material_uso') then 'sim' else 'nao (o painel funciona igual, só atualiza ao recarregar)' end;
