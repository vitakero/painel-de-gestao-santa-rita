-- ============================================================
-- AGENDAMENTO DE ENTREGAS (o fornecedor agenda pelo link externo)
--
-- A página do fornecedor é PÚBLICA (sem login) e usa a chave anônima.
-- Segurança: o fornecedor NÃO acessa a tabela direto — só chama 2 funções
-- travadas (ver horário livre / solicitar). Nunca lê os seus dados, nunca
-- aprova, nunca edita. Quem aprova/confere é o painel (usuário logado).
--
-- Regras iniciais: Seg-Sex, janelas de 1h das 07:00 às 17:00, 1 caminhão
-- por janela (o índice único garante isso). Fácil de ajustar depois.
--
-- ADITIVO e IDEMPOTENTE. Rode uma vez no Supabase (SQL Editor).
-- ============================================================

begin;

create table if not exists public.entregas_agendamento (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null default public.current_tenant(),
  fornecedor     text not null,                         -- empresa que o fornecedor digita
  documento      text,                                  -- CNPJ/CPF (opcional)
  contato        text,                                  -- WhatsApp/telefone (opcional)
  data           date not null,                         -- dia da entrega
  hora           time not null,                         -- início da janela (ex.: 09:00)
  pedido         text,                                  -- nº do pedido (opcional)
  descricao      text,                                  -- o que vem (opcional)
  status         text not null default 'pendente',      -- pendente/aprovado/recusado/conferido/cancelado
  origem         text not null default 'fornecedor',    -- fornecedor (link) / painel (equipe)
  aprovado_por   uuid,                                  -- perfis.id de quem aprovou
  conferido_em   timestamptz,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

create index if not exists ix_entrega_data on public.entregas_agendamento(tenant_id, data, hora);

-- 1 CAMINHÃO POR JANELA: no máx. 1 reserva ativa por (dia, hora). Barra corrida.
create unique index if not exists ux_entrega_slot
  on public.entregas_agendamento(tenant_id, data, hora)
  where status in ('pendente','aprovado','conferido');

alter table public.entregas_agendamento enable row level security;

-- LER: só usuário logado no painel (o fornecedor NUNCA lê direto).
drop policy if exists ent_sel on public.entregas_agendamento;
create policy ent_sel on public.entregas_agendamento for select to authenticated
  using (tenant_id = public.current_tenant());
-- (sem policy de insert/update pra anon: a única porta é pelas funções abaixo.)

-- ============================================================
-- FUNÇÕES PÚBLICAS (o fornecedor chama; travadas, SECURITY DEFINER)
-- ============================================================

-- Horários livres de um dia (só Seg-Sex, 07-17). Devolve SÓ hora + livre/ocupado, nada de dados.
create or replace function public.ent_horarios_livres(p_data date)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_out jsonb;
begin
  if p_data is null or p_data < current_date or p_data > current_date + 60 then return '[]'::jsonb; end if;
  if extract(isodow from p_data) > 5 then return '[]'::jsonb; end if;   -- só segunda a sexta
  select jsonb_agg(jsonb_build_object(
           'h', h,
           'hora', lpad(h::text,2,'0') || ':00',
           'livre', not exists (
              select 1 from public.entregas_agendamento e
              where e.tenant_id = public.current_tenant()
                and e.data = p_data and e.hora = make_time(h,0,0)
                and e.status in ('pendente','aprovado','conferido'))
         ) order by h)
    into v_out
    from generate_series(7,16) h;
  return coalesce(v_out, '[]'::jsonb);
end $$;

-- Solicitar agendamento. Valida tudo no servidor e grava como "pendente".
create or replace function public.ent_solicitar(
  p_fornecedor text, p_documento text, p_contato text,
  p_data date, p_hora int, p_pedido text, p_descricao text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid;
begin
  if coalesce(trim(p_fornecedor),'') = '' then return jsonb_build_object('ok',false,'erro','Informe a empresa.'); end if;
  if p_data is null or p_data < current_date or p_data > current_date + 60 then return jsonb_build_object('ok',false,'erro','Escolha uma data válida.'); end if;
  if extract(isodow from p_data) > 5 then return jsonb_build_object('ok',false,'erro','Recebemos de segunda a sexta.'); end if;
  if p_hora is null or p_hora < 7 or p_hora > 16 then return jsonb_build_object('ok',false,'erro','Horário fora do funcionamento.'); end if;
  if exists (select 1 from public.entregas_agendamento e
             where e.tenant_id = public.current_tenant() and e.data = p_data
               and e.hora = make_time(p_hora,0,0) and e.status in ('pendente','aprovado','conferido')) then
    return jsonb_build_object('ok',false,'erro','Esse horário acabou de ser reservado. Escolha outro.');
  end if;
  insert into public.entregas_agendamento(fornecedor,documento,contato,data,hora,pedido,descricao,status,origem)
  values (left(trim(p_fornecedor),120),
          nullif(left(trim(coalesce(p_documento,'')),30),''),
          nullif(left(trim(coalesce(p_contato,'')),40),''),
          p_data, make_time(p_hora,0,0),
          nullif(left(trim(coalesce(p_pedido,'')),40),''),
          nullif(left(trim(coalesce(p_descricao,'')),300),''),
          'pendente','fornecedor')
  returning id into v_id;
  return jsonb_build_object('ok',true,'id',v_id);
exception when unique_violation then
  return jsonb_build_object('ok',false,'erro','Esse horário acabou de ser reservado. Escolha outro.');
end $$;

-- ============================================================
-- FUNÇÃO DO PAINEL (usuário logado: aprovar/recusar/conferir/cancelar)
-- ============================================================
create or replace function public.ent_definir_status(p_id uuid, p_status text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
begin
  if not (public.sou_master() or public.pode_pagina('central')) then
    return jsonb_build_object('ok',false,'erro','Sem permissão.');
  end if;
  if p_status not in ('aprovado','recusado','conferido','cancelado','pendente') then
    return jsonb_build_object('ok',false,'erro','Status inválido.');
  end if;
  update public.entregas_agendamento
     set status = p_status, atualizado_em = now(),
         aprovado_por = case when p_status='aprovado' then auth.uid() else aprovado_por end,
         conferido_em = case when p_status='conferido' then now() else conferido_em end
   where id = p_id and tenant_id = public.current_tenant();
  return jsonb_build_object('ok', found);
end $$;

-- Quem pode chamar cada função:
-- 14/08/2026: o "anon" saiu desta linha DE PROPOSITO. Esta porta foi fechada no
-- agendamento_fechar_porta_anonima.sql (qualquer pessoa na internet pedia horario sem
-- se identificar e travava 60 dias de agenda). O arquivo continua rodavel, mas rodar
-- ele de novo nao pode desfazer aquela decisao.
grant execute on function public.ent_horarios_livres(date) to authenticated;
-- 14/08/2026: o "anon" saiu desta linha DE PROPOSITO. Esta porta foi fechada no
-- agendamento_fechar_porta_anonima.sql (qualquer pessoa na internet pedia horario sem
-- se identificar e travava 60 dias de agenda). O arquivo continua rodavel, mas rodar
-- ele de novo nao pode desfazer aquela decisao.
grant execute on function public.ent_solicitar(text,text,text,date,int,text,text) to authenticated;
grant execute on function public.ent_definir_status(uuid,text) to authenticated;

-- Sincroniza em tempo real com o painel (quando um fornecedor agenda, aparece na hora).
do $$ begin
  alter publication supabase_realtime add table public.entregas_agendamento;
exception when duplicate_object then null; end $$;

commit;

-- ============================================================
-- CONFERÊNCIA:
--   select * from public.entregas_agendamento order by criado_em desc;
--   select public.ent_horarios_livres(current_date + 1);  -- horários livres de amanhã
--
-- ROLLBACK:
--   drop table if exists public.entregas_agendamento cascade;
--   drop function if exists public.ent_horarios_livres(date);
--   drop function if exists public.ent_solicitar(text,text,text,date,int,text,text);
--   drop function if exists public.ent_definir_status(uuid,text);
-- ============================================================
