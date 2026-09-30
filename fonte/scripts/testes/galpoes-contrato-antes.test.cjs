// GALPÕES — cobrar exige o CONTRATO assinado e anexado (==GLCONTRATO==), 30/09/2026.
//
// Pedido dele: "antes de gerar para pagar temos que obrigar a colocar o contrato anexado para
// poder anexar o comprovante e também apertar para confirmar como pago".
//
// Este teste EXTRAI do painel gerado a trava (glExigeContrato) e o anexar comprovante
// (glPedirComprovante) e RODA, com uma janela de aviso de mentira e um seletor de arquivo de
// mentira. Cobra os dois lados: sem contrato (ou sem assinatura, ou com a assinatura caída)
// NADA anda; com contrato assinado e anexado, o seletor abre e o comprovante grava.
//   node scripts/testes/galpoes-contrato-antes.test.cjs
const fs = require("fs");
const path = require("path");

const HTML = fs.readFileSync(path.join(__dirname, "..", "..", "output", "index.html"), "utf8");
function pega(nome) {
  const i = HTML.indexOf("function " + nome + "(");
  if (i < 0) throw new Error("não achei " + nome + " no output/index.html (rode o build antes)");
  let n = 0, j = HTML.indexOf("{", i);
  for (let k = j; k < HTML.length; k++) { if (HTML[k] === "{") n++; else if (HTML[k] === "}") { n--; if (!n) return HTML.slice(i, k + 1); } }
  throw new Error("função " + nome + " sem fim");
}

