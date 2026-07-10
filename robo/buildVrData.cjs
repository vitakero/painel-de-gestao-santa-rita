// Lê o PostgreSQL do VR e gera output/vr-data.json com TODOS os resumos
// (por dia, hora, setor, pagamento, operador, ranking de produtos).
// Rodar DE DENTRO da rede da loja: node scripts/buildVrData.cjs
const fs=require("fs");
const path=require("path");
const { Client }=require("pg");
const https=require("https");
const env=fs.readFileSync(path.join(__dirname,"..",".env"),"utf8");
const get=k=>{const m=env.match(new RegExp("^"+k+"=(.*)$","m"));return m?m[1].trim():"";};
const cfg={ host:get("PG_HOST"), port:+get("PG_PORT"), database:get("PG_DATABASE"), user:get("PG_USER"), password:get("PG_PASSWORD"), connectionTimeoutMillis:20000, query_timeout:240000 };

// ---- Sync de produtos/estoque do VR -> Supabase (nuvem), pra aba Loja/Deposito ----
// So LE o VR; ESCREVE na nuvem. NAO apaga a coluna "loja" (bipados) graças ao merge-duplicates.
// PEGADINHA: codigobarras no VR e NUMERIC -> usar ::text em tudo pra nao dar erro de "numeric".
const SB_HOST="uabhsmculsfwzcrhyhch.supabase.co", SB_KEY=get("SUPABASE_SERVICE_KEY");
const PROD_SYNC_MS=3*3600*1000; // no maximo 1x a cada 3h (produto novo aparece em ate 3h)
const PROD_SYNC_SQL="SELECT DISTINCT ON (p.id) pa.codigobarras::text cod, p.descricaocompleta nome, e.estoque::text total FROM public.produto p JOIN public.produtoautomacao pa ON pa.id_produto::text=p.id::text LEFT JOIN public.estoque e ON e.id_produto::text=p.id::text AND e.id_loja::text='1' WHERE pa.codigobarras IS NOT NULL AND trim(pa.codigobarras::text)<>'' ORDER BY p.id, pa.qtdembalagem";
function sbUpsertProdutos(rows){return new Promise((res,rej)=>{const body=JSON.stringify(rows);const req=https.request({host:SB_HOST,path:"/rest/v1/estoque_produtos?on_conflict=cod",method:"POST",headers:{apikey:SB_KEY,Authorization:"Bearer "+SB_KEY,"Content-Type":"application/json",Prefer:"resolution=merge-duplicates,return=minimal","Content-Length":Buffer.byteLength(body)}},r=>{let d="";r.on("data",c=>d+=c);r.on("end",()=>r.statusCode<300?res():rej(new Error("HTTP "+r.statusCode+" "+d)))});req.on("error",rej);req.write(body);req.end();});}

// ---- Cobranca Pix REAL (Sicredi) - worker do robo ----
// O painel INSERE pedidos na tabela pix_cobrancas (status 'pedido'); aqui o robo gera o
// boleto HIBRIDO (QR Pix) no Sicredi e grava o resultado ('gerado'); depois concilia os
// liquidados por dia e marca 'pago' (baixa automatica). As chaves SICREDI_* vivem SO no
// .env da loja (nunca no painel). Sem elas, pula em silencio e o robo segue normal.
const PIX_AMB=(get("SICREDI_AMBIENTE")||"producao").toLowerCase();
const PIX_SANDBOX=(PIX_AMB!=="producao"&&PIX_AMB!=="prod");
const PIX_BASE="https://api-parceiro.sicredi.com.br"+(PIX_SANDBOX?"/sb":"");
const PIX_KEY=PIX_SANDBOX?get("SICREDI_API_KEY"):get("SICREDI_API_KEY_PROD");
const PIX_COOP=PIX_SANDBOX?"6789":get("SICREDI_COOPERATIVA");
const PIX_POSTO=PIX_SANDBOX?"03":get("SICREDI_POSTO");
const PIX_BENEF=PIX_SANDBOX?"12345":get("SICREDI_BENEFICIARIO"); // mesmo numero do username do login
const PIX_AUTH_BODY=PIX_SANDBOX
  ? "grant_type=password&username=123456789&password=teste123&scope=cobranca" // credenciais de TESTE fixas do manual
  : "grant_type=password&username="+encodeURIComponent(get("SICREDI_BENEFICIARIO")+get("SICREDI_COOPERATIVA"))+"&password="+encodeURIComponent(get("SICREDI_API_PASSWORD"))+"&scope=cobranca";
