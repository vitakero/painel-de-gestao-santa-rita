// Testes da TROCA DO .BAT (trocar-bat.cjs + guardarParaDepois do puxar-codigo).
//
// Nasceram de 24/09/2026: o robo.bat da loja nunca se atualizava — o puxar-codigo "guardava
// para a proxima" e a proxima nunca chegava. Ficou parado desde 27/08 e o passo 1.95 (Compra x
// Venda) nunca rodou la. Aqui a troca RODA de verdade: um processo falso faz o papel do cmd
// que esta executando o .bat, e eu confiro que o arquivo so muda DEPOIS que ele termina.
//   node scripts/testes/trocar-bat.test.cjs
const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");

const RAIZ = path.join(__dirname, "..", "..");
const SCRIPTS = path.join(RAIZ, "scripts");
const AJUDANTE = path.join(SCRIPTS, "trocar-bat.cjs");
process.env.TROCAR_SEM_NUVEM = "1";   // herdado pelos ajudantes destacados: nada vai para a nuvem
process.env.TROCAR_PASSO_MS = "100";

let ok = 0, falhou = 0;
function t(nome, cond, extra) {
  if (cond) { ok++; return; }
  falhou++; console.log("  FALHOU: " + nome + (extra ? " -> " + extra : ""));
}
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const VELHO = "@echo off\r\nREM ROBO-BAT\r\necho velho\r\n";
const NOVO = "@echo off\r\nREM ROBO-BAT\r\necho novo\r\n";

function pasta() { return fs.mkdtempSync(path.join(os.tmpdir(), "trocar-bat-")); }
// o "cmd" falso: um processo que vive ms milissegundos
function cmdFalso(ms) { return cp.spawn(process.execPath, ["-e", "setTimeout(()=>{}," + ms + ")"]); }
function ajudante(pid, bat, senha, env) {
  return new Promise((res) => {
    const c = cp.spawn(process.execPath, [AJUDANTE, String(pid), bat, senha],
      { env: Object.assign({}, process.env, { TROCAR_DIZ: "1" }, env || {}) });
    let out = ""; c.stdout.on("data", (d) => out += d);
    c.on("close", () => res(out.trim()));
  });
}
const ler = (f) => { try { return fs.readFileSync(f, "utf8"); } catch (e) { return null; } };
async function esperarAte(cond, ms) { const t0 = Date.now(); while (!cond() && Date.now() - t0 < ms) await dormir(50); }

