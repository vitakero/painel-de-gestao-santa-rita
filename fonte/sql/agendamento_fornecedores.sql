-- ============================================================================
-- PORTAL DO FORNECEDOR — PARTE 1: o cadastro
--
-- Decisão do dono em 14/08/2026: o agendamento vira um SITE PRÓPRIO
-- (agendamento.supermercadosantarita.com.br), separado do painel, mas usando
-- ESTE MESMO banco — assim o que o fornecedor faz lá aparece aqui na hora.
--
-- E o fornecedor entra com LOGIN E SENHA, com cadastro da empresa, aprovado
-- pela loja. Não é link aberto.
--
-- Duas ideias que sustentam tudo:
--
--   1) O CNPJ é a identidade. Hoje "Marilan", "MARILAN IND LTDA" e "marilan"
--      são três fornecedores diferentes em três telas diferentes. Com CNPJ
--      passam a ser um só, e aí começa a existir histórico por fornecedor.
--
--   2) Quem barra estranho é a APROVAÇÃO DA LOJA, não a senha. Se qualquer um
--      pode se cadastrar, a senha só dá a ele uma chave da porta. Por isso
--      cadastro nasce "aguardando" e não enxerga nada até alguém liberar.
--
-- ORDEM DE EXECUÇÃO: este arquivo roda DEPOIS da tranca das tabelas soltas.
-- Motivo: no instante em que existir a primeira conta de fornecedor, ela vira
-- "alguém logado" — e tabela que aceita qualquer logado se abre pra ela.
--
-- Rodar uma vez no SQL Editor do Supabase. Pode rodar de novo sem estragar
-- nada (tudo é "if not exists" / "create or replace").
-- ============================================================================


-- ============================================================
-- 1) A EMPRESA
-- ============================================================
create table if not exists public.receb_fornecedores (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null default public.current_tenant(),

  cnpj           text not null,          -- só dígitos, sem ponto nem barra
  razao_social   text not null,
  nome_curto     text,                   -- como a loja chama ("Marilan")
  email          text not null,          -- para onde vão os avisos
  telefone       text,
  responsavel    text,                   -- quem cuida do agendamento

  situacao       text not null default 'aguardando',
    -- aguardando : pediu acesso, ninguém olhou ainda
    -- liberado   : é fornecedor de verdade, pode usar
    -- recusado   : não é fornecedor nosso
    -- bloqueado  : era, e foi suspenso
  motivo         text,                   -- por que recusou/bloqueou
  liberado_por   uuid,                   -- perfis.id de quem decidiu
  liberado_em    timestamptz,

  vr_id          integer,                -- id_fornecedor no VR, quando descobrirmos

  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

comment on table public.receb_fornecedores is
  'Cadastro mestre de fornecedor. O CNPJ é a identidade — é ele que junta o mesmo fornecedor escrito de jeitos diferentes em telas diferentes.';

-- Um CNPJ, um cadastro. É esta linha que impede o mesmo fornecedor entrar duas vezes.
create unique index if not exists ux_receb_forn_cnpj
  on public.receb_fornecedores (tenant_id, cnpj);

create index if not exists ix_receb_forn_situacao
  on public.receb_fornecedores (tenant_id, situacao);


-- ============================================================
-- 2) A PESSOA QUE ENTRA
--
-- Separado da empresa de propósito: uma empresa pode ter mais de uma pessoa
-- agendando (o do faturamento e o da expedição), e cada uma tem seu login.
-- Cada pessoa nova também passa pela aprovação — senão bastaria alguém saber
-- o CNPJ de um fornecedor já liberado pra entrar junto.
-- ============================================================
create table if not exists public.receb_fornecedor_contas (
  user_id        uuid primary key,       -- = auth.users.id (quem fez login)
  tenant_id      uuid not null default public.current_tenant(),
  fornecedor_id  uuid not null references public.receb_fornecedores(id) on delete cascade,

  nome           text,
  email          text not null,

  situacao       text not null default 'aguardando',
    -- aguardando | liberada | recusada
  motivo         text,
  liberado_por   uuid,
  liberado_em    timestamptz,

  criado_em      timestamptz not null default now(),
  ultimo_acesso  timestamptz
);

