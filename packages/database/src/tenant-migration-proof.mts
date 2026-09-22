import { config } from 'dotenv';
import postgres from 'postgres';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

config({ path: '../../.env' });
const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require', prepare: false, max: 1, connect_timeout: 15 });
const migration = await readFile('../../database/migrations/0035_tenant_foundation.sql', 'utf8');
const apply = process.argv.includes('--apply');
try {
  const result = await sql.begin(async (tx) => {
    await tx`set local lock_timeout = '5s'`;
    await tx`set local statement_timeout = '30s'`;
    await tx`select pg_advisory_xact_lock(350035)`;
    // Stabilize precisely the rows being snapshotted/backfilled, not the whole database.
    if (apply) await tx`lock table users, clients, automations, roles, user_roles in share row exclusive mode`;
    const before = await tx`select
      (select coalesce(jsonb_agg(to_jsonb(u) order by id), '[]') from users u) as users,
      (select coalesce(jsonb_agg(to_jsonb(c) - 'organization_id' order by id), '[]') from clients c) as clients,
      (select coalesce(jsonb_agg(to_jsonb(a) - 'organization_id' order by id), '[]') from automations a) as automations`;
    if (!apply) return { mode: 'preflight', counts: Object.fromEntries(Object.entries(before[0]!).map(([k,v]) => [k,(v as unknown[]).length])) };
    // Private backup of every pre-existing field affected by this additive migration.
    const dir = resolve(homedir(), '.desigual-os-backups');
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const backup = resolve(dir, `tenant-0035-${Date.now()}.json`);
    await writeFile(backup, JSON.stringify(before), { mode: 0o600, flag: 'wx' });
    const journal = JSON.parse(await readFile('../../database/migrations/meta/_journal.json', 'utf8'));
    const entry = journal.entries.find((e: { tag: string }) => e.tag === '0035_tenant_foundation');
    const existing = await tx`select id from drizzle.__drizzle_migrations where created_at = ${entry.when}`;
    if (!existing.length) {
      await tx.unsafe(migration);
      await tx`insert into drizzle.__drizzle_migrations(hash, created_at) values (${createHash('sha256').update(migration).digest('hex')}, ${entry.when})`;
    }
    const after = await tx`select
      (select coalesce(jsonb_agg(to_jsonb(u) order by id), '[]') from users u) as users,
      (select coalesce(jsonb_agg(to_jsonb(c) - 'organization_id' order by id), '[]') from clients c) as clients,
      (select coalesce(jsonb_agg(to_jsonb(a) - 'organization_id' order by id), '[]') from automations a) as automations`;
    assert.deepEqual(after, before, 'Existing records changed: transaction will roll back');
    const [proof] = await tx`select
      (select count(*)::int from organizations) as organizations,
      (select count(*)::int from organization_members) as memberships,
      (select count(*)::int from clients where organization_id is null) as unscoped_clients,
      (select count(*)::int from automations where organization_id is null) as unscoped_automations,
      (select count(*)::int from users u where not exists (select 1 from organization_members m where m.user_id=u.id)) as users_without_membership`;
    assert.equal(proof!.unscoped_clients, 0);
    assert.equal(proof!.unscoped_automations, 0);
    assert.equal(proof!.users_without_membership, 0);
    return { backup, preserved: true, ...proof };
  });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Migration validation failed');
  process.exitCode = 1;
} finally { await sql.end({ timeout: 5 }); }
