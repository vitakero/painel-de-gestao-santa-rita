// Testes do PORTAL DO FORNECEDOR — as contas puras (data, hora, número, CNPJ).
//
// Por que existe: o calendário do portal posiciona a entrega por conta de data e
// minuto. Errar isso não dá erro na tela — dá uma entrega aparecendo no dia errado,
// e o fornecedor só descobre quando o caminhão chega em dia de loja fechada.
//
// O recorte é o bloco entre ==PORTAL-INICIO== e ==PORTAL-FIM== do agendar.html,
// que só contém função pura: nada de tela, nada de rede.
//
//   node scripts/montar-portal.cjs && node scripts/testes/portal-agenda.test.cjs
const fs = require("fs");
const path = require("path");

const HTML = fs.readFileSync(path.join(__dirname, "..", "..", "output", "agendar.html"), "utf8");
const ini = HTML.indexOf("==PORTAL-INICIO==");
const fim = HTML.indexOf("==PORTAL-FIM==");
if (ini < 0 || fim < 0) {
  
console.log("ERRO: não achei o bloco PORTAL (rode: node scripts/montar-portal.cjs)");
  process.exit(1);
}
const codigo = HTML.slice(HTML.indexOf("*/", ini) + 2, HTML.lastIndexOf("/*", fim));

const M = new Function(codigo + `
  return { esc, maiuscula, numero, moeda, cnpjLimpo, cnpjFmt, cnpjValido,
           isoData, hojeIso, deIso, partes, quandoTxt, minutos, inicioSemana,
           uiSelo, TXT_SIT, TXT_TIPO, MESES, DOWS,
           nfeDigito, nfeChaveLimpa, nfeChaveFmt, nfeChaveLer, UFS, nfeLerXml,
           mesCasas, mesTitulo, mesAndar, mesUltimoDia, faixaHora, pesoNum };`)();

let ok = 0, ruim = 0;
function t(nome, real, esperado) {
  const a = JSON.stringify(real), b = JSON.stringify(esperado);
  if (a === b) { ok++; }
  else { ruim++; console.log("FALHOU: " + nome + "\n  esperava " + b + "\n  veio     " + a); }
}
function tv(nome, cond) { if (cond) ok++; else { ruim++; console.log("FALHOU: " + nome); } }

// ---------------------------------------------------------------
// 1) DATA — o pedaço que não pode depender do fuso do aparelho
// ---------------------------------------------------------------
t("isoData monta AAAA-MM-DD", M.isoData(new Date(2026, 7, 5)), "2026-08-05");
t("isoData preenche com zero", M.isoData(new Date(2026, 0, 9)), "2026-01-09");
t("isoData na virada do ano", M.isoData(new Date(2026, 11, 31)), "2026-12-31");

t("deIso volta pro mesmo dia", M.isoData(M.deIso("2026-08-15")), "2026-08-15");
tv("deIso recusa lixo", M.deIso("abacaxi") === null);
tv("deIso recusa vazio", M.deIso("") === null);

// 2026-08-15 é sábado
t("partes acha o dia da semana", M.partes("2026-08-15T08:00").longa, "sábado, 15 de ago");
t("partes separa a hora", M.partes("2026-08-15T08:30").hora, "08:30");
t("partes sem hora devolve vazio", M.partes("2026-08-15").hora, "");
t("partes na data curta", M.partes("2026-08-15T08:00").curta, "15/08/2026");
tv("partes recusa lixo", M.partes("xx") === null);

// A conta que o navegador estraga: em fuso a oeste, new Date("2026-08-15")
// vira 14/08 às 21h. O portal monta na mão justamente por isso.
t("data não anda para trás", M.partes("2026-08-01T07:00").curta, "01/08/2026");
t("primeiro dia do mês continua sendo dia 1", M.partes("2026-03-01T07:00").longa, "domingo, 01 de mar");

// ---------------------------------------------------------------
// 2) MINUTOS — é o que posiciona o evento na grade do calendário
// ---------------------------------------------------------------
t("minutos de 07:00", M.minutos("2026-08-17T07:00"), 420);
t("minutos de 08:30", M.minutos("2026-08-17T08:30"), 510);
t("minutos de 00:00", M.minutos("2026-08-17T00:00"), 0);
t("minutos de 19:45", M.minutos("2026-08-17T19:45"), 1185);
t("minutos sem hora não explode", M.minutos("2026-08-17"), 0);
t("minutos de nulo não explode", M.minutos(null), 0);

