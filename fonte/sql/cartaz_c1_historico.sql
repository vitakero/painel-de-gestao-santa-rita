-- ============================================================================
-- HISTÓRICO DE CARTAZES IMPRESSOS
--
-- Pedido do dono em 20/08/2026, com as palavras dele: "quando um funcionário
-- cria esses cartaz [...] a placa se rasga, às vezes ela mancha porque molha
-- alguma coisa, aí tem que imprimir um novo". Hoje ele teria que digitar tudo
-- de novo. Aqui fica guardado o que já foi impresso, para reimprimir UM cartaz
-- — o que rasgou — sem refazer a lista.
--
-- DECISÕES DELE:
--   * fica na NUVEM, para outro funcionário reimprimir de outro computador
--     (quem repõe a gôndola pode não ser quem montou);
--   * só entra aqui o que foi REALMENTE impresso;
--   * some quando a oferta vence.
--
-- UMA LINHA POR CARTAZ, não por leva. É um cartaz que rasga, e é um cartaz que
-- ele quer reimprimir; guardar a leva inteira num jsonb obrigaria a abrir o
-- pacote toda vez para achar um produto lá dentro.
--
-- A linha guarda TUDO que a folha precisa. Não basta o produto: o modelo, o
-- tamanho, o banner do topo, as datas e o limite por cliente moram em variáveis
-- da tela, e o rodapé é montado na hora da impressão. Se o registro não
-- guardasse isso, a reimpressão sairia com a validade da oferta que estivesse
-- aberta na tela — e o papel iria pro lixo sem ninguém entender por quê.
-- ============================================================================

create table if not exists public.cartaz_historico (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null default public.current_tenant(),

  -- o que faz a FOLHA sair igual
  modelo         text not null,            -- padrao | depor | deitado
  tamanho        text not null,            -- A1..A7
  impressao      text,                     -- multi | unica (só vale em A1/A2/A3)

  -- o que faz o CARTAZ sair igual
  oferta         text,                     -- o texto do selo (ignorado quando há banner)
  nome           text not null,
  marca          text,
  tipo           text,
  gramatura      text,
  preco          text not null,
  preco_de       text,                     -- só aparece no modelo "De / Por"

  -- o rodapé
  validade_ini   date,
  validade_fim   date not null,            -- é ela que decide quando o cartaz some
  limite_cliente integer not null default 0,

  -- o cabeçalho. Guardo o ID e o NOME: o id serve para reencontrar a arte, e o
  -- nome serve para a tela dizer qual era, mesmo que a arte tenha sido apagada.
  tema_id        text,                     -- null = selo "OFERTA" em texto
  tema_nome      text,

  -- Impressão repetida da mesma lista não vira linha nova: a assinatura é o
  -- retrato do cartaz inteiro, e a gravação é upsert. Sem isso, quem imprime
  -- duas vezes por conferência acaba com o histórico dobrado.
  assinatura     text not null,

  criado_em      timestamptz not null default now(),
  criado_por     uuid,
  criado_por_nome text,

  constraint cartaz_hist_nome_ck  check (btrim(nome) <> ''),
  constraint cartaz_hist_preco_ck check (btrim(preco) <> ''),
  -- A data de fim nunca pode ser anterior à de início. A tela já barra em três
  -- camadas; esta é a quarta, para o banco nunca guardar validade impossível.
  constraint cartaz_hist_datas_ck check (validade_ini is null or validade_fim >= validade_ini),
  constraint cartaz_hist_unica    unique (tenant_id, assinatura)
);

-- A leitura é sempre "o que ainda está valendo, mais recente primeiro".
create index if not exists ix_cartaz_hist_valendo
  on public.cartaz_historico (tenant_id, validade_fim desc, criado_em desc);

alter table public.cartaz_historico enable row level security;

-- Mesma régua do resto do painel: quem tem a página "cartaz" liberada nos
-- Acessos usa o histórico. A chave 'cartaz' já existe e já vale para
-- cartaz_temas (ver permissoes_padrao.sql).
drop policy if exists cartaz_hist_sel on public.cartaz_historico;
create policy cartaz_hist_sel on public.cartaz_historico for select to authenticated
  using (tenant_id = public.current_tenant() and public.pode_pagina('cartaz'));

drop policy if exists cartaz_hist_wr on public.cartaz_historico;
create policy cartaz_hist_wr on public.cartaz_historico for all to authenticated
  using (tenant_id = public.current_tenant() and public.pode_pagina('cartaz'))
  with check (tenant_id = public.current_tenant() and public.pode_pagina('cartaz'));
