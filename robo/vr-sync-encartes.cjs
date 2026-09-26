// ROBÔ DOS ENCARTES — a ficha de cada produto ATIVO do VR, na nuvem (encarte_produtos_vr).
//
//   node scripts/vr-sync-encartes.cjs                   -> rodada normal (chamada pelo buildVrData, bloco ==ENC==)
//   ENC_FORCAR=1 node scripts/vr-sync-encartes.cjs      -> ignora janela e trava (carga inicial, do Mac)
//   node scripts/vr-sync-encartes.cjs --seco [--saida=arquivo.json]
//                                                       -> lê o VR e escreve o resultado num arquivo; NÃO toca na nuvem
//
// Só LÊ o VR (BEGIN READ ONLY ... ROLLBACK). ESCREVE só na nuvem, com a chave de serviço, e só
// em encarte_produtos_vr e encarte_sync. NUNCA APAGA LINHA: produto inativado fica com a última
// ficha (especificação V1, seção 10). Quem compra consulta a ficha pela função
// encarte_buscar_produtos; a proposta tira dela o "custo de hoje" no momento do registro.
//
// POR QUE INCREMENTAL: são ~21,6 mil produtos ativos. Regravar tudo a cada hora seria mandar
// ~15 MB por rodada para mudar meia dúzia de preços. Cada linha leva uma IMPRESSÃO (hash dos
// campos); o robô lê da nuvem só (produto_id, impressao) e grava só o que mudou.
//
// TUDO AQUI FOI MEDIDO NO VR EM 26/09/2026 (não chutado):
// · ATIVO = produtocomplemento.id_situacaocadastro = 1 na loja 1: 21.601 produtos (de 47.934).
// · CUSTO = produtocomplemento.custocomimposto (loja 1), o custo com imposto da última entrada.
//   96 ativos vêm nulos ou ≤ 0: vão NULOS. Zero no lugar de "não sei" faria a margem da
//   proposta dar 100% e parecer ótima.
// · CARNE DE DESOSSA (mercadologico1=42 "NOVO ACOUGUE", mercadologico2=1 "CARNE BOVINA RN"):
//   41 ativos. O custo da peça sai do rateio da carcaça, não da nota: custo_confiavel=false.
// · PREÇO: durante oferta ativa o produtocomplemento.precovenda JÁ É o preço de oferta
//   (186 de 186 ofertas ativas conferidas). Por isso preco_atual = precovenda e o preço NORMAL
//   vem da própria oferta (oferta.preconormal). Sem oferta ativa, normal = atual.
// · OFERTA ATIVA HOJE = situação 1 E datainicio ≤ hoje ≤ datatermino. A situação 0 ("CANCELADO"
//   no cadastro do VR) é a oferta ENCERRADA: a 20195 tinha término hoje, estava com situação 0
//   e o precovenda já tinha voltado ao normal. Existem 3.802 ofertas com situação 1 e término
//   no passado — por isso a data também é conferida, não só a situação.
// · O SERVIDOR DO VR ESTÁ EM GMT: current_date lá vira o dia seguinte às 21h de Caicó. "Hoje"
//   é calculado aqui (hora de Brasília, UTC−3, sem horário de verão desde 2019) e vai como
//   parâmetro. Nenhuma consulta daqui usa current_date nem now().
// · CÓDIGO DE BARRAS: produtoautomacao.codigobarras é NUMERIC. Vai como ::text (sem isso o
//   driver pode devolver "7.89e+12") e o ".0" do NUMERIC é tirado. Todos os códigos do produto,
//   menor embalagem primeiro (inclui os internos curtos, que o comprador também digita).
// · VENDA 30 DIAS: pdv.vendaitem × pdv.venda, com os DOIS filtros de cancelado (item e cupom;
//   só o do item infla ~0,8%), SEMPRE filtrando v.data (é o índice) e com a loja do CUPOM
//   (pdv.venda.id_loja; o item não tem loja). Soma por produto — nunca soma quantidades de
//   produtos diferentes (o mocotó 4536 é vendido por unidade, a carne por kg).
// · standard_conforming_strings=off no VR: nenhuma barra invertida nas consultas daqui.
// · DATAS: toda data sai do VR já como texto (::text). O driver pg devolve "date" como objeto
//   Date à meia-noite LOCAL, e fatiar isso já produziu "Sat Jul 04" (ver vr-sync-pedidos.cjs).
//
// JANELA E TRAVA: só roda das 06h às 21h (Brasília) e no máximo 1 vez a cada 55 min (trava em
// output/last-encartes-sync.txt, gravada quando a tentativa COMEÇA — falha também espera, para
// um VR engasgado não ser martelado a cada rodada do robô). A 1ª rodada do dia é "completa":
// recalcula a venda de 30 dias; as demais reaproveitam a do dia (output/encartes-venda30.json).
// O cache só é gravado depois de uma rodada completa QUE DEU CERTO — se a gravação falhar, a
// próxima rodada volta a ser completa. Rodada completa cuja venda veio vazia (menos de
// MINIMO_COM_VENDA produtos vendendo) é ERRO: nada é gravado e o cache não nasce vazio.
//
// NUNCA DERRUBA A RODADA DO ROBÔ: toda falha vai para o log e para encarte_sync.ultimo_erro, e o
// processo sai com código 0. (Só o modo --seco, que é teste e nunca é chamado pelo robô, sai com
// 1 quando falha.) Um vigia interno encerra em 200 s: o buildVrData mata aos 240 s, e morrer
// pela mão dele não deixaria registro nenhum.
"use strict";
const fs = require("fs"), path = require("path"), https = require("https"), crypto = require("crypto"), os = require("os");

