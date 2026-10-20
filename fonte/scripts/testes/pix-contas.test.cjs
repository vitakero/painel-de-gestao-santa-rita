// ROBÔ DO PIX — DUAS CONTAS (==PIXCONTAS==) e BAIXA SEGURA (==PIXBAIXA==), 20/10/2026.
//
// Galpões cobram pela conta PESSOA FÍSICA do Gilson (bloco SICREDI_PF_* do .env); pontos extras pela
// conta da LOJA (SICREDI_*). Cada cobrança diz a sua na coluna "conta". O risco que este teste cobra:
// boleto de galpão saindo pela conta da loja (ou o contrário), em gerar, cancelar ou conferir o pago.
// E a baixa segura: o robô só marca PAGO quando o banco diz liquidado com data e valor que fazem
// sentido (em 10/2026 três parcelas do ponto 14 apareciam pagas em 27/09/2021 com R$ 80).
//
// RODA o robô de verdade (scripts/pixWorker.cjs, sem mudar uma linha) numa pasta temporária, com um
// Supabase e um Sicredi DE MENTIRA no lugar da internet: nada sai do computador. O Sicredi de mentira
// anota, em cada chamada, QUAL credencial veio (chave, beneficiário, cooperativa, posto).
// Também roda o trecho da RESERVA do robô grande (buildVrData.cjs), que agora só chama o mini-robô.
//   node scripts/testes/pix-contas.test.cjs
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const RAIZ = path.join(__dirname, "..", "..");
const ROBO = path.join(RAIZ, "scripts", "pixWorker.cjs");

