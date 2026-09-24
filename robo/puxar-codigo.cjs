// Baixa o codigo mais recente do GitHub via API (api.github.com).
// Motivo: o raw.githubusercontent.com falha/cacheia na rede da loja, entao o robo
// ficava preso no codigo antigo. A api.github.com e o mesmo caminho que o publicar.cjs
// usa com sucesso, entao e confiavel aqui.
// Roda no inicio do robo.bat (antes de gerar o painel). Se algo falhar, mantem o
// codigo atual (nunca quebra a rodada).
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
let env = "";
try { env = fs.readFileSync(path.join(root, ".env"), "utf8"); } catch (e) {}
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim() : ""; };
const TOKEN = get("GITHUB_TOKEN");
const OWNER = "vitakero";
const REPO = "painel-de-gestao-santa-rita";

// [arquivo no GitHub (pasta robo/), destino local em scripts/, marcador de validade]
//
// O marcador e um pedaco de texto que TEM que existir dentro do arquivo baixado.
// Use NOME DE TABELA, nunca frase de comentario: tres destes ficaram meses
// recusando a atualizacao porque o marcador foi escrito sem acento ("le") e o
// arquivo tinha acento ("le" com circunflexo). O robo dizia "invalido - mantendo
// o atual" e ninguem lia. Nome de tabela nao tem acento e so muda se o script
// mudar de proposito.
// IMPORTANTE: este arquivo baixa a SI MESMO por último — assim ele nunca fica desatualizado
// sozinho (a rodada atual segue com o código antigo; a PRÓXIMA rodada já usa o novo).
const FILES = [
  ["robo/demoDashboard.ts", "demoDashboard.ts", "vr-data.json"],
  // O texto do Regulamento Interno. TEM que vir ANTES do build: o demoDashboard.ts le
  // este arquivo e, sem ele, a reconstrucao do painel quebra. Vai para ../assets/ (fora
  // de scripts/) porque e la que o build procura. Marcador = o CNPJ: sem acento e fixo.
  ["robo/regulamento-interno.json", "../assets/regulamento-interno.json", "12.988.127/0001-40"],
  ["robo/regulamento-interno.pdf.b64", "../assets/regulamento-interno.pdf.b64", "REGULAMENTO-PDF-B64"],
  ["robo/central/feed.client.js", "central/feed.client.js", "CENTRAL OPERACIONAL"],   // tela da Central (subpasta)
  ["robo/central/sw.js", "central/sw.js", "CENTRAL PWA SW"],   // (2.5) service worker do PWA
  ["robo/buildVrData.cjs", "buildVrData.cjs", "vr-data.json"],
  ["robo/publicar.cjs", "publicar.cjs", "PUBLICADO"],
  ["robo/pixWorker.cjs", "pixWorker.cjs", "pix_cobrancas"],
  ["robo/vr-descobrir-agendamento.cjs", "vr-descobrir-agendamento.cjs", "DETETIVE do VR"],
  // Este subia pro GitHub e a loja nunca baixava (mesmo buraco do vr-sync-conferencia):
  // quem rodasse na mao dentro da loja pegaria uma versao velha.
  ["robo/vr-descobrir-agendamento2.cjs", "vr-descobrir-agendamento2.cjs", "agendamentorecebimento"],
  ["robo/vr-sync-agendamento.cjs", "vr-sync-agendamento.cjs", "central_agendamentos"],
  // Faltava aqui: o deploy MANDAVA este arquivo pro GitHub e a loja nunca BAIXAVA.
  // Por isso a aba Conferencia so atualizava quando alguem rodava na mao, de dentro da loja.
  ["robo/vr-sync-conferencia.cjs", "vr-sync-conferencia.cjs", "notaentradacoletor"],
  ["robo/vr-sync-despesas.cjs", "vr-sync-despesas.cjs", "despesas_resumo"],
  ["robo/vr-descobrir-pedidos.cjs", "vr-descobrir-pedidos.cjs", "DETETIVE do VR"],
  ["robo/vr-descobrir-pedidos2.cjs", "vr-descobrir-pedidos2.cjs", "DETETIVE 2 do VR"],
  ["robo/vr-medir-pedidos.cjs", "vr-medir-pedidos.cjs", "MEDIDOR"],
  ["robo/vr-sync-pedidos.cjs", "vr-sync-pedidos.cjs", "receb_pedido_itens"],
  ["robo/vr-descobrir-perdas.cjs", "vr-descobrir-perdas.cjs", "receb_eventos"],
  ["robo/vr-conferir-setor.cjs", "vr-conferir-setor.cjs", "mercadologico"],
  ["robo/vr-descobrir-notas.cjs", "vr-descobrir-notas.cjs", "vr_notas"],
  ["robo/mandar-log.cjs", "mandar-log.cjs", "receb_eventos"],
  // o conferidor de pecas: e a PRIMEIRA coisa que o robo.bat chama. Se ele nao chegar
  // na loja, o robo se recusa a rodar (o .bat trata o arquivo faltando como falha).
  ["robo/conferir-pecas.cjs", "conferir-pecas.cjs", "CONFIG_OBRIGATORIA"],
  // o "passo da vez" da investigacao das notas: o notas.bat chama sempre este nome
  ["robo/notas-passo.cjs", "notas-passo.cjs", "vr_notas2"],
  ["robo/vr-sync-notas.cjs", "vr-sync-notas.cjs", "receb_notas_vr"],
  ["robo/vr-sync-codigos.cjs", "vr-sync-codigos.cjs", "receb_codigos_fornecedor"],
  // .bat de clicar duas vezes: vai para a RAIZ (C:\\vr-robo), nao para scripts/
  // COMPRA × VENDA (24/09/2026). A tela (4 arquivos) é lida pelo demoDashboard.ts no build;
  // a extração e o mapa de setores, pelo vr-sync-compras.cjs. Marcador ASCII de propósito.
  ["robo/compras-x-venda/calculo.cjs", "compras-x-venda/calculo.cjs", "==CXV-CALC=="],
  ["robo/compras-x-venda/tela.js", "compras-x-venda/tela.js", "==CXV-TELA=="],
  ["robo/compras-x-venda/tela.css", "compras-x-venda/tela.css", "==CXV-CSS=="],
  ["robo/compras-x-venda/painel.js", "compras-x-venda/painel.js", "==CXV-PAINEL=="],
  ["robo/compras-x-venda/extrair-vr.cjs", "compras-x-venda/extrair-vr.cjs", "notaentradaitem"],
  ["robo/compras-x-venda/mapa-inicial.json", "compras-x-venda/mapa-inicial.json", "id_produto"],
  ["robo/vr-sync-compras.cjs", "vr-sync-compras.cjs", "compras_retrato"],
  // o ajudante que troca o .bat DEPOIS da rodada. Tem que vir ANTES dos .bat nesta lista:
  // e na vez deles que eu o chamo.
  ["robo/trocar-bat.cjs", "trocar-bat.cjs", "==TROCAR-BAT=="],
  ["robo/notas.bat", "../notas.bat", "NOTAS-BAT"],
  ["robo/robo.bat", "../robo.bat", "ROBO-BAT"],
  ["robo/puxar-codigo.cjs", "puxar-codigo.cjs", "Baixa o codigo mais recente do GitHub via API"],
];

