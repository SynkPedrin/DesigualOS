import { timestamp, uuid } from 'drizzle-orm/pg-core';

export const idColumn = {
  id: uuid('id').primaryKey().defaultRandom(),
};

export const timestampColumns = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const softDeleteColumn = {
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
};
