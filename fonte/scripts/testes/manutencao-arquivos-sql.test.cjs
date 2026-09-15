// Prova, num Postgres TEMPORÁRIO (não encosta no Supabase), a trava do depósito de arquivos
// da Manutenção: sql/manutencao_arquivos_por_pagina.sql.
// Prova os DOIS lados: fecha pra quem não tem a página E continua aberto pra quem tem —
// e não mexe nos outros depósitos (pontos, receitas...), que ficam como estavam.
//   node scripts/testes/manutencao-arquivos-sql.test.cjs
const path = require("path");
const B = require("./apoio/banco-de-teste.cjs");
const RAIZ = path.join(__dirname, "..", "..");

if (!B.temPostgres()) { console.log("PULADO: sem Postgres local (brew install postgresql@16)."); process.exit(0); }

let ok = 0, falhou = 0;
const vale = (n, c, d) => { console.log((c ? "  OK   " : "  FALHA") + " | " + n + "  ->  " + d); c ? ok++ : falhou++; };

const COM = "aaaaaaaa-0000-0000-0000-000000000001";   // tem a página Manutenções
const SEM = "aaaaaaaa-0000-0000-0000-000000000002";   // só Agenda (ou conta de fornecedor)
const MASTER = "aaaaaaaa-0000-0000-0000-000000000003";

// roda como um login de gente (papel authenticated + auth.uid), dentro de uma transação
function como(pg, uid, sql) {
  return B.rodar(pg, `begin; set local role authenticated; select set_config('teste.uid','${uid}',true); ${sql}; commit;`);
}
const n = r => (r.ok ? r.saida.split("\n").pop() : "ERRO: " + r.erro.split("\n")[0]);

