// Entregas — O BOTÃO "SALVAR O DIA" TEM QUE APARECER NO MÊS NOVO.
//
// Caso real (03/09/2026, o funcionário travado): virou o mês e o botão de salvar
// desapareceu. O motivo era um beco sem saída no cliente:
//   entCobrados() lia só entDados (o que já está no servidor) -> mês novo = ninguém
//   -> nenhum dia fica "completo" -> entDiasParaConfirmar() = [] -> nenhum botão
//   -> o que ela digitava não tinha como sair do navegador. Para sempre.
// O que ela digita mora no RASCUNHO, então o rascunho tem que contar.
//
// NÃO duplica a lógica: extrai o módulo ==ENTCOB-*== do painel já construído.
//   node scripts/testes/entregas-botao-salvar.test.cjs
const fs = require("fs");
const path = require("path");

const HTML = fs.readFileSync(path.join(__dirname, "..", "..", "output", "index.html"), "utf8");
const ini = HTML.indexOf("==ENTCOB-INICIO==");
const fim = HTML.indexOf("==ENTCOB-FIM==");
if (ini < 0 || fim < 0) { console.log("ERRO: não achei o módulo ENTCOB no output/index.html (rode o build antes)."); process.exit(1); }
const codigo = HTML.slice(HTML.indexOf("*/", ini) + 2, HTML.lastIndexOf("/*", fim));

// SETEMBRO/2026: dia 1 = terça, 2 = quarta, 3 = quinta (o "hoje" da queixa).
const A = 2026, MES = 8;
const EQUIPE = [
  { id: "a", nome: "Anderson",  ativo: true },
  { id: "f", nome: "Francisco", ativo: true },
  { id: "j", nome: "Joseildo",  ativo: true },
  { id: "n", nome: "Josinaldo", ativo: true },
];

// Só o que o módulo encosta. Nada de DOM.
function carregar(dados, rascunho, equipe, confirmados) {
  const APOIO = `
    var HOJE = new Date(2026, 8, 3);                       // quinta, dia 3
    var entEquipe = ${JSON.stringify(equipe || EQUIPE)};
    var entDados = ${JSON.stringify(dados || {})};
    var entRascunho = ${JSON.stringify(rascunho || {})};
    var entNomes = {};
    var entDiasConf = ${JSON.stringify(confirmados || {})};
    function entMesKey(a,m){ return a+"-"+m; }
    function diasDoMes(a,m){ return new Date(a,m+1,0).getDate(); }
    function entcDiasMes(a,m){ return new Date(a,m+1,0).getDate(); }
    function entFechado(a,m,d){ return new Date(a,m,d).getDay()===0; }   // só domingo
    function entPessoa(id){ for(var i=0;i<entEquipe.length;i++) if(entEquipe[i].id===id) return entEquipe[i]; return null; }
    function entAtivos(){ return entEquipe.filter(function(p){ return p.ativo; }); }
    function entNomeDe(id){ var p=entPessoa(id); return p?p.nome:id; }
    function entIdsDoMes(a,m){
      var mk=entMesKey(a,m), v={}, out=[];
      entAtivos().forEach(function(p){ if(!v[p.id]){ v[p.id]=1; out.push(p.id); } });
      Object.keys(entDados[mk]||{}).forEach(function(id){ if(!v[id]){ v[id]=1; out.push(id); } });
      return out;
    }
    function entRasGet(a,m,id,dia){
      var md=entRascunho[entMesKey(a,m)];
      if(!md||!md[id]||md[id][dia]===undefined) return undefined;
      return md[id][dia];
    }
    function entGetRaw(a,m,id,dia){
      var r=entRasGet(a,m,id,dia); if(r!==undefined) return r;
      var md=entDados[entMesKey(a,m)];
      if(!md||!md[id]||md[id][dia]===undefined) return "";
      return String(md[id][dia]);
    }
    function entDiaConfirmado(a,m,d){ var s=entDiasConf[entMesKey(a,m)]; return !!(s&&s[d]); }
    function entcJaPassou(a,m,d,hoje){
      var h=new Date(hoje.getFullYear(),hoje.getMonth(),hoje.getDate()).getTime();
      return new Date(a,m,d).getTime() < h;
    }
    function entcDiaDaVez(a,m,ehFechado,hoje){
      if(a!==hoje.getFullYear()||m!==hoje.getMonth()) return 0;
      for(var d=hoje.getDate()-1; d>=1; d--){ if(!ehFechado(a,m,d)) return d; }
      return 0;
    }
    function entcDiasAtrasados(a,m,ehFechado,estaApurado,hoje){
      var nd=entcDiasMes(a,m), dv=entcDiaDaVez(a,m,ehFechado,hoje), out=[];
      for(var d=1;d<=nd;d++){
        if(ehFechado(a,m,d)) continue;
        if(!entcJaPassou(a,m,d,hoje)) continue;
        if(d===dv) continue;
        if(estaApurado(d)) continue;
        out.push(d);
      }
      return out;
    }
  `;
  return new Function(APOIO + codigo +
    "\nreturn {entCobrados,entCobradosGrade,entDiasParaConfirmar,entDiasParaGravar," +
    "entDiaApurado,entDiasAtrasados,entFaltaPreencher,entFaltamNoDia,entMesCompleto,entDiaParaLancar};")();
}

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  [" + obtido + "]" + (bate ? "" : "   (esperado: [" + esperado + "])"));
  bate ? ok++ : falhou++;
}
const dia = (d, vals) => { const r = {}; Object.keys(vals).forEach((id) => { r[id] = { [d]: vals[id] }; }); return r; };
const TODOS4 = { a: "12", f: "8", j: "0", n: "5" };

