-- ============================================================================
-- ETAPA 3 — A LOJA PASSA A SABER QUEM ESTÁ TRAVADO NO PORTAL
--
-- O buraco: desde que as travas passaram a BARRAR de verdade (item fora do pedido,
-- quantidade acima do pedido, nota sem pedido), o fornecedor que erra simplesmente
-- não consegue agendar. E a loja não fica sabendo de nada.
--
-- Na prática isso vira o telefone tocando no recebimento: "não estou conseguindo
-- agendar" — e quem atende não faz ideia do porquê, nem tem onde olhar. É o mesmo
-- telefonema que este portal existe para acabar, só que agora com outro motivo.
--
-- Repare que uma entrega torta NUNCA vira agendamento: ela é barrada antes. Então
-- "a divergência chegar na loja" só pode ser isto — a loja ver as TENTATIVAS
-- barradas, com o motivo escrito, antes do fornecedor desistir e ligar.
--
-- POR QUE UMA TABELA, E NÃO A AUDITORIA:
-- A receb_eventos é história: uma linha por acontecimento, para sempre. Isto aqui é
-- FILA DE TRABALHO: mostra quem está travado AGORA. Quando o fornecedor consegue
-- agendar, ele sai da lista sozinho — coisa que uma auditoria nunca deve fazer.
-- Por isso as duas coisas convivem: a auditoria guarda a primeira vez que cada
-- fornecedor bateu em cada parede; a fila mostra quem ainda está lá.
--
-- Rodar no SQL Editor do Supabase. Pode rodar mais de uma vez sem estragar nada.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) A FILA
--
-- Uma linha por (fornecedor, motivo). Bater na mesma parede de novo não cria linha
-- nova: soma no contador e atualiza a hora. Sem isso, um fornecedor teimoso encheria
-- a tela com quarenta linhas iguais e esconderia os outros.
--
-- fornecedor_nome fica gravado aqui de propósito. Buscar o nome por relacionamento
-- exigiria que quem abre a Central tivesse permissão de ler o cadastro de
-- fornecedores — e ela não tem, nem deve ter só para ver esta lista.
-- ----------------------------------------------------------------------------
create table if not exists public.receb_barrados (
  id              bigserial primary key,
  tenant_id       uuid not null default public.current_tenant(),
  fornecedor_id   uuid not null references public.receb_fornecedores(id) on delete cascade,
  fornecedor_nome text,
  onde            text not null,          -- 'nf' | 'pedidos' (em que passo do portal)
  motivo          text not null,          -- a frase que o fornecedor leu na tela
  pedido          text,
  vezes           int  not null default 1,
  primeira_em     timestamptz not null default now(),
  ultima_em       timestamptz not null default now()
);

create unique index if not exists ux_receb_barrado
  on public.receb_barrados (tenant_id, fornecedor_id, md5(motivo));

create index if not exists ix_receb_barrado_quando
  on public.receb_barrados (tenant_id, ultima_em desc);

comment on table public.receb_barrados is
  'Fila de trabalho: fornecedores que tentaram agendar e foram barrados, e ainda '
  'nao conseguiram. Sai da lista sozinho quando o fornecedor agenda. Nao e auditoria '
  '(essa e a receb_eventos, que nunca apaga nada).';

-- ----------------------------------------------------------------------------
-- 2) QUEM PODE VER
--
-- Só quem abre a Central Logística, ou o master. O FORNECEDOR NÃO LÊ ESTA TABELA —
-- ela tem o nome e o tropeço de todos os outros fornecedores. Sem policy de
-- insert/update/delete: a única porta é a função lá embaixo.
-- ----------------------------------------------------------------------------
alter table public.receb_barrados enable row level security;

drop policy if exists rbar_sel on public.receb_barrados;
create policy rbar_sel on public.receb_barrados
  for select to authenticated
  using (tenant_id = public.current_tenant()
         and (public.sou_master() or public.pode_pagina('central')));

