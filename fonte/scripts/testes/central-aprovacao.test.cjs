// CENTRAL DE APROVACAO DE AGENDAMENTOS — teste de interface E de comportamento.
//
// Por que este teste roda um NAVEGADOR DE VERDADE:
// esta foi uma refatoracao de INTERFACE sobre uma area que ja funcionava. O risco
// inteiro dela nao e "ficou feio" — e ter quebrado, sem barulho, o clique que aprova.
// Conferir marcacao no fonte nao prova que o clique chega em clDecidir; so clicando.
//
// Entao aqui o Chrome abre a previa (previa-aprovacao.cjs, que monta a tela com o CSS
// INTEIRO do painel e as FUNCOES REAIS extraidas do output/index.html), clica em tudo,
// mede a altura de cada linha em quatro larguras, e devolve o resultado no DOM.
//
// Duas armadilhas que ja me pegaram e que este arquivo evita:
//   · medir pela tela do editor em vez de medir de verdade — o Chrome headless nao
//     abre janela abaixo de ~500px, entao 430px vira 500px e a "foto de celular" e
//     um recorte mentiroso. Aqui a largura mais estreita testada e 520.
//   · previa infiel — se o CSS ou as funcoes nao vierem do painel gerado, o teste
//     aprova uma tela que nao existe. O gerador para sozinho se isso acontecer.
//
//   node scripts/testes/central-aprovacao.test.cjs
const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const RAIZ = path.join(__dirname, "..", "..");
const H = fs.readFileSync(path.join(RAIZ, "output", "index.html"), "utf8");
// O TEMA ESCURO VEM ANTES NO ARQUIVO.
// Ele e GERADO a partir do CSS claro no build, entao toda regra existe duas vezes — e a
// primeira que aparece e a escura. Procurar ".cl-ap-sim{" no arquivo inteiro devolvia a
// versao escura e o teste reprovava a cor certa. Aqui o tema escuro sai da busca de cor.
const CLARO = H.replace(/<style id="temaEscuroCss">[\s\S]*?<\/style>/, "");
// Corpo de funcao por contagem de chaves, e nao por "os proximos N caracteres":
// clApDetalhe tem mais de 3000 caracteres, e o recorte por tamanho cortava no meio.
function corpo(nome) {
  const i = H.indexOf("function " + nome + "(");
  if (i < 0) return "";
  let n = 0;
  for (let k = H.indexOf("{", i); k < H.length; k++) {
    if (H[k] === "{") n++; else if (H[k] === "}") { n--; if (!n) return H.slice(i, k + 1); }
  }
  return "";
}
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let ok = 0, ruim = 0;
function t(nome, cond, extra) {
  if (cond) { ok++; return; }
  ruim++; console.log("FALHOU: " + nome + (extra ? "  -> " + extra : ""));
}

// ============================================ 1) O QUE O DONO PEDIU, NA MARCACAO
t("1) título da seção", H.indexOf("Agendamentos aguardando aprovação") > 0);
t("2) contador em badge ao lado do título", H.indexOf('id="clApQt"') > 0);
t("3) campo de busca", H.indexOf('id="clApBusca"') > 0);
t("4) os quatro filtros existem",
   ['"todos","Todos"', '"hoje","Hoje"', '"amanha","Amanhã"', '"atrasados","Atrasados"']
     .every(function (x) { return H.indexOf(x) > 0; }));
// Filtro so pode existir sobre dado que ja vem na consulta: as quatro faixas saem
// de p.data, e a busca de fornecedor/pedido/CNPJ. Nada de campo inventado.
t("5) as faixas saem da data que já vem na consulta",
   /function clApFaixa\(p, hoje, amanha\)/.test(H));
