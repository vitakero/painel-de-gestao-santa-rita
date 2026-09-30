// ==AVR-SINCRONIZAR== AVARIAS · UMA rodada do robô do piloto: VR (só leitura) -> cálculo aprovado -> nuvem -> retrato.
//
//   a nuvem primeiro: a lista de consultas é a de tela/consultas.js? (decisão D4) e o estado local confere?
//   -> extrair (extrair-vr.cjs)  ->  montarCopias (montar-copias.cjs, o MESMO da etapa 2) e o resumo da conferência do
//   cálculo JS dessa mesma montagem  ->  cópias de apoio (apoio-copias.cjs, o MESMO da etapa 3)
//   -> enviar só o que mudou (enviar-nuvem.cjs)  ->  retrato: iniciar, montar cada consulta da tela, publicar
//   -> a rodada deu certo: avaria_sync "avaria_rodada" sem erro (D1) e o resumo em "conferencia_js" (D2)
// Falhou qualquer passo: o retrato não é publicado e o erro vai para avaria_sync "avaria_rodada" (D1), quando a nuvem deixa.
// Cada fase é medida (resultado.tempos, em ms). Quem chama é scripts/vr-sync-avarias.cjs (a entrada, com janela, trava e
// vigia). Tudo que toca o mundo chega por "o" — o teste troca por imitações (VR de mentira não existe: o teste do VR é
// só leitura e de verdade; a nuvem é um servidor de mentira local).
//
// TRAVAS CONTRA "VR MUDO" (antes de gravar QUALQUER linha): livro com menos de MINIMO_LIVRO linhas, ou uma tabela de
// histórico (ou o saldo) em que sumiria de uma vez mais que max(20, 1%) do que a nuvem tem = erro, nada gravado. Uma
// extração pela metade não pode marcar o livro inteiro como "sumiu". AVR_ACEITAR_SUMICO=1 (só na mão) aceita o sumiço.
"use strict";
const path = require("path");
const K = require("./colunas.cjs");

const JANELA_INI = 6, JANELA_FIM = 21;   // [06:00, 21:00) hora de Caicó
const TRAVA_MIN = 20;                    // no máximo 1 vez a cada 20 min (a frequência do projeto)
const MINIMO_LIVRO = 1000;               // 28/09: 36.649 linhas no livro da troca
const SUMICO_MIN = 20, SUMICO_PCT = 0.01;

