// Vigia a primeira rodada da loja com o robo NOVO. Tres coisas podem dar errado:
// 1) o painel voltar sem as telas novas (fonte velha)
// 2) o FCX_DIA voltar sem os grupos
// 3) a sincronizacao das ocorrencias dar erro (a trava do banco, o tempo da consulta)
require("dotenv").config();
const T=process.env.GITHUB_TOKEN,R=process.env.GITHUB_REPO||"painel-de-gestao-santa-rita",O=process.env.GITHUB_OWNER||"vitakero";
const SU=process.env.SUPABASE_URL, SK=process.env.SUPABASE_SERVICE_KEY;
const h={Authorization:"Bearer "+T,Accept:"application/vnd.github+json","User-Agent":"sr"};
const MEU="2026-09-22T21:20:05Z";
const esp=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const ate=Date.now()+40*60*1000; let rodada=null;
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
  if(!rodada){ console.log(">>> a loja nao republicou em 40 min. O que publiquei segue no ar."); process.exit(0); }
  console.log("Rodada da loja: "+rodada.commit.committer.date);
  await esp(25000);
  let txt=null;
  for(let i=0;i<8 && txt===null;i++){
    try{ txt=await (await fetch("https://painel-de-gestao-santa-rita.vercel.app/?v="+Date.now())).text(); }
    catch(e){ await esp(8000); }
  }
  if(txt===null){ console.log(">>> nao consegui baixar a pagina."); process.exit(2); }
  let ruim=0;
  for(const [n,re] of [["as telas novas",/function fcxDesenharProdutos/],
                       ["o resumo por produto",/frentecaixa_desconto_produtos/],
                       ["o detalhamento do produto",/data-fcx-prod/],
                       ["a janela de 13 meses",/FCX_NUVEM_MESES/],
                       ["o celular em duas colunas",/repeat\(2,minmax\(0,1fr\)\)/]]){
    const t=re.test(txt); if(!t) ruim++; console.log((t?"  OK   ":"  SUMIU")+" | "+n);
  }
  const a=JSON.parse(txt.match(/FCX_DIA\s*=\s*(\[[\s\S]*?\]);/)[1]);
  const com=a.filter(x=>x.gav!==undefined).length;
  console.log((com===a.length?"  OK   ":"  FALHA")+" | a loja reconstruiu COM os grupos ("+com+" de "+a.length+")");
  if(com!==a.length) ruim++;
  // a sincronizacao das ocorrencias deu erro?
  const rr=await fetch(SU+"/rest/v1/receb_eventos?select=quando,acao,motivo&entidade=like.*frente*&order=id.desc&limit=3",
    {headers:{apikey:SK,Authorization:"Bearer "+SK}});
  console.log("\n  ultimos avisos do robo (frente de caixa):");
  for(const e of await rr.json()){
    const err=e.acao==="com_erro"; if(err) ruim++;
    console.log("   "+(err?"ERRO  ":"ok    ")+(e.quando||"").slice(0,19)+" | "+String(e.motivo||"").slice(0,90));
  }
  console.log(ruim ? "\n>>> ALGO QUEBROU NA RODADA DA LOJA" : "\n>>> AGUENTOU a rodada da loja");
  process.exit(ruim?1:0);
})().catch(e=>{console.log("ERRO:",e.message);process.exit(1);});