const RAIZ = path.join(__dirname, "..");
const LOJA = 1;
const TIPOS_COMPRA = [0, 6, 185];        // compra, NFP produtor, compra produção — os mesmos do Compra × Venda
const JANELA_INI = 6, JANELA_FIM = 21;   // [06:00, 21:00) hora de Brasília
const TRAVA_MIN = 55;
const LOTE = 500;
const PAGINA = 1000;                     // o Supabase corta em 1000 por resposta
const MINIMO_PRODUTOS = 1000;            // VR "mudo" devolvendo quase nada não pode passar por rodada boa
// A venda de 30 dias "muda" também: com mais de MINIMO_PRODUTOS ativos, a loja vende milhares de
// produtos por mês. Menos que isto com venda (pdv fora do ar, tabela sendo refeita) não é medida:
// gravaria venda 0 em todas as fichas e guardaria o cache vazio do dia.
const MINIMO_COM_VENDA = 100;
const TOP_FORNECEDORES = 5;
const PRAZO_TOTAL_MS = 200000;           // vigia: o buildVrData mata aos 240 s
const PRAZO_LOTES_MS = 170000;           // depois disso não começa lote novo (o resto vai na próxima)
const CHAVE_STATUS = "produtos";
const TABELA = "encarte_produtos_vr", TABELA_STATUS = "encarte_sync";
const ARQ_TRAVA = path.join(RAIZ, "output", "last-encartes-sync.txt");
const ARQ_VENDA30 = path.join(RAIZ, "output", "encartes-venda30.json");
const SB_HOST_PADRAO = "uabhsmculsfwzcrhyhch.supabase.co"; // o mesmo dos outros robôs, se o .env não tiver SUPABASE_URL

// As colunas EXATAS de encarte_produtos_vr (sql/encartes_v1.sql). O PostgREST recusa lote com
// objetos de chaves diferentes, e coluna que o banco não tem derruba o lote: a lista é uma só e
// o teste compara com o SQL.
const COLUNAS = ["produto_id", "descricao", "eans", "m1", "m2", "m3", "setor", "grupo", "subgrupo",
  "preco_normal", "preco_atual", "em_oferta", "custo", "custo_confiavel", "estoque", "venda30_qtd",
  "venda30_valor", "ultima_compra", "ultima_compra_fornecedor", "ultima_oferta", "fornecedores",
  "impressao", "atualizado_em"];
const COLUNAS_STATUS = ["chave", "ultima_ok_em", "ultima_tentativa_em", "ultima_completa_em", "ultimo_erro", "linhas", "alteradas"];

// ============================================================================
// FUNÇÕES PURAS (o teste chama estas de verdade)
// ============================================================================

// Hora de Brasília a partir do relógio absoluto: não depende do fuso da máquina (a da loja e o Mac
// podem estar configurados diferente, e o servidor do VR está em GMT).
function brasilia(ms) {
  const d = new Date(ms - 3 * 3600e3);
  return { data: d.toISOString().slice(0, 10), hora: d.getUTCHours(), minuto: d.getUTCMinutes() };
}
function addDias(iso, n) { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function janelaAberta(ms) { const h = brasilia(ms).hora; return h >= JANELA_INI && h < JANELA_FIM; }

// A trava guarda o instante (ms) da última tentativa. Arquivo ausente, ilegível ou com instante
// no FUTURO (relógio que andou para trás) libera: trava que nunca solta é pior que uma rodada a mais.
function travaLibera(conteudo, agoraMs, minutos) {
  const ult = parseInt(String(conteudo == null ? "" : conteudo).trim(), 10);
  if (!Number.isFinite(ult)) return true;
  if (ult > agoraMs + 5 * 60e3) return true;
  return agoraMs - ult >= (minutos || TRAVA_MIN) * 60e3;
}
function decidirRodada(o) {
  if (o.seco) return { rodar: true, motivo: "modo seco (teste): ignora janela e trava" };
  if (o.forcar) return { rodar: true, motivo: "ENC_FORCAR=1: ignora janela e trava" };
  if (!janelaAberta(o.agoraMs)) { const b = brasilia(o.agoraMs); return { rodar: false, motivo: "fora da janela (" + String(b.hora).padStart(2, "0") + "h; roda das 06h às 21h)" }; }
  if (!travaLibera(o.trava, o.agoraMs)) {
    const min = Math.round((o.agoraMs - parseInt(o.trava, 10)) / 60e3);
    return { rodar: false, motivo: "última tentativa há " + min + " min (roda no máximo 1 vez a cada " + TRAVA_MIN + " min)" };
  }
  return { rodar: true, motivo: "janela aberta e trava livre" };
}

// Número do VR (NUMERIC chega como texto) ou nulo. Zero continua zero: estoque 0 é um fato.
function numOuNulo(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" && v.trim() === "") return null;
  const x = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isFinite(x) ? x : null;
}
// Só para SOMA que já foi medida (a venda de 30 dias): ausente ali quer dizer "vendeu zero".
// Sem "??" de propósito: a versão do Node da máquina da loja não é conhecida, e nenhum outro robô usa.
function ouZero(v) { const x = numOuNulo(v); return x === null ? 0 : x; }
// Custo e preço: nulo OU ≤ 0 vira NULO, nunca 0. Custo zero faria a margem dar 100%.
function positivoOuNulo(v) { const x = numOuNulo(v); return x !== null && x > 0 ? x : null; }
function custoConfiavel(m1, m2) { return !(Number(m1) === 42 && Number(m2) === 1); }

// Código de barras NUMERIC -> texto de dígitos. Tira o ".0" do NUMERIC, nunca deixa virar
// notação científica e NUNCA mexe em zero à esquerda (não tira, não completa): EAN-8 é legítimo,
// e completar até 13 quebraria justamente os produtos pequenos. O NUMERIC do VR já chega sem os
// zeros da frente — quem compara com o que o comprador digitou tira os zeros dos DOIS lados.
function normalizarEan(v) {
  if (v === null || v === undefined) return null;
  let s;
  if (typeof v === "bigint") s = v.toString();
  else if (typeof v === "number") { if (!Number.isFinite(v)) return null; s = v.toFixed(0); }
  else s = String(v).trim();
  s = s.replace(/\.0+$/, "").replace(/[^0-9]/g, "");
  return s || null;
}
// Data do driver pg: texto "YYYY-MM-DD..." ou objeto Date à meia-noite LOCAL. Monta pelos
// componentes locais, que é como o driver entregou (fatiar o Date dava "Sat Jul 04").
function dataISO(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "string") return /^[0-9]{4}-[0-9]{2}-[0-9]{2}/.test(v) ? v.slice(0, 10) : null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  const z = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate());
}
const texto = (s) => { if (s === null || s === undefined) return null; const t = String(s).trim(); return t || null; };

