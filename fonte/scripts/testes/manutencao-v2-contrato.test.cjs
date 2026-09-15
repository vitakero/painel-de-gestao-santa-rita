// ============================================================
// MANUTENÇÃO v2 — CONTRATO BANCO <-> TELA, provado RODANDO.
//
// Sobe um PostgreSQL TEMPORÁRIO com as funções REAIS (sql/manutencao_v2_1..4), grava um cenário
// usando os PEDIDOS MONTADOS PELA PRÓPRIA TELA (bloco ==MAN2-LOGICA== do output/index.html) e
// captura o JSON real de cada leitura e gravação. Depois confere:
//   1. cada campo que a tela LÊ existe no JSON real, com o tipo esperado (lista explícita e revisada
//      em ESQUEMA, abaixo), e todo valor de estado/resultado/ação que o banco devolve tem texto na tela;
//   2. cada __SB.rpc('manutencao_...') do bloco ==MAN2== usa nome e parâmetros que existem no banco
//      (lido de pg_proc, não de texto), mandando todos os obrigatórios;
//   3. toda propriedade snake_case lida no bloco ==MAN2== existe em alguma resposta real ou pedido
//      (varredura automática: pega erro de digitação como "hoje_qtde");
//   4. o servidor de mentira (apoio/man2-sb-falso.js, usado pelo teste de tela e pela prévia) devolve
//      o mesmo formato e NÃO inventa campo que o banco não devolve.
//
//   npx tsx scripts/demoDashboard.ts && node scripts/testes/manutencao-v2-contrato.test.cjs
//   MAN2_CONTRATO_DUMP=<pasta> grava os JSONs capturados nessa pasta (para inspeção).
//
// NÃO encosta no Supabase de produção.
// ============================================================
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const B = require("./apoio/banco-de-teste.cjs");
const RAIZ = path.join(__dirname, "..", "..");
const BACKUP = path.join(RAIZ, "backups", "manutencao-2026-09-14-antes-da-evolucao");
// MAN2_CONTRATO_HTML / MAN2_CONTRATO_FALSO: apontar para cópias alteradas de propósito (prova de que o teste reprova)
const HTML_ARQ = process.env.MAN2_CONTRATO_HTML || path.join(RAIZ, "output", "index.html");
const FALSO_ARQ = process.env.MAN2_CONTRATO_FALSO || path.join(__dirname, "apoio", "man2-sb-falso.js");

if (!B.temPostgres()) { console.log("SEM POSTGRES LOCAL — instale com: brew install postgresql@16"); process.exit(1); }
if (!fs.existsSync(HTML_ARQ)) { console.log("ERRO: output/index.html não existe (rode npx tsx scripts/demoDashboard.ts)."); process.exit(1); }

let ok = 0, falhou = 0;
function vale(nome, cond, det) {
  console.log((cond ? "  OK   " : "  FALHA") + " | " + nome + (det !== undefined ? "  ->  " + String(det).slice(0, 900) : ""));
  cond ? ok++ : falhou++;
}

// ---------------- a tela construída ----------------
const HTML = fs.readFileSync(HTML_ARQ, "utf8");
const iMan = HTML.indexOf("/* ==MAN2-INICIO=="), fMan = HTML.indexOf("/* ==MAN2-FIM== */");
if (iMan < 0 || fMan < 0) { console.log("ERRO: bloco ==MAN2== não encontrado no output/index.html"); process.exit(1); }
const MAN2 = HTML.slice(iMan, fMan);
const iLog = HTML.indexOf("==MAN2-LOGICA-INICIO=="), fLog = HTML.indexOf("==MAN2-LOGICA-FIM==");
const LOGICA = HTML.slice(HTML.indexOf("*/", iLog) + 2, HTML.lastIndexOf("/*", fLog));
const L = new Function(LOGICA + "\nreturn {man2MontarPayloadRegistro, man2ValidarRegistro, man2DadosVisiveisRegistro, man2MontarPayloadEquipamento," +
  " man2MontarPayloadLote, man2MontarPayloadRotina, man2PedidoCusto, man2TextoEstado, man2TextoCurto, man2TextoResultado, man2TextoCusto," +
  " man2TextoPendencia, man2TextoAcaoAuditoria, man2TextoQualidade, man2ValidarMotivo};")();

// ---------------- gente ----------------
const U = {
  master: "1f26bb81-b9d1-4c2f-9df8-b259477a02e7",
  gestor: "20000000-0000-0000-0000-000000000001",
  oper:   "20000000-0000-0000-0000-000000000003"
};
let nRq = 1;
const novoRq = () => "71000000-0000-4000-8000-" + String(nRq++).padStart(12, "0");

