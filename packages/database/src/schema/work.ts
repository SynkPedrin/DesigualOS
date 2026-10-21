import { type AnyPgColumn, boolean, doublePrecision, index, integer, jsonb, pgTable, smallint, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { idColumn, timestampColumns } from './_shared';
import { organizations } from './organizations';
import { users } from './identity';
import { clients } from './clients';

/**
 * Daily Tasks — o motor nativo de gestão de trabalho (Beta, só administradores autorizados).
 *
 * PRINCÍPIOS (valem para TODAS as tabelas work_*):
 *  - `organization_id` em toda linha, e toda consulta filtra por ele. Não há tabela "global".
 *  - Independência do ClickUp: nada aqui referencia o ClickUp. O vínculo com sistemas externos mora
 *    em `work_external_mappings` (incremento de integrações), nunca como chave da tarefa.
 *  - Hierarquia por ID real: Space → Folder → Project → List → Task → Subtask. Cliente é relação
 *    (`client_id`), nunca texto nem chave.
 *  - Nenhum DELETE em cascata apaga trabalho por acidente: arquivar (`archived_at`) é o caminho
 *    normal; as FKs de cascata existem só para a remoção deliberada de um espaço inteiro.
 *
 * Migração ADITIVA: só cria tabelas novas. Nada existente é alterado.
 */

/** Liga/desliga o módulo por empresa e lista QUEM pode usar (Beta restrito). A flag NÃO substitui RBAC. */
export const workFeatureFlags = pgTable(
  'work_feature_flags',
  {
    ...idColumn,
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    /** Desligado por padrão: o módulo só existe depois de alguém ligar de propósito. */
    enabled: boolean('enabled').notNull().default(false),
    /** Usuários explicitamente autorizados. Lista vazia + enabled = ninguém (nem admin) entra. */
    allowedUserIds: jsonb('allowed_user_ids').$type<string[]>().notNull().default([]),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestampColumns,
  },
  (t) => ({ orgKeyUnique: unique('work_feature_flags_org_key_unique').on(t.organizationId, t.key) }),
);

export const workSpaces = pgTable(
  'work_spaces',
  {
    ...idColumn,
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color'),
    icon: text('icon'),
    description: text('description'),
    position: doublePrecision('position').notNull().default(0),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestampColumns,
  },
  (t) => ({ orgIdx: index('work_spaces_org_idx').on(t.organizationId, t.archivedAt, t.position) }),
);

export const workFolders = pgTable(
  'work_folders',
  {
    ...idColumn,
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    spaceId: uuid('space_id').notNull().references(() => workSpaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    position: doublePrecision('position').notNull().default(0),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestampColumns,
  },
  (t) => ({ spaceIdx: index('work_folders_space_idx').on(t.organizationId, t.spaceId, t.position) }),
);

export const workProjects = pgTable(
  'work_projects',
  {
    ...idColumn,
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    spaceId: uuid('space_id').notNull().references(() => workSpaces.id, { onDelete: 'cascade' }),
    folderId: uuid('folder_id').references(() => workFolders.id, { onDelete: 'set null' }),
    /** Relação com o cadastro de clientes existente. Nunca o nome do cliente. */
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    description: text('description'),
    /** active | paused | done */
    status: text('status').notNull().default('active'),
    color: text('color'),
    startDate: timestamp('start_date', { withTimezone: true }),
    dueDate: timestamp('due_date', { withTimezone: true }),
    position: doublePrecision('position').notNull().default(0),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestampColumns,
  },
  (t) => ({
    spaceIdx: index('work_projects_space_idx').on(t.organizationId, t.spaceId, t.position),
    clientIdx: index('work_projects_client_idx').on(t.organizationId, t.clientId),
  }),
);

export const workLists = pgTable(
  'work_lists',
  {
    ...idColumn,
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    spaceId: uuid('space_id').notNull().references(() => workSpaces.id, { onDelete: 'cascade' }),
    /** Lista pode viver direto no espaço, numa pasta ou num projeto. */
    folderId: uuid('folder_id').references(() => workFolders.id, { onDelete: 'set null' }),
    projectId: uuid('project_id').references(() => workProjects.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    description: text('description'),
    position: doublePrecision('position').notNull().default(0),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestampColumns,
  },
  (t) => ({
    spaceIdx: index('work_lists_space_idx').on(t.organizationId, t.spaceId, t.position),
    projectIdx: index('work_lists_project_idx').on(t.organizationId, t.projectId),
  }),
);

/** Workflow de status POR ESPAÇO. O front nunca assume valores fixos: tudo vem daqui. */
export const workTaskStatuses = pgTable(
  'work_task_statuses',
  {
    ...idColumn,
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    spaceId: uuid('space_id').notNull().references(() => workSpaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color').notNull().default('#6b7280'),
    /** todo | active | review | blocked | done | cancelled — o que o status SIGNIFICA, independente do nome. */
    category: text('category').notNull().default('todo'),
    position: doublePrecision('position').notNull().default(0),
    isInitial: boolean('is_initial').notNull().default(false),
    isFinal: boolean('is_final').notNull().default(false),
    ...timestampColumns,
  },
  (t) => ({
    nameUnique: unique('work_task_statuses_space_name_unique').on(t.spaceId, t.name),
    spaceIdx: index('work_task_statuses_space_idx').on(t.organizationId, t.spaceId, t.position),
  }),
);

/** Transições permitidas. Sem NENHUMA linha para um status de origem = todas as transições são livres. */
export const workStatusTransitions = pgTable(
  'work_status_transitions',
  {
    ...idColumn,
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    spaceId: uuid('space_id').notNull().references(() => workSpaces.id, { onDelete: 'cascade' }),
    fromStatusId: uuid('from_status_id').notNull().references(() => workTaskStatuses.id, { onDelete: 'cascade' }),
    toStatusId: uuid('to_status_id').notNull().references(() => workTaskStatuses.id, { onDelete: 'cascade' }),
  },
  (t) => ({ pairUnique: unique('work_status_transitions_pair_unique').on(t.fromStatusId, t.toStatusId) }),
);

/** Contador por empresa para o identificador público legível (DT-123). Incremento atômico via upsert. */
export const workCounters = pgTable(
  'work_counters',
  {
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    value: integer('value').notNull().default(0),
  },
  (t) => ({ pk: uniqueIndex('work_counters_org_key_unique').on(t.organizationId, t.key) }),
);

export const workTasks = pgTable(
  'work_tasks',
  {
    ...idColumn,
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    /** Número legível por empresa; a chave pública é `DT-<number>`. */
    number: integer('number').notNull(),
    listId: uuid('list_id').notNull().references(() => workLists.id, { onDelete: 'cascade' }),
    parentTaskId: uuid('parent_task_id').references((): AnyPgColumn => workTasks.id, { onDelete: 'cascade' }),
    /** 0 = tarefa, 1+ = subtarefa. Limitado pelo serviço (profundidade máxima configurável). */
    depth: smallint('depth').notNull().default(0),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    /** Texto rico em Markdown. `descriptionDoc` guarda a versão estruturada quando o editor a produzir. */
    description: text('description'),
    descriptionDoc: jsonb('description_doc').$type<Record<string, unknown> | null>(),
    statusId: uuid('status_id').notNull().references(() => workTaskStatuses.id, { onDelete: 'restrict' }),
    /** 0 sem prioridade · 1 urgente · 2 alta · 3 normal · 4 baixa. Estável no banco; o rótulo é do front. */
    priority: smallint('priority').notNull().default(0),
    startAt: timestamp('start_at', { withTimezone: true }),
    dueAt: timestamp('due_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    estimateMinutes: integer('estimate_minutes'),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    position: doublePrecision('position').notNull().default(0),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    /** Controle otimista de concorrência: a atualização só vale se o cliente viu a versão atual. */
    version: integer('version').notNull().default(1),
    ...timestampColumns,
  },
  (t) => ({
    numberUnique: unique('work_tasks_org_number_unique').on(t.organizationId, t.number),
    listIdx: index('work_tasks_list_idx').on(t.organizationId, t.listId, t.archivedAt, t.position),
    statusIdx: index('work_tasks_status_idx').on(t.organizationId, t.statusId),
    dueIdx: index('work_tasks_due_idx').on(t.organizationId, t.dueAt),
    parentIdx: index('work_tasks_parent_idx').on(t.parentTaskId),
    clientIdx: index('work_tasks_client_idx').on(t.organizationId, t.clientId),
  }),
);

export const workTaskAssignees = pgTable(
  'work_task_assignees',
  {
    taskId: uuid('task_id').notNull().references(() => workTasks.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    assignedBy: uuid('assigned_by').references(() => users.id, { onDelete: 'set null' }),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: uniqueIndex('work_task_assignees_pk').on(t.taskId, t.userId),
    userIdx: index('work_task_assignees_user_idx').on(t.organizationId, t.userId),
  }),
);

/** Trilha de tudo que acontece: base do histórico da tarefa, da auditoria e do motor de automações. */
export const workActivityEvents = pgTable(
  'work_activity_events',
  {
    ...idColumn,
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    /** space | folder | project | list | task | ... */
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    taskId: uuid('task_id'),
    /** created | updated | status_changed | assigned | unassigned | moved | archived | restored | ... */
    action: text('action').notNull(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    /** user | automation | agent | system: quem agiu, para a auditoria separar pessoa de máquina. */
    actorKind: text('actor_kind').notNull().default('user'),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    taskIdx: index('work_activity_task_idx').on(t.organizationId, t.taskId, t.createdAt),
    entityIdx: index('work_activity_entity_idx').on(t.organizationId, t.entityType, t.entityId, t.createdAt),
  }),
);

/** Idempotência de criação: o mesmo `Idempotency-Key` devolve a mesma entidade, nunca uma segunda. */
export const workIdempotencyKeys = pgTable(
  'work_idempotency_keys',
  {
    ...idColumn,
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ keyUnique: unique('work_idempotency_org_user_key_unique').on(t.organizationId, t.userId, t.key) }),
);
