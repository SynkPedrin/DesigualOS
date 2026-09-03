import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { idColumn } from './_shared';
import { users } from './identity';

/**
 * Mensagem direta entre duas pessoas (pedido do usuário, não estava no
 * prompt mestre original). Um "thread" entre A e B é simplesmente todo
 * registro onde (sender=A, recipient=B) ou (sender=B, recipient=A); sem
 * conceito de grupo por enquanto, só 1:1.
 */
export const directMessages = pgTable('direct_messages', {
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
});
