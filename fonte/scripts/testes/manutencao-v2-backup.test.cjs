// BACKUP das Configurações (só master) × Manutenção v2 — roda bkpBaixar / bkpRestaurar REAIS do painel
// construído (output/index.html) com um supabase de mentira que registra o que foi pedido.
// Prova (achado REG-02 da revisão de 15/09/2026):
//   * as 6 tabelas novas da Manutenção entram no arquivo de backup (depois do corte o histórico mora nelas);
//   * são lidas em páginas de 1000 (o teto do servidor), na ordem da chave — nada fica de fora;
//   * se alguma delas falhar, a mensagem NÃO diz "✓ Backup baixado";
//   * a restauração NÃO grava por cima do histórico (execução e auditoria não se apagam) e avisa isso.
//   npx tsx scripts/demoDashboard.ts && node scripts/testes/manutencao-v2-backup.test.cjs
const fs = require("fs"), path = require("path"), vm = require("vm");

const HTML = fs.readFileSync(path.join(__dirname, "..", "..", "output", "index.html"), "utf8");
let ok = 0, falhou = 0;
function vale(nome, cond, det) { console.log((cond ? "  OK   " : "  FALHA") + " | " + nome + (det !== undefined ? "  ->  " + String(det).slice(0, 300) : "")); cond ? ok++ : falhou++; }

// pedaço do código construído: "var X=...;" ou "function f(){...}" (chaves casadas, fora de texto)
function pedaco(inicio) {
  const i = HTML.indexOf(inicio);
  if (i < 0) throw new Error("não achei no output/index.html: " + inicio);
  if (inicio.startsWith("var ")) return HTML.slice(i, HTML.indexOf(";\n", i) + 1);
  let k = HTML.indexOf("{", i), prof = 0, str = null;
  for (; k < HTML.length; k++) {
    const ch = HTML[k];
    if (str) { if (ch === "\\") { k++; continue; } if (ch === str) str = null; continue; }
    if (ch === '"' || ch === "'") { str = ch; continue; }
    if (ch === "{") prof++;
    else if (ch === "}") { prof--; if (prof === 0) break; }
  }
  return HTML.slice(i, k + 1);
}
let CODIGO;
try {
  CODIGO = ["var CFG_TABELAS_MAN2=", "var CFG_TABELAS=", "function bkpLerTabela(", "function bkpBaixar(", "function bkpRestaurar("].map(pedaco).join("\n");
} catch (e) { console.log("FALHA | " + e.message); process.exit(1); }

const MAN2 = ["manutencao_rotinas", "manutencao_execucoes", "manutencao_execucoes_custos", "manutencao_pendencias", "manutencao_anexos", "manutencao_auditoria"];
const linhas = (n, chave) => Array.from({ length: n }, (_, i) => ({ [chave || "id"]: String(100000 + i) }));

function ambiente(opts) {
  opts = opts || {};
  const pedidos = [], upserts = [], dados = opts.dados || {};
  function cadeia(t) {
    const q = { t, ordem: null, de: null, ate: null };
    const api = {
      select() { return api; },
      order(c) { q.ordem = c; return api; },
      range(a, b) { q.de = a; q.ate = b; return api; },
      upsert(l) { upserts.push({ t, n: l.length }); return Promise.resolve({ data: null, error: null }); },
      then(res, rej) {
        pedidos.push(Object.assign({}, q));
        if ((opts.falhar || []).indexOf(t) >= 0) return Promise.resolve({ data: null, error: { message: "falhou" } }).then(res, rej);
        let l = dados[t] || [];
        l = q.de != null ? l.slice(q.de, q.ate + 1) : l.slice(0, 1000);   // o servidor corta em 1000 linhas
        return Promise.resolve({ data: l, error: null }).then(res, rej);
      }
    };
    return api;
  }
  const msg = { textContent: "", style: {} };
  const ctx = {
    window: { __SB: { from: cadeia } }, Promise, JSON, Object, Date, console,
    document: { getElementById: (id) => (id === "bkpMsg" ? msg : null), createElement: () => ({ click() {}, remove() {} }), body: { appendChild() {} } },
    Blob: function (partes) { ctx.__arquivo = partes.join(""); }, URL: { createObjectURL: () => "blob:x", revokeObjectURL() {} },
    setTimeout: () => 0, uiConfirm: () => Promise.resolve(true), location: { reload() {} }, localStorage: { removeItem() {} },
    FileReader: function () { const fr = this; fr.readAsText = (arq) => { fr.result = arq.texto; setImmediate(() => fr.onload()); }; }
  };
  vm.createContext(ctx);
  vm.runInContext(CODIGO, ctx, { filename: "backup-construido.js" });
  return { ctx, pedidos, upserts, msg };
}
async function esperarMsg(A, re) { for (let i = 0; i < 400; i++) { if (re.test(A.msg.textContent)) return true; await new Promise((r) => setImmediate(r)); } return false; }

