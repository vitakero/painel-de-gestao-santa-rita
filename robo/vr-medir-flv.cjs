// MEDIDOR DO FLV — fecha os dois números do jeito exato do VR.
//
// O Victor mostrou as duas telas de onde ele tira tudo:
//   FATURAMENTO ... Estatisticas, Exibicao=VENDA, mercadologico 043›001 FLV.
//   DESPERDICIO ... o "Total Diferenca" do balanco da primeira segunda-feira.
//
// A minha conta de faturamento ja chega perto (R$ 14 a R$ 124 por mes em ~R$ 600.000), mas
// perto nao serve: numero que quase bate e pior do que numero que erra feio, porque passa.
// Aqui eu NAO chuto a formula. Somo cada parcela candidata separada — acrescimo, desconto,
// promocao, cancelado — para ver qual delas vale exatamente a diferenca que sobra.
//
// E procuro, no catalogo inteiro, onde o VR guarda a CONTAGEM do balanco: a
// balancoestoqueanterior so tem o lado "Estoque"; o lado "Balanco" esta em outro lugar.
//
// So LE o VR.  node scripts/vr-medir-flv.cjs
const fs=require("fs"), path=require("path"), https=require("https"), { Client }=require("pg");
function env(){ for(const p of [path.join(__dirname,"..",".env"),".env","../.env"]){
  try{ return fs.readFileSync(p,"utf8"); }catch(e){} } return ""; }
const E=env(), g=(k)=>{ const m=E.match(new RegExp("^"+k+"=(.*)$","m")); return m?m[1].trim():""; };
const SB_HOST="uabhsmculsfwzcrhyhch.supabase.co", SB_KEY=g("SUPABASE_SERVICE_KEY");
const LOJA=1;

function req(method,pathq,body,prefer){
  return new Promise((res,rej)=>{
    const data=body?JSON.stringify(body):null;
    const headers={apikey:SB_KEY,Authorization:"Bearer "+SB_KEY,"Content-Type":"application/json"};
    if(prefer) headers.Prefer=prefer;
    if(data) headers["Content-Length"]=Buffer.byteLength(data);
    const r=https.request({host:SB_HOST,path:pathq,method,headers},(resp)=>{
      let d=""; resp.on("data",c=>d+=c);
      resp.on("end",()=>resp.statusCode<300?res(d?JSON.parse(d):null)
        :rej(new Error("HTTP "+resp.statusCode+" "+d.slice(0,200))));
    });
    r.on("error",rej); if(data) r.write(data); r.end();
  });
}
const n=(v)=>{ const x=parseFloat(v); return isNaN(x)?0:x; };

// O que a tela dele mostrou, para eu comparar sozinho e nao ficar mandando tabela pra ele
// conferir na mao. Agosto fica de fora: o mes ainda esta correndo.
const SUA_TELA={ "2026-01":578545.51,"2026-02":513069.02,"2026-03":599417.99,"2026-04":577431.46,
                 "2026-05":621008.45,"2026-06":603274.89,"2026-07":602906.26 };

