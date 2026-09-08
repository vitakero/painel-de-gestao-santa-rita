// ROTINA — UMA EXECUÇÃO POR ITEM POR DIA.
//
// A bancada de produção (scripts/conferir-rotina.mjs) pegou o defeito: depois de CONCLUIR um
// item, marcar de novo no mesmo dia criava uma segunda execução. Numa loja onde o celular passa
// de mão em mão, o segundo toque roubava o crédito — a lista passava a mostrar quem marcou por
// último, não quem fez.
//
// Este teste sobe um PostgreSQL de verdade, compila sql/rotina_uma_por_dia.sql nele e exercita
// a função. SQL que nunca foi compilado não é SQL testado: sintaxe passa, o miolo em plpgsql —
// que é o que roda — só um Postgres compila.
//
//   node scripts/testes/rotina-uma-por-dia.test.cjs
const fs = require("fs");
const path = require("path");
const B = require("./apoio/banco-de-teste.cjs");

const RAIZ = path.join(__dirname, "..", "..");
let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  [" + obtido + "]" + (bate ? "" : "   (esperado: [" + esperado + "])"));
  bate ? ok++ : falhou++;
}

if (!B.temPostgres()) {
  console.log("\nPULADO: não achei o PostgreSQL da bancada (/opt/homebrew/opt/postgresql@16).");
  console.log("Instale com: brew install postgresql@16\n");
  process.exit(0);
}

const A_ID = "aaaaaaaa-0000-0000-0000-000000000001";   // quem realmente fez
const B_ID = "bbbbbbbb-0000-0000-0000-000000000002";   // quem chegou depois na tela velha
const C_ID = "cccccccc-0000-0000-0000-000000000003";   // quem não tem a página

// As duas tabelas, copiadas do central_op_sprint2_6.sql, e o nome_de() que o evento usa.
const ESQUEMA = `
create table if not exists public.rotinas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant(),
  titulo text not null, descricao text, setor text,
  ordem int not null default 0, ativo boolean not null default true,
  criado_por uuid, request_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now());
create table if not exists public.rotinas_execucoes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant(),
  rotina_id uuid not null references public.rotinas(id),
  usuario_id uuid, status text not null default 'em_andamento',
  observacao text, executado_em timestamptz, request_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now());
create unique index if not exists ux_rexec_request on public.rotinas_execucoes(tenant_id, request_id) where request_id is not null;
create or replace function public.nome_de(p uuid) returns text
language sql stable as $$ select nome from public.perfis where id = p $$;
-- o Supabase tem esta trava; o dublê não tinha, e sem ela o "on conflict" do evento
-- estourava — fazendo a conclusão falhar CALADA e o teste passar por engano.
create unique index if not exists ux_eventos_uuid on public.eventos(tenant_id, event_uuid);
`;

