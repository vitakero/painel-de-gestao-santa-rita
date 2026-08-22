// Testes do LEITOR DE XML DA NOTA FISCAL.
//
// É ele que decide o que a loja vai ver dentro do caminhão. Se ele errar, a
// conferência compara coisa errada com o pedido — e o erro parece do fornecedor.
//
// Não uso biblioteca de XML de propósito: o robô da máquina da loja não tem como
// instalar pacote novo. A NFe é previsível o bastante para ler na mão; o que não é
// previsível está aqui embaixo, caso a caso.
//
//   node scripts/testes/nfe-leitura.test.cjs
const fs = require("fs");
const path = require("path");

const FONTE = fs.readFileSync(path.join(__dirname, "..", "vr-sync-notas.cjs"), "utf8");
const i = FONTE.indexOf("==NFELER-INICIO==");
const f = FONTE.indexOf("==NFELER-FIM==");
if (i < 0 || f < 0) { console.log("ERRO: não achei o bloco NFELER."); process.exit(1); }
const bloco = FONTE.slice(FONTE.indexOf("*/", i) + 2, FONTE.lastIndexOf("/*", f));
const lerNfe = new Function(bloco + "; return lerNfe;")();

let ok = 0, falhou = 0;
function t(nome, cond, extra) {
  if (cond) { ok++; return; }
  falhou++; console.log("  FALHOU: " + nome + (extra ? " -> " + extra : ""));
}

// Uma NFe de verdade, no formato que o VR entregou em 20/08/2026 (versão 4.00).
// Dois produtos: um com código de barras, outro "SEM GTIN" — que é o que a norma
// manda escrever quando o produto não tem código.
const XML =
'<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">' +
'<NFe><infNFe Id="NFe26260884432111000671550030002932011971019066" versao="4.00">' +
'<ide><cUF>26</cUF><natOp>REVENDA/ VENDAS</natOp><mod>55</mod><serie>3</serie><nNF>293201</nNF>' +
'<dhEmi>2026-08-20T17:28:00-03:00</dhEmi><tpNF>1</tpNF></ide>' +
'<emit><CNPJ>84432111000671</CNPJ><xNome>ATACADAO NORDESTE LTDA</xNome></emit>' +
'<dest><CNPJ>12988127000140</CNPJ><xNome>SUPERMERCADO SANTA RITA</xNome></dest>' +
'<det nItem="1"><prod><cProd>7788</cProd><cEAN>7891000053508</cEAN><xProd>LEITE INTEGRAL 1L</xProd>' +
'<NCM>04012010</NCM><CFOP>5102</CFOP><uCom>CX</uCom><qCom>10.0000</qCom>' +
'<vUnCom>52.9000</vUnCom><vProd>529.00</vProd><xPed>45231</xPed><nItemPed>3</nItemPed></prod></det>' +
'<det nItem="2"><prod><cProd>9911</cProd><cEAN>SEM GTIN</cEAN><xProd>BANDEJA ISOPOR 10</xProd>' +
'<NCM>39241000</NCM><CFOP>5102</CFOP><uCom>PC</uCom><qCom>200.0000</qCom>' +
'<vUnCom>0.4500</vUnCom><vProd>90.00</vProd></prod></det>' +
'<total><ICMSTot><vBC>0.00</vBC><vNF>619.00</vNF></ICMSTot></total>' +
'</infNFe><infNFeSupl><qrCode>https://exemplo</qrCode></infNFeSupl></NFe>' +
'<protNFe><infProt><nProt>126260000000001</nProt></infProt></protNFe></nfeProc>';

const n = lerNfe(XML);

// ------------------------------------------------------------------ o cabeçalho
t("número da nota", n.numero === "293201", n.numero);
t("série", n.serie === "3", n.serie);
t("data de emissão", n.emissao === "2026-08-20T17:28:00-03:00", n.emissao);
t("valor total", n.valor_total === 619, String(n.valor_total));

