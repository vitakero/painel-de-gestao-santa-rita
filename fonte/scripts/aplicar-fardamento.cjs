// Põe o módulo Fardamento dentro do painel (output/index.html).
//
// POR QUE ISTO EXISTE: em 04/09/2026 o robô republicou o painel com a cópia de
// código DELE e apagou o módulo do arquivo. O trabalho não se perdeu porque as
// peças ficam guardadas em rascunhos/fardamento/ — este script costura de volta
// em um comando. Rodar de novo é seguro: se o módulo já estiver lá, ele troca.
//
//   node scripts/aplicar-fardamento.cjs
//   node scripts/aplicar-fardamento.cjs --conferir    (só diz se está aplicado)
const fs = require("fs");
const path = require("path");
const RAIZ = path.join(__dirname, "..");
const ALVO = path.join(RAIZ, "output", "index.html");

const MARCA_JS_INI = "/* ===== Controle de Fardamento =====";
const MARCA_JS_FIM = "/* ===== Layout da loja (planta + planograma) ===== */";
const MARCA_SEC_INI = '    <section id="page-fardamento" class="page">';
const MARCA_SEC_FIM = '    <section id="page-cargos" class="page">';
const MARCA_CSS = "  .card { background:#fff; border-radius:12px; padding:18px 20px; box-shadow:0 1px 4px rgba(0,0,0,.07); }";
const ANCORA_SYNC = '    {chave:"epi_entregas",        tabela:"epi_entregas",         modo:"array"},\n';
const LINHAS_SYNC_VELHAS = [
  '    {chave:"fard_catalogo",       tabela:"fardamento_catalogo",  modo:"array"},\n',
  '    {chave:"fard_entregas",       tabela:"fardamento_entregas",  modo:"array"},\n'
];
const NOTA_SYNC =
  '    /* FARDAMENTO SAIU DAQUI. O módulo novo não guarda nada no navegador: grava\n' +
  '       direto no Supabase por RPC, com auditoria por gatilho. A sincronização\n' +
  '       genérica REESCREVE a lista inteira a cada mudança — serve pra configuração,\n' +
  '       nunca pra um livro de movimentação. */\n';

const ler = (p) => fs.readFileSync(path.join(RAIZ, p), "utf8");

function aplicado(html){ return html.indexOf("==FARDCALC-INICIO==") >= 0; }

function aplicar(){
  let s = fs.readFileSync(ALVO, "utf8");
  const antes = s.length;
  const jaEstava = aplicado(s);

  const modulo  = ler("rascunhos/fardamento/modulo.js");
  const pagina  = ler("rascunhos/fardamento/pagina.html").replace(/\s+$/, "") + "\n";
  const janelas = ler("rascunhos/fardamento/janelas.css");

  // ---- 1) o código do módulo ----
  const a = s.indexOf(MARCA_JS_INI), b = s.indexOf(MARCA_JS_FIM);
  if (a < 0 || b < 0 || a > b) { console.log("ERRO: não achei onde entra o código do fardamento."); process.exit(1); }
  s = s.slice(0, a) + modulo + "\n" + s.slice(b);

  // ---- 2) a página ----
  const c = s.indexOf(MARCA_SEC_INI), d = s.indexOf(MARCA_SEC_FIM);
  if (c < 0 || d < 0 || c > d) { console.log("ERRO: não achei onde entra a página do fardamento."); process.exit(1); }
  s = s.slice(0, c) + pagina + "\n" + s.slice(d);

  // ---- 3) o estilo das janelas (só se ainda não estiver lá) ----
  if (s.indexOf("Fardamento: janelas do módulo") < 0) {
    if (s.indexOf(MARCA_CSS) < 0) { console.log("ERRO: não achei onde entra o estilo."); process.exit(1); }
    s = s.replace(MARCA_CSS, janelas + MARCA_CSS);
  }

  // ---- 4) tirar a sincronização antiga (guardava fardamento no navegador) ----
  let tirou = 0;
  LINHAS_SYNC_VELHAS.forEach(function(l){ if (s.indexOf(l) >= 0) { s = s.replace(l, ""); tirou++; } });
  if (s.indexOf("FARDAMENTO SAIU DAQUI") < 0 && s.indexOf(ANCORA_SYNC) >= 0) {
    s = s.replace(ANCORA_SYNC, ANCORA_SYNC + NOTA_SYNC);
  }

  fs.writeFileSync(ALVO, s, "utf8");
  console.log((jaEstava ? "módulo TROCADO" : "módulo APLICADO") + " no painel.");
  console.log("  linhas de sincronização antiga removidas: " + tirou);
  console.log("  index.html: " + antes + " -> " + s.length + " caracteres");

  // ---- confere que não quebrou nada ----
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m, erros = 0, n = 0;
  while ((m = re.exec(s))) { n++; try { new Function(m[1]); } catch (e) { erros++; console.log("  ERRO DE SINTAXE: " + e.message); } }
  console.log("  " + n + " blocos de código conferidos, " + erros + " com erro.");
  if (erros) process.exit(1);
}

if (process.argv.indexOf("--conferir") >= 0) {
  const s = fs.readFileSync(ALVO, "utf8");
  console.log(aplicado(s) ? "APLICADO: o módulo de fardamento está no painel."
                          : "FORA: o painel está sem o módulo (o robô provavelmente republicou).");
  process.exit(aplicado(s) ? 0 : 1);
}
aplicar();
