// ============================================================================
// Robo: leva para a nuvem os DOIS numeros do FLV, das duas telas que o Victor usa.
//
//   FATURAMENTO ... Estatisticas, Exibicao=VENDA, mercadologico 043›001 FLV.
//                   -> flv_vr_faturamento (uma linha por mes)
//   DESPERDICIO ... o "Total Diferenca" do balanco da primeira segunda-feira.
//                   -> flv_vr_balancos (uma linha por contagem)
//
// So LE o VR; ESCREVE so na nuvem. Nenhuma conta de premio acontece aqui.
//
// POR QUE ESTE SCRIPT FAZ TAMBEM A INVESTIGACAO:
// o vr-medir-flv.cjs rodou na loja e nao deixou rastro nenhum — a janela do robo
// fechou e o erro foi embora junto. Aqui cada etapa e independente: se uma cai, as
// outras seguem, e no fim SEMPRE sai um relatorio para a nuvem, inclusive quando
// tudo deu errado. Diagnostico que some na hora do erro nao e diagnostico.
//
//   node scripts/vr-sync-flv.cjs
// ============================================================================
const fs = require("fs"), path = require("path"), https = require("https");
const { Client } = require("pg");

function readEnv(){ for(const p of [path.join(__dirname,"..",".env"),path.join(__dirname,".env"),".env","../.env"]){ try{ return fs.readFileSync(p,"utf8"); }catch(e){} } return ""; }
const env = readEnv();
const g = (k)=>{ const m = env.match(new RegExp("^"+k+"=(.*)$","m")); return m ? m[1].trim() : ""; };

