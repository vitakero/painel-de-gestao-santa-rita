// ============================================================================
// O VR JÁ GUARDA O XML DAS NOTAS DE ENTRADA?
//
// Pergunta do Victor em 20/08/2026: se a loja é dele e o certificado digital já
// está no VR (que emite as notas), dá para puxar o XML direto em vez de depender
// do fornecedor mandar. Muitos sistemas de supermercado já fazem a manifestação do
// destinatário e guardam o XML completo no próprio banco. Se for o caso, o robô só
// precisa LER — sem certificado, sem serviço da Receita, sem nada novo.
//
// Este script só PERGUNTA. Não escreve nada no VR.
//
// Lições das descobertas anteriores, aplicadas aqui:
//   * o relatório sai SEMPRE, inclusive quando dá errado — script que morre calado
//     na loja não deixa rastro e a janela do robô fecha junto;
//   * nada de laço de "select count(*)" tabela por tabela: uso a estimativa do
//     próprio Postgres, que é instantânea;
//   * c.query(texto, [valores]) — com ARRAY. Passar solto derruba de dentro do driver.
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

(async()=>{
  const out={ quando:new Date().toISOString(), etapa:"comecando" };
  let c=null;
  try{
    if(!SB_KEY) throw new Error("Falta SUPABASE_SERVICE_KEY no .env");
    if(!g("PG_HOST")) throw new Error("Falta o .env do VR (rode na pasta do robo)");
    c=new Client({ host:g("PG_HOST"), port:+g("PG_PORT"), database:g("PG_DATABASE"),
      user:g("PG_USER"), password:g("PG_PASSWORD"), ssl:false, connectionTimeoutMillis:20000 });
    c.on("error", e=>{ out.erro_conexao=e.message; });
    await c.connect();
    try{ await c.query("set statement_timeout = 180000"); }catch(e){}

    // ---- 1) ONDE MORA XML: qualquer coluna com "xml" no nome, no banco inteiro ----
    out.etapa="colunas de xml";
    out.colunas_xml=(await c.query(`
      select n.nspname esquema, cl.relname tabela, a.attname coluna,
             format_type(a.atttypid, a.atttypmod) tipo,
             greatest(cl.reltuples,0)::bigint linhas
        from pg_attribute a
        join pg_class cl on cl.oid = a.attrelid
        join pg_namespace n on n.oid = cl.relnamespace
       where cl.relkind='r' and a.attnum>0 and not a.attisdropped
         and n.nspname in ('public','pdv','escrita','fiscal')
         and a.attname ilike '%xml%'
       order by linhas desc limit 40`)).rows;

    // ---- 2) TABELAS COM CARA DE NOTA DE ENTRADA ----
    out.etapa="tabelas de nota";
    out.tabelas=(await c.query(`
      select n.nspname esquema, cl.relname tabela,
             greatest(cl.reltuples,0)::bigint linhas,
             array_agg(a.attname order by a.attnum) colunas
        from pg_class cl
        join pg_namespace n on n.oid = cl.relnamespace
        join pg_attribute a on a.attrelid = cl.oid and a.attnum>0 and not a.attisdropped
       where cl.relkind='r'
         and n.nspname in ('public','pdv','escrita','fiscal')
         and (cl.relname ilike '%notaentrada%' or cl.relname ilike '%nfe%'
           or cl.relname ilike '%dfe%' or cl.relname ilike '%manifest%'
           or cl.relname ilike '%distribui%' or cl.relname ilike '%danfe%')
       group by 1,2,3
       order by 3 desc limit 40`)).rows;

    // ---- 3) ONDE ESTÁ A CHAVE DE 44 DÍGITOS ----
    out.etapa="colunas de chave";
    out.colunas_chave=(await c.query(`
      select n.nspname esquema, cl.relname tabela, a.attname coluna,
             greatest(cl.reltuples,0)::bigint linhas
        from pg_attribute a
        join pg_class cl on cl.oid = a.attrelid
        join pg_namespace n on n.oid = cl.relnamespace
       where cl.relkind='r' and a.attnum>0 and not a.attisdropped
         and n.nspname in ('public','pdv','escrita','fiscal')
         and (a.attname ilike '%chave%' or a.attname ilike '%chaveacesso%')
       order by linhas desc limit 30`)).rows;

    // ---- 4) O TESTE QUE VALE: tem XML de verdade lá dentro? ----
    // Para cada coluna de xml em tabela com linhas, conto quantas estão preenchidas,
    // pego a data mais recente e espio o começo de um para ver se é nota de verdade.
    out.etapa="conteudo do xml";
    out.amostras=[];
    for(const x of (out.colunas_xml||[]).slice(0,12)){
      if(!x.linhas) continue;
      const nome = x.esquema+"."+x.tabela;
      const item = { tabela:nome, coluna:x.coluna, tipo:x.tipo };
      try{
        const r=(await c.query(
          "select count(*)::int total, count(*) filter (where length("+x.coluna+"::text) > 500)::int com_xml "+
          "from "+nome)).rows[0];
        item.total=r.total; item.com_xml=r.com_xml;
        if(r.com_xml>0){
          const a=(await c.query(
            "select left("+x.coluna+"::text, 300) inicio from "+nome+
            " where length("+x.coluna+"::text) > 500 limit 1")).rows[0];
          item.inicio = a ? a.inicio : null;
          item.parece_nfe = !!(a && (a.inicio.indexOf("nfeProc")>=0 || a.inicio.indexOf("infNFe")>=0));
          // tem item dentro? procuro a marca <det ou <prod
          const d=(await c.query(
            "select count(*)::int c from "+nome+" where position('<det' in "+x.coluna+"::text) > 0")).rows[0];
          item.com_itens = d.c;
        }
      }catch(e){ item.erro=e.message; }
      out.amostras.push(item);
    }

    out.etapa="terminou";
  }catch(e){
    out.erro=e.message; out.onde=(e.stack||"").split("\n").slice(0,3).join(" | ");
    console.log("!! "+e.message);
  }
  try{ if(c) await c.end(); }catch(e){}

  /* RELATORIO BLINDADO.
     Campo que não veio derruba o padEnd e mata o script ANTES de mandar o resultado —
     que é exatamente a morte silenciosa que já me custou duas rodadas na loja. Tudo
     abaixo passa por txt() e o bloco inteiro tem rede embaixo. */
  const txt=(v,n)=>String(v==null?"":v).padEnd(n||0);
  const num=(v,n)=>String(v==null?"?":v).padStart(n||0);
  // Uma rede POR SECAO. Na primeira rodada eu pus uma rede so em volta das quatro: a
  // segunda secao tropecou na primeira linha e levou as duas ultimas junto — e a ultima
  // ("TEM XML DE VERDADE?") era justamente a resposta que eu queria.
  const lista=(v)=>Array.isArray(v)?v.join(","):String(v==null?"":v);
  const secao=(titulo,fn)=>{
    console.log("\n=== "+titulo+" ===");
    try{ fn(); }catch(e){ console.log("  (esta secao falhou: "+e.message+")"); }
  };
  secao("COLUNAS COM XML NO NOME",()=>{
    (out.colunas_xml||[]).forEach(x=>console.log("  "+txt(x.esquema+"."+x.tabela+"."+x.coluna,52)
      +txt(x.tipo,14)+num(x.linhas,10)+" linhas"));
  });
  secao("TABELAS COM CARA DE NOTA DE ENTRADA",()=>{
    (out.tabelas||[]).forEach(t=>{
      // uma linha ruim nao pode calar as outras
      try{
        console.log("  "+txt(t.esquema+"."+t.tabela,40)+num(t.linhas,10)+" linhas");
        console.log("      "+lista(t.colunas).slice(0,300));
      }catch(e){ console.log("  (linha ilegivel: "+e.message+")"); }
    });
  });
  secao("ONDE ESTA A CHAVE DE 44 DIGITOS",()=>{
    (out.colunas_chave||[]).forEach(x=>console.log("  "+txt(x.esquema+"."+x.tabela+"."+x.coluna,52)
      +num(x.linhas,10)+" linhas"));
  });
  secao("TEM XML DE VERDADE?",()=>{
    (out.amostras||[]).forEach(a=>console.log("  "+txt(a.tabela+"."+a.coluna,52)
      +(a.erro?("ERRO "+a.erro):("total="+num(a.total)+"  com_xml="+num(a.com_xml)
        +"  com_itens="+num(a.com_itens)+"  parece_nfe="+a.parece_nfe))));
  });

  try{
    // entidade_id e uuid. receb_eventos.id e NUMERO (1, 111...) — peguei o balde errado
    // na primeira rodada e o banco recusou com 22P02 depois de 4 minutos de trabalho.
    // receb_locais.id e uuid de verdade, que e o mesmo que o detetive das perdas usa.
    const loc=await req("GET","/rest/v1/receb_locais?select=id&order=criado_em&limit=1");
    await req("POST","/rest/v1/receb_eventos",[{ entidade:"vr_notas",
      entidade_id:(loc&&loc[0]&&loc[0].id)||"00000000-0000-0000-0000-000000000000",
      acao:"descoberta", detalhe:out }],"return=minimal");
    console.log("\n>>> relatorio enviado para a nuvem.");
  }catch(e){ console.log("!! nao consegui mandar: "+e.message); }
})();
