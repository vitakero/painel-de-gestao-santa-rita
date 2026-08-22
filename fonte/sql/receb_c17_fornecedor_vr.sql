-- ============================================================
-- C17 — O PEDIDO ACHA O DONO SOZINHO
--
-- O robô traz os pedidos do VR e tenta casar cada um com o cadastro do portal
-- pelo CNPJ. Isso já funcionava. O que não funcionava era o caso normal:
--
--   segunda-feira  o robô traz 319 pedidos; ninguém cadastrado ainda → órfãos
--   quarta-feira   o fornecedor se cadastra e você libera
--   quarta-feira   ele entra no portal e vê "você não tem pedido em aberto"
--
-- Ele só passaria a ver na próxima vez que o robô rodasse. E não dava para
-- consertar depois, porque o pedido guarda o CÓDIGO do fornecedor no VR
-- (por exemplo 513), não o CNPJ — e o portal conhece a pessoa pelo CNPJ.
-- Faltava a ponte entre um e outro.
--
-- Esta é a ponte: uma cópia enxuta da lista de fornecedores do VR, com
-- código e CNPJ. 132 linhas em vez de repetir o CNPJ em cada pedido.
--
-- E UMA REGRA SÓ decide de quem é o pedido: a função receb_ligar_fornecedores.
-- Ela é chamada pelo robô no fim de cada carga E pelo gatilho quando alguém
-- se cadastra. Se cada um tivesse a sua conta, um dia elas discordariam e o
-- fornecedor veria pedido de outro — que é o pior erro possível aqui.
--
-- Pode rodar mais de uma vez sem estragar nada.
-- ============================================================


-- ============================================================
-- 1) CNPJ SEMPRE DO MESMO JEITO
--
-- No VR o CNPJ é número, então "01234567000199" chega como 1234567000199 e
-- perde o zero da frente. No cadastro do portal ele é texto e pode vir com
-- ponto, barra e traço. Sem passar os dois pela mesma peneira, o mesmo
-- fornecedor não se reconhece.
-- ============================================================
create or replace function public.receb_cnpj14(p_v text)
returns text language sql immutable as $$
  select nullif(lpad(regexp_replace(coalesce(p_v, ''), '[^0-9]', '', 'g'), 14, '0'), '00000000000000');
$$;


-- ============================================================
-- 2) A LISTA DE FORNECEDORES DO VR
--
-- Só o necessário para a ponte e para a loja saber de quem é um pedido órfão.
-- Quem escreve aqui é o robô, com a chave de serviço.
-- ============================================================
create table if not exists public.receb_fornecedores_vr (
  tenant_id      uuid not null default public.current_tenant(),
  vr_id          integer not null,       -- o código do fornecedor dentro do VR
  cnpj           text,                   -- 14 dígitos, já peneirado
  razao_social   text,
  nome_fantasia  text,
  atualizado_em  timestamptz not null default now(),
  primary key (tenant_id, vr_id)
);

create index if not exists ix_receb_forn_vr_cnpj
  on public.receb_fornecedores_vr (tenant_id, cnpj);

comment on table public.receb_fornecedores_vr is
  'Cópia enxuta dos fornecedores do VR (código + CNPJ). É a ponte entre o pedido, que guarda o código do VR, e o cadastro do portal, que conhece o CNPJ.';


