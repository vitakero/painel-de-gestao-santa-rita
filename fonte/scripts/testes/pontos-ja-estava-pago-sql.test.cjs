// ============================================================
// BANCADA DO SQL DO "JÁ ESTAVA PAGO" — num Postgres de VERDADE (pglite), não no papel.
//
// Em 17/10/2026 ele clicou no botão novo, a parcela apareceu paga e voltou sozinha segundos
// depois. Não era o botão: era o gatilho pontos__trava_pagamento (de 30/09) desfazendo, EM
// SILÊNCIO, toda parcela que vira "paga" sem passar por uma função que conferiu a senha. O
// painel gravava, o banco aceitava sem reclamar e reescrevia por cima.
//
// Este teste REPRODUZ aquilo (prova 1) e prova que a porta nova atravessa a trava só pelo que
// ela mesma autorizou. Roda o plpgsql de verdade — "a sintaxe está certa" não diz nada sobre
// o miolo, que é onde o erro mora (lição de 15/08/2026).
//
//   node scripts/testes/pontos-ja-estava-pago-sql.test.cjs
// ============================================================
const fs = require("fs");
const path = require("path");
const RAIZ = path.join(__dirname, "..", "..");

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + obtido + (bate ? "" : "   (esperado: " + esperado + ")"));
  bate ? ok++ : falhou++;
}

// recorta do arquivo de verdade só os pedaços de que precisamos (as funções __ e o gatilho)
function recorta(arquivo, de, ate) {
  const t = fs.readFileSync(path.join(RAIZ, "sql", arquivo), "utf8");
  const i = t.indexOf(de), f = ate ? t.indexOf(ate) : t.length;
  if (i < 0) throw new Error("não achei '" + de + "' em " + arquivo);
  return t.slice(i, f > 0 ? f : t.length);
}

