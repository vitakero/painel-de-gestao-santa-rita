-- ============================================================================
-- MÓDULO DE AGENDAMENTO E RECEBIMENTO — CHECKPOINT 1: a base
--
-- O que este arquivo faz:
--   · cria o local de recebimento e a doca (uma linha cada, por enquanto)
--   · cria a AGENDA como período (início + fim), não como janela fixa de 1 hora
--   · cria notas, pedidos, anexos, observações e notificações ligados à agenda
--   · cria a máquina de estados em DOIS EIXOS, com as transições travadas no banco
--   · liga a auditoria ao livro que já existe (receb_eventos)
--   · MIGRA o que já está em entregas_agendamento, sem apagar nada de lá
--
-- O QUE ELE NÃO FAZ, DE PROPÓSITO:
--   · não decide a disputa de horário entre solicitações (item 40 do pedido dele).
--     O comportamento de HOJE — solicitação já segura a janela — fica preservado,
--     mas por uma CHAVE de configuração, não por uma regra cravada. Trocar depois
--     é um update, não uma migração.
--   · não inventa regra de pedido × nota
--   · não cria devoluções (regras indefinidas)
--
-- SEGURANÇA: nada é apagado. entregas_agendamento continua existindo, intacta,
-- e vira o histórico do jeito antigo. As funções do portal passam a ler a tabela
-- nova — como a interface do portal são as funções, ele não percebe a troca.
--
-- Rodar uma vez no SQL Editor. Pode rodar de novo sem estragar nada.
-- ============================================================================

create extension if not exists btree_gist;


-- ============================================================
-- 1) ONDE SE RECEBE
-- ============================================================
create table if not exists public.receb_locais (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null default public.current_tenant(),
  nome          text not null,
  endereco      text,
  abre          time not null default '07:00',
  fecha         time not null default '17:00',
  dias_semana   int[] not null default '{1,2,3,4,5}',   -- 1=segunda ... 7=domingo

  -- Regras que o dono ainda vai definir. Nascem no comportamento SEGURO.
  aceita_sem_nota            boolean not null default false,
  reserva_na_solicitacao     boolean not null default true,   -- é o comportamento de HOJE
  folga_entre_entregas_min   int     not null default 0,

  ativo         boolean not null default true,
  criado_em     timestamptz not null default now()
);
comment on column public.receb_locais.reserva_na_solicitacao is
  'true = pedir horário já segura a janela (comportamento atual). false = só confirmada segura. A decisão final ainda não foi tomada — por isso é chave, não regra cravada.';

insert into public.receb_locais (nome, endereco)
select 'Loja Santa Rita', 'Rua André Sales, 531 — Paulo VI, Caicó/RN'
where not exists (select 1 from public.receb_locais);


-- ============================================================
-- 2) ONDE O CAMINHÃO ENCOSTA
-- ============================================================
create table if not exists public.receb_docas (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null default public.current_tenant(),
  local_id   uuid not null references public.receb_locais(id) on delete cascade,
  nome       text not null,
  ativa      boolean not null default true,
  ordem      int not null default 1,
  criado_em  timestamptz not null default now()
);

insert into public.receb_docas (local_id, nome)
select l.id, 'Área de Recebimento 01'
  from public.receb_locais l
 where not exists (select 1 from public.receb_docas d where d.local_id = l.id);


