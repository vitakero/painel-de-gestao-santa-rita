/* ============================================================
   RELATÓRIO: PRODUTOS QUE CAÍRAM DE VENDA, SETOR POR SETOR

   Pra que serve: a tela "Venda por setor" mostra só os 40 que mais caíram e os 15 que
   mais subiram de cada setor — o robô corta o resto DENTRO da loja pra não engordar o
   painel. Este script vai buscar a lista COMPLETA de quedas e gera o papel pro gerente.

   Roda no Mac, DENTRO da rede da loja (fala direto com o Postgres do VR).
   Escreve na Área de Trabalho, NUNCA em output/ — output/ é a pasta que vai pro ar.

   A REGRA VEM DO ROBÔ, NÃO DAQUI. As CTEs são lidas de buildVrData.cjs em tempo de
   execução. Se eu copiasse o SQL pra cá, uma correção lá (como a do cancelado, que
   valia 0,8% de venda que não existe) não chegaria no relatório e os dois números
   passariam a divergir sem ninguém perceber. Se a extração falhar, este script MORRE
   com aviso — nunca gera papel com regra adivinhada.

   Uso:
     node scripts/relatorio-quedas.cjs              (completo, ~200 páginas)
     node scripts/relatorio-quedas.cjs --curto      (resumo de ~14 páginas, pra ler no papel)
     node scripts/relatorio-quedas.cjs 2024 2025    (um par específico)
   ============================================================ */
const fs=require("fs"), path=require("path"), os=require("os"), https=require("https");
const { Client }=require("pg");
const { execFileSync }=require("child_process");

const RAIZ=path.join(__dirname,"..");
const env=fs.readFileSync(path.join(RAIZ,".env"),"utf8");
const get=k=>{const m=env.match(new RegExp("^"+k+"=(.*)$","m"));return m?m[1].trim():"";};
const ANO_PISO=2024, PISO_DATA=ANO_PISO+"-01-01";
const CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SAIDA=path.join(os.homedir(),"Desktop");

/* ---- VERSÃO CURTA ----
   200 páginas ninguém lê. No modo --curto cada setor mostra só os produtos que
   EXPLICAM a queda: vai somando do pior pro melhor até cobrir 80% das unidades perdidas
   daquele setor, e para em 25 linhas de qualquer jeito (uma folha por setor).

   Por que 80% e não um número fixo de linhas: setor concentrado (Mercearia Seca, onde 3
   produtos são metade da queda) fica curto, e setor espalhado (Bazar, com 1.634 produtos
   caindo pouco cada) mostra mais. O corte se ajusta sozinho ao formato do setor.

   O QUE FICOU DE FORA VAI ESCRITO no fim de cada setor, com quantos produtos e quantas
   unidades. Lista incompleta com cara de completa é o defeito que a versão antiga desta
   tela já teve uma vez — não repito. */
const CURTO=process.argv.includes("--curto");
const CURTO_COBERTURA=0.80, CURTO_MAX=25;

/* ---- 1. pega as CTEs do robô ---- */
function cteDoRobo(){
  const src=fs.readFileSync(path.join(RAIZ,"scripts","buildVrData.cjs"),"utf8");
  const i=src.indexOf("const SQL_SETPROD=`");
  if(i<0) throw new Error("nao achei SQL_SETPROD em buildVrData.cjs — o robo mudou de forma");
  const ini=src.indexOf("`",i)+1;
  const corte=src.indexOf("    r AS (",ini);
  if(corte<0) throw new Error("nao achei a CTE 'r AS (' — o robo mudou de forma");
  let cte=src.slice(ini,corte).replace(/\$\{PISO_DATA\}/g,PISO_DATA);
  return cte.replace(/,\s*$/,"");   // a virgula era pra emendar outra CTE; aqui vem SELECT
}

