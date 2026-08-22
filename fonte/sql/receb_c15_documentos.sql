-- ============================================================
-- C15 — DOCUMENTOS DO AGENDAMENTO (etapa 3 do Portal do Fornecedor)
--
-- O fornecedor anexa arquivo ao agendamento: laudo, certificado, autorização,
-- o que a loja pedir. A tabela public.receb_anexos já existia desde o c1 e o
-- detalhe do agendamento já devolve a lista — faltava o caminho de envio.
--
-- O COFRE: bucket "recebimento", criado PRIVADO, 8 MB por arquivo, aceitando
-- só PDF, JPEG, PNG e WEBP. Documento de fornecedor não fica em endereço
-- público: quem quiser ver pede um link temporário.
--
-- O NOME DO ARQUIVO É GERADO AQUI, não pelo navegador. Se o fornecedor pudesse
-- escolher o caminho, ele escreveria na pasta de outro agendamento — ou por
-- cima de um arquivo que já existe. O nome que ele deu vira só rótulo na tela.
--
-- interna = false nos anexos do fornecedor. A coluna nasce true (só a loja vê)
-- de propósito, porque anexo novo deve ser fechado até alguém abrir. Mas o que
-- o PRÓPRIO fornecedor mandou ele tem que continuar vendo — senão manda de
-- novo achando que não subiu.
--
-- Pode rodar mais de uma vez sem estragar nada.
-- ============================================================


-- ============================================================
-- 1) QUEM PODE MEXER NO COFRE
--
-- O fornecedor escreve SÓ dentro da pasta do agendamento dele, e o caminho é
-- conferido contra o banco. Sem isto, bastaria trocar o caminho no envio para
-- gravar na pasta de outro fornecedor.
-- ============================================================
drop policy if exists rcb_doc_ins on storage.objects;
create policy rcb_doc_ins on storage.objects for insert to authenticated
with check (
  bucket_id = 'recebimento'
  and public.forn_meu_id() is not null
  -- o caminho é  <agenda_id>/<arquivo>  e a agenda tem que ser DELE
  and exists (
    select 1 from public.receb_agendas a
     where a.id::text = split_part(name, '/', 1)
       and a.fornecedor_id = public.forn_meu_id()
  )
);

drop policy if exists rcb_doc_sel on storage.objects;
create policy rcb_doc_sel on storage.objects for select to authenticated
using (
  bucket_id = 'recebimento'
  and (
    -- a loja vê tudo
    public.eh_master() or public.pode_pagina('central')
    -- o fornecedor vê só o que está na pasta de um agendamento dele
    or exists (
      select 1 from public.receb_agendas a
       where a.id::text = split_part(name, '/', 1)
         and a.fornecedor_id = public.forn_meu_id()
    )
  )
);

-- Apagar: só a loja. O fornecedor "remove" pela função, que apaga a LINHA e
-- deixa o arquivo — assim não dá para sumir com prova depois de a loja olhar.
drop policy if exists rcb_doc_del on storage.objects;
create policy rcb_doc_del on storage.objects for delete to authenticated
using (bucket_id = 'recebimento' and (public.eh_master() or public.pode_pagina('central')));