// O CNPJ aparece em emit, dest e transportadora. Pegar o primeiro <CNPJ> do arquivo
// inteiro trocaria quem emitiu por quem recebeu — e a trava "a nota tem que ser do
// próprio fornecedor" passaria a recusar todo mundo.
t("CNPJ de quem EMITIU", n.emitente_cnpj === "84432111000671", n.emitente_cnpj);
t("nome de quem emitiu", n.emitente_nome === "ATACADAO NORDESTE LTDA", n.emitente_nome);
t("CNPJ do destinatário é o da loja", n.destin_cnpj === "12988127000140", n.destin_cnpj);

// ------------------------------------------------------------------ os produtos
t("achou os dois produtos", n.itens.length === 2, "achei " + n.itens.length);

const a = n.itens[0] || {}, b = n.itens[1] || {};
t("código do produto", a.codigo === "7788", a.codigo);
t("código de barras", a.ean === "7891000053508", a.ean);
t("descrição", a.descricao === "LEITE INTEGRAL 1L", a.descricao);
t("NCM", a.ncm === "04012010", a.ncm);
t("CFOP", a.cfop === "5102", a.cfop);
t("unidade", a.unidade === "CX", a.unidade);
t("quantidade vira número", a.qtd === 10, String(a.qtd));
t("preço unitário vira número", a.valor_unit === 52.9, String(a.valor_unit));
t("total do item", a.valor_total === 529, String(a.valor_total));

// O pedido vem DENTRO do produto na NFe. É o que permite conferir item a item
// contra o pedido certo quando a nota traz mais de um.
t("número do pedido do item", a.pedido === "45231", a.pedido);
t("linha do pedido", a.item_pedido === "3", a.item_pedido);
t("a ordem dos itens é preservada", a.seq === 1 && b.seq === 2);

// "SEM GTIN" é texto, não código. Guardar isso como se fosse EAN faria a conferência
// casar produtos diferentes que só têm em comum o fato de não terem código de barras.
t("'SEM GTIN' não vira código de barras", b.ean === null, String(b.ean));
t("produto sem GTIN é lido do mesmo jeito", b.descricao === "BANDEJA ISOPOR 10" && b.qtd === 200);
// Nem todo item traz pedido: quem não traz fica nulo, não fica com o do vizinho.
t("item sem pedido fica sem pedido", b.pedido === null && b.item_pedido === null,
  String(b.pedido) + " / " + String(b.item_pedido));

// ------------------------------------------------------ o que não pode derrubar
const vazio = lerNfe("<xml></xml>");
t("XML irreconhecível não quebra", vazio && Array.isArray(vazio.itens) && vazio.itens.length === 0);
t("XML irreconhecível não inventa dados", vazio.numero === null && vazio.emitente_cnpj === null);

const semProd = lerNfe('<infNFe><ide><nNF>1</nNF></ide><det nItem="1"><imposto></imposto></det></infNFe>');
t("item sem bloco de produto é pulado", semProd.itens.length === 0, "achei " + semProd.itens.length);

// Uma nota com 150 itens já apareceu no VR: o leitor não pode parar no primeiro punhado.
let muitos = '<infNFe><ide><nNF>9</nNF></ide>';
for (let k = 1; k <= 150; k++) {
  muitos += '<det nItem="' + k + '"><prod><cProd>' + k + '</cProd><xProd>P' + k +
            '</xProd><qCom>1.0000</qCom><vUnCom>1.00</vUnCom></prod></det>';
}
muitos += "</infNFe>";
const m150 = lerNfe(muitos);
t("lê nota com 150 itens", m150.itens.length === 150, "li " + m150.itens.length);
t("o último item está certo", m150.itens[149] && m150.itens[149].descricao === "P150");

console.log(falhou ? ("FALHOU: " + falhou + " de " + (ok + falhou)) : ("TUDO OK: " + ok + " testes"));
process.exit(falhou ? 1 : 0);
