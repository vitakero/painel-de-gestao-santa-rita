// ============================================================================
// O DE-PARA DO CODIGO DO FORNECEDOR — RODADA 3
//
// O problema, medido em 3.480 notas reais (27.584 itens):
//   6.408 itens (23,2%) nao tem NENHUM jeito de casar com o pedido de compra —
//   nem codigo de barras, nem a linha do pedido dentro da nota.
//   Desses, 6.021 (94%) usam um codigo de fornecedor que JA apareceu em outra nota.
//
// Ou seja: a loja ja recebeu aquele produto daquele fornecedor antes, e alguem ja
// disse qual produto do cadastro ele e. Se eu achar onde o VR guarda isso, o ponto
// cego cai de 23,2% para 1,4%.
//
// O que procuro, em ordem de aposta:
//   1. Uma tabela de-para pronta (produtofornecedor, codigoexterno, referencia...).
//      A rodada 1 ja viu uma coluna "codigoexterno" por ai — bom sinal.
//   2. O historico: notaentradaitemimportacaoxml tem 267.897 linhas e cheira a
//      "o que veio no XML de cada item". Se ela guardar o codigo do fornecedor ao
//      lado do id_produto da loja, o de-para se monta sozinho das 35 mil notas.
//   3. Qualquer tabela que ligue produto e fornecedor.
//
// SO LE o banco do VR. Nao muda nada la.
//
// Este e o "passo da vez" do notas.bat — ele chama sempre este nome de arquivo.
// ============================================================================
const fs=require("fs"), path=require("path"), https=require("https"), { Client }=require("pg");
function env(){ for(const p of [path.join(__dirname,"..",".env"),".env","../.env"]){
  try{ return fs.readFileSync(p,"utf8"); }catch(e){} } return ""; }
const E=env(), g=(k)=>{ const m=E.match(new RegExp("^"+k+"=(.*)$","m")); return m?m[1].trim():""; };
const SB_HOST="uabhsmculsfwzcrhyhch.supabase.co", SB_KEY=g("SUPABASE_SERVICE_KEY");

function req(metodo, caminho, corpo, prefer){
  return new Promise((res,rej)=>{
    const d=corpo?JSON.stringify(corpo):null;
    const h={apikey:SB_KEY,Authorization:"Bearer "+SB_KEY,"Content-Type":"application/json"};
    if(prefer) h.Prefer=prefer;
    if(d) h["Content-Length"]=Buffer.byteLength(d);
    const r=https.request({host:SB_HOST,path:caminho,method:metodo,headers:h},(resp)=>{
      let b=""; resp.on("data",c=>b+=c);
      resp.on("end",()=>resp.statusCode<300?res(b?JSON.parse(b):null)
        :rej(new Error("HTTP "+resp.statusCode+" "+b.slice(0,200))));
    });
    r.on("error",rej); if(d) r.write(d); r.end();
  });
}

const out={ quando:new Date().toISOString(), etapa:"comecando", mortes:[] };
process.on("uncaughtException", e=>{ out.mortes.push("uncaught: "+e.message); });
process.on("unhandledRejection", e=>{ out.mortes.push("rejeicao: "+(e&&e.message||e)); });

