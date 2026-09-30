// Avarias · leitura do texto dos documentos (bonificação, verba, nota de compra) — regra da etapa 1, 28/09/2026. Só leitura.
// Só a função de leitura: a extração do VR passa SEMPRE por vr.cjs (porta única, só leitura).
"use strict";
const fs = require("fs");

// ---------------------------------------------------------------- vocabulario
// palavra que ANCORA um numero como "nossa nota"
const ANCORA = new Set(["NF","NFS","NFD","NFDS","NFE","NFES","FN","NOTA","NOTAS","DANFE","DANFES",
  "DEV","DEVOL","DEVOLUCAO","DEVOLUCOES","AVARIA","AVARIAS","PERCA","PERCAS","PERDA","PERDAS","DOC"]);
// palavra que PROIBE: o numero ao lado e codigo de produto, pedido, carga, lacre, mapa etc.
const PROIBE = new Set(["ITEM","ITENS","PROD","PRODUTO","PRODUTOS","COD","CODIGO","PEDIDO","PEDIDOS","PED",
  "NROPEDIDO","NROPEDIDOCLIENTE","PEDIDOCLIENTE","CARREG","CARREGAMENTO","CARGA","NROCARGA","LACRE","LACRES",
  "MAPA","BO","TRANS","TRANSPORTE","NUMTRANSVENDA","VENDA","VENDAS","CLIENTE","RCA","FANTASIA","CEP","FONE",
  "TELEFONE","SELL","OUT","CONT","CONTRATO","SAP","FORNECIMENTO","ORDEM","REPRESENTANTE","VENDEDOR","PLACA",
  "REBAIXA","REB","CUSTO","FICAR","UND","UNID","UN","ROTA","ID","EDI","SENHA","CPF","CNPJ","IE","PROTOCOLO","LOTE","GTA","ROMANEIO","SERIE","USUARIO"]);
// palavras de ligacao: podem ficar entre a ancora e o numero, e entre o valor e o numero
const LIGA = new Set(["E","A","AS","O","OS","AO","AOS","DE","DA","DO","DAS","DOS","REF","REFERENTE","REFENTE",
  "REFEERNTE","REFERENTES","NO","NA","NOS","NAS","N","NR","NRO","NUM","NUMERO","VALOR","PARA","PRA","P","EM",
  "QUITAR","PAGAR","PAGA","PAGAMENTO","PARCIAL","TOTAL","DESC","DESCONTO","DECONTO","BOLETO","COM","SE","UM","UMA",
  "VEIO","ABATIMENTO","BONIF","BONIFICACAO","DO","ATO","DA"]);

