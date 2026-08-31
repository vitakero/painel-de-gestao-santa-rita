// PAINEL NO CELULAR — a barra lateral vira GAVETA (Etapa G1).
//
// O dono decidiu em 31/08/2026, depois da inspeção mobile: "no celular o menu lateral
// vira uma gaveta; barra de navegação inferior NÃO; no computador o menu continua
// exatamente como está".
//
// O que a inspeção mediu e este teste protege:
//
//   1) `.sidebar { width:210px }` valia em QUALQUER tela. Num celular de 390px o menu
//      comia 210 e o main comia mais 64 de margem: sobravam 76px para a página inteira.
//      A Agenda ficava com coluna de 2px por dia e o Mês com célula de 15px.
//   2) O painel inteiro rolava de lado — Vendas em 1011px, Recibos 582, Entregas 469.
//      Não era defeito da Agenda: era do layout.
//   3) A correção é SÓ de apresentação. A lista de páginas continua sendo a mesma <nav>,
//      com as mesmas permissões — nenhum menu novo é montado em lugar nenhum.
//
// E o que este teste CONGELA: acima do ponto de corte, nada muda. Nenhuma regra da
// gaveta pode existir fora de uma media query.
//
//   node scripts/testes/mobile-gaveta.test.cjs
const fs = require("fs");
const path = require("path");
const RAIZ = path.join(__dirname, "..", "..");
const H = fs.readFileSync(path.join(RAIZ, "output", "index.html"), "utf8");

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + obtido + (bate ? "" : "   (esperado: " + esperado + ")"));
  bate ? ok++ : falhou++;
}
console.log("\n=== Painel no celular: a barra lateral vira gaveta ===\n");

// o bloco da gaveta, para conferir que nada dele escapou da media query
const MQ = (H.match(/@media \(max-width:760px\)\{[\s\S]*?\n  \}/) || [""])[0];

