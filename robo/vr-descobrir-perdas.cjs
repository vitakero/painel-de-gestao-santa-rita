// DETETIVE DAS PERDAS — descobre onde o VR guarda a quebra/perda do setor.
//
// O Victor lança as perdas do FLV dentro do VR e quer que o painel leia de lá em vez de
// alguém digitar todo mês. Eu não sei o nome da tabela, e o VR só é alcançável de dentro da
// loja — então quem pergunta é o robô, e a resposta vem para a nuvem.
//
// Não escreve NADA no VR. Só lê catálogo e conta linhas.
//   node scripts/vr-descobrir-perdas.cjs
const fs=require("fs"), path=require("path"), https=require("https"), { Client }=require("pg");
function env(){ for(const p of [path.join(__dirname,"..",".env"),".env","../.env"]){
  try{ return fs.readFileSync(p,"utf8"); }catch(e){} } return ""; }
const E=env(), g=(k)=>{ const m=E.match(new RegExp("^"+k+"=(.*)$","m")); return m?m[1].trim():""; };
const SB_HOST="uabhsmculsfwzcrhyhch.supabase.co", SB_KEY=g("SUPABASE_SERVICE_KEY");

function req(method,pathq,body,prefer){
  return new Promise((res,rej)=>{
    const data=body?JSON.stringify(body):null;
    const headers={apikey:SB_KEY,Authorization:"Bearer "+SB_KEY,"Content-Type":"application/json"};
    if(prefer) headers.Prefer=prefer;
    if(data) headers["Content-Length"]=Buffer.byteLength(data);
    const r=https.request({host:SB_HOST,path:pathq,method,headers},(resp)=>{
      let d=""; resp.on("data",c=>d+=c);
      resp.on("end",()=>resp.statusCode<300?res(d?JSON.parse(d):null)
        :rej(new Error("HTTP "+resp.statusCode+" "+d.slice(0,200))));
    });
    r.on("error",rej); if(data) r.write(data); r.end();
  });
}

// O DESPERDÍCIO DELE NÃO É UM LANÇAMENTO DE PERDA.
// Ele explicou assim: na primeira segunda-feira do mês contam e pesam TODO o hortifruti e
// lançam no estoque. O sistema passa a valer só o que foi contado, e o que sobrava vira
// diferença negativa — e essa diferença É o desperdício ("se não tem, é porque se perdeu").
// Ou seja: o número mora no INVENTÁRIO/BALANÇO, não numa tabela de quebra. Procuro os dois.
const PISTAS=["perda","quebra","baixa","avaria","descarte","vencid","inutil","sobra",
              "inventario","balanco","contagem","acerto","ajuste","movimenta","devolucao"];

