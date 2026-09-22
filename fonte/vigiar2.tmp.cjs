// Espera a PRIMEIRA sincronizacao de ocorrencias com o robo novo, no servidor da loja.
// E o que prova que a consulta corrigida roda la, e nao so no meu Mac.
require("dotenv").config();
const SU=process.env.SUPABASE_URL, SK=process.env.SUPABASE_SERVICE_KEY;
const h={apikey:SK,Authorization:"Bearer "+SK};
const esp=ms=>new Promise(r=>setTimeout(r,ms));
const DEPOIS="2026-09-22T21:19:56";
(async()=>{
  const ate=Date.now()+50*60*1000; let ev=null;
  while(Date.now()<ate && !ev){
    try{
      const r=await fetch(SU+"/rest/v1/receb_eventos?select=quando,acao,motivo,detalhe&entidade=like.*frente*&order=id.desc&limit=5",{headers:h});
      const j=await r.json();
      // so interessa evento NOVO que nao seja "pulou"
      const n=(j||[]).filter(x=>(x.quando||"")>DEPOIS && x.acao!=="pulou");
      if(n.length){ ev=n[n.length-1]; break; }
      process.stdout.write(".");
    }catch(e){ process.stdout.write("x"); }
    await esp(60000);
  }
  console.log("");
  if(!ev){ console.log(">>> o robo nao sincronizou em 50 min (ele pula quando fez ha menos de 20)."); process.exit(0); }
  console.log("SINCRONIZACAO DO ROBO NOVO:");
  console.log("  quando : "+(ev.quando||"").slice(0,19));
  console.log("  como   : "+ev.acao);
  console.log("  o que  : "+String(ev.motivo||"").slice(0,140));
  if(ev.detalhe) console.log("  detalhe: "+JSON.stringify(ev.detalhe).slice(0,200));
  if(ev.acao==="com_erro"){ console.log("\n>>> O ROBO DEU ERRO — preciso olhar"); process.exit(1); }
  // e os grupos continuam certos na nuvem?
  const conta=async q=>{const r=await fetch(SU+"/rest/v1/frentecaixa_ocorrencias?"+q,
    {headers:{...h,Prefer:"count=exact",Range:"0-0"}});
    return Number((r.headers.get("content-range")||"/0").split("/")[1]||0);};
  console.log("\n  na nuvem agora:");
  for(const g of ["manual","campanha","atacado","oferta","naoclass"])
    console.log("    "+g.padEnd(9)+String(await conta("select=venda_id&tipo=eq.desconto&grupo=eq."+g)).padStart(7));
  const semG=await conta("select=venda_id&tipo=eq.desconto&grupo=is.null");
  console.log("    sem grupo (tem que ser 0): "+semG);
  console.log(semG===0 ? "\n>>> O ROBO NOVO SINCRONIZOU CERTO" : "\n>>> APARECEU DESCONTO SEM GRUPO");
  process.exit(semG===0?0:1);
})().catch(e=>{console.log("ERRO:",e.message);process.exit(1);});
