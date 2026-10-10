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
//   5. no celular os três botões ficam numa linha só e o título cede espaço;
//   6. com a janela aberta, a página de trás não rola junto.
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
for (const id of ["ccJanX", "ccForm", "ccNome", "ccCor", "ccIni", "ccFim", "ccRep", "ccResumo", "ccAdd", "ccMsg", "ccLista"])
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

// 6) janela aberta: a página de trás não rola (dono, 09/10: rolava a lista e o calendário ia junto)
confere("o corpo da janela segura a rolagem no fim da lista", /overscroll-behavior:\s*contain/.test(corpo));
confere("o fundo escuro também segura", /#ccJanBg\s*\{\s*overscroll-behavior:\s*contain/.test(src));
const fAbre = (js.match(/function ccAbre\(\)\{([\s\S]*?)\n  \}/) || [])[1] || "";
const fFecha = (js.match(/function ccFecha\(\)\{([\s\S]*?)\n  \}/) || [])[1] || "";
confere("abrir trava a página de trás", /document\.body\.style\.overflow="hidden"/.test(fAbre));
confere("fechar solta a página de trás", /document\.body\.style\.overflow=""/.test(fFecha));

// 7) ==CALFORM== o formulário no estilo do Google Agenda (dono, 10/10/2026): RODA as funções de verdade.
//    Recorta das marcas "peças puras do formulário" até "function calDescRegra" e o calDescRegra inteiro;
//    desfaz o escape do arquivo (dentro do modelo do painel "\\d" vira "\d") e roda com vm.
{
  const vm = require("vm");
  const a0 = src.indexOf("/* ==CALFORM== peças puras do formulário");
  const a1 = src.indexOf("function ccRenderLista(){");
  confere("acha as peças puras do formulário", a0 > 0 && a1 > a0);
  const trecho = src.slice(a0, a1).replace(/\\\\/g, "\\");
  const ctx = { pxEsc: (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])) };
  vm.createContext(ctx);
  vm.runInContext(trecho + "; this.op=ccOpcoesRepetir; this.rg=ccRegraDoForm; this.rs=ccResumoTexto; this.desc=calDescRegra;", ctx);
  const ops = (iso) => ctx.op(iso).map((o) => o.v + "=" + o.t).join(" | ");
  // sexta 16/10/2026 = 3ª sexta, não é a última do mês
  confere("Repetir de uma sexta (16/10/2026)", ops("2026-10-16") ===
    "nao=Não se repete | semana=Toda semana na sexta-feira | mes_n=Todo mês na 3ª sexta | ano_dia=Todo ano em 16 de outubro | ano_n=Todo ano na 3ª sexta de outubro",
    ops("2026-10-16"));
  // sexta 30/10/2026 = 5ª e última: sem "5ª sexta" (nem todo mês tem), com "última"
  confere("Repetir da última sexta (30/10/2026)", ops("2026-10-30") ===
    "nao=Não se repete | semana=Toda semana na sexta-feira | mes_ult=Todo mês na última sexta | ano_dia=Todo ano em 30 de outubro | ano_ult=Todo ano na última sexta de outubro",
    ops("2026-10-30"));
  // sábado é masculino: "no 2º sábado"
  confere("Repetir de um sábado (10/10/2026): no 2º sábado", /mes_n=Todo mês no 2º sábado/.test(ops("2026-10-10")) && /semana=Toda semana no sábado/.test(ops("2026-10-10")), ops("2026-10-10"));
  const J = (x) => JSON.stringify(x);
  confere("sexta a domingo, toda semana → semanal sexta 3 dias", J(ctx.rg("2026-10-16", "2026-10-18", "semana")) === J({ regra: { tipo: "semanal", dia_semana: 5, duracao_dias: 3 } }), J(ctx.rg("2026-10-16", "2026-10-18", "semana")));
  confere("só segunda, toda semana → semanal segunda 1 dia", J(ctx.rg("2026-10-12", "2026-10-12", "semana")) === J({ regra: { tipo: "semanal", dia_semana: 1, duracao_dias: 1 } }));
  confere("não se repete → lista com o período", J(ctx.rg("2026-12-20", "2026-12-23", "nao")) === J({ regra: { tipo: "datas", lista: [{ inicio: "2026-12-20", fim: "2026-12-23" }] } }));
  confere("todo ano no 2º domingo de maio", J(ctx.rg("2027-05-09", "2027-05-09", "ano_n")) === J({ regra: { tipo: "anual_nth", mes: 5, n: 2, dia_semana: 0, duracao_dias: 1 } }));
  confere("todo mês na última quinta", J(ctx.rg("2026-10-29", "2026-10-29", "mes_ult")) === J({ regra: { tipo: "mensal_ultimo", dia_semana: 4, duracao_dias: 1 } }));
  confere("todo ano em 12 de junho, 3 dias", J(ctx.rg("2027-06-12", "2027-06-14", "ano_dia")) === J({ regra: { tipo: "anual_fixa", mes: 6, dia: 12, duracao_dias: 3 } }));
  confere("toda semana com 9 dias é recusada (uma semana encostaria na outra)", !!ctx.rg("2026-10-16", "2026-10-24", "semana").erro);
  confere("todo mês com 30 dias é recusado", !!ctx.rg("2026-10-01", "2026-10-30", "mes_n").erro);
  confere("mais de 60 dias é recusado (o banco aceita até 60)", !!ctx.rg("2026-01-01", "2026-03-15", "nao").erro);
  confere("sem data de começo pede a data", /começa/.test(ctx.rg("", "", "nao").erro || ""));
  confere("resumo diz de que dia a que dia", /Toda semana na sexta-feira<\/b>, de sexta a domingo \(3 dias\)\./.test(ctx.rs("2026-10-16", "2026-10-18", "semana")), ctx.rs("2026-10-16", "2026-10-18", "semana"));
  // o texto da lista com o gênero certo e a duração
  confere("lista: 2º sábado do mês · 2 dias", ctx.desc({ regra: { tipo: "mensal_nth", n: 2, dia_semana: 6, duracao_dias: 2 } }) === "2º sábado do mês · 2 dias", ctx.desc({ regra: { tipo: "mensal_nth", n: 2, dia_semana: 6, duracao_dias: 2 } }));
  confere("lista: Última quinta do mês", ctx.desc({ regra: { tipo: "mensal_ultimo", dia_semana: 4, duracao_dias: 1 } }) === "Última quinta do mês");
  confere("lista: Sexta a domingo", ctx.desc({ regra: { tipo: "semanal", dia_semana: 5, duracao_dias: 3 } }) === "Sexta a domingo");
  confere("lista: período só uma vez", ctx.desc({ regra: { tipo: "datas", lista: [{ inicio: "2026-12-20", fim: "2026-12-23" }] } }) === "20/12/2026 a 23/12/2026");
  // as regras que o formulário grava, o motor do Calendário entende (as datas saem certas)
  const ENC = require(path.join(RAIZ, "scripts", "encartes", "calculo.cjs"));
  const oc = ENC.ocorrencias(ctx.rg("2026-10-16", "2026-10-18", "semana").regra, "2026-10-12", "2026-10-25").map((o) => o.inicio + ">" + o.fim).join(" ");
  confere("o motor entende a regra gravada (sextas 16 e 23/10, 3 dias)", oc === "2026-10-16>2026-10-18 2026-10-23>2026-10-25", oc);
  const oa = ENC.ocorrencias(ctx.rg("2027-05-09", "2027-05-09", "ano_n").regra, "2028-01-01", "2028-12-31").map((o) => o.inicio).join(" ");
  confere("o motor entende o 2º domingo de maio (2028 = 14/05)", oa === "2028-05-14", oa);
}

// quem não é master só vê a lista: o botão muda de nome
confere("quem não é master vê \"Ver promoções\"", /ccRenderLista[\s\S]*?"Adicionar promoção":"Ver promoções"/.test(src));

console.log(falhas ? ("\n" + ok + " ok, " + falhas + " falha(s).") : (ok + " ok, 0 falha(s)."));
process.exit(falhas ? 1 : 0);
