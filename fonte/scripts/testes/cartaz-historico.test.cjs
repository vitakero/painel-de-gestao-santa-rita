// Testes do HISTÓRICO DE CARTAZES IMPRESSOS.
//
// Pedido do dono em 20/08/2026: "quando um funcionário cria esses cartaz [...] a placa se
// rasga, às vezes ela mancha porque molha alguma coisa, aí tem que imprimir um novo".
// O histórico guarda o que foi impresso pra ele repor UMA placa sem digitar tudo de novo.
//
// O que estes testes protegem: o retrato do cartaz tem que ser COMPLETO (senão a
// reimpressão sai com a validade da oferta que estiver aberta na tela), e o cartaz tem que
// sumir quando a oferta vence.
//   node scripts/testes/cartaz-historico.test.cjs
const fs = require("fs");
const path = require("path");

const HTML = fs.readFileSync(path.join(__dirname, "..", "..", "output", "index.html"), "utf8");
const ini = HTML.indexOf("==CZHIST-INICIO==");
const fim = HTML.indexOf("==CZHIST-FIM==");
if (ini < 0 || fim < 0) { console.log("ERRO: não achei o módulo CZHIST (rode o build antes)."); process.exit(1); }
const codigo = HTML.slice(HTML.indexOf("*/", ini) + 2, HTML.lastIndexOf("/*", fim));
const M = new Function(codigo +
  "\nreturn {czHistAssinatura,czHistVencido,czHistHoje,czHistDaLista,czHistParaItem,czHistRotulo,czHistDatas};")();

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + obtido +
              (bate ? "" : "   (esperado: " + esperado + ")"));
  bate ? ok++ : falhou++;
}

const CFG = { modelo:"padrao", tamanho:"A4", impressao:"multi",
              validade_ini:"2026-08-20", validade_fim:"2026-08-27",
              limite_cliente:"2", tema_nome:"Final de semana de ofertas" };
const P = { oferta:"OFERTA", nome:"ARROZ CAMIL", marca:"CAMIL", tipo:"TIPO 1",
            gram:"5KG", precoDe:"", preco:"29,99", qtd:3 };

console.log("\n-- O RETRATO TEM QUE SER DO CARTAZ INTEIRO --");
{
  /* Se a assinatura só olhasse o produto, dois cartazes do MESMO arroz — um em A4 e outro
     em A5, ou com validades diferentes — contariam como o mesmo, e a reimpressão sairia
     errada. Cada um destes tem que gerar assinatura DIFERENTE. */
  const base = M.czHistDaLista([P], CFG)[0];
  const dif = function(mudanca){
    const c = Object.assign({}, CFG, mudanca);
    return M.czHistDaLista([P], c)[0].assinatura !== base.assinatura;
  };
  eq("tamanho diferente = cartaz diferente",  dif({tamanho:"A5"}), true);
  eq("modelo diferente = cartaz diferente",   dif({modelo:"depor"}), true);
  eq("validade diferente = cartaz diferente", dif({validade_fim:"2026-09-30"}), true);
  eq("inicio diferente = cartaz diferente",   dif({validade_ini:"2026-08-01"}), true);
  eq("limite diferente = cartaz diferente",   dif({limite_cliente:"5"}), true);
  eq("cabecalho diferente = cartaz diferente",dif({tema_nome:"Pagando Menos"}), true);
  eq("folha unica x emenda = diferente",      dif({impressao:"unica"}), true);

  const outroPreco = M.czHistDaLista([Object.assign({}, P, {preco:"31,99"})], CFG)[0];
  eq("preco diferente = cartaz diferente", outroPreco.assinatura !== base.assinatura, true);
}

console.log("\n-- IMPRIMIR A MESMA LISTA DUAS VEZES NAO DOBRA A LISTA --");
{
  const a = M.czHistDaLista([P, P], CFG);
  eq("linha repetida vira uma so", a.length, 1);
  const b = M.czHistDaLista([P], CFG);
  eq("mesma assinatura nas duas vezes", a[0].assinatura === b[0].assinatura, true);
  /* Espaço a mais e maiúscula não fazem cartaz novo: quem digita "arroz camil" hoje e
     "ARROZ CAMIL " amanhã imprimiu o mesmo cartaz. */
  const c = M.czHistDaLista([Object.assign({}, P, {nome:"  arroz camil "})], CFG);
  eq("maiuscula e espaco nao criam duplicata", c[0].assinatura === b[0].assinatura, true);
}

console.log("\n-- A QUANTIDADE NAO ENTRA --");
{
  const a = M.czHistDaLista([Object.assign({}, P, {qtd:7})], CFG);
  eq("imprimiu 7, guarda 1 cartaz", a.length, 1);
  const item = M.czHistParaItem(a[0]);
  /* Rasgou uma placa, repõe uma placa. Se a quantidade voltasse, ele reimprimiria 7. */
  eq("ao reimprimir, a quantidade e 1", item.qtd, 1);
}

