import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { idColumn, timestampColumns } from './_shared';
import { users } from './identity';
import { organizations } from './organizations';

/**
 * ANÚNCIOS DE FUNCIONALIDADE (Hub 2.1, 21/10/2026).
 *
 * Um sistema só para anunciar o que chega no Desigual OS — a Comunicação foi o
 * primeiro; Daily Tasks, integrações e dashboards novos usam a mesma tabela.
 * Não é CMS: o conteúdo nasce numa migração (ou no painel de admin) e o que se
 * administra no dia a dia é só ativar, público, prioridade e rollout.
 *
 * QUEM VÊ (conferido no servidor, nunca só na tela):
 *  - `active` e `rollout` ≠ 'off'; entre `published_at` e `expires_at`;
 *  - `rollout` 'qa' = só quem está em `qa_user_ids`; 'all' = todo o público;
 *  - público (`audience`): pessoa ativa, com TODOS os módulos de
 *    `audience.modules` no workspace (quem não tem a Comunicação não recebe o
 *    anúncio da Comunicação), e — se informados — um dos `audience.roles` e uma
 *    das `audience.organization_ids`.
 */
export interface AudienciaDoAnuncio {
  modules?: string[];
  roles?: string[];
  organization_ids?: string[];
}

export interface AcaoDoAnuncio {
  label: string;
  /** 'start_tutorial' abre o tutorial do anúncio; 'navigate' vai para `href`; 'dismiss' só fecha. */
  action: 'start_tutorial' | 'navigate' | 'dismiss';
  href?: string;
}

export interface ExibicaoDoAnuncio {
  /** Abre sozinho (uma vez por pessoa) na próxima entrada elegível. */
  auto_open: boolean;
  /** Ícone (nome do lucide) do modal. */
  icon?: string;
  /** Aviso persistente no sino, criado quando o anúncio é apresentado à pessoa. */
  notification?: { title: string; body: string; action_label: string; link: string } | null;
}

export const featureAnnouncements = pgTable(
  'feature_announcements',
  {
    ...idColumn,
    key: text('key').notNull(),
    /** NEW_FEATURE | IMPROVEMENT | INTEGRATION | DASHBOARD | AI_TOOL */
    type: text('type').notNull().default('NEW_FEATURE'),
    title: text('title').notNull(),
    subtitle: text('subtitle'),
    description: text('description').notNull(),
    version: integer('version').notNull().default(1),
    audience: jsonb('audience').$type<AudienciaDoAnuncio>().notNull().default({}),
    /** 'off' (ninguém) → 'qa' (só qa_user_ids) → 'all' (todo o público). */
    rollout: text('rollout').notNull().default('off'),
    qaUserIds: uuid('qa_user_ids').array().notNull().default([]),
    active: boolean('active').notNull().default(true),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    previewImageUrl: text('preview_image_url'),
    primaryCta: jsonb('primary_cta').$type<AcaoDoAnuncio>().notNull(),
    secondaryCta: jsonb('secondary_cta').$type<AcaoDoAnuncio | null>(),
    /** Id do tutorial no registro da tela (apps/web/src/components/tour/tours.ts). */
    tutorialId: text('tutorial_id'),
    tutorialVersion: integer('tutorial_version').notNull().default(1),
    priority: integer('priority').notNull().default(0),
    display: jsonb('display').$type<ExibicaoDoAnuncio>().notNull().default({ auto_open: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestampColumns,
  },
  (table) => ({
    keyUq: uniqueIndex('feature_announcements_key_uq').on(table.key),
  }),
);

/**
 * O que cada pessoa fez com cada anúncio. Uma linha por (anúncio, pessoa) —
 * índice único —, e toda gravação é upsert: duas abas, dois dispositivos ou um
 * clique repetido chegam no mesmo estado. É a fonte da verdade; a tela não usa
 * localStorage para decidir se mostra.
 *
 * `state`: not_seen → (dismissed | in_progress) → completed. `completed` não
 * volta: reabrir o tutorial depois de concluir não "desconclui".
 * `auto_shown_at`: a apresentação automática já aconteceu (é ela que acontece
 * uma vez só; reabrir por vontade própria não conta).
 */
export const featureAnnouncementStates = pgTable(
  'feature_announcement_states',
  {
    ...idColumn,
    announcementId: uuid('announcement_id').notNull().references(() => featureAnnouncements.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'set null' }),
    state: text('state').notNull().default('not_seen'),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }),
    autoShownAt: timestamp('auto_shown_at', { withTimezone: true }),
    lastInteractionAt: timestamp('last_interaction_at', { withTimezone: true }),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    tutorialVersion: integer('tutorial_version'),
    /** Última etapa vista do tutorial (recuperação depois de recarregar a página ou trocar de aparelho). */
    tutorialStep: integer('tutorial_step'),
    ...timestampColumns,
  },
  (table) => ({
    porPessoaUq: uniqueIndex('feature_announcement_states_announcement_user_uq').on(table.announcementId, table.userId),
    porPessoaIdx: index('feature_announcement_states_user_idx').on(table.userId),
  }),
);
