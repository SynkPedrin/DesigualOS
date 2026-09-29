import './env.js';
import { db, schema } from '@desigual-os/database';
import { isNull } from 'drizzle-orm';
import { queryOperationTasks } from '@desigual-os/tool-gateway';
import { getClickUpConfigOrNull } from './processors/bento-action-guard.js';
const cfg = getClickUpConfigOrNull()!;
const listas = (await db.select({ id: schema.clients.clickupListId }).from(schema.clients).where(isNull(schema.clients.deletedAt)))
  .map((c) => c.id).filter((x): x is string => Boolean(x));
const r = await queryOperationTasks(cfg, { listIds: listas } as never);
const hoje = new Date(); hoje.setHours(0,0,0,0);
const t = r.tasks;
const porTipo = new Map<string, number>();
for (const x of t) porTipo.set(x.statusType ?? 'null', (porTipo.get(x.statusType ?? 'null') ?? 0) + 1);
const venc = (f: (x: typeof t[number]) => boolean) => t.filter((x) => f(x) && x.dueDate !== null && x.dueDate < hoje.getTime()).length;
console.log('total de tasks:', t.length, '| truncado:', r.truncated);
console.log('por statusType:', [...porTipo.entries()].map(([k, v]) => `${k}=${v}`).join(' '));
console.log('atrasadas SEM filtro (o que eu contava):', venc(() => true));
console.log('atrasadas só ABERTAS (o correto):      ', venc((x) => x.statusType !== 'closed' && x.statusType !== 'done'));
process.exit(0);
