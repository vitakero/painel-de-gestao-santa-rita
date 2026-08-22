-- ============================================================================
-- PORTAL DO FORNECEDOR — PARTE 2: agendar estando logado
--
-- Até aqui o agendamento era anônimo: qualquer um abria o link, digitava o nome
-- da empresa na mão e pedia um horário. Funcionava, mas:
--   · o mesmo fornecedor virava três nomes diferentes ("Marilan", "MARILAN LTDA"...)
--   · ninguém conseguia ver o que tinha agendado
--   · não dava pra medir pontualidade de ninguém, porque não havia "ninguém"
--
-- Agora o fornecedor entra com login, e o agendamento nasce COM DONO.
--
-- O link antigo continua vivo de propósito: fornecedor que ainda não se
-- cadastrou continua conseguindo agendar. Os dois convivem, e o cadastrado
-- ganha o que o anônimo não tem — histórico e acompanhamento.
--
-- Rodar DEPOIS de agendamento_fornecedores.sql.
-- ============================================================================


-- ============================================================
-- 1) O AGENDAMENTO PASSA A TER DONO
-- ============================================================
alter table public.entregas_agendamento
  add column if not exists fornecedor_id uuid references public.receb_fornecedores(id);

comment on column public.entregas_agendamento.fornecedor_id is
  'Quem agendou, quando veio pelo portal. Fica nulo nos pedidos feitos pelo link anônimo antigo.';

create index if not exists ix_ent_agend_forn
  on public.entregas_agendamento (fornecedor_id, data desc);


-- ============================================================
-- 2) O FORNECEDOR LOGADO PEDE UM HORÁRIO
--
-- Diferença pro ent_solicitar antigo: aqui ele não digita empresa, documento,
-- contato nem email — isso tudo já está no cadastro dele, aprovado por você.
-- Menos campo pra errar, e o nome nunca mais sai diferente.
-- ============================================================
-- ============================================================
-- forn_agendar SAIU DAQUI — NAO recolocar.
--
-- Esta funcao foi reescrita duas vezes desde que este arquivo nasceu:
--   receb_c5_transportadora.sql  passou a guardar o CNPJ da transportadora
--   receb_c6_nota_fiscal.sql     passou a receber e conferir a nota fiscal
--
-- Se a versao antiga voltasse a rodar, o portal continuaria funcionando
-- (a chamada e compativel) mas o CNPJ da transportadora e as notas fiscais
-- passariam a ser jogados fora em silencio. Ninguem veria erro nenhum.
-- Por isso a definicao foi retirada daqui em vez de ficar desatualizada.
-- ============================================================


-- ============================================================
-- 3) O FORNECEDOR VÊ O QUE AGENDOU
--
-- Vem por função e não por leitura direta da tabela: assim ele nunca enxerga
-- linha de outro fornecedor, nem por engano de configuração.
-- ============================================================
create or replace function public.forn_minhas_entregas()
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select jsonb_agg(x order by x->>'data' desc, x->>'hora' desc)
       from (
         select jsonb_build_object(
                  'id',        e.id,
                  'data',      e.data,
                  'hora',      to_char(e.hora, 'HH24:MI'),
                  'pedido',    e.pedido,
                  'descricao', e.descricao,
                  'status',    e.status,
                  'criado_em', e.criado_em
                ) as x
           from public.entregas_agendamento e
          where e.tenant_id = public.current_tenant()
            and e.fornecedor_id = public.forn_meu_id()
            and public.forn_meu_id() is not null
          order by e.data desc, e.hora desc
          limit 60
       ) t),
    '[]'::jsonb
  );
$$;


-- ============================================================
-- 4) OS HORÁRIOS LIVRES, PRO FORNECEDOR LOGADO
--    (o ent_horarios_livres antigo continua servindo o link anônimo)
-- ============================================================
create or replace function public.forn_horarios_livres(p_data date)
returns jsonb
language sql stable security definer set search_path = public as $$
  select case
    when public.forn_meu_id() is null then '[]'::jsonb
    when p_data is null or p_data < current_date or p_data > current_date + 60 then '[]'::jsonb
    when extract(isodow from p_data) > 5 then '[]'::jsonb
    else coalesce((
      select jsonb_agg(jsonb_build_object(
               'h', h,
               'hora', lpad(h::text, 2, '0') || ':00',
               'livre', not exists (
                 select 1 from public.entregas_agendamento e
                  where e.tenant_id = public.current_tenant()
                    and e.data = p_data
                    and e.hora = make_time(h, 0, 0)
                    and e.status in ('pendente', 'aprovado', 'conferido')
               )
             ) order by h)
        from generate_series(7, 16) as h
    ), '[]'::jsonb)
  end;
$$;


-- ============================================================
-- 5) O FORNECEDOR CANCELA o que ainda não foi confirmado
-- ============================================================
create or replace function public.forn_cancelar(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_forn uuid; v_status text;
begin
  v_forn := public.forn_meu_id();
  if v_forn is null then
    return jsonb_build_object('ok', false, 'erro', 'Seu cadastro ainda não foi liberado.');
  end if;

  select status into v_status
    from public.entregas_agendamento
   where id = p_id and fornecedor_id = v_forn and tenant_id = public.current_tenant();

  if v_status is null then
    return jsonb_build_object('ok', false, 'erro', 'Agendamento não encontrado.');
  end if;
  if v_status not in ('pendente', 'aprovado') then
    return jsonb_build_object('ok', false, 'erro', 'Esse agendamento não pode mais ser cancelado. Fale com a loja.');
  end if;

  update public.entregas_agendamento
     set status = 'cancelado', atualizado_em = now()
   where id = p_id and fornecedor_id = v_forn;

  insert into public.receb_eventos (entidade, entidade_id, acao, de, para, detalhe)
  values ('entrega', v_forn, 'cancelou', v_status, 'cancelado',
          jsonb_build_object('agendamento', p_id));

  return jsonb_build_object('ok', true);
end;
$$;


-- ============================================================
-- 6) PERMISSÕES
-- ============================================================
revoke all on function public.forn_agendar(date,int,text,text)  from public;
revoke all on function public.forn_minhas_entregas()            from public;
revoke all on function public.forn_horarios_livres(date)        from public;
revoke all on function public.forn_cancelar(uuid)               from public;
grant execute on function public.forn_agendar(date,int,text,text) to authenticated;
grant execute on function public.forn_minhas_entregas()           to authenticated;
grant execute on function public.forn_horarios_livres(date)       to authenticated;
grant execute on function public.forn_cancelar(uuid)              to authenticated;


-- ============================================================
-- 7) CONFERÊNCIA
-- ============================================================
select 'coluna de dono no agendamento' as conferir,
       case when exists (
         select 1 from information_schema.columns
          where table_schema='public' and table_name='entregas_agendamento'
            and column_name='fornecedor_id'
       ) then 'SIM' else 'NAO' end as resultado
union all
select 'funcoes do portal (tem que ser 4)',
       (select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public'
           and p.proname in ('forn_agendar','forn_minhas_entregas','forn_horarios_livres','forn_cancelar'));
