// Mini-robo do PIX ("faixa expressa"): roda a cada ~8 s na loja (pix-loop.vbs) e cuida SO das
// cobrancas Pix (Sicredi) pedidas no painel — o robo grandao do VR continua no ritmo dele.
// O robo grandao (buildVrData.cjs) e a RESERVA: se este aqui ficar parado por 4+ min, ele
// RODA ESTE MESMO ARQUIVO (nao existe mais uma segunda copia do codigo do Pix). Os dois
// respeitam a mesma trava output/last-pix-start.txt. Chamado pelo pix.bat (loop do pix-loop.vbs).
// Uso: node scripts/pixWorker.cjs
//
// ==PIXCONTAS== (20/10/2026): DUAS contas no Sicredi.
//   'loja' = bloco SICREDI_*    -> pontos extras (beneficiario da loja)
//   'pf'   = bloco SICREDI_PF_* -> galpoes (conta pessoa fisica do Gilson, beneficiario 29377)
// Cada cobranca diz a sua na coluna "conta" (sem a coluna, ou vazia = 'loja', como sempre foi).
// Gerar, cancelar e conferir o pagamento usam SEMPRE a credencial da conta da cobranca: um boleto
// de galpao nunca sai pela conta da loja. Conta sem credencial no .env: o pedido vira "erro"
// explicando, e o resto (a outra conta) segue normal.
//
// ==PIXBAIXA== (20/10/2026): so da baixa num pagamento que FAZ SENTIDO (ver pixDecideBaixa).
// Em 10/2026 o ponto 14 tinha 3 parcelas "pagas" em 27/09/2021 com R$ 80 que estavam EM ABERTO
// no banco: o robo aceitava qualquer "dadosLiquidacao". E no modo de TESTE do Sicredi o robo nao
// mexe mais nas cobrancas de verdade (o banco de teste responde pagamentos de mentira).
const fs=require("fs");
const path=require("path");
const env=fs.readFileSync(path.join(__dirname,"..",".env"),"utf8");
const get=k=>{const m=env.match(new RegExp("^"+k+"=(.*)$","m"));return m?m[1].trim():"";};

const SB_HOST="uabhsmculsfwzcrhyhch.supabase.co", SB_KEY=get("SUPABASE_SERVICE_KEY");
const PIX_AMB=(get("SICREDI_AMBIENTE")||"producao").toLowerCase();
const PIX_SANDBOX=(PIX_AMB!=="producao"&&PIX_AMB!=="prod");
const PIX_BASE="https://api-parceiro.sicredi.com.br"+(PIX_SANDBOX?"/sb":"");
const PIX_CONC_MS=10*1000; // conciliacao (quem pagou?) a cada ~10s (so consulta status = leitura, sem risco)
const PIX_TIMEOUT=()=>AbortSignal.timeout(30000);

// credencial de cada conta (a da loja continua lendo EXATAMENTE as mesmas variaveis de antes)
function montaConta(nome,rotulo,pref){
  const benef=get(pref+"BENEFICIARIO");
  const coop=get(pref+"COOPERATIVA")||(pref!=="SICREDI_"?get("SICREDI_COOPERATIVA"):"");
  const senha=get(pref+"API_PASSWORD");
  const c={ nome, rotulo, key:get(pref+"API_KEY_PROD"), coop, posto:get(pref+"POSTO"), benef,
    authBody:"grant_type=password&username="+encodeURIComponent(benef+coop)+"&password="+encodeURIComponent(senha)+"&scope=cobranca",
    tok:null, tokAt:0, loginFalhou:null };
  c.ok=!!(c.key && c.coop && c.posto && c.benef && senha);
  return c;
}
const CONTAS={ loja:montaConta("loja","conta da loja","SICREDI_"), pf:montaConta("pf","conta pessoa fisica (galpoes)","SICREDI_PF_") };
// sem a coluna "conta" (SQL ainda nao rodado) ou vazia = loja, como sempre foi; nome desconhecido = null
function contaDe(row){ const n=(row&&row.conta!=null&&row.conta!=="")?String(row.conta):"loja"; return Object.prototype.hasOwnProperty.call(CONTAS,n)?CONTAS[n]:null; }
function hdr(c,tok,extra){ return Object.assign({"x-api-key":c.key,Authorization:"Bearer "+tok,cooperativa:c.coop,posto:c.posto},extra||{}); }