// Preço normal × atual. Com oferta ativa o precovenda do VR JÁ É o de oferta; o normal vem da
// oferta. Se a oferta ativa não tiver preconormal válido, o normal fica NULO — cair no
// precovenda gravaria o preço de oferta como se fosse o normal (e a oferta pareceria sem desconto).
function precos(precovenda, ofertaAtiva) {
  const atual = positivoOuNulo(precovenda);
  if (ofertaAtiva) return { preco_normal: positivoOuNulo(ofertaAtiva.preconormal), preco_atual: atual, em_oferta: true };
  return { preco_normal: atual, preco_atual: atual, em_oferta: false };
}

// Até 5 fornecedores da ficha (produtofornecedor), quem vendeu mais recentemente primeiro;
// empate (ou nunca comprado) pela data de alteração do cadastro, depois pelo código. O VR tem
// linha repetida do mesmo fornecedor (uma por estado): fica a de cadastro mais novo. No empate
// de data (172 pares medidos em 26/09, com custotabela diferente), decide a linha mais nova do
// VR (id_linha = produtofornecedor.id, a chave da tabela) e, por fim, a posição na lista — sem
// isso valia a ordem em que o banco devolveu, que muda sem aviso: o custotabela aparecia e
// sumia ao acaso e a impressão oscilava, regravando fichas sem motivo. A posição entra como
// número de propósito: não depende de o sort da versão do Node da loja ser estável.
// custotabela 0 no VR é "não informado": vai nulo.
function fornecedoresTop(lista) {
  const desc = (a, b) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? 1 : -1);
  const l = (lista || []).map((f, i) => ({ id: Number(f.id_fornecedor), nome: texto(f.nome), custotabela: positivoOuNulo(f.custotabela),
    ultima_compra: dataISO(f.ultima), alterado: dataISO(f.alterado), linha: numOuNulo(f.id_linha), ordem: i }));
  l.sort((a, b) => desc(a.ultima_compra, b.ultima_compra) || desc(a.alterado, b.alterado) || a.id - b.id ||
    desc(a.linha, b.linha) || a.ordem - b.ordem);
  const vistos = new Set(), out = [];
  for (const f of l) {
    if (vistos.has(f.id)) continue;
    vistos.add(f.id);
    out.push({ id: f.id, nome: f.nome, custotabela: f.custotabela, ultima_compra: f.ultima_compra });
    if (out.length >= TOP_FORNECEDORES) break;
  }
  return out;
}

// JSON com as chaves em ordem: a mesma ficha tem que dar a mesma impressão em qualquer rodada,
// em qualquer máquina, não importa a ordem em que os campos foram montados.
function canonico(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return "[" + v.map(canonico).join(",") + "]";
  return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonico(v[k])).join(",") + "}";
}
// A impressão cobre TODOS os campos da ficha, menos ela mesma e o atualizado_em (que muda a cada
// gravação e faria toda linha parecer nova).
function impressao(linha) {
  const c = {};
  for (const k of Object.keys(linha)) if (k !== "impressao" && k !== "atualizado_em") c[k] = linha[k];
  return crypto.createHash("sha1").update(canonico(c)).digest("hex");
}

// Uma linha de encarte_produtos_vr a partir do que o VR devolveu para UM produto.
//   p   = { id, descricao, m1, m2, m3, precovenda, custo, estoque }
//   x   = { nomes:{setor,grupo,subgrupo}, eans:[...], ofertaAtiva, ultimaOferta, venda30:[qtd,valor]|null,
//           venda30Calculada:bool, ultimaCompra:{data,fornecedor}, fornecedores:[linhas cruas] }
function montarLinha(p, x, atualizadoEm) {
  x = x || {};
  const nomes = x.nomes || {};
  const pr = precos(p.precovenda, x.ofertaAtiva || null);
  // Venda: se a venda de 30 dias foi calculada (ela cobre TODOS os produtos), quem não aparece
  // nela vendeu zero — e zero é o fato. Se NÃO foi calculada, fica nulo ("não sei").
  let q = null, v = null;
  if (x.venda30Calculada) { const s = x.venda30 || [0, 0]; q = ouZero(s[0]); v = ouZero(s[1]); }
  const uo = x.ultimaOferta;
  const eans = [];
  for (const e of x.eans || []) { const n = normalizarEan(e); if (n && eans.indexOf(n) < 0) eans.push(n); }
  const linha = {
    produto_id: Number(p.id),
    descricao: texto(p.descricao),
    eans,
    m1: numOuNulo(p.m1), m2: numOuNulo(p.m2), m3: numOuNulo(p.m3),
    setor: texto(nomes.setor), grupo: texto(nomes.grupo), subgrupo: texto(nomes.subgrupo),
    preco_normal: pr.preco_normal,
    preco_atual: pr.preco_atual,
    em_oferta: pr.em_oferta,
    custo: positivoOuNulo(p.custo),
    custo_confiavel: custoConfiavel(p.m1, p.m2),
    estoque: numOuNulo(p.estoque),
    venda30_qtd: q,
    venda30_valor: v,
    ultima_compra: x.ultimaCompra ? dataISO(x.ultimaCompra.data) : null,
    ultima_compra_fornecedor: x.ultimaCompra ? texto(x.ultimaCompra.fornecedor) : null,
    ultima_oferta: uo ? { inicio: dataISO(uo.inicio), fim: dataISO(uo.fim), preco: positivoOuNulo(uo.preco), tipo: texto(uo.tipo) } : null,
    fornecedores: fornecedoresTop(x.fornecedores),
  };
  linha.impressao = impressao(linha);
  linha.atualizado_em = atualizadoEm || new Date().toISOString();
  return linha;
}

