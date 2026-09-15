// Testes da FILA OFFLINE da Manutenção v2 (14/09/2026) — bloco ==MAN2-FILA== do painel construído.
// Substitui scripts/testes/manutencao-fila.test.cjs (que testava a MANFILA antiga, removida junto
// com o módulo antigo) e mantém o princípio dele: NADA sai da fila sem o servidor confirmar.
// Contrato: docs/manutencao-v2-especificacao.md, 5.1 e D16/D20. Roda o código REAL da fila contra
// um servidor de mentira que perde conexão, perde resposta, recusa e aceita; relógio de mentira.
//   npx tsx scripts/demoDashboard.ts && node scripts/testes/manutencao-v2-fila.test.cjs
const fs = require("fs");
const path = require("path");

const HTML = fs.readFileSync(path.join(__dirname, "..", "..", "output", "index.html"), "utf8");
const ini = HTML.indexOf("==MAN2-FILA-INICIO==");
const fim = HTML.indexOf("==MAN2-FILA-FIM==");
if (ini < 0 || fim < 0) { console.log("ERRO: não achei o bloco ==MAN2-FILA== no output/index.html (rode o build antes)."); process.exit(1); }
const bloco = HTML.slice(HTML.indexOf("*/", ini) + 2, HTML.lastIndexOf("/*", fim));
const F = new Function(bloco + "\nreturn {man2FilaCriar, man2FilaEspera, man2TraduzirFalha, man2Resposta};")();

let ok = 0, falhou = 0;
function vale(nome, cond, det) { console.log((cond ? "  OK   " : "  FALHA") + " | " + nome + (det !== undefined ? "  ->  " + det : "")); cond ? ok++ : falhou++; }
const espera = ms => new Promise(r => setTimeout(r, ms));

function novoLS(opts) {
  const d = {};
  return { _d: d, cheio: !!(opts && opts.cheio),
    getItem(k) { return k in d ? d[k] : null; },
    setItem(k, v) { if (this.cheio) { const e = new Error("QuotaExceededError"); e.name = "QuotaExceededError"; throw e; } d[k] = String(v); },
    removeItem(k) { delete d[k]; } };
}
function novasFotos(opts) {
  const m = new Map();
  return { _m: m, falhar: !!(opts && opts.falhar),
    put(k, b) { return new Promise((res, rej) => setTimeout(() => this.falhar ? rej(new Error("IndexedDB indisponível")) : (m.set(k, b), res()), 1)); },
    get(k) { return new Promise(res => setTimeout(() => res(m.has(k) ? m.get(k) : undefined), 1)); },
    del(k) { return new Promise(res => setTimeout(() => { m.delete(k); res(); }, 1)); },
    limparPrefixo(p) { return new Promise(res => setTimeout(() => { [...m.keys()].forEach(k => { if (k.indexOf(p) === 0) m.delete(k); }); res(); }, 1)); } };
}
// servidor de mentira: responde no formato do supabase-js ({data, error}) e do contrato ({ok:...})
function novoServidor() {
  const s = { modo: "ok", perderResposta: false, recusar: null, respostaCrua: null, uploadFalha: false,
    execucoes: {}, objetos: new Set(), log: [], chamadas: [] };
  s.rpc = (nome, params) => new Promise(res => setTimeout(() => {
    s.chamadas.push({ nome, params }); s.log.push("rpc:" + nome);
    if (s.modo === "rede") return res({ data: null, error: { message: "TypeError: Failed to fetch" } });
    if (s.respostaCrua) return res(s.respostaCrua);
    if (s.recusar) return res({ data: Object.assign({ ok: false }, s.recusar), error: null });
    if (nome === "manutencao_execucao_registrar") {
      const p = params.p, ja = s.execucoes[p.request_id];
      if (ja) return res({ data: { ok: true, id: ja.id, repetido: true, proxima: "2026-10-14", estado: "em_dia", dias: 30, pendencia_id: null }, error: null });
      for (const a of (p.anexos || [])) if (!s.objetos.has(a.caminho)) return res({ data: { ok: false, erro: "invalido", campo: "anexos", mensagem: "Arquivo não encontrado no armazenamento." }, error: null });
      s.execucoes[p.request_id] = { id: "x" + Object.keys(s.execucoes).length, p };
      if (s.perderResposta) { s.perderResposta = false; return res({ data: null, error: { message: "Failed to fetch" } }); }   // gravou, mas a resposta não voltou
      return res({ data: { ok: true, id: s.execucoes[p.request_id].id, repetido: false, proxima: "2026-10-14", estado: "em_dia", dias: 30, pendencia_id: null }, error: null });
    }
    if (nome === "manutencao_pendencia_resolver") return res({ data: { ok: true }, error: null });
    return res({ data: { ok: false, erro: "nao_encontrado", mensagem: "RPC desconhecida no teste" }, error: null });
  }, 2));
  s.subir = (caminho, blob, mime) => new Promise(res => setTimeout(() => {
    s.log.push("upload:" + caminho);
    if (s.modo === "rede") return res({ ok: false, erro: "rede", transitorio: true, mensagem: "Sem internet no momento." });
    if (s.uploadFalha) return res({ ok: false, erro: "falha", transitorio: true, mensagem: "storage caiu" });
    s.objetos.add(caminho); res({ ok: true });
  }, 2));
  return s;
}
function montar(o) {
  o = o || {};
  const relogio = { t: 1000000 };
  const srv = o.srv || novoServidor();
  const ls = o.ls || novoLS();
  const fotos = o.fotos === undefined ? novasFotos() : o.fotos;
  const fila = F.man2FilaCriar({ uid: o.uid || "u1", storage: ls, fotos, rpc: srv.rpc, subirArquivo: srv.subir, agora: () => (o.relogio || relogio).t, prazoFotos: o.prazoFotos });
  return { fila, srv, ls, fotos, relogio: o.relogio || relogio };
}
let n = 0;
function pedido(extra) {
  const rid = "aaaaaaaa-0000-4000-8000-" + String(++n).padStart(12, "0");
  const anexos = (extra && extra.comFoto) ? [{ categoria: "foto_depois", caminho: "v2/foto_depois/" + rid + ".jpg", mime: "image/jpeg", bytes: 17, nome_original: "foto.jpg" }] : [];
  return { id: rid, tipo: "execucao", rpc: "manutencao_execucao_registrar", rotulo: "Limpeza · Camera Fria",
    params: { p: { request_id: rid, equipamento_id: "E1", tipo_servico: "Limpeza", data_execucao: "2026-09-14", executor: { tipo: "interno", ref: "livre", nome: "Laryze" }, resultado: "ok", anexos } },
    anexos };
}
const FOTO = "CONTEUDO-BINARIO-DA-FOTO";

