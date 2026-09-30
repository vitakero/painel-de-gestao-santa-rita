// ROBÔ DO PIX — uma pergunta por rodada em vez de três (30/09/2026).
//
// O pixWorker.cjs roda na loja a cada ~9 s, o dia inteiro. Ele perguntava ao Supabase três
// coisas separadas em TODA rodada (presas em "gerando", cancelamentos, pedidos), mesmo sem
// nada pra fazer: ~1.300 pedidos/hora na conta de "registros" que estourou 6x o limite.
// Agora é uma pergunta só, e a resposta é separada nas três filas.
//
// Este teste RODA o robô de verdade (o arquivo scripts/pixWorker.cjs, sem mudar uma linha),
// numa pasta temporária, com um Supabase e um Sicredi DE MENTIRA no lugar da internet: nada
// sai do computador. Cobra, em cada situação:
//   · o que acontece com cada cobrança (gerar, cancelar, recuperar presa, dar baixa no pago);
//   · quantas perguntas o robô fez ao Supabase.
// Com ANTES=<caminho de uma versão antiga do pixWorker.cjs>, roda as duas lado a lado e cobra
// que o resultado de cada cobrança e as chamadas ao Sicredi sejam IDÊNTICOS.
//   node scripts/testes/pix-robo-fila.test.cjs
//   ANTES=/caminho/pixWorker.antes.cjs node scripts/testes/pix-robo-fila.test.cjs
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const RAIZ = path.join(__dirname, "..", "..");
const ATUAL = path.join(RAIZ, "scripts", "pixWorker.cjs");
const ANTES = process.env.ANTES || "";