// duração de 1 hora = 60 minutos de diferença
tv("uma hora dá 60 minutos",
   M.minutos("2026-08-17T09:00") - M.minutos("2026-08-17T08:00") === 60);

// ---------------------------------------------------------------
// 3) SEMANA — decide em qual coluna a entrega cai
// ---------------------------------------------------------------
// 2026-08-15 é sábado; a semana dele começa no domingo 09
t("semana do sábado começa no domingo anterior",
  M.isoData(M.inicioSemana(new Date(2026, 7, 15))), "2026-08-09");
t("semana do domingo começa nele mesmo",
  M.isoData(M.inicioSemana(new Date(2026, 7, 9))), "2026-08-09");
t("semana da segunda volta pro domingo",
  M.isoData(M.inicioSemana(new Date(2026, 7, 10))), "2026-08-09");
// virada de mês
t("semana pega mês anterior quando precisa",
  M.isoData(M.inicioSemana(new Date(2026, 8, 1))), "2026-08-30");
// virada de ano
t("semana pega ano anterior quando precisa",
  M.isoData(M.inicioSemana(new Date(2027, 0, 1))), "2026-12-27");
// a semana tem 7 dias e o último é sábado
(function () {
  const d0 = M.inicioSemana(new Date(2026, 7, 15));
  const d6 = new Date(d0); d6.setDate(d6.getDate() + 6);
  tv("semana termina no sábado", d6.getDay() === 6);
  t("semana termina em 15/08", M.isoData(d6), "2026-08-15");
})();
// inicioSemana não pode alterar a data recebida
(function () {
  const orig = new Date(2026, 7, 15);
  M.inicioSemana(orig);
  t("inicioSemana não mexe na data original", M.isoData(orig), "2026-08-15");
})();

// ---------------------------------------------------------------
// 4) QUANDO — o texto que vai para a tabela
// ---------------------------------------------------------------
t("quandoTxt com hora e fim", M.quandoTxt("2026-08-17T08:00", "09:00"), "17/08/2026 às 08:00 até 09:00");
t("quandoTxt sem fim", M.quandoTxt("2026-08-17T08:00", null), "17/08/2026 às 08:00");
t("quandoTxt sem nada", M.quandoTxt(null, null), "—");
t("quandoTxt de agenda não confirmada", M.quandoTxt("", ""), "—");

// ---------------------------------------------------------------
// 5) NÚMERO E DINHEIRO — o banco devolve com ponto decimal
// ---------------------------------------------------------------
t("peso do banco vira número daqui", M.numero("1240.500"), "1.240,5");
t("número inteiro sem casa", M.numero("400"), "400");
t("número com 2 casas forçadas", M.numero("18420.9", 2), "18.420,90");
t("número de lixo devolve vazio", M.numero("abacaxi"), "");
t("número nulo devolve vazio", M.numero(null), "");
t("moeda formata", M.moeda("18420.90"), "R$ 18.420,90");
t("moeda de zero ainda é zero", M.moeda("0"), "R$ 0,00");
t("moeda de lixo devolve vazio", M.moeda("x"), "");
// o erro que estava na primeira versão: mostrar "1240.500 kg" na tela
tv("peso não sai com ponto americano", M.numero("1240.500").indexOf(".500") < 0);

// ---------------------------------------------------------------
// 6) CNPJ — é a identidade do fornecedor
// ---------------------------------------------------------------
tv("CNPJ real passa", M.cnpjValido("11222333000181"));
tv("CNPJ com máscara passa", M.cnpjValido("11.222.333/0001-81"));
tv("dígito trocado não passa", !M.cnpjValido("11222333000182"));
tv("todos iguais não passa", !M.cnpjValido("11111111111111"));
tv("curto não passa", !M.cnpjValido("112223330001"));
tv("vazio não passa", !M.cnpjValido(""));
t("formata na medida", M.cnpjFmt("11222333000181"), "11.222.333/0001-81");
t("formata parcial sem quebrar", M.cnpjFmt("11222"), "11.222");
t("limpa o que não é número", M.cnpjLimpo("11.222.333/0001-81"), "11222333000181");

