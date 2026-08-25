const fs=require("fs"),{Client}=require("pg");
const env=fs.readFileSync(".env","utf8");
const g=k=>{const m=env.match(new RegExp("^"+k+"=(.*)$","m"));return m?m[1].trim():"";};
(async()=>{
  const c=new Client({host:g("PG_HOST"),port:+g("PG_PORT"),database:g("PG_DATABASE"),
    user:g("PG_USER"),password:g("PG_PASSWORD"),connectionTimeoutMillis:60000,query_timeout:600000});
  await c.connect();
  const q=async(t,s)=>{ try{ const r=await c.query(s); console.log("\n### "+t); console.table(r.rows.slice(0,12)); }catch(e){ console.log("\n### "+t+" -> ERRO: "+e.message.slice(0,120)); } };

  await q("colunas de pdv.vendaitem", `
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_schema='pdv' AND table_name='vendaitem' ORDER BY ordinal_position`);
  await q("colunas de pdv.venda (so as que parecem filtro)", `
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='pdv' AND table_name='venda'
      AND (column_name ILIKE '%loja%' OR column_name ILIKE '%cancel%' OR column_name ILIKE '%devol%'
        OR column_name ILIKE '%tipo%' OR column_name ILIKE '%situac%' OR column_name ILIKE '%oper%')`);
  await q("existe mais de uma LOJA nas vendas?", `
    SELECT id_loja, COUNT(*) cupons FROM pdv.venda WHERE data >= '2026-01-01' GROUP BY 1 ORDER BY 2 DESC`);
  await c.end();
})();
