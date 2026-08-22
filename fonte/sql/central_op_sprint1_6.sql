-- ============================================================
-- CENTRAL OPERACIONAL — SPRINT 1.6 (transformar CONVERSA em OCORRÊNCIA)
-- Reutiliza a infraestrutura existente (work_items/vinculo/eventos + RPC virar_ocorrencia).
-- ADITIVO. Depende de sprint0(atualizado)+1_1+1_2+1_3+1_5 já executados.
--
-- NÃO cria módulo de ocorrências (sem responsáveis/prioridade-UI/SLA/workflow/etc).
-- Só: garante 1 ocorrência por conversa, endurece a RPC (pode_ver_topico + idempotência
-- por tópico) e adiciona uma RPC de leitura do estado. Os eventos continuam vindo do
-- trigger existente (tg_workitems_outbox => 'ocorrencia.criada').
-- COMO USAR: rodar no Supabase (STAGING). ROLLBACK comentado no fim.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Garantia DURA de "uma ocorrência por conversa": índice único parcial.
--    (Não há dados ainda; se houvesse duplicata pré-existente, o create falharia — o que
--     é o certo: obriga limpar antes.)
-- ------------------------------------------------------------
create unique index if not exists ux_workitem_ocorrencia_topico
  on public.work_items (tenant_id, topico_id) where tipo = 'ocorrencia';

-- ------------------------------------------------------------
-- 2) RPC virar_ocorrencia — ENDURECIDA (assinatura INALTERADA).
--    Antes: só pode_pagina + idempotência por p_id (dois cliques com ids diferentes
--    criariam DUAS ocorrências). Agora:
--    - guard pode_ver_topico (embute pode_pagina('operacional'), master isento);
--    - IDEMPOTÊNCIA POR TÓPICO: se a conversa já tem ocorrência, devolve a existente;
--    - idempotência pelo p_id (retry do mesmo clique) mantida;
--    - índice único como rede contra corrida (catch unique_violation => devolve a existente);
--    - vínculo explícito conversa -> ocorrência (papel derivado_de) para o trilho de contexto.
--    Removido o insert em 'topico' (era no-op para a conversa existente e semanticamente
--    errado; nenhum outro chamador). Atômica (sem handler geral => tudo ou nada).
-- ------------------------------------------------------------
create or replace function public.virar_ocorrencia(
  p_id uuid, p_topico_id uuid, p_mensagem_id uuid, p_titulo text,
  p_descricao text default null, p_setor text default null, p_prioridade text default 'normal')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_tenant uuid := public.current_tenant(); v_exist uuid;
begin
  if not public.pode_ver_topico(p_topico_id) then
    raise exception 'sem acesso a este topico' using errcode = '42501';
  end if;

  -- idempotência por TÓPICO: no máximo uma ocorrência por conversa
  select id into v_exist from public.work_items
   where tenant_id = v_tenant and topico_id = p_topico_id and tipo = 'ocorrencia'
   limit 1;
  if v_exist is not null then return v_exist; end if;
  -- idempotência pelo p_id (retry exato do mesmo clique), escopado no tenant
  if exists (select 1 from public.work_items where id = p_id and tenant_id = v_tenant) then return p_id; end if;

  begin
    insert into public.work_items(id, tenant_id, tipo, titulo, descricao, setor, prioridade,
                                  topico_id, origem_mensagem_id, criado_por)
    values (p_id, v_tenant, 'ocorrencia',
            coalesce(nullif(btrim(p_titulo), ''), 'Ocorrência'),
            p_descricao, p_setor, coalesce(p_prioridade, 'normal'),
            p_topico_id, p_mensagem_id, auth.uid());
  exception when unique_violation then
    -- corrida: outra chamada criou a ocorrência do tópico primeiro => devolve a existente.
    -- Se não achar (violação não foi a do índice de tópico, ex.: colisão de PK), re-lança.
    select id into v_exist from public.work_items
     where tenant_id = v_tenant and topico_id = p_topico_id and tipo = 'ocorrencia' limit 1;
    if v_exist is not null then return v_exist; end if;
    raise;
  end;

  -- vínculo explícito conversa -> ocorrência
  insert into public.vinculo(tenant_id, topico_id, entity_type, entity_id, papel)
  values (v_tenant, p_topico_id, 'work_items', p_id::text, 'derivado_de')
  on conflict do nothing;

  -- vínculo da mensagem de origem, se informada (na 1.6 o cliente manda null)
  if p_mensagem_id is not null then
    insert into public.vinculo(tenant_id, topico_id, entity_type, entity_id, papel)
    values (v_tenant, p_topico_id, 'mensagens', p_mensagem_id::text, 'origem')
    on conflict do nothing;
  end if;

  return p_id;
end $$;

-- ------------------------------------------------------------
-- 3) Leitura do estado: ocorrencia_do_topico — devolve o id da ocorrência do tópico
--    (ou null). SECURITY INVOKER (RLS de work_items aplica) + guard pode_ver_topico.
--    O cliente chama ao abrir a conversa p/ mostrar "Ocorrência criada" e travar o botão.
-- ------------------------------------------------------------
create or replace function public.ocorrencia_do_topico(p_topico_id uuid)
returns uuid language plpgsql stable security invoker set search_path = public as $$
declare v_id uuid;
begin
  if not public.pode_ver_topico(p_topico_id) then
    raise exception 'sem acesso a este topico' using errcode = '42501';
  end if;
  select id into v_id from public.work_items
   where tenant_id = public.current_tenant() and topico_id = p_topico_id and tipo = 'ocorrencia'
   limit 1;
  return v_id;
end $$;

-- ------------------------------------------------------------
-- 4) Grants (padrão do projeto)
-- ------------------------------------------------------------
revoke all on function public.ocorrencia_do_topico(uuid) from public;
grant execute on function public.ocorrencia_do_topico(uuid) to authenticated;
-- re-grant por segurança (o CREATE OR REPLACE preserva, mas explicitamos):
grant execute on function public.virar_ocorrencia(uuid, uuid, uuid, text, text, text, text) to authenticated;

-- ============================================================
-- ROLLBACK (desfazer só a Sprint 1.6) — descomentar se precisar:
-- drop function if exists public.ocorrencia_do_topico(uuid);
-- drop index if exists public.ux_workitem_ocorrencia_topico;
-- -- restaurar a virar_ocorrencia da Sprint 0 (versão original) se necessário.
-- -- as ocorrências/vínculos já criados permanecem (não destrutivo).
-- ============================================================
