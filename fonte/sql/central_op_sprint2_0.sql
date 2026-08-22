-- ============================================================
-- CENTRAL OPERACIONAL — SPRINT 2.0 (WORK ITEMS: núcleo operacional)
--
-- O work item passa a ser o CENTRO: item no meio, conversa dentro dele, ligado a
-- fornecedor/produto/recebimento/equipamento. Reusa work_items e vinculo (Sprint 0)
-- e preserva 100% do que a Sprint 1.6 já fazia (virar_ocorrencia).
--
-- ADITIVO E IDEMPOTENTE. Roda dentro de UMA transação (atômico: ou aplica tudo, ou
-- nada). Índices são criados SEM CONCURRENTLY de propósito — as tabelas são pequenas,
-- o lock é de milissegundos, e a atomicidade vale mais que evitar o lock.
--
-- MIGRAÇÃO DE VOCABULÁRIO (o ponto delicado): o banco tinha status no feminino
-- ('aberta','resolvida','cancedada'), sem 'bloqueado', prioridade sem 'urgente' e
-- tipo só 'ocorrencia'. Esta migração normaliza os dados existentes e passa a valer
-- UM vocabulário só: aberto/em_andamento/bloqueado/concluido/cancelado.
--
-- COMO USAR: rodar UMA vez no Supabase (SQL Editor). Rodar 2x não faz mal.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1) COLUNA NOVA: prazo_em (a única que faltava de verdade).
--    criado_em/atualizado_em/concluido_em já existem como created_at/updated_at/
--    resolvido_em — REUSADAS (renomear quebraria o código que já lê essas colunas);
--    as RPCs expõem o nome novo só no RETORNO.
-- ------------------------------------------------------------
alter table public.work_items add column if not exists prazo_em timestamptz;

-- ------------------------------------------------------------
-- 2) DESLIGA O OUTBOX durante a normalização.
--    Sem isso, o UPDATE em massa dispara o ramo "status mudou" do trigger e grava um
--    evento FALSO por linha legada — cada um com event_uuid inédito (o md5 inclui o
--    status novo, então o ON CONFLICT não segura). O Feed de todo mundo abriria com
--    N linhas "Ocorrência <titulo> → aberto" de uma mudança que nunca aconteceu,
--    vazando títulos. Fica na MESMA transação: se algo falhar, o trigger volta.
-- ------------------------------------------------------------
alter table public.work_items disable trigger trg_workitems_outbox;

-- ------------------------------------------------------------
-- 3) DROPA OS CHECKs LEGADOS DESCOBRINDO PELO CATÁLOGO.
--    Eles nasceram inline no CREATE TABLE => o nome foi gerado pelo Postgres e pode
--    divergir entre ambientes. Dropar por nome fixo silencia (IF EXISTS) e o erro só
--    apareceria no UPDATE, com 23514, abortando tudo sem explicação.
-- ------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
     where conrelid = 'public.work_items'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ~ '(aberta|resolvida|cancelada|ocorrencia|baixa)'
  loop
    execute format('alter table public.work_items drop constraint %I', r.conname);
  end loop;
end $$;

-- ------------------------------------------------------------
-- 4) NORMALIZA OS DADOS EXISTENTES (idempotente: 2ª execução afeta 0 linhas).
-- ------------------------------------------------------------
update public.work_items
   set status = case status
                  when 'aberta'    then 'aberto'
                  when 'resolvida' then 'concluido'
                  when 'cancelada' then 'cancelado'
                  else status
                end
 where status in ('aberta','resolvida','cancelada');

-- 5) BACKFILL do concluido_em (resolvido_em) nos DOIS sentidos, para o invariante valer.
update public.work_items
   set resolvido_em = coalesce(resolvido_em, updated_at)
 where status = 'concluido' and resolvido_em is null;

update public.work_items
   set resolvido_em = null
 where status <> 'concluido' and resolvido_em is not null;

-- ------------------------------------------------------------
-- 6) CHECKs NOVOS, com NOME EXPLÍCITO (2ª execução vira determinística).
-- ------------------------------------------------------------
-- DROP antes de cada ADD: os CHECKs da 2.0 usam o vocabulário NOVO, então o DO block do
-- passo 3 (que casa pelo vocabulário ANTIGO) não os remove numa 2ª execução. Sem estes
-- drops, rodar o arquivo 2x abortaria com 42710 — contra o que o cabeçalho promete.
alter table public.work_items drop constraint if exists ck_workitems_status;
alter table public.work_items
  add constraint ck_workitems_status
  check (status in ('aberto','em_andamento','bloqueado','concluido','cancelado'));

alter table public.work_items drop constraint if exists ck_workitems_tipo;
alter table public.work_items
  add constraint ck_workitems_tipo
  check (tipo in ('ocorrencia','tarefa'));

alter table public.work_items drop constraint if exists ck_workitems_prioridade;
alter table public.work_items
  add constraint ck_workitems_prioridade
  check (prioridade in ('baixa','normal','alta','urgente'));

-- invariante: concluído <=> tem data de conclusão
alter table public.work_items drop constraint if exists ck_workitems_concluido_em;
alter table public.work_items
  add constraint ck_workitems_concluido_em
  check ((status = 'concluido') = (resolvido_em is not null));

-- DEFAULT novo. Isto sozinho já deixa virar_ocorrencia (1.6) correta: o INSERT dela
-- não lista status, então herda o default. Por isso o corpo dela NÃO é tocado.
alter table public.work_items alter column status set default 'aberto';

-- ------------------------------------------------------------
-- 7) RELIGA O OUTBOX.
-- ------------------------------------------------------------
alter table public.work_items enable trigger trg_workitems_outbox;