comment on table public.receb_fornecedor_contas is
  'Quem faz login por um fornecedor. Uma empresa pode ter várias pessoas; cada uma é aprovada em separado.';

create index if not exists ix_receb_conta_forn
  on public.receb_fornecedor_contas (fornecedor_id);


-- ============================================================
-- 3) O HISTÓRICO
--
-- Nada que importa é sobrescrito. Liberar, recusar, bloquear: cada uma vira
-- uma linha nova, com quem fez e quando. Depois isso responde perguntas do
-- tipo "quem liberou esse fornecedor?" meses adiante.
-- ============================================================
create table if not exists public.receb_eventos (
  id          bigserial primary key,
  tenant_id   uuid not null default public.current_tenant(),
  entidade    text not null,             -- 'fornecedor' | 'conta' | (depois: 'entrega')
  entidade_id uuid not null,
  acao        text not null,             -- 'cadastrou' | 'liberou' | 'recusou' | 'bloqueou'
  de          text,                      -- situação anterior
  para        text,                      -- situação nova
  motivo      text,
  quem        uuid,                      -- perfis.id, ou null quando foi o próprio fornecedor
  quando      timestamptz not null default now(),
  detalhe     jsonb
);

comment on table public.receb_eventos is
  'Livro de registro do módulo de recebimento. Só entra linha — nunca se altera nem se apaga.';

create index if not exists ix_receb_ev_entidade
  on public.receb_eventos (tenant_id, entidade, entidade_id, quando desc);


-- ============================================================
-- 4) QUEM É QUEM
--
-- A pergunta que o banco precisa saber responder a partir de agora:
-- essa pessoa logada é da loja ou é fornecedor?
-- ============================================================

-- É fornecedor? (vale mesmo com o cadastro ainda aguardando — é justamente
-- quem ainda não foi liberado que não pode escapar pra dentro do painel)
create or replace function public.eh_fornecedor()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.receb_fornecedor_contas c where c.user_id = auth.uid()
  );
$$;

-- É da casa? Tem perfil no painel E não é fornecedor.
-- É esta função que vai trancar as tabelas internas.
create or replace function public.eh_da_casa()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perfis p where p.id = auth.uid())
     and not exists (select 1 from public.receb_fornecedor_contas c where c.user_id = auth.uid());
$$;

-- De qual fornecedor é a pessoa logada? Devolve nulo se ela (ou a empresa)
-- ainda não foi liberada — é o que faz "aguardando" não enxergar nada.
create or replace function public.forn_meu_id()
returns uuid language sql stable security definer set search_path = public as $$
  select c.fornecedor_id
    from public.receb_fornecedor_contas c
    join public.receb_fornecedores f on f.id = c.fornecedor_id
   where c.user_id = auth.uid()
     and c.situacao = 'liberada'
     and f.situacao = 'liberado';
$$;

revoke all on function public.eh_fornecedor()  from public;
revoke all on function public.eh_da_casa()     from public;
revoke all on function public.forn_meu_id()    from public;
grant execute on function public.eh_fornecedor() to authenticated;
grant execute on function public.eh_da_casa()    to authenticated;
grant execute on function public.forn_meu_id()   to authenticated;


-- ============================================================
-- 5) QUEM VÊ O QUÊ
--
-- Fornecedor vê só o cadastro DELE. Quem é da casa vê todos, desde que tenha
-- a página. Escrever, ninguém escreve direto: só pelas funções abaixo.
-- ============================================================
alter table public.receb_fornecedores       enable row level security;
alter table public.receb_fornecedor_contas  enable row level security;
alter table public.receb_eventos            enable row level security;

