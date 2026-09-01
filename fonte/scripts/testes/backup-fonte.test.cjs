// O BACKUP DA FONTE — que nada volte a existir só no Mac dele.
//
// Descoberto em 22/08/2026, testando o portal: o `montar-portal.cjs` — o arquivo que
// gera o Portal do Fornecedor inteiro — não estava na lista de backup. Puxando o fio,
// era muito pior: os 105 arquivos de SQL (o banco inteiro: cada tabela, cada função,
// cada regra de quem pode o quê) tinham ZERO cópia, e os 33 testes também não.
// Só 28 arquivos subiam, os que a máquina da loja precisa baixar.
//
// Se o Mac se perdesse, perdia-se o banco e o portal junto.
//
// Agora o deploy VARRE as pastas em vez de depender de alguém lembrar de inscrever o
// arquivo novo. Este teste guarda a varredura — e guarda também a razão de ela mandar
// pra fonte/ e não pra robo/, e de não disparar publicação do site.
//
//   node scripts/testes/backup-fonte.test.cjs
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..", "..");
const DEP = fs.readFileSync(path.join(RAIZ, "scripts", "deploy-code.cjs"), "utf8");

let ok = 0, falhou = 0;
function eq(nome, obtido, esperado) {
  const bate = String(obtido) === String(esperado);
  console.log((bate ? "  OK   " : "  FALHA") + " | " + nome + "  ->  " + obtido + (bate ? "" : "   (esperado: " + esperado + ")"));
  bate ? ok++ : falhou++;
}

console.log("\n=== Backup da fonte ===\n");

// ------------------------------------------------------------ a varredura existe
{
  eq("1) o deploy varre pasta, não depende de lista escrita à mão",
     /function varrer\(pastas\)/.test(DEP), "true");
  eq("2) e a varredura é chamada de verdade",
     /const extras = varrer\(PASTAS\);/.test(DEP), "true");
}

// ------------------------------------------------------------ as pastas que importam
{
  // Cada uma destas guarda algo que não se reconstrói de cabeça.
  [["scripts", "os programas"],
   ["scripts/testes", "as travas"],
   ["email-templates", "o que o fornecedor recebe"],
   ["scripts/central", "a Central Operacional"],
   ["src/config", "a configuração da loja"]].forEach(function (c, i) {
    eq((3 + i) + ") varre " + c[0] + " (" + c[1] + ")",
       DEP.indexOf('["' + c[0] + '"') >= 0, "true");
  });
}

