// Testes da LÓGICA da tela Manutenções v2 (14/09/2026) — bloco ==MAN2-LOGICA== do painel construído.
// Contrato: docs/manutencao-v2-especificacao.md, seção 5.2 (textos e cores de estado, ordem da fila,
// busca, filtros, KPIs) e 3.3 (pedido de "registrar serviço" e a validação espelho do banco).
// Os dados abaixo são de EXEMPLO (formato do contrato manutencao_painel), não são da loja.
//   npx tsx scripts/demoDashboard.ts && node scripts/testes/manutencao-v2-logica.test.cjs
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const HTML = fs.readFileSync(path.join(__dirname, "..", "..", "output", "index.html"), "utf8");
const ini = HTML.indexOf("==MAN2-LOGICA-INICIO==");
const fim = HTML.indexOf("==MAN2-LOGICA-FIM==");
if (ini < 0 || fim < 0) { console.log("ERRO: não achei o bloco ==MAN2-LOGICA== no output/index.html (rode o build antes)."); process.exit(1); }
const bloco = HTML.slice(HTML.indexOf("*/", ini) + 2, HTML.lastIndexOf("/*", fim));
const NOMES = ["MAN2_CORES", "MAN2_KPIS", "man2TextoEstado", "man2TextoCurto", "man2TextoPeriodicidade", "man2LinhaRotina",
  "man2LinhaResponsavel", "man2DataBR", "man2DataCurta", "man2IsoValido", "man2SomarDias", "man2DiasEntre", "man2HoraFortaleza",
  "man2DataHoraBR", "man2NumeroBR", "man2Dinheiro", "man2TextoCusto", "man2Divergencia", "man2Normalizar", "man2PapelDoPerfil",
  "man2Pode", "man2PodeExcluirDefinitivo", "man2RotinaDoTipo", "man2ContextoServico", "man2FiltrarEquipamentos", "man2FiltrarBase",
  "man2OrdenarEquipamentos", "man2Tarefas", "man2Contar", "man2KpiParaFiltro", "man2OpcoesFiltro", "man2ResolverPessoa",
  "man2MontarPayloadRegistro", "man2ValidarRegistro", "man2PendAbertas", "man2TemFiltro", "man2TextoResultado", "man2TextoPendencia",
  // etapa 2
  "man2NomesLote", "man2TextoPreviaLote", "man2ValidarEquipamento", "man2MontarPayloadEquipamento", "man2MontarPayloadLote",
  "man2ValidarRotina", "man2MontarPayloadRotina", "man2RotinaPedeJustificativa", "man2CaminhoArquivo", "man2ConferirArquivo",
  "man2MostraPeso", "man2DadosVisiveisRegistro", "man2BuscarEquipamentos", "man2BuscarPessoas", "man2PedidoCusto",
  "man2FormatarDinheiroCampo", "man2LerHash", "man2UrlEquipamento", "man2AvisosDoResumo", "man2AgendaLinhas", "man2AgendaHtml",
  "man2EtiquetasHtml", "man2TextoNoPrazo", "man2ResumoMudancas", "man2TextoAgendaSituacao", "man2TextoFiltros",
  // integração com o banco (lista de pendências do painel, estados e ações que o SQL devolve)
  "man2PendenciasFiltradas", "man2LinhaPendencia", "man2TextoAcaoAuditoria",
  // revisão (achados confirmados de 15/09)
  "man2ContarKpis", "man2SeloDoResumo", "man2TextoSemServico",
  // conferência de 15/09 (lado da tela) e ajustes visuais
  "man2ValorComOpcoes", "man2LinhaRotinaCard", "man2TextoCustoLinha", "man2AgruparQualidade", "man2SugestoesPessoas", "man2PrioridadePessoas", "man2ResumoComPainel"];
const L = new Function(bloco + "\nreturn {" + NOMES.join(",") + "};")();

let ok = 0, falhou = 0;
function vale(nome, cond, det) { console.log((cond ? "  OK   " : "  FALHA") + " | " + nome + (det !== undefined ? "  ->  " + det : "")); cond ? ok++ : falhou++; }
function igual(nome, obtido, esperado) {
  let bate = true;
  try { assert.deepStrictEqual(obtido, esperado); } catch (e) { bate = false; }
  vale(nome, bate, bate ? JSON.stringify(obtido) : ("obtido " + JSON.stringify(obtido) + "  esperado " + JSON.stringify(esperado)));
}
function naoQuebra(nome, fn) { try { fn(); vale(nome, true, "sem erro"); } catch (e) { vale(nome, false, e.message); } }

// ---------------- dados de EXEMPLO no formato de manutencao_painel ----------------
let seq = 0;
function rot(o) {
  return Object.assign({ id: "r" + (++seq), tipo_servico: "Limpeza", periodicidade_dias: 30, data_inicio: null, responsavel_nome: null,
    responsavel_perfil_id: null, instrucao: null, exige_foto_antes: false, exige_foto_depois: false, origem: "manual", versao: 1,
    ultima_data: null, ultima_resultado: null, ultima_executor_nome: null, proxima: null, estado: "em_dia", dias: null }, o);
}
function eq(o) {
  return Object.assign({ id: "e" + (++seq), codigo: null, nome: "", tipo: "", setor: "", status: "ativo", versao: 1, tem_procedimento: false,
    link_fabricante: null, manual_fabricante: null, estado: "sem_programacao", dias: null, pendencias_abertas: 0, ultima_execucao: null, rotinas: [] }, o);
}
const E1 = eq({ id: "E1", codigo: "EQ-0001", nome: "Camera Fria de Congelado", tipo: "Câmara fria", setor: "Açougue", estado: "atrasado", dias: -40,
  ultima_execucao: { data: "2026-07-06", tipo_servico: "Limpeza", executor_nome: "Laryze", resultado: "legado" },
  rotinas: [rot({ ultima_data: "2026-07-06", ultima_resultado: "legado", ultima_executor_nome: "Laryze", proxima: "2026-08-05", estado: "atrasado", dias: -40, origem: "migracao" })] });
const E2 = eq({ id: "E2", codigo: "EQ-0002", nome: "Camera Fria Resfriado", tipo: "Câmara fria", setor: "Açougue", estado: "atrasado", dias: -39,
  rotinas: [rot({ ultima_data: "2026-07-07", ultima_executor_nome: "Laryze", proxima: "2026-08-06", estado: "atrasado", dias: -39 })] });
const E3 = eq({ id: "E3", codigo: "EQ-0003", nome: "Balanças Caixa 101", tipo: "Balança", setor: "Frente de caixa", estado: "primeira",
  rotinas: [rot({ tipo_servico: null, periodicidade_dias: 7, origem: "migracao", estado: "primeira" })] });
const E4 = eq({ id: "E4", codigo: "EQ-0004", nome: "Balanças Caixa 102", tipo: "Balança", setor: "Frente de caixa" });
const E5 = eq({ id: "E5", codigo: "EQ-0005", nome: "Balanças Caixa 110", tipo: "Balança", setor: "Frente de caixa" });
const E6 = eq({ id: "E6", codigo: "EQ-0006", nome: "Balanças Caixa 9", tipo: "Balança", setor: "Frente de caixa" });
const E7 = eq({ id: "E7", codigo: "EQ-0007", nome: "Forno Turbo", tipo: "Forno", setor: "Padaria", estado: "hoje", dias: 0,
  rotinas: [rot({ tipo_servico: "Higienização", periodicidade_dias: 7, proxima: "2026-09-14", estado: "hoje", dias: 0, responsavel_nome: "Zé" }),
            rot({ tipo_servico: "Inspeção", periodicidade_dias: 60, proxima: "2026-09-19", estado: "proximo", dias: 5 })] });
const E8 = eq({ id: "E8", codigo: "EQ-0008", nome: "Balcão Refrigerado Frios", tipo: "Balcão refrigerado", setor: "Frios e Laticínios", estado: "em_dia", dias: 20, pendencias_abertas: 2,
  rotinas: [rot({ proxima: "2026-10-04", estado: "em_dia", dias: 20, responsavel_nome: "Zé" })] });
const E9 = eq({ id: "E9", codigo: "EQ-0009", nome: "Freezer Ilha", tipo: "Freezer/Ilha", setor: "Frios e Laticínios", estado: "proximo", dias: 1,
  rotinas: [rot({ periodicidade_dias: 15, proxima: "2026-09-15", estado: "proximo", dias: 1, responsavel_nome: "Laryze" })] });
const E10 = eq({ id: "E10", codigo: "EQ-0010", nome: "Gerador Antigo", tipo: "Gerador", setor: "Depósito/Estoque", status: "inativo", estado: "inativo",
  rotinas: [rot({ proxima: "2026-01-01", estado: "atrasado", dias: -256 })], pendencias_abertas: 1 });
const E11 = eq({ id: "E11", codigo: "EQ-0011", nome: "Ar-condicionado Salão", tipo: "Ar-condicionado", setor: "Salão de vendas", estado: "sem_periodicidade",
  rotinas: [rot({ tipo_servico: "Manutenção preventiva", periodicidade_dias: null, estado: "sem_periodicidade" })] });
const EQS = [E5, E10, E8, E3, E11, E1, E6, E9, E4, E2, E7];
const ids = l => l.map(x => x.id).join(",");

