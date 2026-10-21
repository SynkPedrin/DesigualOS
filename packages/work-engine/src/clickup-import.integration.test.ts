import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const url = process.env.DATABASE_URL ?? '';
const enabled = /^postgres(ql)?:\/\/[^@]*@127\.0\.0\.1:/.test(url) && process.env.WORK_ENGINE_IT !== 'off';

describe.skipIf(!enabled)('importação ClickUp × PostgreSQL real', () => {
  const org = randomUUID();
  const outraOrg = randomUUID();
  const admin = randomUUID();
  const ana = randomUUID();
  const clienteId = randomUUID();
  let dir = '';

  beforeAll(async () => {
    const { db, schema } = await import('@desigual-os/database');
    for (const o of [org, outraOrg]) await db.insert(schema.organizations).values({ id: o, name: `CU ${o.slice(0, 6)}`, slug: `cu-${o}` });
    await db.insert(schema.users).values([{ id: admin, name: 'Admin', email: `${admin}@cu.invalid` }, { id: ana, name: 'Ana', email: `ana-${ana}@cu.invalid` }]);
    await db.insert(schema.clients).values({ id: clienteId, name: 'Abitte Urbanismo', slug: clienteId, organizationId: org });
    dir = mkdtempSync(join(tmpdir(), 'cu-'));
    const w = (n: string, v: unknown) => writeFileSync(join(dir, `${n}.json`), JSON.stringify(v));
    w('team', { members: [{ user: { id: 1, username: 'Ana', email: `ana-${ana}@cu.invalid` } }, { user: { id: 2, username: 'Fantasma', email: 'fantasma@x.invalid' } }] });
    w('spaces', [{ id: 's1', name: 'Agência', color: '#fff', statuses: [{ status: 'aberto', type: 'open', color: '#111' }, { status: 'feito', type: 'closed', color: '#222' }], _folders: [{ id: 'f1', name: 'Clientes' }] }]);
    w('lists', [{ id: 'l1', name: '[EX-CLIENTE] Abitte Urbanismo', _space: 's1', _folder: 'f1', _fields: [{ id: 'cf1', name: 'Canal', type: 'drop_down', type_config: { options: [{ id: 'o1', name: 'Instagram', orderindex: 0 }] } }] }, { id: 'l2', name: 'Abitte Urbanismo Interno', _space: 's1', _folder: null, _fields: [] }]);
    w('tasks', [
      { id: 't1', name: 'Pai', list: { id: 'l1' }, status: { status: 'aberto', type: 'open' }, priority: { id: '2' }, date_created: '1700000000000', assignees: [{ id: 1, email: `ana-${ana}@cu.invalid` }, { id: 2, email: 'fantasma@x.invalid', username: 'Fantasma' }], custom_fields: [{ id: 'cf1', value: 0 }], checklists: [{ id: 'ck1', name: 'Roteiro', items: [{ id: 'i1', name: 'Gravar', resolved: true }] }], dependencies: [{ task_id: 't2', depends_on: 't1' }], tags: [{ name: 'vip' }] },
      { id: 't2', name: 'Filha', parent: 't1', list: { id: 'l1' }, status: { status: 'feito', type: 'closed' }, date_created: '1700000100000', date_closed: '1700000200000', assignees: [] },
      { id: 't3', name: 'Fora de cliente', list: { id: 'l2' }, status: { status: 'inventado', type: 'custom' }, date_created: '1700000300000', assignees: [] },
    ]);
    w('extras', { t1: { comments: [{ id: 'c1', comment_text: 'Oi', user: { id: 1, email: `ana-${ana}@cu.invalid`, username: 'Ana' }, date: '1700000050000' }], attachments: [{ id: 'a1', title: 'brief.pdf', url: 'https://x/brief.pdf', size: 10 }] } });
  });

  afterAll(async () => {
    const { db, schema } = await import('@desigual-os/database');
    const { inArray } = await import('drizzle-orm');
    await db.delete(schema.organizations).where(inArray(schema.organizations.id, [org, outraOrg]));
    await db.delete(schema.users).where(inArray(schema.users.id, [admin, ana]));
  });

  it('ensaio não grava nada', async () => {
    const { importClickUp } = await import('./clickup-import');
    const { db, schema } = await import('@desigual-os/database');
    const { eq } = await import('drizzle-orm');
    const r = await importClickUp({ organizationId: org, userId: admin }, { snapshotDir: dir, dryRun: true });
    expect(r.counts.tarefas?.novos).toBe(3);
    expect(await db.select().from(schema.workTasks).where(eq(schema.workTasks.organizationId, org))).toHaveLength(0);
  });

  it('importa a hierarquia, vincula só por igualdade e preserva o que não casa', async () => {
    const { importClickUp } = await import('./clickup-import');
    const { db, schema } = await import('@desigual-os/database');
    const { eq } = await import('drizzle-orm');
    const r = await importClickUp({ organizationId: org, userId: admin }, { snapshotDir: dir });
    expect(r.counts.tarefas?.novos).toBe(3);
    const tasks = await db.select().from(schema.workTasks).where(eq(schema.workTasks.organizationId, org));
    const byTitle = Object.fromEntries(tasks.map((t) => [t.title, t]));
    expect(byTitle['Filha']!.parentTaskId).toBe(byTitle['Pai']!.id);
    expect(byTitle['Filha']!.depth).toBe(1);
    expect(byTitle['Filha']!.completedAt).not.toBeNull();
    expect(byTitle['Pai']!.clientId).toBe(clienteId);
    expect(byTitle['Fora de cliente']!.clientId).toBeNull(); // nome PARECIDO não vincula
    expect(byTitle['Pai']!.priority).toBe(2);
    expect(byTitle['Pai']!.number).toBeLessThan(byTitle['Filha']!.number);
    const asg = await db.select().from(schema.workTaskAssignees).where(eq(schema.workTaskAssignees.organizationId, org));
    expect(asg.map((a) => a.userId)).toEqual([ana]); // o "Fantasma" não vira usuário
    expect(r.usuariosNaoCasados.map((u) => u.nome)).toContain('Fantasma');
    expect((await db.select().from(schema.workChecklistItems).where(eq(schema.workChecklistItems.organizationId, org))).map((i) => i.done)).toEqual([true]);
    expect(await db.select().from(schema.workTaskDependencies).where(eq(schema.workTaskDependencies.organizationId, org))).toHaveLength(1);
    const vals = await db.select().from(schema.workCustomFieldValues).where(eq(schema.workCustomFieldValues.organizationId, org));
    expect(vals[0]!.value).toBe('Instagram');
    expect(await db.select().from(schema.workComments).where(eq(schema.workComments.organizationId, org))).toHaveLength(1);
    expect(await db.select().from(schema.workAttachments).where(eq(schema.workAttachments.organizationId, org))).toHaveLength(1);
  });

  it('é idempotente: reimportar atualiza, não duplica', async () => {
    const { importClickUp } = await import('./clickup-import');
    const { db, schema } = await import('@desigual-os/database');
    const { eq } = await import('drizzle-orm');
    const r = await importClickUp({ organizationId: org, userId: admin }, { snapshotDir: dir });
    expect(r.counts.tarefas).toEqual({ novos: 0, atualizados: 3 });
    expect(await db.select().from(schema.workTasks).where(eq(schema.workTasks.organizationId, org))).toHaveLength(3);
    expect(await db.select().from(schema.workComments).where(eq(schema.workComments.organizationId, org))).toHaveLength(1);
    expect(await db.select().from(schema.workChecklists).where(eq(schema.workChecklists.organizationId, org))).toHaveLength(1);
  });

  it('não vaza para outra empresa', async () => {
    const { db, schema } = await import('@desigual-os/database');
    const { eq } = await import('drizzle-orm');
    expect(await db.select().from(schema.workTasks).where(eq(schema.workTasks.organizationId, outraOrg))).toHaveLength(0);
  });
});
