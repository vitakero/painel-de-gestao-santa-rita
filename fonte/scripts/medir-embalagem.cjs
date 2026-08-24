// MEDE se o fator de embalagem do dicionário conserta a comparação de preço.
// Só leitura. Cruza: item da nota -> dicionário (cnpj+codigo) -> item do pedido (produto_vr).
require("dotenv").config({ path: require("path").join(process.env.HOME, "vr-looker-integration", ".env") });
const U = process.env.SUPABASE_URL, K = process.env.SUPABASE_SERVICE_KEY;
const H = { apikey: K, Authorization: "Bearer " + K };
const pega = async (q) => { const r = await fetch(U + "/rest/v1/" + q, { headers: H }); return r.ok ? r.json() : []; };
const so = (s) => String(s == null ? "" : s).replace(/\D/g, "").replace(/^0+/, "");

(async () => {
  // dicionário inteiro, em memória
  const dic = new Map();
  for (let p = 0; p < 80; p++) {
    const j = await pega("receb_codigos_fornecedor?select=fornecedor_cnpj,codigo_fornecedor,produto_vr,qtd_embalagem&limit=1000&offset=" + p * 1000);
    if (!j.length) break;
    j.forEach(x => dic.set(so(x.fornecedor_cnpj) + "|" + so(x.codigo_fornecedor), x));
  }
  // preço do pedido por produto_vr (o mais recente basta)
  const preco = new Map();
  for (let p = 0; p < 80; p++) {
    const j = await pega("receb_pedido_itens?select=produto_vr,valor_unit&limit=1000&offset=" + p * 1000);
    if (!j.length) break;
    j.forEach(x => { if (x.produto_vr != null && x.valor_unit != null) preco.set(String(x.produto_vr), +x.valor_unit); });
  }
  console.log("dicionario: " + dic.size + " codigos  |  precos de pedido: " + preco.size + " produtos\n");

  let casou = 0, batiaAntes = 0, batePosDic = 0, piorou = 0, semDic = 0, semPreco = 0, fator1 = 0;
  const suspeitos = [];
  for (let p = 0; p < 40; p++) {
    const j = await pega("receb_notas_vr?select=emitente_cnpj,itens&limit=500&offset=" + p * 500);
    if (!j.length) break;
    for (const n of j) for (const it of (n.itens || [])) {
      const d = dic.get(so(n.emitente_cnpj) + "|" + so(it.codigo));
      if (!d) { semDic++; continue; }
      const pp = preco.get(String(d.produto_vr));
      if (pp == null || !(pp > 0)) { semPreco++; continue; }
      const vn = +it.valor_unit; if (!(vn > 0)) continue;
      casou++;
      // REGRA: quem manda é a UNIDADE DA NOTA. Se a nota diz que veio solto (UN, UN1,
      // UND...), o fator é 1 mesmo que o dicionário guarde o tamanho da caixa — o
      // dicionário diz quantos CABEM na caixa, não que esta venda foi em caixa.
      // Sem isso, 198 itens que batiam passavam a divergir.
      const u = String(it.unidade || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      // peso e volume NUNCA se converte: o preço já é por quilo/litro, e dividir por
      // "17" numa caixa de 17kg transformaria R$ 9,49/kg em R$ 0,56 do nada.
      const porPeso = /^(KG|K|G|GR|GRAMA|L|LT|LTS|ML|MT|M|M2|M3|TN|TON)$/.test(u);
      const solto = porPeso || /^(UN|UND|UNI|UNID|UNIDADE|PC|PECA)0*1?$/.test(u);
      const noNome = (u.match(/^[A-Z]+0*(\d+)$/) || [])[1];
      const q = solto ? 1 : (+d.qtd_embalagem || +noNome || 1);
      if (q === 1) fator1++;
      const perto = (a, b) => Math.abs(a - b) <= Math.max(0.005, b * 0.005);
      const antes = perto(vn, pp);
      // TRAVA: se o preço cru JÁ bate, não converte. A conversão só entra pra resolver
      // divergência, nunca pra criar uma. Assim a mudança só pode melhorar — sobraram
      // 4 casos em 17.924 onde a nota dizia CX/PCT mas vendeu solto, e esta trava
      // resolve todos eles sem precisar adivinhar.
      const depois = antes ? true : perto(vn / q, pp);
      if (antes) batiaAntes++;
      if (depois) batePosDic++;
      if (antes && !depois) { piorou++; if (suspeitos.length < 6) suspeitos.push({ d: it.descricao, un: it.unidade, vn, pp, q }); }
    }
  }
  const pct = (x) => (casou ? (x / casou * 100).toFixed(1) + "%" : "-");
  console.log("itens de nota que casaram com pedido: " + casou);
  console.log("  ja batiam SEM conversao ........ " + String(batiaAntes).padStart(6) + "   " + pct(batiaAntes));
  console.log("  batem USANDO o qtd_embalagem ... " + String(batePosDic).padStart(6) + "   " + pct(batePosDic));
  console.log("  a conversao ESTRAGOU ........... " + String(piorou).padStart(6) + "   " + pct(piorou));
  console.log("  (dos que casaram, " + pct(fator1) + " tinham fator 1 - nada a converter)");
  console.log("\n  sem dicionario: " + semDic + "  |  sem preco de pedido: " + semPreco);
  if (suspeitos.length) { console.log("\n  exemplos onde converter piorou:"); suspeitos.forEach(s => console.log("   " + String(s.d).slice(0, 40).padEnd(42) + " un=" + String(s.un).padEnd(6) + " nota=" + s.vn + " pedido=" + s.pp + " fator=" + s.q)); }
})();
