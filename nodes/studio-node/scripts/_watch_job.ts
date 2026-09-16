import { config as dotenv } from 'dotenv'; import { resolve } from 'node:path';
dotenv({ path: resolve('../../.env'), quiet: true });
const { db } = await import('@desigual-os/database'); const { sql } = await import('drizzle-orm');
const jobId = process.argv[2]!;
const limite = Date.now() + 5*60*1000;
let ultimo = '';
while (Date.now() < limite) {
  const r = await db.execute(sql`select status, progress, coalesce(error,'') as err from studio_jobs where job_id=${jobId}`);
  const row = ((r as any).rows ?? r)[0];
  const est = `${row.status}/${row.progress}`;
  if (est !== ultimo) { ultimo = est; console.log(new Date().toISOString().slice(11,19), est, row.err.slice(0,90)); }
  if (['completed','failed','cancelled'].includes(row.status)) break;
  await new Promise(r=>setTimeout(r,5000));
}
process.exit(0);
