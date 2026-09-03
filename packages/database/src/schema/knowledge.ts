import { integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
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

export const knowledgeChunks = pgTable('knowledge_chunks', {
  ...idColumn,
  documentId: uuid('document_id')
    .notNull()
    .references(() => knowledgeDocuments.id, { onDelete: 'cascade' }),
  chunkIndex: integer('chunk_index').notNull(),
  content: text('content').notNull(),
  tokenCount: integer('token_count'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Vetor armazenado como jsonb no MVP. Migrar para a extensão pgvector
 * (disponível no Supabase) é candidato a ADR quando a busca semântica
 * entrar em produção.
 */
export const embeddings = pgTable('embeddings', {
  ...idColumn,
  chunkId: uuid('chunk_id')
    .notNull()
    .references(() => knowledgeChunks.id, { onDelete: 'cascade' }),
  model: text('model').notNull(),
  vector: jsonb('vector').$type<number[]>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const memories = pgTable('memories', {
  ...idColumn,
  agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
  clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  kind: text('kind').notNull(),
  content: text('content').notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  ...timestampColumns,
});