// ============================================================================ funções puras
function brasilia(ms) {
  const d = new Date(ms - 3 * 3600e3);
  return { data: d.toISOString().slice(0, 10), hora: d.getUTCHours(), minuto: d.getUTCMinutes() };
}
function janelaAberta(ms) { const h = brasilia(ms).hora; return h >= JANELA_INI && h < JANELA_FIM; }
// A trava guarda o instante (ms) da última tentativa. Ausente, ilegível ou no FUTURO (relógio que voltou) libera:
// trava que nunca solta é pior que uma rodada a mais.
function travaLibera(conteudo, agoraMs, minutos) {
  const ult = parseInt(String(conteudo == null ? "" : conteudo).trim(), 10);
  if (!Number.isFinite(ult)) return true;
  if (ult > agoraMs + 5 * 60e3) return true;
  return agoraMs - ult >= (minutos || TRAVA_MIN) * 60e3;
}
function decidirRodada(o) {
  if (o.seco) return { rodar: true, motivo: "modo seco: lê o VR e monta tudo, não toca na nuvem" };
  if (o.forcar) return { rodar: true, motivo: "AVR_FORCAR=1: ignora janela, trava e vigia (carga do Mac)" };
  if (!janelaAberta(o.agoraMs)) { const b = brasilia(o.agoraMs); return { rodar: false, motivo: "fora da janela (" + String(b.hora).padStart(2, "0") + "h; roda das 06h às 21h)" }; }
  if (!travaLibera(o.trava, o.agoraMs)) {
    const min = Math.round((o.agoraMs - parseInt(o.trava, 10)) / 60e3);
    return { rodar: false, motivo: "última tentativa há " + min + " min (roda no máximo 1 vez a cada " + TRAVA_MIN + " min)" };
  }
  return { rodar: true, motivo: "janela aberta e trava livre" };
}
// O RESUMO DA CONFERÊNCIA do cálculo JS — o que a reconciliação de produção compara com as visões da MESMA extração
// (decisão D2: sobe em avaria_sync, linha conferencia_js, coluna detalhe). Recebe a montagem (montar-copias.cjs devolve
// {T, R, D, ctx, DOC}: a MESMA execução que gerou as cópias) e a pasta da extração (o boleto é lido de lá).
// Só contagens e somas: nenhuma lista por nota, nenhum nome de fornecedor.
// A FILA C tem DOIS números, com nomes que dizem a regra (nunca "fila_c" solto: são coisas diferentes):
//   fila_c_etapa1_antes_das_provas  a regra da etapa 1 (R.conf.filaC; os números aprovados ficam no relatório da etapa 1)
//   fila_c_depois_das_provas        a fila C da tela e da produção (avaria_fila_c_v): desconta as notas comprovadas por
//                                   boleto ou documento — a conta da reconciliação aprovada (reconciliar-etapa2.cjs)
// As provas (boleto, documentos, quadro geral, avisos da fila B) são calculadas à parte, dentro de try/catch: o resumo é
// diagnóstico e nunca derruba a rodada; se falhar, vai "erro_do_resumo" no lugar delas.
const c2 = (v) => Math.round(Number(v) * 100) / 100;
function resumoProvas(cop, pasta) {
  const fs = require("fs");
  const { consolidar } = require("./consolidar.cjs");
  const { casoPorNota } = require("./evidencias.cjs");
  const { INICIO_FILA_C } = require("./calculo.cjs");
  const CONS = consolidar(cop.ctx, cop.D.notas), DOC = cop.DOC;
  const porNota = new Map(CONS.map((x) => [x.nota_id, x])), notasT = new Map(cop.T.avaria_notas_vr.map((y) => [y.nota_id, y]));
  // a fila C depois das provas: a mesma conta de reconciliar-etapa2.cjs (fila C da etapa 1 menos as notas comprovadas)
  const filaC = cop.D.notas.filter((x) => x.data >= INICIO_FILA_C && x.nfe === 1).filter((x) => {
    const t = cop.ctx.titulos.get(x.id) || []; if (t.some((y) => y.situacao === 0 || y.situacao === 1)) return false;
    const n0 = notasT.get(x.id); if (n0 && n0.destino === "baixa_perda" && n0.assumido_texto) return false;
    const cc = porNota.get(x.id); return !(cc && cc.resultado === "comprovado" && cc.valor_comprovado >= Number(x.valor) - 1e-9);
  });
  const bol = [...casoPorNota(JSON.parse(fs.readFileSync(path.join(pasta, "descobertas", "boleto_leitura_desde2023.json"), "utf8"))).values()].filter((x) => x.troca !== false);
  const conta = (l, f) => l.filter(f).length, soma = (l, f) => c2(l.reduce((a, x) => a + f(x), 0));
  const docCom = DOC.notas.filter((x) => x.resultado === "comprovado"), consCom = CONS.filter((x) => x.resultado === "comprovado");
  return {
    fila_c_depois_das_provas: { notas: filaC.length, valor: soma(filaC, (x) => Number(x.valor)) },
    fila_b_avisos_outra_fonte: conta(CONS, (x) => x.titulo === "aberto" && x.resultado === "conferencia" && String(x.motivo || "").startsWith("título ainda aberto"))
      + conta(DOC.notas, (x) => x.motivo === "título de devolução ainda aberto no VR"),
    boleto: { A: conta(bol, (x) => x.caso === "A"), B: conta(bol, (x) => x.caso === "B"), C: conta(bol, (x) => x.caso === "C"), conferencia: conta(bol, (x) => x.caso === "ambiguo"),
      validas_comprovadas_no_quadro: conta(CONS, (x) => x.boleto && x.boleto !== "ambiguo" && x.resultado === "comprovado") },
    documentos: Object.assign(Object.fromEntries(["comprovado", "conferencia", "ja_no_boleto", "ja_no_titulo", "nao_serve"].map((k) => [k, conta(DOC.notas, (x) => x.resultado === k)])),
      { valor_comprovado: soma(docCom, (x) => x.valor_comprovado) }),
    quadro_geral: { notas: CONS.length, comprovado: consCom.length, conferencia: conta(CONS, (x) => x.resultado === "conferencia"), sem_prova: conta(CONS, (x) => x.resultado === "sem_prova"),
      valor_comprovado: soma(consCom, (x) => x.valor_comprovado) },
  };
}
function resumoConferencia(cop, pasta) {
  const R = cop && cop.conf ? cop : cop && cop.R;       // aceita também o R do etapa1 sozinho (sem as provas)
  const c = (R && R.conf) || {};
  const pega = (o, ks) => (o ? Object.fromEntries(ks.filter((k) => k in o).map((k) => [k, o[k]])) : null);
  const out = {
    corte: R && R.corte,
    unidades: pega(c.unidades, ["produtos", "diferencas"]),
    fim_de_mes: pega(c.fimDeMes, ["diferencas"]),
    identidade: c.identidade ? { maior_diferenca_nao_explicada: c.identidade.maior_diferenca_nao_explicada, meses: (c.identidade.meses || []).length,
      por_mes: (c.identidade.meses || []).map((m) => pega(m, ["mes", "entradas", "saidas", "C1", "C2", "C3", "C4", "parado", "diferenca_nao_explicada", "sem_custo"])) } : null,
    componentes: c.componentes || null,
    parado: pega(c.parado, ["produtos", "unidades", "valor", "valor_metodo_independente", "diferencas", "faixas"]),
    saldo_negativo: c.saldo_negativo || null,
    fila_b: c.filaB || null,
    fila_c_etapa1_antes_das_provas: c.filaC ? pega(c.filaC, ["notas", "valor", "por_tipo", "declaradas", "nao_identificadas"]) : null,
    custo: c.custo || null,
    custo_estimado: pega(c.custo_estimado, ["entradas", "valor", "unidades", "produtos", "parado", "sem_custo", "partes_sem_fonte",
      "componentes", "saidas_de_partes_estimadas", "saidas_sem_saldo_estimadas", "avaria_2025"]),
    notas_estorno: c.notas_estorno ? pega(c.notas_estorno, ["canceladas_ou_inutilizadas", "canceladas_zeradas", "corrigidas_autorizadas", "corrigidas_batem_com_itens"]) : null,
    linhas_repetidas: c.linhas_repetidas || null,
    exportacoes: c.exportacoes || null,
    saidas: c.saidas || null,                          // ano|destino|nível -> valor (as mesmas 30 combinações da etapa 2)
    referencias: c.referencias || null,
  };
  if (out.custo_estimado && out.custo_estimado.sem_custo) out.custo_estimado.sem_custo = pega(out.custo_estimado.sem_custo, ["entradas", "unidades", "unidades_que_sairam_sem_valor"]);
  if (cop && cop.D && cop.ctx && cop.DOC && cop.T && pasta) {
    try { Object.assign(out, resumoProvas(cop, pasta)); } catch (e) { out.erro_do_resumo = String((e && e.message) || e).slice(0, 300); }
  } else out.erro_do_resumo = "sem a montagem completa: provas, boleto, documentos e fila C depois das provas não calculados";
  return out;
}
// Sumiço grande numa tabela de histórico (ou no saldo) = extração suspeita. Devolve a lista de problemas (vazia = ok).
function conferirSumico(planos, aceitar) {
  const erros = [];
  for (const p of planos) {
    const n = p.carga === "historico" ? p.marcar.length : p.carga === "saldo" ? p.zerar.length : 0;
    const base = p.total + n;
    const lim = Math.max(SUMICO_MIN, Math.ceil(base * SUMICO_PCT));
    if (n > lim) erros.push(p.tab + ": " + n + " linha(s) sumiriam de uma vez (limite " + lim + ")");
  }
  return aceitar ? [] : erros;
}
// As consultas da tela (tela/consultas.js é código de NAVEGADOR e o package.json da raiz é "type": "module": o Node não o
// carrega com require; lê o MESMO arquivo num contexto isolado, como a prévia faz em tela/ler-consultas.cjs).
function lerConsultas(arquivo) {
  const fs = require("fs"), vm = require("vm");
  const ctx = {};
  vm.runInNewContext(fs.readFileSync(arquivo || path.join(__dirname, "tela", "consultas.js"), "utf8"), ctx, { timeout: 2000 });
  if (!ctx.AV_CONSULTAS || !Object.keys(ctx.AV_CONSULTAS).length) throw new Error("a lista de consultas da tela veio vazia");
  return ctx.AV_CONSULTAS;
}
// Mensagem de erro do Node ou do driver (em inglês) ganha a explicação em português na frente; o original vai junto.
function explicarErro(msg) {
  const m = String(msg || "");
  if (/ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ENOTFOUND|EAI_AGAIN/.test(m)) return "sem conexão (" + m + ")";
  if (/ETIMEDOUT|timeout|Connection terminated/i.test(m) && !/tempo esgotado|não respondeu/.test(m)) return "demorou demais e foi cortado (" + m + ")";
  if (/statement timeout|canceling statement/i.test(m)) return "a consulta passou do tempo e foi cancelada (" + m + ")";
  return m;
}
function nomesDasConsultas(consultas) { return Object.keys(consultas || lerConsultas()); }

