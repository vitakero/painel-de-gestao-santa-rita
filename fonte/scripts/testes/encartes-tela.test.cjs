// TELA DO PLANEJAMENTO DE ENCARTES — conferência estática dos arquivos da tela
// (scripts/encartes/tela.js, tela.css, painel.js), sem navegador e sem banco.
//
// Por que existe: a tela entra num painel de ~35 mil linhas e fala com a nuvem paga por consumo.
// Três coisas quebram CALADAS e só aparecem depois de publicado:
//   1) consulta sem teto ou com select("*") — a franquia do Supabase já foi comida assim (26/08);
//   2) nome de coluna ou de parâmetro de função trocado — o banco recusa e o botão "não faz nada";
//   3) CSS solto (".vaga", "h2") — muda outra tela do painel sem ninguém ver.
// Aqui cada uma dessas é conferida contra o próprio sql/encartes_v1.sql (quando ele existe).
// A prova de que a tela FUNCIONA (fluxos, papéis, celular 390 px) roda no navegador, na prévia
// privada (.previa/encartes/codigo/fotos.cjs) — este teste não a substitui.
//   node scripts/testes/encartes-tela.test.cjs
const fs = require("fs");
const path = require("path");
const RAIZ = path.join(__dirname, "..", "..");
const ler = (p) => { try { return fs.readFileSync(path.join(RAIZ, p), "utf8"); } catch (e) { return null; } };

let ok = 0, falhou = 0;
function vale(nome, cond, det) {
  console.log((cond ? "  OK   " : "  FALHA") + " | " + nome + (!cond && det !== undefined ? "  ->  " + (typeof det === "string" ? det : JSON.stringify(det)) : ""));
  cond ? ok++ : falhou++;
}

const TELA = ler("scripts/encartes/tela.js"), CSS = ler("scripts/encartes/tela.css"), PAINEL = ler("scripts/encartes/painel.js");
const CALC = ler("scripts/encartes/calculo.cjs"), SQL = ler("sql/encartes_v1.sql");
console.log("\n=== Planejamento de Encartes · a tela ===\n");
vale("os três arquivos da tela existem", TELA && CSS && PAINEL);
if (!(TELA && CSS && PAINEL)) { console.log("\n" + ok + " ok, " + falhou + " falha(s)."); process.exit(1); }
const JS = TELA + "\n" + PAINEL;
// Código sem comentários (para não contar texto de explicação como código).
function semComentarios(js) {
  let out = "", i = 0, q = null;
  while (i < js.length) {
    const c = js[i], d = js[i + 1];
    if (q) { out += c; if (c === "\\") { out += d; i += 2; continue; } if (c === q) q = null; i++; continue; }
    if (c === '"' || c === "'" || c === "`") { q = c; out += c; i++; continue; }
    if (c === "/" && d === "*") { const f = js.indexOf("*/", i + 2); i = f < 0 ? js.length : f + 2; continue; }
    if (c === "/" && d === "/" && !/[\w)\]]\s*$/.test(out.slice(-3))) { const f = js.indexOf("\n", i); i = f < 0 ? js.length : f; continue; }
    out += c; i++;
  }
  return out;
}
const CODIGO = semComentarios(TELA) + "\n" + semComentarios(PAINEL);
// Recorta o texto balanceado que começa em src[ini] ("{" ou "("), pulando textos entre aspas.
function balanceado(src, ini) {
  const abre = src[ini], fecha = abre === "{" ? "}" : abre === "(" ? ")" : "]";
  let prof = 0, q = null;
  for (let j = ini; j < src.length; j++) {
    const c = src[j];
    if (q) { if (c === "\\") j++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === "`") { q = c; continue; }
    if (c === abre) prof++;
    else if (c === fecha && --prof === 0) return src.slice(ini, j + 1);
  }
  return null;
}
// O corpo de "function nome(...) {...}" tirado do arquivo, para RODAR (grep não é executar).
function funcao(src, nome) {
  const i = src.indexOf("function " + nome + "(");
  if (i < 0) return null;
  const corpo = balanceado(src, src.indexOf("{", i));
  return corpo ? src.slice(i, src.indexOf("{", i)) + corpo : null;
}
// Valor de uma constante numérica do arquivo ("var PAG = 1000;"); null se não achar.
function constante(nome) { const m = new RegExp("\\bvar " + nome + " = (\\d+)\\s*[;,]").exec(CODIGO); return m ? +m[1] : null; }

