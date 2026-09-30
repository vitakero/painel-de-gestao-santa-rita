// Avarias · cálculo (robô). Funções puras sobre a extração do VR. Nada aqui lê ou escreve banco.
// Regras: plano final aprovado em 28/09/2026 (.previa/avarias/plano-v1-avarias-final.html).
"use strict";

const MOTIVO_AVARIA = new Set([1, 2, 3, 8, 12]);   // vencido, embalagem, estragado, impróprio, avaria
const MOTIVO_ERRO = new Set([4, 5, 6]);            // erro ao coletar (2x), erro de balanço
const MOTIVO_OUTROS = new Set([7, 9, 10, 11]);     // nota especificada, ação, degustação, recolhimento
const FORNECEDORES_DA_CASA = new Set([1, 2]);      // G João dos Santos (matriz e filial): nunca é fornecedor
const INICIO_FILA_C = "2026-05-08";
const TIPOS_DEVOLUCAO = new Set([33, 2, 41]);      // devolução troca, com financeiro, sem financeiro

const n = (v) => (v === null || v === undefined || v === "" ? null : Number(v));
const mes = (data) => data.slice(0, 7);
const dias = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const norm = (t) => (t || "").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

// ---------- classes e destinos ----------
function classeEntrada(l) {
  const o = norm(l.obs);
  if (o.includes("RETORNO DE DEVOLUCAO")) return "retorno";
  if (/^NF \d+/.test(o)) return "estorno";
  if (o.startsWith("BALANCO")) return "balanco";
  if (MOTIVO_AVARIA.has(l.motivo)) return "avaria";
  if (MOTIVO_ERRO.has(l.motivo)) return "erro";
  if (MOTIVO_OUTROS.has(l.motivo)) return "outros";
  return "sem_motivo";
}

// Forma de acerto escrita no texto da nota. Mais de uma forma = dúvida = não identificada.
function formaDoTexto(texto) {
  const t = norm(texto);
  if (!t) return { forma: null, assumido: false, duvida: false };
  const assumido = /\bNAO (FAZ|FAZEM|ACEITA|ACEITAM|REALIZA|REALIZAM)( A)? TROCA\b|\bSEM TROCA\b|\bNAO TROCA(M)?\b/.test(t);
  const achadas = [];
  if (/BONIF/.test(t)) achadas.push("bonificacao");
  if (/DESC(ONTO)?\.? ?(EM|NO|DO)? ?BOLETO|DESCONTO EM BOLETO/.test(t)) achadas.push("desconto_boleto");
  if (/\bVERBA\b/.test(t)) achadas.push("verba");
  if (/\bPIX\b|DEPOSITO/.test(t)) achadas.push("pix_deposito");
  if (/\bDINHEIRO\b/.test(t)) achadas.push("dinheiro");
  if (/TROCA POR MERCADORIA|REPOS/.test(t)) achadas.push("troca_mercadoria");
  const unicas = [...new Set(achadas)];
  if (assumido && unicas.length === 0) return { forma: null, assumido: true, duvida: false };
  if (assumido && unicas.length) return { forma: null, assumido: false, duvida: true };
  if (unicas.length === 1) return { forma: unicas[0], assumido: false, duvida: false };
  if (unicas.length > 1) return { forma: null, assumido: false, duvida: true };
  return { forma: null, assumido: false, duvida: false };
}

// Motivo gravado na perda quando a troca foi exportada: vira forma declarada, assumido ou ajuste.
function destinoDaExportacao(nomeMotivo) {
  const m = norm(nomeMotivo);
  const mapa = {
    "BONIFICACAO FORNECEDOR": "bonificacao", "DESCONTO BOLETO": "desconto_boleto", "PAGAMENTO VIA PIX": "pix_deposito",
    "PAGAMENTO DINHEIRO NA HORA": "dinheiro", "TROCA": "troca_mercadoria", "PG BOLETO": "outro", "DEGUSTACAO C PAGAMENTO": "outro",
  };
  if (mapa[m]) return { grupo: "acerto_fornecedor", forma: mapa[m] };
  if (m === "PERDA") return { grupo: "assumido", forma: null };
  if (m === "INVENTARIO" || m === "BALANCO DE ESTOQUE") return { grupo: "balanco_erro", forma: null };
  return { grupo: "nao_identificado", forma: null };
}