console.log("\n-- LINHA SEM NOME OU SEM PRECO NAO ENTRA --");
{
  eq("sem nome fica de fora",  M.czHistDaLista([Object.assign({}, P, {nome:""})], CFG).length, 0);
  eq("sem preco fica de fora", M.czHistDaLista([Object.assign({}, P, {preco:""})], CFG).length, 0);
  eq("so espaco fica de fora", M.czHistDaLista([Object.assign({}, P, {nome:"   "})], CFG).length, 0);
  eq("lista vazia nao quebra", M.czHistDaLista([], CFG).length, 0);
  eq("nulo nao quebra",        M.czHistDaLista(null, CFG).length, 0);
}

console.log("\n-- O 'DE R$' SO EXISTE NO MODELO DE/POR --");
{
  const comDe = Object.assign({}, P, {precoDe:"39,99"});
  /* No modelo padrão o "de" não sai no papel (czInner só desenha no De/Por). Se ele
     entrasse no retrato, dois cartazes que saem IDÊNTICOS contariam como diferentes. */
  eq("padrao ignora o de",  M.czHistDaLista([comDe], CFG)[0].preco_de, "");
  eq("depor guarda o de",   M.czHistDaLista([comDe], Object.assign({}, CFG, {modelo:"depor"}))[0].preco_de, "39,99");
}

console.log("\n-- SOME QUANDO A OFERTA VENCE --");
{
  eq("ontem venceu",          M.czHistVencido("2026-08-19","2026-08-20"), true);
  eq("hoje ainda vale",       M.czHistVencido("2026-08-20","2026-08-20"), false);
  eq("amanha ainda vale",     M.czHistVencido("2026-08-21","2026-08-20"), false);
  eq("vira o mes",            M.czHistVencido("2026-08-31","2026-09-01"), true);
  eq("vira o ano",            M.czHistVencido("2026-12-31","2027-01-01"), true);
  /* Sem data de fim eu NÃO considero vencido: melhor sobrar na lista do que sumir um
     cartaz que ainda está colado na gôndola. */
  eq("sem data nao vence",    M.czHistVencido("", "2026-08-20"), false);
  eq("nulo nao vence",        M.czHistVencido(null, "2026-08-20"), false);
}

console.log("\n-- A DATA DE HOJE E A DAQUI, NAO A DE GREENWICH --");
{
  /* toISOString converte pra UTC: às 21h de Caicó já é o dia seguinte lá, e o cartaz
     sumiria um dia antes da hora. Por isso monto a data na mão. */
  const noite = new Date(2026, 7, 20, 22, 30, 0);   // 20/08/2026, 22h30 local
  eq("noite continua sendo o mesmo dia", M.czHistHoje(noite), "2026-08-20");
  const cedo = new Date(2026, 0, 5, 1, 0, 0);
  eq("mes e dia com zero na frente",     M.czHistHoje(cedo), "2026-01-05");
}

console.log("\n-- O QUE A LINHA MOSTRA --");
{
  eq("junta tudo que tem", M.czHistRotulo({nome:"ARROZ",marca:"CAMIL",tipo:"TIPO 1",gramatura:"5KG"}),
     "ARROZ CAMIL TIPO 1 5KG");
  /* Sem marca e sem tipo não pode sobrar espaço duplo nem hífen solto. */
  eq("pula o que esta vazio", M.czHistRotulo({nome:"BANANA",marca:"",tipo:"",gramatura:"KG"}), "BANANA KG");
  eq("so o nome",             M.czHistRotulo({nome:"BANANA"}), "BANANA");
  eq("nada nao quebra",       M.czHistRotulo(null), "");
}

console.log("\n-- O CAMINHO DE VOLTA --");
{
  const r = M.czHistDaLista([P], CFG)[0];
  const item = M.czHistParaItem(r);
  eq("volta o nome",      item.nome, "ARROZ CAMIL");
  eq("volta a marca",     item.marca, "CAMIL");
  eq("volta o tipo",      item.tipo, "TIPO 1");
  eq("volta a gramatura", item.gram, "5KG");
  eq("volta o preco",     item.preco, "29,99");
  eq("volta o selo",      item.oferta, "OFERTA");
}

console.log("\n-- A LINHA MOSTRA AS DUAS DATAS --");
{
  /* Ele pediu em 20/08/2026: a lista só dizia até quando a placa valia; quem olha precisa
     saber de quando até quando. */
  eq("as duas datas",     M.czHistDatas({validade_ini:"2026-08-20", validade_fim:"2026-08-27"}),
     "vale de 20/08/2026 a 27/08/2026");
  /* Oferta de um dia só mostra as duas datas do mesmo jeito. Cheguei a resumir para
     "vale em 20/08" e ele pediu para não resumir: na lista, ver o começo e o fim é o que
     interessa. */
  eq("um dia so mostra os dois", M.czHistDatas({validade_ini:"2026-08-20", validade_fim:"2026-08-20"}),
     "vale de 20/08/2026 a 20/08/2026");
  eq("so o fim",          M.czHistDatas({validade_fim:"2026-08-27"}), "vale até 27/08/2026");
  eq("so o comeco",       M.czHistDatas({validade_ini:"2026-08-20"}), "a partir de 20/08/2026");
  eq("nenhuma das duas",  M.czHistDatas({}), "sem validade");
  eq("nulo nao quebra",   M.czHistDatas(null), "sem validade");
}

console.log("");
console.log(falhou ? ("FALHOU: " + falhou + " de " + (ok + falhou)) : ("TUDO OK: " + ok + " testes"));
process.exit(falhou ? 1 : 0);