-- ============================================================
-- 3) A AGENDA
--
-- Nasce como PERÍODO. É a diferença que permite 08:00–08:30 ocupar meia hora
-- e 08:00–10:30 ocupar duas e meia — coisa que a janela fixa de 1h não permitia.
-- ============================================================
create table if not exists public.receb_agendas (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null default public.current_tenant(),
  ticket         text not null,

  tipo           text not null default 'entrega',   -- entrega | coleta | representante
  local_id       uuid not null references public.receb_locais(id),
  doca_id        uuid references public.receb_docas(id),

  fornecedor_id  uuid references public.receb_fornecedores(id),
  -- Transportadora ainda não tem cadastro próprio (decisão pendente). Por ora o
  -- CNPJ fica guardado aqui; quando/se virar cadastro, esta coluna vira ponteiro.
  transportadora_cnpj   text,
  transportadora_nome   text,

  -- ---- os dois eixos ----
  situacao       text not null default 'rascunho',  -- ver receb_transicoes
  sit_doc        text not null default 'sem_nota',
  motivo         text,                              -- da recusa/cancelamento

  -- ---- o que o fornecedor pediu ----
  solicitada_em      timestamptz,
  inicio_solicitado  timestamptz,
  minutos_estimados  int,

  -- ---- o que a loja confirmou ----
  confirmada_em      timestamptz,
  confirmada_por     uuid,
  janela             tstzrange,   -- início + fim confirmados; é o que ocupa a doca

  -- ---- a carga ----
  tipo_carga     text,      -- seca | refrigerada | congelada | hortifruti | bebida | outra
  tipo_volume    text,      -- paletizada | batida | caixaria | granel | outra
  qtd_volumes    int,
  peso_kg        numeric(12,3),
  tipo_veiculo   text,      -- van | toco | truck | carreta | outro
  placa          text,
  motorista      text,
  motorista_fone text,

  -- ---- os tempos reais (item 33 — preencher depois, guardar desde já) ----
  chegada_real       timestamptz,
  descarga_inicio    timestamptz,
  descarga_fim       timestamptz,
  minutos_reais      int generated always as (
                       case when descarga_inicio is not null and descarga_fim is not null
                            then greatest(0, (extract(epoch from (descarga_fim - descarga_inicio))/60)::int)
                       end) stored,

  -- Ocupa doca? Calculado por gatilho a partir da situação + a chave do local.
  -- É ELE que a trava de conflito usa — trocar a regra depois é um update.
  ocupa_doca     boolean not null default false,

  criado_por     uuid,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),

  -- de onde veio, pra não perder o rastro do que foi migrado
  origem         text not null default 'portal',
  origem_id      uuid
);

create unique index if not exists ux_receb_agenda_ticket on public.receb_agendas (tenant_id, ticket);
create index if not exists ix_receb_agenda_forn  on public.receb_agendas (fornecedor_id, inicio_solicitado desc);
create index if not exists ix_receb_agenda_sit   on public.receb_agendas (tenant_id, situacao);
create index if not exists ix_receb_agenda_janela on public.receb_agendas using gist (janela);

-- A TRAVA DE CONFLITO. Duas agendas que ocupam a doca não podem se cruzar no tempo.
-- Vive no banco de propósito: duas confirmações ao mesmo tempo, em máquinas
-- diferentes, é justamente o caso que a checagem na tela não pega.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'receb_agenda_sem_conflito') then
    alter table public.receb_agendas
      add constraint receb_agenda_sem_conflito
      exclude using gist (doca_id with =, janela with &&)
      where (ocupa_doca and doca_id is not null and janela is not null);
  end if;
end $$;


-- ============================================================
-- 4) O TICKET
-- ============================================================
create table if not exists public.receb_ticket_seq (
  ano_mes text primary key,
  ultimo  int not null default 0
);

create or replace function public.receb_novo_ticket()
returns text language plpgsql security definer set search_path = public as $$
declare v_am text; v_n int;
begin
  v_am := to_char(now() at time zone 'America/Fortaleza', 'YYMM');
  insert into public.receb_ticket_seq (ano_mes, ultimo) values (v_am, 1)
    on conflict (ano_mes) do update set ultimo = public.receb_ticket_seq.ultimo + 1
    returning ultimo into v_n;
  return 'AG-' || v_am || '-' || lpad(v_n::text, 4, '0');
end;
$$;


-- ============================================================
-- 5) O QUE PENDURA NA AGENDA
-- ============================================================
create table if not exists public.receb_agenda_notas (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null default public.current_tenant(),
  agenda_id     uuid not null references public.receb_agendas(id) on delete cascade,
  chave         text,                    -- 44 dígitos
  numero        text,
  serie         text,
  emitente_cnpj text,
  emitente_nome text,
  destin_cnpj   text,
  emissao       date,
  valor_total   numeric(14,2),
  arquivo       text,                    -- caminho no cofre; NUNCA uma URL
  situacao      text not null default 'registrada',  -- registrada | lendo | lida | problema
  erro          text,
  itens         jsonb,                   -- o que a norma garante; regra de negócio vem depois
  criado_em     timestamptz not null default now()
);
create index if not exists ix_receb_nota_agenda on public.receb_agenda_notas (agenda_id);
create index if not exists ix_receb_nota_chave  on public.receb_agenda_notas (tenant_id, chave);

