// Prévia do módulo Fardamento — MOSTRA A TELA sem tocar em produção.
//
// Não é maquete: extrai do painel já gerado o CÓDIGO REAL do módulo (a seção
// HTML, o CSS e o JS inteiro) e roda contra um Supabase de mentira que devolve
// dados de exemplo. O que aparece aqui é exatamente o que vai aparecer no
// painel quando o SQL estiver instalado.
//
//   node scripts/previa-fardamento.cjs
//   -> .previa/previa-fardamento.html
const fs = require("fs");
const path = require("path");
const RAIZ = path.join(__dirname, "..");
const H = fs.readFileSync(path.join(RAIZ, "output", "index.html"), "utf8");

function entre(txt, ini, fim, oque) {
  const a = txt.indexOf(ini), b = txt.indexOf(fim, a + 1);
  if (a < 0 || b < 0) { console.log("ERRO: não achei " + oque); process.exit(1); }
  return txt.slice(a, b);
}

const secao  = entre(H, '<section id="page-fardamento" class="page">', '</section>', "a seção do fardamento") + "</section>";
const modulo = entre(H, "/* ===== Controle de Fardamento =====", "/* ===== Layout da loja (planta + planograma) ===== */", "o módulo JS");
const cssModal = entre(H, "  /* ---- Fardamento: janelas do módulo", "  .card { background:#fff;", "o CSS das janelas");

// ---- dados de exemplo (INVENTADOS, e a tela diz isso) ----------------------
const ID = (n) => "00000000-0000-0000-0000-" + String(n).padStart(12, "0");
const SET = { acougue:ID(1), padaria:ID(2), frente:ID(3), reposicao:ID(4) };
const FUN = { acougueiro:ID(11), padeiro:ID(12), caixa:ID(13), repositor:ID(14) };
const PE  = { jaleco:ID(21), camisa:ID(22), calca:ID(23), avental:ID(24), touca:ID(25) };
const SK  = { jalecoM:ID(31), jalecoG:ID(32), camisaM:ID(33), camisaG:ID(34), calca42:ID(35), avental:ID(36), touca:ID(37) };
const MO  = { enxoval:ID(41), prevista:ID(42), empresa:ID(43), setor:ID(44), tamanho:ID(45),
              defeito:ID(46), correcao:ID(47), adequacao:ID(48), rasgou:ID(49), perdeu:ID(50),
              manchou:ID(51), excepcional:ID(52) };
const PES = { jonas:ID(61), marcos:ID(62), cleide:ID(63), ana:ID(64), elias:ID(65), novato:ID(66) };

const hoje = "2026-09-03";
const motivos = [
  {id:MO.enxoval,     nome:"Enxoval inicial",                classificacao:"normal",         entra_no_indice:false, exige_justificativa:false, ativo:true, ordem:10},
  {id:MO.prevista,    nome:"Troca prevista",                 classificacao:"normal",         entra_no_indice:true,  exige_justificativa:false, ativo:true, ordem:20},
  {id:MO.empresa,     nome:"Troca determinada pela empresa", classificacao:"normal",         entra_no_indice:false, exige_justificativa:false, ativo:true, ordem:30},
  {id:MO.setor,       nome:"Mudança de setor ou função",     classificacao:"neutro",         entra_no_indice:false, exige_justificativa:false, ativo:true, ordem:40},
  {id:MO.tamanho,     nome:"Alteração de tamanho",           classificacao:"neutro",         entra_no_indice:false, exige_justificativa:false, ativo:true, ordem:50},
  {id:MO.defeito,     nome:"Defeito de fábrica",             classificacao:"neutro",         entra_no_indice:false, exige_justificativa:true,  ativo:true, ordem:60},
  {id:MO.correcao,    nome:"Correção de entrega anterior",   classificacao:"neutro",         entra_no_indice:false, exige_justificativa:true,  ativo:true, ordem:70},
  {id:MO.adequacao,   nome:"Adequação de fardamento",        classificacao:"neutro",         entra_no_indice:false, exige_justificativa:false, ativo:true, ordem:80},
  {id:MO.rasgou,      nome:"Rasgou",                         classificacao:"extraordinario", entra_no_indice:true,  exige_justificativa:true,  ativo:true, ordem:90},
  {id:MO.perdeu,      nome:"Perdeu",                         classificacao:"extraordinario", entra_no_indice:true,  exige_justificativa:true,  ativo:true, ordem:100},
  {id:MO.manchou,     nome:"Manchou ou danificou",           classificacao:"extraordinario", entra_no_indice:true,  exige_justificativa:true,  ativo:true, ordem:110},
  {id:MO.excepcional, nome:"Reposição excepcional",          classificacao:"extraordinario", entra_no_indice:true,  exige_justificativa:true,  ativo:true, ordem:120}
];
const mot = (id) => motivos.filter(m => m.id === id)[0];
const linhaMotivo = (id, q) => ({ motivo_id:id, motivo:mot(id).nome, classificacao:mot(id).classificacao,
                                  entra_no_indice:mot(id).entra_no_indice, quantidade:q });

