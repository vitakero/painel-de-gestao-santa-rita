-- ============================================================
-- PAINEL SANTA RITA — CONTROLE DE ENTREGAS v2
-- Estrutura definitiva: identidade permanente, homônimos, nome da época,
-- escrita só por RPC no servidor e auditoria por gatilho.
--
-- Rode UMA vez no SQL Editor do Supabase. É seguro rodar de novo (idempotente).
--
-- POR QUE TABELAS NOVAS, e não alterar as antigas:
--   as antigas (entregas_registros / entregas_entregadores) continuam de pé e
--   intactas. Assim o painel publicado hoje não para de funcionar no minuto em
--   que este SQL roda. Elas saem de cena só depois do cliente novo validado.
--
-- COMO DESFAZER (rollback), se precisar:
--   drop function if exists public.entregas_do_mes(int,int);
--   drop function if exists public.entregas_listar_equipe(boolean);
--   drop function if exists public.entregas_remover_dia(uuid,uuid,int,int,int);
--   drop function if exists public.entregas_salvar_dia(uuid,uuid,int,int,int,int);
--   drop function if exists public.entregas_reativar_pessoa(uuid,uuid);
--   drop function if exists public.entregas_inativar_pessoa(uuid,uuid);
--   drop function if exists public.entregas_renomear_pessoa(uuid,uuid,text);
--   drop function if exists public.entregas_criar_pessoa(uuid,text);
--   drop function if exists public.entregas_guarda();
--   drop table if exists public.entregas_intencoes;
--   drop table if exists public.entregas_lancamentos;
--   drop table if exists public.entregas_equipe;
--   (as tabelas antigas nunca foram tocadas por este arquivo)
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1) A EQUIPE — quem entrega
--    Identidade é o id (uuid), NUNCA o nome.
--    NÃO existe unique em nome: dois entregadores podem se chamar igual.
-- ------------------------------------------------------------
create table if not exists public.entregas_equipe (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null default public.current_tenant(),
  nome           text not null,
  ativo          boolean not null default true,
  request_id     uuid,
  criado_em      timestamptz not null default now(),
  criado_por     uuid,
  atualizado_em  timestamptz not null default now(),
  atualizado_por uuid,
  inativado_em   timestamptz,
  constraint entregas_equipe_nome_ck check (btrim(nome) <> '')
);
create index if not exists ix_entregas_equipe_lista
  on public.entregas_equipe (tenant_id, ativo, nome);
create unique index if not exists ux_entregas_equipe_request
  on public.entregas_equipe (request_id) where request_id is not null;

-- ------------------------------------------------------------
-- 2) OS LANÇAMENTOS — uma linha por pessoa/dia
--    nome_snapshot guarda o nome DA ÉPOCA: renomear o cadastro não reescreve
--    o que já foi lançado.
-- ------------------------------------------------------------
create table if not exists public.entregas_lancamentos (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null default public.current_tenant(),
  entregador_id  uuid not null references public.entregas_equipe(id),
  ano            integer not null,
  mes            integer not null,
  dia            integer not null,
  quantidade     integer not null,
  nome_snapshot  text not null,
  request_id     uuid,
  criado_em      timestamptz not null default now(),
  criado_por     uuid,
  atualizado_em  timestamptz not null default now(),
  atualizado_por uuid,
  constraint entregas_lanc_qtd_ck check (quantidade >= 0),
  constraint entregas_lanc_ano_ck check (ano between 2000 and 2200),
  constraint entregas_lanc_mes_ck check (mes between 1 and 12),
  constraint entregas_lanc_dia_ck check (dia between 1 and 31)
);
-- uma célula por pessoa/dia
create unique index if not exists ux_entregas_lanc_celula
  on public.entregas_lancamentos (tenant_id, entregador_id, ano, mes, dia);
create unique index if not exists ux_entregas_lanc_request
  on public.entregas_lancamentos (request_id) where request_id is not null;
create index if not exists ix_entregas_lanc_comp
  on public.entregas_lancamentos (tenant_id, ano, mes);

-- ------------------------------------------------------------
-- 3) LIVRO DE INTENÇÕES — é o que torna o retry seguro.
--    A mesma intenção (request_id) só é aplicada UMA vez, por mais vezes que o
--    navegador reenvie. Sem isso, internet ruim vira lançamento duplicado.
-- ------------------------------------------------------------
create table if not exists public.entregas_intencoes (
  request_id   uuid primary key,
  tenant_id    uuid not null default public.current_tenant(),
  acao         text not null,
  autor_id     uuid,
  aplicada_em  timestamptz not null default now()
);
create index if not exists ix_entregas_intencoes_data
  on public.entregas_intencoes (tenant_id, aplicada_em desc);

