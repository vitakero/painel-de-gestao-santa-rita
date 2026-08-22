-- ============================================================
-- COBRANÇAS PIX (Sicredi) — Pontos Extras
-- Fluxo: painel INSERE o pedido (status 'pedido') -> robô gera o boleto
-- híbrido no Sicredi e grava qr_code/txid/nosso_numero (status 'gerado')
-- -> robô concilia os liquidados por dia e marca 'pago'.
-- Cancelamento: painel marca 'cancelar' -> robô dá baixa no banco -> 'cancelado'.
-- Painel só lê/insere/pede; quem fala com o banco é o robô (service key).
-- COMO USAR: colar TUDO no Supabase (SQL Editor) e clicar RUN.
-- ============================================================

-- 0) Campos do fornecedor que hoje se perdem no sync (o form pede mas a nuvem
--    não guardava): cnpj é OBRIGATÓRIO pra cobrança; os outros aproveitam a viagem.
alter table public.pontos_extras add column if not exists cnpj text;
alter table public.pontos_extras add column if not exists razao_social text;
alter table public.pontos_extras add column if not exists contato text;
alter table public.pontos_extras add column if not exists email text;
alter table public.pontos_extras add column if not exists endereco text;

-- 1) Tabela das cobranças
create table if not exists public.pix_cobrancas (
  id bigint generated always as identity primary key,
  criado_em timestamptz not null default now(),
  ponto_id text not null,                 -- id do ponto extra (painel)
  parcela_key text not null,              -- data da parcela YYYY-MM-DD
  fornecedor text,
  documento text,                         -- CPF/CNPJ do pagador (só números)
  valor numeric(14,2) not null,
  vencimento date not null,
  status text not null default 'pedido',  -- pedido | gerando | gerado | pago | erro | cancelar | cancelado
  txid text,
  nosso_numero text,
  linha_digitavel text,
  codigo_barras text,
  qr_code text,
  seu_numero text,
  erro_msg text,
  pago_em date,
  valor_liquidado numeric(14,2),
  tipo_liquidacao text,                   -- PIX | REDE | COMPE
  pedido_por text                         -- email de quem pediu no painel
);

-- 1 cobrança viva por parcela (cancelada libera pedir outra).
create unique index if not exists pix_cobrancas_parcela_unica
  on public.pix_cobrancas (ponto_id, parcela_key)
  where status <> 'cancelado';

alter table public.pix_cobrancas enable row level security;

-- Quem pode mexer: HOJE = só o MASTER (mesma regra da aba Pontos Extras, que é
-- financeiro). Quando decidirmos liberar pros funcionários, mudamos AQUI e no
-- painel juntos (a checagem de página fica de propósito fora por enquanto).
create or replace function public.pode_ver_pontos()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.perfis p
    where p.id = auth.uid() and coalesce(p.is_master, false)
  );
$$;

-- Ver as cobranças
drop policy if exists "pix_cobrancas_select" on public.pix_cobrancas;
create policy "pix_cobrancas_select" on public.pix_cobrancas
  for select to authenticated using (public.pode_ver_pontos());

-- Pedir cobrança (sempre nasce 'pedido', sem campos do banco preenchidos)
drop policy if exists "pix_cobrancas_insert" on public.pix_cobrancas;
create policy "pix_cobrancas_insert" on public.pix_cobrancas
  for insert to authenticated
  with check (
    public.pode_ver_pontos()
    and status = 'pedido'
    and txid is null and nosso_numero is null and qr_code is null
    and linha_digitavel is null and codigo_barras is null
    and pago_em is null and valor_liquidado is null
  );

-- "Tentar de novo": só mudar erro -> pedido (pode corrigir documento/valor/fornecedor,
-- mas nunca preencher campos do banco nem forjar pagamento)
drop policy if exists "pix_cobrancas_retry" on public.pix_cobrancas;
create policy "pix_cobrancas_retry" on public.pix_cobrancas
  for update to authenticated
  using (public.pode_ver_pontos() and status = 'erro')
  with check (
    public.pode_ver_pontos()
    and status = 'pedido'
    and txid is null and nosso_numero is null and qr_code is null
    and linha_digitavel is null and codigo_barras is null
    and pago_em is null and valor_liquidado is null
  );

-- "Cancelar cobrança": só mudar gerado -> cancelar (o robô faz a baixa no banco)
drop policy if exists "pix_cobrancas_cancel" on public.pix_cobrancas;
create policy "pix_cobrancas_cancel" on public.pix_cobrancas
  for update to authenticated
  using (public.pode_ver_pontos() and status = 'gerado')
  with check (public.pode_ver_pontos() and status = 'cancelar');

-- (o robô usa a service key, que passa por cima do RLS — gerando/gerado/pago/cancelado é só ele)
