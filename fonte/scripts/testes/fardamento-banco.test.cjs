// ============================================================
// BANCADA DO MÓDULO FARDAMENTO — o lado do BANCO.
//
// Sobe um PostgreSQL temporário, instala os dublês das peças do Supabase e os
// 7 arquivos do módulo, e exercita os casos de verdade: entrega, estoque,
// devolução, estorno, inventário, política com vigência, permissão e senha do
// master. No fim derruba o banco e não deixa nada pra trás.
//
//   node scripts/testes/fardamento-banco.test.cjs
//
// NÃO encosta no Supabase de produção.
// ============================================================
const path = require("path");
const B = require("./apoio/banco-de-teste.cjs");
const RAIZ = path.join(__dirname, "..", "..");

if (!B.temPostgres()) {
  console.log("SEM POSTGRES LOCAL — instale com: brew install postgresql@16");
  process.exit(1);
}

const U = {
  master:      "10000000-0000-0000-0000-000000000001",
  rh:          "10000000-0000-0000-0000-000000000002",
  encarregado: "10000000-0000-0000-0000-000000000003"
};
const ID = {
  setorAcougue: "20000000-0000-0000-0000-000000000001",
  setorCaixa:   "20000000-0000-0000-0000-000000000002",
  funcAcoug:    "30000000-0000-0000-0000-000000000001",
  funcCaixa:    "30000000-0000-0000-0000-000000000002",
  jonas:        "40000000-0000-0000-0000-000000000001",
  ana:          "40000000-0000-0000-0000-000000000002",
  novato:       "40000000-0000-0000-0000-000000000003",
  jaleco:       "50000000-0000-0000-0000-000000000001",
  calca:        "50000000-0000-0000-0000-000000000002",
  skuJalecoM:   "60000000-0000-0000-0000-000000000001",
  skuCalca42:   "60000000-0000-0000-0000-000000000002"
};
const rq = (n) => "70000000-0000-0000-0000-" + String(n).padStart(12, "0");

