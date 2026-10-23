// ==GLEMAIL== copia o desenho da ficha do boleto do Painel para a função de e-mail da nuvem (21/10/2026).
//
// A ficha que vai anexada no e-mail do galpão é desenhada pelo MESMO código do Painel (pixBaixarFicha e
// as ajudantes), copiado sem mudar nada do Painel montado (output/index.html) para
// supabase/functions/aviso-boleto-galpao/ficha-painel.mjs. Lá ele roda com um canvas de mentira que escreve
// PDF (pdf-canvas.mjs).
//
//   node scripts/gerar-ficha-email.cjs              -> regrava a cópia (depois: publicar a função de novo)
//   node scripts/gerar-ficha-email.cjs --conferir   -> só diz se a cópia está igual ao Painel (sai 1 se não)
//
// Mudou a ficha no Painel? Monte o Painel (npm run painel), rode este script e publique a função de novo;
// senão o e-mail continua mandando a ficha antiga. A prova (scripts/testes/email-boleto-galpao.test.mts)
// avisa quando estão diferentes.
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..");
const HTML = path.join(RAIZ, "output", "index.html");
const DESTINO = path.join(RAIZ, "supabase", "functions", "aviso-boleto-galpao", "ficha-painel.mjs");
const FUNCOES = ["pixRR", "pixLinhaParaBarras", "pixBarrasITF", "pixFmtDoc", "pixBaixarFicha"];

// acha cada função pelo analisador do TypeScript (o mesmo que lê o código de verdade): texto entre aspas,
// expressão regular com aspas ou chaves dentro, comentário — nada disso engana. Cada nome tem de aparecer
// UMA vez, no nível de cima do script do Painel.
const ts = require("typescript");
function pegaFuncoes(s, nomes) {
  const ini = s.lastIndexOf("<script>", s.indexOf("\nfunction pixBaixarFicha("));
  const fim = s.indexOf("</script>", ini);
  if (ini < 0 || fim < 0) throw new Error("script do Painel não achado no Painel montado");
  const codigo = s.slice(ini + "<script>".length, fim);
  const arq = ts.createSourceFile("painel.js", codigo, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const achadas = {};
  for (const n of arq.statements) {
    if (ts.isFunctionDeclaration(n) && n.name && nomes.includes(n.name.text)) {
      if (achadas[n.name.text]) throw new Error("função " + n.name.text + " aparece 2 vezes no Painel montado");
      achadas[n.name.text] = n.getText(arq);
    }
  }
  for (const nm of nomes) if (!achadas[nm]) throw new Error("função " + nm + " não achada no Painel montado");
  return nomes.map((nm) => achadas[nm]);
}

// confere o módulo gerado ANTES de gravar: tem de ser JavaScript válido, com exatamente as funções pedidas
function conferirModulo(texto) {
  const arq = ts.createSourceFile("ficha-painel.mjs", texto, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const erros = arq.parseDiagnostics || [];
  if (erros.length) throw new Error("módulo gerado com erro de escrita: " + ts.flattenDiagnosticMessageText(erros[0].messageText, " "));
  const criar = arq.statements.find((n) => ts.isFunctionDeclaration(n) && n.name && n.name.text === "criarFicha");
  const dentro = criar && criar.body ? criar.body.statements.filter((n) => ts.isFunctionDeclaration(n)).map((n) => n.name.text) : [];
  if (dentro.join(",") !== FUNCOES.join(",")) throw new Error("módulo gerado com funções a mais ou a menos: " + dentro.join(", "));
}

function montar() {
  const s = fs.readFileSync(HTML, "utf8");
  const brl = /\nconst brl = [^\n]*\n/.exec(s);
  if (!brl) throw new Error("brl não achado no Painel montado");
  const loc = /var GL_LOCADOR=\{\s*nome:"([^"]+)",[\s\S]*?cpf:"([^"]+)"/.exec(s);
  if (!loc) throw new Error("GL_LOCADOR não achado no Painel montado");
  return [
    "// GERADO por scripts/gerar-ficha-email.cjs a partir do Painel montado (output/index.html). NÃO EDITAR À MÃO:",
    "// mude a ficha no Painel (scripts/demoDashboard.ts), monte, rode o script e publique a função de novo.",
    "// É o desenho da ficha do boleto (==FICHAA4== / ==FICHASOBRIA== / ==GLENCARGOS==) sem mudar uma letra; quem",
    "// chama (index.ts) entrega o canvas de mentira que escreve PDF, o relógio de Caicó e a imagem do QR.",
    "export function criarFicha(amb) {",
    "  const { document, Image, Date, pixGetCfg, pixImprimirFicha } = amb;",
    "  const GL_LOCADOR = { nome: " + JSON.stringify(loc[1]) + ", cpf: " + JSON.stringify(loc[2]) + " };",
    "  const LOGO_URI = \"\";",
    "  let pixFichaCanvas = null;",
    "  // ---- daqui para baixo: cópia fiel do Painel",
    brl[0].trim(),
    ...pegaFuncoes(s, FUNCOES),
    "  // ---- fim da cópia",
    "  return pixBaixarFicha;",
    "}",
    "",
  ].join("\n");
}

const novo = montar();
conferirModulo(novo);
if (process.argv.includes("--conferir")) {
  const atual = fs.existsSync(DESTINO) ? fs.readFileSync(DESTINO, "utf8") : "";
  if (atual === novo) { console.log("ficha do e-mail: igual à do Painel"); process.exit(0); }
  console.log("ficha do e-mail: DIFERENTE da do Painel — rode node scripts/gerar-ficha-email.cjs e publique a função de novo");
  process.exit(1);
}
fs.writeFileSync(DESTINO, novo);
console.log("gravado " + path.relative(RAIZ, DESTINO) + " (" + novo.length + " letras)");
