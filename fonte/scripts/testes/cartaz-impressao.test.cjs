// Testes da IMPRESSÃO do cartaz — a corrida com o banner.
//
// Bug que o dono pegou em 22/08/2026: "quando estou colocando para imprimir dupla na mesma
// folha ela está saindo quebrada, sempre a SEGUNDA imagem; a primeira daí normal mas a segunda
// não. Antes tava saindo normal mas agora está dando esse problema."
//
// A causa: a janela de impressão media a placa e mandava imprimir esperando SÓ a fonte
// (document.fonts.ready). O banner do topo (.ofimg) tem height:auto — enquanto a imagem não
// abre, ela ocupa altura ZERO. Então a medição via uma placa curtinha, achava que cabia, e
// mandava imprimir. A imagem que já tinha aberto saía certa; a que abriu depois estourava a
// folha. Como as imagens abrem em ordem, era SEMPRE a segunda. E piorou quando a arte ficou
// mais pesada, porque demora mais pra abrir.
//
// Duas trancas, e este teste guarda as duas:
//   1) a janela de impressão espera as IMAGENS, não só a fonte;
//   2) o banner nasce com a altura já reservada (aspect-ratio 20/7 = a arte oficial 2100x735),
//      então a placa não muda de tamanho quando a imagem abre.
//
// Se um destes cair, o cartaz volta a sair quebrado no papel — e só se descobre imprimindo.
//   node scripts/testes/cartaz-impressao.test.cjs
const fs = require("fs");
const path = require("path");

const HTML = fs.readFileSync(path.join(__dirname, "..", "..", "output", "index.html"), "utf8");

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + obtido + (bate ? "" : "   (esperado: " + esperado + ")"));
  bate ? ok++ : falhou++;
}

console.log("\n=== Cartaz — impressão (a corrida com o banner) ===\n");

// Quantas janelas de impressão o cartaz sabe abrir (deitado, A1/A2/A3, A5/A6/A7, A4).
const JANELAS = 4;