async function pixSbGet(q){ const r=await fetch("https://"+SB_HOST+"/rest/v1/"+q,{headers:{apikey:SB_KEY,Authorization:"Bearer "+SB_KEY},signal:PIX_TIMEOUT()}); if(!r.ok) throw new Error("Supabase GET HTTP "+r.status); return r.json(); }
async function pixSbPatch(filtro,campos){ const r=await fetch("https://"+SB_HOST+"/rest/v1/pix_cobrancas?"+filtro,{method:"PATCH",headers:{apikey:SB_KEY,Authorization:"Bearer "+SB_KEY,"Content-Type":"application/json",Prefer:"return=minimal"},body:JSON.stringify(campos),signal:PIX_TIMEOUT()}); if(!r.ok) throw new Error("Supabase PATCH HTTP "+r.status+" "+(await r.text()).slice(0,200)); }
async function pixSbPatchRep(filtro,campos){ const r=await fetch("https://"+SB_HOST+"/rest/v1/pix_cobrancas?"+filtro,{method:"PATCH",headers:{apikey:SB_KEY,Authorization:"Bearer "+SB_KEY,"Content-Type":"application/json",Prefer:"return=representation"},body:JSON.stringify(campos),signal:PIX_TIMEOUT()}); if(!r.ok) throw new Error("Supabase PATCH HTTP "+r.status); return r.json(); }
async function pixToken(c){ const r=await fetch(PIX_BASE+"/auth/openapi/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded","context":"COBRANCA","x-api-key":c.key},body:c.authBody,signal:PIX_TIMEOUT()}); if(!r.ok) throw new Error("Sicredi auth ("+c.nome+") HTTP "+r.status+" "+(await r.text()).slice(0,200)); return (await r.json()).access_token; }
// token do Sicredi vale 300s -> renova sozinho aos 240s. Login que falhou NAO e tentado de novo na
// mesma rodada (senao a conciliacao tentaria uma vez por boleto e poderia bloquear a conta no banco).
async function pegaTok(c){
  if(c.loginFalhou) throw new Error(c.loginFalhou);
  if(!c.tok || Date.now()-c.tokAt>240000){
    try{ c.tok=await pixToken(c); c.tokAt=Date.now(); }
    catch(e){ c.loginFalhou="login no Sicredi falhou ("+c.rotulo+"): "+e.message; throw e; }
  }
  return c.tok;
}

