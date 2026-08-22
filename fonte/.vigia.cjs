require("dotenv").config({path:"/Users/victorvinicius/vr-looker-integration/.env"});
const U=process.env.SUPABASE_URL,K=process.env.SUPABASE_SERVICE_KEY;
const h={apikey:K,Authorization:"Bearer "+K};
(async()=>{
  for(let i=0;i<150;i++){
    try{
      const r=await fetch(U+"/rest/v1/receb_eventos?entidade=eq.vr_notas2&motivo=like.*rodada 3*&order=quando.desc&limit=1&select=quando,detalhe",{headers:h});
      const j=await r.json();
      if(Array.isArray(j)&&j.length){
        console.log("CHEGOU:",j[0].quando);
        console.log(JSON.stringify(j[0].detalhe,null,1).slice(0,25000));
        process.exit(0);
      }
    }catch(e){}
    await new Promise(r=>setTimeout(r,20000));
  }
  console.log("NADA em 50 min.");
})();
