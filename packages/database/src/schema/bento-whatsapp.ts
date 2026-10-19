import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { idColumn, timestampColumns } from './_shared';
import { conversations } from './conversation';
import { users } from './identity';
import { organizations } from './organizations';

/**
 * BENTO NO WHATSAPP — o canal, não um segundo Bento.
 *
 * O número corporativo do Bento é uma sessão do OpenWA. O que chega por ele
 * vira turno do MESMO caminho do chat web (`submitChatTurn` em
 * apps/api/src/chat/turn-service.ts), com o MESMO usuário autenticado. Estas
 * tabelas guardam só o que é próprio do canal: quem é quem no WhatsApp, como
 * se provou isso, e a trilha de cada mensagem recebida.
 *
 * Fica FORA de `thread_messages` de propósito: aquela tabela é o Inbox de
 * cliente final, deduplica por (channel, external_id) num enum que só tem
 * 'whatsapp', e mensagem de colaborador falando com o Bento não é conversa de
 * cliente para aparecer no Inbox.
 */

/**
 * Um número de WhatsApp provado como sendo de UM usuário do Desigual OS.
 *
 * A prova é o código de uso único (ver `bentoWhatsappLinkCodes`): gerado na
 * sessão web autenticada, enviado PELO número, confirmado de volta na sessão
 * web. Nome de contato ou foto do perfil nunca contam como identidade.
 *
 * Os dois índices únicos parciais são a regra de negócio inteira:
 *   - um número ativo pertence a uma pessoa só;
 *   - uma pessoa tem um número ativo só (trocar = revogar + vincular).
 * Linha revogada fica como histórico (auditoria), e por isso a unicidade é
 * só sobre `status = 'active'`.
 */
export const bentoWhatsappLinks = pgTable(
  'bento_whatsapp_links',
  {
    ...idColumn,
    organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'set null' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Só dígitos, com DDI: `5518997987295`. É a chave de identidade do canal. */
    phone: text('phone').notNull(),
    /** O chatId que o OpenWA usa para responder (`<digits>@c.us`). */
    chatId: text('chat_id').notNull(),
    /** 'active' | 'revoked'. */
    status: text('status').notNull().default('active'),
    /**
     * A conversa do chat em que os turnos deste vínculo acontecem. É a mesma
     * tabela `conversations` da web: a continuidade ("e a primeira?") usa o
     * estado que o chat já grava (`messages.metadata.escopo/selecao`).
     */
    conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'set null' }),
    lastInboundAt: timestamp('last_inbound_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedByUserId: uuid('revoked_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** 'user' | 'admin' | 'replaced' | 'user_deactivated'. */
    revokedReason: text('revoked_reason'),
    ...timestampColumns,
  },
  (table) => ({
    phoneActiveUnique: uniqueIndex('bento_whatsapp_links_phone_active_idx')
      .on(table.phone)
      .where(sql`status = 'active'`),
    userActiveUnique: uniqueIndex('bento_whatsapp_links_user_active_idx')
      .on(table.userId)
      .where(sql`status = 'active'`),
    userIdx: index('bento_whatsapp_links_user_id_idx').on(table.userId),
  }),
);

/**
 * Código de vínculo: uso único, vida curta, guardado só como hash.
 *
 *   pending   gerado na web, ainda não chegou pelo WhatsApp
 *   claimed   chegou de um número; a web precisa confirmar ESSE número
 *   confirmed virou vínculo
 *   cancelled a pessoa desistiu, gerou outro, ou recusou o número
 *   expired   passou do prazo sem confirmação
 *
 * O texto do código nunca é gravado: um dump do banco não permite vincular
 * nada. `attempts` conta confirmações erradas na web — o código é derrubado
 * ao estourar o limite.
 */
export const bentoWhatsappLinkCodes = pgTable(
  'bento_whatsapp_link_codes',
  {
    ...idColumn,
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'set null' }),
    /** sha256 hex do código normalizado (maiúsculo, sem separador). */
    codeHash: text('code_hash').notNull(),
    status: text('status').notNull().default('pending'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    claimedPhone: text('claimed_phone'),
    claimedChatId: text('claimed_chat_id'),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
    ...timestampColumns,
  },
  (table) => ({
    codeHashIdx: uniqueIndex('bento_whatsapp_link_codes_code_hash_idx').on(table.codeHash),
    userIdx: index('bento_whatsapp_link_codes_user_id_idx').on(table.userId),
  }),
);

/**
 * Cada mensagem recebida pelo número do Bento, do webhook até a resposta.
 *
 * É ao mesmo tempo:
 *   - a TRAVA DE DUPLICIDADE: `dedupeKey` único (`<sessão>:<id da mensagem>`)
 *     faz o retry do webhook e o segundo webhook da mesma sessão caírem no
 *     mesmo registro — nunca numa segunda resposta;
 *   - a FILA DURÁVEL: o que ficou em 'received'/'processing' quando o processo
 *     caiu é retomado na subida (ver recuperação em gateway.ts);
 *   - a AUDITORIA e as MÉTRICAS do painel (latência, falhas, volume).
 *
 * Guarda o texto recebido porque ele também está em `messages` (o turno do
 * chat) — não é um segundo lugar com dado novo. O painel administrativo NÃO
 * mostra este texto: mostra estado, tempo e motivo.
 */
export const bentoWhatsappInbound = pgTable(
  'bento_whatsapp_inbound',
  {
    ...idColumn,
    dedupeKey: text('dedupe_key').notNull(),
    sessionId: text('session_id').notNull(),
    waMessageId: text('wa_message_id').notNull(),
    chatId: text('chat_id').notNull(),
    /** Número do remetente, só dígitos, quando resolvível. */
    senderPhone: text('sender_phone'),
    /** 'text' | 'audio' | 'image' | 'document' | 'other'. */
    kind: text('kind').notNull(),
    text: text('text'),
    linkId: uuid('link_id').references(() => bentoWhatsappLinks.id, { onDelete: 'set null' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'set null' }),
    /**
     * received | processing | dispatched | replied | ignored | failed | send_failed
     * Texto e não enum: estado operacional ganha valores.
     */
    status: text('status').notNull().default('received'),
    /** Por que não virou turno (own_message, unlinked, group_not_allowed, ...). */
    reason: text('reason'),
    conversationId: uuid('conversation_id'),
    executionId: text('execution_id'),
    replyMessageIds: jsonb('reply_message_ids').notNull().default([]),
    error: text('error'),
    attempts: integer('attempts').notNull().default(0),
    /** Momento da mensagem no WhatsApp (o `timestamp` do engine). */
    sentAt: timestamp('sent_at', { withTimezone: true }),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    repliedAt: timestamp('replied_at', { withTimezone: true }),
    latencyMs: integer('latency_ms'),
    ...timestampColumns,
  },
  (table) => ({
    dedupeIdx: uniqueIndex('bento_whatsapp_inbound_dedupe_key_idx').on(table.dedupeKey),
    statusIdx: index('bento_whatsapp_inbound_status_idx').on(table.status, table.createdAt),
    chatIdx: index('bento_whatsapp_inbound_chat_idx').on(table.chatId, table.createdAt),
  }),
);
