// Testes do PUXAR-CODIGO (o pedaço que baixa o código do robô na máquina da loja).
//
// Nasceram de um defeito real e repetido, 20/08/2026: o robô recusou o
// vr-descobrir-notas.cjs quatro vezes seguidas dizendo só "invalido - mantendo o atual",
// e ninguém leu. Causa: cada arquivo da lista tem uma "senha de conferência" — um pedaço
// de texto que TEM que existir dentro do arquivo baixado. A senha foi escrita "O VR JA
// GUARDA O XML" e o arquivo diz "JÁ", com acento. Não bateu, o robô não gravou, e a
// máquina da loja ficou sem o arquivo — o script que dependia dele morria com
// "Cannot find module" e a janela preta fechava levando o erro junto.
//
// Este mesmo tropeço já tinha acontecido três vezes antes (o comentário dentro do
// puxar-codigo.cjs conta), então virou teste: agora a senha errada cai aqui, no Mac,
// em vez de morrer calada dentro da loja.
//
// Se um destes cair, um arquivo do robô vai parar de atualizar na loja SEM avisar.
//   node scripts/testes/robo-baixar.test.cjs
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..", "..");
const SCRIPTS = path.join(RAIZ, "scripts");
const PUXAR = fs.readFileSync(path.join(SCRIPTS, "puxar-codigo.cjs"), "utf8");
const DEPLOY = fs.readFileSync(path.join(SCRIPTS, "deploy-code.cjs"), "utf8");

let ok = 0, falhou = 0;
function t(nome, cond, extra) {
  if (cond) { ok++; return; }
  falhou++; console.log("  FALHOU: " + nome + (extra ? " -> " + extra : ""));
}

