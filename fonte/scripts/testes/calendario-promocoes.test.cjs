// CALENDÁRIO: o "Adicionar promoção" em cima, numa janela (==CALPROMOS==).
//
// POR QUE ESTE TESTE EXISTE. Em 09/10/2026 o dono pediu: o quadro "Campanhas e datas do
// calendário", fechado no pé da página, ninguém achava. Virou o botão "Adicionar promoção" ao lado
// do Imprimir, que abre uma janela com o formulário e a lista. Este teste cobra que:
//   1. o botão está na barra de cima, no grupo da direita (Adicionar promoção, Imprimir, Hoje);
//   2. a janela tem TUDO que o quadro tinha (formulário, lista, pausar) e o quadro velho sumiu;
//   3. o corpo da janela, que rola, deixa folga para o anel do foco (desenhado 4px FORA do campo —
//      rolar em Y corta em X junto; já cortou 3 vezes na Agenda);
//   4. o Esc com a confirmação do "pausar" aberta fecha só a confirmação (ouvido na captura);
//   5. no celular os três botões ficam numa linha só e o título cede espaço.
//
//   node scripts/testes/calendario-promocoes.test.cjs
const fs = require("fs"), path = require("path");
const RAIZ = path.join(__dirname, "..", "..");
const src = fs.readFileSync(path.join(RAIZ, "scripts", "demoDashboard.ts"), "utf8");
let ok = 0, falhas = 0;
function confere(nome, cond, detalhe) {
  if (cond) { ok++; } else { falhas++; console.log("FALHOU — " + nome + (detalhe ? " (" + detalhe + ")" : "")); }
}

// a página do Calendário, do <section> ao </section>
const ini = src.indexOf('<section id="page-calendario"');
const fim = src.indexOf("</section>", ini);
const pag = ini >= 0 && fim > ini ? src.slice(ini, fim) : "";
confere("acha a página do Calendário", pag.length > 0);

// 1) o botão em cima, no grupo da direita, nesta ordem
const barra = pag.slice(pag.indexOf('<div class="cal-top">'), pag.indexOf('<div id="calMesView">'));
const grupo = barra.slice(barra.indexOf('<div class="cal-acoes">'));
confere("grupo da direita existe na barra", barra.includes('<div class="cal-acoes">'));
const iP = grupo.indexOf('id="calPromos"'), iI = grupo.indexOf('id="calImprimir"'), iH = grupo.indexOf('id="calHoje"');
confere("ordem: Adicionar promoção, Imprimir, Hoje", iP >= 0 && iP < iI && iI < iH, [iP, iI, iH].join(","));
confere("o botão diz \"Adicionar promoção\"", /id="calPromos"[^>]*>[\s\S]*?<\/svg>Adicionar promoção<\/button>/.test(grupo));
confere("o Imprimir não empurra mais o grupo (sem margin-left:auto próprio)", !/id="calImprimir"[^>]*margin-left:auto/.test(grupo));
confere("o texto do Imprimir pode sumir no celular (span próprio + aria-label)",
  /id="calImprimir"[^>]*aria-label="Imprimir"/.test(grupo) && grupo.includes('<span class="cal-imp-tx">Imprimir</span>'));

// 2) a janela tem tudo e o quadro velho sumiu
const jan = pag.slice(pag.indexOf('id="ccJanBg"'));
confere("a janela existe dentro da página", pag.includes('<div class="ag-jan-bg" id="ccJanBg">'));
confere("a janela é um diálogo com título", /role="dialog" aria-modal="true" aria-labelledby="ccJanTit"/.test(jan) && jan.includes('id="ccJanTit"'));
for (const id of ["ccJanX", "ccForm", "ccNome", "ccCor", "ccTipo", "ccData", "ccAnual", "ccDow", "ccAdd", "ccMsg", "ccLista"])
  confere("a janela tem #" + id, jan.includes('id="' + id + '"'));
confere("o quadro velho do pé da página sumiu", !src.includes('<details id="ccBox">'));
confere("nenhum id da janela ficou repetido", ["ccJanBg", "calPromos", "ccLista", "ccForm"].every((id) => src.split('id="' + id + '"').length === 2));

// 3) folga do anel do foco no corpo que rola
const corpo = (src.match(/\.cc-corpo\s*\{([^}]*)\}/) || [])[1] || "";
const pad = (corpo.match(/padding:\s*0\s+(\d+)px/) || [])[1];
const mar = (corpo.match(/margin:\s*0\s+-(\d+)px/) || [])[1];
confere("o corpo da janela rola", /overflow-y:\s*auto/.test(corpo));
confere("folga de pelo menos 4px dos lados para o anel do foco", +pad >= 4, "padding lateral " + pad);
confere("a folga é devolvida pela margem negativa (nada sai do lugar)", mar && mar === pad, "margem " + mar + " × padding " + pad);

// a largura da janela vence a da Agenda (.ag-jan max-width:540px vem DEPOIS no CSS; com uma classe
// só, a janela abria estreita e a lista espremia — pego na tela em 09/10)
confere("a largura da janela tem duas classes (vence a da Agenda)", /\.ag-jan\.cc-jan\s*\{\s*max-width:780px/.test(src));

// 4) abrir/fechar e o Esc ouvido na captura, respeitando a confirmação
const js = src.slice(src.indexOf("==CALPROMOS== abrir e fechar"));
confere("o botão abre a janela", /getElementById\("calPromos"\)\.addEventListener\("click",ccAbre\)/.test(js));
confere("o × fecha", /getElementById\("ccJanX"\)\.addEventListener\("click",ccFecha\)/.test(js));
confere("clicar no fundo escuro fecha", /jbg\.addEventListener\("mousedown"/.test(js));
const tecla = js.slice(js.indexOf('document.addEventListener("keydown"'), js.indexOf("}, true);") + 9);
confere("o Esc é ouvido na captura", tecla.endsWith("}, true);"));
confere("com a confirmação aberta, o Esc não fecha a janela", /uiModal[\s\S]*classList\.contains\("show"\)\) return;/.test(tecla));
confere("ao abrir, a lista é redesenhada", /function ccAbre\(\)\{[\s\S]*?ccRenderLista\(\)/.test(js));

// 5) celular
const cel = (src.match(/==CALPROMOS==[\s\S]*?@media \(max-width:760px\)\{([\s\S]*?)\n  \}/) || [])[1] || "";
confere("celular: os 3 botões numa linha", /\.cal-acoes\s*\{[^}]*flex-wrap:nowrap/.test(cel));
confere("celular: o texto do Imprimir some", /\.cal-imp-tx\s*\{\s*display:none/.test(cel));
confere("celular: o título vence o min-width escrito na própria tag", /#calTitulo\s*\{[^}]*min-width:0 !important/.test(cel));

// quem não é master só vê a lista: o botão muda de nome
confere("quem não é master vê \"Ver promoções\"", /ccRenderLista[\s\S]*?"Adicionar promoção":"Ver promoções"/.test(src));

console.log(falhas ? ("\n" + ok + " ok, " + falhas + " falha(s).") : (ok + " ok, 0 falha(s)."));
process.exit(falhas ? 1 : 0);
