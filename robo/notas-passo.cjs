// ============================================================================
// O XML DAS NOTAS DE ENTRADA — RODADA 2 (mira certa)
//
// A rodada 1 varreu o banco inteiro e achou a tabela: public.notaentradanfe, com
// 35.554 linhas e as colunas xml, chavenfe, importado, conferido, carregado,
// id_situacaomanifestacaonfe. Ou seja: o VR ja busca as notas na Receita e guarda o
// arquivo. Ela nao apareceu na lista da rodada 1 porque eu cortei nas 40 maiores.
//
// Esta rodada responde as perguntas que decidem o portal:
//   1. das 35 mil, quantas tem XML de VERDADE (e nao so a linha)?
//   2. continua enchendo hoje, ou parou em algum mes?
//   3. o XML chega ANTES da mercadoria? (se chegar, a conferencia de itens pode
//      acontecer antes do caminhao sair — e essa e a pergunta que vale dinheiro)
//   4. da pra amarrar a nota ao pedido de compra que ja esta na nuvem?
//
// ESTE ARQUIVO E O "PASSO DA VEZ" do notas.bat. O notas.bat chama SEMPRE este nome —
// assim ele nunca precisa mudar, e o Windows nunca reescreve o .bat no meio da
// execucao (ele le o .bat linha por linha enquanto roda).
//
// So LE o banco do VR. Nao escreve nada la.
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

// Morte silenciosa nao acontece mais aqui: o que matar o script fica registrado.
const out={ quando:new Date().toISOString(), etapa:"comecando", mortes:[] };
process.on("uncaughtException", e=>{ out.mortes.push("uncaught: "+e.message); });
process.on("unhandledRejection", e=>{ out.mortes.push("rejeicao: "+(e&&e.message||e)); });

