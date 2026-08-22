-- ============================================================
-- ENTREGAS v3 · ARQUIVO 9 — A TRAVA DO DIA PASSA A EXISTIR NO SERVIDOR
--
-- Rode DEPOIS dos arquivos 1 a 8. Aditivo e idempotente.
--
-- O PROBLEMA (achado numa auditoria em 08/08/2026)
--   A regra "um dia só abre para lançamento no DIA SEGUINTE" existia só na TELA.
--   No banco:
--     - entregas_salvar_dia não conferia data nenhuma;
--     - entregas_confirmar_dia recusava só dia MAIOR que hoje, aceitando o dia de hoje.
--   Consequência: um computador com o relógio ou o fuso adiantado (um PC esquecido em UTC,
--   um celular mal configurado) abria a coluna do dia que ainda está acontecendo. A pessoa
--   preenchia, salvava, e o dia era ENCERRADO no meio da tarde — as entregas do resto do dia
--   não entram mais, e esse total congelado é o que vira dinheiro na remuneração.
--
--   A tela sozinha nunca é trava: quem decide lá é o relógio de quem abre.
--
-- O QUE MUDA
--   Só entra lançamento de dia que JÁ TERMINOU, com a data conferida no servidor, no fuso
--   America/Recife (Caicó é UTC-3 fixo). Vale para gravar, apagar e encerrar o dia.
--
--   Isso alinha o banco com a regra que o dono pediu: "só abrir o dia 7 quando for dia 8".
--   ATENÇÃO: cancela a permissão anterior de "fechar o dia à noite" do arquivo 7 — era uma
--   decisão antiga, substituída pela regra do dia seguinte.
--
-- DESFAZER: rode de novo os arquivos 2 (entregas_salvar_dia/remover_dia) e 7 (confirmar_dia).
-- ============================================================

begin;

-- Uma função só, pra regra viver num lugar e não se contradizer entre chamadas.
create or replace function public.entregas_dia_lancavel(p_ano integer, p_mes integer, p_dia integer)
returns boolean language sql stable as $$
  select make_date(p_ano, p_mes, p_dia) < (now() at time zone 'America/Recife')::date;
$$;

-- ------------------------------------------------------------
-- GRAVAR: só dia que já terminou
-- ------------------------------------------------------------
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
  perform make_date(p_ano, p_mes, p_dia);

  -- A TRAVA DO DIA, agora aqui. Antes só a tela segurava — e a tela obedece ao relógio
  -- do computador de quem abre, que pode estar adiantado.
  if not public.entregas_dia_lancavel(p_ano, p_mes, p_dia) then
    raise exception 'As entregas do dia %/% só podem ser lançadas a partir do dia seguinte.', p_dia, p_mes
      using errcode = '23514';
  end if;

  select nome, ativo into v_nome, v_ativo
    from public.entregas_equipe where id = p_entregador_id and tenant_id = v_tenant;
  if not found then raise exception 'Entregador não encontrado.' using errcode = 'P0002'; end if;

  select id into v_id from public.entregas_lancamentos
   where tenant_id = v_tenant and entregador_id = p_entregador_id
     and ano = p_ano and mes = p_mes and dia = p_dia;

  if v_id is null and not v_ativo then
    raise exception 'Este entregador está inativo. Reative antes de lançar.' using errcode = '23514';
  end if;

  if not public.entregas_marcar_intencao(p_request_id, 'salvar_dia') then
    return v_id;
  end if;

  if v_id is null then
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

