// Avarias · etapa 1 · todas as provas juntas, por NOTA da troca (título baixado, boleto, documento).
// Regras: cada nota é contada uma vez; fontes nunca se somam; qualquer conflito entre fontes do VR → conferência.
//   - boleto em conferência ou documento em conferência → conferência;
//   - título de devolução ainda ABERTO no VR e outra fonte dizendo que foi acertado → conferência (aviso no título);
//   - parcela do boleto VENCIDA e ainda aberta no VR → conferência (o boleto pode ter sido trocado); a vencer → comprovado com aviso;
//   - "comprovado" = a regra achou evidência válida; NÃO é o mesmo que dinheiro recuperado.
"use strict";
const { classificarDocumentos } = require("./documentos.cjs");

function consolidar(ctx, notasTroca) {
  const doc = new Map(classificarDocumentos(ctx).notas.map((x) => [x.nota_id, x]));
  const out = [];
  for (const nt of notasTroca) {
    if (nt.nfe !== 1) continue;
    const tits = ctx.titulos.get(nt.id) || [];
    const titulo = !tits.length ? "sem título" : tits.some((t) => t.situacao === 0) ? "aberto" : tits.some((t) => t.situacao === 1) ? "baixado" : "cancelado";
    const bol = ctx.boleto.get(nt.id) || null, d = doc.get(nt.id) || null;
    const fontes = [];
    if (titulo === "baixado") fontes.push("título baixado");
    if (bol && bol !== "ambiguo") fontes.push("boleto " + bol);
    if (d && d.resultado === "comprovado") fontes.push("documento");
    const r = { nota_id: nt.id, nota: nt.numero, valor: Number(nt.valor), titulo, boleto: bol, documento: d ? d.resultado : null, fontes, citada_em_documento: !!d, avisos: [] };
    const parcelas = bol && bol !== "ambiguo" ? (ctx.boletoLinhas.get(nt.id) || []) : [];
    const vencidaAberta = parcelas.filter((p) => Number(p.situacao) === 0 && String(p.vencimento).slice(0, 10) < ctx.corte);
    const aVencer = parcelas.filter((p) => Number(p.situacao) === 0 && String(p.vencimento).slice(0, 10) >= ctx.corte);
    if (aVencer.length) r.avisos.push("parcela a vencer em " + String(aVencer[0].vencimento).slice(0, 10).split("-").reverse().join("/") + ", ainda não paga");
    if (bol === "ambiguo") { r.resultado = "conferencia"; r.motivo = "boleto em conferência"; }
    else if (d && d.resultado === "conferencia") { r.resultado = "conferencia"; r.motivo = "documento em conferência: " + d.motivo; }
    else if (titulo === "aberto" && fontes.length) { r.resultado = "conferencia"; r.motivo = "título ainda aberto no VR, mas " + fontes.join(" e ") + " indica acerto"; }
    else if (vencidaAberta.length) { r.resultado = "conferencia"; r.motivo = "parcela do boleto vencida em " + String(vencidaAberta[0].vencimento).slice(0, 10).split("-").reverse().join("/") + " e ainda aberta no VR"; }
    else if (fontes.length) { r.resultado = "comprovado"; r.valor_comprovado = d && d.resultado === "comprovado" ? d.valor_comprovado : r.valor; }
    else r.resultado = "sem_prova";
    out.push(r);
  }
  return out;
}

// rótulo do quadro: a fonte (ou combinação) da prova + se um documento também cita a nota sem somar
function rotulo(r) {
  let f = r.fontes.map((x) => (x.startsWith("boleto") ? "boleto" : x)).sort().join(" + ");
  if (f === "boleto + título baixado") f = r.boleto === "C" ? "boleto ligado ao título baixado (caso C)" : "boleto + título baixado sem ligação entre os dois";
  return r.documento && r.documento !== "comprovado" && r.documento !== "conferencia" ? f + " (documento também cita; não soma)" : f;
}

module.exports = { consolidar, rotulo };
