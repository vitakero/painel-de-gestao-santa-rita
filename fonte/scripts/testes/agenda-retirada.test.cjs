// AGENDA — RETIRAR CONVIDADO SEM APAGAR HISTÓRICO (Etapa I4 · 01/09/2026).
//
// Esta é a trava ESTÁTICA: ela lê o painel já construído (output/index.html) e os
// arquivos de SQL, e cobra que as decisões da I4 continuem escritas onde foram postas.
// Ela não liga em banco nenhum — quem prova comportamento é a bancada em Postgres de
// verdade (node scripts/conferir-agenda-i4.mjs, 69 checagens). As duas são necessárias:
// a bancada prova que FUNCIONA hoje; esta aqui impede que alguém desfaça amanhã sem
// perceber.
//
// A REGRA DE NEGÓCIO QUE ELA GUARDA, na frase do dono:
//     "Retirar convidado preserva histórico."
//
//   node scripts/testes/agenda-retirada.test.cjs
const fs = require("fs");
const path = require("path");
const RAIZ = path.join(__dirname, "..", "..");
const H = fs.readFileSync(path.join(RAIZ, "output", "index.html"), "utf8");
const SQL = fs.readFileSync(path.join(RAIZ, "sql", "agenda_i4_retirada.sql"), "utf8");
const CORPO = SQL.slice(0, SQL.indexOf("-- CONFERÊNCIA (rode depois"));
const RODAR = fs.readFileSync(path.join(RAIZ, "sql", "RODAR-TUDO.sql"), "utf8");
// O SQL SEM OS COMENTÁRIOS.
// Toda checagem do tipo "isto NÃO pode existir" tem que olhar aqui, e não no arquivo
// inteiro: na primeira rodada, duas delas acusaram falha por causa dos meus PRÓPRIOS
// comentários — o arquivo explica que "NÃO existe retirado_motivo" e que a trava não
// usa "pessoa_id <> auth.uid()", e o teste achou as palavras no texto explicativo.
// (Dá pra apagar de "--" até o fim da linha sem medo: não há nenhum texto entre aspas
//  com traço duplo neste SQL — conferido.)
const SEMCOM = CORPO.replace(/--[^\n]*/g, "");

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + obtido + (bate ? "" : "   (esperado: " + esperado + ")"));
  bate ? ok++ : falhou++;
}
// o pedaço de SQL de uma função só, pra cobrar coisa DENTRO dela e não no arquivo inteiro
function corpoDe(nome, ate) {
  const i = CORPO.indexOf("function public." + nome);
  if (i < 0) return "";
  const j = ate ? CORPO.indexOf(ate, i) : CORPO.length;
  return CORPO.slice(i, j > i ? j : CORPO.length);
}
console.log("\n=== Agenda I4: retirar convidado sem apagar histórico ===\n");

// ------------------------------------------------------------ as colunas e a unicidade
{
  eq("1) existe a coluna retirado_em", /add column if not exists retirado_em\s+timestamptz/.test(CORPO), "true");
  eq("2) existe a coluna retirado_por", /add column if not exists retirado_por uuid/.test(CORPO), "true");
  // se ganhar FK, apagar o perfil de quem retirou levaria (ou anularia) a prova de quem foi
  eq("3) retirado_por NÃO tem chave estrangeira",
     !/retirado_por[^;]*references/i.test(SEMCOM), "true");
  eq("4) não existe retirado_motivo (decisão do dono)", !/retirado_motivo/.test(SEMCOM), "true");
  eq("5) a trava antiga (que impedia histórico) é removida",
     /drop constraint agenda_conv_unico\b/.test(CORPO), "true");
  eq("6) e a nova unicidade vale SÓ para o convite ativo",
     /create unique index if not exists agenda_conv_unico_ativo[\s\S]{0,180}where retirado_em is null/.test(CORPO), "true");
}

