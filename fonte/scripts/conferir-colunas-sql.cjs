// Confere se o SQL do módulo de recebimento cita alguma coluna que não existe.
//
// Por que existe: em 15/08/2026 uma função escreveu ev.criado_em quando a coluna
// se chama "quando". O Postgres aceitou o CREATE sem reclamar — corpo de plpgsql
// só é conferido na hora de rodar — e o defeito ficou dormindo no banco. Ia
// quebrar 100% dos cliques no detalhe da agenda no dia em que o portal subisse.
//
// A chave de serviço não pega isso: as funções saem antes, no "cadastro não
// liberado", porque não há usuário logado. Então o jeito é conferir o TEXTO do
// SQL contra as colunas de verdade do banco.
//
//   node scripts/conferir-colunas-sql.cjs
require("dotenv").config();
const fs = require("fs");
const path = require("path");

const U = process.env.SUPABASE_URL;
const K = process.env.SUPABASE_SERVICE_KEY;
if (!U || !K) { console.log("ERRO: faltou SUPABASE_URL/SUPABASE_SERVICE_KEY no .env"); process.exit(1); }

const PASTA = path.join(__dirname, "..", "sql");

// palavras que aparecem depois de um ponto mas não são coluna
const NAO_E_COLUNA = new Set([
  "*", "id", "count", "sql", "text", "jsonb", "uuid", "date", "int", "numeric",
  "boolean", "timestamptz", "time", "interval", "hora", "dia"
]);

(async () => {
  // 1) as colunas de verdade, direto do banco
  const r = await fetch(U + "/rest/v1/", { headers: { apikey: K, Authorization: "Bearer " + K } });
  const spec = await r.json();
  const defs = spec.definitions || spec.components?.schemas || {};
  const colunas = {};
  for (const [tabela, def] of Object.entries(defs)) {
    if (def && def.properties) colunas[tabela] = new Set(Object.keys(def.properties));
  }
  const nTab = Object.keys(colunas).length;
  if (!nTab) { console.log("ERRO: não consegui ler o desenho do banco."); process.exit(1); }

  // tira comentário: o texto que explica o defeito não é o defeito
  function semComentario(s) {
    return s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
  }

  // Corta em pedaços por comando. Sem isso, o apelido "n" de uma função vale
  // dentro de outra, e a conferência acusa erro onde não tem.
  function pedacos(s) {
    const out = [];
    let ini = 0, dentro = false;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === "$" && s[i + 1] === "$") { dentro = !dentro; i++; continue; }
      if (s[i] === ";" && !dentro) { out.push(s.slice(ini, i)); ini = i + 1; }
    }
    out.push(s.slice(ini));
    return out;
  }

  const arquivos = fs.readdirSync(PASTA).filter((f) => f.endsWith(".sql")).sort();
  let problemas = 0, conferidas = 0;

  for (const arq of arquivos) {
    const bruto = fs.readFileSync(path.join(PASTA, arq), "utf8");
    const limpo = semComentario(bruto);

    for (const trecho of pedacos(limpo)) {
      // "from public.receb_eventos ev" / "join pg_proc p" / "from (...) t"
      const apelidos = {};
      const re = /\b(?:from|join|update|into)\s+(?:(?:public|pg_catalog|information_schema)\.)?(\w+)\s+(?:as\s+)?([a-z]\w{0,3})\b(?!\s*\()/gi;
      // TABELA SEM APELIDO: "from public.x where id = ..." — foi por aqui que
      // passou o forn_decidir_conta lendo uma coluna que nao existe.
      const reSo = /\b(?:from|update)\s+public\.(\w+)\s*(?:\n|\r|\s)*(?=where|set|;|$)/gi;
      let m2;
      while ((m2 = reSo.exec(trecho))) {
        const tab = m2[1];
        if (!colunas[tab]) continue;
        // Só a cláusula IMEDIATA. Varrer adiante sem limite atravessa para
        // outra consulta e acusa erro onde não tem — alarme que grita à toa
        // vira alarme ignorado.
        const resto = trecho.slice(m2.index + m2[0].length);
        const clausula = resto.split(/\b(?:from|select|join|insert|update|returning|values)\b|[(),;]/i)[0];
        const rc = /\b(?:where|and|or|set)\s+([a-z_][a-z0-9_]*)\s*=/gi;
        let c2;
        while ((c2 = rc.exec(clausula))) {
          const col = c2[1];
          conferidas++;
          if (NAO_E_COLUNA.has(col)) continue;
          if (!colunas[tab].has(col)) {
            problemas++;
            const pos = bruto.indexOf(c2[0]);
            console.log("PROBLEMA  " + arq + ":" + (pos < 0 ? "?" : bruto.slice(0, pos).split("\n").length));
            console.log("          " + col + " (tabela sem apelido)  →  " + tab + " não tem essa coluna");
          }
        }
      }
      let m;
      while ((m = re.exec(trecho))) {
        const tab = m[1], ape = m[2].toLowerCase();
        if (["on", "as", "set", "where", "and", "or", "select", "using", "limit",
             "order", "group", "left", "join", "into", "values"].includes(ape)) continue;
        // tabela que o banco não expõe (pg_proc, CTE, subconsulta): não dá para conferir
        const alvo = colunas[tab] ? tab : null;
        if (ape in apelidos && apelidos[ape] !== alvo) apelidos[ape] = null;
        else apelidos[ape] = alvo;
      }

      for (const [ape, tab] of Object.entries(apelidos)) {
        if (!tab) continue;
        const usos = new Set();
        const ru = new RegExp("\\b" + ape + "\\.(\\w+)", "gi");
        let u;
        while ((u = ru.exec(trecho))) usos.add(u[1]);

        for (const col of usos) {
          conferidas++;
          if (NAO_E_COLUNA.has(col)) continue;
          if (!colunas[tab].has(col)) {
            problemas++;
            const alvo = ape + "." + col;
            const pos = bruto.indexOf(alvo);
            const linha = pos < 0 ? "?" : bruto.slice(0, pos).split("\n").length;
            console.log("PROBLEMA  " + arq + ":" + linha);
            console.log("          " + alvo + "  →  a tabela " + tab + " não tem a coluna \"" + col + "\"");
            const parecidas = [...colunas[tab]].filter(
              (c) => c.slice(0, 4) === col.slice(0, 4) || c.includes(col) || col.includes(c));
            if (parecidas.length) console.log("          parecidas: " + parecidas.join(", "));
          }
        }
      }
    }
  }

  console.log("---");
  console.log(nTab + " tabelas lidas do banco · " + arquivos.length + " arquivos SQL · " +
              conferidas + " referências conferidas");
  console.log(problemas === 0 ? "TUDO OK: nenhuma coluna inventada." : problemas + " referência(s) a coluna que não existe.");
  process.exit(problemas === 0 ? 0 : 1);
})();
