// FOTOS da Manutenção v2 para a revisão do dono — prévia com DADOS DE EXEMPLO, nunca vai para o ar.
// Abre o painel construído (output/index.html) no Chrome sem tela com o servidor de mentira
// (scripts/testes/apoio/man2-sb-falso.js, o mesmo do teste de tela) e fotografa cada tela pedida
// na seção 36 do briefing, no computador (1280) e no celular (390).
//   npx tsx scripts/demoDashboard.ts && node scripts/previa-manutencao-fotos.cjs
// Saída: .previa/man2-fotos/NN-nome.png (pasta barrada no deploy).
const fs = require("fs"), path = require("path"), os = require("os");
const { spawn } = require("child_process");
const RAIZ = path.join(__dirname, "..");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const { montarPagina } = require(path.join(__dirname, "previa-manutencao.cjs"));
const SAIDA = path.join(RAIZ, ".previa", "man2-fotos");
fs.mkdirSync(SAIDA, { recursive: true });
for (const f of fs.readdirSync(SAIDA)) if (f.endsWith(".png")) fs.unlinkSync(path.join(SAIDA, f));

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "man2-fotos-"));
const PAG = path.join(TMP, "pagina.html");
const SELO = `<div style="position:fixed;right:10px;bottom:10px;z-index:99999;background:#fdf3d9;color:#5c4500;border:1px solid #e6c46a;border-radius:8px;font:700 12px Arial,sans-serif;padding:4px 10px;pointer-events:none">DADOS DE EXEMPLO</div>`;
fs.writeFileSync(PAG, montarPagina("window.__MAN2_CFG={};", SELO));
const esp = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const porta = 9100 + Math.floor(Math.random() * 300);
  const ch = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--remote-debugging-port=" + porta,
    "--user-data-dir=" + path.join(TMP, "perfil"), "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
    "--allow-file-access-from-files", "about:blank"], { stdio: "ignore" });
  let alvo = null;
  for (let i = 0; i < 80 && !alvo; i++) { await esp(250); try { alvo = (await (await fetch("http://127.0.0.1:" + porta + "/json")).json()).find(t => t.type === "page"); } catch (e) {} }
  if (!alvo) { ch.kill(); throw new Error("Chrome não respondeu"); }
  const ws = new WebSocket(alvo.webSocketDebuggerUrl); let id = 0; const pend = {}; const erros = [];
  await new Promise(r => ws.onopen = r);
  ws.onmessage = m => { const o = JSON.parse(m.data);
    if (o.id && pend[o.id]) { pend[o.id](o); delete pend[o.id]; return; }
    if (o.method === "Runtime.exceptionThrown") erros.push(((o.params.exceptionDetails.exception || {}).description || o.params.exceptionDetails.text).slice(0, 200));
  };
  const cmd = (method, params = {}) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => { const r = await cmd("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return "ERRO: " + ((r.result.exceptionDetails.exception || {}).description || r.result.exceptionDetails.text); return r.result && r.result.result ? r.result.result.value : undefined; };
  const J = JSON.stringify;
  const esperar = async (expr, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if ((await ev("!!(" + expr + ")")) === true) return true; await esp(80); } return false; };
  const clicar = sel => ev("(function(){ var e=document.querySelector(" + J(sel) + "); if(!e) return 'NAO ACHEI " + sel.replace(/'/g, "") + "'; e.click(); return 'ok'; })()");
  const digitar = (sel, v) => ev("(function(){ var e=document.querySelector(" + J(sel) + "); if(!e) return 'NAO ACHEI'; e.focus(); e.value=" + J(v) + "; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); return 'ok'; })()");
  await cmd("Page.enable"); await cmd("Runtime.enable");
  const fotos = [];

  let larguraAtual = 1280, alturaAtual = 900;
  async function tela(largura, altura) {
    larguraAtual = largura; alturaAtual = altura;
    await cmd("Emulation.setDeviceMetricsOverride", { width: largura, height: altura, deviceScaleFactor: largura < 700 ? 2 : 1, mobile: largura < 700 });
  }
  async function abrir(papel, largura, altura) {
    await tela(largura || 1280, altura || 900);
    await cmd("Page.navigate", { url: "file://" + PAG + "?limpar=1" }); await esperar("document.readyState==='complete'");
    await ev("localStorage.clear(); sessionStorage.clear(); 1");
    await cmd("Page.navigate", { url: "file://" + PAG + "?papel=" + papel }); await esperar("document.readyState==='complete'");
    await esperar("window.__PERFIL && document.querySelector('.nav-item[data-page=\"manutencoes\"]') && !document.querySelector('.nav-item[data-page=\"manutencoes\"]').classList.contains('nav-locked')");
    await ev("(function(){ var b=document.querySelector('.nav-item[data-page=\"manutencoes\"]'); if(!b.classList.contains('ativo')) b.click(); })()");
    await esperar("document.querySelector('#man2Lista .m2-tarefa')");
    await esp(400);
  }
  async function foto(nome, descricao, inteira) {
    await esp(350);
    let params = { format: "png" };
    if (inteira) {
      const h = await ev("Math.min(Math.max(document.documentElement.scrollHeight, document.body.scrollHeight), 2600)");
      params = { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: larguraAtual, height: h, scale: 1 } };
    }
    const r = await cmd("Page.captureScreenshot", params);
    const arq = String(fotos.length + 1).padStart(2, "0") + "-" + nome + ".png";
    fs.writeFileSync(path.join(SAIDA, arq), Buffer.from(r.result.data, "base64"));
    fotos.push({ arq, descricao });
    console.log("  foto:", arq, "—", descricao);
  }
  const janelaAberta = () => esperar("document.getElementById('man2JanBg') && document.getElementById('man2JanBg').classList.contains('abre')");
  const fecharJanela = async () => { await ev("typeof man2FecharJan==='function' && man2FecharJan(true); 1"); await esp(250); };
  const topoJanela = () => ev("(function(){ var c=document.getElementById('man2JanCorpo'); if(c) c.scrollTop=0; window.scrollTo(0,0); return 1; })()");

  /* ===== OPERACIONAL · computador ===== */
  await abrir("operacional");
  await foto("precisa-de-atencao-operacional", "Precisa de atenção — visão do funcionário (operacional)", true);

  await clicar('[data-m2acao="aba"][data-aba="todos"]'); await esp(300);
  await foto("todos-os-equipamentos", "Todos os equipamentos — cards, 40 por vez");

  await digitar("#man2Busca", "câmara"); await esp(400);
  await ev("(function(){ var s=document.getElementById('man2FSetor'); if(s){ s.value='Açougue'; s.dispatchEvent(new Event('change',{bubbles:true})); } return 1; })()");
  await esp(300);
  await foto("busca-e-filtros", "Busca \"câmara\" + filtro de setor Açougue");
  await digitar("#man2Busca", "");
  await ev("(function(){ var s=document.getElementById('man2FSetor'); if(s){ s.value=''; s.dispatchEvent(new Event('change',{bubbles:true})); } return 1; })()");
  await esp(400);

  await clicar('[data-m2acao="aba"][data-aba="pendencias"]'); await esp(300);
  await foto("pendencias", "Aba Pendências — problema encontrado continua aberto até ser resolvido");

  await ev("man2AbrirRegistrar('eqbal102')"); await janelaAberta(); await esp(400);
  await esperar("document.querySelector('[data-m2pesres=\"exec\"] [data-m2j=\"pes-escolher\"]')");
  await digitar('[data-m2pesbusca="exec"]', "lary"); await esp(150); await clicar('[data-m2pesres="exec"] [data-m2j="pes-escolher"]');
  await clicar('[data-m2j="form-resultado"][data-resultado="ok"]'); await topoJanela();
  await tela(1280, 1500); await esp(300);
  await foto("registrar-servico", "Registrar serviço — contexto somente leitura, funcionário da lista, resultado");
  await tela(1280, 900); await fecharJanela();

  await ev("man2AbrirRegistrar('eqfreezer')"); await janelaAberta(); await esp(400);
  await esperar("document.querySelector('[data-m2pesres=\"exec\"] [data-m2j=\"pes-escolher\"]')");
  await digitar('[data-m2pesbusca="exec"]', "zé"); await esp(150); await clicar('[data-m2pesres="exec"] [data-m2j="pes-escolher"]');
  await clicar('[data-m2j="form-resultado"][data-resultado="problema"]'); await esp(150);
  await digitar("#man2FProb", "Porta não fecha direito, borracha solta no canto inferior");
  await ev("(function(){ var b=document.querySelector('[data-m2j=\"form-resultado\"][data-resultado=\"problema\"]'); if(b) b.scrollIntoView({block:'start'}); return 1; })()");
  await tela(1280, 1500); await esp(300);
  await foto("resultado-com-problema", "Resultado \"Encontrei um problema\" — vai abrir uma pendência");
  await tela(1280, 900); await fecharJanela();

  await ev("man2AbrirDetalhes('emr9b5cgj174','situacao')"); await janelaAberta(); await esp(600);
  await foto("detalhes-operacional", "Detalhes do equipamento como funcionário — sem Editar/Inativar/custo");
  await clicar('[data-m2j="det-aba"][data-aba="procedimento"]'); await esp(500);
  await foto("procedimento-e-manual", "Procedimento interno Santa Rita + manual do fabricante");
  await fecharJanela();

  /* ===== GESTOR · computador ===== */
  await abrir("gestor");
  await foto("precisa-de-atencao-gestor", "Precisa de atenção — visão do gestor (+ Equipamento, Visão gerencial)", true);

  await ev("man2AbrirDetalhes('emr9b5cgj174','situacao')"); await janelaAberta(); await esp(600);
  await foto("equipamento-vencido", "Equipamento vencido — Camera Fria de Congelado, visão do gestor");
  await clicar('[data-m2j="det-aba"][data-aba="historico"]');
  await esperar("document.querySelectorAll('#man2JanCorpo .m2-hist-item').length>=5"); await esp(300);
  await tela(1280, 1600); await esp(300);
  await foto("historico-completo", "Histórico — executado por, registrado por, resultado, anulada, custo, nota fiscal");
  await tela(1280, 900); await fecharJanela();

  await ev("man2AbrirDetalhes('emraqg6gz805','pendencias')"); await janelaAberta(); await esp(600);
  await foto("pendencia-no-equipamento", "Pendência aberta dentro do equipamento (Resolver / Cancelar)");
  await fecharJanela();

  await clicar('[data-m2acao="aba"][data-aba="todos"]'); await esp(300);
  await clicar('[data-kpi="em_dia"]'); await esp(400);
  const idEmDia = await ev("(function(){ var b=document.querySelector('#man2Lista .m2-card [data-m2acao=\"detalhes\"]'); return b?b.getAttribute('data-eq'):''; })()");
  await clicar('[data-kpi="em_dia"]'); await esp(200);
  if (idEmDia) { await ev("man2AbrirDetalhes(" + J(idEmDia) + ",'situacao')"); await janelaAberta(); await esp(600);
    await foto("equipamento-em-dia", "Equipamento em dia"); await fecharJanela(); }

  await ev("man2AbrirDetalhes('eqgerador','situacao')"); await janelaAberta(); await esp(600);
  await foto("equipamento-sem-programacao", "Equipamento sem programação — gestor vê como configurar rotina");
  await fecharJanela();

  await ev("man2AbrirEquipamento()"); await janelaAberta(); await esp(400);
  await digitar("#man2EqNome", "Balança Caixa"); await digitar("#man2EqQtd", "13"); await digitar("#man2EqIni", "101");
  await ev("(function(){ ['man2EqTipo','man2EqSetor'].forEach(function(i){ var s=document.getElementById(i); if(s&&s.options){ for(var k=0;k<s.options.length;k++){ if(/Balan|Frente/.test(s.options[k].text)){ s.value=s.options[k].value; s.dispatchEvent(new Event('change',{bubbles:true})); break; } } } }); return 1; })()");
  await esp(300); await tela(1280, 1300); await esp(300);
  await foto("novo-equipamento", "Novo equipamento em lote — prévia dos nomes antes de salvar");
  await tela(1280, 900); await fecharJanela();

  await ev("man2AbrirDetalhes('emraqg6gz805','situacao')"); await janelaAberta(); await esp(500);
  const abriuRot = await clicar('[data-m2j="rotina-editar"]');
  if (abriuRot === "ok") { await esperar("document.getElementById('man2RotPer')"); await esp(300); await foto("configurar-rotina", "Rotina — serviço, periodicidade (vazio = não configurada), responsável"); }
  await fecharJanela();

  await clicar('[data-m2acao="aba"][data-aba="gerencial"]'); await esperar("document.querySelector('.m2-ger')");
  await clicar('[data-m2acao="ger-dias"][data-dias="90"]'); await esp(900);
  await foto("visao-gerencial", "Visão gerencial (90 dias) — no prazo, atrasos por setor, pendências, custos, qualidade dos dados", true);

  await clicar('[data-m2acao="aba"][data-aba="atencao"]'); await esp(300);
  await ev("man2AbrirAuditoria('emr9b5cgj174')"); await esp(900);
  await foto("auditoria", "Auditoria do equipamento — quem, quando, antes → depois, justificativa");
  await fecharJanela();

  /* ===== CELULAR · 390 ===== */
  await abrir("operacional", 390, 844);
  await foto("celular-precisa-de-atencao", "Celular 390 px — Precisa de atenção (funcionário)");
  await ev("man2AbrirRegistrar('eqbal102')"); await janelaAberta(); await esp(500);
  await foto("celular-registrar-servico", "Celular — Registrar serviço (tela cheia, rodapé com Salvar)");
  await ev("(function(){ var b=document.querySelector('[data-m2j=\"form-resultado\"]'); if(b) b.scrollIntoView({block:'center'}); return 1; })()"); await esp(300);
  await foto("celular-registrar-resultado-fotos", "Celular — resultado e fotos antes/depois (câmera)");
  await fecharJanela();
  await ev("man2AbrirDetalhes('emr9b5cgj174','situacao')"); await janelaAberta(); await esp(600);
  await foto("celular-detalhes", "Celular — Detalhes do equipamento");
  await fecharJanela();

  /* ===== IMPRESSÃO e ETIQUETAS (html gerado, desenhado numa página A4) ===== */
  await abrir("gestor");
  await ev("window.__abertas=[]; window.open=function(){ var d={html:'',open:function(){this.html='';},write:function(x){this.html+=x;},close:function(){}}; var w={document:d,location:{},close:function(){},focus:function(){},print:function(){}}; window.__abertas.push(w); return w; }; 1");
  await ev("man2ImprimirAgenda()"); await esp(500);
  const agenda = await ev("(window.__abertas.slice(-1)[0]||{document:{html:''}}).document.html");
  await clicar('[data-m2menu="etiquetas"]'); await esp(600);
  const etiq = await ev("(window.__abertas.slice(-1)[0]||{document:{html:''}}).document.html");
  for (const [nome, html, desc] of [["impressao-agenda", agenda, "Agenda impressa (A4) — sem botões, com data/hora e quem gerou"], ["etiquetas-qr", etiq, "Etiquetas QR (A4)"]]) {
    if (!html || html.length < 200) { console.log("  (sem html para " + nome + ")"); continue; }
    const f = path.join(TMP, nome + ".html"); fs.writeFileSync(f, html);
    await tela(820, 1160);
    await cmd("Page.navigate", { url: "file://" + f }); await esperar("document.readyState==='complete'"); await esp(500);
    await foto(nome, desc, true);
  }

  fs.writeFileSync(path.join(SAIDA, "indice.json"), JSON.stringify(fotos, null, 1));
  console.log("\n" + fotos.length + " fotos em " + SAIDA);
  console.log(erros.length ? "EXCEÇÕES NA PÁGINA:\n - " + erros.join("\n - ") : "sem exceções na página");
  ws.close(); ch.kill();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
