import { db } from '@desigual-os/database';
import { sql } from 'drizzle-orm';
import { getRedisConnection } from '@desigual-os/orchestrator';

const r = await db.execute(sql`
  select status, count(*)::int as n, max(created_at) as recente
  from executions where created_at > now() - interval '48 hours'
  group by status order by n desc`);
console.log('--- executions (48h) ---');
for (const l of (r as any[])) console.log(`${String(l.status).padEnd(12)} ${String(l.n).padStart(4)}  recente=${l.recente}`);

const p = await db.execute(sql`
  select id, status, created_at from executions
  where status in ('queued','running','pending') order by created_at asc limit 5`);
console.log('--- pendentes mais antigas ---');
if ((p as any[]).length === 0) console.log('(nenhuma)');
for (const l of (p as any[])) console.log(`${l.id} ${l.status} ${l.created_at}`);

const j = await db.execute(sql`
  select status, count(*)::int as n, max(created_at) as recente
  from jobs where created_at > now() - interval '48 hours' group by status order by n desc`);
console.log('--- jobs (48h) ---');
for (const l of (j as any[])) console.log(`${String(l.status).padEnd(12)} ${String(l.n).padStart(4)}  recente=${l.recente}`);

const redis = getRedisConnection();
try {
  const chaves = await redis.keys('bull:*:*');
  const filas = [...new Set(chaves.map((k) => k.split(':')[1]))];
  console.log('--- BullMQ ---');
  for (const f of filas) {
    const wait = await redis.llen(`bull:${f}:wait`);
    const active = await redis.llen(`bull:${f}:active`);
    const failed = await redis.zcard(`bull:${f}:failed`);
    const delayed = await redis.zcard(`bull:${f}:delayed`);
    console.log(`${f.padEnd(24)} wait=${wait} active=${active} delayed=${delayed} failed=${failed}`);
  }
  if (filas.length === 0) console.log('(sem filas bull no Redis)');
} catch (e) { console.log('--- BullMQ --- inacessivel:', (e as Error).message); }
process.exit(0);