// ==PIXBAIXA== o robo so marca PAGO quando tudo bate (a mesma regra provada na previa
// .previa/pix-baixa-segura e em scripts/testes/pix-contas.test.cjs):
//   1. a situacao do boleto no banco diz LIQUIDADO;   2. veio a data do pagamento;
//   3. a data nao e de antes de a cobranca existir, nem do futuro (1 dia de folga pelo fuso);
//   4. o valor pago e > 0 e pelo menos o do boleto, tirando desconto/abatimento que o PROPRIO
//      banco informa (juros e multa podem deixar MAIOR).
// Se algo nao bate: NAO da baixa, a parcela continua em aberto e o motivo fica em erro_msg.
function soData(v){ return String(v||"").slice(0,10); }
function maisDias(data,n){ const d=new Date(data+"T12:00:00Z"); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10); }
function dataBr(d){ const p=String(d||"").split("-"); return p.length===3 ? p[2]+"/"+p[1]+"/"+p[0] : String(d||""); }
function reais(v){ return "R$ "+(Math.round(Number(v)*100)/100).toFixed(2).replace(".",","); }
// ==GLENCARGOS== multa e juros por atraso (21/10/2026, contrato do advogado: multa 2% e juros 1% ao mes
// pro rata die). SO na conta dos galpoes e SO com o que o BANCO de dados decidiu no pedido (gatilho
// pix_cobrancas_encargos, pela chave do galpao). Juros em REAIS POR DIA (1% ao mes / 30, para baixo): o
// Sicredi calcula sozinho no dia do pagamento. NUNCA manda dataInicioJuros/dataInicioMulta: com elas o
// boleto perde o QR do Pix (manual da API, p. 7). Valor acima do contrato = erro, nada vai ao banco.
function pixEncargos(row,c){
  if(!c||c.nome!=="pf") return null;
  const inf=v=>v!==null&&v!==undefined&&v!==""&&isFinite(Number(v))&&Number(v)>0;   // branco nao e zero
  const m=row.multa_pct, j=row.juros_dia;
  if(!inf(m)&&!inf(j)) return null;
  // em CENTAVOS INTEIROS, igual ao banco (numeric): 810*0.01/30*100 no computador da 26,999... e recusaria 0,27
  const tetoJuros=Math.floor(Math.round(Number(row.valor)*100)/3000)/100;
  if((inf(m)&&Number(m)>2.0001)||(inf(j)&&Number(j)>tetoJuros+0.0001))
    return {erro:"Multa/juros acima do contrato (multa "+m+"%, juros R$ "+j+" por dia; o teto e 2% e R$ "+tetoJuros.toFixed(2)+" por dia). Nada foi enviado ao banco."};
  const e={};
  if(inf(m)){ e.tipoMulta="PERCENTUAL"; e.multa=Math.round(Number(m)*100)/100; }
  if(inf(j)){ e.tipoJuros="VALOR"; e.juros=Math.round(Number(j)*100)/100; }
  return e;
}
function pixDecideBaixa(j,cob,hoje){
  const sit=String((j&&j.situacao)||"").toUpperCase();
  const dl=j&&j.dadosLiquidacao;
  if(sit.indexOf("LIQUIDADO")<0) return { pagar:false, motivo: dl ? "Pagamento NAO baixado: o banco mandou dados de pagamento, mas a situacao e \""+sit+"\" (nao diz liquidado). Confira no Sicredi." : null };
  if(!dl || !dl.data) return { pagar:false, motivo:"Pagamento NAO baixado: o banco diz liquidado, mas nao informou a data. Confira no Sicredi." };
  const pagoEm=soData(dl.data), criado=soData(cob&&cob.criado_em);
  if(criado && pagoEm<maisDias(criado,-1)) return { pagar:false, motivo:"Pagamento NAO baixado: data do pagamento ("+dataBr(pagoEm)+") e de antes de a cobranca existir ("+dataBr(criado)+"). Confira no Sicredi." };
  if(hoje && pagoEm>maisDias(hoje,1)) return { pagar:false, motivo:"Pagamento NAO baixado: data do pagamento ("+dataBr(pagoEm)+") esta no futuro. Confira no Sicredi." };
  const valor=Number(dl.valor), nominal=Number((j&&j.valorNominal)!=null ? j.valorNominal : (cob&&cob.valor));
  const descontos=(Number(dl.desconto)||0)+(Number(dl.abatimento)||0);
  if(!(valor>0)) return { pagar:false, motivo:"Pagamento NAO baixado: o banco informou pagamento sem valor. Confira no Sicredi." };
  if(nominal>0 && valor+descontos<nominal-0.01) return { pagar:false, motivo:"Pagamento NAO baixado: valor pago ("+reais(valor)+") e menor que o do boleto ("+reais(nominal)+"). Confira no Sicredi." };
  let tipo="PIX"; if(sit.indexOf("REDE")>=0) tipo="REDE"; else if(sit.indexOf("COMPE")>=0) tipo="COMPE";
  return { pagar:true, pagoEm, valor:Math.round(valor*100)/100, tipo };
}