const headers = {
  Authorization: "Bearer " + TOKEN,
  Accept: "application/vnd.github.raw",
  "User-Agent": "robo-painel",
  "X-GitHub-Api-Version": "2022-11-28",
};

/* O .BAT QUE ESTA RODANDO: GUARDO AO LADO E TROCO QUANDO ELE TERMINAR.
   Ate 24/09/2026 eu so pulava ("guardo para a proxima") — e a proxima nunca chegava, porque
   eu sempre sou chamado de dentro dele. O robo.bat ficou parado em 27/08.
   Agora gravo <bat>.novo e lanco o trocar-bat.cjs destacado, com o numero do cmd que roda o
   .bat. Ele espera esse cmd terminar e troca. O numero certo e o do meu PAI — mas so quando
   o cmd me chamou direto. Se eu fui relancado por um puxar-codigo antigo (que nao repassa
   PID_DO_BAT), meu pai e um node que morre ANTES do .bat: ai so guardo, e a troca fica para
   a rodada seguinte, em que eu ja sou o primeiro. */
function guardarParaDepois(dest, txt, marker, local) {
  fs.writeFileSync(dest + ".novo", txt);
  const pid = process.env.PID_DO_BAT ||
              (process.argv.indexOf("--jaatualizei") < 0 ? String(process.ppid) : "");
  const ajudante = path.join(__dirname, "trocar-bat.cjs");
  if (!pid || !fs.existsSync(ajudante)) {
    console.log("  (" + local + " tem versao nova - guardei ao lado; troco na proxima rodada)");
    return false;
  }
  const c = require("child_process").spawn(process.execPath, [ajudante, pid, dest, marker],
    { detached: true, stdio: "ignore", windowsHide: true, cwd: path.dirname(dest) });
  c.unref();
  console.log("  (" + local + " tem versao nova - troco assim que esta rodada terminar)");
  return true;
}
module.exports = { guardarParaDepois };

