// ============================================================
// Central Operacional — Tipos TypeScript (Sprint 0)
// Espelha 1:1 o schema de sql/central_op_sprint0.sql.
// Arquivo ISOLADO: não importa nada e NÃO é importado pelo monólito
// (scripts/demoDashboard.ts). Serve de contrato para o módulo novo da Sprint 1.
// Nenhum código de execução — só tipos e constantes.
// ============================================================

// ---- Uniões de domínio (espelham os CHECKs do SQL) ----
export type TopicoTipo = 'canal' | 'recebimento' | 'ocorrencia' | 'manutencao' | 'geral';
export type TopicoStatus = 'aberto' | 'arquivado';
export type MensagemTipo = 'texto' | 'foto' | 'audio' | 'sistema';
export type TranscricaoStatus = 'pendente' | 'processando' | 'concluido' | 'erro';  // Sprint 1.8 (substitui ok/falha)
export type AnexoTipo = 'foto' | 'audio' | 'arquivo';
export type VinculoPapel = 'origem' | 'derivado_de' | 'relacionado';
// Sprint 2.0: o banco foi MIGRADO. Antes: tipo só 'ocorrencia'; status no feminino
// ('aberta'/'resolvida'/'cancelada'), sem 'bloqueado'; prioridade sem 'urgente'.
export type WorkItemTipo = 'ocorrencia' | 'tarefa';
export type WorkItemStatus = 'aberto' | 'em_andamento' | 'bloqueado' | 'concluido' | 'cancelado';
export type Prioridade = 'baixa' | 'normal' | 'alta' | 'urgente';

// entity_type = SEMPRE o nome da tabela física (decisão travada na revisão de consistência)
export type EntityType =
  | 'topico' | 'mensagens' | 'work_items' | 'manutencoes' | 'central_agendamentos';

// Tipos de evento do Feed. Marcados os que a Sprint 0 já emite via trigger.
export type EventoTipo =
  | 'topico.criado'        // Sprint 0 (trigger em topico)
  | 'mensagem.criada'      // Sprint 0 (trigger em mensagens)
  | 'ocorrencia.criada'    // Sprint 0 (trigger em work_items)
  | 'ocorrencia.status'    // Sprint 0 (trigger em work_items)
  | 'recebimento.criado'   // Sprint 1 (robô/trigger em central_agendamentos)
  | 'recebimento.chegou'   // Sprint 1
  | 'recebimento.atualizado' // Sprint 1
  | 'manutencao.criada'    // Sprint 1 (trigger em manutencoes)
  | 'manutencao.concluida' // Sprint 1
  | 'audio.transcrito'     // Sprint 1 (não vai ao Feed)
  | 'mencao.criada'        // Sprint 1 (notificação, não vai ao Feed)
  | 'reacao.alterada';     // Sprint 1.12 (bastidor: só Broadcast, não vai ao Feed)

// ---- Linhas das tabelas ----
export interface Topico {
  id: string;                 // uuid (UUIDv7 do cliente)
  tenant_id: string;
  tipo: TopicoTipo;
  titulo: string;
  setor: string | null;
  status: TopicoStatus;
  origem_tipo: string | null; // 'central_agendamentos' | 'manutencoes' | 'work_items'
  origem_id: string | null;
  criado_por: string | null;
  created_at: string;         // timestamptz (ISO)
  updated_at: string;
}

export interface Evento {
  id: number;                 // bigint (cursor keyset)
  event_uuid: string;
  tenant_id: string;
  tipo: EventoTipo;
  topico_id: string | null;
  entity_type: EntityType | null;
  entity_id: string | null;
  autor_id: string | null;
  setor: string | null;
  resumo: string | null;
  payload: Record<string, unknown>;
  created_at: string;
  // 'busca' (tsvector) existe no banco mas não trafega para o cliente.
}

