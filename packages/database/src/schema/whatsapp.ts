import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { idColumn, timestampColumns } from './_shared';
import { users } from './identity';
import { organizations } from './organizations';

export const whatsappSessions = pgTable(
  'whatsapp_sessions',
  {
    ...idColumn,
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    ownerUserId: uuid('owner_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull().default('openwa'),
    externalSessionId: text('external_session_id').notNull(),
    externalName: text('external_name').notNull(),
    apiKeyEncrypted: text('api_key_encrypted').notNull(),
    webhookSecretEncrypted: text('webhook_secret_encrypted').notNull(),
    webhookId: text('webhook_id'),
    phoneNumber: text('phone_number'),
    pushName: text('push_name'),
    status: text('status').notNull().default('created'),
    engineLoaded: boolean('engine_loaded').notNull().default(false),
    connectedAt: timestamp('connected_at', { withTimezone: true }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    lastError: text('last_error'),
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    ...timestampColumns,
  },
  (table) => ({
    externalSessionUnique: uniqueIndex('whatsapp_sessions_external_session_unique').on(table.externalSessionId),
    ownerProviderUnique: uniqueIndex('whatsapp_sessions_owner_provider_unique').on(table.organizationId, table.ownerUserId, table.provider),
    organizationIdx: index('whatsapp_sessions_organization_idx').on(table.organizationId),
    statusIdx: index('whatsapp_sessions_status_idx').on(table.status),
  }),
);

export const whatsappSyncJobs = pgTable(
  'whatsapp_sync_jobs',
  {
    ...idColumn,
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id').notNull().references(() => whatsappSessions.id, { onDelete: 'cascade' }),
    requestedByUserId: uuid('requested_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    status: text('status').notNull().default('queued'),
    phase: text('phase').notNull().default('queued'),
    processedContacts: integer('processed_contacts').notNull().default(0),
    processedChats: integer('processed_chats').notNull().default(0),
    processedMessages: integer('processed_messages').notNull().default(0),
    duplicateMessages: integer('duplicate_messages').notNull().default(0),
    importedMedia: integer('imported_media').notNull().default(0),
    failures: jsonb('failures').$type<Array<{ chatId?: string; message: string }>>().notNull().default([]),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    ...timestampColumns,
  },
  (table) => ({
    sessionIdx: index('whatsapp_sync_jobs_session_idx').on(table.sessionId, table.createdAt),
    statusIdx: index('whatsapp_sync_jobs_status_idx').on(table.status, table.createdAt),
  }),
);

export const whatsappWebhookEvents = pgTable(
  'whatsapp_webhook_events',
  {
    ...idColumn,
    dedupeKey: text('dedupe_key').notNull(),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id').notNull().references(() => whatsappSessions.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    status: text('status').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    error: text('error'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    ...timestampColumns,
  },
  (table) => ({
    dedupeUnique: uniqueIndex('whatsapp_webhook_events_dedupe_unique').on(table.dedupeKey),
    sessionIdx: index('whatsapp_webhook_events_session_idx').on(table.sessionId, table.createdAt),
    statusIdx: index('whatsapp_webhook_events_status_idx').on(table.status, table.createdAt),
  }),
);

export const whatsappGroups = pgTable(
  'whatsapp_groups',
  {
    ...idColumn,
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id').notNull().references(() => whatsappSessions.id, { onDelete: 'cascade' }),
    externalGroupId: text('external_group_id').notNull(),
    name: text('name').notNull(),
    participants: jsonb('participants').$type<Array<Record<string, unknown>>>().notNull().default([]),
    avatarUrl: text('avatar_url'),
    ...timestampColumns,
  },
  (table) => ({
    externalGroupUnique: uniqueIndex('whatsapp_groups_session_external_unique').on(table.sessionId, table.externalGroupId),
    organizationIdx: index('whatsapp_groups_organization_idx').on(table.organizationId),
  }),
);
