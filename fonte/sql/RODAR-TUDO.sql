-- =====================================================================
--  PAINEL SANTA RITA — TUDO QUE FALTA RODAR  ·  05/08/2026
--
--  COMO USAR: copie este arquivo INTEIRO, cole no SQL Editor do
--  Supabase e clique em RUN. Leva poucos segundos.
--
--  É SEGURO:
--   • Não apaga nada. Não altera nenhum dado que você já tem.
--   • Pode rodar mais de uma vez — o que já existe é ignorado.
--   • As partes são independentes, na ordem de importância.
--
--  O QUE MUDA DEPOIS: seus cadastros (insumos, custos operacionais,
--  embalagens, rateios, despesas) passam a sincronizar entre o
--  computador e o celular. Até agora viviam só neste navegador.
-- =====================================================================


-- =====================================================================
--  PARTE 1 de 5 — DESPESAS — resumo mensal + teto por categoria
--  (origem: sql/despesas.sql)
-- =====================================================================

-- ============================================================
-- Módulo DESPESAS (por tipo de gasto).
-- O painel só LÊ o resumo (o robô da loja calcula do VR e grava aqui).
-- O teto (limite mensal) por categoria o dono define no painel.
-- Dado financeiro sensível: só o MASTER vê/edita (RLS), igual aos galpões.
-- Rode este SQL UMA vez no Supabase (SQL Editor).
-- ============================================================

-- Resumo mensal (1 linha por competência/mês). O robô grava; o painel lê.
create table if not exists public.despesas_resumo (
  competencia   date primary key,                    -- 1º dia do mês (ex.: 2026-06-01)
  total         numeric     not null default 0,       -- total gasto no mês
  qtd           integer     not null default 0,       -- nº de lançamentos
  categorias    jsonb       not null default '[]'::jsonb, -- [{cat, soma, qtd}]
  maiores       jsonb       not null default '[]'::jsonb, -- [{data, descricao, fornecedor, categoria, valor}]
  atualizado_em timestamptz not null default now()
);

-- Teto (limite mensal) por categoria — o dono define no painel.
create table if not exists public.despesas_teto (
  categoria      text primary key,
  valor          numeric     not null default 0,
  atualizado_em  timestamptz not null default now(),
  atualizado_por text
);

alter table public.despesas_resumo enable row level security;
alter table public.despesas_teto   enable row level security;

-- Só o master enxerga e mexe (mesma regra dos galpões / dados financeiros sensíveis).
-- OBS: o robô grava usando a SERVICE KEY, que ignora RLS — por isso não precisa de política pra ele.
drop policy if exists despesas_resumo_master on public.despesas_resumo;
create policy despesas_resumo_master on public.despesas_resumo
  for all
  using      (exists (select 1 from public.perfis p where p.id = auth.uid() and p.is_master = true))
  with check (exists (select 1 from public.perfis p where p.id = auth.uid() and p.is_master = true));

drop policy if exists despesas_teto_master on public.despesas_teto;
create policy despesas_teto_master on public.despesas_teto
  for all
  using      (exists (select 1 from public.perfis p where p.id = auth.uid() and p.is_master = true))
  with check (exists (select 1 from public.perfis p where p.id = auth.uid() and p.is_master = true));

-- Tempo real no teto (pra sincronizar os limites entre aparelhos). Não dá erro se já estiver ligado.
do $$ begin
  alter publication supabase_realtime add table public.despesas_teto;
exception when duplicate_object then null; end $$;


-- =====================================================================
--  PARTE 2 de 5 — INSUMOS — cadastro único dos produtos da produção
--  (origem: sql/insumos.sql)
-- =====================================================================

-- ============================================================
-- CADASTRO DE INSUMOS — fonte única dos produtos usados na produção.
-- As receitas guardam só a referência (insumoId) + quantidade; nome, preço e
-- unidade vêm daqui. Mudou o preço aqui, todas as receitas se atualizam.
-- Mesmo padrão das outras tabelas do painel (1 linha por item, dados em jsonb).
-- Rode este SQL UMA vez no Supabase (SQL Editor).
-- ============================================================
create table if not exists public.insumos (
  id            text primary key,
  dados         jsonb not null,
  ordem         int,
  atualizado_em timestamptz default now()
);
alter table public.insumos enable row level security;

-- Quem entrou no painel pode ler/gravar (mesma regra de Material de uso e Receitas).
drop policy if exists insumos_all on public.insumos;
create policy insumos_all on public.insumos
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

do $$ begin
  alter publication supabase_realtime add table public.insumos;
exception when duplicate_object then null; end $$;


-- =====================================================================
--  PARTE 3 de 5 — CUSTOS OPERACIONAIS — catálogo reutilizável
--  (origem: sql/custos_operacionais.sql)
-- =====================================================================