function tipoDaNota(nota) {
  if (!nota) return "sem_nota";
  if (nota.tipo_id === 33) return "devolucao_troca";
  if (nota.tipo_id === 2) return "devolucao_financeiro";
  if (nota.tipo_id === 41) return "devolucao_sem_financeiro";
  if (/5\.?927/.test(nota.tipo || "")) return "baixa_perda";
  return "outra_nota";
}

// ---------- custo da data (congelado) ----------
function montarCustos(custos, saldo) {
  const por = new Map();
  for (const c of custos) {
    if (!por.has(c.id_produto)) por.set(c.id_produto, []);
    por.get(c.id_produto).push({ dh: c.datahora, id: c.id, c: n(c.custo), a: n(c.anterior) });
  }
  for (const l of por.values()) l.sort((x, y) => (x.dh < y.dh ? -1 : x.dh > y.dh ? 1 : x.id - y.id));
  const hoje = new Map(saldo.map((s) => [s.id_produto, n(s.custo_hoje)]));
  return function custoDaData(prod, datahora, custoLinha) {
    if (custoLinha !== null && custoLinha > 0) return { custo: custoLinha, fonte: "linha" };
    const l = por.get(prod) || [];
    let lo = 0, hi = l.length - 1, pos = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (l[m].dh <= datahora) { pos = m; lo = m + 1; } else hi = m - 1; }
    // só o registro mais próximo vale: pular registro com zero seria usar custo de outra época (conferência independente, 28/09)
    if (pos >= 0 && l[pos].c > 0) return { custo: l[pos].c, fonte: "historico" };
    if (pos + 1 < l.length && l[pos + 1].a > 0) return { custo: l[pos + 1].a, fonte: "anterior_seguinte" };
    const h = hoje.get(prod);
    if (h > 0) return { custo: h, fonte: "hoje_estimado" };
    return { custo: null, fonte: "sem_custo" };
  };
}

// ---------- vai-e-volta: líquido por nota e produto ----------
// Linhas "NF <n>" do mesmo produto: saídas − entradas de estorno. Retorno (só entradas) fica como entrada.
function agruparNotas(linhas) {
  const grupos = new Map();
  for (const l of linhas) {
    const m = norm(l.obs).match(/^NF (\d+)/);
    if (!m || norm(l.obs).includes("RETORNO DE DEVOLUCAO")) continue;
    const g = grupos.get(m[1]) || { numero: +m[1], saidas: 0, entradas: 0, primeira: null, linhas: [] };
    if (l.tipo === 1) { g.saidas += n(l.qtd); if (!g.primeira || l.id < g.primeira.id) g.primeira = l; }
    else g.entradas += n(l.qtd);
    g.linhas.push(l.id);
    grupos.set(m[1], g);
  }
  return grupos;
}