create table if not exists public.receb_agenda_pedidos (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null default public.current_tenant(),
  agenda_id  uuid not null references public.receb_agendas(id) on delete cascade,
  pedido_id  uuid,                       -- aponta pra receb_pedidos quando o VR abrir
  numero     text not null,              -- o número digitado, enquanto não há sincronismo
  criado_em  timestamptz not null default now()
);
create index if not exists ix_receb_agped_agenda on public.receb_agenda_pedidos (agenda_id);

create table if not exists public.receb_anexos (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null default public.current_tenant(),
  agenda_id  uuid not null references public.receb_agendas(id) on delete cascade,
  tipo       text not null default 'documento',
  nome       text,                       -- nome que a pessoa reconhece
  arquivo    text not null,              -- caminho no cofre, gerado por nós
  tamanho    int,
  enviado_por uuid,
  criado_em  timestamptz not null default now()
);
create index if not exists ix_receb_anexo_agenda on public.receb_anexos (agenda_id);

create table if not exists public.receb_observacoes (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null default public.current_tenant(),
  agenda_id  uuid not null references public.receb_agendas(id) on delete cascade,
  texto      text not null,
  -- true = só a loja vê. O fornecedor NUNCA recebe estas linhas — nem pela API,
  -- porque a política de leitura abaixo já as exclui. Não é esconder na tela.
  interna    boolean not null default true,
  autor_id   uuid,
  autor_nome text,
  criado_em  timestamptz not null default now()
);
create index if not exists ix_receb_obs_agenda on public.receb_observacoes (agenda_id);


-- ============================================================
-- 6) O SINO DE NOTIFICAÇÕES
-- ============================================================
create table if not exists public.receb_notificacoes (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null default public.current_tenant(),
  fornecedor_id uuid references public.receb_fornecedores(id) on delete cascade,
  agenda_id     uuid references public.receb_agendas(id) on delete cascade,
  tipo          text not null,
  titulo        text not null,
  texto         text,
  lida_em       timestamptz,
  criado_em     timestamptz not null default now()
);
create index if not exists ix_receb_notif_forn
  on public.receb_notificacoes (fornecedor_id, lida_em nulls first, criado_em desc);


-- ============================================================
-- 7) O PEDIDO DE COMPRA — nasce VAZIO, esperando o VR
-- ============================================================
create table if not exists public.receb_pedidos (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null default public.current_tenant(),
  numero         text not null,
  fornecedor_id  uuid references public.receb_fornecedores(id),
  fornecedor_vr  integer,
  local_id       uuid references public.receb_locais(id),
  emissao        date,
  previsao       date,
  situacao       text,
  valor_total    numeric(14,2),
  saldo_valor    numeric(14,2),
  vr_id          text,
  sincronizado_em timestamptz,
  criado_em      timestamptz not null default now()
);
create unique index if not exists ux_receb_pedido_num on public.receb_pedidos (tenant_id, numero);
create index if not exists ix_receb_pedido_forn on public.receb_pedidos (fornecedor_id, previsao);

create table if not exists public.receb_pedido_itens (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null default public.current_tenant(),
  pedido_id     uuid not null references public.receb_pedidos(id) on delete cascade,
  seq           int,
  produto_vr    text,
  descricao     text,
  codigo        text,
  ean           text,
  unidade       text,
  qtd_pedida    numeric(14,3),
  qtd_entregue  numeric(14,3) default 0,
  saldo         numeric(14,3),
  valor_unit    numeric(14,4),
  valor_total   numeric(14,2)
);
create index if not exists ix_receb_pitem_pedido on public.receb_pedido_itens (pedido_id);


-- ============================================================
-- 8) A MÁQUINA DE ESTADOS
--
-- As transições vivem em TABELA, não espalhadas no código. Quem quiser saber
-- "de onde dá pra ir pra onde" consulta uma coisa só.
-- ============================================================
create table if not exists public.receb_transicoes (
  eixo text not null,          -- 'agenda' | 'documento'
  de   text not null,
  para text not null,
  primary key (eixo, de, para)
);