// ---------------------------------------------------------------
// 7) SITUAÇÃO — o fornecedor não pode ler nome de sistema
// ---------------------------------------------------------------
t("solicitada vira palavra de gente", M.TXT_SIT.solicitada, "aguardando");
t("em_recebimento vira palavra de gente", M.TXT_SIT.em_recebimento, "em descarga");
t("nao_compareceu vira palavra de gente", M.TXT_SIT.nao_compareceu, "não compareceu");
tv("selo carrega a classe da situação", M.uiSelo("confirmada").indexOf('class="selo confirmada"') > 0);
tv("selo mostra o texto traduzido", M.uiSelo("concluida").indexOf("concluída") > 0);
// situação que o banco criar amanhã não pode sumir da tela
tv("situação desconhecida ainda aparece", M.uiSelo("inventada").indexOf("inventada") > 0);
// todas as situações da máquina de estados precisam de tradução
["rascunho","solicitada","confirmada","em_recebimento","concluida",
 "recusada","cancelada","nao_compareceu"].forEach(function (s) {
  tv("situação " + s + " tem tradução", !!M.TXT_SIT[s]);
});
["entrega","coleta","representante"].forEach(function (s) {
  tv("tipo " + s + " tem tradução", !!M.TXT_TIPO[s]);
});

// ---------------------------------------------------------------
// 8) ESCAPE — dado do banco não pode virar HTML
// ---------------------------------------------------------------
t("escapa sinal de menor", M.esc("<b>oi</b>"), "&lt;b&gt;oi&lt;/b&gt;");
t("escapa aspas", M.esc('a"b'), "a&quot;b");
t("escapa e comercial", M.esc("a&b"), "a&amp;b");
t("nulo vira vazio", M.esc(null), "");
tv("script não passa inteiro", M.esc("<script>alert(1)</script>").indexOf("<script") < 0);

// ---------------------------------------------------------------
// 9) MAIÚSCULA — o mês no título do calendário
// ---------------------------------------------------------------
t("mês começa com maiúscula", M.maiuscula("agosto"), "Agosto");
t("maiuscula de vazio não quebra", M.maiuscula(""), "");
t("maiuscula de nulo não quebra", M.maiuscula(null), "");
// o defeito que apareceu na primeira versão: "Agosto De 2026"
tv("só a primeira letra sobe", M.maiuscula("agosto") + " de 2026" === "Agosto de 2026");


// ---------------------------------------------------------------
// 10) A CHAVE DA NOTA FISCAL — 44 números que se conferem sozinhos
//
// Chaves reais de NF-e, com o dígito verificador de verdade. Se a conta do
// dígito estiver errada, o portal aceita chave inventada — e a loja fica
// esperando uma nota que não existe.
// ---------------------------------------------------------------
// RN (24), agosto/2026, CNPJ 11222333000181, modelo 55, série 1, nota 128944
const BASE43 = "24" + "2608" + "11222333000181" + "55" + "001" + "000128944" + "1" + "00000001";
tv("a base tem 43 números", BASE43.length === 43);
const DV = M.nfeDigito(BASE43);
const CHAVE = BASE43 + DV;
tv("a chave montada tem 44", CHAVE.length === 44);

(function () {
  const r = M.nfeChaveLer(CHAVE);
  tv("chave válida é aceita", r.ok === true);
  t("lê o estado", r.uf, "RN");
  t("lê o mês e ano da emissão", r.emissao, "08/2026");
  t("lê o CNPJ de quem emitiu", r.cnpj, "11222333000181");
  t("lê o número da nota", r.numero, "128944");
  t("lê a série", r.serie, "1");
  t("modelo 55 não gera aviso", r.aviso, "");
})();

// o dígito verificador é o que pega número trocado
(function () {
  const errado = BASE43 + ((DV + 1) % 10);
  const r = M.nfeChaveLer(errado);
  tv("dígito trocado é recusado", r.ok === false);
  tv("e explica o motivo", /não confere|trocado/i.test(r.erro));
})();

