import { sql } from 'drizzle-orm';
import { bigint, boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
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
 *  - 'channel' (Hub 2.0, 21/10/2026) — canal criado pela equipe. `visibility`
 *    'public' (qualquer membro ativo da organização lê e entra) ou 'private'
 *    (só quem está em internal_conversation_members). Nome único por
 *    organização entre os canais não arquivados. `archived_at` = só leitura.
 *  - 'group'   — conversa privada com várias pessoas (não é canal: não aparece
 *    em "procurar canais" e o acesso é SÓ por participação).
 *  - 'discussion' — a conversa de um objeto da operação (`entity_type` +
 *    `entity_id`, ex.: client/<id>). Uma por objeto. Acesso: quem pode ver o
 *    objeto (regra do domínio dele, conferida no servidor).
 */
export const internalConversations = pgTable(
  'internal_conversations',
  {
    ...idColumn,
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    title: text('title'),
    directKey: text('direct_key'),
    description: text('description'),
    visibility: text('visibility'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    ...timestampColumns,
  },
  (table) => ({
    generalUnique: uniqueIndex('internal_conversations_general_unique').on(table.organizationId).where(sql`kind = 'general'`),
    directUnique: uniqueIndex('internal_conversations_direct_unique').on(table.organizationId, table.directKey).where(sql`kind = 'direct'`),
    channelNameUnique: uniqueIndex('internal_conversations_channel_name_unique').on(table.organizationId, sql`lower(${table.title})`).where(sql`kind = 'channel' and archived_at is null`),
    discussionUnique: uniqueIndex('internal_conversations_discussion_unique').on(table.organizationId, table.entityType, table.entityId).where(sql`kind = 'discussion'`),
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
    /** 'owner' | 'member'. Dono de canal/grupo edita, remove membros e arquiva. */
    role: text('role').notNull().default('member'),
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
    /** Resposta em thread: não aparece na linha principal, só no painel da thread. */
    threadRootId: uuid('thread_root_id'),
    replyCount: integer('reply_count').notNull().default(0),
    lastReplyAt: timestamp('last_reply_at', { withTimezone: true }),
    /** 'user' | 'system' (ex.: "criou o canal", "criou a tarefa X"). */
    kind: text('kind').notNull().default('user'),
    pinnedAt: timestamp('pinned_at', { withTimezone: true }),
    pinnedBy: uuid('pinned_by'),
    mentions: uuid('mentions').array().notNull().default(sql`'{}'::uuid[]`),
    clientMessageId: text('client_message_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    idempotency: uniqueIndex('internal_messages_idempotency_unique').on(table.conversationId, table.senderId, table.clientMessageId),
    pageIdx: index('internal_messages_page_idx').on(table.conversationId, table.createdAt, table.id),
    threadIdx: index('internal_messages_thread_idx').on(table.threadRootId, table.createdAt, table.id),
    mentionsIdx: index('internal_messages_mentions_idx').using('gin', table.mentions),
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

/** "Salvar para depois": por pessoa. Ver depende de ainda poder ler a conversa. */
export const internalSavedMessages = pgTable(
  'internal_saved_messages',
  {
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    messageId: uuid('message_id').notNull().references(() => internalMessages.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.messageId] }),
    userIdx: index('internal_saved_messages_user_idx').on(table.userId, table.organizationId, table.createdAt),
  }),
);

/**
 * OBJETO COMPARTILHADO numa mensagem: referência tipada a algo da operação
 * (tarefa do ClickUp, campanha, relatório...). O objeto continua no domínio
 * dele; aqui fica só o ponteiro e um RESUMO do momento do envio (`snapshot`).
 * Compartilhar não dá acesso: abrir os detalhes confere a permissão de quem lê.
 */
export const internalMessageObjects = pgTable(
  'internal_message_objects',
  {
    ...idColumn,
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    messageId: uuid('message_id').notNull().references(() => internalMessages.id, { onDelete: 'cascade' }),
    objectType: text('object_type').notNull(),
    objectId: text('object_id').notNull(),
    provider: text('provider'),
    /** Contexto que não cabe no id (ex.: período das métricas, cliente). */
    context: jsonb('context').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    snapshotVersion: integer('snapshot_version').notNull().default(1),
    createdBy: uuid('created_by').notNull().references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    messageIdx: index('internal_message_objects_message_idx').on(table.messageId),
    objectIdx: index('internal_message_objects_object_idx').on(table.organizationId, table.objectType, table.objectId),
  }),
);

/** Preferências de notificação da Comunicação, por pessoa e organização. */
export const internalChatPreferences = pgTable(
  'internal_chat_preferences',
  {
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    /** Não perturbe: nenhuma notificação da Comunicação até este instante. */
    dndUntil: timestamp('dnd_until', { withTimezone: true }),
    notifyReactions: boolean('notify_reactions').notNull().default(true),
    notifyChannelMessages: boolean('notify_channel_messages').notNull().default(false),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.organizationId] }),
  }),
);

/**
 * Tarefa criada a partir de mensagem. `idempotency_key` é único: o mesmo
 * clique repetido (rede caiu, duplo clique) não cria duas tarefas no ClickUp.
 * `status` só vira 'created' depois que o ClickUp confirmou.
 */
export const internalTaskCreations = pgTable(
  'internal_task_creations',
  {
    ...idColumn,
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    messageId: uuid('message_id').notNull().references(() => internalMessages.id, { onDelete: 'cascade' }),
    idempotencyKey: text('idempotency_key').notNull(),
    status: text('status').notNull().default('pending'),
    clickupTaskId: text('clickup_task_id'),
    clickupTaskUrl: text('clickup_task_url'),
    error: text('error'),
    ...timestampColumns,
  },
  (table) => ({
    idempotency: uniqueIndex('internal_task_creations_idempotency_unique').on(table.userId, table.idempotencyKey),
  }),
);