// ---------- a fila de um produto ----------
// Processa o livro na ordem do número da linha (é a ordem em que o saldo encadeia).
function simularProduto(prod, linhas, ctx) {
  const { custoDaData, notaPorNumero, exportacaoPorLinha, fimDeMes } = ctx;
  linhas = linhas.slice().sort((a, b) => a.id - b.id);
  const fila = [];               // partes paradas: {qtd, custo, data, classe, motivo, linha}
  let divida = 0;                // saldo negativo acumulado (unidades)
  const ev = { entradas: [], saidas: [], componentes: [], fimMes: [], ciclos: [] };
  // CICLO (plano, seção 5): começa quando o saldo LÍQUIDO passa de zero e termina quando volta a zero.
  // Usa o saldo da fila (sem o vai-e-volta), então nota refeita não abre nem fecha ciclo; saldo negativo não é ciclo.
  // IDENTIDADE do ciclo = a linha do VR que o abriu (inicio_linha): não muda quando outro ciclo nasce ou some; "n" é só ordem de exibição.
  let ciclo = null;
  const marcarCiclo = (l) => {
    const sd = fila.reduce((a, p) => a + p.qtd, 0) - divida;
    if (!ciclo && sd > 1e-9) { ciclo = { n: ev.ciclos.length + 1, inicio_linha: l.id, inicio_data: l.data, inicio_datahora: l.datahora, fim_linha: null, fim_data: null, fim_datahora: null }; ev.ciclos.push(ciclo); }
    else if (ciclo && sd <= 1e-9) { ciclo.fim_linha = l.id; ciclo.fim_data = l.data; ciclo.fim_datahora = l.datahora; ciclo = null; }
  };
  const grupos = agruparNotas(linhas);
  const usados = new Set();
  const valorFila = () => fila.reduce((s, p) => s + p.qtd * (p.custo || 0), 0);
  const qtdFila = () => fila.reduce((s, p) => s + p.qtd, 0);

  const tirar = (q) => {                       // consome da frente da fila
    const tomados = []; let falta = q;
    while (falta > 1e-9 && fila.length) {
      const p = fila[0]; const a = Math.min(p.qtd, falta);
      tomados.push({ qtd: a, custo: p.custo, fonte: p.fonte, data: p.data, classe: p.classe, motivo: p.motivo, linha: p.linha });
      p.qtd -= a; falta -= a; if (p.qtd <= 1e-9) fila.shift();
    }
    return { tomados, semSaldo: falta > 1e-9 ? falta : 0 };
  };
  // fonte do custo viaja com cada parte: "hoje_estimado" e "sem_custo" nunca se misturam calados com o custo da data
  const entrar = (q, custo, data, classe, motivo, linha, mesRef, fonte) => {
    const cobre = Math.min(divida, q);
    if (cobre > 1e-9) {
      divida -= cobre;
      ev.componentes.push({ comp: 3, prod, mes: mesRef, qtd: cobre, valor: cobre * (custo || 0), linha, semCusto: custo === null, fonte });
    }
    if (q - cobre > 1e-9) fila.push({ qtd: q - cobre, custo, fonte, data, classe, motivo, linha });
  };

  // 1. saldo que já existia quando o livro começou
  const primeira = linhas[0];
  const abertura = n(primeira.antes);
  if (Math.abs(abertura) > 1e-9) {
    const { custo, fonte } = custoDaData(prod, primeira.datahora, n(primeira.custo)); // custo gravado na 1ª linha tem prioridade
    if (abertura > 0) {
      fila.push({ qtd: abertura, custo, fonte, data: primeira.data, classe: "abertura", motivo: null, linha: primeira.id });
      ev.componentes.push({ comp: 1, prod, mes: mes(primeira.data), qtd: abertura, valor: abertura * (custo || 0), linha: primeira.id, semCusto: custo === null, fonte });
    } else {
      divida = -abertura;
      ev.componentes.push({ comp: 1, prod, mes: mes(primeira.data), qtd: abertura, valor: 0, linha: primeira.id, negativo: true });
    }
    marcarCiclo(primeira);
  }

  let depoisAnterior = abertura;
  let mesAtual = mes(primeira.data);
  const fecharMesesAte = (m) => {
    while (mesAtual < m) {
      ev.fimMes.push({ mes: mesAtual, qtd: qtdFila() - divida, valor: valorFila(), livro: depoisAnterior });
      const [a, b] = mesAtual.split("-").map(Number);
      mesAtual = b === 12 ? `${a + 1}-01` : `${a}-${String(b + 1).padStart(2, "0")}`;
    }
  };

  for (const l of linhas) {
    fecharMesesAte(mes(l.data));
    const q = n(l.qtd), antes = n(l.antes);
    // 4. mudança de saldo sem movimento (o encadeamento do livro quebrou)
    const salto = antes - depoisAnterior;
    if (Math.abs(salto) > 1e-9) {
      const { custo, fonte } = custoDaData(prod, l.datahora, n(l.custo));
      if (salto > 0) { entrar(salto, custo, l.data, "quebra", null, l.id, mes(l.data), fonte); ev.componentes.push({ comp: 4, prod, mes: mes(l.data), qtd: salto, valor: salto * (custo || 0), linha: l.id, fonte }); }
      else { const t = tirar(-salto); divida += t.semSaldo; const v = t.tomados.reduce((s, x) => s + x.qtd * (x.custo || 0), 0); ev.componentes.push({ comp: 4, prod, mes: mes(l.data), qtd: salto, valor: -v, linha: l.id, tomados: t.tomados }); }
      marcarCiclo(l);
    }
    depoisAnterior = n(l.depois);

    const o = norm(l.obs);
    const nf = o.match(/^NF (\d+)/);
    const ehRetorno = o.includes("RETORNO DE DEVOLUCAO");
    const custoLinha = n(l.custo);
    if (nf && !ehRetorno) {
      const g = grupos.get(nf[1]);
      if (g.saidas === 0) {                            // só entradas com esse número: devolve de verdade
        const { custo, fonte } = custoDaData(prod, l.datahora, custoLinha);
        entrar(q, custo, l.data, "retorno", null, l.id, mes(l.data), fonte);
        marcarCiclo(l);
        ev.entradas.push({ prod, linha: l.id, mes: mes(l.data), data: l.data, qtd: q, custo, fonte, classe: "retorno", motivo: null, usuario: l.usuario, ciclo: ciclo ? ciclo.inicio_linha : null });
        continue;
      }
      if (usados.has(nf[1]) || l.id !== g.primeira.id) continue;
      usados.add(nf[1]);
      const liquido = g.saidas - g.entradas;
      if (liquido <= 1e-9) continue;                  // nota cancelada/refeita que zerou
      const { custo: cs, fonte: fs } = custoDaData(prod, l.datahora, custoLinha);
      const cicloDaSaida = ciclo ? ciclo.inicio_linha : null;
      const t = tirar(liquido); divida += t.semSaldo;
      if (t.semSaldo > 1e-9) ev.componentes.push({ comp: 2, prod, mes: mes(l.data), qtd: t.semSaldo, valor: t.semSaldo * (cs || 0), linha: l.id, semCusto: cs === null, fonte: fs });
      marcarCiclo(l);
      ev.saidas.push({ prod, linha: l.id, mes: mes(l.data), data: l.data, qtd: liquido, nf: g.numero, tomados: t.tomados, semSaldo: t.semSaldo, custoSaida: cs, fonteSaida: fs, bruto: g.saidas, estorno: g.entradas, linhas_nota: g.linhas, ciclo: cicloDaSaida });
      continue;
    }
    if (l.tipo === 0) {
      const classe = classeEntrada(l);
      const { custo, fonte } = custoDaData(prod, l.datahora, custoLinha);
      entrar(q, custo, l.data, classe, l.motivo, l.id, mes(l.data), fonte);
      marcarCiclo(l);
      ev.entradas.push({ prod, linha: l.id, mes: mes(l.data), data: l.data, qtd: q, custo, fonte, classe, motivo: l.motivo, usuario: l.usuario, ciclo: ciclo ? ciclo.inicio_linha : null });
    } else {
      const { custo: cs, fonte: fs } = custoDaData(prod, l.datahora, custoLinha);
      const cicloDaSaida = ciclo ? ciclo.inicio_linha : null;
      const t = tirar(q); divida += t.semSaldo;
      if (t.semSaldo > 1e-9) ev.componentes.push({ comp: 2, prod, mes: mes(l.data), qtd: t.semSaldo, valor: t.semSaldo * (cs || 0), linha: l.id, semCusto: cs === null, fonte: fs });
      marcarCiclo(l);
      ev.saidas.push({ prod, linha: l.id, mes: mes(l.data), data: l.data, qtd: q, obs: l.obs, tomados: t.tomados, semSaldo: t.semSaldo, custoSaida: cs, fonteSaida: fs, exportacao: exportacaoPorLinha.get(l.id) || null, ciclo: cicloDaSaida });
    }
  }
  fecharMesesAte(fimDeMes);
  ev.fimMes.push({ mes: mesAtual, qtd: qtdFila() - divida, valor: valorFila(), livro: depoisAnterior });
  return { prod, fila, divida, saldoLivro: depoisAnterior, ev };
}

