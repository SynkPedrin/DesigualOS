import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { recordActivity } from './activity';
import type { Db, WorkContext } from './context';
import { invalid, notFound } from './errors';
import { seedDefaultWorkflow } from './statuses';

/**
 * Hierarquia: Space → Folder → Project → List. Regras que valem em TODAS as operações:
 *  - todo pai citado precisa ser da MESMA empresa e do MESMO espaço (nunca se cruza espaço por engano);
 *  - cliente é relação por id e precisa ser da mesma empresa;
 *  - "remover" é arquivar. A remoção física de um espaço inteiro não é exposta aqui.
 */

const name = (v: string | undefined, label: string): string => {
  const t = (v ?? '').trim();
  if (t.length === 0 || t.length > 120) throw invalid(`O nome de ${label} precisa ter de 1 a 120 caracteres.`);
  return t;
};

async function nextPosition(tx: Db, table: 'spaces' | 'folders' | 'projects' | 'lists', ctx: WorkContext, where: ReturnType<typeof and> | undefined): Promise<number> {
  const t = { spaces: schema.workSpaces, folders: schema.workFolders, projects: schema.workProjects, lists: schema.workLists }[table];
  const [r] = await tx.select({ m: sql<number>`coalesce(max(${t.position}), 0)` }).from(t).where(and(eq(t.organizationId, ctx.organizationId), where));
  return Number(r?.m ?? 0) + 1000;
}

async function assertClient(tx: Db, ctx: WorkContext, clientId: string | null | undefined): Promise<void> {
  if (!clientId) return;
  const [c] = await tx.select({ id: schema.clients.id }).from(schema.clients).where(and(eq(schema.clients.id, clientId), eq(schema.clients.organizationId, ctx.organizationId)));
  if (!c) throw invalid('Cliente não encontrado nesta empresa.');
}

// ── Espaços ──────────────────────────────────────────────────────────────

export type WorkSpace = typeof schema.workSpaces.$inferSelect;

export async function createSpace(ctx: WorkContext, input: { name: string; color?: string; icon?: string; description?: string }): Promise<WorkSpace> {
  const n = name(input.name, 'o espaço');
  return db.transaction(async (raw) => {
    const tx = raw as unknown as Db;
    const [row] = await tx
      .insert(schema.workSpaces)
      .values({ organizationId: ctx.organizationId, name: n, color: input.color ?? null, icon: input.icon ?? null, description: input.description ?? null, position: await nextPosition(tx, 'spaces', ctx, undefined), createdBy: ctx.userId })
      .returning();
    await seedDefaultWorkflow(tx, ctx, row!.id);
    await recordActivity(tx, ctx, { entityType: 'space', entityId: row!.id, action: 'created', data: { name: n } });
    return row!;
  });
}

export async function updateSpace(ctx: WorkContext, id: string, patch: { name?: string; color?: string | null; icon?: string | null; description?: string | null; position?: number }): Promise<WorkSpace> {
  return db.transaction(async (raw) => {
    const tx = raw as unknown as Db;
    const set: Partial<typeof schema.workSpaces.$inferInsert> = { updatedAt: new Date() };
    if (patch.name !== undefined) set.name = name(patch.name, 'o espaço');
    if (patch.color !== undefined) set.color = patch.color;
    if (patch.icon !== undefined) set.icon = patch.icon;
    if (patch.description !== undefined) set.description = patch.description;
    if (patch.position !== undefined) set.position = patch.position;
    const [row] = await tx.update(schema.workSpaces).set(set).where(and(eq(schema.workSpaces.id, id), eq(schema.workSpaces.organizationId, ctx.organizationId))).returning();
    if (!row) throw notFound('Espaço');
    await recordActivity(tx, ctx, { entityType: 'space', entityId: id, action: 'updated', data: { fields: Object.keys(patch) } });
    return row;
  });
}

// ── Pastas ───────────────────────────────────────────────────────────────

export type WorkFolder = typeof schema.workFolders.$inferSelect;