(async () => {
  console.log("\n=== 1) Baixar backup leva o histórico da Manutenção v2, inteiro ===\n");
  const dados = { perfis: linhas(3), manutencao_equipamentos: linhas(17), manutencao_registros: linhas(2),
    manutencao_rotinas: linhas(3), manutencao_execucoes: linhas(1500), manutencao_execucoes_custos: linhas(40, "execucao_id"),
    manutencao_pendencias: linhas(5), manutencao_anexos: linhas(2), manutencao_auditoria: linhas(2500) };
  const A = ambiente({ dados });
  A.ctx.bkpBaixar();
  vale("mensagem de sucesso", await esperarMsg(A, /Backup baixado/), A.msg.textContent);
  const pacote = JSON.parse(A.ctx.__arquivo || "{}");
  vale("as 6 tabelas novas da Manutenção estão no arquivo", MAN2.every((t) => Array.isArray((pacote.tabelas || {})[t])), MAN2.filter((t) => !(pacote.tabelas || {})[t]).join(", ") || "todas");
  vale("nada cortado no teto de 1000: 2500 da auditoria e 1500 execuções", pacote.tabelas.manutencao_auditoria.length === 2500 && pacote.tabelas.manutencao_execucoes.length === 1500,
    pacote.tabelas.manutencao_auditoria.length + " / " + pacote.tabelas.manutencao_execucoes.length);
  const pagAud = A.pedidos.filter((p) => p.t === "manutencao_auditoria").map((p) => p.ordem + ":" + p.de + "-" + p.ate).join(",");
  vale("lidas em páginas de 1000, na ordem da chave", pagAud === "id:0-999,id:1000-1999,id:2000-2999" && A.pedidos.some((p) => p.t === "manutencao_execucoes_custos" && p.ordem === "execucao_id"), pagAud);
  vale("as tabelas de antes continuam no arquivo como antes", pacote.tabelas.manutencao_registros.length === 2 && pacote.tabelas.perfis.length === 3, "ok");
  vale("total da mensagem conta tudo", /\(4072 registros\)/.test(A.msg.textContent), A.msg.textContent);

  console.log("\n=== 2) Se o histórico não vier, não diz que deu certo ===\n");
  const B = ambiente({ dados, falhar: ["manutencao_auditoria"] });
  B.ctx.bkpBaixar();
  await esperarMsg(B, /Backup baixado/);
  vale("mensagem avisa que o histórico da Manutenção não veio inteiro (e não tem o ✓)", /não veio inteiro \(manutencao_auditoria\)/.test(B.msg.textContent) && !/✓/.test(B.msg.textContent), B.msg.textContent);

  console.log("\n=== 3) Restaurar não grava por cima do histórico ===\n");
  const C = ambiente({});
  const arq = { texto: JSON.stringify({ _painel: "Santa Rita", _versao: 1, _data: "2026-09-15T10:00:00Z", tabelas: { perfis: linhas(2), manutencao_registros: linhas(2), manutencao_execucoes: linhas(7), manutencao_auditoria: linhas(9) } }) };
  C.ctx.bkpRestaurar(arq);
  vale("restauração termina", await esperarMsg(C, /Backup restaurado/), C.msg.textContent);
  const tabs = C.upserts.map((u) => u.t);
  vale("repõe as tabelas de sempre", tabs.indexOf("perfis") >= 0 && tabs.indexOf("manutencao_registros") >= 0, tabs.join(","));
  vale("NÃO faz upsert em nenhuma tabela nova da Manutenção", !tabs.some((t) => MAN2.indexOf(t) >= 0), tabs.join(","));
  vale("avisa que o histórico da Manutenção (16 registros) fica no arquivo e não é restaurado", /histórico da Manutenção — 16 registros — fica no arquivo/.test(C.msg.textContent), C.msg.textContent);

  console.log("\n" + ok + " OK, " + falhou + " falha(s)\n");
  process.exit(falhou ? 1 : 0);
})().catch((e) => { console.log("FALHA | o teste quebrou: " + (e && e.stack || e)); process.exit(1); });
