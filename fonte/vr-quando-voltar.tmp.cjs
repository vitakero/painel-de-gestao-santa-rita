// Espera o VR responder e, assim que responder, faz TUDO o que ficou pendente numa tacada:
//  1) a conferencia dia a dia do que esta publicado contra o VR (1.277 dias, campo por campo)
//  2) os produtos de cada grupo de desconto, para completar a previa
//  3) o volume por grupo na janela de 13 meses, que e o que decide o tamanho na nuvem
require("dotenv").config();
const fs=require("fs"), {Client}=require("pg");
const src=fs.readFileSync("scripts/buildVrData.cjs","utf8");
const cru=src.split("/* ==FCXSQL-INICIO==")[1].split("/* ==FCXSQL-FIM== */")[0];
const mod={}; new Function("module","exports",cru.slice(cru.indexOf("*/")+2)+"\nmodule.exports={fcxSqlDia,fcxMontaDia};")(mod,{});
const {fcxSqlDia,fcxMontaDia}=mod.exports;
const brl=n=>Number(n||0).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
const esp=ms=>new Promise(r=>setTimeout(r,ms));
const CAMPOS=["ce","cev","cc","ccv","cp","cpv","cq","cqv","cn","cnv","dn","dv","da","ds","dal","gan","gav","gcn","gcv","gon","gov","gxn","gxv"];
const novo=()=>new Client({host:process.env.PG_HOST,port:+process.env.PG_PORT,database:process.env.PG_DATABASE,
  user:process.env.PG_USER,password:process.env.PG_PASSWORD,connectionTimeoutMillis:12000,query_timeout:200000});