module.exports = {
  MOTIVO_AVARIA, MOTIVO_ERRO, MOTIVO_OUTROS, FORNECEDORES_DA_CASA, INICIO_FILA_C, TIPOS_DEVOLUCAO,
  n, mes, dias, norm, classeEntrada, formaDoTexto, destinoDaExportacao, tipoDaNota, montarCustos, agruparNotas, simularProduto,
};

// ---------- destino, grupo e nível de cada saída (lado do VR; eventos do Painel entram na etapa 4) ----------
function acharNota(notasPorNumero, numero, data) {
  const cands = (notasPorNumero.get(numero) || []).filter((x) => Math.abs(dias(x.data, data)) <= 45);
  if (cands.length === 1) return cands[0];
  if (cands.length > 1) return cands.sort((a, b) => Math.abs(dias(a.data, data)) - Math.abs(dias(b.data, data)))[0];
  return null;
}

function classificarSaida(s, ctx) {
  const { notasPorNumero, titulosPorNota, motivoPerdaNome } = ctx;
  const out = { destino: null, grupo: null, forma: null, nivel: null, nota: null, fornecedor: null, titulo: null, motivoVR: null };
  if (s.nf !== undefined) {
    const nota = acharNota(notasPorNumero, s.nf, s.data);
    out.nota = nota;
    out.destino = tipoDaNota(nota);
    if (!nota) { out.grupo = "nao_identificado"; out.nivel = "nao_identificado"; return out; }
    const texto = formaDoTexto(nota.texto);
    if (TIPOS_DEVOLUCAO.has(nota.tipo_id)) {
      if (nota.fornecedor && !FORNECEDORES_DA_CASA.has(nota.fornecedor)) out.fornecedor = nota.fornecedor;
      out.grupo = "acerto_fornecedor";
      out.forma = texto.forma || "devolucao";
      const tits = titulosPorNota.get(nota.id) || [];
      const aberto = tits.find((t) => t.situacao === 0), baixado = tits.find((t) => t.situacao === 1);
      out.titulo = aberto || baixado || tits[0] || null;
      if (baixado && !aberto) out.nivel = "comprovado";
      else if (aberto) out.nivel = "em_aberto";
      else out.nivel = texto.forma ? "declarado" : "nao_identificado";
      return out;
    }
    if (out.destino === "baixa_perda") {
      if (texto.assumido) { out.grupo = "assumido"; out.origem = "vr"; return out; }
      if (texto.forma) { out.grupo = "acerto_fornecedor"; out.forma = texto.forma; out.nivel = "declarado"; return out; }
      out.grupo = "nao_identificado"; out.nivel = "nao_identificado"; out.duvida = texto.duvida; return out;
    }
    out.grupo = "nao_identificado"; out.nivel = "nao_identificado"; return out;
  }
  const o = norm(s.obs);
  if (o.startsWith("EXPORTACAO TROCA P/ LOJA")) { out.destino = "voltou_loja"; out.grupo = "voltou_loja"; return out; }
  if (o.startsWith("BALANCO")) { out.destino = "balanco"; out.grupo = "balanco_erro"; return out; }
  if (o.startsWith("EXPORTACAO TROCA P/ PERDA")) {
    out.destino = "exportada_perda";
    if (!s.exportacao) { out.grupo = "nao_identificado"; out.nivel = "nao_identificado"; return out; }
    out.motivoVR = motivoPerdaNome.get(s.exportacao.motivo) || "?";
    const d = destinoDaExportacao(out.motivoVR);
    out.grupo = d.grupo; out.forma = d.forma;
    if (d.grupo === "acerto_fornecedor") out.nivel = "declarado";
    if (d.grupo === "assumido") out.origem = "vr";
    if (d.grupo === "nao_identificado") out.nivel = "nao_identificado";
    return out;
  }
  if (/^(ERRO|ARRO|AJUSTE|CORRE|ACERTO|FOI TIRADO|NAO ENCONTRADO)/.test(o)) { out.destino = "erro_ajuste"; out.grupo = "balanco_erro"; return out; }
  out.destino = "nao_identificado"; out.grupo = "nao_identificado"; out.nivel = "nao_identificado";
  return out;
}