// trocar dois números do meio também tem que cair
(function () {
  let d = CHAVE.split("");
  const a = d[10], b = d[11];
  if (a !== b) { d[10] = b; d[11] = a; }
  else { d[10] = String((parseInt(a, 10) + 1) % 10); }
  tv("números trocados de lugar são recusados", M.nfeChaveLer(d.join("")).ok === false);
})();

// tamanho
tv("chave curta é recusada", M.nfeChaveLer("2426081122").ok === false);
tv("e diz quantos faltam", /Faltam 34/.test(M.nfeChaveLer("2426081122").erro));
tv("campo vazio não acusa erro", M.nfeChaveLer("").vazia === true);
t("campo vazio não mostra mensagem", M.nfeChaveLer("").erro, "");

// estado inexistente
(function () {
  const b = "99" + BASE43.slice(2);
  tv("estado que não existe é recusado", M.nfeChaveLer(b + M.nfeDigito(b)).ok === false);
})();

// mês inexistente
(function () {
  const b = "24" + "2613" + BASE43.slice(6);
  tv("mês 13 é recusado", M.nfeChaveLer(b + M.nfeDigito(b)).ok === false);
})();

// cupom de consumidor não é nota de entrega
(function () {
  const b = BASE43.slice(0, 20) + "65" + BASE43.slice(22);
  const r = M.nfeChaveLer(b + M.nfeDigito(b));
  tv("modelo 65 passa mas avisa", r.ok === true && /cupom/i.test(r.aviso));
})();

// aceita o que a pessoa cola com espaço, ponto ou traço
tv("aceita chave com espaços", M.nfeChaveLer(M.nfeChaveFmt(CHAVE)).ok === true);
tv("aceita chave com pontuação", M.nfeChaveLer(CHAVE.replace(/(....)/g, "$1.")).ok === true);
t("limpa o que não é número", M.nfeChaveLimpa("24 26.08-11"), "242608 11".replace(/ /g, ""));
t("nunca passa de 44", M.nfeChaveLimpa(CHAVE + "999999").length, 44);

// o formatador agrupa de 4 em 4 e não perde número
t("formata de 4 em 4", M.nfeChaveFmt("12345678").indexOf(" "), 4);
t("formatar e limpar volta ao mesmo", M.nfeChaveLimpa(M.nfeChaveFmt(CHAVE)), CHAVE);

// a conta do dígito, direto
t("dígito de base conhecida", M.nfeDigito("1".repeat(43)), M.nfeDigito("1".repeat(43)));
tv("dígito fica entre 0 e 9", M.nfeDigito(BASE43) >= 0 && M.nfeDigito(BASE43) <= 9);
// resto 0 ou 1 vira dígito 0 — o caso que quase todo mundo erra
tv("dígito nunca é 10 nem 11", [0,1,2,3,4,5,6,7,8,9].indexOf(M.nfeDigito("0".repeat(43))) >= 0);
t("todos zeros dá dígito 0", M.nfeDigito("0".repeat(43)), 0);

// todos os estados do país estão na lista
tv("tem os 27 estados", Object.keys(M.UFS).length === 27);
t("24 é o Rio Grande do Norte", M.UFS["24"], "RN");


// ---------------------------------------------------------------
// 11) O ARQUIVO XML DA NOTA
//
// O XML da NF-e chega de jeitos diferentes conforme quem emitiu: embrulhado
// em <nfeProc> ou só <NFe>, com prefixo de espaço de nomes ou sem, com a data
// no campo novo (dhEmi) ou no antigo (dEmi). Um leitor que só entende um
// formato passa nos testes e falha no primeiro arquivo real do fornecedor.
// ---------------------------------------------------------------
const CH2 = (function () {
  const b43 = "24" + "2608" + "11222333000181" + "55" + "001" + "000128944" + "1" + "00000001";
  return b43 + M.nfeDigito(b43);
})();

const XML_PROC =
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe>' +
  '<infNFe Id="NFe' + CH2 + '" versao="4.00">' +
  '<ide><cUF>24</cUF><nNF>128944</nNF><serie>1</serie><dhEmi>2026-08-10T09:15:00-03:00</dhEmi></ide>' +
  '<emit><CNPJ>11222333000181</CNPJ><xNome>DISTRIBUIDORA NORDESTE ALIMENTOS LTDA</xNome></emit>' +
  '<dest><CNPJ>99888777000166</CNPJ><xNome>SUPERMERCADO SANTA RITA LTDA</xNome></dest>' +
  '<total><ICMSTot><vNF>18420.90</vNF></ICMSTot></total>' +
  '</infNFe></NFe><protNFe><infProt><chNFe>' + CH2 + '</chNFe></infProt></protNFe></nfeProc>';