export interface Mensagem {
  id: string;                 // uuid (UUIDv7 do cliente)
  tenant_id: string;
  topico_id: string;
  autor_id: string | null;    // null = mensagem de sistema
  corpo: string | null;
  tipo_conteudo: MensagemTipo;
  transcricao_status: TranscricaoStatus | null;
  reply_para: string | null;
  editado_em: string | null;
  removido_em: string | null;
  created_at: string;
}

export interface Vinculo {
  id: string;
  tenant_id: string;
  topico_id: string;
  entity_type: EntityType;
  entity_id: string;
  papel: VinculoPapel;
  created_at: string;
}

export interface Anexo {
  id: string;
  tenant_id: string;
  mensagem_id: string;
  tipo: AnexoTipo;
  storage_path: string;
  mime: string | null;
  bytes: number | null;
  largura: number | null;
  altura: number | null;
  duracao_ms: number | null;
  created_at: string;
}

export interface Leitura {
  tenant_id: string;
  topico_id: string;
  usuario_id: string;
  ultima_lida_id: string | null;
  ultima_lida_em: string;
}

export interface MensagemMencao {
  tenant_id: string;
  mensagem_id: string;
  mencionado_id: string;
  created_at: string;
}

export interface MensagemReacao {
  tenant_id: string;
  mensagem_id: string;
  usuario_id: string;
  emoji: string;
  created_at: string;
}

export interface WorkItem {
  id: string;
  tenant_id: string;
  tipo: WorkItemTipo;
  titulo: string;
  descricao: string | null;
  setor: string | null;
  status: WorkItemStatus;
  prioridade: Prioridade;
  topico_id: string | null;
  origem_mensagem_id: string | null;
  criado_por: string | null;
  responsavel_id: string | null;
  resolvido_em: string | null;
  created_at: string;
  updated_at: string;
}

export interface FeatureFlag {
  tenant_id: string;
  chave: FeatureFlagKey;
  habilitado: boolean;
  payload: { perfis_liberados?: string[] } & Record<string, unknown>;
  updated_at: string;
}

// ---- Assinaturas das RPCs (nomes de parâmetro = os do SQL, com o prefixo p_) ----
export interface AnexoInput {
  id?: string;
  tipo: AnexoTipo;
  storage_path: string;
  mime?: string;
  bytes?: number;
  largura?: number;
  altura?: number;
  duracao_ms?: number;
}

export interface PostarMensagemArgs {
  p_mensagem_id: string;   // UUIDv7 gerado no cliente = chave de idempotência da escrita
  p_topico_id: string;
  p_corpo: string | null;
  p_tipo?: MensagemTipo;
  p_anexos?: AnexoInput[];
  p_mencoes?: string[];
  p_reply?: string | null;
}
export interface CriarTopicoCanalArgs { p_id: string; p_titulo: string; p_setor?: string | null; p_tipo?: 'canal' | 'geral'; }
export interface MarcarLidoArgs { p_topico_id: string; p_ate_mensagem_id: string; }
export interface ToggleReacaoArgs { p_mensagem_id: string; p_emoji: string; }
export interface VirarOcorrenciaArgs {
  p_id: string; p_topico_id: string; p_mensagem_id: string | null;
  p_titulo: string; p_descricao?: string | null; p_setor?: string | null; p_prioridade?: Prioridade;
}

