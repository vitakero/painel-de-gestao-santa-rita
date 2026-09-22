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
// PISO DO HISTORICO, um lugar so. Janela rolante ("3 anos pra tras") anda sozinha todo dia:
// ja trouxe um agosto/2023 com 6 dias marcado como mes fechado, e a tela comparou 6 dias
// contra 31. Todo corte de historico deste arquivo tem que sair daqui.
const ANO_PISO=2024;
const PISO_DATA=ANO_PISO+"-01-01";
const PISO_MES=ANO_PISO+"-01";
const PROD_SYNC_MS=3*3600*1000; // no maximo 1x a cada 3h (produto novo aparece em ate 3h)
const PROD_SYNC_SQL="SELECT DISTINCT ON (p.id) pa.codigobarras::text cod, p.descricaocompleta nome, e.estoque::text total FROM public.produto p JOIN public.produtoautomacao pa ON pa.id_produto::text=p.id::text LEFT JOIN public.estoque e ON e.id_produto::text=p.id::text AND e.id_loja::text='1' WHERE pa.codigobarras IS NOT NULL AND trim(pa.codigobarras::text)<>'' ORDER BY p.id, pa.qtdembalagem";
function sbGetJson(q){return new Promise((res,rej)=>{const req=https.request({host:SB_HOST,path:"/rest/v1/"+q,method:"GET",headers:{apikey:SB_KEY,Authorization:"Bearer "+SB_KEY}},r=>{let d="";r.on("data",c=>d+=c);r.on("end",()=>{if(r.statusCode>=300)return rej(new Error("HTTP "+r.statusCode+" "+d));try{res(JSON.parse(d));}catch(e){rej(e);}})});req.on("error",rej);req.end();});}
function sbUpsertMes(rows){return new Promise((res,rej)=>{const body=JSON.stringify(rows);const req=https.request({host:SB_HOST,path:"/rest/v1/vendasetor_mes?on_conflict=ano,mes,setor",method:"POST",headers:{apikey:SB_KEY,Authorization:"Bearer "+SB_KEY,"Content-Type":"application/json",Prefer:"resolution=merge-duplicates,return=minimal","Content-Length":Buffer.byteLength(body)}},r=>{let d="";r.on("data",c=>d+=c);r.on("end",()=>r.statusCode<300?res():rej(new Error("HTTP "+r.statusCode+" "+d)))});req.on("error",rej);req.write(body);req.end();});}
function sbUpsertDia(rows){return new Promise((res,rej)=>{const body=JSON.stringify(rows);const req=https.request({host:SB_HOST,path:"/rest/v1/vendasetor_dia?on_conflict=data,setor",method:"POST",headers:{apikey:SB_KEY,Authorization:"Bearer "+SB_KEY,"Content-Type":"application/json",Prefer:"resolution=merge-duplicates,return=minimal","Content-Length":Buffer.byteLength(body)}},r=>{let d="";r.on("data",c=>d+=c);r.on("end",()=>r.statusCode<300?res():rej(new Error("HTTP "+r.statusCode+" "+d)))});req.on("error",rej);req.write(body);req.end();});}
const DIA_SYNC_MS=20*60*1000; // 1x a cada 20 min: a tela e diaria, nao precisa de mais
function sbUpsertCompras(rows){return new Promise((res,rej)=>{const body=JSON.stringify(rows);const req=https.request({host:SB_HOST,path:"/rest/v1/compra_entradas?on_conflict=id_item",method:"POST",headers:{apikey:SB_KEY,Authorization:"Bearer "+SB_KEY,"Content-Type":"application/json",Prefer:"resolution=merge-duplicates,return=minimal","Content-Length":Buffer.byteLength(body)}},r=>{let d="";r.on("data",c=>d+=c);r.on("end",()=>r.statusCode<300?res():rej(new Error("HTTP "+r.statusCode+" "+d)))});req.on("error",rej);req.write(body);req.end();});}
const COMPRAS_SYNC_MS=6*3600*1000; // nota de entrada nao muda de hora em hora: 1x a cada 6h
function sbUpsertProdutos(rows){return new Promise((res,rej)=>{const body=JSON.stringify(rows);const req=https.request({host:SB_HOST,path:"/rest/v1/estoque_produtos?on_conflict=cod",method:"POST",headers:{apikey:SB_KEY,Authorization:"Bearer "+SB_KEY,"Content-Type":"application/json",Prefer:"resolution=merge-duplicates,return=minimal","Content-Length":Buffer.byteLength(body)}},r=>{let d="";r.on("data",c=>d+=c);r.on("end",()=>r.statusCode<300?res():rej(new Error("HTTP "+r.statusCode+" "+d)))});req.on("error",rej);req.write(body);req.end();});}

// ============================================================================
// FRENTE DE CAIXA: cancelamentos e descontos manuais (os dois KPIs da Analise)
// ============================================================================
// O painel NAO faz conta sobre o VR. Daqui saem duas coisas, de proposito separadas:
//
//   FCX_DIA  -> resumo POR DIA, embutido no arquivo do painel. Nao tem nome de pessoa
//               nenhum: e so contagem e dinheiro. Medido na bancada: 27 KB para 208 dias
//               (~130 bytes por dia), ou seja ~150 KB pro historico inteiro do VR.
//   nuvem    -> as OCORRENCIAS (operador, PDV, produto, motivo, quem autorizou). Essas
//               tem nome de gente, entao NAO entram no arquivo do painel: vao pro
//               Supabase, na tabela frentecaixa_ocorrencias, atras de RLS.
//
// DUAS PEGADINHAS MEDIDAS NO BANCO DA LOJA. As duas ja produziram numero errado:
//
// 1) O MOTIVO DO ITEM MENTE QUANDO O CUPOM FOI CANCELADO. Quando o CUPOM inteiro e
//    cancelado, os itens dele recebem valorcancelado mas NAO recebem cancelado=true, e o
//    id_tipocancelamento do item vem NULO — o motivo verdadeiro esta no CUPOM. Lendo o
//    motivo do item nos dois casos, 53.051 ocorrencias e R$ 418.313,93 caem em "sem
//    motivo". Por isso, em TODA consulta daqui, o motivo e lido assim:
//        CASE WHEN cupom.cancelado THEN cupom.id_tipocancelamento ELSE item.id_tipocancelamento END
//    (Conferido no arquivo de medicao: os 102 cupons cancelados inteiros tem UM motivo
//     por cupom, nunca dois — o motivo e mesmo do cupom, nao do item.)
//
// 2) O VALOR NAO SAI DO CUPOM. 36 dos 99 cupons cancelados de 01 a 20/09/2026 vem com
//    subtotalimpressora = 0 (sao os cancelados durante a venda, antes de fechar o cupom).
//    Somar o subtotal subestima o cancelamento em 21%. O valor certo e a soma de
//    valorcancelado dos ITENS — e e por ITEM que a ocorrencia e contada: 1.796 itens de
//    cupons cancelados + 1.280 itens cancelados sozinhos = as 3.076 ocorrencias e os
//    R$ 30.974,04 conferidos naquele periodo.
const FCX_OCO_MESES=13;          // alcance do detalhe que vai pra nuvem (ver bloco do sync)
const FCX_OCO_DIAS=7;            // janela curta, mandada de 20 em 20 min
const FCX_OCO_MS=20*60*1000;     // janela curta: 1x a cada 20 min (igual ao setor/dia)
const FCX_OCO_FULL_MS=24*3600*1000; // varredura dos 13 meses: 1x por dia
/* ==FCXLOG== O robo avisa a nuvem como foi a carga da frente de caixa.
   POR QUE: a janela preta fecha na loja e leva o erro junto. Em 22/09/2026 a tabela ficou
   vazia por quase uma hora e eu nao tinha como saber por que sem pedir foto do log pro dono.
   Agora cada rodada deixa o recado em receb_eventos, e da pra ler de qualquer lugar.
   Nunca derruba a rodada: falha aqui so imprime aviso. */
