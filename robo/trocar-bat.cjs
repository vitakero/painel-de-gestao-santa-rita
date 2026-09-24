// ==TROCAR-BAT== Troca um .bat pela versao nova DEPOIS que ele termina de rodar.
//
// Por que existe (24/09/2026): o robo.bat da loja nunca se atualizava. O Windows le o .bat
// linha por linha ENQUANTO ele roda, entao o puxar-codigo (que e chamado de dentro dele) nao
// pode reescreve-lo — e "deixar para a proxima" nunca chegava, porque a proxima vez tambem e
// de dentro dele. Ficou parado em 27/08; o passo [1.95/4] do Compra x Venda nunca rodou la.
//
// Agora o puxar-codigo grava a versao nova ao lado (robo.bat.novo) e me lanca DESTACADO,
// passando o numero do cmd que esta rodando o .bat. Eu espero esse cmd terminar e so entao
// troco. Na hora da troca nao sobra nenhuma linha para o Windows ler.
//
// Uso:  node scripts/trocar-bat.cjs <pid do cmd> <caminho do .bat> <senha de conferencia>
// Nunca derruba nada: na duvida, NAO troco e deixo o .bat atual (que funciona).
const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const ESPERA_MAX_MS = +process.env.TROCAR_ESPERA_MAX_MS || 20 * 60 * 1000;
const PASSO_MS = +process.env.TROCAR_PASSO_MS || 1000;

function dormir(ms) { return new Promise((r) => setTimeout(r, ms)); }

// process.kill(pid, 0) nao mata: so pergunta se o processo existe (Windows e Mac).
function vivo(pid) {
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === "EPERM"; }
}

// Na loja, confiro que o numero e mesmo de um cmd.exe. Se fosse de outro processo (por
// exemplo um node intermediario), ele morreria antes do .bat terminar e eu trocaria o arquivo
// no meio da rodada — exatamente o que isto existe para evitar. Sem confirmar, nao troco.
function ehCmd(pid) {
  if (process.platform !== "win32") return true;
  try {
    const r = cp.spawnSync("tasklist", ["/FI", "PID eq " + pid, "/NH", "/FO", "CSV"],
                           { encoding: "utf8", windowsHide: true, timeout: 15000 });
    return /"cmd\.exe"/i.test(r.stdout || "");
  } catch (e) { return false; }
}

// .bat sem quebra de linha do Windows faz o cmd errar em rotulos e goto.
function valido(txt, senha) { return !!senha && txt.indexOf(senha) >= 0 && txt.indexOf("\r\n") > 0; }

async function trocar(pid, bat, senha) {
  const novo = bat + ".novo";
  if (!(pid > 0)) return "sem-pid";
  if (!ehCmd(pid)) return "nao-e-cmd";
  const t0 = Date.now();
  while (vivo(pid)) {
    if (Date.now() - t0 > ESPERA_MAX_MS) return "desisti-de-esperar";
    await dormir(PASSO_MS);
  }
  let txt;
  try { txt = fs.readFileSync(novo, "utf8"); } catch (e) { return "sem-novo"; }
  if (!valido(txt, senha)) return "novo-invalido";
  try {
    if (fs.readFileSync(bat, "utf8") === txt) { fs.unlinkSync(novo); return "ja-igual"; }
    fs.copyFileSync(bat, bat + ".anterior");   // a versao que funcionava fica guardada para voltar
  } catch (e) {}
  fs.renameSync(novo, bat);
  return "trocado";
}

// Conta o resultado para a nuvem (receb_eventos, acao "trocar-bat"), para eu conferir daqui
// sem ninguem abrir o AnyDesk.
function contar(bat, resultado) {
  if (process.env.TROCAR_SEM_NUVEM) return;
  try {
    const log = path.join(path.dirname(bat), "trocar-bat.log");
    fs.writeFileSync(log, new Date().toISOString() + " " + path.basename(bat) + ": " + resultado + "\r\n");
    const ml = path.join(__dirname, "mandar-log.cjs");
    if (fs.existsSync(ml)) cp.spawnSync(process.execPath, [ml, log, "trocar-bat"],
                                        { stdio: "ignore", windowsHide: true, timeout: 60000 });
  } catch (e) {}
}

if (require.main === module) {
  const pid = +process.argv[2], bat = process.argv[3], senha = process.argv[4];
  trocar(pid, bat, senha)
    .catch((e) => "erro: " + e.message)
    .then((res) => { if (process.env.TROCAR_DIZ) console.log(res); if (bat) contar(bat, res); });
}

module.exports = { trocar, valido };
