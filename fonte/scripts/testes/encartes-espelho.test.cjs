// ============================================================
// PLANEJAMENTO DE ENCARTES — CONFERÊNCIA CRUZADA banco × cálculo × tela.
//
// Cada peça tem o seu teste (encartes-banco, encartes-calculo, encartes-tela). Este prova
// que as peças DIZEM A MESMA COISA. Sobe um PostgreSQL 16 TEMPORÁRIO (pasta temporária,
// só por soquete), monta o mesmo esboço do Supabase do encartes-banco.test.cjs, copia as
// funções de permissão dos arquivos reais de sql/ e instala o sql/encartes_v1.sql de
// verdade. Depois confere:
//   (a) PONTO DE PARTIDA: o que o SQL grava em calendario_regras e encarte_modelos é
//       igual, campo a campo, a ENC.REGRAS_PADRAO e ENC.MODELOS_PADRAO. O Calendário usa
//       a cópia do cálculo enquanto o banco não responde: se as duas divergirem, o nome
//       de uma data muda conforme o login.
//   (d) BLACK FRIDAY de 2026 a 2030 igual nos dois lados; e toda regra do Calendário é
//       reconhecida igual pelo banco (encarte__bate_com_regra) e pelo cálculo
//       (ENC.ocorrencias), dia a dia, de 2026 a 2030.
//   (c) DATAS: toda edição que a tela cria (ENC.edicoesParaCriar, dia a dia, 2026 a 2028)
//       é ACEITA pelo banco no dia em que a tela cria (e no último dia em que ainda cria),
//       e o banco grava o MESMO título e os MESMOS prazos que a edição virtual
//       (ENC.edicoesFuturas) mostrava antes de nascer.
//   (b) MUDANÇA MATERIAL: pelo caminho real das funções, com o login do master de teste
//       (criar edição → registrar → escolher → aprovar → mexer), o que o banco FAZ (a vaga
//       volta para "aguardando visto"? grava crítica no ar? com quais razões?) é o que
//       ENC.mudancaMaterial AVISA e o que a tela mostraria — antes do ar e no ar, com a
//       vaga aprovada e também pendente, aguardando visto e em ajuste.
//       Também RODA funções tiradas do tela.js sobre as linhas do banco: a aba "Aprovado ×
//       atual" (comparar) e a conta "no ar sem aprovação" (pendentesNoAr, K7).
//   (f) K10: a vaga em ajuste aparece "esperando o comprador" na tela (esperandoComprador,
//       do tela.js) exatamente quando o banco a deixa de fora da aprovação.
//   (e) TELA: toda razão que o banco grava tem rótulo em português na tela.
//
// RELÓGIO: o "hoje" do banco (encarte_hoje) é trocado SÓ neste Postgres temporário. O
// preparo do (b) roda em 20/09/2026 (tudo ainda antes do ar: é aí que se aprova) e as
// mudanças em 06/10/2026 (terça: umas edições já no ar, outras não; na PS de 05/10, uma ação
// temática de sexta a domingo ainda por vir; e a edição própria do Final de semana de 09/10,
// também por vir). O resultado não depende do dia em que o teste roda.
//
//   node scripts/testes/encartes-espelho.test.cjs
//
// NÃO encosta no Supabase de produção. Nomes e produtos daqui são INVENTADOS.
// ============================================================
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const B = require("./apoio/banco-de-teste.cjs");
const RAIZ = path.join(__dirname, "..", "..");
const ENC = require(path.join(RAIZ, "scripts", "encartes", "calculo.cjs"));
const PSQL = "/opt/homebrew/opt/postgresql@16/bin/psql";
const AMB = Object.assign({}, process.env, { LC_ALL: "C", LANG: "C" });

if (!B.temPostgres()) {
  console.log("SEM POSTGRES LOCAL — instale com: brew install postgresql@16");
  process.exit(1);
}

const MASTER = "e2000000-0000-4000-8000-000000000001"; // o master de teste (inventado)

// ---------- o que a TELA lê (tirado dos arquivos dela, para não testar uma cópia) ----------
const PAINEL = fs.readFileSync(path.join(RAIZ, "scripts", "encartes", "painel.js"), "utf8");
const TELA = fs.readFileSync(path.join(RAIZ, "scripts", "encartes", "tela.js"), "utf8");
const SQL = fs.readFileSync(path.join(RAIZ, "sql", "encartes_v1.sql"), "utf8");
const COL_PROP = (() => {
  const m = PAINEL.match(/var COL_PROP = ([^;]+);/);
  if (!m) throw new Error("não achei COL_PROP em scripts/encartes/painel.js");
  return Function('"use strict"; return (' + m[1] + ");")();
})();
const RAZOES = (() => {
  const m = TELA.match(/var RAZOES = (\{[\s\S]*?\});/);
  if (!m) throw new Error("não achei o mapa RAZOES em scripts/encartes/tela.js");
  return Function('"use strict"; return (' + m[1] + ");")();
})();

let ok = 0, falhou = 0;
const pg = B.subir();
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "encartes-espelho-"));