const SB_HOST = (g("SUPABASE_URL")||"").replace(/^https?:\/\//,"").replace(/\/+$/,"") || "uabhsmculsfwzcrhyhch.supabase.co";
const SB_KEY  = g("SUPABASE_SERVICE_KEY");

const MERC1 = 43, MERC2 = 1;   // FLV. O grupo 43 tem tambem 005 OVOS, que fica de fora.
const LOJA  = 1;               // a loja 2 existe e e dele, mas fica de fora por decisao dele
const DESDE_CHEIO = "2024-01-01";
const MESES_QUENTES = 14;

// O que a tela dele mostrou, para o proprio script conferir e dizer se bateu.
const SUA_TELA = { "2026-01":578545.51,"2026-02":513069.02,"2026-03":599417.99,
                   "2026-04":577431.46,"2026-05":621008.45,"2026-06":603274.89,
                   "2026-07":602906.26 };
// A tela do balanco de 03/08 que ele mandou.
const ALVO_BAL = { qtd_balanco:3189.000, valor_balanco:14361.7264,
                   qtd_estoque:10697.859, valor_estoque:45883.817,
                   qtd_diferenca:-7508.859, valor_diferenca:-31522.0906 };

const n = (x)=>{ const v = parseFloat(x); return isNaN(v) ? 0 : v; };
const perto = (a,b,tol)=> Math.abs(n(a)-n(b)) <= (tol==null?0.01:tol);

function sbReq(metodo, caminho, corpo, prefer){
  return new Promise((res,rej)=>{
    const dados = corpo ? JSON.stringify(corpo) : null;
    const h = { apikey:SB_KEY, Authorization:"Bearer "+SB_KEY, "Content-Type":"application/json" };
    if(prefer) h.Prefer = prefer;
    if(dados) h["Content-Length"] = Buffer.byteLength(dados);
    const r = https.request({ host:SB_HOST, path:caminho, method:metodo, headers:h }, resp=>{
      let d=""; resp.on("data",c=>d+=c);
      resp.on("end",()=> resp.statusCode<300 ? res(d?JSON.parse(d):null)
        : rej(new Error("HTTP "+resp.statusCode+" "+d.slice(0,300))));
    });
    r.on("error",rej); if(dados) r.write(dados); r.end();
  });
}
const sbUpsert = (tabela, chave, linhas)=> linhas.length
  ? sbReq("POST","/rest/v1/"+tabela+"?on_conflict="+chave, linhas, "resolution=merge-duplicates,return=minimal")
  : Promise.resolve();

(async ()=>{
  const diag = { etapas:{}, quando:new Date().toISOString() };
  let c = null;

  async function etapa(nome, f){
    try { const r = await f(); diag.etapas[nome] = { ok:true, resumo:r }; return r; }
    catch(e){ diag.etapas[nome] = { ok:false, erro:e.message,
                                    onde:(e.stack||"").split("\n")[1]||"" };
              console.log("!! etapa '"+nome+"' falhou: "+e.message); return null; }
  }

  try {
    if(!SB_KEY) throw new Error("Falta SUPABASE_SERVICE_KEY no .env");
    if(!g("PG_HOST")) throw new Error("Falta o .env do VR (rode na pasta do robo)");

    const tt = await sbReq("GET","/rest/v1/flv_config?select=tenant_id&limit=1");
    const tenant = tt && tt[0] && tt[0].tenant_id;
    if(!tenant) throw new Error("nao achei o tenant (a tabela flv_config existe?)");
    diag.tenant = tenant;

    const ja = await sbReq("GET","/rest/v1/flv_vr_faturamento?select=competencia&limit=1");
    const desde = (ja && ja.length)
      ? `(date_trunc('month', current_date) - interval '${MESES_QUENTES - 1} months')`
      : `date '${DESDE_CHEIO}'`;

    c = new Client({ host:g("PG_HOST"), port:+g("PG_PORT"), database:g("PG_DATABASE"),
                     user:g("PG_USER"), password:g("PG_PASSWORD"), ssl:false,
                     connectionTimeoutMillis:20000 });
    await c.connect();

    const FLV   = `p.mercadologico1 = ${MERC1} and p.mercadologico2 = ${MERC2}`;
    const LIMPO = `v.cancelado = false and cp.cancelado = false and cp.id_loja = ${LOJA}`;

    // ================================================================
    // 1) FATURAMENTO -> flv_vr_faturamento
    // Os dois filtros que fizeram diferenca e nao sao obvios:
    //   v.cancelado  = ITEM cancelado dentro de um cupom que passou.
    //   cp.cancelado = CUPOM inteiro cancelado. Faltava este, e sozinho valia
    //                  ~R$ 5.800 por mes a mais.
    // A loja fica em pdv.venda; pdv.vendaitem nao tem id_loja.
    // ================================================================
    await etapa("faturamento", async ()=>{
      const fat = (await c.query(`
        select date_trunc('month', v.data)::date mes,
               sum(v.valortotal) faturamento,
               sum(v.quantidade) qtd
          from pdv.vendaitem v
          join pdv.venda cp on cp.id = v.id_venda
          join public.produto p on p.id = v.id_produto
         where ${LIMPO} and ${FLV} and v.data >= ${desde}
         group by 1 order by 1`)).rows;
      await sbUpsert("flv_vr_faturamento","tenant_id,competencia", fat.map(r=>({
        tenant_id:tenant, competencia:r.mes,
        faturamento:n(r.faturamento), qtd_vendida:n(r.qtd),
        origem:{ tela:"Estatisticas / Exibicao VENDA", mercadologico:MERC1+"."+MERC2,
                 loja:LOJA, filtros:"item nao cancelado + cupom nao cancelado" },
        atualizado_em:new Date().toISOString()
      })));
      console.log("faturamento: "+fat.length+" meses na nuvem");
      return fat.length+" meses";
    });

    // ================================================================
    // 2) DE ONDE VEM A DIFERENCA DE ~R$ 100 POR MES
    // Nao adivinho a formula: somo cada parcela SOZINHA e vejo qual vale
    // exatamente o que falta. Assim o proprio script responde.
    // ================================================================
    await etapa("centavos", async ()=>{
      const p = (await c.query(`
        select to_char(date_trunc('month', v.data),'YYYY-MM') mes,
               sum(v.valortotal)            base,
               sum(v.valoracrescimo)        acrescimo,
               sum(v.valoracrescimocupom)   acrescimo_cupom,
               sum(v.valoracrescimofixo)    acrescimo_fixo,
               sum(v.valordesconto)         desconto,
               sum(v.valordescontocupom)    desconto_cupom,
               sum(v.valordescontopromocao) desconto_promocao,
               sum(v.valordescontomanual)   desconto_manual,
               sum(v.valoricmsdesonerado)   icms_desonerado,
               sum(v.quantidade*v.precovenda) qtd_x_preco,
               count(*) itens
          from pdv.vendaitem v
          join pdv.venda cp on cp.id = v.id_venda
          join public.produto p on p.id = v.id_produto
         where ${LIMPO} and ${FLV} and v.data >= date '2026-01-01'
         group by 1 order by 1`)).rows;
      diag.centavos = p.map(r=>{
        const seu = SUA_TELA[r.mes], base = n(r.base);
        const falta = seu ? +(seu-base).toFixed(2) : null;
        const casa = falta==null ? [] : [
          ["acrescimo",r.acrescimo],["acrescimo_cupom",r.acrescimo_cupom],
          ["acrescimo_fixo",r.acrescimo_fixo],["desconto",r.desconto],
          ["desconto_cupom",r.desconto_cupom],["desconto_promocao",r.desconto_promocao],
          ["desconto_manual",r.desconto_manual],["icms_desonerado",r.icms_desonerado],
          ["qtd_x_preco_menos_base", n(r.qtd_x_preco)-base]
        ].filter(x=>perto(x[1], falta, 0.05)).map(x=>x[0]);
        return { mes:r.mes, sua_tela:seu||null, minha_base:base, falta:falta,
                 casa_com:casa, parcelas:r };
      });
      diag.centavos.forEach(x=> x.sua_tela && console.log("  "+x.mes
        +"  sua="+x.sua_tela.toFixed(2)+"  minha="+x.minha_base.toFixed(2)
        +"  falta="+x.falta+"  casa com: "+(x.casa_com.join("+")||"nenhuma sozinha")));
      return diag.centavos.length+" meses comparados";
    });

    // ================================================================
    // 3) ONDE MORA A CONTAGEM DO BALANCO
    // Procuro no catalogo INTEIRO (nao numa lista de nomes chutados) e depois somo
    // cada coluna de quantidade candidata para o balanco do hortifruti de 03/08,
    // filtrando FLV. A que der 3.189,000 e a certa.
    // ================================================================
    const achado = await etapa("cacar_contagem", async ()=>{
      const tabs = (await c.query(`
        select t.table_schema esquema, t.table_name tabela
          from information_schema.tables t
         where t.table_type='BASE TABLE'
           and (t.table_name like '%balanc%' or t.table_name like '%colet%'
             or t.table_name like '%contag%' or t.table_name like '%invent%'
             or t.table_name like '%apurac%' or t.table_name like '%acerto%')
         order by 1,2`)).rows;

      diag.tabelas = [];
      for(const t of tabs){
        const nome = t.esquema+"."+t.tabela;
        const linha = { nome, linhas:null, colunas:[] };
        try { linha.linhas = (await c.query("select count(*)::int c from "+nome)).rows[0].c; }
        catch(e){ linha.erro_contagem = e.message; }
        try {
          // ARRAY nos valores. Estava passando c.query(texto, a, b) — o pg exige
          // c.query(texto, [a, b]), entao esta consulta falhava calada e a lista de
          // colunas vinha vazia; sem colunas, a caca inteira nao acontecia.
          linha.colunas = (await c.query(
            "select column_name n from information_schema.columns "+
            "where table_schema=$1 and table_name=$2 order by ordinal_position",
            [t.esquema, t.tabela])).rows.map(r=>r.n);
        } catch(e){ linha.erro_colunas = e.message; }
        diag.tabelas.push(linha);
      }

      // Qual e o balanco do hortifruti de 03/08?
      const bal = (await c.query(`
        select id, data::date dia, descricao, id_loja
          from public.balanco
         where id_loja = ${LOJA} and data between date '2026-08-01' and date '2026-08-10'
         order by data limit 5`)).rows;
      diag.balanco_alvo = bal;
      const idAlvo = bal.length ? bal[bal.length-1].id : 47;
      diag.id_alvo = idAlvo;

      /* CACA LARGA DE PROPOSITO.
         A balancoprelancamento, que pelo nome seria a obvia, esta com ZERO linhas no VR
         real. Entao nao dou por certo nenhum palpite de nome: pego TODA tabela que tenha
         id_balanco e QUALQUER coluna com "quant"/"qtd" no nome, e somo. Tabela sem
         id_produto eu somo sem filtro e marco como nao-filtravel — serve de pista, nao de
         resposta. */
      diag.candidatas = [];
      for(const t of diag.tabelas){
        if(!t.linhas || !t.colunas.length) continue;
        if(t.colunas.indexOf("id_balanco") < 0) continue;
        const temProduto = t.colunas.indexOf("id_produto") >= 0;

        // Quantas linhas esta tabela tem PARA ESTE balanco? Se for zero, ela nem guarda
        // esta contagem — e isso ja e informacao.
        try{
          t.linhas_do_alvo = (await c.query(
            "select count(*)::int c from "+t.nome+" where id_balanco = $1",[idAlvo])).rows[0].c;
        }catch(e){ t.erro_alvo = e.message; }

        const quantis = t.colunas.filter(x=>{
          const k = x.toLowerCase();
          return k.indexOf("quant") >= 0 || k.indexOf("qtd") >= 0;
        });
        for(const q of quantis){
          try{
            const sql = temProduto
              ? `select sum(x.${q}) soma, count(*) linhas
                   from ${t.nome} x
                   join public.produto p on p.id = x.id_produto
                  where x.id_balanco = ${idAlvo} and ${FLV}`
              : `select sum(x.${q}) soma, count(*) linhas
                   from ${t.nome} x
                  where x.id_balanco = ${idAlvo}`;
            const r = (await c.query(sql)).rows[0] || {};
            diag.candidatas.push({ tabela:t.nome, coluna:q, soma:n(r.soma), linhas:r.linhas,
              filtravel_por_flv: temProduto,
              e_a_contagem: temProduto && perto(r.soma, ALVO_BAL.qtd_balanco, 0.001),
              e_o_estoque:  temProduto && perto(r.soma, ALVO_BAL.qtd_estoque, 0.001) });
          }catch(e){ diag.candidatas.push({ tabela:t.nome, coluna:q, erro:e.message }); }
        }
      }
      diag.candidatas.forEach(x=>console.log("  "+x.tabela+"."+x.coluna+" = "
        +(x.erro ? ("ERRO "+x.erro)
          : (n(x.soma).toFixed(3)
             +(x.filtravel_por_flv?"":"  (sem id_produto: nao da para filtrar FLV)")
             +(x.e_a_contagem?"   <<< E A CONTAGEM":"")
             +(x.e_o_estoque?"   (e o lado estoque)":"")))));

      const boa = diag.candidatas.filter(x=>x.e_a_contagem);
      return boa.length===1 ? boa[0] : null;
    });

    // ================================================================
    // 4) QUAL LEITURA DE CUSTO A TELA USA
    // A tela mostra Total Estoque 45.883,817. O balancoestoqueanterior guarda
    // quatro custos diferentes; so um reproduz aquele numero.
    // ================================================================
    await etapa("custo_certo", async ()=>{
      const r = (await c.query(`
        select sum(e.quantidade) qtd,
               sum(e.quantidade*coalesce(e.custocomimposto,0))      com_imposto,
               sum(e.quantidade*coalesce(e.custosemimposto,0))      sem_imposto,
               sum(e.quantidade*coalesce(e.customediocomimposto,0)) medio_com,
               sum(e.quantidade*coalesce(e.customediosemimposto,0)) medio_sem,
               count(*) linhas
          from public.balancoestoqueanterior e
          join public.produto p on p.id = e.id_produto
         where e.id_balanco = ${diag.id_alvo||47} and ${FLV}`)).rows[0];
      if(!r) throw new Error("a consulta do estoque nao devolveu linha nenhuma");
      diag.estoque_alvo = r;
      diag.custo_que_bate = ["com_imposto","sem_imposto","medio_com","medio_sem"]
        .filter(k=>perto(r[k], ALVO_BAL.valor_estoque, 0.01));
      console.log("  estoque: qtd="+n(r.qtd).toFixed(3)+" (alvo 10697.859)"
        +"  custo que bate com 45883.817: "+(diag.custo_que_bate.join(",")||"nenhum"));
      return diag.custo_que_bate.join(",")||"nenhum";
    });

    // ================================================================
    // 5) SE A CONTAGEM FOI ACHADA, JA GRAVA OS BALANCOS
    // So grava quando a identificacao foi UNICA e o custo tambem. Se ficou
    // ambiguo, prefiro nao gravar nada e mandar o relatorio — numero de balanco
    // errado vira premio errado.
    // ================================================================
    await etapa("gravar_balancos", async ()=>{
      if(!achado) return "contagem nao identificada — nada gravado";
      const custo = diag.custo_que_bate && diag.custo_que_bate.length===1
        ? { com_imposto:"custocomimposto", sem_imposto:"custosemimposto",
            medio_com:"customediocomimposto", medio_sem:"customediosemimposto" }[diag.custo_que_bate[0]]
        : null;
      if(!custo) return "custo ambiguo — nada gravado";

      let linhas = (await c.query(`
        select b.id vr_id, b.data::date dia, b.descricao,
               count(*) linhas,
               count(k.id_produto) linhas_contadas,
               sum(coalesce(k.${achado.coluna},0))                          qtd_balanco,
               sum(coalesce(k.${achado.coluna},0)*coalesce(e.${custo},0))   valor_balanco,
               sum(e.quantidade)                                           qtd_estoque,
               sum(e.quantidade*coalesce(e.${custo},0))                    valor_estoque
          from public.balanco b
          join public.balancoestoqueanterior e on e.id_balanco = b.id
          join public.produto p on p.id = e.id_produto
          left join ${achado.tabela} k
                 on k.id_balanco = e.id_balanco and k.id_produto = e.id_produto
         where b.id_loja = ${LOJA} and ${FLV}
         group by b.id, b.data, b.descricao
         order by b.data`)).rows;

      /* O PERIODO SE MEDE NA FILA COMPLETA, ANTES DE DESCARTAR QUALQUER COISA.
         Um balanco fecha o periodo desde a contagem ANTERIOR — e "anterior" quer dizer a
         que existiu no VR, tenha ela contagem guardada ou nao. Se eu filtrasse primeiro,
         jogar fora um balanco antigo mudaria a competencia de um balanco bom que veio
         depois, calado. */
      const ord = linhas.slice().sort(function(a,b){ return String(a.dia)<String(b.dia)?-1:1; });
      const dias = (d)=> new Date(String(d).slice(0,10)+"T00:00:00Z").getTime()/86400000;

      function competencia(ate, de){
        if(!de){
          /* Primeiro balanco da fila: nao ha periodo para medir. Uso a regra que o Victor
             descreveu — a contagem do comeco do mes fecha o mes ANTERIOR; uma contagem do
             fim do mes fecha o proprio mes. */
          const a = String(ate).slice(0,10), dia = +a.slice(8,10);
          let ano = +a.slice(0,4), mes = +a.slice(5,7);
          if(dia <= 15){ mes -= 1; if(mes === 0){ mes = 12; ano -= 1; } }
          return ano+"-"+(mes<10?"0":"")+mes+"-01";
        }
        // Com periodo: o mes que ocupa a maior parte dele. 01/07 a 03/08 = julho.
        const conta = {};
        for(let d = dias(de)+1; d <= dias(ate); d++){
          const m = new Date(d*86400000).toISOString().slice(0,7);
          conta[m] = (conta[m]||0)+1;
        }
        const meses = Object.keys(conta).sort(function(a,b){ return conta[b]-conta[a]; });
        return meses.length ? meses[0]+"-01" : null;
      }

      const comPeriodo = ord.map(function(r,i){
        const ate = String(r.dia).slice(0,10);
        const de  = i>0 ? String(ord[i-1].dia).slice(0,10) : null;
        return { r:r, ate:ate, de:de, comp:competencia(ate, de) };
      });

      /* BALANCO SEM CONTAGEM GUARDADA NAO ENTRA — mas so agora, depois de medido.
         O left join com coalesce(...,0) le "nao contado" como "contei zero", que e a regra
         certa para um PRODUTO dentro do balanco (o proprio VR marca zeraitemnaocoletado, e
         foi assim que o Victor explicou). Mas se o balanco INTEIRO nao tiver contagem
         guardada, a mesma conta diz que o estoque todo virou desperdicio: um mes com 100%
         de perda, com cara de numero legitimo. No VR real a balancoprelancamento esta com
         ZERO linhas, entao isso ia acontecer justamente com os balancos antigos.
         Melhor faltar o mes do que inventar a perda dele. */
      const semContagem = comPeriodo.filter(function(x){ return !(+x.r.linhas_contadas > 0); });
      diag.balancos_sem_contagem = semContagem.map(function(x){
        return { vr_id:x.r.vr_id, dia:x.ate, descricao:x.r.descricao, linhas:x.r.linhas }; });
      if(semContagem.length) console.log("  "+semContagem.length
        +" balanco(s) sem contagem guardada — ficaram de fora de proposito");

      const bons = comPeriodo.filter(function(x){ return +x.r.linhas_contadas > 0; });
      if(!bons.length) return "nenhum balanco tem contagem guardada — nada gravado";

      const upsert = bons.map(function(x){
        const r = x.r;
        const qb = n(r.qtd_balanco),   qe = n(r.qtd_estoque);
        const vb = n(r.valor_balanco), ve = n(r.valor_estoque);
        return { tenant_id:tenant, vr_id:r.vr_id, balanco_data:x.ate, descricao:r.descricao,
                 competencia_sugerida:x.comp, periodo_de:x.de, periodo_ate:x.ate,
                 qtd_balanco:qb, valor_balanco:vb, qtd_estoque:qe, valor_estoque:ve,
                 qtd_diferenca:+(qb-qe).toFixed(3), valor_diferenca:+(vb-ve).toFixed(4),
                 linhas:r.linhas,
                 origem:{ tabela_contagem:achado.tabela, coluna:achado.coluna, custo:custo,
                          linhas_contadas:r.linhas_contadas },
                 atualizado_em:new Date().toISOString() };
      });

      await sbUpsert("flv_vr_balancos","tenant_id,vr_id", upsert);
      diag.balancos_gravados = upsert.map(x=>({ dia:x.balanco_data, comp:x.competencia_sugerida,
        qtd_dif:x.qtd_diferenca, valor_dif:x.valor_diferenca }));
      console.log("balancos gravados: "+upsert.length);
      diag.balancos_gravados.slice(-6).forEach(x=>console.log("   "+x.dia+" -> "+x.comp
        +"  dif "+x.qtd_dif+" un  R$ "+x.valor_dif));
      return upsert.length+" balancos";
    });

  } catch(e){
    diag.erro_geral = e.message;
    diag.onde = (e.stack||"").split("\n").slice(0,3).join(" | ");
    console.log("!! vr-sync-flv falhou: "+e.message);
  }

  try { if(c) await c.end(); } catch(e){}

  // O RELATORIO SAI SEMPRE. Foi a licao do medidor que rodou na loja e nao deixou
  // rastro: a janela fechou e o erro foi junto.
  try{
    const ev = await sbReq("GET","/rest/v1/receb_eventos?select=id&limit=1");
    await sbReq("POST","/rest/v1/receb_eventos",[{ entidade:"vr_flv",
      entidade_id:(ev&&ev[0]&&ev[0].id)||"00000000-0000-0000-0000-000000000000",
      acao:"sync", detalhe:diag }],"return=minimal");
    console.log(">>> relatorio do FLV enviado para a nuvem.");
  }catch(e){ console.log("!! nao consegui mandar o relatorio: "+e.message); }
})();
