// FARDO NÃO É UNIDADE — as travas da conversão.
//
// O dono pegou em 22/08/2026: vinculou a nota ao pedido e o portal acusou 14 de 16 itens
// com "o preço da nota está acima do preço do pedido". Era falso — a nota cobra por FARDO
// (FD20 = 20 unidades, R$ 59,00) e o pedido guarda preço por UNIDADE (R$ 2,95). O sistema
// comparava 59,00 com 2,95. É comparar o preço da dúzia com o preço do ovo.
//
// A correção converte antes de comparar. Este teste guarda as REGRAS e as TRAVAS, porque
// cada uma delas foi paga com medição:
//
//   - "solto/peso = fator 1": sem ela, 198 itens em 17.924 que batiam passavam a divergir
//   - "o dicionário do VR manda": ele acertou dois casos onde o NOME do produto enganaria
//   - "não sei = não converto": um quarto dos itens usa embalagem sem número (CX, PCT)
//   - as duas travas de não-piorar: a mudança tem que ser monotônica
//
// Medido no histórico: coincidência de 39,6% -> 59,2%, zero itens piorando.
//
//   node scripts/testes/fator-embalagem.test.cjs
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..", "..");
const SQL = fs.readFileSync(path.join(RAIZ, "sql", "receb_c31_embalagem.sql"), "utf8");
const PORTAL = fs.readFileSync(path.join(RAIZ, "output", "agendar.html"), "utf8");

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + obtido + (bate ? "" : "   (esperado: " + esperado + ")"));
  bate ? ok++ : falhou++;
}

console.log("\n=== Fardo não é unidade ===\n");

// ------------------------------------------------------------ a ordem das fontes
{
  const iPeso = SQL.indexOf("(a) peso e volume");
  const iSolto = SQL.indexOf("(b) a nota diz que veio solto");
  const iDic = SQL.indexOf("(c) o dicionário do VR");
  const iNum = SQL.indexOf("(d) o número colado na unidade");
  eq("1) peso e o solto vêm ANTES do dicionário", iPeso > 0 && iSolto > iPeso && iDic > iSolto, "true");
  eq("2) e o dicionário vem antes do número no nome", iDic > 0 && iNum > iDic, "true");
  // esta ordem não é estética: o dicionário guarda o tamanho da CAIXA mesmo quando a
  // venda foi de unidade solta. Consultá-lo primeiro estragaria 198 itens medidos.
}

// ------------------------------------------------------------ "não sei" não é "1"
{
  eq("3) sem resposta devolve NULL, não 1", /return null;\s*-- não há como saber/.test(SQL), "true");
  eq("4) e quem chama trata NULL como 'não converta'", /v_fator is not null and v_fator > 1/.test(SQL), "true");
}

// ------------------------------------------------------------ só pode tirar aviso
{
  // A garantia não é argumento, é aritmética: só se converte quando o preço CRU já
  // estava acusando, e dividir por fator > 1 só faz o preço BAIXAR.
  eq("5) só converte quando o preço cru JÁ estava acusando",
     /if v_achou then\s*\n\s*if v_vun > coalesce\(v_lin\.valor_unit, 0\) \+ 0\.005/.test(SQL), "true");
  // v_lin é record: lido fora do "if v_achou", o plpgsql derruba a nota INTEIRA com
  // 'record "v_lin" is not assigned yet' — e só às vezes, porque o plano fica em cache
  // por conexão. Acontece justo com o item sem código de barras, o produtor local.
  eq("5b) e nenhuma leitura de v_lin fica solta fora do 'if v_achou'",
     /if v_achou\s*\n?\s*and[^\n]*v_lin\./.test(SQL), "false");
  eq("6) e só com fator maior que 1", /if v_fator is not null and v_fator > 1 then/.test(SQL), "true");
  eq("7) a decisão NÃO olha o saldo", /A decisão NÃO olha o saldo de propósito/.test(SQL), "true");
  // a 1a versão olhava o saldo, e aí a MESMA nota dava veredito diferente conforme a
  // ordem dos itens no XML — ordem que quem escolhe é o sistema do fornecedor
}

// ------------------------------------------------------------ o que NÃO pode ter mudado
{
  // quantidade, baixa no saldo e tudo que BARRA ficam exatamente como hoje
  eq("8) a quantidade continua crua na comparação", /elsif v_qtd > v_saldo then/.test(SQL), "true");
  eq("9) e nenhuma baixa usa quantidade convertida", SQL.indexOf("v_qtd_c") >= 0, "false");
  eq("10) o preço comparado é o convertido", /elsif v_vun_c > coalesce\(v_lin\.valor_unit, 0\)/.test(SQL), "true");
  // ==> este arquivo NÃO conserta a baixa errada da quantidade. Isso é de propósito e
  //     está anotado: mexer nela é mexer no que para caminhão.
}

