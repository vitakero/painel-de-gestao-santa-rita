// AS CINCO TAREFAS QUE NÃO DERRUBAM A RONDA — cada uma bate ponto, e o painel mede o silêncio.
//
// 06/09/2026. O robô faz dez tarefas em fila a cada 5 minutos. Quatro têm freio: se falharem, a
// rodada para e o aviso vermelho acende. As outras cinco não têm freio, de propósito — um
// tropeço na conferência dos carros não pode impedir a publicação das vendas.
//
// O preço disso era o silêncio: a tarefa morria e ficava morta. Pior, o robô assinava "terminei
// a ronda" trinta segundos depois, cobrindo a falha com um carimbo verde.
//
// A decisão do dono: nem "para tudo", nem "não avisa nada". Cada uma CONTA que parou.
//
//   node scripts/testes/robo-sincronias.test.cjs
const fs = require("fs");
const path = require("path");
const raiz = path.join(__dirname, "..", "..");
const L = (...p) => fs.readFileSync(path.join(raiz, ...p), "utf8");

const HTML = L("output", "index.html");
const SQL  = L("sql", "robo_sincronias.sql");
const CINCO = {
  agendamento: L("scripts", "vr-sync-agendamento.cjs"),
  conferencia: L("scripts", "vr-sync-conferencia.cjs"),
  pedidos:     L("scripts", "vr-sync-pedidos.cjs"),
  notas:       L("scripts", "vr-sync-notas.cjs"),
  codigos:     L("scripts", "vr-sync-codigos.cjs"),
};

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + obtido +
              (bate ? "" : "   (esperado: " + esperado + ")"));
  bate ? ok++ : falhou++;
}

// O MIOLO É EXTRAÍDO DO PAINEL GERADO E RODADO DE VERDADE. Procurar a linha no arquivo não prova
// nada — foi exatamente assim que um comando com caractere invisível passou por todas as provas
// em 06/09/2026 de manhã.
const ini = HTML.indexOf("==ROBOVIGIA-INICIO=="), fim = HTML.indexOf("==ROBOVIGIA-FIM==");
if (ini < 0 || fim < 0) { console.log("ERRO: não achei o vigia no painel (rode o build antes)."); process.exit(1); }
const M = new Function(HTML.slice(HTML.indexOf("*/", ini) + 2, HTML.lastIndexOf("/*", fim))
  + "\nreturn {rvSincParadas,rvTextoSinc,rvComRelato,rvTexto,rvQuanto,rvMaiuscula};")();

const agora = Date.now();
const atras = (min) => new Date(agora - min * 60000).toISOString();
const tarefa = (id, min, extra) => Object.assign(
  { id: id, nome: id, quando: min === null ? null : atras(min), ok: true, folga_min: 25 }, extra || {});

console.log("1) a régua de cada tarefa, rodada de verdade");
eq("   todas em dia: silêncio", M.rvSincParadas([tarefa("a", 3), tarefa("b", 7)], agora).length, 0);
eq("   24 minutos ainda cabe na folga de 25", M.rvSincParadas([tarefa("a", 24)], agora).length, 0);
eq("   25 minutos estoura", M.rvSincParadas([tarefa("a", 25)], agora).length, 1);

// A FOLGA É DE CADA UMA, e é o ponto todo: as que varrem o VR inteiro demoram mais. Uma régua
// única daria alarme falso nas pesadas ou demora nas leves.
const mistas = [tarefa("conferencia", 30, { folga_min: 25 }), tarefa("pedidos", 30, { folga_min: 40 })];
const paradas = M.rvSincParadas(mistas, agora);
eq("   com 30 min, só a de folga 25 aparece", paradas.length, 1);
eq("   e é a certa", paradas[0] && paradas[0].id, "conferencia");

// SEM CARIMBO NENHUM NÃO É ALARME. Painel que inventa alarme por falta de dado é painel que
// ensina a ignorar alarme.
eq("   sem carimbo, não inventa alarme", M.rvSincParadas([tarefa("a", null)], agora).length, 0);

