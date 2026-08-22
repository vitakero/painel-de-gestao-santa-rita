// Gera uma PRÉVIA do Portal do Fornecedor pra conferência visual.
//
// Pega o portal de verdade (output/agendar.html) e troca só a conexão com a nuvem
// por dados de exemplo — assim dá pra ver as telas de dentro sem a senha de um
// fornecedor de verdade.
//
// Isto NUNCA vai pro ar. O arquivo publicado continua sendo o output/agendar.html,
// que fala com o banco.
//
//   node scripts/previa-portal.cjs [saida.html]
//   abrir com ?tela=login|inicio|calendario|agendas|detalhe|pedidos|nova|avisos
//
// Quem abre o arquivo por caminho (file://) às vezes perde o ?tela=... — alguns
// visualizadores transformam o arquivo em data: e a busca da URL some junto.
// Por isso a tela também pode vir gravada no arquivo:  TELA=agendar node ...
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(process.env.HOME, "vr-looker-integration");
const SAIDA = process.argv[2] || path.join(RAIZ, ".previa", "previa-portal.html");

let h = fs.readFileSync(path.join(RAIZ, "output", "agendar.html"), "utf8");

// Sem animacao na PREVIA. O Chrome sem tela congela no primeiro quadro da
// animacao de entrada dos modais (opacity 0) e a foto sai sem a janela — eu
// perdi um tempo achando que o modal nao abria. No portal de verdade a
// animacao continua; isto vale so para o arquivo de conferencia.
const SEM_ANIMACAO = `<style>*,*::before,*::after{animation:none!important;transition:none!important}</style>`;

