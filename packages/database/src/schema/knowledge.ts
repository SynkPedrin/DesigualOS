import { index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { idColumn, timestampColumns } from './_shared';
import { agents } from './agents-infra';
import { clients } from './clients';
import { users } from './identity';

/**
 * Uma fonte de conhecimento de um agente (ex: o Obsidian vault local dele,
 * um workspace do ClickUp). Nunca aponta para uma cópia do conteúdo no
 * servidor central, só metadados (regra de ouro 1).
 */
export const knowledgeSources = pgTable('knowledge_sources', {
  ...idColumn,
  agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
  clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
  type: text('type').notNull(),
  label: text('label').notNull(),
  ...timestampColumns,
});

export const knowledgeDocuments = pgTable('knowledge_documents', {
  ...idColumn,
  sourceId: uuid('source_id')
    .notNull()
    .references(() => knowledgeSources.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  path: text('path'),
  contentHash: text('content_hash'),
  ...timestampColumns,
});

export const knowledgeChunks = pgTable(
  'knowledge_chunks',
  {
    ...idColumn,
    documentId: uuid('document_id')
      .notNull()
      .references(() => knowledgeDocuments.id, { onDelete: 'cascade' }),
    chunkIndex: integer('chunk_index').notNull(),
    content: text('content').notNull(),
    tokenCount: integer('token_count'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    documentIdx: index('knowledge_chunks_document_id_idx').on(table.documentId),
  }),
);

/**
 * Vetor armazenado como jsonb no MVP. Migrar para a extensão pgvector
 * (disponível no Supabase) é candidato a ADR quando a busca semântica
 * entrar em produção.
 */
export const embeddings = pgTable(
  'embeddings',
  {
    ...idColumn,
    chunkId: uuid('chunk_id')
      .notNull()
      .references(() => knowledgeChunks.id, { onDelete: 'cascade' }),
    model: text('model').notNull(),
    vector: jsonb('vector').$type<number[]>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    chunkIdx: index('embeddings_chunk_id_idx').on(table.chunkId),
  }),
);

/**
 * Memória operacional. As colunas de PROVENIÊNCIA e SUPERSESSÃO foram acrescentadas em
 * 10/09/2026: antes existiam só `kind/content/metadata`, o que impedia responder três
 * perguntas básicas — de onde essa informação veio, quanto ela vale, e se ela ainda é
 * verdade. O sintoma prático era memória velha e memória nova conviverem e serem
 * recuperadas em ordem aleatória (ex: "responsável é o João" e "responsável mudou pra
 * Maria" às duas como fato ativo).
 */
export const memories = pgTable(
  'memories',
  {
    ...idColumn,
    agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    kind: text('kind').notNull(),
    content: text('content').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),

    // --- Proveniência: de onde veio ---
    /** Ex: 'clickup_comment', 'chat_message', 'whatsapp', 'vault', 'manual', 'agent'. */
    sourceType: text('source_type'),
    /** Id no sistema de origem (id do comentário, da mensagem, da task). */
    sourceId: text('source_id'),
    /** 0..1 — quanta confiança se tem no fato. Evidência humana > inferência de agente. */
    confidence: numeric('confidence', { precision: 4, scale: 3 }),
    /** 0..1 — quão relevante pra operação. Usado pra ordenar recuperação e pra decidir
     * o que entra no orçamento de contexto. */
    importance: numeric('importance', { precision: 4, scale: 3 }),

    // --- Supersessão: ainda é verdade? ---
    /** 'active' | 'superseded' | 'expired' | 'rejected'. Recuperação só lê 'active'. */
    status: text('status').notNull().default('active'),
    /** Aponta pra memória que substituiu esta. */
    supersededBy: uuid('superseded_by'),
    /** Quando o fato deixou de valer (preenchido junto com status != active). */
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
    /** Última vez que o fato foi reconfirmado por uma fonte. */
    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
    /** Fato temporário: depois disto não deve mais ser recuperado como ativo. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    /** Chave de deduplicação (hash do conteúdo normalizado + escopo). Impede a mesma
     * informação virar 40 linhas por ter sido dita 40 vezes. */
    dedupeKey: text('dedupe_key'),

    /**
     * ISOLAMENTO QA. Memória criada em teste NUNCA pode ser recuperada em
     * produção: uma preferência inventada num QA vira regra de marca real na
     * semana seguinte e ninguém descobre a origem. Default 'production' porque
     * a origem esmagadora é a operação real; o caminho de QA marca explícito e
     * a recuperação filtra.
     */
    environment: text('environment').notNull().default('production'),

    ...timestampColumns,
  },
  (table) => ({
    clientIdx: index('memories_client_id_idx').on(table.clientId),
    statusIdx: index('memories_status_idx').on(table.status),
    dedupeIdx: uniqueIndex('memories_dedupe_key_idx').on(table.dedupeKey),
    sourceIdx: index('memories_source_idx').on(table.sourceType, table.sourceId),
  }),
);

