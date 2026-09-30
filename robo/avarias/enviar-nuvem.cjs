// ==AVR-ENVIAR== AVARIAS · o envio do robô do piloto para a nuvem (Supabase, API REST, chave de serviço).
//
// ESCREVE SÓ em tabelas avaria_* (as de colunas.cjs + avaria_sync + avaria_mudancas_vr) e chama SÓ as 3 funções do
// retrato (avaria_retrato_iniciar / _montar / _publicar). Nenhuma função de gravar do livro existe em produção e nenhuma
// é chamada daqui. A chave (SUPABASE_SERVICE_KEY do .env) nunca é impressa.
//
// GRAVA SÓ O QUE MUDOU. Cada linha leva uma IMPRESSÃO (hash dos valores já no formato em que o banco guarda: numeric(13,4)
// arredondado a 4 casas, data "AAAA-MM-DD", hora sem o "T"...). O estado — a impressão de cada linha que a nuvem CONFIRMOU —
// fica em output/avarias-enviado.json. Uma impressão só entra no estado depois que a nuvem devolveu a chave gravada.
// Estado ausente, ilegível, de outra versão, ou de outra máquina (a ultima_tentativa que a nuvem guarda em avaria_sync não é
// a que este estado anotou: alguém mais gravou) = o robô relê da nuvem as linhas daquela tabela, paginando COM order e
// conferindo count=exact, e recalcula as impressões. Assim um estado velho só pode causar reenvio, nunca linha esquecida.
//
// O QUE SUMIU DO VR (colunas.cjs, "carga"): histórico ganha sumiu_em (nunca apaga; se voltar, sumiu_em volta a nulo);
// saldo vira 0; retrato perde a linha (DELETE); "acumula" fica como está (é assim na recarga aprovada da bancada; decisão
// D5: nunca calado — vai para o log, para o resultado e para o resumo da conferência, em acumula_sumiram_do_vr).
//
// ANTES DE TUDO (decisão D4): a lista de consultas que o robô vai montar (scripts/avarias/tela/consultas.js) tem de ser a
// MESMA que a nuvem tem em avaria_retrato_consultas (o SQL do piloto a grava a partir do mesmo arquivo). Diferente = erro
// claro ("o SQL do piloto na nuvem está desatualizado: rode sql/avarias_v1_piloto.sql"), nada gravado, nada publicado.
//
// DEPOIS DA CARGA: avaria_sync (hora boa de cada parte) e o RETRATO que o Painel lê: iniciar -> montar(versão, consulta)
// para CADA consulta de scripts/avarias/tela/consultas.js -> publicar(versão). Qualquer passo que falhe: o retrato NÃO é
// publicado (o Painel continua com o anterior) e o erro sobe para a rodada.
//
// A RODADA EM avaria_sync (decisão D1): toda falha que o robô consegue anotar vai para a linha "avaria_rodada"
// (ultima_tentativa + ultimo_erro), e SÓ para ela; a rodada que publica o retrato grava nela a hora boa e limpa o erro.
// As linhas das tabelas NÃO são tocadas numa falha: a ultima_tentativa delas é a "ficha" que confere o estado local
// (mexer nela numa falha obrigaria a jogar o estado fora e reler a nuvem inteira na rodada seguinte, ~27 MB, por um 503).
// Na rodada boa, a linha de cada tabela fica com ultima_ok = ultima_tentativa = a hora em que o VR foi lido: a tela não
// mostra "atualizando desde..." depois de uma rodada que deu certo.
//
// O RESUMO DA CONFERÊNCIA (decisão D2): a cada rodada que publica, sobe em avaria_sync, linha "conferencia_js", coluna
// "detalhe" (só contagens e somas; nenhuma lista por nota, nenhum nome). Falhar aqui não derruba a rodada: vai para o log.
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const K = require("./colunas.cjs");

const LOTE = 500;                 // linhas por gravação
const PAGINA = 1000;              // o Supabase corta em 1000 por resposta
const MAX_FILTRO = 3500;          // tamanho máximo do filtro de chaves numa URL (PATCH/DELETE em pedaços)
const VERSAO_ESTADO = 1;
const HASH_CHARS = 24;            // 96 bits por linha: sem colisão prática e o estado fica pequeno

