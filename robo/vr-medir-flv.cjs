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

    // ---- ATRÁS DA FONTE DA TELA "ESTATÍSTICAS" ----
    // O Victor mandou a lista de PERDA por mês (Administrativo > Relatorios Gerenciais >
    // Estatisticas, filtrando o mercadologico 043>001 FLV). Meus números da tabela `perda`
    // ficam ABAIXO dos dele, e em abril e julho ele tem valor onde eu tenho zero — então
    // não é custo diferente, é origem diferente.
    //
    // Em vez de continuar chutando fórmula, procuro a tabela que ALIMENTA aquela tela. Se o
    // VR já guarda a estatística pronta, eu leio dela e o número passa a ser idêntico ao
    // dele por construção — em vez de "parecido", que é o pior resultado possível aqui.
    try{
      out.fonte={};
      const tb=(await c.query(
        "select table_schema s, table_name t from information_schema.tables "+
        "where table_schema in ('public','pdv') and table_type='BASE TABLE' "+
        "and (table_name like '%estatistic%' or table_name like '%indicador%' "+
        "  or table_name like '%resumomes%' or table_name like '%gerencial%' "+
        "  or table_name like '%movimentomes%' or table_name like '%fechamentomes%')")).rows;
      out.fonte.tabelas=[];
      for(const x of tb.slice(0,12)){
        const nome=x.s+"."+x.t;
        let n=null, cols=[];
        try{ n=(await c.query("select count(*)::int c from "+nome)).rows[0].c; }catch(e){}
        try{ cols=(await c.query("select column_name n from information_schema.columns "+
          "where table_schema=$1 and table_name=$2 order by ordinal_position",[x.s,x.t]))
          .rows.map(r=>r.n); }catch(e){}
        out.fonte.tabelas.push({ nome:nome, linhas:n, colunas:cols });
        console.log("  "+nome+"  linhas="+n);
      }

      // ---- as leituras da PERDA, mês a mês, para comparar com a lista dele ----
      out.fonte.perdaMes=(await c.query(`
        select to_char(date_trunc('month', pe.data),'YYYY-MM') mes,
               sum(pe.quantidade * coalesce(pe.custocomimposto,0))      compra,
               sum(pe.quantidade * coalesce(pe.customediocomimposto,0)) medio,
               sum(pe.quantidade * coalesce(pe.custosemimposto,0))      compra_sem,
               sum(pe.quantidade * coalesce(pe.customediosemimposto,0)) medio_sem,
               sum(pe.quantidade) qtd, count(*) linhas
          from public.perda pe
          join public.produto p on p.id = pe.id_produto
         where pe.id_loja = ${LOJA}
           and p.mercadologico1 = 43 and p.mercadologico2 = 1
           and pe.data >= '2026-01-01'
         group by 1 order by 1`)).rows;

      // ---- a QUEBRA, se existir, no mesmo recorte ----
      try{
        const qc=(await c.query("select column_name n from information_schema.columns "+
          "where table_schema='public' and table_name='quebra'")).rows.map(r=>r.n);
        out.fonte.quebraColunas=qc;
        const cVal=qc.find(x=>/custo|valor/i.test(x));
        const cQtd=qc.find(x=>/quantidade|qtd/i.test(x));
        if(cVal && cQtd){
          out.fonte.quebraMes=(await c.query(`
            select to_char(date_trunc('month', q.data),'YYYY-MM') mes,
                   sum(q.${cQtd} * coalesce(q.${cVal},0)) valor, sum(q.${cQtd}) qtd, count(*) linhas
              from public.quebra q
              join public.produto p on p.id = q.id_produto
             where p.mercadologico1 = 43 and p.mercadologico2 = 1
               and q.data >= '2026-01-01'
             group by 1 order by 1`)).rows;
        }
      }catch(e){ out.fonte.quebraErro=e.message; }

      console.log("\nPERDA mes a mes (FLV), nas quatro leituras de custo:");
      (out.fonte.perdaMes||[]).forEach(m=>console.log("  "+m.mes
        +"  compra="+n(m.compra).toFixed(2).padStart(11)
        +"  medio="+n(m.medio).toFixed(2).padStart(11)
        +"  qtd="+n(m.qtd).toFixed(1).padStart(9)+"  ("+m.linhas+" linhas)"));
    }catch(e){ out.fonte={ erro:e.message }; console.log("!! busca da fonte falhou: "+e.message); }

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
