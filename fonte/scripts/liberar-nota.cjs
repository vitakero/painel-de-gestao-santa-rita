// SOLTA a chave da nota de um agendamento CANCELADO, para ela poder ser usada de novo.
//
// Remendo temporário, para o dono não ficar travado enquanto o receb_c36 passa pela
// revisão. A trava de hoje barra a chave para sempre, inclusive de agendamento
// cancelado — o que o próprio comentário dela diz que NÃO devia acontecer.
//
// Guarda a chave num arquivo antes de tirar, para poder devolver depois. Só mexe em
// nota cujo agendamento está cancelado ou recusado — nunca em agendamento vivo.
//
//   node scripts/liberar-nota.cjs            -> solta
//   node scripts/liberar-nota.cjs devolver   -> devolve o que foi guardado
require("dotenv").config({ path: require("path").join(process.env.HOME, "vr-looker-integration", ".env") });
const fs = require("fs"), path = require("path");
const U = process.env.SUPABASE_URL, K = process.env.SUPABASE_SERVICE_KEY;
const H = { apikey: K, Authorization: "Bearer " + K, "Content-Type": "application/json", Prefer: "return=representation" };
const COFRE = path.join(process.env.HOME, "vr-looker-integration", "backup", "chaves-soltas.json");

const pega = async q => { const r = await fetch(U + "/rest/v1/" + q, { headers: H }); return r.ok ? r.json() : []; };
const poe = async (q, body) => {
  const r = await fetch(U + "/rest/v1/" + q, { method: "PATCH", headers: H, body: JSON.stringify(body) });
  return r.ok ? r.json() : Promise.reject(new Error(r.status + " " + (await r.text()).slice(0, 200)));
};

(async () => {
  fs.mkdirSync(path.dirname(COFRE), { recursive: true });
  const guardado = fs.existsSync(COFRE) ? JSON.parse(fs.readFileSync(COFRE, "utf8")) : [];

  if (process.argv[2] === "devolver") {
    if (!guardado.length) { console.log("não há chave guardada para devolver."); return; }
    for (const g of guardado) {
      await poe("receb_agenda_notas?id=eq." + g.id, { chave: g.chave });
      console.log("  devolvida: nota " + g.numero + " -> " + g.chave);
    }
    fs.unlinkSync(COFRE);
    console.log("cofre esvaziado.");
    return;
  }

  const ags = await pega("receb_agendas?select=id,ticket,situacao&situacao=in.(cancelada,recusada)");
  if (!ags.length) { console.log("nenhum agendamento cancelado ou recusado — nada a soltar."); return; }
  const ids = ags.map(a => a.id);
  const notas = await pega("receb_agenda_notas?select=id,agenda_id,numero,chave&chave=not.is.null&agenda_id=in.(" + ids.join(",") + ")");
  if (!notas.length) { console.log("as notas desses agendamentos já estão soltas."); return; }

  for (const n of notas) {
    const ag = ags.find(a => a.id === n.agenda_id);
    guardado.push({ id: n.id, numero: n.numero, chave: n.chave, ticket: ag && ag.ticket });
    await poe("receb_agenda_notas?id=eq." + n.id, { chave: null });
    console.log("  solta: nota " + n.numero + " (do " + (ag && ag.ticket) + ", " + (ag && ag.situacao) + ")");
  }
  fs.writeFileSync(COFRE, JSON.stringify(guardado, null, 1));
  console.log("chave(s) guardada(s) em backup/chaves-soltas.json — devolvo depois do conserto.");
})();
