// Robô: lê "outras despesas" do VR, agrega por MÊS + CATEGORIA (plano de contas) + as 15 maiores,
// e grava o RESUMO na nuvem (tabela despesas_resumo). SÓ LÊ o VR; ESCREVE só na nuvem.
// Não copia despesa individual — só agregados + as 15 maiores por mês.
// Precisa de SUPABASE_SERVICE_KEY no .env (a mesma dos outros syncs). Roda na loja (rede do robô):
//   node scripts/vr-sync-despesas.cjs
const fs = require("fs"), path = require("path"), https = require("https");
const { Client } = require("pg");

function readEnv(){ for(const p of [path.join(__dirname,"..",".env"),path.join(__dirname,".env"),".env","../.env"]){ try{ return fs.readFileSync(p,"utf8"); }catch(e){} } return ""; }
const env = readEnv();
const g = (k)=>{ const m = env.match(new RegExp("^"+k+"=(.*)$","m")); return m ? m[1].trim() : ""; };

const SB_HOST = (g("SUPABASE_URL")||"").replace(/^https?:\/\//,"").replace(/\/+$/,"") || "uabhsmculsfwzcrhyhch.supabase.co";
const SB_KEY  = g("SUPABASE_SERVICE_KEY");
const MESES   = 6;   // competências a recalcular a cada rodada (o mês corrente + os anteriores)

function sbUpsert(rows){
  return new Promise((res,rej)=>{
    const body = JSON.stringify(rows);
    const req = https.request({ host:SB_HOST, path:"/rest/v1/despesas_resumo?on_conflict=competencia", method:"POST",
      headers:{ apikey:SB_KEY, Authorization:"Bearer "+SB_KEY, "Content-Type":"application/json",
                Prefer:"resolution=merge-duplicates,return=minimal", "Content-Length":Buffer.byteLength(body) } },
      r=>{ let d=""; r.on("data",c=>d+=c); r.on("end",()=> r.statusCode<300 ? res() : rej(new Error("HTTP "+r.statusCode+" "+d))); });
    req.on("error",rej); req.write(body); req.end();
  });
}

(async ()=>{
  if(!SB_KEY){ console.log("!! Falta SUPABASE_SERVICE_KEY no .env"); return; }
  if(!g("PG_HOST")){ console.log("!! Falta o .env com os dados do VR (rode na pasta do robô)."); return; }

  const c = new Client({ host:g("PG_HOST"), port:+g("PG_PORT"), database:g("PG_DATABASE"), user:g("PG_USER"), password:g("PG_PASSWORD"), ssl:false, connectionTimeoutMillis:20000 });
  await c.connect();

  // Categoria = tipoplanoconta.descricao, via tipoentrada.planoconta1/2. Datas absurdas (erro de digitação) ficam de fora.
  const CAT = `left join tipoentrada te on te.id=od.id_tipoentrada
               left join tipoplanoconta tpc on tpc.planoconta1=te.planoconta1 and tpc.planoconta2=te.planoconta2`;
  // Só a loja 1 (esta loja). Blinda contra matriz/CD (id_loja=0) que possa existir no mesmo banco VR.
  const VALIDA = `od.id_loja = 1 and od.dataentrada between date '2015-01-01' and date '2100-01-01'`;

  const meses = (await c.query(
    `select distinct to_char(date_trunc('month',od.dataentrada),'YYYY-MM-DD') comp
       from pagaroutrasdespesas od
      where ${VALIDA} and od.dataentrada >= (date_trunc('month',current_date) - interval '${MESES - 1} months')
      order by 1`)).rows;

  const linhas = [];
  for(const m of meses){
    const comp = m.comp; // 'YYYY-MM-01'
    const tot = (await c.query(
      `select count(*) qtd, coalesce(round(sum(od.valor)::numeric,2),0) soma
         from pagaroutrasdespesas od
        where ${VALIDA} and date_trunc('month',od.dataentrada)=$1::date`, [comp])).rows[0];
    const cats = (await c.query(
      `select coalesce(tpc.descricao,'(sem categoria)') cat, coalesce(round(sum(od.valor)::numeric,2),0) soma, count(*) qtd
         from pagaroutrasdespesas od ${CAT}
        where ${VALIDA} and date_trunc('month',od.dataentrada)=$1::date
        group by 1 order by 2 desc`, [comp])).rows;
    const top = (await c.query(
      `select to_char(od.dataentrada,'YYYY-MM-DD') data, coalesce(te.descricao,'') descricao,
              coalesce(f.razaosocial,'?') fornecedor, coalesce(tpc.descricao,'(sem categoria)') categoria,
              round(od.valor::numeric,2) valor
         from pagaroutrasdespesas od ${CAT}
         left join fornecedor f on f.id=od.id_fornecedor
        where ${VALIDA} and date_trunc('month',od.dataentrada)=$1::date
        order by od.valor desc limit 15`, [comp])).rows;

    linhas.push({
      competencia: comp,
      total: +tot.soma,
      qtd: +tot.qtd,
      categorias: cats.map(r=>({ cat:r.cat, soma:+r.soma, qtd:+r.qtd })),
      maiores: top.map(r=>({ data:r.data, descricao:r.descricao, fornecedor:r.fornecedor, categoria:r.categoria, valor:+r.valor })),
      atualizado_em: new Date().toISOString()
    });
  }
  await c.end();

  if(linhas.length){ await sbUpsert(linhas); console.log(">>> Despesas: "+linhas.length+" meses gravados na nuvem (despesas_resumo)."); }
  else console.log("Despesas: nada a gravar.");
})().catch(e=>{ console.log("ERRO:", e.message); process.exit(1); });
