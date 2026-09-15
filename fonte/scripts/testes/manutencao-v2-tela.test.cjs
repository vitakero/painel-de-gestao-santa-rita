// TELA da Manutenção v2 no Chrome sem tela — o painel construído (output/index.html) de verdade,
// com o supabase-js trocado pelo servidor de mentira que segue o contrato (apoio/man2-sb-falso.js,
// DADOS DE EXEMPLO). O login passa pelo caminho real (getSession -> carregarPerfil -> applyPerms).
// Cobre a linha "manutencao-v2-tela" da seção 6 da especificação: operacional x gestor, formulário não
// apagado por recarga, registrar pelo fluxo, problema -> pendência, busca/filtros/KPIs, celular 390 e
// 360 (sem rolagem de lado, toque >= 44 px, fonte >= 14 px), link #man/<id> com e sem login, sino,
// e impressão da agenda -> PDF (Chrome print-to-pdf + pdftotext) com as colunas e sem botões.
// Precisa do Google Chrome (e do pdftotext para a parte do papel). Sem Chrome: avisa e passa.
//   npx tsx scripts/demoDashboard.ts && node scripts/testes/manutencao-v2-tela.test.cjs
const fs = require("fs"), path = require("path"), os = require("os");
const { spawn, execFileSync, execSync } = require("child_process");
const RAIZ = path.join(__dirname, "..", "..");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
if (!fs.existsSync(CHROME) || !fs.existsSync(path.join(RAIZ, "output", "index.html"))) { console.log("PULADO — precisa do Google Chrome e do painel construído."); process.exit(0); }
const { montarPagina } = require(path.join(RAIZ, "scripts", "previa-manutencao.cjs"));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "man2-tela-"));
const PAG = path.join(TMP, "pagina.html");
fs.writeFileSync(PAG, montarPagina("window.__MAN2_CFG={};", ""));
const esp = ms => new Promise(r => setTimeout(r, ms));
let ok = 0, falhou = 0, CHROME_PROC = null;
function vale(nome, cond, det) { console.log((cond ? "  OK   " : "  FALHA") + " | " + nome + (det !== undefined ? "  ->  " + (typeof det === "string" ? det : JSON.stringify(det)) : "")); cond ? ok++ : falhou++; }

