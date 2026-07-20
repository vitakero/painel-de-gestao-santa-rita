// SYNC: lê os agendamentos de recebimento do VR e joga na tabela central_agendamentos do Supabase.
// Precisa de SUPABASE_SERVICE_KEY no .env. Só LE o VR; ESCREVE só na nuvem.
// Roda DENTRO da rede da loja (onde o robo roda): node scripts/vr-sync-agendamento.cjs
const fs=require("fs"),path=require("path"),https=require("https"),{Client}=require("pg");
function env(){for(const p of[path.join(__dirname,"..",".env"),".env","../.env"]){try{return fs.readFileSync(p,"utf8")}catch(e){}}return""}
const E=env(),g=k=>{const m=E.match(new RegExp("^"+k+"=(.*)$","m"));return m?m[1].trim():""};
const SB_HOST="uabhsmculsfwzcrhyhch.supabase.co", SB_KEY=g("SUPABASE_SERVICE_KEY");

// O VR guarda o horário em UTC (confirmado: 09:00 local = "12:00:00.000Z" no banco).
// A loja é Caicó/RN, sempre UTC-3, sem horário de verão — então é só subtrair 3 horas fixas.
function localParts(d){
  const t=new Date(d.getTime()-3*3600*1000);
  const pad=n=>String(n).padStart(2,"0");
  return {
    data: t.getUTCFullYear()+"-"+pad(t.getUTCMonth()+1)+"-"+pad(t.getUTCDate()),
    hora: pad(t.getUTCHours())+":"+pad(t.getUTCMinutes())
  };
}

function req(method,pathq,body){
  return new Promise((res,rej)=>{
    const data=body?JSON.stringify(body):null;
    const headers={apikey:SB_KEY,Authorization:"Bearer "+SB_KEY,"Content-Type":"application/json"};
    if(method==="POST") headers.Prefer="resolution=merge-duplicates,return=minimal";
    if(data) headers["Content-Length"]=Buffer.byteLength(data);
    const r=https.request({host:SB_HOST,path:pathq,method,headers},resp=>{
      let d="";resp.on("data",c=>d+=c);
      resp.on("end",()=>resp.statusCode<300?res(d?JSON.parse(d):null):rej(new Error("HTTP "+resp.statusCode+" "+d)));
    });
    r.on("error",rej); if(data) r.write(data); r.end();
  });
}
function upsert(rows){ return req("POST","/rest/v1/central_agendamentos?on_conflict=id",rows); }
function apagar(ids){ if(!ids.length) return Promise.resolve(); return req("DELETE","/rest/v1/central_agendamentos?id=in.("+ids.map(x=>encodeURIComponent(x)).join(",")+")"); }
function listaAtual(){ return req("GET","/rest/v1/central_agendamentos?select=id"); }

const Q=`
  SELECT a.id, a.datahorainicio, a.datahoratermino, a.id_loja,
         COALESCE(l.descricao,'Loja '||a.id_loja) AS loja,
         COALESCE(f.razaosocial, f.nomefantasia, 'Fornecedor '||a.id_fornecedor) AS fornecedor,
         p.id_pedido AS pedido
  FROM public.agendamentorecebimento a
  LEFT JOIN public.fornecedor f ON f.id = a.id_fornecedor
  LEFT JOIN public.loja l ON l.id = a.id_loja
  LEFT JOIN public.pedidoagendamentorecebimento p ON p.id_agendamentorecebimento = a.id
  ORDER BY a.datahorainicio
`;

(async()=>{
  if(!SB_KEY){console.log("!! Falta SUPABASE_SERVICE_KEY no .env");return}
  const c=new Client({host:g("PG_HOST"),port:+g("PG_PORT"),database:g("PG_DATABASE"),user:g("PG_USER"),password:g("PG_PASSWORD"),connectionTimeoutMillis:20000,query_timeout:60000});
  await c.connect();console.log("Conectado no VR. Lendo agendamentos de recebimento...");
  const rows=(await c.query(Q)).rows;
  await c.end();
  console.log(rows.length+" agendamento(s) encontrado(s) no VR.");

  const dados=rows.map(r=>{
    const ini=localParts(new Date(r.datahorainicio)), fim=localParts(new Date(r.datahoratermino));
    return {
      id: String(r.id),
      vr_id: String(r.id),
      loja: r.loja,
      data: ini.data,
      hi: ini.hora,
      hf: fim.hora,
      fornecedor: r.fornecedor,
      situacao: "", // o VR nao guarda status pra essa tela; o painel calcula (programado/andamento/atrasado/concluido)
      pedido: r.pedido!=null?String(r.pedido):"",
      atualizado_em: new Date().toISOString()
    };
  });

  if(dados.length){ await upsert(dados); console.log("Enviado(s) "+dados.length+" agendamento(s) pra nuvem."); }

  // Remove da nuvem os agendamentos que sumiram do VR (cancelados/apagados).
  const idsVR=new Set(dados.map(d=>d.id));
  const naNuvem=(await listaAtual())||[];
  const orfaos=naNuvem.map(x=>x.id).filter(id=>!idsVR.has(id));
  if(orfaos.length){ await apagar(orfaos); console.log("Removido(s) "+orfaos.length+" agendamento(s) que sumiram do VR."); }

  console.log(">>> PRONTO! Central Logística sincronizada com o VR.");
})().catch(e=>console.log("ERRO:",e.message));