-- ------------------------------------------------------------
-- 8) TOUCH de updated_at — criado DEPOIS do UPDATE de propósito.
--    Se existisse antes, a normalização teria reescrito updated_at de todas as linhas
--    legadas para a data da migração, destruindo a ordenação histórica.
--    Com ele, nenhuma RPC precisa setar updated_at na mão (evita caminho esquecido:
--    bastava uma RPC omitir para o keyset ordenar por data de criação em silêncio).
-- ------------------------------------------------------------
create or replace function public.tg_touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_workitems_touch on public.work_items;
create trigger trg_workitems_touch before update on public.work_items
  for each row execute function public.tg_touch_updated_at();

-- ------------------------------------------------------------
-- 9) VINCULO: segunda âncora (work_item), para item criado MANUALMENTE (sem conversa)
--    também poder receber contexto. Hoje topico_id é NOT NULL e a RLS depende dele.
--
--    XOR (uma âncora e SÓ uma), não "pelo menos uma". Com "pelo menos uma" a mesma
--    aresta poderia existir ancorada nos dois lugares — e nenhum dos dois índices
--    únicos a enxergaria (um inclui topico_id, o outro work_item_id) => duplicata
--    invisível; além de permitir vazamento lateral na policy.
-- ------------------------------------------------------------
alter table public.vinculo add column if not exists work_item_id uuid
  references public.work_items(id) on delete cascade;

alter table public.vinculo alter column topico_id drop not null;

alter table public.vinculo drop constraint if exists ck_vinculo_ancora;
alter table public.vinculo add constraint ck_vinculo_ancora
  check ((topico_id is null) <> (work_item_id is null));

-- whitelist como 2ª barreira, independente do código das RPCs.
-- 'fornecedor' FICA DE FORA: não existe entidade canônica (é texto livre vindo do VR).
alter table public.vinculo drop constraint if exists ck_vinculo_entity_type;
alter table public.vinculo add constraint ck_vinculo_entity_type
  check (entity_type in ('topico','work_items','mensagens',
                         'central_agendamentos','estoque_produtos','manutencao_equipamentos'));

-- dedup da âncora work_item (o UNIQUE base inclui topico_id; com NULL o btree trata
-- como distinto e NÃO dedup — por isso o parcial).
create unique index if not exists ux_vinculo_workitem
  on public.vinculo (tenant_id, work_item_id, entity_type, entity_id, papel)
  where work_item_id is not null;

-- índices de FK: sem eles o RI check roda "where work_item_id = $1" SEM tenant e faz
-- seq scan a cada exclusão de work item.
create index if not exists ix_vinculo_work_item on public.vinculo (work_item_id)
  where work_item_id is not null;
create index if not exists ix_vinculo_topico on public.vinculo (topico_id);

-- BACKFILL da âncora de origem: as ocorrências criadas pela 1.6 têm o vínculo só do lado
-- do TÓPICO. Sem esta linha, elas abririam mostrando "nenhum contexto ligado ainda".
insert into public.vinculo(tenant_id, work_item_id, entity_type, entity_id, papel)
select w.tenant_id, w.id, 'topico', w.topico_id::text, 'derivado_de'
  from public.work_items w
 where w.topico_id is not null
   and not exists (select 1 from public.vinculo v
                    where v.work_item_id = w.id and v.entity_type = 'topico'
                      and v.entity_id = w.topico_id::text and v.papel = 'derivado_de')
on conflict do nothing;

-- ------------------------------------------------------------
-- 10) IDEMPOTÊNCIA DAS ESCRITAS: p_request_id persistido.
--     Serve para (a) retry não duplicar e (b) dar o "sal" do event_uuid (ver 12).
-- ------------------------------------------------------------
create table if not exists public.work_item_requests (
  tenant_id    uuid not null default public.current_tenant(),
  request_id   uuid not null,
  work_item_id uuid not null,
  criado_em    timestamptz not null default now(),
  constraint ux_work_item_requests unique (tenant_id, request_id)
);
alter table public.work_item_requests enable row level security;
-- ninguém lê direto do navegador; só as RPCs DEFINER tocam nela (sem policy = sem acesso).

