-- ============================================================
-- CENTRAL OPERACIONAL — SPRINT 0 (só infraestrutura)
-- Objetivo: preparar toda a base (tabelas, funções, triggers, RLS, realtime,
-- feature flags, RPCs de escrita) SEM tocar em NADA existente do Painel.
--
-- 100% ADITIVO: só CREATE de objetos NOVOS. Nenhuma tabela/coluna/policy
-- existente é alterada. Nenhuma tela, nav, feed ou chat é criado aqui.
-- IDEMPOTENTE: pode rodar mais de uma vez com segurança.
-- COMO USAR: rodar PRIMEIRO num projeto Supabase de STAGING (dump de teste),
--   conferir, e só então em produção. Bloco de ROLLBACK comentado no fim.
--
-- Convenções seguidas (iguais ao resto do projeto):
--   - RLS ligada + policies (como galpoes.sql / permissoes_padrao.sql);
--   - reusa a função existente public.pode_pagina('operacional');
--   - realtime via "alter publication supabase_realtime add table" (como central.sql);
--   - grant execute a authenticated + revoke public (como senha_master.sql).
-- ============================================================

-- ============================================================
-- SEÇÃO 0 — Extensões e função de tenant
-- ============================================================
create extension if not exists pgcrypto  with schema extensions;   -- gen_random_uuid (normalmente já existe)
create extension if not exists unaccent  with schema extensions;   -- busca ignorando acento

-- Loja única por enquanto. Quando houver multi-loja, resolver por claim do JWT.
create or replace function public.current_tenant()
returns uuid language sql stable as $$
  select '11111111-1111-1111-1111-111111111111'::uuid
$$;

-- ============================================================
-- SEÇÃO 1 — Tabelas novas (todas com tenant_id; IDs de negócio vêm do cliente = UUIDv7)
-- ============================================================