(async () => {
  const porta = 9500 + Math.floor(Math.random() * 400);
  const ch = CHROME_PROC = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--remote-debugging-port=" + porta, "--user-data-dir=" + path.join(TMP, "perfil"),
    "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1", "--allow-file-access-from-files", "about:blank"], { stdio: "ignore" });
  let alvo = null;
  for (let i = 0; i < 80 && !alvo; i++) { await esp(250); try { alvo = (await (await fetch("http://127.0.0.1:" + porta + "/json")).json()).find(t => t.type === "page"); } catch (e) {} }
  if (!alvo) { ch.kill(); console.log("FALHA | Chrome não respondeu"); process.exit(1); }
  const ws = new WebSocket(alvo.webSocketDebuggerUrl); let id = 0; const pend = {}; const erros = [];
  await new Promise(r => ws.onopen = r);
  ws.onmessage = m => { const o = JSON.parse(m.data);
    if (o.id && pend[o.id]) { pend[o.id](o); delete pend[o.id]; return; }
    if (o.method === "Runtime.exceptionThrown") erros.push("EXCEÇÃO: " + ((o.params.exceptionDetails.exception || {}).description || o.params.exceptionDetails.text).slice(0, 300));
    if (o.method === "Runtime.consoleAPICalled" && o.params.type === "error") erros.push("console.error: " + o.params.args.map(a => a.value || a.description || "").join(" ").slice(0, 300));
  };
  const cmd = (method, params = {}) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => { const r = await cmd("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return "ERRO-EVAL: " + ((r.result.exceptionDetails.exception || {}).description || r.result.exceptionDetails.text); return r.result && r.result.result ? r.result.result.value : undefined; };
  const J = JSON.stringify;
  const esperar = async (expr, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if ((await ev("!!(" + expr + ")")) === true) return true; await esp(60); } return false; };
  const clicar = sel => ev("(function(){ var e=document.querySelector(" + J(sel) + "); if(!e) return 'NAO ACHEI'; e.click(); return 'ok'; })()");
  const texto = sel => ev("(function(){ var e=document.querySelector(" + J(sel) + "); return e?e.innerText:''; })()");
  const digitar = (sel, v) => ev("(function(){ var e=document.querySelector(" + J(sel) + "); if(!e) return 'NAO ACHEI'; e.focus(); e.value=" + J(v) + "; e.dispatchEvent(new Event('input',{bubbles:true})); return 'ok'; })()");
  const mudar = (sel, v) => ev("(function(){ var e=document.querySelector(" + J(sel) + "); if(!e) return 'NAO ACHEI'; e.value=" + J(v) + "; e.dispatchEvent(new Event('change',{bubbles:true})); return 'ok'; })()");
  const rpcs = nome => ev("JSON.stringify(__man2Teste.chamadas.filter(function(c){return c.nome===" + J(nome) + ";}).map(function(c){return c.params;}))").then(s => JSON.parse(s || "[]"));
  const modal = () => ev("(function(){ var m=document.querySelector('#uiModal.show'); return m?document.getElementById('uiModalTit').textContent+' | '+document.getElementById('uiModalMsg').textContent:''; })()");
  const arquivo = (sel, tipo, nome) => ev(`(async function(){ var inp=document.querySelector(${J(sel)}); if(!inp) return 'NAO ACHEI'; var blob;
    if(${J(tipo)}==='application/pdf') blob=new Blob(['%PDF-1.4 manual de exemplo'],{type:'application/pdf'});
    else { var c=document.createElement('canvas'); c.width=64; c.height=48; var x=c.getContext('2d'); x.fillStyle='#157a35'; x.fillRect(0,0,64,48); blob=await new Promise(function(r){ c.toBlob(r,'image/jpeg',0.8); }); }
    var dt=new DataTransfer(); dt.items.add(new File([blob],${J(nome)},{type:${J(tipo)}})); inp.files=dt.files; inp.dispatchEvent(new Event('change',{bubbles:true})); return 'ok'; })()`);
  const escolherPessoa = async (prefixo, busca) => { await digitar('[data-m2pesbusca="' + prefixo + '"]', busca); await esp(80); return clicar('[data-m2pesres="' + prefixo + '"] [data-m2j="pes-escolher"]'); };
  const janela = () => ev("document.getElementById('man2JanBg') && document.getElementById('man2JanBg').classList.contains('abre')");
  await cmd("Page.enable"); await cmd("Runtime.enable");

  async function abrir(query, largura, hash) {
    await cmd("Emulation.setDeviceMetricsOverride", { width: largura || 1280, height: largura && largura < 700 ? 844 : 900, deviceScaleFactor: 1, mobile: !!(largura && largura < 700) });
    await cmd("Page.navigate", { url: "file://" + PAG + "?limpar=1" }); await esperar("document.readyState==='complete'");
    await ev("localStorage.clear(); sessionStorage.clear(); 1");
    await cmd("Page.navigate", { url: "file://" + PAG + "?" + query + (hash || "") });
    await esperar("document.readyState==='complete'");
    await esp(150);
  }
  async function entrar() {
    await esperar("window.__PERFIL && document.querySelector('.nav-item[data-page=\"manutencoes\"]') && !document.querySelector('.nav-item[data-page=\"manutencoes\"]').classList.contains('nav-locked')");
    await ev("(function(){ var b=document.querySelector('.nav-item[data-page=\"manutencoes\"]'); if(!b.classList.contains('ativo')) b.click(); })()");
    return esperar("document.querySelector('#man2Lista .m2-tarefa')");
  }
  const kpi = k => ev("(document.querySelector('[data-kpi=\"" + k + "\"] .v')||{}).textContent");
  const qtd = sel => ev("document.querySelectorAll(" + J(sel) + ").length");

  /* ======================= A) OPERACIONAL · 1280 ======================= */
  console.log("\n=== A) Operacional · 1280 ===");
  erros.length = 0;
  await abrir("papel=operacional");
  vale("login real: página liberada e lista carregada", await entrar());
  vale("carimbo 'Dados de HH:MM'", /Dados de \d\d:\d\d/.test(await texto("#man2Carimbo")), await texto("#man2Carimbo"));
  vale("abas com contagem, sem Visão gerencial", /Precisa de atenção \(7\)/.test(await texto("#man2Abas")) && /Todos os equipamentos \(44\)/.test(await texto("#man2Abas")) && !/gerencial/i.test(await texto("#man2Abas")), await texto("#man2Abas"));
  vale("operacional NÃO vê + Equipamento nem Etiquetas/Auditoria", await ev("document.getElementById('man2BtnEquip').hidden && document.querySelector('[data-m2menu=\"etiquetas\"]').hidden && document.querySelector('[data-m2menu=\"auditoria\"]').hidden && !document.querySelector('[data-m2menu=\"imprimir\"]').hidden"));
  const kpis = [await kpi("atrasado"), await kpi("hoje"), await kpi("proximo"), await kpi("em_dia"), await kpi("sem_programacao"), await kpi("pendencia")];
  vale("KPIs = contagem do contrato", J(kpis) === J(["2", "1", "2", "1", "36", "1"]), kpis);
  const ordem = await ev("[].map.call(document.querySelectorAll('#man2Lista .m2-tarefa'),function(t){ return t.querySelector('.m2-pill').textContent; }).join(' / ')");
  vale("fila na ordem: atrasado, hoje, pendência, 1ª execução, próximo", ordem === "Vencido há 40 dias / Vencido há 39 dias / Vence hoje / Problema pendente / Aguardando 1ª execução / Vence em 3 dias / Vence em 6 dias", ordem);
  const t1 = await texto("#man2Lista .m2-tarefa");
  vale("1ª tarefa no formato da 5.2", /Camera Fria de Congelado · EQ-0001/.test(t1) && /Limpeza — vencido desde 05\/08\/2026 · a cada 30 dias/.test(t1) && /Última: 06\/07\/2026 \(Laryze\)/.test(t1), t1.replace(/\n/g, " | "));
  vale("selo do menu = atrasado + hoje", (await texto("#manNavBadge")) === "3", await texto("#manNavBadge"));
  const tarefaSemServico = "(function(){ var t=[].filter.call(document.querySelectorAll('#man2Lista .m2-tarefa'),function(x){ return /Balanças Caixa 101/.test(x.innerText); })[0]; return t?t.innerText:'NAO ACHEI'; })()";
  const tSemOp = await ev(tarefaSemServico);
  vale("rotina sem serviço (operacional): manda pedir ao gestor; sem 'Registre a primeira execução', sem 'migrada'",
    /Peça ao gestor para completar/.test(tSemOp) && !/Registre a primeira execução|migrada|Completar rotina/i.test(tSemOp), tSemOp.replace(/\n/g, " | "));
  await clicar('[data-kpi="em_dia"]'); await esp(60);
  vale("KPI 'Em dia' vira filtro na aba Todos", (await ev("document.querySelector('.m2-aba[aria-selected=\"true\"]').dataset.aba")) === "todos" && (await qtd("#man2Lista .m2-card")) === 1 && (await ev("document.getElementById('man2FSituacao').value")) === "em_dia");
  await clicar('[data-kpi="em_dia"]'); await esp(60);
  vale("clicar de novo desliga; 40 cards + Mostrar mais", (await qtd("#man2Lista .m2-card")) === 40 && /Mostrar mais 4/.test(await texto(".m2-mais")), await texto(".m2-mais"));
  // VIS-1: no card a situação aparece UMA vez (pílula do card); a linha da rotina informa sem repetir
  const cardDe = (nome) => ev("(function(){ var c=[].filter.call(document.querySelectorAll('#man2Lista .m2-card'),function(x){ return x.querySelector('.m2-nome') && x.querySelector('.m2-nome').innerText.indexOf(" + J(nome) + ")===0; })[0]; return c?c.innerText:'NAO ACHEI'; })()");
  const cCam = await cardDe("Camera Fria de Congelado"), cFrz = await cardDe("Freezer Ilha Congelados");
  vale("card com 1 rotina atrasada: 'Vencido há 40 dias' só na pílula; linha 'Limpeza · a cada 30 dias · vencido desde 05/08/2026'",
    (cCam.match(/vencido há 40 dias/gi) || []).length === 1 && /Limpeza · a cada 30 dias · vencido desde 05\/08\/2026/.test(cCam), cCam.replace(/\n/g, " | "));
  vale("card com 1 rotina em dia: 'Em dia' só na pílula; linha 'Limpeza · a cada 30 dias · próxima 01/10'",
    (cFrz.match(/em dia/gi) || []).length === 1 && /Limpeza · a cada 30 dias · próxima 01\/10/.test(cFrz), cFrz.replace(/\n/g, " | "));
  const codSozinho = await ev(`JSON.stringify([].map.call(document.querySelectorAll('#man2Lista .m2-card .m2-nome'),function(h){
    var cod=h.querySelector('.m2-cod'); if(!cod) return null;
    var w=document.createTreeWalker(h,NodeFilter.SHOW_TEXT,{acceptNode:function(n){ return (cod.contains(n)||!n.textContent.trim())?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT; }}), ult=null, n;
    while((n=w.nextNode())) ult=n;
    if(!ult) return null;
    var t=ult.textContent.replace(/\\s+$/,''), rg=document.createRange(); rg.setStart(ult,t.length-1); rg.setEnd(ult,t.length);
    var a=rg.getBoundingClientRect(), b=cod.getClientRects()[0];
    return (b && Math.abs(a.top-b.top)<3)?null:h.innerText.replace(/\\n/g,' / '); }).filter(Boolean))`);
  vale("card: o código (EQ-0004) fica na mesma linha do fim do nome, nunca sozinho embaixo por causa da pílula", codSozinho === "[]", codSozinho);
  await digitar("#man2Busca", "CÂMARA"); await esp(350);
  vale("busca sem acento e sem maiúscula (nome/tipo)", (await qtd("#man2Lista .m2-card")) === 2);
  await digitar("#man2Busca", ""); await esp(300);
  await clicar('[data-m2acao="aba"][data-aba="atencao"]');
  await mudar("#man2FSetor", "Açougue"); await esp(60);
  vale("filtro de setor na fila", (await qtd("#man2Lista .m2-tarefa")) === 3, await qtd("#man2Lista .m2-tarefa"));
  await digitar("#man2Busca", "resfriado"); await esp(350);
  vale("busca + setor combinados", (await qtd("#man2Lista .m2-tarefa")) === 2 && (await kpi("atrasado")) === "1");
  await clicar('[data-m2acao="limpar-filtros"]'); await digitar("#man2Busca", ""); await mudar("#man2FSetor", ""); await esp(300);
  vale("limpar volta às 7 tarefas", (await qtd("#man2Lista .m2-tarefa")) === 7);
  await mudar("#man2FResp", "Zé"); await esp(80);
  const kResp = [await kpi("atrasado"), await kpi("hoje"), await kpi("proximo")];
  const filaResp = await ev("JSON.stringify(['atrasado','hoje','proximo'].map(function(s){ return String([].filter.call(document.querySelectorAll('#man2Lista .m2-tarefa'),function(t){ return t.classList.contains(s); }).length); }))");
  vale("KPIs seguem o filtro de Responsável: o número grande bate com a fila", J(kResp) === filaResp && kResp[0] === "0", J(kResp) + " fila " + filaResp);
  await mudar("#man2FResp", ""); await esp(80);

  // Detalhes (operacional)
  await clicar('#man2Lista .m2-tarefa [data-m2acao="detalhes"]:not([data-aba])');
  await esperar("document.querySelector('#man2JanCorpo .m2-bloco')");
  vale("Detalhes: operacional NÃO vê Editar/Inativar/Etiqueta/Auditoria", !/Editar|Inativar|Etiqueta|Auditoria/.test(await texto("#man2JanCab")), (await texto("#man2JanCab")).replace(/\n/g, " | "));
  await clicar('[data-m2j="det-aba"][data-aba="historico"]'); await esperar("document.querySelectorAll('#man2JanCorpo .m2-hist-item').length>=20");
  const hOp = await texto("#man2JanCorpo");
  vale("Histórico: 20 + Carregar mais; nota só 'Nota anexada'; sem custo; sem Anular", (await qtd("#man2JanCorpo .m2-hist-item")) === 20 && /Carregar mais/.test(hOp) && /Nota anexada/.test(hOp) && !/Custo|Abrir nota fiscal|\bAnular\b|Informar custo/.test(hOp));
  vale("anulada riscada com quem e motivo", /Anulada por Gestor Exemplo em 08\/07\/2026 às \d\d:\d\d — Lançado em duplicidade/.test(hOp) && (await ev("getComputedStyle(document.querySelector('.m2-hist-item.anulada .m2-hist-conteudo')).textDecorationLine")) === "line-through");
  await clicar('[data-m2j="fechar"]'); await esp(80);

  // Registrar pelo fluxo: balança, conferência, peso, pessoa da lista
  await clicar('#man2Lista .m2-tarefa.hoje [data-m2acao="registrar"]');
  await esperar("document.querySelector('#man2FContexto')");
  vale("caixa de contexto somente leitura", (await texto("#man2FContexto")) === "Periodicidade atual: 7 dias · Última execução: 07/09/2026 · Próxima prevista após concluir: 21/09/2026 · Responsável: Laryze", await texto("#man2FContexto"));
  vale("data de hoje com máximo = hoje do servidor", (await ev("document.getElementById('man2FData').value+'|'+document.getElementById('man2FData').max")) === "2026-09-14|2026-09-14");
  vale("balança + conferência mostra os pesos", await ev("!!document.getElementById('man2FPesoRef') && !!document.getElementById('man2FPesoMed')"));
  await esperar("document.querySelector('[data-m2pesres=\"exec\"] [data-m2j=\"pes-escolher\"]')");
  await escolherPessoa("exec", "lary"); await esp(60);
  vale("pessoa escolhida da lista (com busca)", /Laryze · Açougue/.test(await texto(".m2-escolhido-txt:last-of-type") + (await texto("#man2JanCorpo"))));
  await digitar("#man2FPesoRef", "10,000"); await digitar("#man2FPesoMed", "9,980");
  vale("divergência ao vivo", (await texto("#man2FDiv")) === "Diferença: -20 g a menos", await texto("#man2FDiv"));
  await clicar('[data-m2j="form-resultado"][data-resultado="ok"]'); await esp(40);
  await ev("(function(){ var b=document.querySelector('[data-m2j=\"form-salvar\"]'); b.click(); b.click(); })()");
  await esperar("!document.getElementById('man2JanBg').classList.contains('abre')");
  const reg1 = await rpcs("manutencao_execucao_registrar");
  vale("duplo clique = UMA chamada", reg1.length === 1, reg1.length);
  const p1 = (reg1[0] || {}).p || {};
  vale("pedido do contrato", p1.equipamento_id === "eqbal102" && p1.tipo_servico === "Conferência / aferição" && p1.data_execucao === "2026-09-14" && J(p1.executor) === J({ tipo: "interno", ref: "escala:r0", nome: "Laryze" }) && p1.resultado === "ok" && p1.peso_ref === 10 && p1.peso_medido === 9.98 && !("custo" in p1) && /^[0-9a-f-]{36}$/.test(p1.request_id), J(p1));
  vale("sucesso mostra a próxima", /Serviço registrado\. Próxima: 21\/09\/2026/.test(await texto("#man2Toast")), await texto("#man2Toast"));
  await esperar("document.querySelector('[data-kpi=\"hoje\"] .v').textContent==='0'");
  vale("painel recarregado: 'Vence hoje' saiu", (await kpi("hoje")) === "0");

  // Recarga remota NÃO apaga o formulário
  await clicar('#man2Lista .m2-tarefa [data-m2acao="registrar"]');
  await esperar("document.querySelector('[data-m2j=\"pes-outro\"]')");
  await clicar('[data-m2j="pes-outro"]'); await digitar('[data-m2pesnome="exec"]', "Fulano Teste"); await digitar("#man2FObs", "Tudo limpo, sem gelo");
  await ev("__man2Falso.achaEq('emr9b5cgj174').versao++; man2Carregar()"); await esp(300);
  vale("recarga remota: o digitado continua", (await ev("document.querySelector('[data-m2pesnome=\"exec\"]').value+'|'+document.getElementById('man2FObs').value")) === "Fulano Teste|Tudo limpo, sem gelo");
  vale("recarga remota: aviso dentro do formulário", /Este equipamento foi alterado por outra pessoa\./.test(await texto("#man2JanAviso")) && !(await ev("document.getElementById('man2JanAviso').hidden")));
  await clicar('[data-m2j="fechar"]'); await esperar("document.querySelector('#uiModal.show')");
  vale("fechar com dados pede confirmação (vermelho)", /Descartar o que foi preenchido/.test(await modal()) && await ev("document.getElementById('uiModalOk').classList.contains('btn-perigo')"));
  await clicar("#uiModalOk"); await esp(60);

  // Problema -> pendência, com foto subindo ANTES da RPC
  await clicar('[data-m2acao="aba"][data-aba="todos"]'); await digitar("#man2Busca", "freezer"); await esp(350);
  await clicar('#man2Lista .m2-card [data-m2acao="registrar"]'); await esperar("document.querySelector('[data-m2pesres=\"exec\"] [data-m2j=\"pes-escolher\"]')");
  await escolherPessoa("exec", "zé");
  await clicar('[data-m2j="form-resultado"][data-resultado="problema"]'); await esp(40);
  vale("problema: aviso de pendência", /Vai abrir uma pendência para o equipamento\./.test(await texto("#man2JanCorpo")));
  await digitar("#man2FProb", "Porta não fecha direito");
  vale("foto: botão da câmera (capture=environment)", await ev("document.getElementById('man2Arq_foto_antes').getAttribute('capture')==='environment'"));
  await arquivo("#man2Arq_foto_antes", "image/jpeg", "antes.jpg");
  vale("foto preparada com prévia", await esperar("document.querySelector('.m2-slot img')"));
  await ev("__man2Teste.log.length=0"); await clicar('[data-m2j="form-salvar"]');
  await esperar("!document.getElementById('man2JanBg').classList.contains('abre')");
  const log = await ev("__man2Teste.log.join(',')");
  const iUp = log.indexOf("upload:v2/foto_antes/"), iRpc = log.indexOf("rpc:manutencao_execucao_registrar");
  vale("foto sobe para v2/foto_antes/<uuid>.jpg ANTES da RPC", iUp >= 0 && iRpc > iUp && /upload:v2\/foto_antes\/[0-9a-f-]{36}\.jpg/.test(log), log.slice(0, 160));
  const p2 = ((await rpcs("manutencao_execucao_registrar")).slice(-1)[0] || {}).p || {};
  vale("pedido com anexo e descrição", p2.resultado === "problema" && p2.problema_descricao === "Porta não fecha direito" && p2.anexos && p2.anexos.length === 1 && p2.anexos[0].categoria === "foto_antes" && p2.anexos[0].mime === "image/jpeg" && p2.anexos[0].bytes > 0, J(p2.anexos));
  vale("toast avisa a pendência", /Pendência aberta para o equipamento/.test(await texto("#man2Toast")), await texto("#man2Toast"));
  await digitar("#man2Busca", ""); await esp(300);
  await esperar("/Pendências \\(2\\)/.test(document.getElementById('man2Abas').innerText)");
  vale("pendência aparece na aba Pendências", /Pendências \(2\)/.test(await texto("#man2Abas")), await texto("#man2Abas"));

  // Foto obrigatória, serviço avulso, data retroativa e futura
  await clicar('[data-m2acao="aba"][data-aba="atencao"]');
  await ev("(function(){ [].forEach.call(document.querySelectorAll('#man2Lista .m2-tarefa'),function(t){ if(/Balcão Refrigerado/.test(t.innerText)) t.querySelector('[data-m2acao=\"registrar\"]').click(); }); })()");
  await esperar("document.querySelector('#man2JanCorpo .m2-obrig')");
  vale("rotina que exige foto: rótulo 'obrigatória' na foto depois", /Foto depois obrigatória/i.test(await texto("#man2JanCorpo .m2-slots")), await texto("#man2JanCorpo .m2-slots"));
  await esperar("document.querySelector('[data-m2j=\"pes-escolher\"]')"); await escolherPessoa("exec", "zé"); await clicar('[data-m2j="form-resultado"][data-resultado="ok"]');
  const nAntes = (await rpcs("manutencao_execucao_registrar")).length;
  await clicar('[data-m2j="form-salvar"]'); await esp(150);
  vale("sem a foto obrigatória: validação segura o envio", /A foto de depois é obrigatória/.test(await texto("#man2JanCorpo")) && (await rpcs("manutencao_execucao_registrar")).length === nAntes);
  await clicar('[data-m2j="form-outro"]'); await mudar("#man2FServ", "Inspeção"); await esp(60);
  vale("serviço avulso", (await texto("#man2FContexto")) === "Serviço avulso — não altera nenhuma programação", await texto("#man2FContexto"));
  await mudar("#man2FData", "2026-09-01"); await esp(60);
  vale("mais de 7 dias atrás pede justificativa", await ev("!!document.getElementById('man2FJust')"));
  await mudar("#man2FData", "2026-09-20"); await clicar('[data-m2j="form-salvar"]'); await esp(150);
  vale("data no futuro recusada na tela", /A data não pode ser no futuro\./.test(await texto("#man2JanCorpo")) && (await rpcs("manutencao_execucao_registrar")).length === nAntes);
  await clicar('[data-m2j="form-executor"][data-tipo="externo"]'); await esp(40);
  vale("operacional em empresa externa: sem custo, com nota fiscal", !(await ev("!!document.getElementById('man2FCusto')")) && await ev("!!document.getElementById('man2Arq_nota_fiscal')"));
  await clicar('[data-m2j="fechar"]'); await esperar("document.querySelector('#uiModal.show')"); await clicar("#uiModalOk"); await esp(60);

  // Sem internet: fila
  await ev("__man2Teste.offline=true");
  await clicar('#man2Lista .m2-tarefa [data-m2acao="registrar"]'); await esp(150);
  await clicar('[data-m2j="pes-outro"]'); await digitar('[data-m2pesnome="exec"]', "Laryze"); await clicar('[data-m2j="form-resultado"][data-resultado="ok"]');
  await clicar('[data-m2j="form-salvar"]'); await esperar("!document.getElementById('man2JanBg').classList.contains('abre')");
  vale("sem internet: guarda no aparelho e avisa", /ficou guardado neste aparelho/.test(await texto("#man2Toast")) && /1 registro ainda não chegou ao servidor/.test(await texto("#man2FilaAviso")));
  await ev("__man2Teste.offline=false"); await clicar('[data-m2acao="fila-tentar"]');
  vale("Tentar agora envia e o aviso some", await esperar("document.getElementById('man2FilaAviso').hidden===true"));
  vale("sem exceções (operacional desktop)", erros.length === 0, erros.join(" || ") || "nenhuma");

  /* ======================= B) GESTOR · 1280 ======================= */
  console.log("\n=== B) Gestor · 1280 ===");
  erros.length = 0;
  await abrir("papel=gestor"); await entrar();
  vale("gestor vê + Equipamento, Visão gerencial, Etiquetas e Auditoria", !(await ev("document.getElementById('man2BtnEquip').hidden")) && /Visão gerencial/.test(await texto("#man2Abas")) && !(await ev("document.querySelector('[data-m2menu=\"auditoria\"]').hidden")));
  const tSemG = await ev(tarefaSemServico);
  vale("rotina sem serviço (gestor): 'Completar rotina' e o aviso de que falta escolher (sem 'migrada')", /Completar rotina/.test(tSemG) && /Falta escolher o serviço/.test(tSemG) && !/Registre a primeira execução|migrada/i.test(tSemG), tSemG.replace(/\n/g, " | "));
  await ev("(function(){ var t=[].filter.call(document.querySelectorAll('#man2Lista .m2-tarefa'),function(x){ return /Balanças Caixa 101/.test(x.innerText); })[0]; t.querySelector('[data-m2acao=\"rotina-editar\"]').click(); })()");
  await esperar("document.getElementById('man2RotServ')");
  vale("'Completar rotina' abre a rotina para escolher o serviço", /veio da Manutenção antiga sem o serviço/.test(await texto("#man2JanCorpo")), (await texto("#man2JanCorpo")).slice(0, 120));
  await clicar('[data-m2j="form-cancelar"]'); await esp(200); await ev("man2FecharJan(true)"); await esp(100);
  await clicar('[data-m2acao="aba"][data-aba="gerencial"]'); await esperar("document.querySelector('.m2-ger')");
  vale("visão gerencial 30 dias: DADOS INSUFICIENTES", /DADOS INSUFICIENTES/.test(await texto("#man2Lista")), (await texto("#man2Lista")).slice(0, 120));
  await clicar('[data-m2acao="ger-dias"][data-dias="90"]'); await esperar("!/Carregando/.test(document.getElementById('man2Lista').innerText) && /\\d%/.test(document.querySelector('.m2-ger-grande').textContent)");
  vale("90 dias: percentual no prazo e blocos", /\d+(,\d)?%/.test(await texto(".m2-ger-grande")) && /Atrasos por setor/.test(await texto("#man2Lista")) && /Qualidade dos dados/.test(await texto("#man2Lista")) && (await rpcs("manutencao_gerencial")).map(p => p.p_dias).join(",") === "30,90", await texto(".m2-ger-grande"));
  // VIS-4: verde é "bom / em dia"; "Nenhum custo informado" não é bom -> cor neutra
  const gerCusto = await ev("(function(){ var b=[].filter.call(document.querySelectorAll('.m2-ger-bloco'),function(x){ return /^Custos/.test(x.querySelector('h3').textContent); })[0]; var g=b&&b.querySelector('.m2-ger-grande'); return g?g.textContent+'|'+getComputedStyle(g).color:'NAO ACHEI'; })()");
  vale("'Nenhum custo informado' em cor neutra (não no verde de destaque)", /^Nenhum custo informado\|/.test(gerCusto) && gerCusto.indexOf("rgb(12, 90, 38)") < 0 && gerCusto.indexOf("rgb(21, 122, 53)") < 0, gerCusto);
  const qualidade = async () => JSON.parse(await ev("(function(){ var b=[].filter.call(document.querySelectorAll('.m2-ger-bloco'),function(x){ return /Qualidade dos dados/.test(x.querySelector('h3').textContent); })[0]; return JSON.stringify(b?{txt:b.innerText,abrir:b.querySelectorAll('[data-m2acao=\"detalhes\"]').length}:{txt:'',abrir:-1}); })()"));
  const q1 = await qualidade(), nProc = +((/Equipamento sem procedimento escrito · (\d+) equipamentos/.exec(q1.txt) || [])[1] || 0);
  vale("Qualidade dos dados: o mesmo tipo com mais de 3 itens vira 1 linha com a contagem e 'Ver lista'; tipo com 1 item continua solto",
    nProc > 3 && (q1.txt.match(/Equipamento sem procedimento escrito/g) || []).length === 1 && /Ver lista/.test(q1.txt) && /Rotina migrada: confirmar o tipo de serviço · Balanças Caixa 101/.test(q1.txt) && q1.abrir < 10,
    q1.abrir + " Abrir · " + q1.txt.replace(/\n/g, " | ").slice(0, 300));
  await clicar('[data-m2acao="ger-qual"][data-tipo="equipamento_sem_procedimento"]'); await esp(80);
  const q2 = await qualidade();
  vale("'Ver lista' abre os itens do grupo, cada um com o seu 'Abrir'", q2.abrir === q1.abrir + nProc && /Esconder lista/.test(q2.txt), q1.abrir + " -> " + q2.abrir);
  await clicar('[data-m2acao="aba"][data-aba="atencao"]');
  await clicar('#man2Lista .m2-tarefa [data-m2acao="detalhes"]:not([data-aba])'); await esperar("/Editar/.test(document.getElementById('man2JanCab').innerText)");
  vale("gestor vê Editar / Etiqueta QR / Auditoria / Inativar, e não vê Excluir definitivo", /Editar/.test(await texto("#man2JanCab")) && /Etiqueta QR/.test(await texto("#man2JanCab")) && /Inativar/.test(await texto("#man2JanCab")) && !/Excluir/.test(await texto("#man2JanCab")));
  await clicar('[data-m2j="det-aba"][data-aba="historico"]'); await esperar("document.querySelectorAll('#man2JanCorpo .m2-hist-item').length>=20");
  let gh = await texto("#man2JanCorpo");
  vale("gestor: custo, nota, Anular (custo sem repetir a palavra: 'Custo: interno, sem custo')", /Custo: interno, sem custo/.test(gh) && !/Interno — sem custo/.test(gh) && /Abrir nota fiscal/.test(gh) && /\bAnular\b/.test(gh), (gh.match(/Custo: [^\n]*/) || [""])[0]);
  await clicar('[data-m2j="hist-mais"]'); await esperar("document.querySelectorAll('#man2JanCorpo .m2-hist-item').length>20");
  gh = await texto("#man2JanCorpo");
  vale("externo antigo: 'Custo: não informado' (nunca 'Custo: Custo não informado') + Informar custo", /Custo: não informado/.test(gh) && !/Custo: Custo/.test(gh) && /Informar custo/.test(gh), (gh.match(/Custo: [^\n]*não[^\n]*/) || [""])[0]);
  const cursores = (await rpcs("manutencao_historico")).filter(p => p.p_equipamento_id === "emr9b5cgj174").map(p => p.p_antes_de);
  vale("cursor do histórico = id da última linha", cursores[0] === null && typeof cursores[1] === "string", cursores);
  await clicar('[data-m2j="custo"]'); await esperar("document.getElementById('man2Dlg_custo')");
  await digitar("#man2Dlg_custo", "350,5"); await ev("document.getElementById('man2Dlg_custo').dispatchEvent(new FocusEvent('focusout',{bubbles:true}))");
  vale("máscara do custo ao sair do campo", (await ev("document.getElementById('man2Dlg_custo').value")) === "350,50");
  await clicar('[data-m2d="ok"]'); await esperar("!document.getElementById('man2DlgBg')");
  vale("custo informado pelo contrato (null != 0)", J((await rpcs("manutencao_custo_informar"))[0]) === J({ p_execucao_id: (await rpcs("manutencao_custo_informar"))[0].p_execucao_id, p_custo: 350.5, p_motivo: null }));
  await esperar("/Custo: R\\$ 350,50/.test(document.getElementById('man2JanCorpo').innerText)");
  vale("histórico mostra o custo novo", /Custo: R\$ 350,50/.test(await texto("#man2JanCorpo")));
  await clicar('[data-m2j="anular"]'); await esperar("document.getElementById('man2Dlg_motivo')");
  await digitar("#man2Dlg_motivo", "abc"); await clicar('[data-m2d="ok"]'); await esp(80);
  vale("anular: motivo curto recusado na tela", /pelo menos 5 letras/.test(await texto("#man2DlgBg")) && (await rpcs("manutencao_execucao_anular")).length === 0);
  await digitar("#man2Dlg_motivo", "Lançado no equipamento errado"); await clicar('[data-m2d="ok"]'); await esperar("!document.getElementById('man2DlgBg')");
  vale("anular chama a RPC com motivo", (await rpcs("manutencao_execucao_anular")).length === 1 && (await rpcs("manutencao_execucao_anular"))[0].p_motivo === "Lançado no equipamento errado");
  await esperar("document.querySelectorAll('#man2JanCorpo .m2-hist-item.anulada').length>=2");
  vale("depois de anular, o item aparece riscado", (await qtd("#man2JanCorpo .m2-hist-item.anulada")) >= 2);
  // etiqueta QR (janela capturada)
  await ev("window.__abertas=[]; window.open=function(){ var d={html:'',open:function(){this.html='';},write:function(x){this.html+=x;},close:function(){}}; var w={document:d,location:{},close:function(){},focus:function(){},print:function(){}}; window.__abertas.push(w); return w; }; 1");
  await clicar('[data-m2j="etiqueta"]'); await esp(80);
  const et1 = await ev("(window.__abertas.slice(-1)[0]||{document:{html:''}}).document.html");
  vale("etiqueta QR: código grande, nome, setor e QR", /EQ-0001/.test(et1) && /Camera Fria de Congelado/.test(et1) && /<svg/.test(et1) && et1.indexOf("<button") < 0);
  const urlEt = await ev("man2UrlEquipamento(location.origin,location.pathname,'emr9b5cgj174')");
  vale("URL do QR = origem + caminho + #man/<id>", /pagina\.html#man\/emr9b5cgj174$/.test(urlEt), urlEt);
  // conflito ao editar
  await clicar('[data-m2j="det-aba"][data-aba="situacao"]'); await clicar('[data-m2j="equip-editar"]'); await esperar("document.getElementById('man2EqNome')");
  await digitar("#man2EqNome", "Câmara Fria de Congelados"); await ev("__man2Falso.achaEq('emr9b5cgj174').versao++; 1");
  // mensagem REAL do banco (manutencao_equipamento_salvar, conflito) — o servidor de mentira devolve a mesma
  await clicar('[data-m2j="equip-salvar"]'); await esperar("/foi alterado por outra pessoa/.test(document.getElementById('man2JanCorpo').innerText)");
  vale("editar com versão velha: conflito na tela, sem perder o digitado", /Carregar a versão atual/.test(await texto("#man2JanCorpo")) && (await ev("document.getElementById('man2EqNome').value")) === "Câmara Fria de Congelados");
  await clicar('[data-m2j="equip-recarregar"]'); await esperar("document.getElementById('man2EqNome') && document.getElementById('man2EqNome').value==='Camera Fria de Congelado'");
  await clicar('[data-m2j="form-cancelar"]'); await esperar("document.querySelector('[data-m2j=\"rotina-editar\"]')");
  // editar rotina com histórico: justificativa
  await clicar('[data-m2j="rotina-editar"]'); await esperar("document.getElementById('man2RotPer')");
  vale("justificativa escondida enquanto a periodicidade não muda", await ev("document.getElementById('man2RotJustBloco').hidden"));
  await digitar("#man2RotPer", "15");
  vale("mudar a periodicidade com histórico mostra a justificativa", !(await ev("document.getElementById('man2RotJustBloco').hidden")));
  await clicar('[data-m2j="rotina-salvar"]'); await esp(80);
  vale("sem justificativa não envia", /Explique por que a periodicidade mudou/.test(await texto("#man2JanCorpo")) && (await rpcs("manutencao_rotina_salvar")).length === 0);
  await digitar("#man2RotJust", "Pedido do dono: câmara suja muito");
  // outra pessoa salva a mesma rotina antes (versão sobe no servidor)
  await ev("(function(){ var r=__man2Falso.S.rotinas.filter(function(x){ return x.equipamento_id==='emr9b5cgj174' && x.ativa; })[0]; r.versao++; })(); 1");
  await clicar('[data-m2j="rotina-salvar"]'); await esperar("/alterada por outra pessoa/.test(document.getElementById('man2JanCorpo').innerText)");
  vale("rotina: conflito oferece 'Carregar a versão atual' (salvar de novo mandaria a versão velha)", /Carregar a versão atual/.test(await texto("#man2JanCorpo")), (await texto("#man2JanCorpo")).slice(-160));
  const vVelha = ((await rpcs("manutencao_rotina_salvar")).slice(-1)[0] || { p: {} }).p.versao;
  await clicar('[data-m2j="rotina-recarregar"]');
  await esperar("document.getElementById('man2RotPer') && document.getElementById('man2RotPer').value==='30' && !/alterada por outra pessoa/.test(document.getElementById('man2JanCorpo').innerText)");
  vale("'Carregar a versão atual' reabre a rotina com os dados do servidor", (await ev("document.getElementById('man2RotPer').value")) === "30");
  await digitar("#man2RotPer", "15"); await digitar("#man2RotJust", "Pedido do dono: câmara suja muito"); await clicar('[data-m2j="rotina-salvar"]');
  await esperar("document.querySelector('#man2JanCorpo .m2-bloco') && /A cada 15 dias/.test(document.getElementById('man2JanCorpo').innerText)");
  const rs1 = (await rpcs("manutencao_rotina_salvar")).slice(-1)[0] || {};
  vale("rotina salva com a versão ATUAL e a justificativa, e volta aos Detalhes", rs1.p && rs1.p.periodicidade_dias === 15 && rs1.p.justificativa === "Pedido do dono: câmara suja muito" && rs1.p.versao === vVelha + 1 && /A cada 15 dias/.test(await texto("#man2JanCorpo")), J(rs1.p));
  await clicar('[data-m2j="fechar"]'); await esp(60);
  // rotina nova pelo card + inativar
  await clicar('[data-m2acao="aba"][data-aba="todos"]'); await digitar("#man2Busca", "gerador"); await esp(350);
  vale("card sem programação: gestor vê 'Configurar rotina'; nunca Editar/Inativar no card", /Configurar rotina/.test(await texto("#man2Lista")) && !/Editar|Inativar/.test(await texto("#man2Lista")));
  await clicar('[data-m2acao="rotina-nova"]'); await esperar("document.getElementById('man2RotServ')");
  await mudar("#man2RotServ", "Inspeção"); await digitar("#man2RotPer", "90");
  await esperar("document.querySelector('[data-m2pesres=\"resp\"] [data-m2j=\"pes-escolher\"]')");
  // VIS-3: um rótulo só ("Responsável pela rotina"), sem o título "Responsável" em cima
  vale("rotina: o responsável tem UM rótulo ('Responsável pela rotina')", ((await texto("#man2JanCorpo")).match(/Responsável/g) || []).length === 1 && /Responsável pela rotina/.test(await texto("#man2JanCorpo")), ((await texto("#man2JanCorpo")).match(/[^\n]*Responsável[^\n]*/g) || []).join(" | "));
  await escolherPessoa("resp", "frios");   // busca também pelo setor da pessoa
  vale("rotina: com a pessoa escolhida o rótulo continua ('Responsável pela rotina' + nome + Trocar)", /Responsável pela rotina\s*Zé · Frios/.test(await texto("#man2JanCorpo")) && ((await texto("#man2JanCorpo")).match(/Responsável/g) || []).length === 1, ((await texto("#man2JanCorpo")).match(/[^\n]*Responsável[^\n]*\n?[^\n]*/g) || []).join(" | "));
  await clicar('[data-m2j="rotina-salvar"]'); await esperar("document.querySelector('[data-m2j=\"rotina-editar\"]')");
  const rs2 = (await rpcs("manutencao_rotina_salvar")).slice(-1)[0].p;
  vale("rotina nova com responsável da lista", rs2.tipo_servico === "Inspeção" && rs2.periodicidade_dias === 90 && J(rs2.responsavel) === J({ ref: "escala:r1", nome: "Zé", perfil_id: null }) && !("id" in rs2), J(rs2));
  await clicar('[data-m2j="inativar"]'); await esperar("document.getElementById('man2Dlg_motivo')");
  vale("inativar explica o que acontece", /Não aparece mais na fila, não gera vencimentos e continua com todo o histórico/.test(await texto("#man2DlgBg")));
  await digitar("#man2Dlg_motivo", "Gerador vendido"); await clicar('[data-m2d="ok"]'); await esperar("!document.getElementById('man2DlgBg')");
  vale("inativar pelo contrato", J(Object.keys((await rpcs("manutencao_equipamento_inativar"))[0] || {})) === J(["p_id", "p_versao", "p_motivo"]));
  await clicar('[data-m2j="fechar"]'); await esperar("!/Gerador/.test(document.getElementById('man2Lista').innerText)");
  vale("inativo some da lista", !/Gerador/.test(await texto("#man2Lista")));
  await clicar("#man2BtnMenu"); await clicar('[data-m2menu="inativos"]'); await esperar("/Gerador/.test(document.getElementById('man2Lista').innerText)");
  vale("Mostrar inativos traz de volta com a pílula Inativo", /Inativo/.test(await texto("#man2Lista")) && (await rpcs("manutencao_painel")).slice(-1)[0].p_incluir_inativos === true);
  await digitar("#man2Busca", ""); await esp(300);
  // novo equipamento em lote, com prévia
  await clicar("#man2BtnEquip"); await esperar("document.getElementById('man2EqNome')");
  await digitar("#man2EqNome", "Balança Teste"); await mudar("#man2EqTipo", "Balança"); await mudar("#man2EqSetor", "Frente de caixa");
  await digitar("#man2EqQtd", "3"); await digitar("#man2EqIni", "8");
  vale("prévia dos nomes do lote", (await texto("#man2EqPrevia")) === "Serão criados: Balança Teste 08 … Balança Teste 10 (3 equipamentos)", await texto("#man2EqPrevia"));
  await clicar('[data-m2j="equip-salvar"]'); await esperar("document.querySelector('#uiModal.show')");
  const lote0 = ((await rpcs("manutencao_equipamentos_lote"))[0] || {}).p || {};
  vale("lote pelo contrato (com a identificação do formulário, para reenvio não duplicar) e oferece configurar rotinas",
    J(Object.assign({}, lote0, { request_id: "x" })) === J({ nome_base: "Balança Teste", quantidade: 3, inicio: 8, tipo: "Balança", setor: "Frente de caixa", request_id: "x" }) && /^[0-9a-f-]{36}$/.test(lote0.request_id || "")
    && /Configurar rotinas agora/.test(await ev("document.getElementById('uiModalOk').textContent")), J(lote0));
  await clicar("#uiModalCancel"); await esp(80);
  // novo equipamento com PDF do fabricante: sobe só ao salvar, caminho único
  await clicar("#man2BtnEquip"); await esperar("document.getElementById('man2EqNome')");
  await digitar("#man2EqNome", "Forno Exemplo"); await mudar("#man2EqTipo", "__outro"); await digitar("#man2EqTipoOutro", "Forno"); await mudar("#man2EqSetor", "Padaria");
  await ev("__man2Teste.log.length=0"); await arquivo("#man2EqPdf", "application/pdf", "manual-forno.pdf"); await esp(80);
  vale("PDF escolhido não sobe antes de salvar", !/upload:/.test(await ev("__man2Teste.log.join(',')")) && /manual-forno\.pdf/.test(await texto("#man2JanCorpo")));
  await clicar('[data-m2j="equip-salvar"]'); await esperar("document.querySelector('#uiModal.show')");
  const log2 = await ev("__man2Teste.log.join(',')");
  vale("ordem: salvar equipamento, subir PDF em v2/manual_fabricante/<uuid>.pdf, ligar o anexo", /rpc:manutencao_equipamento_salvar,upload:v2\/manual_fabricante\/[0-9a-f-]{36}\.pdf,rpc:manutencao_anexo_equipamento/.test(log2), log2);
  await clicar("#uiModalCancel"); await esp(60);
  // DUP-NOME: o banco recusa nome igual ao de outro equipamento ATIVO (criar e editar); a tela marca o campo nome
  // o corpo da janela fechada continua com o formulário anterior: esperar pelo formulário ABERTO de agora
  const formEquip = (nome) => "document.getElementById('man2JanBg').classList.contains('abre') && man2Form && man2Form.kind==='equipamento' && !man2Form.salvando && document.getElementById('man2EqNome') && document.getElementById('man2EqNome').value===" + J(nome);
  const campoNomeComErro = "document.getElementById('man2EqNome') && document.getElementById('man2EqNome').closest('.m2-campo').classList.contains('erro') && /Já existe equipamento ativo com este nome/.test(document.getElementById('man2EqNome').closest('.m2-campo').innerText)";
  await clicar("#man2BtnEquip"); await esperar("document.getElementById('man2EqNome')");
  await digitar("#man2EqNome", "balanças caixa 101 "); await mudar("#man2EqTipo", "Balança"); await mudar("#man2EqSetor", "Frente de caixa");
  await clicar('[data-m2j="equip-salvar"]');
  vale("novo com nome de equipamento ativo: recusado, mensagem no campo nome e o formulário continua aberto", (await esperar(campoNomeComErro)) && (await janela()) && !(await ev("!!document.querySelector('#uiModal.show')")) && (await ev("man2Form && man2Form.kind")) === "equipamento", await texto("#man2JanCorpo"));
  await digitar("#man2EqNome", "Empilhadeira Antiga");
  await clicar('[data-m2j="equip-salvar"]');
  vale("nome de equipamento INATIVO pode repetir", await esperar("document.querySelector('#uiModal.show') && /Equipamento cadastrado/.test(document.getElementById('uiModalMsg').textContent)"), await modal());
  await clicar("#uiModalCancel"); await esp(60);
  await ev("man2AbrirEquipamento('eqbalcao')"); await esperar(formEquip("Balcão Refrigerado Frios"));
  await digitar("#man2EqNome", "Camera Fria Resfriado"); await clicar('[data-m2j="equip-salvar"]');
  vale("editar para o nome de outro equipamento ativo: recusado no campo nome, formulário aberto", (await esperar(campoNomeComErro)) && (await janela()));
  await digitar("#man2EqNome", "Balcão Refrigerado Frios"); await digitar("#man2EqProc", "1) Desligar e limpar o balcão.");
  await clicar('[data-m2j="equip-salvar"]');
  vale("salvar o próprio equipamento sem mudar o nome continua aceito", (await esperar("!document.getElementById('man2JanBg').classList.contains('abre') && !man2Form && /Equipamento salvo/.test((document.getElementById('man2Toast')||{}).textContent||'')")) && (await ev("__man2Falso.achaEq('eqbalcao').procedimento")) === "1) Desligar e limpar o balcão.", await texto("#man2Toast"));
  // PED-01: gravou mas a resposta se perdeu
  const ultimoRq = async () => ((await rpcs("manutencao_equipamento_salvar")).slice(-1)[0] || { p: {} }).p.request_id;
  await ev("man2AbrirEquipamento('eqgelbeb')"); await esperar(formEquip("Geladeira Bebidas"));
  await digitar("#man2EqNome", "Geladeira Bebidas Salão"); await ev("__man2Teste.perderResposta='manutencao_equipamento_salvar'; 1");
  await clicar('[data-m2j="equip-salvar"]');
  vale("resposta perdida: 'Não deu para confirmar se foi salvo' e o formulário continua aberto", (await esperar("man2Form && !man2Form.salvando && /Não deu para confirmar se foi salvo/.test(document.getElementById('man2JanCorpo').innerText)")) && (await janela()));
  const rqA = await ultimoRq();
  await clicar('[data-m2j="equip-salvar"]');
  vale("salvar de novo SEM mudar nada: mesmo request_id e o servidor devolve o mesmo resultado (salvo)", (await esperar("!document.getElementById('man2JanBg').classList.contains('abre') && !man2Form && /Equipamento salvo/.test((document.getElementById('man2Toast')||{}).textContent||'')")) && (await ultimoRq()) === rqA, rqA);
  await ev("man2AbrirEquipamento('eqgelbeb')"); await esperar(formEquip("Geladeira Bebidas Salão"));
  await digitar("#man2EqNome", "Geladeira Bebidas Frente"); await ev("__man2Teste.perderResposta='manutencao_equipamento_salvar'; 1");
  await clicar('[data-m2j="equip-salvar"]'); await esperar("man2Form && !man2Form.salvando && /Não deu para confirmar se foi salvo/.test(document.getElementById('man2JanCorpo').innerText)");
  const rqB = await ultimoRq();
  await ev("man2Form.nome='Geladeira Outro Nome'; 1");   // mesmo formulário (mesmo request_id) com dados diferentes
  await clicar('[data-m2j="equip-salvar"]');
  vale("mesmo request_id com dados diferentes: o servidor recusa e a tela NÃO finge sucesso — mostra a mensagem e 'Carregar os dados atuais'",
    (await esperar("/Carregar os dados atuais/.test(document.getElementById('man2JanCorpo').innerText)")) && (await janela()) && (await ultimoRq()) === rqB && (await ev("__man2Falso.achaEq('eqgelbeb').nome")) === "Geladeira Bebidas Frente",
    (await texto("#man2JanCorpo")).slice(-200));
  await clicar('[data-m2j="equip-recarregar"]');
  vale("'Carregar os dados atuais' reabre com o que está gravado", await esperar(formEquip("Geladeira Bebidas Frente") + " && !/Carregar os dados atuais/.test(document.getElementById('man2JanCorpo').innerText)"));
  await digitar("#man2EqNome", "Geladeira Bebidas Mercearia"); await ev("__man2Teste.perderResposta='manutencao_equipamento_salvar'; 1");
  await clicar('[data-m2j="equip-salvar"]'); await esperar("man2Form && !man2Form.salvando && /Não deu para confirmar se foi salvo/.test(document.getElementById('man2JanCorpo').innerText)");
  const rqC = await ultimoRq();
  await digitar("#man2EqNome", "Geladeira Bebidas Mercearia 2"); await clicar('[data-m2j="equip-salvar"]');
  await esperar("document.querySelectorAll('#man2JanCorpo .m2-erro').length && !/Salvando/.test(document.getElementById('man2JanRodape').innerText)");
  const rqD = await ultimoRq();
  vale("EDIÇÃO: mudou o formulário depois da falha de rede: o novo envio leva request_id NOVO (a versão protege)", !!rqC && !!rqD && rqC !== rqD, rqC + " -> " + rqD);
  await ev("man2FecharJan(true)"); await esp(80);
  // CADASTRO NOVO e LOTE: corrigir o nome depois de "Não deu para confirmar" não cria um 2º equipamento (mesmo request_id -> conflito)
  const fecharModal = () => ev("(function(){ var m=document.querySelector('#uiModal.show'); if(m) document.getElementById('uiModalCancel').click(); return 1; })()");
  const qtdNome = (re) => ev("__man2Falso.S.equipamentos.filter(function(e){ return " + re + ".test(e.nome); }).length");
  const cadastroIncerto = async (nome, qtdLote, rpcNome) => {
    await clicar("#man2BtnEquip"); await esperar("document.getElementById('man2EqNome')");
    await digitar("#man2EqNome", nome); if (qtdLote) await digitar("#man2EqQtd", String(qtdLote));
    await mudar("#man2EqTipo", "Balança"); await mudar("#man2EqSetor", "Frente de caixa");
    await ev("__man2Teste.perderResposta=" + J(rpcNome) + "; 1");
    await clicar('[data-m2j="equip-salvar"]');
    await esperar("man2Form && !man2Form.salvando && /Não deu para confirmar se foi salvo/.test(document.getElementById('man2JanCorpo').innerText)");
    return ((await rpcs(rpcNome)).slice(-1)[0] || { p: {} }).p.request_id;
  };
  const depoisDoSegundo = "document.querySelector('#uiModal.show') || (man2Form && !man2Form.salvando && /Carregar os dados atuais/.test(document.getElementById('man2JanCorpo').innerText))";
  const rqN1 = await cadastroIncerto("Freezer Sorvete Acougue", 0, "manutencao_equipamento_salvar");
  await digitar("#man2EqNome", "Freezer Sorvete Açougue"); await clicar('[data-m2j="equip-salvar"]'); await esperar(depoisDoSegundo);
  const rqN2 = ((await rpcs("manutencao_equipamento_salvar")).slice(-1)[0] || { p: {} }).p.request_id;
  vale("CADASTRO NOVO: resposta perdida, corrigiu o nome e clicou Cadastrar: mesmo request_id, recusa com 'Carregar os dados atuais' e 1 equipamento só",
    !(await ev("!!document.querySelector('#uiModal.show')")) && /Carregar os dados atuais/.test(await texto("#man2JanCorpo")) && rqN1 === rqN2 && (await qtdNome("/^Freezer Sorvete A/")) === 1,
    rqN1 + " -> " + rqN2 + " · no servidor: " + (await qtdNome("/^Freezer Sorvete A/")) + " · " + (await modal()));
  await fecharModal();
  if (await ev("!!(man2Form && document.querySelector('[data-m2j=\"equip-recarregar\"]'))")) {
    await clicar('[data-m2j="equip-recarregar"]');
    vale("'Carregar os dados atuais' no cadastro novo fecha o formulário e mostra na lista o que foi gravado",
      await esperar("!man2Form && /Freezer Sorvete Acougue/.test((document.getElementById('man2Lista')||{}).innerText||'')"), (await texto("#man2Lista")).slice(0, 160));
  } else await ev("man2FecharJan(true); 1");
  await ev("man2.filtros=man2FiltrosVazios(); var bu=document.getElementById('man2Busca'); if(bu) bu.value=''; man2DesenharPagina(); 1"); await esp(80);
  const rqL1 = await cadastroIncerto("Balanca Deposito", 3, "manutencao_equipamentos_lote");
  await digitar("#man2EqNome", "Balança Depósito"); await clicar('[data-m2j="equip-salvar"]'); await esperar(depoisDoSegundo);
  const rqL2 = ((await rpcs("manutencao_equipamentos_lote")).slice(-1)[0] || { p: {} }).p.request_id;
  vale("LOTE: resposta perdida, corrigiu o nome base e clicou de novo: mesmo request_id, recusa com 'Carregar os dados atuais' e só os 3 do 1º lote",
    !(await ev("!!document.querySelector('#uiModal.show')")) && /Carregar os dados atuais/.test(await texto("#man2JanCorpo")) && rqL1 === rqL2 && (await qtdNome("/^Balan.a Dep.sito/")) === 3,
    rqL1 + " -> " + rqL2 + " · no servidor: " + (await qtdNome("/^Balan.a Dep.sito/")) + " · " + (await modal()));
  await fecharModal(); await ev("man2FecharJan(true); 1"); await esp(80);
  // cancelar pendência
  await ev("man2AbrirDetalhes('emraqg6gz805','pendencias')"); await esperar("document.querySelector('[data-m2j=\"pend-cancelar\"]')");
  await clicar('[data-m2j="pend-cancelar"]'); await esperar("document.getElementById('man2Dlg_motivo')");
  const botoesCanc = await ev("[].map.call(document.querySelectorAll('#man2DlgBg .m2-jan-rodape button'),function(b){ return b.textContent; }).join('|')");
  vale("diálogo 'Cancelar pendência': o botão de desistir diz 'Voltar' (não outro 'Cancelar')", botoesCanc === "Cancelar pendência|Voltar", botoesCanc);
  await digitar("#man2Dlg_motivo", "Aberta por engano"); await clicar('[data-m2d="ok"]'); await esperar("!document.getElementById('man2DlgBg')");
  // id de pendência é uuid no banco (p_id uuid); a semente usa um uuid fixo
  vale("cancelar pendência pelo contrato", J((await rpcs("manutencao_pendencia_cancelar"))[0]) === J({ p_id: "00000000-0000-4000-8000-00000000e002", p_versao: 1, p_motivo: "Aberta por engano" }));
  vale("pendência cancelada mostra QUEM cancelou", await esperar("/Cancelada por Gestor Exemplo em \\d\\d\\/\\d\\d\\/\\d{4} às \\d\\d:\\d\\d — Aberta por engano/.test(document.getElementById('man2JanCorpo').innerText)"), (await texto("#man2JanCorpo")).slice(0, 200));
  await clicar('[data-m2j="fechar"]'); await esp(60);
  await ev("man2AbrirDetalhes('eqfreezer','situacao')"); await esperar("document.querySelector('[data-m2j=\"rotina-desativar\"]')");
  await clicar('[data-m2j="rotina-desativar"]'); await esperar("document.getElementById('man2Dlg_motivo')");
  await digitar("#man2Dlg_motivo", "Serviço terceirizado"); await clicar('[data-m2d="ok"]'); await esperar("!document.getElementById('man2DlgBg')");
  vale("rotina desativada mostra QUEM desativou", await esperar("/Desativada por Gestor Exemplo em \\d\\d\\/\\d\\d\\/\\d{4} às \\d\\d:\\d\\d — Serviço terceirizado/.test(document.getElementById('man2JanCorpo').innerText)"), (await texto("#man2JanCorpo")).slice(-200));
  await clicar('[data-m2j="fechar"]'); await esp(60);
  // etiquetas da tela (respeita filtros) e auditoria
  await mudar("#man2FSetor", "Frente de caixa"); await clicar("#man2BtnMenu"); await clicar('[data-m2menu="etiquetas"]'); await esp(100);
  const et2 = await ev("(window.__abertas.slice(-1)[0]||{document:{html:''}}).document.html");
  const nEt = (et2.match(/class="et"/g) || []).length, nFolha = (et2.match(/class="folha"/g) || []).length;
  vale("Etiquetas QR respeitam o filtro: 12 por folha A4", nEt >= 37 && nFolha === Math.ceil(nEt / 12) && /@page\{size:A4/.test(et2), nEt + " etiquetas, " + nFolha + " folhas");
  await mudar("#man2FSetor", "");
  await clicar("#man2BtnMenu"); await clicar('[data-m2menu="auditoria"]'); await esperar("document.querySelectorAll('.m2-aud-item').length>=50");
  vale("Auditoria: 50 + Carregar mais, com antes -> depois e justificativa", (await qtd(".m2-aud-item")) === 50 && /Carregar mais/.test(await texto("#man2JanCorpo")) && /→/.test(await texto("#man2JanCorpo")) && /Justificativa:/.test(await texto("#man2JanCorpo")));
  await clicar('[data-m2j="aud-mais"]'); await esperar("document.querySelectorAll('.m2-aud-item').length>50");
  vale("Carregar mais usa o cursor", (await rpcs("manutencao_auditoria_listar")).slice(-1)[0].p_antes_de != null && (await qtd(".m2-aud-item")) > 50);
  await clicar('[data-m2j="fechar"]');
  vale("sem exceções (gestor desktop)", erros.length === 0, erros.join(" || ") || "nenhuma");

  /* ======================= C) MASTER: excluir definitivo ======================= */
  console.log("\n=== C) Master · excluir definitivo ===");
  erros.length = 0;
  await abrir("papel=master"); await entrar();
  await ev("man2AbrirDetalhes('eqbal137','situacao')"); await esperar("/Excluir definitivo/.test(document.getElementById('man2JanCab').innerText)");
  vale("master vê Excluir definitivo em equipamento sem histórico", /Excluir definitivo/.test(await texto("#man2JanCab")));
  await ev("man2AbrirDetalhes('emr9b5cgj174','situacao')"); await esperar("document.querySelectorAll('#man2JanCab .m2-gestor .m2-btn').length>=3"); await esp(300);
  vale("…e NÃO vê em equipamento com histórico", !/Excluir definitivo/.test(await texto("#man2JanCab")));
  await ev("man2AbrirDetalhes('eqbal137','situacao')"); await esperar("/Excluir definitivo/.test(document.getElementById('man2JanCab').innerText)");
  await clicar('[data-m2j="excluir"]'); await esperar("document.querySelector('#uiModal.show')"); await clicar("#uiModalOk");
  await esperar("document.querySelector('#smModal.show')");
  await digitar("#smSenha", "0000"); await clicar("#smOk"); await esperar("document.getElementById('smErro').style.display!=='none'");
  vale("senha errada: nada é excluído", /incorreta/.test(await texto("#smErro")) && (await rpcs("manutencao_equipamento_excluir")).length === 0);
  await digitar("#smSenha", "1234"); await clicar("#smOk"); await esperar("/Equipamento excluído/.test((document.getElementById('man2Toast')||{}).textContent||'')");
  vale("senha do master passa para a RPC e exclui", J((await rpcs("manutencao_equipamento_excluir"))[0]) === J({ p_id: "eqbal137", p_senha: "1234" }));
  vale("sem exceções (master)", erros.length === 0, erros.join(" || ") || "nenhuma");

  /* ======================= D) LINK DIRETO e SINO ======================= */
  console.log("\n=== D) Link #man/<id> e sino ===");
  erros.length = 0;
  await abrir("papel=operacional", 1280, "#man/emraqg6gz805");
  vale("com login: abre a página e os Detalhes do equipamento", await esperar("document.getElementById('man2JanBg') && document.getElementById('man2JanBg').classList.contains('abre') && /Camera Fria Resfriado/.test(document.getElementById('man2JanCab').innerText)", 10000));
  vale("hash limpo depois de usar", (await ev("location.hash")) === "" && (await ev("sessionStorage.getItem('man2_destino')")) === null);
  await abrir("papel=operacional&logado=0", 1280, "#man/emraqg6gz805");
  await esperar("getComputedStyle(document.getElementById('authOv')).display!=='none' && document.getElementById('authLoginBox').style.display!=='none'");
  vale("sem login: tela de login e destino guardado", /emraqg6gz805/.test(await ev("sessionStorage.getItem('man2_destino')||''")) && !(await janela()));
  await digitar("#authEmail", "exemplo@previa"); await digitar("#authSenha", "qualquer"); await clicar("#authBtn");
  vale("depois do login: abre os Detalhes do link", await esperar("document.getElementById('man2JanBg') && document.getElementById('man2JanBg').classList.contains('abre') && /Camera Fria Resfriado/.test(document.getElementById('man2JanCab').innerText)", 10000));
  await abrir("papel=nenhum", 1280, "#man/emr9b5cgj174");
  vale("sem permissão: mensagem clara, nada aberto", await esperar("/Você não tem acesso à Manutenção\\. Peça ao gestor\\./.test(document.getElementById('uiModalMsg')&&document.querySelector('#uiModal.show')?document.getElementById('uiModalMsg').textContent:'')") && !(await janela()));
  await abrir("papel=operacional", 1280, "#man/nao-existe-123");
  vale("inexistente: mensagem clara", await esperar("/Equipamento não encontrado/.test(document.querySelector('#uiModal.show')?document.getElementById('uiModalTit').textContent:'')", 10000), await modal());
  await abrir("papel=gestor", 1280, "#man/eqempilha");
  vale("inativo: abre com aviso claro", await esperar("/Este equipamento está inativo\\./.test((document.getElementById('man2JanAviso')||{}).innerText||'')", 10000));
  await abrir("papel=gestor_so");
  vale("só a chave manutencoes_gestor já libera a página (e o papel gestor)", (await entrar()) && /Visão gerencial/.test(await texto("#man2Abas")));
  await abrir("papel=operacional");
  await esperar("document.getElementById('hSinoN') && document.getElementById('hSinoN').textContent==='3'");
  vale("sino: 3 avisos agregados (atrasadas, hoje, minhas pendências)", (await texto("#hSinoN")) === "3", await texto("#hSinoN"));
  await clicar("#hSino"); await esperar("document.querySelector('[data-av-man]')");
  const sino = await texto("#avLista");
  vale("sino: textos", /Manutenção: 2 tarefas atrasadas/.test(sino) && /Manutenção: 1 vence hoje/.test(sino) && /Manutenção: 1 pendência atribuída a você/.test(sino), sino.replace(/\n/g, " | "));
  await clicar('[data-av-man="atrasado"]');
  vale("'Ver' abre a Manutenção filtrada (nunca botão mudo)", await esperar("document.getElementById('page-manutencoes').classList.contains('ativo') && document.getElementById('man2FSituacao').value==='atrasado' && document.querySelectorAll('#man2Lista .m2-tarefa').length===2"));
  // selo do menu depois de a pessoa sair da página: vale o resumo mais novo (antes ficava o número do painel velho)
  vale("selo com a página aberta = 3", await esperar("document.getElementById('manNavBadge').textContent==='3'"), await texto("#manNavBadge"));
  await ev("document.getElementById('page-manutencoes').classList.remove('ativo'); var rz=__man2Falso.S.rotinas.filter(function(x){ return x.equipamento_id==='eqfreezer'; })[0]; rz.periodicidade_dias=5; 1");
  await ev("man2AtualizarResumo(true)");
  vale("página fechada e mais uma tarefa atrasou: o selo acompanha o resumo (3 -> 4), igual ao sino", (await texto("#manNavBadge")) === "4" && /4 tarefas atrasadas|3 tarefas atrasadas/.test(JSON.stringify(await ev("JSON.stringify(man2AvisosSino())"))), await texto("#manNavBadge"));
  await ev("__man2Falso.S.rotinas.filter(function(x){ return x.equipamento_id==='eqfreezer'; })[0].periodicidade_dias=30; document.getElementById('page-manutencoes').classList.add('ativo'); 1");
  // VENC-01: página aberta; outra pessoa fez a tarefa "vence hoje" e o relógio de 2 min recarregou o painel
  // (o resumo do sino só viria em 10 min): selo, KPI e sino têm que dizer o mesmo
  await ev("__man2Falso.S.rotinas.filter(function(x){ return x.equipamento_id==='eqbal102'; })[0].periodicidade_dias=8; man2Carregar().then(function(){ return 1; })");
  await esperar("document.querySelector('[data-kpi=\"hoje\"] .v') && document.querySelector('[data-kpi=\"hoje\"] .v').textContent==='0'");
  const sinoAgora = await ev("JSON.stringify(man2AvisosSino().map(function(a){ return a.titulo; }))");
  vale("painel recarregado com a página aberta: selo 2, KPI 'Vencem hoje' 0 e o sino sem o '1 vence hoje' velho",
    (await texto("#manNavBadge")) === "2" && (await kpi("hoje")) === "0" && !/vence hoje/.test(sinoAgora) && /2 tarefas atrasadas/.test(sinoAgora) && (await esperar("document.getElementById('hSinoN').textContent==='2'", 3000)),
    (await texto("#manNavBadge")) + " · " + sinoAgora + " · sino " + (await texto("#hSinoN")));
  await ev("__man2Falso.S.rotinas.filter(function(x){ return x.equipamento_id==='eqbal102'; })[0].periodicidade_dias=7; man2Carregar().then(function(){ return 1; })");
  vale("sem exceções (link e sino)", erros.length === 0, erros.join(" || ") || "nenhuma");

  /* ======================= E) IMPRESSÃO -> PDF ======================= */
  console.log("\n=== E) Impressão da agenda no papel ===");
  await abrir("papel=operacional"); await entrar();
  await ev("window.__abertas=[]; window.open=function(){ var d={html:'',open:function(){this.html='';},write:function(x){this.html+=x;},close:function(){}}; var w={document:d,location:{},close:function(){},focus:function(){},print:function(){}}; window.__abertas.push(w); return w; }; 1");
  await clicar("#man2BtnMenu"); await clicar('[data-m2menu="imprimir"]'); await esperar("document.getElementById('man2Dlg_ate')");
  vale("'Até' vem com hoje + 7", (await ev("document.getElementById('man2Dlg_ate').value")) === "2026-09-21");
  await clicar('[data-m2d="ok"]'); await esperar("window.__abertas[0] && /Pendências abertas/.test(window.__abertas[0].document.html)");
  const agenda = await ev("window.__abertas[0].document.html");
  vale("agenda em janela própria, sem botões", /<title>Agenda de manutenção e limpeza<\/title>/.test(agenda) && agenda.indexOf("<button") < 0 && /window\.print\(\)/.test(agenda));
  const temPdf = (() => { try { execSync("command -v pdftotext", { stdio: "ignore" }); return true; } catch (e) { return false; } })();
  if (!temPdf) vale("pdftotext disponível para provar no papel", false, "instale poppler");
  else {
    const fHtml = path.join(TMP, "agenda.html"), fPdf = path.join(TMP, "agenda.pdf");
    fs.writeFileSync(fHtml, agenda.replace(/<script>[\s\S]*?<\/script>/g, ""));
    // impressão do Chrome sem tela (a mesma do --print-to-pdf), pedida ao Chrome que já está aberto
    await cmd("Emulation.clearDeviceMetricsOverride");
    await cmd("Page.navigate", { url: "file://" + fHtml });
    await esperar("document.readyState==='complete' && /Agenda/.test(document.title)");
    const impresso = await cmd("Page.printToPDF", { preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false });
    fs.writeFileSync(fPdf, Buffer.from(impresso.result.data, "base64"));
    const txt = execFileSync("pdftotext", ["-layout", fPdf, "-"], { encoding: "utf8" }).replace(/\s+/g, " ");
    const bbox = execFileSync("pdftotext", ["-bbox", fPdf, "-"], { encoding: "utf8" });
    const pg = /<page width="([\d.]+)" height="([\d.]+)"/.exec(bbox) || [];
    vale("PDF em A4", Math.abs(+pg[1] - 595.3) < 2 && Math.abs(+pg[2] - 841.9) < 2, pg.slice(1).join(" x "));
    vale("PDF: título, autor, filtros e data", /Agenda de manutenção e limpeza/.test(txt) && /Gerada em \d\d\/\d\d\/\d{4} às \d\d:\d\d por Operador Exemplo/.test(txt) && /Filtros: Sem filtros/.test(txt) && /Até: 21\/09\/2026/.test(txt), txt.slice(0, 200));
    vale("PDF: as colunas", ["Código", "Equipamento", "Serviço", "Vencimento", "Situação", "Responsável", "Feito", "Assinatura", "Conferido"].every(w => txt.indexOf(w) >= 0));
    // texto de célula estreita quebra linha no papel ("Camera Fria de / Congelado"): confere palavra a palavra
    const faltam = ["Açougue", "Frente de caixa", "Camera", "Congelado", "Vencido há 40 dias", "Aguardando", "execução", "Pendências abertas", "Borracha da porta rasgada"].filter(w => txt.indexOf(w) < 0);
    vale("PDF: cabeçalho não parte palavra no meio", txt.indexOf("Responsável") >= 0 && !/Responsáv el/.test(txt), (txt.match(/Respons\S*( \S+)?/) || [""])[0]);
    vale("PDF: linhas por setor e pendências", !faltam.length, faltam.length ? "faltam: " + faltam.join(" | ") + " — texto: " + txt.slice(0, 900) : "ok");
    vale("PDF: nenhum botão", !/Imprimir|Fechar|Cancelar|Salvar/.test(txt));
  }

  /* ======================= F) CELULAR 390 / 360 ======================= */
  const MEDIR = `(function(raizSel){
    var raiz=document.querySelector(raizSel); if(!raiz) return JSON.stringify({erro:'sem '+raizSel});
    var vw=document.documentElement.clientWidth, pequenos=[], fontes=[], passando=[];
    function visivel(e){ var r=e.getBoundingClientRect(); if(r.width<=1||r.height<=1) return false; var cs=getComputedStyle(e); return cs.visibility!=='hidden' && cs.display!=='none' && r.bottom>0 && r.top<innerHeight; }
    raiz.querySelectorAll('button,select,input,textarea,a,label.m2-btn,label.m2-check').forEach(function(b){
      if(b.matches('input[type=checkbox],input[type=file],.m2-sr')||!visivel(b)) return;
      var r=b.getBoundingClientRect(); if(r.height<43.5||r.width<43.5) pequenos.push((b.id||b.className||b.tagName)+' '+Math.round(r.width)+'x'+Math.round(r.height)); });
    var ROT='label, label *, .m2-rotulo, .m2-rotulo *, .m2-pill, .m2-kpi .l';
    raiz.querySelectorAll('*').forEach(function(e){
      if(!visivel(e)) return;
      var tem=[].some.call(e.childNodes,function(n){ return n.nodeType===3&&n.textContent.trim(); }); if(!tem) return;
      var fs=parseFloat(getComputedStyle(e).fontSize), min=e.matches(ROT)?12:14;
      if(fs<min-0.01) fontes.push((e.className||e.tagName)+' '+fs+'px "'+e.textContent.trim().slice(0,20)+'"'); });
    raiz.querySelectorAll('*').forEach(function(e){ var r=e.getBoundingClientRect(); if(r.width>0&&r.right>vw+1&&getComputedStyle(e).position!=='fixed') passando.push((e.id||e.className||e.tagName)+' '+Math.round(r.right)); });
    var campos=[].map.call(raiz.querySelectorAll('input:not([type=checkbox]):not([type=file]),select,textarea'),function(i){ return visivel(i)?parseFloat(getComputedStyle(i).fontSize):99; }).filter(function(x){ return x<16; });
    return JSON.stringify({sw:document.documentElement.scrollWidth,vw:vw,pequenos:pequenos.slice(0,6),fontes:fontes.slice(0,6),passando:passando.slice(0,4),camposPequenos:campos.length});
  })`;
  const medir = async sel => JSON.parse(await ev(MEDIR + "(" + J(sel) + ")"));
  for (const larg of [390, 360]) {
    console.log("\n=== F) Operacional · " + larg + " px ===");
    erros.length = 0;
    await abrir("papel=operacional", larg); await entrar();
    vale(larg + ": a tela tem mesmo " + larg + " px", (await ev("innerWidth")) === larg, await ev("innerWidth"));
    let m = await medir("#man2Raiz");
    vale(larg + ": página sem rolagem horizontal", m.sw <= m.vw && !m.passando.length, m.sw + "/" + m.vw + " " + m.passando.join(","));
    vale(larg + ": página com toque >= 44 px", !m.pequenos.length, m.pequenos.join(" ; ") || "todos");
    vale(larg + ": página com fonte >= 14 px (rótulos >= 12)", !m.fontes.length, m.fontes.join(" ; ") || "ok");
    vale(larg + ": KPIs em 3 colunas e busca 16 px", (await ev("getComputedStyle(document.querySelector('.m2-kpis')).gridTemplateColumns.split(' ').length")) === 3 && (await ev("getComputedStyle(document.getElementById('man2Busca')).fontSize")) === "16px");
    await clicar("#man2BtnFiltros"); await esp(80);
    const fr = JSON.parse(await ev("(function(){ var r=document.getElementById('man2Filtros').getBoundingClientRect(), v=document.getElementById('man2FiltrosVer').getBoundingClientRect(); return JSON.stringify({x:r.left,y:r.top,w:r.width,h:r.height,verBaixo:v.bottom}); })()"));
    vale(larg + ": filtros numa folha em tela cheia com 'Ver resultados' no rodapé", fr.x === 0 && fr.y === 0 && Math.round(fr.w) === larg && Math.round(fr.h) === 844 && fr.verBaixo <= 844 && fr.verBaixo > 780, J(fr));
    m = await medir("#man2Filtros");
    vale(larg + ": folha de filtros — toque, fonte e campos 16 px", !m.pequenos.length && !m.fontes.length && !m.camposPequenos, J(m));
    await mudar("#man2FSetor", "Açougue"); await clicar("#man2FiltrosVer"); await esp(80);
    vale(larg + ": 'Ver resultados' fecha a folha e aplica", !(await ev("document.getElementById('man2Filtros').classList.contains('abre')")) && (await qtd("#man2Lista .m2-tarefa")) === 3 && /Filtros \(1\)/.test(await texto("#man2BtnFiltros")));
    await clicar("#man2BtnFiltros"); await clicar("#man2FiltrosLimpar"); await clicar("#man2FiltrosFechar"); await esp(60);
    await clicar('#man2Lista .m2-tarefa.hoje [data-m2acao="registrar"]'); await esperar("document.querySelector('[data-m2pesres=\"exec\"] [data-m2j=\"pes-escolher\"]')");
    const jm = JSON.parse(await ev("(function(){ var j=document.querySelector('.m2-jan').getBoundingClientRect(), c=document.querySelector('.m2-jan-cab').getBoundingClientRect(), r=document.getElementById('man2JanRodape').getBoundingClientRect(); var corpo=document.getElementById('man2JanCorpo'); corpo.scrollTop=corpo.scrollHeight; var r2=document.getElementById('man2JanRodape').getBoundingClientRect(), c2=document.querySelector('.m2-jan-cab').getBoundingClientRect(); return JSON.stringify({w:Math.round(j.width),h:Math.round(j.height),cabTopo:Math.round(c.top),rodBaixo:Math.round(r.bottom),rodBaixoDepois:Math.round(r2.bottom),cabTopoDepois:Math.round(c2.top),rola:corpo.scrollHeight>corpo.clientHeight}); })()"));
    vale(larg + ": Registrar em tela cheia, cabeçalho e rodapé fixos ao rolar", jm.w === larg && jm.h === 844 && jm.cabTopo === 0 && jm.rodBaixo === 844 && jm.rodBaixoDepois === 844 && jm.cabTopoDepois === 0 && jm.rola, J(jm));
    await ev("document.getElementById('man2JanCorpo').scrollTop=0"); await esp(40);
    const alturaCorpo = await ev("document.getElementById('man2JanCorpo').scrollHeight");
    let pequenosForm = [], fontesForm = [], camposForm = 0;
    for (let y = 0; y < alturaCorpo; y += 500) { await ev("document.getElementById('man2JanCorpo').scrollTop=" + y); await esp(30); const mf = await medir(".m2-jan"); pequenosForm = pequenosForm.concat(mf.pequenos); fontesForm = fontesForm.concat(mf.fontes); camposForm += mf.camposPequenos; }
    vale(larg + ": formulário — toque >= 44 px", !pequenosForm.length, pequenosForm.slice(0, 6).join(" ; ") || "todos");
    vale(larg + ": formulário — fonte >= 14 px (rótulos >= 12)", !fontesForm.length, fontesForm.slice(0, 6).join(" ; ") || "ok");
    vale(larg + ": formulário — campos com 16 px (iOS sem zoom), 1 coluna", !camposForm && (await ev("getComputedStyle(document.querySelector('.m2-grade2')||document.body).gridTemplateColumns.split(' ').length")) === 1);
    vale(larg + ": formulário sem rolagem horizontal", (await ev("document.documentElement.scrollWidth<=document.documentElement.clientWidth && document.querySelector('.m2-jan-corpo').scrollWidth<=document.querySelector('.m2-jan-corpo').clientWidth")));
    await ev("man2FecharJan(true)"); await clicar('#man2Lista .m2-tarefa [data-m2acao="detalhes"]:not([data-aba])'); await esperar("document.querySelector('#man2JanCorpo .m2-bloco')");
    await clicar('[data-m2j="det-aba"][data-aba="historico"]'); await esperar("document.querySelectorAll('#man2JanCorpo .m2-hist-item').length>=20");
    const md = await medir(".m2-jan");
    vale(larg + ": Detalhes/Histórico — toque, fonte, sem rolagem de lado", !md.pequenos.length && !md.fontes.length && md.sw <= md.vw, J(md));
    await ev("man2FecharJan(true)"); await clicar("#man2BtnMenu"); await clicar('[data-m2menu="imprimir"]'); await esperar("document.querySelector('.m2-dlg')");
    const dm = JSON.parse(await ev("(function(){ var r=document.querySelector('.m2-dlg').getBoundingClientRect(); return JSON.stringify({w:Math.round(r.width),h:Math.round(r.height)}); })()"));
    const mdl = await medir(".m2-dlg");
    vale(larg + ": diálogo vira folha em tela cheia, toque e fonte ok", dm.w === larg && dm.h === 844 && !mdl.pequenos.length && !mdl.fontes.length && !mdl.camposPequenos, J(dm) + " " + J(mdl));
    await clicar('[data-m2d="cancelar"]');
    vale(larg + ": sem exceções", erros.length === 0, erros.join(" || ") || "nenhuma");
  }

  /* ======================= G) CELULAR 390: confirmações, botão Voltar e aviso ======================= */
  console.log("\n=== G) Celular 390 · confirmações do Painel, botão Voltar e aviso de salvo ===");
  erros.length = 0;
  await abrir("papel=operacional", 390); await entrar();
  await ev("window.__marca=7; 1");
  await clicar('#man2Lista .m2-tarefa [data-m2acao="registrar"]'); await esperar("document.getElementById('man2FObs')");
  await digitar("#man2FObs", "Gelo acumulado no fundo, raspado.");
  vale("390: a janela aberta ocupa uma entrada do histórico", await ev("!!(history.state && history.state.man2jan)"));
  await ev("history.back(); 1");
  vale("390: botão Voltar com formulário preenchido NÃO sai do Painel: pergunta antes", (await esperar("document.querySelector('#uiModal.show')", 4000)) && (await ev("window.__marca")) === 7 && /Descartar o que foi preenchido/.test(await modal()) && await janela(), await modal());
  const cm = JSON.parse(await ev("(function(){ var a=document.getElementById('uiModalCancel').getBoundingClientRect(), b=document.getElementById('uiModalOk').getBoundingClientRect(); return JSON.stringify({continuar:[Math.round(a.width),Math.round(a.height)],descartar:[Math.round(b.width),Math.round(b.height)],fontes:[parseFloat(getComputedStyle(document.getElementById('uiModalCancel')).fontSize),parseFloat(getComputedStyle(document.getElementById('uiModalOk')).fontSize)],umEmbaixoDoOutro:(b.top>=a.bottom+8||a.top>=b.bottom+8)}); })()"));
  vale("390: confirmação 'Descartar?' com toque >= 44 px, fonte >= 14 e botões separados (um embaixo do outro)", cm.continuar[1] >= 44 && cm.descartar[1] >= 44 && cm.fontes.every((x) => x >= 14) && cm.umEmbaixoDoOutro, J(cm));
  await clicar("#uiModalCancel"); await esp(300);
  vale("390: 'Continuar preenchendo' mantém o formulário e o texto (e a janela volta para o histórico)", (await janela()) && (await ev("document.getElementById('man2FObs').value")) === "Gelo acumulado no fundo, raspado." && await ev("!!(history.state && history.state.man2jan)"));
  await ev("history.back(); 1"); await esperar("document.querySelector('#uiModal.show')", 4000);
  await clicar("#uiModalOk"); await esperar("!document.getElementById('man2JanBg').classList.contains('abre')");
  await esp(100);
  vale("390: Voltar + Descartar fecha só a janela (continua no Painel) e tira a marca das confirmações", (await ev("window.__marca")) === 7 && !(await janela()) && !(await ev("document.body.classList.contains('m2-modal')")));
  await clicar('#man2Lista .m2-tarefa [data-m2acao="detalhes"]:not([data-aba])'); await esperar("document.querySelector('#man2JanCorpo .m2-bloco')");
  await ev("history.back(); 1");
  vale("390: Voltar com Detalhes aberto fecha a janela, sem sair do Painel", (await esperar("!document.getElementById('man2JanBg').classList.contains('abre')", 4000)) && (await ev("window.__marca")) === 7);
  await clicar('#man2Lista .m2-tarefa [data-m2acao="detalhes"]:not([data-aba])'); await esperar("document.querySelector('#man2JanRodape [data-m2j=\"registrar\"]')");
  await ev("man2Toast('Pendência resolvida.'); 1");
  const tt = JSON.parse(await ev("(function(){ var b=document.querySelector('#man2JanRodape [data-m2j=\"registrar\"]').getBoundingClientRect(), t=document.getElementById('man2Toast').getBoundingClientRect(); var el=document.elementFromPoint(b.left+b.width/2,b.top+b.height/2); return JSON.stringify({sobrepoe:!(t.bottom<=b.top||t.top>=b.bottom), centro:el?(el.closest('[data-m2j=\"registrar\"]')?'botao':(el.id||el.className)):null}); })()"));
  vale("390: aviso 'Pendência resolvida.' não cobre nem bloqueia o 'Registrar serviço' do rodapé", !tt.sobrepoe && tt.centro === "botao", J(tt));
  await clicar('#man2JanRodape [data-m2j="registrar"]');
  vale("390: tocar 'Registrar serviço' com o aviso na tela abre o formulário", await esperar("man2Form && man2Form.kind==='registrar'", 3000));
  await ev("man2FecharJan(true)"); await esp(100);
  // VIS-5: com a lista real (45 pessoas) o seletor não despeja todo mundo antes de digitar
  await esperar("man2.pessoas && man2.pessoas.length>=5");
  const nPes = await ev("(function(){ var l=[]; for(var i=0;i<40;i++) l.push({ref:'escala:x'+i,nome:'Pessoa '+(i<10?'0':'')+i,detalhe:'Setor exemplo',perfil_id:null}); man2.pessoas=man2.pessoas.concat(l); return man2.pessoas.length; })()");
  await clicar('#man2Lista .m2-tarefa.hoje [data-m2acao="registrar"]'); await esperar("document.querySelector('[data-m2pesres=\"exec\"] [data-m2j=\"pes-escolher\"]')");
  const pz = JSON.parse(await ev("(function(){ var r=document.querySelector('[data-m2pesres=\"exec\"]'); var b=r.querySelectorAll('[data-m2j=\"pes-escolher\"]'); return JSON.stringify({n:b.length,primeiro:b[0]?b[0].firstChild.textContent:'',txt:r.innerText,outro:!!r.querySelector('[data-m2j=\"pes-outro\"]')}); })()"));
  vale("390: antes de digitar, no máximo 6 sugestões (primeiro a responsável da rotina) + 'Digite para buscar entre " + nPes + " pessoas' + Outro",
    pz.n === 6 && pz.primeiro === "Laryze" && new RegExp("Digite para buscar entre " + nPes + " pessoas").test(pz.txt) && pz.outro, J(pz));
  await digitar('[data-m2pesbusca="exec"]', "pessoa"); await esp(80);
  vale("390: digitando, até 8 resultados", (await qtd('[data-m2pesres="exec"] [data-m2j="pes-escolher"]')) === 8 && /continue digitando/.test(await texto('[data-m2pesres="exec"]')), await texto('[data-m2pesres="exec"]'));
  await ev("man2FecharJan(true)"); await esp(150);
  vale("390: sem exceções (operacional)", erros.length === 0, erros.join(" || ") || "nenhuma");
  // CEL-02: recarregar (ou o celular restaurar a aba) com a janela aberta não deixa um Voltar morto
  await clicar('#man2Lista .m2-tarefa [data-m2acao="detalhes"]:not([data-aba])'); await esperar("document.querySelector('#man2JanCorpo .m2-bloco')");
  vale("390: janela aberta ocupa a entrada do histórico (antes de recarregar)", await ev("!!(history.state && history.state.man2jan)"));
  await cmd("Page.reload"); await esp(300);
  await esperar("document.readyState==='complete' && !!window.__PERFIL", 10000);
  vale("390: recarregou com a janela aberta: a entrada da janela sai do histórico sozinha", await esperar("!(history.state && history.state.man2jan)", 5000), await ev("JSON.stringify(history.state)"));
  await esp(300);
  await ev("history.back(); 1");
  vale("390: …e 1 Voltar já sai do Painel", await esperar("/limpar=1/.test(location.search)", 6000), await ev("location.href"));
  erros.length = 0;
  await abrir("papel=master", 390); await entrar();
  await ev("man2AbrirDetalhes('eqbal137','situacao')"); await esperar("/Excluir definitivo/.test(document.getElementById('man2JanCab').innerText)");
  await clicar('[data-m2j="excluir"]'); await esperar("document.querySelector('#uiModal.show')");
  const cx = JSON.parse(await ev("(function(){ return JSON.stringify([document.getElementById('uiModalCancel'),document.getElementById('uiModalOk')].map(function(b){ var r=b.getBoundingClientRect(); return [Math.round(r.height),parseFloat(getComputedStyle(b).fontSize)]; })); })()"));
  vale("390: 'Excluir de vez?' com toque >= 44 px e fonte >= 14", cx.every((x) => x[0] >= 44 && x[1] >= 14), J(cx));
  await clicar("#uiModalOk"); await esperar("document.querySelector('#smModal.show')");
  const sm = JSON.parse(await ev("(function(){ var i=document.getElementById('smSenha'); return JSON.stringify({campo:parseFloat(getComputedStyle(i).fontSize),campoAltura:Math.round(i.getBoundingClientRect().height),botoes:[document.getElementById('smCancel'),document.getElementById('smOk')].map(function(b){ return [Math.round(b.getBoundingClientRect().height),parseFloat(getComputedStyle(b).fontSize)]; })}); })()"));
  vale("390: senha do master com campo de 16 px (iOS sem zoom) e botões >= 44 px", sm.campo >= 16 && sm.campoAltura >= 44 && sm.botoes.every((x) => x[0] >= 44 && x[1] >= 14), J(sm));
  await clicar("#smCancel"); await esp(100);
  vale("390: sem exceções (master)", erros.length === 0, erros.join(" || ") || "nenhuma");

  console.log("\n" + ok + " OK, " + falhou + " falha(s)");
  ws.close(); ch.kill();
  await esp(300);
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
  process.exit(falhou ? 1 : 0);
})().catch(e => { console.log("FALHA | o teste quebrou: " + (e && e.stack || e)); try { if (CHROME_PROC) CHROME_PROC.kill(); } catch (x) {} process.exit(1); });