const XML_NS =
  '<ns0:NFe xmlns:ns0="http://www.portalfiscal.inf.br/nfe">' +
  '<ns0:infNFe Id="NFe' + CH2 + '"><ns0:ide><ns0:nNF>128944</ns0:nNF><ns0:serie>1</ns0:serie>' +
  '<ns0:dEmi>2026-08-10</ns0:dEmi></ns0:ide>' +
  '<ns0:emit><ns0:CNPJ>11222333000181</ns0:CNPJ><ns0:xNome>DISTRIBUIDORA</ns0:xNome></ns0:emit>' +
  '<ns0:dest><ns0:CNPJ>99888777000166</ns0:CNPJ></ns0:dest></ns0:infNFe></ns0:NFe>';

(function () {
  const r = M.nfeLerXml(XML_PROC);
  tv("lê o XML embrulhado em nfeProc", r.ok === true);
  t("acha a chave", r.chave, CH2);
  t("acha o número", r.numero, "128944");
  t("acha a série", r.serie, "1");
  t("acha a emissão", r.emissao, "10/08/2026");
  t("acha o CNPJ de quem emitiu", r.emitenteCnpj, "11222333000181");
  t("acha o nome de quem emitiu", r.emitenteNome, "DISTRIBUIDORA NORDESTE ALIMENTOS LTDA");
  t("acha o CNPJ do destinatário", r.destinoCnpj, "99888777000166");
  t("acha o valor", r.valor, "18420.90");
})();

(function () {
  const r = M.nfeLerXml(XML_NS);
  tv("lê o XML com prefixo de espaço de nomes", r.ok === true);
  t("chave igual nos dois formatos", r.chave, CH2);
  t("emitente igual nos dois formatos", r.emitenteCnpj, "11222333000181");
  t("entende a data no formato antigo (dEmi)", r.emissao, "10/08/2026");
})();

// emitente e destinatário têm os dois uma etiqueta CNPJ: não pode trocar um pelo outro
(function () {
  const r = M.nfeLerXml(XML_PROC);
  tv("não confunde emitente com destinatário", r.emitenteCnpj !== r.destinoCnpj);
  t("emitente é o primeiro bloco", r.emitenteCnpj, "11222333000181");
  t("destinatário é o segundo", r.destinoCnpj, "99888777000166");
})();

// arquivo que não serve
tv("texto solto é recusado", M.nfeLerXml("nao sou xml").ok === false);
tv("XML que não é NF-e é recusado",
   M.nfeLerXml('<?xml version="1.0"?><pedido><n>1</n></pedido>').ok === false);
tv("vazio é recusado", M.nfeLerXml("").ok === false);
tv("nulo não explode", M.nfeLerXml(null).ok === false);

// a chave DENTRO do arquivo também passa pelo dígito verificador
(function () {
  const trocado = CH2.slice(0, 43) + ((parseInt(CH2.slice(43), 10) + 1) % 10);
  const r = M.nfeLerXml(XML_PROC.split(CH2).join(trocado));
  tv("chave torta dentro do arquivo é recusada", r.ok === false);
  tv("e o aviso explica o motivo", /não confere/i.test(r.erro));
})();

// arquivo grande demais
tv("arquivo grande demais é recusado",
   M.nfeLerXml("<infNFe>" + new Array(3000002).join("x")).ok === false);

// NF-e sem chave nenhuma
tv("NF-e sem chave é recusada",
   M.nfeLerXml('<nfeProc><NFe><infNFe versao="4.00"><ide></ide></infNFe></NFe></nfeProc>').ok === false);

// ---------------------------------------------------------------
// 9) O CALENDÁRIO DE ESCOLHER O DIA
//
// Montar mês errado não dá erro na tela: dá um dia caindo na coluna errada.
// O fornecedor clica em "quinta" e agenda numa quarta, e ninguém percebe até
// o caminhão chegar no dia errado.
// ---------------------------------------------------------------