console.log("\n2) falha contada vale NA HORA, sem esperar a folga");
// Mesma regra do robô inteiro: quando a tarefa conseguiu falar, esperar mais só atrasa a
// notícia. Aqui o carimbo tem 2 minutos — dentro da folga — e mesmo assim tem que acender.
const contou = M.rvSincParadas([tarefa("agendamento", 2, { ok: false,
  motivo: "A leitura dos agendamentos no VR voltou vazia." })], agora);
eq("   carimbo novo, mas ela contou que falhou", contou.length, 1);
eq("   e vem marcada como contada", contou[0] && contou[0].contou, true);

console.log("\n3) a ordem: quem contou primeiro, depois o silêncio mais longo");
const varias = M.rvSincParadas([
  tarefa("codigos", 90),
  tarefa("notas", 200, { folga_min: 40 }),
  tarefa("conferencia", 5, { ok: false, motivo: "Falhou." }),
], agora);
eq("   três paradas", varias.length, 3);
eq("   a que contou vem primeiro", varias[0].id, "conferencia");
eq("   depois a mais antiga", varias[1].id, "notas");

console.log("\n4) o texto que aparece na tela");
const uma = M.rvTextoSinc(M.rvSincParadas(
  [Object.assign(tarefa("conferencia", 62), { nome: "conferência dos carros" })], agora));
eq("   faixa âmbar, não vermelha", uma && uma.nivel, "atraso");
eq("   diz o nome de gente da tarefa", /onferência dos carros/.test(uma && uma.titulo), true);
// CONCORDANCIA: "A pedidos de compra parou" e "A notas da Receita parou" saíam errados — gênero e
// número mudam de tarefa pra tarefa. Sem artigo, os cinco ficam certos.
eq("   sem artigo grudado no nome", /^A conferência/.test(uma && uma.titulo), false);
eq("   com a primeira letra maiúscula", /^Conferência dos carros: parou de atualizar\./.test(uma && uma.titulo), true);
eq("   e há quanto tempo", /há 1 hora/.test(uma && uma.corpo), true);
// O DONO PRECISA SABER QUE O RESTO CONTINUA. Sem esta frase, "parou de atualizar" no topo do
// painel se lê como "o painel inteiro parou" — e a pessoa desconfia de número que está certo.
eq("   e que o resto do painel continua", /continua atualizando normalmente/.test(uma && uma.corpo), true);

const duas = M.rvTextoSinc(M.rvSincParadas([
  Object.assign(tarefa("a", 99), { nome: "pedidos de compra" }),
  Object.assign(tarefa("b", 88), { nome: "códigos dos fornecedores" }),
], agora));
eq("   duas paradas: conta quantas", /^2 tarefas/.test(duas && duas.titulo), true);
eq("   e nomeia as duas", /pedidos de compra, códigos dos fornecedores/.test(duas && duas.corpo), true);

eq("   nada parado, nada na tela", M.rvTextoSinc([]), null);
// Texto vindo do banco não pode trazer caractere invisível para o comando de colar.
const comCmd = M.rvTextoSinc(M.rvSincParadas(
  [tarefa("a", 99, { comando: "cd C:\\vr-robo" })], agora));
eq("   o comando sai limpo", /[\x00-\x1f]/.test(comCmd && comCmd.comando), false);

console.log("\n5) O VERMELHO SEMPRE GANHA DO ÂMBAR");
// Se o âmbar entrasse antes, o dono veria "uma tarefa parou" enquanto o robô inteiro estava
// morto — o menos grave escondendo o mais grave. É a inversão que este módulo existe pra evitar.
const roboMorto = { ok: true, quando: atras(50) };          // 50 min sem batimento = parado
const tarefaMorta = [tarefa("conferencia", 300)];
const juntos = M.rvComRelato(M.rvTexto(2), roboMorto, tarefaMorta);
eq("   robô parado E tarefa parada: ganha o vermelho", juntos && juntos.nivel, "parado");
eq("   e é o texto do robô", /parou de dar sinal/.test(juntos && juntos.titulo), true);

const soTarefa = M.rvComRelato(M.rvTexto(2), { ok: true, quando: atras(3) }, tarefaMorta);
eq("   robô bem e tarefa parada: âmbar", soTarefa && soTarefa.nivel, "atraso");
eq("   tudo bem: nada aparece", M.rvComRelato(M.rvTexto(2), { ok: true, quando: atras(3) }, [tarefa("a", 2)]), null);

