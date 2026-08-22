-- ============================================================================
-- RECIBO DE PAGAMENTO COMUM — PEDIDO E AUTORIZAÇÃO
--
-- Pedido do dono em 20/08/2026. O recibo comum tem valor DIGITADO a cada vez, então
-- não podia ficar solto na mão de qualquer um. A primeira tentativa foi pedir a senha
-- do master na hora de imprimir — e ele achou o furo na mesma hora: a funcionária não
-- tem a senha do master. Ou ele ia até o computador dela digitar, ou ela ficava parada.
--
-- Agora é assim: ela PEDE, ele AUTORIZA do login dele (computador ou celular), ela
-- imprime. Decisões dele:
--   * o aviso aparece quando ele abre o painel (sem e-mail);
--   * cada autorização vale para AQUELE recibo, UMA vez.
--
-- Por que uma tabela própria e não o public.solicitacoes que já existe: aquele sistema
-- é da Central Operacional, está desligado por feature flag, não tem tela nenhuma, e
-- exige pode_pagina('operacional') — permissão que quem emite recibo não tem. Ligar
-- tudo aquilo para um recibo seria acordar um módulo inteiro fora de uso e mexer na
-- regra de permissão de outro módulo. Aqui o domínio é outro e é pequeno.
-- ============================================================================

create table if not exists public.recibos_autorizacoes (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null default public.current_tenant(),

  -- pendente -> autorizado -> impresso        (caminho normal)
  -- pendente -> recusado                      (o dono negou)
  -- pendente -> cancelado                     (quem pediu desistiu)
  status        text not null default 'pendente',

  -- O RECIBO EM SI. Fica gravado aqui e é DAQUI que o papel sai depois de autorizado —
  -- nunca do formulário na tela. Se saísse da tela, dava para pedir R$ 50, esperar o
  -- "autorizar" e trocar para R$ 500 antes de imprimir.
  data          date not null,
  valor         numeric(14,2) not null,
  quantidade    integer not null default 1,
  motivo        text not null,

  pedido_por      uuid,
  pedido_por_nome text,
  pedido_em       timestamptz not null default now(),

  decidido_por      uuid,
  decidido_por_nome text,
  decidido_em       timestamptz,
  recusa_motivo     text,

  impresso_em     timestamptz,

  constraint rcb_aut_status_ck check (status in ('pendente','autorizado','recusado','impresso','cancelado')),
  constraint rcb_aut_valor_ck  check (valor > 0),
  constraint rcb_aut_qtd_ck    check (quantidade >= 1 and quantidade <= 60),
  constraint rcb_aut_motivo_ck check (btrim(motivo) <> '')
);

-- A lista que interessa é sempre "o que está esperando", mais novo primeiro.
create index if not exists ix_rcb_aut_pendentes
  on public.recibos_autorizacoes (tenant_id, status, pedido_em desc);

alter table public.recibos_autorizacoes enable row level security;

-- LER: quem tem a página de Recibos liberada nos Acessos. O funcionário precisa ver o
-- próprio pedido para saber se já foi autorizado; o dono precisa ver todos para decidir.
drop policy if exists rcb_aut_sel on public.recibos_autorizacoes;
create policy rcb_aut_sel on public.recibos_autorizacoes for select to authenticated
  using (tenant_id = public.current_tenant() and public.pode_pagina('recibos'));

-- PEDIR: qualquer um com a página. Nasce sempre pendente e sem decisão — o with check
-- impede alguém de criar uma linha já autorizada por conta própria.
drop policy if exists rcb_aut_ins on public.recibos_autorizacoes;
create policy rcb_aut_ins on public.recibos_autorizacoes for insert to authenticated
  with check (tenant_id = public.current_tenant() and public.pode_pagina('recibos')
              and status = 'pendente' and decidido_por is null);

-- DECIDIR: só o master. É o coração da coisa — sem isto, a autorização não vale nada.
drop policy if exists rcb_aut_upd_master on public.recibos_autorizacoes;
create policy rcb_aut_upd_master on public.recibos_autorizacoes for update to authenticated
  using (tenant_id = public.current_tenant() and public.eh_master())
  with check (tenant_id = public.current_tenant() and public.eh_master());

-- MARCAR COMO IMPRESSO / CANCELAR O PRÓPRIO PEDIDO: quem pediu, e só nesses dois casos.
-- Sem esta política, ela não conseguiria nem desistir de um pedido que fez errado.
drop policy if exists rcb_aut_upd_autor on public.recibos_autorizacoes;
create policy rcb_aut_upd_autor on public.recibos_autorizacoes for update to authenticated
  using (tenant_id = public.current_tenant() and public.pode_pagina('recibos')
         and pedido_por = auth.uid() and status in ('pendente','autorizado'))
  with check (tenant_id = public.current_tenant() and public.pode_pagina('recibos')
              and pedido_por = auth.uid() and status in ('cancelado','impresso'));

-- Trava do banco contra o golpe óbvio: valor, motivo, data e quantidade NÃO mudam depois
-- que o pedido foi feito. Se pudessem, dava para pedir R$ 50, esperar o "autorizar" e
-- imprimir R$ 500. A tela já lê do registro, mas isso aqui vale mesmo se a tela mentir.
create or replace function public.rcb_aut_congela() returns trigger
language plpgsql as $$
begin
  if new.valor is distinct from old.valor
     or new.motivo is distinct from old.motivo
     or new.data is distinct from old.data
     or new.quantidade is distinct from old.quantidade then
    raise exception 'o conteudo do recibo nao pode mudar depois de pedido' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists tg_rcb_aut_congela on public.recibos_autorizacoes;
create trigger tg_rcb_aut_congela before update on public.recibos_autorizacoes
  for each row execute function public.rcb_aut_congela();
