/* ==ENC-CALC== PLANEJAMENTO DE ENCARTES — o cálculo, num lugar só.
   Roda igual no navegador (vira window.ENC) e no Node (module.exports, para os testes).
   Nada aqui lê banco nem desenha: recebe dados, devolve contas. O banco é a autoridade
   do que foi gravado; este arquivo é a autoridade de DATAS e PRAZOS (o SQL não repete a
   conta de antecipação: a tela manda os prazos já calculados daqui).

   DATAS SEMPRE EM TEXTO 'AAAA-MM-DD'. Toda conta de dia é feita em cima do número do dia
   (Date.UTC), nunca com toISOString de um horário: em Caicó (UTC−3), depois das 21h o
   toISOString já diz "amanhã" e o prazo andaria um dia. "Hoje" vem da hora LOCAL.

   AS REGRAS (especificação V1 de 26/09/2026, seções 2 a 6):
     PRAZO        = N dias CORRIDOS antes do 1º dia no ar; se cair em domingo, loja fechada,
                    feriado nacional ou 23/24/30/31 de dezembro, antecipa para o dia útil
                    anterior (repete). Sábado é dia útil.
     HORTIFRÚTI   = grupo com flv:true só antecipa domingo e loja fechada (o preço de feira
                    se decide na manhã do feriado e pode cair em 23/24/30/31).
     SITUAÇÃO     = aprovado > futuro > atrasado > atenção > no prazo.
     MARGEM       = (preço de oferta − custo considerado) ÷ preço de oferta, em %.
                    Custo ausente NÃO é zero: sem custo, a margem é indisponível.
     COINCIDÊNCIA = duas campanhas com edição (ou data GRANDE) que se sobrepõem ou ficam
                    a ≤ 1 dia. A Promoção Semanal, que cobre todos os dias, não conta; campanha
                    semanal (Terçou) só conta junto de data grande. */