(async () => {
  // 1) caso normal: espera o cmd terminar e so entao troca, guardando a versao anterior
  {
    const d = pasta(), bat = path.join(d, "robo.bat");
    fs.writeFileSync(bat, VELHO); fs.writeFileSync(bat + ".novo", NOVO);
    const cmd = cmdFalso(1200);
    const fim = ajudante(cmd.pid, bat, "ROBO-BAT");
    await dormir(600);
    t("enquanto o .bat roda, o arquivo NAO muda", ler(bat) === VELHO);
    const res = await fim;
    t("depois que ele termina, troca", res === "trocado" && ler(bat) === NOVO, res);
    t("o .novo some depois da troca", ler(bat + ".novo") === null);
    t("a versao anterior fica guardada", ler(bat + ".anterior") === VELHO);
  }
  // 2) versao nova sem a senha de conferencia: nao troca
  {
    const d = pasta(), bat = path.join(d, "robo.bat");
    fs.writeFileSync(bat, VELHO); fs.writeFileSync(bat + ".novo", "@echo off\r\necho quebrado\r\n");
    const res = await ajudante(99999999, bat, "ROBO-BAT");
    t("sem a senha, nao troca", res === "novo-invalido" && ler(bat) === VELHO, res);
  }
  // 3) versao nova com quebra de linha de Linux: nao troca (o cmd erra rotulo e goto)
  {
    const d = pasta(), bat = path.join(d, "robo.bat");
    fs.writeFileSync(bat, VELHO); fs.writeFileSync(bat + ".novo", NOVO.replace(/\r\n/g, "\n"));
    const res = await ajudante(99999999, bat, "ROBO-BAT");
    t("sem CRLF, nao troca", res === "novo-invalido" && ler(bat) === VELHO, res);
  }
  // 4) o cmd nunca termina: desiste e deixa o .bat como esta
  {
    const d = pasta(), bat = path.join(d, "robo.bat");
    fs.writeFileSync(bat, VELHO); fs.writeFileSync(bat + ".novo", NOVO);
    const cmd = cmdFalso(3000);
    const res = await ajudante(cmd.pid, bat, "ROBO-BAT", { TROCAR_ESPERA_MAX_MS: "400" });
    t("passou do tempo, desiste sem trocar", res === "desisti-de-esperar" && ler(bat) === VELHO, res);
    cmd.kill();
  }
  // 5) sem numero de processo: nao troca
  {
    const d = pasta(), bat = path.join(d, "robo.bat");
    fs.writeFileSync(bat, VELHO); fs.writeFileSync(bat + ".novo", NOVO);
    const res = await ajudante("", bat, "ROBO-BAT");
    t("sem pid, nao troca", res === "sem-pid" && ler(bat) === VELHO, res);
  }

  // 6) o puxar-codigo de ponta a ponta: grava ao lado, lanca o ajudante destacado,
  //    e a troca acontece quando o "cmd" termina.
  const { guardarParaDepois } = require(path.join(SCRIPTS, "puxar-codigo.cjs"));
  {
    const d = pasta(), bat = path.join(d, "robo.bat");
    fs.writeFileSync(bat, VELHO);
    const cmd = cmdFalso(1000);
    process.env.PID_DO_BAT = String(cmd.pid);
    const lancou = guardarParaDepois(bat, NOVO, "ROBO-BAT", "../robo.bat");
    delete process.env.PID_DO_BAT;
    t("puxar-codigo lanca o ajudante", lancou === true);
    t("puxar-codigo nao encosta no .bat que roda", ler(bat) === VELHO && ler(bat + ".novo") === NOVO);
    await esperarAte(() => ler(bat) === NOVO, 5000);
    t("quando a rodada termina, o .bat e trocado", ler(bat) === NOVO);
  }
  // 7) relancado por um puxar-codigo ANTIGO (sem PID_DO_BAT): o pai e um node que morre antes
  //    do .bat. So guarda; nao lanca ajudante nenhum.
  {
    const d = pasta(), bat = path.join(d, "robo.bat");
    fs.writeFileSync(bat, VELHO);
    process.argv.push("--jaatualizei");
    const lancou = guardarParaDepois(bat, NOVO, "ROBO-BAT", "../robo.bat");
    process.argv.pop();
    await dormir(800);
    t("sem saber quem e o cmd, so guarda", lancou === false && ler(bat) === VELHO && ler(bat + ".novo") === NOVO);
  }

  // 8) as pecas no lugar
  const PUXAR = fs.readFileSync(path.join(SCRIPTS, "puxar-codigo.cjs"), "utf8");
  const ROBO = fs.readFileSync(path.join(RAIZ, "robo.bat"), "utf8");
  const BUILD = fs.readFileSync(path.join(SCRIPTS, "buildVrData.cjs"), "utf8");
  t("o ajudante e baixado ANTES dos .bat",
    PUXAR.indexOf('"robo/trocar-bat.cjs"') > 0 && PUXAR.indexOf('"robo/trocar-bat.cjs"') < PUXAR.indexOf('"robo/notas.bat"'));
  t("o relancamento repassa o numero do cmd", PUXAR.indexOf("PID_DO_BAT: process.env.PID_DO_BAT") > 0);
  t("o robo.bat novo se anuncia (RODADA_V=2)", ROBO.indexOf("set RODADA_V=2\r\n") > 0);
  t("o robo.bat chama o passo 1.95", ROBO.indexOf("vr-sync-compras.cjs") > 0);
  t("o buildVrData se cala quando o robo.bat novo chama o 1.95", BUILD.indexOf('process.env.RODADA_V==="2"') > 0);

  console.log(falhou ? ("FALHOU: " + falhou + " de " + (ok + falhou)) : ("TUDO OK: " + ok + " testes"));
  process.exit(falhou ? 1 : 0);
})();