-- ------------------------------------------------------------
-- 4) TRANCA — ninguém escreve direto nessas tabelas.
--    Leitura sob RLS pela permissão de página; escrita só pelas funções abaixo.
-- ------------------------------------------------------------
alter table public.entregas_equipe       enable row level security;
alter table public.entregas_lancamentos  enable row level security;
alter table public.entregas_intencoes    enable row level security;

revoke all on table public.entregas_equipe, public.entregas_lancamentos,
                    public.entregas_intencoes from anon, authenticated;
grant select on table public.entregas_equipe, public.entregas_lancamentos to authenticated;

drop policy if exists entregas_equipe_sel on public.entregas_equipe;
create policy entregas_equipe_sel on public.entregas_equipe for select to authenticated
  using (tenant_id = public.current_tenant() and public.pode_pagina('entregas'));

drop policy if exists entregas_lanc_sel on public.entregas_lancamentos;
create policy entregas_lanc_sel on public.entregas_lancamentos for select to authenticated
  using (tenant_id = public.current_tenant() and public.pode_pagina('entregas'));

-- entregas_intencoes não tem policy nenhuma: é de uso interno do servidor.

-- ------------------------------------------------------------
-- 5) AUDITORIA POR GATILHO
--    O projeto já usa "todo evento nasce de gatilho" (central_op_sprint0).
--    Gatilho é mais forte que RPC: não tem como escrever sem ser auditado.
-- ------------------------------------------------------------
create or replace function public.tg_entregas_equipe_evento()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_tipo text; v_resumo text;
begin
  if tg_op = 'INSERT' then
    v_tipo := 'entregador.criado'; v_resumo := 'Entregador cadastrado: ' || new.nome;
  elsif old.nome is distinct from new.nome then
    v_tipo := 'entregador.renomeado'; v_resumo := 'Entregador renomeado: ' || old.nome || ' -> ' || new.nome;
  elsif old.ativo and not new.ativo then
    v_tipo := 'entregador.inativado'; v_resumo := 'Entregador inativado: ' || new.nome;
  elsif not old.ativo and new.ativo then
    v_tipo := 'entregador.reativado'; v_resumo := 'Entregador reativado: ' || new.nome;
  else
    return new;                                  -- mudança irrelevante, não polui o livro
  end if;
  insert into public.eventos (event_uuid, tenant_id, tipo, entity_type, entity_id,
                              autor_id, setor, resumo, payload)
  values (gen_random_uuid(), new.tenant_id, v_tipo, 'entregas_equipe', new.id::text,
          coalesce(new.atualizado_por, new.criado_por), 'Entregas', v_resumo,
          jsonb_build_object('entregador_id', new.id,
                             'nome_anterior', case when tg_op='UPDATE' then old.nome else null end,
                             'nome_novo', new.nome,
                             'ativo', new.ativo,
                             'request_id', new.request_id));
  return new;
end $$;
drop trigger if exists trg_entregas_equipe_evento on public.entregas_equipe;
create trigger trg_entregas_equipe_evento
  after insert or update on public.entregas_equipe
  for each row execute function public.tg_entregas_equipe_evento();

create or replace function public.tg_entregas_lanc_evento()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_tipo text; v_ant integer; v_nov integer; r record;
begin
  if tg_op = 'INSERT' then
    v_tipo := 'entrega.criada';   v_ant := null;           v_nov := new.quantidade; r := new;
  elsif tg_op = 'UPDATE' then
    if old.quantidade = new.quantidade then return new; end if;
    v_tipo := 'entrega.alterada'; v_ant := old.quantidade; v_nov := new.quantidade; r := new;
  else
    v_tipo := 'entrega.removida'; v_ant := old.quantidade; v_nov := null;           r := old;
  end if;
  insert into public.eventos (event_uuid, tenant_id, tipo, entity_type, entity_id,
                              autor_id, setor, resumo, payload)
  values (gen_random_uuid(), r.tenant_id, v_tipo, 'entregas_lancamentos', r.id::text,
          coalesce(r.atualizado_por, r.criado_por), 'Entregas',
          r.nome_snapshot || ' — dia ' || r.dia || '/' || r.mes || '/' || r.ano ||
          ': ' || coalesce(v_ant::text,'(vazio)') || ' -> ' || coalesce(v_nov::text,'(vazio)'),
          jsonb_build_object('entregador_id', r.entregador_id,
                             'competencia', r.ano || '-' || lpad(r.mes::text,2,'0'),
                             'dia', r.dia,
                             'valor_anterior', v_ant,
                             'valor_novo', v_nov,
                             'nome_snapshot', r.nome_snapshot,
                             'request_id', r.request_id));
  return coalesce(new, old);
