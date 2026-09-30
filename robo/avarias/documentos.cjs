// Avarias · etapa 1 · documentos que citam nossas notas da troca (bonificação, outras entradas, verba, nota de compra).
// OPÇÃO A (aprovada em 28/09/2026): o documento só comprova a nossa nota quando identifica, sem dúvida,
//   (1) a nossa nota, (2) o valor individual dela e (3) um fornecedor compatível.
// O valor individual citado é o valor comprovado, mesmo diferente do valor da nota: a diferença fica à vista (não é tolerância).
// Sem valor individual: não rateia, não estima, não usa o total do documento → conferência.
// Nota de compra com texto de desconto no boleto segue a regra do boleto (o valor vem do abatimento, nunca do texto).
"use strict";
const fs = require("fs"), path = require("path");
const { carregar } = require("./etapa1.cjs");
const { casoPorNota } = require("./evidencias.cjs");
const { FORNECEDORES_DA_CASA } = require("./calculo.cjs");

const n = (v) => (v == null || v === "" ? null : Number(v));
// Condição aprovada em 28/09: o texto tem que falar de avaria ou de acerto (pagar, quitar, bonificação, desconto...).
const CONTEXTO_ACERTO = /AVARI|PERCA|PERDA|BONIF|PAGA|PAGAMENTO|QUITA|DESCONTO|\bDESC\b|ABATI|CREDITO|ACERTO/;
const temContexto = (texto) => CONTEXTO_ACERTO.test(String(texto || "").toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
const centavos = (v) => Math.round(Number(v) * 100);
const raiz = (cnpj) => String(cnpj || "").replace(/\D/g, "").padStart(14, "0").slice(0, 8);

function tipoDoDocumento(d, meta) {
  if (d.doc.startsWith("VB#")) return "verba";
  const ne = meta.ne.get(Number(d.doc.slice(3)));
  const te = ne ? ne.id_tipoentrada : d.te;
  if (te === 3) return "bonificacao";
  if (te === 16) return "outras_entradas";
  return "compra"; // 0 e 185: compra com financeiro — o texto fala do desconto no boleto
}

function montarContexto(dir) {
  const D = carregar(dir);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, "documentos_meta.json"), "utf8"));
  const saida = JSON.parse(fs.readFileSync(path.join(dir, "descobertas", "doc_saida.json"), "utf8"));
  const boleto = JSON.parse(fs.readFileSync(path.join(dir, "descobertas", "boleto_leitura_desde2023.json"), "utf8"));
  const conf = JSON.parse(fs.readFileSync(path.join(dir, "conferencia.json"), "utf8")).conf;
  const ctx = {
    docs: saida.docs,
    ne: new Map(meta.notaentrada.map((x) => [Number(x.id), { ...x, id_tipoentrada: Number(x.id_tipoentrada), id_situacaonotaentrada: Number(x.id_situacaonotaentrada) }])),
    vb: new Map(meta.verba.map((x) => [Number(x.id), { ...x, id_situacaoverba: Number(x.id_situacaoverba), id_situacaocadastro: Number(x.id_situacaocadastro), id_tipoverba: Number(x.id_tipoverba), valor: n(x.valor) }])),
    tipoverba: new Map(meta.tipoverba.map((t) => [Number(t.id), t.descricao])),
    notas: new Map(D.notas.map((x) => [x.id, x])),
    raizDoFornecedor: new Map(D.fornecedores.map((f) => [f.id, raiz(f.cnpj)])),
    parcelas: new Map(),
    boleto: new Map(),
    titulos: new Map(),
    fornecedoresDoProduto: new Map(),
    itensDaNota: new Map(),
    corrigidas: new Set(conf.notas_estorno.lista_corrigidas || []),
  };
  for (const p of D.documentos_parcelas || []) { const k = Number(p.ne_id); if (!ctx.parcelas.has(k)) ctx.parcelas.set(k, []); ctx.parcelas.get(k).push(p); }
  for (const [id, x] of casoPorNota(boleto)) ctx.boleto.set(id, x.caso); // qualquer dúvida vence
  ctx.boletoLinhas = new Map();
  for (const r of boleto) { if (r.tipolocalbaixa !== 1) continue; const k = Number(r.id_notasaida); if (!ctx.boletoLinhas.has(k)) ctx.boletoLinhas.set(k, []); ctx.boletoLinhas.get(k).push(r); }
  ctx.corte = String(D.manifesto.corte_vr).slice(0, 10);
  for (const t of D.titulos) { if (!ctx.titulos.has(t.nota_id)) ctx.titulos.set(t.nota_id, []); ctx.titulos.get(t.nota_id).push(t); }
  for (const c of D.compras) { const k = c.id_produto; if (!ctx.fornecedoresDoProduto.has(k)) ctx.fornecedoresDoProduto.set(k, new Set()); ctx.fornecedoresDoProduto.get(k).add(ctx.raizDoFornecedor.get(c.fornecedor) || "id" + c.fornecedor); }
  for (const i of D.itens) { if (!ctx.itensDaNota.has(i.nota_id)) ctx.itensDaNota.set(i.nota_id, new Set()); ctx.itensDaNota.get(i.nota_id).add(i.id_produto); }
  return ctx;
}

