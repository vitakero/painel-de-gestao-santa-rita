-- ============================================================
-- Tabela GALPÕES (patrimônio pessoal do dono — pessoa física).
-- Só o master vê/edita (RLS). Espelha os pontos_extras, sem o
-- vínculo com as gôndolas da loja. Boleto/Pix (conta pessoa física)
-- entram na Etapa 2, numa conta bancária separada da loja.
-- Rode este SQL uma vez no Supabase (SQL Editor).
-- ============================================================

create table if not exists public.galpoes (
  id           text primary key,
  numero       text,                 -- Nº do galpão no estilo "número de casa": 102 A, 102 B... (casa com a planta)
  cnpj         text,
  razao_social text,
  locatario    text,                 -- "Fornecedor" (quem aluga)
  vendedor     text,
  contato      text,
  email        text,
  endereco     text,
  rg           text,                 -- RG do inquilino (vai no contrato)
  endereco_inq text,                 -- onde o INQUILINO mora (≠ endereço do galpão)
  aluguel      text,                 -- "1" | "0.5" salário mínimo | "fixo" (usa o valor em R$)
  valor        numeric default 0,    -- aluguel mensal em R$ (o que é cobrado)
  pagamento    text,                 -- Boleto / Pix / Transferência / Dinheiro
  dia_pag      int,                  -- paga até o dia N de cada mês (cláusula 2.1)
  abertura     text,                 -- abertura do contrato (YYYY-MM-DD)
  vencimento   text,                 -- vencimento do contrato (YYYY-MM-DD)
  obs          text,
  manuais      jsonb,                -- marcações de pagamento por parcela
  comprovantes jsonb,                -- comprovante de cada mensalidade (arquivo fica no Storage privado)
  contrato_url  text,                -- link do contrato anexado (arquivo fica no Storage privado)
  contrato_nome text,                -- nome do arquivo do contrato
  atualizado_em timestamptz default now()
);
-- Se a tabela já existia, garante as colunas novas:
alter table public.galpoes add column if not exists numero text;
-- se a tabela foi criada antes com numero inteiro, converte pra texto (aceita "102 A"):
alter table public.galpoes alter column numero type text using numero::text;
alter table public.galpoes add column if not exists cnpj text;
alter table public.galpoes add column if not exists razao_social text;
alter table public.galpoes add column if not exists endereco text;
alter table public.galpoes add column if not exists vendedor text;
alter table public.galpoes add column if not exists comprovantes jsonb;
-- Campos do CONTRATO de locação (17/07):
alter table public.galpoes add column if not exists rg text;           -- RG do inquilino
alter table public.galpoes add column if not exists endereco_inq text; -- onde o INQUILINO mora (≠ endereço do galpão)
alter table public.galpoes add column if not exists aluguel text;      -- "1" | "0.5" salário mínimo | "fixo" (usa o valor em R$)
alter table public.galpoes add column if not exists dia_pag int;       -- paga até o dia N de cada mês
alter table public.galpoes add column if not exists contrato_url text;
alter table public.galpoes add column if not exists contrato_nome text;

alter table public.galpoes enable row level security;

-- Só master enxerga e mexe (mesma regra dos dados financeiros sensíveis).
drop policy if exists galpoes_master_all on public.galpoes;
create policy galpoes_master_all on public.galpoes
  for all
  using (
    exists (select 1 from public.perfis p where p.id = auth.uid() and p.is_master = true)
  )
  with check (
    exists (select 1 from public.perfis p where p.id = auth.uid() and p.is_master = true)
  );

-- Sincronização em tempo real entre os aparelhos (não dá erro se já estiver ligada).
do $$ begin
  alter publication supabase_realtime add table public.galpoes;
exception when duplicate_object then null;
end $$;