// agosto/2026: dia 1º cai num sábado, então a grade abre no domingo 26/07
(function () {
  const g = M.mesCasas(2026, 7);
  t("o mês tem sempre 42 casas", g.length, 42);
  t("a grade abre num domingo", g[0].dow, 0);
  t("agosto/2026 abre em 26/07", g[0].iso, "2026-07-26");
  t("e o 26/07 é de fora do mês", g[0].fora, true);
  t("o dia 1º cai no sábado", g[6].iso, "2026-08-01");
  t("e o 1º é do mês", g[6].fora, false);
  t("a última casa é 05/09", g[41].iso, "2026-09-05");
  t("os dias do mês somam 31", g.filter((c) => !c.fora).length, 31);
})();

// fevereiro de ano bissexto — 2028 tem 29 dias
(function () {
  const g = M.mesCasas(2028, 1);
  t("fevereiro/2028 tem 29 dias", g.filter((c) => !c.fora).length, 29);
  tv("e o 29/02 existe", g.some((c) => c.iso === "2028-02-29"));
})();
t("fevereiro comum tem 28", M.mesCasas(2027, 1).filter((c) => !c.fora).length, 28);

// um mês que começa no próprio domingo não pode ganhar uma semana em branco
(function () {
  const g = M.mesCasas(2026, 2); // março/2026 começa num domingo
  t("mês que abre no domingo começa nele mesmo", g[0].iso, "2026-03-01");
  t("e não sobra semana vazia antes", g[0].fora, false);
})();

t("mesUltimoDia acha o fim do mês", M.mesUltimoDia(2026, 7), "2026-08-31");
t("mesUltimoDia em fevereiro comum", M.mesUltimoDia(2027, 1), "2027-02-28");
t("mesUltimoDia em fevereiro bissexto", M.mesUltimoDia(2028, 1), "2028-02-29");
t("mesUltimoDia em dezembro", M.mesUltimoDia(2026, 11), "2026-12-31");

t("mesAndar avança um mês", M.mesAndar(2026, 7, 1), { ano: 2026, mes: 8 });
t("mesAndar volta um mês", M.mesAndar(2026, 7, -1), { ano: 2026, mes: 6 });
t("mesAndar vira o ano pra frente", M.mesAndar(2026, 11, 1), { ano: 2027, mes: 0 });
t("mesAndar vira o ano pra trás", M.mesAndar(2026, 0, -1), { ano: 2025, mes: 11 });
t("mesAndar aguenta pulo grande", M.mesAndar(2026, 0, 25), { ano: 2028, mes: 1 });
t("mesAndar aguenta pulo grande pra trás", M.mesAndar(2026, 0, -25), { ano: 2023, mes: 11 });

t("mesTitulo escreve por extenso", M.mesTitulo(2026, 7), "Agosto de 2026");
t("mesTitulo em janeiro", M.mesTitulo(2027, 0), "Janeiro de 2027");

// a faixa que o fornecedor lê: começo E fim, porque a descarga tem duração
t("faixaHora mostra o período", M.faixaHora("07:00", "08:00"), "07:00 - 08:00");
t("faixaHora sem fim mostra só o começo", M.faixaHora("07:00", ""), "07:00");
t("faixaHora sem nada não inventa", M.faixaHora("", ""), "");

// ---------------------------------------------------------------
// 10) O PESO QUE VIRA DINHEIRO
//
// Este número multiplica o preço por tonelada. Ler errado não dá erro na
// tela: dá uma cobrança errada, e o fornecedor só descobre na fatura.
// ---------------------------------------------------------------
t("peso inteiro simples", M.pesoNum("1250"), 1250);
t("peso com virgula decimal", M.pesoNum("1250,5"), 1250.5);
t("peso do jeito brasileiro", M.pesoNum("1.250,5"), 1250.5);
t("peso com milhar e sem decimal", M.pesoNum("1.250"), 1250);
// bem escrito mas absurdo: 1.240.500 kg são 1.240 toneladas. A trava do peso
// existe porque peso absurdo vira cobrança absurda, e ninguém confere fatura.
tv("peso bem escrito mas absurdo é recusado", M.pesoNum("1.240.500") === null);
t("dois pontos de milhar dentro do limite", M.pesoNum("84.387"), 84387);
t("peso com kg escrito junto", M.pesoNum("1.240,5 kg"), 1240.5);
t("peso com espaco sobrando", M.pesoNum("  840,25  "), 840.25);
t("peso guarda 3 casas", M.pesoNum("84,387"), 84.387);
t("peso corta a quarta casa", M.pesoNum("84,3874"), 84.387);

