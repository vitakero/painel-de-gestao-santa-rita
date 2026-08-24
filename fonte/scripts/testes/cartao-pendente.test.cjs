// O CARTAO DO AGENDAMENTO PENDENTE — o que a loja le antes de aprovar ou recusar.
//
// Por que existe: este cartao era uma fileira de sete fatos separados pelo MESMO ponto,
// no MESMO cinza — veiculo, placa, motorista, telefone, tipo de carga, volume e peso.
// Ninguem sabia que "FDSDFGHJ" era placa, e o numero que decide se da para receber
// (volume, peso, tempo de doca) valia o mesmo que o nome do motorista.
//
// Tres defeitos de verdade moravam ali:
//   (A) "172 Paletizada" — faltava o substantivo. Paletizada nao e unidade, e ARRANJO.
//       Lido rapido, virava "172 paletes", que e outra carga completamente diferente.
//   (B) CNPJ e telefone em bloco ("20947638000141"), impossiveis de conferir de relance
//       contra a nota na mao.
//   (C) o <b> do nome do fornecedor estilizado por DESCENDENCIA, entao ele alcancava os
//       negritos da carga e jogava cada numero numa linha propria.
//
//   node scripts/testes/cartao-pendente.test.cjs
const fs = require("fs");
const path = require("path");
const RAIZ = path.join(__dirname, "..", "..");
const H = fs.readFileSync(path.join(RAIZ, "output", "index.html"), "utf8");

let ok = 0, ruim = 0;
function t(nome, real, esperado) {
  const a = JSON.stringify(real), b = JSON.stringify(esperado);
  if (a === b) { ok++; return; }
  ruim++; console.log("FALHOU: " + nome + "\n  esperava " + b + "\n  veio     " + a);
}
function tv(nome, cond) { if (cond) ok++; else { ruim++; console.log("FALHOU: " + nome); } }

// As funcoes saem do HTML GERADO, nao do fonte: o painel e um template literal e a
// barra invertida some no caminho. Testar o fonte aqui provaria a coisa errada.
function pegaFn(nome) {
  const i = H.indexOf("function " + nome + "(");
  if (i < 0) { console.log("ERRO: nao achei " + nome + " no painel"); process.exit(1); }
  let n = 0;
  for (let k = H.indexOf("{", i); k < H.length; k++) {
    if (H[k] === "{") n++; else if (H[k] === "}") { n--; if (!n) return H.slice(i, k + 1); }
  }
}
const M = new Function(pegaFn("clCnpjFmt") + pegaFn("clFoneFmt") + pegaFn("clPlacaFmt") +
  " ; return {clCnpjFmt,clFoneFmt,clPlacaFmt};")();

// ------------------------------------------------------- CNPJ
t("1) CNPJ ganha ponto, barra e traco", M.clCnpjFmt("20947638000141"), "20.947.638/0001-41");
t("2) ja pontuado nao dobra", M.clCnpjFmt("20.947.638/0001-41"), "20.947.638/0001-41");
// Dado torto tem que APARECER torto: formatar na marra esconde o cadastro errado.
t("3) numero curto sai como veio", M.clCnpjFmt("12345"), "12345");
t("4) CPF de 11 digitos nao vira CNPJ", M.clCnpjFmt("12345678901"), "12345678901");
t("5) vazio nao vira pontuacao solta", M.clCnpjFmt(""), "");
t("6) nulo nao vira a palavra null", M.clCnpjFmt(null), "");

// ------------------------------------------------------- telefone
t("7) celular", M.clFoneFmt("84991277474"), "(84) 99127-7474");
t("8) fixo de 10 digitos", M.clFoneFmt("8432211234"), "(84) 3221-1234");
t("9) ja formatado nao dobra", M.clFoneFmt("(84) 99127-7474"), "(84) 99127-7474");
t("10) numero torto sai como veio", M.clFoneFmt("123"), "123");
t("11) indefinido nao vira undefined", M.clFoneFmt(undefined), "");

// ------------------------------------------------------- placa
t("12) placa antiga ganha traco", M.clPlacaFmt("abc1234"), "ABC-1234");
// Mercosul NAO leva traco: ABC1D23. Por o traco ali inventa um formato que nao existe.
t("13) Mercosul fica sem traco", M.clPlacaFmt("ABC1D23"), "ABC1D23");
t("14) placa com traco nao dobra", M.clPlacaFmt("ABC-1234"), "ABC-1234");
t("15) lixo de 8 letras sai como veio", M.clPlacaFmt("FDSDFGHJ"), "FDSDFGHJ");

// ------------------------------------------------------- (A) o substantivo que faltava
tv("16) volume tem a palavra volumes", H.indexOf("'volume':'volumes'") > 0 ||
   H.indexOf('"volume":"volumes"') > 0 || /\?'volume':'volumes'/.test(H));
tv("17) o arranjo virou fato separado", /carga\.push\(pxEsc\(String\(d\.tipo_volume\)\.toLowerCase\(\)\)\)/.test(H));
// a colagem antiga nao pode voltar
tv("18) nao voltou a colar quantidade com arranjo",
   H.indexOf("clNum(d.qtd_volumes))+' '+pxEsc(d.tipo_volume") < 0);

// ------------------------------------------------------- (C) filho direto, nao neto
tv("19) o nome e estilizado por filho direto", H.indexOf(".cl-ped-quem > b{") > 0);
tv("20) e nao por descendencia", H.indexOf(".cl-ped-quem b{") < 0);
// a regra generica de span ganhava de TODA classe filha (0,1,1 contra 0,1,0)
tv("21) a regra generica de span saiu", H.indexOf(".cl-ped-quem span{") < 0);
tv("22) o negrito da carga tem estilo proprio", H.indexOf(".cl-carga b{") > 0);

// ------------------------------------------------------- camadas
tv("23) existe a camada de apoio", H.indexOf(".cl-crew{") > 0);
tv("24) a camada que decide e mais escura que a de apoio",
   H.indexOf("color:#3d4854") > 0 && H.indexOf("color:#95a1b0") > 0);
tv("25) o pedido virou etiqueta", H.indexOf(".cl-chip{") > 0);

// ------------------------------------------------------- ambar so no atrasado
// Gastar a cor de alarme no caso normal e perder o alarme.
tv("26) a caixa ficou neutra", /\.cl-ped\{border:1px solid #e4e9ef;background:#fff/.test(H));
tv("27) e o ambar sobrou para quem passou da data",
   /\.cl-ped-item\.venceu\{border-color:#e0c477/.test(H));
tv("28) Recusar deixou de ser amarelo", /\.cl-ped-nao\{background:#fff;color:#b03024/.test(H));

// ------------------------------------------------------- a clNum duplicada
tv("29) so existe uma clNum", H.split("function clNum(").length - 1 === 1);

console.log(ruim ? "\n" + ruim + " FALHA(S) de " + (ok + ruim)
                 : "\nTUDO OK: " + ok + " testes");