// ------------------------------------------------------------ convite ATUAL = retirado_em is null
{
  eq("7) responder só mexe no convite ativo",
     /where evento_id = p_evento and pessoa_id = v_me\s*\n\s*and retirado_em is null/.test(CORPO), "true");
  eq("8) e quem foi retirado recebe a mensagem certa, não 'não é seu'",
     /raise exception 'Seu convite para este compromisso foi retirado\.'/.test(CORPO), "true");
  // sem este filtro a subconsulta escalar estoura com 21000 e derruba a carga do MÊS INTEIRO
  eq("9) o meu_status da consulta do mês olha só o ativo",
     /c2\.pessoa_id = v_me\s*\n\s*and c2\.retirado_em is null/.test(CORPO), "true");
  eq("10) o compromisso não volta pra agenda de quem foi retirado",
     /c3\.pessoa_id in \(select a\.id from alvos a\)[\s\S]{0,220}c3\.retirado_em is null/.test(CORPO), "true");
  eq("11) o convite retirado não dá mais acesso ao compromisso",
     /function public\.agenda_sou_convidado[\s\S]{0,320}c\.retirado_em is null/.test(CORPO), "true");
  eq("12) a bolinha não conta convite retirado",
     /c\.status\s*= 'aguardando'[\s\S]{0,160}c\.retirado_em is null/.test(CORPO), "true");
  eq("13) remarcar não ressuscita quem foi retirado",
     /status <> 'aguardando'\s*\n\s*and retirado_em is null/.test(CORPO), "true");
  eq("14) a porta 2 (PATCH direto) também só alcança o ativo",
     /create policy agenda_conv_upd on[\s\S]{0,260}and retirado_em is null/.test(CORPO), "true");
}