insert into public.receb_transicoes (eixo, de, para) values
  -- eixo AGENDA
  ('agenda','rascunho','solicitada'),
  ('agenda','rascunho','cancelada'),
  ('agenda','solicitada','confirmada'),
  ('agenda','solicitada','recusada'),
  ('agenda','solicitada','cancelada'),
  ('agenda','confirmada','em_recebimento'),
  ('agenda','confirmada','cancelada'),
  ('agenda','confirmada','nao_compareceu'),
  ('agenda','confirmada','confirmada'),          -- reagendamento: muda a data, não o estado
  ('agenda','recusada','solicitada'),
  ('agenda','em_recebimento','concluida'),
  -- eixo DOCUMENTO
  ('documento','sem_nota','lendo'),
  ('documento','sem_nota','validado'),
  ('documento','lendo','validado'),
  ('documento','lendo','problema'),
  ('documento','problema','lendo'),
  ('documento','problema','validado'),
  ('documento','validado','problema'),
  ('documento','validado','lendo')
on conflict do nothing;

create or replace function public.receb_pode_ir(p_eixo text, p_de text, p_para text)
returns boolean language sql stable as $$
  select p_de = p_para and p_eixo = 'documento'
      or exists (select 1 from public.receb_transicoes
                  where eixo = p_eixo and de = p_de and para = p_para);
$$;


-- ============================================================
-- 9) OS GATILHOS — trava de estado, ocupação da doca e auditoria
-- ============================================================
create or replace function public.receb_agenda_antes()
returns trigger language plpgsql set search_path = public as $$
declare v_reserva boolean;
begin
  if tg_op = 'INSERT' then
    if new.ticket is null or new.ticket = '' then
      new.ticket := public.receb_novo_ticket();
    end if;
  else
    -- transição inválida não passa. É aqui que a máquina de estados vira lei.
    if new.situacao <> old.situacao and not public.receb_pode_ir('agenda', old.situacao, new.situacao) then
      raise exception 'Não dá para ir de % para % nesta agenda.', old.situacao, new.situacao
        using errcode = 'check_violation';
    end if;
    if new.sit_doc <> old.sit_doc and not public.receb_pode_ir('documento', old.sit_doc, new.sit_doc) then
      raise exception 'Não dá para ir de % para % na situação do documento.', old.sit_doc, new.sit_doc
        using errcode = 'check_violation';
    end if;
    new.atualizado_em := now();
  end if;

  -- Quem ocupa a doca depende da CHAVE do local, não de regra cravada aqui.
  select coalesce(reserva_na_solicitacao, true) into v_reserva
    from public.receb_locais where id = new.local_id;

  new.ocupa_doca := new.situacao in ('confirmada','em_recebimento')
                 or (coalesce(v_reserva, true) and new.situacao = 'solicitada');

  return new;
end;
$$;

drop trigger if exists tg_receb_agenda_antes on public.receb_agendas;
create trigger tg_receb_agenda_antes
  before insert or update on public.receb_agendas
  for each row execute function public.receb_agenda_antes();


