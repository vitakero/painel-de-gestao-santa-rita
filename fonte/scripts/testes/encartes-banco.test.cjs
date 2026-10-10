// ============================================================
// PLANEJAMENTO DE ENCARTES — O LADO DO BANCO, provado num PostgreSQL TEMPORÁRIO.
//
// Sobe um Postgres 16 de verdade (pasta temporária, só por soquete — não abre porta,
// então não disputa porta com nada), monta um esboço do Supabase (papéis com as
// permissões padrão que o Supabase dá a tabela nova, auth.uid() lido do JWT, perfis,
// contas do Portal) e COPIA as funções de permissão dos arquivos reais de sql/.
// Roda sql/encartes_v1.sql várias vezes (vazio, 2ª, e 3ª a 5ª com dado dentro) e prova,
// chamando as funções com dado dentro:
//   - cada papel dos DOIS lados (fecha para quem não pode E abre para quem pode);
//   - o fluxo inteiro: edição → propostas → escolha → aprovação com devolução →
//     mudança antes do ar (reabre só a vaga) → versão mudou → no ar (crítica, não reabre);
//   - o livro que só cresce, o retrato do VR (NULO nunca vira 0), a busca com teto;
//   - a criação de edição só aceita a ocorrência VERDADEIRA com os prazos do modelo
//     (quem só lê não forja datas nem "sem penalidade"), e todas as edições de 2026 a
//     2028 calculadas pelo scripts/encartes/calculo.cjs continuam passando;
//   - ==FDSPROPRIO== o Final de semana de ofertas como promoção própria (10/10/2026):
//     edição dele de sexta a domingo (1 grupo, 6 vagas), PS sem o grupo (36 vagas), PS
//     antiga já migrada (grupo removido, vagas retiradas) contando 36, e o item 15 da
//     conferência pegando quem rodar este arquivo no lugar da migração (seção 17);
//   - um grupo com "periodo" no modelo (grupo de TESTE, transação desfeita) vira o
//     inicio/fim do grupo na edição igual ao ENC.periodoGrupo (2.6a a 2.6e). Prova de que
//     pega erro: ENCARTES_SQL_TESTADO=<cópia com v_ini/v_fim nulos> faz o 2.6b e o 2.6d falharem.
//
// RELÓGIO DO TESTE: depois de conferir que o "hoje" do módulo é o dia de Caicó, o teste
// FIXA o hoje do banco (troca encarte_hoje() só neste Postgres temporário) numa terça,
// 06/10/2026, e a data de implantação no mesmo dia. Assim os cenários (uma Promoção
// Semanal no ar com uma ação de sexta a domingo ainda por vir, uma edição de semana passada etc.)
// usam datas VERDADEIRAS das regras e dão o mesmo resultado em qualquer dia em que o
// teste rodar. As rodadas finais do arquivo devolvem o relógio de verdade.
// No fim derruba o banco e apaga a pasta.
//
//   node scripts/testes/encartes-banco.test.cjs
//
// NÃO encosta no Supabase de produção. Nomes e produtos daqui são INVENTADOS.
// ============================================================
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const B = require("./apoio/banco-de-teste.cjs");
const RAIZ = path.join(__dirname, "..", "..");
// as datas e os prazos que a tela manda vêm DAQUI (a mesma conta, sem cópia)
const ENC = require(path.join(RAIZ, "scripts", "encartes", "calculo.cjs"));
const PSQL = "/opt/homebrew/opt/postgresql@16/bin/psql";
const AMB = Object.assign({}, process.env, { LC_ALL: "C", LANG: "C" });

if (!B.temPostgres()) {
  console.log("SEM POSTGRES LOCAL — instale com: brew install postgresql@16");
  process.exit(1);
}

// ---------- gente (inventada) ----------
const U = {
  master:     "e1000000-0000-4000-8000-000000000001", // master liberado
  comprador:  "e1000000-0000-4000-8000-000000000002", // encartes + encartes_comprador
  comprador2: "e1000000-0000-4000-8000-000000000003", // SÓ encartes_comprador
  leitura:    "e1000000-0000-4000-8000-000000000004", // só encartes
  calendario: "e1000000-0000-4000-8000-000000000005", // só calendario
  forasteiro: "e1000000-0000-4000-8000-000000000006", // liberado, mas só agenda
  bloqueado:  "e1000000-0000-4000-8000-000000000007", // aprovado=false, com as páginas
  fornecedor: "e1000000-0000-4000-8000-000000000008", // conta do Portal, com as páginas
  masterBloq: "e1000000-0000-4000-8000-000000000009", // master com aprovado=false
  semFicha:   "e1000000-0000-4000-8000-000000000010"  // logado sem ficha em perfis
};

let ok = 0, falhou = 0;
const pg = B.subir();
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "encartes-banco-"));

// ---------- como conversar com o banco ----------
function rodar(sql) {
  const r = spawnSync(PSQL, ["-X", "-h", pg.sock, "-U", "bancada", "-d", "fardamento", "-v", "ON_ERROR_STOP=1",
    "-v", "VERBOSITY=verbose", "-t", "-A", "-q", "-c", sql], { encoding: "utf8", env: AMB });
  return lerResultado(r);
}
function rodarArquivo(arq) {
  const r = spawnSync(PSQL, ["-X", "-h", pg.sock, "-U", "bancada", "-d", "fardamento", "-v", "ON_ERROR_STOP=1",
    "-v", "VERBOSITY=verbose", "-t", "-A", "-q", "-f", arq], { encoding: "utf8", env: AMB });
  return lerResultado(r);
}
function lerResultado(r) {
  const res = { ok: r.status === 0, saida: (r.stdout || "").trim(), erro: (r.stderr || "").trim() };
  if (!res.ok) {
    const m = res.erro.match(/ERROR:\s+([0-9A-Z]{5}):\s+([^\n]*)/);
    res.codigo = m ? m[1] : null;
    res.msg = m ? m[2] : res.erro.split("\n")[0];
    const d = res.erro.match(/\nDETAIL:\s+([^\n]*)/); res.detalhe = d ? d[1] : null;
    const h = res.erro.match(/\nHINT:\s+([^\n]*)/); res.dica = h ? h[1] : null;
  }
  return res;
}
// uma sessão de gente: papel do Supabase + quem está logado (auth.uid() lê o JWT)
function com(uid, sql, papel) {
  const quem = uid ? `select set_config('request.jwt.claim.sub','${uid}',true) is null;` : "";
  return rodar(`begin; set local role ${papel || "authenticated"}; ${quem} ${sql}; commit;`);
}
const ultima = (r) => (r.ok ? r.saida.split("\n").pop() : "ERRO SQL: " + r.msg);
const val = (uid, sql) => ultima(com(uid, sql));
function paraJson(r) {
  if (!r.ok) return { __falhou: true, codigo: r.codigo, detalhe: r.detalhe, msg: r.msg, dica: r.dica };
  try { return JSON.parse(r.saida.split("\n").pop()); } catch (e) { return { __falhou: true, msg: "não é JSON: " + r.saida.slice(0, 200) }; }
}
const jc = (uid, sql) => paraJson(com(uid, sql));
// como o dono do banco (SQL Editor): sem papel de login
const su = (sql) => rodar(sql);
const suV = (sql) => ultima(su(sql));
const suJ = (sql) => paraJson(su(sql));
const lit = (o) => "$j$" + JSON.stringify(o) + "$j$::jsonb";
const q = (s) => (s === null || s === undefined ? "null" : "'" + String(s).replace(/'/g, "''") + "'");

// ---------- como julgar ----------
function eq(nome, obtido, esperado) {
  const a = typeof obtido === "object" ? JSON.stringify(obtido) : String(obtido);
  const b = typeof esperado === "object" ? JSON.stringify(esperado) : String(esperado);
  const bate = a === b;
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + a.slice(0, 150) + (bate ? "" : "   (esperado: " + b.slice(0, 150) + ")"));
  bate ? ok++ : falhou++;
}
function vale(nome, cond, det) {
  console.log((cond ? "  OK   " : "  FALHA") + " | " + nome + (det !== undefined ? "  ->  " + String(det).slice(0, 180) : ""));
  cond ? ok++ : falhou++;
}
// recusa esperada: confere a chave estável (DETAIL) e, se pedido, o errcode
function recusa(nome, r, detalhe, codigo) {
  const falhouMesmo = r && (r.__falhou || r.ok === false);
  if (!falhouMesmo) { console.log("  FALHA | " + nome + "  ->  DEIXOU PASSAR: " + JSON.stringify(r).slice(0, 150)); falhou++; return; }
  const cod = r.codigo, det = r.detalhe;
  const bate = (detalhe ? det === detalhe : true) && (codigo ? cod === codigo : true);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + cod + " / " + det + " / " + String(r.msg).slice(0, 90) +
    (bate ? "" : "   (esperado: " + (codigo || "?") + " / " + (detalhe || "?") + ")"));
  bate ? ok++ : falhou++;
}
const negado = (nome, r) => recusa(nome, r, null, "42501");

// ---------- as funções de permissão, copiadas dos arquivos REAIS ----------
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