function fcxAvisar(acao, motivo, detalhe){
  return new Promise((res)=>{
    if(!SB_KEY) return res();
    const body=JSON.stringify([{ entidade:"frentecaixa_sync",
      entidade_id:"00000000-0000-0000-0000-000000000000",
      acao:acao, motivo:String(motivo).slice(0,300), detalhe:detalhe||null }]);
    const req=https.request({host:SB_HOST,path:"/rest/v1/receb_eventos",method:"POST",
      headers:{apikey:SB_KEY,Authorization:"Bearer "+SB_KEY,"Content-Type":"application/json",
               Prefer:"return=minimal","Content-Length":Buffer.byteLength(body)}},
      r=>{ r.on("data",()=>{}); r.on("end",res); });
    req.on("error",()=>res()); req.write(body); req.end();
  });
}
function sbUpsertFcx(rows){return new Promise((res,rej)=>{const body=JSON.stringify(rows);const req=https.request({host:SB_HOST,path:"/rest/v1/frentecaixa_ocorrencias?on_conflict=tipo,venda_id,sequencia",method:"POST",headers:{apikey:SB_KEY,Authorization:"Bearer "+SB_KEY,"Content-Type":"application/json",Prefer:"resolution=merge-duplicates,return=minimal","Content-Length":Buffer.byteLength(body)}},r=>{let d="";r.on("data",c=>d+=c);r.on("end",()=>r.statusCode<300?res():rej(new Error("HTTP "+r.statusCode+" "+d)))});req.on("error",rej);req.write(body);req.end();});}

/* ==FCXSQL-INICIO== As regras e as consultas da Frente de Caixa, num pedaco so.
   Esta fatia nao depende de nada do resto do arquivo de proposito: a bancada
   (scripts/testes) consegue recortar ela, RODAR as consultas num Postgres de mentira e
   provar que o numero bate — grep nao prova nada, so rodar prova. */

/* Motivo do VR -> grupo gerencial. TEM QUE SER IGUAL ao FCX_GRUPOS do painel
   (scripts/demoDashboard.ts, bloco ==FCXCALC-INICIO==). Se os dois divergirem, o card
   mostra um total e a lista de ocorrencias mostra outro.
     erro    = 2 ERRO DE REGISTRO, 4 PRECO ERRADO, 10 DUPLICIDADE DE REGISTRO (EQUIPAMENTO)
     cliente = 1 DEVOLUCAO DO CLIENTE, 3 DINHEIRO INSUFICIENTE
     pagto   = 6 CHEQUE RECUSADO, 7 CARTAO RECUSADO OU SEM SALDO
     equip   = 5 TESTE DE EQUIPAMENTO, 8 PROBLEMA NO EQUIPAMENTO
   Motivo que nao estiver aqui (inclusive NULO, e inclusive um codigo novo que a loja
   cadastrar amanha no VR) cai em "naoclass" DE PROPOSITO, e aparece na tela. Pedido
   explicito do dono: categoria nova entrando calada dentro de um grupo existente e
   numero que mente sem ninguem perceber. */
const FCX_GRUPOS={ erro:[2,4,10], cliente:[1,3], pagto:[6,7], equip:[5,8] };
/* Desconto que leva METADE ou mais do preco do item vira alerta. Tem que ser igual ao
   FCX_CFG.limiteItem do painel. (Medido: o maior desconto do historico foi 96,32% do
   item; nenhum passa de 100%.) */
const FCX_LIMITE_ITEM=0.50;
/* Desconto manual lancado numa venda que DEPOIS foi cancelada: conta ou nao conta?
   Hoje CONTA (false), porque e assim que os R$ 159,27 / 37 ocorrencias de 01 a 20/09/2026
   foram conferidos com a loja. Nao ficou provado que exista desconto assim: dos 41
   descontos de setembro, 5 caem num cupom que teve cancelamento, mas 4 deles sao
   CLARAMENTE outra linha do mesmo cupom (quantidade diferente: 20 contra 1) e so 1 ficou
   duvidoso. Se o dono decidir que "desconto de venda cancelada nao e desconto", muda so
   esta linha pra true — o numero do card, a lista e o alerta acompanham juntos. */
const FCX_DSC_IGNORA_CANCELADO=false;

/* Em que grupo cai este motivo. Mesma regra do painel. */
function fcxGrupoDe(motivo){
  if(motivo===null||motivo===undefined||motivo==="") return "naoclass";
  const m=Number(motivo);
  if(!isFinite(m)) return "naoclass";
  for(const g in FCX_GRUPOS){ if(FCX_GRUPOS[g].indexOf(m)>=0) return g; }
  return "naoclass";
}
/* O mesmo de cima, escrito em SQL a partir da MESMA constante — assim e impossivel o
   agregado (que o painel mostra) e a lista (que a nuvem guarda) discordarem. */
function fcxCaseGrupo(expr){
  let s="CASE";
  for(const g in FCX_GRUPOS) s+=" WHEN ("+expr+") IN ("+FCX_GRUPOS[g].join(",")+") THEN '"+g+"'";
  return s+" ELSE 'naoclass' END";
}

/* O motivo de verdade (pegadinha 1) e a marca de "isto e um cancelamento". */
const FCX_MOTIVO="CASE WHEN COALESCE(cu.cancelado,false) THEN cu.id_tipocancelamento ELSE i.id_tipocancelamento END";
/* MARCADO = o VR marcou cancelado no item ou no cupom.
   CANCELADO = marcado OU tem valorcancelado. O "ou tem valor" existe pra dinheiro nunca
   sumir calado: se um dia aparecer linha com valor cancelado e sem marca, ela ENTRA na
   conta (no grupo do motivo dela) e o robo avisa no log, em vez de evaporar. Na medicao
   de setembro/2026 nao existia nenhuma assim — ou seja, isto nao muda o numero conferido. */
const FCX_MARCADO="(COALESCE(i.cancelado,false) OR COALESCE(cu.cancelado,false))";
const FCX_CANCELADO="("+FCX_MARCADO+" OR COALESCE(i.valorcancelado,0) <> 0)";

/* O AGREGADO POR DIA — uma linha por dia, que e o que vai embutido no painel.
   filtroData entra vazio (historico inteiro) ou com um AND de corte (rede de seguranca).
   UMA passada so pelas duas tabelas: cancelamento e desconto saem juntos, porque os dois
   moram na MESMA linha de vendaitem. Duas consultas custariam duas varreduras. */
function fcxSqlDia(filtroData){
  const tdesc=FCX_DSC_IGNORA_CANCELADO ? "(tdesc AND NOT marcado)" : "tdesc";
  const acima="(bruto > 0 AND vd/bruto >= "+FCX_LIMITE_ITEM+")";
  return `
    WITH linha AS (
      SELECT to_char(i.data,'YYYY-MM-DD') d,
             ${FCX_CANCELADO} canc,
             ${FCX_MARCADO}   marcado,
             ${fcxCaseGrupo(FCX_MOTIVO)} g,
             COALESCE(i.valorcancelado,0) vc,
             (COALESCE(i.valordescontomanual,0) <> 0) tdesc,
             COALESCE(i.valordescontomanual,0) vd,
             (COALESCE(i.quantidade,0) * COALESCE(i.precovenda,0)) bruto,
             i.id_tipodesconto md
        FROM pdv.vendaitem i
        JOIN pdv.venda cu ON cu.id = i.id_venda
       WHERE (COALESCE(i.cancelado,false) OR COALESCE(cu.cancelado,false)
              OR COALESCE(i.valorcancelado,0) <> 0
              OR COALESCE(i.valordescontomanual,0) <> 0)
             ${filtroData||""}
    )
    SELECT d,
      COUNT(*) FILTER (WHERE canc AND g='erro')     ce, COALESCE(SUM(vc) FILTER (WHERE canc AND g='erro'),0)     cev,
      COUNT(*) FILTER (WHERE canc AND g='cliente')  cc, COALESCE(SUM(vc) FILTER (WHERE canc AND g='cliente'),0)  ccv,
      COUNT(*) FILTER (WHERE canc AND g='pagto')    cp, COALESCE(SUM(vc) FILTER (WHERE canc AND g='pagto'),0)    cpv,
      COUNT(*) FILTER (WHERE canc AND g='equip')    cq, COALESCE(SUM(vc) FILTER (WHERE canc AND g='equip'),0)    cqv,
      COUNT(*) FILTER (WHERE canc AND g='naoclass') cn, COALESCE(SUM(vc) FILTER (WHERE canc AND g='naoclass'),0) cnv,
      COUNT(*) FILTER (WHERE ${tdesc}) dn,
      COALESCE(SUM(vd) FILTER (WHERE ${tdesc}),0) dv,
      COUNT(*) FILTER (WHERE ${tdesc} AND ${acima}) da,
      COUNT(*) FILTER (WHERE ${tdesc} AND md IS NULL) ds,
      -- OCORRENCIAS pra revisar: a linha que estourou o limite E esta sem motivo conta
      -- UMA vez. Nao e da+ds (isso seriam os MOTIVOS de alerta, que o painel mostra separado).
      COUNT(*) FILTER (WHERE ${tdesc} AND (${acima} OR md IS NULL)) dal,
      -- dois contadores que NAO vao pro painel: sao o alarme do robo (ver o log da rodada)
      COUNT(*) FILTER (WHERE canc AND vc = 0) z_semvalor,
      COUNT(*) FILTER (WHERE NOT marcado AND COALESCE(vc,0) <> 0) z_semmarca
     FROM linha
    GROUP BY d`;
}

