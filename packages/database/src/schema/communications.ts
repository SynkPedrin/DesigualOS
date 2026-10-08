import { index, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { idColumn, timestampColumns } from './_shared';
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
    contactId: uuid('contact_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),
    channel: communicationChannelEnum('channel').notNull(),
    status: conversationStatusEnum('status').notNull().default('open'),
    /** `null` = não atribuída — é o que a aba "Não atribuídas" do Inbox lê. */
    assignedToUserId: uuid('assigned_to_user_id').references(() => users.id, { onDelete: 'set null' }),
    /**
     * Tocado explicitamente a cada mensagem nova (thread é PAI de
     * threadMessages — `$onUpdate` do `updatedAt` só cobre UPDATE na
     * própria linha, não quando uma tabela FILHA muda. Mesmo padrão já
     * documentado em `_shared.ts`/`touchConversation`).
     */
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    ...timestampColumns,
  },
  (table) => ({
    organizationIdx: index('conversation_threads_organization_id_idx').on(table.organizationId),
    clientIdx: index('conversation_threads_client_id_idx').on(table.clientId),
    contactIdx: index('conversation_threads_contact_id_idx').on(table.contactId),
    assignedIdx: index('conversation_threads_assigned_to_user_id_idx').on(table.assignedToUserId),
  }),
);

export const threadMessages = pgTable(
  'thread_messages',
  {
    ...idColumn,
    threadId: uuid('thread_id').notNull().references(() => conversationThreads.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    channel: communicationChannelEnum('channel').notNull(),
    direction: messageDirectionEnum('direction').notNull(),
    senderContactId: uuid('sender_contact_id').references(() => contacts.id, { onDelete: 'set null' }),
    senderUserId: uuid('sender_user_id').references(() => users.id, { onDelete: 'set null' }),
    content: text('content'),
    attachmentUrl: text('attachment_url'),
    attachmentType: text('attachment_type'),
    /** Id da mensagem na origem — chave de idempotência (§94 do prompt
     *  master): webhook reentrega, a mesma mensagem não pode duplicar. */
    externalMessageId: text('external_message_id'),
    deliveryStatus: messageDeliveryStatusEnum('delivery_status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    threadIdx: index('thread_messages_thread_id_idx').on(table.threadId),
    organizationIdx: index('thread_messages_organization_id_idx').on(table.organizationId),
    /** Postgres trata múltiplos NULL como distintos em UNIQUE — mensagem
     *  sem id externo (nota interna, falha de envio antes de confirmar)
     *  nunca colide por engano com outra sem id. */
    externalDedupe: unique('thread_messages_channel_external_id_unique').on(table.channel, table.externalMessageId),
  }),
);