-- ------------------------------------------------------------
-- ENCERRAR O DIA: mesma régua
-- ------------------------------------------------------------
create or replace function public.entregas_confirmar_dia(p_request_id uuid, p_ano integer, p_mes integer, p_dia integer)
returns void language plpgsql security definer set search_path = public as $$
declare v_t uuid; v_faltam int; v_qtd int;
begin
  v_t := public.entregas_guarda();
  if p_ano not between 2000 and 2200 or p_mes not between 1 and 12 or p_dia not between 1 and 31 then
    raise exception 'Data inválida.' using errcode='22007';
  end if;
  perform make_date(p_ano, p_mes, p_dia);

  if extract(dow from make_date(p_ano, p_mes, p_dia)) = 0 then
    raise exception 'Domingo não precisa de confirmação: a loja não abre.' using errcode='23514';
  end if;

  -- Antes aceitava o dia de HOJE ("fechar o dia à noite"). Não aceita mais: encerrar um dia
  -- que ainda está acontecendo congela o total no meio do caminho, e é esse total que vira
  -- pagamento. Um relógio adiantado bastava para causar isso.
  if not public.entregas_dia_lancavel(p_ano, p_mes, p_dia) then
    raise exception 'O dia %/% ainda não terminou. Ele só pode ser encerrado a partir do dia seguinte.', p_dia, p_mes
      using errcode='23514';
  end if;

  if public.entregas_dia_confirmado(p_ano, p_mes, p_dia) then return; end if;

  select count(*) into v_faltam
    from (select distinct l.entregador_id
            from public.entregas_lancamentos l
            join public.entregas_equipe e
              on e.id = l.entregador_id and e.tenant_id = v_t and e.ativo
           where l.tenant_id = v_t and l.ano = p_ano and l.mes = p_mes) p
   where not exists (select 1 from public.entregas_lancamentos l
                      where l.tenant_id = v_t and l.ano = p_ano and l.mes = p_mes
                        and l.dia = p_dia and l.entregador_id = p.entregador_id);

  select count(*) into v_qtd
    from public.entregas_lancamentos l
   where l.tenant_id = v_t and l.ano = p_ano and l.mes = p_mes and l.dia = p_dia;

  if v_qtd = 0 then
    raise exception 'Nenhum lançamento neste dia. Preencha antes de confirmar.' using errcode='23514';
  end if;
  if v_faltam > 0 then
    raise exception 'Faltam % entregador(es) sem valor neste dia. Quem não entregou precisa de ZERO.', v_faltam
      using errcode='23514';
  end if;

  if not public.entregas_marcar_intencao(p_request_id, 'confirmar_dia') then return; end if;

  insert into public.entregas_dias_confirmados (tenant_id, ano, mes, dia, confirmado_por)
  values (v_t, p_ano, p_mes, p_dia, auth.uid())
  on conflict (tenant_id, ano, mes, dia) do nothing;

  insert into public.eventos (event_uuid, tenant_id, tipo, entity_type, entity_id,
                              autor_id, setor, resumo, payload)
  values (gen_random_uuid(), v_t, 'entregas.dia_confirmado', 'entregas_lancamentos',
          p_ano || '-' || lpad(p_mes::text,2,'0') || '-' || lpad(p_dia::text,2,'0'),
          auth.uid(), 'Entregas',
          'Dia ' || lpad(p_dia::text,2,'0') || '/' || lpad(p_mes::text,2,'0') || ' confirmado',
          jsonb_build_object('ano',p_ano,'mes',p_mes,'dia',p_dia,'request_id',p_request_id));
end $$;

revoke all on function public.entregas_dia_lancavel(int,int,int) from public, anon;
grant execute on function public.entregas_dia_lancavel(int,int,int) to authenticated;

commit;

-- ============================================================
-- CONFERÊNCIA
-- ============================================================
select 'hoje em Caicó' as o_que, (now() at time zone 'America/Recife')::date::text as valor
union all
select 'ontem pode lançar (esperado: t)',
       public.entregas_dia_lancavel(
         extract(year  from (now() at time zone 'America/Recife')::date - 1)::int,
         extract(month from (now() at time zone 'America/Recife')::date - 1)::int,
         extract(day   from (now() at time zone 'America/Recife')::date - 1)::int)::text
union all
select 'hoje NÃO pode lançar (esperado: f)',
       public.entregas_dia_lancavel(
         extract(year  from (now() at time zone 'America/Recife')::date)::int,
         extract(month from (now() at time zone 'America/Recife')::date)::int,
         extract(day   from (now() at time zone 'America/Recife')::date)::int)::text
union all
select 'amanhã NÃO pode lançar (esperado: f)',
       public.entregas_dia_lancavel(
         extract(year  from (now() at time zone 'America/Recife')::date + 1)::int,
         extract(month from (now() at time zone 'America/Recife')::date + 1)::int,
         extract(day   from (now() at time zone 'America/Recife')::date + 1)::int)::text;
