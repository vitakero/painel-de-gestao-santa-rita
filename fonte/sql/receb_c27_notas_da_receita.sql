-- ============================================================================
-- ETAPA 2B — A CONFERÊNCIA PASSA A VIR DA RECEITA
--
-- O buraco: a loja decidiu em 15/08/2026 que a CHAVE de 44 números já basta para
-- agendar. Só que a chave é um número — não carrega os produtos. Então quem manda
-- só a chave passa sem conferência nenhuma, e ninguém na loja sabe o que vem dentro
-- do caminhão até ele encostar na doca. Na prática virou porta de saída: quem quer
-- escapar da conferência manda só a chave.
--
-- A descoberta de 20/08/2026 fecha esse buraco sem pedir nada ao fornecedor:
-- o VR JÁ BAIXA da Receita o XML de todas as notas de entrada, com o certificado
-- da loja. Medido: 35.889 notas desde março/2023, 100% com o XML inteiro e com os
-- produtos dentro. E chega rápido — duas notas emitidas hoje às 17:28 e 17:47
-- estavam no VR às 17:32 e 17:48. Um a cinco minutos depois da emissão, muito antes
-- do caminhão sair. Em 5.299 notas dos últimos 6 meses, NENHUMA chegou depois da
-- mercadoria.
--
-- Então: o fornecedor manda a chave, e a loja confere com a cópia da RECEITA — que
-- ele não tem como adulterar. É melhor do que o arquivo que ele mesmo enviaria.
--
-- BARRAR OU SÓ AVISAR: é regra de negócio, não é minha. Nasce em SÓ AVISAR
-- (nf_receita_barra = false): os produtos aparecem para a loja, mas ninguém é
-- barrado por causa de um arquivo que o fornecedor nem sabe que a loja tem. Vira
-- uma chave quando o Victor decidir, depois de ver funcionando com gente de verdade.
--
-- Rodar no SQL Editor do Supabase. Pode rodar mais de uma vez sem estragar nada.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) ONDE AS NOTAS DA RECEITA FICAM
--
-- O robô da loja lê a notaentradanfe do VR, abre o XML ali dentro e manda para cá só
-- o que interessa. O XML inteiro NÃO vem: são ~20 KB por nota, 35 mil notas, 700 MB
-- de arquivo que ninguém leria. Vem o cabeçalho e a lista de produtos.
-- ----------------------------------------------------------------------------
create table if not exists public.receb_notas_vr (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null default public.current_tenant(),
  chave           text not null,                 -- 44 dígitos, é ela que casa com o portal
  numero          text,
  serie           text,
  emitente_cnpj   text,                          -- quem emitiu: é por aqui que eu sei de quem é
  emitente_nome   text,
  destin_cnpj     text,
  emissao         timestamptz,                   -- quando o fornecedor emitiu
  recebido_em     timestamptz,                   -- quando o VR pegou da Receita
  valor_total     numeric(14,2),
  id_loja         int,
  itens           jsonb,                         -- [{codigo, ean, descricao, ncm, cfop, unidade, qtd, valor_unit, valor_total, pedido, item_pedido}]
  sincronizado_em timestamptz not null default now()
);

create unique index if not exists ux_receb_nota_vr on public.receb_notas_vr (tenant_id, chave);
create index if not exists ix_receb_nota_vr_cnpj on public.receb_notas_vr (tenant_id, emitente_cnpj);
create index if not exists ix_receb_nota_vr_quando on public.receb_notas_vr (tenant_id, recebido_em desc);

comment on table public.receb_notas_vr is
  'Notas de entrada que o VR baixou da Receita com o certificado da loja. Fonte da '
  'conferencia quando o fornecedor manda so a chave. O fornecedor nao le esta tabela '
  'direto - so a propria nota, pela forn_nota_da_receita.';

