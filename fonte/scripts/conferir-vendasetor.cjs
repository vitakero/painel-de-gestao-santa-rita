// CONFERE se o robô está batendo com o relatório do VR.
//
// POR QUE ISTO EXISTE
//   A carga inicial (sql/vendasetor_carga.sql) veio dos PDFs do relatório "Estatísticas",
//   conferidos um a um. O robô calcula por conta própria, somando pdv.vendaitem.quantidade
//   com cancelado=false. As duas contas PRECISAM dar o mesmo número — mas não há nenhuma
//   garantia disso: o relatório do VR pode descontar devolução, ou usar outra régua.
//   Enquanto não bater, não dá pra confiar no automático.
//
//   Este script põe as duas lado a lado. Ele NÃO escreve nada.
//
//   node scripts/conferir-vendasetor.cjs
//   node scripts/conferir-vendasetor.cjs 2025      (só um ano)
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..");
const env = fs.readFileSync(path.join(RAIZ, ".env"), "utf8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim() : ""; };
// limpa qualquer byte estranho: um espaço invisível aqui vira "Failed to parse URL"
const BASE = get("SUPABASE_URL").replace(/[^\x21-\x7e]/g, "").replace(/\/+$/, "");
const KEY = get("SUPABASE_SERVICE_KEY").replace(/[^\x21-\x7e]/g, "");
const SO_ANO = process.argv[2] ? Number(process.argv[2]) : null;
const TOLERANCIA = 0.5;   // % — abaixo disso é arredondamento, não divergência

if (!BASE || !KEY) { console.log("ERRO: SUPABASE_URL ou SUPABASE_SERVICE_KEY faltando no .env"); process.exit(1); }

// ---- o esperado: as linhas dos PDFs, lidas da própria carga ----
const sql = fs.readFileSync(path.join(RAIZ, "sql", "vendasetor_carga.sql"), "utf8");
const esperado = new Map();
// A carga tem SEIS valores por linha: ano, mes, setor, quantidade, completo, origem.
// Já mordeu uma vez: a expressão parou no quinto, não casou com nada, e a conferência
// passou a comparar contra uma base VAZIA — dizendo "bateu em tudo" sem comparar nada.
for (const m of sql.matchAll(/\((\d+),(\d+),'((?:[^']|'')*)',([\d.]+),(true|false),'\w+'\)/g)) {
  if (m[5] !== "true") continue;                     // mês incompleto não se compara
  esperado.set(m[1] + "|" + m[2] + "|" + m[3].replace(/''/g, "'"), Number(m[4]));
}

(async () => {
  const r = await fetch(BASE + "/rest/v1/vendasetor_mes?select=ano,mes,setor,quantidade,completo,origem&limit=100000",
    { headers: { apikey: KEY, Authorization: "Bearer " + KEY } });
  if (!r.ok) {
    console.log("Não deu pra ler a tabela: HTTP " + r.status);
    if (r.status === 404) console.log("A tabela vendasetor_mes ainda não existe. Rode sql/vendasetor.sql no Supabase primeiro.");
    process.exit(1);
  }
  const linhas = await r.json();
  const doRobo = linhas.filter((l) => l.origem === "robo" && l.completo);
  const doPdf  = linhas.filter((l) => l.origem === "pdf");

  console.log("Base conferida lida: " + esperado.size + " linhas (se der 0, a leitura da carga quebrou)");
  console.log("Na tabela: " + linhas.length + " linhas  (" + doPdf.length + " da carga, " + doRobo.length + " do robô)\n");
  if (!doRobo.length) {
    console.log("O robô ainda não gravou nada. Ele só alcança o VR de dentro da rede da loja;");
    console.log("depois que rodar lá, volte aqui e a conferência aparece.");
    return;
  }

  let bate = 0, diverge = 0, semBase = 0;
  const ruins = [];
  for (const l of doRobo) {
    if (SO_ANO && +l.ano !== SO_ANO) continue;
    const k = l.ano + "|" + l.mes + "|" + l.setor;
    if (!esperado.has(k)) { semBase++; continue; }    // mês que os PDFs não cobriam
    const esp = esperado.get(k), obt = Number(l.quantidade);
    const dif = esp > 0 ? Math.abs(obt - esp) / esp * 100 : (obt === 0 ? 0 : 100);
    if (dif <= TOLERANCIA) bate++;
    else { diverge++; ruins.push({ ano: l.ano, mes: l.mes, setor: l.setor, esp, obt, dif }); }
  }

  console.log("CONFERÊNCIA contra o relatório do VR (tolerância " + TOLERANCIA + "%)");
  console.log("  batem:      " + bate);
  console.log("  divergem:   " + diverge);
  console.log("  sem base:   " + semBase + "  (mês que os PDFs não cobriam — normal)\n");

  if (diverge) {
    ruins.sort((a, b) => b.dif - a.dif);
    console.log("As " + Math.min(20, ruins.length) + " maiores diferenças:");
    console.log("  ano/mês  setor                relatório        robô     dif");
    for (const x of ruins.slice(0, 20)) {
      console.log("  " + x.ano + "/" + String(x.mes).padStart(2, "0") + "   " + x.setor.padEnd(18) +
        String(Math.round(x.esp)).padStart(12) + String(Math.round(x.obt)).padStart(12) +
        ("  " + x.dif.toFixed(2) + "%").padStart(9));
    }
    console.log("\n>>> NÃO confie no automático ainda. Enquanto divergir, o número do robô e o do");
    console.log("    relatório do VR são coisas diferentes — e é a diferença que precisa ser entendida.");
    process.exit(1);
  }
  if (!bate) {
    console.log(">>> NADA FOI COMPARADO. Nenhuma linha do robô encontrou par na base conferida —");
    console.log("    ou os nomes de setor estão diferentes, ou a base não foi lida. Isto NÃO é aprovação.");
    process.exit(1);
  }
  console.log(">>> Bateu em " + bate + " linhas. O robô reproduz o relatório do VR; o automático pode assumir.");
})().catch((e) => { console.log("ERRO: " + e.message); process.exit(1); });