create or replace function public.receb_agenda_depois()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.receb_eventos (entidade, entidade_id, acao, para, quem, detalhe)
    values ('agenda', new.id, 'criou', new.situacao, auth.uid(),
            jsonb_build_object('ticket', new.ticket, 'fornecedor_id', new.fornecedor_id));
    return new;
  end if;

  if new.situacao is distinct from old.situacao then
    insert into public.receb_eventos (entidade, entidade_id, acao, de, para, motivo, quem, detalhe)
    values ('agenda', new.id,
            case new.situacao
              when 'solicitada' then 'solicitou' when 'confirmada' then 'confirmou'
              when 'recusada' then 'recusou'     when 'cancelada' then 'cancelou'
              when 'em_recebimento' then 'iniciou' when 'concluida' then 'concluiu'
              when 'nao_compareceu' then 'faltou' else 'mudou' end,
            old.situacao, new.situacao, new.motivo, auth.uid(),
            jsonb_build_object('ticket', new.ticket));
  end if;

  if new.sit_doc is distinct from old.sit_doc then
    insert into public.receb_eventos (entidade, entidade_id, acao, de, para, quem)
    values ('agenda', new.id, 'documento', old.sit_doc, new.sit_doc, auth.uid());
  end if;

  -- Reagendamento é EVENTO, não estado: a agenda segue confirmada, em outra data.
  if new.janela is distinct from old.janela and old.janela is not null then
    insert into public.receb_eventos (entidade, entidade_id, acao, de, para, motivo, quem, detalhe)
    values ('agenda', new.id, 'reagendou',
            to_char(lower(old.janela) at time zone 'America/Fortaleza', 'DD/MM/YYYY HH24:MI'),
            to_char(lower(new.janela) at time zone 'America/Fortaleza', 'DD/MM/YYYY HH24:MI'),
            new.motivo, auth.uid(),
            jsonb_build_object('janela_antes', old.janela::text, 'janela_depois', new.janela::text));
  end if;

  return new;
end;
$$;

drop trigger if exists tg_receb_agenda_depois on public.receb_agendas;
create trigger tg_receb_agenda_depois
  after insert or update on public.receb_agendas
  for each row execute function public.receb_agenda_depois();


-- ============================================================
-- 10) QUEM VÊ O QUÊ
--
-- Fornecedor só alcança o que é dele — pela função, não por filtro de tela.
-- Escrita: nenhuma. A única porta são as funções (vêm no checkpoint seguinte).
-- ============================================================
alter table public.receb_locais         enable row level security;
alter table public.receb_docas          enable row level security;
alter table public.receb_agendas        enable row level security;
alter table public.receb_agenda_notas   enable row level security;
alter table public.receb_agenda_pedidos enable row level security;
alter table public.receb_anexos         enable row level security;
alter table public.receb_observacoes    enable row level security;
alter table public.receb_notificacoes   enable row level security;
alter table public.receb_pedidos        enable row level security;
alter table public.receb_pedido_itens   enable row level security;
alter table public.receb_transicoes     enable row level security;
alter table public.receb_ticket_seq     enable row level security;

-- local e doca: todo mundo logado lê (é a agenda da loja, não é segredo)
drop policy if exists rl_sel on public.receb_locais;
create policy rl_sel on public.receb_locais for select to authenticated
  using (tenant_id = public.current_tenant());
drop policy if exists rd_sel on public.receb_docas;
create policy rd_sel on public.receb_docas for select to authenticated
  using (tenant_id = public.current_tenant());
drop policy if exists rt_sel on public.receb_transicoes;
create policy rt_sel on public.receb_transicoes for select to authenticated using (true);

-- agenda: a loja vê todas; o fornecedor só as dele
drop policy if exists ra_sel on public.receb_agendas;
create policy ra_sel on public.receb_agendas for select to authenticated
  using (tenant_id = public.current_tenant()
     and (public.pode_pagina('central') or public.pode_pagina('fornecedores')
          or fornecedor_id = public.forn_meu_id()));

-- o que pendura na agenda segue a agenda
drop policy if exists rn_sel on public.receb_agenda_notas;
create policy rn_sel on public.receb_agenda_notas for select to authenticated
  using (exists (select 1 from public.receb_agendas a where a.id = agenda_id));
drop policy if exists rp_sel on public.receb_agenda_pedidos;
create policy rp_sel on public.receb_agenda_pedidos for select to authenticated
  using (exists (select 1 from public.receb_agendas a where a.id = agenda_id));
drop policy if exists rx_sel on public.receb_anexos;
create policy rx_sel on public.receb_anexos for select to authenticated
  using (exists (select 1 from public.receb_agendas a where a.id = agenda_id));

-- OBSERVAÇÃO INTERNA NÃO SAI PRO FORNECEDOR. Nem pela API — a linha nem é devolvida.
drop policy if exists ro_sel on public.receb_observacoes;
create policy ro_sel on public.receb_observacoes for select to authenticated
  using (
    exists (select 1 from public.receb_agendas a where a.id = agenda_id)
    and (not interna or public.pode_pagina('central') or public.pode_pagina('fornecedores'))
  );

