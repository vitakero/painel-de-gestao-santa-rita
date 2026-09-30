// Avarias · evidências documentais (regras aprovadas no fechamento da etapa 1, 28/09/2026).
// Desconto no boleto: o texto só IDENTIFICA a nossa nota; o valor vem sempre do abatimento estruturado.
"use strict";
const DINHEIRO = /(\d{1,3}(?:\.\d{3})+,\d{2}|\d+,\d{2})/g;
const valorBR = (s) => Number(s.replace(/\./g, "").replace(",", "."));

// linhas = saída da consulta de leitura das parcelas (uma linha por parcela × nota citada, já conferida no cadastro de notas)
function classificarBoleto(linhas) {
  const porParcela = new Map(), parcelasDaNota = new Map();
  for (const r of linhas) {
    if (!porParcela.has(r.id_parcela)) porParcela.set(r.id_parcela, []);
    porParcela.get(r.id_parcela).push(r);
    if (!parcelasDaNota.has(r.id_notasaida)) parcelasDaNota.set(r.id_notasaida, new Set());
    parcelasDaNota.get(r.id_notasaida).add(r.id_parcela);
  }
  const out = [];
  for (const [pid, rs] of porParcela) {
    for (const r of rs) {
      let caso = "ambiguo", motivo = null;
      const emVarias = parcelasDaNota.get(r.id_notasaida).size > 1;
      if (r.confianca === "SEGURO_TITULO") caso = "C";
      else if (emVarias) motivo = "mesma nota citada em mais de uma parcela";
      else if (r.confianca === "SEGURO_1_NOTA") caso = "A";
      else if (r.confianca === "SEGURO_VARIAS_NOTAS") {
        motivo = associacaoInequivoca(rs);
        if (!motivo) caso = "B";
      } else motivo = { REVISAR_VALOR_DIFERENTE: "valor diferente", REVISAR_SO_TEXTO: "só texto, sem valor estruturado", REVISAR_TITULO_DE_OUTRA_NOTA: "título de outra nota" }[r.confianca] || "outro";
      out.push({ parcela: pid, nota_id: r.id_notasaida, nota: r.nossa_nota, troca: r.tipolocalbaixa === 1, valor_nota: Number(r.valor_nossa_nota), caso, motivo });
    }
  }
  return out;
}

// Várias notas: cada nota citada uma vez; o primeiro valor logo depois dela é o dela e é igual ao valor da nota; soma = abatimento.
function associacaoInequivoca(rs) {
  const txt = (rs[0].observacao || "").toUpperCase();
  const pos = [];
  for (const r of rs) {
    const re = new RegExp("(?<!\\d)" + r.nossa_nota + "(?!\\d)", "g");
    const achados = [...txt.matchAll(re)];
    if (achados.length !== 1) return "nota citada zero ou mais de uma vez no texto";
    pos.push({ p: achados[0].index, r });
  }
  pos.sort((a, b) => a.p - b.p);
  for (let i = 0; i < pos.length; i++) {
    const fim = i + 1 < pos.length ? pos[i + 1].p : txt.length;
    const trecho = txt.slice(pos[i].p + String(pos[i].r.nossa_nota).length, fim);
    const v = trecho.match(DINHEIRO);
    if (!v) return "nota sem valor ao lado";
    if (Math.abs(valorBR(v[0]) - Number(pos[i].r.valor_nossa_nota)) > 0.0001) return "valor ao lado diferente do valor da nota";
  }
  const soma = rs.reduce((a, r) => a + Number(r.valor_nossa_nota), 0);
  if (Math.abs(soma - Number(rs[0].abatimento_total || 0)) > 0.0001) return "soma diferente do abatimento";
  return null;
}

// Resultado por NOTA: qualquer linha em dúvida põe a nota inteira em conferência (ex.: NF 12345, título numa parcela e texto em outra).
function casoPorNota(linhas) {
  const m = new Map();
  for (const x of classificarBoleto(linhas).filter((y) => y.troca)) {
    const a = m.get(x.nota_id);
    if (!a) m.set(x.nota_id, { ...x });
    else if (x.caso === "ambiguo" || a.caso !== x.caso) { a.caso = "ambiguo"; a.motivo = a.motivo || x.motivo || "resultado diferente em parcelas diferentes"; }
  }
  return m;
}

module.exports = { classificarBoleto, casoPorNota, associacaoInequivoca, valorBR };