// ------------------------------------------------------------------ lê as duas listas
function listaDe(fonte, nome) {
  const i = fonte.indexOf("const FILES = [");
  if (i < 0) { console.log("ERRO: não achei a lista FILES em " + nome + "."); process.exit(1); }
  const f = fonte.indexOf("];", i);
  return fonte.slice(i, f).split("\n")
    .filter(function (l) { return l.trim().indexOf("[") === 0; })
    .map(function (l) { return l.match(/\[\s*"([^"]+)"\s*,\s*"([^"]+)"\s*(?:,\s*"([^"]+)"\s*)?\]/); })
    .filter(Boolean)
    .map(function (m) { return { a: m[1], b: m[2], senha: m[3] }; });
}

const BAIXA = listaDe(PUXAR, "puxar-codigo.cjs");    // [no GitHub, destino local, senha]
const SOBE  = listaDe(DEPLOY, "deploy-code.cjs");    // [fonte local, no GitHub]

// Onde mora, aqui no Mac, o arquivo que a loja vai receber. NÃO dá para deduzir do
// destino: o notas.bat mora em scripts/ e é entregue na raiz C:\vr-robo. Quem sabe o
// caminho certo é a lista de subida — é ela que diz qual arquivo daqui virou qual
// arquivo no GitHub.
function fonteDe(noGitHub) {
  const s = SOBE.filter(function (x) { return x.b === noGitHub; })[0];
  return s ? path.join(RAIZ, s.a) : null;
}

// Sobem pro GitHub mas NÃO descem pelo puxar-codigo, de propósito: o pix.bat e o
// pix-loop.vbs são instalados uma vez na máquina da loja e quem os liga é o próprio
// Windows, na inicialização. Não fazem parte da rodada do robô.
const SO_SOBEM = ["robo/pix.bat", "robo/pix-loop.vbs"];

console.log("puxar-codigo: " + BAIXA.length + " arquivo(s) na lista de descida");

// ---------------------------------------------------------------------------- os testes
t("a lista de descida não está vazia", BAIXA.length > 0);
t("a lista de subida não está vazia", SOBE.length > 0);

BAIXA.forEach(function (it) {
  const rot = it.b;

  // 1) toda linha tem senha. Sem senha o `indexOf` compara com undefined e recusa sempre.
  t("[" + rot + "] tem senha de conferência", !!it.senha);

  // 2) O TESTE QUE FALTAVA: a senha existe DE VERDADE dentro do arquivo.
  //    É a comparação exata que o robô faz na loja (indexOf), então acento, maiúscula
  //    e espaço contam.
  const fonte = fonteDe(it.a);
  let txt = null;
  try { txt = fs.readFileSync(fonte, "utf8"); } catch (e) {}
  t("[" + rot + "] o arquivo existe aqui no Mac", txt !== null, fonte || "(ninguém sobe " + it.a + ")");
  if (txt !== null && it.senha) {
    t("[" + rot + "] a senha bate com o conteúdo", txt.indexOf(it.senha) >= 0,
      'a loja vai dizer "invalido - mantendo o atual" e ficar com a versão velha; senha: ' + it.senha);
  }

  // 3) senha sem acento. O tropeço das três vezes anteriores foi exatamente esse:
  //    a senha escrita sem acento e o arquivo com acento. Uma senha só de ASCII não
  //    consegue errar desse jeito.
  if (it.senha) {
    t("[" + rot + "] senha sem acento", /^[\x20-\x7E]*$/.test(it.senha),
      "senha: " + it.senha);
  }

  // 4) o que a loja BAIXA tem que ser o mesmo que o Mac SOBE. Um arquivo que só está
  //    numa das listas é o defeito clássico daqui: ou a loja nunca recebe, ou o Mac
  //    manda pro vazio. (O vr-sync-conferencia.cjs passou meses assim.)
  t("[" + rot + "] alguém sobe esse arquivo pro GitHub",
    SOBE.some(function (s) { return s.b === it.a; }), it.a);
});

// 5) o contrário: nada sobe sem alguém baixar. Só valem os do robô — o deploy também
//    manda coisa que a loja não usa (SQL, por exemplo).
SOBE.forEach(function (s) {
  if (s.b.indexOf("robo/") !== 0) return;
  if (SO_SOBEM.indexOf(s.b) >= 0) return;
  t("[" + s.b + "] alguém baixa esse arquivo na loja",
    BAIXA.some(function (b) { return b.a === s.b; }), s.a);
});

// 6) o puxar-codigo tem que se atualizar ANTES do resto e recomeçar. Enquanto ele se
//    atualizava por último, um arquivo novo só era conhecido na rodada seguinte — o
//    Victor rodou o robô duas vezes em dois dias por causa disso.
t("ele se atualiza primeiro e recomeça", PUXAR.indexOf("--jaatualizei") > 0);
t("o recomeço tem trava contra laço infinito",
  PUXAR.indexOf('process.argv.indexOf("--jaatualizei") < 0') > 0);

// 7) só grava o que mudou. O Windows lê o .bat linha por linha ENQUANTO ele roda:
//    regravar no meio da execução embaralha o que ainda falta rodar.
t("não regrava arquivo idêntico", PUXAR.indexOf("if (igual) continue;") > 0);
t("não reescreve o .bat que está rodando", PUXAR.indexOf("process.env.RODANDO_BAT") > 0);

// 7b) e o .bat tem que AVISAR quem está rodando, senão a proteção acima nunca liga.
//     Também: o .bat chama um nome de script FIXO — é o que permite ele nunca mudar.
const BAT = fs.readFileSync(path.join(SCRIPTS, "notas.bat"), "utf8");
t("o notas.bat avisa que está rodando", BAT.indexOf("set RODANDO_BAT=notas.bat") > 0);
t("o notas.bat chama o passo por nome fixo", BAT.indexOf("scripts\\notas-passo.cjs") > 0);
t("o passo da vez existe", fs.existsSync(path.join(SCRIPTS, "notas-passo.cjs")));

// 7c) NENHUM caractere de desvio de saida no .bat — nem dentro de comentario.
//     A versao que mandava tudo para um arquivo de log morreu na maquina da loja com
//     "A sintaxe do comando esta incorreta", e o erro sumiu junto com a janela. Pior:
//     o cmd do Windows ainda interpreta ">" DENTRO de uma linha REM, entao nem
//     explicar o problema no comentario e seguro. O relatorio nao precisa do log —
//     o notas-passo.cjs manda o resultado para a nuvem por conta propria.
t("o notas.bat não desvia saída em lugar nenhum", BAT.indexOf(">") < 0,
  "o cmd interpreta > até dentro de REM");

// 7d) O ROBO.BAT, que é a rotina principal da loja.
//     Ele passou meses sem chegar lá: a senha de conferência não batia e a recusa
//     aparecia como uma linha só, "invalido - mantendo o atual", no meio de vinte.
const ROBO = fs.readFileSync(path.join(RAIZ, "robo.bat"), "utf8");
t("o robo.bat avisa que está rodando", ROBO.indexOf("set RODANDO_BAT=robo.bat") > 0,
  "sem isso o puxar-codigo reescreve o .bat no meio da execução dele");
// .bat com quebra de linha de Linux faz o cmd errar em rótulos e goto — e este
// arquivo tem ":erro" e "goto erro".
t("o robo.bat tem quebra de linha do Windows", ROBO.indexOf("\r\n") > 0);
t("o robo.bat não desvia saída em comentário",
  ROBO.split("\n").filter(function (l) {
    return /^\s*REM\b/i.test(l) && l.indexOf(">") >= 0;
  }).length === 0);

// 7e) O sync das notas mora num lugar só: o robo.bat chama no passo 1.8, e o
//     vr-sync-pedidos só chama quando o robo.bat NÃO está no comando. Sem isso,
//     ou roda duas vezes por rodada, ou não roda nenhuma.
const PED = fs.readFileSync(path.join(SCRIPTS, "vr-sync-pedidos.cjs"), "utf8");
t("o robo.bat chama o sync das notas", ROBO.indexOf("vr-sync-notas.cjs") > 0);
t("o pedidos se cala quando o robo.bat chama",
  PED.indexOf('process.env.RODANDO_BAT === "robo.bat"') > 0);
t("mas chama quando roda sozinho", PED.indexOf("vr-sync-notas.cjs") > 0);

// 8) e ele nunca pode derrubar a rodada: falha de download mantém o código atual.
t("falha de download não derruba a rodada", PUXAR.indexOf("mantendo o atual") > 0);

console.log(falhou ? ("FALHOU: " + falhou + " de " + (ok + falhou)) : ("TUDO OK: " + ok + " testes"));
process.exit(falhou ? 1 : 0);