// ============================================================================ impressão (funções puras)
// Arredonda um número escrito em decimal (texto) para "escala" casas, metade para longe do zero — como o numeric do
// Postgres. Trabalha no TEXTO de propósito: (1.005).toFixed(2) dá "1.00" no JS e o banco guarda 1.01.
function arredondarDecimal(txt, escala) {
  let s = String(txt).trim(), neg = false;
  if (s[0] === "-" || s[0] === "+") { neg = s[0] === "-"; s = s.slice(1); }
  if (!/^[0-9]*\.?[0-9]*$/.test(s) || s === "" || s === ".") return null;
  let [int, frac = ""] = s.split(".");
  int = int.replace(/^0+(?=[0-9])/, "") || "0";
  if (frac.length > escala) {
    const sobe = frac.charCodeAt(escala) - 48 >= 5;
    let dig = (int + frac.slice(0, escala)).split("").map(Number);
    if (sobe) { let i = dig.length - 1; while (i >= 0) { if (dig[i] === 9) { dig[i] = 0; i--; } else { dig[i]++; break; } } if (i < 0) dig.unshift(1); }
    const todos = dig.join("");
    int = todos.slice(0, todos.length - escala) || "0"; frac = todos.slice(todos.length - escala);
    int = int.replace(/^0+(?=[0-9])/, "") || "0";
  } else frac = frac.padEnd(escala, "0");
  const r = escala > 0 ? int + "." + frac : int;
  return neg && /[1-9]/.test(r) ? "-" + r : r;
}
// Texto decimal de um número do JS (o mesmo que o JSON manda). Notação científica vira decimal comum.
function textoDoNumero(v) {
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return null;
    const s = String(v);
    return /e/i.test(s) ? v.toFixed(20) : s;
  }
  const s = String(v).trim();
  if (s === "") return null;
  if (/e/i.test(s)) { const x = Number(s); return Number.isFinite(x) ? textoDoNumero(x) : null; }
  return s;
}
// O valor como o banco o guarda (e como a API devolve), num texto estável para a impressão.
function canonValor(v, tipo) {
  if (v === null || v === undefined) return null;
  if (tipo === "integer" || tipo === "smallint" || tipo === "bigint") {
    const x = Number(v); return Number.isFinite(x) ? String(Math.trunc(x)) : null;
  }
  const m = /^numeric(?:\((\d+),(\d+)\))?$/.exec(tipo);
  if (m) {
    const t = textoDoNumero(v); if (t === null) return null;
    if (m[2] !== undefined) return arredondarDecimal(t, Number(m[2]));
    const x = Number(t); return Number.isFinite(x) ? String(x) : null;      // numeric sem escala guarda o que chegou
  }
  if (tipo === "boolean") return v === true || v === "t" || v === "true" ? "t" : v === false || v === "f" || v === "false" ? "f" : null;
  if (tipo === "date") return String(v).slice(0, 10);
  if (tipo === "timestamp") return String(v).replace("T", " ");
  return String(v);                                                         // text
}
function tiposDe(tab) { const t = K.T[tab]; if (!t) throw new Error("tabela desconhecida: " + tab); return t.tipos; }
function impressao(tab, linha) {
  const tipos = tiposDe(tab);
  const vals = K.COLUNAS[tab].map((c) => canonValor(linha[c], tipos[c]));
  return crypto.createHash("sha1").update(JSON.stringify(vals)).digest("hex").slice(0, HASH_CHARS);
}
function chaveDe(tab, linha) {
  const tipos = tiposDe(tab);
  return JSON.stringify(K.CHAVES[tab].map((c) => canonValor(linha[c], tipos[c])));
}
// A linha como vai no corpo: EXATAMENTE as colunas da tabela (o PostgREST recusa lote com objetos de chaves diferentes).
// Número não finito vira nulo (o JSON faria isso calado). As de histórico levam sumiu_em nulo: linha que volta, volta viva.
function linhaParaEnvio(tab, linha) {
  const o = {};
  for (const c of K.COLUNAS[tab]) { const v = linha[c]; o[c] = v === undefined || (typeof v === "number" && !Number.isFinite(v)) ? null : v; }
  if (K.CARGA[tab] === "historico") o.sumiu_em = null;
  return o;
}

// ============================================================================ filtros de chave na URL (PostgREST)
// Valor de texto vai entre aspas (com \ e " escapados): "NE#123", "2026-09" e textos com vírgula ou parêntese não quebram
// o filtro. Memória do dono: valor com aspas mal postas faz o filtro pegar TUDO calado — por isso toda chave de texto é
// citada, o filtro inteiro vai codificado, e a resposta (return=representation) é conferida contra as chaves pedidas.
function valorFiltro(txt, tipo) {
  if (tipo === "integer" || tipo === "smallint" || tipo === "bigint") { if (!/^-?[0-9]+$/.test(txt)) throw new Error("chave inteira inválida: " + txt); return txt; }
  return '"' + String(txt).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}
// Pedaços de filtro para uma lista de chaves (as chaves no formato de chaveDe). Chave de 1 coluna: col=in.(...);
// composta: or=(and(a.eq.x,b.eq.y),...). Cada pedaço cabe em MAX_FILTRO caracteres codificados.
function filtrosDeChaves(tab, chaves, max) {
  const cols = K.CHAVES[tab], tipos = tiposDe(tab), lim = max || MAX_FILTRO, out = [];
  let atual = [], tam = 0;
  const peca = (k) => {
    const v = JSON.parse(k);
    if (v.some((x) => x === null)) throw new Error("chave nula em " + tab + ": " + k);
    return cols.length === 1 ? valorFiltro(v[0], tipos[cols[0]]) : "and(" + cols.map((c, i) => c + ".eq." + valorFiltro(v[i], tipos[c])).join(",") + ")";
  };
  const fechar = () => {
    if (!atual.length) return;
    const q = cols.length === 1 ? cols[0] + "=in." + encodeURIComponent("(" + atual.join(",") + ")") : "or=" + encodeURIComponent("(" + atual.join(",") + ")");
    out.push({ filtro: q, n: atual.length });
    atual = []; tam = 0;
  };
  for (const k of chaves) {
    const p = peca(k), t = encodeURIComponent(p).length + 3;
    if (atual.length && tam + t > lim) fechar();
    atual.push(p); tam += t;
  }
  fechar();
  return out;
}