drop policy if exists rf_sel on public.receb_fornecedores;
create policy rf_sel on public.receb_fornecedores
  for select to authenticated
  using (
    tenant_id = public.current_tenant()
    and (
      public.pode_pagina('fornecedores')
      or id = public.forn_meu_id()
      -- o recém-cadastrado precisa enxergar o próprio cadastro pra ver que
      -- está aguardando; por isso a linha abaixo, que não depende de liberação
      or exists (
        select 1 from public.receb_fornecedor_contas c
         where c.user_id = auth.uid() and c.fornecedor_id = receb_fornecedores.id
      )
    )
  );

drop policy if exists rfc_sel on public.receb_fornecedor_contas;
create policy rfc_sel on public.receb_fornecedor_contas
  for select to authenticated
  using (
    tenant_id = public.current_tenant()
    and (public.pode_pagina('fornecedores') or user_id = auth.uid())
  );

drop policy if exists rev_sel on public.receb_eventos;
create policy rev_sel on public.receb_eventos
  for select to authenticated
  using (tenant_id = public.current_tenant() and public.pode_pagina('fornecedores'));

-- Nenhuma policy de insert/update/delete em lugar nenhum: a única porta é
-- pelas funções da seção 6. Mesmo padrão do agendamento que já está no ar.


-- ============================================================
-- 6) AS PORTAS
-- ============================================================

-- --- 6.1 O fornecedor se cadastra -------------------------------------------
-- Chamada pelo site do fornecedor logo depois de criar a conta de acesso.
-- Cria (ou reaproveita) a empresa pelo CNPJ e prende a pessoa nela.
create or replace function public.forn_cadastrar(
  p_cnpj         text,
  p_razao_social text,
  p_email        text,
  p_telefone     text default null,
  p_responsavel  text default null,
  p_nome         text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cnpj  text;
  v_forn  uuid;
  v_nova  boolean := false;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'erro', 'Entre na sua conta antes de cadastrar.');
  end if;

  -- já tem cadastro? não deixa criar outro
  if exists (select 1 from public.receb_fornecedor_contas where user_id = auth.uid()) then
    return jsonb_build_object('ok', false, 'erro', 'Esta conta já tem cadastro.');
  end if;

  -- CNPJ: guarda só os dígitos, e exige os 14
  v_cnpj := regexp_replace(coalesce(p_cnpj, ''), '[^0-9]', '', 'g');
  if length(v_cnpj) <> 14 then
    return jsonb_build_object('ok', false, 'erro', 'O CNPJ precisa ter 14 números.');
  end if;

  if coalesce(trim(p_razao_social), '') = '' then
    return jsonb_build_object('ok', false, 'erro', 'Informe a razão social da empresa.');
  end if;

  if coalesce(trim(p_email), '') !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' then
    return jsonb_build_object('ok', false, 'erro', 'Informe um email válido.');
  end if;

  -- a empresa já existe? usa. senão, cria aguardando.
  select id into v_forn
    from public.receb_fornecedores
   where tenant_id = public.current_tenant() and cnpj = v_cnpj;

  if v_forn is null then
    insert into public.receb_fornecedores (cnpj, razao_social, email, telefone, responsavel)
    values (v_cnpj, left(trim(p_razao_social), 140), lower(left(trim(p_email), 160)),
            left(trim(coalesce(p_telefone, '')), 30), left(trim(coalesce(p_responsavel, '')), 80))
    returning id into v_forn;
    v_nova := true;

    insert into public.receb_eventos (entidade, entidade_id, acao, para, detalhe)
    values ('fornecedor', v_forn, 'cadastrou', 'aguardando',
            jsonb_build_object('cnpj', v_cnpj, 'razao_social', trim(p_razao_social)));
  end if;

  insert into public.receb_fornecedor_contas (user_id, fornecedor_id, nome, email)
  values (auth.uid(), v_forn, left(trim(coalesce(p_nome, '')), 80), lower(left(trim(p_email), 160)));

  insert into public.receb_eventos (entidade, entidade_id, acao, para, detalhe)
  values ('conta', v_forn, 'cadastrou', 'aguardando',
          jsonb_build_object('user_id', auth.uid(), 'email', lower(trim(p_email)),
                             'empresa_nova', v_nova));

  return jsonb_build_object('ok', true, 'empresa_nova', v_nova);
