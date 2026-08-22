-- ============================================================
-- FLV C1 — CONTROLE DE DESPERDÍCIO E PREMIAÇÃO DO SETOR FLV
--
-- Substitui a planilha que hoje é feita à mão depois do balanço do setor.
--
-- O QUE A PLANILHA FAZIA DE ERRADO E AQUI NÃO SE REPETE:
--   · mês sem fechamento aparecia como 0%, -100% e #DIV/0! — aqui, mês sem
--     fechamento simplesmente NÃO TEM LINHA, e a tela diz "aguardando"
--   · a regra vivia na fórmula da célula: mudar a meta reescrevia o passado.
--     Aqui cada fechamento guarda um SNAPSHOT da meta e do fator vigentes
--
-- QUEM FAZ AS CONTAS É ESTE ARQUIVO, por gatilho — não a tela.
--   A tela calcula a prévia enquanto a pessoa digita, mas o que fica GRAVADO
--   sai daqui. Se as duas contas morassem na tela, um dia divergiriam e o
--   histórico ficaria errado sem ninguém perceber. O gatilho recalcula tudo a
--   cada gravação: percentuais, prêmio, situação.
--
-- Pode rodar mais de uma vez sem estragar nada.
-- ============================================================


-- ============================================================
-- 1) AS REGRAS (meta e fator), configuráveis
--
-- Uma linha por tenant. Nada de valor cravado no código: o Victor vai mexer
-- nisso sem me chamar.
-- ============================================================
create table if not exists public.flv_config (
  tenant_id      uuid primary key default public.current_tenant(),
  meta_pct       numeric(7,4)  not null default 5,        -- desperdício <= isto = meta atingida
  fator_premio   numeric(10,6) not null default 0.0012,   -- prêmio = faturamento * fator
  atualizado_em  timestamptz   not null default now(),
  atualizado_por uuid,
  constraint flv_config_meta_ck  check (meta_pct >= 0 and meta_pct <= 100),
  constraint flv_config_fator_ck check (fator_premio >= 0 and fator_premio <= 1)
);

comment on table public.flv_config is
  'Meta máxima de desperdício e fator de premiação do FLV. Cada fechamento guarda um snapshot destes valores — mudar aqui não reescreve o passado.';


-- ============================================================
-- 2) A EQUIPE DO SETOR
--
-- O painel NÃO tem cadastro geral de funcionários; cada módulo tem o seu (o
-- Entregas tem entregas_equipe). Sigo o mesmo desenho, inclusive nas lições
-- que ele aprendeu apanhando: identidade por uuid (dois "José" são duas
-- pessoas), e INATIVAR em vez de excluir — quem saiu continua existindo nos
-- fechamentos de que participou.
-- ============================================================
create table if not exists public.flv_equipe (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null default public.current_tenant(),
  nome           text not null,
  ativo          boolean not null default true,
  criado_em      timestamptz not null default now(),
  criado_por     uuid,
  atualizado_em  timestamptz not null default now(),
  atualizado_por uuid,
  inativado_em   timestamptz,
  constraint flv_equipe_nome_ck check (btrim(nome) <> '')
);

create index if not exists ix_flv_equipe_ativo on public.flv_equipe (tenant_id, ativo, nome);


