import { config as dotenv } from 'dotenv';
import { resolve } from 'node:path';
dotenv({ path: resolve('../../.env'), quiet: true });
const { Queue, Worker } = await import('bullmq');
const { getRedisConnection } = await import('@desigual-os/orchestrator');

const NAME = 'lock-proof-' + Date.now();
const q = new Queue(NAME, { connection: getRedisConnection() });
await q.add('t', { n: 1 }, { attempts: 1 });

let invocacoes = 0;
const inicio = Date.now();
// lockDuration 3s com job de 15s: SEM renovação automática o BullMQ
// consideraria o job travado e reentregaria -> processor chamado 2x+.
const w = new Worker(NAME, async () => {
  invocacoes += 1;
  console.log(`  processor invocado #${invocacoes} em +${((Date.now()-inicio)/1000).toFixed(1)}s`);
  await new Promise(r => setTimeout(r, 15000));
  console.log(`  processor terminou #${invocacoes}`);
}, {
  connection: getRedisConnection().duplicate(),
  concurrency: 1,
  lockDuration: 3000,
  stalledInterval: 2000,
  maxStalledCount: 1,
});

await new Promise<void>((res) => { w.on('completed', () => res()); w.on('failed', () => res()); });
await new Promise(r => setTimeout(r, 3000));
console.log(`\nlockDuration=3s, job=15s -> processor invocado ${invocacoes}x`);
console.log(invocacoes === 1 ? 'RENOVACAO AUTOMATICA CONFIRMADA (sem duplicacao)' : 'DUPLICACAO DETECTADA');
const counts = await q.getJobCounts();
console.log('contadores:', JSON.stringify(counts));
await w.close(); await q.obliterate({ force: true }); await q.close();
process.exit(0);
