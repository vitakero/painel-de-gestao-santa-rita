-- ============================================================================
-- CONFERIR O QUE JA RODOU
--
-- Cole isto no SQL Editor e rode. Ele nao muda NADA — so olha e responde.
--
-- E UMA CONSULTA SO, de proposito: o editor do Supabase mostra apenas o resultado
-- da ULTIMA consulta do arquivo. Em duas consultas, a primeira some da tela — e era
-- justamente ela que respondia "eu ja rodei aquele SQL?".
--
-- Existe porque de fora do banco nao da para ver se uma funcao mudou por dentro:
-- o catalogo do Postgres nao fica exposto na internet, e ainda bem.
-- ============================================================================
with f as (
  -- conto os argumentos em vez de comparar a lista escrita: o Postgres devolve
  -- "p_id uuid, p_status text" (com os nomes), e nao "uuid, text". Comparar texto
  -- aqui deu um "FALTA RODAR" falso em 21/08/2026, num SQL que ja tinha rodado.
  select p.proname, p.prosrc, p.pronargs
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
),
t as (select table_name from information_schema.tables where table_schema='public'),
loc as (select * from public.receb_locais order by criado_em limit 1)

select secao, item, resposta from (

  -- ---------------------------------------------------------------- os SQLs
  select 1 as ordem, '1) SQL' as secao, 'Portal recusa cedo' as item,
         case when exists (select 1 from f where proname='forn_checar_agendamento')
              then 'JA RODOU' else 'FALTA RODAR -> receb_c23_recusar_cedo.sql' end as resposta

  union all select 2, '1) SQL', 'Doca pode recusar entrega',
         case when exists (select 1 from f where proname='ent_definir_status' and pronargs=3)
              then 'JA RODOU' else 'FALTA RODAR -> receb_c24_doca_e_pendente.sql' end

  union all select 3, '1) SQL', 'Pendente solta o horario',
         case when exists (select 1 from f where proname='ent_expirar_pendentes')
              then 'JA RODOU' else 'FALTA RODAR -> receb_c24_doca_e_pendente.sql' end

  union all select 4, '1) SQL', 'Porta anonima fechada',
         case when not has_function_privilege('anon',
                'public.ent_solicitar(text,text,text,date,integer,text,text,text)', 'execute')
              then 'JA RODOU' else 'FALTA RODAR (URGENTE) -> receb_c25_fechar_porta_de_novo.sql' end

  union all select 5, '1) SQL', 'Loja ve quem esta travado no portal',
         case when exists (select 1 from t where table_name='receb_barrados')
              then 'JA RODOU' else 'FALTA RODAR -> receb_c26_barrados.sql' end

  union all select 6, '1) SQL', 'Notas da Receita (etapa 2B)',
         case when exists (select 1 from t where table_name='receb_notas_vr')
              then 'JA RODOU' else 'FALTA RODAR -> receb_c27_notas_da_receita.sql' end

  union all select 7, '1) SQL', 'Duvida separada de acusacao',
         case when exists (select 1 from f where proname='forn_conferir_nota' and prosrc like '%indefinido%')
              then 'JA RODOU' else 'FALTA RODAR -> receb_c28_sem_como_casar.sql' end

  -- ------------------------------------------------------- os ajustes da loja
  union all select 8, '2) AJUSTES', 'Cobranca de descarga',
         (select case when cobranca_ativa
                      then 'LIGADA - R$ ' || cobranca_valor_agenda || ' + R$ ' ||
                           cobranca_valor_tonelada || '/tonelada'
                      else 'desligada' end from loc)

  union all select 9, '2) AJUSTES', 'Prazo do pedido pendente',
         (select coalesce(pendente_vence_horas::text || ' horas',
                          'so quando o horario passa') from loc)

  union all select 10, '2) AJUSTES', 'Barrar pela copia da Receita',
         (select case when nf_receita_barra then 'LIGADO'
                      else 'desligado - so avisa a loja' end from loc)

  -- comparo como TEXTO porque a coluna pode ser lista de numeros ou jsonb, e os dias
  -- vao de 1 a 7: nao ha "6" escondido dentro de outro numero.
  union all select 11, '2) AJUSTES', 'Dias que a loja recebe',
         (select case when dias_semana::text ~ '(^|[^0-9])6([^0-9]|$)'
                      then 'inclui sabado' else 'segunda a sexta' end from loc)

  union all select 12, '2) AJUSTES', 'Horario',
         (select abre::text || ' as ' || fecha::text from loc)

  union all select 13, '2) AJUSTES', 'Pontos de descarga cadastrados',
         (select count(*)::text from public.receb_docas where ativa)

  union all select 14, '2) AJUSTES', 'Notas da Receita ja na nuvem',
         (select count(*)::text from public.receb_notas_vr)

) x order by ordem;
