import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const url = process.env.DATABASE_URL ?? '';
const enabled = /^postgres(ql)?:\/\/[^@]*@127\.0\.0\.1:/.test(url);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

describe.skipIf(!enabled)('Anexos do ClickUp → armazenamento próprio × PostgreSQL real', () => {
  const A = { org: randomUUID(), user: randomUUID() }; const B = { org: randomUUID(), user: randomUUID() };
  let dbm: typeof import('@desigual-os/database'); let pasta = ''; let srv: Server; let base = '';
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    pasta = mkdtempSync(join(tmpdir(), 'dt-ext-')); process.env.INTERNAL_CHAT_FILES_DIR = pasta;
    srv = createServer((req, res) => {
      if (req.url === '/ok.png') { res.setHeader('content-type', 'image/png'); res.end(PNG); }
      else if (req.url === '/falso.pdf') { res.setHeader('content-type', 'application/pdf'); res.end(Buffer.from('MZ executavel')); }
      else { res.statusCode = 404; res.end('x'); }
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
    dbm = await import('@desigual-os/database');
    const { db, schema } = dbm; const E = await import('@desigual-os/work-engine');
    for (const [o, u] of [[A.org, A.user], [B.org, B.user]] as const) {
      await db.insert(schema.organizations).values({ id: o, name: `X ${o.slice(0, 6)}`, slug: `x-${o}` });
      await db.insert(schema.users).values({ id: u, name: 'U', email: `${u}@x.invalid` });
      await db.insert(schema.organizationMembers).values({ organizationId: o, userId: u, role: 'admin' });
    }
    const mk = async (org: string, user: string) => { const c = { organizationId: org, userId: user }; return (await E.createTask(c, { listId: (await E.createList(c, { spaceId: (await E.createSpace(c, { name: 'S' })).id, name: 'L' })).id, title: 'T' })).id; };
    const ta = await mk(A.org, A.user); const tb = await mk(B.org, B.user);
    const ins = async (chave: string, org: string, task: string, fileName: string, u: string) => { const [r] = await db.insert(schema.workAttachments).values({ organizationId: org, taskId: task, fileName, url: u, storage: 'external' }).returning(); ids[chave] = r!.id; };
    await ins('ok', A.org, ta, 'foto.png', `${base}/ok.png`);
    await ins('falso', A.org, ta, 'contrato.pdf', `${base}/falso.pdf`);
    await ins('exe', A.org, ta, 'programa.exe', `${base}/ok.png`);
    await ins('fora', A.org, ta, 'x.png', 'https://clickup.com.evil.example/x.png');
    await ins('quebrado', A.org, ta, 'sumiu.png', `${base}/nao-existe.png`);
    await ins('outraEmpresa', B.org, tb, 'b.png', `${base}/ok.png`);
  });
  afterAll(async () => {
    const { db, schema } = dbm; const { inArray } = await import('drizzle-orm');
    await new Promise((r) => srv.close(r));
    await db.delete(schema.organizations).where(inArray(schema.organizations.id, [A.org, B.org]));
    await db.delete(schema.users).where(inArray(schema.users.id, [A.user, B.user]));
    rmSync(pasta, { recursive: true, force: true });
  });
  const linha = async (k: string) => { const { db, schema } = dbm; const { eq } = await import('drizzle-orm'); return (await db.select().from(schema.workAttachments).where(eq(schema.workAttachments.id, ids[k]!)))[0]!; };

  it('simular não muda nada', async () => {
    const { copiarAnexosDoClickUp } = await import('./anexos-externos');
    const r = await copiarAnexosDoClickUp({ organizationId: A.org, simular: true, hostsExtras: [/^127\.0\.0\.1$/] });
    expect(r.candidatos).toBe(5);
    expect((await linha('ok')).storage).toBe('external');
  });

  it('copia o que é válido e deixa como link o que é recusado, falso, fora do ClickUp ou quebrado', async () => {
    const { copiarAnexosDoClickUp } = await import('./anexos-externos');
    const r = await copiarAnexosDoClickUp({ organizationId: A.org, hostsExtras: [/^127\.0\.0\.1$/] });
    expect(r.copiados).toBe(1);
    const ok = await linha('ok');
    expect(ok).toMatchObject({ storage: 'storage', mimeType: 'image/png' });
    expect(existsSync(join(pasta, ok.url.slice('storage:'.length)))).toBe(true);
    for (const k of ['falso', 'exe', 'fora', 'quebrado']) expect((await linha(k)).storage, k).toBe('external');
    expect(r.recusados.map((x) => x.arquivo).sort()).toEqual(['contrato.pdf', 'programa.exe', 'x.png']);
    expect(r.falhas.map((x) => x.arquivo)).toEqual(['sumiu.png']);
    expect((await linha('outraEmpresa')).storage).toBe('external');
  });

  it('repetir não copia de novo o que já foi copiado', async () => {
    const { copiarAnexosDoClickUp } = await import('./anexos-externos');
    const antes = (await linha('ok')).url;
    const r = await copiarAnexosDoClickUp({ organizationId: A.org, hostsExtras: [/^127\.0\.0\.1$/] });
    expect(r.copiados).toBe(0);
    expect((await linha('ok')).url).toBe(antes);
  });
});
