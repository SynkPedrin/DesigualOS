import { sql } from 'drizzle-orm';
import { bigint, index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { idColumn, timestampColumns } from './_shared';
import { users } from './identity';
import { organizations } from './organizations';

/**
 * Comunicação interna (20/10/2026): conversa entre colaboradores da mesma
 * organização. Domínio próprio — NÃO usa as tabelas da Inbox (conversa com
 * cliente), nem `direct_messages` (o recado 1:1 antigo, sem organização).
 *
 * `kind`:
 *  - 'general' — o canal #Geral, um por organização (índice único parcial).
 *    Todo membro ATIVO da organização participa; a linha em
 *    internal_conversation_members nasce sob demanda, só para guardar leitura.
 *  - 'direct'  — conversa privada entre exatamente duas pessoas. `direct_key`
 *    é o par ordenado ("menor:maior"), único por organização: o mesmo par
 *    nunca ganha duas conversas.
 */
export const internalConversations = pgTable(
  'internal_conversations',
  {
    ...idColumn,
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    title: text('title'),
    directKey: text('direct_key'),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    ...timestampColumns,
  },
  (table) => ({
    generalUnique: uniqueIndex('internal_conversations_general_unique').on(table.organizationId).where(sql`kind = 'general'`),
    directUnique: uniqueIndex('internal_conversations_direct_unique').on(table.organizationId, table.directKey).where(sql`kind = 'direct'`),
    orgRecentIdx: index('internal_conversations_org_recent_idx').on(table.organizationId, table.lastMessageAt),
  }),
);

/**
 * Participação e leitura. Na conversa privada, as duas linhas SÃO a regra de
 * acesso. No #Geral, o acesso vem de ser membro ativo da organização e a linha
 * só guarda `last_read_at` (contador de não lidas) e `muted`.
 */
export const internalConversationMembers = pgTable(
  'internal_conversation_members',
  {
    conversationId: uuid('conversation_id').notNull().references(() => internalConversations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    lastReadAt: timestamp('last_read_at', { withTimezone: true }),
    mutedAt: timestamp('muted_at', { withTimezone: true }),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.conversationId, table.userId] }),
    userIdx: index('internal_conversation_members_user_idx').on(table.userId, table.organizationId),
  }),
);

/**
 * Mensagem. `client_message_id` (gerado no navegador) + remetente + conversa é
 * único: o mesmo envio repetido por retry ou reconexão devolve a mensagem que
 * já existe, nunca uma segunda. Exclusão é lógica (`deleted_at`): a mensagem
 * some do conteúdo, o lugar dela na conversa e as respostas a ela continuam.
 */
export const internalMessages = pgTable(
  'internal_messages',
  {
    ...idColumn,
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id').notNull().references(() => internalConversations.id, { onDelete: 'cascade' }),
    senderId: uuid('sender_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    content: text('content'),
    replyToId: uuid('reply_to_id'),
    mentions: uuid('mentions').array().notNull().default(sql`'{}'::uuid[]`),
    clientMessageId: text('client_message_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    idempotency: uniqueIndex('internal_messages_idempotency_unique').on(table.conversationId, table.senderId, table.clientMessageId),
    pageIdx: index('internal_messages_page_idx').on(table.conversationId, table.createdAt, table.id),
    contentSearch: index('internal_messages_content_trgm_idx').using('gin', sql`${table.content} gin_trgm_ops`),
  }),
);

/**
 * Anexo. O arquivo fica no armazenamento privado (disco do servidor, mesma
 * abordagem da mídia do WhatsApp) e só sai pela API, que confere a conversa.
 * Sobe ANTES da mensagem (`message_id` nulo) para o envio do texto não esperar
 * o upload; anexo que nunca virou mensagem é lixo coletável.
 */
export const internalMessageAttachments = pgTable(
  'internal_message_attachments',
  {
    ...idColumn,
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id').notNull().references(() => internalConversations.id, { onDelete: 'cascade' }),
    messageId: uuid('message_id').references(() => internalMessages.id, { onDelete: 'cascade' }),
    uploaderId: uuid('uploader_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    storageKey: text('storage_key').notNull(),
    filename: text('filename').notNull(),
    mimetype: text('mimetype').notNull(),
    kind: text('kind').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    width: integer('width'),
    height: integer('height'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    messageIdx: index('internal_message_attachments_message_idx').on(table.messageId),
    conversationIdx: index('internal_message_attachments_conversation_idx').on(table.conversationId, table.kind, table.createdAt),
  }),
);

export const internalMessageReactions = pgTable(
  'internal_message_reactions',
  {
    messageId: uuid('message_id').notNull().references(() => internalMessages.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    emoji: text('emoji').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.messageId, table.userId, table.emoji] }),
  }),
);
