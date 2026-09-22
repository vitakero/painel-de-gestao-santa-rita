// Espera UMA rodada da loja e confere se ela reconstruiu COM os grupos de desconto.
// O risco real aqui nao e o painel sumir: e a loja reconstruir com o robo novo e o
// FCX_DIA voltar SEM os campos gan/gav/gcn/gcv (aí o card volta pro manual sozinho).
require("dotenv").config();
const T=process.env.GITHUB_TOKEN, R=process.env.GITHUB_REPO||"painel-de-gestao-santa-rita", O=process.env.GITHUB_OWNER||"vitakero";
const h={Authorization:"Bearer "+T, Accept:"application/vnd.github+json","User-Agent":"santa-rita"};
const MEU = "2026-09-22T13:34:03Z";
const esp = ms => new Promise(r=>setTimeout(r,ms));
const brl=n=>Number(n||0).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
(async()=>{
  const ate = Date.now() + 45*60*1000;
  let rodada = null;
  while(Date.now() < ate && !rodada){
    try{
      const j = await (await fetch(`https://api.github.com/repos/${O}/${R}/commits?path=index.html&per_page=5`,{headers:h})).json();
      const nova = (j||[]).filter(c => c.commit && c.commit.committer.date > MEU && /\(loja\)/.test(c.commit.message));
      if(nova.length){ rodada = nova[nova.length-1]; break; }
      process.stdout.write(".");
    }catch(e){ process.stdout.write("x"); }
    await esp(30000);
  }
  console.log("");
  if(!rodada){ console.log(">>> A loja nao republicou em 25 min. O que publiquei continua no ar."); process.exit(0); }
  console.log("Rodada da loja:", rodada.commit.committer.date);
  await esp(20000);   // o Vercel leva ~1 min
  let txt=null;
  for(let i=0;i<8 && txt===null;i++){
    try{ const r=await fetch("https://painel-de-gestao-santa-rita.vercel.app/?v="+Date.now()); txt=await r.text(); }
    catch(e){ await esp(8000); }
  }
  if(txt===null){ console.log(">>> nao consegui baixar a pagina (rede)."); process.exit(2); }
  let faltou=0;
  for(const [nome,re] of [["a composicao do desconto",/function fcxDetDesconto/],
                          ["os grupos no painel",/FCX_DORDEM/],
                          ["o rodape explicando",/não passam pela mão de ninguém no caixa/]]){
    const tem=re.test(txt); if(!tem) faltou++;
    console.log((tem?"  OK   ":"  SUMIU")+" | "+nome);
  }
  const m=txt.match(/FCX_DIA\s*=\s*(\[[\s\S]*?\]);/);
  if(!m){ console.log("  SUMIU | o FCX_DIA"); process.exit(1); }
  const a=JSON.parse(m[1]);
  const comGrupo=a.filter(x=>x.gav!==undefined).length;
  console.log((comGrupo===a.length?"  OK   ":"  FALHA")+" | a loja reconstruiu COM os grupos ("+comGrupo+" de "+a.length+" dias)");
  if(comGrupo!==a.length) faltou++;
  const set=a.filter(x=>x.d>="2026-09-01"&&x.d<="2026-09-30");
  const s=k=>set.reduce((x,r)=>x+(r[k]||0),0);
  console.log("\n  setembro no ar: manual R$ "+brl(s("dv"))+" | campanha R$ "+brl(s("gcv"))+
              " | atacado R$ "+brl(s("gav"))+" | oferta R$ "+brl(s("gov"))+" | naoclass R$ "+brl(s("gxv")));
  console.log("  TOTAL R$ "+brl(s("dv")+s("gcv")+s("gav")+s("gov")+s("gxv"))+
              " em "+(s("dn")+s("gcn")+s("gan")+s("gon")+s("gxn"))+" ocorrencias");
  console.log("  DATA_MAX: "+(txt.match(/DATA_MAX\s*=\s*"([0-9-]+)"/)||[])[1]);
  console.log(faltou ? "\n>>> A RODADA DA LOJA QUEBROU ALGUMA COISA" : "\n>>> AGUENTOU a rodada da loja, com os grupos");
  process.exit(faltou?1:0);
})();