// ---------- como conversar com o banco ----------
function psql(args) {
  const r = spawnSync(PSQL, ["-X", "-h", pg.sock, "-U", "bancada", "-d", "fardamento", "-v", "VERBOSITY=verbose", "-t", "-A", "-q"].concat(args),
    { encoding: "utf8", env: AMB, maxBuffer: 256 * 1024 * 1024 });
  const res = { ok: r.status === 0, saida: (r.stdout || "").trim(), erro: (r.stderr || "").trim() };
  if (!res.ok) res.msg = (res.erro.match(/ERROR:\s+(?:[0-9A-Z]{5}:\s+)?([^\n]*)/) || [, res.erro.split("\n")[0]])[1];
  return res;
}
const rodar = (sql) => psql(["-v", "ON_ERROR_STOP=1", "-c", sql]);
const rodarArquivo = (arq) => psql(["-v", "ON_ERROR_STOP=1", "-f", arq]);
// como o dono do banco (sem papel de login): uma linha de JSON
function suJ(sql) {
  const r = rodar(sql);
  if (!r.ok) throw new Error("SQL do teste falhou: " + r.msg + " — " + sql.slice(0, 160));
  return JSON.parse(r.saida.split("\n").pop());
}
const suV = (sql) => { const r = rodar(sql); if (!r.ok) throw new Error("SQL do teste falhou: " + r.msg); return r.saida.split("\n").pop(); };
const lit = (o) => "$j$" + JSON.stringify(o) + "$j$::jsonb";
const q = (s) => (s === null || s === undefined ? "null" : "'" + String(s).replace(/'/g, "''") + "'");
const uuids = (L) => "array[" + (L.length ? L.map((x) => "'" + x + "'").join(",") : "") + "]::uuid[]";

/* Um LOTE de chamadas como uma pessoa logada, numa sessão psql só (rápido). Cada chamada
   passa por teste.tentar: o erro vira {__falhou, codigo, msg, detalhe} em vez de parar
   o lote, e o que a chamada já tinha feito é desfeito (subtransação), como no Supabase. */
function lote(uid, itens) {
  let s = "\\set ON_ERROR_STOP 1\n" +
    `select set_config('request.jwt.claim.sub','${uid}',false) is null;\nset role authenticated;\n`;
  itens.forEach((it) => { s += `select 'R|${it.k}|' || teste.tentar($q$${it.sql}$q$)::text;\n`; });
  const f = path.join(DIR, "lote.sql");
  fs.writeFileSync(f, s);
  const r = rodarArquivo(f);
  if (!r.ok) throw new Error("o lote parou: " + r.erro.split("\n").slice(0, 3).join(" | "));
  const out = {};
  r.saida.split("\n").forEach((l) => { const m = l.match(/^R\|([^|]+)\|(.*)$/); if (m) out[m[1]] = JSON.parse(m[2]); });
  return out;
}

// ---------- como julgar ----------
function eq(nome, obtido, esperado) {
  const a = typeof obtido === "object" ? JSON.stringify(obtido) : String(obtido);
  const b = typeof esperado === "object" ? JSON.stringify(esperado) : String(esperado);
  const bate = a === b;
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + a.slice(0, 220) + (bate ? "" : "   (esperado: " + b.slice(0, 220) + ")"));
  bate ? ok++ : falhou++;
}
function vale(nome, cond, det) {
  console.log((cond ? "  OK   " : "  FALHA") + " | " + nome + (det !== undefined ? "  ->  " + String(det).slice(0, 400) : ""));
  cond ? ok++ : falhou++;
}
// JSON com as chaves em ordem (a ordem das chaves não importa; a das listas, sim)
function canon(x) {
  if (Array.isArray(x)) return "[" + x.map(canon).join(",") + "]";
  if (x && typeof x === "object") return "{" + Object.keys(x).sort().map((k) => JSON.stringify(k) + ":" + canon(x[k])).join(",") + "}";
  return JSON.stringify(x === undefined ? null : x);
}
const somar = (base, n) => { const d = new Date(base + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const tirarNulos = (o) => { const c = {}; Object.keys(o).forEach((k) => { if (o[k] !== null && o[k] !== undefined) c[k] = o[k]; }); return c; };

// ---------- as funções de permissão, copiadas dos arquivos REAIS (como no encartes-banco) ----------
function extrair(arq, nome) {
  const txt = fs.readFileSync(path.join(RAIZ, "sql", arq), "utf8");
  const i = txt.indexOf("create or replace function public." + nome + "(");
  if (i < 0) throw new Error("não achei a função " + nome + " em sql/" + arq);
  const resto = txt.slice(i);
  const tag = (resto.match(/\bas\s+(\$[a-z_]*\$)/i) || [])[1];
  if (!tag) throw new Error("não achei o corpo de " + nome);
  const a = resto.indexOf(tag), b = resto.indexOf(tag, a + tag.length);
  return resto.slice(0, resto.indexOf(";", b) + 1);
}

// Cada seção corre por conta própria: se uma para no meio (uma função que não existe mais,
// por exemplo), as outras continuam e dizem o que acharam.
function secao(fn) {
  try { fn(); } catch (e) {
    console.log("  FALHA | a seção parou no meio: " + (e && e.stack ? e.stack.split("\n").slice(0, 2).join(" | ") : e));
    falhou++;
  }
}

// o relógio do banco: troca encarte_hoje() SÓ neste Postgres temporário
const corpoRelogio = (iso) => `create or replace function public.encarte_hoje() returns date language sql stable
  set search_path = public as $f$ select '${iso}'::date $f$;`;
function relogio(iso) { const r = rodar(corpoRelogio(iso)); if (!r.ok) throw new Error("não fixei o relógio: " + r.msg); }

/* Uma função da TELA, tirada do próprio tela.js (com as chaves balanceadas) e RODADA aqui
   sobre as linhas que o banco devolve — a prova é executar, não procurar texto. */
function funcaoDaTela(nome) {
  const i = TELA.indexOf("function " + nome + "(");
  if (i < 0) throw new Error("não achei a função " + nome + " em scripts/encartes/tela.js");
  let j = TELA.indexOf("{", i), n = 0;
  for (; j < TELA.length; j++) { if (TELA[j] === "{") n++; else if (TELA[j] === "}" && --n === 0) break; }
  return TELA.slice(i, j + 1);
}
const daTela = (deps, nome) => new Function("E", deps.concat([nome]).map(funcaoDaTela).join("\n") + "\nreturn " + nome + ";")(ENC);

try {
  // ======================================================================
  console.log("\n=== 0. Instalação: esboço do Supabase + funções de permissão REAIS + encartes_v1.sql ===\n");
  const esboco = fs.readFileSync(path.join(__dirname, "apoio", "encartes-esboco-supabase.sql"), "utf8") + "\n" +
    extrair("permissoes_padrao.sql", "pode_pagina") + "\n" +
    extrair("recibos_domingo.sql", "sou_master") + "\n" +
    extrair("central_interruptor_leitura.sql", "eh_da_casa_aprovado") + "\n";
  fs.writeFileSync(path.join(DIR, "esboco.sql"), esboco);
  let r = rodarArquivo(path.join(DIR, "esboco.sql"));
  if (!r.ok) throw new Error("esboço falhou: " + r.erro);
  const fi = path.join(DIR, "instalar.sql");
  fs.writeFileSync(fi, "set check_function_bodies = on;\n\\i " + path.join(RAIZ, "sql", "encartes_v1.sql") + "\n");
  r = rodarArquivo(fi);
  const linhas = r.saida.split("\n").filter((l) => /^\d+\|/.test(l));
  vale("0.1 sql/encartes_v1.sql instalou inteiro e a conferência dele diz OK nos 15 itens",
    r.ok && linhas.length === 15 && linhas.every((l) => /\|OK( - .*)?$/.test(l)),
    r.ok ? (linhas.filter((l) => !/\|OK( - .*)?$/.test(l)).join(" ; ") || "todos OK") : r.erro.split("\n").slice(0, 4).join(" | "));
  // o ajudante SÓ do teste (fora do schema public): chamada que falha vira JSON, não para o lote
  r = rodar(`create schema teste; grant usage on schema teste to authenticated;
    create function teste.tentar(p_sql text) returns jsonb language plpgsql as $f$
    declare r jsonb; v_cod text; v_msg text; v_det text;
    begin
      execute p_sql into r;
      return coalesce(r, 'null'::jsonb);
    exception when others then
      get stacked diagnostics v_cod = returned_sqlstate, v_msg = message_text, v_det = pg_exception_detail;
      return jsonb_build_object('__falhou', true, 'codigo', v_cod, 'msg', v_msg, 'detalhe', v_det);
    end $f$;
    grant execute on function teste.tentar(text) to authenticated;
    insert into public.perfis (id, nome, is_master, paginas, aprovado) values ('${MASTER}', 'Dono Espelho', true, '[]', true);`);
  if (!r.ok) throw new Error("preparo do teste falhou: " + r.msg);
  // ficha do VR (o robô grava; aqui o dono do banco, que passa por cima da tranca)
  r = rodar(`insert into public.encarte_produtos_vr (produto_id, descricao, eans, m1, m2, m3, setor, preco_normal, preco_atual, em_oferta, custo, custo_confiavel, estoque, venda30_valor, impressao) values
      (1001, 'CAFE ESPELHO TRADICIONAL 500G', array['7890000011001'], 39, 5, 1, 'MERCEARIA', 14.99, 14.99, false, 10.50, true, 120, 5000, 'e1'),
      (1002, 'CAFE ESPELHO EXTRA FORTE 500G', array['7890000011002'], 39, 5, 1, 'MERCEARIA', 15.49, 15.49, false, 11.00, true, 80, 3000, 'e2'),
      (1006, 'REFRIGERANTE ESPELHO 2L',       array['7890000011006'], 45, 1, 1, 'BEBIDAS',    8.99,  8.99, false, 6.00, true, 200, 6000, 'e6');
    insert into public.encarte_sync (chave, ultima_ok_em, ultima_tentativa_em, ultima_completa_em, linhas, alteradas)
      values ('produtos', '2026-09-20T13:00:00Z', '2026-09-20T13:00:00Z', '2026-09-20T09:00:00Z', 3, 3);`);
  if (!r.ok) throw new Error("ficha do VR falhou: " + r.msg);
  vale("0.2 esboço, ajudante do teste, master e ficha do VR prontos", true);

  // campanhas e modelos COMO ESTÃO NO BANCO (o que a tela lê)
  const REGRAS = suJ(`select jsonb_agg(to_jsonb(r) order by r.ordem, r.id) from public.calendario_regras r`);
  const MODELOS = suJ(`select jsonb_agg(to_jsonb(m) order by m.id) from public.encarte_modelos m`);

  // ======================================================================
  console.log("\n=== a. Ponto de partida: o SQL grava o mesmo que ENC.REGRAS_PADRAO e ENC.MODELOS_PADRAO ===\n");
  secao(() => {
    const CR = ["id", "nome", "tipo", "categoria", "regra", "setor", "cor", "situacao", "ordem", "observacao"];
    const doBanco = REGRAS.map((x) => { const o = {}; CR.forEach((k) => { o[k] = x[k] === undefined ? null : x[k]; }); return o; });
    const doCalc = ENC.REGRAS_PADRAO.map((x) => { const o = {}; CR.forEach((k) => { o[k] = x[k] === undefined ? null : x[k]; }); return o; });
    eq("a.1 as mesmas " + doBanco.length + " campanhas e datas, na mesma ordem (a do Calendário)", doBanco.map((x) => x.id).join(","), doCalc.map((x) => x.id).join(","));
    const difR = [];
    doBanco.forEach((b) => {
      const c = doCalc.find((x) => x.id === b.id);
      if (!c) { difR.push(b.id + ": só no banco"); return; }
      CR.forEach((k) => { if (canon(b[k]) !== canon(c[k])) difR.push(b.id + "." + k + ": banco=" + canon(b[k]) + " × cálculo=" + canon(c[k])); });
    });
    doCalc.forEach((c) => { if (!doBanco.find((x) => x.id === c.id)) difR.push(c.id + ": só no cálculo"); });
    eq("a.2 cada campanha/data igual campo a campo (id, nome, tipo, categoria, regra, setor, cor, situação, ordem, observação)", difR.join(" ; ") || "iguais", "iguais");
    eq("a.3 nomes que ficam: 'Terçou das Frutas e Verduras', 'Véspera de Natal' (id natal), 'Aniversário Santa Rita'",
      ["tercou", "natal", "aniversario-santa-rita"].map((id) => (REGRAS.find((x) => x.id === id) || {}).nome + "=" + (ENC.REGRAS_PADRAO.find((x) => x.id === id) || {}).nome).join(" | "),
      "Terçou das Frutas e Verduras=Terçou das Frutas e Verduras | Véspera de Natal=Véspera de Natal | Aniversário Santa Rita=Aniversário Santa Rita");

    const CM = ["id", "campanha_id", "tipo", "nome", "prazos", "dias_antes_no_ar", "estrutura", "dicas", "versao", "ativo"];
    const mBanco = MODELOS.map((x) => { const o = {}; CM.forEach((k) => { o[k] = x[k] === undefined ? null : x[k]; }); return o; });
    const mCalc = ENC.MODELOS_PADRAO.map((x) => { const o = {}; CM.forEach((k) => { o[k] = x[k] === undefined ? null : x[k]; }); return o; });
    eq("a.4 os mesmos " + mBanco.length + " modelos (" + mBanco.filter((x) => x.tipo === "edicao").length + " de edição + " + mBanco.filter((x) => x.tipo === "tema").length + " temas)",
      mBanco.map((x) => x.id).sort().join(","), mCalc.map((x) => x.id).sort().join(","));
    const difM = [];
    mBanco.forEach((b) => {
      const c = mCalc.find((x) => x.id === b.id);
      if (!c) { difM.push(b.id + ": só no banco"); return; }
      CM.forEach((k) => {
        if (canon(b[k]) === canon(c[k])) return;
        if (k !== "estrutura") { difM.push(b.id + "." + k + ": banco=" + canon(b[k]) + " × cálculo=" + canon(c[k])); return; }
        const gb = (b.estrutura && b.estrutura.grupos) || [], gc = (c.estrutura && c.estrutura.grupos) || [];
        if (gb.map((g) => g.chave).join(",") !== gc.map((g) => g.chave).join(",")) { difM.push(b.id + ".grupos: banco=" + gb.map((g) => g.chave) + " × cálculo=" + gc.map((g) => g.chave)); return; }
        gb.forEach((g, i) => { if (canon(g) !== canon(gc[i])) difM.push(b.id + "." + g.chave + ": banco=" + canon(g).slice(0, 120) + " × cálculo=" + canon(gc[i]).slice(0, 120)); });
      });
    });
    eq("a.5 cada modelo igual campo a campo (campanha, tipo, nome, prazos, grupos, vagas NA ORDEM, dicas, versão, ativo)", difM.join(" ; ") || "iguais", "iguais");
    const vagasDe = (L, id) => { const m = L.find((x) => x.id === id); return m ? m.estrutura.grupos.map((g) => g.chave + ":" + g.vagas.map((v) => v.chave).join("/")).join(" ") : "?"; };
    eq("a.6 vagas do Sábado Bombástico e da Hora da Economia: as do SQL",
      [vagasDe(mCalc, "sabado-bombastico") === vagasDe(mBanco, "sabado-bombastico"), vagasDe(mCalc, "hora-da-economia") === vagasDe(mBanco, "hora-da-economia")], [true, true]);
    // ==FDSPROPRIO== o Final de semana virou promoção própria em 10/10/2026: nos DOIS lados, a PS sem o
    // grupo e o modelo próprio com as 6 vagas (as do antigo grupo), sem período
    eq("a.7 Final de semana nos dois lados: a PS sem o grupo (7 grupos) e o modelo próprio (1 grupo, 6 vagas, sem período)",
      [mBanco, mCalc].map((L) => vagasDe(L, "promocao-semanal").split(" ").length + "|" + vagasDe(L, "final-de-semana") + "|" +
        L.find((x) => x.id === "final-de-semana").estrutura.grupos.filter((g) => g.periodo || g.prazos).length),
      ["7|ofertas:frango/linguica/carne-suina/bebida/mercearia/conveniencia|0", "7|ofertas:frango/linguica/carne-suina/bebida/mercearia/conveniencia|0"]);
  });

  // ======================================================================
  console.log("\n=== d. Black Friday e as regras do Calendário: o banco reconhece o que o cálculo conta ===\n");
  secao(() => {
    const BF = ["2026-11-27", "2027-11-26", "2028-11-24", "2029-11-23", "2030-11-29"];
    const anos = [2026, 2027, 2028, 2029, 2030];
    const bfCalc = ENC.REGRAS_PADRAO.find((x) => x.id === "black-friday");
    const bfBanco = REGRAS.find((x) => x.id === "black-friday");
    eq("d.1 a regra é a mesma nos dois lados: dia seguinte à 4ª quinta de novembro",
      [canon(bfBanco.regra) === canon(bfCalc.regra), canon(bfBanco.regra)],
      [true, canon({ tipo: "anual_nth", mes: 11, n: 4, dia_semana: 4, deslocamento_dias: 1, duracao_dias: 1 })]);
    eq("d.2 cálculo (regra do cálculo): 27/11/2026, 26/11/2027, 24/11/2028, 23/11/2029, 29/11/2030",
      anos.map((a) => ENC.ocorrencias(bfCalc, a + "-01-01", a + "-12-31").map((o) => o.inicio).join("+")), BF);
    eq("d.3 cálculo (regra lida do banco): as mesmas 5 datas", anos.map((a) => ENC.ocorrencias(bfBanco, a + "-01-01", a + "-12-31").map((o) => o.inicio).join("+")), BF);
    // os dias como date + número (sem passar por horário, nem pelo fuso do servidor)
    const DIAS = `(select '2026-01-01'::date + i as d from generate_series(0, '2030-12-31'::date - '2026-01-01'::date) i)`;
    const bfDias = suJ(`select jsonb_agg(t.d order by t.d) from public.calendario_regras r, ${DIAS} t
       where r.id = 'black-friday' and public.encarte__bate_com_regra(r.regra, t.d, t.d)`);
    eq("d.4 banco (encarte__bate_com_regra, cada dia de 2026 a 2030): reconhece EXATAMENTE as mesmas 5 datas (e não 30/11/2029)", bfDias, BF);

    // toda regra do Calendário, dia a dia: o banco reconhece o início que o cálculo conta
    const doBanco = suJ(`select coalesce(jsonb_object_agg(id, dias), '{}') from (
        select r.id, coalesce(jsonb_agg(t.d order by t.d) filter (where public.encarte__bate_com_regra(r.regra, t.d,
                 t.d + (greatest(coalesce((r.regra->>'duracao_dias')::int, 1), 1) - 1))), '[]') as dias
          from public.calendario_regras r cross join ${DIAS} t
         where r.regra->>'tipo' <> 'datas'
         group by r.id) t`);
    const faltam = [], sobram = [], pascoaSobra = [];
    REGRAS.filter((x) => x.regra.tipo !== "datas").forEach((x) => {
      const calc = ENC.ocorrencias(x, "2026-01-01", "2030-12-31").map((o) => o.inicio).filter((d) => d >= "2026-01-01" && d <= "2030-12-31");
      const banco = doBanco[x.id] || [];
      calc.filter((d) => banco.indexOf(d) < 0).forEach((d) => faltam.push(x.id + " " + d));
      banco.filter((d) => calc.indexOf(d) < 0).forEach((d) => (x.regra.tipo === "pascoa" ? pascoaSobra : sobram).push(x.id + " " + d));
    });
    const nOc = REGRAS.filter((x) => x.regra.tipo !== "datas").reduce((s, x) => s + (doBanco[x.id] || []).length, 0);
    eq("d.5 toda ocorrência que o cálculo conta (" + REGRAS.filter((x) => x.regra.tipo !== "datas").length + " regras, 2026 a 2030) o banco reconhece", faltam.join(" ; ") || "todas", "todas");
    eq("d.5a ... inclusive o Final de semana: toda sexta de 2026 a 2030, de sexta a domingo",
      [(doBanco["final-de-semana"] || []).length > 250, (doBanco["final-de-semana"] || []).every((d) => new Date(d + "T12:00:00Z").getUTCDay() === 5)], [true, true]);
    eq("d.6 ... e o banco não reconhece dia nenhum além delas (fora as de Páscoa, ver abaixo)", sobram.join(" ; ") || "nenhum", "nenhum");
    console.log("  (informação) regras de Páscoa: o banco aceita qualquer DOMINGO de 22/03 a 25/04 (desenho do encarte__bate_com_regra); " +
      "o cálculo conta só a Páscoa do ano. Dias a mais no banco: " + pascoaSobra.length + " (" + pascoaSobra.slice(0, 3).join(", ") + "…). " +
      "Nenhuma campanha com edição usa regra de Páscoa hoje. Total reconhecido pelo banco: " + nOc + " dias.");
  });

  // ======================================================================
  console.log("\n=== c. Datas: toda edição que a tela cria (2026 a 2028) o banco aceita, com o título e os prazos da edição virtual ===\n");
  secao(() => {
    const chave = (e) => e.campanha_id + "|" + e.inicio_regra;
    const vistas = [], plano = [], virtualPrimeira = {}, virtualVespera = {};
    // o que a tela faz a cada dia: cria as que o "começar" alcançou (edicoesParaCriar) e
    // mostra as próximas como virtuais (edicoesFuturas, 70 dias)
    for (let d = "2025-11-01"; d <= "2028-12-31"; d = somar(d, 1)) {
      ENC.edicoesParaCriar(REGRAS, MODELOS, d, vistas, { diasPassados: 7 }).forEach((e) => {
        vistas.push({ campanha_id: e.campanha_id, inicio_regra: e.inicio_regra });
        if (e.inicio_regra >= "2026-01-01" && e.inicio_regra <= "2028-12-31") plano.push({ dia: d, e });
      });
      ENC.edicoesFuturas(REGRAS, MODELOS, d, 70, vistas).forEach((e) => {
        const k = chave(e);
        if (!virtualPrimeira[k]) virtualPrimeira[k] = e;
        virtualVespera[k] = e;
      });
    }
    const porCamp = {};
    plano.forEach((p) => { porCamp[p.e.campanha_id] = (porCamp[p.e.campanha_id] || 0) + 1; });
    const resumo = Object.keys(porCamp).sort().map((k) => k + " " + porCamp[k]).join(", ");
    vale("c.1 a tela cria " + plano.length + " edições de 2026 a 2028 (" + resumo + "), cada uma no dia em que o 'começar' chega",
      plano.length > 380 && plano.every((p) => p.dia === p.e.prazos.comecar), plano.filter((p) => p.dia !== p.e.prazos.comecar).length + " fora do 'começar'");
    // a edição virtual (antes de nascer) e a criada: mesmas datas, prazos e título
    const campos = (e) => canon({ titulo: e.titulo, inicio: e.inicio, fim: e.fim, inicio_regra: e.inicio_regra, prazos: e.prazos });
    const semVirtual = plano.filter((p) => !virtualPrimeira[chave(p.e)]).map((p) => chave(p.e));
    const difVirt = plano.filter((p) => virtualPrimeira[chave(p.e)] &&
      (campos(virtualPrimeira[chave(p.e)]) !== campos(p.e) || campos(virtualVespera[chave(p.e)]) !== campos(p.e))).map((p) => chave(p.e));
    eq("c.2 toda edição apareceu antes como VIRTUAL (edicoesFuturas) com o mesmo título, datas e prazos — da 1ª vez e na véspera",
      [semVirtual.slice(0, 5).join(",") || "todas vistas", difVirt.slice(0, 5).join(",") || "iguais"], ["todas vistas", "iguais"]);

    // o banco, no dia em que a tela cria, aceita — tudo numa transação desfeita no fim
    function ensaio(diaDoRelogio, lerGravado) {
      let s = "\\set ON_ERROR_STOP 1\nbegin;\n" + `select set_config('request.jwt.claim.sub','${MASTER}',true) is null;\n`;
      plano.forEach((p, i) => {
        const e = p.e;
        s += "reset role;\n" + corpoRelogio(diaDoRelogio(p)) + "\nset local role authenticated;\n" +
          `select 'R|${i}|' || teste.tentar($q$select public.encarte_criar_edicao(${q(e.campanha_id)}, ${q(e.inicio_regra)}, ${q(e.inicio)}, ${q(e.fim)}, ${lit(e.prazos)})$q$)::text;\n`;
      });
      s += "reset role;\n";
      if (lerGravado) {
        s += `select 'G|' || coalesce(jsonb_agg(jsonb_build_object('k', e.campanha_id || '|' || e.inicio_regra, 'titulo', e.titulo,
            'inicio', e.inicio, 'fim', e.fim, 'prazos', e.prazos,
            'grupos', (select coalesce(jsonb_object_agg(g.chave, g.prazos), '{}') from public.encarte_grupos g where g.edicao_id = e.id and g.prazos is not null))), '[]')::text
          from public.encarte_edicoes e;\n`;
      }
      s += "rollback;\n";
      const f = path.join(DIR, "ensaio.sql");
      fs.writeFileSync(f, s);
      const rr = rodarArquivo(f);
      const res = {}; let gravado = null;
      rr.saida.split("\n").forEach((l) => {
        const m = l.match(/^R\|(\d+)\|(.*)$/); if (m) res[m[1]] = JSON.parse(m[2]);
        if (l.startsWith("G|")) gravado = JSON.parse(l.slice(2));
      });
      return { ok: rr.ok, erro: rr.erro, res, gravado };
    }
    const e1 = ensaio((p) => p.dia, true);
    const recusadas1 = plano.map((p, i) => ({ p, x: e1.res[i] })).filter((o) => !(o.x && o.x.ok === true && o.x.criada === true));
    vale("c.3 no dia em que a tela cria, o banco ACEITA todas as " + plano.length,
      e1.ok && recusadas1.length === 0,
      e1.ok ? (recusadas1.length + " recusadas" + (recusadas1.length ? ": " + recusadas1.slice(0, 3).map((o) => chave(o.p.e) + " " + JSON.stringify(o.x)).join(" | ") : "")) : e1.erro.split("\n")[0]);
    const gravado = {};
    (e1.gravado || []).forEach((g) => { gravado[g.k] = g; });
    const difTit = [], difPz = [], difGr = [];
    plano.forEach((p) => {
      const g = gravado[chave(p.e)]; if (!g) return;
      // K9: o título da edição virtual é o que o banco grava
      if (g.titulo !== virtualVespera[chave(p.e)].titulo) difTit.push(chave(p.e) + ": banco '" + g.titulo + "' × virtual '" + virtualVespera[chave(p.e)].titulo + "'");
      const pz = p.e.prazos;
      if (canon(g.prazos) !== canon({ comecar: pz.comecar, definir: pz.definir, aprovar: pz.aprovar })) difPz.push(chave(p.e) + ": " + canon(g.prazos));
      const gc = {};
      Object.keys(pz.grupos || {}).forEach((k) => { gc[k] = { comecar: pz.grupos[k].comecar, definir: pz.grupos[k].definir, aprovar: pz.grupos[k].aprovar }; });
      if (canon(g.grupos) !== canon(gc)) difGr.push(chave(p.e) + ": banco " + canon(g.grupos) + " × cálculo " + canon(gc));
    });
    eq("c.4 o banco gravou todas, com o título no MESMO formato da edição virtual ('<nome> · DD/MM/AAAA')",
      [Object.keys(gravado).length, difTit.slice(0, 3).join(" ; ") || "iguais"], [plano.length, "iguais"]);
    eq("c.5 ... e os prazos da edição e dos grupos com prazo próprio (Terçou hortifrúti) iguais aos do cálculo",
      [difPz.slice(0, 3).join(" ; ") || "iguais", difGr.slice(0, 3).join(" ; ") || "iguais"], ["iguais", "iguais"]);
    const exemplo = gravado["promocao-semanal|2026-12-28"];
    eq("c.6 exemplo: a PS de 28/12/2026 (atravessa o ano) grava 'Promoção Semanal · 28/12/2026'", exemplo && exemplo.titulo, "Promoção Semanal · 28/12/2026");
    const e2 = ensaio((p) => somar(p.e.fim, 7), false);
    const recusadas2 = plano.map((p, i) => ({ p, x: e2.res[i] })).filter((o) => !(o.x && o.x.ok === true && o.x.criada === true));
    vale("c.7 no ÚLTIMO dia em que a tela ainda cria (fim + 7), o banco também aceita todas",
      e2.ok && recusadas2.length === 0, e2.ok ? (recusadas2.length + " recusadas" + (recusadas2.length ? ": " + recusadas2.slice(0, 3).map((o) => chave(o.p.e) + " " + JSON.stringify(o.x)).join(" | ") : "")) : e2.erro.split("\n")[0]);
    eq("c.8 o ensaio foi desfeito (nenhuma edição ficou)", suV("select count(*) from public.encarte_edicoes"), "0");
    // ==FDSPROPRIO== o Final de semana como promoção própria (10/10/2026): a tela cria uma edição por
    // sexta, de sexta a domingo, e o banco grava com o título dela
    const fdsPl = plano.filter((p) => p.e.campanha_id === "final-de-semana");
    eq("c.9 o Final de semana entra no ensaio: toda sexta de 2026 a 2028, de sexta a domingo, aceita e gravada com o título 'Final de semana de ofertas · DD/MM/AAAA'",
      [fdsPl.length > 150, fdsPl.every((p) => new Date(p.e.inicio + "T12:00:00Z").getUTCDay() === 5 && p.e.fim === somar(p.e.inicio, 2)),
        fdsPl.every((p) => gravado[chave(p.e)] && gravado[chave(p.e)].titulo === "Final de semana de ofertas · " + p.e.inicio.split("-").reverse().join("/"))],
      [true, true, true]);
  });

  // ======================================================================
  console.log("\n=== b. Mudança material: o que o banco FAZ = o que o cálculo AVISA (caminho real, login do master) ===\n");
  const razoesVistas = new Set(); // as razões que o banco gravou na bateria (a seção e confere os rótulos)
  secao(() => {
    const HOJE_PREPARO = "2026-09-20", HOJE_ACAO = "2026-10-06";
    relogio(HOJE_PREPARO);
    const real = (camp, ini) => {
      const rg = REGRAS.find((x) => x.id === camp);
      const m = MODELOS.find((x) => x.tipo === "edicao" && x.campanha_id === camp && x.ativo !== false);
      const o = ENC.ocorrencias(rg.regra, ini, ini).find((x) => x.inicio === ini);
      if (!o) throw new Error(camp + " não começa em " + ini);
      return { campanha: camp, inicio: o.inicio, fim: o.fim, inicio_regra: o.inicio_regra, prazos: ENC.prazosEdicao(m, o.inicio, o.fim) };
    };
    // no ar em 06/10: PS 28/09 (inteira), PS 05/10 (menos a ação temática de sexta a domingo, que só entra
    // na sexta 09/10), HE 24/09 (quinta, já passou). Antes do ar: PS 12/10, PS 19/10, PS 26/10 e a edição
    // própria do Final de semana de 09/10 (sexta a domingo).
    // ==FDSPROPRIO== até 10/10/2026 o "grupo ainda não no ar dentro de edição no ar" era o Fim de semana da
    // PS 05/10. Ele virou promoção própria: o mesmo caminho agora é provado por uma ação temática com datas
    // próprias dentro da PS, e a edição FDS de 09/10 entra como edição antes do ar com a PS no ar. Sem as 36
    // vagas que a PS perdeu, a PS 12/10 entra para a bateria ter vagas antes do ar que bastem.
    const EDS = [real("promocao-semanal", "2026-09-28"), real("promocao-semanal", "2026-10-05"), real("hora-da-economia", "2026-09-24"),
      real("promocao-semanal", "2026-10-12"), real("promocao-semanal", "2026-10-19"), real("promocao-semanal", "2026-10-26"),
      real("final-de-semana", "2026-10-09")];
    const criadas = lote(MASTER, EDS.map((e, i) => ({ k: "ed" + i,
      sql: `select public.encarte_criar_edicao(${q(e.campanha)}, ${q(e.inicio_regra)}, ${q(e.inicio)}, ${q(e.fim)}, ${lit(e.prazos)})` })));
    vale("b.0a master cria as " + EDS.length + " edições (" + EDS.map((e) => (e.campanha === "promocao-semanal" ? "PS" : e.campanha === "hora-da-economia" ? "HE" : "Final de semana") +
      " " + e.inicio.slice(8) + "/" + e.inicio.slice(5, 7)).join(", ") + ") em 20/09",
      EDS.every((e, i) => criadas["ed" + i] && criadas["ed" + i].criada === true), JSON.stringify(Object.values(criadas).map((x) => x.criada || x.detalhe)));
    if (!EDS.every((e, i) => criadas["ed" + i] && criadas["ed" + i].id)) throw new Error("sem as edições do preparo a bateria não roda");
    const edIds = EDS.map((e, i) => criadas["ed" + i].id);
    const edFds = edIds[EDS.findIndex((e) => e.campanha === "final-de-semana")];
    // a ação temática de sexta a domingo (09 a 11/10) na PS 05/10, com 3 vagas (o modelo do tema não tem vagas)
    const acao = lote(MASTER, [{ k: "g", sql: `select public.encarte_criar_grupo_tematico('${edIds[1]}', 'tema-black-friday', 'Ação de sexta a domingo', '2026-10-09', '2026-10-11', null)` }]).g;
    if (!acao || !acao.id) throw new Error("não criei a ação temática na PS 05/10: " + JSON.stringify(acao));
    const vAcao = lote(MASTER, [["Frango", "corte"], ["Linguiça", "marca"], ["Cerveja", "marca"]].map(([n, oq], i) => ({ k: "v" + i,
      sql: `select public.encarte_adicionar_vaga('${edIds[1]}', '${acao.id}', ${q(n)}, ${q(oq)})` })));
    vale("b.0a2 na PS 05/10, uma ação temática de sexta a domingo (09 a 11/10) com 3 vagas",
      Object.values(vAcao).every((x) => x.ok) && suV(`select inicio || '..' || fim || '|' || (select count(*) from public.encarte_vagas where grupo_id = '${acao.id}') from public.encarte_grupos where id = '${acao.id}'`) === "2026-10-09..2026-10-11|3",
      JSON.stringify(vAcao));
    // as vagas, com o início do grupo (a ação temática tem período próprio)
    const VAGAS = suJ(`select jsonb_agg(jsonb_build_object('id', v.id, 'edicao', v.edicao_id, 'grupo', g.chave, 'ini', coalesce(g.inicio, e.inicio))
        order by e.inicio, g.ordem, v.ordem) from public.encarte_vagas v join public.encarte_grupos g on g.id = v.grupo_id
        join public.encarte_edicoes e on e.id = v.edicao_id where v.edicao_id = any(${uuids(edIds)})`);
    const acaoPs0510 = VAGAS.filter((v) => v.edicao === edIds[1] && v.grupo === acao.chave);
    const reservadas = new Set(acaoPs0510.slice(0, 3).map((v) => v.id));
    // distribui em rodízio entre as edições (todas recebem casos: a HE de 1 dia também)
    function rodizio(L) {
      const por = {}, ordem = [];
      L.forEach((v) => { if (!por[v.edicao]) { por[v.edicao] = []; ordem.push(v.edicao); } por[v.edicao].push(v); });
      const out = []; let resta = true;
      for (let i = 0; resta; i++) { resta = false; ordem.forEach((e) => { if (por[e][i]) { out.push(por[e][i]); resta = true; } }); }
      return out;
    }
    const poolNoAr = rodizio(VAGAS.filter((v) => v.ini <= HOJE_ACAO));
    const poolAntes = rodizio(VAGAS.filter((v) => v.ini > HOJE_ACAO && !reservadas.has(v.id)));
    const poolGrupo = acaoPs0510.slice(0, 3);

    // ---------- a bateria ----------
    const X = null; // campo apagado
    const BASE = { produtos: [1001], fornecedor_nome: "Distribuidora Alfa", fornecedor_id: 501, custo_negociado: 9.8, preco_oferta: 12.99,
      verba_valor: 100, verba_qtd_base: 100, condicao_pagamento: "28 dias", quantidade_minima: "10 caixas", validade: "2026-12-31", observacao: "arte padrão" };
    const BON = { bonif_compra: 10, bonif_ganha: 1 };
    // ed = editar a escolhida (mud = o que a tela manda; envio = o que vai ao banco, se diferente)
    // tr = escolher OUTRA proposta (outra = o que muda em relação à escolhida)
    const ed = (nome, antes, mud, envio) => ({ nome, acao: "editar", antes, mud, envio });
    const tr = (nome, antes, outra) => ({ nome, acao: "escolher", antes, outra });
    const CASOS = [
      ed("preço sobe (12,99 → 13,49)", {}, { preco_oferta: 13.49 }),
      ed("preço desce (12,99 → 11,99)", {}, { preco_oferta: 11.99 }),
      ed("preço apagado", {}, { preco_oferta: X }),
      ed("preço que não existia passa a existir", { preco_oferta: X }, { preco_oferta: 12.99 }),
      ed("preço com 3 casas sobe (12,99 → 12,991)", {}, { preco_oferta: 12.991 }),
      ed("preço com 3 casas desce (12,99 → 12,989)", {}, { preco_oferta: 12.989 }),
      ed("preço reenviado igual, com zero a mais ('12.990')", {}, { preco_oferta: 12.99 }, { preco_oferta: "12.990" }),
      ed("custo sobe (9,80 → 9,90)", {}, { custo_negociado: 9.9 }),
      ed("custo desce (9,80 → 9,70)", {}, { custo_negociado: 9.7 }),
      ed("custo com 4 casas sobe (2,2480 → 2,2489)", { custo_negociado: 2.248 }, { custo_negociado: 2.2489 }),
      ed("custo com 4 casas desce (2,2489 → 2,2488)", { custo_negociado: 2.2489 }, { custo_negociado: 2.2488 }),
      ed("custo sobe um centésimo de centavo (9,80 → 9,8001)", {}, { custo_negociado: 9.8001 }),
      ed("custo reenviado igual", {}, { custo_negociado: 9.8 }),
      ed("verba total menor (100 → 50)", {}, { verba_valor: 50 }),
      ed("verba total maior (100 → 150)", {}, { verba_valor: 150 }),
      ed("verba retirada (valor e base)", {}, { verba_valor: X, verba_qtd_base: X }),
      ed("verba total menor com valor por unidade MAIOR (100/10 → 80/4)", { verba_qtd_base: 10 }, { verba_valor: 80, verba_qtd_base: 4 }),
      ed("verba total maior com valor por unidade MENOR (100/10 → 120/40)", { verba_qtd_base: 10 }, { verba_valor: 120, verba_qtd_base: 40 }),
      ed("base da verba completada (100 sem base → 100/100)", { verba_qtd_base: X }, { verba_qtd_base: 100 }),
      ed("só a base da verba muda (100/50 → 100/100)", { verba_qtd_base: 50 }, { verba_qtd_base: 100 }),
      ed("base da verba apagada, total fica (100/100 → 100/—)", {}, { verba_qtd_base: X }),
      ed("verba nova (nenhuma → 50/100)", { verba_valor: X, verba_qtd_base: X }, { verba_valor: 50, verba_qtd_base: 100 }),
      ed("só o valor da verba apagado (100/100 → —/100)", {}, { verba_valor: X }),
      ed("verba com 4 casas menor (100 → 99,9999)", {}, { verba_valor: 99.9999 }),
      ed("verba para zero (50 → 0)", { verba_valor: 50 }, { verba_valor: 0 }),
      ed("verba de zero para 50", { verba_valor: 0 }, { verba_valor: 50 }),
      ed("bonificação ganha mais (10+1 → 10+2)", BON, { bonif_ganha: 2 }),
      ed("bonificação com fração menor (10+1 → 12+1)", BON, { bonif_compra: 12 }),
      ed("bonificação retirada", BON, { bonif_compra: X, bonif_ganha: X }),
      ed("bonificação com a mesma fração (10+1 → 20+2)", BON, { bonif_compra: 20, bonif_ganha: 2 }),
      ed("bonificação nova (nenhuma → 10+1)", {}, { bonif_compra: 10, bonif_ganha: 1 }),
      ed("bonificação com fração maior (10+1 → 9+1)", BON, { bonif_compra: 9 }),
      ed("bonificação 3+1 → 7+2 (1/4 → 2/9, menor)", { bonif_compra: 3, bonif_ganha: 1 }, { bonif_compra: 7, bonif_ganha: 2 }),
      ed("bonificação 2+1 → 4+2 (mesma fração)", { bonif_compra: 2, bonif_ganha: 1 }, { bonif_compra: 4, bonif_ganha: 2 }),
      ed("bonificação pela metade (10+1 → 10+—)", BON, { bonif_ganha: X }),
      ed("texto da bonificação muda", { bonificacao_texto: "leve 10 pague 9" }, { bonificacao_texto: "leve 12 pague 10" }),
      ed("produto trocado ([1001] → [1002])", {}, { produtos: [1002] }),
      ed("produto a mais ([1001] → [1001, 1002])", {}, { produtos: [1001, 1002] }),
      ed("produto a menos ([1001, 1002] → [1001])", { produtos: [1001, 1002] }, { produtos: [1001] }),
      ed("produtos em outra ordem ([1001, 1002] → [1002, 1001])", { produtos: [1001, 1002] }, { produtos: [1002, 1001] }),
      ed("produto repetido ([1001] → [1001, 1001])", {}, { produtos: [1001, 1001] }),
      ed("repetido e outra ordem ([1001, 1002] → [1002, 1001, 1002])", { produtos: [1001, 1002] }, { produtos: [1002, 1001, 1002] }),
      ed("nome do fornecedor trocado", {}, { fornecedor_nome: "Distribuidora Beta" }),
      ed("código do fornecedor trocado", {}, { fornecedor_id: 777 }),
      ed("condição de pagamento", {}, { condicao_pagamento: "35 dias" }),
      ed("quantidade mínima", {}, { quantidade_minima: "20 caixas" }),
      ed("validade", {}, { validade: "2027-01-15" }),
      ed("observação", {}, { observacao: "arte com selo" }),
      ed("preço e custo descem juntos", {}, { preco_oferta: 11.99, custo_negociado: 9.5 }),
      ed("preço sobe e produto trocado juntos", {}, { preco_oferta: 13.49, produtos: [1006] }),
      ed("custo sobe e verba aumenta juntos", {}, { custo_negociado: 10.1, verba_valor: 150 }),
      ed("verba reduzida e bonificação aumentada juntas", BON, { verba_valor: 50, bonif_ganha: 2 }),
      ed("preço apagado e verba retirada juntos", {}, { preco_oferta: X, verba_valor: X, verba_qtd_base: X }),
      ed("preço desce e verba reduzida juntos", {}, { preco_oferta: 11.99, verba_valor: 60 }),
      tr("outra proposta igual (produtos, preço, custo, verba), outro fornecedor", {}, { fornecedor_nome: "Distribuidora Épsilon", fornecedor_id: 778 }),
      tr("outra proposta com outro produto", {}, { produtos: [1002] }),
      tr("outra proposta com preço maior", {}, { preco_oferta: 13.49 }),
      tr("outra proposta com preço menor", {}, { preco_oferta: 11.99 }),
      tr("outra proposta com custo maior", {}, { custo_negociado: 10.2 }),
      tr("outra proposta com custo menor", {}, { custo_negociado: 9.5 }),
      tr("outra proposta sem verba", {}, { verba_valor: X, verba_qtd_base: X }),
      tr("outra proposta sem preço de oferta", {}, { preco_oferta: X }),
      tr("outra proposta com os produtos em outra ordem", { produtos: [1001, 1002] }, { produtos: [1002, 1001] }),
      tr("outra proposta com custo 4 casas maior (2,2480 → 2,2489)", { custo_negociado: 2.248 }, { custo_negociado: 2.2489 }),
      tr("outra proposta com verba total maior e base maior (100/100 → 120/400)", {}, { verba_valor: 120, verba_qtd_base: 400 }),
      tr("outra proposta com bonificação menor", BON, { bonif_compra: 12 }),
      // mexer numa proposta que NÃO é a escolhida: o banco não faz nada com a vaga e a tela não avisa
      { nome: "editar uma proposta que NÃO é a escolhida (preço sobe)", acao: "editar_outra", antes: {}, outra: { fornecedor_nome: "Distribuidora Zeta" }, mud: { preco_oferta: 13.49 } },
      { nome: "descartar uma proposta que NÃO é a escolhida", acao: "descartar_outra", antes: {}, outra: { fornecedor_nome: "Distribuidora Zeta" } },
      { nome: "descartar a escolhida", acao: "descartar", antes: {} },
      { nome: "retirar a vaga", acao: "retirar", antes: {} },
      { nome: "descartar a escolhida e escolher outra do mesmo produto, preço menor", acao: "descartar_e_escolher", antes: {}, outra: { preco_oferta: 11.99, fornecedor_nome: "Distribuidora Gama" } },
      { nome: "descartar a escolhida e escolher outra com preço maior", acao: "descartar_e_escolher", antes: {}, outra: { preco_oferta: 13.49, fornecedor_nome: "Distribuidora Gama" } },
      { nome: "descartar a escolhida e escolher outra com outro produto", acao: "descartar_e_escolher", antes: {}, outra: { produtos: [1002], fornecedor_nome: "Distribuidora Gama" } }
    ];
    // a vaga em outros estados: o banco só reabre a APROVADA; no ar, crítica em qualquer estado
    const EST = [ed("preço sobe", {}, { preco_oferta: 13.49 }), tr("outra proposta com outro produto", {}, { produtos: [1002] })];
    const caso = (nome) => CASOS.find((c) => c.nome.indexOf(nome) === 0);
    const FDS = [caso("preço sobe"), caso("preço apagado"), caso("produto trocado")];
    // vaga SEM proposta retirada: a tela não chama o cálculo aqui (avisa pelo início do grupo)
    const VAZIA = { nome: "retirar a vaga sem proposta", acao: "retirar", antes: {} };

    const RUNS = [];
    const pega = (pool, rot) => { const v = pool.shift(); if (!v) throw new Error("faltou vaga no grupo '" + rot + "'"); return v; };
    CASOS.forEach((c, i) => {
      RUNS.push({ id: i, caso: c, modo: "antes", estado: "aprovada", vaga: pega(poolAntes, "antes") });
      RUNS.push({ id: i, caso: c, modo: "no_ar", estado: "aprovada", vaga: pega(poolNoAr, "no ar") });
    });
    FDS.forEach((c) => RUNS.push({ id: "fds", caso: c, modo: "grupo", estado: "aprovada", vaga: pega(poolGrupo, "ação de sexta a domingo") }));
    ["pendente", "aguardando_visto", "em_ajuste"].forEach((st) => EST.forEach((c) => ["antes", "no_ar"].forEach((modo) =>
      RUNS.push({ id: st, caso: c, modo, estado: st, vaga: pega(modo === "antes" ? poolAntes : poolNoAr, modo) }))));
    ["antes", "no_ar"].forEach((modo) => RUNS.push({ id: "vazia", caso: VAZIA, modo, estado: "vazia", vaga: pega(modo === "antes" ? poolAntes : poolNoAr, modo) }));
    RUNS.forEach((x, i) => {
      x.k = "r" + i;
      if (x.estado !== "vazia") x.propA = tirarNulos(Object.assign({}, BASE, x.caso.antes));
      if (x.caso.outra) x.propB = tirarNulos(Object.assign({}, x.propA, x.caso.outra));
    });

    // ---------- o preparo, em 20/09 (tudo antes do ar) ----------
    const reg1 = lote(MASTER, RUNS.filter((x) => x.propA).map((x) => ({ k: x.k, sql: `select public.encarte_registrar_proposta('${x.vaga.id}', ${lit(x.propA)})` }))
      .concat(RUNS.filter((x) => x.propB).map((x) => ({ k: x.k + "b", sql: `select public.encarte_registrar_proposta('${x.vaga.id}', ${lit(x.propB)})` }))));
    const falhasReg = Object.keys(reg1).filter((k) => !reg1[k].ok);
    RUNS.forEach((x) => { x.pa = x.propA ? reg1[x.k] && reg1[x.k].id : null; x.pb = x.propB ? reg1[x.k + "b"] && reg1[x.k + "b"].id : null; });
    const escA = lote(MASTER, RUNS.filter((x) => x.estado !== "pendente" && x.estado !== "vazia").map((x) => ({ k: x.k, sql: `select public.encarte_escolher_proposta('${x.vaga.id}', '${x.pa}')` })));
    const aprov = lote(MASTER, edIds.map((id, i) => ({ k: "ap" + i,
      sql: `select public.encarte_aprovar('${id}', null, (select versao from public.encarte_edicoes where id = '${id}'),
        ${lit(RUNS.filter((x) => x.estado === "em_ajuste" && x.vaga.edicao === id).map((x) => ({ vaga_id: x.vaga.id, categoria: "preco", observacao: "rever o preço" })))})` })));
    // pendente: escolhida DEPOIS da aprovação; aguardando visto: mudou o preço antes do ar
    const pos = lote(MASTER, RUNS.filter((x) => x.estado === "pendente").map((x) => ({ k: x.k, sql: `select public.encarte_escolher_proposta('${x.vaga.id}', '${x.pa}')` }))
      .concat(RUNS.filter((x) => x.estado === "aguardando_visto").map((x) => ({ k: x.k, sql: `select public.encarte_editar_proposta('${x.pa}', ${lit({ preco_oferta: 12.49 })})` }))));
    vale("b.0b preparo: " + RUNS.length + " vagas com proposta registrada, escolhida, aprovada (e as de outros estados montadas)",
      falhasReg.length === 0 && Object.values(escA).every((x) => x.ok) && Object.values(aprov).every((x) => x.ok) && Object.values(pos).every((x) => x.ok),
      [falhasReg.length + " registros falharam", JSON.stringify(Object.values(aprov).map((x) => (x.aprovadas || []).length + (x.detalhe ? "/" + x.detalhe : "")))].join(" · "));

    // ---------- as mudanças, em 06/10 ----------
    relogio(HOJE_ACAO);
    const dee = RUNS.filter((x) => x.caso.acao === "descartar_e_escolher");
    const passo1 = lote(MASTER, dee.map((x) => ({ k: x.k, sql: `select public.encarte_descartar_proposta('${x.pa}', 'fornecedor desistiu')` })));
    const vagaIds = RUNS.map((x) => x.vaga.id);
    const propIds = RUNS.map((x) => x.pa).concat(RUNS.map((x) => x.pb)).filter(Boolean);
    const retrato = () => suJ(`select jsonb_build_object(
        'vagas', (select jsonb_object_agg(v.id, jsonb_build_object('estado', v.estado, 'situacao', v.situacao, 'proposta_escolhida', v.proposta_escolhida,
                   'foto_aprovada', v.foto_aprovada, 'grupo_inicio', g.inicio, 'edicao_inicio', e.inicio, 'no_ar', public.encarte__no_ar(v.id)))
                   from public.encarte_vagas v join public.encarte_grupos g on g.id = v.grupo_id join public.encarte_edicoes e on e.id = v.edicao_id
                  where v.id = any(${uuids(vagaIds)})),
        'props', (select jsonb_object_agg(x.id, to_jsonb(x)) from (select ${COL_PROP} from public.encarte_propostas where id = any(${uuids(propIds)})) x),
        'max_ev', (select coalesce(max(id), 0) from public.encarte_eventos))`);
    const S1 = retrato();
    const esperadoS1 = (x) => x.estado === "vazia" ? "pendente" : x.estado !== "aprovada" ? x.estado : x.caso.acao === "descartar_e_escolher" && x.modo !== "no_ar" ? "aguardando_visto" : "aprovada";
    const foraS1 = RUNS.filter((x) => S1.vagas[x.vaga.id].estado !== esperadoS1(x)).map((x) => x.caso.nome + "/" + x.modo + "/" + x.estado + "=" + S1.vagas[x.vaga.id].estado);
    vale("b.0c em 06/10, antes de mexer: cada vaga no estado combinado (aprovada, pendente, aguardando visto, em ajuste)",
      foraS1.length === 0 && Object.values(passo1).every((x) => x.ok), foraS1.slice(0, 4).join(" ; ") || "todas");
    const noArDif = RUNS.filter((x) => {
      const vg = S1.vagas[x.vaga.id], iniTela = vg.grupo_inicio || vg.edicao_inicio;
      return (HOJE_ACAO >= iniTela) !== vg.no_ar || vg.no_ar !== (x.modo === "no_ar");
    }).map((x) => x.caso.nome + "/" + x.modo);
    eq("b.0d 'no ar' é o mesmo nos três: banco (encarte__no_ar), tela (início do GRUPO, senão da edição) e o combinado do caso",
      noArDif.join(" ; ") || "iguais", "iguais");

    const acaoSql = (x) => {
      switch (x.caso.acao) {
        case "editar": return `select public.encarte_editar_proposta('${x.pa}', ${lit(x.caso.envio || x.caso.mud)})`;
        case "escolher": case "descartar_e_escolher": return `select public.encarte_escolher_proposta('${x.vaga.id}', '${x.pb}')`;
        case "descartar": return `select public.encarte_descartar_proposta('${x.pa}', 'fornecedor desistiu')`;
        case "retirar": return `select public.encarte_retirar_vaga('${x.vaga.id}', 'faltou no fornecedor')`;
        case "editar_outra": return `select public.encarte_editar_proposta('${x.pb}', ${lit(x.caso.mud)})`;
        case "descartar_outra": return `select public.encarte_descartar_proposta('${x.pb}', 'não serve')`;
      }
    };
    const RESP = lote(MASTER, RUNS.map((x) => ({ k: x.k, sql: acaoSql(x) })));
    const S2 = suJ(`select jsonb_build_object(
        'vagas', (select jsonb_object_agg(v.id, jsonb_build_object('estado', v.estado, 'situacao', v.situacao, 'foto_aprovada', v.foto_aprovada,
                   'proposta_escolhida', v.proposta_escolhida)) from public.encarte_vagas v where v.id = any(${uuids(vagaIds)})),
        'props', (select jsonb_object_agg(x.id, to_jsonb(x)) from (select ${COL_PROP} from public.encarte_propostas where id = any(${uuids(propIds)})) x),
        'eventos', (select coalesce(jsonb_agg(jsonb_build_object('vaga_id', vaga_id, 'tipo', tipo, 'motivo', motivo) order by id), '[]')
                      from public.encarte_eventos where id > ${S1.max_ev} and tipo in ('critica_no_ar', 'vaga_reaberta')))`);
    const falhasAcao = RUNS.filter((x) => !RESP[x.k] || RESP[x.k].__falhou).map((x) => x.caso.nome + ": " + JSON.stringify(RESP[x.k]).slice(0, 120));
    vale("b.0e todas as " + RUNS.length + " mudanças foram aceitas pelo banco", falhasAcao.length === 0, falhasAcao.slice(0, 3).join(" | ") || "todas");

    // o motivo que o cálculo mostra → a razão que o banco grava
    const CHAVE_DO_MOTIVO = {
      "Produtos trocados": "produto_trocado", "Preço de oferta mudou": "preco_oferta_mudou", "Custo negociado subiu": "custo_subiu",
      "Verba reduzida ou retirada": "verba_reduziu", "Bonificação reduzida ou retirada": "verba_reduziu",
      "A proposta escolhida foi descartada": "proposta_descartada", "Preço anunciado subiu com o encarte no ar": "preco_subiu",
      "Preço anunciado apagado com o encarte no ar": "preco_apagado", "Produto trocado com o encarte no ar": "produto_trocado",
      "Vaga retirada com o encarte no ar": "vaga_retirada", "A proposta anunciada foi descartada com o encarte no ar": "produto_retirado"
    };
    const chavesDe = (motivos) => Array.from(new Set(motivos.map((m) => CHAVE_DO_MOTIVO[m] || "SEM_CHAVE(" + m + ")"))).sort();
    const chavesEvento = (motivo) => String(motivo || "").split(/\s*,\s*/).filter(Boolean).map((k) => k.replace(/^vaga_retirada:.*$/, "vaga_retirada"));

    // o que o BANCO fez com a vaga
    function oQueOBancoFez(x) {
      const a = S1.vagas[x.vaga.id], d = S2.vagas[x.vaga.id];
      const evs = S2.eventos.filter((e) => e.vaga_id === x.vaga.id);
      const reab = evs.filter((e) => e.tipo === "vaga_reaberta"), crit = evs.filter((e) => e.tipo === "critica_no_ar");
      const chaves = [];
      evs.forEach((e) => chavesEvento(e.motivo).forEach((k) => { razoesVistas.add(k); if (chaves.indexOf(k) < 0) chaves.push(k); }));
      const reabriu = reab.length > 0 && a.estado === "aprovada" && d.estado === "aguardando_visto";
      const resp = RESP[x.k] || {};
      // a resposta da função diz o mesmo que ela fez (a tela mostra a resposta)
      // (editar sem mudar nada devolve só mudou:false; retirar devolve só a crítica)
      const respBate = (resp.reabriu === undefined || resp.reabriu === reabriu) && (resp.critica === undefined || resp.critica === (crit.length > 0)) &&
        (resp.mudou === false || x.caso.acao === "retirar" || resp.reabriu !== undefined);
      const mudouEstado = a.estado !== d.estado;
      return { reabriu, critica: crit.length > 0, chaves: chaves.sort(), respBate, estadoSoMudouSeReabriu: mudouEstado === reabriu };
    }
    /* o que a TELA avisaria, pelo cálculo: a tela chama ENC.mudancaMaterial e só avisa
       "volta para Aguardando visto" com a vaga APROVADA e antes do ar; no ar, avisa crítica
       (tela.js: mm.critica || (mm.reabre && v.estado === "aprovada")) */
    function oQueOCalculoAvisa(x, lado) {
      const vg = S1.vagas[x.vaga.id];
      const o = { hoje: HOJE_ACAO, inicio: vg.grupo_inicio || vg.edicao_inicio };
      const A = x.pa ? S1.props[x.pa] : null;
      let mm = null;
      // retirar: a tela avisa a crítica pelo início do GRUPO (noArJa), sem o cálculo; com
      // proposta, o cálculo tem de dizer o mesmo (mudancaMaterial com depois = null)
      if (x.caso.acao === "retirar" && (lado === "tela" || !A)) {
        const noArJa = HOJE_ACAO >= o.inicio;
        return { reabriu: false, critica: noArJa, chaves: noArJa ? ["vaga_retirada"] : [] };
      }
      switch (x.caso.acao) {
        case "editar":
          mm = ENC.mudancaMaterial(A, lado === "tela" ? Object.assign({}, A, x.caso.mud) : S2.props[x.pa], o); break;
        case "escolher": mm = ENC.mudancaMaterial(A, S1.props[x.pb], o); break;
        case "descartar": mm = ENC.mudancaMaterial(A, { situacao: "descartada" }, o); break;
        case "retirar": mm = ENC.mudancaMaterial(A, null, o); break;
        // proposta que não é a escolhida: a tela nem chama o cálculo (v.proposta_escolhida === orig.id / eraEsc)
        case "editar_outra": case "descartar_outra": mm = null; break;
        case "descartar_e_escolher": {
          // como a tela: a escolhida (não há mais) ou, com a vaga aprovada, a foto aprovada
          const antes = vg.proposta_escolhida ? S1.props[vg.proposta_escolhida] : (vg.estado === "aprovada" ? vg.foto_aprovada : null);
          mm = antes ? ENC.mudancaMaterial(antes, S1.props[x.pb], o) : null; break;
        }
      }
      const reabre = !!mm && mm.reabre && vg.estado === "aprovada";
      const critica = !!mm && mm.critica;
      return { reabriu: reabre, critica, chaves: reabre || critica ? chavesDe(mm.motivos) : [] };
    }
    const desc = (r) => (r.reabriu ? "reabre" : r.critica ? "crítica" : "só registra") + (r.chaves.length ? "(" + r.chaves.join(",") + ")" : "");
    const julgar = (x) => {
      const b = oQueOBancoFez(x), c = oQueOCalculoAvisa(x, "banco"), t = oQueOCalculoAvisa(x, "tela");
      const igual = (u) => u.reabriu === b.reabriu && u.critica === b.critica && u.chaves.join(",") === b.chaves.join(",");
      return { b, c, t, bate: igual(c) && igual(t) && b.respBate && b.estadoSoMudouSeReabriu };
    };
    const MODO = { antes: "antes do ar", no_ar: "no ar", grupo: "edição no ar, ação de sexta ainda não" };
    const linha = (x, j) => MODO[x.modo] + ": banco " + desc(j.b) + (j.bate ? " = cálculo" : " × cálculo " + desc(j.c) + (x.caso.acao === "editar" || x.caso.acao === "retirar" ? " / tela " + desc(j.t) : "") +
      (j.b.respBate ? "" : " [resposta da função diz outra coisa: " + JSON.stringify(RESP[x.k]).slice(0, 100) + "]"));

    const porCaso = {};
    RUNS.filter((x) => x.estado === "aprovada" && x.modo !== "grupo").forEach((x) => { (porCaso[x.id] = porCaso[x.id] || []).push(x); });
    let n = 0;
    Object.keys(porCaso).forEach((i) => {
      const L = porCaso[i], js = L.map(julgar);
      n++;
      vale("b." + String(n).padStart(2, "0") + " " + L[0].caso.nome, js.every((j) => j.bate), L.map((x, k) => linha(x, js[k])).join(" · "));
    });
    RUNS.filter((x) => x.modo === "grupo").forEach((x) => {
      const j = julgar(x);
      vale("b.fds " + x.caso.nome + " — na PS de 05/10 (no ar), vaga da ação temática de sexta a domingo (só entra na sexta 09/10)", j.bate, linha(x, j));
    });
    // a edição PRÓPRIA do Final de semana de 09/10, antes do ar, com a PS 05/10 já no ar: o banco trata
    // as vagas dela pelo início DELA (sexta), e o que ele faz bate com o que o cálculo avisa
    const runsFds = RUNS.filter((x) => x.vaga.edicao === edFds);
    vale("b.fds2 edição própria do Final de semana (09/10, antes do ar, com a PS 05/10 no ar): " + runsFds.length + " casos, banco = cálculo, todos 'antes do ar'",
      runsFds.length >= 3 && runsFds.every((x) => x.modo === "antes" && S1.vagas[x.vaga.id].no_ar === false && julgar(x).bate),
      runsFds.map((x) => x.caso.nome + ": " + linha(x, julgar(x))).slice(0, 4).join(" · "));
    ["pendente", "aguardando_visto", "em_ajuste", "vazia"].forEach((st) => {
      const L = RUNS.filter((x) => x.estado === st), js = L.map(julgar);
      vale("b.est " + (st === "vazia" ? "vaga sem proposta: retirada no ar é crítica, antes do ar só registra" :
        "vaga " + st.replace("_", " ") + ": nunca reabre; no ar, crítica igual à da aprovada") + " — banco = tela", js.every((j) => j.bate),
        L.map((x, k) => x.caso.nome + " " + linha(x, js[k])).join(" · "));
    });
    const nPares = RUNS.filter((x) => x.estado === "aprovada").length;
    vale("b.total " + CASOS.length + " casos × (antes do ar, no ar) + 3 da ação de sexta = " + nPares + " pares antes/depois com a vaga aprovada (pedido: ≥ 60)", CASOS.length >= 60 && nPares >= 120, nPares);

    // A aba "Aprovado × atual" da tela (comparar, tirada do tela.js) sobre as vagas que o banco
    // REABRIU ou marcou CRÍTICA: tem de mostrar "Mudou", senão o master vê "Igual ao aprovado"
    // numa vaga que o banco mandou para "Aguardando visto" (ou gravou como crítica no ar).
    const comparar = daTela(["tem"], "comparar");
    const iguaisNaTela = [];
    RUNS.forEach((x) => {
      const d = S2.vagas[x.vaga.id], j = oQueOBancoFez(x);
      if (!(j.reabriu || j.critica) || !d.foto_aprovada || d.situacao !== "ativa") return;
      const atual = d.proposta_escolhida ? S2.props[d.proposta_escolhida] : null;
      if (!comparar(d.foto_aprovada, atual).length) iguaisNaTela.push(x.caso.nome + " (" + MODO[x.modo] + ": banco " + desc(j) + ")");
    });
    vale("b.tela1 aba 'Aprovado × atual': toda vaga que o banco reabriu ou marcou crítica aparece como 'Mudou' (e não 'Igual ao aprovado')",
      iguaisNaTela.length === 0, iguaisNaTela.length ? iguaisNaTela.length + " vaga(s) aparecem como 'Igual ao aprovado':" : "todas");
    iguaisNaTela.forEach((t) => console.log("          - " + t));

    // K7: a conta "no ar sem aprovação" da tela (pendentesNoAr, tirada do tela.js) sobre as linhas
    // do banco = as vagas ativas sem aprovação que o BANCO trata como no ar (encarte__no_ar)
    const pendentesNoAr = daTela(["ativa", "inicioGrupo"], "pendentesNoAr");
    const L7 = suJ(`select jsonb_agg(jsonb_build_object('ed', e, 'grupos', (select jsonb_agg(g) from public.encarte_grupos g where g.edicao_id = e.id),
        'vagas', (select jsonb_agg(jsonb_build_object('id', v.id, 'grupo_id', v.grupo_id, 'estado', v.estado, 'situacao', v.situacao)) from public.encarte_vagas v where v.edicao_id = e.id),
        'banco', (select count(*) from public.encarte_vagas v where v.edicao_id = e.id and v.situacao = 'ativa' and v.estado <> 'aprovada' and public.encarte__no_ar(v.id))) order by e.inicio)
        from public.encarte_edicoes e where e.id = any(${uuids(edIds)})`);
    const k7 = L7.map((x) => {
      const gPorId = {}; x.grupos.forEach((g) => { gPorId[g.id] = g; });
      return x.ed.titulo + ": tela " + pendentesNoAr(x.vagas, gPorId, x.ed, HOJE_ACAO) + " / banco " + x.banco;
    });
    vale("b.tela2 K7: 'no ar sem aprovação' da tela = vagas sem aprovação que o banco trata como no ar (as " + edIds.length + " edições, em 06/10)",
      L7.every((x) => { const gPorId = {}; x.grupos.forEach((g) => { gPorId[g.id] = g; }); return pendentesNoAr(x.vagas, gPorId, x.ed, HOJE_ACAO) === x.banco; }),
      k7.join(" · "));

  });

  // ======================================================================
  console.log("\n=== f. K10: vaga em ajuste — a tela diz 'esperando o comprador' exatamente quando o banco não aprova ===\n");
  secao(() => {
    relogio("2026-10-06");
    const esperando = daTela(["objeto"], "esperandoComprador");
    const rg = REGRAS.find((x) => x.id === "promocao-semanal"), m = MODELOS.find((x) => x.id === "promocao-semanal");
    const o = ENC.ocorrencias(rg.regra, "2026-11-02", "2026-11-02").find((x) => x.inicio === "2026-11-02");
    const cr = lote(MASTER, [{ k: "ed", sql: `select public.encarte_criar_edicao('promocao-semanal', '${o.inicio_regra}', '${o.inicio}', '${o.fim}', ${lit(ENC.prazosEdicao(m, o.inicio, o.fim))})` }]).ed;
    if (!cr || !cr.id) throw new Error("não criei a PS de 02/11: " + JSON.stringify(cr));
    const ED = cr.id;
    const vs = suJ(`select jsonb_agg(v.id order by g.ordem, v.ordem) from public.encarte_vagas v join public.encarte_grupos g on g.id = v.grupo_id where v.edicao_id = '${ED}'`).slice(0, 5);
    const MEX = ["nada", "descartar outra proposta", "registrar outra proposta", "editar a escolhida", "escolher de novo a mesma"];
    const P = { produtos: [1001], fornecedor_nome: "Distribuidora Alfa", custo_negociado: 9.8, preco_oferta: 12.99 };
    const r1 = lote(MASTER, vs.map((v, i) => ({ k: "a" + i, sql: `select public.encarte_registrar_proposta('${v}', ${lit(P)})` }))
      .concat([{ k: "b1", sql: `select public.encarte_registrar_proposta('${vs[1]}', ${lit(Object.assign({}, P, { fornecedor_nome: "Distribuidora Beta" }))})` }]));
    lote(MASTER, vs.map((v, i) => ({ k: "e" + i, sql: `select public.encarte_escolher_proposta('${v}', '${r1["a" + i].id}')` })));
    const dev = lote(MASTER, [{ k: "d", sql: `select public.encarte_aprovar('${ED}', null, (select versao from public.encarte_edicoes where id = '${ED}'),
        ${lit(vs.map((v) => ({ vaga_id: v, categoria: "preco", observacao: "rever" })))})` }]).d;
    const mex = lote(MASTER, [
      { k: "m1", sql: `select public.encarte_descartar_proposta('${r1.b1.id}', 'não serve')` },
      { k: "m2", sql: `select public.encarte_registrar_proposta('${vs[2]}', ${lit(Object.assign({}, P, { fornecedor_nome: "Distribuidora Gama", preco_oferta: 12.49 }))})` },
      { k: "m3", sql: `select public.encarte_editar_proposta('${r1.a3.id}', ${lit({ observacao: "revisei" })})` },
      { k: "m4", sql: `select public.encarte_escolher_proposta('${vs[4]}', '${r1.a4.id}')` }]);
    vale("f.0 PS 02/11: 5 vagas com proposta escolhida, todas devolvidas; depois cada uma recebe uma mexida diferente",
      !!dev && (dev.devolvidas || []).length === 5 && Object.values(mex).every((x) => x.ok), JSON.stringify([dev && dev.devolvidas && dev.devolvidas.length, Object.values(mex).map((x) => x.ok || x.detalhe)]));
    // o que a TELA mostra, com as linhas do banco
    const linhas = suJ(`select jsonb_object_agg(id, jsonb_build_object('estado', estado, 'devolucao', devolucao)) from public.encarte_vagas where id = any(${uuids(vs)})`);
    const tela = vs.map((v) => esperando(linhas[v]));
    // o que o BANCO faz na próxima aprovação
    const ap = lote(MASTER, [{ k: "ap", sql: `select public.encarte_aprovar('${ED}', null, (select versao from public.encarte_edicoes where id = '${ED}'), '[]'::jsonb)` }]).ap;
    const banco = vs.map((v) => !((ap && ap.aprovadas) || []).includes(v));
    eq("f.1 por mexida (" + MEX.join(" / ") + "): a tela diz 'esperando o comprador' = o banco deixa de fora da aprovação",
      MEX.map((n, i) => n + ": tela " + (tela[i] ? "esperando" : "revisada") + ", banco " + (banco[i] ? "não aprova" : "aprova")).join(" · "),
      MEX.map((n, i) => n + ": tela " + (banco[i] ? "esperando" : "revisada") + ", banco " + (banco[i] ? "não aprova" : "aprova")).join(" · "));
    eq("f.2 ... e é o K10: só registrar, editar ou escolher (inclusive a mesma) contam; descartar não", banco, [true, true, false, false, false]);
    eq("f.3 a resposta da aprovação conta as que ficaram esperando (em_ajuste_esperando) como a tela", ap && ap.em_ajuste_esperando, tela.filter(Boolean).length);
  });

  // ======================================================================
  console.log("\n=== e. Tela: toda razão que o banco grava tem rótulo em português ===\n");
  secao(() => {
    // as razões que o SQL escreve (seção 5) — lidas do próprio arquivo
    const doSql = new Set();
    ["encarte__razoes_reabre", "encarte__criticas", "encarte__consequencia", "encarte_retirar_vaga"].forEach((nome) => {
      const i = SQL.indexOf("create or replace function public." + nome + "(");
      const corpo = i < 0 ? "" : SQL.slice(i, SQL.indexOf("end $$;", i));
      (corpo.match(/array_append\(r, '([a-z_]+)'\)/g) || []).forEach((m) => doSql.add(m.match(/'([a-z_]+)'/)[1]));
      (corpo.match(/array\['([a-z_]+)'\]/g) || []).forEach((m) => doSql.add(m.match(/'([a-z_]+)'/)[1]));
      (corpo.match(/'(vaga_retirada): '/g) || []).forEach(() => doSql.add("vaga_retirada"));
    });
    const todas = Array.from(new Set(Array.from(doSql).concat(Array.from(razoesVistas)))).sort();
    eq("e.1 o SQL escreve 9 razões e o teste viu o banco gravar " + razoesVistas.size + " delas", [doSql.size, razoesVistas.size >= 8], [9, true]);
    const semRotulo = todas.filter((k) => !RAZOES[k]);
    eq("e.2 cada uma tem rótulo no mapa RAZOES da tela (" + todas.join(", ") + ")", semRotulo.join(",") || "todas", "todas");
    const emIngles = todas.filter((k) => RAZOES[k] && /[_]/.test(RAZOES[k]));
    eq("e.3 ... e o rótulo é texto para gente (sem a chave crua)", emIngles.join(",") || "todos", "todos");
    // a regra do aviso, nos dois lugares em que a tela avisa antes de gravar
    const regra = (TELA.match(/mm\.critica \|\| \(mm\.reabre && v\.estado === "aprovada"\)/g) || []).length;
    eq("e.4 a tela avisa como o banco decide: crítica no ar, 'volta para Aguardando visto' só com a vaga aprovada (editar e escolher)", regra, 2);
  });
} catch (e) {
  console.log("\n  FALHA | o teste parou no meio: " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e));
  falhou++;
} finally {
  B.derrubar(pg);
  try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (e) {}
}

console.log("\n" + (falhou ? "FALHOU" : "PASSOU") + " — " + ok + " conferências OK, " + falhou + " falha(s).");
process.exit(falhou ? 1 : 0);
