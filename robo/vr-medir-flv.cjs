// MEDIDOR DO FLV — calcula, do jeito do VR, os números que hoje o Victor tira na mão.
//
// Ele explicou o processo: o setor é HORTIFRUTI e dentro dele o mercadológico FLV
// (descoberto: 43.1, com 43.1.1 legumes, 43.1.2 frutas, 43.1.3 verduras). O desperdício vem
// do balanço da primeira segunda-feira do mês; depois eles emitem uma nota de perda.
//
// EU NÃO ESCOLHO A FÓRMULA. Calculo as variações plausíveis e mando todas para a nuvem, para
// ele comparar com a planilha dele e dizer qual bate. Chutar aqui seria produzir um número
// bonito e errado — e ninguém desconfiaria, porque tem cara de resultado.
//
// Só LÊ o VR.  node scripts/vr-medir-flv.cjs
const fs=require("fs"), path=require("path"), https=require("https"), { Client }=require("pg");
function env(){ for(const p of [path.join(__dirname,"..",".env"),".env","../.env"]){
  try{ return fs.readFileSync(p,"utf8"); }catch(e){} } return ""; }
const E=env(), g=(k)=>{ const m=E.match(new RegExp("^"+k+"=(.*)$","m")); return m?m[1].trim():""; };
const SB_HOST="uabhsmculsfwzcrhyhch.supabase.co", SB_KEY=g("SUPABASE_SERVICE_KEY");
const LOJA=1, MESES=8;

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