const pg = B.subir();
try {
  const d = B.rodarArquivo(pg, path.join(RAIZ, "scripts", "testes", "apoio", "dubles-supabase.sql"));
  if (!d.ok) throw new Error("dublês não subiram:\n" + d.erro);
  let r = B.rodar(pg, ESQUEMA);
  if (!r.ok) throw new Error("esquema não subiu:\n" + r.erro);

  // ---------------------------------------------------------------------
  console.log("\n== O arquivo compila ==");
  // ---------------------------------------------------------------------
  const f = B.rodarArquivo(pg, path.join(RAIZ, "sql", "rotina_uma_por_dia.sql"));
  eq("sql/rotina_uma_por_dia.sql roda inteiro num Postgres de verdade", f.ok, true);
  if (!f.ok) console.log("    " + f.erro.split("\n").slice(0, 6).join("\n    "));

  B.rodar(pg, `insert into public.perfis(id,nome,setor,paginas) values
      ('${A_ID}','Ze do Acougue','Açougue','["operacional"]'::jsonb),
      ('${B_ID}','Maria da Tarde','Açougue','["operacional"]'::jsonb),
      ('${C_ID}','Fulano de Fora','Entregas','["entregas"]'::jsonb);
    insert into public.rotinas(id,titulo,setor,ordem) values
      ('11111111-2222-3333-4444-555555555555','Temperatura do balcao','Açougue',1);`);

  /* UM COMANDO QUE FALHA NÃO PODE PASSAR BATIDO. A primeira versão desta bancada engoliu
     um erro da conclusão e deu 13 OK com o miolo nunca tendo rodado. */
  const como = (uid, sql) => {
    const r = B.rodar(pg, `select set_config('teste.uid','${uid}',false); ${sql}`);
    if (!r.ok) throw new Error("comando falhou:\n" + sql + "\n" + r.erro.split("\n").slice(0, 4).join("\n"));
    return r;
  };
  const conta = () => B.rodar(pg, `select count(*) from public.rotinas_execucoes where status in ('em_andamento','concluido')`).saida.split("\n").pop();
  const ROT = "'11111111-2222-3333-4444-555555555555'::uuid";
  const req = () => `gen_random_uuid()`;

  // ---------------------------------------------------------------------
  console.log("\n== O açougueiro marca de manhã ==");
  // ---------------------------------------------------------------------
  const abrir = como(A_ID, `select public.registrar_execucao(${req()}, ${ROT}, 'em_andamento')`);
  const execA = abrir.saida.split("\n").pop().trim();
  eq("abriu a execução do dia", /^[0-9a-f-]{36}$/.test(execA), true);
  como(A_ID, `select public.registrar_execucao(${req()}, ${ROT}, 'concluido', '${execA}'::uuid, '2 graus')`);
  eq("uma execução depois de concluir", conta(), "1");
  const horaA = B.rodar(pg, `select executado_em from public.rotinas_execucoes where id='${execA}'`).saida.split("\n").pop();
  eq("  e a hora da conclusão ficou gravada", horaA.length > 10, true);

  // ---------------------------------------------------------------------
  console.log("\n== O DEFEITO: outra pessoa, tela velha, marca de novo à tarde ==");
  // ---------------------------------------------------------------------
  const deNovo = como(B_ID, `select public.registrar_execucao(${req()}, ${ROT}, 'em_andamento')`);
  const execB = deNovo.saida.split("\n").pop().trim();
  eq("devolveu a MESMA execução, não criou outra", execB, execA);
  eq("continua UMA execução no dia", conta(), "1");

  como(B_ID, `select public.registrar_execucao(${req()}, ${ROT}, 'concluido', '${execB}'::uuid, '9 graus')`);
  eq("ainda UMA execução depois da segunda conclusão", conta(), "1");
  eq("o crédito ficou com quem FEZ, não com quem marcou depois",
     B.rodar(pg, `select nome from public.perfis p join public.rotinas_execucoes e on e.usuario_id=p.id where e.id='${execA}'`).saida.split("\n").pop(),
     "Ze do Acougue");
  eq("a hora não foi reescrita",
     B.rodar(pg, `select executado_em from public.rotinas_execucoes where id='${execA}'`).saida.split("\n").pop(), horaA);
  eq("o evento 'rotina.concluida' saiu UMA vez só",
     B.rodar(pg, `select count(*) from public.eventos where tipo='rotina.concluida'`).saida.split("\n").pop(), "1");

  // ---------------------------------------------------------------------
  console.log("\n== O que NÃO pode ser barrado ==");
  // ---------------------------------------------------------------------
  /* Cancelado é item NÃO feito. Se um cancelamento trancasse o dia, o açougueiro que
     cancelou por engano ficaria sem poder refazer até amanhã. */
  B.rodar(pg, `update public.rotinas_execucoes set status='cancelado' where id='${execA}'`);
  const depoisCancel = como(A_ID, `select public.registrar_execucao(${req()}, ${ROT}, 'em_andamento')`);
  eq("depois de CANCELAR, dá pra refazer no mesmo dia",
     depoisCancel.saida.split("\n").pop().trim() !== execA, true);
  eq("  e a de ontem não atrapalha", conta(), "1");

  // ---------------------------------------------------------------------
  console.log("\n== A tranca continua trancada ==");
  // ---------------------------------------------------------------------
  const fora = B.rodarEsperandoErro(pg,
    `select set_config('teste.uid','${C_ID}',false); select public.registrar_execucao(gen_random_uuid(), ${ROT}, 'em_andamento')`);
  eq("quem não tem a página 'operacional' esbarra", /sem acesso/.test(fora || ""), true);

  const semLogin = B.rodarEsperandoErro(pg,
    `select set_config('teste.uid','',false); select public.registrar_execucao(gen_random_uuid(), ${ROT}, 'em_andamento')`);
  eq("sem login nenhum também esbarra", /sem acesso/.test(semLogin || ""), true);

  // ---------------------------------------------------------------------
  console.log("\n== A conferência do próprio arquivo ==");
  // ---------------------------------------------------------------------
  eq("nenhum item com duas execuções vivas no mesmo dia",
     B.rodar(pg, `select coalesce((select count(*) from (
        select rotina_id, (coalesce(executado_em, created_at) at time zone 'America/Fortaleza')::date d, count(*) c
          from public.rotinas_execucoes where status in ('em_andamento','concluido')
         group by 1,2 having count(*) > 1) x), 0)`).saida.split("\n").pop(), "0");

} catch (e) {
  falhou++;
  console.log("\n  ERRO: " + (e && e.message ? e.message : e));
} finally {
  B.derrubar(pg);
}

console.log("\n" + ok + " OK, " + falhou + " falha(s)\n");
process.exit(falhou ? 1 : 0);