-- ============================================================
-- 3) O FECHAMENTO DO MÊS
--
-- competencia é sempre o DIA 1 do mês: date evita o inferno de comparar
-- "07/2026" com "7/2026" e ordena sozinho.
--
-- Os campos calculados (pct_*, premio_*, situacao) existem na tabela de
-- propósito, mesmo sendo deriváveis: o histórico precisa mostrar o que valia
-- NAQUELE dia, não o que a fórmula de hoje diria. Quem os preenche é o gatilho.
-- ============================================================
create table if not exists public.flv_fechamentos (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null default public.current_tenant(),
  setor              text not null default 'FLV',
  competencia        date not null,

  -- o que vem do balanço, digitado
  faturamento        numeric(14,2) not null,
  qtd_vendida        numeric(14,3),
  desperdicio_valor  numeric(14,2) not null,
  qtd_desperdicada   numeric(14,3),

  -- calculados pelo gatilho
  pct_valor          numeric(9,4),
  pct_qtd            numeric(9,4),
  premio_total       numeric(14,2) not null default 0,
  participantes      integer       not null default 0,
  premio_individual  numeric(14,2) not null default 0,
  situacao           text          not null default 'nao_atingida',

  -- SNAPSHOT da regra vigente quando o mês foi fechado
  meta_aplicada      numeric(7,4)  not null,
  fator_aplicado     numeric(10,6) not null,

  status             text not null default 'rascunho',
  observacoes        text,

  criado_em          timestamptz not null default now(),
  criado_por         uuid,
  atualizado_em      timestamptz not null default now(),
  atualizado_por     uuid,
  fechado_em         timestamptz,
  fechado_por        uuid,

  constraint flv_fech_status_ck    check (status in ('rascunho','fechado')),
  constraint flv_fech_situacao_ck  check (situacao in ('atingida','nao_atingida')),
  -- Faturamento zero não é "mês fraco": é dado que falta. Zero dividiria por
  -- zero e a planilha antiga cuspia #DIV/0! justamente aqui.
  constraint flv_fech_fat_ck       check (faturamento > 0),
  constraint flv_fech_desp_ck      check (desperdicio_valor >= 0),
  constraint flv_fech_qtdv_ck      check (qtd_vendida is null or qtd_vendida >= 0),
  constraint flv_fech_qtdd_ck      check (qtd_desperdicada is null or qtd_desperdicada >= 0),
  constraint flv_fech_part_ck      check (participantes >= 0),
  -- competência é sempre o primeiro dia do mês
  constraint flv_fech_comp_ck      check (competencia = date_trunc('month', competencia)::date)
);

-- UM fechamento por setor e competência. Dois seriam duas verdades sobre o
-- mesmo mês, e nenhuma tela saberia qual mostrar.
create unique index if not exists ux_flv_fech_competencia
  on public.flv_fechamentos (tenant_id, setor, competencia);

create index if not exists ix_flv_fech_ordem
  on public.flv_fechamentos (tenant_id, setor, competencia desc);

comment on column public.flv_fechamentos.meta_aplicada is
  'A meta que valia quando este mês foi fechado. Mudar flv_config NÃO altera o passado.';


-- ============================================================
-- 4) QUEM PARTICIPOU DAQUELE FECHAMENTO
--
-- Guarda o NOME junto, congelado. Se a pessoa for renomeada ou sair da equipe,
-- o fechamento de julho continua dizendo quem dividiu o prêmio de julho.
-- ============================================================
create table if not exists public.flv_fechamento_equipe (
  fechamento_id uuid not null references public.flv_fechamentos(id) on delete cascade,
  equipe_id     uuid references public.flv_equipe(id),
  nome          text not null,
  primary key (fechamento_id, nome)
);

create index if not exists ix_flv_fech_eq on public.flv_fechamento_equipe (fechamento_id);


-- ============================================================
-- 5) A CONTA — UM LUGAR SÓ
--
-- Recalcula tudo a cada gravação, a partir do que foi digitado. A tela pode
-- mandar o que quiser nos campos calculados: são sobrescritos aqui.
--
-- Arredondamento em duas casas no dinheiro, sempre com numeric (nunca float:
-- 0,1 + 0,2 em float não dá 0,3, e isso vira centavo errado no prêmio).
-- ============================================================
create or replace function public.tg_flv_calcular()
returns trigger language plpgsql set search_path = public as $$
declare v_n int;
begin
  new.setor := coalesce(nullif(btrim(new.setor), ''), 'FLV');

  -- percentual financeiro: o indicador OFICIAL da premiação
  new.pct_valor := round((new.desperdicio_valor / new.faturamento) * 100, 4);

  -- percentual em quantidade: acompanha, mas NÃO decide prêmio
  new.pct_qtd := case
    when new.qtd_vendida is null or new.qtd_vendida <= 0 then null
    when new.qtd_desperdicada is null then null
    else round((new.qtd_desperdicada / new.qtd_vendida) * 100, 4)
  end;

  new.situacao := case when new.pct_valor <= new.meta_aplicada
                       then 'atingida' else 'nao_atingida' end;

  -- quantos participam: conta a lista de verdade, não um número digitado
  select count(*) into v_n from public.flv_fechamento_equipe where fechamento_id = new.id;
  new.participantes := coalesce(v_n, 0);

  if new.situacao = 'atingida' then
    new.premio_total := round(new.faturamento * new.fator_aplicado, 2);
    new.premio_individual := case when new.participantes > 0
      then round(new.premio_total / new.participantes, 2) else 0 end;
  else
    new.premio_total := 0;
    new.premio_individual := 0;
  end if;

  new.atualizado_em := now();
  return new;
