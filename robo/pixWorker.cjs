// Mini-robo do PIX ("faixa expressa"): roda a cada 1 min na loja e cuida SO das
// cobrancas Pix (Sicredi) pedidas no painel — o robo grandao do VR continua no
// ritmo dele, intocado. O worker embutido no buildVrData.cjs vira RESERVA: ele so
// age se este aqui ficar parado por 4+ min (os dois respeitam a mesma trava
// output/last-pix-start.txt). Chamado pelo pix.bat (loop do pix-loop.vbs).
// Uso: node scripts/pixWorker.cjs
const fs=require("fs");
const path=require("path");
const env=fs.readFileSync(path.join(__dirname,"..",".env"),"utf8");
const get=k=>{const m=env.match(new RegExp("^"+k+"=(.*)$","m"));return m?m[1].trim():"";};

const SB_HOST="uabhsmculsfwzcrhyhch.supabase.co", SB_KEY=get("SUPABASE_SERVICE_KEY");
const PIX_AMB=(get("SICREDI_AMBIENTE")||"producao").toLowerCase();
const PIX_SANDBOX=(PIX_AMB!=="producao"&&PIX_AMB!=="prod");
const PIX_BASE="https://api-parceiro.sicredi.com.br"+(PIX_SANDBOX?"/sb":"");
const PIX_KEY=PIX_SANDBOX?get("SICREDI_API_KEY"):get("SICREDI_API_KEY_PROD");
const PIX_COOP=PIX_SANDBOX?"6789":get("SICREDI_COOPERATIVA");
const PIX_POSTO=PIX_SANDBOX?"03":get("SICREDI_POSTO");
const PIX_BENEF=PIX_SANDBOX?"12345":get("SICREDI_BENEFICIARIO");
const PIX_AUTH_BODY=PIX_SANDBOX
  ? "grant_type=password&username=123456789&password=teste123&scope=cobranca" // teste fixo do manual
  : "grant_type=password&username="+encodeURIComponent(get("SICREDI_BENEFICIARIO")+get("SICREDI_COOPERATIVA"))+"&password="+encodeURIComponent(get("SICREDI_API_PASSWORD"))+"&scope=cobranca";
const PIX_CONC_MS=10*1000; // conciliacao (quem pagou?) a cada ~10s (so consulta status = leitura, sem risco)
const PIX_TIMEOUT=()=>AbortSignal.timeout(30000);
async function pixSbGet(q){ const r=await fetch("https://"+SB_HOST+"/rest/v1/"+q,{headers:{apikey:SB_KEY,Authorization:"Bearer "+SB_KEY},signal:PIX_TIMEOUT()}); if(!r.ok) throw new Error("Supabase GET HTTP "+r.status); return r.json(); }
async function pixSbPatch(filtro,campos){ const r=await fetch("https://"+SB_HOST+"/rest/v1/pix_cobrancas?"+filtro,{method:"PATCH",headers:{apikey:SB_KEY,Authorization:"Bearer "+SB_KEY,"Content-Type":"application/json",Prefer:"return=minimal"},body:JSON.stringify(campos),signal:PIX_TIMEOUT()}); if(!r.ok) throw new Error("Supabase PATCH HTTP "+r.status+" "+(await r.text()).slice(0,200)); }
async function pixSbPatchRep(filtro,campos){ const r=await fetch("https://"+SB_HOST+"/rest/v1/pix_cobrancas?"+filtro,{method:"PATCH",headers:{apikey:SB_KEY,Authorization:"Bearer "+SB_KEY,"Content-Type":"application/json",Prefer:"return=representation"},body:JSON.stringify(campos),signal:PIX_TIMEOUT()}); if(!r.ok) throw new Error("Supabase PATCH HTTP "+r.status); return r.json(); }
async function pixToken(){ const r=await fetch(PIX_BASE+"/auth/openapi/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded","context":"COBRANCA","x-api-key":PIX_KEY},body:PIX_AUTH_BODY,signal:PIX_TIMEOUT()}); if(!r.ok) throw new Error("Sicredi auth HTTP "+r.status+" "+(await r.text()).slice(0,200)); return (await r.json()).access_token; }