const bootstrap = {
  permissao:{ ve_tudo:true, pode_custo:true, pode_politica:true, pode_pessoas:true, meu_setor:null, master:true },
  reguas:{ indice_atencao:null, indice_fora:null, extraordinarias_atencao:null,
           extraordinarias_fora:null, inventario_periodicidade_meses:null, historico_minimo_meses:null },
  setores:[ {id:SET.acougue,nome:"Açougue",ativo:true,ordem:1}, {id:SET.padaria,nome:"Padaria",ativo:true,ordem:2},
            {id:SET.frente,nome:"Frente de Loja",ativo:true,ordem:3}, {id:SET.reposicao,nome:"Reposição",ativo:true,ordem:4} ],
  funcoes:[ {id:FUN.acougueiro,nome:"Açougueiro",setor_id:SET.acougue,ativo:true},
            {id:FUN.padeiro,nome:"Padeiro",setor_id:SET.padaria,ativo:true},
            {id:FUN.caixa,nome:"Caixa",setor_id:SET.frente,ativo:true},
            {id:FUN.repositor,nome:"Repositor",setor_id:SET.reposicao,ativo:true} ],
  pessoas:[
    {id:PES.jonas,  nome:"Jonas R. Alves",    situacao:"ativo", setor_id:SET.acougue,   funcao_id:FUN.acougueiro, admissao:"2024-03-12", desligamento:null, jornada:"integral"},
    {id:PES.marcos, nome:"Marcos V. Pereira", situacao:"ativo", setor_id:SET.reposicao, funcao_id:FUN.repositor,  admissao:"2025-01-20", desligamento:null, jornada:"integral"},
    {id:PES.cleide, nome:"Cleide S. Marques", situacao:"ativo", setor_id:SET.padaria,   funcao_id:FUN.padeiro,    admissao:"2023-08-01", desligamento:null, jornada:"integral"},
    {id:PES.ana,    nome:"Ana Paula Nunes",   situacao:"ativo", setor_id:SET.frente,    funcao_id:FUN.caixa,      admissao:"2025-06-02", desligamento:null, jornada:"meio_periodo"},
    {id:PES.elias,  nome:"Elias M. Fontes",   situacao:"ferias",setor_id:SET.reposicao, funcao_id:FUN.repositor,  admissao:"2022-11-10", desligamento:null, jornada:"integral"},
    {id:PES.novato, nome:"Diego A. Ramos",    situacao:"ativo", setor_id:SET.acougue,   funcao_id:FUN.acougueiro, admissao:null,         desligamento:null, jornada:null}
  ],
  pecas:[
    {id:PE.jaleco, nome:"Jaleco branco",       unidade:"unidade", exige_tamanho:true,  exige_devolucao:null, ativo:true, ordem:1},
    {id:PE.camisa, nome:"Camisa polo",         unidade:"unidade", exige_tamanho:true,  exige_devolucao:null, ativo:true, ordem:2},
    {id:PE.calca,  nome:"Calça brim",          unidade:"unidade", exige_tamanho:true,  exige_devolucao:null, ativo:true, ordem:3},
    {id:PE.avental,nome:"Avental impermeável", unidade:"unidade", exige_tamanho:false, exige_devolucao:null, ativo:true, ordem:4},
    {id:PE.touca,  nome:"Touca",               unidade:"unidade", exige_tamanho:false, exige_devolucao:null, ativo:true, ordem:5}
  ],
  skus:[
    {id:SK.jalecoM, peca_id:PE.jaleco, tamanho:"M",  ativo:true, minimo:6,  seguranca:2,    cobertura_meses:2},
    {id:SK.jalecoG, peca_id:PE.jaleco, tamanho:"G",  ativo:true, minimo:4,  seguranca:null, cobertura_meses:null},
    {id:SK.camisaM, peca_id:PE.camisa, tamanho:"M",  ativo:true, minimo:10, seguranca:2,    cobertura_meses:2},
    {id:SK.camisaG, peca_id:PE.camisa, tamanho:"G",  ativo:true, minimo:8,  seguranca:null, cobertura_meses:null},
    {id:SK.calca42, peca_id:PE.calca,  tamanho:"42", ativo:true, minimo:6,  seguranca:null, cobertura_meses:null},
    {id:SK.avental, peca_id:PE.avental,tamanho:null, ativo:true, minimo:8,  seguranca:null, cobertura_meses:null},
    {id:SK.touca,   peca_id:PE.touca,  tamanho:null, ativo:true, minimo:null,seguranca:null,cobertura_meses:null}
  ],
  motivos:motivos,
  politicas:[
    {id:ID(71), peca_id:PE.jaleco,  setor_id:null, funcao_id:FUN.acougueiro, enxoval_inicial:2, troca_meses:6,  proporcional_ativo:true,  exige_devolucao:true,  vigencia_inicio:"2026-01-01", vigencia_fim:null},
    {id:ID(72), peca_id:PE.avental, setor_id:null, funcao_id:FUN.acougueiro, enxoval_inicial:2, troca_meses:4,  proporcional_ativo:null,  exige_devolucao:false, vigencia_inicio:"2026-01-01", vigencia_fim:null},
    {id:ID(73), peca_id:PE.camisa,  setor_id:null, funcao_id:FUN.repositor,  enxoval_inicial:3, troca_meses:6,  proporcional_ativo:true,  exige_devolucao:true,  vigencia_inicio:"2026-01-01", vigencia_fim:null},
    {id:ID(74), peca_id:PE.jaleco,  setor_id:null, funcao_id:FUN.padeiro,    enxoval_inicial:2, troca_meses:6,  proporcional_ativo:null,  exige_devolucao:null,  vigencia_inicio:"2026-01-01", vigencia_fim:null},
    {id:ID(75), peca_id:PE.camisa,  setor_id:SET.frente, funcao_id:null,     enxoval_inicial:3, troca_meses:12, proporcional_ativo:null,  exige_devolucao:null,  vigencia_inicio:"2026-01-01", vigencia_fim:null},
    {id:ID(76), peca_id:PE.jaleco,  setor_id:null, funcao_id:FUN.acougueiro, enxoval_inicial:2, troca_meses:4,  proporcional_ativo:true,  exige_devolucao:true,  vigencia_inicio:"2025-01-01", vigencia_fim:"2025-12-31"}
  ],
  kits:[ {id:ID(81), nome:"Enxoval do açougue", funcao_id:FUN.acougueiro, setor_id:null, ativo:true,
          itens:[{peca_id:PE.jaleco,quantidade:2},{peca_id:PE.avental,quantidade:2},{peca_id:PE.touca,quantidade:3}]} ],
  tamanhos:[ {pessoa_id:PES.jonas,peca_id:PE.jaleco,tamanho:"M"}, {pessoa_id:PES.jonas,peca_id:PE.calca,tamanho:"42"},
             {pessoa_id:PES.marcos,peca_id:PE.camisa,tamanho:"G"}, {pessoa_id:PES.cleide,peca_id:PE.jaleco,tamanho:"M"} ],
  fornecedores:[ {id:ID(91), nome:"Confecções Caicó", documento:null, contato:"Sr. Aldo", telefone:"84 99999-0000", email:null, prazo_dias:15, situacao:"ativo", observacao:null},
                 {id:ID(92), nome:"Uniformes RN",     documento:null, contato:null,       telefone:null,           email:null, prazo_dias:null, situacao:"ativo", observacao:null} ]
};

