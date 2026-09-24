// COMPRA × VENDA — extração dos dados do VR (SÓ LEITURA).
//
//   node scripts/compras-x-venda/extrair-vr.cjs   -> grava .previa/cxv-dados.json (prévia, no Mac)
//   require(...).extrair()                        -> o robô (scripts/vr-sync-compras.cjs) manda pra nuvem
//
// Só LÊ o VR. Quem grava na nuvem (compras_retrato) é o vr-sync-compras.cjs.
//
// TUDO AQUI FOI MEDIDO NO VR EM 23/09/2026 — ver memória project_compra_x_venda:
//
// · VENDA: pdv.vendaitem com os DOIS filtros de cancelado (item E cupom). Só o do item
//   infla 0,8%. Valor = valortotal (bate com o total dos cupons a 0,08%).
// · CUSTO DA VENDA: o VR guarda o custo médio NO MOMENTO da venda, nas duas bases:
//   customediosemimposto (a margem que a Análise mostra) e customediocomimposto (a
//   mesma base da nota de entrada). As duas vêm, e a tela decide qual usar.
// · COMPRA (recebido): notaentrada tipos 0 (compra), 6 (NFP produtor), 185 (compra
//   produção), FINALIZADA (situação 1), pela dataentrada — que em 93% das notas é o
//   dia da finalização. Valor = notaentradaitem.valortotalfinal (≈ cabeçalho da nota).
// · NÃO FINALIZADA: os mesmos tipos com situação 0. Nunca entram no recebido.
// · BONIFICAÇÃO: tipo 3. Guardada à parte (servirá ao estoque), não é compra.
// · DEVOLUÇÃO: notasaida tipos 2 e 41, sem NF-e cancelada (situacaonfe 3). Abate.
//   ATENÇÃO: a NFP produtor (entrada 6) também gera uma SAÍDA tipo 8 — é a nota que a
//   loja emite para o produtor, NÃO é devolução. Não entra.
// · RECLASSIFICAÇÃO: saída 38 / entrada 39. Transforma um produto em outro (fruta do
//   Hortifrúti vira suco da Padaria; caixa de bombom vira unidade). Na loja o total é
//   zero; entre setores, o valor MUDA de dono. Tratado como transferência.
// · SETOR: produto.mercadologico1 (nível 1), trocado pelo setor GERENCIAL quando o
//   produto está na classificação gerencial (mapa-inicial.json; depois, a tabela).
//
// PEDIDOS (comprometido) — regra medida, não chutada:
// · só LOJA 1, pedido FINALIZADO (2), item tipo COMPRA (0; 1 é bonificação), e fora
//   das marcas de cancelamento do VR (tipoatendido 1 e 4 — a loja nunca usou em 2026,
//   mas se usar, respeita).
// · saldo do item = (quantidade − quantidadeatendida) × valor unitário do pedido.
//   quantidadeatendida bate com o vínculo nota×pedido em 99,97% dos itens.
// · classe do saldo:
//     SEM NENHUMA NOTA ligada ao pedido:
//       entrega depois do fim da semana atual ........ "futuro" (conta na semana dele)
//       entrega até 14 dias atrás ou nesta semana ..... "comprometido"
//       entrega há mais de 14 dias .................... "antigo_sem_nota" (revisar)
//     (98,5% das primeiras notas chegam até 14 dias depois da data de entrega)
//     COM NOTA ligada (o item não veio, ou veio em parte):
//       "sobra_parcial" (revisar). Medido: dos itens que NÃO vieram na primeira nota,
//       só 19% chegaram depois (e 99,8% desses em até 14 dias); 81% nunca chegaram.
//       Guardamos a data da última nota para a tela poder separar a sobra recente.
const fs = require("fs"), path = require("path");
// A pasta-mãe tem node_modules e .env tanto no Mac quanto na loja (C:\vr-robo\scripts\compras-x-venda).
const RAIZ = path.join(__dirname, "..", "..");
const { Client } = require(path.join(RAIZ, "node_modules", "pg"));
function lerEnv() { try { return fs.readFileSync(path.join(RAIZ, ".env"), "utf8"); } catch (e) { return ""; } }
const ENV = lerEnv(), g = (k) => { const m = ENV.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim() : (process.env[k] || ""); };