-- ============================================================
-- 3) A REGRA ÚNICA DE QUEM É DONO DO QUÊ
--
-- Faz as duas ligações, nesta ordem:
--   a) o cadastro do portal ganha o código do VR, achado pelo CNPJ
--   b) o pedido ganha o dono, achado pelo código do VR
--
-- Passando p_forn, mexe só naquele fornecedor (é o que o gatilho faz quando
-- alguém se cadastra). Sem nada, arruma tudo (é o que o robô faz).
--
-- Um pedido NUNCA troca de dono para outro fornecedor: a ligação só acontece
-- onde ainda está vazia. Se o VR mudar o CNPJ de um código, alguém tem que
-- olhar — não é para o sistema decidir sozinho que a carga mudou de mãos.
-- ============================================================
create or replace function public.receb_ligar_fornecedores(p_forn uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cad int := 0; v_ped int := 0;
begin
  -- (a) cadastro do portal <- código do VR, pelo CNPJ.
  -- Guarda o MENOR código quando a mesma empresa tem mais de um no VR (matriz
  -- e filial cadastradas separado é comum). É só informativo — quem manda na
  -- dona do pedido é o CNPJ, logo abaixo. Escolher o menor é para não ficar
  -- trocando de valor a cada rodada, o que sujaria a auditoria à toa.
  update public.receb_fornecedores f
     set vr_id = (select min(v.vr_id) from public.receb_fornecedores_vr v
                   where v.cnpj = public.receb_cnpj14(f.cnpj)),
         atualizado_em = now()
   where f.vr_id is null
     and exists (select 1 from public.receb_fornecedores_vr v
                  where v.cnpj = public.receb_cnpj14(f.cnpj))
     and (p_forn is null or f.id = p_forn);
  get diagnostics v_cad = row_count;

  -- (b) pedido <- dono, pelo CNPJ do código que veio no pedido.
  -- Passa pela lista do VR de propósito, em vez de comparar com o vr_id do
  -- cadastro: assim a empresa com DOIS códigos no VR recebe os pedidos dos
  -- dois. Comparando com um código só, metade sumia e ninguém entenderia
  -- por que "faltam pedidos" sem nenhum erro na tela.
  update public.receb_pedidos p
     set fornecedor_id = f.id
    from public.receb_fornecedores_vr v
    join public.receb_fornecedores f
      on v.cnpj is not null
     and v.cnpj = public.receb_cnpj14(f.cnpj)
   where p.fornecedor_id is null
     and p.fornecedor_vr = v.vr_id
     and (p_forn is null or f.id = p_forn);
  get diagnostics v_ped = row_count;

  return jsonb_build_object('ok', true, 'cadastros_ligados', v_cad, 'pedidos_ligados', v_ped);
end;
$$;


-- ============================================================
-- 4) O GATILHO: CADASTROU, JÁ VÊ OS PEDIDOS
--
-- Sem isto o fornecedor entraria no portal no mesmo dia em que você liberou e
-- leria "você não tem pedido em aberto" — tendo doze. Ia ligar reclamando, e
-- com razão.
--
-- A recursão morre sozinha: a segunda passada não acha mais linha vazia para
-- preencher, então nenhum UPDATE acontece e nenhum gatilho dispara de novo.
-- ============================================================
create or replace function public.receb_forn_ligar_gatilho()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.receb_ligar_fornecedores(new.id);
  return null;
end;
$$;

drop trigger if exists tg_receb_forn_ligar on public.receb_fornecedores;
create trigger tg_receb_forn_ligar
  after insert or update of cnpj, vr_id on public.receb_fornecedores
  for each row execute function public.receb_forn_ligar_gatilho();


-- ============================================================
-- 5) QUEM VÊ E QUEM CHAMA
--
-- A lista de fornecedores do VR é da LOJA. É com quem você compra e quanto —
-- fornecedor nenhum tem o que fazer olhando a lista dos concorrentes dele.
-- ============================================================
alter table public.receb_fornecedores_vr enable row level security;

drop policy if exists rfv_sel on public.receb_fornecedores_vr;
create policy rfv_sel on public.receb_fornecedores_vr for select to authenticated
  using (tenant_id = public.current_tenant()
     and (public.eh_master() or public.pode_pagina('central') or public.pode_pagina('fornecedores')));

revoke all on function public.receb_cnpj14(text)              from public, anon;
revoke all on function public.receb_ligar_fornecedores(uuid)  from public, anon;
grant execute on function public.receb_cnpj14(text)             to authenticated;
grant execute on function public.receb_ligar_fornecedores(uuid) to authenticated;


-- ============================================================
-- 6) ARRUMA O QUE JÁ ESTÁ AÍ
--
-- Roda a regra uma vez agora. Como a lista do VR ainda está vazia (o robô é
-- quem enche), aqui o resultado vem zerado — e é assim mesmo. Quem vai ligar
-- de verdade é a primeira rodada do robô dentro da loja.
-- ============================================================
select 'arrumando o que ja existe' as conferir, public.receb_ligar_fornecedores() as resultado;


-- ============================================================
-- 7) CONFERÊNCIA
-- ============================================================
select 'o CNPJ do VR recupera o zero da frente?' as conferir,
       public.receb_cnpj14('1234567000199')      as veio_numero,
       public.receb_cnpj14('01.234.567/0001-99') as veio_com_pontos,
       public.receb_cnpj14('1234567000199') = public.receb_cnpj14('01.234.567/0001-99') as sao_o_mesmo;

select 'como esta hoje' as conferir,
       (select count(*) from public.receb_fornecedores)                              as cadastros,
       (select count(*) from public.receb_fornecedores where vr_id is not null)       as cadastros_com_codigo_vr,
       (select count(*) from public.receb_fornecedores_vr)                            as lista_do_vr,
       (select count(*) from public.receb_pedidos)                                    as pedidos,
       (select count(*) from public.receb_pedidos where fornecedor_id is not null)    as pedidos_com_dono;

select 'o gatilho existe' as conferir, tgname
  from pg_trigger where tgname = 'tg_receb_forn_ligar';