// Junta os conjuntos que o VR devolveu (um por consulta) em uma linha por produto ativo.
//   venda30 = { produtos: { "<id>": [qtd, valor] } } ou null (não calculada)
function montarLinhas(bruto, venda30, atualizadoEm) {
  const nome = {};
  for (const m of bruto.mercadologico || []) nome[m.nivel + ":" + m.m1 + (m.nivel >= 2 ? "." + m.m2 : "") + (m.nivel >= 3 ? "." + m.m3 : "")] = m.descricao;
  const agrupar = (l) => { const o = new Map(); for (const r of l || []) { const k = Number(r.id_produto); if (!o.has(k)) o.set(k, []); o.get(k).push(r); } return o; };
  const primeiro = (l) => { const o = new Map(); for (const r of l || []) { const k = Number(r.id_produto); if (!o.has(k)) o.set(k, r); } return o; };
  const eans = agrupar(bruto.eans), forn = agrupar(bruto.fornecedores);
  const ativa = primeiro(bruto.ofertasAtivas), ultOf = primeiro(bruto.ultimasOfertas), ultCp = primeiro(bruto.ultimasCompras);
  const v30 = venda30 && venda30.produtos ? venda30.produtos : null;
  return (bruto.produtos || []).map((p) => {
    const id = Number(p.id);
    return montarLinha(p, {
      nomes: { setor: nome["1:" + p.m1], grupo: nome["2:" + p.m1 + "." + p.m2], subgrupo: nome["3:" + p.m1 + "." + p.m2 + "." + p.m3] },
      eans: (eans.get(id) || []).map((r) => r.cb),
      ofertaAtiva: ativa.get(id) || null,
      ultimaOferta: ultOf.get(id) || null,
      venda30Calculada: !!v30,
      venda30: v30 ? v30[String(id)] || null : null,
      ultimaCompra: ultCp.get(id) || null,
      fornecedores: forn.get(id) || [],
    }, atualizadoEm);
  });
}

// Só o que mudou desde a última gravação (ou que ainda não existe na nuvem).
function alteradas(linhas, mapaNuvem) { return linhas.filter((l) => mapaNuvem.get(l.produto_id) !== l.impressao); }
function emLotes(l, n) { const s = []; for (let i = 0; i < l.length; i += n) s.push(l.slice(i, i + n)); return s; }

// Venda de 30 dias do cache local: só vale se for de HOJE (Brasília) e estiver inteira.
function venda30DoCache(conteudo, hoje) {
  try {
    const c = typeof conteudo === "string" ? JSON.parse(conteudo) : conteudo;
    if (!c || c.data !== hoje || !c.produtos || typeof c.produtos !== "object") return null;
    return c;
  } catch (e) { return null; }
}
// Quantos produtos a venda de 30 dias trouxe COM venda (quantidade ou valor diferente de zero).
function produtosComVenda(venda30) {
  const p = (venda30 && venda30.produtos) || {};
  let n = 0;
  for (const k of Object.keys(p)) { const s = p[k] || []; if (ouZero(s[0]) !== 0 || ouZero(s[1]) !== 0) n++; }
  return n;
}

