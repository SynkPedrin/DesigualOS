import { boolean, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { idColumn, softDeleteColumn, timestampColumns } from './_shared';
import { roleNameEnum } from './enums';

/**
 * Perfil de usuário da aplicação. Autenticação real (senha, provedores)
 * é responsabilidade do Supabase Auth (ver docs/architecture/decisions/0001).
 * authUserId é preenchido na Fase 13 ao vincular este perfil ao usuário do Supabase Auth.
 */
export const users = pgTable('users', {
  ...idColumn,
  authUserId: uuid('auth_user_id').unique(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  avatarUrl: text('avatar_url'),
  // E-mail do ClickUp deste usuário, pra atribuir tarefas a ele quando o
  // Bento cria uma (via API key única, seção Tool Gateway). Pode ser
  // diferente do e-mail de login se o colaborador usa outro no ClickUp.
  clickupEmail: text('clickup_email'),
  // Idioma de preferência da UI (central de configuração da conta).
  language: text('language').notNull().default('pt-BR'),
  // Tema de preferência da UI (central de configuração da conta): claro,
  // escuro ou "system" (segue o SO do usuário, decisão do frontend).
  theme: text('theme').notNull().default('system'),
  // Widgets escolhidos pelo próprio colaborador pro dashboard dele (pedido
  // do usuário: "dashboard que eles conseguem configurar com as
  // informações que eles mesmo julgarem necessárias"). Lista de ids livre
  // (não é enum): cada widget já busca dado de uma rota com RBAC própria,
  // então a lista aqui é só preferência de exibição, sem risco de acesso.
  dashboardWidgets: jsonb('dashboard_widgets').$type<string[]>().notNull().default([]),
  active: boolean('active').notNull().default(true),
  // Presença leve: atualizado pelo requireAuth (no máximo 1x por minuto por
  // usuário). "Online" é calculado no cliente (ex.: visto nos últimos 3 min).
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  ...timestampColumns,
  ...softDeleteColumn,
});

export const roles = pgTable('roles', {
  ...idColumn,
  name: roleNameEnum('name').notNull().unique(),
  description: text('description'),
  ...timestampColumns,
});

/**
 * Cada linha concede uma permissão granular a um papel.
 * Ex: (role=colaborador, resource=clients, action=read).
 */
export const permissions = pgTable(
  'permissions',
  {
    ...idColumn,
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    resource: text('resource').notNull(),
    action: text('action').notNull(),
    ...timestampColumns,
  },
  (table) => ({
    roleResourceActionUnique: unique().on(table.roleId, table.resource, table.action),
  }),
);

export const userRoles = pgTable(
  'user_roles',
  {
    ...idColumn,
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    ...timestampColumns,
  },
  (table) => ({ userRoleUnique: unique().on(table.userId, table.roleId) }),
);