-- 1.1 topico — o ÚNICO container de contexto/conversa (canal, recebimento, ocorrência, manutenção, geral)
create table if not exists public.topico (
  id            uuid primary key,
  tenant_id     uuid not null default public.current_tenant(),
  tipo          text not null check (tipo in ('canal','recebimento','ocorrencia','manutencao','geral')),
  titulo        text not null,
  setor         text,
  status        text not null default 'aberto' check (status in ('aberto','arquivado')),
  origem_tipo   text,   -- 'central_agendamentos' | 'manutencoes' | 'work_items' (null p/ canal/geral)
  origem_id     text,
  criado_por    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists ux_topico_origem   on public.topico(tenant_id, origem_tipo, origem_id) where origem_tipo is not null;
create index        if not exists ix_topico_tipo      on public.topico(tenant_id, tipo);
create index        if not exists ix_topico_setor     on public.topico(tenant_id, setor);
create index        if not exists ix_topico_updated   on public.topico(tenant_id, updated_at desc);

-- 1.2 eventos — espinha append-only do Feed/busca; SÓ triggers escrevem aqui
create table if not exists public.eventos (
  id            bigint generated always as identity primary key,   -- cursor keyset denso
  event_uuid    uuid not null,                                     -- idempotência ponta-a-ponta
  tenant_id     uuid not null default public.current_tenant(),
  tipo          text not null,
  topico_id     uuid references public.topico(id),
  entity_type   text,   -- nome da tabela física: 'mensagens'|'work_items'|'manutencoes'|'central_agendamentos'|'topico'
  entity_id     text,
  autor_id      uuid,
  setor         text,
  resumo        text,
  payload       jsonb not null default '{}'::jsonb,
  busca         tsvector,
  created_at    timestamptz not null default now(),
  unique (tenant_id, event_uuid)
);
create index if not exists ix_eventos_feed        on public.eventos(tenant_id, id desc);
create index if not exists ix_eventos_feed_setor  on public.eventos(tenant_id, setor, id desc);
create index if not exists ix_eventos_feed_tipo   on public.eventos(tenant_id, tipo, id desc);
create index if not exists ix_eventos_entity      on public.eventos(tenant_id, entity_type, entity_id);
create index if not exists ix_eventos_topico      on public.eventos(tenant_id, topico_id, id desc);
create index if not exists gin_eventos_busca      on public.eventos using gin (busca);

-- 1.3 mensagens — sempre pertencem a um topico
create table if not exists public.mensagens (
  id                 uuid primary key,   -- UUIDv7 do cliente
  tenant_id          uuid not null default public.current_tenant(),
  topico_id          uuid not null references public.topico(id),
  autor_id           uuid,               -- null = mensagem de sistema
  corpo              text,               -- texto ou transcrição do áudio
  tipo_conteudo      text not null default 'texto' check (tipo_conteudo in ('texto','foto','audio','sistema')),
  transcricao_status text check (transcricao_status in ('pendente','ok','falha')),
  reply_para         uuid references public.mensagens(id),   -- reply raso (1 nível)
  busca              tsvector,
  editado_em         timestamptz,
  removido_em        timestamptz,        -- soft-delete
  created_at         timestamptz not null default now()
);
create index if not exists ix_mensagens_keyset on public.mensagens(tenant_id, topico_id, created_at desc, id desc);
create index if not exists ix_mensagens_autor  on public.mensagens(tenant_id, autor_id);
create index if not exists gin_mensagens_busca on public.mensagens using gin (busca);

-- 1.4 vinculo — arestas polimórficas (topico_id = FK real; outro lado polimórfico)
create table if not exists public.vinculo (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null default public.current_tenant(),
  topico_id     uuid not null references public.topico(id),
  entity_type   text not null,
  entity_id     text not null,
  papel         text not null default 'relacionado',   -- 'origem'|'derivado_de'|'relacionado'
  created_at    timestamptz not null default now(),
  unique (tenant_id, topico_id, entity_type, entity_id, papel)
);
create index if not exists ix_vinculo_entity on public.vinculo(tenant_id, entity_type, entity_id);

-- 1.5 anexo — mídia de mensagem (Storage privado)
create table if not exists public.anexo (
  id            uuid primary key,
  tenant_id     uuid not null default public.current_tenant(),
  mensagem_id   uuid not null references public.mensagens(id),
  tipo          text not null check (tipo in ('foto','audio','arquivo')),
  storage_path  text not null,
  mime          text, bytes bigint, largura int, altura int, duracao_ms int,
  created_at    timestamptz not null default now()
);
create index if not exists ix_anexo_mensagem on public.anexo(tenant_id, mensagem_id);

-- 1.6 leituras — cursor de não-lidas por (topico, usuário)
create table if not exists public.leituras (
  tenant_id       uuid not null default public.current_tenant(),
  topico_id       uuid not null references public.topico(id),
  usuario_id      uuid not null,
  ultima_lida_id  uuid references public.mensagens(id),
  ultima_lida_em  timestamptz not null default now(),
  primary key (tenant_id, topico_id, usuario_id)
);
create index if not exists ix_leituras_usuario on public.leituras(tenant_id, usuario_id);

-- 1.7 mensagem_mencoes — @menções
create table if not exists public.mensagem_mencoes (
  tenant_id     uuid not null default public.current_tenant(),
  mensagem_id   uuid not null references public.mensagens(id),
  mencionado_id uuid not null,
  created_at    timestamptz not null default now(),
  primary key (tenant_id, mensagem_id, mencionado_id)
);
create index if not exists ix_mencoes_usuario on public.mensagem_mencoes(tenant_id, mencionado_id, created_at desc);

-- 1.8 mensagem_reacoes — reações (emoji)
create table if not exists public.mensagem_reacoes (
  tenant_id     uuid not null default public.current_tenant(),
  mensagem_id   uuid not null references public.mensagens(id),
  usuario_id    uuid not null,
  emoji         text not null,
  created_at    timestamptz not null default now(),
  primary key (tenant_id, mensagem_id, usuario_id, emoji)
);
create index if not exists ix_reacoes_mensagem on public.mensagem_reacoes(tenant_id, mensagem_id);

-- 1.9 work_items — objetos operacionais (no MVP, só Ocorrência)
create table if not exists public.work_items (
  id                 uuid primary key,   -- UUIDv7 do cliente
  tenant_id          uuid not null default public.current_tenant(),
  tipo               text not null default 'ocorrencia' check (tipo in ('ocorrencia')),
  titulo             text not null,
  descricao          text,
  setor              text,
  status             text not null default 'aberta' check (status in ('aberta','em_andamento','resolvida','cancelada')),
  prioridade         text not null default 'normal' check (prioridade in ('baixa','normal','alta')),
  topico_id          uuid references public.topico(id),
  origem_mensagem_id uuid references public.mensagens(id),
  criado_por         uuid,
  responsavel_id     uuid,
  resolvido_em       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists ix_workitems_status      on public.work_items(tenant_id, status, updated_at desc);
create index if not exists ix_workitems_setor       on public.work_items(tenant_id, setor, status);
create index if not exists ix_workitems_responsavel on public.work_items(tenant_id, responsavel_id, status);
create index if not exists ix_workitems_origem      on public.work_items(tenant_id, origem_mensagem_id);

-- 1.10 feature_flags — liga/desliga o módulo por partes (tudo OFF no seed)
create table if not exists public.feature_flags (
  tenant_id   uuid not null default public.current_tenant(),
  chave       text not null,
  habilitado  boolean not null default false,
  payload     jsonb not null default '{}'::jsonb,   -- ex: {"perfis_liberados":[uuid,...]}
  updated_at  timestamptz not null default now(),
  primary key (tenant_id, chave)
);

-- ============================================================
-- SEÇÃO 2 — Funções de acesso (membership barata, STABLE, SECURITY DEFINER)
-- Reusa a permissão-por-página existente pode_pagina('operacional').
-- SECURITY DEFINER = roda como o dono (postgres), que IGNORA a RLS das tabelas
-- (não há FORCE ROW LEVEL SECURITY) -> por isso a leitura interna de topico/perfis
-- não reaplica as policies e NÃO há recursão.
-- ============================================================
-- Master atual? Helper definer p/ as policies não dependerem da RLS de 'perfis'.
create or replace function public.sou_master()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perfis p where p.id = auth.uid() and coalesce(p.is_master, false));
$$;

create or replace function public.pode_ver_topico(p_topico_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.perfis me
    join public.topico t
      on t.id = p_topico_id
     and t.tenant_id = public.current_tenant()
    where me.id = auth.uid()
      and (
        coalesce(me.is_master, false)                                   -- master vê tudo
        or (
          public.pode_pagina('operacional')                                -- precisa da página "operacional" (Central Operacional)
          and (
                t.tipo = 'geral'
             or t.tipo in ('recebimento','ocorrencia','manutencao')    -- contexto operacional
             or (t.tipo = 'canal' and (t.setor is null or btrim(lower(t.setor)) = btrim(lower(coalesce(me.setor,'')))))
          )
        )
      )
  );
$$;

-- ============================================================
-- SEÇÃO 3 — Triggers (SOMENTE em tabelas NOVAS): busca (tsvector) + outbox (evento)
-- Regra única: TODO evento nasce de trigger-as-outbox; nenhuma RPC escreve em 'eventos'.
-- ============================================================

-- 3.1 busca das mensagens
create or replace function public.tg_mensagens_busca()
returns trigger language plpgsql set search_path = public, extensions as $$
begin
  new.busca := to_tsvector('portuguese', unaccent(coalesce(new.corpo, '')));
  return new;
end $$;
drop trigger if exists trg_mensagens_busca on public.mensagens;
create trigger trg_mensagens_busca
  before insert or update of corpo on public.mensagens
  for each row execute function public.tg_mensagens_busca();

-- 3.2 busca dos eventos
create or replace function public.tg_eventos_busca()
returns trigger language plpgsql set search_path = public, extensions as $$
begin
  new.busca := to_tsvector('portuguese', unaccent(coalesce(new.resumo, '') || ' ' || coalesce(new.payload->>'texto','')));
  return new;
end $$;
drop trigger if exists trg_eventos_busca on public.eventos;
create trigger trg_eventos_busca
  before insert on public.eventos
  for each row execute function public.tg_eventos_busca();

-- 3.3 outbox: topico -> eventos('topico.criado')
create or replace function public.tg_topico_outbox()
returns trigger language plpgsql set search_path = public as $$
begin
  insert into public.eventos(event_uuid, tenant_id, tipo, topico_id, entity_type, entity_id, autor_id, setor, resumo, payload)
  values (md5(new.tenant_id::text || '|topico.criado|' || new.id::text)::uuid, new.tenant_id, 'topico.criado', new.id, 'topico', new.id::text, new.criado_por, new.setor,
          'Novo tópico: ' || coalesce(new.titulo,''), jsonb_build_object('tipo', new.tipo, 'titulo', new.titulo))
  on conflict (tenant_id, event_uuid) do nothing;
  return new;
end $$;
drop trigger if exists trg_topico_outbox on public.topico;
create trigger trg_topico_outbox
  after insert on public.topico
  for each row execute function public.tg_topico_outbox();

-- 3.4 outbox: mensagens -> eventos('mensagem.criada') + bump topico.updated_at
create or replace function public.tg_mensagens_outbox()
returns trigger language plpgsql set search_path = public as $$
declare v_setor text;
begin
  select setor into v_setor from public.topico where id = new.topico_id;
  insert into public.eventos(event_uuid, tenant_id, tipo, topico_id, entity_type, entity_id, autor_id, setor, resumo, payload)
  values (md5(new.tenant_id::text || '|mensagem.criada|' || new.id::text)::uuid, new.tenant_id, 'mensagem.criada', new.topico_id, 'mensagens', new.id::text, new.autor_id, v_setor,
          left(coalesce(new.corpo, '[mídia]'), 140), jsonb_build_object('tipo_conteudo', new.tipo_conteudo))
  on conflict (tenant_id, event_uuid) do nothing;
  update public.topico set updated_at = now() where id = new.topico_id;
  return new;
end $$;
drop trigger if exists trg_mensagens_outbox on public.mensagens;
create trigger trg_mensagens_outbox
  after insert on public.mensagens
  for each row execute function public.tg_mensagens_outbox();

-- 3.5 outbox: work_items -> eventos('ocorrencia.criada' / 'ocorrencia.status')
create or replace function public.tg_workitems_outbox()
returns trigger language plpgsql set search_path = public as $$
begin
  if TG_OP = 'INSERT' then
    insert into public.eventos(event_uuid, tenant_id, tipo, topico_id, entity_type, entity_id, autor_id, setor, resumo, payload)
    values (md5(new.tenant_id::text || '|ocorrencia.criada|' || new.id::text)::uuid, new.tenant_id, 'ocorrencia.criada', new.topico_id, 'work_items', new.id::text, new.criado_por, new.setor,
            'Ocorrência: ' || coalesce(new.titulo,''), jsonb_build_object('status', new.status, 'prioridade', new.prioridade))
    on conflict (tenant_id, event_uuid) do nothing;
  elsif TG_OP = 'UPDATE' and new.status is distinct from old.status then
    insert into public.eventos(event_uuid, tenant_id, tipo, topico_id, entity_type, entity_id, autor_id, setor, resumo, payload)
    values (md5(new.tenant_id::text || '|ocorrencia.status|' || new.id::text || '|' || new.status)::uuid, new.tenant_id, 'ocorrencia.status', new.topico_id, 'work_items', new.id::text, new.responsavel_id, new.setor,
            'Ocorrência ' || coalesce(new.titulo,'') || ' → ' || new.status, jsonb_build_object('de', old.status, 'para', new.status))
    on conflict (tenant_id, event_uuid) do nothing;
  end if;
  return new;
end $$;
drop trigger if exists trg_workitems_outbox on public.work_items;
create trigger trg_workitems_outbox
  after insert or update on public.work_items
  for each row execute function public.tg_workitems_outbox();

-- ============================================================
-- SEÇÃO 4 — RPCs de escrita (SECURITY DEFINER, idempotentes). Escrita SÓ por RPC.
-- (Nenhuma toca em módulo existente. virar_manutencao e as RPCs de leitura/feed
--  ficam para a Sprint 1 — ver nota no fim.)
-- ============================================================

-- 4.1 criar canal (canal/geral)
create or replace function public.criar_topico_canal(p_id uuid, p_titulo text, p_setor text default null, p_tipo text default 'canal')
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not public.pode_pagina('operacional') then raise exception 'sem permissao para a Central Operacional'; end if;
  if p_tipo not in ('canal','geral') then raise exception 'tipo invalido para canal'; end if;
  insert into public.topico(id, tenant_id, tipo, titulo, setor, criado_por)
  values (p_id, public.current_tenant(), p_tipo, p_titulo, p_setor, auth.uid())
  on conflict (id) do nothing;
  return p_id;
end $$;

-- 4.2 postar mensagem — idempotente pelo id UUIDv7 do cliente (a chave da escrita).
-- (O event_uuid do Feed é derivado deterministicamente no trigger, a partir do id da
--  mensagem — por isso não precisa de um p_event_uuid separado aqui.)
create or replace function public.postar_mensagem(
  p_mensagem_id uuid, p_topico_id uuid, p_corpo text,
  p_tipo text default 'texto', p_anexos jsonb default '[]'::jsonb,
  p_mencoes uuid[] default '{}', p_reply uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_tenant uuid := public.current_tenant(); a jsonb;
begin
  if not public.pode_ver_topico(p_topico_id) then raise exception 'sem acesso a este topico'; end if;

  insert into public.mensagens(id, tenant_id, topico_id, autor_id, corpo, tipo_conteudo, reply_para, transcricao_status)
  values (p_mensagem_id, v_tenant, p_topico_id, auth.uid(), p_corpo, p_tipo, p_reply,
          case when p_tipo = 'audio' then 'pendente' else null end)
  on conflict (id) do nothing;

  if not found then
    -- Conflito no id: já existia. Idempotência DE VERDADE: só é replay legítimo se for a MESMA
    -- mensagem (mesmo tópico/autor/conteúdo/tipo/reply). Aí retorna sem duplicar anexos/menções/evento.
    -- Se o mesmo id vier com CONTEÚDO DIFERENTE, é bug do cliente ou colisão de UUID => ERRO ALTO,
    -- nunca "sucesso" silencioso (senão a 2ª mensagem sumiria sem ninguém perceber).
    if exists (
      select 1 from public.mensagens m
      where m.id = p_mensagem_id
        and m.tenant_id     = v_tenant
        and m.topico_id     = p_topico_id
        and m.autor_id      is not distinct from auth.uid()
        and m.corpo         is not distinct from p_corpo
        -- ATENÇÃO (futuro): quando ÁUDIO entrar, a transcrição MUTA mensagens.corpo depois do insert.
        -- Aí um reenvio do mesmo id de áudio cairia neste guard e daria 23505 indevido. Antes de ligar
        -- áudio, tirar 'corpo' da comparação para tipos mutáveis (comparar só id/topico/autor/tipo).
        and m.tipo_conteudo = p_tipo
        and m.reply_para    is not distinct from p_reply
    ) then
      return p_mensagem_id;               -- replay idêntico => idempotente
    end if;
    raise exception 'id de mensagem % reutilizado com conteudo diferente', p_mensagem_id
      using errcode = '23505';            -- 23505 = unique_violation (id reusado)
  end if;

  if p_anexos is not null and jsonb_typeof(p_anexos) = 'array' then
    for a in select * from jsonb_array_elements(p_anexos) loop
      insert into public.anexo(id, tenant_id, mensagem_id, tipo, storage_path, mime, bytes, largura, altura, duracao_ms)
      values (coalesce(nullif(a->>'id','')::uuid, gen_random_uuid()), v_tenant, p_mensagem_id,
              a->>'tipo', a->>'storage_path', a->>'mime',
              nullif(a->>'bytes','')::bigint, nullif(a->>'largura','')::int, nullif(a->>'altura','')::int, nullif(a->>'duracao_ms','')::int)
      on conflict (id) do nothing;
    end loop;
  end if;

  if array_length(p_mencoes, 1) is not null then
    insert into public.mensagem_mencoes(tenant_id, mensagem_id, mencionado_id)
    select v_tenant, p_mensagem_id, unnest(p_mencoes)
    on conflict do nothing;
  end if;

  return p_mensagem_id;
end $$;

-- 4.3 marcar lido (avança o cursor)
create or replace function public.marcar_lido(p_topico_id uuid, p_ate_mensagem_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.pode_ver_topico(p_topico_id) then raise exception 'sem acesso a este topico'; end if;
  insert into public.leituras(tenant_id, topico_id, usuario_id, ultima_lida_id, ultima_lida_em)
  values (public.current_tenant(), p_topico_id, auth.uid(), p_ate_mensagem_id, now())
  on conflict (tenant_id, topico_id, usuario_id)
  do update set ultima_lida_id = excluded.ultima_lida_id, ultima_lida_em = now();
end $$;

-- 4.4 toggle de reação (idempotente)
create or replace function public.toggle_reacao(p_mensagem_id uuid, p_emoji text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_topico uuid; v_tem boolean;
begin
  select topico_id into v_topico from public.mensagens where id = p_mensagem_id;
  if v_topico is null or not public.pode_ver_topico(v_topico) then raise exception 'sem acesso'; end if;
  select true into v_tem from public.mensagem_reacoes
    where mensagem_id = p_mensagem_id and usuario_id = auth.uid() and emoji = p_emoji;
  if v_tem then
    delete from public.mensagem_reacoes where mensagem_id = p_mensagem_id and usuario_id = auth.uid() and emoji = p_emoji;
    return false;
  else
    insert into public.mensagem_reacoes(tenant_id, mensagem_id, usuario_id, emoji)
    values (public.current_tenant(), p_mensagem_id, auth.uid(), p_emoji)
    on conflict do nothing;
    return true;
  end if;
end $$;

-- 4.5 virar ocorrência (só tabelas NOVAS; sempre chamada após confirmação humana na tela)
create or replace function public.virar_ocorrencia(
  p_id uuid, p_topico_id uuid, p_mensagem_id uuid, p_titulo text,
  p_descricao text default null, p_setor text default null, p_prioridade text default 'normal')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_tenant uuid := public.current_tenant();
begin
  if not public.pode_pagina('operacional') then raise exception 'sem permissao'; end if;
  if exists (select 1 from public.work_items where id = p_id) then return p_id; end if;   -- idempotente

  insert into public.topico(id, tenant_id, tipo, titulo, setor, origem_tipo, origem_id, criado_por)
  values (p_topico_id, v_tenant, 'ocorrencia', p_titulo, p_setor, 'work_items', p_id::text, auth.uid())
  on conflict (id) do nothing;

  insert into public.work_items(id, tenant_id, tipo, titulo, descricao, setor, prioridade, topico_id, origem_mensagem_id, criado_por)
  values (p_id, v_tenant, 'ocorrencia', p_titulo, p_descricao, p_setor, p_prioridade, p_topico_id, p_mensagem_id, auth.uid())
  on conflict (id) do nothing;

  if p_mensagem_id is not null then
    insert into public.vinculo(tenant_id, topico_id, entity_type, entity_id, papel)
    values (v_tenant, p_topico_id, 'mensagens', p_mensagem_id::text, 'origem')
    on conflict do nothing;
  end if;

  return p_id;
end $$;

-- ============================================================
-- SEÇÃO 5 — RLS: ligar por ÚLTIMO. Leitura por policy; ESCRITA só via RPC (definer).
-- (Sem policy de INSERT/UPDATE/DELETE p/ o cliente nas tabelas de conteúdo:
--  as RPCs security definer escrevem passando por cima da RLS, como o robô já faz.)
-- ============================================================
alter table public.topico            enable row level security;
alter table public.eventos           enable row level security;
alter table public.mensagens         enable row level security;
alter table public.vinculo           enable row level security;
alter table public.anexo             enable row level security;
alter table public.leituras          enable row level security;
alter table public.mensagem_mencoes  enable row level security;
alter table public.mensagem_reacoes  enable row level security;
alter table public.work_items        enable row level security;
alter table public.feature_flags     enable row level security;

drop policy if exists topico_sel on public.topico;
create policy topico_sel on public.topico for select to authenticated
  using (public.pode_ver_topico(id));

drop policy if exists eventos_sel on public.eventos;
create policy eventos_sel on public.eventos for select to authenticated
  using ( tenant_id = public.current_tenant()
          and ( public.pode_ver_topico(topico_id)
                or (topico_id is null and public.pode_pagina('operacional')) ) );

drop policy if exists mensagens_sel on public.mensagens;
create policy mensagens_sel on public.mensagens for select to authenticated
  using (public.pode_ver_topico(topico_id));

drop policy if exists vinculo_sel on public.vinculo;
create policy vinculo_sel on public.vinculo for select to authenticated
  using (public.pode_ver_topico(topico_id));

drop policy if exists anexo_sel on public.anexo;
create policy anexo_sel on public.anexo for select to authenticated
  using (exists (select 1 from public.mensagens m where m.id = anexo.mensagem_id and public.pode_ver_topico(m.topico_id)));

drop policy if exists leituras_sel on public.leituras;
create policy leituras_sel on public.leituras for select to authenticated
  using (tenant_id = public.current_tenant() and usuario_id = auth.uid());

drop policy if exists mencoes_sel on public.mensagem_mencoes;
create policy mencoes_sel on public.mensagem_mencoes for select to authenticated
  using ( tenant_id = public.current_tenant()
          and ( mencionado_id = auth.uid()
                or exists (select 1 from public.mensagens m where m.id = mensagem_mencoes.mensagem_id and public.pode_ver_topico(m.topico_id)) ) );

drop policy if exists reacoes_sel on public.mensagem_reacoes;
create policy reacoes_sel on public.mensagem_reacoes for select to authenticated
  using (exists (select 1 from public.mensagens m where m.id = mensagem_reacoes.mensagem_id and public.pode_ver_topico(m.topico_id)));

drop policy if exists workitems_sel on public.work_items;
create policy workitems_sel on public.work_items for select to authenticated
  using (tenant_id = public.current_tenant() and public.pode_pagina('operacional'));

-- feature_flags: qualquer logado do tenant LÊ; só master escreve
drop policy if exists ff_sel on public.feature_flags;
create policy ff_sel on public.feature_flags for select to authenticated
  using (tenant_id = public.current_tenant());
drop policy if exists ff_admin on public.feature_flags;
create policy ff_admin on public.feature_flags for all to authenticated
  using (tenant_id = public.current_tenant() and public.sou_master())
  with check (tenant_id = public.current_tenant() and public.sou_master());

-- ============================================================
-- SEÇÃO 6 — Realtime (publication) + seed das feature flags (todas OFF)
-- ============================================================
do $$
declare t text;
begin
  foreach t in array array['topico','eventos','mensagens','leituras','mensagem_reacoes','work_items'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

insert into public.feature_flags(tenant_id, chave, habilitado) values
  (public.current_tenant(), 'central_operacional',    false),
  (public.current_tenant(), 'central_feed',           false),
  (public.current_tenant(), 'central_canais',         false),
  (public.current_tenant(), 'central_recebimento',    false),
  (public.current_tenant(), 'central_foto',           false),
  (public.current_tenant(), 'central_audio',          false),
  (public.current_tenant(), 'central_virar_entidade', false),
  (public.current_tenant(), 'central_busca',          false)
on conflict (tenant_id, chave) do nothing;

-- ============================================================
-- SEÇÃO 7 — Grants (execute a authenticated; revoke public) — padrão do senha_master.sql
-- ============================================================
revoke all on function public.current_tenant()                                        from public;
revoke all on function public.sou_master()                                            from public;
revoke all on function public.pode_ver_topico(uuid)                                    from public;
revoke all on function public.criar_topico_canal(uuid,text,text,text)                  from public;
revoke all on function public.postar_mensagem(uuid,uuid,text,text,jsonb,uuid[],uuid)   from public;
revoke all on function public.marcar_lido(uuid,uuid)                                    from public;
revoke all on function public.toggle_reacao(uuid,text)                                  from public;
revoke all on function public.virar_ocorrencia(uuid,uuid,uuid,text,text,text,text)      from public;

grant execute on function public.current_tenant()                                        to authenticated;
grant execute on function public.sou_master()                                            to authenticated;
grant execute on function public.pode_ver_topico(uuid)                                    to authenticated;
grant execute on function public.criar_topico_canal(uuid,text,text,text)                  to authenticated;
grant execute on function public.postar_mensagem(uuid,uuid,text,text,jsonb,uuid[],uuid)   to authenticated;
grant execute on function public.marcar_lido(uuid,uuid)                                    to authenticated;
grant execute on function public.toggle_reacao(uuid,text)                                  to authenticated;
grant execute on function public.virar_ocorrencia(uuid,uuid,uuid,text,text,text,text)      to authenticated;

-- ============================================================
-- FICA PARA A SPRINT 1 (não entra aqui de propósito — toca módulos existentes ou é UI):
--   - trigger/RPC de recebimento e manutenção (ADD COLUMN topico_id + trigger em
--     central_agendamentos e manutencoes) — mexe em tabela do ERP; fazer com staging + snapshot;
--   - RPC virar_manutencao (precisa da DDL real de manutencoes);
--   - RPCs de leitura/feed (feed_pagina, mensagens_pagina, listar_topicos, buscar);
--   - índice pg_trgm p/ busca aproximada; qualquer tela/nav/botão.
-- ============================================================

-- ============================================================
-- ROLLBACK (desfazer TUDO desta sprint) — descomentar e rodar se precisar reverter.
-- Ordem inversa: policies -> triggers -> funções -> (tira do realtime) -> tabelas.
-- ============================================================
-- do $$ declare t text; begin
--   foreach t in array array['work_items','mensagem_reacoes','leituras','mensagens','eventos','topico'] loop
--     if exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t)
--       then execute format('alter publication supabase_realtime drop table public.%I', t); end if;
--   end loop; end $$;
-- drop function if exists public.virar_ocorrencia(uuid,uuid,uuid,text,text,text,text);
-- drop function if exists public.toggle_reacao(uuid,text);
-- drop function if exists public.marcar_lido(uuid,uuid);
-- drop function if exists public.postar_mensagem(uuid,uuid,text,text,jsonb,uuid[],uuid);
-- drop function if exists public.criar_topico_canal(uuid,text,text,text);
-- drop function if exists public.pode_ver_topico(uuid), public.sou_master();
-- drop table if exists public.feature_flags, public.mensagem_reacoes, public.mensagem_mencoes,
--   public.leituras, public.anexo, public.vinculo, public.work_items, public.mensagens,
--   public.eventos, public.topico cascade;
-- drop function if exists public.tg_mensagens_busca(), public.tg_eventos_busca(),
--   public.tg_topico_outbox(), public.tg_mensagens_outbox(), public.tg_workitems_outbox();
-- drop function if exists public.current_tenant();
