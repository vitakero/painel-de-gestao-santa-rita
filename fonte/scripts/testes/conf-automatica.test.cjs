// A regra que decide se o carro já pode ser dado como conferido sozinho.
//
// Pedido dele em 28/08/2026, com o caminhão na tela. Três condições, todas obrigatórias:
// mesma empresa (CNPJ) no mesmo dia · a NOTA fechou · zero diferença de CONTAGEM.
// Diferença de preço não segura — no carro real daquele dia o biscoito veio a 2,75 contra
// 3,40 do pedido: a mercadoria bateu e o preço mudou a favor da loja.
//
//   node scripts/testes/conf-automatica.test.cjs
const fs = require("fs");
const path = require("path");
const HTML = fs.readFileSync(path.join(__dirname, "..", "..", "output", "index.html"), "utf8");
const ini = HTML.indexOf("==CONFAUTO-INICIO=="), fim = HTML.indexOf("==CONFAUTO-FIM==");
if (ini < 0 || fim < 0) { console.log("ERRO: não achei o módulo (rode o build antes)."); process.exit(1); }
const M = new Function(HTML.slice(HTML.indexOf("*/", ini) + 2, HTML.lastIndexOf("/*", fim))
  + "\nreturn {caDigitos,caTipos,caContagem,caResumoCompleto,caAchar,caIrmaos,caVeredito};")();

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + obtido + (bate ? "" : "   (esperado: " + esperado + ")"));
  bate ? ok++ : falhou++;
}

// --- o carro REAL de 28/08/2026, que deu origem a tudo isso ---
const AG = { status: "aprovado", documento: "20947638000141", data: "2026-08-28",
             fornecedor: "GJ DOS SANTOS E FILHOS LTDA", hora: "10:00:00" };
const CONF = { data: "2026-08-28", cnpj: "20947638000141", situacao: "finalizado",
               bipagens: 9, notas: 1, divergencias: 3,
               tipos: [{ tipo: "CUSTO ANTERIOR", qtd: 2 }, { tipo: "CUSTO", qtd: 1 }] };

console.log("1) o carro real de 28/08 — nota fechada, só divergência de preço");
let v = M.caVeredito(AG, [CONF]);
eq("   marca sozinho", v.marcar, true);
eq("   diz quantos produtos", /9 produtos bipados/.test(v.motivo), true);
eq("   diz que a nota fechou", /1 nota fechada/.test(v.motivo), true);
eq("   diz que a contagem bateu", /sem diferença de contagem/.test(v.motivo), true);

console.log("\n2) O NOME NÃO SERVE — a prova do caso real");
// portal "GJ DOS SANTOS", VR "G J DOS SANTOS": um espaço de diferença
eq("   nomes diferentes, mesmo CNPJ: casa mesmo assim",
   M.caVeredito(AG, [{ ...CONF, fornecedor: "G J DOS SANTOS E FILHOS LTDA" }]).marcar, true);
eq("   CNPJ diferente: NÃO casa",
   M.caVeredito(AG, [{ ...CONF, cnpj: "11222333000144" }]).marcar, false);
eq("   CNPJ com pontuação casa igual",
   M.caVeredito(AG, [{ ...CONF, cnpj: "20.947.638/0001-41" }]).marcar, true);
eq("   CNPJ pela metade NUNCA casa (casaria com a empresa errada)",
   M.caVeredito({ ...AG, documento: "209476380001" }, [CONF]).marcar, false);
eq("   agendamento sem documento não casa",
   M.caVeredito({ ...AG, documento: null }, [CONF]).marcar, false);

console.log("\n3) O DIA tem que bater (só recebe quem tem agendamento no dia)");
eq("   conferência de outro dia não casa",
   M.caVeredito(AG, [{ ...CONF, data: "2026-08-27" }]).marcar, false);
eq("   e o motivo diz que não chegou conferência",
   /ainda não chegou conferência/.test(M.caVeredito(AG, [{ ...CONF, data: "2026-08-27" }]).motivo), true);

