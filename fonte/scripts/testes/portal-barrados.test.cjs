// Testes dos FORNECEDORES TRAVADOS NO PORTAL (a etapa 3).
//
// O buraco que isto fecha: desde que as travas passaram a BARRAR de verdade, o
// fornecedor que erra simplesmente não consegue agendar — e a loja não ficava sabendo
// de nada. Na prática vira o telefone tocando no recebimento ("não estou conseguindo
// agendar"), com quem atende sem ter onde olhar. É o mesmo telefonema que este portal
// existe para acabar, só que com outro motivo.
//
// Repare no detalhe que decide o desenho: uma entrega torta NUNCA vira agendamento,
// porque é barrada antes. Então "a divergência chegar na loja" só pode ser a loja ver
// a TENTATIVA barrada — não existe agendamento errado para ela olhar.
//
// O que estes testes vigiam, e por quê:
//   · TODA recusa é anotada — uma que escape vira um fornecedor invisível;
//   · anotar NUNCA pode derrubar a resposta que o fornecedor está esperando;
//   · o fornecedor não lê essa tabela (ela tem o nome e o tropeço dos concorrentes);
//   · quem conseguiu agendar SAI da lista — senão ela só cresce e ninguém olha;
//   · a auditoria guarda a primeira vez, não cada tentativa.
//
//   node scripts/testes/portal-barrados.test.cjs
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..", "..");
const HTML = fs.readFileSync(path.join(RAIZ, "output", "index.html"), "utf8");
const SQL  = fs.readFileSync(path.join(RAIZ, "sql", "receb_c26_barrados.sql"), "utf8");

let ok = 0, falhou = 0;
function t(nome, cond, extra) {
  if (cond) { ok++; return; }
  falhou++; console.log("  FALHOU: " + nome + (extra ? " -> " + extra : ""));
}
const conta = (txt, agulha) => txt.split(agulha).length - 1;

// ===================================================== a fila
t("a fila existe", SQL.indexOf("create table if not exists public.receb_barrados") > 0);
// Uma linha por (fornecedor, motivo). Sem isso, um fornecedor teimoso enche a tela
// com quarenta linhas iguais e esconde os outros.
t("não repete linha para o mesmo tropeço",
  SQL.indexOf("create unique index if not exists ux_receb_barrado") > 0 &&
  SQL.indexOf("(tenant_id, fornecedor_id, md5(motivo))") > 0);
t("bater de novo soma no contador", SQL.indexOf("vezes     = public.receb_barrados.vezes + 1") > 0);
t("guarda o nome junto", SQL.indexOf("fornecedor_nome text") > 0);

// ===================================================== quem vê
t("a fila está trancada", SQL.indexOf("alter table public.receb_barrados enable row level security") > 0);
t("só a Central e o master leem",
  SQL.indexOf("public.sou_master() or public.pode_pagina('central')") > 0);
// Nenhuma policy de escrita: a única porta é a função com poder próprio.
t("ninguém escreve direto na fila", conta(SQL, "create policy") === 1,
  "achei " + conta(SQL, "create policy") + " policies");
t("a policy é só de leitura", SQL.indexOf("for select to authenticated") > 0);
t("ninguém de fora anota",
  SQL.indexOf("revoke all on function public.receb_anotar_barrado(uuid,text,text,text) from public, anon, authenticated;") > 0);

// ===================================================== toda recusa é anotada
// 7 saídas com "ok, false": 1 é o "faça login" (não há fornecedor para anotar), 1 é o
// gravar repassando a resposta da conferência (já anotada). Sobram 5 recusas de
// verdade — e as 5 têm que anotar.
t("as 5 recusas de verdade anotam",
  conta(SQL, "perform public.receb_anotar_barrado") === 5,
  "achei " + conta(SQL, "perform public.receb_anotar_barrado"));
t("o 'faça login' não tenta anotar",
  SQL.indexOf("'Faça login novamente.'") > 0 &&
  SQL.slice(SQL.indexOf("v_forn := public.forn_meu_id();"),
            SQL.indexOf("select * into f from")).indexOf("receb_anotar_barrado") < 0);

// Anotar é serviço. Se falhar, o fornecedor recebe o "não" do mesmo jeito.
const anot = SQL.slice(SQL.indexOf("function public.receb_anotar_barrado"),
                       SQL.indexOf("revoke all on function public.receb_anotar_barrado"));
t("anotar nunca derruba a resposta", anot.indexOf("exception when others then") > 0);
t("sem fornecedor ou sem motivo, não anota", anot.indexOf("if p_forn is null or coalesce(trim(p_motivo),'') = '' then return; end if;") > 0);

// ===================================================== a auditoria
// Uma linha por tentativa encheria a história de repetição. Só a primeira vez.
t("a história guarda a primeira vez", anot.indexOf("if v_novo then") > 0);
t("a história é a que já existe", anot.indexOf("insert into public.receb_eventos") > 0);
t("nenhuma tabela de auditoria nova", SQL.indexOf("create table public.receb_eventos") < 0);
t("descobre se é linha nova pelo próprio banco", anot.indexOf("returning (xmax = 0) into v_novo") > 0);

// ===================================================== sair da lista
// É isto que faz a lista significar "travado AGORA".
t("conseguiu agendar, sai da fila", SQL.indexOf("delete from public.receb_barrados") > 0);
// Só limpa depois de o agendamento dar certo — a conferência passar não prova nada.
const grav = SQL.slice(SQL.indexOf("function public.forn_agendar_portal"));
t("só limpa quando agendou de verdade",
  grav.indexOf("if coalesce((v_res->>'ok')::boolean, false) then\n    begin\n      delete from public.receb_barrados") > 0);
t("limpar não pode derrubar o agendamento",
  grav.slice(grav.indexOf("delete from public.receb_barrados")).indexOf("exception when others then null") > 0);

// ===================================================== as regras não mudaram
["Para agendar sem a nota fiscal é preciso liberação da loja",
 "precisa estar vinculada a um pedido de compra da loja",
 "produto(s) que não estão no pedido",
 "traz mais do que o pedido"].forEach(function (frase) {
  t("a mensagem continua a mesma: " + frase.slice(0, 34) + "…", SQL.indexOf(frase) > 0);
});
t("continua usando a mesma conferência de nota", SQL.indexOf("public.forn_conferir_nota(v_peds, n->'itens')") > 0);

// ===================================================== a tela
t("a Central mostra os travados", HTML.indexOf("function clBarradosBloco") > 0);
t("a Central busca a lista", HTML.indexOf('sb.from("receb_barrados")') > 0);
t("carrega junto com o resto da Central", HTML.indexOf("clBarradosLoad();") > 0);
// Sem nada, a seção some — faixa vazia é ruído numa tela que já é cheia.
t("some quando não tem ninguém travado", HTML.indexOf('if(!clBarrados.length) return "";') > 0);
// Sem permissão ou sem a tabela: some, não inventa lista.
t("erro não vira lista inventada", HTML.indexOf("if(r&&r.error){ clBarrados=[]; return; }") > 0);
t("mostra quantas vezes tentou", HTML.indexOf("' tentativas · '") > 0);
t("mostra o motivo que o fornecedor leu", HTML.indexOf("cl-barr-mot") > 0);

console.log(falhou ? ("FALHOU: " + falhou + " de " + (ok + falhou)) : ("TUDO OK: " + ok + " testes"));
process.exit(falhou ? 1 : 0);