(async()=>{
  if(!SB_KEY){ console.log("!! Falta SUPABASE_SERVICE_KEY no .env"); return; }
  const c=new Client({ host:g("PG_HOST"), port:+g("PG_PORT"), database:g("PG_DATABASE"),
    user:g("PG_USER"), password:g("PG_PASSWORD"), connectionTimeoutMillis:20000 });
  try{ await c.connect(); }
  catch(e){ console.log("NAO CONSEGUI CONECTAR NO VR: "+e.message); process.exit(1); }

  const out={ erro:null };
  const FLV=`p.mercadologico1 = 43 and p.mercadologico2 = 1`;
  const LIMPO=`v.cancelado = false and cp.cancelado = false and cp.id_loja = ${LOJA}`;

  try{
    // =====================================================================
    // 1) DE ONDE VEM A DIFERENCA DE ~R$ 100 POR MES
    // Cada parcela somada sozinha. Se alguma bater com a diferenca que sobra,
    // achei — sem precisar adivinhar a formula inteira.
    // =====================================================================
    out.parcelas=(await c.query(`
      select to_char(date_trunc('month', v.data),'YYYY-MM') mes,
             sum(v.valortotal)                 base,
             sum(v.valoracrescimo)             acrescimo,
             sum(v.valoracrescimocupom)        acrescimo_cupom,
             sum(v.valoracrescimofixo)         acrescimo_fixo,
             sum(v.valordesconto)              desconto,
             sum(v.valordescontocupom)         desconto_cupom,
             sum(v.valordescontopromocao)      desconto_promocao,
             sum(v.valordescontomanual)        desconto_manual,
             sum(v.valoricmsdesonerado)        icms_desonerado,
             sum(v.quantidade * v.precovenda)  qtd_x_preco,
             sum(v.quantidade)                 qtd,
             count(*)                          itens
        from pdv.vendaitem v
        join pdv.venda cp on cp.id = v.id_venda
        join public.produto p on p.id = v.id_produto
       where ${LIMPO} and ${FLV} and v.data >= date '2026-01-01'
       group by 1 order by 1`)).rows;

    // O que eu estou DEIXANDO DE FORA com cada filtro. Se a tela dele nao filtrar
    // uma dessas coisas, e aqui que a diferenca aparece.
    out.excluidos=(await c.query(`
      select to_char(date_trunc('month', v.data),'YYYY-MM') mes,
             sum(v.valortotal) filter (where v.cancelado)                    item_cancelado,
             sum(v.valortotal) filter (where cp.cancelado)                   cupom_cancelado,
             sum(v.valorcancelado)                                           valor_cancelado,
             sum(v.valortotal) filter (where cp.id_loja <> ${LOJA})          outra_loja,
             sum(v.valortotal) filter (where cp.vendaecommerce)              ecommerce,
             sum(v.valortotal) filter (where cp.baixaestoque = false)        sem_baixa_estoque,
             sum(v.valortotal) filter (where v.data <> cp.data)              data_diferente_do_cupom
        from pdv.vendaitem v
        join pdv.venda cp on cp.id = v.id_venda
        join public.produto p on p.id = v.id_produto
       where ${FLV} and v.data >= date '2026-01-01'
       group by 1 order by 1`)).rows;

    // Itens vendidos cujo produto sumiu do cadastro: o meu join derruba, a tela dele
    // talvez nao (se o VR guardar o mercadologico no proprio item da venda).
    out.semProduto=(await c.query(`
      select to_char(date_trunc('month', v.data),'YYYY-MM') mes,
             count(*) itens, sum(v.valortotal) valor
        from pdv.vendaitem v
        join pdv.venda cp on cp.id = v.id_venda
        left join public.produto p on p.id = v.id_produto
       where ${LIMPO} and p.id is null and v.data >= date '2026-01-01'
       group by 1 order by 1`)).rows;

    // Devolucao de cupom: sao 6 registros no banco inteiro, mas confiro assim mesmo.
    out.devolucoes=(await c.query(`
      select to_char(date_trunc('month', dc.data),'YYYY-MM') mes, count(*) qtd
        from pdv.devolucaocupom dc group by 1 order by 1`)).rows;

    // =====================================================================
    // 2) ONDE MORA A CONTAGEM DO BALANCO
    // A balancoestoqueanterior so tem o lado "Estoque". Procuro no catalogo INTEIRO
    // (nao numa lista de nomes que eu chutei) quem guarda o lado "Balanco".
    // =====================================================================
    out.catalogoBalanco=(await c.query(`
      select t.table_schema||'.'||t.table_name nome,
             (select count(*) from information_schema.columns k
               where k.table_schema=t.table_schema and k.table_name=t.table_name) colunas
        from information_schema.tables t
       where t.table_type='BASE TABLE'
         and (t.table_name like '%balanc%' or t.table_name like '%colet%'
           or t.table_name like '%contag%' or t.table_name like '%invent%'
           or t.table_name like '%apurac%' or t.table_name like '%acerto%')
       order by 1`)).rows;

    for(const t of out.catalogoBalanco){
      try{ t.linhas=(await c.query("select count(*)::int c from "+t.nome)).rows[0].c; }catch(e){ t.linhas=null; }
      try{ t.colunasNomes=(await c.query(
        "select column_name n from information_schema.columns "+
        "where table_schema=$1 and table_name=$2 order by ordinal_position",
        t.nome.split(".")[0], t.nome.split(".")[1])).rows.map(r=>r.n).join(","); }catch(e){}
    }

    // O balanco do hortifruti de 03/08 e o id 47. Confiro se o lado ESTOQUE fecha com a
    // tela dele: Qtd Estoque 10.697,859 e Total Estoque 45.883,817. Testo as quatro
    // leituras de custo — e uma delas que a tela usa, nao as quatro.
    out.balancoAlvo=(await c.query(`
      select b.id, b.data::text dia, b.descricao,
             count(*) linhas,
             sum(e.quantidade)                                   qtd_estoque,
             sum(e.quantidade * coalesce(e.custocomimposto,0))    total_com_imposto,
             sum(e.quantidade * coalesce(e.custosemimposto,0))    total_sem_imposto,
             sum(e.quantidade * coalesce(e.customediocomimposto,0)) total_medio_com,
             sum(e.quantidade * coalesce(e.customediosemimposto,0)) total_medio_sem
        from public.balanco b
        join public.balancoestoqueanterior e on e.id_balanco = b.id
        join public.produto p on p.id = e.id_produto
       where b.id_loja = ${LOJA} and ${FLV}
       group by b.id, b.data, b.descricao
       order by b.data desc limit 12`)).rows;

    out.balancos=(await c.query(`
      select id, data::text dia, descricao, id_loja, id_listagembalanco, zeraitemnaocoletado
        from public.balanco order by data desc limit 20`)).rows;

  }catch(e){ out.erro=e.message; console.log("!! "+e.message); }

  await c.end();

  // ---- relatorio na tela do robo ----
  console.log("\n=== 1) A DIFERENCA DE ~R$ 100 POR MES ===");
  console.log("mes     |    sua tela |   minha base |   falta | qual parcela vale isso?");
  (out.parcelas||[]).forEach(r=>{
    const seu=SUA_TELA[r.mes]; if(!seu) return;
    const base=n(r.base), falta=seu-base;
    const cand=[["acrescimo",r.acrescimo],["acresc_cupom",r.acrescimo_cupom],
                ["acresc_fixo",r.acrescimo_fixo],["desconto",r.desconto],
                ["desc_cupom",r.desconto_cupom],["desc_promo",r.desconto_promocao],
                ["desc_manual",r.desconto_manual],["icms_deson",r.icms_desonerado]]
      .filter(x=>Math.abs(n(x[1])-falta)<0.02).map(x=>x[0]).join("+");
    console.log(r.mes+" | "+seu.toFixed(2).padStart(11)+" | "+base.toFixed(2).padStart(12)
      +" | "+falta.toFixed(2).padStart(7)+" | "+(cand||"-"));
  });
  console.log("\nparcelas somadas por mes:");
  (out.parcelas||[]).forEach(r=>console.log("  "+r.mes
    +"  acresc="+n(r.acrescimo).toFixed(2)+"  acrescCupom="+n(r.acrescimo_cupom).toFixed(2)
    +"  acrescFixo="+n(r.acrescimo_fixo).toFixed(2)+"  desc="+n(r.desconto).toFixed(2)
    +"  descCupom="+n(r.desconto_cupom).toFixed(2)+"  descPromo="+n(r.desconto_promocao).toFixed(2)
    +"  descManual="+n(r.desconto_manual).toFixed(2)+"  qtdXpreco="+n(r.qtd_x_preco).toFixed(2)));
  console.log("\nsem produto no cadastro:"); (out.semProduto||[]).forEach(r=>console.log("  "+r.mes+"  "+r.itens+" itens  R$ "+n(r.valor).toFixed(2)));

  console.log("\n=== 2) ONDE ESTA A CONTAGEM DO BALANCO ===");
  (out.catalogoBalanco||[]).forEach(t=>{
    console.log("  "+t.nome.padEnd(40)+" linhas="+String(t.linhas).padStart(7));
    if(t.linhas) console.log("      "+(t.colunasNomes||""));
  });
  console.log("\nlado ESTOQUE por balanco (alvo 03/08: qtd 10.697,859 e R$ 45.883,817):");
  (out.balancoAlvo||[]).forEach(r=>console.log("  #"+String(r.id).padStart(3)+" "+r.dia
    +"  qtd="+n(r.qtd_estoque).toFixed(3).padStart(12)
    +"  comImp="+n(r.total_com_imposto).toFixed(3).padStart(12)
    +"  semImp="+n(r.total_sem_imposto).toFixed(3).padStart(12)
    +"  medioCom="+n(r.total_medio_com).toFixed(3).padStart(12)
    +"  medioSem="+n(r.total_medio_sem).toFixed(3).padStart(12)));

  try{
    const ev=(await req("GET","/rest/v1/receb_eventos?select=id&limit=1"))||[];
    await req("POST","/rest/v1/receb_eventos",[{ entidade:"vr_flv",
      entidade_id:(ev[0]&&ev[0].id)||"00000000-0000-0000-0000-000000000000",
      acao:"medicao", detalhe:out }],"return=minimal");
    console.log("\n>>> medicao enviada para a nuvem.");
  }catch(e){ console.log("!! nao consegui mandar: "+e.message); }
})();
