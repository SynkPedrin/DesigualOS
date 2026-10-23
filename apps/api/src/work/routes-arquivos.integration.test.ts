import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Arquivos nas tarefas e "atribuídas a mim" na caixa de entrada, contra Postgres real. */
const url = process.env.DATABASE_URL ?? '';
const enabled = /^postgres(ql)?:\/\/[^@]*@127\.0\.0\.1:/.test(url);

const users = vi.hoisted(() => new Map<string, { id: string; roles: string[] }>());
vi.mock('../auth/middleware', () => ({
  requireAuth: async (request: { headers: Record<string, unknown>; authUser?: unknown }, reply: { code: (n: number) => { send: (b: unknown) => void } }) => {
    const u = users.get(String(request.headers['x-test-user'] ?? ''));
    if (!u) { reply.code(401).send({ error: 'Not authenticated' }); return; }
    request.authUser = { id: u.id, roles: u.roles, permissions: [], email: 'x@y.invalid', name: 'T' };
  },
  requirePermission: () => async () => {},
}));

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

describe.skipIf(!enabled)('Daily Tasks — arquivos da tarefa e atribuídas × PostgreSQL real', () => {
  const A = { org: randomUUID(), admin: randomUUID(), outro: randomUUID() };
  const B = { org: randomUUID(), admin: randomUUID() };
  const app: FastifyInstance = Fastify();
  let dbm: typeof import('@desigual-os/database');
  let pasta = '';
  let taskA = ''; let taskB = '';

  const subir = (user: string, taskId: string, filename: string, mimetype: string, bytes: Buffer) => {
    const b = '----teste' + randomUUID();
    const corpo = Buffer.concat([Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimetype}\r\n\r\n`), bytes, Buffer.from(`\r\n--${b}--\r\n`)]);
    return app.inject({ method: 'POST', url: `/work/tasks/${taskId}/attachments/upload`, headers: { 'x-test-user': user, 'content-type': `multipart/form-data; boundary=${b}` }, payload: corpo });
  };
  const get = (user: string, path: string) => app.inject({ method: 'GET', url: path, headers: { 'x-test-user': user } });

  beforeAll(async () => {
    pasta = mkdtempSync(join(tmpdir(), 'dt-arquivos-'));
    process.env.INTERNAL_CHAT_FILES_DIR = pasta;
    dbm = await import('@desigual-os/database');
    const { db, schema } = dbm;
    const E = await import('@desigual-os/work-engine');
    users.set('admin', { id: A.admin, roles: ['colaborador'] });
    users.set('outro', { id: A.outro, roles: ['colaborador'] });
    users.set('bAdmin', { id: B.admin, roles: ['colaborador'] });
    for (const o of [A.org, B.org]) await db.insert(schema.organizations).values({ id: o, name: `F ${o.slice(0, 6)}`, slug: `f-${o}` });
    for (const [id, org, role] of [[A.admin, A.org, 'admin'], [A.outro, A.org, 'admin'], [B.admin, B.org, 'admin']] as const) {
      await db.insert(schema.users).values({ id, name: id.slice(0, 6), email: `${id}@f.invalid` });
      await db.insert(schema.organizationMembers).values({ organizationId: org, userId: id, role });
    }
    await E.setFlag({ organizationId: A.org, enabled: true, allowedUserIds: [A.admin, A.outro], updatedBy: A.admin });
    await E.setFlag({ organizationId: B.org, enabled: true, allowedUserIds: [B.admin], updatedBy: B.admin });
    const ca = { organizationId: A.org, userId: A.admin }; const cb = { organizationId: B.org, userId: B.admin };
    const la = (await E.createList(ca, { spaceId: (await E.createSpace(ca, { name: 'S' })).id, name: 'L' })).id;
    const lb = (await E.createList(cb, { spaceId: (await E.createSpace(cb, { name: 'S' })).id, name: 'L' })).id;
    taskA = (await E.createTask(ca, { listId: la, title: 'Com arquivo', assigneeIds: [A.outro] })).id;
    taskB = (await E.createTask(cb, { listId: lb, title: 'Da outra empresa' })).id;
    const { registerWorkRoutes } = await import('./routes');
    await app.register(multipart);
    await app.register(registerWorkRoutes);
    await app.ready();
  });

  afterAll(async () => {
    const { db, schema } = dbm;
    const { inArray } = await import('drizzle-orm');
    await app.close();
    await db.delete(schema.organizations).where(inArray(schema.organizations.id, [A.org, B.org]));
    await db.delete(schema.users).where(inArray(schema.users.id, [A.admin, A.outro, B.admin]));
    rmSync(pasta, { recursive: true, force: true });
  });

  it('sobe imagem, aparece no detalhe com rota própria e baixa os mesmos bytes', async () => {
    const r = await subir('admin', taskA, 'logo.png', 'image/png', PNG);
    expect(r.statusCode).toBe(201);
    const { id, url: rota } = r.json();
    expect(rota).toBe(`/work/attachments/${id}/file`);
    const det = (await get('admin', `/work/tasks/${taskA}/detail`)).json();
    expect(det.attachments).toEqual([expect.objectContaining({ id, fileName: 'logo.png', storage: 'storage', url: rota })]);
    const f = await get('outro', rota);
    expect(f.statusCode).toBe(200);
    expect(f.headers['content-type']).toBe('image/png');
    expect(Buffer.compare(f.rawPayload, PNG)).toBe(0);
  });

  it('outra empresa não baixa nem sobe na tarefa alheia (404)', async () => {
    const id = (await subir('admin', taskA, 'a.png', 'image/png', PNG)).json().id as string;
    expect((await get('bAdmin', `/work/attachments/${id}/file`)).statusCode).toBe(404);
    expect((await subir('bAdmin', taskA, 'x.png', 'image/png', PNG)).statusCode).toBe(404);
    expect((await subir('admin', taskB, 'x.png', 'image/png', PNG)).statusCode).toBe(404);
  });

  it('recusa executável disfarçado de PDF e extensão proibida', async () => {
    expect((await subir('admin', taskA, 'contrato.pdf', 'application/pdf', Buffer.from('MZ\x90\x00 executavel'))).statusCode).toBe(415);
    expect((await subir('admin', taskA, 'programa.exe', 'application/octet-stream', Buffer.from('MZ'))).statusCode).toBe(415);
  });

  it('remover o anexo apaga o arquivo do disco', async () => {
    const { id, url: rota } = (await subir('admin', taskA, 'tmp.png', 'image/png', PNG)).json();
    expect((await app.inject({ method: 'DELETE', url: `/work/attachments/${id}`, headers: { 'x-test-user': 'admin' } })).statusCode).toBe(200);
    expect((await get('admin', rota)).statusCode).toBe(404);
  });

  it('caixa de entrada lista só o que é DA pessoa e ainda está aberto', async () => {
    const dele = (await get('outro', '/work/inbox')).json();
    expect(dele.assigned.map((a: { taskId: string }) => a.taskId)).toEqual([taskA]);
    expect((await get('admin', '/work/inbox')).json().assigned).toEqual([]);
    expect((await get('bAdmin', '/work/inbox')).json().assigned).toEqual([]);
  });
});
