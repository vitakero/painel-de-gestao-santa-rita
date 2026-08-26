// VIGIA DO SUPABASE — mede o que dá pra medir e compara com a última vez.
//
// O QUE ELE VÊ: quantas linhas e quanto peso cada tabela tem, e quanto isso cresceu
// desde a medição anterior. Guarda o histórico em output/vigia-supabase.json.
//
// O QUE ELE NÃO VÊ: o EGRESS (tráfego do mês). Esse número só existe no painel do
// Supabase e exige uma chave de administração, que este projeto não tem. Quando o
// vigia achar que vale olhar, ele avisa pra pedir o print.
//
//   node scripts/vigia-supabase.cjs
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..");
const env = fs.readFileSync(path.join(RAIZ, ".env"), "utf8");
const g = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim().replace(/[^\x21-\x7e]/g, "") : ""; };
const BASE = g("SUPABASE_URL").replace(/\/+$/, ""), KEY = g("SUPABASE_SERVICE_KEY");
const HIST = path.join(RAIZ, "output", "vigia-supabase.json");

// Limite do plano free. Se um dia mudar de plano, mexer aqui.
const LIMITE_MB = 500;
const AVISA_EM = 350;   // 70% — a partir daqui vale conversar
const GRITA_EM = 425;   // 85% — a partir daqui vale agir

const TABELAS = ["compra_entradas","estoque_produtos","vendasetor_mes","vendasetor_apelido",
  "central_agendamentos","pedidos","perdas","entregas_registros","receitas","manutencoes",
  "pontos_extras","escala","banco_horas","perfis","flv_fechamentos","pix_cobrancas"];

const H = { apikey: KEY, Authorization: "Bearer " + KEY };

async function mede(t) {
  const r = await fetch(BASE + "/rest/v1/" + t + "?select=*", { headers: { ...H, Prefer: "count=exact", Range: "0-0" } });
  if (!r.ok) return null;
  const linhas = Number((r.headers.get("content-range") || "/0").split("/")[1] || 0);
  if (!linhas) return { linhas: 0, mb: 0 };
  // amostra pra estimar o peso por linha (ler tudo seria caro e é justamente o que queremos evitar)
  const a = await (await fetch(BASE + "/rest/v1/" + t + "?select=*&limit=200", { headers: H })).text();
  let n = 0; try { n = JSON.parse(a).length; } catch (e) {}
  const porLinha = n ? a.length / n : 0;
  return { linhas, mb: Math.round(linhas * porLinha / 1048576 * 100) / 100 };
}

(async () => {
  if (!BASE || !KEY) { console.log("ERRO: SUPABASE_URL ou SUPABASE_SERVICE_KEY faltando no .env"); process.exit(1); }
  const agora = { quando: new Date().toISOString(), tabelas: {} };
  let totalMb = 0;
  for (const t of TABELAS) {
    const m = await mede(t);
    if (!m) continue;
    agora.tabelas[t] = m; totalMb += m.mb;
  }
  agora.totalMb = Math.round(totalMb * 100) / 100;

  let hist = []; try { hist = JSON.parse(fs.readFileSync(HIST, "utf8")); } catch (e) {}
  const antes = hist.length ? hist[hist.length - 1] : null;

  console.log("VIGIA DO SUPABASE — " + new Date().toLocaleString("pt-BR"));
  console.log("\n  dados nas tabelas: " + agora.totalMb.toFixed(1) + " MB");
  console.log("  (o painel do Supabase mostra mais que isso: soma os índices, que costumam");
  console.log("   dobrar o número. Use a proporção, não o valor absoluto.)");

  if (antes) {
    const dias = Math.max(1, Math.round((new Date(agora.quando) - new Date(antes.quando)) / 86400000));
    const cresceu = agora.totalMb - antes.totalMb;
    const porMes = cresceu / dias * 30;
    console.log("\n  desde a última medição (" + dias + " dia(s)): " + (cresceu >= 0 ? "+" : "") + cresceu.toFixed(2) + " MB");
    console.log("  nesse passo daria " + (porMes >= 0 ? "+" : "") + porMes.toFixed(1) + " MB por mês");
    // o que cresceu mais
    const deltas = Object.keys(agora.tabelas)
      .map((t) => ({ t, d: agora.tabelas[t].mb - ((antes.tabelas[t] || {}).mb || 0),
                     l: agora.tabelas[t].linhas - ((antes.tabelas[t] || {}).linhas || 0) }))
      .filter((x) => Math.abs(x.d) > 0.05 || Math.abs(x.l) > 100)
      .sort((a, b) => b.d - a.d);
    if (deltas.length) {
      console.log("\n  quem mexeu:");
      deltas.slice(0, 6).forEach((x) =>
        console.log("    " + x.t.padEnd(22) + (x.l >= 0 ? "+" : "") + x.l + " linhas   " + (x.d >= 0 ? "+" : "") + x.d.toFixed(2) + " MB"));
    }
    if (porMes > 40) console.log("\n  >>> CRESCENDO RÁPIDO (mais de 40 MB/mês). Vale entender o que está entrando.");
  } else {
    console.log("\n  primeira medição — a partir da próxima dá pra comparar.");
  }

  console.log("\n  VEREDITO:");
  if (agora.totalMb >= GRITA_EM) console.log("    APERTADO. Falar com o Victor sobre limpar ou subir de plano.");
  else if (agora.totalMb >= AVISA_EM) console.log("    Passou de " + AVISA_EM + " MB. Ainda cabe, mas vale planejar.");
  else console.log("    Tranquilo. Longe do limite de " + LIMITE_MB + " MB.");

  console.log("\n  O EGRESS (tráfego do mês) eu não consigo ler — só aparece no painel do");
  console.log("  Supabase. Peça o print pro Victor se quiser conferir esse.");

  hist.push(agora);
  if (hist.length > 60) hist = hist.slice(-60);   // guarda ~1 ano de medições semanais
  try { fs.mkdirSync(path.dirname(HIST), { recursive: true }); fs.writeFileSync(HIST, JSON.stringify(hist, null, 1)); } catch (e) {}
})().catch((e) => { console.log("ERRO: " + e.message); process.exit(1); });
