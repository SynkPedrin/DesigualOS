import { config as dotenv } from 'dotenv';
import { resolve } from 'node:path';
dotenv({ path: resolve('../../.env'), quiet: true });
const { db, schema } = await import('@desigual-os/database');
const { sql } = await import('drizzle-orm');
const r = await db.execute(sql`select id,email,name,active from users order by created_at desc limit 25`);
for (const u of ((r as any).rows ?? r)) console.log(u.active ? 'ON ' : 'off', u.email, '|', u.name, '|', '');
process.exit(0);