// ============================================================================ a conversa com a nuvem
// pedir(metodo, caminho, corpo, cabecalhos) -> Promise<{ status, cabecalhos, corpo }>; NUNCA rejeita (status 0 = não chegou).
// Serve http e https: o teste aponta para um servidor de mentira local; o robô, para o Supabase.
function criarPedir(baseUrl, chave, tempoMs) {
  const u = new URL(baseUrl);
  const mod = u.protocol === "http:" ? require("http") : require("https");
  return (metodo, caminho, corpo, cabecalhos) => new Promise((resolve) => {
    const dados = corpo === undefined ? null : JSON.stringify(corpo);
    const h = Object.assign({ apikey: chave, Authorization: "Bearer " + chave }, cabecalhos || {});
    if (dados !== null) { h["Content-Type"] = "application/json"; h["Content-Length"] = Buffer.byteLength(dados); }
    let pronto = false;
    const fim = (x) => { if (!pronto) { pronto = true; resolve(x); } };
    const r = mod.request({ protocol: u.protocol, hostname: u.hostname, port: u.port || undefined, path: caminho, method: metodo, headers: h }, (res) => {
      let t = ""; res.setEncoding("utf8"); res.on("data", (d) => (t += d));
      res.on("end", () => fim({ status: res.statusCode, cabecalhos: res.headers, corpo: t }));
      res.on("error", (e) => fim({ status: 0, cabecalhos: {}, corpo: e.message }));
    });
    r.on("error", (e) => fim({ status: 0, cabecalhos: {}, corpo: e.message }));
    r.setTimeout(tempoMs || 30000, () => { try { r.destroy(); } catch (e) { /* já foi */ } fim({ status: 0, cabecalhos: {}, corpo: "a nuvem não respondeu em " + Math.round((tempoMs || 30000) / 1000) + " s" }); });
    if (dados !== null) r.write(dados);
    r.end();
  });
}
function explicarRecusa(r, alvo) {
  const c = String(r.corpo || "");
  if (/PGRST205|42P01/.test(c) || (r.status === 404 && c.indexOf(alvo) >= 0)) return alvo + " ainda não existe no Supabase — falta rodar sql/avarias_v1_piloto.sql";
  if (/PGRST202|42883/.test(c)) return "a função " + alvo + " não existe no Supabase — falta rodar sql/avarias_v1_piloto.sql";
  if (/PGRST204|42703/.test(c)) return "coluna que o robô manda não existe em " + alvo + " (o SQL e o robô divergiram): " + c.slice(0, 200);
  if (r.status === 401 || r.status === 403 || /42501/.test(c)) return "a nuvem recusou a chave (" + r.status + ") em " + alvo + ": confira SUPABASE_SERVICE_KEY no .env";
  return (r.status ? "a nuvem recusou (" + r.status + ") em " + alvo : "a nuvem não respondeu em " + alvo) + ": " + c.slice(0, 300);
}
function lerJson(r, oque) { try { return JSON.parse(r.corpo || "null"); } catch (e) { throw new Error(oque + ": resposta ilegível"); } }

// PATCH/DELETE sem filtro de chave pegaria a tabela INTEIRA: nunca sai daqui sem um filtro "chave=in.(...)" ou "or=(and(...))".
function exigirFiltro(tab, f) {
  const cols = K.CHAVES[tab];
  const bom = f && f.n > 0 && (cols.length === 1 ? f.filtro.indexOf(cols[0] + "=in.") === 0 : f.filtro.indexOf("or=") === 0) && f.filtro.length > 8;
  if (!bom) throw new Error("recusado: alteração em " + tab + " sem filtro de chave");
}