// Fornecedor compatível: mesma empresa (raiz do CNPJ) do destinatário da nota; na nota de baixa (destinatário = a própria loja),
// o fornecedor do documento tem que ter vendido pelo menos um produto da nota. É trava contra número trocado, não é a prova.
function fornecedorCompativel(ctx, forn, nota) {
  const rd = ctx.raizDoFornecedor.get(forn) || "id" + forn;
  if (!FORNECEDORES_DA_CASA.has(nota.fornecedor)) return rd === (ctx.raizDoFornecedor.get(nota.fornecedor) || "id" + nota.fornecedor);
  for (const p of ctx.itensDaNota.get(nota.id) || []) if ((ctx.fornecedoresDoProduto.get(p) || new Set()).has(rd)) return true;
  return false;
}

// Junta observação e informação complementar da mesma nota de entrada; deixa de fora as parcelas (são a fonte do boleto).
function juntarDocumentos(ctx) {
  const docs = new Map();
  for (const d of ctx.docs) {
    if (d.doc.startsWith("PP#")) continue;
    const cits = d.citacoes.filter((c) => c.nota && c.nota.tlb === 1);
    const todas = d.citacoes.filter((c) => c.nota);
    if (!docs.has(d.doc)) docs.set(d.doc, { doc: d.doc, id: Number(d.doc.slice(3)), forn: d.forn, data: d.data, valorDoc: d.valorDoc, tipo: tipoDoDocumento(d, ctx), naturezas: new Set(), textos: [], cit: new Map(), todas: new Map() });
    const X = docs.get(d.doc);
    X.naturezas.add(d.natureza); X.textos.push(d.texto.replace(/\s+/g, " ").trim());
    for (const c of todas) if (!X.todas.has(c.num) || (X.todas.get(c.num).valor == null && c.valor != null)) X.todas.set(c.num, c);
    for (const c of cits) {
      const o = X.cit.get(c.num);
      if (!o) X.cit.set(c.num, { ...c, conflito: false });
      else if (o.valor == null && c.valor != null) X.cit.set(c.num, { ...c, conflito: o.conflito });
      else if (o.valor != null && c.valor != null && centavos(o.valor) !== centavos(c.valor)) o.conflito = true;
    }
  }
  for (const [k, X] of docs) if (!X.cit.size) docs.delete(k);
  return docs;
}

function situacaoDoDocumento(ctx, X) {
  if (X.doc.startsWith("NE#")) { const ne = ctx.ne.get(X.id); return ne && ne.id_situacaonotaentrada === 1 ? null : "documento não finalizado ou cancelado no VR"; }
  const v = ctx.vb.get(X.id); return v && v.id_situacaoverba === 1 && v.id_situacaocadastro === 1 ? null : "verba não gerada ou cancelada no VR";
}

// Regra do boleto aplicada à nota de compra: o texto só aponta a nota; o valor vem do abatimento das parcelas dessa compra.
function boletoDaCompra(ctx, X) {
  const ps = ctx.parcelas.get(X.id) || [];
  const abat = ps.reduce((a, p) => a + centavos(p.abatimento), 0);
  if (!ps.length || abat === 0) return { ok: false, motivo: "compra sem abatimento no boleto (só texto)" };
  const todas = [...X.todas.values()];
  if (todas.length === 1) return centavos(todas[0].nota.valor) === abat ? { ok: true, caso: "A" } : { ok: false, motivo: "abatimento diferente do valor da nota" };
  if (!todas.every((c) => c.valor != null && centavos(c.valor) === centavos(c.nota.valor))) return { ok: false, motivo: "várias notas sem valor individual igual ao da nota" };
  return todas.reduce((a, c) => a + centavos(c.nota.valor), 0) === abat ? { ok: true, caso: "B" } : { ok: false, motivo: "soma das notas diferente do abatimento" };
}

