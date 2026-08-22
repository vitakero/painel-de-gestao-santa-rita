-- ============================================================
-- RECIBOS DE DOMINGO — quem pode ver e quem pode mudar o valor
--
-- COMO USAR: colar TUDO no Supabase (SQL Editor) e clicar RUN. Rode UMA vez.
-- Aditivo e idempotente: pode rodar de novo sem estragar nada.
--
-- O QUE É
--   A aba Recibos imprime o comprovante do pagamento em dinheiro pelo trabalho no domingo.
--   Duas informações moram na tabela public.configuracoes:
--     rcb_config     -> o VALOR por pessoa que vale hoje na loja
--     rcb_historico  -> os domingos já impressos (data, valor, quantidade)
--
-- O PROBLEMA QUE ISTO RESOLVE
--   Quem entrega os recibos no domingo é o encarregado, não o dono. Então o encarregado
--   precisa LER o valor — senão abre a tela sem valor nenhum. Mas ele não pode MUDAR:
--   o valor do pagamento é decisão do dono, não de quem está no balcão.
--   Na tela o campo já aparece travado para não-master. Só que tela não é tranca: quem
--   souber mexer no navegador passa por cima. A tranca de verdade é esta aqui.
--
-- DEPOIS DE RODAR
--   Libere a página "Recibos" para o funcionário na aba Acessos. Só isso.
--
-- DESFAZER (volta ao estado de antes: configurações só do master)
--   drop policy if exists "cfg_sel" on public.configuracoes;
--   drop policy if exists "cfg_ins" on public.configuracoes;
--   drop policy if exists "cfg_upd" on public.configuracoes;
--   drop policy if exists "cfg_del" on public.configuracoes;
--   create policy "cfg_master" on public.configuracoes for all to authenticated
--     using (public.sou_master()) with check (public.sou_master());
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 0) A tabela precisa existir. Se não existir, o script para aqui em vez de
--    criar políticas no vazio e deixar você achando que configurou.
-- ------------------------------------------------------------
do $$
begin
  if to_regclass('public.configuracoes') is null then
    raise exception 'A tabela public.configuracoes não existe. Rode antes o SQL que a cria (pix_config / gl_salario já usam ela).';
  end if;
end $$;

-- ------------------------------------------------------------
-- 1) Os dois ajudantes. create or replace: se já existirem, nada muda.
-- ------------------------------------------------------------
create or replace function public.sou_master()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perfis p
                  where p.id = auth.uid() and coalesce(p.is_master, false));
$$;

-- pode_pagina('recibos') = é master, OU tem a página liberada nos Acessos.
-- (mesma função de sql/permissoes_padrao.sql; repetida aqui para este arquivo rodar sozinho)
create or replace function public.pode_pagina(chave text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.perfis p
    where p.id = auth.uid()
      and (
        coalesce(p.is_master, false)
        or (
          ',' || regexp_replace(coalesce(p.paginas::text, ''), '[][{}" ]', '', 'g') || ','
          like '%,' || chave || ',%'
        )
      )
  );
$$;

-- ------------------------------------------------------------
-- 2) As regras da tabela de configurações
--
--    A regra é por LINHA, não pela tabela inteira — é isso que permite abrir duas linhas
--    para o encarregado sem abrir pix_config e gl_salario junto.
--
--      rcb_config     LER: master ou quem tem a página · MUDAR: só master
--      rcb_historico  LER e MUDAR: master ou quem tem a página (é ele que imprime)
--      todo o resto   só master, como sempre foi
-- ------------------------------------------------------------
alter table public.configuracoes enable row level security;

do $$
declare pol record;
begin
  for pol in select policyname from pg_policies
              where schemaname='public' and tablename='configuracoes' loop
    execute format('drop policy if exists %I on public.configuracoes', pol.policyname);
  end loop;
end $$;

create policy "cfg_sel" on public.configuracoes for select to authenticated
using (
  public.sou_master()
  or (id in ('rcb_config','rcb_historico') and public.pode_pagina('recibos'))
);

-- O histórico é escrito por quem imprime. O valor, não: repare que rcb_config
-- NÃO aparece no insert nem no update fora do master. É esta ausência que é a tranca.
create policy "cfg_ins" on public.configuracoes for insert to authenticated
with check (
  public.sou_master()
  or (id = 'rcb_historico' and public.pode_pagina('recibos'))
);

create policy "cfg_upd" on public.configuracoes for update to authenticated
using (
  public.sou_master()
  or (id = 'rcb_historico' and public.pode_pagina('recibos'))
)
with check (
  public.sou_master()
  or (id = 'rcb_historico' and public.pode_pagina('recibos'))
);

-- Apagar configuração continua sendo só do dono.
create policy "cfg_del" on public.configuracoes for delete to authenticated
using ( public.sou_master() );

commit;

-- ============================================================
-- CONFERÊNCIA — o que tem que aparecer
-- ============================================================
select 'RLS ligada na tabela' as o_que,
       case when relrowsecurity then 'sim' else 'NÃO — algo deu errado' end as valor
  from pg_class where oid = 'public.configuracoes'::regclass
union all
select 'políticas criadas (esperado: 4)', count(*)::text
  from pg_policies where schemaname='public' and tablename='configuracoes'
union all
select 'função sou_master', case when to_regprocedure('public.sou_master()') is null
       then 'FALTOU' else 'ok' end
union all
select 'função pode_pagina', case when to_regprocedure('public.pode_pagina(text)') is null
       then 'FALTOU' else 'ok' end
union all
select 'valor do domingo já definido',
       coalesce((select (valor->>'valor') from public.configuracoes where id='rcb_config'),
                'ainda não — defina na aba Recibos');