// Todas as chamadas à nuvem que o robô faz. Tudo passa por "pedir" (o teste troca por um servidor de mentira).
// pedirLongo (opcional) é usado nas funções do retrato, que podem levar mais que uma gravação comum.
function criarNuvem(pedir, pedirLongo) {
  const pedirRpc = pedirLongo || pedir;
  const selChave = (tab) => K.CHAVES[tab].join(",");
  // As chaves que voltaram têm de ser EXATAMENTE as pedidas (nem a mais — filtro que pegou tudo — nem a menos).
  const conferirVolta = (tab, pedidas, volta, oque, aceitaMenos) => {
    const quero = new Set(pedidas), veio = new Set((volta || []).map((x) => chaveDe(tab, x)));
    const estranhas = [...veio].filter((k) => !quero.has(k));
    if (estranhas.length) throw new Error(oque + " em " + tab + ": a nuvem mexeu em " + estranhas.length + " linha(s) que não foram pedidas (ex.: " + estranhas[0] + "); parado");
    if (!aceitaMenos && veio.size !== quero.size) throw new Error(oque + " em " + tab + ": a nuvem confirmou " + veio.size + " de " + quero.size);
    return veio;
  };
  const N = {
    // Linhas inteiras de uma tabela, paginando COM ordem (sem order= as páginas duplicam e pulam) e conferindo o total
    // que o próprio banco declara (count=exact). Não bateu = erro. "prazo()" é consultado entre as páginas.
    async lerTudo(tab, colunas, prazo) {
      const ordem = K.CHAVES[tab] ? K.CHAVES[tab].map((c) => c + ".asc").join(",") : colunas.split(",")[0] + ".asc";
      const linhas = [];
      let de = 0, total = null, voltas = 0;
      for (;;) {
        if (++voltas > 2000) throw new Error("ler " + tab + ": a paginação não terminou");
        if (prazo) prazo("lendo " + tab);
        const r = await pedir("GET", "/rest/v1/" + tab + "?select=" + colunas + "&order=" + ordem, undefined,
          { "Range-Unit": "items", Range: de + "-" + (de + PAGINA - 1), Prefer: "count=exact" });
        if (r.status !== 200 && r.status !== 206) throw new Error("ler " + tab + ": " + explicarRecusa(r, tab));
        const faixa = String((r.cabecalhos && (r.cabecalhos["content-range"] || r.cabecalhos["Content-Range"])) || "");
        const m = faixa.match(/\/([0-9]+)$/);
        if (!m) throw new Error("ler " + tab + ": a nuvem não informou o total (Content-Range '" + faixa + "')");
        const t = +m[1];
        if (total === null) total = t;
        else if (t !== total) throw new Error("ler " + tab + ": o total mudou durante a leitura (" + total + " → " + t + ")");
        const pag = lerJson(r, "ler " + tab);
        if (!Array.isArray(pag)) throw new Error("ler " + tab + ": resposta não é lista");
        linhas.push(...pag);
        de += pag.length;
        if (de >= total) break;
        if (!pag.length) throw new Error("ler " + tab + ": página vazia em " + de + " de " + total);
      }
      if (linhas.length !== total) throw new Error("ler " + tab + ": vieram " + linhas.length + " linhas, o banco diz " + total);
      return linhas;
    },
    async lerSync() { return N.lerTudo(K.SYNC.tabela, K.SYNC.colunas.join(",")); },
    // Um lote de linhas (upsert pela chave). A nuvem devolve só as chaves gravadas, e elas têm de ser as enviadas.
    async gravarLote(tab, linhas) {
      const corpo = linhas.map((l) => linhaParaEnvio(tab, l));
      const r = await pedir("POST", "/rest/v1/" + tab + "?on_conflict=" + selChave(tab) + "&select=" + selChave(tab), corpo,
        { Prefer: "resolution=merge-duplicates,return=representation" });
      if (r.status < 200 || r.status >= 300) throw new Error("gravar " + tab + ": " + explicarRecusa(r, tab));
      conferirVolta(tab, linhas.map((l) => chaveDe(tab, l)), lerJson(r, "gravar " + tab), "gravar");
      return linhas.length;
    },
    // PATCH pelas chaves (sumiu_em, saldo 0). extra = filtro a mais (ex.: "sumiu_em=is.null"). Devolve as chaves tocadas.
    async mudarPorChaves(tab, chaves, corpo, extra) {
      const tocadas = new Set();
      for (const f of filtrosDeChaves(tab, chaves)) {
        exigirFiltro(tab, f);
        const r = await pedir("PATCH", "/rest/v1/" + tab + "?" + f.filtro + (extra ? "&" + extra : "") + "&select=" + selChave(tab), corpo,
          { Prefer: "return=representation" });
        if (r.status < 200 || r.status >= 300) throw new Error("marcar " + tab + ": " + explicarRecusa(r, tab));
        for (const k of conferirVolta(tab, chaves, lerJson(r, "marcar " + tab), "marcar", true)) tocadas.add(k);
      }
      return tocadas;
    },
    async apagarPorChaves(tab, chaves) {
      const tocadas = new Set();
      for (const f of filtrosDeChaves(tab, chaves)) {
        exigirFiltro(tab, f);
        const r = await pedir("DELETE", "/rest/v1/" + tab + "?" + f.filtro + "&select=" + selChave(tab), undefined, { Prefer: "return=representation" });
        if (r.status < 200 || r.status >= 300) throw new Error("apagar " + tab + ": " + explicarRecusa(r, tab));
        for (const k of conferirVolta(tab, chaves, lerJson(r, "apagar " + tab), "apagar", true)) tocadas.add(k);
      }
      return tocadas;
    },
    // Linhas de avaria_sync. Só as colunas do objeto mudam (o PostgREST não mexe no que não vem): falha manda só
    // tentativa + erro e a última hora boa continua. Todos os objetos de uma chamada têm as mesmas chaves.
    async gravarSync(linhas) {
      if (!linhas.length) return 0;
      const r = await pedir("POST", "/rest/v1/" + K.SYNC.tabela + "?on_conflict=fonte&select=fonte", linhas,
        { Prefer: "resolution=merge-duplicates,return=representation" });
      if (r.status < 200 || r.status >= 300) throw new Error("gravar avaria_sync: " + explicarRecusa(r, K.SYNC.tabela));
      const volta = lerJson(r, "gravar avaria_sync") || [];
      if (volta.length !== linhas.length) throw new Error("gravar avaria_sync: a nuvem confirmou " + volta.length + " de " + linhas.length);
      return volta.length;
    },
    // a linha "conferencia_js" (decisão D2): o resumo vai na coluna jsonb "detalhe"; ultima_ok = a hora da leitura do VR
    async subirConferencia(detalhe, lidoEm) {
      const r = await pedir("POST", "/rest/v1/" + K.SYNC.tabela + "?on_conflict=fonte&select=fonte",
        [{ fonte: K.SYNC.conferencia, ultima_ok: lidoEm, detalhe }], { Prefer: "resolution=merge-duplicates,return=representation" });
      if (r.status < 200 || r.status >= 300) throw new Error("subir a conferência: " + explicarRecusa(r, K.SYNC.tabela));
      const volta = lerJson(r, "subir a conferência") || [];
      if (volta.length !== 1 || volta[0].fonte !== K.SYNC.conferencia) throw new Error("subir a conferência: a nuvem não confirmou a linha " + K.SYNC.conferencia);
      return true;
    },
    async registrarMudanca(obj) {
      const r = await pedir("POST", "/rest/v1/avaria_mudancas_vr", [obj], { Prefer: "return=minimal" });
      if (r.status < 200 || r.status >= 300) throw new Error("registrar mudança: " + explicarRecusa(r, "avaria_mudancas_vr"));
    },
    async rpc(nome, args) {
      const r = await pedirRpc("POST", "/rest/v1/rpc/" + nome, args || {}, {});
      if (r.status < 200 || r.status >= 300) throw new Error(nome + ": " + explicarRecusa(r, nome));
      return r.corpo ? lerJson(r, nome) : null;
    },
    // Quantas linhas a tabela tem (count=exact, sem trazer linha): confere o estado local antes de confiar nele.
    async contar(tab) {
      const r = await pedir("GET", "/rest/v1/" + tab + "?select=" + K.CHAVES[tab][0] + "&limit=1", undefined, { Prefer: "count=exact" });
      if (r.status !== 200 && r.status !== 206) throw new Error("contar " + tab + ": " + explicarRecusa(r, tab));
      const m = String((r.cabecalhos && (r.cabecalhos["content-range"] || r.cabecalhos["Content-Range"])) || "").match(/\/([0-9]+)$/);
      if (!m) throw new Error("contar " + tab + ": a nuvem não informou o total");
      return +m[1];
    },
  };
  return N;
}

