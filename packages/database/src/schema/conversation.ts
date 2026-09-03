import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { idColumn, softDeleteColumn, timestampColumns } from './_shared';
import { agentNameEnum, messageRoleEnum } from './enums';
import { clients } from './clients';
import { users } from './identity';

export const conversations = pgTable('conversations', {
  ...idColumn,
  clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  title: text('title'),
  status: text('status').notNull().default('open'),
  ...timestampColumns,
  ...softDeleteColumn,
});

export const messages = pgTable('messages', {
  ...idColumn,
  conversationId: uuid('conversation_id')
    .notNull()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  role: messageRoleEnum('role').notNull(),
  agent: agentNameEnum('agent'),
  content: text('content').notNull(),
  // Anexo opcional (áudio, imagem, pdf, doc, pptx). O Node recebe a URL como
  // referência no texto (packages/node-protocol); se o modelo por trás do
  // OpenClaw entende o conteúdo de verdade (visão/áudio) não foi validado,
  // ver Fase 04.
  attachmentUrl: text('attachment_url'),
  attachmentType: text('attachment_type'),
  attachmentFilename: text('attachment_filename'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Recortes de contexto montados pelo Context Engine (seção 6.4) para uma
 * conversa, nunca o conteúdo bruto de um vault inteiro.
 */
export const conversationContext = pgTable('conversation_context', {
  ...idColumn,
  conversationId: uuid('conversation_id')
    .notNull()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  contextType: text('context_type').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