/* AS OCORRENCIAS DE CANCELAMENTO (com nome de gente) — vao pra nuvem, nao pro painel.
   Uma linha por ITEM cancelado, que e a unidade que o dono confere. O par
   (id_venda, sequencia) identifica a linha pra sempre: e o que segura o upsert e impede
   ocorrencia duplicada quando a mesma janela e enviada de novo. */
function fcxSqlCanc(desde){
  return `
    SELECT to_char(i.data,'YYYY-MM-DD') d, to_char(cu.horainicio,'HH24:MI') h,
           cu.ecf pdv, cu.numerocupom nc, cu.id id_venda, i.sequencia seq,
           cu.matricula op_mat,
           CASE WHEN COALESCE(cu.cancelado,false) THEN cu.matriculacancelamento
                ELSE i.matriculacancelamento END fi_mat,
           COALESCE(cu.cancelado,false) ci, COALESCE(i.cancelado,false) ic,
           i.id_produto, p.descricaocompleta pr,
           i.quantidade q, COALESCE(i.valorcancelado,0) v,
           ${FCX_MOTIVO} mot
      FROM pdv.vendaitem i
      JOIN pdv.venda cu ON cu.id = i.id_venda
      LEFT JOIN public.produto p ON p.id = i.id_produto
     WHERE i.data >= ${desde}
       AND ${FCX_CANCELADO}`;
}

/* AS OCORRENCIAS DE DESCONTO MANUAL. Sao POUCAS (2.924 em todo o historico do VR), por
   isso da pra buscar o codigo de barras de cada uma sem pesar: e o numero que o dono
   digita pra achar o produto.
   PEGADINHA JA CONHECIDA: codigobarras no VR e NUMERIC — sem ::text o Postgres reclama, e
   ainda vem com ".0" no fim, que o robo tira depois. (Mesmo cuidado do sync de produtos.)
   BRUTO = quantidade x preco de venda, que e o valor do item ANTES do desconto. Foi medido
   que ele bate com valortotal nos 2.924 itens com desconto manual, mas a conta escrita e
   a definicao, nao a coincidencia: o dia que valortotal passar a vir liquido, esta conta
   continua certa. Vai tambem a marca de cancelado, pra decidir a regra do
   FCX_DSC_IGNORA_CANCELADO olhando dado, sem precisar ler o VR de novo. */
function fcxSqlDesc(desde){
  return `
    SELECT to_char(i.data,'YYYY-MM-DD') d, to_char(cu.horainicio,'HH24:MI') h,
           cu.ecf pdv, cu.numerocupom nc, cu.id id_venda, i.sequencia seq,
           cu.matricula op_mat,
           COALESCE(cu.cancelado,false) ci, COALESCE(i.cancelado,false) ic,
           i.id_produto, p.descricaocompleta pr,
           (SELECT pa.codigobarras::text FROM public.produtoautomacao pa
             WHERE pa.id_produto::text = i.id_produto::text
             ORDER BY pa.qtdembalagem LIMIT 1) cod,
           i.quantidade q,
           (COALESCE(i.quantidade,0) * COALESCE(i.precovenda,0)) br,
           COALESCE(i.valordescontomanual,0) dv,
           i.id_tipodesconto mot
      FROM pdv.vendaitem i
      JOIN pdv.venda cu ON cu.id = i.id_venda
      LEFT JOIN public.produto p ON p.id = i.id_produto
     WHERE i.data >= ${desde}
       AND COALESCE(i.valordescontomanual,0) <> 0`;
}

/* MONTA O FCX_DIA que vai embutido no painel: uma linha por dia, com ZERO onde o dia teve
   venda e nao teve nem cancelamento nem desconto.
   SEM DADO NAO E ZERO, e ZERO NAO E SEM DADO — sao duas verdades diferentes, e a tela
   escreve coisas diferentes pra cada uma. Dia que a loja abriu e nao cancelou nada precisa
   existir aqui valendo 0; dia que NAO FOI MEDIDO nao pode aparecer valendo 0, senao o
   painel jura que em 2024 ninguem cancelou nada. Por isso o preenchimento com zero para no
   PISO DO QUE FOI MEDIDO (o dia mais antigo que a consulta alcancou): se a rede de
   seguranca caiu pros ultimos 90 dias, 2024 fica "sem dados" em vez de virar mentira. */
function fcxMontaDia(rows, diasComVenda){
  const cent=v=>Math.round((Number(v)||0)*100)/100; // mesmo arredondamento do num() do robo
  if(!rows.length) return [];
  const porDia={}; rows.forEach(r=>{ porDia[r.d]=r; });
  const piso=rows.map(r=>r.d).sort()[0];
  return [...new Set((diasComVenda||[]).concat(rows.map(r=>r.d)))]
    .filter(d=>d>=piso).sort()
    .map(d=>{ const r=porDia[d]||{};
      return { d:d,
        ce:Number(r.ce||0), cev:cent(r.cev), cc:Number(r.cc||0), ccv:cent(r.ccv),
        cp:Number(r.cp||0), cpv:cent(r.cpv), cq:Number(r.cq||0), cqv:cent(r.cqv),
        cn:Number(r.cn||0), cnv:cent(r.cnv),
        dn:Number(r.dn||0), dv:cent(r.dv), da:Number(r.da||0), ds:Number(r.ds||0), dal:Number(r.dal||0) };
    });
}
/* ==FCXSQL-FIM== */

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
const PIX_CONC_MS=60*1000; // conciliacao no reserva: 1x/min (so age se o mini-robo estiver morto)
const PIX_TIMEOUT=()=>AbortSignal.timeout(30000); // nenhum fetch do worker pode travar a rodada
async function pixSbGet(q){ const r=await fetch("https://"+SB_HOST+"/rest/v1/"+q,{headers:{apikey:SB_KEY,Authorization:"Bearer "+SB_KEY},signal:PIX_TIMEOUT()}); if(!r.ok) throw new Error("Supabase GET HTTP "+r.status); return r.json(); }
// filtro = query string do PostgREST (ex: "id=eq.5" ou "id=eq.5&status=eq.pedido")
async function pixSbPatch(filtro,campos){ const r=await fetch("https://"+SB_HOST+"/rest/v1/pix_cobrancas?"+filtro,{method:"PATCH",headers:{apikey:SB_KEY,Authorization:"Bearer "+SB_KEY,"Content-Type":"application/json",Prefer:"return=minimal"},body:JSON.stringify(campos),signal:PIX_TIMEOUT()}); if(!r.ok) throw new Error("Supabase PATCH HTTP "+r.status+" "+(await r.text()).slice(0,200)); }
// igual, mas devolve as linhas alteradas (pra saber se a "reivindicacao" pegou)
async function pixSbPatchRep(filtro,campos){ const r=await fetch("https://"+SB_HOST+"/rest/v1/pix_cobrancas?"+filtro,{method:"PATCH",headers:{apikey:SB_KEY,Authorization:"Bearer "+SB_KEY,"Content-Type":"application/json",Prefer:"return=representation"},body:JSON.stringify(campos),signal:PIX_TIMEOUT()}); if(!r.ok) throw new Error("Supabase PATCH HTTP "+r.status); return r.json(); }
async function pixToken(){ const r=await fetch(PIX_BASE+"/auth/openapi/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded","context":"COBRANCA","x-api-key":PIX_KEY},body:PIX_AUTH_BODY,signal:PIX_TIMEOUT()}); if(!r.ok) throw new Error("Sicredi auth HTTP "+r.status+" "+(await r.text()).slice(0,200)); return (await r.json()).access_token; }