// Feed (Sprint 1.1) — leitura paginada por keyset (eventos.id desc).
export interface FeedPaginaArgs { p_cursor?: number | null; p_limite?: number; }
export interface FeedItem {
  id: number;                 // bigint (cursor keyset)
  event_uuid: string;
  tipo: EventoTipo;
  topico_id: string | null;
  entity_type: EntityType | null;
  entity_id: string | null;
  autor_id: string | null;
  setor: string | null;
  resumo: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

// Canais / mensagens (Sprint 1.2) — leitura.
export interface CanalTopico {   // retorno de listar_topicos()
  id: string;
  tipo: TopicoTipo;              // no MVP a lista traz só 'geral' | 'canal'
  titulo: string;
  setor: string | null;
  updated_at: string;
}
export interface MensagensPaginaArgs {
  p_topico_id: string;
  p_antes_ts?: string | null;   // cursor keyset: created_at da última mensagem carregada
  p_antes_id?: string | null;   // cursor keyset: id da última mensagem carregada
  p_limite?: number;
}
// Resumo do anexo trafegado por mensagens_pagina (Sprint 1.5). Só metadados PERMANENTES —
// nunca URL assinada (essa é gerada no cliente na hora de exibir, com validade curta).
export interface AnexoResumo {
  id: string;
  tipo: AnexoTipo;             // no MVP: 'foto'
  storage_path: string;       // {tenant_id}/{topico_id}/{anexo_id}.{ext} no bucket privado 'central-op'
  mime: string | null;
  bytes: number | null;
  largura: number | null;
  altura: number | null;
  duracao_ms: number | null;
}
export interface MensagemLida {  // retorno de mensagens_pagina()
  id: string;
  autor_id: string | null;
  autor_nome: string | null;
  corpo: string | null;
  tipo_conteudo: MensagemTipo;
  reply_para: string | null;
  created_at: string;
  anexos: AnexoResumo[];       // [] quando não há foto (Sprint 1.5)
  transcricao: string | null;             // Sprint 1.8: texto da transcrição (quando concluída)
  transcricao_status: TranscricaoStatus | null;   // null p/ não-áudio
  mencoes: string[];           // Sprint 1.11: uuids dos usuários mencionados (do mensagem_mencoes); [] se nenhum
  reacoes: ReacaoResumo[];     // Sprint 1.12: reações agregadas [{emoji, qtd, eu}]; [] se nenhuma
}
// Usuário retornável pelo autocomplete de @menção (Sprint 1.11) — retorno de mencionaveis()
export interface Mencionavel {
  id: string;
  nome: string;
  setor: string | null;
}
// Participante da Central p/ a lista de presença (Sprint 1.13) — retorno de participantes()
export interface Participante {
  id: string;
  nome: string;
  setor: string | null;
}
// Metadados publicados via Realtime Presence (efêmero; nunca gravado). Sprint 1.13.
export interface PresencaMeta {
  user_id: string;
  nome: string | null;
  status: 'online' | 'idle';
}
// Payload do Broadcast efêmero de digitação (event: 'digitando'). Sprint 1.13.
export interface DigitandoPayload {
  topico: string;
  autor: string;
  nome: string | null;
  ativo: boolean;   // true = digitando; false = parou (some imediato)
}
// Reação agregada por emoji numa mensagem (Sprint 1.12). eu = o usuário atual reagiu com esse emoji.
export interface ReacaoResumo {
  emoji: string;
  qtd: number;
  eu: boolean;
}
// Retorno de reacoes_de(): reações atualizadas de mensagens específicas (tempo real).
export interface ReacoesDeMensagem {
  mensagem_id: string;
  reacoes: ReacaoResumo[];
}
// Estado de transcrição de mensagens específicas (Sprint 1.8) — retorno de transcricoes()
export interface TranscricaoEstado {
  id: string;
  transcricao_status: TranscricaoStatus | null;
  transcricao: string | null;
}

// Conversa de contexto do Recebimento (Sprint 1.3) — leitura.
export interface ListarRecebimentosArgs { p_limite?: number; }
export interface RecebimentoTopico {   // retorno de listar_recebimentos()
  id: string;                          // id do topico (tipo 'recebimento')
  titulo: string;                      // ex.: "Recebimento — Fornecedor (2026-07-15)"
  setor: string | null;
  origem_id: string | null;            // id do central_agendamentos (text)
  updated_at: string;
}

// Mapa nome-da-RPC -> (args, retorno), para tipar chamadas SB.rpc(...)
/* ---------- Sprint 2.0 — WORK ITEMS ----------
   Vocabulário OFICIAL (o banco foi migrado na 2.0: antes era 'aberta'/'resolvida'/'cancelada').
   Colunas físicas reusadas: created_at=criado_em, updated_at=atualizado_em, resolvido_em=concluido_em. */
export type WorkItemPrioridade = Prioridade;
export type WorkItemRelacao = 'relacionado_a' | 'derivado_de' | 'conversa_de';
/** Whitelist de entidades vinculáveis (nome FÍSICO da tabela; validada no servidor, nunca dinâmica).
 *  'fornecedor' ficou de FORA: não existe entidade canônica (é texto livre vindo do VR). */
export type VinculoEntidade =
  'topico' | 'work_items' | 'mensagens' | 'central_agendamentos' | 'estoque_produtos' | 'manutencao_equipamentos';

/** Transições permitidas — validadas NO BANCO (a UI só espelha). */
export const WORK_ITEM_TRANSICOES: Record<WorkItemStatus, WorkItemStatus[]> = {
  aberto:       ['em_andamento', 'cancelado'],
  em_andamento: ['bloqueado', 'concluido', 'cancelado'],
  bloqueado:    ['em_andamento', 'cancelado'],
  concluido:    ['em_andamento'],
  cancelado:    ['aberto'],
};

export interface WorkItemLinha {
  id: string; tipo: WorkItemTipo; titulo: string; resumo: string | null;
  status: WorkItemStatus; prioridade: WorkItemPrioridade;
  responsavel_id: string | null; responsavel_nome: string | null;
  prazo_em: string | null; criado_em: string; atualizado_em: string; concluido_em: string | null;
  topico_id: string | null; vinculos: number; atrasado: boolean;
}
export interface WorkItemVinculo { tipo: VinculoEntidade; id: string; papel: WorkItemRelacao }
export interface WorkItemDetalhe extends Omit<WorkItemLinha, 'resumo' | 'vinculos'> {
  descricao: string | null; setor: string | null;
  criado_por: string | null; criado_por_nome: string | null;
  vinculos: WorkItemVinculo[];
}
export interface EntidadeVinculavel { id: string; titulo: string; subtitulo: string | null }
export interface CriarWorkItemArgs {
  p_request_id: string; p_tipo: WorkItemTipo; p_titulo: string;
  p_descricao?: string | null; p_prioridade?: WorkItemPrioridade;
  p_responsavel_id?: string | null; p_prazo_em?: string | null;
  p_topico_id?: string | null; p_setor?: string | null;
}
export interface AtualizarWorkItemArgs {
  p_request_id: string; p_work_item_id: string;
  p_titulo?: string | null; p_descricao?: string | null; p_prioridade?: WorkItemPrioridade | null;
  p_responsavel_id?: string | null; p_remover_responsavel?: boolean;
  p_prazo_em?: string | null; p_remover_prazo?: boolean;
}
export interface VincularWorkItemArgs {
  p_request_id: string; p_work_item_id: string;
  p_entidade_tipo: VinculoEntidade; p_entidade_id: string; p_relacao?: WorkItemRelacao;
}
export interface WorkItemsPaginaArgs {
  p_status?: WorkItemStatus | null; p_responsavel_id?: string | null;
  p_prioridade?: WorkItemPrioridade | null; p_tipo?: WorkItemTipo | null;
  p_cursor_at?: string | null; p_cursor_id?: string | null; p_limite?: number;
}

export interface CentralRpc {
  criar_topico_canal: { args: CriarTopicoCanalArgs; returns: string };
  postar_mensagem:    { args: PostarMensagemArgs;   returns: string };
  marcar_lido:        { args: MarcarLidoArgs;        returns: void };
  toggle_reacao:      { args: ToggleReacaoArgs;      returns: boolean };
  virar_ocorrencia:   { args: VirarOcorrenciaArgs;   returns: string };
  feed_pagina:        { args: FeedPaginaArgs;        returns: FeedItem[] };
  listar_topicos:      { args: Record<string, never>;   returns: CanalTopico[] };
  listar_recebimentos: { args: ListarRecebimentosArgs;  returns: RecebimentoTopico[] };
  mensagens_pagina:    { args: MensagensPaginaArgs;     returns: MensagemLida[] };
  ocorrencia_do_topico:{ args: { p_topico_id: string }; returns: string | null };  // Sprint 1.6: id da ocorrência do tópico, ou null
  transcricoes:        { args: { p_ids: string[] };     returns: TranscricaoEstado[] };  // Sprint 1.8: estado das transcrições (cliente)
  mensagens_por_ids:   { args: { p_ids: string[] };     returns: MensagemLida[] };        // Sprint 1.9: busca pontual de msgs novas (tempo real)
  nao_lidas:           { args: Record<string, never>;   returns: { topico_id: string; qtd: number }[] };  // Sprint 1.10: contagem autoritativa de não-lidas por tópico
  mencionaveis:        { args: { p_busca?: string | null }; returns: Mencionavel[] };     // Sprint 1.11: usuários visíveis p/ o autocomplete de @menção
  reacoes_de:          { args: { p_ids: string[] };     returns: ReacoesDeMensagem[] };   // Sprint 1.12: reações atualizadas de mensagens específicas (tempo real)
  participantes:       { args: Record<string, never>;   returns: Participante[] };         // Sprint 1.13: roster p/ a lista de presença (status vem do Realtime Presence, não do banco)
  // Sprint 2.0 — Work Items (escrita DEFINER idempotente por p_request_id; leitura INVOKER sob RLS)
  criar_work_item:       { args: CriarWorkItemArgs;      returns: string };
  atualizar_work_item:   { args: AtualizarWorkItemArgs;  returns: string };
  transicionar_work_item:{ args: { p_request_id: string; p_work_item_id: string; p_novo_status: WorkItemStatus }; returns: string };
  vincular_work_item:    { args: VincularWorkItemArgs;   returns: string };
  desvincular_work_item: { args: VincularWorkItemArgs & { p_relacao: WorkItemRelacao }; returns: string };
  work_items_pagina:     { args: WorkItemsPaginaArgs;    returns: WorkItemLinha[] };
  work_items_por_ids:    { args: { p_ids: string[] };    returns: WorkItemLinha[] };
  work_item_detalhe:     { args: { p_work_item_id: string }; returns: WorkItemDetalhe[] };
  entidades_vinculaveis: { args: { p_tipo: VinculoEntidade; p_busca?: string | null }; returns: EntidadeVinculavel[] };
  nomes_de:              { args: { p_ids: string[] };    returns: { id: string; nome: string }[] };
  // worker (service_role; NÃO chamado pelo navegador):
  proxima_transcricao: { args: Record<string, never>;   returns: { mensagem_id: string; storage_path: string | null; mime: string | null }[] };
  marcar_transcricao:  { args: { p_mensagem_id: string; p_status: TranscricaoStatus; p_texto?: string | null }; returns: void };
}
export type CentralRpcName = keyof CentralRpc;

// ---- Constantes de infraestrutura ----
export const CENTRAL_TABELAS = [
  'topico', 'eventos', 'mensagens', 'vinculo', 'anexo',
  'leituras', 'mensagem_mencoes', 'mensagem_reacoes', 'work_items', 'feature_flags',
] as const;
export type CentralTabela = typeof CENTRAL_TABELAS[number];

export const FEATURE_FLAGS = [
  'central_operacional', 'central_feed', 'central_canais', 'central_recebimento',
  'central_foto', 'central_audio', 'central_virar_entidade', 'central_busca',
  'central_transcricao',
] as const;
export type FeatureFlagKey = typeof FEATURE_FLAGS[number];

// Canal de realtime do Feed (broadcast por tenant). Ex.: canalFeed(tenantId)
export const canalFeed = (tenantId: string): string => `tenant:${tenantId}:feed`;

// Página (permissão) do módulo. É 'operacional' (NÃO 'central', que é a Central Logística).
export const CENTRAL_PAGE = 'operacional';

// Bucket de Storage previsto para anexos da Central (criado na Sprint 1)
export const CENTRAL_BUCKET = 'central-op';