// ============================================================================
// O VR (SÓ LEITURA)
// ============================================================================
const SQL = {
  produtos: `
    SELECT p.id, p.descricaocompleta descricao, p.mercadologico1 m1, p.mercadologico2 m2, p.mercadologico3 m3,
           pc.precovenda::text precovenda, pc.custocomimposto::text custo, pc.estoque::text estoque
      FROM public.produtocomplemento pc
      JOIN public.produto p ON p.id = pc.id_produto
     WHERE pc.id_loja = $1 AND pc.id_situacaocadastro = 1
     ORDER BY p.id`,
  mercadologico: `
    SELECT nivel, mercadologico1 m1, mercadologico2 m2, mercadologico3 m3, trim(descricao) descricao
      FROM public.mercadologico
     WHERE nivel IN (1, 2, 3)`,
  eans: `
    SELECT pa.id_produto, pa.codigobarras::text cb
      FROM public.produtoautomacao pa
      JOIN public.produtocomplemento pc ON pc.id_produto = pa.id_produto AND pc.id_loja = $1 AND pc.id_situacaocadastro = 1
     WHERE pa.codigobarras IS NOT NULL
     ORDER BY pa.id_produto, pa.qtdembalagem, pa.codigobarras`,
  ofertasAtivas: `
    SELECT DISTINCT ON (o.id_produto) o.id_produto, o.preconormal::text preconormal, o.precooferta::text precooferta
      FROM public.oferta o
     WHERE o.id_loja = $1 AND o.id_situacaooferta = 1
       AND o.datainicio <= $2::date AND o.datatermino >= $2::date
     ORDER BY o.id_produto, o.datainicio DESC, o.id DESC`,
  ultimasOfertas: `
    SELECT DISTINCT ON (o.id_produto) o.id_produto, o.datainicio::text inicio, o.datatermino::text fim,
           o.precooferta::text preco, trim(t.descricao) tipo
      FROM public.oferta o
      LEFT JOIN public.tipooferta t ON t.id = o.id_tipooferta
     WHERE o.id_loja = $1 AND o.datainicio <= $2::date
     ORDER BY o.id_produto, o.datainicio DESC, o.id DESC`,
  ultimasCompras: `
    SELECT DISTINCT ON (i.id_produto) i.id_produto, n.dataentrada::text data,
           coalesce(nullif(trim(f.nomefantasia), ''), trim(f.razaosocial)) fornecedor
      FROM public.notaentradaitem i
      JOIN public.notaentrada n ON n.id = i.id_notaentrada
      LEFT JOIN public.fornecedor f ON f.id = n.id_fornecedor
     WHERE n.id_loja = $1 AND n.id_situacaonotaentrada = 1 AND n.id_tipoentrada = ANY($2::int[])
       AND n.dataentrada <= $3::date
     ORDER BY i.id_produto, n.dataentrada DESC, n.id DESC`,
  fornecedores: `
    WITH ult AS (
      SELECT i.id_produto, n.id_fornecedor, max(n.dataentrada) d
        FROM public.notaentradaitem i
        JOIN public.notaentrada n ON n.id = i.id_notaentrada
       WHERE n.id_loja = $1 AND n.id_situacaonotaentrada = 1 AND n.id_tipoentrada = ANY($2::int[])
         AND n.dataentrada <= $3::date
       GROUP BY 1, 2
    )
    SELECT pf.id_produto, pf.id_fornecedor, pf.id id_linha,
           coalesce(nullif(trim(f.nomefantasia), ''), trim(f.razaosocial)) nome,
           pf.custotabela::text custotabela, pf.dataalteracao::text alterado, u.d::text ultima
      FROM public.produtofornecedor pf
      JOIN public.fornecedor f ON f.id = pf.id_fornecedor
      JOIN public.produtocomplemento pc ON pc.id_produto = pf.id_produto AND pc.id_loja = $1 AND pc.id_situacaocadastro = 1
      LEFT JOIN ult u ON u.id_produto = pf.id_produto AND u.id_fornecedor = pf.id_fornecedor
     ORDER BY pf.id_produto, pf.id_fornecedor, pf.dataalteracao DESC NULLS LAST, pf.id DESC`,
  venda30: `
    SELECT v.id_produto, sum(v.quantidade)::text qtd, sum(v.valortotal)::text valor
      FROM pdv.vendaitem v
      JOIN pdv.venda cp ON cp.id = v.id_venda
     WHERE v.data BETWEEN $1::date AND $2::date
       AND v.cancelado = false AND cp.cancelado = false
       AND cp.id_loja = $3
     GROUP BY v.id_produto`,
};

function lerEnv() { try { return fs.readFileSync(path.join(RAIZ, ".env"), "utf8"); } catch (e) { return ""; } }
function config() {
  const E = lerEnv(), g = (k) => { const m = E.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim() : (process.env[k] || ""); };
  let host = SB_HOST_PADRAO;
  try { if (g("SUPABASE_URL")) host = new URL(g("SUPABASE_URL")).host || host; } catch (e) { /* fica o padrão */ }
  return { pg: { host: g("PG_HOST"), port: +g("PG_PORT"), database: g("PG_DATABASE"), user: g("PG_USER"), password: g("PG_PASSWORD") },
    sbHost: host, sbChave: g("SUPABASE_SERVICE_KEY") };
}

// Lê tudo numa transação SÓ LEITURA e desfaz no fim. comVenda30=false reaproveita a do cache.
async function lerVR(cfgPg, hoje, comVenda30, log) {
  let Client;
  try { Client = require(path.join(RAIZ, "node_modules", "pg")).Client; } catch (e) { Client = require("pg").Client; }
  const c = new Client(Object.assign({}, cfgPg, { connectionTimeoutMillis: 20000, statement_timeout: 90000, query_timeout: 120000 }));
  await c.connect();
  const tempos = {};
  const q = async (nome, sql, par) => { const t = Date.now(); const r = await c.query(sql, par); tempos[nome] = Date.now() - t; log("  " + nome + ": " + r.rows.length + " linhas, " + (tempos[nome] / 1000).toFixed(1) + " s"); return r.rows; };
  try {
    await c.query("BEGIN READ ONLY");
    const bruto = {
      produtos: await q("produtos ativos", SQL.produtos, [LOJA]),
      mercadologico: await q("mercadológico", SQL.mercadologico),
      eans: await q("códigos de barras", SQL.eans, [LOJA]),
      ofertasAtivas: await q("ofertas ativas hoje", SQL.ofertasAtivas, [LOJA, hoje]),
      ultimasOfertas: await q("última oferta", SQL.ultimasOfertas, [LOJA, hoje]),
      ultimasCompras: await q("última compra", SQL.ultimasCompras, [LOJA, TIPOS_COMPRA, hoje]),
      fornecedores: await q("fornecedores", SQL.fornecedores, [LOJA, TIPOS_COMPRA, hoje]),
    };
    let venda30 = null;
    if (comVenda30) {
      const de = addDias(hoje, -30), ate = addDias(hoje, -1);   // 30 dias fechados, até ontem
      const rows = await q("venda 30 dias (" + de + " a " + ate + ")", SQL.venda30, [de, ate, LOJA]);
      const produtos = {};
      for (const r of rows) produtos[String(r.id_produto)] = [ouZero(r.qtd), ouZero(r.valor)];
      venda30 = { data: hoje, de, ate, gerado_em: new Date().toISOString(), produtos };
    }
    return { bruto, venda30, tempos };
  } finally {
    try { await c.query("ROLLBACK"); } catch (e) { /* conexão já caiu */ }
    try { await c.end(); } catch (e) { /* idem */ }
  }
}