let ok = 0, falhou = 0;
function vale(nome, cond, det) { console.log((cond ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + det); cond ? ok++ : falhou++; }

// ---- a internet de mentira: carregada ANTES do robô (node -r), troca o fetch global ----
const FALSO = `
const fs=require("fs");
const EST=process.env.MUNDO;
const mundo=JSON.parse(fs.readFileSync(EST,"utf8"));
mundo.log=mundo.log||[];
function salva(){ fs.writeFileSync(EST, JSON.stringify(mundo)); }
process.on("exit", salva);
function resp(status, corpo){ const t=corpo==null?"":(typeof corpo==="string"?corpo:JSON.stringify(corpo));
  return { ok:status>=200&&status<300, status, text:async()=>t, json:async()=>JSON.parse(t||"null") }; }
function filtra(q){
  const p=new URLSearchParams(q); let linhas=mundo.banco.slice();
  for(const [k,v] of p){
    if(["select","order","limit"].includes(k)) continue;
    const [op,...resto]=v.split("."); const val=resto.join(".");
    if(op==="eq") linhas=linhas.filter(r=>String(r[k])===val);
    else if(op==="in") { const set=val.replace(/^\\(|\\)$/g,"").split(","); linhas=linhas.filter(r=>set.includes(String(r[k]))); }
    else if(op==="not" && val==="is.null") linhas=linhas.filter(r=>r[k]!=null);
    else throw new Error("filtro nao previsto: "+k+"="+v);
  }
  if(p.get("order")==="id") linhas.sort((a,b)=>a.id-b.id);
  if(p.get("limit")) linhas=linhas.slice(0,+p.get("limit"));
  const sel=p.get("select"); if(sel && sel!=="*"){ const cs=sel.split(","); linhas=linhas.map(r=>Object.fromEntries(cs.map(c=>[c,r[c]]))); }
  return linhas;
}
global.fetch=async function(url, o){
  o=o||{}; const m=(o.method||"GET").toUpperCase(); const u=new URL(url);
  if(u.hostname.endsWith("supabase.co")){
    const q=u.search.slice(1);
    mundo.log.push("SUPABASE "+m);
    if(m==="GET") return resp(200, filtra(q));
    if(m==="PATCH"){ const campos=JSON.parse(o.body); const alvo=filtra(q.replace(/(^|&)select=[^&]*/,"")); const ids=new Set(alvo.map(r=>r.id));
      mundo.banco.forEach(r=>{ if(ids.has(r.id)) Object.assign(r,campos); });
      const rep=String((o.headers||{}).Prefer||"").includes("representation");
      return rep ? resp(200, mundo.banco.filter(r=>ids.has(r.id))) : resp(204, null); }
  }
  if(u.hostname==="api-parceiro.sicredi.com.br"){
    const pth=u.pathname; mundo.log.push("SICREDI "+m+" "+pth.replace(/\\/\\d+\\//,"/N/")+(u.searchParams.get("nossoNumero")?" nn="+u.searchParams.get("nossoNumero"):""));
    if(pth.endsWith("/auth/openapi/token")) return resp(200,{access_token:"tok",expires_in:300});
    if(m==="POST" && pth.endsWith("/boletos")){ const c=JSON.parse(o.body); const nn="9"+c.seuNumero.slice(-6);
      return resp(200,{txid:"tx"+nn,nossoNumero:nn,linhaDigitavel:"L"+nn,codigoBarras:"B"+nn,qrCode:"QR"+nn}); }
    if(m==="PATCH" && pth.endsWith("/baixa")) return resp(202,{});
    if(m==="GET" && pth.endsWith("/boletos")){ const nn=u.searchParams.get("nossoNumero");
      return (mundo.pagos||[]).includes(nn) ? resp(200,{situacao:"LIQUIDADO PIX",dadosLiquidacao:{data:"2026-09-30",valor:810.5}}) : resp(200,{situacao:"EM ABERTO"}); }
  }
  throw new Error("chamada fora do previsto: "+m+" "+url);
};
`;

function rodar(arquivoRobo, banco, pagos) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pix-robo-"));
  fs.mkdirSync(path.join(dir, "scripts")); fs.mkdirSync(path.join(dir, "output"));
  fs.copyFileSync(arquivoRobo, path.join(dir, "scripts", "pixWorker.cjs"));
  fs.writeFileSync(path.join(dir, ".env"), ["SUPABASE_SERVICE_KEY=falsa", "SICREDI_AMBIENTE=producao", "SICREDI_API_KEY_PROD=falsa",
    "SICREDI_COOPERATIVA=0000", "SICREDI_POSTO=00", "SICREDI_BENEFICIARIO=11111", "SICREDI_API_PASSWORD=falsa"].join("\n"));
  fs.writeFileSync(path.join(dir, "falso.cjs"), FALSO);
  const est = path.join(dir, "mundo.json");
  fs.writeFileSync(est, JSON.stringify({ banco, pagos }));
  let saida = "";
  try { saida = execFileSync(process.execPath, ["-r", path.join(dir, "falso.cjs"), path.join(dir, "scripts", "pixWorker.cjs")],
    { env: Object.assign({}, process.env, { MUNDO: est }), encoding: "utf8", timeout: 30000 }); }
  catch (e) { saida = String(e.stdout || "") + String(e.stderr || ""); }
  const m = JSON.parse(fs.readFileSync(est, "utf8"));
  fs.rmSync(dir, { recursive: true, force: true });
  return { banco: m.banco, log: m.log, saida,
    perguntas: m.log.filter(l => l === "SUPABASE GET").length,
    sicredi: m.log.filter(l => l.startsWith("SICREDI")) };
}

const cob = (id, status, extra) => Object.assign({ id, status, ponto_id: "pg" + id, parcela_key: "2026-10-05", fornecedor: "FORNECEDOR " + id,
  documento: "12345678000199", valor: 300, vencimento: "2026-10-05", nosso_numero: null, seu_numero: null, erro_msg: null, qr_code: null }, extra || {});

