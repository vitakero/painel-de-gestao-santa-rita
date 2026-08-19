// ============================================================================
// Robô: leva para a nuvem os DOIS números do FLV, das duas telas que o Victor usa.
//
//   FATURAMENTO ... Administrativo › Relatórios Gerenciais › Estatísticas,
//                   Exibição = VENDA, Mercadológico 043 › 001 FLV.
//                   -> tabela flv_vr_faturamento (uma linha por mês)
//   DESPERDÍCIO ... a tela do balanço da primeira segunda-feira do mês,
//                   coluna "Total Diferença".
//                   -> tabela flv_vr_balancos (uma linha por contagem)
//
// SÓ LÊ o VR; ESCREVE só na nuvem. Nenhuma conta de prêmio acontece aqui: o painel
// pega estes números, a pessoa confere na tela e o gatilho tg_flv_calcular faz a conta.
//
// Precisa de SUPABASE_SERVICE_KEY no .env. Roda na loja:
//   node scripts/vr-sync-flv.cjs
// ============================================================================
const fs = require("fs"), path = require("path"), https = require("https");
const { Client } = require("pg");

function readEnv(){ for(const p of [path.join(__dirname,"..",".env"),path.join(__dirname,".env"),".env","../.env"]){ try{ return fs.readFileSync(p,"utf8"); }catch(e){} } return ""; }
const env = readEnv();
const g = (k)=>{ const m = env.match(new RegExp("^"+k+"=(.*)$","m")); return m ? m[1].trim() : ""; };