async function getSpace(tx: Db, ctx: WorkContext, spaceId: string) {
  const [s] = await tx.select().from(schema.workSpaces).where(and(eq(schema.workSpaces.id, spaceId), eq(schema.workSpaces.organizationId, ctx.organizationId), isNull(schema.workSpaces.archivedAt)));
  if (!s) throw notFound('Espaço');
  return s;
}

export async function createFolder(ctx: WorkContext, input: { spaceId: string; name: string }): Promise<WorkFolder> {
  const n = name(input.name, 'a pasta');
  return db.transaction(async (raw) => {
    const tx = raw as unknown as Db;
    await getSpace(tx, ctx, input.spaceId);
    const [row] = await tx
      .insert(schema.workFolders)
      .values({ organizationId: ctx.organizationId, spaceId: input.spaceId, name: n, position: await nextPosition(tx, 'folders', ctx, eq(schema.workFolders.spaceId, input.spaceId)), createdBy: ctx.userId })
      .returning();
    await recordActivity(tx, ctx, { entityType: 'folder', entityId: row!.id, action: 'created', data: { spaceId: input.spaceId, name: n } });
    return row!;
  });
}

// ── Projetos ─────────────────────────────────────────────────────────────

export type WorkProject = typeof schema.workProjects.$inferSelect;
const PROJECT_STATUSES = ['active', 'paused', 'done'] as const;

export interface ProjectInput {
  spaceId: string;
  folderId?: string | null;
  clientId?: string | null;
  name: string;
  description?: string | null;
  status?: (typeof PROJECT_STATUSES)[number];
  color?: string | null;
  startDate?: Date | null;
  dueDate?: Date | null;
}

async function assertFolderInSpace(tx: Db, ctx: WorkContext, folderId: string | null | undefined, spaceId: string): Promise<void> {
  if (!folderId) return;
  const [f] = await tx
    .select({ id: schema.workFolders.id })
    .from(schema.workFolders)
    .where(and(eq(schema.workFolders.id, folderId), eq(schema.workFolders.organizationId, ctx.organizationId), eq(schema.workFolders.spaceId, spaceId), isNull(schema.workFolders.archivedAt)));
  if (!f) throw invalid('A pasta precisa existir e ser do mesmo espaço.');
}

function assertDates(start: Date | null | undefined, due: Date | null | undefined): void {
  if (start && due && start.getTime() > due.getTime()) throw invalid('A data de início não pode ser depois do prazo.');
}

export async function createProject(ctx: WorkContext, input: ProjectInput): Promise<WorkProject> {
  const n = name(input.name, 'o projeto');
  if (input.status && !PROJECT_STATUSES.includes(input.status)) throw invalid('Status de projeto inválido.');
  assertDates(input.startDate, input.dueDate);
  return db.transaction(async (raw) => {
    const tx = raw as unknown as Db;
    await getSpace(tx, ctx, input.spaceId);
    await assertFolderInSpace(tx, ctx, input.folderId, input.spaceId);
    await assertClient(tx, ctx, input.clientId);
    const [row] = await tx
      .insert(schema.workProjects)
      .values({
        organizationId: ctx.organizationId,
        spaceId: input.spaceId,
        folderId: input.folderId ?? null,
        clientId: input.clientId ?? null,
        name: n,
        description: input.description ?? null,
        status: input.status ?? 'active',
        color: input.color ?? null,
        startDate: input.startDate ?? null,
        dueDate: input.dueDate ?? null,
        position: await nextPosition(tx, 'projects', ctx, eq(schema.workProjects.spaceId, input.spaceId)),
        createdBy: ctx.userId,
      })
      .returning();
    await recordActivity(tx, ctx, { entityType: 'project', entityId: row!.id, action: 'created', data: { spaceId: input.spaceId, name: n, clientId: input.clientId ?? null } });
    return row!;
  });
}