(async()=>{
  if(!SB_KEY){ console.log("!! Falta SUPABASE_SERVICE_KEY no .env"); return; }
  const c=new Client({ host:g("PG_HOST"), port:+g("PG_PORT"), database:g("PG_DATABASE"),
    user:g("PG_USER"), password:g("PG_PASSWORD"), connectionTimeoutMillis:20000 });
  try{ await c.connect(); }
  catch(e){ console.log("NAO CONSEGUI CONECTAR NO VR: "+e.message); process.exit(1); }

  const out={ flv:"mercadologico1=43 e mercadologico2=1", meses:[], perdaDias:[], erro:null };
  try{
    // ---- VENDA do FLV, mês a mês, BRUTA e com os descontos separados ----
    // Mando as parcelas separadas de propósito: assim ele vê qual combinação bate com a
    // "venda líquida" que ele usa, sem eu ter que adivinhar o que o VR chama de líquido.
    // A LOJA NÃO ESTÁ NO ITEM, ESTÁ NO CUPOM.
    // Eu somava as duas lojas e meu faturamento saía sempre ~0,8% acima do que o Victor lê
    // no VR — bonitinho, consistente, e errado. A loja 02 existe e não é usada no controle
    // dele. Trago as duas somas para provar que a diferença é essa, não outra coisa.
    const vendas=(await c.query(`
      select to_char(date_trunc('month', v.data),'YYYY-MM') mes,
             sum(v.valortotal) filter (where cp.id_loja = ${LOJA} and cp.cancelado = false) bruto,
             sum(v.valortotal) filter (where cp.id_loja = ${LOJA})   bruto_com_cupom_cancelado,
             sum(v.valortotal)                                       bruto_todas_lojas,
             sum(coalesce(v.valordesconto,0))      filter (where cp.id_loja = ${LOJA}) desc_item,
             sum(coalesce(v.valordescontocupom,0)) filter (where cp.id_loja = ${LOJA}) desc_cupom,
             sum(coalesce(v.valordescontopromocao,0)) filter (where cp.id_loja = ${LOJA}) desc_promo,
             sum(coalesce(v.valoracrescimo,0))     filter (where cp.id_loja = ${LOJA}) acrescimo,
             sum(v.quantidade)                     filter (where cp.id_loja = ${LOJA}) qtd
        from pdv.vendaitem v
        join pdv.venda cp on cp.id = v.id_venda
        join public.produto p on p.id = v.id_produto
       where v.cancelado = false
         and p.mercadologico1 = 43 and p.mercadologico2 = 1
         and v.data >= date_trunc('month', current_date) - interval '${MESES} months'
       group by 1 order by 1`)).rows;

    // ---- PERDA do FLV, mês a mês ----
    // custocomimposto pode ser unitário OU já o total da linha. Mando as duas leituras.
    const perdas=(await c.query(`
      select to_char(date_trunc('month', pe.data),'YYYY-MM') mes,
             count(*)                                            linhas,
             sum(pe.quantidade)                                  qtd,
             sum(coalesce(pe.custocomimposto,0))                 soma_custo,
             sum(pe.quantidade * coalesce(pe.custocomimposto,0)) qtd_x_custo,
             sum(coalesce(pe.customediocomimposto,0))                 soma_medio,
             sum(pe.quantidade * coalesce(pe.customediocomimposto,0)) qtd_x_medio,
             count(*) filter (where pe.id_notasaida is not null) com_nota
        from public.perda pe
        join public.produto p on p.id = pe.id_produto
       where pe.id_loja = ${LOJA}
         and p.mercadologico1 = 43 and p.mercadologico2 = 1
         and pe.data >= date_trunc('month', current_date) - interval '${MESES} months'
       group by 1 order by 1`)).rows;

    // ---- em QUE DIAS a perda é lançada ----
    // Se cair tudo num dia por mês, confirma o que ele disse: o número nasce do balanço.
    // CADA LANÇAMENTO É UM BALANÇO. A primeira leitura mostrou que a perda cai num dia só
    // por mês (04/05, 01/06, 30/06, 03/08) — confirma o que ele contou. Então o valor POR DIA
    // é o desperdício daquele balanço, e é isso que tem que ser comparado com a planilha.
    // Trago o valor junto, não só a quantidade: sem ele não dá para conferir nada.
    out.perdaDias=(await c.query(`
      select pe.data::text dia, count(*) linhas, sum(pe.quantidade) qtd,
             sum(pe.quantidade * coalesce(pe.custocomimposto,0))      qtd_x_custo,
             sum(pe.quantidade * coalesce(pe.customediocomimposto,0)) qtd_x_medio,
             sum(coalesce(pe.custocomimposto,0))                      soma_custo,
             count(*) filter (where pe.id_notasaida is not null)      com_nota
        from public.perda pe
        join public.produto p on p.id = pe.id_produto
       where pe.id_loja = ${LOJA}
         and p.mercadologico1 = 43 and p.mercadologico2 = 1
         and pe.data >= date_trunc('month', current_date) - interval '14 months'
       group by 1 order by 1`)).rows
      .map(r=>({ dia:r.dia, linhas:+r.linhas, qtd:n(r.qtd), qtd_x_custo:n(r.qtd_x_custo),
                 qtd_x_medio:n(r.qtd_x_medio), soma_custo:n(r.soma_custo), com_nota:+r.com_nota }));

    const mp={};
    vendas.forEach(v=>{ mp[v.mes]=mp[v.mes]||{mes:v.mes}; Object.assign(mp[v.mes],{
      venda_bruta:n(v.bruto), venda_com_cupom_cancelado:n(v.bruto_com_cupom_cancelado), venda_todas_lojas:n(v.bruto_todas_lojas), desc_item:n(v.desc_item), desc_cupom:n(v.desc_cupom),
      desc_promo:n(v.desc_promo), acrescimo:n(v.acrescimo), qtd_vendida:n(v.qtd) }); });
    perdas.forEach(p=>{ mp[p.mes]=mp[p.mes]||{mes:p.mes}; Object.assign(mp[p.mes],{
      perda_linhas:+p.linhas, perda_qtd:n(p.qtd),
      perda_soma_custo:n(p.soma_custo), perda_qtd_x_custo:n(p.qtd_x_custo),
      perda_soma_medio:n(p.soma_medio), perda_qtd_x_medio:n(p.qtd_x_medio),
      perda_com_nota:+p.com_nota }); });
    out.meses=Object.keys(mp).sort().map(k=>mp[k]);

    console.log("mes      | venda bruta |  descontos |   perda R$ (qtd x custo) |  perda qtd");
    out.meses.forEach(m=>{
      const d=(m.desc_item||0)+(m.desc_cupom||0)+(m.desc_promo||0);
      console.log(String(m.mes).padEnd(8)+" | "+String((m.venda_bruta||0).toFixed(2)).padStart(11)
        +" | "+String(d.toFixed(2)).padStart(10)
        +" | "+String((m.perda_qtd_x_custo||0).toFixed(2)).padStart(24)
        +" | "+String((m.perda_qtd||0).toFixed(3)).padStart(10));
    });
  }catch(e){ out.erro=e.message; console.log("!! erro: "+e.message); }

    // ---- O DESPERDÍCIO VEM DO BALANÇO, NÃO DA TABELA DE PERDAS ----
    // O Victor foi direto ao ponto: o número que ele usa é o "Total Diferença" da tela do
    // balanço (03/08 deu -7.508,859 un e -R$ 31.522,0906), e o faturamento é o da tela de
    // Estatísticas — que a minha consulta já reproduz com R$ 100 de diferença em R$ 600 mil.
    //
    // Eu tinha ido atrás da tabela `perda` por conta própria e ela chega PERTO, o que é o
    // pior resultado possível: número parecido passa por certo. Aqui procuro a tabela do
    // balanço e tento fechar exatamente o -31.522,0906.
    try{
      out.balanco={};
      const cand=["balancoestoqueanterior","listagembalancoitem","balancoprelancamento",
                  "agendabalanco","listagembalanco","balanco","balancoitem"];
      const existe=(await c.query(
        "select table_name t from information_schema.tables "+
        "where table_schema='public' and table_name = any($1::text[])",[cand])).rows.map(r=>r.t);
      out.balanco.tabelas=[];
      for(const t of existe){
        const nome="public."+t;
        let n=null, cols=[], amostra=null, colData=null;
        try{ n=(await c.query("select count(*)::int c from "+nome)).rows[0].c; }catch(e){}
        try{ cols=(await c.query("select column_name n, data_type d from information_schema.columns "+
          "where table_schema='public' and table_name=$1 order by ordinal_position",[t]))
          .rows.map(r=>r.n+":"+r.d); }catch(e){}
        colData=(cols.map(x=>x.split(":")[0])).find(x=>/^(data|dt|datahora|databa)/i.test(x));
        try{
          if(n) amostra=(await c.query("select * from "+nome+
            (colData?(" order by "+colData+" desc"):"")+" limit 2")).rows;
        }catch(e){}
        out.balanco.tabelas.push({ nome:nome, linhas:n, colunas:cols, colData:colData, amostra:amostra });
        console.log("  "+nome+"  linhas="+n+"  dataCol="+colData);
        console.log("     colunas: "+cols.join(", ").slice(0,400));
      }

      // Se a tabela principal tiver o que espero, já tento fechar o número do 03/08.
      const alvo=out.balanco.tabelas.find(x=>x.nome==="public.balancoestoqueanterior" && x.linhas);
      if(alvo){
        const nomes=alvo.colunas.map(x=>x.split(":")[0]);
        const cQtdBal=nomes.find(x=>/quantidadebalanco|qtdbalanco|quantidadecontada/i.test(x));
        const cQtdEst=nomes.find(x=>/quantidadeestoque|qtdestoque|estoqueanterior/i.test(x));
        const cCusto =nomes.find(x=>/custo/i.test(x));
        const cProd  =nomes.find(x=>/id_produto/i.test(x));
        const cData  =alvo.colData;
        out.balanco.colunasUsadas={ cQtdBal:cQtdBal, cQtdEst:cQtdEst, cCusto:cCusto, cProd:cProd, cData:cData };
        if(cQtdBal && cQtdEst && cCusto && cProd && cData){
          out.balanco.calculo=(await c.query(`
            select b.${cData}::text dia,
                   sum(b.${cQtdBal}) qtd_balanco,
                   sum(b.${cQtdEst}) qtd_estoque,
                   sum(b.${cQtdBal} - b.${cQtdEst}) qtd_diferenca,
                   sum(b.${cQtdBal} * coalesce(b.${cCusto},0)) total_balanco,
                   sum(b.${cQtdEst} * coalesce(b.${cCusto},0)) total_estoque,
                   sum((b.${cQtdBal} - b.${cQtdEst}) * coalesce(b.${cCusto},0)) total_diferenca,
                   count(*) linhas
              from public.${alvo.nome.split(".")[1]} b
              join public.produto p on p.id = b.${cProd}
             where p.mercadologico1 = 43 and p.mercadologico2 = 1
               and b.${cData} >= '2025-12-01'
             group by 1 order by 1`)).rows;
          console.log("\n  BALANCO calculado (FLV) — o alvo e 03/08: qtd -7508,859 e R$ -31522,0906");
          (out.balanco.calculo||[]).forEach(r=>console.log("   "+r.dia
            +"  dif_qtd="+n(r.qtd_diferenca).toFixed(3).padStart(12)
            +"  dif_R$="+n(r.total_diferenca).toFixed(4).padStart(14)
            +"  ("+r.linhas+" linhas)"));
        } else {
          console.log("  (nao achei as colunas esperadas; mando a estrutura para eu olhar)");
        }
      }
    }catch(e){ out.balanco={ erro:e.message }; console.log("!! busca do balanco falhou: "+e.message); }

  await c.end();

  try{
    const local=(await req("GET","/rest/v1/receb_locais?select=id&order=criado_em&limit=1"))[0];
    await req("POST","/rest/v1/receb_eventos",[{
      entidade:"vr_flv", entidade_id:(local&&local.id)||"00000000-0000-0000-0000-000000000000",
      acao:"medicao", motivo:"numeros do FLV direto do VR, em varias leituras",
      detalhe:out }],"return=minimal");
    console.log("Medicao enviada para a nuvem.");
  }catch(e){ console.log("!! nao consegui enviar: "+e.message); }
})();