(async()=>{
  // trava compartilhada com o robo grandao: quem escreveu ha pouco esta cuidando.
  // (o pix-loop.vbs espera cada rodada terminar antes de dormir, entao nao ha
  //  duas rodadas expressas ao mesmo tempo; a trava protege contra o buildVrData)
  const pixLockF=path.join(__dirname,"..","output","last-pix-start.txt");
  try{ const lst=Number(fs.readFileSync(pixLockF,"utf8"))||0; if(Date.now()-lst < 6*1000){ console.log("Pix: rodada de ha pouco ainda vale - pulando."); return; } }catch(e){}
  if(!SB_KEY){ console.log("Pix: sem SUPABASE_SERVICE_KEY no .env - pulando."); return; }
  // ==PIXBAIXA== modo de TESTE do Sicredi: o banco de teste responde boletos e pagamentos de
  // mentira. Com ele ligado, o robo NAO mexe nas cobrancas de verdade (gerar, cancelar ou dar baixa).
  if(PIX_SANDBOX){ console.log("Pix: SICREDI_AMBIENTE="+PIX_AMB+" (modo de teste) - o robo nao mexe nas cobrancas de verdade. Volte para producao no .env."); return; }
  if(!CONTAS.loja.ok && !CONTAS.pf.ok){ console.log("Pix: bloco SICREDI incompleto no .env - pulando."); return; }
  try{ fs.writeFileSync(pixLockF, String(Date.now())); }catch(e){}

  // UMA PERGUNTA POR RODADA (era uma para cada fila: 3 a cada ~9 s, o dia inteiro, mesmo sem
  // nada pra fazer = ~1.300 pedidos/hora no Supabase, a conta de "registros" que estourou 6x).
  // A resposta traz as tres filas de uma vez e aqui ela e separada. O QUE a rodada faz com cada
  // cobranca nao mudou: mesmas filas, mesmos limites (25 cancelamentos, 25 pedidos por ordem de
  // id), mesma ordem (presas -> cancelamentos -> pedidos). Provado lado a lado com a versao
  // antiga (scripts/testes/pix-robo-fila.test.cjs). 30/09/2026.
  const fila=await pixSbGet("pix_cobrancas?status=in.(gerando,cancelar,pedido)&select=*&order=id&limit=1000");
  // 0) recuperacao: linha presa em "gerando" = rodada anterior caiu no meio.
  const presas=fila.filter(x=>x.status==="gerando");
  for(const pr of presas){
    try{ await pixSbPatch("id=eq."+pr.id+"&status=eq.gerando",{status:"erro",erro_msg:"A rodada anterior caiu no meio da geracao. Confira no Sicredi se o boleto (seu numero "+(pr.seu_numero||"?")+") ja existe antes de clicar em Tentar de novo."}); }catch(e){}
  }

  // 0.5) cancelamentos pedidos no painel -> baixa no Sicredi, NA CONTA DA COBRANCA
  const cancels=fila.filter(x=>x.status==="cancelar").slice(0,25);
  for(const cc of cancels){
    const c=contaDe(cc);
    if(!c || !c.ok){ console.log("Pix: cancelamento #"+cc.id+" espera: "+(c?c.rotulo+" sem credencial no .env":"conta desconhecida ("+cc.conta+")")+"."); continue; }
    try{
      if(!cc.nosso_numero){ await pixSbPatch("id=eq."+cc.id,{status:"cancelado"}); continue; }
      const r=await fetch(PIX_BASE+"/cobranca/boleto/v1/boletos/"+encodeURIComponent(cc.nosso_numero)+"/baixa",{method:"PATCH",headers:hdr(c,await pegaTok(c),{"Content-Type":"application/json",codigoBeneficiario:c.benef}),body:"{}",signal:PIX_TIMEOUT()});
      const txt=await r.text();
      let msg=""; try{ msg=JSON.parse(txt).message||""; }catch(e2){}
      const ml=msg.toLowerCase();
      if(r.status===202 || ml.indexOf("baixado")>=0){ await pixSbPatch("id=eq."+cc.id,{status:"cancelado"}); console.log("Pix: cobranca #"+cc.id+" CANCELADA (baixa no banco, "+c.nome+")."); }
      else if(ml.indexOf("liquidado")>=0){ await pixSbPatch("id=eq."+cc.id,{status:"gerado"}); console.log("Pix: cobranca #"+cc.id+" ja foi PAGA - cancelamento ignorado."); }
      // "aguardando confirmacao" = titulo recem-criado ainda assentando no banco; "processamento" = baixa anterior rodando. Insiste (mantem status "cancelar").
      else if(ml.indexOf("processamento")>=0 || ml.indexOf("aguardando")>=0 || ml.indexOf("confirma")>=0){ console.log("Pix: cancelamento #"+cc.id+" o banco ainda esta liberando (\""+String(msg).slice(0,60)+"\") - insiste na proxima rodada."); }
      else if(r.status===401 || r.status===429 || r.status>=500){ c.tok=null; console.log("Pix: cancelamento #"+cc.id+" banco instavel (HTTP "+r.status+") - proxima rodada."); }
      else { await pixSbPatch("id=eq."+cc.id,{status:"gerado"}); console.log("Pix: cancelamento #"+cc.id+" recusado pelo banco: "+String(msg||("HTTP "+r.status)).slice(0,120)); }
    }catch(e){ console.log("Pix: cancelamento #"+cc.id+" falhou ("+e.message+")."); }
  }

  // 1) pedidos do painel -> criar boleto hibrido (QR Pix) no Sicredi, NA CONTA DA COBRANCA
  const pedidos=fila.filter(x=>x.status==="pedido").slice(0,25);
  for(const pd of pedidos){
    const seuNum=String(pd.id).padStart(10,"0").slice(-10);
    const c=contaDe(pd);
    try{
      if(!c){ await pixSbPatch("id=eq."+pd.id+"&status=eq.pedido",{status:"erro",erro_msg:"Conta desconhecida ("+String(pd.conta).slice(0,20)+"). Nada foi enviado ao banco."}); continue; }
      if(!c.ok){ await pixSbPatch("id=eq."+pd.id+"&status=eq.pedido",{status:"erro",erro_msg:"A "+c.rotulo+" ainda nao esta configurada no computador da loja (falta o bloco "+(c.nome==="pf"?"SICREDI_PF_":"SICREDI_")+" no .env). Nada foi enviado ao banco. Depois de configurar, clique em Tentar de novo."}); continue; }
      const doc=String(pd.documento||"").replace(/\D/g,"");
      if(!doc || (doc.length!==11 && doc.length!==14)){ await pixSbPatch("id=eq."+pd.id,{status:"erro",erro_msg:"CPF/CNPJ do pagador invalido ou vazio. Preencha no cadastro (do ponto ou do galpao) e clique em Tentar de novo."}); continue; }
      const ag=new Date(); const hj=ag.getFullYear()+"-"+String(ag.getMonth()+1).padStart(2,"0")+"-"+String(ag.getDate()).padStart(2,"0");
      let venc=String(pd.vencimento||"").slice(0,10);
      if(!venc || venc<hj) venc=hj;
      const enc=pixEncargos(pd,c);
      if(enc&&enc.erro){ await pixSbPatch("id=eq."+pd.id+"&status=eq.pedido",{status:"erro",erro_msg:enc.erro}); continue; }
      await pegaTok(c); // autentica ANTES de reivindicar (falha de login nao trava o pedido)
      const claim=await pixSbPatchRep("id=eq."+pd.id+"&status=eq.pedido",{status:"gerando",seu_numero:seuNum});
      if(!claim.length) continue; // outro worker ja pegou
      const corpo={ tipoCobranca:"HIBRIDO", codigoBeneficiario:c.benef,
        pagador:{ tipoPessoa:(doc.length===14?"PESSOA_JURIDICA":"PESSOA_FISICA"), documento:doc, nome:String(pd.fornecedor||"Pagador").slice(0,40) },
        especieDocumento:"OUTROS", seuNumero:seuNum, dataVencimento:venc,
        valor:Math.round(Number(pd.valor)*100)/100, validadeAposVencimento:60 };
      if(enc) Object.assign(corpo,enc);   // ==GLENCARGOS== multa e juros (so galpao com a chave ligada)
      const r=await fetch(PIX_BASE+"/cobranca/boleto/v1/boletos",{method:"POST",headers:hdr(c,await pegaTok(c),{"Content-Type":"application/json"}),body:JSON.stringify(corpo),signal:PIX_TIMEOUT()});
      const txt=await r.text();
      if(!r.ok){
        if(r.status===401 || r.status===429 || r.status>=500){
          c.tok=null;
          await pixSbPatch("id=eq."+pd.id+"&status=eq.gerando",{status:"pedido",seu_numero:null});
          console.log("Pix: pedido #"+pd.id+" banco instavel (HTTP "+r.status+") - proxima rodada."); continue;
        }
        let msg="HTTP "+r.status; try{ msg=JSON.parse(txt).message||msg; }catch(e2){}
        await pixSbPatch("id=eq."+pd.id,{status:"erro",erro_msg:String(msg).slice(0,300)});
        console.log("Pix: pedido #"+pd.id+" recusado pelo banco: "+String(msg).slice(0,120)); continue;
      }
      const b=JSON.parse(txt);
      await pixSbPatch("id=eq."+pd.id,{status:"gerado",txid:b.txid||null,nosso_numero:b.nossoNumero||null,linha_digitavel:b.linhaDigitavel||null,codigo_barras:b.codigoBarras||null,qr_code:b.qrCode||null,seu_numero:seuNum,erro_msg:null,vencimento:venc});
      console.log("Pix: pedido #"+pd.id+" GERADO ("+c.nome+", nosso numero "+(b.nossoNumero||"?")+", venc "+venc+(enc?(", multa "+(enc.multa||0)+"% e juros R$ "+(enc.juros||0)+"/dia"):"")+").");
    }catch(e){
      try{ await pixSbPatch("id=eq."+pd.id+"&status=eq.gerando",{status:"erro",erro_msg:"Falha de rede durante a geracao ("+String(e.message).slice(0,120)+"). Confira no Sicredi se o boleto (seu numero "+seuNum+") ja existe antes de Tentar de novo."}); }catch(e2){}
      console.log("Pix: pedido #"+pd.id+" falhou ("+e.message+").");
    }
  }

  // 2) conciliacao: quem pagou? Consulta CADA cobranca aberta por NOSSO NUMERO, NA CONTA DELA —
  //    mostra "LIQUIDADO PIX" na hora. (NAO uso "liquidados por dia" porque Pix so aparece la no
  //    proximo dia util; ex: pago no sabado so listaria na segunda.)
  const concF=path.join(__dirname,"..","output","last-pix-concilia.txt");
  let ultC=0; try{ ultC=Number(fs.readFileSync(concF,"utf8"))||0; }catch(e){}
  if(Date.now()-ultC >= PIX_CONC_MS){
    const filtroAb="pix_cobrancas?status=in.(gerado,erro)&nosso_numero=not.is.null&limit=1000&select=id,nosso_numero,criado_em,valor,erro_msg";
    let abertas;
    // a coluna "conta" so existe depois do SQL dos galpoes: sem ela, a pergunta com ",conta" volta 400
    try{ abertas=await pixSbGet(filtroAb+",conta"); }
    catch(e){ if(String(e.message).indexOf("HTTP 400")<0) throw e; abertas=await pixSbGet(filtroAb); }
    const ag=new Date(), hoje=ag.getFullYear()+"-"+String(ag.getMonth()+1).padStart(2,"0")+"-"+String(ag.getDate()).padStart(2,"0");
    let baixas=0;
    for(const ab of abertas){
      const c=contaDe(ab);
      if(!c || !c.ok) continue; // conta sem credencial: confere quando a credencial existir
      try{
        const r=await fetch(PIX_BASE+"/cobranca/boleto/v1/boletos?codigoBeneficiario="+encodeURIComponent(c.benef)+"&nossoNumero="+encodeURIComponent(ab.nosso_numero),{headers:hdr(c,await pegaTok(c)),signal:PIX_TIMEOUT()});
        if(r.status===404) continue;                        // titulo nao encontrado
        if(!r.ok){ if(r.status===401) c.tok=null; continue; } // instabilidade: proxima rodada
        const j=await r.json();
        const d=pixDecideBaixa(j,ab,hoje);
        if(d.pagar){
          await pixSbPatch("id=eq."+ab.id,{status:"pago",pago_em:d.pagoEm,valor_liquidado:d.valor,tipo_liquidacao:d.tipo,erro_msg:null});
          baixas++; console.log("Pix: cobranca #"+ab.id+" PAGA ("+d.tipo+", "+c.nome+") - baixa automatica.");
        } else if(d.motivo && d.motivo!==ab.erro_msg){
          // nao marca pago; anota o motivo UMA vez (so grava de novo se o motivo mudar)
          await pixSbPatch("id=eq."+ab.id,{erro_msg:d.motivo});
          console.log("Pix: cobranca #"+ab.id+" - "+d.motivo);
        }
      }catch(e){ console.log("Pix: conciliacao #"+ab.id+" erro ("+e.message+") - proxima rodada."); }
    }
    console.log("Pix: conciliacao ok, "+baixas+" paga(s) nova(s) de "+abertas.length+" em aberto.");
    try{ fs.writeFileSync(concF, String(Date.now())); }catch(e){}
  }
  console.log("Pix: rodada expressa ok.");
})().catch(e=>{ console.log("Pix: erro ("+e.message+") - tenta na proxima."); });
