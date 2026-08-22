-- ============================================================
--  ASSINATURA BLINDADA — Painel Santa Rita   (versão 2)
--  Rodar UMA vez no SQL Editor do Supabase: cole TUDO e clique RUN.
--  Rodar de novo é seguro — não troca a chave nem apaga assinatura.
--
--  Fecha as brechas encontradas na auditoria de segurança:
--   1. senha_master_ok estava aberta para ANÔNIMO — qualquer pessoa na
--      internet podia testar senhas do master sem parar. FECHADA + trava
--      de tentativas.
--   2. Assinar/cancelar não conferiam QUEM está chamando. Agora exigem
--      acesso à página "Pontos extras" além da senha do master.
--   3. Apagar o ponto arrancava a assinatura sem senha nenhuma. Agora a
--      prova vive em tabela própria, que ninguém apaga.
--   4. A conferência mostrava os dados de HOJE. Agora mostra o que foi
--      ASSINADO (foto congelada), e avisa se a linha atual está diferente.
--   5. O endereço saía impresso no contrato mas ficava fora da assinatura.
--      Agora entra.
--   6. O painel mandava um texto que o servidor guardava sem conferir.
--      Agora o servidor RECUSA se a tela e o banco discordarem.
-- ============================================================

create extension if not exists pgcrypto with schema extensions;

-- ============================================================
-- PARTE 1 — A SENHA DO MASTER (correção mais urgente)
-- ============================================================

-- Registro de tentativas, para travar força bruta.
create table if not exists public.senha_master_tentativas (
  id         bigserial primary key,
  quem       uuid,
  acertou    boolean not null,
  em         timestamptz not null default now()
);
alter table public.senha_master_tentativas enable row level security;
revoke all on table public.senha_master_tentativas from anon, authenticated;
create index if not exists idx_smt_quem_em on public.senha_master_tentativas (quem, em desc);