const STUB = `<script>
(function(){
  function iso(d){ return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
  var iso3=iso;
  function dias(n){ var x=new Date(); x.setDate(x.getDate()+n); return iso(x); }
  function util(n){ var x=new Date(), c=0;
    while(c<n){ x.setDate(x.getDate()+1); if(x.getDay()>0&&x.getDay()<6) c++; }
    return iso(x); }

  var A1=util(1), A2=util(2), A3=util(5), A4=dias(-9), A5=dias(-23), A6=dias(-40);
  var EMP="Distribuidora Nordeste Alimentos LTDA", CNPJ="12345678000195";
  var LOCAL="Loja Santa Rita", DOCA="Área de Recebimento 01";

  function ag(o){
    return { id:o.id, ticket:o.ticket, tipo:o.tipo||"entrega", situacao:o.sit, sit_doc:"sem_nota",
             motivo:o.motivo||null,
             solicitada:o.dia+"T"+o.h, solicitada_ate:o.hf,
             confirmada:o.conf===false?null:(o.dia+"T"+o.h), confirmada_ate:o.conf===false?null:o.hf,
             quando:o.dia+"T"+o.h, ate:o.dia+"T"+o.hf,
             remetente:EMP, destinatario:LOCAL, doca:o.conf===false?null:DOCA,
             pedidos:o.ped||"", notas:o.nf||0 };
  }

  var LISTA=[
    ag({id:"a1",ticket:"AG-2608-0012",dia:A1,h:"08:00",hf:"09:00",sit:"confirmada",ped:"45231",nf:0}),
    ag({id:"a2",ticket:"AG-2608-0015",dia:A2,h:"14:00",hf:"15:00",sit:"solicitada",conf:false,ped:"45244"}),
    ag({id:"a3",ticket:"AG-2608-0018",dia:A3,h:"10:00",hf:"11:00",sit:"confirmada",ped:"45260"}),
    ag({id:"a4",ticket:"AG-2608-0009",dia:A4,h:"09:00",hf:"10:00",sit:"concluida",ped:"44980",nf:2}),
    ag({id:"a5",ticket:"AG-2608-0004",dia:A5,h:"11:00",hf:"12:00",sit:"recusada",conf:false,
        motivo:"Horário já ocupado por outra carga refrigerada."}),
    ag({id:"a6",ticket:"AG-2607-0088",dia:A6,h:"07:00",hf:"08:00",sit:"concluida",ped:"44120",nf:1})
  ];

  // O que a prévia mandou para o cofre e o que ela apagou da lista — é o que eu
  // olho depois para saber se o caminho veio do "banco" e não do navegador.
  var SOBIU=[], TIROU=[];
  window.__PREVIA={sobiu:SOBIU, tirou:TIROU};

  var DET={};
  DET.a1=Object.assign({}, LISTA[0], { ok:true, local:LOCAL,
    endereco:"Rua André Sales, 531 — Paulo VI, Caicó/RN",
    solicitante:"Marcos Pereira", fornecedor:EMP, cnpj:CNPJ, minutos:60,
    tipo_carga:"Seca", tipo_volume:"Carga paletizada (embalagem padrão)", qtd_volumes:400,
    peso_kg:"1240.500", tipo_veiculo:"Caminhão Semi Pesado (Toco)", placa:"QGX-1D23",
    motorista:"José Alves", motorista_fone:"(84) 99812-4477",
    notas_fiscais:[], lista_pedidos:[{id:"p1",numero:"45231",fornecedor:EMP,total:"22850.00"}],
    // dois anexos com tamanho: é a aba Anexos cheia, com Abrir e lixeira
    anexos:[{id:"x9",nome:"laudo-sanitario.pdf",tipo:"laudo",tamanho:245760,em:"14/08/2026 16:31"},
            {id:"x10",nome:"foto-lacre.jpg",tipo:"documento",tamanho:92160,em:"14/08/2026 16:32"}],
    recados:[{texto:"Por favor chegar 15 minutos antes para a conferência dos lacres.",
              autor:"Recebimento", em:"14/08/2026 16:25"}],
    historico:[{acao:"criou",em:"13/08/2026 10:12"},
               {acao:"confirmou",de:"solicitada",para:"confirmada",em:"14/08/2026 16:22"}] });

  DET.a2=Object.assign({}, LISTA[1], { ok:true, local:LOCAL,
    endereco:"Rua André Sales, 531 — Paulo VI, Caicó/RN",
    solicitante:"Marcos Pereira", fornecedor:EMP, cnpj:CNPJ, minutos:60,
    notas_fiscais:[], lista_pedidos:[{id:"p2",numero:"45244",fornecedor:EMP}], anexos:[], recados:[],
    historico:[{acao:"criou",em:"14/08/2026 09:05"}] });

  DET.a4=Object.assign({}, LISTA[3], { ok:true, local:LOCAL,
    endereco:"Rua André Sales, 531 — Paulo VI, Caicó/RN",
    solicitante:"Marcos Pereira", fornecedor:EMP, cnpj:CNPJ, minutos:60,
    tipo_carga:"Seca", tipo_volume:"Carga batida", qtd_volumes:180,
    chegada_real:"06/08/2026 08:52", minutos_reais:47,
    notas_fiscais:[{id:"n1",numero:"128944",serie:"1",chave:"24260820947638000141550010001180681518005123",
                    emissao:"04/08/2026",valor:"18420.90",situacao:"lida"},
                   {id:"n2",numero:"128945",serie:"1",chave:"24260820947638000141550010001180681518005124",
                    emissao:"04/08/2026",valor:"3110.00",situacao:"lida"}],
    lista_pedidos:[{id:"p3",numero:"44980",fornecedor:EMP,total:"21530.90"}],
    anexos:[{id:"x1",nome:"canhoto-assinado.pdf",tipo:"documento",em:"06/08/2026 09:50"}],
    recados:[], historico:[{acao:"criou",em:"04/08/2026 08:30"},
               {acao:"confirmou",em:"04/08/2026 14:02"},
               {acao:"iniciou",em:"06/08/2026 08:58"},
               {acao:"concluiu",em:"06/08/2026 09:45"}] });

  DET.a5=Object.assign({}, LISTA[4], { ok:true, local:LOCAL, solicitante:"Marcos Pereira",
    fornecedor:EMP, cnpj:CNPJ, notas_fiscais:[], lista_pedidos:[], anexos:[], recados:[],
    historico:[{acao:"criou",em:"22/07/2026 15:10"},
               {acao:"recusou",de:"solicitada",para:"recusada",
                motivo:"Horário já ocupado por outra carga refrigerada.",em:"22/07/2026 17:44"}] });
  DET.a3=Object.assign({}, DET.a1, LISTA[2], {ok:true, ticket:"AG-2608-0018"});
  DET.a6=Object.assign({}, DET.a4, LISTA[5], {ok:true, ticket:"AG-2607-0088"});

  var AVISOS=[
    {id:"n1",agenda_id:"a1",tipo:"confirmada",titulo:"Entrega confirmada",
     texto:"A loja confirmou sua entrega de "+A1.slice(8)+"/"+A1.slice(5,7)+" às 08:00.",nova:true,em:"14/08 16:22"},
    {id:"n2",agenda_id:"a2",tipo:"solicitada",titulo:"Pedido de horário enviado",
     texto:"Seu pedido para "+A2.slice(8)+"/"+A2.slice(5,7)+" às 14:00 foi enviado. A loja vai conferir.",nova:true,em:"14/08 09:05"},
    {id:"n3",agenda_id:"a4",tipo:"concluida",titulo:"Entrega recebida",
     texto:"Sua entrega de "+A4.slice(8)+"/"+A4.slice(5,7)+" às 09:00 foi recebida.",nova:false,em:"06/08 10:41"},
    {id:"n4",agenda_id:"a5",tipo:"recusada",titulo:"Horário não liberado",
     texto:"A loja não liberou o horário de "+A5.slice(8)+"/"+A5.slice(5,7)+" às 11:00.",nova:false,em:"22/07 17:44"}
  ];

  var TELA=(location.search.match(/tela=([a-z]+)/)||[])[1]||"__TELA__";

  // Os horários de UM dia, do jeito que o banco devolve. Fonte única: o
  // calendário (quantas vagas o dia tem) e a lista (quais horas) contam
  // pela mesma régua — como no banco, onde as duas saem do receb_choca.
  // Loja abre 07:00 e fecha 17:00. Quem ocupa: um padrão fixo pelo dia do
  // mês, só pra ter dia cheio, dia vazio e dia lotado para olhar.
  function horasDoDia(dia, minutos){
    var min=minutos||60, l=[], d=new Date(String(dia)+"T12:00");
    if(isNaN(d)) return [];
    if(d.getDay()===0||d.getDay()===6) return [];
    var quantos=(d.getDate()%7===3) ? 99 : (d.getDate()%4);   // %7===3 = dia lotado
    for(var i=7;i<=16;i++){
      var fim=i*60+min;
      var cabe=fim<=17*60;
      var ocupado=((i*7 + d.getDate()) % 10) < quantos;
      l.push({h:i, hora:String(i).padStart(2,"0")+":00",
              ate:String(Math.floor(fim/60)).padStart(2,"0")+":"+String(fim%60).padStart(2,"0"),
              livre: cabe && !ocupado,
              motivo: !cabe ? "fecha" : (ocupado ? "ocupado" : "livre")});
    }
    return l;
  }

  var FAKE={
    auth:{
      getSession:function(){ return Promise.resolve({data:{session: (TELA==="login"||TELA==="cadastro")?null:{user:{id:"u1"}}}}); },
      getUser:function(){ return Promise.resolve({data:{user:{id:"u1",email:"contato@nordestealimentos.com.br",user_metadata:{}}}}); },
      signInWithPassword:function(){ return Promise.resolve({error:null}); },
      signOut:function(){ return Promise.resolve({}); },
      resetPasswordForEmail:function(){ return Promise.resolve({}); },
      signUp:function(){ return Promise.resolve({data:{session:null},error:null}); }
    },
    functions:{ invoke:function(){ return Promise.resolve({}); } },
    // O COFRE DE MENTIRA. Não existe arquivo aqui, e o que abre diz isso na
    // cara — se eu devolvesse um PDF bonito, eu poderia sair daqui achando que
    // testei a leitura de arquivo de verdade, que é coisa que só o Supabase faz.
    storage:{
      from:function(){
        return {
          upload:function(caminho){
            SOBIU.push(caminho);
            return Promise.resolve({data:{path:caminho}, error:null});
          },
          createSignedUrl:function(caminho){
            var b=new Blob(['<meta charset="utf-8"><body style="font:15px system-ui;padding:40px">'+
              '<h2>Arquivo de exemplo</h2><p>Na prévia não existe arquivo de verdade.</p>'+
              '<p style="color:#666">Caminho pedido ao cofre:<br><code>'+caminho+'</code></p>'],
              {type:"text/html"});
            return Promise.resolve({data:{signedUrl:URL.createObjectURL(b)}, error:null});
          }
        };
      }
    },
    rpc:function(nome, args){
      args=args||{}; var v;
      if(nome==="forn_local") v={ok:true,nome:LOCAL,endereco:"Rua André Sales, 531 — Paulo VI, Caicó/RN",
        cnpj:"12988127000140",abre:"07:00",fecha:"17:00",dias:[1,2,3,4,5],
        cobranca:{ativa:true,valor_agenda:5,valor_tonelada:3,
                  aviso:"Este é apenas um informativo. No momento da entrega o valor acima previsto poderá ser cobrado."}};
      else if(nome==="forn_minha_situacao") v={ok:true,liberado:true,empresa:EMP,cnpj:CNPJ,
                                          responsavel:"Marcos Pereira",
                                          situacao_empresa:"aprovado",situacao_conta:"liberada"};
      else if(nome==="forn_inicio") v={ok:true,
        proximas:[LISTA[0],LISTA[1],LISTA[2]],
        contagem:{aguardando:1,confirmadas:2,recebidas:14,canceladas:3}, avisos_novos:2};
      else if(nome==="forn_avisos") v=AVISOS;
      else if(nome==="forn_avisos_lidos") v={ok:true};
      else if(nome==="forn_agenda_lista"){
        var f=(args.p_filtros)||{}, l=LISTA.slice();
        if(f.situacoes&&f.situacoes.length) l=l.filter(function(x){ return f.situacoes.indexOf(x.situacao)>=0; });
        if(f.busca) l=l.filter(function(x){ return (x.ticket+" "+x.pedidos).toLowerCase().indexOf(f.busca.toLowerCase())>=0; });
        if(f.de)  l=l.filter(function(x){ return x.quando.slice(0,10)>=f.de; });
        if(f.ate) l=l.filter(function(x){ return x.quando.slice(0,10)<=f.ate; });
        var tot=l.length, pula=f.pula||0, lim=f.limite||25;
        v={ok:true,total:tot,itens:l.slice(pula,pula+lim)};
      }
      else if(nome==="forn_agenda_periodo"){
        v=LISTA.filter(function(x){ var d=x.quando.slice(0,10); return d>=args.p_de && d<=args.p_ate; });
      }
      else if(nome==="forn_agenda") v=DET[args.p_id]||{ok:false,erro:"Agenda não encontrada."};
      // ANEXOS. O caminho vem daqui, do "banco" — o portal não pode inventar.
      else if(nome==="forn_anexo_caminho"){
        var ext=String(args.p_nome||"").toLowerCase().split(".").pop();
        v=(["pdf","jpg","jpeg","png","webp"].indexOf(ext)<0)
          ? {ok:false,erro:"Só aceitamos PDF, JPG, PNG ou WEBP."}
          : {ok:true, caminho:args.p_agenda+"/previa"+(SOBIU.length+1)+"."+ext, limite:8*1024*1024};
      }
      else if(nome==="forn_anexo_add"){
        var dd=DET[args.p_agenda];
        if(dd) dd.anexos=(dd.anexos||[]).concat([{id:"n"+(dd.anexos.length+1),
          nome:args.p_nome, tipo:args.p_tipo, tamanho:181000, em:"hoje agora"}]);
        v={ok:true,id:"novo"};
      }
      else if(nome==="forn_anexo_ver"){
        var achou=null;
        Object.keys(DET).forEach(function(k){
          (DET[k].anexos||[]).forEach(function(a){ if(a.id===args.p_id) achou=a; });
        });
        v=achou?{ok:true,caminho:"a1/"+achou.id+".pdf",nome:achou.nome}
               :{ok:false,erro:"Arquivo não encontrado."};
      }
      else if(nome==="forn_anexo_tirar"){
        TIROU.push(args.p_id);
        Object.keys(DET).forEach(function(k){
          if(DET[k].anexos) DET[k].anexos=DET[k].anexos.filter(function(a){ return a.id!==args.p_id; });
        });
        v={ok:true};
      }
      // O fornecedor da prévia TEM pedidos em aberto — é o único jeito de eu
      // ver a etapa 2. O 45231 é de propósito: é um dos que os XMLs de teste
      // declaram na tag xPed, então ele deve aparecer marcado sozinho.
      else if(nome==="forn_pedidos") v={ok:true,ligado:true,motivo:"ok",meus:3,pedidos:[
        {id:"pd1",numero:"45231",situacao:"aberto",emissao:"04/08/2026",previsao:"20/08/2026",
         valor:"36227.03",saldo:"1513.50",itens:51,itens_saldo:21},
        {id:"pd2",numero:"45260",situacao:"aberto",emissao:"11/08/2026",previsao:"25/08/2026",
         valor:"8910.00",saldo:"8910.00",itens:11,itens_saldo:11},
        {id:"pd3",numero:"44980",situacao:"aberto",emissao:"29/07/2026",previsao:"18/08/2026",
         valor:"2300.48",saldo:"180.00",itens:17,itens_saldo:3}]};
      // CONFRONTO DA NOTA COM O PEDIDO. Aqui e IMITACAO: no ar quem faz a conta
      // e o banco (forn_conferir_nota). Esta versao existe so para eu ver a tela
      // desenhada com os quatro casos que importam.
      else if(nome==="forn_conferir_nota"){
        var its=(args.p_itens)||[];
        var linhas=[], ok=0, acima=0, fora=0, preco=0;
        its.forEach(function(t,i){
          var sit = i===1 ? "acima" : (i===2 ? "fora" : (i===3 ? "preco" : "ok"));
          if(sit==="ok") ok++; else if(sit==="acima") acima++;
          else if(sit==="fora") fora++; else preco++;
          linhas.push({descricao:t.descricao, ean:t.ean, unidade:t.unidade,
            qtd_nota:t.qtd,
            saldo: sit==="fora" ? null : (sit==="acima" ? 60 : t.qtd+40),
            valor_nota:t.valor_unit,
            valor_pedido: sit==="fora" ? null : (sit==="preco" ? t.valor_unit-0.42 : t.valor_unit),
            pedido: sit==="fora" ? null : "45231",
            situacao:sit,
            motivo: sit==="acima" ? "A nota traz mais do que o pedido ainda espera."
                  : sit==="fora"  ? "Este item nao esta no pedido."
                  : sit==="preco" ? "O preco da nota esta acima do preco do pedido." : null});
        });
        v={ok:true,conferido:true,
           resumo:{itens:its.length,ok:ok,acima:acima,fora:fora,preco:preco,faltando:18,
                   problemas:acima+fora+preco},
           linhas:linhas};
      }
      // IMITACAO do casamento nota x pedido. No ar quem conta e o banco.
      else if(nome==="forn_casar_nota_pedidos"){
        var eans=((args.p_itens)||[]).map(function(x){return x.ean;}).filter(Boolean);
        v={ok:true, comparavel:true, itens_nota:eans.length, pedidos:[
          {numero:"45231", previsao:"2026-08-20", casaram:eans.length, casaram_pendentes:eans.length, tem_ean:true},
          {numero:"45260", previsao:"2026-08-25", casaram:1, casaram_pendentes:1, tem_ean:true},
          {numero:"44980", previsao:"2026-08-18", casaram:0, casaram_pendentes:0, tem_ean:true}]};
      }
      else if(nome==="forn_pedido_itens") v={ok:true,itens:[
        {seq:1,codigo:"28533",descricao:"MACARRAO GOSTOSO 400G ESPAGUETE",qtd_pedida:"3332",qtd_entregue:"0",saldo:"3332",valor_unit:"2.19"},
        {seq:2,codigo:"54879",descricao:"MAC LAMEN VITARELLA 74,3G GALINHA",qtd_pedida:"2750",qtd_entregue:"500",saldo:"2250",valor_unit:"1.19"},
        {seq:3,codigo:"41458",descricao:"BISC ESTRELA 307G MAIZENA TRADICIONAL",qtd_pedida:"1200",qtd_entregue:"1200",saldo:"0",valor_unit:"3.19"}]};
      else if(nome==="forn_horarios_livres") v=horasDoDia(args.p_data, args.p_minutos);
      // As vagas de cada dia do período — é o que acende a bolinha do calendário.
      // Conta pela MESMA função que monta a lista de horas, igual ao banco de
      // verdade (as duas lá saem do receb_choca). Quando eram duas contas
      // separadas, a prévia mostrava "sem horário" no calendário e "6 livres"
      // na lista ao lado — eu quase caí no engano achando que era bug do portal.
      else if(nome==="forn_dias_livres"){
        v=[]; var d=new Date(args.p_de+"T12:00"), ate=new Date(args.p_ate+"T12:00");
        while(d<=ate){
          if(d.getDay()>0 && d.getDay()<6){
            var dia=iso3(d);
            v.push({dia:dia, livres: horasDoDia(dia, args.p_minutos)
                                       .filter(function(x){ return x.livre; }).length});
          }
          d.setDate(d.getDate()+1);
        }
      }
      // A loja da prévia COBRA — é o único jeito de eu ver a etapa 5.
      // Os valores são os do modelo: R$5 por agendamento + R$3 por tonelada.
      else if(nome==="forn_cobranca_previa"){
        var kg=parseFloat(args.p_peso_kg||0)||0, ton=Math.round(kg/1000*1000)/1000;
        var itens=[{chave:"agenda",descricao:"Agenda",unidade:"",valor_unitario:5,quantidade:1,valor:5}];
        var tot=5;
        if(ton>0){ var lin=Math.round(ton*3*100)/100; tot+=lin;
          itens.push({chave:"peso",descricao:"Peso",unidade:"t",valor_unitario:3,quantidade:ton,valor:lin}); }
        v={ok:true,ativa:true,total:Math.round(tot*100)/100,itens:itens,
           aviso:"Este é apenas um informativo. No momento da entrega o valor acima previsto poderá ser cobrado."};
      }
      else if(nome==="forn_cancelar_agenda") v={ok:true};
      else if(nome==="forn_agendar") v={ok:true,id:"novo",hora:"08:00"};
      else v=null;
      return new Promise(function(res){ setTimeout(function(){ res({data:v,error:null}); }, 80); });
    }
  };
  window.supabase={ createClient:function(){ return FAKE; } };

  window.addEventListener("load", function(){
    // A tela de CADASTRO: e a primeira coisa que o fornecedor ve na vida dele.
    // Sem ela o manual comecaria pelo meio da historia.
    if(TELA==="cadastro"){ var t=document.getElementById("tabCriar"); if(t) t.click(); return; }
    if(!TELA||TELA==="login"||TELA==="inicio") return;
    setTimeout(function(){
      var nav=document.querySelectorAll("#nav button");
      if(TELA==="calendario") nav[1].click();
      else if(TELA==="agendas") nav[2].click();
      else if(TELA==="pedidos") nav[3].click();
      else if(TELA==="avisos") document.getElementById("btSino").click();
      else if(TELA==="nova") document.getElementById("btNova").click();
      else if(TELA==="chave"){
        // abre o wizard, escolhe COM NOTA e digita duas chaves de verdade
        function dv(x){ var p=2,s=0;
          for(var i=x.length-1;i>=0;i--){ s+=parseInt(x.charAt(i),10)*p; p++; if(p>9) p=2; }
          var r=s%11; return (r===0||r===1)?0:11-r; }
        function chave(n,c){ var b="24"+"2608"+"11222333000181"+"55"+"001"+n+"1"+c; return b+dv(b); }
        document.getElementById("btNova").click();
        setTimeout(function(){
          document.querySelector(".mcaixa [data-tipo]").click();
          setTimeout(function(){
            document.querySelector("[data-nota=sim]").click();
            setTimeout(function(){
              var i=document.getElementById("wzChave");
              i.value=chave("000128944","00000001"); i.dispatchEvent(new Event("input"));
              setTimeout(function(){
                document.getElementById("wzAddNota").click();
                i.value=chave("000128945","00000002"); i.dispatchEvent(new Event("input"));
                setTimeout(function(){ document.getElementById("wzAddNota").click(); }, 150);
              }, 200);
            }, 250);
          }, 250);
        }, 300);
      }
      else if(TELA==="notas"||TELA==="agendar"||TELA==="resumo"||TELA==="cobranca"||TELA==="docs"||TELA==="horarios"||TELA==="nfe"||TELA==="wzpedidos"||TELA==="confronto"||TELA==="vinculo"||TELA==="escolher"||TELA==="casar"){
        // Uma fila de passos com espera entre eles. Aninhar setTimeout dentro de
        // setTimeout já passou de seis níveis aqui e ficou impossível de mexer.
        // Passo que devolve false encerra a fila — é assim que TELA=notas e
        // TELA=agendar param no meio do caminho.
        function fila(passos){
          (function anda(i){
            if(i>=passos.length) return;
            var seguir=true;
            try{ seguir = passos[i]() !== false; }catch(e){}
            if(!seguir) return;
            setTimeout(function(){ anda(i+1); }, 260);
          })(0);
        }
        function poe(id,v){
          var e=document.getElementById(id); if(!e) return;
          e.value=v; e.dispatchEvent(new Event("input")); e.dispatchEvent(new Event("change"));
        }
        // O campo da chave só aceita "input" (ele reformata enquanto digita);
        // disparar "change" junto faria o valor ser reescrito por cima.
        function poe2(id,v){
          var e=document.getElementById(id); if(!e) return;
          e.value=v; e.dispatchEvent(new Event("input"));
        }
        // Chave de NF-e com dígito verificador certo — chave torta é recusada
        // pelo portal, e aí a prévia nunca chegaria no resumo.
        function chaveDeTeste(numero, cnf){
          function dv(x){ var p=2,s=0;
            for(var i=x.length-1;i>=0;i--){ s+=parseInt(x.charAt(i),10)*p; p++; if(p>9) p=2; }
            var r=s%11; return (r===0||r===1)?0:11-r; }
          var b="24"+"2608"+"11222333000181"+"55"+"001"+numero+"1"+cnf;
          return b+dv(b);
        }
        // Uma NF-e de mentira, mas com tudo que o portal le de verdade: chave com
        // digito certo, destinatario = a loja, e itens com cEAN, xPed e nItemPed.
        // Digitar a chave nao serve aqui: chave sozinha nao traz produto nenhum,
        // e sem produto nao ha o que confrontar.
        function xmlDeTeste(chave){
          var itens=[
            ["101","7896063281967","MACARRAO GOSTOSO 400G ESPAGUETE","CX",120,2.19],
            ["102","7891025301585","MAC LAMEN VITARELLA 74,3G GALINHA","CX",300,1.19],
            ["103","7896279100823","BISC ESTRELA 307G MAIZENA TRADICIONAL","CX",80,3.19],
            ["104","7896004400112","OLEO SOJA VITA 900ML","CX",200,6.85]
          ];
          var det="";
          itens.forEach(function(t,i){
            det+='<det nItem="'+(i+1)+'"><prod>'+
              "<cProd>"+t[0]+"</cProd><cEAN>"+t[1]+"</cEAN><xProd>"+t[2]+"</xProd>"+
              "<NCM>19023000</NCM><CFOP>5102</CFOP><uCom>"+t[3]+"</uCom>"+
              "<qCom>"+t[4].toFixed(4)+"</qCom><vUnCom>"+t[5].toFixed(4)+"</vUnCom>"+
              "<vProd>"+(t[4]*t[5]).toFixed(2)+"</vProd>"+
              "<xPed>45231</xPed><nItemPed>"+(i+1)+"</nItemPed>"+
              "</prod></det>";
          });
          return '<?xml version="1.0" encoding="UTF-8"?>'+
            '<nfeProc><NFe><infNFe Id="NFe'+chave+'" versao="4.00">'+
            "<ide><nNF>128944</nNF><serie>1</serie><dhEmi>2026-08-04T09:12:00-03:00</dhEmi></ide>"+
            "<emit><CNPJ>20947638000141</CNPJ><xNome>Distribuidora Nordeste Alimentos LTDA</xNome></emit>"+
            "<dest><CNPJ>12988127000140</CNPJ><xNome>Supermercado Santa Rita</xNome></dest>"+
            det+
            "<total><ICMSTot><vNF>2334.80</vNF></ICMSTot></total>"+
            "</infNFe></NFe></nfeProc>";
        }
        function soltarXml(){
          var inp=document.getElementById("wzArq"); if(!inp) return;
          var x=xmlDeTeste(chaveDeTeste("000128944","00000001"));
          var dt=new DataTransfer();
          dt.items.add(new File([x], "NFe-128944.xml", {type:"text/xml"}));
          inp.files=dt.files;
          inp.dispatchEvent(new Event("change"));
        }

        fila([
          function(){ document.getElementById("btNova").click(); },
          function(){ var b=document.querySelector(".mcaixa [data-tipo]"); if(b) b.click(); },
          function(){ if(TELA==="notas") return false;
                      // Com nota fiscal: a tabela do resumo só existe se houver nota,
                      // e é justamente a parte que eu preciso conferir com o olho.
                      var r=document.querySelector("[data-nota=sim]"); if(r) r.click(); },
          function(){ if(TELA==="confronto"||TELA==="vinculo"||TELA==="casar"){ soltarXml(); return; } },
          // parada na etapa 1 JA com o XML lido: e aqui que a coluna do pedido
          // aparece preenchida sozinha, que e o que eu preciso ver
          function(){ if(TELA==="vinculo") return false; },
          function(){ if(TELA==="confronto"||TELA==="vinculo"||TELA==="casar") return;
                      poe2("wzChave", chaveDeTeste("000128944","00000001")); },
          function(){ if(TELA==="confronto"||TELA==="vinculo"||TELA==="casar") return; var b=document.getElementById("wzAddNota"); if(b) b.click(); },
          function(){ if(TELA==="confronto"||TELA==="vinculo"||TELA==="casar") return; poe2("wzChave", chaveDeTeste("000128945","00000002")); },
          function(){ if(TELA==="confronto"||TELA==="vinculo"||TELA==="casar") return; var b=document.getElementById("wzAddNota"); if(b) b.click(); },
          // com as duas notas ja lidas: mostra o que o XML preencheu sozinho
          function(){ if(TELA==="nfe") return false; },
          // a janela "Meus pedidos", aberta pelo botao Vincular da primeira nota
          function(){ if(TELA!=="escolher" && TELA!=="casar") return;
                      // no modo casar a nota veio por XML e ja vinculou sozinha:
                      // uso o lapis (trocar) para abrir a mesma janela
                      var b=document.querySelector("[data-vinc]")||document.querySelector("[data-troca]");
                      if(b) b.click(); },
          function(){ if(TELA==="escolher"||TELA==="casar") return false; },
          function(){ document.getElementById("wzAvanca").click(); },
          // depois do Continuar acima estamos na etapa 2 (ou ja na 3, se o
          // fornecedor nao tiver pedido). Um clique a mais leva aos Documentos.
          // parada na etapa 2 do assistente (a dos pedidos de compra). NAO confundir
          // com TELA=pedidos, que e a pagina do menu lateral.
          function(){ if(TELA==="wzpedidos"||TELA==="confronto") return false; },
          function(){ if(!document.getElementById("wzDocSolta")){
                        var b=document.getElementById("wzAvanca"); if(b) b.click(); } },
          function(){ if(TELA==="docs") return false; },
          // SAIR dos Documentos. Faltava este clique: quando a etapa 3 nasceu, a
          // fila parou de andar aqui e TELA=agendar fotografava os Documentos,
          // TELA=cobranca fotografava o Agendamento — tudo deslocado uma etapa,
          // sem erro nenhum na tela. Só se percebe olhando a foto.
          function(){ var b=document.getElementById("wzAvanca"); if(b) b.click(); },
          function(){ if(TELA==="agendar") return false;
                      poe("wzPlaca","QGX1D23"); poe("wzVeic","Toco");
                      poe("wzMot","José Ferreira"); poe("wzMotFone","(84) 99127-7474");
                      poe("wzCarga","Seca"); poe("wzVol","Paletizada"); poe("wzQtd","400");
                      poe("wzObs","Carga precisa de empilhadeira."); poe("wzPeso","84.387"); },
          function(){ var d=document.querySelector(".calx-d[data-dia]:not(.off)"); if(d) d.click(); },
          function(){ var b=document.querySelector(".hslot:not(.ocup)"); if(b) b.click(); },
          // com o dia e a hora ja escolhidos: e esta a foto que mostra a grade
          // de horarios cheia, que e o que o fornecedor mais olha
          function(){ if(TELA==="horarios") return false; },
          function(){ document.getElementById("wzAvanca").click(); },
          function(){ if(TELA==="cobranca") return false;
                      var c=document.getElementById("wzCiente"); if(c){ c.checked=true; c.onchange(); } },
          function(){ var b=document.getElementById("wzAvanca"); if(b) b.click(); }
        ]);
      }
      else if(TELA==="detalhe" || TELA==="comprovante" || TELA==="anexos"){
        nav[2].click();
        setTimeout(function(){
          var t=document.querySelector("#pagina [data-ver]");
          if(t) t.click();
          if(TELA==="anexos") setTimeout(function(){
            var b=document.querySelector('#detCorpo [data-aba="anexos"]');
            if(b) b.click();
          }, 420);
        }, 400);
      }
    }, 420);
  });
})();
</script>`;

h = h.replace(/<script src="https:\/\/cdn\.jsdelivr\.net[^>]*><\/script>/,
              STUB.replace("__TELA__", (process.env.TELA || "").replace(/[^a-z]/g, "")));
h = h.replace("<title>", '<title>PRÉVIA · ');
h = h.replace("</head>", SEM_ANIMACAO + "</head>");

fs.mkdirSync(path.dirname(SAIDA), { recursive: true });
fs.writeFileSync(SAIDA, h);
console.log("PRÉVIA -> " + SAIDA);
