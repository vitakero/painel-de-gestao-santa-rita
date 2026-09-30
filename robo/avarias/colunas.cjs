// ==AVR-COLUNAS== AVARIAS · as tabelas da nuvem que o robô do piloto grava: colunas, chaves, tipos e jeito de carregar.
//
// FONTE ÚNICA do robô. Tem de bater, coluna por coluna, com o SQL aprovado (codigo/banco/avarias_v1_tabelas.sql e
// avarias_v1_tela.sql) — o teste .previa/avarias/codigo/testes/piloto-robo.test.cjs lê o SQL e cobra. Motivo (memória do
// dono): coluna que o robô manda e a tabela não tem derruba o lote, e coluna que a tabela tem e o robô NÃO manda fica
// vazia sem ninguém ver. As listas de colunas são as MESMAS da bancada aprovada (bancada.COLUNAS) e das cópias de apoio
// (apoio-copias.COLUNAS_APOIO); o teste confere as duas também.
//
// JEITO DE CARREGAR (o mesmo da recarga aprovada da bancada, bancada.recarregar):
//   historico  grava só o que mudou; o que sumiu do VR fica com sumiu_em (NUNCA apaga); se voltar, sumiu_em volta a nulo
//   acumula    grava só o que mudou; o que sumiu do VR continua lá (a recarga aprovada não marca nem apaga estas)
//   saldo      grava só o que mudou; produto que sumiu fica com saldo 0 (a recarga aprovada faz assim)
//   retrato    trocado inteiro: grava o que mudou e APAGA o que sumiu (partes paradas, partes das saídas, relacionado e
//              as 7 cópias de apoio; nenhuma delas é histórico)
// TIPOS: os do SQL. O robô guarda uma impressão (hash) por linha; quando precisa ler de novo a nuvem (estado local sumiu),
// ele recalcula a impressão do que a nuvem devolveu, e para isso precisa saber o tipo (numeric(13,4) volta arredondado).
"use strict";

const T = {
  // ---------------------------------------------------------------- cópias do VR (avarias_v1_tabelas.sql)
  avaria_trocas_vr: { carga: "historico", chave: ["linha_id"], tipos: { linha_id: "integer", id_produto: "integer", datahora: "timestamp", data: "date", tipo: "smallint", qtd: "numeric(18,3)", motivo: "integer", obs: "text", usuario: "integer", custo_linha: "numeric(13,4)", saldo_antes: "numeric(18,3)", saldo_depois: "numeric(18,3)", papel: "text", classe: "text", custo_data: "numeric(13,4)", fonte_custo: "text", nota_numero: "integer", ciclo: "integer" } },
  avaria_saldo_vr: { carga: "saldo", chave: ["id_produto"], tipos: { id_produto: "integer", saldo: "numeric(12,3)", custo_hoje: "numeric(13,4)" } },
  avaria_produtos_vr: { carga: "acumula", chave: ["id_produto"], tipos: { id_produto: "integer", nome: "text", setor_id: "integer", setor: "text", grupo_id: "integer" } },
  avaria_parcelas_vr: { carga: "retrato", chave: ["id_produto", "ordem"], tipos: { id_produto: "integer", ordem: "integer", linha_entrada: "integer", data_entrada: "date", qtd: "numeric(18,3)", custo: "numeric(13,4)", fonte_custo: "text", classe: "text", motivo: "integer", ciclo: "integer" } },
  avaria_ciclos_vr: { carga: "historico", chave: ["id_produto", "inicio_linha"], tipos: { id_produto: "integer", inicio_linha: "integer", n: "integer", inicio_datahora: "timestamp", inicio_data: "date", fim_linha: "integer", fim_datahora: "timestamp", fim_data: "date" } },
  avaria_ajustes_vr: { carga: "acumula", chave: ["componente", "id_produto", "linha_id"], tipos: { componente: "smallint", id_produto: "integer", linha_id: "integer", data: "date", qtd: "numeric(18,3)", valor: "numeric", fonte_custo: "text", negativo: "boolean" } },
  avaria_notas_vr: { carga: "historico", chave: ["nota_id"], tipos: { nota_id: "integer", numero: "integer", serie: "text", data: "date", tipo_id: "integer", tipo: "text", nfe: "integer", fornecedor: "integer", valor: "numeric(11,2)", texto: "text", forma_texto: "text", assumido_texto: "boolean", duvida_texto: "boolean", destino: "text" } },
  avaria_notas_itens_vr: { carga: "acumula", chave: ["nota_id", "id_produto"], tipos: { nota_id: "integer", id_produto: "integer", qtd: "numeric(12,3)", embalagem: "integer", valor_total: "numeric(11,2)" } },
  avaria_saidas_vr: { carga: "historico", chave: ["linha_id"], tipos: { linha_id: "integer", id_produto: "integer", datahora: "timestamp", data: "date", qtd_liquida: "numeric(18,3)", qtd_bruta: "numeric(18,3)", qtd_estorno: "numeric(18,3)", nota_numero: "integer", nota_id: "integer", destino: "text", grupo: "text", forma: "text", nivel_vr: "text", motivo_vr: "text", assumido_vr: "boolean", valor_data: "numeric", valor_linha: "numeric", valor_estimado: "numeric", qtd_sem_custo: "numeric(18,3)", qtd_sem_saldo: "numeric(18,3)", ciclo: "integer" } },
  avaria_saidas_partes_vr: { carga: "retrato", chave: ["linha_saida", "ordem"], tipos: { linha_saida: "integer", ordem: "integer", id_produto: "integer", linha_entrada: "integer", data_entrada: "date", qtd: "numeric(18,3)", custo: "numeric(13,4)", fonte_custo: "text" } },
  avaria_titulos_vr: { carga: "historico", chave: ["titulo_id"], tipos: { titulo_id: "integer", nota_id: "integer", fornecedor: "integer", numero: "text", emissao: "date", vencimento: "date", valor: "numeric(11,2)", abatimento: "numeric(11,2)", situacao: "integer", boleto: "text" } },
  avaria_provas_vr: { carga: "historico", chave: ["fonte", "ref", "nota_id"], tipos: { fonte: "text", ref: "text", nota_id: "integer", fornecedor: "integer", data: "date", valor_citado: "numeric(11,2)", valor_nota: "numeric(11,2)", caso_boleto: "text", parcela_situacao: "integer", parcela_vencimento: "date", abatimento: "numeric(11,2)", nao_serve: "text", conflito_interno: "boolean", contexto: "boolean", compra_boleto: "text", compra_motivo: "text", motivo: "text", texto: "text" } },
  avaria_perdas_vr: { carga: "acumula", chave: ["perda_id"], tipos: { perda_id: "integer", id_produto: "integer", data: "date", qtd: "numeric(12,3)", custo: "numeric(13,4)", obs: "text", marca: "text" } },
  avaria_fornecedor_relacionado_vr: { carga: "retrato", chave: ["id_produto", "linha_entrada"], tipos: { id_produto: "integer", linha_entrada: "integer", fornecedor: "integer", data_compra: "date", varios_fornecedores: "boolean" } },
  // ---------------------------------------------------------------- cópias de apoio da tela (avarias_v1_tela.sql)
  avaria_motivos_vr: { carga: "retrato", chave: ["motivo"], tipos: { motivo: "integer", nome: "text" } },
  avaria_venda_setor_vr: { carga: "retrato", chave: ["mes", "setor_id"], tipos: { mes: "text", setor_id: "integer", venda_custo: "numeric", venda_valor: "numeric", preco_sem_custo: "numeric", itens_sem_custo: "integer", inclui_dia_corrente: "boolean" } },
  avaria_fornecedores_vr: { carga: "retrato", chave: ["fornecedor"], tipos: { fornecedor: "integer", nome: "text", ultima_compra: "date" } },
  avaria_usuarios_vr: { carga: "retrato", chave: ["usuario"], tipos: { usuario: "integer", login: "text" } },
  avaria_verbas_vr: { carga: "retrato", chave: ["verba_id"], tipos: { verba_id: "integer", fornecedor: "integer", tipo_id: "integer", tipo: "text", valor: "numeric(11,2)", data: "date", situacao: "text" } },
  avaria_compras_recentes_vr: { carga: "retrato", chave: ["id_produto", "fornecedor"], tipos: { id_produto: "integer", fornecedor: "integer", primeira_compra: "date", ultima_compra: "date", notas: "integer" } },
  avaria_documentos_vr: { carga: "retrato", chave: ["ref"], tipos: { ref: "text", tipo: "text", numero: "text", data: "date", fornecedor: "integer", valor_total: "numeric(13,2)" } },
};

