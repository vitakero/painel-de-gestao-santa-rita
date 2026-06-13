// Lê o PostgreSQL do VR e gera output/vr-data.json com TODOS os resumos
// (por dia, hora, setor, pagamento, operador, ranking de produtos).
// Rodar DE DENTRO da rede da loja: node scripts/buildVrData.cjs
const fs=require("fs");
const path=require("path");
const { Client }=require("pg");
const env=fs.readFileSync(path.join(__dirname,"..",".env"),"utf8");
const get=k=>{const m=env.match(new RegExp("^"+k+"=(.*)$","m"));return m?m[1].trim():"";};
const cfg={ host:get("PG_HOST"), port:+get("PG_PORT"), database:get("PG_DATABASE"), user:get("PG_USER"), password:get("PG_PASSWORD"), connectionTimeoutMillis:20000, query_timeout:240000 };

const d10=v=> (v instanceof Date) ? v.toISOString().slice(0,10) : String(v).slice(0,10);
const num=v=> Math.round(Number(v||0)*100)/100;

async function timed(c,nome,sql,params){
  const t=Date.now();
  const r=await c.query(sql,params||[]);
  console.log("  ["+((Date.now()-t)/1000).toFixed(1)+"s] "+nome+": "+r.rowCount+" linhas");
  return r.rows;
}