console.log("\n=== O BECO SEM SAÍDA DA VIRADA DO MÊS ===\n");

// ---------------------------------------------------------------------------
// 1) O bug: mês zerado, ela digita o dia 2 inteiro no rascunho.
// ---------------------------------------------------------------------------
{
  const M = carregar({}, { "2026-8": dia(2, TODOS4) });
  // Duas contas de propósito: o DIA cobra a grade inteira; o FECHAMENTO DO MÊS espelha
  // o servidor (só quem tem lançamento gravado). Trocar uma pela outra foi o bug.
  eq("1a) mês novo: o dia cobra os 4 da grade", M.entCobradosGrade(A, MES).sort().join(","), "a,f,j,n");
  eq("1b) e o espelho do servidor segue vazio até salvar", M.entCobrados(A, MES).length, 0);
  eq("2) o dia 2 fica PRONTO PRA SALVAR (era isto que faltava)", M.entDiasParaGravar(A, MES).join(","), "2");
}

// ---------------------------------------------------------------------------
// 2) A prova do bug antigo: sem contar o rascunho, nada é cobrado e nada salva.
// ---------------------------------------------------------------------------
{
  const M = carregar({}, {});
  eq("3) nada digitado: ninguém cobrado", M.entCobrados(A, MES).length, 0);
  eq("4) nada digitado: nenhum dia pra salvar (certo — não há o que salvar)", M.entDiasParaGravar(A, MES).length, 0);
}

// ---------------------------------------------------------------------------
// 3) Dia pela metade NÃO pode virar botão: salvar encerra o dia.
// ---------------------------------------------------------------------------
{
  const M = carregar({}, { "2026-8": dia(2, { a: "12", f: "8" }) });
  eq("5) 2 dos 4 digitados: o dia 2 NÃO está pronto", M.entDiasParaGravar(A, MES).join(","), "");
  eq("6) e a tela sabe dizer quem falta", M.entFaltamNoDia(A, MES, 2).sort().join(","), "Joseildo,Josinaldo");
}

// ---------------------------------------------------------------------------
// 4) ZERO conta, branco não. (feedback_branco_nao_e_zero)
// ---------------------------------------------------------------------------
{
  const M = carregar({}, { "2026-8": dia(2, { a: "0", f: "0", j: "0", n: "0" }) });
  eq("7) dia todo de ZEROS está pronto pra salvar", M.entDiasParaGravar(A, MES).join(","), "2");
}
{
  const M = carregar({}, { "2026-8": dia(2, { a: "12", f: "8", j: "0", n: "" }) });
  eq("8) um campo em BRANCO segura o dia", M.entDiasParaGravar(A, MES).join(","), "");
  eq("9) quem falta é justamente quem ficou em branco", M.entFaltamNoDia(A, MES, 2).join(","), "Josinaldo");
}