(async () => {
  console.log("\n=== 1) Sem internet: o registro vai para a fila, guardado no aparelho ===\n");
  const A = montar();
  A.srv.modo = "rede";
  const p1 = pedido({ comFoto: true });
  const ad = await A.fila.adicionar(p1, { foto_depois: FOTO });
  vale("guardar deu certo", ad.ok === true && ad.repetido === false, JSON.stringify({ ok: ad.ok, repetido: ad.repetido }));
  const chaveLS = "man2_fila:u1";
  vale("fica no localStorage do login (man2_fila:<uid>)", !!A.ls.getItem(chaveLS), Object.keys(A.ls._d).join(","));
  vale("o localStorage NÃO guarda a foto, só os dados do pedido", A.ls.getItem(chaveLS).indexOf(FOTO) < 0, A.ls.getItem(chaveLS).length + " caracteres");
  vale("a foto fica no IndexedDB, com a chave do login", A.fotos._m.get("u1:" + p1.id + ":foto_depois") === FOTO, [...A.fotos._m.keys()].join(","));
  const rel1 = await A.fila.enviar(true);
  const it1 = A.fila.item(p1.id);
  vale("não chegou: continua na fila", A.fila.qtd() === 1 && rel1.pendentes.indexOf(p1.id) >= 0 && rel1.confirmados.length === 0, "fila=" + A.fila.qtd());
  vale("estado pendente, 1 tentativa, motivo em português", it1.estado === "pendente" && it1.tentativas === 1 && it1.erro.mensagem === "Sem internet no momento.", JSON.stringify(it1.erro));
  vale("próxima tentativa daqui a 30 s", it1.proximaEm === A.relogio.t + 30000, String(it1.proximaEm - A.relogio.t));
  vale("sem rede: nem chama a RPC sem a foto subir", A.srv.chamadas.length === 0 && Object.keys(A.srv.execucoes).length === 0, A.srv.log.join(" "));

  console.log("\n=== 2) Espera crescente com teto (30 s -> 5 min) ===\n");
  vale("tabela de espera", [1, 2, 3, 4, 5, 6, 9].map(F.man2FilaEspera).join(",") === "30000,60000,120000,240000,300000,300000,300000", [1, 2, 3, 4, 5, 6, 9].map(F.man2FilaEspera).join(","));
  const logAntes = A.srv.log.length;
  A.relogio.t += 29999; await A.fila.enviar(false);
  vale("antes da espera acabar o relógio não manda de novo", A.srv.log.length === logAntes, (A.srv.log.length - logAntes) + " pedido(s)");
  const esperas = [];
  for (let i = 0; i < 6; i++) {
    const antes = A.fila.item(p1.id).proximaEm;
    A.relogio.t = antes; await A.fila.enviar(false);
    const it = A.fila.item(p1.id); esperas.push(it.proximaEm - A.relogio.t);
  }
  vale("cada falha dobra a espera até 5 min", esperas.join(",") === "60000,120000,240000,300000,300000,300000", esperas.join(","));
  vale("depois de 7 falhas continua na fila", A.fila.qtd() === 1 && A.fila.item(p1.id).tentativas === 7, "tentativas=" + A.fila.item(p1.id).tentativas);

  console.log("\n=== 3) A internet voltou: foto antes, RPC depois, e só então sai da fila ===\n");
  A.srv.modo = "ok"; A.srv.log.length = 0;
  const rel3 = await A.fila.tentarAgora();
  vale("confirmado pelo servidor", rel3.confirmados.length === 1 && rel3.confirmados[0].retorno.proxima === "2026-10-14", JSON.stringify(rel3.confirmados.map(c => c.retorno.id)));
  vale("a foto sobe ANTES da RPC", A.srv.log.join(" ") === "upload:v2/foto_depois/" + p1.id + ".jpg rpc:manutencao_execucao_registrar", A.srv.log.join(" "));
  vale("servidor gravou 1 execução com o caminho da foto", Object.keys(A.srv.execucoes).length === 1 && A.srv.execucoes[p1.id].p.anexos[0].caminho === "v2/foto_depois/" + p1.id + ".jpg", Object.keys(A.srv.execucoes).length + " execução");
  vale("fila vazia, chave do localStorage apagada", A.fila.qtd() === 0 && A.ls.getItem(chaveLS) === null, "fila=" + A.fila.qtd());
  await espera(10);
  vale("foto apagada do IndexedDB depois de confirmada", A.fotos._m.size === 0, A.fotos._m.size + " foto(s)");

  console.log("\n=== 4) Reenvio idempotente: gravou, mas a resposta se perdeu ===\n");
  const B = montar();
  const p4 = pedido();
  await B.fila.adicionar(p4);
  B.srv.perderResposta = true;
  const r4a = await B.fila.enviar(true);
  vale("sem a resposta, NÃO sai da fila (mesmo o servidor tendo gravado)", B.fila.qtd() === 1 && Object.keys(B.srv.execucoes).length === 1 && r4a.pendentes.length === 1, "fila=" + B.fila.qtd() + " servidor=" + Object.keys(B.srv.execucoes).length);
  const r4b = await B.fila.tentarAgora();
  vale("reenvio com o MESMO request_id", B.srv.chamadas.length === 2 && B.srv.chamadas[0].params.p.request_id === B.srv.chamadas[1].params.p.request_id, B.srv.chamadas.map(c => c.params.p.request_id.slice(-4)).join(","));
  vale("servidor responde 'repetido' e a fila confirma", r4b.confirmados.length === 1 && r4b.confirmados[0].retorno.repetido === true && B.fila.qtd() === 0, JSON.stringify(r4b.confirmados.map(c => c.retorno)));
  vale("continua 1 execução só no servidor", Object.keys(B.srv.execucoes).length === 1, Object.keys(B.srv.execucoes).length + " execução(ões)");

  console.log("\n=== 5) Recusa definitiva vira 'precisa de atenção' e só sai com Descartar ===\n");
  const C = montar();
  const p5 = pedido({ comFoto: true });
  await C.fila.adicionar(p5, { foto_depois: FOTO });
  C.srv.recusar = { erro: "invalido", campo: "data_execucao", mensagem: "A data não pode ser no futuro." };
  const r5 = await C.fila.enviar(true);
  const it5 = C.fila.item(p5.id);
  vale("estado 'atencao' com campo e mensagem do servidor", it5.estado === "atencao" && it5.erro.campo === "data_execucao" && it5.erro.mensagem === "A data não pode ser no futuro." && r5.atencao.length === 1, JSON.stringify(it5.erro));
  vale("não some da fila", C.fila.qtd() === 1 && C.fila.qtdAtencao() === 1 && C.fila.qtdPendentes() === 0, "fila=" + C.fila.qtd());
  const chamadasAntes = C.srv.chamadas.length;
  C.srv.recusar = null; C.relogio.t += 999999; await C.fila.enviar(true); await C.fila.tentarAgora();
  vale("recusado não é reenviado sozinho (mandar de novo não muda a regra)", C.srv.chamadas.length === chamadasAntes, (C.srv.chamadas.length - chamadasAntes) + " reenvio(s)");
  const p5b = pedido(); await C.fila.adicionar(p5b); C.srv.modo = "rede"; await C.fila.enviar(true);
  vale("Descartar NÃO tira item pendente (só o servidor confirma)", C.fila.descartar(p5b.id) === false && C.fila.qtd() === 2, "fila=" + C.fila.qtd());
  vale("Descartar tira o recusado", C.fila.descartar(p5.id) === true && C.fila.qtd() === 1 && !C.fila.item(p5.id), "fila=" + C.fila.qtd());
  await espera(10);
  vale("e apaga a foto dele", !C.fotos._m.has("u1:" + p5.id + ":foto_depois"), [...C.fotos._m.keys()].join(",") || "nenhuma");
  // o mesmo formulário corrigido pode ser salvo de novo (o servidor nunca aceitou aquele request_id)
  const D0 = montar(); const p5c = pedido();
  D0.srv.recusar = { erro: "invalido", campo: "executor", mensagem: "Informe quem realizou." };
  await D0.fila.adicionar(p5c); await D0.fila.enviar(true);
  const corrigido = JSON.parse(JSON.stringify(p5c)); corrigido.params.p.executor.nome = "Zé";
  D0.srv.recusar = null;
  const adc = await D0.fila.adicionar(corrigido);
  vale("salvar de novo o recusado substitui (não duplica)", adc.ok && !adc.repetido && D0.fila.qtd() === 1 && D0.fila.item(p5c.id).estado === "pendente" && D0.fila.item(p5c.id).params.p.executor.nome === "Zé", JSON.stringify(D0.fila.item(p5c.id).params.p.executor));
  const r5c = await D0.fila.enviar(true);
  vale("e aí é aceito", r5c.confirmados.length === 1 && D0.fila.qtd() === 0, "fila=" + D0.fila.qtd());

  console.log("\n=== 6) Nada some sem ok:true (respostas estranhas) ===\n");
  const casos = [
    ["resposta vazia {data:null,error:null}", { data: null, error: null }, "pendente"],
    ["data sem 'ok'", { data: { id: "x" }, error: null }, "pendente"],
    ["função ainda não instalada (PGRST202)", { data: null, error: { code: "PGRST202", message: "Could not find the function" } }, "pendente"],
    ["sessão expirada", { data: null, error: { code: "PGRST301", message: "JWT expired" } }, "pendente"],
    ["sem permissão no banco (42501)", { data: null, error: { code: "42501", message: "permission denied for function" } }, "atencao"],
    ["inativo", { data: { ok: false, erro: "inativo" }, error: null }, "atencao"],
    ["não encontrado", { data: { ok: false, erro: "nao_encontrado", mensagem: "Equipamento não existe." }, error: null }, "atencao"],
    ["sem_permissao do contrato", { data: { ok: false, erro: "sem_permissao", mensagem: "Sem acesso." }, error: null }, "atencao"],
  ];
  for (const [nome, resp, estado] of casos) {
    const X = montar(); const px = pedido();
    X.srv.respostaCrua = resp;
    await X.fila.adicionar(px); await X.fila.enviar(true);
    const it = X.fila.item(px.id);
    vale(nome + " -> " + estado + ", continua na fila", !!it && it.estado === estado && X.fila.qtd() === 1, it ? it.estado + " · " + (it.erro && it.erro.mensagem) : "SUMIU");
  }
  const semMsg = F.man2Resposta({ data: { ok: false, erro: "inativo" }, error: null });
  vale("recusa sem mensagem ganha texto", semMsg.transitorio === false && /recusou/.test(semMsg.mensagem), semMsg.mensagem);
  const bruto = F.man2TraduzirFalha({ message: 'null value in column "equipamento_nome_snap" of relation "manutencao_execucoes" violates not-null constraint', code: "23502" });
  vale("erro inesperado do banco: o funcionário lê português, sem o texto técnico em inglês (que fica em 'detalhe')",
    !/null value|constraint|relation|column/i.test(bruto.mensagem) && /servidor não respondeu direito/.test(bruto.mensagem) && /null value/.test(bruto.detalhe || "") && bruto.transitorio === true, bruto.mensagem);
  vale("rede é transitória", F.man2TraduzirFalha({ message: "TypeError: Failed to fetch" }).erro === "rede" && F.man2TraduzirFalha(new Error("Load failed")).transitorio === true, "ok");
  const X2 = montar(); const px2 = pedido();
  X2.fila.adicionar(px2);
  const rpcQueEstoura = F.man2FilaCriar({ uid: "u9", storage: novoLS(), fotos: null, rpc: () => { throw new Error("Failed to fetch"); }, subirArquivo: () => ({ ok: true }), agora: () => 1 });
  await rpcQueEstoura.adicionar(pedido()); await rpcQueEstoura.enviar(true);
  vale("RPC que estoura exceção não perde o item", rpcQueEstoura.qtd() === 1 && rpcQueEstoura.lista()[0].estado === "pendente", rpcQueEstoura.lista()[0].erro.mensagem);

  console.log("\n=== 7) Fila por login ===\n");
  const lsComum = novoLS(), fotosComum = novasFotos(), srvComum = novoServidor();
  srvComum.modo = "rede";
  const U1 = montar({ uid: "u1", ls: lsComum, fotos: fotosComum, srv: srvComum });
  const pu1 = pedido({ comFoto: true });
  await U1.fila.adicionar(pu1, { foto_depois: FOTO }); await U1.fila.enviar(true);
  const U2 = montar({ uid: "u2", ls: lsComum, fotos: fotosComum, srv: srvComum });
  vale("outro login no mesmo aparelho não vê a fila do primeiro", U2.fila.qtd() === 0, "fila u2=" + U2.fila.qtd());
  srvComum.modo = "ok"; const antesU2 = srvComum.chamadas.length;
  await U2.fila.enviar(true);
  vale("e não manda o registro do primeiro com a sessão dele", srvComum.chamadas.length === antesU2 && Object.keys(srvComum.execucoes).length === 0, (srvComum.chamadas.length - antesU2) + " chamada(s)");
  const pu2 = pedido({ comFoto: true }); srvComum.modo = "rede";
  await U2.fila.adicionar(pu2, { foto_depois: "FOTO-U2" }); await U2.fila.enviar(true);
  // recarregar a página: a fila volta do aparelho; item que estava "enviando" volta a "pendente"
  const guardado = JSON.parse(lsComum.getItem("man2_fila:u1")); guardado[0].estado = "enviando"; lsComum.setItem("man2_fila:u1", JSON.stringify(guardado));
  const U1b = montar({ uid: "u1", ls: lsComum, fotos: fotosComum, srv: srvComum });
  vale("recarregou a página: a fila do login volta, 'enviando' vira 'pendente'", U1b.fila.qtd() === 1 && U1b.fila.lista()[0].estado === "pendente", U1b.fila.lista().map(i => i.estado).join(","));

  console.log("\n=== 8) Sair do painel limpa a fila deste login ===\n");
  const apagados = await U1b.fila.limpar();
  vale("limpar devolve quantos eram", apagados === 1, String(apagados));
  vale("fila do u1 apagada do localStorage", lsComum.getItem("man2_fila:u1") === null && U1b.fila.qtd() === 0, Object.keys(lsComum._d).join(","));
  vale("fotos do u1 apagadas do IndexedDB", ![...fotosComum._m.keys()].some(k => k.indexOf("u1:") === 0), [...fotosComum._m.keys()].join(","));
  vale("a fila e as fotos do u2 continuam", lsComum.getItem("man2_fila:u2") !== null && fotosComum._m.get("u2:" + pu2.id + ":foto_depois") === "FOTO-U2", Object.keys(lsComum._d).join(","));

  console.log("\n=== 9) Duplo clique e envios juntos ===\n");
  const G = montar();
  const pg = pedido();
  const [g1, g2] = await Promise.all([G.fila.adicionar(pg), G.fila.adicionar(pg)]);
  vale("o mesmo request_id não entra duas vezes", G.fila.qtd() === 1 && (g1.repetido || g2.repetido), JSON.stringify([g1.repetido, g2.repetido]));
  const e1 = G.fila.enviar(true);
  const pg2 = pedido(); await G.fila.adicionar(pg2);            // entrou enquanto o primeiro subia
  const e2 = G.fila.enviar(true);
  const [re1, re2] = await Promise.all([e1, e2]);
  const porId = {}; G.srv.chamadas.forEach(c => { const k = c.params.p.request_id; porId[k] = (porId[k] || 0) + 1; });
  vale("cada registro foi enviado UMA vez", porId[pg.id] === 1 && porId[pg2.id] === 1, JSON.stringify(Object.values(porId)));
  vale("o que entrou no meio também subiu", G.fila.qtd() === 0 && Object.keys(G.srv.execucoes).length === 2, "fila=" + G.fila.qtd());
  vale("as duas chamadas recebem o relatório completo", re1.confirmados.length === 2 && re2.confirmados.length === 2, re1.confirmados.length + "/" + re2.confirmados.length);
  await G.fila.adicionar(pg);
  vale("request_id já confirmado pode ser reenviado (o banco devolve o mesmo)", G.fila.qtd() === 1, "fila=" + G.fila.qtd());
  const rg = await G.fila.enviar(true);
  vale("e não duplica no servidor", rg.confirmados[0].retorno.repetido === true && Object.keys(G.srv.execucoes).length === 2, Object.keys(G.srv.execucoes).length + " execuções");

  console.log("\n=== 10) Foto que não sobe / foto perdida ===\n");
  const H = montar(); const ph = pedido({ comFoto: true });
  await H.fila.adicionar(ph, { foto_depois: FOTO });
  H.srv.uploadFalha = true;
  await H.fila.enviar(true);
  vale("foto não subiu: a RPC NÃO é chamada (serviço não vai sem a foto)", H.srv.chamadas.length === 0 && H.fila.item(ph.id).estado === "pendente", H.srv.log.join(" "));
  H.fotos._m.clear();   // IndexedDB apagado pelo navegador
  H.srv.uploadFalha = false;
  await H.fila.tentarAgora();
  const ih = H.fila.item(ph.id);
  vale("foto sumiu do aparelho: vira 'precisa de atenção' (não sobe registro sem a foto)", ih && ih.estado === "atencao" && /foto/.test(ih.erro.mensagem) && H.srv.chamadas.length === 0, ih ? ih.erro.mensagem : "SUMIU");
  const H2 = montar(); const ph2 = pedido({ comFoto: true });
  await H2.fila.adicionar(ph2, { foto_depois: FOTO });
  H2.srv.modo = "rede"; await H2.fila.enviar(true);
  H2.srv.modo = "ok"; H2.srv.log.length = 0;
  H2.srv.perderResposta = true; await H2.fila.tentarAgora();
  H2.srv.log.length = 0; await H2.fila.tentarAgora();
  vale("foto que já subiu não sobe de novo no reenvio", H2.srv.log.join(" ") === "rpc:manutencao_execucao_registrar" && H2.fila.qtd() === 0, H2.srv.log.join(" "));

  console.log("\n=== 11) Aparelho sem espaço / sem IndexedDB ===\n");
  const lsCheio = novoLS({ cheio: true });
  const I = montar({ ls: lsCheio }); const pi = pedido();
  const adi = await I.fila.adicionar(pi);
  vale("localStorage cheio: avisa que NÃO ficou guardado", adi.ok === false && adi.erro === "armazenamento" && /NÃO ficou guardado/.test(adi.mensagem), adi.mensagem);
  const rei = await I.fila.enviar(true);
  vale("mas com internet ainda sobe na hora", rei.confirmados.length === 1 && Object.keys(I.srv.execucoes).length === 1, rei.confirmados.length + " confirmado(s)");
  const I2 = montar({ ls: novoLS({ cheio: true }) }); const pi2 = pedido();
  I2.srv.modo = "rede";
  const adi2 = await I2.fila.adicionar(pi2); await I2.fila.enviar(true);
  vale("memória cheia e sem internet: a mensagem diz o que acontece (vai se houver internet; não feche)", adi2.ok === false && /NÃO ficou guardado/.test(adi2.mensagem) && /não feche o painel/.test(adi2.mensagem), adi2.mensagem);
  vale("…e a pessoa que desiste consegue DESCARTAR (não fica escondido na memória)", I2.fila.descartar(pi2.id) === true && I2.fila.qtd() === 0, "fila=" + I2.fila.qtd());
  const chamadasAntesI2 = I2.srv.chamadas.length;
  I2.srv.modo = "ok"; await I2.fila.tentarAgora(); await I2.fila.enviar(true);
  vale("…e depois de descartado nada é enviado quando a internet volta", Object.keys(I2.srv.execucoes).length === 0 && I2.srv.chamadas.length === chamadasAntesI2, (I2.srv.chamadas.length - chamadasAntesI2) + " chamada(s) nova(s)");
  const J = montar({ fotos: novasFotos({ falhar: true }) }); const pj = pedido({ comFoto: true });
  const adj = await J.fila.adicionar(pj, { foto_depois: FOTO });
  vale("IndexedDB falhou: foto fica na memória e o item avisa", adj.ok && adj.soNaMemoria === true && J.fila.item(pj.id).anexos[0].soNaMemoria === true, JSON.stringify({ soNaMemoria: adj.soNaMemoria }));
  const rej = await J.fila.enviar(true);
  vale("e a foto da memória sobe normalmente", rej.confirmados.length === 1 && J.srv.objetos.has("v2/foto_depois/" + pj.id + ".jpg"), J.srv.log.join(" "));
  const K = montar({ fotos: null }); const pk = pedido({ comFoto: true });
  const adk = await K.fila.adicionar(pk, { foto_depois: FOTO });
  vale("sem adaptador de fotos nenhum também não quebra", adk.ok && adk.soNaMemoria === true, JSON.stringify({ ok: adk.ok }));
  const semId = await K.fila.adicionar({ rpc: "x" });
  vale("pedido sem id é recusado", semId.ok === false, semId.mensagem);

  console.log("\n=== 12) Resolver pendência também passa pela fila ===\n");
  const P = montar(); P.srv.modo = "rede";
  const pp = { id: "pendencia_resolver:p1", tipo: "pendencia_resolver", rpc: "manutencao_pendencia_resolver", params: { p_id: "p1", p_versao: 1, p_solucao: "Trocou a borracha", p_execucao_id: null }, rotulo: "Resolver pendência" };
  await P.fila.adicionar(pp); await P.fila.enviar(true);
  const dup = await P.fila.adicionar(pp);
  vale("clicar Resolver duas vezes não duplica", dup.repetido === true && P.fila.qtd() === 1, "fila=" + P.fila.qtd());
  P.srv.modo = "ok"; const rp = await P.fila.tentarAgora();
  vale("sobe quando volta a internet, com os parâmetros do contrato", rp.confirmados.length === 1 && JSON.stringify(P.srv.chamadas[P.srv.chamadas.length - 1].params) === JSON.stringify(pp.params), JSON.stringify(P.srv.chamadas[P.srv.chamadas.length - 1].params));

  console.log("\n=== 13) Duas abas do MESMO login no mesmo aparelho (sem internet) ===\n");
  const lsAbas = novoLS(), fotosAbas = novasFotos(), srvAbas = novoServidor();
  srvAbas.modo = "rede";
  const aba2 = montar({ uid: "uA", ls: lsAbas, fotos: fotosAbas, srv: srvAbas });   // aberta antes
  const aba1 = montar({ uid: "uA", ls: lsAbas, fotos: fotosAbas, srv: srvAbas });
  const X = pedido(), Y = pedido({ comFoto: true }), Z = pedido();
  await aba1.fila.adicionar(X);
  await aba2.fila.adicionar(Y, { foto_depois: FOTO });
  await aba1.fila.adicionar(Z);
  const guardAbas = () => JSON.parse(lsAbas.getItem("man2_fila:uA") || "[]").map((i) => i.id).sort();
  vale("uma aba guardando não apaga o registro guardado pela outra", JSON.stringify(guardAbas()) === JSON.stringify([X.id, Y.id, Z.id].sort()), guardAbas().map((i) => i.slice(-2)).join(","));
  vale("o aparelho não guarda marcas internas da aba", lsAbas.getItem("man2_fila:uA").indexOf("preparando") < 0 && lsAbas.getItem("man2_fila:uA").indexOf("naoGuardado") < 0, "ok");
  srvAbas.modo = "ok";
  const reaberta = montar({ uid: "uA", ls: lsAbas, fotos: fotosAbas, srv: srvAbas });
  const relAb = await reaberta.fila.enviar(true);
  vale("abas fechadas e painel aberto de novo com internet: os 3 chegam (inclusive a foto guardada pela outra aba)",
    relAb.confirmados.length === 3 && Object.keys(srvAbas.execucoes).length === 3 && srvAbas.objetos.has("v2/foto_depois/" + Y.id + ".jpg") && lsAbas.getItem("man2_fila:uA") === null, relAb.confirmados.length + " confirmado(s)");
  const W = pedido(), V = pedido();
  srvAbas.modo = "rede";
  await aba2.fila.adicionar(W);
  vale("o que outra aba já enviou não é regravado por esta aba", JSON.stringify(guardAbas()) === JSON.stringify([W.id]), guardAbas().map((i) => i.slice(-2)).join(","));
  await aba1.fila.adicionar(V);
  vale("…e a outra aba não perde o registro novo", JSON.stringify(guardAbas()) === JSON.stringify([W.id, V.id].sort()), guardAbas().map((i) => i.slice(-2)).join(","));
  vale("aviso do navegador (evento storage): a aba acompanha sem gravar", aba2.fila.sincronizar() === true && aba2.fila.qtd() === 2, "fila aba2=" + aba2.fila.qtd());

  console.log("\n=== 14) Armazenamento de fotos que NÃO responde (IndexedDB travado) ===\n");
  const nunca = () => new Promise(() => {});
  const travado = { put: nunca, get: nunca, del: nunca, limparPrefixo: nunca };
  const noPrazo = (p, ms) => Promise.race([p.then((v) => ({ v })), new Promise((r) => setTimeout(() => r("TRAVOU"), ms))]);
  const T1 = montar({ fotos: travado, prazoFotos: 60 }); const pt1 = pedido({ comFoto: true });
  const adT = await noPrazo(T1.fila.adicionar(pt1, { foto_depois: FOTO }), 1500);
  vale("guardar termina no prazo e a foto fica na memória (o Salvar não fica preso em 'Enviando fotos…')", adT !== "TRAVOU" && adT.v.ok === true && adT.v.soNaMemoria === true, adT === "TRAVOU" ? "TRAVOU" : JSON.stringify({ ok: adT.v.ok, soNaMemoria: adT.v.soNaMemoria }));
  const relT1 = await noPrazo(T1.fila.enviar(true), 1500);
  vale("e o envio segue: a foto da memória sobe e o registro é confirmado", relT1 !== "TRAVOU" && relT1.v.confirmados.length === 1, relT1 === "TRAVOU" ? "TRAVOU" : relT1.v.confirmados.length + " confirmado(s)");
  const lsT = novoLS(), fotosT = novasFotos(); const pt2 = pedido({ comFoto: true }), ptSem = pedido();
  const T2a = montar({ ls: lsT, fotos: fotosT }); T2a.srv.modo = "rede";
  await T2a.fila.adicionar(pt2, { foto_depois: FOTO }); await T2a.fila.adicionar(ptSem);
  const T2b = montar({ ls: lsT, fotos: travado, prazoFotos: 60 });            // página recarregada; agora o IndexedDB trava
  const relT2 = await noPrazo(T2b.fila.enviar(true), 1500);
  const it2 = T2b.fila.item(pt2.id);
  vale("foto guardada que o aparelho não consegue ler agora: continua PENDENTE (não vira 'se perdeu') e o registro sem foto sobe",
    relT2 !== "TRAVOU" && it2 && it2.estado === "pendente" && relT2.v.confirmados.some((c) => c.id === ptSem.id), relT2 === "TRAVOU" ? "TRAVOU" : (it2 ? it2.estado + " · " + it2.erro.mensagem : "SUMIU"));
  const limT = await noPrazo(T2b.fila.limpar(), 1500);
  vale("'Sair e apagar' termina mesmo com o IndexedDB travado", limT !== "TRAVOU" && limT.v === 1 && lsT.getItem("man2_fila:u1") === null, limT === "TRAVOU" ? "TRAVOU" : String(limT.v));

  console.log("\n=== 15) Relógio da fila disparando no meio do Salvar com foto ===\n");
  const lentas = novasFotos(); const putRapido = lentas.put.bind(lentas);
  lentas.put = (k, b) => new Promise((res, rej) => setTimeout(() => putRapido(k, b).then(res, rej), 80));
  const R7 = montar({ fotos: lentas }); const p7 = pedido({ comFoto: true });
  const salvando7 = R7.fila.adicionar(p7, { foto_depois: FOTO });
  const relRelogio = await R7.fila.enviar(false);                              // o relógio de 30 s bate agora
  vale("o relógio NÃO pega o registro enquanto a foto ainda está sendo guardada (nada de 'a foto se perdeu')",
    relRelogio.atencao.length === 0 && R7.srv.chamadas.length === 0 && R7.srv.log.length === 0 && R7.fila.item(p7.id).estado === "pendente", JSON.stringify(relRelogio.atencao));
  const ad7 = await salvando7; const rel7 = await R7.fila.enviar(true);
  vale("terminou de guardar: vai normal e é confirmado", ad7.ok && rel7.confirmados.length === 1 && R7.fila.qtd() === 0, rel7.confirmados.length + " confirmado(s)");

  console.log("\n=== 16) Foto que só estava na memória de um painel já fechado (IndexedDB com erro ou travado) ===\n");
  const idbErro = () => Promise.reject(new Error("IndexedDB indisponível"));
  const quebrado = { put: idbErro, get: idbErro, del: idbErro, limparPrefixo: idbErro };
  const temFn = (f) => typeof f.fotoNaMemoria === "function";
  for (const [nomeIdb, idb] of [["com erro", quebrado], ["travado", travado]]) {
    const lsM = novoLS(); const pm = pedido({ comFoto: true }), pmSem = pedido();
    const M1 = montar({ ls: lsM, fotos: idb, prazoFotos: 60 }); M1.srv.modo = "rede";
    const adM = await noPrazo(M1.fila.adicionar(pm, { foto_depois: FOTO }), 1500);
    await M1.fila.adicionar(pmSem); await noPrazo(M1.fila.enviar(true), 1500);
    vale("IndexedDB " + nomeIdb + ", sem internet: a foto fica só na memória DESTA aba (aqui vale 'não feche o painel')",
      adM !== "TRAVOU" && adM.v.soNaMemoria === true && temFn(M1.fila) && M1.fila.fotoNaMemoria(pm.id) === true, adM === "TRAVOU" ? "TRAVOU" : JSON.stringify({ soNaMemoria: adM.v.soNaMemoria }));
    if (typeof M1.fila.encerrar === "function") M1.fila.encerrar();  // o painel foi fechado (pagehide)
    const M2 = montar({ ls: lsM, fotos: idb, prazoFotos: 60 });     // o painel foi fechado e aberto de novo
    vale("IndexedDB " + nomeIdb + ", painel reaberto: o registro voltou do aparelho, mas a foto não está na memória desta aba (sem 'não feche')",
      M2.fila.qtd() === 2 && temFn(M2.fila) && M2.fila.fotoNaMemoria(pm.id) === false, "fila=" + M2.fila.qtd());
    const relM = await noPrazo(M2.fila.tentarAgora(), 1500);
    const itM = M2.fila.item(pm.id);
    vale("IndexedDB " + nomeIdb + ", internet de volta: o registro da foto perdida vira 'precisa de atenção' (não fica pendente para sempre) e o sem foto sobe",
      relM !== "TRAVOU" && !!itM && itM.estado === "atencao" && /foto/.test(itM.erro.mensagem) && !M2.srv.chamadas.some((c) => c.params.p.request_id === pm.id) && relM.v.confirmados.some((c) => c.id === pmSem.id),
      relM === "TRAVOU" ? "TRAVOU" : (itM ? itM.estado + " · " + (itM.erro && itM.erro.mensagem) : "SUMIU"));
    vale("IndexedDB " + nomeIdb + ": …e dá para Descartar", M2.fila.descartar(pm.id) === true && M2.fila.qtd() === 0, "fila=" + M2.fila.qtd());
  }

  console.log("\n=== 17) IndexedDB LENTO: a foto termina de gravar DEPOIS do prazo ===\n");
  {
    const mapa = new Map();
    const lento = { put: (k, b) => new Promise((res) => setTimeout(() => { mapa.set(k, b); res(); }, 200)),
      get: (k) => new Promise((res) => setTimeout(() => res(mapa.has(k) ? mapa.get(k) : undefined), 1)),
      del: (k) => new Promise((res) => setTimeout(() => { mapa.delete(k); res(); }, 1)), limparPrefixo: () => Promise.resolve() };
    const lsL = novoLS(); const pl = pedido({ comFoto: true });
    const L1 = montar({ ls: lsL, fotos: lento, prazoFotos: 60 }); L1.srv.modo = "rede";
    const adL = await L1.fila.adicionar(pl, { foto_depois: FOTO });
    await L1.fila.enviar(true);
    await espera(400);                                                   // a gravação lenta terminou
    vale("prazo estourou (foto na memória), mas a gravação terminou depois: a foto está no aparelho e a marca 'só na memória' sai",
      adL.soNaMemoria === true && mapa.has("u1:" + pl.id + ":foto_depois") && !/"soNaMemoria":true/.test(lsL.getItem("man2_fila:u1") || ""), lsL.getItem("man2_fila:u1"));
    const L2 = montar({ ls: lsL, fotos: lento, prazoFotos: 60, srv: L1.srv });   // painel fechado e aberto de novo
    L1.srv.modo = "ok";
    const relL = await L2.fila.tentarAgora();
    const itL = L2.fila.item(pl.id);
    vale("painel reaberto com internet: a foto sai do aparelho e o registro é confirmado (não vira 'a foto se perdeu')",
      relL.confirmados.length === 1 && Object.keys(L1.srv.execucoes).length === 1 && !itL, itL ? itL.estado + " · " + (itL.erro && itL.erro.mensagem) : "confirmado");
    // a aba foi fechada ANTES de a gravação lenta terminar: a marca ficou no aparelho, mas a foto está no IndexedDB
    const lsL3 = novoLS(), fotosL3 = novasFotos({ falhar: true }); const pl3 = pedido({ comFoto: true });
    const L3 = montar({ ls: lsL3, fotos: fotosL3, prazoFotos: 60 }); L3.srv.modo = "rede";
    await L3.fila.adicionar(pl3, { foto_depois: FOTO }); await L3.fila.enviar(true);
    const marcaL3 = /"soNaMemoria":true/.test(lsL3.getItem("man2_fila:u1") || "");
    const fotosL4 = novasFotos(); fotosL4._m.set("u1:" + pl3.id + ":foto_depois", FOTO);
    const L4 = montar({ ls: lsL3, fotos: fotosL4, prazoFotos: 60, relogio: { t: 1000000 + 10 * 60000 } });
    L4.srv.modo = "ok";
    const relL4 = await L4.fila.tentarAgora();
    const itL4 = L4.fila.item(pl3.id);
    vale("marca 'só na memória' gravada, mas a foto está no aparelho: o painel consulta o aparelho antes de dizer que se perdeu, e envia",
      marcaL3 && relL4.confirmados.length === 1 && !itL4, itL4 ? itL4.estado + " · " + (itL4.erro && itL4.erro.mensagem) : "confirmado");
  }

  console.log("\n=== 18) Duas abas do mesmo login, IndexedDB com erro: a foto está viva na memória da OUTRA aba ===\n");
  {
    const lsA = novoLS(), srvA = novoServidor(), relA = { t: 1000000 }; srvA.modo = "rede";
    const A = montar({ ls: lsA, fotos: quebrado, srv: srvA, relogio: relA, prazoFotos: 60 });
    const Bb = montar({ ls: lsA, fotos: quebrado, srv: srvA, relogio: relA, prazoFotos: 60 });
    const pa = pedido({ comFoto: true });
    const adA = await A.fila.adicionar(pa, { foto_depois: FOTO });
    await A.fila.enviar(true);                                           // sem internet
    Bb.fila.sincronizar();                                               // evento "storage" na aba B
    relA.t += 31000;                                                     // passou a espera; ainda sem internet
    await Bb.fila.enviar(false);                                         // relógio de 30 s da aba B
    const itB = Bb.fila.item(pa.id);
    vale("aba B (sem a foto, sem internet) NÃO diz 'a foto se perdeu' enquanto a aba A, que tem a foto, está aberta",
      adA.soNaMemoria === true && !!itB && itB.estado === "pendente" && /outra aba/.test((itB.erro && itB.erro.mensagem) || ""), itB ? itB.estado + " · " + JSON.stringify(itB.erro) : "SUMIU");
    vale("…e na aba B o Descartar é recusado", Bb.fila.descartar(pa.id) === false && Bb.fila.qtd() === 1, "fila B=" + Bb.fila.qtd());
    srvA.modo = "ok";
    const rA = await A.fila.tentarAgora();
    Bb.fila.sincronizar();
    vale("internet de volta: a aba A envia com a foto e a aba B acompanha", rA.confirmados.length === 1 && Object.keys(srvA.execucoes).length === 1 && Bb.fila.qtd() === 0,
      rA.confirmados.length + " confirmado(s) · fila B=" + Bb.fila.qtd());
    // a aba dona sumiu sem avisar (o celular fechou): sem sinal de vida há mais de 5 minutos, a foto se perdeu de verdade
    const lsC = novoLS(), srvC = novoServidor(), relC = { t: 1000000 }; srvC.modo = "rede";
    const C1 = montar({ ls: lsC, fotos: quebrado, srv: srvC, relogio: relC, prazoFotos: 60 });
    const pc = pedido({ comFoto: true });
    await C1.fila.adicionar(pc, { foto_depois: FOTO }); await C1.fila.enviar(true);
    relC.t += 6 * 60000;
    const C2 = montar({ ls: lsC, fotos: quebrado, srv: srvC, relogio: relC, prazoFotos: 60 });
    srvC.modo = "ok";
    await C2.fila.tentarAgora();
    const itC = C2.fila.item(pc.id);
    vale("aba dona sem sinal de vida há mais de 5 minutos: o registro vira 'precisa de atenção' e dá para Descartar",
      !!itC && itC.estado === "atencao" && C2.fila.descartar(pc.id) === true, itC ? itC.estado + " · " + (itC.erro && itC.erro.mensagem) : "SUMIU");
  }

  console.log("\n" + ok + " OK, " + falhou + " falha(s)\n");
  process.exit(falhou ? 1 : 0);
})();