// datas relativas ao "hoje da loja" do próprio banco (depois da seção 0, o relógio fixo)
let HOJE = null, IMPL = null;
const HOJE_FIXO = "2026-10-06"; // uma TERÇA: a PS de ontem está no ar e a sexta dela (09/10) ainda não
const somar = (base, n) => { const d = new Date(base + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dia = (n) => somar(HOJE, n);
const br = (iso) => iso.split("-").reverse().join("/");
const prazos = (c, d, a, extra) => Object.assign({ comecar: c, definir: d, aprovar: a }, extra || {});
const copia = (o) => JSON.parse(JSON.stringify(o));
// objeto com as chaves em ordem (o jsonb devolve as chaves na ordem dele)
const canon = (o) => (o && typeof o === "object" && !Array.isArray(o)
  ? JSON.stringify(Object.keys(o).sort().reduce((a, k) => { a[k] = o[k]; return a; }, {})) : JSON.stringify(o));
// Black Friday: a regra certa (dia seguinte à 4ª quinta de novembro) e a antiga (última sexta)
const REGRA_BF_NOVA = { tipo: "anual_nth", mes: 11, n: 4, dia_semana: 4, deslocamento_dias: 1, duracao_dias: 1 };
const REGRA_BF_VELHA = { tipo: "anual_ultimo", mes: 11, dia_semana: 5, duracao_dias: 1 };
const criarEd = (uid, camp, ini, fim, pz, iniRegra) =>
  jc(uid, `select public.encarte_criar_edicao(${q(camp)}, ${q(iniRegra || ini)}, ${q(ini)}, ${q(fim)}, ${lit(pz)})`);
// o relógio do banco: troca encarte_hoje() SÓ neste Postgres temporário (ver o topo)
const corpoRelogio = (iso) => `create or replace function public.encarte_hoje() returns date language sql stable
  set search_path = public as $f$ select '${iso}'::date $f$;`;
function relogio(iso) {
  const r = su(corpoRelogio(iso));
  if (!r.ok) throw new Error("não fixei o relógio: " + r.msg);
}
// campanhas e modelos COMO ESTÃO NO BANCO (o ponto de partida do SQL), para o calculo.cjs
let REGRAS = [], MODELOS = [];
function lerRegrasModelos() {
  REGRAS = suJ(`select jsonb_agg(to_jsonb(r) order by r.id) from public.calendario_regras r`);
  MODELOS = suJ(`select jsonb_agg(to_jsonb(m) order by m.id) from public.encarte_modelos m`);
}
// a ocorrência VERDADEIRA da campanha que começa em "ini", com os prazos que a tela manda
// (calculo.cjs: ocorrencias + prazosEdicao, a mesma conta de edicoesParaCriar)
function real(camp, ini) {
  const r = REGRAS.find((x) => x.id === camp);
  const m = MODELOS.find((x) => x.tipo === "edicao" && x.campanha_id === camp && x.ativo !== false);
  const o = r && ENC.ocorrencias(r.regra, ini, ini).find((x) => x.inicio === ini);
  if (!o || !m) throw new Error(camp + " não tem ocorrência que começa em " + ini);
  return { campanha: camp, inicio: o.inicio, fim: o.fim, inicio_regra: o.inicio_regra, prazos: ENC.prazosEdicao(m, o.inicio, o.fim) };
}
const criarReal = (uid, e, pz) => criarEd(uid, e.campanha, e.inicio, e.fim, pz || e.prazos, e.inicio_regra);
const vagaDe = (ed, grupo, nome) => suV(`select v.id from public.encarte_vagas v join public.encarte_grupos g on g.id = v.grupo_id
  where v.edicao_id = '${ed}' and g.chave = '${grupo}' and v.nome = ${q(nome)} and v.origem = 'modelo'`);
const grupoDe = (ed, chave) => suV(`select id from public.encarte_grupos where edicao_id = '${ed}' and chave = '${chave}'`);
const reg = (uid, vaga, p) => jc(uid, `select public.encarte_registrar_proposta('${vaga}', ${lit(p)})`);
const edt = (uid, prop, p) => jc(uid, `select public.encarte_editar_proposta('${prop}', ${lit(p)})`);
const esc = (uid, vaga, prop) => jc(uid, `select public.encarte_escolher_proposta('${vaga}', '${prop}')`);
const apr = (uid, ed, grupo, versao, devs) =>
  jc(uid, `select public.encarte_aprovar('${ed}', ${grupo ? "'" + grupo + "'" : "null"}, ${versao === null ? "null" : versao}, ${lit(devs || [])})`);
const versaoDe = (ed) => Number(suV(`select versao from public.encarte_edicoes where id = '${ed}'`));
const estadoDe = (vaga) => suV(`select estado from public.encarte_vagas where id = '${vaga}'`);
// jsonb_agg: numa linha só (json_agg quebra linha entre os itens)
const eventos = (filtro) => suJ(`select coalesce(jsonb_agg(to_jsonb(e) order by e.id), '[]') from public.encarte_eventos e where ${filtro}`);
const contaEv = (filtro) => Number(suV(`select count(*) from public.encarte_eventos e where ${filtro}`));

// vários blocos AO MESMO TEMPO, cada um numa sessão psql própria (concorrência de verdade)
function aoMesmoTempo(blocos) {
  let script = "";
  blocos.forEach((sql, i) => {
    const f = path.join(DIR, "par" + i + ".sql");
    fs.writeFileSync(f, sql);
    script += `("${PSQL}" -X -h "${pg.sock}" -U bancada -d fardamento -v ON_ERROR_STOP=1 -t -A -q -f "${f}" > "${f}.out" 2> "${f}.err") & `;
  });
  spawnSync("bash", ["-c", script + "wait"], { env: AMB });
  return blocos.map((_, i) => {
    const f = path.join(DIR, "par" + i + ".sql");
    return { saida: fs.readFileSync(f + ".out", "utf8"), erro: fs.readFileSync(f + ".err", "utf8") };
  });
}

// instala encartes_v1.sql com check_function_bodies ligado e devolve as linhas da conferência.
// ENCARTES_SQL_TESTADO=/caminho/copia.sql troca o arquivo instalado por uma CÓPIA (só para provar
// que o teste pega erro: estraga-se a cópia, nunca o sql/ do projeto). Sem ela, o arquivo real.
const SQL_TESTADO = process.env.ENCARTES_SQL_TESTADO || path.join(RAIZ, "sql", "encartes_v1.sql");
if (process.env.ENCARTES_SQL_TESTADO) console.log("ATENÇÃO: instalando a CÓPIA " + SQL_TESTADO + " (não o sql/encartes_v1.sql)");
function instalar() {
  const f = path.join(DIR, "instalar.sql");
  fs.writeFileSync(f, "set check_function_bodies = on;\n\\i " + SQL_TESTADO + "\n");
  const r = rodarArquivo(f);
  const linhas = r.saida.split("\n").filter((l) => /^\d+\|/.test(l));
  return { r, linhas };
}
const contagens = () => suV(`select json_build_object(
  'regras', (select count(*) from public.calendario_regras),
  'modelos', (select count(*) from public.encarte_modelos),
  'hist_modelos', (select count(*) from public.encarte_modelos_historico),
  'hist_regras', (select count(*) from public.calendario_regras_historico),
  'politicas', (select count(*) from pg_policies where schemaname = 'public' and (tablename like 'encarte_%' or tablename like 'calendario_regras%')),
  'gatilhos', (select count(*) from pg_trigger where not tgisinternal and tgfoid = 'public.encarte_livro_so_cresce()'::regprocedure),
  'config', (select count(*) from public.encarte_config),
  'implantado_em', (select valor #>> '{}' from public.encarte_config where chave = 'implantado_em'))`);

try {
  // ======================================================================
  console.log("\n=== 0. Instalação: esboço do Supabase + funções de permissão REAIS + encartes_v1.sql 2× ===\n");
  let esboco;
  try {
    esboco = fs.readFileSync(path.join(__dirname, "apoio", "encartes-esboco-supabase.sql"), "utf8") + "\n" +
      extrair("permissoes_padrao.sql", "pode_pagina") + "\n" +
      extrair("recibos_domingo.sql", "sou_master") + "\n" +
      extrair("central_interruptor_leitura.sql", "eh_da_casa_aprovado") + "\n";
    vale("0.1 funções de permissão copiadas de sql/permissoes_padrao, recibos_domingo e central_interruptor_leitura", true);
  } catch (e) { vale("0.1 funções de permissão copiadas dos arquivos reais", false, e.message); throw e; }
  fs.writeFileSync(path.join(DIR, "esboco.sql"), esboco);
  let r = rodarArquivo(path.join(DIR, "esboco.sql"));
  if (!r.ok) { console.log("esboço falhou:\n" + r.erro); throw new Error("esboço"); }

  // sem as funções de permissão o arquivo tem de parar com aviso claro (e não criar nada)
  const inst1 = instalar();
  vale("0.2 1ª rodada compilou e rodou inteira (check_function_bodies ligado)", inst1.r.ok, inst1.r.ok ? "" : inst1.r.erro.split("\n").slice(0, 6).join(" | "));
  eq("0.3 1ª rodada: conferência tem 15 itens", inst1.linhas.length, 15);
  vale("0.4 1ª rodada: conferência diz OK em tudo", inst1.linhas.length === 15 && inst1.linhas.every((l) => /\|OK( - .*)?$/.test(l)),
    inst1.linhas.filter((l) => !/\|OK( - .*)?$/.test(l)).join(" ; ") || "todos OK");

  HOJE = suV("select public.encarte_hoje()");
  IMPL = suV("select ((valor #>> '{}')::timestamptz at time zone 'America/Fortaleza')::date from public.encarte_config where chave = 'implantado_em'");
  eq("0.5 'hoje' do módulo é o dia em Caicó (fuso America/Fortaleza), não o UTC do servidor",
    HOJE, suV("select (now() at time zone 'America/Fortaleza')::date"));
  const antes2 = contagens();

  // ---------- gente ----------
  su(`insert into public.perfis (id, nome, is_master, paginas, aprovado) values
    ('${U.master}',     'Dono Teste',       true,  '[]', true),
    ('${U.comprador}',  'Comprador Um',     false, '["encartes","encartes_comprador"]', true),
    ('${U.comprador2}', 'Comprador Dois',   false, '["encartes_comprador"]', true),
    ('${U.leitura}',    'Leitora Tres',     false, '["encartes"]', true),
    ('${U.calendario}', 'Agenda Quatro',    false, '["calendario"]', true),
    ('${U.forasteiro}', 'Forasteiro Cinco', false, '["agenda"]', true),
    ('${U.bloqueado}',  'Bloqueado Seis',   false, '["encartes","encartes_comprador"]', false),
    ('${U.fornecedor}', 'Fornecedor Sete',  false, '["encartes","encartes_comprador"]', true),
    ('${U.masterBloq}', 'Master Bloqueado', true,  '[]', false);
    insert into public.receb_fornecedor_contas (user_id) values ('${U.fornecedor}');`);

  // mudanças que o dono faria na tela ANTES da 2ª rodada (a 2ª rodada não pode desfazê-las)
  const pausaMaes = jc(U.master, `select public.calendario_mudar_situacao('dia-das-maes', 'pausada')`);
  const natalV2 = jc(U.master, `select public.encarte_salvar_modelo('tema-natal', ${lit({ grupos: [{ chave: "natal", nome: "Natal", vagas: [
    { chave: "vinho", nome: "Vinho", o_que_muda: "marca", quantidade: 2, obrigatoria: true },
    { chave: "panetone", nome: "Panetone", o_que_muda: "marca" },
    { chave: "peru", nome: "Peru", obrigatoria: false }] }] })}, '{}'::jsonb, 1)`);
  vale("0.6 (antes da 2ª rodada) master pausou Dia das Mães e salvou o modelo de Natal", pausaMaes.ok === true && natalV2.versao === 2, JSON.stringify([pausaMaes, natalV2]));

  const inst2 = instalar();
  vale("0.7 2ª rodada rodou inteira (idempotente)", inst2.r.ok, inst2.r.ok ? "" : inst2.r.erro.split("\n").slice(0, 6).join(" | "));
  vale("0.8 2ª rodada: conferência diz OK em tudo", inst2.linhas.length === 15 && inst2.linhas.every((l) => /\|OK( - .*)?$/.test(l)),
    inst2.linhas.filter((l) => !/\|OK( - .*)?$/.test(l)).join(" ; ") || "todos OK");
  const depois2 = JSON.parse(contagens()), antesJ = JSON.parse(antes2);
  eq("0.9 2ª rodada não duplicou campanhas (24) nem modelos (22)", [depois2.regras, depois2.modelos], [24, 22]);
  eq("0.10 regras de leitura (13) e gatilhos do livro (8) iguais depois da 2ª rodada", [depois2.politicas, depois2.gatilhos], [13, 8]);
  eq("0.11 data de implantação NÃO foi empurrada pela 2ª rodada", depois2.implantado_em, antesJ.implantado_em);
  eq("0.12 histórico dos modelos: 22 versões iniciais + 1 do Natal (sem repetir as iniciais)", depois2.hist_modelos, 23);
  eq("0.13 2ª rodada não desfez a pausa do Dia das Mães", suV("select situacao from public.calendario_regras where id = 'dia-das-maes'"), "pausada");
  eq("0.14 2ª rodada não desfez o modelo de Natal (versão 2)", suV("select versao from public.encarte_modelos where id = 'tema-natal'"), "2");
  eq("0.15 Sexta da Carne nasce pausada; Promoção Semanal ativa",
    suV("select string_agg(id || '=' || situacao, ',' order by id) from public.calendario_regras where id in ('sexta-da-carne','promocao-semanal')"),
    "promocao-semanal=ativa,sexta-da-carne=pausada");
  eq("0.16 Black Friday nasce com a regra certa: o dia seguinte à 4ª quinta de novembro",
    canon(suJ("select regra from public.calendario_regras where id = 'black-friday'")), canon(REGRA_BF_NOVA));
  // ==FDSPROPRIO== o Final de semana de ofertas é promoção própria desde 10/10/2026
  eq("0.16a o Final de semana nasce como campanha própria: sexta a domingo, Geral, ciano, ativa, ordem 7",
    suV(`select nome || '|' || tipo || '|' || (regra->>'tipo') || ':' || (regra->>'dia_semana') || ':' || (regra->>'duracao_dias') || '|' || setor || '|' || cor || '|' || situacao || '|' || ordem
          from public.calendario_regras where id = 'final-de-semana'`), "Final de semana de ofertas|campanha|semanal:5:3|Geral|#0088C2|ativa|7");
  eq("0.16b ... com o modelo próprio (1 grupo, 6 vagas, identidade, SEM período nem prazos de grupo, prazos 28/17/14)",
    suV(`select jsonb_array_length(estrutura->'grupos') || '|' || jsonb_array_length(estrutura->'grupos'->0->'vagas') || '|' || (estrutura->'grupos'->0->>'identidade')
          || '|' || (estrutura->'grupos'->0 ? 'periodo') || '|' || (estrutura->'grupos'->0 ? 'prazos') || '|' || (prazos->>'comecar') || '/' || (prazos->>'definir') || '/' || (prazos->>'aprovar')
          from public.encarte_modelos where id = 'final-de-semana' and campanha_id = 'final-de-semana' and tipo = 'edicao'`),
    "1|6|Final de semana de ofertas|false|false|28/17/14");
  eq("0.16c ... e a Promoção Semanal nasce SEM o grupo do fim de semana (7 grupos, 37 vagas no modelo)",
    suV(`select jsonb_array_length(estrutura->'grupos') || '|' || (select sum(jsonb_array_length(g->'vagas')) from jsonb_array_elements(estrutura->'grupos') g)
          || '|' || (select count(*) from jsonb_array_elements(estrutura->'grupos') g where g->>'chave' = 'fim-de-semana' or g ? 'periodo')
          from public.encarte_modelos where id = 'promocao-semanal'`), "7|37|0");

  // ---------- o relógio do teste (ver o topo) ----------
  relogio(HOJE_FIXO);
  su(`update public.encarte_config set valor = to_jsonb('${HOJE_FIXO}T08:00:00-03:00'::timestamptz) where chave = 'implantado_em'`);
  HOJE = suV("select public.encarte_hoje()");
  IMPL = suV("select ((valor #>> '{}')::timestamptz at time zone 'America/Fortaleza')::date from public.encarte_config where chave = 'implantado_em'");
  eq("0.17 relógio do teste fixado: hoje = terça 06/10/2026, implantação no mesmo dia", [HOJE, IMPL], [HOJE_FIXO, HOJE_FIXO]);
  lerRegrasModelos();

  // ======================================================================
  console.log("\n=== 0b. As edições VERDADEIRAS de 2026 a 2028 passam na conferência (ensaio desfeito no fim) ===\n");
  // O que a tela faz: a cada dia, edicoesParaCriar(hoje) e cria as que o "começar" já
  // alcançou. Aqui, o mesmo dia a dia de 2025-11 a 2028-12, com o relógio do banco no
  // dia em que a tela criaria (e, de novo, no ÚLTIMO dia em que ainda criaria: fim + 7).
  // Tudo numa transação só, desfeita no fim (não suja o resto do teste).
  const plano = [];
  {
    const vistas = [];
    for (let d = "2025-11-01"; d <= "2028-12-31"; d = somar(d, 1)) {
      ENC.edicoesParaCriar(REGRAS, MODELOS, d, vistas, { diasPassados: 7 }).forEach((e) => {
        vistas.push({ campanha_id: e.campanha_id, inicio_regra: e.inicio_regra });
        if (e.inicio_regra >= "2026-01-01" && e.inicio_regra <= "2028-12-31") plano.push({ dia: d, e });
      });
    }
  }
  function ensaio(itens, diaDoRelogio) {
    let s = "\\set ON_ERROR_STOP 0\n\\set ON_ERROR_ROLLBACK on\nbegin;\n" +
      `select set_config('request.jwt.claim.sub','${U.leitura}',true) is null;\n`;
    itens.forEach((it, i) => {
      const e = it.e;
      s += "reset role;\n" + corpoRelogio(diaDoRelogio(it)) + "\nset local role authenticated;\n" +
        `select 'R|${i}|' || public.encarte_criar_edicao(${q(e.campanha_id)}, ${q(e.inicio_regra)}, ${q(e.inicio)}, ${q(e.fim)}, ${lit(e.prazos)})::text;\n`;
    });
    s += "rollback;\n";
    const f = path.join(DIR, "ensaio.sql");
    fs.writeFileSync(f, s);
    const r = spawnSync(PSQL, ["-X", "-h", pg.sock, "-U", "bancada", "-d", "fardamento", "-v", "VERBOSITY=verbose",
      "-t", "-A", "-q", "-f", f], { encoding: "utf8", env: AMB, maxBuffer: 64 * 1024 * 1024 });
    const res = {};
    (r.stdout || "").split("\n").forEach((l) => { const m = l.match(/^R\|(\d+)\|(.*)$/); if (m) res[m[1]] = JSON.parse(m[2]); });
    const erros = (r.stderr || "").split("\n").filter((l) => /ERROR/.test(l));
    return { res, erros };
  }
  const chave = (e) => e.campanha_id + "|" + e.inicio_regra;
  const porCamp = {};
  plano.forEach((p) => { porCamp[p.e.campanha_id] = (porCamp[p.e.campanha_id] || 0) + 1; });
  const ens1 = ensaio(plano, (it) => it.dia);
  const aceitas1 = plano.filter((p, i) => ens1.res[i] && ens1.res[i].ok === true && ens1.res[i].criada === true);
  vale("0b.1 " + plano.length + " edições de 2026 a 2028 (" + Object.keys(porCamp).sort().map((k) => k + " " + porCamp[k]).join(", ") +
    "), cada uma no dia em que o 'começar' chega: TODAS aceitas",
    plano.length > 380 && aceitas1.length === plano.length && ens1.erros.length === 0,
    aceitas1.length + " aceitas" + (ens1.erros.length ? " · " + ens1.erros.slice(0, 3).join(" | ") : ""));
  // as de perto de feriado, Carnaval e fim de ano (prazos antecipados pelo calculo.cjs)
  const marcantes = ["hora-da-economia|2026-12-31", "promocao-semanal|2026-12-28", "tercou|2026-12-22", "tercou|2026-12-29",
    "tercou|2027-02-09", "promocao-semanal|2027-03-29", "sabado-bombastico|2027-12-11", "promocao-semanal|2027-12-27",
    "hora-da-economia|2027-12-30", "tercou|2028-02-29", "promocao-semanal|2028-12-25", "hora-da-economia|2028-11-30"];
  const aceitasK = new Set(aceitas1.map((p) => chave(p.e)));
  eq("0b.2 ... inclusive as de perto de feriado, Carnaval e fim de ano (hortifrúti na véspera de Natal, HE de 31/12, Terçou de Carnaval)",
    marcantes.filter((k) => !aceitasK.has(k)).join(",") || "todas", "todas");
  const hortiNatal = plano.find((p) => chave(p.e) === "tercou|2026-12-29");
  eq("0b.3 ... com os prazos antecipados de verdade (Terçou 29/12: hortifrúti começa 24/12, na véspera de Natal)",
    hortiNatal && [hortiNatal.e.prazos.grupos.hortifruti.comecar, hortiNatal.e.prazos.grupos.hortifruti.definir], ["2026-12-24", "2026-12-28"]);
  // ==FDSPROPRIO== o Final de semana como promoção própria: toda sexta, sexta a domingo, todas aceitas acima
  const fdsPlano = plano.filter((p) => p.e.campanha_id === "final-de-semana");
  eq("0b.3a o ensaio leva as edições do Final de semana (toda sexta de 2026 a 2028, sexta a domingo) e o banco aceitou todas",
    [fdsPlano.length > 150, fdsPlano.every((p) => new Date(p.e.inicio + "T12:00:00Z").getUTCDay() === 5 && p.e.fim === somar(p.e.inicio, 2)),
      fdsPlano.every((p) => aceitasK.has(chave(p.e)))], [true, true, true]);
  const ens2 = ensaio(plano, (it) => somar(it.e.fim, 7));
  const aceitas2 = plano.filter((p, i) => ens2.res[i] && ens2.res[i].ok === true && ens2.res[i].criada === true);
  vale("0b.4 as mesmas " + plano.length + ", no ÚLTIMO dia em que a tela ainda cria (fim + 7): todas aceitas",
    aceitas2.length === plano.length && ens2.erros.length === 0, aceitas2.length + " aceitas" + (ens2.erros.length ? " · " + ens2.erros.slice(0, 3).join(" | ") : ""));
  eq("0b.5 o ensaio foi desfeito: nenhuma edição ficou gravada e o relógio voltou a 06/10/2026",
    [suV("select count(*) from public.encarte_edicoes"), suV("select public.encarte_hoje()")], ["0", HOJE_FIXO]);

  // ======================================================================
  console.log("\n=== 1. A ficha do VR: só o robô (chave de serviço) grava ===\n");
  r = com(null, `
    insert into public.encarte_produtos_vr (produto_id, descricao, eans, m1, m2, m3, setor, preco_normal, preco_atual, em_oferta, custo, custo_confiavel, estoque, venda30_valor, impressao) values
      (1001, 'CAFE PILAO TRADICIONAL 500G', array['7896089011111'], 39, 5, 1, 'MERCEARIA', 14.99, 14.99, false, 10.50, true, 120, 5000, 'h1'),
      (1002, 'CAFE MELITTA 500G',           array['7891021000111'], 39, 5, 1, 'MERCEARIA', 15.49, 15.49, false, 11.00, true, 80, 3000, 'h2'),
      (1003, 'ARROZ TIPO 1 TESTE 5KG',      array['7890000001003'], 39, 1, 1, 'MERCEARIA', 29.90, 29.90, false, null, true, 50, 9000, 'h3'),
      (1004, 'ALCATRA BOVINA KG',           array['2000000001004'], 42, 1, 1, 'ACOUGUE',   49.90, 49.90, false, 39.00, false, 30, 7000, 'h4'),
      (1005, 'FEIJAO CARIOCA TESTE 1KG',    array['7890000001005'], 39, 2, 1, 'MERCEARIA',  8.99,  8.99, false, 0, true, 60, 4000, 'h5'),
      (1006, 'REFRIGERANTE COLA TESTE 2L',  array['7890000001006'], 45, 1, 1, 'BEBIDAS',    8.99,  8.99, false, 6.00, true, 200, 6000, 'h6'),
      (1007, 'AÇÚCAR CRISTAL TESTE 1KG',    array['7890000001007'], 39, 3, 1, 'MERCEARIA',  4.99,  4.99, false, 3.80, true, 90, 2000, 'h7');
    insert into public.encarte_produtos_vr (produto_id, descricao, eans, m1, m2, m3, preco_normal, custo, custo_confiavel, venda30_valor, impressao)
      select 2000 + g, 'CAFE LOTE TESTE ' || g, array[(7899000000000 + g)::text], 39, 5, 2, 10, 7, true, g, 'l' || g from generate_series(1, 60) g;
    insert into public.encarte_sync (chave, ultima_ok_em, ultima_tentativa_em, ultima_completa_em, linhas, alteradas)
      values ('produtos', '2026-09-26T13:00:00Z', '2026-09-26T13:00:00Z', '2026-09-26T09:00:00Z', 67, 67)`, "service_role");
  vale("1.1 chave de serviço (robô) grava a ficha e o estado da sincronia", r.ok, r.ok ? "" : r.msg);
  negado("1.2 logado comum NÃO grava na ficha do VR",
    com(U.comprador, `insert into public.encarte_produtos_vr (produto_id, descricao) values (9, 'X')`));
  negado("1.3 logado comum NÃO grava no estado da sincronia",
    com(U.master, `update public.encarte_sync set ultima_ok_em = now()`));
  const SYNC = suV("select ultima_ok_em from public.encarte_sync where chave = 'produtos'");

  // ======================================================================
  console.log("\n=== 2. Criar edição: idempotente, cópia fiel do modelo, prazos do grupo ===\n");
  // A: a Promoção Semanal de 26/10 (futura), com as datas e prazos que a tela manda. O
  // "começar" dela (28/09) veio ANTES da implantação (06/10): nasce sem penalidade.
  const eA = real("promocao-semanal", "2026-10-26");
  const pzA = eA.prazos;
  const edA = criarReal(U.comprador, eA);
  vale("2.1 comprador cria a edição da Promoção Semanal", edA.ok === true && edA.criada === true, JSON.stringify(edA));
  const A = edA.id;
  eq("2.2 nasce com os 7 grupos ativos do modelo e só as 36 vagas obrigatórias", [edA.grupos, edA.vagas], [7, 36]);
  const edA2 = criarReal(U.leitura, eA);
  eq("2.3 LEITURA também chama (a tela cria ao abrir) e a 2ª chamada devolve a MESMA edição", [edA2.criada, edA2.id], [false, A]);
  eq("2.4 idempotente: continua 1 edição e 36 vagas", suV(`select count(*) || '/' || (select count(*) from public.encarte_vagas where edicao_id = '${A}')
      from public.encarte_edicoes where campanha_id = 'promocao-semanal' and inicio_regra = '${eA.inicio}'`), "1/36");
  eq("2.5 a vaga opcional do modelo (Carne bovina) NÃO nasce sozinha",
    suV(`select count(*) from public.encarte_vagas where edicao_id = '${A}' and nome like 'Carne bovina%'`), "0");
  // ==FDSPROPRIO== o Final de semana saiu da PS em 10/10/2026 (virou promoção própria): nenhum grupo
  // dela tem período próprio nem identidade, e nenhum se chama "fim-de-semana"
  eq("2.6 a PS nasce SEM o grupo do fim de semana: os 7 grupos, sem período próprio nem identidade",
    suV(`select string_agg(chave, ',' order by ordem) || '|' || count(*) filter (where inicio is not null or fim is not null or identidade is not null)
          from public.encarte_grupos where edicao_id = '${A}'`),
    "capa,acougue,cesta-basica,limpeza,higiene,frios-laticinios,bebidas-conveniencia|0");
  // ==FDSPROPRIO== o que o 2.6 ANTIGO provava com o grupo da PS: um grupo com "periodo" {ini_offset,
  // fim_offset} no MODELO vira o inicio/fim do grupo na edição que encarte_criar_edicao cria — a MESMA
  // conta do ENC.periodoGrupo da tela. Nenhum modelo de fábrica tem mais grupo com período, mas a tela
  // ainda deixa o dono montar uma ação temática assim (ex.: um "Sabadão" de sexta a domingo dentro da PS).
  // O dono do banco acrescenta um grupo de TESTE ao modelo da PS, uma tela de leitura cria a PS de 02/11
  // e o dono confere. Tudo numa transação só, DESFEITA no fim: não sobra grupo, edição, vaga nem histórico.
  {
    const grupoPer = { chave: "teste-periodo", nome: "Ação de teste (sexta a domingo)", ativo_padrao: true,
      periodo: { ini_offset: 4, fim_offset: 6 },
      vagas: [{ chave: "a", nome: "Vaga teste A", o_que_muda: "produto", quantidade: 1, obrigatoria: true },
              { chave: "b", nome: "Vaga teste B", o_que_muda: "marca", quantidade: 1, obrigatoria: true }] };
    const ePer = real("promocao-semanal", "2026-11-02");
    const esperadoPer = ENC.periodoGrupo(grupoPer, ePer.inicio, ePer.fim);
    const rPer = su(`begin;
      update public.encarte_modelos set estrutura = jsonb_set(estrutura, '{grupos}', (estrutura->'grupos') || ${lit([grupoPer])}) where id = 'promocao-semanal';
      set local role authenticated;
      select set_config('request.jwt.claim.sub', '${U.leitura}', true) is null;
      select public.encarte_criar_edicao('promocao-semanal', '${ePer.inicio}', '${ePer.inicio}', '${ePer.fim}', ${lit(ePer.prazos)});
      reset role;
      select jsonb_build_object('inicio', g.inicio, 'fim', g.fim, 'ordem', g.ordem,
               'vagas', (select string_agg(v.nome, ',' order by v.ordem) from public.encarte_vagas v where v.grupo_id = g.id),
               'inicio_vaga', (select public.encarte__inicio_vaga(v.id) from public.encarte_vagas v where v.grupo_id = g.id order by v.ordem limit 1),
               'outros_sem_periodo', (select count(*) from public.encarte_grupos o where o.edicao_id = g.edicao_id and o.id <> g.id and o.inicio is null and o.fim is null))
        from public.encarte_grupos g join public.encarte_edicoes e on e.id = g.edicao_id
       where e.campanha_id = 'promocao-semanal' and e.inicio_regra = '${ePer.inicio}' and g.chave = 'teste-periodo';
      rollback;`);
    const jsPer = rPer.ok ? rPer.saida.split("\n").filter((l) => l.trim().startsWith("{")).map((l) => JSON.parse(l)) : [];
    const edPer = jsPer[0] || {}, gPer = jsPer[1] || {};
    vale("2.6a (modelo de teste) a PS de 02/11 com um grupo de período {4,6} no modelo: criada com 8 grupos e 38 vagas",
      rPer.ok && edPer.criada === true && edPer.grupos === 8 && edPer.vagas === 38, rPer.ok ? JSON.stringify(edPer) : rPer.msg);
    eq("2.6b o grupo nasce com inicio..fim = ENC.periodoGrupo (início + 4 a início + 6: sexta 06/11 a domingo 08/11)",
      [gPer.inicio, gPer.fim], [esperadoPer.inicio, esperadoPer.fim]);
    eq("2.6c ... que é a conta do modelo, não o período da edição (02/11 a 08/11)",
      [esperadoPer.inicio, esperadoPer.fim, new Date(esperadoPer.inicio + "T12:00:00Z").getUTCDay()], [somar(ePer.inicio, 4), somar(ePer.inicio, 6), 5]);
    eq("2.6d as vagas do grupo entram no ar no início DO GRUPO (sexta), e os outros 7 grupos seguem sem período próprio",
      [gPer.vagas, gPer.inicio_vaga, gPer.outros_sem_periodo], ["Vaga teste A,Vaga teste B", esperadoPer.inicio, 7]);
    eq("2.6e a transação foi DESFEITA: nem a edição de 02/11 nem o grupo de teste ficaram (o modelo da PS segue com 7 grupos)",
      suV(`select (select count(*) from public.encarte_edicoes where campanha_id = 'promocao-semanal' and inicio_regra = '${ePer.inicio}') || '|' ||
                  (select jsonb_array_length(estrutura->'grupos') from public.encarte_modelos where id = 'promocao-semanal') || '|' ||
                  (select count(*) from public.encarte_grupos where chave = 'teste-periodo')`), "0|7|0");
  }
  eq("2.7 prazos gravados como vieram da tela; título com nome e data",
    suV(`select (prazos->>'comecar') || ',' || (prazos->>'definir') || ',' || (prazos->>'aprovar') || '|' || titulo || '|' || modelo_versao from public.encarte_edicoes where id = '${A}'`),
    pzA.comecar + "," + pzA.definir + "," + pzA.aprovar + "|Promoção Semanal · 26/10/2026|1");
  eq("2.8 carimbo: criado_por e o nome da ficha no momento",
    suV(`select criado_por || '|' || criado_por_nome from public.encarte_edicoes where id = '${A}'`), U.comprador + "|Comprador Um");
  eq("2.9 evento 'edicao_criada' no livro, com quem fez", suV(`select count(*) || '|' || max(por_nome) from public.encarte_eventos where edicao_id = '${A}' and tipo = 'edicao_criada'`), "1|Comprador Um");

  // ==FDSPROPRIO== o Final de semana de ofertas é promoção própria desde 10/10/2026: a edição dele é de
  // sexta a domingo, com os prazos contados da SEXTA (antes seguia a régua da PS, contada da segunda)
  const eFds = real("final-de-semana", "2026-10-30");
  eq("2.9a a ocorrência do Final de semana que a tela manda: sexta 30/10 a domingo 01/11, prazos da sexta, sem prazo de grupo",
    [eFds.inicio, eFds.fim, eFds.prazos.comecar, eFds.prazos.definir, eFds.prazos.aprovar, Object.keys(eFds.prazos.grupos).length],
    ["2026-10-30", "2026-11-01", "2026-10-02", "2026-10-13", "2026-10-16", 0]);
  const edFds = criarReal(U.leitura, eFds);
  eq("2.9b encarte_criar_edicao aceita a edição do Final de semana: 1 grupo e 6 vagas", [edFds.ok, edFds.criada, edFds.grupos, edFds.vagas], [true, true, 1, 6]);
  eq("2.9c o grupo leva a identidade da arte e NÃO tem datas nem prazos próprios (dura a edição inteira)",
    suV(`select chave || '|' || nome || '|' || identidade || '|' || coalesce(inicio::text, 'sem') || '|' || coalesce(fim::text, 'sem') || '|' || coalesce(prazos::text, 'sem')
          from public.encarte_grupos where edicao_id = '${edFds.id}'`), "ofertas|Ofertas do fim de semana|Final de semana de ofertas|sem|sem|sem");
  eq("2.9d as 6 vagas do modelo, na ordem", suV(`select string_agg(nome || ':' || o_que_muda, ',' order by ordem) from public.encarte_vagas where edicao_id = '${edFds.id}'`),
    "Frango:corte,Linguiça:marca,Carne suína:corte,Bebida:produto,Mercearia:produto,Conveniência:produto");
  eq("2.9e título, período, prazos gravados e modelo",
    suV(`select titulo || '|' || inicio || '..' || fim || '|' || (prazos->>'comecar') || ',' || (prazos->>'definir') || ',' || (prazos->>'aprovar') || '|' || modelo_id || '|' || modelo_versao
          from public.encarte_edicoes where id = '${edFds.id}'`),
    "Final de semana de ofertas · 30/10/2026|2026-10-30..2026-11-01|2026-10-02,2026-10-13,2026-10-16|final-de-semana|1");
  eq("2.9f o 'começar' (02/10) veio antes da implantação (06/10): nasce sem penalidade", edFds.sem_penalidade, true);
  eq("2.9g a vaga do Final de semana entra no ar na sexta (início da edição, não o da PS)",
    suV(`select public.encarte__inicio_vaga(id) || '|' || public.encarte__no_ar(id) from public.encarte_vagas where edicao_id = '${edFds.id}' order by ordem limit 1`), "2026-10-30|false");
  const eFds2 = real("final-de-semana", "2026-11-06");
  recusa("2.9h Final de semana começando no SÁBADO (07/11): recusa", criarEd(U.leitura, "final-de-semana", "2026-11-07", "2026-11-09", eFds2.prazos), "edicao_fora_da_regra", "22023");
  recusa("2.9i Final de semana de sexta a SEGUNDA (4 dias): recusa", criarEd(U.leitura, "final-de-semana", eFds2.inicio, somar(eFds2.inicio, 3), eFds2.prazos), "edicao_fora_da_regra", "22023");
  recusa("2.9j Final de semana de um dia só (só a sexta): recusa", criarEd(U.leitura, "final-de-semana", eFds2.inicio, eFds2.inicio, eFds2.prazos), "edicao_fora_da_regra", "22023");
  eq("2.9k nenhuma das recusas gravou edição do Final de semana", suV(`select count(*) from public.encarte_edicoes where campanha_id = 'final-de-semana'`), "1");

  // Terçou: grupo Hortifrúti tem prazo PRÓPRIO — sem ele a criação recusa (não grava vazio calado)
  const eT = real("tercou", "2026-11-10");
  const pzT = prazos(eT.prazos.comecar, eT.prazos.definir, eT.prazos.aprovar);
  recusa("2.10 Terçou sem os prazos próprios do Hortifrúti: recusa", criarReal(U.comprador, eT, pzT), "prazos_grupo_faltando", "22023");
  eq("2.11 ... e nada ficou gravado", suV(`select count(*) from public.encarte_edicoes where campanha_id = 'tercou'`), "0");
  const edT = criarReal(U.comprador, eT);
  vale("2.12 Terçou com prazos do grupo: cria", edT.criada === true && edT.vagas === 10, JSON.stringify(edT));
  eq("2.13 grupo Hortifrúti guarda os prazos próprios e é FLV; o outro grupo não tem prazo próprio",
    suV(`select string_agg(chave || ':' || coalesce(prazos->>'definir','-') || ':' || flv, ',' order by ordem) from public.encarte_grupos where edicao_id = '${edT.id}'`),
    "hortifruti:" + eT.prazos.grupos.hortifruti.definir + ":true,demais-itens:-:false");

  const eH = real("hora-da-economia", "2026-11-26");
  recusa("2.14 campanha PAUSADA (Sexta da Carne) não gera edição", criarEd(U.comprador, "sexta-da-carne", "2026-10-09", "2026-10-09", prazos(dia(-5), dia(-4), dia(-3))), "campanha_pausada", "55000");
  recusa("2.15 DATA do Calendário (Carnaval) não gera edição sozinha", criarEd(U.comprador, "carnaval", "2027-02-08", "2027-02-09", prazos(dia(1), dia(2), dia(3))), "nao_e_campanha", "55000");
  recusa("2.16 prazos fora de ordem: recusa", criarReal(U.comprador, eH, prazos(eH.prazos.definir, eH.prazos.comecar, eH.prazos.aprovar)), "prazos_invalidos", "22023");
  recusa("2.17 fim antes do início: recusa", criarEd(U.comprador, "hora-da-economia", eH.inicio, somar(eH.inicio, -1), eH.prazos), "dado_invalido", "22023");
  recusa("2.18 campanha que não existe: recusa", criarEd(U.comprador, "nao-existe", eH.inicio, eH.fim, eH.prazos), "nao_encontrado", "P0002");

  // várias telas abrindo ao MESMO TEMPO criam a mesma edição: nasce UMA só
  const ePar = real("promocao-semanal", "2026-11-23");
  const par = aoMesmoTempo([U.comprador, U.leitura, U.master, U.comprador2].map((uid) =>
    `begin; set local role authenticated; select set_config('request.jwt.claim.sub','${uid}',true) is null;
     select public.encarte_criar_edicao('promocao-semanal', '${ePar.inicio}', '${ePar.inicio}', '${ePar.fim}', ${lit(ePar.prazos)});
     select pg_sleep(0.4) is null; commit;`));
  const respPar = par.map((p) => { const l = p.saida.split("\n").filter((x) => x.trim().startsWith("{")); try { return JSON.parse(l[0]); } catch (e) { return { erro: p.erro.slice(0, 120) }; } });
  eq("2.19 4 telas ao mesmo tempo: exatamente 1 criou, as 4 receberam o mesmo id",
    [respPar.filter((x) => x.criada === true).length, new Set(respPar.map((x) => x.id)).size], [1, 1]);
  eq("2.20 ... e só existe 1 edição com 36 vagas (nada duplicado)",
    suV(`select count(*) || '/' || (select count(*) from public.encarte_vagas v join public.encarte_edicoes e on e.id = v.edicao_id
          where e.campanha_id = 'promocao-semanal' and e.inicio_regra = '${ePar.inicio}') from public.encarte_edicoes where campanha_id = 'promocao-semanal' and inicio_regra = '${ePar.inicio}'`), "1/36");

  // ---------- quem só LÊ não forja datas nem prazos (achado da revisão, as 3 formas) ----------
  // (a) "sem penalidade" forjado: 'começar' inventado antes da implantação
  const eX = real("promocao-semanal", "2026-11-30");
  recusa("2.21 LEITURA manda 'começar' em 2020 para a edição nascer 'sem penalidade': recusa",
    criarReal(U.leitura, eX, prazos("2020-01-01", "2020-01-02", eX.prazos.aprovar)), "prazo_fora_da_regra", "22023");
  recusa("2.22 'começar' 13 dias além da antecipação máxima (41 dias antes, o modelo manda 28): recusa",
    criarReal(U.leitura, eX, prazos(somar(eX.inicio, -41), eX.prazos.definir, eX.prazos.aprovar)), "prazo_fora_da_regra", "22023");
  recusa("2.23 'começar' DEPOIS do que o modelo manda (20 dias antes; o modelo manda 28): recusa",
    criarReal(U.leitura, eX, prazos(somar(eX.inicio, -20), somar(eX.inicio, -17), eX.prazos.aprovar)), "prazo_fora_da_regra", "22023");
  // (b) prazos absurdos que nunca atrasam
  recusa("2.24 'aprovar' em 2099 (nunca ficaria atrasada): recusa",
    criarReal(U.leitura, eX, prazos(eX.prazos.comecar, eX.prazos.definir, "2099-12-31")), "prazo_fora_da_regra", "22023");
  recusa("2.25 'aprovar' 1 dia depois do que o modelo permite (13 dias antes; o modelo manda 14): recusa",
    criarReal(U.leitura, eX, prazos(eX.prazos.comecar, eX.prazos.definir, somar(eX.inicio, -13))), "prazo_fora_da_regra", "22023");
  const pzHorti = copia(real("tercou", "2026-11-17").prazos);
  pzHorti.grupos.hortifruti.aprovar = "2026-11-17";
  recusa("2.26 prazo do GRUPO forjado (hortifrúti aprovado no próprio dia do ar): recusa",
    criarReal(U.leitura, real("tercou", "2026-11-17"), pzHorti), "prazo_fora_da_regra", "22023");
  eq("2.27 nenhuma das recusas gravou edição (a ocorrência não ficou reservada por ninguém)",
    suV(`select count(*) from public.encarte_edicoes where (campanha_id, inicio_regra) in (('promocao-semanal','${eX.inicio}'),('tercou','2026-11-17'))`), "0");
  const edX = criarReal(U.leitura, eX);
  eq("2.28 a tela, com os prazos certos, cria a mesma ocorrência — com penalidade (o 'começar' é depois da implantação)",
    [edX.criada, edX.sem_penalidade], [true, false]);
  // (c) edições-lixo: datas que a regra não manda, fim +400 dias, anos à frente
  recusa("2.29 Hora da Economia numa QUARTA (25/11; a regra manda a última quinta): recusa",
    criarEd(U.leitura, "hora-da-economia", "2026-11-25", "2026-11-25", ENC.prazosEdicao(MODELOS.find((m) => m.id === "hora-da-economia"), "2026-11-25", "2026-11-25")),
    "edicao_fora_da_regra", "22023");
  recusa("2.30 ocorrência certa, mas com fim 400 dias depois: recusa", criarEd(U.leitura, "hora-da-economia", eH.inicio, somar(eH.inicio, 400), eH.prazos), "edicao_fora_da_regra", "22023");
  const eY = real("promocao-semanal", "2026-11-16"), eT3 = real("tercou", "2026-10-27");
  recusa("2.31 início diferente do início da regra (a PS de 16/11 'começando' na terça 17/11): recusa",
    criarEd(U.leitura, "promocao-semanal", somar(eY.inicio, 1), somar(eY.inicio, 8), eY.prazos, eY.inicio), "edicao_fora_da_regra", "22023");
  recusa("2.32 Terçou de 2 dias com fim no 3º dia: recusa", criarEd(U.leitura, "tercou", eT3.inicio, somar(eT3.inicio, 2), eT3.prazos), "edicao_fora_da_regra", "22023");
  const heJan31 = ENC.ocorrencias(REGRAS.find((r) => r.id === "hora-da-economia").regra, "2031-01-01", "2031-01-31")[0];
  recusa("2.33 ocorrência VERDADEIRA, mas em 2031 (anos à frente): recusa", criarReal(U.leitura, real("hora-da-economia", heJan31.inicio)), "edicao_fora_da_janela", "22023");
  recusa("2.34 a janela da PS vai até hoje + 28 + 30 dias: a de 07/12 (62 dias) é recusada", criarReal(U.leitura, real("promocao-semanal", "2026-12-07")), "edicao_fora_da_janela", "22023");
  recusa("2.35 ... e a de 21/09 (15 dias atrás; a janela começa em hoje − 14) também", criarReal(U.leitura, real("promocao-semanal", "2026-09-21")), "edicao_fora_da_janela", "22023");
  recusa("2.36 Terçou de 24/11 (49 dias; a janela do Terçou vai até hoje + 14 + 30): recusa", criarReal(U.leitura, real("tercou", "2026-11-24")), "edicao_fora_da_janela", "22023");
  eq("2.37 nenhuma edição-lixo ficou gravada",
    suV(`select count(*) from public.encarte_edicoes where inicio_regra in ('2026-11-25', '${heJan31.inicio}', '2026-12-07', '2026-09-21', '2026-11-24', '${eY.inicio}', '${eT3.inicio}')
          or (campanha_id = 'hora-da-economia' and inicio_regra = '${eH.inicio}')`), "0");
  const nas = [criarReal(U.leitura, real("tercou", "2026-09-22")), criarReal(U.leitura, real("tercou", "2026-11-17"))];
  eq("2.38 as duas pontas da janela passam: Terçou de 22/09 (hoje − 14) e de 17/11 (hoje + 42)", nas.map((x) => x.criada), [true, true]);

  // ==FDSPROPRIO== uma PS aberta ANTES de 10/10/2026 nasceu com o grupo "fim-de-semana" (8 grupos, 42 vagas).
  // A migração do Final de semana marca esse grupo 'removido' e as 6 vagas 'retirada'. Aqui o dono do
  // banco monta esse estado na PS de 30/11 (como a migração deixa) e prova que nada mais conta as vagas.
  const gFdsX = suV(`insert into public.encarte_grupos (edicao_id, chave, nome, identidade, tipo, flv, inicio, fim, ordem, situacao)
      values ('${edX.id}', 'fim-de-semana', 'Fim de semana', 'Final de semana de ofertas', 'modelo', false, '${somar(eX.inicio, 4)}', '${somar(eX.inicio, 6)}', 8, 'removido')
      returning id`);
  su(`insert into public.encarte_vagas (edicao_id, grupo_id, ordem, nome, o_que_muda, obrigatoria, origem, situacao, motivo_retirada, versao)
      select '${edX.id}', '${gFdsX}', t.o, t.n, t.q, true, 'modelo', 'retirada', 'O Final de semana virou promoção própria (10/10/2026)', 2
        from (values (1, 'Frango', 'corte'), (2, 'Linguiça', 'marca'), (3, 'Carne suína', 'corte'), (4, 'Bebida', 'produto'),
                     (5, 'Mercearia', 'produto'), (6, 'Conveniência', 'produto')) t(o, n, q)`);
  const vagasX = suJ(`select jsonb_agg(to_jsonb(v)) from public.encarte_vagas v where v.edicao_id = '${edX.id}'`);
  eq("2.39 PS antiga já migrada (grupo 'removido', 6 vagas 'retirada'): 42 linhas, mas só 36 contam (no banco e na conta da tela, ENC.contarVagas)",
    [vagasX.length, ENC.contarVagas(vagasX, []).total, suV(`select count(*) from public.encarte_vagas where edicao_id = '${edX.id}' and situacao = 'ativa'`)], [42, 36, "36"]);
  recusa("2.40 ... o grupo removido não recebe vaga nova", jc(U.comprador, `select public.encarte_adicionar_vaga('${edX.id}', '${gFdsX}', 'Frango')`), "grupo_removido", "55000");
  const vRetX = suV(`select id from public.encarte_vagas where grupo_id = '${gFdsX}' order by ordem limit 1`);
  recusa("2.41 ... a vaga retirada não recebe proposta", reg(U.comprador, vRetX, { produtos: [1001], fornecedor_nome: "Distribuidora Alfa", custo_negociado: 9 }), "vaga_retirada", "55000");
  recusa("2.42 ... e o grupo removido não é aprovado à parte", apr(U.master, edX.id, gFdsX, versaoDe(edX.id), []), "nao_encontrado", "P0002");

  // ======================================================================
  console.log("\n=== 3. Quem NÃO pode: anon, forasteiro, conta bloqueada, fornecedor, sem ficha ===\n");
  const TABELAS = ["calendario_regras", "calendario_regras_historico", "encarte_config", "encarte_modelos", "encarte_modelos_historico",
    "encarte_edicoes", "encarte_grupos", "encarte_vagas", "encarte_propostas", "encarte_aprovacoes", "encarte_eventos", "encarte_produtos_vr", "encarte_sync"];
  const anonLe = TABELAS.filter((t) => com(null, `select count(*) from public.${t}`, "anon").ok);
  eq("3.1 anon (sem login) não lê NENHUMA das 13 tabelas", anonLe.join(",") || "nenhuma", "nenhuma");
  negado("3.2 anon não chama criar edição", com(null, `select public.encarte_criar_edicao('promocao-semanal', '${eA.inicio}', '${eA.inicio}', '${eA.fim}', ${lit(pzA)})`, "anon"));
  negado("3.3 anon não chama a busca de produtos", com(null, `select public.encarte_buscar_produtos('cafe')`, "anon"));
  negado("3.4 anon não chama aprovar", com(null, `select public.encarte_aprovar('${A}', null, 1, '[]')`, "anon"));

  const conta = (uid, t) => val(uid, `select count(*) from public.${t}`);
  eq("3.5 forasteiro (liberado, sem a página) não vê edição, vaga, ficha nem Calendário",
    ["encarte_edicoes", "encarte_vagas", "encarte_produtos_vr", "calendario_regras", "encarte_modelos"].map((t) => conta(U.forasteiro, t)).join(","), "0,0,0,0,0");
  recusa("3.6 forasteiro não cria edição", criarReal(U.forasteiro, eA), "sem_permissao", "42501");
  recusa("3.7 forasteiro não busca produto", jc(U.forasteiro, `select public.encarte_buscar_produtos('cafe')`), "sem_permissao", "42501");
  // a "Operação" do Calendário mostra os prazos reais: quem só tem a página Calendário lê
  // também modelos, edições e grupos (o lado de NÃO ler vagas, propostas etc. vai na 15.5)
  eq("3.8 quem tem só a página Calendário lê as 24 campanhas e também as edições, os grupos e os modelos",
    [conta(U.calendario, "calendario_regras"), conta(U.calendario, "encarte_edicoes") === suV("select count(*) from public.encarte_edicoes"),
      Number(conta(U.calendario, "encarte_grupos")) > 0, conta(U.calendario, "encarte_modelos")].join(","), "24,true,true,22");
  recusa("3.9 ... e não cria edição", criarReal(U.calendario, eA), "sem_permissao", "42501");
  eq("3.10 conta com aprovado=false (com as páginas) não vê nada",
    ["encarte_edicoes", "encarte_vagas", "calendario_regras"].map((t) => conta(U.bloqueado, t)).join(","), "0,0,0");
  const vCafeA = vagaDe(A, "capa", "Café");
  recusa("3.11 conta com aprovado=false não registra proposta",
    reg(U.bloqueado, vCafeA, { produtos: [1001], fornecedor_nome: "X", custo_negociado: 9 }), "conta_nao_liberada", "42501");
  eq("3.12 conta do Portal do Fornecedor (com as páginas) não vê nada",
    ["encarte_edicoes", "encarte_produtos_vr", "calendario_regras"].map((t) => conta(U.fornecedor, t)).join(","), "0,0,0");
  recusa("3.13 conta do Portal não registra proposta",
    reg(U.fornecedor, vCafeA, { produtos: [1001], fornecedor_nome: "X", custo_negociado: 9 }), "conta_nao_liberada", "42501");
  recusa("3.14 MASTER com aprovado=false também não age (não aprova)", apr(U.masterBloq, A, null, versaoDe(A), []), "conta_nao_liberada", "42501");
  eq("3.15 master com aprovado=false não lê", conta(U.masterBloq, "encarte_edicoes"), "0");
  recusa("3.16 logado sem ficha em perfis não age", criarReal(U.semFicha, eA), "conta_nao_liberada", "42501");
  eq("3.17 logado sem ficha não lê", conta(U.semFicha, "encarte_edicoes"), "0");

  // ======================================================================
  console.log("\n=== 4. LEITURA lê tudo, mas não escreve ===\n");
  eq("4.1 leitura vê as edições, vagas, grupos, campanhas, modelos, ficha e a sincronia",
    ["encarte_edicoes", "encarte_vagas", "encarte_grupos", "calendario_regras", "encarte_modelos", "encarte_produtos_vr", "encarte_sync", "encarte_config"]
      .map((t) => Number(conta(U.leitura, t)) > 0).join(","), "true,true,true,true,true,true,true,true");
  recusa("4.2 leitura NÃO registra proposta", reg(U.leitura, vCafeA, { produtos: [1001], fornecedor_nome: "X", custo_negociado: 9 }), "sem_permissao", "42501");
  recusa("4.3 leitura NÃO adiciona vaga", jc(U.leitura, `select public.encarte_adicionar_vaga('${A}', '${grupoDe(A, "capa")}', 'Vaga X')`), "sem_permissao", "42501");
  recusa("4.4 leitura NÃO retira vaga", jc(U.leitura, `select public.encarte_retirar_vaga('${vCafeA}', 'motivo')`), "sem_permissao", "42501");
  recusa("4.5 leitura NÃO aprova", apr(U.leitura, A, null, versaoDe(A), []), "sem_permissao", "42501");
  negado("4.6 leitura NÃO escreve direto na tabela de propostas",
    com(U.leitura, `insert into public.encarte_propostas (vaga_id, produtos) values ('${vCafeA}', '{1001}')`));
  negado("4.7 leitura NÃO altera vaga direto", com(U.leitura, `update public.encarte_vagas set estado = 'aprovada' where id = '${vCafeA}'`));
  negado("4.8 nem o MASTER escreve direto nas tabelas (só pelas funções)",
    com(U.master, `update public.encarte_edicoes set versao = 99 where id = '${A}'`));
  eq("4.9b 'sou comprador?' responde certo para cada papel (a tela usa para mostrar os botões)",
    [U.comprador, U.comprador2, U.master, U.leitura, U.bloqueado].map((u) => val(u, "select public.encarte_sou_comprador()::text")).join(","), "true,true,true,false,false");
  eq("4.9a o MASTER também lê (passa na página por ser master)", [Number(conta(U.master, "encarte_edicoes")) > 0, Number(conta(U.master, "calendario_regras"))], [true, 24]);
  const busca = jc(U.leitura, `select public.encarte_buscar_produtos('cafe pilao')`);
  vale("4.9 leitura busca produto", busca.ok === true && busca.produtos.length === 1 && busca.produtos[0].produto_id === 1001, JSON.stringify(busca).slice(0, 150));

  // ======================================================================
  console.log("\n=== 5. Proposta: obrigatórios, retrato do VR feito no servidor, branco não é zero ===\n");
  const vArrozA = vagaDe(A, "capa", "Arroz");
  const vFeijaoA = vagaDe(A, "cesta-basica", "Feijão");
  const vFrangoA = vagaDe(A, "capa", "Frango");
  const base = { produtos: [1001], fornecedor_nome: "Distribuidora Alfa", custo_negociado: 9.8 };
  recusa("5.1 sem custo negociado: recusa", reg(U.comprador, vCafeA, { produtos: [1001], fornecedor_nome: "Alfa" }), "custo_obrigatorio", "22023");
  recusa("5.2 custo negociado EM BRANCO (\"\") não vira zero: recusa", reg(U.comprador, vCafeA, Object.assign({}, base, { custo_negociado: "" })), "custo_obrigatorio", "22023");
  recusa("5.3 custo negociado 0: recusa", reg(U.comprador, vCafeA, Object.assign({}, base, { custo_negociado: 0 })), "custo_obrigatorio", "22023");
  recusa("5.4 sem produtos: recusa", reg(U.comprador, vCafeA, { fornecedor_nome: "Alfa", custo_negociado: 9 }), "produtos_obrigatorios", "22023");
  recusa("5.5 lista de produtos vazia: recusa", reg(U.comprador, vCafeA, Object.assign({}, base, { produtos: [] })), "produtos_obrigatorios", "22023");
  recusa("5.6 sem fornecedor: recusa", reg(U.comprador, vCafeA, { produtos: [1001], custo_negociado: 9 }), "fornecedor_obrigatorio", "22023");
  recusa("5.7 produto fora da ficha do VR: recusa", reg(U.comprador, vCafeA, Object.assign({}, base, { produtos: [9999] })), "produto_desconhecido", "22023");
  recusa("5.8 campo com nome errado (preco_ofeta) não é ignorado calado: recusa", reg(U.comprador, vCafeA, Object.assign({}, base, { preco_ofeta: 12 })), "campo_desconhecido", "22023");
  recusa("5.9 a tela NÃO consegue mandar o custo de hoje (retrato é do servidor)", reg(U.comprador, vCafeA, Object.assign({}, base, { custo_hoje: 1 })), "campo_desconhecido", "22023");
  recusa("5.10 número mal escrito: recusa", reg(U.comprador, vCafeA, Object.assign({}, base, { preco_oferta: "doze" })), "valor_invalido", "22023");
  eq("5.11 nenhuma das recusas gravou proposta", suV("select count(*) from public.encarte_propostas"), "0");

  const p1 = reg(U.comprador, vCafeA, { produtos: [1001], fornecedor_nome: "Distribuidora Alfa", fornecedor_id: 501, custo_negociado: "9,80",
    preco_oferta: 12.99, verba_valor: 100, verba_qtd_base: 100, condicao_pagamento: "28 dias", validade: dia(30) });
  vale("5.12 comprador registra proposta (custo em texto com vírgula aceito)", p1.ok === true, JSON.stringify(p1));
  const P1 = p1.id;
  eq("5.13 retrato do VR: custo de hoje, confiável, preço normal e hora da última sincronia OK",
    suV(`select custo_hoje || '|' || custo_confiavel || '|' || preco_normal || '|' || (dados_vr_em = '${SYNC}') || '|' || custo_negociado from public.encarte_propostas where id = '${P1}'`),
    "10.50|true|14.99|true|9.80");
  eq("5.14 produtos_info com descrição e EAN vindos da ficha",
    suJ(`select produtos_info from public.encarte_propostas where id = '${P1}'`), [{ id: 1001, ean: "7896089011111", descricao: "CAFE PILAO TRADICIONAL 500G" }]);
  eq("5.15 carimbo: registrado_por e nome", suV(`select registrado_por || '|' || registrado_por_nome from public.encarte_propostas where id = '${P1}'`), U.comprador + "|Comprador Um");
  const p2 = reg(U.comprador, vCafeA, { produtos: [1002], fornecedor_nome: "Distribuidora Beta", custo_negociado: 10.2, preco_oferta: 12.49 });
  const P2 = p2.id;
  const p3 = reg(U.comprador, vArrozA, { produtos: [1003], fornecedor_nome: "Cerealista Gama", custo_negociado: 22, preco_oferta: 26.9 });
  const P3 = p3.id;
  eq("5.16 ficha SEM custo: custo de hoje fica NULO (nunca 0)", suV(`select coalesce(custo_hoje::text, 'NULO') from public.encarte_propostas where id = '${P3}'`), "NULO");
  const p4 = reg(U.comprador, vFeijaoA, { produtos: [1005], fornecedor_nome: "Cerealista Gama", custo_negociado: 6.5, preco_oferta: 7.99 });
  eq("5.17 ficha com custo 0 no VR: custo de hoje fica NULO (\"Sem custo no VR\")", suV(`select coalesce(custo_hoje::text, 'NULO') from public.encarte_propostas where id = '${p4.id}'`), "NULO");
  const p5 = reg(U.comprador, vFrangoA, { produtos: [1004], fornecedor_nome: "Frigorífico Delta", custo_negociado: 36, preco_oferta: 44.9 });
  eq("5.18 carne de desossa: retrato guarda custo_confiavel = falso", suV(`select custo_confiavel::text from public.encarte_propostas where id = '${p5.id}'`), "false");
  eq("5.19 campo opcional em branco fica NULO (verba vazia não vira 0)",
    suV(`select coalesce(verba_valor::text, 'NULO') || '|' || coalesce(bonif_compra::text, 'NULO') from public.encarte_propostas where id = '${P2}'`), "NULO|NULO");
  eq("5.20 evento 'proposta_registrada' para cada proposta", contaEv(`e.tipo = 'proposta_registrada'`), 5);
  const pc2 = reg(U.comprador2, vCafeA, { produtos: [1002], fornecedor_nome: "Distribuidora Beta", custo_negociado: 10.1, preco_oferta: 12.49 });
  vale("5.21 comprador SÓ com a página de comprador também registra (e lê)", pc2.ok === true && Number(conta(U.comprador2, "encarte_propostas")) > 0, JSON.stringify(pc2));

  // ======================================================================
  console.log("\n=== 6. Escolha humana e aprovação com devolução ===\n");
  recusa("6.1 leitura não escolhe", esc(U.leitura, vCafeA, P1), "sem_permissao", "42501");
  recusa("6.2 proposta de OUTRA vaga não pode ser escolhida", esc(U.comprador, vArrozA, P1), "proposta_de_outra_vaga", "22023");
  let e1 = esc(U.comprador, vCafeA, P1);
  vale("6.3 comprador escolhe a proposta do Café", e1.ok === true && e1.mudou === true && e1.reabriu === false, JSON.stringify(e1));
  esc(U.comprador, vArrozA, P3);
  eq("6.4 escolha carimbada (quem e quando)", suV(`select proposta_escolhida || '|' || escolhida_por_nome || '|' || (escolhida_em is not null) from public.encarte_vagas where id = '${vCafeA}'`), P1 + "|Comprador Um|true");
  eq("6.5 escolher de novo a mesma não muda nada", esc(U.comprador, vCafeA, P1).mudou, false);

  let V = versaoDe(A);
  const devSemCat = [{ vaga_id: vArrozA, observacao: "Preço acima do concorrente" }];
  recusa("6.6 comprador NÃO aprova", apr(U.comprador, A, null, V, []), "sem_permissao", "42501");
  recusa("6.7 devolução SEM categoria: recusa", apr(U.master, A, null, V, devSemCat), "categoria_obrigatoria", "22023");
  recusa("6.8 devolução com categoria inventada: recusa", apr(U.master, A, null, V, [{ vaga_id: vArrozA, categoria: "humor" }]), "categoria_invalida", "22023");
  recusa("6.9 devolução de vaga de OUTRA edição: recusa", apr(U.master, A, null, V, [{ vaga_id: vagaDe(edT.id, "hortifruti", "Batata"), categoria: "preco" }]), "devolucao_fora_do_escopo", "22023");
  eq("6.10 recusas não aprovaram nada nem gravaram aprovação", suV(`select count(*) from public.encarte_aprovacoes`) + "|" + estadoDe(vCafeA), "0|pendente");
  recusa("6.11 aprovar sem dizer a versão vista: recusa", apr(U.master, A, null, null, []), "dado_invalido", "22023");

  const a1 = apr(U.master, A, null, V, [{ vaga_id: vArrozA, categoria: "preco", observacao: "Preço acima do concorrente" }]);
  vale("6.12 master aprova a edição devolvendo o Arroz", a1.ok === true, JSON.stringify(a1));
  eq("6.13 aprovou só a definida não marcada (Café); devolveu a marcada (Arroz)", [a1.aprovadas, a1.devolvidas], [[vCafeA], [vArrozA]]);
  eq("6.14 estados: Café aprovada, Arroz em ajuste, Feijão (definida? não) pendente",
    [estadoDe(vCafeA), estadoDe(vArrozA), estadoDe(vFeijaoA)].join(","), "aprovada,em_ajuste,pendente");
  eq("6.15 devolução guardada na vaga com categoria e observação",
    suV(`select devolucao->>'categoria' || '|' || (devolucao->>'observacao') || '|' || (devolucao->>'por_nome') from public.encarte_vagas where id = '${vArrozA}'`),
    "preco|Preço acima do concorrente|Dono Teste");
  const foto = suJ(`select foto_aprovada from public.encarte_vagas where id = '${vCafeA}'`);
  const margemJs = Math.round(((12.99 - 9.8) / 12.99) * 1e6) / 1e6;
  eq("6.16 foto: margem pela fórmula da seção 4 = (oferta − custo considerado) / oferta", Number(foto.margem), margemJs);
  eq("6.17 foto: custo considerado = negociado; custo de hoje e negociado guardados separados",
    [foto.custo_considerado, foto.custo_hoje, foto.custo_negociado, foto.preco_normal, foto.preco_oferta], [9.8, 10.5, 9.8, 14.99, 12.99]);
  eq("6.18 foto: fornecedor, produtos, verba e a ficha do VR naquele instante",
    [foto.fornecedor_nome, foto.produtos, foto.verba_valor, foto.verba_qtd_base, foto.ficha_no_ato && foto.ficha_no_ato.custo], ["Distribuidora Alfa", [1001], 100, 100, 10.5]);
  const aprov = suJ(`select row_to_json(a) from public.encarte_aprovacoes a where id = '${a1.aprovacao_id}'`);
  eq("6.19 'Aprovação do Encarte' gravada: quem, versão vista, hora dos dados do VR, aprovadas, devoluções, foto",
    [aprov.aprovado_por, aprov.aprovado_por_nome, aprov.versao_vista, aprov.vagas_aprovadas, aprov.devolucoes.length, aprov.devolucoes[0].categoria, aprov.foto.length],
    [U.master, "Dono Teste", V, [vCafeA], 1, "preco", 1]);
  eq("6.20 hora dos dados do VR na aprovação = última sincronia OK", suV(`select dados_vr_em = '${SYNC}' from public.encarte_aprovacoes where id = '${a1.aprovacao_id}'`), "t");
  const evAprov = eventos(`e.edicao_id = '${A}' and e.tipo = 'aprovacao'`);
  eq("6.21 evento 'aprovacao' com o nome 'Aprovação do Encarte'", [evAprov.length, evAprov[0].depois.nome], [1, "Aprovação do Encarte"]);
  eq("6.22 evento 'vaga_devolvida' com a categoria", suV(`select categoria || '|' || motivo from public.encarte_eventos where tipo = 'vaga_devolvida' and vaga_id = '${vArrozA}'`), "preco|Preço acima do concorrente");
  eq("6.23 a aprovação subiu a versão (uma aprovação velha repetida é recusada)", a1.versao, V + 1);
  recusa("6.24 aprovar de novo com a versão que já passou: versao_mudou", apr(U.master, A, null, V, []), "versao_mudou", "40001");

  // ======================================================================
  console.log("\n=== 7. Mudou depois de aprovado, ANTES do ar: reabre só a vaga ===\n");
  V = versaoDe(A);
  let m = edt(U.comprador, P1, { preco_oferta: 11.99, motivo: "fornecedor baixou o preço de venda" });
  vale("7.1 mudar o PREÇO DE OFERTA da escolhida reabre a vaga", m.ok && m.escolhida === true && m.reabriu === true && m.critica === false, JSON.stringify(m));
  eq("7.2 vaga vai para 'aguardando_visto'; as outras não mudam", [estadoDe(vCafeA), estadoDe(vArrozA)].join(","), "aguardando_visto,em_ajuste");
  const evEd = eventos(`e.proposta_id = '${P1}' and e.tipo = 'proposta_editada'`);
  eq("7.3 evento com ANTES e DEPOIS só do que mudou, e o motivo",
    [evEd.length, evEd[0].antes, evEd[0].depois, evEd[0].motivo, evEd[0].por_nome],
    [1, { preco_oferta: 12.99 }, { preco_oferta: 11.99 }, "fornecedor baixou o preço de venda", "Comprador Um"]);
  const evRe = eventos(`e.vaga_id = '${vCafeA}' and e.tipo = 'vaga_reaberta'`);
  eq("7.4 evento 'vaga_reaberta' guarda aprovado × mudou e o motivo",
    [evRe.length, evRe[0].antes.estado, evRe[0].depois.estado, evRe[0].antes.preco_oferta, evRe[0].depois.preco_oferta, evRe[0].motivo],
    [1, "aprovada", "aguardando_visto", 12.99, 11.99, "preco_oferta_mudou"]);
  eq("7.5 a foto aprovada NÃO foi apagada (aprovado × atual)", suV(`select foto_aprovada->>'preco_oferta' from public.encarte_vagas where id = '${vCafeA}'`), "12.99");
  vale("7.6 a mudança subiu a versão da edição", versaoDe(A) > V, versaoDe(A) + " > " + V);
  recusa("7.7 aprovar com a versão de ANTES da mudança: recusa versao_mudou", apr(U.master, A, null, V, []), "versao_mudou", "40001");
  const recusaV = apr(U.master, A, null, V, []);
  eq("7.8 a recusa diz a versão atual (dica) para a tela recarregar", recusaV.dica, String(versaoDe(A)));
  let a2 = apr(U.master, A, null, versaoDe(A), []);
  eq("7.9 com a versão atual, o master dá o visto: volta a aprovada com a foto nova",
    [a2.aprovadas.includes(vCafeA), estadoDe(vCafeA), suV(`select foto_aprovada->>'preco_oferta' from public.encarte_vagas where id = '${vCafeA}'`)], [true, "aprovada", "11.99"]);
  // Vaga devolvida ("Em ajuste") NÃO volta sozinha: aprovar OUTRA vaga não desfaz, calado,
  // a devolução. Ela só entra depois que o comprador mexe nela.
  eq("7.9b a vaga 'em ajuste' que o comprador NÃO mexeu fica de fora (sem erro) e a resposta conta quantas esperam",
    [a2.aprovadas, a2.em_ajuste_esperando, estadoDe(vArrozA), suV(`select devolucao->>'categoria' from public.encarte_vagas where id = '${vArrozA}'`)],
    [[vCafeA], 1, "em_ajuste", "preco"]);
  const nada = apr(U.master, A, null, versaoDe(A), []);
  recusa("7.9c só com ela pendente: 'nada a aprovar'", nada, "nada_a_aprovar", "55000");
  vale("7.9d ... e a mensagem diz que há 1 em ajuste esperando o comprador", /1 em ajuste esperando o comprador/.test(nada.msg || ""), nada.msg);
  V = versaoDe(A);
  e1 = esc(U.comprador, vArrozA, P3);
  eq("7.9e o comprador escolhe de NOVO a mesma proposta ('revisei'): conta como mexida, fica no livro e sobe a versão",
    [e1.mudou, e1.reconfirmada, e1.reabriu, estadoDe(vArrozA), suV(`select devolucao->>'mexida_por_nome' from public.encarte_vagas where id = '${vArrozA}'`),
      contaEv(`e.vaga_id = '${vArrozA}' and e.tipo = 'proposta_escolhida' and (e.depois->>'reconfirmada')::boolean`), versaoDe(A) > V],
    [true, true, false, "em_ajuste", "Comprador Um", 1, true]);
  eq("7.9f escolher a mesma outra vez não conta de novo (nada muda)", [esc(U.comprador, vArrozA, P3).mudou,
    contaEv(`e.vaga_id = '${vArrozA}' and e.tipo = 'proposta_escolhida' and (e.depois->>'reconfirmada')::boolean`)], [false, 1]);
  recusa("7.9g a aprovação com a versão de ANTES da mexida é recusada (o master precisa ver o estado novo)", apr(U.master, A, null, V, []), "versao_mudou", "40001");
  a2 = apr(U.master, A, null, versaoDe(A), []);
  eq("7.9h depois da mexida, a próxima aprovação aprova a vaga (e a devolução sai)",
    [a2.aprovadas, a2.em_ajuste_esperando, estadoDe(vArrozA), suV(`select coalesce(devolucao::text, 'LIMPA') from public.encarte_vagas where id = '${vArrozA}'`)],
    [[vArrozA], 0, "aprovada", "LIMPA"]);
  // as outras duas mexidas: EDITAR e REGISTRAR proposta (Frango da Capa)
  esc(U.comprador, vFrangoA, p5.id);
  let aF = apr(U.master, A, null, versaoDe(A), [{ vaga_id: vFrangoA, categoria: "margem_verba", observacao: "margem baixa" }]);
  eq("7.9i Frango devolvido: nada aprovado, 1 devolvida", [aF.aprovadas, aF.devolvidas, estadoDe(vFrangoA)], [[], [vFrangoA], "em_ajuste"]);
  edt(U.comprador, p5.id, { preco_oferta: 45.9, motivo: "subi o preço para a margem" });
  aF = apr(U.master, A, null, versaoDe(A), []);
  eq("7.9j o comprador EDITOU a proposta: a vaga volta e é aprovada", [aF.aprovadas, estadoDe(vFrangoA)], [[vFrangoA], "aprovada"]);
  apr(U.master, A, null, versaoDe(A), [{ vaga_id: vFrangoA, categoria: "fornecedor" }]);
  aF = apr(U.master, A, null, versaoDe(A), [{ vaga_id: vArrozA, categoria: "estoque" }]);
  eq("7.9k devolvida de novo e sem mexida: fica esperando mesmo quando o master aprova/devolve outra coisa",
    [aF.aprovadas, aF.em_ajuste_esperando, estadoDe(vFrangoA)], [[], 1, "em_ajuste"]);
  reg(U.comprador, vFrangoA, { produtos: [1004], fornecedor_nome: "Frigorífico Zeta", custo_negociado: 35, preco_oferta: 45.9 });
  esc(U.comprador, vArrozA, P3);
  aF = apr(U.master, A, null, versaoDe(A), []);
  eq("7.9l o comprador REGISTROU outra proposta para o Frango (e reconfirmou o Arroz): as duas voltam e são aprovadas",
    [aF.aprovadas.slice().sort(), aF.em_ajuste_esperando, estadoDe(vFrangoA), estadoDe(vArrozA)], [[vArrozA, vFrangoA].sort(), 0, "aprovada", "aprovada"]);

  m = edt(U.comprador, P1, { custo_negociado: 9.5 });
  eq("7.10 custo negociado MENOR só registra: não reabre", [m.mudou, m.reabriu, estadoDe(vCafeA)], [true, false, "aprovada"]);
  eq("7.11 ... mas fica no livro com antes/depois", eventos(`e.proposta_id = '${P1}' and e.tipo = 'proposta_editada'`).pop().depois, { custo_negociado: 9.5 });
  m = edt(U.comprador, P1, { custo_negociado: 9.9 });
  eq("7.12 custo negociado MAIOR reabre", [m.reabriu, m.razoes, estadoDe(vCafeA)], [true, ["custo_subiu"], "aguardando_visto"]);
  apr(U.master, A, null, versaoDe(A), []);
  m = edt(U.comprador, P1, { verba_valor: 50 });
  eq("7.13 verba REDUZIDA reabre", [m.reabriu, m.razoes], [true, ["verba_reduziu"]]);
  apr(U.master, A, null, versaoDe(A), []);
  m = edt(U.comprador, P1, { verba_valor: 80 });
  eq("7.14 verba AUMENTADA só registra", [m.reabriu, estadoDe(vCafeA)], [false, "aprovada"]);
  m = edt(U.comprador, P1, { observacao: "arte com selo", quantidade_minima: "10 caixas", validade: dia(31), condicao_pagamento: "35 dias" });
  eq("7.15 observação, quantidade, validade e pagamento só registram", [m.mudou, m.reabriu, estadoDe(vCafeA)], [true, false, "aprovada"]);
  // a verba compara só o TOTAL: mexer só na quantidade-base (mesmo total) só registra —
  // a mesma regra que a tela usa para avisar antes de gravar
  m = edt(U.comprador, P1, { verba_qtd_base: 200 });
  eq("7.15b verba com o MESMO total e base maior (valor por unidade menor) só registra", [m.mudou, m.reabriu, m.razoes, estadoDe(vCafeA)], [true, false, [], "aprovada"]);
  m = edt(U.comprador, P1, { verba_qtd_base: 100 });
  eq("7.15c ... e voltar a base também só registra", [m.mudou, m.reabriu, estadoDe(vCafeA)], [true, false, "aprovada"]);
  m = edt(U.comprador, P1, { preco_oferta: "" });
  eq("7.15d preço de oferta APAGADO antes do ar reabre a vaga", [m.reabriu, m.critica, m.razoes, estadoDe(vCafeA)], [true, false, ["preco_oferta_mudou"], "aguardando_visto"]);
  edt(U.comprador, P1, { preco_oferta: 11.99 });
  apr(U.master, A, null, versaoDe(A), []);
  eq("7.15e preço de volta e novo visto: aprovada de novo", estadoDe(vCafeA), "aprovada");
  eq("7.16 editar sem mudar nada não grava evento", edt(U.comprador, P1, { preco_oferta: 11.99 }).mudou, false);
  // fornecedor trocado mantendo produtos + preço + condição: só registra
  const p6 = reg(U.comprador, vCafeA, { produtos: [1001], fornecedor_nome: "Distribuidora Épsilon", custo_negociado: 9.9, preco_oferta: 11.99, verba_valor: 80, verba_qtd_base: 100 });
  e1 = esc(U.comprador, vCafeA, p6.id);
  eq("7.17 trocar para outra proposta com os MESMOS produtos, preço e condição só registra", [e1.mudou, e1.reabriu, estadoDe(vCafeA)], [true, false, "aprovada"]);
  e1 = esc(U.comprador, vCafeA, P2);
  eq("7.18 trocar para proposta com OUTRO produto reabre", [e1.reabriu, e1.razoes.includes("produto_trocado"), estadoDe(vCafeA)], [true, true, "aguardando_visto"]);
  apr(U.master, A, null, versaoDe(A), []);
  m = edt(U.comprador, P2, { produtos: [1002, 1006] });
  eq("7.19 mudar os produtos da escolhida reabre e refaz o retrato do VR", [m.reabriu, m.razoes],
    [true, ["produto_trocado"]]);
  eq("7.20 ... produtos_info agora tem os 2 produtos", suV(`select jsonb_array_length(produtos_info) from public.encarte_propostas where id = '${P2}'`), "2");
  apr(U.master, A, null, versaoDe(A), []);
  const d1 = jc(U.comprador, `select public.encarte_descartar_proposta('${P2}', 'fornecedor desistiu')`);
  eq("7.21 descartar a ESCOLHIDA de vaga aprovada antes do ar: vaga sem escolha e aguardando visto",
    [d1.era_escolhida, d1.reabriu, estadoDe(vCafeA), suV(`select coalesce(proposta_escolhida::text, 'NENHUMA') from public.encarte_vagas where id = '${vCafeA}'`)],
    [true, true, "aguardando_visto", "NENHUMA"]);
  recusa("7.22 proposta descartada não pode ser escolhida", esc(U.comprador, vCafeA, P2), "proposta_descartada", "55000");
  recusa("7.23 proposta descartada não pode ser editada", edt(U.comprador, P2, { preco_oferta: 10 }), "proposta_descartada", "55000");
  eq("7.24 descartar de novo não faz nada", jc(U.comprador, `select public.encarte_descartar_proposta('${P2}', null)`).mudou, false);
  // proposta que NÃO é a escolhida: editar não mexe na vaga nem na versão
  const vAntes = versaoDe(A);
  m = edt(U.comprador, pc2.id, { preco_oferta: 11.49 });
  eq("7.25 editar proposta que não é a escolhida não reabre nem sobe a versão", [m.escolhida, m.reabriu, versaoDe(A)], [false, false, vAntes]);

  // + vaga e retirar vaga (antes do ar)
  const gCapa = grupoDe(A, "capa");
  const nv = jc(U.comprador, `select public.encarte_adicionar_vaga('${A}', '${gCapa}', 'Carne bovina · definir na semana', 'corte', false)`);
  vale("7.26 comprador inclui vaga só nesta edição", nv.ok === true, JSON.stringify(nv));
  eq("7.27 vaga nova nasce pendente, origem 'edicao', opcional, e sobe a versão",
    [suV(`select estado || '|' || origem || '|' || obrigatoria from public.encarte_vagas where id = '${nv.id}'`), versaoDe(A) > vAntes], ["pendente|edicao|false", true]);
  recusa("7.28 retirar vaga sem motivo: recusa", jc(U.comprador, `select public.encarte_retirar_vaga('${nv.id}', '  ')`), "motivo_obrigatorio", "22023");
  const rv = jc(U.comprador, `select public.encarte_retirar_vaga('${nv.id}', 'sem interesse nesta semana')`);
  eq("7.29 retirar vaga antes do ar: retirada, sem crítica", [rv.mudou, rv.critica, suV(`select situacao || '|' || motivo_retirada from public.encarte_vagas where id = '${nv.id}'`)],
    [true, false, "retirada|sem interesse nesta semana"]);
  recusa("7.30 vaga retirada não recebe proposta", reg(U.comprador, nv.id, base), "vaga_retirada", "55000");
  recusa("7.31 grupo de outra edição: recusa", jc(U.comprador, `select public.encarte_adicionar_vaga('${A}', '${grupoDe(edT.id, "hortifruti")}', 'X')`), "nao_encontrado", "P0002");

  // ======================================================================
  console.log("\n=== 8. NO AR: nunca reabre; registra; destaca crítica ===\n");
  // a Promoção Semanal de 28/09 (há 8 dias): ela e todos os grupos dela já entraram no ar
  const edC = criarReal(U.comprador, real("promocao-semanal", "2026-09-28"));
  const C = edC.id;
  const vCafeC = vagaDe(C, "capa", "Café"), vArrozC = vagaDe(C, "capa", "Arroz");
  const p7 = reg(U.comprador, vCafeC, { produtos: [1001], fornecedor_nome: "Distribuidora Alfa", custo_negociado: 9.8, preco_oferta: 12.99 });
  esc(U.comprador, vCafeC, p7.id);
  const p9 = reg(U.comprador, vArrozC, { produtos: [1003], fornecedor_nome: "Cerealista Gama", custo_negociado: 22, preco_oferta: 26.9 });
  esc(U.comprador, vArrozC, p9.id);
  const a3 = apr(U.master, C, null, versaoDe(C), []);
  eq("8.1 master aprova (atrasado, mas pode) a edição que já está no ar", a3.aprovadas.length, 2);
  m = edt(U.comprador, p7.id, { preco_oferta: 13.49 });
  eq("8.2 preço anunciado SOBE no ar: crítica, e a vaga NÃO reabre", [m.critica, m.reabriu, m.razoes, estadoDe(vCafeC)], [true, false, ["preco_subiu"], "aprovada"]);
  const crit = eventos(`e.vaga_id = '${vCafeC}' and e.tipo = 'critica_no_ar'`);
  eq("8.3 evento 'critica_no_ar' em DESTAQUE com antes/depois do preço",
    [crit.length, crit[0].destaque, crit[0].antes.preco_oferta, crit[0].depois.preco_oferta, crit[0].motivo, crit[0].por_nome],
    [1, true, 12.99, 13.49, "preco_subiu", "Comprador Um"]);
  eq("8.4 nenhum 'vaga_reaberta' no ar", contaEv(`e.edicao_id = '${C}' and e.tipo = 'vaga_reaberta'`), 0);
  m = edt(U.comprador, p7.id, { preco_oferta: 12.49 });
  eq("8.5 preço que DESCE no ar só registra (sem crítica)", [m.critica, m.reabriu, contaEv(`e.vaga_id = '${vCafeC}' and e.tipo = 'critica_no_ar'`)], [false, false, 1]);
  m = edt(U.comprador, p7.id, { custo_negociado: 11 });
  eq("8.6 custo que sobe no ar não reabre", [m.reabriu, estadoDe(vCafeC)], [false, "aprovada"]);
  const p8 = reg(U.comprador, vCafeC, { produtos: [1002], fornecedor_nome: "Distribuidora Beta", custo_negociado: 10.2, preco_oferta: 12.49 });
  e1 = esc(U.comprador, vCafeC, p8.id);
  eq("8.7 produto TROCADO no ar: crítica, não reabre", [e1.critica, e1.reabriu, e1.razoes, estadoDe(vCafeC)], [true, false, ["produto_trocado"], "aprovada"]);
  const rvC = jc(U.comprador, `select public.encarte_retirar_vaga('${vArrozC}', 'faltou no fornecedor')`);
  eq("8.8 vaga RETIRADA no ar: crítica em destaque", [rvC.critica,
    suV(`select count(*) || '|' || bool_and(destaque) || '|' || max(motivo) from public.encarte_eventos where vaga_id = '${vArrozC}' and tipo = 'critica_no_ar'`)],
    [true, "1|true|vaga_retirada: faltou no fornecedor"]);
  const dC = jc(U.comprador, `select public.encarte_descartar_proposta('${p8.id}', 'acabou o estoque')`);
  eq("8.9 descartar a escolhida no ar: crítica, estado continua aprovado (foto guarda o anunciado)",
    [dC.critica, dC.reabriu, estadoDe(vCafeC)], [true, false, "aprovada"]);
  e1 = esc(U.comprador, vCafeC, p7.id);
  eq("8.9b escolher de novo depois de descartar compara com a FOTO aprovada (mesmo produto, preço menor: sem crítica)",
    [e1.mudou, e1.critica, e1.reabriu, estadoDe(vCafeC)], [true, false, false, "aprovada"]);
  // preço anunciado APAGADO no ar: o cliente viu um preço que a loja não tem mais — crítica
  const nCritC = contaEv(`e.vaga_id = '${vCafeC}' and e.tipo = 'critica_no_ar'`);
  m = edt(U.comprador, p7.id, { preco_oferta: "" });
  eq("8.9c preço de oferta APAGADO no ar: crítica (não reabre)", [m.critica, m.reabriu, m.razoes, estadoDe(vCafeC)], [true, false, ["preco_apagado"], "aprovada"]);
  const critAp = eventos(`e.vaga_id = '${vCafeC}' and e.tipo = 'critica_no_ar'`).pop();
  eq("8.9d ... o livro ganhou a crítica em destaque, com o preço de antes e o vazio de depois",
    [contaEv(`e.vaga_id = '${vCafeC}' and e.tipo = 'critica_no_ar'`) - nCritC, critAp.destaque, critAp.motivo, critAp.antes.preco_oferta, critAp.depois.preco_oferta],
    [1, true, "preco_apagado", 12.49, null]);
  m = edt(U.comprador, p7.id, { preco_oferta: 12.49 });
  eq("8.9e colocar o preço de volta (vazio → preço) no ar não é crítica", [m.critica, m.reabriu], [false, false]);
  // período do GRUPO manda: a PS de ontem (05/10) está no ar, mas uma ação temática dela com datas
  // próprias (sexta 09/10 a domingo 11/10) ainda não chegou. ==FDSPROPRIO== até 10/10/2026 o caso era o
  // grupo Fim de semana da PS; ele virou promoção própria, mas o caminho "grupo com período dentro da
  // edição" continua vivo (ações temáticas e o editor de modelos) e esta é a prova dele no banco.
  const edF = criarReal(U.comprador, real("promocao-semanal", "2026-10-05"));
  const F = edF.id;
  const gtF = jc(U.master, `select public.encarte_criar_grupo_tematico('${F}', 'tema-natal', 'Ação de sexta a domingo', '2026-10-09', '2026-10-11', null)`);
  eq("8.10a master cria na PS 05/10 (no ar) uma ação temática de sexta a domingo, com as vagas do modelo do tema",
    [gtF.ok, gtF.vagas, suV(`select inicio || '..' || fim || '|' || tipo from public.encarte_grupos where id = '${gtF.id}'`)], [true, 3, "2026-10-09..2026-10-11|tema"]);
  const vAcaoF = suV(`select id from public.encarte_vagas where grupo_id = '${gtF.id}' and nome = 'Vinho'`), vCafeF = vagaDe(F, "capa", "Café");
  eq("8.10b o banco trata a vaga da ação como 'antes do ar' (início do GRUPO, 09/10) e a da Capa como no ar",
    suV(`select public.encarte__no_ar('${vAcaoF}') || '|' || public.encarte__no_ar('${vCafeF}')`), "false|true");
  const pf1 = reg(U.comprador, vAcaoF, { produtos: [1004], fornecedor_nome: "Frigorífico Delta", custo_negociado: 36, preco_oferta: 44.9 });
  const pf2 = reg(U.comprador, vCafeF, { produtos: [1001], fornecedor_nome: "Distribuidora Alfa", custo_negociado: 9.8, preco_oferta: 12.99 });
  esc(U.comprador, vAcaoF, pf1.id); esc(U.comprador, vCafeF, pf2.id);
  apr(U.master, F, null, versaoDe(F), []);
  const mAcao = edt(U.comprador, pf1.id, { preco_oferta: 46.9 });
  const mCapa = edt(U.comprador, pf2.id, { preco_oferta: 13.99 });
  eq("8.10 edição no ar, mas a ação de sexta ainda não: a vaga do grupo REABRE",
    [mAcao.reabriu, mAcao.critica, estadoDe(vAcaoF)], [true, false, "aguardando_visto"]);
  eq("8.11 ... e a vaga da Capa (já no ar) só vira crítica", [mCapa.reabriu, mCapa.critica, estadoDe(vCafeF)], [false, true, "aprovada"]);
  const aG = apr(U.master, F, gtF.id, versaoDe(F), []);
  eq("8.12 aprovação POR GRUPO só aprova as vagas do grupo", [aG.aprovadas, suV(`select grupo_id from public.encarte_aprovacoes where id = '${aG.aprovacao_id}'`)],
    [[vAcaoF], gtF.id]);
  recusa("8.13 aprovar grupo sem nada pendente: 'nada a aprovar'", apr(U.master, F, gtF.id, versaoDe(F), []), "nada_a_aprovar", "55000");

  // ======================================================================
  console.log("\n=== 9. O livro só cresce (eventos, aprovações, históricos) ===\n");
  const nEv = suV("select count(*) from public.encarte_eventos");
  recusa("9.1 nem o DONO do banco altera um evento", su(`update public.encarte_eventos set tipo = 'x' where id = (select min(id) from public.encarte_eventos)`), "livro_so_cresce", "42501");
  recusa("9.2 nem o DONO do banco apaga eventos", su(`delete from public.encarte_eventos`), "livro_so_cresce", "42501");
  recusa("9.3 nem o DONO do banco esvazia o livro (truncate)", su(`truncate public.encarte_eventos`), "livro_so_cresce", "42501");
  su(`create or replace function public.teste_apagar_livro() returns void language plpgsql security definer set search_path = public as $$
      begin delete from public.encarte_eventos; end $$;
      grant execute on function public.teste_apagar_livro() to authenticated;`);
  recusa("9.4 função 'security definer' (roda como o dono) também não apaga", jc(U.master, `select public.teste_apagar_livro()`), "livro_so_cresce", "42501");
  su(`drop function public.teste_apagar_livro()`);
  negado("9.5 logado não apaga evento direto (sem permissão na tabela)", com(U.master, `delete from public.encarte_eventos`));
  recusa("9.6 aprovação não se altera", su(`update public.encarte_aprovacoes set aprovado_por_nome = 'outro'`), "livro_so_cresce", "42501");
  recusa("9.7 aprovação não se apaga", su(`delete from public.encarte_aprovacoes`), "livro_so_cresce", "42501");
  recusa("9.8 histórico dos modelos não se altera", su(`update public.encarte_modelos_historico set versao = 0`), "livro_so_cresce", "42501");
  recusa("9.9 histórico do Calendário não se apaga", su(`delete from public.calendario_regras_historico`), "livro_so_cresce", "42501");
  eq("9.10 o livro continua com o mesmo número de eventos", suV("select count(*) from public.encarte_eventos"), nEv);
  // o nome do carimbo é o do MOMENTO
  su(`update public.perfis set nome = 'Comprador Um Renomeado' where id = '${U.comprador}'`);
  edt(U.comprador, pc2.id, { observacao: "depois de mudar de nome" });
  eq("9.11 carimbo guarda o nome de QUANDO agiu (o antigo continua no livro, o novo nos novos)",
    suV(`select string_agg(distinct por_nome, ',' order by por_nome) from public.encarte_eventos where por = '${U.comprador}'`),
    "Comprador Um,Comprador Um Renomeado");

  // ======================================================================
  console.log("\n=== 10. Sem penalidade (implantação) ===\n");
  eq("10.1 edição cujo 'começar' foi ANTES da implantação nasce sem penalidade", suV(`select sem_penalidade::text from public.encarte_edicoes where id = '${A}'`), "true");
  // a PS de 09/11: "começar" em 10/10 (o sábado antes do feriado de 12/10), depois da implantação
  const eB = real("promocao-semanal", "2026-11-09");
  const edB = criarReal(U.comprador, eB);
  const Bd = edB.id;
  eq("10.2 edição cujo 'começar' é no dia da implantação ou depois: COM penalidade", [eB.prazos.comecar, edB.sem_penalidade, suV(`select sem_penalidade::text from public.encarte_edicoes where id = '${Bd}'`)], ["2026-10-10", false, "false"]);
  recusa("10.3 comprador não tira penalidade", jc(U.comprador, `select public.encarte_marcar_sem_penalidade('${Bd}', 'x')`), "sem_permissao", "42501");
  recusa("10.4 master sem motivo: recusa", jc(U.master, `select public.encarte_marcar_sem_penalidade('${Bd}', '')`), "motivo_obrigatorio", "22023");
  eq("10.5 master com motivo: tira a penalidade e registra", [jc(U.master, `select public.encarte_marcar_sem_penalidade('${Bd}', 'edição de transição')`).mudou,
    suV(`select sem_penalidade::text from public.encarte_edicoes where id = '${Bd}'`), contaEv(`e.edicao_id = '${Bd}' and e.tipo = 'sem_penalidade'`)], [true, "true", 1]);
  eq("10.6 marcar de novo não faz nada", jc(U.master, `select public.encarte_marcar_sem_penalidade('${Bd}', 'de novo')`).mudou, false);

  // ======================================================================
  console.log("\n=== 11. Calendário: pausar, criar, editar — só master, com histórico ===\n");
  recusa("11.1 comprador NÃO pausa campanha", jc(U.comprador, `select public.calendario_mudar_situacao('tercou', 'pausada')`), "sem_permissao", "42501");
  recusa("11.2 leitura NÃO pausa campanha", jc(U.leitura, `select public.calendario_mudar_situacao('tercou', 'pausada')`), "sem_permissao", "42501");
  const nHist = Number(suV("select count(*) from public.calendario_regras_historico"));
  const pz = jc(U.master, `select public.calendario_mudar_situacao('tercou', 'pausada')`);
  eq("11.3 master pausa o Terçou", [pz.mudou, suV("select situacao from public.calendario_regras where id = 'tercou'")], [true, "pausada"]);
  const hPz = suJ(`select row_to_json(h) from public.calendario_regras_historico h where regra_id = 'tercou' order by id desc limit 1`);
  eq("11.4 histórico da pausa: antes ativa, depois pausada, quem fez", [hPz.antes.situacao, hPz.depois.situacao, hPz.por, hPz.por_nome], ["ativa", "pausada", U.master, "Dono Teste"]);
  eq("11.5 pausar de novo não grava outro histórico", [jc(U.master, `select public.calendario_mudar_situacao('tercou', 'pausada')`).mudou,
    Number(suV("select count(*) from public.calendario_regras_historico"))], [false, nHist + 1]);
  recusa("11.6 campanha pausada não gera edição NOVA", criarReal(U.comprador, real("tercou", "2026-11-03")), "campanha_pausada", "55000");
  eq("11.7 ... e a edição que já existia continua lá (pausar afeta só o futuro)", suV(`select situacao from public.encarte_edicoes where id = '${edT.id}'`), "ativa");
  recusa("11.8 situação inventada: recusa", jc(U.master, `select public.calendario_mudar_situacao('tercou', 'dormindo')`), "dado_invalido", "22023");
  jc(U.master, `select public.calendario_mudar_situacao('tercou', 'ativa')`);
  const nova = jc(U.master, `select public.calendario_salvar_regra(null, ${lit({ nome: "Semana do Cliente", tipo: "data", categoria: "media",
    regra: { tipo: "anual_fixa", mes: 10, dia: 5, duracao_dias: 1 }, cor: "#123456", setor: "Geral" })})`);
  eq("11.9 master cria campanha nova (id 'usr-...')", [nova.criada, /^usr-[0-9a-f]{12}$/.test(nova.id)], [true, true]);
  eq("11.10 histórico da criação: antes vazio, depois com o nome", suV(`select coalesce(antes::text, 'NULO') || '|' || (depois->>'nome') from public.calendario_regras_historico where regra_id = '${nova.id}'`), "NULO|Semana do Cliente");
  const edita = jc(U.master, `select public.calendario_salvar_regra('${nova.id}', ${lit({ observacao: "só oportunidade" })})`);
  eq("11.11 editar só o que veio (o resto fica)", [edita.criada, suV(`select nome || '|' || observacao || '|' || (regra->>'dia') from public.calendario_regras where id = '${nova.id}'`)],
    [false, "Semana do Cliente|só oportunidade|5"]);
  recusa("11.12 regra de data com tipo desconhecido: recusa", jc(U.master, `select public.calendario_salvar_regra(null, ${lit({ nome: "X", tipo: "data", regra: { tipo: "lunar" } })})`), "regra_invalida", "22023");
  recusa("11.13 regra semanal com dia da semana 9: recusa", jc(U.master, `select public.calendario_salvar_regra(null, ${lit({ nome: "X", tipo: "campanha", regra: { tipo: "semanal", dia_semana: 9 } })})`), "regra_invalida", "22023");
  recusa("11.14 cor fora do formato: recusa", jc(U.master, `select public.calendario_salvar_regra(null, ${lit({ nome: "X", tipo: "data", regra: { tipo: "datas", lista: [] }, cor: "azul" })})`), "dado_invalido", "22023");
  recusa("11.15 situação não entra por aqui (é pausar/ativar): recusa", jc(U.master, `select public.calendario_salvar_regra('tercou', ${lit({ situacao: "pausada" })})`), "campo_desconhecido", "22023");
  recusa("11.16 comprador NÃO cria campanha", jc(U.comprador, `select public.calendario_salvar_regra(null, ${lit({ nome: "X", tipo: "data", regra: { tipo: "datas", lista: [] } })})`), "sem_permissao", "42501");
  const regras = [
    { tipo: "mensal_nth", n: 2, dia_semana: 6, duracao_dias: 2 }, { tipo: "mensal_ultimo", dia_semana: 4, duracao_dias: 1 },
    { tipo: "anual_nth", mes: 5, n: 2, dia_semana: 0, duracao_dias: 1 }, { tipo: "anual_ultimo", mes: 11, dia_semana: 5 },
    { tipo: "pascoa", deslocamento_dias: -48, duracao_dias: 2 }, { tipo: "semanal", dia_semana: 1, duracao_dias: 8 }];
  eq("11.16b os outros 6 tipos de regra da seção 2 são aceitos (anual_fixa e datas já provados em 11.9 e 11.17)",
    regras.map((rg) => jc(U.master, `select public.calendario_salvar_regra(null, ${lit({ nome: "Regra " + rg.tipo, tipo: "campanha", regra: rg })})`).criada).join(","),
    "true,true,true,true,true,true");
  recusa("11.16c Páscoa sem deslocamento: recusa", jc(U.master, `select public.calendario_salvar_regra(null, ${lit({ nome: "X", tipo: "data", regra: { tipo: "pascoa" } })})`), "regra_invalida", "22023");
  // deslocamento vale em QUALQUER tipo (a Black Friday é o dia seguinte à 4ª quinta)
  const comDesl = [REGRA_BF_NOVA, { tipo: "semanal", dia_semana: 1, deslocamento_dias: 2, duracao_dias: 1 },
    { tipo: "anual_fixa", mes: 12, dia: 24, deslocamento_dias: -400, duracao_dias: 1 }, { tipo: "mensal_ultimo", dia_semana: 4, deslocamento_dias: 400 }];
  eq("11.16d deslocamento aceito em qualquer tipo (anual_nth, semanal, anual_fixa, mensal_ultimo), de -400 a 400 dias",
    comDesl.map((rg) => jc(U.master, `select public.calendario_salvar_regra(null, ${lit({ nome: "Desl " + rg.tipo, tipo: "data", regra: rg })})`).criada).join(","),
    "true,true,true,true");
  recusa("11.16e deslocamento de 401 dias: recusa", jc(U.master, `select public.calendario_salvar_regra(null, ${lit({ nome: "X", tipo: "data", regra: { tipo: "anual_fixa", mes: 1, dia: 1, deslocamento_dias: 401 } })})`), "regra_invalida", "22023");
  recusa("11.16f deslocamento quebrado (1,5 dia): recusa", jc(U.master, `select public.calendario_salvar_regra(null, ${lit({ nome: "X", tipo: "data", regra: { tipo: "anual_fixa", mes: 1, dia: 1, deslocamento_dias: 1.5 } })})`), "valor_invalido", "22023");
  const bfRegra = suJ("select regra from public.calendario_regras where id = 'black-friday'");
  eq("11.16g Black Friday pela regra do banco, contada pelo calculo.cjs: o dia seguinte à 4ª quinta (2029 = 23/11, não 30/11)",
    [2026, 2027, 2028, 2029, 2030].map((a) => (ENC.ocorrencias(bfRegra, a + "-11-01", a + "-11-30")[0] || {}).inicio),
    ["2026-11-27", "2027-11-26", "2028-11-24", "2029-11-23", "2030-11-29"]);
  eq("11.16h o banco reconhece as mesmas datas como ocorrência (e NÃO a 'última sexta' de 2029, 30/11)",
    suV(`select string_agg(public.encarte__bate_com_regra(r.regra, d.x, d.x)::text, ',' order by d.i) from public.calendario_regras r,
          unnest(array['2026-11-27','2027-11-26','2028-11-24','2029-11-23','2030-11-29','2029-11-30']::date[]) with ordinality as d(x, i)
         where r.id = 'black-friday'`), "true,true,true,true,true,false");
  const volta = jc(U.master, `select public.calendario_salvar_regra('volta-as-aulas', ${lit({ regra: { tipo: "datas", lista: [{ inicio: "2027-02-01", fim: "2027-02-20" }] } })})`);
  eq("11.17 master configura o período da Volta às Aulas do ano", [volta.criada, suV(`select regra->'lista'->0->>'inicio' from public.calendario_regras where id = 'volta-as-aulas'`)], [false, "2027-02-01"]);

  // ======================================================================
  console.log("\n=== 12. Modelo: só master, versão, vale só para edição que ainda vai nascer ===\n");
  // a Hora da Economia de 29/10 nasce ANTES de o modelo mudar
  const edH1 = criarReal(U.comprador, real("hora-da-economia", "2026-10-29"));
  const H1 = edH1.id;
  vale("12.0 a Hora da Economia de 29/10 nasce com o modelo de hoje (versão 1)", edH1.criada === true && edH1.vagas === 24, JSON.stringify(edH1));
  const estrHE = { grupos: [{ chave: "capa", nome: "Capa", vagas: [{ chave: "arroz", nome: "Arroz", quantidade: 1, obrigatoria: true }, { chave: "oleo", nome: "Óleo", quantidade: 3 }] }] };
  recusa("12.1 comprador NÃO edita modelo", jc(U.comprador, `select public.encarte_salvar_modelo('hora-da-economia', ${lit(estrHE)}, null, 1)`), "sem_permissao", "42501");
  recusa("12.2 versão vista velha: recusa versao_mudou", jc(U.master, `select public.encarte_salvar_modelo('tema-natal', ${lit(estrHE)}, '{}'::jsonb, 1)`), "versao_mudou", "40001");
  recusa("12.3 grupo sem chave: recusa", jc(U.master, `select public.encarte_salvar_modelo('hora-da-economia', ${lit({ grupos: [{ nome: "Capa" }] })}, null, 1)`), "estrutura_invalida", "22023");
  recusa("12.4 chave de grupo repetida: recusa", jc(U.master, `select public.encarte_salvar_modelo('hora-da-economia', ${lit({ grupos: [{ chave: "a", nome: "A" }, { chave: "a", nome: "B" }] })}, null, 1)`), "estrutura_invalida", "22023");
  recusa("12.5 prazos do modelo fora de ordem (definir > começar): recusa", jc(U.master, `select public.encarte_salvar_modelo('hora-da-economia', ${lit(estrHE)}, ${lit({ comecar: 10, definir: 20, aprovar: 5 })}, 1)`), "prazos_invalidos", "22023");
  // número do desenho do modelo tem de ser INTEIRO: "2.0", "2,0" e 1e1 passavam na
  // validação e depois quebravam a criação de TODA edição da campanha (erro cru, em inglês)
  const salvarCru = (id, estrTxt, prazosTxt) => jc(U.master, `select public.encarte_salvar_modelo('${id}', $j$${estrTxt}$j$::jsonb, ${prazosTxt ? "$j$" + prazosTxt + "$j$::jsonb" : "null"}, 1)`);
  const vg = (qtd) => `{"grupos":[{"chave":"capa","nome":"Capa","vagas":[{"chave":"a","nome":"Arroz","quantidade":${qtd}}]}]}`;
  recusa("12.5b quantidade 2.0 no modelo: recusa (antes era salva)", salvarCru("hora-da-economia", vg("2.0")), "valor_invalido", "22023");
  recusa("12.5c quantidade \"2,0\" no modelo: recusa", salvarCru("hora-da-economia", vg('"2,0"')), "valor_invalido", "22023");
  // (o número 1e1 SEM aspas o próprio Postgres guarda como 10, um inteiro de verdade; em texto, recusa)
  recusa("12.5d quantidade \"1e1\" no modelo: recusa", salvarCru("hora-da-economia", vg('"1e1"')), "valor_invalido", "22023");
  recusa("12.5e período do grupo com 0.0: recusa", salvarCru("tercou", `{"grupos":[{"chave":"h","nome":"H","periodo":{"ini_offset":0.0,"fim_offset":1}}]}`), "valor_invalido", "22023");
  recusa("12.5f prazo do grupo com 4.0: recusa", salvarCru("tercou", `{"grupos":[{"chave":"h","nome":"H","prazos":{"comecar":4.0,"definir":1,"aprovar":1}}]}`), "valor_invalido", "22023");
  recusa("12.5g prazo do modelo com 35.0: recusa", salvarCru("hora-da-economia", vg("1"), `{"comecar":35.0,"definir":21,"aprovar":14}`), "valor_invalido", "22023");
  eq("12.5h nenhuma dessas recusas mexeu nos modelos (continuam na versão 1)",
    suV("select string_agg(id || '=' || versao, ',' order by id) from public.encarte_modelos where id in ('hora-da-economia','tercou')"), "hora-da-economia=1,tercou=1");
  const vagasH1 = suV(`select count(*) from public.encarte_vagas where edicao_id = '${H1}'`);
  const sm = jc(U.master, `select public.encarte_salvar_modelo('hora-da-economia', ${lit(estrHE)}, ${lit({ comecar: "35", definir: 21, aprovar: 14 })}, 1)`);
  eq("12.6 master salva: versão 2 e uma linha nova no histórico",
    [sm.versao, suV(`select count(*) || '|' || max(versao) || '|' || (select por_nome from public.encarte_modelos_historico where modelo_id = 'hora-da-economia' and versao = 2)
          from public.encarte_modelos_historico where modelo_id = 'hora-da-economia'`)], [2, "2|2|Dono Teste"]);
  eq("12.6b prazos do modelo gravados como números (\"35\" vira 35)", suJ(`select prazos from public.encarte_modelos where id = 'hora-da-economia'`), { aprovar: 14, comecar: 35, definir: 21 });
  eq("12.7 a edição que JÁ existia não muda (continua versão 1, mesmas vagas)",
    suV(`select modelo_versao || '|' || (select count(*) from public.encarte_vagas where edicao_id = '${H1}') from public.encarte_edicoes where id = '${H1}'`), "1|" + vagasH1);
  lerRegrasModelos();
  const edG = criarReal(U.comprador, real("hora-da-economia", "2026-11-26"));
  eq("12.8 a edição que nasce DEPOIS usa o modelo novo (1 Arroz + 3 Óleos: 'Óleo', 'Óleo 2', 'Óleo 3')",
    [edG.vagas, suV(`select string_agg(nome, ',' order by ordem) from public.encarte_vagas where edicao_id = '${edG.id}'`), suV(`select modelo_versao from public.encarte_edicoes where id = '${edG.id}'`)],
    [4, "Arroz,Óleo,Óleo 2,Óleo 3", "2"]);

  // ======================================================================
  console.log("\n=== 13. Ação temática e coincidência: só master ===\n");
  recusa("13.1 comprador NÃO cria ação temática", jc(U.comprador, `select public.encarte_criar_grupo_tematico('${A}', 'tema-pascoa')`), "sem_permissao", "42501");
  const gt = jc(U.master, `select public.encarte_criar_grupo_tematico('${A}', 'tema-pascoa', null, '${dia(22)}', '${dia(26)}', null)`);
  eq("13.2 master cria o grupo de Páscoa (modelo sem vagas: zero vagas)", [gt.ok, gt.vagas, gt.chave], [true, 0, "tema-pascoa"]);
  eq("13.3 grupo temático com tipo, tema e período próprio",
    suV(`select tipo || '|' || tema_modelo_id || '|' || nome || '|' || inicio || '|' || fim from public.encarte_grupos where id = '${gt.id}'`),
    "tema|tema-pascoa|Páscoa|" + dia(22) + "|" + dia(26));
  recusa("13.4 a mesma ação duas vezes na mesma edição: recusa", jc(U.master, `select public.encarte_criar_grupo_tematico('${A}', 'tema-pascoa')`), "grupo_ja_existe", "23505");
  const gn = jc(U.master, `select public.encarte_criar_grupo_tematico('${edG.id}', 'tema-natal', 'Natal na HE', null, null, ${lit(prazos(dia(20), dia(30), dia(40)))})`);
  eq("13.5 tema com vagas no modelo: copia só as obrigatórias (Vinho, Vinho 2, Panetone)",
    [gn.vagas, suV(`select string_agg(nome, ',' order by ordem) from public.encarte_vagas where grupo_id = '${gn.id}'`),
      suV(`select prazos->>'definir' from public.encarte_grupos where id = '${gn.id}'`)], [3, "Vinho,Vinho 2,Panetone", dia(30)]);
  recusa("13.6 tema que não existe: recusa", jc(U.master, `select public.encarte_criar_grupo_tematico('${A}', 'tema-inventado')`), "nao_encontrado", "P0002");
  recusa("13.7 comprador NÃO decide coincidência", jc(U.comprador, `select public.encarte_decidir_coincidencia('${Bd}', 'manter')`), "sem_permissao", "42501");
  recusa("13.8 decisão inventada: recusa", jc(U.master, `select public.encarte_decidir_coincidencia('${Bd}', 'sortear')`), "dado_invalido", "22023");
  const mv = jc(U.master, `select public.encarte_decidir_coincidencia('${Bd}', 'mover', '${somar(eB.inicio, 1)}', '${somar(eB.fim, 1)}', null, 'Carnaval: começa na quarta')`);
  eq("13.9 master MOVE só esta edição (a regra da campanha não muda)", [mv.acao,
    suV(`select inicio || '|' || fim || '|' || inicio_regra || '|' || (excecao->'coincidencia'->>'acao') from public.encarte_edicoes where id = '${Bd}'`)],
    ["mover", somar(eB.inicio, 1) + "|" + somar(eB.fim, 1) + "|" + eB.inicio + "|mover"]);
  eq("13.10 depois de mover, a tela pedindo a mesma ocorrência recebe a MESMA edição",
    [criarReal(U.comprador, eB).id], [Bd]);
  const mt = jc(U.master, `select public.encarte_decidir_coincidencia('${A}', 'manter', null, null, null, 'as duas seguem')`);
  eq("13.11 manter: registra a decisão sem mexer nas datas", [mt.acao, suV(`select inicio || '|' || (excecao->'coincidencia'->>'motivo') from public.encarte_edicoes where id = '${A}'`)],
    ["manter", eA.inicio + "|as duas seguem"]);
  recusa("13.12 juntar sem dizer com qual: recusa", jc(U.master, `select public.encarte_decidir_coincidencia('${Bd}', 'juntar')`), "dado_invalido", "22023");
  const jt = jc(U.master, `select public.encarte_decidir_coincidencia('${Bd}', 'juntar', null, null, '${A}', 'uma edição só')`);
  eq("13.13 juntar: a edição fica 'juntada' apontando a outra", [jt.acao, suV(`select situacao || '|' || (excecao->>'juntada_em') from public.encarte_edicoes where id = '${Bd}'`)],
    ["juntar", "juntada|" + A]);
  recusa("13.14 edição juntada não recebe mais proposta", reg(U.comprador, vagaDe(Bd, "capa", "Café"), base), "edicao_inativa", "55000");
  recusa("13.15 edição juntada não recebe outra decisão", jc(U.master, `select public.encarte_decidir_coincidencia('${Bd}', 'manter')`), "edicao_inativa", "55000");
  eq("13.16 cada decisão ficou no livro", contaEv(`e.tipo = 'coincidencia_decidida'`), 3);

  // ======================================================================
  console.log("\n=== 14. Busca de produtos: teto, acento, EAN, código ===\n");
  let bq = jc(U.leitura, `select public.encarte_buscar_produtos('cafe')`);
  eq("14.1 sem limite: devolve 20 (o padrão)", [bq.quantidade, bq.limite], [20, 20]);
  bq = jc(U.leitura, `select public.encarte_buscar_produtos('cafe', null, null, 500)`);
  eq("14.2 pedindo 500: o TETO é 50", [bq.quantidade, bq.limite], [50, 50]);
  eq("14.3 os que mais venderam vêm primeiro", bq.produtos.slice(0, 2).map((p) => p.produto_id), [1001, 1002]);
  bq = jc(U.leitura, `select public.encarte_buscar_produtos('Café Pilão')`);
  eq("14.4 acento e maiúscula não atrapalham ('Café Pilão' acha 'CAFE PILAO')", bq.produtos.map((p) => p.produto_id), [1001]);
  bq = jc(U.leitura, `select public.encarte_buscar_produtos('acucar')`);
  eq("14.4b descrição COM acento no VR ('AÇÚCAR') é achada digitando sem acento ('acucar')", bq.produtos.map((p) => p.produto_id), [1007]);
  bq = jc(U.leitura, `select public.encarte_buscar_produtos('Açúcar cristal')`);
  eq("14.4c ... e digitando com acento ('Açúcar cristal')", bq.produtos.map((p) => p.produto_id), [1007]);
  bq = jc(U.leitura, `select public.encarte_buscar_produtos('7896089011111')`);
  eq("14.5 EAN exato acha o produto", bq.produtos.map((p) => p.produto_id), [1001]);
  bq = jc(U.leitura, `select public.encarte_buscar_produtos('7890000000000999')`);
  eq("14.6 número comprido que não existe: lista vazia, sem erro (não estoura o inteiro)", [bq.ok, bq.quantidade], [true, 0]);
  bq = jc(U.leitura, `select public.encarte_buscar_produtos('1004')`);
  eq("14.7 código do VR exato vem primeiro", bq.produtos[0] && bq.produtos[0].produto_id, 1004);
  bq = jc(U.leitura, `select public.encarte_buscar_produtos('', 42)`);
  eq("14.8 filtro por setor (m1 = 42, Açougue)", bq.produtos.map((p) => p.produto_id), [1004]);
  bq = jc(U.leitura, `select public.encarte_buscar_produtos('c')`);
  eq("14.9 uma letra só: não varre a ficha", [bq.quantidade, bq.motivo], [0, "texto_curto"]);
  bq = jc(U.leitura, `select public.encarte_buscar_produtos('100%_')`);
  eq("14.10 % e _ digitados não viram curinga", [bq.ok, bq.quantidade], [true, 0]);
  bq = jc(U.leitura, `select public.encarte_buscar_produtos('alcatra')`);
  eq("14.11 devolve as colunas da ficha (custo, custo_confiavel, eans...) e não a impressão interna",
    [bq.produtos[0].custo, bq.produtos[0].custo_confiavel, bq.produtos[0].eans, "impressao" in bq.produtos[0], "exato" in bq.produtos[0]],
    [39, false, ["2000000001004"], false, false]);
  // EAN com zero na frente: o VR guarda o código como NÚMERO, então o robô grava sem os zeros
  r = com(null, `insert into public.encarte_produtos_vr (produto_id, descricao, eans, custo, custo_confiavel, preco_normal, venda30_valor, impressao)
      values (5001, 'SARDINHA TESTE 125G', array['12345678905'], 5, true, 9, 1, 's1'),
             (5002, 'MILHO VERDE TESTE 200G', array['47400179240'], 3, true, 5, 2, 's2')`, "service_role");
  vale("14.12 robô grava produtos com o EAN sem o zero da frente (como o VR guarda)", r.ok, r.ok ? "" : r.msg);
  bq = jc(U.leitura, `select public.encarte_buscar_produtos('012345678905')`);
  eq("14.13 código digitado como está impresso (UPC-A de 12, '012345678905') acha o produto", bq.produtos.map((p) => p.produto_id), [5001]);
  bq = jc(U.leitura, `select public.encarte_buscar_produtos('0012345678905')`);
  eq("14.14 código lido com 13 dígitos ('0012345678905') também acha", bq.produtos.map((p) => p.produto_id), [5001]);
  bq = jc(U.leitura, `select public.encarte_buscar_produtos('12345678905')`);
  eq("14.15 ... e sem o zero, como está gravado, continua achando", bq.produtos.map((p) => p.produto_id), [5001]);
  bq = jc(U.leitura, `select public.encarte_buscar_produtos('047400179240')`);
  eq("14.16 outro UPC com o 0 perdido ('047400179240') acha o dele e só ele", bq.produtos.map((p) => p.produto_id), [5002]);
  eq("14.17 a comparação com e sem zeros usa o índice gin do EAN (não varre a ficha)",
    /encarte_produtos_vr_eans_idx/.test(rodar(`begin; set local enable_seqscan = off; explain (costs off) select 1 from public.encarte_produtos_vr f
        where f.eans && array['012345678905', ltrim('012345678905', '0')]; commit;`).saida), true);

  // ======================================================================
  console.log("\n=== 15. Conferência final do arquivo ===\n");
  eq("15.1 ninguém logado ganhou permissão de escrita em tabela nenhuma",
    suV(`select count(*) from information_schema.role_table_grants where grantee in ('anon','authenticated') and table_schema = 'public'
          and (table_name like 'encarte_%' or table_name like 'calendario_regras%') and privilege_type <> 'SELECT'`), "0");
  eq("15.2 anon não tem permissão nenhuma nas tabelas do módulo",
    suV(`select count(*) from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public'
          and (table_name like 'encarte_%' or table_name like 'calendario_regras%')`), "0");
  eq("15.3 ajudantes internos (encarte__*, calendario__*): os 34 existem e NENHUM é chamável por quem está logado",
    suV(`select count(*) || '/' || count(*) filter (where has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and (p.proname like 'encarte\\_\\_%' or p.proname like 'calendario\\_\\_%')`), "34/0");
  const sint = (() => {
    try { require.resolve("libpg-query", { paths: [RAIZ] }); } catch (e) { return null; }
    return spawnSync(process.execPath, [path.join(RAIZ, "scripts", "conferir-sintaxe-sql.cjs"), path.join(RAIZ, "sql", "encartes_v1.sql")], { encoding: "utf8", cwd: RAIZ });
  })();
  if (sint) vale("15.4 analisador de sintaxe do Postgres (libpg_query) aceita o arquivo", sint.status === 0, (sint.stdout || "").split("\n")[0]);
  else console.log("  (libpg-query não instalado: pulei a conferência de sintaxe por fora)");

  // quem tem SÓ a página Calendário: lê o que a Operação precisa e NADA do miolo do encarte
  // (os dois lados, com todas as tabelas já com dado dentro)
  const operacao = ["encarte_edicoes", "encarte_grupos", "encarte_modelos", "calendario_regras", "calendario_regras_historico"];
  const miolo = ["encarte_vagas", "encarte_propostas", "encarte_produtos_vr", "encarte_aprovacoes", "encarte_eventos",
    "encarte_config", "encarte_sync", "encarte_modelos_historico"];
  eq("15.5 só Calendário LÊ edições, grupos e modelos (todas as linhas) e o Calendário",
    operacao.map((t) => conta(U.calendario, t) === suV(`select count(*) from public.${t}`) && Number(conta(U.calendario, t)) > 0).join(","),
    operacao.map(() => true).join(","));
  eq("15.6 ... e NÃO lê vagas, propostas, ficha do VR, aprovações, eventos, configuração, sincronia nem histórico dos modelos",
    miolo.map((t) => conta(U.calendario, t)).join(","), miolo.map(() => "0").join(","));
  eq("15.7 o outro lado: essas 8 tabelas TÊM dado, e a leitura de Encartes vê tudo",
    miolo.map((t) => Number(conta(U.leitura, t)) > 0).join(","), miolo.map(() => true).join(","));
  eq("15.8 forasteiro (sem Calendário nem Encartes) continua sem ver edições, grupos e modelos",
    ["encarte_edicoes", "encarte_grupos", "encarte_modelos"].map((t) => conta(U.forasteiro, t)).join(","), "0,0,0");

  // ======================================================================
  console.log("\n=== 16. Rodar o arquivo de novo com tudo dentro (3ª, 4ª e 5ª vez) e a correção da Black Friday ===\n");
  // um banco que rodou o arquivo ANTIGO: Black Friday com a regra velha, e ninguém mexeu nela
  su(`update public.calendario_regras set regra = '${JSON.stringify(REGRA_BF_VELHA)}'::jsonb where id = 'black-friday'`);
  const retrato = () => JSON.parse(suV(`select json_build_object(
    'edicoes', (select count(*) from public.encarte_edicoes), 'grupos', (select count(*) from public.encarte_grupos),
    'vagas', (select count(*) from public.encarte_vagas), 'propostas', (select count(*) from public.encarte_propostas),
    'eventos', (select count(*) from public.encarte_eventos), 'aprovacoes', (select count(*) from public.encarte_aprovacoes),
    'regras', (select count(*) from public.calendario_regras), 'modelos', (select md5(string_agg(id || versao || estrutura::text || prazos::text, ',' order by id)) from public.encarte_modelos),
    'hist_modelos', (select count(*) from public.encarte_modelos_historico), 'hist_regras', (select count(*) from public.calendario_regras_historico),
    'pausadas', (select string_agg(id, ',' order by id) from public.calendario_regras where situacao = 'pausada'),
    'implantado_em', (select valor #>> '{}' from public.encarte_config where chave = 'implantado_em'),
    'bf', (select regra from public.calendario_regras where id = 'black-friday'))`));
  const sem = (o, ks) => { const c = Object.assign({}, o); ks.forEach((k) => delete c[k]); return JSON.stringify(c); };
  const r2 = retrato();
  const inst3 = instalar();
  const r3 = retrato();
  vale("16.1 3ª rodada, com dado dentro, rodou inteira e a conferência diz OK em tudo",
    inst3.r.ok && inst3.linhas.length === 15 && inst3.linhas.every((l) => /\|OK( - .*)?$/.test(l)),
    inst3.r.ok ? (inst3.linhas.filter((l) => !/\|OK( - .*)?$/.test(l)).join(" ; ") || "todos OK") : inst3.r.erro.split("\n").slice(0, 4).join(" | "));
  eq("16.2 a Black Friday antiga (e intocada) foi corrigida para o dia seguinte à 4ª quinta", canon(r3.bf), canon(REGRA_BF_NOVA));
  const hBf = suJ(`select coalesce(jsonb_agg(jsonb_build_object('antes', antes->'regra', 'depois', depois->'regra', 'por', por, 'por_nome', por_nome) order by id), '[]')
      from public.calendario_regras_historico where regra_id = 'black-friday'`);
  eq("16.3 ... e a troca ficou no histórico (antes = antiga, depois = nova), sem apagar nada",
    [hBf.length, canon(hBf[0] && hBf[0].antes), canon(hBf[0] && hBf[0].depois), hBf[0] && hBf[0].por, hBf[0] && hBf[0].por_nome, r3.hist_regras - r2.hist_regras],
    [1, canon(REGRA_BF_VELHA), canon(REGRA_BF_NOVA), null, "correção do ponto de partida", 1]);
  eq("16.4 ... e NADA mais mudou (edições, vagas, propostas, eventos, aprovações, campanhas, pausas, modelos, implantação)",
    sem(r3, ["bf", "hist_regras"]), sem(r2, ["bf", "hist_regras"]));
  const inst4 = instalar();
  const r4 = retrato();
  vale("16.5 4ª rodada: conferência OK e nada muda (nem outra linha no histórico)",
    inst4.r.ok && inst4.linhas.every((l) => /\|OK( - .*)?$/.test(l)) && JSON.stringify(r4) === JSON.stringify(r3), JSON.stringify(r4).slice(0, 160));
  // o DONO volta a regra antiga pela tela (fica no histórico dele): rodar de novo NÃO desfaz
  const bfDono = jc(U.master, `select public.calendario_salvar_regra('black-friday', ${lit({ regra: REGRA_BF_VELHA })})`);
  const inst5 = instalar();
  vale("16.6 5ª rodada: conferência OK", inst5.r.ok && inst5.linhas.every((l) => /\|OK( - .*)?$/.test(l)), inst5.r.ok ? "" : inst5.r.erro.split("\n")[0]);
  eq("16.7 ... e a regra que o DONO mudou na tela não é desfeita", [bfDono.ok, canon(suJ("select regra from public.calendario_regras where id = 'black-friday'"))],
    [true, canon(REGRA_BF_VELHA)]);
  eq("16.8 as rodadas devolveram o relógio de verdade ('hoje' = o dia em Caicó)",
    suV("select public.encarte_hoje()"), suV("select (now() at time zone 'America/Fortaleza')::date"));

  // ======================================================================
  console.log("\n=== 17. O item 15 da conferência pega quem rodar ESTE arquivo no lugar da migração do Final de semana ===\n");
  // ==FDSPROPRIO== Na nuvem, a PS ainda tem o grupo "fim-de-semana" (o arquivo ANTIGO o gravou). Rodar o
  // arquivo novo grava a regra e o modelo do Final de semana, mas NÃO mexe na PS (on conflict do nothing):
  // a semana ficaria em dobro (grupo na PS + edição própria) com a conferência dizendo OK. O item 15 cobra.
  const item15 = (inst) => inst.linhas.find((l) => /^15\|/.test(l)) || "(sem o item 15)";
  const outrosOk = (inst) => inst.linhas.filter((l) => !/^15\|/.test(l)).every((l) => /\|OK( - .*)?$/.test(l));
  const estrPS = suJ(`select estrutura from public.encarte_modelos where id = 'promocao-semanal'`);
  const grupoVelho = { chave: "fim-de-semana", nome: "Fim de semana", identidade: "Final de semana de ofertas", ativo_padrao: true,
    periodo: { ini_offset: 4, fim_offset: 6 }, vagas: [["frango", "Frango", "corte"], ["linguica", "Linguiça", "marca"], ["carne-suina", "Carne suína", "corte"],
      ["bebida", "Bebida", "produto"], ["mercearia", "Mercearia", "produto"], ["conveniencia", "Conveniência", "produto"]]
      .map(([chave, nome, oq]) => ({ chave, nome, o_que_muda: oq, quantidade: 1, obrigatoria: true })) };
  su(`update public.encarte_modelos set estrutura = jsonb_set(estrutura, '{grupos}', (estrutura->'grupos') || ${lit([grupoVelho])}) where id = 'promocao-semanal'`);
  const inst6 = instalar();
  vale("17.1 a PS ainda com o grupo (banco do arquivo antigo) e roda ESTE arquivo: o item 15 dá FALTA e os outros 14 dizem OK",
    inst6.r.ok && inst6.linhas.length === 15 && /^15\|Promoção Semanal sem o grupo do fim de semana\|FALTA - o modelo da Promoção Semanal ainda tem o grupo/.test(item15(inst6)) && outrosOk(inst6),
    item15(inst6));
  eq("17.2 ... e rodar o arquivo de novo NÃO tirou o grupo da PS (quem tira é a migração)",
    suV(`select count(*) from public.encarte_modelos m, jsonb_array_elements(m.estrutura->'grupos') g where m.id = 'promocao-semanal' and g->>'chave' = 'fim-de-semana'`), "1");
  su(`update public.encarte_modelos set estrutura = ${lit(estrPS)} where id = 'promocao-semanal'`);
  // a edição migrada pela metade: grupo 'removido', mas uma vaga esquecida 'ativa' (a PS contaria 37)
  su(`update public.encarte_vagas set situacao = 'ativa' where id = '${vRetX}'`);
  const inst7 = instalar();
  vale("17.3 grupo 'removido' com uma vaga esquecida 'ativa': FALTA, dizendo quantas edições", /^15\|[^|]*\|FALTA - 1 edição\(ões\) da Promoção Semanal ainda com o Fim de semana/.test(item15(inst7)) && outrosOk(inst7), item15(inst7));
  su(`update public.encarte_vagas set situacao = 'retirada' where id = '${vRetX}'`);
  // a edição que a migração não pegou: o grupo ainda 'ativo' (mesmo com as vagas retiradas)
  su(`update public.encarte_grupos set situacao = 'ativo' where id = '${gFdsX}'`);
  const inst8 = instalar();
  vale("17.4 PS com o grupo do fim de semana ainda 'ativo': FALTA", /^15\|[^|]*\|FALTA - 1 edição/.test(item15(inst8)) && outrosOk(inst8), item15(inst8));
  su(`update public.encarte_grupos set situacao = 'removido' where id = '${gFdsX}'`);
  const inst9 = instalar();
  vale("17.5 modelo e edições sem o Fim de semana: os 15 itens voltam a dizer OK",
    inst9.r.ok && inst9.linhas.length === 15 && inst9.linhas.every((l) => /\|OK( - .*)?$/.test(l)), item15(inst9));
} catch (e) {
  console.log("\n  FALHA | o teste parou no meio: " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e));
  falhou++;
} finally {
  B.derrubar(pg);
  try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (e) {}
}

console.log("\n" + (falhou ? "FALHOU" : "PASSOU") + " — " + ok + " conferências OK, " + falhou + " falha(s).");
process.exit(falhou ? 1 : 0);
