import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

const url = process.env.DATABASE_URL ?? '';
const enabled = /^postgres(ql)?:\/\/[^@]*@127\.0\.0\.1:/.test(url);

describe.skipIf(!enabled)('Sincronização do ClickUp (status, conclusão, prazo) × PostgreSQL real', () => {
  const A = { org: randomUUID(), u: randomUUID(), outro: randomUUID() };
  let dbm: typeof import('@desigual-os/database'); let E: typeof import('./index');
  const ctx = { organizationId: A.org, userId: A.u, actorKind: 'system' as const };
  const ids: Record<string, string> = {}; let encerrado = ''; let aberto = '';
  const DIA = 86_400_000; let corte = new Date();

  beforeAll(async () => {
    dbm = await import('@desigual-os/database'); E = await import('./index');
    const { db, schema } = dbm;
    await db.insert(schema.organizations).values({ id: A.org, name: 'Sync', slug: `sync-${A.org}` });
    for (const u of [A.u, A.outro]) { await db.insert(schema.users).values({ id: u, name: 'U', email: `${u}@s.invalid` }); await db.insert(schema.organizationMembers).values({ organizationId: A.org, userId: u, role: 'owner' }); }
    const c = { organizationId: A.org, userId: A.u };
    const sp = (await E.createSpace(c, { name: 'S' })).id; const list = (await E.createList(c, { spaceId: sp, name: 'L' })).id;
    aberto = (await E.createStatus(c, sp, { name: 'aberto', category: 'todo' })).id;
    encerrado = (await E.createStatus(c, sp, { name: 'encerrado', category: 'done' })).id;
    for (const k of ['fechadaLa', 'reabertaLa', 'prazo', 'mexida', 'semStatus', 'igual']) {
      const t = await E.createTask(c, { listId: list, title: k });
      await E.updateTask(c, t.id, { statusId: k === 'reabertaLa' ? encerrado : aberto });
      ids[k] = t.id;
      await db.insert(schema.workExternalMappings).values({ organizationId: A.org, provider: 'clickup', externalType: 'task', externalId: `cu-${k}`, entityType: 'task', entityId: t.id });
    }
    // o corte é DEPOIS de preparar tudo; só a 'mexida' ganha atividade humana depois dele
    await new Promise((r) => setTimeout(r, 30)); corte = new Date(); await new Promise((r) => setTimeout(r, 30));
    await E.updateTask({ organizationId: A.org, userId: A.outro }, ids.mexida!, { priority: 1 });
  });
  afterAll(async () => {
    const { db, schema } = dbm; const { inArray } = await import('drizzle-orm');
    await db.delete(schema.organizations).where(inArray(schema.organizations.id, [A.org]));
    await db.delete(schema.users).where(inArray(schema.users.id, [A.u, A.outro]));
  });

  const fechado = String(Date.now() - 2 * DIA); const due = String(Date.now() + 5 * DIA);
  const itens = () => {
    return [
      { id: 'cu-fechadaLa', status: 'encerrado', type: 'closed', closed: fechado, updated: fechado, due: null },
      { id: 'cu-reabertaLa', status: 'aberto', type: 'open', closed: null, updated: fechado, due: null },
      { id: 'cu-prazo', status: 'aberto', type: 'open', closed: null, updated: fechado, due },
      { id: 'cu-mexida', status: 'encerrado', type: 'closed', closed: fechado, updated: fechado, due: null },
      { id: 'cu-semStatus', status: 'status que não existe aqui', type: 'custom', closed: null, updated: fechado, due: null },
      { id: 'cu-igual', status: 'aberto', type: 'open', closed: null, updated: fechado, due: null },
      { id: 'cu-nova-tarefa', status: 'aberto', type: 'open', closed: null, updated: fechado, due: null },
    ];
  };

  it('ensaio não grava nada, mas relata o que mudaria, o conflito e o que não tem correspondente', async () => {
    const r = await E.sincronizarDoClickUp(ctx, itens(), { dryRun: true, desde: corte });
    expect(r).toMatchObject({ dryRun: true, semCorrespondente: 1, atualizadas: 3, semMudanca: 2 });
    expect(r.conflitos.map((c) => c.clickupId)).toEqual(['cu-mexida']);
    expect(r.statusSemEquivalente.map((s) => s.clickupId)).toEqual(['cu-semStatus']);
    expect((await E.getTask(ctx, ids.fechadaLa!)).completedAt).toBeNull();
  });

  it('aplicar fecha a que fechou lá, reabre a que reabriu, acerta o prazo e não toca na mexida no Daily', async () => {
    const r = await E.sincronizarDoClickUp(ctx, itens(), { dryRun: false, desde: corte });
    expect(r.atualizadas).toBe(3);
    const f = await E.getTask(ctx, ids.fechadaLa!); expect(f.status?.name).toBe('encerrado'); expect(f.completedAt).not.toBeNull();
    const re = await E.getTask(ctx, ids.reabertaLa!); expect(re.status?.name).toBe('aberto'); expect(re.completedAt).toBeNull();
    expect((await E.getTask(ctx, ids.prazo!)).dueAt).not.toBeNull();
    expect((await E.getTask(ctx, ids.mexida!)).status?.name).toBe('aberto');
    const { db, schema } = dbm; const { and, eq } = await import('drizzle-orm');
    expect((await db.select().from(schema.notifications).where(eq(schema.notifications.type, 'work.status_changed'))).filter((n) => n.title.includes('sync')).length).toBe(0);
    const ev = await db.select().from(schema.workActivityEvents).where(and(eq(schema.workActivityEvents.taskId, ids.fechadaLa!), eq(schema.workActivityEvents.actorKind, 'system')));
    expect(ev.some((e) => (e.data as { source?: string }).source === 'clickup_sync')).toBe(true);
  });

  it('repetir não muda mais nada', async () => {
    const r = await E.sincronizarDoClickUp(ctx, itens(), { dryRun: false, desde: corte });
    expect(r.atualizadas).toBe(0);
  });
});