console.log("\n=== 1) Textos de estado (tabela 5.2: texto sempre escrito) ===\n");
igual("atrasado, 40 dias", L.man2TextoEstado("atrasado", -40, "2026-08-05"), { cls: "atrasado", pilula: "Vencido há 40 dias", detalhe: "desde 05/08/2026" });
igual("atrasado, 1 dia (singular)", L.man2TextoEstado("atrasado", -1, "2026-09-13").pilula, "Vencido há 1 dia");
igual("hoje", L.man2TextoEstado("hoje", 0, "2026-09-14").pilula, "Vence hoje");
igual("próximo, amanhã", L.man2TextoEstado("proximo", 1, "2026-09-15").pilula, "Vence amanhã");
igual("próximo, 5 dias", L.man2TextoEstado("proximo", 5, "2026-09-19").pilula, "Vence em 5 dias");
igual("primeira execução + explicação", L.man2TextoEstado("primeira", null, null), { cls: "primeira", pilula: "Aguardando 1ª execução", detalhe: "Registre a primeira execução para iniciar o ciclo." });
igual("em dia + próxima dd/mm", L.man2TextoEstado("em_dia", 20, "2026-10-04"), { cls: "em_dia", pilula: "Em dia", detalhe: "próxima em 04/10" });
igual("sem periodicidade", L.man2TextoEstado("sem_periodicidade").pilula, "Periodicidade não configurada");
igual("sem programação", L.man2TextoEstado("sem_programacao").pilula, "Sem programação");
igual("inativo", L.man2TextoEstado("inativo").pilula, "Inativo");
igual("pendência", L.man2TextoEstado("pendencia").pilula, "Problema pendente");
vale("dias ausente não vira NaN nem 0 (branco não é zero)", !/NaN|há 0/.test(L.man2TextoEstado("atrasado", null, null).pilula + L.man2TextoEstado("proximo", undefined).pilula), L.man2TextoEstado("atrasado", null).pilula + " / " + L.man2TextoEstado("proximo", undefined).pilula);
igual("linha curta do card", [L.man2TextoCurto("proximo", 5), L.man2TextoCurto("atrasado", -1), L.man2TextoCurto("em_dia", 20, "2026-10-04")], ["vence em 5 dias", "vencido há 1 dia", "em dia · próxima em 04/10"]);
igual("periodicidade", [L.man2TextoPeriodicidade(30), L.man2TextoPeriodicidade(1), L.man2TextoPeriodicidade(null), L.man2TextoPeriodicidade(0)], ["a cada 30 dias", "a cada 1 dia", "Periodicidade não configurada", "Periodicidade não configurada"]);
igual("linha da tarefa (exemplo da 5.2)", L.man2LinhaRotina(E1.rotinas[0]), "Limpeza — vencido desde 05/08/2026 · a cada 30 dias");
igual("linha do responsável sem responsável", L.man2LinhaResponsavel(E1.rotinas[0]), "Sem responsável definido · Última: 06/07/2026 (Laryze)");
igual("linha do responsável sem execução", L.man2LinhaResponsavel(E9.rotinas[0]), "Responsável: Laryze · Nenhuma execução registrada");
igual("rotina migrada sem tipo", L.man2LinhaRotina(E3.rotinas[0]), "Serviço a confirmar — aguardando a 1ª execução · a cada 7 dias");
igual("resultados", ["ok", "observacao", "problema", "legado"].map(r => L.man2TextoResultado(r).texto), ["Tudo certo", "Feito, com observação", "Encontrei um problema", "Registro antigo"]);
igual("pendência resolvida/cancelada", [L.man2TextoPendencia("aberta").texto, L.man2TextoPendencia("resolvida").texto, L.man2TextoPendencia("cancelada").texto], ["Problema pendente", "Resolvida", "Cancelada"]);

