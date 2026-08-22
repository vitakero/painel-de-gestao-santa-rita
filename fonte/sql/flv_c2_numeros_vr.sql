-- ============================================================================
-- FLV — os números que vêm do VR
--
-- O Victor mostrou exatamente de onde ele tira cada número, e são DUAS telas
-- diferentes do VR:
--
--   FATURAMENTO ... Administrativo › Relatórios Gerenciais › Estatísticas,
--                   Exibição = VENDA, Mercadológico 043 › 001 FLV.
--   DESPERDÍCIO ... a tela do balanço da primeira segunda-feira do mês,
--                   coluna "Total Diferença" (e "Qtd. Diferença").
--
-- Cada fonte tem a sua tabela. Não junto as duas numa só de propósito: elas
-- têm chaves diferentes (o faturamento é por MÊS, o balanço é por DIA de
-- contagem) e misturar obrigaria a inventar linha vazia de um lado toda vez
-- que o outro chegasse primeiro.
--
-- O robô da loja escreve aqui (service key, passa por cima do RLS). O painel
-- só LÊ — é o botão "Buscar do VR" do fechamento que consulta estas tabelas.
-- Nada aqui calcula prêmio nem percentual: quem faz a conta continua sendo o
-- gatilho tg_flv_calcular, com os números já dentro de flv_fechamentos.
-- ============================================================================

create table if not exists public.flv_vr_faturamento (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null default public.current_tenant(),
  -- DATA do dia 1, igual a flv_fechamentos.competencia. Tinha comecado com texto
  -- 'YYYY-MM' e o painel nunca casaria: la a competencia e '2026-08-01'. Um formato
  -- so no modulo inteiro.
  competencia  date not null,
  faturamento  numeric(14,2),
  qtd_vendida  numeric(14,3),
  origem       jsonb,                            -- filtros usados, para conferência
  atualizado_em timestamptz not null default now(),
  constraint flv_vr_fat_comp_dia1 check (extract(day from competencia) = 1),
  constraint flv_vr_fat_unica unique (tenant_id, competencia)
);

create table if not exists public.flv_vr_balancos (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null default public.current_tenant(),
  -- O numero do balanco no VR (public.balanco.id). E ele que identifica a contagem:
  -- dois balancos de setores diferentes podem cair no mesmo dia, entao a data sozinha
  -- nao serve de chave.
  vr_id         integer not null,
  balanco_data  date not null,
  descricao     text,
  -- Sugestão, não verdade absoluta: é o mês que ocupa a maior parte do período
  -- entre o balanço anterior e este. O balanço de 03/08 fecha julho. Se algum
  -- mês fugir da regra, o Victor troca na tela — por isso "sugerida".
  competencia_sugerida date,
  periodo_de    date,
  periodo_ate   date,
  qtd_balanco   numeric(14,3),
  valor_balanco numeric(14,4),
  qtd_estoque   numeric(14,3),
  valor_estoque numeric(14,4),
  qtd_diferenca   numeric(14,3),
  valor_diferenca numeric(14,4),
  linhas        integer,
  origem        jsonb,
  atualizado_em timestamptz not null default now(),
  constraint flv_vr_bal_unico unique (tenant_id, vr_id)
);

create index if not exists ix_flv_vr_bal_comp
  on public.flv_vr_balancos (tenant_id, competencia_sugerida);

alter table public.flv_vr_faturamento enable row level security;
alter table public.flv_vr_balancos    enable row level security;

-- Leitura: quem tem a página do FLV liberada nos Acessos. Mesma regra do resto
-- do módulo (flv_c1_base.sql) — não crio permissão nova para o mesmo assunto.
drop policy if exists flv_vr_fat_ler on public.flv_vr_faturamento;
create policy flv_vr_fat_ler on public.flv_vr_faturamento
  for select using (tenant_id = public.current_tenant() and public.pode_pagina('flv'));

drop policy if exists flv_vr_bal_ler on public.flv_vr_balancos;
create policy flv_vr_bal_ler on public.flv_vr_balancos
  for select using (tenant_id = public.current_tenant() and public.pode_pagina('flv'));

-- Escrita: ninguém pela tela. Quem escreve é o robô, com a service key, que não
-- passa por RLS. Sem política de insert/update/delete = pela tela é só leitura,
-- e é isso que eu quero: número do VR não se digita por cima.