function classificarDocumentos(ctx) {
  const docs = juntarDocumentos(ctx);
  const pares = [];
  for (const X of docs.values()) for (const c of X.cit.values()) {
    const nota = ctx.notas.get(c.nota.id);
    const p = { doc: X.doc, tipo: X.tipo, forn: X.forn, data: X.data, texto: X.textos.join(" | ").slice(0, 220), textoCompleto: X.textos.join(" | "), nota_id: c.nota.id, nota: c.num, tipo_nota: c.nota.id_tiposaida,
      valor_nota: n(c.nota.valor), valor_citado: c.valor == null ? null : n(c.valor), forma: c.forma || "cita sem valor", provavel: c.valorProvavel == null ? null : n(c.valorProvavel),
      naoServe: null, obs: [] };
    if (X.naturezas.has("origem (compra devolvida)") && X.naturezas.size === 1) p.naoServe = "é a compra que gerou a devolução, não um pagamento";
    else if (!nota) p.naoServe = "nota fora do cadastro da troca";
    else if (nota.nfe === 3 || nota.nfe === 4) p.naoServe = "nossa nota cancelada ou inutilizada";
    else if (situacaoDoDocumento(ctx, X)) p.naoServe = situacaoDoDocumento(ctx, X);
    else if (!fornecedorCompativel(ctx, X.forn, nota)) p.naoServe = "fornecedor do documento não é compatível com a nota";
    if (c.conflito) p.obs.push("dois valores diferentes no mesmo documento");
    if (ctx.corrigidas.has(c.num)) p.obs.push("nota corrigida no VR: compara com o valor final");
    if (X.tipo === "compra" && !p.naoServe) p.boletoCompra = boletoDaCompra(ctx, X);
    pares.push(p);
  }
  // Decisão por NOTA (nunca soma fontes).
  const porNota = new Map();
  for (const p of pares) { if (!porNota.has(p.nota_id)) porNota.set(p.nota_id, []); porNota.get(p.nota_id).push(p); }
  const notas = [];
  for (const [id, ps] of porNota) {
    const validos = ps.filter((p) => !p.naoServe);
    const r = { nota_id: id, nota: ps[0].nota, tipo_nota: ps[0].tipo_nota, valor_nota: ps[0].valor_nota, pares: ps, docs: [...new Set(ps.map((p) => p.doc))] };
    const bol = ctx.boleto.get(id), tits = ctx.titulos.get(id) || [];
    if (!validos.length) { r.resultado = "nao_serve"; r.motivo = ps[0].naoServe; notas.push(r); continue; }
    const docsValidos = [...new Set(validos.map((p) => p.doc))];
    const semCompra = validos.filter((p) => p.tipo !== "compra");
    if (bol === "A" || bol === "B" || bol === "C") { r.resultado = semCompra.length ? "conferencia" : "ja_no_boleto"; r.motivo = semCompra.length ? "também comprovada no boleto: risco de contar duas vezes" : "comprovada no boleto (caso " + bol + "); o texto da compra é o mesmo acerto"; notas.push(r); continue; }
    if (bol === "ambiguo") { r.resultado = "conferencia"; r.motivo = "a mesma nota está em conferência no boleto"; notas.push(r); continue; }
    if (tits.some((t) => t.situacao === 0) ) { r.resultado = "conferencia"; r.motivo = "título de devolução ainda aberto no VR"; notas.push(r); continue; }
    if (docsValidos.length > 1) { r.resultado = "conferencia"; r.motivo = "a mesma nota citada em mais de um documento"; notas.push(r); continue; }
    const p = validos[0];
    if (p.tipo === "compra") {
      if (p.boletoCompra.ok) { r.resultado = "comprovado"; r.valor_comprovado = p.valor_nota; r.caminho = "boleto da compra (caso " + p.boletoCompra.caso + ")"; }
      else { r.resultado = "conferencia"; r.motivo = p.boletoCompra.motivo; }
      notas.push(r); continue;
    }
    if (p.obs.includes("dois valores diferentes no mesmo documento")) { r.resultado = "conferencia"; r.motivo = "dois valores diferentes no mesmo documento"; }
    else if (p.valor_citado == null) { r.resultado = "conferencia"; r.motivo = "cita a nota sem valor individual"; }
    else if (!temContexto(p.textoCompleto)) { r.resultado = "conferencia"; r.motivo = "texto sem contexto de avaria ou acerto"; }
    else if (centavos(p.valor_citado) > centavos(p.valor_nota)) { r.resultado = "conferencia"; r.motivo = "valor citado maior que a nota"; }
    else if (tits.some((t) => t.situacao === 1)) { r.resultado = "ja_no_titulo"; r.motivo = "comprovada pelo título de devolução baixado no VR; o documento não soma"; }
    else { r.resultado = "comprovado"; r.valor_comprovado = p.valor_citado; r.diferenca = +(p.valor_nota - p.valor_citado).toFixed(2); r.caminho = p.tipo; }
    notas.push(r);
  }
  return { pares, notas, docs };
}

