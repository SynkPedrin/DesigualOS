import { config as dotenv } from 'dotenv';
import { resolve } from 'node:path';
dotenv({ path: resolve('../../.env'), quiet: true });
const { db } = await import('@desigual-os/database');
const { sql } = await import('drizzle-orm');
const perms = await db.execute(sql`
  select r.name as role, p.resource, p.action from roles r
  left join permissions p on p.role_id=r.id order by r.name, p.resource, p.action`);
for (const p of ((perms as any).rows ?? perms)) console.log('  ', p.role, '->', p.resource+':'+p.action);
process.exit(0);
