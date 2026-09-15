// ============================================================
// MANUTENÇÃO v2 — O LADO DO BANCO, provado num PostgreSQL TEMPORÁRIO.
//
// Sobe um Postgres de verdade, instala os dublês do Supabase, as tabelas ANTIGAS com os
// dados REAIS do backup de 14/09 (como está hoje em produção), e só então roda os arquivos
// sql/manutencao_v2_1..4 (fase A). Exercita papéis dos DOIS lados, cadastro, lote, versão,
// inativação, exclusão com senha, rotinas, regra de vencimento, execuções, anulação,
// custos, pendências, auditoria, anexos, migração, gerencial, resumo, storage e o corte.
//
//   node scripts/testes/manutencao-v2-banco.test.cjs
//
// NÃO encosta no Supabase de produção.
// ============================================================
const fs = require("fs");
const path = require("path");
const B = require("./apoio/banco-de-teste.cjs");
const RAIZ = path.join(__dirname, "..", "..");
const BACKUP = path.join(RAIZ, "backups", "manutencao-2026-09-14-antes-da-evolucao");

if (!B.temPostgres()) {
  console.log("SEM POSTGRES LOCAL — instale com: brew install postgresql@16");
  process.exit(1);
}

// ---------- gente ----------
const U = {
  master:     "1f26bb81-b9d1-4c2f-9df8-b259477a02e7",   // o master real (autor dos dados antigos)
  gestor:     "20000000-0000-0000-0000-000000000001",   // manutencoes + manutencoes_gestor
  gestorSo:   "20000000-0000-0000-0000-000000000002",   // SÓ manutencoes_gestor
  oper:       "20000000-0000-0000-0000-000000000003",   // manutencoes
  oper2:      "20000000-0000-0000-0000-000000000004",   // manutencoes (responsável de rotina)
  semPagina:  "20000000-0000-0000-0000-000000000005",   // só agenda
  fornecedor: "20000000-0000-0000-0000-000000000006",   // conta do Portal (com a página, de propósito)
  bloqueado:  "20000000-0000-0000-0000-000000000007",   // aprovado=false, com as chaves
  semFicha:   "20000000-0000-0000-0000-000000000008"    // logado sem ficha em perfis
};
const rq = (n) => "70000000-0000-0000-0000-" + String(n).padStart(12, "0");

let ok = 0, falhou = 0;
const pg = B.subir();

function linhaFinal(r) { return r.ok ? r.saida.split("\n").pop() : "ERRO SQL: " + (r.erro.split("\n")[0] || "").trim(); }
// roda como um login de gente: papel authenticated + auth.uid(), numa transação que confirma
function comoR(uid, sql) {
  return B.rodar(pg, `begin; set local role authenticated; select set_config('teste.uid','${uid}',true); ${sql}; commit;`);
}
const como = (uid, sql) => linhaFinal(comoR(uid, sql));
// JSON de uma função chamada por um login
function j(uid, sql) {
  const r = comoR(uid, sql);
  if (!r.ok) return { __erro: (r.erro.split("\n")[0] || "").trim() };
  try { return JSON.parse(r.saida.split("\n").pop()); } catch (e) { return { __erro: "não é JSON: " + r.saida }; }
}
// como o dono do banco (SQL Editor / chave de serviço: sem login)
function su(sql) { return B.rodar(pg, `select set_config('teste.uid','',false); ${sql}`); }
const suV = (sql) => linhaFinal(su(sql));
function suJ(sql) {
  const r = su(sql);
  if (!r.ok) return { __erro: (r.erro.split("\n")[0] || "").trim() };
  return JSON.parse(r.saida.split("\n").pop());
}
const lit = (o) => "$j$" + JSON.stringify(o) + "$j$::jsonb";

function eq(nome, obtido, esperado) {
  const a = typeof obtido === "object" ? JSON.stringify(obtido) : String(obtido);
  const b = typeof esperado === "object" ? JSON.stringify(esperado) : String(esperado);
  const bate = a === b;
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + a.slice(0, 160) + (bate ? "" : "   (esperado: " + b.slice(0, 160) + ")"));
  bate ? ok++ : falhou++;
}
function vale(nome, cond, det) {
  console.log((cond ? "  OK   " : "  FALHA") + " | " + nome + (det !== undefined ? "  ->  " + String(det).slice(0, 200) : ""));
  cond ? ok++ : falhou++;
}
const erroDe = (res) => (res && res.ok === false ? res.erro : (res && res.__erro ? "RAISE: " + res.__erro : "ok"));

