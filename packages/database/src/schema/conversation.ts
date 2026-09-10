import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { idColumn, softDeleteColumn, timestampColumns } from './_shared';
import { agentNameEnum, messageRoleEnum } from './enums';
import { clients } from './clients';
import { users } from './identity';

/**
 * Projetos do Chat (organização da sidebar, estilo Claude): agrupam conversas
 * soltas por frente de trabalho. NÃO confundir com studio_projects (schema
 * studio.ts), que é do domínio do Studio/ComfyUI.
 */
export const projects = pgTable('projects', {
  ...idColumn,
  name: text('name').notNull(),
  clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  ...timestampColumns,
});

/**
 * Arquivos de referência anexados a um projeto do Chat (identidade visual,
 * briefing, referências). O binário mora no bucket user-uploads do Supabase
 * Storage; aqui fica a URL pública e, para .md/.txt, o texto extraído que o
 * chat injeta no contexto.
 */
export const projectFiles = pgTable('project_files', {
  ...idColumn,
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
  kind: text('kind').notNull(),
  filename: text('filename').notNull(),
  storageUrl: text('storage_url').notNull(),
  contentType: text('content_type').notNull(),
  textContent: text('text_content'),
  uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const conversations = pgTable(
  'conversations',
  {
    ...idColumn,
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title'),
    status: text('status').notNull().default('open'),
    // private: só o dono (e master) lê. public: toda a equipe lê. O default do
    // banco vale pra tudo que nasce por código (POST /chat, automações); a
    // migration 0014 marca as linhas PRÉ-existentes como public pra preservar o
    // comportamento "chat compartilhado" que vigorava até 2026-09-04.
    visibility: text('visibility').notNull().default('private'),
    ...timestampColumns,
    ...softDeleteColumn,
  },
  (table) => ({
    userIdx: index('conversations_user_id_idx').on(table.userId),
    clientIdx: index('conversations_client_id_idx').on(table.clientId),
    projectIdx: index('conversations_project_id_idx').on(table.projectId),
  }),
);

export const messages = pgTable(
  'messages',
  {
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
  },
  (table) => ({
    conversationIdx: index('messages_conversation_id_idx').on(table.conversationId),
  }),
);

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