// ---------------------------------------------------------------- 1) marcadores e compilação
console.log("-- marcadores, compilação, funções expostas");
vale("marcador ==ENC-TELA== no topo do tela.js", /^\/\* ==ENC-TELA==/.test(TELA));
vale("marcador ==ENC-CSS== no topo do tela.css", /^\/\* ==ENC-CSS==/.test(CSS));
vale("marcador ==ENC-PAINEL== no topo do painel.js", /^\/\* ==ENC-PAINEL==/.test(PAINEL));
vale("marcadores só em ASCII", /==ENC-TELA==/.test(TELA) && /==ENC-CSS==/.test(CSS) && /==ENC-PAINEL==/.test(PAINEL));
for (const [nome, src] of [["tela.js", TELA], ["painel.js", PAINEL]]) {
  let erro = null; try { new Function(src); } catch (e) { erro = e.message; }
  vale(nome + " compila (a trava 1 do build faz o mesmo)", !erro, erro);
}
vale("tela.js expõe window.encTela", /window\.encTela\s*=/.test(CODIGO));
vale("painel.js expõe window.encAbrir", /window\.encAbrir\s*=\s*function/.test(PAINEL));
vale("painel.js expõe window.encAbrirEdicao", /window\.encAbrirEdicao\s*=\s*function\s*\(\s*edicaoId\s*\)/.test(PAINEL));
vale("painel.js expõe window.encResumoCalendario(de, ate)", /window\.encResumoCalendario\s*=\s*function\s*\(\s*de\s*,\s*ate\s*\)/.test(PAINEL));
vale("nenhum </script nem </body dentro do JavaScript (o build injeta o arquivo no HTML)", !/<\/script|<\/body/i.test(JS));
vale("a tela usa o cálculo (window.ENC) e não uma cópia dele", /var E = window\.ENC/.test(TELA) && /var E = window\.ENC/.test(PAINEL));