console.log("\n4) A NOTA precisa ter fechado — bipar não basta");
v = M.caVeredito(AG, [{ ...CONF, situacao: "conferindo" }]);
eq("   ainda conferindo: não marca", v.marcar, false);
eq("   e diz por quê", /ainda está sendo conferido/.test(v.motivo), true);
v = M.caVeredito(AG, [{ ...CONF, situacao: "aguardando" }]);
eq("   bipou e a nota não fechou: não marca", v.marcar, false);
eq("   e diz que a nota não foi finalizada", /nota não foi finalizada/.test(v.motivo), true);

console.log("\n5) CONTAGEM segura, PREÇO não");
const comTipo = (t, q) => M.caVeredito(AG, [{ ...CONF, divergencias: (q || 1), tipos: [{ tipo: t, qtd: q || 1 }] }]);
["NAO ENTREGUE", "QUANTIDADE", "COLETOR", "SEM PEDIDO"].forEach(t =>
  eq("   " + t + " SEGURA o carro", comTipo(t).marcar, false));
["CUSTO", "CUSTO ANTERIOR"].forEach(t =>
  eq("   " + t + " NÃO segura", comTipo(t).marcar, true));
eq("   sem divergência nenhuma: marca", M.caVeredito(AG, [{ ...CONF, divergencias: 0, tipos: [] }]).marcar, true);
eq("   preço E contagem juntos: segura",
   M.caVeredito(AG, [{ ...CONF, divergencias: 6, tipos: [{ tipo: "CUSTO", qtd: 5 }, { tipo: "QUANTIDADE", qtd: 1 }] }]).marcar, false);
eq("   conta quantas são de contagem", M.caContagem({ tipos: [{ tipo: "NAO ENTREGUE", qtd: 3 }, { tipo: "CUSTO", qtd: 9 }] }), 3);
eq("   e lê do item-a-item também (depois do clique)",
   M.caContagem({ divergencia_detalhe: { tipos: [{ tipo: "QUANTIDADE", qtd: 2 }] } }), 2);

console.log("\n6) só agendamento APROVADO entra na conta");
["pendente", "recusado", "conferido", "recusado_na_doca"].forEach(st =>
  eq("   status " + st + ": fora", M.caVeredito({ ...AG, status: st }, [CONF]).marcar, false));

console.log("\n7) não estoura com dado faltando");
eq("   agendamento nulo", M.caVeredito(null, [CONF]).marcar, false);
eq("   lista de conferências vazia", M.caVeredito(AG, []).marcar, false);
eq("   lista indefinida", M.caVeredito(AG, undefined).marcar, false);
eq("   conferência sem cnpj", M.caVeredito(AG, [{ ...CONF, cnpj: null }]).marcar, false);
eq("   conferência sem tipos mas com total: NÃO marca (resumo incompleto)",
   M.caVeredito(AG, [{ ...CONF, tipos: undefined }]).marcar, false);
eq("   conferência sem tipos e sem nenhuma diferença: marca",
   M.caVeredito(AG, [{ ...CONF, divergencias: 0, tipos: undefined }]).marcar, true);