/* ---- 1b. a tradução do nome do setor mora na nuvem, num lugar só ----
   O VR chama de "NOVO BEBIDAS"; a loja chama de "Bebidas". Quem traduz é a tabela
   vendasetor_apelido, a MESMA que a tela usa — se eu escrevesse os nomes aqui, renomear
   um setor no VR passaria a dar dois nomes diferentes no painel e no papel.
   Ela também diz quem NÃO é venda de setor: "A acertar" (produto ainda sem setor) e
   "Despesa" (lançamento de despesa) ficam de fora, igual na tela.
   TRADUÇÃO VAZIA ABORTA: um 200 com lista vazia (tabela limpa por engano, chave trocada)
   faria todo setor virar "sem apelido" e o papel sairia sem setor nenhum. */
function apelidos(){
  const K=get("SUPABASE_SERVICE_KEY");
  if(!K) return Promise.reject(new Error("sem SUPABASE_SERVICE_KEY no .env"));
  return new Promise((res,rej)=>{
    https.request({host:"uabhsmculsfwzcrhyhch.supabase.co",
      path:"/rest/v1/vendasetor_apelido?select=setor_vr,setor,mostrar",
      headers:{apikey:K,Authorization:"Bearer "+K}},r=>{
      let d=""; r.on("data",c=>d+=c);
      r.on("end",()=>{ if(r.statusCode>=300) return rej(new Error("HTTP "+r.statusCode+" ao ler vendasetor_apelido"));
        let a; try{ a=JSON.parse(d); }catch(e){ return rej(e); }
        if(!a.length) return rej(new Error("vendasetor_apelido voltou VAZIA — nao gero papel sem os nomes dos setores"));
        const m={}; a.forEach(x=>m[(x.setor_vr||"").trim()]=x); res(m); });
    }).on("error",rej).end();
  });
}

/* ---- 2. números e datas no jeito do Brasil ---- */
const MES3=["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
function n0(v){ return Math.round(Number(v)||0).toLocaleString("pt-BR"); }
function pct(de,para){
  if(!(de>0)) return "novo";
  if(Number(para)===0) return "parou de vender";
  return ((para/de-1)*100).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2})+"%";
}
const esc=s=>String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