// ---------------------------------------------------------------- lexico
function normaliza(t){
  return String(t||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toUpperCase()
    .replace(/\r\n?/g,"\n");
}
// devolve lista de pecas: {k:'DIN'|'NUM'|'OUTRO'|'PAL'|'RS'|'SIN'|'QUEBRA', v, ini, fim}
function lexico(txt){
  const re = /(\n)|(R\$)|(\d{1,3}(?:\.\d{3})+,\d{2}(?!\d)|\d+,\d{2}(?!\d))|(\d+\.\d{2}(?![\d.]))|(\d+(?:\.\d+)*)|([A-Z]+)|(\S)/g;
  const out=[]; let m;
  while((m=re.exec(txt))){
    const ini=m.index, fim=re.lastIndex;
    if(m[1]) out.push({k:"QUEBRA",v:"\n",ini,fim});
    else if(m[2]) out.push({k:"RS",v:"R$",ini,fim});
    else if(m[3]) out.push({k:"DIN",v:+m[3].replace(/\./g,"").replace(",","."),ini,fim,txt:m[3]});
    else if(m[4]){ // 58.57 : so e dinheiro logo depois de R$ (com ou sem sinal); senao e numero que NAO e nota
      const prev = out.length? out[out.length-1] : null, prev2 = out.length>1? out[out.length-2] : null;
      const aposRS = prev && (prev.k==="RS" || (prev.k==="SIN" && prev.v==="-" && prev2 && prev2.k==="RS"));
      out.push(aposRS? {k:"DIN",v:+m[4],ini,fim,txt:m[4]} : {k:"OUTRO",v:m[4],ini,fim});
    }
    else if(m[5]){
      const s=m[5];
      const colado = /[A-Z]/.test(txt[fim]||"");           // 12345B678A... = codigo, nao nota
      if(s.includes(".") || colado) { out.push({k:"OUTRO",v:s,ini,fim}); continue; }
      const semZero = s.replace(/^0+/,"");
      // 5 ou 6 algarismos (aceita zeros a esquerda: 012345, 067890)
      if(semZero.length>=5 && semZero.length<=6 && s.length<=8) out.push({k:"NUM",v:+semZero,ini,fim,txt:s});
      else out.push({k:"OUTRO",v:s,ini,fim});
    }
    else if(m[6]) out.push({k:"PAL",v:m[6],ini,fim});
    else out.push({k:"SIN",v:m[7],ini,fim});
  }
  return out;
}

// ---------------------------------------------------------------- ancora (olha para tras)
// anda para tras passando por: sinais, R$, dinheiro, outros NUM da lista, quebras de linha, palavras de ligacao.
// primeira palavra "forte": ANCORA -> aceita ; PROIBE -> recusa ; ate 3 palavras desconhecidas; depois -> sem ancora.
function ancora(L,i){
  let desconhecidas=0;
  for(let j=i-1;j>=0;j--){
    const p=L[j];
    if(p.k==="PAL"){
      if(PROIBE.has(p.v)) return {ok:false,motivo:"contexto proibido ("+p.v+")"};
      if(ANCORA.has(p.v)) return {ok:true,palavra:p.v};
      if(LIGA.has(p.v)) continue;
      if(++desconhecidas>3) return {ok:false,motivo:"sem ancora"};
      continue;
    }
    if(p.k==="OUTRO") return {ok:false,motivo:"sem ancora"}; // numero estranho no caminho (7 digitos, 22.199...) quebra a corrente
    // SIN, RS, DIN, NUM, QUEBRA: fazem parte de listas, seguem
  }
  return {ok:false,motivo:"sem ancora"};
}

// ---------------------------------------------------------------- valor A (a direita)
// NUM [- = : ( _]* [NO] [VALOR] [DE] [:] [R$] [-] DIN     (sem virgula, barra, ponto ou quebra no meio)
function valorDireita(L,i){
  for(let j=i+1;j<L.length && j<=i+9;j++){
    const p=L[j];
    if(p.k==="DIN"){
      const q=L[j+1], q2=L[j+2];
      if(q && q.k==="PAL" && q.v==="POR") return null;              // 1,00 POR UND = preco, nao valor da nota
      if(q && q.k==="SIN" && q.v==="%") return null;
      return {v:p.v,j};
    }
    if(p.k==="SIN" && "-=:(_".includes(p.v)) continue;
    if(p.k==="RS") continue;
    if(p.k==="PAL" && (p.v==="NO"||p.v==="VALOR"||p.v==="DE")) continue;
    return null;
  }
  return null;
}
// ---------------------------------------------------------------- valor B (a esquerda)
// DIN [palavras de ligacao/ancora, - = :, R$]* NUM   (sem outro numero, sem / , ; . ( ) e sem quebra no meio)
function valorEsquerda(L,i){
  for(let j=i-1;j>=0 && j>=i-12;j--){
    const p=L[j];
    if(p.k==="DIN"){
      const antes=L[j-1];
      if(antes && antes.k==="PAL" && (antes.v==="SALDO"||antes.v==="RESTANTE")) return null;
      return {v:p.v,j};
    }
    if(p.k==="SIN" && "-=:".includes(p.v)) continue;
    if(p.k==="RS") continue;
    if(p.k==="PAL" && (LIGA.has(p.v)||ANCORA.has(p.v))) continue;
    return null;
  }
  return null;
}

// ---------------------------------------------------------------- leitura de UM texto
// trechos: quebra de linha, ";" , "//" e "|" separam trechos (a trava do valor a esquerda e o "valor unico" olham so o trecho)
function trechos(L){
  const t=new Array(L.length); let n=0;
  for(let j=0;j<L.length;j++){
    const p=L[j];
    const corta = p.k==="QUEBRA" || (p.k==="SIN" && (p.v===";"||p.v==="|")) ||
                  (p.k==="SIN" && p.v==="/" && L[j+1] && L[j+1].k==="SIN" && L[j+1].v==="/" && L[j+1].ini===p.fim);
    if(corta) n++;
    t[j]=n;
  }
  return t;
}
const NAO_E_DA_NOTA = new Set(["SALDO","RESTANTE","SOBROU","SPBROU","SOBRA","FICA","FICANDO","TOTAL","TOTALIZAM","REBAIXA","REBAIXAS",
  "CUSTO","FICAR","VENDA","VENDER","ACRESCIMO","ACRES","ACRESC","ICMS","TRIBUTOS","TITULO","USADO","APROXIMADO","DIFERENCA",
  "VERBA","VERBAS","PONTO","PONTOS","ENCARTE","ACAO","PRECO","SELL","CONTRATO","LEI"]);
const ANUNCIA = new Set(["DESC","DESCONTO","DESNCONTO","DECONTO","ABATIMENTO","VALOR","V","DE","NO","RS"]);
const UNIDADE = new Set(["KG","G","GR","UND","UNID","UN","L","ML","POR","CX","PCT","FD"]);
// nossas: Map numero -> nota (todas as notas de saida da loja; nota.tlb = tipolocalbaixa) ; dataDoc: 'AAAA-MM-DD'
function leTexto(texto, nossas, dataDoc){
  const txt=normaliza(texto), L=lexico(txt), T=trechos(L);
  const cit=[], rejeitados=[];
  const ancorados=[]; // numeros ancorados que sao nota nossa (qualquer tipo): servem para as travas
  L.forEach((p,i)=>{
    if(p.k!=="NUM") return;
    const nota=nossas.get(p.v);
    if(!nota) return;                                   // numero que nao e nota nossa: ignora
    const a=ancora(L,i);
    if(!a.ok){ rejeitados.push({num:p.v,tlb:nota.tlb,motivo:a.motivo}); return; }
    ancorados.push(i);
    const dias=Math.round((Date.parse(dataDoc)-Date.parse(nota.data))/864e5);
    if(dias<-30){ rejeitados.push({num:p.v,tlb:nota.tlb,motivo:"documento anterior a nota ("+dias+" dias)"}); return; }
    if(dias>730){ rejeitados.push({num:p.v,tlb:nota.tlb,motivo:"documento mais de 2 anos depois ("+dias+" dias)"}); return; }
    cit.push({i,num:p.v,nota,ancora:a.palavra,dias,trecho:T[i]});
  });
  const usados=new Set();
  // (A) valor logo depois do numero
  for(const c of cit){
    const a=valorDireita(L,c.i);
    if(a && !usados.has(a.j)){ c.valor=a.v; c.forma="A: valor depois do numero"; usados.add(a.j); }
  }
  // (B) valor logo antes do numero, so com palavras de ligacao no meio.
  //     Trava: no MESMO trecho, ou so ha uma nota ancorada, ou todas as notas ancoradas do trecho ficam com valor proprio.
  const tentB=[];
  for(const c of cit.filter(c=>c.valor==null)){
    const b=valorEsquerda(L,c.i);
    if(b && !usados.has(b.j)) tentB.push({c,b});
  }
  const ancNoTrecho=(t)=>new Set(ancorados.filter(i=>T[i]===t).map(i=>L[i].v));
  for(const t of tentB){
    const nums=ancNoTrecho(t.c.trecho);
    const ok = nums.size===1 || [...nums].every(n=>{
      const cc=cit.find(c=>c.num===n && c.trecho===t.c.trecho);
      return cc && (cc.valor!=null || tentB.some(x=>x.c===cc));
    });
    if(ok && !usados.has(t.b.j)){ t.c.valor=t.b.v; t.c.forma="B: valor antes do numero"; usados.add(t.b.j); }
  }
  // (C) formato do sistema do fornecedor: "No.Doc.Ref: 11111 - AVARIA-BX ... Valor do Credito R$ 10.00"
  const reC=/NO\.DOC\.REF:\s*0*(\d{5,6})\s*-\s*AVARIA[^\/]*?VALOR DO CREDITO R\$\s*(-?\d+(?:\.\d{1,2})?)/g; let mC;
  while((mC=reC.exec(txt))){
    const c=cit.find(c=>c.num===+mC[1] && c.valor==null);
    if(!c) continue;
    const v=+mC[2];
    if(v>0){ c.valor=v; c.forma="C: credito no sistema do fornecedor"; } else c.obs="credito negativo (estorno) "+v;
  }
  // (D) valor unico do trecho: 1 nota ancorada no trecho e 1 so valor em dinheiro no trecho, e esse valor
  //     vem anunciado como desconto/abatimento/valor (DESC DE, DESCONTO DE, ABATIMENTO DE, VALOR, V=, R$),
  //     nao e quantidade (KG, UND...), nem preco por unidade, nem acrescimo/imposto/saldo/restante/total/titulo.
  for(const c of cit.filter(c=>c.valor==null && !c.obs)){
    if(ancNoTrecho(c.trecho).size!==1 || new Set(ancorados.map(i=>L[i].v)).size!==1) continue; // 1 nota no texto inteiro
    const din=[]; L.forEach((p,j)=>{ if(p.k==="DIN" && T[j]===c.trecho) din.push(j); });
    if(din.length!==1 || usados.has(din[0])) continue;
    const j=din[0];
    let ruim=false, anunciado=false;
    for(let k=j-1;k>=Math.max(0,j-12);k--){
      const q=L[k];
      if(q.k==="PAL" && NAO_E_DA_NOTA.has(q.v)) ruim=true;
      if(k>=j-3 && ((q.k==="PAL" && ANUNCIA.has(q.v)) || q.k==="RS")) anunciado=true;
    }
    const dep=L[j+1];
    if(dep && ((dep.k==="PAL" && UNIDADE.has(dep.v)) || (dep.k==="SIN" && dep.v==="%"))) ruim=true;
    if(ruim || !anunciado) continue;
    // D NAO conta como valor claro: fica como "cita sem valor" com valor provavel para conferencia humana
    c.valorProvavel=L[j].v; c.forma="D: valor provavel (unico do trecho)"; usados.add(j);
  }
  // o mesmo numero citado 2x no mesmo texto: fica uma citacao (a que tem valor)
  const porNum=new Map();
  for(const c of cit){ const o=porNum.get(c.num); if(!o || (o.valor==null && c.valor!=null)) porNum.set(c.num,c); }
  // natureza do texto (so informativo): origem = a propria compra que gerou a devolucao no ato da entrega
  const origem = /ATO DA ENTREGA|FALTOU|DEVOLUCAO (TOTAL|PARCIAL)|DEV TOT/.test(txt) &&
                 !/DESC|ABATIMENTO|BONIF|PAGAR|QUITAR|PAGAMENTO|CONCEDEU|AVARIA/.test(txt);
  const dinheiros=L.filter(p=>p.k==="DIN").map(p=>p.v);
  return {citacoes:[...porNum.values()].map(({i,trecho,...r})=>r), rejeitados, dinheiros, natureza: origem?"origem (compra devolvida)":"acerto/pagamento"};
}

module.exports={normaliza,lexico,ancora,valorDireita,valorEsquerda,trechos,leTexto};