end $$;

drop trigger if exists trg_flv_calcular on public.flv_fechamentos;
create trigger trg_flv_calcular
  before insert or update on public.flv_fechamentos
  for each row execute function public.tg_flv_calcular();


-- A lista de participantes muda DEPOIS de o fechamento existir (a linha do
-- fechamento nasce primeiro). Sem isto, participantes ficaria sempre 0 e o
-- prêmio individual nunca sairia.
create or replace function public.tg_flv_recontar()
returns trigger language plpgsql set search_path = public as $$
declare v_id uuid;
begin
  v_id := coalesce(new.fechamento_id, old.fechamento_id);
  -- um update vazio dispara o gatilho de cálculo, que reconta e refaz o prêmio
  update public.flv_fechamentos set atualizado_em = now() where id = v_id;
  return null;
end $$;

drop trigger if exists trg_flv_recontar on public.flv_fechamento_equipe;
create trigger trg_flv_recontar
  after insert or delete on public.flv_fechamento_equipe
  for each row execute function public.tg_flv_recontar();


-- ============================================================
-- 6) AUDITORIA — no livro que já existe
--
-- O painel já tem public.eventos, alimentado por gatilho (é assim no Entregas).
-- Nada de livro paralelo.
-- ============================================================
create or replace function public.tg_flv_evento()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_tipo text; v_resumo text; v_comp text;
begin
  v_comp := to_char(new.competencia, 'MM/YYYY');
  if tg_op = 'INSERT' then
    v_tipo := 'flv.fechamento.criado';
    v_resumo := 'Fechamento FLV ' || v_comp || ' criado como ' || new.status;
  elsif old.status is distinct from new.status then
    v_tipo := case when new.status = 'fechado' then 'flv.fechamento.fechado'
                   else 'flv.fechamento.reaberto' end;
    v_resumo := 'Fechamento FLV ' || v_comp || ': ' || old.status || ' -> ' || new.status;
  elsif old.faturamento is distinct from new.faturamento
     or old.desperdicio_valor is distinct from new.desperdicio_valor
     or old.qtd_vendida is distinct from new.qtd_vendida
     or old.qtd_desperdicada is distinct from new.qtd_desperdicada then
    v_tipo := 'flv.fechamento.editado';
    v_resumo := 'Fechamento FLV ' || v_comp || ' teve os números alterados';
  else
    return new;                       -- mexida irrelevante não polui o livro
  end if;

  insert into public.eventos (event_uuid, tenant_id, tipo, entity_type, entity_id,
                              autor_id, setor, resumo, payload)
  values (gen_random_uuid(), new.tenant_id, v_tipo, 'flv_fechamentos', new.id::text,
          coalesce(new.atualizado_por, new.criado_por), 'FLV', v_resumo,
          jsonb_build_object('competencia', new.competencia,
                             'faturamento', new.faturamento,
                             'desperdicio_valor', new.desperdicio_valor,
                             'pct_valor', new.pct_valor,
                             'meta_aplicada', new.meta_aplicada,
                             'situacao', new.situacao,
                             'premio_total', new.premio_total,
                             'participantes', new.participantes,
                             'status', new.status));
  return new;
