-- ============================================================================
-- OS AVISOS DO PORTAL DO FORNECEDOR — a porta no banco
--
-- Quatro e-mails que faltavam:
--   1. fornecedor se cadastrou      -> avisa a LOJA (senão o cadastro fica esperando sem ninguém saber)
--   2. loja liberou                 -> avisa o FORNECEDOR (senão ele fica clicando em "conferir de novo")
--   3. loja recusou/bloqueou        -> avisa o FORNECEDOR, com o motivo
--   4. fornecedor pediu um horário  -> avisa a LOJA
--
-- POR QUE UMA FUNÇÃO SÓ, E POR QUE ELA E NÃO O NAVEGADOR
--   A função de e-mail (Edge Function) recebe só o TIPO do aviso e um id. O destinatário e o
--   conteúdo ela busca AQUI, usando o login de quem clicou. Se o texto viesse do navegador,
--   qualquer pessoa logada poderia mandar qualquer coisa para qualquer endereço assinando como
--   o supermercado. É o mesmo desenho do ent_para_aviso, que já está no ar.
--
-- Cada evento tem sua própria trava:
--   cadastro : só devolve o cadastro de QUEM ESTÁ PEDINDO (mesmo ainda não liberado)
--   decisao  : só quem é master ou tem a página "fornecedores"
--   agendou  : só o agendamento que pertence ao fornecedor logado
--
-- Rodar DEPOIS de agendamento_portal.sql.
-- ============================================================================

create or replace function public.forn_para_aviso(p_evento text, p_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_forn uuid;
  f      record;
  e      record;
begin
  -- ---------- 1) o fornecedor acabou de se cadastrar ----------
  -- Quem chama é o próprio fornecedor, e ele ainda NÃO está liberado — por isso a busca é
  -- pela conta, e não pelo forn_meu_id(), que só responde depois da liberação.
  if p_evento = 'cadastro' then
    select c.fornecedor_id into v_forn
      from public.receb_fornecedor_contas c
     where c.user_id = auth.uid();
    if v_forn is null then
      return jsonb_build_object('ok', false, 'erro', 'Esta conta não tem cadastro.');
    end if;

    select * into f from public.receb_fornecedores where id = v_forn;
    return jsonb_build_object(
      'ok', true, 'evento', 'cadastro',
      'empresa', f.razao_social, 'cnpj', f.cnpj, 'email_fornecedor', f.email,
      'telefone', coalesce(f.telefone, ''), 'responsavel', coalesce(f.responsavel, ''),
      'para', 'loja'
    );

  -- ---------- 2 e 3) a loja decidiu ----------
  elsif p_evento = 'decisao' then
    if not (public.sou_master() or public.pode_pagina('fornecedores')) then
      return jsonb_build_object('ok', false, 'erro', 'Sem permissão.');
    end if;

    select * into f from public.receb_fornecedores
     where id = p_id and tenant_id = public.current_tenant();
    if f.id is null then
      return jsonb_build_object('ok', false, 'erro', 'Fornecedor não encontrado.');
    end if;
    if coalesce(trim(f.email), '') = '' then
      return jsonb_build_object('ok', false, 'erro', 'Este fornecedor não tem email.');
    end if;

    return jsonb_build_object(
      'ok', true, 'evento', 'decisao',
      'empresa', f.razao_social, 'cnpj', f.cnpj, 'email_fornecedor', f.email,
      'situacao', f.situacao, 'motivo', coalesce(f.motivo, ''),
      'para', 'fornecedor'
    );

  -- ---------- 4) o fornecedor pediu um horário ----------
  elsif p_evento = 'agendou' then
    v_forn := public.forn_meu_id();
    if v_forn is null then
      return jsonb_build_object('ok', false, 'erro', 'Cadastro não liberado.');
    end if;

    select * into e from public.entregas_agendamento
     where id = p_id and fornecedor_id = v_forn and tenant_id = public.current_tenant();
    if e.id is null then
      return jsonb_build_object('ok', false, 'erro', 'Agendamento não encontrado.');
    end if;

    select * into f from public.receb_fornecedores where id = v_forn;
    return jsonb_build_object(
      'ok', true, 'evento', 'agendou',
      'empresa', f.razao_social, 'cnpj', f.cnpj, 'email_fornecedor', f.email,
      'data', e.data, 'hora', to_char(e.hora, 'HH24:MI'),
      'pedido', coalesce(e.pedido, ''), 'descricao', coalesce(e.descricao, ''),
      'para', 'loja'
    );
  end if;

  return jsonb_build_object('ok', false, 'erro', 'Aviso desconhecido.');
end;
$$;

revoke all on function public.forn_para_aviso(text, uuid) from public;
grant execute on function public.forn_para_aviso(text, uuid) to authenticated;


-- ============================================================
-- O ÚLTIMO AGENDAMENTO DO FORNECEDOR
-- O portal precisa do id logo depois de agendar, pra pedir o aviso.
-- O forn_agendar não devolvia o id — devolvia só data e hora.
-- ============================================================
-- ============================================================
-- forn_agendar SAIU DAQUI — NAO recolocar.
--
-- A versao que vale esta em receb_c6_nota_fiscal.sql (6 parametros).
-- A antiga, de 4 parametros, ainda FUNCIONA se alguem rodar este arquivo
-- de novo — e e justamente esse o perigo: o portal nao daria erro, mas o
-- CNPJ da transportadora e as notas fiscais passariam a ser descartados
-- em silencio. Defeito que so aparece semanas depois, na portaria.
-- ============================================================



-- ============================================================
-- CONFERÊNCIA
-- ============================================================
select 'funcao de aviso criada' as conferir,
       case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                          where n.nspname='public' and p.proname='forn_para_aviso')
            then 'SIM' else 'NAO' end as resultado
union all
select 'forn_agendar devolve o id',
       case when pg_get_functiondef((select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                                      where n.nspname='public' and p.proname='forn_agendar' limit 1))
                 like '%returning id into v_id%'
            then 'SIM' else 'NAO' end;