// o que NAO pode passar
tv("peso vazio nao vira zero", M.pesoNum("") === null);
tv("peso nulo nao explode", M.pesoNum(null) === null);
tv("peso so com letra e recusado", M.pesoNum("abacaxi") === null);
tv("peso negativo e recusado", M.pesoNum("-500") === 500 || M.pesoNum("-500") === null);
tv("peso absurdo e recusado", M.pesoNum("900000") === null);
tv("200 toneladas ainda passa", M.pesoNum("200000") === 200000);

// o caminho de ida e volta: o campo e preenchido pelo XML no formato
// brasileiro e tem que ser lido de volta no mesmo numero
t("o que o XML preencheu volta igual", M.pesoNum(M.numero(1240.5, 3)), 1240.5);
t("ida e volta com milhar grande", M.pesoNum(M.numero(84387, 3)), 84387);


// ---------------------------------------------------------------
// 11) O PEDIDO DE COMPRA DENTRO DA NOTA (tag xPed)
//
// O fornecedor escreve o número do pedido ao emitir a nota. Isso chegava e era
// jogado fora — a loja recebia o caminhão sem saber de que pedido era.
// ---------------------------------------------------------------
(function () {
  function nota(itens) {
    return '<nfeProc><NFe><infNFe versao="4.00" Id="NFe' + CH2 + '">' +
      '<ide><nNF>128944</nNF><serie>1</serie><dhEmi>2026-08-04T09:00:00-03:00</dhEmi></ide>' +
      '<emit><CNPJ>20947638000141</CNPJ><xNome>G J DOS SANTOS</xNome></emit>' +
      '<dest><CNPJ>12988127000140</CNPJ><xNome>SANTA RITA</xNome></dest>' +
      itens +
      '<total><ICMSTot><vNF>1000.00</vNF></ICMSTot></total>' +
      '</infNFe></NFe></nfeProc>';
  }
  function item(nome, ped, nItem) {
    return '<det nItem="1"><prod><cProd>1</cProd><xProd>' + nome + '</xProd>' +
      '<uCom>CX</uCom><qCom>10</qCom><vUnCom>10.00</vUnCom><vProd>100.00</vProd>' +
      (ped ? '<xPed>' + ped + '</xPed>' : '') +
      (nItem ? '<nItemPed>' + nItem + '</nItemPed>' : '') + '</prod></det>';
  }

  const r1 = M.nfeLerXml(nota(item("LEITE", "45231", "3")));
  tv("nota com pedido é lida", r1.ok === true);
  t("o pedido do item é guardado", r1.itens[0].pedido, "45231");
  t("o item do pedido também", r1.itens[0].itemPedido, "3");
  t("a nota lista o pedido", r1.pedidos, ["45231"]);

  // uma nota pode atender mais de um pedido
  const r2 = M.nfeLerXml(nota(item("LEITE", "45231") + item("ARROZ", "45260")));
  t("dois pedidos na mesma nota", r2.pedidos, ["45231", "45260"]);

  // o mesmo pedido em vários itens não pode aparecer repetido
  const r3 = M.nfeLerXml(nota(item("LEITE", "45231") + item("ARROZ", "45231")));
  t("pedido repetido aparece uma vez só", r3.pedidos, ["45231"]);

  // nota sem pedido nenhum não pode inventar
  const r4 = M.nfeLerXml(nota(item("LEITE", null)));
  t("nota sem pedido devolve lista vazia", r4.pedidos, []);
  t("e o item fica sem pedido", r4.itens[0].pedido, "");

  // espaço em volta do número não pode virar pedido diferente
  const r5 = M.nfeLerXml(nota(item("LEITE", "  45231  ")));
  t("espaço em volta não cria pedido diferente", r5.pedidos, ["45231"]);
})();

console.log(ruim === 0 ? ("TUDO OK: " + ok + " testes") : (ok + " passaram, " + ruim + " falharam."));
process.exit(ruim === 0 ? 0 : 1);