const pol = (pecaId, funcaoId) => {
  const p = bootstrap.politicas.filter(x => x.peca_id === pecaId && x.funcao_id === funcaoId && !x.vigencia_fim)[0]
         || bootstrap.politicas.filter(x => x.peca_id === pecaId && !x.funcao_id && !x.vigencia_fim)[0];
  return p ? { politica_id:p.id, alcance:p.funcao_id ? "funcao" : "setor", enxoval_inicial:p.enxoval_inicial,
               troca_meses:p.troca_meses, proporcional_ativo:p.proporcional_ativo, exige_devolucao:p.exige_devolucao }
           : { politica_id:null, alcance:"nao_configurado", enxoval_inicial:null, troca_meses:null,
               proporcional_ativo:null, exige_devolucao:null };
};
const P = (pes, peca, pecaNome, funcao, dias_ativos, ultima, posse, motivosLinha) => ({
  pessoa_id:pes.id, pessoa_nome:pes.nome, situacao:pes.situacao, admissao:pes.admissao,
  desligamento:pes.desligamento, jornada:pes.jornada, setor_id:pes.setor_id, funcao_id:pes.funcao_id,
  peca_id:peca, peca:pecaNome, dias_ativos:dias_ativos, dias_periodo:365,
  politica:pol(peca, funcao), ultima_entrega:ultima, em_posse:posse, motivos:motivosLinha
});
const p = (id) => bootstrap.pessoas.filter(x => x.id === id)[0];