// ------------------------------------------------------------ histórico é histórico
{
  eq("15) retirada não volta atrás",
     /raise exception 'Convite retirado não volta atrás/.test(CORPO), "true");
  eq("16) linha retirada não é mais editável por ninguém",
     /raise exception 'Este convite foi retirado e ficou como histórico/.test(CORPO), "true");
  // sem isto a policy agenda_conv_upd (pessoa_id = auth.uid()) deixaria o convidado
  // se auto-retirar calado, em vez de recusar dizendo o motivo
  eq("17) só quem marcou o compromisso retira alguém",
     /raise exception 'Só quem marcou o compromisso pode retirar um convidado\.'/.test(CORPO), "true");
  eq("18) convite nasce sempre ATIVO (ninguém planta histórico falso)",
     /new\.retirado_em\s+:= null;\s*\n\s*new\.retirado_por := null;/.test(CORPO), "true");
}

// ------------------------------------------------------------ a porta do apagar
{
  eq("19) a regra de DELETE dos convites é removida",
     /drop policy if exists agenda_conv_del on public\.agenda_convidados;/.test(CORPO), "true");
  eq("20) e a permissão de DELETE também",
     /revoke delete on public\.agenda_convidados from authenticated/.test(CORPO), "true");
  // o grant de baixo NÃO pode devolver o delete que a linha de cima acabou de tirar
  eq("21) o grant final não devolve o delete",
     /grant select, insert, update on public\.agenda_convidados to authenticated/.test(CORPO), "true");
  eq("22) existe a porta de retirar pro painel usar",
     /function public\.agenda_conv_retirar\(p_evento uuid, p_pessoa uuid\)/.test(CORPO), "true");
  eq("23) e ela carimba quem retirou e quando",
     /set retirado_em = now\(\), retirado_por = v_me/.test(CORPO), "true");
  // A tranca de 31/08 tirou do dono o poder de gravar a resposta do convidado. A primeira
  // versão desta migration criava uma policy de UPDATE pro dono "só pra ele carimbar a
  // retirada" e reabria isso sem querer: em Postgres, regra permissiva vale pra LINHA
  // inteira, não pra uma coluna. Não precisa dela — a RPC é SECURITY DEFINER e passa por
  // dentro. Se alguém recriar essa policy um dia, este teste cai.
  eq("23b) o dono NÃO ganhou regra de escrita na linha do convidado",
     !/create policy [a-z_]*upd_dono/.test(SEMCOM), "true");
  eq("23c) existe exatamente UMA regra de update nos convites (a do convidado)",
     (SEMCOM.match(/create policy \S+ on public\.agenda_convidados for update/g) || []).length === 1, "true");
}

// ------------------------------------------------------------ auto-convite
{
  const regra = corpoDe("agenda_conv_regra", "-- 3) A UNICIDADE PARCIAL");
  eq("24) o dono não é convidado do próprio compromisso",
     /raise exception 'O dono do compromisso não precisa ser convidado/.test(regra), "true");
  // "pessoa_id <> auth.uid()" NÃO serve: o master editando o compromisso da Ana consegue
  // convidar a própria Ana e passa nessa regra. Medido antes de escrever a trava.
  eq("25) a trava olha o DONO (para_id), não quem está chamando",
     /select e\.para_id into v_dono from public\.agenda_eventos e where e\.id = new\.evento_id/.test(regra), "true");
  eq("26) e não caiu na armadilha do pessoa_id <> auth.uid()",
     !/pessoa_id\s*<>\s*auth\.uid\(\)/.test(regra.replace(/--[^\n]*/g, "")), "true");
}

// ------------------------------------------------------------ guarda de página e e-mail
{
  const mes = corpoDe("agenda_mes", "-- 2.3 A BOLINHA");
  eq("27) a consulta do mês exige acesso à página",
     /==I4GUARDA==[\s\S]{0,1400}public\.eh_da_casa\(\)[\s\S]{0,120}pode_pagina\('agenda'\)[\s\S]{0,120}agenda_convidavel\(v_me\)/.test(mes), "true");
  // com raise, todo funcionário sem a página abriria o painel com erro: a bolinha é
  // chamada no login de TODO MUNDO
  eq("28) e devolve vazio em vez de erro",
     /agenda_convidavel\(v_me\) \) then\s*\n\s*return;/.test(mes), "true");
  eq("29) a bolinha tem a mesma guarda",
     /select case when public\.eh_da_casa\(\)[\s\S]{0,220}then auth\.uid\(\) end as id/.test(CORPO), "true");
  eq("30) o e-mail saiu do nome do convidado",
     !/cp\.email/.test(SEMCOM), "true");
  eq("31) e do nome do dono também",
     !/dp\.email/.test(SEMCOM), "true");
  eq("32) perfil que não existe mais vira 'Pessoa removida'",
     (CORPO.match(/'Pessoa removida'/g) || []).length >= 2, "true");
  eq("33) o jsonb leva retirado/sumiu sem consulta a mais",
     /'retirado',\s*\(c\.retirado_em is not null\)/.test(CORPO) && /'sumiu',\s*\(cp\.id is null\)/.test(CORPO), "true");
  eq("34) histórico no jsonb é só do dono e do master",
     /c\.retirado_em is null or e\.para_id = v_me or v_master/.test(CORPO), "true");
}

// ------------------------------------------------------------ fuso e dono canônico
{
  const pend = corpoDe("agenda_convites_pendentes", "-- 2.4 RESPONDER");
  eq("35) a bolinha não usa mais current_date", !/current_date/.test(pend), "true");
  eq("36) e usa o dia da loja nos quatro lugares",
     (pend.match(/public\.agenda_hoje\(\)/g) || []).length >= 4, "true");
  eq("37) a consulta do mês diz que dono é o para_id, e só ele",
     /\(e\.para_id = v_me\) as sou_dono/.test(CORPO), "true");
  eq("38) e não sobrou 'para_id ou criado_por' como definição de dono",
     !/para_id = v_me or e\.criado_por = v_me/.test(SEMCOM), "true");
  eq("39) a regra de editar compromisso também virou para_id",
     /create policy agenda_upd on public\.agenda_eventos[\s\S]{0,200}para_id = auth\.uid\(\) or public\.sou_master\(\)[\s\S]{0,200}with check/.test(CORPO), "true");
}

// ------------------------------------------------------------ o painel
{
  eq("40) 'Retirar' fica na lista de convidados, não nos chips",
     /data-agretirar=/.test(H) && H.indexOf("data-agretirar") > 0, "true");
  // o chip é desenhado por agPessoa(id), que não conhece quem perdeu a página nem quem
  // foi apagado — some da tela justamente quem precisa ser retirado
  eq("41) a fileira de chips continua sem botão de retirar",
     !/agConvChipsHtml[\s\S]{0,400}data-agretirar/.test(H), "true");
  eq("42) retirar vai por RPC (o DELETE direto foi fechado no banco)",
     /rpc\("agenda_conv_retirar"/.test(H), "true");
  eq("43) o painel não apaga mais convidado",
     !/from\("agenda_convidados"\)\.delete\(\)/.test(H), "true");
  eq("44) o selo 'Retirado' existe", /ag-st ret">Retirado</.test(H), "true");
  // A caixa do motivo e IRMA da linha, nao filha: sem a classe nela tambem, o retirado
  // ficava com o nome apagado e o motivo em vermelho vivo. Pego pela previa visual.
  eq("45) a linha do retirado fica esmaecida",
     /\.ag-conv-li\.retirado[^{]*\{[^}]*opacity/.test(H), "true");
  eq("45b) e o motivo da recusa dele também",
     /\.ag-conv-rec\.retirado[^{]*\{[^}]*opacity/.test(H) &&
     /'<div class="ag-conv-rec'\+\(ret\?' retirado':''\)\+'">/.test(H), "true");
  eq("46) 'Pessoa removida' aparece quando o perfil sumiu",
     /c\.sumiu\?'<span class="ag-conv-sumiu">Pessoa removida/.test(H), "true");
  eq("47) retirado não ganha botão de remarcar",
     /\(ev\.sou_dono&&!ret\)\?\('<button[^']*data-agremarcar/.test(H), "true");
  eq("48) convidado comum não recebe a linha do retirado",
     /if\(ret && !agEhDono\(ev\)\) return "";/.test(H), "true");
  eq("49) só os convites ativos entram no formulário de editar",
     /filter\(function\(c\)\{ return !c\.retirado; \}\)/.test(H), "true");
  eq("50) o dono do compromisso não aparece na lista de convidar",
     /function agSetoresConv\(\)/.test(H) && /function agConvidaveisDo\(st\)/.test(H), "true");
  eq("51) e o dono da lista é o para_id, não quem está mexendo",
     /function agDonoForm\(\)\{ var e=agEditId\?agFindEv\(agEditId\):null; return \(e&&e\.dono_id\)\|\|agUid\(\); \}/.test(H), "true");
}

// ------------------------------------------------------------ a bomba do RODAR-TUDO
{
  // Este arquivo é de 05/08 e traz uma agenda_sel SEM o "ou eu fui convidado". Como ele
  // começava com "drop policy if exists", rodá-lo de novo apagava a regra nova e cegava
  // todo convidado, calado. Desarmado em 01/09: agora ele não sobrescreve o que existe.
  eq("52) o RODAR-TUDO não apaga mais a regra de leitura da Agenda",
     !/drop policy if exists agenda_sel on public\.agenda_eventos;/.test(RODAR), "true");
  eq("53) nem a de excluir",
     !/drop policy if exists agenda_del on public\.agenda_eventos;/.test(RODAR), "true");
  eq("54) ele só cria a regra se ela ainda não existir",
     /if exists \(select 1 from pg_policies[\s\S]{0,200}policyname='agenda_sel'\) then[\s\S]{0,200}raise notice/.test(RODAR), "true");
  eq("55) e avisa em vez de mexer",
     (RODAR.match(/NAO mexi/g) || []).length >= 2, "true");
}

console.log("\n" + ok + " OK, " + falhou + " falha(s).\n");
process.exit(falhou ? 1 : 0);