let ok = 0, falhou = 0;
function vale(nome, cond, det) { console.log((cond ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + det); cond ? ok++ : falhou++; }

const FALSO = `
const fs=require("fs");
const EST=process.env.MUNDO;
const mundo=JSON.parse(fs.readFileSync(EST,"utf8"));
mundo.log=mundo.log||[]; mundo.chamadas=mundo.chamadas||[];
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
  const sel=p.get("select"); if(sel && sel!=="*"){ const cs=sel.split(","); linhas=linhas.map(r=>Object.fromEntries(cs.filter(c=>c in r).map(c=>[c,r[c]]))); }
  return linhas;
}
global.fetch=async function(url, o){
  o=o||{}; const m=(o.method||"GET").toUpperCase(); const u=new URL(url); const h=o.headers||{};
  if(u.hostname.endsWith("supabase.co")){
    const q=u.search.slice(1);
    mundo.log.push("SUPABASE "+m);
    // nuvem SEM a coluna "conta" (SQL dos galpoes ainda nao rodado): pedir a coluna volta 400
    if(mundo.semColunaConta && /select=[^&]*conta/.test(decodeURIComponent(q))) return resp(400,{message:"column pix_cobrancas.conta does not exist"});
    if(m==="GET") return resp(200, filtra(q));
    if(m==="PATCH"){ const campos=JSON.parse(o.body); const alvo=filtra(q.replace(/(^|&)select=[^&]*/,"")); const ids=new Set(alvo.map(r=>r.id));
      mundo.banco.forEach(r=>{ if(ids.has(r.id)) Object.assign(r,campos); });
      mundo.log.push("PATCH "+[...ids].join(",")+" "+Object.keys(campos).join(","));
      const rep=String(h.Prefer||"").includes("representation");
      return rep ? resp(200, mundo.banco.filter(r=>ids.has(r.id))) : resp(204, null); }
  }
  if(u.hostname==="api-parceiro.sicredi.com.br"){
    const pth=u.pathname, chave=h["x-api-key"];
    if(pth.endsWith("/auth/openapi/token")){
      const corpo=new URLSearchParams(o.body); mundo.chamadas.push({tipo:"login",chave,usuario:corpo.get("username"),senha:corpo.get("password")});
      if((mundo.loginRecusado||[]).includes(chave)) return resp(401,{error:"invalid_grant"});
      return resp(200,{access_token:"tok-"+chave,expires_in:300}); }
    const benefHdr=h.codigoBeneficiario, benefQs=u.searchParams.get("codigoBeneficiario");
    const ch={chave,coop:h.cooperativa,posto:h.posto,token:String(h.Authorization||"").replace("Bearer ","")};
    if(m==="POST" && pth.endsWith("/boletos")){ const c=JSON.parse(o.body); const nn=(chave==="chave-pf"?"7":"9")+c.seuNumero.slice(-6);
      mundo.chamadas.push(Object.assign({tipo:"gerar",benef:c.codigoBeneficiario,pagador:c.pagador,valor:c.valor,seu:c.seuNumero},ch));
      return resp(200,{txid:"tx"+nn,nossoNumero:nn,linhaDigitavel:"L"+nn,codigoBarras:"B"+nn,qrCode:"QR"+nn}); }
    if(m==="PATCH" && pth.endsWith("/baixa")){ mundo.chamadas.push(Object.assign({tipo:"cancelar",benef:benefHdr,nn:pth.split("/").slice(-2)[0]},ch)); return resp(202,{}); }
    if(m==="GET" && pth.endsWith("/boletos")){ const nn=u.searchParams.get("nossoNumero");
      mundo.chamadas.push(Object.assign({tipo:"conferir",benef:benefQs,nn},ch));
      const r=(mundo.respostas||{})[nn]; return resp(200, r || {situacao:"EM CARTEIRA PIX"}); }
  }
  throw new Error("chamada fora do previsto: "+m+" "+url);
};
`;

const ENV_LOJA = ["SICREDI_API_KEY_PROD=chave-loja", "SICREDI_COOPERATIVA=2207", "SICREDI_POSTO=03", "SICREDI_BENEFICIARIO=57653", "SICREDI_API_PASSWORD=senha-loja"];
const ENV_PF = ["SICREDI_PF_API_KEY_PROD=chave-pf", "SICREDI_PF_COOPERATIVA=2207", "SICREDI_PF_POSTO=04", "SICREDI_PF_BENEFICIARIO=29377", "SICREDI_PF_API_PASSWORD=senha-pf"];

function rodar(mundo0, opc) {
  opc = opc || {};
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pix-contas-"));
  fs.mkdirSync(path.join(dir, "scripts")); fs.mkdirSync(path.join(dir, "output"));
  fs.copyFileSync(ROBO, path.join(dir, "scripts", "pixWorker.cjs"));
  const envs = ["SUPABASE_SERVICE_KEY=falsa", "SICREDI_AMBIENTE=" + (opc.ambiente || "producao")].concat(opc.semLoja ? [] : ENV_LOJA, opc.semPf ? [] : ENV_PF);
  fs.writeFileSync(path.join(dir, ".env"), envs.join("\n"));
  fs.writeFileSync(path.join(dir, "falso.cjs"), FALSO);
  const est = path.join(dir, "mundo.json");
  fs.writeFileSync(est, JSON.stringify(mundo0));
  let saida = "";
  const uma = () => { try { fs.rmSync(path.join(dir, "output", "last-pix-start.txt"), { force: true }); fs.rmSync(path.join(dir, "output", "last-pix-concilia.txt"), { force: true });
    saida += execFileSync(process.execPath, ["-r", path.join(dir, "falso.cjs"), path.join(dir, "scripts", "pixWorker.cjs")],
      { env: Object.assign({}, process.env, { MUNDO: est }), encoding: "utf8", timeout: 30000 }); }
    catch (e) { saida += String(e.stdout || "") + String(e.stderr || ""); } };
  for (let i = 0; i < (opc.rodadas || 1); i++) uma();
  const m = JSON.parse(fs.readFileSync(est, "utf8"));
  fs.rmSync(dir, { recursive: true, force: true });
  return { banco: m.banco, log: m.log, chamadas: m.chamadas || [], saida, linha: id => m.banco.find(r => r.id === id) };
}
const cob = (id, status, extra) => Object.assign({ id, status, ponto_id: "pg" + id, parcela_key: "2026-11-05", fornecedor: "PAGADOR " + id,
  documento: "12345678000199", valor: 500, vencimento: "2099-11-05", criado_em: "2026-10-20T12:00:00Z", nosso_numero: null, seu_numero: null, erro_msg: null, qr_code: null }, extra || {});
// datas de pagamento válidas = HOJE (a baixa segura recusa data no futuro)
const _a = new Date(), HOJE = _a.getFullYear() + "-" + String(_a.getMonth() + 1).padStart(2, "0") + "-" + String(_a.getDate()).padStart(2, "0");
const pago = (data, valor, sit) => ({ situacao: sit || "LIQUIDADO PIX", valorNominal: 500, dadosLiquidacao: { data, valor, multa: 0, juros: 0, desconto: 0, abatimento: 0 } });

(async () => {
  console.log("\n  ==== GERAR: cada cobrança pela SUA conta ====");
  {
    const r = rodar({ banco: [cob(1, "pedido", { conta: "pf", ponto_id: "gmumq1", documento: "05628483478", fornecedor: "ADRIANO LIMA" }), cob(2, "pedido", { conta: "loja" }), cob(3, "pedido")] });
    const g = id => r.chamadas.find(c => c.tipo === "gerar" && c.seu === String(id).padStart(10, "0"));
    const g1 = g(1), g2 = g(2), g3 = g(3);
    vale("galpão (conta pf): gerado pela credencial da conta PF", g1 && g1.chave === "chave-pf" && g1.benef === "29377" && g1.coop === "2207" && g1.posto === "04" && g1.token === "tok-chave-pf", g1 ? g1.chave + " / benef " + g1.benef + " / posto " + g1.posto : "não gerou");
    vale("galpão: pagador é o inquilino (CPF, pessoa física)", g1 && g1.pagador.documento === "05628483478" && g1.pagador.tipoPessoa === "PESSOA_FISICA" && g1.pagador.nome === "ADRIANO LIMA", g1 ? JSON.stringify(g1.pagador) : "-");
    vale("ponto (conta loja): gerado pela credencial da LOJA", g2 && g2.chave === "chave-loja" && g2.benef === "57653" && g2.posto === "03", g2 ? g2.chave + " / benef " + g2.benef : "não gerou");
    vale("cobrança antiga SEM a coluna conta: conta da LOJA, como sempre foi", g3 && g3.chave === "chave-loja" && g3.benef === "57653", g3 ? g3.chave : "não gerou");
    vale("as três ficaram 'gerado' com o nosso número do banco certo", r.linha(1).status === "gerado" && /^7/.test(r.linha(1).nosso_numero) && r.linha(2).status === "gerado" && /^9/.test(r.linha(2).nosso_numero), r.banco.map(x => x.id + ":" + x.status + ":" + x.nosso_numero).join(" "));
    const logins = r.chamadas.filter(c => c.tipo === "login");
    vale("login da PF com usuário 29377+2207 e a senha da PF", logins.some(l => l.chave === "chave-pf" && l.usuario === "293772207" && l.senha === "senha-pf"), logins.map(l => l.chave + "=" + l.usuario).join(", "));
    vale("login da loja com usuário 57653+2207 e a senha da loja", logins.some(l => l.chave === "chave-loja" && l.usuario === "576532207" && l.senha === "senha-loja"), "");
  }

  console.log("\n  ==== CONTA PF NÃO CONFIGURADA NO COMPUTADOR DA LOJA ====");
  {
    const r = rodar({ banco: [cob(1, "pedido", { conta: "pf" }), cob(2, "pedido", { conta: "loja" })] }, { semPf: true });
    vale("pedido de galpão vira ERRO explicando, sem ir ao banco", r.linha(1).status === "erro" && /pessoa fisica/.test(r.linha(1).erro_msg) && /Nada foi enviado/.test(r.linha(1).erro_msg), r.linha(1).status + " — " + String(r.linha(1).erro_msg).slice(0, 70));
    vale("NENHUMA chamada ao Sicredi com credencial da loja para o galpão", !r.chamadas.some(c => c.tipo === "gerar" && c.seu === "0000000001"), r.chamadas.filter(c => c.tipo === "gerar").map(c => c.seu).join(","));
    vale("o ponto extra (loja) na mesma rodada é gerado normal", r.linha(2).status === "gerado", r.linha(2).status);
  }
  {
    const r = rodar({ banco: [cob(1, "pedido", { conta: "xyz" })] });
    vale("conta desconhecida: erro, nada enviado ao banco", r.linha(1).status === "erro" && /desconhecida/.test(r.linha(1).erro_msg) && !r.chamadas.some(c => c.tipo === "gerar"), r.linha(1).erro_msg);
  }

  console.log("\n  ==== CANCELAR: baixa na conta certa ====");
  {
    const r = rodar({ banco: [cob(1, "cancelar", { conta: "pf", nosso_numero: "7000001" }), cob(2, "cancelar", { conta: "loja", nosso_numero: "9000002" })] });
    const c1 = r.chamadas.find(c => c.tipo === "cancelar" && c.nn === "7000001"), c2 = r.chamadas.find(c => c.tipo === "cancelar" && c.nn === "9000002");
    vale("cancelamento do galpão pela conta PF", c1 && c1.chave === "chave-pf" && c1.benef === "29377", c1 ? c1.chave + "/" + c1.benef : "não chamou");
    vale("cancelamento do ponto pela conta da loja", c2 && c2.chave === "chave-loja" && c2.benef === "57653", c2 ? c2.chave + "/" + c2.benef : "não chamou");
    vale("os dois ficaram cancelados", r.linha(1).status === "cancelado" && r.linha(2).status === "cancelado", r.banco.map(x => x.status).join(","));
  }
  {
    const r = rodar({ banco: [cob(1, "cancelar", { conta: "pf", nosso_numero: "7000001" })] }, { semPf: true });
    vale("sem credencial PF: cancelamento espera (não vai pela loja)", r.linha(1).status === "cancelar" && !r.chamadas.some(c => c.tipo === "cancelar"), r.linha(1).status);
  }

  console.log("\n  ==== CONFERIR O PAGO: na conta certa ====");
  {
    const r = rodar({ banco: [cob(1, "gerado", { conta: "pf", nosso_numero: "7000001" }), cob(2, "gerado", { conta: "loja", nosso_numero: "9000002" })],
      respostas: { "7000001": pago(HOJE + "T10:00:00-03:00", 500), "9000002": pago(HOJE + "T10:00:00-03:00", 500, "LIQUIDADO COMPE") } });
    const q1 = r.chamadas.find(c => c.tipo === "conferir" && c.nn === "7000001"), q2 = r.chamadas.find(c => c.tipo === "conferir" && c.nn === "9000002");
    vale("pagamento do galpão conferido na conta PF", q1 && q1.chave === "chave-pf" && q1.benef === "29377", q1 ? q1.chave + "/" + q1.benef : "-");
    vale("pagamento do ponto conferido na conta da loja", q2 && q2.chave === "chave-loja" && q2.benef === "57653", q2 ? q2.chave + "/" + q2.benef : "-");
    vale("os dois foram baixados com data, valor e tipo", r.linha(1).status === "pago" && r.linha(1).pago_em === HOJE && r.linha(1).valor_liquidado === 500 && r.linha(2).tipo_liquidacao === "COMPE",
      r.banco.map(x => x.id + ":" + x.status + ":" + x.pago_em + ":" + x.valor_liquidado + ":" + x.tipo_liquidacao).join(" "));
  }

  console.log("\n  ==== BAIXA SEGURA (==PIXBAIXA==) ====");
  {
    const r = rodar({ banco: [cob(1, "gerado", { conta: "loja", nosso_numero: "9000001", criado_em: "2026-08-17T14:00:00Z" })],
      respostas: { "9000001": pago("2021-09-27", 80, "LIQUIDADO") } }, { rodadas: 3 });
    vale("o caso do ponto 14 (27/09/2021, R$ 80): NÃO marca pago", r.linha(1).status === "gerado" && r.linha(1).pago_em == null, r.linha(1).status);
    vale("anota o motivo em erro_msg", /antes de a cobranca existir/.test(r.linha(1).erro_msg || ""), String(r.linha(1).erro_msg).slice(0, 80));
    const patches = r.log.filter(l => l.startsWith("PATCH 1 "));
    vale("em 3 rodadas grava o motivo UMA vez só (não fica regravando)", patches.length === 1, patches.length + " gravação(ões)");
  }
  {
    const r = rodar({ banco: [cob(1, "gerado", { nosso_numero: "9000001" }), cob(2, "gerado", { nosso_numero: "9000002" }), cob(3, "gerado", { nosso_numero: "9000003" }), cob(4, "gerado", { nosso_numero: "9000004" })],
      respostas: { "9000001": pago(HOJE, 300, "LIQUIDADO COMPE"), "9000002": { situacao: "EM CARTEIRA PIX", valorNominal: 500, dadosLiquidacao: { data: HOJE, valor: 500 } },
        "9000003": pago(HOJE + "T09:00:00-03:00", 512.5, "LIQUIDADO COMPE"), "9000004": pago("2099-01-01", 500) } });
    vale("pago a menos (R$ 300 de R$ 500): não marca", r.linha(1).status === "gerado" && /menor/.test(r.linha(1).erro_msg || ""), r.linha(1).status + " — " + String(r.linha(1).erro_msg).slice(0, 60));
    vale("dados de pagamento sem 'liquidado': não marca", r.linha(2).status === "gerado" && /nao diz liquidado/.test(r.linha(2).erro_msg || ""), r.linha(2).status);
    vale("pago com juros e multa (R$ 512,50): marca pago", r.linha(3).status === "pago" && r.linha(3).valor_liquidado === 512.5, r.linha(3).status + " " + r.linha(3).valor_liquidado);
    vale("data no futuro: não marca", r.linha(4).status === "gerado" && /futuro/.test(r.linha(4).erro_msg || ""), r.linha(4).status);
  }
  {
    const r = rodar({ banco: [cob(1, "pedido"), cob(2, "gerado", { nosso_numero: "9000002" }), cob(3, "cancelar", { nosso_numero: "9000003" })],
      respostas: { "9000002": pago(HOJE, 500) } }, { ambiente: "sandbox" });
    vale("modo de TESTE do Sicredi: não toca nas cobranças de verdade", r.chamadas.length === 0 && !r.log.some(l => l.startsWith("SUPABASE")) && r.linha(1).status === "pedido" && r.linha(2).status === "gerado" && r.linha(3).status === "cancelar",
      r.chamadas.length + " chamada(s) ao banco, " + r.log.length + " à nuvem");
  }

  console.log("\n  ==== LOGIN DA PF RECUSADO: não martela o banco e a loja segue ====");
  {
    const r = rodar({ banco: [cob(1, "gerado", { conta: "pf", nosso_numero: "7000001" }), cob(2, "gerado", { conta: "pf", nosso_numero: "7000002" }), cob(3, "gerado", { conta: "pf", nosso_numero: "7000003" }),
      cob(4, "pedido", { conta: "pf" }), cob(5, "pedido", { conta: "loja" })], loginRecusado: ["chave-pf"] });
    const tentativas = r.chamadas.filter(c => c.tipo === "login" && c.chave === "chave-pf").length;
    vale("uma tentativa de login da PF por rodada (não uma por boleto)", tentativas === 1, tentativas + " tentativa(s)");
    vale("o pedido do galpão continua 'pedido' (tenta na próxima rodada)", r.linha(4).status === "pedido", r.linha(4).status);
    vale("o ponto extra da loja foi gerado normal", r.linha(5).status === "gerado", r.linha(5).status);
  }

  console.log("\n  ==== NUVEM AINDA SEM A COLUNA 'conta' (antes do SQL) ====");
  {
    const r = rodar({ banco: [cob(1, "gerado", { nosso_numero: "9000001" }), cob(2, "pedido")], semColunaConta: true, respostas: { "9000001": pago(HOJE, 500) } });
    vale("a conferência do pago tenta de novo sem a coluna e funciona", r.linha(1).status === "pago", r.linha(1).status);
    vale("o pedido sai pela loja como antes", r.linha(2).status === "gerado" && r.chamadas.some(c => c.tipo === "gerar" && c.chave === "chave-loja"), r.linha(2).status);
  }

  console.log("\n  ==== RESERVA DO ROBÔ GRANDE: roda o MESMO mini-robô ====");
  {
    const B = fs.readFileSync(path.join(RAIZ, "scripts", "buildVrData.cjs"), "utf8");
    const ini = B.indexOf("  // ---- WORKER PIX (Sicredi), RESERVA"), fim = B.indexOf("robo segue normal, tenta na proxima.\"); }", ini);
    vale("o robô grande não tem mais uma cópia do código do Pix", ini > 0 && !/cobranca\/boleto\/v1/.test(B) && !/PIX_AUTH_BODY|pixToken/.test(B), ini > 0 ? "só a chamada" : "bloco não achado");
    const trecho = B.slice(ini, B.indexOf("\n", fim));
    for (const [rot, idadeTrava, espera] of [["mini-robô parado há 5 min", 5 * 60 * 1000, true], ["mini-robô rodou há 10 s", 10 * 1000, false]]) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pix-reserva-"));
      fs.mkdirSync(path.join(dir, "scripts")); fs.mkdirSync(path.join(dir, "output"));
      fs.writeFileSync(path.join(dir, "scripts", "pixWorker.cjs"), "require('fs').writeFileSync(require('path').join(__dirname,'rodou.txt'),'sim');");
      fs.writeFileSync(path.join(dir, "output", "last-pix-start.txt"), String(Date.now() - idadeTrava));
      const f = new Function("fs", "path", "__dirname", "require", "console", trecho);
      f(fs, path, path.join(dir, "scripts"), require, { log() {} });
      const rodou = fs.existsSync(path.join(dir, "scripts", "rodou.txt"));
      vale("reserva — " + rot + ": " + (espera ? "roda o mini-robô" : "não roda"), rodou === espera, rodou ? "rodou" : "não rodou");
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  console.log("\n  " + ok + " ok, " + falhou + " falha(s).\n");
  process.exit(falhou ? 1 : 0);
})();