-- ----------------------------------------------------------------------------
-- 3) A REGRA PASSA A ANOTAR QUANDO BARRA
--
-- Mesma função de sempre (uma regra, um lugar): a tela pergunta, o gravar confere.
-- A única diferença é que agora, quando ela diz NÃO, isso não morre na tela do
-- fornecedor. Anotar não pode derrubar a resposta: se a anotação falhar, o
-- fornecedor recebe o "não" do mesmo jeito — por isso o bloco tem rede embaixo.
-- ----------------------------------------------------------------------------
create or replace function public.receb_anotar_barrado(
  p_forn uuid, p_onde text, p_motivo text, p_pedido text)
returns void language plpgsql security definer set search_path = public as $$
declare v_nome text; v_novo boolean := false;
begin
  if p_forn is null or coalesce(trim(p_motivo),'') = '' then return; end if;
  select razao_social into v_nome from public.receb_fornecedores where id = p_forn;

  insert into public.receb_barrados (fornecedor_id, fornecedor_nome, onde, motivo, pedido)
  values (p_forn, v_nome, coalesce(p_onde,'nf'), p_motivo, nullif(trim(coalesce(p_pedido,'')),''))
  on conflict (tenant_id, fornecedor_id, md5(motivo)) do update
     set vezes     = public.receb_barrados.vezes + 1,
         ultima_em = now(),
         onde      = excluded.onde,
         pedido    = coalesce(excluded.pedido, public.receb_barrados.pedido)
  returning (xmax = 0) into v_novo;

  -- A auditoria guarda só a PRIMEIRA vez que este fornecedor bateu nesta parede.
  -- Uma linha por tentativa encheria a história de repetição e esconderia o resto.
  if v_novo then
    insert into public.receb_eventos (entidade, entidade_id, acao, para, motivo, detalhe)
    values ('fornecedor', p_forn, 'barrado', coalesce(p_onde,'nf'), p_motivo,
            jsonb_build_object('pedido', nullif(trim(coalesce(p_pedido,'')),'')));
  end if;
exception when others then
  -- anotar é serviço; nunca pode derrubar a resposta que o fornecedor está esperando
  null;
end $$;