// ============================================================================ o estado local (o que a nuvem confirmou)
function estadoVazio() { return { versao: VERSAO_ESTADO, tabelas: {} }; }
function lerEstado(arquivo) {
  try {
    const e = JSON.parse(fs.readFileSync(arquivo, "utf8"));
    if (!e || e.versao !== VERSAO_ESTADO || !e.tabelas || typeof e.tabelas !== "object") return estadoVazio();
    return e;
  } catch (e) { return estadoVazio(); }
}
// grava num arquivo ao lado e troca: uma queda no meio não deixa o estado pela metade
function salvarEstado(arquivo, estado) {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  const tmp = arquivo + ".gravando";
  fs.writeFileSync(tmp, JSON.stringify(estado));
  fs.renameSync(tmp, arquivo);
}
function mesmoInstante(a, b) {
  if (a == null || b == null) return a == null && b == null;
  const x = Date.parse(a), y = Date.parse(b);
  return Number.isFinite(x) && x === y;
}
function estadoDaNuvem(tab, linhas, tentativa) {
  const h = {}, s = {};
  for (const l of linhas) { const k = chaveDe(tab, l); h[k] = impressao(tab, l); if (K.CARGA[tab] === "historico" && l.sumiu_em) s[k] = 1; }
  return { tentativa: tentativa == null ? null : tentativa, h, s };
}

