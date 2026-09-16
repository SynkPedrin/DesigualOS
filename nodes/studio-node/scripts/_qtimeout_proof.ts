import { config as dotenv } from 'dotenv';
import { resolve } from 'node:path';
dotenv({ path: resolve('../../.env'), quiet: true });
const { db, schema } = await import('@desigual-os/database');
const { eq } = await import('drizzle-orm');
const { getStudioJobQueue } = await import('@desigual-os/orchestrator');
const { expireStaleStudioJobs } = await import('../../../apps/worker/src/scheduler/studio-queue-timeout.js');
const { createLogger } = await import('@desigual-os/logging');
const logger = createLogger({ service: 'qtimeout-proof' });

const [cli] = await db.select().from(schema.clients).where(eq(schema.clients.name, 'Clinica Teste Fase 7')).limit(1);
const jobId = 'STU-QTIMEOUT-' + Date.now();
// Criado com 10 min de idade pra estourar o teto de 3 min (sem worker).
const antigo = new Date(Date.now() - 10 * 60 * 1000);
const [row] = await db.insert(schema.studioJobs).values({
  jobId, clientId: cli!.id, requestedBy: null, type: 'image',
  status: 'queued', prompt: 'prova de timeout de fila', progress: 0, createdAt: antigo,
}).returning();
const q = getStudioJobQueue();
await q.add('studio-job', { studioJobDbId: row!.id, jobId, clientId: cli!.id, requestedBy: null, projectId: null,
  type: 'image', prompt: 'prova', resolution: null, attachments: [], numSlides: null, durationSeconds: null,
  qualityPreset: null, includeText: false, copySlides: null } as never);

const naFilaAntes = (await q.getJobs(['wait','delayed','prioritized','paused'],0,300)).filter(j=>(j.data as any)?.jobId===jobId).length;
const workers = (await q.getWorkers()).length;
console.log(`antes: status=queued naFila=${naFilaAntes} workersConectados=${workers}`);

const r = await expireStaleStudioJobs(logger);
console.log('resultado:', JSON.stringify(r));

const [depois] = await db.select().from(schema.studioJobs).where(eq(schema.studioJobs.jobId, jobId));
const naFilaDepois = (await q.getJobs(['wait','delayed','prioritized','paused'],0,300)).filter(j=>(j.data as any)?.jobId===jobId).length;
console.log(`depois: status=${depois!.status} naFila=${naFilaDepois}`);
console.log(`erro: ${depois!.error}`);

await db.delete(schema.studioJobs).where(eq(schema.studioJobs.jobId, jobId));
console.log('(linha de prova removida)');
process.exit(0);