// ------------------------------------------------- 1) esperar a imagem, não só a fonte
{
  const esperamImagem = (HTML.match(/function prontas\(cb\)\{var ims=\[\]\.slice\.call\(document\.images\)/g) || []).length;
  eq("1) todas as janelas de impressão esperam as imagens", esperamImagem, JANELAS);

  const soFonte = (HTML.match(/document\.fonts\.ready\.then\(go\)/g) || []).length;
  eq("2) nenhuma manda imprimir esperando só a fonte", soFonte, 0);

  const viaEsperar = (HTML.match(/document\.fonts\.ready\.then\(esperar\)/g) || []).length;
  eq("3) todas passam pelo esperar() antes de medir", viaEsperar, JANELAS);
}

// ------------------------------------------------- 2) a trava de segurança
{
  // Se uma imagem nunca abrir (arquivo quebrado, tema antigo), a pessoa não pode ficar
  // esperando pra sempre olhando uma janela em branco: em 5s imprime do jeito que está.
  const temTrava = (HTML.match(/setTimeout\(fecha,5000\)/g) || []).length;
  eq("4) tem trava de 5s pra nunca travar a janela", temTrava, JANELAS);

  // Imagem quebrada conta como pronta — senão a trava de 5s vira a regra, não a exceção.
  const contaErro = (HTML.match(/addEventListener\("error",um\)/g) || []).length;
  eq("5) imagem que falha também destranca", contaErro, JANELAS);
}

// ------------------------------------------------- 3) o banner com altura reservada
{
  // 20/7 é exatamente a proporção da arte oficial (2100x735) e dá exatamente os 35cqw que o
  // max-height já pedia — ou seja, NÃO muda o desenho, só faz a altura ser conhecida antes de
  // a imagem abrir.
  const reservado = (HTML.match(/\.ofimg\{width:100%;max-width:none;height:auto;aspect-ratio:20\/7;max-height:35cqw/g) || []).length;
  eq("6) o banner reserva a altura antes de abrir (3 blocos de CSS)", reservado, 3);

  // Nenhum lugar pode ter ficado sem a reserva.
  const semReserva = (HTML.match(/\.ofimg\{width:100%;max-width:none;height:auto;max-height:35cqw/g) || []).length;
  eq("7) não sobrou banner sem a altura reservada", semReserva, 0);
}

// ------------------------------------------------- 4) o cartaz girado fica NO FLUXO
{
  // Bug de 22/08/2026: o cartaz girado era position:absolute, centrado com left/top 50% +
  // translate(-50%,-50%). Na tela ficava perfeito; no PAPEL o Chrome errava a posição do de
  // baixo (90,3pt para a direita, 230,8pt para baixo) e ele saía cortado pela borda. Agora ele
  // fica no fluxo normal e quem centraliza é a célula, que já é flex centralizado.
  // (o CSS é montado na hora, então no arquivo ele aparece como código, não como número)
  const noFluxo = HTML.indexOf("cell>.poster{width:'+largPost.toFixed(3)+'%;aspect-ratio:'+razaoPost.toFixed(5)+';position:relative;flex:none;'") > 0;
  eq("8) o cartaz da folha fica no fluxo, não solto", noFluxo, "true");

  const solto = /\.cell>\.poster\{[^}]*position:absolute/.test(HTML);
  eq("9) nenhum cartaz de folha voltou a ser position:absolute", solto, "false");

  const semTruque = /\.cell>\.poster\{[^}]*translate\(-50%,-50%\)/.test(HTML);
  eq("10) sumiu o truque do left/top 50% + translate", semTruque, "false");

  // O giro em si continua — é ele que faz caber duas placas deitadas na folha.
  eq("11) o A5 continua girando o cartaz 90 graus", /\.cell>\.poster\{[^}]*transform:rotate\(90deg\)/.test(HTML), "true");
}

// ------------------------------------------------- 5) a folha não pode passar da página
{
  // Sem o min() a folha tinha 1px de folga contra a página. Em papel Carta ela estourava e o
  // Chrome fatiava a metade de baixo pra outra folha (6 folhas em vez de 3). No A7 ela derramava
  // uma sobra vazia e gastava o dobro de papel (4 folhas, 2 em branco).
  eq("14) a folha é limitada também pela altura da página",
     HTML.indexOf("'.pg{width:min(100%,calc(100vh * '+folhaW+' / '+folhaH+'));margin:0 auto;") > 0, "true");
  eq("15) não sobrou folha valendo largura pura", /\.pg\{width:100%;aspect-ratio:/.test(HTML), "false");
}

// ------------------------------------------------- 6) trava de largura do texto
{
  // O tamanho da letra era calculado CONTANDO caracteres. Letra larga cabia na conta e não na
  // placa: 13% do nome picotado em silêncio. Agora a janela MEDE e encolhe só o que passa.
  const temLarg = (HTML.match(/function larg\(\)\{var ls=document\.querySelectorAll/g) || []).length;
  eq("16) as 4 janelas medem a largura do texto", temLarg, 4);
  const chamada = (HTML.match(/try\{larg\(\);fit\(\);\}catch/g) || []).length;
  eq("17) e chamam antes de imprimir", chamada, 4);
  // piso: nunca encolher a ponto de sumir
  eq("18) tem piso pra não encolher demais", (HTML.match(/if\(k<0\.2\)\{k=0\.2;/g) || []).length, 4);
}

// ------------------------------------------------- 7) o que NÃO podia mudar
{
  // A trava anti-estouro (nome de produto comprido) continua existindo nas 4 janelas.
  const antiEstouro = (HTML.match(/function fit\(\)\{var cs=document\.querySelectorAll/g) || []).length;
  eq("19) a trava anti-estouro de altura continua nas 4 janelas", antiEstouro, JANELAS);

  // O cartaz A5 continua girado e centrado na metade da folha.
  eq("20) o A5 continua 1 coluna x 2 linhas, girado", /A5:\{page:'A4',pgW:198,pgH:265,cols:1,rows:2,rot:1\}/.test(HTML), "true");
}

console.log("\n" + (falhou ? "FALHOU: " + falhou + " de " + (ok + falhou) : "TUDO OK: " + ok + " testes") + "\n");
process.exit(falhou ? 1 : 0);
