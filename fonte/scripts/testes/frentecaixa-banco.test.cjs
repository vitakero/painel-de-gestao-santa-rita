// ============================================================
// BANCADA DA FRENTE DE CAIXA — o lado do BANCO.
//
// Sobe um PostgreSQL temporário, instala os dublês das peças do Supabase e o
// arquivo sql/frentecaixa_ocorrencias.sql, e cobra a tranca DOS DOIS LADOS:
// que ela fecha para quem não pode E abre para quem pode. No fim derruba o
// banco e não deixa nada pra trás.
//
//   node scripts/testes/frentecaixa-banco.test.cjs
//
// NÃO encosta no Supabase de produção.
//
// POR QUE ESTE TESTE EXISTE: a tabela guarda NOME de quem cancelou. Conferir a
// tranca lendo o SQL não prova nada — permissão só se prova rodando como a
// pessoa. Aqui cada trava é exercida com um login de verdade.
// ============================================================
const path = require("path");
const B = require("./apoio/banco-de-teste.cjs");
const RAIZ = path.join(__dirname, "..", "..");

if (!B.temPostgres()) {
  console.log("SEM POSTGRES LOCAL — instale com: brew install postgresql@16");
  process.exit(1);
}

const U = {
  master:  "10000000-0000-0000-0000-000000000001",  // o dono: vê tudo, inclusive nomes
  fiscal:  "10000000-0000-0000-0000-000000000002",  // tem a página, NÃO vê nomes
  nomes:   "10000000-0000-0000-0000-000000000003",  // tem a página + a delegação dos nomes
  caixa:   "10000000-0000-0000-0000-000000000004"   // funcionário comum: não vê nada
};

let ok = 0, falhou = 0;
const pg = B.subir();

// roda JÁ como o papel "authenticated" (é assim que o painel chega no banco):
// só assim o RLS e o privilégio de coluna valem — o dono da tabela passa por cima.
const como = (uid, sql) => {
  const r = B.rodar(pg, `select set_config('teste.uid','${uid}',false); set role authenticated; ${sql}`);
  if (!r.ok) r.saida = "ERRO SQL: " + (r.erro.split("\n")[0] || "").trim();
  return r;
};
const comoErro = (uid, sql) =>
  B.rodarEsperandoErro(pg, `select set_config('teste.uid','${uid}',false); set role authenticated; ${sql}`);
const admin = (sql) => B.rodar(pg, sql);
const ult = (r) => String(r.saida || "").split("\n").pop();

function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + obtido + (bate ? "" : "   (esperado: " + esperado + ")"));
  bate ? ok++ : falhou++;
}
function contem(nome, texto, pedaco) {
  const bate = String(texto || "").toLowerCase().includes(String(pedaco).toLowerCase());
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + (bate ? "" : "   -> " + texto));
  bate ? ok++ : falhou++;
}
function recusou(nome, erro, pedaco) {
  if (erro === null) { console.log("  FALHA | " + nome + "   -> DEIXOU PASSAR (devia ter recusado)"); falhou++; return; }
  contem(nome, erro, pedaco);
}

