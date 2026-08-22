-- ============================================================================
-- CHECKPOINT 8 — o portal para de adivinhar os dados da loja
--
-- O QUE ESTAVA ERRADO:
--   1. O portal só descobria que a nota era de OUTRA empresa no fim, depois de
--      o fornecedor preencher dia e hora. O arquivo entrava na lista, ele
--      seguia confiante, e levava o "não" no último clique. A conferência
--      existia — só chegava tarde demais para ser útil.
--
--   2. O nome da loja, o endereço e o horário de recebimento estavam ESCRITOS
--      dentro da tela: "Loja Santa Rita — Caicó/RN", "das 7h às 17h". Mudar o
--      horário exigia mexer no código e publicar. O banco já guardava tudo isso
--      e ninguém lia.
--
-- Esta função devolve o que o fornecedor pode saber da loja. Nada além disso:
-- é chamada por qualquer fornecedor liberado, então não leva configuração
-- interna nem as chaves de decisão da nota.
--
-- Rodar depois de receb_c7_itens_da_nota.sql. Pode rodar de novo sem estragar.
-- ============================================================================

create or replace function public.forn_local()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.forn_meu_id() is null then jsonb_build_object('ok', false)
    else coalesce((
      select jsonb_build_object(
        'ok', true,
        'nome',     l.nome,
        'endereco', l.endereco,
        'cnpj',     nullif(regexp_replace(coalesce(l.cnpj,''), '[^0-9]', '', 'g'), ''),
        'abre',     to_char(l.abre,  'HH24:MI'),
        'fecha',    to_char(l.fecha, 'HH24:MI'),
        'dias',     l.dias_semana,
        'docas',    (select count(*) from public.receb_docas d
                      where d.local_id = l.id and d.ativa)
      )
      from public.receb_locais l
     where l.tenant_id = public.current_tenant()
     order by l.criado_em limit 1
    ), jsonb_build_object('ok', false)) end;
$$;

revoke all on function public.forn_local() from public, anon;
grant execute on function public.forn_local() to authenticated;

select 'forn_local responde' as conferir,
       case when exists (select 1 from pg_proc
                          where proname='forn_local' and pronamespace='public'::regnamespace)
            then 'SIM' else 'NAO' end as resultado
union all
select 'CNPJ da loja que ela devolve',
       coalesce((select regexp_replace(cnpj,'[^0-9]','','g') from public.receb_locais
                  order by criado_em limit 1), 'VAZIO')
union all
select 'horario de recebimento',
       (select to_char(abre,'HH24:MI')||' as '||to_char(fecha,'HH24:MI')
          from public.receb_locais order by criado_em limit 1);
