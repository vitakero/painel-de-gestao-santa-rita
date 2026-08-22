// Monta output/agendar.html — o PORTAL DO FORNECEDOR do Supermercado Santa Rita.
//
// 15/08/2026 — reescrita da camada visual. A primeira versão virou um cartão branco
// centralizado num fundo verde: parecia formulário, não sistema. O dono pediu um
// PORTAL de tela cheia, com barra lateral fixa, cabeçalho, tabelas e modais grandes,
// espelhando a ARQUITETURA da plataforma que o Nordestão usa — sem copiar marca,
// cor ou identidade de ninguém. A identidade continua sendo a do Santa Rita.
//
// O que NÃO mudou de propósito: a tela de entrar/criar conta. Ela está provada em
// produção desde 14/08 e usa o mesmo desenho do login do painel.
//
// De onde vem o dado: só de função (forn_*). O portal nunca lê tabela direto — assim
// um fornecedor não alcança linha de outro nem por engano de configuração, e recado
// interno da loja não chega nele nem pela API.
//
// Uma peça, um lugar: o detalhe da agenda é UM componente (abrirDetalhe), chamado
// pelo Início, pelo Calendário, pela listagem e pelo sino.
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(process.env.HOME, "vr-looker-integration");
/* O SÍMBOLO VEM DO REPOSITÓRIO, não de uma pasta temporária.
   Estava assim: `fs.readFileSync("/private/tmp/claude-501/.../scratchpad/simbolo.txt")` —
   um caminho de sessão antiga que sumiu, e com ele o gerador do portal parou de rodar.
   O arquivo de verdade mora em assets/, versionado, igual ao que o painel usa. */
const LOGO = (function(){
  try{
    return "data:image/png;base64," +
      fs.readFileSync(path.join(RAIZ, "assets", "simbolo-carrinho.png")).toString("base64");
  }catch(e){
    try{
      return "data:image/png;base64," +
        fs.readFileSync(path.join(RAIZ, "assets", "logo-santa-rita.png")).toString("base64");
    }catch(e2){ return ""; }
  }
})();

const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Portal do Fornecedor · Supermercado Santa Rita</title>
<meta name="theme-color" content="#0a4d21">
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<style>
/* ============================================================
   IDENTIDADE SANTA RITA
   verde é a marca; cinza é a área de trabalho; vermelho só alerta.
   ============================================================ */
:root{
  --verde:#157a35; --verde-esc:#0c5a26; --verde-mais:#23a847;
  --verde-cl:#e6f4ea; --verde-bg:#f4faf6; --verde-bd:#c5e3ce;
  --fundo:#f2f5f8; --branco:#fff; --borda:#e4e9ef; --borda2:#d6dee7;
  --txt:#1d2733; --txt2:#69747f; --txt3:#98a3ae;
  --verm:#c0392b; --verm-bg:#fbeae7; --verm-bd:#f0ccc5;
  --amb:#9a5b12;  --amb-bg:#fff4e5;  --amb-bd:#ffd9a8;
  --azul:#1c5a9c; --azul-bg:#e7f0fb; --azul-bd:#c6dcf5;
  --lat:238px; --alt-topo:58px;
  --sombra:0 1px 2px rgba(16,32,50,.05),0 3px 12px rgba(16,32,50,.05);
  --sombra2:0 20px 56px rgba(10,40,24,.28);
}
*{box-sizing:border-box}
html,body{height:100%}
body{margin:0;background:var(--fundo);color:var(--txt);font-size:14px;line-height:1.5;
     font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
     -webkit-font-smoothing:antialiased;}
button{font-family:inherit}
.esconde{display:none !important}

/* ============================================================
   TELA DE ENTRAR — a mesma do painel, não mexer
   ============================================================ */
#login{min-height:100dvh;display:flex;align-items:flex-start;justify-content:center;padding:18px;
       background:radial-gradient(circle at 50% 16%,#23a847 0%,#0a4d21 50%,#06301a 100%);
       background-attachment:fixed;}
.card{background:#fff;border-radius:20px;padding:24px 28px 20px;width:100%;max-width:400px;
      box-shadow:0 30px 70px rgba(0,0,0,.5);text-align:center;animation:entra .25s ease;margin:auto;}