(async () => {
  const { PGlite } = require("@electric-sql/pglite");
  const db = new PGlite();
  const q = (sql, p) => db.query(sql, p);

  // ---- o mundo mínimo em volta: o que o Supabase dá e aqui não existe ----
  await db.exec(`
    create role anon; create role authenticated;   -- só existem no Supabase; aqui, para os revoke passarem
    create schema if not exists auth;
    create table auth.users (id uuid primary key, email text);
    create or replace function auth.uid() returns uuid language sql stable as
      $$ select current_setting('teste.uid', true)::uuid $$;
    create table public.perfis (id uuid primary key, nome text);
    create or replace function public.pode_pagina(p text) returns boolean language sql stable as
      $$ select coalesce(current_setting('teste.pode', true), 'true')::boolean $$;
    create or replace function public.eh_master() returns boolean language sql stable as
      $$ select false $$;
    create table public.pontos_extras (
      id text primary key, numero int, abertura text, vencimento text, valor numeric,
      pagamento text, fornecedor text, manuais jsonb, comprovantes jsonb, remarcacoes jsonb,
      atualizado_em timestamptz default now());
    create table public.pix_cobrancas (
      id serial primary key, ponto_id text, parcela_key text, status text);
    create table public.pontos_pagamentos_apagados (
      id serial primary key, ponto_id text, manuais jsonb, comprovantes jsonb,
      apagado_por uuid, quando timestamptz default now());
  `);

  // ---- as peças DE VERDADE do arquivo da senha: helpers + o gatilho da trava ----
  await db.exec(recorta("pontos_pagamento_com_senha.sql",
    "create or replace function public.pontos__js_verdade",
    "-- quem está autorizando"));

  // ---- e o arquivo novo, inteiro (sem o bloco que confere pré-requisitos do Supabase) ----
  const novo = fs.readFileSync(path.join(RAIZ, "sql", "pontos_ja_estava_pago.sql"), "utf8");
  await db.exec(novo.slice(novo.indexOf("create or replace function public.pontos__quem_simples")));

  const UID = "11111111-2222-3333-4444-555555555555";
  await q("insert into auth.users values ($1,$2)", [UID, "financeiro@loja"]);
  await q("insert into public.perfis values ($1,$2)", [UID, "Financeiro da Loja"]);
  await db.exec(`select set_config('teste.uid', '${UID}', false);`);

  const HOJE = new Date();
  const diasAtras = (n) => { const d = new Date(HOJE); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
  const daquiA = (n) => { const d = new Date(HOJE); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const VENCIDA = diasAtras(40), VENCIDA2 = diasAtras(10), FUTURA = daquiA(20);

  async function novoPonto(id, extra) {
    await q("delete from public.pontos_extras where id=$1", [id]);
    await q("insert into public.pontos_extras (id,numero,valor,pagamento,fornecedor,manuais,comprovantes,remarcacoes) values ($1,1,400,$2,'FORNECEDOR',$3,$4,$5)",
      [id, (extra && extra.pagamento) || "Boleto", (extra && extra.manuais) || null,
       (extra && extra.comprovantes) || null, (extra && extra.remarcacoes) || null]);
  }
  const manuaisDe = async (id) => (await q("select manuais from public.pontos_extras where id=$1", [id])).rows[0].manuais;
  const chamar = async (id, parcelas) =>
    (await q("select public.pontos_marcar_ja_pago($1,$2) as r", [id, parcelas])).rows[0].r;

  console.log("1) O DEFEITO QUE ELE VIU — gravar direto não cola (a trava desfaz calada)");
  await novoPonto("t1");
  await q(`update public.pontos_extras set manuais = $2 where id=$1`,
    ["t1", JSON.stringify({ [VENCIDA]: { t: "retro", st: "autorizado", quem: "Victor" } })]);
  const depoisDireto = await manuaisDe("t1");
  eq("   o UPDATE não dá erro nenhum", true, true);
  eq("   mas a marcação SUMIU (é o que ele viu na tela)",
     depoisDireto && depoisDireto[VENCIDA] ? "ficou" : "sumiu", "sumiu");

  console.log("\n2) pela porta nova, a marcação FICA");
  await novoPonto("t2");
  const r2 = await chamar("t2", [VENCIDA]);
  eq("   a função diz que marcou 1", r2.n, 1);
  const m2 = await manuaisDe("t2");
  eq("   e o banco guardou", m2 && m2[VENCIDA] ? "ficou" : "sumiu", "ficou");
  eq("   com o carimbo certo", m2[VENCIDA].t, "retro");
  eq("   e o nome de quem clicou", m2[VENCIDA].quem, "Financeiro da Loja");

  console.log("\n3) o lote: várias de uma vez, e só as que podem");
  await novoPonto("t3");
  const r3 = await chamar("t3", [VENCIDA, VENCIDA2, FUTURA]);
  eq("   marcou as 2 vencidas", r3.n, 2);
  eq("   e recusou a futura", r3.recusados[FUTURA], "ainda_nao_venceu");

  console.log("\n4) as travas, uma a uma");
  // monta o "já pago" pela própria porta (inserir já pago é REBAIXADO pelo gatilho — e é certo
  // que seja: linha nova dizendo que a parcela está paga, sem foto que confirme, não vale)
  await novoPonto("t4");
  await chamar("t4", [VENCIDA]);
  eq("   parcela já paga: recusa na segunda vez", (await chamar("t4", [VENCIDA])).recusados[VENCIDA], "ja_esta_paga");

  await novoPonto("t5");
  await q("insert into public.pix_cobrancas (ponto_id,parcela_key,status) values ($1,$2,'gerado')", ["t5", VENCIDA]);
  eq("   boleto de pé no banco: recusa", (await chamar("t5", [VENCIDA])).recusados[VENCIDA], "boleto_de_pe");

  await novoPonto("t6", { manuais: JSON.stringify({ [VENCIDA]: { t: "manual", st: "pendente", motivo: "pix" } }) });
  eq("   pedido esperando o master: recusa", (await chamar("t6", [VENCIDA])).recusados[VENCIDA], "tem_pedido_aguardando");

  await novoPonto("t7", { pagamento: "Bonificação" });
  eq("   bonificação: recusa o ponto inteiro", (await chamar("t7", [VENCIDA])).erro, "bonificacao_tem_fluxo_proprio");

  // a data que vale é a REMARCADA: parcela vencida, mas adiada para o futuro, não é passado
  await novoPonto("t8", { remarcacoes: JSON.stringify({ [VENCIDA]: { st: "autorizado", data: FUTURA } }) });
  eq("   vencida mas REMARCADA pra frente: recusa", (await chamar("t8", [VENCIDA])).recusados[VENCIDA], "ainda_nao_venceu");

  eq("   data sem forma de data: recusa", (await chamar("t2", ["01/08/2026"])).recusados["01/08/2026"], "data_invalida");
  eq("   ponto que não existe: recusa", (await chamar("naoexiste", [VENCIDA])).erro, "nao_encontrado");

  console.log("\n5) quem não tem a página não passa");
  await db.exec(`select set_config('teste.pode', 'false', false);`);
  eq("   sem a página 'pontos': recusa", (await chamar("t2", [VENCIDA2])).erro, "sem_permissao");
  await db.exec(`select set_config('teste.pode', 'true', false);`);

  console.log("\n6) desfazer");
  await novoPonto("t9");
  await chamar("t9", [VENCIDA]);
  const d1 = (await q("select public.pontos_desfazer_ja_pago($1,$2) as r", ["t9", VENCIDA])).rows[0].r;
  eq("   desfaz o que este botão criou", d1.ok, true);
  const m9 = await manuaisDe("t9");
  eq("   e a parcela volta a ficar em aberto", m9 && m9[VENCIDA] ? "ficou" : "saiu", "saiu");

  // pagamento de VERDADE (autorizado com senha) não pode ser desfeito por esta porta
  await novoPonto("t10");
  // põe um pagamento AUTORIZADO COM SENHA do jeito que a função da senha põe: com o passe livre.
  // (inserir direto não serve — o gatilho rebaixa para "Aguardando", como deve.)
  await db.exec(`select set_config('app.pontos_pagamento','1',false);`);
  await q("update public.pontos_extras set manuais=$2 where id=$1",
    ["t10", JSON.stringify({ [VENCIDA]: { t: "manual", st: "autorizado", motivo: "pix", quem: "X" } })]);
  await db.exec(`select set_config('app.pontos_pagamento','0',false);`);
  const d2 = (await q("select public.pontos_desfazer_ja_pago($1,$2) as r", ["t10", VENCIDA])).rows[0].r;
  eq("   mas NÃO desfaz pagamento autorizado com senha", d2.erro, "nao_foi_marcada_assim");
  const m10 = await manuaisDe("t10");
  eq("   e ele continua lá", m10[VENCIDA].st, "autorizado");

  console.log("\n7) a trava continua de pé para o resto");
  await novoPonto("t11");
  await q(`update public.pontos_extras set manuais = $2 where id=$1`,
    ["t11", JSON.stringify({ [VENCIDA]: { t: "manual", st: "autorizado", motivo: "inventado" } })]);
  const m11 = await manuaisDe("t11");
  eq("   marcar 'pago por fora' direto no banco continua sendo desfeito",
     m11 && m11[VENCIDA] ? "passou" : "barrado", "barrado");

  console.log("\n" + ok + " OK, " + falhou + " falha(s).");
  process.exit(falhou ? 1 : 0);
})().catch(e => { console.log("ERRO NA BANCADA: " + e.message); process.exit(1); });
