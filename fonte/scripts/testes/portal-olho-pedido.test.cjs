// O OLHO da lista de Pedidos, no portal do fornecedor.
//
// Defeito que o dono pegou testando em 22/08/2026: clicou no olho do pedido 23102 e
// apareceu "O detalhe do pedido abre quando o sistema da loja liberar os dados."
//
// A frase era MENTIRA. Os 16 itens do pedido já estavam no banco (receb_pedido_itens),
// a função que os devolve já existia e já conferia o dono (forn_pedido_itens), e a tela
// que os desenha também já existia — verItensDoPedido, usada quando o fornecedor vincula
// o pedido durante o agendamento. Faltava só o olho apontar pra ela; ele mostrava um
// recado enlatado.
//
// Pior que não funcionar: culpava a loja por uma coisa que estava pronta, e o fornecedor
// ficaria esperando para sempre uma liberação que nunca viria.
//
//   node scripts/testes/portal-olho-pedido.test.cjs
const fs = require("fs");
const path = require("path");

const HTML = fs.readFileSync(path.join(__dirname, "..", "..", "output", "agendar.html"), "utf8");

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + obtido + (bate ? "" : "   (esperado: " + esperado + ")"));
  bate ? ok++ : falhou++;
}

console.log("\n=== Portal — o olho do pedido ===\n");

// ------------------------------------------------------------ o recado enlatado morreu
{
  eq("1) sumiu a frase que culpava a loja",
     HTML.indexOf("abre quando o sistema da loja liberar") >= 0, "false");
  // qualquer variação do mesmo enrolo também não pode voltar
  eq("2) e nenhum outro 'quando a loja liberar' no lugar",
     /liberar os dados|quando a loja liberar/.test(HTML), "false");
}

// ------------------------------------------------------------ o olho aponta pra tela certa
{
  eq("3) o olho chama a tela de itens",
     HTML.indexOf('verItensDoPedido(ped.getAttribute("data-pedido"))') >= 0, "true");
  eq("4) a tela de itens existe",
     (HTML.match(/function verItensDoPedido\(id\)\{/g) || []).length, 1);
  eq("5) ela pede os itens ao banco",
     HTML.indexOf('SB.rpc("forn_pedido_itens"') >= 0, "true");
  // o botão continua sendo desenhado na lista
  eq("6) a lista de pedidos ainda desenha o olho",
     HTML.indexOf('<button class="olho" data-pedido=') >= 0, "true");
}

// ------------------------------------------------------------ o que a tela mostra
{
  // pedido x entregue x falta — é o que interessa pra quem vai carregar o caminhão
  // O título mudou em 22/08 junto com a janela nova: virou "Detalhes do pedido", porque
  // agora ela mostra o pedido inteiro (número, datas, valores), não só o que falta.
  ["Detalhes do pedido", "Produto", "Pedido", "Entregue", "Falta"].forEach(function (t, i) {
    eq((7 + i) + ") a tela mostra \"" + t + "\"", HTML.indexOf(t) >= 0, "true");
  });
}

// ------------------------------------------------------------ janela de altura fixa
{
  // O dono pegou em 22/08: num pedido de 16 itens a janela crescia até passar da tela e
  // o último item ficava inalcançável. Agora a janela tem teto e a lista rola DENTRO.
  eq("12) a janela tem altura de teto",
     HTML.indexOf(".mcaixa.alto{max-height:calc(100vh - 52px);display:flex;flex-direction:column}") >= 0, "true");
  eq("13) a lista é a única parte que estica e rola",
     HTML.indexOf(".mcaixa.alto > .rola{flex:1 1 auto;min-height:0;overflow:auto}") >= 0, "true");
  eq("14) o resto (cabeçalho e rodapé) fica parado",
     HTML.indexOf(".mcaixa.alto > *{flex:0 0 auto}") >= 0, "true");
  eq("15) a janela do pedido pede a altura fixa",
     HTML.indexOf('uiModal({titulo:"Detalhes do pedido", cru:true, tam:"alto"') >= 0, "true");
}

// ------------------------------------------------------------ o cabeçalho diz QUAL pedido
{
  // Antes a janela só dizia "O que falta neste pedido" — abrindo dois seguidos, a pessoa
  // se perdia. O número, a emissão e a previsão já vinham na lista; faltava guardá-los.
  eq("16) guarda a ficha do pedido quando a lista chega",
     (HTML.match(/function guardarPedidos\(l\)/g) || []).length, 1);
  eq("17) guarda nos DOIS lugares que carregam pedidos (página e assistente)",
     (HTML.match(/guardarPedidos\(/g) || []).length, 3);   // 1 definição + 2 chamadas
  ["Pedido \"+p.numero", "Emissão", "Previsão de entrega", "Itens a entregar"].forEach(function (t, i) {
    eq((18 + i) + ") o cabeçalho mostra \"" + t + "\"", HTML.indexOf(t) >= 0, "true");
  });
}

// ------------------------------------------------------------ valor e rodapé
{
  eq("22) mostra o valor unitário combinado", HTML.indexOf('<th class="n">Valor un.</th>') >= 0, "true");
  eq("23) e quanto vale o que falta de cada linha", HTML.indexOf('<th class="n">A entregar</th>') >= 0, "true");
  // o rodapé soma só o que FALTA — pedido de 51 itens com 3 pendentes é entrega de 3
  eq("24) o rodapé só conta item com saldo", HTML.indexOf("if(sk>0){ nFalta++; vFalta+=sk*vk; }") >= 0, "true");
  eq("25) o rodapé é fixo, fora da área que rola", HTML.indexOf('.mpe{border-top:1px solid var(--borda)') >= 0, "true");
}

// ------------------------------------------------------------ e continua trancada
{
  // pedido de outro fornecedor não pode abrir: quem confere é o BANCO, não a tela
  eq("26) erro do banco vira aviso, não tela em branco",
     HTML.indexOf('uiAviso("Não consegui abrir"') >= 0, "true");
}

console.log("\n" + (falhou ? "FALHOU: " + falhou + " de " + (ok + falhou) : "TUDO OK: " + ok + " testes") + "\n");
process.exit(falhou ? 1 : 0);