const d10=v=> (v instanceof Date) ? v.toISOString().slice(0,10) : String(v).slice(0,10);
const num=v=> Math.round(Number(v||0)*100)/100;
// QUILO PRECISA DE 3 CASAS. num() arredonda em 2, que e o certo pra dinheiro e errado pra
// quantidade: no acougue, hortifruti e padaria a balanca vende de 5 em 5 gramas, e cortar
// a terceira casa deslocava ate 0,005 por dia/setor. Medido em 26/08/2026 comparando o
// painel com o banco do VR ao vivo: das 12.467 linhas de dia, 5.410 diferiam — TODAS so
// por isso, nenhuma por outro motivo. Com 3 casas o painel fica identico ao VR.
const num3=v=> Math.round(Number(v||0)*1000)/1000;

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
  // Motivos de cancelamento e de desconto, do jeito que a LOJA cadastrou no VR. Lidos do
  // banco e nao escritos aqui de proposito: se o dono cadastrar um motivo novo amanha, o
  // nome dele aparece sozinho na tela (e o grupo cai em "Nao classificado", que e visivel).
  const cancMap={}, descMap={};
  (await timed(c,"motivos de cancelamento",`SELECT id, descricao FROM pdv.tipocancelamento`))
    .forEach(r=>cancMap[r.id]=(r.descricao||"").trim());
  (await timed(c,"motivos de desconto",`SELECT id, descricao FROM pdv.tipodesconto`))
    .forEach(r=>descMap[r.id]=(r.descricao||"").trim());

  // ---- DIA: faturamento (cupom, = VR Venda Liquida) + margem/qtd (itens) + cupons ----
  // Faturamento pelo TOTAL DO CUPOM (subtotalimpressora), igual ao que o VR mostra como
  // "Venda Liquida" e ao que os graficos de hora/operador ja usam. (Antes somava item a
  // item com vendaitem.valortotal, o que contava itens de cupons cancelados e nao abatia
  // descontos -> dava ~R$657 a mais que o VR.)
  const diaFat=await timed(c,"DIA faturamento (cupom)",`
    SELECT data, SUM(subtotalimpressora) fat FROM pdv.venda WHERE cancelado=false GROUP BY data`);
  const fatByDia={}; diaFat.forEach(r=>fatByDia[d10(r.data)]=num(r.fat));
  const diaIt=await timed(c,"DIA itens (margem/qtd/nprod)",`
    SELECT v.data,
           SUM(v.valortotal - COALESCE(v.customediosemimposto,0)*v.quantidade) marg,
           SUM(v.quantidade) qtd,
           COUNT(*) nprod
    FROM pdv.vendaitem v JOIN pdv.venda cp ON cp.id=v.id_venda
    WHERE v.cancelado=false AND cp.cancelado=false GROUP BY v.data`);
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
  // CUPOM CANCELADO CONTA DUAS VEZES: o item tem a marca "cancelado" dele e o CUPOM tem a
  // dele. Filtrando so a do item, passa item de cupom cancelado inteiro — e a conta fica
  // ~0,8% ACIMA do relatorio "Estatisticas" do VR. Medido DENTRO da loja em 25/08/2026
  // contra tres numeros conferidos (Bebidas jan/26, jul/26 e jan-jul/26): com os DOIS
  // filtros bate 0,00% nos tres. (Mesma pegadinha que ja tinha mordido o faturamento por
  // dia, la em cima — la a saida foi somar pelo cupom.)
  const SETOR=(await timed(c,"SETOR",`
    SELECT v.data, p.mercadologico1 m, SUM(v.valortotal) fat, SUM(v.quantidade) qtd
    FROM pdv.vendaitem v
    JOIN public.produto p ON p.id=v.id_produto
    JOIN pdv.venda cp ON cp.id=v.id_venda
    WHERE v.cancelado=false AND cp.cancelado=false GROUP BY 1,2`))
    .map(r=>({d:d10(r.data),s:setorMap[r.m]||("Setor "+r.m),fat:num(r.fat),q:num3(r.qtd)}));

  // ---- RANKING PRODUTOS por mes (top 300/mes) ----
  // DUAS REGUAS, na mesma consulta:
  //  (a) os 300 maiores da LOJA por faturamento — e o que a aba Vendas ja usava, nao mexo.
  //  (b) os 25 maiores de CADA SETOR por quantidade, de 2024 pra ca — sem isto, setor
  //      pequeno quase nao aparece: Bebidas conseguia so 12 produtos mensuraveis dentro
  //      do top-300 da loja, e "quais produtos cairam" ficava sem resposta.
  // A soma das duas e deduplicada pelo proprio SELECT (uma linha por mes+produto).
  // REDE DE SEGURANCA: a consulta nova junta produto e faz duas janelas sobre a base
  // inteira. Se ela demorar demais (limite de 4 min) ou falhar, a rodada TODA morreria e
  // o painel pararia de atualizar — o preco seria alto demais por um detalhe novo.
  // Entao: tenta a nova; se der errado, cai na antiga (top-300 da loja, sem setor) e o
  // robo segue normal. O detalhe por setor simplesmente nao aparece ate a gente ajustar.
  const SQL_RANK_ANTIGA=`
    WITH mp AS (
      SELECT to_char(date_trunc('month',v.data),'YYYY-MM') mes, v.id_produto,
             SUM(v.quantidade) qtd, SUM(v.valortotal) fat
      FROM pdv.vendaitem v JOIN pdv.venda cp ON cp.id=v.id_venda
      WHERE v.cancelado=false AND cp.cancelado=false GROUP BY 1,2)
    SELECT mes, id_produto, NULL::int m1, qtd, fat FROM (
      SELECT *, row_number() OVER (PARTITION BY mes ORDER BY fat DESC) rn FROM mp) t
    WHERE rn<=300`;
  let mp;
  try{
    mp=await timed(c,"RANKING produtos/mes (top300 loja + top25 por setor)",`
    WITH mp AS (
      SELECT to_char(date_trunc('month',v.data),'YYYY-MM') mes, v.id_produto,
             p.mercadologico1 m1,
             SUM(v.quantidade) qtd, SUM(v.valortotal) fat
      FROM pdv.vendaitem v
      JOIN public.produto p ON p.id=v.id_produto
      JOIN pdv.venda cp ON cp.id=v.id_venda
      WHERE v.cancelado=false AND cp.cancelado=false GROUP BY 1,2,3),
    num AS (
      SELECT *,
             row_number() OVER (PARTITION BY mes ORDER BY fat DESC)        rn_loja,
             row_number() OVER (PARTITION BY mes, m1 ORDER BY qtd DESC)    rn_setor
      FROM mp)
    SELECT mes, id_produto, m1, qtd, fat FROM num
    WHERE rn_loja<=300 OR (rn_setor<=25 AND mes >= '${PISO_MES}')`);
  }catch(e){
    console.log("  RANKING novo falhou ("+e.message+") - caindo na consulta antiga, sem setor.");
    mp=await timed(c,"RANKING produtos/mes (antiga, sem setor)", SQL_RANK_ANTIGA);
  }
  // ---- QUEM MAIS CAIU / MAIS CRESCEU em cada setor (a conta feita AQUI, na loja) ----
  // Antes eu mandava os 25 mais VENDIDOS de cada setor e deixava o painel comparar. O
  // problema: o 26o podia ter despencado e ninguem ficava sabendo. Em Perfumaria os 25
  // eram 21% do setor — a lista de quedas nascia incompleta e parecia completa.
  //
  // Agora o robo compara TODOS os produtos (ele tem os 47 mil aqui) e manda so o
  // resultado: 40 maiores quedas + 15 maiores altas por setor, por par de anos.
  // ~1.500 linhas em vez de 18 mil, e a resposta fica inteira.
  //
  // A JANELA e a mesma da tela do setor: meses fechados nos DOIS anos. O mes corrente
  // fica de fora — se entrasse pela metade, todo produto apareceria caindo.
  // Ausencia conta como ZERO de proposito: produto que a loja parou de vender e
  // exatamente a maior queda possivel, e some se eu exigir venda nos dois anos.
  const SQL_SETPROD=`
    WITH lim AS (
      SELECT EXTRACT(YEAR FROM CURRENT_DATE)::int ano_atual,
             EXTRACT(MONTH FROM CURRENT_DATE)::int mes_atual),
    -- SOMA PRIMEIRO, JUNTA DEPOIS. Na primeira versao eu juntava produto ANTES de
    -- agrupar: o banco cruzava produto com ~20 MILHOES de linhas de item de venda.
    -- Agrupando antes, sobram ~500 mil linhas e so entao se junta o cadastro.
    -- Mesmo resultado, uma fracao do trabalho.
    cru AS (
      SELECT v.id_produto,
             EXTRACT(YEAR FROM v.data)::int ano, EXTRACT(MONTH FROM v.data)::int mes,
             SUM(v.quantidade) qtd
      FROM pdv.vendaitem v
      JOIN pdv.venda cp ON cp.id=v.id_venda
      WHERE v.cancelado=false AND cp.cancelado=false
        AND v.data >= '${PISO_DATA}'
      GROUP BY 1,2,3),
    base AS (
      SELECT p.mercadologico1 m1, c.id_produto, c.ano, c.mes, c.qtd
      FROM cru c JOIN public.produto p ON p.id=c.id_produto
      WHERE p.mercadologico1 IS NOT NULL),
    pares AS (
      SELECT DISTINCT ano AS ano_de, ano+1 AS ano_para FROM base
      WHERE ano+1 IN (SELECT DISTINCT ano FROM base)),
    janela AS (
      SELECT pr.ano_de, pr.ano_para, g.mes
      FROM pares pr CROSS JOIN generate_series(1,12) AS g(mes) CROSS JOIN lim
      WHERE NOT (pr.ano_para = lim.ano_atual AND g.mes >= lim.mes_atual)),
    soma AS (
      SELECT j.ano_de, j.ano_para, b.m1, b.id_produto,
             SUM(CASE WHEN b.ano=j.ano_de   THEN b.qtd ELSE 0 END) de,
             SUM(CASE WHEN b.ano=j.ano_para THEN b.qtd ELSE 0 END) para,
             COUNT(DISTINCT b.mes) meses
      FROM janela j
      JOIN base b ON b.mes=j.mes AND b.ano IN (j.ano_de, j.ano_para)
      GROUP BY 1,2,3,4),
    r AS (
      SELECT *, (para-de) AS dif,
        row_number() OVER (PARTITION BY m1, ano_de ORDER BY (para-de) ASC)  rn_caiu,
        row_number() OVER (PARTITION BY m1, ano_de ORDER BY (para-de) DESC) rn_subiu
      FROM soma WHERE de>0 OR para>0)
    SELECT ano_de, ano_para, m1, id_produto, de, para, meses
    FROM r WHERE rn_caiu<=40 OR rn_subiu<=15`;
  let setprodRows=[];
  try{
    setprodRows=await timed(c,"QUEDAS/ALTAS por setor (todos os produtos)", SQL_SETPROD);
  }catch(e){
    // Mesma regra do resto: um detalhe novo nao pode derrubar a rodada inteira.
    console.log("  QUEDAS/ALTAS falhou ("+e.message+") - segue sem esse bloco.");
  }

  // nomes dos produtos que aparecem no ranking
  const ids=[...new Set(mp.map(r=>r.id_produto).concat(setprodRows.map(r=>r.id_produto)))];
  const nomeProd={};
  for(let i=0;i<ids.length;i+=2000){
    const chunk=ids.slice(i,i+2000);
    (await c.query(`SELECT id, descricaocompleta n FROM public.produto WHERE id = ANY($1)`,[chunk]))
      .rows.forEach(r=>nomeProd[r.id]=(r.n||"").trim());
  }
  // Guarda o nome CRU do setor no VR ("NOVO BEBIDAS"). Quem traduz pro nome da loja e a
  // tela, lendo vendasetor_apelido — assim existe UM lugar so com a traducao.
  // Classificar por NOME nunca: "REFRIG COCA-COLA ZERO ACUCAR" iria parar na mercearia,
  // e "AGUA SANIT" nas bebidas.
  const SETPROD=setprodRows.map(r=>({
    s:setorMap[r.m1]||"", de:Number(r.ano_de), para:Number(r.ano_para),
    id:String(r.id_produto), nome:nomeProd[r.id_produto]||("Prod "+r.id_produto),
    qd:num(r.de), qp:num(r.para), m:Number(r.meses)
  })).filter(x=>x.s);
  const MESPROD=mp.map(r=>({m:r.mes,id:String(r.id_produto),nome:nomeProd[r.id_produto]||("Prod "+r.id_produto),s:setorMap[r.m1]||"",qtd:num(r.qtd),fat:num(r.fat)}));

  // ---- FRENTE DE CAIXA por dia (os dois KPIs da Analise) ----
  // ALCANCE: o historico INTEIRO, o mesmo do DIA[] ali em cima. Medido na loja: o
  // agregado do historico inteiro leva 9,4s e os ultimos 90 dias, 0,8s. Paguei os 9,4s de
  // proposito, por um motivo de tela: o dono escolhe o periodo que quiser na Analise, e
  // DIA[] tem o historico todo. Se o cancelamento so cobrisse 90 dias, ele abriria
  // "maio/2025", veria o faturamento na tela e os dois cards novos escritos "SEM DADOS" —
  // e ia achar que o painel quebrou. Numa rodada que ja leva 2-3 min lendo a MESMA tabela
  // varias vezes, 9,4s e o preco de nao ter card mudo.
  //
  // REDE DE SEGURANCA EM TRES DEGRAUS (a mesma ideia do RANKING). Se esta consulta nova
  // travar, a rodada inteira morreria e o painel PARARIA DE ATUALIZAR — caro demais por um
  // detalhe novo. Entao: (1) o banco tem ordem de desistir sozinho em 90s
  // (statement_timeout, que interrompe o trabalho NO SERVIDOR do caixa, nao so aqui);
  // (2) se o historico inteiro falhar, tenta so os ultimos 90 dias, que e a leitura rapida
  // e ja segura o mes corrente; (3) se os dois falharem, FCX_DIA vai vazio e o painel abre
  // normal, com os dois cards escritos "sem dados". Nada do resto da rodada e afetado.
  let fcxRows=[];
  try{
    await c.query("SET statement_timeout TO 90000");
    try{
      fcxRows=await timed(c,"FRENTE DE CAIXA por dia (historico inteiro)",{text:fcxSqlDia(""),query_timeout:120000});
    }catch(e){
      console.log("  FRENTE DE CAIXA historico falhou ("+e.message+") - tentando so os ultimos 90 dias.");
      fcxRows=await timed(c,"FRENTE DE CAIXA por dia (ultimos 90 dias)",
        {text:fcxSqlDia("AND i.data >= CURRENT_DATE - INTERVAL '90 days'"),query_timeout:120000});
    }
  }catch(e){
    console.log("  FRENTE DE CAIXA falhou de vez ("+e.message+") - o painel abre sem os dois cards.");
    fcxRows=[];
  }finally{
    try{ await c.query("SET statement_timeout TO DEFAULT"); }catch(e){}
  }

  await c.end();

  // A quantidade por setor/dia sai do arquivo do painel: ela vai pro Supabase, e a tela
  // busca de la. Deixar aqui engordaria o arquivo pra todo mundo sem necessidade.
  const SETOR_ARQ = SETOR.map(r=>({d:r.d,s:r.s,fat:r.fat}));

  // ---- FCX_DIA: uma linha por dia, com zero onde o dia teve venda e nao teve nada ----
  // (a regra do zero x "sem dados" esta escrita dentro do fcxMontaDia, la em cima)
  const FCX_DIA = fcxMontaDia(fcxRows, DIA.map(x=>x.d));
  // Os dois alarmes. Nenhum dos dois apareceu na medicao de setembro/2026; se aparecerem,
  // e porque o VR mudou de comportamento — e ai o numero do painel pode diferir do que o
  // dono conferiu na mao. Melhor o robo gritar no log do que a diferenca aparecer sozinha.
  const fcxZeroVal=fcxRows.reduce((a,r)=>a+Number(r.z_semvalor||0),0);
  const fcxSemMarca=fcxRows.reduce((a,r)=>a+Number(r.z_semmarca||0),0);
  if(fcxZeroVal) console.log("ATENCAO Frente de caixa: "+fcxZeroVal+" cancelamento(s) com valor R$ 0,00 - contam como ocorrencia e nao somam dinheiro.");
  if(fcxSemMarca) console.log("ATENCAO Frente de caixa: "+fcxSemMarca+" linha(s) com valor cancelado e SEM a marca de cancelado - entraram na conta pelo motivo delas (dinheiro nao some calado), mas o VR mudou de comportamento: confira.");

  const data={ gerado:new Date().toISOString(), DIA, HORA, OP, PAG, SETOR:SETOR_ARQ, MESPROD, SETPROD, FCX_DIA };
  const outDir=path.join(__dirname,"..","output");
  if(!fs.existsSync(outDir)) fs.mkdirSync(outDir);
  const file=path.join(outDir,"vr-data.json");
  fs.writeFileSync(file, JSON.stringify(data));
  const mb=(fs.statSync(file).size/1048576).toFixed(2);
  try{ fs.writeFileSync(lockF, String(Date.now())); }catch(e){}
  console.log("\nOK -> output/vr-data.json ("+mb+" MB)");
  console.log("Linhas: SETPROD="+SETPROD.length+" DIA="+DIA.length+" HORA="+HORA.length+" OP="+OP.length+" PAG="+PAG.length+" SETOR="+SETOR.length+" MESPROD="+MESPROD.length+" FCX_DIA="+FCX_DIA.length);
  if(FCX_DIA.length){
    const fx=FCX_DIA.reduce((a,r)=>({n:a.n+r.ce+r.cc+r.cp+r.cq+r.cn, v:a.v+r.cev+r.ccv+r.cpv+r.cqv+r.cnv, dn:a.dn+r.dn, dv:a.dv+r.dv}),{n:0,v:0,dn:0,dv:0});
    console.log("Frente de caixa: "+fx.n+" cancelamentos (R$ "+num(fx.v).toFixed(2)+") e "+fx.dn+" descontos manuais (R$ "+num(fx.dv).toFixed(2)+") de "+FCX_DIA[0].d+" a "+FCX_DIA[FCX_DIA.length-1].d+".");
  } else {
    console.log("Frente de caixa: SEM DADOS nesta rodada - o painel abre com os dois cards escritos 'sem dados'.");
  }
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

  // ---- SYNC COMPRAS (notas de ENTRADA) dos produtos que a tela mostra ----
  // Alimenta o card que abre ao clicar num produto em "Venda por setor": quando chegou,
  // de quem, quantas unidades e a que custo.
  //
  // ENTRADA e nao PEDIDO de proposito: o pedido tem buraco — o acucar e comprado por
  // telefone e o pedido nao e lancado, entao pelo pedido ele apareceria como "nunca
  // comprado", sendo o produto que mais cai na mercearia. A nota de entrada existe
  // sempre, nao importa como a compra foi feita.
  //
  // UNIDADES, NAO FARDOS: a nota guarda 480 (fardos) e 30 (por fardo) em campos
  // separados. Aqui ja vai multiplicado — 14.400 — senao a tela compara 480 comprados
  // com 78 mil vendidos e parece defeito do sistema.
  const compMarkF=path.join(__dirname,"..","output","last-compras-sync.txt");
  try{
    let ultima=0; try{ ultima=Number(fs.readFileSync(compMarkF,"utf8"))||0; }catch(e){}
    if(!SB_KEY){ console.log("Sync compras: sem SUPABASE_SERVICE_KEY no .env - pulando."); }
    else if(!SETPROD.length){ console.log("Sync compras: sem lista de produtos - pulando."); }
    else if(Date.now()-ultima < COMPRAS_SYNC_MS){ console.log("Sync compras: feito ha < 6h - pulando."); }
    else {
      const idsProd=[...new Set(SETPROD.map(x=>Number(x.id)))].filter(n=>n>0);
      const c3=new Client({ ...cfg, query_timeout:600000 });
      await c3.connect();
      const linhas=(await c3.query(`
        SELECT nei.id AS id_item, nei.id_produto, ne.dataentrada AS data,
               COALESCE(f.nomefantasia, f.razaosocial) AS fornecedor,
               ne.numeronota::text AS nota,
               (nei.quantidade * GREATEST(COALESCE(nei.qtdembalagem,1),1)) AS unidades,
               nei.valor AS custo,
               COALESCE(nei.quantidadedevolvida,0) AS devolvidas,
               COALESCE(nei.quantidadebonificacao,0) AS bonificadas
        FROM public.notaentradaitem nei
        JOIN public.notaentrada ne ON ne.id = nei.id_notaentrada
        LEFT JOIN public.fornecedor f ON f.id = ne.id_fornecedor
        WHERE nei.id_produto = ANY($1::int[])
          AND ne.dataentrada >= (CURRENT_DATE - INTERVAL '3 years')`,[idsProd])).rows;
      await c3.end();
      const dados=linhas.map(r=>({
        id_item:Number(r.id_item), id_produto:Number(r.id_produto),
        data:d10(r.data), fornecedor:(r.fornecedor||"").trim()||null,
        nota:(r.nota||"").trim()||null,
        unidades:num(r.unidades), custo:r.custo==null?null:Number(r.custo),
        devolvidas:num(r.devolvidas), bonificadas:num(r.bonificadas),
        atualizado_em:new Date().toISOString() }));
      let ok=0;
      for(let i=0;i<dados.length;i+=500){ await sbUpsertCompras(dados.slice(i,i+500)); ok+=Math.min(500,dados.length-i); }
      try{ fs.writeFileSync(compMarkF, String(Date.now())); }catch(e){}
      console.log("Sync compras: "+ok+" entradas de "+idsProd.length+" produtos enviadas pra nuvem.");
    }
  }catch(e){ console.log("Sync compras: erro ("+e.message+") - robo segue normal, tenta na proxima."); }

  // ---- SYNC VENDA POR SETOR, DIA A DIA ----
  // E o que faz a tela ficar AO VIVO: com o dia guardado, o mes corrente pode ser
  // comparado com o MESMO PEDACO do ano passado (1 a 26 de agosto contra 1 a 26 de
  // agosto). Guardando so o mes fechado, agosto so apareceria em setembro.
  //
  // Manda so os APELIDOS conhecidos: "A ACERTAR" e "NOVO DESPESA" ficam de fora, porque
  // nao sao venda de setor (sao os ~0,06% que sobram entre a soma dos 13 e o total).
  const diaMarkF=path.join(__dirname,"..","output","last-vsdia-sync.txt");
  try{
    let ultima=0; try{ ultima=Number(fs.readFileSync(diaMarkF,"utf8"))||0; }catch(e){}
    if(!SB_KEY){ console.log("Sync setor/dia: sem SUPABASE_SERVICE_KEY - pulando."); }
    else if(Date.now()-ultima < DIA_SYNC_MS){ console.log("Sync setor/dia: feito ha < 20 min - pulando."); }
    else {
      const apel={};
      (await sbGetJson("vendasetor_apelido?select=setor_vr,setor,mostrar")).forEach(a=>{ apel[a.setor_vr]=a; });
      // TRADUCAO VAZIA = RODADA ABORTADA. sbGetJson so reclama de HTTP>=300; um 200 com
      // lista vazia (RLS mexida, chave trocada, tabela limpa por engano) faz TODO setor
      // cair no ramo "sem apelido", grava ZERO linha, escreve o marcador de "feito" e
      // ainda imprime "0 linhas enviadas" como se fosse rodada limpa. A nuvem congelaria
      // nos numeros de ontem e ninguem ficaria sabendo. Melhor estourar e tentar de novo.
      if(!Object.keys(apel).length) throw new Error("vendasetor_apelido voltou VAZIA - nao gravo nada nesta rodada");
      // PISO FIXO, nao janela rolante. O VR guarda ~3 anos, entao "3 anos pra tras"
      // trazia um agosto/2023 pela metade (comecava no dia 26) e a tela comparava 6 dias
      // de 2023 contra 31 de 2024 — crescimento gigante que nao existe. E pior: a janela
      // andava sozinha todo dia. Com piso em 1/1/2024, todo mes que entra e mes INTEIRO.
      // Ano ja gravado na nuvem nao some quando sair do VR: o upsert nao apaga.
      const corte=PISO_DATA;
      const desconhecidos={};
      const linhas=[]; const agora=new Date().toISOString();
      SETOR.forEach(r=>{
        if(r.d < corte) return;
        const a=apel[(r.s||"").trim()];
        if(!a){ const nm=(r.s||"").trim(); desconhecidos[nm]=(desconhecidos[nm]||0)+(r.q||0); return; }
        // mostrar=false fica de fora: "A ACERTAR" (produto ainda sem setor) e
        // "NOVO DESPESA" (lancamento de despesa) nao sao venda de setor. Sao eles que
        // explicam a sobra de ~0,06% entre a soma dos 13 e o total da loja.
        if(!a.mostrar) return;
        linhas.push({ data:r.d, setor:a.setor, quantidade:r.q, atualizado_em:agora });
      });
      // Se o VR trouxe venda e sobrou ZERO linha pra gravar, alguma coisa quebrou no
      // meio (apelido, piso, nome de setor). Nao marca a rodada como feita.
      if(SETOR.length && !linhas.length) throw new Error("o VR trouxe "+SETOR.length+" linhas e sobrou ZERO pra gravar - nao marco a rodada como feita");
      let ok=0;
      for(let i=0;i<linhas.length;i+=1000){ await sbUpsertDia(linhas.slice(i,i+1000)); ok+=Math.min(1000,linhas.length-i); }

      // ---- e o RESUMO MENSAL, feito a partir dos mesmos dias ----
      // POR QUE OS DOIS: a API do Supabase entrega no maximo 1.000 linhas por pedido e
      // NAO avisa quando corta. Se a tela lesse os 14 mil dias, receberia 1.000 e
      // mostraria numero errado achando que leu tudo. Entao a tela le o mensal (pequeno)
      // e so busca o DIA do mes corrente, que cabe num pedido so.
      // O mes corrente vai marcado completo=false — a tela precisa saber pra comparar
      // com o mesmo pedaco do ano passado em vez do mes inteiro.
      const hj=new Date(), anoHj=hj.getFullYear(), mesHj=hj.getMonth()+1;
      const accM={};
      linhas.forEach(l=>{
        const a=+l.data.slice(0,4), m=+l.data.slice(5,7), k=a+"|"+m+"|"+l.setor;
        // completo=false no mes corrente E em qualquer mes que nao caiba INTEIRO na
        // janela — cinto de seguranca pra nunca mais entrar mes pela metade como fechado.
        const mesIni=a+"-"+String(m).padStart(2,"0")+"-01";
        if(!accM[k]) accM[k]={ano:a,mes:m,setor:l.setor,quantidade:0,
          completo:!(a===anoHj&&m===mesHj) && mesIni>=corte, origem:"robo", atualizado_em:agora};
        accM[k].quantidade+=l.quantidade;
      });
      const mensal=Object.keys(accM).map(k=>{ const x=accM[k];
        x.quantidade=Math.round(x.quantidade*1000)/1000; return x; });
      let okM=0;
      for(let i=0;i<mensal.length;i+=500){ await sbUpsertMes(mensal.slice(i,i+500)); okM+=Math.min(500,mensal.length-i); }

      try{ fs.writeFileSync(diaMarkF, String(Date.now())); }catch(e){}
      console.log("Sync setor/dia: "+ok+" linhas de dia e "+okM+" de mes enviadas pra nuvem.");
      // SETOR SEM APELIDO SOME DA CONTA. O total da loja no painel e a soma dos setores,
      // entao o que cai aqui vira buraco invisivel. Imprime QUANTO se perdeu, nao so o
      // nome: 0,00% e ruido de cadastro, 3% e o painel mentindo.
      const nd=Object.keys(desconhecidos);
      if(nd.length){
        const perdido=nd.reduce((a,k)=>a+desconhecidos[k],0);
        const total=linhas.reduce((a,l)=>a+l.quantidade,0)+perdido;
        const pct=total?(perdido/total*100):0;
        console.log("Sync setor/dia: SETOR NOVO no VR SEM APELIDO, ficou de fora do painel:");
        nd.forEach(k=>console.log("   - "+k+"  ("+Math.round(desconhecidos[k])+" unidades)"));
        console.log("   isso e "+pct.toFixed(2)+"% de tudo que a loja vendeu. Cadastre em vendasetor_apelido.");
      }
    }
  }catch(e){ console.log("Sync setor/dia: erro ("+e.message+") - robo segue normal, tenta na proxima."); }

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
          const ml=msg.toLowerCase();
          if(r.status===202 || ml.indexOf("baixado")>=0){ await pixSbPatch("id=eq."+cc.id,{status:"cancelado"}); console.log("Pix: cobranca #"+cc.id+" CANCELADA (baixa no banco)."); }
          else if(ml.indexOf("liquidado")>=0){ await pixSbPatch("id=eq."+cc.id,{status:"gerado"}); console.log("Pix: cobranca #"+cc.id+" ja foi PAGA - cancelamento ignorado (a conciliacao marca)."); }
          else if(ml.indexOf("processamento")>=0 || ml.indexOf("aguardando")>=0 || ml.indexOf("confirma")>=0){ console.log("Pix: cancelamento #"+cc.id+" o banco ainda esta liberando - insiste na proxima rodada."); }
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
        // Consulta CADA cobranca aberta por NOSSO NUMERO ("essa foi paga?") — mostra
        // "LIQUIDADO PIX" na hora. (NAO uso liquidados/dia: Pix so aparece la no proximo dia util.)
        const abertas=await pixSbGet("pix_cobrancas?status=in.(gerado,erro)&nosso_numero=not.is.null&select=id,nosso_numero&limit=1000");
        let baixas=0;
        for(const ab of abertas){
          try{
            const r=await fetch(PIX_BASE+"/cobranca/boleto/v1/boletos?codigoBeneficiario="+encodeURIComponent(PIX_BENEF)+"&nossoNumero="+encodeURIComponent(ab.nosso_numero),{headers:{"x-api-key":PIX_KEY,Authorization:"Bearer "+(await pegaTok()),cooperativa:PIX_COOP,posto:PIX_POSTO},signal:PIX_TIMEOUT()});
            if(r.status===404) continue;
            if(!r.ok){ if(r.status===401) pixTok=null; continue; }
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
    }
  }catch(e){ console.log("Pix: erro ("+e.message+") - robo segue normal, tenta na proxima."); }

  // ---- SYNC FRENTE DE CAIXA: as ocorrencias (com nome de gente) pra nuvem ----
  // POR QUE NAO VAI NO ARQUIVO DO PAINEL: aqui tem nome de operador, quem autorizou o
  // cancelamento, produto e cupom. O arquivo do painel e servido pra quem abre a pagina;
  // isto so pode ser visto por quem tem permissao. Entao o numero (FCX_DIA) vai embutido e
  // a lista vai pra nuvem, atras de RLS.
  //
  // ALCANCE: 13 MESES. Por que 13 e nao 12: com 13 o mes corrente pela metade ainda pode
  // ser comparado com o MESMO mes do ano passado INTEIRO (setembro de 2026 contra setembro
  // de 2025); com 12 esse mes ja teria caido fora pela metade. Por que nao o historico
  // inteiro: sao ~155 ocorrencias por dia (~56 mil por ano) com nome de gente dentro —
  // mandar 3 anos disso a cada rodada seria carga inutil na internet da loja pra responder
  // pergunta que ninguem faz ("quem cancelou em 2024?"). O numero de 2024 continua no
  // painel, no FCX_DIA; o que tem prazo de validade e o NOME.
  //
  // DUAS VELOCIDADES, pelo mesmo motivo: mandar os 13 meses (~60 mil linhas, ~120 pedidos
  // ao Supabase) de 5 em 5 minutos entupiria a linha da loja a troco de nada, porque o
  // passado nao muda. Entao:
  //   - de 20 em 20 minutos vai a JANELA CURTA (7 dias), que e o que o dono olha;
  //   - 1x por dia vai a VARREDURA dos 13 meses, que preenche o que ficou pra tras (robo
  //     desligado, internet caida) e corrige cupom que foi cancelado depois.
  // O upsert nunca apaga: ocorrencia que sai da janela de 13 meses FICA guardada na nuvem.
  //
  // A TABELA (rodar uma vez no SQL Editor do Supabase, senao este bloco so vai dar erro
  // 404 no log e o resto da rodada segue normal):
  //
  //   create table if not exists public.frentecaixa_ocorrencias (
  //     tipo               text    not null,          -- 'cancelamento' ou 'desconto'
  //     id_venda           bigint  not null,          -- cupom no VR
  //     sequencia          int     not null,          -- linha do item dentro do cupom
  //     data               date    not null,
  //     hora               text,
  //     pdv                int,                       -- venda.ecf
  //     cupom              bigint,                    -- numero impresso no cupom
  //     operador_matricula int,
  //     operador           text,                      -- quem estava no caixa
  //     fiscal_matricula   int,
  //     fiscal             text,                      -- quem autorizou o cancelamento
  //     id_produto         bigint,
  //     produto            text,
  //     codigo             text,                      -- codigo de barras (so no desconto)
  //     quantidade         numeric(16,3),
  //     motivo_id          int,
  //     motivo             text,                      -- descricao cadastrada no VR
  //     grupo              text,                      -- erro/cliente/pagto/equip/naoclass
  //     valor              numeric(14,2),             -- cancelado, ou o desconto dado
  //     bruto              numeric(14,2),             -- so no desconto: valor do item ANTES
  //     cupom_cancelado    boolean not null default false,
  //     item_cancelado     boolean not null default false,
  //     atualizado_em      timestamptz not null default now(),
  //     primary key (tipo, id_venda, sequencia)
  //   );
  //   create index if not exists frentecaixa_oco_data_idx
  //     on public.frentecaixa_ocorrencias (data desc, tipo);
  //   -- So MASTER le: isto e nome de funcionario ao lado de "cancelou R$ 981". Escrita nao
  //   -- tem policy de proposito: quem grava e o robo com a service key, que passa por cima
  //   -- de RLS. (Mesmo desenho da compra_entradas.)
  //   do $$ declare pol record; begin
  //     alter table public.frentecaixa_ocorrencias enable row level security;
  //     for pol in select policyname from pg_policies
  //                 where schemaname='public' and tablename='frentecaixa_ocorrencias' loop
  //       execute format('drop policy if exists %I on public.frentecaixa_ocorrencias', pol.policyname);
  //     end loop;
  //     create policy "frentecaixa_sel_master" on public.frentecaixa_ocorrencias
  //       for select to authenticated
  //       using (exists (select 1 from public.perfis p where p.id = auth.uid() and p.is_master = true));
  //   end $$;
  const fcxMarkF=path.join(__dirname,"..","output","last-fcx-sync.txt");
  const fcxFullF=path.join(__dirname,"..","output","last-fcx-full.txt");
  try{
    let ultima=0, ultimaFull=0;
    try{ ultima=Number(fs.readFileSync(fcxMarkF,"utf8"))||0; }catch(e){}
    try{ ultimaFull=Number(fs.readFileSync(fcxFullF,"utf8"))||0; }catch(e){}
    const cheio=(Date.now()-ultimaFull >= FCX_OCO_FULL_MS);
    if(!SB_KEY){ console.log("Frente de caixa (nuvem): sem SUPABASE_SERVICE_KEY no .env - pulando."); }
    else if(!cheio && Date.now()-ultima < FCX_OCO_MS){ console.log("Frente de caixa (nuvem): feito ha < 20 min - pulando.");
      await fcxAvisar("pulou", "feito ha menos de 20 min", { minutos:Math.round((Date.now()-ultima)/60000) }); }
    else {
      const desde = cheio ? "CURRENT_DATE - INTERVAL '"+FCX_OCO_MESES+" months'"
                          : "CURRENT_DATE - INTERVAL '"+FCX_OCO_DIAS+" days'";
      const janela = cheio ? FCX_OCO_MESES+" meses" : FCX_OCO_DIAS+" dias";
      // Conexao PROPRIA e no fim da rodada: o arquivo do painel ja foi escrito la em cima,
      // entao nada aqui pode atrasar a atualizacao do painel. E o banco do caixa tem ordem
      // de desistir em 5 min, pra varredura grande nunca virar peso em cima da loja.
      const c4=new Client({ ...cfg, query_timeout:360000 });
      await c4.connect();
      let canc=[], desc=[];
      try{
        await c4.query("SET statement_timeout TO 300000");
        canc=(await c4.query(fcxSqlCanc(desde))).rows;
        desc=(await c4.query(fcxSqlDesc(desde))).rows;
      } finally {
        // SEM ESTE finally O ROBO TRAVA. Se a consulta estoura, a conexao fica aberta, o
        // Node acha que ainda tem trabalho e o processo NAO termina — a rodada seguinte
        // bate na trava de 4 min e o painel congela. Fechar sempre.
        try{ await c4.end(); }catch(e){}
      }
      const agora=new Date().toISOString();
      const nomeDe=m=>(m===null||m===undefined)?null:(opMap[m]||("Op "+m));
      const linhas=[];
      canc.forEach(r=>{
        const mot=(r.mot===null||r.mot===undefined)?null:Number(r.mot);
        // ==FCXCOLS== OS NOMES SAO OS DA TABELA, nao os que dao jeito aqui. O upsert do
        // PostgREST recusa o lote inteiro quando UMA coluna nao existe — e a tabela fica
        // vazia sem ninguem ver. Foi o que aconteceu em 22/09/2026: o robo mandava
        // id_venda/codigo/motivo/bruto/cupom_cancelado e a tabela tem
        // venda_id/codigo_barras/motivo_vr/valor_bruto/cupom_inteiro. Antes de acrescentar
        // campo aqui, confira a coluna NA NUVEM.
        linhas.push({ tipo:"cancelamento", venda_id:Number(r.id_venda), sequencia:Number(r.seq),
          data:r.d, hora:r.h||null, pdv:r.pdv==null?null:Number(r.pdv), cupom:r.nc==null?null:Number(r.nc),
          operador:nomeDe(r.op_mat), fiscal:nomeDe(r.fi_mat),
          produto:(r.pr||"").trim()||null, codigo_barras:null, quantidade:num3(r.q),
          motivo_id:mot, motivo_vr:(mot===null?null:(cancMap[mot]||null)), grupo:fcxGrupoDe(mot),
          valor:num(r.v), valor_bruto:null, valor_desconto:null, alertas:[],
          cupom_inteiro:!!r.ci, atualizado_em:agora });
      });
      desc.forEach(r=>{
        const mot=(r.mot===null||r.mot===undefined)?null:Number(r.mot);
        // o desconto grava o valor em DOIS lugares de proposito: "valor" e o que soma no
        // total da ocorrencia (igual pro cancelamento), e "valor_desconto" e o que a tela
        // mostra ao lado do valor original. Sao o mesmo numero, com papeis diferentes.
        const _br=num(r.br), _dv=num(r.dv);
        const _al=[];
        if(_br>0 && (_dv/_br)>=FCX_LIMITE_ITEM) _al.push("desconto acima de "+Math.round(FCX_LIMITE_ITEM*100)+"% do item");
        if(mot===null) _al.push("motivo nao informado");
        linhas.push({ tipo:"desconto", venda_id:Number(r.id_venda), sequencia:Number(r.seq),
          data:r.d, hora:r.h||null, pdv:r.pdv==null?null:Number(r.pdv), cupom:r.nc==null?null:Number(r.nc),
          operador:nomeDe(r.op_mat), fiscal:null,
          produto:(r.pr||"").trim()||null,
          // o ".0" do NUMERIC vem junto quando o codigo vira texto; sai aqui
          codigo_barras:r.cod==null?null:String(r.cod).trim().replace(/\.0+$/,"")||null,
          quantidade:num3(r.q),
          // grupo do desconto fica nulo: os grupos (erro/cliente/pagto/equip) sao a
          // classificacao do CANCELAMENTO. Desconto tem os motivos dele (preco errado,
          // venda atacado, falta produto oferta) e mistura-los esconderia os dois.
          motivo_id:mot, motivo_vr:(mot===null?null:(descMap[mot]||null)), grupo:null,
          valor:_dv, valor_bruto:_br, valor_desconto:_dv, alertas:_al,
          cupom_inteiro:!!r.ci, atualizado_em:agora });
      });
      let ok=0;
      for(let i=0;i<linhas.length;i+=500){ await sbUpsertFcx(linhas.slice(i,i+500)); ok+=Math.min(500,linhas.length-i); }
      // So marca "feito" depois que TUDO subiu. Se estourou no meio, a proxima rodada
      // refaz a mesma janela - o upsert por (tipo,id_venda,sequencia) nao duplica nada.
      try{ fs.writeFileSync(fcxMarkF, String(Date.now())); }catch(e){}
      if(cheio){ try{ fs.writeFileSync(fcxFullF, String(Date.now())); }catch(e){} }
      console.log("Frente de caixa (nuvem): "+ok+" ocorrencias ("+canc.length+" cancelamentos + "+desc.length+" descontos) dos ultimos "+janela+" enviadas.");
      await fcxAvisar("ok", ok+" ocorrencias ("+canc.length+" cancelamentos + "+desc.length+" descontos) dos ultimos "+janela,
                      { enviadas:ok, cancelamentos:canc.length, descontos:desc.length, janela:janela, cheio:cheio });
    }
  }catch(e){
    console.log("Frente de caixa (nuvem): erro ("+e.message+") - robo segue normal, tenta na proxima. (Se disser 404, a tabela frentecaixa_ocorrencias ainda nao foi criada no Supabase.)");
    try{ await fcxAvisar("com_erro", e.message, { erro:String(e.message).slice(0,500) }); }catch(e2){}
  }
})().catch(e=>{ console.log("ERRO: "+e.message); process.exit(1); });