(async()=>{
  // trava compartilhada com o robo grandao: quem escreveu ha pouco esta cuidando.
  // (o pix-loop.vbs espera cada rodada terminar antes de dormir, entao nao ha
  //  duas rodadas expressas ao mesmo tempo; a trava protege contra o buildVrData)
  const pixLockF=path.join(__dirname,"..","output","last-pix-start.txt");
  try{ const lst=Number(fs.readFileSync(pixLockF,"utf8"))||0; if(Date.now()-lst < 6*1000){ console.log("Pix: rodada de ha pouco ainda vale - pulando."); return; } }catch(e){}
  if(!SB_KEY){ console.log("Pix: sem SUPABASE_SERVICE_KEY no .env - pulando."); return; }
  if(!PIX_KEY || !PIX_COOP || !PIX_POSTO || !PIX_BENEF || (!PIX_SANDBOX && !get("SICREDI_API_PASSWORD"))){ console.log("Pix: bloco SICREDI incompleto no .env - pulando."); return; }
  try{ fs.writeFileSync(pixLockF, String(Date.now())); }catch(e){}

  // token do Sicredi vale 300s -> renova sozinho aos 240s
  let pixTok=null, pixTokAt=0;
  const pegaTok=async()=>{ if(!pixTok || Date.now()-pixTokAt>240000){ pixTok=await pixToken(); pixTokAt=Date.now(); } return pixTok; };

  // 0) recuperacao: linha presa em "gerando" = rodada anterior caiu no meio.
  const presas=await pixSbGet("pix_cobrancas?status=eq.gerando&select=id,seu_numero");
  for(const pr of presas){
    try{ await pixSbPatch("id=eq."+pr.id+"&status=eq.gerando",{status:"erro",erro_msg:"A rodada anterior caiu no meio da geracao. Confira no Sicredi se o boleto (seu numero "+(pr.seu_numero||"?")+") ja existe antes de clicar em Tentar de novo."}); }catch(e){}
  }

  // 0.5) cancelamentos pedidos no painel -> baixa no Sicredi
  const cancels=await pixSbGet("pix_cobrancas?status=eq.cancelar&select=id,nosso_numero&limit=25");
  for(const cc of cancels){
    try{
      if(!cc.nosso_numero){ await pixSbPatch("id=eq."+cc.id,{status:"cancelado"}); continue; }
      const r=await fetch(PIX_BASE+"/cobranca/boleto/v1/boletos/"+encodeURIComponent(cc.nosso_numero)+"/baixa",{method:"PATCH",headers:{"Content-Type":"application/json","x-api-key":PIX_KEY,Authorization:"Bearer "+(await pegaTok()),cooperativa:PIX_COOP,posto:PIX_POSTO,codigoBeneficiario:PIX_BENEF},body:"{}",signal:PIX_TIMEOUT()});
      const txt=await r.text();
      let msg=""; try{ msg=JSON.parse(txt).message||""; }catch(e2){}
      const ml=msg.toLowerCase();
      if(r.status===202 || ml.indexOf("baixado")>=0){ await pixSbPatch("id=eq."+cc.id,{status:"cancelado"}); console.log("Pix: cobranca #"+cc.id+" CANCELADA (baixa no banco)."); }
      else if(ml.indexOf("liquidado")>=0){ await pixSbPatch("id=eq."+cc.id,{status:"gerado"}); console.log("Pix: cobranca #"+cc.id+" ja foi PAGA - cancelamento ignorado."); }
      // "aguardando confirmacao" = titulo recem-criado ainda assentando no banco; "processamento" = baixa anterior rodando. Insiste (mantem status "cancelar").
      else if(ml.indexOf("processamento")>=0 || ml.indexOf("aguardando")>=0 || ml.indexOf("confirma")>=0){ console.log("Pix: cancelamento #"+cc.id+" o banco ainda esta liberando (\""+String(msg).slice(0,60)+"\") - insiste na proxima rodada."); }
      else if(r.status===401 || r.status===429 || r.status>=500){ pixTok=null; console.log("Pix: cancelamento #"+cc.id+" banco instavel (HTTP "+r.status+") - proxima rodada."); }
      else { await pixSbPatch("id=eq."+cc.id,{status:"gerado"}); console.log("Pix: cancelamento #"+cc.id+" recusado pelo banco: "+String(msg||("HTTP "+r.status)).slice(0,120)); }
    }catch(e){ console.log("Pix: cancelamento #"+cc.id+" falhou ("+e.message+")."); }
  }

  // 1) pedidos do painel -> criar boleto hibrido (QR Pix) no Sicredi
  const pedidos=await pixSbGet("pix_cobrancas?status=eq.pedido&select=*&order=id&limit=25");
  for(const pd of pedidos){
    const seuNum=String(pd.id).padStart(10,"0").slice(-10);
    try{
      const doc=String(pd.documento||"").replace(/\D/g,"");
      if(!doc || (doc.length!==11 && doc.length!==14)){ await pixSbPatch("id=eq."+pd.id,{status:"erro",erro_msg:"CPF/CNPJ do fornecedor invalido ou vazio. Preencha o CNPJ no cadastro do ponto e clique em Tentar de novo."}); continue; }
      const ag=new Date(); const hj=ag.getFullYear()+"-"+String(ag.getMonth()+1).padStart(2,"0")+"-"+String(ag.getDate()).padStart(2,"0");
      let venc=String(pd.vencimento||"").slice(0,10);
      if(!venc || venc<hj) venc=hj;
      await pegaTok(); // autentica ANTES de reivindicar (falha de login nao trava o pedido)
      const claim=await pixSbPatchRep("id=eq."+pd.id+"&status=eq.pedido",{status:"gerando",seu_numero:seuNum});
      if(!claim.length) continue; // outro worker ja pegou
      const corpo={ tipoCobranca:"HIBRIDO", codigoBeneficiario:PIX_BENEF,
        pagador:{ tipoPessoa:(doc.length===14?"PESSOA_JURIDICA":"PESSOA_FISICA"), documento:doc, nome:String(pd.fornecedor||"Fornecedor").slice(0,40) },
        especieDocumento:"OUTROS", seuNumero:seuNum, dataVencimento:venc,
        valor:Math.round(Number(pd.valor)*100)/100, validadeAposVencimento:60 };
      const r=await fetch(PIX_BASE+"/cobranca/boleto/v1/boletos",{method:"POST",headers:{"Content-Type":"application/json","x-api-key":PIX_KEY,Authorization:"Bearer "+(await pegaTok()),cooperativa:PIX_COOP,posto:PIX_POSTO},body:JSON.stringify(corpo),signal:PIX_TIMEOUT()});
      const txt=await r.text();
      if(!r.ok){
        if(r.status===401 || r.status===429 || r.status>=500){
          pixTok=null;
          await pixSbPatch("id=eq."+pd.id+"&status=eq.gerando",{status:"pedido",seu_numero:null});
          console.log("Pix: pedido #"+pd.id+" banco instavel (HTTP "+r.status+") - proxima rodada."); continue;
        }
        let msg="HTTP "+r.status; try{ msg=JSON.parse(txt).message||msg; }catch(e2){}
        await pixSbPatch("id=eq."+pd.id,{status:"erro",erro_msg:String(msg).slice(0,300)});
        console.log("Pix: pedido #"+pd.id+" recusado pelo banco: "+String(msg).slice(0,120)); continue;
      }
      const b=JSON.parse(txt);
      await pixSbPatch("id=eq."+pd.id,{status:"gerado",txid:b.txid||null,nosso_numero:b.nossoNumero||null,linha_digitavel:b.linhaDigitavel||null,codigo_barras:b.codigoBarras||null,qr_code:b.qrCode||null,seu_numero:seuNum,erro_msg:null,vencimento:venc});
      console.log("Pix: pedido #"+pd.id+" GERADO (nosso numero "+(b.nossoNumero||"?")+", venc "+venc+").");
    }catch(e){
      try{ await pixSbPatch("id=eq."+pd.id+"&status=eq.gerando",{status:"erro",erro_msg:"Falha de rede durante a geracao ("+String(e.message).slice(0,120)+"). Confira no Sicredi se o boleto (seu numero "+seuNum+") ja existe antes de Tentar de novo."}); }catch(e2){}
      console.log("Pix: pedido #"+pd.id+" falhou ("+e.message+").");
    }
  }

  // 2) conciliacao: quem pagou? Consulta CADA cobranca aberta por NOSSO NUMERO — mostra
  //    "LIQUIDADO PIX" na hora. (NAO uso "liquidados por dia" porque Pix so aparece la no
  //    proximo dia util; ex: pago no sabado so listaria na segunda.)
  const concF=path.join(__dirname,"..","output","last-pix-concilia.txt");
  let ultC=0; try{ ultC=Number(fs.readFileSync(concF,"utf8"))||0; }catch(e){}
  if(Date.now()-ultC >= PIX_CONC_MS){
    const abertas=await pixSbGet("pix_cobrancas?status=in.(gerado,erro)&nosso_numero=not.is.null&select=id,nosso_numero&limit=1000");
    let baixas=0;
    for(const ab of abertas){
      try{
        const r=await fetch(PIX_BASE+"/cobranca/boleto/v1/boletos?codigoBeneficiario="+encodeURIComponent(PIX_BENEF)+"&nossoNumero="+encodeURIComponent(ab.nosso_numero),{headers:{"x-api-key":PIX_KEY,Authorization:"Bearer "+(await pegaTok()),cooperativa:PIX_COOP,posto:PIX_POSTO},signal:PIX_TIMEOUT()});
        if(r.status===404) continue;                        // titulo nao encontrado
        if(!r.ok){ if(r.status===401) pixTok=null; continue; } // instabilidade: proxima rodada
        const j=await r.json();
        const sit=String(j.situacao||"").toUpperCase();
        const dl=j.dadosLiquidacao;
        if(sit.indexOf("LIQUIDADO")>=0 || dl){
          let tipo="PIX"; if(sit.indexOf("REDE")>=0)tipo="REDE"; else if(sit.indexOf("COMPE")>=0)tipo="COMPE";
          const pagoEm=(dl&&dl.data)?String(dl.data).slice(0,10):null;
          const valorLiq=(dl&&dl.valor!=null)?Math.round(Number(dl.valor)*100)/100:null;
          await pixSbPatch("id=eq."+ab.id,{status:"pago",pago_em:pagoEm,valor_liquidado:valorLiq,tipo_liquidacao:tipo,erro_msg:null});
          baixas++; console.log("Pix: cobranca #"+ab.id+" PAGA ("+tipo+") - baixa automatica.");
        }
      }catch(e){ console.log("Pix: conciliacao #"+ab.id+" erro ("+e.message+") - proxima rodada."); }
    }
    console.log("Pix: conciliacao ok, "+baixas+" paga(s) nova(s) de "+abertas.length+" em aberto.");
    try{ fs.writeFileSync(concF, String(Date.now())); }catch(e){}
  }
  console.log("Pix: rodada expressa ok.");
})().catch(e=>{ console.log("Pix: erro ("+e.message+") - tenta na proxima."); });