// ---------------------------------------------------------------------------
// 5) O DEADLOCK DE 07/08 NÃO PODE VOLTAR.
//    Quem foi cadastrado agora e não tem número no mês não é cobrado em dia passado —
//    senão o mês nunca fecha (o dia já confirmado não aceita mais o zero dele).
// ---------------------------------------------------------------------------
{
  const equipe = EQUIPE.concat([{ id: "novo", nome: "Recém-contratado", ativo: true }]);
  const M = carregar({ "2026-8": dia(2, TODOS4) }, {}, equipe, { "2026-8": { 2: 1 } });
  eq("10) o recém-cadastrado NÃO é cobrado", M.entCobrados(A, MES).indexOf("novo"), -1);
  eq("11) ele aparece na grade, mas cobrado é outra conta", M.entCobradosGrade(A, MES).indexOf("novo") >= 0, true);
}

// ---------------------------------------------------------------------------
// 6) Inativo não é cobrado (a outra metade do conserto de 07/08).
// ---------------------------------------------------------------------------
{
  const equipe = [{ id: "a", nome: "Anderson", ativo: true }, { id: "f", nome: "Francisco", ativo: false }];
  const M = carregar({ "2026-8": dia(2, { a: "12", f: "8" }) }, {}, equipe);
  eq("12) quem saiu não é cobrado, mesmo tendo lançamento no mês",
     M.entCobrados(A, MES).join(","), "a");
  eq("13) e com isso o dia 2 fecha", M.entDiasParaGravar(A, MES).join(","), "2");
}

// ---------------------------------------------------------------------------
// 7) A régua do dia: hoje e o futuro nunca entram; domingo nunca entra.
// ---------------------------------------------------------------------------
{
  const M = carregar({}, { "2026-8": { a: { 3: "9" }, f: { 3: "9" }, j: { 3: "9" }, n: { 3: "9" } } });
  eq("14) dia de HOJE (3) digitado inteiro: ainda não é pra salvar", M.entDiasParaGravar(A, MES).join(","), "");
}
{
  const M = carregar({}, { "2026-8": dia(6, TODOS4) });   // 6/9/2026 = domingo
  eq("15) domingo nunca vira dia pra salvar", M.entDiasParaGravar(A, MES).join(","), "");
}

// ---------------------------------------------------------------------------
// 8) Dia já confirmado sai da fila (não se salva duas vezes).
// ---------------------------------------------------------------------------
{
  const M = carregar({ "2026-8": dia(2, TODOS4) }, {}, EQUIPE, { "2026-8": { 2: 1 } });
  eq("16) dia 2 confirmado: não aparece mais pra salvar", M.entDiasParaGravar(A, MES).join(","), "");
}

// ---------------------------------------------------------------------------
// 9) A queixa visual do mesmo dia continua valendo: dia 1 atrasado, dia 2 é o da vez.
// ---------------------------------------------------------------------------
{
  const M = carregar({}, {});
  eq("17) o dia da vez é o 2", M.entDiaParaLancar(A, MES), 2);
  eq("18) o dia 1 está atrasado", M.entDiasAtrasados(A, MES).join(","), "1");
}
{
  const M = carregar({}, { "2026-8": dia(2, TODOS4) });
  eq("19) digitar o dia 2 não conserta o atraso do dia 1", M.entDiasAtrasados(A, MES).join(","), "1");
  // entFaltaPreencher espelha o SERVIDOR (só quem tem lançamento GRAVADO no mês), então
  // com tudo em rascunho ela não acusa nada — quem acusa o dia 1 é o atraso, acima.
  eq("20) a pendência do fechamento continua espelhando o servidor",
     M.entFaltaPreencher(A, MES).length, 0);
}

// ---------------------------------------------------------------------------
// 10) Loja sem entregador cadastrado: não cobra nada de ninguém.
// ---------------------------------------------------------------------------
{
  const M = carregar({}, {}, []);
  eq("21) sem equipe: nenhum atraso", M.entDiasAtrasados(A, MES).length, 0);
  eq("22) sem equipe: mês nunca é 'completo'", M.entMesCompleto(A, MES), false);
}

console.log("\n" + (falhou ? "FALHOU: " + falhou + " de " + (ok + falhou) : "TUDO OK: " + ok + " testes"));
process.exit(falhou ? 1 : 0);