-- ------------------------------------------------------------
-- 11) HELPERS de visibilidade e de destino do vínculo.
-- ------------------------------------------------------------
-- Visibilidade de um work item. DEFINER para não criar recursão de RLS quando
-- chamado de dentro de uma policy.
create or replace function public.pode_ver_work_item(p_id uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_top uuid; v_achou boolean := false; v_resp uuid; v_cri uuid;
begin
  if p_id is null then return false; end if;
  select w.topico_id, w.responsavel_id, w.criado_por, true
    into v_top, v_resp, v_cri, v_achou
   from public.work_items w
   where w.id = p_id and w.tenant_id = public.current_tenant();
  if not v_achou then return false; end if;
  if public.sou_master() then return true; end if;
  if not public.pode_pagina('operacional') then return false; end if;
  -- DONO SEMPRE VÊ: sem isso, uma ocorrência nascida no canal do Açougue e atribuída a
  -- alguém da Padaria sumia para o próprio responsável (lista vazia, sem mensagem) e ele
  -- nem conseguia concluir — item atribuído a quem não pode enxergá-lo.
  if auth.uid() is not null and (v_resp = auth.uid() or v_cri = auth.uid()) then return true; end if;
  -- item sem conversa: basta a página. Item nascido de conversa: obedece a conversa.
  if v_top is null then return true; end if;
  return public.pode_ver_topico(v_top);
end $$;

-- Valida o DESTINO do vínculo com CASE ESTÁTICO: zero EXECUTE, zero SQL dinâmico,
-- nenhum nome de tabela vindo do cliente. Devolve o entity_id NORMALIZADO (a RPC grava
-- o retorno, nunca o parâmetro cru) — senão o índice único não pega duplicata.
create or replace function public.vinculo_destino_ok(p_type text, p_id text)
returns text language plpgsql stable security definer set search_path = public as $$
declare v_id text; v_uuid uuid;
begin
  v_id := btrim(coalesce(p_id, ''));
  if v_id = '' then raise exception 'entidade sem id' using errcode = '22023'; end if;

  if p_type in ('topico','work_items','mensagens') then
    begin
      v_uuid := v_id::uuid;                    -- normaliza formato (aceita {..} e caixa)
    exception when others then
      raise exception 'id de % invalido', p_type using errcode = '22023';
    end;
    v_id := v_uuid::text;
    if p_type = 'topico' then
      if not exists (select 1 from public.topico t where t.id = v_uuid and t.tenant_id = public.current_tenant())
        then raise exception 'topico inexistente' using errcode = '23503'; end if;
    elsif p_type = 'work_items' then
      if not exists (select 1 from public.work_items w where w.id = v_uuid and w.tenant_id = public.current_tenant())
        then raise exception 'work item inexistente' using errcode = '23503'; end if;
    else
      if not exists (select 1 from public.mensagens m where m.id = v_uuid and m.tenant_id = public.current_tenant())
        then raise exception 'mensagem inexistente' using errcode = '23503'; end if;
    end if;
    return v_id;
  end if;

  -- Tabelas do ERP (sem tenant_id, chaves de texto do VR/painel). Comparação por ::text
  -- de propósito: o tipo real varia por tabela e correção vale mais que microdesempenho
  -- num caminho de escrita raro (vincular é ação manual do usuário).
  if p_type = 'central_agendamentos' then
    if not exists (select 1 from public.central_agendamentos a where a.id = v_id)
      then raise exception 'recebimento inexistente' using errcode = '23503'; end if;
    return v_id;
  elsif p_type = 'estoque_produtos' then
    if not exists (select 1 from public.estoque_produtos p where p.cod::text = v_id)
      then raise exception 'produto inexistente' using errcode = '23503'; end if;
    return v_id;
  elsif p_type = 'manutencao_equipamentos' then
    if not exists (select 1 from public.manutencao_equipamentos e where e.id::text = v_id)
      then raise exception 'equipamento inexistente' using errcode = '23503'; end if;
    return v_id;
  end if;

  raise exception 'tipo de entidade nao permitido' using errcode = '22023';
end $$;

-- ------------------------------------------------------------
-- 12) POLICIES recriadas.
--     vinculo_sel usa CASE, NUNCA OR: com OR, uma linha ancorada nos dois lados
--     passaria pelo ramo do work item mesmo quando o ramo do tópico reprovaria por
--     setor (vazamento lateral). Com CASE, toda linha legada continua julgada
--     exatamente pela regra de hoje.
-- ------------------------------------------------------------
drop policy if exists vinculo_sel on public.vinculo;
create policy vinculo_sel on public.vinculo for select to authenticated
  using (
    tenant_id = public.current_tenant()
    and case when work_item_id is null
             then public.pode_ver_topico(topico_id)
             else public.pode_ver_work_item(work_item_id)
        end
  );

-- work_items passa a obedecer a conversa de origem (fecha buraco pré-existente da 1.6:
-- ocorrência nascida de canal restrito aparecia para outros setores).
-- Mesma regra do helper, porém INLINE: a policy enxerga as colunas da própria linha,
-- então não paga um SELECT extra por linha (o helper faria isso a cada tupla da página).
drop policy if exists workitems_sel on public.work_items;
create policy workitems_sel on public.work_items for select to authenticated
  using (
    tenant_id = public.current_tenant()
    and ( public.sou_master()
       or ( public.pode_pagina('operacional')
            and ( topico_id is null
               or responsavel_id = auth.uid()      -- o DONO sempre vê o próprio item
               or criado_por = auth.uid()
               or public.pode_ver_topico(topico_id) ) ) )
  );

-- ------------------------------------------------------------
-- 13) OUTBOX reescrito: tipos work_item.*, sal do request_id, supressão na origem.
--
--   * event_uuid derivado do REQUEST, não da entidade. md5(tenant|tipo|id) engoliria
--     permanentemente a 2ª edição — e o mesmo defeito já existia em 'ocorrencia.status'
--     (entrar 2x no mesmo estado nunca mais aparecia). Com o sal do request, cada ação
--     real gera um evento e o retry da MESMA ação não duplica.
--   * COALESCING por supressão: 'work_item.atualizado' só sai quando muda algo que
--     interessa ao Feed (responsável, prazo, prioridade subindo p/ alta|urgente).
--   * RESUMO SEM TÍTULO quando não há conversa: eventos_sel libera evento com
--     topico_id NULL para qualquer um com a página 'operacional'. Item criado
--     manualmente ("Advertência do João — 3ª falta") vazaria o título inteiro.
--     O cliente hidrata o nome em lote via work_items_por_ids, sob RLS.
-- ------------------------------------------------------------
create or replace function public.tg_workitems_outbox()
returns trigger language plpgsql set search_path = public as $$
declare
  v_req text := coalesce(current_setting('app.request_id', true), gen_random_uuid()::text);
  v_rel boolean;
