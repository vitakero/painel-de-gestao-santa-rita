// SYNC: lê os agendamentos de recebimento do VR e joga na tabela central_agendamentos do Supabase.
// Precisa de SUPABASE_SERVICE_KEY no .env. Só LE o VR; ESCREVE só na nuvem.
// Roda DENTRO da rede da loja (onde o robo roda): node scripts/vr-sync-agendamento.cjs
const fs=require("fs"),path=require("path"),https=require("https"),{Client}=require("pg");
function env(){for(const p of[path.join(__dirname,"..",".env"),".env","../.env"]){try{return fs.readFileSync(p,"utf8")}catch(e){}}return""}
const E=env(),g=k=>{const m=E.match(new RegExp("^"+k+"=(.*)$","m"));return m?m[1].trim():""};
const SB_HOST="uabhsmculsfwzcrhyhch.supabase.co", SB_KEY=g("SUPABASE_SERVICE_KEY");
const PONTO_ID = "agendamento";

/* ==PONTOSINC-INICIO== — O CARTAO DE PONTO DESTA TAREFA.
   06/09/2026. Esta tarefa nao tem freio no robo.bat: se ela falhar, o robo segue e assina
   "terminei a ronda" trinta segundos depois. Era assim que ela podia morrer e ficar morta sem
   ninguem saber — a tela continuava mostrando o dado de ontem com cara de normal.

   Agora ela carimba a hora em que CONSEGUIU terminar. O painel compara esse carimbo com o
   relogio e reclama quando ele envelhece (public.robo_sincronias, coluna folga_min).

   POR QUE MEDIR SILENCIO E NAO ERRO: erro so e contado por quem ainda esta vivo pra falar.
   Esta tarefa engole excecao de proposito, pode travar esperando a rede, e pode sair como
   sucesso sem ter feito nada. Carimbo velho pega os tres; reclamacao nao pega nenhum.

   TRES DEFESAS, copiadas do assinarRonda() do publicar.cjs — carimbar NUNCA pode derrubar a
   rodada, senao a protecao vira o defeito:
     1. sem chave, desiste calado;
     2. relogio de 8s, para nao pendurar a rodada esperando a nuvem;
     3. nenhum caminho lanca erro pra fora — sempre resolve.
   E PONTO_TESTE=1 desliga tudo: em 05/09 uma bancada rodou um script de verdade e mandou dois
   e-mails de "robo parado" pro dono sem a loja ter nada. */
function baterPonto(ok, motivo, detalhe, comando) {
  return new Promise((resolve) => {
    if (process.env.PONTO_TESTE === "1") return resolve(false);
    if (!SB_KEY) return resolve(false);
    /* "quando" SO NO SUCESSO. A coluna quer dizer "a ultima vez que ela CONSEGUIU"; carimbar a
       hora na falha apagaria essa informacao e faria a tela dizer "a ultima vez que ela
       conseguiu foi ha 0 minutos" dentro da mesma faixa que anuncia a falha. PostgREST nao toca
       em coluna que nao vem no corpo, e o default now() cobre a primeira gravacao. */
    const linha = { id: PONTO_ID, ok: !!ok,
      motivo: motivo || null, detalhe: detalhe || null, comando: comando || null };
    if (ok) linha.quando = new Date().toISOString();
    const corpo = JSON.stringify([linha]);
    const p = https.request({
      host: SB_HOST, path: "/rest/v1/robo_sincronias?on_conflict=id", method: "POST",
      headers: { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY,
                 "Content-Type": "application/json", "Content-Length": Buffer.byteLength(corpo),
                 Prefer: "resolution=merge-duplicates,return=minimal" }
    }, (res) => { res.on("data", () => {}); res.on("end", () => resolve(res.statusCode < 300)); });
    p.on("error", () => resolve(false));
    p.setTimeout(8000, () => { try { p.destroy(); } catch (e) {} resolve(false); });
    p.write(corpo); p.end();
  });
}
/* ==PONTOSINC-FIM== */


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
    r.on("error",rej);
    /* RELOGIO. Sem isto, uma conexao meio-aberta com a nuvem nao da erro e nao termina: pendura
       esta tarefa, a rodada inteira atras dela, e a rodada seguinte. Descoberto em 06/09/2026. */
    r.setTimeout(20000,()=>{ try{r.destroy();}catch(e){} rej(new Error("a nuvem nao respondeu em 20s")); });
    if(data) r.write(data); r.end();
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