// a ordem de gravação: primeiro as cópias (na ordem da bancada), depois as de apoio
const TABELAS = Object.keys(T);
const COLUNAS = Object.fromEntries(TABELAS.map((t) => [t, Object.keys(T[t].tipos)]));
const CHAVES = Object.fromEntries(TABELAS.map((t) => [t, T[t].chave]));
const CARGA = Object.fromEntries(TABELAS.map((t) => [t, T[t].carga]));
// colunas que a nuvem preenche sozinha e o robô nunca manda (default now()); sumiu_em o robô manda, só nas de histórico
const COLUNAS_DA_NUVEM = { visto_em: "timestamptz", sumiu_em: "timestamptz" };
// a tabela do relógio (a tela mostra "Dados do VR atualizados às ...")
//   uma linha por tabela acima (a hora boa de cada parte), mais duas linhas próprias do robô:
//   rodada        "avaria_rodada": a RODADA inteira (decisão D1). Toda falha que o robô consegue anotar vai SÓ nela
//                 (ultima_tentativa + ultimo_erro) e a rodada que publica o retrato limpa o erro. As linhas das tabelas não
//                 são tocadas na falha: a ultima_tentativa delas é a "ficha" que confere o estado local (enviar-nuvem.cjs).
//                 Começa com "avaria_" de propósito: a tela só olha as fontes avaria_* (painel.js).
//   conferencia   "conferencia_js": o resumo da conferência do cálculo JS da mesma extração, na coluna jsonb "detalhe"
//                 (decisão D2; a coluna vem de sql/avarias_v1_piloto.sql). A tela ignora (não começa com "avaria_").
const SYNC = { tabela: "avaria_sync", chave: ["fonte"], colunas: ["fonte", "ultima_ok", "ultima_tentativa", "ultimo_erro", "linhas"],
  rodada: "avaria_rodada", conferencia: "conferencia_js" };
// as funções do retrato (avarias_v1_piloto_parte.sql, construtor do banco): só a chave de serviço executa.
// "lista": a tabela com as consultas que a nuvem sabe montar (gerada de tela/consultas.js pelo SQL do piloto; decisão D4)
const RETRATO = { iniciar: "avaria_retrato_iniciar", montar: "avaria_retrato_montar", publicar: "avaria_retrato_publicar",
  lista: "avaria_retrato_consultas", lista_colunas: ["consulta", "visao", "colunas", "ordem", "sob_demanda", "pedaco"] };

module.exports = { T, TABELAS, COLUNAS, CHAVES, CARGA, COLUNAS_DA_NUVEM, SYNC, RETRATO };
