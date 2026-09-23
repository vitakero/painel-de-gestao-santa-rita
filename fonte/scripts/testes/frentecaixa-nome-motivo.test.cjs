/* ==FCXNOME== A bancada do conserto de nome de motivo.
   Recorta o bloco ==FCXNOME== do robo e RODA as funcoes de verdade. O que esta em jogo:
   se o endereco do PATCH sair torto, o robo ou nao acerta nada (e o filtro da tela
   continua dobrado) ou — muito pior — acerta linha que nao era pra acertar. */
const fs=require("fs"), path=require("path");
const ARQ=path.join(__dirname,"..","buildVrData.cjs");
const src=fs.readFileSync(ARQ,"utf8");

let n=0, falhas=[];
function eq(oque,deu,esperado){
  n++;
  const a=JSON.stringify(deu), b=JSON.stringify(esperado);
  if(a!==b){ falhas.push("FALHA: "+oque+"\n    deu......: "+a+"\n    esperado.: "+b); }
}
function ok(oque,cond){ n++; if(!cond) falhas.push("FALHA: "+oque); }

/* ---- recorta o bloco puro e roda ---- */
const i=src.indexOf("==FCXNOME-INICIO=="), f=src.indexOf("==FCXNOME-FIM==");
ok("o bloco ==FCXNOME== existe no robo", i>0 && f>i);
const bloco=src.slice(src.lastIndexOf("/*",i), src.indexOf("*/",f)+2);
const M=new Function(bloco+"; return {fcxNomePath,fcxQuantasMexeu,fcxEncode};")();

/* ---- o percentuador ---- */
eq("parentese vira %28/%29", M.fcxEncode("(a)"), "%28a%29");
eq("asterisco e apostrofo tambem", M.fcxEncode("*'"), "%2A%27");
eq("acento continua funcionando", decodeURIComponent(M.fcxEncode("DEVOLUÇÃO")), "DEVOLUÇÃO");
eq("espaco vira %20", M.fcxEncode("A B"), "A%20B");
eq("virgula vira %2C", M.fcxEncode("A,B"), "A%2CB");

/* ---- o endereco ---- */
const p=M.fcxNomePath("cancelamento",10,"DUPLICIDADE DE REGISTRO (EQUIPAMENTO)");
ok("bate na tabela certa", p.indexOf("/rest/v1/frentecaixa_ocorrencias?")===0);
ok("filtra pelo tipo", p.indexOf("tipo=eq.cancelamento")>0);
ok("filtra pelo NUMERO do motivo", p.indexOf("motivo_id=eq.10")>0);
ok("so pega quem esta DIFERENTE (neq)", p.indexOf("motivo_vr=neq.")>0);
ok("nao tem parentese solto na URL (quebraria o filtro)", p.indexOf("(")<0 && p.indexOf(")")<0);
ok("nao tem espaco solto na URL", p.indexOf(" ")<0);

eq("parentese vira %28/%29", M.fcxEncode("(a)"), "%28a%29");
eq("asterisco e apostrofo tambem", M.fcxEncode("*'"), "%2A%27");
eq("acento continua funcionando", decodeURIComponent(M.fcxEncode("DEVOLUÇÃO")), "DEVOLUÇÃO");

/* o que o servidor vai ler depois de desmontar a URL */
const pedaco=decodeURIComponent(p.split("motivo_vr=neq.")[1]);
eq("o servidor le o nome CRU, inteiro", pedaco, "DUPLICIDADE DE REGISTRO (EQUIPAMENTO)");

/* A TRAVA QUE IMPORTA. Versao anterior mandava o nome entre aspas (o jeito "documentado"
   para valor com caractere especial). Passou em 37 conferencias aqui e MORREU na nuvem:
   o servidor leu a aspa como parte do nome, o neq. pegou 25.889 de 25.889 e o robo teria
   reescrito o historico inteiro toda rodada. Se alguem puser aspas de volta, para aqui. */
ok("o nome NAO vai entre aspas (o servidor leria a aspa como parte do nome)",
   p.indexOf("%22")<0 && pedaco.indexOf('"')<0);

