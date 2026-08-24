// Gera uma PRÉVIA do comprovante de agendamento, com dados de verdade.
//
// Não imita o comprovante: extrai a função comprovante() do arquivo publicado
// (output/agendar.html) e roda ela. O que aparece na prévia é, letra por letra, o que
// o fornecedor vai imprimir — se eu desenhasse uma imitação, ela envelheceria sozinha.
//
//   node scripts/previa-comprovante.cjs            -> usa o último agendamento real
// Isto NUNCA vai pro ar.
require("dotenv").config({ path: require("path").join(process.env.HOME, "vr-looker-integration", ".env") });
const fs = require("fs"), path = require("path");
const RAIZ = path.join(process.env.HOME, "vr-looker-integration");
const U = process.env.SUPABASE_URL, K = process.env.SUPABASE_SERVICE_KEY;
const H = { apikey: K, Authorization: "Bearer " + K };

// recorta uma função inteira do arquivo publicado, contando as chaves.
// Cortar "até o próximo function" parece mais simples e quebra: a próxima palavra
// "function" costuma estar DENTRO da função que se quer recortar.
function recortaFn(txt, ini) {
  const i = txt.indexOf(ini);
  if (i < 0) throw new Error("não achei: " + ini);
  let n = 0, dentro = false;
  for (let k = i; k < txt.length; k++) {
    const c = txt[k];
    if (c === "{") { n++; dentro = true; }
    else if (c === "}") { n--; if (dentro && n === 0) return txt.slice(i, k + 1); }
  }
  throw new Error("não achei o fim de: " + ini);
}
// para trechos que não são função (uma declaração de variável, por exemplo)
function recorta(txt, ini, fim) {
  const i = txt.indexOf(ini);
  if (i < 0) throw new Error("não achei: " + ini);
  const j = txt.indexOf(fim, i);
  if (j < 0) throw new Error("não achei o fim de: " + ini);
  return txt.slice(i, j);
}

(async () => {
  const html = fs.readFileSync(path.join(RAIZ, "output", "agendar.html"), "utf8");
  const logo = (html.match(/src="(data:image\/[^"]{200,})"/) || [])[1] || "";

  // as peças que o comprovante usa, tiradas do próprio arquivo publicado
  const pedacos = [
    recortaFn(html, "function partes(iso){"),
    recortaFn(html, "function cnpjFmt(s){"),
    recorta(html, "var TXT_SIT={", "var TXT_TIPO="),
    // corto ANTES da parte que manda imprimir e devolvo o documento montado:
    // aqui não há iframe nem impressora, só o HTML que interessa ver
    recorta(html, "function comprovante(d){", "var f=el(\"impressora\");") + "return doc;}",
  ].join("\n");

  // o que o comprovante espera do resto do portal
  const apoio = `
    var DOWS=["domingo","segunda-feira","terça-feira","quarta-feira","quinta-feira","sexta-feira","sábado"];
    var DOW3=["dom","seg","ter","qua","qui","sex","sáb"];
    var MES3=["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
    function deIso(s){ var d=new Date(String(s).slice(0,19).replace(" ","T")); return isNaN(d)?null:d; }
    function cnpjLimpo(s){ return String(s||"").replace(/\\D/g,""); }
    function esc(t){ return String(t==null?"":t).replace(/[&<>"]/g,function(c){
      return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]; }); }
    function numero(v,c){ var x=parseFloat(v); if(isNaN(x)) return "";
      return x.toLocaleString("pt-BR",{minimumFractionDigits:c||0,maximumFractionDigits:c||3}); }
    var location={origin:"https://portaldofornecedor.supermercadosantarita.com.br",pathname:"/"};
  `;

  // dados de verdade do último agendamento
  const pega = async q => { const r = await fetch(U + "/rest/v1/" + q, { headers: H }); return r.ok ? r.json() : []; };
  const a = (await pega("receb_agendas?select=*&order=criado_em.desc&limit=1"))[0];
  if (!a) { console.log("não há agendamento para usar de exemplo"); return; }
  const notas = await pega("receb_agenda_notas?select=chave,numero&agenda_id=eq." + a.id);
  const peds = await pega("receb_agenda_pedidos?select=numero&agenda_id=eq." + a.id);
  const forn = (await pega("receb_fornecedores?select=razao_social,cnpj&id=eq." + a.fornecedor_id))[0] || {};
  const loc = (await pega("receb_locais?select=nome,endereco&limit=1"))[0] || {};
  const doca = (await pega("receb_docas?select=nome&limit=1"))[0] || {};
  const jan = String(a.janela || "");
  const ini = (jan.match(/\[?"([^"]+)"/) || [])[1] || a.inicio_solicitado;
  const fim = (jan.match(/,"([^"]+)"\)/) || [])[1] || null;
  const hhmm = t => t ? new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";
  const iso = t => t ? new Date(new Date(t).getTime() - 3 * 3600000).toISOString().slice(0, 16) : null;

  const d = {
    ticket: a.ticket, situacao: a.situacao,
    fornecedor: forn.razao_social, cnpj: forn.cnpj,
    transportadora_cnpj: a.transportadora_cnpj,
    local: loc.nome, endereco: loc.endereco, doca: doca.nome,
    solicitada: iso(a.inicio_solicitado), confirmada: a.confirmada_em ? iso(ini) : null,
    solicitada_ate: hhmm(fim), confirmada_ate: a.confirmada_em ? hhmm(fim) : null,
    minutos: a.minutos_estimados,
    tipo_carga: a.tipo_carga, tipo_volume: a.tipo_volume,
    qtd_volumes: a.qtd_volumes, peso_kg: a.peso_kg,
    motorista: a.motorista, motorista_fone: a.motorista_fone,
    tipo_veiculo: a.tipo_veiculo, placa: a.placa,
    notas_fiscais: notas, lista_pedidos: peds,
  };

  const fn = new Function(apoio + pedacos + "\nreturn comprovante;");
  let capturado = fn()(d);
  if (!capturado) { console.log("não consegui capturar o comprovante"); return; }
  capturado = capturado.replace('src="${LOGO}"', 'src="' + logo + '"');

  const saida = path.join(RAIZ, ".previa", "previa-comprovante.html");
  fs.mkdirSync(path.dirname(saida), { recursive: true });
  fs.writeFileSync(saida, capturado);
  console.log("PRÉVIA -> " + saida + "  (" + Math.round(capturado.length / 1024) + " KB)  ticket " + a.ticket);
})();
