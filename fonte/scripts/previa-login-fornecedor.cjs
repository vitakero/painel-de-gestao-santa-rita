// PREVIA da tela que o FORNECEDOR ve quando tenta entrar no painel com o login dele.
//   node scripts/previa-login-fornecedor.cjs
// Isto NUNCA vai pro ar.
const fs=require("fs"), path=require("path");
const RAIZ=path.join(process.env.HOME,"vr-looker-integration");
const SAIDA=path.join(RAIZ,".previa","previa-login-fornecedor.html");
let h=fs.readFileSync(path.join(RAIZ,"output","index.html"),"utf8");

const STUB=`<script>
(function(){
  function tenta(n){
    if(typeof mostrarFornecedor==="function"){ mostrarFornecedor(); return; }
    // a funcao mora dentro do bloco de login; se ainda nao existir, mostro a tela na mao
    var ov=document.getElementById("authOv");
    var fb=document.getElementById("authForn");
    if(ov&&fb){
      ov.style.display="flex";
      ["authLoginBox","authReset","authWait","authChecando"].forEach(function(id){
        var e=document.getElementById(id); if(e) e.style.display="none";
      });
      fb.style.display="";
      return;
    }
    if(n<80) setTimeout(function(){ tenta(n+1); },150);
  }
  setTimeout(function(){ tenta(0); }, 400);
})();
</script>`;

var _fim=h.lastIndexOf("</body>");
h=h.slice(0,_fim)+STUB+h.slice(_fim);
h=h.replace("<title>","<title>PRÉVIA · ");
fs.mkdirSync(path.dirname(SAIDA),{recursive:true});
fs.writeFileSync(SAIDA,h);
console.log("PRÉVIA -> "+SAIDA);
