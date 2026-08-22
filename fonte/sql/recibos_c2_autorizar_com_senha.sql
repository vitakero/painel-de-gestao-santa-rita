-- ============================================================================
-- AUTORIZAR O RECIBO COM A SENHA DO MASTER, NO COMPUTADOR DE QUEM PEDIU
--
-- Como o dono descreveu (20/08/2026): "ela cria lá, aí gerar recibo, aí espera
-- autorizar. E aí ela vai falar comigo — Vitor, autorize lá o recibo — aí eu vou
-- digitar a senha e autorizo".
--
-- O PROBLEMA QUE ISSO CRIA: a política da tabela só deixa o master mudar o status.
-- Se ela clicar em Autorizar no login DELA, mesmo com a senha certa digitada, o
-- banco recusa — a sessão é dela, não dele.
--
-- A SAÍDA: estas duas funções rodam com poder próprio (security definer), mas só
-- depois de conferir a senha do master pela senha_master_ok — a mesma função que
-- protege a assinatura do contrato de ponto extra, com trava de 10 erros em 15
-- minutos. Quem já está logado como master passa sem digitar nada: seria pedir a
-- ele a própria senha.
--
-- Fica registrado QUEM estava no computador na hora, para o rastro não sumir: o
-- recibo foi autorizado com a senha do dono, mas no login da funcionária.
-- ============================================================================

create or replace function public.rcb_autorizar(p_id uuid, p_senha text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quem  uuid := auth.uid();
  v_nome  text;
  v_status text;
begin
  if v_quem is null then raise exception 'precisa_estar_logado'; end if;
  if not public.pode_pagina('recibos') then
    raise exception 'sem acesso a recibos' using errcode = '42501'; end if;

  -- Quem já é master não digita a própria senha; os outros precisam da senha dele.
  if not public.eh_master() then
    if p_senha is null or not public.senha_master_ok(p_senha) then
      raise exception 'senha do master incorreta' using errcode = '42501';
    end if;
  end if;

  select nome into v_nome from public.perfis where id = v_quem;

  -- Trava a linha e confere o estado SOB O LOCK: dois cliques rápidos não autorizam
  -- duas vezes, e o que já foi decidido não volta atrás.
  select status into v_status from public.recibos_autorizacoes
   where id = p_id and tenant_id = public.current_tenant() for update;
  if v_status is null then raise exception 'pedido nao encontrado'; end if;
  if v_status <> 'pendente' then return v_status; end if;

  update public.recibos_autorizacoes
     set status = 'autorizado',
         decidido_por = v_quem,
         decidido_por_nome = case when public.eh_master() then coalesce(v_nome,'master')
                                  else 'senha do master (no login de '||coalesce(v_nome,'—')||')' end,
         decidido_em = now()
   where id = p_id;
  return 'autorizado';
end $$;

create or replace function public.rcb_recusar(p_id uuid, p_senha text default null, p_motivo text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quem uuid := auth.uid();
  v_nome text;
  v_status text;
begin
  if v_quem is null then raise exception 'precisa_estar_logado'; end if;
  if not public.pode_pagina('recibos') then
    raise exception 'sem acesso a recibos' using errcode = '42501'; end if;
  if not public.eh_master() then
    if p_senha is null or not public.senha_master_ok(p_senha) then
      raise exception 'senha do master incorreta' using errcode = '42501';
    end if;
  end if;

  select nome into v_nome from public.perfis where id = v_quem;

  select status into v_status from public.recibos_autorizacoes
   where id = p_id and tenant_id = public.current_tenant() for update;
  if v_status is null then raise exception 'pedido nao encontrado'; end if;
  if v_status <> 'pendente' then return v_status; end if;

  update public.recibos_autorizacoes
     set status = 'recusado',
         decidido_por = v_quem,
         decidido_por_nome = case when public.eh_master() then coalesce(v_nome,'master')
                                  else 'senha do master (no login de '||coalesce(v_nome,'—')||')' end,
         decidido_em = now(),
         recusa_motivo = nullif(btrim(coalesce(p_motivo,'')), '')
   where id = p_id;
  return 'recusado';
end $$;

-- Ninguém anônimo chega aqui.
revoke all on function public.rcb_autorizar(uuid, text)        from public, anon;
revoke all on function public.rcb_recusar(uuid, text, text)    from public, anon;
grant execute on function public.rcb_autorizar(uuid, text)     to authenticated;
grant execute on function public.rcb_recusar(uuid, text, text) to authenticated;
