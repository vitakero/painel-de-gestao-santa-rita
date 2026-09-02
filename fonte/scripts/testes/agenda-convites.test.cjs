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

/* ==BLOCO== Recortar por CHAVES, não por distância em caracteres.
   Três vezes hoje um teste destes quebrou só porque eu escrevi um comentário no meio do
   código que ele media — a janela [\s\S]{0,400} estourava e o teste acusava regressão
   que não existia. Medir o bloco inteiro não depende de quanto texto tem dentro. */
function bloco(texto, marcador) {
  const i = texto.indexOf(marcador);
  if (i < 0) return "";
  let n = 0; const j = texto.indexOf("{", i);
  if (j < 0) return "";
  for (let k = j; k < texto.length; k++) {
    if (texto[k] === "{") n++;
    else if (texto[k] === "}") { n--; if (!n) return texto.slice(i, k + 1); }
  }
  return "";
}

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
  /* 37) ATUALIZADO na Etapa J (01/09/2026): o interruptor foi DESLIGADO de propósito —
     o funcionário comum passou a poder convidar. O teste não some: passa a cobrar que a
     liberação seja consciente (o marcador ==JCONVITE== explica o que foi conferido antes)
     e que o interruptor continue existindo, para dar pra fechar de novo numa linha. */
  eq("37) o interruptor existe, e a Etapa J o desligou de propósito",
     /var AG_CONVITE_SO_MASTER = false;/.test(H) && /==JCONVITE==/.test(H), "true");
  eq("38) e é UMA linha pra liberar depois",
     /function agPodeConvidar\(\)\{ return AG_CONVITE_SO_MASTER \? agMaster\(\) : true; \}/.test(H), "true");
  /* 39) o portão continua existindo e continua sendo o mesmo: quem manda é
     agPodeConvidar(). Com o interruptor desligado ele libera todo mundo que tem a
     página — mas a linha que decide não mudou de lugar. */
  eq("39) a telinha de convidar continua atrás de agPodeConvidar()",
     /function agConvidarHtml\(\)\{\s*\n\s*if\(!agPodeConvidar\(\)\) return "";/.test(H), "true");
  eq("39b) e a lista de gente só é baixada por quem vai usar",
     /if\(!agPodeConvidar\(\) && !agMaster\(\)\) return;/.test(H), "true");
  /* A tranca que importa nunca foi a bandeira: é o banco. Estes dois cobram que ela
     continue de pé mesmo com o convite liberado. */
  eq("39c) o seletor de agenda alheia continua SÓ do master",
     /function agVerBarHtml\(\)\{\s*\n\s*if\(!agMaster\(\)\|\|agParte2===false\) return "";/.test(H), "true");
  // H: o Aceitar saiu do meio do texto e virou o botão principal do rodapé
  /* 40) ROBUSTO desde 01/09: media por distância em caracteres e quebrou quando a I5
     acrescentou um comentário e uma linha dentro do mesmo bloco (o botão foi parar a 634
     caracteres, a janela era 400). O recurso estava intacto. Agora mede o BLOCO. */
  {
    const convidado = bloco(H, "if(ev.meu_status && !meu && !olhando)");
    eq("40) mas continua podendo ACEITAR o que o master mandou",
       convidado.length > 0 && /data-agaceitar/.test(convidado), "true");
    eq("40b) e o Recusar continua no mesmo bloco",
       /data-agrecusar/.test(convidado), "true");
    eq("40c) o Aceitar só aparece pra quem ainda não respondeu",
       /ev\.meu_status==="aguardando"[\s\S]*?data-agaceitar/.test(convidado), "true");
  }
  /* 41) mesma história do 40: já precisei alargar a janela uma vez na I3. Passa a medir
     o bloco da função, que não depende de quanto comentário tem dentro dela. */
  {
    const resposta = bloco(H, "function agRespostaHtml(ev)");
    eq("41) e RECUSAR com motivo",
       resposta.length > 0 && /data-agrecusaok/.test(resposta), "true");
    eq("41b) com o campo do motivo junto",
       /class="ag-r-motivo"/.test(resposta), "true");
  }
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
  /* 60) ATUALIZADO na I3 (01/09). A versão anterior deste teste fixava o texto LITERAL
     da regra do agenda_trancar.sql — que era só "pessoa_id = auth.uid()". Essa regra
     estava certa para o que a etapa de 31/08 queria (ninguém responde pelo outro), mas
     deixava a porta do PATCH direto aberta para quem tinha PERDIDO o acesso. A I3
     endureceu a regra em sql/agenda_i3_resposta.sql. O teste não some: passa a cobrar
     que a parte antiga continue de pé E que os guardas novos estejam lá. */
  eq("60) a resposta do convite continua sendo só do convidado",
     /create policy agenda_conv_upd[\s\S]{0,400}pessoa_id = auth\.uid\(\)/.test(T), "true");
  eq("60b) e o agenda_trancar.sql continua sendo o arquivo que tirou o dono/master de lá",
     /A resposta do convite é do CONVIDADO/.test(T), "true");
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
  /* ==76C== Atualizado em 02/09/2026. A protecao que este teste guarda continua a mesma:
     sem a coluna no banco, o campo do fim NAO aparece — quem garante isso e o
     "agTemFim?sec(...)". O que saiu foi o botao "＋ Fim", e por decisao do dono: o
     Termina agora acompanha o Comeca ("se vai comecar as 07:45, tem que ter um fim"),
     entao nao ha mais o que um botao ligue ou desligue. O teste passa a cobrar as duas
     coisas: a protecao de pe, e o botao fora. */
  eq("76c) e esconde o campo em vez de prometer o que não dá",
     /\(agTemFim\?sec\("fim",/.test(H), "true");
  eq("76d) o botão ＋ Fim saiu — o Termina não depende mais de clique",
     /agSecBtn\("fim"/.test(H), "false");
  /* ==FIMSEMPRE== Historia curta e util: as 00:27 de 02/09 o "Termina" passou a aparecer
     JUNTO com a hora de comeco. As 00:40 o dono olhou e pediu que aparecesse desde que o
     formulario abre. Eu tinha recomendado o contrario — o banco recusa fim sem comeco —
     e ele decidiu assim mesmo. Entao a objecao virou trava, e e ela que estes dois
     cobram: o campo esta sempre la, e o estado invalido nao e alcancavel. */
  eq("76e) o Termina está na tela desde que o formulário abre",
     /if\(k==="fim"\) return true;/.test(H), "true");
  eq("76f) e pôr a hora de fim PUXA a de começo, senão o banco recusaria",
     /if\(!ini\.value\) agHoraDefine\(cxIni, agSoma\(v,-60\)\);/.test(H), "true");
  /* ==NAOPASSADAMEIANOITE== agSoma("00:30",-60) devolvia "-1:30" sem este piso — hora que
     nao existe. So virou alcancavel quando o fim ganhou o direito de puxar o comeco. */
  eq("76i) e a conta das horas não desce abaixo da meia-noite",
     /if\(t<0\) t=0;/.test(H), "true");
  eq("76j) o aviso de fim sem começo continua de pé, como segunda barreira",
     /Você pôs a hora de terminar sem a de começar\./.test(H), "true");
  /* ==REGRAMORTA== Esta regra existia desde que o campo de fim nasceu e NUNCA rodou: ela
     procurava o campo dentro de ".ag-f-row", caixa que este formulario nao tem. Medido no
     site no ar em 02/09: comeco 07:45 -> fim continuou vazio. Se alguem devolver o
     ".ag-f-row", ela morre de novo em silencio. */
  /* ==76G== Na primeira escrita este teste pegou a linha ERRADA: existe outro
     caixa.closest(".ag-f-row") no painel, legitimo, com fallback pro parentNode. Mirar
     em ".ag-f-row" solto acusava aquele. O que tem que sumir e a linha exata que estava
     dentro do agHoraDefine — a que fazia "if(!linha) return" e matava a regra em silencio. */
  eq("76g) e procura o campo no formulário, não numa caixa que não existe",
     /var forma=caixa\.closest\("\.ag-form"\); if\(!forma\) return;/.test(H), "true");
  eq("76h) e a busca que matava a regra não voltou",
     /var linha=caixa\.closest\("\.ag-f-row"\); if\(!linha\) return;/.test(H), "false");
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
  /* ==FEITAPOROCORRENCIA== O "btn" ganhou um "dia" na frente, e isso NAO e detalhe: e a
     assinatura que impede o defeito. Marcar sem dizer QUAL dia so podia significar "a
     serie inteira" — que e exatamente o que riscava todas as segundas do ano. */
  eq("98) dá pra marcar como feita, e sempre dizendo de que DIA",
     /function agFeita\(id, dia, btn\)/.test(H), "true");
  eq("98b) marcar é inserir a linha do dia, desmarcar é apagar — sem update",
     /\.from\("agenda_tarefa_feita"\)\.insert\(\{evento_id:id, dia:dia\}\)/.test(H) &&
     /\.from\("agenda_tarefa_feita"\)\.delete\(\)\.eq\("evento_id",id\)\.eq\("dia",dia\)/.test(H) &&
     /\.from\("agenda_tarefa_feita"\)\.update\(/.test(H)===false, "true");
  /* ==FEITAPOROCORRENCIA== quem desenha tem que perguntar pelo DIA. Se algum destes cinco
     voltar a ler ev.feita_em, aquele lugar volta a riscar a serie inteira — e so aquele,
     o que e pior de achar do que se voltassem todos. */
  /* Sete e o numero certo, e vale escrever de onde ele vem para ninguem "consertar"
     para cinco: os CINCO lugares que desenham (chip do mes, chip do sem-hora, bloco da
     semana, as acoes e o detalhe), mais a propria definicao da funcao, mais a chamada
     dentro do agFeita que decide se e para marcar ou desmarcar. */
  eq("98c) os cinco lugares que desenham perguntam pelo dia",
     (H.match(/agFeitaNoDia\(ev,/g) || []).length, 7);
  eq("98d) nenhum deles lê mais o feita_em da série",
     /feita=!!\(?ev(&&ev)?\.feita_em/.test(H), "false");
  eq("99) e ela aparece diferente no mês", /\.ag-chip\.tarefa \{/.test(H) && /\.ag-chip\.tarefa\.feita \{/.test(H), "true");
  const TA = fs.readFileSync(path.join(RAIZ, "sql/agenda_tarefas.sql"), "utf8");
  eq("100) o banco separa tarefa de compromisso",
     /add column if not exists tipo      text not null default 'evento'/.test(TA), "true");
  /* ==101== Este teste guardava a trava agenda_tarefa_simples_chk, escrita em 31/08 para
     manter a tarefa simples. Ela caiu em 02/09, em duas etapas e a pedido do dono: hora de
     fim primeiro (sql/agenda_tarefa_hora_fim.sql), repetição depois
     (sql/agenda_tarefa_repete.sql). O arquivo de 31/08 continua com o texto antigo, e tem
     que continuar — é o histórico. O que o teste passa a cobrar é a verdade de HOJE, que
     mora nos arquivos novos: a trava sai, e no lugar dela entra a marca por dia. */
  eq("101) o arquivo de 31/08 continua contando a história dele",
     /check \(tipo <> 'tarefa' or \(hora_fim is null and \(repete is null or repete = 'nao'\)\)\)/.test(TA), "true");
  {
    const TR = fs.readFileSync(path.join(RAIZ, "sql/agenda_tarefa_repete.sql"), "utf8");
    eq("101b) mas a trava foi retirada do banco",
       /alter table public\.agenda_eventos drop constraint if exists agenda_tarefa_simples_chk;/.test(TR), "true");
    eq("101c) e só depois de o \"feita\" virar por dia — a ordem importa",
       TR.indexOf("create table if not exists public.agenda_tarefa_feita") <
       TR.indexOf("drop constraint if exists agenda_tarefa_simples_chk"), "true");
    /* ==MIGRACAO== o que ja estava marcado nao pode sumir na troca de lugar */
    eq("101d) e o que já estava marcado como feito foi movido, não jogado fora",
       /insert into public\.agenda_tarefa_feita \(evento_id, dia, feita_em, feita_por, tenant_id\)/.test(TR) &&
       /where e\.tipo = 'tarefa' and e\.feita_em is not null/.test(TR), "true");
    /* ==DEFINER== consulta dentro de policy roda com a permissao de QUEM CHAMA — foi isso
       que derrubou o convite legitimo em 31/08. A checagem de dono mora numa funcao. */
    eq("101e) a checagem de dono é função SECURITY DEFINER, não consulta solta na regra",
       /create or replace function public\.agenda_tarefa_minha\(p_evento uuid\)[\s\S]{0,200}?security definer/.test(TR) &&
       (TR.match(/public\.agenda_tarefa_minha\(evento_id\)/g) || []).length, 3);
    eq("101f) e a tabela nova tem as três condições de sempre, nas três regras",
       (TR.match(/public\.eh_da_casa\(\)/g) || []).length >= 3 &&
       (TR.match(/public\.pode_pagina\('agenda'\)/g) || []).length >= 3, "true");
    eq("101g) a consulta do mês devolve os dias feitos",
       /feitas date\[\]/.test(TR) && /array_agg\(tf\.dia order by tf\.dia\)/.test(TR), "true");
    /* ==I4INTEIRA== a agenda_mes foi recriada; se alguma trava da I4 tivesse caido no
       caminho, a Agenda voltaria a responder para fornecedor e para quem perdeu a pagina. */
    /* ==101H== Na primeira escrita eu conferia so os ROTULOS (I4GUARDA, I4EMAIL...).
       A mutacao mostrou que isso nao vale nada: apaguei o comeco do bloco da guarda e o
       teste passou, porque o rotulo aparece duas vezes no arquivo (abre e "FIM"). Rotulo
       nao e trava. Agora cobro o CODIGO — as tres funcoes que fecham a Agenda para o
       fornecedor e para quem perdeu a pagina, na ordem e com o "return" que a I4 escolheu
       de proposito (com "raise", todo funcionario sem a pagina abriria o painel com erro
       na cara). Se a agenda_mes for recriada sem isto, a porta reabre calada. */
    eq("101h) a agenda_mes foi recriada com a GUARDA da I4, não só com o rótulo",
       /if not \( public\.eh_da_casa\(\)\s*\n\s*and public\.pode_pagina\('agenda'\)\s*\n\s*and public\.agenda_convidavel\(v_me\) \) then\s*\n\s*return;\s*\n\s*end if;/.test(TR), "true");
    eq("101i) e com as outras quatro decisões que ela carrega",
       /case when dp\.id is null then 'Pessoa removida'/.test(TR) &&        // I4EMAIL
       /\(e\.para_id = v_me\) as sou_dono/.test(TR) &&                     // I4DONO
       /and c2\.retirado_em is null\) as meu_status/.test(TR) &&            // I4ATIVO
       /'retirado',    \(c\.retirado_em is not null\)/.test(TR) &&         // I4SELO
       /c\.retirado_em is null or e\.para_id = v_me or v_master/.test(TR),  // I4HISTORICO
       "true");
  }
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

  /* ==TUDOABERTO== Estes quatro guardavam o "progressive disclosure": Repetir, Anotacao e
     Convidar ficavam atras de botoes "＋", e os testes cobravam que abrir uma secao nao
     redesenhasse o formulario nem falasse com o banco.
     Em 02/09/2026 o dono olhou a tela e disse: "nao gostei da funcionalidade desses
     botoes, queria que aparecesse o bicho todo completo e preencher so o que fosse
     necessario". O modelo inteiro saiu — botoes, tratador de clique, estilo e a funcao
     agSecBtn. Nao apaguei os testes: eles passaram a cobrar o modelo NOVO, e sobretudo
     que os restos do antigo nao voltem meio caminho (um botao sem tratador, ou um
     tratador sem botao, seriam piores do que qualquer um dos dois modelos inteiros). */
  eq("149) todas as seções do formulário nascem abertas",
     /return \{ fim: true, repetir: true, nota: true, convidar: true \};/.test(H), "true");
  eq("149b) e as quatro continuam sendo desenhadas",
     /sec\("fim",/.test(H) && /sec\("repetir",/.test(H) && /sec\("nota",/.test(H) && /sec\("convidar",/.test(H), "true");
  eq("149c) não sobrou botão de seção — nem no compromisso, nem na tarefa",
     /ag-secbts|agSecBtn|data-agsec/.test(H), "false");
  eq("149d) nem o estilo órfão dos botões",
     /\.ag-secbt/.test(H), "false");
  /* ==REDESENHO== O motivo original do 149b continua valendo mesmo sem botao: redesenhar o
     formulario apaga o que a pessoa ja digitou. Hoje sobrou UM redesenho depois de abrir a
     janela — o da lista de gente, que o proprio codigo justifica dizendo que chega em
     milissegundos. Se aparecer outro, esta trava obriga quem escrever a olhar aqui. */
  eq("149e) só a lista de gente redesenha o formulário depois de aberto",
     (H.match(/agPessoas=\(r&&!r\.error&&r\.data\)\?r\.data:\[\];   \/\/[^\n]*\n    agRenderDia\(\);/g) || []).length, 1);
  eq("149d) e o aviso da série NUNCA é escondido",
     /\(ev&&agRepete\(ev\)\?'<div class="ag-f-serie">/.test(H), "true");

  // TAREFA continua separada — menos a hora de terminar
  /* ==TAREFACOMFIM== A tarefa nasceu simples de proposito em 31/08: sem convidados, sem
     repeticao e sem hora de terminar. Em 02/09/2026 o dono pediu "o tempo de inicio e
     final" tambem na tarefa, e a razao e boa — "arrumar a gondola das 14h as 16h" e uma
     coisa que as pessoas escrevem e nao cabia. As outras DUAS ausencias continuam sendo
     decisao, e e por isso que este teste nao foi apagado: ele agora prova que so a hora de
     fim entrou, e que convidado e repeticao continuam de fora. */
  {
    const corpoTarefa = /function agFormTarefaHtml\(\)\{[\s\S]*?\n\}/.exec(H)[0];
    /* ==TAREFAREPETE== Sobrou UMA ausência de propósito: convidado. Tarefa é coisa a
       fazer, não reunião — quem precisa chamar gente marca compromisso. A repetição saiu
       da lista em 02/09, junto com o "feita" virando por dia. */
    eq("150) a tarefa continua sem convidados",
       corpoTarefa.indexOf("agConvidarHtml")===-1, "true");
    eq("150a) mas ganhou o mesmo seletor de repetição do compromisso",
       corpoTarefa.indexOf("ag-f-rep")>=0 && corpoTarefa.indexOf("Toda segunda a sexta")>=0 &&
       corpoTarefa.indexOf("ag-f-ate")>=0, "true");
    eq("150b) mas ganhou a hora de terminar, com os mesmos rótulos do compromisso",
       corpoTarefa.indexOf("ag-f-fim")>=0 && corpoTarefa.indexOf("Termina")>=0 && corpoTarefa.indexOf("Começa")>=0, "true");
    eq("150c) e o agTemFim continua mandando nela também",
       /\(agTemFim\?'<div class="ag-f-cpo"><span class="ag-f-lbl2">Termina<\/span>'\+/.test(corpoTarefa), "true");
  }
  /* ==TAREFACOMFIM== o agSalvar jogava fora a hora de fim de QUALQUER tarefa. Se o
     "ehTarefa" voltar para esta linha, o campo fica na tela e o valor some no caminho —
     defeito calado, o pior tipo. */
  eq("150d) e o agSalvar não joga mais fora a hora de fim da tarefa",
     /hora_fim:\(!hora\|\|!fim\)\?null:fim/.test(H) && /hora_fim:\(ehTarefa\|\|/.test(H)===false, "true");
  /* ==TAREFACOMFIM== a trava agenda_tarefa_simples_chk recusa tarefa com hora de fim ate
     o sql/agenda_tarefa_hora_fim.sql rodar. Quem esta na loja nao pode ver erro de banco. */
  eq("150e) e se o banco recusar, a pessoa lê português, não Postgres",
     /m\.indexOf\("agenda_tarefa_simples_chk"\)>=0/.test(H) &&
     /A hora de terminar em tarefas precisa de um ajuste no banco/.test(H), "true");

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
     /\.ag-jan-rodape \{ border-radius:0; position:sticky; bottom:0;/.test(H), "true");
  /* ==BORDADEBAIXO== O rodape e o ultimo filho, tem fundo branco e margem negativa ate a
     beirada: sem cantos proprios ele pinta POR CIMA do arredondado da janela e as duas
     pontas de baixo ficam quadradas. No celular, ao contrario, tem que ser reto — a folha
     encosta na borda do aparelho. */
  eq("156s) no computador o rodapé arredonda os cantos de baixo da janela",
     /background:#fff; border-radius:0 0 14px 14px; \}/.test(H), "true");
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
  /* ==156I== Este teste guardava uma decisao que envelheceu, e por isso foi REESCRITO em
     01/09/2026 em vez de apagado. Quando a folha de baixo chegou, o corte da lista foi
     consertado SO no celular, e ficou registrado aqui que no computador "continua
     exatamente como era". Mas o defeito era o mesmo nos dois — o corpo da janela rola, e
     rolar recorta o que passa da borda. O dono abriu "Comeca" no computador e viu duas
     linhas. Agora o teste cobra a decisao NOVA: nao existe mais desvio por aparelho. */
  eq("156i) no computador a lista tambem sai da moldura — sem desvio por aparelho",
     /if\(!agEhCelular\(\)\)\{ lista\.style\.position=""; /.test(H), "false");
  eq("156j) e ela acompanha o campo quando o corpo rola",
     /document\.addEventListener\("scroll", window\.__agHoraSegue, true\);/.test(H) &&
     /var ab=document\.querySelector\("\.ag-hora-lista\.abre"\);/.test(H), "true");
  eq("156k) a lista do Termina nao briga com o right:0 do CSS",
     /lista\.style\.right="auto";/.test(H), "true");
  /* ==ANELDOFOCO== o corpo tinha 398px e o campo do titulo tambem: o anel do foco nascia
     2px pra fora e era cortado dos dois lados. A folga devolvida por margem negativa nao
     move nada de lugar — se alguem tirar uma das duas metades, a conta quebra. */
  eq("156l) o corpo tem folga lateral pro anel do foco caber",
     /\.ag-jan-corpo \{[^}]*margin:0 -8px; padding:0 8px 4px;/.test(H), "true");
  eq("156m) os campos de hora preenchem a coluna, como o Dia",
     /\.ag-f-cpo \.ag-hora \{ display:block; \}/.test(H) &&
     /\.ag-f-cpo \.ag-hora-cx \{ display:flex; width:100%; box-sizing:border-box; \}/.test(H), "true");
  /* ==156N== Reescrito em 01/09/2026, no mesmo dia em que nasceu. A versao anterior
     cobrava que o "Termina" ficasse numa faixa propria embaixo, com meia largura. O dono
     olhou a tela e pediu o obvio: comeco e fim do mesmo compromisso na MESMA linha.
     Agora o teste cobra o arranjo novo — e cobra os dois tamanhos de tela, porque em
     375px as tres colunas nao cabem e o Termina tem que descer, nao espremer. */
  eq("156n) o Termina e a TERCEIRA coluna da mesma linha, nao uma faixa embaixo",
     /<div class="ag-f-dupla">'\+[\s\S]{0,600}?ag-f-cpo-dia[\s\S]{0,800}?agTemFim\?sec\("fim"[\s\S]{0,300}?'<\/div>'\+/.test(H), "true");
  eq("156o) a secao do Fim vira coluna quando abre",
     /\.ag-f-dupla \.ag-secao\.abre \{ flex:1 1 0; min-width:0; \}/.test(H), "true");
  /* ==PISODODIA== o campo de data pede 125px medidos; dividir 378 em tres da 126, um
     pixel de sobra. O piso de 140 e o que impede a data de ser espremida — se alguem
     tirar, o "01/09/2026" fica na beirada de cortar. */
  eq("156p) o campo Dia tem piso, senao a data fica a um pixel de cortar",
     /\.ag-f-dupla \.ag-f-cpo-dia \{ min-width:140px; \}/.test(H), "true");
  /* ==FIMNOCELULAR== base ZERO sempre "cabe", entao a linha nunca quebrava e o Termina
     espremia para 22px e vazava da folha. Medido em 375px antes de consertar. */
  eq("156q) no celular ele desce de linha em vez de espremer",
     /\.ag-f-dupla \.ag-secao\.abre \{ flex:1 1 130px; max-width:calc\(50% - 5px\); margin-top:9px; \}/.test(H), "true");
  eq("156r) e a lista de horas encosta no limite da tela em vez de vazar",
     /var esq=Math\.round\(r\.left\), teto=document\.documentElement\.clientWidth-larg-8;/.test(H) &&
     /lista\.style\.left=Math\.max\(8, Math\.min\(esq, teto\)\)\+"px";/.test(H), "true");

  // DESKTOP continua compacto
  /* ==157== A janela era 430px desde que nasceu. Passou para 500 em 02/09/2026, e por uma
     conta, nao por gosto: o dono pediu o "Convidar" ao lado do "Repetir", e medindo deu
     153px (o Repetir, por causa de "Toda segunda a sexta") + 283 (a linha do Convidar) +
     o vao = 446, contra os 398 uteis que a janela de 430 oferecia. Faltavam 48px, e
     encolher o "Setor..." cortaria nome de setor. Com 500 sobram 468 uteis.
     O resto do teste continua igual — ela e centrada e ancorada no TOPO, nao no meio. */
  eq("157) no computador a janela é 540px e fica no topo",
     /\.ag-jan \{ position:relative; background:#fff; border-radius:14px; width:100%; max-width:540px;/.test(H) &&
     /\.ag-jan-bg \{ display:none; position:fixed; inset:0;[^}]*align-items:flex-start/.test(H), "true");
  /* ==REPETIRECONVIDAR== O arranjo so existe se as duas secoes forem irmas dentro da
     mesma caixa. Se alguem devolver o Convidar para fora dela, ele volta a ser uma faixa
     inteira mais abaixo — e o formulario cresce de novo. */
  eq("157c) o Repetir e o Convidar são irmãos na mesma linha",
     /<div class="ag-f-baixo">'\+[\s\S]{0,900}?sec\("repetir"[\s\S]{0,900}?conv\?sec\("convidar",conv\):''\)\+\s*\n\s*'<\/div>'\+/.test(H), "true");
  eq("157d) e a linha deixa o Repetir com o que ele precisa e o Convidar com o resto",
     /\.ag-f-baixo \.ag-secao\[data-sec="repetir"\] \{ flex:0 0 auto; \}/.test(H) &&
     /\.ag-f-baixo \.ag-secao\[data-sec="convidar"\] \{ flex:1 1 260px; min-width:0; \}/.test(H), "true");
  /* ==SEPARADOR== o tracejado separava uma FAIXA do resto; virou risco solto no meio da
     linha quando o Convidar virou coluna. */
  eq("157e) e o tracejado solto do Convidar não voltou",
     /\.ag-f-baixo \.ag-f-conv \{ margin-top:0; border-top:0; padding-top:0; \}/.test(H), "true");
  /* ==DICASEMCIMA== O anel do foco desce 4px abaixo do campo (outline 2px + afastamento
     2px). A dica logo abaixo tinha margem de cima NEGATIVA (-2px), entao o anel cortava a
     linha "Vai repetir de segunda a sexta" ao meio — 6px de sobreposicao, medidos. A dica
     do "Convidar" tinha o mesmo defeito com os seletores de Setor e Pessoa.
     Este teste mede o VALOR, nao o texto: qualquer margem menor que 4 volta a cortar,
     inclusive uma que alguem escreva diferente mas igualmente pequena. */
  {
    const mTopo = (H.match(/\.ag-f-hint \{[^}]*margin:(-?\d+)px/) || [])[1];
    eq("158) a dica embaixo do campo tem espaço para o anel do foco",
       mTopo !== undefined && Number(mTopo) >= 4, "true");
    eq("158b) (quanto ela reserva hoje)", mTopo + "px", "6px");
  }
  /* ==INCLUIRVERDE== Pedido do dono. Verde de contorno, nao o verde cheio do "Adicionar":
     dois botoes solidos iguais fazem o olho nao saber qual salva a janela. E mirado no
     data-agaddconv porque a classe .ag-mini veste tambem Cancelar, Editar e Recusar. */
  eq("159) o botão Incluir é verde",
     /\.ag-mini\[data-agaddconv\] \{ color:#12692f; border-color:#bfe0c9; background:#f2f8f4; font-weight:600; \}/.test(H), "true");
  eq("159b) e o Adicionar continua sendo o único verde cheio",
     /\.ag-salvar \{ border:0; background:#157a35; color:#fff;/.test(H), "true");
  /* ==CONVIDARNAOVAZA== Erro de dimensionamento meu: medi a coluna do Convidar com o
     seletor VAZIO ("Pessoa...", 91px). Escolhida uma pessoa de verdade ele vai a 132
     (JOSEILMA ALVARES DE FARIA) e a conta estoura a coluna em 19px — o "Incluir" saia
     cortado pela borda. A fileira passou a poder quebrar e os seletores a dividir a
     largura. Estas duas linhas sao o que impede o corte; sem qualquer uma delas ele volta. */
  eq("160) a fileira do Convidar pode quebrar em vez de vazar",
     /\.ag-f-baixo \.ag-f-conv \.ag-f-row \{ flex-wrap:wrap; \}/.test(H), "true");
  eq("160b) e os seletores dividem a coluna em vez de ter largura própria",
     /\.ag-f-baixo \.ag-f-conv select\.ag-c-setor,\s*\n\s*\.ag-f-baixo \.ag-f-conv select\.ag-c-pessoa \{ flex:1 1 90px; min-width:0; max-width:none; \}/.test(H), "true");
  /* ==INCLUIRNALINHA== O dono quis o botao de volta AO LADO dos seletores. Para isso a
     janela foi de 500 para 540 (coluna do Convidar de 286 para 326) e a base dos seletores
     de 120 para 90 — a base e o ponto em que eles param de encolher. Com 326 sobram 126px
     por seletor depois do botao e dos vaos, e os tres cabem numa linha so.
     A quebra continua no CSS, mas deixou de ser o normal: virou rede para tela estreita ou
     nome ainda maior. O que nao pode voltar e o botao ser cortado pela borda. */
  eq("160c) e o botão não encolhe junto — ele mantém o tamanho ao lado deles",
     /\.ag-f-baixo \.ag-f-conv \[data-agaddconv\] \{ flex:0 0 auto; \}/.test(H), "true");
  /* ==FIACAO== A trava que eu queria ter tido a noite inteira. Ela varre a Agenda e
     compara os dois lados da fiacao:
       · todo data-ag* DESENHADO na tela tem alguem que trata o clique;
       · todo tratador tem algum botao que o desenhe.
     O primeiro lado pega botao que nao faz nada — o pior defeito de todos, porque a
     pessoa clica, nao acontece nada, e ela acha que errou. O segundo pega codigo morto,
     que engana quem for ler depois.
     Foi assim que achei o data-agfechar: sobrou de quando a janela fechava de outro
     jeito, e ficou ali sem botao nenhum. */
  {
    const desenhados = new Set();
    for (const m of H.matchAll(/data-(ag[a-z0-9]+)(?=[\s>='"])/gi)) desenhados.add(m[1].toLowerCase());
    const tratados = new Set();
    for (const m of H.matchAll(/\[data-(ag[a-z0-9]+)\]/gi)) tratados.add(m[1].toLowerCase());
    for (const m of H.matchAll(/getAttribute\("data-(ag[a-z0-9]+)"\)/gi)) tratados.add(m[1].toLowerCase());
    const semDono = [...desenhados].filter(x => !tratados.has(x)).sort();
    const orfaos  = [...tratados].filter(x => !desenhados.has(x)).sort();
    eq("199) nenhum botão da Agenda fica sem quem trate o clique",
       semDono.join(", ") || "nenhum", "nenhum");
    eq("199b) e nenhum tratador ficou sem botão que o desenhe",
       orfaos.join(", ") || "nenhum", "nenhum");
    eq("199c) (e a varredura achou coisa de verdade, não zero dos dois lados)",
       desenhados.size >= 20 && tratados.size >= 20, "true");
  }
  eq("157b) e a folha de baixo só existe dentro de media query",
     /\n  \.ag-jan-bg \{ align-items:flex-end/.test(H), "false");
}


// ================ ETAPA I1: o aviso ao vivo, e o que ele NÃO pode assinar ================
{
  /* ==AGRTDEL== A TRAVA DESTE BLOCO.
     Em 01/09/2026 eu liguei as tabelas da Agenda no tempo real e MEDI, com login de
     gente, o que cada tipo de conta recebia. Criar e editar são filtrados pelo RLS: o
     forasteiro (conta do Portal do Fornecedor) recebia ZERO.
     A EXCLUSÃO não é filtrada — é limite conhecido do Supabase. O aviso de apagar chegava
     ao forasteiro com o identificador da linha dentro. Pouca informação, mas informação
     de dentro de casa. O dono mandou fechar.
     Por isso a Agenda assina EVENTO POR EVENTO. Se alguém voltar a pôr event:"*" (que
     inclui DELETE) ou assinar DELETE de propósito, o vazamento volta calado — e é isso
     que estes testes existem pra impedir. */
  const RT = (H.match(/function agRealtime\(\)\{[\s\S]*?\n\}/) || [""])[0];
  eq("158) o ouvinte da Agenda existe", RT.length > 50, "true");
  eq("158b) e NÃO usa event:\"*\" (que arrastaria o DELETE junto)",
     /event:"\*"/.test(RT), "false");
  eq("158c) nem assina DELETE de propósito",
     /event:"DELETE"/.test(RT), "false");
  eq("159) assina CRIAR nas duas tabelas",
     /\{event:"INSERT",schema:"public",table:"agenda_eventos"\}/.test(RT) &&
     /\{event:"INSERT",schema:"public",table:"agenda_convidados"\}/.test(RT), "true");
  eq("159b) e EDITAR nas duas",
     /\{event:"UPDATE",schema:"public",table:"agenda_eventos"\}/.test(RT) &&
     /\{event:"UPDATE",schema:"public",table:"agenda_convidados"\}/.test(RT), "true");
  eq("159c) são quatro assinaturas, nem uma a mais",
     (RT.match(/postgres_changes/g) || []).length, 4);
  // o preço da decisão não pode ser pago com relógio
  eq("160) e ninguém compensou o DELETE com consulta de tempos em tempos",
     /function agRealtime\(\)\{[\s\S]*?\n\}/.exec(H)[0].search(/setInterval/) === -1, "true");
  eq("160b) o debounce de 700ms continua (não dispara em rajada)",
     /deb=setTimeout\(function\(\)\{ agInvalidar\(\); agCloudLoad\(true\); agBadge\(\); \},700\);/.test(RT), "true");
  eq("160c) e recarrega DE FUNDO — sem piscar nem apagar o que está sendo digitado",
     /agCloudLoad\(true\)/.test(RT), "true");
}

/* ============================================================================
   I2 — A CONSULTA E A BOLINHA (01/09/2026)
   Dois defeitos que ninguém via na tela, só no fio:
     · a bolinha respondia "min(greatest(data, hoje))" — que é HOJE, não a próxima
       volta da série. Semanal de 02/08 mandava a pessoa pro dia 01/09, um dia sem
       compromisso nenhum;
     · agenda_mes trazia série morta em 2024 em TODA carga de outubro/2026, pra
       sempre — quem descartava era o navegador, DEPOIS de baixar.
   Provado com login de gente em scripts/conferir-agenda-proxima.mjs (24 checagens),
   scripts/conferir-agenda-i2-seguranca.mjs (30) e conferir-agenda-bolinha-x-tela.mjs
   (13, que confere o banco contra a conta do NAVEGADOR publicado).
   Estes testes aqui são o cadeado: se alguém reescrever o SQL sem entender, quebram. */
{
  const I2 = fs.readFileSync(path.join(RAIZ, "sql", "agenda_i2_consulta.sql"), "utf8");
  const BOL = I2.slice(I2.indexOf("create or replace function public.agenda_convites_pendentes"),
                       I2.indexOf("create or replace function public.agenda_mes"));
  const MES = I2.slice(I2.indexOf("create or replace function public.agenda_mes"),
                       I2.indexOf("-- 3) As permissões"));

  eq("161) a bolinha não responde mais com greatest(data, hoje)",
     /min\(\s*greatest\(\s*e\.data\s*,\s*current_date\s*\)\s*\)/.test(BOL), "false");
  eq("161b) ela responde com a próxima volta calculada",
     /min\(quando\)/.test(BOL), "true");
  eq("162) as cinco regras de repetição estão na conta",
     ["'dia'", "'uteis'", "'semana','quinzena'", "'mes'"].every(r => BOL.indexOf(r) > 0), "true");
  eq("162b) semana e quinzena contam A PARTIR DA ORIGEM, não de hoje",
     /p\.data \+ \(case when current_date <= p\.data then 0/.test(BOL), "true");
  eq("162c) e o passo da quinzena é 14",
     /when p\.repete = 'quinzena' then 14 else 7 end as passo/.test(BOL), "true");
  eq("163) a regra mensal DESCARTA o mês que não tem aquele dia (nada de 31/02)",
     /where extract\(day from t\.cand\)::int = extract\(day from p\.data\)::int/.test(BOL), "true");
  eq("163b) e procura mês a mês em vez de somar 30 dias",
     /generate_series\(0, 14\)/.test(BOL), "true");
  eq("164) o fim da série é comparado com a VOLTA, não com hoje",
     /repete_ate is null or quando <= repete_ate/.test(BOL), "true");
  eq("164b) — e não com current_date, que deixaria passar série viva sem volta nenhuma",
     /repete_ate\s*>=\s*current_date/.test(BOL), "false");
  eq("164c) volta que não existe (série avulsa já passada) não conta",
     /where quando is not null/.test(BOL), "true");

  eq("165) agenda_mes ganhou o filtro que faltava",
     /and \(e\.repete_ate is null or e\.repete_ate >= p_ini\)/.test(MES), "true");
  eq("165b) e ele fica DENTRO do ramo das séries antigas, não solto no where",
     /e\.data < p_ini\s*\n[\s\S]{0,400}?and \(e\.repete_ate is null or e\.repete_ate >= p_ini\)\) \)/.test(MES), "true");
  eq("166) agenda_mes continua devolvendo as 15 colunas de sempre",
     ["id uuid", "hora_fim time", "tipo text", "feita_em timestamptz",
      "dono_nome text", "sou_dono boolean", "meu_status text", "convidados jsonb"]
       .every(c => MES.indexOf(c) > 0), "true");
  eq("166b) e a trava de ver agenda alheia continua de pé",
     /Só o master pode ver a agenda de outra pessoa/.test(MES), "true");
  eq("166c) a pessoa continua vencendo o setor",
     /if v_alvo is not null then v_setor := null; end if;/.test(MES), "true");

  eq("167) o arquivo não derruba função nenhuma (DROP leva os grants junto)",
     /\bdrop\s+function\b/i.test(I2), "false");
  eq("167b) são exatamente duas funções, nem uma a mais",
     (I2.match(/create or replace function/g) || []).length, 2);
  eq("167c) e nenhuma delas é a agenda_responder, o gatilho ou o auto-convite",
     /agenda_responder|create (or replace )?trigger|agenda_auto_convite/i.test(I2), "false");
  eq("168) as duas continuam security definer com o caminho travado",
     (I2.match(/security definer set search_path = public/g) || []).length, 2);
  eq("169) as permissões foram reaplicadas para quem está logado",
     (I2.match(/grant execute on function public\.(agenda_convites_pendentes|agenda_mes)/g) || []).length, 2);
  eq("169b) e tiradas do público",
     (I2.match(/revoke all on function/g) || []).length, 2);
  eq("170) não mexe em regra de acesso, gatilho nem publicação",
     /create policy|alter policy|drop policy|enable row level security|alter publication/i.test(I2), "false");
}

/* ============================================================================
   I3 — REGRAS DE RESPOSTA (01/09/2026)
   Três defeitos provados com login de gente antes de mexer:
     · a recusa aceitava data no passado (01/01/2020 gravou);
     · aceitava a MESMA data do compromisso — e o formulário JÁ NASCIA preenchido
       com ela, então o caminho normal do usuário produzia uma remarcação que não
       remarcava. O dono ficava com um "Sugeriu <mesmo dia>" que o botão não resolvia,
       porque o gatilho agenda_remarcou só reseta se dia ou hora MUDAM;
     · quem perdeu o acesso continuava respondendo — inclusive com a ficha APAGADA.
   E o achado que decidiu onde cada regra mora: existem DUAS PORTAS (a função, que é
   SECURITY DEFINER e pula as regras de acesso, e o PATCH direto, que passa por elas).
   O gatilho é o único ponto por onde as duas passam — provado pelo respondido_em.
   Bancada: scripts/conferir-agenda-i3.mjs (login de gente, as duas portas). */
{
  const I3 = fs.readFileSync(path.join(RAIZ, "sql", "agenda_i3_resposta.sql"), "utf8");
  const corpo = n => {
    const i = I3.indexOf("create or replace function public." + n);
    if (i < 0) return "";
    const a = I3.indexOf("$$", i), b = I3.indexOf("$$", a + 2);
    return I3.slice(a, b);
  };
  const REGRA = corpo("agenda_conv_regra");
  const RESP  = corpo("agenda_responder");
  const CONV  = corpo("agenda_convidavel");
  const PESS  = corpo("agenda_pessoas");
  const POL   = I3.slice(I3.indexOf("create policy agenda_conv_upd"));

  // ---- as regras de data, no gatilho (o ponto por onde as DUAS portas passam)
  /* 171/171b ATUALIZADOS no conserto do fuso: a comparação deixou de ser com
     current_date (o dia do SERVIDOR, que está em UTC) e passou a ser com o dia da
     LOJA. O que o teste cobra — que existe a regra e que o sinal é o certo — não
     mudou. Ver o bloco ==I3FUSO== mais abaixo. */
  eq("171) o gatilho barra data sugerida no passado",
     /new\.sug_data < public\.agenda_hoje\(\)/.test(REGRA), "true");
  eq("171b) e o sinal é < , não <= nem >",
     /sug_data <= public\.agenda_hoje|sug_data > public\.agenda_hoje|sug_data >= public\.agenda_hoje/.test(REGRA), "false");
  eq("172) o gatilho barra sugerir o mesmo dia E a mesma hora",
     /e\.data = new\.sug_data/.test(REGRA) && /e\.hora is not distinct from new\.sug_hora/.test(REGRA), "true");
  eq("172b) a hora é comparada de um jeito que aguenta campo vazio",
     /is not distinct from new\.sug_hora/.test(REGRA), "true");
  eq("172c) — e NÃO com igual simples, que deixaria passar os dois vazios",
     /e\.hora = new\.sug_hora/.test(REGRA), "false");
  eq("173) as duas regras só valem quando a resposta está sendo dada ou mexida",
     /if v_respondendo then/.test(REGRA), "true");
  eq("173b) e 'respondendo' olha status, sug_data e sug_hora",
     /new\.status   is distinct from old\.status/.test(REGRA)
     && /new\.sug_data is distinct from old\.sug_data/.test(REGRA)
     && /new\.sug_hora is distinct from old\.sug_hora/.test(REGRA), "true");
  eq("173c) no INSERT ele não tenta ler o OLD (que não existe)",
     /if tg_op = 'INSERT' then\s*\n\s*v_respondendo := true;/.test(REGRA), "true");
  eq("174) o que já era cobrado continua: motivo e nova data",
     /Escreva o motivo da recusa/.test(REGRA) && /Sugira uma nova data ao recusar/.test(REGRA), "true");
  eq("174b) e o aceite continua limpando a recusa antiga",
     /new\.motivo := null; new\.sug_data := null; new\.sug_hora := null;/.test(REGRA), "true");
  eq("174c) o carimbo de respondido_em continua igual",
     /new\.respondido_em := now\(\)/.test(REGRA), "true");
  eq("174d) e ninguém troca de dono do convite",
     /Não dá pra mudar de quem é o convite/.test(REGRA), "true");

  // ---- porta 1: a função
  eq("175) a função exige os TRÊS guardas",
     /public\.eh_da_casa\(\)/.test(RESP) && /public\.pode_pagina\('agenda'\)/.test(RESP)
     && /public\.agenda_convidavel\(v_me\)/.test(RESP), "true");
  eq("175b) e o recado é em português, não um código do banco",
     /Seu acesso à Agenda foi retirado/.test(RESP), "true");
  eq("175c) a checagem vem ANTES de escrever qualquer coisa",
     RESP.indexOf("eh_da_casa") < RESP.indexOf("update public.agenda_convidados"), "true");
  eq("175d) e continua gravando só o convite de quem chamou",
     /where evento_id = p_evento and pessoa_id = v_me;/.test(RESP), "true");

  // ---- porta 2: a regra de escrita direta
  eq("176) a regra de UPDATE ganhou os mesmos três guardas",
     /public\.eh_da_casa\(\)/.test(POL) && /public\.pode_pagina\('agenda'\)/.test(POL)
     && /public\.agenda_convidavel\(auth\.uid\(\)\)/.test(POL), "true");
  eq("176b) nos DOIS lados: alcançar a linha e poder gravar nela",
     (POL.match(/public\.eh_da_casa\(\)/g) || []).length, 2);
  eq("176c) e o convidado continua sendo o único a mexer no dele",
     (POL.match(/pessoa_id = auth\.uid\(\)/g) || []).length, 2);

  // ---- quem pode ser convidado
  eq("177) agenda_convidavel passou a exigir a página Agenda",
     /like '%,agenda,%'/.test(CONV), "true");
  eq("177b) e continua exigindo pessoa válida da empresa",
     /coalesce\(p\.aprovado,false\) or coalesce\(p\.is_master,false\)/.test(CONV), "true");
  eq("177c) o master passa direto, mesmo com a lista vazia",
     /coalesce\(p\.is_master,false\)\s*\n\s*or \(','/.test(CONV), "true");
  eq("177d) ela olha a pessoa recebida, NUNCA auth.uid()",
     /p\.id = p_pessoa/.test(CONV) && !/auth\.uid\(\)/.test(CONV), "true");
  /* A armadilha: pode_pagina('agenda') pergunta pelo auth.uid(), quem está CHAMANDO.
     Usá-la aqui responderia sobre a pessoa errada — e daria certo por acaso quase
     sempre, porque quem convida costuma ter a página. */
  eq("177e) e NÃO chama pode_pagina, que perguntaria pela pessoa errada",
     /pode_pagina/.test(CONV), "false");
  eq("177f) continua security definer com o caminho travado",
     /security definer set search_path = public/.test(I3.slice(I3.indexOf("agenda_convidavel"), I3.indexOf("agenda_convidavel") + 400)), "true");

  /* ==I3EQV== As duas funções têm que entender "tem a página Agenda" da MESMA forma.
     Se uma mudar e a outra não, a lista passa a oferecer gente que o banco recusa (ou
     o contrário) e ninguém percebe. O teste compara o miolo da conta letra por letra;
     a prova de comportamento está em conferir-agenda-i3.mjs, com 10 formatos de perfil. */
  const PP = fs.readFileSync(path.join(RAIZ, "sql", "permissoes_padrao.sql"), "utf8");
  const limpa = t => (t.match(/regexp_replace\(coalesce\(p\.paginas::text, ?''\), ?'\[\]\[\{\}" \]', ?'', ?'g'\)/) || [""])[0];
  eq("178) agenda_convidavel limpa a lista de páginas igual a pode_pagina",
     limpa(CONV) !== "" && limpa(CONV) === limpa(PP), "true");
  eq("178b) e monta a comparação com vírgula dos dois lados, igual",
     /\(',' \|\| regexp_replace/.test(CONV) && /\|\| ','\)/.test(CONV), "true");

  // ---- a lista de convidar
  eq("179) a lista de convidar usa a MESMA função da regra de convidar",
     /public\.agenda_convidavel\(p\.id\)/.test(PESS), "true");
  eq("179b) e não tem mais a regra escrita à parte, que podia divergir",
     /coalesce\(p\.aprovado,false\) or coalesce\(p\.is_master,false\)/.test(PESS), "false");
  eq("179c) quem chama continua precisando ser da casa e ter a página",
     /public\.eh_da_casa\(\)/.test(PESS) && /public\.pode_pagina\('agenda'\)/.test(PESS), "true");

  /* ==I3FUSO== A VIRADA DO DIA. Achado depois da I3 pronta, e era bloqueador.
     A regra usava current_date. Medi o banco de fora: o carimbo now() volta com
     "+00:00", ou seja a sessão está em UTC — e o Postgres define current_date como a
     data de now() no fuso da sessão. Resultado: das 21:00 às 23:59:59 do relógio da
     loja o servidor já virou o dia e a loja não, então escolher HOJE seria recusado
     com "essa data já passou". Todo dia, sempre no fim do expediente.
     O conserto é local à Agenda: agenda_hoje() pergunta o dia civil da loja por
     extenso. Nada de mexer no fuso do banco inteiro. */
  const HOJEF = corpo("agenda_hoje");
  eq("186) existe uma função que diz que dia é hoje PARA A LOJA",
     HOJEF.length > 10, "true");
  eq("186b) e ela nomeia o fuso por extenso, sem depender da sessão do banco",
     /now\(\) at time zone 'America\/Fortaleza'/.test(HOJEF), "true");
  eq("186c) devolvendo uma data, não um instante",
     /\)::date/.test(HOJEF), "true");
  eq("187) a regra da data passada usa o dia da LOJA",
     /new\.sug_data < public\.agenda_hoje\(\)/.test(REGRA), "true");
  eq("187b) e NÃO current_date, que é o dia do servidor (UTC)",
     /new\.sug_data < current_date/.test(REGRA), "false");
  /* Nenhum CORPO DE FUNÇÃO pode voltar a usar current_date. O resto do arquivo pode:
     os comentários explicam por que não se usa, e a conferência do fim COMPARA
     current_date com o dia da loja de propósito — é ela que mostra a diferença. */
  const corposI3 = ["agenda_hoje","agenda_convidavel","agenda_pessoas",
                    "agenda_conv_regra","agenda_responder"].map(corpo).join("\n");
  eq("187c) nenhum corpo de função usa current_date",
     corposI3.split("\n").filter(l => l.indexOf("current_date") >= 0 && !l.trim().startsWith("--")).length, 0);
  eq("187d) e a conferência do fim compara os dois, pra diferença aparecer",
     /a Agenda está certa\?/.test(I3) && /o servidor e a loja concordam agora\?/.test(I3), "true");
  eq("188) o fuso não é mexido no banco inteiro, só na regra da Agenda",
     /set time ?zone|alter database .* set timezone/i.test(I3), "false");

  // ---- higiene do arquivo
  eq("180) nenhuma função é derrubada (DROP leva os grants junto)",
     /\bdrop\s+function\b/i.test(I3), "false");
  eq("180b) são exatamente cinco funções (a quinta é a do fuso)",
     (I3.match(/create or replace function/g) || []).length, 5);
  eq("180c) e uma policy só",
     (I3.match(/^create policy/gm) || []).length, 1);
  eq("180d) as cinco continuam security definer com caminho travado",
     (I3.match(/security definer set search_path = public/g) || []).length, 5);
  eq("181) não toca em agenda_mes, na bolinha, no Realtime nem na publicação",
     /function public\.agenda_mes|function public\.agenda_convites_pendentes|alter publication/i.test(I3), "false");
  eq("181b) nem nas regras de agenda_eventos (ficou pra auditoria própria)",
     /policy agenda_(sel|ins|upd|del) on public\.agenda_eventos/.test(I3), "false");
  eq("182) os grants foram reaplicados para quem está logado",
     (I3.match(/grant execute on function/g) || []).length, 4);
  /* O catálogo mostrou anon=X em todas as funções da Agenda, e eu confirmei de fora
     que quem não logou consegue CHAMAR agenda_responder (ela roda e barra por dentro).
     Ou seja: permissão de execute não é tranca. O arquivo tem que dizer isso. */
  eq("182b) e o arquivo registra que permissão de EXECUTE não é a tranca",
     /permissão de EXECUTE não é a tranca|anon=X\/postgres/.test(I3), "true");

  // ---- o formulário entra no mesmo passo
  const REC = (H.match(/function agRespostaHtml\(ev\)\{[\s\S]*?\n\}/) || [""])[0];
  eq("183) o campo de data ganhou piso em hoje",
     /class="ag-r-data" value="" min="/.test(REC), "true");
  eq("183b) e NÃO nasce mais preenchido com o dia aberto",
     /class="ag-r-data" value="'\+agEsc\(agSel/.test(REC), "false");
  const CLIQUE = (H.match(/var rok=e\.target\.closest\("\[data-agrecusaok\]"\);[\s\S]{0,3000}?\n      \}/) || [""])[0];
  eq("184) a tela avisa antes de enviar: dia que já passou",
     /if\(nd < agHojeISO\(\)\) return rMsg\(/.test(CLIQUE), "true");
  eq("184b) e mesmo dia com a mesma hora",
     /if\(nd===rdia && \(nh\|\|""\)===rhr\)/.test(CLIQUE), "true");
  /* Numa série, ev.data é o COMEÇO da série — quase nunca a volta que a pessoa clicou.
     Por isso a tela compara com agSel, a ocorrência aberta. O servidor não tem como
     saber qual volta foi clicada: ninguém manda essa informação pra ele. */
  eq("184c) e compara com a OCORRÊNCIA ABERTA, não com o começo da série",
     /var rdia=agSel\|\|\(rev&&rev\.data\)\|\|"";/.test(CLIQUE), "true");
  eq("184d) as duas validações que já existiam continuam",
     /if\(!mot\) return rMsg/.test(CLIQUE) && /if\(!nd\)  return rMsg/.test(CLIQUE), "true");
  eq("184e) e o envio continua sendo o mesmo RPC, sem consulta nova",
     /agResponder\(rid,"recusado",mot,nd,nh\|\|null,/.test(CLIQUE), "true");
  eq("185) o contrato dos campos que agSalvar/agResponder leem continua de pé",
     /class="ag-r-motivo"/.test(REC) && /class="ag-r-data"/.test(REC) && /ag-r-hora/.test(REC), "true");
}

/* ============================================================================
   I5 — COMPROMISSO QUE SE REPETE (01/09/2026)
   Dois lados da mesma história: a série mudou debaixo dos pés do convidado.
     I5.1 a série é UMA linha no banco — recusar recusa TODAS as vezes. O botão dizia
          só "Recusar" e a pessoa achava que dispensava o dia que estava aberto.
     I5.2 o gatilho que faz todo mundo reconfirmar olhava data, hora e hora_fim, e NÃO
          olhava a repetição. O dono pegava um almoço avulso já confirmado, ligava
          "toda semana", e as pessoas continuavam "Confirmado" para uma série que
          nunca viram. Medido antes de mexer.
   Bancada: scripts/conferir-agenda-i5.mjs (login de gente + o desenho do painel real). */
{
  const I5 = fs.readFileSync(path.join(RAIZ, "sql", "agenda_i5_serie.sql"), "utf8");
  const REM = I5.slice(I5.indexOf("create or replace function public.agenda_remarcou"));

  // ---- I5.2, o banco
  eq("189) o gatilho passou a olhar a repetição",
     /new\.repete     is distinct from old\.repete/.test(REM), "true");
  eq("189b) e o 'repetir até' também",
     /new\.repete_ate is distinct from old\.repete_ate/.test(REM), "true");
  /* A regra é UMA só, ampliada — não uma segunda lógica em paralelo. Se alguém
     escrever um if separado para a repetição, os dois caminhos divergem com o tempo. */
  eq("189c) é a MESMA condição, ampliada — não um segundo if",
     (REM.match(/^\s*if /gm) || []).length, 1);
  eq("190) as três condições antigas continuam de pé",
     /new\.data     is distinct from old\.data/.test(REM)
     && /new\.hora     is distinct from old\.hora/.test(REM)
     && /new\.hora_fim is distinct from old\.hora_fim/.test(REM), "true");
  /* ==NEUTRO== Procurar o TEXTO da condição não basta: dá pra deixar a linha lá e
     desligá-la com um "false and" na frente, e o teste não vê. Peguei isso numa mutação.
     Então também cobro a FORMA: o if começa direto na condição da data, e as cinco
     condições estão todas ligadas por "or" — nenhuma neutralizada. */
  eq("190c) o if começa direto na condição, sem nada desligando",
     /^  if new\.data     is distinct from old\.data$/m.test(REM), "true");
  eq("190d) são cinco condições, todas ligadas por 'or'",
     (REM.match(/is distinct from/g) || []).length, 5);
  eq("190e) e nenhuma foi neutralizada com false/true no meio",
     /\b(false|true)\s+and\b|\band\s+(false|true)\b/.test(REM), "false");
  eq("190b) e o que ele faz continua sendo o mesmo",
     /set status='aguardando', motivo=null, sug_data=null, sug_hora=null, respondido_em=null/.test(REM), "true");
  /* A trava da I4: quem foi retirado não volta a "aguardando" quando o compromisso muda.
     Sem isso, mexer na repetição ressuscitaria o histórico de quem já saiu. */
  eq("191) a trava da I4 continua: retirado não ressuscita",
     /and retirado_em is null;\s*--\s*==I4ATIVO==/.test(REM), "true");
  eq("191b) e só mexe em quem já tinha respondido",
     /and status <> 'aguardando'/.test(REM), "true");
  eq("192) o arquivo mexe numa função só, sem derrubar nada",
     (I5.match(/create or replace function/g) || []).length === 1 && !/\bdrop\b/i.test(I5), "true");
  eq("192b) e não encosta em policy, tabela nem outra função",
     /create policy|alter table|alter publication|agenda_responder|agenda_conv_regra/i.test(I5), "false");
  eq("192c) continua security definer com o caminho travado",
     /security definer set search_path = public/.test(I5), "true");
  /* Título e anotação nunca derrubaram resposta, e não podem passar a derrubar:
     mudar o texto do compromisso não é mudar o compromisso. */
  eq("193) título e anotação continuam FORA da condição",
     /new\.titulo|new\.descricao/.test(REM), "false");

  // ---- I5.1, a tela
  const ACOES = (H.match(/function agEvAcoes\(ev\)\{[\s\S]*?\n\}/) || [""])[0];
  const RESP  = (H.match(/function agRespostaHtml\(ev\)\{[\s\S]*?\n\}/) || [""])[0];
  eq("194) o botão diz 'Recusar série' quando repete",
     /\(serie\?'Recusar série':'Recusar'\)/.test(ACOES), "true");
  eq("194b) e continua só 'Recusar' no avulso — o mesmo botão, o mesmo lugar",
     /:'Recusar'\)/.test(ACOES) && /data-agrecusar/.test(ACOES), "true");
  eq("194c) quem decide é agRepete, que já existia — não uma regra nova",
     /var serie=!!agRepete\(ev\);/.test(ACOES), "true");
  eq("195) o formulário avisa que a recusa vale pra série inteira",
     /recusará todas as ocorrências/.test(RESP), "true");
  eq("195b) dizendo COMO se repete, com o rótulo que já existe",
     /var serie=agRepLabel\(ev\);/.test(RESP), "true");
  eq("195c) e só quando repete — no avulso a caixa fica igual",
     /\(serie\?\('<div class="ag-r-serie">/.test(RESP), "true");
  eq("196) o botão de enviar também avisa",
     /Recusar a série toda/.test(H), "true");
  eq("196b) nos DOIS lugares em que ele existe (rodapé e caixa)",
     (H.match(/Recusar a série toda/g) || []).length, 2);
  eq("197) o aviso tem estilo próprio, no tom do módulo",
     /\.ag-r-serie \{[^}]*background:#fdf3e3/.test(H), "true");
  /* O que agResponder lê não pode sumir — foi a regra da Etapa H e continua valendo. */
  eq("198) os campos que agResponder lê continuam no formulário",
     /class="ag-r-motivo"/.test(RESP) && /class="ag-r-data"/.test(RESP) && /ag-r-hora/.test(RESP), "true");
  eq("198b) e a janela não foi redesenhada",
     /class="ag-recusa"/.test(RESP) && /data-agrecusacancel/.test(RESP), "true");
}

console.log("\n" + (falhou ? "FALHOU: " + falhou + " de " + (ok + falhou) : "TUDO OK: " + ok + " testes") + "\n");
process.exit(falhou ? 1 : 0);
