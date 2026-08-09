// SYNC: lê do VR as CONFERÊNCIAS de recebimento (o que o conferente já bipa no coletor)
// e joga o resumo na tabela central_conferencias do Supabase.
//
// Uma linha = uma CONFERÊNCIA (uma senha de coletor), não uma nota: um mesmo caminhão
// costuma gerar várias notas e aqui ele aparece uma vez só.
//
// SÓ LÊ o VR. ESCREVE só na nuvem. Nada volta pro VR.
// Precisa de SUPABASE_SERVICE_KEY no .env.
// Roda DENTRO da rede da loja: node scripts/vr-sync-conferencia.cjs
const fs = require("fs"), path = require("path"), https = require("https"), { Client } = require("pg");

function env(){ for(const p of [path.join(__dirname,"..",".env"),".env","../.env"]){ try{ return fs.readFileSync(p,"utf8"); }catch(e){} } return ""; }
const E = env(), g = k => { const m = E.match(new RegExp("^"+k+"=(.*)$","m")); return m ? m[1].trim() : ""; };
const SB_HOST = "uabhsmculsfwzcrhyhch.supabase.co", SB_KEY = g("SUPABASE_SERVICE_KEY");

// Quantos dias para trás sincronizar (o dia de hoje muda o tempo todo; os anteriores
// já estão fechados, mas revarremos alguns por causa de nota finalizada depois).
const DIAS = +(process.env.DIAS || 7);

// Se a última bipagem foi há menos que isso e a nota ainda não fechou, está "conferindo agora".
const MIN_ATIVO = 25;

// O VR guarda o horário em UTC. A loja é Caicó/RN, sempre UTC-3, sem horário de verão.
function local(d){
  const t = new Date(new Date(d).getTime() - 3*3600*1000), p = n => String(n).padStart(2,"0");
  return { data: t.getUTCFullYear()+"-"+p(t.getUTCMonth()+1)+"-"+p(t.getUTCDate()),
           hora: p(t.getUTCHours())+":"+p(t.getUTCMinutes()) };
}

function req(method, pathq, body){
  return new Promise((ok, err) => {
    const dados = body ? JSON.stringify(body) : null;
    const headers = { apikey: SB_KEY, Authorization: "Bearer "+SB_KEY, "Content-Type": "application/json" };
    if (method === "POST") headers.Prefer = "resolution=merge-duplicates,return=minimal";
    const r = https.request({ host: SB_HOST, path: pathq, method, headers }, res => {
      let b = ""; res.on("data", c => b += c);
      res.on("end", () => res.statusCode < 300 ? ok(b ? JSON.parse(b || "[]") : [])
                                               : err(new Error(res.statusCode+" "+b.slice(0,200))));
    });
    r.on("error", err); if (dados) r.write(dados); r.end();
  });
}
const upsert = rows => req("POST", "/rest/v1/central_conferencias?on_conflict=id", rows);

// ---------- a consulta ----------
// ses  = as sessões do coletor, agrupadas pela SENHA (que é o número da nota que ele digita)
// nt   = as notas que aquela sessão gerou, com a situação de cada uma
const SQL = `
with ses as (
  select k.senha, k.id_loja,
         min(k.created_at) ini, max(k.created_at) fim,
         count(*)::int bipagens, coalesce(sum(k.quantidade),0)::numeric itens
    from notaentradacoletor k
   where k.created_at >= now() - ($1 || ' days')::interval
     and k.senha is not null
   group by k.senha, k.id_loja
),
nt as (
  select distinct k.senha, k.id_loja, ne.id id_nota, ne.id_fornecedor,
         ne.id_situacaonotaentrada fin
    from notaentradacoletor k
    join notaentradareferenciacoletor rc on rc.id_notaentradacoletor = k.id
    join notaentrada ne on ne.id = rc.id_notaentrada
   where k.created_at >= now() - ($1 || ' days')::interval
)
select s.senha, s.id_loja, s.ini, s.fim, s.bipagens, s.itens,
       count(distinct n.id_nota)::int notas,
       count(distinct n.id_nota) filter (where n.fin = 1)::int notas_fin,
       max(f.razaosocial) fornecedor,
       coalesce(sum((select count(*) from notaentradadivergencia d
                      where d.id_notaentrada = n.id_nota)), 0)::int divergencias,
       -- DETALHE: 8 divergências pode ser 8 produtos que não vieram ou 8 arredondamentos
       -- de centavo. Somar tipos diferentes num número só esconde justamente o que importa.
       coalesce((
         select jsonb_agg(x order by x->>'tipo', x->>'produto')
           from (
             select distinct jsonb_build_object(
                      'tipo',   coalesce(td.descricao,'?'),
                      'produto',coalesce(pr.descricaocompleta,'produto '||d.id_produto),
                      'pedido', d.quantidadepedido,
                      'veio',   d.quantidadenota,
                      'cp',     d.custopedido,
                      'cn',     d.custonota,
                      -- PREÇO DA UNIDADE, tirado da própria nota (busca por índice: nota+produto).
                      -- Sem ele a linha do COLETOR ficava com custo "—", porque o VR só preenche
                      -- custo nas divergências de preço. É esse número que transforma
                      -- "4 a mais" em "R$ 18,00 cobrados a mais".
                      'pu',     (select ni.valortotal/nullif(ni.quantidade,0)
                                   from notaentradaitem ni
                                  where ni.id_notaentrada = d.id_notaentrada
                                    and ni.id_produto = d.id_produto
                                  limit 1)) x
               from notaentradadivergencia d
               left join tipodivergenciaentrada td on td.id = d.id_tipodivergenciaentrada
               left join produto pr on pr.id = d.id_produto
              where d.id_notaentrada in (
                    select n2.id_nota from nt n2
                     where n2.senha = s.senha and n2.id_loja is not distinct from s.id_loja)
              limit 60
           ) t), '[]'::jsonb) detalhe
  from ses s
  left join nt n on n.senha = s.senha and n.id_loja = s.id_loja
  left join fornecedor f on f.id = n.id_fornecedor
 group by s.senha, s.id_loja, s.ini, s.fim, s.bipagens, s.itens
 order by s.ini desc`;