const SB_HOST = (g("SUPABASE_URL")||"").replace(/^https?:\/\//,"").replace(/\/+$/,"") || "uabhsmculsfwzcrhyhch.supabase.co";
const SB_KEY  = g("SUPABASE_SERVICE_KEY");

// FLV = mercadológico 43 › 1. O grupo 43 tem também 005 OVOS, que NÃO entra: o Victor
// filtra 043›001 na tela dele, e é esse recorte que a premiação usa.
const MERC1 = 43, MERC2 = 1;
const LOJA  = 1;              // a loja 2 existe e é dele, mas fica de fora por decisão dele
// Na primeira vez varro o histórico todo (dá comparação com o ano anterior). Depois disso
// só os últimos 14 meses: este script roda junto com o sync de pedidos, de 10 em 10 minutos,
// e reler dois anos de item de venda a cada rodada seria peso no servidor da loja à toa.
const DESDE_CHEIO = "2024-01-01";
const MESES_QUENTES = 14;

const n = (x)=> x==null ? null : Number(x);

function sbUpsert(tabela, chave, rows){
  if(!rows.length) return Promise.resolve();
  return new Promise((res,rej)=>{
    const body = JSON.stringify(rows);
    const req = https.request({ host:SB_HOST, path:"/rest/v1/"+tabela+"?on_conflict="+chave, method:"POST",
      headers:{ apikey:SB_KEY, Authorization:"Bearer "+SB_KEY, "Content-Type":"application/json",
                Prefer:"resolution=merge-duplicates,return=minimal", "Content-Length":Buffer.byteLength(body) } },
      r=>{ let d=""; r.on("data",c=>d+=c); r.on("end",()=> r.statusCode<300 ? res() : rej(new Error("HTTP "+r.statusCode+" "+d))); });
    req.on("error",rej); req.write(body); req.end();
  });
}
function sbTenant(){
  // Todas as tabelas do painel são de um tenant só hoje, mas o default da coluna usa
  // current_tenant(), que com a service key não resolve. Pego o tenant de uma tabela que
  // já existe em vez de cravar um uuid no código.
  return new Promise((res)=>{
    https.get({ host:SB_HOST, path:"/rest/v1/flv_config?select=tenant_id&limit=1",
      headers:{ apikey:SB_KEY, Authorization:"Bearer "+SB_KEY } },
      r=>{ let d=""; r.on("data",c=>d+=c); r.on("end",()=>{ try{ const j=JSON.parse(d); res(j&&j[0]?j[0].tenant_id:null); }catch(e){ res(null); } }); })
      .on("error",()=>res(null));
  });
}

function sbTemHistorico(){
  return new Promise((res)=>{
    https.get({ host:SB_HOST, path:"/rest/v1/flv_vr_faturamento?select=competencia&limit=1",
      headers:{ apikey:SB_KEY, Authorization:"Bearer "+SB_KEY } },
      r=>{ let d=""; r.on("data",c=>d+=c); r.on("end",()=>{ try{ const j=JSON.parse(d); res(Array.isArray(j)&&j.length>0); }catch(e){ res(false); } }); })
      .on("error",()=>res(false));
  });
}

(async ()=>{
  if(!SB_KEY){ console.log("!! Falta SUPABASE_SERVICE_KEY no .env"); return; }
  if(!g("PG_HOST")){ console.log("!! Falta o .env com os dados do VR (rode na pasta do robo)."); return; }

  const tenant = await sbTenant();
  if(!tenant){ console.log("!! Nao consegui descobrir o tenant (a tabela flv_config existe?)"); return; }

  // Já tem histórico na nuvem? Então esta rodada é só de manutenção.
  const jaTem = await sbTemHistorico();
  const desde = jaTem
    ? `(date_trunc('month', current_date) - interval '${MESES_QUENTES - 1} months')`
    : `date '${DESDE_CHEIO}'`;

  const c = new Client({ host:g("PG_HOST"), port:+g("PG_PORT"), database:g("PG_DATABASE"),
                         user:g("PG_USER"), password:g("PG_PASSWORD"), ssl:false, connectionTimeoutMillis:20000 });
  await c.connect();

  // ---- FATURAMENTO ---------------------------------------------------------
  // Confirmado contra a lista que o Victor tirou da tela de Estatisticas: bate com
  // diferenca de R$ 14 a R$ 124 em ~R$ 600.000 por mes (0,002% a 0,02%).
  //
  // Os dois filtros que fizeram a diferenca, e que nao sao obvios:
  //   v.cancelado  = item cancelado dentro de um cupom que passou.
  //   cp.cancelado = CUPOM inteiro cancelado. Faltava este, e sozinho respondia por
  //                  ~R$ 5.800 por mes a mais. Item cancelado e cupom cancelado sao
  //                  coisas diferentes no VR e precisam dos dois filtros.
  // A loja fica em pdv.venda, nao em pdv.vendaitem — vendaitem nao tem id_loja.
  const fat = (await c.query(`
    select date_trunc('month', v.data)::date mes,
           sum(v.valortotal) faturamento,
           sum(v.quantidade) qtd
      from pdv.vendaitem v
      join pdv.venda cp on cp.id = v.id_venda
      join public.produto p on p.id = v.id_produto
     where v.cancelado = false
       and cp.cancelado = false
       and cp.id_loja = ${LOJA}
       and p.mercadologico1 = ${MERC1} and p.mercadologico2 = ${MERC2}
       and v.data >= ${desde}
     group by 1 order by 1`)).rows;

  const linhasFat = fat.map(r=>({
    tenant_id: tenant,
    competencia: r.mes,
    faturamento: n(r.faturamento),
    qtd_vendida: n(r.qtd),
    origem: { tela:"Estatisticas / Exibicao VENDA", mercadologico:MERC1+"."+MERC2,
              loja:LOJA, filtros:"item nao cancelado + cupom nao cancelado" },
    atualizado_em: new Date().toISOString()
  }));
  await sbUpsert("flv_vr_faturamento","tenant_id,competencia", linhasFat);
  console.log("faturamento do FLV: "+linhasFat.length+" meses na nuvem");
  linhasFat.slice(-4).forEach(r=>console.log("   "+r.competencia+"  R$ "+Number(r.faturamento).toFixed(2)));

  await c.end();
})().catch(e=>{ console.log("!! vr-sync-flv falhou: "+e.message); });