/* O CLIENTE PRECISA SER ALCANCAVEL DE FORA. Provado em bancada (06/09/2026, Postgres de mentira
   que aceita a conexao e nunca responde): quando o query_timeout do pg estoura, ele REJEITA a
   promessa mas NAO fecha o socket — e socket aberto segura o Node acordado. Com o catch la
   embaixo so imprimindo, o processo ficava vivo para sempre, o robo.bat travava no passo
   [1.5/4], e o painel inteiro parava de ser publicado. Um erro de SQL comum abre o mesmo buraco.
   Os outros quatro escapam porque saem com process.exit(1) ou fecham o cliente sempre. */
let cliente = null;
(async()=>{
  if(!SB_KEY){console.log("!! Falta SUPABASE_SERVICE_KEY no .env");return}
  const c=cliente=new Client({host:g("PG_HOST"),port:+g("PG_PORT"),database:g("PG_DATABASE"),user:g("PG_USER"),password:g("PG_PASSWORD"),connectionTimeoutMillis:20000,query_timeout:60000});
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

  /* PISO CONTRA APAGAR TUDO (achado em 06/09/2026, nunca aconteceu — e por isso da pra consertar
     com calma). A limpeza abaixo apaga da nuvem o que o VR nao devolveu, o que e certo quando um
     agendamento e cancelado. Mas se a leitura do VR voltar VAZIA por outro motivo — tabela
     renomeada num update deles, permissao retirada do usuario, banco sem vaga de conexao —
     entao "o VR nao devolveu" passa a valer para TODOS, e a limpeza apagaria a Central inteira,
     imprimindo PRONTO! no fim. A tela diria que nao ha recebimento marcado, indistinguivel de um
     dia parado.
     Leitura vazia com a nuvem cheia e SUSPEITA, nao ordem de apagar. */
  if(!dados.length && naNuvem.length){
    const motivo="A leitura dos agendamentos no VR voltou vazia.";
    console.log("!! "+motivo+" Ha "+naNuvem.length+" na nuvem. NAO vou apagar nada.");
    await baterPonto(false, motivo,
      "O VR nao devolveu nenhum agendamento, mas ha "+naNuvem.length+" guardados na nuvem. Apagar "+
      "tudo deixaria a Central Logistica vazia sem ninguem perceber, entao a limpeza foi cancelada.",
      "Confira no VR se ainda existem agendamentos de recebimento cadastrados. Se existirem, o robo "+
      "esta lendo a tabela errada ou perdeu a permissao de leitura.");
    return;
  }

  const orfaos=naNuvem.map(x=>x.id).filter(id=>!idsVR.has(id));
  if(orfaos.length){ await apagar(orfaos); console.log("Removido(s) "+orfaos.length+" agendamento(s) que sumiram do VR."); }

  await baterPonto(true, null, dados.length+" agendamento(s) no VR"+
                   (orfaos.length?", "+orfaos.length+" removido(s) da nuvem":"")+".", null);
  console.log(">>> PRONTO! Central Logística sincronizada com o VR.");
})().catch(async e=>{
  console.log("ERRO:",e.message);
  /* fecha o socket e SAI. Sem isto o processo fica vivo sem fazer nada, segurando a rodada. */
  try{ if(cliente) await cliente.end(); }catch(e2){}
  /* NAO carimba falha aqui de proposito: erro de rede/VR e quase sempre tropeco de uma rodada,
     e carimbar falha faria a faixa acender por um soluco. O silencio de uma rodada e coberto
     pela folga; o problema que dura acende sozinho quando o silencio passar dela. */
  process.exit(1);
});
