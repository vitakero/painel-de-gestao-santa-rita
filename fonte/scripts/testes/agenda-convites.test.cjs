// AGENDA — COMPROMISSO ENTRE SETORES (convite + aceite).
//
// O dono pediu em 31/08/2026: "qualquer setor pode marcar um compromisso com outro
// setor e aparece nas duas agendas; o convidado precisa aceitar; se recusar tem que
// falar o motivo e ser reagendado; o master vê a agenda de cada setor".
//
// Este teste guarda o que quebrou DE VERDADE durante a construção — cada bloco abaixo
// é um defeito que apareceu na bancada do navegador, não uma suposição:
//
//   1) clicar em "Adicionar" no convite APAGAVA o título e a hora já digitados
//      (o formulário inteiro era redesenhado para pintar a fileira de convidados);
//   2) remarcar para a data sugerida jogava o compromisso para outro mês, mas o
//      calendário continuava no mês velho — o compromisso "sumia" da tela;
//   3) escolher uma PESSOA sem limpar o SETOR fazia o banco devolver o setor inteiro:
//      a tela dizia "agenda de Bruno" mostrando compromisso que não era dele;
//   4) trocar de agenda zerava o dia escolhido e o formulário desaparecia;
//   5) a bolinha do menu avisava "1 convite" e não havia como achá-lo — o compromisso
//      podia estar em outro mês, e o calendário abre sempre no mês de hoje.
//
//   node scripts/testes/agenda-convites.test.cjs
const fs = require("fs");
const path = require("path");
const RAIZ = path.join(__dirname, "..", "..");
const H = fs.readFileSync(path.join(RAIZ, "output", "index.html"), "utf8");
const SQL = fs.readFileSync(path.join(RAIZ, "sql", "agenda_convites.sql"), "utf8");
const CORPO = SQL.slice(0, SQL.indexOf("-- CONFERÊNCIA"));   // sem o rodapé de conferência/rollback

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + obtido + (bate ? "" : "   (esperado: " + esperado + ")"));
  bate ? ok++ : falhou++;
}
console.log("\n=== Agenda: compromisso entre setores ===\n");

// ------------------------------------------------------------ o que o BANCO cobra sozinho
{
  eq("1) existe a tabela dos convidados", /create table if not exists public\.agenda_convidados/.test(CORPO), "true");
  eq("2) uma pessoa só entra uma vez no mesmo compromisso",
     /unique \(evento_id, pessoa_id\)/.test(CORPO), "true");
  eq("3) recusar SEM motivo é barrado pelo banco",
     /raise exception 'Escreva o motivo da recusa\.'/.test(CORPO), "true");
  eq("4) recusar SEM nova data também",
     /raise exception 'Sugira uma nova data ao recusar\.'/.test(CORPO), "true");
  // o dono disse: "se cancelar tem que falar o motivo E ser reagendado"
  eq("5) as duas cobranças valem no gatilho E na função de responder",
     (CORPO.match(/Escreva o motivo da recusa/g) || []).length >= 2, "true");
  eq("6) mudar o dia/hora derruba as confirmações",
     /if new\.data is distinct from old\.data or new\.hora is distinct from old\.hora then/.test(CORPO), "true");
  eq("7) e o gatilho está mesmo ligado na tabela dos compromissos",
     /create trigger trg_agenda_remarcou after update on public\.agenda_eventos/.test(CORPO), "true");
  eq("8) o convidado não consegue passar o convite pra outro",
     /raise exception 'Não dá pra mudar de quem é o convite\.'/.test(CORPO), "true");
  eq("9) o setor do convidado é carimbado pelo servidor, não pelo navegador",
     /new\.setor\s+:= \(select p\.setor from public\.perfis p where p\.id = new\.pessoa_id\)/.test(CORPO), "true");
}

// ------------------------------------------------------------ quem enxerga o quê
{
  eq("10) o convidado passa a ENXERGAR o compromisso",
     /create policy agenda_sel on public\.agenda_eventos[\s\S]{0,260}public\.agenda_sou_convidado\(id\)/.test(CORPO), "true");
  eq("11) convidar é só de quem é dono do compromisso",
     /create policy agenda_conv_ins[\s\S]{0,240}agenda_sou_dono\(evento_id\) or public\.sou_master\(\)/.test(CORPO), "true");
  eq("12) desconvidar também (o convidado não se apaga da lista)",
     /create policy agenda_conv_del[\s\S]{0,240}agenda_sou_dono\(evento_id\) or public\.sou_master\(\)/.test(CORPO), "true");
  eq("13) ver a agenda de outra pessoa é só do master",
     /raise exception 'Só o master pode ver a agenda de outra pessoa\.'/.test(CORPO), "true");
  eq("14) responder um convite que não é meu não passa",
     /raise exception 'Este convite não é seu\.'/.test(CORPO), "true");
  // as duas políticas se perguntam uma pela outra: sem SECURITY DEFINER isso vira laço infinito
  eq("15) os ajudantes das políticas são definer (senão a RLS entra em laço)",
     /function public\.agenda_sou_convidado\(p_evento uuid\)[\s\S]{0,160}security definer/.test(CORPO) &&
     /function public\.agenda_sou_dono\(p_evento uuid\)[\s\S]{0,160}security definer/.test(CORPO), "true");
}

// ------------------------------------------------------------ (3) PESSOA vence SETOR
{
  // Pedir alvo E setor juntos devolvia o setor inteiro, e a tela dizia que era da pessoa.
  eq("16) no banco, escolher a pessoa limpa o setor",
     /if v_alvo is not null then v_setor := null; end if;/.test(CORPO), "true");
  eq("17) e o painel nem manda os dois",
     /function agAlvoPedido\(\)[\s\S]{0,220}\{alvo:agVerAlvo,setor:null\}/.test(H), "true");
  eq("18) o painel usa esse cálculo pra carregar o mês",
     /var _q=agAlvoPedido\(\), alvo=_q\.alvo, setor=_q\.setor;/.test(H), "true");
  eq("19) escolher a mim mesmo continua sendo a minha agenda",
     /function agVendoOutro\(\)\{ return agVerAlvo\?\(agVerAlvo!==agUid\(\)\):!!agVerSetor; \}/.test(H), "true");
}