end;
$$;

-- --- 6.2 O fornecedor consulta a própria situação ---------------------------
create or replace function public.forn_minha_situacao()
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select jsonb_build_object(
        'ok', true,
        'empresa',   f.razao_social,
        'cnpj',      f.cnpj,
        'situacao_empresa', f.situacao,
        'situacao_conta',   c.situacao,
        'liberado',  (c.situacao = 'liberada' and f.situacao = 'liberado'),
        'motivo',    coalesce(c.motivo, f.motivo)
      )
      from public.receb_fornecedor_contas c
      join public.receb_fornecedores f on f.id = c.fornecedor_id
     where c.user_id = auth.uid()),
    jsonb_build_object('ok', false, 'erro', 'Esta conta ainda não tem cadastro.')
  );
$$;

-- --- 6.3 A loja libera, recusa ou bloqueia ----------------------------------
create or replace function public.forn_decidir(
  p_fornecedor_id uuid,
  p_situacao      text,
  p_motivo        text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_antes text;
begin
  if not (public.sou_master() or public.pode_pagina('fornecedores')) then
    return jsonb_build_object('ok', false, 'erro', 'Sem permissão.');
  end if;
  if p_situacao not in ('liberado', 'recusado', 'bloqueado', 'aguardando') then
    return jsonb_build_object('ok', false, 'erro', 'Situação inválida.');
  end if;

  select situacao into v_antes
    from public.receb_fornecedores
   where id = p_fornecedor_id and tenant_id = public.current_tenant();

  if v_antes is null then
    return jsonb_build_object('ok', false, 'erro', 'Fornecedor não encontrado.');
  end if;

  update public.receb_fornecedores
     set situacao      = p_situacao,
         motivo        = nullif(trim(coalesce(p_motivo, '')), ''),
         liberado_por  = auth.uid(),
         liberado_em   = case when p_situacao = 'liberado' then now() else liberado_em end,
         atualizado_em = now()
   where id = p_fornecedor_id and tenant_id = public.current_tenant();

  -- liberar a empresa libera junto quem está esperando dentro dela
  if p_situacao = 'liberado' then
    update public.receb_fornecedor_contas
       set situacao = 'liberada', liberado_por = auth.uid(), liberado_em = now()
     where fornecedor_id = p_fornecedor_id and situacao = 'aguardando';
  end if;

  insert into public.receb_eventos (entidade, entidade_id, acao, de, para, motivo, quem)
  values ('fornecedor', p_fornecedor_id,
          case p_situacao when 'liberado' then 'liberou'
                          when 'recusado' then 'recusou'
                          when 'bloqueado' then 'bloqueou'
                          else 'reabriu' end,
          v_antes, p_situacao, nullif(trim(coalesce(p_motivo, '')), ''), auth.uid());

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.forn_cadastrar(text,text,text,text,text,text) from public;
revoke all on function public.forn_minha_situacao()                          from public;
revoke all on function public.forn_decidir(uuid,text,text)                   from public;
grant execute on function public.forn_cadastrar(text,text,text,text,text,text) to authenticated;
grant execute on function public.forn_minha_situacao()                          to authenticated;
grant execute on function public.forn_decidir(uuid,text,text)                   to authenticated;


-- ============================================================
-- 7) CONFERÊNCIA — o que esperar depois de rodar
-- ============================================================
select 'tabelas criadas' as conferir,
       (select count(*) from information_schema.tables
         where table_schema='public'
           and table_name in ('receb_fornecedores','receb_fornecedor_contas','receb_eventos')) as deve_ser_3;

select 'funcoes criadas' as conferir,
       (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public'
           and p.proname in ('eh_fornecedor','eh_da_casa','forn_meu_id',
                             'forn_cadastrar','forn_minha_situacao','forn_decidir')) as deve_ser_6;

-- Sem nenhuma conta de fornecedor ainda, estas duas respondem false e null:
select public.eh_fornecedor() as sou_fornecedor_deve_ser_false,
       public.forn_meu_id()   as meu_fornecedor_deve_ser_nulo;
