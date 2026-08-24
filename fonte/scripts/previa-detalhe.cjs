// Gera uma PRÉVIA da janela "Detalhes do agendamento", com dados de verdade.
// Usa o CSS e as classes do arquivo publicado — o desenho é o do portal, não uma imitação.
//   node scripts/previa-detalhe.cjs
// Isto NUNCA vai pro ar.
require("dotenv").config({ path: require("path").join(process.env.HOME, "vr-looker-integration", ".env") });
const fs = require("fs"), path = require("path");
const RAIZ = path.join(process.env.HOME, "vr-looker-integration");
const U = process.env.SUPABASE_URL, K = process.env.SUPABASE_SERVICE_KEY;
const H = { apikey: K, Authorization: "Bearer " + K };
const esc = t => String(t == null ? "" : t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

(async () => {
  const html = fs.readFileSync(path.join(RAIZ, "output", "agendar.html"), "utf8");
  const est = (html.match(/<style>[\s\S]*?<\/style>/) || [""])[0];
  const ic = k => { const m = html.match(new RegExp(k + ":'(<svg[^']*)'")); return m ? m[1] : ""; };

  const pega = async q => { const r = await fetch(U + "/rest/v1/" + q, { headers: H }); return r.ok ? r.json() : []; };
  const a = (await pega("receb_agendas?select=*&order=criado_em.desc&limit=1"))[0];
  const forn = (await pega("receb_fornecedores?select=razao_social,cnpj&id=eq." + a.fornecedor_id))[0] || {};
  const loc = (await pega("receb_locais?select=nome,endereco&limit=1"))[0] || {};
  const doca = (await pega("receb_docas?select=nome&limit=1"))[0] || {};
  const jan = String(a.janela || "");
  const de = (jan.match(/\[?"([^"]+)"/) || [])[1], ate = (jan.match(/,"([^"]+)"\)/) || [])[1];
  const hh = t => t ? new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";
  const dd = t => t ? new Date(t).toLocaleDateString("pt-BR") : "";

  const campo = (r, v) => '<div class="cp"><label>' + esc(r) + '</label><div>' + (v ? esc(v) : "—") + "</div></div>";
  // conteúdo LONGO de propósito: é com pouca coisa que o defeito se esconde
  const itensNota = await pega("receb_notas_vr?select=itens&emitente_cnpj=eq." + (forn.cnpj || "").replace(/\D/g, "") + "&order=emissao.desc&limit=1");
  const prods = (itensNota[0] && itensNota[0].itens) || [];
  const corpo =
    '<div class="campos">' +
    campo("Solicitante", "Victor") + campo("Fornecedor", forn.razao_social) +
    campo("CNPJ", forn.cnpj) + campo("Local de entrega", loc.nome) +
    campo("Endereço", loc.endereco) + campo("Doca", doca.nome) +
    campo("Horário solicitado", dd(de) + " às " + hh(de) + " até " + hh(ate)) +
    campo("Horário confirmado", dd(de) + " às " + hh(de) + " até " + hh(ate)) +
    campo("Duração prevista", a.minutos_estimados + " min") +
    campo("Tipo de carga", a.tipo_carga) + campo("Tipo de volume", a.tipo_volume) +
    campo("Qtd. de volumes", a.qtd_volumes) + campo("Peso", a.peso_kg + " kg") +
    campo("Tipo de caminhão", a.tipo_veiculo) + campo("Placa", a.placa) +
    campo("Motorista", a.motorista) + campo("Telefone do motorista", a.motorista_fone) +
    "</div>" +
    (prods.length ? '<h4 style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#8a949c;margin:18px 0 6px">' +
      "O que vem nesta nota — " + prods.length + " produtos</h4>" +
      '<table class="res-tab"><thead><tr><th>Produto</th><th class="n">Qtd</th><th class="n">Unitário</th></tr></thead><tbody>' +
      prods.map(x => "<tr><td><b>" + esc(x.descricao) + "</b></td><td class=\"n\">" +
        esc(x.qtd) + " " + esc(x.unidade || "") + '</td><td class="n">R$ ' + esc(x.valor_unit) + "</td></tr>").join("") +
      "</tbody></table>" : "");

  const ABAS = [["informacoes", "Informações"], ["notas", "Notas Fiscais"], ["pedidos", "Pedidos"],
                ["obs", "Observações"], ["anexos", "Anexos"], ["dev", "Devoluções"]];

  // A ESTRUTURA TEM QUE SER A DE VERDADE, INVOLUCRO INCLUIDO.
  // O uiModal monta:  .mfundo > .mcaixa[tam] > .mcab + <corpo>
  // e a janela de detalhes passa como corpo um <div id="detCorpo" class="mrola">.
  // Na primeira versao desta previa eu pulei esse involucro e montei o conteudo direto
  // na caixa. Resultado: rolava na previa e travava no portal, porque o CSS usava
  // "filho direto" e nao atravessava o #detCorpo. Previa que nao reproduz a estrutura
  // de verdade nao prova nada — foi assim que eu publiquei um conserto que nao consertava.
  const modal =
    '<div class="mfundo" style="position:fixed"><div class="mcaixa alto">' +
    '<div class="mcab"><b>Detalhes do agendamento</b>' +
    '<button class="icone"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
    '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>' +
    '<div id="detCorpo" class="mrola">' +
    '<div class="det-cab">' +
      '<div class="quem"><b>' + esc(forn.razao_social) + '</b><span>' + esc(loc.nome) + " · " + esc(doca.nome) + '</span></div>' +
      '<div class="par"><span class="ic">' + ic("cal") + '</span><div><label>Data</label>' +
        '<div>' + dd(de) + '<br>' + hh(de) + " – " + hh(ate) + '</div></div></div>' +
      '<div class="par"><span class="ic">' + ic("tag") + '</span><div><label>Ticket</label>' +
        '<div>' + esc(a.ticket) + '</div></div></div>' +
      '<div class="fim"><span class="selo solicitada">aguardando</span></div></div>' +
    '<div class="det-corpo"><div class="det-main">' +
      '<div class="abas">' + ABAS.map((x, i) => '<button' + (i ? "" : ' class="on"') + ">" + x[1] + "</button>").join("") + "</div>" +
      '<div id="detAba">' + corpo + "</div></div>" +
      '<div class="det-lado">' +
        '<button>' + ic("imprimir") + "Imprimir comprovante</button>" +
        '<button>' + ic("remarcar") + "Reagendamento</button>" +
        '<button class="perigo">' + ic("cancelar") + "Cancelar agendamento</button>" +
      "</div></div></div></div>";

  const pag = '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1"><title>Prévia — Detalhes do agendamento</title>' +
    est + '</head><body style="margin:0">' + modal + "</body></html>";
  const saida = path.join(RAIZ, ".previa", "previa-detalhe.html");
  fs.writeFileSync(saida, pag);
  console.log("PRÉVIA -> " + saida + "  (" + Math.round(pag.length / 1024) + " KB)  ticket " + a.ticket);
})();
