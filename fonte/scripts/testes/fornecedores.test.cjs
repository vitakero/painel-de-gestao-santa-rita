// Testes do CADASTRO DE FORNECEDOR (tela da loja).
//
// Decisão do dono em 14/08/2026: o fornecedor se cadastra no site dele, com login e senha,
// e a LOJA libera. O CNPJ é a identidade — é ele que junta "Marilan", "MARILAN IND LTDA" e
// "marilan" num fornecedor só.
//
// Por isso a conferência de CNPJ aqui é a de verdade, com dígito verificador: CNPJ digitado
// errado cria um fornecedor fantasma que nunca mais casa com nada, e o estrago só aparece
// meses depois, quando o histórico por fornecedor não fecha.
//
//   node scripts/testes/fornecedores.test.cjs
const fs = require("fs");
const path = require("path");

const HTML = fs.readFileSync(path.join(__dirname, "..", "..", "output", "index.html"), "utf8");
const ini = HTML.indexOf("==FRN-INICIO==");
const fim = HTML.indexOf("==FRN-FIM==");
if (ini < 0 || fim < 0) { console.log("ERRO: não achei o módulo FRN (rode o build antes)."); process.exit(1); }
const codigo = HTML.slice(HTML.indexOf("*/", ini) + 2, HTML.lastIndexOf("/*", fim));
const M = new Function(codigo + "\nreturn {frnCnpjLimpo,frnCnpjFmt,frnCnpjValido,frnSemAcento,frnCasa,frnFiltrar,frnResumo,frnEspera};")();

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + JSON.stringify(obtido) + (bate ? "" : "   (esperado: " + esperado + ")"));
  bate ? ok++ : falhou++;
}

console.log("\n=== Fornecedores — cadastro ===\n");

// ---------------------------------------------------------------- CNPJ de verdade
{
  // CNPJs válidos de verdade (dígitos conferem)
  eq("1) CNPJ válido passa", M.frnCnpjValido("11.222.333/0001-81"), "true");
  eq("2) o mesmo sem pontuação", M.frnCnpjValido("11222333000181"), "true");
  eq("3) CNPJ de banco grande passa", M.frnCnpjValido("60.701.190/0001-04"), "true");

  // um dígito trocado = inválido. É ESTE teste que impede o fornecedor fantasma.
  eq("4) último dígito errado NÃO passa", M.frnCnpjValido("11.222.333/0001-82"), "false");
  eq("5) dígito do meio trocado NÃO passa", M.frnCnpjValido("11.222.334/0001-81"), "false");
  eq("6) dois dígitos trocados de lugar NÃO passa", M.frnCnpjValido("11.222.333/0001-18"), "false");

  eq("7) curto demais não passa", M.frnCnpjValido("1122233300018"), "false");
  eq("8) longo demais não passa", M.frnCnpjValido("112223330001811"), "false");
  eq("9) tudo zero não passa", M.frnCnpjValido("00000000000000"), "false");
  eq("10) tudo um não passa", M.frnCnpjValido("11111111111111"), "false");
  eq("11) vazio não passa", M.frnCnpjValido(""), "false");
  eq("12) nulo não passa", M.frnCnpjValido(null), "false");
  eq("13) texto não passa", M.frnCnpjValido("nao sou cnpj"), "false");
  eq("14) e nada disso derruba a tela", (function(){ try{ M.frnCnpjValido(undefined); M.frnCnpjValido({}); return true; }catch(e){ return false; } })(), "true");
}

// ---------------------------------------------------------------- guardar e mostrar
{
  eq("15) guarda só os números", M.frnCnpjLimpo("11.222.333/0001-81"), "11222333000181");
  eq("16) mostra bonito", M.frnCnpjFmt("11222333000181"), "11.222.333/0001-81");
  eq("17) ida e volta não muda nada", M.frnCnpjLimpo(M.frnCnpjFmt("11222333000181")), "11222333000181");
  eq("18) o que não tem 14 fica como está", M.frnCnpjFmt("123"), "123");
  eq("19) nulo não vira 'null' na tela", M.frnCnpjFmt(null), "");
}

