import { pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { idColumn, timestampColumns } from './_shared';
import { clients } from './clients';

/**
 * Espelho operacional do ClickUp (seção 8), atualizado via Tool Gateway.
 * Nunca a fonte de verdade: o ClickUp em si continua sendo.
 */
export const clickupWorkspaces = pgTable('clickup_workspaces', {
  ...idColumn,
  clickupId: text('clickup_id').notNull().unique(),
  name: text('name').notNull(),
  ...timestampColumns,
});

export const clickupSpaces = pgTable('clickup_spaces', {
  ...idColumn,
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => clickupWorkspaces.id, { onDelete: 'cascade' }),
  clickupId: text('clickup_id').notNull().unique(),
  name: text('name').notNull(),
  ...timestampColumns,
});

export const clickupLists = pgTable('clickup_lists', {
  ...idColumn,
  spaceId: uuid('space_id')
    .notNull()
    .references(() => clickupSpaces.id, { onDelete: 'cascade' }),
  clickupId: text('clickup_id').notNull().unique(),
  name: text('name').notNull(),
  ...timestampColumns,
});

export const clickupTasks = pgTable('clickup_tasks', {
  ...idColumn,
  listId: uuid('list_id')
    .notNull()
    .references(() => clickupLists.id, { onDelete: 'cascade' }),
  clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
  clickupId: text('clickup_id').notNull().unique(),
  name: text('name').notNull(),
  status: text('status').notNull(),
  url: text('url'),
  ...timestampColumns,
});
