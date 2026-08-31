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
     /function agCloudLoadPessoal\(seq,reqAno,reqMes,ini,fim\)/.test(H), "true");
  eq("34) e o painel sabe diferenciar 'falta o SQL' de 'caiu a internet'",
     /function agSemParte2\(e\)/.test(H), "true");
  eq("35) olhando a agenda de outro, não aparece formulário de marcar",
     /agVendoOutro\(\)\s*\n?\s*\? \('<div class="ag-f-hint">Você está só olhando/.test(H), "true");
  eq("36) nem botão de aceitar pelos outros",
     /agConvHtml\(ev\)\+ \(agVendoOutro\(\)\?'':agRespostaHtml\(ev\)\)/.test(H), "true");
}

console.log("\n" + (falhou ? "FALHOU: " + falhou + " de " + (ok + falhou) : "TUDO OK: " + ok + " testes") + "\n");
process.exit(falhou ? 1 : 0);
