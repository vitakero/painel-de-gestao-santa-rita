// A RÉGUA DO CONSUMO: pedir só o que a tela mostra, e só quando ela abrir.
//
// Por que este teste existe (26/08/2026): o painel estava em 3,20 GB de 5 GB de franquia
// mensal do Supabase. A tela da Central sozinha pedia select("*") em central_conferencias
// e baixava as 600 conferências INTEIRAS a cada clique em "Central" no menu — 3,3 MB por
// vez, dos quais 94% era um campo que a lista nem desenha. Com ~1.800 aberturas no mês,
// isso dava ~5,9 GB: mais que o plano inteiro.
//
// Este teste não deixa o problema voltar sem alguém perceber:
//   1) toda leitura nova com select("*") tem que ser DECLARADA aqui, com o motivo;
//   2) nenhuma pergunta repetida ao banco pode ser mais rápida que 1 minuto.
//
//   node scripts/testes/regua-consumo.test.cjs
const fs = require("fs");
const path = require("path");
const HTML = fs.readFileSync(path.join(__dirname, "..", "..", "output", "index.html"), "utf8");

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + obtido + (bate ? "" : "   (esperado: " + esperado + ")"));
  bate ? ok++ : falhou++;
}

// ---------------------------------------------------------------------------
// 1) QUEM AINDA PODE PEDIR TUDO — e por quê. Medido em 26/08/2026.
// ---------------------------------------------------------------------------
const PODE_PEDIR_TUDO = {
  pontos_extras:          "tabela minúscula (1 linha, ~1 KB) — enxugar não pagaria a mexida",
  manutencao_registros:   "tabela minúscula (~1 KB)",
  manutencao_equipamentos:"tabela minúscula (17 linhas, ~6 KB)",
  flv_fechamentos:        "conferido: as 15 colunas da linha são TODAS desenhadas na tela",
  galpoes:                "tabela minúscula (<5 KB) e a tela usa quase toda coluna",
  lixeira:                "REPROVADO por risco: enxugar quebrava o botão Restaurar, que passaria a APAGAR DE VEZ",
  despesas_resumo:        "REPROVADO por risco: o recorte proposto colocava número errado na tela",
  pix_cobrancas:          "REPROVADO: a prova de que as colunas eram mortas errou em três delas",
  pedidos:                "REPROVADO por risco no recorte; as colunas em si estão certas",
};
const achados = [...new Set((HTML.match(/from\("([a-z_]+)"\)\.select\("\*"\)/g) || [])
  .map(x => (x.match(/from\("([a-z_]+)"\)/) || [])[1]))].sort();

const novos = achados.filter(t => !PODE_PEDIR_TUDO[t]);
eq("nenhuma leitura NOVA pedindo tudo", novos.length ? novos.join(", ") : "nenhuma", "nenhuma");
if (novos.length) {
  console.log("        ^ se a leitura nova for legítima, declare-a em PODE_PEDIR_TUDO com o motivo;");
  console.log("          se não for, peça só as colunas que a tela desenha.");
}
// o contrário também: entrada declarada que já não existe mais é lixo no teste
const sumiram = Object.keys(PODE_PEDIR_TUDO).filter(t => achados.indexOf(t) < 0);
eq("nenhuma declaração sobrando na lista", sumiram.length ? sumiram.join(", ") : "nenhuma", "nenhuma");

// ---------------------------------------------------------------------------
// 2) AS TELAS QUE JÁ FORAM ENXUGADAS NÃO PODEM VOLTAR ATRÁS
// ---------------------------------------------------------------------------
const ENXUGADAS = [
  ["central_conferencias", /from\("central_conferencias"\)\.select\(CL_CONF_COLS\)/],
  ["central_agendamentos", /from\("central_agendamentos"\)\.select\("id,loja,data,hi,hf,fornecedor,situacao,pedido"\)/],
  ["vendasetor_mes",       /from\("vendasetor_mes"\)\.select\("ano,mes,setor,quantidade,completo"\)/],
  ["entregas_competencia", /from\("entregas_competencia"\)\.select\("status,fechado_em/],
  ["flv_equipe",           /from\("flv_equipe"\)\.select\("id,nome,ativo"\)/],
  ["flv_config",           /from\("flv_config"\)\.select\("meta_pct,fator_premio"\)/],
  ["despesas_teto",        /from\("despesas_teto"\)\.select\("categoria,valor"\)/],
  ["agenda_eventos",       /from\("agenda_eventos"\)\.select\(AG_COLS\)/],
  ["banco_horas",          /from\("banco_horas"\)\.select\("pis,nome,cargo/],
  ["cartaz_historico",     /from\("cartaz_historico"\)\.select\("id,modelo,tamanho/],
  ["recibos_autorizacoes", /from\("recibos_autorizacoes"\)\.select\("id,status,pedido_por/],
];
ENXUGADAS.forEach(([nome, re]) => eq(nome + " continua enxugada", re.test(HTML), true));

// o campo pesado das Entregas não pode voltar a viajar
eq("entregas_competencia NÃO pede o 'detalhe'", /entregas_competencia"\)\.select\("[^"]*detalhe/.test(HTML), false);
// nem a assinatura do cartaz
eq("cartaz_historico NÃO pede a assinatura", /cartaz_historico"\)\.select\("[^"]*assinatura/.test(HTML), false);

// ---------------------------------------------------------------------------
// 3) A HORA: nada carrega antes de alguém abrir a tela
// ---------------------------------------------------------------------------
eq("a conferência NÃO carrega no clique do menu", /renderCentral\(\); \}\s*\n\s*clConfLoad\(\);/.test(HTML), false);
eq("a conferência carrega ao abrir a ABA", /clView==="conf"\)\{ if\(vc\)vc\.style\.display=""; clConfLoad\(\);/.test(HTML), true);
eq("Entregas NÃO carrega no login", /if\(typeof entCloudLoad==="function"\) entCloudLoad\(\);/.test(HTML), false);
eq("Entregas guarda o que já leu", /if\(!forcar && entQuando/.test(HTML), true);
eq("Venda por setor guarda o que já leu", /if\(!forcar && vsQuando/.test(HTML), true);
eq("a Central guarda o que já leu", /if\(!forcar && clConfQuando/.test(HTML), true);

// ---------------------------------------------------------------------------
// 4) NENHUMA PERGUNTA REPETIDA MAIS RÁPIDA QUE 1 MINUTO
//    A tela de espera perguntava "já me liberaram?" a cada 30 segundos: 120 perguntas por
//    hora, ~800 KB numa aba esquecida aberta o dia todo, sem ninguém usar nada.
// ---------------------------------------------------------------------------
const intervalos = [...HTML.matchAll(/setInterval\([\s\S]{0,400}?\},\s*(\d+)\)/g)]
  .map(m => ({ ms: +m[1], trecho: m[0] }))
  .filter(x => /\.from\(|SB\.|\.rpc\(/.test(x.trecho));
const rapidos = intervalos.filter(x => x.ms < 60000);
eq("nenhuma pergunta ao banco abaixo de 1 min", rapidos.length ? rapidos.map(x => x.ms + "ms").join(", ") : "nenhuma", "nenhuma");
eq("a tela de espera pergunta de 2 em 2 min", /aprovado,is_master[\s\S]{0,220}\},120000\)/.test(HTML), true);

console.log("\n" + ok + " ok, " + falhou + " falha(s).");
process.exit(falhou ? 1 : 0);