export async function updateProject(ctx: WorkContext, id: string, patch: Partial<Omit<ProjectInput, 'spaceId'>> & { position?: number }): Promise<WorkProject> {
  if (patch.status && !PROJECT_STATUSES.includes(patch.status)) throw invalid('Status de projeto inválido.');
  return db.transaction(async (raw) => {
    const tx = raw as unknown as Db;
    const [cur] = await tx.select().from(schema.workProjects).where(and(eq(schema.workProjects.id, id), eq(schema.workProjects.organizationId, ctx.organizationId)));
    if (!cur) throw notFound('Projeto');
    assertDates(patch.startDate === undefined ? cur.startDate : patch.startDate, patch.dueDate === undefined ? cur.dueDate : patch.dueDate);
    if (patch.folderId !== undefined) await assertFolderInSpace(tx, ctx, patch.folderId, cur.spaceId);
    if (patch.clientId !== undefined) await assertClient(tx, ctx, patch.clientId);
    const set: Partial<typeof schema.workProjects.$inferInsert> = { updatedAt: new Date() };
    if (patch.name !== undefined) set.name = name(patch.name, 'o projeto');
    if (patch.description !== undefined) set.description = patch.description;
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.color !== undefined) set.color = patch.color;
    if (patch.folderId !== undefined) set.folderId = patch.folderId;
    if (patch.clientId !== undefined) set.clientId = patch.clientId;
    if (patch.startDate !== undefined) set.startDate = patch.startDate;
    if (patch.dueDate !== undefined) set.dueDate = patch.dueDate;
    if (patch.position !== undefined) set.position = patch.position;
    const [row] = await tx.update(schema.workProjects).set(set).where(eq(schema.workProjects.id, id)).returning();
    await recordActivity(tx, ctx, { entityType: 'project', entityId: id, action: 'updated', data: { fields: Object.keys(patch) } });
    return row!;
  });
}

// ── Listas ───────────────────────────────────────────────────────────────

export type WorkList = typeof schema.workLists.$inferSelect;

export async function createList(ctx: WorkContext, input: { spaceId: string; folderId?: string | null; projectId?: string | null; clientId?: string | null; name: string; description?: string | null }): Promise<WorkList> {
  const n = name(input.name, 'a lista');
  return db.transaction(async (raw) => {
    const tx = raw as unknown as Db;
    await getSpace(tx, ctx, input.spaceId);
    await assertFolderInSpace(tx, ctx, input.folderId, input.spaceId);
    await assertClient(tx, ctx, input.clientId);
    if (input.projectId) {
      const [p] = await tx
        .select({ id: schema.workProjects.id })
        .from(schema.workProjects)
        .where(and(eq(schema.workProjects.id, input.projectId), eq(schema.workProjects.organizationId, ctx.organizationId), eq(schema.workProjects.spaceId, input.spaceId), isNull(schema.workProjects.archivedAt)));
      if (!p) throw invalid('O projeto precisa existir e ser do mesmo espaço.');
    }
    const [row] = await tx
      .insert(schema.workLists)
      .values({
        organizationId: ctx.organizationId,
        spaceId: input.spaceId,
        folderId: input.folderId ?? null,
        projectId: input.projectId ?? null,
        clientId: input.clientId ?? null,
        name: n,
        description: input.description ?? null,
        position: await nextPosition(tx, 'lists', ctx, eq(schema.workLists.spaceId, input.spaceId)),
        createdBy: ctx.userId,
      })
      .returning();
    await recordActivity(tx, ctx, { entityType: 'list', entityId: row!.id, action: 'created', data: { spaceId: input.spaceId, name: n, projectId: input.projectId ?? null } });
    return row!;
  });
}

export async function renameList(ctx: WorkContext, id: string, patch: { name?: string; description?: string | null; position?: number; clientId?: string | null }): Promise<WorkList> {
  return db.transaction(async (raw) => {
    const tx = raw as unknown as Db;
    const set: Partial<typeof schema.workLists.$inferInsert> = { updatedAt: new Date() };
    if (patch.name !== undefined) set.name = name(patch.name, 'a lista');
    if (patch.description !== undefined) set.description = patch.description;
    if (patch.position !== undefined) set.position = patch.position;
    if (patch.clientId !== undefined) { await assertClient(tx, ctx, patch.clientId); set.clientId = patch.clientId; }
    const [row] = await tx.update(schema.workLists).set(set).where(and(eq(schema.workLists.id, id), eq(schema.workLists.organizationId, ctx.organizationId))).returning();
    if (!row) throw notFound('Lista');
    await recordActivity(tx, ctx, { entityType: 'list', entityId: id, action: 'updated', data: { fields: Object.keys(patch) } });
    return row;
  });
}