const consumo = [
  P(p(PES.jonas), PE.jaleco, "Jaleco branco", FUN.acougueiro, 350, "2026-08-17", 2,
    [linhaMotivo(MO.enxoval,2), linhaMotivo(MO.prevista,1), linhaMotivo(MO.rasgou,5)]),
  P(p(PES.jonas), PE.avental, "Avental impermeável", FUN.acougueiro, 350, "2026-07-21", 1,
    [linhaMotivo(MO.enxoval,2), linhaMotivo(MO.prevista,2)]),
  P(p(PES.marcos), PE.camisa, "Camisa polo", FUN.repositor, 365, "2026-08-26", 3,
    [linhaMotivo(MO.enxoval,3), linhaMotivo(MO.prevista,1), linhaMotivo(MO.perdeu,4), linhaMotivo(MO.tamanho,1)]),
  P(p(PES.cleide), PE.jaleco, "Jaleco branco", FUN.padeiro, 365, "2026-08-27", 2,
    [linhaMotivo(MO.enxoval,2), linhaMotivo(MO.prevista,2), linhaMotivo(MO.manchou,3)]),
  P(p(PES.ana), PE.camisa, "Camisa polo", FUN.caixa, 94, "2026-06-05", 3,
    [linhaMotivo(MO.enxoval,3)]),
  P(p(PES.elias), PE.camisa, "Camisa polo", FUN.repositor, null, "2025-09-10", 3, []),
  P(p(PES.novato), PE.jaleco, "Jaleco branco", FUN.acougueiro, null, "2026-08-30", 2,
    [linhaMotivo(MO.enxoval,2)])
];

