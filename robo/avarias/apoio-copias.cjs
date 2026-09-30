// ==AVR-APOIO== Avarias · cópias de APOIO da tela (nomes, venda a custo, verbas, compras recentes), montadas SÓ a partir
// de uma pasta de extração (a de 28/09/2026 na prévia; a da rodada, no robô do piloto). Não abre conexão com o VR.
// Mudou de lugar na etapa 3,6 (era .previa/avarias/codigo/tela/apoio-copias.cjs, que agora é um atalho para cá): o robô
// usa copiasDeApoio + COLUNAS_APOIO; a prévia usa instalarTela (carrega na bancada como o robô, papel avaria_robo).
// O conteúdo das regras é o mesmo da etapa 3 (nada foi reinterpretado).
"use strict";
const fs = require("fs"), path = require("path");
const C = require("./calculo.cjs");
// a leitura da tela instalada pela prévia continua morando na oficina da prévia (não vai para a loja)
const SQL_TELA = path.join(__dirname, "..", "..", ".previa", "avarias", "codigo", "banco", "avarias_v1_tela.sql");

const ler = (dir, f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
const n = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

function copiasDeApoio(DADOS, parcelas) {
  const man = ler(DADOS, "manifesto.json");
  const mesDaExtracao = String(man.corte_vr).slice(0, 7);          // o mês da extração traz o dia corrente dentro
  const T = {};
  T.avaria_motivos_vr = ler(DADOS, "motivos_troca.json")
    .map((m) => ({ motivo: m.id, nome: m.descricao }));

  const VM = ler(DADOS, "descobertas/venda_custo_setor_mes.json"), VS = ler(DADOS, "descobertas/venda_sem_custo.json");
  const semCusto = new Map(VS.map((r) => [r.mes + "|" + Number(r.setor), r]));
  T.avaria_venda_setor_vr = VM.map((r) => {
    const s = semCusto.get(r.mes + "|" + Number(r.setor_vr));
    return { mes: r.mes, setor_id: Number(r.setor_vr), venda_custo: n(r.venda_custo), venda_valor: n(r.venda_valor),
      preco_sem_custo: s ? n(s.preco_sem_custo) || 0 : 0, itens_sem_custo: n(r.itens_sem_custo) || 0, inclui_dia_corrente: r.mes === mesDaExtracao };
  });

  const compras = ler(DADOS, "compras.json");
  const ultimaDoForn = new Map();
  for (const c of compras) if (!ultimaDoForn.has(c.fornecedor) || ultimaDoForn.get(c.fornecedor) < c.data) ultimaDoForn.set(c.fornecedor, c.data);
  T.avaria_fornecedores_vr = ler(DADOS, "fornecedores.json").map((f) => ({ fornecedor: f.id, nome: f.nome, ultima_compra: ultimaDoForn.get(f.id) || null }));

  T.avaria_usuarios_vr = ler(DADOS, "usuarios.json").map((u) => ({ usuario: u.id, login: u.login }));

  const meta = ler(DADOS, "documentos_meta.json");
  const tipoV = new Map(meta.tipoverba.map((t) => [Number(t.id), t.descricao]));
  const sitV = new Map(meta.situacaoverba.map((t) => [Number(t.id), t.descricao]));
  T.avaria_verbas_vr = meta.verba.map((v) => ({ verba_id: v.id, fornecedor: v.id_fornecedor, tipo_id: v.id_tipoverba, tipo: tipoV.get(Number(v.id_tipoverba)) || null,
    valor: n(v.valor), data: v.dataemissao, situacao: sitV.get(Number(v.id_situacaoverba)) || null }));

  // documentos citados nas provas: nota de entrada (NE#), verba (VB#) e parcela de boleto (PP#), com número, data e TOTAL
  const tipoE = new Map(meta.tipoentrada.map((t) => [Number(t.id), t.descricao]));
  const nomeTipoE = (id) => { const d = String(tipoE.get(Number(id)) || ""); return /BONIFIC/.test(d) ? "nota de bonificação" : /OUTRAS/.test(d) ? "nota de outras entradas" : /COMPRA/.test(d) ? "nota de compra" : "nota de entrada"; };
  const docs = new Map();
  for (const e of meta.notaentrada) docs.set("NE#" + e.id, { ref: "NE#" + e.id, tipo: nomeTipoE(e.id_tipoentrada), numero: String(e.numeronota), data: e.dataentrada, fornecedor: e.id_fornecedor, valor_total: n(e.valortotal) });
  for (const v of meta.verba) docs.set("VB#" + v.id, { ref: "VB#" + v.id, tipo: "verba de " + String(tipoV.get(Number(v.id_tipoverba)) || "").toLowerCase(), numero: String(v.id), data: v.dataemissao, fornecedor: v.id_fornecedor, valor_total: n(v.valor) });
  for (const b of ler(DADOS, "descobertas/boleto_leitura_desde2023.json")) {
    const k = "PP#" + b.id_parcela; if (docs.has(k)) continue;
    docs.set(k, { ref: k, tipo: "parcela do boleto", numero: b.numerodocumento + (b.numeroparcela ? "/" + b.numeroparcela : ""), data: b.vencimento, fornecedor: b.id_fornecedor, valor_total: n(b.valor_parcela) });
  }
  T.avaria_documentos_vr = [...docs.values()];

  // fornecedores que venderam o produto no ano antes da entrada MAIS RECENTE que está parada (sem a própria empresa)
  const ultEntrada = new Map();
  for (const p of parcelas) if (!ultEntrada.has(p.id_produto) || ultEntrada.get(p.id_produto) < p.data_entrada) ultEntrada.set(p.id_produto, p.data_entrada);
  const acc = new Map();
  for (const c of compras) {
    if (C.FORNECEDORES_DA_CASA.has(c.fornecedor)) continue;
    const fim = ultEntrada.get(c.id_produto); if (!fim) continue;
    const ini = new Date(new Date(fim + "T12:00:00Z").getTime() - 365 * 864e5).toISOString().slice(0, 10);
    if (c.data > fim || c.data < ini) continue;
    const k = c.id_produto + "|" + c.fornecedor;
    const o = acc.get(k) || { id_produto: c.id_produto, fornecedor: c.fornecedor, primeira_compra: c.data, ultima_compra: c.data, notas: new Set() };
    if (c.data < o.primeira_compra) o.primeira_compra = c.data; if (c.data > o.ultima_compra) o.ultima_compra = c.data;
    o.notas.add(c.nota_id); acc.set(k, o);
  }
  T.avaria_compras_recentes_vr = [...acc.values()].map((o) => ({ id_produto: o.id_produto, fornecedor: o.fornecedor, primeira_compra: o.primeira_compra, ultima_compra: o.ultima_compra, notas: o.notas.size }));
  return { T, corte: man.corte_vr };
}

const COLUNAS_APOIO = {
  avaria_motivos_vr: ["motivo", "nome"],
  avaria_venda_setor_vr: ["mes", "setor_id", "venda_custo", "venda_valor", "preco_sem_custo", "itens_sem_custo", "inclui_dia_corrente"],
  avaria_fornecedores_vr: ["fornecedor", "nome", "ultima_compra"],
  avaria_usuarios_vr: ["usuario", "login"],
  avaria_verbas_vr: ["verba_id", "fornecedor", "tipo_id", "tipo", "valor", "data", "situacao"],
  avaria_compras_recentes_vr: ["id_produto", "fornecedor", "primeira_compra", "ultima_compra", "notas"],
  avaria_documentos_vr: ["ref", "tipo", "numero", "data", "fornecedor", "valor_total"],
};
const csv = (v) => (v === null || v === undefined ? "" : typeof v === "boolean" ? (v ? "t" : "f") : typeof v === "number" ? String(v) : '"' + String(v).replace(/"/g, '""') + '"');

// instala a leitura da tela e carrega as cópias de apoio como o robô; o relógio das fontes fica na hora da extração
function instalarTela(c, dirTmp, DADOS, parcelas) {
  let r = c.arquivo(SQL_TELA);
  if (!r.ok) throw new Error("leitura da tela (1ª): " + r.erro.split("\n").slice(0, 6).join(" | "));
  r = c.arquivo(SQL_TELA);
  if (!r.ok) throw new Error("leitura da tela (2ª, idempotente): " + r.erro.split("\n").slice(0, 6).join(" | "));
  const { T, corte } = copiasDeApoio(DADOS, parcelas);
  const linhas = ["set role avaria_robo;"];
  for (const [tab, cols] of Object.entries(COLUNAS_APOIO)) {
    const f = path.join(dirTmp, c.banco + "-apoio-" + tab + ".csv");
    fs.writeFileSync(f, T[tab].map((x) => cols.map((k) => csv(x[k])).join(",")).join("\n") + (T[tab].length ? "\n" : ""));
    linhas.push(`delete from public.${tab};`);
    linhas.push(`\\copy public.${tab} (${cols.join(",")}) from '${f}' with (format csv)`);
    linhas.push(`insert into public.avaria_sync (fonte, ultima_ok, ultima_tentativa, linhas) values ('${tab}', now(), now(), ${T[tab].length}) on conflict (fonte) do update set linhas = excluded.linhas;`);
  }
  // a prévia não tem robô ligado: toda fonte mostra a hora da extração (VR em horário de Caicó)
  linhas.push(`update public.avaria_sync set ultima_ok = '${corte}'::timestamp at time zone 'America/Fortaleza', ultima_tentativa = '${corte}'::timestamp at time zone 'America/Fortaleza';`);
  linhas.push("reset role;", "analyze;");
  const f = path.join(dirTmp, c.banco + "-apoio.sql");
  fs.writeFileSync(f, linhas.join("\n") + "\n");
  r = c.arquivo(f);
  if (!r.ok) throw new Error("cópias de apoio: " + r.erro.split("\n").slice(0, 6).join(" | "));
  return Object.fromEntries(Object.entries(T).map(([k, v]) => [k, v.length]));
}

module.exports = { copiasDeApoio, instalarTela, COLUNAS_APOIO };
