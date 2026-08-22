// Testes da SUBIDA PARA A NUVEM (o pedaço que grava e apaga no Supabase).
//
// Nasceram de um defeito real, 11/08/2026: o dono removia uma receita, atualizava a página
// e a receita VOLTAVA. Causa: quando a regra de acesso do banco barra um DELETE, o PostgREST
// não devolve erro nenhum — apaga zero linhas e responde "deu certo". O painel dava por
// apagado, e no carregamento seguinte a linha descia da nuvem de volta, calada.
//
// Se um destes cair, alguém vai apagar uma coisa que não foi apagada — e não vai saber.
//   node scripts/testes/sync-nuvem.test.cjs
const fs = require("fs");
const path = require("path");

const HTML = fs.readFileSync(path.join(__dirname, "..", "..", "output", "index.html"), "utf8");
function bloco(marca) {
  const i = HTML.indexOf("==" + marca + "-INICIO==");
  const f = HTML.indexOf("==" + marca + "-FIM==");
  if (i < 0 || f < 0) { console.log("ERRO: não achei o módulo " + marca + " (rode o build antes)."); process.exit(1); }
  return HTML.slice(HTML.indexOf("*/", i) + 2, HTML.lastIndexOf("/*", f));
}

// ---------------------------------------------------------------- dublê do Supabase
// Fiel ao que o supabase-js entrega: .upsert(x).then(), .select("id").then(),
// .select("id").in("id",[..]).then(), .delete().in("id",[..]).then().
function clienteFake(est) {
  function tabela(tab) {
    function linhas() { est.tabs[tab] = est.tabs[tab] || []; return est.tabs[tab]; }
    function resolver(fn) {
      return {
        in: function (col, ids) { return resolver(function () { return fn(ids); }); },
        then: function (ok, err) {
          setTimeout(function () {
            let r;
            try { r = fn(null); } catch (e) { if (err) err(e); return; }
            if (r && r.__cai) { if (err) err(new Error(r.__cai)); return; }
            ok(r);
          }, 0);
          return this;
        },
      };
    }
    return {
      upsert: function (rows) {
        return resolver(function () {
          est.upserts = (est.upserts || 0) + 1;
          if (est.upsertErro) return { error: { message: est.upsertErro }, data: null };
          if (est.redeCai) return { __cai: "rede" };
          const L = linhas();
          (Array.isArray(rows) ? rows : [rows]).forEach(function (row) {
            let i = -1; L.forEach(function (x, ix) { if (x.id === row.id) i = ix; });
            if (i >= 0) L[i] = row; else L.push(row);
          });
          return { data: rows, error: null };
        });
      },
      select: function () {
        return resolver(function (ids) {
          if (est.selectErro) return { error: { message: est.selectErro }, data: null };
          let L = linhas().map(function (x) { return { id: x.id }; });
          if (ids) L = L.filter(function (x) { return ids.indexOf(x.id) >= 0; });
          return { data: L, error: null };
        });
      },
      delete: function () {
        return resolver(function (ids) {
          est.deletes = (est.deletes || 0) + 1;
          if (est.deleteErro) return { error: { message: est.deleteErro }, data: null };
          // A REGRA DE ACESSO BARRANDO NÃO É ERRO: zero linhas apagadas, resposta "ok".
          if (!est.deleteBarrado) {
            est.tabs[tab] = linhas().filter(function (x) { return !ids || ids.indexOf(x.id) < 0; });
          }
          return { data: null, error: null };
        });
      },
    };
  }
  return { from: tabela };
}

// ---------------------------------------------------------------- harness
const APOIO = `
  var loja={};
  var _set=function(alvo,k,v){ loja[k]=String(v); };
  _set.call=function(alvo,k,v){ loja[k]=String(v); };
  var window={ localStorage:{ getItem:function(k){ return (k in loja)?loja[k]:null; },
                              setItem:function(k,v){ loja[k]=String(v); } },
               addEventListener:function(){}, __ouvintes:[] };
  var pronto=false, lastPush={}, debs={};
  var CLIENTE=null;
  function sb(){ return CLIENTE; }
  function podeVer(m){ return m.__negado?false:true; }
  function parseVal(v){ try{ return JSON.parse(v); }catch(e){ return v; } }
  function itemId(m,item,ix){
    if(item && typeof item==="object"){
      if(item.id!=null && item.id!=="") return String(item.id);
      if(item._sid) return item._sid;
      item._sid=m.chave+"_s"+ix; return item._sid;
    }
    return m.chave+"_v_"+ix;
  }
  var porChave={};
`;
const SAIDA = `
  return {
    pushChave: pushChave,
    flush: function(k,cb){ return window.__syncFlush(k,cb); },
    ligar: function(c){ CLIENTE=c; },
    prontoSim: function(){ pronto=true; },
    mapear: function(m){ porChave[m.chave]=m; },
    esperaCurta: function(){ window.__syncEspera=2; },
    guardar: function(k,v){ loja[k]=v; },
    ler: function(k){ return loja[k]; },
    agendar: function(k){ debs[k]=setTimeout(function(){ debs["__disparou_"+k]=1; pushChave(k); },800); },
    disparou: function(k){ return !!debs["__disparou_"+k]; },
    pendente: function(k){ return !!debs[k]; }
  };
`;
function novoSync() {
  return new Function(APOIO + bloco("SYNCPUSH") + SAIDA)();
}