end $$;

drop trigger if exists trg_flv_evento on public.flv_fechamentos;
create trigger trg_flv_evento
  after insert or update on public.flv_fechamentos
  for each row execute function public.tg_flv_evento();


-- ============================================================
-- 7) QUEM VÊ E QUEM MEXE
--
-- Segue o padrão da casa: liberar a página nos Acessos já dá acesso.
-- ============================================================
alter table public.flv_config            enable row level security;
alter table public.flv_equipe            enable row level security;
alter table public.flv_fechamentos       enable row level security;
alter table public.flv_fechamento_equipe enable row level security;

drop policy if exists flv_cfg_sel on public.flv_config;
create policy flv_cfg_sel on public.flv_config for select to authenticated
  using (tenant_id = public.current_tenant() and public.pode_pagina('flv'));
drop policy if exists flv_cfg_wr on public.flv_config;
create policy flv_cfg_wr on public.flv_config for all to authenticated
  using (tenant_id = public.current_tenant() and public.eh_master())
  with check (tenant_id = public.current_tenant() and public.eh_master());

drop policy if exists flv_eq_sel on public.flv_equipe;
create policy flv_eq_sel on public.flv_equipe for select to authenticated
  using (tenant_id = public.current_tenant() and public.pode_pagina('flv'));
drop policy if exists flv_eq_wr on public.flv_equipe;
create policy flv_eq_wr on public.flv_equipe for all to authenticated
  using (tenant_id = public.current_tenant() and public.pode_pagina('flv'))
  with check (tenant_id = public.current_tenant() and public.pode_pagina('flv'));

drop policy if exists flv_fe_sel on public.flv_fechamentos;
create policy flv_fe_sel on public.flv_fechamentos for select to authenticated
  using (tenant_id = public.current_tenant() and public.pode_pagina('flv'));
drop policy if exists flv_fe_wr on public.flv_fechamentos;
create policy flv_fe_wr on public.flv_fechamentos for all to authenticated
  using (tenant_id = public.current_tenant() and public.pode_pagina('flv'))
  with check (tenant_id = public.current_tenant() and public.pode_pagina('flv'));

drop policy if exists flv_fq_sel on public.flv_fechamento_equipe;
create policy flv_fq_sel on public.flv_fechamento_equipe for select to authenticated
  using (exists (select 1 from public.flv_fechamentos f where f.id = fechamento_id));
drop policy if exists flv_fq_wr on public.flv_fechamento_equipe;
create policy flv_fq_wr on public.flv_fechamento_equipe for all to authenticated
  using (exists (select 1 from public.flv_fechamentos f where f.id = fechamento_id))
  with check (exists (select 1 from public.flv_fechamentos f where f.id = fechamento_id));

revoke all on table public.flv_config, public.flv_equipe,
                    public.flv_fechamentos, public.flv_fechamento_equipe from anon;
grant select, insert, update, delete on table
  public.flv_config, public.flv_equipe,
  public.flv_fechamentos, public.flv_fechamento_equipe to authenticated;


-- ============================================================
-- 8) A REGRA NASCE COM O PADRÃO DE HOJE
-- ============================================================
insert into public.flv_config (tenant_id, meta_pct, fator_premio)
values (public.current_tenant(), 5, 0.0012)
on conflict (tenant_id) do nothing;


-- ============================================================
-- 9) CONFERÊNCIA
-- ============================================================
select 'as quatro tabelas existem' as conferir, count(*) as quantas
  from information_schema.tables
 where table_schema='public'
   and table_name in ('flv_config','flv_equipe','flv_fechamentos','flv_fechamento_equipe');

select 'a regra padrao' as conferir, meta_pct, fator_premio from public.flv_config;

select 'os gatilhos existem' as conferir, tgname
  from pg_trigger where tgname in ('trg_flv_calcular','trg_flv_recontar','trg_flv_evento')
 order by tgname;

select 'anonimo NAO le' as conferir,
       has_table_privilege('anon','public.flv_fechamentos','select') as anon_le;