const meses = (base) => { const o = {}; const d = new Date("2026-09-01");
  for (let i = 12; i >= 1; i--) { const x = new Date(d.getFullYear(), d.getMonth() - i, 1);
    o[x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0")] = Math.max(0, base + (i % 3) - 1); } return o; };

const estoque = [
  {sku_id:SK.camisaM, peca_id:PE.camisa, peca:"Camisa polo", tamanho:"M", unidade:"unidade", ativo:true,
   minimo:10, seguranca:2, cobertura_meses:2, saldo:4, em_pedido:0, primeiro_movimento:"2025-09-01",
   saidas_mes:meses(3), extraordinarias_12m:4, custo_medio:38.00, entradas_sem_custo:0},
  {sku_id:SK.calca42, peca_id:PE.calca, peca:"Calça brim", tamanho:"42", unidade:"unidade", ativo:true,
   minimo:6, seguranca:null, cobertura_meses:null, saldo:2, em_pedido:12, primeiro_movimento:"2025-09-01",
   saidas_mes:meses(2), extraordinarias_12m:2, custo_medio:62.00, entradas_sem_custo:0},
  {sku_id:SK.jalecoM, peca_id:PE.jaleco, peca:"Jaleco branco", tamanho:"M", unidade:"unidade", ativo:true,
   minimo:6, seguranca:2, cobertura_meses:2, saldo:5, em_pedido:0, primeiro_movimento:"2025-09-01",
   saidas_mes:meses(2), extraordinarias_12m:8, custo_medio:74.00, entradas_sem_custo:1},
  {sku_id:SK.jalecoG, peca_id:PE.jaleco, peca:"Jaleco branco", tamanho:"G", unidade:"unidade", ativo:true,
   minimo:4, seguranca:null, cobertura_meses:null, saldo:0, em_pedido:0, primeiro_movimento:"2026-06-01",
   saidas_mes:{"2026-07":1,"2026-08":1}, extraordinarias_12m:0, custo_medio:74.00, entradas_sem_custo:0},
  {sku_id:SK.camisaG, peca_id:PE.camisa, peca:"Camisa polo", tamanho:"G", unidade:"unidade", ativo:true,
   minimo:8, seguranca:null, cobertura_meses:null, saldo:11, em_pedido:0, primeiro_movimento:"2025-09-01",
   saidas_mes:meses(2), extraordinarias_12m:1, custo_medio:38.00, entradas_sem_custo:0},
  {sku_id:SK.avental, peca_id:PE.avental, peca:"Avental impermeável", tamanho:null, unidade:"unidade", ativo:true,
   minimo:8, seguranca:null, cobertura_meses:null, saldo:14, em_pedido:0, primeiro_movimento:"2025-09-01",
   saidas_mes:meses(2), extraordinarias_12m:0, custo_medio:null, entradas_sem_custo:3},
  {sku_id:SK.touca, peca_id:PE.touca, peca:"Touca", tamanho:null, unidade:"unidade", ativo:true,
   minimo:null, seguranca:null, cobertura_meses:null, saldo:60, em_pedido:0, primeiro_movimento:"2025-09-01",
   saidas_mes:meses(11), extraordinarias_12m:0, custo_medio:9.00, entradas_sem_custo:0}
];

const mv = [];
let nm = 0;
const add = (o) => { mv.push(Object.assign({ id:ID(200 + (nm++)), delta_posse:0, justificativa:null,
  observacao:null, documento:null, lote:null, entrega_id:null, pedido_id:null, fornecedor:null,
  estorno_de:null, estornado:false, por:"Márcia (RH)" }, o)); };
add({tipo:"entrega", data:"2026-08-30", peca:"Jaleco branco", tamanho:"M", quantidade:2, delta_estoque:-2, delta_posse:2, pessoa_id:PES.novato, pessoa:"Diego A. Ramos", setor_id:SET.acougue, motivo:"Enxoval inicial", classificacao:"normal", custo_unit:74});
add({tipo:"entrega", data:"2026-08-27", peca:"Jaleco branco", tamanho:"M", quantidade:1, delta_estoque:-1, delta_posse:1, pessoa_id:PES.cleide, pessoa:"Cleide S. Marques", setor_id:SET.padaria, motivo:"Manchou ou danificou", classificacao:"extraordinario", justificativa:"mancha de gordura que não saiu", custo_unit:74});
add({tipo:"entrega", data:"2026-08-26", peca:"Camisa polo", tamanho:"G", quantidade:1, delta_estoque:-1, delta_posse:1, pessoa_id:PES.marcos, pessoa:"Marcos V. Pereira", setor_id:SET.reposicao, motivo:"Perdeu", classificacao:"extraordinario", justificativa:"disse que sumiu do armário", custo_unit:38});
add({tipo:"entrega", data:"2026-08-17", peca:"Jaleco branco", tamanho:"M", quantidade:1, delta_estoque:-1, delta_posse:1, pessoa_id:PES.jonas, pessoa:"Jonas R. Alves", setor_id:SET.acougue, motivo:"Rasgou", classificacao:"extraordinario", justificativa:"rasgou na serra fita", custo_unit:74});
add({tipo:"entrega", data:"2026-08-13", peca:"Jaleco branco", tamanho:"M", quantidade:1, delta_estoque:-1, delta_posse:1, pessoa_id:PES.jonas, pessoa:"Jonas R. Alves", setor_id:SET.acougue, motivo:"Rasgou", classificacao:"extraordinario", justificativa:"prendeu no gancho", custo_unit:74});
add({tipo:"entrada", data:"2026-08-05", peca:"Camisa polo", tamanho:"M", quantidade:12, delta_estoque:12, pessoa_id:null, pessoa:null, setor_id:null, motivo:null, classificacao:null, custo_unit:38, fornecedor:"Confecções Caicó", documento:"NF 4471"});
add({tipo:"entrega", data:"2026-08-03", peca:"Jaleco branco", tamanho:"M", quantidade:1, delta_estoque:-1, delta_posse:1, pessoa_id:PES.jonas, pessoa:"Jonas R. Alves", setor_id:SET.acougue, motivo:"Rasgou", classificacao:"extraordinario", justificativa:"rasgou no ombro", custo_unit:74});
add({tipo:"ajuste_neg", data:"2026-07-31", peca:"Avental impermeável", tamanho:null, quantidade:2, delta_estoque:-2, pessoa_id:null, pessoa:null, setor_id:null, motivo:null, observacao:"Inventário: conferência de julho", classificacao:null, custo_unit:null});
add({tipo:"devolucao_reutil", data:"2026-07-20", peca:"Camisa polo", tamanho:"G", quantidade:1, delta_estoque:1, delta_posse:-1, pessoa_id:PES.elias, pessoa:"Elias M. Fontes", setor_id:SET.reposicao, motivo:null, observacao:"trocou de tamanho, peça em bom estado", classificacao:null, custo_unit:null});
add({tipo:"entrada", data:"2026-06-02", peca:"Avental impermeável", tamanho:null, quantidade:6, delta_estoque:6, pessoa_id:null, pessoa:null, setor_id:null, motivo:null, classificacao:null, custo_unit:null, fornecedor:"Uniformes RN"});

const ficha = {
  pessoa:{ id:PES.jonas, nome:"Jonas R. Alves", situacao:"ativo", admissao:"2024-03-12", desligamento:null,
           jornada:"integral", setor:"Açougue", setor_id:SET.acougue, funcao:"Açougueiro", funcao_id:FUN.acougueiro, observacao:null },
  posse:[ {sku_id:SK.jalecoM, peca:"Jaleco branco", tamanho:"M", quantidade:2, ultima_em:"2026-08-17"},
          {sku_id:SK.avental, peca:"Avental impermeável", tamanho:null, quantidade:1, ultima_em:"2026-07-21"} ],
  tamanhos:[ {peca_id:PE.jaleco, tamanho:"M"}, {peca_id:PE.calca, tamanho:"42"} ],
  historico_funcional:[ {campo:"situacao", de:null, para:"ativo", em:"2024-03-12", motivo:"cadastro inicial"},
                        {campo:"setor", de:"Frente de Loja", para:"Açougue", em:"2025-02-01", motivo:"transferência"} ],
  entregas:[
    {entrega_id:ID(301), data:"2026-08-17", assinatura:"assinada", codigo:"A31F-77B2-0C4D-91EE", estornada:false,
     setor:"Açougue", funcao:"Açougueiro", entregue_por:"Márcia (RH)",
     itens:[{movimento_id:ID(201), peca:"Jaleco branco", tamanho:"M", quantidade:1, motivo:"Rasgou", classificacao:"extraordinario", justificativa:"rasgou na serra fita", estornado:false, custo_unit:74}]},
    {entrega_id:ID(302), data:"2026-08-13", assinatura:"pendente", codigo:null, estornada:false,
     setor:"Açougue", funcao:"Açougueiro", entregue_por:"Cícero (encarregado)",
     itens:[{movimento_id:ID(202), peca:"Jaleco branco", tamanho:"M", quantidade:1, motivo:"Rasgou", classificacao:"extraordinario", justificativa:"prendeu no gancho", estornado:false, custo_unit:74}]},
    {entrega_id:ID(303), data:"2026-03-12", assinatura:"assinada", codigo:"5C90-2E11-AA47-30B8", estornada:false,
     setor:"Açougue", funcao:"Açougueiro", entregue_por:"Márcia (RH)",
     itens:[{movimento_id:ID(203), peca:"Jaleco branco", tamanho:"M", quantidade:2, motivo:"Enxoval inicial", classificacao:"normal", justificativa:null, estornado:false, custo_unit:74},
            {movimento_id:ID(204), peca:"Avental impermeável", tamanho:null, quantidade:2, motivo:"Enxoval inicial", classificacao:"normal", justificativa:null, estornado:false, custo_unit:45}]}
  ],
  devolucoes:[]
};

const RESPOSTAS = {
  fard_bootstrap: bootstrap,
  fard_consumo: consumo,
  fard_estoque_bruto: estoque,
  fard_movimentos_listar: mv,
  fard_ficha: ficha,
  fard_pendencias: {
    assinaturas_pendentes:[ {entrega_id:ID(302), pessoa:"Jonas R. Alves", pessoa_id:PES.jonas, data:"2026-08-13"} ],
    pedidos_abertos:[ {pedido_id:ID(401), status:"pedido", fornecedor:"Confecções Caicó", data_pedido:"2026-08-20", data_prevista:"2026-09-04", em_aberto:12} ],
    inventario:{ ultimo:"2026-07-31", aberto:null },
    dados_incompletos:{ pessoas_sem_setor:0, pessoas_sem_funcao:0, pessoas_sem_admissao:1,
                        pecas_sem_politica:2, skus_sem_minimo:1, entradas_sem_custo:3, entradas_sem_fornecedor:1 }
  },
  fard_qualidade: {
    por_peca:[ {peca_id:PE.jaleco, peca:"Jaleco branco", tamanho:"M", ocorrencias:8, pessoas:3, entregue_no_periodo:14, motivos:["Rasgou","Manchou ou danificou"]},
               {peca_id:PE.camisa, peca:"Camisa polo", tamanho:"G", ocorrencias:4, pessoas:1, entregue_no_periodo:9, motivos:["Perdeu"]} ],
    compras:[ {fornecedor_id:ID(91), fornecedor:"Confecções Caicó", pedido_id:null, documento:"NF 4471", lote:"L-2206", peca:"Jaleco branco", tamanho:"M", entradas:12, primeira_entrada:"2026-06-10"},
              {fornecedor_id:ID(92), fornecedor:"Uniformes RN", pedido_id:null, documento:null, lote:null, peca:"Avental impermeável", tamanho:null, entradas:6, primeira_entrada:"2026-06-02"} ]
  },
  fard_auditoria: [
    {em:"2026-08-30T14:12:00Z", quem:"Márcia (RH)", tipo:"fardamento.entrega", resumo:"entrega: Jaleco branco M x2", entidade:"fard_movimentos", entidade_id:ID(200), payload:{}},
    {em:"2026-08-27T09:41:00Z", quem:"Gilson", tipo:"fardamento.politica", resumo:"Política de fardamento alterada (vigência a partir de 01/01/2026)", entidade:"fard_politicas", entidade_id:ID(71), payload:{}},
    {em:"2026-07-31T17:03:00Z", quem:"Gilson", tipo:"fardamento.inventario", resumo:"Inventário efetivado: 1 ajuste(s), 6 bateram, 0 não contados", entidade:"fard_inventarios", entidade_id:ID(501), payload:{}}
  ]
};

const TABELAS = {
  fard_pedidos: [ {id:ID(401), fornecedor_id:ID(91), status:"pedido", data_pedido:"2026-08-20", data_prevista:"2026-09-04", documento:"PC-118"} ],
  fard_pedido_itens: [ {id:ID(411), pedido_id:ID(401), sku_id:SK.calca42, quantidade:12, recebida:0, custo_unit:62} ],
  fard_inventario_itens: []
};

// ---- a página --------------------------------------------------------------
const pagina = `<!doctype html><html lang="pt-br"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fardamento — prévia da tela</title>
<style>
  *{box-sizing:border-box}
  body{font-family:system-ui,-apple-system,sans-serif;margin:0;background:#eef1f6;color:#1a2233;}
  header{background:#fff;padding:0 24px;border-bottom:1px solid #e8ecf1;height:57px;display:flex;align-items:center;gap:14px;position:sticky;top:0;z-index:40;}
  header .logo{width:30px;height:30px;border-radius:8px;background:#157a35;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px;}
  header b{font-size:14.5px;} header .crumb{font-size:13px;color:#6b7787;}
  main{max-width:1340px;margin:0 auto;padding:22px 32px 70px;}
  .card{background:#fff;border-radius:12px;padding:18px 20px;box-shadow:0 1px 4px rgba(0,0,0,.07);}
  .card h2{font-size:14px;margin:0 0 16px;color:#0c5a26;}
  .kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:14px;}
  .kpi{background:#fff;border-radius:12px;padding:16px 18px;box-shadow:0 1px 4px rgba(0,0,0,.07);}
  .kpi .v{font-size:22px;font-weight:700;color:#0c5a26;}
  .kpi .l{font-size:12px;color:#6b7787;margin-top:3px;text-transform:uppercase;letter-spacing:.4px;}
  .btn-p{background:#157a35;color:#fff;border:0;border-radius:9px;padding:8px 16px;font-size:13px;font-weight:600;cursor:pointer;}
  .btn-s{background:#eef2f7;color:#33404f;border:1px solid #dbe2ea;border-radius:9px;padding:8px 16px;font-size:13px;font-weight:600;cursor:pointer;}
  .page{display:none;} .page.ativo{display:grid;grid-template-columns:minmax(0,1fr);gap:22px;}
  .mod-tabs{display:flex;gap:2px;border-bottom:1px solid #e2e8ee;overflow-x:auto;}
  .mod-tab{padding:11px 15px;background:none;border:0;border-bottom:2px solid transparent;color:#6b7787;font:inherit;font-size:13px;cursor:pointer;white-space:nowrap;}
  .mod-tab.on{color:#0c5a26;border-bottom-color:#157a35;font-weight:700;}
  .modal-bg{position:fixed;inset:0;background:rgba(20,28,38,.45);display:none;align-items:center;justify-content:center;z-index:9999;padding:20px;}
  .modal-bg.show{display:flex;}
  .modal-cx{background:#fff;border-radius:14px;max-width:560px;width:100%;box-shadow:0 18px 50px rgba(16,24,40,.24);}
  .modal-top{display:flex;align-items:center;gap:12px;padding:20px 24px 0;}
  .modal-ic{width:40px;height:40px;border-radius:50%;background:#fff4e0;color:#e08600;display:flex;align-items:center;justify-content:center;flex:0 0 auto;}
  .modal-ic.neutro{background:#eef7f0;color:#157a35;}
  .modal-tit{font-size:16px;font-weight:700;color:#1a2233;}
  .modal-acts{display:flex;justify-content:flex-end;gap:10px;padding:18px 24px 20px;}
${cssModal}
</style></head><body>
<header><div class="logo">SR</div><b>Painel Santa Rita</b><span class="crumb">› Fardamento</span></header>
<main>
  <div style="background:#eef4fc;border:1px solid #d3e2f5;color:#2b4a6f;border-radius:10px;padding:12px 16px;font-size:13px;line-height:1.55;margin-bottom:18px;">
    <b>Prévia da tela — o código é o de verdade, os dados é que são inventados.</b><br>
    Esta página roda o módulo exatamente como ele foi escrito no painel. O que muda é só a fonte
    dos dados: em vez do Supabase, um conjunto de exemplo. Nada foi publicado e nada foi gravado.
    Os botões que gravam vão dizer que estão na prévia.
  </div>
${secao.replace('<section id="page-fardamento" class="page">', '<section id="page-fardamento" class="page ativo">')}
</main>
<script>
/* ---- dublês das peças do painel que o módulo usa ---- */
var HOJE = new Date("${hoje}T12:00:00");
function prdEsc(s){ return String(s==null?"":s).replace(/[&<>"]/g,function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]; }); }
var num = function(x){ return (x||0).toLocaleString("pt-BR"); };
function uiConfirm(o){ alert((o.titulo?o.titulo+"\\n\\n":"")+(o.msg||"")); return Promise.resolve(false); }
function autorizarMaster(m){ alert("Na prévia a senha do master não é pedida.\\n\\n" + m); return Promise.resolve(false); }
var RESPOSTAS = ${JSON.stringify(RESPOSTAS)};
var TABELAS = ${JSON.stringify(TABELAS)};
window.__PERFIL = { is_master:true, paginas:[], nome:"Prévia" };
window.__SB = {
  rpc:function(nome){
    if(RESPOSTAS.hasOwnProperty(nome)) return Promise.resolve({ data:RESPOSTAS[nome], error:null });
    return Promise.resolve({ data:null, error:{ message:"Isto é uma prévia: gravar de verdade só depois que o SQL estiver no Supabase." } });
  },
  from:function(t){
    var dados = TABELAS[t] || [];
    var api = { select:function(){ return api; }, eq:function(){ return api; },
      order:function(){ return api; }, limit:function(){ return api; },
      then:function(ok){ return Promise.resolve({ data:dados, error:null }).then(ok); } };
    return api;
  }
};
</script>
<script>
${modulo}
</script>
<script>
/* a prévia aceita a aba pela URL: ...previa-fardamento.html#estoque
   e #entrega abre a janela de registrar entrega, que é o caminho mais usado. */
(function(){
  var h = decodeURIComponent(String(location.hash || "").slice(1));
  var abrirEntrega = (h === "entrega");
  var abrirFicha = (h === "ficha");
  if(h && !abrirEntrega && !abrirFicha) FARD.aba = h;
  renderFardamento();
  if(abrirEntrega) setTimeout(function(){ fardNovaEntrega("${PES.jonas}"); }, 350);
  if(abrirFicha)   setTimeout(function(){ fardAbrirFicha("${PES.jonas}"); }, 350);
})();
</script>
</body></html>`;

const saida = path.join(RAIZ, ".previa", "previa-fardamento.html");
fs.mkdirSync(path.dirname(saida), { recursive: true });
fs.writeFileSync(saida, pagina, "utf8");
console.log("prévia gerada: .previa/previa-fardamento.html (" + Math.round(pagina.length / 1024) + " KB)");