// ---------------------------------------------------------------- 2) consumo enxuto
console.log("-- consumo enxuto (régua de 26/08)");
function cadeias(src) {
  // Cada ".from(" com os métodos encadeados depois: [{metodo, args}], respeitando parênteses e textos.
  const out = [];
  let i = 0;
  while ((i = src.indexOf(".from(", i)) >= 0) {
    let p = i, cad = [];
    while (src[p] === ".") {
      const m = /^\.([A-Za-z_$][\w$]*)\(/.exec(src.slice(p));
      if (!m) break;
      let j = p + m[0].length, prof = 1, q = null, ini = j;
      while (j < src.length && prof > 0) {
        const c = src[j];
        if (q) { if (c === "\\") j++; else if (c === q) q = null; }
        else if (c === '"' || c === "'" || c === "`") q = c;
        else if (c === "(") prof++;
        else if (c === ")") prof--;
        j++;
      }
      cad.push({ metodo: m[1], args: src.slice(ini, j - 1) });
      p = j;
      while (/\s/.test(src[p] || "")) p++;
    }
    out.push(cad);
    i = i + 6;
  }
  return out;
}
const CAD = cadeias(CODIGO);
vale("a tela lê a nuvem (achou as consultas)", CAD.length >= 15, CAD.length);
const semLimite = CAD.filter((c) => c.some((x) => x.metodo === "select") && !c.some((x) => x.metodo === "limit"));
vale("TODA consulta tem .limit(", !semLimite.length, semLimite.map((c) => c[0].args).join(", "));
// O Supabase corta em 1.000 linhas CALADO: .limit(5000) devolve 1.000 e a tela acha que é tudo.
const tetos = [];
CAD.forEach((c) => c.filter((x) => x.metodo === "limit").forEach((x) => {
  const a = x.args.trim(), n = /^\d+$/.test(a) ? +a : /^[A-Z_][A-Z0-9_]*$/.test(a) ? constante(a) : null;
  if (n === null) tetos.push(c[0].args + ": .limit(" + a + ") não dá para conferir (use número ou constante var X = N)");
  else if (n > 1000) tetos.push(c[0].args + ": .limit(" + a + " = " + n + ") passa do teto de 1.000 do Supabase");
}));
vale("nenhum .limit acima de 1.000 (o teto que o Supabase corta calado)", !tetos.length, tetos.join(" | "));
vale("nenhum select(\"*\") nem select() vazio", !/\.select\(\s*\)/.test(CODIGO) && !/\.select\(\s*["'`][^"'`]*\*/.test(CODIGO) &&
  !CAD.some((c) => c.some((x) => x.metodo === "select" && /\*/.test(x.args))));
vale("nenhuma escrita direta em tabela (insert/update/upsert/delete): só pelas funções do banco", !/\.(insert|update|upsert|delete)\(/.test(CODIGO));
vale("nenhum relógio lendo a nuvem (setInterval)", !/setInterval\(/.test(CODIGO));
const guarda = /var GUARDA_MS = ([\d.e* ]+);/.exec(PAINEL);
const gms = guarda ? Function("return " + guarda[1])() : 0;
vale("guarda de 2 minutos (nada abaixo de 1 min)", gms === 120000, gms);
vale("a ficha do VR NUNCA é lida inteira: busca por RPC encarte_buscar_produtos", /rpc\("encarte_buscar_produtos"/.test(CODIGO) && /p_limite:\s*20/.test(CODIGO));
const ficha = CAD.filter((c) => /encarte_produtos_vr/.test(c[0].args));
vale("encarte_produtos_vr só por código (in produto_id) e no máximo 50",
  ficha.length > 0 && ficha.every((c) => c.some((x) => x.metodo === "in" && /"produto_id"/.test(x.args)) && c.some((x) => x.metodo === "limit" && /^50$/.test(x.args.trim()))));
const paginadas = CAD.filter((c) => c.some((x) => x.metodo === "range"));
vale("consulta paginada (range) sempre com ordem fixa", paginadas.length > 0 && paginadas.every((c) => c.some((x) => x.metodo === "order")));
vale("carrega ao abrir, não no login: encAbrir respeita a guarda", /window\.encAbrir = function \(\) \{\s*if \(D && Date\.now\(\) - lidoEm < GUARDA_MS\)/.test(PAINEL));
vale("espera o login (40 × 0,5 s) como o Compra × Venda", /tentativas\+\+ < 40/.test(PAINEL) && /, 500\)/.test(PAINEL));
vale("aviso claro quando falta rodar o SQL", /falta rodar o arquivo encartes_v1\.sql no Supabase/.test(PAINEL));

// ---------------------------------------------------------------- 3) contra o banco (sql/encartes_v1.sql)
console.log("-- contra o banco: tabelas, colunas e parâmetros das funções");
if (!SQL) vale("sql/encartes_v1.sql existe (sem ele, colunas e parâmetros não são conferidos)", false);
else {
  const TAB = {};
  const reT = /create table if not exists public\.([a-z_]+)\s*\(([\s\S]*?)\n\);/g; let m;
  while ((m = reT.exec(SQL))) {
    TAB[m[1]] = m[2].split("\n").map((l) => /^\s*([a-z_][a-z0-9_]*)\s+(uuid|text|int|bigint|bigserial|date|timestamptz|jsonb|boolean|numeric)/i.exec(l))
      .filter(Boolean).map((x) => x[1]).filter((c) => !/^(unique|primary|check|constraint)$/.test(c));
  }
  // constantes de colunas do painel.js (var COL_X = "a,b" + "c,d";)
  const CONST = {};
  const reC = /var (COL_[A-Z_]+) = ((?:"[^"]*"\s*\+?\s*)+);/g;
  while ((m = reC.exec(PAINEL))) CONST[m[1]] = m[2].match(/"([^"]*)"/g).map((s) => s.slice(1, -1)).join("");
  const erros = [];
  let conferidas = 0;
  CAD.forEach((c) => {
    const t = (/^"([a-z_]+)"$/.exec(c[0].args.trim()) || [])[1];
    if (!t) { erros.push("tabela não literal: " + c[0].args); return; }
    if (!TAB[t]) { erros.push("tabela " + t + " não existe no SQL"); return; }
    const sel = c.filter((x) => x.metodo === "select")[0];
    let cols = [];
    if (sel) {
      const a = sel.args.trim();
      const lit = /^"([^"]*)"$/.exec(a);
      const txt = lit ? lit[1] : CONST[a];
      if (txt === undefined) erros.push(t + ": select com colunas que o teste não sabe ler (" + a + ")");
      else cols = txt.split(",").map((s) => s.trim()).filter(Boolean);
    }
    // Todo método que recebe COLUNA no 1º argumento (inclusive .filter/.not/.like...): a coluna
    // tem de vir escrita (texto literal) para ser conferida — por variável, o teste não enxerga.
    c.forEach((x) => {
      if (/^(eq|neq|gt|gte|lt|lte|in|is|order|filter|not|like|ilike|contains|containedBy|overlaps|textSearch|rangeGt|rangeGte|rangeLt|rangeLte|rangeAdjacent)$/.test(x.metodo)) {
        const k = /^"([a-z_]+)"/.exec(x.args.trim());
        if (k) cols.push(k[1]); else erros.push(t + ": ." + x.metodo + "(" + x.args.trim().slice(0, 30) + ") sem a coluna escrita");
      } else if (x.metodo === "or") (x.args.match(/(?:^["'`]|,)\s*([a-z_]+)\./g) || []).forEach((s) => cols.push(s.replace(/^["'`,]\s*|\.$/g, "")));
      else if (x.metodo === "match") (x.args.match(/\b([a-z_]+)\s*:/g) || []).forEach((s) => cols.push(s.replace(/\s*:$/, "")));
    });
    cols.forEach((col) => { if (TAB[t].indexOf(col) < 0) erros.push(t + "." + col); });
    conferidas++;
  });
  vale("toda coluna pedida/filtrada/ordenada existe na tabela do SQL (" + conferidas + " consultas)", !erros.length, erros.join(" | "));
  // funções chamadas: existem e os parâmetros batem com a assinatura
  const FUN = {};
  const reF = /create or replace function public\.([a-z_]+)\(([\s\S]*?)\)\s*returns/g;
  while ((m = reF.exec(SQL))) {
    FUN[m[1]] = m[2].split(",").map((s) => s.trim()).filter(Boolean).map((s) => ({ nome: s.split(/\s+/)[0], padrao: /\bdefault\b/i.test(s) }));
  }
  const errF = [], chamadas = [];
  // Toda chamada .rpc(...): nome escrito + objeto escrito, OU objeto numa variável (resolvida no
  // arquivo: "var args = {...}"). O único rpc(nome, p) genérico permitido é o do painel.js.
  const reR = /(function\s+)?\brpc\(\s*(?:"([a-z_]+)"|([A-Za-z_$][\w$]*))\s*,\s*/g;
  let genericos = 0;
  while ((m = reR.exec(CODIGO))) {
    if (m[1]) continue; // a definição "function rpc(nome, p)"
    if (!m[2]) { if (/^cli\.rpc\(nome, p\)/.test(CODIGO.slice(m.index - 4, m.index + 20))) genericos++; else errF.push("rpc com nome não escrito: " + CODIGO.slice(m.index, m.index + 40)); continue; }
    const nome = m[2], ini = m.index + m[0].length;
    let obj = null;
    if (CODIGO[ini] === "{") obj = balanceado(CODIGO, ini);
    else {
      const v = /^[A-Za-z_$][\w$]*/.exec(CODIGO.slice(ini));
      if (v) { // a última atribuição "v = {" antes da chamada
        const reV = new RegExp("(?:\\b(?:var|let|const)\\s+|[;{\\s])" + v[0].replace(/\$/g, "\\$") + "\\s*=\\s*\\{", "g"); let a, ult = -1;
        while ((a = reV.exec(CODIGO)) && a.index < m.index) ult = a.index + a[0].length - 1;
        if (ult >= 0) obj = balanceado(CODIGO, ult);
      }
      if (!obj) { errF.push(nome + ": parâmetros passados numa variável que o teste não achou (" + (v ? v[0] : "?") + ")"); continue; }
    }
    const chaves = ((obj || "").match(/\b(p_[a-z_]+|p)\s*:/g) || []).map((s) => s.replace(/\s*:$/, ""));
    chamadas.push(nome);
    if (!FUN[nome]) { errF.push(nome + " não existe no SQL"); continue; }
    const sig = FUN[nome].map((p) => p.nome);
    chaves.forEach((k) => { if (sig.indexOf(k) < 0) errF.push(nome + ": parâmetro " + k + " não existe"); });
    FUN[nome].forEach((p) => { if (!p.padrao && chaves.indexOf(p.nome) < 0) errF.push(nome + ": falta o parâmetro obrigatório " + p.nome); });
  }
  const usadas = [...new Set(chamadas)].sort();
  vale("as funções chamadas existem e os parâmetros batem com a assinatura (" + usadas.length + " funções)", !errF.length && usadas.length >= 12, errF.join(" | ") || usadas.join(","));
  vale("um só rpc genérico (o do painel.js, que traduz o erro)", genericos === 1, genericos);
  const esperadas = ["encarte_criar_edicao", "encarte_adicionar_vaga", "encarte_retirar_vaga", "encarte_registrar_proposta", "encarte_editar_proposta",
    "encarte_descartar_proposta", "encarte_escolher_proposta", "encarte_aprovar", "encarte_criar_grupo_tematico", "encarte_decidir_coincidencia",
    "encarte_marcar_sem_penalidade", "encarte_salvar_modelo", "encarte_buscar_produtos"];
  vale("a tela usa todas as funções da seção 7 que são dela", esperadas.every((f) => usadas.indexOf(f) >= 0), esperadas.filter((f) => usadas.indexOf(f) < 0).join(","));
  vale("a aprovação manda p_versao_vista e reconhece versao_mudou", /p_versao_vista:\s*versaoVista/.test(CODIGO) && /versao_mudou/.test(CODIGO) && /detail = 'versao_mudou'/.test(SQL));
  // campos que a proposta manda = os permitidos pela função (nome digitado errado seria recusado)
  const perm = (/encarte__so_campos\(p, array\[([^\]]+)\]\);\s*v := public\.encarte__vaga_ativa/.exec(SQL) || [])[1];
  const permitidos = perm ? perm.match(/'([a-z_]+)'/g).map((s) => s.slice(1, -1)) : [];
  const campos = ((/var CAMPOS_P = \[([^\]]+)\]/.exec(TELA) || [])[1] || "").match(/"([a-z_]+)"/g) || [];
  const fora = campos.map((s) => s.slice(1, -1)).filter((c) => permitidos.indexOf(c) < 0);
  vale("os campos da proposta são os que o banco aceita", permitidos.length > 0 && campos.length > 0 && !fora.length, fora.join(","));
}

// ---------------------------------------------------------------- 4) textos obrigatórios
console.log("-- textos obrigatórios (o que o dono vê)");
const TEXTOS = ["Planejamento de Encartes", "Aprovação do Encarte", "Entrou no ar sem aprovação", "Dados do VR atualizados às", "Sem custo no VR",
  "Custo não confiável", "Em ajuste", "Aguardando visto", "por unidade de venda, com impostos",
  "O encarte mudou enquanto a tela estava aberta; confira a versão atual antes de aprovar", "+ Vaga só nesta edição", "+ Ação temática",
  "Aprovado × atual", "Escolher esta", "Não há nota automática", "Margem com verba", "Variação na negociação", "Custo hoje (VR)", "Custo negociado",
  "Anterior ao processo", "Salvar nova versão", "Retirar esta vaga", "Devolver para ajuste"];
TEXTOS.forEach((t) => vale("“" + t + "”", JS.indexOf(t) >= 0));
vale("devolução com as 6 categorias (preço, produto, margem/verba, estoque, fornecedor, outro)",
  /\["preco", "Preço"\], \["produto", "Produto"\], \["margem_verba", "Margem\/verba"\], \["estoque", "Estoque"\], \["fornecedor", "Fornecedor"\], \["outro", "Outro"\]/.test(TELA));
vale("a tela mostra a hora dos dados do VR pelo cálculo (statusDadosVr)", /E\.statusDadosVr\(/.test(TELA) && CALC && /Dados do VR atualizados às/.test(CALC));
vale("a escolha é só por botão (não há escolha automática)", (CODIGO.match(/encarte_escolher_proposta/g) || []).length === 1 && /case "escolher-prop"/.test(TELA));
vale("sem palavra de nota/ranking na tela (“melhor”, “recomendada”, “pontuação”)", !/melhor|recomendad|pontua|ranking|score/i.test(JS.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")));

// ---------------------------------------------------------------- 5) CSS isolado
console.log("-- CSS isolado sob .enc");
function regras(css) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out = [];
  (function parse(s) {
    let i = 0;
    while (i < s.length) {
      const a = s.indexOf("{", i); if (a < 0) break;
      const sel = s.slice(i, a).trim();
      let prof = 1, j = a + 1;
      while (j < s.length && prof > 0) { if (s[j] === "{") prof++; else if (s[j] === "}") prof--; j++; }
      const corpo = s.slice(a + 1, j - 1);
      if (/^@media/.test(sel) || /^@supports/.test(sel)) parse(corpo);
      else out.push({ sel, corpo });
      i = j;
    }
  })(css);
  return out;
}
const R = regras(CSS);
vale("o CSS tem regras", R.length > 50, R.length);
const soltos = [];
R.forEach((r) => {
  if (/^@/.test(r.sel)) { soltos.push(r.sel); return; }
  r.sel.split(",").map((s) => s.trim()).forEach((s) => { if (!/^\.enc(?=$|[\s.:\[>])/.test(s)) soltos.push(s); });
});
vale("TODO seletor começa por .enc (nada vaza para o resto do painel)", !soltos.length, soltos.slice(0, 8).join(" | "));
// ".enc ~ .nav-item" e ".enc + x" começam por .enc mas pegam os IRMÃOS da raiz — fora da tela.
const irmaos = [];
R.forEach((r) => r.sel.split(",").map((s) => s.trim()).forEach((s) => {
  if (/^\.enc(?:\[[^\]]*\]|[.:#][^\s>~+\[]*)*\s*[~+]/.test(s)) irmaos.push(s);
}));
vale("nenhum seletor sai de .enc pelos irmãos (~ ou + logo depois da raiz)", !irmaos.length, irmaos.join(" | "));
vale("nenhum seletor por id (#)", !R.some((r) => /#/.test(r.sel)));
vale("cores escritas por extenso, sem var(--x) (o modo noturno do build lê as cores das regras)", !/var\(--/.test(CSS.replace(/\/\*[\s\S]*?\*\//g, "")));
vale("nenhum @keyframes/@font-face/@import global", !/@keyframes|@font-face|@import/.test(CSS));
vale("tem regras de celular (≤ 760 px, o corte da gaveta do menu)", /@media \(max-width:760px\)/.test(CSS));
vale("\"hidden\" esconde mesmo em peça com display próprio", /\.enc \[hidden\]\{display:none !important;\}/.test(CSS));
vale("janela parada, conteúdo rola por dentro", /\.enc \.enc-jcorpo\{[^}]*overflow-y:auto/.test(CSS) && /\.enc \.enc-janela\{[^}]*max-height/.test(CSS));
// classes que a tela usa existem no CSS (erro de digitação = peça sem estilo)
// (tirando os invólucros de estrutura, que não precisam de estilo, e o nome do grupo de opções)
const classesJs = [...new Set((JS.match(/(?<!data-)\benc-[a-z0-9_-]+/g) || []))];
const semEstilo = classesJs.filter((c) => CSS.indexOf("." + c) < 0 && ["enc-tela", "enc-camada", "enc-coinc"].indexOf(c) < 0);
vale("toda classe .enc-* usada no JS tem estilo no CSS", !semEstilo.length, semEstilo.join(","));

// ---------------------------------------------------------------- 6) nada de dado de negócio no navegador; nada de id genérico
console.log("-- armazenamento local e ids");
const usos = CODIGO.match(/localStorage\.[a-zA-Z]+\([^)]*\)/g) || [];
const chaves = usos.map((u) => (/\(\s*"([^"]+)"/.exec(u) || [])[1]);
vale("localStorage só para preferência de tela (enc_pref_fila) e a página aberta (ui_pagina_atual)", usos.length > 0 && chaves.every((k) => k === "enc_pref_fila" || k === "ui_pagina_atual"), chaves.join(","));
let fora = 0; let k = -1;
while ((k = CODIGO.indexOf("localStorage", k + 1)) >= 0) { if (!/try\s*\{[^{}]*$/.test(CODIGO.slice(Math.max(0, k - 260), k))) fora++; }
vale("todo acesso ao localStorage dentro de try (navegador que bloqueia não derruba a tela)", fora === 0, fora);
vale("sem sessionStorage nem indexedDB", !/sessionStorage|indexedDB/.test(CODIGO));
const ids = (JS.match(/\bid\s*=\s*\\?["']([A-Za-z0-9_-]+)/g) || []);
vale("nenhum id criado pela tela (tudo por classe e data-*, sem colidir com o painel)", !ids.length, ids.join(","));
const porId = (CODIGO.match(/getElementById\(\s*"([^"]+)"\s*\)/g) || []).map((s) => /"([^"]+)"/.exec(s)[1]);
vale("getElementById só da raiz #encRaiz e da seção page-encartes", porId.every((x) => x === "encRaiz" || x === "page-encartes"), porId.join(","));
const DDB = ler("scripts/demoDashboard.ts");
if (DDB) vale("o painel monta a raiz #encRaiz com a classe .enc", /id=\\"encRaiz\\" class=\\"enc\\"/.test(DDB));

// ---------------------------------------------------------------- 7) funções da tela RODANDO (tiradas do próprio arquivo)
console.log("-- número digitado e erro mostrado (as funções rodam aqui)");
{
  // lerNum: o ponto só é milhar quando também há vírgula ("1.200,50"); sem vírgula, é a casa decimal.
  let lerNum = null; try { lerNum = new Function(funcao(TELA, "lerNum") + "; return lerNum;")(); } catch (e) {}
  vale("tela.js tem lerNum e ela roda", typeof lerNum === "function");
  if (lerNum) {
    const casos = [["9.999", 9.999], ["10.199", 10.199], ["9.99", 9.99], ["9,99", 9.99], ["1.200,50", 1200.5], ["12,5", 12.5], ["1.200", 1.2], ["", null], ["  ", null],
      ["abc", NaN], ["1,200.50", NaN], ["1.2.3", NaN], ["12.34,5", NaN], ["-3,5", -3.5]];
    const errado = casos.filter(([t, e]) => { const r = lerNum(t); return !(Number.isNaN(e) ? Number.isNaN(r) : r === e); }).map(([t, e]) => JSON.stringify(t) + "→" + lerNum(t) + " (esperado " + e + ")");
    vale("lerNum: “9.999”=9,999 · “10.199”=10,199 · “1.200,50”=1200,5 · vazio=null · lixo=inválido", !errado.length, errado.join(" | "));
  }
  // erroParaPessoa: o que vem do supabase-js/PostgREST/navegador vira português; o do nosso banco passa.
  let traduz = null;
  try {
    const i0 = PAINEL.indexOf("function faltaTabela("), f = funcao(PAINEL, "erroParaPessoa");
    traduz = new Function(PAINEL.slice(i0, PAINEL.indexOf("function erroParaPessoa(")) + f + "; return erroParaPessoa;")();
  } catch (e) {}
  vale("painel.js tem erroParaPessoa e ela roda", typeof traduz === "function");
  if (traduz) {
    const REDE = "Sem conexão com a nuvem agora. Tente de novo.", SES = "Sua sessão expirou. Entre de novo no painel.",
      PERM = "Você não tem permissão para esta ação.", FORM = "Algum campo está com formato inválido.";
    const casos = [
      [{ message: "TypeError: Failed to fetch", details: "TypeError: Failed to fetch\n    at x (supabase.js:1:1)", hint: "", code: "" }, REDE],
      [new TypeError("Failed to fetch"), REDE], [{ message: "TypeError: Load failed", details: "", code: "" }, REDE],
      [{ message: "NetworkError when attempting to fetch resource." }, REDE],
      [{ message: "JWT expired", code: "PGRST301", details: null }, SES], [{ message: "JWT expired", code: "PGRST303", details: "The JWT is expired." }, SES],
      [{ message: "permission denied for function encarte_aprovar", code: "42501", details: null }, PERM],
      [{ message: 'new row violates row-level security policy for table "encarte_vagas"', code: "42501", details: null }, PERM],
      [{ message: 'invalid input syntax for type uuid: ""', code: "22P02", details: null }, FORM],
      [{ message: "Só o master pode fazer isso.", code: "42501", details: "sem_permissao" }, "Só o master pode fazer isso."],
      [{ message: "O encarte mudou depois que você abriu a tela (você viu a versão 3, agora é a 4).", code: "40001", details: "versao_mudou" }, "O encarte mudou depois que você abriu a tela (você viu a versão 3, agora é a 4)."],
      [{ message: "Could not find the function public.encarte_aprovar(...) in the schema cache", code: "PGRST202" }, "O banco ainda não está pronto: falta rodar o arquivo encartes_v1.sql no Supabase."],
      [new TypeError("Cannot read properties of undefined (reading 'id')"), "Não deu para completar agora. Tente de novo."], [null, "Não deu para completar agora. Tente de novo."]];
    const errado = casos.filter(([e, esp]) => traduz(e) !== esp).map(([e, esp]) => JSON.stringify(e && e.message) + " → " + JSON.stringify(traduz(e)) + " (esperado " + JSON.stringify(esp) + ")");
    vale("erroParaPessoa: rede, sessão vencida, permissão e formato em português; texto do nosso banco (DETAIL) passa como veio", !errado.length, errado.join(" | "));
    const ingles = casos.filter(([e]) => !(e && /^[a-z_]+$/.test(e.details || ""))).map(([e]) => traduz(e)).filter((t) => /failed|fetch|jwt|permission|denied|invalid|syntax|error|could not|cannot|undefined/i.test(t));
    vale("nenhuma frase traduzida sai com palavra em inglês", !ingles.length, ingles.join(" | "));
  }
  // o texto cru não tem outro caminho até a tela: .message só dentro da tradução (e do faltaTabela)
  const msgTela = (semComentarios(TELA).match(/\.message\b/g) || []).length;
  const pSem = semComentarios(PAINEL), iniT = pSem.indexOf("function faltaTabela("), fimT = pSem.indexOf("function erroParaPessoa(") + (funcao(pSem, "erroParaPessoa") || "").length;
  const msgPainel = ((pSem.slice(0, iniT) + pSem.slice(fimT)).match(/\.message\b/g) || []).length;
  vale("nenhum “.message” cru a caminho da tela (tela.js: 0; painel.js: só na tradução)", msgTela === 0 && msgPainel === 0 && iniT >= 0, { tela: msgTela, painel: msgPainel });
  vale("o rpc do painel devolve o erro já traduzido", /erro: erroParaPessoa\(r\.error\)/.test(PAINEL) && /function \(e\) \{ return \{ ok: false, erro: erroParaPessoa\(e\)/.test(PAINEL));
}
// Contratos desta rodada que a tela precisa MANDAR para o cálculo (a prova de que funcionam roda no fotos.cjs)
vale("K3 · coincidências recebem comEdicao (campanhas com modelo de edição ativo)", /E\.coincidencias\(oc, \{ regras: D\(\)\.regras, comEdicao: comEdicao \}\)/.test(TELA));
vale("K7 · situação recebe pendentesNoAr (tela e resumo do Calendário)", /c\.pendentesNoAr = pendentesNoAr\(/.test(TELA) && /cTot\.pendentesNoAr = /.test(TELA) && /cont\.pendentesNoAr = /.test(PAINEL));
vale("K8 · produto repetido recebe campanha_id de cada item", /campanha_id: d\.edicao\.campanha_id/.test(TELA));
vale("K5 · a tela mostra variacaoIndisponivel (sem cor) quando o custo do VR não é confiável", /a\.variacaoIndisponivel/.test(TELA));

// ---------------------------------------------------------------- 8) a trava 3 do build (função da casa chamada e não definida)
console.log("-- compatível com as travas do build");
const PREFIXOS = /^(?:(rec|ent|cl|ins|mat|cop|rat|px|gl|man|desp|ag|jor|esc|fer|epi|fard|neg|cz|ui|acs|rcb|prd|conf)[A-Z]|man2[A-Za-z])/;
const definidas = new Set();
let mm; const reDef = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g; while ((mm = reDef.exec(CODIGO))) definidas.add(mm[1]);
const reCall = /(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g; const orfas = new Set();
while ((mm = reCall.exec(CODIGO))) { if (PREFIXOS.test(mm[2]) && !definidas.has(mm[2])) orfas.add(mm[2]); }
vale("nenhuma função com prefixo da casa chamada sem estar definida (trava 3)", !orfas.size, [...orfas].join(","));

console.log("\n" + ok + " ok, " + falhou + " falha(s).");
process.exit(falhou ? 1 : 0);