(async()=>{
  const c=new Client(cfg); await c.connect();
  console.log("Conectado. Gerando resumos (pode levar ~2-3 min)...\n");

  // ---- dicionarios (nomes) ----
  const setorMap={}; // mercadologico1 -> nome do setor (nivel 1)
  (await timed(c,"setores",`SELECT mercadologico1 m, descricao FROM public.mercadologico WHERE nivel=1`))
    .forEach(r=>setorMap[r.m]=(r.descricao||"").trim()||("Setor "+r.m));
  const opMap={}; // matricula -> nome
  (await timed(c,"operadores",`SELECT matricula, nome FROM pdv.operador`))
    .forEach(r=>opMap[r.matricula]=(r.nome||"").trim()||("Op "+r.matricula));
  const pagMap={}; // id_finalizadora -> nome
  (await timed(c,"finalizadoras",`SELECT id, descricao FROM pdv.finalizadora`))
    .forEach(r=>pagMap[r.id]=(r.descricao||"").trim()||("Forma "+r.id));

  // ---- DIA: faturamento (cupom, = VR Venda Liquida) + margem/qtd (itens) + cupons ----
  // Faturamento pelo TOTAL DO CUPOM (subtotalimpressora), igual ao que o VR mostra como
  // "Venda Liquida" e ao que os graficos de hora/operador ja usam. (Antes somava item a
  // item com vendaitem.valortotal, o que contava itens de cupons cancelados e nao abatia
  // descontos -> dava ~R$657 a mais que o VR.)
  const diaFat=await timed(c,"DIA faturamento (cupom)",`
    SELECT data, SUM(subtotalimpressora) fat FROM pdv.venda WHERE cancelado=false GROUP BY data`);
  const fatByDia={}; diaFat.forEach(r=>fatByDia[d10(r.data)]=num(r.fat));
  const diaIt=await timed(c,"DIA itens (margem/qtd)",`
    SELECT data,
           SUM(valortotal - COALESCE(customediosemimposto,0)*quantidade) marg,
           SUM(quantidade) qtd
    FROM pdv.vendaitem WHERE cancelado=false GROUP BY data`);
  const diaCup=await timed(c,"DIA cupons",`
    SELECT data, COUNT(*) cup FROM pdv.venda WHERE cancelado=false GROUP BY data`);
  const cupByDia={}; diaCup.forEach(r=>cupByDia[d10(r.data)]=Number(r.cup));
  const DIA=diaIt.map(r=>({d:d10(r.data),fat:fatByDia[d10(r.data)]||0,marg:num(r.marg),qtd:num(r.qtd),cup:cupByDia[d10(r.data)]||0}))
                 .sort((a,b)=>a.d<b.d?-1:1);

  // ---- HORA: dia x hora (cabecalho) ----
  const HORA=(await timed(c,"HORA",`
    SELECT data, to_char(horainicio,'HH24') h, SUM(subtotalimpressora) fat
    FROM pdv.venda WHERE cancelado=false AND horainicio IS NOT NULL GROUP BY 1,2`))
    .map(r=>({d:d10(r.data),h:r.h,fat:num(r.fat)}));

  // ---- OPERADOR: dia x operador (cabecalho) ----
  const OP=(await timed(c,"OPERADOR",`
    SELECT data, matricula, SUM(subtotalimpressora) fat, COUNT(*) cup
    FROM pdv.venda WHERE cancelado=false GROUP BY 1,2`))
    .map(r=>({d:d10(r.data),o:opMap[r.matricula]||("Op "+r.matricula),fat:num(r.fat),cup:Number(r.cup)}));

  // ---- PAGAMENTO: dia x finalizadora ----
  const PAG=(await timed(c,"PAGAMENTO",`
    SELECT c.data, vf.id_finalizadora f, SUM(vf.valor) fat
    FROM pdv.vendafinalizadora vf JOIN pdv.venda c ON c.id=vf.id_venda
    WHERE c.cancelado=false GROUP BY 1,2`))
    .map(r=>({d:d10(r.data),p:pagMap[r.f]||("Forma "+r.f),fat:num(r.fat)}));

  // ---- SETOR: dia x setor (itens x produto) ----
  const SETOR=(await timed(c,"SETOR",`
    SELECT v.data, p.mercadologico1 m, SUM(v.valortotal) fat
    FROM pdv.vendaitem v JOIN public.produto p ON p.id=v.id_produto
    WHERE v.cancelado=false GROUP BY 1,2`))
    .map(r=>({d:d10(r.data),s:setorMap[r.m]||("Setor "+r.m),fat:num(r.fat)}));

  // ---- RANKING PRODUTOS por mes (top 300/mes) ----
  const mp=await timed(c,"RANKING produtos/mes (top300)",`
    WITH mp AS (
      SELECT to_char(date_trunc('month',data),'YYYY-MM') mes, id_produto,
             SUM(quantidade) qtd, SUM(valortotal) fat
      FROM pdv.vendaitem WHERE cancelado=false GROUP BY 1,2)
    SELECT mes, id_produto, qtd, fat FROM (
      SELECT *, row_number() OVER (PARTITION BY mes ORDER BY fat DESC) rn FROM mp) t
    WHERE rn<=300`);
  // nomes dos produtos que aparecem no ranking
  const ids=[...new Set(mp.map(r=>r.id_produto))];
  const nomeProd={};
  for(let i=0;i<ids.length;i+=2000){
    const chunk=ids.slice(i,i+2000);
    (await c.query(`SELECT id, descricaocompleta n FROM public.produto WHERE id = ANY($1)`,[chunk]))
      .rows.forEach(r=>nomeProd[r.id]=(r.n||"").trim());
  }
  const MESPROD=mp.map(r=>({m:r.mes,id:String(r.id_produto),nome:nomeProd[r.id_produto]||("Prod "+r.id_produto),qtd:num(r.qtd),fat:num(r.fat)}));

  await c.end();

  const data={ gerado:new Date().toISOString(), DIA, HORA, OP, PAG, SETOR, MESPROD };
  const outDir=path.join(__dirname,"..","output");
  if(!fs.existsSync(outDir)) fs.mkdirSync(outDir);
  const file=path.join(outDir,"vr-data.json");
  fs.writeFileSync(file, JSON.stringify(data));
  const mb=(fs.statSync(file).size/1048576).toFixed(2);
  console.log("\nOK -> output/vr-data.json ("+mb+" MB)");
  console.log("Linhas: DIA="+DIA.length+" HORA="+HORA.length+" OP="+OP.length+" PAG="+PAG.length+" SETOR="+SETOR.length+" MESPROD="+MESPROD.length);
  console.log("Periodo: "+(DIA[0]&&DIA[0].d)+" a "+(DIA[DIA.length-1]&&DIA[DIA.length-1].d));
})().catch(e=>{ console.log("ERRO: "+e.message); process.exit(1); });