begin
  if TG_OP = 'INSERT' then
    insert into public.eventos(event_uuid, tenant_id, tipo, topico_id, entity_type, entity_id,
                               autor_id, setor, resumo, payload)
    values (md5(new.tenant_id::text || '|work_item.criado|' || new.id::text || '|' || v_req)::uuid,
            new.tenant_id, 'work_item.criado', new.topico_id, 'work_items', new.id::text,
            new.criado_por, new.setor,
            case when new.topico_id is null
                 then (case when new.tipo = 'tarefa' then 'Nova tarefa' else 'Nova ocorrência' end)
                      || coalesce(' em ' || new.setor, '')
                 else (case when new.tipo = 'tarefa' then 'Tarefa: ' else 'Ocorrência: ' end)
                      || coalesce(new.titulo, '') end,
            jsonb_build_object('item_tipo', new.tipo, 'status', new.status, 'prioridade', new.prioridade))
    on conflict (tenant_id, event_uuid) do nothing;
    return new;
  end if;

  if TG_OP = 'UPDATE' then
    if new.status is distinct from old.status then
      insert into public.eventos(event_uuid, tenant_id, tipo, topico_id, entity_type, entity_id,
                                 autor_id, setor, resumo, payload)
      values (md5(new.tenant_id::text || '|work_item.status_alterado|' || new.id::text || '|'
                  || new.status || '|' || v_req)::uuid,
              new.tenant_id, 'work_item.status_alterado', new.topico_id, 'work_items', new.id::text,
              auth.uid(), new.setor,
              case when new.topico_id is null
                   then (case when new.tipo = 'tarefa' then 'Tarefa' else 'Ocorrência' end) || ' → ' || new.status
                   else coalesce(new.titulo, '') || ' → ' || new.status end,
              jsonb_build_object('item_tipo', new.tipo, 'de', old.status, 'para', new.status))
      on conflict (tenant_id, event_uuid) do nothing;
    end if;

    -- supressão na origem: só o que o Feed deve mostrar
    v_rel := (new.responsavel_id is distinct from old.responsavel_id)
          or (new.prazo_em is distinct from old.prazo_em)
          or (new.prioridade is distinct from old.prioridade
              and new.prioridade in ('alta','urgente'));
    if v_rel then
      insert into public.eventos(event_uuid, tenant_id, tipo, topico_id, entity_type, entity_id,
                                 autor_id, setor, resumo, payload)
      values (md5(new.tenant_id::text || '|work_item.atualizado|' || new.id::text || '|' || v_req)::uuid,
              new.tenant_id, 'work_item.atualizado', new.topico_id, 'work_items', new.id::text,
              auth.uid(), new.setor,
              case when new.topico_id is null
                   then (case when new.tipo = 'tarefa' then 'Tarefa atualizada' else 'Ocorrência atualizada' end)
                   else coalesce(new.titulo, '') || ' — atualizado' end,
              jsonb_build_object('item_tipo', new.tipo, 'prioridade', new.prioridade))
      on conflict (tenant_id, event_uuid) do nothing;
    end if;
  end if;
  return new;
end $$;

-- outbox dos VÍNCULOS (só roteamento; é evento de bastidor, excluído do Feed)
create or replace function public.tg_vinculo_outbox()
returns trigger language plpgsql set search_path = public as $$
declare
  v_req text := coalesce(current_setting('app.request_id', true), gen_random_uuid()::text);
  v_row public.vinculo;
  v_tipo text;
begin
  if TG_OP = 'INSERT' then v_row := new; v_tipo := 'work_item.vinculo_adicionado';
  else v_row := old; v_tipo := 'work_item.vinculo_removido'; end if;
  if v_row.work_item_id is null then return coalesce(new, old); end if;   -- vínculo de conversa: fora do escopo
  insert into public.eventos(event_uuid, tenant_id, tipo, topico_id, entity_type, entity_id, autor_id, payload)
  values (md5(v_row.tenant_id::text || '|' || v_tipo || '|' || v_row.work_item_id::text || '|'
              || v_row.entity_type || '|' || v_row.entity_id || '|' || v_req)::uuid,
          v_row.tenant_id, v_tipo, null, 'work_items', v_row.work_item_id::text, auth.uid(),
          jsonb_build_object('entidade', v_row.entity_type, 'papel', v_row.papel))
  on conflict (tenant_id, event_uuid) do nothing;
  return coalesce(new, old);
end $$;

drop trigger if exists trg_vinculo_outbox on public.vinculo;
create trigger trg_vinculo_outbox after insert or delete on public.vinculo
  for each row execute function public.tg_vinculo_outbox();

-- ------------------------------------------------------------
-- 14) ÍNDICE DO FEED v2 + feed_pagina, na ordem certa.
--     "create index if not exists <mesmo nome> ... where <predicado novo>" é NO-OP
--     SILENCIOSO (o IF NOT EXISTS casa pelo NOME, não pelo predicado) — a migração
--     passaria verde com o índice velho e a degradação só apareceria meses depois.
--     Por isso: NOME NOVO (v2), função depois, e drop do antigo no fim.
-- ------------------------------------------------------------
create index if not exists ix_eventos_feed_visivel_v2
  on public.eventos (tenant_id, id desc)
  where tipo not in ('audio.transcrito','mencao.criada','reacao.alterada',
                     'work_item.vinculo_adicionado','work_item.vinculo_removido');

-- ATENÇÃO: a lista de colunas é IDÊNTICA à da 1.12 (inclusive event_uuid como 2ª).
-- Mudar as colunas de um RETURNS TABLE exigiria DROP antes (42P13) e quebraria o cliente.
create or replace function public.feed_pagina(p_cursor bigint default null, p_limite int default 30)
returns table (id bigint, event_uuid uuid, tipo text, topico_id uuid, entity_type text, entity_id text,
               autor_id uuid, setor text, resumo text, payload jsonb, created_at timestamptz)
language plpgsql stable security invoker set search_path = public as $$
begin
  if not (public.pode_pagina('operacional') or public.sou_master()) then
    raise exception 'sem acesso' using errcode = '42501';
  end if;
  return query
    select e.id, e.event_uuid, e.tipo, e.topico_id, e.entity_type, e.entity_id, e.autor_id, e.setor,
           e.resumo, e.payload, e.created_at
      from public.eventos e
     where e.tenant_id = public.current_tenant()
       -- TEXTUALMENTE idêntico ao predicado do índice v2 (senão o parcial não casa)
       and e.tipo not in ('audio.transcrito','mencao.criada','reacao.alterada',
                          'work_item.vinculo_adicionado','work_item.vinculo_removido')
       and (p_cursor is null or e.id < p_cursor)
     order by e.id desc
     limit greatest(1, least(coalesce(p_limite, 30), 100));
end $$;

