// PONTOS EXTRAS — marcar pago e autorizar exigem o CONTRATO assinado e anexado; assinar de novo
// tira o contrato velho do anexo (==PXCONTRATO==), 30/09/2026.
//
// Pedido dele: "para marcar como pago tivesse que anexar o contrato e anexar o comprovante", e o
// mesmo cuidado dos galpões: se o contrato mudar e for assinado de novo, o papel velho (que o
// fornecedor assinou na versão antiga) não pode continuar liberando a cobrança.
//
// Este teste EXTRAI do painel gerado a trava (pxExigeContrato), a janela do marcar pago (mpgAbrir /
// mpgConfirmar) e o assinar (pxAssinar), e RODA com uma tela e uma nuvem de mentira.
//   node scripts/testes/pontos-contrato-antes.test.cjs
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
const K = "2026-10-01";
const depois = () => new Promise(r => setImmediate(r));

// tela de mentira: elementos por id (a janela do marcar pago) e avisos anotados
function mundo(opc) {
  opc = opc || {};
  const avisos = [], estado = { salvou: 0, els: {} };
  const el = id => estado.els[id] || (estado.els[id] = { id, value: "", innerHTML: "", textContent: "", dataset: {}, style: {},
    classList: { _c: new Set(), add(c) { this._c.add(c); }, remove(c) { this._c.delete(c); }, contains(c) { return this._c.has(c); } },
    addEventListener() {}, focus() {}, click() {} });
  el("mpgModal");   // a janela já existe (não precisa montar o HTML dela)
  const documento = { getElementById: el, createElement: () => el("novo"), body: { appendChild() {} } };
  const f = new Function("document", "uiConfirm", "window", "estado", "opc", "setTimeout",
    "var pontosG=[]; var mpgCtx=null, mpgArquivo=null, mpgArqVer=null; var PX_LOCADOR={diretor:'GILSON JOÃO DOS SANTOS'};\n" +
    "function savePontosG(){ estado.salvou++; } function renderPontosG(){} function pxReabrir(){} function mpgArqTxt(){} function mpgProcessaArquivo(){} function pxAbrirArquivo(){}\n" +
    "function brl(v){ return 'R$ '+(+v||0).toFixed(2); } function pxFmtData(k){ return k; }\n" +
    "function autorizarMaster(){ return Promise.resolve('senha-de-mentira'); }\n" +
    // a nuvem assina a impressão que o painel mandou; se pedido, troca a lista no meio (como a recarga)
    "function pxSB(){ return { rpc: function(n, a){ if(opc.recarrega) pontosG=JSON.parse(JSON.stringify(pontosG)); return { then: function(ok){ ok({ data: { em:'2026-10-01T10:00:00Z', codigo:'NOVO-0001', impressao:a.p_impressao_esperada } }); } }; } }; }\n" +
    ["pxAssinatura", "pxAssinImpressao", "pxAssinValida", "pxAssinCaiu", "pxContratoAnexado", "pxExigeAssinatura", "pxExigeContrato",
     "mpgAbrir", "mpgConfirmar", "pxAssinar"].map(pega).join("\n") +
    "\nreturn { pxExigeContrato, mpgAbrir, mpgConfirmar, pxAssinar, pxAssinImpressao, pxAssinValida, get lista(){ return pontosG; }, set lista(v){ pontosG=v; }," +
    " arquivo(a){ mpgArquivo=a; } };")(
    documento, o => { avisos.push(o); return Promise.resolve(false); }, { __PERFIL: { nome: "Victor", is_master: true }, __EMAIL: "t" }, estado, opc, () => 0);
  return { f, avisos, estado, el };
}
function ponto(f, extra) {
  const p = Object.assign({ id: "p7", numero: 7, fornecedor: "FORNECEDOR X", cnpj: "12345678000199", pagamento: "Pix",
    abertura: "2026-09-01", vencimento: "2027-09-01", valor: 500 }, extra);
  p.assinatura = { em: "2026-09-01T10:00:00Z", codigo: "VELHO-0001", impressao: f.pxAssinImpressao(p) };
  return p;
}

