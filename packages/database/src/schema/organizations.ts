import { index, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { idColumn, timestampColumns } from './_shared';
import { users } from './identity';

export const organizations = pgTable('organizations', {
  ...idColumn,
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  ...timestampColumns,
});

export const organizationMembers = pgTable(
  'organization_members',
  {
    ...idColumn,
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('collaborator'),
    ...timestampColumns,
  },
  (table) => ({
    membershipUnique: unique().on(table.organizationId, table.userId),
    userIdx: index('organization_members_user_id_idx').on(table.userId),
    organizationIdx: index('organization_members_organization_id_idx').on(table.organizationId),
  }),
);