const PIX_CONC_MS=45*60*1000; // conciliacao (quem pagou?) no maximo 1x a cada 45 min
const PIX_TIMEOUT=()=>AbortSignal.timeout(30000); // nenhum fetch do worker pode travar a rodada
async function pixSbGet(q){ const r=await fetch("https://"+SB_HOST+"/rest/v1/"+q,{headers:{apikey:SB_KEY,Authorization:"Bearer "+SB_KEY},signal:PIX_TIMEOUT()}); if(!r.ok) throw new Error("Supabase GET HTTP "+r.status); return r.json(); }
// filtro = query string do PostgREST (ex: "id=eq.5" ou "id=eq.5&status=eq.pedido")
async function pixSbPatch(filtro,campos){ const r=await fetch("https://"+SB_HOST+"/rest/v1/pix_cobrancas?"+filtro,{method:"PATCH",headers:{apikey:SB_KEY,Authorization:"Bearer "+SB_KEY,"Content-Type":"application/json",Prefer:"return=minimal"},body:JSON.stringify(campos),signal:PIX_TIMEOUT()}); if(!r.ok) throw new Error("Supabase PATCH HTTP "+r.status+" "+(await r.text()).slice(0,200)); }
// igual, mas devolve as linhas alteradas (pra saber se a "reivindicacao" pegou)
async function pixSbPatchRep(filtro,campos){ const r=await fetch("https://"+SB_HOST+"/rest/v1/pix_cobrancas?"+filtro,{method:"PATCH",headers:{apikey:SB_KEY,Authorization:"Bearer "+SB_KEY,"Content-Type":"application/json",Prefer:"return=representation"},body:JSON.stringify(campos),signal:PIX_TIMEOUT()}); if(!r.ok) throw new Error("Supabase PATCH HTTP "+r.status); return r.json(); }
async function pixToken(){ const r=await fetch(PIX_BASE+"/auth/openapi/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded","context":"COBRANCA","x-api-key":PIX_KEY},body:PIX_AUTH_BODY,signal:PIX_TIMEOUT()}); if(!r.ok) throw new Error("Sicredi auth HTTP "+r.status+" "+(await r.text()).slice(0,200)); return (await r.json()).access_token; }

const d10=v=> (v instanceof Date) ? v.toISOString().slice(0,10) : String(v).slice(0,10);
const num=v=> Math.round(Number(v||0)*100)/100;

async function timed(c,nome,sql,params){
  const t=Date.now();
  const r=await c.query(sql,params||[]);
  console.log("  ["+((Date.now()-t)/1000).toFixed(1)+"s] "+nome+": "+r.rowCount+" linhas");
  return r.rows;
}

