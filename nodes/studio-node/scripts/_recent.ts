import { config as dotenv } from 'dotenv'; import { resolve } from 'node:path';
dotenv({ path: resolve('../../.env'), quiet: true });
const { db } = await import('@desigual-os/database'); const { sql } = await import('drizzle-orm');
const r = await db.execute(sql`select job_id,status,progress,created_at,left(coalesce(error,''),70) as err from studio_jobs order by created_at desc limit 4`);
for (const x of ((r as any).rows ?? r)) console.log(String(x.created_at).slice(0,19), x.job_id, x.status, x.progress, x.err);
process.exit(0);