// Agrupa por tipo e devolve {tipos:[{tipo,qtd}], itens:[...]}. A tela mostra o resumo por
// tipo primeiro; a lista de produtos só quando a pessoa abre.
function montaDetalhe(lista){
  const itens = Array.isArray(lista) ? lista : [];
  const conta = {};
  for (const i of itens) conta[i.tipo] = (conta[i.tipo] || 0) + 1;
  const tipos = Object.keys(conta).map(t => ({ tipo: t, qtd: conta[t] }))
                      .sort((a,b) => b.qtd - a.qtd);
  return { tipos, itens: itens.map(i => ({
    tipo: i.tipo, produto: i.produto,
    pedido: Number(i.pedido) || 0, veio: Number(i.veio) || 0,
    custo_pedido: Number(i.cp) || 0, custo_nota: Number(i.cn) || 0,
    // preço da unidade na nota; sem isso não dá pra dizer quanto vale a diferença
    preco: Number(i.pu) || Number(i.cn) || Number(i.cp) || 0
  })) };
}

function situacao(r, minutosDesdeUltima){
  const notas = r.notas || 0, fin = r.notas_fin || 0;
  if (notas > 0 && fin >= notas) return "finalizado";
  if (minutosDesdeUltima <= MIN_ATIVO) return "conferindo";
  return "aguardando";   // bipou e a nota não fechou — o carro travou
}

(async () => {
  if (!SB_KEY) { console.log("!! Falta SUPABASE_SERVICE_KEY no .env"); return; }
  const c = new Client({ host: g("PG_HOST"), port: +g("PG_PORT"), database: g("PG_DATABASE"),
                         user: g("PG_USER"), password: g("PG_PASSWORD"), ssl: false, statement_timeout: 120000 });
  await c.connect();
  const r = await c.query(SQL, [String(DIAS)]);
  await c.end();

  const agora = Date.now();
  const linhas = r.rows.map(x => {
    const li = local(x.ini), lf = local(x.fim);
    const dur = Math.round((new Date(x.fim) - new Date(x.ini)) / 60000);
    const desdeUltima = Math.round((agora - new Date(x.fim)) / 60000);
    return {
      id: x.senha + "|" + (x.id_loja == null ? "" : x.id_loja) + "|" + li.data,
      senha: String(x.senha), loja: x.id_loja == null ? "" : String(x.id_loja),
      data: li.data, fornecedor: x.fornecedor || "",
      inicio: li.hora, fim: lf.hora,
      // duração 0 = o coletor mandou tudo de uma vez; grava NULL para a tela mostrar "—"
      // em vez de fingir que a conferência levou zero minuto.
      minutos: dur > 0 ? dur : null,
      bipagens: x.bipagens, itens: Number(x.itens) || 0,
      notas: x.notas, notas_finalizadas: x.notas_fin,
      divergencias: x.divergencias,
      divergencia_detalhe: montaDetalhe(x.detalhe),
      situacao: situacao(x, desdeUltima),
      atualizado_em: new Date().toISOString()
    };
  });

  if (!linhas.length) { console.log("Nada para enviar."); return; }
  for (let i = 0; i < linhas.length; i += 200) await upsert(linhas.slice(i, i + 200));

  const c1 = linhas.filter(l => l.situacao === "conferindo").length;
  const c2 = linhas.filter(l => l.situacao === "aguardando").length;
  const c3 = linhas.filter(l => l.situacao === "finalizado").length;
  const comTempo = linhas.filter(l => l.minutos != null).length;
  console.log("Enviada(s) " + linhas.length + " conferência(s) dos últimos " + DIAS + " dia(s).");
  console.log("  conferindo agora: " + c1 + " | aguardando fechamento: " + c2 + " | finalizadas: " + c3);
  console.log("  com tempo medido: " + comTempo + " de " + linhas.length + " (o resto o coletor transmitiu de uma vez)");
})().catch(e => { console.log("ERRO: " + e.message); process.exit(1); });
