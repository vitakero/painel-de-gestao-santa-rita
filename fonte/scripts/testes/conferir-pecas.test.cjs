// Testa o conferidor de peças do robô — CADA jeito de dar errado, não só o caminho feliz.
//
// O caso real que deu origem a isso (27/08/2026): a pasta do robô na loja foi reextraída
// de um zip velho. Sumiu o node_modules E o .env voltou pra uma versão sem a chave da
// nuvem. O robô rodava, lia o VR inteiro e jogava fora — sem erro nenhum. Ficou 2h assim.
//
//   node scripts/testes/conferir-pecas.test.cjs
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");

const SCRIPT = path.join(__dirname, "..", "conferir-pecas.cjs");
const ENV_BOM = [
  "PG_HOST=192.168.0.3", "PG_PORT=38561", "PG_DATABASE=vr", "PG_USER=victor",
  "PG_PASSWORD=segredo", "SUPABASE_URL=https://x.supabase.co",
  "SUPABASE_SERVICE_KEY=chave", "GITHUB_TOKEN=token",
].join("\n") + "\n";

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + obtido + (bate ? "" : "   (esperado: " + esperado + ")"));
  bate ? ok++ : falhou++;
}

// monta uma pasta de mentira e roda o conferidor em cima dela
function cenario(montar) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pecas-"));
  montar(dir);
  let saida = "", codigo = 0;
  try {
    saida = execFileSync(process.execPath, [SCRIPT, "--so-conferir"],
      { env: { ...process.env, PECAS_RAIZ: dir }, encoding: "utf8" });
  } catch (e) { codigo = e.status; saida = (e.stdout || "") + (e.stderr || ""); }
  fs.rmSync(dir, { recursive: true, force: true });
  return { codigo, saida };
}
const pacotes = (dir) => ["pg", "tsx"].forEach(p => fs.mkdirSync(path.join(dir, "node_modules", p), { recursive: true }));
const envBom = (dir) => fs.writeFileSync(path.join(dir, ".env"), ENV_BOM);

// ---------------------------------------------------------------------------
console.log("1) tudo no lugar");
let r = cenario(d => { pacotes(d); envBom(d); });
eq("   deixa a rodada seguir (codigo 0)", r.codigo, 0);
eq("   diz que esta tudo no lugar", /tudo no lugar/.test(r.saida), true);

console.log("\n2) o node_modules sumiu — foi o que aconteceu de verdade");
r = cenario(d => { envBom(d); });
eq("   PARA a rodada (codigo 1)", r.codigo, 1);
eq("   diz que a pasta nao existe", /node_modules nao existe/.test(r.saida), true);

console.log("\n3) a pasta existe mas faltou o 'pg' (o driver do banco)");
r = cenario(d => { fs.mkdirSync(path.join(d, "node_modules", "tsx"), { recursive: true }); envBom(d); });
eq("   PARA a rodada", r.codigo, 1);
eq("   diz qual peca faltou", /faltando: pg/.test(r.saida), true);

console.log("\n4) faltou a CHAVE DA NUVEM — o caso perigoso, que nao dava erro nenhum antes");
r = cenario(d => { pacotes(d); fs.writeFileSync(path.join(d, ".env"), ENV_BOM.replace(/^SUPABASE_SERVICE_KEY=.*$/m, "")); });
eq("   PARA a rodada", r.codigo, 1);
eq("   nomeia a chave que falta", /SUPABASE_SERVICE_KEY/.test(r.saida), true);
eq("   explica que o robo jogaria tudo fora", /jogaria fora/.test(r.saida), true);
eq("   aponta o zip velho como causa provavel", /zip VELHO/.test(r.saida), true);

console.log("\n5) a chave existe mas esta VAZIA (o zip velho deixa assim)");
r = cenario(d => { pacotes(d); fs.writeFileSync(path.join(d, ".env"), ENV_BOM.replace(/^SUPABASE_SERVICE_KEY=.*$/m, "SUPABASE_SERVICE_KEY=")); });
eq("   PARA a rodada (vazio conta como faltando)", r.codigo, 1);
eq("   nomeia a chave", /SUPABASE_SERVICE_KEY/.test(r.saida), true);

console.log("\n6) faltou a senha do banco do VR");
r = cenario(d => { pacotes(d); fs.writeFileSync(path.join(d, ".env"), ENV_BOM.replace(/^PG_PASSWORD=.*$/m, "")); });
eq("   PARA a rodada", r.codigo, 1);
eq("   nomeia PG_PASSWORD", /PG_PASSWORD/.test(r.saida), true);

console.log("\n7) nao existe .env nenhum");
r = cenario(d => { pacotes(d); });
eq("   PARA a rodada", r.codigo, 1);
eq("   diz que nao achou o arquivo", /nao achei o arquivo \.env/.test(r.saida), true);

console.log("\n8) faltam VARIAS de uma vez — tem que listar todas, nao so a primeira");
r = cenario(d => { pacotes(d); fs.writeFileSync(path.join(d, ".env"), "PG_HOST=1\n"); });
eq("   PARA a rodada", r.codigo, 1);
eq("   conta quantas faltam", /Faltam 7 configuracao/.test(r.saida), true);
eq("   lista a chave da nuvem", /SUPABASE_SERVICE_KEY/.test(r.saida), true);
eq("   lista o token do GitHub", /GITHUB_TOKEN/.test(r.saida), true);

console.log("\n9) a pasta de verdade do projeto passa");
let real = 0;
try { execFileSync(process.execPath, [SCRIPT, "--so-conferir"], { encoding: "utf8" }); }
catch (e) { real = e.status; }
eq("   o projeto aqui está completo", real, 0);

console.log("\n" + ok + " ok, " + falhou + " falha(s).");
process.exit(falhou ? 1 : 0);
