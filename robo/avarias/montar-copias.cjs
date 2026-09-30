// Avarias · etapa 2 · o "robô em modo de teste": transforma a extração do VR (etapa 1) nas cópias que a nuvem teria.
// Só lê arquivos locais. Nada vai para o VR nem para a nuvem. As regras são as MESMAS da etapa 1 (calculo, evidencias, documentos).
"use strict";
const path = require("path");
const C = require("./calculo.cjs");
const { rodar, carregar } = require("./etapa1.cjs");
const { classificarBoleto } = require("./evidencias.cjs");
const { montarContexto, classificarDocumentos, temContexto } = require("./documentos.cjs");

const n = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

function montarCopias(dir, { ateLinha = null } = {}) {
  const { R, sim, D } = rodar(dir, { ateLinha });
  // no corte, o "saldo do VR" é o saldo que o próprio livro mostrava naquela linha (como na etapa 1)
  if (ateLinha) D.saldo = sim.map((s) => ({ id_produto: s.prod, saldo: s.saldoLivro, custo_hoje: (D.saldo.find((x) => x.id_produto === s.prod) || {}).custo_hoje }));
  const ctx = montarContexto(dir);
  const notasPorNumero = new Map();
  for (const x of D.notas) { if (!notasPorNumero.has(x.numero)) notasPorNumero.set(x.numero, []); notasPorNumero.get(x.numero).push(x); }
  const titulosPorNota = new Map();
  for (const t of D.titulos) { if (!titulosPorNota.has(t.nota_id)) titulosPorNota.set(t.nota_id, []); titulosPorNota.get(t.nota_id).push(t); }
  const motivoPerdaNome = new Map(D.motivos_perda.map((m) => [m.id, m.descricao]));
  const cls = { notasPorNumero, titulosPorNota, motivoPerdaNome };
  const T = {};

  // ---- livro da troca: uma linha por movimento, com o papel dela, a classe e o custo congelado
  const porLinha = new Map();
  for (const s of sim) {
    for (const e of s.ev.entradas) porLinha.set(e.linha, { papel: e.classe === "retorno" ? "retorno" : "entrada", classe: e.classe, custo: e.custo, fonte: e.fonte, ciclo: e.ciclo });
    for (const x of s.ev.saidas) {
      porLinha.set(x.linha, { papel: x.nf !== undefined ? "saida_nota" : "saida", classe: null, custo: x.custoSaida, fonte: x.fonteSaida, ciclo: x.ciclo, nf: x.nf });
      for (const l of x.linhas_nota || []) if (l !== x.linha && !porLinha.has(l)) porLinha.set(l, { papel: "vai_e_volta", nf: x.nf });
    }
  }
  const nfDe = (obs) => { const m = C.norm(obs).match(/^NF (\d+)/); return m ? Number(m[1]) : null; };
  T.avaria_trocas_vr = D.troca.map((l) => {
    const p = porLinha.get(l.id) || { papel: "vai_e_volta" };           // linhas de nota que zerou ficam como vai-e-volta
    return { linha_id: l.id, id_produto: l.id_produto, datahora: l.datahora, data: l.data, tipo: l.tipo, qtd: l.qtd, motivo: l.motivo, obs: l.obs,
      usuario: l.usuario, custo_linha: n(l.custo), saldo_antes: l.antes, saldo_depois: l.depois, papel: p.papel,
      classe: p.papel === "entrada" || p.papel === "retorno" ? (p.classe === "estorno" ? null : p.classe) : null,
      custo_data: p.custo ?? null, fonte_custo: p.fonte ?? null, nota_numero: nfDe(l.obs), ciclo: p.ciclo ?? null };
  });

  T.avaria_saldo_vr = D.saldo.map((s) => ({ id_produto: s.id_produto, saldo: s.saldo, custo_hoje: n(s.custo_hoje) }));
  T.avaria_produtos_vr = D.produtos.map((p) => ({ id_produto: p.id, nome: p.nome, setor_id: p.setor_id, setor: p.setor, grupo_id: p.grupo_id }));

  // ---- partes paradas (só produtos com saldo positivo no VR) e ciclos
  const saldoVR = new Map(D.saldo.map((s) => [s.id_produto, n(s.saldo)]));
  T.avaria_parcelas_vr = []; T.avaria_ciclos_vr = []; T.avaria_ajustes_vr = [];
  for (const s of sim) {
    if ((saldoVR.get(s.prod) ?? 0) > 0) {
      const ciclo = s.ev.ciclos.length ? s.ev.ciclos[s.ev.ciclos.length - 1].inicio_linha : null;   // identidade estável do ciclo
      s.fila.forEach((p, i) => T.avaria_parcelas_vr.push({ id_produto: s.prod, ordem: i + 1, linha_entrada: p.linha, data_entrada: p.data, qtd: p.qtd,
        custo: p.custo, fonte_custo: p.fonte || "sem_custo", classe: p.classe, motivo: p.motivo, ciclo }));
    }
    for (const c of s.ev.ciclos) T.avaria_ciclos_vr.push({ id_produto: s.prod, inicio_linha: c.inicio_linha, n: c.n, inicio_datahora: c.inicio_datahora, inicio_data: c.inicio_data,
      fim_linha: c.fim_linha, fim_datahora: c.fim_datahora, fim_data: c.fim_data });
    for (const c of s.ev.componentes) {
      const fonte = c.fonte || (c.tomados && c.tomados.length ? null : null);
      T.avaria_ajustes_vr.push({ componente: c.comp, id_produto: s.prod, linha_id: c.linha, data: (D.troca.find ? null : null), mes: c.mes, qtd: c.qtd, valor: c.valor, fonte_custo: fonte, negativo: !!c.negativo });
    }
  }
  const dataDaLinha = new Map(D.troca.map((l) => [l.id, l.data]));
  for (const a of T.avaria_ajustes_vr) { a.data = dataDaLinha.get(a.linha_id); delete a.mes; }

  // ---- notas, itens e saídas líquidas
  T.avaria_notas_vr = D.notas.map((x) => {
    const f = C.formaDoTexto(x.texto);
    return { nota_id: x.id, numero: x.numero, serie: x.serie, data: x.data, tipo_id: x.tipo_id, tipo: x.tipo, nfe: x.nfe, fornecedor: x.fornecedor,
      valor: x.valor, texto: x.texto, forma_texto: f.forma, assumido_texto: f.assumido, duvida_texto: f.duvida, destino: C.tipoDaNota(x) };
  });
  T.avaria_notas_itens_vr = [];
  const itemPor = new Map();
  for (const i of D.itens) {
    const k = i.nota_id + "|" + i.id_produto;
    if (itemPor.has(k)) throw new Error("produto repetido na mesma nota: " + k);
    itemPor.set(k, true);
    T.avaria_notas_itens_vr.push({ nota_id: i.nota_id, id_produto: i.id_produto, qtd: i.qtd, embalagem: i.embalagem, valor_total: i.valor_total });
  }
  const trocaPorId = new Map(D.troca.map((l) => [l.id, l]));
  T.avaria_saidas_vr = []; T.avaria_saidas_partes_vr = [];
  for (const s of sim) for (const x of s.ev.saidas) {
    // as partes que saíram, cada uma com a linha de entrada, o custo e a FONTE do custo (nunca misturadas)
    x.tomados.forEach((t, i) => T.avaria_saidas_partes_vr.push({ linha_saida: x.linha, ordem: i + 1, id_produto: x.prod, linha_entrada: t.linha, data_entrada: t.data,
      qtd: t.qtd, custo: t.custo, fonte_custo: t.fonte || "sem_custo" }));
    if (x.semSaldo > 1e-9) T.avaria_saidas_partes_vr.push({ linha_saida: x.linha, ordem: x.tomados.length + 1, id_produto: x.prod, linha_entrada: null, data_entrada: null,
      qtd: x.semSaldo, custo: x.custoSaida, fonte_custo: x.fonteSaida || "sem_custo" });
    const c = C.classificarSaida(x, cls);
    const dataOuLinha = x.tomados.filter((t) => C.n(t.custo) !== null && t.fonte !== "hoje_estimado").reduce((a, t) => a + t.qtd * t.custo, 0)
      + (x.fonteSaida !== "hoje_estimado" ? x.semSaldo * (x.custoSaida || 0) : 0);
    const estimado = x.tomados.filter((t) => t.fonte === "hoje_estimado").reduce((a, t) => a + t.qtd * t.custo, 0)
      + (x.fonteSaida === "hoje_estimado" ? x.semSaldo * (x.custoSaida || 0) : 0);
    const semCusto = x.tomados.filter((t) => t.custo === null).reduce((a, t) => a + t.qtd, 0) + (x.custoSaida === null ? x.semSaldo : 0);
    const soLinha = x.tomados.filter((t) => t.fonte === "linha" && t.custo !== null).reduce((a, t) => a + t.qtd * t.custo, 0) + (x.fonteSaida === "linha" ? x.semSaldo * (x.custoSaida || 0) : 0);
    T.avaria_saidas_vr.push({ linha_id: x.linha, id_produto: x.prod, datahora: trocaPorId.get(x.linha).datahora, data: x.data, qtd_liquida: x.qtd,
      qtd_bruta: x.bruto ?? x.qtd, qtd_estorno: x.estorno ?? 0, nota_numero: x.nf ?? null, nota_id: c.nota ? c.nota.id : null,
      destino: c.destino, grupo: c.grupo, forma: c.forma, nivel_vr: c.nivel, motivo_vr: c.motivoVR, assumido_vr: c.grupo === "assumido",
      valor_data: dataOuLinha, valor_linha: soLinha, valor_estimado: estimado, qtd_sem_custo: semCusto, qtd_sem_saldo: x.semSaldo, ciclo: x.ciclo });
  }

  T.avaria_titulos_vr = D.titulos.map((t) => ({ titulo_id: t.id, nota_id: t.nota_id, fornecedor: t.fornecedor, numero: t.numero, emissao: t.emissao,
    vencimento: t.vencimento, valor: t.valor, abatimento: t.abatimento, situacao: t.situacao, boleto: t.boleto }));

  // ---- evidências: boleto (regra da fonte por linha) e documentos (opção A por par)
  const B = require(path.join(dir, "descobertas", "boleto_leitura_desde2023.json"));
  T.avaria_provas_vr = [];
  for (const x of classificarBoleto(B).filter((y) => y.troca)) {
    const r = B.find((b) => b.id_parcela === x.parcela && Number(b.id_notasaida) === Number(x.nota_id));
    T.avaria_provas_vr.push({ fonte: "boleto", ref: "PP#" + x.parcela, nota_id: Number(x.nota_id), fornecedor: n(r.id_fornecedor), data: String(r.vencimento).slice(0, 10),
      valor_citado: null, valor_nota: x.valor_nota, caso_boleto: x.caso, parcela_situacao: n(r.situacao), parcela_vencimento: String(r.vencimento).slice(0, 10),
      abatimento: n(r.abatimento_total), conflito_interno: false, motivo: x.motivo, texto: r.observacao });
  }
  const DOC = classificarDocumentos(ctx);
  const tipoFonte = { bonificacao: "bonificacao", outras_entradas: "outras_entradas", verba: "verba", compra: "compra_texto" };
  for (const p of DOC.pares) {
    T.avaria_provas_vr.push({ fonte: tipoFonte[p.tipo], ref: p.doc, nota_id: p.nota_id, fornecedor: p.forn, data: p.data, valor_citado: p.valor_citado,
      valor_nota: p.valor_nota, nao_serve: p.naoServe, conflito_interno: p.obs.includes("dois valores diferentes no mesmo documento"),
      contexto: temContexto(p.textoCompleto), compra_boleto: p.boletoCompra && p.boletoCompra.ok ? p.boletoCompra.caso : null,
      compra_motivo: p.boletoCompra && !p.boletoCompra.ok ? p.boletoCompra.motivo : null, texto: p.texto });
  }

  // ---- avaria direta na perda (linha separada, nunca somada)
  const nega = /N(A|Ã)O (E|É|FAZ) AVARIA|MAIS NAO E AVARIA/;
  T.avaria_perdas_vr = D.perdas.filter((p) => !C.norm(p.obs).startsWith("EXPORTACAO TROCA") && C.norm(p.obs).includes("AVARIA"))
    .map((p) => ({ perda_id: p.id, id_produto: p.id_produto, data: p.data, qtd: p.qtd, custo: n(p.custo), obs: p.obs,
      marca: nega.test(C.norm(p.obs)) ? "negada" : /BONIFIC/.test(C.norm(p.obs)) ? "declarada" : "avaria" }));

  // ---- fornecedor relacionado (última compra finalizada até a entrada; sem a própria empresa). SÓ análise.
  const compras = new Map();
  for (const c of D.compras) { if (C.FORNECEDORES_DA_CASA.has(c.fornecedor)) continue; if (!compras.has(c.id_produto)) compras.set(c.id_produto, []); compras.get(c.id_produto).push(c); }
  for (const l of compras.values()) l.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
  T.avaria_fornecedor_relacionado_vr = [];
  for (const p of T.avaria_parcelas_vr) {
    const l = (compras.get(p.id_produto) || []).filter((c) => c.data <= p.data_entrada);
    const ult = l[l.length - 1] || null;
    const umAno = new Date(new Date(p.data_entrada + "T12:00:00Z").getTime() - 365 * 864e5).toISOString().slice(0, 10);
    const varios = new Set(l.filter((c) => c.data >= umAno).map((c) => c.fornecedor)).size >= 2;
    const k = p.id_produto + "|" + p.linha_entrada;
    if (T.avaria_fornecedor_relacionado_vr.some((x) => x._k === k)) continue;
    T.avaria_fornecedor_relacionado_vr.push({ _k: k, id_produto: p.id_produto, linha_entrada: p.linha_entrada, fornecedor: ult ? ult.fornecedor : null, data_compra: ult ? ult.data : null, varios_fornecedores: varios });
  }
  for (const x of T.avaria_fornecedor_relacionado_vr) delete x._k;

  return { T, R, sim, D, ctx, DOC };
}

module.exports = { montarCopias };

if (require.main === module) {
  const { T } = montarCopias(path.join(process.env.AVR_DADOS || path.join(__dirname, "..", "..", ".previa", "avarias", "dados"), "2026-09-28"));
  for (const [k, v] of Object.entries(T)) console.log(k.padEnd(34), v.length);
}
