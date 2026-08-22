-- ============================================================
-- CENTRAL OPERACIONAL — SPRINT 1.10 (mensagens NÃO LIDAS por usuário)
-- Reusa a infra existente: tabela leituras (cursor por topico/usuario) + RPC marcar_lido
-- (ambas da Sprint 0) + o Broadcast (1.1/1.9). Só adiciona:
--   1) o Broadcast passa a carregar o AUTOR (p/ o cliente NÃO contar as próprias);
--   2) RPC nao_lidas() AUTORITATIVA: conta, por tópico visível, as mensagens de OUTROS
--      mais novas que o cursor de leitura do usuário.
-- O contador incrementa no cliente pelo Broadcast (imediato, sem polling) e é reconciliado
-- pela nao_lidas() ao montar/abrir a Central/reconectar => reconexão nunca dobra.
--
-- ADITIVO. Depende de sprint0..1_9. NÃO reescreve nada. COMO USAR: rodar no Supabase (STAGING).
-- ============================================================

-- ------------------------------------------------------------
-- 1) Broadcast com AUTOR. Recria tg_eventos_broadcast (1.9) adicionando 'autor' ao payload.
--    Continua uuids opacos + tipo (SEM setor/conteúdo). O evento é só aviso; leitura = RLS.
-- ------------------------------------------------------------
create or replace function public.tg_eventos_broadcast()
returns trigger language plpgsql set search_path = public, realtime, extensions as $$
begin
  begin
    perform realtime.send(
      jsonb_build_object('id', new.id, 'topico', new.topico_id, 'tipo', new.tipo,
                         'ent', new.entity_id, 'autor', new.autor_id),
      'novo',
      'tenant:' || new.tenant_id::text || ':feed',
      false
    );
  exception when others then
    null;
  end;
  return new;
end $$;

drop trigger if exists trg_eventos_broadcast on public.eventos;
create trigger trg_eventos_broadcast
  after insert on public.eventos
  for each row execute function public.tg_eventos_broadcast();

-- ------------------------------------------------------------
-- 2) nao_lidas() — contagem AUTORITATIVA de não-lidas por tópico visível. SECURITY INVOKER
--    => RLS filtra: topico/mensagens por pode_ver_topico, leituras por usuario_id=auth.uid().
--    Conta só mensagens de OUTROS (autor <> eu) mais novas que o cursor (ultima_lida_id).
--    Sem cursor (nunca leu) => tudo de outros é não-lido. Só tópicos com >0 aparecem.
-- ------------------------------------------------------------
create or replace function public.nao_lidas()
returns table (topico_id uuid, qtd int)
language sql stable security invoker set search_path = public as $$
  select t.id as topico_id, count(m.id)::int as qtd
  from public.topico t
  join public.mensagens m on m.topico_id = t.id
  left join public.leituras l  on l.topico_id = t.id and l.usuario_id = auth.uid()
  left join public.mensagens lm on lm.id = l.ultima_lida_id
  where t.tenant_id = public.current_tenant()
    and m.removido_em is null
    and m.tipo_conteudo <> 'sistema'                                 -- avisos de sistema não geram não-lida
    and m.autor_id is distinct from auth.uid()                       -- nunca conta as próprias
    and ( l.ultima_lida_id is null                                   -- nunca leu => tudo é não-lido
          or (m.created_at, m.id) > (lm.created_at, lm.id) )         -- mais nova que o cursor (keyset)
  group by t.id;
$$;

revoke all on function public.nao_lidas() from public;
grant execute on function public.nao_lidas() to authenticated;

-- (marcar_lido(p_topico_id, p_ate_mensagem_id) da Sprint 0 é REUTILIZADA — nada a criar.)

-- ============================================================
-- ROLLBACK (desfazer só a Sprint 1.10) — descomentar se precisar:
-- drop function if exists public.nao_lidas();
-- -- restaurar tg_eventos_broadcast da Sprint 1.9 (payload sem 'autor').
-- ============================================================