const pg = B.subir();
function comoR(uid, sql) { return B.rodar(pg, `begin; set local role authenticated; select set_config('teste.uid','${uid}',true); ${sql}; commit;`); }
function j(uid, sql) {
  const r = comoR(uid, sql);
  if (!r.ok) return { __erro: (r.erro.split("\n")[0] || "").trim() };
  try { return JSON.parse(r.saida.split("\n").pop()); } catch (e) { return { __erro: "não é JSON: " + r.saida.slice(0, 200) }; }
}
function su(sql) { return B.rodar(pg, `select set_config('teste.uid','',false); ${sql}`); }
const suV = (sql) => { const r = su(sql); return r.ok ? r.saida.split("\n").pop() : "ERRO SQL: " + r.erro.split("\n")[0]; };
const lit = (o) => "$j$" + JSON.stringify(o) + "$j$::jsonb";
// literal no formato que o PostgREST manda: parâmetro NOMEADO (nome errado = erro do Postgres)
function valorSql(v) {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "object") return lit(v);
  return "$q$" + String(v) + "$q$";
}
const CAP = {};   // nome da RPC -> [{quem, params, r}]
function rpc(quem, nome, params) {
  const uid = U[quem];
  const args = Object.keys(params || {}).map((k) => k + " => " + valorSql(params[k])).join(", ");
  const r = j(uid, `select public.${nome}(${args})`);
  (CAP[nome] = CAP[nome] || []).push({ quem, params, r });
  return r;
}
const okR = (r) => !!(r && r.ok === true);
const mostra = (r) => JSON.stringify(r).slice(0, 300);
// o Storage grava quem enviou (owner/owner_id): aqui, o operacional (gestor liga arquivo de outra pessoa)
function objeto(caminho, dono) {
  const d = dono || U.oper;
  const r = su(`insert into storage.objects (bucket_id, name, metadata, owner, owner_id) values ('manutencoes', '${caminho}', '{"size": 1000}', '${d}', '${d}') on conflict do nothing`);
  if (!r.ok) throw new Error("objeto: " + r.erro);
}
let HOJE = null;
function dia(n) { const d = new Date(HOJE + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

// ============================================================
// ESQUEMA — o que a tela LÊ de cada resposta (revisado linha a linha contra o bloco ==MAN2==).
//   tipos: s texto · n número · b sim/não · d data AAAA-MM-DD · ts data e hora · o objeto · null
//   "s?"  = a chave pode faltar naquele item (mas precisa aparecer em algum)
//   {$nulo:true, ...} = objeto que pode vir null; [x] = lista (cada item confere com x)
// ============================================================
const ESTADOS_EQUIP = ["atrasado", "hoje", "proximo", "primeira", "em_dia", "sem_periodicidade", "sem_programacao", "inativo"];
const ESTADOS_ROTINA = ["atrasado", "hoje", "proximo", "primeira", "em_dia", "sem_periodicidade", "inativo", "desativada"];
const RESULTADOS = ["ok", "observacao", "problema", "legado"];
const SIT_CUSTO = ["nao_se_aplica", "nao_informado", "informado", "oculto"];
const ST_PEND = ["aberta", "resolvida", "cancelada"];
const ACOES = ["criar", "editar", "inativar", "reativar", "excluir", "rotina_criar", "rotina_editar", "rotina_desativar",
  "execucao_registrar", "execucao_anular", "custo_informar", "pendencia_abrir", "pendencia_resolver", "pendencia_cancelar",
  "pendencia_editar", "anexo_adicionar", "anexo_substituir", "anexo_editar", "migracao"];
const QUALIDADE = ["rotina_tipo_a_confirmar", "rotina_sem_periodicidade", "rotina_sem_responsavel", "equipamento_sem_setor",
  "equipamento_sem_procedimento", "equipamento_sem_programacao", "custo_nao_informado", "pendencia_antiga"];
const EN = (lista, nulo) => ({ $enum: lista, $nuloOk: !!nulo });

const ROTINA = {
  id: "s", tipo_servico: "s|null", periodicidade_dias: "n|null", data_inicio: "d|null", responsavel_ref: "s|null",
  responsavel_nome: "s|null", responsavel_perfil_id: "s|null", instrucao: "s|null", exige_foto_antes: "b", exige_foto_depois: "b",
  ativa: "b", versao: "n", ultima_data: "d|null", ultima_executor_nome: "s|null", estado: EN(ESTADOS_ROTINA), dias: "n|null", proxima: "d|null"
};
const PEND = {
  id: "s", status: EN(ST_PEND), descricao: "s", aberta_por_nome: "s|null", aberta_em: "ts", responsavel_nome: "s|null",
  resolvida_por_nome: "s|null", resolvida_em: "ts|null", solucao: "s|null", cancelada_em: "ts|null", cancelada_por_nome: "s|null", cancelada_motivo: "s|null", versao: "n"
};
const EQUIP_PAINEL = {
  id: "s", codigo: "s|null", nome: "s", tipo: "s|null", setor: "s|null", status: "s", versao: "n", estado: EN(ESTADOS_EQUIP),
  dias: "n|null", pendencias_abertas: "n",
  ultima_execucao: { $nulo: true, data: "d", tipo_servico: "s", executor_nome: "s" },
  rotinas: [ROTINA]
};
const ERRO = { ok: "b", erro: "s", mensagem: "s", "campo": "s?" };
const ESQUEMA = {
  manutencao_painel: {
    ok: "b", hoje: "d", papel: "s", gerado_em: "ts", contagens: { atrasado: "n", hoje: "n" },
    equipamentos: [EQUIP_PAINEL],
    pendencias: [Object.assign({ equipamento_id: "s" }, PEND)]
  },
  manutencao_equipamento_detalhe: {
    ok: "b",
    equipamento: Object.assign({}, EQUIP_PAINEL, {
      procedimento: "s|null", link_fabricante: "s|null", manual_fabricante: { $nulo: true, anexo_id: "s", nome: "s" },
      inativado_em: "ts|null", inativado_por_nome: "s|null", inativado_motivo: "s|null"
    }),
    rotinas: [Object.assign({}, ROTINA, { desativada_em: "ts|null", desativada_por_nome: "s|null", desativada_motivo: "s|null" })],
    pendencias: [PEND],
    anexos_equipamento: [{ id: "s", ativo: "b", categoria: "s", caminho: "s", nome_original: "s|null" }]
  },
  manutencao_historico: {
    ok: "b", proximo_cursor: "s|null",
    itens: [{
      id: "s", rotina_id: "s|null", tipo_servico: "s", data_execucao: "d", registrado_em: "ts", registrado_por_nome: "s|null",
      executor_tipo: EN(["interno", "externo", "legado"]), executor_nome: "s", empresa_nome: "s|null", empresa_telefone: "s|null",
      resultado: EN(RESULTADOS), observacao: "s|null", peso_ref: "n|null", peso_medido: "n|null", justificativa_atraso: "s|null",
      responsavel_rotina_snap: "s|null", proxima_prevista_snap: "d|null", anulada: "b", anulada_em: "ts|null",
      anulada_por_nome: "s|null", anulada_motivo: "s|null", pendencia_aberta_id: "s|null", custo: "n|null|s", custo_situacao: EN(SIT_CUSTO),
      anexos: [{ categoria: "s", caminho: "s?", oculto: "b?" }]
    }]
  },
  manutencao_pessoas: { ok: "b", pessoas: [{ ref: "s", nome: "s", detalhe: "s|null", perfil_id: "s|null" }] },
  manutencao_resumo: { ok: "b", atrasado: "n", hoje_qtd: "n", minhas_pendencias: "n" },
  manutencao_gerencial: {
    ok: "b", periodo: { de: "d", ate: "d" }, execucoes_no_periodo: "n",
    no_prazo: { rotina_execucoes: "n", no_prazo: "n", percentual: "n|null", suficiente: "b" },
    atrasos_por_setor: [{ setor: "s", atrasadas: "n", rotinas: "n" }],
    problemas_por_equipamento: [{ equipamento_id: "s", nome: "s", codigo: "s|null", problemas: "n" }],
    reincidencias: [{ equipamento_id: "s", nome: "s", tipo_servico: "s|null", problemas: "n" }],
    pendencias: { abertas: "n", antigas_15_dias: "n", resolvidas_no_periodo: "n", tempo_medio_dias: "n|null" },
    custos: {
      total_informado: "n|null", execucoes_externas: "n", sem_custo_informado: "n",
      por_setor: [{ setor: "s", total: "n|null" }], por_prestador: [{ empresa: "s", total: "n|null", qtd: "n" }]
    },
    qualidade: [{ tipo: EN(QUALIDADE), equipamento_id: "s", nome: "s", detalhe: "s|null" }]
  },
  manutencao_auditoria_listar: {
    ok: "b", proximo_cursor: "n|null",
    itens: [{ em: "ts", usuario_nome: "s|null", acao: EN(ACOES), entidade: "s", item_nome: "s|null", equipamento_id: "s|null",
      entidade_id: "s", antes: "o|null", depois: "o|null", justificativa: "s|null" }]
  },
  // gravações: só o que a tela usa da resposta
  manutencao_execucao_registrar: { ok: "b", id: "s", proxima: "d|null", pendencia_id: "s|null" },
  manutencao_equipamento_salvar: { ok: "b", equipamento: { id: "s", codigo: "s" } },
  manutencao_equipamentos_lote: { ok: "b", criados: [{ id: "s" }] }
};
// erros que a tela trata pelo código (além de mensagem/campo)
const ESQUEMA_ERRO_EXTRA = { manutencao_equipamentos_lote: { nomes: ["s"] } };

function tipoDe(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "a";
  if (typeof v === "object") return "o";
  if (typeof v === "number") return "n";
  if (typeof v === "boolean") return "b";
  if (typeof v === "string") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return "d";
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) && !isNaN(Date.parse(v))) return "ts";
    return "s";
  }
  return typeof v;
}
function tipoAceito(v, spec) {
  const t = tipoDe(v), aceitos = spec.replace("?", "").split("|");
  if (aceitos.indexOf(t) >= 0) return true;
  if (t === "d" || t === "ts") return aceitos.indexOf("s") >= 0;   // data também é texto
  return false;
}
// confere um valor contra o esquema; registra onde a chave apareceu (cobertura)
function conferir(v, esq, cam, probs, cob) {
  if (typeof esq === "string") {
    cob.add(cam);
    if (!tipoAceito(v, esq)) probs.push(cam + ": tipo " + tipoDe(v) + " (esperado " + esq + ") valor " + JSON.stringify(v).slice(0, 60));
    return;
  }
  if (esq && esq.$enum) {
    cob.add(cam);
    if (v === null && esq.$nuloOk) return;
    if (esq.$enum.indexOf(v) < 0) probs.push(cam + ": valor fora da lista conhecida pela tela: " + JSON.stringify(v));
    return;
  }
  if (Array.isArray(esq)) {
    cob.add(cam);
    if (!Array.isArray(v)) { probs.push(cam + ": esperado lista, veio " + tipoDe(v)); return; }
    v.forEach((x) => conferir(x, esq[0], cam + "[]", probs, cob));
    return;
  }
  cob.add(cam);
  if (v === null && esq.$nulo) return;
  if (!v || typeof v !== "object" || Array.isArray(v)) { probs.push(cam + ": esperado objeto, veio " + tipoDe(v)); return; }
  Object.keys(esq).forEach((k) => {
    if (k === "$nulo") return;
    const spec = esq[k], c = cam ? cam + "." + k : k;
    if (!(k in v)) { if (typeof spec === "string" && spec.endsWith("?")) return; probs.push(c + ": FALTA no JSON"); return; }
    conferir(v[k], spec, c, probs, cob);
  });
}
function caminhosEsquema(esq, cam, out) {
  if (typeof esq === "string" || (esq && esq.$enum)) { out.add(cam); return; }
  if (Array.isArray(esq)) { out.add(cam); caminhosEsquema(esq[0], cam + "[]", out); return; }
  out.add(cam);
  Object.keys(esq).forEach((k) => { if (k !== "$nulo") caminhosEsquema(esq[k], cam ? cam + "." + k : k, out); });
}
// todos os caminhos de chave de um JSON ("equipamentos[].rotinas[].estado")
const SEM_DESCER = ["itens[].antes", "itens[].depois", "atual"];
function caminhosJson(v, cam, out) {
  if (Array.isArray(v)) { v.forEach((x) => caminhosJson(x, cam + "[]", out)); return; }
  if (v && typeof v === "object") {
    Object.keys(v).forEach((k) => { const c = cam ? cam + "." + k : k; out.add(c); if (SEM_DESCER.indexOf(c) < 0) caminhosJson(v[k], c, out); });
  }
}
function nomesJson(v, out) {
  if (Array.isArray(v)) { v.forEach((x) => nomesJson(x, out)); return; }
  if (v && typeof v === "object") Object.keys(v).forEach((k) => { out.add(k); if (k !== "antes" && k !== "depois") nomesJson(v[k], out); });
}