end $$;
drop trigger if exists trg_entregas_lanc_evento on public.entregas_lancamentos;
create trigger trg_entregas_lanc_evento
  after insert or update or delete on public.entregas_lancamentos
  for each row execute function public.tg_entregas_lanc_evento();

-- ------------------------------------------------------------
-- 6) PORTEIRO — toda escrita passa por aqui antes de qualquer coisa.
--    Levanta erro se não houver sessão ou permissão. Nunca confia no cliente.
-- ------------------------------------------------------------
create or replace function public.entregas_guarda()
returns uuid language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Entre no painel para lançar entregas.' using errcode = '28000';
  end if;
  if not public.pode_pagina('entregas') then
    raise exception 'Seu acesso não inclui a página de Entregas.' using errcode = '42501';
  end if;
  return public.current_tenant();
end $$;

-- Marca a intenção. Devolve TRUE quando é a primeira vez (deve aplicar),
-- FALSE quando esse request_id já foi aplicado antes (retry: não repete).
create or replace function public.entregas_marcar_intencao(p_request_id uuid, p_acao text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if p_request_id is null then
    raise exception 'Toda alteração precisa de um identificador de intenção.' using errcode = '22004';
  end if;
  insert into public.entregas_intencoes (request_id, acao, autor_id)
  values (p_request_id, p_acao, auth.uid())
  on conflict (request_id) do nothing;
  return found;
end $$;

-- ------------------------------------------------------------
-- 7) ESCRITA — as seis funções. Só elas gravam.
-- ------------------------------------------------------------