revoke all on function public.receb_anotar_barrado(uuid,text,text,text) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4) A CONFERÊNCIA DAS TRAVAS, AGORA ANOTANDO
--
-- Idêntica à de hoje. A única mudança: antes de devolver um "não", ela avisa a loja.
-- ----------------------------------------------------------------------------
create or replace function public.forn_checar_agendamento(
  p_pedido text default null,
  p_notas  jsonb default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_forn uuid; l record; f record;
  n jsonb; v_peds text[]; v_conf jsonb;
  v_tem_nota boolean; v_ped_nota text;
  v_fora int; v_acima int; v_qual text;
  v_erro text; v_onde text; v_ped_erro text;
begin
  v_forn := public.forn_meu_id();
  if v_forn is null then
    return jsonb_build_object('ok', false, 'onde', 'nf', 'erro', 'Faça login novamente.');
  end if;

  select * into f from public.receb_fornecedores where id = v_forn;
  select * into l from public.receb_locais
   where tenant_id = public.current_tenant() order by criado_em limit 1;

  v_tem_nota := coalesce(jsonb_array_length(coalesce(p_notas, '[]'::jsonb)), 0) > 0;

  -- R2 — agendar SEM nota é permissão, não é o padrão
  if not v_tem_nota and not coalesce(f.pode_sem_nota, false) then
    v_onde := 'nf';
    v_erro := 'Para agendar sem a nota fiscal é preciso liberação da loja. '
              'Envie o XML da nota, ou fale com o recebimento para pedir essa liberação.';
    perform public.receb_anotar_barrado(v_forn, v_onde, v_erro, p_pedido);
    return jsonb_build_object('ok', false, 'onde', v_onde, 'erro', v_erro);
  end if;

  -- R1 — o pedido de compra é obrigatório
  if coalesce(l.nf_exige_pedido, true) then
    if v_tem_nota then
      for n in select * from jsonb_array_elements(p_notas) loop
        if nullif(trim(coalesce(n->>'pedido','')), '') is null then
          v_onde := 'pedidos';
          v_erro := 'A nota ' || coalesce(nullif(n->>'numero',''), 'enviada') ||
                    ' precisa estar vinculada a um pedido de compra da loja.';
          perform public.receb_anotar_barrado(v_forn, v_onde, v_erro, null);
          return jsonb_build_object('ok', false, 'onde', v_onde, 'erro', v_erro);
        end if;
      end loop;
    elsif nullif(trim(coalesce(p_pedido,'')), '') is null then
      v_onde := 'pedidos';
      v_erro := 'Informe o número do pedido de compra da loja para agendar.';
      perform public.receb_anotar_barrado(v_forn, v_onde, v_erro, null);
      return jsonb_build_object('ok', false, 'onde', v_onde, 'erro', v_erro);
    end if;
  end if;

  -- R3c e R5 — item fora do pedido e quantidade acima BARRAM
  -- Uso a MESMA forn_conferir_nota da tela — uma conta só.
  if v_tem_nota and (coalesce(l.nf_bloqueia_item_fora, true) or coalesce(l.nf_bloqueia_acima_pedido, true)) then
    for n in select * from jsonb_array_elements(p_notas) loop
      v_ped_nota := nullif(trim(coalesce(n->>'pedido','')), '');
      if v_ped_nota is null then continue; end if;
      if coalesce(jsonb_array_length(coalesce(n->'itens','[]'::jsonb)),0) = 0 then continue; end if;

      v_peds := array[v_ped_nota];
      v_conf := public.forn_conferir_nota(v_peds, n->'itens');

      if coalesce((v_conf->>'conferido')::boolean, false) then
        v_fora  := coalesce((v_conf->'resumo'->>'fora')::int, 0);
        v_acima := coalesce((v_conf->'resumo'->>'acima')::int, 0);

        if coalesce(l.nf_bloqueia_item_fora, true) and v_fora > 0 then
          select string_agg(x->>'descricao', ', ') into v_qual
            from jsonb_array_elements(v_conf->'linhas') x
           where x->>'situacao' = 'fora';
          v_onde := 'pedidos';
          v_erro := 'A nota ' || coalesce(nullif(n->>'numero',''),'') || ' traz ' || v_fora ||
                    ' produto(s) que não estão no pedido ' || v_ped_nota || ': ' ||
                    left(coalesce(v_qual,''), 180) ||
                    '. Confira se o pedido escolhido é o certo, ou fale com o comprador da loja.';
          perform public.receb_anotar_barrado(v_forn, v_onde, v_erro, v_ped_nota);
          return jsonb_build_object('ok', false, 'onde', v_onde, 'erro', v_erro);
        end if;

        if coalesce(l.nf_bloqueia_acima_pedido, true) and v_acima > 0 then
          select string_agg(x->>'descricao', ', ') into v_qual
            from jsonb_array_elements(v_conf->'linhas') x
           where x->>'situacao' = 'acima';
          v_onde := 'pedidos';
          v_erro := 'A nota ' || coalesce(nullif(n->>'numero',''),'') || ' traz mais do que o pedido ' ||
                    v_ped_nota || ' ainda espera, em ' || v_acima || ' produto(s): ' ||
                    left(coalesce(v_qual,''), 180) ||
                    '. Fale com o comprador da loja antes de agendar.';
          perform public.receb_anotar_barrado(v_forn, v_onde, v_erro, v_ped_nota);
          return jsonb_build_object('ok', false, 'onde', v_onde, 'erro', v_erro);
        end if;
      end if;
    end loop;
  end if;

  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.forn_checar_agendamento(text, jsonb) from public, anon;
grant execute on function public.forn_checar_agendamento(text, jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- 5) CONSEGUIU AGENDAR = SAIU DA FILA
--
-- É isso que faz a lista significar "travado AGORA" em vez de "já tropeçou um dia".
-- Uma lista que só cresce ninguém olha depois da segunda semana.
-- ----------------------------------------------------------------------------
create or replace function public.forn_agendar_portal(
  p_data      date,
  p_hora      int,
  p_pedido    text default null,
  p_descricao text default null,
  p_transportadora_cnpj text default null,
  p_notas     jsonb default null,
  p_minutos   int   default 60,
  p_carga     jsonb default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  n jsonb; v_res jsonb; v_chk jsonb;
  v_tem_nota boolean; v_id uuid; v_ped_nota text;
begin
  -- AS TRAVAS. Mesmas de sempre, num lugar só — a tela pergunta as mesmas
  -- para avisar o fornecedor antes de ele preencher o resto.
  v_chk := public.forn_checar_agendamento(p_pedido, p_notas);
  if not coalesce((v_chk->>'ok')::boolean, false) then
    return jsonb_build_object('ok', false, 'erro', v_chk->>'erro');
  end if;

  v_tem_nota := coalesce(jsonb_array_length(coalesce(p_notas, '[]'::jsonb)), 0) > 0;

  v_res := public.forn_agendar(p_data, p_hora, p_pedido, p_descricao,
                               p_transportadora_cnpj, p_notas, p_minutos, p_carga);

  -- Qual nota é de qual pedido — gravado agora, uma linha por nota.
  if coalesce((v_res->>'ok')::boolean, false) and v_tem_nota then
    v_id := (v_res->>'id')::uuid;
    for n in select * from jsonb_array_elements(p_notas) loop
      v_ped_nota := nullif(trim(coalesce(n->>'pedido','')), '');
      if v_ped_nota is null then continue; end if;
      update public.receb_agenda_notas
         set pedido_numero = left(v_ped_nota, 40)
       where agenda_id = v_id
         and chave = nullif(regexp_replace(coalesce(n->>'chave',''),'[^0-9]','','g'),'');
      insert into public.receb_agenda_pedidos (agenda_id, numero)
      select v_id, left(v_ped_nota, 40)
       where not exists (select 1 from public.receb_agenda_pedidos p
                          where p.agenda_id = v_id and p.numero = left(v_ped_nota, 40));
    end loop;
  end if;

  -- Conseguiu: sai da fila de travados. Limpar aqui e não na conferência é de
  -- propósito — só agendar de verdade prova que o problema acabou.
  if coalesce((v_res->>'ok')::boolean, false) then
    begin
      delete from public.receb_barrados
       where tenant_id = public.current_tenant()
         and fornecedor_id = public.forn_meu_id();
    exception when others then null;
    end;
  end if;

  return v_res;
end $$;

revoke all on function public.forn_agendar_portal(date,int,text,text,text,jsonb,int,jsonb) from public, anon;
grant execute on function public.forn_agendar_portal(date,int,text,text,text,jsonb,int,jsonb) to authenticated;

commit;

-- ----------------------------------------------------------------------------
-- 6) CONFERÊNCIA
-- ----------------------------------------------------------------------------
select 'a fila existe' as o_que,
       (select count(*)::text from information_schema.tables
         where table_schema='public' and table_name='receb_barrados') as resultado
union all
select 'a fila esta trancada (RLS ligada)',
       (select case when relrowsecurity then 'sim' else 'NAO - me avise' end
          from pg_class where oid='public.receb_barrados'::regclass)
union all
select 'so a Central le (1 policy de select, nenhuma de escrita)',
       (select count(*)::text from pg_policies
         where schemaname='public' and tablename='receb_barrados')
union all
select 'a regra anota quando barra',
       (select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' and p.proname='receb_anotar_barrado')
union all
select 'ninguem de fora anota',
       (select case when has_function_privilege('authenticated',
                 'public.receb_anotar_barrado(uuid,text,text,text)', 'execute')
                    then 'ABERTA - me avise' else 'fechada' end)
union all
select 'fornecedores travados agora',
       (select count(*)::text from public.receb_barrados);