console.log("\n8) está LIGADO — marca de verdade (decisão dele em 28/08)");
eq("   o interruptor existe", /var CA_MODO="(marcar|mostrar)"/.test(HTML), true);
eq("   está em MARCAR", /var CA_MODO="marcar"/.test(HTML), true);
// A REGRA DE DESENHO: toda gravação de status passa por UM lugar só (clEnviarStatus).
// Eu tinha furado isso chamando a RPC direto; o teste da doca pegou.
eq("   marca pela gravação única", /clEnviarStatus\(p\.id, "conferido", null, p\.fornecedor, true,/.test(HTML), true);
eq("   e a RPC continua tendo UM chamador só", (HTML.match(/rpc\("ent_definir_status"/g) || []).length, 1);
eq("   NUNCA recusa nem cancela sozinho", /clEnviarStatus\(p\.id, "(recusado|cancelado|recusado_na_doca)"/.test(HTML), false);
eq("   se falhar, solta a trava pra tentar de novo", /function caFalhou\(id\)\{ delete caTentados\[id\]; \}/.test(HTML), true);
eq("   e a falha do automático NÃO abre janela na cara de ninguém",
   /if\(auto\)\{ if\(typeof caFalhou==="function"\) caFalhou\(id\); return; \}/.test(HTML), true);
eq("   não tenta duas vezes o mesmo (trava por id)", /if\(caTentados\[p\.id\]\) continue;/.test(HTML), true);
eq("   só age com os DOIS lados carregados",
   /if\(!caHoje\.length \|\| !clPedidos \|\| !clPedidos\.length\) return false;/.test(HTML), true);
eq("   avisa na tela o que marcou", /Conferido sozinho: /.test(HTML), true);

console.log("\n9) o email do fornecedor sai junto (decisão dele em 28/08)");
eq("   o interruptor do email existe", /var CA_AVISAR=(true|false)/.test(HTML), true);
eq("   está LIGADO", /var CA_AVISAR=true/.test(HTML), true);
eq("   o email sai pela gravação única, igual ao clique manual",
   (HTML.match(/clAvisarFornecedor\(id, status, quem\);/g) || []).length, 1);
eq("   e o interruptor do email é LIDO de verdade (era freio de mão desligado)",
   /if\(auto && typeof CA_AVISAR!=="undefined" && !CA_AVISAR\) return;/.test(HTML), true);
eq("   o aviso na tela só sai DEPOIS de gravar", /if\(okMsg\) clAvisoToast\(okMsg, true\);/.test(HTML), true);

console.log("\n10) a linha do tempo para de mentir com o relógio");
eq("   olha a conferência antes do relógio", /if\(vv && vv\.marcar\) return \{k:"concluido",t:"Conferido"\};/.test(HTML), true);
eq("   não sobrepõe recusado", /String\(a\.situacao\|\|""\)\.indexOf\("recusad"\)<0/.test(HTML), true);
eq("   não sobrepõe cancelado", /a\.situacao!=="cancelado"/.test(HTML), true);

// ===========================================================================================
// 11) OS DEFEITOS QUE A AUDITORIA DE 28/08/2026 PROVOU. Cada um destes JÁ ESTEVE no ar.
// ===========================================================================================
console.log("\n11) resumo CORTADO não pode virar 'está limpo'");
// O robô guardava só as 60 primeiras diferenças, em ordem alfabética de tipo. Os tipos de
// CONTAGEM vêm todos depois de CUSTO ANTERIOR no alfabeto, então eram justamente eles que o
// corte comia. Carro REAL de 28/08: FAMA, 105 diferenças, o painel via 60 — todas de preço.
const FAMA = { data: "2026-08-28", cnpj: "06029901000192", situacao: "finalizado",
               bipagens: 71, notas: 3, divergencias: 105,
               tipos: [{ tipo: "CUSTO ANTERIOR", qtd: 31 }, { tipo: "CUSTO", qtd: 29 }] };
const AGFAMA = { status: "aprovado", documento: "06029901000192", data: "2026-08-28",
                 fornecedor: "FAMA DISTRIBUICAO E LOGISTICA LTDA", hora: "08:00:00" };
let f = M.caVeredito(AGFAMA, [FAMA]);
eq("   FAMA 105 diferenças, resumo só de 60: NÃO marca", f.marcar, false);
eq("   e diz que o resumo veio incompleto", /resumo das diferenças veio incompleto/.test(f.motivo), true);
eq("   a conta sozinha continuaria dizendo zero", M.caContagem(FAMA), 0);
eq("   quem barra é o total x soma dos tipos", M.caResumoCompleto(FAMA), false);
eq("   MULTIGIRO 93 diferenças, resumo de 60: NÃO marca",
   M.caVeredito({ ...AGFAMA, documento: "13446587000109" },
     [{ ...FAMA, cnpj: "13446587000109", divergencias: 93,
        tipos: [{ tipo: "CUSTO ANTERIOR", qtd: 44 }, { tipo: "CUSTO", qtd: 16 }] }]).marcar, false);
eq("   resumo inteiro (soma bate com o total): passa",
   M.caResumoCompleto({ divergencias: 3, tipos: [{ tipo: "CUSTO", qtd: 3 }] }), true);
eq("   sem o total não dá pra afirmar nada: barra",
   M.caResumoCompleto({ tipos: [{ tipo: "CUSTO", qtd: 3 }] }), false);
eq("   e o painel PEDE a coluna do total", /divergencias,divergencia_detalhe->tipos/.test(HTML), true);

console.log("\n12) duas conferências da mesma empresa no dia: não escolhe, pergunta");
// Caso REAL de 27/08: CNPJ 03454838000143 tinha um carro limpo e outro com 10 NAO ENTREGUE.
// Qual valia dependia da ordem física das linhas no banco — era sorteio.
const LIMPO = { data: "2026-08-27", cnpj: "03454838000143", situacao: "finalizado",
                bipagens: 22, notas: 1, divergencias: 2, tipos: [{ tipo: "CUSTO ANTERIOR", qtd: 2 }] };
const SUJO  = { data: "2026-08-27", cnpj: "03454838000143", situacao: "finalizado",
                bipagens: 10, notas: 1, divergencias: 16,
                tipos: [{ tipo: "NAO ENTREGUE", qtd: 10 }, { tipo: "CUSTO ANTERIOR", qtd: 6 }] };
const AGSER = { status: "aprovado", documento: "03454838000143", data: "2026-08-27",
                fornecedor: "DISTRIBUIDORA DE ALIMENTOS SERIDO", hora: "09:00:00" };
eq("   sozinho, o limpo marcaria", M.caVeredito(AGSER, [LIMPO]).marcar, true);
eq("   sozinho, o sujo não marcaria", M.caVeredito(AGSER, [SUJO]).marcar, false);
eq("   os dois juntos: NÃO marca (limpo primeiro)", M.caVeredito(AGSER, [LIMPO, SUJO]).marcar, false);
eq("   os dois juntos: NÃO marca (sujo primeiro)", M.caVeredito(AGSER, [SUJO, LIMPO]).marcar, false);
eq("   a ordem não muda mais o resultado",
   M.caVeredito(AGSER, [LIMPO, SUJO]).marcar === M.caVeredito(AGSER, [SUJO, LIMPO]).marcar, true);
eq("   e diz por que parou", /2 conferências desta empresa hoje/.test(M.caVeredito(AGSER, [LIMPO, SUJO]).motivo), true);
eq("   caAchar devolve TODAS, não a primeira", M.caAchar(AGSER, [LIMPO, SUJO]).length, 2);
eq("   e ignora quem não é da empresa", M.caAchar(AGSER, [LIMPO, CONF, SUJO]).length, 2);

console.log("\n13) duas entregas da mesma empresa no mesmo dia: uma conferência não vale pelas duas");
const A1 = { ...AG, id: "a1", hora: "10:00:00" };
const A2 = { ...AG, id: "a2", hora: "15:00:00" };
eq("   sozinha, a entrega marca", M.caVeredito(A1, [CONF], [A1]).marcar, true);
eq("   com uma irmã no mesmo dia: NÃO marca", M.caVeredito(A1, [CONF], [A1, A2]).marcar, false);
eq("   a irmã também não marca", M.caVeredito(A2, [CONF], [A1, A2]).marcar, false);
eq("   e diz por que", /2 entregas desta empresa marcadas hoje/.test(M.caVeredito(A1, [CONF], [A1, A2]).motivo), true);
eq("   irmã CANCELADA não conta", M.caVeredito(A1, [CONF], [A1, { ...A2, status: "cancelado" }]).marcar, true);
eq("   irmã RECUSADA não conta", M.caVeredito(A1, [CONF], [A1, { ...A2, status: "recusado_na_doca" }]).marcar, true);
eq("   entrega de OUTRA empresa não conta",
   M.caVeredito(A1, [CONF], [A1, { ...A2, documento: "11222333000144" }]).marcar, true);
eq("   entrega em OUTRO dia não conta", M.caVeredito(A1, [CONF], [A1, { ...A2, data: "2026-08-29" }]).marcar, true);
eq("   sem a lista, segue como antes (compatível)", M.caVeredito(A1, [CONF]).marcar, true);
eq("   caIrmaos conta certo", M.caIrmaos(A1, [A1, A2]), 2);
eq("   caIrmaos com cnpj curto devolve zero", M.caIrmaos({ ...A1, documento: "123" }, [A1, A2]), 0);

console.log("\n14) a ordem da leitura é pedida, não sorteada");
eq("   caLoad pede ordem", /\.eq\("data", clDataISO\(new Date\(\)\)\)[\s\S]{0,400}?\.order\("id"\)/.test(HTML), true);
eq("   e passa a lista de entregas para o veredito", /caVeredito\(p, caHoje, clPedidos\)/.test(HTML), true);

console.log("\n" + ok + " ok, " + falhou + " falha(s).");
process.exit(falhou ? 1 : 0);
