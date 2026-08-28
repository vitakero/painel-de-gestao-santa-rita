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
  + "\nreturn {caDigitos,caContagem,caAchar,caVeredito};")();

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
               bipagens: 9, notas: 1,
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
const comTipo = (t, q) => M.caVeredito(AG, [{ ...CONF, tipos: [{ tipo: t, qtd: q || 1 }] }]);
["NAO ENTREGUE", "QUANTIDADE", "COLETOR", "SEM PEDIDO"].forEach(t =>
  eq("   " + t + " SEGURA o carro", comTipo(t).marcar, false));
["CUSTO", "CUSTO ANTERIOR"].forEach(t =>
  eq("   " + t + " NÃO segura", comTipo(t).marcar, true));
eq("   sem divergência nenhuma: marca", M.caVeredito(AG, [{ ...CONF, tipos: [] }]).marcar, true);
eq("   preço E contagem juntos: segura",
   M.caVeredito(AG, [{ ...CONF, tipos: [{ tipo: "CUSTO", qtd: 5 }, { tipo: "QUANTIDADE", qtd: 1 }] }]).marcar, false);
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
eq("   conferência sem tipos", M.caVeredito(AG, [{ ...CONF, tipos: undefined }]).marcar, true);

console.log("\n8) está LIGADO — marca de verdade (decisão dele em 28/08)");
eq("   o interruptor existe", /var CA_MODO="(marcar|mostrar)"/.test(HTML), true);
eq("   está em MARCAR", /var CA_MODO="marcar"/.test(HTML), true);
// A REGRA DE DESENHO: toda gravação de status passa por UM lugar só (clEnviarStatus).
// Eu tinha furado isso chamando a RPC direto; o teste da doca pegou.
eq("   marca pela gravação única", /clEnviarStatus\(p\.id, "conferido", null, p\.fornecedor, true\)/.test(HTML), true);
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
   /clPedidosLoad\(\);\s*\n\s*clAvisarFornecedor\(id, status, quem\);/.test(HTML), true);

console.log("\n10) a linha do tempo para de mentir com o relógio");
eq("   olha a conferência antes do relógio", /if\(vv && vv\.marcar\) return \{k:"concluido",t:"Conferido"\};/.test(HTML), true);
eq("   não sobrepõe recusado", /String\(a\.situacao\|\|""\)\.indexOf\("recusad"\)<0/.test(HTML), true);
eq("   não sobrepõe cancelado", /a\.situacao!=="cancelado"/.test(HTML), true);

console.log("\n" + ok + " ok, " + falhou + " falha(s).");
process.exit(falhou ? 1 : 0);
