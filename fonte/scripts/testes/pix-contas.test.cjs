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
// relógio parado (mundo.agora): "new Date()" e "Date.now()" do robô devolvem essa hora (o fuso vem do TZ do processo)
if(mundo.agora){ const T=Date.parse(mundo.agora), D0=Date; global.Date=class extends D0{ constructor(...a){ if(a.length) super(...a); else super(T); } static now(){ return T; } }; }
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
    else if(op==="is" && val==="null") linhas=linhas.filter(r=>r[k]==null);
    else if(op==="gte") linhas=linhas.filter(r=>r[k]!=null && String(r[k])>=val);
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
    if(mundo.semColunasAviso && /aviso_pagamento|liquidacao_conferida|pagamento_falhou/.test(decodeURIComponent(q))) return resp(400,{message:"column pix_cobrancas.aviso_pagamento_em does not exist"});
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
      mundo.chamadas.push(Object.assign({tipo:"gerar",benef:c.codigoBeneficiario,pagador:c.pagador,valor:c.valor,seu:c.seuNumero,corpo:c},ch));
      return resp(200,{txid:"tx"+nn,nossoNumero:nn,linhaDigitavel:"L"+nn,codigoBarras:"B"+nn,qrCode:"QR"+nn}); }
    if(m==="PATCH" && pth.endsWith("/baixa")){ mundo.chamadas.push(Object.assign({tipo:"cancelar",benef:benefHdr,nn:pth.split("/").slice(-2)[0]},ch)); return resp(202,{}); }
    if(m==="GET" && pth.endsWith("/boletos/liquidados/dia")){ const dia=u.searchParams.get("dia");
      mundo.chamadas.push(Object.assign({tipo:"liquidados",benef:benefQs,dia,pagina:u.searchParams.get("pagina")},ch));
      const l=((mundo.liquidados||{})[chave]||{})[dia]; return resp(200, l || {items:[],hasNext:false}); }
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
      { env: Object.assign({}, process.env, { MUNDO: est, TZ: "America/Fortaleza" }), encoding: "utf8", timeout: 30000 }); }
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

  console.log("\n  ==== MULTA E JUROS NO BOLETO (==GLENCARGOS==) ====");
  {
    const GALP = { conta: "pf", ponto_id: "gmumq1", documento: "05628483478", fornecedor: "ADRIANO LIMA", valor: 810.5 };
    const r = rodar({ banco: [
      cob(1, "pedido", Object.assign({}, GALP, { multa_pct: 2, juros_dia: 0.27 })),          // galpão com a chave ligada
      cob(2, "pedido", { conta: "loja", multa_pct: 2, juros_dia: 0.17 }),                    // ponto extra com valores forçados
      cob(3, "pedido", Object.assign({}, GALP, { ponto_id: "g3", multa_pct: null, juros_dia: null })),
      cob(4, "pedido", Object.assign({}, GALP, { ponto_id: "g4", multa_pct: "", juros_dia: 0 })),
      cob(5, "pedido", Object.assign({}, GALP, { ponto_id: "g5" })),                         // nuvem ainda sem as colunas
      cob(6, "pedido", Object.assign({}, GALP, { ponto_id: "g6", multa_pct: 5, juros_dia: 0.27 })),
      cob(7, "pedido", Object.assign({}, GALP, { ponto_id: "g7", multa_pct: 2, juros_dia: 1 })),
    ] });
    const g = id => r.chamadas.find(c => c.tipo === "gerar" && c.seu === String(id).padStart(10, "0"));
    const k = id => g(id) ? Object.keys(g(id).corpo).sort().join(",") : "não gerou";
    vale("galpão com a chave ligada: multa 2% (PERCENTUAL) e juros R$ 0,27 por dia (VALOR)", g(1) && g(1).corpo.tipoMulta === "PERCENTUAL" && g(1).corpo.multa === 2 && g(1).corpo.tipoJuros === "VALOR" && g(1).corpo.juros === 0.27 && r.linha(1).status === "gerado", g(1) ? JSON.stringify({ tm: g(1).corpo.tipoMulta, m: g(1).corpo.multa, tj: g(1).corpo.tipoJuros, j: g(1).corpo.juros }) : "não gerou");
    vale("ponto extra (conta da loja) com valores forçados na linha: boleto SEM multa e SEM juros", g(2) && !("multa" in g(2).corpo) && !("juros" in g(2).corpo) && !("tipoJuros" in g(2).corpo) && !("tipoMulta" in g(2).corpo), k(2));
    vale("galpão com multa/juros nulos, em branco ou zero: sem encargos (branco não é zero)", g(3) && g(4) && !("multa" in g(3).corpo) && !("juros" in g(3).corpo) && !("multa" in g(4).corpo) && !("juros" in g(4).corpo), k(3) + " | " + k(4));
    vale("nuvem sem as colunas novas: boleto sai como hoje, sem encargos", g(5) && !("multa" in g(5).corpo), k(5));
    vale("multa acima de 2%: vira ERRO e nada vai ao banco", r.linha(6).status === "erro" && /acima do contrato/.test(r.linha(6).erro_msg) && !g(6), String(r.linha(6).erro_msg).slice(0, 80));
    vale("juros acima de 1% ao mês (R$ 1 por dia em R$ 810,50): vira ERRO e nada vai ao banco", r.linha(7).status === "erro" && !g(7), String(r.linha(7).erro_msg).slice(0, 80));
    const PERMITIDAS = new Set(["tipoCobranca", "codigoBeneficiario", "pagador", "especieDocumento", "seuNumero", "dataVencimento", "valor", "validadeAposVencimento", "tipoMulta", "multa", "tipoJuros", "juros"]);
    const todas = r.chamadas.filter(c => c.tipo === "gerar").flatMap(c => Object.keys(c.corpo));
    vale("nenhum boleto leva data de carência (ela tira o QR do Pix) nem campo fora da lista", todas.length > 0 && todas.every(x => PERMITIDAS.has(x)) && !todas.some(x => /^data.*(juros|multa)/i.test(x)), [...new Set(todas)].filter(x => !PERMITIDAS.has(x)).join(",") || "só os permitidos");
    vale("o registro da rodada diz a multa e os juros do boleto", /multa 2% e juros R\$ 0\.27\/dia/.test(r.saida), (r.saida.match(/GERADO[^\n]*multa[^\n]*/) || ["nada"])[0]);
    const sql = fs.readFileSync(path.join(__dirname, "..", "..", "sql", "galpoes_encargos_boleto_auto.sql"), "utf8");
    const robo = fs.readFileSync(ROBO, "utf8");
    // os juros que o BANCO grava (numeric exato: floor(centavos/3000)/100) o robô tem que aceitar, em todo valor
    const fonte = robo.slice(robo.indexOf("function pixEncargos("), robo.indexOf("function pixDecideBaixa("));
    const pixEncargos = new Function(fonte + "\nreturn pixEncargos;")();
    let recusados = [];
    for (let cent = 1; cent <= 2000000; cent++) { const j = Math.floor(cent / 3000) / 100; if (j <= 0) continue;
      const e = pixEncargos({ valor: cent / 100, multa_pct: 2, juros_dia: j }, { nome: "pf" }); if (!e || e.erro || e.juros !== j) { recusados.push(cent / 100); if (recusados.length > 5) break; } }
    vale("de R$ 0,01 a R$ 20.000: o robô aceita exatamente os juros que o banco calcula (inclusive R$ 810,00, 1.620,00, 2.370,00)", recusados.length === 0, recusados.length ? "recusou " + recusados.join(", ") : "nenhum recusado");
    vale("e recusa 1 centavo acima do teto (R$ 0,28 em R$ 810,00)", !!(pixEncargos({ valor: 810, multa_pct: 2, juros_dia: 0.28 }, { nome: "pf" }) || {}).erro, "recusado");
    vale("o robô e o SQL usam os MESMOS nomes de coluna (multa_pct, juros_dia)", ["multa_pct", "juros_dia"].every(n => sql.includes("add column if not exists " + n) && robo.includes("row." + n)), "multa_pct, juros_dia");
  }

  console.log("\n  ==== ==PIXAVISO== BOLETO PAGO PELA LINHA DIGITÁVEL: aviso, não compensou e estorno (21/10) ====");
  {
    const br = d => d.split("-").reverse().join("/");
    const AGORA_F = "2026-10-22T14:00:00-03:00", HOJE = "2026-10-22", ONTEM = "2026-10-21";
    const diaMenos = (n) => { const d = new Date(Date.UTC(2026, 9, 22, 12)); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
    const uteisAtras = (n) => n === 5 ? "2026-10-15" : diaMenos(n);
    const r = rodar({ agora: AGORA_F,
      banco: [
        cob(1, "gerado", { conta: "pf", nosso_numero: "7000001" }),                       // pago na linha digitável hoje: aviso
        cob(2, "gerado", { conta: "pf", nosso_numero: "7000002" }),                       // aparece na lista mas já como COMPE (não é aviso)
        cob(3, "gerado", { conta: "pf", nosso_numero: "7000003", aviso_pagamento_em: uteisAtras(5) + "T15:00:00Z", aviso_pagamento_data: uteisAtras(5) }),   // não compensou
        cob(4, "gerado", { conta: "pf", nosso_numero: "7000004", aviso_pagamento_em: diaMenos(1) + "T15:00:00Z", aviso_pagamento_data: diaMenos(1) }),        // ainda dentro do prazo
        cob(5, "pago", { conta: "pf", nosso_numero: "7000005", tipo_liquidacao: "REDE", pago_em: ONTEM, valor_liquidado: 500 }),   // REDE de ontem que continua liquidado
        cob(6, "pago", { conta: "pf", nosso_numero: "7000006", tipo_liquidacao: "REDE", pago_em: ONTEM, valor_liquidado: 500 }),   // REDE de ontem ESTORNADO
        cob(7, "pago", { conta: "pf", nosso_numero: "7000007", tipo_liquidacao: "REDE", pago_em: HOJE, valor_liquidado: 500 }),    // REDE de hoje: espera o dia seguinte
        cob(8, "pago", { conta: "pf", nosso_numero: "7000008", tipo_liquidacao: "PIX", pago_em: ONTEM, valor_liquidado: 500 }),    // Pix: não precisa conferir
        cob(9, "gerado", { conta: "loja", nosso_numero: "9000009" }),                     // ponto extra (conta da loja) com aviso
      ],
      liquidados: {
        "chave-pf": { [br(HOJE)]: { items: [ { nossoNumero: "7000001", tipoLiquidacao: "AVISO DE PAGAMENTO COMPE", valorLiquidado: 500, dataPagamento: HOJE }, { nossoNumero: "7000002", tipoLiquidacao: "COMPE", valorLiquidado: 500, dataPagamento: HOJE } ], hasNext: false } },
        "chave-loja": { [br(HOJE)]: { items: [ { nossoNumero: "9000009", tipoLiquidacao: "AVISO DE PAGAMENTO REDE", valorLiquidado: 500, dataPagamento: HOJE } ], hasNext: false } },
      },
      respostas: { "7000003": { situacao: "EM CARTEIRA PIX" }, "7000005": pago(ONTEM, 500, "LIQUIDADO REDE"), "7000006": { situacao: "EM CARTEIRA PIX" } },
    });
    const L = r.linha;
    vale("aviso de pagamento pela linha digitável: anota na hora (em compensação), sem marcar pago", !!L(1).aviso_pagamento_em && L(1).aviso_pagamento_tipo === "AVISO DE PAGAMENTO COMPE" && L(1).aviso_pagamento_valor === 500 && L(1).aviso_pagamento_data === HOJE && L(1).status === "gerado", JSON.stringify({ t: L(1).aviso_pagamento_tipo, s: L(1).status }));
    vale("item da lista que já é liquidação (COMPE) não vira aviso", !L(2).aviso_pagamento_em, String(L(2).aviso_pagamento_em));
    vale("a lista é pedida pela conta certa (PF para galpão, loja para ponto) e o ponto também ganha o aviso", r.chamadas.some(c => c.tipo === "liquidados" && c.chave === "chave-pf" && c.benef === "29377") && r.chamadas.some(c => c.tipo === "liquidados" && c.chave === "chave-loja" && c.benef === "57653") && !!L(9).aviso_pagamento_em, r.chamadas.filter(c => c.tipo === "liquidados").map(c => c.chave + " " + c.dia).join(", "));
    vale("aviso de 15/10 e o banco ainda não liquidou em 22/10: 'não compensou' (pagamento_falhou_em + motivo)", !!L(3).pagamento_falhou_em && /nao foi compensado/.test(L(3).pagamento_falhou_motivo) && L(3).status === "gerado", String(L(3).pagamento_falhou_motivo).slice(0, 70));
    vale("aviso de ontem: ainda dentro do prazo, não diz que falhou", !L(4).pagamento_falhou_em, "ok");
    vale("pago REDE ontem e ainda liquidado no banco: conferido (libera o 'pagamento confirmado')", !!L(5).liquidacao_conferida_em && L(5).status === "pago", String(L(5).liquidacao_conferida_em));
    vale("pago REDE ontem e ESTORNADO: volta para em aberto, sem data/valor de pago, e anota o estorno", L(6).status === "gerado" && L(6).pago_em === null && L(6).valor_liquidado === null && L(6).tipo_liquidacao === null && /ESTORNADO/.test(L(6).erro_msg) && !!L(6).pagamento_falhou_em, L(6).status + " / " + String(L(6).erro_msg).slice(0, 40));
    vale("pago REDE hoje: espera o dia seguinte para conferir (nem consulta o banco)", !L(7).liquidacao_conferida_em && L(7).status === "pago" && !r.chamadas.some(c => c.tipo === "conferir" && c.nn === "7000007"), "espera");
    vale("pago por Pix: não precisa da conferência do dia seguinte", !L(8).liquidacao_conferida_em && !r.chamadas.some(c => c.tipo === "conferir" && c.nn === "7000008"), "ok");
  }
  {
    const ONTEM2 = "2026-10-21", atras = "2026-10-15";
    const r = rodar({ agora: "2026-10-22T14:00:00-03:00", banco: [
        cob(1, "pago", { conta: "pf", nosso_numero: "7000001", tipo_liquidacao: "REDE", pago_em: ONTEM2, valor_liquidado: 500 }),
        cob(2, "gerado", { conta: "pf", nosso_numero: "7000002", aviso_pagamento_em: atras + "T15:00:00Z", aviso_pagamento_data: atras }) ],
      respostas: { "7000001": {}, "7000002": { situacao: "SITUACAO NOVA DO BANCO" } } });
    vale("banco responde SEM situação: o pago REDE NÃO é desfeito (fica para a próxima rodada)", r.linha(1).status === "pago" && !r.linha(1).pagamento_falhou_em && !r.linha(1).liquidacao_conferida_em, r.linha(1).status);
    vale("banco responde uma situação desconhecida: NÃO diz 'não compensou'", !r.linha(2).pagamento_falhou_em, String(r.linha(2).pagamento_falhou_em));
  }
  console.log("\n  ==== REVISÃO 22/10: feriado, madrugada, conta com problema, 5 dias, repagamento e cheque ====");
  {
    // Carnaval 2027: pago (aviso) na sexta 05/02; seg 08, ter 09 e qua 10 (Cinzas) sem banco. Quarta à tarde: NÃO é "não compensou"
    const r = rodar({ agora: "2027-02-10T14:00:00-03:00", banco: [cob(1, "gerado", { conta: "pf", nosso_numero: "7000001", aviso_pagamento_em: "2027-02-05T18:00:00Z", aviso_pagamento_data: "2027-02-05" })],
      respostas: { "7000001": { situacao: "VENCIDO" } } });
    vale("Carnaval: aviso na sexta, banco fechado seg/ter/qua de Cinzas -> não diz 'não compensou'", !r.linha(1).pagamento_falhou_em, String(r.linha(1).pagamento_falhou_em));
    const r2 = rodar({ agora: "2027-02-15T14:00:00-03:00", banco: [cob(1, "gerado", { conta: "pf", nosso_numero: "7000001", aviso_pagamento_em: "2027-02-05T18:00:00Z", aviso_pagamento_data: "2027-02-05" })],
      respostas: { "7000001": { situacao: "VENCIDO" } } });
    vale("passados 2 dias de banco inteiros (qui 11 e sex 12) e ainda em aberto: aí sim 'não compensou'", !!r2.linha(1).pagamento_falhou_em, String(r2.linha(1).pagamento_falhou_em));
    const r3 = rodar({ agora: "2026-12-31T14:00:00-03:00", banco: [cob(1, "gerado", { conta: "pf", nosso_numero: "7000001", aviso_pagamento_em: "2026-12-29T18:00:00Z", aviso_pagamento_data: "2026-12-29" })],
      respostas: { "7000001": { situacao: "VENCIDO" } } });
    vale("virada do ano: aviso em 29/12, só o dia 30 é de banco até 31/12 -> ainda não diz 'não compensou'", !r3.linha(1).pagamento_falhou_em, String(r3.linha(1).pagamento_falhou_em));
  }
  {
    const r = rodar({ agora: "2026-10-22T02:30:00-03:00", banco: [cob(1, "gerado", { conta: "pf", nosso_numero: "7000001", aviso_pagamento_em: "2026-10-15T18:00:00Z", aviso_pagamento_data: "2026-10-15" })],
      respostas: { "7000001": { situacao: "VENCIDO" } } });
    vale("de madrugada (02h30) o robô não decide 'não compensou' (espera as 9h)", !r.linha(1).pagamento_falhou_em, String(r.linha(1).pagamento_falhou_em));
  }
  {
    // login da LOJA recusado: os avisos, o "não compensou" e a conferência do REDE dos GALPÕES (conta PF) seguem
    const r = rodar({ agora: "2026-10-22T14:00:00-03:00", loginRecusado: ["chave-loja"], banco: [
        cob(9, "gerado", { conta: "loja", nosso_numero: "9000009" }),
        cob(1, "gerado", { conta: "pf", nosso_numero: "7000001" }),
        cob(2, "gerado", { conta: "pf", nosso_numero: "7000002", aviso_pagamento_em: "2026-10-15T18:00:00Z", aviso_pagamento_data: "2026-10-15" }),
        cob(3, "pago", { conta: "pf", nosso_numero: "7000003", tipo_liquidacao: "REDE", pago_em: "2026-10-21", valor_liquidado: 500 }) ],
      liquidados: { "chave-pf": { "22/10/2026": { items: [{ nossoNumero: "7000001", tipoLiquidacao: "AVISO DE PAGAMENTO COMPE", valorLiquidado: 500, dataPagamento: "2026-10-22" }], hasNext: false } } },
      respostas: { "7000002": { situacao: "EM CARTEIRA PIX" }, "7000003": pago("2026-10-21", 500, "LIQUIDADO REDE") } });
    vale("login da loja recusado: o galpão (conta PF) ganha o aviso, o 'não compensou' e a conferência do REDE", !!r.linha(1).aviso_pagamento_em && !!r.linha(2).pagamento_falhou_em && !!r.linha(3).liquidacao_conferida_em, [!!r.linha(1).aviso_pagamento_em, !!r.linha(2).pagamento_falhou_em, !!r.linha(3).liquidacao_conferida_em].join("/"));
  }
  {
    // robô desligado: o aviso de 3 dias atrás ainda é achado (varre os últimos 5 dias)
    const r = rodar({ agora: "2026-10-22T14:00:00-03:00", banco: [cob(1, "gerado", { conta: "pf", nosso_numero: "7000001" })],
      liquidados: { "chave-pf": { "19/10/2026": { items: [{ nossoNumero: "7000001", tipoLiquidacao: "AVISO DE PAGAMENTO COMPE", valorLiquidado: 500, dataPagamento: "2026-10-19" }], hasNext: false } } } });
    vale("robô desligado por dias: o aviso de 3 dias atrás ainda é anotado (a lista começa 4 dias atrás e para quando acha)", r.linha(1).aviso_pagamento_data === "2026-10-19" && (r.chamadas.find(c => c.tipo === "liquidados") || {}).dia === "18/10/2026", r.chamadas.filter(c => c.tipo === "liquidados").map(c => c.dia).join(","));
  }
  {
    // pagou de novo o MESMO boleto depois de um "não compensou": aviso novo recomeça; o aviso antigo não conta
    const r = rodar({ agora: "2026-10-22T14:00:00-03:00", banco: [
        cob(1, "gerado", { conta: "pf", nosso_numero: "7000001", aviso_pagamento_em: "2026-10-12T18:00:00Z", aviso_pagamento_data: "2026-10-12", pagamento_falhou_em: "2026-10-16T13:00:00Z", pagamento_falhou_motivo: "nao compensou" }),
        cob(2, "gerado", { conta: "pf", nosso_numero: "7000002", aviso_pagamento_em: "2026-10-12T18:00:00Z", aviso_pagamento_data: "2026-10-12", pagamento_falhou_em: "2026-10-21T13:00:00Z", pagamento_falhou_motivo: "nao compensou" }) ],
      liquidados: { "chave-pf": { "22/10/2026": { items: [{ nossoNumero: "7000001", tipoLiquidacao: "AVISO DE PAGAMENTO COMPE", valorLiquidado: 500, dataPagamento: "2026-10-22" }], hasNext: false },
                                  "18/10/2026": { items: [{ nossoNumero: "7000002", tipoLiquidacao: "AVISO DE PAGAMENTO COMPE", valorLiquidado: 500, dataPagamento: "2026-10-18" }], hasNext: false } } } });
    vale("pagou de novo depois do 'não compensou': aviso novo anotado e a falha antiga apagada (recomeça)", r.linha(1).aviso_pagamento_data === "2026-10-22" && r.linha(1).pagamento_falhou_em === null, JSON.stringify({ d: r.linha(1).aviso_pagamento_data, f: r.linha(1).pagamento_falhou_em }));
    vale("aviso de ANTES da falha (o pagamento que não compensou) não recomeça nada", r.linha(2).aviso_pagamento_data === "2026-10-12" && !!r.linha(2).pagamento_falhou_em, r.linha(2).aviso_pagamento_data);
  }
  {
    const r = rodar({ agora: "2026-10-22T14:00:00-03:00", banco: [cob(1, "gerado", { conta: "pf", nosso_numero: "7000001" }), cob(2, "gerado", { conta: "pf", nosso_numero: "7000002" }), cob(3, "gerado", { conta: "pf", nosso_numero: "7000003" })],
      respostas: { "7000001": pago("2026-10-22", 500, "LIQUIDADO CHEQUE"), "7000002": pago("2026-10-22", 500, "LIQUIDADO"), "7000003": pago("2026-10-22", 500, "LIQUIDADO PIX") } });
    vale("pago com cheque vira CHEQUE (passa pela conferência do dia seguinte), 'LIQUIDADO' sozinho vira OUTRO e só o Pix é PIX", r.linha(1).tipo_liquidacao === "CHEQUE" && r.linha(2).tipo_liquidacao === "OUTRO" && r.linha(3).tipo_liquidacao === "PIX", [1, 2, 3].map(i => r.linha(i).tipo_liquidacao).join(","));
    const r2 = rodar({ agora: "2026-10-23T14:00:00-03:00", banco: [cob(1, "pago", { conta: "pf", nosso_numero: "7000001", tipo_liquidacao: "CHEQUE", pago_em: "2026-10-22", valor_liquidado: 500 })],
      respostas: { "7000001": { situacao: "EM CARTEIRA" } } });
    vale("cheque devolvido (no dia seguinte o banco diz em aberto): volta para em aberto e anota", r2.linha(1).status === "gerado" && !!r2.linha(1).pagamento_falhou_em && /com cheque/.test(r2.linha(1).pagamento_falhou_motivo), String(r2.linha(1).pagamento_falhou_motivo).slice(0, 60));
  }
  {
    const r = rodar({ semColunasAviso: true, banco: [cob(1, "gerado", { conta: "pf", nosso_numero: "7000001" })], respostas: { "7000001": pago(HOJE, 500, "LIQUIDADO PIX") } });
    vale("nuvem SEM as colunas novas: o aviso pula calado e a baixa do Pix continua normal", r.linha(1).status === "pago" && /colunas ainda nao existem/.test(r.saida) && /rodada expressa ok/.test(r.saida), r.linha(1).status);
  }
  {
    const robo = fs.readFileSync(ROBO, "utf8"), sqlA = fs.readFileSync(path.join(__dirname, "..", "..", "sql", "galpoes_pagamento_compensacao.sql"), "utf8");
    const cols = ["aviso_pagamento_em", "aviso_pagamento_tipo", "aviso_pagamento_valor", "aviso_pagamento_data", "liquidacao_conferida_em", "pagamento_falhou_em", "pagamento_falhou_motivo"];
    vale("o robô e o SQL usam os MESMOS nomes de coluna do aviso", cols.every(n => robo.includes(n) && sqlA.includes("add column if not exists " + n)), cols.filter(n => !(robo.includes(n) && sqlA.includes("add column if not exists " + n))).join(",") || "iguais");
  }

  console.log("\n  " + ok + " ok, " + falhou + " falha(s).\n");
  process.exit(falhou ? 1 : 0);
})();
