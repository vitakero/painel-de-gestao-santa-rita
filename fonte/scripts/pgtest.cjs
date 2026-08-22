const fs=require("fs");
const path=require("path");
const { Client }=require("pg");
const env=fs.readFileSync(path.join(__dirname,"..",".env"),"utf8");
const get=k=>{const m=env.match(new RegExp("^"+k+"=(.*)$","m"));return m?m[1].trim():"";};
const cfg={
  host:get("PG_HOST"), port:+get("PG_PORT"), database:get("PG_DATABASE"),
  user:get("PG_USER"), password:get("PG_PASSWORD"),
  connectionTimeoutMillis:7000, ssl:false
};
console.log("Conectando em "+cfg.host+":"+cfg.port+" db="+cfg.database+" user="+cfg.user+" ...\n");
const c=new Client(cfg);
c.connect().then(async()=>{
  console.log(">>> CONECTOU NO POSTGRES DO VR! <<<");
  const v=await c.query("select version()");
  console.log(v.rows[0].version);
  const t=await c.query("select count(*)::int as n from information_schema.tables where table_schema not in ('pg_catalog','information_schema')");
  console.log("Tabelas no banco: "+t.rows[0].n);
  await c.end(); process.exit(0);
}).catch(e=>{
  console.log("FALHOU: "+e.message);
  if(/timeout|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|ECONNREFUSED/i.test(e.message))
    console.log(">>> Provavelmente fora da rede da loja (192.168.0.3 e interno) OU acesso remoto nao liberado.");
  process.exit(1);
});
