/* ==AV-CONSULTAS== AVARIAS · o que a tela lê. SÓ LEITURA: cada item é uma visão (ou cópia) com as colunas nomeadas
   e a ordem fixa da paginação. Não existe nenhuma consulta de gravação, nenhuma chamada de função do servidor.
   "sob_demanda": lida só no clique (ficha do produto, detalhe da nota), sempre com filtro pela chave.
   "so_analise": a leitura do fornecedor relacionado — NUNCA pedida pelas Pendências nem pela ficha aberta delas. */
(function (raiz) {
  var C = {
    sync:        { visao: "avaria_sync", colunas: "fonte,ultima_ok,ultima_tentativa,ultimo_erro,linhas", ordem: "fonte" },
    motivos:     { visao: "avaria_motivos_vr", colunas: "motivo,nome", ordem: "motivo" },
    produtos:    { visao: "avaria_produtos_vr", colunas: "id_produto,nome,setor_id,setor", ordem: "id_produto" },
    entradas:    { visao: "avaria_tela_entradas_mes_v", colunas: "mes,setor_id,classe,motivo,ocorrencias,valor_data,valor_estimado,sem_custo,ocorrencias_mesmos_dias,valor_data_mesmos_dias,valor_estimado_mesmos_dias,sem_custo_mesmos_dias", ordem: "mes,setor_id,classe,motivo" },
    livro:       { visao: "avaria_tela_livro_mes_v", colunas: "mes,setor_id,entrou_data,entrou_estimado,entrou_sem_custo,saiu_data,saiu_estimado,saiu_sem_custo,c1,c1_estimado,c1_casos,c2,c2_estimado,c2_casos,c3,c3_estimado,c3_casos,c4,c4_estimado,c4_casos", ordem: "mes,setor_id" },
    saidas:      { visao: "avaria_tela_saidas_mes_v", colunas: "mes,setor_id,grupo,nivel,forma,sem_nota,saidas,valor_data,valor_estimado,com_parte_sem_custo,em_conferencia", ordem: "mes,setor_id,grupo,nivel,forma,sem_nota" },
    assumido:    { visao: "avaria_tela_assumido_v", colunas: "chave,nota_id,origem_vr,origem_painel,selo,data_saida,mes,valor_custo_entrada,valor_so_o_que_falta,registrado_em,quem,motivos,tem_acerto_vinculado,nota_numero,nota_texto,setor_id,setores", ordem: "chave" },
    parado:      { visao: "avaria_tela_parado_v", colunas: "id_produto,setor_id,faixa,qtd,valor_data,valor_estimado,qtd_sem_custo", ordem: "id_produto,faixa" },
    tempo:       { visao: "avaria_tela_tempo_saida_v", colunas: "mes,setor_id,grupo,fornecedor_comprovado,dias,partes,valor,valor_estimado,partes_sem_custo", ordem: "mes,setor_id,grupo,fornecedor_comprovado,dias" },
    perda:       { visao: "avaria_tela_perda_direta_mes_v", colunas: "mes,setor_id,marca,ocorrencias,valor,sem_custo", ordem: "mes,setor_id,marca" },
    venda:       { visao: "avaria_venda_setor_vr", colunas: "mes,setor_id,venda_custo,venda_valor,preco_sem_custo,itens_sem_custo,inclui_dia_corrente", ordem: "mes,setor_id" },
    filaA:       { visao: "avaria_tela_fila_a_v", colunas: "id_produto,nome,setor,setor_id,saldo,ciclo,ciclo_n,ciclo_desde,qtd_partes,valor_data,valor_estimado,qtd_sem_custo,valor,entrada_mais_antiga,faixa_mais_antiga,acertos_no_ciclo,referencia,combinado,vinculado,acertos_sem_vinculo,quantidade_sem_acerto_informado,primeiro_acerto_em,saiu_no_vr_desde_o_acerto,faixa_desde_o_acerto,motivo_parte_mais_antiga,classe_parte_mais_antiga,partes", ordem: "id_produto" },
    filaB:       { visao: "avaria_tela_fila_b_v", colunas: "titulo_id,nota_id,nota,fornecedor,fornecedor_nome,valor,emissao,vencimento,dias_vencido,faixa_vencimento,situacao,quantidade_acerto_vinculado,aviso_outra_fonte,provas,provas_motivo,origens_evidencia,outra_evidencia,forma_texto,assumido_texto", ordem: "titulo_id" },
    filaC:       { visao: "avaria_tela_fila_c_v", colunas: "nota_id,numero,data,valor,tipo_id,tipo,destino,texto,forma_texto,assumido_texto,duvida_texto,fornecedor_comprovado,fornecedor_nome,nivel,provas,conflitos,em_conferencia,rotulo,aviso,valor_comprovado,valor_assumido,valor_declarado,valor_nao_identificado,valor_declarado_painel,valor_assumido_painel,parcialmente_declarada,valor_sem_comprovacao,faixa,produtos", ordem: "nota_id" },
    acertos:     { visao: "avaria_tela_acertos_v", colunas: "acerto_id,fila,id_produto,ciclo_vigente,nota_id,criado_em,autor_nome,saldo_vr_ref,anulado,n_correcoes,quantidade,valor,forma,fornecedor,fornecedor_nome,conferido,conferido_em,vinculado,sem_vinculo,encerrado_sem_vinculo,ciclo_aberto,ciclo_desfeito,estado", ordem: "acerto_id" },
    vinculos:    { visao: "avaria_vinculos_possiveis_v", colunas: "acerto_id,saida_linha,id_produto,data,nota_id,qtd_liquida,saida_sem_vinculo,acerto_sem_vinculo,tipo_id,fornecedor_nota,fornecedor_acerto,condicoes_que_falham,pista_texto_cita_mesma_forma,saidas_aptas_do_acerto", ordem: "acerto_id,saida_linha" },
    vinculosFeitos: { visao: "avaria_vinculos_v", colunas: "vinculo_id,acerto_id,saida_linha,id_produto,quantidade,automatico,criado_em,autor_nome,nota_id,desfeito,a_reconferir,aviso_quantidade_mudou,conflito_texto_vr", ordem: "vinculo_id" },
    negativo:    { visao: "avaria_tela_saldo_negativo_v", colunas: "id_produto,nome,setor_id,saldo,ultimo_movimento", ordem: "id_produto" },
    naoIdent:    { visao: "avaria_tela_nao_identificado_v", colunas: "tipo,chave,id_produto,setor_id,nota_id,nota_numero,data,valor,valor_estimado,detalhe,nivel,em_conferencia", ordem: "tipo,chave" },
    produtosMes: { visao: "avaria_tela_produtos_mes_v", colunas: "id_produto,setor_id,mes,motivo,ocorrencias,dias_motivo,dias_mes,valor_data,valor_estimado,sem_custo,ocorrencias_mesmos_dias,valor_data_mesmos_dias,valor_estimado_mesmos_dias", ordem: "id_produto,mes,motivo" },
    fornecedores:{ visao: "avaria_tela_fornecedores_v", colunas: "medida,fornecedor,mes,detalhe,quantidade,valor", ordem: "medida,fornecedor,mes,detalhe" },
    nomesForn:   { visao: "avaria_fornecedores_vr", colunas: "fornecedor,nome,ultima_compra", ordem: "fornecedor" },
    verbas:      { visao: "avaria_verbas_vr", colunas: "verba_id,fornecedor,tipo_id,tipo,valor,data,situacao", ordem: "verba_id" },
    relacionado: { visao: "avaria_tela_relacionado_v", colunas: "id_produto,setor_id,fornecedor,data_compra,varios_fornecedores,partes,qtd,primeira_entrada,ultima_entrada,valor_data,valor_estimado,qtd_sem_custo", ordem: "id_produto,fornecedor", so_analise: true },
    ajustes:     { visao: "avaria_ajustes_vr", colunas: "componente,id_produto,linha_id,data,qtd,valor,fonte_custo,negativo", ordem: "componente,id_produto,linha_id" },
    // sob demanda (clique): sempre com filtro pela chave
    movimentos:  { visao: "avaria_tela_movimentos_v", colunas: "linha_id,id_produto,datahora,data,tipo,qtd,motivo,papel,classe,custo_data,fonte_custo,nota_numero,ciclo,saldo_antes,saldo_depois,obs,usuario_login,saida_linha,destino,grupo,nivel,qtd_liquida,nota_id,saida_valor_data,saida_valor_estimado,saida_qtd_sem_custo,em_conferencia,conflitos", ordem: "linha_id", sob_demanda: "id_produto" },
    // índice leve para a BUSCA POR NÚMERO DE NOTA (piloto 3,6): só leitura; o detalhe continua em "notas" (sob demanda)
    notasIndice: { visao: "avaria_tela_notas_indice_v", colunas: "nota_id,numero,serie,data,tipo,nfe,valor,fornecedor_nome", ordem: "numero,serie,nota_id" },
    notas:       { visao: "avaria_tela_notas_v", colunas: "nota_id,numero,serie,data,tipo_id,tipo,nfe,valor,texto,forma_texto,assumido_texto,duvida_texto,destino,fornecedor_comprovado,fornecedor_nome,nivel,titulo,provas,conflito_provas,rotulo,aviso,selo_assumido,encerrada_sem_comprovacao,valor_comprovado,valor_em_aberto_vr,valor_assumido,valor_declarado,valor_nao_identificado,parcialmente_declarada,conflitos,em_conferencia,boleto,documento,documento_motivo,corrigida,destinatario_vr,destinatario_vr_nome", ordem: "nota_id", sob_demanda: "nota_id" },
    notaItens:   { visao: "avaria_tela_nota_itens_v", colunas: "nota_id,id_produto,nome,setor_id,qtd,valor_total", ordem: "nota_id,id_produto", sob_demanda: "nota_id" },
    provas:      { visao: "avaria_provas_vr", colunas: "fonte,ref,nota_id,fornecedor,data,valor_citado,valor_nota,caso_boleto,parcela_situacao,parcela_vencimento,abatimento,nao_serve,motivo,texto", ordem: "nota_id,fonte,ref", sob_demanda: "nota_id" },
    titulos:     { visao: "avaria_titulos_vr", colunas: "titulo_id,nota_id,fornecedor,numero,emissao,vencimento,valor,abatimento,situacao", ordem: "nota_id,titulo_id", sob_demanda: "nota_id" },
    documentos:  { visao: "avaria_documentos_vr", colunas: "ref,tipo,numero,data,fornecedor,valor_total", ordem: "ref" },
    perdas:      { visao: "avaria_perdas_vr", colunas: "perda_id,id_produto,data,qtd,custo,obs,marca", ordem: "perda_id" },
    eventosNota: { visao: "avaria_tela_eventos_nota_v", colunas: "evento_id,nota_id,tipo,fila,criado_em,autor_nome,automatico,valor,quantidade,motivo,documento,forma,fornecedor,data_informada,observacao", ordem: "nota_id,evento_id", sob_demanda: "nota_id" },
    partes:      { visao: "avaria_saidas_partes_vr", colunas: "linha_saida,ordem,id_produto,linha_entrada,data_entrada,qtd,custo,fonte_custo", ordem: "linha_saida,ordem", sob_demanda: "id_produto" },
    comprasRecentes: { visao: "avaria_compras_recentes_vr", colunas: "id_produto,fornecedor,primeira_compra,ultima_compra,notas", ordem: "id_produto,fornecedor", sob_demanda: "id_produto", so_analise: true }
  };
  if (typeof module !== "undefined" && module.exports) module.exports = C; else raiz.AV_CONSULTAS = C;
})(this);