// ------------------------------------------------------------- o COMPUTADOR é congelado
{
  eq("1) a barra lateral continua 210px, grudada, como sempre",
     /\.sidebar \{ width:210px; flex:none; padding:0; position:sticky; top:57px;/.test(H), "true");
  eq("1b) e o main continua com as margens de sempre",
     /main \{ flex:1 1 auto; min-width:0; max-width:1340px; margin:0 auto; padding:22px 32px 60px; \}/.test(H), "true");
  eq("2) o botão da gaveta nasce ESCONDIDO",
     /\.btn-gaveta \{ display:none; \}/.test(H), "true");
  eq("2b) o fundo escuro também",
     /\.gaveta-fundo \{ display:none; \}/.test(H), "true");
  // a trava principal: NADA da gaveta pode valer no computador
  eq("2c) nenhuma regra da gaveta existe fora de media query",
     /\n  (\.sidebar \{ position:fixed|body\.gaveta-aberta|\.btn-gaveta \{ display:inline-flex)/.test(H), "false");
  eq("2d) e a media query existe, com o ponto de corte combinado",
     /@media \(max-width:760px\)\{/.test(H), "true");
}

// ------------------------------------------------------------------------ o CELULAR
{
  eq("3) no celular a barra sai do fluxo — fechada, não ocupa largura nenhuma",
     /\.sidebar \{ position:fixed; left:0; top:57px; bottom:0; height:auto; width:min\(284px, 86vw\);/.test(MQ), "true");
  eq("3b) e fica fora da tela até ser chamada",
     /transform:translateX\(-101%\); transition:transform \.22s ease; \}/.test(MQ), "true");
  eq("3c) abrindo, ela entra", /body\.gaveta-aberta \.sidebar \{ transform:translateX\(0\); \}/.test(MQ), "true");
  eq("4) o botão ☰ só aparece no celular",
     /\.btn-gaveta \{ display:inline-flex;/.test(MQ), "true");
  eq("5) com alvo de toque de 44x44",
     /\.btn-gaveta \{[^}]*width:44px; height:44px;/.test(MQ), "true");
  eq("6) o fundo escuro aparece junto com ela",
     /body\.gaveta-aberta \.gaveta-fundo \{ display:block; position:fixed;/.test(MQ), "true");
  eq("10) e o que está atrás não rola junto",
     /body\.gaveta-aberta \{ overflow:hidden; \}/.test(MQ), "true");
  eq("12) o conteúdo passa a usar a largura toda",
     /main \{ padding:14px 12px 40px; max-width:none; \}/.test(MQ), "true");
  eq("13) com margem de celular, não colada na borda",
     /padding:14px 12px 40px/.test(MQ), "true");
  eq("13b) quem não quer animação não recebe animação",
     /@media \(prefers-reduced-motion: reduce\)\{ \.sidebar \{ transition:none; \} \}/.test(H), "true");
}

// -------------------------------------------------------------- abrir, fechar, e só isso
{
  eq("6b) tocar no ☰ abre e fecha",
     /bt\.addEventListener\("click", function\(e\)\{ e\.stopPropagation\(\); mostra\(!aberta\(\)\); \}\);/.test(H), "true");
  eq("7) tocar no fundo escuro fecha",
     /fundo\.addEventListener\("click", function\(\)\{ mostra\(false\); \}\);/.test(H), "true");
  eq("8) escolher uma página fecha",
     /var b=e\.target\.closest\("\.nav-item"\);\s*\n\s*if\(b && !b\.classList\.contains\("nav-locked"\)\) mostra\(false\);/.test(H), "true");
  // pagina trancada mostra aviso: fechar a gaveta deixaria o aviso órfão no meio da tela
  eq("8b) mas página bloqueada NÃO fecha, senão o aviso aparece do nada",
     /!b\.classList\.contains\("nav-locked"\)/.test(H), "true");
  eq("9) Esc fecha",
     /document\.addEventListener\("keydown", function\(e\)\{ if\(e\.key==="Escape" && aberta\(\)\) mostra\(false\); \}\);/.test(H), "true");
  eq("9b) e virar pro computador com ela aberta não trava a tela",
     /window\.addEventListener\("resize", function\(\)\{ if\(window\.innerWidth>760 && aberta\(\)\) mostra\(false\); \}\);/.test(H), "true");
  eq("5b) quem usa leitor de tela sabe o que o botão faz",
     /aria-label="Abrir o menu"[\s\S]{0,80}aria-expanded="false" aria-controls="navPrincipal"/.test(H), "true");
  eq("5c) e sabe quando ela está aberta",
     /bt\.setAttribute\("aria-expanded", v\?"true":"false"\);/.test(H), "true");
}

// ------------------------------------------- PERMISSÃO: nada mudou, e nem podia mudar
{
  eq("11) existe UMA lista de navegação só — a de sempre, com um id",
     /<nav class="sidebar" id="navPrincipal">/.test(H), "true");
  eq("11b) a gaveta não monta lista de página nenhuma",
     /gavetaFundo[\s\S]{0,2000}nav-item[^\n]*createElement|montaMenu|construirMenu/.test(H), "false");
  eq("11c) e não encosta em quem decide o acesso",
     /(mostra|aberta)\([^)]*\)[\s\S]{0,200}(podePagina|pode_pagina|nav-locked\s*=)/.test(H), "false");
  eq("11d) podePagina continua sendo quem manda", /function podePagina\(/.test(H), "true");
  eq("16) nenhum SQL, RPC ou permissão foi tocado nesta etapa",
     /gaveta[\s\S]{0,400}(sb\.rpc|from\("perfis"\)|grant |create policy)/i.test(H), "false");
}

// ---------------------------------------- a AGENDA não foi mexida (G2 é outra conversa)
{
  eq("14) o Mês aprovado continua igual",
     /#agDias\.cal-grid \{ grid-auto-rows: var\(--ag-lin\); border:1px solid #e4e9ef; border-radius:10px; overflow:hidden; \}/.test(H), "true");
  eq("14b) com a altura elástica de sempre",
     /--ag-lin: max\(72px, calc\(\(100dvh - 318px\) \/ 6\)\)/.test(H), "true");
  eq("15) a Semana continua com 7 dias — G2 NÃO foi feita",
     /var AG_SEM_DIAS=7;/.test(H), "true");
  eq("15b) e a escala de 44px por hora está intacta",
     /var AG_SEM_PXH=44;/.test(H) && /--ag-h:44px/.test(H), "true");
  eq("15c) nenhuma regra de 3\/5\/7 dias foi criada",
     /--ag-dias: *3|AG_SEM_DIAS *= *3|AG_SEM_DIAS *= *5/.test(H), "false");
  eq("15d) e a gaveta não escreve nada dentro da Agenda",
     /@media \(max-width:760px\)\{[\s\S]*?\n  \}/.test(H) && /\.ag-cel|\.ag-sem-cel|#agDias/.test(MQ), "false");
}

console.log("\n" + (falhou ? "FALHOU: " + falhou + " de " + (ok + falhou) : "TUDO OK: " + ok + " testes") + "\n");
process.exit(falhou ? 1 : 0);
