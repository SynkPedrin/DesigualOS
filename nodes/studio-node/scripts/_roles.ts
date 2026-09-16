import { config as dotenv } from 'dotenv';
import { resolve } from 'node:path';
dotenv({ path: resolve('../../.env'), quiet: true });
const { db } = await import('@desigual-os/database');
const { sql } = await import('drizzle-orm');
const roles = await db.execute(sql`select id,name from roles order by name`);
console.log('ROLES:'); for (const r of ((roles as any).rows ?? roles)) console.log('  ', r.name, r.id);
const perms = await db.execute(sql`
  select r.name as role, p.resource, p.action from roles r
  join role_permissions rp on rp.role_id=r.id join permissions p on p.id=rp.permission_id
  where p.resource in ('studio','clients') order by r.name, p.resource, p.action`);
console.log('PERMS (studio/clients):'); for (const p of ((perms as any).rows ?? perms)) console.log('  ', p.role, '->', p.resource+':'+p.action);
process.exit(0);