// Liga cada saída "EXPORTACAO TROCA P/ PERDA" à linha da perda (mesmo produto, dia e quantidade).
// O VR às vezes junta duas saídas do mesmo produto e dia numa linha só: aí vale a soma.
function ligarExportacoes(troca, perdas) {
  const exp = perdas.filter((p) => norm(p.obs).startsWith("EXPORTACAO TROCA"));
  const porChave = new Map();
  for (const p of exp) { const k = p.id_produto + "|" + p.data; if (!porChave.has(k)) porChave.set(k, []); porChave.get(k).push({ ...p, usado: false }); }
  const saidas = troca.filter((l) => l.tipo === 1 && norm(l.obs).startsWith("EXPORTACAO TROCA P/ PERDA"));
  const mapa = new Map(); const semPar = [];
  const porDia = new Map();
  for (const l of saidas) { const k = l.id_produto + "|" + l.data; if (!porDia.has(k)) porDia.set(k, []); porDia.get(k).push(l); }
  for (const [k, ls] of porDia) {
    const ps = porChave.get(k) || [];
    for (const l of ls) {
      const p = ps.find((x) => !x.usado && Math.abs(n(x.qtd) - n(l.qtd)) < 1e-6);
      if (p) { p.usado = true; mapa.set(l.id, p); }
    }
    const faltam = ls.filter((l) => !mapa.has(l.id));
    if (faltam.length) {
      const soma = faltam.reduce((s, l) => s + n(l.qtd), 0);
      const p = ps.find((x) => !x.usado && Math.abs(n(x.qtd) - soma) < 1e-6);
      if (p) { p.usado = true; for (const l of faltam) mapa.set(l.id, p); }
      else semPar.push(...faltam.map((l) => l.id));
    }
  }
  return { mapa, semPar };
}

Object.assign(module.exports, { acharNota, classificarSaida, ligarExportacoes });