create or replace function public.entregas_criar_pessoa(p_request_id uuid, p_nome text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_tenant uuid; v_id uuid; v_nome text;
begin
  v_tenant := public.entregas_guarda();
  v_nome := btrim(coalesce(p_nome,''));
  if v_nome = '' then raise exception 'Digite o nome do entregador.' using errcode = '22004'; end if;
  if length(v_nome) > 80 then raise exception 'Nome longo demais.' using errcode = '22001'; end if;

  select id into v_id from public.entregas_equipe where request_id = p_request_id;
  if found then return v_id; end if;                      -- retry: devolve o mesmo
  perform public.entregas_marcar_intencao(p_request_id, 'criar_pessoa');

  insert into public.entregas_equipe (tenant_id, nome, request_id, criado_por, atualizado_por)
  values (v_tenant, v_nome, p_request_id, auth.uid(), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.entregas_renomear_pessoa(p_request_id uuid, p_id uuid, p_nome text)
returns void language plpgsql security definer set search_path = public as $$
declare v_tenant uuid; v_nome text;
begin
  v_tenant := public.entregas_guarda();
  v_nome := btrim(coalesce(p_nome,''));
  if v_nome = '' then raise exception 'Digite o novo nome.' using errcode = '22004'; end if;
  if not public.entregas_marcar_intencao(p_request_id, 'renomear_pessoa') then return; end if;

  -- Só o nome atual muda. Os lançamentos NÃO são tocados: nome_snapshot preserva
  -- como a pessoa se chamava em cada mês.
  update public.entregas_equipe
     set nome = v_nome, atualizado_em = now(), atualizado_por = auth.uid()
   where id = p_id and tenant_id = v_tenant;
  if not found then raise exception 'Entregador não encontrado.' using errcode = 'P0002'; end if;
end $$;

create or replace function public.entregas_inativar_pessoa(p_request_id uuid, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_tenant uuid;
begin
  v_tenant := public.entregas_guarda();
  if not public.entregas_marcar_intencao(p_request_id, 'inativar_pessoa') then return; end if;
  update public.entregas_equipe
     set ativo = false, inativado_em = now(), atualizado_em = now(), atualizado_por = auth.uid()
   where id = p_id and tenant_id = v_tenant and ativo;
  if not found then return; end if;                        -- já estava inativo: tudo bem
end $$;

create or replace function public.entregas_reativar_pessoa(p_request_id uuid, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_tenant uuid;
begin
  v_tenant := public.entregas_guarda();
  if not public.entregas_marcar_intencao(p_request_id, 'reativar_pessoa') then return; end if;
  -- MESMO id, mesma pessoa: o histórico dela volta junto.
  update public.entregas_equipe
     set ativo = true, inativado_em = null, atualizado_em = now(), atualizado_por = auth.uid()
   where id = p_id and tenant_id = v_tenant and not ativo;
end $$;

create or replace function public.entregas_salvar_dia(
  p_request_id uuid, p_entregador_id uuid,
  p_ano integer, p_mes integer, p_dia integer, p_quantidade integer)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_tenant uuid; v_nome text; v_ativo boolean; v_id uuid;
begin
  v_tenant := public.entregas_guarda();

  if p_quantidade is null or p_quantidade < 0 then
    raise exception 'Entrega não pode ser número negativo.' using errcode = '22003';
  end if;
  if p_mes not between 1 and 12 or p_dia not between 1 and 31
     or p_ano not between 2000 and 2200 then
    raise exception 'Data inválida.' using errcode = '22007';
  end if;
  -- 31 de fevereiro e afins: o Postgres recusa a data e a mensagem sai clara
  perform make_date(p_ano, p_mes, p_dia);

  select nome, ativo into v_nome, v_ativo
    from public.entregas_equipe where id = p_entregador_id and tenant_id = v_tenant;
  if not found then raise exception 'Entregador não encontrado.' using errcode = 'P0002'; end if;

  select id into v_id from public.entregas_lancamentos
   where tenant_id = v_tenant and entregador_id = p_entregador_id
     and ano = p_ano and mes = p_mes and dia = p_dia;

  -- Só recusa entregador inativo em lançamento NOVO. Corrigir um mês antigo de quem
  -- já saiu continua permitido — senão erro de digitação vira erro eterno.
  if v_id is null and not v_ativo then
    raise exception 'Este entregador está inativo. Reative antes de lançar.' using errcode = '23514';
  end if;

  if not public.entregas_marcar_intencao(p_request_id, 'salvar_dia') then
    return v_id;                                            -- retry: já foi aplicado
  end if;

  if v_id is null then
    -- nome_snapshot é gravado UMA vez, na criação: é o nome da época.
    insert into public.entregas_lancamentos
      (tenant_id, entregador_id, ano, mes, dia, quantidade, nome_snapshot,
       request_id, criado_por, atualizado_por)
    values (v_tenant, p_entregador_id, p_ano, p_mes, p_dia, p_quantidade, v_nome,
            p_request_id, auth.uid(), auth.uid())
    returning id into v_id;
  else
    update public.entregas_lancamentos
       set quantidade = p_quantidade, request_id = p_request_id,
           atualizado_em = now(), atualizado_por = auth.uid()
     where id = v_id;
  end if;
  return v_id;
end $$;

create or replace function public.entregas_remover_dia(
  p_request_id uuid, p_entregador_id uuid, p_ano integer, p_mes integer, p_dia integer)
returns void language plpgsql security definer set search_path = public as $$
declare v_tenant uuid;
begin
  v_tenant := public.entregas_guarda();
  if not public.entregas_marcar_intencao(p_request_id, 'remover_dia') then return; end if;
  -- Apagar a célula é DIFERENTE de lançar zero. Zero é "abriu e não teve entrega";
  -- apagado é "ainda não foi apurado". Por isso são funções separadas.
  delete from public.entregas_lancamentos
   where tenant_id = v_tenant and entregador_id = p_entregador_id
     and ano = p_ano and mes = p_mes and dia = p_dia;
end $$;

-- ------------------------------------------------------------
-- 8) LEITURA
-- ------------------------------------------------------------

create or replace function public.entregas_listar_equipe(p_incluir_inativos boolean default false)
returns table (id uuid, nome text, ativo boolean, criado_em timestamptz, inativado_em timestamptz)
language sql stable security invoker set search_path = public as $$
  select e.id, e.nome, e.ativo, e.criado_em, e.inativado_em
    from public.entregas_equipe e
   where e.tenant_id = public.current_tenant()
     and (p_incluir_inativos or e.ativo)
   order by e.ativo desc, e.nome;
$$;

-- Mês fechado no passado tem que continuar mostrando QUEM TRABALHOU nele, mesmo
-- que a pessoa esteja inativa hoje. Por isso a leitura do mês sai dos lançamentos,
-- não da lista de ativos.
create or replace function public.entregas_do_mes(p_ano integer, p_mes integer)
returns table (entregador_id uuid, nome_atual text, nome_snapshot text, ativo boolean,
               dia integer, quantidade integer, atualizado_em timestamptz)
language sql stable security invoker set search_path = public as $$
  select l.entregador_id, e.nome, l.nome_snapshot, e.ativo,
         l.dia, l.quantidade, l.atualizado_em
    from public.entregas_lancamentos l
    join public.entregas_equipe e on e.id = l.entregador_id
   where l.tenant_id = public.current_tenant()
     and l.ano = p_ano and l.mes = p_mes
   order by e.nome, l.dia;
$$;

-- ------------------------------------------------------------
-- 9) QUEM PODE CHAMAR O QUÊ
-- ------------------------------------------------------------
revoke all on function public.entregas_guarda()                              from public, anon;
revoke all on function public.entregas_marcar_intencao(uuid,text)            from public, anon, authenticated;
revoke all on function public.entregas_criar_pessoa(uuid,text)               from public, anon;
revoke all on function public.entregas_renomear_pessoa(uuid,uuid,text)       from public, anon;
revoke all on function public.entregas_inativar_pessoa(uuid,uuid)            from public, anon;
revoke all on function public.entregas_reativar_pessoa(uuid,uuid)            from public, anon;
revoke all on function public.entregas_salvar_dia(uuid,uuid,int,int,int,int) from public, anon;
revoke all on function public.entregas_remover_dia(uuid,uuid,int,int,int)    from public, anon;
revoke all on function public.entregas_listar_equipe(boolean)                from public, anon;
revoke all on function public.entregas_do_mes(int,int)                       from public, anon;

grant execute on function public.entregas_criar_pessoa(uuid,text)               to authenticated;
grant execute on function public.entregas_renomear_pessoa(uuid,uuid,text)       to authenticated;
grant execute on function public.entregas_inativar_pessoa(uuid,uuid)            to authenticated;
grant execute on function public.entregas_reativar_pessoa(uuid,uuid)            to authenticated;
grant execute on function public.entregas_salvar_dia(uuid,uuid,int,int,int,int) to authenticated;
grant execute on function public.entregas_remover_dia(uuid,uuid,int,int,int)    to authenticated;
grant execute on function public.entregas_listar_equipe(boolean)                to authenticated;
grant execute on function public.entregas_do_mes(int,int)                       to authenticated;

commit;

-- ============================================================
-- CONFERÊNCIA — deve aparecer tudo OK
-- ============================================================
select 'tabelas novas criadas' as o_que,
       (select count(*)::text from information_schema.tables
         where table_schema='public'
           and table_name in ('entregas_equipe','entregas_lancamentos','entregas_intencoes')) || ' de 3' as valor
union all
select 'funções criadas',
       (select count(*)::text from information_schema.routines
         where routine_schema='public' and routine_name like 'entregas!_%' escape '!') || ' (esperado 10)'
union all
select 'gatilhos de auditoria',
       (select count(*)::text from information_schema.triggers
         where trigger_schema='public' and trigger_name in
               ('trg_entregas_equipe_evento','trg_entregas_lanc_evento')) || ' de 2'
union all
select 'escrita direta bloqueada (authenticated)',
       case when (select count(*) from information_schema.role_table_grants
                   where table_schema='public'
                     and table_name in ('entregas_equipe','entregas_lancamentos')
                     and grantee='authenticated'
                     and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')) = 0
            then 'SIM' else 'NAO — confira' end
union all
select 'leitura liberada (authenticated)',
       case when (select count(*) from information_schema.role_table_grants
                   where table_schema='public'
                     and table_name in ('entregas_equipe','entregas_lancamentos')
                     and grantee='authenticated' and privilege_type='SELECT') = 2
            then 'SIM' else 'NAO — confira' end
union all
select 'tabelas antigas intactas',
       (select count(*)::text from information_schema.tables
         where table_schema='public'
           and table_name in ('entregas_registros','entregas_entregadores')) || ' de 2 (ainda de pé)';
