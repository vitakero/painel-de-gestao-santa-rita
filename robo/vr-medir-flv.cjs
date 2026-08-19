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
    const vendas=(await c.query(`
      select to_char(date_trunc('month', v.data),'YYYY-MM') mes,
             sum(v.valortotal)                          bruto,
             sum(coalesce(v.valordesconto,0))           desc_item,
             sum(coalesce(v.valordescontocupom,0))      desc_cupom,
             sum(coalesce(v.valordescontopromocao,0))   desc_promo,
             sum(coalesce(v.valoracrescimo,0))          acrescimo,
             sum(v.quantidade)                          qtd
        from pdv.vendaitem v
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
    out.perdaDias=(await c.query(`
      select pe.data::text dia, count(*) linhas, sum(pe.quantidade) qtd
        from public.perda pe
        join public.produto p on p.id = pe.id_produto
       where pe.id_loja = ${LOJA}
         and p.mercadologico1 = 43 and p.mercadologico2 = 1
         and pe.data >= date_trunc('month', current_date) - interval '4 months'
       group by 1 order by 1`)).rows
      .map(r=>({ dia:r.dia, linhas:+r.linhas, qtd:n(r.qtd) }));

    const mp={};
    vendas.forEach(v=>{ mp[v.mes]=mp[v.mes]||{mes:v.mes}; Object.assign(mp[v.mes],{
      venda_bruta:n(v.bruto), desc_item:n(v.desc_item), desc_cupom:n(v.desc_cupom),
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