// A BANCADA ANTIGA CHAMA COM DOIS ARGUMENTOS. Se o terceiro fosse obrigatório, as 75 provas do
// robo-avisa quebrariam todas.
eq("   chamada com 2 argumentos continua valendo", M.rvComRelato(M.rvTexto(2), { ok: true, quando: atras(3) }), null);

console.log("\n5b) OS DEFEITOS QUE A REVISÃO ADVERSARIAL PEGOU (06/09/2026)");
// GRAVE — o robô inteiro parado deixa as CINCO mudas junto. Como a folga delas (25 e 40 min) é
// menor que os 40 minutos do batimento, a âmbar acenderia PRIMEIRO dizendo "o resto do painel
// continua atualizando normalmente" — mentira — e ainda esconderia o vermelho por 15 minutos.
const roboMudo30 = { ok: true, quando: atras(30) };
const cincoMudas = [tarefa("conferencia", 30), tarefa("pedidos", 30, { folga_min: 40 })];
eq("   robô mudo há 30 min: a âmbar NÃO acende pelas tarefas",
   M.rvComRelato(M.rvTexto(2), roboMudo30, cincoMudas), null);
// e o desconto não pode cegar o caso legítimo: robô rodando, tarefa muda.
const soUmaMuda = M.rvComRelato(M.rvTexto(2), { ok: true, quando: atras(2) }, [tarefa("conferencia", 30)]);
eq("   robô rodando e tarefa muda há 30 min: acende", soUmaMuda && soUmaMuda.nivel, "atraso");
eq("   a conta: 30 de silêncio menos 28 de robô não estoura folga 25",
   M.rvSincParadas([tarefa("a", 30)], agora, 28).length, 0);
eq("   sem robô mudo, os mesmos 30 estouram", M.rvSincParadas([tarefa("a", 30)], agora, 0).length, 1);

// GRAVE — a falha contada não pode apagar a hora do último sucesso: a faixa dizia
// "a última vez que ela conseguiu foi há 0 minutos" logo abaixo do aviso de falha.
for (const id2 of ["agendamento", "conferencia", "pedidos", "notas", "codigos"]) {
  eq("   " + id2 + ": só carimba a hora no sucesso",
     /if \(ok\) linha\.quando = new Date\(\)\.toISOString\(\);/.test(CINCO[id2]), true);
}

console.log("\n6) as cinco tarefas batem o ponto, e do jeito seguro");
const SUCESSO = { agendamento: "true", conferencia: "true", pedidos: "true",
                  notas: "true", codigos: "true" };
