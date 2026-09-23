// A proxima rodada da loja: ela tem que juntar as duas coisas — a coluna Caixa
// (fonte nova) E o dado fresco (que so a loja tem).
require("dotenv").config();
const T=process.env.GITHUB_TOKEN,R=process.env.GITHUB_REPO||"painel-de-gestao-santa-rita",O=process.env.GITHUB_OWNER||"vitakero";
const h={Authorization:"Bearer "+T,Accept:"application/vnd.github+json","User-Agent":"sr"};
const MEU="2026-09-22T22:21:23Z";
const esp=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const ate=Date.now()+35*60*1000; let rodada=null;
  while(Date.now()<ate && !rodada){
    try{
      const j=await (await fetch(`https://api.github.com/repos/${O}/${R}/commits?path=index.html&per_page=5`,{headers:h})).json();
      const n=(j||[]).filter(c=>c.commit && c.commit.committer.date>MEU && /\(loja\)/.test(c.commit.message));
      if(n.length){ rodada=n[n.length-1]; break; }
      process.stdout.write(".");
    }catch(e){ process.stdout.write("x"); }
    await esp(30000);
  }
  console.log("");
  if(!rodada){ console.log(">>> a loja nao republicou em 35 min."); process.exit(0); }
  console.log("Rodada da loja: "+rodada.commit.committer.date);
  await esp(25000);
  let txt=null;
  for(let i=0;i<10 && txt===null;i++){
    try{ const t=await (await fetch("https://painel-de-gestao-santa-rita.vercel.app/?v="+Date.now())).text();
         if(/data-r="Caixa"/.test(t)) txt=t; else await esp(12000); }
    catch(e){ await esp(10000); }
  }
  if(txt===null){ console.log(">>> a pagina no ar ainda nao tem a coluna Caixa depois da rodada."); process.exit(1); }
  console.log("  OK    | a coluna Caixa sobreviveu");
  const g=/resumos gerados em ([0-9\/]+, [0-9:]+)/.exec(txt);
  console.log("  OK    | gerado em: "+(g?g[1]:"?")+"  (era 19:08:51 no meu)");
  const a=JSON.parse(txt.match(/FCX_DIA\s*=\s*(\[[\s\S]*?\]);/)[1]);
  console.log("  OK    | FCX_DIA "+a.length+" dias | "+a.filter(x=>x.gav!==undefined).length+" com os grupos");
  console.log("\n>>> A LOJA JUNTOU AS DUAS COISAS: a coluna nova e o dado fresco");
})().catch(e=>{console.log("ERRO:",e.message);process.exit(1);});