(async () => {
  console.log("\n  ==== MARCAR PAGO SEM CONTRATO ANEXADO ====");
  {
    const { f, avisos, el } = mundo();
    const p = ponto(f); f.lista = [p];
    f.mpgAbrir(p, K);
    vale("a janela do marcar pago NÃO abre", !el("mpgModal").classList.contains("show"), "fechada");
    vale("aparece o aviso do contrato", avisos[0] && avisos[0].titulo === "Anexe o contrato assinado", avisos[0] && avisos[0].titulo);
    vale("o aviso fala de marcar como paga (não de gerar cobrança)", avisos[0] && /marque como paga/.test(avisos[0].msg) && !/gere a cobrança/.test(avisos[0].msg), "texto certo");
  }
  console.log("\n  ==== MARCAR PAGO SEM ASSINATURA / COM A ASSINATURA CAÍDA ====");
  {
    const { f, avisos, el } = mundo();
    const p = ponto(f, { contratoArquivo: "https://x/c.pdf" }); delete p.assinatura; f.lista = [p];
    f.mpgAbrir(p, K);
    vale("sem assinatura: não abre e pede a assinatura", !el("mpgModal").classList.contains("show") && avisos[0] && avisos[0].titulo === "Assine o contrato primeiro", avisos[0] && avisos[0].titulo);
    vale("e o texto fala de marcar como paga", avisos[0] && /não pode ser marcada como paga/.test(avisos[0].msg), "texto certo");
  }
  {
    const { f, avisos, el } = mundo();
    const p = ponto(f, { contratoArquivo: "https://x/c.pdf" }); p.valor = 800; f.lista = [p];   // mudou o valor: a assinatura cai
    f.mpgAbrir(p, K);
    vale("assinatura caída: não abre e avisa", !el("mpgModal").classList.contains("show") && avisos[0] && avisos[0].titulo === "A assinatura caiu", avisos[0] && avisos[0].titulo);
  }
  console.log("\n  ==== MARCAR PAGO COM CONTRATO ASSINADO E ANEXADO ====");
  {
    const { f, avisos, el, estado } = mundo();
    const p = ponto(f, { contratoArquivo: "https://x/c.pdf", contratoNome: "c.pdf" }); f.lista = [p];
    f.mpgAbrir(p, K);
    vale("a janela abre, sem aviso", el("mpgModal").classList.contains("show") && avisos.length === 0, avisos.length + " aviso(s)");
    el("mpgMotivo").value = "pago em dinheiro"; f.arquivo({ arquivo: "data:application/pdf;base64,QUFB", nome: "comp.pdf" });
    f.mpgConfirmar();
    vale("enviou para a autorização do master (como antes)", p.manuais && p.manuais[K] && p.manuais[K].st === "pendente" && !!p.comprovantes[K] && estado.salvou === 1, JSON.stringify(p.manuais && p.manuais[K] && p.manuais[K].st));
  }
  {
    const { f, avisos, el, estado } = mundo();
    const p = ponto(f, { contratoArquivo: "https://x/c.pdf" }); f.lista = [p];
    f.mpgAbrir(p, K);
    delete p.contratoArquivo;              // tiraram o contrato (outro computador) com a janela aberta
    el("mpgMotivo").value = "pago em dinheiro"; f.arquivo({ arquivo: "data:application/pdf;base64,QUFB", nome: "comp.pdf" });
    f.mpgConfirmar();
    vale("contrato tirado com a janela aberta: NÃO grava", !(p.manuais && p.manuais[K]) && estado.salvou === 0, p.manuais ? "gravou (defeito)" : "não gravou");
    vale("fecha a janela e avisa", !el("mpgModal").classList.contains("show") && avisos.some(a => a.titulo === "Anexe o contrato assinado"), avisos.map(a => a.titulo).join(" / "));
  }
  console.log("\n  ==== GERAR PIX CONTINUA COM O TEXTO DE ANTES ====");
  {
    const { f, avisos } = mundo();
    const p = ponto(f); f.lista = [p];
    f.pxExigeContrato(p);
    vale("sem o 'marcar', o aviso continua falando de gerar a cobrança", avisos[0] && /gere a cobrança/.test(avisos[0].msg), "texto de antes");
    delete p.assinatura; f.pxExigeContrato(p);
    vale("e o da assinatura continua 'a cobrança não é liberada'", avisos[1] && /cobrança não é liberada/.test(avisos[1].msg), "texto de antes");
  }

  console.log("\n  ==== ASSINAR DE NOVO DEPOIS DE MUDAR O CONTRATO ====");
  for (const recarrega of [false, true]) {
    const rot = recarrega ? " (com a nuvem recarregando no meio)" : "";
    const { f, avisos } = mundo({ recarrega });
    const p = ponto(f, { contratoArquivo: "https://x/contrato-500.pdf", contratoNome: "contrato-500.pdf" }); f.lista = [p];
    vale("contrato de R$ 500 assinado e anexado: libera" + rot, f.pxExigeContrato(p) === true, "liberado");
    p.valor = 800;                                   // mudou o valor no editar
    vale("mudou pra R$ 800: a assinatura cai e trava" + rot, f.pxAssinValida(p) === false, "travado");
    avisos.length = 0;
    f.pxAssinar("p7"); await depois(); await depois();
    const pAt = f.lista.find(x => x.id === "p7");
    vale("assinou de novo: a assinatura nova vale" + rot, pAt.assinatura && pAt.assinatura.codigo === "NOVO-0001" && f.pxAssinValida(pAt), pAt.assinatura && pAt.assinatura.codigo);
    vale("o contrato de R$ 500 saiu do anexo" + rot, !pAt.contratoArquivo && !pAt.contratoNome, pAt.contratoArquivo || "sem anexo");
    vale("e ele é avisado: anexe o contrato novo" + rot, avisos.some(a => a.titulo === "Anexe o contrato novo" && /fornecedor/.test(a.msg)), avisos.map(a => a.titulo).join(" / "));
    avisos.length = 0;
    vale("a cobrança fica travada até anexar o novo" + rot, f.pxExigeContrato(pAt) === false && avisos[0] && avisos[0].titulo === "Anexe o contrato assinado", avisos[0] && avisos[0].titulo);
  }
  {
    const { f, avisos } = mundo();
    const p = ponto(f); delete p.assinatura; f.lista = [p];   // primeira assinatura, nada anexado
    f.pxAssinar("p7"); await depois(); await depois();
    vale("primeira assinatura (sem anexo): assina e não mostra aviso", !!f.lista[0].assinatura && avisos.length === 0, avisos.length + " aviso(s)");
  }

  console.log("\n  " + ok + " ok, " + falhou + " falha(s).\n");
  process.exit(falhou ? 1 : 0);
})();
