import { boolean, index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { idColumn, timestampColumns } from './_shared';
import { organizations } from './organizations';
import { clients } from './clients';
import { users } from './identity';
import { contacts } from './communications';
import { integrationConnections } from './integrations';

/**
 * calendar.ts — Calendar Core (prompt "CALENDAR + AUTOMATIONS + BENTO V2",
 * Parte A, 06/10/2026). "A camada temporal da operação": reunião, agenda,
 * entrega — nunca deadline de demanda/task/aprovação, que continua vivendo
 * só na tabela de origem (demands.dueDate etc.) e entra na VISÃO do
 * calendário por agregação de leitura, não por cópia aqui (§6 do prompt:
 * "não converter todo deadline em evento"). Duplicar seria uma segunda fonte
 * de verdade desincronizável da primeira — exatamente o problema que
 * `clients.clickupListId` e `demands.dueDate` já resolveram por tabela
 * própria, não por espelho.
 *
 * SOURCE OF TRUTH (§7): `source='native'` nasceu aqui, Desigual é
 * autoritativo. `source='google'` veio de sync, Google é autoritativo —
 * UPDATE/DELETE desse evento acontece pelo mesmo caminho do sync, nunca por
 * edição direta que divergiria da próxima sincronização.
 */
export const calendarEvents = pgTable(
  'calendar_events',
  {
    ...idColumn,
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    /** Nunca resolvido pelo título do evento (§14) — sempre gravado explicitamente na criação. */
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    description: text('description'),
    startAt: timestamp('start_at', { withTimezone: true }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true }).notNull(),
    /** IANA (ex.: "America/Sao_Paulo") — o evento é a unidade que carrega fuso, não a organização (que ainda não tem um campo próprio). */
    timezone: text('timezone').notNull().default('America/Sao_Paulo'),
    location: text('location'),
    meetingUrl: text('meeting_url'),
    /** 'native' | 'google'. Decide quem é a fonte de verdade — ver cabeçalho. */
    source: text('source').notNull().default('native'),
    externalProvider: text('external_provider'),
    externalEventId: text('external_event_id'),
    /** Qual agenda Google guarda este evento — necessário pro sync incremental saber onde reconsultar. */
    externalCalendarId: text('external_calendar_id'),
    /** 'default' | 'private'. Evento privado nunca expõe título/descrição/participantes pra quem não é dono nem participante (§27). */
    visibility: text('visibility').notNull().default('default'),
    /** 'confirmed' | 'tentative' | 'cancelled'. Cancelado não é deletado — preserva o rastro de "havia algo aqui". */
    status: text('status').notNull().default('confirmed'),
    createdBy: uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
    ...timestampColumns,
  },
  (table) => ({
    organizationIdx: index('calendar_events_organization_id_idx').on(table.organizationId),
    clientIdx: index('calendar_events_client_id_idx').on(table.clientId),
    startAtIdx: index('calendar_events_start_at_idx').on(table.startAt),
    /** Mesmo (provider, external id, calendar) nunca pode duplicar — é o que garante "nunca duplicar o mesmo evento" (§7) em cada passada de sync. */
    externalUnique: unique('calendar_events_external_unique').on(table.externalProvider, table.externalEventId, table.externalCalendarId),
  }),
);

export const calendarEventParticipants = pgTable(
  'calendar_event_participants',
  {
    ...idColumn,
    eventId: uuid('event_id').notNull().references(() => calendarEvents.id, { onDelete: 'cascade' }),
    /** Colaborador do Desigual — é quem a Availability Engine enxerga como ocupado. */
    memberId: uuid('member_id').references(() => users.id, { onDelete: 'cascade' }),
    /** Contato externo (cliente) já cadastrado — mesma tabela que o Inbox usa. */
    contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
    /** E-mail avulso, quando o convidado não é nem colaborador nem contato cadastrado. */
    email: text('email'),
    /** Obrigatório (hard conflict) vs opcional (soft conflict) — ver §20. */
    required: boolean('required').notNull().default(true),
    /** 'needsAction' | 'accepted' | 'declined' | 'tentative'. */
    responseStatus: text('response_status').notNull().default('needsAction'),
    ...timestampColumns,
  },
  (table) => ({
    eventIdx: index('calendar_event_participants_event_id_idx').on(table.eventId),
    memberIdx: index('calendar_event_participants_member_id_idx').on(table.memberId),
    /** Permite upsert idempotente na sync do Google (mesmo colaborador, mesmo
     *  evento, syncs repetidas não duplicam linha) — NULL em memberId (convite
     *  por e-mail/contato) não é afetado: Postgres nunca considera dois NULL
     *  iguais num UNIQUE. */
    eventMemberUnique: unique('calendar_event_participants_event_id_member_id_unique').on(table.eventId, table.memberId),
  }),
);

/**
 * member_calendar_accounts — igual a client_meta_accounts/client_google_ads_accounts
 * (§24 do prompt: "Calendar deve separar credential vs calendar resource vs
 * member mapping", mesma régua do Meta Ads). `connectionId` aponta pra
 * `integration_connections` (provider='google_calendar', por COLABORADOR —
 * nunca um token único da agência representando a agenda pessoal de todos,
 * §23).
 */
export const memberCalendarAccounts = pgTable(
  'member_calendar_accounts',
  {
    ...idColumn,
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    /** Capturada da empresa de trabalho de QUEM vinculou, no momento do vínculo — evita resolver
     *  org de forma ambígua durante a sync (um colaborador raramente, mas pode, estar em mais de uma empresa). */
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    connectionId: uuid('connection_id').references(() => integrationConnections.id, { onDelete: 'set null' }),
    /** Normalmente o e-mail da agenda no Google ("jamille@..."), como a Calendar API identifica calendarId. */
    externalCalendarId: text('external_calendar_id').notNull(),
    isPrimary: boolean('is_primary').notNull().default(true),
    /** Checkpoint de sync incremental (§25) — presente só depois da primeira sync completa. */
    syncToken: text('sync_token'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    ...timestampColumns,
  },
  (table) => ({
    userExternalUnique: unique('member_calendar_accounts_user_id_external_calendar_id_unique').on(table.userId, table.externalCalendarId),
    userIdx: index('member_calendar_accounts_user_id_idx').on(table.userId),
  }),
);
