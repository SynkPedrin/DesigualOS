import { index, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { idColumn } from './_shared';
import { users } from './identity';

/**
 * Mensagem direta entre duas pessoas (pedido do usuário, não estava no
 * prompt mestre original). Um "thread" entre A e B é simplesmente todo
 * registro onde (sender=A, recipient=B) ou (sender=B, recipient=A); sem
 * conceito de grupo por enquanto, só 1:1.
 */
export const directMessages = pgTable(
  'direct_messages',
  {
    ...idColumn,
    senderId: uuid('sender_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    recipientId: uuid('recipient_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    content: text('content'),
    attachmentUrl: text('attachment_url'),
    attachmentType: text('attachment_type'),
    attachmentFilename: text('attachment_filename'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    senderIdx: index('direct_messages_sender_id_idx').on(table.senderId),
    recipientIdx: index('direct_messages_recipient_id_idx').on(table.recipientId),
  }),
);

/**
 * Preferências por thread de mensagem direta (favoritar / arquivar), por
 * usuário: o que eu arquivei não some da lista do outro. Chave composta
 * (user_id, partner_id) porque cada par só tem um estado; favorited_at e
 * archived_at nulos significam "não favoritado" / "não arquivado".
 */
export const directMessageThreadPrefs = pgTable(
  'direct_message_thread_prefs',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    partnerId: uuid('partner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    favoritedAt: timestamp('favorited_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    // `$onUpdate` pelo mesmo motivo de `timestampColumns` (ver _shared.ts):
    // `defaultNow()` sozinho só vale no INSERT, e esta tabela é atualizada
    // sempre pelo mesmo caminho (favoritar/arquivar conversa).
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.partnerId] }),
    userIdx: index('direct_message_thread_prefs_user_idx').on(table.userId),
  }),
);