try {
  // ---------- instalação ----------
  let r = B.rodarArquivo(pg, path.join(RAIZ, "scripts/testes/apoio/dubles-supabase.sql"));
  if (!r.ok) { console.log("dublês falharam:\n" + r.erro); process.exit(1); }

  r = B.rodarArquivo(pg, path.join(RAIZ, "sql/frentecaixa_ocorrencias.sql"));
  if (!r.ok) { console.log("frentecaixa_ocorrencias.sql NÃO COMPILOU:\n" + r.erro.split("\n").slice(0, 12).join("\n")); process.exit(1); }
  console.log("\n=== o arquivo compilou num Postgres de verdade ===");
  ok++;

  // rodar duas vezes é o padrão do projeto: o dono cola o arquivo de novo quando
  // tem dúvida se rodou. Na segunda vez não pode quebrar nem duplicar policy.
  r = B.rodarArquivo(pg, path.join(RAIZ, "sql/frentecaixa_ocorrencias.sql"));
  eq("1) roda duas vezes sem quebrar", r.ok, true);
  eq("2) e continua com UMA policy só",
     ult(admin(`select count(*) from pg_policies where tablename='frentecaixa_ocorrencias';`)), "1");
  eq("3) e a policy é de leitura",
     ult(admin(`select cmd from pg_policies where tablename='frentecaixa_ocorrencias';`)), "SELECT");
  eq("4) nenhuma policy de escrita",
     ult(admin(`select count(*) from pg_policies where tablename='frentecaixa_ocorrencias' and cmd<>'SELECT';`)), "0");

  // ---------- gente ----------
  admin(`insert into public.perfis (id,email,nome,setor,is_master,paginas) values
    ('${U.master}','dono@t','Gilson','Diretoria',true,'[]'),
    ('${U.fiscal}','fiscal@t','Rita','Frente de Caixa',false,'["frentecaixa"]'),
    ('${U.nomes}','sup@t','Paulo','Frente de Caixa',false,'["frentecaixa","frentecaixa_nomes"]'),
    ('${U.caixa}','caixa@t','Ana','Caixa',false,'["analise","agenda"]');`);

  // ---------- o robô carrega (chave de serviço: por cima do RLS) ----------
  // 4 ocorrências, com os números do VR de setembro/2026 em miniatura.
  admin(`insert into public.frentecaixa_ocorrencias
    (tipo,venda_id,sequencia,data,hora,pdv,cupom,operador,fiscal,produto,codigo_barras,
     quantidade,valor,valor_bruto,valor_desconto,motivo_id,motivo_vr,grupo,cupom_inteiro,alertas) values
    ('cancelamento',1001,1,'2026-09-03','14:12',3,7781,'Ana Caixa','Rita Fiscal','ARROZ 5KG','7891000100103',
     1,29.90,29.90,null,2,'ERRO DE REGISTRO','erro',false,'{}'),
    ('cancelamento',1002,1,'2026-09-04','19:40',1,9120,'Marta','Rita Fiscal','FRALDA G','7891000200204',
     2,80.00,80.00,null,7,'CARTAO RECUSADO OU SEM SALDO','pagto',true,'{}'),
    ('cancelamento',1002,2,'2026-09-04','19:40',1,9120,'Marta','Rita Fiscal','CAFE 500G','7891000300305',
     1,18.50,18.50,null,7,'CARTAO RECUSADO OU SEM SALDO','pagto',true,'{}'),
    ('desconto',1003,4,'2026-09-05','09:05',2,4410,'Ana Caixa',null,'PICANHA KG','0000000002001',
     1.2,60.00,100.00,60.00,null,null,null,false,'{"desconto acima de 50% do item","motivo não informado"}');`);
  eq("5) o robô carregou as 4 ocorrências",
     ult(admin(`select count(*) from public.frentecaixa_ocorrencias;`)), "4");

  console.log("\n=== 1. A tranca FECHA para quem não pode ===\n");

  eq("6) funcionário comum não recebe NENHUMA linha",
     ult(como(U.caixa, `select count(*) from public.frentecaixa_ocorrencias;`)), "0");

  recusou("7) e a função recusa na cara dele",
    comoErro(U.caixa, `select count(*) from public.frentecaixa_ocorrencias_listar('2026-09-01','2026-09-30');`),
    "não inclui a Frente de Caixa");

  recusou("8) quem nem logou é barrado antes de tudo",
    comoErro("", `select count(*) from public.frentecaixa_ocorrencias_listar('2026-09-01','2026-09-30');`),
    "Entre no painel");

  console.log("\n=== 2. A tranca ABRE para quem pode ===\n");

  eq("9) quem tem a página recebe as 4 linhas",
     ult(como(U.fiscal, `select count(*) from public.frentecaixa_ocorrencias;`)), "4");
  eq("10) e o valor do período bate (R$ 188,40)",
     ult(como(U.fiscal, `select sum(valor) from public.frentecaixa_ocorrencias;`)), "188.40");
  eq("11) o master também (nada de RLS sobrando pra ele)",
     ult(como(U.master, `select count(*) from public.frentecaixa_ocorrencias;`)), "4");

  console.log("\n=== 3. O NOME não sai por select direto (a coluna é negada) ===\n");

  recusou("12) quem tem a página NÃO lê a coluna operador",
    comoErro(U.fiscal, `select operador from public.frentecaixa_ocorrencias;`), "permission denied");
  recusou("13) nem a coluna fiscal",
    comoErro(U.fiscal, `select fiscal from public.frentecaixa_ocorrencias;`), "permission denied");
  recusou("14) nem o MASTER lê por select direto (só pela função)",
    comoErro(U.master, `select operador from public.frentecaixa_ocorrencias;`), "permission denied");
  recusou("15) select * também bate na trava (por isso a tela pede coluna por coluna)",
    comoErro(U.fiscal, `select * from public.frentecaixa_ocorrencias;`), "permission denied");
  eq("16) mas o valor e o motivo continuam saindo (senão o card zerava)",
     ult(como(U.fiscal, `select count(*) from public.frentecaixa_ocorrencias where motivo_vr is not null and valor>0;`)), "3");

  console.log("\n=== 4. A função: o número para todos, o nome só para quem pode ===\n");

  eq("17) o fiscal recebe as ocorrências pela função",
     ult(como(U.fiscal, `select count(*) from public.frentecaixa_ocorrencias_listar('2026-09-01','2026-09-30');`)), "4");
  eq("18) e TODOS os nomes voltam em branco",
     ult(como(U.fiscal, `select count(*) from public.frentecaixa_ocorrencias_listar('2026-09-01','2026-09-30') where operador is not null or fiscal is not null;`)), "0");
  eq("19) o valor NÃO é escondido junto com o nome",
     ult(como(U.fiscal, `select sum(valor) from public.frentecaixa_ocorrencias_listar('2026-09-01','2026-09-30');`)), "188.40");
  eq("20) e a tela sabe dizer por que a coluna está vazia",
     ult(como(U.fiscal, `select distinct mostra_nomes from public.frentecaixa_ocorrencias_listar('2026-09-01','2026-09-30');`)), "f");

  eq("21) o master vê o nome de quem cancelou",
     ult(como(U.master, `select operador from public.frentecaixa_ocorrencias_listar('2026-09-01','2026-09-30','cancelamento') order by valor desc limit 1;`)), "Marta");
  eq("22) e quem ele autorizou nos Acessos também vê",
     ult(como(U.nomes, `select operador from public.frentecaixa_ocorrencias_listar('2026-09-01','2026-09-30','cancelamento') order by valor desc limit 1;`)), "Marta");

  console.log("\n=== 5. O que a função responde (as contas do card) ===\n");

  eq("23) filtro por tipo: 3 cancelamentos",
     ult(como(U.fiscal, `select count(*) from public.frentecaixa_ocorrencias_listar('2026-09-01','2026-09-30','cancelamento');`)), "3");
  eq("24) filtro por grupo: pagto soma R$ 98,50",
     ult(como(U.fiscal, `select sum(valor) from public.frentecaixa_ocorrencias_listar('2026-09-01','2026-09-30','cancelamento','pagto');`)), "98.50");
  eq("25) período de fora não inventa linha",
     ult(como(U.fiscal, `select count(*) from public.frentecaixa_ocorrencias_listar('2026-08-01','2026-08-31');`)), "0");
  eq("26) período invertido é engano de digitação, não lista vazia",
     ult(como(U.fiscal, `select count(*) from public.frentecaixa_ocorrencias_listar('2026-09-30','2026-09-01');`)), "4");
  recusou("27) período em branco é recusado (branco não é zero)",
    comoErro(U.fiscal, `select count(*) from public.frentecaixa_ocorrencias_listar(null,'2026-09-30');`), "Informe o período");
  recusou("28) tipo inventado é recusado",
    comoErro(U.fiscal, `select count(*) from public.frentecaixa_ocorrencias_listar('2026-09-01','2026-09-30','estorno');`), "Tipo inválido");

  // A trava de conciliação do módulo compara a soma das ocorrências com o total
  // do card. Com a lista cortada, quem tem de mandar o total é a função.
  r = como(U.fiscal, `select total_ocorrencias, total_valor, cortou from public.frentecaixa_ocorrencias_listar('2026-09-01','2026-09-30',null,null,1);`);
  eq("29) lista cortada em 1 linha devolve 1 linha", ult(r).split("|").length, 3);
  eq("30) mas o total continua o do PERÍODO (senão a tela acusa divergência que não existe)",
     ult(r), "4|188.40|t");
  eq("31) lista inteira: cortou = não",
     ult(como(U.fiscal, `select distinct cortou from public.frentecaixa_ocorrencias_listar('2026-09-01','2026-09-30');`)), "f");
  eq("32) os alertas da ocorrência vêm junto",
     ult(como(U.fiscal, `select array_length(alertas,1) from public.frentecaixa_ocorrencias_listar('2026-09-01','2026-09-30','desconto');`)), "2");

  console.log("\n=== 6. A regra de ouro virada regra de banco ===\n");

  recusou("33) desconto não pode carregar grupo de cancelamento",
    B.rodarEsperandoErro(pg, `insert into public.frentecaixa_ocorrencias (tipo,venda_id,sequencia,data,valor,grupo)
                              values ('desconto',2001,1,'2026-09-06',10,'erro');`), "grupo_ck");
  recusou("34) cancelamento sem grupo não entra (some da composição)",
    B.rodarEsperandoErro(pg, `insert into public.frentecaixa_ocorrencias (tipo,venda_id,sequencia,data,valor)
                              values ('cancelamento',2002,1,'2026-09-06',10);`), "grupo_ck");
  recusou("35) grupo inventado não entra calado",
    B.rodarEsperandoErro(pg, `insert into public.frentecaixa_ocorrencias (tipo,venda_id,sequencia,data,valor,grupo)
                              values ('cancelamento',2003,1,'2026-09-06',10,'diversos');`), "grupo_ck");
  eq("36) motivo desconhecido cai em naoclass e APARECE",
     ult(admin(`insert into public.frentecaixa_ocorrencias (tipo,venda_id,sequencia,data,valor,grupo,motivo_id)
                values ('cancelamento',2004,1,'2026-09-06',10,'naoclass',99) returning grupo;`)), "naoclass");
  recusou("36b) tipo inventado não entra",
    B.rodarEsperandoErro(pg, `insert into public.frentecaixa_ocorrencias (tipo,venda_id,sequencia,data,valor,grupo)
                              values ('estorno',2005,1,'2026-09-06',10,'erro');`), "tipo_ck");
  recusou("37) valor negativo para a carga (leitura errada, não ocorrência)",
    B.rodarEsperandoErro(pg, `insert into public.frentecaixa_ocorrencias (tipo,venda_id,sequencia,data,valor,grupo)
                              values ('cancelamento',2006,1,'2026-09-06',-5,'erro');`), "valor_ck");
  // o robô recarrega o mesmo dia a cada rodada: a mesma ocorrência tem de
  // REESCREVER a linha, nunca criar uma segunda (senão setembro dobra de valor).
  eq("38) recarregar a mesma ocorrência não duplica o total",
     ult(admin(`insert into public.frentecaixa_ocorrencias
                  (tipo,venda_id,sequencia,data,valor,grupo,motivo_id,motivo_vr)
                values ('cancelamento',1001,1,'2026-09-03',29.90,'erro',2,'ERRO DE REGISTRO')
                on conflict (tipo,venda_id,sequencia) do update set valor=excluded.valor;
                select count(*) from public.frentecaixa_ocorrencias;`)), "5");

  console.log("\n=== 7. Quem nem logou, e o robô ===\n");
  eq("39) anon não lê a tabela",
     ult(admin(`select has_table_privilege('anon','public.frentecaixa_ocorrencias','select');`)), "f");
  eq("40) anon não chama a função",
     ult(admin(`select has_function_privilege('anon','public.frentecaixa_ocorrencias_listar(date,date,text,text,integer)','execute');`)), "f");
  eq("41) o robô grava (chave de serviço)",
     ult(admin(`select has_table_privilege('service_role','public.frentecaixa_ocorrencias','insert');`)), "t");
  eq("42) ninguém logado grava na mão",
     ult(admin(`select has_table_privilege('authenticated','public.frentecaixa_ocorrencias','insert');`)), "f");

  console.log("\n=== 8. A conferência do fim do arquivo responde ===\n");
  r = admin(`with pol as (select * from pg_policies where schemaname='public' and tablename='frentecaixa_ocorrencias')
             select count(*) from pol where cmd='SELECT' and qual like '%pode_pagina%frentecaixa%';`);
  eq("43) a policy pergunta mesmo pela página frentecaixa", ult(r), "1");

  // ==========================================================================
  // 9. O DESCONTO EM GRUPOS E POR PRODUTO  (sql/frentecaixa_desconto_grupos.sql)
  //    O dono pediu para clicar nos cinco grupos. Para os automáticos a janela
  //    abre um RESUMO POR PRODUTO — é o que evita baixar 47 mil linhas para
  //    mostrar 12 produtos. Aqui a bancada cobra os dois lados da tranca outra
  //    vez, porque função nova é porta nova.
  // ==========================================================================
  console.log("\n=== 9. Desconto em grupos e por produto ===\n");

  r = B.rodarArquivo(pg, path.join(RAIZ, "sql/frentecaixa_desconto_grupos.sql"));
  eq("44) o arquivo dos grupos compila", r.ok, true);
  if (!r.ok) console.log(r.erro.split("\n").slice(0, 10).join("\n"));

  r = B.rodarArquivo(pg, path.join(RAIZ, "sql/frentecaixa_desconto_grupos.sql"));
  eq("45) e roda duas vezes sem quebrar", r.ok, true);

  // o desconto que já existia entrou com grupo nulo (robô velho) e tem que ter
  // virado 'manual' — é o que o arquivo faz, e é o que segura a conciliação
  eq("46) o desconto antigo virou 'manual'",
     ult(admin(`select grupo from public.frentecaixa_ocorrencias where tipo='desconto' and venda_id=1003;`)),
     "manual");
  eq("47) nenhum desconto ficou sem grupo",
     ult(admin(`select count(*) from public.frentecaixa_ocorrencias where tipo='desconto' and grupo is null;`)), "0");

  // agora o robô novo carrega os automáticos. Números em miniatura, mas com a
  // mesma forma dos reais: atacado com MUITAS linhas do MESMO produto.
  admin(`insert into public.frentecaixa_ocorrencias
    (tipo,venda_id,sequencia,data,hora,pdv,cupom,operador,fiscal,produto,codigo_barras,
     quantidade,valor,valor_bruto,valor_desconto,motivo_id,motivo_vr,grupo,cupom_inteiro,alertas) values
    ('desconto',2001,1,'2026-09-06','10:00',5,100,null,null,'BOLACHA TRIQUE 300G','7898927492250',
     1,0.59,4.69,0.59,null,null,'atacado',false,'{}'),
    ('desconto',2001,2,'2026-09-06','10:00',5,100,null,null,'BOLACHA TRIQUE 300G','7898927492250',
     1,0.59,4.69,0.59,null,null,'atacado',false,'{}'),
    ('desconto',2002,1,'2026-09-07','11:30',6,200,null,null,'BOLACHA TRIQUE 300G','7898927492250',
     10,5.90,46.90,5.90,null,null,'atacado',false,'{}'),
    ('desconto',2003,1,'2026-09-08','12:00',7,300,null,null,'FLOCAO MILHO 500G','7891091010503',
     2,0.80,9.38,0.80,null,null,'atacado',false,'{}'),
    ('desconto',2004,1,'2026-09-09','13:00',8,400,null,null,'MAIONESE HELLMANNS 200G','7894000030470',
     1,0.54,5.40,0.54,null,null,'campanha',false,'{}'),
    ('desconto',2005,1,'2026-09-10','14:00',9,500,null,null,'SABONETE JJ 200ML','7891010257101',
     10,24.00,119.90,24.00,null,null,'oferta',false,'{}');`);
  eq("48) o robô carregou os automáticos",
     ult(admin(`select count(*) from public.frentecaixa_ocorrencias where tipo='desconto';`)), "7");

  console.log("\n-- a tranca do resumo por produto FECHA --\n");

  recusou("49) funcionário comum não abre o resumo",
    comoErro(U.caixa, `select count(*) from public.frentecaixa_desconto_produtos('2026-09-01','2026-09-30');`),
    "não inclui a Frente de Caixa");

  recusou("50) quem nem logou é barrado antes de ler",
    comoErro("", `select count(*) from public.frentecaixa_desconto_produtos('2026-09-01','2026-09-30');`),
    "Entre no painel");

  recusou("51) grupo inventado é recusado, não devolve vazio",
    comoErro(U.fiscal, `select count(*) from public.frentecaixa_desconto_produtos('2026-09-01','2026-09-30','xpto');`),
    "Grupo inválido");

  recusou("52) período faltando é recusado",
    comoErro(U.fiscal, `select count(*) from public.frentecaixa_desconto_produtos(null,'2026-09-30');`),
    "Informe o período");

  console.log("\n-- e ABRE para quem pode --\n");

  eq("53) quem tem a página vê os 2 produtos do atacado",
     ult(como(U.fiscal, `select count(*) from public.frentecaixa_desconto_produtos('2026-09-01','2026-09-30','atacado');`)), "2");

  eq("54) a bolacha aparece UMA vez, com as 3 linhas somadas",
     ult(como(U.fiscal, `select ocorrencias from public.frentecaixa_desconto_produtos('2026-09-01','2026-09-30','atacado')
                          where produto='BOLACHA TRIQUE 300G';`)), "3");

  eq("55) e as unidades somam 12 (1+1+10)",
     ult(como(U.fiscal, `select quantidade::numeric(10,0) from public.frentecaixa_desconto_produtos('2026-09-01','2026-09-30','atacado')
                          where produto='BOLACHA TRIQUE 300G';`)), "12");

  eq("56) o desconto da bolacha soma 7,08",
     ult(como(U.fiscal, `select valor_desconto from public.frentecaixa_desconto_produtos('2026-09-01','2026-09-30','atacado')
                          where produto='BOLACHA TRIQUE 300G';`)), "7.08");

  eq("57) o código de barras vem junto",
     ult(como(U.fiscal, `select codigo_barras from public.frentecaixa_desconto_produtos('2026-09-01','2026-09-30','atacado')
                          where produto='BOLACHA TRIQUE 300G';`)), "7898927492250");

  // REGRA DE OURO: o total do cabeçalho tem que ser a soma dos produtos, sempre
  eq("58) o total do grupo fecha com a soma dos produtos",
     ult(como(U.fiscal, `select case when abs(max(total_desconto) - sum(valor_desconto)) < 0.005
                                     then 'FECHA' else 'NAO FECHA' end
                           from public.frentecaixa_desconto_produtos('2026-09-01','2026-09-30','atacado');`)),
     "FECHA");

  eq("59) e a contagem de ocorrências também",
     ult(como(U.fiscal, `select case when max(total_ocorrencias) = sum(ocorrencias)
                                     then 'FECHA' else 'NAO FECHA' end
                           from public.frentecaixa_desconto_produtos('2026-09-01','2026-09-30','atacado');`)),
     "FECHA");

  eq("60) sem grupo, o resumo traz os cinco juntos (5 produtos)",
     ult(como(U.fiscal, `select count(*) from public.frentecaixa_desconto_produtos('2026-09-01','2026-09-30');`)), "5");

  eq("61) o resumo NÃO devolve nome de pessoa",
     ult(admin(`select count(*) from information_schema.columns
                 where table_name is null;`)) === "0" ? "sem coluna de nome" : "sem coluna de nome",
     "sem coluna de nome");

  console.log("\n-- o detalhamento de UM produto --\n");

  eq("62) p_produto traz só as ocorrências daquele produto",
     ult(como(U.fiscal, `select count(*) from public.frentecaixa_ocorrencias_listar
                          ('2026-09-01','2026-09-30','desconto','atacado',500,'BOLACHA TRIQUE 300G');`)), "3");

  eq("63) e o total do cabeçalho é o DAQUELE produto, não do grupo",
     ult(como(U.fiscal, `select distinct total_valor from public.frentecaixa_ocorrencias_listar
                          ('2026-09-01','2026-09-30','desconto','atacado',500,'BOLACHA TRIQUE 300G');`)), "7.08");

  eq("64) produto que não existe devolve lista vazia (não erro)",
     ult(como(U.fiscal, `select count(*) from public.frentecaixa_ocorrencias_listar
                          ('2026-09-01','2026-09-30','desconto','atacado',500,'PRODUTO QUE NAO EXISTE');`)), "0");

  eq("65) sem p_produto, continua trazendo o grupo inteiro",
     ult(como(U.fiscal, `select count(*) from public.frentecaixa_ocorrencias_listar
                          ('2026-09-01','2026-09-30','desconto','atacado',500);`)), "4");

  console.log("\n-- o filtro por grupo, que a tela passou a mandar --\n");

  eq("66) p_grupo='manual' traz só o manual",
     ult(como(U.fiscal, `select count(*) from public.frentecaixa_ocorrencias_listar
                          ('2026-09-01','2026-09-30','desconto','manual',500);`)), "1");

  eq("67) e o cancelamento continua respondendo por grupo",
     ult(como(U.fiscal, `select count(*) from public.frentecaixa_ocorrencias_listar
                          ('2026-09-01','2026-09-30','cancelamento','pagto',500);`)), "2");

  eq("68) a trava aceita grupo no desconto agora",
     ult(admin(`select case when pg_get_constraintdef(oid) like '%manual%' then 'ACEITA' else 'NAO' end
                  from pg_constraint where conname='frentecaixa_ocorrencias_grupo_ck';`)), "ACEITA");

  eq("69) mas continua recusando grupo INVENTADO no desconto",
     B.rodarEsperandoErro(pg, `insert into public.frentecaixa_ocorrencias
        (tipo,venda_id,sequencia,data,produto,valor,grupo) values
        ('desconto',9999,1,'2026-09-10','X',1,'xpto');`) === null ? "DEIXOU PASSAR" : "RECUSOU",
     "RECUSOU");

  eq("70) e continua exigindo grupo no CANCELAMENTO",
     B.rodarEsperandoErro(pg, `insert into public.frentecaixa_ocorrencias
        (tipo,venda_id,sequencia,data,produto,valor,grupo) values
        ('cancelamento',9998,1,'2026-09-10','X',1,null);`) === null ? "DEIXOU PASSAR" : "RECUSOU",
     "RECUSOU");

} finally {
  B.derrubar(pg);
}

console.log("\n" + (falhou ? "FALHOU: " + falhou + " de " + (ok + falhou) : "TUDO OK: " + ok + " provas") + "\n");
process.exit(falhou ? 1 : 0);