// ------------------------------------------------------------ (1) o formulário não pode se apagar
{
  eq("20) a fileira de convidados se pinta sozinha",
     /function agConvChipsPinta\(\)\{ var c=document\.getElementById\("agCChips"\)/.test(H), "true");
  eq("21) e 'Adicionar convidado' NÃO redesenha o formulário",
     /if\(agConvSel\.indexOf\(pid\)<0\) agConvSel\.push\(pid\);\s*\n\s*agConvChipsPinta\(\); return;/.test(H), "true");
  eq("22) tirar um convidado também não",
     /agConvSel=agConvSel\.filter\(function\(x\)\{ return x!==_id; \}\); agConvChipsPinta\(\);/.test(H), "true");
}

// ------------------------------------------------------------ (2) e (4) o dia e o mês na tela
{
  eq("23) remarcar leva o calendário para o mês novo",
     /var nd=agParse\(d\); agAno=nd\.getFullYear\(\); agMes=nd\.getMonth\(\);/.test(H), "true");
  eq("24) trocar de setor não zera o dia escolhido",
     /if\(vs\)\{ agVerSetor=vs\.value\|\|null; agVerAlvo=null; agEditId=null;/.test(H), "true");
  eq("25) trocar de pessoa também não",
     /if\(vp\)\{ agVerAlvo=vp\.value\|\|null; agEditId=null;/.test(H), "true");
  eq("26) e voltar pra minha agenda também não",
     /data-agvoltarmeu[\s\S]{0,90}agVerAlvo=null; agVerSetor=null; agEditId=null;/.test(H), "true");
}

// ------------------------------------------------------------ (5) achar o convite
{
  eq("27) a contagem devolve TAMBÉM a data do convite mais próximo",
     /jsonb_build_object\('n', count\(\*\)::int, 'data', min\(greatest\(e\.data, current_date\)\)\)/.test(CORPO), "true");
  eq("28) a faixa amarela avisa quantos convites esperam",
     /convite'\+\(agPend\.n>1\?'s':''\)\+'<\/b> esperando sua resposta/.test(H), "true");
  eq("29) e o 'ver' pula pro mês e pro dia do convite",
     /data-agirconvite[\s\S]{0,200}agAno=_p\.getFullYear\(\); agMes=_p\.getMonth\(\); agSel=_d;/.test(H), "true");
  eq("30) a bolinha do menu existe", H.indexOf('id="agNavBadge"') >= 0, "true");
}

// ------------------------------------------------------------ a tela pede pouco, e não quebra sem o SQL
{
  // uma pergunta por mês, trazendo só o que o painel desenha (nada de select("*"))
  eq("31) o mês inteiro vem numa pergunta só",
     /sb\.rpc\("agenda_mes",\{p_ini:ini,p_fim:fim,p_alvo:alvo\|\|null,p_setor:setor\|\|null\}\)/.test(H), "true");
  eq("32) a lista de gente pra convidar não pede a tabela de perfis",
     /sb\.rpc\("agenda_pessoas"\)/.test(H) && /from\("perfis"\)\.select\("\*"\)[\s\S]{0,80}agenda/.test(H) === false, "true");
  // o dono roda o SQL na mão: enquanto não rodar, a agenda pessoal tem que continuar de pé
  eq("33) sem o SQL novo, a agenda pessoal continua funcionando",
     /function agCloudLoadPessoal\(seq,_f,ini,fim,deFundo\)/.test(H), "true");
  eq("34) e o painel sabe diferenciar 'falta o SQL' de 'caiu a internet'",
     /function agSemParte2\(e\)/.test(H), "true");
  eq("35) olhando a agenda de outro, não aparece formulário de marcar",
     /agVendoOutro\(\)\s*\n?\s*\? \('<div class="ag-f-hint">Você está só olhando/.test(H), "true");
  eq("36) nem botão de aceitar pelos outros",
     /agConvHtml\(ev\)\+ \(agVendoOutro\(\)\?'':agRespostaHtml\(ev\)\+\(semAcoes\?'':agEvAcoes\(ev\)\)\)/.test(H), "true");
}

// ------------------------------------------------------------ o lançamento de 31/08: convidar é só do master
{
  // O dono quis lançar JÁ a agenda pessoal e segurar a reunião entre setores.
  // O que NÃO pode acontecer: sumir junto a resposta ao convite — senão o master
  // convida alguém e a pessoa não tem como aceitar.
  eq("37) o interruptor existe e está ligado",
     /var AG_CONVITE_SO_MASTER = true;/.test(H), "true");
  eq("38) e é UMA linha pra liberar depois",
     /function agPodeConvidar\(\)\{ return AG_CONVITE_SO_MASTER \? agMaster\(\) : true; \}/.test(H), "true");
  eq("39) quem não é master não vê a telinha de convidar",
     /function agConvidarHtml\(\)\{\s*\n\s*if\(!agPodeConvidar\(\)\) return "";/.test(H), "true");
  // H: o Aceitar saiu do meio do texto e virou o botão principal do rodapé
  eq("40) mas continua podendo ACEITAR o que o master mandou",
     /if\(ev\.meu_status && !meu && !olhando\)\{[\s\S]{0,400}data-agaceitar/.test(H), "true");
  eq("41) e RECUSAR com motivo",
     /agRespostaHtml[\s\S]{0,900}data-agrecusaok/.test(H), "true");
  eq("42) a resposta ao convite NÃO passa pelo interruptor",
     /agRespostaHtml\(ev\)\{[\s\S]{0,120}agPodeConvidar/.test(H), "false");
  eq("43) quem não convida nem é master não baixa a lista de gente",
     /if\(!agPodeConvidar\(\) && !agMaster\(\)\) return;/.test(H), "true");
}

// ------------------------------------------------------------ o que a revisão adversarial pegou (31/08)
{
  // Uma revisão de 128 agentes leu este módulo antes de virar produção. Cada bloco
  // abaixo é um achado que sobreviveu a três céticos tentando derrubá-lo — e que eu
  // confirmei lendo o código (dois deles eu provei no banco de verdade).
  eq("44) o convite que falha NÃO passa por sucesso",
     /if\(r\.error\) throw new Error\(r\.error\.message\|\|"o banco recusou"\);/.test(H), "true");
  eq("45) nem quando o banco devolve zero linhas",
     /if\(r\.data && r\.data\.length===0\) throw new Error\("sem permissão"\);/.test(H), "true");
  // o aviso ia pro cantinho do formulário e o recarregamento apagava ele em seguida
  eq("46) e o aviso vai numa janela, que o redesenho não apaga",
     /titulo:"O convite não foi enviado"/.test(H), "true");
  // "deFundo" = o redesenho veio sozinho (realtime, contagem de convites). Só esses
  // esperam a pessoa sair do campo — o clique DELA tem que desenhar na hora, senão
  // clicar num compromisso com o cursor no formulário não abre nada.
  eq("47) o que chega de fundo não redesenha por baixo de quem digita",
     /if\(deFundo && agMexendoNoPainel\(\)\)\{ agRedesenhoPreso=true; return; \}/.test(H), "true");
  eq("47b) mas o clique da pessoa desenha na hora",
     /agJanAbre\(tipo\)\{[\s\S]{0,700}agRenderDia\(\);/.test(H), "true");
  eq("48) e o desenho preso tem DUAS saídas (focusout e clique)",
     /pn\.addEventListener\("focusout",agSoltaDesenho\);\s*\n\s*document\.addEventListener\("click",agSoltaDesenho\);/.test(H), "true");
  eq("49) dá pra mudar o DIA sem apagar e refazer", /class="ag-f-dia"/.test(H), "true");
  // (a checagem antiga olhava só a EDIÇÃO; desde a Etapa 0 a mesma linha cobre também a
  //  CRIAÇÃO em outro dia — ver 105e)
  eq("50) e o calendário acompanha o dia novo",
     /var _destino = id \? \(\(dia&&evAntes&&dia!==evAntes\.data\)\?dia:""\)/.test(H), "true");
  eq("51) excluir série avisa que apaga TODAS as vezes",
     /Excluir apaga TODAS as vezes, inclusive as que já passaram/.test(H), "true");
  eq("52) excluir avisa quando o banco recusa", /titulo:"Não deu pra excluir"/.test(H), "true");
  eq("53) remarcar também", /titulo:"Não deu pra remarcar"/.test(H), "true");
  eq("54) e o Aceitar trava enquanto pensa e avisa se falhar",
     /ac\.disabled=true; ac\.textContent="Aceitando\.\.\.";/.test(H) && /titulo:"Não deu pra aceitar"/.test(H), "true");
}

// ------------------------------------------------------------ as portas que o SQL de tranca fecha
{
  const T = fs.readFileSync(path.join(RAIZ, "sql/agenda_trancar.sql"), "utf8");
  eq("55) a lista de gente exige ser da CASA",
     /where public\.eh_da_casa\(\)\s*\n\s*and public\.pode_pagina\('agenda'\)/.test(T), "true");
  eq("56) e parou de vazar e-mail",
     /coalesce\(nullif\(btrim\(p\.nome\),''\), 'Sem nome'\)/.test(T) && /p\.email/.test(T) === false, "true");
  eq("57) convidar exige ser da casa e ter a página",
     /create policy agenda_conv_ins[\s\S]{0,300}public\.eh_da_casa\(\)[\s\S]{0,80}public\.pode_pagina\('agenda'\)/.test(T), "true");
  // A checagem "o convidado é da loja" NÃO pode morar dentro da regra: lá ela roda com
  // a permissão de quem chama, e o funcionário comum não enxerga a ficha dos outros —
  // foi assim que a tranca reprovou convite legítimo. Tem que ser função "por dentro".
  const T2 = fs.readFileSync(path.join(RAIZ, "sql/agenda_trancar_c2.sql"), "utf8");
  eq("58) só dá pra convidar gente da loja — e a checagem é 'por dentro'",
     /function public\.agenda_convidavel\(p_pessoa uuid\)[\s\S]{0,200}security definer/.test(T2), "true");
  eq("58b) e a regra chama a função, sem consultar perfis dentro dela",
     /create policy agenda_conv_ins[\s\S]{0,400}public\.agenda_convidavel\(pessoa_id\)/.test(T2)
     && /create policy agenda_conv_ins[\s\S]{0,400}from public\.perfis/.test(T2) === false, "true");
  eq("58c) e a tranca antiga avisa que sozinha quebra o convite",
     /RODE TAMBÉM sql\/agenda_trancar_c2\.sql/.test(T), "true");
  eq("59) 'dono' virou só 'de quem é', sem o criado_por",
     /where e\.id = p_evento and e\.para_id = auth\.uid\(\)\);/.test(T), "true");
  eq("60) e a resposta do convite é só do convidado",
     /create policy agenda_conv_upd[\s\S]{0,200}using *\( tenant_id = public\.current_tenant\(\) and pessoa_id = auth\.uid\(\) \)/.test(T), "true");
  // o arquivo original não pode ficar parecendo seguro sozinho
  const C = fs.readFileSync(path.join(RAIZ, "sql/agenda_convites.sql"), "utf8");
  eq("61) o SQL original avisa que sozinho deixa porta aberta",
     /RODE TAMBÉM sql\/agenda_trancar\.sql/.test(C), "true");
}

// ------------------------------------------------------------ o painel do dia (pedido do dono, 31/08)
{
  // Ele olhou a tela e disse: a lista de compromissos em cima "fica ruim, melhor deixar
  // só no calendário". A lista repetia o que a grade já mostra e empurrava o formulário
  // pra baixo. Tirar sem mais nada deixaria a pessoa sem Editar/Excluir — por isso o
  // compromisso passou a ABRIR pelo clique no calendário.
  eq("65) o compromisso do calendário é clicável", /data-agabrir="'\+ev\.id\+'"/.test(H), "true");
  eq("66) clicar nele abre o compromisso no painel",
     /agAbertoId = chip \? chip\.getAttribute\("data-agabrir"\) : null;/.test(H), "true");
  /* H: o "‹ voltar" de um compromisso aberto levava pro formulário de criar OUTRO — quem
     clicou em voltar queria fechar. Agora fechar é fechar, e o caminho é explícito. */
  eq("67) e existe um jeito claro de sair", /data-agfecharjan/.test(H), "true");
  eq("68) sem nada aberto, o painel é só o formulário",
     /meio = soOlhando;   \/\/ agFormHtml\(\)/.test(H), "true");
  eq("69) o '+N mais' ainda dá pra ver o dia inteiro, sob demanda",
     /data-agtodos="'\+key\+'"/.test(H) && /agVerTodos = !!todos;/.test(H), "true");
  eq("70) trocar de dia fecha o que estava aberto",
     /agAbertoId = chip \? /.test(H) && /function limpaVer\(\)\{ agSel=null;[\s\S]{0,120}agAbertoId=null; agVerTodos=false; \}/.test(H), "true");
}

// ------------------------------------------------------------ hora de começar e de terminar
{
  // o nome da classe é montado em tempo de execução ('class="'+cls+'"'), então o que
  // aparece no arquivo é a CHAMADA — procurar por class="ag-f-fim" nunca acharia nada
  eq("71) o compromisso tem hora de terminar", /agHoraHtml\("ag-f-fim",\(ev&&ev\.hora_fim\)/.test(H), "true");
  eq("72) o fim só oferece horário depois do começo",
     /achou=achou\.filter\(function\(t\)\{ return t>ini; \}\);/.test(H), "true");
  eq("73) com a duração escrita do lado", /function agDuracao\(ini, fim\)/.test(H), "true");
  eq("74) escolher o começo sugere o fim uma hora depois",
     /if\(!fim\.value\)\{ agHoraDefine\(cxFim, agSoma\(v,60\)\); return; \}/.test(H), "true");
  eq("75) mexer no começo mantém a duração", /if\(dur>0\) agHoraDefine\(cxFim, agSoma\(v,dur\)\);/.test(H), "true");
  eq("76) terminar antes de começar é barrado na tela",
     /A hora de terminar tem que ser depois das/.test(H), "true");
  // o painel pode ir pro ar antes de o dono rodar o SQL: nesse intervalo, mandar a
  // coluna nova faria o banco recusar e ele não salvaria NADA
  eq("76b) sem o SQL rodado, o painel salva assim mesmo",
     /function agSemColunaFim\(e\)/.test(H) && /agTemFim=false; delete payload\.hora_fim;/.test(H), "true");
  // H: a hora de terminar virou uma seção própria — o gate do agTemFim continua
  eq("76c) e esconde o campo em vez de prometer o que não dá",
     /\(agTemFim\?sec\("fim",/.test(H) && /\(agTemFim\?agSecBtn\("fim","＋ Fim"\):''\)/.test(H), "true");
  const HF = fs.readFileSync(path.join(RAIZ, "sql/agenda_hora_fim.sql"), "utf8");
  eq("77) e barrado no banco também", /check \(hora_fim is null or \(hora is not null and hora_fim > hora\)\)/.test(HF), "true");
  eq("78) mudar a duração devolve os convidados pra Aguardando",
     /or new\.hora_fim is distinct from old\.hora_fim then/.test(HF), "true");
  // 31/08: o dono rodou o SQL e levou "cannot change return type of existing function".
  // O create-or-replace não muda a lista de colunas que a função devolve: tem que
  // apagar antes — e devolver a permissão depois, que some junto com o drop.
  eq("78b) a função é apagada antes de mudar as colunas que devolve",
     /drop function if exists public\.agenda_mes\(date,date,uuid,text\);[\s\S]{0,120}create or replace function public\.agenda_mes/.test(HF), "true");
  eq("78c) e a permissão volta depois do drop",
     /grant execute on function public\.agenda_mes\(date,date,uuid,text\) to authenticated;/.test(HF), "true");
  eq("79) abrir a lista mostra tudo; só digitar filtra", /agHoraPinta\(caixa, null\);/.test(H), "true");
}

// ------------------------------------------------------------ o mês na tela toda (pedido do dono, 31/08)
{
  // Ele mostrou o Google Agenda: "o mês fica na tela todinha, não preciso scrollar".
  // Medido no Chrome: em volta da grade há 285px fixos + 30 dos vãos = 315. Por isso a
  // linha passou a ser (altura da janela − 318) ÷ 6, com piso de 72px.
  eq("87) a linha do mês se ajusta à janela",
     /--ag-lin: max\(72px, calc\(\(100dvh - 318px\) \/ 6\)\)/.test(H)
     && /#agDias\.cal-grid \{ grid-auto-rows: var\(--ag-lin\);/.test(H), "true");
  // desenho do Google: casas coladas, separadas por um fio, sem vão e sem canto redondo
  eq("87b) as casas do mês são coladas, como no Google",
     /\.ag-cal \.cal-grid \{ grid-template-columns: repeat\(7, 1fr\); gap:0; \}/.test(H), "true");
  eq("87c) separadas por um fio, sem canto arredondado",
     /\.ag-cel \{ min-height:0; border:0; border-right:1px solid #eef1f4; border-bottom:1px solid #eef1f4;/.test(H), "true");
  eq("87d) e o fio não dobra na última coluna nem na última linha",
     /\.ag-cel:nth-child\(7n\) \{ border-right:0; \}/.test(H) && /\.ag-cel:nth-last-child\(-n\+7\) \{ border-bottom:0; \}/.test(H), "true");
  eq("88) e a grade ocupa a largura inteira", /\.ag-cal \{ width:100%;/.test(H), "true");
  eq("89) o painel de 340px na lateral não existe mais", /class="ag-painel"/.test(H), "false");
  // o 1px que TODA página do painel tinha: o rodapé mede 35, não 34
  eq("90) o rodapé passou a ser descontado certo",
     /height:calc\(100dvh - 57px - 35px\)/.test(H), "true");
  eq("91) tem o botão Criar", /id="agCriar"/.test(H), "true");
  eq("92) com Evento e Tarefa, e sem 'agendamento de horários'",
     /data-agnovo="evento"/.test(H) && /data-agnovo="tarefa"/.test(H) && /Agendamento de hor/.test(H) === false, "true");
  eq("93) o formulário mora numa janela", /id="agJanBg"/.test(H) && /function agJanAbre\(tipo\)/.test(H), "true");
  eq("94) que fecha no X, no Esc e no fundo", /id="agJanX"/.test(H) && /if\(e\.key!=="Escape"\) return;/.test(H), "true");
  eq("95) a barra do master subiu pra linha do mês", /id="agVerBar"/.test(H), "true");
}

// ------------------------------------------------------------ tarefa
{
  eq("96) tarefa tem formulário próprio e curto", /function agFormTarefaHtml\(\)/.test(H), "true");
  eq("97) sem convidados e sem resposta de convite",
     /\(tar\?'':\(agConvHtml\(ev\)\+ \(agVendoOutro\(\)\?'':agRespostaHtml\(ev\)/.test(H), "true");
  eq("98) dá pra marcar como feita", /function agFeita\(id, btn\)/.test(H), "true");
  eq("99) e ela aparece diferente no mês", /\.ag-chip\.tarefa \{/.test(H) && /\.ag-chip\.tarefa\.feita \{/.test(H), "true");
  const TA = fs.readFileSync(path.join(RAIZ, "sql/agenda_tarefas.sql"), "utf8");
  eq("100) o banco separa tarefa de compromisso",
     /add column if not exists tipo      text not null default 'evento'/.test(TA), "true");
  eq("101) tarefa não repete nem tem hora de terminar (o banco cobra)",
     /check \(tipo <> 'tarefa' or \(hora_fim is null and \(repete is null or repete = 'nao'\)\)\)/.test(TA), "true");
  eq("102) só tarefa pode estar feita",
     /check \(feita_em is null or tipo = 'tarefa'\)/.test(TA), "true");
  eq("103) a função é apagada antes (colunas novas) e a permissão volta",
     /drop function if exists public\.agenda_mes\(date,date,uuid,text\);/.test(TA)
     && /grant execute on function public\.agenda_mes\(date,date,uuid,text\) to authenticated;/.test(TA), "true");
  // sem o SQL rodado, criar tarefa não pode virar compromisso calado
  eq("104) sem o SQL, a tarefa avisa em vez de virar compromisso",
     /function agSemColunaTarefa\(e\)/.test(H) && /A Tarefa precisa de um ajuste no banco/.test(H), "true");
}

// ------------------------------------------------------------ a barra invertida some na geração
{
  // O módulo da Agenda mora DENTRO de um texto de template no gerador. Ali a barra
  // invertida é comida: /\D/ escrito na fonte chega ao navegador como /D/. Foi assim
  // que o filtro de horário deixou o ":" passar e "09:00" virou "09:aN" na tela.
  // Regra: nada de barra invertida nesse bloco — para dígito, [^0-9].
  const FONTE = fs.readFileSync(path.join(RAIZ, "scripts/demoDashboard.ts"), "utf8");
  const ini = FONTE.indexOf("// ================= AGENDA (compromissos por dia");
  const fim = FONTE.indexOf("// =============== FIM AGENDA ===============");
  const bloco = FONTE.slice(ini, fim);
  const comBarra = bloco.split("\n").map((l, i) => [i + 1, l])
    .filter(([, l]) => l.indexOf("\\") >= 0 && l.indexOf("//") !== 0);
  eq("62) nenhuma barra invertida no bloco da Agenda",
     comBarra.length ? comBarra.map(([n]) => "linha " + n).join(", ") : "nenhuma", "nenhuma");
  eq("63) e o filtro de dígitos chegou inteiro no navegador",
     /replace\(\/\[\^0-9\]\/g,""\); if\(!d\) return null;/.test(H), "true");
  eq("64) sem sobrar regex quebrada", /replace\(\/D\/g/.test(H), "false");
}

// ------------------------------------------------------------ ETAPA 0: o campo "Dia" na criação
{
  // 31/08/2026, achado na inspeção: ao CRIAR, o campo "Dia" era lido, validado e jogado
  // fora — o insert gravava sempre em agSel, o dia que estava aberto atrás da janela.
  // Quem trocasse o dia via o compromisso cair no dia errado, sem aviso. É erro de DADO.
  eq("105) criar grava no dia do FORMULÁRIO, não no dia aberto",
     /insert\(Object\.assign\(\{data:diaBase\},payload\)\)/.test(H), "true");
  eq("105b) inclusive no caminho de reserva (quando falta a coluna nova)",
     (H.match(/insert\(Object\.assign\(\{data:diaBase\},payload\)\)/g) || []).length, 2);
  eq("105c) e não sobrou nenhum insert usando o dia aberto",
     /insert\(Object\.assign\(\{data:agSel\}/.test(H), "false");
  eq("105d) diaBase cai no dia aberto quando o formulário não tem campo de dia",
     /var diaBase=dia\|\|agSel;/.test(H), "true");
  // gravar certo e sumir da vista seria o mesmo susto de antes
  eq("105e) criado em outro dia, o calendário vai junto",
     /var _destino = id \? \(\(dia&&evAntes&&dia!==evAntes\.data\)\?dia:""\) : \(\(diaBase&&diaBase!==agSel\)\?diaBase:""\);/.test(H), "true");
}

// ------------------------------------------------------------ ETAPA A: carga por faixa + cache
{
  // A função do banco sempre trabalhou por FAIXA (p_ini, p_fim) — quem escolhia "mês" era
  // o navegador. Isolar a escolha numa função é o que deixa a visão Semana pedir outra
  // faixa depois sem mexer em mais nada da carga.
  eq("106) a faixa a carregar virou uma função só", /function agFaixaAtual\(\)/.test(H), "true");
  eq("106b) e a carga usa ela, em vez de montar o mês na mão",
     /var _f=agFaixaAtual\(\), ini=_f\.ini, fim=_f\.fim;/.test(H), "true");
  eq("106c) sem inventar RPC nova — continua a agenda_mes de sempre",
     /sb\.rpc\("agenda_mes",\{p_ini:ini,p_fim:fim,p_alvo:alvo\|\|null,p_setor:setor\|\|null\}\)/.test(H), "true");

  // A Agenda era o único módulo pesado sem guardar o que já leu (os irmãos têm
  // clConfQuando, vsQuando, entQuando). 3 minutos = o mesmo da Central.
  eq("107) existe cache, com prazo curto", /var AG_VALE_MS = 3\*60\*1000;/.test(H), "true");
  eq("107b) e ele é consultado antes de perguntar ao banco",
     /if\(guardado && \(Date\.now\(\)-guardado\.quando\) < AG_VALE_MS\)\{/.test(H), "true");
  eq("107c) só guarda leitura que deu certo",
     /agCache\[chave\]=\{quando:Date\.now\(\), linhas:linhas\};/.test(H), "true");

  // SEGURANÇA: a chave tem que dizer DE QUEM é a agenda, senão o master troca de pessoa
  // e continua vendo o dado da anterior.
  eq("108) a chave do cache inclui a faixa, a pessoa e o setor",
     /function agChaveCache\(ini, fim, alvo, setor\)\{\s*\n\s*return ini \+ "\.\." \+ fim \+ " \| " \+ \(alvo \|\| "eu"\) \+ " \| " \+ \(setor \|\| "-"\);/.test(H), "true");
  eq("108b) e a carga monta a chave com o alvo REAL do pedido",
     /var chave=agChaveCache\(ini,fim,alvo,setor\), guardado=agCache\[chave\];/.test(H), "true");

  // Corretude antes de economia: qualquer coisa que mude o dado joga o guardado fora.
  eq("109) existe a invalidação", /function agInvalidar\(\)\{ agCache = \{\}; \}/.test(H), "true");
  const pontos = (H.match(/agInvalidar\(\)/g) || []).length;
  eq("109b) e ela é chamada em todo ponto que muda dado (>=14)", pontos >= 14, "true");
  eq("109c) o realtime invalida antes de recarregar",
     /agInvalidar\(\); agCloudLoad\(true\); agBadge\(\);/.test(H), "true");
  eq("109d) trocar de pessoa invalida",
     /agVerAlvo=vp\.value\|\|null; agEditId=null; agRespId=null; agConvSel=\[\]; agInvalidar\(\);/.test(H), "true");
  eq("109e) trocar de setor invalida",
     /agVerSetor=vs\.value\|\|null; agVerAlvo=null; agEditId=null; agRespId=null; agConvSel=\[\]; agInvalidar\(\);/.test(H), "true");
  eq("109f) salvar, excluir, responder, remarcar e tarefa feita invalidam",
     (H.match(/agInvalidar\(\); agCloudLoad\(\)/g) || []).length >= 5, "true");
}


// ------------------------------------------------------ ETAPA B: UMA regra de recorrência
{
  // O defeito que a inspeção apontou: a expansão trabalhava por MÊS, então uma faixa que
  // atravessasse a virada (30/08 a 05/09) vinha pela metade. Agora existe UMA regra, por
  // intervalo, que o Mês e a Semana usam do mesmo jeito.
  eq("110) a regra de recorrência trabalha por intervalo",
     /function agOcorreFaixa\(ev, ini, fim\)\{/.test(H), "true");
  eq("110b) e não sobrou nenhuma regra por mês",
     /function agOcorre\(ev *, *ano/.test(H), "false");
  eq("110c) nem uma regra separada só para a Semana (era o risco de duas verdades)",
     /function agOcorreSemana\(/.test(H) || /function agOcorreMes\(/.test(H), "false");
  eq("110d) a expansão da carga chama a regra única com a faixa pedida",
     /agOcorreFaixa\(ev,faixa\.ini,faixa\.fim\)/.test(H), "true");
  eq("110e) a regra respeita a data-limite da repetição",
     /if\(key>=ini && !\(ate&&key>ate\)\)\{/.test(H), "true");
  eq("110f) 'todo mês' cai no mesmo dia do mês, e pula quando o dia não existe",
     /else if\(rep==="mes"\) hit=\(cur\.getDate\(\)===bDia\);/.test(H), "true");
  eq("110g) 'dias úteis' é de segunda a sexta",
     /else if\(rep==="uteis"\)\{ var w=cur\.getDay\(\); hit=\(w>=1&&w<=5\); \}/.test(H), "true");
  // a resposta chegando fora de hora não pode pintar a tela de outra faixa
  eq("110h) a resposta atrasada é comparada com a faixa pedida, não com o mês",
     /function agTerminar\(seq,faixa,rows,erro,deFundo\)\{/.test(H), "true");
}

// ------------------------------------------------------------- ETAPA C: alternador Mês|Semana
{
  eq("111) existe o estado da visão", /var agVisao="mes";/.test(H), "true");
  eq("111b) e um lugar só que troca de visão", /function agTrocaVisao\(qual\)\{/.test(H), "true");
  eq("111c) trocar de visão passa pelo cache (não pergunta ao banco à toa)",
     /agCloudLoad\(\); *\n?\s*\}\s*\n\s*\/\* -+ painel do dia/.test(H) || /o cache decide se isso vira pergunta ao banco/.test(H), "true");
  eq("111d) os dois botões existem no topo",
     /data-agvisao="mes">Mês<\/button>/.test(H) && /data-agvisao="semana">Semana<\/button>/.test(H), "true");
  // SEGURANÇA: a faixa é uma só, e é ela que manda na carga e no cache
  eq("112) a faixa muda conforme a visão",
     /function agFaixaAtual\(\)\{\s*\n\s*if\(agEhSemana\(\)\)\{\s*\n\s*var dias=agDiasDaSemana\(\);/.test(H), "true");
  eq("112b) a semana é sempre de domingo a sábado", /function agDomingoDe\(iso\)\{/.test(H), "true");
  eq("112c) e sempre 7 dias", /var AG_SEM_DIAS=7;/.test(H), "true");
  // G2: a seta passou a andar o tamanho da JANELA (3, 5 ou 7), não "uma semana"
  eq("112d) a seta anda a janela inteira na visão Semana",
     /agSemIni=agSomaDias\(agDiasDaSemana\(\)\[0\], passo\*agDiasVisiveis\(\)\);/.test(H), "true");
  eq("112e) e continua andando de mês na visão Mês",
     /\} else \{\s*\n\s*agMes\+=passo;\s*\n\s*if\(agMes<0\)\{ agMes=11; agAno--; \}/.test(H), "true");
  eq("112f) quem desenha decide pela visão, num lugar só",
     /function agDesenha\(\)\{ if\(agEhSemana\(\)\) agRenderSemana\(\); else agRenderMes\(\); \}/.test(H), "true");
}

// ------------------------------------------------------------------ ETAPA D: a grade da Semana
{
  eq("113) a grade da Semana existe, ao lado da do Mês (não no lugar dela)",
     /<div class="ag-sem" id="agSem">/.test(H) && /class="ag-cal"/.test(H), "true");
  eq("113b) com cabeçalho, faixa de 'sem hora' e corpo",
     /id="agSemCab"/.test(H) && /id="agSemTodoDia"/.test(H) && /id="agSemCorpo"/.test(H), "true");
  eq("113c) as três fileiras dividem as MESMAS colunas (calha + 7 dias)",
     /grid-template-columns: var\(--ag-gut\) repeat\(var\(--ag-dias\), minmax\(0,1fr\)\)/.test(H), "true");
  // ETAPA E: a grade passou a cobrir o dia inteiro. Cortar em 06–22 sumia com o
  // recebimento das 04:30 e o fechamento das 23:00, que o seletor de hora aceita.
  eq("113d) a grade cobre o dia inteiro", /var AG_SEM_DE=0, AG_SEM_ATE=23;/.test(H), "true");
  // quem rola é a caixa inteira: é isso que impede o cabeçalho de sair do lugar
  eq("113e) quem rola é a caixa toda", /\.ag-sem \{[^}]*overflow-y:auto/.test(H), "true");
  eq("113f) o cabeçalho fica grudado no topo",
     /\.ag-sem-cab \{ position:sticky; top:0;/.test(H), "true");
  eq("113g) e a faixa 'sem hora' logo abaixo dele",
     /\.ag-sem-tododia \{ position:sticky; top:var\(--ag-cab\);/.test(H), "true");
  // a etiqueta da primeira faixa sobe 6px como as outras e some debaixo do cabeçalho:
  // o dia parecia começar às 07:00
  eq("113h) a primeira hora do dia aparece escrita",
     /\.ag-sem-hora\.topo \{ transform:none; padding-top:2px; \}/.test(H), "true");
  eq("113h2) e nenhuma faixa fica sem etiqueta",
     /\(h>AG_SEM_DE\?hh:""\)/.test(H), "false");
  eq("113i) hoje na Semana usa o MESMO verde do Mês",
     /\.ag-sem-dia\.hoje \.ag-sem-num \{ background:#157a35; color:#fff; \}/.test(H), "true");
}

// ------------------------------- O MÊS APROVADO NÃO PODE MUDAR (some com esta trava por sua conta e risco)
{
  eq("114) a Semana nasce escondida e só aparece quando escolhida",
     /\.ag-sem \{ display:none;/.test(H) && /\.ag-sem\.mostra \{ display:block; \}/.test(H), "true");
  eq("114b) e o CSS da Semana nunca toca nas células do Mês",
     /\.ag-sem[^\n]*\.ag-cel/.test(H), "false");
}


// ------------------------------------------------ ETAPA E: os compromissos desenhados na semana
{
  // ESCALA ÚNICA. Espalhar conta pelo desenho é como o bloco de 30 min sai com altura
  // diferente do de 1 h dividido por dois.
  eq("115) existe uma escala só, e uma conversão só de minuto pra pixel",
     /var AG_SEM_PXH=44;/.test(H) && /function agPx\(minutos\)\{ return minutos \* \(AG_SEM_PXH\/60\); \}/.test(H), "true");
  eq("115b) o CSS usa o MESMO número da escala (senão a régua e os blocos brigam)",
     /--ag-h:44px/.test(H), "true");
  eq("115c) e a posição sai da mesma conta",
     /var topo=agPx\(o\.ini - AG_SEM_DE\*60\);/.test(H), "true");
  eq("115d) a altura também, com um piso pra caber texto",
     /var alt=Math\.max\(AG_SEM_MIN_PX, agPx\(o\.fim-o\.ini\)\);/.test(H), "true");

  // DURAÇÃO: sem hora de terminar vale 30 min — e continua parecendo compromisso com hora
  eq("116) sem hora de fim, a duração padrão é 30 minutos",
     /var AG_SEM_PADRAO_MIN=30;/.test(H) &&
     /var fim=ev\.hora_fim\?agMinutos\(ev\.hora_fim\):\(ini\+AG_SEM_PADRAO_MIN\);/.test(H), "true");
  eq("116b) hora de fim antes do começo não vira bloco negativo",
     /if\(fim<=ini\) fim=ini\+AG_SEM_PADRAO_MIN;/.test(H), "true");

  // RECORRÊNCIA: a posição NÃO pode morar no objeto do evento
  eq("117) a ocorrência é um objeto de desenho separado, que só aponta pro evento",
     /out\.push\(\{ ev:ev, dia:dia, ini:ini, fim:fim, col:0, cols:1 \}\);/.test(H), "true");
  eq("117b) e nada é gravado de volta no evento",
     /ev\.(top|col|cols|ini|fim)\s*=/.test(H), "false");

  // SOBREPOSIÇÃO: as 6 etapas aprovadas na inspeção
  eq("118) ordena por início; empate, o mais longo; empate total, id",
     /if\(a\.ini!==b\.ini\) return a\.ini-b\.ini;/.test(H) &&
     /if\(da!==db\) return db-da;/.test(H) &&
     /return String\(a\.ev\.id\)<String\(b\.ev\.id\)\?-1:1;/.test(H), "true");
  eq("118b) agrupa quem se cruza — quem começa quando o outro acaba NÃO se cruza",
     /if\(grupo\.length && fimGrupo!==null && o\.ini>=fimGrupo\) fecha\(\);/.test(H), "true");
  eq("118c) distribui em colunas internas, na primeira que já está livre",
     /while\(i<colunas\.length && colunas\[i\]>o\.ini\) i\+\+;/.test(H), "true");
  eq("118d) e divide a largura entre as colunas do grupo",
     /grupo\.forEach\(function\(o\)\{ o\.cols=colunas\.length; \}\);/.test(H), "true");
  eq("118e) com uma folga entre os blocos vizinhos",
     /width:calc\('\+larg\+'% - 5px\)/.test(H), "true");

  // SEM HORA: não inventar 06:00 pra quem não marcou hora
  eq("119) quem não tem hora fica fora da grade",
     /if\(!ev\.hora\) return;/.test(H), "true");
  eq("119b) e vai pra faixa Sem hora",
     /var sh=\(agEventos\[k\]\|\|\[\]\)\.filter\(function\(ev\)\{ return !ev\.hora; \}\);/.test(H), "true");
  // G2: são 2 no computador e 1 no celular — o corte virou variável
  eq("119c) mostrando poucos e resumindo o resto, pra faixa não comer a tela",
     /var mais=sh\.length>quantos\?\('<div class="ag-mais" data-agtodos="'\+k\+'"/.test(H), "true");

  // TAREFA: sem cor nova, o mesmo sistema do mês
  eq("120) o bloco reaproveita as cores do mês (evento, pendente, tarefa, tarefa feita)",
     /\.ag-bl \{[\s\S]{0,400}background:#e6f0fb; color:#1b4f86;/.test(H) &&
     /\.ag-bl\.pend \{ background:#fdf3e3; color:#8a5a00;/.test(H) &&
     /\.ag-bl\.tarefa \{ background:#efe9fb; color:#4b3b86;/.test(H) &&
     /\.ag-bl\.tarefa\.feita \{ background:#eef1f4; color:#8a97a8;/.test(H), "true");
  eq("120b) tarefa feita continua riscada",
     /\.ag-bl\.tarefa\.feita \.ag-bl-tit \{ text-decoration:line-through; \}/.test(H), "true");
  eq("120c) e com a caixinha ☐ / ☑ do mês",
     /\(tar\?\(feita\?"☑ ":"☐ "\):""\)/.test(H), "true");
  eq("120c2) coluna estreita (3 no computador, 2 no celular): corta com reticências, não parte palavra",
     /var estreito=o\.cols>=3 \|\| \(agEhCelular\(\) && o\.cols>=2\);/.test(H) &&
     /\.ag-bl\.estreito \.ag-bl-hora, \.ag-bl\.estreito \.ag-bl-tit \{\s*\n\s*white-space:nowrap; overflow:hidden; text-overflow:ellipsis; \}/.test(H), "true");
  eq("120d) bloco curto mostra só o essencial",
     /var curto=alt<34;/.test(H) && /\.ag-bl\.curto \{ display:flex;/.test(H), "true");

  // CLIQUE: a mesma janela, e o dia da OCORRÊNCIA
  eq("121) o bloco carrega o próprio dia",
     /data-agabrir="'\+ev\.id\+'" data-agdia="'\+o\.dia\+'"/.test(H), "true");
  eq("121b) e o clique da semana leva o dia selecionado pra ele",
     /var sem=document\.getElementById\("agSem"\); if\(sem\) sem\.addEventListener\("click"/.test(H), "true");
  eq("121c) sem inventar janela semanal — é a mesma agJanAbre",
     /agDesenha\(\); agJanAbre\(\);[\s\S]{0,60}\}\);\s*\n\s*var dias=document\.getElementById\("agDias"\)/.test(H), "true");
  eq("121d) achar o compromisso não depende mais do dia aberto",
     /function agFindEv\(id\)\{[\s\S]{0,400}Object\.keys\(agEventos\)\.forEach/.test(H), "true");
  eq("121e) clicar no vazio da grade não cria nada (a célula de hora não leva data)",
     /return '<div class="ag-sem-cel'\+\(k===hoje\?" hoje":""\)\+'"><\/div>';/.test(H), "true");
  eq("121f) quem redesenha depois do clique respeita a visão",
     /agRenderMes\(\); agJanAbre\(\)/.test(H), "false");

  // FORA DO HORÁRIO COMERCIAL: não sumir com ninguém
  eq("122) nenhum compromisso é cortado: a rolagem é que começa no horário útil",
     /function agSemRolaAlvo\(dias\)\{/.test(H) && /var AG_SEM_ROLA_H=7;/.test(H), "true");
  eq("122b) e a rolagem só se reposiciona quando a semana muda",
     /if\(agSemRolar\)\{\s*\n\s*agSemRolar=false;/.test(H), "true");

  // CONSUMO: desenhar é local
  eq("123) desenhar a semana não fala com o banco",
     /function agRenderSemana\(\)\{[\s\S]*?\n\}/.test(H) &&
     /function agRenderSemana\(\)\{[\s\S]*?\n\}/.exec(H)[0].indexOf("sb.rpc") === -1, "true");
  eq("123b) nem montar as ocorrências ou calcular a sobreposição",
     /function agOcorrencias\(dia\)\{[\s\S]*?\n\}/.exec(H)[0].indexOf("rpc") === -1 &&
     /function agEmpilha\(ocs\)\{[\s\S]*?\n\}/.exec(H)[0].indexOf("rpc") === -1, "true");
}

// ------------------------------- O MÊS APROVADO CONTINUA INTOCADO (Etapa E não pode arranhar)
{
  eq("124) nenhuma regra da Etapa E toca nas células do mês",
     /\.ag-bl[^\n]*\.ag-cel|\.ag-sem-blocos[^\n]*#agDias/.test(H), "false");
  eq("124b) o CSS do mês continua o aprovado",
     /#agDias\.cal-grid \{ grid-auto-rows: var\(--ag-lin\); border:1px solid #e4e9ef; border-radius:10px; overflow:hidden; \}/.test(H), "true");
  eq("124c) e a camada de blocos vive dentro da semana, não solta na página",
     /\.ag-sem-blocos \{ position:absolute;/.test(H), "true");
}


// -------------------------------------------------- ETAPA F: acabamento da visão Semana
{
  // LINHA DO HORÁRIO ATUAL — mesma escala dos blocos, e relógio local (nunca o banco)
  eq("125) a linha do agora usa a MESMA conta dos compromissos",
     /var y=agPx\(agAgoraMin\(\) - AG_SEM_DE\*60\);/.test(H), "true");
  eq("125b) e não existe uma segunda fórmula de posição",
     (H.match(/agPx\(/g) || []).length >= 5 &&
     /Math\.round\(\(?[a-z]+\s*\/\s*60\s*\)?\s*\*\s*(44|AG_SEM_PXH)/.test(H) === false, "true");
  eq("125c) ela só é desenhada quando a semana contém hoje",
     /var temHoje=dias\.indexOf\(hoje\)>=0;/.test(H) &&
     /\(\(k===hoje\)\?'<div class="ag-agora" id="agAgora"><\/div>':''\)/.test(H), "true");
  eq("125d) o rótulo da hora vai na calha, do lado da linha",
     /\(temHoje\?'<div class="ag-agora-rot" id="agAgoraRot"><\/div>':''\)/.test(H), "true");
  eq("125e) anda de minuto em minuto, sem falar com o banco",
     /agAgoraT=setInterval\(agAgoraPinta, 60000\);/.test(H), "true");
  eq("125f) e o que ela mexe é só o topo dos dois elementos",
     /function agAgoraPinta\(\)\{[\s\S]*?\n\}/.exec(H)[0].indexOf("rpc") === -1, "true");
  eq("125f2) e some com a etiqueta da hora que ela cobre (a foto pegou '19:00' atrás de '19:33')",
     /if\(tr\.height && tr\.top < cx\.bottom && cx\.top < tr\.bottom\) labs\[i\]\.style\.visibility="hidden";/.test(H), "true");
  eq("125f3) comparando o TEXTO, não a célula (que tem a altura da fileira inteira)",
     /rg\.selectNodeContents\(labs\[i\]\);/.test(H), "true");
  eq("125g) usa o verde de HOJE, não uma cor nova",
     /\.ag-agora \{[^}]*border-top:2px solid #157a35;/.test(H), "true");

  // ROLAGEM INICIAL
  eq("126) a semana de hoje abre 1h30 antes do agora (não grudado no topo)",
     /return Math\.max\(0, agAgoraMin\(\) - 90\);/.test(H), "true");
  eq("126b) as outras semanas abrem no começo do expediente",
     /var AG_SEM_ROLA_H=7;/.test(H) && /return AG_SEM_ROLA_H\*60;/.test(H), "true");
  // e o que ficou acima não fica escondido em silêncio
  eq("126c) existe um aviso do que ficou mais cedo",
     /function agAntesPinta\(\)\{/.test(H) && /b\.textContent="↑ "\+n\+" antes";/.test(H), "true");
  eq("126d) ele conta olhando a MESMA escala",
     /if\(agPx\(agSemOcs\[i\]\.fim - AG_SEM_DE\*60\) <= topo\)\{/.test(H), "true");
  eq("126e) clicar nele leva até o primeiro, com um respiro",
     /sem\.scrollTop=Math\.max\(0, agPx\(m - AG_SEM_DE\*60 - 15\)\);/.test(H), "true");
  eq("126f) e ele não consulta nada — é leitura de tela",
     /function agAntesPinta\(\)\{[\s\S]*?\n\}/.exec(H)[0].indexOf("rpc") === -1, "true");

  // HIERARQUIA DO TEXTO: título primeiro
  eq("127) dentro do bloco o TÍTULO vem antes do horário",
     /'<span class="ag-bl-tit">'\+agEsc\(marca\+ev\.titulo\)\+'<\/span>'\+\s*\n\s*\(hora\?\('<span class="ag-bl-hora">'/.test(H), "true");
  eq("127a2) e pesa mais que o horário (a foto pegou o contrário)",
     /\.ag-bl-tit \{ display:block; font-weight:700;/.test(H) &&
     /\.ag-bl-hora \{ display:block; font-weight:500; opacity:\.8; \}/.test(H), "true");
  eq("127a3) o rótulo do horário atual se apoia na calha, senão vai parar no fim da grade",
     /\.ag-sem-col, \.ag-sem-bl-calha \{ position:relative; \}/.test(H), "true");
  eq("127b) só o bloco alto mostra o intervalo inteiro",
     /\(\(!curto && !estreito && alt>=44\) \? faixa : agFmtHora\(ev\.hora\)\)/.test(H), "true");
  eq("127b2) no aperto (4 no computador, 2 no celular) nem o horário cabe: fica só o título",
     /var apertado=o\.cols>=4 \|\| \(agEhCelular\(\) && o\.cols>=2\);/.test(H) && /var hora=apertado \? "" :/.test(H), "true");
  eq("127c) e a informação secundária só entra quando sobra espaço",
     /alt>=76&&agVerSetor&&ev\.dono_nome/.test(H), "true");
  eq("127d) o balãozinho tem o título inteiro e o horário",
     /title="'\+agEsc\(ev\.titulo\+" · "\+faixa\)\+'"/.test(H), "true");

  // COLUNA DE HOJE
  eq("128) a coluna de hoje tem um fundo levíssimo",
     /\.ag-sem-cel\.hoje \{ background:#f6faf7; \}/.test(H), "true");
  eq("128b) e a faixa Sem hora acompanha, pra coluna não ficar partida",
     /\.ag-sem-td-cel\.hoje \{ background:#f6faf7; \}/.test(H), "true");

  // CARREGANDO e ERRO
  eq("129) trocar de semana apaga a grade um pouco, em vez de parecer travada",
     /\.ag-sem\.carregando \.ag-sem-corpo, \.ag-sem\.carregando \.ag-sem-tododia \{ opacity:\.42; \}/.test(H), "true");
  eq("129b) e SÓ a semana faz isso — o mês aprovado não muda",
     /\.ag-cal\.carregando|\.ag-cal[^\n]*opacity:\.42/.test(H), "false");
  eq("129c) o apagado só sai quando a resposta certa chega",
     /agSemCarregando\(false\);   \/\/ só aqui/.test(H), "true");
  eq("130) o erro é em português, sem termo técnico",
     /Não deu pra carregar a agenda agora\. Verifique a conexão/.test(H), "true");
  eq("130b) e não mostra nome de função nem código do banco",
     /ag-aviso">[^<]*(agenda_mes|Supabase|Postgres|PGRST|42501)/.test(H), "false");

  // COERÊNCIA entre as visões (defeito que a Semana criou)
  eq("131) escolhendo um dia de outro mês na Semana, o Mês abre nesse mês",
     /if\(!agEhSemana\(\)\)\{ var _d=agParse\(agSel\); agAno=_d\.getFullYear\(\); agMes=_d\.getMonth\(\); \}/.test(H), "true");

  // ACESSIBILIDADE BÁSICA
  eq("132) o bloco mostra que é clicável", /\.ag-bl \{[^}]*cursor:pointer;/.test(H), "true");
  eq("132b) tarefa feita não depende só da cor: fica riscada e com a caixinha marcada",
     /\.ag-bl\.tarefa\.feita \.ag-bl-tit \{ text-decoration:line-through; \}/.test(H) &&
     /\(tar\?\(feita\?"☑ ":"☐ "\):""\)/.test(H), "true");
  eq("132c) e o hover é discreto", /\.ag-bl:hover \{ filter:brightness\(\.95\); \}/.test(H), "true");
}

// ---------------------------------- O MÊS APROVADO CONTINUA INTOCADO (Etapa F não arranha)
{
  eq("133) nenhuma regra nova toca nas células ou na grade do mês",
     /\.ag-agora[^\n]*\.ag-cel|\.ag-sem-antes[^\n]*#agDias|\.ag-bl[^\n]*\.ag-cal/.test(H), "false");
  eq("133b) o CSS do mês continua o aprovado",
     /#agDias\.cal-grid \{ grid-auto-rows: var\(--ag-lin\); border:1px solid #e4e9ef; border-radius:10px; overflow:hidden; \}/.test(H), "true");
  eq("133c) e a altura elástica dele também",
     /--ag-lin: max\(72px, calc\(\(100dvh - 318px\) \/ 6\)\)/.test(H), "true");
}


// ------------------------------------ ETAPA G2: a mesma Semana, com menos dias no celular
{
  // UMA REGRA SÓ decide o tamanho — nada de "if mobile" espalhado
  eq("134) a faixa de larguras é uma tabela só",
     /var AG_SEM_FAIXAS=\[\{ate:480, dias:3\}, \{ate:720, dias:5\}\];/.test(H), "true");
  eq("134a2) a largura vem do clientWidth, a MESMA régua da media query",
     /function agLargura\(\)\{[\s\S]{0,200}return d\.clientWidth;/.test(H), "true");
  eq("134a3) e NÃO do innerWidth, que cresce junto com o estouro da página",
     /function agLargura\(\)\{ return \(typeof window!=="undefined" && window\.innerWidth\)/.test(H), "false");
  eq("134b) e uma função só responde quantos dias cabem",
     /function agDiasVisiveis\(\)\{[\s\S]{0,240}return 7;\s*\n\}/.test(H), "true");
  eq("134c) o corte de celular é o MESMO da gaveta do painel",
     /var AG_CELULAR_ATE=760;/.test(H) && /@media \(max-width:760px\)\{/.test(H), "true");
  eq("134d) e não existe 'if mobile' espalhado pelo módulo",
     /if\s*\(\s*(mobile|isMobile|ehMobile)\b/.test(H), "false");
  // o CSS aprende com o JS: uma verdade só
  eq("135) quem escreve o número de colunas no CSS é o JS",
     /caixa\.style\.setProperty\("--ag-dias", String\(dias\.length\)\);/.test(H), "true");
  eq("135b) e não há media query mexendo no número de dias",
     /@media[^{]*\{[^}]*--ag-dias/.test(H), "false");

  // A JANELA: ancorada, e ela vai atrás do dia escolhido só quando ele sai
  eq("136) com 7 dias continua domingo a sábado",
     /if\(n>=7\)\{ agSemIni=null; return agDomingoDe\(hoje\); \}/.test(H), "true");
  eq("136b) com 3 ou 5 ela guarda onde começou",
     /if\(!agSemIni\) agSemIni=hoje;/.test(H), "true");
  eq("136c) e só reancora quando o dia escolhido sai de dentro dela",
     /if\(d<0 \|\| d>=n\) agSemIni=hoje;/.test(H), "true");
  eq("136d) os dias na tela saem dessa janela",
     /var n=agDiasVisiveis\(\), ini=agJanelaIni\(\), out=\[\];/.test(H), "true");

  // NAVEGAÇÃO: a seta anda o tamanho da janela
  eq("137) a seta anda exatamente o número de dias visíveis",
     /agSemIni=agSomaDias\(agDiasDaSemana\(\)\[0\], passo\*agDiasVisiveis\(\)\);/.test(H), "true");
  eq("137b) e o Hoje faz a janela nascer de novo em hoje",
     /agSemRolar=true; agSemIni=null;/.test(H), "true");

  // TROCAR DE TAMANHO
  eq("138) mudar a largura só reage quando a QUANTIDADE de dias muda",
     /var n=agDiasVisiveis\(\);\s*\n\s*if\(n===agDiasAnt\) return;/.test(H), "true");
  eq("138b) e recarrega pelo caminho normal, que passa pelo cache",
     /if\(pg && pg\.classList\.contains\("ativo"\)\) agCloudLoad\(\);/.test(H), "true");

  // BLOCOS: no celular 2 já é aperto
  eq("139) no celular, 2 ao mesmo tempo já contam como estreito",
     /var estreito=o\.cols>=3 \|\| \(agEhCelular\(\) && o\.cols>=2\);/.test(H), "true");
  eq("139b) e como apertado — aí fica só o título",
     /var apertado=o\.cols>=4 \|\| \(agEhCelular\(\) && o\.cols>=2\);/.test(H), "true");
  eq("139c) o algoritmo de sobreposição NÃO mudou",
     /while\(i<colunas\.length && colunas\[i\]>o\.ini\) i\+\+;/.test(H), "true");
  eq("139d) nem a escala de 44px por hora",
     /var AG_SEM_PXH=44;/.test(H), "true");

  // SEM HORA e MÊS: menos itens no celular
  eq("140) faixa Sem hora mostra 1 no celular e 2 no computador",
     /var quantos=agEhCelular\(\)\?1:2;/.test(H), "true");
  eq("140b) e o resumo conta a partir daí",
     /var mais=sh\.length>quantos\?/.test(H), "true");
  eq("141) o Mês mostra 1 no celular e 3 no computador",
     /var cabem=agEhCelular\(\)\?1:3;/.test(H), "true");
  eq("141b) com o resumo certo", /var mais=evs\.length>cabem\?/.test(H), "true");

  // CABEÇALHO no celular
  eq("142) o cabeçalho quebra em duas linhas",
     /\.cal-top \{ flex-wrap:wrap; gap:8px 8px; margin-bottom:12px; \}/.test(H), "true");
  eq("142b) sem largura mínima de computador",
     /\.ag-topdir \{ margin-left:0; width:100%; justify-content:space-between; gap:8px; flex-wrap:wrap; \}/.test(H), "true");
  eq("142b2) o filtro do master desce pra linha própria, sem espremer os controles",
     /#agVerBar \{ order:99; width:100%; \}/.test(H), "true");
  eq("142c) o '＋ Criar' vira só '＋'", /\.ag-criar-tx \{ display:none; \}/.test(H), "true");
  eq("142d) mas continua dizendo o que faz",
     /aria-label="Criar compromisso">＋<span class="ag-criar-tx"> Criar<\/span>/.test(H), "true");
  eq("142e) e abre o mesmo menu Evento\/Tarefa",
     /data-agnovo="evento"[\s\S]{0,200}data-agnovo="tarefa"/.test(H), "true");
  eq("143) alvos de dedo nas setas", /\.cal-nav \{ width:44px; height:44px; font-size:22px; \}/.test(H), "true");
  eq("143b) e no Hoje e no Criar",
     /#agHoje, \.ag-criar \{ min-height:42px; \}/.test(H), "true");
  eq("143c) usando o id do Hoje — \.ag-hoje também existe em Manutenções",
     /\.ag-hoje, \.ag-criar \{ min-height/.test(H), "false");
  eq("144) a calha encolhe pra devolver largura aos dias",
     /\.ag-sem \{ --ag-gut:44px;/.test(H), "true");
  eq("144b) e a faixa Sem hora encolhe quando o dia não tem nada",
     /\.ag-sem-td-cel \{ min-height:0; \}/.test(H) && /\.ag-sem-tododia \{ min-height:22px; \}/.test(H), "true");
}

// ------------------------------------- O COMPUTADOR CONTINUA CONGELADO (G2 não arranha)
{
  eq("145) todo o mobile da Agenda vive dentro da media query",
     /\n  \.ag-sem \{ --ag-gut:44px|\n  \.cal-top \{ flex-wrap:wrap|\n  \.ag-criar-tx \{ display:none/.test(H), "false");
  eq("145b) o Mês aprovado continua o mesmo",
     /#agDias\.cal-grid \{ grid-auto-rows: var\(--ag-lin\); border:1px solid #e4e9ef; border-radius:10px; overflow:hidden; \}/.test(H), "true");
  eq("145c) com a altura elástica do computador",
     /\.ag-cal \{ width:100%; --ag-lin: max\(72px, calc\(\(100dvh - 318px\) \/ 6\)\); \}/.test(H), "true");
  eq("145d) e a calha do computador continua 58px",
     /\.ag-sem \{ display:none; --ag-gut:58px; --ag-dias:7;/.test(H), "true");
}


// =================== ETAPA H: a janela de criar/ver/editar ===================
{
  // UMA JANELA, TRÊS ESTADOS — e um título só
  eq("146) a janela tem um título de verdade, e o leitor de tela sabe qual é",
     /aria-labelledby="agJanTit"/.test(H) && /<h2 class="ag-jan-tit" id="agJanTit">/.test(H), "true");
  eq("146b) e sumiram os dois títulos empilhados da marcação",
     /class="ag-painel-tit"|class="ag-form-tit"/.test(H), "false");
  eq("146c) a data virou dado dentro do conteúdo, não segundo cabeçalho",
     /<div class="ag-jan-dia">/.test(H), "true");
  eq("146d) o × diz o que faz", /aria-label="Fechar a janela"/.test(H), "true");

  // CAIXA DENTRO DE CAIXA: o formulário é a própria janela agora
  eq("147) o formulário perdeu a moldura e o fundo próprios",
     /\.ag-jan \.ag-form \{ display:flex; flex-direction:column; min-height:0; flex:1 1 auto;\s*\n\s*background:none; border:0; padding:0; margin:0; \}/.test(H), "true");
  eq("147b) a janela virou título + corpo que rola + rodapé",
     /\.ag-jan-corpo \{ flex:1 1 auto; min-height:0; overflow-y:auto;/.test(H) &&
     /\.ag-jan-rodape \{ flex:none;/.test(H), "true");

  /* ==AGSALVAR== A TRAVA MAIS IMPORTANTE DESTA ETAPA.
     agSalvar() lê o VALOR de .ag-f-fim, .ag-f-rep, .ag-f-ate e .ag-f-desc. Se a seção
     recolhida tirasse o campo do HTML em vez de escondê-lo, salvar quebraria calado:
     hora de terminar sumindo, repetição virando "não repete", anotação apagada. */
  eq("148) a seção recolhida ESCONDE o campo, não o remove",
     /\.ag-secao \{ display:none; margin-top:9px; \}/.test(H) &&
     /\.ag-secao\.abre \{ display:block; \}/.test(H), "true");
  /* Teste apertado de propósito: procurar só o NOME da classe não serve — ele também
     aparece dentro do próprio agSalvar (box.querySelector(".ag-f-desc")). Tem que ser a
     classe SENDO ESCRITA no HTML, senão renomear o campo passa batido. */
  // e conferido em CADA formulário: o evento e a tarefa escrevem os seus próprios campos
  const FEV = (H.match(/function agFormHtml\(\)\{[\s\S]*?\n\}/)||[""])[0];
  const FTA = (H.match(/function agFormTarefaHtml\(\)\{[\s\S]*?\n\}/)||[""])[0];
  eq("148b) o formulário do EVENTO escreve todas as classes que agSalvar lê",
     ["ag-f-tit","ag-f-dia","ag-f-rep","ag-f-ate","ag-f-desc","ag-f-erro"]
       .filter(function(c){ return FEV.indexOf('class="'+c+'"')<0; }).join(",")||"todas", "todas");
  eq("148b3) e o formulário da TAREFA escreve as dela",
     ["ag-f-tit","ag-f-dia","ag-f-desc","ag-f-erro"]
       .filter(function(c){ return FTA.indexOf('class="'+c+'"')<0; }).join(",")||"todas", "todas");
  eq("148b2) e as duas horas continuam saindo do mesmo seletor de sempre",
     /agHoraHtml\("ag-f-hora"/.test(H) && /agHoraHtml\("ag-f-fim"/.test(H), "true");
  eq("148c) e o formulário continua marcando de que tipo ele é",
     /<div class="ag-form" data-tipo="evento">/.test(H) && /<div class="ag-form" data-tipo="tarefa">/.test(H), "true");
  eq("148d) agSalvar continua achando o formulário pelo mesmo caminho",
     /var box=btn\.closest\("\.ag-form"\); if\(!box\) return;/.test(H), "true");

  // PROGRESSIVE DISCLOSURE
  eq("149) o que já tem dado nasce ABERTO",
     /return \{ fim: !!\(ev&&ev\.hora_fim\), repetir: !!\(ev&&agRepete\(ev\)\),\s*\n\s*nota: !!\(ev&&ev\.descricao\), convidar: !!\(ev&&ev\.convidados&&ev\.convidados\.length\) \};/.test(H), "true");
  eq("149b) abrir uma seção NÃO redesenha o formulário (senão apaga o que foi digitado)",
     /if\(sec2\) sec2\.classList\.toggle\("abre", agSecs\[k\]\);/.test(H) &&
     /agRenderDia\(\);\s*return;\s*\n\s*\}\s*\n\s*var sb2=e\.target\.closest\("\[data-agsec\]"\)/.test(H)===false, "true");
  // esta faltava: uma mutação pôs agCloudLoad() no toggle e NENHUM teste reclamou
  eq("149b2) e abrir/fechar seção não fala com o banco",
     /var sb2=e\.target\.closest\("\[data-agsec\]"\);[\s\S]{0,900}?\n      \}/.test(H) &&
     /var sb2=e\.target\.closest\("\[data-agsec\]"\);[\s\S]{0,900}?\n      \}/.exec(H)[0]
       .search(/agCloudLoad|sb\.rpc|\.from\(|agInvalidar/) === -1, "true");
  eq("149c) o botão da seção diz se está aberta",
     /aria-expanded="'\+\(ab\?'true':'false'\)\+'"/.test(H), "true");
  eq("149d) e o aviso da série NUNCA é escondido",
     /\(ev&&agRepete\(ev\)\?'<div class="ag-f-serie">/.test(H), "true");

  // TAREFA continua separada
  eq("150) a tarefa não ganhou convidados, hora de fim nem repetição",
     /function agFormTarefaHtml\(\)\{[\s\S]*?\n\}/.exec(H)[0].indexOf("ag-f-rep")===-1 &&
     /function agFormTarefaHtml\(\)\{[\s\S]*?\n\}/.exec(H)[0].indexOf("ag-f-fim")===-1 &&
     /function agFormTarefaHtml\(\)\{[\s\S]*?\n\}/.exec(H)[0].indexOf("agConvidarHtml")===-1, "true");

  // CONVIDADOS: preservados, e sem a ambiguidade do "Adicionar"
  eq("151) o botãozinho dos convidados virou 'Incluir'",
     /data-agaddconv>Incluir<\/button>/.test(H), "true");
  eq("151b) e não existe mais dois 'Adicionar' na mesma tela",
     /data-agaddconv>Adicionar</.test(H), "false");
  eq("151c) confirmado, aguardando, recusado, motivo e remarcar continuam iguais",
     /data-agremarcar="'\+ev\.id\+'"/.test(H) && /Motivo: /.test(H) && /function agStPill\(st\)/.test(H), "true");

  // HIERARQUIA DAS AÇÕES
  eq("152) as ações moram num lugar só, com hierarquia",
     /function agEvAcoes\(ev\)\{/.test(H), "true");
  eq("152b) Excluir fica separado, à esquerda",
     /'<span class="ag-acoes-esq">'\+esq\+'<\/span>'/.test(H) && /\.ag-acoes-esq \{ margin-right:auto; \}/.test(H), "true");
  eq("152c) e Aceitar é o botão principal quando fui convidado",
     /'<button type="button" class="ag-salvar" data-agaceitar="'\+ev\.id\+'">Aceitar<\/button>'/.test(H), "true");
  eq("152d) 'fechar' quer dizer FECHAR — o ‹ voltar de um compromisso aberto sumiu",
     /data-agfecharjan/.test(H) && /'<div class="ag-volta"><button type="button" class="ag-link" data-agfechar>‹ voltar<\/button><\/div>'\+agEvHtml\(aberto\)/.test(H)===false, "true");

  // ESC EM CADEIA — o defeito que a inspeção encontrou
  eq("153) o Esc da lista de horas NÃO sobe pra fechar a janela",
     /e\.stopPropagation\(\); e\.preventDefault\(\);\s*\n\s*lista\.classList\.remove\("abre"\); t\.blur\(\);/.test(H), "true");

  // FOCO
  eq("154) o Tab não escapa da janela",
     /if\(e\.key!=="Tab" \|\| !agJanAberta\) return;/.test(H) &&
     /if\(e\.shiftKey && document\.activeElement===pri\)\{ e\.preventDefault\(\); ult\.focus\(\); \}/.test(H), "true");
  eq("154b) e o cursor volta pra onde estava quando a janela fecha",
     /if\(agQuemAbriu && agQuemAbriu\.focus && document\.contains\(agQuemAbriu\)\) agQuemAbriu\.focus\(\);/.test(H), "true");
  eq("154c) abrindo, o cursor vai pro título",
     /var t=document\.querySelector\("#agPainel \.ag-f-tit"\); if\(t\) t\.focus\(\);/.test(H), "true");
  eq("155) os campos têm rótulo de verdade, não só placeholder",
     /<label class="ag-f-lbl2" for="agFTit">/.test(H) && /<label class="ag-f-lbl2" for="agFDia">/.test(H), "true");

  // MOBILE: folha de baixo
  eq("156) no celular a janela vira folha de baixo",
     /\.ag-jan-bg \{ align-items:flex-end; padding:0; \}/.test(H), "true");
  eq("156b) largura toda, cantos só em cima, altura limitada",
     /\.ag-jan \{ max-width:none; width:100%; border-radius:16px 16px 0 0;\s*\n\s*max-height:calc\(100dvh - 28px\)/.test(H), "true");
  eq("156c) e o rodapé fica preso embaixo — a ação principal nunca some da tela",
     /\.ag-jan-rodape \{ position:sticky; bottom:0;/.test(H), "true");
  eq("156d) respeitando a borda de baixo do aparelho",
     /padding-bottom:max\(12px, env\(safe-area-inset-bottom\)\)/.test(H), "true");
  eq("156e) com alvos de dedo no × e nas ações",
     /\.ag-jan-x \{ width:44px; height:44px;/.test(H) &&
     /\.ag-acoes \.ag-salvar, \.ag-acoes \.ag-mini \{ min-height:44px;/.test(H), "true");
  eq("156f) e na lista de horas", /\.ag-hora-op \{ min-height:40px;/.test(H), "true");
  /* a folha de baixo trouxe um corpo com rolagem, e ele CORTAVA a lista de horas — a
     foto mostrou duas linhas só. No celular ela sai do fluxo e é posicionada pelo JS. */
  eq("156g) e a lista de horas não fica presa dentro do corpo que rola",
     /function agHoraColoca\(caixa, lista\)\{/.test(H) && /lista\.style\.position="fixed";/.test(H), "true");
  eq("156h) virando pra cima quando não cabe embaixo",
     /else if\(r\.top-10>=h\)\{ lista\.style\.top=Math\.round\(r\.top-4-h\)\+"px"; \}/.test(H), "true");
  eq("156i) e no computador ela continua exatamente como era",
     /if\(!agEhCelular\(\)\)\{ lista\.style\.position=""; /.test(H), "true");

  // DESKTOP continua compacto
  eq("157) no computador a janela continua 430px e no topo",
     /\.ag-jan \{ position:relative; background:#fff; border-radius:14px; width:100%; max-width:430px;/.test(H) &&
     /\.ag-jan-bg \{ display:none; position:fixed; inset:0;[^}]*align-items:flex-start/.test(H), "true");
  eq("157b) e a folha de baixo só existe dentro de media query",
     /\n  \.ag-jan-bg \{ align-items:flex-end/.test(H), "false");
}

console.log("\n" + (falhou ? "FALHOU: " + falhou + " de " + (ok + falhou) : "TUDO OK: " + ok + " testes") + "\n");
process.exit(falhou ? 1 : 0);