@keyframes entra{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
.logo{width:66px;height:54px;object-fit:contain;border-radius:16px;background:#fff;
      box-shadow:0 5px 16px rgba(0,0,0,.14);padding:9px;margin:0 auto 8px;display:block;}
#login h2{margin:0 0 2px;font-size:20px;color:var(--verde-esc);font-weight:800;}
.sub{margin:0 0 14px;font-size:13px;color:#8a97a8;}
.tabs{display:flex;gap:4px;margin-bottom:12px;background:#f1f4f8;padding:4px;border-radius:12px;}
.tabs button{flex:1;padding:9px;border:0;background:transparent;border-radius:9px;font-size:13.5px;
             font-weight:700;color:#7a8696;cursor:pointer;transition:.15s;}
.tabs button.on{background:#fff;color:var(--verde);box-shadow:0 1px 5px rgba(0,0,0,.1);}
.pw-wrap{position:relative}
.pw-wrap input{padding-right:44px !important}
.pw-eye{position:absolute;right:8px;top:50%;transform:translateY(-50%);cursor:pointer;color:#9aa7b4;
        line-height:0;padding:5px 6px;user-select:none;}
.pw-eye:hover{color:var(--verde)}
.pw-eye svg{display:block;width:20px;height:20px}
.aviso{background:var(--amb-bg);border:1px solid var(--amb-bd);border-radius:14px;padding:20px 18px;}
.aviso .big{font-size:38px;line-height:1}
.aviso h3{margin:8px 0 6px;font-size:17px;color:var(--amb)}
.aviso p{margin:0;font-size:14px;color:#7a8696;line-height:1.5}

/* ============================================================
   CAMPOS — valem no portal inteiro
   ============================================================ */
.fld{margin-bottom:12px;text-align:left}
.fld label{display:block;font-size:12px;color:var(--txt2);font-weight:700;margin-bottom:4px}
.fld label .opt{font-weight:500;color:var(--txt3)}
.fld input,.fld textarea,.fld select{width:100%;border:1.5px solid var(--borda);border-radius:9px;
      padding:9px 11px;font:inherit;font-size:14px;color:var(--txt);background:#fff;transition:.15s;}
.fld textarea{resize:vertical;min-height:64px}
/* Caixa de texto da altura de um campo comum. Caixa alta e vazia ocupa
   espaço prometendo um texto que a maioria não vai escrever. Quem precisar
   de mais espaço arrasta pela alça do canto. */
.fld textarea.baixa{min-height:42px;height:42px;resize:vertical}
.fld input:focus,.fld textarea:focus,.fld select:focus{outline:none;border-color:var(--verde);
      box-shadow:0 0 0 3px rgba(21,122,53,.13);}
.fld input.ruim,.fld select.ruim{border-color:var(--verm);box-shadow:0 0 0 3px rgba(192,57,43,.11)}
.dica{font-size:11.5px;color:var(--txt3);margin-top:4px}
.dica.erro{color:var(--verm)}

.bt{border:0;background:linear-gradient(135deg,var(--verde-mais),var(--verde-esc));color:#fff;
    border-radius:9px;padding:10px 18px;font-size:14px;font-weight:800;cursor:pointer;
    box-shadow:0 4px 12px rgba(21,122,53,.26);transition:.15s;}
.bt:hover{filter:brightness(1.07)}
.bt:active{transform:scale(.99)}
.bt:disabled{opacity:.5;cursor:default;filter:none;box-shadow:none}
.bt.larga{width:100%;padding:12px;font-size:15.5px;border-radius:11px}
.bt.fraco{background:#eef2f6;color:#56606d;box-shadow:none;font-weight:700}
.bt.fraco:hover{background:#e4eaf0;filter:none}
.bt.perigo{background:#fff;color:var(--verm);border:1.5px solid var(--verm-bd);box-shadow:none}
.bt.perigo:hover{background:var(--verm-bg);filter:none}
.bt.mini{padding:7px 12px;font-size:12.5px}
.link{background:none;border:0;color:var(--verde);cursor:pointer;text-decoration:underline;
      font-weight:600;font-size:12.5px;font-family:inherit;padding:0}
#login .link{display:block;width:100%;margin-top:10px;text-align:center}

/* O aviso da tela de entrada imita o do painel: texto centralizado, sem caixa.
   As duas telas de entrada respondem a mesma coisa a quem erra o login, e responder
   igual inclui PARECER igual — caixa colorida de um lado e texto solto do outro faz o
   fornecedor perceber que caiu num lugar diferente. */
.msg{font-size:13px;margin:12px 0 0;line-height:1.45;display:none;text-align:center;
     font-weight:600}
.msg.on{display:block}
.msg.err{color:var(--verm)}
.msg.ok{color:var(--verde-esc)}

/* ============================================================
   A CASA — shell de tela cheia
   ============================================================ */
#app{display:none}
#app.on{display:block}

.lateral{position:fixed;left:0;top:0;bottom:0;width:var(--lat);z-index:30;display:flex;
         flex-direction:column;background:linear-gradient(175deg,#0c5a26,#06301a 88%);}
.lat-marca{display:flex;align-items:center;gap:10px;padding:14px 16px 16px;}
.lat-marca img{width:38px;height:32px;object-fit:contain;background:#fff;border-radius:9px;padding:4px;flex:0 0 auto}
.lat-marca b{color:#fff;font-size:14px;font-weight:800;line-height:1.15;display:block}
.lat-marca span{color:rgba(255,255,255,.6);font-size:10.5px;display:block}
.lat-nav{flex:1;padding:4px 10px;overflow-y:auto}
.lat-nav button{display:flex;align-items:center;gap:10px;width:100%;border:0;background:none;
     color:rgba(255,255,255,.78);padding:10px 12px;border-radius:9px;font-size:13.5px;font-weight:600;
     cursor:pointer;text-align:left;margin-bottom:2px;transition:.13s;}
.lat-nav button svg{width:17px;height:17px;flex:0 0 auto;opacity:.85}
.lat-nav button:hover{background:rgba(255,255,255,.09);color:#fff}
.lat-nav button.on{background:rgba(255,255,255,.16);color:#fff;font-weight:800}
.lat-pe{padding:12px 14px 16px}
.lat-pe .bt{width:100%;background:#fff;color:var(--verde-esc);box-shadow:none;
            display:flex;align-items:center;justify-content:center;gap:7px}
.lat-pe .bt:hover{background:#eaf6ee;filter:none}
.lat-pe .bt svg{width:16px;height:16px}

.topo{position:fixed;left:var(--lat);right:0;top:0;height:var(--alt-topo);z-index:25;
      background:#fff;border-bottom:1px solid var(--borda);display:flex;align-items:center;
      gap:8px;padding:0 20px;}
.topo .titulo{flex:1;font-size:16px;font-weight:800;color:var(--txt)}
.icone{background:none;border:0;cursor:pointer;color:var(--txt2);padding:8px;border-radius:9px;
       line-height:0;position:relative;flex:0 0 auto;font-family:inherit}
.icone:hover{background:#f1f4f8;color:var(--verde)}
.icone svg{width:19px;height:19px;display:block}
.bolha{position:absolute;top:3px;right:3px;min-width:15px;height:15px;background:var(--verm);
       color:#fff;border-radius:999px;font-size:9.5px;font-weight:800;line-height:15px;
       text-align:center;padding:0 4px;box-shadow:0 0 0 2px #fff}
.usuario{display:flex;align-items:center;gap:9px;padding:5px 8px 5px 10px;border-radius:9px;
         cursor:default;border-left:1px solid var(--borda);margin-left:5px}
.usuario .ini{width:30px;height:30px;border-radius:999px;background:var(--verde-cl);color:var(--verde-esc);
      font-weight:800;font-size:12px;display:flex;align-items:center;justify-content:center;flex:0 0 auto}
.usuario b{display:block;font-size:12.5px;font-weight:700;line-height:1.2;max-width:210px;
           overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.usuario span{display:block;font-size:10.5px;color:var(--txt3);font-variant-numeric:tabular-nums}

.pagina{margin-left:var(--lat);padding:calc(var(--alt-topo) + 20px) 24px 44px;min-height:100vh}
.linha-topo{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:14px}
.h-sec{font-size:15px;font-weight:800;color:var(--txt);margin:0}
.h-sec small{display:block;font-size:12px;color:var(--txt2);font-weight:500;margin-top:1px}
.colunas{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:18px;align-items:start}
@media (max-width:1120px){ .colunas{grid-template-columns:minmax(0,1fr)} }

.bloco{background:#fff;border:1px solid var(--borda);border-radius:12px;box-shadow:var(--sombra)}
.bloco-cab{display:flex;align-items:center;justify-content:space-between;gap:10px;
           padding:13px 16px;border-bottom:1px solid var(--borda)}
.bloco-cab b{font-size:14px;font-weight:800}
.bloco-corpo{padding:16px}
.bloco-corpo.zero{padding:0}

/* linhas de agenda (Início) */
.ag{display:flex;align-items:center;gap:14px;padding:13px 16px;border-bottom:1px solid #f1f4f7;
    cursor:pointer;transition:.12s}
.ag:last-child{border-bottom:0}
.ag:hover{background:#f8fafb}
.ag-nome{flex:1 1 220px;min-width:0}
.ag-nome b{display:block;font-size:13.5px;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ag-nome span{display:block;font-size:11.5px;color:var(--txt2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ag-c{flex:0 0 auto;min-width:96px}
.ag-c label{display:block;font-size:10px;color:var(--txt3);text-transform:uppercase;
            letter-spacing:.04em;font-weight:800;margin-bottom:1px}
.ag-c div{font-size:13px;font-weight:600;font-variant-numeric:tabular-nums}
.ag .seta{color:var(--txt3);flex:0 0 auto}
.ag .seta svg{width:16px;height:16px;display:block}
@media (max-width:900px){ .ag{flex-wrap:wrap;gap:8px 14px} .ag-nome{flex:1 1 100%} }

.num-lin{display:flex;align-items:center;justify-content:space-between;padding:9px 0;
         border-bottom:1px solid #f1f4f7}
.num-lin:last-child{border-bottom:0}
.num-lin span{font-size:13px;color:var(--txt2)}
.num-lin b{font-size:19px;font-weight:800;font-variant-numeric:tabular-nums}

/* ============================================================
   TABELA
   ============================================================ */
.rol{overflow-x:auto}
.tab{width:100%;border-collapse:separate;border-spacing:0;font-size:13px}
.tab th{background:#f7f9fb;font-size:10.5px;text-transform:uppercase;letter-spacing:.04em;
        color:var(--txt2);text-align:left;padding:10px 14px;border-bottom:1px solid var(--borda);
        white-space:nowrap;font-weight:800}
.tab td{padding:11px 14px;border-bottom:1px solid #f1f4f7;vertical-align:middle}
.tab tbody tr:last-child td{border-bottom:0}
.tab tbody tr.clica{cursor:pointer}
.tab tbody tr.clica:hover{background:#f8fafb}
.tab .nowrap{white-space:nowrap}
.tab .forte{font-weight:700}
.tab .tick{font-variant-numeric:tabular-nums;font-weight:700;color:var(--txt)}
.tab .par{font-size:11.5px;color:var(--txt2);display:block}
.olho{background:none;border:0;cursor:pointer;color:var(--txt3);padding:5px;border-radius:7px;line-height:0}
.olho:hover{background:var(--verde-cl);color:var(--verde)}
.olho svg{width:17px;height:17px;display:block}

.selo{display:inline-block;font-size:10px;font-weight:800;text-transform:uppercase;
      letter-spacing:.04em;border-radius:999px;padding:3px 9px;border:1px solid;white-space:nowrap}
.selo.solicitada{background:var(--amb-bg);color:var(--amb);border-color:var(--amb-bd)}
.selo.confirmada{background:var(--verde-cl);color:var(--verde-esc);border-color:var(--verde-bd)}
.selo.em_recebimento{background:var(--azul-bg);color:var(--azul);border-color:var(--azul-bd)}
.selo.concluida{background:#eef2f6;color:#56606d;border-color:var(--borda)}
.selo.recusada,.selo.cancelada,.selo.nao_compareceu{background:var(--verm-bg);color:var(--verm);border-color:var(--verm-bd)}
.selo.aberto{background:var(--verde-cl);color:var(--verde-esc);border-color:var(--verde-bd)}

/* filtros */
.filtros{border-bottom:1px solid var(--borda)}
.filtros-cab{display:flex;align-items:center;justify-content:space-between;padding:11px 16px;cursor:pointer}
.filtros-cab b{font-size:13px;font-weight:700;color:var(--txt2)}
.seta svg{width:16px;height:16px;display:block}
.filtros-cab .seta{color:var(--txt3)}
.filtros-cab .seta svg{transform:rotate(90deg);transition:.15s}
.filtros.aberto .filtros-cab .seta svg{transform:rotate(270deg)}
.filtros-corpo{display:none;padding:2px 16px 14px;border-top:1px solid #f1f4f7}
.filtros.aberto .filtros-corpo{display:block}
.filtros-grade{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px 14px}
.filtros-pe{display:flex;gap:8px;justify-content:flex-end;margin-top:12px}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.chip{border:1.5px solid var(--borda);background:#fff;border-radius:999px;padding:5px 12px;
      font-size:12px;font-weight:700;color:var(--txt2);cursor:pointer;transition:.12s}
.chip:hover{border-color:var(--borda2)}
.chip.on{background:var(--verde-cl);border-color:var(--verde-bd);color:var(--verde-esc)}

.paginacao{display:flex;align-items:center;justify-content:space-between;gap:10px;
           padding:12px 16px;border-top:1px solid var(--borda);font-size:12.5px;color:var(--txt2)}

/* estados */
.vazio{text-align:center;padding:44px 20px;color:var(--txt2)}
.vazio .ic{width:54px;height:54px;border-radius:15px;background:#eef2f6;color:#9aa5b1;
           display:flex;align-items:center;justify-content:center;margin:0 auto 13px}
.vazio .ic svg{width:25px;height:25px;display:block;stroke-width:1.7}
.vazio b{display:block;font-size:15px;color:var(--txt);font-weight:800;margin-bottom:4px}
.vazio p{margin:0 auto 14px;max-width:460px;font-size:13px;line-height:1.55}
.carregando{padding:40px 20px;text-align:center;color:var(--txt3);font-size:13px}
.carregando:before{content:"";display:block;width:22px;height:22px;margin:0 auto 10px;
  border:2.5px solid var(--borda);border-top-color:var(--verde);border-radius:999px;animation:gira .7s linear infinite}
@keyframes gira{to{transform:rotate(360deg)}}
.erro-cx{background:var(--verm-bg);border:1px solid var(--verm-bd);color:var(--verm);
         border-radius:10px;padding:12px 14px;font-size:13px;margin:0 0 12px}

/* Aviso no meio da tela, com OK. Mesmo desenho do painel: quando a mensagem
   importa, ela para a pessoa em vez de piscar num canto. */
.av-bg{position:fixed;inset:0;background:rgba(20,28,38,.45);display:flex;align-items:center;
       justify-content:center;z-index:95;padding:20px;animation:some .14s ease}
.av-cx{background:#fff;border-radius:14px;max-width:430px;width:100%;overflow:hidden;
       box-shadow:0 18px 50px rgba(0,0,0,.28);animation:entra .16s ease}
.av-top{display:flex;align-items:center;gap:13px;padding:20px 24px 0}
.av-ic{width:40px;height:40px;border-radius:50%;background:#fff4e0;color:#e08600;flex:0 0 auto;
       display:flex;align-items:center;justify-content:center}
.av-ic svg{width:22px;height:22px;display:block}
.av-ic.ok{background:#eef7f0;color:var(--verde)}
.av-tit{font-size:16px;font-weight:800;color:#1a2233}
.av-msg{padding:12px 24px 4px;color:#46535f;font-size:14px;line-height:1.5}
.av-msg ul{margin:6px 0 0;padding-left:18px}
.av-msg li{margin-bottom:5px}
.av-acts{display:flex;justify-content:flex-end;padding:18px 24px 20px}

/* toast */
#toasts{position:fixed;right:18px;bottom:18px;z-index:90;display:flex;flex-direction:column;gap:8px}
/* Com o assistente aberto, o rodapé fixo tem o "Continuar" no canto direito —
   exatamente onde a barrinha nascia. Ela cobria o botão que a pessoa ia clicar
   logo depois de soltar a nota fiscal. Sobe para ficar acima do rodapé. */
body.com-wz #toasts{bottom:86px}
.toast{background:#fff;border:1px solid var(--borda);border-left:3px solid var(--verde);
       border-radius:9px;padding:11px 15px;box-shadow:var(--sombra2);font-size:13px;font-weight:600;
       max-width:330px;animation:sobe .18s ease}
.toast.err{border-left-color:var(--verm);color:var(--verm)}
@keyframes sobe{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}

/* ============================================================
   MODAL
   ============================================================ */
/* CAMADA 85: ACIMA do assistente (70) e da gaveta (80), abaixo do aviso (95).
   Estava em 60 — atras do assistente. Toda janela aberta de dentro dele
   (ver os itens do pedido, escolher o pedido da nota) existia no DOM, tinha
   tamanho, respondia a clique... e nao aparecia. A tela parecia travada. */
.mfundo{position:fixed;inset:0;background:rgba(9,32,19,.52);z-index:85;padding:26px 18px;
        overflow-y:auto;animation:some .14s ease;
        display:flex;align-items:center;justify-content:center}
@keyframes some{from{opacity:0}to{opacity:1}}
/* margin:auto (e não align-items sozinho) porque quando o conteúdo é mais alto
   que a tela, só o margin:auto deixa o topo acessível ao rolar. */
.mcaixa{background:#fff;border-radius:14px;width:100%;max-width:1060px;margin:auto;
        box-shadow:var(--sombra2);animation:entra .18s ease;overflow:hidden}
.mcaixa.medio{max-width:620px}
.mcaixa.pequeno{max-width:430px}
.mcab{display:flex;align-items:center;justify-content:space-between;gap:12px;
      padding:15px 20px;border-bottom:1px solid var(--borda)}
.mcab b{font-size:16px;font-weight:800}
.mcorpo{padding:18px 20px 22px}

/* JANELA DE ALTURA FIXA — cabeçalho e rodapé parados, lista rolando no meio.
   Antes a janela crescia junto com a lista: num pedido de 16 itens o fim ficava
   fora da tela e não havia como chegar nele (o dono pegou testando em 22/08).
   Os 52px descontados são o respiro do .mfundo, 26px em cima e 26 embaixo. */
.mcaixa.alto{max-height:calc(100vh - 52px);display:flex;flex-direction:column}
.mcaixa.alto > *{flex:0 0 auto}
.mcaixa.alto > .rola{flex:1 1 auto;min-height:0;overflow:auto}
.rola{padding:6px 20px 10px}
/* rodapé fixo: o tamanho da carga não pode depender de rolar até o fim */
.mpe{border-top:1px solid var(--borda);background:#f8fafb;padding:12px 20px;
     display:flex;align-items:center;gap:28px;flex-wrap:wrap}
.mpe .par label{display:block;font-size:10px;color:var(--txt3);text-transform:uppercase;
     letter-spacing:.04em;font-weight:800}
.mpe .par div{font-size:14px;font-weight:800;font-variant-numeric:tabular-nums}
.mpe .fim{margin-left:auto;font-size:12px;color:var(--txt2)}

/* cabeçalho do detalhe */
.det-cab{display:flex;align-items:center;gap:22px;flex-wrap:wrap;padding:16px 20px;
         background:#f8fafb;border-bottom:1px solid var(--borda)}
.det-cab .quem b{display:block;font-size:15px;font-weight:800}
.det-cab .quem span{display:block;font-size:12px;color:var(--txt2)}
.det-cab .par{display:flex;align-items:center;gap:9px}
.det-cab .par .ic{width:32px;height:32px;border-radius:8px;background:#fff;border:1px solid var(--borda);
      display:flex;align-items:center;justify-content:center;color:var(--txt2);flex:0 0 auto}
.det-cab .par .ic svg{width:16px;height:16px}
.det-cab .par label{display:block;font-size:10px;color:var(--txt3);text-transform:uppercase;
      letter-spacing:.04em;font-weight:800}
.det-cab .par div{font-size:13px;font-weight:700;font-variant-numeric:tabular-nums}
.det-cab .fim{margin-left:auto}
.det-corpo{display:grid;grid-template-columns:minmax(0,1fr) 226px;gap:0}
@media (max-width:820px){ .det-corpo{grid-template-columns:minmax(0,1fr)} }
.det-main{padding:16px 20px 22px;min-width:0}
.det-lado{border-left:1px solid var(--borda);background:#f8fafb;padding:16px 16px 22px}
@media (max-width:820px){ .det-lado{border-left:0;border-top:1px solid var(--borda)} }
.det-lado button{display:flex;align-items:center;gap:9px;width:100%;background:#fff;
     border:1px solid var(--borda);border-radius:9px;padding:10px 12px;font-size:13px;font-weight:700;
     color:var(--txt);cursor:pointer;margin-bottom:8px;transition:.12s;text-align:left;font-family:inherit}
.det-lado button:hover{border-color:var(--verde);color:var(--verde);background:var(--verde-bg)}
.det-lado button.perigo:hover{border-color:var(--verm-bd);color:var(--verm);background:var(--verm-bg)}
.det-lado button svg{width:16px;height:16px;flex:0 0 auto;opacity:.75}
.det-lado button:disabled{opacity:.45;cursor:default}
.det-lado button:disabled:hover{border-color:var(--borda);color:var(--txt);background:#fff}

.abas{display:flex;gap:2px;background:#f1f4f8;padding:4px;border-radius:10px;margin-bottom:16px;
      overflow-x:auto;scrollbar-width:none}
.abas::-webkit-scrollbar{display:none}
.abas button{border:0;background:none;padding:8px 13px;border-radius:7px;font-size:12.5px;
     font-weight:700;color:var(--txt2);cursor:pointer;white-space:nowrap;font-family:inherit;transition:.12s}
.abas button:hover{color:var(--txt)}
.abas button.on{background:#fff;color:var(--verde);box-shadow:0 1px 4px rgba(0,0,0,.09)}

.campos{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px 18px}
@media (max-width:700px){ .campos{grid-template-columns:repeat(2,minmax(0,1fr))} }
.campo label{display:block;font-size:10.5px;color:var(--txt3);text-transform:uppercase;
             letter-spacing:.04em;font-weight:800;margin-bottom:1px}
.campo div{font-size:13.5px;font-weight:600;word-break:break-word}
.hist{list-style:none;margin:0;padding:0 0 0 15px;border-left:2px solid var(--borda)}
.hist li{font-size:12.5px;color:var(--txt2);padding:0 0 11px;position:relative;line-height:1.45}
.hist li:before{content:"";position:absolute;left:-20px;top:5px;width:7px;height:7px;border-radius:999px;
                background:var(--verde-bd);box-shadow:0 0 0 2px #fff,0 0 0 3.5px var(--verde-bd)}
.hist li b{color:var(--txt);display:block}
.recado{background:#f7f9fb;border:1px solid var(--borda);border-radius:9px;padding:11px 13px;
        margin-bottom:8px;font-size:13px;line-height:1.5}
.recado span{display:block;font-size:11px;color:var(--txt3);margin-top:5px}

/* ============================================================
   CALENDÁRIO
   ============================================================ */
.cal{display:grid;grid-template-columns:246px minmax(0,1fr);gap:16px;align-items:start}
@media (max-width:1000px){ .cal{grid-template-columns:minmax(0,1fr)} }
.mini{padding:12px}
.mini-cab{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
.mini-cab b{font-size:13px;font-weight:800}
.mini-nav{background:#f1f4f8;border:0;border-radius:7px;width:24px;height:24px;cursor:pointer;
          color:var(--txt2);font-size:14px;line-height:1;font-family:inherit}
.mini-nav:hover{background:#e4eaf0;color:var(--verde)}
.mini-grade{display:grid;grid-template-columns:repeat(7,1fr);gap:2px}
.mini-dow{font-size:9.5px;font-weight:800;color:var(--txt3);text-align:center;padding:2px 0}
.mini-d{aspect-ratio:1;border:0;background:none;border-radius:7px;font-size:11.5px;font-weight:600;
        color:var(--txt);cursor:pointer;position:relative;font-family:inherit;
        font-variant-numeric:tabular-nums;display:flex;align-items:center;justify-content:center}
.mini-d:hover{background:#f1f4f8}
.mini-d.fora{color:var(--txt3);opacity:.45}
.mini-d.hoje{background:var(--verde);color:#fff;font-weight:800}
.mini-d.sem{background:var(--verde-cl)}
.mini-d.hoje.sem{background:var(--verde)}
.mini-d i{position:absolute;bottom:3px;left:50%;transform:translateX(-50%);width:4px;height:4px;
          border-radius:999px;background:var(--verde)}
.mini-d.hoje i{background:#fff}

.visu{padding:12px 14px;border-top:1px solid var(--borda)}
.visu b{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.04em;
        color:var(--txt3);font-weight:800;margin-bottom:8px}
.visu label{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--txt);
            padding:4px 0;cursor:pointer}
.visu label.off{color:var(--txt3);cursor:default}
.visu input{width:15px;height:15px;accent-color:var(--verde);cursor:pointer}
.visu label.off input{cursor:default}
.visu .pt{width:9px;height:9px;border-radius:3px;flex:0 0 auto}

.cal-cab{display:flex;align-items:center;gap:10px;padding:11px 14px;border-bottom:1px solid var(--borda);
         flex-wrap:wrap}
.cal-cab .quando{font-size:15px;font-weight:800;flex:1;min-width:150px}
.grupo{display:flex;background:#f1f4f8;border-radius:8px;padding:3px;gap:2px}
.grupo button{border:0;background:none;padding:6px 12px;border-radius:6px;font-size:12.5px;
     font-weight:700;color:var(--txt2);cursor:pointer;font-family:inherit}
.grupo button.on{background:#fff;color:var(--verde);box-shadow:0 1px 3px rgba(0,0,0,.09)}

.sem-cab{display:grid;grid-template-columns:54px repeat(7,minmax(0,1fr));border-bottom:1px solid var(--borda);
         position:sticky;top:0;background:#fff;z-index:2}
.sem-cab .d{text-align:center;padding:7px 2px 8px;border-left:1px solid var(--borda)}
.sem-cab .d span{display:block;font-size:10px;font-weight:800;color:var(--txt3);text-transform:uppercase}
.sem-cab .d b{display:block;font-size:16px;font-weight:800;font-variant-numeric:tabular-nums;line-height:1.2}
.sem-cab .d.hoje b{color:#fff;background:var(--verde);border-radius:999px;width:26px;height:26px;
        line-height:26px;margin:1px auto 0;font-size:13.5px}
.sem-cab .d.fds{background:#fafbfc}
.sem-rol{max-height:calc(100vh - 250px);overflow-y:auto}
.sem-grade{display:grid;grid-template-columns:54px repeat(7,minmax(0,1fr))}
.sem-horas .h{height:52px;font-size:10.5px;color:var(--txt3);text-align:right;padding:0 7px;
              font-variant-numeric:tabular-nums;transform:translateY(-6px);font-weight:700}
.sem-col{position:relative;border-left:1px solid var(--borda);
         background:repeating-linear-gradient(to bottom,#fff 0,#fff 51px,#f1f4f7 51px,#f1f4f7 52px)}
.sem-col.fds{background:repeating-linear-gradient(to bottom,#fafbfc 0,#fafbfc 51px,#f1f4f7 51px,#f1f4f7 52px)}
.ev{position:absolute;left:3px;right:3px;border-radius:6px;padding:3px 6px;font-size:10.5px;
    line-height:1.3;overflow:hidden;cursor:pointer;border:1px solid;border-left-width:3px;min-height:20px}
.ev b{display:block;font-weight:800;font-size:11px;font-variant-numeric:tabular-nums}
.ev span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ev:hover{filter:brightness(.97);box-shadow:0 2px 8px rgba(0,0,0,.13)}
.ev.solicitada{background:var(--amb-bg);border-color:var(--amb-bd);color:var(--amb)}
.ev.confirmada{background:var(--verde-cl);border-color:var(--verde-bd);color:var(--verde-esc)}
.ev.em_recebimento{background:var(--azul-bg);border-color:var(--azul-bd);color:var(--azul)}
.ev.concluida{background:#eef2f6;border-color:var(--borda);color:#56606d}
.ev.recusada,.ev.cancelada,.ev.nao_compareceu{background:var(--verm-bg);border-color:var(--verm-bd);color:var(--verm)}

.mes-grade{display:grid;grid-template-columns:repeat(7,minmax(0,1fr))}
.mes-dow{font-size:10px;font-weight:800;color:var(--txt3);text-transform:uppercase;text-align:center;
         padding:7px 0;border-bottom:1px solid var(--borda);border-left:1px solid var(--borda)}
.mes-d{min-height:104px;border-left:1px solid var(--borda);border-bottom:1px solid var(--borda);
       padding:5px 5px 6px}
.mes-d.fds{background:#fafbfc}
.mes-d.fora{background:#f7f9fb}
.mes-d>b{display:block;font-size:12px;font-weight:700;font-variant-numeric:tabular-nums;
         color:var(--txt2);margin-bottom:3px;text-align:right}
.mes-d.hoje>b{color:#fff;background:var(--verde);border-radius:999px;width:21px;height:21px;
              line-height:21px;text-align:center;margin-left:auto;font-size:11px}
.mes-d.fora>b{opacity:.4}
.mes-ev{border-radius:5px;padding:2px 5px;font-size:10.5px;font-weight:700;margin-bottom:2px;
        cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border-left:2.5px solid}
.mes-ev.solicitada{background:var(--amb-bg);border-color:var(--amb-bd);color:var(--amb)}
.mes-ev.confirmada{background:var(--verde-cl);border-color:var(--verde-bd);color:var(--verde-esc)}
.mes-ev.em_recebimento{background:var(--azul-bg);border-color:var(--azul-bd);color:var(--azul)}
.mes-ev.concluida{background:#eef2f6;border-color:var(--borda2);color:#56606d}
.mes-ev.recusada,.mes-ev.cancelada,.mes-ev.nao_compareceu{background:var(--verm-bg);border-color:var(--verm-bd);color:var(--verm)}

/* ============================================================
   WIZARD — nova agenda em tela cheia
   ============================================================ */
.wz{position:fixed;inset:0;z-index:70;background:var(--fundo);display:flex;flex-direction:column}

/* faixa de identidade: fina, só marca e fechar. O verde vira assinatura, não peso. */
.wz-topo{height:50px;flex:0 0 auto;background:var(--verde-esc);
         display:flex;align-items:center;padding:0 10px 0 18px;gap:10px}
.wz-topo .marca{color:#fff;font-weight:800;font-size:13.5px;white-space:nowrap;
                display:flex;align-items:center;gap:9px;letter-spacing:.01em}
.wz-topo .marca img{width:26px;height:22px;object-fit:contain;background:#fff;border-radius:6px;padding:3px}
.wz-topo .fechar{margin-left:auto;color:#fff;opacity:.8}
.wz-topo .fechar:hover{background:rgba(255,255,255,.14);opacity:1}

/* trilha das etapas: linha branca, estados claros, sem parecer desligada */
.wz-trilha{flex:0 0 auto;background:#fff;border-bottom:1px solid var(--borda);
           padding:0 18px;overflow-x:auto;scrollbar-width:none}
.wz-trilha::-webkit-scrollbar{display:none}
.wz-trilha ol{display:flex;align-items:center;gap:0;list-style:none;margin:0;padding:13px 0 12px;
              min-width:max-content}
.wz-p{display:flex;align-items:center;gap:9px;white-space:nowrap;padding:0 2px}
.wz-p i{width:24px;height:24px;border-radius:999px;flex:0 0 auto;font-style:normal;font-size:11.5px;
        font-weight:800;display:flex;align-items:center;justify-content:center;
        border:1.5px solid var(--borda2);background:#fff;color:var(--txt3);transition:.15s}
.wz-p i svg{width:13px;height:13px;display:block;stroke-width:3}
.wz-p b{font-size:12.5px;font-weight:600;color:var(--txt2)}
.wz-p.feito i{background:var(--verde-cl);border-color:var(--verde-bd);color:var(--verde-esc)}
.wz-p.feito b{color:var(--txt2)}
.wz-p.on i{background:var(--verde);border-color:var(--verde);color:#fff;
           box-shadow:0 0 0 3px rgba(21,122,53,.14)}
.wz-p.on b{color:var(--txt);font-weight:800}
.wz-p.travado i{border-style:dashed}
.wz-p.travado b{color:var(--txt3)}
.wz-liga{flex:1 1 26px;min-width:16px;height:1.5px;background:var(--borda);margin:0 9px}
.wz-liga.feito{background:var(--verde-bd)}

.wz-corpo{flex:1;display:flex;min-height:0}
.wz-main{flex:1;overflow-y:auto;padding:26px 28px 34px;min-width:0}
/* Largura de leitura: campo do tamanho do DADO, não do tamanho do monitor.
   Centralizado, senão a sobra vira um buraco só do lado direito. */
.wz-form{max-width:680px;margin:0 auto}
/* 680px é a medida certa pra CAMPO de digitar — linha comprida demais cansa
   de ler. Mas a cobrança é uma tabela com um total do lado: no limite do
   formulário ela ficava espremida num canto, com a tela vazia em volta. */
.wz-form.larga{max-width:1000px}
.wz h3{font-size:19px;font-weight:800;margin:0 0 3px;letter-spacing:-.01em}
.wz .subt{color:var(--txt2);font-size:13.5px;margin:0 0 22px}

.secao{border-top:1px solid var(--borda);padding-top:18px;margin-top:22px}
.secao:first-of-type{border-top:0;padding-top:0;margin-top:0}
.secao > label.tit{display:block;font-size:11px;font-weight:800;text-transform:uppercase;
                   letter-spacing:.05em;color:var(--txt3);margin-bottom:2px}
.secao > p.ajuda{margin:0 0 13px;font-size:12.5px;color:var(--txt2)}

/* seletor de duas vias (Fornecedor / Transportadora) */
.seg{display:inline-flex;background:#eef2f6;border-radius:10px;padding:3px;gap:2px}
.seg button{border:0;background:none;padding:8px 18px;border-radius:8px;font-size:13.5px;
            font-weight:700;color:var(--txt2);cursor:pointer;font-family:inherit;transition:.13s}
.seg button:hover{color:var(--txt)}
.seg button.on{background:#fff;color:var(--verde-esc);box-shadow:0 1px 4px rgba(16,32,50,.12)}

/* as duas escolhas de nota fiscal, lado a lado, caixa inteira clicável */
.opc{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media (max-width:760px){ .opc{grid-template-columns:1fr} }
.opc button{display:flex;align-items:flex-start;gap:11px;background:#fff;border:1.5px solid var(--borda);
     border-radius:12px;padding:14px 15px;cursor:pointer;text-align:left;font-family:inherit;
     transition:.13s;width:100%}
.opc button:hover{border-color:var(--borda2);background:#fcfdfe}
.opc button.on{border-color:var(--verde);background:var(--verde-bg);
                box-shadow:0 0 0 3px rgba(21,122,53,.10)}
.opc .marca-r{width:18px;height:18px;border-radius:999px;border:1.5px solid var(--borda2);
     flex:0 0 auto;margin-top:1px;display:flex;align-items:center;justify-content:center;transition:.13s}
.opc button.on .marca-r{border-color:var(--verde);border-width:5.5px}
.opc .txt b{display:block;font-size:13.5px;font-weight:800;color:var(--txt);line-height:1.3}
.opc button.on .txt b{color:var(--verde-esc)}
.opc .txt span{display:block;font-size:12px;color:var(--txt2);margin-top:2px;line-height:1.4}
.opc .ico{color:var(--txt3);flex:0 0 auto;margin-left:auto}
.opc button.on .ico{color:var(--verde)}
.opc .ico svg{width:18px;height:18px;display:block}

/* aviso discreto: informa sem gritar */
/* Verde no lugar de azul: a paleta é branco, cinza e verde Santa Rita.
   Vermelho fica reservado para erro de verdade. */
.info{display:flex;gap:10px;align-items:flex-start;background:#f8faf9;border:1px solid var(--borda);
      border-left:3px solid var(--verde);border-radius:10px;padding:11px 13px;margin-top:12px}
.info .ic{color:var(--verde);flex:0 0 auto;margin-top:1px}
.info .ic svg{width:16px;height:16px;display:block}
.info b{display:block;font-size:12.5px;font-weight:800;color:var(--txt);margin-bottom:2px}
.info p{margin:0;font-size:12.5px;color:var(--txt2);line-height:1.5}

.estreito{max-width:230px}
.medio{max-width:340px}

/* resumo: coluna branca, valores em destaque, sem virar mosaico colorido */
.wz-lado{width:318px;flex:0 0 318px;border-left:1px solid var(--borda);background:#fff;
         overflow-y:auto;padding:24px 22px}
@media (max-width:980px){ .wz-lado{display:none} }
.wz-lado b.tit{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.05em;
               color:var(--txt3);font-weight:800;margin-bottom:4px}
.wz-lado p.tit2{margin:0 0 16px;font-size:12px;color:var(--txt3);line-height:1.45}
.wz-res{display:flex;align-items:flex-start;gap:11px;padding:13px 0;border-top:1px solid #eef2f6}
.wz-res:first-of-type{border-top:0;padding-top:0}
.wz-res .ic{width:28px;height:28px;border-radius:8px;background:#f4f6f8;
     display:flex;align-items:center;justify-content:center;color:var(--txt3);flex:0 0 auto;margin-top:1px}
.wz-res .ic svg{width:14px;height:14px}
.wz-res label{display:block;font-size:10px;color:var(--txt3);font-weight:800;text-transform:uppercase;
              letter-spacing:.05em;margin-bottom:2px}
.wz-res div{font-size:13.5px;font-weight:700;color:var(--txt);word-break:break-word;line-height:1.35}
.wz-res.vago div{font-weight:500;color:var(--txt3)}

.wz-pe{flex:0 0 auto;height:66px;border-top:1px solid var(--borda);display:flex;align-items:center;
       justify-content:space-between;padding:0 24px;background:#fff}
.wz-pe .bt{padding:11px 22px;font-size:14.5px}

/* Sem limite de largura: a lista agora vive só dentro do popup, e o popup já
   define o tamanho. Com o limite antigo sobrava um vão só do lado direito. */
.escolha{display:grid;gap:11px}
.escolha button{display:flex;align-items:center;gap:14px;background:#fff;border:1.5px solid var(--borda);
     border-radius:12px;padding:16px 18px;cursor:pointer;text-align:left;transition:.13s;font-family:inherit}
.escolha button:hover:not(:disabled){border-color:var(--verde);background:var(--verde-bg)}
.escolha button:disabled{opacity:.55;cursor:default}
.escolha .ic{width:42px;height:42px;border-radius:11px;background:var(--verde-cl);color:var(--verde-esc);
     display:flex;align-items:center;justify-content:center;flex:0 0 auto}
.escolha .ic svg{width:21px;height:21px}
.escolha b{display:block;font-size:14.5px;font-weight:800}
.escolha span{display:block;font-size:12.5px;color:var(--txt2)}

.radios{display:flex;gap:22px;flex-wrap:wrap;margin:4px 0 16px}
.radios label{display:flex;align-items:center;gap:8px;font-size:13.5px;font-weight:600;cursor:pointer}
.radios input{width:16px;height:16px;accent-color:var(--verde);cursor:pointer}

.solta{border:2px dashed var(--borda2);border-radius:12px;background:#f8fafb;padding:34px 20px;
       text-align:center;color:var(--txt2);font-size:13.5px;cursor:pointer;transition:.13s}
.solta:hover,.solta.sobre{border-color:var(--verde);background:var(--verde-bg);color:var(--verde-esc)}
.solta b{display:block;font-size:14px;color:var(--txt);font-weight:700;margin-bottom:3px}
.nf-lista{margin-top:12px}
.nf-item{display:flex;align-items:center;gap:11px;background:#fff;border:1px solid var(--borda);
         border-radius:9px;padding:10px 13px;margin-bottom:7px;font-size:12.5px}
.nf-item .ch{flex:1;min-width:0;word-break:break-all;font-weight:500;line-height:1.4}
.nf-item .ch b{font-weight:800}
.nf-item .ic svg{width:16px;height:16px;display:block}
.nf-item .ic{flex:0 0 auto;line-height:0}

/* ESCOLHER QUANDO: calendário do mês à esquerda, horários do dia à direita.
   Os dois lado a lado de propósito — a resposta de "que dia?" e a de "que
   hora?" se olham. Em tela estreita um cai embaixo do outro. */
.quando{display:grid;grid-template-columns:minmax(0,1fr) 250px;gap:14px;align-items:start}
@media(max-width:860px){.quando{grid-template-columns:minmax(0,1fr)}}

.calx{border:1px solid var(--borda);border-radius:12px;background:#fff;padding:12px 13px 13px}
.calx-topo{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:9px}
.calx-topo b{font-size:13.5px;font-weight:800}
.calx-nav{display:flex;gap:5px}
.calx-nav button{width:27px;height:27px;border:1px solid var(--borda);background:#fff;border-radius:8px;
  cursor:pointer;color:var(--txt2);font:inherit;font-size:16px;line-height:1;padding:0;
  display:flex;align-items:center;justify-content:center;transition:.12s}
.calx-nav button:hover:not(:disabled){border-color:var(--verde);color:var(--verde)}
.calx-nav button:disabled{opacity:.3;cursor:not-allowed}
.calx-sem{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:3px}
.calx-sem span{text-align:center;font-size:9.5px;font-weight:800;color:var(--txt3);
  text-transform:uppercase;letter-spacing:.05em;padding:3px 0 5px}
.calx-grade{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:3px}
/* A bolinha mora dentro da casa, então a casa precisa de espaço embaixo do
   número — sem isso a bolinha encosta na borda e some. */
.calx-d{position:relative;min-height:40px;border:1.5px solid transparent;border-radius:9px;
  display:flex;align-items:center;justify-content:center;padding-bottom:7px;
  font-size:13.5px;font-weight:700;font-variant-numeric:tabular-nums;
  color:var(--txt);cursor:pointer;transition:.12s}
.calx-d:hover:not(.off):not(.fora){border-color:var(--verde);background:var(--verde-bg)}
.calx-d.fora{color:#dbe1e8;cursor:default;pointer-events:none}
.calx-d.off{color:#c6ced7;cursor:not-allowed}
.calx-d.hoje{border-color:var(--borda2)}
.calx-d.sel{background:var(--verde);border-color:var(--verde);color:#fff}
.calx-d i{position:absolute;bottom:6px;left:50%;margin-left:-2.5px;width:5px;height:5px;
  border-radius:50%;background:var(--verde)}
.calx-d i.cheio{background:#cf5b5b}
.calx-d.sel i{background:#fff}
/* Dia que era o escolhido e deixou de caber (trocou o tempo de descarga).
   Sem estas duas regras o verde de "escolhido" ganha do cinza de "lotado" e
   a casa fica idêntica a um dia bom — a tela afirmando o contrário do que
   ela mesma sabe. Na lista de horários "ocupado" já ganha de "escolhido";
   aqui é a mesma ideia. */
.calx-d.off.sel{background:#fdecec;border-color:#cf5b5b;color:#a94442}
.calx-d.off.sel i{background:#cf5b5b}
.calx-leg{display:flex;gap:13px;margin-top:10px;font-size:10.5px;color:var(--txt3);font-weight:600}
.calx-leg span{display:flex;align-items:center;gap:5px}
.calx-leg u{width:5px;height:5px;border-radius:50%;background:var(--verde);display:block;text-decoration:none}
.calx-leg u.cheio{background:#cf5b5b}

.hcx{border:1px solid var(--borda);border-radius:12px;background:#fff;padding:12px 12px 11px}
.hcx h4{margin:0;font-size:9.5px;font-weight:800;color:var(--txt3);
  text-transform:uppercase;letter-spacing:.05em}
.hcx .sub{margin:3px 0 9px;font-size:11.5px;color:var(--txt2);line-height:1.4}
/* Rolagem só na lista: a caixa fica do tamanho do calendário do lado e não
   empurra o botão de continuar para fora da tela quando o dia tem muitas horas. */
.hlista{display:flex;flex-direction:column;gap:5px;max-height:246px;overflow-y:auto;
  margin:0 -2px;padding:0 2px}
.hslot{border:1.5px solid var(--borda);background:#fff;border-radius:9px;padding:9px 11px;
  font:inherit;font-size:13px;font-weight:700;font-variant-numeric:tabular-nums;
  color:var(--txt);cursor:pointer;text-align:left;transition:.12s;width:100%}
.hslot:hover:not(.ocup){border-color:var(--verde)}
.hslot.sel{background:var(--verde);border-color:var(--verde);color:#fff}
.hslot.ocup{color:#b8c1cb;background:#f7f9fb;cursor:not-allowed;font-weight:500;
  text-decoration:line-through}
.hslot em{font-style:normal;font-size:10.5px;font-weight:600;color:var(--txt3);
  margin-left:6px;text-decoration:none;display:inline-block}
.hslot.sel em{color:rgba(255,255,255,.85)}
.hmsg{font-size:11.5px;color:var(--txt2);padding:9px 1px 0;line-height:1.45}

/* DOCUMENTOS — a etapa 3. */
.doc-l{display:flex;flex-direction:column;gap:7px;margin-top:13px}
.doc-i{display:flex;align-items:center;gap:11px;background:#fff;border:1px solid var(--borda);
  border-radius:9px;padding:10px 13px}
.doc-i .ic{flex:0 0 auto;line-height:0;color:var(--verde-esc)}
.doc-i .ic svg{width:16px;height:16px;display:block}
.doc-i .nm{flex:1;min-width:0;font-size:13px;font-weight:600;overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap}
.doc-i .tm{font-size:11.5px;color:var(--txt3);white-space:nowrap;font-variant-numeric:tabular-nums}
.doc-i .x{background:none;border:0;color:var(--txt3);cursor:pointer;font:inherit;font-size:16px;
  line-height:1;padding:2px 4px}
.doc-i .x:hover{color:var(--verm)}
.doc-tipos{display:flex;gap:7px;flex-wrap:wrap;margin-top:11px}
.doc-tipos button{background:#fff;border:1.5px solid var(--borda);border-radius:999px;
  padding:5px 13px;font:inherit;font-size:12px;font-weight:600;color:var(--txt2);cursor:pointer}
.doc-tipos button.on{border-color:var(--verde);background:var(--verde-bg);color:var(--verde-esc)}

/* ANEXOS de um agendamento já criado — a aba dentro do detalhe. */
.ax-acs{display:flex;gap:6px;justify-content:flex-end;align-items:center}
.ax-bt{background:#fff;border:1.5px solid var(--borda);border-radius:7px;padding:4px 11px;
  font:inherit;font-size:12px;font-weight:600;color:var(--txt2);cursor:pointer;transition:.12s}
.ax-bt:hover{border-color:var(--verde);color:var(--verde-esc)}
.ax-bt.so-ic{padding:4px 7px;line-height:0}
.ax-bt.so-ic svg{width:14px;height:14px;display:block}
.ax-bt.so-ic:hover{border-color:var(--verm);color:var(--verm)}
.ax-pe{margin-top:15px;padding-top:14px;border-top:1px solid var(--borda)}
.ax-pe .ax-tipos{margin-top:0;margin-bottom:11px}
.ax-add{display:inline-flex;align-items:center;gap:8px;background:var(--verde);border:0;
  border-radius:9px;padding:9px 17px;font:inherit;font-size:13px;font-weight:700;color:#fff;
  cursor:pointer;transition:.12s}
.ax-add:hover{filter:brightness(1.07)}
.ax-add svg{width:15px;height:15px}
.ax-pe .dica{display:block;margin-top:9px}
.ax-link{display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:var(--amb-bg);
  border:1px solid var(--amb-bd);border-radius:9px;padding:10px 13px;margin-bottom:13px;
  font-size:12.5px;color:var(--amb)}
.ax-link a{text-decoration:none}

/* VINCULO da nota ao pedido — a coluna na linha da nota, na etapa 1. */
.nf-vinc{display:flex;align-items:center;gap:7px;background:#fdecea;border:1.5px solid #e0b4b0;
  border-radius:8px;padding:7px 12px;font:inherit;font-size:12.5px;font-weight:700;
  color:#8c2f28;cursor:pointer;white-space:nowrap;flex:0 0 auto;transition:.12s}
.nf-vinc:hover{background:#fbdcd8}
.nf-vinc svg{width:15px;height:15px;flex:0 0 15px}
.nf-ped{display:flex;align-items:center;gap:6px;flex:0 0 auto;white-space:nowrap}
.nf-ped .rot{font-size:11px;color:var(--txt3);text-transform:uppercase;letter-spacing:.5px}
.nf-ped b{font-size:13.5px;font-variant-numeric:tabular-nums}
.nf-ped.ok b{color:var(--verde-esc)}

/* a janela "Meus pedidos" */
.vp-b{width:100%;border:1.5px solid var(--borda);border-radius:9px;padding:10px 13px;
  font:inherit;font-size:14px;margin-bottom:12px}
.vp-b:focus{outline:none;border-color:var(--verde)}
.vp-l{display:flex;flex-direction:column;gap:8px;max-height:52vh;overflow:auto}
.vp-i{display:flex;gap:12px;align-items:center;background:#fff;border:1.5px solid var(--borda);
  border-radius:11px;padding:12px 15px;cursor:pointer;transition:.12s}
.vp-i:hover{border-color:var(--verde);background:var(--verde-bg)}
.vp-i.on{border-color:var(--verde);background:var(--verde-bg)}
.vp-c{flex:1;min-width:0}
.vp-c b{display:block;font-size:14px}
.vp-c span{display:block;font-size:12.5px;color:var(--txt2);margin-top:2px}\n.vp-s{display:inline-block;font-size:11.5px;font-weight:700;border-radius:999px;\n  padding:3px 9px;margin-top:4px}\n.vp-s.forte{background:var(--verde-bg);color:var(--verde-esc)}\n.vp-s.meio{background:#fdf3e3;color:#8a5a12}\n.vp-s.cinza{background:#f1f3f4;color:var(--txt3)}\n.vp-nota{font-size:12.5px;color:var(--txt2);background:#f7f9fa;border:1px solid var(--borda);\n  border-radius:9px;padding:11px 13px;margin-bottom:10px;line-height:1.5}
.vp-v{text-align:right;white-space:nowrap}
.vp-v b{display:block;font-size:14px}
.vp-v span{display:block;font-size:11px;color:var(--txt3)}
.vp-ok{flex:0 0 auto;background:none;border:0;color:var(--verde);cursor:pointer;line-height:0;padding:4px}
.vp-ok svg{width:22px;height:22px;display:block}

/* CONFRONTO da nota com o pedido — aparece na etapa 2, embaixo dos pedidos. */
.cnf{margin-top:18px;border-radius:12px;padding:16px 18px;border:1.5px solid var(--borda);background:#fff}
.cnf.bom{border-color:var(--verde);background:var(--verde-bg)}
.cnf.ruim{border-color:#e0b4b0;background:#fdf4f3}
.cnf.atencao{border-color:#e6c98a;background:#fdf6e9}
.cnf.atencao .cnf-t{color:#8a5a12}
.cnf-av{margin:9px 0 0;padding-left:19px}
.cnf-av li{font-size:13px;color:var(--txt2);line-height:1.55;margin-bottom:5px}
.cnf-t{font-size:14.5px;font-weight:700;color:var(--txt)}
.cnf.bom .cnf-t{color:var(--verde-esc)}
.cnf.ruim .cnf-t{color:#8c2f28}
.cnf-s{font-size:12.5px;color:var(--txt2);margin-top:3px}
.cnf-l{display:flex;flex-direction:column;gap:7px;margin-top:13px}
.cnf-i{background:#fff;border:1px solid var(--borda);border-radius:9px;padding:9px 12px}
.cnf-i.ruim{border-left:3px solid var(--verm)}
.cnf-i.atencao{border-left:3px solid #c98a1a}
.cnf-d{display:flex;gap:9px;align-items:baseline;flex-wrap:wrap}
.cnf-d b{font-size:13px;font-weight:700}
.cnf-e{font-size:11px;color:var(--txt3);font-variant-numeric:tabular-nums}
.cnf-n{font-size:12.5px;color:var(--txt2);margin-top:2px}
.cnf-m{font-size:12px;color:var(--verm);margin-top:3px}
.cnf-i.atencao .cnf-m{color:#8a5a12}
.cnf-mais{font-size:12px;color:var(--txt3);padding:2px 2px}
.cnf-barra{background:#fdecea;border:1px solid #f3c9c3;color:#8c2f28;border-radius:9px;padding:10px 12px}
.cnf-p{font-size:12.5px;color:var(--txt2);margin-top:12px;line-height:1.5}

/* PEDIDOS DE COMPRA — a etapa 2 do assistente. */
.ped-l{display:flex;flex-direction:column;gap:9px}
.ped{display:flex;gap:12px;align-items:flex-start;background:#fff;border:1.5px solid var(--borda);
  border-radius:11px;padding:13px 15px;cursor:pointer;transition:.12s}
.ped:hover{border-color:var(--verde)}
.ped.on{border-color:var(--verde);background:var(--verde-bg)}
.ped input{width:17px;height:17px;flex:0 0 17px;margin-top:2px;accent-color:var(--verde);cursor:pointer}
.ped-c{flex:1;min-width:0}
.ped-t{display:flex;gap:9px;align-items:baseline;flex-wrap:wrap}
.ped-t b{font-size:14px;font-weight:800}
.ped-t .nf{font-size:10.5px;font-weight:800;color:var(--verde-esc);background:var(--verde-bg);
  border:1px solid #c5e3ce;border-radius:999px;padding:2px 8px}
.ped-s{font-size:12.5px;color:var(--txt2);margin-top:4px;line-height:1.5}
.ped-s b{color:var(--txt);font-weight:700}
.ped-v{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.ped-v b{display:block;font-size:14px;font-weight:800}
.ped-v span{font-size:11px;color:var(--txt2)}
.ped-ver{background:none;border:none;color:var(--verde-esc);font:inherit;font-size:11.5px;
  font-weight:700;cursor:pointer;padding:5px 0 0;text-decoration:underline}

/* COBRANÇA DE DESCARGA — os serviços de um lado, o total do outro. */
.cob{display:grid;grid-template-columns:minmax(0,1fr) 330px;gap:18px;align-items:start}
@media(max-width:900px){.cob{grid-template-columns:minmax(0,1fr)}}
.cob-bloco{background:#fff;border:1px solid var(--borda);border-radius:14px;padding:20px 22px 22px}
.cob-bloco h4{margin:0 0 15px;font-size:10px;font-weight:800;color:var(--txt3);
  text-transform:uppercase;letter-spacing:.05em}
.cob-tab{width:100%;border-collapse:collapse;font-size:14px}
.cob-tab th{text-align:left;font-size:9.5px;text-transform:uppercase;letter-spacing:.05em;
  color:var(--txt3);font-weight:800;padding:0 10px 9px 0;border-bottom:1px solid var(--borda)}
.cob-tab th.n,.cob-tab td.n{text-align:right;padding-right:0}
.cob-tab td{padding:15px 10px 15px 0;border-bottom:1px solid #f2f5f8}
.cob-tab tr:last-child td{border-bottom:none}
.cob-tab td.n{white-space:nowrap;font-variant-numeric:tabular-nums}
.cob-tab td b{font-weight:700}

.cob-total{font-size:12px;color:var(--txt2);margin:0 0 4px}
.cob-total b{display:block;font-size:30px;font-weight:800;color:var(--txt);
  font-variant-numeric:tabular-nums;line-height:1.25}
/* O quadro do aviso é amarelo de propósito: a frase inteira depende de ser
   lida, não de estar escrita. É ela que diz que o valor é previsão. */
.cob-aviso{display:flex;gap:10px;background:#fdf6e3;border:1px solid #f0e2bd;border-radius:10px;
  padding:12px 14px;margin:16px 0 0;font-size:12.5px;color:#7a6320;line-height:1.5}
.cob-aviso svg{width:15px;height:15px;flex:0 0 15px;margin-top:1px}
.cob-ciente{display:flex;gap:11px;align-items:flex-start;margin-top:16px;padding-top:16px;
  border-top:1px solid #f2f5f8;font-size:13.5px;font-weight:600;cursor:pointer;line-height:1.45}
.cob-ciente input{width:17px;height:17px;flex:0 0 17px;margin-top:1px;accent-color:var(--verde);cursor:pointer}

/* RESUMO EM BLOCOS — a última tela antes de enviar. */
/* Duas colunas fixas, não "quantas couberem": com quatro campos o auto-fit
   deixava três em cima e um sozinho embaixo, e o campo órfão parecia outro
   assunto. Dois por dois lê como um quadro só. */
.res-faixa{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:13px 20px;
  background:#fff;border:1px solid var(--borda);border-radius:12px;padding:15px 18px;margin-bottom:14px}
@media(max-width:560px){.res-faixa{grid-template-columns:minmax(0,1fr)}}
.res-faixa label{display:block;font-size:9.5px;font-weight:800;color:var(--txt3);
  text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px}
.res-faixa b{font-size:13.5px;font-weight:700;line-height:1.4;display:block}

.res-bloco{background:#fff;border:1px solid var(--borda);border-radius:12px;
  padding:14px 16px 15px;margin-bottom:14px}
.res-tit{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:800;margin-bottom:11px}
.res-tit .ic{width:26px;height:26px;flex:0 0 26px;border-radius:8px;background:var(--verde-bg);
  color:var(--verde-esc);display:flex;align-items:center;justify-content:center}
.res-tit .ic svg{width:14px;height:14px;display:block}

/* Tabela das notas. Rola sozinha na horizontal: a chave tem 44 dígitos e em
   tela de celular ela empurraria a página inteira pro lado. */
.res-rola{overflow-x:auto;margin:0 -4px;padding:0 4px}
.res-tab{width:100%;border-collapse:collapse;font-size:12.5px}
.res-tab th{text-align:left;font-size:9.5px;text-transform:uppercase;letter-spacing:.05em;
  color:var(--txt3);font-weight:800;padding:0 10px 6px 0;border-bottom:1px solid var(--borda)}
.res-tab td{padding:9px 10px 9px 0;border-bottom:1px solid #f2f5f8;vertical-align:top}
.res-tab tr:last-child td{border-bottom:none}
.res-tab .ch{font-size:11px;color:var(--txt2);font-variant-numeric:tabular-nums;
  letter-spacing:.02em;white-space:nowrap}
.res-tab .n{white-space:nowrap;font-variant-numeric:tabular-nums}
.res-tab b{font-weight:800}

.res-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px}
.res-card{background:#fff;border:1px solid var(--borda);border-radius:12px;padding:14px 16px 15px}
.res-card .li{font-size:13px;line-height:1.65}
.res-card .li span{color:var(--txt2)}
.res-card .li b{font-weight:700}
.res-card .obs{margin-top:9px;padding-top:9px;border-top:1px solid #f2f5f8;
  font-size:12.5px;color:var(--txt2);line-height:1.5}
.res-card .obs b{display:block;font-size:9.5px;text-transform:uppercase;letter-spacing:.05em;
  color:var(--txt3);font-weight:800;margin-bottom:3px}

/* gaveta de avisos.
   O VEU DELA E PROPRIO, e nao o .mfundo das janelas.
   O .mfundo vive na camada 85 e a gaveta na 80 — ou seja, o veu passava POR CIMA da
   gaveta e escurecia justamente o que a pessoa abriu para ler. Um veu proprio na
   camada 79 escurece so o que esta atras.
   Nao subi a gaveta acima de 85 de proposito: o .mfundo tem que continuar cobrindo a
   gaveta quando uma JANELA abre por cima dela (a janela mora na 95). */
.gav-fundo{position:fixed;inset:0;background:rgba(9,32,19,.35);z-index:79;
           animation:some .14s ease}
.gaveta{position:fixed;top:0;right:0;bottom:0;width:min(376px,94vw);background:#fff;z-index:80;
        box-shadow:-14px 0 46px rgba(0,0,0,.26);display:flex;flex-direction:column;
        animation:entraLado .2s ease}
@keyframes entraLado{from{transform:translateX(24px);opacity:0}to{transform:none;opacity:1}}
.gaveta header{display:flex;align-items:center;justify-content:space-between;padding:15px 16px;
               border-bottom:1px solid var(--borda)}
.gaveta header b{font-size:15px;font-weight:800}
.gaveta .corpo{flex:1;overflow-y:auto;padding:6px 16px 18px}
.not{border-bottom:1px solid #f1f4f7;padding:12px 0}
.not:last-child{border-bottom:0}
.not b{display:block;font-size:13.5px;font-weight:700}
.not p{margin:2px 0 0;font-size:12.5px;color:var(--txt2);line-height:1.45}
.not span{font-size:11px;color:var(--txt3);font-variant-numeric:tabular-nums}
.not.nova b:after{content:"";display:inline-block;width:7px;height:7px;border-radius:999px;
                  background:var(--verde-mais);margin-left:6px;vertical-align:middle}

@media (max-width:860px){
  :root{--lat:0px}
  .lateral{transform:translateX(-100%);transition:.2s;width:238px}
  .lateral.abre{transform:none;box-shadow:0 0 0 100vw rgba(9,32,19,.45)}
  .topo{left:0;padding:0 12px}
  .pagina{padding:calc(var(--alt-topo) + 16px) 14px 40px}
  .menu-bt{display:inline-flex !important}
  .usuario b{max-width:120px}
}
.menu-bt{display:none}
</style>
</head>
<body>

<!-- ===================== ENTRAR ===================== -->
<div id="login">
 <div class="card">
  <img class="logo" src="${LOGO}" alt="">
  <h2>Portal do Fornecedor</h2>
  <p class="sub" id="sub">Supermercado Santa Rita · Caicó/RN</p>

  <div class="carregando" id="carregando">Carregando...</div>

  <div class="esconde" id="telaAuth">
    <div class="tabs">
      <button id="tabEntrar" class="on">Entrar</button>
      <button id="tabCriar">Criar conta</button>
    </div>

    <div id="formEntrar">
      <div class="fld"><label for="eEmail">E-mail</label>
        <input id="eEmail" type="email" autocomplete="username" inputmode="email" placeholder="voce@suaempresa.com.br"></div>
      <div class="fld"><label for="eSenha">Senha</label>
        <div class="pw-wrap"><input id="eSenha" type="password" autocomplete="current-password" placeholder="Sua senha">
          <span class="pw-eye" data-olho="eSenha"></span></div></div>
      <button class="bt larga" id="btEntrar">Entrar</button>
      <div class="msg msg-auth" id="msgAuth"></div>
      <button class="link" id="btIrSenha">Esqueci minha senha</button>
    </div>

    <div class="esconde" id="formCriar">
      <div class="fld"><label for="cCnpj">CNPJ da empresa</label>
        <input id="cCnpj" type="text" inputmode="numeric" placeholder="00.000.000/0000-00" maxlength="18">
        <div class="dica" id="cCnpjDica"></div></div>
      <div class="fld"><label for="cRazao">Razão social</label>
        <input id="cRazao" type="text" placeholder="Como está no CNPJ" maxlength="140"></div>
      <div class="fld"><label for="cResp">Responsável pelo agendamento</label>
        <input id="cResp" type="text" placeholder="Seu nome" maxlength="80"></div>
      <div class="fld"><label for="cTel">Telefone / WhatsApp <span class="opt">(opcional)</span></label>
        <input id="cTel" type="tel" inputmode="tel" placeholder="(84) 90000-0000" maxlength="30"></div>
      <div class="fld"><label for="cEmail">E-mail</label>
        <input id="cEmail" type="email" autocomplete="username" inputmode="email" placeholder="voce@suaempresa.com.br">
        <div class="dica">É para cá que vão os avisos das suas entregas.</div></div>
      <div class="fld"><label for="cSenha">Crie uma senha</label>
        <div class="pw-wrap"><input id="cSenha" type="password" autocomplete="new-password" placeholder="Pelo menos 6 caracteres">
          <span class="pw-eye" data-olho="cSenha"></span></div></div>
      <button class="bt larga" id="btCriar">Cadastrar minha empresa</button>
      <div class="msg msg-auth"></div>
    </div>
  </div>

  <div class="esconde" id="telaSenha">
    <div class="fld"><label for="sEmail">E-mail do cadastro</label>
      <input id="sEmail" type="email" inputmode="email" placeholder="voce@suaempresa.com.br"></div>
    <button class="bt larga" id="btMandarSenha">Mandar o link</button>
    <button class="link" id="btVoltaAuth">Voltar</button>
    <div class="msg" id="msgSenha"></div>
  </div>

  <div class="esconde" id="telaConfirme">
    <div class="aviso">
      <div class="big">✉️</div>
      <h3>Confirme seu e-mail</h3>
      <p>Mandamos um link para <b id="confEmail"></b>. Abra sua caixa de entrada e clique nele para ativar o acesso.</p>
    </div>
    <button class="link" id="btVoltaAuth2">Voltar para o início</button>
  </div>

  <div class="esconde" id="telaEspera">
    <div class="aviso">
      <div class="big">⏳</div>
      <h3 id="esperaTit">Cadastro em análise</h3>
      <p id="esperaTxt">A loja está conferindo seus dados.</p>
    </div>
    <button class="bt larga fraco" id="btAtualizar" style="margin-top:12px">Já liberaram? Conferir de novo</button>
    <button class="link" id="btSair2">Sair</button>
  </div>
 </div>
</div>

<!-- ===================== A CASA ===================== -->
<div id="app">
  <aside class="lateral" id="lateral">
    <div class="lat-marca">
      <img src="${LOGO}" alt="">
      <div><b>Santa Rita</b><span>Portal do Fornecedor</span></div>
    </div>
    <nav class="lat-nav" id="nav"></nav>
    <div class="lat-pe">
      <button class="bt" id="btNova">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Novo agendamento</button>
    </div>
  </aside>

  <header class="topo">
    <button class="icone menu-bt" id="btMenu" title="Menu">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
    </button>
    <div class="titulo" id="tituloPag">Início</div>
    <button class="icone" id="btSino" title="Avisos">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
      <span class="bolha esconde" id="sinoBolha">0</span>
    </button>
    <div class="usuario">
      <div class="ini" id="uIni">—</div>
      <div><b id="uNome">—</b><span id="uCnpj"></span></div>
    </div>
    <button class="icone" id="btSair" title="Sair">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
    </button>
  </header>

  <main class="pagina" id="pagina"></main>
</div>

<div id="pilha"></div>
<div id="toasts"></div>
<iframe id="impressora" style="position:fixed;left:-9999px;top:0;width:0;height:0;border:0"></iframe>

<script>
(function(){
  /* O LOGIN MORRE QUANDO O NAVEGADOR FECHA — sessionStorage, e nao localStorage.
     Sem isto o portal guardava o login para sempre: quem abrisse o endereco entrava
     direto, sem digitar nada. Num computador de expedicao ou de portaria, que e
     compartilhado, isso quer dizer que a proxima pessoa entra como o fornecedor
     anterior e enxerga os pedidos e as notas dele.
     O painel ja fazia assim; o portal ficou de fora por descuido, e o Victor pegou em
     21/08/2026. Enquanto o navegador estiver aberto ele continua logado entre abas e
     paginas — so precisa entrar de novo quando fechar tudo.
     Combina com a limpeza do campo da senha no Sair, que ja existia pelo mesmo motivo. */
  var SB = supabase.createClient("https://uabhsmculsfwzcrhyhch.supabase.co","sb_publishable_IPLbRjk89c666QkfcoVTiw_GXujUTZU",
    { auth: { persistSession:true, autoRefreshToken:true, storage: window.sessionStorage } });
  var el = function(id){ return document.getElementById(id); };

  /* ==PORTAL-INICIO==
     Daqui até o marcador de fim só entram funções puras (data, número, CNPJ,
     situação). O arquivo scripts/testes/portal-agenda.test.cjs recorta este pedaço
     do HTML gerado e testa cada uma. Nada que toque em tela ou em rede entra aqui.
     Cuidado: não escreva o nome do marcador de fim dentro deste comentário — o
     recorte procura a primeira ocorrência e pararia aqui mesmo. */
  var MESES=["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
  var MES3=["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
  var DOWS=["domingo","segunda-feira","terça-feira","quarta-feira","quinta-feira","sexta-feira","sábado"];
  var DOW3=["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];
  var DOW1=["D","S","T","Q","Q","S","S"];

  var HORA_INI=6, HORA_FIM=19, ALT_H=52;   // grade do calendário

  // ============================================================
  // NÚCLEO
  // ============================================================
  function esc(s){ return String(s==null?"":s)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

  function maiuscula(s){ s=String(s||""); return s.charAt(0).toUpperCase()+s.slice(1); }

  // O banco devolve número com ponto decimal ("1240.500"); na tela isso lê errado.
  function numero(v, casas){
    var x=parseFloat(v); if(isNaN(x)) return "";
    try{ return x.toLocaleString("pt-BR",{minimumFractionDigits:casas||0,
           maximumFractionDigits:casas===undefined?3:casas}); }catch(e){ return String(v); }
  }
  function moeda(v){ var x=parseFloat(v); return isNaN(x)?"":"R$ "+numero(x,2); }

  function cnpjLimpo(s){ return String(s==null?"":s).replace(/[^0-9]/g,""); }
  function cnpjFmt(s){
    var d=cnpjLimpo(s).slice(0,14);
    if(d.length>12) return d.slice(0,2)+"."+d.slice(2,5)+"."+d.slice(5,8)+"/"+d.slice(8,12)+"-"+d.slice(12);
    if(d.length>8)  return d.slice(0,2)+"."+d.slice(2,5)+"."+d.slice(5,8)+"/"+d.slice(8);
    if(d.length>5)  return d.slice(0,2)+"."+d.slice(2,5)+"."+d.slice(5);
    if(d.length>2)  return d.slice(0,2)+"."+d.slice(2);
    return d;
  }
  function cnpjValido(s){
    var d=cnpjLimpo(s);
    if(d.length!==14) return false;
    var rep=true;
    for(var i=1;i<14;i++){ if(d.charAt(i)!==d.charAt(0)){ rep=false; break; } }
    if(rep) return false;
    function dig(base){
      var p=base.length===12?[5,4,3,2,9,8,7,6,5,4,3,2]:[6,5,4,3,2,9,8,7,6,5,4,3,2], s=0;
      for(var i=0;i<base.length;i++){ s+=parseInt(base.charAt(i),10)*p[i]; }
      var r=s%11; return r<2?0:11-r;
    }
    if(dig(d.slice(0,12))!==parseInt(d.charAt(12),10)) return false;
    return dig(d.slice(0,13))===parseInt(d.charAt(13),10);
  }

  // Datas montadas na mão: o Date do navegador troca o dia quando o aparelho está
  // em outro fuso, e a entrega mudaria de dia na tela.
  function isoData(d){
    return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
  }
  function hojeIso(){ return isoData(new Date()); }
  function deIso(iso){
    var p=String(iso||"").slice(0,10).split("-");
    if(p.length!==3) return null;
    return new Date(+p[0], +p[1]-1, +p[2]);
  }
  function partes(iso){
    var s=String(iso||""); if(s.length<10) return null;
    var d=deIso(s); if(!d) return null;
    var a=s.slice(0,10).split("-");
    return { longa: DOWS[d.getDay()]+", "+a[2]+" de "+MES3[+a[1]-1],
             media: DOW3[d.getDay()]+", "+a[2]+"/"+a[1],
             curta: a[2]+"/"+a[1]+"/"+a[0],
             hora:  s.length>=16 ? s.slice(11,16) : "" };
  }
  function quandoTxt(iso, ate){
    var p=partes(iso); if(!p) return "—";
    return p.curta+(p.hora?" às "+p.hora:"")+(ate?" até "+ate:"");
  }
  function minutos(iso){ var s=String(iso||""); if(s.length<16) return 0;
    return parseInt(s.slice(11,13),10)*60+parseInt(s.slice(14,16),10); }

  // O domingo que abre a semana daquela data. É esta conta que decide qual semana
  // o calendário mostra — errar aqui joga a entrega para a coluna errada.
  function inicioSemana(d){ var x=new Date(d); x.setDate(x.getDate()-x.getDay()); x.setHours(0,0,0,0); return x; }

  // As 42 casas de um mês na tela: 6 linhas de 7 dias, começando no domingo
  // que abre a semana do dia 1º. São sempre 42, mesmo sobrando dia do mês
  // vizinho — assim o calendário não muda de altura ao trocar de mês e a
  // seta de avançar não foge de baixo do dedo.
  function mesCasas(ano, mes){
    var ini=inicioSemana(new Date(ano, mes, 1)), l=[];
    for(var i=0;i<42;i++){
      var d=new Date(ini); d.setDate(ini.getDate()+i);
      l.push({ iso:isoData(d), dia:d.getDate(), dow:d.getDay(), fora:d.getMonth()!==mes });
    }
    return l;
  }
  function mesTitulo(ano, mes){ return maiuscula(MESES[mes])+" de "+ano; }

  // Andar de mês sem estourar dezembro nem janeiro.
  function mesAndar(ano, mes, passo){
    var a=ano, m=mes+passo;
    while(m<0){ m+=12; a--; }
    while(m>11){ m-=12; a++; }
    return { ano:a, mes:m };
  }

  // O último dia do mês. Serve para saber se o mês inteiro já passou —
  // seta que não leva a lugar nenhum é seta que engana.
  function mesUltimoDia(ano, mes){ return isoData(new Date(ano, mes+1, 0)); }

  // "07:00 - 08:00". Com duração variável, ver só o começo não diz até
  // quando o caminhão fica ocupando a doca.
  function faixaHora(de, ate){ return String(de||"")+(ate?" - "+ate:""); }

  // O PESO QUE A PESSOA DIGITA.
  //
  // O padrão do resto do formulário limpa número com [^0-9], que COME a
  // vírgula: "1.250,5" viraria 12505. E deixar o ponto passar é pior — o
  // Postgres recebe "1.250.5" e derruba a chamada inteira com erro cru.
  // Aqui vale a convenção brasileira, que é o que a pessoa escreve: ponto
  // separa milhar, vírgula separa decimal.
  function pesoNum(v){
    var t=String(v==null?"":v).trim().replace(/[^0-9.,]/g,"");
    if(!t) return null;
    // split/join e não regex: dentro do texto que gera esta página o "\." perde
    // a barra e vira ".", que casa com QUALQUER caractere — apagaria o número
    // todo e a função devolveria nulo para tudo. Já aconteceu; os testes pegaram.
    t=t.split(".").join("").replace(",",".");
    var n=parseFloat(t);
    if(isNaN(n) || n<0) return null;
    // nenhuma carreta pesa 200 toneladas: acima disso é dedo escorregado,
    // e um peso absurdo vira uma cobrança absurda
    if(n>200000) return null;
    return Math.round(n*1000)/1000;
  }

  // ---------------------------------------------------------------
  // A CHAVE DA NOTA FISCAL ELETRÔNICA
  //
  // Os 44 números não são um código solto: são montados por regra e contam a
  // própria história. Dá para conferir se a chave existe e dizer quem emitiu,
  // quando e qual é a nota — sem nunca abrir o arquivo XML.
  //
  //   posição  0-2   estado de quem emitiu
  //            2-6   ano e mês da emissão
  //            6-20  CNPJ de quem emitiu
  //           20-22  modelo (55 = nota de empresa, 65 = cupom de consumidor)
  //           22-25  série
  //           25-34  número da nota
  //           34-35  tipo de emissão
  //           35-43  código numérico
  //              43  dígito verificador
  //
  // O último número fecha a conta dos outros 43. É ele que pega o dígito
  // trocado — o erro que ninguém enxerga relendo.
  // ---------------------------------------------------------------
  var UFS={ "11":"RO","12":"AC","13":"AM","14":"RR","15":"PA","16":"AP","17":"TO",
            "21":"MA","22":"PI","23":"CE","24":"RN","25":"PB","26":"PE","27":"AL",
            "28":"SE","29":"BA","31":"MG","32":"ES","33":"RJ","35":"SP","41":"PR",
            "42":"SC","43":"RS","50":"MS","51":"MT","52":"GO","53":"DF" };

  function nfeDigito(base43){
    var peso=2, soma=0;
    for(var i=base43.length-1;i>=0;i--){
      soma += parseInt(base43.charAt(i),10)*peso;
      peso++; if(peso>9) peso=2;
    }
    var r=soma%11;
    return (r===0||r===1)?0:(11-r);
  }

  function nfeChaveLimpa(s){ return String(s==null?"":s).replace(/[^0-9]/g,"").slice(0,44); }

  function nfeChaveFmt(s){
    var d=nfeChaveLimpa(s), out=[];
    for(var i=0;i<d.length;i+=4) out.push(d.slice(i,i+4));
    return out.join(" ");
  }

  function nfeChaveLer(s){
    var d=nfeChaveLimpa(s);
    if(d.length===0)  return {ok:false, vazia:true, erro:""};
    if(d.length<44)   return {ok:false, erro:"Faltam "+(44-d.length)+" número"+(44-d.length>1?"s":"")+". A chave tem 44."};
    if(!UFS[d.slice(0,2)])
      return {ok:false, erro:"Os dois primeiros números não são de nenhum estado. Confira o começo da chave."};
    var mes=parseInt(d.slice(4,6),10);
    if(mes<1||mes>12) return {ok:false, erro:"O mês dentro da chave não existe. Confira os números."};
    if(nfeDigito(d.slice(0,43))!==parseInt(d.charAt(43),10))
      return {ok:false, erro:"Essa chave não confere. Algum número está trocado."};

    var mod=d.slice(20,22);
    return { ok:true, chave:d,
      uf: UFS[d.slice(0,2)],
      emissao: d.slice(4,6)+"/20"+d.slice(2,4),
      cnpj: d.slice(6,20),
      modelo: mod,
      serie: String(parseInt(d.slice(22,25),10)),
      numero: String(parseInt(d.slice(25,34),10)),
      // 65 é cupom de consumidor final: não é nota de entrega de mercadoria.
      aviso: mod==="65" ? "Essa chave é de cupom fiscal de consumidor (modelo 65), não de nota de entrega."
           : (mod!=="55" ? "Modelo de documento fora do comum (" + mod + ")." : "")
    };
  }

  // ---------------------------------------------------------------
  // LER O ARQUIVO XML DA NOTA
  //
  // O XML da NF-e vem de jeitos diferentes conforme quem emitiu: às vezes
  // embrulhado em <nfeProc>, às vezes só <NFe>; com prefixo de espaço de nomes
  // (<ns:emit>) ou sem. Por isso a leitura procura pelo NOME da etiqueta e
  // ignora o prefixo — é o que faz o mesmo leitor servir para todos.
  //
  // Feito com busca de texto, não com leitor de XML do navegador, por dois
  // motivos: roda igual no teste automático (que não tem navegador), e arquivo
  // torto não derruba nada — só não acha o campo.
  // ---------------------------------------------------------------
  function nfeEtiqueta(txt, nome){
    var re=new RegExp("<(?:[A-Za-z0-9_.-]+:)?"+nome+"(?:\\\\s[^>]*)?>([\\\\s\\\\S]*?)<\\\\/(?:[A-Za-z0-9_.-]+:)?"+nome+">");
    var m=re.exec(txt);
    return m ? m[1] : "";
  }
  function nfeTexto(txt, nome){
    var v=nfeEtiqueta(txt, nome);
    return v.indexOf("<")>=0 ? "" : v.trim();
  }
  // Todas as ocorrências, não só a primeira: uma nota tem vários <det>.
  function nfeTodas(txt, nome){
    var re=new RegExp("<(?:[A-Za-z0-9_.-]+:)?"+nome+"(?:\\\\s[^>]*)?>([\\\\s\\\\S]*?)<\\\\/(?:[A-Za-z0-9_.-]+:)?"+nome+">","g");
    var out=[], m;
    while((m=re.exec(txt))!==null){ out.push(m[1]); if(out.length>2000) break; }
    return out;
  }
  function nfeNum(s){
    var x=parseFloat(String(s||"").replace(/,/g,"."));
    return isNaN(x)?null:x;
  }

  function nfeLerXml(texto){
    var t=String(texto==null?"":texto);
    if(t.length>3000000) return {ok:false, erro:"Esse arquivo é grande demais para ser uma nota fiscal."};
    if(t.indexOf("<")<0)  return {ok:false, erro:"Esse arquivo não é um XML."};
    if(!/infNFe/i.test(t)) return {ok:false, erro:"Esse XML não é de nota fiscal eletrônica (NF-e)."};

    // a chave aparece no atributo Id da infNFe ("NFe" + 44 números) ou em <chNFe>
    var chave="";
    var mId=/<(?:[A-Za-z0-9_.-]+:)?infNFe[^>]*\\sId\\s*=\\s*["']\\s*NFe(\\d{44})\\s*["']/i.exec(t);
    if(mId) chave=mId[1];
    if(!chave){ var c=nfeTexto(t,"chNFe"); if(/^\\d{44}$/.test(c)) chave=c; }
    if(!chave) return {ok:false, erro:"Não achei a chave de 44 números dentro do arquivo."};

    var lida=nfeChaveLer(chave);
    if(!lida.ok) return {ok:false, erro:"A chave que está dentro do arquivo não confere: "+lida.erro};

    // emitente e destinatário têm os dois uma etiqueta CNPJ; por isso recorto
    // cada bloco antes de procurar dentro dele.
    var bEmit=nfeEtiqueta(t,"emit"), bDest=nfeEtiqueta(t,"dest");
    var bIde =nfeEtiqueta(t,"ide"),  bTot=nfeEtiqueta(t,"ICMSTot");

    var emissao=nfeTexto(bIde,"dhEmi")||nfeTexto(bIde,"dEmi");

    // ---- o que vem no caminhão, item por item ----
    // Cada <det> é um produto da nota. É daqui que sai a lista que o
    // recebimento vê antes do caminhão encostar.
    var itens=[], dets=nfeTodas(t,"det"), cortou=false;
    if(dets.length>500){ dets=dets.slice(0,500); cortou=true; }
    for(var i=0;i<dets.length;i++){
      var prod=nfeEtiqueta(dets[i],"prod");
      if(!prod) continue;
      var ean=nfeTexto(prod,"cEAN");
      itens.push({
        codigo: nfeTexto(prod,"cProd"),
        ean: (ean && ean.toUpperCase()!=="SEM GTIN") ? ean : "",
        descricao: nfeTexto(prod,"xProd"),
        ncm: nfeTexto(prod,"NCM"),
        cfop: nfeTexto(prod,"CFOP"),
        unidade: nfeTexto(prod,"uCom"),
        qtd: nfeNum(nfeTexto(prod,"qCom")),
        valorUnit: nfeNum(nfeTexto(prod,"vUnCom")),
        valor: nfeNum(nfeTexto(prod,"vProd")),
        // O PEDIDO DE COMPRA, que o fornecedor escreve na nota ao emitir.
        // Vinha chegando e sendo jogado fora. Guardar agora custa nada e é o
        // que vai permitir amarrar a entrega ao pedido quando a lista de
        // pedidos da loja existir.
        pedido: nfeTexto(prod,"xPed"),
        itemPedido: nfeTexto(prod,"nItemPed")
      });
    }

    // Os pedidos que aparecem nos itens, sem repetir. Uma nota pode atender
    // mais de um pedido de compra — é comum quando o fornecedor junta cargas.
    var pedidos=[];
    for(var pi=0;pi<itens.length;pi++){
      var pd=String(itens[pi].pedido||"").trim();
      if(pd && pedidos.indexOf(pd)<0) pedidos.push(pd);
    }

    // ---- volume e peso: a nota já diz o tamanho da carga ----
    var bTransp=nfeEtiqueta(t,"transp"), vols=nfeTodas(bTransp,"vol");
    var qVol=0, pesoL=0, pesoB=0, especie="";
    for(var v=0;v<vols.length;v++){
      qVol  += nfeNum(nfeTexto(vols[v],"qVol"))||0;
      pesoL += nfeNum(nfeTexto(vols[v],"pesoL"))||0;
      pesoB += nfeNum(nfeTexto(vols[v],"pesoB"))||0;
      if(!especie) especie=nfeTexto(vols[v],"esp");
    }

    return { ok:true,
      chave: chave,
      itens: itens,
      pedidos: pedidos,
      itensCortados: cortou,
      aviso2: cortou ? "Esta nota tem mais de 500 produtos; a lista foi cortada." : "",
      volumes: qVol||null,
      especie: especie||"",
      pesoLiquido: pesoL||null,
      pesoBruto: pesoB||null,
      transportadoraNome: nfeTexto(nfeEtiqueta(bTransp,"transporta"),"xNome"),
      transportadoraCnpj: nfeTexto(nfeEtiqueta(bTransp,"transporta"),"CNPJ"),
      numero: nfeTexto(bIde,"nNF") || lida.numero,
      serie:  nfeTexto(bIde,"serie") || lida.serie,
      emissao: emissao ? emissao.slice(0,10).split("-").reverse().join("/") : lida.emissao,
      emitenteCnpj: nfeTexto(bEmit,"CNPJ") || lida.cnpj,
      emitenteNome: nfeTexto(bEmit,"xNome"),
      destinoCnpj:  nfeTexto(bDest,"CNPJ"),
      destinoNome:  nfeTexto(bDest,"xNome"),
      valor: nfeTexto(bTot,"vNF"),
      uf: lida.uf,
      aviso: lida.aviso
    };
  }

  var TXT_SIT={ solicitada:"aguardando", confirmada:"confirmada", em_recebimento:"em descarga",
                concluida:"concluída", recusada:"recusada", cancelada:"cancelada",
                nao_compareceu:"não compareceu", rascunho:"rascunho" };
  var TXT_TIPO={ entrega:"Entrega", coleta:"Coleta", representante:"Representante" };
  function uiSelo(s){ return '<span class="selo '+esc(s)+'">'+esc(TXT_SIT[s]||s)+'</span>'; }
  /* ==PORTAL-FIM== */

  var meuNome="", meuCnpj="", meuResp="";
  // Os dados da loja vêm do banco, não escritos aqui dentro: mudar o horário
  // de recebimento não pode exigir publicar o site de novo.
  var meuLocal=null;
  var pagAtual="inicio";

  // ============================================================
  // COMPONENTES REUTILIZÁVEIS
  // ============================================================
  function uiCarregando(txt){ return '<div class="carregando">'+esc(txt||"Carregando...")+'</div>'; }
  function uiErro(txt){ return '<div class="erro-cx">'+esc(txt)+'</div>'; }

  // Erro de rede NÃO pode virar estado vazio. "Você não tem nenhuma entrega"
  // quando na verdade a consulta falhou faz o fornecedor agendar de novo o que
  // já estava agendado. Devolve null quando deu ruim, e a tela mostra o erro.
  function deuCerto(r, onde){
    if(r && r.error){
      el("pagina").innerHTML=
        '<div class="bloco"><div class="bloco-corpo">'+
        uiErro("Não consegui carregar "+onde+". Verifique sua internet e tente de novo.")+
        '<button class="bt fraco mini" data-acao="recarregar">Tentar de novo</button></div></div>';
      return null;
    }
    return (r && r.data) || null;
  }
  function uiVazio(o){
    o=o||{};
    return '<div class="vazio"><div class="ic">'+(o.ic||IC.papel)+'</div>'+
           '<b>'+esc(o.titulo||"Nada por aqui")+'</b>'+
           (o.texto?'<p>'+esc(o.texto)+'</p>':'')+
           (o.acao?'<button class="bt" data-acao="'+esc(o.acao)+'">'+esc(o.acaoTxt||"Continuar")+'</button>':'')+
           '</div>';
  }
  // Aviso que precisa de um OK. Volta uma promessa, para dar pra esperar
  // a pessoa fechar antes de seguir.
  var avisoAberto=null;
  function uiAviso(titulo, texto, opc){
    opc=opc||{};
    return new Promise(function(pronto){
      if(avisoAberto){ try{ el("pilha").removeChild(avisoAberto); }catch(e){} }
      var f=document.createElement("div"); f.className="av-bg";
      var corpo = opc.lista && opc.lista.length
        ? (texto?'<p style="margin:0">'+esc(texto)+'</p>':'')+
          '<ul>'+opc.lista.map(function(x){ return '<li>'+esc(x)+'</li>'; }).join('')+'</ul>'
        : '<p style="margin:0">'+esc(texto||"")+'</p>';
      f.innerHTML='<div class="av-cx"><div class="av-top">'+
        '<span class="av-ic'+(opc.bom?' ok':'')+'">'+(opc.bom?IC_OK:IC_ALERTA)+'</span>'+
        '<span class="av-tit">'+esc(titulo||"Atenção")+'</span></div>'+
        '<div class="av-msg">'+corpo+'</div>'+
        '<div class="av-acts"><button class="bt" data-ok="1">'+esc(opc.ok||"OK, entendi")+'</button></div></div>';
      el("pilha").appendChild(f); avisoAberto=f;
      function fechar(){
        try{ el("pilha").removeChild(f); }catch(e){}
        if(avisoAberto===f) avisoAberto=null;
        document.removeEventListener("keydown", tecla);
        pronto();
      }
      function tecla(ev){ if(ev.key==="Escape"||ev.key==="Enter"){ ev.preventDefault(); fechar(); } }
      f.querySelector("[data-ok]").onclick=fechar;
      f.onclick=function(ev){ if(ev.target===f) fechar(); };
      document.addEventListener("keydown", tecla);
      setTimeout(function(){ try{ f.querySelector("[data-ok]").focus(); }catch(e){} }, 30);
    });
  }
  var IC_ALERTA='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
  var IC_OK='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';

  function uiToast(txt, tipo){
    var t=document.createElement("div");
    t.className="toast"+(tipo==="err"?" err":"");
    t.textContent=txt;
    el("toasts").appendChild(t);
    setTimeout(function(){ try{ el("toasts").removeChild(t); }catch(e){} }, 4200);
  }

  // Tabela: uma definição, várias telas.
  //   colunas: [{ch:'Ticket', cl:'nowrap', v:function(linha){return html}}]
  function uiTabela(colunas, linhas, opc){
    opc=opc||{};
    var h='<div class="rol"><table class="tab"><thead><tr>';
    for(var c=0;c<colunas.length;c++){
      h+='<th'+(colunas[c].w?' style="width:'+colunas[c].w+'"':'')+'>'+esc(colunas[c].ch||"")+'</th>';
    }
    h+='</tr></thead><tbody>';
    for(var i=0;i<linhas.length;i++){
      var l=linhas[i];
      h+='<tr'+(opc.id?' class="clica" data-ver="'+esc(l[opc.id])+'"':'')+'>';
      for(var j=0;j<colunas.length;j++){
        h+='<td'+(colunas[j].cl?' class="'+colunas[j].cl+'"':'')+'>'+(colunas[j].v(l)||"")+'</td>';
      }
      h+='</tr>';
    }
    return h+'</tbody></table></div>';
  }

  var modalAberto=null;
  function uiModal(o){
    uiFecharModal();
    var f=document.createElement("div"); f.className="mfundo";
    var c=document.createElement("div"); c.className="mcaixa"+(o.tam?" "+o.tam:"");
    c.innerHTML='<div class="mcab"><b>'+esc(o.titulo||"")+'</b>'+
      '<button class="icone" data-fecha="1"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>'+
      (o.cru ? o.corpo : '<div class="mcorpo">'+o.corpo+'</div>');
    f.appendChild(c);
    f.onclick=function(ev){ if(ev.target===f) uiFecharModal(); };
    c.querySelector("[data-fecha]").onclick=uiFecharModal;
    el("pilha").appendChild(f);
    modalAberto=f;
    document.body.style.overflow="hidden";
    return c;
  }
  function uiFecharModal(){
    if(!modalAberto) return;
    try{ el("pilha").removeChild(modalAberto); }catch(e){}
    modalAberto=null;
    document.body.style.overflow="";
  }
  document.addEventListener("keydown", function(ev){ if(ev.key==="Escape") uiFecharModal(); });

  // Confirmação para ação que não tem volta.
  function uiConfirmar(o){
    return new Promise(function(res){
      var c=uiModal({ titulo:o.titulo||"Confirmar", tam:"pequeno",
        corpo:'<p style="margin:0 0 6px;font-size:13.5px;line-height:1.55">'+esc(o.texto||"")+'</p>'+
              (o.campo?'<div class="fld" style="margin-top:14px"><label>'+esc(o.campo)+'</label>'+
                       '<textarea id="cfMotivo" maxlength="200" placeholder="'+esc(o.dica||"")+'"></textarea></div>':'')+
              '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px">'+
              '<button class="bt fraco" data-nao="1">'+esc(o.nao||"Voltar")+'</button>'+
              '<button class="bt '+(o.perigo?"perigo":"")+'" data-sim="1">'+esc(o.sim||"Confirmar")+'</button></div>' });
      c.querySelector("[data-nao]").onclick=function(){ uiFecharModal(); res(null); };
      c.querySelector("[data-sim]").onclick=function(){
        var m=c.querySelector("#cfMotivo");
        var v=m?(m.value||"").trim():"";
        uiFecharModal(); res({ok:true, motivo:v});
      };
    });
  }

  // ============================================================
  // TELAS DE ENTRAR  (não mexer: provado em produção)
  // ============================================================
  var TELAS=["telaAuth","telaSenha","telaConfirme","telaEspera"];
  var SUBS={telaAuth:"Supermercado Santa Rita · Caicó/RN", telaSenha:"Vamos mandar um link no seu e-mail",
            telaConfirme:"Falta um passo", telaEspera:"Supermercado Santa Rita · Caicó/RN"};
  function mostrar(qual){
    el("carregando").classList.add("esconde");
    el("app").classList.remove("on");
    el("login").classList.remove("esconde");
    for(var i=0;i<TELAS.length;i++){ el(TELAS[i]).classList.toggle("esconde", TELAS[i]!==qual); }
    el("sub").textContent = SUBS[qual] || SUBS.telaAuth;
    window.scrollTo(0,0);
  }
  function aviso(id, texto, tipo){
    /* "msgAuth" tem DUAS caixas: uma embaixo do botao Entrar e outra embaixo do
       Cadastrar. Cada aba precisa do recado logo abaixo do botao que a pessoa acabou
       de clicar — no fim da tela, como era antes, ele ficava depois do "Esqueci minha
       senha" e passava despercebido. Escrevo nas duas: a escondida nao aparece. */
    var alvos = (id==="msgAuth")
      ? [].slice.call(document.querySelectorAll(".msg-auth"))
      : [el(id)].filter(Boolean);
    /* classList, e nao className: reescrever a classe inteira colocava "msg-auth" ate
       na caixa da tela de senha, e a partir dai um aviso da tela de entrada escreveria
       nela tambem. Assim cada caixa mantem as classes que sao dela. */
    alvos.forEach(function(m){
      m.textContent=texto||"";
      m.classList.remove("err","ok","on");
      m.classList.add("msg", tipo||"err");
      if(texto) m.classList.add("on");
    });
  }
  function limpa(){ ["msgAuth","msgSenha"].forEach(function(i){ aviso(i,""); }); }

  var OLHO='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  var OLHO_OFF='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
  [].slice.call(document.querySelectorAll(".pw-eye")).forEach(function(sp){
    sp.innerHTML=OLHO;
    sp.onclick=function(){
      var inp=el(sp.getAttribute("data-olho"));
      var ver=inp.type==="password";
      inp.type=ver?"text":"password";
      sp.innerHTML=ver?OLHO_OFF:OLHO;
      inp.focus();
    };
  });

  function aba(qual){
    limpa();
    el("tabEntrar").classList.toggle("on", qual==="entrar");
    el("tabCriar").classList.toggle("on", qual==="criar");
    el("formEntrar").classList.toggle("esconde", qual!=="entrar");
    el("formCriar").classList.toggle("esconde", qual!=="criar");
  }
  el("tabEntrar").onclick=function(){ aba("entrar"); };
  el("tabCriar").onclick=function(){ aba("criar"); };

  el("btEntrar").onclick=function(){
    limpa();
    var email=(el("eEmail").value||"").trim().toLowerCase(), senha=el("eSenha").value||"";
    if(!email||!senha){ aviso("msgAuth","Preencha o e-mail e a senha."); return; }
    el("btEntrar").disabled=true; el("btEntrar").textContent="Entrando...";
    SB.auth.signInWithPassword({email:email,password:senha}).then(function(r){
      el("btEntrar").disabled=false; el("btEntrar").textContent="Entrar";
      if(r.error){
        var m=r.error.message||"";
        // a MESMA frase do painel, palavra por palavra: quem erra o login nos dois
        // sistemas tem que receber exatamente a mesma resposta
        if(/Invalid login/i.test(m)) aviso("msgAuth","Email ou senha errados.");
        else if(/Email not confirmed/i.test(m)) aviso("msgAuth","Confirme seu e-mail antes de entrar. Procure a mensagem que mandamos.");
        else aviso("msgAuth", m||"Não consegui entrar.");
        return;
      }
      decidirTela();
    });
  };
  function sair(){
    SB.auth.signOut().then(function(){
      // Sair tem que limpar o campo: em computador de portaria, a senha do
      // fornecedor anterior ficava preenchida para o próximo que sentasse ali.
      el("eSenha").value=""; el("cSenha").value=""; el("eEmail").value="";
      meuNome=""; meuCnpj=""; meuResp=""; calRef=null; calJaAjustou=false; calCache=[];
      fSit=[]; fTipo=""; fDe=""; fAte=""; fBusca=""; fPag=0;
      aba("entrar"); mostrar("telaAuth");
    });
  }
  el("btSair").onclick=sair; el("btSair2").onclick=sair;
  el("btIrSenha").onclick=function(){ limpa(); el("sEmail").value=el("eEmail").value||""; mostrar("telaSenha"); };
  el("btVoltaAuth").onclick=function(){ limpa(); mostrar("telaAuth"); };
  el("btVoltaAuth2").onclick=function(){ limpa(); aba("entrar"); mostrar("telaAuth"); };

  el("cCnpj").addEventListener("input", function(){
    var fim=this.selectionStart===this.value.length;
    this.value=cnpjFmt(this.value);
    if(fim){ try{ this.setSelectionRange(this.value.length,this.value.length); }catch(e){} }
    var d=cnpjLimpo(this.value);
    if(d.length===14){
      var ok=cnpjValido(d);
      this.classList.toggle("ruim",!ok);
      el("cCnpjDica").textContent=ok?"CNPJ conferido.":"Esse CNPJ não confere. Veja se digitou certo.";
      el("cCnpjDica").style.color=ok?"#157a35":"#c0392b";
    } else { this.classList.remove("ruim"); el("cCnpjDica").textContent=""; }
  });

  el("btCriar").onclick=function(){
    limpa();
    var cnpj=cnpjLimpo(el("cCnpj").value), razao=(el("cRazao").value||"").trim(),
        resp=(el("cResp").value||"").trim(), tel=(el("cTel").value||"").trim(),
        email=(el("cEmail").value||"").trim().toLowerCase(), senha=el("cSenha").value||"";
    if(!cnpjValido(cnpj)){ aviso("msgAuth","O CNPJ não confere. Confira os números."); return; }
    if(razao.length<3){ aviso("msgAuth","Informe a razão social da empresa."); return; }
    if(!resp){ aviso("msgAuth","Informe quem é o responsável pelo agendamento."); return; }
    if(!/^[^@\\s]+@[^@\\s]+\\.[a-z]{2,}$/i.test(email)){ aviso("msgAuth","Informe um e-mail válido."); return; }
    if(senha.length<6){ aviso("msgAuth","A senha precisa de pelo menos 6 caracteres."); return; }

    el("btCriar").disabled=true; el("btCriar").textContent="Cadastrando...";
    SB.auth.signUp({ email:email, password:senha,
      options:{
        // Sem isto, o link de confirmação joga a pessoa no endereço padrão do projeto — que é
        // o PAINEL. O fornecedor clicava em "confirmar" e caía na tela de login da loja.
        emailRedirectTo: location.origin + location.pathname,
        data:{ tipo:"fornecedor", nome:resp, cnpj:cnpj, razao_social:razao, telefone:tel, responsavel:resp }
      }
    }).then(function(r){
      el("btCriar").disabled=false; el("btCriar").textContent="Cadastrar minha empresa";
      if(r.error){
        var m=r.error.message||"";
        if(/already registered|already been registered/i.test(m)) aviso("msgAuth","Já existe cadastro com esse e-mail. Tente entrar, ou use 'Esqueci minha senha'.");
        else aviso("msgAuth", m||"Não consegui cadastrar.");
        return;
      }
      if(r.data && r.data.session){ garantirCadastro().then(decidirTela); }
      else { el("confEmail").textContent=email; mostrar("telaConfirme"); }
    });
  };

  el("btMandarSenha").onclick=function(){
    limpa();
    var email=(el("sEmail").value||"").trim().toLowerCase();
    if(!/^[^@\\s]+@[^@\\s]+\\.[a-z]{2,}$/i.test(email)){ aviso("msgSenha","Informe o e-mail do cadastro."); return; }
    el("btMandarSenha").disabled=true;
    SB.auth.resetPasswordForEmail(email,{redirectTo:location.href}).then(function(){
      el("btMandarSenha").disabled=false;
      // resposta igual exista ou não o e-mail: senão vira jeito de descobrir quem é cadastrado
      aviso("msgSenha","Se existir cadastro com esse e-mail, o link já está a caminho.","ok");
    });
  };

  function garantirCadastro(){
    return SB.rpc("forn_minha_situacao").then(function(r){
      var d=r.data;
      if(d && d.ok) return d;
      return SB.auth.getUser().then(function(u){
        var m=(u&&u.data&&u.data.user&&u.data.user.user_metadata)||{};
        if(!m.cnpj||!m.razao_social) return null;
        return SB.rpc("forn_cadastrar",{ p_cnpj:m.cnpj, p_razao_social:m.razao_social,
          p_email:(u.data.user.email||""), p_telefone:m.telefone||null,
          p_responsavel:m.responsavel||null, p_nome:m.nome||null })
          .then(function(){
            try{ SB.functions.invoke("aviso-conta-criada",{body:{evento:"cadastro"}}); }catch(e){}
            return SB.rpc("forn_minha_situacao").then(function(r2){ return r2.data; });
          });
      });
    });
  }

  function recusarComoErro(){
    function mostrarLogin(){
      el("eSenha").value="";
      aba("entrar"); mostrar("telaAuth");
      aviso("msgAuth","Email ou senha errados.");
    }
    try{ SB.auth.signOut().then(mostrarLogin, mostrarLogin); }catch(e){ mostrarLogin(); }
  }

  function decidirTela(){
    return garantirCadastro().then(function(d){
      /* QUEM NÃO É FORNECEDOR É RECUSADO COMO QUALQUER LOGIN ERRADO.
         O login do painel e o do portal moram no mesmo lugar, então um e-mail de
         funcionário entra aqui. Até 21/08/2026 ele via "Cadastro não encontrado —
         fale com a loja", que era duas coisas ruins de uma vez: mandava ele cobrar da
         loja um cadastro que ele não deveria ter, e CONFIRMAVA, para quem estivesse
         tentando e-mail por e-mail, que aquele endereço existe em algum sistema da
         loja. O portal não tem por que entregar isso.
         Agora ele vê exatamente o que quem erra a senha vê. Mesma frase do btEntrar.
         ATENÇÃO: isto vale só para quem NÃO é fornecedor (d.ok falso). Fornecedor de
         verdade esperando liberação continua vendo "Cadastro em análise" logo abaixo —
         esse precisa mesmo falar com a loja. */
      if(!d||!d.ok){ recusarComoErro(); return; }
      meuNome=d.empresa||""; meuCnpj=d.cnpj||""; meuResp=d.responsavel||"";
      if(d.liberado){ abrirCasa(); return; }
      var tit="Cadastro em análise",
          txt="A loja está conferindo seus dados. Assim que liberarem, você vai poder agendar suas entregas por aqui.";
      if(d.situacao_empresa==="recusado"||d.situacao_conta==="recusada"){
        tit="Acesso não liberado";
        txt="Seu cadastro não foi liberado."+(d.motivo?" Motivo: "+d.motivo:"")+" Fale com a loja.";
      }
      if(d.situacao_empresa==="bloqueado"){
        tit="Acesso bloqueado";
        txt="Seu acesso está bloqueado."+(d.motivo?" Motivo: "+d.motivo:"")+" Fale com a loja.";
      }
      el("esperaTit").textContent=tit; el("esperaTxt").textContent=txt;
      mostrar("telaEspera");
    });
  }
  el("btAtualizar").onclick=function(){ decidirTela(); };

  // ============================================================
  // A CASA
  // ============================================================
  var IC={
    inicio:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
    calendario:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    agendas:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11H3v10h6zM21 3h-6v18h6zM15 7H9v14h6z"/></svg>',
    pedidos:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>',
    seta:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>',
    olho:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
    cal:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    tag:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41 13.42 20.6a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>',
    imprimir:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>',
    remarcar:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><path d="M8 14h8"/></svg>',
    cancelar:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.9" y1="4.9" x2="19.1" y2="19.1"/></svg>',
    // Só o contorno externo, em 14px, vira um borrão redondo — parecia uma
    // bolinha vazia. As duas linhas de dentro é que fazem ler como caixa.
    caixa:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>',
    caminhao:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13"/><path d="M16 8h4l3 3v5h-7z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>',
    pessoa:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    local:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
    lapis:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
    x:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    alerta:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12" y2="17"/></svg>',
    papel:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
    clipe:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>',
    lixo:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    lupa:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
    balao:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z"/></svg>',
    sino:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
    devolucao:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>'
  };

  var PAGS=[{k:"inicio",t:"Início"},{k:"calendario",t:"Calendário"},
            {k:"agendas",t:"Meus agendamentos"},{k:"pedidos",t:"Pedidos"}];

  function abrirCasa(){
    el("carregando").classList.add("esconde");
    el("login").classList.add("esconde");
    el("app").classList.add("on");
    el("uNome").textContent=meuNome;
    el("uCnpj").textContent=meuCnpj?cnpjFmt(meuCnpj):"";
    el("uIni").textContent=(meuNome||"?").trim().charAt(0).toUpperCase();

    var h="";
    for(var i=0;i<PAGS.length;i++){
      h+='<button data-pag="'+PAGS[i].k+'">'+IC[PAGS[i].k]+PAGS[i].t+'</button>';
    }
    el("nav").innerHTML=h;
    [].slice.call(el("nav").children).forEach(function(b){
      b.onclick=function(){ irPara(b.getAttribute("data-pag")); el("lateral").classList.remove("abre"); };
    });

    window.scrollTo(0,0);
    irPara("inicio");
    contarAvisos();
    // se a função ainda não existir no banco, o portal segue sem ela
    try{ SB.rpc("forn_local").then(function(r){
      if(r && r.data && r.data.ok) meuLocal=r.data;
    }, function(){}); }catch(e){}
  }

  el("btMenu").onclick=function(){ el("lateral").classList.toggle("abre"); };
  el("btNova").onclick=function(){ el("lateral").classList.remove("abre"); abrirWizard(); };

  function marcarNav(k){
    [].slice.call(el("nav").children).forEach(function(b){
      b.classList.toggle("on", b.getAttribute("data-pag")===k);
    });
    for(var i=0;i<PAGS.length;i++){ if(PAGS[i].k===k) el("tituloPag").textContent=PAGS[i].t; }
  }

  function irPara(k){
    pagAtual=k;
    marcarNav(k);
    el("pagina").innerHTML=uiCarregando();
    window.scrollTo(0,0);
    if(k==="inicio")     pagInicio();
    if(k==="calendario") pagCalendario();
    if(k==="agendas")    pagAgendas();
    if(k==="pedidos")    pagPedidos();
  }

  // ============================================================
  // INÍCIO
  // ============================================================
  function pagInicio(){
    Promise.all([SB.rpc("forn_inicio"), SB.rpc("forn_avisos")]).then(function(rs){
      if(pagAtual!=="inicio") return;
      var d=deuCerto(rs[0],"seus agendamentos"); if(d===null) return;
      var avisos=(rs[1]&&rs[1].data)||[];
      var prox=d.proximas||[], c=d.contagem||{};

      var h='<div class="colunas"><div>';

      h+='<div class="bloco"><div class="bloco-cab"><b>Próximos agendamentos</b>'+
         '<button class="bt mini" data-acao="nova">Novo agendamento</button></div>'+
         '<div class="bloco-corpo zero">';
      if(!prox.length){
        h+=uiVazio({ic:IC.caminhao,titulo:"Nenhuma entrega marcada",
                    texto:"Quando você agendar uma entrega, ela aparece aqui com o horário e a situação.",
                    acao:"nova",acaoTxt:"Agendar uma entrega"});
      } else {
        for(var i=0;i<prox.length;i++){
          var a=prox[i], p=partes(a.quando)||{curta:"",hora:""};
          h+='<div class="ag" data-ver="'+esc(a.id)+'">'+
             '<div class="ag-nome"><b>'+esc(a.destinatario||"Santa Rita")+'</b>'+
             '<span>'+esc(a.doca||"Doca a definir")+'</span></div>'+
             '<div class="ag-c"><label>Ticket</label><div>'+esc(a.ticket)+'</div></div>'+
             '<div class="ag-c"><label>Tipo</label><div>'+esc(TXT_TIPO[a.tipo]||a.tipo)+'</div></div>'+
             '<div class="ag-c" style="min-width:132px"><label>Data da entrega</label><div>'+
                esc(p.curta+(p.hora?" · "+p.hora:""))+'</div></div>'+
             '<div class="ag-c" style="min-width:118px">'+uiSelo(a.situacao)+'</div>'+
             '<span class="seta">'+IC.seta+'</span></div>';
        }
      }
      h+='</div></div>';

      h+='</div><div>';

      h+='<div class="bloco"><div class="bloco-cab"><b>Seus números</b></div><div class="bloco-corpo">'+
         '<div class="num-lin"><span>Aguardando a loja</span><b>'+(c.aguardando||0)+'</b></div>'+
         '<div class="num-lin"><span>Confirmadas</span><b>'+(c.confirmadas||0)+'</b></div>'+
         '<div class="num-lin"><span>Já recebidas</span><b>'+(c.recebidas||0)+'</b></div>'+
         '<div class="num-lin"><span>Canceladas / recusadas</span><b>'+(c.canceladas||0)+'</b></div>'+
         '</div></div>';

      h+='<div class="bloco" style="margin-top:16px"><div class="bloco-cab"><b>Últimos avisos</b>'+
         (avisos.length?'<button class="link" data-acao="avisos">Ver todos</button>':'')+
         '</div><div class="bloco-corpo'+(avisos.length?' zero':'')+'">';
      if(!avisos.length){
        h+='<div style="color:var(--txt2);font-size:13px">Nenhum aviso por enquanto.</div>';
      } else {
        for(var j=0;j<Math.min(4,avisos.length);j++){
          var v=avisos[j];
          h+='<div class="ag" style="padding:11px 16px"'+(v.agenda_id?' data-ver="'+esc(v.agenda_id)+'"':'')+'>'+
             '<div class="ag-nome"><b style="font-size:13px">'+esc(v.titulo)+'</b>'+
             '<span>'+esc(v.texto||"")+'</span></div>'+
             '<div class="ag-c" style="min-width:auto"><div style="font-size:11px;color:var(--txt3)">'+esc(v.em)+'</div></div>'+
             '</div>';
        }
      }
      h+='</div></div>';

      h+='</div></div>';
      el("pagina").innerHTML=h;
    });
  }

  // ============================================================
  // CALENDÁRIO
  // ============================================================
  var calRef=null, calVisao="semana", calFiltro={entrega:true};
  var calCache=[], calJaAjustou=false, calPedido=0;

  function pagCalendario(){
    if(!calRef) calRef=new Date();
    var de, ate;
    if(calVisao==="semana"){ de=inicioSemana(calRef); ate=new Date(de); ate.setDate(ate.getDate()+6); }
    else if(calVisao==="dia"){ de=new Date(calRef); de.setHours(0,0,0,0); ate=new Date(de); }
    else { de=new Date(calRef.getFullYear(), calRef.getMonth(), 1);
           ate=new Date(calRef.getFullYear(), calRef.getMonth()+1, 0); }

    // o mini calendário mostra o mês inteiro, então busco o maior intervalo dos dois
    var mDe=new Date(calRef.getFullYear(), calRef.getMonth(), 1);
    var mAte=new Date(calRef.getFullYear(), calRef.getMonth()+1, 0);
    var bDe=de<mDe?de:mDe, bAte=ate>mAte?ate:mAte;

    el("pagina").innerHTML=uiCarregando("Carregando seus agendamentos...");
    // Clicar rápido em ‹ › dispara várias consultas; a que voltar por último
    // venceria, mesmo sendo de um mês que o fornecedor já deixou para trás.
    var pedido=++calPedido;
    SB.rpc("forn_agenda_periodo",{p_de:isoData(bDe), p_ate:isoData(bAte)}).then(function(r){
      if(pagAtual!=="calendario" || pedido!==calPedido) return;
      var dd=deuCerto(r,"o calendário"); if(dd===null) return;
      calCache=dd||[];

      // Um fornecedor entrega poucas vezes por mês. Abrir numa semana vazia não diz
      // nada. Só na PRIMEIRA abertura, se a semana de hoje não tem nada, pulo para a
      // semana da próxima entrega. O botão "Hoje" traz de volta.
      if(!calJaAjustou && calVisao==="semana"){
        calJaAjustou=true;
        var temNaSemana=false, s0=isoData(de), s1=isoData(ate);
        for(var i=0;i<calCache.length;i++){
          var dd=String(calCache[i].quando||"").slice(0,10);
          if(dd>=s0 && dd<=s1){ temNaSemana=true; break; }
        }
        if(!temNaSemana){
          var hj=hojeIso(), prox=null;
          for(var j=0;j<calCache.length;j++){
            var q=String(calCache[j].quando||"").slice(0,10);
            if(q>=hj && (!prox || q<prox)) prox=q;
          }
          if(prox){ calRef=deIso(prox); pagCalendario(); return; }
        }
      }
      pintarCalendario(de, ate);
    });
  }

  function eventosDoDia(iso){
    var out=[];
    for(var i=0;i<calCache.length;i++){
      var a=calCache[i];
      if(!calFiltro[a.tipo]) continue;
      if(String(a.quando||"").slice(0,10)===iso) out.push(a);
    }
    return out;
  }

  function pintarCalendario(de, ate){
    var titulo;
    if(calVisao==="semana"){
      var f=new Date(de); f.setDate(f.getDate()+6);
      titulo = de.getMonth()===f.getMonth()
        ? de.getDate()+" – "+f.getDate()+" de "+MESES[de.getMonth()]+" de "+de.getFullYear()
        : de.getDate()+" "+MES3[de.getMonth()]+" – "+f.getDate()+" "+MES3[f.getMonth()]+" de "+f.getFullYear();
    } else if(calVisao==="dia"){
      titulo = maiuscula(DOWS[de.getDay()])+", "+de.getDate()+" de "+MESES[de.getMonth()];
    } else {
      titulo = maiuscula(MESES[calRef.getMonth()])+" de "+calRef.getFullYear();
    }

    var h='<div class="cal"><div>';

    // ---- mini calendário + filtros ----
    h+='<div class="bloco mini"><div class="mini-cab">'+
       '<button class="mini-nav" data-mini="-1">‹</button>'+
       '<b>'+esc(maiuscula(MES3[calRef.getMonth()])+" "+calRef.getFullYear())+'</b>'+
       '<button class="mini-nav" data-mini="1">›</button></div><div class="mini-grade">';
    for(var w=0;w<7;w++){ h+='<div class="mini-dow">'+DOW1[w]+'</div>'; }
    var pri=new Date(calRef.getFullYear(), calRef.getMonth(), 1);
    var ini=new Date(pri); ini.setDate(ini.getDate()-pri.getDay());
    var hj=hojeIso();
    var semDe=calVisao==="semana"?isoData(inicioSemana(calRef)):null;
    for(var k=0;k<42;k++){
      var dd=new Date(ini); dd.setDate(dd.getDate()+k);
      var iso=isoData(dd), fora=dd.getMonth()!==calRef.getMonth();
      var naSemana=false;
      if(semDe){ var s0=deIso(semDe), s1=new Date(s0); s1.setDate(s1.getDate()+6);
                 naSemana = dd>=s0 && dd<=s1; }
      var tem=eventosDoDia(iso).length>0;
      h+='<button class="mini-d'+(fora?" fora":"")+(iso===hj?" hoje":"")+(naSemana?" sem":"")+
         '" data-mini-dia="'+iso+'">'+dd.getDate()+(tem?'<i></i>':'')+'</button>';
    }
    h+='</div>';

    h+='<div class="visu"><b>Visualização</b>'+
       '<label><input type="checkbox" data-filtro="entrega"'+(calFiltro.entrega?" checked":"")+'>'+
         '<span class="pt" style="background:var(--verde)"></span> Entregas</label>'+
       '<label class="off" title="Ainda não liberado"><input type="checkbox" disabled>'+
         '<span class="pt" style="background:#c6cdd5"></span> Coletas</label>'+
       '<label class="off" title="Ainda não liberado"><input type="checkbox" disabled>'+
         '<span class="pt" style="background:#c6cdd5"></span> Representante</label>'+
       '<div class="dica" style="margin-top:8px">Coletas e Representante ainda não foram liberados pela loja.</div>'+
       '</div></div>';

    h+='</div><div class="bloco" style="overflow:hidden">';

    // ---- cabeçalho ----
    h+='<div class="cal-cab">'+
       '<button class="mini-nav" data-nav="-1">‹</button>'+
       '<button class="mini-nav" data-nav="1">›</button>'+
       '<button class="bt fraco mini" data-nav="0">Hoje</button>'+
       '<div class="quando">'+esc(titulo)+'</div>'+
       '<div class="grupo">'+
         '<button data-visao="dia"'+(calVisao==="dia"?' class="on"':'')+'>Dia</button>'+
         '<button data-visao="semana"'+(calVisao==="semana"?' class="on"':'')+'>Semana</button>'+
         '<button data-visao="mes"'+(calVisao==="mes"?' class="on"':'')+'>Mês</button>'+
       '</div>'+
       '<button class="bt mini" data-acao="nova">Novo agendamento</button>'+
       '</div>';

    h+= calVisao==="mes" ? gradeMes() : gradeHoras(de, calVisao==="dia"?1:7);
    h+='</div></div>';

    el("pagina").innerHTML=h;

    [].slice.call(el("pagina").querySelectorAll("[data-nav]")).forEach(function(b){
      b.onclick=function(){
        var n=parseInt(b.getAttribute("data-nav"),10);
        if(n===0){ calRef=new Date(); }
        else if(calVisao==="semana"){ calRef.setDate(calRef.getDate()+7*n); }
        else if(calVisao==="dia"){ calRef.setDate(calRef.getDate()+n); }
        else { calRef.setDate(1); calRef.setMonth(calRef.getMonth()+n); }
        pagCalendario();
      };
    });
    [].slice.call(el("pagina").querySelectorAll("[data-mini]")).forEach(function(b){
      b.onclick=function(){
        calRef.setDate(1); calRef.setMonth(calRef.getMonth()+parseInt(b.getAttribute("data-mini"),10));
        pagCalendario();
      };
    });
    [].slice.call(el("pagina").querySelectorAll("[data-mini-dia]")).forEach(function(b){
      b.onclick=function(){ calRef=deIso(b.getAttribute("data-mini-dia")); pagCalendario(); };
    });
    [].slice.call(el("pagina").querySelectorAll("[data-visao]")).forEach(function(b){
      b.onclick=function(){ calVisao=b.getAttribute("data-visao"); pagCalendario(); };
    });
    [].slice.call(el("pagina").querySelectorAll("[data-filtro]")).forEach(function(b){
      b.onchange=function(){ calFiltro[b.getAttribute("data-filtro")]=b.checked; pagCalendario(); };
    });

    var rol=el("pagina").querySelector(".sem-rol");
    if(rol) rol.scrollTop=Math.max(0,(7-HORA_INI)*ALT_H-10);
  }

  function gradeHoras(de, dias){
    var hj=hojeIso();
    var h='<div class="sem-cab" style="grid-template-columns:54px repeat('+dias+',minmax(0,1fr))"><div></div>';
    var i, d, iso;
    for(i=0;i<dias;i++){
      d=new Date(de); d.setDate(d.getDate()+i); iso=isoData(d);
      var fds=d.getDay()===0||d.getDay()===6;
      h+='<div class="d'+(iso===hj?" hoje":"")+(fds?" fds":"")+'">'+
         '<span>'+DOW3[d.getDay()]+'</span><b>'+d.getDate()+'</b></div>';
    }
    h+='</div><div class="sem-rol"><div class="sem-grade" style="grid-template-columns:54px repeat('+dias+',minmax(0,1fr))">';
    h+='<div class="sem-horas">';
    for(i=HORA_INI;i<=HORA_FIM;i++){ h+='<div class="h">'+String(i).padStart(2,"0")+':00</div>'; }
    h+='</div>';
    var altura=(HORA_FIM-HORA_INI+1)*ALT_H;
    for(i=0;i<dias;i++){
      d=new Date(de); d.setDate(d.getDate()+i); iso=isoData(d);
      var fim=d.getDay()===0||d.getDay()===6;
      h+='<div class="sem-col'+(fim?" fds":"")+'" style="height:'+altura+'px">';
      var evs=eventosDoDia(iso);
      for(var j=0;j<evs.length;j++){
        var a=evs[j];
        var m1=minutos(a.quando), m2=minutos(a.ate);
        if(m2<=m1) m2=m1+60;
        var topo=((m1/60)-HORA_INI)*ALT_H;
        var alt=Math.max(22,((m2-m1)/60)*ALT_H-2);
        if(topo<0){ alt+=topo; topo=0; }
        if(alt<18) alt=18;
        h+='<div class="ev '+esc(a.situacao)+'" data-ver="'+esc(a.id)+'" '+
           'style="top:'+topo+'px;height:'+alt+'px" title="'+esc(a.ticket+" · "+(TXT_SIT[a.situacao]||""))+'">'+
           '<b>'+esc(String(a.quando).slice(11,16))+'</b>'+
           '<span>'+esc(a.ticket)+'</span></div>';
      }
      h+='</div>';
    }
    return h+'</div></div>';
  }

  function gradeMes(){
    var pri=new Date(calRef.getFullYear(), calRef.getMonth(), 1);
    var ini=new Date(pri); ini.setDate(ini.getDate()-pri.getDay());
    var hj=hojeIso();
    var h='<div class="mes-grade">';
    for(var w=0;w<7;w++){ h+='<div class="mes-dow">'+DOW3[w]+'</div>'; }
    for(var k=0;k<42;k++){
      var d=new Date(ini); d.setDate(d.getDate()+k);
      var iso=isoData(d), fora=d.getMonth()!==calRef.getMonth();
      var fds=d.getDay()===0||d.getDay()===6;
      if(k>=35 && fora) continue;
      h+='<div class="mes-d'+(fora?" fora":"")+(fds?" fds":"")+(iso===hj?" hoje":"")+'"><b>'+d.getDate()+'</b>';
      var evs=eventosDoDia(iso);
      for(var j=0;j<Math.min(3,evs.length);j++){
        h+='<div class="mes-ev '+esc(evs[j].situacao)+'" data-ver="'+esc(evs[j].id)+'">'+
           esc(String(evs[j].quando).slice(11,16)+" "+evs[j].ticket)+'</div>';
      }
      if(evs.length>3) h+='<div style="font-size:10px;color:var(--txt2);padding-left:3px">+'+(evs.length-3)+' mais</div>';
      h+='</div>';
    }
    return h+'</div>';
  }

  // ============================================================
  // MINHAS AGENDAS
  // ============================================================
  var fSit=[], fTipo="", fDe="", fAte="", fBusca="", fPag=0, fAberto=false;
  var LIM=25;

  function pagAgendas(){
    var filtros={ situacoes:fSit, tipo:fTipo, de:fDe, ate:fAte, busca:fBusca, limite:LIM, pula:fPag*LIM };
    SB.rpc("forn_agenda_lista",{p_filtros:filtros}).then(function(r){
      if(pagAtual!=="agendas") return;
      var d=deuCerto(r,"seus agendamentos"); if(d===null) return;
      var itens=d.itens||[], total=d.total||0;

      var SITS=[["solicitada","Aguardando"],["confirmada","Confirmada"],["em_recebimento","Em descarga"],
                ["concluida","Concluída"],["recusada","Recusada"],["cancelada","Cancelada"],
                ["nao_compareceu","Não compareceu"]];

      var h='<div class="linha-topo"><h2 class="h-sec">Meus agendamentos<small>'+
            total+(total===1?" agendamento encontrado":" agendamentos encontrados")+'</small></h2>'+
            '<button class="bt" data-acao="nova">Novo agendamento</button></div>';

      h+='<div class="bloco"><div class="filtros'+(fAberto?" aberto":"")+'" id="cxFiltros">'+
         '<div class="filtros-cab" id="filtrosCab"><b>Filtros</b>'+
         '<span class="seta">'+IC.seta+'</span></div>'+
         '<div class="filtros-corpo">'+
           '<div style="margin:10px 0 12px"><div class="chips">';
      for(var s=0;s<SITS.length;s++){
        h+='<button class="chip'+(fSit.indexOf(SITS[s][0])>=0?" on":"")+'" data-sit="'+SITS[s][0]+'">'+SITS[s][1]+'</button>';
      }
      h+='</div></div><div class="filtros-grade">'+
           '<div class="fld" style="margin:0"><label>Buscar por ticket ou pedido</label>'+
             '<input id="fBusca" type="text" value="'+esc(fBusca)+'" placeholder="Ex: AG-2608-0012"></div>'+
           '<div class="fld" style="margin:0"><label>De</label><input id="fDe" type="date" value="'+esc(fDe)+'"></div>'+
           '<div class="fld" style="margin:0"><label>Até</label><input id="fAte" type="date" value="'+esc(fAte)+'"></div>'+
           '</div><div class="filtros-pe">'+
           '<button class="bt fraco mini" id="fLimpar">Limpar filtros</button>'+
           '<button class="bt mini" id="fAplicar">Aplicar</button>'+
           '</div></div></div>';

      if(!itens.length){
        h+= (fSit.length||fBusca||fDe||fAte)
          ? uiVazio({ic:IC.lupa,titulo:"Nada encontrado",texto:"Nenhum agendamento bate com esses filtros. Tente limpar e buscar de novo."})
          : uiVazio({ic:IC.caminhao,titulo:"Você ainda não tem agendamentos",
                     texto:"Quando marcar uma entrega, ela aparece aqui com ticket, horário e situação.",
                     acao:"nova",acaoTxt:"Agendar uma entrega"});
        h+='</div>';
      } else {
        h+=uiTabela([
          {ch:"Ticket",cl:"nowrap",v:function(l){ return '<span class="tick">'+esc(l.ticket)+'</span>'; }},
          {ch:"Tipo",cl:"nowrap",v:function(l){ return esc(TXT_TIPO[l.tipo]||l.tipo); }},
          {ch:"Pedido",cl:"nowrap",v:function(l){ return l.pedidos?esc(l.pedidos):'<span style="color:var(--txt3)">—</span>'; }},
          {ch:"Remetente / Destinatário",v:function(l){
              return '<span class="forte">'+esc(l.remetente||"—")+'</span>'+
                     '<span class="par">para '+esc(l.destinatario||"Santa Rita")+(l.doca?" · "+esc(l.doca):"")+'</span>'; }},
          {ch:"Data solicitada",cl:"nowrap",v:function(l){
              return esc(quandoTxt(l.solicitada, l.solicitada_ate)); }},
          {ch:"Data confirmada",cl:"nowrap",v:function(l){
              return l.confirmada ? esc(quandoTxt(l.confirmada, l.confirmada_ate))
                                  : '<span style="color:var(--txt3)">—</span>'; }},
          {ch:"Situação",cl:"nowrap",v:function(l){ return uiSelo(l.situacao); }},
          {ch:"",cl:"nowrap",w:"44px",v:function(l){
              return '<button class="olho" data-ver="'+esc(l.id)+'" title="Ver detalhes">'+IC.olho+'</button>'; }}
        ], itens, {id:"id"});

        var ini=fPag*LIM+1, fim=Math.min(total,(fPag+1)*LIM);
        h+='<div class="paginacao"><span>Mostrando '+ini+'–'+fim+' de '+total+'</span><span>'+
           '<button class="bt fraco mini" data-pg="-1"'+(fPag<=0?" disabled":"")+'>Anterior</button> '+
           '<button class="bt fraco mini" data-pg="1"'+(fim>=total?" disabled":"")+'>Próxima</button></span></div>';
        h+='</div>';
      }

      el("pagina").innerHTML=h;

      el("filtrosCab").onclick=function(){
        fAberto=!fAberto; el("cxFiltros").classList.toggle("aberto", fAberto);
      };
      [].slice.call(el("pagina").querySelectorAll("[data-sit]")).forEach(function(b){
        b.onclick=function(){
          var v=b.getAttribute("data-sit"), i=fSit.indexOf(v);
          if(i>=0) fSit.splice(i,1); else fSit.push(v);
          fPag=0; fAberto=true; pagAgendas();
        };
      });
      var apl=el("fAplicar");
      if(apl) apl.onclick=function(){
        fBusca=(el("fBusca").value||"").trim(); fDe=el("fDe").value||""; fAte=el("fAte").value||"";
        fPag=0; fAberto=true; pagAgendas();
      };
      var lmp=el("fLimpar");
      if(lmp) lmp.onclick=function(){
        fSit=[]; fTipo=""; fDe=""; fAte=""; fBusca=""; fPag=0; fAberto=true; pagAgendas();
      };
      [].slice.call(el("pagina").querySelectorAll("[data-pg]")).forEach(function(b){
        b.onclick=function(){ fPag+=parseInt(b.getAttribute("data-pg"),10); pagAgendas(); };
      });
    });
  }

  // ============================================================
  // PEDIDOS
  // ============================================================
  // A ficha de cada pedido, guardada quando a lista chega. O detalhe recebe so o id,
  // e o cabecalho dele (numero, emissao, previsao) ja veio aqui — nao precisa ir de
  // novo ao banco so pra repetir dado que o portal ja tem na mao.
  var pedCache={};
  function guardarPedidos(l){ for(var i=0;i<(l||[]).length;i++) if(l[i]&&l[i].id) pedCache[l[i].id]=l[i]; }

  function pagPedidos(){
    SB.rpc("forn_pedidos").then(function(r){
      if(pagAtual!=="pedidos") return;
      var d=deuCerto(r,"os pedidos"); if(d===null) return;
      var l=d.pedidos||[];
      guardarPedidos(l);

      var h='<div class="linha-topo"><h2 class="h-sec">Pedidos<small>'+
            (d.ligado? l.length+(l.length===1?" pedido":" pedidos") : "Aguardando a ligação com o sistema da loja")+
            '</small></h2></div><div class="bloco">';

      if(!l.length){
        // Duas ausências diferentes, duas frases diferentes. Enquanto era só
        // "vazio", esta tela dizia "estamos trabalhando para trazer os pedidos"
        // até para quem simplesmente não tem pedido em aberto — e virou mentira
        // no dia em que os pedidos do VR chegaram.
        h += (d.motivo==="sem_pedido_meu")
          ? uiVazio({ic:IC.caixa,titulo:"Você não tem pedido em aberto",
              texto:"Nenhum pedido de compra da loja para você está aguardando entrega no momento. "+
                    "Quando a loja emitir um novo pedido, ele aparece aqui sozinho."})
          : uiVazio({ic:IC.caixa,titulo:"Ainda não estamos mostrando pedidos aqui",
              texto:"Os pedidos de compra ficam no sistema interno da loja. Estamos trabalhando para trazê-los "+
                    "para cá — quando isso acontecer, você vai ver o que foi pedido, o que já entregou e o que "+
                    "ainda falta. Por enquanto, informe o número do pedido na hora de agendar a entrega."});
      } else {
        h+=uiTabela([
          {ch:"Pedido",cl:"nowrap",v:function(p){ return '<span class="tick">'+esc(p.numero)+'</span>'; }},
          {ch:"Fornecedor",v:function(p){ return esc(meuNome); }},
          {ch:"Destinatário",v:function(p){ return esc(p.destinatario||"Santa Rita"); }},
          {ch:"Emissão",cl:"nowrap",v:function(p){ return esc(p.emissao||"—"); }},
          {ch:"Previsão",cl:"nowrap",v:function(p){ return esc(p.previsao||"—"); }},
          {ch:"Itens",cl:"nowrap",v:function(p){ return esc(String(p.itens||0)); }},
          {ch:"Para entrega",cl:"nowrap",v:function(p){ return '<b>'+esc(String(p.itens_saldo||0))+'</b>'; }},
          {ch:"Total",cl:"nowrap",v:function(p){ return esc(moeda(p.valor)); }},
          {ch:"Saldo",cl:"nowrap",v:function(p){ return esc(moeda(p.saldo)); }},
          {ch:"Situação",cl:"nowrap",v:function(p){ return '<span class="selo aberto">'+esc(p.situacao||"aberto")+'</span>'; }},
          {ch:"",cl:"nowrap",w:"44px",v:function(p){
              return '<button class="olho" data-pedido="'+esc(p.id)+'" title="Ver pedido">'+IC.olho+'</button>'; }}
        ], l, {});
      }
      el("pagina").innerHTML=h+'</div>';
    });
  }

  // ============================================================
  // DETALHES DA AGENDA — UM componente, chamado de todo lugar
  // ============================================================
  var detCache=null, detAba="informacoes";

  // aba: em que aba abrir. Serve para VOLTAR para onde a pessoa estava depois de
  // uma pergunta de confirmação — que fecha este modal, porque o portal tem um
  // lugar de modal só (o uiModal fecha o que estiver aberto antes de abrir).
  function abrirDetalhe(id, aba){
    detAba=aba||"informacoes";
    var c=uiModal({titulo:"Detalhes do agendamento", cru:true, corpo:'<div id="detCorpo">'+uiCarregando()+'</div>'});
    SB.rpc("forn_agenda",{p_id:id}).then(function(r){
      var d=(r&&r.data)||{};
      if(!d.ok){
        el("detCorpo").innerHTML='<div class="mcorpo">'+uiErro(d.erro||"Não consegui abrir esta entrega.")+'</div>';
        return;
      }
      detCache=d;
      pintarDetalhe();
    });
  }

  var ABAS=[["informacoes","Informações"],["notas","Notas Fiscais"],["pedidos","Pedidos"],
            ["observacoes","Observações"],["anexos","Anexos"],["devolucoes","Devoluções"]];

  function pintarDetalhe(){
    var d=detCache; if(!d) return;
    var pC=partes(d.confirmada||d.quando)||{curta:"",hora:""};
    var podeMexer = d.situacao==="solicitada" || d.situacao==="confirmada";

    var h='<div class="det-cab">'+
      '<div class="quem"><b>'+esc(d.fornecedor||meuNome)+'</b>'+
      '<span>'+esc(d.local||"Santa Rita")+(d.doca?" · "+esc(d.doca):"")+'</span></div>'+
      '<div class="par"><span class="ic">'+IC.cal+'</span><div><label>Data</label>'+
        '<div>'+esc(pC.curta)+'<br>'+esc((pC.hora||"")+(d.confirmada_ate?" – "+d.confirmada_ate:""))+'</div></div></div>'+
      '<div class="par"><span class="ic">'+IC.tag+'</span><div><label>Ticket</label>'+
        '<div>'+esc(d.ticket)+'</div></div></div>'+
      '<div class="fim">'+uiSelo(d.situacao)+'</div></div>';

    h+='<div class="det-corpo"><div class="det-main">';
    h+='<div class="abas">';
    for(var i=0;i<ABAS.length;i++){
      h+='<button data-aba="'+ABAS[i][0]+'"'+(detAba===ABAS[i][0]?' class="on"':'')+'>'+ABAS[i][1]+'</button>';
    }
    h+='</div><div id="detAba">'+corpoAba()+'</div></div>';

    h+='<div class="det-lado">'+
       '<button data-acao-det="comprovante">'+IC.imprimir+'Imprimir comprovante</button>'+
       '<button data-acao-det="remarcar"'+(podeMexer?"":" disabled")+'>'+IC.remarcar+'Reagendamento</button>'+
       '<button class="perigo" data-acao-det="cancelar"'+(podeMexer?"":" disabled")+'>'+IC.cancelar+'Cancelar agendamento</button>'+
       (podeMexer?'':'<div class="dica" style="margin-top:8px">Este agendamento não pode mais ser alterado por aqui. Fale com a loja.</div>')+
       '</div></div>';

    el("detCorpo").innerHTML=h;

    [].slice.call(el("detCorpo").querySelectorAll("[data-aba]")).forEach(function(b){
      b.onclick=function(){
        detAba=b.getAttribute("data-aba");
        [].slice.call(el("detCorpo").querySelectorAll("[data-aba]")).forEach(function(x){
          x.classList.toggle("on", x.getAttribute("data-aba")===detAba);
        });
        el("detAba").innerHTML=corpoAba();
      };
    });
    [].slice.call(el("detCorpo").querySelectorAll("[data-acao-det]")).forEach(function(b){
      b.onclick=function(){
        var a=b.getAttribute("data-acao-det");
        if(a==="comprovante") comprovante(detCache);
        if(a==="cancelar")    cancelarAgenda(detCache);
        if(a==="remarcar")    remarcar(detCache);
      };
    });

    // UM ouvinte só, na caixa da aba. Trocar de aba só troca o conteúdo de
    // dentro (#detAba continua o mesmo elemento), então botão criado depois
    // continua funcionando — se eu ligasse botão por botão, ao voltar para a
    // aba Anexos os cliques morreriam sem erro nenhum na tela.
    var cxAba=el("detAba");
    if(cxAba) cxAba.onclick=function(ev){
      var b=ev.target && ev.target.closest ? ev.target.closest("[data-ax]") : null;
      if(!b) return;
      var a=b.getAttribute("data-ax");
      if(a==="ver")   verAnexo(b.getAttribute("data-id"));
      if(a==="tirar") tirarAnexo(b.getAttribute("data-id"), b.getAttribute("data-nome"));
      if(a==="add")   anexarNoDetalhe();
      if(a==="tipo"){ axTipoEsc=b.getAttribute("data-t"); el("detAba").innerHTML=corpoAba(); }
    };
  }

  function corpoAba(){
    var d=detCache, h="", i;
    if(detAba==="informacoes"){
      var campos=[
        ["Solicitante", d.solicitante],
        ["Fornecedor", d.fornecedor],
        ["CNPJ", d.cnpj?cnpjFmt(d.cnpj):""],
        // guardamos o CNPJ; o nome da transportadora ainda não tem cadastro
        ["Transportadora", d.transportadora || (d.transportadora_cnpj?cnpjFmt(d.transportadora_cnpj):"")],
        ["Local de entrega", d.local],
        ["Endereço", d.endereco],
        ["Doca", d.doca],
        ["Horário solicitado", quandoTxt(d.solicitada, d.solicitada_ate)],
        ["Horário confirmado", d.confirmada?quandoTxt(d.confirmada, d.confirmada_ate):""],
        ["Duração prevista", d.minutos?d.minutos+" min":""],
        ["Tipo de carga", d.tipo_carga],
        ["Tipo de volume", d.tipo_volume],
        ["Qtd. de volumes", d.qtd_volumes?numero(d.qtd_volumes):""],
        ["Peso", d.peso_kg?numero(d.peso_kg)+" kg":""],
        ["Tipo de caminhão", d.tipo_veiculo],
        ["Placa", d.placa],
        ["Motorista", d.motorista],
        ["Telefone do motorista", d.motorista_fone],
        ["Chegou", d.chegada_real],
        ["Tempo de descarga", d.minutos_reais?d.minutos_reais+" min":""]
      ];
      h+='<div class="campos">';
      var mostrou=0;
      for(i=0;i<campos.length;i++){
        if(!campos[i][1]) continue;
        mostrou++;
        h+='<div class="campo"><label>'+esc(campos[i][0])+'</label><div>'+esc(campos[i][1])+'</div></div>';
      }
      h+='</div>';
      if(!mostrou) h+='<div style="color:var(--txt2);font-size:13px">Sem informações cadastradas.</div>';
      if(d.motivo){
        h+='<div class="erro-cx" style="margin:16px 0 0"><b>Motivo:</b> '+esc(d.motivo)+'</div>';
      }
      if(d.historico&&d.historico.length){
        var ACOES={criou:"Horário pedido",solicitou:"Horário pedido",confirmou:"Confirmado pela loja",
                   recusou:"Recusado pela loja",cancelou:"Cancelado",iniciou:"Descarga iniciada",
                   concluiu:"Recebido",faltou:"Não compareceu",reagendou:"Remarcado",documento:"Documento"};
        h+='<div style="margin-top:22px"><label style="display:block;font-size:10.5px;color:var(--txt3);'+
           'text-transform:uppercase;letter-spacing:.04em;font-weight:800;margin-bottom:10px">O que aconteceu</label>'+
           '<ul class="hist">';
        for(i=0;i<d.historico.length;i++){
          var ev=d.historico[i];
          h+='<li><b>'+esc(ACOES[ev.acao]||ev.acao)+'</b>'+
             (ev.acao==="reagendou"&&ev.de?'de '+esc(ev.de)+' para '+esc(ev.para)+' · ':'')+
             (ev.motivo?esc(ev.motivo)+' · ':'')+esc(ev.em)+'</li>';
        }
        h+='</ul></div>';
      }
      return h;
    }

    if(detAba==="notas"){
      var nfs=d.notas_fiscais||[];
      if(!nfs.length) return uiVazio({ic:IC.papel,titulo:"Nenhuma nota fiscal",
        texto:"Este agendamento foi marcado sem nota fiscal. O envio de XML da NF-e ainda não foi liberado pela loja."});
      // Uma nota por bloco, com os produtos dela logo abaixo. Tabela seca não
      // serve aqui: quem recebe quer ver O QUE vem, não só quanto custou.
      for(i=0;i<nfs.length;i++){
        var nf=nfs[i], its=nf.itens||[];
        h+='<div class="bloco" style="margin-bottom:12px;box-shadow:none">'+
           '<div class="bloco-cab"><div><b>Nota '+esc(nf.numero||"—")+'</b>'+
           (nf.serie?'<span class="par"> · série '+esc(nf.serie)+'</span>':'')+
           (nf.emissao?'<span class="par"> · '+esc(nf.emissao)+'</span>':'')+
           '</div><b>'+esc(moeda(nf.valor))+'</b></div>'+
           '<div class="bloco-corpo">'+
           '<div class="campos" style="grid-template-columns:repeat(2,minmax(0,1fr));margin-bottom:'+(its.length?'14px':'0')+'">'+
           (nf.emitente?'<div class="campo"><label>Emitente</label><div>'+esc(nf.emitente)+'</div></div>':'')+
           (nf.volumes?'<div class="campo"><label>Volumes</label><div>'+esc(numero(nf.volumes))+
               (nf.especie?' '+esc(nf.especie):'')+'</div></div>':'')+
           (nf.peso_bruto?'<div class="campo"><label>Peso bruto</label><div>'+esc(numero(nf.peso_bruto))+' kg</div></div>':'')+
           (nf.transportadora?'<div class="campo"><label>Transportadora na nota</label><div>'+esc(nf.transportadora)+'</div></div>':'')+
           '<div class="campo" style="grid-column:1/-1"><label>Chave</label>'+
           '<div style="font-size:12px;word-break:break-all;font-weight:500">'+esc(nf.chave||'—')+'</div></div>'+
           '</div>';
        if(its.length){
          h+='<label style="display:block;font-size:10.5px;color:var(--txt3);text-transform:uppercase;'+
             'letter-spacing:.04em;font-weight:800;margin-bottom:7px">O que vem nesta nota — '+
             its.length+(its.length>1?' produtos':' produto')+'</label>'+
             uiTabela([
               {ch:"Produto",v:function(x){ return '<span class="forte">'+esc(x.descricao||'—')+'</span>'+
                   ((x.codigo||x.ean)?'<span class="par">'+esc(x.codigo||'')+
                     (x.ean?' · '+esc(x.ean):'')+'</span>':''); }},
               {ch:"Qtd",cl:"nowrap",v:function(x){ return esc(numero(x.qtd))+' '+esc(x.unidade||''); }},
               {ch:"Unitário",cl:"nowrap",v:function(x){ return esc(moeda(x.valorUnit)); }},
               {ch:"Total",cl:"nowrap",v:function(x){ return esc(moeda(x.valor)); }}
             ], its, {});
        } else {
          h+='<div class="det">Esta nota foi informada só pela chave, então os produtos não vieram. '+
             'Mandando o arquivo XML, a lista aparece aqui.</div>';
        }
        h+='</div></div>';
      }
      return h;
    }

    if(detAba==="pedidos"){
      var pds=d.lista_pedidos||[];
      if(!pds.length) return uiVazio({ic:IC.caixa,titulo:"Nenhum pedido vinculado",
        texto:"Nenhum número de pedido foi informado neste agendamento."});
      return uiTabela([
        {ch:"Número",cl:"nowrap",v:function(p){ return '<span class="tick">'+esc(p.numero)+'</span>'; }},
        {ch:"Fornecedor",v:function(p){ return esc(p.fornecedor||meuNome); }},
        {ch:"Total",cl:"nowrap",v:function(p){ return p.total?esc(moeda(p.total)):'<span style="color:var(--txt3)">—</span>'; }}
      ], pds, {});
    }

    if(detAba==="observacoes"){
      var rec=d.recados||[];
      if(!rec.length) return uiVazio({ic:IC.balao,titulo:"Nenhum recado",
        texto:"Quando a loja deixar um recado sobre esta entrega, ele aparece aqui."});
      for(i=0;i<rec.length;i++){
        h+='<div class="recado">'+esc(rec[i].texto)+
           '<span>'+esc(rec[i].autor||"Santa Rita")+' · '+esc(rec[i].em)+'</span></div>';
      }
      return h;
    }

    if(detAba==="anexos"){
      // Anexar na etapa 3 resolve o caso normal. Mas a loja pode pedir um papel
      // DEPOIS de confirmar — e sem esta aba o fornecedor mandaria por WhatsApp,
      // fora do registro, e ninguém saberia depois se ele mandou ou não.
      var ax=d.anexos||[];
      var axMexe=(d.situacao==="solicitada"||d.situacao==="confirmada");
      h="";
      if(!ax.length){
        h+=uiVazio({ic:IC.clipe,titulo:"Nenhum arquivo anexado",
          texto: axMexe
            ? "Se a loja pedir algum documento para esta entrega, anexe aqui."
            : "Nada foi anexado a esta entrega."});
      } else {
        h+=uiTabela([
          {ch:"Arquivo",v:function(a){ return esc(a.nome||"arquivo"); }},
          {ch:"Tipo",cl:"nowrap",v:function(a){ return esc(docRotulo(a.tipo)); }},
          {ch:"Tamanho",cl:"nowrap",v:function(a){ return a.tamanho?esc(docTam(a.tamanho)):"—"; }},
          {ch:"Enviado em",cl:"nowrap",v:function(a){ return esc(a.em||""); }},
          {ch:"",cl:"nowrap",v:function(a){
            return '<div class="ax-acs">'+
              '<button class="ax-bt" data-ax="ver" data-id="'+esc(a.id)+'">Abrir</button>'+
              (axMexe
                ? '<button class="ax-bt so-ic" data-ax="tirar" data-id="'+esc(a.id)+'" '+
                  'data-nome="'+esc(a.nome||"")+'" title="Tirar da lista">'+IC.lixo+'</button>'
                : '')+
              '</div>';
          }}
        ], ax, {});
      }
      if(axMexe){
        h+='<div class="ax-pe">'+
           '<div class="doc-tipos ax-tipos">';
        for(i=0;i<DOC_TIPOS.length;i++){
          h+='<button'+(axTipoEsc===DOC_TIPOS[i][0]?' class="on"':'')+
             ' data-ax="tipo" data-t="'+DOC_TIPOS[i][0]+'">'+esc(DOC_TIPOS[i][1])+'</button>';
        }
        h+='</div>'+
           '<button class="ax-add" data-ax="add">'+IC.clipe+'Anexar arquivo</button>'+
           '<span class="dica">PDF, JPG, PNG ou WEBP · até '+docTam(DOC_MAX)+
           ' cada · no máximo '+DOC_QTD+' arquivos</span></div>';
      }
      return h;
    }

    if(detAba==="devolucoes"){
      // Devolução ainda não tem regra definida pela loja. Em vez de inventar uma
      // tela que promete o que o sistema não faz, a aba diz a verdade.
      return uiVazio({ic:IC.devolucao,titulo:"Devoluções ainda não estão no portal",
        texto:"A loja ainda não definiu como as devoluções vão funcionar por aqui. "+
              "Enquanto isso, trate a devolução direto com o setor de recebimento."});
    }
    return "";
  }

  // ============================================================
  // ANEXOS DE UM AGENDAMENTO JÁ CRIADO
  // ============================================================
  var axTipoEsc="documento";

  // Volta para o detalhe na aba Anexos, com a lista relida do servidor.
  //
  // Um caminho só, de propósito. Eu tinha escrito um "redesenha por cima" para
  // quando o modal ainda está aberto e este para quando não está — e o primeiro
  // estourava calado, porque a pergunta de confirmação já tinha jogado o modal
  // fora. Reabrir sempre custa um piscar de olhos e não tem como dar errado.
  function voltarProsAnexos(agenda){
    if(agenda) abrirDetalhe(agenda, "anexos");
  }

  function verAnexo(id){
    // A aba tem que ser aberta AGORA, dentro do clique. Se eu esperasse a
    // resposta do servidor para chamar window.open, o navegador trataria como
    // pop-up e bloquearia: o fornecedor clicaria em Abrir e nada aconteceria.
    var aba=null;
    try{ aba=window.open("","_blank"); }catch(e){}
    function desistir(msg){
      if(aba){ try{ aba.close(); }catch(e){} }
      uiAviso("Não consegui abrir", msg);
    }
    SB.rpc("forn_anexo_ver",{p_id:id}).then(function(r){
      var v=(r&&r.data)||{};
      if(r.error||!v.ok){ return desistir((r.error?r.error.message:v.erro)||"Tente de novo."); }
      // link que morre em 60 segundos: o arquivo não tem endereço permanente
      SB.storage.from("recebimento").createSignedUrl(v.caminho,60).then(function(s){
        var u=s&&s.data&&s.data.signedUrl;
        if(!u){ return desistir("O arquivo não está mais no cofre. Fale com a loja."); }
        if(aba){ aba.location.href=u; return; }
        // Pop-up bloqueado. O link vai DENTRO da aba, não num modal: o portal
        // tem um lugar de modal só, então abrir um aqui jogaria fora o detalhe
        // do agendamento e ele voltaria para a lista sem entender por quê.
        // Clique dele num link o navegador não bloqueia.
        var cx=el("detAba"); if(!cx) return;
        var av=cx.querySelector(".ax-link"); if(av) cx.removeChild(av);
        var cai=document.createElement("div");
        cai.className="ax-link";
        cai.innerHTML='<span>O navegador bloqueou a abertura automática.</span>'+
          '<a class="ax-bt" target="_blank" rel="noopener" href="'+esc(u)+'">Abrir '+
          esc(v.nome||"arquivo")+'</a>'+
          '<span class="dica">o link vale 1 minuto</span>';
        cx.insertBefore(cai, cx.firstChild);
      }, function(){ desistir("Falha ao pedir o link do arquivo."); });
    }, function(){ desistir("Falha ao falar com o servidor."); });
  }

  function tirarAnexo(id, nome){
    // guardo o número da agenda ANTES: a pergunta fecha este modal e leva o
    // detalhe com ela
    var agenda=detCache&&detCache.id;
    uiConfirmar({titulo:"Tirar este arquivo da lista?",
      texto:(nome?'“'+nome+'”':"O arquivo")+" deixa de aparecer nesta entrega. "+
            "Se a loja pediu este documento, você precisa anexar outro no lugar.",
      sim:"Sim, tirar", nao:"Voltar", perigo:true
    }).then(function(res){
      // clicou em Voltar: reabro também. Sem isto, desistir de tirar o arquivo
      // jogaria o fornecedor fora do agendamento, e ele acharia que travou.
      if(!res) return voltarProsAnexos(agenda);
      SB.rpc("forn_anexo_tirar",{p_id:id}).then(function(r){
        var v=(r&&r.data)||{};
        if(r.error||!v.ok){
          uiAviso("Não consegui tirar",(r.error?r.error.message:v.erro)||"Tente de novo.");
        } else {
          uiToast("Arquivo tirado da lista.");
        }
        voltarProsAnexos(agenda);
      }, function(){
        uiAviso("Não consegui tirar","Falha ao falar com o servidor.");
        voltarProsAnexos(agenda);
      });
    });
  }

  function anexarNoDetalhe(){
    var d=detCache; if(!d) return;
    var jaTem=(d.anexos||[]).length;
    if(jaTem>=DOC_QTD){
      uiAviso("Já são "+DOC_QTD+" arquivos","Tire algum da lista antes de anexar outro.");
      return;
    }
    var inp=document.createElement("input");
    inp.type="file"; inp.multiple=true;
    inp.accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp";
    inp.style.display="none";
    document.body.appendChild(inp);
    inp.onchange=function(){
      // mesma peneira da etapa 3 — uma conferência só para as duas telas
      var r=docPeneira(inp.files, jaTem, d.anexos||[]);
      try{ document.body.removeChild(inp); }catch(e){}
      if(r.erros.length){
        uiAviso(r.erros.length===1?"Não consegui usar este arquivo":("Não consegui usar "+r.erros.length+" arquivos"),
                "", {lista:r.erros});
      }
      if(!r.ok.length) return;
      for(var i=0;i<r.ok.length;i++) r.ok[i].tipo=axTipoEsc;
      uiToast(r.ok.length===1?"Enviando 1 arquivo…":("Enviando "+r.ok.length+" arquivos…"));
      var agenda=d.id;
      subirDocumentos(agenda, r.ok, {depois:function(){ voltarProsAnexos(agenda); }});
    };
    inp.click();
  }

  function cancelarAgenda(d){
    uiConfirmar({ titulo:"Cancelar este agendamento?",
      texto:"O ticket "+d.ticket+" será cancelado e o horário volta a ficar livre para outros fornecedores. Não dá para desfazer.",
      campo:"Por que está cancelando? (opcional)", dica:"Ex: o carregamento atrasou",
      sim:"Sim, cancelar", nao:"Voltar", perigo:true
    }).then(function(res){
      if(!res) return;
      SB.rpc("forn_cancelar_agenda",{p_id:d.id, p_motivo:res.motivo||null}).then(function(r){
        if(r.error||(r.data&&r.data.ok===false)){
          uiAviso("Não consegui cancelar",(r.error?r.error.message:(r.data&&r.data.erro))||"Tente de novo.");
          return;
        }
        uiFecharModal();
        uiToast("Agendamento cancelado.");
        contarAvisos();
        irPara(pagAtual);
      });
    });
  }

  function remarcar(d){
    // Reagendar = cancelar a atual e marcar outra. Enquanto a loja não define a
    // regra de remarcação (item em aberto), o portal explica isso em vez de
    // fingir que faz sozinho.
    uiConfirmar({ titulo:"Reagendar entrega",
      texto:"Para mudar o horário do ticket "+d.ticket+", cancele este agendamento e marque outro. "+
            "A remarcação direta ainda não foi liberada pela loja.",
      sim:"Cancelar e marcar outra", nao:"Voltar"
    }).then(function(res){
      if(!res) return;
      cancelarAgenda(d);
    });
  }

  // ============================================================
  // COMPROVANTE
  // ============================================================
  function comprovante(d){
    var pS=partes(d.solicitada), pC=partes(d.confirmada);
    var nfs=(d.notas_fiscais||[]).map(function(n){ return n.chave||n.numero||""; }).filter(Boolean);
    var pds=(d.lista_pedidos||[]).map(function(p){ return p.numero; }).filter(Boolean);

    function lin(r,v){ return '<tr><th>'+esc(r)+'</th><td>'+esc(v||"não informado")+'</td></tr>'; }

    var doc='<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">'+
      '<title>Comprovante '+esc(d.ticket)+'</title><style>'+
      '@page{size:A4;margin:16mm 15mm}'+
      'body{font-family:Arial,Helvetica,sans-serif;color:#1d2733;font-size:12px;margin:0}'+
      '.cab{display:flex;align-items:center;gap:14px;border-bottom:3px solid #157a35;padding-bottom:12px;margin-bottom:16px}'+
      '.cab img{width:56px;height:46px;object-fit:contain}'+
      '.cab h1{margin:0;font-size:17px;color:#0c5a26}'+
      '.cab p{margin:2px 0 0;font-size:11px;color:#69747f}'+
      '.cab .cod{margin-left:auto;text-align:right}'+
      '.cab .cod b{display:block;font-size:19px;letter-spacing:.02em}'+
      '.cab .cod span{font-size:10px;color:#69747f;text-transform:uppercase;letter-spacing:.06em}'+
      'h2{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#69747f;margin:18px 0 6px;'+
      'border-bottom:1px solid #e4e9ef;padding-bottom:4px}'+
      'table{width:100%;border-collapse:collapse}'+
      'th{text-align:left;width:180px;padding:5px 0;font-size:11px;color:#69747f;font-weight:600;vertical-align:top}'+
      'td{padding:5px 0;font-weight:700;vertical-align:top}'+
      '.destaque{background:#f4faf6;border:1px solid #c5e3ce;border-radius:8px;padding:12px 14px;margin:14px 0}'+
      '.destaque b{font-size:15px;color:#0c5a26}'+
      '.alerta{background:#fff4e5;border:1px solid #ffd9a8;border-radius:8px;padding:10px 13px;'+
      'margin:14px 0;font-size:11.5px;color:#9a5b12}'+
      '.pe{margin-top:24px;border-top:1px solid #e4e9ef;padding-top:10px;font-size:10.5px;color:#98a3ae}'+
      '</style></head><body>'+
      '<div class="cab"><img src="${LOGO}" alt="">'+
      '<div><h1>Comprovante de agendamento</h1>'+
      '<p>Supermercado Santa Rita · Caicó/RN</p></div>'+
      '<div class="cod"><span>Ticket</span><b>'+esc(d.ticket)+'</b></div></div>'+

      '<div class="destaque"><b>'+esc(TXT_SIT[d.situacao]||d.situacao).toUpperCase()+'</b><br>'+
      (d.confirmada
        ? 'Horário confirmado: <b>'+esc(pC?pC.curta:"")+' às '+esc(pC?pC.hora:"")+
          (d.confirmada_ate?' até '+esc(d.confirmada_ate):'')+'</b>'
        : 'Ainda aguardando a confirmação da loja.')+
      '</div>'+

      (d.confirmada && d.solicitada && String(d.confirmada).slice(0,16)!==String(d.solicitada).slice(0,16)
        ? '<div class="alerta">ATENÇÃO: a loja confirmou em horário diferente do solicitado. '+
          'Se não puder cumprir, cancele o agendamento pelo portal.</div>' : '')+

      '<h2>A entrega</h2><table>'+
      lin("Fornecedor", d.fornecedor)+
      lin("CNPJ", d.cnpj?cnpjFmt(d.cnpj):"")+
      ((d.transportadora||d.transportadora_cnpj)
         ?lin("Transportadora", d.transportadora||cnpjFmt(d.transportadora_cnpj)):"")+
      lin("Local de entrega", d.local)+
      (d.endereco?lin("Endereço", d.endereco):"")+
      (d.doca?lin("Doca", d.doca):"")+
      lin("Horário solicitado", pS?(pS.curta+" às "+pS.hora+(d.solicitada_ate?" até "+d.solicitada_ate:"")):"")+
      lin("Horário confirmado", pC?(pC.curta+" às "+pC.hora+(d.confirmada_ate?" até "+d.confirmada_ate:"")):"aguardando")+
      lin("Duração prevista", d.minutos?d.minutos+" minutos":"")+
      '</table>'+

      '<h2>A carga</h2><table>'+
      lin("Tipo de carga", d.tipo_carga)+
      lin("Tipo de volume", d.tipo_volume)+
      lin("Quantidade de volumes", d.qtd_volumes?numero(d.qtd_volumes):"")+
      lin("Peso", d.peso_kg?numero(d.peso_kg)+" kg":"")+
      lin("Notas fiscais", nfs.length?nfs.join("  ·  "):"")+
      lin("Pedidos", pds.length?pds.join("  ·  "):"")+
      '</table>'+

      '<h2>Motorista e veículo</h2><table>'+
      lin("Motorista", d.motorista)+
      lin("Telefone", d.motorista_fone)+
      lin("Tipo de caminhão", d.tipo_veiculo)+
      lin("Placa", d.placa)+
      '</table>'+

      '<div class="alerta" style="margin-top:18px">IMPORTANTE: o motorista deve estar presente no horário '+
      'confirmado. Apresente este comprovante na portaria.</div>'+

      '<div class="pe">Emitido pelo Portal do Fornecedor do Supermercado Santa Rita. '+
      'Acompanhe seus agendamentos em '+esc(location.origin+location.pathname)+'</div>'+
      '</body></html>';

    var f=el("impressora");
    f.srcdoc=doc;
    f.onload=function(){
      try{ f.contentWindow.focus(); f.contentWindow.print(); }
      catch(e){ uiAviso("Não consegui abrir a impressão",
        "Seu navegador bloqueou a janela de impressão. Libere as janelas para este site e tente de novo."); }
    };
  }

  // ============================================================
  // NOVA AGENDA — wizard de tela cheia
  // ============================================================
  var PASSOS=[{n:1,k:"nf",t:"Dados da entrega",ativo:true},
              // ativo vira true sozinho quando o fornecedor tem pedido em aberto
              {n:2,k:"pedidos",t:"Pedidos",ativo:false},
              // sempre ativa: anexar papel nao depende de nada da loja
              {n:3,k:"docs",t:"Documentos",ativo:true},
              {n:4,k:"agendamento",t:"Agendamento",ativo:true},
              // ativo vira true sozinho quando a loja cobra (ver pintarWizard)
              {n:5,k:"cobranca",t:"Cobrança",ativo:false},
              {n:6,k:"resumo",t:"Resumo",ativo:true}];

  var wz=null;

  // As opções que o fornecedor escolhe. Ficam aqui, num lugar só: mudar a
  // lista é mexer numa linha, não caçar pela tela inteira.
  var CARGAS=["Seca","Refrigerada","Congelada","Hortifrúti","Bebida",
              "Produto de limpeza","Outra"];
  var VOLUMES=["Paletizada","Caixaria (batida)","Fardo","Granel","Outra"];
  var VEICULOS=["Van / Furgão","Toco","Truck","Carreta","Bitrem",
                "Carro de passeio","Moto"];
  var TEMPOS=[[30,"30 minutos"],[60,"1 hora"],[90,"1 hora e 30"],
              [120,"2 horas"],[180,"3 horas"],[240,"4 horas"]];

  function opcoes(lista, escolhido){
    var h='<option value="">Escolha…</option>';
    for(var i=0;i<lista.length;i++){
      var v=lista[i], t=v, val=v;
      if(v instanceof Array){ val=v[0]; t=v[1]; }
      h+='<option value="'+esc(val)+'"'+(String(escolhido)===String(val)?' selected':'')+'>'+esc(t)+'</option>';
    }
    return h;
  }

  // Escolher o tipo é uma pergunta curta: cabe num quadrado. A tela cheia só
  // depois, quando começa o preenchimento de verdade.
  function abrirWizard(){
    var c=uiModal({ titulo:"Novo agendamento", tam:"medio", corpo:
      '<p style="margin:0 0 4px;font-size:15px;font-weight:800">Qual tipo de agendamento você deseja marcar?</p>'+
      '<p style="margin:0 0 16px;font-size:13px;color:var(--txt2)">Hoje a loja recebe agendamento de '+
      'entrega. Os outros tipos ainda não foram liberados.</p>'+
      '<div class="escolha">'+
        '<button data-tipo="entrega"><span class="ic">'+IC.caixa+'</span>'+
          '<span><b>Entrega</b><span>Quero agendar uma entrega na loja.</span></span></button>'+
        '<button disabled><span class="ic">'+IC.caminhao+'</span>'+
          '<span><b>Coleta</b><span>Ainda não liberado pela loja.</span></span></button>'+
        '<button disabled><span class="ic">'+IC.pessoa+'</span>'+
          '<span><b>Representante</b><span>Ainda não liberado pela loja.</span></span></button>'+
      '</div>' });
    var b=c.querySelector("[data-tipo]");
    if(b) b.onclick=function(){ uiFecharModal(); abrirEntrega(); };
  }

  function abrirEntrega(){
    wz={ etapa:"nf", tipo:"entrega", remetente:"fornecedor", transpCnpj:"",
         comNota:false, chaves:[], dia:"", hora:null, pedido:"", descricao:"",
         // o que chega e o que vem dentro
         minutos:60, tipoCarga:"", tipoVolume:"", qtdVolumes:"",
         tipoVeiculo:"", placa:"", motorista:"", motoristaFone:"",
         pesoTxt:"", peso:null, cobranca:null, ciente:false,
         pedidosLista:null, pedidosExtra:[], conf:null,
         docs:[], docTipo:"documento" };
    // O calendário é do assistente: assistente novo, calendário do zero.
    // Estas variáveis moram fora do wz e sobreviviam ao fechar a janela —
    // o fornecedor reabria e via as vagas de antes de ele próprio agendar.
    wzcAno=null; wzcMes=null; wzcVagas=null; wzcHoras=null;
    var d=document.createElement("div"); d.className="wz"; d.id="wz";
    d.innerHTML='<div class="wz-topo" id="wzTopo"></div>'+
      '<div class="wz-trilha"><ol id="wzTrilha"></ol></div>'+
      '<div class="wz-corpo"><div class="wz-main" id="wzMain"></div>'+
      '<div class="wz-lado" id="wzLado"></div></div>'+
      '<div class="wz-pe" id="wzPe"></div>';
    el("pilha").appendChild(d);
    document.body.style.overflow="hidden"; document.body.classList.add("com-wz");
    pintarWizard();
    // Busca os pedidos assim que o assistente abre: a etapa 2 só acende se
    // este fornecedor tiver pedido em aberto de verdade.
    SB.rpc("forn_pedidos").then(function(r){
      var d=(r&&r.data)||{};
      wz.pedidosLista = d.ok ? (d.pedidos||[]) : [];
      guardarPedidos(wz.pedidosLista);
      // A lista chega DEPOIS do assistente abrir. Quem largou o XML nesse meio
      // tempo nao tinha com o que casar — agora tem, entao tento de novo.
      vincularPeloXml();
      listarNotas();
      if(el("wz")) pintarWizard();
    }, function(){ if(wz) wz.pedidosLista=[]; });
  }
  function fecharWizard(){
    var d=el("wz"); if(!d) return;
    try{ el("pilha").removeChild(d); }catch(e){}
    document.body.style.overflow=""; document.body.classList.remove("com-wz"); wz=null;
  }

  function pintarWizard(){
    if(!wz) return;
    // a etapa 5 só existe na trilha quando existe cobrança de verdade
    for(var q=0;q<PASSOS.length;q++){
      if(PASSOS[q].k==="cobranca") PASSOS[q].ativo = !!wz.cobranca;
      if(PASSOS[q].k==="pedidos")  PASSOS[q].ativo = !!(wz.pedidosLista && wz.pedidosLista.length);
    }
    var passoAtual = wz.etapa==="agendamento" ? "agendamento"
                   : wz.etapa==="pedidos"  ? "pedidos"
                   : wz.etapa==="docs"     ? "docs"
                   : wz.etapa==="cobranca" ? "cobranca"
                   : (wz.etapa==="resumo" ? "resumo" : "nf");

    el("wzTopo").innerHTML=
      '<div class="marca"><img src="${LOGO}" alt="">Novo agendamento</div>'+
      '<button class="icone fechar" id="wzFechar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>';

    // A trilha marca o que já passou, onde estamos e o que vem. Etapa futura
    // fica legível de propósito: apagada demais parece quebrada.
    var ondeEstou = 0;
    for(var q=0;q<PASSOS.length;q++){ if(PASSOS[q].k===passoAtual) ondeEstou=q; }
    var VISTO='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
    var t="";
    for(var i=0;i<PASSOS.length;i++){
      // Só ganha o visto quem foi realmente preenchido. Etapa travada que o
      // fluxo pula não pode aparecer como concluída — seria mentira na tela.
      var p=PASSOS[i], atual=i===ondeEstou, feito=(i<ondeEstou) && p.ativo;
      if(i>0) t+='<li class="wz-liga'+(feito||atual?" feito":"")+'"></li>';
      t+='<li class="wz-p'+(feito?" feito":"")+(atual?" on":"")+(p.ativo?"":" travado")+'"'+
         (p.ativo?"":' title="Esta etapa ainda não foi liberada pela loja"')+'>'+
         '<i>'+(feito?VISTO:p.n)+'</i><b>'+esc(p.t)+'</b></li>';
    }
    el("wzTrilha").innerHTML=t;
    el("wzFechar").onclick=function(){
      uiConfirmar({titulo:"Sair sem marcar?",texto:"O que você preencheu vai ser perdido.",
                   sim:"Sair",nao:"Continuar",perigo:true}).then(function(r){ if(r) fecharWizard(); });
    };

    if(wz.etapa==="nf")               telaNF();
    else if(wz.etapa==="agendamento") telaAgendamento();
    else if(wz.etapa==="pedidos")     telaPedidos();
    else if(wz.etapa==="docs")        telaDocs();
    else if(wz.etapa==="cobranca")    telaCobranca();
    else if(wz.etapa==="resumo")      telaResumo();

    pintarResumoLado();
  }

  function pintarResumoLado(){
    // Valor conhecido fica em preto e forte; o que falta fica cinza e leve.
    // Assim dá pra ver o que ainda está pendente sem ler linha por linha.
    function bloco(ic,rot,val){
      var vago=!val;
      return '<div class="wz-res'+(vago?" vago":"")+'"><span class="ic">'+ic+'</span>'+
             '<div style="min-width:0"><label>'+esc(rot)+'</label>'+
             '<div>'+esc(val||"a definir")+'</div></div></div>';
    }
    var pDia=wz.dia?partes(wz.dia+"T00:00"):null;
    el("wzLado").innerHTML='<b class="tit">Resumo do agendamento</b>'+
      '<p class="tit2">Vai sendo preenchido conforme você avança.</p>'+
      bloco(IC.pessoa,"Remetente", wz.remetente==="transportadora"
              ? (wz.transpCnpj?("Transportadora · "+cnpjFmt(wz.transpCnpj)):"Transportadora")
              : meuNome)+
      bloco(IC.local,"Local de entrega", localDaLoja())+
      bloco(IC.papel,"Nota fiscal", wz.comNota
              ? (wz.chaves.length?(wz.chaves.length+(wz.chaves.length>1?" notas":" nota")):null)
              : "Sem nota fiscal")+
      bloco(IC.caixa,"Pedido", wz.pedido||null)+
      bloco(IC.caminhao,"Veículo", wz.tipoVeiculo
              ? (wz.tipoVeiculo + (wz.placa?" · "+wz.placa:"")) : null)+
      bloco(IC.caixa,"Carga", wz.tipoCarga
              ? (wz.tipoCarga + (wz.qtdVolumes?" · "+wz.qtdVolumes+" "+(wz.tipoVolume||"volumes"):"")) : null)+
      bloco(IC.cal,"Data e hora", pDia
              ?(pDia.curta+(wz.hora!==null
                 ? " às "+String(wz.hora).padStart(2,"0")+":00 ("+
                   (wz.minutos>=60?(wz.minutos/60)+"h":wz.minutos+" min")+")"
                 : ""))
              :null);
  }

  function telaNF(){
    el("wzMain").innerHTML=
      '<div class="wz-form">'+
      '<h3>Dados da entrega</h3>'+
      '<p class="subt">Informe os dados iniciais da carga para continuar com o agendamento.</p>'+

      '<div class="secao">'+
        '<label class="tit">Quem está enviando</label>'+
        '<p class="ajuda">A carga sai da sua empresa ou de uma transportadora contratada?</p>'+
        '<div class="seg" id="wzSeg">'+
          '<button data-rem="fornecedor"'+(wz.remetente!=="transportadora"?' class="on"':'')+'>Fornecedor</button>'+
          '<button data-rem="transportadora"'+(wz.remetente==="transportadora"?' class="on"':'')+'>Transportadora</button>'+
        '</div>'+
        '<div class="fld medio" id="wzCxCnpj" style="margin-top:14px;'+
          (wz.remetente==="transportadora"?"":"display:none")+'">'+
          '<label for="wzCnpj">CNPJ da transportadora *</label>'+
          '<input id="wzCnpj" type="text" inputmode="numeric" maxlength="18" placeholder="00.000.000/0000-00" value="'+esc(cnpjFmt(wz.transpCnpj))+'">'+
          '<div class="dica" id="wzCnpjDica"></div></div>'+
      '</div>'+

      '<div class="secao">'+
        '<label class="tit">Nota fiscal</label>'+
        '<p class="ajuda">A mercadoria já foi faturada?</p>'+
        '<div class="opc" id="wzOpc">'+
          '<button data-nota="sim"'+(wz.comNota?' class="on"':'')+'>'+
            '<span class="marca-r"></span>'+
            '<span class="txt"><b>Com nota fiscal</b><span>Enviar o XML da NF-e</span></span>'+
            '<span class="ico">'+IC.papel+'</span></button>'+
          '<button data-nota="nao"'+(wz.comNota?'':' class="on"')+'>'+
            '<span class="marca-r"></span>'+
            '<span class="txt"><b>Sem nota fiscal</b><span>Agendar antes da emissão</span></span>'+
            '<span class="ico">'+IC.cal+'</span></button>'+
        '</div>'+
        '<div id="wzNotaCx"></div>'+
      '</div>'+

      '<div class="secao" id="wzCarga"></div>'+
      '</div>';

    el("wzPe").innerHTML='<button class="bt fraco" id="wzVolta">← Voltar</button>'+
      '<button class="bt" id="wzAvanca">Continuar →</button>';

    [].slice.call(el("wzSeg").children).forEach(function(b){
      b.onclick=function(){
        wz.remetente=b.getAttribute("data-rem");
        [].slice.call(el("wzSeg").children).forEach(function(x){
          x.classList.toggle("on", x===b);
        });
        el("wzCxCnpj").style.display = wz.remetente==="transportadora" ? "" : "none";
        pintarResumoLado();
      };
    });
    el("wzCnpj").addEventListener("input", function(){
      this.value=cnpjFmt(this.value);
      wz.transpCnpj=cnpjLimpo(this.value);
      var d=wz.transpCnpj;
      if(d.length===14){
        var ok=cnpjValido(d);
        this.classList.toggle("ruim",!ok);
        el("wzCnpjDica").textContent = ok?"CNPJ conferido.":"Esse CNPJ não confere.";
        el("wzCnpjDica").className = "dica"+(ok?"":" erro");
      } else { this.classList.remove("ruim"); el("wzCnpjDica").textContent=""; }
      pintarResumoLado();
    });
    [].slice.call(el("wzOpc").children).forEach(function(b){
      b.onclick=function(){
        wz.comNota = b.getAttribute("data-nota")==="sim";
        [].slice.call(el("wzOpc").children).forEach(function(x){
          x.classList.toggle("on", x===b);
        });
        pintarNotaCx(); pintarResumoLado();
      };
    });
    el("wzVolta").onclick=function(){ fecharWizard(); abrirWizard(); };
    el("wzAvanca").onclick=function(){
      if(wz.remetente==="transportadora" && !cnpjValido(wz.transpCnpj)){
        uiAviso("Falta o CNPJ da transportadora",
          "Você escolheu que a carga vem por transportadora. Informe o CNPJ dela para continuar.")
          .then(function(){ try{ el("wzCnpj").focus(); }catch(e){} });
        return;
      }
      if(wz.comNota){
        if(!wz.chaves.length){
          uiAviso("Falta a nota fiscal",
            "Mande o arquivo XML da nota ou digite a chave de 44 números. Se a mercadoria ainda "+
            "não foi faturada, escolha 'Sem nota fiscal'."); return;
        }
        // A loja decidiu em 15/08: a CHAVE já basta para agendar. Ela dá ao
        // recebimento o número da nota antes do caminhão chegar, e o papel
        // continua sendo conferido na chegada, como sempre foi. O arquivo XML
        // é melhor — traz valor, emitente e destinatário — mas não é exigido.
      }
      casarPedidosDaNota();

      // TODA NOTA PRECISA DE PEDIDO. Antes dava para seguir sem vincular, e a
      // nota chegava na loja sem ninguém saber o que era esperado dela — que é
      // justamente o problema que este portal existe para resolver.
      // Só cobro quando o fornecedor TEM pedido em aberto: sem pedido nenhum na
      // lista, não há como vincular e travar seria prender por nada.
      if(wz.comNota && wz.pedidosLista && wz.pedidosLista.length){
        var soltas=[];
        for(var s=0;s<wz.chaves.length;s++){
          if(!wz.chaves[s].vinc) soltas.push(String(wz.chaves[s].numero||("nota "+(s+1))));
        }
        if(soltas.length){
          uiAviso(soltas.length===1?"Falta vincular a nota ao pedido"
                                   :"Faltam vincular "+soltas.length+" notas ao pedido",
            soltas.length===1
              ? "Clique em “Vincular ao pedido” na linha da nota "+soltas[0]+" e escolha a que "+
                "pedido de compra ela se refere. É isso que diz à loja o que esperar do caminhão."
              : "Clique em “Vincular ao pedido” na linha de cada uma e escolha a que pedido de "+
                "compra ela se refere. É isso que diz à loja o que esperar do caminhão.",
            soltas.length>1 ? {lista:soltas.map(function(x){ return "Nota "+x; })} : undefined);
          return;
        }
      }

      // Se o fornecedor tem pedido em aberto, passa pela etapa 2. Quem não tem
      // vai direto para o agendamento e nem vê que a etapa existe.
      // as travas da loja sao conferidas AGORA, nao no ultimo clique
      checarCedo(el("wzAvanca"),
                 (wz.pedidosLista && wz.pedidosLista.length) ? "pedidos" : "docs");
    };
    pintarNotaCx();
  }

  var INFO='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';

  function pintarNotaCx(){
    var cx=el("wzNotaCx"), carga=el("wzCarga");
    if(!cx) return;

    if(!wz.comNota){
      // O texto fala só do que a loja faz hoje: confere na chegada. Vincular a
      // nota depois não existe no sistema — prometer isso seria inventar regra.
      cx.innerHTML='<div class="info"><span class="ic">'+INFO+'</span>'+
        '<div><b>Agendamento sem nota fiscal</b>'+
        '<p>Use esta opção quando a carga ainda não tiver sido faturada. '+
        'A loja confere os documentos na chegada do caminhão.</p></div></div>';

      if(carga) carga.innerHTML=
        '<label class="tit">Pedido de compra</label>'+
        '<p class="ajuda">Se a loja mandou um número de pedido, informe aqui.</p>'+
        '<div class="fld estreito"><label for="wzPedido">Número do pedido <span class="opt">(opcional)</span></label>'+
        '<input id="wzPedido" type="text" maxlength="40" placeholder="Ex.: 45231" value="'+esc(wz.pedido)+'"></div>'+
        '';

      if(el("wzPedido")) el("wzPedido").oninput=function(){ wz.pedido=this.value; pintarResumoLado(); };
      // a descrição saiu daqui: virou 'Observações' na etapa do veículo,
      // para existir também quando a entrega tem nota fiscal
      return;
    }

    if(carga) carga.innerHTML="";
    cx.innerHTML=
      '<div class="info" style="margin-top:12px"><span class="ic">'+INFO+'</span>'+
      '<div><b>Duas formas de informar a nota</b>'+
      '<p>Mande o <b>arquivo XML</b> — é o melhor jeito, porque o sistema lê valor, '+
      'emitente e destinatário sozinho. Se não tiver o arquivo em mãos, <b>digite a chave '+
      'de 44 dígitos</b>, que ela também serve.</p></div></div>'+

      '<div class="solta" id="wzSolta" style="margin-top:14px">'+
        '<b>Clique ou arraste os arquivos XML das notas fiscais</b>'+
        'O arquivo tem que ser o original da NF-e — não vale .zip'+
        '<input type="file" id="wzArq" accept=".xml,text/xml,application/xml" multiple '+
        'style="display:none"></div>'+

      '<div class="fld" style="margin-top:16px"><label for="wzChave">Chave da nota fiscal eletrônica</label>'+
      '<div style="display:flex;gap:9px;align-items:flex-start">'+
        '<div style="flex:1;min-width:0"><input id="wzChave" type="text" inputmode="numeric" '+
          'maxlength="54" placeholder="Os 44 números que ficam abaixo do código de barras da NF-e">'+
          '<div class="dica" id="wzChaveDica"></div></div>'+
        '<button class="bt fraco" id="wzAddNota" disabled style="flex:0 0 auto">Adicionar nota</button>'+
      '</div></div>'+
      '<div class="nf-lista" id="wzNfLista"></div>';

    var inp=el("wzChave"), bt=el("wzAddNota"), dica=el("wzChaveDica");
    ligarArquivo();

    function conferir(){
      var r=nfeChaveLer(inp.value);
      inp.classList.toggle("ruim", !r.ok && !r.vazia && nfeChaveLimpa(inp.value).length===44);
      bt.disabled=!r.ok;
      // Chave conferida: o botão fica verde. Cinza e clicável ao mesmo tempo não
      // avisa ninguém de que ainda falta um clique — a pessoa acha que já entrou.
      bt.classList.toggle("fraco", !r.ok);
      if(r.vazia){ dica.textContent=""; dica.className="dica"; return; }
      if(!r.ok){ dica.textContent=r.erro; dica.className="dica erro"; return; }
      // a chave conta de quem é, de quando e qual nota — antes de qualquer arquivo
      dica.innerHTML='Nota <b>'+esc(r.numero)+'</b> · série '+esc(r.serie)+
        ' · emitida em '+esc(r.emissao)+' ('+esc(r.uf)+')<br>CNPJ de quem emitiu: '+esc(cnpjFmt(r.cnpj))+
        (r.aviso?'<br><span style="color:var(--verm)">'+esc(r.aviso)+'</span>':'');
      dica.className="dica";
      dica.style.color="var(--verde-esc)";
    }

    inp.addEventListener("input", function(){
      var fim=this.selectionStart===this.value.length;
      this.value=nfeChaveFmt(this.value);
      if(fim){ try{ this.setSelectionRange(this.value.length,this.value.length); }catch(e){} }
      conferir();
    });
    inp.addEventListener("keydown", function(ev){
      if(ev.key==="Enter" && !bt.disabled){ ev.preventDefault(); bt.click(); }
    });

    bt.onclick=function(){
      var r=nfeChaveLer(inp.value);
      if(!r.ok) return;
      for(var i=0;i<wz.chaves.length;i++){
        if(wz.chaves[i].chave===r.chave){ uiAviso("Nota repetida","Essa nota fiscal já está na lista deste agendamento."); return; }
      }
      wz.chaves.push(r);
      inp.value=""; conferir();
      listarNotas(); pintarResumoLado();
    };

    listarNotas();
  }

  // Receber o arquivo: clique, arrastar e soltar, vários de uma vez.
  // A leitura acontece aqui só para o fornecedor ver na hora o que mandou —
  // quem CONFERE de verdade é o banco, porque a tela qualquer um contorna.
  function ligarArquivo(){
    var area=el("wzSolta"), arq=el("wzArq");
    if(!area||!arq) return;

    area.onclick=function(){ arq.click(); };
    ["dragenter","dragover"].forEach(function(e){
      area.addEventListener(e, function(ev){ ev.preventDefault(); area.classList.add("sobre"); });
    });
    ["dragleave","drop"].forEach(function(e){
      area.addEventListener(e, function(ev){ ev.preventDefault(); area.classList.remove("sobre"); });
    });
    area.addEventListener("drop", function(ev){
      if(ev.dataTransfer && ev.dataTransfer.files) engolirArquivos(ev.dataTransfer.files);
    });
    arq.onchange=function(){ engolirArquivos(arq.files); arq.value=""; };
  }

  var MAX_XML=3000000;   // 3 MB: uma NF-e tem uns 20 KB

  // Enquanto o banco não responde, mostra o que sempre valeu — melhor um
  // texto certo de ontem que um espaço em branco.
  function localDaLoja(){
    if(meuLocal && meuLocal.nome){
      return meuLocal.nome + (meuLocal.endereco ? " — " + meuLocal.endereco : "");
    }
    return "Loja Santa Rita — Caicó/RN";
  }
  function horarioDaLoja(){
    if(!meuLocal || !meuLocal.abre) return "A loja recebe de segunda a sexta, das 7h às 17h.";
    var d=meuLocal.dias||[1,2,3,4,5];
    var N=["","segunda","terça","quarta","quinta","sexta","sábado","domingo"];
    var faixa = (d.length && d[0] && d[d.length-1])
      ? ("de "+N[d[0]]+" a "+N[d[d.length-1]]) : "nos dias úteis";
    return "A loja recebe "+faixa+", das "+meuLocal.abre+" às "+meuLocal.fecha+".";
  }

  function engolirArquivos(lista){
    if(!lista||!lista.length) return;
    var pendentes=lista.length, achou=0, erros=[];
    for(var i=0;i<lista.length;i++){
      (function(f){
        if(/\\.zip$/i.test(f.name)){
          erros.push(f.name+": arquivo .zip não serve, mande o XML original.");
          if(--pendentes===0) fecharLeitura(achou,erros);
          return;
        }
        if(f.size>MAX_XML){
          erros.push(f.name+": grande demais para ser uma nota fiscal.");
          if(--pendentes===0) fecharLeitura(achou,erros);
          return;
        }
        var fr=new FileReader();
        fr.onload=function(){
          var r=nfeLerXml(String(fr.result||""));
          // A nota é para ESTA loja? Perguntar isso agora, e não no último
          // clique, poupa o fornecedor de preencher dia e hora à toa.
          if(r.ok && meuLocal && meuLocal.cnpj && r.destinoCnpj){
            var d1=String(r.destinoCnpj).replace(/[^0-9]/g,"");
            var d2=String(meuLocal.cnpj).replace(/[^0-9]/g,"");
            if(d1.length===14 && d1!==d2){
              r={ok:false, erro:"essa nota foi emitida para outra empresa ("+
                  (r.destinoNome||cnpjFmt(d1))+"), não para "+(meuLocal.nome||"a loja")+"."};
            }
          }
          if(!r.ok){ erros.push(f.name+": "+r.erro); }
          else {
            var rep=false;
            for(var k=0;k<wz.chaves.length;k++){ if(wz.chaves[k].chave===r.chave) rep=true; }
            if(rep) erros.push(f.name+": essa nota já está na lista.");
            else { r.xml=String(fr.result||""); r.arquivo=f.name; wz.chaves.push(r); achou++; }
          }
          if(--pendentes===0) fecharLeitura(achou,erros);
        };
        fr.onerror=function(){
          erros.push(f.name+": não consegui ler o arquivo.");
          if(--pendentes===0) fecharLeitura(achou,erros);
        };
        fr.readAsText(f);
      })(lista[i]);
    }
  }

  // Os pedidos de compra que apareceram dentro das notas lidas, sem repetir.
  function pedidosDasNotas(){
    var l=[];
    for(var i=0;i<wz.chaves.length;i++){
      var p=wz.chaves[i].pedidos||[];
      for(var j=0;j<p.length;j++){ if(l.indexOf(p[j])<0) l.push(p[j]); }
    }
    return l;
  }

  function fecharLeitura(achou, erros){
    // O fornecedor JÁ escreveu o pedido dentro da nota ao emitir. Pedir de novo
    // na mão era trabalho à toa — e na prática ele deixava em branco, então a
    // loja recebia o caminhão sem saber de que pedido era.
    // O vinculo sai AQUI, antes de desenhar a linha. Estava saindo na etapa 2,
    // tarde demais: a linha da nota ja tinha sido desenhada pedindo "Vincular"
    // e ficava assim, vermelha, com o pedido ja escolhido do lado direito.
    vincularPeloXml();
    listarNotas(); pintarResumoLado();
    // Sucesso é barra discreta; problema para a pessoa e pede um OK.
    // Vários arquivos com erro viram UM aviso com a lista, não três seguidos.
    if(achou) uiToast(achou===1?"1 nota fiscal lida.":(achou+" notas fiscais lidas."));
    if(erros.length){
      uiAviso(erros.length===1?"Não consegui usar este arquivo":"Não consegui usar "+erros.length+" arquivos",
              erros.length===1?"":"Veja o que aconteceu com cada um:",
              {lista:erros});
    }
  }

  function listarNotas(){
    var cx=el("wzNfLista"); if(!cx) return;
    if(!wz.chaves.length){ cx.innerHTML=""; return; }
    var h="";
    for(var i=0;i<wz.chaves.length;i++){
      var n=wz.chaves[i];

      // A COLUNA DO PEDIDO. Sem vinculo ela grita em vermelho, de proposito:
      // nota sem pedido chega na loja sem ninguem saber o que era esperado.
      var col;
      if(n.vinc){
        col='<div class="nf-ped ok">'+
            '<span class="rot">'+(n.vincAuto?"Pedido":"Pedido manual")+'</span>'+
            '<b>'+esc(n.vinc)+'</b>'+
            '<button class="icone" data-troca="'+i+'" title="Trocar o pedido">'+IC.lapis+'</button>'+
            '<button class="icone" data-desv="'+i+'" title="Desvincular">'+IC.x+'</button>'+
            '</div>';
      } else {
        col='<button class="nf-vinc" data-vinc="'+i+'">'+IC.alerta+'Vincular ao pedido</button>';
      }

      h+='<div class="nf-item"><span class="ic" style="color:var(--txt3)">'+IC.papel+'</span>'+
         '<div class="ch"><b>Nota '+esc(n.numero)+'</b> · série '+esc(n.serie)+' · '+esc(n.emissao)+
         (n.valor?' · '+esc(moeda(n.valor)):'')+
         (n.emitenteNome?'<br><span style="color:var(--txt2)">'+esc(n.emitenteNome)+'</span>':'')+
         ((n.itens&&n.itens.length)?'<br><span style="color:var(--txt2)">'+n.itens.length+
            (n.itens.length>1?' produtos':' produto')+
            (n.volumes?' · '+numero(n.volumes)+' volume'+(n.volumes>1?'s':''):'')+
            (n.pesoBruto?' · '+numero(n.pesoBruto)+' kg':'')+'</span>':'')+
         (n.xml?' <span class="selo confirmada" style="margin-left:6px">arquivo lido</span>':' <span class="selo concluida" style="margin-left:6px">pela chave</span>')+
         '<br><span style="color:var(--txt3);font-size:11.5px">'+esc(nfeChaveFmt(n.chave))+'</span></div>'+
         col+
         '<button class="icone" data-tira="'+i+'" title="Tirar da lista">'+IC.lixo+'</button></div>';
    }
    cx.innerHTML=h;
    function liga(attr, fn){
      [].slice.call(cx.querySelectorAll("["+attr+"]")).forEach(function(b){
        b.onclick=function(ev){ ev.preventDefault(); ev.stopPropagation();
          fn(parseInt(b.getAttribute(attr),10)); };
      });
    }
    liga("data-vinc",  abrirEscolhaPedido);
    liga("data-troca", abrirEscolhaPedido);
    liga("data-desv",  desvincularNota);
    liga("data-tira",  function(i){
      wz.chaves.splice(i,1);
      sincronizarPedidoTexto();
      listarNotas(); pintarResumoLado();
    });
  }

  function telaAgendamento(){
    el("wzMain").innerHTML=
      '<div class="wz-form">'+
      '<h3>Veículo, carga e horário</h3>'+
      '<p class="subt">Estes dados dizem à loja o que vai encostar na doca e quanto tempo vai levar.</p>'+

      '<div class="secao">'+
        '<label class="tit">Dados do veículo</label>'+
        '<p class="ajuda">Quem vai chegar na portaria.</p>'+
        '<div class="campos" style="grid-template-columns:repeat(2,minmax(0,1fr))">'+
          '<div class="fld" style="margin:0"><label for="wzPlaca">Placa *</label>'+
            '<input id="wzPlaca" type="text" maxlength="8" placeholder="ABC-1D23" value="'+esc(wz.placa)+'"></div>'+
          '<div class="fld" style="margin:0"><label for="wzVeic">Tipo de veículo *</label>'+
            '<select id="wzVeic">'+opcoes(VEICULOS, wz.tipoVeiculo)+'</select></div>'+
          '<div class="fld" style="margin:0"><label for="wzMot">Nome do motorista *</label>'+
            '<input id="wzMot" type="text" maxlength="80" placeholder="Quem vem dirigindo" value="'+esc(wz.motorista)+'"></div>'+
          '<div class="fld" style="margin:0"><label for="wzMotFone">Telefone para contato <span class="opt">(opcional)</span></label>'+
            '<input id="wzMotFone" type="tel" inputmode="tel" maxlength="20" placeholder="(84) 90000-0000" value="'+esc(wz.motoristaFone)+'"></div>'+
        '</div>'+
      '</div>'+

      '<div class="secao">'+
        '<label class="tit">A carga</label>'+
        '<p class="ajuda">Ajuda a loja a escalar quem recebe e a preparar o espaço.</p>'+
        '<div class="campos" style="grid-template-columns:repeat(4,minmax(0,1fr))">'+
          '<div class="fld" style="margin:0"><label for="wzCarga">Tipo de carga *</label>'+
            '<select id="wzCarga">'+opcoes(CARGAS, wz.tipoCarga)+'</select></div>'+
          '<div class="fld" style="margin:0"><label for="wzVol">Tipo de volume *</label>'+
            '<select id="wzVol">'+opcoes(VOLUMES, wz.tipoVolume)+'</select></div>'+
          '<div class="fld" style="margin:0"><label for="wzQtd">Qtd. de volumes *</label>'+
            '<input id="wzQtd" type="number" min="1" max="9999" placeholder="Ex.: 8" value="'+esc(wz.qtdVolumes)+'"></div>'+
          '<div class="fld" style="margin:0"><label for="wzPeso">Peso total (kg)'+
            (cobraPorPeso()?' *':' <span class="opt">(opcional)</span>')+'</label>'+
            '<input id="wzPeso" type="text" inputmode="decimal" placeholder="Ex.: 1.240,5" value="'+esc(wz.pesoTxt)+'"></div>'+
        '</div>'+
        (wz.chaves.length?'<div class="dica">Preenchemos o que a nota fiscal já declarou. Corrija se estiver diferente.</div>':'')+
      '</div>'+

      '<div class="secao">'+
        '<label class="tit">Tempo de descarga</label>'+
        '<p class="ajuda">Quanto tempo o caminhão fica na doca. É este tempo que fica reservado — '+
        'carga grande ocupa mais horários.</p>'+
        '<div style="display:grid;grid-template-columns:220px minmax(0,1fr);gap:16px;align-items:start">'+
          '<div class="fld" style="margin:0"><label for="wzMin">Tempo previsto *</label>'+
            '<select id="wzMin">'+opcoes(TEMPOS, wz.minutos)+'</select></div>'+
          '<div class="fld" style="margin:0"><label for="wzObs">Observações <span class="opt">(opcional)</span></label>'+
            '<textarea id="wzObs" class="baixa" rows="2" maxlength="300" placeholder="Algo que a loja precise saber antes de o caminhão chegar">'+esc(wz.descricao)+'</textarea>'+
            '<div class="dica">Ex.: carga precisa de empilhadeira, motorista chega mais cedo, produto frágil.</div></div>'+
        '</div>'+
      '</div>'+

      '<div class="secao">'+
        '<label class="tit">Quando</label>'+
        '<p class="ajuda">'+esc(horarioDaLoja())+'</p>'+
        '<div class="quando">'+
          '<div class="calx" id="wzCal"></div>'+
          '<div class="hcx" id="wzHoras"></div>'+
        '</div>'+
      '</div>'+
      '</div>';

    el("wzPe").innerHTML='<button class="bt fraco" id="wzVolta">← Voltar</button>'+
      '<button class="bt" id="wzAvanca">Continuar →</button>';

    // a nota fiscal já disse o tamanho da carga: aproveita, sem sobrescrever
    // o que o fornecedor tiver digitado
    if(!wz.qtdVolumes || !wz.tipoVolume){
      var vol=0, esp="";
      for(var k=0;k<wz.chaves.length;k++){
        vol += wz.chaves[k].volumes||0;
        if(!esp && wz.chaves[k].especie) esp=wz.chaves[k].especie;
      }
      if(!wz.qtdVolumes && vol>0){ wz.qtdVolumes=String(Math.round(vol)); el("wzQtd").value=wz.qtdVolumes; }
      if(!wz.pesoTxt){
        var pk=0;
        for(var q=0;q<wz.chaves.length;q++){ pk += parseFloat(wz.chaves[q].pesoBruto||0)||0; }
        // escreve no formato brasileiro para o campo poder ser lido de volta
        if(pk>0){ wz.peso=Math.round(pk*1000)/1000; wz.pesoTxt=numero(wz.peso,3);
                  if(el("wzPeso")) el("wzPeso").value=wz.pesoTxt; }
      }
      if(!wz.tipoVolume && esp){
        // "PALLET" na nota é "Paletizada" na nossa lista
        var achou = /PALLET|PALET/i.test(esp) ? "Paletizada"
                  : (/CAIXA|CX/i.test(esp) ? "Caixaria (batida)"
                  : (/FARDO|FD/i.test(esp) ? "Fardo" : ""));
        if(achou){ wz.tipoVolume=achou; el("wzVol").value=achou; }
      }
    }

    function liga(id, campo, transforma){
      var e=el(id); if(!e) return;
      e.oninput=e.onchange=function(){
        wz[campo]=transforma?transforma(this.value):this.value;
        if(transforma) this.value=wz[campo];
        pintarResumoLado();
      };
    }
    liga("wzVeic","tipoVeiculo"); liga("wzMot","motorista"); liga("wzMotFone","motoristaFone");
    liga("wzObs","descricao");
    liga("wzCarga","tipoCarga");  liga("wzVol","tipoVolume"); liga("wzQtd","qtdVolumes");
    // O texto do jeito que ele escreveu fica guardado; o número limpo anda
    // junto. Reescrever o campo enquanto a pessoa digita atrapalha quem
    // ainda não terminou de escrever a vírgula.
    (function(){ var e=el("wzPeso"); if(!e) return;
      e.oninput=function(){ wz.pesoTxt=this.value; wz.peso=pesoNum(this.value); pintarResumoLado(); };
    })();
    liga("wzPlaca","placa", function(v){ return String(v||"").toUpperCase().replace(/[^A-Z0-9-]/g,""); });

    el("wzMin").onchange=function(){
      wz.minutos=parseInt(this.value,10)||60;
      // Mudou o tempo, mudou quem cabe onde. Não é só a lista de horas do dia:
      // um dia que tinha vaga para 1h pode estar lotado para 3h, então as
      // bolinhas do mês inteiro também precisam ser refeitas.
      wz.hora=null; wzcVagas=null; wzcQuando(); pintarResumoLado();
    };
    el("wzVolta").onclick=function(){ wz.etapa="docs"; pintarWizard(); };
    el("wzAvanca").onclick=validarEtapa4;
    wzcQuando();
  }

  function validarEtapa4(){
    var falta=[];
    if(!wz.tipoVeiculo) falta.push("tipo de veículo");
    if(!wz.placa || wz.placa.replace(/[^A-Z0-9]/g,"").length<7) falta.push("placa");
    if(!wz.motorista) falta.push("nome do motorista");
    if(!wz.tipoCarga) falta.push("tipo de carga");
    if(!wz.tipoVolume) falta.push("tipo de volume");
    if(!(parseInt(wz.qtdVolumes,10)>0)) falta.push("quantidade de volumes");
    if(cobraPorPeso() && !(wz.peso>0)) falta.push("peso total da carga");
    if(!wz.dia) falta.push("dia da entrega");
    if(wz.hora===null) falta.push("horário de início");
    if(falta.length){
      uiAviso(falta.length===1?"Falta preencher um campo":"Faltam "+falta.length+" campos",
              "Para continuar, informe:", {lista:falta});
      return;
    }
    // A COBRANÇA MANDA NO CAMINHO.
    //
    // Quem decide se existe cobrança é o BANCO, não esta tela: ela pergunta
    // e obedece. Loja que não cobra (o padrão) nunca vê a etapa 5 — vai da 4
    // direto pro resumo, exatamente como sempre foi.
    SB.rpc("forn_cobranca_previa",{p_peso_kg: wz.peso}).then(function(r){
      var c=(r&&r.data)||null;
      wz.cobranca = (c && c.ativa && (parseFloat(c.total)||0)>0) ? c : null;
      wz.etapa = wz.cobranca ? "cobranca" : "resumo";
      pintarWizard();
    }, function(){
      // Não deu pra perguntar? Segue sem cobrança. A trava que vale é a do
      // servidor no envio — ele recusa se faltar a ciência.
      wz.cobranca=null; wz.etapa="resumo"; pintarWizard();
    });
  }

  // ============================================================
  // QUANDO — o calendário do mês e os horários do dia
  //
  // Antes: uma caixa de digitar data e uma fileira de horas. O fornecedor
  // escolhia o dia às cegas e só depois descobria se ainda cabia alguém —
  // aí voltava e tentava outro. O calendário responde antes de clicar:
  // bolinha verde é dia com horário livre, vermelha é dia lotado.
  //
  // Quem decide o que está livre é SEMPRE o banco. O navegador nunca recebe
  // a agenda dos outros fornecedores — só a contagem de vagas de cada dia.
  // ============================================================
  var wzcAno=null, wzcMes=null;  // mês que está na tela
  var wzcVagas=null;             // "AAAA-MM-DD" -> horários livres; null = ainda não sei
  var wzcPedidoM=0, wzcPedidoH=0; // resposta atrasada não pode pintar por cima da nova
  var wzcHoras=null;             // horários do dia escolhido

  // A loja agenda de hoje até 60 dias. É o mesmo limite que o banco aplica —
  // repetido aqui só para a tela não oferecer o que seria recusado depois.
  function wzcLimite(){ var f=new Date(); f.setDate(f.getDate()+60); return isoData(f); }

  // Repinta e rebusca TUDO. A lista de horas também: quem muda o tempo de
  // descarga muda as faixas ("07:00 - 08:00" vira "07:00 - 11:00") e muda
  // quem cabe. Deixar a lista velha na tela seria mostrar horário de 1h com
  // "4 horas de descarga" escrito logo acima.
  function wzcQuando(){
    wzcPintarMes(); wzcBuscarMes();
    wzcHoras=null; wzcPintarHoras(); wzcBuscarHoras();
  }

  // ---------- o mês ----------
  // Pergunta as vagas do mês de novo, TODA vez. Já teve cache aqui e ele
  // mentia dos dois lados: mostrava verde num dia que o próprio fornecedor
  // acabara de lotar, e — pior — mantinha vermelho e travado um dia que a
  // loja já tinha liberado, sem jeito de destravar a não ser trocando de mês.
  // Vaga de doca muda enquanto a pessoa preenche o formulário; guardar a
  // resposta antiga é guardar uma promessa que o banco não vai honrar.
  function wzcBuscarMes(){
    if(!el("wzCal")) return;
    var de=isoData(new Date(wzcAno, wzcMes, 1)), ate=mesUltimoDia(wzcAno, wzcMes);
    var hj=hojeIso(), lim=wzcLimite();
    if(de<hj) de=hj;
    if(ate>lim) ate=lim;
    if(de>ate){ wzcVagas={}; wzcPintarMes(); return; }
    var meu=++wzcPedidoM;
    SB.rpc("forn_dias_livres",{p_de:de, p_ate:ate, p_minutos:wz.minutos||60}).then(function(r){
      if(meu!==wzcPedidoM || !el("wzCal")) return;
      // Se a função ainda não existe no banco, o calendário continua servindo:
      // false quer dizer "não sei as vagas" — os dias seguem clicáveis, só
      // sem bolinha, e a verdade aparece na lista de horários ao clicar.
      // Objeto vazio seria outra coisa: "sei, e não tem dia nenhum".
      if(r && r.error){ wzcVagas=false; wzcPintarMes(); return; }
      var m={}, l=(r&&r.data)||[];
      for(var i=0;i<l.length;i++){ m[l[i].dia]=l[i].livres; }
      wzcVagas=m; wzcPintarMes();
    });
  }

  function wzcPintarMes(){
    var cx=el("wzCal"); if(!cx) return;
    if(wzcAno===null){
      var b=deIso(wz.dia)||new Date();
      wzcAno=b.getFullYear(); wzcMes=b.getMonth();
    }
    var hj=hojeIso(), lim=wzcLimite();
    var ant=mesAndar(wzcAno,wzcMes,-1), pro=mesAndar(wzcAno,wzcMes,1);
    // Seta que não leva a lugar nenhum engana: some com ela quando o mês
    // vizinho está todo no passado ou todo depois do prazo de 60 dias.
    var podeAnt = mesUltimoDia(ant.ano,ant.mes) >= hj;
    var podePro = isoData(new Date(pro.ano,pro.mes,1)) <= lim;

    var h='<div class="calx-topo"><b>'+esc(mesTitulo(wzcAno,wzcMes))+'</b>'+
          '<div class="calx-nav">'+
          '<button type="button" id="wzcAnt" title="Mês anterior"'+(podeAnt?"":" disabled")+'>&#8249;</button>'+
          '<button type="button" id="wzcPro" title="Próximo mês"'+(podePro?"":" disabled")+'>&#8250;</button>'+
          '</div></div><div class="calx-sem">';
    for(var w=0;w<7;w++){ h+='<span>'+DOW3[w]+'</span>'; }
    h+='</div><div class="calx-grade">';

    var casas=mesCasas(wzcAno,wzcMes), temBolinha=false;
    for(var i=0;i<casas.length;i++){
      var c=casas[i];
      if(c.fora){ h+='<div class="calx-d fora">'+c.dia+'</div>'; continue; }
      var vagas = (wzcVagas && wzcVagas.hasOwnProperty(c.iso)) ? wzcVagas[c.iso] : null;
      var motivo="";
      if(c.iso<hj)       motivo="Esse dia já passou.";
      else if(c.iso>lim) motivo="A loja agenda até "+partes(lim).curta+".";
      else if(wzcVagas && vagas===null) motivo="A loja não recebe nesse dia.";
      else if(vagas===0) motivo="Sem horário livre nesse dia para "+txtDuracao(wz.minutos||60)+" de descarga.";
      var off=!!motivo;
      h+='<div class="calx-d'+(off?" off":"")+(c.iso===hj?" hoje":"")+(c.iso===wz.dia?" sel":"")+'"'+
         ' data-dia="'+c.iso+'" title="'+esc(motivo||partes(c.iso).longa)+'">'+c.dia;
      if(vagas!==null && c.iso>=hj && c.iso<=lim){ temBolinha=true;
        h+='<i class="'+(vagas>0?"":"cheio")+'"></i>'; }
      h+='</div>';
    }
    h+='</div>';
    // Legenda só quando há bolinha para explicar.
    if(temBolinha) h+='<div class="calx-leg"><span><u></u>tem horário</span>'+
                      '<span><u class="cheio"></u>lotado</span></div>';
    cx.innerHTML=h;

    if(el("wzcAnt")) el("wzcAnt").onclick=function(){ wzcAndar(-1); };
    if(el("wzcPro")) el("wzcPro").onclick=function(){ wzcAndar(1); };
    [].slice.call(cx.querySelectorAll(".calx-d[data-dia]")).forEach(function(d){
      d.onclick=function(){
        if(d.classList.contains("off")) return;
        wz.dia=d.getAttribute("data-dia"); wz.hora=null;
        wzcHoras=null; wzcPintarMes(); wzcPintarHoras(); wzcBuscarHoras(); pintarResumoLado();
      };
    });
  }

  function wzcAndar(passo){
    var m=mesAndar(wzcAno,wzcMes,passo);
    wzcAno=m.ano; wzcMes=m.mes;
    // O mês novo tem vagas próprias: apagar antes evita pintar bolinha de
    // agosto em cima de setembro enquanto a resposta não chega.
    wzcVagas=null;
    wzcPintarMes(); wzcBuscarMes();
  }

  // ---------- os horários do dia ----------
  // Usa a MESMA palavra da lista de escolha: ler "1 hora e 30" no campo e
  // "1,5h" na mensagem logo abaixo faz duvidar se é a mesma coisa.
  function txtDuracao(min){
    for(var i=0;i<TEMPOS.length;i++){ if(TEMPOS[i][0]===min) return TEMPOS[i][1]; }
    return min>=60 ? (min/60)+"h" : min+" min";
  }

  function wzcBuscarHoras(){
    if(!wz.dia || !el("wzHoras")) return;
    var meu=++wzcPedidoH;
    SB.rpc("forn_horarios_livres",{p_data:wz.dia, p_minutos:wz.minutos||60}).then(function(r){
      if(meu!==wzcPedidoH || !el("wzHoras")) return;
      if(r && r.error){ wzcHoras=[]; wzcPintarHoras("Não consegui ver os horários desse dia."); return; }
      wzcHoras=(r&&r.data)||[];
      wzcPintarHoras();
    });
  }

  function wzcPintarHoras(erro){
    var cx=el("wzHoras"); if(!cx) return;
    var h='<h4>Horários disponíveis</h4>';
    if(!wz.dia){
      cx.innerHTML=h+'<p class="sub">Escolha um dia no calendário ao lado.</p>';
      return;
    }
    var pd=partes(wz.dia);
    h+='<p class="sub">'+esc(maiuscula(pd?pd.longa:wz.dia))+'<br>'+
       esc(txtDuracao(wz.minutos||60))+' de descarga</p>';

    if(erro){ cx.innerHTML=h+'<div class="hmsg">'+esc(erro)+'</div>'; return; }
    if(wzcHoras===null){ cx.innerHTML=h+'<div class="hmsg">Vendo os horários livres...</div>'; return; }
    if(!wzcHoras.length){ cx.innerHTML=h+'<div class="hmsg">A loja não recebe nesse dia.</div>'; return; }

    var livres=0;
    h+='<div class="hlista">';
    for(var i=0;i<wzcHoras.length;i++){
      var x=wzcHoras[i];
      if(x.livre) livres++;
      // O banco diz POR QUE não dá. Sem o porquê a pessoa acha que é sempre
      // fila cheia, quando às vezes é só a loja fechando antes.
      // Banco antigo não manda motivo nenhum: aí fica só riscado e calado,
      // como era antes. Chutar "(ocupado)" seria inventar uma fila que não
      // existe e mandar o fornecedor procurar outro dia à toa.
      var nota = x.livre ? "" : (x.motivo==="passou"  ? "(já passou)"
               : x.motivo==="fecha"   ? "(a loja fecha antes)"
               : x.motivo==="ocupado" ? "(ocupado)" : "");
      h+='<button type="button" class="hslot'+(x.livre?"":" ocup")+
         (wz.hora===x.h?" sel":"")+'" data-h="'+x.h+'"'+(x.livre?"":" disabled")+'>'+
         esc(faixaHora(x.hora,x.ate))+(nota?'<em>'+esc(nota)+'</em>':'')+'</button>';
    }
    h+='</div><div class="hmsg">'+(livres
        ? esc(livres+(livres>1?" horários livres":" horário livre")+" nesse dia")
        : esc("Nenhum horário desse dia comporta "+txtDuracao(wz.minutos||60)+" de descarga."))+'</div>';
    cx.innerHTML=h;

    [].slice.call(cx.querySelectorAll(".hslot[data-h]")).forEach(function(b){
      b.onclick=function(){
        if(b.classList.contains("ocup")) return;
        wz.hora=parseInt(b.getAttribute("data-h"),10);
        wzcPintarHoras(); pintarResumoLado();
      };
    });
  }
  // A ÚLTIMA TELA ANTES DE ENVIAR.
  //
  // Blocos por assunto, e não uma lista corrida: quem confere procura uma
  // coisa de cada vez ("a placa está certa?"), e achar é mais rápido quando
  // cada assunto tem seu quadro. As notas aparecem UMA A UMA — dizer só
  // "2 notas informadas" não deixa ninguém conferir se são as duas certas.
  // A loja cobra por peso? Se cobra, o campo de peso deixa de ser opcional —
  // sem ele a conta sairia zerada e a cobrança viraria só a taxa fixa.
  function cobraPorPeso(){
    return !!(meuLocal && meuLocal.cobranca && meuLocal.cobranca.ativa &&
              (parseFloat(meuLocal.cobranca.valor_tonelada)||0) > 0);
  }

  // ============================================================
  // ETAPA 5 — COBRANÇA DE DESCARGA
  //
  // Esta tela NÃO faz conta nenhuma. Descrição, quantidade, valor unitário
  // e total chegam prontos do banco e ela só imprime. É de propósito: se a
  // tela multiplicasse por conta própria, um dia ela e o banco discordariam
  // em um centavo — e um centavo de diferença entre o que apareceu e o que
  // foi cobrado é o que transforma conversa em discussão.
  // ============================================================
  function telaCobranca(){
    var c=wz.cobranca||{}, itens=c.itens||[];

    var linhas='';
    for(var i=0;i<itens.length;i++){
      var x=itens[i];
      linhas+='<tr><td><b>'+esc(x.descricao)+'</b></td>'+
              '<td class="n">'+esc(moeda(x.valor_unitario))+'</td>'+
              // sem casas forçadas: a linha da agenda vira "1" e não "1,000";
              // a do peso continua "84,387", porque o padrão já leva até 3 casas
              '<td class="n">'+esc(numero(x.quantidade))+(x.unidade?' '+esc(x.unidade):'')+'</td>'+
              '<td class="n"><b>'+esc(moeda(x.valor))+'</b></td></tr>';
    }

    el("wzMain").innerHTML=
      '<div class="wz-form larga">'+
      '<h3>Cobrança de descarga</h3>'+
      '<p class="subt">A loja cobra pela descarga do caminhão. Confira o valor previsto '+
      'antes de pedir o horário.</p>'+
      '<div class="cob">'+
        '<div class="cob-bloco"><h4>Serviços</h4>'+
          '<table class="cob-tab"><thead><tr>'+
          '<th>Descrição</th><th class="n">Valor por qtd.</th>'+
          '<th class="n">Quantidade</th><th class="n">Total</th>'+
          '</tr></thead><tbody>'+linhas+'</tbody></table>'+
        '</div>'+
        '<div class="cob-bloco">'+
          '<h4>Total</h4>'+
          '<p class="cob-total">Valor total previsto<b>'+esc(moeda(c.total))+'</b></p>'+
          (c.aviso?'<div class="cob-aviso">'+INFO+'<div>'+esc(c.aviso)+'</div></div>':'')+
          '<label class="cob-ciente"><input type="checkbox" id="wzCiente"'+(wz.ciente?' checked':'')+'>'+
          '<span>Estou ciente da cobrança de descarga</span></label>'+
        '</div>'+
      '</div></div>';

    el("wzPe").innerHTML='<button class="bt fraco" id="wzVolta">← Voltar</button>'+
      '<button class="bt" id="wzAvanca">Continuar →</button>';

    el("wzCiente").onchange=function(){ wz.ciente=this.checked; };
    el("wzVolta").onclick=function(){ wz.etapa="agendamento"; pintarWizard(); };
    el("wzAvanca").onclick=function(){
      // O botão podia ficar apagado até marcar, mas apagado não explica nada.
      // Aviso escrito diz o que falta. Quem recusa de verdade é o servidor.
      if(!wz.ciente){
        uiAviso("Falta confirmar", "Marque que você está ciente da cobrança de descarga para continuar.");
        return;
      }
      wz.etapa="resumo"; pintarWizard();
    };
  }

  // ============================================================
  // ETAPA 2 — PEDIDOS DE COMPRA
  //
  // O fornecedor diz a que pedido esta entrega se refere. Quem manda a nota
  // fiscal por XML nem precisa escolher: o número do pedido vem escrito
  // dentro dela (tag xPed) e a linha já aparece marcada.
  //
  // A etapa é OPCIONAL de propósito. Nem toda entrega tem pedido de compra
  // (bonificação, troca, acerto), e travar o agendamento por causa disso
  // pararia caminhão na portaria.
  // ============================================================
  // O número do pedido que veio DENTRO da nota fiscal (tag xPed) marca a
  // linha sozinho. É o mesmo que o sistema de referência faz: se o pedido
  // estava declarado no XML, ele já aparece vinculado; se não, a pessoa marca.
  // ============================================================
  // VINCULO NOTA -> PEDIDO
  //
  // Cada nota aponta para UM pedido. Antes o pedido era uma escolha do
  // agendamento INTEIRO: com duas notas de dois pedidos diferentes nao dava
  // para dizer qual era qual — marcava os dois e a loja adivinhava na doca.
  // ============================================================

  // A LISTA UNICA de pedidos do agendamento. Sai dos vinculos das notas mais
  // o que foi acrescentado na etapa 2 (agendamento sem nota fiscal). Toda tela
  // le daqui; nenhuma guarda a sua propria copia, senao um dia discordam.
  function pedidosDoAgendamento(){
    var l=[], i, v;
    for(i=0;i<wz.chaves.length;i++){
      v=String(wz.chaves[i].vinc||"");
      if(v && l.indexOf(v)<0) l.push(v);
    }
    for(i=0;i<(wz.pedidosExtra||[]).length;i++){
      v=String(wz.pedidosExtra[i]);
      if(v && l.indexOf(v)<0) l.push(v);
    }
    return l;
  }

  function pedidoPorNumero(n){
    var l=wz.pedidosLista||[];
    for(var i=0;i<l.length;i++) if(String(l[i].numero)===String(n)) return l[i];
    return null;
  }

  // O texto que vai para o servidor e para o resumo, sempre derivado da lista.
  function sincronizarPedidoTexto(){
    var l=pedidosDoAgendamento();
    wz.pedido = l.length ? l.join(", ").slice(0,40) : "";
    if(el("wzPedido")) el("wzPedido").value=wz.pedido;
  }

  // Depois de ler o XML: a propria nota diz de que pedido e (a tag xPed, que o
  // fornecedor preenche ao emitir). Se esse pedido esta entre os dele, o
  // vinculo sai sozinho e ele so confere.
  function vincularPeloXml(){
    for(var i=0;i<wz.chaves.length;i++){
      var n=wz.chaves[i];
      if(n.vinc) continue;
      var ps=(n.pedidos||[]).filter(function(x){ return !!pedidoPorNumero(x); });
      // Dois pedidos declarados na mesma nota: nao escolho por ele. Chutar um
      // seria pior que perguntar — o fornecedor clica em Vincular e decide.
      if(ps.length===1){ n.vinc=String(ps[0]); n.vincAuto=true; }
    }
    sincronizarPedidoTexto();
  }

  // A janela "Meus pedidos": a lista dele, com busca, um por linha.
  function abrirEscolhaPedido(idx){
    var n=wz.chaves[idx]; if(!n) return;
    var l=wz.pedidosLista||[];

    if(!l.length){
      uiAviso("Você não tem pedido em aberto",
        "Nenhum pedido de compra da loja para você está aguardando entrega. "+
        "Pode seguir sem vincular — o pedido não é obrigatório para agendar.");
      return;
    }

    var c=uiModal({titulo:"Meus pedidos", cru:true,
      corpo:'<div class="mcorpo">'+
        '<p class="subt" style="margin:0 0 12px">A que pedido se refere a nota '+
        esc(n.numero||"")+'?</p>'+
        '<input id="vpBusca" class="vp-b" type="text" placeholder="Procurar pelo número do pedido">'+
        '<div id="vpLista" class="vp-l"></div></div>'});

    // O QUE LIGA ESTA NOTA A ESTE PEDIDO.
    // A pergunta do Victor foi "como e que eu vou saber que essa nota e desse
    // pedido?". Numero, data e valor nao respondem. Quem responde e o produto:
    // quantos dos codigos de barras da nota estao dentro daquele pedido.
    // Quem conta e o banco (forn_casar_nota_pedidos), nunca a tela.
    var casou=null;           // {comparavel, itens_nota, porPedido{numero:{...}}}
    var apontados=(n.pedidos||[]).map(String);   // o que a propria nota declara

    function ordenar(v){
      return v.slice().sort(function(a,b){
        // 1) o pedido que a NOTA aponta vem primeiro: e o unico sinal exato
        var pa=apontados.indexOf(String(a.numero))>=0?1:0;
        var pb=apontados.indexOf(String(b.numero))>=0?1:0;
        if(pa!==pb) return pb-pa;
        // 2) depois, quantos produtos da nota estao no pedido
        var ca=(casou&&casou.porPedido[String(a.numero)]||{}).casaram||0;
        var cb=(casou&&casou.porPedido[String(b.numero)]||{}).casaram||0;
        if(ca!==cb) return cb-ca;
        return String(a.previsao||"").localeCompare(String(b.previsao||""));
      });
    }

    function selo(x){
      var num=String(x.numero);
      if(apontados.indexOf(num)>=0){
        return '<span class="vp-s forte">a nota aponta este pedido</span>';
      }
      if(!casou) return "";
      if(!casou.comparavel || !casou.itens_nota){
        return "";
      }
      var c=casou.porPedido[num]||{};
      if(!c.tem_ean) return '<span class="vp-s cinza">sem código de barras para comparar</span>';
      var q=c.casaram||0;
      if(!q) return '<span class="vp-s cinza">nenhum produto desta nota está neste pedido</span>';
      var cls=(q>=casou.itens_nota)?"forte":"meio";
      // concordancia: "1 dos 4 produtos ESTA", "3 dos 4 produtos ESTAO"
      return '<span class="vp-s '+cls+'">'+q+' dos '+casou.itens_nota+
             ' produtos desta nota '+(q===1?"está":"estão")+' neste pedido</span>';
    }

    function pinta(){
      var q=(el("vpBusca").value||"").trim().toLowerCase();
      var vis=ordenar(l.filter(function(x){ return !q || String(x.numero).toLowerCase().indexOf(q)>=0; }));
      var h="";

      // A tela precisa dizer a diferenca entre "comparei e nao casou" e "nao
      // tive com o que comparar". Sem isso, "0 de 16" nos dois casos faria ele
      // descartar justamente o pedido certo.
      if(casou && !casou.comparavel){
        h+='<div class="vp-nota">Ainda não consigo comparar os produtos da nota com os do '+
           'pedido — os códigos de barras dos pedidos estão sendo carregados. '+
           'Por enquanto, confira pelo número e pela data.</div>';
      } else if(casou && !casou.itens_nota){
        h+='<div class="vp-nota">Esta nota não trouxe código de barras nos produtos, '+
           'então não consigo comparar item a item.</div>';
      }

      if(!vis.length){
        h+='<p class="dica" style="padding:14px 2px">Nenhum pedido com esse número.</p>';
      }
      for(var i=0;i<vis.length;i++){
        var x=vis[i], on=String(n.vinc||"")===String(x.numero);
        h+='<div class="vp-i'+(on?" on":"")+'" data-num="'+esc(x.numero)+'">'+
           '<div class="vp-c"><b>Pedido '+esc(x.numero)+'</b>'+
             selo(x)+
             '<span>'+esc(String(x.itens_saldo||0))+' de '+esc(String(x.itens||0))+
             ' itens para entrega'+
             (x.previsao?' &middot; previsão '+esc(x.previsao):'')+
             (x.emissao?' &middot; pedido em '+esc(x.emissao):'')+'</span></div>'+
           '<div class="vp-v"><b>'+esc(moeda(x.saldo))+'</b><span>a entregar</span></div>'+
           '<button class="vp-ok" title="Vincular a este pedido">'+IC_OK+'</button></div>';
      }
      el("vpLista").innerHTML=h;
      [].slice.call(el("vpLista").querySelectorAll(".vp-i[data-num]")).forEach(function(e){
        e.onclick=function(){
          n.vinc=e.getAttribute("data-num");
          // marcado na mao: guardo isso porque vinculo manual erra mais que o
          // que veio escrito dentro da nota, e a loja merece saber a diferenca
          n.vincAuto=false;
          uiFecharModal();
          sincronizarPedidoTexto();
          listarNotas();
          pintarResumoLado();
          uiToast("Nota "+(n.numero||"")+" vinculada ao pedido "+n.vinc+".");
        };
      });
    }
    el("vpBusca").oninput=pinta;
    pinta();
    try{ el("vpBusca").focus(); }catch(e){}

    // A comparacao chega depois e a janela se redesenha. Abrir esperando pela
    // resposta deixaria a janela em branco por um segundo, e o fornecedor
    // clicaria no vazio.
    var itensNota=(n.itens||[]).map(function(t){ return {ean:t.ean||""}; });
    if(itensNota.length){
      SB.rpc("forn_casar_nota_pedidos",{p_itens:itensNota}).then(function(r){
        var d=(r&&r.data)||{};
        if(!d.ok) return;
        var por={};
        (d.pedidos||[]).forEach(function(x){ por[String(x.numero)]=x; });
        casou={comparavel:!!d.comparavel, itens_nota:d.itens_nota||0, porPedido:por};
        if(el("vpLista")) pinta();
      }, function(){});
    }
  }

  function desvincularNota(idx){
    var n=wz.chaves[idx]; if(!n) return;
    n.vinc=""; n.vincAuto=false;
    sincronizarPedidoTexto();
    listarNotas();
    pintarResumoLado();
  }

  // Marca, na lista da etapa 2, quais pedidos a nota declarou. A ESCOLHA em si
  // nao mora mais aqui: cada nota aponta para o seu pedido (vincularPeloXml).
  function casarPedidosDaNota(){
    var l=wz.pedidosLista||[]; if(!l.length) return;
    var daNota=pedidosDasNotas();
    for(var i=0;i<l.length;i++) l[i].daNota = daNota.indexOf(String(l[i].numero))>=0;
    vincularPeloXml();
  }

  // ============================================================
  // ETAPA 3 — DOCUMENTOS
  //
  // Os arquivos ficam AQUI no navegador até o agendamento existir. Guardar
  // antes seria guardar em pasta que ainda não tem dono.
  // ============================================================
  var DOC_TIPOS=[["documento","Documento"],["laudo","Laudo"],
                 ["certificado","Certificado"],["autorizacao","Autorização"],["outro","Outro"]];
  var DOC_MAX=8*1024*1024, DOC_QTD=10;

  function docTam(n){
    if(n<1024) return n+" B";
    if(n<1024*1024) return Math.round(n/1024)+" KB";
    return (n/1024/1024).toFixed(1).replace(".",",")+" MB";
  }

  function telaDocs(){
    var h='<div class="wz-form">'+
      '<h3>Documentos</h3>'+
      '<p class="subt">Se a loja pediu algum papel para esta entrega, anexe aqui. '+
      'É opcional — sem documento o agendamento segue normalmente.</p>'+
      '<div class="secao">'+
        '<label class="tit">Que tipo de documento</label>'+
        '<div class="doc-tipos" id="wzDocTipos">';
    for(var t=0;t<DOC_TIPOS.length;t++){
      h+='<button type="button" data-doctipo="'+DOC_TIPOS[t][0]+'"'+
         (wz.docTipo===DOC_TIPOS[t][0]?' class="on"':'')+'>'+esc(DOC_TIPOS[t][1])+'</button>';
    }
    h+='</div>'+
      '<div class="solta" id="wzDocSolta" style="margin-top:13px">'+
        '<b>Clique ou arraste os arquivos aqui</b>'+
        'PDF, JPG, PNG ou WEBP · até '+docTam(DOC_MAX)+' cada · no máximo '+DOC_QTD+' arquivos'+
      '</div>'+
      '<input type="file" id="wzDocFile" multiple accept=".pdf,.jpg,.jpeg,.png,.webp" style="display:none">';

    if(wz.docs.length){
      h+='<div class="doc-l">';
      for(var i=0;i<wz.docs.length;i++){
        var d=wz.docs[i];
        h+='<div class="doc-i"><span class="ic">'+IC.clipe+'</span>'+
           '<span class="nm">'+esc(d.nome)+'</span>'+
           '<span class="tm">'+esc(d.rotulo)+' · '+esc(docTam(d.tamanho))+'</span>'+
           '<button type="button" class="x" data-doctira="'+i+'" title="Tirar da lista">&times;</button>'+
           '</div>';
      }
      h+='</div>';
      h+='<div class="dica" style="margin-top:9px">Os arquivos sobem quando você pedir o horário.</div>';
    }
    h+='</div>';

    el("wzMain").innerHTML=h+'</div>';
    el("wzPe").innerHTML='<button class="bt fraco" id="wzVolta">← Voltar</button>'+
      '<button class="bt" id="wzAvanca">Continuar →</button>';

    [].slice.call(el("wzDocTipos").children).forEach(function(b){
      b.onclick=function(){ wz.docTipo=b.getAttribute("data-doctipo"); telaDocs(); };
    });
    var cx=el("wzDocSolta"), inp=el("wzDocFile");
    cx.onclick=function(){ inp.click(); };
    inp.onchange=function(){ docEngolir(inp.files); inp.value=""; };
    cx.ondragover=function(ev){ ev.preventDefault(); cx.classList.add("sobre"); };
    cx.ondragleave=function(){ cx.classList.remove("sobre"); };
    cx.ondrop=function(ev){ ev.preventDefault(); cx.classList.remove("sobre");
      docEngolir(ev.dataTransfer.files); };
    [].slice.call(el("wzMain").querySelectorAll("[data-doctira]")).forEach(function(b){
      b.onclick=function(){
        wz.docs.splice(parseInt(b.getAttribute("data-doctira"),10),1);
        telaDocs(); pintarResumoLado();
      };
    });

    el("wzVolta").onclick=function(){
      wz.etapa = (wz.pedidosLista && wz.pedidosLista.length) ? "pedidos" : "nf";
      pintarWizard();
    };
    el("wzAvanca").onclick=function(){ wz.etapa="agendamento"; pintarWizard(); };
  }

  // Confere ANTES de aceitar: tamanho, tipo e quantidade. Recusar aqui poupa
  // o fornecedor de preencher tudo e levar não no fim.
  // A PENEIRA DOS ARQUIVOS, NUM LUGAR SÓ.
  //
  // Duas telas anexam arquivo: a etapa 3 do agendamento e a aba Anexos de um
  // agendamento já criado. Se cada uma tivesse a sua conferência, um dia eu
  // mudaria o limite numa e esqueceria a outra — e o mesmo PDF levaria "sim"
  // numa tela e "não" na outra, sem ninguém entender por quê.
  //
  // Devolve o que passou e o que não passou, sem mexer em tela nenhuma. Quem
  // chamou decide o que fazer com cada lista.
  function docPeneira(lista, jaTem, existentes){
    var ok=[], erros=[];
    existentes=existentes||[];
    for(var i=0;i<lista.length;i++){
      var f=lista[i];
      if(jaTem+ok.length>=DOC_QTD){ erros.push("Só cabem "+DOC_QTD+" arquivos."); break; }
      var ext=String(f.name||"").toLowerCase().split(".").pop();
      if(["pdf","jpg","jpeg","png","webp"].indexOf(ext)<0){
        erros.push(f.name+": só aceitamos PDF, JPG, PNG ou WEBP."); continue;
      }
      if(f.size>DOC_MAX){ erros.push(f.name+": passa de "+docTam(DOC_MAX)+"."); continue; }
      if(!f.size){ erros.push(f.name+": o arquivo está vazio."); continue; }
      // repetido: contra o que já estava e contra o que veio nesta mesma leva
      var rep=false, k;
      for(k=0;k<existentes.length;k++){
        if(existentes[k].nome===f.name && existentes[k].tamanho===f.size) rep=true;
      }
      for(k=0;k<ok.length;k++){
        if(ok[k].nome===f.name && ok[k].tamanho===f.size) rep=true;
      }
      if(rep){ erros.push(f.name+": já está na lista."); continue; }
      ok.push({nome:f.name, tamanho:f.size, arquivo:f});
    }
    return {ok:ok, erros:erros};
  }

  function docRotulo(t){
    for(var i=0;i<DOC_TIPOS.length;i++) if(DOC_TIPOS[i][0]===t) return DOC_TIPOS[i][1];
    return "Documento";
  }

  function docEngolir(lista){
    if(!lista || !lista.length) return;
    var r=docPeneira(lista, wz.docs.length, wz.docs), i;
    for(i=0;i<r.ok.length;i++){
      r.ok[i].tipo=wz.docTipo;
      r.ok[i].rotulo=docRotulo(wz.docTipo);
      wz.docs.push(r.ok[i]);
    }
    telaDocs(); pintarResumoLado();
    if(r.ok.length) uiToast(r.ok.length===1?"1 arquivo pronto para enviar.":(r.ok.length+" arquivos prontos para enviar."));
    if(r.erros.length){
      uiAviso(r.erros.length===1?"Não consegui usar este arquivo":("Não consegui usar "+r.erros.length+" arquivos"),
              "", {lista:r.erros});
    }
  }

  // ============================================================
  // CONFRONTO: A NOTA CONTRA O PEDIDO
  //
  // Quem faz a conta é o BANCO. Aqui eu só mando o que a nota declarou e
  // desenho a resposta. Se eu comparasse aqui, o fornecedor poderia mexer nos
  // números antes de mandar — e a loja veria "tudo certo" numa carga torta.
  // ============================================================

  // Os itens de TODAS as notas lidas. Só as que vieram por XML têm itens:
  // quem digitou só a chave de 44 números não mandou produto nenhum junto.
  function itensDasNotas(){
    var out=[];
    for(var i=0;i<wz.chaves.length;i++){
      var its=wz.chaves[i].itens||[];
      for(var j=0;j<its.length;j++){
        var t=its[j];
        out.push({ ean:t.ean||"", codigo:t.codigo||"", descricao:t.descricao||"",
                   unidade:t.unidade||"", qtd:t.qtd||0, valor_unit:t.valorUnit||0,
                   pedido:t.pedido||"", item_pedido:t.itemPedido||"" });
      }
    }
    return out;
  }

  // quantas notas entraram só pela chave, sem os produtos
  function notasSemItens(){
    var n=0;
    for(var i=0;i<wz.chaves.length;i++){ if(!(wz.chaves[i].itens||[]).length) n++; }
    return n;
  }

  function conferirNota(){
    var its=itensDasNotas(), peds=pedidosDoAgendamento();
    if(!its.length || !peds.length){ wz.conf=null; pintarConfronto(); return; }
    wz.conf="carregando"; pintarConfronto();
    SB.rpc("forn_conferir_nota",{p_pedidos:peds, p_itens:its}).then(function(r){
      var v=(r&&r.data)||{};
      wz.conf=(r.error||!v.ok) ? {erro:(r.error?r.error.message:v.erro)||"Não consegui conferir."} : v;
      pintarConfronto();
    }, function(){ wz.conf={erro:"Não consegui falar com o servidor."}; pintarConfronto(); });
  }

  function confLinha(x){
    // 'indefinido' e ATENCAO, nao erro: a nota nao trouxe como casar o item com o
    // pedido. Pintar de vermelho seria acusar o fornecedor de uma coisa que ninguem
    // sabe se aconteceu.
    var cls={fora:"ruim", acima:"ruim", preco:"atencao", indefinido:"atencao", ok:"bom"}[x.situacao]||"";
    var dir="";
    if(x.situacao==="acima"){
      dir='<b>'+esc(numero(x.qtd_nota))+'</b> na nota · o pedido espera <b>'+esc(numero(x.saldo))+'</b>';
    } else if(x.situacao==="preco"){
      dir='nota <b>'+esc(moeda(x.valor_nota))+'</b> · pedido <b>'+esc(moeda(x.valor_pedido))+'</b>';
    } else if(x.situacao==="fora" || x.situacao==="indefinido"){
      dir='<b>'+esc(numero(x.qtd_nota))+'</b>'+(x.unidade?" "+esc(x.unidade):"")+' na nota';
    } else {
      dir='<b>'+esc(numero(x.qtd_nota))+'</b> de '+esc(numero(x.saldo))+' que o pedido espera';
    }
    return '<div class="cnf-i '+cls+'">'+
      '<div class="cnf-d"><b>'+esc(x.descricao)+'</b>'+
        (x.ean?'<span class="cnf-e">'+esc(x.ean)+'</span>':'')+'</div>'+
      '<div class="cnf-n">'+dir+'</div>'+
      (x.motivo?'<div class="cnf-m">'+esc(x.motivo)+'</div>':'')+
      '</div>';
  }

  // A NOTA DIZ UM PEDIDO E O FORNECEDOR MARCOU OUTRO.
  //
  // A conferencia compara com o que ele MARCOU, nao com o que a nota DECLARA.
  // Sem este aviso, marcar o pedido errado passava calado: se o produto existe
  // nos dois pedidos, o codigo de barras casa e a tela diz "tudo certo" —
  // comparando com o pedido errado. O erro grosseiro se denuncia sozinho
  // (todos os itens caem em "nao esta no pedido"); o perigoso e o meio-termo,
  // dois pedidos do mesmo fornecedor com produtos parecidos.
  function avisosDoPedido(){
    var daNota=pedidosDasNotas();
    if(!daNota.length) return "";
    var lista=(wz.pedidosLista||[]).map(function(x){ return String(x.numero); });
    var mar=pedidosDoAgendamento().map(String);

    function fora(a,b){ return a.filter(function(x){ return b.indexOf(x)<0; }); }
    var naoMarcou   = fora(daNota.filter(function(x){ return lista.indexOf(x)>=0; }), mar);
    var marcouAMais = fora(mar, daNota);
    var foraDaLista = fora(daNota, lista);

    var av=[];
    if(naoMarcou.length){
      av.push("A nota fiscal diz que é do "+(naoMarcou.length===1?"pedido ":"pedidos ")+
              naoMarcou.join(", ")+", e ele não está marcado.");
    }
    if(marcouAMais.length){
      av.push("Você marcou o "+(marcouAMais.length===1?"pedido ":"pedidos ")+
              marcouAMais.join(", ")+", que a nota não declara.");
    }
    if(foraDaLista.length){
      av.push("A nota diz o "+(foraDaLista.length===1?"pedido ":"pedidos ")+foraDaLista.join(", ")+
              ", que não está na sua lista de pedidos em aberto. "+
              "Pode ser que já tenha sido entregue por inteiro, ou que o número na nota esteja errado.");
    }
    if(!av.length) return "";

    var h='<div class="cnf atencao"><div class="cnf-t">A nota e o pedido marcado não combinam</div><ul class="cnf-av">';
    for(var i=0;i<av.length;i++) h+="<li>"+esc(av[i])+"</li>";
    return h+"</ul></div>";
  }

  function blocoConfronto(){
    var v=wz.conf;
    if(v===null || v===undefined) return "";
    if(v==="carregando") return '<div class="cnf"><div class="cnf-t">Conferindo a nota com o pedido…</div></div>';
    if(v.erro) return '<div class="cnf ruim"><div class="cnf-t">'+esc(v.erro)+'</div></div>';
    if(!v.conferido) return "";

    var r=v.resumo||{}, ln=v.linhas||[];
    var probs=r.problemas||0;
    var h='<div class="cnf '+(probs?"ruim":"bom")+'">';

    h+='<div class="cnf-t">'+(probs
      ? (probs===1 ? "1 item precisa de atenção" : probs+" itens precisam de atenção")
      : "Tudo bate com o pedido")+'</div>';

    h+='<div class="cnf-s">'+esc(String(r.itens))+
       (r.itens===1?" item na nota · ":" itens na nota · ")+
       esc(String(r.ok))+" conferem"+
       (r.indefinido? " · "+esc(String(r.indefinido))+" sem como conferir":"")+
       (r.faltando? " · "+esc(String(r.faltando))+" do pedido não vieram nesta nota":"")+
       '</div>';

    // só mostro o que precisa de olho. Listar 51 itens certos esconde os 2 errados.
    var ruins=ln.filter(function(x){ return x.situacao!=="ok"; });
    if(ruins.length){
      h+='<div class="cnf-l">';
      for(var i=0;i<ruins.length && i<25;i++) h+=confLinha(ruins[i]);
      if(ruins.length>25) h+='<div class="cnf-mais">e mais '+(ruins.length-25)+' item(ns).</div>';
      h+='</div>';
    }

    if(probs){
      /* Esta frase dizia "você pode agendar assim mesmo". Virou mentira em 20/08/2026,
         quando o servidor passou a recusar item fora do pedido e quantidade acima —
         que é como o Tempo Certo faz. Deixar o texto antigo era mandar o fornecedor
         montar o agendamento inteiro para bater na parede no último clique. */
      h+='<div class="cnf-p cnf-barra">Com estes problemas a loja <b>não vai aceitar</b> o '+
         'agendamento. Confira se o pedido escolhido é o certo; se a nota estiver mesmo '+
         'diferente do pedido, fale com o comprador da loja antes.</div>';
    }

    /* "SEM COMO CONFERIR" NAO E CULPA DE NINGUEM.
       Medido em 200 notas reais da loja: 1 em cada 4 itens nao traz codigo de barras
       nem a linha do pedido. Antes esses eram acusados de "nao esta no pedido" e
       BARRAVAM o agendamento — 40% das notas cairiam por isso, com o fornecedor
       lendo que trouxe coisa que ninguem pediu. */
    if(r.indefinido){
      h+='<div class="cnf-p">'+(r.indefinido===1?"Um item não traz":r.indefinido+" itens não trazem")+
         ' código de barras nem a linha do pedido, então não dá para conferir '+
         (r.indefinido===1?"ele":"eles")+' automaticamente. '+
         'Isso <b>não impede o agendamento</b> — a conferência desses fica para a chegada.</div>';
    }

    var semItens=notasSemItens();
    if(semItens){
      h+='<div class="cnf-p">'+(semItens===1?"Uma nota foi informada":semItens+" notas foram informadas")+
         ' só pela chave, sem o arquivo. Essas não entram nesta conferência — '+
         'mande o XML se quiser conferir item a item.</div>';
    }

    return h+'</div>';
  }

  function pintarConfronto(){
    var c=el("wzConf"); if(!c) return;
    // o aviso de pedido trocado aparece MESMO sem conferencia: ele vale
    // inclusive quando a nota veio so pela chave, sem itens para comparar
    c.innerHTML = avisosDoPedido() + blocoConfronto();
  }

  function telaPedidos(){
    var l=wz.pedidosLista||[];

    var h='<div class="wz-form larga">'+
      '<h3>Pedidos de compra</h3>'+
      '<p class="subt">Marque a que pedido esta entrega se refere. '+
      'Se você enviou a nota fiscal, já marcamos o que ela declarou.</p>';

    if(!l.length){
      h+=uiVazio({ic:IC.caixa,titulo:"Você não tem pedido em aberto",
        texto:"Nenhum pedido de compra da loja para você está aguardando entrega. "+
              "Pode seguir normalmente — o pedido não é obrigatório para agendar."});
    } else {
      h+='<div class="ped-l">';
      for(var i=0;i<l.length;i++){
        var x=l[i], on=pedidosDoAgendamento().indexOf(String(x.numero))>=0;
        var faltam=x.itens_saldo||0, total=x.itens||0;
        h+='<label class="ped'+(on?" on":"")+'" data-ped="'+esc(x.numero)+'">'+
           '<input type="checkbox"'+(on?' checked':'')+'>'+
           '<div class="ped-c">'+
             '<div class="ped-t"><b>Pedido '+esc(x.numero)+'</b>'+
             (x.daNota?'<span class="nf">veio na nota fiscal</span>':'')+'</div>'+
             '<div class="ped-s">'+
               '<b>'+esc(String(faltam))+'</b> de '+esc(String(total))+
               (total===1?' item para entrega':' itens para entrega')+
               (x.previsao?' · previsão '+esc(x.previsao):'')+
               (x.emissao?' · pedido em '+esc(x.emissao):'')+
             '</div>'+
             '<button type="button" class="ped-ver" data-verped="'+esc(x.id)+'">ver os itens</button>'+
           '</div>'+
           '<div class="ped-v"><b>'+esc(moeda(x.saldo))+'</b><span>a entregar</span></div>'+
           '</label>';
      }
      h+='</div>';
    }

    h+='<div id="wzConf"></div>';

    el("wzMain").innerHTML=h+'</div>';
    el("wzPe").innerHTML='<button class="bt fraco" id="wzVolta">← Voltar</button>'+
      '<button class="bt" id="wzAvanca">Continuar →</button>';

    // confere já ao entrar na etapa, com o que a nota declarou
    conferirNota();

    [].slice.call(el("wzMain").querySelectorAll(".ped[data-ped]")).forEach(function(e){
      e.onclick=function(ev){
        // o clique no "ver os itens" não pode marcar a linha junto
        if(ev.target.closest("[data-verped]")){ ev.preventDefault(); return; }
        setTimeout(function(){
          var n=e.getAttribute("data-ped"), c=e.querySelector("input").checked;
          // MARCAR aqui e para o agendamento SEM nota fiscal. Com nota, quem
          // manda e o vinculo de cada nota — por isso DESMARCAR precisa soltar
          // a nota tambem, senao a tela diria uma coisa e o vinculo outra.
          var k=(wz.pedidosExtra||[]).indexOf(n);
          if(c && k<0) wz.pedidosExtra.push(n);
          if(!c){
            if(k>=0) wz.pedidosExtra.splice(k,1);
            for(var q=0;q<wz.chaves.length;q++){
              if(String(wz.chaves[q].vinc||"")===n){ wz.chaves[q].vinc=""; wz.chaves[q].vincAuto=false; }
            }
          }
          e.classList.toggle("on", c);
          sincronizarPedidoTexto();
          pintarResumoLado();
          // marcou ou desmarcou pedido: a conferência muda de alvo
          conferirNota();
        },0);
      };
    });
    [].slice.call(el("wzMain").querySelectorAll("[data-verped]")).forEach(function(b){
      b.onclick=function(ev){ ev.preventDefault(); ev.stopPropagation();
        verItensDoPedido(b.getAttribute("data-verped")); };
    });

    el("wzVolta").onclick=function(){ wz.etapa="nf"; pintarWizard(); };
    // trocar o pedido marcado muda o que a loja espera do caminhao: confiro de novo
    el("wzAvanca").onclick=function(){ checarCedo(el("wzAvanca"), "docs"); };
  }

  // O que falta dentro de um pedido. O banco confere o dono antes de
  // devolver linha — id de pedido alheio não abre nada.
  //
  // A janela tem ALTURA FIXA e a lista rola DENTRO dela. Antes ela crescia junto com
  // a lista, e num pedido de 16 itens o fim ficava fora da tela sem como alcançar —
  // o dono pegou testando em 22/08. Cabeçalho (de qual pedido é esta lista) e rodapé
  // (o tamanho da carga) ficam parados: é o que se precisa enxergar o tempo todo
  // enquanto se percorre a lista, e é justamente o que sumia ao rolar.
  function verItensDoPedido(id){
    var p = pedCache[id] || null;
    SB.rpc("forn_pedido_itens",{p_id:id}).then(function(r){
      var d=(r&&r.data)||{};
      if(!d.ok){ uiAviso("Não consegui abrir", d.erro||"Pedido não encontrado."); return; }
      var it=d.itens||[];

      // O que interessa para quem vai carregar o caminhão é o que FALTA, não o total
      // do pedido: um pedido de 51 itens com 3 pendentes é uma entrega de 3.
      var nFalta=0, vFalta=0;
      for(var k=0;k<it.length;k++){
        var sk=parseFloat(it[k].saldo)||0, vk=parseFloat(it[k].valor_unit)||0;
        if(sk>0){ nFalta++; vFalta+=sk*vk; }
      }

      var h='<div class="det-cab">'+
        '<div class="quem"><b>'+esc(p&&p.numero?("Pedido "+p.numero):"Pedido")+'</b>'+
        '<span>'+esc(meuNome||"")+'</span></div>';
      if(p&&p.emissao)  h+='<div class="par"><span class="ic">'+IC.papel+'</span>'+
        '<div><label>Emissão</label><div>'+esc(p.emissao)+'</div></div></div>';
      if(p&&p.previsao) h+='<div class="par"><span class="ic">'+IC.cal+'</span>'+
        '<div><label>Previsão de entrega</label><div>'+esc(p.previsao)+'</div></div></div>';
      h+='<div class="par"><span class="ic">'+IC.caixa+'</span>'+
        '<div><label>Itens a entregar</label><div>'+nFalta+' de '+it.length+'</div></div></div>';
      if(p&&p.situacao) h+='<div class="fim"><span class="selo aberto">'+esc(p.situacao)+'</span></div>';
      h+='</div>';

      if(!it.length){
        h+='<div class="rola"><p style="font-size:13px;color:var(--txt2);padding:20px 0">'+
           'Esse pedido não tem itens.</p></div>';
      } else {
        h+='<div class="rola"><table class="res-tab"><thead><tr><th>Produto</th>'+
           '<th class="n">Pedido</th><th class="n">Entregue</th><th class="n">Falta</th>'+
           '<th class="n">Valor un.</th><th class="n">A entregar</th>'+
           '</tr></thead><tbody>';
        for(var i=0;i<it.length;i++){
          var x=it[i], falta=parseFloat(x.saldo)||0, vu=parseFloat(x.valor_unit)||0;
          h+='<tr'+(falta<=0?' style="opacity:.45"':'')+'>'+
             '<td><b>'+esc(x.descricao||"—")+'</b>'+
             (x.codigo?'<span class="ch" style="display:block;margin-top:2px">'+esc(x.codigo)+
                       (x.unidade?" · "+esc(x.unidade):"")+'</span>':'')+'</td>'+
             '<td class="n">'+esc(numero(x.qtd_pedida))+'</td>'+
             '<td class="n">'+esc(numero(x.qtd_entregue))+'</td>'+
             '<td class="n"><b>'+esc(numero(x.saldo))+'</b></td>'+
             '<td class="n">'+esc(moeda(vu))+'</td>'+
             '<td class="n">'+(falta>0?esc(moeda(falta*vu)):"—")+'</td></tr>';
        }
        h+='</tbody></table></div>'+
           '<div class="mpe">'+
           '<div class="par"><label>Itens a entregar</label><div>'+nFalta+'</div></div>'+
           '<div class="par"><label>Valor a entregar</label><div>'+esc(moeda(vFalta))+'</div></div>'+
           '<div class="fim">'+it.length+(it.length===1?" item":" itens")+' no pedido</div>'+
           '</div>';
      }

      uiModal({titulo:"Detalhes do pedido", cru:true, tam:"alto", corpo:h});
    });
  }

  function telaResumo(){
    var p=partes(wz.dia+"T00:00")||{longa:""};

    function faixa(rot,val){
      return '<div><label>'+esc(rot)+'</label><b>'+esc(val||"—")+'</b></div>';
    }
    function li(rot,val){
      if(!val) return '';
      return '<div class="li"><span>'+esc(rot)+':</span> <b>'+esc(val)+'</b></div>';
    }
    function cartao(ic,tit,corpo){
      if(!corpo) return '';
      return '<div class="res-card"><div class="res-tit"><span class="ic">'+ic+'</span>'+
             esc(tit)+'</div>'+corpo+'</div>';
    }

    var h='<div class="wz-form">'+
      '<h3>Confira antes de enviar</h3>'+
      '<p class="subt">A loja vai receber este pedido e confirmar o horário. '+
      'Você recebe um aviso por e-mail.</p>'+
      '<div class="res-faixa">'+
        faixa("Remetente", wz.remetente==="transportadora"
                ? ("Transportadora "+cnpjFmt(wz.transpCnpj)) : meuNome)+
        faixa("Local de entrega", localDaLoja())+
        faixa("Dia", maiuscula(p.longa))+
        faixa("Horário", wz.hora!==null
                ? String(wz.hora).padStart(2,"0")+":00 ("+txtDuracao(wz.minutos||60)+")" : "")+
      '</div>';

    // ---- as notas fiscais, uma a uma ----
    if(wz.comNota && wz.chaves.length){
      var temItens=false, temValor=false, temPedido=false;
      for(var k=0;k<wz.chaves.length;k++){
        if((wz.chaves[k].itens||[]).length) temItens=true;
        if(wz.chaves[k].valor) temValor=true;
        if((wz.chaves[k].pedidos||[]).length) temPedido=true;
      }
      h+='<div class="res-bloco"><div class="res-tit"><span class="ic">'+IC.papel+'</span>'+
         (wz.chaves.length>1?'Notas fiscais informadas':'Nota fiscal informada')+'</div>'+
         '<div class="res-rola"><table class="res-tab"><thead><tr>'+
         '<th>Nº da nota</th><th>Chave</th>'+
         (temPedido?'<th>Pedido</th>':'')+
         (temValor?'<th>Valor</th>':'')+(temItens?'<th>Produtos</th>':'')+
         '</tr></thead><tbody>';
      for(var i=0;i<wz.chaves.length;i++){
        var n=wz.chaves[i], its=(n.itens||[]).length;
        h+='<tr><td><b>'+esc(n.numero||"—")+'</b>'+(n.serie?' <span style="color:var(--txt3)">série '+esc(n.serie)+'</span>':'')+'</td>'+
           '<td class="ch">'+esc(nfeChaveFmt(n.chave))+'</td>'+
           (temPedido?'<td>'+esc((n.pedidos||[]).join(", ")||"—")+'</td>':'')+
           (temValor?'<td class="n">'+esc(n.valor?moeda(n.valor):"—")+'</td>':'')+
           (temItens?'<td class="n">'+(its?esc(its+(its>1?" produtos":" produto")):"—")+'</td>':'')+
           '</tr>';
      }
      h+='</tbody></table></div></div>';
    }

    // ---- os cartões por assunto ----
    var carga = li("Tipo de carga", wz.tipoCarga)+
                li("Tipo de volume", wz.tipoVolume)+
                li("Volumes", wz.qtdVolumes)+
                li("Peso total", wz.peso?numero(wz.peso,3)+" kg":"")+
                li("Pedido", wz.pedido)+
                (wz.descricao?'<div class="obs"><b>Observações</b>'+esc(wz.descricao)+'</div>':'');
    var veic  = li("Tipo de veículo", wz.tipoVeiculo)+
                li("Placa", wz.placa)+
                li("Motorista", wz.motorista)+
                li("Telefone", wz.motoristaFone);

    if(carga || veic){
      var docs = wz.docs.length
        ? wz.docs.map(function(d){ return li(d.rotulo, d.nome); }).join("")
        : "";
      var cob = wz.cobranca
        ? ('<div class="li"><span>Valor total previsto:</span> <b>'+esc(moeda(wz.cobranca.total))+'</b></div>'+
           (wz.cobranca.aviso?'<div class="obs"><b>Atenção</b>'+esc(wz.cobranca.aviso)+'</div>':''))
        : '';
      h+='<div class="res-cards">'+cartao(IC.caixa,"Carga",carga)+
         cartao(IC.caminhao,"Veículo",veic)+
         cartao(IC.clipe,"Documentos",docs)+
         cartao(IC.tag,"Cobrança de descarga",cob)+'</div>';
    }

    el("wzMain").innerHTML=h+'</div>';

    el("wzPe").innerHTML='<button class="bt fraco" id="wzVolta">← Voltar</button>'+
      '<button class="bt" id="wzEnviar">Pedir este horário</button>';
    el("wzVolta").onclick=function(){ wz.etapa = wz.cobranca ? "cobranca" : "agendamento"; pintarWizard(); };
    el("wzEnviar").onclick=enviarAgendamento;
  }
  /* O PACOTE DAS NOTAS, MONTADO NUM LUGAR SO.
     A tela pergunta ao servidor se as travas passam ANTES do fornecedor preencher o
     resto (ver checarCedo). Se a pergunta mandasse um pacote e o envio final montasse
     outro, os dois responderiam coisas diferentes sobre a mesma entrega - e o
     fornecedor levaria um 'pode seguir' e depois um 'nao consigo agendar'. Uma
     montagem so, usada pelos dois. */
  function notasParaServidor(){
    if(!wz.comNota) return null;
    return wz.chaves.map(function(n){

        return { chave:n.chave, xml:n.xml||null, numero:n.numero, serie:n.serie,
                 /* O PEDIDO DESTA NOTA. O fornecedor vincula nota por nota na tela e isso
                    se perdia no caminho: só ia o texto de todos os pedidos colado com
                    vírgula, que o banco cortava em 40 letras. Na doca, "45231, 45390,
                    453…" não serve para conferir nada. */
                 pedido:n.vinc||null,
                 // A chave de 44 dígitos NÃO carrega o dia, só mês e ano ("08/2026").
                 // Mandar isso como data derruba a gravação inteira no banco.
                 // Só o XML traz dia completo (10 caracteres).
                 emissao:(n.emissao && n.emissao.length===10)
                           ? n.emissao.split("/").reverse().join("-") : null,
                 /* O CNPJ DE QUEM EMITIU, MESMO SEM O ARQUIVO.
                    A chave de 44 dígitos carrega o CNPJ do emitente nas posições 7 a 20 —
                    o leitor de chave já o extrai e guarda em n.cnpj. Antes eu mandava só
                    n.emitenteCnpj, que só o XML preenche: nota digitada pela chave ia com
                    o emitente VAZIO, e a trava "a nota tem que ser do próprio fornecedor"
                    recusaria todas elas. Foi a auditoria de 20/08 que pegou isso. */
                 valor:n.valor||null,
                 emitente_cnpj:n.emitenteCnpj || n.cnpj ||
                   (n.chave && n.chave.length===44 ? n.chave.slice(6,20) : null),
                 emitente_nome:n.emitenteNome||null, destino_cnpj:n.destinoCnpj||null,
                 itens:n.itens||null, volumes:n.volumes||null, especie:n.especie||null,
                 peso_bruto:n.pesoBruto||null, peso_liquido:n.pesoLiquido||null,
                 transportadora_nome:n.transportadoraNome||null,
                 transportadora_cnpj:n.transportadoraCnpj||null };
    });
  }

  /* RECUSAR CEDO.
     As travas da loja (tem pedido? item fora do pedido? acima do pedido? pode agendar
     sem nota?) sempre existiram, mas so eram conferidas no ULTIMO clique. O fornecedor
     digitava a nota, vinculava o pedido, anexava documento, escolhia horario, preenchia
     placa e motorista - e so entao levava "nao consegui agendar". Refazia tudo e ligava
     para o recebimento, que e justamente o que este portal existe para evitar.

     Aqui a tela PERGUNTA ao servidor, cedo, e mostra o problema no lugar de corrigir.
     Nao ha copia de regra nenhuma nesta tela: quem decide continua sendo o banco, e o
     gravar confere a MESMA funcao no fim. Burlar a tela nao agenda nada.

     Se a pergunta falhar (rede, servidor fora), o fornecedor SEGUE. A conferencia
     antecipada e um favor, nao uma tranca - trancar por falha de rede seria inventar um
     problema que nao existe, e quem barra de verdade continua no fim. */
  function checarCedo(bt, irPara){
    var antes = bt ? bt.textContent : "";
    if(bt){ bt.disabled=true; bt.textContent="Conferindo..."; }
    function solta(){ if(bt){ bt.disabled=false; bt.textContent=antes; } }
    function segue(){ solta(); wz.etapa=irPara; pintarWizard(); }
    try{
      SB.rpc("forn_checar_agendamento",{ p_pedido: wz.pedido||null,
                                         p_notas: notasParaServidor() })
        .then(function(r){
          if(r && r.error) return segue();
          var d = r && r.data;
          if(d && d.ok===false){
            solta();
            uiAviso("Ainda não dá para agendar", d.erro || "Confira os dados da nota.")
              .then(function(){
                var onde = d.onde || "";
                // levo o fornecedor ao lugar de corrigir - mas so se o lugar existir.
                // Quem nao tem pedido em aberto nao tem a etapa "pedidos": mandar para
                // la mostraria uma tela vazia.
                if(onde==="pedidos" && wz.pedidosLista && wz.pedidosLista.length){
                  wz.etapa="pedidos"; pintarWizard();
                } else if(onde==="nf"){ wz.etapa="nf"; pintarWizard(); }
              });
            return;
          }
          segue();
        }, function(){ segue(); });
    }catch(e){ segue(); }
  }

  function enviarAgendamento(){
    var bt=el("wzEnviar");
    bt.disabled=true; bt.textContent="Enviando...";
    SB.rpc("forn_agendar_portal",{p_data:wz.dia, p_hora:wz.hora,
      p_pedido:wz.pedido||null, p_descricao:wz.descricao||null,
      // sem isto, o CNPJ que ele digitou e o sistema conferiu era jogado fora:
      // a loja esperava o caminhão do fornecedor e chegava outro.
      p_transportadora_cnpj: wz.remetente==="transportadora" ? wz.transpCnpj : null,
      p_minutos: wz.minutos||60,
      p_carga: { tipo_carga:wz.tipoCarga||null, tipo_volume:wz.tipoVolume||null,
                 qtd_volumes:wz.qtdVolumes||null, tipo_veiculo:wz.tipoVeiculo||null,
                 placa:wz.placa||null, motorista:wz.motorista||null,
                 motorista_fone:wz.motoristaFone||null,
                 // o servidor recalcula tudo por conta própria; daqui vai só
                 // o peso e a ciência, nunca um valor
                 peso_kg:wz.peso, cobranca_ciente:!!wz.ciente },
      p_notas: notasParaServidor()
    }).then(function(r){
      bt.disabled=false; bt.textContent="Pedir este horário";
      if(r.error||(r.data&&r.data.ok===false)){
        uiAviso("Não consegui agendar",(r.error?r.error.message:(r.data&&r.data.erro))||"Tente de novo.");
        return;
      }
      // avisa a loja que tem horário pedido esperando resposta
      try{ if(r.data && r.data.id) SB.functions.invoke("aviso-agendamento",{body:{id:r.data.id,status:"solicitou"}}); }catch(e){}
      // Os documentos sobem AGORA, que é quando a pasta do agendamento passa a
      // existir. Se algum falhar, o agendamento continua valendo — dizer que
      // falhou tudo por causa de um anexo seria fazer o fornecedor marcar de
      // novo um horário que já é dele.
      var idNovo = r.data && r.data.id;
      var pendentes = wz.docs.slice();
      fecharWizard();
      contarAvisos();
      irPara("agendas");
      if(!pendentes.length || !idNovo){
        uiToast("Pedido enviado. A loja vai confirmar.");
        return;
      }
      uiToast("Pedido enviado. Enviando "+pendentes.length+
              (pendentes.length===1?" documento...":" documentos..."));
      subirDocumentos(idNovo, pendentes, {novo:true});
    });
  }

  /* SOBE OS DOCUMENTOS depois de o agendamento existir.
     Um por vez, de propósito: dez arquivos de 8 MB ao mesmo tempo derrubam a
     internet de quem está no celular na portaria. E o caminho de cada um vem
     do BANCO — o navegador nunca escolhe onde grava. */
  // opc.novo   = veio da etapa 3, o agendamento acabou de nascer
  // opc.depois = chamar quando terminar (a aba Anexos usa para redesenhar)
  function subirDocumentos(idAgenda, lista, opc){
    opc=opc||{};
    var ok=0, falhou=[];
    function proximo(i){
      if(i>=lista.length){
        if(!falhou.length){
          uiToast(ok===1?"1 documento anexado.":(ok+" documentos anexados."));
        } else {
          uiAviso(falhou.length===1?"Um documento não subiu":(falhou.length+" documentos não subiram"),
            opc.novo ? "O agendamento foi criado e está valendo. Abra o agendamento em "+
            "\u201cMeus agendamentos\u201d para anexar de novo."
                     : "Tente anexar de novo. O agendamento continua valendo.",
            {lista:falhou});
        }
        if(opc.depois) opc.depois(ok);
        return;
      }
      var d=lista[i];
      SB.rpc("forn_anexo_caminho",{p_agenda:idAgenda, p_nome:d.nome}).then(function(rc){
        var c=(rc&&rc.data)||{};
        if(!c.ok){ falhou.push(d.nome+": "+(c.erro||"não consegui preparar o envio.")); return proximo(i+1); }
        SB.storage.from("recebimento").upload(c.caminho, d.arquivo, {upsert:false})
          .then(function(ru){
            if(ru && ru.error){ falhou.push(d.nome+": "+ru.error.message); return proximo(i+1); }
            SB.rpc("forn_anexo_add",{p_agenda:idAgenda, p_caminho:c.caminho,
                                     p_nome:d.nome, p_tipo:d.tipo}).then(function(ra){
              var a=(ra&&ra.data)||{};
              if(a.ok) ok++; else falhou.push(d.nome+": "+(a.erro||"não consegui registrar."));
              proximo(i+1);
            }, function(){ falhou.push(d.nome+": falha ao registrar."); proximo(i+1); });
          }, function(er){ falhou.push(d.nome+": "+((er&&er.message)||"falha no envio.")); proximo(i+1); });
      }, function(){ falhou.push(d.nome+": falha ao preparar o envio."); proximo(i+1); });
    }
    proximo(0);
  }

  // ============================================================
  // AVISOS
  // ============================================================
  function contarAvisos(){
    SB.rpc("forn_inicio").then(function(r){
      var n=(r&&r.data&&r.data.avisos_novos)||0;
      el("sinoBolha").textContent=n>9?"9+":String(n);
      el("sinoBolha").classList.toggle("esconde", !n);
    });
  }
  el("btSino").onclick=abrirAvisos;

  function abrirAvisos(){
    var f=document.createElement("div"); f.className="gav-fundo";
    var g=document.createElement("div"); g.className="gaveta";
    g.innerHTML='<header><b>Avisos</b><button class="icone" data-fecha="1">'+
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'+
      '</button></header><div class="corpo" id="gavCorpo">'+uiCarregando()+'</div>';
    el("pilha").appendChild(f); el("pilha").appendChild(g);
    function fechar(){
      try{ el("pilha").removeChild(f); el("pilha").removeChild(g); }catch(e){}
      contarAvisos();
    }
    f.onclick=fechar;
    g.querySelector("[data-fecha]").onclick=fechar;

    SB.rpc("forn_avisos").then(function(r){
      var l=(r&&r.data)||[], c=g.querySelector("#gavCorpo");
      if(!l.length){ c.innerHTML=uiVazio({ic:IC.sino,titulo:"Nenhum aviso ainda"}); return; }
      var h="";
      for(var i=0;i<l.length;i++){
        var a=l[i];
        h+='<div class="not'+(a.nova?" nova":"")+'"'+(a.agenda_id?' data-ver="'+esc(a.agenda_id)+'"':'')+
           ' style="'+(a.agenda_id?"cursor:pointer":"")+'">'+
           '<b>'+esc(a.titulo)+'</b><p>'+esc(a.texto||"")+'</p><span>'+esc(a.em)+'</span></div>';
      }
      c.innerHTML=h;
      c.addEventListener("click", function(ev){
        var t=ev.target.closest&&ev.target.closest("[data-ver]");
        if(!t) return;
        fechar(); abrirDetalhe(t.getAttribute("data-ver"));
      });
      SB.rpc("forn_avisos_lidos").then(function(){ contarAvisos(); });
    });
  }

  // ============================================================
  // CLIQUES QUE VALEM EM QUALQUER TELA
  // ============================================================
  el("pagina").addEventListener("click", function(ev){
    var alvo = ev.target.closest ? ev.target : ev.target.parentNode;
    if(!alvo || !alvo.closest) return;
    var acao=alvo.closest("[data-acao]"), ver=alvo.closest("[data-ver]"), ped=alvo.closest("[data-pedido]");
    if(acao){
      var a=acao.getAttribute("data-acao");
      if(a==="nova")       abrirWizard();
      if(a==="avisos")     abrirAvisos();
      if(a==="recarregar") irPara(pagAtual);
      return;
    }
    // O olho da lista de Pedidos. Ficou anos mostrando um recado enlatado dizendo que os
    // dados "abrem quando o sistema da loja liberar" — e era mentira: os itens já estavam
    // no banco e a tela que mostra eles já existia, usada quando o fornecedor vincula o
    // pedido no agendamento. Faltava só apontar pra ela. (O dono pegou testando, 22/08.)
    if(ped){ verItensDoPedido(ped.getAttribute("data-pedido")); return; }
    if(ver){ abrirDetalhe(ver.getAttribute("data-ver")); }
  });

  // ============================================================
  // COMEÇO
  // ============================================================
  SB.auth.getSession().then(function(r){
    if(r.data&&r.data.session) decidirTela();
    else { aba("entrar"); mostrar("telaAuth"); }
  });
})();
</script>
</body>
</html>
`;

fs.writeFileSync(path.join(RAIZ, "output", "agendar.html"), html);
console.log("OK -> output/agendar.html  (" + Math.round(html.length / 1024) + " KB)");