(function (raiz) {
  "use strict";

  /* ======================= NÚMEROS ======================= */
  // "Branco não é zero": +null e +"" valem 0 no JavaScript. Só é informado o que tem valor.
  function tem(v) { return v !== null && v !== undefined && v !== "" && typeof v !== "boolean" && isFinite(+v); }
  function num(v) { return tem(v) ? +v : null; }
  function pos(v) { return tem(v) && +v > 0 ? +v : null; }
  function r2(v) { return Math.round(v * 100) / 100; }
  function r4(v) { return Math.round(v * 10000) / 10000; }
  function texto(v) { return v === null || v === undefined ? "" : String(v).trim(); }
  function objeto(v) {
    if (v && typeof v === "object") return v;
    if (typeof v === "string" && v.trim()) { try { var o = JSON.parse(v); return o && typeof o === "object" ? o : null; } catch (e) { return null; } }
    return null;
  }
  function fmtNum(v, casas) { return v === null || v === undefined ? "" : (+v).toFixed(casas).replace(".", ","); }

  /* ======================= DATAS ======================= */
  var DIA_MS = 86400000;
  var DIAS_SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
  var DIAS_CURTOS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymd(a, m, d) { return a + "-" + pad(m) + "-" + pad(d); } // m = 1..12
  function ehData(x) { return Object.prototype.toString.call(x) === "[object Date]"; }
  // Texto 'AAAA-MM-DD' de: um texto de data (os 10 primeiros caracteres) ou um Date (hora LOCAL).
  function isoDe(x) {
    if (x === null || x === undefined || x === "") return null;
    if (ehData(x)) return isNaN(x.getTime()) ? null : ymd(x.getFullYear(), x.getMonth() + 1, x.getDate());
    var s = String(x).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  }
  function numDia(iso) {
    var s = isoDe(iso); if (!s) return NaN;
    return Math.round(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / DIA_MS);
  }
  function deNum(n) { var d = new Date(n * DIA_MS); return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); }
  function valida(a, m, d) { var x = new Date(Date.UTC(a, m - 1, d)); return x.getUTCFullYear() === a && x.getUTCMonth() === m - 1 && x.getUTCDate() === d; }

  /* Um instante (timestamptz do banco, Date ou número). Aceita o formato do Postgres
     "2026-09-26 12:20:00+00", que o Safari não lê sem ajuste. */
  function instante(x) {
    if (x === null || x === undefined || x === "") return null;
    if (ehData(x)) return isNaN(x.getTime()) ? null : x;
    if (typeof x === "number") return new Date(x);
    var s = String(x).trim();
    // Só a data (sem hora): meia-noite LOCAL. new Date('2026-09-26') seria meia-noite UTC = 21h do dia 25 em Caicó.
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
    // Microssegundos do Supabase (6 casas) viram milissegundos: o Safari não lê mais de 3.
    s = s.replace(" ", "T").replace(/(\.\d{3})\d+/, "$1").replace(/([+-]\d\d)$/, "$1:00");
    var d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  // Hoje (ou o dia de um instante) na hora LOCAL do aparelho.
  function hojeISO(agora) { var d = agora === undefined || agora === null ? new Date() : instante(agora); return d ? isoDe(d) : null; }
  function addDias(iso, n) { var k = numDia(iso); return isNaN(k) ? null : deNum(k + Math.round(+n || 0)); }
  // Quantos dias de a até b (positivo quando b vem depois).
  function diasEntre(a, b) { var x = numDia(a), y = numDia(b); return isNaN(x) || isNaN(y) ? null : y - x; }
  // 0 = domingo … 6 = sábado (a mesma conta das regras do Calendário). 01/01/1970 foi quinta.
  function diaSemana(iso) { var k = numDia(iso); return isNaN(k) ? null : (((k + 4) % 7) + 7) % 7; }
  function fmtData(iso, o) {
    var s = isoDe(iso); if (!s) return "";
    o = o || {};
    var t = s.slice(8, 10) + "/" + s.slice(5, 7) + (o.curta ? "" : "/" + s.slice(0, 4));
    return o.semana ? DIAS_CURTOS[diaSemana(s)] + " " + t : t;
  }
  // "23 a 30/11/2026", "30/11 a 07/12/2026", "28/12/2026 a 04/01/2027". {curta} tira o ano.
  function fmtPeriodo(ini, fim, o) {
    var a = isoDe(ini), b = isoDe(fim); o = o || {};
    if (!a) return "";
    if (!b || a === b) return fmtData(a, o);
    if (a.slice(0, 4) !== b.slice(0, 4)) return fmtData(a, { curta: !!o.curta }) + " a " + fmtData(b, { curta: !!o.curta });
    if (a.slice(0, 7) === b.slice(0, 7)) return a.slice(8, 10) + " a " + fmtData(b, o);
    return fmtData(a, { curta: true }) + " a " + fmtData(b, o);
  }

  /* ======================= PÁSCOA, FERIADOS, LOJA FECHADA ======================= */
  // Domingo de Páscoa (algoritmo de Meeus/Butcher), igual ao do Calendário do Painel.
  function pascoa(ano) {
    ano = +ano;
    var a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4,
      f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30,
      i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
      mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
    return ymd(ano, mes, dia);
  }
  var FERIADOS_FIXOS = { "01-01": "Confraternização Universal", "04-21": "Tiradentes", "05-01": "Dia do Trabalho",
    "09-07": "Independência do Brasil", "10-12": "Nossa Senhora Aparecida", "11-02": "Finados",
    "11-15": "Proclamação da República", "11-20": "Consciência Negra", "12-25": "Natal" };
  // Feriado nacional (fixo ou móvel). null quando não é feriado.
  function nomeFeriado(iso) {
    var s = isoDe(iso); if (!s) return null;
    if (FERIADOS_FIXOS[s.slice(5)]) return FERIADOS_FIXOS[s.slice(5)];
    var dp = diasEntre(pascoa(+s.slice(0, 4)), s);
    if (dp === -48) return "Carnaval (segunda)";
    if (dp === -47) return "Carnaval (terça)";
    if (dp === -2) return "Sexta-feira Santa";
    if (dp === 60) return "Corpus Christi";
    return null;
  }
  function ehFeriado(iso) { return !!nomeFeriado(iso); }
  // Os 4 dias em que a LOJA FECHA (mesma lista do feriadosFechado do Calendário).
  function lojaFechada(iso) {
    var s = isoDe(iso); if (!s) return false;
    var md = s.slice(5);
    return md === "01-01" || md === "05-01" || md === "12-25" || diasEntre(pascoa(+s.slice(0, 4)), s) === -2;
  }
  // Fim de ano com a loja cheia: prazo administrativo não cai nesses dias.
  var DEZ_CHEIO = { "12-23": 1, "12-24": 1, "12-30": 1, "12-31": 1 };
  function ehDiaUtil(iso, o) {
    var s = isoDe(iso); if (!s) return false;
    if (diaSemana(s) === 0 || lojaFechada(s)) return false;
    if (o && o.flv) return true; // hortifrúti decide na manhã do feriado e no fim de ano
    return !ehFeriado(s) && !DEZ_CHEIO[s.slice(5)];
  }
  // O próprio dia, se ele serve; senão o dia útil ANTERIOR mais próximo (repete até achar).
  function diaUtilAnterior(iso, o) {
    var s = isoDe(iso); if (!s) return null;
    for (var i = 0; i < 40 && !ehDiaUtil(s, o); i++) s = addDias(s, -1);
    return s;
  }

  /* ======================= PRAZOS ======================= */
  /* dias = {comecar, definir, aprovar}: dias CORRIDOS antes do 1º dia no ar. Número não
     informado devolve null (não vira "0 dias antes"). A ordem começar ≤ definir ≤ aprovar é
     garantida: se a antecipação de um fim de ano empurrar o aprovar para antes do definir,
     o definir acompanha (nunca se aprova antes de definir). */
  function calcularPrazos(inicioNoAr, dias, o) {
    var ini = isoDe(inicioNoAr), D = objeto(dias) || {}, flv = !!(o && o.flv);
    function um(k) { return ini && tem(D[k]) ? diaUtilAnterior(addDias(ini, -Math.round(+D[k])), { flv: flv }) : null; }
    var r = { comecar: um("comecar"), definir: um("definir"), aprovar: um("aprovar") };
    if (r.definir && r.aprovar && r.definir > r.aprovar) r.definir = r.aprovar;
    var teto = r.definir || r.aprovar;
    if (r.comecar && teto && r.comecar > teto) r.comecar = teto;
    return r;
  }

  /* ======================= REGRAS DO CALENDÁRIO (seed da seção 8) =======================
     CÓPIA FIEL do ponto de partida do sql/encartes_v1.sql (insert em calendario_regras):
     mesmos nomes, setores, cores, ordem e observações. O Calendário usa esta lista enquanto
     o banco não responde (e quando a leitura falha); se as duas divergirem, o nome de uma
     data muda conforme o login. O teste confere campo a campo contra o SQL. */
  function C(id, nome, regra, setor, cor, ordem, situacao, observacao) {
    return { id: id, nome: nome, tipo: "campanha", categoria: null, regra: regra, setor: setor, cor: cor,
      situacao: situacao || "ativa", ordem: ordem, observacao: observacao || null };
  }
  function Dt(id, nome, regra, categoria, setor, cor, ordem, observacao) {
    return { id: id, nome: nome, tipo: "data", categoria: categoria, regra: regra, setor: setor, cor: cor,
      situacao: "ativa", ordem: ordem, observacao: observacao || null };
  }
  function fixa(mes, dia) { return { tipo: "anual_fixa", mes: mes, dia: dia, duracao_dias: 1 }; }
  var REGRAS_PADRAO = [
    C("promocao-semanal", "Promoção Semanal", { tipo: "semanal", dia_semana: 1, duracao_dias: 8 }, "Geral", "#0c8599", 1, "ativa",
      "Segunda a segunda. Uma edição por semana (levas da semana entram na mesma edição)."),
    C("tercou", "Terçou das Frutas e Verduras", { tipo: "semanal", dia_semana: 2, duracao_dias: 1 }, "Hortifruti", "#1b9e4b", 2, "ativa",
      "Só a terça: entra terça 00h e sai quarta 00h (palavras do dono, 02/10/2026)."),
    C("sabado-bombastico", "Sábado Bombástico", { tipo: "mensal_nth", n: 2, dia_semana: 6, duracao_dias: 2 }, "Geral", "#f1c40f", 3, "ativa",
      "2º sábado do mês, prorrogado no domingo."),
    C("hora-da-economia", "Hora da Economia", { tipo: "mensal_ultimo", dia_semana: 4, duracao_dias: 1 }, "Geral", "#0a6cff", 4, "ativa",
      "Última quinta do mês."),
    C("sexta-da-carne", "Sexta da Carne", { tipo: "semanal", dia_semana: 5, duracao_dias: 1 }, "Açougue", "#e60000", 5, "pausada",
      "Pausada (decisão 7·3): não aparece nem gera edição, tarefa ou alerta. Cadastro preservado; reativável."),
    C("quarta-saudavel", "Quarta Saudável", { tipo: "semanal", dia_semana: 3, duracao_dias: 1 }, "Saudabilidade", "#7CB518", 6, "ativa",
      "Toda quarta-feira, só o dia. Produtos de saudabilidade (integrais, zero, sem lactose/glúten, bebidas e lanches leves)."),
    Dt("volta-as-aulas", "Volta às Aulas", { tipo: "datas", lista: [] }, "media", "Mercearia", "#A4D400", 10,
      "Período configurável por ano (o pico é em fevereiro). Lista vazia até o dono configurar."),
    Dt("carnaval", "Carnaval", { tipo: "pascoa", deslocamento_dias: -48, duracao_dias: 2 }, "grande", "Geral", "#D4A017", 11),
    Dt("dia-da-mulher", "Dia da Mulher", fixa(3, 8), "media", "Perfumaria", "#D1006C", 12),
    Dt("dia-do-consumidor", "Dia do Consumidor", fixa(3, 15), "media", "Geral", "#00C2A8", 13),
    Dt("pascoa", "Páscoa", { tipo: "pascoa", deslocamento_dias: 0, duracao_dias: 1 }, "grande", "Mercearia", "#74411F", 14),
    Dt("tiradentes", "Tiradentes", fixa(4, 21), "media", "Geral", "#495057", 15),
    Dt("dia-das-maes", "Dia das Mães", { tipo: "anual_nth", mes: 5, n: 2, dia_semana: 0, duracao_dias: 1 }, "media", "Perfumaria", "#FF5C8A", 16),
    Dt("dia-dos-namorados", "Dia dos Namorados", fixa(6, 12), "media", "Perfumaria", "#5F0F99", 17),
    Dt("sao-joao", "São João", fixa(6, 24), "media", "Mercearia", "#C8642F", 18),
    Dt("sao-pedro", "São Pedro", fixa(6, 29), "media", "Mercearia", "#3F37C9", 19),
    Dt("dia-dos-pais", "Dia dos Pais", { tipo: "anual_nth", mes: 8, n: 2, dia_semana: 0, duracao_dias: 1 }, "media", "Geral", "#C026D3", 20),
    Dt("aniversario-santa-rita", "Aniversário Santa Rita", fixa(9, 16), "grande", "Geral", "#A78BFA", 21),
    Dt("dia-das-criancas", "Dia das Crianças", fixa(10, 12), "media", "Bomboniere", "#00B4D8", 22),
    Dt("halloween", "Halloween", fixa(10, 31), "media", "Bomboniere", "#FF7518", 23),
    // Black Friday = o dia SEGUINTE à 4ª quinta de novembro (a "última sexta" erra: em 2029
    // daria 30/11, e a real é 23/11).
    Dt("black-friday", "Black Friday", { tipo: "anual_nth", mes: 11, n: 4, dia_semana: 4, deslocamento_dias: 1, duracao_dias: 1 },
      "grande", "Geral", "#111111", 24),
    Dt("natal", "Véspera de Natal", fixa(12, 24), "grande", "Mercearia", "#006400", 25),
    Dt("reveillon", "Réveillon", fixa(12, 31), "grande", "Geral", "#ADB5BD", 26)
  ];

  /* ======================= MODELOS (seed da seção 9 — modelo inicial ajustável) =======================
     Também CÓPIA FIEL do sql/encartes_v1.sql (insert em encarte_modelos): mesmas vagas, na
     mesma ordem, e as mesmas dicas. Quem corrigir um lado corrige o outro (o teste cobra). */
  function v(chave, nome, oQueMuda, obrigatoria) {
    return { chave: chave, nome: nome, o_que_muda: oQueMuda, quantidade: 1, obrigatoria: obrigatoria !== false };
  }
  function G(chave, nome, vagas, extra) {
    var g = { chave: chave, nome: nome, ativo_padrao: true, vagas: vagas };
    for (var k in (extra || {})) g[k] = extra[k];
    return g;
  }
  function M(id, nome, prazos, grupos) {
    return { id: id, campanha_id: id, tipo: "edicao", nome: nome, prazos: prazos, dias_antes_no_ar: null,
      estrutura: { grupos: grupos }, dicas: null, versao: 1, ativo: true };
  }
  function T(id, campanhaId, nome, dicas) {
    return { id: id, campanha_id: campanhaId, tipo: "tema", nome: nome, prazos: {}, dias_antes_no_ar: null,
      estrutura: { grupos: [] }, dicas: dicas, versao: 1, ativo: true };
  }
  var MODELOS_PADRAO = [
    M("promocao-semanal", "Promoção Semanal", { comecar: 28, definir: 17, aprovar: 14 }, [
      G("capa", "Capa", [v("arroz", "Arroz", "marca"), v("cafe", "Café", "marca"), v("refrigerante", "Refrigerante", "marca"),
        v("frango", "Frango", "corte"), v("papel-higienico", "Papel higiênico", "marca"),
        v("carne-bovina", "Carne bovina · definir na semana", "corte", false)]),
      G("acougue", "Açougue", [v("frango", "Frango", "corte"), v("carne-suina", "Carne suína", "corte"), v("linguica", "Linguiça", "marca")]),
      G("cesta-basica", "Cesta básica", [v("arroz", "Arroz", "marca"), v("feijao", "Feijão", "marca"), v("acucar", "Açúcar", "marca"),
        v("oleo", "Óleo", "marca"), v("macarrao", "Macarrão", "marca"), v("farinha", "Farinha", "marca"), v("leite", "Leite", "marca"),
        v("biscoito", "Biscoito", "marca")]),
      G("limpeza", "Limpeza", [v("papel-higienico", "Papel higiênico", "marca"), v("sabao-em-po", "Sabão em pó", "marca"),
        v("detergente", "Detergente", "marca"), v("desinfetante", "Desinfetante", "marca"), v("amaciante", "Amaciante", "marca")]),
      G("higiene", "Higiene", [v("creme-dental", "Creme dental", "marca"), v("sabonete", "Sabonete", "marca"), v("shampoo", "Shampoo", "marca"),
        v("desodorante", "Desodorante", "marca"), v("fralda", "Fralda", "marca")]),
      G("frios-laticinios", "Frios e laticínios", [v("leite", "Leite", "marca"), v("margarina", "Margarina", "marca"), v("queijo", "Queijo", "marca"),
        v("presunto", "Presunto", "marca"), v("iogurte", "Iogurte", "marca")]),
      G("bebidas-conveniencia", "Bebidas e conveniência", [v("refrigerante", "Refrigerante", "marca"), v("agua", "Água", "marca"),
        v("suco", "Suco", "marca"), v("chocolate", "Chocolate", "marca"), v("sorvete", "Sorvete", "marca")]),
      G("fim-de-semana", "Fim de semana", [v("frango", "Frango", "corte"), v("linguica", "Linguiça", "marca"), v("carne-suina", "Carne suína", "corte"),
        v("bebida", "Bebida", "produto"), v("mercearia", "Mercearia", "produto"), v("conveniencia", "Conveniência", "produto")],
        { identidade: "Final de semana de ofertas", periodo: { ini_offset: 4, fim_offset: 6 } })
    ]),
    M("tercou", "Terçou das Frutas e Verduras", { comecar: 14, definir: 8, aprovar: 7 }, [
      G("hortifruti", "Hortifrúti", [v("batata", "Batata", "tipo"), v("tomate", "Tomate", "tipo"), v("cebola", "Cebola", "tipo"),
        v("cenoura", "Cenoura", "tipo"), v("banana", "Banana", "tipo"), v("fruta-da-estacao", "Fruta da estação", "produto"),
        v("folhagens", "Folhagens", "produto")], { flv: true, prazos: { comecar: 4, definir: 1, aprovar: 1 } }),
      G("demais-itens", "Demais itens", [v("congelado", "Congelado", "produto"), v("frios", "Frios", "produto"), v("frango", "Frango", "corte")])
    ]),
    M("sabado-bombastico", "Sábado Bombástico", { comecar: 42, definir: 28, aprovar: 21 }, [
      G("capa", "Capa", [v("arroz", "Arroz", "marca"), v("cafe", "Café", "marca"), v("acucar", "Açúcar", "marca"),
        v("refrigerante", "Refrigerante", "marca"), v("frango", "Frango", "corte")]),
      G("mercearia", "Mercearia", [v("feijao", "Feijão", "marca"), v("oleo", "Óleo", "marca"), v("macarrao", "Macarrão", "marca"),
        v("farinha", "Farinha", "marca"), v("leite", "Leite", "marca"), v("biscoito", "Biscoito", "marca"),
        v("molho-de-tomate", "Molho de tomate", "marca"), v("achocolatado", "Achocolatado", "marca")]),
      G("limpeza", "Limpeza", [v("sabao-em-po", "Sabão em pó", "marca"), v("detergente", "Detergente", "marca"), v("desinfetante", "Desinfetante", "marca"),
        v("amaciante", "Amaciante", "marca"), v("agua-sanitaria", "Água sanitária", "marca")]),
      G("perfumaria-beleza", "Perfumaria e beleza", [v("creme-dental", "Creme dental", "marca"), v("sabonete", "Sabonete", "marca"),
        v("shampoo", "Shampoo", "marca"), v("condicionador", "Condicionador", "marca"), v("desodorante", "Desodorante", "marca"),
        v("absorvente", "Absorvente", "marca"), v("fralda", "Fralda", "marca"), v("papel-higienico", "Papel higiênico", "marca")]),
      G("bebidas", "Bebidas", [v("cerveja", "Cerveja", "marca"), v("refrigerante", "Refrigerante", "marca"), v("suco", "Suco", "marca"), v("agua", "Água", "marca")]),
      G("frios-congelados", "Frios e congelados", [v("margarina", "Margarina", "marca"), v("queijo", "Queijo", "marca"), v("presunto", "Presunto", "marca"),
        v("congelado", "Congelado", "produto")]),
      G("acougue", "Açougue", [v("frango", "Frango", "corte"), v("carne-suina", "Carne suína", "corte"), v("linguica", "Linguiça", "marca")])
    ]),
    M("hora-da-economia", "Hora da Economia", { comecar: 35, definir: 21, aprovar: 14 }, [
      G("capa", "Capa", [v("arroz", "Arroz", "marca"), v("cafe", "Café", "marca"), v("oleo", "Óleo", "marca"), v("frango", "Frango", "corte")]),
      G("mercearia", "Mercearia", [v("feijao", "Feijão", "marca"), v("acucar", "Açúcar", "marca"), v("macarrao", "Macarrão", "marca"),
        v("farinha", "Farinha", "marca"), v("leite", "Leite", "marca"), v("biscoito", "Biscoito", "marca")]),
      G("limpeza", "Limpeza", [v("sabao-em-po", "Sabão em pó", "marca"), v("detergente", "Detergente", "marca"), v("desinfetante", "Desinfetante", "marca"),
        v("amaciante", "Amaciante", "marca")]),
      G("higiene", "Higiene", [v("creme-dental", "Creme dental", "marca"), v("sabonete", "Sabonete", "marca"), v("shampoo", "Shampoo", "marca"),
        v("desodorante", "Desodorante", "marca")]),
      G("bebidas", "Bebidas", [v("refrigerante", "Refrigerante", "marca"), v("suco", "Suco", "marca"), v("agua", "Água", "marca")]),
      G("frios", "Frios", [v("margarina", "Margarina", "marca"), v("queijo", "Queijo", "marca"), v("presunto", "Presunto", "marca")])
    ]),
    M("quarta-saudavel", "Quarta Saudável", { comecar: 21, definir: 10, aprovar: 7 }, [
      G("capa", "Capa", [v("aveia", "Aveia", "marca"), v("granola", "Granola", "marca"), v("iogurte-natural", "Iogurte natural", "marca"),
        v("castanhas", "Castanhas", "produto")]),
      G("graos-integrais", "Grãos e integrais", [v("arroz-integral", "Arroz integral", "marca"), v("chia", "Chia", "marca"),
        v("linhaca", "Linhaça", "marca"), v("pao-integral", "Pão integral", "marca"), v("macarrao-integral", "Macarrão integral", "marca")]),
      G("zero-diet", "Zero e diet", [v("adocante", "Adoçante", "marca"), v("refrigerante-zero", "Refrigerante zero", "marca"),
        v("chocolate-amargo", "Chocolate amargo ou diet", "marca"), v("geleia-sem-acucar", "Geleia sem açúcar", "marca")]),
      G("sem-lactose-gluten", "Sem lactose e sem glúten", [v("leite-sem-lactose", "Leite sem lactose", "marca"),
        v("iogurte-sem-lactose", "Iogurte sem lactose", "marca"), v("biscoito-sem-gluten", "Biscoito sem glúten", "marca"),
        v("macarrao-sem-gluten", "Macarrão sem glúten", "marca")]),
      G("bebidas", "Bebidas", [v("agua-de-coco", "Água de coco", "marca"), v("suco-integral", "Suco integral", "marca"),
        v("cha", "Chá", "marca"), v("agua-com-gas", "Água com gás", "marca")]),
      G("proteinas-leves", "Proteínas leves", [v("iogurte-grego", "Iogurte grego", "marca"), v("ovos", "Ovos", "marca"),
        v("atum", "Atum", "marca"), v("peito-de-peru", "Peito de peru", "marca")]),
      G("lanches", "Lanches", [v("barra-de-cereal", "Barra de cereal", "marca"), v("mix-castanhas", "Mix de castanhas", "marca"),
        v("frutas-secas", "Frutas secas", "produto")]),
      G("hortifruti", "Hortifrúti", [v("fruta-da-estacao", "Fruta da estação", "produto"), v("folhagens", "Folhas", "produto"),
        v("legumes", "Legumes", "produto")], { flv: true, prazos: { comecar: 4, definir: 1, aprovar: 1 } })
    ]),
    M("sexta-da-carne", "Sexta da Carne", { comecar: 14, definir: 7, aprovar: 5 }, [
      G("capa", "Capa", [v("costela-bovina", "Costela bovina", "corte"), v("carne-moida", "Carne moída", "corte"),
        v("contrafile", "Contrafilé", "corte"), v("linguica", "Linguiça", "marca")]),
      G("bovino-traseiro", "Bovino · traseiro", [v("alcatra", "Alcatra", "corte"), v("contrafile", "Contrafilé", "corte"),
        v("patinho", "Patinho", "corte"), v("coxao-mole", "Coxão mole", "corte"), v("coxao-duro", "Coxão duro", "corte"),
        v("lagarto", "Lagarto", "corte")]),
      G("bovino-dianteiro", "Bovino · dianteiro", [v("acem", "Acém", "corte"), v("paleta", "Paleta", "corte"),
        v("musculo", "Músculo", "corte"), v("peito", "Peito", "corte"), v("cupim", "Cupim", "corte"),
        v("fraldinha", "Fraldinha", "corte")]),
      G("churrasco", "Churrasco", [v("linguica-churrasco", "Linguiça para churrasco", "marca"), v("carvao", "Carvão", "marca"),
        v("pao-de-alho", "Pão de alho", "marca"), v("sal-grosso", "Sal grosso", "marca")]),
      G("suinos-aves", "Suínos e aves", [v("frango", "Frango", "corte"), v("coxa-sobrecoxa", "Coxa e sobrecoxa", "corte"),
        v("carne-suina", "Carne suína", "corte"), v("bisteca-suina", "Bisteca suína", "corte")])
    ]),
    T("tema-carnaval", "carnaval", "Carnaval", "Cerveja, destilados, energéticos, água e gelo."),
    T("tema-pascoa", "pascoa", "Páscoa", "Chocolates, vinhos, peixes, sardinha/atum, coco. Ovo de Páscoa não é obrigatório."),
    T("tema-black-friday", "black-friday", "Black Friday", "Grupo na Promoção Semanal da semana, com período próprio."),
    T("tema-natal", "natal", "Natal", "Bebidas, vinho, frutas secas, chocolate, carne suína. Prazo próprio do grupo a definir pelo dono."),
    T("tema-reveillon", "reveillon", "Réveillon", "Cerveja, destilados, energéticos, refrigerantes, espumantes, carne suína."),
    T("tema-aniversario", "aniversario-santa-rita", "Aniversário Santa Rita", "Verba com fornecedores (guardar a verba na proposta). Pode atravessar várias edições."),
    T("tema-dia-das-maes", "dia-das-maes", "Dia das Mães", null),
    T("tema-dia-das-criancas", "dia-das-criancas", "Dia das Crianças", "Brinquedos e chocolate; a compra começa na semana anterior."),
    T("tema-dia-dos-namorados", "dia-dos-namorados", "Dia dos Namorados", "Chocolate e vinho; período curto (véspera e dia)."),
    T("tema-sao-joao", "sao-joao", "São João", null),
    T("tema-dia-da-mulher", "dia-da-mulher", "Dia da Mulher", null),
    T("tema-dia-do-consumidor", "dia-do-consumidor", "Dia do Consumidor", null),
    T("tema-dia-dos-pais", "dia-dos-pais", "Dia dos Pais", null),
    T("tema-halloween", "halloween", "Halloween", null),
    T("tema-volta-as-aulas", "volta-as-aulas", "Volta às Aulas", "Papelaria; o período muda por ano (pico em fevereiro).")
  ];

  /* ======================= OCORRÊNCIAS DAS REGRAS ======================= */
  // Aceita a linha de calendario_regras ({..., regra:{...}}) ou só o jsonb da regra.
  function regraDe(r) { if (!r) return null; return r.regra !== undefined ? objeto(r.regra) : objeto(r); }
  function inteiro(x, padrao) { return tem(x) ? Math.round(+x) : padrao; }
  function nthDiaSemana(a, m, n, ds) {
    var p = ymd(a, m, 1);
    var d = addDias(addDias(p, (ds - diaSemana(p) + 7) % 7), 7 * (n - 1));
    return +d.slice(5, 7) === m ? d : null; // 5º sábado que não existe: não há ocorrência
  }
  function ultimoDiaSemana(a, m, ds) {
    var ult = addDias(m === 12 ? ymd(a + 1, 1, 1) : ymd(a, m + 1, 1), -1);
    return addDias(ult, -((diaSemana(ult) - ds + 7) % 7));
  }
  // Semanal com 7 dias ou mais cobre o ano inteiro (a Promoção Semanal, segunda→segunda).
  function ehContinua(R) { return !!R && R.tipo === "semanal" && inteiro(R.duracao_dias, 1) >= 7; }

  /* Ocorrências cujo período TOCA o intervalo [de, ate] (uma que começou antes de "de" e
     ainda está no ar entra). inicio_regra = o início que a regra manda (a edição guarda
     esse dia para nunca duplicar, mesmo que depois a data da edição seja mudada). */
  function ocorrencias(regra, deISO, ateISO) {
    var R = regraDe(regra), de = isoDe(deISO), ate = isoDe(ateISO);
    if (!R || !de || !ate || de > ate) return [];
    var dur = Math.max(1, inteiro(R.duracao_dias, 1));
    var desl = inteiro(R.deslocamento_dias, 0); // Páscoa/Carnaval e Black Friday usam; vale para qualquer tipo
    var a0 = +de.slice(0, 4) - 1, a1 = +ate.slice(0, 4) + 1;
    var ds = inteiro(R.dia_semana, null), n = inteiro(R.n, null), mes = inteiro(R.mes, null), dia = inteiro(R.dia, null);
    var inicios = [], saida = [], a, m, d;
    function soma(x) { if (x) inicios.push(addDias(x, desl)); }
    var dsOk = ds !== null && ds >= 0 && ds <= 6, mesOk = mes !== null && mes >= 1 && mes <= 12, nOk = n !== null && n >= 1 && n <= 5;
    switch (R.tipo) {
      case "semanal":
        if (!dsOk) break;
        var b = addDias(de, -(dur - 1 + Math.abs(desl)));
        for (d = addDias(b, (ds - diaSemana(b) + 7) % 7); d <= addDias(ate, Math.abs(desl)); d = addDias(d, 7)) soma(d);
        break;
      case "mensal_nth":
        if (!dsOk || !nOk) break;
        for (a = a0; a <= a1; a++) for (m = 1; m <= 12; m++) soma(nthDiaSemana(a, m, n, ds));
        break;
      case "mensal_ultimo":
        if (!dsOk) break;
        for (a = a0; a <= a1; a++) for (m = 1; m <= 12; m++) soma(ultimoDiaSemana(a, m, ds));
        break;
      case "anual_fixa":
        if (!mesOk || dia === null) break;
        for (a = a0; a <= a1; a++) if (valida(a, mes, dia)) soma(ymd(a, mes, dia)); // 29/02 só em ano bissexto
        break;
      case "anual_nth":
        if (!dsOk || !nOk || !mesOk) break;
        for (a = a0; a <= a1; a++) soma(nthDiaSemana(a, mes, n, ds));
        break;
      case "anual_ultimo":
        if (!dsOk || !mesOk) break;
        for (a = a0; a <= a1; a++) soma(ultimoDiaSemana(a, mes, ds));
        break;
      case "pascoa":
        for (a = a0; a <= a1; a++) soma(pascoa(a));
        break;
      case "datas":
        // Lista configurada por ano (Volta às Aulas). Cada item tem o próprio fim.
        (R.lista || []).forEach(function (x) {
          var i = isoDe(x && x.inicio), f = isoDe(x && x.fim) || i;
          if (i && f >= i) saida.push({ inicio: i, fim: f, inicio_regra: i });
        });
        break;
    }
    inicios.forEach(function (i) { saida.push({ inicio: i, fim: addDias(i, dur - 1), inicio_regra: i }); });
    var visto = {};
    return saida.filter(function (o) {
      if (o.fim < de || o.inicio > ate || visto[o.inicio]) return false;
      visto[o.inicio] = 1; return true;
    }).sort(function (x, y) { return x.inicio < y.inicio ? -1 : x.inicio > y.inicio ? 1 : 0; });
  }

  function ativa(r) { return !!r && (r.situacao || "ativa") === "ativa"; }

  // Todas as campanhas e datas ATIVAS no intervalo. Pausada não aparece nem gera nada.
  function ocorrenciasCampanhas(regras, deISO, ateISO) {
    var out = [];
    (regras || []).forEach(function (r) {
      if (!ativa(r)) return;
      var R = regraDe(r), cont = ehContinua(R), sem = !!R && R.tipo === "semanal";
      ocorrencias(R, deISO, ateISO).forEach(function (o) {
        // semanal: a coincidência precisa saber (campanha semanal só faz par com data grande)
        out.push({ id: r.id, nome: r.nome, tipo: r.tipo || "campanha", categoria: r.categoria || null, cor: r.cor || null,
          setor: r.setor || null, inicio: o.inicio, fim: o.fim, inicio_regra: o.inicio_regra, continua: cont, semanal: sem,
          ordem: inteiro(r.ordem, 0) });
      });
    });
    return out.sort(function (x, y) {
      if (x.inicio !== y.inicio) return x.inicio < y.inicio ? -1 : 1;
      if (x.ordem !== y.ordem) return x.ordem - y.ordem;
      return String(x.nome) < String(y.nome) ? -1 : 1;
    });
  }

  /* ======================= EDIÇÕES ======================= */
  function gruposDe(modelo) { var e = objeto(modelo && modelo.estrutura); return (e && e.grupos) || []; }
  function temPrazoProprio(g) { var p = objeto(g && g.prazos); return !!p && (tem(p.comecar) || tem(p.definir) || tem(p.aprovar)); }

  // Período de um grupo: o que foi gravado na edição, ou o deslocamento do modelo, ou o da edição.
  function periodoGrupo(g, inicioEdicao, fimEdicao) {
    g = g || {};
    var gi = isoDe(g.inicio), gf = isoDe(g.fim);
    if (gi && gf) return { inicio: gi, fim: gf };
    var p = objeto(g.periodo), ini = isoDe(inicioEdicao);
    if (p && ini && tem(p.ini_offset) && tem(p.fim_offset)) return { inicio: addDias(ini, +p.ini_offset), fim: addDias(ini, +p.fim_offset) };
    return { inicio: ini, fim: isoDe(fimEdicao) };
  }

  /* Prazos de uma edição e dos grupos que têm prazo PRÓPRIO (Terçou hortifrúti, Natal).
     Grupo sem prazo próprio segue a régua da edição, mesmo com período próprio (o Fim de
     semana acompanha a Promoção Semanal — D7·2). O "começar" da edição é o MAIS CEDO entre
     ela e esses grupos: a edição entra na fila quando a primeira parte dela começa. */
  function prazosEdicao(modelo, inicio, fim) {
    var base = calcularPrazos(inicio, objeto(modelo && modelo.prazos) || {}, { flv: false });
    var grupos = {}, comecar = base.comecar;
    gruposDe(modelo).forEach(function (g) {
      if (!g || !g.chave || g.ativo_padrao === false || !temPrazoProprio(g)) return;
      var per = periodoGrupo(g, inicio, fim);
      var pz = calcularPrazos(per.inicio, objeto(g.prazos), { flv: !!g.flv });
      grupos[g.chave] = { inicio: per.inicio, fim: per.fim, comecar: pz.comecar, definir: pz.definir, aprovar: pz.aprovar };
      if (pz.comecar && (!comecar || pz.comecar < comecar)) comecar = pz.comecar;
    });
    return { comecar: comecar, definir: base.definir, aprovar: base.aprovar, grupos: grupos };
  }

  function modeloEdicaoDe(campanhaId, modelos) {
    var L = (modelos || []).filter(function (m) { return m && m.tipo === "edicao" && m.ativo !== false && m.campanha_id === campanhaId; });
    L.sort(function (x, y) { return inteiro(y.versao, 1) - inteiro(x.versao, 1); });
    return L[0] || null;
  }
  // Quantos dias antes do início a edição mais adiantada pode começar (para a janela de busca).
  function alcance(modelo) {
    var p = objeto(modelo.prazos) || {}, mx = tem(p.comecar) ? +p.comecar : 0;
    gruposDe(modelo).forEach(function (g) {
      var gp = objeto(g && g.prazos) || {}, per = objeto(g && g.periodo) || {};
      var antes = (tem(gp.comecar) ? +gp.comecar : 0) - (tem(per.ini_offset) ? +per.ini_offset : 0);
      if (antes > mx) mx = antes;
    });
    return mx + 20; // folga da antecipação (Natal, Ano Novo, Carnaval)
  }
  function chaveEdicao(campanhaId, inicioRegra) { return campanhaId + "|" + isoDe(inicioRegra); }

  // As edições que as regras mandam, com prazos calculados, cujo período toca [de, ate].
  function projetar(regras, modelos, deISO, ateExtra) {
    var out = [];
    (regras || []).forEach(function (r) {
      if (!ativa(r) || (r.tipo || "campanha") !== "campanha") return;
      var m = modeloEdicaoDe(r.id, modelos); if (!m) return;
      ocorrencias(r, deISO, addDias(ateExtra, alcance(m))).forEach(function (o) {
        // Título no MESMO formato que o banco grava ('<nome> · DD/MM/AAAA' do início): a edição
        // virtual não muda de nome no dia em que nasce de verdade.
        out.push({ campanha_id: r.id, modelo_id: m.id, modelo_versao: inteiro(m.versao, 1),
          titulo: (r.nome || r.id) + " · " + fmtData(o.inicio), inicio_regra: o.inicio_regra,
          inicio: o.inicio, fim: o.fim, prazos: prazosEdicao(m, o.inicio, o.fim),
          nome: r.nome || r.id, cor: r.cor || null, setor: r.setor || null });
      });
    });
    return out;
  }
  function porComecar(x, y) {
    var a = x.prazos.comecar || x.inicio, b = y.prazos.comecar || y.inicio;
    if (a !== b) return a < b ? -1 : 1;
    return x.inicio < y.inicio ? -1 : x.inicio > y.inicio ? 1 : 0;
  }

  /* As edições que JÁ deviam existir: campanha ATIVA, tipo 'campanha', com modelo 'edicao'
     ativo, cujo começar ≤ hoje e fim ≥ hoje (ou hoje − diasPassados, opcional) e que ainda
     não estão em "existentes" ([{campanha_id, inicio_regra}] — passar TODAS as edições do
     banco, inclusive juntadas e canceladas, para nunca recriar). Modelo sem prazo de começar
     não cria nada (sem prazo, não há quando entrar na fila). */
  function edicoesParaCriar(regras, modelos, hojeIso, existentes, o) {
    var hoje = isoDe(hojeIso) || hojeISO(), passados = Math.max(0, inteiro(o && o.diasPassados, 0));
    var minFim = addDias(hoje, -passados), ja = {};
    (existentes || []).forEach(function (e) { if (e) ja[chaveEdicao(e.campanha_id, e.inicio_regra)] = 1; });
    return projetar(regras, modelos, minFim, hoje).filter(function (e) {
      return e.prazos.comecar && e.prazos.comecar <= hoje && e.fim >= minFim && !ja[chaveEdicao(e.campanha_id, e.inicio_regra)];
    }).sort(porComecar);
  }
  /* As que ainda NÃO começaram (começar > hoje) e começam em até "dias" dias (padrão 70):
     edições virtuais, mostradas "Começa em N dias" sem gravar nada. */
  function edicoesFuturas(regras, modelos, hojeIso, dias, existentes) {
    var hoje = isoDe(hojeIso) || hojeISO(), lim = addDias(hoje, tem(dias) ? Math.max(0, +dias) : 70), ja = {};
    (existentes || []).forEach(function (e) { if (e) ja[chaveEdicao(e.campanha_id, e.inicio_regra)] = 1; });
    return projetar(regras, modelos, hoje, lim).filter(function (e) {
      return e.prazos.comecar && e.prazos.comecar > hoje && e.prazos.comecar <= lim && !ja[chaveEdicao(e.campanha_id, e.inicio_regra)];
    }).map(function (e) { e.virtual = true; return e; }).sort(porComecar);
  }

  // Data do tema: o grupo temático entra no ar "dias_antes_no_ar" antes da data (null = na data).
  function inicioTema(modeloTema, dataISO) {
    var d = isoDe(dataISO); if (!d) return null;
    var n = inteiro(modeloTema && modeloTema.dias_antes_no_ar, 0);
    return addDias(d, -Math.max(0, n));
  }
  /* A edição que cobre um dia (para sugerir onde nasce um grupo temático; o usuário pode
     escolher outra). Prefere a Promoção Semanal (estrutura principal, D7·5) e, no dia em que
     duas semanas se encostam (segunda), a que COMEÇA naquele dia. */
  function sugerirHospedeira(edicoes, diaISO) {
    var d = isoDe(diaISO); if (!d) return null;
    var L = (edicoes || []).filter(function (e) {
      return e && (e.situacao || "ativa") === "ativa" && isoDe(e.inicio) <= d && d <= isoDe(e.fim);
    });
    L.sort(function (x, y) {
      var px = x.campanha_id === "promocao-semanal" ? 0 : 1, py = y.campanha_id === "promocao-semanal" ? 0 : 1;
      if (px !== py) return px - py;
      return isoDe(x.inicio) > isoDe(y.inicio) ? -1 : isoDe(x.inicio) < isoDe(y.inicio) ? 1 : 0;
    });
    return L[0] || null;
  }

  /* ======================= VAGAS E SITUAÇÃO ======================= */
  /* Conta as vagas ATIVAS do escopo (a edição, ou um grupo com prazo próprio — quem chama
     escolhe as vagas). definida = tem proposta escolhida; negociando = tem proposta ativa e
     nenhuma escolhida; a negociar = nenhuma proposta ativa. */
  function contarVagas(vagas, propostas) {
    var comProposta = {};
    (propostas || []).forEach(function (p) { if (p && (p.situacao || "ativa") !== "descartada") comProposta[p.vaga_id] = 1; });
    var c = { total: 0, definidas: 0, negociando: 0, aNegociar: 0, aprovadas: 0, emAjuste: 0, aguardandoVisto: 0, pendentes: 0 };
    (vagas || []).forEach(function (vg) {
      if (!vg || (vg.situacao || "ativa") === "retirada") return;
      c.total++;
      if (vg.proposta_escolhida) c.definidas++;
      else if (comProposta[vg.id]) c.negociando++;
      else c.aNegociar++;
      var e = vg.estado || "pendente";
      if (e === "aprovada") c.aprovadas++;
      else if (e === "em_ajuste") c.emAjuste++;
      else if (e === "aguardando_visto") c.aguardandoVisto++;
      else c.pendentes++;
    });
    return c;
  }
  function dias1(n) { return n + (n === 1 ? " dia" : " dias"); }
  function vagas1(n) { return n + (n === 1 ? " vaga" : " vagas"); }

  /* Situação de uma edição (ou grupo com prazo próprio). Ordem: aprovado > futuro >
     atrasado > atenção > no prazo. Prazo vencido é ALERTA, nunca bloqueio.
     sem_penalidade (edição anterior ao processo): o vermelho vira "Anterior ao processo"
     em âmbar e "Entrou no ar sem aprovação" não acusa.
     contagem.pendentesNoAr (opcional): vagas sem aprovação cujo GRUPO já entrou no ar. Quando
     vem, "Entrou no ar sem aprovação" usa esse número, e não o total de pendentes: o Fim de
     semana só entra no ar na sexta, e o banco trata a vaga dele como "antes do ar" até lá. */
  function situacao(ed, contagem, hojeIso) {
    ed = ed || {};
    var pz = objeto(ed.prazos) || {}, hoje = isoDe(hojeIso) || hojeISO(), c = contagem || {};
    var total = +c.total || 0, def = +c.definidas || 0, neg = +c.negociando || 0, apr = +c.aprovadas || 0;
    var ini = isoDe(ed.inicio), comecar = isoDe(pz.comecar), definir = isoDe(pz.definir), aprovar = isoDe(pz.aprovar);
    var semPen = ed.sem_penalidade === true;
    var faltamDef = total - def, faltamApr = total - apr;
    var R = { k: "no_prazo", rotulo: "No prazo", texto: "", noArSemAprovacao: false,
      diasParaOAr: ini ? diasEntre(hoje, ini) : null, semPenalidade: semPen };
    R.noArSemAprovacao = tem(c.pendentesNoAr)
      ? !semPen && +c.pendentesNoAr > 0
      : !semPen && !!ini && hoje >= ini && total > 0 && faltamApr > 0;

    function sai(k, rotulo, txt) { R.k = k; R.rotulo = rotulo; R.texto = txt; return R; }
    function vermelho(txt) {
      if (semPen) return sai("atencao", "Anterior ao processo", txt + " (edição anterior ao processo, sem penalidade)");
      return sai("atrasado", "Atrasado", txt);
    }

    if (total > 0 && apr === total) return sai("aprovado", "Aprovado", "Todas as " + vagas1(total) + " aprovadas");
    if (comecar && hoje < comecar) {
      var n = diasEntre(hoje, comecar);
      return sai("futuro", "Começa em " + dias1(n), "Planejamento começa em " + fmtData(comecar, { curta: true }));
    }
    if (definir && hoje > definir && faltamDef > 0)
      return vermelho("Prazo para definir as vagas passou em " + fmtData(definir, { curta: true }) + " · faltam " + faltamDef);
    if (aprovar && hoje > aprovar && total > 0 && faltamApr > 0)
      return vermelho("Aprovação atrasada desde " + fmtData(aprovar, { curta: true }) + (apr > 0 ? " · faltam " + vagas1(faltamApr) : ""));
    if (definir && faltamDef > 0) {
      var q = diasEntre(hoje, definir);
      if (q >= 0 && q <= 3)
        return sai("atencao", "Atenção", "Definir as vagas " + (q === 0 ? "HOJE" : "até " + fmtData(definir, { curta: true }) + " (" + dias1(q) + ")") + " · faltam " + faltamDef);
    }
    if (comecar && total > 0 && def + neg === 0 && diasEntre(comecar, hoje) >= 7)
      return sai("atencao", "Atenção", "Ninguém começou a negociar ainda");
    if (faltamDef > 0 && definir) return sai("no_prazo", "No prazo", "Definir as vagas até " + fmtData(definir, { curta: true }));
    if (total > 0 && faltamApr > 0 && aprovar) return sai("no_prazo", "No prazo", "Aprovar até " + fmtData(aprovar, { curta: true }));
    return sai("no_prazo", "No prazo", total === 0 ? "Nenhuma vaga ativa" : "");
  }

  /* ======================= MARGEM E CUSTO (D8) ======================= */
  /* Margem em % (2 casas). Indisponível sem preço de oferta ou sem custo (custo AUSENTE não é
     zero). Custo zero ou negativo também é indisponível: faria a margem parecer 100% ou mais. */
  function margem(preco, custo) {
    var p = pos(preco), c = pos(custo);
    if (p === null || c === null) return null;
    return r2((p - c) / p * 100);
  }

  /* Uma proposta, lado a lado. custo_hoje (VR, com imposto, última entrada) e custo_negociado
     (da proposta) NUNCA se substituem: os dois aparecem, com a variação. O considerado é o
     negociado; sem ele, o do VR SÓ se custo_confiavel === true (igual ao banco: confiança
     desconhecida não é usada); senão, indisponível.
     Custo NÃO confiável (custo_confiavel === false, carne de desossa): a variação hoje ×
     negociado fica indisponível (variacaoIndisponivel traz o texto, sem cor: comparar com
     um custo que não serve pareceria ganho ou perda) e não sai o alerta "Margem negativa"
     (seção 4: só com custo confiável). A margem continua calculada sobre o NEGOCIADO.
     O rótulo "Custo não confiável" só aparece com === false (custoConfiavel = !== false).
     Margem com verba: verba por unidade = verba_valor ÷ verba_qtd_base; bonificação "a cada
     N leva M" = custo × N/(N+M). Só calcula com os campos estruturados completos; verba
     parcial, ou bonificação só em texto, = "não calculável". Se o custo efetivo ficar ≤ 0
     (verba maior que o custo), a margem com verba é indisponível e sai o alerta
     "verba_maior_que_custo". ctx.inicio (ou p.inicio) = 1º dia no ar, para o aviso de validade. */
  function analiseProposta(p, ctx) {
    p = p || {}; ctx = ctx || {};
    var custoHoje = pos(p.custo_hoje), naoConfiavel = p.custo_confiavel === false, confiavel = !naoConfiavel;
    var custoNeg = pos(p.custo_negociado), precoNormal = pos(p.preco_normal), precoOferta = pos(p.preco_oferta);
    var variacaoRS = null, variacaoPct = null, variacaoIndisponivel = null;
    if (custoHoje !== null && naoConfiavel) variacaoIndisponivel = "indisponível — custo do VR não confiável";
    else if (custoHoje !== null && custoNeg !== null) { variacaoRS = r2(custoNeg - custoHoje); variacaoPct = r2((custoNeg - custoHoje) / custoHoje * 100); }
    var considerado = custoNeg !== null ? custoNeg : (custoHoje !== null && p.custo_confiavel === true ? custoHoje : null);
    var mg = margem(precoOferta, considerado);

    var V = pos(p.verba_valor), Q = pos(p.verba_qtd_base), N = pos(p.bonif_compra), Mb = pos(p.bonif_ganha);
    var bonifTxt = texto(p.bonificacao_texto);
    var verbaInf = V !== null || Q !== null, verbaOk = V !== null && Q !== null;
    var bonifInf = N !== null || Mb !== null, bonifOk = N !== null && Mb !== null;
    var temVerba = verbaInf || bonifInf || !!bonifTxt;
    var calculavel = considerado !== null && precoOferta !== null && (verbaInf || bonifInf) &&
      (!verbaInf || verbaOk) && (!bonifInf || bonifOk) && !(bonifTxt && !bonifInf);
    var custoComVerba = null, mgVerba = null, verbaMaior = false;
    if (calculavel) {
      var cv = considerado;
      if (bonifOk) cv = cv * N / (N + Mb);
      if (verbaOk) cv = cv - V / Q;
      custoComVerba = r4(cv);
      verbaMaior = !(cv > 0); // custo efetivo zero ou negativo: margem acima de 100% seria mentira
      mgVerba = verbaMaior ? null : margem(precoOferta, cv);
    }

    var A = [];
    if (custoHoje === null) A.push({ tipo: "sem_custo", texto: "Sem custo no VR" });
    if (naoConfiavel) A.push({ tipo: "custo_nao_confiavel", texto: "Custo não confiável" });
    if (mg !== null && mg < 0 && !naoConfiavel) A.push({ tipo: "margem_negativa", texto: "Margem negativa (" + fmtNum(mg, 1) + "%)" });
    if (verbaMaior) A.push({ tipo: "verba_maior_que_custo", texto: "Verba maior que o custo — confira os números" });
    if (precoOferta !== null && precoNormal !== null && precoOferta >= precoNormal)
      A.push({ tipo: "oferta_acima_normal", texto: "Preço de oferta igual ou acima do preço normal" });
    var ini = isoDe(ctx.inicio || p.inicio), val = isoDe(p.validade);
    if (ini && val && val < ini) A.push({ tipo: "validade", texto: "Proposta vence antes do início (" + fmtData(val) + ")" });

    return {
      custoHoje: custoHoje, custoConfiavel: confiavel, semCusto: custoHoje === null, custoNegociado: custoNeg,
      variacaoRS: variacaoRS, variacaoPct: variacaoPct, variacaoIndisponivel: variacaoIndisponivel, custoConsiderado: considerado,
      origemCusto: custoNeg !== null ? "negociado" : considerado !== null ? "vr" : null,
      margem: mg, margemComVerba: mgVerba, margemComVerbaCalculavel: calculavel, temVerba: temVerba,
      verbaPorUnidade: verbaOk ? r4(V / Q) : null, custoComVerba: custoComVerba,
      precoNormal: precoNormal, precoOferta: precoOferta,
      descontoCliente: precoNormal !== null && precoOferta !== null ? r2((precoNormal - precoOferta) / precoNormal * 100) : null,
      descontoClienteRS: precoNormal !== null && precoOferta !== null ? r2(precoNormal - precoOferta) : null,
      alertas: A
    };
  }

  /* ======================= MUDANÇA DEPOIS DE APROVADO (D4) ======================= */
  // Produtos como CONJUNTO (ordem e repetido não contam), igual ao encarte__prod_conjunto.
  function produtosDe(x) {
    var L = x.produtos || (x.produtos_info || []).map(function (i) { return i && i.id; }), visto = {};
    return (L || []).filter(tem).map(Number).filter(function (n) { if (visto[n]) return false; visto[n] = 1; return true; })
      .sort(function (a, b) { return a - b; }).join(",");
  }
  function fornecedorDe(x) { return tem(x.fornecedor_id) ? "id:" + (+x.fornecedor_id) : "nome:" + texto(x.fornecedor_nome).toUpperCase(); }
  // Números comparados SEM arredondar, como o banco (numeric "is distinct from"): R$ 12,99 →
  // 12,991 é mudança lá, então é mudança aqui. Branco não é zero: vazio só é igual a vazio.
  function igualNum(a, b) { return num(a) === num(b); }
  function positivo(x) { return x !== null && x > 0; }
  /* Espelho do encarte__verba_reduziu: verba TOTAL (verba_valor) menor ou retirada; OU a
     bonificação "a cada N leva M" retirada ou com fração ganha M/(N+M) menor. Completar ou
     mudar só a quantidade-base da verba não reduz (só registra). */
  function verbaReduziu(a, d) {
    var va = num(a.verba_valor), vd = num(d.verba_valor);
    return positivo(va) && (!positivo(vd) || vd < va);
  }
  function bonifReduziu(a, d) {
    var ca = num(a.bonif_compra), ga = num(a.bonif_ganha), cd = num(d.bonif_compra), gd = num(d.bonif_ganha);
    if (!(positivo(ca) && positivo(ga))) return false;
    if (!(positivo(cd) && positivo(gd))) return true;
    return gd / (cd + gd) < ga / (ca + ga);
  }

  /* ESPELHO EXATO da seção 5 no banco (encarte__razoes_reabre, encarte__verba_reduziu e
     encarte__criticas), para a tela AVISAR antes de gravar. Quem decide é o banco; se as duas
     peças discordarem, a pessoa lê uma coisa e o banco faz outra (o teste compara as duas
     num Postgres temporário quando há um na máquina).
     antes/depois = a proposta escolhida da vaga (com id, produtos, preço, custo, verba...);
     depois null ou {situacao:'retirada'} = vaga retirada; depois {situacao:'descartada'} =
     a escolhida foi descartada; antes null = vaga nova.
     Antes do ar: "reabre" quando os produtos mudam (como conjunto), o preço de oferta muda
     (qualquer mudança, inclusive apagar), o custo negociado SOBE (os dois informados) ou a
     verba/bonificação diminui. O resto só registra.
     No ar: nunca reabre; CRÍTICA quando o preço anunciado sobe ou é apagado, o produto troca,
     a vaga sai ou a escolhida é descartada.
     ATENÇÃO: esta função NÃO sabe o estado da vaga. O banco só reabre vaga 'aprovada'; quem
     chama só avisa "volta para Aguardando visto" se a vaga estiver aprovada e antes do ar
     (pendente, em ajuste ou aguardando visto não recebem esse aviso). */
  function mudancaMaterial(antes, depois, o) {
    o = o || {};
    var noAr = o.noAr === true || (!!isoDe(o.hoje) && !!isoDe(o.inicio) && isoDe(o.hoje) >= isoDe(o.inicio));
    var R = { reabre: false, critica: false, campos: [], soRegistra: false, motivos: [], vagaNova: false, noAr: noAr };
    function reabre(m) { if (!noAr) { R.reabre = true; R.motivos.push(m); } }
    function critica(m) { if (noAr) { R.critica = true; R.motivos.push(m); } }
    if (!antes && !depois) return R;
    if (!antes) {
      R.vagaNova = true; R.campos.push("vaga_nova");
      R.motivos.push("Vaga nova: nasce pendente e entra na próxima aprovação");
      return R;
    }
    if (!depois || depois.retirada === true || depois.situacao === "retirada" || depois.vaga_situacao === "retirada") {
      R.campos.push("retirada");
      critica("Vaga retirada com o encarte no ar");
      R.soRegistra = !R.critica;
      return R;
    }
    if (depois.situacao === "descartada") {
      R.campos.push("descartada");
      reabre("A proposta escolhida foi descartada");
      critica("A proposta anunciada foi descartada com o encarte no ar");
      R.soRegistra = !R.reabre && !R.critica;
      return R;
    }
    if (antes.id && depois.id && antes.id !== depois.id) R.campos.push("proposta");
    if (produtosDe(antes) !== produtosDe(depois)) {
      R.campos.push("produtos");
      reabre("Produtos trocados");
      critica("Produto trocado com o encarte no ar");
    }
    if (!igualNum(antes.preco_oferta, depois.preco_oferta)) {
      R.campos.push("preco_oferta");
      reabre("Preço de oferta mudou");
      var pa = num(antes.preco_oferta), pd = num(depois.preco_oferta);
      if (pa !== null && pd === null) critica("Preço anunciado apagado com o encarte no ar");
      else if (pa !== null && pd > pa) critica("Preço anunciado subiu com o encarte no ar");
    }
    if (!igualNum(antes.custo_negociado, depois.custo_negociado)) {
      R.campos.push("custo_negociado");
      var ca = num(antes.custo_negociado), cd = num(depois.custo_negociado);
      if (ca !== null && cd !== null && cd > ca) reabre("Custo negociado subiu");
    }
    if (!igualNum(antes.verba_valor, depois.verba_valor) || !igualNum(antes.verba_qtd_base, depois.verba_qtd_base)) R.campos.push("verba");
    if (verbaReduziu(antes, depois)) reabre("Verba reduzida ou retirada");
    if (!igualNum(antes.bonif_compra, depois.bonif_compra) || !igualNum(antes.bonif_ganha, depois.bonif_ganha)) R.campos.push("bonificacao");
    if (bonifReduziu(antes, depois)) reabre("Bonificação reduzida ou retirada");
    if (fornecedorDe(antes) !== fornecedorDe(depois)) R.campos.push("fornecedor");
    ["condicao_pagamento", "quantidade_minima", "validade", "observacao", "bonificacao_texto"].forEach(function (k) {
      if (texto(antes[k]) !== texto(depois[k])) R.campos.push(k);
    });
    // Atualização do robô (ficha do VR): só registra, nunca reabre.
    if (!igualNum(antes.custo_hoje, depois.custo_hoje) || !igualNum(antes.preco_normal, depois.preco_normal) ||
        (antes.custo_confiavel === false) !== (depois.custo_confiavel === false)) R.campos.push("dados_vr");
    R.soRegistra = R.campos.length > 0 && !R.reabre && !R.critica;
    return R;
  }

  /* ======================= COINCIDÊNCIAS (D7·7) ======================= */
  /* ocorrencias = [{id (da campanha), nome, inicio, fim, tipo?, categoria?, continua?, semanal?}]
     — o que faltar vem das regras (opcoes.regras, ou o seed). Entram: campanhas com edição
     que não cobrem o ano inteiro, e datas GRANDES. Datas médias e a Promoção Semanal não.
     Par da mesma campanha não conta; par de duas datas (sem campanha) também não.
     Campanha de regra SEMANAL (qualquer duração, ex.: Terçou) só faz par com data GRANDE,
     nunca com outra campanha: toda semana ela encosta em alguma (Terçou × Hora da Economia
     todo mês), e o aviso que aparece sempre deixa de ser lido.
     opcoes.comEdicao (opcional) = lista de ids das campanhas com modelo de edição ATIVO. Quando
     vem, ocorrência de campanha fora dela não conta (seção 6: "com edição própria" — uma
     campanha criada no Calendário sem modelo não tem edição do outro lado para decidir).
     dias = 0 quando se sobrepõem; senão, a distância entre o fim de uma e o início da outra.
     Quem chama passa só o que está ativo (sem pausadas, canceladas ou juntadas). */
  function coincidencias(ocs, o) {
    o = o || {};
    var margemDias = tem(o.margemDias) ? +o.margemDias : 1, mapa = {}, comEd = null;
    (o.regras || REGRAS_PADRAO).forEach(function (r) { if (r && r.id) mapa[r.id] = r; });
    if (Array.isArray(o.comEdicao)) { comEd = {}; o.comEdicao.forEach(function (id) { if (id !== null && id !== undefined) comEd[id] = 1; }); }
    var L = [];
    (ocs || []).forEach(function (x) {
      if (!x) return;
      var r = mapa[x.id] || {}, ini = isoDe(x.inicio), fim = isoDe(x.fim) || ini;
      if (!ini) return;
      var tipo = x.tipo || r.tipo || "campanha", R = regraDe(r);
      var cat = x.categoria !== undefined ? x.categoria : (r.categoria || null);
      var cont = x.continua !== undefined ? !!x.continua : ehContinua(R);
      var sem = x.semanal !== undefined ? !!x.semanal : (!!R && R.tipo === "semanal");
      if (tipo === "data" ? cat !== "grande" : cont) return;
      if (tipo !== "data" && comEd && !comEd[x.id]) return;
      L.push({ x: x, id: x.id, nome: x.nome || r.nome || x.id, tipo: tipo, semanal: tipo !== "data" && sem, ini: ini, fim: fim });
    });
    L.sort(function (a, b) { return a.ini < b.ini ? -1 : a.ini > b.ini ? 1 : String(a.id) < String(b.id) ? -1 : 1; });
    var out = [];
    for (var i = 0; i < L.length; i++) for (var j = i + 1; j < L.length; j++) {
      var a = L[i], b = L[j];
      if (a.id === b.id || (a.tipo === "data" && b.tipo === "data")) continue;
      // semanal só com data grande: duas campanhas em que uma é semanal não formam par
      if (a.tipo !== "data" && b.tipo !== "data" && (a.semanal || b.semanal)) continue;
      var dias = a.ini <= b.fim && b.ini <= a.fim ? 0 : a.fim < b.ini ? diasEntre(a.fim, b.ini) : diasEntre(b.fim, a.ini);
      if (dias > margemDias) continue;
      var pa = a.nome + " (" + fmtPeriodo(a.ini, a.fim, { curta: true }) + ")", pb = b.nome + " (" + fmtPeriodo(b.ini, b.fim, { curta: true }) + ")";
      out.push({ a: a.x, b: b.x, dias: dias,
        texto: dias === 0 ? pa + " e " + pb + " caem no mesmo período" : pa + " e " + pb + " ficam a " + dias1(dias) + " uma da outra" });
    }
    return out;
  }

  /* Duas edições SEGUIDAS da mesma campanha que só se tocam no dia de encosto (a Promoção
     Semanal termina na segunda em que a próxima começa). Um termina no dia em que o outro
     começa e nenhum contém o outro. A campanha vem de campanha_id; sem ela nos dois itens,
     vale a pista das edições seguidas: a mesma duração. */
  function soEncostoMesmaCampanha(a, b, ai, af, bi, bf) {
    var ponta = (af === bi && ai < bi && af < bf) || (bf === ai && bi < ai && bf < af);
    if (!ponta) return false;
    if (texto(a.campanha_id) && texto(b.campanha_id)) return texto(a.campanha_id) === texto(b.campanha_id);
    return diasEntre(ai, af) === diasEntre(bi, bf);
  }
  /* Mesmo produto (proposta escolhida) em grupos/edições com períodos sobrepostos e preço
     OU período diferente: destacar, sem bloquear. Igual em tudo (mesmo preço, mesmo período)
     não é conflito. Preço não informado de um lado não acusa diferença de preço.
     Também NÃO destaca quando a única sobreposição é o dia de encosto entre duas edições da
     MESMA campanha e o preço é igual: o café e o arroz de linha virariam destaque toda
     semana, e o destaque perderia a força. Com preço diferente no encosto, destaca.
     Cada item: {produto_id, inicio, fim, preco, campanha_id?, descricao?, ...}. */
  function sobreposicaoProdutos(itens) {
    var por = {}, ordem = [];
    (itens || []).forEach(function (it) {
      if (!it || !tem(it.produto_id) || !isoDe(it.inicio)) return;
      var k = String(+it.produto_id);
      if (!por[k]) { por[k] = []; ordem.push(k); }
      por[k].push(it);
    });
    var out = [];
    ordem.forEach(function (k) {
      var L = por[k], env = {}, dif = {};
      for (var i = 0; i < L.length; i++) for (var j = i + 1; j < L.length; j++) {
        var a = L[i], b = L[j], ai = isoDe(a.inicio), af = isoDe(a.fim) || ai, bi = isoDe(b.inicio), bf = isoDe(b.fim) || bi;
        if (!(ai <= bf && bi <= af)) continue;
        var dPreco = tem(a.preco) && tem(b.preco) && r2(+a.preco) !== r2(+b.preco);
        var dPer = ai !== bi || af !== bf;
        if (!dPreco && !dPer) continue;
        if (!dPreco && soEncostoMesmaCampanha(a, b, ai, af, bi, bf)) continue;
        env[i] = env[j] = 1;
        if (dPreco) dif.preco = 1;
        if (dPer) dif.periodo = 1;
      }
      var envolvidos = L.filter(function (x, i) { return env[i]; });
      if (!envolvidos.length) return;
      envolvidos.sort(function (x, y) { return isoDe(x.inicio) < isoDe(y.inicio) ? -1 : isoDe(x.inicio) > isoDe(y.inicio) ? 1 : 0; });
      out.push({ produto_id: +k, descricao: (envolvidos[0].descricao || ""), itens: envolvidos,
        diferencas: ["preco", "periodo"].filter(function (d) { return dif[d]; }) });
    });
    return out;
  }

  /* ======================= FRESCOR DOS DADOS DO VR (D9) ======================= */
  var JANELA_INI = 6, JANELA_FIM = 21; // o VR só responde das 06h às 21h (hora local)
  /* Minutos que passaram DENTRO das janelas 06h–21h entre a última atualização e agora.
     É a "idade útil" do dado: à noite o robô não roda, então a noite não envelhece o dado.
     Assim: dentro do horário, mais de 2 h sem atualizar = desatualizado; fora do horário,
     desatualizado se a última boa ficou mais de 2 h antes do fim do último dia útil; e às
     06h30 o dado das 20h50 de ontem ainda não é acusado (o robô nem pôde rodar). */
  function minutosUteis(de, ate) {
    if (!de || !ate || ate <= de) return 0;
    if (ate - de > 45 * DIA_MS) return 99999;
    var total = 0, d = new Date(de.getFullYear(), de.getMonth(), de.getDate());
    for (var i = 0; i < 50 && d <= ate; i++) {
      var ja = new Date(d.getFullYear(), d.getMonth(), d.getDate(), JANELA_INI), jf = new Date(d.getFullYear(), d.getMonth(), d.getDate(), JANELA_FIM);
      var a = Math.max(ja.getTime(), de.getTime()), b = Math.min(jf.getTime(), ate.getTime());
      if (b > a) total += (b - a) / 60000;
      d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    }
    return Math.round(total);
  }
  function statusDadosVr(ultimaOkEm, agora) {
    var ag = agora === undefined || agora === null ? new Date() : instante(agora) || new Date();
    var u = instante(ultimaOkEm);
    if (!u) return { texto: "Dados do VR ainda não atualizados", desatualizado: true, aviso: "Dados do VR desatualizados",
      idadeMin: null, idadeUtilMin: null };
    var hh = pad(u.getHours()) + ":" + pad(u.getMinutes()), du = isoDe(u), dh = isoDe(ag);
    var txt = du === dh ? "Dados do VR atualizados às " + hh
      : "Dados do VR atualizados em " + fmtData(du, { curta: du.slice(0, 4) === dh.slice(0, 4) }) + " às " + hh;
    var util = minutosUteis(u, ag), velho = util > 120;
    return { texto: txt, desatualizado: velho, aviso: velho ? "Dados do VR desatualizados" : "",
      idadeMin: Math.max(0, Math.round((ag - u) / 60000)), idadeUtilMin: util };
  }

  var API = {
    REGRAS_PADRAO: REGRAS_PADRAO, MODELOS_PADRAO: MODELOS_PADRAO, DIAS_SEMANA: DIAS_SEMANA, DIAS_CURTOS: DIAS_CURTOS,
    tem: tem, hojeISO: hojeISO, addDias: addDias, diasEntre: diasEntre, diaSemana: diaSemana, fmtData: fmtData, fmtPeriodo: fmtPeriodo,
    pascoa: pascoa, lojaFechada: lojaFechada, ehFeriado: ehFeriado, nomeFeriado: nomeFeriado, ehDiaUtil: ehDiaUtil,
    diaUtilAnterior: diaUtilAnterior, ocorrencias: ocorrencias, ocorrenciasCampanhas: ocorrenciasCampanhas,
    calcularPrazos: calcularPrazos, periodoGrupo: periodoGrupo, prazosEdicao: prazosEdicao,
    edicoesParaCriar: edicoesParaCriar, edicoesFuturas: edicoesFuturas, inicioTema: inicioTema, sugerirHospedeira: sugerirHospedeira,
    contarVagas: contarVagas, situacao: situacao, analiseProposta: analiseProposta, margem: margem,
    mudancaMaterial: mudancaMaterial, coincidencias: coincidencias, sobreposicaoProdutos: sobreposicaoProdutos,
    statusDadosVr: statusDadosVr
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API; else raiz.ENC = API;
})(typeof window !== "undefined" ? window : this);