let ok = 0, falhou = 0;
function vale(nome, cond, det) { console.log((cond ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + det); cond ? ok++ : falhou++; }

// mundo de mentira: avisos anotados, seletor de arquivo que só conta os cliques
function mundo() {
  const avisos = [], estado = { cliques: 0, salvou: 0, input: null };
  const documento = {
    body: { appendChild(el) { estado.input = el; } },
    getElementById(id) { return id === "glCompArq" ? estado.input : null; },
    createElement() { const el = { dataset: {}, style: {}, files: null, ouvintes: {},
      addEventListener(ev, fn) { this.ouvintes[ev] = fn; }, click() { estado.cliques++; } }; return el; },
  };
  class LeitorDeMentira { readAsDataURL(f) { this.result = "data:application/pdf;base64,QUFB"; this.onload(); } }
  const f = new Function("document", "uiConfirm", "FileReader", "window", "estado",
    "var galpoesG=[];\nfunction glSave(){ estado.salvou++; } function renderGalpoes(){} function glReabrir(){}\n" +
    ["pxAssinatura", "glValor2", "glAssinImpressao", "glAssinValida", "glAssinCaiu", "glExigeAssinatura",
     "glContratoPronto", "glExigeContrato", "glPedirComprovante"].map(pega).join("\n") +
    "\nreturn { glExigeContrato, glContratoPronto, glPedirComprovante, glAssinImpressao, set g(v){ galpoesG=v; } };")(
    documento, o => { avisos.push(o); return Promise.resolve(false); }, LeitorDeMentira, { __EMAIL: "teste" }, estado);
  return { f, avisos, estado };
}
// um galpão com assinatura VÁLIDA (a impressão bate com os dados de hoje)
function galpao(f, extra) {
  const g = Object.assign({ id: "g1", numero: "1470J", cnpj: "05628483478", vendedor: "FULANO", rg: "123", enderecoInq: "Rua X",
    aluguel: "0.5", valor: 810.5, diaPag: 5, abertura: "2026-09-29", pagamento: "Pix" }, extra);
  g.assinatura = { em: "2026-09-30T12:52:08Z", codigo: "D626-XXXX", impressao: f.glAssinImpressao(g) };
  return g;
}
const K = "2026-10-05";

console.log("\n  ==== SEM CONTRATO ANEXADO: nada anda ====");
{
  const { f, avisos, estado } = mundo();
  const g = galpao(f); f.g = [g];
  vale("assinado mas sem contrato anexado: recusa", f.glExigeContrato(g) === false, "recusou");
  vale("e explica o que falta", avisos.length === 1 && avisos[0].titulo === "Anexe o contrato assinado", avisos[0] && avisos[0].titulo);
  vale("o aviso fala de cobrar, comprovante e marcar como paga", /cobrada/.test(avisos[0].msg) && /comprovante/.test(avisos[0].msg) && /marcada como paga/.test(avisos[0].msg), "texto completo");
  f.glPedirComprovante("g1", K);
  vale("Anexar comprovante NÃO abre o seletor de arquivo", estado.cliques === 0, estado.cliques + " clique(s) no seletor");
  vale("e mostra o mesmo aviso", avisos.length === 2 && avisos[1].titulo === "Anexe o contrato assinado", avisos.length + " aviso(s)");
  vale("glContratoPronto diz que não", f.glContratoPronto(g) === false, "falso");
}

console.log("\n  ==== SEM ASSINATURA: pede a assinatura primeiro ====");
{
  const { f, avisos, estado } = mundo();
  const g = galpao(f, { contratoArquivo: "https://x/contrato.pdf" }); delete g.assinatura; f.g = [g];
  vale("anexado mas SEM assinatura: recusa", f.glExigeContrato(g) === false, "recusou");
  vale("o aviso é o da assinatura, falando de cobrança", avisos[0] && avisos[0].titulo === "Assine o contrato primeiro" && /cobrada/.test(avisos[0].msg), avisos[0] && avisos[0].titulo);
  f.glPedirComprovante("g1", K);
  vale("seletor de arquivo continua fechado", estado.cliques === 0, estado.cliques + " clique(s)");
}

console.log("\n  ==== ASSINATURA CAÍDA (contrato mudou depois de assinado) ====");
{
  const { f, avisos } = mundo();
  const g = galpao(f, { contratoArquivo: "https://x/contrato.pdf" }); g.diaPag = 10; f.g = [g];
  vale("assinatura caída: recusa", f.glExigeContrato(g) === false, "recusou");
  vale("o aviso diz que a assinatura caiu", avisos[0] && avisos[0].titulo === "A assinatura caiu", avisos[0] && avisos[0].titulo);
}

console.log("\n  ==== CONTRATO ASSINADO E ANEXADO: libera ====");
{
  const { f, avisos, estado } = mundo();
  const g = galpao(f, { contratoArquivo: "https://x/contrato.pdf", contratoNome: "contrato.pdf" }); f.g = [g];
  vale("libera sem mostrar aviso", f.glExigeContrato(g) === true && avisos.length === 0, avisos.length + " aviso(s)");
  vale("glContratoPronto diz que sim", f.glContratoPronto(g) === true, "verdadeiro");
  f.glPedirComprovante("g1", K);
  vale("Anexar comprovante abre o seletor de arquivo", estado.cliques === 1, estado.cliques + " clique(s)");
  // ele escolhe o arquivo: o comprovante grava (sem marcar como paga, que é o 2º passo)
  const inp = estado.input; inp.files = [{ name: "pix.pdf", size: 1000 }];
  inp.ouvintes.change();
  vale("o comprovante ficou anexado e foi salvo", estado.salvou === 1 && !!(g.comprovantes && g.comprovantes[K] && g.comprovantes[K].nome === "pix.pdf"), g.comprovantes ? Object.keys(g.comprovantes).join(",") : "nenhum");
  vale("e NÃO marcou como paga sozinho", !(g.manuais && g.manuais[K]), "continua em aberto");
}

console.log("\n  ==== CONTRATO REMOVIDO ENQUANTO ESCOLHIA O ARQUIVO ====");
{
  const { f, avisos, estado } = mundo();
  const g = galpao(f, { contratoArquivo: "https://x/contrato.pdf" }); f.g = [g];
  f.glPedirComprovante("g1", K);
  delete g.contratoArquivo;                  // alguém tirou o contrato com o seletor aberto
  estado.input.files = [{ name: "pix.pdf", size: 1000 }];
  estado.input.ouvintes.change();
  vale("o comprovante NÃO grava", !(g.comprovantes && g.comprovantes[K]) && estado.salvou === 0, g.comprovantes ? "gravou (defeito)" : "não gravou");
  vale("e avisa por quê", avisos.length === 1 && avisos[0].titulo === "Anexe o contrato assinado", avisos.length + " aviso(s)");
}

// ASSINAR DE NOVO (achado da revisão): editar um dado que sai impresso derruba a assinatura; assinar de
// novo NÃO pode deixar o contrato velho (que o inquilino assinou na versão antiga) liberar a cobrança.
function mundoAssinar(recarregaNoMeio) {
  const avisos = [], estado = { salvou: 0 };
  const f = new Function("uiConfirm", "estado", "recarrega",
    "var galpoesG=[]; var GL_LOCADOR={nome:'GILSON JOÃO DOS SANTOS'};\n" +
    "function glSave(){ estado.salvou++; } function renderGalpoes(){} function glReabrir(){}\n" +
    "function glSB(){ return {}; } function glAssinLacunas(){ return []; }\n" +
    "function autorizarMaster(){ return Promise.resolve('senha-de-mentira'); }\n" +
    // o banco assina a impressão que o painel mandou; se pedido, a nuvem troca a lista no meio (como o glCloudLoad)
    "function glAssinRpc(nome, args, titulo, sucesso){ if(recarrega) galpoesG=JSON.parse(JSON.stringify(galpoesG)); sucesso({ em:'2026-10-01T10:00:00Z', codigo:'NOVO-0001', impressao:args.p_impressao_esperada }); }\n" +
    ["pxAssinatura", "glValor2", "glAssinImpressao", "glAssinValida", "glAssinCaiu", "glExigeAssinatura",
     "glContratoPronto", "glExigeContrato", "glAssinar"].map(pega).join("\n") +
    "\nreturn { glAssinar, glExigeContrato, glContratoPronto, glAssinImpressao, get g(){ return galpoesG; }, set g(v){ galpoesG=v; } };")(
    o => { avisos.push(o); return Promise.resolve(false); }, estado, !!recarregaNoMeio);
  return { f, avisos, estado };
}
const depois = () => new Promise(r => setImmediate(r));

(async () => {
  console.log("\n  ==== ASSINAR DE NOVO DEPOIS DE MUDAR O CONTRATO ====");
  for (const recarrega of [false, true]) {
    const rot = recarrega ? " (com a nuvem recarregando no meio)" : "";
    const { f, avisos } = mundoAssinar(recarrega);
    const g = galpao(f, { contratoArquivo: "https://x/contrato-versao-A.pdf", contratoNome: "contrato-versao-A.pdf" }); f.g = [g];
    vale("versão A assinada e anexada: libera" + rot, f.glContratoPronto(g) === true, "liberado");
    g.diaPag = 10;                                   // editou um dado que sai impresso
    vale("mudou o contrato: a assinatura cai e trava" + rot, f.glContratoPronto(g) === false, "travado");
    f.glAssinar("g1"); await depois(); await depois();
    const gAt = f.g.find(x => x.id === "g1");
    vale("assinou de novo: a assinatura nova vale" + rot, gAt.assinatura && gAt.assinatura.codigo === "NOVO-0001", gAt.assinatura && gAt.assinatura.codigo);
    vale("o contrato VELHO deixou de valer (saiu do anexo)" + rot, !gAt.contratoArquivo && !gAt.contratoNome, gAt.contratoArquivo || "sem anexo");
    vale("a cobrança continua travada até anexar o novo" + rot, f.glContratoPronto(gAt) === false, "travado");
    vale("e ele é avisado do porquê" + rot, avisos.some(a => a.titulo === "Anexe o contrato novo"), avisos.map(a => a.titulo).join(" / "));
  }
  {
    const { f, avisos } = mundoAssinar(false);
    const g = galpao(f); delete g.assinatura; f.g = [g];   // primeira assinatura, sem nada anexado
    f.glAssinar("g1"); await depois(); await depois();
    vale("primeira assinatura (sem anexo): assina e não mostra aviso nenhum", !!f.g[0].assinatura && avisos.length === 0, avisos.length + " aviso(s)");
  }

  console.log("\n  ==== CONTRATO QUE NÃO SUBIU PRA NUVEM ====");
  for (const sobe of [false, true]) {
    const avisos = [];
    const f = new Function("uiConfirm", "window", "sobe",
      "function pxUploadDataUrl(){ return Promise.resolve(sobe ? 'https://nuvem/galpao_g1_contrato.pdf' : ''); }\n" +
      pega("glSubirArquivos") + "\nreturn { glSubirArquivos };")(o => { avisos.push(o); return Promise.resolve(false); }, {}, sobe);
    const g = { id: "g1", contratoArquivo: "data:application/pdf;base64,QUFB", contratoNome: "contrato.pdf" };
    await f.glSubirArquivos(g);
    if (sobe) vale("subiu: guarda o endereço da nuvem, sem aviso", g.contratoArquivo === "https://nuvem/galpao_g1_contrato.pdf" && avisos.length === 0, g.contratoArquivo);
    else vale("não subiu: AVISA (antes sumia calado na recarga)", avisos.length === 1 && avisos[0].titulo === "O contrato não subiu", avisos.map(a => a.titulo).join(" / ") || "nenhum aviso");
  }

  console.log("\n  " + ok + " ok, " + falhou + " falha(s).\n");
  process.exit(falhou ? 1 : 0);
})();