(async()=>{
  let c=null;
  // uma pergunta por vez, cada uma com rede propria: uma que falha nao cala as outras
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

    // 1) tem XML de verdade dentro?
    out.panorama=await perg("panorama", `
      select count(*)::int total,
             count(*) filter (where xml is not null and length(xml) > 500)::int com_xml,
             count(*) filter (where xml is not null and position('<det' in xml) > 0)::int com_itens,
             count(*) filter (where chavenfe is not null and length(chavenfe::text) >= 44)::int com_chave,
             min(dataentrada)::text desde, max(dataentrada)::text ate
        from public.notaentradanfe`);

    // 2) e de qual loja? (so a LOJA 01 nos interessa)
    out.por_loja=await perg("por_loja", `
      select id_loja, count(*)::int qtd,
             count(*) filter (where xml is not null and length(xml) > 500)::int com_xml
        from public.notaentradanfe group by 1 order by 2 desc`);

    // 3) continua enchendo hoje, ou parou?
    out.por_mes=await perg("por_mes", `
      select to_char(dataentrada,'YYYY-MM') mes, count(*)::int qtd,
             count(*) filter (where xml is not null and length(xml) > 500)::int com_xml
        from public.notaentradanfe
       where dataentrada >= (current_date - interval '14 months')
       group by 1 order by 1 desc`);

    // 4) A PERGUNTA QUE VALE DINHEIRO: o XML chega antes da mercadoria?
    //    Se a Receita entrega a nota antes do caminhao encostar, a conferencia de itens
    //    pode ser feita ANTES de o fornecedor sair — que e o que o Victor quer.
    out.chega_antes=await perg("chega_antes", `
      select count(*)::int total,
             count(*) filter (where datahorarecebimento::date <  dataentrada)::int antes,
             count(*) filter (where datahorarecebimento::date =  dataentrada)::int mesmo_dia,
             count(*) filter (where datahorarecebimento::date >  dataentrada)::int depois,
             round(avg(extract(epoch from (dataentrada::timestamp - datahorarecebimento))/3600)::numeric,1) horas_de_folga
        from public.notaentradanfe
       where datahorarecebimento is not null and dataentrada is not null
         and dataentrada >= (current_date - interval '6 months')`);

    // 5) o que significam as situacoes (numero -> palavra)
    out.situacaonfe=await perg("situacaonfe", "select id, descricao from public.situacaonfe order by id");
    out.situacaomanifestacao=await perg("situacaomanifestacao",
      "select id, descricao from public.situacaomanifestacaonfe order by id");
    out.situacoes_usadas=await perg("situacoes_usadas", `
      select id_situacaonfe, id_situacaomanifestacaonfe, count(*)::int qtd
        from public.notaentradanfe
       where dataentrada >= (current_date - interval '6 months')
       group by 1,2 order by 3 desc limit 20`);

    // 6) da pra amarrar ao pedido de compra? (o portal ja tem os pedidos na nuvem)
    out.com_pedido=await perg("com_pedido", `
      select count(*)::int notas,
             count(*) filter (where p.id is not null)::int com_pedido
        from public.notaentradanfe nfe
        left join public.notaentrada ne
               on ne.numeronota = nfe.numeronota
              and ne.id_fornecedor = nfe.id_fornecedor
              and ne.id_loja = nfe.id_loja
        left join public.notaentradapedido p on p.id_notaentrada = ne.id
       where nfe.dataentrada >= (current_date - interval '3 months')`);

    // 7) quantas chaves ja manifestadas (a Receita avisando que existe nota pra loja)
    out.manifestacao=await perg("manifestacao",
      "select count(*)::int chaves from public.notaentradanfechavemanifestacao");

    // 8) uma nota recente de verdade, pra eu ver o formato com meus olhos
    const am=await perg("amostra", `
      select numeronota, chavenfe::text chave, id_fornecedor, id_loja,
             dataentrada::text entrada, datahorarecebimento::text recebido,
             importado, conferido, carregado,
             id_situacaonfe, id_situacaomanifestacaonfe,
             length(xml)::int tamanho, left(xml, 700) inicio
        from public.notaentradanfe
       where xml is not null and length(xml) > 500
       order by dataentrada desc, id desc limit 2`);
    if(am) out.amostra=am;

    // 9) quantos itens vem dentro de uma nota (media) — isso dimensiona a tela de conferencia
    out.itens_por_nota=await perg("itens_por_nota", `
      select round(avg(qtd)::numeric,1) media, max(qtd)::int maior, count(*)::int notas
        from (select (length(xml) - length(replace(xml,'<det','')))/4 qtd
                from public.notaentradanfe
               where xml is not null and length(xml) > 500
                 and dataentrada >= (current_date - interval '3 months')) t`);

    out.etapa="terminou";
  }catch(e){
    out.erro=e.message; out.onde=(e.stack||"").split("\n").slice(0,3).join(" | ");
    console.log("!! "+e.message);
  }
  try{ if(c) await c.end(); }catch(e){}

  // ------------------------------------------------------------------ relatorio
  // Uma rede POR SECAO. Na rodada 1 uma rede unica deixou cair justamente a secao final,
  // que era a resposta. Nao repito.
  const secao=(titulo,fn)=>{ console.log("\n=== "+titulo+" ===");
    try{ fn(); }catch(e){ console.log("  (esta secao falhou: "+e.message+")"); } };
  const linha=(o)=>{ try{ return JSON.stringify(o); }catch(e){ return "(ilegivel)"; } };

  secao("TEM XML DE VERDADE?", ()=>{ (out.panorama||[]).forEach(r=>console.log("  "+linha(r))); });
  secao("POR LOJA", ()=>{ (out.por_loja||[]).forEach(r=>console.log("  "+linha(r))); });
  secao("MES A MES (continua enchendo?)", ()=>{ (out.por_mes||[]).forEach(r=>console.log("  "+linha(r))); });
  secao("O XML CHEGA ANTES DA MERCADORIA?", ()=>{ (out.chega_antes||[]).forEach(r=>console.log("  "+linha(r))); });
  secao("SITUACOES", ()=>{
    console.log("  nfe:          "+linha(out.situacaonfe));
    console.log("  manifestacao: "+linha(out.situacaomanifestacao));
    console.log("  usadas:       "+linha(out.situacoes_usadas));
  });
  secao("AMARRA COM O PEDIDO?", ()=>{ (out.com_pedido||[]).forEach(r=>console.log("  "+linha(r))); });
  secao("CHAVES MANIFESTADAS", ()=>{ (out.manifestacao||[]).forEach(r=>console.log("  "+linha(r))); });
  secao("ITENS POR NOTA", ()=>{ (out.itens_por_nota||[]).forEach(r=>console.log("  "+linha(r))); });
  secao("AMOSTRA", ()=>{ (out.amostra||[]).forEach(r=>{
    const {inicio, ...resto}=r;
    console.log("  "+linha(resto));
    console.log("  inicio do xml: "+String(inicio||"").replace(/\s+/g," ").slice(0,700));
  }); });
  secao("ERROS", ()=>{
    const es=Object.keys(out).filter(k=>k.indexOf("erro")===0);
    console.log(es.length? es.map(k=>"  "+k+": "+out[k]).join("\n") : "  nenhum");
    if(out.mortes && out.mortes.length) console.log("  mortes: "+linha(out.mortes));
  });

  try{
    // entidade_id e uuid; receb_eventos.id e NUMERO. Ver o tombo da rodada 1.
    const loc=await req("GET","/rest/v1/receb_locais?select=id&order=criado_em&limit=1");
    await req("POST","/rest/v1/receb_eventos",[{ entidade:"vr_notas2",
      entidade_id:(loc&&loc[0]&&loc[0].id)||"00000000-0000-0000-0000-000000000000",
      acao:"descoberta", motivo:"rodada 2: dentro da notaentradanfe", detalhe:out }],"return=minimal");
    console.log("\n>>> relatorio enviado para a nuvem.");
  }catch(e){ console.log("!! nao consegui mandar: "+e.message); }
})();
