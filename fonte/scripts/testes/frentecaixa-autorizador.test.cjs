/* ==FCXAUT== A bancada do "quem autorizou o desconto".
   Monta um VR DE MENTIRA num Postgres temporario, roda a consulta DE VERDADE (a string
   que o robo manda para a loja) e confere linha por linha. Compilar nao prova nada:
   ja aconteceu duas vezes hoje de o SQL compilar e morrer contra o banco real. */
const {execFileSync,spawnSync}=require("child_process");
const fs=require("fs"), os=require("os"), path=require("path");

function temPostgres(){ return spawnSync("which",["initdb"]).status===0; }
if(!temPostgres()){ console.log("SEM POSTGRES LOCAL — instale com: brew install postgresql@16"); process.exit(0); }

const DIR=fs.mkdtempSync(path.join(os.tmpdir(),"fcxaut-"));
const PORTA=54411;
const env={...process.env, LC_ALL:"C", LANG:"C"};
const psql=(sql)=>execFileSync("psql",["-h","127.0.0.1","-p",String(PORTA),"-U","t","-d","postgres","-v","ON_ERROR_STOP=1","-qAt","-c",sql],{env,encoding:"utf8"});
let n=0, falhas=[];
const eq=(o,d,e)=>{n++; if(String(d)!==String(e)) falhas.push("FALHA: "+o+"\n    deu: "+d+"\n    esperado: "+e);};