// datas relativas ao "hoje da loja" do próprio banco
let HOJE = null;
function dia(n) {
  const d = new Date(HOJE + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const diffDias = (a, b) => Math.round((new Date(a + "T12:00:00Z") - new Date(b + "T12:00:00Z")) / 86400000);

// objeto no depósito (como se a tela tivesse enviado o arquivo): o Storage grava QUEM enviou (owner/owner_id)
function objeto(caminho, dono) {
  const d = dono === null ? "null" : `'${dono || U.oper}'`;
  const r = su(`insert into storage.objects (bucket_id, name, metadata, owner, owner_id) values ('manutencoes', '${caminho}', '{"size": 1000}', ${d}, ${d}) on conflict do nothing`);
  if (!r.ok) throw new Error("objeto: " + r.erro);
}
// vários blocos SQL AO MESMO TEMPO, cada um numa sessão psql própria (concorrência de verdade)
const PSQL = "/opt/homebrew/opt/postgresql@16/bin/psql";
function aoMesmoTempo(blocos) {
  const dir = fs.mkdtempSync(path.join(require("os").tmpdir(), "man2-par-"));
  let script = "";
  blocos.forEach((b, i) => {
    const f = path.join(dir, i + ".sql");
    fs.writeFileSync(f, b.sql);
    script += `(sleep ${b.atraso || 0}; "${PSQL}" -h "${pg.sock}" -U bancada -d fardamento -v ON_ERROR_STOP=1 -t -A -q -f "${f}" > "${f}.out" 2> "${f}.err") & `;
  });
  require("child_process").spawnSync("bash", ["-c", script + "wait"], { env: Object.assign({}, process.env, { LC_ALL: "C", LANG: "C" }) });
  const out = blocos.map((_, i) => ({ saida: fs.readFileSync(path.join(dir, i + ".sql.out"), "utf8"), erro: fs.readFileSync(path.join(dir, i + ".sql.err"), "utf8") }));
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  return out;
}
// uma sessão de login que chama a função e SEGURA a transação aberta por "dormir" segundos
const sessaoLenta = (uid, chamada, dormir) => `begin; set local role authenticated; select set_config('teste.uid','${uid}',true) is null; select ${chamada}; select pg_sleep(${dormir || 0}) is null; commit;`;
const jsonDaSaida = (s) => { const l = String(s || "").split("\n").filter((x) => x.trim().startsWith("{")); try { return JSON.parse(l[l.length - 1]); } catch (e) { return { __erro: String(s).slice(0, 200) }; } };
function registrar(uid, p) { return j(uid, `select public.manutencao_execucao_registrar(${lit(p)})`); }
let nReq = 1000;
function exec(equipamento_id, tipo, data, extra) {
  return Object.assign({
    request_id: rq(nReq++), equipamento_id, tipo_servico: tipo, data_execucao: data,
    executor: { tipo: "interno", ref: "livre", nome: "Laryze" }, resultado: "ok"
  }, extra || {});
}

const EQS = JSON.parse(fs.readFileSync(path.join(BACKUP, "manutencao_equipamentos.json"), "utf8"));
const REGS = JSON.parse(fs.readFileSync(path.join(BACKUP, "manutencao_registros.json"), "utf8"));

try {
  // ============================================================
  console.log("\n=== 0. Produção de hoje: dublês + tabelas antigas com os dados REAIS ===\n");
  // ============================================================
  for (const f of ["scripts/testes/apoio/dubles-supabase.sql", "scripts/testes/apoio/dubles-manutencao.sql", "sql/permissoes_padrao.sql"]) {
    const r = B.rodarArquivo(pg, path.join(RAIZ, f));
    if (!r.ok) throw new Error(f + " falhou:\n" + r.erro);
  }
  let r = su(`insert into public.manutencao_equipamentos select * from jsonb_populate_recordset(null::public.manutencao_equipamentos, ${lit(EQS)});
              insert into public.manutencao_registros   select * from jsonb_populate_recordset(null::public.manutencao_registros,   ${lit(REGS)});`);
  if (!r.ok) throw new Error("backup não entrou: " + r.erro);
  r = su(`insert into public.perfis (id, email, nome, setor, is_master, paginas, aprovado) values
    ('${U.master}','m@t','Gilson','Diretoria',true,'[]',true),
    ('${U.gestor}','g@t','Márcia','Manutenção',false,'["manutencoes","manutencoes_gestor"]',true),
    ('${U.gestorSo}','gs@t','Josué','Manutenção',false,'["manutencoes_gestor"]',true),
    ('${U.oper}','o@t','Laryze','Açougue',false,'["manutencoes","agenda"]',true),
    ('${U.oper2}','o2@t','Cícero','Frios',false,'[ "manutencoes" ]',true),
    ('${U.semPagina}','s@t','Fulano','Entregas',false,'["agenda"]',true),
    ('${U.fornecedor}','f@t','Fornecedor X','',false,'["manutencoes","manutencoes_gestor"]',true),
    ('${U.bloqueado}','b@t','Bloqueado','Açougue',false,'["manutencoes","manutencoes_gestor"]',false);
    insert into public.receb_fornecedor_contas (user_id, nome) values ('${U.fornecedor}','Fornecedor X');`);
  if (!r.ok) throw new Error("perfis: " + r.erro);
  eq("backup carregado: 17 equipamentos e 2 serviços", suV("select (select count(*) from manutencao_equipamentos)||'/'||(select count(*) from manutencao_registros)"), "17/2");

  // ============================================================
  console.log("\n=== 1. Instalação (fase A) — compila e roda 2 vezes ===\n");
  // ============================================================
  for (const f of ["1_estrutura", "2_funcoes", "3_migracao", "4_storage"]) {
    const a = B.rodarArquivo(pg, path.join(RAIZ, "sql", "manutencao_v2_" + f + ".sql"));
    vale("manutencao_v2_" + f + ".sql roda", a.ok, a.ok ? "ok" : a.erro.split("\n").slice(0, 5).join(" | "));
    if (!a.ok) throw new Error("instalação parou");
  }
  for (const f of ["1_estrutura", "2_funcoes", "3_migracao", "4_storage"]) {
    const a = B.rodarArquivo(pg, path.join(RAIZ, "sql", "manutencao_v2_" + f + ".sql"));
    vale("manutencao_v2_" + f + ".sql roda DE NOVO sem quebrar", a.ok, a.ok ? "ok" : a.erro.split("\n").slice(0, 5).join(" | "));
  }
  HOJE = suV("select public.manutencao_hoje()");
  vale("manutencao_hoje() é uma data (America/Fortaleza)", /^\d{4}-\d{2}-\d{2}$/.test(HOJE), HOJE);
  eq("colunas novas não numeraram os 17 antes da migração (codigo vazio)", suV("select count(*) from manutencao_equipamentos where codigo is null"), "17");
  eq("policies antigas de manutencao_equipamentos/registros intactas (4+4)",
     suV("select count(*) from pg_policies where tablename in ('manutencao_equipamentos','manutencao_registros') and policyname in ('pg_sel','pg_ins','pg_upd','pg_del')"), "8");
  eq("status 'ativo' e versão 1 nos 17", suV("select count(*) from manutencao_equipamentos where status='ativo' and versao=1"), "17");

  // ============================================================
  console.log("\n=== 2. Migração com os dados reais do backup ===\n");
  // ============================================================
  let m = j(U.oper, "select public.manutencao_migrar_legado()");
  eq("operacional não migra", erroDe(m), "sem_permissao");
  m = j(U.gestor, "select public.manutencao_migrar_legado()");
  eq("gestor não migra", erroDe(m), "sem_permissao");
  const antesAud = suV("select count(*) from manutencao_auditoria");
  m = suJ("select public.manutencao_migrar_legado()");
  eq("1ª rodada (chave de serviço): contagens", [m.ok, m.codigos_atribuidos, m.rotinas_criadas, m.execucoes_criadas, m.custos_criados, m.anexos_criados], [true, 17, 3, 2, 0, 0]);
  eq("nada pulado", m.pulados, []);
  const ids17 = EQS.map((e) => e.id).sort();
  eq("ids dos equipamentos iguais aos do backup (1 a 1)", suV("select string_agg(id, ',' order by id) from manutencao_equipamentos"), ids17.join(","));
  const cp = suV(`select string_agg(id||'|'||criado_por||'|'||to_char(criado_em at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US'), ',' order by id) from manutencao_equipamentos`);
  eq("criado_por/criado_em dos 17 preservados (valor a valor)", cp, EQS.slice().sort((a, b) => (a.id < b.id ? -1 : 1)).map((e) => e.id + "|" + e.criado_por + "|" + e.criado_em.slice(0, 26)).join(","));
  const ex = suV(`select string_agg(id||'|'||equipamento_id||'|'||data_execucao||'|'||registrado_por||'|'||to_char(registrado_em at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US')||'|'||executor_nome||'|'||resultado||'|'||executor_tipo, ',' order by id) from manutencao_execucoes`);
  eq("2 execuções migradas: mesmo id, equipamento, data, autor e hora de lançamento",
     ex, REGS.slice().sort((a, b) => (a.id < b.id ? -1 : 1)).map((g) => [g.id, g.id_eq, g.data, g.criado_por, g.criado_em.slice(0, 26), g.responsavel, "legado", "legado"].join("|")).join(","));
  eq("registrado_por_nome vem do perfil do autor", suV("select string_agg(distinct registrado_por_nome, ',') from manutencao_execucoes"), "Gilson");
  eq("legado guarda a linha antiga SEM o financeiro (custo e nota ficam nas tabelas próprias)",
     suV("select legado->>'modo' || '/' || (legado ? 'custo') || '/' || (legado ? 'nota_arquivo') || '/' || (legado ? 'nota_nome') || '/' || (legado ? 'obs') from manutencao_execucoes where id='rmram70v6618'"), "serv/false/false/false/true");
  eq("dublê igual ao retrato de produção: FK antiga com ON DELETE CASCADE e as 4 man_fotos_* + a restritiva por página",
     [suV("select pg_get_constraintdef(oid) from pg_constraint where conname='manutencao_registros_id_eq_fkey'"),
      suV("select string_agg(policyname||':'||permissive, ',' order by policyname) from pg_policies where schemaname='storage' and policyname in ('man_fotos_ver','man_fotos_subir','man_fotos_trocar','man_fotos_apagar','man_arquivos_por_pagina')")],
     ["FOREIGN KEY (id_eq) REFERENCES manutencao_equipamentos(id) ON DELETE CASCADE",
      "man_arquivos_por_pagina:RESTRICTIVE,man_fotos_apagar:PERMISSIVE,man_fotos_subir:PERMISSIVE,man_fotos_trocar:PERMISSIVE,man_fotos_ver:PERMISSIVE"]);
  r = comoR(U.master, "delete from public.manutencao_equipamentos where id='emraqg6gz805'");
  eq("fase A: tela antiga apagando equipamento JÁ migrado é recusada (o cascade para no serviço migrado, ou na FK da v2) e os serviços antigos ficam (2.9 item 1)",
     [r.ok, /Serviço já passou para a versão nova; não pode ser apagado\.|violates foreign key constraint/.test(r.erro), suV("select count(*) from manutencao_registros where id_eq='emraqg6gz805'"), suV("select count(*) from manutencao_equipamentos where id='emraqg6gz805'")],
     [false, true, String(REGS.filter((g) => g.id_eq === "emraqg6gz805").length), "1"]);
  // FA-01: "Remover equipamento" (manCloudDelEq: 1º apaga os serviços pelo id_eq, 2º apaga o equipamento) e
  // "Remover serviço" (manCloudDelReg) da tela ANTIGA não apagam serviço que já virou execução
  const passo1 = comoR(U.master, "delete from public.manutencao_registros where id_eq='emr9b5cgj174'");
  const passo2 = comoR(U.master, "delete from public.manutencao_equipamentos where id='emr9b5cgj174'");
  const delReg = comoR(U.master, "delete from public.manutencao_registros where id='rmram70v6618'");
  eq("tela antiga: 'Remover equipamento' (os 2 pedidos) e 'Remover serviço' num serviço JÁ migrado são recusados com aviso e nada some",
     [passo1.ok, /Serviço já passou para a versão nova; não pode ser apagado\./.test(passo1.erro), passo2.ok, delReg.ok, /Serviço já passou para a versão nova/.test(delReg.erro),
      suV("select count(*) from manutencao_registros where id_eq='emr9b5cgj174'"), suV("select count(*) from manutencao_equipamentos where id='emr9b5cgj174'")],
     [false, true, false, false, true, "1", "1"]);
  eq("…e a conferência continua ok (nada travou o corte)", suJ("select public.manutencao_conferir_migracao()").ok, true);
  r = comoR(U.master, `insert into public.manutencao_registros (id,id_eq,data,tipo,responsavel) values ('rmnaomig01','emramf6g8143','${HOJE}','Limpeza','Nilton'),('rmnaomig02','emramf6g8143','${HOJE}','Limpeza','Nilton')`);
  const delNaoMig1 = comoR(U.master, "delete from public.manutencao_registros where id='rmnaomig01'");
  const delNaoMig2 = comoR(U.master, "delete from public.manutencao_registros where id_eq='emramf6g8143'");
  eq("serviço antigo AINDA NÃO migrado continua apagável pela tela antiga (por serviço e pelo 1º pedido do 'Remover equipamento')",
     [r.ok, delNaoMig1.ok, delNaoMig2.ok, suV("select count(*) from manutencao_registros where id_eq='emramf6g8143'")], [true, true, true, "0"]);
  eq("serviço interno migrado NÃO ganha custo (não se aplica)", suV("select count(*) from manutencao_execucoes_custos"), "0");
  eq("3 rotinas migradas", suV(`select string_agg(e.nome||'|'||coalesce(r.tipo_servico,'(a confirmar)')||'|'||r.periodicidade_dias||'|'||coalesce(r.responsavel_nome,'-')||'|'||coalesce(r.responsavel_ref,'-'), ',' order by e.criado_em)
     from manutencao_rotinas r join manutencao_equipamentos e on e.id=r.equipamento_id where r.origem='migracao'`),
     "Camera Fria de Congelado|Limpeza|30|Layze|livre,Balanças Caixa 101|(a confirmar)|7|-|-,Camera Fria Resfriado|Limpeza|30|-|-");
  eq("execuções ligadas à rotina de Limpeza do próprio equipamento, com snapshot da periodicidade",
     suV("select count(*) from manutencao_execucoes x join manutencao_rotinas r on r.id=x.rotina_id where r.equipamento_id=x.equipamento_id and x.periodicidade_snap=30 and x.proxima_prevista_snap = x.data_execucao + 30"), "2");
  eq("códigos na ordem de cadastro: EQ-0001 = Camera Fria de Congelado, EQ-0017 = Balcão Frios",
     suV("select (select nome from manutencao_equipamentos where codigo='EQ-0001')||' / '||(select nome from manutencao_equipamentos where codigo='EQ-0017')"),
     "Camera Fria de Congelado / Balcão Refrigerado Frios");
  eq("auditoria 'migracao' por item (17 códigos + 3 rotinas + 2 execuções)",
     suV(`select count(*) from manutencao_auditoria where acao='migracao' and id > ${antesAud}`), "22");

  const versoes1 = suV("select string_agg(id||':'||versao, ',' order by id) from manutencao_equipamentos");
  const aud1 = suV("select count(*) from manutencao_auditoria");
  m = suJ("select public.manutencao_migrar_legado()");
  eq("2ª rodada não cria nada (idempotente)", [m.codigos_atribuidos, m.rotinas_criadas, m.rotinas_atualizadas, m.execucoes_criadas, m.custos_criados, m.anexos_criados, m.procedimentos_copiados, m.links_copiados], [0, 0, 0, 0, 0, 0, 0, 0]);
  eq("2ª rodada não mexe em versão", suV("select string_agg(id||':'||versao, ',' order by id) from manutencao_equipamentos"), versoes1);
  eq("2ª rodada não polui a auditoria", suV("select count(*) from manutencao_auditoria"), aud1);
  eq("contagens finais: 17 equipamentos, 2 execuções, 3 rotinas",
     suV("select (select count(*) from manutencao_equipamentos)||'/'||(select count(*) from manutencao_execucoes)||'/'||(select count(*) from manutencao_rotinas)"), "17/2/3");
  let c = suJ("select public.manutencao_conferir_migracao()");
  eq("conferir_migracao: ok e sem divergências", [c.ok, c.divergencias, c.referencia_auditoria.igual], [true, [], true]);
  eq("conferir_migracao: operacional recusado", erroDe(j(U.oper, "select public.manutencao_conferir_migracao()")), "sem_permissao");
  vale("conferir_migracao: master logado pode", j(U.master, "select public.manutencao_conferir_migracao()").ok === true);

  // o estado depois da migração, calculado pela regra única
  let painel = j(U.master, "select public.manutencao_painel()");
  const esperadoCamara = (data) => { const prox = dia(0) && (() => { const d = new Date(data + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + 30); return d.toISOString().slice(0, 10); })(); const dd = diffDias(prox, HOJE); return dd < 0 ? "atrasado" : dd === 0 ? "hoje" : dd <= 7 ? "proximo" : "em_dia"; };
  const congel = painel.equipamentos.find((e) => e.id === "emr9b5cgj174");
  eq("Câmara de Congelado: estado pela regra (última 06/07 + 30)", congel.estado + "/" + congel.rotinas[0].proxima, esperadoCamara("2026-07-06") + "/2026-08-05");
  eq("Câmara: dias = próxima − hoje", congel.dias, diffDias("2026-08-05", HOJE));
  eq("Câmara: última execução legada", [congel.ultima_execucao.data, congel.ultima_execucao.executor_nome, congel.ultima_execucao.resultado], ["2026-07-06", "Laryze", "legado"]);
  const b101 = painel.equipamentos.find((e) => e.id === "emrame3xj340");
  eq("Balanças Caixa 101: 'primeira' (sem execução, sem data de início)", [b101.estado, b101.rotinas[0].tipo_servico, b101.rotinas[0].periodicidade_dias], ["primeira", null, 7]);
  eq("contagens: 14 sem programação, 1 aguardando 1ª, 17 ativos",
     [painel.contagens.sem_programacao, painel.contagens.primeira, painel.contagens.equipamentos_ativos], [14, 1, 17]);

  // fase A: a tela ANTIGA continua gravando direto nas tabelas (policies de hoje)
  r = comoR(U.master, `insert into public.manutencao_equipamentos (id,nome,tipo,setor,intervalo) values ('emvelha001','Freezer Tela Antiga','Freezer','Padaria',0)
                         on conflict (id) do update set nome=excluded.nome`);
  vale("tela antiga (fase A) ainda cadastra equipamento direto na tabela", r.ok, r.ok ? "ok" : r.erro);
  eq("equipamento da tela antiga ganha código automático seguinte (EQ-0018)", suV("select codigo from manutencao_equipamentos where id='emvelha001'"), "EQ-0018");
  const seqAntes = suV("select last_value from manutencao_equipamento_codigo_seq");
  for (let i = 0; i < 2; i++) {
    r = comoR(U.master, `insert into public.manutencao_equipamentos (id,nome,tipo,setor,intervalo) values ('emvelha001','Freezer Tela Antiga','Freezer','Padaria',0)
                           on conflict (id) do update set nome=excluded.nome, tipo=excluded.tipo`);
    if (!r.ok) throw new Error("upsert da tela antiga: " + r.erro);
  }
  eq("upsert da tela antiga num equipamento que JÁ existe não queima número de etiqueta (2 gravações, sequência parada)",
     [suV("select last_value from manutencao_equipamento_codigo_seq"), suV("select codigo from manutencao_equipamentos where id='emvelha001'")], [seqAntes, "EQ-0018"]);
  r = comoR(U.master, `insert into public.manutencao_registros (id,id_eq,data,tipo,responsavel,custo,execucao,nota_arquivo,nota_nome) values ('rmvelho001','emvelha001','${dia(-1)}','Manutenção corretiva','TecFrio',350,'externa','nota_rmvelho001.pdf','NF TecFrio.pdf')`);
  vale("tela antiga ainda registra serviço (externo, com custo e nota)", r.ok, r.ok ? "ok" : r.erro);
  objeto("nota_rmvelho001.pdf", U.master);
  r = comoR(U.master, `update public.manutencao_equipamentos set telefone='(84) 3421-0000' where id='emr9b5cgj174'`);
  vale("tela antiga ainda edita equipamento (upsert da linha)", r.ok, r.ok ? "ok" : r.erro);
  c = suJ("select public.manutencao_conferir_migracao()");
  eq("conferir acusa o serviço antigo ainda não migrado", [c.ok, c.divergencias.map((d) => d.tipo + ":" + d.ids.join("|")).join(",")], [false, "registro_sem_execucao:rmvelho001"]);
  m = suJ("select public.manutencao_migrar_legado()");
  eq("rodar de novo pega o que a tela antiga gravou (1 execução + 1 custo + a nota)", [m.execucoes_criadas, m.custos_criados, m.rotinas_criadas, m.anexos_criados], [1, 1, 0, 1]);
  eq("custo antigo > 0 preservado; externa", suV("select custo||'/'||x.executor_tipo||'/'||coalesce(x.rotina_id::text,'avulsa') from manutencao_execucoes_custos c join manutencao_execucoes x on x.id=c.execucao_id where c.execucao_id='rmvelho001'"), "350/legado/avulsa");
  eq("operacional lê a execução migrada, mas o legado não leva custo nem nota (D9)",
     como(U.oper, "select coalesce(legado->>'custo','(sem custo)')||'|'||coalesce(legado->>'nota_arquivo','(sem nota)')||'|'||(legado->>'execucao') from manutencao_execucoes where id='rmvelho001'"), "(sem custo)|(sem nota)|externa");
  c = suJ("select public.manutencao_conferir_migracao()");
  eq("conferir volta a ok (referência da auditoria agora difere, só informativo)", [c.ok, c.referencia_auditoria.igual], [true, false]);

  // a tela antiga continua no ar: mudou "a cada N dias" e responsável -> a rotina migrada (sem mexida na v2) acompanha
  const rotResf = () => suV("select periodicidade_dias||'/'||coalesce(responsavel_nome,'-')||'/'||coalesce(responsavel_ref,'-') from manutencao_rotinas where equipamento_id='emraqg6gz805' and origem='migracao'");
  r = comoR(U.master, `update public.manutencao_equipamentos set intervalo=15, responsavel='Maria' where id='emraqg6gz805'`);
  m = suJ("select public.manutencao_migrar_legado()");
  eq("tela antiga muda para 15 dias e Maria: a migração atualiza a rotina migrada e a conferência fecha",
     [m.rotinas_atualizadas, rotResf(), suJ("select public.manutencao_conferir_migracao()").ok,
      suV("select acao from manutencao_auditoria where entidade='rotina' and depois->>'responsavel_nome'='Maria' order by id desc limit 1")], [1, "15/Maria/livre", true, "migracao"]);
  r = comoR(U.master, `update public.manutencao_equipamentos set intervalo=30, responsavel='' where id='emraqg6gz805'`);
  m = suJ("select public.manutencao_migrar_legado()");
  eq("…e volta junto quando a tela antiga desfaz", [m.rotinas_atualizadas, rotResf()], [1, "30/-/-"]);

  // FA-02: a tela antiga TIRA o "a cada N dias" (0): a rotina migrada sem mexida na v2 é desativada; se voltar, reativa
  const rotResfAtiva = () => suV("select ativa||'/'||periodicidade_dias||'/'||coalesce(desativada_motivo,'-') from manutencao_rotinas where equipamento_id='emraqg6gz805' and origem='migracao'");
  const estResf = () => j(U.master, "select public.manutencao_painel()").equipamentos.find((e) => e.id === "emraqg6gz805").estado;
  r = comoR(U.master, `update public.manutencao_equipamentos set intervalo=0 where id='emraqg6gz805'`);
  c = suJ("select public.manutencao_conferir_migracao()");
  eq("tela antiga tira a programação (0): a conferência acusa a rotina migrada que sobrou ativa",
     [r.ok, c.ok, c.divergencias.map((d) => d.tipo + ":" + d.ids.join("|")).join(",")], [true, false, "rotina_migrada_sem_intervalo:emraqg6gz805"]);
  m = suJ("select public.manutencao_migrar_legado()");
  eq("…a migração desativa a rotina migrada (motivo gravado, conta em rotinas_atualizadas), o painel mostra 'sem programação' e a conferência fecha",
     [m.rotinas_atualizadas, rotResfAtiva(), estResf(), suJ("select public.manutencao_conferir_migracao()").ok,
      suV("select acao||'|'||justificativa from manutencao_auditoria where entidade='rotina' and equipamento_id='emraqg6gz805' and depois->>'ativa'='false' order by id desc limit 1")],
     [1, "false/30/Programação retirada na tela antiga", "sem_programacao", true, "migracao|Programação retirada na tela antiga"]);
  eq("…rodar a migração de novo não mexe", suJ("select public.manutencao_migrar_legado()").rotinas_atualizadas, 0);
  r = comoR(U.master, `update public.manutencao_equipamentos set intervalo=30 where id='emraqg6gz805'`);
  m = suJ("select public.manutencao_migrar_legado()");
  eq("…a programação volta na tela antiga: a MESMA rotina é reativada (nada novo) e o equipamento volta a cobrar",
     [r.ok, m.rotinas_atualizadas, m.rotinas_criadas, rotResfAtiva(), suV("select count(*) from manutencao_rotinas where equipamento_id='emraqg6gz805'"), estResf(), suJ("select public.manutencao_conferir_migracao()").ok],
     [true, 1, 0, "true/30/-", "1", "atrasado", true]);

  // procedimento/link copiados da tela antiga não voltam depois que o gestor apaga na v2
  r = comoR(U.master, `update public.manutencao_equipamentos set manual='Texto errado do manual', link_manual='https://errado.exemplo/m.pdf' where id='emvelha001'`);
  m = suJ("select public.manutencao_migrar_legado()");
  const velha = () => suV("select coalesce(procedimento,'NULL')||'|'||coalesce(link_fabricante,'NULL') from manutencao_equipamentos where id='emvelha001'");
  eq("1ª cópia do manual antigo", [m.procedimentos_copiados, m.links_copiados, velha()], [1, 1, "Texto errado do manual|https://errado.exemplo/m.pdf"]);
  const svVelha = j(U.gestor, `select public.manutencao_equipamento_salvar(${lit({ id: "emvelha001", versao: Number(suV("select versao from manutencao_equipamentos where id='emvelha001'")), nome: "Freezer Tela Antiga", tipo: "Freezer", setor: "Padaria", procedimento: "", link_fabricante: "" })})`);
  eq("gestor apaga procedimento e link na tela nova", [svVelha.ok, velha()], [true, "NULL|NULL"]);
  m = suJ("select public.manutencao_migrar_legado()");
  eq("rodar a migração de novo NÃO traz de volta o que o gestor apagou", [m.procedimentos_copiados, m.links_copiados, velha()], [0, 0, "NULL|NULL"]);

  // ============================================================
  console.log("\n=== 3. Papéis dos DOIS lados: todas as funções e todas as tabelas ===\n");
  // ============================================================
  const rpc = (uid, fn, args) => j(uid, `select public.${fn}(${args || ""})`);
  const papel = (uid) => como(uid, "select coalesce(public.manutencao_papel(),'(nenhum)')");
  eq("papéis: master, gestor, só-gestor, operacional x2",
     [papel(U.master), papel(U.gestor), papel(U.gestorSo), papel(U.oper), papel(U.oper2)], ["master", "gestor", "gestor", "operacional", "operacional"]);
  eq("papéis: sem página, fornecedor, bloqueado, sem ficha = nenhum",
     [papel(U.semPagina), papel(U.fornecedor), papel(U.bloqueado), papel(U.semFicha)], ["(nenhum)", "(nenhum)", "(nenhum)", "(nenhum)"]);
  const FORA = { semPagina: U.semPagina, fornecedor: U.fornecedor, bloqueado: U.bloqueado, semFicha: U.semFicha };
  const FAKE = "99999999-9999-9999-9999-999999999999";
  const OPER_RPC = [
    ["manutencao_painel", ""], ["manutencao_painel", "true"], ["manutencao_equipamento_detalhe", "'naoexiste'"],
    ["manutencao_historico", "'naoexiste'"], ["manutencao_pessoas", ""], ["manutencao_resumo", ""],
    ["manutencao_execucao_registrar", "'{}'::jsonb"], ["manutencao_pendencia_abrir", "'{}'::jsonb"],
    ["manutencao_pendencia_resolver", `'${FAKE}'::uuid, 1, 'feito'`]
  ];
  const GESTOR_RPC = [
    ["manutencao_gerencial", "45"], ["manutencao_auditoria_listar", ""],
    ["manutencao_equipamento_salvar", `'{"id":"naoexiste"}'::jsonb`], ["manutencao_equipamentos_lote", `'{"nome_base":"X","quantidade":1}'::jsonb`],
    ["manutencao_equipamento_inativar", "'naoexiste', 1, 'motivo longo'"], ["manutencao_equipamento_reativar", "'naoexiste', 1"],
    ["manutencao_rotina_salvar", `'{"id":"${FAKE}"}'::jsonb`], ["manutencao_rotina_desativar", `'${FAKE}'::uuid, 1, 'motivo longo'`],
    ["manutencao_execucao_anular", "'naoexiste', 'motivo longo'"], ["manutencao_custo_informar", "'naoexiste', null, null"],
    ["manutencao_pendencia_cancelar", `'${FAKE}'::uuid, 1, 'motivo longo'`], ["manutencao_anexo_equipamento", `'{"equipamento_id":"naoexiste"}'::jsonb`]
  ];
  for (const [fn, args] of OPER_RPC.concat(GESTOR_RPC).concat([["manutencao_equipamento_excluir", "'naoexiste', 'senha-do-master'"]])) {
    const res = Object.entries(FORA).map(([k, uid]) => k + ":" + erroDe(rpc(uid, fn, args)));
    vale(`${fn}(${args.slice(0, 20)}) FECHA para sem página/fornecedor/bloqueado/sem ficha`, res.every((x) => x.endsWith(":sem_permissao")), res.join(" "));
  }
  for (const [fn, args] of OPER_RPC) {
    const e1 = erroDe(rpc(U.oper, fn, args));
    vale(`${fn} ABRE para operacional`, e1 !== "sem_permissao" && !e1.startsWith("RAISE"), e1);
  }
  for (const [fn, args] of GESTOR_RPC) {
    const eo = erroDe(rpc(U.oper, fn, args));
    const res = [U.gestor, U.gestorSo, U.master].map((uid) => erroDe(rpc(uid, fn, args)));
    vale(`${fn}: operacional recusado / gestor, só-gestor e master passam`, eo === "sem_permissao" && res.every((x) => x !== "sem_permissao" && !x.startsWith("RAISE")), "oper=" + eo + " outros=" + res.join(","));
  }
  eq("excluir: operacional, gestor e só-gestor recusados", [U.oper, U.gestor, U.gestorSo].map((u) => erroDe(rpc(u, "manutencao_equipamento_excluir", "'naoexiste', 'x'"))), ["sem_permissao", "sem_permissao", "sem_permissao"]);
  eq("excluir: master passa da porta (equipamento inexistente)", erroDe(rpc(U.master, "manutencao_equipamento_excluir", "'naoexiste', 'x'")), "nao_encontrado");
  r = B.rodar(pg, "begin; set local role anon; select public.manutencao_painel(); commit;");
  vale("anônimo nem chama as funções (sem execute)", !r.ok && /permission denied/.test(r.erro), r.ok ? "chamou!" : "recusado");
  r = B.rodar(pg, "begin; set local role anon; select public.manutencao_execucao_registrar('{}'); commit;");
  vale("anônimo não chama registrar", !r.ok && /permission denied/.test(r.erro), r.ok ? "chamou!" : "recusado");
  r = comoR(U.oper, "select public.manutencao__nome('" + U.master + "')");
  vale("peça interna manutencao__* não é chamável por login", !r.ok && /permission denied/.test(r.erro), r.ok ? "chamou!" : "recusado");

  const TAB = ["manutencao_rotinas", "manutencao_execucoes", "manutencao_execucoes_custos", "manutencao_pendencias", "manutencao_anexos", "manutencao_auditoria"];
  for (const t of TAB) {
    const res = Object.entries(FORA).map(([k, uid]) => k + ":" + como(uid, `select count(*) from public.${t}`));
    vale(`SELECT ${t}: 0 linhas para quem está de fora`, res.every((x) => x.endsWith(":0")), res.join(" "));
  }
  eq("SELECT operacional: rotinas 3, execuções 3, custos 0 (financeiro), auditoria 0",
     [como(U.oper, "select count(*) from manutencao_rotinas"), como(U.oper, "select count(*) from manutencao_execucoes"),
      como(U.oper, "select count(*) from manutencao_execucoes_custos"), como(U.oper, "select count(*) from manutencao_auditoria")], ["3", "3", "0", "0"]);
  eq("SELECT gestor/só-gestor: custos 1, auditoria > 0",
     [como(U.gestor, "select count(*) from manutencao_execucoes_custos"), como(U.gestorSo, "select count(*) from manutencao_execucoes_custos"),
      Number(como(U.gestor, "select count(*) from manutencao_auditoria")) > 0], ["1", "1", true]);
  for (const t of TAB) {
    const ins = comoR(U.gestor, `insert into public.${t} default values`);
    const upd = comoR(U.gestor, `update public.${t} set ${t === "manutencao_execucoes_custos" ? "custo" : t === "manutencao_auditoria" ? "acao" : t === "manutencao_anexos" ? "ativo" : t === "manutencao_rotinas" ? "ativa" : t === "manutencao_pendencias" ? "status" : "anulada"} = ${t === "manutencao_execucoes_custos" ? "1" : t === "manutencao_auditoria" || t === "manutencao_pendencias" ? "'x'" : "true"}`);
    const del = comoR(U.gestor, `delete from public.${t}`);
    vale(`${t}: gestor NÃO grava direto (insert/update/delete)`, [ins, upd, del].every((x) => !x.ok && /permission denied/.test(x.erro)),
      [ins, upd, del].map((x) => (x.ok ? "PASSOU" : "recusado")).join("/"));
  }
  const pedSel = [U.oper, U.gestor, U.master].map((u) => comoR(u, "select count(*) from public.manutencao_pedidos"));
  vale("manutencao_pedidos (reenvio de cadastro): ninguém lê direto, nem master", pedSel.every((x) => !x.ok && /permission denied/.test(x.erro)), pedSel.map((x) => (x.ok ? "LEU" : "recusado")).join("/"));

  // ============================================================
  console.log("\n=== 4. Cadastrar equipamento ===\n");
  // ============================================================
  let s = rpc(U.gestor, "manutencao_equipamento_salvar", lit({ nome: "Forno Combinado", tipo: "Forno", setor: "Padaria", procedimento: "1. Desligar\n2. Limpar", link_fabricante: "https://fabricante.exemplo/manual" }));
  const FORNO = s.equipamento && s.equipamento.id;
  eq("gestor cadastra: ok, id uuid do servidor, código seguinte, versão 1, sem programação",
     [s.ok, /^[0-9a-f-]{36}$/.test(FORNO), s.equipamento.codigo, s.equipamento.versao, s.equipamento.estado, s.equipamento.tem_procedimento], [true, true, "EQ-0019", 1, "sem_programacao", true]);
  eq("criado_por = quem cadastrou", suV(`select criado_por from manutencao_equipamentos where id='${FORNO}'`), U.gestor);
  eq("auditoria 'criar' com depois", suV(`select acao||'/'||(depois->>'nome')||'/'||usuario_nome from manutencao_auditoria where entidade_id='${FORNO}' order by id limit 1`), "criar/Forno Combinado/Márcia");
  s = rpc(U.gestor, "manutencao_equipamento_salvar", lit({ nome: "X", tipo: "Forno", setor: "Padaria" }));
  eq("nome curto recusado", [erroDe(s), s.campo], ["invalido", "nome"]);
  s = rpc(U.gestor, "manutencao_equipamento_salvar", lit({ nome: "Freezer", tipo: "", setor: "Padaria" }));
  eq("tipo vazio recusado", [erroDe(s), s.campo], ["invalido", "tipo"]);
  s = rpc(U.gestor, "manutencao_equipamento_salvar", lit({ nome: "Freezer", tipo: "Freezer", setor: "   " }));
  eq("setor em branco recusado", [erroDe(s), s.campo], ["invalido", "setor"]);
  s = rpc(U.gestor, "manutencao_equipamento_salvar", lit({ nome: "Freezer", tipo: "Freezer", setor: "Padaria", link_fabricante: "javascript:alert(1)" }));
  eq("link que não é http(s) recusado", [erroDe(s), s.campo], ["invalido", "link_fabricante"]);
  // DUP-NOME: cadastro simples e edição recusam o nome de outro equipamento ATIVO (a mesma regra do lote)
  s = rpc(U.gestor, "manutencao_equipamento_salvar", lit({ nome: " balanças caixa 101 ", tipo: "Balança", setor: "Frente de caixa" }));
  eq("cadastro simples com nome de equipamento ativo (outra grafia): duplicado, campo nome, mensagem do lote, nada gravado",
     [erroDe(s), s.campo, s.mensagem, suV("select count(*) from manutencao_equipamentos where lower(btrim(nome))=lower('Balanças Caixa 101')"), suV("select last_value from manutencao_equipamento_codigo_seq")],
     ["duplicado", "nome", "Já existe equipamento ativo com este nome: Balanças Caixa 101. Nada foi cadastrado.", "1", "19"]);
  s = rpc(U.gestor, "manutencao_equipamento_salvar", lit({ id: FORNO, versao: 1, nome: "Camera Fria de Congelado", tipo: "Forno", setor: "Padaria" }));
  eq("editar dando o nome de OUTRO equipamento ativo: duplicado e nada muda", [erroDe(s), s.campo, suV(`select nome||'/'||versao from manutencao_equipamentos where id='${FORNO}'`)], ["duplicado", "nome", "Forno Combinado/1"]);
  s = rpc(U.gestor, "manutencao_equipamento_salvar", lit({ id: FORNO, versao: 1, nome: "Forno Combinado", tipo: "Forno", setor: "Padaria" }));
  eq("salvar o próprio equipamento sem mudar o nome continua aceito", [s.ok, s.equipamento && s.equipamento.nome], [true, "Forno Combinado"]);

  // ============================================================
  console.log("\n=== 5. Cadastro em lote (tudo ou nada) ===\n");
  // ============================================================
  const antesLote = suV("select count(*) from manutencao_equipamentos");
  s = rpc(U.gestor, "manutencao_equipamentos_lote", lit({ nome_base: "Balança Caixa", quantidade: 200, inicio: 1, tipo: "Balança", setor: "Frente de caixa" }));
  eq("lote de 200: 200 criados", [s.ok, s.criados && s.criados.length], [true, 200]);
  eq("nomes com zero à esquerda só abaixo de 10", [s.criados[0].nome, s.criados[8].nome, s.criados[9].nome, s.criados[199].nome], ["Balança Caixa 01", "Balança Caixa 09", "Balança Caixa 10", "Balança Caixa 200"]);
  eq("códigos seguidos, sem buraco (EQ-0020 … EQ-0219)", [s.criados[0].codigo, s.criados[199].codigo, new Set(s.criados.map((x) => x.codigo)).size], ["EQ-0020", "EQ-0219", 200]);
  eq("ids todos distintos (uuid do servidor)", new Set(s.criados.map((x) => x.id)).size, 200);
  eq("banco tem exatamente +200", suV("select count(*) from manutencao_equipamentos"), String(Number(antesLote) + 200));
  s = rpc(U.gestor, "manutencao_equipamentos_lote", lit({ nome_base: "Balança Caixa", quantidade: 5, inicio: 198, tipo: "Balança", setor: "Frente de caixa" }));
  eq("lote que repete nome ativo: duplicado com a lista", [erroDe(s), s.nomes], ["duplicado", ["Balança Caixa 198", "Balança Caixa 199", "Balança Caixa 200"]]);
  eq("tudo ou nada: nenhuma unidade nova (201, 202 não entraram)", suV("select count(*) from manutencao_equipamentos"), String(Number(antesLote) + 200));
  eq("quantidade 1 e 201 recusadas", [erroDe(rpc(U.gestor, "manutencao_equipamentos_lote", lit({ nome_base: "Z", quantidade: 1, inicio: 1, tipo: "Tt", setor: "Ss" }))),
     rpc(U.gestor, "manutencao_equipamentos_lote", lit({ nome_base: "Zeta", quantidade: 201, inicio: 1, tipo: "Tt", setor: "Ss" })).campo], ["invalido", "quantidade"]);
  eq("início negativo recusado", rpc(U.gestor, "manutencao_equipamentos_lote", lit({ nome_base: "Zeta", quantidade: 2, inicio: -1, tipo: "Tt", setor: "Ss" })).campo, "inicio");

  // reenvio do MESMO formulário (a resposta se perdeu e a pessoa clicou de novo): não duplica
  const RQE = "7e000000-0000-4000-8000-000000000001", RQL = "7e000000-0000-4000-8000-000000000002";
  const nEq = () => suV("select count(*) from manutencao_equipamentos");
  const antesReenvio = nEq();
  const pe1 = rpc(U.gestor, "manutencao_equipamento_salvar", lit({ request_id: RQE, nome: "Freezer Padaria Reenvio", tipo: "Freezer", setor: "Padaria" }));
  const pe2 = rpc(U.gestor, "manutencao_equipamento_salvar", lit({ request_id: RQE, nome: "Freezer Padaria Reenvio", tipo: "Freezer", setor: "Padaria" }));
  eq("cadastro com request_id 2 vezes: o mesmo equipamento (mesmo id e código), só +1 no banco",
     [pe1.ok, pe2.ok, pe2.equipamento.id === pe1.equipamento.id, pe2.equipamento.codigo === pe1.equipamento.codigo, Number(nEq()) - Number(antesReenvio)], [true, true, true, true, 1]);
  eq("o mesmo request_id por OUTRA pessoa: duplicado (não devolve o cadastro de outro)", [erroDe(rpc(U.gestorSo, "manutencao_equipamento_salvar", lit({ request_id: RQE, nome: "Outro", tipo: "Freezer", setor: "Padaria" }))), Number(nEq()) - Number(antesReenvio)], ["duplicado", 1]);
  eq("request_id que não é uuid: recusado", rpc(U.gestor, "manutencao_equipamento_salvar", lit({ request_id: "abc", nome: "Outro", tipo: "Freezer", setor: "Padaria" })).campo, "request_id");
  const pl1 = rpc(U.gestor, "manutencao_equipamentos_lote", lit({ request_id: RQL, nome_base: "Balcão Reenvio", quantidade: 3, inicio: 1, tipo: "Balcão refrigerado", setor: "Frios" }));
  const pl2 = rpc(U.gestor, "manutencao_equipamentos_lote", lit({ request_id: RQL, nome_base: "Balcão Reenvio", quantidade: 3, inicio: 1, tipo: "Balcão refrigerado", setor: "Frios" }));
  eq("lote com request_id 2 vezes: devolve os MESMOS criados (não diz 'Nada foi cadastrado' nem cria de novo)",
     [pl1.ok, pl2.ok, JSON.stringify(pl2.criados) === JSON.stringify(pl1.criados), Number(nEq()) - Number(antesReenvio)], [true, true, true, 4]);
  // PED-01: o mesmo request_id com dados DIFERENTES não finge que salvou
  const pe3 = rpc(U.gestor, "manutencao_equipamento_salvar", lit({ request_id: RQE, nome: "Freezer Padaria Outro Nome", tipo: "Freezer", setor: "Padaria" }));
  eq("cadastro: mesmo request_id com o nome mudado = conflito (campo request_id), nada novo no banco",
     [erroDe(pe3), pe3.campo, pe3.mensagem, Number(nEq()) - Number(antesReenvio), suV("select count(*) from manutencao_equipamentos where nome='Freezer Padaria Outro Nome'")],
     ["conflito", "request_id", "Este formulário já foi salvo. Confira os dados atuais antes de salvar de novo.", 4, "0"]);
  const edReenvio = { request_id: "7e000000-0000-4000-8000-000000000003", id: pe1.equipamento.id, versao: pe1.equipamento.versao, nome: "Freezer Editado", tipo: "Freezer", setor: "Padaria" };
  const ed1 = rpc(U.gestor, "manutencao_equipamento_salvar", lit(edReenvio));
  const ed2 = rpc(U.gestor, "manutencao_equipamento_salvar", lit(edReenvio));
  const ed3 = rpc(U.gestor, "manutencao_equipamento_salvar", lit(Object.assign({}, edReenvio, { nome: "Freezer Outro Nome" })));
  eq("edição com request_id: reenvio idêntico devolve o mesmo resultado; reenvio com outro nome = conflito e o banco fica com o 1º nome",
     [ed1.ok, ed2.ok, JSON.stringify(ed2) === JSON.stringify(ed1), erroDe(ed3), ed3.campo, suV(`select nome from manutencao_equipamentos where id='${pe1.equipamento.id}'`)],
     [true, true, true, "conflito", "request_id", "Freezer Editado"]);
  const pl3 = rpc(U.gestor, "manutencao_equipamentos_lote", lit({ request_id: RQL, nome_base: "Balcão Reenvio", quantidade: 4, inicio: 1, tipo: "Balcão refrigerado", setor: "Frios" }));
  eq("lote: mesmo request_id com a quantidade mudada = conflito, nada novo", [erroDe(pl3), pl3.campo, Number(nEq()) - Number(antesReenvio)], ["conflito", "request_id", 4]);

  // dois gestores cadastrando o MESMO lote ao mesmo tempo (sessões simultâneas de verdade)
  const loteCorrida = lit({ nome_base: "Balcão Corrida", quantidade: 3, inicio: 1, tipo: "Balcão refrigerado", setor: "Frios" });
  const corrida = aoMesmoTempo([
    { sql: sessaoLenta(U.gestor, `public.manutencao_equipamentos_lote(${loteCorrida})`, 1.2), atraso: 0 },
    { sql: sessaoLenta(U.gestorSo, `public.manutencao_equipamentos_lote(${loteCorrida})`, 0), atraso: 0.4 }]);
  const rc = corrida.map((x) => jsonDaSaida(x.saida));
  eq("lote simultâneo: um cadastra, o outro espera e recebe 'duplicado'; cada nome existe UMA vez",
     [rc.map((x) => (x.ok ? "ok" : x.erro)).sort().join(","), suV("select string_agg(nome||'='||n, ',' order by nome) from (select nome, count(*) n from manutencao_equipamentos where nome like 'Balcão Corrida %' and status='ativo' group by nome) t")],
     ["duplicado,ok", "Balcão Corrida 01=1,Balcão Corrida 02=1,Balcão Corrida 03=1"]);

  // ============================================================
  console.log("\n=== 6. Editar com versão (conflito) ===\n");
  // ============================================================
  s = rpc(U.gestor, "manutencao_equipamento_salvar", lit({ id: FORNO, versao: 1, nome: "Forno Combinado 1", tipo: "Forno", setor: "Padaria" }));
  eq("editar com a versão lida: ok, versão 2, procedimento mantido (campo não enviado)", [s.ok, s.equipamento.versao, s.equipamento.tem_procedimento], [true, 2, true]);
  s = rpc(U.gestorSo, "manutencao_equipamento_salvar", lit({ id: FORNO, versao: 1, nome: "Forno VELHO", tipo: "Forno", setor: "Padaria" }));
  eq("outra pessoa com a versão velha: conflito com o atual", [erroDe(s), s.atual && s.atual.nome, s.atual && s.atual.versao], ["conflito", "Forno Combinado 1", 2]);
  eq("sem versão também é conflito", erroDe(rpc(U.gestor, "manutencao_equipamento_salvar", lit({ id: FORNO, nome: "Forno", tipo: "Forno", setor: "Padaria" }))), "conflito");
  eq("o nome não foi desfeito", suV(`select nome from manutencao_equipamentos where id='${FORNO}'`), "Forno Combinado 1");
  s = rpc(U.gestor, "manutencao_equipamento_salvar", lit({ id: FORNO, versao: 2, nome: "Forno Combinado 1", tipo: "Forno", setor: "Padaria" }));
  eq("regravar igual não sobe a versão", [s.ok, s.equipamento.versao], [true, 2]);
  eq("auditoria 'editar' com antes e depois", suV(`select acao||':'||(antes->>'nome')||'>'||(depois->>'nome') from manutencao_auditoria where entidade_id='${FORNO}' and acao='editar'`), "editar:Forno Combinado>Forno Combinado 1");
  eq("atualizado_por = quem editou", suV(`select atualizado_por from manutencao_equipamentos where id='${FORNO}'`), U.gestor);

  // ============================================================
  console.log("\n=== 7. Inativar / reativar (inativo não gera estado nem aceita registro) ===\n");
  // ============================================================
  const RESF = "emraqg6gz805";   // Camera Fria Resfriado, vencida
  const verEq = (id) => Number(suV(`select versao from manutencao_equipamentos where id='${id}'`));
  const pAntes = rpc(U.oper, "manutencao_painel");
  const resAntes = rpc(U.oper, "manutencao_resumo");
  vale("antes: Resfriado está atrasado", pAntes.equipamentos.find((e) => e.id === RESF).estado === "atrasado");
  let vR = verEq(RESF);
  eq("motivo curto recusado", rpc(U.gestor, "manutencao_equipamento_inativar", `'${RESF}', ${vR}, 'oi'`).campo, "motivo");
  eq("versão velha: conflito", erroDe(rpc(U.gestor, "manutencao_equipamento_inativar", `'${RESF}', ${vR - 1}, 'Câmara desmontada'`)), "conflito");
  s = rpc(U.gestor, "manutencao_equipamento_inativar", `'${RESF}', ${vR}, 'Câmara desmontada para reforma'`);
  eq("gestor inativa: status e estado 'inativo'", [s.ok, s.equipamento.status, s.equipamento.estado], [true, "inativo", "inativo"]);
  eq("auditoria 'inativar' com a justificativa = motivo", suV(`select acao||'|'||justificativa||'|'||(antes->>'status')||'>'||(depois->>'status') from manutencao_auditoria where entidade_id='${RESF}' order by id desc limit 1`), "inativar|Câmara desmontada para reforma|ativo>inativo");
  let pOp = rpc(U.oper, "manutencao_painel");
  eq("painel do operacional: some da lista; atrasadas -1; inativos 1",
     [pOp.equipamentos.some((e) => e.id === RESF), pOp.contagens.atrasado, pOp.contagens.equipamentos_inativos], [false, pAntes.contagens.atrasado - 1, 1]);
  eq("operacional pedindo inativos continua sem ver", rpc(U.oper, "manutencao_painel", "true").equipamentos.some((e) => e.id === RESF), false);
  let pG = rpc(U.gestor, "manutencao_painel", "true");
  const resfG = pG.equipamentos.find((e) => e.id === RESF);
  eq("gestor com inativos vê: estado inativo, rotina sem estado de vencimento, não conta", [resfG.estado, resfG.rotinas[0].estado, resfG.rotinas[0].dias, pG.contagens.atrasado], ["inativo", "inativo", null, pAntes.contagens.atrasado - 1]);
  eq("resumo não conta inativo", rpc(U.oper, "manutencao_resumo").atrasado, resAntes.atrasado - 1);
  eq("detalhe: operacional recebe 'inativo'; gestor abre com o motivo",
     [erroDe(rpc(U.oper, "manutencao_equipamento_detalhe", `'${RESF}'`)), rpc(U.gestor, "manutencao_equipamento_detalhe", `'${RESF}'`).equipamento.inativado_motivo], ["inativo", "Câmara desmontada para reforma"]);
  eq("inativo não aceita registro de serviço", erroDe(registrar(U.oper, exec(RESF, "Limpeza", HOJE))), "inativo");
  eq("inativo não aceita pendência nova", erroDe(rpc(U.oper, "manutencao_pendencia_abrir", lit({ request_id: rq(1), equipamento_id: RESF, descricao: "Porta" }))), "inativo");
  eq("inativo não aceita rotina nova nem edição nem 2ª inativação",
     [erroDe(rpc(U.gestor, "manutencao_rotina_salvar", lit({ equipamento_id: RESF, tipo_servico: "Degelo", periodicidade_dias: 10 }))),
      erroDe(rpc(U.gestor, "manutencao_equipamento_salvar", lit({ id: RESF, versao: verEq(RESF), nome: "Nova", tipo: "Câmara fria", setor: "Açougue" }))),
      erroDe(rpc(U.gestor, "manutencao_equipamento_inativar", `'${RESF}', ${verEq(RESF)}, 'de novo aqui'`))], ["inativo", "inativo", "inativo"]);
  eq("reativar com versão velha: conflito", erroDe(rpc(U.gestor, "manutencao_equipamento_reativar", `'${RESF}', ${verEq(RESF) - 1}`)), "conflito");
  s = rpc(U.gestor, "manutencao_equipamento_reativar", `'${RESF}', ${verEq(RESF)}`);
  eq("reativar: volta a ativo e a cobrar (atrasado)", [s.ok, s.equipamento.status, s.equipamento.estado], [true, "ativo", "atrasado"]);
  eq("reativar de novo: inválido", rpc(U.gestor, "manutencao_equipamento_reativar", `'${RESF}', ${verEq(RESF)}`).campo, "status");
  eq("auditoria 'reativar'", suV(`select acao from manutencao_auditoria where entidade_id='${RESF}' order by id desc limit 1`), "reativar");
  // DUP-NOME-REATIVAR: o inativo não bloqueia cadastrar o mesmo nome, mas reativar não pode deixar 2 ativos iguais
  const gem1 = rpc(U.gestor, "manutencao_equipamento_salvar", lit({ nome: "Freezer Gêmeo", tipo: "Freezer", setor: "Açougue" })).equipamento;
  const gemIn = rpc(U.gestor, "manutencao_equipamento_inativar", `'${gem1.id}', ${gem1.versao}, 'Quebrou, foi para o conserto'`);
  const gem2 = rpc(U.gestor, "manutencao_equipamento_salvar", lit({ nome: " FREEZER Gêmeo ", tipo: "Freezer", setor: "Açougue" }));
  const reGem = rpc(U.gestor, "manutencao_equipamento_reativar", `'${gem1.id}', ${verEq(gem1.id)}`);
  eq("reativar com outro equipamento ATIVO de mesmo nome: recusado no campo nome, nada muda (1 ativo, o antigo continua inativo)",
     [gemIn.ok, gem2.ok, reGem.ok, reGem.erro, reGem.campo, reGem.mensagem,
      suV("select count(*) from manutencao_equipamentos where status='ativo' and lower(btrim(nome))='freezer gêmeo'"), suV(`select status from manutencao_equipamentos where id='${gem1.id}'`)],
     [true, true, false, "duplicado", "nome", "Já existe equipamento ativo com este nome: FREEZER Gêmeo. Para reativar este, renomeie ou inative o outro antes.", "1", "inativo"]);
  const gemIn2 = rpc(U.gestor, "manutencao_equipamento_inativar", `'${gem2.equipamento.id}', ${verEq(gem2.equipamento.id)}, 'Cadastro repetido'`);
  const reGem2 = rpc(U.gestor, "manutencao_equipamento_reativar", `'${gem1.id}', ${verEq(gem1.id)}`);
  eq("sem o gêmeo ativo, reativar continua aceito", [gemIn2.ok, reGem2.ok, reGem2.equipamento && reGem2.equipamento.status], [true, true, "ativo"]);

  // ============================================================
  console.log("\n=== 8. Exclusão definitiva: só master, com senha, só sem histórico ===\n");
  // ============================================================
  s = rpc(U.gestor, "manutencao_equipamento_salvar", lit({ nome: "Cadastrado Errado", tipo: "Teste", setor: "Teste" }));
  const ERRADO = s.equipamento.id;
  rpc(U.gestor, "manutencao_rotina_salvar", lit({ equipamento_id: ERRADO, tipo_servico: "Limpeza", periodicidade_dias: 15 }));
  const tentErradas = () => Number(suV(`select count(*) from senha_master_tentativas where quem='${U.master}' and not acertou`));
  const t0 = tentErradas();
  eq("operacional e gestor recusados antes de tocar na senha",
     [erroDe(rpc(U.oper, "manutencao_equipamento_excluir", `'${ERRADO}', 'senha-do-master'`)), erroDe(rpc(U.gestor, "manutencao_equipamento_excluir", `'${ERRADO}', 'senha-do-master'`)), tentErradas()],
     ["sem_permissao", "sem_permissao", t0]);
  s = rpc(U.master, "manutencao_equipamento_excluir", `'${ERRADO}', 'senha-errada'`);
  eq("master com senha errada: {ok:false, senha_incorreta} SEM raise", [s.ok, s.erro, s.__erro === undefined], [false, "senha_incorreta", true]);
  eq("a tentativa errada FICOU gravada (a transação confirmou)", tentErradas(), t0 + 1);
  eq("o equipamento continua lá", suV(`select count(*) from manutencao_equipamentos where id='${ERRADO}'`), "1");
  r = comoR(U.master, "select public.senha_master_ok('outra-errada'); select 1/0");
  eq("prova do contrário: se desse raise depois, a tentativa sumiria", [r.ok, tentErradas()], [false, t0 + 1]);
  eq("com histórico (câmara com serviços) recusado mesmo com a senha certa",
     erroDe(rpc(U.master, "manutencao_equipamento_excluir", `'emr9b5cgj174', 'senha-do-master'`)), "tem_historico");
  eq("com serviço só no módulo antigo também é histórico", erroDe(rpc(U.master, "manutencao_equipamento_excluir", `'emvelha001', 'senha-do-master'`)), "tem_historico");
  s = rpc(U.master, "manutencao_equipamento_excluir", `'${ERRADO}', 'senha-do-master'`);
  eq("sem histórico + senha certa: exclui equipamento e a rotina sem uso", [s.ok, suV(`select count(*) from manutencao_equipamentos where id='${ERRADO}'`), suV(`select count(*) from manutencao_rotinas where equipamento_id='${ERRADO}'`)], [true, "0", "0"]);
  eq("auditoria guarda o ANTES completo da exclusão (equipamento e rotina)",
     suV(`select string_agg(entidade||':'||acao||':'||coalesce(antes->>'nome', antes->>'tipo_servico'), ',' order by id) from manutencao_auditoria where equipamento_id='${ERRADO}' and acao='excluir'`),
     "rotina:excluir:Limpeza,equipamento:excluir:Cadastrado Errado");
  for (let i = 0; i < 9; i++) rpc(U.master, "manutencao_equipamento_excluir", `'${FORNO}', 'chute-${i}'`);
  eq("10 erros em 15 min: bloqueado (sem raise), até com a senha certa",
     [erroDe(rpc(U.master, "manutencao_equipamento_excluir", `'${FORNO}', 'mais-um'`)), erroDe(rpc(U.master, "manutencao_equipamento_excluir", `'${FORNO}', 'senha-do-master'`))], ["bloqueado", "bloqueado"]);
  eq("bloqueado não excluiu nada", suV(`select count(*) from manutencao_equipamentos where id='${FORNO}'`), "1");

  // ============================================================
  console.log("\n=== 9. Rotinas: vários serviços no mesmo equipamento ===\n");
  // ============================================================
  s = rpc(U.gestor, "manutencao_rotina_salvar", lit({ equipamento_id: FORNO, tipo_servico: "Limpeza", periodicidade_dias: 30, responsavel: { ref: "perfil:" + U.oper2, nome: "Cícero" }, instrucao: "Usar desengordurante" }));
  const LIMP = s.rotina && s.rotina.id;
  eq("rotina Limpeza/30: ok, aguardando 1ª, responsável com login", [s.ok, s.rotina.estado, s.rotina.responsavel_perfil_id, s.rotina.origem, s.rotina.versao], [true, "primeira", U.oper2, "manual", 1]);
  s = rpc(U.gestor, "manutencao_rotina_salvar", lit({ equipamento_id: FORNO, tipo_servico: "Conferência", periodicidade_dias: 7, responsavel: { ref: "escala:r3", nome: "Denise" } }));
  const CONF = s.rotina && s.rotina.id;
  eq("rotina Conferência/7 no MESMO equipamento: ok (responsável da escala)", [s.ok, s.rotina.responsavel_ref, s.rotina.responsavel_perfil_id], [true, "escala:r3", null]);
  eq("'limpeza' de novo (outra grafia) no mesmo equipamento: duplicado",
     [erroDe(rpc(U.gestor, "manutencao_rotina_salvar", lit({ equipamento_id: FORNO, tipo_servico: " limpeza ", periodicidade_dias: 15 }))), suV(`select count(*) from manutencao_rotinas where equipamento_id='${FORNO}'`)], ["duplicado", "2"]);
  eq("periodicidade 0, 3651, 2.5 e 'abc' recusadas", [0, 3651, 2.5, "abc"].map((v) => rpc(U.gestor, "manutencao_rotina_salvar", lit({ equipamento_id: FORNO, tipo_servico: "Degelo", periodicidade_dias: v })).campo),
     ["periodicidade_dias", "periodicidade_dias", "periodicidade_dias", "periodicidade_dias"]);
  eq("rotina nova sem serviço recusada", rpc(U.gestor, "manutencao_rotina_salvar", lit({ equipamento_id: FORNO, periodicidade_dias: 5 })).campo, "tipo_servico");
  eq("responsável inválido recusado", rpc(U.gestor, "manutencao_rotina_salvar", lit({ equipamento_id: FORNO, tipo_servico: "Degelo", responsavel: { ref: "hacker:1", nome: "X" } })).campo, "responsavel");
  eq("data de início inválida recusada", rpc(U.gestor, "manutencao_rotina_salvar", lit({ equipamento_id: FORNO, tipo_servico: "Degelo", data_inicio: "2026-02-30" })).campo, "data_inicio");
  s = rpc(U.gestor, "manutencao_rotina_salvar", lit({ equipamento_id: FORNO, tipo_servico: "Troca de filtro", periodicidade_dias: "" }));
  const FILT = s.rotina.id;
  eq("periodicidade em branco = 'sem_periodicidade' (nunca inventa número)", [s.rotina.periodicidade_dias, s.rotina.estado], [null, "sem_periodicidade"]);
  s = rpc(U.gestor, "manutencao_rotina_salvar", lit({ equipamento_id: FORNO, tipo_servico: "Inspeção", periodicidade_dias: 10, data_inicio: dia(3) }));
  const INSP = s.rotina.id;
  eq("com data de início daqui a 3 dias: 'proximo', dias 3", [s.rotina.estado, s.rotina.dias, s.rotina.proxima], ["proximo", 3, dia(3)]);
  let fornoP = rpc(U.oper, "manutencao_painel").equipamentos.find((e) => e.id === FORNO);
  eq("estado do equipamento = pior das rotinas (proximo > primeira > sem_periodicidade)", [fornoP.estado, fornoP.dias, fornoP.rotinas.length], ["proximo", 3, 4]);
  s = rpc(U.gestor, "manutencao_rotina_salvar", lit({ id: INSP, versao: 1, periodicidade_dias: 20 }));
  eq("editar rotina sem histórico: não pede justificativa; versão 2; o resto fica", [s.ok, s.rotina.versao, s.rotina.periodicidade_dias, s.rotina.data_inicio], [true, 2, 20, dia(3)]);
  eq("editar com versão velha: conflito", erroDe(rpc(U.gestor, "manutencao_rotina_salvar", lit({ id: INSP, versao: 1, periodicidade_dias: 25 }))), "conflito");
  eq("desativar com motivo curto: recusado", rpc(U.gestor, "manutencao_rotina_desativar", `'${INSP}', 2, 'no'`).campo, "motivo");
  s = rpc(U.gestor, "manutencao_rotina_desativar", `'${INSP}', 2, 'Inspeção passou para a empresa'`);
  eq("desativar: ok; some do painel; estado do equipamento recalcula (primeira)", [s.ok, s.rotina.ativa,
     rpc(U.oper, "manutencao_painel").equipamentos.find((e) => e.id === FORNO).estado], [true, false, "primeira"]);
  const det = rpc(U.gestor, "manutencao_equipamento_detalhe", `'${FORNO}'`);
  const inspDet = det.rotinas.find((x) => x.id === INSP);
  eq("detalhe traz a desativada com quem/motivo", [inspDet.estado, inspDet.desativada_motivo, inspDet.desativada_por_nome], ["desativada", "Inspeção passou para a empresa", "Márcia"]);
  eq("desativada libera cadastrar o mesmo serviço de novo", rpc(U.gestor, "manutencao_rotina_salvar", lit({ equipamento_id: FORNO, tipo_servico: "inspeção", periodicidade_dias: 30 })).ok, true);
  eq("desativar de novo: 'inativo'", erroDe(rpc(U.gestor, "manutencao_rotina_desativar", `'${INSP}', ${s.rotina.versao}, 'motivo qualquer'`)), "inativo");
  eq("auditoria: rotina_criar, rotina_editar, rotina_desativar (com justificativa)",
     suV(`select string_agg(acao||coalesce('('||justificativa||')',''), ',' order by id) from manutencao_auditoria where entidade_id='${INSP}'`),
     "rotina_criar,rotina_editar,rotina_desativar(Inspeção passou para a empresa)");

  // ============================================================
  console.log("\n=== 10. manutencao_estado — a única regra de vencimento (função pura) ===\n");
  // ============================================================
  const est = (u, p, i, h) => { const o = suJ(`select public.manutencao_estado(${u ? `'${u}'` : "null"}, ${p === null ? "null" : p}, ${i ? `'${i}'` : "null"}, '${h}')`); return [o.estado, o.proxima, o.dias]; };
  eq("virada de mês: 25/01 + 10 = 04/02", est("2026-01-25", 10, null, "2026-01-30"), ["proximo", "2026-02-04", 5]);
  eq("28/02/2027 + 1 = 01/03/2027 (ano comum)", est("2027-02-28", 1, null, "2027-02-28"), ["proximo", "2027-03-01", 1]);
  eq("29/01/2027 + 30 = 28/02/2027 → vence hoje", est("2027-01-29", 30, null, "2027-02-28"), ["hoje", "2027-02-28", 0]);
  eq("28/02/2028 + 1 = 29/02/2028 (bissexto)", est("2028-02-28", 1, null, "2028-02-28"), ["proximo", "2028-02-29", 1]);
  eq("29/02/2028 + 1 = 01/03/2028", est("2028-02-29", 1, null, "2028-03-01"), ["hoje", "2028-03-01", 0]);
  eq("30/01/2028 + 30 = 29/02/2028", est("2028-01-30", 30, null, "2028-02-20"), ["em_dia", "2028-02-29", 9]);
  eq("antecipado: feito 10/09 (antes de vencer) conta de 10/09", est("2026-09-10", 30, null, "2026-09-14"), ["em_dia", "2026-10-10", 26]);
  eq("no dia do vencimento: 'hoje' (não é atraso)", est("2026-08-15", 30, null, "2026-09-14"), ["hoje", "2026-09-14", 0]);
  eq("um dia depois: atrasado há 1 dia", est("2026-08-14", 30, null, "2026-09-14"), ["atrasado", "2026-09-13", -1]);
  eq("faltam 7: próximo; faltam 8: em dia", [est("2026-08-22", 30, null, "2026-09-14")[0], est("2026-08-23", 30, null, "2026-09-14")[0]], ["proximo", "em_dia"]);
  eq("sem periodicidade", est("2026-09-01", null, null, "2026-09-14"), ["sem_periodicidade", null, null]);
  eq("sem execução e sem data de início: primeira", est(null, 30, null, "2026-09-14"), ["primeira", null, null]);
  eq("sem execução, com data de início futura / passada", [est(null, 30, "2026-09-20", "2026-09-14"), est(null, 30, "2026-09-01", "2026-09-14")], [["proximo", "2026-09-20", 6], ["atrasado", "2026-09-01", -13]]);
  eq("com execução, a data de início deixa de valer", est("2026-09-10", 30, "2026-09-01", "2026-09-14"), ["em_dia", "2026-10-10", 26]);
  eq("declarada IMMUTABLE (pura)", suV("select provolatile from pg_proc where proname='manutencao_estado'"), "i");

  // ============================================================
  console.log("\n=== 11. Registrar serviço ===\n");
  // ============================================================
  const snapEqRot = () => suV(`select (select versao||'|'||coalesce(atualizado_em::text,'') from manutencao_equipamentos where id='${FORNO}')||'#'||
     (select string_agg(id||':'||versao||'|'||coalesce(atualizado_em::text,''), ',' order by id) from manutencao_rotinas where equipamento_id='${FORNO}')`);
  const antesSnap = snapEqRot();
  const custoDe = (id) => suV(`select coalesce((select coalesce(custo::text,'NULL') from manutencao_execucoes_custos where execucao_id='${id}'),'SEM LINHA')`);

  const p1 = exec(FORNO, "limpeza", HOJE, { executor: { tipo: "interno", ref: "perfil:" + U.oper, nome: "Laryze" } });
  const e1 = registrar(U.oper, p1);
  eq("limpeza (operacional): liga na rotina, próxima = hoje+30, em dia", [e1.ok, e1.rotina_id === LIMP, e1.proxima, e1.estado, e1.dias, e1.pendencia_id, e1.repetido], [true, true, dia(30), "em_dia", 30, null, false]);
  eq("grava quem registrou e os snapshots do momento",
     suV(`select tipo_servico||'|'||registrado_por||'|'||registrado_por_nome||'|'||equipamento_nome_snap||'|'||equipamento_codigo_snap||'|'||equipamento_tipo_snap||'|'||setor_snap||'|'||periodicidade_snap||'|'||responsavel_rotina_snap||'|'||proxima_prevista_snap||'|'||executor_ref from manutencao_execucoes where id='${e1.id}'`),
     `Limpeza|${U.oper}|Laryze|Forno Combinado 1|EQ-0019|Forno|Padaria|30|Cícero|${dia(30)}|perfil:${U.oper}`);
  let e1b = registrar(U.oper, p1);
  eq("mesmo request_id de novo: devolve o MESMO registro (repetido)", [e1b.ok, e1b.id === e1.id, e1b.repetido, e1b.proxima], [true, true, true, dia(30)]);
  e1b = registrar(U.gestor, p1);
  eq("o request_id de OUTRA pessoa não vira 'deu certo' sem gravar: duplicado, e continua 1 registro", [erroDe(e1b), e1b.campo, e1b.id, suV(`select count(*) from manutencao_execucoes where request_id='${p1.request_id}'`)], ["duplicado", "request_id", undefined, "1"]);
  e1b = registrar(U.oper, Object.assign({}, p1, { equipamento_id: "emraqg6gz805", resultado: "problema", problema_descricao: "Porta" }));
  eq("o mesmo request_id em OUTRO equipamento: duplicado, nada gravado e nenhuma pendência aberta",
     [erroDe(e1b), suV(`select count(*) from manutencao_execucoes where request_id='${p1.request_id}'`), suV("select count(*) from manutencao_pendencias where descricao='Porta'")], ["duplicado", "1", "0"]);

  const eConf = registrar(U.oper, exec(FORNO, "Conferência", HOJE, { peso_ref: 10, peso_medido: "9,95", resultado: "observacao", observacao: "Diferença de 50 g" }));
  eq("conferência com peso: grava referência e medido (vírgula aceita)", [eConf.ok, eConf.rotina_id === CONF, suV(`select peso_ref||'/'||peso_medido||'/'||resultado||'/'||observacao from manutencao_execucoes where id='${eConf.id}'`)], [true, true, "10/9.95/observacao/Diferença de 50 g"]);
  eq("peso inválido recusado", registrar(U.oper, exec(FORNO, "Conferência", HOJE, { peso_ref: "dez" })).campo, "peso_ref");
  const eLub = registrar(U.oper, exec(FORNO, "Lubrificação", HOJE, { peso_ref: "", peso_medido: null }));
  eq("peso em branco fica NULL, não zero; serviço sem rotina = avulsa", [eLub.ok, eLub.rotina_id, eLub.estado, suV(`select coalesce(peso_ref::text,'NULL')||'/'||coalesce(periodicidade_snap::text,'NULL')||'/'||coalesce(proxima_prevista_snap::text,'NULL') from manutencao_execucoes where id='${eLub.id}'`)], [true, null, null, "NULL/NULL/NULL"]);
  eq("observação obrigatória em 'Feito, com observação'", registrar(U.oper, exec(FORNO, "Conferência", HOJE, { resultado: "observacao", observacao: "  " })).campo, "observacao");

  eq("externo sem empresa recusado", registrar(U.oper, exec(FORNO, "Manutenção corretiva", HOJE, { executor: { tipo: "externo", nome: "Técnico João" } })).campo, "empresa_nome");
  const eOpExt = registrar(U.oper, exec(FORNO, "Manutenção corretiva", HOJE, { executor: { tipo: "externo", nome: "João", empresa_nome: "TecFrio", empresa_telefone: "84 9999-0000" }, custo: 999 }));
  eq("externo pelo OPERACIONAL: custo que ele mandou é IGNORADO (fica não informado)", [eOpExt.ok, custoDe(eOpExt.id)], [true, "NULL"]);
  const eG150 = registrar(U.gestor, exec(FORNO, "Manutenção corretiva", HOJE, { executor: { tipo: "externo", nome: "João", empresa_nome: "TecFrio" }, custo: 150.5 }));
  eq("externo pelo GESTOR com custo: grava valor e quem informou", [custoDe(eG150.id), suV(`select informado_por_nome from manutencao_execucoes_custos where execucao_id='${eG150.id}'`)], ["150.5", "Márcia"]);
  eq("custo negativo recusado", registrar(U.gestor, exec(FORNO, "Manutenção corretiva", HOJE, { executor: { tipo: "externo", nome: "J", empresa_nome: "TecFrio" }, custo: -1 })).campo, "custo");
  const eGnull = registrar(U.gestor, exec(FORNO, "Manutenção corretiva", HOJE, { executor: { tipo: "externo", nome: "J", empresa_nome: "GelaMais" } }));
  const eG0 = registrar(U.gestor, exec(FORNO, "Manutenção corretiva", HOJE, { executor: { tipo: "externo", nome: "J", empresa_nome: "GelaMais" }, custo: 0 }));
  eq("externo sem custo = NULL (não informado); custo 0 digitado = 0 (null ≠ 0)", [custoDe(eGnull.id), custoDe(eG0.id)], ["NULL", "0"]);
  const eGint = registrar(U.gestor, exec(FORNO, "Lubrificação", HOJE, { custo: 50 }));
  eq("interno não tem linha de custo (não se aplica), mesmo se mandar valor", custoDe(eGint.id), "SEM LINHA");

  s = registrar(U.oper, exec(FORNO, "Limpeza", dia(1)));
  eq("data futura recusada", [erroDe(s), s.campo, s.mensagem], ["invalido", "data_execucao", "A data não pode ser no futuro."]);
  eq("data em outro formato recusada", registrar(U.oper, exec(FORNO, "Limpeza", "14/09/2026")).campo, "data_execucao");
  eq("de 8 dias atrás sem justificativa: recusado", registrar(U.oper, exec(FORNO, "Lubrificação", dia(-8))).campo, "justificativa_atraso");
  eq("de 7 dias atrás: aceito sem justificativa", registrar(U.oper, exec(FORNO, "Lubrificação", dia(-7))).ok, true);
  s = registrar(U.oper, exec(FORNO, "Lubrificação", dia(-8), { justificativa_atraso: "Caderno achado hoje" }));
  eq("de 8 dias atrás com justificativa: aceito e guardado", [s.ok, suV(`select justificativa_atraso from manutencao_execucoes where id='${s.id}'`)], [true, "Caderno achado hoje"]);
  eq("guardado sem internet ONTEM (dia_formulario) com data de 7 dias antes dele: chega hoje e é aceito sem justificativa",
     registrar(U.oper, exec(FORNO, "Lubrificação", dia(-8), { dia_formulario: dia(-1) })).ok, true);
  eq("…mas o dia do formulário só vale até 2 dias atrás, e não perdoa atraso maior",
     [registrar(U.oper, exec(FORNO, "Lubrificação", dia(-8), { dia_formulario: dia(-3) })).campo, registrar(U.oper, exec(FORNO, "Lubrificação", dia(-10), { dia_formulario: dia(-1) })).campo,
      registrar(U.oper, exec(FORNO, "Lubrificação", dia(-8), { dia_formulario: "ontem" })).campo], ["justificativa_atraso", "justificativa_atraso", "justificativa_atraso"]);

  const pProb = exec(FORNO, "Limpeza", HOJE, { resultado: "problema", problema_descricao: "Borracha da porta rasgada" });
  const eProb = registrar(U.oper, pProb);
  eq("resultado 'problema' abre pendência na mesma gravação", [eProb.ok, !!eProb.pendencia_id], [true, true]);
  eq("pendência: descrição, aberta, responsável da rotina, origem",
     suV(`select descricao||'|'||status||'|'||responsavel_nome||'|'||responsavel_perfil_id||'|'||(execucao_origem_id='${eProb.id}')||'|'||aberta_por_nome from manutencao_pendencias where id='${eProb.pendencia_id}'`),
     `Borracha da porta rasgada|aberta|Cícero|${U.oper2}|true|Laryze`);
  eq("reenvio do problema não abre 2ª pendência", [registrar(U.oper, pProb).pendencia_id === eProb.pendencia_id, suV(`select count(*) from manutencao_pendencias where execucao_origem_id='${eProb.id}'`)], [true, "1"]);
  eq("problema sem descrição recusado", registrar(U.oper, exec(FORNO, "Limpeza", HOJE, { resultado: "problema", problema_descricao: "" })).campo, "problema_descricao");
  eq("resultado desconhecido recusado", registrar(U.oper, exec(FORNO, "Limpeza", HOJE, { resultado: "talvez" })).campo, "resultado");
  eq("nova execução NÃO fecha a pendência", suV(`select status from manutencao_pendencias where id='${eProb.pendencia_id}'`), "aberta");

  const CONG = "emr9b5cgj174";
  const congAntes = rpc(U.oper, "manutencao_painel").equipamentos.find((e) => e.id === CONG);
  const eAv = registrar(U.oper, exec(CONG, "Manutenção corretiva", HOJE));
  const congDepois = rpc(U.oper, "manutencao_painel").equipamentos.find((e) => e.id === CONG);
  eq("avulsa (corretiva) na câmara: sem rotina e sem estado", [eAv.ok, eAv.rotina_id, eAv.estado], [true, null, null]);
  eq("avulsa NÃO reancora a limpeza: continua atrasada, mesmos dias, mesma última",
     [congDepois.rotinas[0].estado, congDepois.rotinas[0].dias, congDepois.rotinas[0].ultima_data], [congAntes.rotinas[0].estado, congAntes.rotinas[0].dias, "2026-07-06"]);
  eq("mas aparece como última execução do equipamento", congDepois.ultima_execucao.tipo_servico, "Manutenção corretiva");
  eq("registrar serviço NUNCA altera equipamento nem rotina (versão/atualizado iguais)", snapEqRot(), antesSnap);

  eq("sem quem executou: recusado", registrar(U.oper, exec(FORNO, "Limpeza", HOJE, { executor: { tipo: "interno", nome: "" } })).campo, "executor");
  eq("tipo de executor inválido / pessoa inválida", [registrar(U.oper, exec(FORNO, "Limpeza", HOJE, { executor: { tipo: "chefe", nome: "A" } })).campo,
     registrar(U.oper, exec(FORNO, "Limpeza", HOJE, { executor: { tipo: "interno", ref: "hack", nome: "A" } })).campo], ["executor", "executor"]);
  eq("serviço vazio recusado", registrar(U.oper, exec(FORNO, " ", HOJE)).campo, "tipo_servico");
  eq("equipamento inexistente", erroDe(registrar(U.oper, exec("naoexiste", "Limpeza", HOJE))), "nao_encontrado");
  eq("sem request_id recusado", registrar(U.oper, Object.assign(exec(FORNO, "Limpeza", HOJE), { request_id: "" })).campo, "request_id");

  s = rpc(U.gestor, "manutencao_rotina_salvar", lit({ id: CONF, versao: 1, exige_foto_depois: true }));
  eq("gestor liga 'exigir foto depois' na Conferência (sem mexer no resto)", [s.ok, s.rotina.exige_foto_depois, s.rotina.periodicidade_dias], [true, true, 7]);
  eq("rotina que exige foto: sem a foto recusado", registrar(U.oper, exec(FORNO, "Conferência", HOJE)).campo, "foto_depois");
  const foto = (cat, cam, extra) => Object.assign({ categoria: cat, caminho: cam, mime: "image/jpeg", nome_original: "foto.jpg", bytes: 1000 }, extra || {});
  s = registrar(U.oper, exec(FORNO, "Conferência", HOJE, { anexos: [foto("foto_depois", "v2/foto_depois/aaa.jpg")] }));
  eq("anexo cujo arquivo NÃO existe no depósito: recusado", [s.campo, s.mensagem], ["anexos", "O arquivo não chegou ao depósito. Envie de novo."]);
  r = comoR(U.gestor, "insert into storage.objects (bucket_id, name) values ('manutencoes', 'v2/foto_depois/do-gestor.jpg')");
  s = registrar(U.oper2, exec(FORNO, "Conferência", HOJE, { anexos: [foto("foto_depois", "v2/foto_depois/do-gestor.jpg")] }));
  eq("foto enviada por OUTRA pessoa (ainda a caminho do registro dela): o operacional não 'pega' para o registro dele",
     [r.ok, suV("select owner_id from storage.objects where name='v2/foto_depois/do-gestor.jpg'"), s.campo, s.mensagem, suV("select count(*) from manutencao_anexos where caminho='v2/foto_depois/do-gestor.jpg'")],
     [true, U.gestor, "anexos", "Este arquivo foi enviado por outra pessoa. Envie a foto de novo.", "0"]);
  objeto("v2/foto_depois/aaa.jpg");
  const eFoto = registrar(U.oper, exec(FORNO, "Conferência", HOJE, { anexos: [foto("foto_depois", "v2/foto_depois/aaa.jpg")] }));
  eq("com a foto enviada: aceito e anexo gravado", [eFoto.ok, suV(`select count(*) from manutencao_anexos where dono_tipo='execucao' and dono_id='${eFoto.id}' and categoria='foto_depois'`)], [true, "1"]);
  eq("mesmo arquivo em outro registro: recusado", registrar(U.oper, exec(FORNO, "Conferência", HOJE, { anexos: [foto("foto_depois", "v2/foto_depois/aaa.jpg")] })).campo, "anexos");
  objeto("v2/foto_antes/bbb.jpg"); objeto("v2/foto_depois/ccc.svg"); objeto("v2/foto_depois/ddd.jpg"); objeto("v2/foto_depois/eee.jpg");
  eq("caminho fora da pasta da categoria / SVG / manual aqui / acima de 25 MB: recusados", [
    registrar(U.oper, exec(FORNO, "Conferência", HOJE, { anexos: [foto("foto_depois", "v2/foto_antes/bbb.jpg")] })).campo,
    registrar(U.oper, exec(FORNO, "Conferência", HOJE, { anexos: [foto("foto_depois", "v2/foto_depois/ccc.svg", { mime: "image/svg+xml" })] })).campo,
    registrar(U.oper, exec(FORNO, "Conferência", HOJE, { anexos: [foto("foto_depois", "v2/foto_depois/eee.jpg"), foto("manual_fabricante", "v2/foto_depois/ddd.jpg")] })).campo,
    registrar(U.oper, exec(FORNO, "Conferência", HOJE, { anexos: [foto("foto_depois", "v2/foto_depois/ddd.jpg", { bytes: 30000000 })] })).campo], ["anexos", "anexos", "anexos", "anexos"]);

  objeto("v2/nota_fiscal/nf1.pdf");
  const eNota = registrar(U.oper, exec(FORNO, "Manutenção corretiva", HOJE, { executor: { tipo: "externo", nome: "João", empresa_nome: "TecFrio" },
    anexos: [{ categoria: "nota_fiscal", caminho: "v2/nota_fiscal/nf1.pdf", mime: "application/pdf", nome_original: "NF 123.pdf", bytes: 2048 }] }));
  eq("operacional ANEXA nota fiscal", eNota.ok, true);
  eq("SELECT da nota: operacional 0, gestor 2 (esta + a nota migrada da tela antiga)", [como(U.oper, "select count(*) from manutencao_anexos where categoria='nota_fiscal'"), como(U.gestor, "select count(*) from manutencao_anexos where categoria='nota_fiscal'")], ["0", "2"]);
  eq("operacional vê as fotos (não é financeiro)", como(U.oper, "select count(*) from manutencao_anexos where categoria='foto_depois'"), "1");
  const histOp = rpc(U.oper, "manutencao_historico", `'${FORNO}', 100`);
  const histG = rpc(U.gestor, "manutencao_historico", `'${FORNO}', 100`);
  const itOp = histOp.itens.find((x) => x.id === eNota.id), itG = histG.itens.find((x) => x.id === eNota.id);
  eq("histórico do operacional: nota {oculto:true} sem caminho; custo 'oculto'", [itOp.anexos, itOp.custo, itOp.custo_situacao], [[{ oculto: true, categoria: "nota_fiscal" }], "oculto", "oculto"]);
  eq("histórico do gestor: abre a nota; custo não informado", [itG.anexos[0].caminho, itG.custo, itG.custo_situacao], ["v2/nota_fiscal/nf1.pdf", null, "nao_informado"]);
  eq("histórico do gestor: 150,5 informado / 0 informado / interno não se aplica",
     [histG.itens.find((x) => x.id === eG150.id).custo, histG.itens.find((x) => x.id === eG0.id).custo_situacao + ":" + histG.itens.find((x) => x.id === eG0.id).custo, histG.itens.find((x) => x.id === eGint.id).custo_situacao],
     [150.5, "informado:0", "nao_se_aplica"]);
  eq("histórico traz a pendência aberta pelo registro", histOp.itens.find((x) => x.id === eProb.id).pendencia_aberta_id, eProb.pendencia_id);

  // ============================================================
  console.log("\n=== 12. Anular (única correção; sai do ciclo) ===\n");
  // ============================================================
  const eResf = registrar(U.oper, exec(RESF, "Limpeza", HOJE));
  eq("limpeza hoje na Resfriado: em dia", [eResf.estado, eResf.proxima], ["em_dia", dia(30)]);
  eq("operacional não anula", erroDe(rpc(U.oper, "manutencao_execucao_anular", `'${eResf.id}', 'Lançado errado'`)), "sem_permissao");
  eq("motivo curto recusado", rpc(U.gestor, "manutencao_execucao_anular", `'${eResf.id}', 'erro'`).campo, "motivo");
  s = rpc(U.gestor, "manutencao_execucao_anular", `'${eResf.id}', 'Lançado no equipamento errado'`);
  eq("gestor anula: a rotina volta ao estado de antes (atrasada desde 06/08)", [s.ok, s.anulada, s.estado, s.proxima, s.dias], [true, true, "atrasado", "2026-08-06", diffDias("2026-08-06", HOJE)]);
  eq("não apaga: a linha continua, marcada", suV(`select anulada||'|'||anulada_por_nome||'|'||anulada_motivo from manutencao_execucoes where id='${eResf.id}'`), "true|Márcia|Lançado no equipamento errado");
  eq("anular duas vezes: recusado", rpc(U.gestor, "manutencao_execucao_anular", `'${eResf.id}', 'de novo, outro motivo'`).campo, "anulada");
  eq("inexistente", erroDe(rpc(U.gestor, "manutencao_execucao_anular", `'naoexiste', 'motivo qualquer'`)), "nao_encontrado");
  eq("painel: última da rotina volta a ser 07/07", rpc(U.oper, "manutencao_painel").equipamentos.find((e) => e.id === RESF).rotinas[0].ultima_data, "2026-07-07");
  s = rpc(U.gestorSo, "manutencao_execucao_anular", `'${eProb.id}', 'Problema lançado na limpeza errada'`);
  eq("anular a execução com problema NÃO fecha a pendência", [s.ok, suV(`select status from manutencao_pendencias where id='${eProb.pendencia_id}'`)], [true, "aberta"]);
  const hAn = rpc(U.oper, "manutencao_historico", `'${RESF}'`).itens.find((x) => x.id === eResf.id);
  eq("histórico mostra a anulada com quem e por quê", [hAn.anulada, hAn.anulada_por_nome, hAn.anulada_motivo], [true, "Márcia", "Lançado no equipamento errado"]);
  eq("auditoria 'execucao_anular' com antes/depois e justificativa",
     suV(`select acao||'|'||(antes->>'anulada')||'>'||(depois->>'anulada')||'|'||justificativa from manutencao_auditoria where entidade_id='${eResf.id}' order by id desc limit 1`), "execucao_anular|false>true|Lançado no equipamento errado");

  // ROTINA-RECRIADA: desativar e recriar a mesma rotina não zera o atraso
  s = rpc(U.gestor, "manutencao_equipamento_salvar", lit({ nome: "Câmara Rotina Recriada", tipo: "Câmara fria", setor: "Hortifrúti" }));
  const RECR = s.equipamento.id;
  const rotR1 = rpc(U.gestor, "manutencao_rotina_salvar", lit({ equipamento_id: RECR, tipo_servico: "Limpeza", periodicidade_dias: 10 })).rotina;
  const eR = registrar(U.oper, exec(RECR, "Limpeza", dia(-40), { justificativa_atraso: "Caderno da câmara" }));
  const estRecr = () => { const e = rpc(U.oper, "manutencao_painel").equipamentos.find((x) => x.id === RECR); return [e.estado, e.dias, e.rotinas.map((q) => q.estado + "/" + q.ultima_data).join(",")]; };
  eq("antes: Limpeza/10 com a última há 40 dias = atrasada há 30", [eR.ok, eR.estado].concat(estRecr()), [true, "atrasado", "atrasado", -30, "atrasado/" + dia(-40)]);
  const resRecrAntes = rpc(U.oper, "manutencao_resumo").atrasado;
  s = rpc(U.gestor, "manutencao_rotina_desativar", `'${rotR1.id}', ${rotR1.versao}, 'refazer a rotina'`);
  const rotR2 = rpc(U.gestor, "manutencao_rotina_salvar", lit({ equipamento_id: RECR, tipo_servico: "limpeza", periodicidade_dias: 10 }));
  eq("desativar e recriar 'limpeza'/10: a rotina nova já nasce atrasada pela última Limpeza (não vira 'Aguardando 1ª'); painel e resumo iguais",
     [s.ok, rotR2.ok, rotR2.rotina && rotR2.rotina.estado, rotR2.rotina && rotR2.rotina.dias, rotR2.rotina && rotR2.rotina.ultima_data].concat(estRecr(), [rpc(U.oper, "manutencao_resumo").atrasado]),
     [true, true, "atrasado", -30, dia(-40), "atrasado", -30, "atrasado/" + dia(-40), resRecrAntes]);
  const eAvR = registrar(U.oper, exec(RECR, "Troca de peça", HOJE));
  eq("serviço de OUTRO tipo (avulsa) continua sem mexer no ciclo da rotina recriada (D4)", [eAvR.ok, eAvR.rotina_id].concat(estRecr().slice(0, 2)), [true, null, "atrasado", -30]);
  const eR2 = registrar(U.oper, exec(RECR, "Limpeza", HOJE));
  eq("a limpeza de hoje liga na rotina nova e ela fica em dia", [eR2.ok, eR2.rotina_id === (rotR2.rotina && rotR2.rotina.id), eR2.estado, eR2.dias], [true, true, "em_dia", 10]);

  // ROTINA-RECRIADA-DATA-INICIO: equipamento que NUNCA teve rotina desse serviço. O serviço avulso antigo não manda
  // na 1ª rotina: a "Primeira execução até" escolhida vale, e sem data fica "Aguardando 1ª execução" (D4/D6).
  s = rpc(U.gestor, "manutencao_equipamento_salvar", lit({ nome: "Balcão Primeira Rotina", tipo: "Balcão refrigerado", setor: "Frios e Laticínios" }));
  const PRIM = s.equipamento.id;
  const avPrim = registrar(U.oper, exec(PRIM, "Limpeza", dia(-60), { justificativa_atraso: "Caderno do balcão" }));
  const avPrimD = registrar(U.oper, exec(PRIM, "Degelo", dia(-30), { justificativa_atraso: "Caderno do balcão" }));
  const rotPrim = rpc(U.gestor, "manutencao_rotina_salvar", lit({ equipamento_id: PRIM, tipo_servico: "Limpeza", periodicidade_dias: 30, data_inicio: dia(7) }));
  const rotPrimD = rpc(U.gestor, "manutencao_rotina_salvar", lit({ equipamento_id: PRIM, tipo_servico: "Degelo", periodicidade_dias: 15 }));
  const ePrim = rpc(U.oper, "manutencao_painel").equipamentos.find((x) => x.id === PRIM);
  eq("1ª rotina 'Limpeza a cada 30 dias' com 1ª execução daqui a 7 dias, depois de uma Limpeza avulsa há 60 dias: nasce 'proximo' na data escolhida",
     [avPrim.ok, avPrim.rotina_id, rotPrim.ok, rotPrim.rotina.estado, rotPrim.rotina.dias, rotPrim.rotina.proxima, rotPrim.rotina.ultima_data, ePrim.estado, ePrim.dias],
     [true, null, true, "proximo", 7, dia(7), null, "proximo", 7]);
  eq("1ª rotina sem data, depois de um Degelo avulso: 'Aguardando 1ª execução' (como a dica da tela diz)",
     [avPrimD.ok, rotPrimD.ok, rotPrimD.rotina.estado, rotPrimD.rotina.ultima_data], [true, true, "primeira", null]);
  // … mas quando a rotina desse serviço JÁ EXISTIU (desativada), o serviço feito sem rotina continua contando
  const rotPrimV = Number(suV(`select versao from manutencao_rotinas where id='${rotPrim.rotina.id}'`));
  const desPrim = rpc(U.gestor, "manutencao_rotina_desativar", `'${rotPrim.rotina.id}', ${rotPrimV}, 'refazer a rotina'`);
  const avPrim2 = registrar(U.oper, exec(PRIM, "Limpeza", dia(-2)));
  const rotPrim2 = rpc(U.gestor, "manutencao_rotina_salvar", lit({ equipamento_id: PRIM, tipo_servico: "Limpeza", periodicidade_dias: 30, data_inicio: dia(20) }));
  eq("rotina desativada, Limpeza feita sem rotina há 2 dias, rotina recriada: parte dessa Limpeza (em dia, faltam 28)",
     [desPrim.ok, avPrim2.ok, avPrim2.rotina_id, rotPrim2.ok, rotPrim2.rotina.estado, rotPrim2.rotina.dias, rotPrim2.rotina.ultima_data], [true, true, null, true, "em_dia", 28, dia(-2)]);

  // ============================================================
  console.log("\n=== 13. Histórico imutável: UPDATE/DELETE direto recusados até para o dono do banco ===\n");
  // ============================================================
  const falhaSu = (sql, pedaco) => { const x = su(sql); return !x.ok && x.erro.includes(pedaco); };
  vale("dono do banco: UPDATE de execução recusado", falhaSu(`update manutencao_execucoes set observacao='troca' where id='${e1.id}'`, "não pode ser alterado"));
  vale("dono do banco: DELETE de execução recusado", falhaSu(`delete from manutencao_execucoes where id='${e1.id}'`, "não pode ser apagado"));
  vale("anular direto sem passar pela função: recusado", falhaSu(`update manutencao_execucoes set anulada=true, anulada_em=now(), anulada_motivo='por fora' where id='${e1.id}'`, "não pode ser alterado"));
  vale("com a marca da função mas trocando outro campo junto: recusado",
    falhaSu(`begin; select set_config('manutencao.rpc','anular',true); update manutencao_execucoes set anulada=true, anulada_em=now(), anulada_motivo='por fora', data_execucao='2020-01-01' where id='${e1.id}'; commit;`, "não pode ser alterado"));
  vale("insert direto com data futura: recusado pelo gatilho",
    falhaSu(`insert into manutencao_execucoes (id,equipamento_id,tipo_servico,data_execucao,executor_tipo,executor_nome,resultado,equipamento_nome_snap) values ('fut','${FORNO}','X','${dia(2)}','interno','A','ok','F')`, "futuro"));
  vale("auditoria: UPDATE recusado", falhaSu("update manutencao_auditoria set acao='nada'", "não pode ser alterada"));
  vale("auditoria: DELETE recusado", falhaSu("delete from manutencao_auditoria", "não pode ser alterada"));
  vale("auditoria: TRUNCATE recusado", falhaSu("truncate manutencao_auditoria", "não pode ser alterada"));
  eq("execução intacta depois das tentativas", suV(`select anulada||'|'||data_execucao||'|'||coalesce(observacao,'-') from manutencao_execucoes where id='${e1.id}'`), `false|${HOJE}|-`);

  // ============================================================
  console.log("\n=== 14. Visão gerencial ===\n");
  // ============================================================
  eq("período fora de 30/90/365 recusado", rpc(U.gestor, "manutencao_gerencial", "45").campo, "p_dias");
  let g30 = rpc(U.gestor, "manutencao_gerencial", "30");
  eq("período de 30 dias = [hoje−29, hoje]", [g30.periodo.de, g30.periodo.ate], [dia(-29), HOJE]);
  vale("poucas execuções de rotina: 'suficiente' = false (DADOS INSUFICIENTES)", g30.no_prazo.suficiente === false && g30.no_prazo.rotina_execucoes < 5, JSON.stringify(g30.no_prazo));
  const g365a = rpc(U.gestor, "manutencao_gerencial", "365");
  s = rpc(U.gestor, "manutencao_equipamento_salvar", lit({ nome: "Balcão Teste Gerencial", tipo: "Balcão refrigerado", setor: "Frios e Laticínios" }));
  const BALC = s.equipamento.id;
  const rotBalc = rpc(U.gestor, "manutencao_rotina_salvar", lit({ equipamento_id: BALC, tipo_servico: "Limpeza", periodicidade_dias: 10, data_inicio: dia(-60) })).rotina;
  // prevista: -60 (data de início) | -50 | -35 | -26 | -16 | 0   => no prazo: -60 ok, -45 atrasou, -36 ok, -26 ok, -10 atrasou, -5 ok
  for (const [d, res] of [[-60, "ok"], [-45, "ok"], [-36, "ok"], [-26, "ok"], [-10, "problema"], [-5, "problema"]]) {
    const x = registrar(U.oper, exec(BALC, "Limpeza", dia(d), { justificativa_atraso: "Lançamento de teste", resultado: res, problema_descricao: "Vazamento no dreno" }));
    if (!x.ok) throw new Error("gerencial: " + JSON.stringify(x));
  }
  const g365b = rpc(U.gestor, "manutencao_gerencial", "365");
  eq("no prazo (365 dias): +6 execuções de rotina, +4 no prazo",
     [g365b.no_prazo.rotina_execucoes - g365a.no_prazo.rotina_execucoes, g365b.no_prazo.no_prazo - g365a.no_prazo.no_prazo], [6, 4]);
  eq("percentual e suficiente coerentes", [g365b.no_prazo.suficiente, g365b.no_prazo.percentual],
     [g365b.no_prazo.rotina_execucoes >= 5, Math.round(1000 * g365b.no_prazo.no_prazo / g365b.no_prazo.rotina_execucoes) / 10]);
  const g30b = rpc(U.gestor, "manutencao_gerencial", "30");
  eq("no prazo (30 dias): só as de −26, −10, −5 (+3, +2 no prazo)",
     [g30b.no_prazo.rotina_execucoes - g30.no_prazo.rotina_execucoes, g30b.no_prazo.no_prazo - g30.no_prazo.no_prazo], [3, 2]);
  eq("problemas por equipamento no período", g30b.problemas_por_equipamento.find((x) => x.equipamento_id === BALC).problemas, 2);
  eq("reincidência: 2 problemas na mesma rotina em 90 dias", (g30b.reincidencias.find((x) => x.equipamento_id === BALC) || {}).problemas, 2);
  eq("atrasos por setor: Açougue com as 2 câmaras atrasadas", g30b.atrasos_por_setor.find((x) => x.setor === "Açougue"), { setor: "Açougue", rotinas: 2, atrasadas: 2 });
  eq("custos do período: total informado 500,5 (150,5 + 0 + 350); 6 externas; 3 sem custo",
     [g30b.custos.total_informado, g30b.custos.execucoes_externas, g30b.custos.sem_custo_informado], [500.5, 6, 3]);
  eq("custos por prestador (null ≠ 0)", ["TecFrio", "GelaMais", "Não informado"].map((n) => { const p = g30b.custos.por_prestador.find((x) => x.empresa === n); return p ? p.total + "/" + p.qtd : "-"; }), ["150.5/3", "0/2", "350/1"]);
  eq("custos por setor", g30b.custos.por_setor, [{ setor: "Padaria", total: 500.5 }]);
  eq("pendências: 3 abertas, nenhuma antiga", [g30b.pendencias.abertas, g30b.pendencias.antigas_15_dias, g30b.pendencias.tempo_medio_dias], [3, 0, null]);
  const q = (tipo) => g30b.qualidade.filter((x) => x.tipo === tipo);
  eq("qualidade: rotina migrada a confirmar (Balanças Caixa 101)", q("rotina_tipo_a_confirmar").map((x) => x.nome + ": " + x.detalhe), ["Balanças Caixa 101: Rotina migrada: confirmar o tipo de serviço"]);
  eq("qualidade: custo não informado (3) e sem programação inclui o Balcão Iogurte",
     [q("custo_nao_informado").length, q("equipamento_sem_programacao").some((x) => x.equipamento_id === "emrar74vp156"), q("rotina_sem_periodicidade").some((x) => x.rotina_id === FILT)], [3, true, true]);
  eq("anulada não entra: execuções do período não contam a limpeza anulada da Resfriado",
     suV(`select count(*) from manutencao_execucoes where not anulada and data_execucao between '${dia(-29)}' and '${HOJE}'`), String(g30b.execucoes_no_periodo));

  // mudar a rotina HOJE não reescreve o "no prazo" do passado
  const rotBalcV = () => Number(suV(`select versao from manutencao_rotinas where id='${rotBalc.id}'`));
  eq("rotina com serviços: mudar só a data da 1ª execução pede justificativa",
     [rpc(U.gestor, "manutencao_rotina_salvar", lit({ id: rotBalc.id, versao: rotBalcV(), data_inicio: dia(-45) })).campo,
      rpc(U.gestor, "manutencao_rotina_salvar", lit({ id: rotBalc.id, versao: rotBalcV(), data_inicio: dia(-45) })).mensagem], ["justificativa", "Esta rotina já tem serviços registrados. Explique por que a data da primeira execução mudou."]);
  s = rpc(U.gestor, "manutencao_rotina_salvar", lit({ id: rotBalc.id, versao: rotBalcV(), data_inicio: dia(-45), periodicidade_dias: 40, justificativa: "Teste: programação refeita" }));
  const g365c = rpc(U.gestor, "manutencao_gerencial", "365");
  eq("com justificativa muda (data 1ª execução e periodicidade), mas o 'no prazo' de 365 dias continua igual (snapshot da época)",
     [s.ok, s.rotina.data_inicio, g365c.no_prazo.rotina_execucoes, g365c.no_prazo.no_prazo], [true, dia(-45), g365b.no_prazo.rotina_execucoes, g365b.no_prazo.no_prazo]);
  eq("a 1ª execução guardou a data de início da época", suV(`select string_agg(coalesce(data_inicio_snap::text,'-'), ',' order by data_execucao) from manutencao_execucoes where rotina_id='${rotBalc.id}'`), Array(6).fill(dia(-60)).join(","));
  // a mesma limpeza registrada 2 vezes no mesmo dia é UM serviço (o 2º registro não "salva" o atraso)
  const g30c = rpc(U.gestor, "manutencao_gerencial", "30");
  const dup = registrar(U.oper2, exec(BALC, "Limpeza", dia(-10), { executor: { tipo: "interno", ref: "livre", nome: "Cícero" }, justificativa_atraso: "Lançado de novo por engano" }));
  const g30d = rpc(U.gestor, "manutencao_gerencial", "30");
  eq("registro em dobro no mesmo dia (outra pessoa): aceito, mas o 'no prazo' não muda (nem conta 2 serviços)",
     [dup.ok, g30d.no_prazo.rotina_execucoes, g30d.no_prazo.no_prazo], [true, g30c.no_prazo.rotina_execucoes, g30c.no_prazo.no_prazo]);

  // ROTINA-RECRIADA-NO-PRAZO: a 1ª execução da rotina recriada entra no "no prazo" pela prevista herdada
  s = rpc(U.gestor, "manutencao_equipamento_salvar", lit({ nome: "Câmara No Prazo Recriada", tipo: "Câmara fria", setor: "Hortifrúti" }));
  const NPR = s.equipamento.id;
  const rotNp1 = rpc(U.gestor, "manutencao_rotina_salvar", lit({ equipamento_id: NPR, tipo_servico: "Limpeza", periodicidade_dias: 10 })).rotina;
  const xNp0 = registrar(U.oper, exec(NPR, "Limpeza", dia(-40), { justificativa_atraso: "Caderno da câmara" }));
  const desNp = rpc(U.gestor, "manutencao_rotina_desativar", `'${rotNp1.id}', ${Number(suV(`select versao from manutencao_rotinas where id='${rotNp1.id}'`))}, 'refazer a rotina'`);
  const rotNp2 = rpc(U.gestor, "manutencao_rotina_salvar", lit({ equipamento_id: NPR, tipo_servico: "Limpeza", periodicidade_dias: 10 })).rotina;
  const gNpA = rpc(U.gestor, "manutencao_gerencial", "30");
  const xNp = registrar(U.oper, exec(NPR, "Limpeza", HOJE));
  const gNpB = rpc(U.gestor, "manutencao_gerencial", "30");
  eq("rotina recriada (atrasada há 30 dias pela Limpeza herdada): a limpeza de hoje conta no 'no prazo' como atrasada (+1 execução, +0 no prazo) e guarda a prevista herdada",
     [xNp0.ok, desNp.ok, rotNp2.estado, xNp.ok, xNp.rotina_id === rotNp2.id, gNpB.no_prazo.rotina_execucoes - gNpA.no_prazo.rotina_execucoes, gNpB.no_prazo.no_prazo - gNpA.no_prazo.no_prazo,
      suV(`select coalesce(data_inicio_snap::text,'-') from manutencao_execucoes where id='${xNp.id}'`)],
     [true, true, "atrasado", true, true, 1, 0, dia(-30)]);

  // GRAFIA: setor e empresa digitados com outra grafia somam na MESMA linha, com a grafia mais usada
  const grafEq = ["Açougue", "açougue", "Acougue "].map((setor, i) => rpc(U.gestor, "manutencao_equipamento_salvar", lit({ nome: "Balcão Grafia " + (i + 1), tipo: "Balcão refrigerado", setor })).equipamento.id);
  grafEq.forEach((id) => rpc(U.gestor, "manutencao_rotina_salvar", lit({ equipamento_id: id, tipo_servico: "Limpeza", periodicidade_dias: 5, data_inicio: dia(-3) })));
  [[0, "TecFrio", 10], [0, "tecfrio", 20], [1, "TECFRIO ", 30], [2, "Tecfrio", 40]].forEach(([i, empresa, custo]) => {
    const x = registrar(U.gestor, exec(grafEq[i], "Manutenção corretiva", HOJE, { executor: { tipo: "externo", nome: "Técnico", empresa_nome: empresa }, custo }));
    if (!x.ok) throw new Error("grafia: " + JSON.stringify(x));
  });
  const gGraf = rpc(U.gestor, "manutencao_gerencial", "30");
  eq("atrasos por setor: 'Açougue', 'açougue' e 'Acougue' viram UMA linha 'Açougue' (2 câmaras + 3 balcões)",
     gGraf.atrasos_por_setor.filter((x) => /^a[cç]ougue$/i.test(x.setor)), [{ setor: "Açougue", rotinas: 5, atrasadas: 5 }]);
  eq("custos por setor: as 3 grafias somam numa linha 'Açougue'",
     gGraf.custos.por_setor.filter((x) => /^a[cç]ougue$/i.test(x.setor)), [{ setor: "Açougue", total: 100 }]);
  eq("custos por prestador: 'TecFrio', 'tecfrio', 'TECFRIO' e 'Tecfrio' somam numa linha 'TecFrio' (150,5 de antes + 100)",
     gGraf.custos.por_prestador.filter((x) => /^tecfrio$/i.test(x.empresa)), [{ qtd: 7, total: 250.5, empresa: "TecFrio" }]);

  // ============================================================
  console.log("\n=== 15. Custo: só gestor informa; null ≠ 0; interno não se aplica ===\n");
  // ============================================================
  eq("operacional não informa custo", erroDe(rpc(U.oper, "manutencao_custo_informar", `'${eGnull.id}', 80, null`)), "sem_permissao");
  eq("interno: não tem custo", rpc(U.gestor, "manutencao_custo_informar", `'${eGint.id}', 10, null`).campo, "custo");
  s = rpc(U.gestor, "manutencao_custo_informar", `'${eGnull.id}', 80, null`);
  eq("de 'não informado' para 80: não pede motivo", [s.ok, s.custo, s.custo_situacao], [true, 80, "informado"]);
  eq("mudar valor já informado sem motivo: recusado", rpc(U.gestor, "manutencao_custo_informar", `'${eGnull.id}', 90, ''`).campo, "motivo");
  s = rpc(U.gestor, "manutencao_custo_informar", `'${eGnull.id}', 90, 'Nota chegou com frete'`);
  eq("com motivo: ok e auditoria com antes/depois e justificativa", [s.custo, suV(`select (antes->>'custo')||'>'||(depois->>'custo')||'|'||justificativa from manutencao_auditoria where entidade='custo' and entidade_id='${eGnull.id}' order by id desc limit 1`)], [90, "80>90|Nota chegou com frete"]);
  s = rpc(U.gestor, "manutencao_custo_informar", `'${eGnull.id}', null, 'Valor era de outro serviço'`);
  eq("custo null volta a 'não informado' (não vira zero)", [s.custo, s.custo_situacao, custoDe(eGnull.id)], [null, "nao_informado", "NULL"]);
  eq("negativo recusado", rpc(U.gestor, "manutencao_custo_informar", `'${eG0.id}', -5, 'motivo qualquer'`).campo, "custo");
  rpc(U.gestor, "manutencao_execucao_anular", `'${eOpExt.id}', 'Serviço duplicado pelo operador'`);
  eq("execução anulada não recebe custo", rpc(U.gestor, "manutencao_custo_informar", `'${eOpExt.id}', 10, null`).campo, "anulada");
  eq("operacional continua sem ler a tabela de custos", como(U.oper, "select count(*) from manutencao_execucoes_custos"), "0");

  // ============================================================
  console.log("\n=== 16. Pendências: abrir / resolver / cancelar ===\n");
  // ============================================================
  const pPend = { request_id: rq(500), equipamento_id: FORNO, descricao: "Lâmpada interna queimada", responsavel: { ref: "perfil:" + U.oper2 } };
  const pd1 = rpc(U.oper, "manutencao_pendencia_abrir", lit(pPend));
  eq("operacional abre: aberta, nome do responsável vem do perfil", [pd1.ok, pd1.repetido, pd1.pendencia.status, pd1.pendencia.responsavel_nome, pd1.pendencia.aberta_por_nome], [true, false, "aberta", "Cícero", "Laryze"]);
  const pd1b = rpc(U.oper, "manutencao_pendencia_abrir", lit(pPend));
  eq("mesmo request_id: mesma pendência (idempotente)", [pd1b.id === pd1.id, pd1b.repetido, suV(`select count(*) from manutencao_pendencias where request_id='${rq(500)}'`)], [true, true, "1"]);
  const pd1c = rpc(U.oper2, "manutencao_pendencia_abrir", lit(pPend));
  eq("o request_id da pendência de OUTRA pessoa: duplicado (não devolve a pendência dela)", [erroDe(pd1c), pd1c.campo, pd1c.id, suV(`select count(*) from manutencao_pendencias where request_id='${rq(500)}'`)], ["duplicado", "request_id", undefined, "1"]);
  eq("descrição curta / equipamento inexistente", [rpc(U.oper, "manutencao_pendencia_abrir", lit({ request_id: rq(501), equipamento_id: FORNO, descricao: "ab" })).campo,
     erroDe(rpc(U.oper, "manutencao_pendencia_abrir", lit({ request_id: rq(502), equipamento_id: "naoexiste", descricao: "Porta solta" })))], ["descricao", "nao_encontrado"]);
  eq("resolver com versão velha: conflito", erroDe(rpc(U.oper2, "manutencao_pendencia_resolver", `'${pd1.id}', 0, 'Troquei a lâmpada'`)), "conflito");
  eq("solução curta recusada", rpc(U.oper2, "manutencao_pendencia_resolver", `'${pd1.id}', 1, 'ok'`).campo, "solucao");
  eq("serviço de outro equipamento não serve de solução", rpc(U.oper2, "manutencao_pendencia_resolver", `'${pd1.id}', 1, 'Troquei a lâmpada', '${eAv.id}'`).campo, "execucao_id");
  s = rpc(U.oper2, "manutencao_pendencia_resolver", `'${pd1.id}', 1, 'Troquei a lâmpada', '${e1.id}'`);
  eq("operacional resolve: resolvida, quem, solução, serviço ligado, versão 2", [s.ok, s.pendencia.status, s.pendencia.resolvida_por_nome, s.pendencia.execucao_solucao_id === e1.id, s.pendencia.versao], [true, "resolvida", "Cícero", true, 2]);
  const audResolver = () => suV(`select count(*) from manutencao_auditoria where entidade_id='${pd1.id}' and acao='pendencia_resolver'`);
  s = rpc(U.oper2, "manutencao_pendencia_resolver", `'${pd1.id}', 1, 'Troquei a lâmpada', '${e1.id}'`);
  eq("fila reenvia o MESMO resolver (resposta perdida): ok, sem 'alterada por outra pessoa' e sem gravar de novo",
     [s.ok, s.pendencia && s.pendencia.status, s.pendencia && s.pendencia.versao, audResolver()], [true, "resolvida", 2, "1"]);
  eq("…mas outra pessoa, ou outra solução, com a versão velha continua conflito",
     [erroDe(rpc(U.oper, "manutencao_pendencia_resolver", `'${pd1.id}', 1, 'Troquei a lâmpada', '${e1.id}'`)), erroDe(rpc(U.oper2, "manutencao_pendencia_resolver", `'${pd1.id}', 1, 'Outra coisa', '${e1.id}'`))], ["conflito", "conflito"]);
  eq("resolver de novo: não está mais aberta", rpc(U.oper2, "manutencao_pendencia_resolver", `'${pd1.id}', 2, 'Troquei de novo'`).campo, "status");
  const pd2 = rpc(U.oper, "manutencao_pendencia_abrir", lit({ request_id: rq(503), equipamento_id: FORNO, descricao: "Pé nivelador torto" }));
  eq("operacional não cancela", erroDe(rpc(U.oper, "manutencao_pendencia_cancelar", `'${pd2.id}', 1, 'Não era problema'`)), "sem_permissao");
  eq("gestor: motivo curto recusado", rpc(U.gestor, "manutencao_pendencia_cancelar", `'${pd2.id}', 1, 'não'`).campo, "motivo");
  s = rpc(U.gestor, "manutencao_pendencia_cancelar", `'${pd2.id}', 1, 'Aberta em duplicidade'`);
  eq("gestor cancela", [s.ok, s.pendencia.status, s.pendencia.cancelada_motivo, s.pendencia.cancelada_por_nome], [true, "cancelada", "Aberta em duplicidade", "Márcia"]);
  eq("cancelar a já resolvida: não está aberta", rpc(U.gestor, "manutencao_pendencia_cancelar", `'${pd1.id}', 2, 'motivo qualquer'`).campo, "status");
  eq("auditoria: abrir → resolver; abrir → cancelar (com justificativa)",
     [suV(`select string_agg(acao, ',' order by id) from manutencao_auditoria where entidade_id='${pd1.id}'`), suV(`select string_agg(acao||coalesce('('||justificativa||')',''), ',' order by id) from manutencao_auditoria where entidade_id='${pd2.id}'`)],
     ["pendencia_abrir,pendencia_resolver", "pendencia_abrir,pendencia_cancelar(Aberta em duplicidade)"]);
  const detP = rpc(U.oper, "manutencao_equipamento_detalhe", `'${FORNO}'`).pendencias;
  eq("detalhe: abertas primeiro", [detP[0].status, detP.length], ["aberta", 3]);
  const pnl = rpc(U.oper, "manutencao_painel");
  eq("painel: lista de pendências abertas com nome do equipamento; contagem bate",
     [pnl.pendencias.some((x) => x.id === eProb.pendencia_id && x.equipamento_nome === "Forno Combinado 1"), pnl.pendencias.length, pnl.contagens.pendencias_abertas], [true, pnl.contagens.pendencias_abertas, 3]);

  // quem cancelou / desativou / inativou / cadastrou fica gravado NA HORA: renomear a ficha não reescreve o passado
  s = rpc(U.gestor, "manutencao_equipamento_salvar", lit({ nome: "Equipamento Nome Teste", tipo: "Teste", setor: "Teste" }));
  const EQNOME = s.equipamento.id;
  rpc(U.gestor, "manutencao_equipamento_inativar", `'${EQNOME}', ${verEq(EQNOME)}, 'Teste de nome gravado'`);
  su(`update perfis set nome='Márcia Souza Lima' where id='${U.gestor}'`);
  const detNome = rpc(U.gestor, "manutencao_equipamento_detalhe", `'${EQNOME}'`).equipamento;
  const detForno = rpc(U.gestor, "manutencao_equipamento_detalhe", `'${FORNO}'`);
  eq("ficha renomeada depois: cancelada_por_nome, desativada_por_nome, inativado_por_nome e criado_por_nome continuam 'Márcia'",
     [detForno.pendencias.find((x) => x.id === pd2.id).cancelada_por_nome, detForno.rotinas.find((x) => x.id === INSP).desativada_por_nome, detNome.inativado_por_nome, detNome.criado_por_nome],
     ["Márcia", "Márcia", "Márcia", "Márcia"]);
  su(`update perfis set nome='Márcia' where id='${U.gestor}'`);
  s = rpc(U.gestor, "manutencao_equipamento_salvar", lit({ nome: "Equipamento Nome Teste", tipo: "Teste", setor: "Teste" }));
  eq("nome igual ao de um equipamento INATIVO não bloqueia o cadastro", [s.ok, suV("select string_agg(status, ',' order by status) from manutencao_equipamentos where nome='Equipamento Nome Teste'")], [true, "ativo,inativo"]);

  // ============================================================
  console.log("\n=== 17. Auditoria: leitura paginada só para gestor ===\n");
  // ============================================================
  const a1 = rpc(U.gestor, "manutencao_auditoria_listar", `'${FORNO}', 5`);
  eq("página 1: 5 itens, do mais novo, com cursor", [a1.ok, a1.itens.length, a1.itens[0].id > a1.itens[4].id, a1.proximo_cursor === a1.itens[4].id], [true, 5, true, true]);
  const a2 = rpc(U.gestor, "manutencao_auditoria_listar", `'${FORNO}', 5, ${a1.proximo_cursor}`);
  eq("página 2 continua sem repetir", [a2.itens.length, a2.itens.every((x) => x.id < a1.proximo_cursor)], [5, true]);
  const todos = rpc(U.gestor, "manutencao_auditoria_listar", `'${FORNO}', 200`);
  eq("cada item tem quem, ação, item e antes/depois", Object.keys(todos.itens[0]).sort().join(","), "acao,antes,depois,em,entidade,entidade_id,equipamento_id,id,item_nome,justificativa,usuario,usuario_nome");
  vale("a auditoria do Forno tem criar, editar, rotinas, execuções, custo, pendências e anulação",
     ["criar", "editar", "rotina_criar", "rotina_desativar", "execucao_registrar", "custo_informar", "pendencia_abrir", "pendencia_resolver", "pendencia_cancelar", "execucao_anular", "anexo_adicionar"].every((acao) => todos.itens.some((x) => x.acao === acao)),
     [...new Set(todos.itens.map((x) => x.acao))].join(","));

  // ============================================================
  console.log("\n=== 18. Manual do fabricante (anexo do equipamento) ===\n");
  // ============================================================
  const man = (cam, extra) => Object.assign({ equipamento_id: FORNO, categoria: "manual_fabricante", caminho: cam, nome_original: "Manual.pdf", mime: "application/pdf", bytes: 5000 }, extra || {});
  eq("arquivo que não subiu: recusado", rpc(U.gestor, "manutencao_anexo_equipamento", lit(man("v2/manual_fabricante/m1.pdf"))).campo, "anexos");
  eq("categoria errada: recusado", rpc(U.gestor, "manutencao_anexo_equipamento", lit(man("v2/manual_fabricante/m1.pdf", { categoria: "foto_antes" }))).campo, "categoria");
  objeto("v2/manual_fabricante/m1.pdf"); objeto("v2/manual_fabricante/m2.pdf"); objeto("v2/manual_fabricante/m3.html");
  eq("HTML disfarçado: recusado", rpc(U.gestor, "manutencao_anexo_equipamento", lit(man("v2/manual_fabricante/m3.html", { mime: "text/html" }))).campo, "anexos");
  const m1 = rpc(U.gestor, "manutencao_anexo_equipamento", lit(man("v2/manual_fabricante/m1.pdf", { nome_original: "Manual 2019.pdf" })));
  eq("gestor guarda o manual; painel aponta para ele", [m1.ok, rpc(U.oper, "manutencao_painel").equipamentos.find((e) => e.id === FORNO).manual_fabricante], [true, { nome: "Manual 2019.pdf", anexo_id: m1.anexo.id }]);
  const m2 = rpc(U.gestor, "manutencao_anexo_equipamento", lit(man("v2/manual_fabricante/m2.pdf", { nome_original: "Manual 2024.pdf" })));
  const anxDet = rpc(U.oper, "manutencao_equipamento_detalhe", `'${FORNO}'`).anexos_equipamento;
  eq("manual novo: o anterior fica guardado como inativo (versões)", [m2.ok, anxDet.map((a) => a.nome_original + ":" + a.ativo)], [true, ["Manual 2024.pdf:true", "Manual 2019.pdf:false"]]);
  eq("painel aponta para o mais novo", rpc(U.oper, "manutencao_painel").equipamentos.find((e) => e.id === FORNO).manual_fabricante.anexo_id, m2.anexo.id);
  eq("auditoria: anexo_adicionar e anexo_substituir", suV(`select string_agg(acao, ',' order by id) from manutencao_auditoria where entidade='anexo' and entidade_id='${m1.anexo.id}'`), "anexo_adicionar,anexo_substituir");
  eq("gestor liga arquivo enviado por outra pessoa (os PDFs acima foram enviados pelo operacional)", suV("select string_agg(distinct owner_id, ',') from storage.objects where name in ('v2/manual_fabricante/m1.pdf','v2/manual_fabricante/m2.pdf')"), U.oper);
  // dois gestores trocando o manual ao mesmo tempo: nunca ficam dois ativos
  objeto("v2/manual_fabricante/m4.pdf", U.gestor); objeto("v2/manual_fabricante/m5.pdf", U.gestorSo);
  const troca = aoMesmoTempo([
    { sql: sessaoLenta(U.gestor, `public.manutencao_anexo_equipamento(${lit(man("v2/manual_fabricante/m4.pdf", { nome_original: "Manual A.pdf" }))})`, 1.2), atraso: 0 },
    { sql: sessaoLenta(U.gestorSo, `public.manutencao_anexo_equipamento(${lit(man("v2/manual_fabricante/m5.pdf", { nome_original: "Manual B.pdf" }))})`, 0), atraso: 0.4 }]);
  eq("troca simultânea do manual: as duas gravam, e só o último fica ativo",
     [troca.map((x) => jsonDaSaida(x.saida).ok).join(","), suV(`select string_agg(nome_original, ',') from manutencao_anexos where dono_tipo='equipamento' and dono_id='${FORNO}' and categoria='manual_fabricante' and ativo`)],
     ["true,true", "Manual B.pdf"]);

  // ============================================================
  console.log("\n=== 19. Pessoas: Escala + logins, sem e-mail ===\n");
  // ============================================================
  r = su(`insert into public.escala (id, valor) values ('escala', ${lit({ ver: 3, lista: [
    { id: "r0", nome: "Luzia Lanny", cargo: "Caixa" }, { id: "r1", nome: "(vaga)", cargo: "Caixa" }, { id: "r2", nome: "  ", cargo: "Embalador" },
    { nome: "Sem Id Antigo", cargo: "Embalador" }, { id: "add1700000000_4", nome: "Ana Vitorino", cargo: "Caixa" }] })})`);
  if (!r.ok) throw new Error("escala: " + r.erro);
  const pes = rpc(U.oper, "manutencao_pessoas");
  eq("lista junta Escala (sem vaga/branco; id antigo = r<posição>) e logins aprovados, em ordem de nome",
     pes.pessoas.map((x) => x.ref.split(":")[0] + ":" + x.nome),
     ["escala:Ana Vitorino", "perfil:Cícero", "perfil:Fulano", "perfil:Gilson", "perfil:Josué", "perfil:Laryze", "escala:Luzia Lanny", "perfil:Márcia", "escala:Sem Id Antigo"]);
  eq("refs estáveis e detalhe (cargo / setor)", [pes.pessoas.find((x) => x.nome === "Sem Id Antigo").ref, pes.pessoas.find((x) => x.nome === "Ana Vitorino").ref,
     pes.pessoas.find((x) => x.nome === "Luzia Lanny").detalhe, pes.pessoas.find((x) => x.nome === "Cícero").detalhe, pes.pessoas.find((x) => x.nome === "Cícero").perfil_id],
     ["escala:r3", "escala:add1700000000_4", "Caixa", "Frios", U.oper2]);
  eq("não entram: conta bloqueada nem conta de fornecedor; ninguém traz e-mail",
     [pes.pessoas.some((x) => /Bloqueado|Fornecedor/.test(x.nome)), pes.pessoas.some((x) => "email" in x)], [false, false]);

  // ============================================================
  console.log("\n=== 20. Histórico paginado ===\n");
  // ============================================================
  s = rpc(U.gestor, "manutencao_equipamento_salvar", lit({ nome: "Fatiador Paginação", tipo: "Fatiador", setor: "Frios e Laticínios" }));
  const FAT = s.equipamento.id;
  for (let i = 0; i < 25; i++) registrar(U.oper, exec(FAT, "Limpeza", dia(-i), { justificativa_atraso: "Histórico de teste" }));
  const h1 = rpc(U.oper, "manutencao_historico", `'${FAT}'`);
  eq("página 1: 20 por padrão, mais nova primeiro, com cursor", [h1.itens.length, h1.itens[0].data_execucao, h1.itens[19].data_execucao, h1.proximo_cursor === h1.itens[19].id], [20, HOJE, dia(-19), true]);
  const h2 = rpc(U.oper, "manutencao_historico", `'${FAT}', 20, '${h1.proximo_cursor}'`);
  eq("página 2: as 5 restantes, sem cursor, sem repetir", [h2.itens.length, h2.itens[0].data_execucao, h2.itens[4].data_execucao, h2.proximo_cursor,
     h2.itens.some((x) => h1.itens.some((y) => y.id === x.id))], [5, dia(-20), dia(-24), null, false]);
  eq("cursor de outro equipamento: recusado", rpc(U.oper, "manutencao_historico", `'${FAT}', 20, '${e1.id}'`).campo, "p_antes_de");
  eq("equipamento inexistente", erroDe(rpc(U.oper, "manutencao_historico", "'naoexiste'")), "nao_encontrado");

  // ============================================================
  console.log("\n=== 21. Resumo (selo do menu e sino) ===\n");
  // ============================================================
  const rotCong = rpc(U.gestor, "manutencao_equipamento_detalhe", `'${CONG}'`).rotinas[0];
  eq("mudar periodicidade de rotina COM histórico sem justificativa: recusado",
     rpc(U.gestor, "manutencao_rotina_salvar", lit({ id: rotCong.id, versao: rotCong.versao, periodicidade_dias: 15 })).campo, "justificativa");
  s = rpc(U.gestor, "manutencao_rotina_salvar", lit({ id: rotCong.id, versao: rotCong.versao, periodicidade_dias: 15, justificativa: "Vigilância sanitária pediu quinzenal", responsavel: { ref: "perfil:" + U.oper2 } }));
  eq("com justificativa: ok; auditoria guarda antes/depois e o motivo",
     [s.ok, s.rotina.periodicidade_dias, s.rotina.responsavel_nome, suV(`select (antes->>'periodicidade_dias')||'>'||(depois->>'periodicidade_dias')||'|'||justificativa from manutencao_auditoria where entidade_id='${rotCong.id}' order by id desc limit 1`)],
     [true, 15, "Cícero", "30>15|Vigilância sanitária pediu quinzenal"]);
  const vCong = () => Number(suV(`select versao from manutencao_rotinas where id='${rotCong.id}'`));
  s = rpc(U.gestor, "manutencao_rotina_salvar", lit({ id: rotCong.id, versao: vCong(), tipo_servico: "Calibração", justificativa: "Trocando o serviço" }));
  eq("rotina com serviços: trocar o SERVIÇO é recusado (mesmo com justificativa) e nada muda",
     [s.campo, s.mensagem, suV(`select tipo_servico from manutencao_rotinas where id='${rotCong.id}'`)],
     ["tipo_servico", "Esta rotina já tem serviços registrados: o serviço não pode ser trocado. Para outro serviço, desative esta rotina e crie outra.", "Limpeza"]);
  eq("mesma rotina, mesmo serviço com outra grafia de maiúscula: aceito", rpc(U.gestor, "manutencao_rotina_salvar", lit({ id: rotCong.id, versao: vCong(), tipo_servico: "limpeza" })).ok, true);
  const rotB101 = rpc(U.gestor, "manutencao_equipamento_detalhe", "'emrame3xj340'").rotinas[0];
  s = rpc(U.gestor, "manutencao_rotina_salvar", lit({ id: rotB101.id, versao: rotB101.versao, tipo_servico: "Conferência / aferição" }));
  eq("rotina migrada 'a confirmar' (sem serviço) recebe o serviço pela 1ª vez", [s.ok, s.rotina.tipo_servico, s.rotina.periodicidade_dias], [true, "Conferência / aferição", 7]);
  // tela antiga muda o "a cada N dias" de uma rotina migrada que JÁ foi editada na tela nova: a migração não sobrescreve
  r = comoR(U.master, `update public.manutencao_equipamentos set intervalo=20 where id='${CONG}'`);
  m = suJ("select public.manutencao_migrar_legado()");
  c = suJ("select public.manutencao_conferir_migracao()");
  eq("rotina editada na tela nova não é sobrescrita pela migração; a conferência acusa a diferença",
     [m.rotinas_atualizadas, suV(`select periodicidade_dias from manutencao_rotinas where id='${rotCong.id}'`), c.ok, c.divergencias.map((d) => d.tipo + ":" + d.ids.join("|")).join(",")],
     [0, "15", false, "rotina_nao_migrada:" + CONG]);
  r = comoR(U.master, `update public.manutencao_equipamentos set intervalo=0 where id='${CONG}'`);
  eq("desfeito na tela antiga: a conferência volta a ok", suJ("select public.manutencao_conferir_migracao()").ok, true);
  m = suJ("select public.manutencao_migrar_legado()");
  eq("programação tirada na tela antiga numa rotina migrada que JÁ foi editada na tela nova: a migração não desativa (vale a decisão do gestor)",
     [m.rotinas_atualizadas, suV(`select ativa||'/'||periodicidade_dias from manutencao_rotinas where id='${rotCong.id}'`), suJ("select public.manutencao_conferir_migracao()").ok], [0, "true/15", true]);
  const pnlO = rpc(U.oper, "manutencao_painel");
  const res2 = rpc(U.oper2, "manutencao_resumo"), res1 = rpc(U.oper, "manutencao_resumo");
  eq("resumo bate com o painel (atrasado, hoje, próximo, pendências)",
     [res1.atrasado, res1.hoje_qtd, res1.proximo, res1.pendencias_abertas, res1.hoje], [pnlO.contagens.atrasado, pnlO.contagens.hoje, pnlO.contagens.proximo, pnlO.contagens.pendencias_abertas, HOJE]);
  eq("'minhas': Cícero tem a rotina atrasada da câmara e as pendências dele; Laryze não",
     [res2.minhas_rotinas_atrasadas, res2.minhas_pendencias, res1.minhas_rotinas_atrasadas, res1.minhas_pendencias],
     [1, Number(suV(`select count(*) from manutencao_pendencias where status='aberta' and responsavel_perfil_id='${U.oper2}'`)), 0, 0]);

  // ============================================================
  console.log("\n=== 22. Depósito de arquivos: nota fiscal só gestor abre ===\n");
  // ============================================================
  eq("limites do depósito", suV("select file_size_limit||'|'||array_to_string(allowed_mime_types, ',') from storage.buckets where id='manutencoes'"), "26214400|image/jpeg,image/png,image/webp,application/pdf");
  eq("travas do depósito: as 4 permissivas de produção + 5 restritivas (página, papel, trocar e apagar só gestor, nota só gestor)",
     suV("select string_agg(policyname||':'||cmd||':'||permissive, ',' order by policyname) from pg_policies where schemaname='storage' and policyname like 'man_%'"),
     "man_arquivos_apagar_so_gestor:DELETE:RESTRICTIVE,man_arquivos_por_pagina:ALL:RESTRICTIVE,man_arquivos_por_papel:ALL:RESTRICTIVE,man_arquivos_trocar_so_gestor:UPDATE:RESTRICTIVE,"
     + "man_fotos_apagar:DELETE:PERMISSIVE,man_fotos_subir:INSERT:PERMISSIVE,man_fotos_trocar:UPDATE:PERMISSIVE,man_fotos_ver:SELECT:PERMISSIVE,man_nota_fiscal_so_gestor:SELECT:RESTRICTIVE");
  const verObj = (uid, nome) => como(uid, `select count(*) from storage.objects where bucket_id='manutencoes' and name='${nome}'`);
  const apaga = (uid, nome) => como(uid, `with x as (delete from storage.objects where bucket_id='manutencoes' and name='${nome}' returning 1) select count(*) from x`);
  const troca2 = (uid, nome, novo) => como(uid, `with x as (update storage.objects set name='${novo}', metadata='{"v":"FALSA"}' where bucket_id='manutencoes' and name='${nome}' returning 1) select count(*) from x`);
  const anexoAntes = suV("select count(*) from manutencao_anexos where caminho='v2/foto_depois/aaa.jpg'");
  eq("OPERACIONAL não apaga nem troca a foto de evidência de um serviço registrado (nem a própria)",
     [apaga(U.oper, "v2/foto_depois/aaa.jpg"), troca2(U.oper, "v2/foto_depois/aaa.jpg", "v2/foto_depois/trocada.jpg"), apaga(U.oper2, "v2/foto_depois/aaa.jpg"),
      suV("select count(*)||'|'||coalesce(metadata->>'v','original') from storage.objects where name='v2/foto_depois/aaa.jpg' group by metadata"), anexoAntes],
     ["0", "0", "0", "1|original", "1"]);
  r = comoR(U.oper, "insert into storage.objects (bucket_id, name) values ('manutencoes', 'v2/foto_antes/oper-nova.jpg')");
  eq("…e continua ENVIANDO foto nova (a tela só envia, sem sobrescrever) e vendo as fotos", [r.ok, verObj(U.oper, "v2/foto_depois/aaa.jpg")], [true, "1"]);
  const insBloq = comoR(U.bloqueado, "insert into storage.objects (bucket_id, name) values ('manutencoes', 'v2/foto_antes/bloq.jpg')");
  eq("conta BLOQUEADA (aprovado=false, página marcada): não vê, não envia, não apaga, não troca",
     [verObj(U.bloqueado, "v2/foto_depois/aaa.jpg"), insBloq.ok, apaga(U.bloqueado, "v2/foto_antes/oper-nova.jpg"), troca2(U.bloqueado, "v2/foto_antes/oper-nova.jpg", "v2/foto_antes/sumiu.jpg")], ["0", false, "0", "0"]);
  eq("fornecedor com a página marcada: não envia", comoR(U.fornecedor, "insert into storage.objects (bucket_id, name) values ('manutencoes', 'v2/foto_antes/forn.jpg')").ok, false);
  eq("o outro lado: gestor TROCA, só-gestor e master APAGAM",
     [como(U.gestor, "with x as (update storage.objects set metadata='{\"conferido\":true}' where bucket_id='manutencoes' and name='v2/foto_antes/oper-nova.jpg' returning 1) select count(*) from x"),
      apaga(U.gestorSo, "v2/foto_antes/oper-nova.jpg"), apaga(U.master, "v2/foto_depois/do-gestor.jpg")], ["1", "1", "1"]);
  eq("operacional: vê a foto, NÃO abre a nota", [verObj(U.oper, "v2/foto_depois/aaa.jpg"), verObj(U.oper, "v2/nota_fiscal/nf1.pdf")], ["1", "0"]);
  eq("gestor, só-gestor e master abrem a nota", [verObj(U.gestor, "v2/nota_fiscal/nf1.pdf"), verObj(U.gestorSo, "v2/nota_fiscal/nf1.pdf"), verObj(U.master, "v2/nota_fiscal/nf1.pdf")], ["1", "1", "1"]);
  r = comoR(U.oper, "insert into storage.objects (bucket_id, name) values ('manutencoes', 'v2/nota_fiscal/nf-operador.pdf')");
  eq("operacional ENVIA nota (mas depois não abre)", [r.ok, verObj(U.oper, "v2/nota_fiscal/nf-operador.pdf"), verObj(U.gestor, "v2/nota_fiscal/nf-operador.pdf")], [true, "0", "1"]);
  r = comoR(U.gestorSo, "insert into storage.objects (bucket_id, name) values ('manutencoes', 'v2/foto_antes/gestor-so.jpg')");
  eq("quem tem SÓ a chave de gestor envia e vê fotos (trava por página aceita a chave nova)", [r.ok, verObj(U.gestorSo, "v2/foto_depois/aaa.jpg")], [true, "1"]);
  r = comoR(U.semPagina, "insert into storage.objects (bucket_id, name) values ('manutencoes', 'v2/foto_antes/invasor.jpg')");
  eq("sem página: não vê nem envia", [verObj(U.semPagina, "v2/foto_depois/aaa.jpg"), r.ok], ["0", false]);
  eq("fornecedor e bloqueado não abrem a nota", [verObj(U.fornecedor, "v2/nota_fiscal/nf1.pdf"), verObj(U.bloqueado, "v2/nota_fiscal/nf1.pdf")], ["0", "0"]);
  su("insert into storage.objects (bucket_id, name) values ('pontos', 'v2/nota_fiscal/comprovante.pdf')");
  eq("outro depósito com o mesmo nome de pasta não é afetado (e lá o operacional continua apagando, como antes)",
     [como(U.oper, "select count(*) from storage.objects where bucket_id='pontos'"), como(U.bloqueado, "select count(*) from storage.objects where bucket_id='pontos'")], ["1", "1"]);
  eq("nota do módulo ANTIGO (caminho antigo, migrada): operacional não abre; gestor abre",
     [verObj(U.oper, "nota_rmvelho001.pdf"), verObj(U.gestor, "nota_rmvelho001.pdf"), verObj(U.master, "nota_rmvelho001.pdf")], ["0", "1", "1"]);
  r = comoR(U.master, `insert into public.manutencao_registros (id,id_eq,data,tipo,responsavel,custo,execucao,nota_arquivo) values ('rmnota0001','emvelha001','${HOJE}','Troca de peça','TecFrio',80,'externa','nota_rmnota0001.pdf')`);
  objeto("nota_rmnota0001.pdf", U.master);
  eq("nota gravada pela tela antiga e AINDA não migrada: operacional também não abre",
     [r.ok, verObj(U.oper, "nota_rmnota0001.pdf"), verObj(U.gestorSo, "nota_rmnota0001.pdf")], [true, "0", "1"]);

  // ============================================================
  console.log("\n=== 23. Corte (fase B) — só no dia de publicar; aqui só se prova ===\n");
  // ============================================================
  eq("antes do corte: quem tem só a chave de gestor não lê a tabela antiga direto (regra por página)", como(U.gestorSo, "select count(*) from manutencao_equipamentos"), "0");
  r = comoR(U.master, `insert into public.manutencao_registros (id,id_eq,data,tipo,responsavel,custo,execucao) values ('rmultimo01','emvelha001','${HOJE}','Limpeza','Nilton',0,'interna')`);
  vale("último serviço gravado pela tela antiga antes do corte", r.ok, r.ok ? "ok" : r.erro);
  // correção feita na tela antiga num serviço JÁ migrado: a execução (imutável) ficou com a versão anterior
  const regOrig = REGS.find((g) => g.id === "rmram70v6618");
  r = comoR(U.master, `update public.manutencao_registros set tipo='Manutenção', responsavel='Nilton', obs='Borracha da porta trocada' where id='rmram70v6618'`);
  c = suJ("select public.manutencao_conferir_migracao()");
  eq("conferência acusa serviço antigo alterado depois da migração",
     [r.ok, c.ok, c.divergencias.map((d) => d.tipo + ":" + d.ids.join("|")).join(",")], [true, false, "registro_sem_execucao:rmnota0001|rmultimo01,registro_alterado_depois_da_migracao:rmram70v6618"]);
  const corteBarrado = B.rodarArquivo(pg, path.join(RAIZ, "sql", "manutencao_v2_9_corte.sql"));
  eq("o corte PARA com a divergência e NADA muda (tela antiga continua gravando; nada migrado)",
     [corteBarrado.ok, /CORTE CANCELADO/.test(corteBarrado.erro), /registro_alterado_depois_da_migracao/.test(corteBarrado.erro),
      suV("select count(*) from pg_policies where tablename='manutencao_registros' and policyname in ('pg_ins','pg_upd','pg_del','pg_sel')"), suV("select count(*) from manutencao_execucoes where id='rmultimo01'")],
     [false, true, true, "4", "0"]);
  r = comoR(U.master, `update public.manutencao_registros set tipo=${regOrig.tipo == null ? "null" : "$t$" + regOrig.tipo + "$t$"}, responsavel=${regOrig.responsavel == null ? "null" : "$t$" + regOrig.responsavel + "$t$"}, obs=${regOrig.obs == null ? "null" : "$t$" + regOrig.obs + "$t$"} where id='rmram70v6618'`);
  vale("o dono decide e desfaz a correção na tela antiga", r.ok, r.ok ? "ok" : r.erro);

  // CORTE-01: a saída indicada no texto (anular a execução migrada na tela nova e registrar de novo) destrava o corte
  const SAIDA = /anule a execução migrada na tela nova e registre de novo/;
  const divDe = (cc, id) => (cc.divergencias || []).filter((d) => d.ids.indexOf(id) >= 0);
  r = comoR(U.master, `update public.manutencao_registros set obs='Limpeza refeita no dia seguinte', criado_em=criado_em + interval '1 hour' where id='rmraqhab8457'`);
  c = suJ("select public.manutencao_conferir_migracao()");
  eq("corrigir na tela antiga o outro serviço migrado (texto e hora): 2 divergências, e o texto de cada uma já diz a saída",
     [r.ok, divDe(c, "rmraqhab8457").map((d) => d.tipo).sort().join(","), divDe(c, "rmraqhab8457").every((d) => SAIDA.test(d.detalhe))],
     [true, "autor_data_diferentes,registro_alterado_depois_da_migracao", true]);
  const corteSemAnular = B.rodarArquivo(pg, path.join(RAIZ, "sql", "manutencao_v2_9_corte.sql"));
  eq("sem anular, o corte continua parando, e a mensagem do corte indica a saída",
     [corteSemAnular.ok, /CORTE CANCELADO/.test(corteSemAnular.erro), SAIDA.test(corteSemAnular.erro)], [false, true, true]);
  s = rpc(U.gestor, "manutencao_execucao_anular", "'rmraqhab8457', 'Serviço corrigido na tela antiga depois de migrado'");
  const deNovo = registrar(U.gestor, exec("emraqg6gz805", "Limpeza", "2026-07-07", { observacao: "Limpeza refeita no dia seguinte", resultado: "observacao", justificativa_atraso: "Registrado de novo depois da correção na tela antiga" }));
  c = suJ("select public.manutencao_conferir_migracao()");
  eq("o gestor ANULA a execução migrada e registra de novo na tela nova: as divergências dela somem",
     [s.ok, deNovo.ok, divDe(c, "rmraqhab8457").length], [true, true, 0]);
  r = comoR(U.master, `insert into public.manutencao_registros (id,id_eq,data,tipo,responsavel,custo,execucao) values ('rmapagado1','emvelha001','${HOJE}','Limpeza','Nilton',0,'interna')`);
  m = suJ("select public.manutencao_migrar_legado()");
  // serviço migrado apagado ANTES de a trava existir (simulado desligando o gatilho, como dono do banco)
  const apagouSemTrava = su("alter table manutencao_registros disable trigger trg_manutencao_registros_migrado; delete from manutencao_registros where id='rmapagado1'; alter table manutencao_registros enable trigger trg_manutencao_registros_migrado");
  c = suJ("select public.manutencao_conferir_migracao()");
  eq("serviço migrado apagado na tela antiga: a conferência acusa e o texto diz a saída",
     [r.ok, apagouSemTrava.ok, divDe(c, "rmapagado1").map((d) => d.tipo).join(","), SAIDA.test((divDe(c, "rmapagado1")[0] || {}).detalhe || "")], [true, true, "registro_antigo_apagado", true]);
  s = rpc(U.gestor, "manutencao_execucao_anular", "'rmapagado1', 'Serviço apagado na tela antiga'");
  c = suJ("select public.manutencao_conferir_migracao()");
  eq("…anular libera: a conferência fecha sem divergências", [s.ok, c.ok, c.divergencias], [true, true, []]);
  // CORTE-01-CUSTO: a correção na tela antiga trocou para empresa externa com custo. Anular e registrar de novo também libera.
  r = comoR(U.master, `update public.manutencao_registros set execucao='externa', custo=150 where id='rmram70v6618'`);
  c = suJ("select public.manutencao_conferir_migracao()");
  eq("corrigir na tela antiga para 'empresa externa' com custo 150: acusa registro alterado e custo diferente, e as duas dizem a saída",
     [r.ok, divDe(c, "rmram70v6618").map((d) => d.tipo).sort().join(","), divDe(c, "rmram70v6618").every((d) => SAIDA.test(d.detalhe))],
     [true, "custo_diferente,registro_alterado_depois_da_migracao", true]);
  s = rpc(U.gestor, "manutencao_execucao_anular", "'rmram70v6618', 'Serviço corrigido na tela antiga: foi empresa externa'");
  const deNovoExt = registrar(U.gestor, exec(regOrig.id_eq, regOrig.tipo, regOrig.data, { executor: { tipo: "externo", nome: "Técnico", empresa_nome: "TecFrio" }, custo: 150,
    justificativa_atraso: "Registrado de novo depois da correção na tela antiga" }));
  c = suJ("select public.manutencao_conferir_migracao()");
  eq("…o gestor anula e registra de novo como externa com 150: nenhuma divergência sobra e a conferência fecha",
     [s.ok, deNovoExt.ok, divDe(c, "rmram70v6618").map((d) => d.tipo), c.ok], [true, true, [], true]);
  const corte = B.rodarArquivo(pg, path.join(RAIZ, "sql", "manutencao_v2_9_corte.sql"));
  vale("manutencao_v2_9_corte.sql roda", corte.ok, corte.ok ? "ok" : corte.erro.split("\n").slice(0, 4).join(" | "));
  const corte2 = B.rodarArquivo(pg, path.join(RAIZ, "sql", "manutencao_v2_9_corte.sql"));
  vale("rodar o corte de novo não quebra", corte2.ok, corte2.ok ? "ok" : corte2.erro.split("\n")[0]);
  c = suJ("select public.manutencao_conferir_migracao()");
  eq("o corte migrou o último serviço antigo e a conferência fecha", [c.ok, suV("select count(*) from manutencao_execucoes where id='rmultimo01'")], [true, "1"]);
  eq("o gatilho que protege serviço migrado ficou ligado durante as migrações e o corte, e não atrapalhou nenhum dos dois",
     suV("select count(*) from pg_trigger where tgname='trg_manutencao_registros_migrado' and tgenabled <> 'D'"), "1");
  r = comoR(U.master, `insert into public.manutencao_registros (id,id_eq,data,tipo) values ('rmdepois01','emvelha001','${HOJE}','Limpeza')`);
  const upd = comoR(U.master, "update public.manutencao_equipamentos set nome='hack' where id='emvelha001'");
  const del = comoR(U.oper, "delete from public.manutencao_registros");
  vale("depois do corte: tela antiga não grava serviço, não edita equipamento, não apaga (nem o master)", !r.ok && !upd.ok && !del.ok, [r, upd, del].map((x) => (x.ok ? "PASSOU" : "recusado")).join("/"));
  eq("nada foi apagado das tabelas antigas", suV("select (select count(*) from manutencao_registros)||'/'||(select count(*) from manutencao_equipamentos where id='emvelha001')"), "5/1");
  eq("leitura dos equipamentos agora é pelo papel: só-gestor lê; sem página e fornecedor não",
     [Number(como(U.gestorSo, "select count(*) from manutencao_equipamentos")) > 0, como(U.semPagina, "select count(*) from manutencao_equipamentos"), como(U.fornecedor, "select count(*) from manutencao_equipamentos")], [true, "0", "0"]);
  eq("tabela antiga (tem custo e nota): depois do corte, operacional e conta bloqueada NÃO leem; gestor, só-gestor e master leem",
     [como(U.oper, "select count(*) from manutencao_registros"), como(U.bloqueado, "select count(*) from manutencao_registros"), como(U.fornecedor, "select count(*) from manutencao_registros"),
      como(U.gestor, "select count(*) from manutencao_registros"), como(U.gestorSo, "select count(*) from manutencao_registros"), como(U.master, "select count(*) from manutencao_registros")],
     ["0", "0", "0", "5", "5", "5"]);
  s = registrar(U.oper, exec(FORNO, "Lubrificação", HOJE));
  const s2 = rpc(U.gestor, "manutencao_equipamento_salvar", lit({ nome: "Cadastrado Depois do Corte", tipo: "Teste", setor: "Teste" }));
  eq("depois do corte a tela nova continua gravando pelas funções", [s.ok, s2.ok], [true, true]);
} catch (e) {
  console.log("ERRO:", e.stack || e.message); falhou++;
} finally {
  B.derrubar(pg);
}
console.log(`\n${ok} OK, ${falhou} falha(s)\n`);
process.exit(falhou ? 1 : 0);