const SEMANAS = 13;             // 12 fechadas + a atual
const DIAS_TOLERANCIA = 14;     // atraso aceito para pedido sem nota
const SAIDA = path.join(RAIZ, ".previa", "cxv-dados.json");

const TIPO_COMPRA = [0, 6, 185], TIPO_BONIF = [3], SAI_DEVOL = [2, 41], SAI_RECL = 38, ENT_RECL = 39;

function d10(d) { if (d instanceof Date) { return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); } return String(d).slice(0, 10); }
function addDias(s, n) { const d = new Date(s + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function segunda(s) { const d = new Date(s + "T12:00:00Z"); const w = (d.getUTCDay() + 6) % 7; return addDias(s, -w); }
const num = (v) => (v === null || v === undefined ? 0 : Math.round(Number(v) * 100) / 100);
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();

async function extrair(opc) {
  opc = opc || {};
  const HOJE = opc.hoje || new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10); // relógio de Caicó
  const c = new Client({ host: g("PG_HOST"), port: +g("PG_PORT"), database: g("PG_DATABASE"),
    user: g("PG_USER"), password: g("PG_PASSWORD"), statement_timeout: 240000, connectionTimeoutMillis: 20000 });
  await c.connect();
  await c.query("SET default_transaction_read_only=on");
  const q = async (rot, sql, par) => { const t = Date.now(); const r = await c.query(sql, par); console.log(`  ${rot}: ${r.rows.length} linhas, ${((Date.now() - t) / 1000).toFixed(1)}s`); return r.rows; };

  const semAtual = segunda(HOJE);
  const ini = addDias(semAtual, -7 * (SEMANAS - 1));
  const iniVenda = addDias(ini, -7);           // a 1ª semana precisa da venda da anterior
  const fimSemAtual = addDias(semAtual, 6);
  console.log(`Compra × Venda — hoje ${HOJE}; semanas ${ini} a ${fimSemAtual} (venda desde ${iniVenda})`);

  // ---- setores do VR e a classificação gerencial ----
  const setoresVR = await q("setores", "SELECT mercadologico1 m, descricao FROM mercadologico WHERE nivel=1 ORDER BY 1");
  const nomeSetor = {}; setoresVR.forEach((r) => (nomeSetor[r.m] = (r.descricao || "").trim()));
  const acharSetor = (chave) => { const k = norm(chave); const s = setoresVR.find((r) => norm(r.descricao).replace(/[^A-Z]/g, "").includes(k.replace(/[^A-Z]/g, "").replace("HORTIFRUTI", "HORTFRUTI"))); if (!s) throw new Error("Setor gerencial não achado no VR: " + chave); return s.m; };
  const mapaArq = JSON.parse(fs.readFileSync(path.join(__dirname, "mapa-inicial.json"), "utf8")).itens;
  const idsMapa = mapaArq.map((x) => x.id_produto);
  const prodMapa = await q("produtos do mapa", "SELECT id, descricaocompleta, mercadologico1 m FROM produto WHERE id = ANY($1)", [idsMapa]);
  const mapa = {}, mapaOut = [];
  mapaArq.forEach((x) => {
    const p = prodMapa.find((r) => r.id === x.id_produto);
    if (!p) { console.log("  ! produto do mapa não existe no VR:", x.id_produto, x.descricao); return; }
    if (norm(p.descricaocompleta).trim() !== norm(x.descricao).trim()) console.log("  ! nome mudou no VR:", x.id_produto, x.descricao, "→", p.descricaocompleta);
    const ger = acharSetor(x.setor_gerencial);
    mapa[p.id] = ger;
    mapaOut.push({ id: p.id, desc: p.descricaocompleta.trim(), vr: p.m, ger: ger, motivo: x.motivo, confirmar: x.confirmar || null });
  });
  const SETOR = (idProd, mVR) => (mapa[idProd] !== undefined ? mapa[idProd] : mVR);
  // Consultas agregam por (semana, setor VR, produto-se-mapeado): só os produtos do mapa
  // descem ao nível do produto, o resto já chega somado.
  const PM = "CASE WHEN p.id = ANY($3) THEN p.id END";

  // ---- VENDA por semana ----
  const venda = await q("venda", `
    SELECT date_trunc('week', v.data)::date sem, p.mercadologico1 m, ${PM} pid,
           SUM(v.valortotal) venda,
           SUM(COALESCE(v.customediosemimposto,0)*v.quantidade) cmv_sem,
           SUM(COALESCE(v.customediocomimposto,0)*v.quantidade) cmv_com,
           COUNT(*) FILTER (WHERE COALESCE(v.customediosemimposto,0)=0) sem_custo,
           SUM(v.valortotal) FILTER (WHERE COALESCE(v.customediosemimposto,0)=0) venda_sem_custo
      FROM pdv.vendaitem v JOIN pdv.venda cp ON cp.id=v.id_venda JOIN produto p ON p.id=v.id_produto
     WHERE v.data BETWEEN $1 AND $2 AND v.cancelado=false AND cp.cancelado=false
     GROUP BY 1,2,3`, [iniVenda, fimSemAtual, idsMapa]);

  // ---- ENTRADAS (compra finalizada, não finalizada, bonificação) ----
  const entradas = await q("entradas", `
    SELECT date_trunc('week', n.dataentrada)::date sem, p.mercadologico1 m, ${PM} pid,
           SUM(i.valortotalfinal) FILTER (WHERE n.id_tipoentrada = ANY($4) AND n.id_situacaonotaentrada=1) recebido,
           SUM(i.valortotalfinal) FILTER (WHERE n.id_tipoentrada = ANY($4) AND n.id_situacaonotaentrada=0) nao_fin,
           SUM(i.valortotalfinal) FILTER (WHERE n.id_tipoentrada = ANY($5) AND n.id_situacaonotaentrada=1) bonif,
           SUM(i.valortotalfinal) FILTER (WHERE n.id_tipoentrada = ${ENT_RECL} AND n.id_situacaonotaentrada=1) x
      FROM notaentrada n JOIN notaentradaitem i ON i.id_notaentrada=n.id JOIN produto p ON p.id=i.id_produto
     WHERE n.id_loja=1 AND n.dataentrada BETWEEN $1 AND $2
     GROUP BY 1,2,3`, [ini, fimSemAtual, idsMapa, TIPO_COMPRA, TIPO_BONIF]);

  // ---- SAÍDAS (devolução ao fornecedor e reclassificação) ----
  const saidas = await q("saídas", `
    SELECT date_trunc('week', ns.datasaida)::date sem, p.mercadologico1 m, ${PM} pid,
           SUM(i.valortotal) FILTER (WHERE ns.id_tiposaida = ANY($4)) devol,
           SUM(i.valortotal) FILTER (WHERE ns.id_tiposaida = ${SAI_RECL}) recl_sai,
           SUM(i.valortotal) FILTER (WHERE ns.id_tiposaida = ${ENT_RECL}) recl_ent
      FROM notasaida ns JOIN notasaidaitem i ON i.id_notasaida=ns.id JOIN produto p ON p.id=i.id_produto
     WHERE ns.id_loja=1 AND ns.datasaida BETWEEN $1 AND $2 AND ns.id_situacaonotasaida=1
       AND COALESCE(ns.id_situacaonfe,1) <> 3
       AND ns.id_tiposaida IN (2,41,${SAI_RECL},${ENT_RECL})
     GROUP BY 1,2,3`, [ini, fimSemAtual, idsMapa, SAI_DEVOL]);

  // ---- monta semana × setor gerencial ----
  const S = {}; // S[sem][setor] = {...}
  const Z = () => ({ venda: 0, cmv_sem: 0, cmv_com: 0, sem_custo: 0, venda_sem_custo: 0, recebido: 0, nao_fin: 0, bonif: 0, devol: 0, recl_ent: 0, recl_sai: 0 });
  const cel = (sem, m) => { sem = d10(sem); S[sem] = S[sem] || {}; return (S[sem][m] = S[sem][m] || Z()); };
  venda.forEach((r) => { const o = cel(r.sem, SETOR(r.pid, r.m)); o.venda += num(r.venda); o.cmv_sem += num(r.cmv_sem); o.cmv_com += num(r.cmv_com); o.sem_custo += +r.sem_custo; o.venda_sem_custo += num(r.venda_sem_custo); });
  entradas.forEach((r) => { const o = cel(r.sem, SETOR(r.pid, r.m)); o.recebido += num(r.recebido); o.nao_fin += num(r.nao_fin); o.bonif += num(r.bonif); });
  saidas.forEach((r) => { const o = cel(r.sem, SETOR(r.pid, r.m)); o.devol += num(r.devol); o.recl_sai += num(r.recl_sai); o.recl_ent += num(r.recl_ent); });
  const semanas = Object.keys(S).sort().map((sem) => ({ ini: sem, fim: addDias(sem, 6), setores: S[sem] }));
  for (const s of semanas) for (const k in s.setores) for (const f in s.setores[k]) if (typeof s.setores[k][f] === "number" && f !== "sem_custo") s.setores[k][f] = Math.round(s.setores[k][f] * 100) / 100;

  // ---- NOTAS NÃO FINALIZADAS (todas, de qualquer data: nota parada também é problema) ----
  const nf = await q("notas não finalizadas", `
    SELECT n.id, n.numeronota, n.dataentrada, n.datahoralancamento, f.razaosocial forn, p.mercadologico1 m, ${PM.replace("$3", "$1")} pid,
           SUM(i.valortotalfinal) v
      FROM notaentrada n JOIN notaentradaitem i ON i.id_notaentrada=n.id JOIN produto p ON p.id=i.id_produto
      LEFT JOIN fornecedor f ON f.id=n.id_fornecedor
     WHERE n.id_loja=1 AND n.id_situacaonotaentrada=0 AND n.id_tipoentrada = ANY($2)
     GROUP BY 1,2,3,4,5,6,7`, [idsMapa, TIPO_COMPRA]);
  const nfMap = {};
  nf.forEach((r) => {
    const o = (nfMap[r.id] = nfMap[r.id] || { id: r.id, numero: r.numeronota, forn: (r.forn || "").trim(), entrada: d10(r.dataentrada), lancada: r.datahoralancamento ? d10(r.datahoralancamento) : null, valor: 0, setores: {} });
    const g = SETOR(r.pid, r.m); o.setores[g] = num((o.setores[g] || 0) + num(r.v)); o.valor = num(o.valor + num(r.v));
  });
  const naoFinalizadas = Object.values(nfMap).sort((a, b) => (a.entrada < b.entrada ? -1 : 1));

  // ---- PEDIDOS com saldo ----
  const ped = await q("pedidos com saldo", `
    WITH notas AS (SELECT nep.id_pedido, MAX(n.dataentrada) ult, COUNT(DISTINCT n.id) qn
                     FROM notaentradapedido nep JOIN notaentrada n ON n.id=nep.id_notaentrada GROUP BY 1)
    SELECT pe.id, pe.datacompra, pe.dataentrega, f.razaosocial forn, nt.ult, COALESCE(nt.qn,0) qn,
           p.mercadologico1 m, ${PM.replace("$3", "$1")} pid,
           COUNT(*) itens,
           SUM(pi.valortotal * (pi.quantidade - pi.quantidadeatendida) / NULLIF(pi.quantidade,0)) saldo,
           SUM(pi.valortotal) valor_pedido
      FROM pedido pe JOIN pedidoitem pi ON pi.id_pedido=pe.id JOIN produto p ON p.id=pi.id_produto
      LEFT JOIN fornecedor f ON f.id=pe.id_fornecedor LEFT JOIN notas nt ON nt.id_pedido=pe.id
     WHERE pe.id_loja=1 AND pe.id_situacaopedido=2 AND pi.id_tipopedido=0
       AND COALESCE(pe.id_tipoatendidopedido,0) NOT IN (1,4) AND COALESCE(pi.id_tipoatendidopedido,0) NOT IN (1,4)
       AND pi.quantidade > pi.quantidadeatendida
     GROUP BY 1,2,3,4,5,6,7,8`, [idsMapa]);
  const limite = addDias(HOJE, -DIAS_TOLERANCIA);
  const pMap = {};
  ped.forEach((r) => {
    const entrega = d10(r.dataentrega);
    const classe = r.qn > 0 ? "sobra_parcial" : entrega > fimSemAtual ? "futuro" : entrega >= limite ? "comprometido" : "antigo_sem_nota";
    const o = (pMap[r.id] = pMap[r.id] || { id: r.id, forn: (r.forn || "").trim(), compra: d10(r.datacompra), entrega, ultNota: r.ult ? d10(r.ult) : null, notas: +r.qn, classe, itens: 0, saldo: 0, setores: {} });
    const g = SETOR(r.pid, r.m); o.setores[g] = num((o.setores[g] || 0) + num(r.saldo)); o.saldo = num(o.saldo + num(r.saldo)); o.itens += +r.itens;
  });
  const pedidos = Object.values(pMap);
  const resumoPed = {};
  pedidos.forEach((p) => { const r = (resumoPed[p.classe] = resumoPed[p.classe] || { pedidos: 0, saldo: 0 }); r.pedidos++; r.saldo = num(r.saldo + p.saldo); });
  console.log("  pedidos por classe:", JSON.stringify(resumoPed));
  // A lista que viaja: SÓ o que compromete ou é de semana futura (a tela lista esses).
  // Pendência antiga e sobra parcial viajam só como total por setor (pendenciasSetor):
  // as listas delas pesavam 170 KB e a tela nem desenha.
  const pedidosLista = pedidos.filter((p) => p.classe === "comprometido" || p.classe === "futuro");
  // Total das pendências por setor (antigo sem nota / sobra de entrega parcial / sobra recente).
  const pendSetor = {};
  pedidos.forEach((p) => { if (p.classe === "comprometido" || p.classe === "futuro") return;
    for (const g in p.setores) { const o = (pendSetor[g] = pendSetor[g] || { antigo_sem_nota: 0, sobra_parcial: 0, sobra_recente: 0, n_antigo: 0, n_sobra: 0 });
      o[p.classe] = num(o[p.classe] + p.setores[g]); if (p.classe === "antigo_sem_nota") o.n_antigo++; else o.n_sobra++;
      if (p.classe === "sobra_parcial" && p.ultNota && p.ultNota >= limite) o.sobra_recente = num(o.sobra_recente + p.setores[g]); } });

  // ---- RITMO: em que dia da semana a loja recebe (fração acumulada), 12 semanas fechadas ----
  const rit = await q("ritmo de compra", `
    SELECT EXTRACT(isodow FROM dataentrada)::int d, SUM(valortotal) v FROM notaentrada
     WHERE id_loja=1 AND id_tipoentrada = ANY($3) AND id_situacaonotaentrada=1 AND dataentrada BETWEEN $1 AND $2 GROUP BY 1`,
    [ini, addDias(semAtual, -1), TIPO_COMPRA]);
  const tot = rit.reduce((s, r) => s + Number(r.v), 0); let ac = 0; const ritmo = [];
  for (let d = 1; d <= 7; d++) { const r = rit.find((x) => x.d === d); ac += r ? Number(r.v) : 0; ritmo.push(Math.round((ac / tot) * 1000) / 1000); }

  await c.end();
  const setores = {}; Object.keys(nomeSetor).forEach((m) => (setores[m] = nomeSetor[m]));
  return { gerado: new Date().toISOString(), hoje: HOJE, semanaAtual: semAtual, toleranciaDias: DIAS_TOLERANCIA,
    setores, mapa: mapaOut, semanas, naoFinalizadas, pedidos: pedidosLista, pendenciasSetor: pendSetor, resumoPedidos: resumoPed, ritmo };
}
module.exports = { extrair };

// Rodado direto (no Mac, para a prévia): grava o arquivo local.
if (require.main === module) {
  extrair({ hoje: process.env.CXV_HOJE }).then((out) => {
    fs.mkdirSync(path.dirname(SAIDA), { recursive: true });
    fs.writeFileSync(SAIDA, JSON.stringify(out));
    console.log(`OK -> ${SAIDA} (${(fs.statSync(SAIDA).size / 1024).toFixed(0)} KB) · ritmo ${out.ritmo.join(" ")}`);
  }).catch((e) => { console.error("ERRO:", e.message); process.exit(1); });
}