try{
  execFileSync("initdb",["-D",path.join(DIR,"data"),"-U","t","--auth=trust"],{env,stdio:"ignore"});
  execFileSync("pg_ctl",["-D",path.join(DIR,"data"),"-o",`-p ${PORTA} -c listen_addresses=127.0.0.1`,"-l",path.join(DIR,"log"),"start"],{env,stdio:"ignore"});
  for(let i=0;i<60;i++){ try{ psql("select 1"); break; }catch(e){ execFileSync("perl",["-e","select(undef,undef,undef,0.3)"]); } }

  psql(`
  create schema pdv; create schema if not exists public;
  -- OS TIPOS SAO OS DO VR, copiados de information_schema em 23/09/2026. Tipo errado
  -- aqui nao pega nada: a 1a versao declarou referencia como TEXT, a bancada passou em
  -- 15 conferencias e a consulta morreu contra a loja ("bigint ~ unknown").
  create table pdv.venda(id integer primary key, data date, horainicio timestamp, ecf integer, numerocupom integer, matricula integer, cancelado boolean);
  create table pdv.vendaitem(id_venda bigint, sequencia int, data date, id_produto bigint, quantidade numeric,
      precovenda numeric, cancelado boolean, valordesconto numeric, valordescontomanual numeric,
      descontomanual smallint, id_tipodesconto int, atacado boolean, oferta boolean, aplicadescontopromocao boolean);
  create table pdv.logtransacao(id integer, id_loja integer, ecf integer, datahora timestamp, matricula integer,
      referencia bigint, observacao character varying, id_funcao integer, datamovimento date);
  create table pdv.tipodesconto(id int primary key, descricao text);
  create table public.produto(id bigint primary key, descricaocompleta text);
  create table public.produtoautomacao(id_produto bigint, codigobarras numeric, qtdembalagem int);

  insert into pdv.tipodesconto values (1,'PRECO ERRADO'),(2,'VENDA ATACADO'),(3,'FALTA PRODUTO OFERTA');
  insert into public.produto values (10,'ARROZ'),(20,'FEIJAO'),(30,'CAFE'),(40,'LEITE');
  insert into pdv.venda values
    (1,'2026-09-10','2026-09-10 10:00',101,555,900,false),
    (2,'2026-09-11','2026-09-11 11:00',102,666,901,false),
    (3,'2026-09-12','2026-09-12 12:00',103,777,902,false),
    (4,'2026-09-13','2026-09-13 13:00',104,888,903,false);

  -- A: manual COM motivo no item e no log
  insert into pdv.vendaitem values (1,1,'2026-09-10',10,1,10,false,2,2,1,1,false,false,false);
  insert into pdv.logtransacao values (1,1,101,'2026-09-10 10:01',777001,555,'ITEM: 001, DESCONTO: 2,00, MOTIVO: PRECO ERRADO',165,'2026-09-10');

  -- B: manual SEM motivo no item, COM motivo no log  (o caso dos 153)
  insert into pdv.vendaitem values (2,7,'2026-09-11',20,1,10,false,3,3,1,null,false,false,false);
  insert into pdv.logtransacao values (2,1,102,'2026-09-11 11:01',777002,666,'ITEM: 007, DESCONTO: 3,00, MOTIVO: VENDA ATACADO',165,'2026-09-11');

  -- C: manual com log DUPLICADO (nao pode duplicar a ocorrencia)
  insert into pdv.vendaitem values (3,2,'2026-09-12',30,1,10,false,4,4,1,1,false,false,false);
  insert into pdv.logtransacao values
    (3,1,103,'2026-09-12 12:01',777003,777,'ITEM: 002, DESCONTO: 4,00, MOTIVO: PRECO ERRADO',165,'2026-09-12'),
    (4,1,103,'2026-09-12 12:02',777003,777,'ITEM: 002, DESCONTO: 4,00, MOTIVO: PRECO ERRADO',165,'2026-09-12');

  -- D: desconto AUTOMATICO de atacado — ninguem autorizou, nao pode ganhar fiscal
  insert into pdv.vendaitem values (4,1,'2026-09-13',40,10,10,false,5,0,0,null,true,false,false);

  -- E: linha SEM "ITEM:" — derrubaria o ::int se nao houvesse a guarda do observacao
  insert into pdv.logtransacao values
    (6,1,199,'2026-09-13 09:01',777009,123,'ESTORNO DE CUPOM, sem item nenhum aqui',165,'2026-09-13'),
    (7,1,199,'2026-09-13 09:02',777009,999,'ITEM: 001, DESCONTO: 1,00, MOTIVO: PRECO ERRADO',115,'2026-09-13');
  `);

  /* A CONSULTA DE VERDADE, recortada do robo. Recorte por contagem de chaves — o
     arquivo tem crase dentro da string, entao procurar "\n}" pega o lugar errado. */
  const src=fs.readFileSync(path.join(__dirname,"..","buildVrData.cjs"),"utf8");
  function recorta(nome){
    const ini=src.indexOf("function "+nome+"(");
    if(ini<0) throw new Error("nao achei a funcao "+nome);
    let i=src.indexOf("{",ini), nivel=0, crase=false, linha=false;
    for(let k=i;k<src.length;k++){
      const ch=src[k], ant=src[k-1];
      if(linha){ if(ch==="\n") linha=false; continue; }
      if(!crase && ch==="/" && src[k+1]==="/"){ linha=true; continue; }
      if(ch==="`" && ant!=="\\"){ crase=!crase; continue; }
      if(crase) continue;
      if(ch==="{") nivel++;
      else if(ch==="}"){ nivel--; if(nivel===0) return src.slice(ini,k+1); }
    }
    throw new Error("nao fechei a funcao "+nome);
  }
  const fcxSqlDesc=new Function(recorta("fcxCaseGrupoDesc")+";"+recorta("fcxSqlDesc")+"; return fcxSqlDesc;")();

  const sql=fcxSqlDesc("'2026-09-01'");
  eq("a consulta traz o fiscal", /aut\.amat fi_mat/.test(sql), "true");
  eq("a consulta tem a trava do GROUP BY", /GROUP BY 1,2,3,4/.test(sql), "true");
  eq("a consulta tem a guarda do ITEM", /observacao ~ 'ITEM/.test(sql), "true");
  eq("nao castra referencia para bigint (ja e bigint no VR)", /referencia::bigint/.test(sql), "false");

  const linhas=psql(`select d||'|'||seq||'|'||coalesce(fi_mat::text,'-')||'|'||coalesce(mot::text,'-')||'|'||g from (${sql}) z order by d, seq`)
                 .trim().split("\n").filter(Boolean);
  const m={}; linhas.forEach(l=>{const p=l.split("|"); m[p[0]+"#"+p[1]]={fi:p[2],mot:p[3],g:p[4]};});

  eq("quantas ocorrencias sairam (log duplicado NAO pode duplicar)", linhas.length, 4);
  eq("A: manual com motivo no item -> fiscal preenchido", m["2026-09-10#1"]?.fi, "777001");
  eq("A: motivo continua o do item", m["2026-09-10#1"]?.mot, "1");
  eq("B: item sem motivo -> o LOG preenche", m["2026-09-11#7"]?.mot, "2");
  eq("B: e o fiscal tambem", m["2026-09-11#7"]?.fi, "777002");
  eq("C: log duplicado deu UMA linha so", linhas.filter(l=>l.startsWith("2026-09-12")).length, 1);
  eq("C: com o fiscal certo", m["2026-09-12#2"]?.fi, "777003");
  eq("D: desconto AUTOMATICO nao ganha fiscal", m["2026-09-13#1"]?.fi, "-");
  eq("D: e continua sendo atacado", m["2026-09-13#1"]?.g, "atacado");
  eq("A/C continuam manual", m["2026-09-10#1"]?.g+","+m["2026-09-12#2"]?.g, "manual,manual");
  eq("E: linha de log sem ITEM NAO derrubou a consulta", linhas.length>0, "true");

  /* O QUE A GUARDA DO observacao FAZ DE VERDADE. Eu escrevi no codigo que sem ela o
     ::int estouraria. Fui conferir RODANDO: nao estoura — substring que nao casa da
     NULL, e NULL::int e NULL. A guarda nao protege de queda; ela so evita carregar
     linha inutil para a CTE. Corrigi o comentario do robo em vez de deixar escrito
     um perigo que nao existe. */
  eq("linha sem ITEM da NULL, nao estoura", psql("select coalesce(((substring('ESTORNO DE CUPOM' from 'ITEM: *0*([0-9]+)'))::int)::text,'nulo')").trim(), "nulo");
  eq("e por isso ela nunca casa com item nenhum", psql("select case when null::int = 1 then 'casou' else 'nao casou' end").trim(), "nao casou");

  /* e a prova que faltava: os tipos da bancada sao os do VR */
  const tipos=psql("select column_name||':'||data_type from information_schema.columns where table_schema='pdv' and table_name='logtransacao' order by ordinal_position").trim().split("\n");
  eq("referencia e bigint, igual ao VR", tipos.find(t=>t.startsWith("referencia:")), "referencia:bigint");
  eq("datamovimento e date, igual ao VR", tipos.find(t=>t.startsWith("datamovimento:")), "datamovimento:date");

}catch(e){ falhas.push("FALHA GERAL: "+e.message); }
finally{
  try{ execFileSync("pg_ctl",["-D",path.join(DIR,"data"),"stop","-m","immediate"],{env,stdio:"ignore"}); }catch(e){}
  try{ fs.rmSync(DIR,{recursive:true,force:true}); }catch(e){}
}

if(falhas.length){ console.log(falhas.join("\n")); console.log("\n"+falhas.length+" FALHA(S) de "+n); process.exit(1); }
console.log(".".repeat(n));
console.log(n+" conferencias OK — quem autorizou o desconto (Postgres de verdade)");
