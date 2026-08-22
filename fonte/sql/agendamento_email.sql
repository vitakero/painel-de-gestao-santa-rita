-- ============================================================
-- AGENDAMENTO — AVISO POR EMAIL PARA O FORNECEDOR
--
-- Rode DEPOIS de sql/agendamento_entrega.sql. Aditivo e idempotente.
-- Cole tudo no SQL Editor do Supabase e clique em RUN.
--
-- POR QUÊ
--   Hoje o fornecedor manda o pedido, vê "solicitação enviada" e some no escuro: não sabe se
--   foi aprovado, recusado, nem se alguém olhou. Ele acaba ligando pra loja — justamente o
--   telefonema que este sistema existe pra evitar.
--
-- O QUE ESTE ARQUIVO FAZ
--   1. Guarda o email do fornecedor (a tabela só tinha WhatsApp).
--   2. Cria a versão de ent_solicitar que aceita email — MANTENDO a versão antiga viva, porque
--      o formulário já publicado pode estar no cache do celular de alguém. Se a versão antiga
--      sumisse, esse alguém receberia um erro sem entender por quê.
--   3. Cria ent_para_aviso: entrega ao painel só o que o email precisa dizer, e só para quem
--      tem permissão. A função que envia o email lê daqui — nunca do que o navegador mandou —
--      pra ninguém conseguir usar o envio pra mandar mensagem escrita por fora.
--
-- DESFAZER:
--   alter table public.entregas_agendamento drop column if exists email;
--   drop function if exists public.ent_solicitar(text,text,text,date,int,text,text,text);
--   drop function if exists public.ent_para_aviso(uuid);
-- ============================================================

begin;

alter table public.entregas_agendamento
  add column if not exists email text;

comment on column public.entregas_agendamento.email is
  'Email do fornecedor, informado por ele no formulário público. Usado só para avisar da resposta.';

-- ------------------------------------------------------------
-- 1) SOLICITAR (versão com email)
-- ------------------------------------------------------------
create or replace function public.ent_solicitar(
  p_fornecedor text, p_documento text, p_contato text,
  p_data date, p_hora int, p_pedido text, p_descricao text, p_email text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid; v_email text;
begin
  if coalesce(trim(p_fornecedor),'') = '' then return jsonb_build_object('ok',false,'erro','Informe a empresa.'); end if;
  if p_data is null or p_data < current_date or p_data > current_date + 60 then return jsonb_build_object('ok',false,'erro','Escolha uma data válida.'); end if;
  if extract(isodow from p_data) > 5 then return jsonb_build_object('ok',false,'erro','Recebemos de segunda a sexta.'); end if;
  if p_hora is null or p_hora < 7 or p_hora > 16 then return jsonb_build_object('ok',false,'erro','Horário fora do funcionamento.'); end if;

  -- O email é a única forma de responder a este fornecedor. Sem ele, o pedido nasce órfão.
  v_email := lower(nullif(trim(coalesce(p_email,'')),''));
  if v_email is null then
    return jsonb_build_object('ok',false,'erro','Informe um email — é por onde avisamos se foi aprovado.');
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' then
    return jsonb_build_object('ok',false,'erro','Esse email não parece válido. Confira.');
  end if;

  if exists (select 1 from public.entregas_agendamento e
             where e.tenant_id = public.current_tenant() and e.data = p_data
               and e.hora = make_time(p_hora,0,0) and e.status in ('pendente','aprovado','conferido')) then
    return jsonb_build_object('ok',false,'erro','Esse horário acabou de ser reservado. Escolha outro.');
  end if;

  insert into public.entregas_agendamento(fornecedor,documento,contato,email,data,hora,pedido,descricao,status,origem)
  values (left(trim(p_fornecedor),120),
          nullif(left(trim(coalesce(p_documento,'')),30),''),
          nullif(left(trim(coalesce(p_contato,'')),40),''),
          left(v_email,160),
          p_data, make_time(p_hora,0,0),
          nullif(left(trim(coalesce(p_pedido,'')),40),''),
          nullif(left(trim(coalesce(p_descricao,'')),300),''),
          'pendente','fornecedor')
  returning id into v_id;
  return jsonb_build_object('ok',true,'id',v_id);
exception when unique_violation then
  return jsonb_build_object('ok',false,'erro','Esse horário acabou de ser reservado. Escolha outro.');
end $$;

-- ------------------------------------------------------------
-- 2) O QUE O AVISO PRECISA SABER
--    Devolve só os campos da mensagem, e só para quem pode decidir. A função de envio lê
--    daqui em vez de acreditar no que o navegador mandou — senão o endereço de destino e o
--    texto viriam de fora, e o envio viraria um megafone em nome da loja.
-- ------------------------------------------------------------
create or replace function public.ent_para_aviso(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare r record;
begin
  if not (public.sou_master() or public.pode_pagina('central')) then
    return jsonb_build_object('ok',false,'erro','Sem permissão.');
  end if;
  select fornecedor, email, data, hora, pedido, status
    into r
    from public.entregas_agendamento
   where id = p_id and tenant_id = public.current_tenant();
  if not found then return jsonb_build_object('ok',false,'erro','Agendamento não encontrado.'); end if;
  if coalesce(trim(r.email),'') = '' then
    return jsonb_build_object('ok',false,'erro','Este fornecedor não deixou email.');
  end if;
  return jsonb_build_object('ok',true,'fornecedor',r.fornecedor,'email',r.email,
                            'data',r.data,'hora',to_char(r.hora,'HH24:MI'),
                            'pedido',r.pedido,'status',r.status);
end $$;

-- 14/08/2026: o "anon" saiu desta linha DE PROPOSITO. Esta porta foi fechada no
-- agendamento_fechar_porta_anonima.sql (qualquer pessoa na internet pedia horario sem
-- se identificar e travava 60 dias de agenda). O arquivo continua rodavel, mas rodar
-- ele de novo nao pode desfazer aquela decisao.
grant execute on function public.ent_solicitar(text,text,text,date,int,text,text,text) to authenticated;
grant execute on function public.ent_para_aviso(uuid) to authenticated;

commit;

-- ============================================================
-- CONFERÊNCIA
-- ============================================================
select 'coluna email' as o_que,
       case when exists (select 1 from information_schema.columns
                          where table_schema='public' and table_name='entregas_agendamento'
                            and column_name='email') then 'criada' else 'FALTOU' end as valor
union all
select 'ent_solicitar com email',
       case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                          where n.nspname='public' and p.proname='ent_solicitar'
                            and p.pronargs=8) then 'criada' else 'FALTOU' end
union all
select 'ent_solicitar antiga (tem que continuar viva)',
       case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                          where n.nspname='public' and p.proname='ent_solicitar'
                            and p.pronargs=7) then 'viva' else 'SUMIU' end
union all
select 'ent_para_aviso',
       case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                          where n.nspname='public' and p.proname='ent_para_aviso')
            then 'criada' else 'FALTOU' end
union all
select 'pedidos sem email (os antigos ficam sem)',
       (select count(*)::text from public.entregas_agendamento where coalesce(trim(email),'')='');