(async()=>{
  let c=null;
  const perg=async(nome, sql, params)=>{
    out.etapa=nome;
    try{ return (await c.query(sql, params||[])).rows; }
    catch(e){ out["erro_"+nome]=e.message; return null; }
  };

  try{
    if(!SB_KEY) throw new Error("Falta SUPABASE_SERVICE_KEY no .env");
    if(!g("PG_HOST")) throw new Error("Falta o .env do VR (rode na pasta do robo)");
    c=new Client({ host:g("PG_HOST"), port:+g("PG_PORT"), database:g("PG_DATABASE"),
      user:g("PG_USER"), password:g("PG_PASSWORD"), ssl:false, connectionTimeoutMillis:20000 });
    c.on("error", e=>{ out.erro_conexao=e.message; });
    await c.connect();
    try{ await c.query("set statement_timeout = 240000"); }catch(e){}

    // 1) COLUNAS COM CARA DE "CODIGO DO FORNECEDOR"
    out.colunas=await perg("colunas", `
      select n.nspname esquema, cl.relname tabela, a.attname coluna,
             format_type(a.atttypid, a.atttypmod) tipo,
             greatest(cl.reltuples,0)::bigint linhas
        from pg_attribute a
        join pg_class cl on cl.oid = a.attrelid
        join pg_namespace n on n.oid = cl.relnamespace
       where cl.relkind='r' and a.attnum>0 and not a.attisdropped
         and n.nspname = 'public'
         and (a.attname ilike '%codigoexterno%' or a.attname ilike '%codexterno%'
              or a.attname ilike '%codigofornec%' or a.attname ilike '%codforn%'
              or a.attname ilike '%referencia%'   or a.attname ilike '%codigofabric%'
              or a.attname ilike '%codigoprodutofornec%')
       order by linhas desc limit 40`);

    // 2) TABELAS QUE LIGAM PRODUTO E FORNECEDOR
    out.tabelas=await perg("tabelas", `
      select n.nspname esquema, cl.relname tabela,
             greatest(cl.reltuples,0)::bigint linhas,
             (select string_agg(a.attname, ',' order by a.attnum)
                from pg_attribute a
               where a.attrelid = cl.oid and a.attnum > 0 and not a.attisdropped) colunas
        from pg_class cl join pg_namespace n on n.oid = cl.relnamespace
       where cl.relkind='r' and n.nspname='public'
         and (cl.relname ~ 'produto.*fornec' or cl.relname ~ 'fornec.*produto'
              or cl.relname ~ 'produtoexterno' or cl.relname ~ 'codigoexterno'
              or cl.relname ~ 'referenciaproduto')
       order by linhas desc limit 30`);

    // 3) AS TABELAS QUE MAIS PROMETEM, COLUNA POR COLUNA
    out.detalhe={};
    for(const t of ["notaentradaitem","notaentradaitemimportacaoxml","produto"]){
      out.detalhe[t]=await perg("colunas_"+t, `
        select a.attname coluna, format_type(a.atttypid, a.atttypmod) tipo
          from pg_attribute a join pg_class cl on cl.oid=a.attrelid
          join pg_namespace n on n.oid=cl.relnamespace
         where n.nspname='public' and cl.relname=$1
           and a.attnum>0 and not a.attisdropped
         order by a.attnum`, [t]);
    }

    // 4) O HISTORICO SERVE? O que liga item de nota a produto da loja.
    out.amostra_item=await perg("amostra_item", `
      select i.id, i.id_notaentrada, i.id_produto, i.quantidade, i.descricaoxml
        from public.notaentradaitem i
       where i.id_produto is not null
       order by i.id desc limit 3`);

    // 5) E o xml de importacao guarda o codigo do fornecedor?
    out.amostra_xml=await perg("amostra_xml", `
      select * from public.notaentradaitemimportacaoxml order by id desc limit 2`);

    // 6) Quantos produtos do cadastro tem codigo externo preenchido?
    out.tem_externo=await perg("tem_externo", `
      select count(*)::int total,
             count(*) filter (where nullif(trim(coalesce(codigoexterno::text,'')),'') is not null)::int com_externo
        from public.produto`);

    out.etapa="terminou";
  }catch(e){
    out.erro=e.message; out.onde=(e.stack||"").split("\n").slice(0,3).join(" | ");
    console.log("!! "+e.message);
  }
  try{ if(c) await c.end(); }catch(e){}

  const secao=(titulo,fn)=>{ console.log("\n=== "+titulo+" ===");
    try{ fn(); }catch(e){ console.log("  (esta secao falhou: "+e.message+")"); } };
  const linha=(o)=>{ try{ return JSON.stringify(o); }catch(e){ return "(ilegivel)"; } };

  secao("COLUNAS COM CARA DE CODIGO DO FORNECEDOR", ()=>{
    (out.colunas||[]).forEach(x=>console.log("  "+x.esquema+"."+x.tabela+"."+x.coluna+
      "  ["+x.tipo+"]  "+x.linhas+" linhas"));
    if(!(out.colunas||[]).length) console.log("  (nenhuma)");
  });
  secao("TABELAS QUE LIGAM PRODUTO E FORNECEDOR", ()=>{
    (out.tabelas||[]).forEach(t=>{
      console.log("  "+t.esquema+"."+t.tabela+"  "+t.linhas+" linhas");
      console.log("      "+String(t.colunas||"").slice(0,400));
    });
    if(!(out.tabelas||[]).length) console.log("  (nenhuma)");
  });
  secao("COLUNAS DAS TABELAS QUE PROMETEM", ()=>{
    Object.keys(out.detalhe||{}).forEach(t=>{
      const cs=(out.detalhe[t]||[]).map(x=>x.coluna).join(",");
      console.log("  "+t+": "+(cs||"(nao existe)").slice(0,600));
    });
  });
  secao("O HISTORICO LIGA ITEM DE NOTA A PRODUTO DA LOJA?", ()=>{
    (out.amostra_item||[]).forEach(r=>console.log("  "+linha(r)));
  });
  secao("O QUE O XML DE IMPORTACAO GUARDA", ()=>{
    (out.amostra_xml||[]).forEach(r=>console.log("  "+linha(r).slice(0,700)));
  });
  secao("PRODUTOS COM CODIGO EXTERNO PREENCHIDO", ()=>{
    (out.tem_externo||[]).forEach(r=>console.log("  "+linha(r)));
  });
  secao("ERROS", ()=>{
    const es=Object.keys(out).filter(k=>k.indexOf("erro")===0);
    console.log(es.length? es.map(k=>"  "+k+": "+out[k]).join("\n") : "  nenhum");
    if(out.mortes && out.mortes.length) console.log("  mortes: "+linha(out.mortes));
  });

  try{
    const loc=await req("GET","/rest/v1/receb_locais?select=id&order=criado_em&limit=1");
    await req("POST","/rest/v1/receb_eventos",[{ entidade:"vr_notas2",
      entidade_id:(loc&&loc[0]&&loc[0].id)||"00000000-0000-0000-0000-000000000000",
      acao:"descoberta", motivo:"rodada 3: o de-para do codigo do fornecedor", detalhe:out }],
      "return=minimal");
    console.log("\n>>> relatorio enviado para a nuvem.");
  }catch(e){ console.log("!! nao consegui mandar: "+e.message); }
})();