// ---------------------------------------------------------------- a busca
{
  const lista = [
    { id: "a", cnpj: "11222333000181", razao_social: "MARILAN IND. E COM. LTDA", nome_curto: "Marilan", email: "vendas@marilan.com", responsavel: "João", situacao: "liberado", criado_em: "2026-08-10T10:00:00Z" },
    { id: "b", cnpj: "60701190000104", razao_social: "Açúcar União S.A.", nome_curto: "União", email: "sac@uniao.com", responsavel: "Maria", situacao: "aguardando", criado_em: "2026-08-14T10:00:00Z" },
    { id: "c", cnpj: "11444777000161", razao_social: "Bebidas do Norte", nome_curto: "", email: "x@norte.com", responsavel: "", situacao: "recusado", criado_em: "2026-08-01T10:00:00Z" },
  ];

  eq("20) acha pelo nome", M.frnFiltrar(lista, "marilan", null).length, 1);
  eq("21) acha sem ligar pra maiúscula", M.frnFiltrar(lista, "MARILAN", null).length, 1);
  eq("22) acha SEM ACENTO (acucar acha Açúcar)", M.frnFiltrar(lista, "acucar", null).length, 1);
  eq("23) acha pelo apelido curto", M.frnFiltrar(lista, "uniao", null).length, 1);
  eq("24) acha pelo email", M.frnFiltrar(lista, "norte.com", null).length, 1);
  eq("25) acha pelo CNPJ com pontuação", M.frnFiltrar(lista, "11.222.333/0001-81", null).length, 1);
  eq("26) acha por pedaço do CNPJ", M.frnFiltrar(lista, "607011", null).length, 1);
  eq("27) busca vazia devolve todos", M.frnFiltrar(lista, "", null).length, 3);
  eq("28) busca que não acha nada devolve zero", M.frnFiltrar(lista, "zzzz", null).length, 0);
  eq("29) dois números não filtram por CNPJ (curto demais)", M.frnFiltrar(lista, "11", null).length, 0);

  eq("30) filtra por situação", M.frnFiltrar(lista, "", "liberado").length, 1);
  eq("31) situação + busca juntas", M.frnFiltrar(lista, "marilan", "aguardando").length, 0);
}

// ---------------------------------------------------------------- a ordem
{
  const lista = [
    { id: "1", razao_social: "Zebra", situacao: "liberado", cnpj: "" },
    { id: "2", razao_social: "Alfa", situacao: "liberado", cnpj: "" },
    { id: "3", razao_social: "Meio", situacao: "aguardando", cnpj: "" },
  ];
  const r = M.frnFiltrar(lista, "", null);
  eq("32) quem aguarda vem primeiro (é o que precisa de ação)", r[0].razao_social, "Meio");
  eq("33) o resto em ordem alfabética", r[1].razao_social + "," + r[2].razao_social, "Alfa,Zebra");
}

// ---------------------------------------------------------------- os números do topo
{
  const lista = [
    { situacao: "aguardando" }, { situacao: "aguardando" },
    { situacao: "liberado" },
    { situacao: "recusado" }, { situacao: "bloqueado" },
    { situacao: "situacao_esquisita" },
  ];
  const r = M.frnResumo(lista);
  eq("34) conta os que aguardam", r.aguardando, 2);
  eq("35) conta os liberados", r.liberado, 1);
  eq("36) conta os sem acesso", r.recusado + r.bloqueado, 2);
  eq("37) situação desconhecida não entra na conta", r.total, 5);
  eq("38) lista vazia não quebra", M.frnResumo([]).total, 0);
  eq("39) nulo não quebra", M.frnResumo(null).total, 0);
}

// ---------------------------------------------------------------- há quanto tempo espera
{
  const agora = new Date("2026-08-14T12:00:00Z").getTime();
  eq("40) pediu hoje", M.frnEspera("2026-08-14T08:00:00Z", agora), "hoje");
  eq("41) pediu ontem", M.frnEspera("2026-08-13T08:00:00Z", agora), "ontem");
  eq("42) pediu faz dias", M.frnEspera("2026-08-10T08:00:00Z", agora), "há 4 dias");
  eq("43) data inválida não vira 'NaN' na tela", M.frnEspera("xxx", agora), "");
  eq("44) nulo idem", M.frnEspera(null, agora), "");
}

console.log("");
console.log(falhou ? ("FALHOU: " + falhou + " de " + (ok + falhou)) : ("TUDO OK: " + ok + " testes"));
process.exit(falhou ? 1 : 0);