-- ----------------------------------------------------------------------------
-- 2) QUEM PODE VER
--
-- A loja (Central Logística) lê. O FORNECEDOR NÃO — esta tabela tem as notas de
-- todos os fornecedores, e uma delas diz quanto o concorrente cobra pelo mesmo
-- produto. Ele só alcança a própria nota, e pela função lá embaixo.
-- Sem policy de escrita: quem grava é o robô, com a chave de serviço.
-- ----------------------------------------------------------------------------
alter table public.receb_notas_vr enable row level security;

drop policy if exists rnvr_sel on public.receb_notas_vr;
create policy rnvr_sel on public.receb_notas_vr
  for select to authenticated
  using (tenant_id = public.current_tenant()
         and (public.sou_master() or public.pode_pagina('central')));

-- ----------------------------------------------------------------------------
-- 3) A CHAVE DA REGRA DE NEGÓCIO
--
-- false = a loja VÊ os produtos, mas ninguém é barrado pela cópia da Receita.
-- true  = a conferência da Receita barra igual à do arquivo que o fornecedor envia.
-- Nasce em false de propósito: barrar alguém por causa de um arquivo que ele nem
-- sabe que a loja tem é decisão do dono, não minha.
-- ----------------------------------------------------------------------------
alter table public.receb_locais
  add column if not exists nf_receita_barra boolean not null default false;

comment on column public.receb_locais.nf_receita_barra is
  'Quando a conferencia vier do XML que o VR baixou da Receita e achar problema: '
  'true = barra o agendamento; false = so mostra para a loja.';

-- ----------------------------------------------------------------------------
-- 4) O FORNECEDOR ALCANÇA A PRÓPRIA NOTA
--
-- Serve para a tela dele mostrar a conferência já ao digitar a chave, antes de
-- preencher o resto. Só devolve nota cujo EMITENTE é o CNPJ dele — a checagem é
-- feita aqui dentro, com o login, e não dá para pedir a nota de outro.
-- ----------------------------------------------------------------------------
create or replace function public.forn_nota_da_receita(p_chave text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_forn uuid; v_cnpj text; v_ch text; r record;
begin
  v_forn := public.forn_meu_id();
  if v_forn is null then
    return jsonb_build_object('ok', false, 'erro', 'Faça login novamente.');
  end if;

  v_ch := nullif(regexp_replace(coalesce(p_chave,''), '[^0-9]', '', 'g'), '');
  if v_ch is null or length(v_ch) <> 44 then
    return jsonb_build_object('ok', false, 'erro', 'Chave inválida.');
  end if;

  select regexp_replace(coalesce(cnpj,''), '[^0-9]', '', 'g') into v_cnpj
    from public.receb_fornecedores where id = v_forn;

  select * into r from public.receb_notas_vr
   where tenant_id = public.current_tenant() and chave = v_ch;

  if not found then
    -- Não é erro: pode ser nota emitida agora mesmo, que o robô ainda não trouxe.
    return jsonb_build_object('ok', true, 'achou', false);
  end if;

  -- A nota é do fornecedor logado? Se não for, ele não fica sabendo nem que existe.
  if regexp_replace(coalesce(r.emitente_cnpj,''), '[^0-9]', '', 'g') is distinct from v_cnpj then
    return jsonb_build_object('ok', true, 'achou', false);
  end if;

  return jsonb_build_object('ok', true, 'achou', true,
    'chave', r.chave, 'numero', r.numero, 'serie', r.serie,
    'emissao', r.emissao, 'valor_total', r.valor_total,
    'emitente_nome', r.emitente_nome, 'itens', coalesce(r.itens, '[]'::jsonb));
end $$;

revoke all on function public.forn_nota_da_receita(text) from public, anon;
grant execute on function public.forn_nota_da_receita(text) to authenticated;

-- ----------------------------------------------------------------------------
-- 5) OS PRODUTOS ENTRAM NO AGENDAMENTO
--
-- Aqui está o ganho de verdade. Quando o agendamento é gravado com uma chave e sem
-- produtos (porque o fornecedor mandou só a chave), os produtos da cópia da Receita
-- entram na hora. A partir daí TODO o resto do sistema enxerga o caminhão por
-- dentro sem saber de onde veio — a Central Logística, a doca, a conferência.
--
-- Só preenche quando está VAZIO: arquivo que o fornecedor enviou tem precedência,
-- porque foi ele que declarou. A cópia da Receita entra onde não havia nada.
-- ----------------------------------------------------------------------------
create or replace function public.receb_completar_notas(p_agenda uuid)
returns int language plpgsql security definer set search_path = public as $$
declare v_n int := 0;
begin
  if p_agenda is null then return 0; end if;

  update public.receb_agenda_notas n
     set itens         = v.itens,
         numero        = coalesce(n.numero, v.numero),
         serie         = coalesce(n.serie, v.serie),
         emitente_cnpj = coalesce(n.emitente_cnpj, v.emitente_cnpj),
         emitente_nome = coalesce(n.emitente_nome, v.emitente_nome),
         valor_total   = coalesce(n.valor_total, v.valor_total),
         emissao       = coalesce(n.emissao, v.emissao::date)
    from public.receb_notas_vr v
   where n.agenda_id = p_agenda
     and n.tenant_id = v.tenant_id
     and nullif(regexp_replace(coalesce(n.chave,''), '[^0-9]', '', 'g'), '') = v.chave
     and coalesce(jsonb_array_length(coalesce(n.itens, '[]'::jsonb)), 0) = 0
     and coalesce(jsonb_array_length(coalesce(v.itens, '[]'::jsonb)), 0) > 0;

  get diagnostics v_n = row_count;
  return v_n;
