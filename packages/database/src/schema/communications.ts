import { index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { idColumn, timestampColumns } from './_shared';
import { whatsappGroups, whatsappSessions } from './whatsapp';
import { organizations } from './organizations';
import { clients } from './clients';
import { users } from './identity';
import { communicationChannelEnum, conversationStatusEnum, messageDeliveryStatusEnum, messageDirectionEnum } from './enums';

/**
 * communications.ts — COMUNICAÇÃO EXTERNA (P1-A, 06/10/2026): contato,
 * thread e mensagem de fora da agência (cliente final, via WhatsApp por
 * ora).
 *
 * DELIBERADAMENTE SEPARADO de `conversations`/`messages` (conversation.ts) —
 * aquele é o chat INTERNO com Bento: `userId` obrigatório, sem telefone, sem
 * canal externo, `agent`/`role` como enum de agente. Reaproveitar aquele
 * modelo para um CONTATO externo exigiria `userId NOT NULL` apontando pra
 * alguém que não é um usuário da plataforma — contaminaria um modelo que já
 * funciona. Ver a análise completa em
 * docs/architecture/desigual-2.0-gap-analysis-agency-os.md §1.1 e o plano de
 * execução §P1.1.
 *
 * Toda tabela de alto volume carrega `organization_id` DIRETO (não só via
 * join), decisão deliberada já registrada no plano de execução §13: mensagem
 * pode existir em volume alto e precisa de índice direto pro recorte de
 * tenant não degradar.
 */

export const contacts = pgTable(
  'contacts',
  {
    ...idColumn,
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    /** Pode existir antes de vincular a um cliente (contato chegou, ninguém
     *  ainda associou a conta certa). */
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    phone: text('phone'),
    email: text('email'),
    /** Id da pessoa em cada canal externo, ex.: `{"whatsapp": "5511...@s.whatsapp.net"}`. */
    externalIds: jsonb('external_ids').$type<Record<string, string>>().notNull().default({}),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    ...timestampColumns,
  },
  (table) => ({
    organizationIdx: index('contacts_organization_id_idx').on(table.organizationId),
    clientIdx: index('contacts_client_id_idx').on(table.clientId),
  }),
);

export const conversationThreads = pgTable(
  'conversation_threads',
  {
    ...idColumn,
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
    contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'cascade' }),
    whatsappSessionId: uuid('whatsapp_session_id').references(() => whatsappSessions.id, { onDelete: 'set null' }),
    groupId: uuid('group_id').references(() => whatsappGroups.id, { onDelete: 'set null' }),
    externalChatId: text('external_chat_id'),
    kind: text('kind').notNull().default('individual'),
    title: text('title'),
    unreadCount: integer('unread_count').notNull().default(0),
    lastMessagePreview: text('last_message_preview'),
    channel: communicationChannelEnum('channel').notNull(),
    status: conversationStatusEnum('status').notNull().default('open'),
    /** `null` = não atribuída — é o que a aba "Não atribuídas" do Inbox lê. */
    assignedToUserId: uuid('assigned_to_user_id').references(() => users.id, { onDelete: 'set null' }),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    ...timestampColumns,
  },
  (table) => ({
    organizationIdx: index('conversation_threads_organization_id_idx').on(table.organizationId),
    clientIdx: index('conversation_threads_client_id_idx').on(table.clientId),
    contactIdx: index('conversation_threads_contact_id_idx').on(table.contactId),
    assignedIdx: index('conversation_threads_assigned_to_user_id_idx').on(table.assignedToUserId),
    sessionChatIdx: index('conversation_threads_session_chat_idx').on(table.whatsappSessionId, table.externalChatId),
  }),
);

export const threadMessages = pgTable(
  'thread_messages',
  {
    ...idColumn,
    threadId: uuid('thread_id').notNull().references(() => conversationThreads.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    whatsappSessionId: uuid('whatsapp_session_id').references(() => whatsappSessions.id, { onDelete: 'set null' }),
    providerSessionKey: text('provider_session_key').notNull().default('legacy'),
    channel: communicationChannelEnum('channel').notNull(),
    direction: messageDirectionEnum('direction').notNull(),
    senderContactId: uuid('sender_contact_id').references(() => contacts.id, { onDelete: 'set null' }),
    senderUserId: uuid('sender_user_id').references(() => users.id, { onDelete: 'set null' }),
    senderExternalId: text('sender_external_id'),
    senderName: text('sender_name'),
    content: text('content'),
    attachmentUrl: text('attachment_url'),
    attachmentType: text('attachment_type'),
    attachmentFilename: text('attachment_filename'),
    attachmentSizeBytes: integer('attachment_size_bytes'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    externalMessageId: text('external_message_id'),
    deliveryStatus: messageDeliveryStatusEnum('delivery_status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    threadIdx: index('thread_messages_thread_id_idx').on(table.threadId),
    organizationIdx: index('thread_messages_organization_id_idx').on(table.organizationId),
    externalDedupe: unique('thread_messages_org_channel_session_external_unique').on(
      table.organizationId,
      table.channel,
      table.providerSessionKey,
      table.externalMessageId,
    ),
  }),
);