let ok = 0, falhou = 0;
const pg = B.subir();
const comoSQL = (uid, sql) => `select set_config('teste.uid','${uid}',false); ${sql}`;
const como = (uid, sql) => {
  const r = B.rodar(pg, comoSQL(uid, sql));
  // quando o SQL falha, o teste tem que MOSTRAR o erro em vez de comparar lixo
  if (!r.ok) r.saida = "ERRO SQL: " + (r.erro.split("\n")[0] || "").trim();
  return r;
};
const comoErro = (uid, sql) => B.rodarEsperandoErro(pg, comoSQL(uid, sql));

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
  for (const f of ["1_pessoas","2_catalogo","3_movimentos","4_compras","5_inventario","6_assinatura","7_leituras","8_config"]) {
    r = B.rodarArquivo(pg, path.join(RAIZ, "sql", "fardamento_" + f + ".sql"));
    if (!r.ok) { console.log("fardamento_" + f + " falhou:\n" + r.erro.split("\n").slice(0,10).join("\n")); process.exit(1); }
  }
  console.log("\n=== instalação: os 7 arquivos compilaram num Postgres de verdade ===");
  ok++;

  // ---------- gente ----------
  B.rodar(pg, `insert into public.perfis (id,email,nome,setor,is_master,paginas) values
    ('${U.master}','master@t','Gilson','Diretoria',true,'[]'),
    ('${U.rh}','rh@t','Márcia','RH',false,'["fardamento","fardamento_loja","fardamento_politicas","pessoas"]'),
    ('${U.encarregado}','enc@t','Cícero','Açougue',false,'["fardamento"]');`);

  console.log("\n=== 1. Cadastro: setores, funções, pessoas ===\n");
  como(U.rh, `insert into public.pessoas_setores (id,nome) values ('${ID.setorAcougue}','Açougue'),('${ID.setorCaixa}','Frente de Loja');
              insert into public.pessoas_funcoes (id,nome,setor_id) values ('${ID.funcAcoug}','Açougueiro','${ID.setorAcougue}'),('${ID.funcCaixa}','Caixa','${ID.setorCaixa}');`);

  r = como(U.rh, `select public.pessoas_salvar(null, '${rq(1)}', '{"nome":"Jonas","setor_id":"${ID.setorAcougue}","funcao_id":"${ID.funcAcoug}","admissao":"2024-03-12"}'::jsonb);`);
  const jonas = r.saida.split("\n").pop();
  eq("1) cadastrar funcionário devolve um id", /^[0-9a-f-]{36}$/.test(jonas), true);

  r = como(U.rh, `select public.pessoas_salvar(null, '${rq(1)}', '{"nome":"Jonas de novo"}'::jsonb);`);
  eq("2) mesma intenção não cria funcionário duas vezes", r.saida.split("\n").pop(), jonas);

  r = como(U.rh, `select public.pessoas_salvar(null, '${rq(2)}', '{"nome":"Ana","setor_id":"${ID.setorCaixa}","funcao_id":"${ID.funcCaixa}","admissao":"2025-01-10"}'::jsonb);`);
  const ana = r.saida.split("\n").pop();
  r = como(U.rh, `select public.pessoas_salvar(null, '${rq(3)}', '{"nome":"Novato","setor_id":"${ID.setorAcougue}","funcao_id":"${ID.funcAcoug}"}'::jsonb);`);
  const novato = r.saida.split("\n").pop();   // de propósito SEM data de admissão

  recusou("3) encarregado não cadastra funcionário",
    comoErro(U.encarregado, `select public.pessoas_salvar(null,null,'{"nome":"X"}'::jsonb);`), "não inclui o cadastro");

  // homônimo
  r = como(U.rh, `select public.pessoas_salvar(null, '${rq(4)}', '{"nome":"Jonas","setor_id":"${ID.setorCaixa}"}'::jsonb);`);
  eq("4) homônimo é permitido (identidade é o id, não o nome)", r.saida.split("\n").pop() !== jonas, true);

  console.log("\n=== 2. Tempo ativo: NULL não é zero ===\n");
  r = como(U.rh, `select coalesce(public.pessoas_dias_ativos('${novato}'::uuid,'2026-01-01','2026-12-31')::text,'NULO');`);
  eq("5) sem data de admissão devolve NULO (não zero)", r.saida.split("\n").pop(), "NULO");

  r = como(U.rh, `select public.pessoas_dias_ativos('${jonas}'::uuid,'2026-08-01','2026-08-31');`);
  eq("6) agosto inteiro para quem já era da casa = 31 dias", r.saida.split("\n").pop(), "31");

  // 10 dias de férias em agosto
  como(U.rh, `select public.pessoas_salvar('${jonas}','${rq(5)}','{"nome":"Jonas","situacao":"ferias","setor_id":"${ID.setorAcougue}","funcao_id":"${ID.funcAcoug}","admissao":"2024-03-12","vigencia":"2026-08-05"}'::jsonb);
              select public.pessoas_salvar('${jonas}','${rq(6)}','{"nome":"Jonas","situacao":"ativo","setor_id":"${ID.setorAcougue}","funcao_id":"${ID.funcAcoug}","admissao":"2024-03-12","vigencia":"2026-08-15"}'::jsonb);`);
  r = como(U.rh, `select public.pessoas_dias_ativos('${jonas}'::uuid,'2026-08-01','2026-08-31');`);
  eq("7) 10 dias de férias descontam do período ativo", r.saida.split("\n").pop(), "21");

  console.log("\n=== 3. Mudança de setor: o passado continua do setor antigo ===\n");
  como(U.rh, `select public.pessoas_salvar('${ana}','${rq(7)}','{"nome":"Ana","situacao":"ativo","setor_id":"${ID.setorAcougue}","funcao_id":"${ID.funcAcoug}","admissao":"2025-01-10","vigencia":"2026-07-01"}'::jsonb);`);
  r = como(U.rh, `select public.pessoas_em('${ana}'::uuid,'2026-05-01')->>'setor_id';`);
  eq("8) em maio, Ana ainda era da Frente de Loja", r.saida.split("\n").pop(), ID.setorCaixa);
  r = como(U.rh, `select public.pessoas_em('${ana}'::uuid,'2026-08-01')->>'setor_id';`);
  eq("9) em agosto, Ana já é do Açougue", r.saida.split("\n").pop(), ID.setorAcougue);

  console.log("\n=== 4. Catálogo e motivos ===\n");
  como(U.rh, `insert into public.fard_pecas (id,nome,unidade) values ('${ID.jaleco}','Jaleco','unidade'),('${ID.calca}','Calça','unidade');
              insert into public.fard_skus (id,peca_id,tamanho) values ('${ID.skuJalecoM}','${ID.jaleco}','M'),('${ID.skuCalca42}','${ID.calca}','42');`);
  r = como(U.rh, `select count(*) from public.fard_motivos;`);
  eq("10) os 12 motivos aprovados nasceram semeados", r.saida.split("\n").pop(), "12");
  r = como(U.rh, `select entra_no_indice from public.fard_motivos where nome='Enxoval inicial';`);
  eq("11) enxoval inicial NÃO entra no índice", r.saida.split("\n").pop(), "f");
  r = como(U.rh, `select entra_no_indice from public.fard_motivos where nome='Alteração de tamanho';`);
  eq("12) alteração de tamanho NÃO entra no índice", r.saida.split("\n").pop(), "f");
  r = como(U.rh, `select entra_no_indice from public.fard_motivos where nome='Rasgou';`);
  eq("13) rasgou entra no índice", r.saida.split("\n").pop(), "t");

  const motivo = (n) => `(select id from public.fard_motivos where nome='${n}')`;

  console.log("\n=== 5. Entrada e estoque ===\n");
  r = como(U.rh, `select public.fard_entrada('${rq(10)}', ('{"data":"2026-08-01","itens":[{"sku_id":"${ID.skuJalecoM}","quantidade":10,"custo_unit":74},{"sku_id":"${ID.skuCalca42}","quantidade":6,"custo_unit":62}]}')::jsonb) is not null;`);
  eq("14) entrada de estoque grava", r.saida.split("\n").pop(), "t");
  r = como(U.rh, `select public.fard_saldo_sku('${ID.skuJalecoM}');`);
  eq("15) saldo nasce da soma dos movimentos", r.saida.split("\n").pop(), "10");
  r = como(U.rh, `select public.fard_entrada('${rq(10)}', ('{"itens":[{"sku_id":"${ID.skuJalecoM}","quantidade":99}]}')::jsonb)->>'repetida';`);
  eq("16) reenviar a mesma entrada não duplica estoque", r.saida.split("\n").pop(), "true");
  r = como(U.rh, `select public.fard_saldo_sku('${ID.skuJalecoM}');`);
  eq("17) saldo continua 10 depois do reenvio", r.saida.split("\n").pop(), "10");

  recusou("18) encarregado não lança entrada",
    comoErro(U.encarregado, `select public.fard_entrada('${rq(11)}', ('{"itens":[{"sku_id":"${ID.skuJalecoM}","quantidade":1}]}')::jsonb);`),
    "loja inteira");

  console.log("\n=== 6. Entrega ===\n");
  r = como(U.rh, `select public.fard_entregar('${rq(20)}', ('{"pessoa_id":"${jonas}","data":"2026-08-03","itens":[{"sku_id":"${ID.skuJalecoM}","quantidade":1,"motivo_id":"'||${motivo("'Troca prevista'".replace(/'/g,""))}||'"}]}')::jsonb)->>'itens';`);
  eq("19) entrega simples grava 1 item", r.saida.split("\n").pop(), "1");
  r = como(U.rh, `select public.fard_saldo_sku('${ID.skuJalecoM}');`);
  eq("20) entregar tira do estoque", r.saida.split("\n").pop(), "9");
  r = como(U.rh, `select (public.fard_posse_pessoa('${jonas}'::uuid)->0)->>'quantidade';`);
  eq("21) e põe na posse da pessoa", r.saida.split("\n").pop(), "1");

  r = como(U.rh, `select public.fard_entregar('${rq(21)}', ('{"pessoa_id":"${jonas}","data":"2026-08-04","itens":[
      {"sku_id":"${ID.skuJalecoM}","quantidade":1,"motivo_id":"'||${motivo("Troca prevista")}||'"},
      {"sku_id":"${ID.skuCalca42}","quantidade":2,"motivo_id":"'||${motivo("Enxoval inicial")}||'"}]}')::jsonb)->>'itens';`);
  eq("22) uma entrega com vários itens (não precisa salvar um por um)", r.saida.split("\n").pop(), "2");

  recusou("23) entrega sem motivo é recusada",
    comoErro(U.rh, `select public.fard_entregar('${rq(22)}', ('{"pessoa_id":"${jonas}","itens":[{"sku_id":"${ID.skuJalecoM}","quantidade":1}]}')::jsonb);`),
    "precisa de motivo");

  recusou("24) motivo extraordinário sem justificativa é recusado",
    comoErro(U.rh, `select public.fard_entregar('${rq(23)}', ('{"pessoa_id":"${jonas}","itens":[{"sku_id":"${ID.skuJalecoM}","quantidade":1,"motivo_id":"'||${motivo("Rasgou")}||'"}]}')::jsonb);`),
    "justificativa");

  r = como(U.rh, `select public.fard_entregar('${rq(24)}', ('{"pessoa_id":"${jonas}","data":"2026-08-10","itens":[{"sku_id":"${ID.skuJalecoM}","quantidade":1,"motivo_id":"'||${motivo("Rasgou")}||'","justificativa":"rasgou na serra"}]}')::jsonb)->>'itens';`);
  eq("25) com justificativa, o extraordinário passa (não bloqueia o trabalho)", r.saida.split("\n").pop(), "1");

  recusou("26) não dá pra entregar mais do que tem em estoque",
    comoErro(U.rh, `select public.fard_entregar('${rq(25)}', ('{"pessoa_id":"${jonas}","itens":[{"sku_id":"${ID.skuJalecoM}","quantidade":999,"motivo_id":"'||${motivo("Troca prevista")}||'"}]}')::jsonb);`),
    "em estoque");

  console.log("\n=== 7. Permissão do encarregado ===\n");
  como(U.rh, `update public.pessoas set perfil_id='${U.encarregado}' where id='${jonas}';`);
  r = como(U.encarregado, `select public.fard_meu_setor();`);
  eq("27) o setor do encarregado sai do vínculo do login", r.saida.split("\n").pop(), ID.setorAcougue);

  r = como(U.encarregado, `select public.fard_entregar('${rq(26)}', ('{"pessoa_id":"${jonas}","data":"2026-08-11","itens":[{"sku_id":"${ID.skuJalecoM}","quantidade":1,"motivo_id":"'||${motivo("Troca prevista")}||'"}]}')::jsonb)->>'itens';`);
  eq("28) encarregado entrega pra gente DO SETOR dele", r.saida.split("\n").pop(), "1");

  como(U.rh, `select public.pessoas_salvar('${ana}','${rq(27)}','{"nome":"Ana","situacao":"ativo","setor_id":"${ID.setorCaixa}","funcao_id":"${ID.funcCaixa}","admissao":"2025-01-10","vigencia":"2026-08-20"}'::jsonb);`);
  recusou("29) encarregado NÃO entrega pra gente de outro setor",
    comoErro(U.encarregado, `select public.fard_entregar('${rq(28)}', ('{"pessoa_id":"${ana}","data":"2026-08-25","itens":[{"sku_id":"${ID.skuJalecoM}","quantidade":1,"motivo_id":"'||${motivo("Troca prevista")}||'"}]}')::jsonb);`),
    "seu setor");

  console.log("\n=== 8. Dinheiro: o encarregado não enxerga ===\n");
  r = como(U.rh, `select (e->>'custo_medio') from jsonb_array_elements(public.fard_estoque_bruto()) e where e->>'peca'='Jaleco';`);
  eq("30) RH vê o custo médio da peça", r.saida.split("\n").pop(), "74.00");
  r = como(U.encarregado, `select coalesce((e->>'custo_medio'),'NULO') from jsonb_array_elements(public.fard_estoque_bruto()) e where e->>'peca'='Jaleco';`);
  eq("31) encarregado recebe o custo NULO — nem chega no navegador dele", r.saida.split("\n").pop(), "NULO");
  r = como(U.encarregado, `select count(*) from jsonb_array_elements(public.fard_movimentos_listar('{}'::jsonb)) m where (m->>'custo_unit') is not null;`);
  eq("32) e nenhum movimento sai com valor pro encarregado", r.saida.split("\n").pop(), "0");
  recusou("33) encarregado não abre a análise de qualidade da loja",
    comoErro(U.encarregado, `select public.fard_qualidade('2026-01-01','2026-12-31');`), "loja inteira");

  console.log("\n=== 9. Devolução ===\n");
  r = como(U.rh, `select public.fard_devolver('${rq(30)}', ('{"pessoa_id":"${jonas}","data":"2026-08-26","itens":[{"sku_id":"${ID.skuJalecoM}","quantidade":1,"destino":"reutilizavel"}]}')::jsonb)->>'itens';`);
  eq("34) devolução reutilizável grava", r.saida.split("\n").pop(), "1");
  const saldoDepoisReutil = como(U.rh, `select public.fard_saldo_sku('${ID.skuJalecoM}');`).saida.split("\n").pop();
  r = como(U.rh, `select public.fard_devolver('${rq(31)}', ('{"pessoa_id":"${jonas}","data":"2026-08-26","itens":[{"sku_id":"${ID.skuJalecoM}","quantidade":1,"destino":"descarte"}]}')::jsonb)->>'itens';`);
  eq("35) devolução para descarte grava", r.saida.split("\n").pop(), "1");
  r = como(U.rh, `select public.fard_saldo_sku('${ID.skuJalecoM}');`);
  eq("36) peça estragada NÃO volta pro estoque", r.saida.split("\n").pop(), saldoDepoisReutil);

  recusou("37) destino não informado é recusado",
    comoErro(U.rh, `select public.fard_devolver('${rq(32)}', ('{"pessoa_id":"${jonas}","itens":[{"sku_id":"${ID.skuJalecoM}","quantidade":1}]}')::jsonb);`),
    "destino");
  recusou("38) não dá pra devolver mais do que a pessoa tem",
    comoErro(U.rh, `select public.fard_devolver('${rq(33)}', ('{"pessoa_id":"${jonas}","itens":[{"sku_id":"${ID.skuJalecoM}","quantidade":50,"destino":"reutilizavel"}]}')::jsonb);`),
    "não dá pra devolver");

  console.log("\n=== 10. Estorno ===\n");
  const movEntrega = como(U.rh, `select id from public.fard_movimentos where tipo='entrega' and sku_id='${ID.skuJalecoM}' order by criado_em limit 1;`).saida.split("\n").pop();
  recusou("39) estorno sem a senha do master é recusado",
    comoErro(U.rh, `select public.fard_estornar('${rq(40)}','${movEntrega}','erro de digitação','senha-errada');`),
    "senha do master");
  recusou("40) estorno sem motivo escrito é recusado",
    comoErro(U.rh, `select public.fard_estornar('${rq(41)}','${movEntrega}','','senha-do-master');`),
    "motivo escrito");
  const antesEstorno = como(U.rh, `select public.fard_saldo_sku('${ID.skuJalecoM}');`).saida.split("\n").pop();
  r = como(U.rh, `select public.fard_estornar('${rq(42)}','${movEntrega}','lancado errado','senha-do-master') is not null;`);
  eq("41) com senha e motivo, o estorno passa", r.saida.split("\n").pop(), "t");
  r = como(U.rh, `select public.fard_saldo_sku('${ID.skuJalecoM}');`);
  eq("42) estornar uma entrega devolve a peça ao estoque", r.saida.split("\n").pop(), String(Number(antesEstorno) + 1));
  recusou("43) o mesmo movimento não se estorna duas vezes",
    comoErro(U.rh, `select public.fard_estornar('${rq(43)}','${movEntrega}','de novo','senha-do-master');`),
    "já foi estornado");
  r = como(U.rh, `select public.fard_estornar('${rq(42)}','${movEntrega}','x','senha-do-master')->>'repetida';`);
  eq("44) reenvio do MESMO estorno não devolve a peça em dobro", r.saida.split("\n").pop(), "true");

  recusou("45) movimento não pode ser apagado na unha",
    comoErro(U.rh, `delete from public.fard_movimentos where id='${movEntrega}';`), "não se altera");

  console.log("\n=== 11. Política: vigência e passado intocado ===\n");
  r = como(U.rh, `select public.fard_politica_salvar(('{"peca_id":"${ID.jaleco}","funcao_id":"${ID.funcAcoug}","enxoval_inicial":2,"troca_meses":6,"vigencia_inicio":"2026-01-01"}')::jsonb,'senha-do-master') is not null;`);
  eq("46) política salva com a senha do master", r.saida.split("\n").pop(), "t");
  recusou("47) política sem a senha do master é recusada",
    comoErro(U.rh, `select public.fard_politica_salvar(('{"peca_id":"${ID.jaleco}","troca_meses":3}')::jsonb,'errada');`),
    "senha do master");
  recusou("48) quem não tem a permissão de políticas não mexe",
    comoErro(U.encarregado, `select public.fard_politica_salvar(('{"peca_id":"${ID.jaleco}","troca_meses":3}')::jsonb,'senha-do-master');`),
    "permissão");

  como(U.rh, `select public.fard_politica_salvar(('{"peca_id":"${ID.jaleco}","funcao_id":"${ID.funcAcoug}","enxoval_inicial":2,"troca_meses":12,"vigencia_inicio":"2026-09-01"}')::jsonb,'senha-do-master');`);
  r = como(U.rh, `select public.fard_politica_em('${ID.jaleco}','${ID.setorAcougue}','${ID.funcAcoug}','2026-05-01')->>'troca_meses';`);
  eq("49) em maio vale a regra ANTIGA (6 meses)", r.saida.split("\n").pop(), "6.00");
  r = como(U.rh, `select public.fard_politica_em('${ID.jaleco}','${ID.setorAcougue}','${ID.funcAcoug}','2026-10-01')->>'troca_meses';`);
  eq("50) em outubro vale a regra NOVA (12 meses) — o passado não muda", r.saida.split("\n").pop(), "12.00");
  r = como(U.rh, `select public.fard_politica_em('${ID.calca}','${ID.setorAcougue}','${ID.funcAcoug}','2026-10-01')->>'alcance';`);
  eq("51) peça sem política diz NÃO CONFIGURADO (não devolve zero)", r.saida.split("\n").pop(), "nao_configurado");

  console.log("\n=== 12. Compras: o que está a caminho não é estoque ===\n");
  r = como(U.rh, `select public.fard_pedido_salvar(null,'${rq(50)}',('{"status":"pedido","data_pedido":"2026-09-01","itens":[{"sku_id":"${ID.skuJalecoM}","quantidade":20,"custo_unit":74}]}')::jsonb);`);
  const pedido = r.saida.split("\n").pop();
  r = como(U.rh, `select public.fard_em_pedido('${ID.skuJalecoM}');`);
  eq("52) 20 peças constam como a caminho", r.saida.split("\n").pop(), "20");
  const saldoAntesReceber = como(U.rh, `select public.fard_saldo_sku('${ID.skuJalecoM}');`).saida.split("\n").pop();
  r = como(U.rh, `select public.fard_pedido_receber('${rq(51)}','${pedido}',('{"data":"2026-09-10","itens":[{"sku_id":"${ID.skuJalecoM}","quantidade":12}]}')::jsonb)->>'status';`);
  eq("53) recebimento PARCIAL deixa o pedido em recebido_parcial", r.saida.split("\n").pop(), "recebido_parcial");
  r = como(U.rh, `select public.fard_em_pedido('${ID.skuJalecoM}');`);
  eq("54) sobram 8 a caminho", r.saida.split("\n").pop(), "8");
  r = como(U.rh, `select public.fard_saldo_sku('${ID.skuJalecoM}');`);
  eq("55) só o que CHEGOU entrou no estoque", r.saida.split("\n").pop(), String(Number(saldoAntesReceber) + 12));
  recusou("56) receber mais do que foi pedido é recusado",
    comoErro(U.rh, `select public.fard_pedido_receber('${rq(52)}','${pedido}',('{"itens":[{"sku_id":"${ID.skuJalecoM}","quantidade":99}]}')::jsonb);`),
    "mais do que foi pedido");
  r = como(U.rh, `select public.fard_pedido_receber('${rq(53)}','${pedido}',('{"itens":[{"sku_id":"${ID.skuJalecoM}","quantidade":8}]}')::jsonb)->>'status';`);
  eq("57) chegando o resto, o pedido conclui", r.saida.split("\n").pop(), "concluido");
  r = como(U.rh, `select public.fard_em_pedido('${ID.skuJalecoM}');`);
  eq("58) e não sobra nada a caminho", r.saida.split("\n").pop(), "0");

  console.log("\n=== 13. Inventário ===\n");
  r = como(U.rh, `select public.fard_inv_abrir('${rq(60)}','conferência de setembro');`);
  const inv = r.saida.split("\n").pop();
  eq("59) inventário abre e fotografa os saldos", /^[0-9a-f-]{36}$/.test(inv), true);
  recusou("60) dois inventários abertos ao mesmo tempo: não",
    comoErro(U.rh, `select public.fard_inv_abrir('${rq(61)}','outro');`), "já existe um inventário aberto");

  const saldoSistema = Number(como(U.rh, `select public.fard_saldo_sku('${ID.skuJalecoM}');`).saida.split("\n").pop());
  como(U.rh, `select public.fard_inv_contar('${inv}','${ID.skuJalecoM}', ${saldoSistema - 2});`);
  recusou("61) efetivar ajuste sem a senha do master é recusado",
    comoErro(U.rh, `select public.fard_inv_ajustar('${rq(62)}','${inv}','contagem','errada');`), "senha do master");
  recusou("62) editar o saldo na unha não existe (só ajuste)",
    comoErro(U.rh, `update public.fard_movimentos set quantidade = 999 where sku_id='${ID.skuJalecoM}';`), "não se altera");
  r = como(U.rh, `select public.fard_inv_ajustar('${rq(63)}','${inv}','contagem de setembro','senha-do-master');`);
  contem("63) o ajuste registra 1 diferença", r.saida.split("\n").pop(), '"ajustes": 1');
  contem("64) e PULA o que não foi contado (não zera ninguém)", r.saida.split("\n").pop(), '"nao_contados": 1');
  r = como(U.rh, `select public.fard_saldo_sku('${ID.skuJalecoM}');`);
  eq("65) o estoque passa a bater com a contagem", r.saida.split("\n").pop(), String(saldoSistema - 2));
  r = como(U.rh, `select tipo from public.fard_movimentos where tipo like 'ajuste%' order by criado_em desc limit 1;`);
  eq("66) e a diferença virou um MOVIMENTO, não uma edição", r.saida.split("\n").pop(), "ajuste_neg");

  console.log("\n=== 14. Assinatura da entrega ===\n");
  const entrega = como(U.rh, `select id from public.fard_entregas where pessoa_id='${jonas}' and estornada_em is null order by criado_em desc limit 1;`).saida.split("\n").pop();
  r = como(U.rh, `select assinatura_status from public.fard_entregas where id='${entrega}';`);
  eq("67) entrega nasce com a confirmação PENDENTE", r.saida.split("\n").pop(), "pendente");
  recusou("68) sem desenho, não marca como assinada",
    comoErro(U.rh, `select public.fard_assinar_entrega('${rq(70)}','${entrega}','');`), "assinatura de verdade");
  const desenho = "data:image/png;base64," + "A".repeat(400);
  r = como(U.rh, `select public.fard_assinar_entrega('${rq(71)}','${entrega}','${desenho}')->>'codigo';`);
  const codigo = r.saida.split("\n").pop();
  eq("69) com a assinatura, sai o código", /^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/.test(codigo), true);
  r = como(U.rh, `select public.conferir_assinatura('${codigo}')->>'valido';`);
  eq("70) o código confere", r.saida.split("\n").pop(), "true");
  r = como(U.rh, `select public.conferir_assinatura('${codigo}')->>'atual';`);
  eq("71) e bate com a entrega que está lá hoje", r.saida.split("\n").pop(), "true");
  recusou("72) não assina duas vezes",
    comoErro(U.rh, `select public.fard_assinar_entrega('${rq(72)}','${entrega}','${desenho}');`), "já está assinada");
  // adulterar a entrega tem que quebrar o "atual"
  como(U.rh, `update public.fard_entregas set pessoa_nome_snap='Outro Nome' where id='${entrega}';`);
  r = como(U.rh, `select public.conferir_assinatura('${codigo}')->>'atual';`);
  eq("73) mexer na entrega depois de assinada quebra a conferência", r.saida.split("\n").pop(), "false");
  r = como(U.rh, `select public.conferir_assinatura('${codigo}')->>'valido';`);
  eq("74) mas o código continua sendo legítimo (a prova não some)", r.saida.split("\n").pop(), "true");

  console.log("\n=== 15. Auditoria ===\n");
  r = como(U.rh, `select count(*) > 0 from public.eventos where tipo like 'fardamento.%';`);
  eq("75) todo movimento deixou evento no livro", r.saida.split("\n").pop(), "t");
  r = como(U.rh, `select count(*) > 0 from public.eventos where tipo = 'fardamento.estorno';`);
  eq("76) o estorno também", r.saida.split("\n").pop(), "t");
  r = como(U.rh, `select count(*) > 0 from public.eventos where tipo like 'pessoa.%';`);
  eq("77) e o cadastro de gente", r.saida.split("\n").pop(), "t");
  r = como(U.rh, `select count(*) from jsonb_array_elements(public.fard_auditoria('{}'::jsonb));`);
  eq("78) a auditoria devolve linhas", Number(r.saida.split("\n").pop()) > 0, true);
  recusou("79) encarregado não abre a auditoria da loja",
    comoErro(U.encarregado, `select public.fard_auditoria('{}'::jsonb);`), "loja inteira");

  console.log("\n=== 16. Escopo do encarregado nas leituras ===\n");
  // pra a comparação valer alguma coisa, a Ana (outro setor) precisa existir no
  // consumo. Sem lançamento nenhum ela some das duas listas e o teste mediria nada.
  r = como(U.rh, `select public.fard_entregar('${rq(90)}', ('{"pessoa_id":"${ana}","data":"2026-09-01","itens":[{"sku_id":"${ID.skuCalca42}","quantidade":1,"motivo_id":"'||${motivo("Enxoval inicial")}||'"}]}')::jsonb)->>'itens';`);
  eq("79b) RH entrega pra Ana, da Frente de Loja", r.saida.split("\n").pop(), "1");
  r = como(U.encarregado, `select count(distinct c->>'pessoa_id') from jsonb_array_elements(public.fard_consumo('2026-01-01','2026-12-31',null)) c;`);
  const qtdEnc = Number(r.saida.split("\n").pop());
  r = como(U.rh, `select count(distinct c->>'pessoa_id') from jsonb_array_elements(public.fard_consumo('2026-01-01','2026-12-31',null)) c;`);
  const qtdRh = Number(r.saida.split("\n").pop());
  eq("80) o encarregado enxerga menos gente que o RH (enc=" + qtdEnc + ", rh=" + qtdRh + ")", qtdEnc < qtdRh, true);
  r = como(U.encarregado, `select count(*) from jsonb_array_elements(public.fard_consumo('2026-01-01','2026-12-31',null)) c where c->>'pessoa_nome'='Ana';`);
  eq("81) e Ana (outro setor) não aparece pra ele", r.saida.split("\n").pop(), "0");
  recusou("82) nem a ficha dela abre",
    comoErro(U.encarregado, `select public.fard_ficha('${ana}'::uuid);`), "não é do seu setor");

  console.log("\n=== 17. Dados ausentes ===\n");
  r = como(U.rh, `select (public.fard_pendencias()->'dados_incompletos')->>'pessoas_sem_admissao';`);
  eq("83) o painel sabe quem está sem data de admissão", Number(r.saida.split("\n").pop()) >= 1, true);
  como(U.rh, `select public.fard_entrada('${rq(80)}', ('{"itens":[{"sku_id":"${ID.skuCalca42}","quantidade":3}]}')::jsonb);`);
  r = como(U.rh, `select (e->>'entradas_sem_custo') from jsonb_array_elements(public.fard_estoque_bruto()) e where e->>'peca'='Calça';`);
  eq("84) entrada sem custo é contada como INCOMPLETA", r.saida.split("\n").pop(), "1");
  r = como(U.rh, `select (public.fard_pendencias()->'dados_incompletos')->>'pecas_sem_politica';`);
  eq("85) e sabe quais peças estão sem política", Number(r.saida.split("\n").pop()) >= 1, true);

} catch (e) {
  console.log("\nERRO NA BANCADA: " + e.message);
  falhou++;
} finally {
  B.derrubar(pg);
}

console.log("\n============================================");
console.log("  " + ok + " OK, " + falhou + " FALHA(S)");
console.log("============================================\n");
process.exit(falhou ? 1 : 0);