-- ============================================================
-- Catálogo de CUSTOS OPERACIONAIS (mão de obra, energia, gás, limpeza…)
-- Cadastra-se uma vez e reaproveita em qualquer receita (ficha técnica).
-- Mesmo padrão das outras tabelas do painel: 1 linha por item, dados em jsonb.
-- Rode este SQL UMA vez no Supabase (SQL Editor).
-- ============================================================
create table if not exists public.custos_operacionais (
  id            text primary key,
  dados         jsonb not null,
  ordem         int,
  atualizado_em timestamptz default now()
);
alter table public.custos_operacionais enable row level security;

-- Quem entrou no painel pode ler/gravar (mesma regra do Material de uso e das Receitas).
drop policy if exists custos_operacionais_all on public.custos_operacionais;
create policy custos_operacionais_all on public.custos_operacionais
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

do $$ begin
  alter publication supabase_realtime add table public.custos_operacionais;
exception when duplicate_object then null; end $$;


-- =====================================================================
--  PARTE 4 de 5 — RATEIO DE CUSTOS — despesa do setor vira custo por unidade
--  (origem: sql/rateios.sql)
-- =====================================================================

-- ============================================================
-- RATEIO DE CUSTOS — despesas reais do setor viram custo por unidade produzida.
-- O resultado vai para o Cadastro de Custos Operacionais (nunca direto na receita).
-- Guarda o histórico completo (nenhum rateio é apagado quando outro é criado).
-- Rode este SQL UMA vez no Supabase (SQL Editor).
-- ============================================================
create table if not exists public.rateios (
  id            text primary key,
  dados         jsonb not null,
  ordem         int,
  atualizado_em timestamptz default now()
);
alter table public.rateios enable row level security;

drop policy if exists rateios_all on public.rateios;
create policy rateios_all on public.rateios
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

do $$ begin
  alter publication supabase_realtime add table public.rateios;
exception when duplicate_object then null; end $$;


-- =====================================================================
--  PARTE 5 de 5 — AGENDA — recorrência (pendente desde julho)
--  OBS: esta parte precisa que o sql/agenda.sql já tenha sido rodado.
--  Se der erro aqui, TUDO ACIMA JÁ FOI APLICADO — só esta parte ficou de fora.
--  (origem: sql/agenda_recorrencia.sql)
-- =====================================================================

-- ============================================================
-- AGENDA — RECORRÊNCIA + endurecimento de segurança (Painel Santa Rita)
--
-- Rode DEPOIS do sql/agenda.sql. Adiciona compromissos que se repetem
-- (toda semana, todo mês, dias úteis, etc.) e fecha uma brecha residual
-- de RLS apontada na auditoria. ADITIVO e IDEMPOTENTE. Uma transação.
-- ============================================================

begin;

-- 1) Recorrência: colunas novas (o app preenche; ficam nulas p/ "não repete").
alter table public.agenda_eventos add column if not exists repete     text;   -- null/'nao'=uma vez; 'dia','uteis','semana','quinzena','mes'
alter table public.agenda_eventos add column if not exists repete_ate date;   -- opcional: repete até essa data (null = sem fim)

-- integridade: só aceita os valores que o app usa
do $$ begin
  if not exists (select 1 from pg_constraint where conname='agenda_repete_chk') then
    alter table public.agenda_eventos
      add constraint agenda_repete_chk
      check (repete is null or repete in ('nao','dia','uteis','semana','quinzena','mes'));
  end if;
end $$;

-- 2) Endurecimento RLS (auditoria): o vínculo por "criado_por" deixava um EX-master
--    continuar lendo/excluindo compromissos que ele havia posto na agenda de terceiros.
--    Trocamos por "para_id OR master". Para o uso pessoal (Parte 1) NADA muda: para_id = você.
drop policy if exists agenda_sel on public.agenda_eventos;
create policy agenda_sel on public.agenda_eventos for select to authenticated
  using ( tenant_id = public.current_tenant() and ( para_id = auth.uid() or public.sou_master() ) );

drop policy if exists agenda_del on public.agenda_eventos;
create policy agenda_del on public.agenda_eventos for delete to authenticated
  using ( tenant_id = public.current_tenant() and ( para_id = auth.uid() or public.sou_master() ) );

commit;

-- ============================================================
-- CONFERÊNCIA:
--   select column_name from information_schema.columns
--    where table_name='agenda_eventos' and column_name in ('repete','repete_ate');  -- deve listar as 2
--
-- ROLLBACK (desfazer só a recorrência):
--   alter table public.agenda_eventos drop column if exists repete;
--   alter table public.agenda_eventos drop column if exists repete_ate;
-- ============================================================


-- =====================================================================
--  CONFERÊNCIA FINAL — rode e veja se está tudo "OK".
-- =====================================================================
select t.nome as tabela,
       case when to_regclass('public.'||t.nome) is null then '❌ FALTOU' else '✅ OK' end as situacao
from (values ('despesas_resumo'),('despesas_teto'),('insumos'),
             ('custos_operacionais'),('rateios')) as t(nome)
order by 1;
