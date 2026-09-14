// Testes da FILA DE ENVIO da Manutenção (14/09/2026).
// O defeito: a tela mostrava o serviço como salvo mesmo quando a nuvem recusava (o erro vinha
// dentro da resposta e ninguém olhava), e quem salvava antes da lista carregar nunca subia
// nada — na recarga seguinte o serviço sumia. Estes testes RODAM o módulo ==MANFILA-*== do
// painel já construído contra uma nuvem de mentira que recusa, aceita e perde fotos.
//   npx tsx scripts/demoDashboard.ts && node scripts/testes/manutencao-fila.test.cjs
const fs = require("fs");
const path = require("path");

const HTML = fs.readFileSync(path.join(__dirname, "..", "..", "output", "index.html"), "utf8");
const ini = HTML.indexOf("==MANFILA-INICIO==");
const fim = HTML.indexOf("==MANFILA-FIM==");
if (ini < 0 || fim < 0) { console.log("ERRO: não achei o módulo ==MANFILA== no output/index.html (rode o build antes)."); process.exit(1); }
const modulo = HTML.slice(HTML.indexOf("*/", ini) + 2, HTML.lastIndexOf("/*", fim));

// pega uma função inteira do painel contando chaves
function pegar(nome) {
  const a = HTML.indexOf("function " + nome + "(");
  if (a < 0) throw new Error("não achei a função " + nome);
  let i = HTML.indexOf("{", a), n = 0;
  for (; i < HTML.length; i++) { if (HTML[i] === "{") n++; else if (HTML[i] === "}") { n--; if (n === 0) break; } }
  return HTML.slice(a, i + 1);
}
const demoVars = HTML.slice(HTML.indexOf("var MAN_DEMO_FONES"), HTML.indexOf(";", HTML.indexOf("var MAN_DEMO_FONES")) + 1);
const codigo = [demoVars, pegar("manSemDemo"), pegar("manEqToRow"), pegar("manRegToRow"), pegar("manFotoUpload"), pegar("manEsc"), modulo].join("\n");

function novoLS() {
  const d = {};
  return { getItem: k => (k in d ? d[k] : null), setItem: (k, v) => { d[k] = String(v); }, removeItem: k => { delete d[k]; }, _d: d };
}

// nuvem de mentira: cfg.recusa = mensagem de erro da tabela; cfg.fotoFalha = upload dá erro
function novaNuvem(cfg) {
  const log = [];
  const resp = (tabela, op, dados) => new Promise(res => setTimeout(() => {
    log.push({ tabela, op, dados });
    res(cfg.recusa ? { data: null, error: { message: cfg.recusa } } : { data: [], error: null });
  }, 1));
  return {
    log,
    from: tabela => ({
      upsert: dados => resp(tabela, "upsert", dados),
      delete: () => ({ eq: (c, v) => resp(tabela, "delete", { [c]: v }) }),
    }),
    storage: { from: () => ({
      upload: p => new Promise(res => setTimeout(() => { log.push({ tabela: "foto", op: "upload", dados: p }); res(cfg.fotoFalha ? { error: { message: "falhou" } } : { error: null }); }, 1)),
      getPublicUrl: p => ({ data: { publicUrl: "https://nuvem/storage/v1/object/public/manutencoes/" + p } }),
    }) },
  };
}

function carregar(cfg) {
  const ls = novoLS();
  const avisos = [], carregou = [];
  const sb = cfg.semLogin ? null : novaNuvem(cfg);
  const ctx = new Function("localStorage", "window", "uiConfirm", "sb", "cloudOK", "manCloudLoadFalso",
    "var manData={equipamentos:[],registros:[]}, manCloudOK=cloudOK, manCarregando=false, manPendDel={}, manPendDelR={};" +
    "function manSB(){ return sb; } function manSave(){ return true; } function manCloudLoad(){ manCloudLoadFalso(); }\n" +
    codigo +
    "\nreturn {get manData(){return manData;}, set manData(v){manData=v;}, set manCloudOK(v){manCloudOK=v;}," +
    "manFilaPor,manFilaQtd,manFilaLer,manFilaJuntar,manFilaEnviar,manFilaTirarEq,manCloudDelEq,manErroTexto,manSemDemo, get manFilaErro(){return manFilaErro;}};"
  )(ls, {}, o => { avisos.push(o); return Promise.resolve(true); }, sb, cfg.cloudOK !== false, () => carregou.push(1));
  return { M: ctx, sb, ls, avisos, carregou };
}

