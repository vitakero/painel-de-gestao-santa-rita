// SYNC: lê produtos + código de barras (+ estoque se der) do VR e joga na tabela estoque_produtos do Supabase.
// Precisa de SUPABASE_SERVICE_KEY no .env. Só LÊ o VR; ESCREVE só na nuvem. NÃO apaga a coluna "loja".
const fs=require("fs"),path=require("path"),https=require("https"),{Client}=require("pg");
function env(){for(const p of[path.join(__dirname,"..",".env"),".env","../.env"]){try{return fs.readFileSync(p,"utf8")}catch(e){}}return""}
const E=env(),g=k=>{const m=E.match(new RegExp("^"+k+"=(.*)$","m"));return m?m[1].trim():""};
const SB_HOST="uabhsmculsfwzcrhyhch.supabase.co", SB_KEY=g("SUPABASE_SERVICE_KEY");
function upsert(rows){return new Promise((res,rej)=>{const body=JSON.stringify(rows);const req=https.request({host:SB_HOST,path:"/rest/v1/estoque_produtos?on_conflict=cod",method:"POST",headers:{apikey:SB_KEY,Authorization:"Bearer "+SB_KEY,"Content-Type":"application/json",Prefer:"resolution=merge-duplicates,return=minimal","Content-Length":Buffer.byteLength(body)}},r=>{let d="";r.on("data",c=>d+=c);r.on("end",()=>r.statusCode<300?res():rej(new Error("HTTP "+r.statusCode+" "+d)))});req.on("error",rej);req.write(body);req.end();})}
// Saldo = produtocomplemento.estoque da loja 1. NÃO usar a tabela "estoque": ela é uma foto por
// dia, e sem filtrar a data a consulta pegava um dia qualquer (ver ==ESTSALDO== no buildVrData.cjs).
// O codigobarras no fim do ORDER BY fixa qual código vai pra nuvem quando o produto tem vários.
const Q_FULL="SELECT DISTINCT ON (p.id) pa.codigobarras::text cod, p.descricaocompleta nome, pc.estoque::text total FROM produto p JOIN produtoautomacao pa ON pa.id_produto = p.id LEFT JOIN produtocomplemento pc ON pc.id_produto = p.id AND pc.id_loja = 1 WHERE pa.codigobarras IS NOT NULL AND trim(pa.codigobarras::text)<>'' ORDER BY p.id, pa.qtdembalagem, pa.codigobarras";
const Q_NOEST="SELECT DISTINCT ON (p.id) pa.codigobarras::text cod, p.descricaocompleta nome, '0' total FROM produto p JOIN produtoautomacao pa ON pa.id_produto::text=p.id::text WHERE pa.codigobarras IS NOT NULL AND trim(pa.codigobarras::text)<>'' ORDER BY p.id, pa.qtdembalagem, pa.codigobarras";
(async()=>{
  if(!SB_KEY){console.log("!! Falta SUPABASE_SERVICE_KEY no .env");return}
  const c=new Client({host:g("PG_HOST"),port:+g("PG_PORT"),database:g("PG_DATABASE"),user:g("PG_USER"),password:g("PG_PASSWORD"),connectionTimeoutMillis:20000,query_timeout:300000});
  await c.connect();console.log("Conectado no VR. Lendo produtos (1-2 min)...");
  let rows;
  try{rows=(await c.query(Q_FULL)).rows;console.log("(com estoque OK)");}
  catch(e1){console.log("Estoque deu erro ("+e1.message+"). Pegando so produtos, estoque=0...");rows=(await c.query(Q_NOEST)).rows;}
  await c.end();
  console.log(rows.length+" produtos com codigo de barras. Enviando pra nuvem...");
  const dados=rows.map(r=>({cod:String(r.cod).trim().replace(/\.0+$/,""),nome:r.nome||"",total:Math.round(parseFloat(String(r.total==null?"":r.total).replace(",","."))||0)}));
  let ok=0;
  for(let i=0;i<dados.length;i+=500){await upsert(dados.slice(i,i+500));ok+=Math.min(500,dados.length-i);console.log("  "+ok+"/"+dados.length);}
  console.log(">>> PRONTO! "+ok+" produtos na nuvem. Abra a aba Loja/Deposito no painel.");
})().catch(e=>console.log("ERRO:",e.message));
