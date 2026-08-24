// PREVIA DA FILA DE AGENDAMENTOS PENDENTES (Central Logistica).
//
// POR QUE ISTO E UM PROGRAMA, E NAO HTML ESCRITO NA MAO:
// duas vezes eu montei a previa a mao e ela MENTIU. Da primeira, porque a marcacao que
// escrevi nao tinha os mesmos elementos da de producao. Da segunda, porque eu peguei
// tres blocos de <style> do painel achando que eram todos — sao 43 — e as regras que
// faltavam eram justamente as do pedaco que eu queria olhar.
//
// Previa que nao e fiel e pior que nenhuma: ela produz uma conclusao errada COM
// aparencia de prova. Entao aqui:
//   · o CSS vem INTEIRO do output/index.html (todos os blocos, sem escolher);
//   · as funcoes de formatacao sao extraidas do proprio painel, nao reescritas;
//   · a marcacao e montada pelas MESMAS regras do renderClPedidos.
//
//   node scripts/previa-fila.cjs            -> .previa/previa-pro.html
const fs = require("fs");
const path = require("path");
const RAIZ = path.join(__dirname, "..");
const H = fs.readFileSync(path.join(RAIZ, "output", "index.html"), "utf8");

// TODOS os blocos DA PAGINA — e so os da pagina.
// Armadilha que me pegou: o painel tem <style> DENTRO de <script>. Sao os estilos da
// janela de impressao do cartaz, que o czImprimir escreve num documento novo. Um deles
// e "*{font-family:'Bangers',cursive}". Colados na previa, viravam a pagina inteira de
// fonte de cartaz — defeito que nao existe no painel. Entao: recorta o que esta dentro
// de <script> antes de procurar estilo.
const semScript = H.replace(/<script[\s\S]*?<\/script>/gi, "");
const BLOCOS = semScript.match(/<style[^>]*>[\s\S]*?<\/style>/g) || [];
const ESTILOS = BLOCOS.join("\n");
if (!ESTILOS) { console.log("ERRO: nao achei estilo no painel (rode o build antes)"); process.exit(1); }
// Vigia da propria previa. O que estraga a previa nao e a palavra "Bangers" (o cartaz
// tem uma regra legitima com ela, presa em #page-cartaz): e uma regra GLOBAL de fonte,
// "*" ou "body", que so existe nos estilos da janela de impressao. Se uma dessas passar,
// o recorte falhou — melhor parar do que gerar uma previa que mente.
// O seletor pode vir logo depois do proprio "<style>", entao ">" tambem conta como
// inicio de regra — foi exatamente por faltar o ">" que este vigia nasceu cego.
const globalFonte = /(^|[};>])\s*(\*|body)\s*\{[^{}]*font-family\s*:\s*(?!\s*(system-ui|inherit))/i;
if (globalFonte.test(ESTILOS.replace(/\/\*[\s\S]*?\*\//g, ""))) {
  console.log("ERRO: regra global de fonte na previa — o recorte de <script> falhou");
  process.exit(1);
}
console.log("   " + BLOCOS.length + " blocos de estilo da pagina (fora os de dentro de <script>)");

function pegaFn(nome) {
  const i = H.indexOf("function " + nome + "(");
  if (i < 0) { console.log("ERRO: nao achei a funcao " + nome); process.exit(1); }
  let n = 0;
  for (let k = H.indexOf("{", i); k < H.length; k++) {
    if (H[k] === "{") n++;
    else if (H[k] === "}") { n--; if (!n) return H.slice(i, k + 1); }
  }
}
const F = new Function(
  pegaFn("clCnpjFmt") + pegaFn("clFoneFmt") + pegaFn("clPlacaFmt") +
  " ; return {clCnpjFmt,clFoneFmt,clPlacaFmt};")();

const esc = (t) => String(t == null ? "" : t)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function cartao(o) {
  const id = [];
  if (o.cnpj) id.push(esc(F.clCnpjFmt(o.cnpj)));
  if (o.fone) id.push(esc(F.clFoneFmt(o.fone)));

  const carga = [];
  if (o.vol) carga.push("<b>" + esc(o.vol) + "</b> " + (o.vol === "1" ? "volume" : "volumes"));
  if (o.kg) carga.push("<b>" + esc(o.kg) + "</b> kg");
  if (o.arranjo) carga.push(esc(o.arranjo.toLowerCase()));
  if (o.carga) carga.push("carga " + esc(o.carga.toLowerCase()));
  if (o.doca) carga.push("<b>" + esc(o.doca) + "</b> de doca");

  const crew = [];
  if (o.veiculo) crew.push(esc(o.veiculo));
  if (o.placa) crew.push("placa " + esc(F.clPlacaFmt(o.placa)));
  if (o.motorista) crew.push("motorista " + esc(o.motorista) +
    (o.motoristaFone ? " · " + esc(F.clFoneFmt(o.motoristaFone)) : ""));

  return '<div class="cl-ped-item' + (o.venceu ? " venceu" : "") + '">' +
    '<span class="cl-ped-quando">' + esc(o.quando) +
      (o.venceu ? '<span class="av">passou da data</span>' : "") + "</span>" +
    '<span class="cl-ped-quem"><b>' + esc(o.nome) + "</b>" +
      (id.length ? '<span class="cl-ped-doc">' + id.join(" · ") + "</span>" : "") +
      (o.pedido ? '<span class="cl-chip">Pedido ' + esc(o.pedido) + "</span>" : "") +
      (o.obs ? '<span class="cl-obs">“' + esc(o.obs) + "”</span>" : "") +
      (carga.length ? '<span class="cl-carga">' + carga.join(" · ") + "</span>" : "") +
      (crew.length ? '<span class="cl-crew">' + crew.join(" · ") + "</span>" : "") +
      (o.nf ? '<button type="button" class="cl-nf">' + esc(o.nf) + " →</button>" : "") +
    "</span>" +
    '<span class="cl-ped-acoes">' +
      '<button type="button" class="cl-ped-nao">Recusar</button>' +
      (o.venceu ? "" : '<button type="button" class="cl-ped-sim">Aprovar</button>') +
    "</span></div>";
}

// O primeiro e o agendamento REAL que o Victor mandou no print — mesmos numeros, mesmo
// lixo de placa ("FDSDFGHJ"), para a previa mostrar o caso dele e nao um caso bonito.
const PEDIDOS = [
  { quando: "terça, 25/08 · 16:00", nome: "G J dos Santos e Filhos Ltda",
    cnpj: "20947638000141", fone: "84991277474", pedido: "23102",
    vol: "172", kg: "652,6", arranjo: "Paletizada", carga: "Seca",
    veiculo: "Van / Furgão", placa: "FDSDFGHJ", motorista: "victor",
    motoristaFone: "84991277474", nf: "1 nota fiscal · 16 produtos" },
  { venceu: true, quando: "sábado, 23/08 · 11:00",
    nome: "Distribuidora Nordeste Alimentos Ltda",
    cnpj: "11444777000161", fone: "8433215500", pedido: "23088",
    vol: "48", kg: "1.240", arranjo: "Batida", carga: "Refrigerada", doca: "1h30",
    veiculo: "Truck", placa: "abc1234", motorista: "José Ferreira",
    motoristaFone: "84988112233", nf: "2 notas fiscais · 41 produtos" },
  { quando: "quarta, 26/08 · 09:30", nome: "Atacado Seridó Distribuição S/A",
    cnpj: "07526557000100", fone: "8499887766", pedido: "23115",
    vol: "6", kg: "88,4", arranjo: "Paletizada", carga: "Seca",
    veiculo: "Utilitário", placa: "RTA2C19", motorista: "Marcos Lima",
    motoristaFone: "84994001122", nf: "1 nota fiscal · 9 produtos",
    obs: "Entregar pela lateral, portão do depósito" },
];

const atras = PEDIDOS.filter((p) => p.venceu).length;
const fila =
  '<div class="cl-ped"><div class="cl-ped-cab"><b>Fornecedores esperando resposta</b>' +
  '<span class="qt">' + PEDIDOS.length + "</span>" +
  (atras ? '<span class="cl-ped-atras">' + atras + " já passou da data</span>" : "") +
  '</div><div class="cl-ped-lista">' + PEDIDOS.map(cartao).join("") + "</div></div>";

const saida = path.join(RAIZ, ".previa", "previa-pro.html");
fs.mkdirSync(path.dirname(saida), { recursive: true });
fs.writeFileSync(saida,
  '<!doctype html><html lang="pt-BR"' + (process.env.ESCURO ? ' class="tema-escuro"' : "") +
  '><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  "<title>Prévia — agendamentos pendentes</title>" + ESTILOS +
  '</head><body style="margin:0;background:' + (process.env.ESCURO ? "#0f1115" : "#f4f7f6") +
  ';padding:18px"><div id="page-central">' + fila + "</div></body></html>");
console.log("OK -> " + path.relative(RAIZ, saida) + "  (" + PEDIDOS.length + " cartões, CSS inteiro do painel)");