/* tipo errado nao vaza pro outro tipo */
ok("desconto so mexe em desconto", M.fcxNomePath("desconto",1,"PRECO ERRADO").indexOf("tipo=eq.desconto")>0);
ok("cancelamento e desconto dao enderecos DIFERENTES para o mesmo numero",
   M.fcxNomePath("desconto",1,"X")!==M.fcxNomePath("cancelamento",1,"X"));

/* SEM neq o PATCH reescreveria o historico inteiro toda rodada */
ok("nunca usa eq. no nome (reescreveria tudo)", p.indexOf("motivo_vr=eq.")<0);

/* ---- a contagem do cabecalho ---- */
eq("le a contagem do Content-Range", M.fcxQuantasMexeu("0-8/9"), 9);
eq("le contagem grande", M.fcxQuantasMexeu("0-24999/31473"), 31473);
eq("nenhuma linha", M.fcxQuantasMexeu("*/0"), 0);
eq("cabecalho ausente nao quebra", M.fcxQuantasMexeu(undefined), 0);
eq("cabecalho torto nao quebra", M.fcxQuantasMexeu("sei la"), 0);

/* ---- fcxAcertarNomes: roda de verdade, com um robo de mentira no lugar do https ---- */
const ia=src.indexOf("async function fcxAcertarNomes");
const fa=src.indexOf("\n}", src.indexOf("return n;", ia))+2;
ok("fcxAcertarNomes existe", ia>0 && fa>ia);
const fazer=new Function("sbRenomearMotivo", src.slice(ia,fa)+"; return fcxAcertarNomes;");

(async()=>{
  let chamadas=[];
  const fake=async(tipo,id,nome)=>{ chamadas.push(tipo+"/"+id+"/"+nome); return 5; };

  chamadas=[];
  let r=await fazer(fake)({1:"DEVOLUCAO DE CLIENTE",3:"SALDO INSUFICIENTE"},{1:"PRECO ERRADO"});
  eq("soma as linhas acertadas dos dois cadastros", r, 15);
  eq("chamou um por motivo, cancelamento antes de desconto", chamadas,
     ["cancelamento/1/DEVOLUCAO DE CLIENTE","cancelamento/3/SALDO INSUFICIENTE","desconto/1/PRECO ERRADO"]);

  chamadas=[];
  r=await fazer(fake)({1:"",2:"   ",3:null,4:undefined,5:"BOM"},{});
  eq("nome vazio e PULADO (nunca apaga nome bom com vazio)", chamadas, ["cancelamento/5/BOM"]);
  eq("conta so o que acertou", r, 5);

  chamadas=[];
  r=await fazer(fake)({},{});
  eq("cadastro vazio nao chama ninguem", chamadas, []);
  eq("cadastro vazio devolve zero", r, 0);

  const explode=async()=>{ throw new Error("nuvem fora do ar"); };
  r=await fazer(explode)({1:"A"},{1:"B"});
  eq("nuvem fora do ar NAO derruba a rodada", r, 0);

  r=await fazer(fake)(null,null);
  eq("cadastro nulo nao quebra", r, 0);

  /* ---- a amarra que importa: o robo nao pode agrupar pelo NOME ---- */
  ok("o robo continua agrupando pelo NUMERO, nao pelo nome",
     /function fcxGrupoDe\(motivo\)/.test(src) && !/fcxGrupoDe\(.*motivo_vr/.test(src));
  n+=1;

  /* ---- a chamada esta mesmo ligada na sincronizacao ---- */
  ok("fcxAcertarNomes e chamado depois dos upserts",
     src.indexOf("await fcxAcertarNomes(cancMap,descMap)") > src.indexOf("await sbUpsertFcx(soDesc"));
  ok("o resultado entra no aviso do robo", src.indexOf("nomes_acertados:nomesAcertados")>0);

  if(falhas.length){ console.log(falhas.join("\n")); console.log("\n"+falhas.length+" FALHA(S) de "+n); process.exit(1); }
  console.log(".".repeat(n));
  console.log(n+" conferencias OK — conserto de nome de motivo");
})();
