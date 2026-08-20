// ============================================================================
// receb_eventos: manda o LOG de uma rodada do robo para a nuvem.
//
// Por que existe: script do robo que morre na loja leva o erro junto quando a
// janela preta fecha. Aqui o .bat grava tudo num arquivo e este script empurra o
// arquivo pra nuvem, entao eu consigo ler o erro daqui sem o Victor ter que
// copiar texto pelo AnyDesk.
//
// Uso:  node scripts\mandar-log.cjs <arquivo> <apelido>
// Nunca derruba a rodada: qualquer falha aqui so imprime um aviso.
// ============================================================================
const fs=require("fs"), path=require("path"), https=require("https");
function env(){ for(const p of [path.join(__dirname,"..",".env"),".env"]){
  try{ return fs.readFileSync(p,"utf8"); }catch(e){} } return ""; }
const E=env(), g=(k)=>{ const m=E.match(new RegExp("^"+k+"=(.*)$","m")); return m?m[1].trim():""; };
const SB_HOST="uabhsmculsfwzcrhyhch.supabase.co", SB_KEY=g("SUPABASE_SERVICE_KEY");

function req(metodo, caminho, corpo, prefer){
  return new Promise((res,rej)=>{
    const d=corpo?JSON.stringify(corpo):null;
    const h={apikey:SB_KEY,Authorization:"Bearer "+SB_KEY,"Content-Type":"application/json"};
    if(prefer) h.Prefer=prefer;
    if(d) h["Content-Length"]=Buffer.byteLength(d);
    const r=https.request({host:SB_HOST,path:caminho,method:metodo,headers:h},(resp)=>{
      let b=""; resp.on("data",c=>b+=c);
      resp.on("end",()=>resp.statusCode<300?res(b?JSON.parse(b):null)
        :rej(new Error("HTTP "+resp.statusCode+" "+b.slice(0,200))));
    });
    r.on("error",rej); if(d) r.write(d); r.end();
  });
}

(async()=>{
  const arq=process.argv[2], apelido=process.argv[3]||"robo";
  if(!arq){ console.log("  (mandar-log: faltou o nome do arquivo)"); return; }
  if(!SB_KEY){ console.log("  (mandar-log: sem SUPABASE_SERVICE_KEY no .env)"); return; }
  let txt="";
  try{ txt=fs.readFileSync(arq,"utf8"); }
  catch(e){ console.log("  (mandar-log: nao achei "+arq+")"); return; }
  // o detalhe e texto: corto o meio se for gigante, guardando comeco e fim (o erro
  // costuma estar no fim).
  const LIM=90000;
  if(txt.length>LIM) txt=txt.slice(0,LIM/2)+"\n\n[...cortei o meio...]\n\n"+txt.slice(-LIM/2);
  try{
    // entidade_id e uuid — receb_eventos.id e NUMERO. Ver o comentario gemeo no
    // vr-descobrir-notas.cjs: este erro custou uma rodada inteira na loja.
    const loc=await req("GET","/rest/v1/receb_locais?select=id&order=criado_em&limit=1");
    await req("POST","/rest/v1/receb_eventos",[{ entidade:"robo_log",
      entidade_id:(loc&&loc[0]&&loc[0].id)||"00000000-0000-0000-0000-000000000000",
      acao:apelido, motivo:path.basename(arq), detalhe:txt }],"return=minimal");
    console.log("  (log enviado para a nuvem: "+apelido+")");
  }catch(e){ console.log("  (mandar-log falhou: "+e.message+")"); }
})();