for (const id of Object.keys(CINCO)) {
  const src = CINCO[id];
  eq("   " + id + ": tem cartão de ponto", /==PONTOSINC-INICIO==/.test(src), true);
  eq("   " + id + ": com o nome dela", new RegExp('PONTO_ID = "' + id + '"').test(src), true);
  eq("   " + id + ": grava na tabela certa", /robo_sincronias\?on_conflict=id/.test(src), true);
  // AS TRÊS DEFESAS. Carimbar não pode NUNCA derrubar a rodada, senão a proteção vira o defeito.
  eq("   " + id + ": sem chave, desiste calado", /if \(!SB_KEY\) return resolve\(false\);/.test(src), true);
  eq("   " + id + ": relógio de 8s", /p\.setTimeout\(8000/.test(src), true);
  eq("   " + id + ": e a bancada não carimba de verdade", /PONTO_TESTE === "1"/.test(src), true);
  // NAS CINCO, "sucesso" É COISA DIFERENTE. Três carimbam direto; duas dependem de uma bandeira
  // que só liga quando o laço chegou ao fim — em nenhuma delas o critério é "não deu erro".
  eq("   " + id + ": carimba o sucesso dela", new RegExp("baterPonto\\(" + SUCESSO[id]).test(src), true);
}

console.log("\n7) O PISO CONTRA APAGAR A CENTRAL INTEIRA");
// Achado em 06/09/2026 lendo o script: a limpeza apaga da nuvem tudo que o VR não devolveu. Se
// a leitura voltar vazia por OUTRO motivo (tabela renomeada num update do VR, permissão
// retirada, banco sem vaga), ela apagaria a Central inteira e imprimiria "PRONTO!". A tela
// diria que não há recebimento marcado — indistinguível de um dia parado.
const ag = CINCO.agendamento;
eq("   leitura vazia com nuvem cheia não apaga", /if\(!dados\.length && naNuvem\.length\)\{/.test(ag), true);
eq("   e vira falha contada", /baterPonto\(false, motivo,/.test(ag), true);
eq("   e sai antes da limpeza", ag.indexOf("if(!dados.length && naNuvem.length)") < ag.indexOf("const orfaos="), true);

console.log("\n7b) O AGENDAMENTO NÃO PODE FICAR PENDURADO");
// Provado em bancada com um Postgres de mentira: quando o relógio de consulta do pg estoura, ele
// rejeita a promessa mas NÃO fecha o socket — e socket aberto segura o Node acordado para
// sempre. Com o catch só imprimindo, o processo ficava vivo, o robo.bat travava no passo [1.5/4]
// e o painel inteiro parava de ser publicado. Um erro de SQL comum abre o mesmo buraco.
eq("   o cliente é alcançável de fora do miolo", /let cliente = null;/.test(CINCO.agendamento), true);
eq("   o catch fecha o socket", /if\(cliente\) await cliente\.end\(\)/.test(CINCO.agendamento), true);
eq("   e sai, em vez de ficar vivo sem fazer nada", /process\.exit\(1\)/.test(CINCO.agendamento), true);
eq("   conferencia sai forçado", /process\.exit\(1\)/.test(CINCO.conferencia), true);
eq("   pedidos sai forçado", /process\.exit\(1\)/.test(CINCO.pedidos), true);
eq("   notas fecha sempre", /try \{ if \(c\) await c\.end\(\); \} catch \(e\) \{\}/.test(CINCO.notas), true);
eq("   codigos fecha sempre", /try \{ if \(c\) await c\.end\(\); \} catch \(e\) \{\}/.test(CINCO.codigos), true);

console.log("\n7c) SOLUÇO DE UMA RODADA NÃO ACENDE A FAIXA");
// O banco do VR fica sem vaga de conexão quando outro sistema o entope — falha de uma rodada é
// rotina aqui. Carimbar falha nesse caso faria a faixa acender por 5 minutos de soluço. Ficando
// calado, o silêncio soma e a folga separa o soluço do problema de verdade.
eq("   notas: só carimba o sucesso", /if \(conta\.terminou\) \{/.test(CINCO.notas), true);
eq("   notas: não carimba falha", /baterPonto\(false/.test(CINCO.notas), false);
eq("   agendamento: erro de rede não carimba falha", /NAO carimba falha aqui de proposito/.test(CINCO.agendamento), true);
// Mas o ESTRUTURAL carimba na hora: leitura que volta vazia não melhora sozinha.
eq("   codigos: leitura vazia é falha contada", /voltou vazia/.test(CINCO.codigos), true);
eq("   conferencia: semana vazia é falha contada", /conferências do coletor no VR voltou vazia/.test(CINCO.conferencia), true);
eq("   agendamento: leitura vazia é falha contada", /agendamentos no VR voltou vazia/.test(CINCO.agendamento), true);

console.log("\n8) os relógios que faltavam");
// Sem teto, uma conexão meio-aberta não dá erro e não termina: pendura a tarefa, a rodada
// inteira atrás dela, e a rodada seguinte.
eq("   agendamento: relógio na nuvem", /r\.setTimeout\(20000/.test(CINCO.agendamento), true);
eq("   conferencia: relógio na nuvem", /r\.setTimeout\(20000/.test(CINCO.conferencia), true);
eq("   pedidos: relógio na nuvem", /r\.setTimeout\(20000/.test(CINCO.pedidos), true);
eq("   conferencia: teto pra conectar no VR", /connectionTimeoutMillis: 20000/.test(CINCO.conferencia), true);
eq("   pedidos: teto por consulta no VR", /query_timeout: 240000/.test(CINCO.pedidos), true);
// AS CINCO, sem exceção — foi ficarem de fora que a revisão pegou nas duas últimas.
eq("   notas: relógio na nuvem", /r\.setTimeout\(20000/.test(CINCO.notas), true);
eq("   codigos: relógio na nuvem", /r\.setTimeout\(20000/.test(CINCO.codigos), true);
eq("   notas: teto por consulta no VR", /query_timeout: 240000/.test(CINCO.notas), true);
eq("   codigos: teto por consulta no VR", /query_timeout: 240000/.test(CINCO.codigos), true);

console.log("\n9) o que é sucesso em cada uma (as decisões que evitam alarme falso)");
// Estas três decisões vieram de medição, não de gosto. Mexer nelas sem medir de novo traz o
// alarme falso de volta — e alarme falso é como se ensina alguém a ignorar alarme.
eq("   notas: zero nota é sucesso (o VR só baixa de 4 em 4 horas)", /ZERO NOTA E SUCESSO/.test(CINCO.notas), true);
eq("   notas: não usa conta.erros pra decidir", /conta\.terminou = true;/.test(CINCO.notas), true);
eq("   codigos: zero lido é SUSPEITO (ela lê 31 mil toda vez)", /conta\.lidos > 0/.test(CINCO.codigos), true);
// MUDOU EM 06/09 pela revisão: 7 dias sem NENHUMA conferência não acontece nesta loja (16 a 33
// carros por dia, medidos em 933 conferências). Zero na janela é sintoma de ler a tabela errada
// — que já aconteceu aqui. Virou falha contada em vez de sucesso silencioso.
eq("   conferencia: semana vazia NÃO é sucesso", /SETE DIAS SEM NENHUMA CONFERENCIA/.test(CINCO.conferencia), true);
eq("   conferencia: carimba depois do laço inteiro", /DEPOIS DO LACO INTEIRO/.test(CINCO.conferencia), true);

console.log("\n10) a tabela no banco");
eq("   uma linha por tarefa", /create table if not exists public\.robo_sincronias/.test(SQL), true);
eq("   com a folga de cada uma", /folga_min\s+int\s+not null default 25/.test(SQL), true);
eq("   as cinco nascem já aqui", (SQL.match(/^\s*\('(agendamento|conferencia|pedidos|notas|codigos)'/gm) || []).length, 5);
eq("   só o master lê", /public\.sou_master\(\)/.test(SQL), true);
eq("   com o tenant da casa", /tenant_id = public\.current_tenant\(\)/.test(SQL), true);
eq("   sem policy de escrita (quem grava é o robô)", /for insert|for update to authenticated/.test(SQL), false);
eq("   tem como desfazer escrito", /drop table if exists public\.robo_sincronias/.test(SQL), true);

console.log("\n11) o painel lê sem se estrangular");
eq("   consulta IRMÃ, não pendurada na primeira", /CONSULTA IRMA, DE PROPOSITO/.test(HTML), true);
eq("   pede só as colunas que desenha", /select\("id,nome,quando,ok,motivo,detalhe,comando,folga_min"\)/.test(HTML), true);
eq("   com teto de linhas", /robo_sincronias[\s\S]{0,140}\.limit\(20\)/.test(HTML), true);
eq("   e continua sendo só do master", /if\(!rvEhMaster\(\)\) return;/.test(HTML), true);
// REPINTAR NÃO REDECIDE O VERMELHO COM LEITURA VELHA: a hora do carimbo é absoluta, então um
// retrato de 10 minutos atrás faz o batimento parecer 10 minutos mais velho do que é.
eq("   repintar guarda quando leu", /rvSaudeLido/.test(HTML), true);
eq("   e descarta retrato velho", /var fresco = \(Date\.now\(\)-rvSaudeLido\) < 120000;/.test(HTML), true);
// A leitura antiga aborta cedo quando vendasetor_dia não responde; se a nova estivesse pendurada
// nela, morreria junto — justamente no caso em que mais se quer o aviso.
eq("   a trava antiga continua intacta", /if\(!r\|\|r\.error\|\|!r\.data\|\|!r\.data\.length\) return;/.test(HTML), true);

console.log("\n" + ok + " ok, " + falhou + " falha(s).");
process.exit(falhou ? 1 : 0);