// ── Arquivar / restaurar ─────────────────────────────────────────────────

export type ContainerKind = 'space' | 'folder' | 'project' | 'list';
const TABLE = { space: schema.workSpaces, folder: schema.workFolders, project: schema.workProjects, list: schema.workLists } as const;

export async function setArchived(ctx: WorkContext, kind: ContainerKind, id: string, archived: boolean): Promise<void> {
  const t = TABLE[kind];
  await db.transaction(async (raw) => {
    const tx = raw as unknown as Db;
    const rows = await tx
      .update(t)
      .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
      .where(and(eq(t.id, id), eq(t.organizationId, ctx.organizationId)))
      .returning({ id: t.id });
    if (rows.length === 0) throw notFound({ space: 'Espaço', folder: 'Pasta', project: 'Projeto', list: 'Lista' }[kind]);
    await recordActivity(tx, ctx, { entityType: kind, entityId: id, action: archived ? 'archived' : 'restored' });
  });
}

// ── Árvore (para o menu lateral) ─────────────────────────────────────────

export interface TreeList { id: string; name: string; folderId: string | null; projectId: string | null; clientId: string | null; archived: boolean; openTaskCount: number }
export interface TreeProject { id: string; name: string; folderId: string | null; clientId: string | null; status: string; archived: boolean }
export interface TreeFolder { id: string; name: string; archived: boolean }
export interface TreeSpace { id: string; name: string; color: string | null; icon: string | null; archived: boolean; folders: TreeFolder[]; projects: TreeProject[]; lists: TreeList[] }

export async function getTree(ctx: WorkContext, opts: { includeArchived?: boolean } = {}): Promise<TreeSpace[]> {
  const org = ctx.organizationId;
  const visible = <T extends { archivedAt: unknown }>(c: T) => opts.includeArchived || c.archivedAt === null;
  const [spaces, folders, projects, lists, contagens] = await Promise.all([
    db.select().from(schema.workSpaces).where(eq(schema.workSpaces.organizationId, org)).orderBy(asc(schema.workSpaces.position)),
    db.select().from(schema.workFolders).where(eq(schema.workFolders.organizationId, org)).orderBy(asc(schema.workFolders.position)),
    db.select().from(schema.workProjects).where(eq(schema.workProjects.organizationId, org)).orderBy(asc(schema.workProjects.position)),
    db.select().from(schema.workLists).where(eq(schema.workLists.organizationId, org)).orderBy(asc(schema.workLists.position)),
    // Tarefas em aberto (de topo) por lista: a árvore mostra onde há trabalho e abre na lista certa.
    db.select({ listId: schema.workTasks.listId, n: sql<number>`count(*)::int` }).from(schema.workTasks)
      .where(and(eq(schema.workTasks.organizationId, org), isNull(schema.workTasks.archivedAt), isNull(schema.workTasks.parentTaskId), isNull(schema.workTasks.completedAt)))
      .groupBy(schema.workTasks.listId),
  ]);
  const abertas = new Map(contagens.map((c) => [c.listId, c.n]));
  return spaces.filter(visible).map((s) => ({
    id: s.id,
    name: s.name,
    color: s.color,
    icon: s.icon,
    archived: s.archivedAt !== null,
    folders: folders.filter((f) => f.spaceId === s.id && visible(f)).map((f) => ({ id: f.id, name: f.name, archived: f.archivedAt !== null })),
    projects: projects.filter((p) => p.spaceId === s.id && visible(p)).map((p) => ({ id: p.id, name: p.name, folderId: p.folderId, clientId: p.clientId, status: p.status, archived: p.archivedAt !== null })),
    lists: lists.filter((l) => l.spaceId === s.id && visible(l)).map((l) => ({ id: l.id, name: l.name, folderId: l.folderId, projectId: l.projectId, clientId: l.clientId, archived: l.archivedAt !== null, openTaskCount: abertas.get(l.id) ?? 0 })),
  }));
}