(async()=>{
  const cte=cteDoRobo();
  const c=new Client({host:get("PG_HOST"),port:+get("PG_PORT"),database:get("PG_DATABASE"),
    user:get("PG_USER"),password:get("PG_PASSWORD"),connectionTimeoutMillis:20000,query_timeout:900000});
  console.log("Conectando no VR...");
  await c.connect();
  try{
    const setor={};
    (await c.query("SELECT mercadologico1 m, descricao FROM public.mercadologico WHERE nivel=1"))
      .rows.forEach(r=>setor[r.m]=(r.descricao||"").trim()||("Setor "+r.m));

    console.log("Comparando todos os produtos (leva ~40s)...");
    const t=Date.now();
    const linhas=(await c.query(cte+"\n SELECT ano_de, ano_para, m1, id_produto, de, para, meses\n FROM soma WHERE para < de")).rows;
    console.log("  "+linhas.length+" quedas em "+((Date.now()-t)/1000).toFixed(0)+"s");
    if(!linhas.length) throw new Error("nenhuma queda voltou — nao gero papel vazio");

    /* par de anos: o mais recente, ou o que foi pedido na linha de comando */
    let aDe=+process.argv[2], aPara=+process.argv[3];
    if(!(aDe>0&&aPara>0)){ aPara=Math.max(...linhas.map(r=>+r.ano_para)); aDe=aPara-1; }
    const doPar=linhas.filter(r=>+r.ano_de===aDe&&+r.ano_para===aPara);
    if(!doPar.length) throw new Error("o par "+aDe+"->"+aPara+" nao tem queda nenhuma");

    /* nomes dos produtos, de 2000 em 2000 */
    const ids=[...new Set(doPar.map(r=>+r.id_produto))];
    const nome={};
    for(let i=0;i<ids.length;i+=2000){
      (await c.query("SELECT id, descricaocompleta n FROM public.produto WHERE id = ANY($1)",[ids.slice(i,i+2000)]))
        .rows.forEach(r=>nome[r.id]=(r.n||"").trim());
    }

    /* A JANELA é a mesma do robô: meses FECHADOS. O mês corrente fica de fora dos dois
       lados — se entrasse pela metade, todo produto apareceria caindo. */
    const hoje=new Date();
    const ultimoMes=(aPara===hoje.getFullYear()) ? hoje.getMonth() : 12;  // getMonth() é 0-based = mês anterior
    const periodo=(ultimoMes===12?"o ano inteiro":MES3[0]+"–"+MES3[ultimoMes-1]);

    /* agrupa por setor, pior primeiro dentro de cada um */
    const apel=await apelidos();
    const porSetor={}; const foraDoPapel={};
    doPar.forEach(r=>{
      const cru=setor[r.m1]||("Setor "+r.m1);
      const a=apel[cru];
      /* setor com mostrar=false NAO e venda de setor: fica fora do papel, igual na tela.
         Setor que o VR tem e a nuvem nao conhece tambem fica de fora, mas eu AVISO no
         fim — silencio aqui seria uma lista incompleta com cara de completa. */
      if(!a || !a.mostrar){ foraDoPapel[cru]=(foraDoPapel[cru]||0)+1; return; }
      const s=a.setor;
      (porSetor[s]=porSetor[s]||[]).push({
        id:r.id_produto, nome:nome[r.id_produto]||("Produto "+r.id_produto),
        de:Number(r.de), para:Number(r.para), dif:Number(r.para)-Number(r.de) });
    });
    /* ordena pela DIFERENÇA, não pela porcentagem: -80% de um produto que vendia 5
       unidades não interessa a ninguém; -12% de um que vendia 30 mil, sim. */
    const setores=Object.keys(porSetor).map(s=>{
      const l=porSetor[s].sort((a,b)=>a.dif-b.dif);
      const perdidas=l.reduce((x,y)=>x-y.dif,0);
      let mostra=l;
      if(CURTO){
        let acc=0, i=0;
        while(i<l.length && i<CURTO_MAX && acc < perdidas*CURTO_COBERTURA){ acc+=-l[i].dif; i++; }
        mostra=l.slice(0,Math.max(i,1));
      }
      const resto=l.slice(mostra.length);
      return { nome:s, lista:mostra, perdidas:perdidas, pararam:l.filter(x=>x.para===0).length,
               total:l.length, restoQtd:resto.length, restoUn:resto.reduce((x,y)=>x-y.dif,0) };
    }).sort((a,b)=>b.perdidas-a.perdidas);

    /* ---- 3. o papel ---- */
    const geradoEm=hoje.toLocaleDateString("pt-BR")+" às "+hoje.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"});
    const totQ=setores.reduce((x,s)=>x+s.total,0), totP=setores.reduce((x,s)=>x+s.perdidas,0), totS=setores.reduce((x,s)=>x+s.pararam,0);
    let h=`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Produtos que caíram de venda</title><style>
@page { size:A4 portrait; margin:14mm 12mm 16mm; }
* { box-sizing:border-box; }
body { font:9pt/1.35 -apple-system,"Helvetica Neue",Arial,sans-serif; color:#1f2b3a; margin:0; }
h1 { font-size:17pt; margin:0 0 2mm; }
h2 { font-size:12pt; margin:0 0 3mm; padding-bottom:1.5mm; border-bottom:2px solid #157a35; color:#157a35; }
.sub { color:#5b6875; font-size:9pt; margin:0 0 6mm; }
.capa { margin-bottom:8mm; }
.cx { display:flex; gap:4mm; margin:0 0 7mm; }
.cx div { flex:1; border:1px solid #d8e2ea; border-radius:2mm; padding:3mm 3.5mm; }
.cx i { display:block; font-style:normal; font-size:7.5pt; text-transform:uppercase; letter-spacing:.4px; color:#6b7787; }
.cx b { display:block; font-size:14pt; margin-top:1mm; }
table { width:100%; border-collapse:collapse; }
thead { display:table-header-group; }
th { font-size:7.5pt; text-transform:uppercase; letter-spacing:.4px; color:#6b7787; text-align:right;
     border-bottom:1px solid #c9d4de; padding:1.6mm 1.5mm; font-weight:600; }
th.e, td.e { text-align:left; }
td { padding:1.1mm 1.5mm; border-bottom:.4px solid #eef2f6; text-align:right; font-variant-numeric:tabular-nums; }
tr { break-inside:avoid; }
.setor { break-before:page; }
.setor:first-of-type { break-before:auto; }
.q { color:#b3261e; }
.parou { color:#b3261e; font-weight:600; white-space:nowrap; }
th.var, td.var { width:26mm; }
th.qtd { width:20mm; }
/* O nome do setor mora DENTRO do thead: assim o Chrome repete em toda folha.
   Num relatorio de 200 e tantas paginas, a folha solta tem que dizer de quem ela e. */
tr.cab th { border-bottom:2px solid #157a35; padding-top:0; padding-bottom:2mm; }
tr.cab .nome { font-size:12pt; color:#157a35; text-transform:none; letter-spacing:0; font-weight:700; }
tr.resto td { color:#6b7787; font-style:italic; border-top:1px solid #c9d4de; border-bottom:none; padding-top:2mm; }
tr.cab .tot { font-size:8.5pt; color:#5b6875; text-transform:none; letter-spacing:0; font-weight:400; }
.fim { margin-top:6mm; color:#8a94a0; font-size:8pt; border-top:1px solid #e6ebf1; padding-top:2mm; }
</style></head><body>
<div class="capa">
  <h1>Produtos que caíram de venda${CURTO?" — resumo":""}</h1>
  <p class="sub">Supermercado Santa Rita &nbsp;·&nbsp; ${periodo} de ${aDe} comparado com ${periodo} de ${aPara}
     &nbsp;·&nbsp; gerado em ${geradoEm}</p>
  <div class="cx">
    <div><i>Produtos que caíram</i><b>${n0(totQ)}</b></div>
    <div><i>Unidades a menos</i><b>${n0(totP)}</b></div>
    <div><i>Pararam de vender</i><b>${n0(totS)}</b></div>
    <div><i>Setores</i><b>${setores.length}</b></div>
  </div>
  <h2>Resumo por setor</h2>
  <table><thead><tr><th class="e">Setor</th><th>Produtos que caíram</th><th>Unidades a menos</th><th>Pararam de vender</th></tr></thead><tbody>
  ${setores.map(s=>`<tr><td class="e">${esc(s.nome)}</td><td>${n0(s.lista.length)}</td><td class="q">${n0(s.perdidas)}</td><td>${n0(s.pararam)}</td></tr>`).join("")}
  </tbody></table>
  ${CURTO?`<p class="fim" style="border-top:none;padding-top:0;margin-bottom:4mm;color:#5b6875;">
  <b>Este é o resumo.</b> Cada setor mostra os produtos que explicam ${Math.round(CURTO_COBERTURA*100)}% da queda daquele
  setor, no máximo ${CURTO_MAX} por folha — os números do quadro acima e da tabela ao lado são os
  do setor INTEIRO, não só do que coube. A lista completa dos ${n0(totQ)} produtos está no relatório
  longo e na planilha.</p>`:``}
  <p class="fim">Comparação em QUANTIDADE (unidades e quilos), não em reais. Venda cancelada não entra —
  nem o item cancelado, nem o cupom inteiro cancelado. Só meses fechados dos dois lados,
  por isso ${MES3[ultimoMes]||"o mês corrente"} não aparece. Produto sem venda no período novo conta como zero,
  que é a maior queda possível. Mesma fonte da aba "Venda por setor" do Painel Santa Rita.</p>
</div>`;

    setores.forEach(s=>{
      const resumo=`${n0(s.total)} produtos caíram · ${n0(s.perdidas)} unidades a menos`
        + (s.pararam?` · ${n0(s.pararam)} pararam de vender`:``);
      h+=`<section class="setor"><table><thead>
<tr class="cab"><th class="e nome" colspan="2">${esc(s.nome)}</th><th class="tot" colspan="3">${resumo}</th></tr>
<tr><th class="e">Produto</th><th class="qtd">${periodo} ${aDe}</th><th class="qtd">${periodo} ${aPara}</th><th class="qtd">Diferença</th><th class="var">Variação</th></tr>
</thead><tbody>`;
      s.lista.forEach(p=>{
        const parou=p.para===0;
        h+=`<tr><td class="e">${esc(p.nome)}</td><td>${n0(p.de)}</td><td>${n0(p.para)}</td>`
          +`<td class="q">${n0(p.dif)}</td><td class="var ${parou?"parou":"q"}">${pct(p.de,p.para)}</td></tr>`;
      });
      if(s.restoQtd) h+=`<tr class="resto"><td class="e">e mais ${n0(s.restoQtd)} produtos que caíram menos</td>`
        +`<td></td><td></td><td class="q">${n0(-s.restoUn)}</td><td></td></tr>`;
      h+=`</tbody></table></section>`;
    });
    h+=`</body></html>`;

    const base="Produtos que cairam"+(CURTO?" (resumo)":"")+" - "+periodo.replace("–","-")+" "+aDe+" x "+aPara;
    const fHtml=path.join(SAIDA,base+".html");
    const fPdf =path.join(SAIDA,base+".pdf");
    const fCsv =path.join(SAIDA,base+".csv");
    fs.writeFileSync(fHtml,h);

    /* planilha: ponto e vírgula + BOM, que é o que o Excel em português espera */
    let csv="﻿Setor;Produto;Codigo;"+periodo+" "+aDe+";"+periodo+" "+aPara+";Diferenca;Variacao\n";
    setores.forEach(s=>s.lista.forEach(p=>{
      const v=p.de>0?(p.para/p.de-1)*100:null;
      csv+=[s.nome,String(p.nome).replace(/;/g,","),p.id,
            String(p.de).replace(".",","),String(p.para).replace(".",","),
            String(p.dif).replace(".",","),
            v==null?"novo":v.toFixed(2).replace(".",",")+"%"].join(";")+"\n";
    }));
    if(!CURTO) fs.writeFileSync(fCsv,csv);

    console.log("Gerando o PDF no Chrome...");
    execFileSync(CHROME,["--headless","--disable-gpu","--no-pdf-header-footer",
      "--print-to-pdf="+fPdf,"file://"+encodeURI(fHtml)],{stdio:"pipe"});

    const mb=f=>(fs.statSync(f).size/1048576).toFixed(2)+" MB";
    console.log("\nPRONTO, na Área de Trabalho:");
    console.log("  "+path.basename(fPdf)+"   ("+mb(fPdf)+")");
    if(!CURTO) console.log("  "+path.basename(fCsv)+"   ("+mb(fCsv)+")");
    console.log("\n"+n0(totQ)+" produtos que cairam"+(CURTO?" ("+n0(setores.reduce((x,s)=>x+s.lista.length,0))+" no papel)":"")+", "+n0(totP)+" unidades a menos, "+setores.length+" setores.");
    const fora=Object.keys(foraDoPapel);
    if(fora.length) console.log("Fora do papel (nao e venda de setor): "+fora.map(k=>k+" ("+foraDoPapel[k]+")").join(", "));
  } finally { try{ await c.end(); }catch(e){} }
})().catch(e=>{ console.log("ERRO: "+e.message); process.exit(1); });
