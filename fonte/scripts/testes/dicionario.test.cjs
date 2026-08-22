// Testes do DICIONARIO DO CODIGO DO FORNECEDOR.
//
// De onde veio: medido em 3.480 notas reais (27.584 itens), 6.408 itens (23,2%) não
// tinham como casar com o pedido — a nota não traz código de barras nem a linha do
// pedido. São produtores locais: laticínio, frango, laranja, bolo de padaria. Quem
// fabrica em pequena escala não registra código de barras GS1, que é pago e anual.
//
// A saída estava dentro do VR há anos: a produtofornecedor guarda produto da loja ×
// fornecedor × código que aquele fornecedor usa. 27.741 equivalências.
//
// O que estes testes vigiam, e por quê:
//   · o dicionário decide se o item "tinha como ser casado" ANTES de acusar — senão
//     um produto que o dicionário conhece continuaria virando dúvida em vez de
//     acusação legítima;
//   · a ordem de casamento vai do mais firme para o mais frouxo;
//   · o fornecedor NÃO lê a tabela — ela tem o código interno de todos os outros;
//   · o código é gravado em maiúscula dos dois lados, senão "ab12" e "AB12" viram
//     linhas diferentes e a nota casa ou não conforme o dia.
//
//   node scripts/testes/dicionario.test.cjs
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..", "..");
const SQL = fs.readFileSync(path.join(RAIZ, "sql", "receb_c29_dicionario.sql"), "utf8");
const ROBO = fs.readFileSync(path.join(RAIZ, "scripts", "vr-sync-codigos.cjs"), "utf8");

let ok = 0, falhou = 0;
function t(nome, cond, extra) {
  if (cond) { ok++; return; }
  falhou++; console.log("  FALHOU: " + nome + (extra ? " -> " + extra : ""));
}
const conta = (txt, agulha) => txt.split(agulha).length - 1;

// ===================================================== a tabela
t("o dicionário existe", SQL.indexOf("create table if not exists public.receb_codigos_fornecedor") > 0);
t("um código por fornecedor, sem repetir",
  SQL.indexOf("(tenant_id, fornecedor_cnpj, codigo_fornecedor)") > 0);
t("guarda o produto do VR, que é o que casa com o pedido", SQL.indexOf("produto_vr") > 0);
// nota em CAIXA x pedido em UNIDADE
t("traz a embalagem junto", SQL.indexOf("qtd_embalagem") > 0 && SQL.indexOf("fator_embalagem") > 0);

// ===================================================== quem vê
t("está trancado", SQL.indexOf("alter table public.receb_codigos_fornecedor enable row level security") > 0);
t("só a Central e o master leem",
  SQL.indexOf("public.sou_master() or public.pode_pagina('central')") > 0);
t("nenhuma policy de escrita", conta(SQL, "create policy") === 1,
  "achei " + conta(SQL, "create policy"));
t("a policy é só de leitura", SQL.indexOf("for select to authenticated") > 0);

// ===================================================== maiúscula dos dois lados
t("o robô grava em maiúscula", ROBO.indexOf("const codU = cod.toUpperCase();") > 0);
t("e a busca compara em maiúscula", SQL.indexOf("d.codigo_fornecedor = upper(v_cod)") > 0);
t("o motivo está escrito no código", ROBO.indexOf("GRAVO EM MAIUSCULA") > 0);

// ===================================================== a ordem de casamento
const fn = SQL.slice(SQL.indexOf("function public.forn_conferir_nota"));
const iSeq = fn.indexOf("if v_seq is not null then");
const iEan = fn.indexOf("if not v_achou and v_ean is not null then");
const iDic = fn.indexOf("if not v_achou and v_prod_vr is not null then");
t("casa primeiro pela linha do pedido", iSeq > 0);
t("depois pelo código de barras", iEan > iSeq);
t("e por último pelo dicionário", iDic > iEan);

// O DETALHE QUE DECIDE: o dicionário é consultado ANTES de julgar se o item tinha
// como ser casado. Consultar depois faria um produto conhecido virar "dúvida".
const iConsulta = fn.indexOf("select d.produto_vr into v_prod_vr");
const iJulga = fn.indexOf("v_tinha_como := ");
t("o dicionário é consultado antes de julgar", iConsulta > 0 && iConsulta < iJulga,
  "consultar depois faria produto conhecido virar dúvida");
t("o dicionário conta como 'tinha como casar'",
  fn.indexOf("(v_prod_vr is not null)") > 0);

// ===================================================== dúvida x acusação continua
t("dúvida continua separada de acusação", fn.indexOf("v_sit := 'indefinido'") > 0);
t("dúvida não entra em problemas", fn.indexOf("'problemas', v_acima + v_fora + v_preco") > 0);
t("mede quanto o dicionário recuperou", fn.indexOf("'pelo_dicionario', v_pelo_dic") > 0);

// ===================================================== o robô
t("lê as duas tabelas de código", ROBO.indexOf("produtofornecedor") > 0 &&
  ROBO.indexOf("produtofornecedorcodigoexterno") > 0);
t("junta o CNPJ do fornecedor", ROBO.indexOf("join public.fornecedor f on f.id = pf.id_fornecedor") > 0);
// O CNPJ vem NUMERIC do VR e chega SEM os zeros da frente. Exigir 14 dígitos exatos
// descartou 14.608 de 31.030 equivalências na primeira rodada — quase metade.
// A mesma armadilha já tinha mordido o robô dos pedidos; a função é a mesma nos dois.
t("recompõe os zeros do CNPJ", ROBO.indexOf('s.padStart(14, "0")') > 0,
  "sem isso, CNPJ que começa com zero é descartado");
t("e diz por que", ROBO.indexOf("SEM OS ZEROS DA FRENTE") > 0);
t("descarta só o que não é nem CPF", ROBO.indexOf('cnpj.replace(/^0+/, "").length < 11') > 0);

// A MESMA leitura dos dois lados: quem tem que se reconhecer não pode ler o campo
// de jeitos diferentes.
const PED = fs.readFileSync(path.join(RAIZ, "scripts", "vr-sync-pedidos.cjs"), "utf8");
const mesma = function (txt) {
  const i = txt.indexOf("function cnpj14(v) {");
  return i < 0 ? null : txt.slice(i, txt.indexOf("}", txt.indexOf("return", i)) + 1)
                            .replace(/\s+/g, " ");
};
t("os dois robôs leem o CNPJ do mesmo jeito", mesma(ROBO) !== null && mesma(ROBO) === mesma(PED),
  "duas leituras diferentes do mesmo campo sempre divergem");
t("não repete o mesmo par das duas tabelas", ROBO.indexOf("if (vistos[k]) continue;") > 0);
t("grava em pedaços", ROBO.indexOf("i += 500") > 0);
t("regravar não duplica", ROBO.indexOf("resolution=merge-duplicates") > 0);
t("só lê o VR", ROBO.indexOf("insert into") < 0 && ROBO.indexOf("update public.") < 0);
t("o fim vira evento na nuvem", ROBO.indexOf('entidade: "vr_codigos_sync"') > 0);
t("morte inesperada fica registrada",
  ROBO.indexOf("uncaughtException") > 0 && ROBO.indexOf("unhandledRejection") > 0);

console.log(falhou ? ("FALHOU: " + falhou + " de " + (ok + falhou)) : ("TUDO OK: " + ok + " testes"));
process.exit(falhou ? 1 : 0);