// O que fazer numa tabela (função pura): gravar o que é novo ou mudou (ou que tinha sumido e voltou); e o que sumiu,
// conforme o jeito da tabela. Chave repetida na montagem é erro alto (a tabela tem chave primária).
function planejar(tab, linhas, est) {
  const carga = K.CARGA[tab], h = (est && est.h) || {}, s = (est && est.s) || {};
  const novas = new Map(), cols = K.COLUNAS[tab];
  for (const l of linhas) {
    // número que não é número (NaN, infinito) viraria nulo calado no JSON: é erro do cálculo, nada é gravado
    for (const c of cols) { const v = l[c]; if (typeof v === "number" && !Number.isFinite(v)) throw new Error("valor inválido (" + v + ") em " + tab + "." + c + "; nada gravado"); }
    const k = chaveDe(tab, l);
    if (novas.has(k)) throw new Error("chave repetida na montagem de " + tab + ": " + k);
    novas.set(k, { k, l, i: impressao(tab, l) });
  }
  const gravar = [];
  for (const x of novas.values()) if (h[x.k] !== x.i || s[x.k]) gravar.push(x);
  const marcar = [], zerar = [], apagar = [], ficam = [];
  for (const k of Object.keys(h)) {
    if (novas.has(k)) continue;
    if (carga === "historico") { if (!s[k]) marcar.push(k); }
    else if (carga === "saldo") { if (!s[k]) zerar.push(k); }
    else if (carga === "retrato") apagar.push(k);
    else ficam.push(k);
  }
  return { tab, carga, total: novas.size, gravar, marcar, zerar, apagar, ficam };
}
function emLotes(l, n) { const s = []; for (let i = 0; i < l.length; i += n) s.push(l.slice(i, i + n)); return s; }

// ============================================================================ a lista de consultas do retrato (D4)
// O que a nuvem tem de ter em avaria_retrato_consultas, a partir de tela/consultas.js (o MESMO arquivo de que o SQL do
// piloto é gerado). "pedaco" só é cobrado quando consultas.js o define (senão vale o padrão do SQL: só muda o tamanho dos
// pedaços, nunca o conteúdo). Devolve a lista de diferenças (vazia = igual).
function diferencasDaLista(defs, naNuvem) {
  const dif = [], nuvem = new Map((naNuvem || []).map((r) => [r.consulta, r]));
  const txt = (v) => (v === null || v === undefined ? null : String(v));
  for (const [c, q] of Object.entries(defs || {})) {
    const r = nuvem.get(c);
    if (!r) { dif.push("falta a consulta " + c); continue; }
    for (const k of ["visao", "colunas", "ordem", "sob_demanda"]) if (txt(q[k] || null) !== txt(r[k])) dif.push(c + "." + k + " (a nuvem tem " + JSON.stringify(r[k]) + ")");
    if (q.pedaco !== undefined && Number(q.pedaco) !== Number(r.pedaco)) dif.push(c + ".pedaco (a nuvem tem " + JSON.stringify(r.pedaco) + ")");
  }
  for (const c of nuvem.keys()) if (!Object.prototype.hasOwnProperty.call(defs || {}, c)) dif.push("a nuvem tem a consulta " + c + ", que a tela não tem");
  return dif;
}
const MSG_SQL_VELHO = "o SQL do piloto na nuvem está desatualizado: rode sql/avarias_v1_piloto.sql";