-- ============================================================
-- 1b) O NÚMERO DA AGENDA, VINDO DE QUALQUER UM DOS DOIS
--
-- O forn_agendar devolve ao portal o id da tabela ANTIGA
-- (entregas_agendamento), porque é lá que a escrita acontece. As funções de
-- anexo trabalham com receb_agendas. Sem traduzir, o portal pediria o caminho
-- com um número que a função não reconhece e o anexo nunca subiria.
-- ============================================================
create or replace function public.receb_agenda_qualquer_id(p_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select a.id from public.receb_agendas a
   where a.id = p_id
      or (a.origem = 'entregas_agendamento' and a.origem_id = p_id)
   limit 1;
$$;


-- ============================================================
-- 2) ONDE O ARQUIVO DEVE SER GRAVADO
--
-- O portal pergunta o caminho ANTES de enviar. Assim o nome é sempre nosso, e
-- o navegador não escolhe nada. Devolve também o limite, para a tela recusar
-- arquivo grande sem gastar a internet do fornecedor.
-- ============================================================
create or replace function public.forn_anexo_caminho(p_agenda uuid, p_nome text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_forn uuid; v_dono uuid; v_ext text; v_lim int := 8 * 1024 * 1024;
begin
  v_forn := public.forn_meu_id();
  if v_forn is null then return jsonb_build_object('ok', false, 'erro', 'Faça login novamente.'); end if;

  p_agenda := public.receb_agenda_qualquer_id(p_agenda);
  select fornecedor_id into v_dono from public.receb_agendas where id = p_agenda;
  if v_dono is null or v_dono <> v_forn then
    return jsonb_build_object('ok', false, 'erro', 'Agendamento não encontrado.');
  end if;

  -- só a extensão vem do nome dado, e só se for uma das aceitas
  v_ext := lower(regexp_replace(coalesce(p_nome, ''), '^.*\.', ''));
  if v_ext not in ('pdf', 'jpg', 'jpeg', 'png', 'webp') then
    return jsonb_build_object('ok', false, 'erro',
      'Só aceitamos PDF, JPG, PNG ou WEBP.');
  end if;

  if (select count(*) from public.receb_anexos where agenda_id = p_agenda) >= 10 then
    return jsonb_build_object('ok', false, 'erro', 'Já são 10 arquivos neste agendamento.');
  end if;

  return jsonb_build_object(
    'ok', true,
    -- pasta do agendamento + nome aleatório nosso: nunca sobrescreve, nunca
    -- vaza o nome original (que pode conter dado de outro cliente)
    'caminho', p_agenda::text || '/' || replace(gen_random_uuid()::text, '-', '') || '.' || v_ext,
    'limite', v_lim);
end;
$$;


-- ============================================================
-- 3) REGISTRAR O ARQUIVO DEPOIS DE ENVIADO
--
-- Confere que o arquivo EXISTE no cofre antes de criar a linha. Sem isso a
-- tela mostraria documento que não subiu, e a loja contaria com um papel que
-- não está lá.
-- ============================================================
create or replace function public.forn_anexo_add(
  p_agenda uuid, p_caminho text, p_nome text, p_tipo text default 'documento'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_forn uuid; v_dono uuid; v_tam int; v_id uuid;
begin
  v_forn := public.forn_meu_id();
  if v_forn is null then return jsonb_build_object('ok', false, 'erro', 'Faça login novamente.'); end if;

  p_agenda := public.receb_agenda_qualquer_id(p_agenda);
  select fornecedor_id into v_dono from public.receb_agendas where id = p_agenda;
  if v_dono is null or v_dono <> v_forn then
    return jsonb_build_object('ok', false, 'erro', 'Agendamento não encontrado.');
  end if;

  -- o caminho TEM que estar dentro da pasta deste agendamento
  if split_part(coalesce(p_caminho, ''), '/', 1) <> p_agenda::text then
    return jsonb_build_object('ok', false, 'erro', 'Caminho de arquivo inválido.');
  end if;

  select (metadata->>'size')::int into v_tam
    from storage.objects
   where bucket_id = 'recebimento' and name = p_caminho;

  if v_tam is null then
    return jsonb_build_object('ok', false, 'erro',
      'O arquivo não chegou ao cofre. Tente enviar de novo.');
  end if;

  insert into public.receb_anexos (agenda_id, tipo, nome, arquivo, tamanho, enviado_por, interna)
  values (p_agenda,
          case when p_tipo in ('documento','laudo','certificado','autorizacao','outro')
               then p_tipo else 'documento' end,
          left(coalesce(nullif(trim(p_nome), ''), 'documento'), 120),
          p_caminho, v_tam, auth.uid(),
          -- false: o que o fornecedor mandou, ele continua vendo
          false)
  returning id into v_id;

  insert into public.receb_eventos (entidade, entidade_id, acao, detalhe)
  values ('agenda', p_agenda, 'anexou',
          jsonb_build_object('nome', p_nome, 'tamanho', v_tam, 'por', 'fornecedor'));

  return jsonb_build_object('ok', true, 'id', v_id, 'tamanho', v_tam);
end;
$$;


-- ============================================================
-- 4) TIRAR DA LISTA
--
-- Apaga a LINHA, não o arquivo. Documento que a loja já olhou não deve poder
-- desaparecer do cofre por conta do fornecedor. E só sai enquanto o
-- agendamento ainda está sendo decidido.
-- ============================================================
create or replace function public.forn_anexo_tirar(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_forn uuid; v_ag uuid; v_sit text;
begin
  v_forn := public.forn_meu_id();
  if v_forn is null then return jsonb_build_object('ok', false, 'erro', 'Faça login novamente.'); end if;

  select x.agenda_id, a.situacao into v_ag, v_sit
    from public.receb_anexos x
    join public.receb_agendas a on a.id = x.agenda_id
   where x.id = p_id and a.fornecedor_id = v_forn and x.interna = false;

  if v_ag is null then return jsonb_build_object('ok', false, 'erro', 'Arquivo não encontrado.'); end if;
  if v_sit not in ('solicitada', 'confirmada') then
    return jsonb_build_object('ok', false, 'erro',
      'Este agendamento já foi encerrado; fale com a loja para trocar o documento.');
  end if;

  delete from public.receb_anexos where id = p_id;
  insert into public.receb_eventos (entidade, entidade_id, acao, detalhe)
  values ('agenda', v_ag, 'anexo_tirou', jsonb_build_object('por', 'fornecedor'));
  return jsonb_build_object('ok', true);
end;
$$;


-- ============================================================
-- 5) QUEM PODE CHAMAR
-- ============================================================
revoke all on function public.receb_agenda_qualquer_id(uuid)     from public, anon;
revoke all on function public.forn_anexo_caminho(uuid,text)      from public, anon;
revoke all on function public.forn_anexo_add(uuid,text,text,text) from public, anon;
revoke all on function public.forn_anexo_tirar(uuid)             from public, anon;
grant execute on function public.receb_agenda_qualquer_id(uuid)     to authenticated;
grant execute on function public.forn_anexo_caminho(uuid,text)      to authenticated;
grant execute on function public.forn_anexo_add(uuid,text,text,text) to authenticated;
grant execute on function public.forn_anexo_tirar(uuid)             to authenticated;


-- ============================================================
-- 6) CONFERÊNCIA
-- ============================================================
select 'o cofre e privado?' as conferir, id, public as e_publico,
       (file_size_limit/1024/1024) as limite_mb, allowed_mime_types
  from storage.buckets where id = 'recebimento';

select 'as quatro funcoes existem' as conferir, count(*) as quantas
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('forn_anexo_caminho','forn_anexo_add','forn_anexo_tirar','receb_agenda_qualquer_id');

select 'as politicas do cofre' as conferir, policyname, cmd
  from pg_policies
 where schemaname = 'storage' and tablename = 'objects'
   and policyname like 'rcb_doc%'
 order by policyname;

select 'anonimo NAO pode chamar' as conferir,
       has_function_privilege('anon','public.forn_anexo_caminho(uuid,text)','execute')       as anon_caminho,
       has_function_privilege('anon','public.forn_anexo_add(uuid,text,text,text)','execute') as anon_add,
       has_function_privilege('anon','public.forn_anexo_tirar(uuid)','execute')              as anon_tirar;