exception when others then
  -- completar é ganho, não obrigação: falhar aqui não pode derrubar um agendamento
  -- que já está gravado e valendo.
  return 0;
end $$;

revoke all on function public.receb_completar_notas(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 6) O GRAVAR CHAMA O COMPLETAR
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
  v_chk := public.forn_checar_agendamento(p_pedido, p_notas);
  if not coalesce((v_chk->>'ok')::boolean, false) then
    return jsonb_build_object('ok', false, 'erro', v_chk->>'erro');
  end if;

  v_tem_nota := coalesce(jsonb_array_length(coalesce(p_notas, '[]'::jsonb)), 0) > 0;

  v_res := public.forn_agendar(p_data, p_hora, p_pedido, p_descricao,
                               p_transportadora_cnpj, p_notas, p_minutos, p_carga);

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

    -- nota que veio só com a chave ganha os produtos da cópia da Receita
    perform public.receb_completar_notas(v_id);
  end if;

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
-- 7) CONFERÊNCIA
-- ----------------------------------------------------------------------------
select 'a tabela das notas da Receita existe' as o_que,
       (select count(*)::text from information_schema.tables
         where table_schema='public' and table_name='receb_notas_vr') as resultado
union all
select 'esta trancada (RLS ligada)',
       (select case when relrowsecurity then 'sim' else 'NAO - me avise' end
          from pg_class where oid='public.receb_notas_vr'::regclass)
union all
select 'so leitura, nenhuma policy de escrita',
       (select count(*)::text from pg_policies
         where schemaname='public' and tablename='receb_notas_vr')
union all
select 'o fornecedor alcanca a PROPRIA nota',
       (select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' and p.proname='forn_nota_da_receita')
union all
select 'os produtos entram no agendamento',
       (select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' and p.proname='receb_completar_notas')
union all
select 'barrar pela Receita (nasce desligado)',
       (select case when nf_receita_barra then 'LIGADO' else 'desligado - so avisa' end
          from public.receb_locais order by criado_em limit 1)
union all
select 'notas da Receita ja na nuvem',
       (select count(*)::text from public.receb_notas_vr);