try {
  // ============================================================
  console.log("\n=== 0. Banco temporário com as funções REAIS ===\n");
  // ============================================================
  for (const f of ["scripts/testes/apoio/dubles-supabase.sql", "scripts/testes/apoio/dubles-manutencao.sql", "sql/permissoes_padrao.sql"]) {
    const r = B.rodarArquivo(pg, path.join(RAIZ, f));
    if (!r.ok) throw new Error(f + " falhou:\n" + r.erro);
  }
  const EQS = JSON.parse(fs.readFileSync(path.join(BACKUP, "manutencao_equipamentos.json"), "utf8"));
  const REGS = JSON.parse(fs.readFileSync(path.join(BACKUP, "manutencao_registros.json"), "utf8"));
  let r = su(`insert into public.manutencao_equipamentos select * from jsonb_populate_recordset(null::public.manutencao_equipamentos, ${lit(EQS)});
              insert into public.manutencao_registros   select * from jsonb_populate_recordset(null::public.manutencao_registros,   ${lit(REGS)});`);
  if (!r.ok) throw new Error("backup não entrou: " + r.erro);
  r = su(`insert into public.perfis (id, email, nome, setor, is_master, paginas, aprovado) values
    ('${U.master}','m@t','Gilson','Diretoria',true,'[]',true),
    ('${U.gestor}','g@t','Márcia','Manutenção',false,'["manutencoes","manutencoes_gestor"]',true),
    ('${U.oper}','o@t','Laryze','Açougue',false,'["manutencoes"]',true);
    insert into public.escala (id, valor) values ('escala', ${lit({ ver: 3, lista: [{ id: "r0", nome: "Zé da Escala", cargo: "Frios" }, { id: "r1", nome: "(vaga)", cargo: "" }, { nome: "Sem Id", cargo: "" }] })});`);
  if (!r.ok) throw new Error("perfis/escala: " + r.erro);
  for (const f of ["1_estrutura", "2_funcoes", "3_migracao", "4_storage"]) {
    const a = B.rodarArquivo(pg, path.join(RAIZ, "sql", "manutencao_v2_" + f + ".sql"));
    if (!a.ok) throw new Error("manutencao_v2_" + f + ".sql: " + a.erro.split("\n").slice(0, 4).join(" | "));
  }
  const mig = JSON.parse(suV("select public.manutencao_migrar_legado()"));
  vale("instalação + migração dos dados reais do backup", mig.ok === true && mig.rotinas_criadas === 3, JSON.stringify(mig).slice(0, 160));
  HOJE = suV("select public.manutencao_hoje()");

  // ============================================================
  console.log("\n=== 1. Cenário gravado com os PEDIDOS MONTADOS PELA TELA ===\n");
  // ============================================================
  let painelG = rpc("gestor", "manutencao_painel", { p_incluir_inativos: false });
  const eqDoPainel = (id) => (painelG.equipamentos || []).find((e) => e.id === id);

  let s = rpc("gestor", "manutencao_equipamento_salvar", { p: L.man2MontarPayloadEquipamento({ nome: "Balança Contrato 01", tipo: "Balança", setor: "Frente de caixa", procedimento: "1) Zerar a balança.\n2) Pôr o peso padrão.", link_fabricante: "https://exemplo.com/manual" }) });
  vale("equipamento novo pelo pedido da tela", okR(s), mostra(s));
  const EQA = s.equipamento.id;
  s = rpc("gestor", "manutencao_equipamentos_lote", { p: L.man2MontarPayloadLote({ nome: "Freezer Contrato", quantidade: "2", inicio: "1", tipo: "Freezer/Ilha", setor: "Açougue", procedimento: "" }) });
  vale("lote pelo pedido da tela", okR(s) && s.criados.length === 2, mostra(s));
  const EQB = s.criados[0].id, EQC = s.criados[1].id;
  s = rpc("gestor", "manutencao_equipamentos_lote", { p: L.man2MontarPayloadLote({ nome: "Freezer Contrato", quantidade: "3", inicio: "1", tipo: "Freezer/Ilha", setor: "Açougue" }) });
  vale("lote duplicado devolve a lista de nomes", s.ok === false && s.erro === "duplicado", mostra(s));

  const rotForm = (o) => Object.assign({ equipamento_id: EQA, tipo_servico: "", periodicidade_dias: "", data_inicio: "", responsavel_ref: "", responsavel_nome: "",
    responsavel_perfil_id: null, instrucao: "", exige_foto_antes: false, exige_foto_depois: false, justificativa: "", pedirJustificativa: false }, o);
  s = rpc("gestor", "manutencao_rotina_salvar", { p: L.man2MontarPayloadRotina(rotForm({ tipo_servico: "Conferência / aferição", periodicidade_dias: "7", responsavel_ref: "perfil:" + U.oper, responsavel_nome: "Laryze", responsavel_perfil_id: U.oper, instrucao: "Usar o peso padrão de 10 kg" }), null) });
  vale("rotina com responsável de login", okR(s), mostra(s));
  s = rpc("gestor", "manutencao_rotina_salvar", { p: L.man2MontarPayloadRotina(rotForm({ tipo_servico: "Limpeza", responsavel_ref: "escala:r0", responsavel_nome: "Zé da Escala" }), null) });
  vale("rotina sem periodicidade (em branco = null)", okR(s) && s.rotina.periodicidade_dias === null, mostra(s));
  s = rpc("gestor", "manutencao_rotina_salvar", { p: L.man2MontarPayloadRotina(rotForm({ tipo_servico: "Inspeção", periodicidade_dias: "30", exige_foto_depois: false }), null) });
  vale("rotina Inspeção (vai ser desativada)", okR(s), mostra(s));
  const RC = s.rotina;
  s = rpc("gestor", "manutencao_rotina_salvar", { p: L.man2MontarPayloadRotina(rotForm({ equipamento_id: EQB, tipo_servico: "Limpeza", periodicidade_dias: "15", data_inicio: dia(3), responsavel_ref: "livre", responsavel_nome: "Fulano Livre" }), null) });
  vale("rotina com 1ª execução prevista", okR(s) && s.rotina.estado === "proximo", mostra(s));

  ["v2/foto_antes/c1.jpg", "v2/foto_problema/c2.jpg", "v2/nota_fiscal/c3.pdf", "v2/foto_depois/c3.jpg", "v2/nota_fiscal/c4.pdf", "v2/manual_fabricante/c5.pdf"].forEach((c) => objeto(c));
  painelG = rpc("gestor", "manutencao_painel", { p_incluir_inativos: false });

  // registrar: o formulário passa pela validação espelho e pelo "só o que está à vista", como na tela
  function registrarPelaTela(quem, form) {
    const eqP = eqDoPainel(form.equipamento_id);
    const dados = L.man2DadosVisiveisRegistro(Object.assign({ request_id: novoRq(), dia_formulario: HOJE, executor_tipo: "interno", executor_ref: "livre", executor_nome: "",
      empresa_nome: "", empresa_contato: "", empresa_telefone: "", custo: "", resultado: "", observacao: "", problema_descricao: "",
      justificativa_atraso: "", peso_ref: "", peso_medido: "", arquivos: {} }, form), eqP);
    const v = L.man2ValidarRegistro(dados, { hoje: HOJE, papel: quem === "oper" ? "operacional" : "gestor", equipamento: eqP });
    if (!v.ok) return { validacaoDaTela: v };
    return rpc(quem, "manutencao_execucao_registrar", { p: L.man2MontarPayloadRegistro(dados, quem === "oper" ? "operacional" : "gestor") });
  }
  const arq = (cat, caminho, mime) => ({ caminho, mime, bytes: 1000, nome_original: cat + ".arq" });
  let x = registrarPelaTela("oper", { equipamento_id: EQA, tipo_servico: "Conferência / aferição", data_execucao: dia(-10), justificativa_atraso: "Estava sem internet",
    executor_ref: "perfil:" + U.oper, executor_nome: "Laryze", resultado: "problema", problema_descricao: "Visor trincado", peso_ref: "10,000", peso_medido: "9,980",
    arquivos: { foto_antes: arq("foto_antes", "v2/foto_antes/c1.jpg", "image/jpeg") } });
  vale("registrar (operacional, balança, peso, foto, problema) pelo pedido da tela", okR(x) && !!x.pendencia_id && !!x.proxima, mostra(x));
  const X1 = x.id;
  x = registrarPelaTela("oper", { equipamento_id: EQA, tipo_servico: "Conferência / aferição", data_execucao: dia(-2), executor_ref: "escala:r0", executor_nome: "Zé da Escala",
    resultado: "problema", problema_descricao: "Visor ainda trincado", arquivos: { foto_problema: arq("foto_problema", "v2/foto_problema/c2.jpg", "image/jpeg") } });
  vale("2º problema na mesma rotina (reincidência)", okR(x), mostra(x));
  const P2 = x.pendencia_id;
  x = registrarPelaTela("gestor", { equipamento_id: EQA, tipo_servico: "Manutenção corretiva (conserto)", data_execucao: dia(-1), executor_tipo: "externo",
    empresa_nome: "TecBalanças", empresa_contato: "Carlos", empresa_telefone: "(84) 99999-0000", custo: "350,50", resultado: "observacao", observacao: "Visor trocado",
    arquivos: { nota_fiscal: arq("nota_fiscal", "v2/nota_fiscal/c3.pdf", "application/pdf"), foto_depois: arq("foto_depois", "v2/foto_depois/c3.jpg", "image/jpeg") } });
  vale("registrar externo com custo (gestor) pelo pedido da tela", okR(x) && x.proxima === null, mostra(x));
  const X3 = x.id;
  x = registrarPelaTela("oper", { equipamento_id: EQA, tipo_servico: "Troca de peça", data_execucao: dia(0), executor_tipo: "externo", empresa_nome: "Eletro Sem Custo",
    custo: "999", resultado: "ok", arquivos: { nota_fiscal: arq("nota_fiscal", "v2/nota_fiscal/c4.pdf", "application/pdf") } });
  vale("registrar externo pelo operacional (nota anexada, custo não vai)", okR(x), mostra(x));
  x = registrarPelaTela("gestor", { equipamento_id: EQA, tipo_servico: "Conferência / aferição", data_execucao: dia(0), executor_ref: "livre", executor_nome: "Márcia", resultado: "ok", peso_ref: "10", peso_medido: "10" });
  vale("registrar interno (será anulado)", okR(x), mostra(x));
  const X5 = x.id;
  const xRep = rpc("gestor", "manutencao_execucao_registrar", { p: (CAP.manutencao_execucao_registrar.slice(-1)[0].params.p) });
  vale("reenvio do MESMO pedido: mesmo id, repetido=true", okR(xRep) && xRep.id === X5 && xRep.repetido === true, mostra(xRep));
  x = registrarPelaTela("oper", { equipamento_id: EQA, tipo_servico: "Limpeza", data_execucao: dia(1), executor_nome: "Laryze", resultado: "ok" });
  vale("data no futuro: a validação espelho da tela segura antes do banco", !!x.validacaoDaTela && x.validacaoDaTela.campo === "data_execucao", mostra(x));
  const xFut = rpc("oper", "manutencao_execucao_registrar", { p: { request_id: novoRq(), equipamento_id: EQA, tipo_servico: "Limpeza", data_execucao: dia(1), executor: { tipo: "interno", ref: "livre", nome: "Laryze" }, resultado: "ok" } });
  vale("…e o banco recusa igual (invalido/data_execucao)", xFut.ok === false && xFut.erro === "invalido" && xFut.campo === "data_execucao", mostra(xFut));

  s = rpc("gestor", "manutencao_execucao_anular", { p_id: X5, p_motivo: L.man2ValidarMotivo("Lançado em duplicidade", 5).texto });
  vale("anular", okR(s), mostra(s));
  s = rpc("gestor", "manutencao_custo_informar", L.man2PedidoCusto(X3, "400,00", true, "Nota corrigida").params);
  vale("corrigir custo pelo pedido da tela (man2PedidoCusto)", okR(s) && s.custo === 400, mostra(s));
  const pcSem = L.man2PedidoCusto(X3, "10", true, "");
  vale("corrigir custo sem motivo: a validação espelho da tela segura (campo motivo)", pcSem.ok === false && pcSem.campo === "motivo", JSON.stringify(pcSem));
  s = rpc("gestor", "manutencao_custo_informar", { p_execucao_id: X3, p_custo: 10, p_motivo: null });
  vale("…e o banco recusa igual (campo motivo)", s.ok === false && s.campo === "motivo", mostra(s));
  s = rpc("gestor", "manutencao_anexo_equipamento", { p: { equipamento_id: EQA, categoria: "manual_fabricante", caminho: "v2/manual_fabricante/c5.pdf", nome_original: "manual.pdf", mime: "application/pdf", bytes: 1000 } });
  vale("manual do fabricante", okR(s), mostra(s));
  s = rpc("oper", "manutencao_pendencia_abrir", { p: { request_id: novoRq(), equipamento_id: EQB, descricao: "Porta desalinhada", responsavel: { ref: "perfil:" + U.oper, nome: "Laryze", perfil_id: U.oper } } });
  vale("abrir pendência", okR(s), mostra(s));
  s = rpc("gestor", "manutencao_pendencia_abrir", { p: { request_id: novoRq(), equipamento_id: EQB, descricao: "Lâmpada queimada" } });
  const P4 = s.id;
  let detA = rpc("gestor", "manutencao_equipamento_detalhe", { p_id: EQA });
  const P1 = (detA.pendencias || []).find((p) => p.descricao === "Visor trincado");
  s = rpc("oper", "manutencao_pendencia_resolver", { p_id: P1.id, p_versao: P1.versao, p_solucao: "Visor trocado pela TecBalanças", p_execucao_id: X3 });
  vale("resolver pendência (parâmetros da fila da tela)", okR(s), mostra(s));
  s = rpc("oper", "manutencao_pendencia_resolver", { p_id: P1.id, p_versao: P1.versao, p_solucao: "de novo", p_execucao_id: null });
  vale("reenviar o resolver depois de gravado: recusa clara ({ok:false}, não raise)", s.ok === false && !!s.erro && !!s.mensagem, mostra(s));
  s = rpc("gestor", "manutencao_pendencia_cancelar", { p_id: P4, p_versao: 1, p_motivo: "Aberta por engano" });
  vale("cancelar pendência", okR(s), mostra(s));
  s = rpc("gestor", "manutencao_rotina_desativar", { p_id: RC.id, p_versao: RC.versao, p_motivo: "Não se aplica mais" });
  vale("desativar rotina", okR(s), mostra(s));
  painelG = rpc("gestor", "manutencao_painel", { p_incluir_inativos: false });
  const RA = eqDoPainel(EQA).rotinas.find((q) => q.tipo_servico === "Conferência / aferição");
  s = rpc("gestor", "manutencao_rotina_salvar", { p: L.man2MontarPayloadRotina(rotForm({ tipo_servico: RA.tipo_servico, periodicidade_dias: "14", responsavel_ref: RA.responsavel_ref, responsavel_nome: RA.responsavel_nome, responsavel_perfil_id: RA.responsavel_perfil_id, instrucao: RA.instrucao }), RA) });
  vale("editar periodicidade sem justificativa: banco pede (campo justificativa, a tela mostra o campo)", s.ok === false && s.campo === "justificativa", mostra(s));
  s = rpc("gestor", "manutencao_rotina_salvar", { p: L.man2MontarPayloadRotina(rotForm({ tipo_servico: RA.tipo_servico, periodicidade_dias: "14", responsavel_ref: RA.responsavel_ref, responsavel_nome: RA.responsavel_nome, responsavel_perfil_id: RA.responsavel_perfil_id, instrucao: RA.instrucao, justificativa: "Balança nova", pedirJustificativa: true }), RA) });
  vale("editar rotina com justificativa pelo pedido da tela", okR(s) && s.rotina.periodicidade_dias === 14, mostra(s));
  const eqA = eqDoPainel(EQA);
  s = rpc("gestor", "manutencao_equipamento_salvar", { p: L.man2MontarPayloadEquipamento({ id: EQA, versao: eqA.versao - 1, nome: "Balança Contrato 01", tipo: "Balança", setor: "Frente de caixa", procedimento: "x", link_fabricante: "" }) });
  vale("editar com versão velha: conflito", s.ok === false && s.erro === "conflito", mostra(s));
  s = rpc("gestor", "manutencao_equipamento_salvar", { p: L.man2MontarPayloadEquipamento({ id: EQA, versao: eqA.versao, nome: "Balança Contrato 01", tipo: "Balança", setor: "Frente de caixa", procedimento: "1) Zerar a balança.", link_fabricante: "https://exemplo.com/manual" }) });
  vale("editar com a versão lida", okR(s), mostra(s));
  // reenvio do formulário (PED-01) e nome repetido (DUP-NOME) com o pedido montado pela tela
  const formRq = { request_id: novoRq(), nome: "Balança Contrato Reenvio", tipo: "Balança", setor: "Frente de caixa" };
  const rq1 = rpc("gestor", "manutencao_equipamento_salvar", { p: L.man2MontarPayloadEquipamento(formRq) });
  const rq2 = rpc("gestor", "manutencao_equipamento_salvar", { p: L.man2MontarPayloadEquipamento(formRq) });
  const rq3 = rpc("gestor", "manutencao_equipamento_salvar", { p: L.man2MontarPayloadEquipamento(Object.assign({}, formRq, { setor: "Açougue" })) });
  vale("pedido da tela reenviado igual: o mesmo equipamento; reenviado com dado mudado: conflito (campo request_id)",
    okR(rq1) && okR(rq2) && rq2.equipamento.id === rq1.equipamento.id && rq3.ok === false && rq3.erro === "conflito" && rq3.campo === "request_id", mostra(rq3));
  const dupNome = rpc("gestor", "manutencao_equipamento_salvar", { p: L.man2MontarPayloadEquipamento({ nome: "balança contrato 01", tipo: "Balança", setor: "Frente de caixa" }) });
  vale("cadastro simples pelo pedido da tela com nome de equipamento ativo: duplicado (campo nome)", dupNome.ok === false && dupNome.erro === "duplicado" && dupNome.campo === "nome", mostra(dupNome));
  const eqCp = eqDoPainel(EQC);
  s = rpc("gestor", "manutencao_equipamento_inativar", { p_id: EQC, p_versao: eqCp.versao, p_motivo: "Vendido para outra loja" });
  vale("inativar", okR(s), mostra(s));
  const versaoEQC = s.equipamento && s.equipamento.versao;
  s = rpc("gestor", "manutencao_equipamento_salvar", { p: L.man2MontarPayloadEquipamento({ nome: "Sem Histórico", tipo: "Gerador", setor: "Depósito/Estoque" }) });
  const EQD = s.equipamento.id;
  s = rpc("master", "manutencao_equipamento_excluir", { p_id: EQD, p_senha: "errada" });
  vale("excluir com senha errada: {ok:false, senha_incorreta}", s.ok === false && s.erro === "senha_incorreta", mostra(s));
  s = rpc("master", "manutencao_equipamento_excluir", { p_id: EQA, p_senha: "senha-do-master" });
  vale("excluir equipamento com histórico: tem_historico", s.ok === false && s.erro === "tem_historico", mostra(s));
  s = rpc("master", "manutencao_equipamento_excluir", { p_id: EQD, p_senha: "senha-do-master" });
  vale("excluir sem histórico com a senha certa", okR(s), mostra(s));

  // ============================================================
  console.log("\n=== 2. Leituras reais capturadas ===\n");
  // ============================================================
  rpc("oper", "manutencao_painel", { p_incluir_inativos: false });
  rpc("gestor", "manutencao_painel", { p_incluir_inativos: true });
  rpc("master", "manutencao_painel", { p_incluir_inativos: false });
  rpc("oper", "manutencao_equipamento_detalhe", { p_id: EQA });
  rpc("gestor", "manutencao_equipamento_detalhe", { p_id: EQA });
  rpc("gestor", "manutencao_equipamento_detalhe", { p_id: EQB });
  rpc("gestor", "manutencao_equipamento_detalhe", { p_id: EQC });
  const detInat = rpc("oper", "manutencao_equipamento_detalhe", { p_id: EQC });
  vale("detalhe de inativo para o operacional: {ok:false, inativo}", detInat.ok === false && detInat.erro === "inativo", mostra(detInat));
  rpc("oper", "manutencao_equipamento_detalhe", { p_id: "nao-existe" });
  rpc("oper", "manutencao_historico", { p_equipamento_id: EQA, p_limite: 20, p_antes_de: null });
  rpc("gestor", "manutencao_historico", { p_equipamento_id: EQA, p_limite: 20, p_antes_de: null });
  const h2 = rpc("gestor", "manutencao_historico", { p_equipamento_id: EQA, p_limite: 2, p_antes_de: null });
  const h3 = rpc("gestor", "manutencao_historico", { p_equipamento_id: EQA, p_limite: 2, p_antes_de: h2.proximo_cursor });
  vale("histórico: cursor = id da última linha e a página seguinte continua dali", typeof h2.proximo_cursor === "string" && h2.itens[1].id === h2.proximo_cursor && okR(h3) && h3.itens[0].id !== h2.itens[1].id, mostra(h3).slice(0, 120));
  rpc("gestor", "manutencao_historico", { p_equipamento_id: "emr9b5cgj174", p_limite: 20, p_antes_de: null });
  rpc("oper", "manutencao_pessoas", {});
  rpc("oper", "manutencao_resumo", {});
  rpc("gestor", "manutencao_resumo", {});
  [30, 90, 365].forEach((d) => rpc("gestor", "manutencao_gerencial", { p_dias: d }));
  rpc("gestor", "manutencao_auditoria_listar", { p_equipamento_id: null, p_limite: 50, p_antes_de: null });
  const a1 = rpc("gestor", "manutencao_auditoria_listar", { p_equipamento_id: EQA, p_limite: 3, p_antes_de: null });
  rpc("gestor", "manutencao_auditoria_listar", { p_equipamento_id: EQA, p_limite: 3, p_antes_de: a1.proximo_cursor });
  vale("auditoria: cursor numérico", typeof a1.proximo_cursor === "number", a1.proximo_cursor);
  // reativar por último (as leituras acima precisavam do equipamento inativo)
  s = rpc("gestor", "manutencao_equipamento_reativar", { p_id: EQC, p_versao: versaoEQC });
  vale("reativar com a versão lida", okR(s) && s.equipamento.status === "ativo", mostra(s));
  const semRaise = Object.keys(CAP).map((n) => CAP[n].filter((c) => c.r && c.r.__erro).map((c) => n + ": " + c.r.__erro)).flat();
  vale("nenhuma chamada deu erro do Postgres (nome/tipo de parâmetro errado, raise)", semRaise.length === 0, semRaise.join(" || ") || "nenhuma");
  if (process.env.MAN2_CONTRATO_DUMP) {
    fs.mkdirSync(process.env.MAN2_CONTRATO_DUMP, { recursive: true });
    fs.writeFileSync(path.join(process.env.MAN2_CONTRATO_DUMP, "capturas-sql.json"), JSON.stringify(CAP, null, 1));
  }

  // ============================================================
  console.log("\n=== 3. Cada campo que a tela lê existe no JSON REAL, com o tipo certo ===\n");
  // ============================================================
  const COB_SQL = {};
  Object.keys(ESQUEMA).forEach((nome) => {
    const caps = (CAP[nome] || []).filter((c) => okR(c.r));
    const probs = [], cob = new Set();
    caps.forEach((c) => conferir(c.r, ESQUEMA[nome], "", probs, cob));
    const todos = new Set(); caminhosEsquema(ESQUEMA[nome], "", todos);
    const naoVistos = [...todos].filter((c) => c && !cob.has(c));
    COB_SQL[nome] = cob;
    vale(nome + ": " + caps.length + " resposta(s) real(is) conferida(s)", caps.length > 0 && probs.length === 0, probs.slice(0, 8).join(" || ") || "tudo presente e com o tipo certo");
    vale(nome + ": o cenário exercitou todos os campos lidos", naoVistos.length === 0, naoVistos.join(", ") || "todos");
  });
  // recusas: a fila e os formulários leem erro/mensagem/campo
  const erros = [];
  Object.keys(CAP).forEach((n) => CAP[n].forEach((c) => { if (c.r && c.r.ok === false) { const p = []; conferir(c.r, Object.assign({}, ERRO, ESQUEMA_ERRO_EXTRA[n] && c.r.erro === "duplicado" ? ESQUEMA_ERRO_EXTRA[n] : {}), n, p, new Set()); erros.push(...p); } }));
  vale("toda recusa do banco traz ok:false, erro e mensagem (e nomes no lote duplicado)", erros.length === 0, erros.join(" || ") || "ok");

  // todo valor de estado/resultado/ação/qualidade que o banco devolveu tem texto próprio na tela
  const vistos = { estadoEq: new Set(), estadoRot: new Set(), resultado: new Set(), sitCusto: new Set(), stPend: new Set(), acao: new Set(), qualidade: new Set() };
  (CAP.manutencao_painel || []).concat(CAP.manutencao_equipamento_detalhe || []).forEach((c) => {
    if (!okR(c.r)) return;
    (c.r.equipamentos || [c.r.equipamento]).forEach((e) => { vistos.estadoEq.add(e.estado); (e.rotinas || []).forEach((q) => vistos.estadoRot.add(q.estado)); });
    (c.r.rotinas || []).forEach((q) => vistos.estadoRot.add(q.estado));
    (c.r.pendencias || []).forEach((p) => vistos.stPend.add(p.status));
  });
  (CAP.manutencao_historico || []).forEach((c) => okR(c.r) && c.r.itens.forEach((i) => { vistos.resultado.add(i.resultado); vistos.sitCusto.add(i.custo_situacao); }));
  (CAP.manutencao_auditoria_listar || []).forEach((c) => okR(c.r) && c.r.itens.forEach((i) => vistos.acao.add(i.acao)));
  (CAP.manutencao_gerencial || []).forEach((c) => okR(c.r) && c.r.qualidade.forEach((q) => vistos.qualidade.add(q.tipo)));
  const semTexto = [];
  ESTADOS_EQUIP.forEach((e) => { if (/desconhecida/i.test(L.man2TextoEstado(e, -1, "2026-01-01").pilula)) semTexto.push("estado do equipamento " + e); });
  ESTADOS_ROTINA.forEach((e) => { if (/desconhecida/i.test(L.man2TextoCurto(e, 3, "2026-01-01")) || /desconhecida/i.test(L.man2TextoEstado(e, 3, "2026-01-01").pilula)) semTexto.push("estado da rotina " + e); });
  RESULTADOS.forEach((v) => { if (/não informado/.test(L.man2TextoResultado(v).texto)) semTexto.push("resultado " + v); });
  ST_PEND.forEach((v) => { if (v !== "aberta" && L.man2TextoPendencia(v).texto === "Problema pendente") semTexto.push("pendência " + v); });
  ACOES.forEach((v) => { if (L.man2TextoAcaoAuditoria(v, "rotina") === v) semTexto.push("ação da auditoria " + v); });
  QUALIDADE.forEach((v) => { if (/^Conferir:/.test(L.man2TextoQualidade(v))) semTexto.push("qualidade " + v); });
  vale("a tela tem texto para TODO valor possível de estado, resultado, pendência, ação e qualidade", semTexto.length === 0, semTexto.join(", ") || "todos");
  const fora = [];
  [["estadoEq", ESTADOS_EQUIP], ["estadoRot", ESTADOS_ROTINA], ["resultado", RESULTADOS], ["sitCusto", SIT_CUSTO], ["stPend", ST_PEND], ["acao", ACOES], ["qualidade", QUALIDADE]]
    .forEach(([k, lista]) => vistos[k].forEach((v) => { if (lista.indexOf(v) < 0) fora.push(k + "=" + v); }));
  vale("o banco não devolveu valor fora dessas listas", fora.length === 0, fora.join(", ") || "nenhum; vistos: " + Object.keys(vistos).map((k) => k + "=" + [...vistos[k]].join("/")).join(" · "));
  vale("excluir da rotina tem texto próprio (não diz 'equipamento')", !/equipamento/i.test(L.man2TextoAcaoAuditoria("excluir", "rotina")), L.man2TextoAcaoAuditoria("excluir", "rotina"));

  // ============================================================
  console.log("\n=== 4. Nome e parâmetros de cada chamada da tela = pg_proc ===\n");
  // ============================================================
  const PROCS = {};
  suV(`select string_agg(p.proname||'#'||coalesce(array_to_string(p.proargnames,','),'')||'#'||p.pronargs||'#'||p.pronargdefaults, ';')
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='public' and p.proname like 'manutencao\\_%' and p.proname not like 'manutencao\\_\\_%'`)
    .split(";").forEach((l) => { const [nome, args, n, def] = l.split("#"); const nomes = args ? args.split(",").slice(0, +n) : []; PROCS[nome] = { nomes, obrig: nomes.slice(0, +n - +def) }; });
  // chaves do primeiro nível de um objeto literal JS começando em src[i] === "{"
  function chavesLiteral(src, i) {
    let prof = 0, k = i, chaves = [], esperandoChave = true, str = null;
    for (; k < src.length; k++) {
      const ch = src[k];
      if (str) { if (ch === "\\") { k++; continue; } if (ch === str) str = null; continue; }
      if (ch === '"' || ch === "'") { str = ch; continue; }
      if ("{([".indexOf(ch) >= 0) { prof++; if (prof === 1) esperandoChave = true; continue; }
      if ("})]".indexOf(ch) >= 0) { prof--; if (prof === 0) return chaves; continue; }
      if (prof === 1) {
        if (ch === ",") { esperandoChave = true; continue; }
        if (esperandoChave && /[A-Za-z_$]/.test(ch)) {
          const m = /^([A-Za-z_$][\w$]*)\s*:/.exec(src.slice(k));
          if (m) { chaves.push(m[1]); k += m[0].length - 1; }
          esperandoChave = false;
        } else if (!/\s/.test(ch)) esperandoChave = false;
      }
    }
    return chaves;
  }
  const chamadas = [];
  const reCall = /(?:man2Rpc|man2RpcOnline)\("(manutencao_[a-z_]+)",\s*/g;
  let mm;
  while ((mm = reCall.exec(MAN2))) {
    const i = mm.index + mm[0].length;
    chamadas.push({ nome: mm[1], chaves: MAN2[i] === "{" ? chavesLiteral(MAN2, i) : null, trecho: MAN2.slice(i, i + 40) });
  }
  const reFila = /rpc:"(manutencao_[a-z_]+)",params:/g;
  while ((mm = reFila.exec(MAN2))) { const i = mm.index + mm[0].length; chamadas.push({ nome: mm[1], chaves: MAN2[i] === "{" ? chavesLiteral(MAN2, i) : null, trecho: MAN2.slice(i, i + 40) }); }
  // parâmetros montados por função pura: executa a função da tela
  chamadas.forEach((c) => { if (!c.chaves && /pc\.params/.test(c.trecho)) c.chaves = Object.keys(L.man2PedidoCusto("x", "1", false, null).params); });
  const nomesChamados = [...new Set(chamadas.map((c) => c.nome))].sort();
  vale("achei as chamadas da tela (" + chamadas.length + " pontos, " + nomesChamados.length + " funções)", chamadas.length >= 20, nomesChamados.join(", "));
  const probChamada = [];
  chamadas.forEach((c) => {
    const pr = PROCS[c.nome];
    if (!pr) { probChamada.push(c.nome + ": NÃO EXISTE no banco"); return; }
    if (!c.chaves) { probChamada.push(c.nome + ": parâmetros não literais (" + c.trecho + ")"); return; }
    c.chaves.forEach((k) => { if (pr.nomes.indexOf(k) < 0) probChamada.push(c.nome + ": parâmetro " + k + " não existe (banco: " + pr.nomes.join(",") + ")"); });
    pr.obrig.forEach((k) => { if (c.chaves.indexOf(k) < 0) probChamada.push(c.nome + ": faltou o obrigatório " + k); });
  });
  vale("toda chamada usa função que existe, parâmetros com o nome do banco e todos os obrigatórios", probChamada.length === 0, probChamada.join(" || ") || "ok");
  const naoUsadas = Object.keys(PROCS).filter((n) => nomesChamados.indexOf(n) < 0 && ["manutencao_papel", "manutencao_pode_gerir", "manutencao_hoje", "manutencao_estado", "manutencao_migrar_legado", "manutencao_conferir_migracao", "manutencao_pendencia_abrir"].indexOf(n) < 0);
  vale("toda função do contrato usada pela tela é chamada (fora papel/hoje/estado/migração e abrir pendência avulsa)", naoUsadas.length === 0, naoUsadas.join(", ") || "todas");

  // chaves dentro do jsonb "p": toda chave que a tela manda é lida pela função
  const SQLF = fs.readFileSync(path.join(RAIZ, "sql", "manutencao_v2_2_funcoes.sql"), "utf8");
  function corpo(nome) { const i = SQLF.indexOf("create or replace function public." + nome + "("); return i < 0 ? "" : SQLF.slice(i, SQLF.indexOf("end $$;", i)); }
  const lidasPor = (nome) => { const c = corpo(nome) + corpo("manutencao__responsavel") + corpo("manutencao__anexo_erro"); return (k) => c.indexOf("'" + k + "'") >= 0; };
  const probP = [];
  ["manutencao_execucao_registrar", "manutencao_equipamento_salvar", "manutencao_equipamentos_lote", "manutencao_rotina_salvar", "manutencao_anexo_equipamento"].forEach((nome) => {
    const lida = lidasPor(nome);
    (CAP[nome] || []).forEach((c) => {
      const p = c.params.p || {};
      const cams = new Set(); nomesJson(p, cams);
      cams.forEach((k) => { if (!lida(k)) probP.push(nome + ": chave '" + k + "' do pedido não é lida pela função"); });
    });
  });
  vale("toda chave dos pedidos jsonb montados pela tela é lida pela função do banco", probP.length === 0, [...new Set(probP)].join(" || ") || "ok");

  // ============================================================
  console.log("\n=== 5. Varredura: toda propriedade snake_case lida no bloco ==MAN2== existe ===\n");
  // ============================================================
  const universo = new Set();
  Object.keys(CAP).forEach((n) => CAP[n].forEach((c) => { nomesJson(c.r, universo); nomesJson(c.params, universo); }));
  Object.keys(PROCS).forEach((n) => PROCS[n].nomes.forEach((k) => universo.add(k)));
  // não vêm do banco da Manutenção (revisado): ficha do login e contagens calculadas na própria tela
  ["is_master"].forEach((k) => universo.add(k));
  const lidas = new Set();
  const reProp = /\.([a-z][a-z0-9]*_[a-z0-9_]+)\b/g;
  while ((mm = reProp.exec(MAN2))) lidas.add(mm[1]);
  const desconhecidas = [...lidas].filter((k) => !universo.has(k)).sort();
  vale(lidas.size + " propriedades snake_case lidas; todas existem em resposta real ou pedido", desconhecidas.length === 0, desconhecidas.join(", ") || "todas");

  // ============================================================
  console.log("\n=== 6. Servidor de mentira (teste de tela e prévia) = mesmo formato, sem inventar campo ===\n");
  // ============================================================
  const FALSO_SRC = fs.readFileSync(FALSO_ARQ, "utf8");
  function falso(papel) {
    const win = { __MAN2_CFG: { papel, hoje: "2026-09-14" } };
    const ctx = vm.createContext({ window: win, location: { search: "" }, URLSearchParams, Proxy, setTimeout, clearTimeout, Promise, JSON, Date, Math, console });
    vm.runInContext(FALSO_SRC, ctx, { filename: "man2-sb-falso.js" });
    return win.__man2Falso;
  }
  const CAPF = {};
  function rpcF(F, nome, params) {
    const fn = F.RPC[nome];
    let r; try { r = fn ? JSON.parse(JSON.stringify(fn(params || {}))) : { __erro: "não existe no falso" }; } catch (e) { r = { __erro: "exceção: " + e.message }; }
    (CAPF[nome] = CAPF[nome] || []).push({ params, r });
    return r;
  }
  const Fo = falso("operacional"), Fg = falso("gestor"), Fm = falso("master");
  // gravações no falso, com pedidos da tela, para cobrir os mesmos formatos
  let fr;
  Fg.S.storage["v2/manual_fabricante/f1.pdf"] = { bytes: 1000, mime: "application/pdf" };
  Fg.S.storage["v2/nota_fiscal/f2.pdf"] = { bytes: 1000, mime: "application/pdf" };
  fr = rpcF(Fg, "manutencao_anexo_equipamento", { p: { equipamento_id: "emr9b5cgj174", categoria: "manual_fabricante", caminho: "v2/manual_fabricante/f1.pdf", nome_original: "manual.pdf", mime: "application/pdf", bytes: 1000 } });
  vale("falso: manual do fabricante", okR(fr), mostra(fr));
  fr = rpcF(Fg, "manutencao_execucao_registrar", { p: L.man2MontarPayloadRegistro({ request_id: "72000000-0000-4000-8000-000000000001", equipamento_id: "eqgelbeb", tipo_servico: "Higienização",
    data_execucao: "2026-09-14", executor_tipo: "externo", empresa_nome: "Frio Exemplo", empresa_contato: "Ana", custo: "", resultado: "problema", problema_descricao: "Borracha solta",
    anexos: [{ categoria: "nota_fiscal", caminho: "v2/nota_fiscal/f2.pdf", mime: "application/pdf", bytes: 1000, nome_original: "nf.pdf" }] }, "gestor") });
  vale("falso: registrar externo com problema", okR(fr) && !!fr.pendencia_id, mostra(fr));
  fr = rpcF(Fg, "manutencao_execucao_registrar", { p: L.man2MontarPayloadRegistro({ request_id: "72000000-0000-4000-8000-000000000002", equipamento_id: "eqbalcao", tipo_servico: "Inspeção",
    data_execucao: "2026-09-13", executor_tipo: "interno", executor_ref: "escala:r1", executor_nome: "Zé", resultado: "problema", problema_descricao: "Luz do balcão piscando" }, "gestor") });
  vale("falso: registrar interno avulso com problema", okR(fr) && !!fr.pendencia_id && fr.proxima === null, mostra(fr));
  // a pendência da Camera Fria Resfriado (semente) continua aberta: a lista do painel precisa ter item
  const fDetG = rpcF(Fg, "manutencao_equipamento_detalhe", { p_id: "eqgelbeb" });
  const fPendG = (fDetG.pendencias || []).find((p) => p.status === "aberta");
  fr = rpcF(Fg, "manutencao_pendencia_cancelar", { p_id: fPendG.id, p_versao: fPendG.versao, p_motivo: "Aberta por engano" });
  vale("falso: cancelar pendência", okR(fr), mostra(fr));
  const fDetB = rpcF(Fg, "manutencao_equipamento_detalhe", { p_id: "eqbalcao" });
  const fPendB = (fDetB.pendencias || []).find((p) => p.status === "aberta");
  fr = rpcF(Fg, "manutencao_pendencia_resolver", { p_id: fPendB.id, p_versao: fPendB.versao, p_solucao: "Reator trocado", p_execucao_id: null });
  vale("falso: resolver pendência", okR(fr), mostra(fr));
  fr = rpcF(Fg, "manutencao_pendencia_resolver", { p_id: fPendB.id, p_versao: fPendB.versao, p_solucao: "de novo", p_execucao_id: null });
  vale("falso: resolver de novo com a versão velha = conflito (igual ao banco)", fr.ok === false && fr.erro === "conflito", mostra(fr));
  rpcF(Fg, "manutencao_equipamento_detalhe", { p_id: "emraqg6gz805" });
  const fRot = Fg.eqItem(Fg.achaEq("eqfreezer")).rotinas[0];
  fr = rpcF(Fg, "manutencao_rotina_desativar", { p_id: fRot.id, p_versao: fRot.versao, p_motivo: "Não se aplica mais" });
  vale("falso: desativar rotina", okR(fr), mostra(fr));
  fr = rpcF(Fg, "manutencao_rotina_salvar", { p: L.man2MontarPayloadRotina(rotForm({ equipamento_id: "eqgerador", tipo_servico: "Inspeção", periodicidade_dias: "90", responsavel_ref: "escala:r1", responsavel_nome: "Zé" }), null) });
  vale("falso: rotina nova", okR(fr), mostra(fr));
  fr = rpcF(Fg, "manutencao_equipamento_salvar", { p: L.man2MontarPayloadEquipamento({ nome: "Forno Exemplo", tipo: "Forno", setor: "Padaria" }) });
  vale("falso: equipamento novo", okR(fr), mostra(fr));
  fr = rpcF(Fg, "manutencao_equipamentos_lote", { p: L.man2MontarPayloadLote({ nome: "Balanças Caixa", quantidade: "3", inicio: "101", tipo: "Balança", setor: "Frente de caixa" }) });
  vale("falso: lote duplicado", fr.ok === false && fr.erro === "duplicado", mostra(fr));
  fr = rpcF(Fg, "manutencao_equipamentos_lote", { p: L.man2MontarPayloadLote({ nome: "Balança Teste", quantidade: "2", inicio: "8", tipo: "Balança", setor: "Frente de caixa" }) });
  vale("falso: lote", okR(fr), mostra(fr));
  const fx = (rpcF(Fg, "manutencao_historico", { p_equipamento_id: "emr9b5cgj174", p_limite: 20, p_antes_de: null }).itens || []).find((i) => i.executor_tipo === "externo");
  const fh1 = CAPF.manutencao_historico[0].r;
  rpcF(Fg, "manutencao_historico", { p_equipamento_id: "emr9b5cgj174", p_limite: 20, p_antes_de: fh1.proximo_cursor });
  const fxAll = (CAPF.manutencao_historico.slice(-1)[0].r.itens || []).find((i) => i.executor_tipo === "externo") || fx;
  if (fxAll) { fr = rpcF(Fg, "manutencao_custo_informar", L.man2PedidoCusto(fxAll.id, "350,50", false, null).params); vale("falso: informar custo", okR(fr), mostra(fr)); }
  fr = rpcF(Fg, "manutencao_execucao_anular", { p_id: (fh1.itens || []).find((i) => !i.anulada).id, p_motivo: "Lançado errado" });
  vale("falso: anular", okR(fr), mostra(fr));
  const fEmp = Fg.eqItem(Fg.achaEq("eqempilha"));
  fr = rpcF(Fg, "manutencao_equipamento_reativar", { p_id: "eqempilha", p_versao: fEmp.versao });
  vale("falso: reativar", okR(fr), mostra(fr));
  const fEmp2 = Fg.eqItem(Fg.achaEq("eqempilha"));
  fr = rpcF(Fg, "manutencao_equipamento_inativar", { p_id: "eqempilha", p_versao: fEmp2.versao, p_motivo: "Vendida para outra loja" });
  vale("falso: inativar", okR(fr), mostra(fr));
  fr = rpcF(Fm, "manutencao_equipamento_excluir", { p_id: "eqbal137", p_senha: "errada" });
  vale("falso: senha errada", fr.ok === false && fr.erro === "senha_incorreta", mostra(fr));
  fr = rpcF(Fm, "manutencao_equipamento_excluir", { p_id: "eqbal137", p_senha: "1234" });
  vale("falso: excluir", okR(fr), mostra(fr));
  // leituras
  rpcF(Fo, "manutencao_painel", { p_incluir_inativos: false });
  rpcF(Fg, "manutencao_painel", { p_incluir_inativos: true });
  rpcF(Fg, "manutencao_equipamento_detalhe", { p_id: "emr9b5cgj174" });
  rpcF(Fg, "manutencao_equipamento_detalhe", { p_id: "eqfreezer" });
  rpcF(Fg, "manutencao_equipamento_detalhe", { p_id: "eqempilha" });
  const fInat = rpcF(Fo, "manutencao_equipamento_detalhe", { p_id: "eqempilha" });
  vale("falso: detalhe de inativo para o operacional = {ok:false, inativo} (igual ao banco)", fInat.ok === false && fInat.erro === "inativo", mostra(fInat));
  rpcF(Fo, "manutencao_historico", { p_equipamento_id: "emr9b5cgj174", p_limite: 20, p_antes_de: null });
  rpcF(Fg, "manutencao_historico", { p_equipamento_id: "eqgelbeb", p_limite: 20, p_antes_de: null });
  rpcF(Fo, "manutencao_pessoas", {});
  rpcF(Fo, "manutencao_resumo", {});
  [30, 90, 365].forEach((d) => rpcF(Fg, "manutencao_gerencial", { p_dias: d }));
  const fa = rpcF(Fg, "manutencao_auditoria_listar", { p_equipamento_id: null, p_limite: 50, p_antes_de: null });
  rpcF(Fg, "manutencao_auditoria_listar", { p_equipamento_id: null, p_limite: 50, p_antes_de: fa.proximo_cursor });
  if (process.env.MAN2_CONTRATO_DUMP) fs.writeFileSync(path.join(process.env.MAN2_CONTRATO_DUMP, "capturas-falso.json"), JSON.stringify(CAPF, null, 1));

  const exc = Object.keys(CAPF).map((n) => CAPF[n].filter((c) => c.r && c.r.__erro).map((c) => n + ": " + c.r.__erro)).flat();
  vale("falso: nenhuma exceção", exc.length === 0, exc.join(" || ") || "nenhuma");
  Object.keys(ESQUEMA).forEach((nome) => {
    const caps = (CAPF[nome] || []).filter((c) => okR(c.r));
    const probs = [], cob = new Set();
    caps.forEach((c) => conferir(c.r, ESQUEMA[nome], "", probs, cob));
    const todos = new Set(); caminhosEsquema(ESQUEMA[nome], "", todos);
    const naoVistos = [...todos].filter((c) => c && !cob.has(c));
    vale("falso " + nome + ": campos lidos pela tela presentes e com tipo certo", caps.length > 0 && probs.length === 0 && naoVistos.length === 0,
      (probs.slice(0, 6).join(" || ") + (naoVistos.length ? " || não exercitados: " + naoVistos.join(", ") : "")) || "ok");
    // o falso não inventa: todo caminho de chave dele existe na resposta real
    const real = new Set(); (CAP[nome] || []).filter((c) => okR(c.r)).forEach((c) => caminhosJson(c.r, "", real));
    const doFalso = new Set(); caps.forEach((c) => caminhosJson(c.r, "", doFalso));
    const inventados = [...doFalso].filter((c) => !real.has(c));
    vale("falso " + nome + ": não inventa campo que o banco não devolve", inventados.length === 0, inventados.join(", ") || "nenhum");
  });
  // gravações que a tela chama e o formato do ok:true de cada uma
  ["manutencao_equipamento_inativar", "manutencao_equipamento_reativar", "manutencao_equipamento_excluir", "manutencao_rotina_salvar", "manutencao_rotina_desativar",
    "manutencao_execucao_anular", "manutencao_custo_informar", "manutencao_pendencia_resolver", "manutencao_pendencia_cancelar", "manutencao_anexo_equipamento"].forEach((nome) => {
    const real = new Set(); (CAP[nome] || []).filter((c) => okR(c.r)).forEach((c) => caminhosJson(c.r, "", real));
    const doFalso = new Set(); (CAPF[nome] || []).filter((c) => okR(c.r)).forEach((c) => caminhosJson(c.r, "", doFalso));
    const inventados = [...doFalso].filter((c) => !real.has(c)), faltando = [...real].filter((c) => !doFalso.has(c));
    vale("falso " + nome + ": resposta ok com as mesmas chaves do banco", real.size > 0 && doFalso.size > 0 && inventados.length === 0 && faltando.length === 0,
      "inventados: " + (inventados.join(", ") || "nenhum") + " · faltando: " + (faltando.join(", ") || "nenhum"));
  });
  const chavesErroReal = new Set(["ok", "erro", "mensagem"]);
  Object.keys(CAP).forEach((n) => CAP[n].forEach((c) => { if (c.r && c.r.ok === false) Object.keys(c.r).forEach((k) => chavesErroReal.add(k)); }));
  ["atual", "categoria"].forEach((k) => chavesErroReal.add(k));   // conflito e anexo: existem no SQL, não precisaram aparecer no cenário
  const errF = [];
  Object.keys(CAPF).forEach((n) => CAPF[n].forEach((c) => { if (c.r && c.r.ok === false) Object.keys(c.r).forEach((k) => { if (!chavesErroReal.has(k)) errF.push(n + "." + k); }); }));
  vale("falso: recusas só com as chaves que o banco usa", errF.length === 0, errF.join(", ") || "ok (" + [...chavesErroReal].join(",") + ")");
  // ids de pendência/rotina são uuid no banco (p_id uuid): o falso não pode usar outro formato
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const naoUuid = [];
  Fg.S.pendencias.forEach((p) => { if (!uuidRe.test(p.id)) naoUuid.push("pendência " + p.id); });
  Fg.S.rotinas.forEach((q) => { if (!uuidRe.test(q.id)) naoUuid.push("rotina " + q.id); });
  vale("falso: ids de pendência e rotina em formato uuid (o banco recusa outro)", naoUuid.length === 0, naoUuid.join(", ") || "ok");

  // ============================================================
  console.log("\n=== 7. Regras da rodada de 15/09: o servidor de mentira responde IGUAL ao banco ===\n");
  // ============================================================
  // mesmos passos no banco real e num servidor de mentira novo; compara recusa (erro, campo, texto) e estado
  const HOJE_F = "2026-09-14";
  const diaF = (n) => { const d = new Date(HOJE_F + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const rel = (base, d) => (d == null ? null : Math.round((Date.parse(d + "T12:00:00Z") - Date.parse(base + "T12:00:00Z")) / 86400000));
  const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.keys(x).sort().reduce((o, kk) => { o[kk] = x[kk]; return o; }, {}) : x));
  const recusa = (r, nome) => (r && r.ok === false ? canon({ erro: r.erro, campo: r.campo || null, mensagem: nome ? String(r.mensagem).split(nome).join("<nome>") : r.mensagem }) : "aceitou: " + mostra(r).slice(0, 80));
  const chaveJs = (s) => String(s == null ? "" : s).trim().replace(/\s+/g, " ").split("").map((c) => { const i = "ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ".indexOf(c); return i >= 0 ? "AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn"[i] : c; }).join("").toLowerCase();
  const Fn = falso("gestor");
  const chamaB = (nome, params) => rpc("gestor", nome, params);
  const chamaF = (nome, params) => rpcF(Fn, nome, params);
  let nRqF = 1;
  const novoRqF = () => "73000000-0000-4000-8000-" + String(nRqF++).padStart(12, "0");
  const equipPedido = (o) => ({ p: L.man2MontarPayloadEquipamento(o) });

  // DUP-NOME: cadastro, renomear e editar sem mudar o nome (duplicado antigo não trava)
  // maiúscula só em letra sem acento: o lower() do Postgres da bancada (locale C) não mexe em "Ç"
  const dB1 = chamaB("manutencao_equipamento_salvar", equipPedido({ nome: " balança CONTRATO 01 ", tipo: "Balança", setor: "Frente de caixa" }));
  const dF1 = chamaF("manutencao_equipamento_salvar", equipPedido({ nome: " balanças CAIXA 101 ", tipo: "Balança", setor: "Frente de caixa" }));
  vale("cadastro com nome de equipamento ativo: mesma recusa (erro, campo e texto)", dB1.ok === false && recusa(dB1, "Balança Contrato 01") === recusa(dF1, "Balanças Caixa 101"),
    "banco " + recusa(dB1, "Balança Contrato 01") + " · falso " + recusa(dF1, "Balanças Caixa 101"));
  const nB = chamaB("manutencao_equipamento_salvar", equipPedido({ nome: "Rotina Recriada Contrato", tipo: "Forno", setor: "Padaria Contrato" }));
  const nF = chamaF("manutencao_equipamento_salvar", equipPedido({ nome: "Rotina Recriada Contrato", tipo: "Forno", setor: "Padaria Contrato" }));
  const EQR = nB.equipamento.id, EQRF = nF.equipamento.id;
  const renB = chamaB("manutencao_equipamento_salvar", equipPedido({ id: EQR, versao: nB.equipamento.versao, nome: "balança contrato 01", tipo: "Forno", setor: "Padaria Contrato" }));
  const renF = chamaF("manutencao_equipamento_salvar", equipPedido({ id: EQRF, versao: nF.equipamento.versao, nome: "balanças caixa 101", tipo: "Forno", setor: "Padaria Contrato" }));
  vale("renomear para o nome de outro ativo: mesma recusa", renB.ok === false && recusa(renB, "Balança Contrato 01") === recusa(renF, "Balanças Caixa 101"),
    "banco " + recusa(renB, "Balança Contrato 01") + " · falso " + recusa(renF, "Balanças Caixa 101"));
  r = su(`insert into public.manutencao_equipamentos (id, nome, tipo, setor, status) values ('eq-gemeo-contrato', 'ROTINA RECRIADA CONTRATO ', 'Forno', 'Padaria Contrato', 'ativo')`);
  if (!r.ok) throw new Error("gêmeo antigo: " + r.erro);
  Fn.S.equipamentos.push(Object.assign({}, Fn.achaEq(EQRF), { id: "eqgemeo", codigo: "EQ-9999", nome: "ROTINA RECRIADA CONTRATO " }));
  const edB = chamaB("manutencao_equipamento_salvar", equipPedido({ id: EQR, versao: nB.equipamento.versao, nome: "Rotina Recriada Contrato", tipo: "Forno a gás", setor: "Padaria Contrato" }));
  const edF = chamaF("manutencao_equipamento_salvar", equipPedido({ id: EQRF, versao: nF.equipamento.versao, nome: "Rotina Recriada Contrato", tipo: "Forno a gás", setor: "Padaria Contrato" }));
  vale("editar sem mudar o nome, com duplicado antigo ativo: os dois aceitam", okR(edB) && okR(edF), "banco " + mostra(edB).slice(0, 90) + " · falso " + mostra(edF).slice(0, 90));

  // PED-01: o mesmo formulário reenviado igual e com dado mudado
  const rqF = novoRqF();
  const pf1 = chamaF("manutencao_equipamento_salvar", equipPedido({ request_id: rqF, nome: "Balança Reenvio Falso", tipo: "Balança", setor: "Frente de caixa" }));
  const pf2 = chamaF("manutencao_equipamento_salvar", equipPedido({ request_id: rqF, nome: "Balança Reenvio Falso", tipo: "Balança", setor: "Frente de caixa" }));
  const pf3 = chamaF("manutencao_equipamento_salvar", equipPedido({ request_id: rqF, nome: "Balança Reenvio Falso", tipo: "Balança", setor: "Açougue" }));
  vale("formulário reenviado com dado mudado: mesma recusa (conflito, campo request_id e texto); igual devolve o mesmo",
    okR(pf1) && okR(pf2) && pf2.equipamento.id === pf1.equipamento.id && rq3.ok === false && recusa(pf3) === recusa(rq3), "banco " + recusa(rq3) + " · falso " + recusa(pf3));

  // ROTINA-RECRIADA: desativar e recriar a rotina não zera o atraso (mesmo serviço)
  function cicloRecriado(chamar, eqId, hoje, dia, rq) {
    const reg = (tipo, data, just) => chamar("manutencao_execucao_registrar", { p: Object.assign({ request_id: rq(), equipamento_id: eqId, tipo_servico: tipo, data_execucao: data,
      executor: { tipo: "interno", ref: "livre", nome: "Márcia" }, resultado: "ok" }, just ? { justificativa_atraso: just } : {}) });
    const rotDoPainel = () => ((chamar("manutencao_painel", { p_incluir_inativos: false }).equipamentos || []).find((e) => e.id === eqId) || { rotinas: [] }).rotinas
      .find((q) => String(q.tipo_servico).toLowerCase() === "limpeza") || {};
    const r1 = chamar("manutencao_rotina_salvar", { p: L.man2MontarPayloadRotina(rotForm({ equipamento_id: eqId, tipo_servico: "Limpeza", periodicidade_dias: "10" }), null) });
    const x0 = reg("Limpeza", dia(-40), "Lançado atrasado");
    const a0 = chamar("manutencao_resumo", {}).atrasado;
    const des = chamar("manutencao_rotina_desativar", { p_id: r1.rotina.id, p_versao: r1.rotina.versao, p_motivo: "Refazer a rotina" });
    const r2 = chamar("manutencao_rotina_salvar", { p: L.man2MontarPayloadRotina(rotForm({ equipamento_id: eqId, tipo_servico: "limpeza", periodicidade_dias: "10" }), null) });
    const a1 = chamar("manutencao_resumo", {}).atrasado;
    reg("Troca de peça", hoje);
    const pr = rotDoPainel();
    const x2 = reg("Limpeza", hoje);
    const an = chamar("manutencao_execucao_anular", { p_id: x2.id, p_motivo: "Lançado em duplicidade" });
    const pr2 = rotDoPainel();
    return [okR(r1), okR(x0), okR(des), okR(r2), r2.rotina && r2.rotina.estado, r2.rotina && r2.rotina.dias, r2.rotina && rel(hoje, r2.rotina.ultima_data), a1 - a0,
      pr.estado, pr.dias, x2.estado, x2.dias, an.estado, an.dias, pr2.estado, rel(hoje, pr2.ultima_data)];
  }
  const cicB = cicloRecriado(chamaB, EQR, HOJE, dia, novoRq), cicF = cicloRecriado(chamaF, EQRF, HOJE_F, diaF, novoRqF);
  const cicEsperado = [true, true, true, true, "atrasado", -30, -40, 0, "atrasado", -30, "em_dia", 10, "atrasado", -30, "atrasado", -40];
  vale("banco: rotina recriada herda o atraso do mesmo serviço (salvar, resumo, painel, registrar, anular)", canon(cicB) === canon(cicEsperado), canon(cicB));
  vale("falso: rotina recriada igual ao banco", canon(cicF) === canon(cicB), "banco " + canon(cicB) + " · falso " + canon(cicF));

  // ROTINA-RECRIADA-DATA-INICIO e ROTINA-RECRIADA-NO-PRAZO: 1ª rotina depois de serviço avulso respeita a data escolhida;
  // a 1ª execução da rotina recriada entra no "no prazo" pela prevista herdada
  function primeiraENoPrazo(chamar, sufixo, hoje, dia, rq) {
    const reg = (eqId, tipo, data, just) => chamar("manutencao_execucao_registrar", { p: Object.assign({ request_id: rq(), equipamento_id: eqId, tipo_servico: tipo, data_execucao: data,
      executor: { tipo: "interno", ref: "livre", nome: "Márcia" }, resultado: "ok" }, just ? { justificativa_atraso: just } : {}) });
    const e1 = chamar("manutencao_equipamento_salvar", equipPedido({ nome: "Balcão Primeira " + sufixo, tipo: "Balcão", setor: "Frios Contrato" })).equipamento.id;
    const av = reg(e1, "Limpeza", dia(-60), "Caderno");
    const r1 = chamar("manutencao_rotina_salvar", { p: L.man2MontarPayloadRotina(rotForm({ equipamento_id: e1, tipo_servico: "Limpeza", periodicidade_dias: "30", data_inicio: dia(7) }), null) });
    const e2 = chamar("manutencao_equipamento_salvar", equipPedido({ nome: "Câmara No Prazo " + sufixo, tipo: "Câmara", setor: "Frios Contrato" })).equipamento.id;
    const r2 = chamar("manutencao_rotina_salvar", { p: L.man2MontarPayloadRotina(rotForm({ equipamento_id: e2, tipo_servico: "Limpeza", periodicidade_dias: "10" }), null) });
    reg(e2, "Limpeza", dia(-40), "Caderno");
    chamar("manutencao_rotina_desativar", { p_id: r2.rotina.id, p_versao: r2.rotina.versao, p_motivo: "Refazer a rotina" });
    chamar("manutencao_rotina_salvar", { p: L.man2MontarPayloadRotina(rotForm({ equipamento_id: e2, tipo_servico: "Limpeza", periodicidade_dias: "10" }), null) });
    const gA = chamar("manutencao_gerencial", { p_dias: 30 }).no_prazo;
    const x = reg(e2, "Limpeza", hoje);
    const gB = chamar("manutencao_gerencial", { p_dias: 30 }).no_prazo;
    return [okR(av), av.rotina_id, okR(r1), r1.rotina && r1.rotina.estado, r1.rotina && r1.rotina.dias, r1.rotina && rel(hoje, r1.rotina.proxima), r1.rotina && r1.rotina.ultima_data,
      okR(x), gB.rotina_execucoes - gA.rotina_execucoes, gB.no_prazo - gA.no_prazo];
  }
  const prB = primeiraENoPrazo(chamaB, "Banco", HOJE, dia, novoRq), prF = primeiraENoPrazo(chamaF, "Falso", HOJE_F, diaF, novoRqF);
  vale("banco: 1ª rotina depois de avulso nasce na data escolhida; rotina recriada conta a 1ª execução como atrasada no 'no prazo'",
    canon(prB) === canon([true, null, true, "proximo", 7, 7, null, true, 1, 0]), canon(prB));
  vale("falso: igual ao banco (data escolhida e 'no prazo' da rotina recriada)", canon(prF) === canon(prB), "banco " + canon(prB) + " · falso " + canon(prF));

  // DUP-NOME-REATIVAR: reativar com outro ativo de mesmo nome
  function reativarGemeo(chamar, nome) {
    const g1 = chamar("manutencao_equipamento_salvar", equipPedido({ nome, tipo: "Freezer", setor: "Açougue" })).equipamento;
    const in1 = chamar("manutencao_equipamento_inativar", { p_id: g1.id, p_versao: g1.versao, p_motivo: "Foi para o conserto" });
    const g2 = chamar("manutencao_equipamento_salvar", equipPedido({ nome, tipo: "Freezer", setor: "Açougue" })).equipamento;
    const re1 = chamar("manutencao_equipamento_reativar", { p_id: g1.id, p_versao: in1.equipamento.versao });
    const in2 = chamar("manutencao_equipamento_inativar", { p_id: g2.id, p_versao: g2.versao, p_motivo: "Cadastro repetido" });
    const re2 = chamar("manutencao_equipamento_reativar", { p_id: g1.id, p_versao: in1.equipamento.versao });
    return [okR(in1), recusa(re1, nome), okR(in2), okR(re2)];
  }
  const rgB = reativarGemeo(chamaB, "Freezer Gemeo Banco"), rgF = reativarGemeo(chamaF, "Freezer Gemeo Falso");
  vale("banco: reativar com outro ativo de mesmo nome é recusado; sem o gêmeo, aceita",
    canon(rgB) === canon([true, canon({ erro: "duplicado", campo: "nome", mensagem: "Já existe equipamento ativo com este nome: <nome>. Para reativar este, renomeie ou inative o outro antes." }), true, true]), canon(rgB));
  vale("falso: reativar gêmeo igual ao banco", canon(rgF) === canon(rgB), "banco " + canon(rgB) + " · falso " + canon(rgF));

  // GRAFIA: setor e empresa com outra grafia somam na mesma linha da Visão gerencial
  function grafia(chamar, hoje, rq) {
    const e1 = chamar("manutencao_equipamento_salvar", equipPedido({ nome: "Grafia Um Contrato", tipo: "Forno", setor: "Padaria Grafia" })).equipamento.id;
    const e2 = chamar("manutencao_equipamento_salvar", equipPedido({ nome: "Grafia Dois Contrato", tipo: "Forno", setor: "padária  grafia" })).equipamento.id;
    [e1, e2].forEach((e) => chamar("manutencao_rotina_salvar", { p: L.man2MontarPayloadRotina(rotForm({ equipamento_id: e, tipo_servico: "Inspeção", periodicidade_dias: "5" }), null) }));
    const regs = [[e1, "TecGrafia", 10], [e2, "tecgrafia ", 20], [e2, "TecGrafia", null]].map(([e, emp, c]) => chamar("manutencao_execucao_registrar", { p: { request_id: rq(), equipamento_id: e,
      tipo_servico: "Troca de peça", data_execucao: hoje, executor: { tipo: "externo", nome: "Técnico", empresa_nome: emp }, custo: c, resultado: "ok" } }));
    const g = chamar("manutencao_gerencial", { p_dias: 30 });
    return [regs.every(okR), (g.atrasos_por_setor || []).filter((x) => chaveJs(x.setor) === "padaria grafia"),
      ((g.custos || {}).por_setor || []).filter((x) => chaveJs(x.setor) === "padaria grafia"), ((g.custos || {}).por_prestador || []).filter((x) => chaveJs(x.empresa) === "tecgrafia")];
  }
  const grB = grafia(chamaB, HOJE, novoRq), grF = grafia(chamaF, HOJE_F, novoRqF);
  const grEsperado = [true, [{ setor: "Padaria Grafia", atrasadas: 0, rotinas: 2 }], [{ setor: "Padaria Grafia", total: 30 }], [{ empresa: "TecGrafia", total: 30, qtd: 3 }]];
  vale("banco: grafias diferentes numa linha só, com a grafia mais usada", canon(grB) === canon(grEsperado), canon(grB));
  vale("falso: grafias juntas igual ao banco", canon(grF) === canon(grB), "banco " + canon(grB) + " · falso " + canon(grF));
} catch (e) {
  console.log("  FALHA | o teste quebrou: " + (e && e.stack || e));
  falhou++;
} finally {
  B.derrubar(pg);
}

console.log("\n" + ok + " OK, " + falhou + " falha(s)");
process.exit(falhou ? 1 : 0);