const pg = B.subir();
try {
  const d = B.rodarArquivo(pg, path.join(RAIZ, "scripts", "testes", "apoio", "dubles-supabase.sql"));
  if (!d.ok) throw new Error("dublês não subiram:\n" + d.erro);

  // o depósito como está hoje no Supabase: regra ABERTA pra qualquer login
  // (foi o que a sondagem de 14/09 mostrou: listar, abrir e gravar em manutencoes/pontos/receitas)
  const base = B.rodar(pg, `
    create schema if not exists storage;
    create table storage.objects (id uuid default gen_random_uuid() primary key, bucket_id text, name text, owner uuid);
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated;
    grant select, insert, update, delete on storage.objects to authenticated;
    create policy aberto_sel on storage.objects for select to authenticated using (bucket_id in ('manutencoes','pontos','receitas'));
    create policy aberto_ins on storage.objects for insert to authenticated with check (bucket_id in ('manutencoes','pontos','receitas'));
    create policy aberto_upd on storage.objects for update to authenticated using (bucket_id in ('manutencoes','pontos','receitas'));
    create policy aberto_del on storage.objects for delete to authenticated using (bucket_id in ('manutencoes','pontos','receitas'));
    insert into public.perfis (id,nome,paginas,is_master) values
      ('${COM}','Com página','["manutencoes","agenda"]',false),
      ('${SEM}','Sem página','["agenda"]',false),
      ('${MASTER}','Master','[]',true);
    insert into storage.objects (bucket_id,name) values
      ('manutencoes','r1_a.jpg'),('manutencoes','nota_r1.pdf'),('pontos','comp.pdf'),('receitas','rec.jpg');
  `);
  if (!base.ok) throw new Error("base não subiu: " + base.erro);

  console.log("\n=== Antes da trava (o problema) ===\n");
  vale("quem NÃO tem a página vê os arquivos da Manutenção", n(como(pg, SEM, "select count(*) from storage.objects where bucket_id='manutencoes'")) === "2", n(como(pg, SEM, "select count(*) from storage.objects where bucket_id='manutencoes'")));

  const f = B.rodarArquivo(pg, path.join(RAIZ, "sql", "manutencao_arquivos_por_pagina.sql"));
  vale("o SQL roda sem erro", f.ok, f.ok ? "ok" : f.erro);
  const f2 = B.rodarArquivo(pg, path.join(RAIZ, "sql", "manutencao_arquivos_por_pagina.sql"));
  vale("rodar de novo não quebra", f2.ok, f2.ok ? "ok" : f2.erro);

  console.log("\n=== Quem NÃO tem a página ===\n");
  vale("não lista / não abre", n(como(pg, SEM, "select count(*) from storage.objects where bucket_id='manutencoes'")) === "0", n(como(pg, SEM, "select count(*) from storage.objects where bucket_id='manutencoes'")));
  const insSem = como(pg, SEM, "insert into storage.objects (bucket_id,name) values ('manutencoes','invasor.jpg')");
  vale("não grava", !insSem.ok && /row-level security/.test(insSem.erro), insSem.ok ? "gravou!" : "recusado");
  vale("não apaga", n(como(pg, SEM, "with x as (delete from storage.objects where bucket_id='manutencoes' returning 1) select count(*) from x")) === "0", "0 apagado(s)");
  vale("não troca arquivo", n(como(pg, SEM, "with x as (update storage.objects set name='troca.jpg' where bucket_id='manutencoes' returning 1) select count(*) from x")) === "0", "0 trocado(s)");
  const mover = como(pg, SEM, "update storage.objects set bucket_id='manutencoes' where name='comp.pdf'");
  vale("não joga arquivo de outro depósito pra dentro da Manutenção", !mover.ok && /row-level security/.test(mover.erro), mover.ok ? "moveu!" : "recusado");

  console.log("\n=== Quem TEM a página (o outro lado) — regra de HOJE, antes do manutencao_v2_4_storage.sql ===\n");
  vale("lista / abre as fotos e notas", n(como(pg, COM, "select count(*) from storage.objects where bucket_id='manutencoes'")) === "2", n(como(pg, COM, "select count(*) from storage.objects where bucket_id='manutencoes'")));
  const insCom = como(pg, COM, "insert into storage.objects (bucket_id,name) values ('manutencoes','r2_a.jpg')");
  vale("grava foto nova", insCom.ok, insCom.ok ? "gravou" : insCom.erro);
  // o FURO que a trava por página sozinha deixa (2.9 item 2 da especificação): qualquer um com a página
  // troca e apaga arquivo. Fica provado aqui e FECHADO na seção de baixo, pelo arquivo v2_4.
  vale("FURO de hoje: quem tem só a página troca a foto", n(como(pg, COM, "with x as (update storage.objects set owner=null where bucket_id='manutencoes' and name='r2_a.jpg' returning 1) select count(*) from x")) === "1", "1 trocada");
  vale("FURO de hoje: quem tem só a página apaga a foto", n(como(pg, COM, "with x as (delete from storage.objects where bucket_id='manutencoes' and name='r2_a.jpg' returning 1) select count(*) from x")) === "1", "1 apagada");
  vale("master vê tudo", n(como(pg, MASTER, "select count(*) from storage.objects where bucket_id='manutencoes'")) === "2", n(como(pg, MASTER, "select count(*) from storage.objects where bucket_id='manutencoes'")));

  console.log("\n=== Os outros depósitos continuam como estavam ===\n");
  vale("pontos: regra antiga intacta", n(como(pg, SEM, "select count(*) from storage.objects where bucket_id='pontos'")) === "1", n(como(pg, SEM, "select count(*) from storage.objects where bucket_id='pontos'")));
  vale("receitas: regra antiga intacta", n(como(pg, SEM, "select count(*) from storage.objects where bucket_id='receitas'")) === "1", n(como(pg, SEM, "select count(*) from storage.objects where bucket_id='receitas'")));
  vale("as 4 regras antigas continuam lá", B.rodar(pg, "select count(*) from pg_policies where schemaname='storage' and policyname like 'aberto_%'").saida === "4", B.rodar(pg, "select count(*) from pg_policies where schemaname='storage' and policyname like 'aberto_%'").saida);

  console.log("\n=== Depois do sql/manutencao_v2_4_storage.sql (fase A): trocar e apagar só gestor/master; tudo só com papel ===\n");
  const GESTOR = "aaaaaaaa-0000-0000-0000-000000000004";  // só a chave manutencoes_gestor
  const BLOQ = "aaaaaaaa-0000-0000-0000-000000000005";    // página marcada, mas conta bloqueada (aprovado=false)
  const prep = B.rodar(pg, `insert into public.perfis (id,nome,paginas,is_master,aprovado) values ('${GESTOR}','Gestor','["manutencoes_gestor"]',false,true),('${BLOQ}','Bloqueado','["manutencoes"]',false,false);
    insert into storage.objects (bucket_id,name) values ('manutencoes','r3_depois.jpg'),('manutencoes','r4_depois.jpg')`);
  if (!prep.ok) throw new Error("perfis/objetos: " + prep.erro);
  for (const f of ["scripts/testes/apoio/dubles-manutencao.sql", "sql/manutencao_v2_1_estrutura.sql", "sql/manutencao_v2_2_funcoes.sql", "sql/manutencao_v2_3_migracao.sql", "sql/manutencao_v2_4_storage.sql"]) {
    const a = B.rodarArquivo(pg, path.join(RAIZ, f));
    if (!a.ok) throw new Error(f + ": " + a.erro.split("\n").slice(0, 3).join(" | "));
  }
  const conta = (uid, sql) => n(como(pg, uid, `with x as (${sql} returning 1) select count(*) from x`));
  vale("quem tem só a página (operacional) NÃO troca mais", conta(COM, "update storage.objects set owner=null where bucket_id='manutencoes' and name='r3_depois.jpg'") === "0", "0 trocada");
  vale("…e NÃO apaga mais", conta(COM, "delete from storage.objects where bucket_id='manutencoes' and name='r3_depois.jpg'") === "0", "0 apagada");
  const insOp = como(pg, COM, "insert into storage.objects (bucket_id,name) values ('manutencoes','v2/foto_antes/nova.jpg')");
  vale("…mas continua enviando foto nova e vendo as fotos", insOp.ok && n(como(pg, COM, "select count(*) from storage.objects where bucket_id='manutencoes' and name='r3_depois.jpg'")) === "1", insOp.ok ? "enviou e vê" : insOp.erro);
  const insBloq = como(pg, BLOQ, "insert into storage.objects (bucket_id,name) values ('manutencoes','v2/foto_antes/bloq.jpg')");
  vale("conta bloqueada com a página: não vê, não envia, não apaga",
    n(como(pg, BLOQ, "select count(*) from storage.objects where bucket_id='manutencoes'")) === "0" && !insBloq.ok && conta(BLOQ, "delete from storage.objects where bucket_id='manutencoes'") === "0", insBloq.ok ? "enviou!" : "recusado");
  vale("o outro lado: gestor TROCA", conta(GESTOR, "update storage.objects set owner=null where bucket_id='manutencoes' and name='r3_depois.jpg'") === "1", "1 trocada");
  vale("o outro lado: master APAGA", conta(MASTER, "delete from storage.objects where bucket_id='manutencoes' and name='r4_depois.jpg'") === "1", "1 apagada");
  vale("sem página continua sem ver nada", n(como(pg, SEM, "select count(*) from storage.objects where bucket_id='manutencoes'")) === "0", "0");
  vale("os outros depósitos continuam como estavam (pontos e receitas)", n(como(pg, SEM, "select count(*) from storage.objects where bucket_id in ('pontos','receitas')")) === "2" && conta(COM, "update storage.objects set owner=null where bucket_id='receitas'") === "1", "ok");
} catch (e) {
  console.log("ERRO:", e.message); falhou++;
} finally {
  B.derrubar(pg);
}
console.log(`\n${ok} OK, ${falhou} falha(s)\n`);
process.exit(falhou ? 1 : 0);