// ------------------------------------------------------------ nada de fora
{
  // A varredura cobre as pastas que ela conhece. O risco que sobra é alguém criar uma
  // pasta NOVA com fonte dentro e ninguém lembrar de inscrevê-la. Então aqui eu faço o
  // caminho contrário: percorro o repositório procurando fonte, e cobro cobertura.
  const IGNORAR = new Set(["node_modules", "output", ".previa", ".git", "backups",
                           "assets", "docs", ".vercel", "dist"]);
  const EXT = [".sql", ".cjs", ".ts", ".bat", ".vbs"];
  const PASTAS = ["sql", "scripts", "scripts/testes", "email-templates",
                  "scripts/central", "src/config", "."];  // sql conta: tem destino próprio (privado)

  const naLista = new Set((DEP.match(/\["([^"]+)", "robo\//g) || [])
    .map(function (m) { return m.slice(2, m.indexOf('", "robo/')); }));

  function coberto(rel) {
    if (naLista.has(rel)) return true;                 // vai pro robô
    const dir = rel.indexOf("/") < 0 ? "." : rel.slice(0, rel.lastIndexOf("/"));
    return PASTAS.indexOf(dir) >= 0;                   // cai na varredura
  }

  const fora = [];
  (function anda(rel, fundo) {
    if (fundo > 2) return;
    const dir = rel ? path.join(RAIZ, rel) : RAIZ;
    fs.readdirSync(dir).forEach(function (n) {
      if (n.startsWith(".") && n !== ".previa") { if (IGNORAR.has(n)) return; }
      if (IGNORAR.has(n)) return;
      const cheio = path.join(dir, n), r = rel ? rel + "/" + n : n;
      let st; try { st = fs.statSync(cheio); } catch (e) { return; }
      if (st.isDirectory()) return anda(r, fundo + 1);
      if (EXT.indexOf(path.extname(n)) < 0) return;
      if (!coberto(r)) fora.push(r);
    });
  })("", 0);

  eq("9) nenhum arquivo fora do banco ficou sem cópia" + (fora.length ? " — " + fora.slice(0, 6).join(", ") : ""),
     fora.length, 0);
}

// ------------------------------------------------------------ o banco NAO vai pro publico
{
  // Em 22/08/2026 eu subi os 105 SQL para o repositório PÚBLICO sem perguntar. Não vazou
  // senha (os valores moram no .env), mas ficou visível cada regra de quem pode ler o quê —
  // com um portal abrindo para 132 fornecedores de fora, é entregar o mapa das brechas.
  // Tirei no mesmo dia. Este teste existe pra não voltar por descuido.
  eq("10) o SQL não está na lista do repositório público",
     /const PASTAS = \[\s*\n\s*\["scripts", "\.cjs"\]/.test(DEP), "true");
  /* 11) ATUALIZADO em 01/09/2026. A lista privada deixou de ser ["sql",".sql"] e passou a
     dizer também PARA ONDE cada coisa vai no repositório privado, e se precisa entrar em
     subpasta — as Edge Functions moram em supabase/functions/<nome>/index.ts, um nível
     abaixo, e a varredura antiga só olhava o primeiro nível: elas não eram vistas.
     O que o teste cobra não mudou: o SQL tem que estar na lista PRIVADA, nunca na pública. */
  eq("11) o SQL está na lista do repositório PRIVADO",
     /const PASTAS_PRIVADAS = \[[\s\S]{0,120}\{ de: "sql",\s+ext: "\.sql", para: "sql" \}/.test(DEP), "true");
  eq("11b) as Edge Functions também, e com varredura em subpasta",
     /\{ de: "supabase\/functions",[^}]*fundo: true \}/.test(DEP), "true");
  eq("11c) e as bancadas conferir-*.mjs",
     /\{ de: "scripts",\s+ext: "\.mjs", para: "bancadas", so: \/\^conferir-\/ \}/.test(DEP), "true");
  eq("11d) a varredura entra em subpasta quando mandado",
     /if \(fs\.statSync\(cheio\)\.isDirectory\(\)\) \{ if \(e\.fundo\) anda\(dentro\); continue; \}/.test(DEP), "true");

  /* ==PROIBIDO== O .gitignore NÃO alcança este programa: ele usa a API do GitHub direto,
     não o git. Quem confiasse só no .gitignore acharia que estava protegido e não estaria.
     Por isso a lista de proibidos vive aqui dentro também, e é ELA que vale. */
  eq("11e) existe uma lista de proibidos que vale para todo envio",
     /const PROIBIDO = \[/.test(DEP) && /function proibido\(rel\)/.test(DEP), "true");
  eq("11f) e a varredura barra o arquivo proibido antes de enfileirar",
     /if \(proibido\(rel\)\) \{ bloqueados\.push\(rel\); continue; \}/.test(DEP), "true");
  eq("11g) o .env e as cópias dele estão na lista de proibidos",
     /\\.env\(\$\|\\.\)/.test(DEP) && /\\.bak\(\$\|-\)/.test(DEP), "true");
  eq("11h) e chaves, certificados, dumps e backups também",
     /pem\|key\|p12/.test(DEP) && /\^backups\\\//.test(DEP), "true");

  /* Publicar sem cópia do banco, em silêncio, é pior do que não publicar. */
  eq("11i) se o backup privado falhar, o programa PARA em vez de publicar calado",
     /==BACKUPDURO==/.test(DEP) && /ERRO NO BACKUP PRIVADO — NADA FOI PUBLICADO/.test(DEP), "true");
  eq("12) e o privado só recebe se existir repositório configurado",
     /if \(REPO_FONTE\) \{/.test(DEP), "true");
  // backup que a pessoa PENSA que tem e não tem é pior que não ter nenhum
  eq("13) sem repositório privado, avisa em vez de calar",
     DEP.indexOf("ATENCAO: os \" + privados.length + \" arquivos de SQL do banco NAO tem copia") >= 0, "true");
}

// ------------------------------------------------------------ vai pro lugar certo
{
  // fonte/ e não robo/: a máquina da loja procura por nome dentro de robo/, e SQL
  // no meio do robô só serviria pra confundir a conferência dele.
  eq("14) o backup vai para fonte/, longe do robô",
     DEP.indexOf('"fonte/" + rel') >= 0, "true");
  const PUX = fs.readFileSync(path.join(RAIZ, "scripts", "puxar-codigo.cjs"), "utf8");
  eq("15) e o robô da loja não tenta baixar nada de fonte/",
     PUX.indexOf("fonte/") >= 0, "false");
}

// ------------------------------------------------------------ um envio só, não um por arquivo
{
  // 22/08/2026: o backup mandou 183 arquivos escrevendo um por um. Cada escrita vira um
  // commit e cada commit vira uma tentativa de publicação no Vercel — que tem limite
  // diário. Resultado: "Deployment rate limited — retry in 24 hours". O site no ar não
  // caiu, mas ficou 24h sem poder ser atualizado.
  //
  // Eu tinha achado que a regra do vercel.json protegia. NÃO protege: ela impede a
  // CONSTRUÇÃO, não a tentativa — e é a tentativa que conta no limite.
  eq("18) manda tudo num commit só, pelo caminho de baixo do git",
     /async function enviarLote\(/.test(DEP), "true");
  eq("19) o conteúdo vai como blob, que não é commit",
     DEP.indexOf("/git/blobs") >= 0, "true");
  eq("20) e só UM galho é movido no fim",
     (DEP.match(/\/git\/refs\/heads\/main/g) || []).length, 1);
  eq("21) não sobrou escrita arquivo-por-arquivo",
     /\/contents\/" \+ repoPath/.test(DEP), "false");
  // e continua sem reescrever o que já está igual
  eq("22) compara pelo sha antes de mandar", /laDentro\.get\(rp\) === shaGit\(buf\)/.test(DEP), "true");
  eq("23) lê a árvore inteira numa chamada só, não um GET por arquivo",
     DEP.indexOf("?recursive=1") >= 0, "true");
}

// ------------------------------------------------------------ não publica o site
{
  // 178 arquivos = 178 commits. Se cada um disparasse uma publicação, o limite diário
  // do Vercel estouraria e o site pararia de atualizar, parecendo que o código não subiu.
  // O vercel.json só constrói com "[publicar]" na mensagem; a do backup é "deploy: ...".
  eq("24) a mensagem do backup não é de publicação",
     DEP.indexOf('"deploy: codigo e backup da fonte ("') >= 0 &&
     !/message:[^\n]*\[publicar\]/.test(DEP) &&
     !/enviarLote\([^)]*\[publicar\]/.test(DEP), "true");
  const VER = fs.readFileSync(path.join(RAIZ, "vercel.json"), "utf8");
  eq("25) e o site só publica com [publicar] na mensagem",
     VER.indexOf("[publicar]") >= 0, "true");
}

console.log("\n" + (falhou ? "FALHOU: " + falhou + " de " + (ok + falhou) : "TUDO OK: " + ok + " testes") + "\n");
process.exit(falhou ? 1 : 0);