let ok = 0, falhou = 0;
const vale = (nome, cond, det) => { console.log((cond ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + det); cond ? ok++ : falhou++; };

const EQ = { id: "eTESTE1", nome: "Balanças Caixa 101", tipo: "Balança", local: "Frente de caixa", intervalo: 7 };
const REG = { id: "rTESTE1", idEq: "eTESTE1", data: "2026-09-14", tipo: "Conferência / aferição", responsavel: "Layze", custo: 0, obs: "", fotoA: "data:image/jpeg;base64,/9j/AA==", fotoD: "", pesoRef: 10, pesoMed: 10.02 };

(async () => {
  console.log("\n=== 1) A nuvem RECUSA: nada pode sumir e o motivo aparece ===\n");
  {
    const t = carregar({ recusa: "new row violates row-level security policy for table \"manutencao_registros\"" });
    t.M.manData = { equipamentos: [EQ], registros: [REG] };
    t.M.manFilaPor("eqs", EQ); t.M.manFilaPor("regs", REG);
    const deu = await t.M.manFilaEnviar(true);
    vale("envio diz que NÃO deu certo", deu === false, String(deu));
    vale("os 2 lançamentos continuam na fila", t.M.manFilaQtd() === 2, "fila=" + t.M.manFilaQtd());
    vale("a pessoa é avisada na hora (salvou ela mesma)", t.avisos.length === 1, t.avisos.map(a => a.titulo).join("|"));
    vale("o motivo vem em português", /não tem permissão/.test(t.M.manFilaErro), t.M.manFilaErro);
    vale("a fila ficou guardada no aparelho", JSON.parse(t.ls.getItem("man_fila")).regs.rTESTE1.responsavel === "Layze", "man_fila gravada");
    // a nuvem recarrega por cima, sem o serviço
    t.M.manData = t.M.manFilaJuntar([], []);
    vale("recarga da nuvem NÃO apaga o serviço da tela", t.M.manData.registros.length === 1 && t.M.manData.equipamentos.length === 1, t.M.manData.registros.length + " serviço(s)");
    const t2 = carregar({ recusa: "Could not find the 'peso_medido' column of 'manutencao_registros' in the schema cache" });
    t2.M.manFilaPor("eqs", EQ); await t2.M.manFilaEnviar(false);
    vale("coluna faltando vira aviso claro", /falta uma coluna/.test(t2.M.manFilaErro), t2.M.manFilaErro);
    vale("tentativa automática (não foi a pessoa) não abre janela", t2.avisos.length === 0, t2.avisos.length + " janela(s)");
  }

  console.log("\n=== 2) Salvou ANTES da lista carregar da nuvem ===\n");
  {
    const t = carregar({ cloudOK: false });
    t.M.manFilaPor("regs", REG);
    const deu = await t.M.manFilaEnviar(true);
    vale("não tenta mandar sem saber se a nuvem está pronta", t.sb.log.length === 0 && deu === false, t.sb.log.length + " envio(s)");
    vale("pede pra carregar a nuvem (que depois manda a fila)", t.carregou.length === 1, t.carregou.length + " pedido(s)");
    vale("o serviço continua guardado", t.M.manFilaQtd() === 1, "fila=" + t.M.manFilaQtd());
    // a nuvem carregou (sem o serviço) e liberou
    t.M.manData = t.M.manFilaJuntar([EQ], []);
    vale("a lista que chegou da nuvem traz o serviço junto", t.M.manData.registros.some(r => r.id === "rTESTE1"), t.M.manData.registros.length + " serviço(s)");
    t.M.manCloudOK = true;
    await t.M.manFilaEnviar(false);
    vale("aí sim ele sobe", t.sb.log.some(l => l.tabela === "manutencao_registros"), t.sb.log.map(l => l.tabela + ":" + l.op).join(", "));
    vale("e sai da fila", t.M.manFilaQtd() === 0, "fila=" + t.M.manFilaQtd());
  }

  console.log("\n=== 3) Caminho feliz: equipamento antes, foto antes do serviço ===\n");
  {
    const t = carregar({});
    t.M.manData = { equipamentos: [EQ], registros: [JSON.parse(JSON.stringify(REG))] };
    t.M.manFilaPor("regs", REG); t.M.manFilaPor("eqs", EQ);
    const deu = await t.M.manFilaEnviar(true);
    const ordem = t.sb.log.map(l => l.tabela);
    vale("deu certo", deu === true, String(deu));
    vale("equipamento sobe antes do serviço", ordem.indexOf("manutencao_equipamentos") < ordem.indexOf("manutencao_registros"), ordem.join(" → "));
    vale("foto sobe antes do serviço", ordem.indexOf("foto") < ordem.indexOf("manutencao_registros"), ordem.join(" → "));
    const row = t.sb.log.find(l => l.tabela === "manutencao_registros").dados;
    vale("serviço vai com o endereço da foto, nunca a foto em texto", /rTESTE1_a\.jpg$/.test(row.foto_antes) && row.foto_antes.indexOf("data:") !== 0, row.foto_antes);
    vale("peso vai junto", row.peso_ref === 10 && row.peso_medido === 10.02, row.peso_ref + " / " + row.peso_medido);
    vale("fila vazia e sem aviso", t.M.manFilaQtd() === 0 && t.avisos.length === 0, "fila=" + t.M.manFilaQtd());
    vale("a tela troca a foto em texto pelo endereço", /rTESTE1_a\.jpg$/.test(t.M.manData.registros[0].fotoA), t.M.manData.registros[0].fotoA.slice(-20));
  }

  console.log("\n=== 4) A foto não subiu ===\n");
  {
    const t = carregar({ fotoFalha: true });
    t.M.manFilaPor("regs", REG);
    await t.M.manFilaEnviar(false);
    vale("serviço NÃO vai sem a foto que a pessoa tirou", !t.sb.log.some(l => l.tabela === "manutencao_registros"), t.sb.log.map(l => l.tabela).join(", "));
    vale("fica na fila pra tentar de novo", t.M.manFilaQtd() === 1, "fila=" + t.M.manFilaQtd());
    vale("motivo: a foto", /foto/.test(t.M.manFilaErro), t.M.manFilaErro);
  }

  console.log("\n=== 5) Editou enquanto subia / duas chamadas juntas ===\n");
  {
    const t = carregar({});
    t.M.manFilaPor("eqs", EQ);
    const p = t.M.manFilaEnviar(false);
    t.M.manFilaPor("eqs", Object.assign({}, EQ, { nome: "Balanças Caixa 101 (novo nome)" }));
    const p2 = t.M.manFilaEnviar(false);          // chega enquanto a primeira ainda está subindo
    await p; await p2; await new Promise(r => setTimeout(r, 20));
    const nomes = t.sb.log.filter(l => l.tabela === "manutencao_equipamentos").map(l => l.dados.nome);
    vale("a versão editada também sobe", nomes[nomes.length - 1] === "Balanças Caixa 101 (novo nome)", nomes.join(" | "));
    vale("e aí a fila esvazia", t.M.manFilaQtd() === 0, "fila=" + t.M.manFilaQtd());
  }

  console.log("\n=== 6) Apagar ===\n");
  {
    const t = carregar({});
    t.M.manFilaPor("eqs", EQ); t.M.manFilaPor("regs", REG); t.M.manFilaPor("regs", Object.assign({}, REG, { id: "rOUTRO", idEq: "eOUTRO" }));
    t.M.manFilaTirarEq("eTESTE1");
    const f = t.M.manFilaLer();
    vale("apagar equipamento tira ele e os serviços dele da fila", !f.eqs.eTESTE1 && !f.regs.rTESTE1 && !!f.regs.rOUTRO, Object.keys(f.regs).join(","));
    const t2 = carregar({ recusa: "permission denied for table manutencao_equipamentos" });
    t2.M.manCloudDelEq("eTESTE1");
    await new Promise(r => setTimeout(r, 20));
    vale("se a nuvem recusar o apagar, a pessoa é avisada", t2.avisos.some(a => /apagar/.test(a.titulo)), t2.avisos.map(a => a.titulo).join("|"));
    vale("e a lista recarrega (o item volta)", t2.carregou.length === 1, t2.carregou.length + " recarga(s)");
  }

  console.log("\n=== 7) Equipamentos de demonstração ===\n");
  {
    const t = carregar({});
    const o = t.M.manSemDemo({
      equipamentos: [
        { id: "emr1abc12", nome: "Gerador", responsavel: "Energia Service", telefone: "(84) 98888-5678" },
        { id: "emr1abc13", nome: "Ar-condicionado Frente de Caixa", responsavel: "Refrigeração Caicó", telefone: "(84) 99999-1234" },
        { id: "emrar8pr2350", nome: "Balcão Refrigerado Frios", responsavel: "", telefone: "" },
        { id: "emr9b5cgj174", nome: "Camera Fria de Congelado", responsavel: "Layze", telefone: "" },
      ],
      registros: [{ id: "r1", idEq: "emr1abc12" }, { id: "r2", idEq: "emr9b5cgj174" }],
    });
    vale("tira os de mentira do aparelho", o.equipamentos.map(e => e.nome).join(",") === "Balcão Refrigerado Frios,Camera Fria de Congelado", o.equipamentos.map(e => e.nome).join(","));
    vale("e os serviços de mentira junto, mantendo os reais", o.registros.map(r => r.id).join(",") === "r2", o.registros.map(r => r.id).join(","));
    const fonte = fs.readFileSync(path.join(__dirname, "..", "demoDashboard.ts"), "utf8");
    vale("o painel não planta mais demonstração", fonte.indexOf("function manSeed") < 0 && HTML.indexOf("Refrigeração Caicó\",telefone") < 0, "manSeed ausente");
  }

  console.log("\n=== 8) Sem login ===\n");
  {
    const t = carregar({ semLogin: true });
    t.M.manFilaPor("regs", REG);
    const deu = await t.M.manFilaEnviar(true);
    vale("não quebra e não finge que subiu", deu === false && t.M.manFilaQtd() === 1, "fila=" + t.M.manFilaQtd());
  }

  console.log(`\n${ok} OK, ${falhou} falha(s)\n`);
  process.exit(falhou ? 1 : 0);
})();