(async()=>{
  if(!SB_KEY){ console.log("!! Falta SUPABASE_SERVICE_KEY no .env"); return; }
  const c=new Client({ host:g("PG_HOST"), port:+g("PG_PORT"), database:g("PG_DATABASE"),
    user:g("PG_USER"), password:g("PG_PASSWORD"), connectionTimeoutMillis:20000 });
  try{ await c.connect(); }
  catch(e){ console.log("NAO CONSEGUI CONECTAR NO VR: "+e.message); process.exit(1); }

  const achado={ tabelas:[], setores:[], venda:null, catalogos:null, erro:null };
  try{
    // 1) que tabelas existem com cara de perda
    const tb=(await c.query(
      "select table_schema s, table_name t from information_schema.tables "+
      "where table_schema in ('public','pdv') and table_type='BASE TABLE'")).rows;
    const cand=tb.filter(x=>PISTAS.some(p=>x.t.toLowerCase().indexOf(p)>=0));
    console.log("tabelas com cara de perda: "+(cand.map(x=>x.s+"."+x.t).join(", ")||"(nenhuma)"));

    // 2) para cada uma: quantas linhas, que colunas, e a data mais recente
    for(const x of cand.slice(0,20)){
      const nome=x.s+"."+x.t;
      let n=null, cols=[], ultima=null;
      try{ n=(await c.query("select count(*)::int c from "+nome)).rows[0].c; }catch(e){}
      try{
        cols=(await c.query("select column_name n, data_type d from information_schema.columns "+
          "where table_schema=$1 and table_name=$2 order by ordinal_position",[x.s,x.t]))
          .rows.map(r=>r.n+":"+r.d);
      }catch(e){}
      // a coluna de data, se houver, diz se a tabela está VIVA ou é entulho
      const cData=cols.map(s=>s.split(":")[0]).find(nm=>/^(data|dt|datahora|emissao)/i.test(nm));
      if(cData && n){
        try{ ultima=(await c.query("select max("+cData+")::text u from "+nome)).rows[0].u; }catch(e){}
      }
      achado.tabelas.push({ nome:nome, linhas:n, ultima:ultima, colunas:cols });
      console.log("  "+nome+"  linhas="+n+(ultima?("  ultima="+ultima):""));
    }

    // 3) A ÁRVORE DO MERCADOLÓGICO.
    // Ele disse: o setor é HORTIFRUTI e DENTRO dele existe o mercadológico FLV (frutas,
    // legumes e verduras). Então o filtro não é nível 1 — é mais fundo. Trago os três
    // primeiros níveis para achar onde o FLV mora de verdade.
    achado.setores=(await c.query(
      "select nivel, mercadologico1 m1, mercadologico2 m2, mercadologico3 m3, descricao d "+
      "from public.mercadologico where nivel <= 3 order by nivel, mercadologico1, mercadologico2, mercadologico3")).rows
      .map(r=>({ nivel:r.nivel, m1:r.m1, m2:r.m2, m3:r.m3, nome:(r.d||"").trim() }));
    console.log("mercadologicos ate o nivel 3: "+achado.setores.length);
    achado.setores.filter(x=>/horti|flv|frut|legum|verdur/i.test(x.nome))
      .forEach(x=>console.log("   nivel "+x.nivel+"  "+x.m1+"."+(x.m2||"-")+"."+(x.m3||"-")+"  "+x.nome));

    // 3b) A NOTA DE PERDA.
    // Ele contou o resto: "a gente tira uma nota de perda DEPOIS que contabiliza o estoque".
    // Ou seja, além do acerto do inventário existe um DOCUMENTO com valor e quantidade — que
    // pode ser a fonte melhor, porque já vem somado e assinado. Procuro pelo catálogo de
    // naturezas de operação / CFOP com cara de perda, para saber que documento filtrar.
    try{
      const cat=(await c.query(
        "select table_schema s, table_name t from information_schema.tables "+
        "where table_schema in ('public','pdv') "+
        "and (table_name like '%natureza%' or table_name like '%cfop%' or table_name like '%operacao%')")).rows;
      achado.catalogos=[];
      for(const x of cat.slice(0,8)){
        const nome=x.s+"."+x.t;
        try{
          const cols=(await c.query("select column_name n from information_schema.columns "+
            "where table_schema=$1 and table_name=$2",[x.s,x.t])).rows.map(r=>r.n);
          const cDesc=cols.find(n=>/descricao|nome/i.test(n));
          let linhas=[];
          if(cDesc){
            linhas=(await c.query("select * from "+nome+" where "+cDesc+
              " ~* '(perda|quebra|baixa|avaria|descarte|inutil|consumo)' limit 25")).rows;
          }
          achado.catalogos.push({ nome:nome, colunas:cols, achados:linhas });
          if(linhas.length) console.log("  "+nome+": "+linhas.length+" natureza(s) com cara de perda");
        }catch(e){}
      }
    }catch(e){}

    // 4) VENDA LÍQUIDA.
    // Ele usa a venda LÍQUIDA do setor, não a bruta. A consulta que o painel roda hoje soma
    // vendaitem.valortotal — preciso ver o que mais existe ali (desconto, acréscimo,
    // devolução) para saber se aquilo já é líquido ou se falta descontar alguma coisa.
    for(const t of [["pdv","vendaitem"],["pdv","venda"]]){
      try{
        const cols=(await c.query("select column_name n, data_type d from information_schema.columns "+
          "where table_schema=$1 and table_name=$2 order by ordinal_position",[t[0],t[1]]))
          .rows.map(r=>r.n+":"+r.d);
        achado.venda=achado.venda||{};
        achado.venda[t[0]+"."+t[1]]=cols;
        console.log(t[0]+"."+t[1]+": "+cols.filter(x=>/valor|desconto|acresc|cancel|quantidade|devol/i.test(x)).join(", "));
      }catch(e){}
    }
  }catch(e){
    achado.erro=e.message;
    console.log("!! erro na investigacao: "+e.message);
  }
  await c.end();

  try{
    const local=(await req("GET","/rest/v1/receb_locais?select=id&order=criado_em&limit=1"))[0];
    await req("POST","/rest/v1/receb_eventos",[{
      entidade:"vr_perdas", entidade_id:(local&&local.id)||"00000000-0000-0000-0000-000000000000",
      acao:"descoberta", motivo:"onde o VR guarda a quebra/perda",
      detalhe:achado }],"return=minimal");
    console.log("Resposta enviada para a nuvem.");
  }catch(e){ console.log("!! nao consegui enviar: "+e.message); }
})();
