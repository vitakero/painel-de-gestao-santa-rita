// A TRAVA DE PREÇO — "preço acima do negociado não pode agendar" (pedido dele, 28/08/2026).
//
// Das três coisas que ele quer barradas, o servidor já barrava duas (produto fora do pedido e
// quantidade acima). Esta é a terceira. E, revisando antes de ligar, apareceu o motivo pelo qual
// ela nasceria morta: o portal manda o preço com um nome e o banco procura outro.
//
//   node scripts/testes/preco-acima.test.cjs
const fs = require("fs");
const path = require("path");
const raiz = path.join(__dirname, "..", "..");
const SQL    = fs.readFileSync(path.join(raiz, "sql", "receb_c38_preco_acima.sql"), "utf8");
const VIVA   = fs.readFileSync(path.join(raiz, "sql", "receb_c32_nota_varios_pedidos.sql"), "utf8");
const PORTAL = fs.readFileSync(path.join(raiz, "scripts", "montar-portal.cjs"), "utf8");
const C31    = fs.readFileSync(path.join(raiz, "sql", "receb_c31_embalagem.sql"), "utf8");

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + obtido + (bate ? "" : "   (esperado: " + esperado + ")"));
  bate ? ok++ : falhou++;
}

console.log("1) OS NOMES DOS CAMPOS BATEM — sem isto a trava não dispara NUNCA");
// O leitor do XML monta os campos no jeito do JavaScript (valorUnit); a função do banco procura
// no jeito do Postgres (valor_unit). Nomes diferentes = campo vazio, e o ramo que compara preço
// exige preço > 0 para disparar. Resultado: nenhuma nota jamais foi acusada de preço acima.
const lidosNoBanco = [...new Set((C31.match(/v_it->>'[a-zA-Z_]+'/g) || []).map(x => x.replace(/^v_it->>'/, "").replace(/'$/, "")))];
eq("   o banco lê valor_unit", lidosNoBanco.includes("valor_unit"), true);
eq("   e lê item_pedido", lidosNoBanco.includes("item_pedido"), true);
eq("   o portal MANDA valor_unit ao servidor", /valor_unit:\s*\(it\.valor_unit/.test(PORTAL), true);
eq("   e manda item_pedido também", /item_pedido:\s*\(it\.item_pedido/.test(PORTAL), true);
eq("   sem tirar os nomes antigos (a tela do portal lê eles)", /Object\.assign\(\{\}, it, \{/.test(PORTAL), true);
// se um campo novo entrar no SQL, esta trava cobra o par no portal
lidosNoBanco.filter(c => c.indexOf("_") > 0).forEach(c => {
  const camel = c.replace(/_([a-z])/g, (m, l) => l.toUpperCase());
  eq("   '" + c + "' tem par no portal (" + camel + ")",
     new RegExp(c + ":\\s*\\(it\\." + c).test(PORTAL) || !new RegExp("\\b" + camel + ":").test(PORTAL), true);
});

console.log("\n2) o SQL nasceu da versão VIVA, sem perder nada dela");
eq("   trouxe o bloco ==VARIOS== junto", /==VARIOS==/.test(SQL), true);
eq("   manteve a trava de produto fora do pedido", /nf_bloqueia_item_fora, true\) and v_fora > 0/.test(SQL), true);
eq("   manteve a trava de quantidade acima", /nf_bloqueia_acima_pedido, true\) and v_acima > 0/.test(SQL), true);
eq("   manteve o registro de barrados", (SQL.match(/receb_anotar_barrado/g) || []).length >= 4, true);
eq("   manteve os grants", /grant execute on function public\.forn_checar_agendamento/.test(SQL), true);
eq("   e a viga R2 (agendar sem nota é permissão)", /pode_sem_nota/.test(SQL), true);
eq("   tem tudo que a viva tinha de regra",
   ["nf_exige_pedido","receb_pedidos_da_nota","forn_conferir_nota"].every(t => SQL.includes(t) === VIVA.includes(t)), true);

console.log("\n3) a regra 6 — SÓ para cima, e com folga configurável");
eq("   o interruptor nasce ligado", /nf_bloqueia_preco_acima boolean not null default true/.test(SQL), true);
eq("   a tolerância nasce em zero", /nf_tolerancia_preco numeric\(12,2\) not null default 0/.test(SQL), true);
eq("   só olha linha marcada como 'preco'", /x->>'situacao' = 'preco'/.test(SQL), true);
eq("   preço MENOR não entra (quem decide é o c31, que só marca 'preco' para cima)",
   /v_vun_c > coalesce\(v_lin\.valor_unit, ?0\) \+ 0\.005/.test(C31), true);
eq("   ignora linha sem os dois preços", /valor_nota'\) is not null and \(x->>'valor_pedido'\) is not null/.test(SQL), true);
eq("   só barra acima da tolerância", /v_dif,0\) > coalesce\(l\.nf_tolerancia_preco, 0\)/.test(SQL), true);
eq("   o laço roda mesmo se só a trava de preço estiver ligada",
   /or coalesce\(l\.nf_bloqueia_preco_acima, true\)\) then/.test(SQL), true);

console.log("\n4) o dinheiro da mensagem sai certo");
// valor_nota já vem convertido pra UNIDADE; qtd_nota continua em CAIXAS. Sem o fator, uma caixa
// de 12 mostra um total 12 vezes menor — e a tolerância em R$ vira R$ 50 × 12 de folga.
eq("   multiplica pelo fator da embalagem", /\* coalesce\(\(x->>'fator'\)::numeric, 1\)/.test(SQL), true);
eq("   e o c31 realmente devolve o fator em cada linha", /'fator',\s+case when v_conv then v_fator else null end/.test(C31), true);
eq("   R$ sai no padrão brasileiro", /translate\(to_char\(v_dif, 'FM999G999G990D00'\), '\.,', ',\.'\)/.test(SQL), true);
eq("   a frase que o fornecedor lê tem acento", /está com preço acima do pedido/.test(SQL), true);

console.log("\n5) a conferência olha o CORPO VIVO, não só as colunas");
eq("   confere que a regra 6 está na função viva", /prosrc like '%R6 \(NOVA%'/.test(SQL), true);
eq("   e que o ==VARIOS== não se perdeu", /prosrc like '%==VARIOS==%'/.test(SQL), true);
eq("   tem como desfazer escrito", /set nf_bloqueia_preco_acima = false/.test(SQL), true);
eq("   e avisa do texto do portal ao afrouxar", /volta a ser mentira/.test(SQL), true);

console.log("\n" + ok + " ok, " + falhou + " falha(s).");
process.exit(falhou ? 1 : 0);