if (require.main === module) (async () => {
  if (!TOKEN) { console.log("  (sem GITHUB_TOKEN no .env - mantendo o codigo atual)"); return; }

  /* EU ME ATUALIZO PRIMEIRO.
     A lista de arquivos mora aqui dentro. Enquanto eu me atualizava por ULTIMO, um arquivo
     novo só era conhecido na rodada seguinte — o Victor teve que rodar o robo duas vezes
     para o mesmo arquivo, duas vezes em dois dias.
     Agora: baixo a mim mesmo antes de tudo; se eu mudei, gravo e me chamo de novo, já com
     a lista nova. O argumento evita laco infinito: na segunda vez eu pulo esta parte. */
  if (process.argv.indexOf("--jaatualizei") < 0) {
    try {
      const eu = await fetch("https://api.github.com/repos/" + OWNER + "/" + REPO +
                             "/contents/robo/puxar-codigo.cjs", { headers });
      if (eu.ok) {
        const novo = await eu.text();
        const atual = fs.readFileSync(__filename, "utf8");
        if (novo.indexOf("Baixa o codigo mais recente do GitHub") >= 0 && novo !== atual) {
          fs.writeFileSync(__filename, novo);
          console.log("  atualizado: puxar-codigo.cjs (recomecando com a lista nova)");
          // repasso o numero do cmd: la dentro, meu "pai" seria eu, nao o cmd do .bat
          const r = require("child_process").spawnSync(process.execPath,
            [__filename, "--jaatualizei"], { stdio: "inherit",
              env: Object.assign({}, process.env, { PID_DO_BAT: process.env.PID_DO_BAT || String(process.ppid) }) });
          process.exit(r.status || 0);
        }
      }
    } catch (e) { console.log("  (nao consegui me atualizar: " + e.message + ")"); }
  }

  for (const [remote, local, marker] of FILES) {
    try {
      const r = await fetch("https://api.github.com/repos/" + OWNER + "/" + REPO + "/contents/" + remote, { headers });
      if (!r.ok) { console.log("  (sem atualizacao de " + local + " - HTTP " + r.status + ")"); continue; }
      const txt = await r.text();
      if (txt.indexOf(marker) === -1) { console.log("  (" + local + " invalido - mantendo o atual)"); continue; }
      const dest = path.join(__dirname, local);
      // So gravo se MUDOU. Antes eu regravava tudo toda rodada; com o notas.bat isso
      // vira problema de verdade, porque o Windows le o .bat linha por linha ENQUANTO
      // ele roda - reescrever o arquivo no meio da execucao embaralha o que falta rodar.
      let igual = false;
      try { igual = fs.readFileSync(dest, "utf8") === txt; } catch (e) {}
      if (igual) {
        // versao guardada que ficou velha (voltaram o arquivo no GitHub): nao pode ser trocada depois
        if (fs.existsSync(dest + ".novo")) { try { fs.unlinkSync(dest + ".novo"); } catch (e) {} }
        continue;
      }
      // O .bat que me chamou nao pode ser reescrito enquanto roda: o Windows le o
      // arquivo linha por linha DURANTE a execucao, entao trocar o conteudo no meio
      // embaralha o que ainda falta rodar. Vai ao lado e e trocado quando ele terminar.
      if (process.env.RODANDO_BAT && path.basename(dest) === process.env.RODANDO_BAT) {
        guardarParaDepois(dest, txt, marker, local);
        continue;
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });   // garante subpasta (ex.: central/) antes de gravar
      fs.writeFileSync(dest, txt);
      console.log("  atualizado: " + local);
    } catch (e) {
      console.log("  (erro ao baixar " + local + ": " + e.message + " - mantendo o atual)");
    }
  }
})();