console.log("\n=== 2) Contraste AA das pílulas (medido no CSS construído) ===\n");
function lum(hex) { const h = hex.replace("#", ""); const c = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }
function contraste(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
// só o CSS CLARO da seção (o tema escuro gerado no build fica no <head> e tem as mesmas classes)
const iCss = HTML.indexOf("==MAN2-CSS==");
const CSS = iCss >= 0 ? HTML.slice(iCss, HTML.indexOf("</style>", iCss)) : "";
vale("achei o CSS da seção (==MAN2-CSS==)", CSS.length > 0, CSS.length + " caracteres");
const estados = ["atrasado", "hoje", "proximo", "primeira", "em_dia", "sem_periodicidade", "sem_programacao", "inativo", "pendencia"];
estados.forEach(st => {
  const m = CSS.match(new RegExp("\\.m2-pill\\." + st + "\\{background:(#[0-9a-fA-F]{6});color:(#[0-9a-fA-F]{6});?\\}"));
  if (!m) { vale("CSS da pílula " + st + " existe", false, "não achei .m2-pill." + st); return; }
  const cor = L.MAN2_CORES[st];
  vale("pílula " + st + ": CSS igual a MAN2_CORES", m[1].toLowerCase() === cor.fundo && m[2].toLowerCase() === cor.texto, m[1] + "/" + m[2]);
  const r = contraste(m[1], m[2]);
  vale("pílula " + st + ": contraste ≥ 4,5", r >= 4.5, r.toFixed(2) + ":1");
});
["atrasado", "hoje", "proximo", "em_dia", "sem_programacao", "pendencia"].forEach(k => {
  const m = CSS.match(new RegExp("\\.m2-kpi\\." + k + " \\.v\\{color:(#[0-9a-fA-F]{6});?\\}"));
  const r = m ? contraste(m[1], "#ffffff") : 0;
  vale("número do KPI " + k + " sobre branco ≥ 4,5", !!m && r >= 4.5, m ? r.toFixed(2) + ":1" : "sem CSS");
});
vale("texto secundário #56606d sobre branco ≥ 4,5", contraste("#56606d", "#ffffff") >= 4.5, contraste("#56606d", "#ffffff").toFixed(2) + ":1");

console.log("\n=== 3) Datas e formatos ===\n");
igual("data BR", [L.man2DataBR("2026-09-14"), L.man2DataBR("2026-09-14T10:00:00Z"), L.man2DataBR(null), L.man2DataCurta("2026-10-04")], ["14/09/2026", "14/09/2026", "—", "04/10"]);
igual("28/02 -> 01/03 em 2027", L.man2SomarDias("2027-02-28", 1), "2027-03-01");
igual("28/02 -> 29/02 em 2028 (bissexto)", L.man2SomarDias("2028-02-28", 1), "2028-02-29");
igual("virada de mês/ano", [L.man2SomarDias("2026-12-31", 1), L.man2SomarDias("2026-07-06", 30)], ["2027-01-01", "2026-08-05"]);
igual("dias entre", [L.man2DiasEntre("2026-08-05", "2026-09-14"), L.man2DiasEntre("2026-09-14", "2026-09-07")], [40, -7]);
igual("data válida", [L.man2IsoValido("2028-02-29"), L.man2IsoValido("2027-02-29"), L.man2IsoValido("2026-9-1"), L.man2IsoValido(null)], [true, false, false, false]);
igual("hora em Fortaleza (UTC-3) para 'Dados de HH:MM'", L.man2HoraFortaleza("2026-09-14T23:10:00Z"), "20:10");
igual("data e hora em Fortaleza", L.man2DataHoraBR("2026-09-15T01:05:00Z"), "14/09/2026 às 22:05");
igual("data e hora ausente", [L.man2DataHoraBR(null), L.man2HoraFortaleza("lixo")], ["—", ""]);

console.log("\n=== 4) Custo: null, 0 e valor são coisas diferentes ===\n");
igual("custo não informado (null)", L.man2TextoCusto(null, "nao_informado"), "Custo não informado");
igual("custo null sem situação", L.man2TextoCusto(null), "Custo não informado");
igual("custo ZERO digitado", L.man2TextoCusto(0, "informado"), "R$ 0,00");
igual("custo com valor", L.man2TextoCusto(1234.5, "informado"), "R$ 1.234,50");
igual("interno", L.man2TextoCusto(null, "nao_se_aplica"), "Interno — sem custo");
igual("oculto para operacional", L.man2TextoCusto("oculto", "oculto"), null);
igual("dinheiro", [L.man2Dinheiro(1000000), L.man2Dinheiro(0.1), L.man2Dinheiro(null), L.man2Dinheiro("")], ["R$ 1.000.000,00", "R$ 0,10", null, null]);
igual("número digitado: branco é null", L.man2NumeroBR("   "), null);
vale("número digitado: lixo é NaN (nunca 0)", Number.isNaN(L.man2NumeroBR("abc")) && Number.isNaN(L.man2NumeroBR("1,2,3")), "abc / 1,2,3");
igual("número digitado: formatos", [L.man2NumeroBR("1.234,56", "dinheiro"), L.man2NumeroBR("1.500", "dinheiro"), L.man2NumeroBR("150"), L.man2NumeroBR("R$ 150,00", "dinheiro"), L.man2NumeroBR("9,980"), L.man2NumeroBR("12.3456"), L.man2NumeroBR("-50")], [1234.56, 1500, 150, 150, 9.98, 12.3456, -50]);
igual("divergência de peso", [L.man2Divergencia(10, 9.98).texto, L.man2Divergencia(10, 10).texto, L.man2Divergencia(10, 10.05).texto, L.man2Divergencia(null, 9)], ["-20 g a menos", "Dentro do padrão (0 g)", "+50 g a mais", null]);

console.log("\n=== 5) Fila 'Precisa de atenção': ordem da 5.2 ===\n");
const tarefas = L.man2Tarefas(EQS, {});
const rotulo = t => t.equipamento.id + ":" + (t.tipo === "pendencia" ? "pendencia" : t.rotina.estado);
igual("ordem: atrasado (mais dias primeiro) → hoje → pendências → 1ª execução → próximos", tarefas.map(rotulo),
  ["E1:atrasado", "E2:atrasado", "E7:hoje", "E8:pendencia", "E3:primeira", "E9:proximo", "E7:proximo"]);
vale("inativo não gera tarefa (nem a rotina atrasada nem a pendência)", !tarefas.some(t => t.equipamento.id === "E10"), "E10 fora");
vale("em dia, sem periodicidade e sem programação não entram", !tarefas.some(t => ["E4", "E5", "E6", "E11"].indexOf(t.equipamento.id) >= 0), "fora");
igual("pendência leva a quantidade", tarefas.find(t => t.tipo === "pendencia").quantidade, 2);
igual("filtro de situação na fila", L.man2Tarefas(EQS, { situacao: "atrasado" }).map(rotulo), ["E1:atrasado", "E2:atrasado"]);
igual("filtro de serviço na fila (tira pendência sem serviço)", L.man2Tarefas(EQS, { servico: "limpeza" }).map(rotulo), ["E1:atrasado", "E2:atrasado", "E9:proximo"]);
igual("rotina migrada aparece como 'Serviço a confirmar'", L.man2Tarefas(EQS, { servico: "Serviço a confirmar" }).map(rotulo), ["E3:primeira"]);

console.log("\n=== 6) Todos os equipamentos: urgência → setor → nome (numérico) ===\n");
igual("ordem dos cards", ids(L.man2OrdenarEquipamentos(EQS)), "E1,E2,E7,E8,E3,E9,E11,E6,E4,E5,E10");

console.log("\n=== 7) Busca (nome, código, setor, tipo — sem acento, sem maiúscula) ===\n");
const busca = b => ids(L.man2FiltrarEquipamentos(EQS, { busca: b }));
igual("'camara' (sem acento) acha o tipo Câmara fria, e só ele", L.man2OrdenarEquipamentos(L.man2FiltrarEquipamentos(EQS, { busca: "camara" })).map(e => e.id), ["E1", "E2"]);
igual("código 'eq-0003'", busca("eq-0003"), "E3");
igual("setor em maiúscula com acento 'AÇOUGUE'", L.man2OrdenarEquipamentos(L.man2FiltrarEquipamentos(EQS, { busca: "AÇOUGUE" })).map(e => e.id), ["E1", "E2"]);
igual("dois termos 'caixa 1' (os dois precisam bater)", L.man2OrdenarEquipamentos(L.man2FiltrarEquipamentos(EQS, { busca: "caixa 1" })).map(e => e.id), ["E3", "E4", "E5"]);
igual("nada encontrado", busca("xyz"), "");
igual("busca vazia devolve todos", L.man2FiltrarEquipamentos(EQS, { busca: "  " }).length, EQS.length);

console.log("\n=== 8) Filtros combinados ===\n");
const filtra = f => L.man2OrdenarEquipamentos(L.man2FiltrarEquipamentos(EQS, f)).map(e => e.id);
igual("setor digitado diferente (' acougue')", filtra({ setor: " acougue" }), ["E1", "E2"]);
igual("setor + situação", filtra({ setor: "Frente de caixa", situacao: "sem_programacao" }), ["E6", "E4", "E5"]);
igual("setor + situação + tipo + busca", filtra({ setor: "Frente de caixa", situacao: "sem_programacao", tipo: "balança", busca: "11" }), ["E5"]);
igual("responsável (qualquer rotina ativa)", filtra({ responsavel: "zé" }), ["E7", "E8"]);
// E10 (inativo) só chega na lista quando o gestor pede "Mostrar inativos"; aí aparece no filtro de serviço
igual("serviço", filtra({ servico: "Limpeza" }), ["E1", "E2", "E8", "E9", "E10"]);
igual("serviço + situação atrasado não traz o inativo (inativo não gera estado)", filtra({ servico: "Limpeza", situacao: "atrasado" }), ["E1", "E2"]);
igual("situação 'pendencia'", filtra({ situacao: "pendencia" }), ["E8"]);
igual("situação 'em_dia' olha as rotinas", filtra({ situacao: "em_dia" }), ["E8"]);
igual("situação 'proximo' pega equipamento com UMA rotina próxima", filtra({ situacao: "proximo" }), ["E7", "E9"]);
igual("situação 'inativo'", filtra({ situacao: "inativo" }), ["E10"]);
igual("tem filtro?", [L.man2TemFiltro({}), L.man2TemFiltro({ busca: "  " }), L.man2TemFiltro({ setor: "x" })], [false, false, true]);
const op = L.man2OpcoesFiltro(EQS.concat([eq({ setor: "açougue", tipo: "Balança" })]));
igual("opções de setor sem duplicar grafia", op.setores.filter(s => /ougue/i.test(s)), ["Açougue"]);
igual("opções de serviço/responsável", [op.servicos, op.responsaveis], [["Higienização", "Inspeção", "Limpeza", "Manutenção preventiva", "Serviço a confirmar"], ["Laryze", "Zé"]]);

console.log("\n=== 9) KPIs e KPI clicável → filtro ===\n");
igual("contagens (mesma definição do banco: rotinas; sem programação = equipamentos)", L.man2Contar(EQS),
  { atrasado: 2, hoje: 1, proximo: 2, em_dia: 1, primeira: 1, sem_periodicidade: 1, sem_programacao: 3, pendencia: 2, equipamentos_ativos: 10, equipamentos_inativos: 1 });
igual("pendencias_abertas null não conta (branco não é zero)", [L.man2PendAbertas({ pendencias_abertas: null }), L.man2PendAbertas({}), L.man2PendAbertas({ pendencias_abertas: "3" })], [0, 0, 0]);
igual("6 KPIs na ordem da 5.2", L.MAN2_KPIS.map(k => k.rotulo), ["Atrasados", "Vencem hoje", "Próximos 7 dias", "Em dia", "Sem programação", "Pendências"]);
igual("ATRASADOS na fila: fica na fila e filtra", L.man2KpiParaFiltro("atrasado", { aba: "atencao", situacao: "" }), { aba: "atencao", situacao: "atrasado" });
igual("clicar de novo desliga", L.man2KpiParaFiltro("atrasado", { aba: "atencao", situacao: "atrasado" }), { aba: "atencao", situacao: "" });
igual("EM DIA na fila leva para Todos", L.man2KpiParaFiltro("em_dia", { aba: "atencao", situacao: "" }), { aba: "todos", situacao: "em_dia" });
igual("SEM PROGRAMAÇÃO em Todos continua em Todos", L.man2KpiParaFiltro("sem_programacao", { aba: "todos", situacao: "atrasado" }), { aba: "todos", situacao: "sem_programacao" });
igual("PENDÊNCIAS abre a aba Pendências", L.man2KpiParaFiltro("pendencia", { aba: "todos", situacao: "hoje" }), { aba: "pendencias", situacao: "" });
igual("PENDÊNCIAS de novo volta para a fila", L.man2KpiParaFiltro("pendencia", { aba: "pendencias", situacao: "" }), { aba: "atencao", situacao: "" });
igual("VENCEM HOJE saindo de Pendências vai para a fila", L.man2KpiParaFiltro("hoje", { aba: "pendencias", situacao: "" }), { aba: "atencao", situacao: "hoje" });
// o KPI filtrado conta o mesmo que a lista mostra
const nAtras = L.man2Tarefas(EQS, L.man2KpiParaFiltro("atrasado", { aba: "atencao", situacao: "" })).length;
igual("KPI 'Atrasados' = linhas da fila filtrada", nAtras, L.man2Contar(EQS).atrasado);

console.log("\n=== 10) Papel (espelho do banco; só esconde botão) ===\n");
igual("papéis", [
  L.man2PapelDoPerfil({ is_master: true, paginas: [] }),
  L.man2PapelDoPerfil({ aprovado: true, paginas: ["manutencoes", "manutencoes_gestor"] }),
  L.man2PapelDoPerfil({ aprovado: true, paginas: ["manutencoes"] }),
  L.man2PapelDoPerfil({ aprovado: true, paginas: '["manutencoes_gestor"]' }),
  L.man2PapelDoPerfil({ aprovado: true, paginas: ["escala"] }),
  L.man2PapelDoPerfil({ aprovado: false, paginas: ["manutencoes_gestor"] }),
  L.man2PapelDoPerfil(null)], ["master", "gestor", "operacional", "gestor", null, null, null]);
const acoes = ["registrar", "resolver_pendencia", "editar", "inativar", "custo", "abrir_nota", "gerencial", "anular", "cancelar_pendencia", "excluir"];
igual("operacional: só registra e resolve", acoes.filter(a => L.man2Pode("operacional", a)), ["registrar", "resolver_pendencia"]);
igual("gestor: tudo menos excluir", acoes.filter(a => L.man2Pode("gestor", a)), acoes.filter(a => a !== "excluir"));
igual("master: tudo", acoes.filter(a => L.man2Pode("master", a)), acoes);
igual("sem papel: nada", acoes.filter(a => L.man2Pode(null, a)), []);
igual("ação desconhecida: não", L.man2Pode("master", "apagar_tudo"), false);
const det = { equipamento: { id: "E4" }, rotinas: [], pendencias: [], anexos_equipamento: [] };
igual("excluir definitivo: só master, só sem histórico, só depois de carregar", [
  L.man2PodeExcluirDefinitivo("master", det, []),
  L.man2PodeExcluirDefinitivo("master", det, null),
  L.man2PodeExcluirDefinitivo("gestor", det, []),
  L.man2PodeExcluirDefinitivo("master", det, [{ id: "x" }]),
  L.man2PodeExcluirDefinitivo("master", Object.assign({}, det, { pendencias: [{ id: "p" }] }), []),
  L.man2PodeExcluirDefinitivo("master", Object.assign({}, det, { anexos_equipamento: [{ id: "a" }] }), []),
  L.man2PodeExcluirDefinitivo("master", Object.assign({}, det, { rotinas: [{ ultima_data: "2026-01-01" }] }), [])], [true, false, false, false, false, false, false]);

console.log("\n=== 11) Caixa de contexto do serviço (somente leitura) ===\n");
igual("rotina", L.man2ContextoServico(E1, "limpeza", "2026-09-14").texto, "Periodicidade atual: 30 dias · Última execução: 06/07/2026 · Próxima prevista após concluir: 14/10/2026 · Responsável: não definido");
igual("avulso", L.man2ContextoServico(E1, "Inspeção", "2026-09-14"), { avulso: true, rotina: null, texto: "Serviço avulso — não altera nenhuma programação" });
igual("rotina sem periodicidade não inventa próxima", L.man2ContextoServico(E11, "Manutenção preventiva", "2026-09-14").texto, "Periodicidade atual: não configurada · Última execução: nenhuma · Responsável: não definido");
igual("rotina do tipo ignora maiúscula/acento e rotina sem tipo", [L.man2RotinaDoTipo(E7, "HIGIENIZACAO").tipo_servico, L.man2RotinaDoTipo(E3, ""), L.man2RotinaDoTipo(E3, "Serviço a confirmar")], ["Higienização", null, null]);

console.log("\n=== 12) Pedido de 'registrar serviço' (contrato 3.3) ===\n");
const RID = "11111111-1111-4111-8111-111111111111";
const base = { request_id: RID, equipamento_id: "E1", tipo_servico: " Limpeza ", data_execucao: "2026-09-14", executor_tipo: "interno", executor_ref: "escala:r3",
  executor_nome: " Laryze ", empresa_nome: "", empresa_contato: "", empresa_telefone: "", resultado: "ok", observacao: "", problema_descricao: "não vai",
  justificativa_atraso: "  ", peso_ref: "", peso_medido: "", custo: "150", anexos: [] };
igual("interno, operacional: só o necessário, sem custo, sem campo em branco", L.man2MontarPayloadRegistro(base, "operacional"),
  { request_id: RID, equipamento_id: "E1", tipo_servico: "Limpeza", data_execucao: "2026-09-14", executor: { tipo: "interno", ref: "escala:r3", nome: "Laryze" }, resultado: "ok" });
igual("interno, gestor: custo NÃO vai (interno não tem custo)", "custo" in L.man2MontarPayloadRegistro(base, "gestor"), false);
const ext = Object.assign({}, base, { executor_tipo: "externo", empresa_nome: "Refrigeração Exemplo", empresa_contato: "Carlos", empresa_telefone: "(84) 90000-0000", custo: "" });
igual("externo, gestor, custo em branco -> null (não informado), nunca 0", L.man2MontarPayloadRegistro(ext, "gestor"),
  { request_id: RID, equipamento_id: "E1", tipo_servico: "Limpeza", data_execucao: "2026-09-14",
    executor: { tipo: "externo", nome: "Carlos", empresa_nome: "Refrigeração Exemplo", empresa_contato: "Carlos", empresa_telefone: "(84) 90000-0000" }, resultado: "ok", custo: null });
igual("externo, gestor, custo '1.500,00' -> 1500", L.man2MontarPayloadRegistro(Object.assign({}, ext, { custo: "1.500,00" }), "master").custo, 1500);
igual("externo, custo digitado 0 -> 0", L.man2MontarPayloadRegistro(Object.assign({}, ext, { custo: "0" }), "gestor").custo, 0);
igual("externo, operacional: custo nem vai", "custo" in L.man2MontarPayloadRegistro(Object.assign({}, ext, { custo: "150" }), "operacional"), false);
igual("externo sem contato: nome = empresa", L.man2MontarPayloadRegistro(Object.assign({}, ext, { empresa_contato: " " }), "operacional").executor, { tipo: "externo", nome: "Refrigeração Exemplo", empresa_nome: "Refrigeração Exemplo", empresa_telefone: "(84) 90000-0000" });
const prob = L.man2MontarPayloadRegistro(Object.assign({}, base, { resultado: "problema", problema_descricao: " Borracha rasgada ", observacao: " ver amanhã ", justificativa_atraso: "esqueci",
  peso_ref: "10,000", peso_medido: "9,980", anexos: [{ categoria: "foto_depois", caminho: "v2/foto_depois/abc.jpg", nome_original: "f.jpg", mime: "image/jpeg", bytes: 1234, extra: 1 }] }), "operacional");
igual("problema + observação + justificativa + pesos + anexo", [prob.problema_descricao, prob.observacao, prob.justificativa_atraso, prob.peso_ref, prob.peso_medido, prob.anexos],
  ["Borracha rasgada", "ver amanhã", "esqueci", 10, 9.98, [{ categoria: "foto_depois", caminho: "v2/foto_depois/abc.jpg", nome_original: "f.jpg", mime: "image/jpeg", bytes: 1234 }]]);
igual("pessoa digitada vira referência da lista", [
  L.man2ResolverPessoa(" jose ", [{ ref: "escala:r0", nome: "Laryze", perfil_id: null }, { ref: "perfil:u1", nome: "José", perfil_id: "u1" }]),
  L.man2ResolverPessoa("Fulano de Tal", [{ ref: "perfil:u1", nome: "José" }]),
  L.man2ResolverPessoa("  ", [])], [{ ref: "perfil:u1", nome: "José", perfil_id: "u1" }, { ref: "livre", nome: "Fulano de Tal", perfil_id: null }, { ref: null, nome: null, perfil_id: null }]);

console.log("\n=== 13) Validação espelho (mesma ordem e campos do banco) ===\n");
const CTX = { hoje: "2026-09-14", papel: "operacional", equipamento: E1 };
const v = (mud, ctx) => { const r = L.man2ValidarRegistro(Object.assign({}, base, mud), Object.assign({}, CTX, ctx || {})); return r.ok ? "ok" : (r.campo + ": " + r.mensagem); };
igual("tudo certo passa", v({}), "ok");
igual("sem request_id", v({ request_id: "" }).split(":")[0], "request_id");
igual("sem equipamento", v({ equipamento_id: "" }), "equipamento: Escolha o equipamento.");
igual("equipamento inativo", v({}, { equipamento: E10 }).split(":")[0], "equipamento");
igual("sem serviço", v({ tipo_servico: "  " }), "tipo_servico: Escolha o serviço.");
igual("data inválida (30/02)", v({ data_execucao: "2026-02-30" }).split(":")[0], "data_execucao");
igual("data no futuro", v({ data_execucao: "2026-09-15" }), "data_execucao: A data não pode ser no futuro.");
igual("7 dias atrás não pede justificativa", v({ data_execucao: "2026-09-07" }), "ok");
igual("8 dias atrás pede justificativa", v({ data_execucao: "2026-09-06" }), "justificativa_atraso: Explique por que está lançando só agora.");
igual("8 dias atrás com justificativa passa", v({ data_execucao: "2026-09-06", justificativa_atraso: "estava sem internet" }), "ok");
igual("interno sem nome", v({ executor_nome: " " }), "executor: Informe quem realizou o serviço.");
igual("externo sem empresa", v({ executor_tipo: "externo", empresa_nome: "", empresa_contato: "Carlos" }), "empresa_nome: Informe o nome da empresa.");
igual("sem resultado", v({ resultado: "" }).split(":")[0], "resultado");
igual("resultado inventado", v({ resultado: "legado" }).split(":")[0], "resultado");
igual("observação obrigatória", v({ resultado: "observacao", observacao: " " }), "observacao: Escreva a observação.");
igual("problema obrigatório", v({ resultado: "problema", problema_descricao: "" }), "problema_descricao: Descreva o problema encontrado.");
const EFOTO = eq({ id: "EF", rotinas: [rot({ tipo_servico: "Limpeza", exige_foto_antes: true, exige_foto_depois: true, estado: "em_dia" })] });
igual("rotina exige foto: depois é conferida antes de antes (ordem do contrato)", v({}, { equipamento: EFOTO }).split(":")[0], "foto_depois");
igual("com a foto de depois, falta a de antes", v({ anexos: [{ categoria: "foto_depois" }] }, { equipamento: EFOTO }).split(":")[0], "foto_antes");
igual("com as duas fotos passa", v({ anexos: [{ categoria: "foto_depois" }, { categoria: "foto_antes" }] }, { equipamento: EFOTO }), "ok");
igual("serviço avulso não exige foto da rotina", v({ tipo_servico: "Inspeção" }, { equipamento: EFOTO }), "ok");
igual("só um dos pesos", v({ peso_ref: "10" }).split(":")[0], "peso_medido");
igual("peso lixo", v({ peso_ref: "abc", peso_medido: "9" }).split(":")[0], "peso_ref");
igual("custo lixo (gestor, externo)", v({ executor_tipo: "externo", empresa_nome: "X", custo: "abc" }, { papel: "gestor" }).split(":")[0], "custo");
igual("custo negativo (gestor, externo)", v({ executor_tipo: "externo", empresa_nome: "X", custo: "-50" }, { papel: "gestor" }).split(":")[0], "custo");
igual("custo lixo do operacional é ignorado (nem vai)", v({ executor_tipo: "externo", empresa_nome: "X", custo: "abc" }), "ok");

console.log("\n=== 14) Dado estranho não derruba a tela ===\n");
const ESTRANHOS = [null, {}, { id: "x", rotinas: null }, { id: "y", rotinas: [null, { estado: "atrasado" }], pendencias_abertas: null, nome: null }, "texto"];
naoQuebra("tarefas", () => L.man2Tarefas(ESTRANHOS, { busca: "a", setor: "b" }));
naoQuebra("filtrar", () => L.man2FiltrarEquipamentos(ESTRANHOS, { situacao: "atrasado", responsavel: "z", servico: "l" }));
naoQuebra("ordenar", () => L.man2OrdenarEquipamentos(ESTRANHOS.filter(e => e && typeof e === "object")));
naoQuebra("contar", () => L.man2Contar(ESTRANHOS));
naoQuebra("opções", () => L.man2OpcoesFiltro(ESTRANHOS));
naoQuebra("payload vazio", () => L.man2MontarPayloadRegistro(null, null));
naoQuebra("validação vazia", () => L.man2ValidarRegistro(null, null));

/* ======================= ETAPA 2 ======================= */
console.log("\n=== 15) Lote de equipamentos e cadastro ===\n");
igual("lote 3 começando no 8 (zero à esquerda só abaixo de 10)", L.man2NomesLote("Balança Caixa", 3, 8), ["Balança Caixa 08", "Balança Caixa 09", "Balança Caixa 10"]);
const lote13 = L.man2NomesLote("Balança Caixa", 13, 101);
igual("lote 13 do 101 ao 113", [lote13.length, lote13[0], lote13[12]], [13, "Balança Caixa 101", "Balança Caixa 113"]);
igual("começar no 0 vale", L.man2NomesLote("X", 2, 0), ["X 00", "X 01"]);
igual("201 recusado", L.man2NomesLote("X", 201, 1), []);
igual("início negativo recusado", L.man2NomesLote("X", 2, -1), []);
igual("sem nome base", L.man2NomesLote("  ", 2, 1), []);
igual("prévia dos nomes", L.man2TextoPreviaLote(lote13), "Serão criados: Balança Caixa 101 … Balança Caixa 113 (13 equipamentos)");
const ve = (f, criando) => { const r = L.man2ValidarEquipamento(Object.assign({ nome: "Balança", tipo: "Balança", setor: "Frente de caixa" }, f), criando); return r.ok ? "ok" : r.campo; };
igual("equipamento completo", ve({}, true), "ok");
igual("nome curto", ve({ nome: "B" }, true), "nome");
igual("sem tipo", ve({ tipo: "" }, true), "tipo");
igual("sem setor", ve({ setor: " " }, true), "setor");
igual("link sem http", ve({ link_fabricante: "ftp://x" }, true), "link_fabricante");
igual("quantidade lixo", ve({ quantidade: "abc" }, true), "quantidade");
igual("quantidade 3 sem início", ve({ quantidade: "3", inicio: "" }, true), "inicio");
igual("quantidade em branco = 1", ve({ quantidade: "" }, true), "ok");
igual("editar ignora quantidade", ve({ quantidade: "abc" }, false), "ok");
igual("criar sem procedimento não manda a chave", Object.keys(L.man2MontarPayloadEquipamento({ nome: "A1", tipo: "T1", setor: "S1" })), ["nome", "tipo", "setor"]);
igual("editar com procedimento em branco manda null (apaga)", L.man2MontarPayloadEquipamento({ id: "e1", versao: 3, nome: "A1", tipo: "T1", setor: "S1", procedimento: " ", link_fabricante: "" }),
  { nome: "A1", tipo: "T1", setor: "S1", id: "e1", versao: 3, procedimento: null, link_fabricante: null });
igual("lote: início 0 é 0 (branco não é zero)", L.man2MontarPayloadLote({ nome: "X", quantidade: "2", inicio: "0", tipo: "T1", setor: "S1" }), { nome_base: "X", quantidade: 2, inicio: 0, tipo: "T1", setor: "S1" });

console.log("\n=== 16) Rotina: periodicidade e justificativa ===\n");
const ROT_HIST = { id: "r1", versao: 2, periodicidade_dias: 30, ultima_data: "2026-07-06" };
igual("mudar 30->15 com histórico pede justificativa", L.man2RotinaPedeJustificativa({ periodicidade_dias: "15" }, ROT_HIST), true);
igual("manter 30 não pede", L.man2RotinaPedeJustificativa({ periodicidade_dias: "30" }, ROT_HIST), false);
igual("apagar a periodicidade também pede", L.man2RotinaPedeJustificativa({ periodicidade_dias: "" }, ROT_HIST), true);
igual("sem histórico não pede", L.man2RotinaPedeJustificativa({ periodicidade_dias: "15" }, { id: "r1", periodicidade_dias: 30, ultima_data: null }), false);
igual("rotina nova não pede", L.man2RotinaPedeJustificativa({ periodicidade_dias: "15" }, null), false);
const vr = (f, o) => { const r = L.man2ValidarRotina(Object.assign({ tipo_servico: "Limpeza", periodicidade_dias: "30" }, f), o); return r.ok ? "ok" : r.campo; };
igual("rotina ok", vr({}), "ok");
igual("sem serviço", vr({ tipo_servico: "" }), "tipo_servico");
igual("periodicidade 0", vr({ periodicidade_dias: "0" }), "periodicidade_dias");
igual("periodicidade 3651", vr({ periodicidade_dias: "3651" }), "periodicidade_dias");
igual("periodicidade em branco vale (não configurada)", vr({ periodicidade_dias: "" }), "ok");
igual("mudou com histórico e sem justificativa", vr({ periodicidade_dias: "15" }, ROT_HIST), "justificativa");
igual("mudou com justificativa", vr({ periodicidade_dias: "15", justificativa: "pedido do dono" }, ROT_HIST), "ok");
igual("pedido da rotina nova", L.man2MontarPayloadRotina({ equipamento_id: "E1", tipo_servico: "Limpeza", periodicidade_dias: "", responsavel_nome: "", instrucao: " " }, null),
  { equipamento_id: "E1", tipo_servico: "Limpeza", periodicidade_dias: null, data_inicio: null, responsavel: null, instrucao: null, exige_foto_antes: false, exige_foto_depois: false });
igual("pedido da edição com responsável e justificativa", L.man2MontarPayloadRotina({ equipamento_id: "E1", tipo_servico: "Limpeza", periodicidade_dias: "15", responsavel_ref: "escala:r0", responsavel_nome: "Laryze", justificativa: "mudou", exige_foto_depois: true }, ROT_HIST),
  { equipamento_id: "E1", tipo_servico: "Limpeza", periodicidade_dias: 15, data_inicio: null, responsavel: { ref: "escala:r0", nome: "Laryze", perfil_id: null }, instrucao: null, exige_foto_antes: false, exige_foto_depois: true, id: "r1", versao: 2, justificativa: "mudou" });

console.log("\n=== 17) Arquivos, peso e o que vai no pedido ===\n");
igual("caminho único da foto", L.man2CaminhoArquivo("foto_antes", "abc-123", "image/jpeg"), "v2/foto_antes/abc-123.jpg");
igual("caminho do manual", L.man2CaminhoArquivo("manual_fabricante", "u1", "application/pdf"), "v2/manual_fabricante/u1.pdf");
igual("mime não aceito não gera caminho", L.man2CaminhoArquivo("foto_antes", "u1", "image/gif"), null);
igual("manual tem que ser PDF", L.man2ConferirArquivo("manual_fabricante", "image/jpeg", 100).ok, false);
igual("foto não pode ser PDF", L.man2ConferirArquivo("foto_depois", "application/pdf", 100).ok, false);
igual("25 MB passa", L.man2ConferirArquivo("nota_fiscal", "application/pdf", 26214400).ok, true);
igual("25 MB + 1 byte não passa", L.man2ConferirArquivo("nota_fiscal", "application/pdf", 26214401).ok, false);
igual("arquivo vazio não passa", L.man2ConferirArquivo("nota_fiscal", "image/png", 0).ok, false);
igual("HEIC não passa", L.man2ConferirArquivo("nota_fiscal", "image/heic", 100).ok, false);
igual("balança + conferência mostra peso", L.man2MostraPeso({ tipo: "Balança" }, "Conferência / aferição"), true);
igual("balança + limpeza não mostra", L.man2MostraPeso({ tipo: "Balança" }, "Limpeza"), false);
igual("câmara + conferência não mostra", L.man2MostraPeso({ tipo: "Câmara fria" }, "Conferência / aferição"), false);
const FV = { tipo_servico: "Limpeza", executor_tipo: "interno", resultado: "ok", peso_ref: "10", peso_medido: "9", problema_descricao: "sobrou",
  arquivos: { foto_antes: { caminho: "v2/foto_antes/a.jpg", mime: "image/jpeg", bytes: 10 }, foto_problema: { caminho: "v2/foto_problema/p.jpg", mime: "image/jpeg", bytes: 10 },
    nota_fiscal: { caminho: "v2/nota_fiscal/n.pdf", mime: "application/pdf", bytes: 10 }, foto_depois: { preparando: true } } };
const dv = L.man2DadosVisiveisRegistro(FV, { tipo: "Câmara fria" });
igual("peso escondido NÃO vai", [dv.peso_ref, dv.peso_medido], ["", ""]);
igual("descrição de problema escondida NÃO vai", dv.problema_descricao, "");
igual("só vai foto à vista e pronta (sem foto do problema, sem nota de interno, sem foto preparando)", dv.anexos.map(a => a.categoria), ["foto_antes"]);
const dv2 = L.man2DadosVisiveisRegistro(Object.assign({}, FV, { resultado: "problema", executor_tipo: "externo", tipo_servico: "Conferência / aferição" }), { tipo: "Balança" });
igual("problema + externo + balança levam o que aparece", [dv2.anexos.map(a => a.categoria).join(","), dv2.peso_ref, dv2.problema_descricao], ["foto_antes,foto_problema,nota_fiscal", "10", "sobrou"]);
igual("busca de equipamento sem acento, sem inativo", L.man2BuscarEquipamentos([E1, E2, E10], "camara").itens.map(e => e.id), ["E1", "E2"]);
igual("busca de pessoa pelo setor", L.man2BuscarPessoas([{ nome: "Laryze", detalhe: "Açougue" }, { nome: "Zé", detalhe: "Frios" }], "acougue").itens.map(p => p.nome), ["Laryze"]);

console.log("\n=== 18) Custo informado depois ===\n");
igual("em branco volta a não informado (null)", L.man2PedidoCusto("x1", "", false, "").params.p_custo, null);
igual("zero digitado é zero", L.man2PedidoCusto("x1", "0", false, "").params.p_custo, 0);
igual("1.500,50", L.man2PedidoCusto("x1", "1.500,50", false, "").params.p_custo, 1500.5);
igual("lixo", L.man2PedidoCusto("x1", "abc", false, "").campo, "custo");
igual("mudar valor que existia pede motivo", L.man2PedidoCusto("x1", "200", true, "").campo, "motivo");
igual("com motivo passa", L.man2PedidoCusto("x1", "200", true, "nota errada").params, { p_execucao_id: "x1", p_custo: 200, p_motivo: "nota errada" });
igual("máscara ao sair do campo", [L.man2FormatarDinheiroCampo("1500"), L.man2FormatarDinheiroCampo("abc"), L.man2FormatarDinheiroCampo("")], ["1.500,00", "abc", ""]);

console.log("\n=== 19) Link direto #man/<id> ===\n");
igual("#man abre a página", L.man2LerHash("#man"), { pagina: true, id: null });
igual("#man/<id>", L.man2LerHash("#man/emr9b5cgj174"), { pagina: true, id: "emr9b5cgj174" });
igual("id com espaço é recusado", L.man2LerHash("#man/a%20b"), null);
igual("link de recuperar senha não é da Manutenção", L.man2LerHash("#access_token=x&type=recovery"), null);
igual("#manutencao não confunde", L.man2LerHash("#manutencao"), null);
igual("URL da etiqueta", L.man2UrlEquipamento("https://painel.exemplo", "/", "emr9b5cgj174"), "https://painel.exemplo/#man/emr9b5cgj174");

console.log("\n=== 20) Sino ===\n");
igual("1 item por tipo", L.man2AvisosDoResumo({ ok: true, atrasado: 2, hoje_qtd: 1, minhas_pendencias: 0 }).map(a => a.titulo), ["Manutenção: 2 tarefas atrasadas", "Manutenção: 1 vence hoje"]);
igual("singular e plural das pendências", L.man2AvisosDoResumo({ ok: true, minhas_pendencias: 1 }).map(a => a.titulo + "|" + a.filtro), ["Manutenção: 1 pendência atribuída a você|pendencia"]);
igual("resumo recusado não gera aviso", L.man2AvisosDoResumo({ ok: false, atrasado: 5 }), []);
igual("contagem ausente não vira aviso", L.man2AvisosDoResumo({ ok: true, atrasado: null, hoje_qtd: "3" }), []);

console.log("\n=== 21) Agenda para imprimir e etiquetas ===\n");
const AG = [E1, E3, E7, E8, E9, E10];
const linhasAg = L.man2AgendaLinhas(AG, {}, "2026-09-21");
igual("rotinas devidas até 21/09, por setor", linhasAg.map(l => l.setor + ":" + l.codigo + ":" + l.servico), ["Açougue:EQ-0001:Limpeza", "Frente de caixa:EQ-0003:Serviço a confirmar", "Frios e Laticínios:EQ-0009:Limpeza", "Padaria:EQ-0007:Higienização", "Padaria:EQ-0007:Inspeção"]);
igual("até 10/10 entra o em dia de 04/10", L.man2AgendaLinhas(AG, {}, "2026-10-10").some(l => l.codigo === "EQ-0008"), true);
igual("inativo nunca entra", L.man2AgendaLinhas(AG, {}, "2027-01-01").some(l => l.codigo === "EQ-0010"), false);
igual("filtro de situação", L.man2AgendaLinhas(AG, { situacao: "hoje" }, "2026-09-21").map(l => l.servico), ["Higienização"]);
igual("filtro sem programação não tem o que imprimir", L.man2AgendaLinhas(AG, { situacao: "sem_programacao" }, "2026-09-21"), []);
igual("texto da situação atrasada", linhasAg[0].situacao, "Vencido há 40 dias (desde 05/08/2026)");
igual("texto do próximo", linhasAg[2].situacao, "Vence em 15/09/2026 (amanhã)");
const htmlAg = L.man2AgendaHtml({ linhas: linhasAg, pendencias: [{ codigo: "EQ-0008", equipamento: "Balcão <script>", descricao: "Porta", aberta_em: "2026-09-10T13:00:00Z" }], geradoEm: "14/09/2026 às 10:00", por: "Victor", filtrosTexto: "Sem filtros", ate: "2026-09-21" });
vale("agenda: título, A4, colunas", /Agenda de manutenção e limpeza/.test(htmlAg) && /@page\{size:A4;margin:12mm\}/.test(htmlAg) && ["Código", "Equipamento", "Serviço", "Vencimento / Situação", "Responsável", "Feito", "Assinatura de quem fez", "Conferido por"].every(t => htmlAg.indexOf(">" + t + "<") >= 0));
vale("agenda: sem botão e texto escapado", htmlAg.indexOf("<button") < 0 && htmlAg.indexOf("Balcão <script>") < 0 && htmlAg.indexOf("Balcão &lt;script&gt;") >= 0);
vale("agenda: autoImprimir false tira o script", L.man2AgendaHtml({ linhas: [], ate: "2026-09-21", autoImprimir: false }).indexOf("<script") < 0 && /Nenhuma rotina devida até 21\/09\/2026/.test(L.man2AgendaHtml({ linhas: [], ate: "2026-09-21" })));
const et = L.man2EtiquetasHtml({ itens: Array.from({ length: 13 }, (_, i) => ({ codigo: "EQ-" + i, nome: "N" + i, setor: "S", qrSvg: "<svg></svg>" })) });
igual("13 etiquetas = 2 folhas A4, sem botão", [(et.match(/class="folha"/g) || []).length, (et.match(/class="et"/g) || []).length, et.indexOf("<button") < 0], [2, 13, true]);

console.log("\n=== 22) Visão gerencial e auditoria ===\n");
igual("poucos dados = DADOS INSUFICIENTES", L.man2TextoNoPrazo({ suficiente: false, percentual: 100, rotina_execucoes: 3, no_prazo: 3 }).grande, "DADOS INSUFICIENTES");
igual("percentual sem número = DADOS INSUFICIENTES", L.man2TextoNoPrazo({ suficiente: true, percentual: null, rotina_execucoes: 9 }).grande, "DADOS INSUFICIENTES");
igual("87,5%", L.man2TextoNoPrazo({ suficiente: true, percentual: 87.5, rotina_execucoes: 8, no_prazo: 7 }).grande, "87,5%");
igual("0% é 0% (branco não é zero)", L.man2TextoNoPrazo({ suficiente: true, percentual: 0, rotina_execucoes: 5, no_prazo: 0 }).grande, "0%");
igual("mudança resumida (rótulo em português)", L.man2ResumoMudancas({ nome: "A", versao: 1 }, { nome: "B", versao: 2 }), ["Nome: A → B"]);
igual("criação", L.man2ResumoMudancas(null, { nome: "B" }), ["Novo registro"]);
const muitas = L.man2ResumoMudancas({ a: 1, b: 1, c: 1, d: 1, e: 1, f: 1, g: 1, h: 1 }, { a: 2, b: 2, c: 2, d: 2, e: 2, f: 2, g: 2, h: 2 });
igual("no máximo 6 linhas + resto", [muitas.length, muitas[6]], [7, "+2 campos"]);

console.log("\n=== 23) Integração com o banco: lista de pendências, estados e ações que o SQL devolve ===\n");
const eqPA = eq({ id: "PA", codigo: "EQ-0101", nome: "Balança A", tipo: "Balança", setor: "Frente de caixa", pendencias_abertas: 2 });
const eqPB = eq({ id: "PB", codigo: "EQ-0102", nome: "Freezer B", tipo: "Freezer/Ilha", setor: "Açougue", pendencias_abertas: 1 });
const eqPI = eq({ id: "PI", codigo: "EQ-0103", nome: "Inativo C", tipo: "Balança", setor: "Açougue", status: "inativo", estado: "inativo", pendencias_abertas: 1 });
const EQP = [eqPA, eqPB, eqPI];
const PENDS = [
  { id: "p1", equipamento_id: "PA", descricao: "Visor trincado", status: "aberta", aberta_em: "2026-09-10T10:00:00-03:00", aberta_por_nome: "Laryze", responsavel_nome: "Zé" },
  { id: "p2", equipamento_id: "PB", descricao: "Porta", status: "aberta", aberta_em: "2026-09-01T10:00:00-03:00", aberta_por_nome: null, responsavel_nome: null },
  { id: "p3", equipamento_id: "PA", descricao: "Tecla solta", status: "aberta", aberta_em: "2026-09-12T10:00:00-03:00", aberta_por_nome: "Márcia", responsavel_nome: "Laryze" },
  { id: "p4", equipamento_id: "PI", descricao: "De inativo", status: "aberta", aberta_em: "2026-09-02T10:00:00-03:00" },
  { id: "p5", equipamento_id: "PA", descricao: "Já resolvida", status: "resolvida", aberta_em: "2026-08-02T10:00:00-03:00" },
  null, "lixo"
];
igual("uma entrada por pendência aberta, mais antiga primeiro, sem equipamento inativo", L.man2PendenciasFiltradas(EQP, {}, PENDS).map(x => x.pendencia.id), ["p2", "p1", "p3"]);
igual("painel sem a lista = null (a tela volta a 1 linha por equipamento)", L.man2PendenciasFiltradas(EQP, {}, undefined), null);
igual("filtro de setor e de responsável da pendência (sem acento/maiúscula)",
  [L.man2PendenciasFiltradas(EQP, { setor: "Frente de caixa" }, PENDS).map(x => x.pendencia.id), L.man2PendenciasFiltradas(EQP, { responsavel: "LARYZE" }, PENDS).map(x => x.pendencia.id)], [["p1", "p3"], ["p3"]]);
igual("fila com a lista do painel: 1 tarefa por pendência, com a pendência junto",
  L.man2Tarefas(EQP, {}, PENDS).filter(t => t.tipo === "pendencia").map(t => t.pendencia.id + ":" + t.equipamento.id + ":" + t.quantidade), ["p2:PB:1", "p1:PA:1", "p3:PA:1"]);
igual("fila sem a lista continua 1 linha por equipamento", L.man2Tarefas(EQP, {}).filter(t => t.tipo === "pendencia").map(t => t.equipamento.id + ":" + t.quantidade), ["PB:1", "PA:2"]);
igual("filtro de serviço tira as pendências (pendência não tem serviço)", L.man2Tarefas(EQP, { servico: "Limpeza" }, PENDS).length, 0);
igual("situação 'pendência' mostra só as pendências", L.man2Tarefas(EQP, { situacao: "pendencia" }, PENDS).map(t => t.tipo).join(","), "pendencia,pendencia,pendencia");
igual("linha da pendência", [L.man2LinhaPendencia(PENDS[0]), L.man2LinhaPendencia(PENDS[1]), L.man2LinhaPendencia({})],
  ["Aberta em 10/09/2026 por Laryze · Responsável: Zé", "Aberta em 01/09/2026 · Sem responsável definido", "Aberta em data não informada · Sem responsável definido"]);
naoQuebra("lista de pendências com dados estranhos", () => { L.man2PendenciasFiltradas(ESTRANHOS, { busca: "x" }, [null, 1, { equipamento_id: "y" }]); L.man2Tarefas(ESTRANHOS, {}, [{}, null]); });
igual("estados de rotina que o banco devolve: inativo (equipamento inativo) e desativada",
  [L.man2TextoCurto("inativo"), L.man2TextoCurto("desativada"), L.man2TextoEstado("desativada").pilula, L.man2TextoEstado("desativada").cls], ["equipamento inativo", "rotina desativada", "Rotina desativada", "inativo"]);
igual("ações do gatilho de auditoria e 'excluir' escrito pela entidade",
  [L.man2TextoAcaoAuditoria("anexo_adicionar"), L.man2TextoAcaoAuditoria("anexo_substituir"), L.man2TextoAcaoAuditoria("pendencia_editar"), L.man2TextoAcaoAuditoria("excluir", "rotina"), L.man2TextoAcaoAuditoria("excluir", "equipamento"), L.man2TextoAcaoAuditoria("excluir")],
  ["Anexou arquivo", "Substituiu arquivo (versão antiga guardada)", "Alterou pendência", "Excluiu rotina", "Excluiu equipamento", "Excluiu equipamento"]);
igual("problema com menos de 3 letras: espelho do banco recusa", v({ resultado: "problema", problema_descricao: "ab" }), "problema_descricao: Descreva o problema encontrado.");

console.log("\n=== 24) Revisão: KPIs com responsável/serviço, agenda, auditoria legível, rotina com histórico, pedidos, selo ===\n");
// KPI = o que o clique mostra, também com Responsável e Serviço ligados
[{ responsavel: "zé" }, { responsavel: "Laryze" }, { servico: "Limpeza" }, { servico: "Higienização", setor: "Padaria" }, { responsavel: "zé", servico: "Inspeção" }].forEach((fx) => {
  const c = L.man2ContarKpis(EQS, fx);
  const fila = ["atrasado", "hoje", "proximo", "primeira"].map((k) => L.man2Tarefas(EQS, Object.assign({}, fx, { situacao: k })).length);
  igual("KPIs = linhas da fila com o filtro " + JSON.stringify(fx), [c.atrasado, c.hoje, c.proximo, c.primeira], fila);
});
igual("sem Responsável/Serviço os KPIs continuam iguais à contagem de antes", L.man2ContarKpis(EQS, { setor: "Açougue" }), L.man2Contar(L.man2FiltrarBase(EQS, { setor: "Açougue" })));
igual("KPI Pendências = aba Pendências (responsável da pendência)", [L.man2ContarKpis(EQP, { responsavel: "LARYZE" }, PENDS).pendencia, L.man2PendenciasFiltradas(EQP, { responsavel: "LARYZE" }, PENDS).length, L.man2ContarKpis(EQP, {}, PENDS).pendencia], [1, 1, 3]);
// agenda: data "Até" no passado não some com tarefa vencida
igual("agenda com 'Até' no passado continua com as atrasadas e as que vencem hoje", L.man2AgendaLinhas(AG, {}, "2026-08-01").map((l) => l.codigo + ":" + l.estado), ["EQ-0001:atrasado", "EQ-0003:primeira", "EQ-0007:hoje"]);
// auditoria para o gestor: rótulo em português, data do Brasil, reais; sem uuid e sem repetir quem/quando
const audInat = L.man2ResumoMudancas(
  { status: "ativo", inativado_por: null, inativado_em: null, inativado_por_nome: null, inativado_motivo: null, versao: 1, atualizado_em: "2026-09-14T20:00:00-03:00" },
  { status: "inativo", inativado_por: "20000000-0000-0000-0000-000000000001", inativado_em: "2026-09-14T23:41:16.97755-03:00", inativado_por_nome: "Márcia", inativado_motivo: "Câmara desmontada", versao: 2, atualizado_em: "2026-09-14T23:41:16.97755-03:00" });
igual("auditoria (inativar): só o que importa, com rótulo em português", audInat, ["Motivo da inativação: vazio → Câmara desmontada", "Situação: ativo → inativo"]);
igual("auditoria: custo em reais; data do Brasil; periodicidade; sem id interno", [
  L.man2ResumoMudancas({ custo: 350.5, informado_em: "2026-09-14T23:41:16.72-03:00", informado_por: null }, { custo: 400, informado_em: "2026-09-14T23:41:16.79-03:00", informado_por: "20000000-0000-0000-0000-000000000001" }),
  L.man2ResumoMudancas({ data_inicio: "2026-08-26", periodicidade_dias: 7, execucao_solucao_id: null }, { data_inicio: "2026-08-31", periodicidade_dias: 14, execucao_solucao_id: "ffca9fb2-103d-424a-8077-3d74caeb82eb" })],
  [["Custo: R$ 350,50 → R$ 400,00"], ["Primeira execução até: 26/08/2026 → 31/08/2026", "A cada (dias): 7 → 14"]]);
const audTxt = L.man2ResumoMudancas({ dono: null, quando: null, ativa: true }, { dono: "20000000-0000-0000-0000-000000000009", quando: "2026-09-15T01:05:00Z", ativa: false }).join(" | ");
vale("auditoria: campo desconhecido nunca mostra uuid nem data ISO", !/[0-9a-f]{8}-[0-9a-f]{4}-|\d{4}-\d{2}-\d{2}T/.test(audTxt) && /14\/09\/2026 às 22:05/.test(audTxt) && /Rotina ativa: sim → não/.test(audTxt), audTxt);
// rotina que já tem serviço: espelho do banco
const ROT_H = { id: "r1", versao: 2, periodicidade_dias: 30, data_inicio: null, tipo_servico: "Limpeza", ultima_data: "2026-07-06" };
igual("rotina com serviço registrado: trocar o SERVIÇO é recusado na tela (espelho do banco)", [vr({ tipo_servico: "Calibração" }, ROT_H), L.man2ValidarRotina({ tipo_servico: "Calibração", periodicidade_dias: "30" }, ROT_H).mensagem],
  ["tipo_servico", "Esta rotina já tem serviços registrados: o serviço não pode ser trocado. Para outro serviço, desative esta rotina e crie outra."]);
igual("…o mesmo serviço (maiúscula/acento) passa; rotina migrada sem serviço recebe o serviço", [vr({ tipo_servico: "LIMPEZA" }, ROT_H), vr({ tipo_servico: "Limpeza", periodicidade_dias: "7" }, { id: "r2", versao: 1, periodicidade_dias: 7, tipo_servico: null, ultima_data: null })], ["ok", "ok"]);
igual("rotina com serviço: mudar a data da 1ª execução pede justificativa (e diz o motivo certo)",
  [L.man2RotinaPedeJustificativa({ periodicidade_dias: "30", data_inicio: "2026-09-20" }, ROT_H), L.man2ValidarRotina({ tipo_servico: "Limpeza", periodicidade_dias: "30", data_inicio: "2026-09-20" }, ROT_H).mensagem,
   L.man2RotinaPedeJustificativa({ periodicidade_dias: "30", data_inicio: "" }, ROT_H), L.man2RotinaPedeJustificativa({ periodicidade_dias: "30", data_inicio: "2026-09-20" }, Object.assign({}, ROT_H, { ultima_data: null }))],
  [true, "Esta rotina já tem serviços registrados. Explique por que a data da primeira execução mudou.", false, false]);
igual("pedido da rotina leva a justificativa quando só a data mudou", L.man2MontarPayloadRotina({ equipamento_id: "E1", tipo_servico: "Limpeza", periodicidade_dias: "30", data_inicio: "2026-09-20", justificativa: "Nova data combinada" }, ROT_H).justificativa, "Nova data combinada");
// identificação do formulário e dia em que foi salvo
igual("cadastro e lote levam a identificação do formulário (reenvio não duplica)", [L.man2MontarPayloadEquipamento({ request_id: "rq1", nome: "A1", tipo: "T1", setor: "S1" }).request_id, L.man2MontarPayloadLote({ request_id: "rq2", nome: "X", quantidade: "2", inicio: "1", tipo: "T1", setor: "S1" }).request_id], ["rq1", "rq2"]);
igual("registro leva o dia em que foi salvo (só data válida)", [L.man2MontarPayloadRegistro(Object.assign({}, base, { dia_formulario: "2026-09-14" }), "operacional").dia_formulario, "dia_formulario" in L.man2MontarPayloadRegistro(Object.assign({}, base, { dia_formulario: "ontem" }), "operacional")], ["2026-09-14", false]);
// selo do menu: o dado mais novo
const RES = { ok: true, hoje: "2027-02-28", atrasado: 4, hoje_qtd: 1 };
igual("selo: página FECHADA pinta pelo resumo mesmo com painel antigo na memória", L.man2SeloDoResumo(RES, { hoje: "2027-02-28" }, false), 5);
igual("selo: página aberta com painel de OUTRO dia (virou a meia-noite) pinta pelo resumo", L.man2SeloDoResumo(RES, { hoje: "2027-02-27" }, true), 5);
igual("selo: página aberta com painel do mesmo dia deixa o painel pintar; resumo recusado não mexe", [L.man2SeloDoResumo(RES, { hoje: "2027-02-28" }, true), L.man2SeloDoResumo({ ok: false, atrasado: 9 }, null, false), L.man2SeloDoResumo(RES, null, true)], [null, null, 5]);
// rotina sem serviço: texto para o funcionário
igual("rotina sem serviço: operacional é mandado ao gestor; gestor sabe que falta escolher (sem 'migrada')",
  [/Peça ao gestor/.test(L.man2TextoSemServico("operacional")), /migrada|Registre/i.test(L.man2TextoSemServico("operacional") + L.man2TextoSemServico("gestor")), /Falta escolher o serviço/.test(L.man2TextoSemServico("master"))], [true, false, true]);

console.log("\n=== 25) Conferência 15/09 (tela): grafia do 'Outro', linha da rotina no card, custo, qualidade, pessoas, sino ===\n");
// GRAFIA: "Outro" com o texto de uma opção existente usa a opção (senão vira 2 linhas na Visão gerencial)
const SETORES = ["Açougue", "Frente de caixa", "Frios e Laticínios"];
igual("'Outro' = 'açougue ' usa a opção 'Açougue'; texto novo continua como digitado; opção escolhida passa direto",
  [L.man2ValorComOpcoes("__outro", "açougue ", SETORES), L.man2ValorComOpcoes("__outro", "FRIOS E LATICINIOS", SETORES), L.man2ValorComOpcoes("__outro", "Lanchonete", SETORES), L.man2ValorComOpcoes("Açougue", "", SETORES), L.man2ValorComOpcoes("__outro", "", SETORES)],
  ["Açougue", "Frios e Laticínios", "Lanchonete", "Açougue", ""]);
// VIS-1: a linha da rotina no card não repete a pílula
igual("linha da rotina no card: informa sem repetir a situação", [
  L.man2LinhaRotinaCard(E1.rotinas[0]),
  L.man2LinhaRotinaCard(rot({ periodicidade_dias: 30, proxima: "2026-10-01", estado: "em_dia", dias: 17 })),
  L.man2LinhaRotinaCard(E7.rotinas[0]),
  L.man2LinhaRotinaCard(E9.rotinas[0]),
  L.man2LinhaRotinaCard(E3.rotinas[0]),
  L.man2LinhaRotinaCard(E11.rotinas[0])],
  ["Limpeza · a cada 30 dias · vencido desde 05/08/2026", "Limpeza · a cada 30 dias · próxima 01/10", "Higienização · a cada 7 dias · próxima 14/09",
   "Limpeza · a cada 15 dias · próxima 15/09", "Serviço a confirmar · a cada 7 dias", "Manutenção preventiva"]);
vale("linha da rotina no card nunca traz o texto da pílula", [E1, E2, E3, E7, E8, E9, E11].every((e) => e.rotinas.every((r) => {
  const p = L.man2TextoEstado(r.estado, r.dias, r.proxima).pilula.toLowerCase(), t = L.man2LinhaRotinaCard(r).toLowerCase();
  return t.indexOf(p) < 0 && !/vencido há|vence em \d|vence hoje|em dia|aguardando/.test(t); })), "ok");
// VIS-2: "Custo: Custo não informado" -> "Custo: não informado"
igual("linha do custo sem repetir a palavra", [L.man2TextoCustoLinha(null, "nao_informado"), L.man2TextoCustoLinha(null, "nao_se_aplica"), L.man2TextoCustoLinha(350.5, "informado"), L.man2TextoCustoLinha(0, "informado"), L.man2TextoCustoLinha("oculto", "oculto")],
  ["Custo: não informado", "Custo: interno, sem custo", "Custo: R$ 350,50", "Custo: R$ 0,00", null]);
// VIS-4: qualidade agrupada por tipo quando passa de 3
const QL = [{ tipo: "rotina_tipo_a_confirmar", nome: "B101" }]
  .concat([1, 2, 3].map((i) => ({ tipo: "rotina_sem_responsavel", nome: "R" + i })))
  .concat([1, 2, 3, 4, 5].map((i) => ({ tipo: "equipamento_sem_procedimento", nome: "E" + i })))
  .concat([{ tipo: "custo_nao_informado", nome: "C1" }, { tipo: "custo_nao_informado", nome: "C2" }, { tipo: "custo_nao_informado", nome: "C3" }, { tipo: "custo_nao_informado", nome: "C4" }]);
igual("qualidade: mais de 3 do mesmo tipo vira 1 linha com contagem; até 3 continuam soltos; ordem do banco",
  L.man2AgruparQualidade(QL.concat([null, "lixo"])).map((g) => [g.rotulo, g.agrupado, g.contagem, g.itens.length]),
  [["Rotina migrada: confirmar o tipo de serviço", false, "1 rotina", 1], ["Rotina sem responsável", false, "3 rotinas", 3],
   ["Equipamento sem procedimento escrito", true, "5 equipamentos", 5], ["Serviço de empresa externa sem custo informado", true, "4 serviços", 4]]);
naoQuebra("qualidade vazia/estranha", () => { L.man2AgruparQualidade(null); L.man2AgruparQualidade([{}]); });
// VIS-5: seletor de pessoas mostra no máximo 6 antes de digitar, com prioridade
const PES = Array.from({ length: 45 }, (_, i) => ({ ref: "escala:p" + i, nome: "Pessoa " + String(i).padStart(2, "0"), detalhe: "Setor" }))
  .concat([{ ref: "escala:r0", nome: "Laryze", detalhe: "Açougue" }, { ref: "perfil:u1", nome: "Zé", detalhe: "Frios" }]);
const E_PRIO = eq({ id: "EP", rotinas: [rot({ tipo_servico: "Limpeza", responsavel_ref: "perfil:u1", responsavel_nome: "Zé", ultima_executor_nome: "Pessoa 30" }),
  rot({ tipo_servico: "Inspeção", responsavel_ref: "escala:r0", responsavel_nome: "Laryze" })], ultima_execucao: { data: "2026-09-01", executor_nome: "Pessoa 41" } });
igual("prioridade: responsável da rotina do serviço escolhido primeiro, depois as outras, depois quem já executou",
  L.man2PrioridadePessoas(E_PRIO, "inspecao"), { refs: ["escala:r0", "perfil:u1"], nomes: ["Laryze", "Zé", "Pessoa 30", "Pessoa 41"] });
const sug = L.man2SugestoesPessoas(PES, "", L.man2PrioridadePessoas(E_PRIO, "Inspeção"));
igual("antes de digitar: 6 sugestões com a prioridade na frente e o total da lista", [sug.itens.map((p) => p.nome), sug.total, sug.digitando],
  [["Laryze", "Zé", "Pessoa 30", "Pessoa 41", "Pessoa 00", "Pessoa 01"], 47, false]);
igual("sem prioridade: os 6 primeiros por nome", L.man2SugestoesPessoas(PES, "  ", null).itens.map((p) => p.nome), ["Laryze", "Pessoa 00", "Pessoa 01", "Pessoa 02", "Pessoa 03", "Pessoa 04"]);
const dig = L.man2SugestoesPessoas(PES, "pessoa", L.man2PrioridadePessoas(E_PRIO, ""));
igual("digitando: até 8 resultados e o total encontrado", [dig.itens.length, dig.total, dig.digitando], [8, 45, true]);
naoQuebra("pessoas estranhas", () => { L.man2SugestoesPessoas(null, "", null); L.man2SugestoesPessoas([null, {}, { nome: "A" }], "", { refs: null }); L.man2PrioridadePessoas(null, "x"); });
// VENC-01: página aberta, painel do mesmo dia com contagens novas -> o sino passa a usar as do painel
const RZ = { ok: true, hoje: "2026-09-14", atrasado: 2, hoje_qtd: 1, proximo: 2, pendencias_abertas: 1, minhas_pendencias: 1 };
igual("painel do mesmo dia com contagens diferentes: resumo novo com as do painel (o resto fica)",
  L.man2ResumoComPainel(RZ, { ok: true, hoje: "2026-09-14", contagens: { atrasado: 2, hoje: 0, proximo: 3 } }),
  { ok: true, hoje: "2026-09-14", atrasado: 2, hoje_qtd: 0, proximo: 3, pendencias_abertas: 1, minhas_pendencias: 1 });
igual("contagens iguais, outro dia, painel recusado ou sem número: não mexe", [
  L.man2ResumoComPainel(RZ, { ok: true, hoje: "2026-09-14", contagens: { atrasado: 2, hoje: 1, proximo: 2 } }),
  L.man2ResumoComPainel(RZ, { ok: true, hoje: "2026-09-15", contagens: { atrasado: 5, hoje: 0 } }),
  L.man2ResumoComPainel(RZ, { ok: false, hoje: "2026-09-14", contagens: { atrasado: 5, hoje: 0 } }),
  L.man2ResumoComPainel(RZ, { ok: true, hoje: "2026-09-14", contagens: { atrasado: null, hoje: 0 } }),
  L.man2ResumoComPainel(null, { ok: true, hoje: "2026-09-14", contagens: { atrasado: 1, hoje: 0 } })], [null, null, null, null, null]);
vale("o sino gerado do resumo corrigido não fala mais em 'vence hoje'", !L.man2AvisosDoResumo(L.man2ResumoComPainel(RZ, { ok: true, hoje: "2026-09-14", contagens: { atrasado: 2, hoje: 0, proximo: 3 } })).some((a) => /vence hoje/.test(a.titulo)), "ok");

console.log("\n" + ok + " OK, " + falhou + " falha(s)\n");
process.exit(falhou ? 1 : 0);