// ============================================================================
// A NUVEM (chave de serviço)
// ============================================================================
// Toda chamada RESOLVE (nunca rejeita): status 0 é "não chegou". Relógio de 30 s por chamada.
function pedirHttps(host, chave, metodo, caminho, corpo, cabecalhos) {
  return new Promise((resolve) => {
    const dados = corpo === undefined ? null : JSON.stringify(corpo);
    const h = Object.assign({ apikey: chave, Authorization: "Bearer " + chave }, cabecalhos || {});
    if (dados !== null) { h["Content-Type"] = "application/json"; h["Content-Length"] = Buffer.byteLength(dados); }
    const r = https.request({ host, path: caminho, method: metodo, headers: h }, (res) => {
      let t = ""; res.setEncoding("utf8"); res.on("data", (d) => (t += d));
      res.on("end", () => resolve({ status: res.statusCode, cabecalhos: res.headers, corpo: t }));
    });
    r.on("error", (e) => resolve({ status: 0, cabecalhos: {}, corpo: e.message }));
    r.setTimeout(30000, () => { try { r.destroy(); } catch (e) { /* já foi */ } resolve({ status: 0, cabecalhos: {}, corpo: "a nuvem não respondeu em 30 s" }); });
    if (dados !== null) r.write(dados);
    r.end();
  });
}
function explicarRecusa(r, tabela) {
  if (/PGRST205|42P01/.test(r.corpo) || (r.status === 404 && r.corpo.indexOf(tabela) >= 0))
    return "a tabela " + tabela + " ainda não existe no Supabase — falta rodar sql/encartes_v1.sql";
  if (/PGRST204|42703/.test(r.corpo)) return "coluna que o robô manda não existe em " + tabela + " (o SQL e o robô divergiram): " + r.corpo.slice(0, 200);
  return (r.status ? "a nuvem recusou (" + r.status + ")" : "a nuvem não respondeu") + ": " + String(r.corpo).slice(0, 300);
}

// pedir(metodo, caminho, corpo, cabecalhos) -> { status, cabecalhos, corpo } — injetável no teste.
function criarNuvem(pedir) {
  return {
    // Todas as impressões, PAGINADAS COM ORDEM (sem order= as páginas duplicam e pulam linhas) e
    // conferindo o total que o próprio banco declara (count=exact). Não bateu = erro, e nada é gravado.
    async lerImpressoes() {
      const mapa = new Map();
      let de = 0, total = null, voltas = 0;
      for (;;) {
        if (++voltas > 1000) throw new Error("leitura das impressões não terminou (paginação em laço)");
        const r = await pedir("GET", "/rest/v1/" + TABELA + "?select=produto_id,impressao&order=produto_id.asc", undefined,
          { "Range-Unit": "items", Range: de + "-" + (de + PAGINA - 1), Prefer: "count=exact" });
        if (r.status !== 200 && r.status !== 206) throw new Error("ler impressões: " + explicarRecusa(r, TABELA));
        const faixa = String((r.cabecalhos && (r.cabecalhos["content-range"] || r.cabecalhos["Content-Range"])) || "");
        const m = faixa.match(/\/([0-9]+)$/);
        if (!m) throw new Error("ler impressões: a nuvem não informou o total (Content-Range '" + faixa + "')");
        const t = +m[1];
        if (total === null) total = t;
        else if (t !== total) throw new Error("ler impressões: o total mudou durante a leitura (" + total + " → " + t + "); tenta na próxima");
        let pag;
        try { pag = JSON.parse(r.corpo || "[]"); } catch (e) { throw new Error("ler impressões: resposta ilegível"); }
        if (!Array.isArray(pag)) throw new Error("ler impressões: resposta não é lista");
        for (const x of pag) mapa.set(Number(x.produto_id), x.impressao == null ? null : String(x.impressao));
        de += pag.length;
        if (de >= total) break;
        if (!pag.length) throw new Error("ler impressões: página vazia em " + de + " de " + total);
      }
      if (mapa.size !== total) throw new Error("ler impressões: vieram " + mapa.size + " produtos distintos, o banco diz " + total + "; nada gravado");
      return mapa;
    },
    // Um lote. A nuvem devolve só os produto_id gravados, e eles têm de ser EXATAMENTE os enviados.
    async gravarLote(linhas) {
      const r = await pedir("POST", "/rest/v1/" + TABELA + "?on_conflict=produto_id&select=produto_id", linhas,
        { Prefer: "resolution=merge-duplicates,return=representation" });
      if (r.status < 200 || r.status >= 300) throw new Error("gravar lote: " + explicarRecusa(r, TABELA));
      let volta;
      try { volta = JSON.parse(r.corpo || "[]"); } catch (e) { throw new Error("gravar lote: resposta ilegível"); }
      const enviados = new Set(linhas.map((l) => l.produto_id)), voltaram = new Set((volta || []).map((x) => Number(x.produto_id)));
      const faltam = [...enviados].filter((id) => !voltaram.has(id));
      if (faltam.length || voltaram.size !== enviados.size)
        throw new Error("gravar lote: a nuvem confirmou " + voltaram.size + " de " + enviados.size + " (faltam, por exemplo, " + faltam.slice(0, 5).join(", ") + ")");
      return voltaram.size;
    },
    // O status. Só vão as colunas do objeto: PostgREST não mexe no que não vem no corpo — por isso a
    // falha manda só tentativa + erro, e linhas/alteradas/ultima_ok_em anteriores ficam como estavam.
    async gravarStatus(obj) {
      const r = await pedir("POST", "/rest/v1/" + TABELA_STATUS + "?on_conflict=chave", [obj],
        { Prefer: "resolution=merge-duplicates,return=minimal" });
      if (r.status < 200 || r.status >= 300) throw new Error("gravar status: " + explicarRecusa(r, TABELA_STATUS));
      return true;
    },
  };
}