/**
 * Event store operacional: TUDO que acontece na operação e pode virar contexto futuro
 * (task criada/movida, comentário, aprovação, briefing, mensagem de chat, snapshot de
 * métrica). Antes disto o webhook do ClickUp era processado e descartado — nada ficava,
 * então o sistema não tinha como responder "o que mudou desde ontem?".
 *
 * `externalId` + `source` são únicos juntos: é a garantia de IDEMPOTÊNCIA, porque
 * integração externa reentrega evento (o ClickUp reentrega em retry) e o mesmo
 * acontecimento não pode ser contado nem memorizado duas vezes.
 */
export const operationalEvents = pgTable(
  'operational_events',
  {
    ...idColumn,
    /** 'clickup' | 'chat' | 'whatsapp' | 'meta_ads' | 'studio' | 'system'. */
    source: text('source').notNull(),
    /** Tipo normalizado: 'task.created', 'task.status_changed', 'comment.created', ... */
    type: text('type').notNull(),
    /** Id do evento no sistema de origem. Null quando a origem não fornece um. */
    externalId: text('external_id'),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
    /** Entidade afetada (task id, conversation id, campaign id). */
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    /** Ator humano/agente que causou o evento, como texto (não FK: pode ser alguém de
     * fora do Desigual OS, ex: usuário do ClickUp que não é colaborador cadastrado). */
    actor: text('actor'),
    /** Payload normalizado. O corpo cru fica em `raw` pra auditoria/reprocessamento. */
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    raw: jsonb('raw').$type<Record<string, unknown>>(),
    /** Quando o evento aconteceu na origem (≠ quando chegou aqui). */
    occurredAt: timestamp('occurred_at', { withTimezone: true }),
    /** Null = ainda não processado pelo pipeline de memória/proatividade. */
    processedAt: timestamp('processed_at', { withTimezone: true }),
    processingError: text('processing_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    dedupeIdx: uniqueIndex('operational_events_source_external_idx').on(table.source, table.externalId),
    clientIdx: index('operational_events_client_idx').on(table.clientId),
    unprocessedIdx: index('operational_events_processed_idx').on(table.processedAt),
    typeIdx: index('operational_events_type_idx').on(table.type),
  }),
);

/**
 * Sinal proativo: o sistema percebeu algo que merece atenção humana ANTES de alguém
 * perguntar (entrega prioritária amanhã ainda parada, campanha caindo, cliente esperando
 * aprovação). Persistido em vez de notificado direto pra permitir deduplicação e
 * cooldown — proatividade sem isso vira spam, que foi o risco levantado explicitamente.
 */
export const proactiveSignals = pgTable(
  'proactive_signals',
  {
    ...idColumn,
    /** Regra que gerou (ex: 'task.due_tomorrow_not_started'). */
    rule: text('rule').notNull(),
    /** Agente dono do sinal (quem fala com o humano sobre isso). */
    agent: text('agent').notNull(),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    /** 'low' | 'medium' | 'high' | 'critical'. */
    severity: text('severity').notNull().default('medium'),
    /** 0..1 — quanta certeza de que isto é de fato um problema. */
    confidence: numeric('confidence', { precision: 4, scale: 3 }),
    title: text('title').notNull(),
    body: text('body').notNull(),
    /** Ação sugerida, se houver ('criar task', 'redistribuir verba', ...). */
    recommendedAction: text('recommended_action'),
    /** Mesma chave = mesmo sinal; usada com `cooldownUntil` pra não repetir. */
    dedupeKey: text('dedupe_key').notNull(),
    /** Antes disto, o mesmo sinal não é reemitido. */
    cooldownUntil: timestamp('cooldown_until', { withTimezone: true }),
    /** 'pending' | 'delivered' | 'acknowledged' | 'dismissed' | 'resolved'. */
    status: text('status').notNull().default('pending'),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    ...timestampColumns,
  },
  (table) => ({
    dedupeIdx: uniqueIndex('proactive_signals_dedupe_idx').on(table.dedupeKey),
    statusIdx: index('proactive_signals_status_idx').on(table.status),
    clientIdx: index('proactive_signals_client_idx').on(table.clientId),
  }),
);