t("6) e a busca não pede nada novo ao banco",
   /return pend\.filter\(/.test(corpo("clApFiltra")) && corpo("clApFiltra").indexOf(".from(") < 0);

// ============================================ 2) SITUACAO: AMBAR, NUNCA VERDE
// Verde no painel quer dizer "positivo, resolvido". Aguardando e o oposto disso.
const sitAg = CLARO.match(/\.cl-ap-sit\.aguardando\{[^}]*\}/);
t("7) existe a situação aguardando", !!sitAg);
t("8) e ela é âmbar", !!sitAg && /#fdf6e3/.test(sitAg[0]) && /#8a5a12/.test(sitAg[0]));
t("9) e não é verde", !!sitAg && !/#157a35|#0c5a26|#1b8f45/.test(sitAg[0]));
t("10) atrasado tem situação própria", /\.cl-ap-sit\.atrasado\{[^}]*#8c2f28/.test(CLARO));
// Nenhum estado inventado: so os que a logica atual produz nesta lista.
t("11) nenhuma situação inventada",
   !/cl-ap-sit\.(confirmado|concluido|recebimento|recusado)\b/.test(H));

// ============================================ 3) HIERARQUIA DOS BOTOES
const sim = CLARO.match(/\.cl-ap-sim\{[^}]*\}/), nao = CLARO.match(/\.cl-ap-nao\{[^}]*\}/);
t("12) Aprovar é verde sólido", !!sim && /background:#157a35/.test(sim[0]) && /color:#fff/.test(sim[0]));
t("13) Recusar é branco com vermelho discreto",
   !!nao && /background:#fff/.test(nao[0]) && /color:#b03024/.test(nao[0]));
t("14) e os dois não têm o mesmo peso",
   !!sim && !!nao && /font-weight:600/.test(nao[0]));

// ============================================ 4) HANDLERS PRESERVADOS
// A refatoracao nao pode ter trocado quem decide.
t("15) Aprovar continua chamando clDecidir",
   /clDecidir\(s\.getAttribute\("data-psim"\),"aprovado"\)/.test(H));
t("16) Recusar continua chamando clDecidir",
   /clDecidir\(n\.getAttribute\("data-pnao"\),"recusado"\)/.test(H));
t("17) as notas continuam chamando clVerNotas",
   /clVerNotas\(nf\.getAttribute\("data-clnf"\)\)/.test(H));
t("18) a permissão continua sendo clPodeDecidir", /var pode=clPodeDecidir\(\);/.test(H));
t("19) data vencida continua sem botão de aprovar",
   /\(atrasado\?'':'<button type="button" class="cl-ap-sim" data-psim=/.test(H));

// ============================================ 5) NADA DE INFORMACAO PERDIDA
// Tudo que aparecia antes tem que aparecer na lista OU na gaveta.
const GAVETA = corpo("clApDetalhe");
["Razão social","CNPJ","Telefone","Pedido","Transportadora","Data","Horário",
 "Tempo de doca","Situação","Volumes","Peso","Tipo de volume","Tipo de carga",
 "Descarga prevista","Veículo","Placa","Motorista","Telefone do motorista",
 "Observações"].forEach(function (campo, i) {
  t("20." + (i + 1) + ") a gaveta tem " + campo, GAVETA.indexOf(campo) > 0);
});
t("21) a gaveta só mostra o que já foi carregado",
   GAVETA.indexOf('bg.classList.add("show")') > 0 &&
   GAVETA.indexOf(".from(") < 0 && GAVETA.indexOf("window.__SB") < 0);

// ============================================ 6) DESEMPENHO
t("22) o casco não é refeito a cada chegada de dado",
   /var casco=document\.getElementById\("clApCasco"\);\s*\n\s*if\(!casco\) box\.innerHTML=clApCascoHtml\(\);/.test(H));
t("23) a contagem troca por textContent, não por innerHTML",
   /qt\.textContent=String\(pend\.length\)/.test(H));
t("24) a busca espera a digitação parar", /setTimeout\(function\(\)\{ clApTmr=null; clApRedesenha\(\); \},120\)/.test(H));

// ============================================ 7) O NAVEGADOR DE VERDADE
if (!fs.existsSync(CHROME)) {
  console.log("\n(sem Chrome nesta máquina — a parte de navegador não rodou)");
} else {
  cp.execSync("QTD=30 node " + JSON.stringify(path.join(RAIZ, "scripts", "previa-aprovacao.cjs")),
              { cwd: RAIZ, stdio: "pipe" });
  const arq = path.join(RAIZ, ".previa", "previa-aprovacao.html");

  // 520 é a janela mais estreita que o Chrome headless honra de verdade. Abaixo disso
  // ele devolve 500 e a medida vira ficção — por isso o teste para aqui.
  const LARGURAS = [1440, 1100, 820, 520];
  LARGURAS.forEach(function (L) {
    const dom = cp.execSync(
      JSON.stringify(CHROME) + " --headless=new --disable-gpu --window-size=" + L +
      ",900 --virtual-time-budget=3000 --dump-dom " + JSON.stringify(arq) + " 2>/dev/null",
      { maxBuffer: 64 * 1024 * 1024, encoding: "utf8", shell: "/bin/bash" });

    const med = (dom.match(/MEDIDA=(\{[^<]*\})/) || [])[1];
    const prv = (dom.match(/PROVA=(\{[^<]*\})/) || [])[1];
    if (!med || !prv) { t(L + "px) a página se mediu", false, "sem MEDIDA/PROVA no DOM"); return; }
    const m = JSON.parse(med), p = JSON.parse(prv);

    t(L + "px) desenhou as 30 solicitações", m.linhas === 30, "veio " + m.linhas);
    t(L + "px) sem rolagem horizontal", m.paginaRolaLado === false);
    if (L >= 800) {
      // 100-140px foi o alvo pedido. Acima de 800px de largura ele vale para TODAS.
      t(L + "px) toda linha entre 90 e 140px",
        m.acima140 === 0 && m.abaixo90 === 0, "max " + m.max + " min " + m.min);
      t(L + "px) a lista rola por dentro", m.listaRolaDentro === true);
      t(L + "px) três colunas", /^\d+px \d/.test(m.colunas), m.colunas);
    } else {
      t(L + "px) empilha numa coluna só", /^\d+(\.\d+)?px$/.test(m.colunas), m.colunas);
    }
    t(L + "px) o selo de transportadora não estica", m.transpEstica === "n/a");

    // comportamento — o que nao pode ter quebrado
    t(L + "px) filtro Atrasados só traz atrasados", p.soAtrasadas === true);
    t(L + "px) e nenhum deles oferece Aprovar", p.atrasadoSemAprovar === true);
    t(L + "px) filtro marca o botão escolhido", p.botaoMarcado === true);
    t(L + "px) as contas dos filtros fecham",
      p.filtroAtrasados + p.filtroHoje <= p.todos && p.voltouTodos === p.todos);
    t(L + "px) busca por número do pedido", p.buscaPedido === 1, "veio " + p.buscaPedido);
    t(L + "px) busca por nome com acento", p.buscaNomeAcento > 0);
    t(L + "px) busca por CNPJ pontuado", p.buscaCnpjPontuado > 0);
    t(L + "px) sem resultado, explica em vez de sumir", p.buscaSemResultado === 0 && p.explicaVazio === true);
    t(L + "px) 'ver todos' devolve a lista", p.zerouEVoltou === p.todos && p.campoLimpou === true);
    // esta e a razao de o casco existir: digitar nao pode roubar o proprio campo
    t(L + "px) digitar não perde o foco", p.focoFicou === true && p.cascoEhOmesmo === true);
    t(L + "px) a gaveta abre e fecha", p.gavetaAbriu === true && p.gavetaFechou === true);
    t(L + "px) a gaveta traz o que saiu da lista",
      p.gavetaTemCnpj && p.gavetaTemMotorista && p.gavetaTemTelMotorista &&
      p.gavetaTemPeso && p.gavetaTemNota);
    t(L + "px) a gaveta também decide", p.gavetaTemPe === true);
    t(L + "px) APROVAR chega no handler", p.aprovarChamou === true);
    t(L + "px) RECUSAR chega no handler", p.recusarChamou === true);
    t(L + "px) as notas chegam no handler", p.notasChamou === true);
  });
}

console.log(ruim ? "\n" + ruim + " FALHA(S) de " + (ok + ruim) : "\nTUDO OK: " + ok + " testes");
