// UMA NOTA PODE APONTAR MAIS DE UM PEDIDO.
//
// O dono explicou testando, em 22/08/2026: "às vezes tira metade do pedido e a outra
// metade vai em outro pedido, só que foi emitido um XML só — eu teria que selecionar
// dois pedidos". Até então o sistema assumia uma nota → um pedido, e o fornecedor não
// tinha resposta certa: escolhesse qual escolhesse, a outra metade caía em "este item
// não está no pedido" — acusação que BARRA o caminhão.
//
// Medido nas 3.516 notas reais: 70,2% cabem num pedido só, 18,9% precisam de 2, 6,6%
// de 3, 2,4% de 4, 2,0% de 5 ou mais. Quase 1 em 3 encosta em mais de um.
//
// Ele levantou a alternativa certa — pedir ao comprador que consolide. Vale fazer, e
// não conflita: quem monta o pedido é gente da casa, mudar hábito leva meses, e até lá
// o portal não pode quebrar em um terço das entregas.
//
//   node scripts/testes/nota-varios-pedidos.test.cjs
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..", "..");
const SQL = fs.readFileSync(path.join(RAIZ, "sql", "receb_c32_nota_varios_pedidos.sql"), "utf8");
const P = fs.readFileSync(path.join(RAIZ, "output", "agendar.html"), "utf8");
const C26 = fs.readFileSync(path.join(RAIZ, "sql", "receb_c26_barrados.sql"), "utf8");
const C27 = fs.readFileSync(path.join(RAIZ, "sql", "receb_c27_notas_da_receita.sql"), "utf8");

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + obtido + (bate ? "" : "   (esperado: " + esperado + ")"));
  bate ? ok++ : falhou++;
}

console.log("\n=== Uma nota, vários pedidos ===\n");

// ------------------------------------------------------------ partiu do que está no ar
{
  // O erro que a revisão pegou na semana: escrever em cima de versão velha e apagar o
  // que já funcionava. As duas funções vieram das versões mais recentes.
  eq("1) a trava veio do receb_c26 (a versão em produção)",
     SQL.indexOf("receb_anotar_barrado") >= 0 && C26.indexOf("receb_anotar_barrado") >= 0, "true");
  eq("2) e a gravação veio do receb_c27",
     SQL.indexOf("receb_completar_notas") >= 0 && C27.indexOf("receb_completar_notas") >= 0, "true");
  eq("3) o registro de barrados não se perdeu", /perform public\.receb_anotar_barrado/.test(SQL), "true");
}

// ------------------------------------------------------------ a lista
{
  eq("4) existe quem lê a lista de pedidos da nota", /function public\.receb_pedidos_da_nota\(p_nota jsonb\)/.test(SQL), "true");
  eq("5) lê o formato novo (lista)", /jsonb_typeof\(p_nota->'pedidos'\) = 'array'/.test(SQL), "true");
  eq("6) e cai no formato antigo quando a lista não vem", /p_nota->>'pedido'/.test(SQL), "true");
  eq("7) sem repetido", /not \(v_um = any\(v_out\)\)/.test(SQL), "true");
  eq("8) devolve lista vazia, nunca nulo", /v_out text\[\] := '\{\}'/.test(SQL), "true");
}

// ------------------------------------------------------------ a trava mede contra o conjunto
{
  eq("9) a conferência recebe TODOS os pedidos da nota", /v_peds := v_peds_nota;/.test(SQL), "true");
  eq("10) e a exigência de pedido olha a lista",
     /if array_length\(public\.receb_pedidos_da_nota\(n\), 1\) is null then/.test(SQL), "true");
  eq("11) o registro de barrado guarda um pedido de verdade, não o texto juntado",
     /receb_anotar_barrado\(v_forn, v_onde, v_erro, v_peds_nota\[1\]\)/.test(SQL), "true");
  // nenhuma regra de barrar mudou: o conjunto só CRESCE, então o que passava continua passando
  eq("12) não sobrou leitura do pedido único na trava",
     /v_peds := array\[v_ped_nota\]/.test(SQL), "false");
}

// ------------------------------------------------------------ a gravação guarda tudo
{
  eq("13) a coluna da lista é criada", /add column if not exists pedidos_numeros text\[\]/.test(SQL), "true");
  eq("14) pedido_numero continua com o primeiro (quem já lia de lá não quebra)",
     /set pedido_numero  = left\(v_peds_nota\[1\], 40\)/.test(SQL), "true");
  eq("15) e a lista inteira fica ao lado", /pedidos_numeros = v_peds_nota/.test(SQL), "true");
  eq("16) cada pedido vira uma linha na agenda", /foreach v_ped_nota in array v_peds_nota loop/.test(SQL), "true");
}

// ------------------------------------------------------------ a tela manda a lista
{
  eq("17) o vínculo virou lista", /function temVinc\(n\)\{ return !!\(n && n\.vinc && n\.vinc\.length\); \}/.test(P), "true");
  eq("18) manda a lista pro servidor", /pedidos:vincLista\(n\),/.test(P), "true");
  eq("19) e continua mandando o primeiro no campo antigo", /pedido:\(vincLista\(n\)\[0\]\|\|null\),/.test(P), "true");
  eq("20) a janela LIGA e DESLIGA em vez de escolher um",
     /if\(k>=0\) l\.splice\(k,1\); else l\.push\(num\);/.test(P), "true");
  eq("21) e só fecha quando ele diz que terminou", /el\("vpPronto"\)\.onclick=function\(\)\{/.test(P), "true");
  eq("22) mostrando o que já está marcado", /Marcados: pedidos /.test(P), "true");
}

// ------------------------------------------------------------ desmarcar tira só um
{
  // com vários vínculos, desmarcar um pedido não pode soltar a nota inteira
  eq("23) desmarcar um pedido tira só ele da lista", /vq\.splice\(kq,1\);/.test(P), "true");
  eq("24) e a conferência agrupa pelo CONJUNTO de pedidos",
     /var v=vs\.slice\(\)\.sort\(\)\.join\("\|"\);/.test(P), "true");
  eq("25) mandando o conjunto inteiro pra conferir", /p_pedidos:g\.pedidos/.test(P), "true");
}

// ------------------------------------------------------------ a ordem de publicação
{
  // tela nova + SQL velho = servidor lê só o primeiro e barra a outra metade
  eq("26) o arquivo avisa que a ordem importa", SQL.indexOf("SQL primeiro, tela depois") >= 0, "true");
  eq("27) e diz por quê, sem enfeitar", SQL.indexOf("eu quase escrevi aqui que era") >= 0, "true");
}

console.log("\n" + (falhou ? "FALHOU: " + falhou + " de " + (ok + falhou) : "TUDO OK: " + ok + " testes") + "\n");
process.exit(falhou ? 1 : 0);
