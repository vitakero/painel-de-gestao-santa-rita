// PREVIA DA LISTA DE CONVIDADOS DA AGENDA — com convidado RETIRADO e perfil removido.
//
// Serve para o dono OLHAR a mudanca da I4 antes de ela ir pro ar.
//
// POR QUE E UM PROGRAMA, E NAO HTML ESCRITO NA MAO (licao ja paga neste projeto):
// previa feita a mao mente — ou porque a marcacao nao e a mesma de producao, ou porque
// falta um dos 43 blocos de estilo do painel. Previa infiel e pior que nenhuma: produz
// conclusao errada COM aparencia de prova. Entao aqui:
//   · o CSS vem INTEIRO do output/index.html (todos os blocos da pagina, sem escolher);
//   · a marcacao e desenhada pela PROPRIA agConvHtml do painel ja construido —
//     nao ha uma segunda versao dela aqui dentro para se desencontrar.
//
//   node scripts/previa-agenda-retirado.cjs      -> .previa/agenda-retirado.html
const fs = require("fs");
const path = require("path");
const RAIZ = path.join(__dirname, "..");
const H = fs.readFileSync(path.join(RAIZ, "output", "index.html"), "utf8");

// TODOS os blocos de estilo DA PAGINA — e so os da pagina.
// O painel tem <style> DENTRO de <script> (a janela de impressao do cartaz, com regra
// global de fonte). Colados aqui, virariam a previa inteira de fonte de cartaz.
const semScript = H.replace(/<script[\s\S]*?<\/script>/gi, "");
const BLOCOS = semScript.match(/<style[^>]*>[\s\S]*?<\/style>/g) || [];
const ESTILOS = BLOCOS.join("\n");
if (!ESTILOS) { console.log("ERRO: nao achei estilo no painel (rode o build antes)"); process.exit(1); }
const globalFonte = /(^|[};>])\s*(\*|body)\s*\{[^{}]*font-family\s*:\s*(?!\s*(system-ui|inherit))/i;
if (globalFonte.test(ESTILOS.replace(/\/\*[\s\S]*?\*\//g, ""))) {
  console.log("ERRO: regra global de fonte na previa — o recorte de <script> falhou");
  process.exit(1);
}
console.log("   " + BLOCOS.length + " blocos de estilo da pagina");

function pegaFn(nome) {
  const i = H.indexOf("function " + nome + "(");
  if (i < 0) { console.log("ERRO: nao achei a funcao " + nome); process.exit(1); }
  let n = 0;
  for (let k = H.indexOf("{", i); k < H.length; k++) {
    if (H[k] === "{") n++;
    else if (H[k] === "}") { n--; if (!n) return H.slice(i, k + 1); }
  }
}
// As duas de fora (agMaster/agVendoOutro) leem estado de login e de navegacao que nao
// existe fora do painel. Ficam como interruptor da previa, e sao as UNICAS coisas que
// eu escrevo aqui — todo o resto e o codigo de producao.
const monta = (ev, souMaster) => new Function(
  "var __M=" + (souMaster ? "true" : "false") + ";" +
  "function agMaster(){ return __M; }" +
  "function agVendoOutro(){ return false; }" +
  "var DOW_PT=['dom','seg','ter','qua','qui','sex','sab'];" +
  pegaFn("agEsc") + pegaFn("agFmtHora") + pegaFn("agFmtDataBr") +
  pegaFn("agStPill") + pegaFn("agEhDono") + pegaFn("agConvHtml") +
  "; return agConvHtml(" + JSON.stringify(ev) + ");")();

const hoje = new Date();
const daqui = n => { const d = new Date(hoje); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

// Um compromisso com os QUATRO casos que a I4 criou, de uma vez.
const EV = {
  id: "previa", sou_dono: true, hora: "09:00",
  convidados: [
    { pessoa_id: "1", nome: "Josinaldo", setor: "Acougue", status: "confirmado",
      motivo: null, sug_data: null, sug_hora: null, retirado: false, sumiu: false },
    { pessoa_id: "2", nome: "Francisco", setor: "Padaria", status: "recusado",
      motivo: "estou no fechamento do caixa nesse horario", sug_data: daqui(9), sug_hora: "15:00",
      retirado: false, sumiu: false },
    { pessoa_id: "3", nome: "Lucas", setor: "Hortifruti", status: "aguardando",
      motivo: null, sug_data: null, sug_hora: null, retirado: false, sumiu: false },
    { pessoa_id: "4", nome: "Anderson", setor: "Deposito", status: "recusado",
      motivo: "vou estar na entrega", sug_data: daqui(12), sug_hora: null,
      retirado: true, sumiu: false },
    { pessoa_id: "5", nome: "alguem", setor: "Caixa", status: "aguardando",
      motivo: null, sug_data: null, sug_hora: null, retirado: false, sumiu: true },
  ],
};
// A MESMA lista vista por um convidado comum: o servidor nao manda os retirados pra ele,
// entao a previa tira do jeito que agenda_mes tira.
const EV_CONVIDADO = Object.assign({}, EV, {
  sou_dono: false,
  convidados: EV.convidados.filter(c => !c.retirado),
});

const cena = (titulo, explica, html) =>
  '<section class="cena"><h2>' + titulo + '</h2><p class="exp">' + explica + '</p>' +
  '<div class="moldura"><div class="ag-jan-corpo"><div class="ag-ev">' +
  '<div class="ag-ev-top"><span class="ag-ev-hora">09:00</span>' +
  '<span class="ag-ev-tit">Alinhamento da semana</span></div>' + html +
  '</div></div></div></section>';

const PAG =
`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Previa — Agenda: convidado retirado</title>
${ESTILOS}
<style>
  body { margin:0; padding:26px; background:#f4f6f8; font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; color:#1d2733; }
  h1 { font-size:19px; margin:0 0 4px; }
  .sub { color:#5b6670; font-size:13px; margin:0 0 22px; }
  .cena { margin-bottom:26px; max-width:620px; }
  .cena h2 { font-size:14.5px; margin:0 0 3px; }
  .exp { font-size:12.5px; color:#5b6670; margin:0 0 8px; }
  .moldura { background:#fff; border:1px solid #dfe5ec; border-radius:12px; padding:14px 16px; }
</style></head><body>
<h1>Agenda — convidado retirado</h1>
<p class="sub">Desenhado pela propria <code>agConvHtml</code> do painel construido, com todos os estilos da pagina.
Nada aqui foi escrito a mao.</p>
${cena("Como o DONO (e o master) enxerga",
       "A ordem e a de sempre: por quando a pessoa foi convidada. Quem foi retirado (o <b>Anderson</b>) fica na fila junto com os outros, esmaecido e com o selo cinza — linha E motivo. Sem botao de remarcar, porque remarcar o compromisso pela sugestao de quem ja saiu nao faz sentido. O motivo dele continua a vista: e o historico que a I4 passou a guardar. O <b>Retirar</b> so aparece em quem esta ativo.",
       monta(EV, false))}
${cena("Como um CONVIDADO comum enxerga",
       "A mesma lista, sem os retirados: para ele isso e a lista de quem esta no compromisso. Quem decide isso e o SERVIDOR — a consulta do mes so manda convidado retirado para o dono e para o master. E ele nao tem botao de retirar ninguem.",
       monta(EV_CONVIDADO, false))}
</body></html>`;

const destino = path.join(RAIZ, ".previa", "agenda-retirado.html");
fs.mkdirSync(path.dirname(destino), { recursive: true });
fs.writeFileSync(destino, PAG);
console.log("   OK -> " + path.relative(RAIZ, destino));
