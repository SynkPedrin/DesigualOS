import { config as dotenv } from 'dotenv'; import { resolve } from 'node:path';
dotenv({ path: resolve('../../.env'), quiet: true });
const { getStudioJobQueue } = await import('@desigual-os/orchestrator');
console.log('workers conectados:', (await getStudioJobQueue().getWorkers()).length);
process.exit(0);
