// PIX — o ritmo da rede de segurança (==PIXRITMO-*==), 30/09/2026.
//
// A queixa: o Supabase chegou a 89% do tráfego e 6x o limite de registros. A causa era a
// conferência do Pix: a lista INTEIRA de cobranças (20 KB) a cada 8 s, o dia todo, em qualquer
// tela. O conserto: pergunta pequena (só número e situação) e ritmo rápido só quando alguém
// está esperando — QR aberto ou robô trabalhando numa cobrança.
//
// Este teste NÃO procura texto: ele EXTRAI as funções do painel gerado e RODA, com um relógio
// de mentira e um banco de mentira que conta cada pergunta. Simula UMA HORA de tela aberta em
// cada situação e cobra os números. Cobra também os dois lados do "pago": ele continua
// aparecendo (a lista inteira vem assim que a situação muda) — economizar não pode esconder
// pagamento.
//   node scripts/testes/pix-ritmo.test.cjs
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
function pegaVar(nome) {
  const m = HTML.match(new RegExp("var " + nome + "=[^;]*;"));
  if (!m) throw new Error("não achei a variável " + nome);
  return m[0];
}

let ok = 0, falhou = 0;
function vale(nome, cond, det) { console.log((cond ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + det); cond ? ok++ : falhou++; }

/* ---------- o mundo de mentira ---------- */
function montar(cobrancas) {
  const mundo = {
    agora: 0, visivel: true, podeVer: true, modalAberto: false, modalKey: null,
    banco: cobrancas.map(c => Object.assign({}, c)),
    perguntasLeves: 0, perguntasInteiras: 0, bytes: 0,
    segurar: false, presas: [], aoConectar: null, instantes: [],
    torto: [0], tortoI: 0,        // sobra de cada tique, em ms (o Chrome não bate exato)
  };
  const linhaInteira = r => Object.assign({ qr_code: "0".repeat(560), linha_digitavel: "7".repeat(47), codigo_barras: "7".repeat(44), pedido_por: "financeiro" }, r);
  const sb = {
    from() {
      const q = { campos: "*" };
      q.select = c => { q.campos = c; return q; };
      q.order = () => q; q.limit = () => q;
      q.then = (ok) => {
        const leve = q.campos === "id,status";
        const linhas = mundo.banco.slice().sort((a, b) => b.id - a.id).map(r => leve ? { id: r.id, status: r.status } : linhaInteira(r));
        leve ? mundo.perguntasLeves++ : mundo.perguntasInteiras++;
        if (leve) mundo.instantes.push(mundo.agora);
        mundo.bytes += JSON.stringify(linhas).length;
        const responder = () => ok({ data: linhas, error: null });   // a resposta é o banco NA HORA da pergunta
        if (mundo.segurar) mundo.presas.push(responder); else responder();
        return { then() {} };
      };
      return q;
    },
    channel() { return { on() { return this; }, subscribe(f) { mundo.aoConectar = f || null; return this; } }; },
  };
  const doc = {
    get visibilityState() { return mundo.visivel ? "visible" : "hidden"; },
    getElementById(id) { return id === "pixModal" ? { classList: { contains: c => c === "show" && mundo.modalAberto } } : null; },
    querySelectorAll() { return []; },
  };
  const fontes = [pegaVar("PIX_TIQUE"),   // a mesma linha declara PIX_TIQUE, PIX_RAPIDO e PIX_CALMO
    pegaVar("pixCobsLeveSig"),           // e esta, os marcadores do ritmo e o número de cada carga
    "var pixCobs={}, pixCobsRT=null, pixCobT=null, pixCobsSig='', pixPollTimer=null;",
    pega("pixCobKey"), pega("pixSigLeve"), pega("pixPrecisaPressa"), pega("pixCobChecar"), pega("pixRitmo"), pega("pixCobLoad")].join("\n");
  const rodar = new Function("document", "Date", "pxSB", "pxPodeVer", "pixModalChecaPago", "renderPontosG", "pxAtualizaBadge", "pxReabrir",
    "setInterval", "setTimeout", "clearTimeout",
    "var pixModalKey=null;\n" + fontes +
    "\nreturn { pixCobLoad, pixRitmo, get cobs(){ return pixCobs; }, setModalKey(k){ pixModalKey=k; }, get tique(){ return PIX_TIQUE; } };");
  const relogio = { now: () => mundo.agora };
  let pagoMostrado = 0;
  const api = rodar.call({}, doc, relogio, () => sb, () => mundo.podeVer, () => { pagoMostrado++; }, () => {}, () => {}, () => {},
    () => 1, () => 1, () => {});
  api.mundo = mundo;
  api.pago = () => pagoMostrado;
  // uma hora de relógio: o painel bate o tique a cada PIX_TIQUE ms
  api.passar = (ms) => { const fim = mundo.agora + ms; while (mundo.agora < fim) {
    const sobra = mundo.torto[mundo.tortoI++ % mundo.torto.length];
    mundo.agora = Math.floor((mundo.agora + api.tique) / api.tique) * api.tique + sobra;   // bate em k·4000 + sobra, sem acumular
    api.pixRitmo(); } };
  return api;
}

const HORA = 3600 * 1000;
const base = () => [
  { id: 80, ponto_id: "pg1", parcela_key: "2026-10-20", status: "gerado" },
  { id: 81, ponto_id: "pg2", parcela_key: "2026-10-20", status: "pago" },
  { id: 82, ponto_id: "pg3", parcela_key: "2026-11-20", status: "gerado" },
  { id: 83, ponto_id: "pg4", parcela_key: "2026-10-05", status: "cancelado" },
];

console.log("\n  ==== 1. PAINEL ABERTO, NINGUÉM ESPERANDO (o caso de quase o dia todo) ====");
{
  const p = montar(base());
  p.pixCobLoad();                                   // a carga do login
  const inteirasAntes = p.mundo.perguntasInteiras; p.mundo.bytes = 0;
  p.passar(HORA);
  vale("pergunta ao banco a cada 2 minutos, não a cada 8 s", p.mundo.perguntasLeves === 30, p.mundo.perguntasLeves + " perguntas pequenas em 1 hora (antes: 450 inteiras)");
  vale("sem mudança, NUNCA baixa a lista inteira de novo", p.mundo.perguntasInteiras === inteirasAntes, (p.mundo.perguntasInteiras - inteirasAntes) + " listas inteiras");
  vale("o gasto da hora cabe em poucos KB", p.mundo.bytes < 10 * 1024, (p.mundo.bytes / 1024).toFixed(1) + " KB (antes: ~9 MB)");
}

console.log("\n  ==== 2. QR ABERTO NA TELA, ESPERANDO O FORNECEDOR PAGAR ====");
{
  const p = montar(base());
  p.pixCobLoad();
  p.mundo.modalAberto = true; p.setModalKey("pg1|2026-10-20");
  p.passar(HORA);
  vale("pergunta a cada 8 s enquanto o QR está aberto", p.mundo.perguntasLeves === 450, p.mundo.perguntasLeves + " perguntas pequenas em 1 hora");
  vale("cada pergunta é a pequena, não a lista inteira", p.mundo.perguntasInteiras === 1, (p.mundo.perguntasInteiras - 1) + " listas inteiras além da do login");
}

console.log("\n  ==== 3. O PAGO APARECE (economizar não pode esconder pagamento) ====");
{
  const p = montar(base());
  p.pixCobLoad();
  p.mundo.modalAberto = true; p.setModalKey("pg1|2026-10-20");
  p.passar(20 * 1000);
  const antes = p.pago();
  p.mundo.banco.find(r => r.id === 80).status = "pago";   // o robô achou o pagamento no banco
  const t0 = p.mundo.agora;
  let quando = null;
  while (p.mundo.agora - t0 < 60 * 1000 && quando === null) { p.passar(p.tique); if (p.cobs["pg1|2026-10-20"].status === "pago") quando = p.mundo.agora - t0; }
  vale("com o QR aberto, o pago chega em até 8 s mesmo sem o aviso instantâneo", quando !== null && quando <= 8000, quando === null ? "NÃO CHEGOU" : (quando / 1000) + " s");
  vale("e a janela do QR é conferida (é ela que acende o verde de pago)", p.pago() > antes, "conferida");

  const q = montar(base());
  q.pixCobLoad();
  q.passar(5 * 60 * 1000);
  q.mundo.banco.find(r => r.id === 82).status = "pago";
  const t1 = q.mundo.agora; let quando2 = null;
  while (q.mundo.agora - t1 < 5 * 60 * 1000 && quando2 === null) { q.passar(q.tique); if (q.cobs["pg3|2026-11-20"].status === "pago") quando2 = q.mundo.agora - t1; }
  vale("sem QR aberto e sem aviso instantâneo, o pago chega em até 2 min (o seguro)", quando2 !== null && quando2 <= 120000, quando2 === null ? "NÃO CHEGOU" : (quando2 / 1000) + " s");
}

console.log("\n  ==== 4. ROBÔ TRABALHANDO NUMA COBRANÇA (alguém clicou em Gerar Pix) ====");
{
  const cobs = base(); cobs.push({ id: 84, ponto_id: "pg5", parcela_key: "2026-10-20", status: "pedido" });
  const p = montar(cobs);
  p.pixCobLoad();
  p.passar(60 * 1000);
  vale("com cobrança em 'pedido', fica no ritmo rápido", p.mundo.perguntasLeves >= 7, p.mundo.perguntasLeves + " perguntas no 1º minuto");
  p.mundo.banco.find(r => r.id === 84).status = "gerado";   // o robô gerou o QR
  p.passar(10 * 1000);
  vale("quando o QR fica pronto, a lista inteira vem (com o QR)", p.cobs["pg5|2026-10-20"].status === "gerado", "chegou: " + p.cobs["pg5|2026-10-20"].status);
  const leves = p.mundo.perguntasLeves;
  p.passar(10 * 60 * 1000);
  vale("e o ritmo volta ao calmo sozinho", p.mundo.perguntasLeves - leves <= 6, (p.mundo.perguntasLeves - leves) + " perguntas nos 10 min seguintes");
}

console.log("\n  ==== 5. ABA ESCONDIDA OU SEM PERMISSÃO: NÃO PERGUNTA NADA ====");
{
  const p = montar(base()); p.pixCobLoad();
  p.mundo.visivel = false; p.passar(HORA);
  vale("aba escondida", p.mundo.perguntasLeves === 0, p.mundo.perguntasLeves + " perguntas");
  const q = montar(base()); q.pixCobLoad(); q.mundo.podeVer = false; q.passar(HORA);
  vale("login sem a página Pontos extras", q.mundo.perguntasLeves === 0, q.mundo.perguntasLeves + " perguntas");
  p.mundo.visivel = true; const l = p.mundo.perguntasLeves; p.passar(p.tique);
  vale("voltou pra aba: confere na hora (não espera os 2 min)", p.mundo.perguntasLeves === l + 1, (p.mundo.perguntasLeves - l) + " pergunta no 1º tique");
}

console.log("\n  ==== 6. RELÓGIO DO NAVEGADOR QUE NÃO BATE EXATO (7.999 ms em vez de 8.000) ====");
{
  const p = montar(base());
  p.mundo.torto = [2, 0, 1, 2, 0, 0, 1, 2, 1, 0];   // sobras de 0 a 2 ms, como o Chrome mede
  p.pixCobLoad();
  p.mundo.modalAberto = true; p.setModalKey("pg1|2026-10-20");
  p.passar(10 * 60 * 1000);
  const t = p.mundo.instantes, gaps = t.slice(1).map((x, i) => x - t[i]);
  const maior = Math.max(...gaps);
  vale("com o QR aberto, nenhuma conferência passa de 8 s da anterior", maior <= 8010, "maior intervalo: " + (maior / 1000).toFixed(3) + " s em " + gaps.length + " intervalos");
}

console.log("\n  ==== 7. O AVISO INSTANTÂNEO CAIU E VOLTOU (Wi-Fi piscou, computador acordou) ====");
{
  const p = montar(base());
  p.pixCobLoad();
  p.passar(30 * 1000);
  vale("o painel pediu pra saber quando o aviso conecta", typeof p.mundo.aoConectar === "function", typeof p.mundo.aoConectar);
  p.mundo.banco.find(r => r.id === 82).status = "pago";      // pagaram enquanto o aviso estava fora
  const l = p.mundo.perguntasLeves;
  p.mundo.aoConectar && p.mundo.aoConectar("SUBSCRIBED");    // o aviso voltou
  vale("na volta, confere na hora (não espera a conferência calma)", p.mundo.perguntasLeves === l + 1, (p.mundo.perguntasLeves - l) + " pergunta");
  vale("e o pago que aconteceu durante a queda aparece", p.cobs["pg3|2026-11-20"].status === "pago", p.cobs["pg3|2026-11-20"].status);
}

console.log("\n  ==== 8. RESPOSTA VELHA CHEGANDO DEPOIS DA NOVA (rede lenta) ====");
{
  const p = montar(base());
  p.pixCobLoad();
  p.mundo.segurar = true;
  p.pixCobLoad();                                            // carga A: lê o banco ANTES do pagamento
  p.mundo.banco.find(r => r.id === 80).status = "pago";
  p.pixCobLoad();                                            // carga B: lê o banco DEPOIS
  const [a, b] = p.mundo.presas; p.mundo.presas = []; p.mundo.segurar = false;
  b();                                                       // B chega primeiro: mostra o pago
  a();                                                       // A, velha, chega depois
  vale("a resposta velha não desfaz o ✓ Pago", p.cobs["pg1|2026-10-20"].status === "pago", p.cobs["pg1|2026-10-20"].status);
  const l = p.mundo.perguntasInteiras; p.passar(5 * 60 * 1000);
  vale("e o retrato pequeno ficou o novo (não baixa a lista inteira à toa depois)", p.mundo.perguntasInteiras === l, (p.mundo.perguntasInteiras - l) + " listas inteiras");
}

console.log("\n  ==== 9. RELÓGIO DO COMPUTADOR ACERTADO 1 HORA PRA TRÁS ====");
{
  const p = montar(base());
  p.pixCobLoad();
  p.passar(10 * 60 * 1000);
  p.mundo.agora -= HORA;                                     // o Windows sincronizou a hora
  const l = p.mundo.perguntasLeves;
  p.passar(3 * 60 * 1000);
  vale("a conferência continua (não fica 1 hora parada)", p.mundo.perguntasLeves - l >= 1, (p.mundo.perguntasLeves - l) + " perguntas nos 3 min seguintes");
}

console.log("\n  " + ok + " ok, " + falhou + " falha(s).\n");
process.exit(falhou ? 1 : 0);