module.exports = { montarContexto, classificarDocumentos, fornecedorCompativel, boletoDaCompra, juntarDocumentos, temContexto };

if (require.main === module) {
  const dir = path.join(process.env.AVR_DADOS || path.join(__dirname, "..", "..", ".previa", "avarias", "dados"), "2026-09-28");
  const ctx = montarContexto(dir);
  const { pares, notas, docs } = classificarDocumentos(ctx);
  const soma = (xs, f) => +xs.reduce((a, x) => a + (f(x) || 0), 0).toFixed(2);
  const grupo = (f) => { const g = {}; for (const x of notas.filter(f)) { const k = x.motivo || x.caminho; g[k] = g[k] || { notas: 0, valor_nota: 0 }; g[k].notas++; g[k].valor_nota = +(g[k].valor_nota + x.valor_nota).toFixed(2); } return g; };
  const porTipo = {};
  for (const X of docs.values()) { const t = porTipo[X.tipo] = porTipo[X.tipo] || { documentos: 0, pares: 0, com_valor: 0, sem_valor: 0 }; t.documentos++; }
  for (const p of pares) { const t = porTipo[p.tipo]; t.pares++; if (p.valor_citado != null) t.com_valor++; else t.sem_valor++; }
  const res = {
    documentos: docs.size, pares: pares.length, notas: notas.length, por_tipo: porTipo,
    comprovado: { notas: notas.filter((x) => x.resultado === "comprovado").length, valor_comprovado: soma(notas.filter((x) => x.resultado === "comprovado"), (x) => x.valor_comprovado), valor_das_notas: soma(notas.filter((x) => x.resultado === "comprovado"), (x) => x.valor_nota), por_caminho: grupo((x) => x.resultado === "comprovado") },
    ja_no_boleto: { notas: notas.filter((x) => x.resultado === "ja_no_boleto").length, valor: soma(notas.filter((x) => x.resultado === "ja_no_boleto"), (x) => x.valor_nota) },
    ja_no_titulo: { notas: notas.filter((x) => x.resultado === "ja_no_titulo").length, valor: soma(notas.filter((x) => x.resultado === "ja_no_titulo"), (x) => x.valor_nota) },
    conferencia: { notas: notas.filter((x) => x.resultado === "conferencia").length, valor_das_notas: soma(notas.filter((x) => x.resultado === "conferencia"), (x) => x.valor_nota), por_motivo: grupo((x) => x.resultado === "conferencia") },
    nao_serve: { notas: notas.filter((x) => x.resultado === "nao_serve").length, pares: pares.filter((p) => p.naoServe).length, por_motivo: pares.filter((p) => p.naoServe).reduce((a, p) => ((a[p.naoServe] = (a[p.naoServe] || 0) + 1), a), {}) },
    diferencas_a_vista: notas.filter((x) => x.resultado === "comprovado" && x.diferenca).map((x) => ({ nota: x.nota, valor_nota: x.valor_nota, comprovado: x.valor_comprovado, diferenca: x.diferenca, caminho: x.caminho })),
  };
  fs.writeFileSync(path.join(dir, "documentos_resultado.json"), JSON.stringify({ res, notas, pares }, null, 1));
  console.log(JSON.stringify(res, null, 1));
}