// ------------------------------------------------------------ não apaga o dicionário
{
  // O ERRO QUE A REVISÃO PEGOU: a 1a versão foi escrita em cima do receb_c28, e como
  // "create or replace" troca o corpo inteiro, rodá-la APAGARIA o casamento pelo
  // dicionário do c29 — o que derrubou o ponto cego de 23,2% para 0,1%. Item de
  // produtor local sem código de barras voltaria a não casar, e parte deles BARRARIA.
  eq("11) o casamento pelo dicionário continua inteiro", /-- 3\) o dicionario do VR/.test(SQL), "true");
  eq("12) com o produto_vr sendo procurado", /and i\.produto_vr = v_prod_vr/.test(SQL), "true");
  eq("13) e a contagem do ganho continua indo pra tela", SQL.indexOf("'pelo_dicionario', v_pelo_dic") >= 0, "true");
  eq("14) o dicionário também conta como 'tinha como casar'",
     /v_tinha_como := \(v_seq is not null\) or \(v_ean is not null\) or \(v_prod_vr is not null\);/.test(SQL), "true");
}

// ------------------------------------------------------------ segurança, do jeito da casa
{
  // A revisão pegou: a função recebe um CNPJ como parâmetro e lê tabela protegida por
  // RLS. Liberada para 'authenticated', um fornecedor perguntaria pelo CNPJ do
  // concorrente. Ela não precisa de grant: forn_conferir_nota é definer e a alcança.
  eq("15) a função do fator é fechada até para quem está logado",
     /revoke all on function public\.receb_fator_embalagem\(text, text, text\) from public, anon, authenticated;/.test(SQL), "true");
  eq("16) e não tem grant nenhum pra ela", /grant[^\n]*receb_fator_embalagem/.test(SQL), "false");
  eq("17) com o caminho de busca preso", (SQL.match(/set search_path = public/g) || []).length, 2);
  // sem código não consulta o dicionário: 52 fornecedores têm linha de código '0' com
  // embalagem > 1, e nota sem cProd chega de verdade (vr-sync-notas devolve nulo)
  eq("18) sem código, nem tenta o dicionário", /if v_cod is not null then/.test(SQL), "true");
  // e o "ou" dos dígitos só vale entre códigos que são SÓ número: tirar não-dígitos
  // apagaria LETRA, e 'A16' pegaria a embalagem de outro produto do mesmo fornecedor
  eq("19) zero à esquerda só reconcilia entre códigos numéricos",
     /v_dig := case when v_cod ~ '\^\[0-9\]\+\$' then/.test(SQL), "true");
  eq("19b) dos dois lados da comparação",
     /and c\.codigo_fornecedor ~ '\^\[0-9\]\+\$'/.test(SQL), "true");
}

// ------------------------------------------------------------ a tela mostra a conta
{
  eq("20) o portal escreve a conversão por extenso",
     PORTAL.indexOf("A nota cobra por ") >= 0, "true");
  eq("21) mostrando a divisão do preço",
     PORTAL.indexOf("' ÷ '+esc(numero(x.fator))+' = <b>'") >= 0, "true");
  // a quantidade NÃO é convertida por este arquivo, então a tela não pode falar dela
  eq("22) a tela não fala em converter quantidade",
     PORTAL.indexOf("' × '+esc(numero(x.fator))+") >= 0, "false");
  eq("23) só quando houve conversão de verdade",
     /if\(x\.convertido && x\.fator\)\{/.test(PORTAL), "true");
  // o servidor precisa mandar as peças da conta, senão a tela não tem o que escrever
  ["'convertido'", "'fator'", "'valor_original'"].forEach(function (c, i) {
    eq((24 + i) + ") o servidor devolve " + c, SQL.indexOf(c) >= 0, "true");
  });
}

// ------------------------------------------------------------ o arquivo se confere sozinho
{
  eq("27) o SQL termina conferindo a si mesmo", SQL.indexOf("ME AVISE") >= 0, "true");
  eq("28) a regra do FD20 é testada sem depender do dicionário",
     SQL.indexOf("receb_fator_embalagem('00000000000000','ZZZXX','FD20') = 20") >= 0, "true");
  // o caso real do dono MOSTRA o número em vez de julgar: quem responde ali é o
  // dicionário, e o robô re-sincroniza o dicionário sozinho
  eq("28b) e o caso real do dono aparece mostrando, não julgando",
     SQL.indexOf("receb_fator_embalagem('20947638000141','18','FD20')::text") >= 0, "true");
  eq("28c) nenhum sentinela de teste tem dígito dentro",
     /receb_fator_embalagem\('00000000000000','[A-Z]*[0-9]/.test(SQL), "false");
  eq("29) e o caso que mais pode estragar (peso nunca converte)",
     SQL.indexOf("'KG') = 1") >= 0, "true");
}

console.log("\n" + (falhou ? "FALHOU: " + falhou + " de " + (ok + falhou) : "TUDO OK: " + ok + " testes") + "\n");
process.exit(falhou ? 1 : 0);