-- ------------------------------------------------------------
-- 15) ÍNDICES do keyset. Os antigos terminam em 'status': servem o FILTRO mas não a
--     ORDENAÇÃO, então o planner puxava tudo e fazia Sort completo (o LIMIT 30 não
--     entrava no índice). E sem 'id' no fim, empate de updated_at (transição em lote
--     compartilha o now() da transação) faz a página repetir ou pular itens.
-- ------------------------------------------------------------
create index if not exists ix_workitems_keyset
  on public.work_items (tenant_id, updated_at desc, id desc);
create index if not exists ix_workitems_status_keyset
  on public.work_items (tenant_id, status, updated_at desc, id desc);
create index if not exists ix_workitems_responsavel_keyset
  on public.work_items (tenant_id, responsavel_id, updated_at desc, id desc);
create index if not exists ix_workitems_setor_keyset
  on public.work_items (tenant_id, setor, updated_at desc, id desc);

-- 1 item por (conversa, tipo). O ux antigo garantia só 'ocorrencia'; com 'tarefa'
-- exposto, uma conversa poderia acumular N tarefas duplicadas.
create unique index if not exists ux_workitem_topico_tipo
  on public.work_items (tenant_id, topico_id, tipo) where topico_id is not null;

-- ------------------------------------------------------------
-- 16) RPCs DE ESCRITA (SECURITY DEFINER, idempotentes por p_request_id).
--     DEFINER não recebe predicado de RLS => todo SELECT interno filtra tenant_id
--     EXPLICITAMENTE (senão o índice liderado por tenant_id não é usado).
-- ------------------------------------------------------------