// ============================================================================
// A RODADA
// ============================================================================
// Tudo que toca o mundo chega por "o" — o teste troca por imitações:
//   o.agoraMs, o.seco, o.forcar, o.log
//   o.lerTrava() / o.gravarTrava(ms)            (arquivo em output/)
//   o.lerCache() / o.gravarCache(venda30)        (arquivo em output/)
//   o.lerVR(hoje, comVenda30) -> {bruto, venda30, tempos}
//   o.nuvem = criarNuvem(...)                    (ausente no modo seco)
//   o.escreverSaida(obj)                         (só no modo seco)
//   o.relogio()  (ms; padrão Date.now), o.minimo (padrão MINIMO_PRODUTOS), o.prazoLotesMs
async function rodar(o) {
  const log = o.log || console.log, relogio = o.relogio || Date.now;
  const inicio = relogio(), agoraMs = o.agoraMs || inicio;
  const hoje = brasilia(agoraMs).data;
  const tentativaEm = new Date(agoraMs).toISOString();
  const dec = decidirRodada({ seco: o.seco, forcar: o.forcar, agoraMs, trava: o.seco || o.forcar ? null : (o.lerTrava ? o.lerTrava() : null) });
  if (!dec.rodar) { log("Encartes: pulando — " + dec.motivo + "."); return { ok: true, pulou: true, motivo: dec.motivo }; }
  log("Encartes: " + dec.motivo + " · hoje " + hoje + (o.seco ? " · MODO SECO (não toca na nuvem)" : ""));

  let gravadas = 0, aGravar = 0, completa = false;
  try {
    // Trava que não grava (pasta sem permissão) só custa uma rodada a mais: não impede o trabalho.
    if (!o.seco && o.gravarTrava) { try { o.gravarTrava(agoraMs); } catch (e) { log("  (não consegui gravar a trava: " + e.message + ")"); } }

    // 1) a nuvem primeiro: é barato e, se a tabela ainda não existe, nem incomoda o VR.
    let mapa = null;
    if (!o.seco) { mapa = await o.nuvem.lerImpressoes(); log("  impressões na nuvem: " + mapa.size); }

    // 2) o VR. A venda de 30 dias só é recalculada na 1ª rodada do dia (ou sem cache válido).
    const cache = o.seco ? null : venda30DoCache(o.lerCache ? o.lerCache() : null, hoje);
    completa = !cache;
    const vr = await o.lerVR(hoje, completa);
    const venda30 = completa ? vr.venda30 : cache;
    if (!venda30) throw new Error("a venda de 30 dias não veio do VR");
    const lidoEm = new Date(relogio()).toISOString();   // "Dados do VR atualizados às" = quando o VR foi lido
    const linhas = montarLinhas(vr.bruto, venda30, lidoEm);
    const minimo = o.minimo === undefined ? MINIMO_PRODUTOS : o.minimo;
    if (linhas.length < minimo) throw new Error("o VR devolveu só " + linhas.length + " produto(s) ativo(s) (esperado mais de " + minimo + "); nada gravado");
    // Venda "muda" numa rodada completa é erro, não verdade: aceitar gravaria venda 0 (não medida)
    // em todas as fichas e o cache vazio seguraria o dia inteiro. Vem ANTES dos lotes e do cache.
    if (completa && linhas.length > MINIMO_PRODUTOS) {
      const comVenda = produtosComVenda(venda30);
      if (comVenda < MINIMO_COM_VENDA)
        throw new Error("venda de 30 dias veio vazia: só " + comVenda + " produto(s) com venda para " + linhas.length +
          " ativos (esperado ao menos " + MINIMO_COM_VENDA + "); nada gravado");
    }

    const resumo = resumir(linhas);
    log("  " + linhas.length + " produtos ativos · sem custo " + resumo.sem_custo + " · custo não confiável " + resumo.nao_confiaveis +
      " · em oferta " + resumo.em_oferta + " · venda 30 dias " + (completa ? "recalculada" : "do cache de hoje"));

    if (o.seco) {
      const saida = { modo: "seco", gerado_em: new Date().toISOString(), hoje, completa, lido_em: lidoEm,
        duracao_ms: relogio() - inicio, tempos: vr.tempos || {}, venda30: { de: venda30.de, ate: venda30.ate }, resumo, linhas };
      if (o.escreverSaida) o.escreverSaida(saida);
      return { ok: true, seco: true, linhas: linhas.length, completa, resumo, saida };
    }

    // 3) só o que mudou, em lotes de 500, cada lote conferido.
    const mudou = alteradas(linhas, mapa);
    aGravar = mudou.length;
    log("  mudaram " + mudou.length + " de " + linhas.length);
    const prazo = o.prazoLotesMs === undefined ? PRAZO_LOTES_MS : o.prazoLotesMs;
    for (const lote of emLotes(mudou, LOTE)) {
      if (relogio() - inicio > prazo)
        throw new Error("tempo esgotado: gravou " + gravadas + " de " + aGravar + " alteradas; o resto vai na próxima rodada");
      gravadas += await o.nuvem.gravarLote(lote);
    }

    // 4) deu tudo certo: o status bom e, SÓ DEPOIS dele aceito, o cache do dia. Nessa ordem para
    //    ultima_completa_em nunca ficar para trás do cache: se o status falhar, a próxima volta a ser completa.
    const st = { chave: CHAVE_STATUS, ultima_tentativa_em: tentativaEm, ultima_ok_em: lidoEm, ultimo_erro: null, linhas: linhas.length, alteradas: gravadas };
    if (completa) st.ultima_completa_em = lidoEm;
    await o.nuvem.gravarStatus(st);
    if (completa && o.gravarCache) { try { o.gravarCache(venda30); } catch (e) { log("  (não consegui guardar o cache da venda: " + e.message + ")"); } }
    log("Encartes: OK — " + gravadas + " ficha(s) gravada(s) de " + linhas.length + (completa ? " (rodada completa)" : "") + ".");
    return { ok: true, linhas: linhas.length, alteradas: gravadas, completa, resumo };
  } catch (e) {
    const msg = String((e && e.message) || e).slice(0, 900) + (gravadas ? " [gravou " + gravadas + " de " + aGravar + " antes de parar]" : "");
    log("Encartes: falhou, painel segue normal — " + msg);
    // Falha nunca zera nem apaga: só tentativa + erro. O que já está na nuvem continua valendo.
    if (!o.seco && o.nuvem) {
      try { await o.nuvem.gravarStatus({ chave: CHAVE_STATUS, ultima_tentativa_em: tentativaEm, ultimo_erro: msg }); }
      catch (e2) { log("  (e nem o status foi gravado: " + e2.message + ")"); }
    }
    return { ok: false, erro: msg, alteradas: gravadas, completa };
  }
}

