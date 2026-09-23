// RASCUNHO: a coluna "Autorizou" na lista de DESCONTOS, dentro do painel de verdade.
//   node scripts/previa-autorizou.cjs
// Pega o output/index.html real e troca SO a conversa com a nuvem por ocorrencias
// VERDADEIRAS lidas do VR (.previa/fcx-autorizou.json). NUNCA vai pro ar.
//
// OS DADOS VAO EM BASE64. A primeira versao colava o JSON cru dentro do <script> e
// deu 4 "Invalid or unexpected token": nome de produto do VR tem caractere que o
// navegador le como fim de string. Em base64 nao existe caractere perigoso.
const fs=require("fs"), path=require("path");
const RAIZ=path.join(process.env.HOME,"vr-looker-integration");
const DADOS=JSON.parse(fs.readFileSync(path.join(RAIZ,".previa","fcx-autorizou.json"),"utf8"))
  .map(x=>({...x, tipo:"desconto", mostra_nomes:true, alertas:[],
            quantidade:Number(x.quantidade), valor:Number(x.valor),
            valor_desconto:Number(x.valor_desconto), valor_bruto:Number(x.valor_bruto)}));
const B64=Buffer.from(JSON.stringify(DADOS),"utf8").toString("base64");
let h=fs.readFileSync(path.join(RAIZ,"output","index.html"),"utf8");

const STUB='<script>\n'+
'(function(){\n'+
'  var LINHAS = JSON.parse(decodeURIComponent(escape(atob("'+B64+'"))));\n'+
'  function abre(){\n'+
'    if(typeof fcxAbrirPainel!=="function"){ return setTimeout(abre,300); }\n'+
'    var ov=document.getElementById("authOv"); if(ov) ov.style.display="none";\n'+
'    window.__PERFIL = { master:true, mostra_nomes:true };\n'+
'    window.__SB = { rpc:function(nome){\n'+
'      if(nome==="frentecaixa_ocorrencias_listar") return Promise.resolve({data:LINHAS,error:null});\n'+
'      return Promise.resolve({data:[],error:null});\n'+
'    }};\n'+
'    setTimeout(function(){ try{ fcxAbrirPainel("desconto","manual"); }catch(e){ document.title="ERRO: "+e.message; } },500);\n'+
'  }\n'+
'  if(document.readyState==="complete") abre(); else window.addEventListener("load",abre);\n'+
'})();\n'+
'<'+'/script>';
/* A ULTIMA ocorrencia, nao a primeira. O painel escreve "</body>" DENTRO do proprio
   codigo (monta a pagina de impressao), entao replace() simples cortava o painel ao
   meio: fcxAbrirPainel deixava de existir e a previa so mostrava a tela de login. */
const fim=h.lastIndexOf("</body>");
if(fim<0) throw new Error("nao achei o fim do corpo da pagina");
h=h.slice(0,fim)+STUB+h.slice(fim);
fs.mkdirSync(path.join(RAIZ,".previa"),{recursive:true});
const saida=path.join(RAIZ,".previa","previa-autorizou.html");
fs.writeFileSync(saida,h);
console.log("PREVIA -> "+saida+"  ("+(fs.statSync(saida).size/1048576).toFixed(1)+" MB)");
console.log("  "+DADOS.length+" ocorrencias reais, com o nome de quem autorizou");