const SITUACOES = [
  { nome: "nada acontecendo (só cobranças já geradas, ninguém pagou)",
    banco: [cob(1, "gerado", { nosso_numero: "900001" }), cob(2, "pago", { nosso_numero: "900002" }), cob(3, "cancelado")], pagos: [] },
  { nome: "alguém pagou",
    banco: [cob(1, "gerado", { nosso_numero: "900001" }), cob(4, "gerado", { nosso_numero: "900004" })], pagos: ["900004"] },
  { nome: "pedido novo de Pix (clicaram em Gerar Pix)",
    banco: [cob(5, "pedido"), cob(1, "gerado", { nosso_numero: "900001" })], pagos: [] },
  { nome: "pedido com CNPJ inválido",
    banco: [cob(6, "pedido", { documento: "123" })], pagos: [] },
  { nome: "cancelamento pedido no painel",
    banco: [cob(7, "cancelar", { nosso_numero: "900007" }), cob(8, "cancelar")], pagos: [] },
  { nome: "cobrança presa em 'gerando' (a rodada anterior caiu)",
    banco: [cob(9, "gerando", { seu_numero: "0000000009" })], pagos: [] },
  { nome: "tudo junto (presa, cancelamento, 2 pedidos, 1 pago)",
    banco: [cob(10, "gerando", { seu_numero: "0000000010" }), cob(11, "cancelar", { nosso_numero: "900011" }), cob(12, "pedido"), cob(13, "pedido"),
            cob(14, "gerado", { nosso_numero: "900014" }), cob(15, "erro", { nosso_numero: "900015" })], pagos: ["900014"] },
  { nome: "30 pedidos de uma vez (o limite de 25 por rodada continua)",
    banco: Array.from({ length: 30 }, (_, i) => cob(100 + i, "pedido")), pagos: [] },
];

const esperado = {
  0: b => b.find(r => r.id === 1).status === "gerado",
  1: b => b.find(r => r.id === 4).status === "pago" && b.find(r => r.id === 1).status === "gerado",
  2: b => b.find(r => r.id === 5).status === "gerado" && !!b.find(r => r.id === 5).qr_code,
  3: b => b.find(r => r.id === 6).status === "erro",
  4: b => b.find(r => r.id === 7).status === "cancelado" && b.find(r => r.id === 8).status === "cancelado",
  5: b => b.find(r => r.id === 9).status === "erro",
  6: b => ["erro", "cancelado", "gerado", "gerado", "pago", "erro"].every((st, i) => b.find(r => r.id === 10 + i).status === st),
  7: b => b.filter(r => r.status === "gerado").length === 25 && b.filter(r => r.status === "pedido").length === 5,
};

SITUACOES.forEach((s, i) => {
  console.log("\n  ==== " + (i + 1) + ". " + s.nome.toUpperCase() + " ====");
  const novo = rodar(ATUAL, JSON.parse(JSON.stringify(s.banco)), s.pagos);
  vale("o robô termina a rodada sem erro", /rodada expressa ok/.test(novo.saida), (novo.saida.trim().split("\n").pop() || "").slice(0, 90));
  vale("cada cobrança termina como deve", esperado[i](novo.banco), novo.banco.map(r => r.id + ":" + r.status).join(" "));
  vale("2 perguntas ao Supabase na rodada (a fila + a conferência de quem pagou)", novo.perguntas === 2, novo.perguntas + " perguntas");
  if (ANTES) {
    const velho = rodar(ANTES, JSON.parse(JSON.stringify(s.banco)), s.pagos);
    const limpa = b => JSON.stringify(b.slice().sort((a, c) => a.id - c.id));
    vale("IGUAL à versão antiga: cada cobrança termina idêntica", limpa(novo.banco) === limpa(velho.banco), limpa(novo.banco) === limpa(velho.banco) ? "idênticas" : "DIFERENTES");
    vale("IGUAL à versão antiga: as mesmas chamadas ao Sicredi, na mesma ordem", JSON.stringify(novo.sicredi) === JSON.stringify(velho.sicredi), novo.sicredi.length + " chamadas");
    vale("a versão antiga fazia 4 perguntas; a nova faz 2", velho.perguntas === 4 && novo.perguntas === 2, velho.perguntas + " -> " + novo.perguntas);
  }
});

console.log("\n  " + ok + " ok, " + falhou + " falha(s).\n");
process.exit(falhou ? 1 : 0);