-- notificação: cada um vê a sua
drop policy if exists rnt_sel on public.receb_notificacoes;
create policy rnt_sel on public.receb_notificacoes for select to authenticated
  using (tenant_id = public.current_tenant()
     and (fornecedor_id = public.forn_meu_id()
          or public.pode_pagina('central') or public.pode_pagina('fornecedores')));

-- pedido: o fornecedor só os dele
drop policy if exists rpd_sel on public.receb_pedidos;
create policy rpd_sel on public.receb_pedidos for select to authenticated
  using (tenant_id = public.current_tenant()
     and (public.pode_pagina('central') or public.pode_pagina('fornecedores')
          or fornecedor_id = public.forn_meu_id()));
drop policy if exists rpi_sel on public.receb_pedido_itens;
create policy rpi_sel on public.receb_pedido_itens for select to authenticated
  using (exists (select 1 from public.receb_pedidos p where p.id = pedido_id));


-- ============================================================
-- 11) MIGRAÇÃO — o que já existe entra na tabela nova
--
-- entregas_agendamento NÃO é apagada nem alterada. Ela vira o histórico do jeito
-- antigo. Cada linha dela ganha uma agenda equivalente, marcada com a origem.
-- Rodar de novo não duplica (o where not exists cuida).
-- ============================================================
do $$
declare
  v_local uuid; v_doca uuid; r record; v_ini timestamptz;
begin
  select id into v_local from public.receb_locais limit 1;
  select id into v_doca  from public.receb_docas  limit 1;

  for r in
    select e.* from public.entregas_agendamento e
     where not exists (select 1 from public.receb_agendas a
                        where a.origem = 'entregas_agendamento' and a.origem_id = e.id)
     order by e.criado_em
  loop
    v_ini := (r.data + r.hora) at time zone 'America/Fortaleza';

    insert into public.receb_agendas (
      ticket, tipo, local_id, doca_id, fornecedor_id,
      situacao, sit_doc, motivo,
      solicitada_em, inicio_solicitado, minutos_estimados,
      confirmada_em, confirmada_por,
      janela,
      criado_em, origem, origem_id
    ) values (
      public.receb_novo_ticket(), 'entrega', v_local, v_doca, r.fornecedor_id,
      case r.status
        when 'pendente'  then 'solicitada'
        when 'aprovado'  then 'confirmada'
        when 'recusado'  then 'recusada'
        when 'conferido' then 'concluida'
        when 'cancelado' then 'cancelada'
        else 'solicitada' end,
      'sem_nota', null,
      r.criado_em, v_ini, 60,
      case when r.status in ('aprovado','conferido') then r.atualizado_em end,
      r.aprovado_por,
      -- só quem ocupa doca ganha janela; o resto fica sem, e não briga por espaço
      case when r.status in ('pendente','aprovado','conferido')
           then tstzrange(v_ini, v_ini + interval '60 minutes', '[)') end,
      r.criado_em, 'entregas_agendamento', r.id
    );
  end loop;
end $$;


-- ============================================================
-- 12) CONFERÊNCIA — o que esperar depois de rodar
-- ============================================================
select 'tabelas novas (tem que ser 11)' as conferir,
       (select count(*)::text from information_schema.tables
         where table_schema='public' and table_name in
         ('receb_locais','receb_docas','receb_agendas','receb_agenda_notas','receb_agenda_pedidos',
          'receb_anexos','receb_observacoes','receb_notificacoes','receb_pedidos','receb_pedido_itens',
          'receb_transicoes')) as resultado
union all
select 'local e doca criados (1 e 1)',
       (select count(*)::text from public.receb_locais) || ' e ' ||
       (select count(*)::text from public.receb_docas)
union all
select 'trava de conflito instalada',
       case when exists (select 1 from pg_constraint where conname='receb_agenda_sem_conflito')
            then 'SIM' else 'NAO' end
union all
select 'agendamentos migrados',
       (select count(*)::text from public.receb_agendas where origem='entregas_agendamento')
union all
select 'os antigos continuam intactos',
       (select count(*)::text from public.entregas_agendamento)
union all
select 'transicoes carregadas',
       (select count(*)::text from public.receb_transicoes);
