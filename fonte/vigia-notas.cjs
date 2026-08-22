require("dotenv").config();
const U=process.env.SUPABASE_URL, K=process.env.SUPABASE_SERVICE_KEY;
const H={apikey:K,Authorization:"Bearer "+K};
const txt=(v,n)=>String(v==null?"":v).padEnd(n||0);
const num=(v,n)=>String(v==null?"?":v).padStart(n||0);
(async()=>{
  for(let i=0;i<240;i++){
    let d=null,q="";
    try{
      const j=await (await fetch(U+"/rest/v1/receb_eventos?entidade=eq.vr_notas&select=detalhe,quando&order=quando.desc&limit=1",{headers:H})).json();
      if(j&&j[0]){ d=j[0].detalhe; q=j[0].quando; }
    }catch(e){}
    if(d){
      console.log("O VR RESPONDEU  "+q+(d.erro?("   ERRO: "+d.erro):"")+"   (parou em: "+d.etapa+")\n");
      console.log("=== COLUNAS COM XML NO NOME ===");
      (d.colunas_xml||[]).forEach(x=>console.log("  "+txt(x.esquema+"."+x.tabela+"."+x.coluna,52)+txt(x.tipo,16)+num(x.linhas,10)+" linhas"));
      if(!(d.colunas_xml||[]).length) console.log("  (nenhuma)");
      console.log("\n=== TABELAS COM CARA DE NOTA DE ENTRADA ===");
      (d.tabelas||[]).forEach(t=>{ console.log("  "+txt(t.esquema+"."+t.tabela,42)+num(t.linhas,10)+" linhas");
        console.log("      "+String((t.colunas||[]).join(",")).slice(0,320)); });
      if(!(d.tabelas||[]).length) console.log("  (nenhuma)");
      console.log("\n=== ONDE ESTA A CHAVE DE 44 DIGITOS ===");
      (d.colunas_chave||[]).forEach(x=>console.log("  "+txt(x.esquema+"."+x.tabela+"."+x.coluna,52)+num(x.linhas,10)+" linhas"));
      console.log("\n=== TEM XML DE VERDADE LA DENTRO? ===");
      (d.amostras||[]).forEach(a=>{
        console.log("  "+txt(a.tabela+"."+a.coluna,50)
          +(a.erro?("ERRO "+a.erro):("total="+num(a.total)+"  com_xml="+num(a.com_xml)
            +"  com_itens="+num(a.com_itens)+"  parece_nfe="+a.parece_nfe)));
        if(a.inicio) console.log("        "+String(a.inicio).replace(/\s+/g," ").slice(0,150));
      });
      if(!(d.amostras||[]).length) console.log("  (nenhuma amostra)");
      process.exit(0);
    }
    await new Promise(s=>setTimeout(s,20000));
  }
  console.log("nao chegou");
})();