(async()=>{
  // TRAVA ANTI-DUPLICATA: se outra rodada terminou ha menos de 4 min (robo duplicado
  // rodando junto), esta PULA em silencio — so um trabalha por vez, sem pesar o VR.
  // (4 min combina com o loop de 5 min do robo-loop.vbs: a propria rodada seguinte
  //  chega com ~5-6 min de idade e passa; um duplicado colado no meio e barrado.)
  const lockF=path.join(__dirname,"..","output","last-vendas-run.txt");
  try{
    const last=Number(fs.readFileSync(lockF,"utf8"))||0;
    if(Date.now()-last < 4*60*1000){ console.log("Outra rodada acabou de terminar (robo duplicado?). Pulando esta pra nao pesar o VR."); process.exit(0); }
  }catch(e){}

  const c=new Client(cfg); await c.connect();
  console.log("Conectado. Gerando resumos (pode levar ~2-3 min)...\n");

  // ---- dicionarios (nomes) ----
  const setorMap={}; // mercadologico1 -> nome do setor (nivel 1)
  (await timed(c,"setores",`SELECT mercadologico1 m, descricao FROM public.mercadologico WHERE nivel=1`))
    .forEach(r=>setorMap[r.m]=(r.descricao||"").trim()||("Setor "+r.m));
  const opMap={}; // matricula -> nome
  (await timed(c,"operadores",`SELECT matricula, nome FROM pdv.operador`))
    .forEach(r=>opMap[r.matricula]=(r.nome||"").trim()||("Op "+r.matricula));
  const pagMap={}; // id_finalizadora -> nome
  (await timed(c,"finalizadoras",`SELECT id, descricao FROM pdv.finalizadora`))
    .forEach(r=>pagMap[r.id]=(r.descricao||"").trim()||("Forma "+r.id));

  // ---- DIA: faturamento (cupom, = VR Venda Liquida) + margem/qtd (itens) + cupons ----
  // Faturamento pelo TOTAL DO CUPOM (subtotalimpressora), igual ao que o VR mostra como
  // "Venda Liquida" e ao que os graficos de hora/operador ja usam. (Antes somava item a
  // item com vendaitem.valortotal, o que contava itens de cupons cancelados e nao abatia
  // descontos -> dava ~R$657 a mais que o VR.)
  const diaFat=await timed(c,"DIA faturamento (cupom)",`
    SELECT data, SUM(subtotalimpressora) fat FROM pdv.venda WHERE cancelado=false GROUP BY data`);
  const fatByDia={}; diaFat.forEach(r=>fatByDia[d10(r.data)]=num(r.fat));
  const diaIt=await timed(c,"DIA itens (margem/qtd/nprod)",`
    SELECT data,
           SUM(valortotal - COALESCE(customediosemimposto,0)*quantidade) marg,
           SUM(quantidade) qtd,
           COUNT(*) nprod
    FROM pdv.vendaitem WHERE cancelado=false GROUP BY data`);
  const diaCup=await timed(c,"DIA cupons",`
    SELECT data, COUNT(*) cup FROM pdv.venda WHERE cancelado=false GROUP BY data`);
  const cupByDia={}; diaCup.forEach(r=>cupByDia[d10(r.data)]=Number(r.cup));
  const DIA=diaIt.map(r=>({d:d10(r.data),fat:fatByDia[d10(r.data)]||0,marg:num(r.marg),qtd:num(r.qtd),nprod:Number(r.nprod),cup:cupByDia[d10(r.data)]||0}))
                 .sort((a,b)=>a.d<b.d?-1:1);

  // ---- HORA: dia x hora (cabecalho) ----
  const HORA=(await timed(c,"HORA",`
    SELECT data, to_char(horainicio,'HH24') h, SUM(subtotalimpressora) fat
    FROM pdv.venda WHERE cancelado=false AND horainicio IS NOT NULL GROUP BY 1,2`))
    .map(r=>({d:d10(r.data),h:r.h,fat:num(r.fat)}));

  // ---- OPERADOR: dia x operador (cabecalho) ----
  const OP=(await timed(c,"OPERADOR",`
    SELECT data, matricula, SUM(subtotalimpressora) fat, COUNT(*) cup
    FROM pdv.venda WHERE cancelado=false GROUP BY 1,2`))
    .map(r=>({d:d10(r.data),o:opMap[r.matricula]||("Op "+r.matricula),fat:num(r.fat),cup:Number(r.cup)}));

  // ---- PAGAMENTO: dia x finalizadora ----
  const PAG=(await timed(c,"PAGAMENTO",`
    SELECT c.data, vf.id_finalizadora f, SUM(vf.valor) fat
    FROM pdv.vendafinalizadora vf JOIN pdv.venda c ON c.id=vf.id_venda
    WHERE c.cancelado=false GROUP BY 1,2`))
    .map(r=>({d:d10(r.data),p:pagMap[r.f]||("Forma "+r.f),fat:num(r.fat)}));

  // ---- SETOR: dia x setor (itens x produto) ----
  const SETOR=(await timed(c,"SETOR",`
    SELECT v.data, p.mercadologico1 m, SUM(v.valortotal) fat
    FROM pdv.vendaitem v JOIN public.produto p ON p.id=v.id_produto
    WHERE v.cancelado=false GROUP BY 1,2`))
    .map(r=>({d:d10(r.data),s:setorMap[r.m]||("Setor "+r.m),fat:num(r.fat)}));

  // ---- RANKING PRODUTOS por mes (top 300/mes) ----
  const mp=await timed(c,"RANKING produtos/mes (top300)",`
    WITH mp AS (
      SELECT to_char(date_trunc('month',data),'YYYY-MM') mes, id_produto,
             SUM(quantidade) qtd, SUM(valortotal) fat
      FROM pdv.vendaitem WHERE cancelado=false GROUP BY 1,2)
    SELECT mes, id_produto, qtd, fat FROM (
      SELECT *, row_number() OVER (PARTITION BY mes ORDER BY fat DESC) rn FROM mp) t
    WHERE rn<=300`);
  // nomes dos produtos que aparecem no ranking
  const ids=[...new Set(mp.map(r=>r.id_produto))];
  const nomeProd={};
  for(let i=0;i<ids.length;i+=2000){
    const chunk=ids.slice(i,i+2000);
    (await c.query(`SELECT id, descricaocompleta n FROM public.produto WHERE id = ANY($1)`,[chunk]))
      .rows.forEach(r=>nomeProd[r.id]=(r.n||"").trim());
  }
  const MESPROD=mp.map(r=>({m:r.mes,id:String(r.id_produto),nome:nomeProd[r.id_produto]||("Prod "+r.id_produto),qtd:num(r.qtd),fat:num(r.fat)}));

  await c.end();

  const data={ gerado:new Date().toISOString(), DIA, HORA, OP, PAG, SETOR, MESPROD };
  const outDir=path.join(__dirname,"..","output");
  if(!fs.existsSync(outDir)) fs.mkdirSync(outDir);
  const file=path.join(outDir,"vr-data.json");
  fs.writeFileSync(file, JSON.stringify(data));
  const mb=(fs.statSync(file).size/1048576).toFixed(2);
  try{ fs.writeFileSync(lockF, String(Date.now())); }catch(e){}
  console.log("\nOK -> output/vr-data.json ("+mb+" MB)");
  console.log("Linhas: DIA="+DIA.length+" HORA="+HORA.length+" OP="+OP.length+" PAG="+PAG.length+" SETOR="+SETOR.length+" MESPROD="+MESPROD.length);
  console.log("Periodo: "+(DIA[0]&&DIA[0].d)+" a "+(DIA[DIA.length-1]&&DIA[DIA.length-1].d));

  // ---- SYNC de produtos/estoque pra nuvem (conexao NOVA e separada, no fim; throttle 3h; nunca derruba o robo) ----
  // Fica por ultimo e em conexao propria pra nao competir com as consultas de vendas (que sao a prioridade).
  const markF=path.join(__dirname,"..","output","last-produto-sync.txt");
  try{
    let ultima=0; try{ ultima=Number(fs.readFileSync(markF,"utf8"))||0; }catch(e){}
    if(!SB_KEY){ console.log("Sync produtos: sem SUPABASE_SERVICE_KEY no .env - pulando."); }
    else if(Date.now()-ultima < PROD_SYNC_MS){ console.log("Sync produtos: feito ha < 3h - pulando."); }
    else {
      console.log("\nSync produtos: lendo o catalogo do VR (conexao nova, pode levar 1-2 min)...");
      const c2=new Client({ ...cfg, query_timeout:600000, statement_timeout:600000 });
      await c2.connect();
      const prodRows=(await c2.query(PROD_SYNC_SQL)).rows;
      await c2.end();
      const dados=prodRows.map(r=>({cod:String(r.cod).trim().replace(/\.0+$/,""),nome:r.nome||"",total:Math.round(parseFloat(String(r.total==null?"":r.total).replace(",","."))||0)}));
      let ok=0;
      for(let i=0;i<dados.length;i+=500){ await sbUpsertProdutos(dados.slice(i,i+500)); ok+=Math.min(500,dados.length-i); }
      try{ fs.writeFileSync(markF, String(Date.now())); }catch(e){}
      console.log("Sync produtos: "+ok+" produtos enviados pra nuvem (Loja/Deposito).");
    }
  }catch(e){ console.log("Sync produtos: erro ("+e.message+") - robo segue normal, produtos na proxima."); }

  // ---- WORKER PIX (Sicredi): gera as cobrancas pedidas no painel + concilia os pagos ----
  // Roda por ultimo, so fala https (Supabase + Sicredi), e NUNCA derruba a rodada.
  try{
    // trava do worker: nao deixa duas rodadas cuidarem das cobrancas ao mesmo tempo
    const pixLockF=path.join(__dirname,"..","output","last-pix-start.txt");
    let pixLivre=true;
    try{ const lst=Number(fs.readFileSync(pixLockF,"utf8"))||0; if(Date.now()-lst < 4*60*1000) pixLivre=false; }catch(e){}
    if(!SB_KEY){ console.log("Pix: sem SUPABASE_SERVICE_KEY no .env - pulando."); }
    else if(!PIX_KEY || !PIX_COOP || !PIX_POSTO || !PIX_BENEF || (!PIX_SANDBOX && !get("SICREDI_API_PASSWORD"))){ console.log("Pix: bloco SICREDI incompleto no .env - pulando (cole o bloco SICREDI do Mac no .env da loja)."); }
    else if(!pixLivre){ console.log("Pix: outra rodada esta cuidando das cobrancas agora - pulando."); }
    else {
      try{ fs.writeFileSync(pixLockF, String(Date.now())); }catch(e){}
      // token do Sicredi vale 300s -> renova sozinho aos 240s (lote grande nao "envenena" pedidos)
      let pixTok=null, pixTokAt=0;
      const pegaTok=async()=>{ if(!pixTok || Date.now()-pixTokAt>240000){ pixTok=await pixToken(); pixTokAt=Date.now(); } return pixTok; };

      // 0) recuperacao: linha presa em "gerando" = rodada anterior caiu no meio da geracao.
      //    NAO recriamos as cegas (o boleto PODE ter sido criado no banco) - vira "erro" com aviso.
      const presas=await pixSbGet("pix_cobrancas?status=eq.gerando&select=id,seu_numero");
      for(const pr of presas){
        try{ await pixSbPatch("id=eq."+pr.id+"&status=eq.gerando",{status:"erro",erro_msg:"A rodada anterior caiu no meio da geracao. Confira no Sicredi se o boleto (seu numero "+(pr.seu_numero||"?")+") ja existe antes de clicar em Tentar de novo."}); }catch(e){}
      }

      // 0.5) cancelamentos pedidos no painel (status "cancelar") -> baixa no Sicredi
      const cancels=await pixSbGet("pix_cobrancas?status=eq.cancelar&select=id,nosso_numero&limit=25");
      for(const cc of cancels){
        try{
          if(!cc.nosso_numero){ await pixSbPatch("id=eq."+cc.id,{status:"cancelado"}); continue; }
          const r=await fetch(PIX_BASE+"/cobranca/boleto/v1/boletos/"+encodeURIComponent(cc.nosso_numero)+"/baixa",{method:"PATCH",headers:{"Content-Type":"application/json","x-api-key":PIX_KEY,Authorization:"Bearer "+(await pegaTok()),cooperativa:PIX_COOP,posto:PIX_POSTO,codigoBeneficiario:PIX_BENEF},body:"{}",signal:PIX_TIMEOUT()});
          const txt=await r.text();
          let msg=""; try{ msg=JSON.parse(txt).message||""; }catch(e2){}
          if(r.status===202 || msg.indexOf("baixado")>=0){ await pixSbPatch("id=eq."+cc.id,{status:"cancelado"}); console.log("Pix: cobranca #"+cc.id+" CANCELADA (baixa no banco)."); }
          else if(msg.indexOf("liquidado")>=0){ await pixSbPatch("id=eq."+cc.id,{status:"gerado"}); console.log("Pix: cobranca #"+cc.id+" ja foi PAGA - cancelamento ignorado (a conciliacao marca)."); }
          else if(msg.indexOf("processamento")>=0){ console.log("Pix: cancelamento #"+cc.id+" em processamento no banco - proxima rodada."); }
          else if(r.status===401 || r.status===429 || r.status>=500){ pixTok=null; console.log("Pix: cancelamento #"+cc.id+" banco instavel (HTTP "+r.status+") - proxima rodada."); }
          else { await pixSbPatch("id=eq."+cc.id,{status:"gerado"}); console.log("Pix: cancelamento #"+cc.id+" recusado pelo banco: "+String(msg||("HTTP "+r.status)).slice(0,120)); }
        }catch(e){ console.log("Pix: cancelamento #"+cc.id+" falhou ("+e.message+")."); }
      }

      // 1) pedidos do painel -> criar boleto hibrido (QR Pix) no Sicredi
      const pedidos=await pixSbGet("pix_cobrancas?status=eq.pedido&select=*&order=id&limit=25");
      for(const pd of pedidos){
        const seuNum=String(pd.id).padStart(10,"0").slice(-10); // ate 10 chars, so digitos
        try{
          const doc=String(pd.documento||"").replace(/\D/g,"");
          if(!doc || (doc.length!==11 && doc.length!==14)){ await pixSbPatch("id=eq."+pd.id,{status:"erro",erro_msg:"CPF/CNPJ do fornecedor invalido ou vazio. Preencha o CNPJ no cadastro do ponto e clique em Tentar de novo."}); continue; }
          const ag=new Date(); const hj=ag.getFullYear()+"-"+String(ag.getMonth()+1).padStart(2,"0")+"-"+String(ag.getDate()).padStart(2,"0");
          let venc=String(pd.vencimento||"").slice(0,10);
          if(!venc || venc<hj) venc=hj; // banco nao aceita vencimento no passado
          await pegaTok(); // autentica ANTES de reivindicar (falha de login nao trava o pedido)
          // reivindica o pedido ANTES de falar com o banco (evita boleto duplicado entre rodadas)
          const claim=await pixSbPatchRep("id=eq."+pd.id+"&status=eq.pedido",{status:"gerando",seu_numero:seuNum});
          if(!claim.length) continue; // outra rodada ja pegou este
          const corpo={ tipoCobranca:"HIBRIDO", codigoBeneficiario:PIX_BENEF,
            pagador:{ tipoPessoa:(doc.length===14?"PESSOA_JURIDICA":"PESSOA_FISICA"), documento:doc, nome:String(pd.fornecedor||"Fornecedor").slice(0,40) },
            especieDocumento:"OUTROS", seuNumero:seuNum, dataVencimento:venc,
            valor:Math.round(Number(pd.valor)*100)/100, validadeAposVencimento:60 };
          const r=await fetch(PIX_BASE+"/cobranca/boleto/v1/boletos",{method:"POST",headers:{"Content-Type":"application/json","x-api-key":PIX_KEY,Authorization:"Bearer "+(await pegaTok()),cooperativa:PIX_COOP,posto:PIX_POSTO},body:JSON.stringify(corpo),signal:PIX_TIMEOUT()});
          const txt=await r.text();
          if(!r.ok){
            if(r.status===401 || r.status===429 || r.status>=500){ // instabilidade passageira: volta pra fila
              pixTok=null;
              await pixSbPatch("id=eq."+pd.id+"&status=eq.gerando",{status:"pedido",seu_numero:null});
              console.log("Pix: pedido #"+pd.id+" banco instavel (HTTP "+r.status+") - tenta na proxima rodada."); continue;
            }
            let msg="HTTP "+r.status; try{ msg=JSON.parse(txt).message||msg; }catch(e2){}
            await pixSbPatch("id=eq."+pd.id,{status:"erro",erro_msg:String(msg).slice(0,300)});
            console.log("Pix: pedido #"+pd.id+" recusado pelo banco: "+String(msg).slice(0,120)); continue;
          }
          const b=JSON.parse(txt);
          await pixSbPatch("id=eq."+pd.id,{status:"gerado",txid:b.txid||null,nosso_numero:b.nossoNumero||null,linha_digitavel:b.linhaDigitavel||null,codigo_barras:b.codigoBarras||null,qr_code:b.qrCode||null,seu_numero:seuNum,erro_msg:null,vencimento:venc});
          console.log("Pix: pedido #"+pd.id+" GERADO (nosso numero "+(b.nossoNumero||"?")+", venc "+venc+").");
        }catch(e){
          // se ja tinha reivindicado ("gerando"), o boleto PODE ter sido criado -> erro com aviso;
          // se ainda estava "pedido", o filtro nao casa e ele volta sozinho na proxima rodada.
          try{ await pixSbPatch("id=eq."+pd.id+"&status=eq.gerando",{status:"erro",erro_msg:"Falha de rede durante a geracao ("+String(e.message).slice(0,120)+"). Confira no Sicredi se o boleto (seu numero "+seuNum+") ja existe antes de Tentar de novo."}); }catch(e2){}
          console.log("Pix: pedido #"+pd.id+" falhou ("+e.message+").");
        }
      }

      // 2) conciliacao: quem pagou? (liquidados por dia). A janela cresce se o robo ficou
      //    parado (ate 30 dias), e olha dias pra tras porque Pix pago no fim de semana
      //    entra com a data do dia util seguinte.
      const concF=path.join(__dirname,"..","output","last-pix-concilia.txt");
      let ultC=0; try{ ultC=Number(fs.readFileSync(concF,"utf8"))||0; }catch(e){}
      if(Date.now()-ultC >= PIX_CONC_MS){
        // inclui as "erro" com seu_numero: se o boleto chegou a nascer no banco e for pago,
        // a baixa automatica acontece mesmo assim (casamos por nosso numero OU seu numero)
        const abertas=await pixSbGet("pix_cobrancas?status=in.(gerado,erro)&select=id,nosso_numero,seu_numero&limit=1000");
        if(abertas.length){
          const diasVolta=Math.min(30, Math.max(4, ultC ? Math.ceil((Date.now()-ultC)/86400000)+2 : 8));
          const pagosNN={}, pagosSN={};
          for(let volta=0;volta<diasVolta;volta++){
            const d=new Date(Date.now()-volta*86400000);
            const dia=String(d.getDate()).padStart(2,"0")+"/"+String(d.getMonth()+1).padStart(2,"0")+"/"+d.getFullYear();
            let pag=0,mais=true;
            while(mais){
              const r=await fetch(PIX_BASE+"/cobranca/boleto/v1/boletos/liquidados/dia?codigoBeneficiario="+encodeURIComponent(PIX_BENEF)+"&dia="+encodeURIComponent(dia)+"&pagina="+pag,{headers:{"x-api-key":PIX_KEY,Authorization:"Bearer "+(await pegaTok()),cooperativa:PIX_COOP,posto:PIX_POSTO},signal:PIX_TIMEOUT()});
              if(r.status===404) break; // nada pago nesse dia
              if(!r.ok) throw new Error("liquidados "+dia+" HTTP "+r.status);
              const j=await r.json();
              (j.items||[]).forEach(it=>{ if(it.nossoNumero) pagosNN[String(it.nossoNumero)]=it; if(it.seuNumero) pagosSN[String(it.seuNumero).trim()]=it; });
              mais=String(j.hasNext)==="true"; pag++;
              if(pag>40) break; // trava de seguranca
            }
          }
          let baixas=0;
          for(const ab of abertas){
            let it=ab.nosso_numero?pagosNN[String(ab.nosso_numero)]:null;
            if(!it && ab.seu_numero) it=pagosSN[String(ab.seu_numero).trim()];
            if(!it) continue;
            try{
              // dataPagamento pode vir "YYYY-MM-DD hh:mm" ou "DD/MM/YYYY" - normaliza pros dois
              const dp=String(it.dataPagamento||""); const mBr=dp.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
              const pagoEm=mBr?(mBr[3]+"-"+mBr[2]+"-"+mBr[1]):(dp.slice(0,10)||null);
              await pixSbPatch("id=eq."+ab.id,{status:"pago",pago_em:pagoEm,valor_liquidado:Math.round(Number(it.valorLiquidado||0)*100)/100,tipo_liquidacao:it.tipoLiquidacao||null,nosso_numero:ab.nosso_numero||String(it.nossoNumero||"")||null,erro_msg:null});
              baixas++; console.log("Pix: cobranca #"+ab.id+" PAGA ("+(it.tipoLiquidacao||"?")+") - baixa automatica.");
            }catch(e){ console.log("Pix: baixa da cobranca #"+ab.id+" falhou ("+e.message+") - proxima rodada."); }
          }
          if(!baixas) console.log("Pix: conciliacao ok, nenhum pagamento novo ("+abertas.length+" em aberto).");
        }
        try{ fs.writeFileSync(concF, String(Date.now())); }catch(e){}
      }
    }
  }catch(e){ console.log("Pix: erro ("+e.message+") - robo segue normal, tenta na proxima."); }
})().catch(e=>{ console.log("ERRO: "+e.message); process.exit(1); });
