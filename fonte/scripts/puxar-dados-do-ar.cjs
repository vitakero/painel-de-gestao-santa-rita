// PUXA OS NÚMEROS DO VR DE VOLTA, DO PRÓPRIO SITE PUBLICADO.
//
// O PROBLEMA QUE ISTO RESOLVE
//   O painel é UM arquivo só: o código da tela e o retrato do VR (vendas, estoque) viajam
//   juntos. O retrato só é gerado DENTRO da loja, onde o robô alcança o banco do VR. Então
//   publicar do Mac levava junto o retrato daqui — de 12/07 — e rolava Vendas/Estoque/Análise
//   um mês para trás, mesmo numa mudança que não tinha nada a ver com o VR.
//   A saída era soltar o robô só para ele republicar: 5 minutos de espera e publicações do
//   Vercel gastas à toa.
//
//   Mas o retrato está gravado DENTRO do arquivo que já está no ar. Dá para trazer de volta.
//   Este script baixa o site oficial, recupera as seis tabelas e regrava output/vr-data.json.
//   Depois disto, publicar do Mac leva os números do dia — com o robô pausado.
//
// USO:  node scripts/puxar-dados-do-ar.cjs
//       (e então: SUBIR=1 FORCAR=1 node scripts/publicar.cjs)
//
// SEGURANÇA: só regrava se as SEIS tabelas vierem inteiras e o retrato do ar for MAIS NOVO
// que o daqui. Qualquer dúvida, não mexe no arquivo — dado velho no ar é pior que atraso.
const fs = require("fs");
const path = require("path");

const SITE = process.env.SITE || "https://painel-de-gestao-santa-rita.vercel.app/";
const ALVO = path.join(__dirname, "..", "output", "vr-data.json");

// nome da tabela no vr-data.json  ->  nome com que ela é gravada no HTML publicado
const MAPA = { DIA: "DIA", HORA: "HORA", OP: "OPER", PAG: "PAGS", SETOR: "SETORES", MESPROD: "MESPROD" };

// Recorta o array equilibrando os colchetes. Regex não serve: os dados têm [ ] dentro.
function recorta(html, nome) {
  const m = new RegExp("\\b" + nome + "\\s*=\\s*\\[").exec(html);
  if (!m) return null;
  const ini = m.index + m[0].length - 1;
  let prof = 0;
  for (let j = ini; j < html.length; j++) {
    const c = html[j];
    if (c === "[") prof++;
    else if (c === "]") { prof--; if (prof === 0) return html.slice(ini, j + 1); }
  }
  return null;
}

const maisRecente = (linhas) => {
  let max = "";
  for (const l of linhas) { const d = (l && (l.d || l.m)) || ""; if (d > max) max = d; }
  return max;
};

(async () => {
  console.log("Baixando " + SITE + " ...");
  const r = await fetch(SITE);
  if (!r.ok) { console.log("ERRO: o site respondeu " + r.status + ". Nada foi alterado."); process.exit(1); }
  const html = await r.text();
  console.log("  " + (html.length / 1048576).toFixed(1) + " MB baixados.");

  const novo = {};
  for (const [chave, nomeNoHtml] of Object.entries(MAPA)) {
    const bruto = recorta(html, nomeNoHtml);
    if (!bruto) { console.log("ERRO: não achei a tabela " + chave + " (" + nomeNoHtml + ") no site. Nada foi alterado."); process.exit(1); }
    try { novo[chave] = JSON.parse(bruto); }
    catch (e) { console.log("ERRO: a tabela " + chave + " não virou JSON (" + e.message + "). Nada foi alterado."); process.exit(1); }
    if (!Array.isArray(novo[chave]) || !novo[chave].length) { console.log("ERRO: a tabela " + chave + " veio vazia. Nada foi alterado."); process.exit(1); }
  }

  let antigo = null;
  try { antigo = JSON.parse(fs.readFileSync(ALVO, "utf8")); } catch (e) {}

  const dNovo = maisRecente(novo.DIA);
  const dAntigo = antigo && antigo.DIA ? maisRecente(antigo.DIA) : "";
  console.log("");
  console.log("  aqui no Mac : " + (dAntigo || "(sem retrato)"));
  console.log("  no site     : " + dNovo);
  for (const k of Object.keys(MAPA)) {
    const a = antigo && antigo[k] ? antigo[k].length : 0;
    console.log("    " + k.padEnd(8) + String(a).padStart(7) + "  ->  " + String(novo[k].length).padStart(7) + " linhas");
  }

  if (dAntigo && dNovo < dAntigo) {
    console.log("\n>>> O retrato do site é MAIS VELHO que o daqui. Não vou trocar (seria andar pra trás).");
    process.exit(0);
  }
  if (dAntigo && dNovo === dAntigo) {
    console.log("\n>>> Mesma data. Troco assim mesmo (o dia pode ter avançado desde a última publicação).");
  }

  if (antigo) fs.writeFileSync(ALVO + ".bak", JSON.stringify(antigo));
  fs.writeFileSync(ALVO, JSON.stringify(novo));
  console.log("\n>>> output/vr-data.json atualizado com o retrato de " + dNovo + ".");
  console.log("    (a versão anterior ficou em output/vr-data.json.bak)");
  console.log("    Agora: npx tsx scripts/demoDashboard.ts  e depois  SUBIR=1 FORCAR=1 node scripts/publicar.cjs");
})().catch((e) => { console.log("ERRO: " + e.message + ". Nada foi alterado."); process.exit(1); });