-- helper interno: reivindica o request. Devolve o work_item_id já processado (retry)
-- ou null quando é a primeira vez.
create or replace function public.wi_request_visto(p_request_id uuid, p_work_item_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_tenant uuid := public.current_tenant(); v_id uuid;
begin
  if p_request_id is null then raise exception 'request_id obrigatorio' using errcode = '22023'; end if;
  insert into public.work_item_requests(tenant_id, request_id, work_item_id)
  values (v_tenant, p_request_id, p_work_item_id)
  on conflict (tenant_id, request_id) do nothing;
  if found then return null; end if;                    -- primeira vez
  select work_item_id into v_id from public.work_item_requests
   where tenant_id = v_tenant and request_id = p_request_id;
  return v_id;                                          -- retry: devolve o de antes
end $$;

create or replace function public.criar_work_item(
  p_request_id uuid, p_tipo text, p_titulo text, p_descricao text default null,
  p_prioridade text default 'normal', p_responsavel_id uuid default null,
  p_prazo_em timestamptz default null, p_topico_id uuid default null, p_setor text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_tenant uuid := public.current_tenant(); v_id uuid; v_visto uuid; v_tit text;
begin
  if not (public.pode_pagina('operacional') or public.sou_master()) then
    raise exception 'sem acesso a Central Operacional' using errcode = '42501';
  end if;
  if p_tipo is null or p_tipo not in ('ocorrencia','tarefa') then
    raise exception 'tipo invalido' using errcode = '22023'; end if;
  if coalesce(p_prioridade,'normal') not in ('baixa','normal','alta','urgente') then
    raise exception 'prioridade invalida' using errcode = '22023'; end if;
  v_tit := nullif(btrim(coalesce(p_titulo,'')), '');
  if v_tit is null then raise exception 'titulo obrigatorio' using errcode = '22023'; end if;
  if p_topico_id is not null and not public.pode_ver_topico(p_topico_id) then
    raise exception 'sem acesso a este topico' using errcode = '42501'; end if;
  -- responsável só pode ser perfil que EXISTE (o id nunca é confiado como veio do cliente)
  if p_responsavel_id is not null and not exists (
       select 1 from public.perfis pf where pf.id = p_responsavel_id) then
    raise exception 'responsavel invalido' using errcode = '22023'; end if;

  v_id := gen_random_uuid();
  v_visto := public.wi_request_visto(p_request_id, v_id);
  if v_visto is not null then return v_visto; end if;          -- retry: mesmo id de antes

  perform set_config('app.request_id', p_request_id::text, true);
  insert into public.work_items(id, tenant_id, tipo, titulo, descricao, setor, status, prioridade,
                                topico_id, criado_por, responsavel_id, prazo_em)
  values (v_id, v_tenant, p_tipo, v_tit, p_descricao, p_setor, 'aberto',
          coalesce(p_prioridade,'normal'), p_topico_id, auth.uid(), p_responsavel_id, p_prazo_em);

  if p_topico_id is not null then
    -- (a) âncora no TÓPICO: mantém o padrão da 1.6 (a conversa sabe o que derivou dela)
    insert into public.vinculo(tenant_id, topico_id, entity_type, entity_id, papel)
    values (v_tenant, p_topico_id, 'work_items', v_id::text, 'derivado_de')
    on conflict do nothing;
    -- (b) âncora no WORK ITEM: sem esta, work_item_detalhe (que lê por work_item_id) não
    --     enxergaria a origem e o item nascido de conversa exibiria "nenhum contexto ligado".
    insert into public.vinculo(tenant_id, work_item_id, entity_type, entity_id, papel)
    values (v_tenant, v_id, 'topico', p_topico_id::text, 'derivado_de')
    on conflict do nothing;
  end if;
  return v_id;
end $$;

create or replace function public.atualizar_work_item(
  p_request_id uuid, p_work_item_id uuid, p_titulo text default null, p_descricao text default null,
  p_prioridade text default null, p_responsavel_id uuid default null,
  p_remover_responsavel boolean default false, p_prazo_em timestamptz default null,
  p_remover_prazo boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_tenant uuid := public.current_tenant(); v_visto uuid; v_tit text;
begin
  if not public.pode_ver_work_item(p_work_item_id) then
    raise exception 'sem acesso a este item' using errcode = '42501'; end if;
  if p_prioridade is not null and p_prioridade not in ('baixa','normal','alta','urgente') then
    raise exception 'prioridade invalida' using errcode = '22023'; end if;
  if p_titulo is not null then
    v_tit := nullif(btrim(p_titulo), '');
    if v_tit is null then raise exception 'titulo nao pode ficar vazio' using errcode = '22023'; end if;
  end if;
  if p_responsavel_id is not null and not exists (select 1 from public.perfis pf where pf.id = p_responsavel_id) then
    raise exception 'responsavel invalido' using errcode = '22023'; end if;

  v_visto := public.wi_request_visto(p_request_id, p_work_item_id);
  if v_visto is not null then return v_visto; end if;

  perform set_config('app.request_id', p_request_id::text, true);
  update public.work_items w
     set titulo         = coalesce(v_tit, w.titulo),
         descricao      = coalesce(p_descricao, w.descricao),
         prioridade     = coalesce(p_prioridade, w.prioridade),
         responsavel_id = case when p_remover_responsavel then null
                               else coalesce(p_responsavel_id, w.responsavel_id) end,
         prazo_em       = case when p_remover_prazo then null
                               else coalesce(p_prazo_em, w.prazo_em) end
   where w.id = p_work_item_id and w.tenant_id = v_tenant;
  return p_work_item_id;
end $$;

create or replace function public.transicionar_work_item(
  p_request_id uuid, p_work_item_id uuid, p_novo_status text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_tenant uuid := public.current_tenant(); v_atual text; v_visto uuid; v_ok boolean;
begin
  if not public.pode_ver_work_item(p_work_item_id) then
    raise exception 'sem acesso a este item' using errcode = '42501'; end if;
  if p_novo_status not in ('aberto','em_andamento','bloqueado','concluido','cancelado') then
    raise exception 'status invalido' using errcode = '22023'; end if;

  select w.status into v_atual from public.work_items w
   where w.id = p_work_item_id and w.tenant_id = v_tenant;
  if not found then raise exception 'item inexistente' using errcode = '23503'; end if;
  if v_atual = p_novo_status then return p_work_item_id; end if;   -- no-op idempotente, sem evento

  v_ok := case v_atual
            when 'aberto'       then p_novo_status in ('em_andamento','cancelado')
            when 'em_andamento' then p_novo_status in ('bloqueado','concluido','cancelado')
            when 'bloqueado'    then p_novo_status in ('em_andamento','cancelado')
            when 'concluido'    then p_novo_status in ('em_andamento')
            when 'cancelado'    then p_novo_status in ('aberto')
            else false end;
  if not v_ok then
    raise exception 'transicao de % para % nao permitida', v_atual, p_novo_status using errcode = '22023';
  end if;

  v_visto := public.wi_request_visto(p_request_id, p_work_item_id);
  if v_visto is not null then return v_visto; end if;

  perform set_config('app.request_id', p_request_id::text, true);
  -- UPDATE CONDICIONAL (and w.status = v_atual): entre o SELECT acima e este UPDATE outra
  -- sessão pode ter mudado o estado, e aí a transição validada já não vale. Sem esta
  -- condição, dois cliques simultâneos aplicariam uma transição proibida.
  update public.work_items w
     set status = p_novo_status,
         resolvido_em = case when p_novo_status = 'concluido' then now() else null end
   where w.id = p_work_item_id and w.tenant_id = v_tenant and w.status = v_atual;
  if not found then
    raise exception 'o item mudou de estado, recarregue' using errcode = '40001';
  end if;
  return p_work_item_id;
end $$;

create or replace function public.vincular_work_item(
  p_request_id uuid, p_work_item_id uuid, p_entidade_tipo text, p_entidade_id text,
  p_relacao text default 'relacionado_a')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_tenant uuid := public.current_tenant(); v_visto uuid; v_norm text;
begin
  if not public.pode_ver_work_item(p_work_item_id) then
    raise exception 'sem acesso a este item' using errcode = '42501'; end if;
  if coalesce(p_relacao,'relacionado_a') not in ('relacionado_a','derivado_de','conversa_de') then
    raise exception 'relacao invalida' using errcode = '22023'; end if;
  v_norm := public.vinculo_destino_ok(p_entidade_tipo, p_entidade_id);   -- valida + normaliza

  v_visto := public.wi_request_visto(p_request_id, p_work_item_id);
  if v_visto is not null then return v_visto; end if;

  perform set_config('app.request_id', p_request_id::text, true);
  -- ON CONFLICT DO NOTHING SEM ALVO: cobre o parcial da âncora work_item. Com alvo
  -- explícito o ramo topico_id NULL nunca conflitaria e a idempotência viraria duplicata.
  insert into public.vinculo(tenant_id, work_item_id, entity_type, entity_id, papel)
  values (v_tenant, p_work_item_id, p_entidade_tipo, v_norm, coalesce(p_relacao,'relacionado_a'))
  on conflict do nothing;
  return p_work_item_id;
end $$;

create or replace function public.desvincular_work_item(
  p_request_id uuid, p_work_item_id uuid, p_entidade_tipo text, p_entidade_id text, p_relacao text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_tenant uuid := public.current_tenant(); v_visto uuid; v_norm text;
begin
  if not public.pode_ver_work_item(p_work_item_id) then
    raise exception 'sem acesso a este item' using errcode = '42501'; end if;
  -- preserva a origem da ocorrência (Sprint 1.6): 'derivado_de' não se remove por aqui
  if p_relacao = 'derivado_de' then
    raise exception 'vinculo de origem nao pode ser removido' using errcode = '42501'; end if;
  v_norm := btrim(coalesce(p_entidade_id,''));

  v_visto := public.wi_request_visto(p_request_id, p_work_item_id);
  if v_visto is not null then return v_visto; end if;

  perform set_config('app.request_id', p_request_id::text, true);
  delete from public.vinculo v
   where v.tenant_id = v_tenant and v.work_item_id = p_work_item_id
     and v.entity_type = p_entidade_tipo and v.entity_id = v_norm and v.papel = p_relacao;
  return p_work_item_id;
end $$;

-- ------------------------------------------------------------
-- 17) RPCs DE LEITURA (SECURITY INVOKER, sob RLS).
--     force_custom_plan: sem isso, na 6ª execução da MESMA sessão o plpgsql promove o
--     plano genérico, os filtros opcionais "(p is null or col = p)" deixam de virar
--     index cond e a página vai de 5ms a centenas de ms, intermitente.
-- ------------------------------------------------------------
create or replace function public.nomes_de(p_ids uuid[])
returns table (id uuid, nome text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.pode_pagina('operacional') or public.sou_master()) then
    raise exception 'sem acesso' using errcode = '42501';
  end if;
  return query
    select pf.id, pf.nome from public.perfis pf
     where pf.id = any (coalesce(p_ids[1:100], '{}'::uuid[]));
end $$;

-- p_status_in: filtro por CONJUNTO de status (a aba "Abertos" = aberto+em_andamento+bloqueado).
-- Filtrar isso no cliente era um buraco real: o servidor mandava 30 linhas ordenadas por
-- atualizado_em (e concluir um item o joga para o TOPO), o cliente descartava todas, a tela
-- dizia "Nada por aqui" e o botão "Carregar mais" sumia — trabalho pendente ficava invisível.
drop function if exists public.work_items_pagina(text, uuid, text, text, timestamptz, uuid, int);
drop function if exists public.work_items_pagina(text, text[], uuid, text, text, timestamptz, uuid, int);
create function public.work_items_pagina(
  p_status text default null, p_status_in text[] default null,
  p_responsavel_id uuid default null, p_prioridade text default null,
  p_tipo text default null, p_cursor_at timestamptz default null, p_cursor_id uuid default null,
  p_limite int default 30)
returns table (id uuid, tipo text, titulo text, resumo text, status text, prioridade text,
               responsavel_id uuid, responsavel_nome text, prazo_em timestamptz,
               criado_em timestamptz, atualizado_em timestamptz, concluido_em timestamptz,
               topico_id uuid, vinculos int, atrasado boolean)
language plpgsql stable security invoker
set search_path = public set plan_cache_mode = 'force_custom_plan' as $$
begin
  return query
    select w.id, w.tipo, w.titulo,
           left(coalesce(w.descricao,''), 140) as resumo,
           w.status, w.prioridade, w.responsavel_id,
           (select pf.nome from public.perfis pf where pf.id = w.responsavel_id) as responsavel_nome,
           w.prazo_em, w.created_at, w.updated_at, w.resolvido_em, w.topico_id,
           (select count(*)::int from public.vinculo v where v.work_item_id = w.id) as vinculos,
           (w.prazo_em is not null and w.status not in ('concluido','cancelado') and w.prazo_em < now()) as atrasado
      from public.work_items w
     where (p_status is null or w.status = p_status)
       and (p_status_in is null or w.status = any (p_status_in))
       and (p_responsavel_id is null or w.responsavel_id = p_responsavel_id)
       and (p_prioridade is null or w.prioridade = p_prioridade)
       and (p_tipo is null or w.tipo = p_tipo)
       and (p_cursor_at is null or (w.updated_at, w.id) < (p_cursor_at, p_cursor_id))
     order by w.updated_at desc, w.id desc
     limit greatest(1, least(coalesce(p_limite, 30), 50));
end $$;

drop function if exists public.work_items_por_ids(uuid[]);
create function public.work_items_por_ids(p_ids uuid[])
returns table (id uuid, tipo text, titulo text, resumo text, status text, prioridade text,
               responsavel_id uuid, responsavel_nome text, prazo_em timestamptz,
               criado_em timestamptz, atualizado_em timestamptz, concluido_em timestamptz,
               topico_id uuid, vinculos int, atrasado boolean)
language plpgsql stable security invoker set search_path = public as $$
begin
  if array_length(p_ids, 1) > 100 then
    raise exception 'no maximo 100 ids por chamada' using errcode = '22023'; end if;
  return query
    select w.id, w.tipo, w.titulo, left(coalesce(w.descricao,''), 140), w.status, w.prioridade,
           w.responsavel_id,
           (select pf.nome from public.perfis pf where pf.id = w.responsavel_id),
           w.prazo_em, w.created_at, w.updated_at, w.resolvido_em, w.topico_id,
           (select count(*)::int from public.vinculo v where v.work_item_id = w.id),
           (w.prazo_em is not null and w.status not in ('concluido','cancelado') and w.prazo_em < now())
      from public.work_items w
     where w.id = any (coalesce(p_ids[1:100], '{}'::uuid[]));
end $$;

drop function if exists public.work_item_detalhe(uuid);
create function public.work_item_detalhe(p_work_item_id uuid)
returns table (id uuid, tipo text, titulo text, descricao text, status text, prioridade text,
               setor text, criado_por uuid, criado_por_nome text,
               responsavel_id uuid, responsavel_nome text, prazo_em timestamptz,
               criado_em timestamptz, atualizado_em timestamptz, concluido_em timestamptz,
               topico_id uuid, atrasado boolean, vinculos jsonb)
language plpgsql stable security invoker set search_path = public as $$
begin
  return query
    select w.id, w.tipo, w.titulo, w.descricao, w.status, w.prioridade, w.setor,
           w.criado_por, (select pf.nome from public.perfis pf where pf.id = w.criado_por),
           w.responsavel_id, (select pf.nome from public.perfis pf where pf.id = w.responsavel_id),
           w.prazo_em, w.created_at, w.updated_at, w.resolvido_em, w.topico_id,
           (w.prazo_em is not null and w.status not in ('concluido','cancelado') and w.prazo_em < now()),
           -- devolve (entity_type, entity_id) cru: o cliente resolve o NOME em lote pelas
           -- RPCs que já existem. Resolver aqui exigiria UNION/CASE de 5 tabelas com cast
           -- do lado indexado => seq scan em 47 mil produtos a cada abertura.
           coalesce((select jsonb_agg(jsonb_build_object('tipo', v.entity_type, 'id', v.entity_id,
                                                         'papel', v.papel) order by v.created_at)
                       from public.vinculo v where v.work_item_id = w.id), '[]'::jsonb)
      from public.work_items w
     where w.id = p_work_item_id;
end $$;

-- ATENÇÃO (dois defeitos corrigidos aqui, achados pela revisão adversária):
--  1) `return query` NÃO retorna — só ANEXA linhas e a execução CONTINUA. Com o raise no
--     fim (fora do if), TODA chamada abortava com 22023 e o seletor de contexto ficava
--     morto. Agora o tipo é validado NO TOPO e cada ramo termina com `return;`.
--  2) Sendo DEFINER, a RLS de estoque/manutenções não era avaliada — furava a permissão
--     POR PÁGINA do painel ('estld' e 'manutencoes'). Agora cada ramo exige a sua página.
create or replace function public.entidades_vinculaveis(p_tipo text, p_busca text default null)
returns table (id text, titulo text, subtitulo text)
language plpgsql stable security definer set search_path = public as $$
declare v_q text := btrim(coalesce(p_busca,'')); v_b text;
begin
  if not (public.pode_pagina('operacional') or public.sou_master()) then
    raise exception 'sem acesso' using errcode = '42501'; end if;
  if p_tipo not in ('estoque_produtos','central_agendamentos','manutencao_equipamentos') then
    raise exception 'tipo de entidade nao permitido' using errcode = '22023'; end if;
  -- exige busca real: sem isso o '%%' devolveria um passeio pelo catálogo inteiro
  if length(v_q) < 3 then return; end if;
  v_b := '%' || v_q || '%';

  if p_tipo = 'estoque_produtos' then
    if not (public.sou_master() or public.pode_pagina('estld')) then
      raise exception 'sem acesso ao estoque' using errcode = '42501'; end if;
    return query select p.cod::text, p.nome::text, ('Cód. ' || p.cod)::text
                   from public.estoque_produtos p where p.nome ilike v_b order by p.nome limit 8;
    return;
  elsif p_tipo = 'central_agendamentos' then
    if not (public.sou_master() or public.pode_pagina('central')) then
      raise exception 'sem acesso aos recebimentos' using errcode = '42501'; end if;
    return query select a.id::text, (coalesce(a.fornecedor,'?'))::text,
                        (coalesce(a.data,'') || ' ' || coalesce(a.hi,''))::text
                   from public.central_agendamentos a where a.fornecedor ilike v_b
                  order by a.data desc limit 8;
    return;
  else
    if not (public.sou_master() or public.pode_pagina('manutencoes')) then
      raise exception 'sem acesso as manutencoes' using errcode = '42501'; end if;
    return query select e.id::text, e.nome::text, (coalesce(e.setor,''))::text
                   from public.manutencao_equipamentos e where e.nome ilike v_b order by e.nome limit 8;
    return;
  end if;
end $$;

-- ------------------------------------------------------------
-- 18) GRANTS
-- ------------------------------------------------------------
revoke all on function public.pode_ver_work_item(uuid) from public;
revoke all on function public.vinculo_destino_ok(text, text) from public;
revoke all on function public.wi_request_visto(uuid, uuid) from public;
grant execute on function public.pode_ver_work_item(uuid) to authenticated;

grant execute on function public.criar_work_item(uuid, text, text, text, text, uuid, timestamptz, uuid, text) to authenticated;
grant execute on function public.atualizar_work_item(uuid, uuid, text, text, text, uuid, boolean, timestamptz, boolean) to authenticated;
grant execute on function public.transicionar_work_item(uuid, uuid, text) to authenticated;
grant execute on function public.vincular_work_item(uuid, uuid, text, text, text) to authenticated;
grant execute on function public.desvincular_work_item(uuid, uuid, text, text, text) to authenticated;
grant execute on function public.work_items_pagina(text, text[], uuid, text, text, timestamptz, uuid, int) to authenticated;
grant execute on function public.work_items_por_ids(uuid[]) to authenticated;
grant execute on function public.work_item_detalhe(uuid) to authenticated;
grant execute on function public.entidades_vinculaveis(text, text) to authenticated;
grant execute on function public.nomes_de(uuid[]) to authenticated;

-- ------------------------------------------------------------
-- 19) DROPS dos índices SUPERSEDIDOS — por último, já com os novos no lugar.
-- ------------------------------------------------------------
drop index if exists public.ix_eventos_feed_visivel;      -- substituído pelo v2
drop index if exists public.ix_workitems_responsavel;     -- terminava em status (não ordenava)
drop index if exists public.ix_workitems_setor;           -- idem
drop index if exists public.ux_workitem_ocorrencia_topico;-- substituído por (topico, tipo)

commit;

-- ============================================================
-- CONFERÊNCIA (rodar depois, fora da transação):
--   select indexdef from pg_indexes where indexname like 'ix_eventos_feed_visivel%';
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conrelid in ('public.work_items'::regclass,'public.vinculo'::regclass) and contype='c';
--   select status, count(*) from public.work_items group by 1;
--
-- ROLLBACK (desfazer só a Sprint 2.0) — descomentar se precisar:
-- delete from public.vinculo where work_item_id is not null;
-- drop trigger if exists trg_vinculo_outbox on public.vinculo;
-- drop trigger if exists trg_workitems_touch on public.work_items;
-- alter table public.vinculo drop constraint if exists ck_vinculo_ancora;
-- alter table public.vinculo drop column if exists work_item_id;
-- alter table public.work_items drop column if exists prazo_em;
-- -- e restaurar tg_workitems_outbox/feed_pagina/policies das versões anteriores.
-- ============================================================