function resumir(linhas) {
  const r = { linhas: linhas.length, sem_custo: 0, nao_confiaveis: 0, em_oferta: 0, sem_preco: 0, com_venda30: 0, sem_ean: 0, sem_fornecedor: 0, sem_ultima_compra: 0 };
  for (const l of linhas) {
    if (l.custo === null) r.sem_custo++;
    if (!l.custo_confiavel) r.nao_confiaveis++;
    if (l.em_oferta) r.em_oferta++;
    if (l.preco_atual === null) r.sem_preco++;
    if (l.venda30_qtd) r.com_venda30++;
    if (!l.eans.length) r.sem_ean++;
    if (!l.fornecedores.length) r.sem_fornecedor++;
    if (!l.ultima_compra) r.sem_ultima_compra++;
  }
  return r;
}

// ============================================================================
// CHAMADA PELA LINHA DE COMANDO
// ============================================================================
async function principal(argv) {
  const seco = argv.indexOf("--seco") >= 0;
  const argSaida = argv.find((a) => a.indexOf("--saida=") === 0);
  const saida = argSaida ? path.resolve(argSaida.slice(8)) : (process.env.ENC_SAIDA ? path.resolve(process.env.ENC_SAIDA) : path.join(os.tmpdir(), "encartes-seco.json"));
  const cfg = config();
  if (!seco && !cfg.sbChave) { console.log("Encartes: sem SUPABASE_SERVICE_KEY no .env — pulando."); return 0; }
  const nuvem = seco ? null : criarNuvem((m, c, b, h) => pedirHttps(cfg.sbHost, cfg.sbChave, m, c, b, h));
  const tentativaEm = new Date().toISOString();

  // O VIGIA: passou do prazo, registra e sai por conta própria antes de o buildVrData matar.
  const vigia = setTimeout(async () => {
    const msg = "passou de " + PRAZO_TOTAL_MS / 1000 + " s e foi encerrado pelo vigia; tenta na próxima rodada";
    console.log("Encartes: " + msg);
    if (nuvem) { try { await Promise.race([nuvem.gravarStatus({ chave: CHAVE_STATUS, ultima_tentativa_em: tentativaEm, ultimo_erro: msg }), new Promise((r) => setTimeout(r, 8000))]); } catch (e) { /* sai assim mesmo */ } }
    process.exit(seco ? 1 : 0);
  }, PRAZO_TOTAL_MS);
  vigia.unref();

  const r = await rodar({
    seco, forcar: process.env.ENC_FORCAR === "1", nuvem,
    lerTrava: () => { try { return fs.readFileSync(ARQ_TRAVA, "utf8"); } catch (e) { return null; } },
    gravarTrava: (ms) => { fs.mkdirSync(path.dirname(ARQ_TRAVA), { recursive: true }); fs.writeFileSync(ARQ_TRAVA, String(ms)); },
    lerCache: () => { try { return fs.readFileSync(ARQ_VENDA30, "utf8"); } catch (e) { return null; } },
    gravarCache: (v) => { fs.mkdirSync(path.dirname(ARQ_VENDA30), { recursive: true }); fs.writeFileSync(ARQ_VENDA30, JSON.stringify(v)); },
    lerVR: (hoje, comVenda30) => lerVR(cfg.pg, hoje, comVenda30, (s) => console.log(s)),
    escreverSaida: (obj) => {
      fs.mkdirSync(path.dirname(saida), { recursive: true });
      fs.writeFileSync(saida, JSON.stringify(obj));
      console.log("Encartes (seco): resultado em " + saida + " (" + (fs.statSync(saida).size / 1048576).toFixed(1) + " MB)");
    },
  });
  clearTimeout(vigia);
  return !r.ok && seco ? 1 : 0;
}

module.exports = {
  // puras
  brasilia, addDias, janelaAberta, travaLibera, decidirRodada, numOuNulo, positivoOuNulo, custoConfiavel,
  normalizarEan, dataISO, precos, fornecedoresTop, canonico, impressao, montarLinha, montarLinhas, alteradas,
  emLotes, venda30DoCache, produtosComVenda, resumir,
  // rodada e nuvem (com imitações no teste)
  rodar, criarNuvem, principal,
  // constantes que o teste confere
  SQL, COLUNAS, COLUNAS_STATUS, LOTE, PAGINA, TRAVA_MIN, JANELA_INI, JANELA_FIM, CHAVE_STATUS, TABELA, TABELA_STATUS,
  ARQ_TRAVA, ARQ_VENDA30, PRAZO_TOTAL_MS, MINIMO_PRODUTOS, MINIMO_COM_VENDA,
};

if (require.main === module) {
  const seco = process.argv.indexOf("--seco") >= 0;
  principal(process.argv.slice(2))
    .then((cod) => process.exit(cod))
    .catch((e) => { console.log("Encartes: falhou, painel segue normal — " + (e && e.message)); process.exit(seco ? 1 : 0); });
}