// ---------------------------------------------------------------- placar
let ok = 0, falhou = 0;
function t(nome, cond, extra) {
  if (cond) { ok++; } else { falhou++; console.log("  FALHOU: " + nome + (extra ? "  -> " + extra : "")); }
}
const espera = () => new Promise((r) => setTimeout(r, 20));

const MAPA_REC = { chave: "receitas_dados", tabela: "receitas", modo: "array" };

async function subir(sync, chave) {
  return new Promise(function (res) { sync.pushChave(chave, function (e) { res(e); }); });
}

(async function () {
  // 1) caminho feliz: remover a última receita esvazia a nuvem, sem reclamação
  {
    const est = { tabs: { receitas: [{ id: "rc_1" }] } };
    const s = novoSync(); s.ligar(clienteFake(est)); s.prontoSim(); s.mapear(MAPA_REC);
    s.guardar("receitas_dados", "[]");
    const erro = await subir(s, "receitas_dados");
    t("removeu a última: sumiu da nuvem", est.tabs.receitas.length === 0, JSON.stringify(est.tabs.receitas));
    t("removeu a última: não avisa erro à toa", erro === null, String(erro));
  }

  // 2) O DEFEITO ORIGINAL: banco barra o DELETE sem devolver erro -> tem que avisar
  {
    const est = { tabs: { receitas: [{ id: "rc_1" }] }, deleteBarrado: true };
    const s = novoSync(); s.ligar(clienteFake(est)); s.prontoSim(); s.mapear(MAPA_REC);
    s.guardar("receitas_dados", "[]");
    const erro = await subir(s, "receitas_dados");
    t("banco barrou o apagar: a linha continua lá", est.tabs.receitas.length === 1);
    t("banco barrou o apagar: o painel PERCEBE", !!erro && /permiss/i.test(erro), String(erro));
  }

  // 3) apagar 1 de 3 mexe só na certa
  {
    const est = { tabs: { receitas: [{ id: "a" }, { id: "b" }, { id: "c" }] } };
    const s = novoSync(); s.ligar(clienteFake(est)); s.prontoSim(); s.mapear(MAPA_REC);
    s.guardar("receitas_dados", JSON.stringify([{ id: "a" }, { id: "c" }]));
    const erro = await subir(s, "receitas_dados");
    const ids = est.tabs.receitas.map((x) => x.id).sort().join(",");
    t("apagou só a do meio", ids === "a,c", ids);
    t("apagou só a do meio: sem reclamação", erro === null);
  }

  // 4) se o SALVAR falhou, não pode sair apagando o resto
  {
    const est = { tabs: { receitas: [{ id: "a" }, { id: "b" }] }, upsertErro: "sem permissão" };
    const s = novoSync(); s.ligar(clienteFake(est)); s.prontoSim(); s.mapear(MAPA_REC);
    s.guardar("receitas_dados", JSON.stringify([{ id: "a" }]));
    const erro = await subir(s, "receitas_dados");
    t("salvar falhou: avisa", !!erro && /permiss/i.test(erro), String(erro));
    t("salvar falhou: NÃO apaga nada", est.tabs.receitas.length === 2 && !est.deletes);
  }

  // 5) a leitura da nuvem falhando não pode virar "apaguei tudo"
  {
    const est = { tabs: { receitas: [{ id: "a" }] }, selectErro: "caiu" };
    const s = novoSync(); s.ligar(clienteFake(est)); s.prontoSim(); s.mapear(MAPA_REC);
    s.guardar("receitas_dados", "[]");
    await subir(s, "receitas_dados");
    t("leitura falhou: não apaga às cegas", !est.deletes);
  }

  // 6) rede caindo no salvar: avisa e não apaga
  {
    const est = { tabs: { receitas: [{ id: "a" }, { id: "b" }] }, redeCai: true };
    const s = novoSync(); s.ligar(clienteFake(est)); s.prontoSim(); s.mapear(MAPA_REC);
    s.guardar("receitas_dados", JSON.stringify([{ id: "a" }]));
    const erro = await subir(s, "receitas_dados");
    t("rede caiu: avisa", !!erro, String(erro));
    t("rede caiu: não apaga", est.tabs.receitas.length === 2);
  }

  // 7) documento (modo doc): erro do banco chega na tela
  {
    const est = { tabs: { configuracoes: [] }, upsertErro: "recusado" };
    const s = novoSync(); s.ligar(clienteFake(est)); s.prontoSim();
    s.mapear({ chave: "rcb_config", tabela: "configuracoes", modo: "doc", rowId: "rcb_config" });
    s.guardar("rcb_config", '{"a":1}');
    const erro = await subir(s, "rcb_config");
    t("documento: erro do banco avisa", !!erro && /recus/i.test(erro), String(erro));
  }
  {
    const est = { tabs: { configuracoes: [] } };
    const s = novoSync(); s.ligar(clienteFake(est)); s.prontoSim();
    s.mapear({ chave: "rcb_config", tabela: "configuracoes", modo: "doc", rowId: "rcb_config" });
    s.guardar("rcb_config", '{"a":1}');
    const erro = await subir(s, "rcb_config");
    t("documento: gravou", est.tabs.configuracoes.length === 1 && erro === null);
  }

  // 8) TRAVA DE SEGURANÇA: sem a nuvem lida, NADA sobe (senão o dado velho daqui
  //    apagaria na nuvem o que outra pessoa acabou de lançar)
  {
    const est = { tabs: { receitas: [{ id: "a" }, { id: "b" }] } };
    const s = novoSync(); s.ligar(clienteFake(est)); s.mapear(MAPA_REC); s.esperaCurta(); // sem prontoSim()
    s.guardar("receitas_dados", "[]");
    const erro = await new Promise((r) => s.flush("receitas_dados", r));
    t("nuvem ainda carregando: não sobe nada", est.tabs.receitas.length === 2 && !est.deletes);
    t("nuvem que nunca responde: explica o porquê", !!erro && /nao respondeu/i.test(erro), String(erro));
  }

  // 8b) ALARME FALSO: salvar 1 segundo depois do login (nuvem ainda chegando) tem que
  //     ESPERAR e dar certo - e não abrir um alerta na cara do dono.
  {
    const est = { tabs: { receitas: [{ id: "a" }] } };
    const s = novoSync(); s.ligar(clienteFake(est)); s.mapear(MAPA_REC); s.esperaCurta();
    s.guardar("receitas_dados", "[]");
    const prom = new Promise((r) => s.flush("receitas_dados", r));
    setTimeout(function () { s.prontoSim(); }, 15);   // a nuvem chega logo depois
    const erro = await prom;
    t("nuvem chegou atrasada: espera e conclui", erro === null, String(erro));
    t("nuvem chegou atrasada: apagou de verdade", est.tabs.receitas.length === 0);
  }

  // 9) o flush não pode deixar o timer de 800ms disparar de novo depois
  {
    const est = { tabs: { receitas: [{ id: "a" }] } };
    const s = novoSync(); s.ligar(clienteFake(est)); s.prontoSim(); s.mapear(MAPA_REC);
    s.guardar("receitas_dados", "[]");
    s.agendar("receitas_dados");
    t("antes do flush havia espera pendente", s.pendente("receitas_dados"));
    await new Promise((r) => s.flush("receitas_dados", r));
    t("flush cancelou a espera de 800ms", !s.pendente("receitas_dados"));
    await new Promise((r) => setTimeout(r, 900));
    t("a espera cancelada não disparou depois", !s.disparou("receitas_dados"));
    t("flush apagou de verdade", est.tabs.receitas.length === 0);
  }

  // 10) painel sem nuvem (teste local / sem login): não quebra e não inventa erro
  {
    const s = novoSync(); s.mapear(MAPA_REC); s.guardar("receitas_dados", "[]");
    const erro = await new Promise((r) => s.flush("receitas_dados", r));
    t("sem nuvem: não inventa erro", erro === null, String(erro));
  }

  // 11) quem não tem acesso à página não sobe (nem apaga) aquele dado
  {
    const est = { tabs: { receitas: [{ id: "a" }] } };
    const s = novoSync(); s.ligar(clienteFake(est)); s.prontoSim();
    s.mapear({ chave: "receitas_dados", tabela: "receitas", modo: "array", __negado: true });
    s.guardar("receitas_dados", "[]");
    await subir(s, "receitas_dados");
    t("sem acesso: não mexe na nuvem", est.tabs.receitas.length === 1 && !est.deletes);
  }

  // 12) chave que não existe no mapa não deve estourar
  {
    const s = novoSync(); s.ligar(clienteFake({ tabs: {} })); s.prontoSim();
    let quebrou = false;
    try { await subir(s, "chave_inexistente"); } catch (e) { quebrou = true; }
    t("chave desconhecida não quebra", !quebrou);
  }

  // 13) o aviso é chamado UMA vez só (senão o dono vê o mesmo alerta duas vezes)
  {
    const est = { tabs: { receitas: [{ id: "a" }] }, deleteBarrado: true };
    const s = novoSync(); s.ligar(clienteFake(est)); s.prontoSim(); s.mapear(MAPA_REC);
    s.guardar("receitas_dados", "[]");
    let vezes = 0;
    s.pushChave("receitas_dados", function () { vezes++; });
    await espera(); await espera();
    t("avisa uma vez só", vezes === 1, "avisou " + vezes + "x");
  }

  console.log(falhou ? ("FALHOU: " + falhou + " de " + (ok + falhou)) : ("TUDO OK: " + ok + " testes"));
  process.exit(falhou ? 1 : 0);
})();