// ============================================================================ a rodada
//   o.agoraMs, o.seco, o.forcar, o.log, o.relogio (ms; padrão Date.now)
//   o.lerTrava() / o.gravarTrava(ms)                 trava em output/ (não usada no seco nem com AVR_FORCAR)
//   o.pasta                                          onde a extração é escrita (sobrescrita a cada rodada)
//   o.extrair(pasta, {agoraMs, vendaCache, log})     padrão: extrair-vr.cjs (VR só leitura)
//   o.lerVendaCache() / o.gravarVendaCache(c)        cache da venda do dia
//   o.montar(pasta) -> {T, R}                        padrão: montar-copias.cjs
//   o.apoio(pasta, parcelas) -> {T}                  padrão: apoio-copias.cjs
//   o.envio                                          criarEnvio(...) de enviar-nuvem.cjs (ausente no seco)
//   o.consultas                                      as consultas do retrato: o objeto de tela/consultas.js (padrão: lê o arquivo)
//   o.escreverResumo(obj), o.gravarConferencia(obj)  arquivos em output/
//   o.aceitarSumico                                  AVR_ACEITAR_SUMICO=1
async function rodar(o) {
  const log = o.log || console.log, relogio = o.relogio || Date.now;
  const inicio = relogio(), agoraMs = o.agoraMs || inicio;
  const dec = decidirRodada({ seco: o.seco, forcar: o.forcar, agoraMs, trava: o.seco || o.forcar ? null : (o.lerTrava ? o.lerTrava() : null) });
  if (!dec.rodar) { log("Avarias: pulando — " + dec.motivo + "."); return { ok: true, pulou: true, motivo: dec.motivo }; }
  log("Avarias: " + dec.motivo + " · hoje " + brasilia(agoraMs).data + (o.seco ? " · MODO SECO (não toca na nuvem)" : ""));
  const tempos = {}, fase = async (nome, fn) => { const t = relogio(); try { return await fn(); } finally { tempos[nome] = relogio() - t; } };
  const res = { ok: false, seco: !!o.seco, tempos, motivo: dec.motivo };
  try {
    // a trava é gravada quando a tentativa COMEÇA: falha também espera (VR engasgado não é martelado a cada rodada)
    if (!o.seco && !o.forcar && o.gravarTrava) { try { o.gravarTrava(agoraMs); } catch (e) { log("  (não consegui gravar a trava: " + e.message + ")"); } }

    // 0) a nuvem primeiro: é barato e, se as tabelas ainda não existem (SQL do piloto não rodou), se o SQL do piloto na
    //    nuvem é de outra lista de consultas (D4) ou se a nuvem está fora, nem incomoda o VR. Aqui também o estado local é
    //    conferido (e relido da nuvem se não bater).
    const defs = o.consultas || lerConsultas();
    if (!o.seco) await fase("nuvem_conferir", async () => { await o.envio.conferirConsultas(defs); await o.envio.conferirEstado(); });

    // 1) o VR, só leitura
    const extrair = o.extrair || require("./extrair-vr.cjs").extrair;
    const cache = o.lerVendaCache ? o.lerVendaCache() : null;
    const ex = await fase("extrair", () => extrair(o.pasta, { agoraMs, vendaCache: cache, log }));
    res.corte = ex.manifesto.corte_vr; res.venda = ex.plano; res.extracao = ex.manifesto.fontes; res.tempos_vr = ex.tempos;
    if (!o.seco && o.gravarVendaCache && ex.vendaCache && ex.plano && ex.plano.modo !== "reaproveitar") {
      try { o.gravarVendaCache(ex.vendaCache); } catch (e) { log("  (não consegui guardar o cache da venda: " + e.message + ")"); }
    }
    const lidoEm = new Date(agoraMs).toISOString();   // "Dados do VR atualizados às" = quando o VR foi lido

    // 2) o cálculo aprovado: as cópias que a nuvem terá, e o resumo da conferência DESSA montagem (a mesma execução)
    const montar = o.montar || require("./montar-copias.cjs").montarCopias;
    const cop = await fase("montar", () => montar(path.resolve(o.pasta)));
    res.conferencia = await fase("resumo", () => {
      try { return resumoConferencia(cop && cop.R ? cop : Object.assign({}, cop, { R: ex.R }), path.resolve(o.pasta)); }
      catch (e) { return { erro_do_resumo: String((e && e.message) || e).slice(0, 300) }; }      // diagnóstico: nunca derruba a rodada
    });
    if (res.conferencia.erro_do_resumo) log("  (resumo da conferência incompleto: " + res.conferencia.erro_do_resumo + ")");
    if (o.gravarConferencia) { try { o.gravarConferencia(Object.assign({ gerado_em: lidoEm }, res.conferencia)); } catch (e) { log("  (não consegui gravar a conferência: " + e.message + ")"); } }

    // 3) as cópias de apoio da tela
    const apoio = o.apoio || require("./apoio-copias.cjs").copiasDeApoio;
    const ap = await fase("apoio", () => apoio(path.resolve(o.pasta), cop.T.avaria_parcelas_vr));
    const tabelas = {};
    for (const tab of K.TABELAS) tabelas[tab] = (cop.T[tab] || ap.T[tab]);
    for (const tab of K.TABELAS) if (!Array.isArray(tabelas[tab])) throw new Error("a montagem não trouxe " + tab + "; nada gravado");
    res.contagens = Object.fromEntries(K.TABELAS.map((t) => [t, tabelas[t].length]));
    if (tabelas.avaria_trocas_vr.length < MINIMO_LIVRO)
      throw new Error("o VR devolveu só " + tabelas.avaria_trocas_vr.length + " linha(s) do livro da troca (esperado mais de " + MINIMO_LIVRO + "); nada gravado");
    log("  montado: livro " + tabelas.avaria_trocas_vr.length + " · saídas " + tabelas.avaria_saidas_vr.length + " · partes paradas " +
      tabelas.avaria_parcelas_vr.length + " · títulos " + tabelas.avaria_titulos_vr.length + " · diferença não explicada " +
      (res.conferencia.identidade ? res.conferencia.identidade.maior_diferenca_nao_explicada : "?"));

    if (o.seco) {
      res.ok = true; res.tempos.total = relogio() - inicio;
      if (o.escreverResumo) o.escreverResumo(Object.assign({ modo: "seco", gerado_em: new Date().toISOString() }, res));
      return res;
    }

    // 4) a nuvem: só o que mudou (com a trava de sumiço antes de gravar qualquer linha)
    const consultas = Object.keys(defs);
    await fase("enviar", () => o.envio.carregar(tabelas, lidoEm, (planos) => {
      const erros = conferirSumico(planos, o.aceitarSumico);
      if (erros.length) throw new Error("extração suspeita, nada gravado — " + erros.join("; ") + ". Se for de verdade, rode na mão com AVR_ACEITAR_SUMICO=1");
    }));
    res.envio = o.envio.resultado;
    // 5) o retrato que o Painel lê (só publica se TODAS as consultas montarem)
    await fase("retrato", () => o.envio.montarRetrato(consultas));
    // 6) a rodada deu certo (D1): a linha da rodada fica com a hora boa e sem erro
    await fase("fechar", () => o.envio.registrarSucesso(lidoEm));
    res.ok = true;
    // 7) o resumo da conferência (D2), amarrado a esta leitura e a esta versão do retrato. É diagnóstico: falhar aqui não
    //    desfaz a rodada (o retrato já está publicado), vai para o log.
    try {
      await fase("conferencia", () => o.envio.subirConferencia(Object.assign({ lido_em: lidoEm, versao_retrato: res.envio.retrato.versao,
        acumula_sumiram_do_vr: res.envio.acumula_sumiram_do_vr || {} }, res.conferencia), lidoEm));
    } catch (e) { res.aviso_conferencia = explicarErro(e && e.message); log("  (o resumo da conferência não subiu: " + res.aviso_conferencia + ")"); }
    res.tempos.total = relogio() - inicio;
    const gravadas = Object.values(res.envio.tabelas).reduce((a, r) => a + r.gravadas + r.marcadas_sumiu + r.zeradas + r.apagadas, 0);
    log("Avarias: OK — " + gravadas + " linha(s) mudaram na nuvem; retrato versão " + res.envio.retrato.versao + " publicado (" +
      consultas.length + " consultas) · " + Math.round(res.tempos.total / 1000) + " s.");
    return res;
  } catch (e) {
    const msg = explicarErro((e && e.message) || e).slice(0, 900);
    res.erro = msg; res.tempos.total = relogio() - inicio;
    if (o.envio && o.envio.resultado) res.envio = o.envio.resultado;
    const publicado = !!(o.envio && o.envio.resultado && o.envio.resultado.retrato && o.envio.resultado.retrato.publicado);
    log("Avarias: falhou, " + (publicado ? "depois de publicar o retrato novo (só o fechamento da rodada falhou)" : "painel segue com o retrato anterior") + " — " + msg);
    if (!o.seco && o.envio) {
      try { await o.envio.registrarFalha(msg); } catch (e2) { log("  (e nem o erro foi anotado na nuvem: " + e2.message + ")"); }
    }
    if (o.seco && o.escreverResumo) { try { o.escreverResumo(Object.assign({ modo: "seco", gerado_em: new Date().toISOString() }, res)); } catch (e3) { /* sem arquivo */ } }
    return res;
  }
}

module.exports = {
  brasilia, janelaAberta, travaLibera, decidirRodada, resumoConferencia, conferirSumico, lerConsultas, nomesDasConsultas, explicarErro, rodar,
  JANELA_INI, JANELA_FIM, TRAVA_MIN, MINIMO_LIVRO, SUMICO_MIN, SUMICO_PCT,
};
