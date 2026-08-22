// Teste das CAMADAS do portal (quem fica por cima de quem).
//
// Defeito real, 21/08/2026: ao abrir o sino de Avisos, a gaveta aparecia ESCURECIDA —
// o véu que deveria escurecer só o fundo passava por cima dela e apagava justamente o
// que a pessoa acabou de abrir para ler.
//
// A causa era ordem de camadas: a gaveta na 80 e o véu das janelas (.mfundo) na 85.
// A gaveta reusava esse véu, e ele nasce acima dela de propósito — porque quando uma
// JANELA abre por cima da gaveta, o véu tem mesmo que cobrir a gaveta.
//
// O conserto foi dar à gaveta um véu PRÓPRIO, na 79. Subir a gaveta acima de 85 teria
// quebrado o outro caso: janela aberta sobre a gaveta deixaria a gaveta acesa por trás.
//
//   node scripts/testes/portal-camadas.test.cjs
const fs = require("fs");
const path = require("path");

const HTML = fs.readFileSync(path.join(__dirname, "..", "..", "output", "agendar.html"), "utf8");

let ok = 0, falhou = 0;
function t(nome, cond, extra) {
  if (cond) { ok++; return; }
  falhou++; console.log("  FALHOU: " + nome + (extra ? " -> " + extra : ""));
}

// lê a camada de uma classe direto do CSS publicado
function camada(sel) {
  const i = HTML.indexOf(sel + "{");
  if (i < 0) return null;
  const bloco = HTML.slice(i, HTML.indexOf("}", i));
  const m = bloco.match(/z-index:\s*(\d+)/);
  return m ? +m[1] : null;
}

const veuGaveta = camada(".gav-fundo");
const gaveta    = camada(".gaveta");
const veuJanela = camada(".mfundo");

t("a gaveta tem véu próprio", veuGaveta !== null, "sem ele a gaveta reusa o véu das janelas");
t("a gaveta existe", gaveta !== null);
t("o véu das janelas existe", veuJanela !== null);

// O QUE IMPORTA: o véu da gaveta fica ATRÁS dela.
t("o véu da gaveta fica atrás da gaveta", veuGaveta < gaveta,
  "véu " + veuGaveta + " x gaveta " + gaveta + " — a gaveta apareceria escurecida");

// E o véu das JANELAS continua na frente da gaveta: janela aberta sobre a gaveta
// precisa mesmo escurecer a gaveta.
t("o véu das janelas continua na frente da gaveta", veuJanela > gaveta,
  "senão a gaveta fica acesa por trás de uma janela");

// A gaveta é branca — é o ponto de ler.
t("a gaveta é clara", HTML.indexOf(".gaveta{position:fixed;top:0;right:0;bottom:0;width:min(376px,94vw);background:#fff") > 0);

// E o sino usa o véu novo, não o antigo.
t("o sino abre com o véu próprio", HTML.indexOf('f.className="gav-fundo"') > 0);
t("o sino não usa mais o véu das janelas",
  HTML.indexOf('f.className="mfundo"; f.style.background="rgba(9,32,19,.35)"') < 0);

console.log(falhou ? ("FALHOU: " + falhou + " de " + (ok + falhou)) : ("TUDO OK: " + ok + " testes"));
process.exit(falhou ? 1 : 0);