(async()=>{
  // --- 1) esperar o VR (ate 3h, batendo de 90 em 90 s) ---
  let c=null; const limite=Date.now()+180*60*1000;
  while(!c && Date.now()<limite){
    const t=novo();
    try{ await t.connect(); await t.query("select 1"); c=t; }
    catch(e){ try{ await t.end(); }catch(e2){} process.stdout.write("."); await esp(90000); }
  }
  if(!c){ console.log("\n>>> o VR nao voltou em 3h."); process.exit(2); }
  console.log("\n=== VR RESPONDEU "+new Date().toLocaleTimeString("pt-BR")+" ===");
  await c.query("SET statement_timeout='190s'");

  // --- 2) baixar o que esta publicado ---
  const html=await (await fetch("https://painel-de-gestao-santa-rita.vercel.app/?v="+Date.now())).text();
  const AR=JSON.parse(html.match(/FCX_DIA\s*=\s*(\[[\s\S]*?\]);/)[1]);
  console.log("publicado: "+AR.length+" dias\n");

  // --- 3) a consulta do robo, ano a ano (a base inteira de uma vez estoura em hora cheia) ---
  let linhas=[];
  for(const ano of [2023,2024,2025,2026]){
    for(let t=1;t<=3;t++){
      try{ const r=await c.query(fcxSqlDia(` AND i.data >= '${ano}-01-01' AND i.data < '${ano+1}-01-01'`));
           linhas=linhas.concat(r.rows); process.stdout.write(ano+" ok  "); break; }
      catch(e){ if(t===3){ console.log("\n"+ano+" nao respondeu: "+e.message); } else await esp(20000); }
    }
  }
  console.log("\n");
  const vr=fcxMontaDia(linhas, AR.map(x=>x.d));
  const pAr={}; AR.forEach(x=>pAr[x.d]=x);
  const pVr={}; vr.forEach(x=>pVr[x.d]=x);
  const todos=[...new Set(AR.map(x=>x.d).concat(vr.map(x=>x.d)))].sort();
  let iguais=0; const difs=[];
  for(const d of todos){
    const a=pAr[d], b=pVr[d];
    if(!a||!b){ difs.push([d, a?"so no publicado":"so no VR", ""]); continue; }
    const q=CAMPOS.filter(k=>Math.abs(Number(a[k]||0)-Number(b[k]||0))>=0.005)
                  .map(k=>k+": "+(a[k]||0)+" x "+(b[k]||0));
    q.length ? difs.push([d,"campo diferente",q.join(", ")]) : iguais++;
  }
  console.log("=== 1) CONFERENCIA DIA A DIA ===");
  console.log("  dias: "+todos.length+" | iguais: "+iguais+" | diferentes: "+difs.length);
  for(const [d,m,q] of difs.slice(0,20)) console.log("   "+d+"  "+m+"  "+q);

  // --- 4) produtos por grupo, setembro (para completar a previa) ---
  const GRUPO=`CASE WHEN COALESCE(i.descontomanual,0)=1 AND COALESCE(i.valordescontomanual,0)<>0 THEN 'manual'
                    WHEN COALESCE(i.atacado,false) THEN 'atacado'
                    WHEN COALESCE(i.oferta,false) THEN 'oferta'
                    WHEN COALESCE(i.aplicadescontopromocao,false) THEN 'campanha'
                    ELSE 'naoclass' END`;
  const VALOR=`CASE WHEN COALESCE(i.descontomanual,0)=1 AND COALESCE(i.valordescontomanual,0)<>0
                    THEN i.valordescontomanual ELSE i.valordesconto END`;
  console.log("\n=== 2) PRODUTOS POR GRUPO (01 a 22/09/2026) ===");
  const prod={};
  for(const g of ["manual","atacado","oferta","campanha"]){
    try{
      const r=await c.query(`
        SELECT left(COALESCE(p.descricaocompleta,'?'),42) prod, COUNT(*) n, COALESCE(SUM(${VALOR}),0) s
          FROM pdv.vendaitem i LEFT JOIN public.produto p ON p.id=i.id_produto
         WHERE i.data >= '2026-09-01' AND i.data < '2026-09-23'
           AND (COALESCE(i.valordesconto,0)<>0 OR COALESCE(i.valordescontomanual,0)<>0)
           AND ${GRUPO} = '${g}'
         GROUP BY 1 ORDER BY s DESC LIMIT 25`);
      prod[g]=r.rows.map(x=>[x.prod.trim(), Number(x.n), Math.round(Number(x.s)*100)/100]);
      console.log("  "+g+": "+r.rows.length+" produtos");
      for(const x of r.rows.slice(0,5)) console.log("     "+x.prod.trim().padEnd(43)+String(x.n).padStart(5)+"x  R$ "+brl(x.s).padStart(9));
    }catch(e){ console.log("  "+g+": erro "+e.message.slice(0,60)); }
  }

  // --- 5) volume de 13 meses por grupo (decide o tamanho na nuvem) ---
  console.log("\n=== 3) VOLUME DE 13 MESES POR GRUPO (o que iria pra nuvem) ===");
  try{
    const r=await c.query(`
      SELECT ${GRUPO} g, COUNT(*) n, COUNT(DISTINCT i.id_produto) prods, COALESCE(SUM(${VALOR}),0) s
        FROM pdv.vendaitem i
       WHERE i.data >= CURRENT_DATE - INTERVAL '13 months'
         AND (COALESCE(i.valordesconto,0)<>0 OR COALESCE(i.valordescontomanual,0)<>0)
       GROUP BY 1 ORDER BY n DESC`);
    let tot=0;
    for(const x of r.rows){ tot+=Number(x.n);
      console.log("  "+String(x.g).padEnd(10)+String(x.n).padStart(8)+" ocorrencias | "+
                  String(x.prods).padStart(5)+" produtos distintos | R$ "+brl(x.s).padStart(12)); }
    console.log("  TOTAL     "+String(tot).padStart(8)+" ocorrencias  (a tabela na nuvem tem 84.331 hoje)");
  }catch(e){ console.log("  erro: "+e.message.slice(0,80)); }

  fs.writeFileSync("/tmp/vr-produtos.json", JSON.stringify(prod));
  await c.end();
  console.log("\n>>> pronto. produtos salvos em /tmp/vr-produtos.json");
  process.exit(difs.length?1:0);
})().catch(e=>{ console.log("ERRO: "+e.message); process.exit(1); });
