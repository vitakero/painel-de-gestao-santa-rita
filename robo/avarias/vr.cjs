// ==AVR-VR== Avarias · ligação com o VR SOMENTE LEITURA (cópia de .previa/avarias/codigo/vr.cjs, aprovada na etapa 1).
// Recusa qualquer comando que não seja SELECT/WITH e roda tudo dentro de BEGIN READ ONLY ... ROLLBACK.
// Nunca imprime senha. O servidor do VR está em horário de Greenwich: as consultas NÃO usam current_date/now();
// o "hoje" de Caicó é calculado no JS e vai como parâmetro.
"use strict";
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..", "..");
const ESCRITA = /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|vacuum|call|do|merge|refresh|lock|comment|security|reindex|cluster)\b/i;

function lerEnv() {
  let txt = "";
  try { txt = fs.readFileSync(path.join(RAIZ, ".env"), "utf8"); } catch (e) { /* sem .env: fica o do ambiente */ }
  const g = (k) => { const m = txt.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim() : (process.env[k] || ""); };
  return { host: g("PG_HOST"), port: +g("PG_PORT"), database: g("PG_DATABASE"), user: g("PG_USER"), password: g("PG_PASSWORD") };
}

function conferirSoLeitura(sql) {
  const limpo = sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "").trim();
  if (!/^(select|with)\b/i.test(limpo)) throw new Error("recusado: só SELECT/WITH");
  if (ESCRITA.test(limpo)) throw new Error("recusado: palavra de escrita na consulta");
  return limpo;
}

function clientePg() {
  try { return require(path.join(RAIZ, "node_modules", "pg")).Client; } catch (e) { return require("pg").Client; }
}

// Abre uma sessão só de leitura, roda as consultas e desfaz tudo no fim, sempre.
// REPEATABLE READ (a única diferença da cópia aprovada): todas as consultas da rodada veem o MESMO retrato do VR. Sem
// isso, uma troca registrada no coletor entre a leitura do livro e a do saldo faria "fila × saldo" não bater por acaso.
async function comVR(fn, { tempoMs = 120000 } = {}) {
  const Client = clientePg();
  const c = new Client({ ...lerEnv(), connectionTimeoutMillis: 20000, statement_timeout: tempoMs, query_timeout: tempoMs + 10000 });
  await c.connect();
  try {
    await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await c.query("SET TRANSACTION READ ONLY");
    const consultar = async (sql, params) => (await c.query(conferirSoLeitura(sql), params)).rows;
    return await fn(consultar);
  } finally {
    try { await c.query("ROLLBACK"); } catch (_) {}
    try { await c.end(); } catch (_) {}
  }
}

module.exports = { comVR, conferirSoLeitura, ESCRITA };
