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

  await c.end();

  // A quantidade por setor/dia sai do arquivo do painel: ela vai pro Supabase, e a tela
  // busca de la. Deixar aqui engordaria o arquivo pra todo mundo sem necessidade.
  const SETOR_ARQ = SETOR.map(r=>({d:r.d,s:r.s,fat:r.fat}));
  const data={ gerado:new Date().toISOString(), DIA, HORA, OP, PAG, SETOR:SETOR_ARQ, MESPROD, SETPROD };
  const outDir=path.join(__dirname,"..","output");
  if(!fs.existsSync(outDir)) fs.mkdirSync(outDir);
  const file=path.join(outDir,"vr-data.json");
  fs.writeFileSync(file, JSON.stringify(data));
  const mb=(fs.statSync(file).size/1048576).toFixed(2);
  try{ fs.writeFileSync(lockF, String(Date.now())); }catch(e){}
  console.log("\nOK -> output/vr-data.json ("+mb+" MB)");
  console.log("Linhas: SETPROD="+SETPROD.length+" DIA="+DIA.length+" HORA="+HORA.length+" OP="+OP.length+" PAG="+PAG.length+" SETOR="+SETOR.length+" MESPROD="+MESPROD.length);
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
})().catch(e=>{ console.log("ERRO: "+e.message); process.exit(1); });