create or replace function public.senha_master_ok(senha text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  uid   uuid := auth.uid();
  erros int;
  bate  boolean;
begin
  -- sem login não passa: fecha o oráculo anônimo de força bruta
  if uid is null then
    raise exception 'precisa_estar_logado';
  end if;

  -- 10 erros em 15 minutos = descansa 15 minutos
  select count(*) into erros
    from public.senha_master_tentativas
   where quem = uid and not acertou and em > now() - interval '15 minutes';
  if erros >= 10 then
    raise exception 'muitas_tentativas';
  end if;

  select exists (
    select 1
      from public.perfis p
      join auth.users u on u.id = p.id
     where coalesce(p.is_master, false)
       and u.encrypted_password = extensions.crypt(senha, u.encrypted_password)
  ) into bate;

  insert into public.senha_master_tentativas (quem, acertou) values (uid, bate);
  return bate;
end;
$$;

-- FECHA para anônimo (era isto que estava aberto)
revoke all on function public.senha_master_ok(text) from public, anon;
grant execute on function public.senha_master_ok(text) to authenticated;

-- ============================================================
-- PARTE 2 — A CHAVE SECRETA
-- ============================================================
create table if not exists public.assinatura_chave (
  id         int primary key default 1,
  chave      text not null,
  criada_em  timestamptz not null default now(),
  constraint assinatura_chave_unica check (id = 1)
);
alter table public.assinatura_chave enable row level security;   -- sem policy = ninguém lê pela API
revoke all on table public.assinatura_chave from anon, authenticated;

insert into public.assinatura_chave (id, chave)
select 1, encode(extensions.gen_random_bytes(32), 'hex')
where not exists (select 1 from public.assinatura_chave where id = 1);

-- ============================================================
-- PARTE 3 — A FOTO DO QUE FOI ASSINADO
--   Guarda TUDO que sai impresso no contrato. É esta foto que a
--   conferência pública mostra — não a linha de hoje, que pode ter
--   sido reaproveitada para outro fornecedor.
-- ============================================================
create or replace function public.assin_snapshot_ponto(p_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r      record;
  meses  int;
  ini_d  date;
  fim_d  date;
begin
  select * into r from public.pontos_extras where id = p_id;
  if not found then return null; end if;

  -- MESMA regra do contrato impresso (função pxMesesEntre do painel):
  -- diferença de meses, menos 1 se o dia do fim for menor que o do início.
  begin
    ini_d := r.abertura::date; fim_d := r.vencimento::date;
    meses := (extract(year from fim_d)*12 + extract(month from fim_d))
           - (extract(year from ini_d)*12 + extract(month from ini_d));
    if extract(day from fim_d) < extract(day from ini_d) then meses := meses - 1; end if;
    if meses < 0 then meses := 0; end if;
  exception when others then meses := 0;
  end;

  return jsonb_build_object(
    'numero',       coalesce(r.numero, 0),
    'fornecedor',   coalesce(r.fornecedor, ''),
    'razao_social', coalesce(r.razao_social, ''),
    'cnpj',         coalesce(r.cnpj, ''),
    'vendedor',     coalesce(r.vendedor, ''),
    'endereco',     coalesce(r.endereco, ''),
    'pagamento',    coalesce(r.pagamento, ''),
    'abertura',     coalesce(r.abertura::text, ''),
    'vencimento',   coalesce(r.vencimento::text, ''),
    'valor_mensal', coalesce(r.valor, 0),
    'meses',        meses,
    'valor_total',  round(coalesce(r.valor, 0) * meses, 2));
end;
$$;
revoke all on function public.assin_snapshot_ponto(text) from public, anon, authenticated;

-- ------------------------------------------------------------
-- A IMPRESSÃO DIGITAL — derivada da foto, sem ambiguidade.
-- Separador chr(31) (caractere de controle) e cada campo é limpo antes,
-- para que ninguém consiga "empurrar" a divisão dos campos digitando o
-- separador dentro do nome e fabricar duas impressões iguais.
-- ------------------------------------------------------------
create or replace function public.assin_impressao_ponto(p_id text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s jsonb := public.assin_snapshot_ponto(p_id);
begin
  if s is null then return null; end if;
  -- Cada campo é normalizado EXPLICITAMENTE. Não dá para ler número direto do jsonb:
  -- 500 sairia "500" aqui e "500.00" no painel, e toda assinatura pareceria quebrada.
  return 'v2' || chr(31) ||
    (select string_agg(replace(v, chr(31), ' '), chr(31) order by ord)
       from (values
         (1,  (s->>'numero')::numeric::bigint::text),
         (2,  coalesce(s->>'fornecedor', '')),
         (3,  coalesce(s->>'razao_social', '')),
         (4,  coalesce(s->>'cnpj', '')),
         (5,  coalesce(s->>'vendedor', '')),
         (6,  coalesce(s->>'endereco', '')),
         (7,  coalesce(s->>'pagamento', '')),
         (8,  coalesce(s->>'abertura', '')),
         (9,  coalesce(s->>'vencimento', '')),
         (10, to_char((s->>'valor_mensal')::numeric, 'FM999999999990.00'))
       ) as t(ord, v));
end;
$$;
revoke all on function public.assin_impressao_ponto(text) from public, anon, authenticated;

create or replace function public.assin_codigo(p_impressao text, p_em text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare k text; h text;
begin
  select chave into k from public.assinatura_chave where id = 1;
  if k is null then raise exception 'sem_chave'; end if;
  h := upper(encode(extensions.hmac(p_impressao || chr(31) || p_em, k, 'sha256'), 'hex'));
  return substr(h,1,4)||'-'||substr(h,5,4)||'-'||substr(h,9,4)||'-'||substr(h,13,4);
end;
$$;
revoke all on function public.assin_codigo(text, text) from public, anon, authenticated;

-- ============================================================
-- PARTE 4 — O LIVRO DE ASSINATURAS (só entra, nunca sai)
--   Apagar o ponto extra no painel NÃO apaga a prova daqui.
-- ============================================================
create table if not exists public.assinaturas_emitidas (
  codigo     text primary key,
  ponto_id   text not null,
  em         text not null,
  nome       text not null,
  por_login  text,
  impressao  text not null,
  dados      jsonb not null,
  criada_em  timestamptz not null default now()
);
alter table public.assinaturas_emitidas enable row level security;
revoke all on table public.assinaturas_emitidas from anon, authenticated;
create index if not exists idx_ae_ponto on public.assinaturas_emitidas (ponto_id);

-- ============================================================
-- PARTE 5 — TRAVAS DE ESCRITA NA COLUNA "assinatura"
-- ============================================================
create or replace function public.assin_trava()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('app.assinando', true) = '1' then return new; end if;
  if tg_op = 'INSERT' then new.assinatura := null; return new; end if;
  if new.assinatura is distinct from old.assinatura then new.assinatura := old.assinatura; end if;
  return new;
end;
$$;
drop trigger if exists trg_assin_trava on public.pontos_extras;
create trigger trg_assin_trava
  before insert or update on public.pontos_extras
  for each row execute function public.assin_trava();

-- Apagar contrato assinado exige cancelar a assinatura antes (com a senha do master).
create or replace function public.assin_trava_del()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('app.assinando', true) = '1' then return old; end if;
  if old.assinatura is not null then
    raise exception 'contrato_assinado_nao_apaga';
  end if;
  return old;
end;
$$;
drop trigger if exists trg_assin_trava_del on public.pontos_extras;
create trigger trg_assin_trava_del
  before delete on public.pontos_extras
  for each row execute function public.assin_trava_del();

-- ============================================================
-- PARTE 6 — ASSINAR
--   Exige: (a) acesso à página "Pontos extras", (b) senha do master,
--          (c) a tela estar vendo o MESMO contrato que o banco.
-- ============================================================
create or replace function public.assinar_contrato_ponto(
  p_id text, p_senha text, p_nome text, p_impressao_esperada text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  imp text; snap jsonb; em text; cod text; nome text; quem text; ass jsonb;
begin
  if not public.pode_pagina('pontos') then raise exception 'sem_permissao'; end if;
  if not public.senha_master_ok(p_senha) then raise exception 'senha_incorreta'; end if;

  snap := public.assin_snapshot_ponto(p_id);
  if snap is null then raise exception 'ponto_nao_encontrado'; end if;
  imp := public.assin_impressao_ponto(p_id);

  -- a tela precisa estar vendo o mesmo contrato que está gravado
  if p_impressao_esperada is not null and btrim(p_impressao_esperada) <> '' and p_impressao_esperada <> imp then
    raise exception 'contrato_mudou';
  end if;

  nome := nullif(btrim(coalesce(p_nome, '')), '');
  if nome is null then raise exception 'sem_nome_do_diretor'; end if;

  em   := to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  cod  := public.assin_codigo(imp, em);
  quem := coalesce((select email from auth.users where id = auth.uid()), '');

  ass := jsonb_build_object('nome', nome, 'em', em, 'impressao', imp, 'porLogin', quem, 'codigo', cod);

  insert into public.assinaturas_emitidas (codigo, ponto_id, em, nome, por_login, impressao, dados)
  values (cod, p_id, em, nome, quem, imp, snap)
  on conflict (codigo) do nothing;

  perform set_config('app.assinando', '1', true);
  update public.pontos_extras set assinatura = ass where id = p_id;
  perform set_config('app.assinando', '0', true);

  return ass;
end;
$$;
revoke all on function public.assinar_contrato_ponto(text, text, text, text) from public, anon;
grant execute on function public.assinar_contrato_ponto(text, text, text, text) to authenticated;
drop function if exists public.assinar_contrato_ponto(text, text, text);

-- ============================================================
-- PARTE 7 — CANCELAR (a prova continua no livro; só sai do contrato ativo)
-- ============================================================
create or replace function public.cancelar_assinatura_ponto(p_id text, p_senha text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.pode_pagina('pontos') then raise exception 'sem_permissao'; end if;
  if not public.senha_master_ok(p_senha) then raise exception 'senha_incorreta'; end if;
  perform set_config('app.assinando', '1', true);
  update public.pontos_extras set assinatura = null where id = p_id;
  perform set_config('app.assinando', '0', true);
  return true;
end;
$$;
revoke all on function public.cancelar_assinatura_ponto(text, text) from public, anon;
grant execute on function public.cancelar_assinatura_ponto(text, text) to authenticated;

-- Apagar um ponto assinado: libera a trava depois de conferir a senha.
create or replace function public.apagar_ponto_assinado(p_id text, p_senha text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.pode_pagina('pontos') then raise exception 'sem_permissao'; end if;
  if not public.senha_master_ok(p_senha) then raise exception 'senha_incorreta'; end if;
  perform set_config('app.assinando', '1', true);
  delete from public.pontos_extras where id = p_id;   -- o livro de assinaturas continua intacto
  perform set_config('app.assinando', '0', true);
  return true;
end;
$$;
revoke all on function public.apagar_ponto_assinado(text, text) from public, anon;
grant execute on function public.apagar_ponto_assinado(text, text) to authenticated;

-- ============================================================
-- PARTE 8 — CONFERIR (público, sem login)
--   Mostra a FOTO do que foi assinado. Nunca a linha de hoje.
-- ============================================================
create or replace function public.conferir_assinatura(p_codigo text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a        record;
  cod      text;
  imp_hoje text;
  existe   boolean;
begin
  cod := upper(regexp_replace(coalesce(p_codigo, ''), '[^0-9A-Fa-f]', '', 'g'));
  if length(cod) <> 16 then
    return jsonb_build_object('achou', false, 'motivo', 'formato');
  end if;
  cod := substr(cod,1,4)||'-'||substr(cod,5,4)||'-'||substr(cod,9,4)||'-'||substr(cod,13,4);

  select * into a from public.assinaturas_emitidas where codigo = cod;
  if not found then
    return jsonb_build_object('achou', false, 'motivo', 'nao_existe');
  end if;

  -- o código tem que ter saído mesmo da nossa chave
  if public.assin_codigo(a.impressao, a.em) <> cod then
    return jsonb_build_object('achou', false, 'motivo', 'nao_existe');
  end if;

  select exists(select 1 from public.pontos_extras where id = a.ponto_id) into existe;
  imp_hoje := public.assin_impressao_ponto(a.ponto_id);

  return jsonb_build_object(
    'achou',       true,
    'valido',      true,                                   -- o código é legítimo
    'atual',       (existe and imp_hoje = a.impressao),     -- e o cadastro continua igual
    'sumiu',       (not existe),
    'diretor',     a.nome,
    'assinado_em', a.em,
    'codigo',      cod,
    'dados',       a.dados);
end;
$$;
revoke all on function public.conferir_assinatura(text) from public;
grant execute on function public.conferir_assinatura(text) to anon, authenticated;

-- ============================================================
-- CONFERÊNCIA FINAL
-- ============================================================
select
  case when has_function_privilege('anon','public.senha_master_ok(text)','execute')
       then '❌ AINDA ABERTA' else '✅' end || ' senha do master fechada para anônimo'   as item_1,
  case when (select count(*) from public.assinatura_chave) = 1
       then '✅' else '❌' end || ' chave secreta criada'                                as item_2,
  case when exists (select 1 from pg_trigger where tgname='trg_assin_trava')
        and exists (select 1 from pg_trigger where tgname='trg_assin_trava_del')
       then '✅' else '❌' end || ' travas de escrita e de exclusão'                     as item_3,
  case when exists (select 1 from pg_proc where proname='conferir_assinatura')
       then '✅' else '❌' end || ' conferência pública liberada'                        as item_4,
  case when has_function_privilege('anon','public.conferir_assinatura(text)','execute')
       then '✅' else '❌' end || ' anônimo consegue conferir código'                    as item_5;