// ============================================================================ a sessão de envio de UMA rodada
//   o.nuvem (criarNuvem), o.estado (lerEstado), o.salvar() (grava o estado), o.agora() (ms), o.prazo(oque) (lança erro
//   quando o tempo da rodada acabou), o.log
function criarEnvio(o) {
  const log = o.log || (() => {}), agora = o.agora || Date.now, prazo = o.prazo || (() => {});
  const est = o.estado;
  let T = null;                      // a ultima_tentativa que esta rodada anotou na nuvem
  let conferido = false;             // o estado já foi conferido nesta rodada (a rodada confere ANTES de ler o VR)
  const res = { tabelas: {}, releu: [], avisos: [], acumula_sumiram_do_vr: {}, retrato: null, ms: {} };
  const salvar = () => { try { o.salvar(); } catch (e) { res.avisos.push("não consegui gravar o estado local: " + e.message); } };

  // 1) confere o estado local de cada tabela contra a nuvem; o que não bate é relido
  async function conferirEstado() {
    const t0 = Date.now();
    const sync = new Map((await o.nuvem.lerSync()).map((r) => [r.fonte, r]));
    for (const tab of K.TABELAS) {
      prazo("conferindo o estado de " + tab);
      const e = est.tabelas[tab], cloudT = sync.has(tab) ? sync.get(tab).ultima_tentativa : null;
      let ok = !!(e && e.h && e.s && mesmoInstante(e.tentativa, cloudT));
      if (ok) { const n = await o.nuvem.contar(tab); ok = n === Object.keys(e.h).length; if (!ok) log("  " + tab + ": a nuvem tem " + n + " linhas e o estado local " + Object.keys(e.h).length + " — relendo"); }
      if (!ok) {
        const cols = K.COLUNAS[tab].join(",") + (K.CARGA[tab] === "historico" ? ",sumiu_em" : "");
        const linhas = await o.nuvem.lerTudo(tab, cols, prazo);
        est.tabelas[tab] = estadoDaNuvem(tab, linhas, cloudT);
        res.releu.push(tab + " (" + linhas.length + ")");
        salvar();
      }
    }
    res.ms.conferir_estado = Date.now() - t0;
    conferido = true;
  }

  // 0) D4: a lista de consultas da tela (defs = o objeto de tela/consultas.js) é a que a nuvem sabe montar?
  async function conferirConsultas(defs) {
    const t0 = Date.now();
    prazo("conferindo a lista de consultas do retrato");
    const naNuvem = await o.nuvem.lerTudo(K.RETRATO.lista, K.RETRATO.lista_colunas.join(","));
    const dif = diferencasDaLista(defs, naNuvem);
    res.ms.conferir_consultas = Date.now() - t0;
    if (dif.length) throw new Error(MSG_SQL_VELHO + " (" + dif.length + " diferença(s) entre tela/consultas.js e " + K.RETRATO.lista + ": " + dif.slice(0, 4).join("; ") + ")");
    return naNuvem.length;
  }

  // 2) anota a tentativa (antes de gravar qualquer linha: outra máquina saberá que alguém mexeu)
  async function marcarTentativa() {
    const t = new Date(agora()).toISOString();
    await o.nuvem.gravarSync(K.TABELAS.map((tab) => ({ fonte: tab, ultima_tentativa: t })));
    T = t;
    for (const tab of K.TABELAS) est.tabelas[tab].tentativa = t;
    salvar();
  }

  // 3) grava uma tabela conforme o plano: só o que mudou; o que sumiu, conforme o jeito dela
  async function executarPlano(p) {
    const tab = p.tab, t0 = Date.now(), e = est.tabelas[tab];
    const r = { linhas: p.total, gravadas: 0, marcadas_sumiu: 0, zeradas: 0, apagadas: 0, sumiram_e_ficaram: p.ficam.length };
    for (const lote of emLotes(p.gravar, LOTE)) {
      prazo("gravando " + tab + " (" + r.gravadas + " de " + p.gravar.length + ")");
      await o.nuvem.gravarLote(tab, lote.map((x) => x.l));
      for (const x of lote) { e.h[x.k] = x.i; delete e.s[x.k]; }
      r.gravadas += lote.length;
    }
    for (const lote of emLotes(p.marcar, LOTE)) {
      prazo("marcando o que sumiu em " + tab);
      const tocadas = await o.nuvem.mudarPorChaves(tab, lote, { sumiu_em: new Date(agora()).toISOString() }, "sumiu_em=is.null");
      for (const k of lote) e.s[k] = 1;
      r.marcadas_sumiu += tocadas.size;
    }
    for (const lote of emLotes(p.zerar, LOTE)) {
      prazo("zerando o saldo que sumiu em " + tab);
      const tocadas = await o.nuvem.mudarPorChaves(tab, lote, { saldo: 0 });
      for (const k of lote) e.s[k] = 1;
      r.zeradas += tocadas.size;
    }
    for (const lote of emLotes(p.apagar, LOTE)) {
      prazo("tirando do retrato " + tab);
      const tocadas = await o.nuvem.apagarPorChaves(tab, lote);
      for (const k of lote) { delete e.h[k]; delete e.s[k]; }
      r.apagadas += tocadas.size;
    }
    r.ms = Date.now() - t0;
    res.tabelas[tab] = r;
    if (r.gravadas || r.marcadas_sumiu || r.zeradas || r.apagadas || p.marcar.length || p.zerar.length) salvar();   // só regrava o estado se mudou
    return r;
  }

  // Toda a carga + a hora boa em avaria_sync. tabelas = { nome: [linhas] } (todas as de colunas.cjs, obrigatoriamente).
  // antesDeGravar(planos) roda com TODOS os planos prontos e NADA gravado: se lançar erro, nada é gravado.
  async function carregar(tabelas, lidoEm, antesDeGravar) {
    for (const tab of K.TABELAS) if (!Array.isArray(tabelas[tab])) throw new Error("a montagem não trouxe " + tab + "; nada gravado");
    if (!conferido) await conferirEstado();
    const vazia = Object.keys(est.tabelas.avaria_trocas_vr.h).length === 0;
    const planos = K.TABELAS.map((tab) => planejar(tab, tabelas[tab], est.tabelas[tab]));
    res.planos = Object.fromEntries(planos.map((p) => [p.tab, { linhas: p.total, gravar: p.gravar.length, marcar_sumiu: p.marcar.length, zerar: p.zerar.length, apagar: p.apagar.length, sumiram_e_ficam: p.ficam.length }]));
    if (antesDeGravar) antesDeGravar(planos);
    await marcarTentativa();
    const t0 = Date.now();
    for (const p of planos) {
      const tab = p.tab, r = await executarPlano(p);
      // "acumula": o que sumiu do VR continua na nuvem (a recarga aprovada faz assim). Nunca calado: vai para o log.
      if (p.ficam.length) {
        const a = tab + ": " + p.ficam.length + " linha(s) sumiram do VR e continuam na nuvem (regra da recarga aprovada)"; res.avisos.push(a); log("  " + a);
        res.acumula_sumiram_do_vr[tab] = p.ficam.length;     // decisão D5: fica, com aviso; vai também no resumo da conferência
      }
      if (r.gravadas || r.marcadas_sumiu || r.zeradas || r.apagadas)
        log("  " + tab + ": " + r.linhas + " linhas · gravadas " + r.gravadas + (r.marcadas_sumiu ? " · sumiram " + r.marcadas_sumiu : "") +
          (r.zeradas ? " · saldo zerado " + r.zeradas : "") + (r.apagadas ? " · saíram do retrato " + r.apagadas : ""));
    }
    res.ms.carga = Date.now() - t0;
    if (vazia && tabelas.avaria_trocas_vr.length) {
      try { await o.nuvem.registrarMudanca({ tipo: "carga_inicial", chave: "piloto", depois: { origem: "robô do piloto (etapa 3,6)", lido_em: lidoEm, linhas_do_livro: tabelas.avaria_trocas_vr.length } }); }
      catch (e) { res.avisos.push("não anotei a carga inicial em avaria_mudancas_vr: " + e.message); }
    }
    // a hora boa de cada parte. ultima_tentativa = ultima_ok = a hora da leitura do VR (a tela não mostra "atualizando
    // desde..." numa parte que deu certo); é também a ficha nova do estado local, que só passa a valer depois que a nuvem
    // confirma (se a resposta se perder, estado e nuvem divergem e a próxima rodada relê: custa, mas nunca esquece linha)
    await o.nuvem.gravarSync(K.TABELAS.map((tab) => ({ fonte: tab, ultima_ok: lidoEm, ultima_tentativa: lidoEm, ultimo_erro: null, linhas: tabelas[tab].length })));
    T = lidoEm;
    for (const tab of K.TABELAS) est.tabelas[tab].tentativa = lidoEm;
    salvar();
    return res;
  }

  // O retrato que o Painel lê: iniciar -> montar cada consulta -> publicar. Falhou qualquer uma: não publica.
  async function montarRetrato(consultas) {
    const t0 = Date.now();
    prazo("começando o retrato");
    const versao = await o.nuvem.rpc(K.RETRATO.iniciar, {});
    if (versao === null || versao === undefined || !/^[0-9]+$/.test(String(versao))) throw new Error("retrato: a nuvem não devolveu a versão (" + JSON.stringify(versao) + ")");
    const r = { versao: Number(versao), consultas: {}, publicado: false };
    for (const c of consultas) {
      prazo("montando o retrato (" + c + ")");
      const t = Date.now();
      const n = await o.nuvem.rpc(K.RETRATO.montar, { p_versao: r.versao, p_consulta: c });
      if (n === null || n === undefined || !Number.isFinite(Number(n))) throw new Error("retrato: montar " + c + " não devolveu o número de linhas");
      r.consultas[c] = { linhas: Number(n), ms: Date.now() - t };
    }
    prazo("publicando o retrato");
    await o.nuvem.rpc(K.RETRATO.publicar, { p_versao: r.versao });
    r.publicado = true;
    r.ms = Date.now() - t0;
    res.retrato = r;
    return r;
  }

  // Falha (decisão D1): anota tentativa + erro SÓ na linha da rodada (avaria_rodada); a última hora boa dela continua.
  // As linhas das tabelas não são tocadas: a ficha delas (ultima_tentativa) continua valendo e o estado local também — ele
  // tem só o que a nuvem confirmou. O estado é salvo mesmo se a anotação na nuvem falhar.
  async function registrarFalha(msg) {
    try {
      await o.nuvem.gravarSync([{ fonte: K.SYNC.rodada, ultima_tentativa: new Date(agora()).toISOString(), ultimo_erro: String(msg).slice(0, 900) }]);
    } finally { salvar(); }
  }
  // A rodada inteira deu certo (retrato publicado): a hora boa da rodada é a da leitura do VR e o erro some.
  async function registrarSucesso(lidoEm) {
    await o.nuvem.gravarSync([{ fonte: K.SYNC.rodada, ultima_ok: lidoEm, ultima_tentativa: lidoEm, ultimo_erro: null, linhas: null }]);
  }
  // O resumo da conferência do cálculo JS (decisão D2), na linha conferencia_js.
  async function subirConferencia(detalhe, lidoEm) { return o.nuvem.subirConferencia(detalhe, lidoEm); }

  return { carregar, montarRetrato, registrarFalha, registrarSucesso, subirConferencia, conferirConsultas, conferirEstado, executarPlano, resultado: res, tentativa: () => T };
}

// O resumo da conferência (decisão D2) com um "pedir" solto (a rodada usa criarEnvio(...).subirConferencia).
async function subirConferencia(pedir, resumo) {
  return criarNuvem(pedir).subirConferencia(resumo, resumo.lido_em || resumo.gerado_em || new Date().toISOString());
}

module.exports = {
  arredondarDecimal, textoDoNumero, canonValor, impressao, chaveDe, linhaParaEnvio, valorFiltro, filtrosDeChaves, exigirFiltro,
  criarPedir, criarNuvem, explicarRecusa, estadoVazio, lerEstado, salvarEstado, mesmoInstante, estadoDaNuvem, planejar, emLotes,
  criarEnvio, subirConferencia, diferencasDaLista, MSG_SQL_VELHO, LOTE, PAGINA, MAX_FILTRO, VERSAO_ESTADO,
};
